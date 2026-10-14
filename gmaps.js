// NAVER Map List Importer — Google Maps enrichment content script.
// Phase "enrich": for each CSV row that only has a Google Maps URL (Takeout export),
// open the place page in Korean (hl=ko) and read the Korean name, address and coordinates.
// Then hand over to the NAVER phase (content.js).

(() => {
  if (window !== window.top) return;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const get = async () => (await chrome.storage.local.get('nmi')).nmi;
  const set = s => chrome.storage.local.set({ nmi: s });

  const panel = (t, o) => nmiBanner(t, o);
  // "대한민국 서울특별시 종로구 삼일대로17길 ..." -> ["종로구"]; "부산광역시 해운대구 ..." -> ["해운대구"]; fallback: city/county token
  function guOf(addr) {
    const a = (addr || '').replace(/^대한민국\s*/, '');
    const m = a.match(/(?:^|\s)([가-힣]+구)(?=\s|$)/); if (m) return [m[1]];
    const m2 = a.match(/^\S+\s+([가-힣]+[시군])(?=\s|$)/); if (m2) return [m2[1]];
    return [];
  }
  const koUrl = u => u + (u.includes('?') ? '&' : '?') + 'hl=ko';
  const needs = it => !!it.gurl && !it.ko && !it.enriched;
  const cidOf = u => ((u || '').match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/) || [])[1] || '';

  // Fast path: the JSON endpoint Google Maps itself calls when it opens a place (no page load, ~0.2 s).
  // d[6] is the place: [11]=localized name, [39]=full address, [9][2..3]=lat/lng, [88][0]="폐쇄됨" when permanently closed, [78]=place ID
  async function fetchPlace(it) {
    const cid = cidOf(it.gurl); if (!cid) return null;
    const pb = '!1m15!1s' + cid + '!2sx!3m12!1m3!1d1000!2d' + (it.lng || 126.98) + '!3d' + (it.lat || 37.58) + '!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1';
    const r = await fetch(location.origin + '/maps/preview/place?authuser=0&hl=ko&gl=kr&pb=' + encodeURIComponent(pb), { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = JSON.parse((await r.text()).replace(/^\)\]\}'\s*/, ''));
    const e = d && d[6]; if (!e || typeof e[11] !== 'string' || !e[11]) return null;
    return { title: e[11], addr: e[39] || (Array.isArray(e[2]) ? e[2].join(' ') : ''), lat: e[9] && e[9][2], lng: e[9] && e[9][3],
      closed: /폐쇄|폐업/.test(String(e[88] && e[88][0] || '')), placeId: typeof e[78] === 'string' ? e[78] : '' };
  }
  function apply(it, r, closed) {
    it.ko = r.title || ''; it.addr = (r.addr || '').replace(/^대한민국\s*/, '');
    if (typeof r.lat === 'number') { it.lat = r.lat; it.lng = r.lng; }
    if (r.placeId) it.placeId = r.placeId;
    it.gu = guOf(it.addr); it.addrKey = addrKeyOf(it.addr);
    it.queries = buildQueries(it.name, it.ko, it.ko2 || '', it.gu[0] || ''); it.query = it.queries[0];
    it.enriched = it.ko ? (closed ? 'closed' : 'ok') : 'notitle';
    if (closed) it.skip = 'permanently closed (Google)';
  }

  async function step() {
    let s = await get();
    if (!s || !s.running || s.phase !== 'enrich') return;
    let items = s.items;

    // 1) fast path for every remaining item (one JSON request each); failures fall through to the page-load path below
    if (!s.apiPassDone) {
      let fails = 0, done = 0;
      for (let k = 0; k < items.length; k++) {
        if (!needs(items[k]) || items[k].apiFail) continue;
        s = await get(); if (!s || !s.running || s.phase !== 'enrich') return; items = s.items;
        panel(`[${k + 1}/${items.length}] ${items[k].name}\nFetching Korean name & address…`);
        try {
          const r = await fetchPlace(items[k]);
          if (r) { apply(items[k], r, r.closed); done++; } else { items[k].apiFail = true; fails++; }
        } catch (e) { items[k].apiFail = true; fails++; if (fails >= 5 && done === 0) break; }
        await set(s);
        await sleep(150 + Math.random() * 150);
      }
      s.apiPassDone = true; await set(s);
    }

    let i = s.eidx || 0;
    while (i < items.length && !needs(items[i])) i++;
    if (i >= items.length) {
      // enrichment done -> NAVER phase
      s.phase = 'save'; s.eidx = i; s.idx = 0; s.navIdx = -1; s.attempt = 0; s.retryNote = '';
      await set(s);
      panel('Korean names fetched. Switching to NAVER Map…');
      await sleep(400);
      location.href = 'https://map.naver.com/p';
      return;
    }
    if (s.enavIdx !== i) { s.eidx = i; s.enavIdx = i; await set(s); location.href = koUrl(items[i].gurl); return; }

    const it = items[i];
    panel(`[${i + 1}/${items.length}] ${it.name}\nFetching Korean name & address from Google Maps…`);
    const t0 = Date.now(); let title = '', addr = '', lat = null, lng = null, closed = false;
    while (Date.now() - t0 < 15000) {
      const t = document.title.replace(/\s*-\s*Google\s*(지도|マップ|Maps)\s*$/, '').trim();
      if (t && !/^Google/.test(t)) title = t;
      const a = document.querySelector('button[data-item-id^="address"]');
      if (a) addr = (a.getAttribute('aria-label') || a.textContent || '').replace(/^주소:\s*/, '').trim();
      const m = location.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (m) { lat = +m[1]; lng = +m[2]; }
      if (title && addr && lat != null) break;
      await sleep(300);
    }
    // permanently closed: Google (ko) shows "영업 종료" / "폐업" as a status badge near the title
    try {
      const h1 = document.querySelector('h1');
      const box = h1 && h1.closest('div[role="main"]') || document.body;
      const st = [...box.querySelectorAll('span')].find(el => /^(영업 종료|폐업|폐업함|임시 휴업)$/.test((el.textContent || '').trim()));
      if (st) closed = /폐업|영업 종료/.test(st.textContent);
    } catch {}

    apply(it, { title, addr, lat, lng }, closed);
    s.eidx = i + 1;
    await set(s);
    await sleep(250);
    step();
  }
  setTimeout(() => step().catch(e => panel('Error: ' + e)), 400);
})();
