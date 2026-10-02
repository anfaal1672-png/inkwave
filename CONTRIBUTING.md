<p align="right"><b>日本語</b> · <a href="CONTRIBUTING.en.md">English</a></p>

# INKWAVE の開発に参加する

興味を持ってくれてありがとうございます。INKWAVE は素の ES モジュールで書いた three.js のプロジェクトで、開発時にビルドは要りません。すぐに始められます。

## ローカルで動かす

```bash
git clone https://github.com/jaydendavisnc/inkwave.git
cd inkwave
npm install          # ヘッドレスのツール（puppeteer-core）を使うときだけ必要
npm start            # http://localhost:8490 で配信（LAN のアドレスでも開けます）
```

Chrome、Edge、Firefox で URL を開いてください。再読み込みすれば変更が反映されます。バンドラーは本番ビルド（`npm run build`）のときだけ使います。

## Pull Request を出す前に

```bash
npm run check        # 全モジュールに node --check を実行（modulepreload の一覧が古くないかも確認）
npm run i18n         # 翻訳のチェック（全項目に日本語があり、{プレースホルダー} が一致しているか）
npm run smoke        # ヘッドレスで起動し、8 秒間オートパイロットで遊ぶ（Chrome / Chromium が必要）
npm run smoke:mobile # 同じことを横向きのスマホ模擬で（タッチ、DPR 3、CPU 4 倍遅延、Fast 4G）
npm run test:touch   # タッチ操作だけで、タイトル → 試合（全ボタン）→ 結果まで進める
```

- ヘッドレスのツールは、OS ごとに Chrome / Chromium を探します（`tools/browser.mjs`）。別のブラウザを使うときは `CHROME_PATH` を指定してください。
- smoke は、:8490 で何も動いていなければ開発サーバーを自分で起動します。
- GPU のない Linux では WebGL をソフトウェア（SwiftShader）で描画します。そのため smoke は low 画質で実行し、数分かかります。

## 計測

ロード時間やフレームの負荷に関わる変更では、変更の前後を次のツールで計測してください。

```bash
npm run measure -- --profile desktop --runs 3            # --profile mobile、--cache warm、--settings '{"quality":"low"}' なども可
npm run bench                                             # 1 フレームの CPU 時間（スマホ模擬、low）とその内訳
npm run memory                                            # 試合を 6 回続けたときのメモリ（GPU・canvas・JS）
node tools/profile-boot.mjs --profile mobile --shaders    # 起動中の CPU プロファイルと、シェーダーごとのコンパイル時間
```

- `npm run measure` は、転送量（そのまま / brotli 後）、ロード画面の段階ごとの時間、試合中 10 秒間の fps・1% low・描画コール数を JSON で出力します。これまでの計測値は [docs/PERF_BASELINE.md](docs/PERF_BASELINE.md) にあります。
- `npm run bench` は、1 フレームの更新処理（試合、ボット、物理、ペイント、エフェクト、HUD、ミニマップ）を、30fps の固定ステップで描画なしで回し、プロファイルを取ります（`--render` を付けると描画も含めます）。ソフトウェア描画では fps は当てになりませんが、この CPU 時間は比べられます。
  - 試合の展開で ±20% ほどぶれます。2 つの版を比べるときは、`--seed 7`（乱数を固定）と `--settle 15`（最初の 15 秒をふつうに動かして、効果音・BGM の録音を済ませる）を付け、種を変えて何回か回してください。
- `npm run memory` は、タイトルのあと 3 ステージを昼・夕方で 1 回ずつ遊び、そのたびに GPU のメモリ（テクスチャ・レンダーバッファ・バッファ）、canvas、JS ヒープ、three.js のテクスチャ・ジオメトリ・プログラム数を表にします。試合を重ねても増え続ける値があれば、解放漏れです。
- ソフトウェア描画での fps は、同じ環境での比較にだけ使ってください。実機の値とは比べられません。

## 本番ビルド

```bash
npm run build        # → dist/：minify した JS を動的 import ごとに分割、ハッシュ付きファイル名、Service Worker
npm run smoke:dist   # dist/ に対して smoke を実行（:8492 で配信）
```

