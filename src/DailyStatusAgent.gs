/**
 * DailyStatusAgent.gs - 日次サマリー通知エージェント
 *
 * 目的: リバランスがない日も毎日の計算結果をサマリーとして通知する。
 *       「今日は動きなし」を確認できることで、システムが正常動作中か判断できる。
 *
 * 設定:
 *   CONFIG.STATUS_REPORT.ENABLED - true で毎日通知 (デフォルト: false)
 *   CONFIG.STATUS_REPORT.HOUR    - 通知するJST時刻 (デフォルト: 7 = 07:xx)
 *
 * 注意: dailyUpdate() から呼ばれる。単独トリガーは不要。
 */

// DailyStatusAgent の設定は CONFIG.STATUS_REPORT で管理
// Code.gs の CONFIG に追加が必要:
//   STATUS_REPORT: { ENABLED: false }

/**
 * 日次ステータスサマリーを送信（リバランス有無に関わらず）
 * dailyUpdate() の末尾から呼ぶ。
 *
 * @param {Object} entry   - ログエントリ（dailyUpdate() が組み立てたもの）
 * @param {boolean} rebalanced - 本日リバランスしたか
 */
function sendDailyStatus(entry, rebalanced) {
  // 未設定、または無効なら何もしない
  var statusEnabled = CONFIG.STATUS_REPORT && CONFIG.STATUS_REPORT.ENABLED;
  if (!statusEnabled) return;
  // リバランス当日は sendNotification_ が送っているので重複しない
  if (rebalanced) return;

  var w = entry.w_nasdaq != null
    ? 'TQQQ=' + pct_(entry.w_nasdaq) + ' / Gold=' + pct_(entry.w_gold) + ' / Bond=' + pct_(entry.w_bond)
    : '未設定';

  var lines = [
    '[Dyn 2x3x 日次ステータス]',
    '日付: '    + entry.date,
    'NASDAQ: '   + entry.close,
    '',
    'DD: '       + entry.dd_state,
    'VIX_z: '    + r2_(entry.vix_z, 2),
    'rawLev: '   + r2_(entry.raw_leverage, 3),
    '',
    '現在配分: ' + w,
    'リバランス: なし'
  ];
  var message = lines.join('\n');

  if (CONFIG.LINE.CHANNEL_ACCESS_TOKEN && CONFIG.LINE.USER_ID) {
    sendLineMessage_(message);
  }
  if (CONFIG.EMAIL) {
    try {
      MailApp.sendEmail({
        to:      CONFIG.EMAIL,
        subject: '[Dyn 2x3x] 日次ステータス ' + entry.date,
        body:    message
      });
    } catch (e) {
      Logger.log('日次ステータスメール失敗: ' + e.message);
    }
  }
}
