# Claude Code 向けのメモ

- ユーザーへの返事は日本語で書く。
- 作業はすべてメインの会話が 1 人で行う。設計（コードを読み、計測し、計画を立てる）も、実装、確認（`npm run check` など）、コミット、プッシュ、PR も自分でする。
  - 設計や実装をサブエージェント（Sonnet などの別モデルを含む）に任せない。
- 実装の決まり：
  - まわりのコードに合わせる：2 スペース、シングルクォート、セミコロンあり、コメントは「なぜ」を書く。
  - 毎フレーム実行される処理ではオブジェクトを新しく作らない。レイアウトは `VIEW`（`src/core/ctx.js`）から読む。
  - UI の文字列は `tr()` で囲み、日本語を `src/i18n/ja.js` に足す。新しい漢字を使ったら `python3 tools/subset-fonts.py`。
  - 終わったら、最低でも `npm run check` と `npm run i18n` を実行する。
- 開発の決まりと確認コマンドは [CONTRIBUTING.md](CONTRIBUTING.md) を参照。
- デプロイ（`tools/release.sh`、Cloudflare）は、頼まれたときだけ行う。main へのマージで Cloudflare Workers が本番をビルドする。
