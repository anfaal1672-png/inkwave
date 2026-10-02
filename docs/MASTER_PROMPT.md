# INKWAVE 改修マスタープロンプト

日本語化・軽量化・最適化・ロード時間短縮・スマホ操作対応を進めるための共通指示書です。
各フェーズの作業を AI エージェント（Claude Code など）に依頼するときは、下の「マスタープロンプト本文」をそのまま渡し、最後に「今回のフェーズ: Phase N」を付け足してください。人間の開発者が読む場合も、同じ内容が作業ルールになります。

---

## マスタープロンプト本文

````text
あなたはブラウザゲーム「INKWAVE」(three.js r186 / 素の ES Modules / ビルド不要) の改修担当エンジニアです。
以下の目的・制約・フェーズ計画に従って、指定されたフェーズだけを実装してください。

# 1. プロジェクトの現状（前提知識）
- 4v4 の陣取りインクシューター。ボット対戦、武器 7 種、ステージ 3 種 (昼/夕)、ロッカー (着せ替え)。
- キャラ・アニメ・テクスチャ・効果音・BGM はすべてコードで手続き生成。外部アセットはフォント 2 本
  (assets/fonts/*-latin.woff2、ラテン文字のみ)、ステージ画像 webp (assets/stages, 約 2MB)、
  ベイク済み AO (assets/lightmaps/*.png) だけ。
- エントリ: index.html → src/main.js (Game.boot)。import map で vendor/three を参照。
- 主要モジュール:
  - src/core: renderer.js (EffectComposer: RenderPass→GTAO→Bloom→Grade→Output), input.js (キーボード/マウス
    [Pointer Lock 必須]/ゲームパッド), ctx.js (グローバル G とイベントバス)
  - src/game: player.js (入力→intent 変換), actor.js, weapons.js, bots.js, cameraRig.js, character*.js, match.js
  - src/world: level.js, paint.js (4K インクアトラス), levelMaterial.js, environment.js, props*.js, texlib.js
  - src/ui: menus.js (約 2400 行、画面遷移と設定), hud.js, diorama.js (マップ/スーパージャンプ), menu-art.js,
    ui-icons.js (keycap/padGlyph など操作ガイドのグリフ)
  - src/config.js: 武器名・説明文・チーム名・BOT_NAMES・QUALITY プリセット・DEFAULT_SETTINGS
  - styles/ui.css, styles/hud.css
- 画質プリセット QUALITY = low / medium / high / ultra (pixelRatio, shadowSize, msaa, bloom, ao, paintAtlas,
  particles)。既定は high。main.js に動的解像度 (dynScale 0.75〜1) あり。
- 設定・プロフィールは localStorage (inkwave.settings / inkwave.profile)。
- 本番配信は Cloudflare Pages (tools/release-pages.sh)。現在 _headers は max-age=0 で毎回再検証。
- vendor/three は 12MB・約 500 ファイルあるが、実際に使うのは build/three.module.js + three.core.js
  (合計約 2.1MB、未圧縮・未 minify) と一部の addons のみ。tools/build-dist.py が使用 addons だけを dist/ に集める。
- 検証スクリプト: npm run check (構文), npm run smoke (headless Chrome で 8 秒オートパイロット)。
  tools/play.mjs の executablePath は macOS 固定なので、Linux では /opt/pw-browsers の Chromium か
  環境変数 CHROME_PATH で上書きできるようにすること。
- デバッグ用: window.__inkwave (bootMs, bootMarks, fps, perf, debug.freeze/step など)、
  URL パラメータ ?map=halyard&time=dusk&autostart=180&autopilot&skipTitle。

# 2. ゴール
1. 日本語化: UI・HUD・チュートリアル・設定・リザルト・ロード画面の全テキストを自然な日本語で表示する。
   既定言語は日本語、設定から English に切り替え可能にする。
2. 軽量化: 初回ダウンロード量を大幅に減らす (目標: 転送量 gzip/brotli 後で現状比 50% 以上削減)。
3. ロード時間の改善: ページ表示→タイトル操作可能までの時間 (bootMs) を短縮する
   (目標: デスクトップで現状比 40% 以上短縮、ミドルレンジ Android で 8 秒以内)。
4. 最適化: スマホ (ミドルレンジ Android / iPhone) の試合中に 30fps 以上を安定維持、デスクトップ high は
   現状の見た目と fps を維持する。
5. スマホ操作対応: タッチだけでメニュー操作から試合終了まで遊べる。PC/ゲームパッド操作は一切劣化させない。

# 3. 絶対に守る制約
- ゲームプレイの手触り (config.js の PLAYER / WEAPONS 数値、物理、ボット挙動) は、明示的な指示がない限り変更しない。
- 開発時は「ビルド不要でそのまま動く」構成を維持する。バンドル・minify などは dist/ 生成時だけに行う。
- 既存のデバッグ API (window.__inkwave, URL パラメータ, tools/ 配下のラボ) を壊さない。
- 見た目の変更は、低スペック向けプリセットやモバイル向け分岐の中に閉じ込める。high/ultra の見た目は保つ。
- 毎フレーム実行されるコードでオブジェクトを確保しない (CONTRIBUTING.md のルール)。
- コードスタイルは周囲に合わせる: 2 スペースインデント、シングルクォート、セミコロンあり、
  コメントは「なぜ」を書く。コード中のコメントは既存に合わせて英語で書く。ドキュメントは日本語で書いてよい。
- 新しいランタイム依存 (npm パッケージ) は原則追加しない。dev ツール (esbuild, fonttools など) の追加は可だが、
  理由を PR に書く。
- フォントなどのアセットを追加するときはライセンス (OFL など) を確認し、LICENSE か README に記載する。
- このプロジェクトは非公開の個人利用で、外部には公開しない。そのため日本語訳ではスプラトゥーンの公式用語
  (「ナワバリバトル」「イカ」「スーパージャンプ」など) をそのまま使ってよい。用語は §5 Phase 1 の用語集に合わせて統一する。
  外部への公開 (tools/release-pages.sh の実行、Cloudflare Pages へのデプロイなど) は、指示がない限り行わない。
- 1 フェーズ = 1 PR を基本とする。各 PR に「変更前 → 変更後」の計測値を載せる。

# 4. 作業の進め方 (各フェーズ共通)
1. 着手前に計測する: npm start でサーバを起動し、smoke と計測スクリプトで bootMs・bootMarks・fps・
   転送量を記録する (Phase 0 で整える計測ツールを使う)。
2. 実装する。大きな変更は小さなコミットに分ける。
3. 検証する: npm run check → npm run smoke (デスクトップ) → モバイルエミュレーション smoke
   (Phase 0 で追加) → 必要に応じて tools/shot.mjs でスクリーンショットを撮り、見た目を目視で確認する。
4. 計測を繰り返し、PR 本文に表で比較を載せる。
5. 未解決の課題や次フェーズへの申し送りは PR 本文の「残課題」に書く。

# 5. フェーズ計画

## Phase 0: 計測基盤とベースライン
- tools/play.mjs / smoke.sh を Linux (CHROME_PATH または /opt/pw-browsers/chromium) で動くようにする。
- モバイル向け smoke を追加: 端末エミュレーション (例: 844x390, DPR 3, hasTouch, isMobile)、
  CPU 4 倍スロットリング、Fast 4G 相当のネットワーク制限。
- 計測スクリプト tools/measure-load.mjs を追加: bootMs, bootMarks (各ロード段階の ms), 転送量 (リソース種別ごと),
  試合開始後 10 秒間の平均 fps と 1% low、draw calls (renderer.info)。JSON で出力する。
- docs/PERF_BASELINE.md にデスクトップ/モバイル エミュレーションのベースライン値を記録する。
- 完了条件: 同じコマンドで何度でも再計測でき、値のぶれ幅が PR に書かれている。

## Phase 1: 日本語化 (i18n)
- src/i18n/ を新設: index.js (tr(s, params), N_(s), setLang, getLang, onLang, relabel), ja.js。
  (実装済み) キーは英語の原文そのもの。英語版の辞書は不要で、訳がない文字列は英語のまま表示される。
  関数名は t ではなく tr (UI コードで t が時間の変数として多用されているため)。
  パラメータ置換 ({n}, {name}) と、[SHIFT] のようなキーキャップ記法 (ui-icons.js richText) をそのまま扱えること。
- 文字列を抜き出す対象 (漏れがないように grep で確認し、チェックリストを PR に載せる):
  - src/config.js: GAME_SUBTITLE, WEAPONS の name/class/blurb, SUB / SPECIALS の名前と説明,
    TEAM_PALETTES の names, TEAM_NAMES, MAPS の名前と説明, DIFFICULTY, BOT_NAMES (日本語名を用意するか要確認)
  - src/ui/menus.js: TIME_INFO, TIPS, DIFF_INFO, STAT_LABELS, KIND_LABEL, ロッカーのタブ, 設定の各行
    (label / help / fmt の単位), 各画面の見出し・ボタン・確認ダイアログ
  - src/ui/hud.js, diorama.js, menu-art.js (表彰名 AWARD の label/desc), ui-icons.js と menu-art.js の SVG <text>
  - src/main.js のロード段階ラベル ('Mixing ink…' など)
  - index.html: <html lang>, <title>, meta description、エラー表示文言
- 設定データ (config.js) の英語の表示テキストはそのまま残し、表示するところで tr() を通す。データ表の定義側には N_() で目印を付ける。
- ステージ内の看板や壁画 (src/world/murals.js, props.js の fillText) は「世界観の一部」として英語のまま残し、
  変更しない (変更する場合は別途確認)。
- フォント:
  - 見出し用 (Titan One の代わり) と本文用 (Rubik の代わり) に、OFL の日本語フォントを選ぶ
    (候補: 見出し = Dela Gothic One / M PLUS Rounded 1c Black、本文 = M PLUS Rounded 1c / Zen Maru Gothic)。
  - ゲーム内で実際に使う文字だけのサブセットを作る tools/subset-fonts.py (fonttools/pyftsubset) を追加し、
    ja.js の全文字 + 英数字 + 記号から woff2 を生成する。目標: 1 書体あたり 150KB 以下。
  - 既存のラテンフォントを先に、日本語サブセットを後に並べた font-family にする
    (英数字の見た目を維持するため)。font-display は block ではなく swap または optional にし、
    日本語フォントは preload しない (ロード時間の悪化を防ぐ)。
  - 読み込み失敗時のフォールバック: 'Hiragino Maru Gothic ProN', 'Hiragino Sans', 'Noto Sans JP', sans-serif。
- レイアウト: 日本語は英語より幅が狭く縦に詰まるので、letter-spacing・text-transform: uppercase・行高を見直す。
  改行は word-break: auto-phrase (対応ブラウザ) と line-break: strict を使う。はみ出しをスクショで確認する。
- 言語切り替え: 設定画面に「言語 / Language」を追加 (DEFAULT_SETTINGS.lang = 'ja')。
  切り替えたら、メニューを作り直すか再描画してすぐに反映する。
- 用語集 (確定。スプラトゥーンの公式用語に合わせる。表にない語も公式の言い方を優先する):
  | 英語 | 日本語 |
  |---|---|
  | Turf War | ナワバリバトル |
  | Turf / turf inked | ナワバリ / 塗りポイント (p) |
  | Squid form / swim | イカ / イカ移動・センプク |
  | Squidkid | ヒト (ヒト状態)。キャラクター全体を指すときはインクリング |
  | Ink tank | インクタンク |
  | Splat (敵を倒す) / Splatted (倒される) | たおした / やられた |
  | Special / Special gauge | スペシャル / スペシャルゲージ |
  | Sub weapon / Splat Bomb / Suction Bomb / Burst Bomb / Sprinkler | サブウェポン / スプラッシュボム / キューバンボム / クイックボム / スプリンクラー |
  | Super Jump | スーパージャンプ |
  | Dodge roll (Dualies) | スライド |
  | Locker | ロッカー |
  | Shooter / Roller / Charger / Blaster / Dualies / Slosher / Splatling | シューター / ローラー / チャージャー / ブラスター / マニューバー / スロッシャー / スピナー |
  | 武器の固有名 (Spritzer, Swell Roller …) | カタカナ表記 (スプリッツァー、スウェルローラー …) |
  | Alpha / Bravo (チーム名) | アルファ / ブラボー |
  | Easy / Normal / Hard | かんたん / ふつう / むずかしい |
- 完了条件: 日本語設定で、タイトル→メニュー各画面→試合→リザルトまで英語が残っていない (ワールド内の看板を除く)。
  英語設定も従来どおり表示される。フォント追加による初回転送量の増加は 300KB 以下。

## Phase 2: スマホ操作対応
- 端末判定: matchMedia('(pointer: coarse)') と navigator.maxTouchPoints を使う。UA 判定は使わない。
  タッチ操作があれば、入力モード 'touch' を有効にする (Input.lastDevice に 'touch' を追加)。
- src/core/touch.js を新設し、Pointer Events (pointerdown/move/up/cancel, 複数指) で入力を受ける。
  出力は既存の Input と同じ形に合わせ、player.js の intent 生成にタッチ分を加える
  (move / look / fire / squid / jump / sub / special / mapHeld)。キーボード・パッド処理は変えない。
- 画面構成 (横画面前提、左右の親指で操作):
  - 左半分: 触れた位置が中心になるフローティング仮想スティック (移動)。
  - 右半分のドラッグ: カメラ操作 (視点)。感度設定 touchSensitivity を追加。
  - 右側のボタン: 発射 (押している間は連射。ボタンに触れたままドラッグしても視点が動くようにする)、
    ジャンプ、イカ (スイム) (押している間 / 切り替え を設定で選べる)、サブ、スペシャル (ゲージが溜まると光る)、
    マップ。
  - 画面上部: 一時停止ボタン (Esc の代わり)。
  - ボタンは 56px 以上、env(safe-area-inset-*) でノッチを避ける。左利き用の左右反転と、
    ボタン配置・サイズ・不透明度の調整を設定に追加する。
- Pointer Lock に依存している処理を分ける: 現状はロック解除で試合が一時停止する (main.js onUnlock) ので、
  タッチモードではロックを要求しない・解除で止めない。visibilitychange (アプリ切り替え) で一時停止する。
- マップ (diorama.js): ピンをタップするとスーパージャンプ。マップボタンを押している間は表示する。
- エイムアシスト: タッチ用の既定値を有効にする (既存のゲームパッド用ロジックを再利用し、強さは別設定)。
- メニュー: hover 前提の UI をタップで操作できるようにする。タップ領域は 44px 以上。
  スライダーは指で操作しやすくし、操作ガイドのグリフ (keycap/padGlyph) はタッチ用アイコンに切り替える。
- ブラウザ対策: canvas と HUD に touch-action: none、ダブルタップ拡大やピンチ・長押しメニュー・テキスト選択・
  pull-to-refresh (overscroll-behavior: none) を防ぐ。縦画面では「横向きにしてください」を表示する。
  試合開始時に全画面 (requestFullscreen) と screen.orientation.lock('landscape') を試す (失敗しても続行)。
  iOS Safari は全画面 API が使えないため、アドレスバーの高さ変化 (visualViewport / 100dvh) に対応する。
- 振動: navigator.vibrate がある端末では、被弾・撃破時に短く振動させる (設定の rumble に従う)。
- HowTo 画面にタッチ操作の説明を追加する (日本語/英語)。
- 完了条件: モバイルエミュレーションとタッチ操作の自動テスト (CDP の Input.dispatchTouchEvent) で、
  タイトル→武器選択→試合開始→移動・射撃・スイム・ジャンプ・ボム・スペシャル・マップ→リザルトまで進められる。
  デスクトップの smoke に変化がない。

## Phase 3: ロード時間の改善
- まず bootMarks を分析して、時間がかかっている段階 (texlib 生成、壁画、PropKit、シェーダーコンパイル、
  音声合成など) を特定し、PR に内訳を載せる。
- 起動処理の並べ替え:
  - 互いに依存しない await を Promise.all でまとめる (createMuralTexture と texlib など)。
  - タイトル表示に要らない処理は後回しにする (Showcase、ロッカー用プレビュー、BGM の手続き生成、
    screenfx の一部)。タイトル表示後やメニューを開いたとき、または requestIdleCallback で読み込む。
  - AudioContext はユーザー操作がないと動かないため、効果音の生成は最初のタップ/クリックの後に行う。
- 重い手続き生成の結果をキャッシュする: texlib や壁画のテクスチャを、バージョン付きのキーで
  IndexedDB (ImageBitmap/Blob) に保存し、2 回目以降の起動で使い回す。可能なら OffscreenCanvas + Worker に移す。
- シェーダー: compileAsync (KHR_parallel_shader_compile) は維持しつつ、低画質プリセットでは使わないパスの
  シェーダーをコンパイルしない。
- ネットワーク:
  - <link rel="modulepreload"> で最初に必要なモジュールを先読みする (dist 生成時に自動で書き込む)。
  - ステージ画像は、カードには -sm だけを使い、大きな画像は必要になってから loading="lazy" / decoding="async" で読む。
  - lightmaps の PNG は、画質を確認したうえで WebP (可逆) にできないか調べる。
  - 本番の _headers: ファイル名にハッシュを付けた資産は `Cache-Control: public, max-age=31536000, immutable`、
    index.html だけ再検証にする。
  - Service Worker で 2 回目以降はオフラインでも起動できるようにする (dist のみ、開発時は無効)。
- 完了条件: §2 のロード時間目標を達成し、2 回目の起動が初回より明らかに速い (数値を PR に記載)。

## Phase 4: 軽量化 (配信サイズ)
- dist 生成を拡張する: esbuild (dev 依存) で src/main.js を起点にバンドル・minify・tree-shaking し、
  three.js も必要な部分だけに絞る。遅延読み込みしたいモジュール (Phase 3 で決めたもの) はコード分割する。
  開発時の「ビルド不要」はそのまま維持する。
- 出力ファイル名にコンテンツハッシュを付け、index.html の参照を書き換える。
- (Phase 3 から移動) ハッシュ付きファイルには `Cache-Control: public, max-age=31536000, immutable`、index.html は再検証にする
  `_headers` を出力する。dist だけで Service Worker を登録し、2 回目以降の起動とオフライン起動に対応する
  (開発サーバーでは登録しない)。
- 事前圧縮 (brotli/gzip) の効果を計測する (Cloudflare Pages は自動圧縮なので、実際の転送量で比較する)。
- 使われていないコードやアセットを探して削除する (dev/stubs.js の扱い、使っていない CSS、
  重複しているテクスチャ生成処理など)。削除するものは一覧を PR に載せる。
- vendor/three の未使用ファイルは、dist に入らないことを確認できればリポジトリに残してよい
  (削除するなら理由を書き、tools/ のラボが壊れないことを確認する)。
- 完了条件: §2 の転送量目標を達成。dist でデスクトップ/モバイル smoke が通る。

## Phase 5: 実行時の最適化 (特にスマホ)
- QUALITY に mobile プリセットを追加する (例: pixelRatio 1.0 上限、shadowSize 1024 または影なし、msaa 0、
  bloom/ao なし、paintAtlas 2048 (必要なら 1024 も検討)、particles 0.35)。
  タッチ端末の初回起動時は、既定画質を mobile にする (ユーザーが変えた設定は上書きしない)。
- 動的解像度: モバイルでは下限を 0.5 まで下げ、上げ下げの閾値を 30fps 目標に合わせる。
  熱で性能が落ちたとき (fps が長く落ち続けるとき) は、1 段階下の画質を提案する。
- シェーダーの数: 起動時点で 121 個のプログラムがある (Phase 3 の計測)。多くは MeshPhysicalMaterial と onBeforeCompile の
  組み合わせで別プログラムになっているので、同じ見た目のものはまとめ、mobile / low では Physical の機能 (クリアコートなど)
  を使わない Standard に寄せる。起動時のコンパイル時間 (「Ready!」段階) は、スマホ実機で最も大きいコストになる。
- 描画負荷: renderer.info の draw calls / triangles を計測し、多いところ (props、decor、キャラクター) を
  InstancedMesh 化・結合・距離による LOD・遠くの影を切るなどで減らす。
- インク (paint.js): スプラットの GPU 描画回数を 1 フレームあたりでまとめ、CPU グリッドの更新間隔を見直す。
  見た目と判定 (陣地の割合) の結果が変わらないことを、同じシードの試合で比べて確認する。
- ボット・物理: モバイルでは NavGraph の探索やボットの思考の更新間隔を調整する (挙動の変化は最小限にする)。
- メモリ: ステージ変更時に dispose 漏れがないか確認する (renderer.info.memory を試合の前後で比べる)。
- 完了条件: §2 の fps 目標をエミュレーション (CPU 4 倍スロットリング) と、可能なら実機で確認する。
  デスクトップ high の見た目がスクリーンショットで変わっていない。

## Phase 6: 仕上げ
- README.md と CONTRIBUTING.md を日本語で更新する (英語版は README.en.md などに分けて残す)。
  操作表にタッチ操作を追加する。
- docs/PERF_BASELINE.md に、全フェーズの前後の計測値の比較をまとめる。
- 既知の問題と今後の改善候補を一覧にする。

# 6. PR に書くこと
- 目的・変更点の要約 (日本語)
- 計測結果の表 (変更前 / 変更後 / 差): 転送量、bootMs、fps (平均/1% low)、draw calls
- 検証手順と結果 (check / smoke / モバイル smoke / スクリーンショット)
- 用語や見た目など、判断を求めたい点
- 残課題
````

---

## フェーズ別の依頼例

```text
（上のマスタープロンプト本文を貼り付け）

今回のフェーズ: Phase 1（日本語化）
ブランチ: <作業ブランチ名>
```

## 補足：現状の調査メモ

| 項目 | 現状 | 改修の方向 |
|---|---|---|
| UI テキスト | menus.js / hud.js / config.js などに英語で直接書かれている | i18n モジュールに集めて t() で参照する |
| フォント | Titan One / Rubik のラテン文字サブセットのみ、`font-display: block` | 日本語サブセットフォントを追加し、swap にする |
| three.js | 未 minify の build 2 ファイルで約 2.1MB | dist 生成時にバンドル・minify・tree-shaking する |
| 起動処理 | テクスチャ生成・壁画・プロップ・シェーダーコンパイルを順番に実行 | 並列化・後回し・キャッシュする |
| 入力 | Pointer Lock とキーボード・マウス・ゲームパッドのみ。タッチ処理なし | タッチ操作のレイヤーを追加し、Pointer Lock に依存しない流れにする |
| 画質 | low〜ultra。動的解像度の下限は 0.75 | mobile プリセットを追加し、下限を広げる |
| 配信 | Cloudflare Pages、全ファイル max-age=0 | ハッシュ付きファイル名 + immutable、Service Worker |
| テスト | smoke.sh は macOS の Chrome のパス固定 | Linux / モバイルエミュレーション / 計測スクリプトに対応する |
