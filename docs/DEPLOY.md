# 非公開の Web サイトとして置く（iPhone で全画面で遊ぶ）

本番ビルドを Cloudflare Workers（無料）に置き、Cloudflare Access で「自分のメールアドレスでログインした人だけ」が開けるようにします。そのあと iPhone の「ホーム画面に追加」から起動すると、Safari のバーのない全画面で遊べます。

- iPhone の Safari は、Web ページの全画面表示（Fullscreen API）に対応していません。ホーム画面に追加して起動したときだけ、ブラウザの枠なしで表示されます。
- 手順はすべて iPhone のブラウザでできます（パソコンは要りません）。
- ビルドは Cloudflare 側で自動的に行います。GitHub のブランチを更新すると、サイトも自動で更新されます。

## 0. 先に PR #1 をマージする

Cloudflare は GitHub の `main` ブランチからビルドします。`main` には、ビルドの仕組み（`npm run build`）と Cloudflare 用の設定（`wrangler.jsonc`）がまだ入っていません。GitHub で PR #1 を開き、「Merge pull request」を押してください。

## 1. Cloudflare Workers にデプロイする

1. [dash.cloudflare.com](https://dash.cloudflare.com) で Cloudflare のアカウントを作ります（無料）。
2. 「Workers & Pages」→「作成（Create）」→「Import a repository」を選び、GitHub アカウントを連携してリポジトリ `anfaal1672-png/inkwave` を選びます（非公開のリポジトリでも使えます）。
3. 「Set up your application」の画面で、次のように入力します。

   | 項目 | 値 |
   |---|---|
   | Project name | `inkwave`（`wrangler.jsonc` の `name` と同じにする） |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy`（最初から入っている値のまま） |

4. 「Deploy」を押します。数分でビルドが終わり、`https://inkwave.<あなたのサブドメイン>.workers.dev` で開けるようになります。
   - Cloudflare のビルド環境に Pillow（Python の画像ライブラリ）がない場合、ライトマップは WebP にならず PNG のまま配信されます（約 280 KB 増えるだけで、動作は同じです）。
   - 以降は `main` を更新するたびに、自動でビルドとデプロイが行われます。

この時点では、URL を知っている人は誰でも開けます。すぐに次の手順で制限をかけてください。

## 2. 自分だけが開けるようにする（Cloudflare Access）

1. 「Workers & Pages」→ `inkwave` →「設定（Settings）」→「Domains & Routes」を開きます。
2. `workers.dev` の行のメニューから「Cloudflare Access を有効にする（Enable Cloudflare Access）」を選びます。
   - Cloudflare Zero Trust を初めて使う場合は、チーム名を決めて **Free プラン**を選ぶ画面が出ます（50 人まで無料）。地域によっては、無料でも支払い方法の登録を求められます。
3. 有効にしたら「Manage Cloudflare Access」から、次のことを確認します。
   - ポリシー：Allow、Include →「Emails」→ 自分のメールアドレスだけ
   - ログイン方法（Login methods）：「One-time PIN」（メールに届く 6 桁のコードでログイン）
   - Session Duration：`1 month`（ログインの頻度を減らすため）
4. 保存したら、ブラウザのプライベートウィンドウで URL を開いて確認します。Cloudflare のログイン画面が出れば、制限がかかっています。

メニューに「Enable Cloudflare Access」が見当たらない場合は、[one.dash.cloudflare.com](https://one.dash.cloudflare.com) →「Access」→「Applications」→「Add an application」→「Self-hosted」で、ドメインに `inkwave.<あなたのサブドメイン>.workers.dev` を入れて、上と同じポリシーを作ってください。

## 3. iPhone のホーム画面に追加する

1. iPhone の **Safari** で `https://inkwave.<あなたのサブドメイン>.workers.dev` を開きます。
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
