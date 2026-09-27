# 非公開の Web サイトとして置く（iPhone で全画面で遊ぶ）

本番ビルドを Cloudflare Pages（無料）に置き、Cloudflare Access で「自分のメールアドレスでログインした人だけ」が開けるようにします。そのあと iPhone の「ホーム画面に追加」から起動すると、Safari のバーのない全画面で遊べます。

- iPhone の Safari は、Web ページの全画面表示（Fullscreen API）に対応していません。ホーム画面に追加して起動したときだけ、ブラウザの枠なしで表示されます。
- 手順はすべて iPhone のブラウザでできます（パソコンは要りません）。
- ビルドは Cloudflare 側で自動的に行います。GitHub のブランチを更新すると、サイトも自動で更新されます。

## 1. Cloudflare Pages にデプロイする

1. [dash.cloudflare.com](https://dash.cloudflare.com) で Cloudflare のアカウントを作ります（無料）。
2. 「Workers & Pages」→「作成（Create）」→「Pages」タブ →「Git に接続（Connect to Git）」を選びます。
3. GitHub アカウントを連携し、リポジトリ `anfaal1672-png/inkwave` を選びます（非公開のリポジトリでも使えます）。
4. ビルドの設定を次のようにします。

   | 項目 | 値 |
   |---|---|
   | プロジェクト名 | 推測されにくい名前（例：`inkwave-` の後にランダムな英数字）。URL は `https://<プロジェクト名>.pages.dev` になります |
   | 本番ブランチ（Production branch） | `main`（PR #1 をマージした後）。マージ前に試すなら `claude/game-localization-optimization-ft1bb2` |
   | フレームワーク プリセット | なし（None） |
   | ビルド コマンド | `npm run build` |
   | ビルド出力ディレクトリ | `dist` |

5. 「保存してデプロイ（Save and Deploy）」を押します。数分でビルドが終わり、URL が表示されます。
   - Cloudflare のビルド環境に Pillow（Python の画像ライブラリ）がない場合、ライトマップは WebP にならず PNG のまま配信されます（約 280 KB 増えるだけで、動作は同じです）。

この時点では、URL を知っている人は誰でも開けます。すぐに次の手順で制限をかけてください。

## 2. 自分だけが開けるようにする（Cloudflare Access）

1. [one.dash.cloudflare.com](https://one.dash.cloudflare.com)（Cloudflare Zero Trust）を開き、チーム名を決めて **Free プラン**を選びます（50 人まで無料）。
   - 地域によっては、無料でも支払い方法の登録を求められます。
2. 「Access」→「Applications」→「Add an application」→「Self-hosted」を選びます。
3. アプリケーションの設定をします。
   - Application domain：`<プロジェクト名>.pages.dev`
   - もう 1 行追加して `*.<プロジェクト名>.pages.dev`（ブランチごとのプレビュー URL も守るため）
   - Session Duration：`1 month`（ログインの頻度を減らすため）
4. ログイン方法（Identity providers）は「One-time PIN」を選びます。メールに届く 6 桁のコードでログインする方式です。
5. ポリシーを作ります。
   - Action：`Allow`
   - Include →「Emails」→ 自分のメールアドレス
6. 保存したら、ブラウザのプライベートウィンドウで URL を開いて確認します。Cloudflare のログイン画面が出れば、制限がかかっています。

## 3. iPhone のホーム画面に追加する

1. iPhone の **Safari** で `https://<プロジェクト名>.pages.dev` を開きます。
2. メールアドレスを入力し、届いたコードを入れてログインします。
3. 共有ボタン（□ と ↑）→「ホーム画面に追加」を選びます。オレンジのイカのアイコンが追加されます。
4. ホーム画面の INKWAVE から起動します。
   - ホーム画面から起動したアプリは、Safari とログイン情報を共有しません。最初の 1 回だけ、もう一度ログインしてください。
5. コントロールセンターの「画面縦向きのロック」をオフにして、iPhone を横向きにして遊びます。

### うまくいかないとき
- **ホーム画面から開くと、ログインを何度も求められる**：ホーム画面アプリと Cloudflare のログインの組み合わせは、iOS のバージョンによって動きが違います。起きたときは教えてください。別の方法（ログインの仕組みを変える、など）を用意します。
- **縦向きのまま**：iPhone では、Web アプリが画面の向きを固定できません。「画面縦向きのロック」をオフにしてください。
- **更新が反映されない**：アプリを完全に終了（上にスワイプして閉じる）してから、もう一度起動してください。ページは毎回ネットワークから最新版を取りに行きます。

## Android の場合

手順 1・2 は同じです。Chrome で開き、メニュー →「ホーム画面に追加」（または「アプリをインストール」）を選ぶと、全画面・横向きで起動します。ホーム画面に追加しなくても、試合が始まると Chrome の全画面表示に切り替わります。
