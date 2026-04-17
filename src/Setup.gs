/**
 * Setup.gs - 初期セットアップとトリガー設定
 *
 * 初回のみ手動実行:
 *   1. setupSpreadsheet()        - シート構成を作成
 *   2. initializeHistoricalData() - 過去データを一括取得
 *   3. setupDailyTrigger()       - 日次トリガーを設定
 *
 * 移行関数（1回のみ実行、GASエディタから直接実行）:
 *   migrateLogSheet()        - 実保有比率4列を追加
 *   updateStateActuals()     - Stateシートに実保有配分表示を追加
 *   fixLogSheetFormat()      - actual列フォーマット修正
 *   reorderLogSheet()        - actual列をC-Fに移動
 *   addForwardReturnCols()   - フォワードリターン列を追加
 *   reorderLogSheetFinal()   - 最終列順整備（forward列をH-Iへ）★最新
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

  // Log シート (26列) ※アクション優先列順
  var logSheet = ss.getSheetByName(CONFIG.SHEET_LOG) ||
                 ss.insertSheet(CONFIG.SHEET_LOG);
  var logHeaders = [
    'date', 'close',
    'actual_tqqq', 'actual_gold', 'actual_bond', 'actual_cash',
    'rebalanced',
    'forward_cagr_5d', 'forward_median_5d',
    'dd_state', 'raw_leverage', 'new_leverage',
    'w_nasdaq', 'w_gold', 'w_bond',
    'dd_value', 'asym_vol', 'trend_tv', 'vt',
    'slope_mult', 'mom_decel',
    'vix_proxy', 'vix_z', 'vix_mult',
    'prev_leverage', 'timestamp'
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
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dailyUpdate') ScriptApp.deleteTrigger(t);
  });
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
 * Logシート移行: 実保有比率4列を追加（20→24列）
 * 冪等性: actual_tqqq列が既存の場合はスキップ
 */
function migrateLogSheet() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!sheet) { Logger.log('Logシートが見つかりません'); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow < 1) { Logger.log('Logシートにデータなし'); return; }

  var existingCols = sheet.getLastColumn();
  var firstRow = sheet.getRange(1, 1, 1, existingCols).getValues()[0];
  if (firstRow.indexOf('actual_tqqq') >= 0) {
    Logger.log('移行済みです（actual_tqqq列が既に存在）');
    return;
  }

  var newHeaders = [
    'date', 'close', 'dd_state', 'dd_value',
    'asym_vol', 'trend_tv', 'vt', 'slope_mult', 'mom_decel',
    'vix_proxy', 'vix_z', 'vix_mult',
    'raw_leverage', 'prev_leverage', 'new_leverage',
    'w_nasdaq', 'w_gold', 'w_bond',
    'actual_tqqq', 'actual_gold', 'actual_bond', 'actual_cash',
    'rebalanced', 'timestamp'
  ];

  var dataRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 20).getValues() : [];

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

  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]).setFontWeight('bold');
  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, newHeaders.length).setValues(newRows);
    sheet.getRange(2, 19, newRows.length, 4).setNumberFormat('0.0000');
  }
  Logger.log('Logシート移行完了: ' + newRows.length + '行 × 24列');
}


/**
 * Logシートのactual列の数値フォーマットを修正する
 */
function fixLogSheetFormat() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!sheet) { Logger.log('Logシートが見つかりません'); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('データ行がありません'); return; }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var tqqqCol = headers.indexOf('actual_tqqq') + 1;
  if (tqqqCol <= 0) {
    Logger.log('actual_tqqq列が見つかりません。先にmigrateLogSheet()を実行してください');
    return;
  }

  sheet.getRange(2, tqqqCol, lastRow - 1, 4).setNumberFormat('0.0000');
  Logger.log('フォーマット修正完了: ' + (lastRow - 1) + '行');
}


/**
 * Logシートに forward_cagr_5d / forward_median_5d 列を末尾に追加してバックフィル
 * 冪等性: forward_cagr_5d列が既存の場合はスキップ
 */
