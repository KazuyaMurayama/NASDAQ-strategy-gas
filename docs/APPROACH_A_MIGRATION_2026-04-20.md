# Approach B → Approach A 切替記録

**実施日**: 2026-04-20
**対象戦略**: Dyn 2x3x A2 Optimized
**目的**: 全期間CAGR +24.46% (B) → +30.30% (A) への移行

---

## 1. 切替理由

研究リポジトリ [NASDAQ_backtest](https://github.com/KazuyaMurayama/NASDAQ_backtest) の検証結果より、
**スリーブ独立型 (Approach A) が 7指標中 6指標で統合レバレッジ型 (Approach B) を上回る**。

| 指標 | 優先度 | 現行 B | 提案 A | 差 |
|------|--------|--------|--------|-----|
| **CAGR (Full 1974-2026)** | ★5 | +24.46% | **+30.30%** | **+5.84pp** ✅ |
| **CAGR (IS 1974-2021)** | ★5 | +24.70% | **+30.89%** | +6.19pp ✅ |
| **CAGR (OOS 2021-2026)** | ★5 | +22.57% | **+25.15%** | +2.58pp ✅ |
| **Worst5Y** | ★5 | +3.3% | **+5.3%** | +2.0pp ✅ |
| **Sharpe (IS)** | ★5 | 1.167 | **1.331** | +0.164 ✅ |
| **MaxDD (IS)** | ★4 | -33.9% | **-32.6%** | +1.3pp ✅ |
| MaxDD (OOS) | ★4 | **-24.2%** | -29.2% | -5.0pp ⚠️ |
| WinRate | ― | 74.5% | **85.1%** | +10.6pp ✅ |

⚠️ **OOS MaxDD のみ B 優位**: 2022年のGold/Bond同時下落（インフレ+利上げ）が要因。長期では A が優位のため許容。

---

## 2. 設計の差分

### 旧 (Approach B / 統合レバレッジ方式)
```
TQQQ = lev × w_nasdaq
Gold = lev × w_gold        ← lev 乗算あり
Bond = lev × w_bond        ← lev 乗算あり
CASH = 1 - lev             ← 全体現金
```
**DD発動時 (lev=0): 全額キャッシュ → Gold/Bond も売却**

### 新 (Approach A / スリーブ独立方式) ★現行★
```
TQQQ = lev × w_nasdaq                  (NASDAQスリーブ内TQQQ)
Gold = w_gold                           (lev非依存・常時保有)
Bond = w_bond                           (lev非依存・常時保有)
CASH = (1 - lev) × w_nasdaq             (NASDAQスリーブ内バッファのみ)
```
**DD発動時 (lev=0): NASDAQスリーブのみ全額キャッシュ、Gold/Bondは継続保有**

合計検算: `lev·w_n + w_g + w_b + (1-lev)·w_n = w_n + w_g + w_b = 1.000` ✓

---

## 3. 実装変更ファイル

| ファイル | 変更内容 | 行数 |
|----------|---------|------|
| `src/Allocation.gs` | `calcActualHoldings()` 関数追加 | +25行 |
| `src/StateManager.gs` | `appendLog_` 内 C-F列を Approach A 式へ | ±10行 |
| `src/Notify.gs` | `buildRebalanceMessage_` 内表示変更 | ±8行 |
| `src/DailyStatusAgent.gs` | `sendDailyStatus` 内表示変更 | ±9行 |
| `src/Code.gs` | ヘッダーコメント・dryRun()ログ更新 | ±20行 |

### 中核関数 (Allocation.gs:46-66)
```javascript
function calcActualHoldings(rawLeverage, targetWeights) {
  var wN = targetWeights.w_nasdaq;
  var wG = targetWeights.w_gold;
  var wB = targetWeights.w_bond;
  return {
    actual_tqqq: rawLeverage * wN,         // NASDAQスリーブ内TQQQ
    actual_gold: wG,                        // lev非依存
    actual_bond: wB,                        // lev非依存
    actual_cash: (1 - rawLeverage) * wN    // NASDAQスリーブ内バッファのみ
  };
}
```

---

## 4. ロジック検証結果 (2026-04-20)

`/tmp/verify_approach_a.js` で4ケース検証 → **全ケース理論値と一致 (diff 0.000pp、合計1.000)**

| ケース | rawLev | w_n | actual_tqqq | actual_gold | actual_bond | actual_cash | 合計 |
|--------|--------|-----|-------------|-------------|-------------|-------------|------|
| Low lev | 0.19 | 0.56 | 0.1064 | 0.2200 | 0.2200 | 0.4536 | 1.0000 ✓ |
| Full lev | 1.00 | 0.80 | 0.8000 | 0.1000 | 0.1000 | 0.0000 | 1.0000 ✓ |
| DD trigger | 0.00 | 0.55 | 0.0000 | 0.2250 | 0.2250 | 0.5500 | 1.0000 ✓ |
| Mid lev | 0.50 | 0.65 | 0.3250 | 0.1750 | 0.1750 | 0.3250 | 1.0000 ✓ |

⚠️ **DD trigger 行が B/A の決定的差異**: B 方式では actual_gold/bond=0 だが、A 方式では w_gold/w_bond をそのまま保有継続。

---

## 5. 移行時の挙動

### ⚠️ 切替後初日は必ずリバランス指示が発動します

切替直後の初回 `dailyUpdate` では、以下の理由により **100% の確率でリバランス通知が発動** します。運用者は想定しておくこと。

**理由**:
- State シートに保存された `current_weights` は旧B方式下で記録された値
- 新A方式では実保有の意味が変わる（Gold/Bond は lev 非依存・常時保有）
- 保有していた (lev × w_gold) → (w_gold そのまま) への切替で大きな保有量変化が発生

**想定される指示の例** (切替前 lev=0.40, w_gold=w_bond=0.20 の場合):
| 資産 | 切替前 (B) | 切替後 (A) | 差分 |
|------|-----------|-----------|------|
| TQQQ | 0.40 × 0.60 = 24% | 0.40 × 0.60 = 24% | 変化なし |
| Gold | 0.40 × 0.20 = 8% | 0.20 | **+12pp 買増し** |
| Bond | 0.40 × 0.20 = 8% | 0.20 | **+12pp 買増し** |
| CASH | 1 − 0.40 = 60% | (1−0.40) × 0.60 = 36% | −24pp 減 |

**⚠️ 運用者アクション**: 初回通知は「通常の売買以上の出来高」になる可能性が高い。指示通り執行すれば問題なし。

### 初回 dailyUpdate の自動リバランス
1. 新ロジックで `rawLev` 計算（変更なし）
2. 配分式は同じ（`calcAllocation()` は変更なし）
3. 実保有計算のみ B → A へ切替
4. State シートの `current_leverage` が前日値と異なれば自動リバランス指示
5. 通知に「Approach A / スリーブ独立」表示

### Log シート列定義の互換性
- C列 `actual_tqqq` = `lev × w_nasdaq` → 意味変わらず
- D列 `actual_gold` = `w_gold` （旧: `lev × w_gold`）→ **意味変更**
- E列 `actual_bond` = `w_bond` （旧: `lev × w_bond`）→ **意味変更**
- F列 `actual_cash` = `(1-lev) × w_nasdaq` （旧: `1 - lev`）→ **意味変更**

過去の Log 行は旧式値のまま残るが、列定義変更日を以て新式へ。

---

## 6. ロールバック手順

問題発生時の B 方式戻し方法:

### Step 1: Allocation.gs から `calcActualHoldings()` を削除（または残置）

### Step 2: 4ファイルで以下に置換

**StateManager.gs::appendLog_** (C-F列):
```javascript
r2_(lev * wN, 4),    // C: actual_tqqq
r2_(lev * wG, 4),    // D: actual_gold
r2_(lev * wB, 4),    // E: actual_bond
r2_(1 - lev,  4),    // F: actual_cash
```

**Notify.gs::buildRebalanceMessage_**:
```javascript
var actualNasdaq = lev * e.w_nasdaq;
var actualGold   = lev * e.w_gold;
var actualBond   = lev * e.w_bond;
var actualCash   = 1 - lev;
```

**DailyStatusAgent.gs::sendDailyStatus**: 同上パターン

**Code.gs**: ヘッダーコメントを「Approach B 統合レバレッジ」に戻す

### Step 3: コミット
```bash
git revert <approach_a_migration_commit_sha>
git push -u origin main
```

---

## 7. 関連リンク

- 提案書: [APPROACH_A_PROPOSAL_2026-04-20.md](https://github.com/KazuyaMurayama/NASDAQ_backtest/blob/main/APPROACH_A_PROPOSAL_2026-04-20.md)
- 検証レポート: [YEARLY_RETURNS_REPORT_2026-04-20_v2.md](https://github.com/KazuyaMurayama/NASDAQ_backtest/blob/main/YEARLY_RETURNS_REPORT_2026-04-20_v2.md)
- 閾値スイープ: [THRESHOLD_SWEEP_REPORT_2026-04-20.md](https://github.com/KazuyaMurayama/NASDAQ_backtest/blob/main/THRESHOLD_SWEEP_REPORT_2026-04-20.md)
- 作成: 男座員也 / おざ かずや / Kazuya Oza
