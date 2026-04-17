/**
 * StateManager.gs - State管理とログ記録
 *
 * Stateシート構成 (A列: key, B列: value):
 *   dd_state          - "HOLD" or "CASH"
 *   asym_variance     - AsymEWMAの分散（数値、> 0）
 *   current_leverage  - 現在のraw_leverage（0.0 〜 1.0）
 *   last_update_date  - 最終更新日（文字列 yyyy-MM-dd）
 *   w_nasdaq          - TQQQウェイト（0.30 〜 0.90）
 *   w_gold            - Gold 2xウェイト（数値）
 *   w_bond            - Bond 3xウェイト（数値）
 *
 * Logシート: 日次計算結果 (26列) ※列順はアクション優先
 *   A: date, B: close
 *   C-F: actual_tqqq/gold/bond/cash（実保有比率 = 結論）
 *   G: rebalanced
 *   H-X: 内部シグナル（dd_state, raw_leverage, w_*, 各Layer値, timestamp）
 *   Y: forward_cagr_5d（5営業日後CAGR年率、%単位 例:10.7）
 *   Z: forward_median_5d（5営業日後中央値、%単位 例:0.15）
 */

var STATE_DEFAULTS_ = {
  dd_state:         'HOLD',
  asym_variance:    null,
  current_leverage: 1.0,
  current_weights:  { w_nasdaq: null, w_gold: null, w_bond: null },
  last_update_date: ''
};


/**
 * Stateシートから状態を読み込み・検証
 * @param {Spreadsheet} ss
 * @return {Object}
 */
function loadState_(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEET_STATE);
  if (!sheet || sheet.getLastRow() < 2) return shallowCopy_(STATE_DEFAULTS_);

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var m = {};
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    if (key) m[key] = data[i][1];
  }

  // --- 各フィールドをサニタイズ ---
  var ddState = (m['dd_state'] === 'CASH') ? 'CASH' : 'HOLD';

  var asymVar = parsePositiveFloat_(m['asym_variance']);

  var leverage = parseFloat_(m['current_leverage'], 1.0);
  leverage = clip_(leverage, 0.0, 1.0);

  var wNasdaq = parseFloat_(m['w_nasdaq'], null);
  var wGold   = parseFloat_(m['w_gold'],   null);
  var wBond   = parseFloat_(m['w_bond'],   null);

  // ウェイトの整合性チェック: 全て揃っていて合計が概ね1.0の場合のみ採用
  var weightsValid = (wNasdaq != null && wGold != null && wBond != null &&
                      Math.abs(wNasdaq + wGold + wBond - 1.0) < 0.01);
  if (!weightsValid) {
    wNasdaq = null; wGold = null; wBond = null;
  }

  return {
    dd_state:         ddState,
    asym_variance:    asymVar,
    current_leverage: leverage,
    current_weights:  { w_nasdaq: wNasdaq, w_gold: wGold, w_bond: wBond },
    last_update_date: m['last_update_date'] || ''
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

  var cw = state.current_weights || {};
  var rows = [
    ['dd_state',         state.dd_state],
    ['asym_variance',    state.asym_variance != null ? state.asym_variance : ''],
    ['current_leverage', state.current_leverage != null ? state.current_leverage : ''],
    ['last_update_date', state.last_update_date || ''],
    ['w_nasdaq',         cw.w_nasdaq != null ? cw.w_nasdaq : ''],
    ['w_gold',           cw.w_gold   != null ? cw.w_gold   : ''],
    ['w_bond',           cw.w_bond   != null ? cw.w_bond   : '']
  ];

  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
}


/**
 * Logシートに計算結果を追記 (26列) ※アクション優先列順
 *
 * 列順:
 *   A: date, B: close
 *   C-F: actual_tqqq/gold/bond/cash（実保有比率）
 *   G: rebalanced
 *   H: dd_state, I: raw_leverage, J: new_leverage
 *   K: w_nasdaq, L: w_gold, M: w_bond
 *   N: dd_value, O: asym_vol, P: trend_tv, Q: vt
 *   R: slope_mult, S: mom_decel
 *   T: vix_proxy, U: vix_z, V: vix_mult
 *   W: prev_leverage, X: timestamp
 *   Y: forward_cagr_5d, Z: forward_median_5d
 *
 * @param {Spreadsheet} ss
 * @param {Object} entry
 */
function appendLog_(ss, entry) {
  var sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!sheet) return;

  var lev = entry.new_leverage || 0;
  var wN  = entry.w_nasdaq || 0;
  var wG  = entry.w_gold   || 0;
  var wB  = entry.w_bond   || 0;

  sheet.appendRow([
    entry.date,                              // A: date
    entry.close,                             // B: close
    r2_(lev * wN, 4),                       // C: actual_tqqq
    r2_(lev * wG, 4),                       // D: actual_gold
    r2_(lev * wB, 4),                       // E: actual_bond
    r2_(1 - lev,  4),                       // F: actual_cash
    entry.rebalanced ? 'YES' : 'NO',        // G: rebalanced
    entry.dd_state,                          // H: dd_state
    r2_(entry.raw_leverage,  4),            // I: raw_leverage
    r2_(entry.new_leverage,  4),            // J: new_leverage
    r2_(wN, 4),                             // K: w_nasdaq
    r2_(wG, 4),                             // L: w_gold
    r2_(wB, 4),                             // M: w_bond
    r2_(entry.dd_value,   2),               // N: dd_value
    r2_(entry.asym_vol,   4),               // O: asym_vol
    r2_(entry.trend_tv,   4),               // P: trend_tv
    r2_(entry.vt,         4),               // Q: vt
    r2_(entry.slope_mult, 4),               // R: slope_mult
    r2_(entry.mom_decel,  4),               // S: mom_decel
    r2_(entry.vix_proxy,  4),               // T: vix_proxy
    r2_(entry.vix_z,      4),               // U: vix_z
    r2_(entry.vix_mult,   4),               // V: vix_mult
    r2_(entry.prev_leverage, 4),            // W: prev_leverage
    new Date(),                              // X: timestamp
    r2_(entry.forward_cagr_5d,   1),       // Y: forward_cagr_5d
    r2_(entry.forward_median_5d, 2)        // Z: forward_median_5d
  ]);

  // actual_tqqq〜actual_cash (C-F = 列3-6) を数値フォーマットに強制設定
  var newRow = sheet.getLastRow();
  sheet.getRange(newRow, 3, 1, 4).setNumberFormat('0.0000');

  // 1000行超過時に古い行を削除
  if (newRow > 1001) {
    sheet.deleteRows(2, newRow - 1001);
  }
}


// ===== プライベートユーティリティ =====

function r2_(value, decimals) {
  if (value == null || isNaN(Number(value))) return '';
  return Math.round(Number(value) * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// StateManager外からも使われる (Notify.gsなど)
function roundTo_(value, decimals) {
  return r2_(value, decimals);
}

function formatFwdReturn_(value) {
  return value != null ? '+' + value + '%' : 'N/A';
}

function parseFloat_(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  var n = Number(raw);
  return isNaN(n) ? fallback : n;
}

function parsePositiveFloat_(raw) {
  var n = parseFloat_(raw, null);
  return (n != null && n > 0) ? n : null;
}

function shallowCopy_(obj) {
  var out = {};
  for (var k in obj) {
    if (obj.hasOwnProperty(k)) out[k] = obj[k];
  }
  return out;
}
