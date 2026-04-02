/**
 * Setup.gs - 初期セットアップとトリガー設定
 *
 * 初回のみ手動実行:
 *   1. setupSpreadsheet()        - シート構成を作成
 *   2. initializeHistoricalData() - 過去データを一括取得
 *   3. setupDailyTrigger()       - 日次トリガーを設定
 */

/**
 * Step 1: スプレッドシートのシート構成を作成
 */
function setupSpreadsheet() {
  var ss = getSpreadsheet_();

  // PriceHistory シート
  var priceSheet = ss.getSheetByName(CONFIG.SHEET_PRICE);
  if (!priceSheet) {
    priceSheet = ss.insertSheet(CONFIG.SHEET_PRICE);
  }
  priceSheet.getRange(1, 1, 1, 2).setValues([['date', 'close']]);
  priceSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  priceSheet.setColumnWidth(1, 120);
  priceSheet.setColumnWidth(2, 100);
  priceSheet.setFrozenRows(1);

  // State シート (7キー)
  var stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  if (!stateSheet) {
    stateSheet = ss.insertSheet(CONFIG.SHEET_STATE);
  }
  var stateData = [
    ['key',              'value'],
    ['dd_state',         'HOLD'],
    ['asym_variance',    ''],
    ['current_leverage', 1.0],
    ['last_update_date', ''],
    ['w_nasdaq',         ''],
    ['w_gold',           ''],
    ['w_bond',           '']
  ];
  stateSheet.getRange(1, 1, stateData.length, 2).setValues(stateData);
  stateSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  stateSheet.setColumnWidth(1, 180);
  stateSheet.setColumnWidth(2, 160);
  stateSheet.setFrozenRows(1);

  // Google Finance 代替データソースのセル
  stateSheet.getRange('D1').setValue('NASDAQ (GoogleFinance)');
  stateSheet.getRange('D1').setFontWeight('bold');
  stateSheet.getRange('E1').setFormula('=GOOGLEFINANCE("INDEXNASDAQ:.IXIC","price")');

  // Log シート (20列)
  var logSheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!logSheet) {
    logSheet = ss.insertSheet(CONFIG.SHEET_LOG);
  }
  var logHeaders = [
    'date', 'close', 'dd_state', 'dd_value',
    'asym_vol', 'trend_tv', 'vt', 'slope_mult', 'mom_decel',
    'vix_proxy', 'vix_z', 'vix_mult',
    'raw_leverage', 'prev_leverage', 'new_leverage',
    'w_nasdaq', 'w_gold', 'w_bond',
    'rebalanced', 'timestamp'
  ];
  logSheet.getRange(1, 1, 1, logHeaders.length).setValues([logHeaders]);
  logSheet.getRange(1, 1, 1, logHeaders.length).setFontWeight('bold');
  logSheet.setFrozenRows(1);

  // デフォルトの「Sheet1」があれば削除
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  Logger.log('スプレッドシート構成を作成しました');
  Logger.log('次に initializeHistoricalData() を実行してください');
}


/**
 * Step 2: Yahoo Finance から過去データを一括取得して PriceHistory に書き込み
 */
function initializeHistoricalData() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_PRICE);

  if (!sheet) {
    Logger.log('エラー: PriceHistoryシートがありません。先に setupSpreadsheet() を実行してください');
    return;
  }

  Logger.log('過去データを取得中...');
  // PRICE_DAYS_NEEDED日分の営業日に対してカレンダー日数は約1.5倍必要
  var prices = fetchHistoricalPrices(Math.ceil(CONFIG.PRICE_DAYS_NEEDED * 1.5));

  if (prices.length === 0) {
    Logger.log('エラー: データを取得できませんでした');
    return;
  }

  // 既存データをクリア（ヘッダー以外）
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }

  // 一括書き込み
  var rows = prices.map(function(p) {
    return [p.date, p.close];
  });
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);

  Logger.log('過去データ書き込み完了: ' + rows.length + '日分');

  // AsymEWMA の初期 variance を計算してStateに保存
  var state = loadState_(ss);
  var asymResult = calcAsymEWMA(prices, null);
  state.asym_variance = asymResult.variance;
  state.last_update_date = prices[prices.length - 1].date;
  // 初期ウェイトは未設定（初回は必ずリバランスされる）
  state.current_weights = { w_nasdaq: null, w_gold: null, w_bond: null };
  saveState_(ss, state);

  Logger.log('AsymEWMA初期variance: ' + asymResult.variance);
  Logger.log('初期化完了。次に setupDailyTrigger() でトリガーを設定してください');
}


