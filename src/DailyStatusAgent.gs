/**
 * DailyStatusAgent.gs - 日次サマリー通知エージェント
 *
 * 目的: リバランスがない日も毎日の計算結果をサマリーとして通知する。
 *       「今日は動きなし」を確認できることで、システムが正常動作中か判断できる。
 *
 * 設定:
 *   CONFIG.STATUS_REPORT.ENABLED - true で毎日通知 (デフォルト: false)
 *
 * 注意: dailyUpdate() から呼ばれる。単独トリガーは不要。
 */

/**
 * 日次ステータスサマリーを送信（リバランス有無に関わらず）
 * dailyUpdate() の末尾から呼ぶ。
 *
 * @param {Object} entry   - ログエントリ（dailyUpdate() が組み立てたもの）
 * @param {boolean} rebalanced - 本日リバランスしたか
 */
function sendDailyStatus(entry, rebalanced) {
  var statusEnabled = CONFIG.STATUS_REPORT && CONFIG.STATUS_REPORT.ENABLED;
  if (!statusEnabled) return;
  // リバランス当日は sendNotification_ が送っているので重複しない
  if (rebalanced) return;

  var lev = entry.new_leverage != null ? entry.new_leverage : 0;
  var actualNasdaq = entry.w_nasdaq != null ? lev * entry.w_nasdaq : null;
  var actualGold   = entry.w_gold   != null ? lev * entry.w_gold   : null;
  var actualBond   = entry.w_bond   != null ? lev * entry.w_bond   : null;
  var actualCash   = 1 - lev;

  var regime = getRegimeName_(entry.dd_state, entry.raw_leverage);

  var hasWeights = entry.w_nasdaq != null;

  // フォワードリターン表示
  var fwdCagr   = (entry.forward_cagr_5d   != null && entry.forward_cagr_5d   !== '')
                  ? '+' + entry.forward_cagr_5d   + '%' : 'N/A';
  var fwdMedian = (entry.forward_median_5d != null && entry.forward_median_5d !== '')
                  ? '+' + entry.forward_median_5d + '%' : 'N/A';

  var lines = [
    '[Dyn 2x3x 日次ステータス] ' + entry.date,
    '━━━━━━━━━━━━━━━━',
    '📊 現在の保有配分:',
    '  TQQQ (NASDAQ 3x):  ' + (hasWeights ? pct_(actualNasdaq) : 'N/A'),
    '  2036 (Gold 2x):    ' + (hasWeights ? pct_(actualGold)   : 'N/A'),
    '  TMF  (Bond 3x):    ' + (hasWeights ? pct_(actualBond)   : 'N/A'),
    '  CASH (現金):       ' + (hasWeights ? pct_(actualCash)   : 'N/A'),
    '',
    '📈 5営業日後フォワードリターン（過去統計）:',
    '  CAGR年率: ' + fwdCagr + '  中央値: ' + fwdMedian,
    '',
    '✅ リバランス不要',
    '',
    '参考（内部シグナル）:',
    '  DD=' + entry.dd_state +
      ', rawLev=' + r2_(entry.raw_leverage, 2) +
      ', w_nasdaq=' + (hasWeights ? pct_(entry.w_nasdaq) : 'N/A'),
    '  VT=' + r2_(entry.vt, 2) +
      ', Slope=' + r2_(entry.slope_mult, 2) +
      ', Mom=' + r2_(entry.mom_decel, 2) +
      ', VIX=' + r2_(entry.vix_mult, 2),
    '  レジーム: ' + regime,
    '  NASDAQ終値: ' + entry.close,
    '━━━━━━━━━━━━━━━━'
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
