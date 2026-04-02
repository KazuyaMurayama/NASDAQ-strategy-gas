/**
 * Setup.gs - 初期セットアップとトリガー設定
 *
 * 初回のみ手動実行:
 *   1. setupSpreadsheet()        - シート構成を作成
 *   2. initializeHistoricalData() - 過去データを一括取得
 *   3. setupDailyTrigger()       - 日次トリガーを設定
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

  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  Logger.log('スプレッドシート構成を作成しました');
  Logger.log('次に initializeHistoricalData() を実行してください');
}


function initializeHistoricalData() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_PRICE);

  if (!sheet) {
    Logger.log('エラー: PriceHistoryシートがありません。先に setupSpreadsheet() を実行してください');
    return;
  }

  Logger.log('過去データを取得中...');
  var prices = fetchHistoricalPrices(Math.ceil(CONFIG.PRICE_DAYS_NEEDED * 1.5));

  if (prices.length === 0) {
    Logger.log('エラー: データを取得できませんでした');
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }

  var rows = prices.map(function(p) {
    return [p.date, p.close];
  });
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);

  Logger.log('過去データ書き込み完了: ' + rows.length + '日分');

  var state = loadState_(ss);
  var asymResult = calcAsymEWMA(prices, null);
  state.asym_variance = asymResult.variance;
  state.last_update_date = prices[prices.length - 1].date;
  state.current_weights = { w_nasdaq: null, w_gold: null, w_bond: null };
  saveState_(ss, state);

  Logger.log('AsymEWMA初期variance: ' + asymResult.variance);
  Logger.log('初期化完了。次に setupDailyTrigger() でトリガーを設定してください');
}


function setupDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'dailyUpdate') {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log('既存のdailyUpdateトリガーを削除しました');
    }
  }

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


function removeAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  Logger.log(triggers.length + '個のトリガーを削除しました');
}


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
              text: '\u30e6\u30fc\u30b6\u30fcID\u53d6\u5f97\u5b8c\u4e86!\n' + userId + '\n\n\u3053\u306eID\u3092\u30b3\u30fc\u30c9.gs\u306eCONFIG.LINE.USER_ID\u306b\u8a2d\u5b9a\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
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