function addForwardReturnCols() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!sheet) { Logger.log('Logシートが見つかりません'); return; }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1) { Logger.log('データなし'); return; }

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('forward_cagr_5d') >= 0) {
    Logger.log('追加済みです（forward_cagr_5d列が既に存在）');
    return;
  }

  var ddCol  = headers.indexOf('dd_state');
  var levCol = headers.indexOf('raw_leverage');
  var nqCol  = headers.indexOf('w_nasdaq');
  if (ddCol < 0 || levCol < 0 || nqCol < 0) {
    Logger.log('必要な列が見つかりません。先にmigrateLogSheet()を実行してください');
    return;
  }

  var newHdrCol = lastCol + 1;
  sheet.getRange(1, newHdrCol, 1, 2)
       .setValues([['forward_cagr_5d', 'forward_median_5d']])
       .setFontWeight('bold');

  if (lastRow < 2) { Logger.log('ヘッダーのみ追加完了'); return; }

  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var newCols = data.map(function(row) {
    var ddState = String(row[ddCol]);
    var rawLev  = Number(row[levCol]) || 0;
    var wNasdaq = Number(row[nqCol])  || 0;
    if (!wNasdaq) return ['', ''];
    var fwd = lookupForwardReturn_(wNasdaq, ddState, rawLev);
    return fwd ? [r2_(fwd.cagr, 1), r2_(fwd.median, 2)] : ['', ''];
  });

  sheet.getRange(2, newHdrCol, newCols.length, 2).setValues(newCols);
  Logger.log('フォワードリターン列追加完了: ' + newCols.length + '行バックフィル済み');
}


/**
 * Logシート列順を最終形に整備
 *
 * 最終列順:
 *   A: date, B: close
 *   C-F: actual_tqqq/gold/bond/cash
 *   G: rebalanced
 *   H: forward_cagr_5d, I: forward_median_5d  ← アクション情報を前へ
 *   J: dd_state, K: raw_leverage, L: new_leverage
 *   M: w_nasdaq, N: w_gold, O: w_bond
 *   P: dd_value, Q: asym_vol, R: trend_tv, S: vt
 *   T: slope_mult, U: mom_decel
 *   V: vix_proxy, W: vix_z, X: vix_mult
 *   Y: prev_leverage, Z: timestamp
 *
 * 冪等性: H列がforward_cagr_5dなら既に完了としてスキップ
 * 列名で検索するため現在の列順に依存しない
 */
function reorderLogSheetFinal() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!sheet) { Logger.log('Logシートが見つかりません'); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow < 1) { Logger.log('データなし'); return; }

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // 冪等性チェック
  if (headers[7] === 'forward_cagr_5d') {
    Logger.log('列順は既に最終形式です（スキップ）');
    return;
  }

  if (headers.indexOf('forward_cagr_5d') < 0) {
    Logger.log('forward_cagr_5d列がありません。先にaddForwardReturnCols()を実行してください');
    return;
  }

  var newHeaders = [
    'date', 'close',
    'actual_tqqq', 'actual_gold', 'actual_bond', 'actual_cash',
    'rebalanced',
    'forward_cagr_5d', 'forward_median_5d',
    'dd_state', 'raw_leverage', 'new_leverage',
    'w_nasdaq', 'w_gold', 'w_bond',
    'dd_value', 'asym_vol', 'trend_tv', 'vt',
    'slope_mult', 'mom_decel',
    'vix_proxy', 'vix_z', 'vix_mult',
    'prev_leverage', 'timestamp'
  ];

  // 列名→現在のインデックスのマップを作成
  var idxMap = {};
  headers.forEach(function(h, i) { idxMap[String(h)] = i; });

  var dataRows = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
    : [];

  var newRows = dataRows.map(function(r) {
    return newHeaders.map(function(h) {
      var idx = idxMap[h];
      return (idx !== undefined) ? r[idx] : '';
    });
  });

  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]).setFontWeight('bold');
  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, newHeaders.length).setValues(newRows);
    sheet.getRange(2, 3, newRows.length, 4).setNumberFormat('0.0000');
  }
  Logger.log('列順最終整備完了: ' + newRows.length + '行 × 26列（forward列をH-Iに移動）');
}


/**
 * Stateシートに実保有配分の表示列を追加（D・E列）
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
  Logger.log('Stateシートに実保有配分を追加しました（D・E列）');
}


// LINE ユーザーID取得用 Webhook
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
      .addItem('2. Stateシート更新（実保有配分表示）', 'updateStateActuals')
      .addItem('3. actual列フォーマット修正', 'fixLogSheetFormat')
      .addItem('4. フォワードリターン列追加', 'addForwardReturnCols')
      .addItem('5. Logシート列順最終整備（★実行）', 'reorderLogSheetFinal'))
    .addSeparator()
    .addItem('全トリガー削除', 'removeAllTriggers')
    .toUi();
}
