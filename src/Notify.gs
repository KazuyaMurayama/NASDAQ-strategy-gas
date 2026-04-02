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
    w_nasdaq: 0.744, w_gold: 0.128, w_bond: 0.128, rebalanced: true
  };
  sendNotification_(entry);
  Logger.log('テスト通知を送信しました');
}


// ===== プライベート =====

function buildRebalanceMessage_(e) {
  return '[Dyn 2x3x シグナル]\n' +
    '日付: ' + e.date + '  DD: ' + e.dd_state + '\n' +
    '\n' +
    '■ 目標配分:\n' +
    'TQQQ (NASDAQ 3x): ' + pct_(e.w_nasdaq) + '\n' +
    '2036 (Gold 2x):   ' + pct_(e.w_gold)   + '\n' +
    'TMF  (Bond 3x):   ' + pct_(e.w_bond)   + '\n' +
    '\n' +
    'レバレッジ: ' + pct_(e.prev_leverage) + ' → ' + pct_(e.new_leverage) + '\n' +
    '\n' +
    'DD='       + r2_(e.dd_value,   2) +
    ' VT='      + r2_(e.vt,         2) +
    ' Slope='   + r2_(e.slope_mult, 2) +
    ' MomD='    + r2_(e.mom_decel,  2) +
    ' VIXmul='  + r2_(e.vix_mult,   2) + '\n' +
    'VIX_z='    + r2_(e.vix_z, 2) +
    ' raw='     + r2_(e.raw_leverage, 3) + '\n' +
    '\n' +
    'NASDAQ終値: ' + e.close;
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
