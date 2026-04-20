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
  var hasWeights = entry.w_nasdaq != null;
  // Approach A: スリーブ独立型 (Gold/Bondは常時保有、CASHはNASDAQバッファのみ)
  var holdings = hasWeights ? calcActualHoldings(lev, {
    w_nasdaq: entry.w_nasdaq, w_gold: entry.w_gold, w_bond: entry.w_bond
  }) : null;

  var regime    = getRegimeName_(entry.dd_state, entry.raw_leverage);
  var fwdCagr   = formatFwdReturn_(entry.forward_cagr_5d);
  var fwdMedian = formatFwdReturn_(entry.forward_median_5d);
  var isDD      = (entry.dd_state === 'CASH');

  var headerLines = [
    '[Dyn 2x3x 日次ステータス] ' + entry.date,
    '━━━━━━━━━━━━━━━━'
  ];
  if (isDD) {
    headerLines.push('⚠️ DD発動中: TQQQのみ全額キャッシュ化。');
    headerLines.push('   Gold/Bond (2036/TMF) は常時保有のため売却しません。');
    headerLines.push('');
  }
  var lines = headerLines.concat([
    '📊 現在の保有配分 (Approach A / スリーブ独立):',
    '  TQQQ (NASDAQ 3x):  ' + (holdings ? pct_(holdings.actual_tqqq) + (isDD ? ' ← DDのため0%' : '') : 'N/A'),
    '  2036 (Gold 2x):    ' + (holdings ? pct_(holdings.actual_gold) + ' ※常時保有' : 'N/A'),
    '  TMF  (Bond 3x):    ' + (holdings ? pct_(holdings.actual_bond) + ' ※常時保有' : 'N/A'),
    '  CASH (NASDAQバッファ): ' + (holdings ? pct_(holdings.actual_cash) : 'N/A'),
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
  ]);
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
