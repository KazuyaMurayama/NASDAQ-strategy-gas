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

**一次根拠**: [THRESHOLD_SWEEP_A_REPORT_2026-04-21.md](https://github.com/KazuyaMurayama/NASDAQ_backtest/blob/main/THRESHOLD_SWEEP_A_REPORT_2026-04-21.md) — **Approach A 内での閾値スイープ検証、明示的に「推奨: 0.15」**

T=0.15 vs 現行 T=0.20（Approach A、FULL期間 52.26年）:

| 指標 | T=0.20 (旧) | T=0.15 (新) | 差 |
|------|------------|------------|-----|
| **FULL CAGR** | 30.30% | **30.81%** | +0.51pp ✅ |
| IS CAGR | 30.89% | **31.42%** | +0.53pp ✅ |
| OOS CAGR | 25.15% | **25.49%** | +0.34pp ✅ |
| FULL Sharpe | 1.291 | **1.298** | +0.007 ✅ |
| FULL MaxDD | -32.55% | **-31.36%** | +1.19pp ✅ |
| WinRate | 83.02% | **83.02%** | 同率 ✅ |
| IS Worst5Y | **+5.32%** | +4.77% | -0.55pp ⚠️ |
| **取引回数/年** | 18.8 | **27.1** | **+44%** ⚠️ |

**優位**: CAGR (FULL/IS/OOS) / Sharpe / MaxDD / WinRate が改善または同率
**代償**: 取引回数が +44%（月2.3回 vs 月1.6回）。ただし GAS自動執行のためオペ負担は無視可能（研究側明記）
**懸念（WF2）**: 2015-19低ボラ期のみ CAGR -1.98pp 劣化 → 長期では他期間の優位で相殺

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
