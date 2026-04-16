# タスク管理 — NASDAQ Strategy GAS

最終更新: 2026-04-16

---

## 🔴 未完了（ユーザーアクション必要）

| # | タスク | 詳細 | 優先度 |
|---|--------|------|--------|
| U-1 | **GAS リバランスバグ修正をGoogle Script エディタに反映** | `claude/implementation-JjBAl` ブランチの `src/Code.gs` を開き、Google Script エディタに貼り付けて保存・デプロイ。リバランス判定が `leverageDiff > 0.20` に変わる。 | 🔴 最高 |

**U-1 手順:**
1. GitHubで `src/Code.gs`（`implementation-JjBAl` ブランチ）を開く
2. 内容をコピー
3. [Google Apps Script](https://script.google.com/) → 該当プロジェクト → `Code.gs` を開いて貼り付け
4. 保存（Ctrl+S）→ 「実行」→ `dryRun` で動作確認
5. ログで `レバレッジ差: 34.9%  リバランス: YES` が表示されれば成功

---

## ✅ 完了済み

| # | タスク | 完了日 | 備考 |
|---|--------|--------|------|
| C-1 | リバランスバグ特定（`calcMaxDrift` による weight比率チェックが原因） | 2026-04-16 | raw=0.5389, current=0.1901 で差0.3488>0.20 なのに NO になっていた |
| C-2 | バグ修正コードを `implementation-JjBAl` にプッシュ | 2026-04-16 | `leverageDiff` ベースの判定に変更。`dailyUpdate` + `dryRun` 両方修正 |

---

## 📋 バックログ

| # | タスク | 概要 |
|---|--------|------|
| B-1 | 毎日ステータス通知の有効化検討 | `CONFIG.STATUS_REPORT.ENABLED: true` にすると毎日通知が届く |
| B-2 | GAS 実行後の State 更新確認 | 修正反映後、翌日の自動実行で State の current_leverage が 0.5389 に更新されることを確認 |
