/**
 * Notify.gs - LINE / Email 通知
 */

/**
 * リバランス通知を送信
 * @param {Object} entry - ログエントリ
 */
function sendNotification_(entry) {
  var prevPct = (entry.prev_leverage * 100).toFixed(1);
  var newPct = (entry.new_leverage * 100).toFixed(1);
  var productPct = (entry.new_leverage * CONFIG.REBALANCE.PRODUCT_MULTIPLIER * 100).toFixed(0);

  var message =
    '[NASDAQ戦略シグナル]\n' +
    '日付: ' + entry.date + '\n' +
    'DD状態: ' + entry.dd_state + '\n' +
    'レバレッジ: ' + prevPct + '% → ' + newPct + '%（変更あり）\n' +
    'アクション: 3倍商品の保有比率を' + prevPct + '%から' + newPct + '%に' +
    (entry.new_leverage > entry.prev_leverage ? '増やして' : '減らして') + 'ください\n' +
    '（5営業日以内に実行）\n' +
    '\n' +
    '内訳:\n' +
    'DD=' + roundTo_(entry.dd_value, 1) +
    ', VT=' + roundTo_(entry.vt, 2) +
    ', Slope=' + roundTo_(entry.slope_mult, 2) +
    ', MomDecel=' + roundTo_(entry.mom_decel, 2) + '\n' +
    '→ raw=' + roundTo_(entry.raw_leverage, 2) + '\n' +
    '\n' +
    'NASDAQ終値: ' + entry.close;

  // LINE通知
  if (CONFIG.LINE_TOKEN) {
    sendLineNotify_(message);
  }

  // メール通知
  if (CONFIG.EMAIL) {
    sendEmailNotify_(entry.date, message);
  }

  // どちらも未設定の場合はログに出力
  if (!CONFIG.LINE_TOKEN && !CONFIG.EMAIL) {
    Logger.log('=== 通知内容（送信先未設定） ===');
    Logger.log(message);
  }
}


/**
 * LINE Notify でメッセージ送信
 * @param {string} message
 */
function sendLineNotify_(message) {
  if (!CONFIG.LINE_TOKEN) return;

  var url = 'https://notify-api.line.me/api/notify';
  var options = {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.LINE_TOKEN
    },
    payload: {
      message: '\n' + message
    },
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    if (code === 200) {
      Logger.log('LINE通知送信成功');
    } else {
      Logger.log('LINE通知エラー: HTTP ' + code + ' - ' + response.getContentText());
    }
  } catch (e) {
    Logger.log('LINE通知例外: ' + e.message);
  }
}


/**
 * Emailでメッセージ送信
 * @param {string} date - 日付
 * @param {string} body - 本文
 */
function sendEmailNotify_(date, body) {
  if (!CONFIG.EMAIL) return;

  try {
    MailApp.sendEmail({
      to: CONFIG.EMAIL,
      subject: '[NASDAQ戦略] リバランスシグナル ' + date,
      body: body
    });
    Logger.log('メール通知送信成功: ' + CONFIG.EMAIL);
  } catch (e) {
    Logger.log('メール通知例外: ' + e.message);
  }
}


/**
 * エラー通知
 * @param {Error} error
 */
function sendErrorNotification_(error) {
  var message =
    '[NASDAQ戦略 エラー]\n' +
    '日時: ' + new Date().toLocaleString('ja-JP') + '\n' +
    'エラー: ' + error.message + '\n' +
    'スタック: ' + (error.stack || 'N/A');

  if (CONFIG.LINE_TOKEN) {
    sendLineNotify_(message);
  }

  if (CONFIG.EMAIL) {
    try {
      MailApp.sendEmail({
        to: CONFIG.EMAIL,
        subject: '[NASDAQ戦略] エラー発生',
        body: message
      });
    } catch (e) {
      Logger.log('エラー通知メール送信失敗: ' + e.message);
    }
  }
}


/**
 * 通知テスト用
 */
function testNotification() {
  var testEntry = {
    date: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'),
    close: 15000,
    dd_state: 'HOLD',
    dd_value: 1.0,
    asym_vol: 0.25,
    trend_tv: 0.28,
    vt: 0.85,
    slope_mult: 0.92,
    mom_decel: 0.78,
    raw_leverage: 0.61,
    prev_leverage: 0.85,
    new_leverage: 0.61,
    rebalanced: true
  };
  sendNotification_(testEntry);
  Logger.log('テスト通知を送信しました');
}
