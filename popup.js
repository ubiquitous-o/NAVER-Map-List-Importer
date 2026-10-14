const $ = id => document.getElementById(id);
let items = [];
if (new URLSearchParams(location.search).get('tab')) document.body.classList.add('tab');
$('opentab').addEventListener('click', e => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1') }); });
// keep the form across popup open/close (a Chrome popup is destroyed every time it loses focus)
const DRAFT_KEYS = ['share', 'csv', 'list', 'delay'];
let draftTimer;
function saveDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(() => { const d = {}; DRAFT_KEYS.forEach(k => d[k] = $(k).value); chrome.storage.local.set({ nmiDraft: d }); }, 150); }
DRAFT_KEYS.forEach(k => { $(k).addEventListener('input', saveDraft); $(k).addEventListener('change', saveDraft); });
async function restoreDraft() {
  const { nmiDraft } = await chrome.storage.local.get('nmiDraft'); if (!nmiDraft) return;
  DRAFT_KEYS.forEach(k => { if (nmiDraft[k] != null && nmiDraft[k] !== '') $(k).value = nmiDraft[k]; });
  parseNow();
}
function render(state) {
  const s = state || {};
  const res = s.results || [];
  // skipped (closed on Google) and already (was in the list before) are not new saves: count them apart so the
  // saved number matches what NAVER shows
  const by = st => res.filter(r => r && r.status === st).length;
  const skipped = by('skipped'), already = by('already'), ng = res.filter(r => r && !r.ok).length;
  const saved = res.filter(r => r && r.ok).length - skipped - already;
  const total = (s.items || []).length;
  const b = $('banner');
  if (total && s.running) { b.className = 'banner show'; b.textContent = `A job is running: ${total} places → list “${s.list}”. Closing this popup does not stop it. Use Pause to stop.`; }
  else if (total) { b.className = 'banner show'; b.textContent = `Job loaded (${total} places → list “${s.list}”), ${s.running ? 'running' : 'stopped'}. Resume continues it; Start begins a new one.`; }
  else b.className = 'banner';
  if (!total) { $('stat').innerHTML = 'Idle'; $('log').innerHTML = ''; return; }
  const mode = s.running ? 'running' : 'stopped';
  if (s.phase === 'enrich') {
    const done = (s.items || []).filter(it => it.enriched).length;
    $('stat').innerHTML = `Step 1 · Fetching Korean names from Google Maps <b>${done}</b> / ${total} · ${mode}`;
    $('log').innerHTML = s.items.map((it, i) => it.enriched ? `<div class="${it.enriched === 'ok' ? 'ok' : 'sk'}">${i + 1}. ${esc(it.name)} → ${esc(it.ko || '(not found)')}${it.skip ? ' ' + esc(it.skip) : ''} ${esc((it.gu || [])[0] || '')}</div>` : '').join('');
  } else {
    $('stat').innerHTML = `Step 2 · Saving to NAVER Map <b>${Math.min(s.idx || 0, total)}</b> / ${total} · saved ${saved}${already ? ' · already ' + already : ''}${skipped ? ' · skipped ' + skipped : ''} · failed ${ng} · ${mode}`;
    $('log').innerHTML = res.map((r, i) => r ? `<div class="${r.ok ? (r.status === 'already' ? 'sk' : 'ok') : (r.status === 'skipped' ? 'sk' : 'ng')}">${i + 1}. ${esc(s.items[i].name)}${s.items[i].ko ? ' / ' + esc(s.items[i].ko) : ''} → ${esc(r.status)}${r.picked ? ' [' + esc(r.picked) + ']' : ''}${r.note ? ' ' + esc(r.note) : ''}</div>` : '').join('');
  }
  $('log').scrollTop = $('log').scrollHeight;
}
function esc(t) { return String(t == null ? '' : t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function parseNow() {
  items = toItems($('csv').value);
  const n = items.filter(needsEnrich).length;
  $('parsed').textContent = items.length + ' places (permanently closed ones skipped)' + (n ? ` · ${n} need Korean names from Google Maps` : '');
}
$('csv').addEventListener('input', parseNow);
$('file').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader(); rd.onload = () => { $('csv').value = rd.result; parseNow(); saveDraft(); }; rd.readAsText(f, 'utf-8');
});
const GMAPS = 'https://www.google.com/maps?hl=ko', NAVER = 'https://map.naver.com/p';
$('load').addEventListener('click', async () => {
  const link = $('share').value.trim(); if (!link) return;
  const info = $('shareinfo'); const btn = $('load'); btn.disabled = true;
  try {
    info.textContent = 'Resolving link…';
    const id = await resolveListId(link);
    info.textContent = 'Fetching list ' + id + '…';
    const { items: li } = await fetchSharedList(id);
    if (!li.length) throw new Error('The list came back empty. Is the list shared (Share → anyone with the link)?');
    $('csv').value = sharedListToCSV(li); parseNow(); saveDraft();
    info.textContent = li.length + ' places loaded from the shared list.';
  } catch (e) { info.textContent = 'Failed: ' + (e && e.message || e); }
  btn.disabled = false;
});
async function openTab(url) {
  const { nmiTab } = await chrome.storage.local.get('nmiTab');
  try { await chrome.tabs.update(nmiTab, { url, active: true }); }
  catch { const tab = await chrome.tabs.create({ url }); await chrome.storage.local.set({ nmiTab: tab.id }); }
}
$('start').addEventListener('click', async () => {
  const { nmi: cur } = await chrome.storage.local.get('nmi');
  if (cur && cur.items && cur.items.length && cur.idx < cur.items.length && !confirm(`A job is already loaded (${cur.items.length} places, ${cur.running ? 'running' : 'stopped'}). Start a NEW job and discard it? (Use Resume to continue the existing one.)`)) return;
  parseNow(); if (!items.length) { alert('Could not read the CSV. Check the header row (Title/URL for Takeout, or Name/Korean name).'); return; }
  const enrich = items.some(needsEnrich);
  const state = { running: true, phase: enrich ? 'enrich' : 'save', eidx: 0, enavIdx: -1, idx: 0, navIdx: -1, attempt: 0, items, results: [],
    list: $('list').value.trim() || 'My list', delay: isNaN(Number($('delay').value)) ? 0.5 : Number($('delay').value), startedAt: Date.now() };
  await chrome.storage.local.set({ nmi: state });
  await chrome.storage.local.remove('nmiTab');
  await openTab(enrich ? GMAPS : NAVER);
  render(state);
});
$('pause').addEventListener('click', async () => { const { nmi } = await chrome.storage.local.get('nmi'); if (nmi) { nmi.running = false; await chrome.storage.local.set({ nmi }); render(nmi); } });
$('resume').addEventListener('click', async () => {
  const { nmi } = await chrome.storage.local.get('nmi'); if (!nmi) return;
  nmi.running = true; nmi.navIdx = -1; nmi.enavIdx = -1; await chrome.storage.local.set({ nmi });
  await openTab(nmi.phase === 'enrich' ? GMAPS : NAVER);
  render(nmi);
});
$('reset').addEventListener('click', async () => { await chrome.storage.local.remove(['nmi', 'nmiTab']); render(null); });
$('copyfail').addEventListener('click', async () => {
  const { nmi } = await chrome.storage.local.get('nmi'); if (!nmi) return;
  const lines = ['name,korean_name,query,status,note'];
  nmi.results.forEach((r, i) => { if (r && !r.ok) lines.push([nmi.items[i].name, nmi.items[i].ko || '', nmi.items[i].query, r.status, (r.note || '').replace(/[\r\n,]/g, ' ')].map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')); });
  await navigator.clipboard.writeText(lines.join('\n'));
});
$('copylog').addEventListener('click', async () => {
  const { nmi } = await chrome.storage.local.get('nmi'); if (!nmi) return;
  await navigator.clipboard.writeText(JSON.stringify({ list: nmi.list, phase: nmi.phase, idx: nmi.idx, results: nmi.results.map((r, i) => ({ name: nmi.items[i].name, ko: nmi.items[i].ko, ...r })) }, null, 1));
});
$('copycsv').addEventListener('click', async () => {
  const { nmi } = await chrome.storage.local.get('nmi'); if (!nmi) return;
  await navigator.clipboard.writeText(itemsToCSV(nmi.items));
});
chrome.storage.onChanged.addListener(ch => { if (ch.nmi) render(ch.nmi.newValue); });
restoreDraft().then(() => chrome.storage.local.get('nmi')).then(({ nmi }) => render(nmi));
