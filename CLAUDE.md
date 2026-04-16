# NASDAQ Strategy GAS — Claude Code ガイド

## 必読ルールファイル（セッション開始時に必ず読み込む）

| ファイル | 内容 |
|---------|------|
| [`.claude/rules/response-rules.md`](.claude/rules/response-rules.md) | 回答フォーマット・成果物報告・名前表記 |
| [`.claude/rules/git-rules.md`](.claude/rules/git-rules.md) | Git操作ルール（ブランチ作成禁止等） |
| [`.claude/rules/workflow-rules.md`](.claude/rules/workflow-rules.md) | タスク管理・モデル使い分け・エージェント構成 |

## セッション開始チェックリスト

1. 上記ルールファイルを読み込む
2. [`FILE_INDEX.md`](./FILE_INDEX.md) でファイル構成を把握する
3. [`tasks.md`](./tasks.md) で未完了タスクを確認する

## プロフィール

- **名前**: 男座員也（おざ かずや / Kazuya Oza）
- **職種**: データサイエンティスト・生成AIコンサルタント（フリーランス）

## ブランチ構成

| ブランチ | 内容 | 状態 |
|---------|------|------|
| `claude/implementation-JjBAl` | **メイン実装**（Dyn 2x3x A2 Optimized、3資産配分） | 本番運用中 |
| `claude/nasdaq-leverage-trading-gas-aG2xt` | 基本GAS実装（旧版） | 参照のみ |
| `claude/investment-strategy-tracking-gt8uD` | 投資戦略トラッキング連携 | 参照のみ |

## コア戦略ロジック（Dyn 2x3x A2 Optimized）

```
最終レバレッジ = DD × VT × SlopeMult × MomDecel × VIXMult

リバランス条件（バックテストと完全一致）:
  |raw_leverage - current_leverage| > 0.20  または  DD状態変化
```

## GitHub
https://github.com/KazuyaMurayama/nasdaq-strategy-gas
