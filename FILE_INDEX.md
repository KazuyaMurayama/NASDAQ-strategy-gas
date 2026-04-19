# File Index — nasdaq-strategy-gas

最終更新: 2026-04-19

## 📁 Living Docs（毎回参照）
| ファイル | 役割 |
|---------|------|
| [CLAUDE.md](CLAUDE.md) | 運用ルール入口 |
| [tasks.md](tasks.md) | タスク管理 |
| [FILE_INDEX.md](FILE_INDEX.md) | このファイル |

## 📘 運用ルール（docs/rules/）
| ファイル | 内容 |
|---------|------|
| [docs/rules/01_response-basics.md](docs/rules/01_response-basics.md) | 回答の基本ルール |
| [docs/rules/02_task-management.md](docs/rules/02_task-management.md) | タスク管理 |
| [docs/rules/03_file-index.md](docs/rules/03_file-index.md) | ファイルインデックス管理 |
| [docs/rules/04_deliverables-and-models.md](docs/rules/04_deliverables-and-models.md) | 成果物・モデル・フォーマット |
| [docs/rules/05_git-and-execution.md](docs/rules/05_git-and-execution.md) | Git操作・実行計画 |

## 🔧 GAS ソースコード（src/）
| ファイル | 役割 |
|---------|------|
| [src/Code.gs](src/Code.gs) | **メイン**: CONFIG, dailyUpdate(), dryRun() |
| [src/Layers.gs](src/Layers.gs) | **5層計算**: DD/AsymEWMA/TrendTV/SlopeMult/MomDecel/VIX |
| [src/Allocation.gs](src/Allocation.gs) | 3資産配分 (TQQQ/Gold/TMF) |
| [src/DataFetch.gs](src/DataFetch.gs) | Yahoo Finance 価格取得 |
| [src/StateManager.gs](src/StateManager.gs) | State/Log シート管理 |
| [src/Notify.gs](src/Notify.gs) | LINE/Gmail 通知 |
| [src/Setup.gs](src/Setup.gs) | 初期セットアップ、マイグレーション |
| [src/DailyStatusAgent.gs](src/DailyStatusAgent.gs) | 日次ステータス通知 |
| [src/ForwardReturn.gs](src/ForwardReturn.gs) | 前向きリターン計算 |
| [src/HealthCheckAgent.gs](src/HealthCheckAgent.gs) | データ健全性チェック・自動修復 |

## 📂 その他
| ファイル | 役割 |
|---------|------|
| [README.md](README.md) | プロジェクト概要・セットアップ手順 |
| [docs/session-summary-2026-04-09.md](docs/session-summary-2026-04-09.md) | 2026-04-09 時点の実装サマリー |
| [.claude/rules/](. claude/rules/) | レガシー rules（旧セッションのもの、参考） |

## 🌿 Branches（参考・main が最新スーパーセット）
- `claude/implementation-JjBAl` — main の元。履歴参照用
- `claude/investment-strategy-tracking-gt8uD` — 旧Dyn-Hybrid (EWMA VIX) 実装。**戦略比較時のみ参照**
- `claude/create-file-index-vVbP4` — FILE_INDEX.md 作成初版
- `claude/nasdaq-leverage-trading-gas-aG2xt` — LINE Webhook初期実装

**同種ファイルが複数ある場合は main を優先、ブランチは歴史的参照のみ。**
