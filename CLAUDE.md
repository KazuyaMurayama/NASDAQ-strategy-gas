# nasdaq-strategy-gas — 運用ルール入口

このリポジトリは **main 単一ブランチ運用**。セッション開始時は必ず以下の順に参照すること。

## セッション開始時の参照順序
1. **FILE_INDEX.md** — 全ファイルの所在・優先度
2. **tasks.md** — 未完了タスクと進捗
3. このCLAUDE.md — ルール入口

## 運用ルール（詳細はスキルファイル参照）

| # | ファイル | 内容 |
|---|---------|------|
| 01 | [docs/rules/01_response-basics.md](docs/rules/01_response-basics.md) | 回答の基本ルール（要約・事実ベース・選択肢提示） |
| 02 | [docs/rules/02_task-management.md](docs/rules/02_task-management.md) | タスク管理（tasks.md運用） |
| 03 | [docs/rules/03_file-index.md](docs/rules/03_file-index.md) | ファイルインデックス管理 |
| 04 | [docs/rules/04_deliverables-and-models.md](docs/rules/04_deliverables-and-models.md) | 成果物報告・モデル使い分け・出力フォーマット |
| 05 | [docs/rules/05_git-and-execution.md](docs/rules/05_git-and-execution.md) | Git操作・実行計画・タイムアウト対策 |

## プロジェクト概要

NASDAQ 3倍レバレッジ戦略を Google Apps Script で自動運用するシステム。

**最新戦略**: `DH Dyn 2x3x [A]` (Approach A / スリーブ独立) ※2026-04-20 切替
- シグナル: A2 Optimized = DD × VT(AsymEWMA+TrendTV) × SlopeMult × MomDecel × VIX_MR
- 配分: 3資産 (TQQQ/Gold/Bond) + Gold/Bond は lev 非依存・常時保有
- 期待CAGR (1974-2026): +30.30% (旧 Approach B: +24.46% から +5.84pp 改善)
- 切替記録: [docs/APPROACH_A_MIGRATION_2026-04-20.md](docs/APPROACH_A_MIGRATION_2026-04-20.md)

**研究リポジトリ**: https://github.com/KazuyaMurayama/NASDAQ_backtest
