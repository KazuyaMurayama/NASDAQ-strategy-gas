/**
 * Notify.gs - LINE Messaging API / Email 通知
 *
 * LINE Notify は2025年3月に終了したため、LINE Messaging API を使用。
 */

/**
 * リバランス通知を送信
 * @param {Object} entry - ログエントリ
 */
function sendNotification_(entry) {
  var message = buildRebalanceMessage_(entry);
  dispatch_(entry.date, message, false);
}

/**
 * エラー通知
 * @param {Error} error
 */
function sendErrorNotification_(error) {
  var message = '[Dyn 2x3x エラー]\n' +
    '日時: ' + new Date().toLocaleString('ja-JP') + '\n' +
    error.message + '\n' +
    (error.stack || '');
  dispatch_(null, message, true);
}

/**
 * 通知テスト用
 */
function testNotification() {
  var entry = {
    date: today_(), close: 17500,
    dd_state: 'HOLD', dd_value: 1.0,
    asym_vol: 0.22, trend_tv: 0.22, vt: 0.90,
    slope_mult: 0.95, mom_decel: 0.88,
    vix_proxy: 0.18, vix_z: -0.5, vix_mult: 1.125,
    raw_leverage: 0.76, prev_leverage: 0.80, new_leverage: 0.76,
    w_nasdaq: 0.744, w_gold: 0.128, w_bond: 0.128, rebalanced: true,
    forward_cagr_5d: 35.0, forward_median_5d: 0.71  // 70-90%×60-85%
  };
  sendNotification_(entry);
  Logger.log('テスト通知を送信しました');
}


// ===== プライベート =====

/**
 * レジーム名を判定
 * @param {string} ddState - 'HOLD' or 'CASH'
 * @param {number} rawLeverage - 0〜1
 * @return {string} レジーム名
 */
function getRegimeName_(ddState, rawLeverage) {
  if (ddState === 'CASH') return 'DD発動中（退避）';
  var lev = rawLeverage * 100;
  if (lev < 10)  return '防御モード';
  if (lev < 30)  return '回復初期';
  if (lev < 50)  return '慎重運用';
  if (lev < 70)  return '通常運用';
  if (lev < 90)  return '積極運用';
  return 'フルインベスト';
}


function buildRebalanceMessage_(e) {
  var lev = e.new_leverage;
  // Approach A: Gold/Bond は lev非依存・常時保有、CASHはNASDAQスリーブ内バッファのみ
  var holdings = calcActualHoldings(lev, {
    w_nasdaq: e.w_nasdaq, w_gold: e.w_gold, w_bond: e.w_bond
  });

  var regime    = getRegimeName_(e.dd_state, e.raw_leverage);
  var fwdCagr   = formatFwdReturn_(e.forward_cagr_5d);
  var fwdMedian = formatFwdReturn_(e.forward_median_5d);

  var lines = [
    '[Dyn 2x3x シグナル] ' + e.date,
    '━━━━━━━━━━━━━━━━',
    '📊 実際の保有配分 (Approach A / スリーブ独立):',
    '  TQQQ (NASDAQ 3x):  ' + pct_(holdings.actual_tqqq),
    '  2036 (Gold 2x):    ' + pct_(holdings.actual_gold) + ' ※常時保有',
    '  TMF  (Bond 3x):    ' + pct_(holdings.actual_bond) + ' ※常時保有',
    '  CASH (NASDAQバッファ): ' + pct_(holdings.actual_cash),
    '',
    '📈 5営業日後フォワードリターン（過去統計）:',
    '  CAGR年率: ' + fwdCagr + '  中央値: ' + fwdMedian,
    '',
    '⚡ リバランス必要',
    '  2営業日以内に実行してください',
    '',
    '参考（内部シグナル）:',
    '  DD=' + e.dd_state +
      ', rawLev=' + r2_(e.raw_leverage, 2) +
      ', w_nasdaq=' + pct_(e.w_nasdaq),
    '  VT=' + r2_(e.vt, 2) +
      ', Slope=' + r2_(e.slope_mult, 2) +
      ', Mom=' + r2_(e.mom_decel, 2) +
      ', VIX=' + r2_(e.vix_mult, 2),
    '  レジーム: ' + regime,
    '  NASDAQ終値: ' + e.close,
    '━━━━━━━━━━━━━━━━'
  ];
  return lines.join('\n');
}


function dispatch_(date, message, isError) {
  var sent = false;

  if (CONFIG.LINE.CHANNEL_ACCESS_TOKEN && CONFIG.LINE.USER_ID) {
    sendLineMessage_(message);
    sent = true;
  }

  if (CONFIG.EMAIL) {
    var subject = isError
      ? '[Dyn 2x3x] エラー発生'
      : '[Dyn 2x3x] リバランスシグナル ' + (date || '');
    try {
      MailApp.sendEmail({ to: CONFIG.EMAIL, subject: subject, body: message });
      sent = true;
    } catch (e) {
      Logger.log('メール送信失敗: ' + e.message);
    }
  }

  if (!sent) {
    Logger.log('=== 通知（送信先未設定） ===\n' + message);
  }
}


function sendLineMessage_(message) {
  var url = 'https://api.line.me/v2/bot/message/push';
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + CONFIG.LINE.CHANNEL_ACCESS_TOKEN },
    payload: JSON.stringify({ to: CONFIG.LINE.USER_ID,
                               messages: [{ type: 'text', text: message }] }),
    muteHttpExceptions: true
  };
  try {
    var code = UrlFetchApp.fetch(url, options).getResponseCode();
    if (code !== 200) Logger.log('LINEエラー: HTTP ' + code);
    else Logger.log('LINE送信成功');
  } catch (e) {
    Logger.log('LINE例外: ' + e.message);
  }
}
