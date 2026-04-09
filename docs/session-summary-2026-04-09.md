# セッションサマリー: Dyn 2x3x 通知・スプレッドシート改善
**日付:** 2026年4月9日  
**リポジトリ:** [kazuyamurayama/nasdaq-strategy-gas](https://github.com/KazuyaMurayama/NASDAQ-strategy-gas/tree/claude/implementation-JjBAl)  
**ブランチ:** `claude/implementation-JjBAl`

---

## 1. 変更ファイル一覧

| ファイル | GitHub リンク | Raw（GAS貼り付け用）|
|---|---|---|
| `src/Notify.gs` | [表示](https://github.com/KazuyaMurayama/NASDAQ-strategy-gas/blob/claude/implementation-JjBAl/src/Notify.gs) | [Raw](https://raw.githubusercontent.com/KazuyaMurayama/NASDAQ-strategy-gas/claude/implementation-JjBAl/src/Notify.gs) |
| `src/DailyStatusAgent.gs` | [表示](https://github.com/KazuyaMurayama/NASDAQ-strategy-gas/blob/claude/implementation-JjBAl/src/DailyStatusAgent.gs) | [Raw](https://raw.githubusercontent.com/KazuyaMurayama/NASDAQ-strategy-gas/claude/implementation-JjBAl/src/DailyStatusAgent.gs) |
| `src/StateManager.gs` | [表示](https://github.com/KazuyaMurayama/NASDAQ-strategy-gas/blob/claude/implementation-JjBAl/src/StateManager.gs) | [Raw](https://raw.githubusercontent.com/KazuyaMurayama/NASDAQ-strategy-gas/claude/implementation-JjBAl/src/StateManager.gs) |
| `src/Setup.gs` | [表示](https://github.com/KazuyaMurayama/NASDAQ-strategy-gas/blob/claude/implementation-JjBAl/src/Setup.gs) | [Raw](https://raw.githubusercontent.com/KazuyaMurayama/NASDAQ-strategy-gas/claude/implementation-JjBAl/src/Setup.gs) |

---

## 2. 重要な状況整理

### システム稼働状態
- **本番稼働中**: 毎日 07:00 JST に `dailyUpdate` が自動実行
- **データ**: 359日分のNASDAQ価格履歴を保有
- **直近シグナル**: rawLeverage=19%（2026年4月 関税ショック相場）

### Dyn 2x3x 戦略の現状
```
レジーム: 回復初期（rawLev ≈ 19%）
実保有配分（2026-04-08 時点）:
  TQQQ (NASDAQ 3x):  10.7%  (= 0.1901 × 0.561)
  2036 (Gold 2x):     4.2%  (= 0.1901 × 0.220)
  TMF  (Bond 3x):     4.2%  (= 0.1901 × 0.219)
  CASH (現金):       81.0%  (= 1 - 0.1901)
```

### スプレッドシート構成（現在）
| シート | 内容 |
|---|---|
| PriceHistory | 日次NASDAQ終値（~360行）|
| State | 現在の戦略状態 + D・E列に実保有配分（数式）|
| Log | 24列の日次計算ログ |

---

## 3. このセッションでの変更内容

### 変更① LINE通知フォーマット改善（`Notify.gs` / `DailyStatusAgent.gs`）

**Before（旧フォーマット）:**
```
■ 目標配分:
TQQQ: 56.1%   ← 内部ウェイト（実際の購入額ではない）
2036: 22.0%
TMF:  21.9%
```

**After（新フォーマット）:**
```
[Dyn 2x3x シグナル] 2026-04-03
━━━━━━━━━━━━━━━━
📊 実際の保有配分:
  TQQQ (NASDAQ 3x):  10.7%   ← rawLeverage × w_nasdaq
  2036 (Gold 2x):     4.2%
  TMF  (Bond 3x):     4.2%
  CASH (現金):       80.9%   ← 1 - rawLeverage

⚡ リバランス必要
  2営業日以内に実行してください

参考（内部シグナル）:
  DD=HOLD, rawLev=0.19, w_nasdaq=56.1%
  VT=0.64, Slope=0.41, Mom=0.80, VIX=0.91
  レジーム: 回復初期
━━━━━━━━━━━━━━━━
```

**追加した`getRegimeName_`関数（レジーム判定ロジック）:**
| rawLeverage | レジーム名 |
|---|---|
| DD=CASH | DD発動中（退避）|
| 0〜10% | 防御モード |
| 10〜30% | 回復初期 |
| 30〜50% | 慎重運用 |
| 50〜70% | 通常運用 |
| 70〜90% | 積極運用 |
| 90〜100% | フルインベスト |

---

### 変更② Logシート 20列→24列化（`StateManager.gs` / `Setup.gs`）

**追加した4列（列19〜22）:**
| 列番号 | 列名 | 計算式 |
|---|---|---|
| 19 | `actual_tqqq` | `new_leverage × w_nasdaq` |
| 20 | `actual_gold` | `new_leverage × w_gold` |
| 21 | `actual_bond` | `new_leverage × w_bond` |
| 22 | `actual_cash` | `1 - new_leverage` |

**タイムアウト対策:**
- `getValues()` 一括読み込み → メモリ内計算 → `setValues()` 一括書き込み
- シートAPIは最大3回呼び出しで完結（行ごとのループなし）

---

### 変更③ Stateシート 実保有配分表示追加（`Setup.gs`）

`updateStateActuals()` 実行後、StateシートD・E列に数式が追加:
```
D列: ラベル        E列: 数式（自動更新）
actual_tqqq    =IF(B6="","",B4*B6)
actual_gold    =IF(B7="","",B4*B7)
actual_bond    =IF(B8="","",B4*B8)
actual_cash    =IF(B4="","",1-B4)
```
→ `dailyUpdate` でState更新のたびに自動反映

---

### 変更④ 数値フォーマット修正（`Setup.gs`）

**問題:** `actual_gold`（≈0.04台の小数）がGoogleスプレッドシートに日付（`1899/12/30 1:00`）として誤認識された。

**原因:** Sheetsの日付シリアル値では 0 = 1899/12/30。小数0.04台は「その日の1時間」と解釈される。

**対策:** `setNumberFormat('0.0000')` を明示指定。
- `migrateLogSheet()`: 一括書き込み後にフォーマット適用
- `appendLog_()`: `appendRow()` 後に毎回フォーマット適用
- `fixLogSheetFormat()`: 既存データ修正専用の独立関数を追加（再実行可能・冪等）

---

## 4. 追加された関数一覧

| 関数名 | ファイル | 用途 |
|---|---|---|
| `getRegimeName_()` | Notify.gs | rawLeverageからレジーム名を返す |
| `migrateLogSheet()` | Setup.gs | Logシートを20列→24列に一括変換 |
| `updateStateActuals()` | Setup.gs | StateシートにD・E列の実保有配分を追加 |
| `fixLogSheetFormat()` | Setup.gs | actual列の日付→数値フォーマット修正 |

---

## 5. Claude Code の有効活用ポイント

### GitHub MCPツールによる直接push
- ブラウザのGASエディタには外部からアクセス不可のため、コードはGitHub経由で管理
- `mcp__github__push_files` を使い、複数ファイルを1コミットでpush
- MCPサーバー切断時はサブエージェント経由でpushを継続（セッション中断を回避）

### タイムアウト対策の設計
- GASの6分制限を意識し、シートAPIを最小回数に抑えた設計
- `getValues()` → メモリ処理 → `setValues()` パターンで1000行を1〜2秒で処理

### 冪等設計（再実行安全性）
- `migrateLogSheet()`: `actual_tqqq` 列の存在チェックでスキップ
- `fixLogSheetFormat()`: データ変更なし・フォーマットのみ → 何度でも実行可能

### 問題発生時の迅速なデバッグ
- 「移行済みです」ログから「フォーマット修正が未適用」を即特定
- 既存データを再書き込みせず、フォーマット指定のみの軽量修正関数を追加

---

## 6. このセッションのコミット履歴

| SHA（先頭7桁） | 内容 |
|---|---|
| `5ec830f` | 通知メッセージを実保有比率表示に改善（Notify.gs / DailyStatusAgent.gs）|
| `c220683` | Logシートに実保有比率4列追加、移行関数を実装（StateManager.gs / Setup.gs）|
| `387face` | actual列の日付誤認識を修正: setNumberFormat追加 |
| `f23ff66` | fixLogSheetFormat()を追加: 既存データのフォーマット修正専用関数 |

---

## 7. 次回セッションへの申し送り

### 現在の運用状況
- システムは正常稼働中（毎日07:00 JST）
- 2026年4月は関税ショックのため `rawLeverage ≈ 20%`（回復初期レジーム）
- `rebalanced=YES` は4/3が最後、以降は変化なし（正常）

### 検討中の改善案
- [ ] `STATUS_REPORT.ENABLED = true` にして毎日の日次ステータス通知を有効化するか検討
- [ ] LogシートのGoogle Sheets上でのグラフ化（actual_cash推移など）
- [ ] バックテスト結果との比較検証
