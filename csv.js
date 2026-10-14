// Shared CSV parsing (popup + Google Maps content script). Accepts, by header row:
//  - Title,Note,URL,Comment            Google Takeout "Saved" export (any UI language; JP headers also recognised)
//  - name,korean_name,lat,lng,address,district,...   this extension's "Copy enriched CSV" output
//  - name,lat,lng / name,query,lat,lng free form (header row required)
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') {}
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
function toItems(text) {
  const rows = parseCSV(text); if (!rows.length) return [];
  const h = rows[0].map(x => x.trim().toLowerCase());
  const idx = (names) => { for (const n of names) { const i = h.indexOf(n.toLowerCase()); if (i >= 0) return i; } return -1; };
  const iName = idx(['名前','タイトル','name','title']);
  const iKo   = idx(['韓国語名','korean_name','query','korean','ko']);
  const iKo2  = idx(['韓国語名2','query2','ko2']);
  const iLat  = idx(['緯度','lat','latitude']);
  const iLng  = idx(['経度','lng','lon','longitude']);
  const iCat  = idx(['種類','category']);
  const iDist = idx(['地区','district']);
  const iGu   = idx(['区','district','gu']);
  const iAddr = idx(['住所','address','addr']);
  const iUrl  = idx(['url','google_maps_url','googleマップurl','google maps url','link']);
  const iMemo = idx(['メモ','note','notes']);
  if (iName < 0) return [];
  const items = [];
  for (const r of rows.slice(1)) {
    const name = (r[iName] || '').trim(); if (!name) continue;
    const cat = iCat >= 0 ? (r[iCat] || '').trim() : '';
    if (/^(閉業|closed|permanently closed)$/i.test(cat)) continue; // skip permanently closed
    const ko = iKo >= 0 ? (r[iKo] || '').trim() : '';
    const urlRaw = iUrl >= 0 ? (r[iUrl] || '').trim() : '';
    const gurl = /google\.[a-z.]+\/maps/.test(urlRaw) ? urlRaw : '';
    const memo = iMemo >= 0 ? (r[iMemo] || '').trim() : '';
    const lat = iLat >= 0 ? parseFloat(r[iLat]) : NaN;
    const lng = iLng >= 0 ? parseFloat(r[iLng]) : NaN;
    const dist = iDist >= 0 ? (r[iDist] || '').trim() : '';
    const guCol = iGu >= 0 ? (r[iGu] || '').trim() : '';
    const addr = iAddr >= 0 ? (r[iAddr] || '').trim() : '';
    const gu = guCol ? [guCol] : expectedGu(dist);
    const ko2 = iKo2 >= 0 ? (r[iKo2] || '').trim() : '';
    const queries = buildQueries(name, ko, ko2, gu[0] || '');
    items.push({ name, ko, ko2, query: queries[0], queries, lat: isFinite(lat) ? lat : null, lng: isFinite(lng) ? lng : null, gu, addr, addrKey: addrKeyOf(addr), gurl, memo });
  }
  return items;
}
// rows that only carry a Google Maps URL (Takeout export) need the Korean name / address fetched first
const needsEnrich = it => !!it.gurl && !it.ko && !it.enriched;
// export items in this project's CSV format (so a later run can skip the Google step)
function itemsToCSV(items) {
  const q = x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
  const lines = ['name,korean_name,lat,lng,address,district,note,google_maps_url,place_id,status'];
  for (const it of items) lines.push([it.name, it.ko || '', it.lat ?? '', it.lng ?? '', it.addr || '', (it.gu || [])[0] || '', it.memo || '', it.gurl || '', it.placeId || '', it.skip || it.enriched || ''].map(q).join(','));
  return lines.join('\n');
}

// Optional: Japanese district label (e.g. 明洞) -> acceptable Korean 구/city tokens for the address check
function expectedGu(d) {
  if (!d) return [];
  const T = [
    [/鍾路|北村|西村|恵化|大学路/, ['종로구']],
    [/明洞|乙支路|南大門/, ['중구']],
    [/東大門|新堂/, ['중구','종로구','동대문구']],
    [/聖水/, ['성동구']],
    [/漢南|梨泰院|解放村|龍山/, ['용산구']],
    [/狎鴎亭|新沙|清潭/, ['강남구']],
    [/弘大|合井|延南|望遠/, ['마포구']],
    [/延禧|新村/, ['서대문구','마포구']],
    [/汝矣島/, ['영등포구']],
    [/踏十里|新設洞/, ['동대문구','성동구']],
    [/高速ターミナル|江南|三成/, ['서초구','강남구']],
    [/釜山/, ['부산']], [/大田/, ['대전']], [/全州/, ['전주','전북']], [/原州/, ['원주','강원']], [/議政府/, ['의정부']],
  ];
  for (const [re, gu] of T) if (re.test(d)) return gu;
  return [];
}

// Make a name NAVER-search friendly: drop "( ... )" parts; if "A, B", prefer the part with Hangul.
function cleanQuery(n) {
  let q = String(n || '');
  if (q.includes(',')) { const parts = q.split(',').map(x => x.trim()).filter(Boolean); const ko = parts.find(x => /[가-힣]/.test(x)); q = ko || parts[0]; }
  q = q.replace(/\s*[\(（][^)）]*[\)）]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return q || String(n || '');
}
// Road/dong token from an address, e.g. "서울특별시 종로구 율곡로3길 4" -> "율곡로3길"
function addrKeyOf(a) {
  if (!a) return '';
  const toks = a.split(/\s+/);
  const i = toks.findIndex(t => /(구|시|군)$/.test(t));
  for (let k = (i >= 0 ? i + 1 : 0); k < toks.length; k++) { if (/[가-힣]/.test(toks[k]) && /(로|길|동|가)\d*$/.test(toks[k].replace(/\d+$/, '')) ) return toks[k]; if (/(로|길)\d*(번길)?$/.test(toks[k])) return toks[k]; }
  return '';
}

const hasHangul = t => /[가-힣]/.test(t);
// English brand core: drop store-type words and branch words, keep the leading brand token(s)
function brandOf(n) {
  let q = cleanQuery(n).replace(/[^A-Za-z0-9&' ]+/g, ' ');
  q = q.replace(/\b(flagship|store|shop|space|showroom|outlet|main|the hyundai seoul|thehyundai seoul|seoul|hannam|seongsu|sinsa|dosan|hongdae|yeonhui|hapjeong|bukchon|jeonpo|seomyeon|gangnam|shinsegae|yulgokro|central)\b/gi, ' ');
  q = q.replace(/\s+/g, ' ').trim();
  return q.split(' ').slice(0, 2).join(' ');
}
function buildQueries(name, ko, ko2, gu) {
  const out = []; const push = q => { q = (q || '').replace(/\s+/g, ' ').trim(); if (q && !out.includes(q)) out.push(q); };
  const a = cleanQuery(ko || ''), b = cleanQuery(ko2 || ''), n = cleanQuery(name);
  if (a && hasHangul(a)) { if (gu) push(gu + ' ' + a); push(a); }
  if (b && hasHangul(b)) { if (gu) push(gu + ' ' + b); push(b); }
  if (a && !hasHangul(a)) { if (gu) push(gu + ' ' + a); push(a); }
  const br = brandOf(n);
  if (br && br.length >= 3) { if (gu) push(gu + ' ' + br); push(br); }
  if (!out.length) push(n);
  return out;
}