/**
 * Step 3: 日次トリガーを設定（米国市場閉場後、日本時間 午前7:00-8:00）
 */
function setupDailyTrigger() {
  // 既存のトリガーを削除
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'dailyUpdate') {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log('既存のdailyUpdateトリガーを削除しました');
    }
  }

  // 新しいトリガーを作成
  // 日本時間 7:00-8:00 = 米国東部 17:00-18:00 (市場閉場後)
  ScriptApp.newTrigger('dailyUpdate')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .nearMinute(0)
    .inTimezone('Asia/Tokyo')
    .create();

  Logger.log('日次トリガーを設定しました（日本時間 7:00-8:00）');
  Logger.log('=== セットアップ完了 ===');
  Logger.log('');
  Logger.log('運用開始前チェックリスト:');
  Logger.log('1. dryRun() を実行して計算結果を確認');
  Logger.log('2. CONFIG.LINE または CONFIG.EMAIL を設定');
  Logger.log('3. testNotification() で通知テスト');
}


/**
 * トリガーを全削除
 */
function removeAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  Logger.log(triggers.length + '個のトリガーを削除しました');
}


/**
 * LINE ユーザーID取得用 Webhook
 * GASをウェブアプリとしてデプロイし、LINE Developers ConsoleのWebhook URLに設定する
 */
function doPost(e) {
  try {
    var json = JSON.parse(e.postData.contents);
    var events = json.events;

    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      var userId = event.source.userId;

      if (userId) {
        Logger.log('LINE ユーザーID取得: ' + userId);

        var ss = getSpreadsheet_();
        var stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
        if (stateSheet) {
          stateSheet.getRange('D3').setValue('LINE_USER_ID');
          stateSheet.getRange('E3').setValue(userId);
        }

        if (CONFIG.LINE.CHANNEL_ACCESS_TOKEN) {
          var replyUrl = 'https://api.line.me/v2/bot/message/reply';
          var replyPayload = {
            replyToken: event.replyToken,
            messages: [{
              type: 'text',
              text: 'ユーザーID取得完了!
' + userId + '

このIDをコード.gsのCONFIG.LINE.USER_IDに設定してください。'
            }]
          };
          UrlFetchApp.fetch(replyUrl, {
            method: 'post',
            contentType: 'application/json',
            headers: { 'Authorization': 'Bearer ' + CONFIG.LINE.CHANNEL_ACCESS_TOKEN },
            payload: JSON.stringify(replyPayload),
            muteHttpExceptions: true
          });
        }
      }
    }
  } catch (err) {
    Logger.log('doPost エラー: ' + err.message);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * メニューをスプレッドシートに追加
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Dyn 2x3x戦略')
    .addItem('手動更新 (dailyUpdate)', 'dailyUpdate')
    .addItem('ドライラン', 'dryRun')
    .addSeparator()
    .addItem('通知テスト', 'testNotification')
    .addSeparator()
    .addSubMenu(ui.createMenu('セットアップ')
      .addItem('1. シート構成を作成', 'setupSpreadsheet')
      .addItem('2. 過去データ取得', 'initializeHistoricalData')
      .addItem('3. トリガー設定', 'setupDailyTrigger'))
    .addSeparator()
    .addItem('全トリガー削除', 'removeAllTriggers')
    .toUi();
}
