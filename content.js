// NAVER Map List Importer — content script (runs in top frame and in every iframe).
// Top frame (map.naver.com) drives one CSV item per page load; child frames (pcmap.place.naver.com)
// answer commands sent with window.postMessage. All UI elements are located by visible text, not class names.

(() => {
  const IS_TOP = window === window.top;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s || '').toLowerCase().replace(/[\s\-_·•・()（）\[\]【】,.，。'"’“”&+]/g, '');
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const textOf = el => (el.innerText || el.textContent || '').trim();

  function bigrams(s) { const a = []; for (let i = 0; i < s.length - 1; i++) a.push(s.slice(i, i + 2)); return a; }
  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    // containment: the closer the two lengths, the better ("동대문디자인플라자" beats "공차 동대문디자인플라자점")
    if (a.includes(b) || b.includes(a)) return 0.55 + 0.4 * (Math.min(a.length, b.length) / Math.max(a.length, b.length));
    const A = bigrams(a), B = bigrams(b); if (!A.length || !B.length) return 0;
    const set = new Map(); A.forEach(x => set.set(x, (set.get(x) || 0) + 1));
    let hit = 0; B.forEach(x => { const n = set.get(x); if (n) { hit++; set.set(x, n - 1); } });
    return (2 * hit) / (A.length + B.length);
  }

  // ---------- generic finders ----------
  function clickables(root = document) {
    return [...root.querySelectorAll('a,button,[role="button"],label,li,div,span')].filter(visible);
  }
  function findByText(pred, root = document, tags = 'a,button,[role="button"],span,div,li,label') {
    const els = [...root.querySelectorAll(tags)].filter(visible);
    // prefer the smallest element whose own text matches (avoid giant containers)
    const hits = els.filter(el => pred(textOf(el)) && textOf(el).length <= 40);
    hits.sort((x, y) => textOf(x).length - textOf(y).length || x.getBoundingClientRect().top - y.getBoundingClientRect().top);
    return hits;
  }
  function clickTarget(el) {
    // climb to a real control if the text sits inside one
    let t = el;
    for (let i = 0; i < 4 && t && t !== document.body; i++) {
      if (t.matches && t.matches('a,button,[role="button"],label,li,[role="option"],[role="checkbox"]')) return t;
      t = t.parentElement;
    }
    return el;
  }
  function fire(el) {
    const t = clickTarget(el);
    try { t.scrollIntoView({ block: 'center' }); } catch {}
    const r = t.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
    }
    return t;
  }
  async function waitFor(fn, ms = 8000, step = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(step); }
    return null;
  }
  function snapshot() {
    // short list of visible button-ish texts, for debugging when a step fails
    const seen = new Set();
    return [...document.querySelectorAll('a,button,[role="button"],label')].filter(visible)
      .map(textOf).filter(t => t && t.length <= 30 && !seen.has(t) && seen.add(t)).slice(0, 40).join(' | ');
  }

  // ---------- commands executed in whichever frame receives them ----------
  const GU_RE = /(?:^|\s)([가-힣]{1,6}구)(?=\s|$)/;
  function resultItems() {
    return [...document.querySelectorAll('li')].filter(li => visible(li) && li.querySelector('a') && textOf(li).length > 1);
  }
  // name link = first visible anchor without an image (the photo link opens the photo tab, which has no address)
  function nameLinkOf(li) {
    const anchors = [...li.querySelectorAll('a')].filter(visible);
    return anchors.find(a => !a.querySelector('img') && textOf(a).length > 1) || anchors[0] || li;
  }
  async function cmdListResults({ names }) {
    const list = await waitFor(() => { const l = resultItems(); return l.length ? l : null; }, 10000);
    if (!list) return { ok: false, status: 'noresults', note: snapshot() };
    const out = list.slice(0, 12).map((li, i) => {
      const link = nameLinkOf(li);
      const title = (textOf(link).split('\n')[0] || textOf(li).split('\n')[0] || '').trim();
      let sc = 0; for (const n of names) if (n) sc = Math.max(sc, similarity(title, n));
      const m = textOf(li).match(GU_RE);
      return { i, title, sc: Number(sc.toFixed(2)), gu: m ? m[1] : '' };
    });
    return { ok: true, results: out };
  }
  async function cmdClickResult({ i }) {
    const list = resultItems(); const li = list[i]; if (!li) return { ok: false, status: 'noresult' };
    const link = nameLinkOf(li); fire(link); try { link.click && link.click(); } catch {}
    return { ok: true, title: textOf(link).split('\n')[0] };
  }

  const lines = el => textOf(el).split('\n').map(x => x.trim()).filter(Boolean);
  const dialogOpen = () => !!findByText(t => /새 리스트 만들기|새 리스트|폴더명/.test(t), document, 'a,button,[role="button"],span,div,label,li,h1,h2,h3,strong').length
                        || [...document.querySelectorAll('a,button,label,li,[role="button"]')].some(el => visible(el) && /선택해제됨|선택됨/.test(textOf(el)) && /폴더명|장소수/.test(textOf(el)));

  function readAddress() {
    // first visible text that looks like a Korean road address
    const els = [...document.querySelectorAll('span,div,p,a,li')].filter(visible);
    for (const el of els) {
      const t = textOf(el);
      if (t.length <= 80 && /^(서울|부산|대전|대구|인천|광주|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(특별시|광역시|특별자치시|특별자치도|도)?\s+\S+(구|시|군)\s+\S/.test(t)) return t;
    }
    return '';
  }
  async function cmdCheckAddress({ gu, addrKey, expectTitle, prevAddr }) {
    if (expectTitle) { // entry iframe is reused between candidates: wait for the new place's name to show up near the top
      await waitFor(() => findByText(t => similarity(t, expectTitle) >= 0.6, document, 'h1,h2,h3,strong,span,div,a').some(el => el.getBoundingClientRect().top < 450) ? true : null, 6000, 200);
      if (prevAddr) await waitFor(() => { const a = readAddress(); return (a && a !== prevAddr) ? a : null; }, 2500, 200);
    }
    let addr = await waitFor(() => readAddress() || null, 2500, 250) || '';
    if (!addr) {
      // probably on the photo/review tab: switch to the 홈 (or 정보) tab, then read again
      const tab = findByText(t => /^(홈|정보)$/.test(t), document, 'a,button,[role="tab"],span')[0];
      if (tab) { fire(tab); try { clickTarget(tab).click(); } catch {} }
      addr = await waitFor(() => readAddress() || null, 5000, 250) || '';
    }
    if (!gu || !gu.length) return { ok: true, addr };
    const guHit = gu.some(g => addr.includes(g));
    const keyHit = !!(addrKey && addr.replace(/\s+/g, '').includes(addrKey.replace(/\s+/g, '')));
    const ok = guHit || keyHit;
    return { ok, addr, status: ok ? (keyHit ? 'addr-strong' : 'addr-gu') : 'wrongplace', note: 'addr=' + addr + ' expected=' + gu.join('/') + (addrKey ? '+' + addrKey : '') };
  }

  async function cmdClickSave() {
    // "저장" button in the place page header; "저장됨" means already saved. Click until the list sheet opens.
    const find = () => {
      const hits = findByText(t => /^저장(\s*\d+)?$|^저장됨$|^저장하기$/.test(t.replace(/\s+/g, '')), document, 'a,button,[role="button"],span,div');
      // prefer the one nearest the top of the panel (header action), ignore anything far down (review buttons etc.)
      return hits.filter(h => h.getBoundingClientRect().top < 700);
    };
    const btns = await waitFor(() => { const h = find(); return h.length ? h : null; }, 10000);
    if (!btns) return { ok: false, status: 'nosavebtn', note: snapshot() };
    const el = btns[0]; const t = textOf(el).replace(/\s+/g, '');
    if (/저장됨/.test(t)) return { ok: true, status: 'already' };
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(attempt ? 800 : 100);
      const tgt = fire(el); try { tgt.click(); } catch {}
      const opened = await waitFor(() => dialogOpen(), 5000, 200);
      if (opened) return { ok: true, status: 'clicked' };
      const t2 = textOf(el).replace(/\s+/g, ''); if (/저장됨/.test(t2)) return { ok: true, status: 'already' };
    }
    return { ok: false, status: 'nodialog', note: snapshot() };
  }

  async function cmdChooseList({ list }) {
    // List sheet: each list is a block whose lines look like  폴더명 / <name> / 장소수 / <n> / 선택해제됨|선택됨
    // React re-creates nodes after a click, so always re-query before reading state.
    const pick = () => {
      const cands = [...document.querySelectorAll('button,label,li,a,[role="button"],[role="checkbox"],div')].filter(visible)
        .filter(el => { const L = lines(el); return L.length <= 8 && L.some(x => similarity(x, list) >= 0.9) && L.some(x => /선택해제됨|선택됨|장소수|폴더명/.test(x)); });
      cands.sort((x, y) => textOf(x).length - textOf(y).length);
      return cands.length ? cands[0] : null;
    };
    const stateOf = el => { const L = lines(el); const i = L.indexOf('장소수'); const cb = el.querySelector('input[type="checkbox"]'); return { checked: (L.includes('선택됨') && !L.includes('선택해제됨')) || (cb && cb.checked) || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true', count: i >= 0 ? parseInt(L[i + 1], 10) : NaN }; };
    const el0 = await waitFor(pick, 7000, 200);
    if (!el0) {
      const names = [...document.querySelectorAll('button,label,li,a,[role="button"]')].filter(visible).map(lines).filter(L => L.includes('폴더명')).map(L => L[L.indexOf('폴더명') + 1]).filter(Boolean);
      return { ok: false, status: 'nolist', note: 'lists=' + names.join('/') + ' ; ' + snapshot() };
    }
    const before = stateOf(el0);
    if (before.checked) return { ok: true, status: 'already' };
    const html = (el) => (el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 900);
    const sheetButtons = () => { // every visible button-ish text near the sheet, duplicates kept
      const root = (() => { let r = el0; for (let i = 0; i < 8 && r.parentElement; i++) { r = r.parentElement; if (r.querySelectorAll('input[type="checkbox"],[role="checkbox"]').length >= 2 || /새 리스트 만들기/.test(textOf(r))) break; } return r; })();
      return [...root.querySelectorAll('a,button,[role="button"],label,input')].filter(visible).map(e => e.tagName + ':' + (e.type || '') + ':' + textOf(e).replace(/\n/g, '/').slice(0, 30)).join(' | ');
    };
    const verify = async () => waitFor(() => { const e = pick(); if (!e) return null; const st = stateOf(e); return (st.checked || (isFinite(before.count) && st.count > before.count)) ? st : null; }, 2500, 200);
    const strategies = [
      ['inputclick', () => { const cb = el0.querySelector('input[type="checkbox"],[role="checkbox"]'); if (!cb) return false; cb.click(); return true; }],
      ['controlclick', () => { const t = clickTarget(el0); t.click(); return true; }],
      ['events', () => { fire(el0); return true; }],
      ['pointclick', () => { const r = el0.getBoundingClientRect(); const e = document.elementFromPoint(r.left + Math.min(24, r.width / 2), r.top + r.height / 2); if (!e) return false; for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) e.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.top + r.height / 2, view: window })); return true; }],
      ['innerstatus', () => { const t = [...el0.querySelectorAll('*')].find(x => /^선택해제됨$/.test(textOf(x))); if (!t) return false; fire(t); t.click && t.click(); return true; }],
    ];
    const tried = [];
    for (const [name, go] of strategies) {
      let did = false; try { did = go(); } catch (e) { tried.push(name + ':err'); continue; }
      if (!did) { tried.push(name + ':n/a'); continue; }
      const st = await verify();
      if (st) {
        // some sheets need a confirm button after ticking
        await sleep(150);
        const confirm = findByText(t => /^(저장|완료|확인)$/.test(t.replace(/\s+/g, '')), document, 'button,a,[role="button"]').filter(b => b.getBoundingClientRect().top > el0.getBoundingClientRect().top);
        if (confirm.length) { fire(confirm[0]); try { confirm[0].click(); } catch {} await sleep(600); }
        return { ok: true, status: 'saved', note: 'via ' + name + (confirm.length ? '+confirm' : '') + ' count ' + before.count + '→' + st.count };
      }
      tried.push(name + ':no');
    }
    const e2 = pick();
    return { ok: false, status: 'notchecked', note: 'tried=' + tried.join(',') + ' ; after=' + (e2 ? lines(e2).join('/') : 'gone') + ' ; html=' + html(el0) + ' ; sheet=' + sheetButtons() };
  }

  const handlers = { ping: async () => ({ ok: true, href: location.href }), listResults: cmdListResults, clickResult: cmdClickResult, checkAddress: cmdCheckAddress, clickSave: cmdClickSave, chooseList: cmdChooseList };

  // child frames: answer postMessage commands from the top frame
  if (!IS_TOP) {
    window.addEventListener('message', async ev => {
      const d = ev.data; if (!d || d.type !== 'nmi-cmd') return;
      let res; try { res = await (handlers[d.cmd] || (async () => ({ ok: false, status: 'badcmd' })))(d.args || {}); }
      catch (e) { res = { ok: false, status: 'error', note: String(e) }; }
      window.parent.postMessage({ type: 'nmi-res', id: d.id, res }, '*');
    });
    return;
  }

  // ---------- top frame: orchestrator ----------
  let seq = 0; const pending = new Map();
  window.addEventListener('message', ev => { const d = ev.data; if (d && d.type === 'nmi-res' && pending.has(d.id)) { pending.get(d.id)(d.res); pending.delete(d.id); } });
  function ask(frameWin, cmd, args, timeout = 15000) {
    return new Promise(resolve => {
      const id = ++seq; pending.set(id, resolve);
      try { frameWin.postMessage({ type: 'nmi-cmd', id, cmd, args }, '*'); } catch (e) { pending.delete(id); resolve({ ok: false, status: 'postfail', note: String(e) }); return; }
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ ok: false, status: 'timeout:' + cmd }); } }, timeout);
    });
  }
  // --- frame discovery: ping every iframe, classify by the URL it reports ---
  const allFrames = () => [...document.querySelectorAll('iframe')].filter(f => { try { return !!f.contentWindow; } catch { return false; } });
  const captchaShown = () => {
    const big = allFrames().filter(f => /captcha/i.test((f.id || '') + (f.getAttribute('src') || ''))).some(f => { if (!visible(f)) return false; const r = f.getBoundingClientRect(); return r.width > 150 && r.height > 100; });
    const txt = findByText(t => /보안\s*확인|자동\s*입력\s*방지|로봇이\s*아닙니다|자동등록방지/.test(t), document, 'div,p,span,h1,h2,h3,strong,label').length > 0;
    return big || txt;
  };
  const frameInfo = () => allFrames().map(f => (f.id || f.name || '?') + ':' + (f.getAttribute('src') || '').slice(0, 80)).join(' , ');
  async function discover(ms = 15000, want = null) {
    // returns {search: win|null, entry: win|null, raw:[{win,href}]}
    const t0 = Date.now();
    let last = { search: null, entry: null, raw: [] };
    while (Date.now() - t0 < ms) {
      const raw = [];
      for (const f of allFrames()) {
        const w = f.contentWindow; const r = await ask(w, 'ping', {}, 1200);
        if (r && r.ok) raw.push({ win: w, href: r.href || '', id: f.id || f.name || '' });
      }
      const isSearch = x => /\/list\b|[?&]query=|\/search\b/.test(x.href) || /search/i.test(x.id);
      const search = raw.find(isSearch) || null;
      const entry = raw.find(x => !isSearch(x) && /place\.naver\.com|\/place\/|\/restaurant\/|\/cafe\/|\/hairshop\/|\/hospital\/|\/accommodation\/|\/\d{5,}\b/.test(x.href)) || raw.find(x => !isSearch(x) && /entry/i.test(x.id)) || null;
      last = { search: search && search.win, entry: entry && entry.win, raw };
      if (want === 'search' && last.search) return last;
      if (want === 'entry' && last.entry) return last;
      if (!want && (last.search || last.entry)) return last;
      await sleep(500);
    }
    return last;
  }
  const queriesOf = it => (it.queries && it.queries.length) ? it.queries : [it.query];
  const queryFor = (it, attempt) => { const qs = queriesOf(it); return qs[Math.min(attempt, qs.length - 1)]; };
  const searchUrl = (it, attempt = 0) => {
    const q = encodeURIComponent(queryFor(it, attempt));
    const c = (it.lat != null && it.lng != null) ? `?c=${it.lng},${it.lat},16,0,0,0,dh` : '';
    return `https://map.naver.com/p/search/${q}${c}`;
  };

  const panel = (t, o) => nmiBanner(t, o);

  async function finishItem(state, res) {
    const retryable = !res.ok && /^(noresults|nomatch|nosearchframe|noentryframe|wrongplace)$/.test(res.status || '');
    const qs = queriesOf(state.items[state.idx]); const at = state.attempt || 0;
    if (retryable && at < qs.length - 1) {
      state.attempt = at + 1; state.navIdx = -1; state.retryNote = (state.retryNote ? state.retryNote + ',' : '') + res.status;
      await chrome.storage.local.set({ nmi: state });
      return;
    }
    if (state.retryNote) res.note = ('tries=' + state.retryNote + ' ' + (res.note || '')).trim();
    if (res.ok && at > 0) res.note = ('q#' + (at + 1) + '「' + queryFor(state.items[state.idx], at) + '」 ' + (res.note || '')).trim();
    state.results[state.idx] = res;
    state.idx += 1; state.attempt = 0; state.retryNote = '';
    await chrome.storage.local.set({ nmi: state });
  }

  async function run() {
    const { nmi: state } = await chrome.storage.local.get('nmi');
    if (!state || !state.running) return;
    if (state.phase === 'enrich') { panel('Step 1 in progress: fetching Korean names in the Google Maps tab…'); return; }
    if (state.idx >= state.items.length) { state.running = false; await chrome.storage.local.set({ nmi: state }); panel(`Done: ${state.items.length} places processed. Open the extension popup for results.`); return; }
    const it = state.items[state.idx];
    if (it.skip) { // e.g. permanently closed according to Google
      state.results[state.idx] = { ok: true, status: 'skipped', note: it.skip }; state.idx += 1; state.attempt = 0; state.retryNote = ''; state.navIdx = -1;
      await chrome.storage.local.set({ nmi: state }); return next();
    }
    const attempt = state.attempt || 0;
    const url = searchUrl(it, attempt);
    // navigate exactly once per item; never judge by the URL (NAVER rewrites it)
    if (state.navIdx !== state.idx) { state.navIdx = state.idx; await chrome.storage.local.set({ nmi: state }); location.href = url; return; }
    panel(`[${state.idx + 1}/${state.items.length}] ${it.name}\nSearching… “${queryFor(it, attempt)}”`);

    // 1) search frame → rank candidates; 2) open each candidate (best first) until its address matches
    let res, picked = '', ad = null, ew = null;
    const d1 = await discover(15000);
    if (d1.search) {
      const names = [queryFor(it, attempt), it.query, it.ko || '', it.name].filter(Boolean);
      res = await ask(d1.search, 'listResults', { names }, 14000);
      if (!res.ok && res.status === 'noresults') { const d1b = await discover(6000, 'entry'); if (d1b.entry) res = { ok: true, status: 'direct' }; }
      if (!res.ok) return finishItem(state, res).then(next);
      if (res.status !== 'direct') {
        const expGu = it.gu || [];
        let cands = res.results.filter(c => !(expGu.length && c.gu && !expGu.includes(c.gu))); // drop other districts when the list shows one
        const strong = cands.filter(c => c.sc >= 0.3).sort((a, b) => b.sc - a.sc || a.i - b.i);
        const weak = cands.filter(c => c.sc < 0.3); // name didn't match (English vs Hangul etc.): only acceptable with a street-level address match
        cands = strong.concat(weak).slice(0, 5);
        if (!cands.length) return finishItem(state, { ok: false, status: 'nomatch', note: 'results=' + res.results.slice(0, 6).map(c => c.title + (c.gu ? '(' + c.gu + ')' : '') + ' ' + c.sc).join(' / ') }).then(next);
        const tried = []; let prevAddr = '';
        for (const c of cands) {
          panel(`[${state.idx + 1}/${state.items.length}] ${it.name}\nChecking “${c.title}”…`);
          const ck = await ask(d1.search, 'clickResult', { i: c.i }, 5000);
          if (!ck.ok) { tried.push(c.title + ':noclick'); continue; }
          await sleep(300);
          const d2 = await discover(12000, 'entry');
          if (!d2.entry) { tried.push(c.title + ':noentry'); continue; }
          ew = d2.entry;
          const a = await ask(ew, 'checkAddress', { gu: expGu, addrKey: it.addrKey || '', expectTitle: c.title, prevAddr }, 12000);
          prevAddr = a.addr || prevAddr;
          const accept = a.ok && (c.sc >= 0.3 || a.status === 'addr-strong' || (!it.addrKey && a.status === 'addr-gu' && c.sc >= 0.15));
          if (accept) { ad = a; picked = c.title; break; }
          tried.push(c.title + ':' + (a.status || 'noaddr') + (a.addr ? '(' + a.addr.split('\n')[0] + ')' : ''));
        }
        if (!ad) return finishItem(state, { ok: false, status: 'wrongplace', note: 'tried=' + tried.join(' / ') }).then(next);
      }
    } else if (d1.entry) {
      res = { ok: true, status: 'direct' }; // single result opened directly
    } else {
      if (captchaShown()) return pauseForCaptcha(state);
      return finishItem(state, { ok: false, status: 'nosearchframe', note: 'frames=[' + frameInfo() + '] ' + snapshot() }).then(next);
    }
    if (res.status === 'direct') {
      panel(`[${state.idx + 1}/${state.items.length}] ${it.name}\nChecking the address…`);
      const d2 = await discover(15000, 'entry');
      if (!d2.entry) { if (captchaShown()) return pauseForCaptcha(state); return finishItem(state, { ok: false, status: 'noentryframe', note: 'frames=[' + frameInfo() + '] ' + snapshot() }).then(next); }
      ew = d2.entry;
      ad = await ask(ew, 'checkAddress', { gu: it.gu || [], addrKey: it.addrKey || '' }, 9000);
      if (!ad.ok) return finishItem(state, { ok: false, status: 'wrongplace', note: ad.note || '' }).then(next);
    }

    // 3) ★ save
    panel(`[${state.idx + 1}/${state.items.length}] ${it.name}\nLooking for the save button…`);
    const s = await ask(ew, 'clickSave', {}, 16000);
    if (!s.ok) return finishItem(state, { ...s, picked }).then(next);
    if (s.status === 'already') return finishItem(state, { ok: true, status: 'already', picked }).then(next);

    // 3) choose list — the sheet may render inside the entry frame or in this top frame
    panel(`[${state.idx + 1}/${state.items.length}] ${it.name}\nSaving to list “${state.list}”…`);
    const c = await ask(ew, 'chooseList', { list: state.list }, 12000);
    return finishItem(state, { ...c, picked, note: ((c.note || '') + ' [' + (ad.status || '') + '] ' + (ad.addr || '')).trim() }).then(next);
  }
  async function pauseForCaptcha(state) {
    state.running = false; state.navIdx = -1; // redo this item after resume
    await chrome.storage.local.set({ nmi: state });
    panel(`NAVER is showing a CAPTCHA.\nSolve it on this page, then press “Resume” in the extension popup.\n(Will retry from place ${state.idx + 1}.)`);
  }
  async function next() {
    const { nmi: state } = await chrome.storage.local.get('nmi');
    if (!state || !state.running) { panel('Paused'); return; }
    if (state.navIdx === -1 && (state.attempt || 0) > 0) { await sleep(300); state.navIdx = state.idx; await chrome.storage.local.set({ nmi: state }); location.href = searchUrl(state.items[state.idx], state.attempt); return; }
    const base = (state.delay == null ? 0.5 : state.delay) * 1000; if (base > 0) await sleep(base * (0.8 + Math.random() * 0.4));
    if (state.idx >= state.items.length) return run();
    state.navIdx = state.idx; await chrome.storage.local.set({ nmi: state });
    location.href = searchUrl(state.items[state.idx], 0);
  }
  // kick off after the app has had a moment to mount
  setTimeout(() => run().catch(e => panel('Error: ' + e)), 500);
})();
