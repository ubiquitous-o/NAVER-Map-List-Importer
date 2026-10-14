# 🇰🇷 NAVER Map List Importer

Google マップに保存したスポットを **NAVER Map の保存リストに自動で移す** Chrome 拡張。

*English version → [README.en.md](README.en.md)*

NAVER Map には CSV/KML の読み込み機能がなく、Google マップ側も店名とリンクしか書き出せない。この拡張がその間を埋める。

1. **ステップ1 – 情報取得。** リストの各スポット（共有リンク or Takeout CSV）について、Google マップに韓国語（`hl=ko`）でスポット情報を問い合わせ、ハングルの店名・韓国語住所・座標・閉業かどうかを読み取る。Google マップのページ自身が使っている JSON エンドポイントを叩くので1件約0.2秒。失敗した件だけスポットページを開く方式にフォールバック。
2. **ステップ2 – 保存。** 各スポットを NAVER Map で検索し、一致する候補を開き、住所（区・通り）を照合して、★保存 → リストにチェック。

すべて自分の Chrome（ログイン済みタブ）の中で動く。ステップ1は100件で1分以内、ステップ2は1件10〜25秒。100件なら30分ほど放置で終わる。

## インストール

1. [Releases](../../releases/latest) から最新の `naver-map-importer-vX.Y.Z.zip` をダウンロードして解凍（clone でも可）
2. `chrome://extensions` を開き **デベロッパーモード** をオン → **パッケージ化されていない拡張機能を読み込む** → 解凍したフォルダを選択
3. 拡張機能をピン留め（任意）

Chrome ウェブストアには出していない。「パッケージ化されていない拡張機能を読み込む」が正規のインストール方法。

Manifest V3 対応の Chromium 系ブラウザ（Edge、Brave、Arc など）でも動く。

## 使い方

