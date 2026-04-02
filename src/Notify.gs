/**
 * Notify.gs - LINE Messaging API / Email 通知
 *
 * LINE Notify は2025年3月に終了したため、LINE Messaging API を使用
 */

/**
 * リバランス通知を送信
 * @param {Object} entry - ログエントリ
 */
function sendNotification_(entry) {
  var wNasdaq = (entry.w_nasdaq * 100).toFixed(1);
  var wGold   = (entry.w_gold   * 100).toFixed(1);
  var wBond   = (entry.w_bond   * 100).toFixed(1);
  var prevPct = (entry.prev_leverage * 100).toFixed(1);
  var newPct  = (entry.new_leverage  * 100).toFixed(1);

  var message =
    '[Dyn 2x3x \u30b7\u30b0\u30ca\u30eb]\n' +
    '\u65e5\u4ed8: ' + entry.date + '\n' +
    'DD\u72b6\u614b: ' + entry.dd_state + '\n' +
    '\n' +
    '\u25a0 \u76ee\u6a19\u914d\u5206:\n' +
    'TQQQ (NASDAQ 3x): ' + wNasdaq + '%\n' +
    '2036 (Gold 2x):   ' + wGold   + '%\n' +
    'TMF  (Bond 3x):   ' + wBond   + '%\n' +
    '\n' +
    '\u30ec\u30d0\u30ec\u30c3\u30b8: ' + prevPct + '% \u2192 ' + newPct + '%\n' +
    '\n' +
    '\u5185\u8a33:\n' +
    'DD='       + roundTo_(entry.dd_value,   2) +
    ', VT='     + roundTo_(entry.vt,         2) +
    ', Slope='  + roundTo_(entry.slope_mult, 2) +
    ', MomD='   + roundTo_(entry.mom_decel,  2) +
    ', VIXmul=' + roundTo_(entry.vix_mult,   2) + '\n' +
    'VIX_z=' + roundTo_(entry.vix_z, 2) +
    ', raw='    + roundTo_(entry.raw_leverage, 3) + '\n' +
    '\n' +
    'NASDAQ\u7d42\u5024: ' + entry.close;

  // LINE\u901a\u77e5
  if (CONFIG.LINE.CHANNEL_ACCESS_TOKEN && CONFIG.LINE.USER_ID) {
    sendLineMessage_(message);
  }

  // \u30e1\u30fc\u30eb\u901a\u77e5
  if (CONFIG.EMAIL) {
    sendEmailNotify_(entry.date, message);
  }

  // \u3069\u3061\u3089\u3082\u672a\u8a2d\u5b9a\u306e\u5834\u5408\u306f\u30ed\u30b0\u306b\u51fa\u529b
  if ((!CONFIG.LINE.CHANNEL_ACCESS_TOKEN || !CONFIG.LINE.USER_ID) && !CONFIG.EMAIL) {
    Logger.log('=== \u901a\u77e5\u5185\u5bb9\uff08\u9001\u4fe1\u5148\u672a\u8a2d\u5b9a\uff09 ===');
    Logger.log(message);
  }
}


/**
 * LINE Messaging API \u3067\u30d7\u30c3\u30b7\u30e5\u30e1\u30c3\u30bb\u30fc\u30b8\u9001\u4fe1
 * @param {string} message
 */
function sendLineMessage_(message) {
  var token = CONFIG.LINE.CHANNEL_ACCESS_TOKEN;
  var userId = CONFIG.LINE.USER_ID;
  if (!token || !userId) return;

  var url = 'https://api.line.me/v2/bot/message/push';
  var payload = {
    to: userId,
    messages: [
      {
        type: 'text',
        text: message
      }
    ]
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    if (code === 200) {
      Logger.log('LINE\u901a\u77e5\u9001\u4fe1\u6210\u529f');
    } else {
      Logger.log('LINE\u901a\u77e5\u30a8\u30e9\u30fc: HTTP ' + code + ' - ' + response.getContentText());
    }
  } catch (e) {
    Logger.log('LINE\u901a\u77e5\u4f8b\u5916: ' + e.message);
  }
}


/**
 * Email\u3067\u30e1\u30c3\u30bb\u30fc\u30b8\u9001\u4fe1
 * @param {string} date - \u65e5\u4ed8
 * @param {string} body - \u672c\u6587
 */
function sendEmailNotify_(date, body) {
  if (!CONFIG.EMAIL) return;

  try {
    MailApp.sendEmail({
      to: CONFIG.EMAIL,
      subject: '[Dyn 2x3x] \u30ea\u30d0\u30e9\u30f3\u30b9\u30b7\u30b0\u30ca\u30eb ' + date,
      body: body
    });
    Logger.log('\u30e1\u30fc\u30eb\u901a\u77e5\u9001\u4fe1\u6210\u529f: ' + CONFIG.EMAIL);
  } catch (e) {
    Logger.log('\u30e1\u30fc\u30eb\u901a\u77e5\u4f8b\u5916: ' + e.message);
  }
}


/**
 * \u30a8\u30e9\u30fc\u901a\u77e5
 * @param {Error} error
 */
function sendErrorNotification_(error) {
  var message =
    '[Dyn 2x3x \u30a8\u30e9\u30fc]\n' +
    '\u65e5\u6642: ' + new Date().toLocaleString('ja-JP') + '\n' +
    '\u30a8\u30e9\u30fc: ' + error.message + '\n' +
    '\u30b9\u30bf\u30c3\u30af: ' + (error.stack || 'N/A');

  if (CONFIG.LINE.CHANNEL_ACCESS_TOKEN && CONFIG.LINE.USER_ID) {
    sendLineMessage_(message);
  }

  if (CONFIG.EMAIL) {
    try {
      MailApp.sendEmail({
        to: CONFIG.EMAIL,
        subject: '[Dyn 2x3x] \u30a8\u30e9\u30fc\u767a\u751f',
        body: message
      });
    } catch (e) {
      Logger.log('\u30a8\u30e9\u30fc\u901a\u77e5\u30e1\u30fc\u30eb\u9001\u4fe1\u5931\u6557: ' + e.message);
    }
  }
}


/**
 * \u901a\u77e5\u30c6\u30b9\u30c8\u7528
 */
function testNotification() {
  var testEntry = {
    date: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'),
    close: 17500,
    dd_state: 'HOLD',
    dd_value: 1.0,
    asym_vol: 0.22,
    trend_tv: 0.22,
    vt: 0.90,
    slope_mult: 0.95,
    mom_decel: 0.88,
    vix_proxy: 0.18,
    vix_z: -0.5,
    vix_mult: 1.125,
    raw_leverage: 0.76,
    prev_leverage: 0.80,
    new_leverage: 0.76,
    w_nasdaq: 0.744,
    w_gold: 0.128,
    w_bond: 0.128,
    rebalanced: true
  };
  sendNotification_(testEntry);
  Logger.log('\u30c6\u30b9\u30c8\u901a\u77e5\u3092\u9001\u4fe1\u3057\u307e\u3057\u305f');
}
