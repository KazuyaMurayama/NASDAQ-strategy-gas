/**
 * Setup.gs - 初期セットアップとトリガー設定
 *
 * 初回のみ手動実行 (スプレッドシートメニュー「Dyn 2x3x戦略 > セットアップ」):
 *   1. setupSpreadsheet()        - シート構成を作成
 *   2. initializeHistoricalData() - 過去データを一括取得
 *   3. setupDailyTrigger()       - 日次トリガーを設定
 *
 * 通知フォーマット改善後（1回のみ実行）:
 *   migrateLogSheet()   - Logシートに実保有比率4列を追加（過去データ含む）
 *   updateStateActuals() - Stateシートに実保有配分表示を追加
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

  // Log シート (24列)
  var logSheet = ss.getSheetByName(CONFIG.SHEET_LOG) ||
                 ss.insertSheet(CONFIG.SHEET_LOG);
  var logHeaders = [
    'date', 'close', 'dd_state', 'dd_value',
    'asym_vol', 'trend_tv', 'vt', 'slope_mult', 'mom_decel',
    'vix_proxy', 'vix_z', 'vix_mult',
    'raw_leverage', 'prev_leverage', 'new_leverage',
    'w_nasdaq', 'w_gold', 'w_bond',
    'actual_tqqq', 'actual_gold', 'actual_bond', 'actual_cash',
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


/**
 * Logシート移行: 実保有比率4列を追加（過去データ含む）
 *
 * 変更内容:
 *   20列 → 24列
 *   追加: actual_tqqq, actual_gold, actual_bond, actual_cash (列19-22)
 *   移動: rebalanced→23列, timestamp→24列
 *
 * タイムアウト対策: getValues()一括読み込み → メモリ内計算 → setValues()一括書き込み
 * 冪等性: actual_tqqq列が既存の場合はスキップ
 */
function migrateLogSheet() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!sheet) { Logger.log('Logシートが見つかりません'); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow < 1) { Logger.log('Logシートにデータなし'); return; }

  // 移行済みチェック（ヘッダーにactual_tqqqがあればスキップ）
  var existingCols = sheet.getLastColumn();
  var firstRow = sheet.getRange(1, 1, 1, existingCols).getValues()[0];
  if (firstRow.indexOf('actual_tqqq') >= 0) {
    Logger.log('移行済みです（actual_tqqq列が既に存在）');
    return;
  }

  // 新ヘッダー（24列）
  var newHeaders = [
    'date', 'close', 'dd_state', 'dd_value',
    'asym_vol', 'trend_tv', 'vt', 'slope_mult', 'mom_decel',
    'vix_proxy', 'vix_z', 'vix_mult',
    'raw_leverage', 'prev_leverage', 'new_leverage',
    'w_nasdaq', 'w_gold', 'w_bond',
    'actual_tqqq', 'actual_gold', 'actual_bond', 'actual_cash',
    'rebalanced', 'timestamp'
  ];

  // データ行を一括読み込み（タイムアウト対策: 単一API呼び出し）
  var dataRows = [];
  if (lastRow > 1) {
    dataRows = sheet.getRange(2, 1, lastRow - 1, 20).getValues();
  }

  // メモリ内で実保有比率を計算して24列に拡張
  // 旧列インデックス(0始まり): new_leverage=14, w_nasdaq=15, w_gold=16, w_bond=17
  // rebalanced=18, timestamp=19
  var newRows = dataRows.map(function(row) {
    var lev = Number(row[14]) || 0;
    var wN  = Number(row[15]) || 0;
    var wG  = Number(row[16]) || 0;
    var wB  = Number(row[17]) || 0;

    var actTqqq = (lev > 0 && wN > 0) ? Math.round(lev * wN * 10000) / 10000 : '';
    var actGold = (lev > 0 && wG > 0) ? Math.round(lev * wG * 10000) / 10000 : '';
    var actBond = (lev > 0 && wB > 0) ? Math.round(lev * wB * 10000) / 10000 : '';
    var actCash = lev > 0             ? Math.round((1 - lev) * 10000) / 10000 : '';

    return [
      row[0],  row[1],  row[2],  row[3],
      row[4],  row[5],  row[6],  row[7],  row[8],
      row[9],  row[10], row[11],
      row[12], row[13], row[14],
      row[15], row[16], row[17],
      actTqqq, actGold, actBond, actCash,
      row[18], row[19]
    ];
  });

  // 一括書き込み（タイムアウト対策: 最大2回のAPI呼び出し）
  sheet.getRange(1, 1, 1, newHeaders.length)
       .setValues([newHeaders])
       .setFontWeight('bold');

  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, newHeaders.length).setValues(newRows);
  }

  Logger.log('Logシート移行完了: ' + newRows.length + '行 × 24列');
  Logger.log('次に updateStateActuals() を実行してください');
}


/**
 * Stateシートに実保有配分の表示列を追加（D・E列）
 *
 * D列: ラベル, E列: 数式（B列のcurrent_leverage × w_*から自動計算）
 * Stateシートのレイアウト:
 *   Row4: current_leverage (B4)
 *   Row6: w_nasdaq (B6), Row7: w_gold (B7), Row8: w_bond (B8)
 */
function updateStateActuals() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  if (!sheet) { Logger.log('Stateシートが見つかりません'); return; }

  var actuals = [
    ['実保有配分',   '(= leverage × weight)'],
    ['actual_tqqq', '=IF(B6="","",B4*B6)'],
    ['actual_gold', '=IF(B7="","",B4*B7)'],
    ['actual_bond', '=IF(B8="","",B4*B8)'],
    ['actual_cash', '=IF(B4="","",1-B4)']
  ];

  sheet.getRange(1, 4, actuals.length, 2).setValues(actuals);
  sheet.getRange(1, 4, 1, 2).setFontWeight('bold');
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 160);

  Logger.log('Stateシートに実保有配分を追加しました（D・E列、数式で自動更新）');
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
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Dyn 2x3x戦略')
    .addItem('手動更新 (dailyUpdate)', 'dailyUpdate')
    .addItem('ドライラン', 'dryRun')
    .addItem('ヘルスチェック', 'runHealthCheckManual')
    .addSeparator()
    .addItem('通知テスト', 'testNotification')
    .addItem('緊急リセット', 'emergencyResetState')
    .addSeparator()
    .addSubMenu(ui.createMenu('セットアップ')
      .addItem('1. シート構成を作成', 'setupSpreadsheet')
      .addItem('2. 過去データ取得', 'initializeHistoricalData')
      .addItem('3. トリガー設定', 'setupDailyTrigger'))
    .addSeparator()
    .addSubMenu(ui.createMenu('データ移行（1回のみ）')
      .addItem('1. Logシート移行（実保有比率追加）', 'migrateLogSheet')
      .addItem('2. Stateシート更新（実保有配分表示）', 'updateStateActuals'))
    .addSeparator()
    .addItem('全トリガー削除', 'removeAllTriggers')
    .toUi();
}