1. **Google マップからリストを取り出す** — どちらでも可：
   * **共有リンク（いちばん簡単）。** Google マップで保存リストを開く → **共有** → リンクで共有をオン → **リンクをコピー**。`https://maps.app.goo.gl/…` を拡張機能に貼って **Load**。全スポット（名前・座標・場所ID）が一度に取れる。
   * **Google Takeout。** [Google Takeout](https://takeout.google.com) で「選択をすべて解除」→ **保存済み（Saved）** にチェック（スター付きも欲しければ **マップ（マイプレイス）** も）→ ZIP で書き出して解凍。リストごとに `韓国.csv` のような CSV（`タイトル,メモ,URL,タグ,コメント`）ができる。それを読み込む。
2. **NAVER Map 側の準備。** [map.naver.com](https://map.naver.com) にログインし、保存先のリスト（例：ソウル観光）を作っておく。拡張機能はリストを作らない。
3. **実行。** NAVER Map のリスト名を正確に入力 → **Start**。
   タブが開いて自動で進む。左下のパネルに進行状況が出る。そのタブは触らない。
4. **結果確認。** ポップアップに1件ごとの結果が出る。**Copy failures** で保存できなかった分の CSV、**Copy enriched CSV** でハングル名・住所・座標入りの全件 CSV がコピーできる。後者を保存しておけば、次回はステップ1を飛ばせる。

### ボタン

| ボタン | 動作 |
|---|---|
| Start | CSV を解析してジョブを保存し、作業タブを開く |
| Pause / Resume | 現在の1件が終わったら停止 / 止まったところから再開 |
| Reset | ジョブを消す |
| Copy failures | 保存できなかったスポットと理由の CSV |
| Copy log | JSON ログ全文 |
| Copy enriched CSV | ハングル名・住所・区・座標付きの全件 CSV |
| Open in a tab ↗ | 同じ画面を普通のタブで開く（ポップアップと違って閉じない） |

Chrome のポップアップはフォーカスが外れると閉じるが、入力内容（リンク・CSV・リスト名・待ち時間）は保存されていて開き直せば戻る。実行中のジョブはポップアップを閉じても止まらない。作業タブの上部には実行中を示す緑のバーが出る。

### 結果ステータス

| ステータス | 意味 |
|---|---|
| `saved` | リストに追加した |
| `already` | すでにリストにあった |
| `skipped` | Google 上で「閉業」になっている |
| `noresults` / `nomatch` | 検索語をすべて試しても NAVER に似た候補がなかった |
| `wrongplace` | 一番近い候補の住所が Google の住所と区・通りで一致しない（チェーン店の別支店を防ぐため保存しない） |
| `nolist` | 保存シートにそのリスト名がない。綴りを確認 |
| `notchecked` | リストのチェックが入らなかった。note にシートの HTML が入っている |

## 読める CSV 形式

ヘッダー行で自動判定。

* **Google Takeout** — `Title,Note,URL,Comment`（日本語ヘッダー `タイトル,メモ,URL,…` も可）。`URL` は `google.com/maps/place/...` のリンク。
* **変換済み** — *Copy enriched CSV* の出力：`name,korean_name,lat,lng,address,district,note,google_maps_url,place_id,status`
* **最小** — `name,lat,lng` または `name,query,lat,lng`。`query` は NAVER の検索欄に入れる文字列。

種類/状態が「閉業」の行はスキップ。

## 照合の仕組み

1件ごとに次の順で検索語を試し、住所まで一致した最初のもので確定する。

```
<区> <ハングル名>  →  <ハングル名>  →  <区> <ブランド名>  →  <ブランド名>
```

ブランド名は英語名から store / flagship / 支店名などを除いたもの（例：*Gentle Monster Flagship Store Sinsa* → *Gentle Monster*）。まず検索結果に表示される区が Google の住所と違う候補を除外。残りをバイグラム類似度で採点し（完全一致を、名前を含むだけの長い名前より優先。*동대문디자인플라자* が *공차 동대문디자인플라자점* に勝つ）、良い順に開いて住所を Google の住所と比較する（`종로구` のような区、または `율곡로3길` のような通り名）。名前がまったく一致しない候補（NAVER 側が英語名や別表記で登録している店）も、通り名が一致すれば採用。どれも一致しなければ保存せず `wrongplace` / `nomatch` として記録。

## プライバシーと安全性

* 動作するのは `map.naver.com`、`*.place.naver.com`、`www.google.<tld>/maps` だけ（共有リンク読み込み時に Google マップのリスト取得エンドポイントへ1リクエスト）。バックグラウンドワーカーなし、外部サーバーなし、計測なし。
* 状態は `chrome.storage.local` にあり、**Reset** で消える。
* 速く回しすぎると NAVER が CAPTCHA を出すことがある。検出したら自動で止まるので、タブで解いてから **Resume**。1件あたり 0.5〜1 秒の待ちで問題なかった。

## ファイル構成

```
manifest.json   MV3 マニフェスト
popup.html/js   UI、ジョブ制御、CSV の入出力
csv.js          CSV 解析、検索語生成、住所ヘルパー（共通）
gmlist.js       共有リンク → スポット一覧（短縮リンクを解決し、Google マップ自身が使うリスト取得エンドポイントを呼ぶ）
gmaps.js        ステップ1 – google.com/maps 用コンテンツスクリプト
content.js      ステップ2 – map.naver.com 用コンテンツスクリプト（トップフレームが指揮、iframe は postMessage で応答）
banner.js       作業タブ上部のステータスバー
icons/          拡張機能アイコン：🇰🇷 絵文字（Noto Color Emoji）を PNG にしたもの
```

NAVER Map は検索結果とスポットページを `pcmap.place.naver.com` の iframe で描画する。トップフレームは全 iframe に `postMessage` で ping して役割を判定し、UI 要素はクラス名ではなく表示テキスト（저장、저장됨、선택됨、새 리스트 만들기 …）で探すので、細かいマークアップ変更に強い。

## 開発

ビルド不要。ファイルを編集して `chrome://extensions` の再読み込みボタンを押す。実行中なら、そのあと **Resume** を押せば続きから動く（ジョブ状態は再読み込みでも残る）。

### リリース

1. `manifest.json` の `version` を上げる
2. コミットしてタグを打って push：`git tag v2.0.1 && git push origin main --tags`
3. GitHub Actions（`.github/workflows/release.yml`）が `scripts/build-zip.sh` で `dist/naver-map-importer-v2.0.1.zip` を作り、Release に添付して公開する。タグと manifest のバージョンが違うと失敗する

`bash scripts/build-zip.sh` で同じ zip をローカルでも作れる。

## ライセンス

MIT — [LICENSE](LICENSE) を参照。
