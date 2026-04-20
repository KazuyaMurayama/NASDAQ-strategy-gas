# Tasks — nasdaq-strategy-gas

最終更新: 2026-04-20

## 🔴 In Progress
(なし)

## 🟡 Pending
- [ ] 切替後初回 dailyUpdate の挙動確認（自動リバランス指示が出ること、Gold/Bond が 0 にならないこと）
- [ ] 1ヶ月運用後の OOS パフォーマンス vs バックテスト乖離 < 1% 確認
- [ ] リバランス閾値スイープ検証 (T=0.15 vs T=0.20 詳細比較)
  - IS=1974-2021-05-07 / OOS=2021-05-08-2026-03-28 / Walk-Forward 3窓
  - 選定はIS単独、OOS/WFは事後確認のみ（再選定禁止）
  - 実装は `nasdaq_backtest/src/test_threshold_sweep.py`

## ✅ Completed
- **2026-04-20: 戦略を Approach B → Approach A へ切替** (CAGR +24.46% → +30.30% 期待)
  - Allocation.gs: `calcActualHoldings()` 追加
  - StateManager.gs / Notify.gs / DailyStatusAgent.gs: スリーブ独立式へ
  - Code.gs: ヘッダーコメント・dryRun() ログ更新
  - 検証: 4ケース全て理論値と一致 (diff 0.000pp)
  - 詳細: [docs/APPROACH_A_MIGRATION_2026-04-20.md](docs/APPROACH_A_MIGRATION_2026-04-20.md)
- 2026-04-20: GAS実装の本番運用テスト
- 2026-04-20: エラー通知（LINE）の実機確認
- 2026-04-20: バックテスト結果との整合性検証（四半期ごと）
- 2026-04-19: main 単一ブランチ運用確立（他ブランチ全削除）
- 2026-04-19: 運用ルール整備（CLAUDE.md / docs/rules/ 群 / tasks.md / FILE_INDEX.md）
- 2026-04-17: Allocation.gs / DailyStatusAgent.gs / ForwardReturn.gs / HealthCheckAgent.gs 追加
- 2026-04-16: Code.gs 最終更新（ForwardReturn 参照追加）
- 2026-04-02: **Dyn 2x3x A2 Optimized 最終実装**（AIエージェント統合）
