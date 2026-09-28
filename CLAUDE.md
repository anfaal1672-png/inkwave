# Claude Code 向けのメモ

- ユーザーへの返事は日本語で書く。
- 作業の分担：
  - 設計は `designer` エージェント（Opus 5.5、effort medium）に頼む。
  - 実装は、その計画を渡して `implementer` エージェント（Sonnet 5、effort medium）に頼む。
  - メインの会話は、2 つの間の受け渡し、結果の確認（`npm run check` などを自分でも実行）、コミット、プッシュ、PR を受け持つ。
  - 定義は `.claude/agents/` にある。
- 開発の決まりと確認コマンドは [CONTRIBUTING.md](CONTRIBUTING.md) を参照。
- デプロイ（`tools/release.sh`、Cloudflare）は、頼まれたときだけ行う。main へのマージで Cloudflare Workers が本番をビルドする。
