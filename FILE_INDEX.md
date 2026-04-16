# ファイルインデックス — NASDAQ Strategy GAS

> セッション開始時は `tasks.md` → このファイルの順で確認すること。

最終更新: 2026-04-16
リポジトリ: https://github.com/KazuyaMurayama/nasdaq-strategy-gas

---

## ブランチ一覧

| ブランチ | 用途 | 状態 |
|---------|------|------|
| `claude/implementation-JjBAl` | **メイン実装**（Dyn 2x3x A2 Optimized） | 本番運用中・最新 |
| `claude/nasdaq-leverage-trading-gas-aG2xt` | 基本GAS実装（旧版・シンプル） | 参照のみ |
| `claude/investment-strategy-tracking-gt8uD` | 投資戦略トラッキング連携 | 参照のみ |

---

## Living Docs（日付なし）

| ファイル | 説明 | ブランチ |
|---------|------|---------|
| `CLAUDE.md` | Claude Code 指示書（軽量） | 全ブランチ |
| `FILE_INDEX.md` | このファイル | implementation-JjBAl |
| `tasks.md` | タスク一覧（未完了・完了・バックログ） | implementation-JjBAl |
| `README.md` | プロジェクト概要 | 全ブランチ |

## ルールファイル

| ファイル | 説明 |
|---------|------|
| `.claude/rules/response-rules.md` | 回答フォーマット・成果物報告・名前表記 |
| `.claude/rules/git-rules.md` | Git操作ルール |
| `.claude/rules/workflow-rules.md` | タスク管理・モデル使い分け・エージェント |

---

## GAS ソースコード（src/）— `implementation-JjBAl` ブランチ

| ファイル | 説明 |
|---------|------|
| `src/Code.gs` | **メインエントリー** — dailyUpdate・dryRun・リバランス判定 |
| `src/Layers.gs` | 各レイヤー計算（DD/AsymEWMA/TrendTV/VT/SlopeMult/MomDecel/VIXMult） |
| `src/Allocation.gs` | 3資産目標配分計算（calcAllocation / calcMaxDrift） |
| `src/DataFetch.gs` | Yahoo Finance 価格取得・Gold/Bond価格取得 |
| `src/StateManager.gs` | State読み書き・ログ記録 |
| `src/Notify.gs` | LINE / Email 通知送信 |
| `src/Setup.gs` | 初期セットアップ・シート作成・メニュー登録 |

---

## セッションサマリー

| ファイル | 説明 | ブランチ |
|---------|------|---------|
| `docs/SESSION_SUMMARY_2026-04-09.md` | 最新セッションサマリー（通知・スプレッドシート改善） | implementation-JjBAl |
