# Tasks — nasdaq-strategy-gas

最終更新: 2026-04-21

## 🔴 In Progress
(なし)

## 🟡 Pending
- [ ] 切替後初回 dailyUpdate の挙動確認（Approach A + T=0.15 で自動リバランス指示、Gold/Bond が 0 にならない）
- [ ] 1ヶ月運用後の OOS パフォーマンス vs バックテスト乖離 < 1% 確認
- [ ] 取引回数 +43% の実口座でのスプレッド・スリッページ影響測定

## ✅ Completed
- **2026-04-21: リバランス閾値 0.20 → 0.15 へ変更** (IS CAGR +0.5pp / Sharpe +0.007 / MaxDD +1.2pp)
  - [docs/THRESHOLD_CHANGE_2026-04-21.md](docs/THRESHOLD_CHANGE_2026-04-21.md)
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
