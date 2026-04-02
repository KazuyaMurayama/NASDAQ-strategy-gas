/**
 * StateManager.gs - State管理とログ記録
 *
 * Stateシート構成 (A列: key, B列: value):
 *   dd_state          - "HOLD" or "CASH"
 *   asym_variance     - AsymEWMAの分散（数値）
 *   current_leverage  - 現在のraw_leverage（数値）
 *   last_update_date  - 最終更新日（文字列）
 *   w_nasdaq          - TQQQウェイト（数値）
 *   w_gold            - Gold 2xウェイト（数値）
 *   w_bond            - Bond 3xウェイト（数値）
 *
 * Logシート: 日次計算結果 (20列)
 */

/**
 * Stateシートから状態を読み込み
 * @param {Spreadsheet} ss
 * @return {Object} stateオブジェクト
 */
function loadState_(ss) {
  var defaults = {
    dd_state: 'HOLD',
    asym_variance: null,
    current_leverage: 1.0,
    current_weights: { w_nasdaq: null, w_gold: null, w_bond: null },
    last_update_date: ''
  };

  var sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  if (!sheet) return defaults;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return defaults;

  var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var stateMap = {};
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    var val = data[i][1];
    if (key) stateMap[key] = val;
  }

  var wNasdaq = stateMap['w_nasdaq'] != null && stateMap['w_nasdaq'] !== '' ? Number(stateMap['w_nasdaq']) : null;
  var wGold   = stateMap['w_gold']   != null && stateMap['w_gold']   !== '' ? Number(stateMap['w_gold'])   : null;
  var wBond   = stateMap['w_bond']   != null && stateMap['w_bond']   !== '' ? Number(stateMap['w_bond'])   : null;

  return {
    dd_state: stateMap['dd_state'] || defaults.dd_state,
    asym_variance: stateMap['asym_variance'] != null && stateMap['asym_variance'] !== ''
                   ? Number(stateMap['asym_variance']) : defaults.asym_variance,
    current_leverage: stateMap['current_leverage'] != null && stateMap['current_leverage'] !== ''
                      ? Number(stateMap['current_leverage']) : defaults.current_leverage,
    current_weights: { w_nasdaq: wNasdaq, w_gold: wGold, w_bond: wBond },
    last_update_date: stateMap['last_update_date'] || defaults.last_update_date
  };
}


/**
 * Stateシートに状態を保存
 * @param {Spreadsheet} ss
 * @param {Object} state
 */
function saveState_(ss, state) {
  var sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  if (!sheet) return;

  // キーと値のペアを定義
  var rows = [
    ['dd_state',         state.dd_state],
    ['asym_variance',    state.asym_variance != null ? state.asym_variance : ''],
    ['current_leverage', state.current_leverage != null ? state.current_leverage : ''],
    ['last_update_date', state.last_update_date || ''],
    ['w_nasdaq',         state.current_weights && state.current_weights.w_nasdaq != null ? state.current_weights.w_nasdaq : ''],
    ['w_gold',           state.current_weights && state.current_weights.w_gold   != null ? state.current_weights.w_gold   : ''],
    ['w_bond',           state.current_weights && state.current_weights.w_bond   != null ? state.current_weights.w_bond   : '']
  ];

  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
}


/**
 * Logシートに計算結果を追記 (20列)
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
    roundTo_(entry.dd_value, 2),
    roundTo_(entry.asym_vol, 4),
    roundTo_(entry.trend_tv, 4),
    roundTo_(entry.vt, 4),
    roundTo_(entry.slope_mult, 4),
    roundTo_(entry.mom_decel, 4),
    roundTo_(entry.vix_proxy, 4),
    roundTo_(entry.vix_z, 4),
    roundTo_(entry.vix_mult, 4),
    roundTo_(entry.raw_leverage, 4),
    roundTo_(entry.prev_leverage, 4),
    roundTo_(entry.new_leverage, 4),
    roundTo_(entry.w_nasdaq, 4),
    roundTo_(entry.w_gold, 4),
    roundTo_(entry.w_bond, 4),
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
