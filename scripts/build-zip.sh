#!/usr/bin/env bash
# Builds dist/naver-map-importer-v<version>.zip containing only the files Chrome needs.
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p "require('./manifest.json').version")
NAME="naver-map-importer-v${VER}"
rm -rf dist/"$NAME" && mkdir -p dist/"$NAME"
cp manifest.json popup.html popup.js csv.js gmlist.js gmaps.js content.js banner.js LICENSE README.md README.en.md dist/"$NAME"/
mkdir -p dist/"$NAME"/icons && cp icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png dist/"$NAME"/icons/
(cd dist && rm -f "$NAME.zip" && zip -rq "$NAME.zip" "$NAME")
rm -rf dist/"$NAME"
echo "dist/$NAME.zip"