- 開発にビルドは要りません。`npm start` はソースをそのまま配信します。
- `tools/build.mjs` は次のことを行います。
  - esbuild でバンドルする。
  - 焼き込んだライトマップを WebP にする（`tools/lightmaps-webp.py`、Pillow が必要）。
  - `sw.js` を書き出す（2 回目以降の訪問とオフラインでの起動はキャッシュから）。
  - Cloudflare Pages 用の `_headers` を書き出す。
- ステージのスクリーンショットを撮り直したら、`python3 tools/stage-variants.py` でステージ選択用の 1280px 版を作り直してください。
- 起動時に読むモジュールを増やしたら、`node tools/gen-preload.mjs` で開発用の先読み一覧を更新してください（古いと `npm run check` が知らせます）。

Pull Request は目的を 1 つに絞ってください。ゲームバランスや操作感を変えるときは、何をどう計測したかを書いてください（再現できる記録には `tools/measure-handling.mjs` と `tools/film.py` が使えます）。

## UI の文字列と翻訳

- UI は日本語が初期設定で、「設定 → ゲームプレイ → 言語」で英語に切り替えられます。
- UI の文字列は英語で書き、`src/i18n/index.js` の `tr()` で囲みます（データの表で定義する文字列は `N_()`）。そのうえで、日本語を `src/i18n/ja.js` に追加してください。
- 英語の文字列がそのままキーになります。訳がないものは英語で表示されます。
- 用語はスプラトゥーンの公式用語（ナワバリバトル、ブキ、スペシャル、スーパージャンプ など）に合わせます。一覧は [docs/MASTER_PROMPT.md](docs/MASTER_PROMPT.md) の Phase 1 の用語集にあります。

```bash
node tools/i18n-check.mjs                  # 全キーに日本語があり、{プレースホルダー} が一致しているか
node tools/i18n-audit.mjs --shots out/ja   # 全画面と HUD の状態を描画し、英語の取り残しを探してスクリーンショットを保存
python3 tools/subset-fonts.py              # 新しい漢字を使ったら、日本語フォントのサブセットを作り直す
node tools/ui-shots.mjs out/phone          # 全メニュー画面を iPhone 横向き（切り欠きの余白つき）で撮影して、重なりや見切れを確認
```

## プロジェクトの構成

| パス | 中身 |
|---|---|
| `src/core` | レンダラーとポストエフェクト、入力（タッチ操作を含む）、イベントバス |
| `src/game` | キャラクター、ブキ、ボット、カメラ、キャラクターのリグとアニメーション、試合の流れ |
| `src/world` | ステージのレイアウト、地形、インクの塗り、テクスチャ、環境、小物 |
| `src/fx` | パーティクル、画面エフェクト、イベントとエフェクトのつなぎ |
| `src/ui` | メニュー、HUD、マップのジオラマ、アイコン |
| `src/i18n` | 翻訳（`tr()`、日本語の辞書） |
| `src/audio` | 手続き生成の効果音と音楽 |
| `docs` | イベントとモジュールの取り決め、リグの資料、計測結果、既知の問題 |
| `tools` | 開発サーバー、ラボ、ヘッドレスの撮影・計測スクリプト、ビルド、リリース |

## コードの書き方

- まわりのコードに合わせてください：インデントは 2 スペース、シングルクォート、セミコロンあり、コメントは「なぜ」を説明する。
- 毎フレーム実行される処理では、オブジェクトを新しく作らないでください。
- フレームの途中で `innerWidth` などのレイアウトを読むプロパティは使わず、`src/core/ctx.js` の `VIEW` を使ってください（同期レイアウトを防ぐため）。
- 画面の端に置く要素は、`--sal` / `--sar` / `--sab`（iPhone の切り欠きやホームバーの余白）を足して配置してください。
- 新しいステージは、両チーム側が同じ形になるようにしてください（レイアウトは 180° 回転で複製されます）。

## 不具合の報告

Issue に、ブラウザと GPU（スマホの場合は機種）、ステージ、再現手順を書いてください。スクリーンショットや短い動画があると助かります。
