# 🇰🇷 NAVER Map List Importer

Chrome extension that moves your **Google Maps saved places into a NAVER Map saved list** — no manual searching.

NAVER Map has no CSV/KML import, and Google Maps only exports a list of names and links. This extension closes that gap:

1. **Step 1 – Enrich.** For every place in your list (from a shared link or a Takeout CSV) it asks Google Maps for the place in Korean (`hl=ko`) and reads the Korean place name, the Korean address, the coordinates and whether the place is permanently closed. This uses the same JSON endpoint the Google Maps page itself calls, about 0.2 s per place; if that fails it falls back to opening the place page.
2. **Step 2 – Save.** For every place it searches NAVER Map, picks the matching result, verifies the address (district + street), presses ★ Save and ticks your list.

Everything runs inside your own logged‑in Chrome tab. Step 1 takes well under a minute for 100 places; step 2 takes 10–25 s per place, so a list of 100 places finishes in about half an hour, unattended.

*日本語版 → [README.md](README.md)*

## Install

1. Download the latest `naver-map-importer-vX.Y.Z.zip` from the [Releases](../../releases/latest) page and unzip it. (Or clone this repository.)
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the unzipped folder.
3. Pin the extension (optional).

The extension is not on the Chrome Web Store; "Load unpacked" is the intended way to install it.

Works in Chrome and other Chromium browsers (Edge, Brave, Arc) that support Manifest V3.

## Usage

1. **Get your list out of Google Maps** — either way works:
   * **Shared list link (easiest).** In Google Maps open the saved list → **Share** → make it shareable → **Copy link**. Paste the `https://maps.app.goo.gl/…` link into the extension and press **Load**. All places (name, coordinates, place ID) are fetched in one go.
   * **Google Takeout.** Go to [Google Takeout](https://takeout.google.com), deselect all, tick **Saved** (and **Maps (your places)** for starred places), export as ZIP, unzip. Each list becomes a CSV like `Korea.csv` with columns `Title,Note,URL,Comment`. Load that CSV.
2. **Prepare NAVER Map.** Log in at [map.naver.com](https://map.naver.com) and create the list you want to fill (e.g. *Seoul*). The extension does not create lists.
3. **Run.** Type the list name exactly as it appears in NAVER Map and press **Start**.
   A tab opens and works through the places on its own. A status panel in the bottom‑left corner shows progress. Don't click inside that tab.
4. **Check the result.** The popup shows per‑place results. **Copy failures** gives you a CSV of what could not be saved; **Copy enriched CSV** gives you the full list with Korean names, addresses and coordinates, so a second run can skip step 1.

### Buttons

| Button | What it does |
|---|---|
| Start | Parses the CSV, stores the job, opens the working tab |
| Pause / Resume | Stops after the current place / continues from where it stopped |
| Reset | Clears the stored job |
| Copy failures | CSV of places that were not saved, with the reason |
| Copy log | Full JSON log |
| Copy enriched CSV | All places with Korean name, address, district, coordinates |
| Open in a tab ↗ | Opens the same panel as a normal tab, which (unlike a popup) stays open |

The popup remembers what you typed (link, CSV, list name, delay) even though Chrome closes it whenever it loses focus, and a running job continues regardless of whether the popup is open. The working tab shows a green bar across the top while the extension is driving it.

### Result statuses

| Status | Meaning |
|---|---|
| `saved` | added to the list |
| `already` | was already in the list |
| `skipped` | Google says the place is permanently closed |
| `noresults` / `nomatch` | NAVER search found nothing similar (all query variants tried) |
| `wrongplace` | the best search result is in a different district / street than Google's address — not saved, to avoid the wrong branch of a chain |
| `addressonly` | the Google pin is a bare street address (e.g. *서울특별시 종로구 삼일대로17길 46*), not a place — left for you, so an unrelated shop at that address is not saved |
| `nolist` | the list name was not found in the save sheet — check the spelling |
| `notchecked` | the list checkbox could not be ticked; the note contains the sheet's HTML for debugging |

## Accepted CSV formats

Detected by the header row.

* **Google Takeout** — `Title,Note,URL,Comment` (Japanese headers `タイトル,メモ,URL,…` are recognised too). The `URL` column must be a `google.com/maps/place/...` link.
* **Enriched** — the output of *Copy enriched CSV*: `name,korean_name,lat,lng,address,district,note,google_maps_url,place_id,status`.
* **Minimal** — `name,lat,lng` or `name,query,lat,lng`. `query` is the string typed into NAVER search.

Rows whose category/status says *closed* are skipped.

## How matching works

For each place the extension tries several search strings in order and stops at the first one that yields a verified hit:

```
<district> <Korean name>   →   <Korean name>   →   <district> <brand>   →   <brand>
```

`brand` is the English name with store/branch words removed (e.g. *Gentle Monster Flagship Store Sinsa* → *Gentle Monster*). When the Korean name mixes Latin and Hangul, its Hangul part alone is tried too (*Åland 에이랜드 가로수길점* → *에이랜드 가로수길점*). Results in a different district than Google's address are dropped first (the result list shows the district). The rest are scored against the name with a bigram similarity (exact match beats a longer name that merely contains it, so *동대문디자인플라자* wins over *공차 동대문디자인플라자점*) and opened best‑first; each one's address is compared with the Google address (district token such as `종로구`, or road token such as `율곡로3길`). Candidates whose name did not match at all (NAVER lists some shops under an English or a different Korean name) are still accepted when the street matches. If nothing matches, the place is reported as `wrongplace`/`nomatch` rather than saved.

## Privacy & safety

* Runs only on `map.naver.com`, `*.place.naver.com` and `www.google.<tld>/maps` (plus one request to Google Maps' list endpoint when you load a shared link). No background service worker, no external servers, no analytics.
* State lives in `chrome.storage.local` and is removed with **Reset**.
* NAVER may show a CAPTCHA if you run very fast. The extension pauses when it detects one; solve it in the tab and press **Resume**. A delay of 0.5–1 s per place has been fine in practice.

## Project layout

```
manifest.json   MV3 manifest
popup.html/js   UI, job control, CSV import/export
csv.js          CSV parsing, query building, address helpers (shared)
gmlist.js       shared-list link → places (resolves the short link, calls Google Maps' own list endpoint)
gmaps.js        step 1 – content script for google.com/maps
content.js      step 2 – content script for map.naver.com (top frame orchestrates, iframes answer via postMessage)
banner.js       the status bar shown at the top of the working tab
icons/          extension icon: the 🇰🇷 emoji (Noto Color Emoji) rendered to PNG
```

NAVER Map renders the search results and the place page in iframes from `pcmap.place.naver.com`. The top frame finds those frames by pinging every iframe with `postMessage`, and all UI elements are located by their visible text (저장, 저장됨, 선택됨, 새 리스트 만들기 …), not by class names, so small markup changes don't break it.

## Development

No build step. Edit the files, then press the reload icon on `chrome://extensions`. If a run is in progress, press **Resume** afterwards — the job state survives a reload.

### Releasing

1. Bump `version` in `manifest.json`.
2. Commit, then tag and push: `git tag v2.0.1 && git push origin main --tags`
3. GitHub Actions (`.github/workflows/release.yml`) builds `dist/naver-map-importer-v2.0.1.zip` with `scripts/build-zip.sh` and publishes a Release with the zip attached. The workflow fails if the tag and the manifest version differ.

`bash scripts/build-zip.sh` builds the same zip locally.

## License

MIT — see [LICENSE](LICENSE).
