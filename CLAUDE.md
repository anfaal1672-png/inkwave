# Claude Code 向けのメモ

- ユーザーへの返事は日本語で書く。
- 作業の分担：
  - 設計（コードを読み、計測し、実装計画を書く）は、メインの会話が自分で行う。
  - 実装は、その計画を渡して `implementer` エージェント（Sonnet 5.5、effort medium）に頼む。
  - メインの会話は、結果の確認（`npm run check` などを自分でも実行）、コミット、プッシュ、PR も受け持つ。
  - 定義は `.claude/agents/` にある（`designer` は、ユーザーが頼んだときだけ使う）。
- 開発の決まりと確認コマンドは [CONTRIBUTING.md](CONTRIBUTING.md) を参照。
- デプロイ（`tools/release.sh`、Cloudflare）は、頼まれたときだけ行う。main へのマージで Cloudflare Workers が本番をビルドする。
