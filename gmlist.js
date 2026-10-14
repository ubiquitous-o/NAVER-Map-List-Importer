// Google Maps shared list -> items. Uses the same endpoint Google Maps itself calls when it renders a shared
// list page (maps/preview/entitylist/getlist). The list ID comes from the share link:
//   https://maps.app.goo.gl/XXXX  -> redirects to .../maps/@/data=!4m3!11m2!2s<ID>!3e3
//   https://www.google.com/maps/placelists/list/<ID>
function listIdFromUrl(u) {
  const m = String(u || '').match(/placelists\/list\/([A-Za-z0-9_-]{10,})/) || String(u || '').match(/!2s([A-Za-z0-9_-]{10,})!3e/);
  return m ? m[1] : '';
}
const isShortLink = u => /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps)\//.test(String(u || '').trim());
// Resolve a short link by letting a tab follow the redirect (works for every Google country domain).
async function resolveListId(url) {
  let id = listIdFromUrl(url); if (id) return id;
  if (!isShortLink(url)) throw new Error('Not a Google Maps list link');
  const full = /^https?:/.test(url) ? url : 'https://' + url;
  const tab = await chrome.tabs.create({ url: full, active: false }); // a throw-away background tab
  try {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 400));
      const t = await chrome.tabs.get(tab.id); id = listIdFromUrl(t.url || t.pendingUrl || '');
      if (id) return id;
    }
    throw new Error('Could not resolve the short link (is it a shared list?)');
  } finally { try { await chrome.tabs.remove(tab.id); } catch {} }
}
const toHex = s => '0x' + BigInt.asUintN(64, BigInt(s)).toString(16);
async function fetchSharedList(id) {
  const pb = '!1m4!1s' + id + '!2e1!3m1!1e1!2e2!3e2!4i500';
  const url = 'https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&pb=' + encodeURIComponent(pb);
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error('getlist HTTP ' + r.status);
  const txt = (await r.text()).replace(/^\)\]\}'\s*/, '');
  const data = JSON.parse(txt);
  const items = [];
  const seen = new Set();
  // walk every array; a place entry looks like [null, [null,null,"",null,<address>,[null,null,lat,lng],[idA,idB],"/g/..."], <name>, <note>, ...]
  (function walk(n) {
    if (!Array.isArray(n)) return;
    const p = n[1];
    if (Array.isArray(p) && Array.isArray(p[5]) && typeof p[5][2] === 'number' && typeof p[5][3] === 'number' && Array.isArray(p[6]) && typeof p[6][0] === 'string' && typeof n[2] === 'string' && n[2]) {
      const cid = toHex(p[6][0]) + ':' + toHex(p[6][1]);
      if (!seen.has(cid)) {
        seen.add(cid);
        items.push({ name: n[2], note: typeof n[3] === 'string' ? n[3] : '', address: p[4] || '', lat: p[5][2], lng: p[5][3], cid,
          url: 'https://www.google.com/maps/place/' + encodeURIComponent(n[2]) + '/data=!4m2!3m1!1s' + cid });
      }
      return;
    }
    for (const c of n) walk(c);
  })(data);
  return { items };
}
// Takeout-compatible CSV so the rest of the pipeline is unchanged
function sharedListToCSV(items) {
  const q = x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
  return ['Title,Note,URL,Comment,Latitude,Longitude'].concat(items.map(it => [it.name, it.note, it.url, '', it.lat, it.lng].map(q).join(','))).join('\n');
}
