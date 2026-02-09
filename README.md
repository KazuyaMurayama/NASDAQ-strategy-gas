# NASDAQ 3倍レバレッジ 自動運用システム (GAS)

47年間のバックテストで検証された **MomDecel(40/120) + Ens2(S+T)** 戦略を
Google Apps Script で自動運用するシステムです。

## バックテスト結果（実商品条件: 5日遅延, 年1.5%コスト）

| 戦略 | Sharpe | CAGR | MaxDD | Worst5Y | 取引/年 |
|------|--------|------|-------|---------|---------|
| **MomDecel+Ens2(S+T)** | **0.892** | +23.7% | -50.6% | **-0.9%** | 18.9 |
| B&H 3x | 0.595 | +19.1% | -99.9% | -60.3% | 0.0 |
| B&H 1x | 0.622 | +11.1% | -77.9% | -16.8% | 0.0 |

## 戦略概要

最終レバレッジ = DD × VT × SlopeMult × MomDecel（すべて掛け算）

| Layer | 機能 | 出力範囲 |
|-------|------|---------|
| DD | ドローダウン制御（ヒステリシス） | 0 or 1 |
| VT | ボラティリティ・ターゲティング（AsymEWMA + TrendTV） | 0.0〜1.0 |
| SlopeMult | MA200傾きZ-score乗数 | 0.3〜1.5 |
| MomDecel | モメンタム減速検出 | 0.5〜1.3 |

## ファイル構成

```
src/
├── Code.gs          # メインエントリーポイント、設定、オーケストレーション
├── DataFetch.gs     # Yahoo Finance データ取得
├── Layers.gs        # 4つの戦略Layer計算
├── StateManager.gs  # State管理、ログ記録
├── Notify.gs        # LINE / Email 通知
└── Setup.gs         # 初期セットアップ、トリガー設定
```

## セットアップ手順

### 1. GASプロジェクト作成

1. [Google Spreadsheet](https://sheets.google.com) を新規作成
2. 拡張機能 → Apps Script を開く
3. `src/` 内の各 `.gs` ファイルの内容をコピーして貼り付け

### 2. 初期設定

Apps Script エディタで以下を順番に実行:

```
1. setupSpreadsheet()     ← シート構成を作成
2. initializeHistoricalData() ← 過去260日+のデータを取得
3. setupDailyTrigger()    ← 毎日07:00 JSTに自動実行
```

### 3. 通知設定（任意）

`Code.gs` の `CONFIG` で設定:

```javascript
LINE_TOKEN: 'your-line-notify-token',  // LINE Notify
EMAIL: 'your-email@example.com',       // Gmail通知
```

### 4. 動作確認

```
dryRun()           ← 計算結果を確認（実行はしない）
testNotification() ← 通知のテスト送信
```

## スプレッドシート構成

| シート | 内容 |
|--------|------|
| PriceHistory | 日付・終値（過去260+営業日） |
| State | DD状態, AsymEWMA variance, 現在レバレッジ, 最終更新日 |
| Log | 日次の計算結果・リバランス履歴 |

## 通知例

```
[NASDAQ戦略シグナル]
日付: 2024-06-15
DD状態: HOLD
レバレッジ: 72.0% → 45.0%（変更あり）
アクション: 3倍商品の保有比率を72.0%から45.0%に減らしてください
（5営業日以内に実行）

内訳:
DD=1, VT=0.62, Slope=0.95, MomDecel=0.76
→ raw=0.45
```

## リバランス条件

- DD状態遷移（HOLD↔CASH）→ 即実行
- |raw_leverage - 現在ポジション| > 20% → 実行
- それ以外 → 変更しない

## 研究リポジトリ

バックテストの詳細: https://github.com/KazuyaMurayama/NASDAQ_backtest
