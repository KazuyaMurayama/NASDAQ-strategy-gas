/**
 * Setup.gs - 初期セットアップとトリガー設定
 *
 * 初回のみ手動実行 (スプレッドシートメニュー「Dyn 2x3x戦略 > セットアップ」):
 *   1. setupSpreadsheet()        - シート構成を作成
 *   2. initializeHistoricalData() - 過去データを一括取得
 *   3. setupDailyTrigger()       - 日次トリガーを設定
 */

function setupSpreadsheet() {
  var ss = getSpreadsheet_();

  // PriceHistory シート
  var priceSheet = ss.getSheetByName(CONFIG.SHEET_PRICE) ||
                   ss.insertSheet(CONFIG.SHEET_PRICE);
  priceSheet.getRange(1, 1, 1, 2).setValues([['date', 'close']]).setFontWeight('bold');
  priceSheet.setColumnWidths(1, 2, 120);
  priceSheet.setFrozenRows(1);

  // State シート (7キー)
  var stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE) ||
                   ss.insertSheet(CONFIG.SHEET_STATE);
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

  // GOOGLEFINANCE 代替取得用セル
  stateSheet.getRange('D1').setValue('NASDAQ (GoogleFinance)').setFontWeight('bold');
  stateSheet.getRange('E1').setFormula('=GOOGLEFINANCE("INDEXNASDAQ:.IXIC","price")');

  // Log シート (20列)
  var logSheet = ss.getSheetByName(CONFIG.SHEET_LOG) ||
                 ss.insertSheet(CONFIG.SHEET_LOG);
  var logHeaders = [
    'date', 'close', 'dd_state', 'dd_value',
    'asym_vol', 'trend_tv', 'vt', 'slope_mult', 'mom_decel',
    'vix_proxy', 'vix_z', 'vix_mult',
    'raw_leverage', 'prev_leverage', 'new_leverage',
    'w_nasdaq', 'w_gold', 'w_bond',
    'rebalanced', 'timestamp'
  ];
  logSheet.getRange(1, 1, 1, logHeaders.length)
          .setValues([logHeaders])
          .setFontWeight('bold');
  logSheet.setFrozenRows(1);

  // デフォルトシートを削除
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  Logger.log('スプレッドシート構成を作成しました');
  Logger.log('次に initializeHistoricalData() を実行してください');
}


function initializeHistoricalData() {
  var ss    = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_PRICE);
  if (!sheet) {
    Logger.log('エラー: 先に setupSpreadsheet() を実行してください');
    return;
  }

  Logger.log('過去データを取得中... (約' + Math.ceil(CONFIG.PRICE_DAYS_NEEDED * 1.5) + 'カレンダー日)');
  var prices = fetchHistoricalPrices(Math.ceil(CONFIG.PRICE_DAYS_NEEDED * 1.5));
  if (prices.length === 0) { Logger.log('取得失敗'); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  sheet.getRange(2, 1, prices.length, 2)
       .setValues(prices.map(function(p) { return [p.date, p.close]; }));
  Logger.log('書き込み完了: ' + prices.length + '日分');

  // AsymEWMA の初期 variance を算出して保存
  var state = loadState_(ss);
  var asym  = calcAsymEWMA(prices, null);
  state.asym_variance    = asym.variance;
  state.last_update_date = prices[prices.length - 1].date;
  state.current_weights  = { w_nasdaq: null, w_gold: null, w_bond: null };
  saveState_(ss, state);

  Logger.log('AsymEWMA 初期 variance: ' + asym.variance);
  Logger.log('初期化完了。次に setupDailyTrigger() を実行してください');
}


function setupDailyTrigger() {
  // 既存の dailyUpdate トリガーを削除
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dailyUpdate') ScriptApp.deleteTrigger(t);
  });

  // 日本時間 07:00 に設定 (米東部 17:00、市場閉場後)
  ScriptApp.newTrigger('dailyUpdate')
    .timeBased().everyDays(1).atHour(7).nearMinute(0)
    .inTimezone('Asia/Tokyo').create();

  Logger.log('トリガー設定完了: 毎日 07:00 JST');
  Logger.log('次のステップ: dryRun() → testNotification() → 運用開始');
}


function removeAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  Logger.log(triggers.length + '個のトリガーを削除しました');
}


// LINE ユーザーID取得用 Webhook (ウェブアプリとしてデプロイして使用)
function doPost(e) {
  try {
    JSON.parse(e.postData.contents).events.forEach(function(event) {
      var userId = event.source && event.source.userId;
      if (!userId) return;

      Logger.log('LINE userId: ' + userId);

      var ss = getSpreadsheet_();
      var stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
      if (stateSheet) {
        stateSheet.getRange('D3').setValue('LINE_USER_ID');
        stateSheet.getRange('E3').setValue(userId);
      }

      if (CONFIG.LINE.CHANNEL_ACCESS_TOKEN) {
        UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
          method: 'post',
          contentType: 'application/json',
          headers: { 'Authorization': 'Bearer ' + CONFIG.LINE.CHANNEL_ACCESS_TOKEN },
          payload: JSON.stringify({
            replyToken: event.replyToken,
            messages: [{ type: 'text',
                          text: 'ユーザーID取得完了!\n' + userId +
                                '\n\nCONFIG.LINE.USER_IDに設定してください。' }]
          }),
          muteHttpExceptions: true
        });
      }
    });
  } catch (err) {
    Logger.log('doPost error: ' + err.message);
  }
  return ContentService.createTextOutput('{"status":"ok"}')
                       .setMimeType(ContentService.MimeType.JSON);
}


function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Dyn 2x3x戦略')
    .addItem('手動更新 (dailyUpdate)', 'dailyUpdate')
    .addItem('ドライラン', 'dryRun')
    .addItem('ヘルスチェック', 'runHealthCheckManual')
    .addSeparator()
    .addItem('通知テスト', 'testNotification')
    .addItem('緊急リセット', 'emergencyResetState')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('セットアップ')
      .addItem('1. シート構成を作成', 'setupSpreadsheet')
      .addItem('2. 過去データ取得', 'initializeHistoricalData')
      .addItem('3. トリガー設定', 'setupDailyTrigger'))
    .addSeparator()
    .addItem('全トリガー削除', 'removeAllTriggers')
    .toUi();
}
