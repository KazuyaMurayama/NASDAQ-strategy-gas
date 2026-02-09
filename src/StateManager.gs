/**
 * StateManager.gs - State管理とログ記録
 *
 * Stateシート構成:
 *   A1: "key",       B1: "value"
 *   A2: "dd_state",  B2: "HOLD" or "CASH"
 *   A3: "asym_variance", B3: 数値
 *   A4: "current_leverage", B4: 数値
 *   A5: "last_update_date", B5: 日付文字列
 *
 * Logシート構成:
 *   A1〜N1: ヘッダー行
 *   各行: 日次の計算結果
 */

/**
 * Stateシートから状態を読み込み
 * @param {Spreadsheet} ss
 * @return {Object} {dd_state, asym_variance, current_leverage, last_update_date}
 */
function loadState_(ss) {
  var defaults = {
    dd_state: 'HOLD',
    asym_variance: null,
    current_leverage: 1.0,
    last_update_date: ''
  };

  var sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  if (!sheet) return defaults;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return defaults;

  var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var state = {};
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    var val = data[i][1];
    if (key) {
      state[key] = val;
    }
  }

  return {
    dd_state: state['dd_state'] || defaults.dd_state,
    asym_variance: state['asym_variance'] != null && state['asym_variance'] !== ''
                   ? Number(state['asym_variance']) : defaults.asym_variance,
    current_leverage: state['current_leverage'] != null && state['current_leverage'] !== ''
                      ? Number(state['current_leverage']) : defaults.current_leverage,
    last_update_date: state['last_update_date'] || defaults.last_update_date
  };
}


/**
 * Stateシートに状態を保存
 * @param {Spreadsheet} ss
 * @param {Object} state - {dd_state, asym_variance, current_leverage, last_update_date}
 */
function saveState_(ss, state) {
  var sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  if (!sheet) return;

  // B列に値を書き込み（A列はキーで固定）
  var values = [
    [state.dd_state],
    [state.asym_variance],
    [state.current_leverage],
    [state.last_update_date]
  ];
  sheet.getRange(2, 2, 4, 1).setValues(values);
}


/**
 * Logシートに計算結果を追記
 * @param {Spreadsheet} ss
 * @param {Object} entry - ログエントリ
 */
function appendLog_(ss, entry) {
  var sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!sheet) return;

  var row = [
    entry.date,
    entry.close,
    entry.dd_state,
    roundTo_(entry.dd_value, 1),
    roundTo_(entry.asym_vol, 4),
    roundTo_(entry.trend_tv, 4),
    roundTo_(entry.vt, 4),
    roundTo_(entry.slope_mult, 4),
    roundTo_(entry.mom_decel, 4),
    roundTo_(entry.raw_leverage, 4),
    roundTo_(entry.prev_leverage, 4),
    roundTo_(entry.new_leverage, 4),
    entry.rebalanced ? 'YES' : 'NO',
    new Date()  // タイムスタンプ
  ];

  sheet.appendRow(row);

  // ログが1000行を超えたら古いデータを削除
  var totalRows = sheet.getLastRow();
  if (totalRows > 1001) {
    var deleteCount = totalRows - 1001;
    sheet.deleteRows(2, deleteCount);
  }
}


/**
 * 数値の丸め
 */
function roundTo_(value, decimals) {
  if (value == null || isNaN(value)) return '';
  var factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
