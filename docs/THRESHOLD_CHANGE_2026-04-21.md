# リバランス閾値変更記録: 0.20 → 0.15

**実施日**: 2026-04-21
**変更者**: 男座員也 / おざ かずや / Kazuya Oza
**対象**: `CONFIG.REBALANCE.THRESHOLD` (`src/Code.gs`)

---

## 1. 変更内容

```diff
- THRESHOLD: 0.20
+ THRESHOLD: 0.15
```

リバランス判定式（変更なし、閾値のみ変更）:
```
shouldRebalance = ddToZero OR ddFromZero OR |rawLev - currentLev| > THRESHOLD
```

---

## 2. 変更理由

別セッションでの閾値スイープ検証（[THRESHOLD_SWEEP_REPORT_2026-04-20.md](https://github.com/KazuyaMurayama/NASDAQ_backtest/blob/main/THRESHOLD_SWEEP_REPORT_2026-04-20.md)）より、T=0.15 が T=0.20 より以下指標で優位:

| 指標 | T=0.20 (旧) | T=0.15 (新) | 差 |
|------|------------|------------|-----|
| IS CAGR | 30.9% | **31.4%** | +0.5pp ✅ |
| IS Sharpe | 1.331 | **1.338** | +0.007 ✅ |
| IS MaxDD | -32.6% | **-31.4%** | +1.2pp ✅ |
| OOS CAGR (2021-2026) | 25.1% | **25.5%** | +0.4pp ✅ |
| IS Worst5Y | **+5.3%** | +4.8% | -0.5pp ⚠️ |
| **取引回数** | 881 | **1,259** | **+43%** ⚠️ |

**優位**: CAGR / Sharpe / MaxDD 全て改善
**代償**: 取引回数が +43%（24営業日/年 vs 17営業日/年）

---

## 3. リスクと許容判断

### ⚠️ 取引回数 +43% の影響

- バックテストには TQQQ 0.86% / Gold2x 0.5% / Bond3x 0.91% の経費率が組込済
- しかし**スプレッド・スリッページは未計上**
- 実口座では年間 +7営業日 のリバランス執行増加（=買増/売却が年7回増）

### 運用者への影響

- LINE/Email通知: 年間約1.4倍に増加
- 証券口座での執行: 月2回程度（従来1.5回）

### 判定

CAGR/Sharpe/MaxDD 全指標で改善のため採用。通知頻度増加は許容。

---

## 4. ロールバック手順

万一 T=0.15 で問題発生時の戻し方:

1. `src/Code.gs` の `CONFIG.REBALANCE.THRESHOLD: 0.15` → `0.20` に戻す
2. コミット → push

```bash
git revert <this_commit_sha>
git push -u origin main
```

State シートは変更不要（既存 current_leverage をそのまま使用）。

---

## 5. 関連リンク

- 元提案: [APPROACH_A_PROPOSAL_2026-04-20.md](https://github.com/KazuyaMurayama/NASDAQ_backtest/blob/main/APPROACH_A_PROPOSAL_2026-04-20.md) §閾値スイープ結果
- 前日の切替記録: [APPROACH_A_MIGRATION_2026-04-20.md](APPROACH_A_MIGRATION_2026-04-20.md)
