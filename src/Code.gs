/**
 * NASDAQ 3x + Gold 2x + Bond 3x 動的配分戦略「Dyn 2x3x」
 * メインエントリーポイント
 *
 * 戦略: A2 Optimized (5-layer)
 * rawLeverage = DD(0.82/0.92) × VT(AsymEWMA(30/10), TrendTV(10-30%))
 *             × SlopeMult(base=0.9, sens=0.35) × MomDecel(60/180)
 *             × VIX_MeanReversion(coeff=0.25, MA=252)
 * rawLeverage = clip(rawLeverage, 0, 1.0)
 * finalLeverage = rebalance_threshold(rawLeverage, 0.20)
 */

// ===== グローバル設定 =====
var CONFIG = {
  SPREADSHEET_ID: '',

  SHEET_PRICE: 'PriceHistory',
  SHEET_STATE: 'State',
  SHEET_LOG: 'Log',

  TICKER: '^IXIC',
  PRICE_DAYS_NEEDED: 350,

  DD: {
    LOOKBACK: 200,
    EXIT_THRESHOLD: 0.82,
    REENTRY_THRESHOLD: 0.92
  },
  ASYM_EWMA: {
    SPAN_DOWN: 10,
    SPAN_UP: 30
  },
  TREND_TV: {
    MA: 150,
    TV_MIN: 0.10,
    TV_MAX: 0.30,
    RATIO_LOW: 0.85,
    RATIO_HIGH: 1.15
  },
  SLOPE_MULT: {
    MA: 200,
    NORM_WINDOW: 60,
    BASE: 0.9,
    SENSITIVITY: 0.35,
    MIN: 0.3,
    MAX: 1.5
  },
  MOM_DECEL: {
    SHORT: 60,
    LONG: 180,
    SENSITIVITY: 0.3,
    MIN: 0.5,
    MAX: 1.3,
    Z_WINDOW: 120
  },
  VIX_MR: {
    VOL_WINDOW: 20,
    MA_WINDOW: 252,
    COEFF: 0.25,
    MIN: 0.50,
    MAX: 1.15
  },
  REBALANCE: {
    THRESHOLD: 0.20,
    LEVERAGE_MIN: 0.0,
    LEVERAGE_MAX: 1.0
  },
  ALLOCATION: {
    W_NASDAQ_BASE: 0.55,
    W_NASDAQ_LEVERAGE_COEFF: 0.25,
    W_NASDAQ_VIX_COEFF: 0.10,
    W_NASDAQ_MIN: 0.30,
    W_NASDAQ_MAX: 0.90
  },

  LINE: {
    CHANNEL_ACCESS_TOKEN: '',
    USER_ID: ''
  },
  EMAIL: '',
  NOTIFY_ON_ERROR: true
};


/**
 * 全Layerで必要な最小データ日数を計算
 * @return {number}
 */
function calcMinDataNeeded_() {
  var neededDD    = CONFIG.DD.LOOKBACK;                                         // 200
  var neededSlope = CONFIG.SLOPE_MULT.MA + CONFIG.SLOPE_MULT.NORM_WINDOW + 1;  // 261
  var neededVix   = CONFIG.VIX_MR.MA_WINDOW + CONFIG.VIX_MR.VOL_WINDOW + 1;   // 273
  var neededMom   = CONFIG.MOM_DECEL.LONG + CONFIG.MOM_DECEL.Z_WINDOW;         // 300
  return Math.max(neededDD, neededSlope, neededVix, neededMom);
}


function dailyUpdate() {
  var ss = getSpreadsheet_();
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);
  } catch (e) {
    Logger.log('既に別のプロセスが実行中です');
    return;
  }

  try {
    if (!isTradingDay_()) {
      Logger.log('本日は営業日ではありません');
      return;
    }

    var newPrice = fetchLatestPrice();
    if (newPrice) {
      appendPrice_(ss, newPrice);
    }

    var prices = loadPriceHistory_(ss);
    var needed = calcMinDataNeeded_();
    if (prices.length < needed) {
      Logger.log('データ不足: ' + prices.length + '日分しかありません（最低' + needed + '日必要）');
      return;
    }

    var state = loadState_(ss);

    var dd = calcDD(prices, state.dd_state);
    var asymResult = calcAsymEWMA(prices, state.asym_variance);
    var trendTv = calcTrendTV(prices);
    var vt = calcVT(trendTv, asymResult.annualized_vol);
    var slopeMult = calcSlopeMult(prices);
    var momDecel = calcMomDecel(prices);
    var vixResult = calcVIXMult(prices);

    var rawLeverage = dd.value * vt * slopeMult * momDecel * vixResult.mult;
    rawLeverage = clip_(rawLeverage, CONFIG.REBALANCE.LEVERAGE_MIN, CONFIG.REBALANCE.LEVERAGE_MAX);

    var targetWeights = calcAllocation(rawLeverage, vixResult.vix_z);

    var prevWeights = state.current_weights;
    var ddTransition = (dd.state !== state.dd_state);
    var drift = calcMaxDrift(prevWeights, targetWeights);
    var shouldRebalance = ddTransition || drift > CONFIG.REBALANCE.THRESHOLD;

    var newWeights = shouldRebalance ? targetWeights : prevWeights;
    var newLeverage = shouldRebalance ? rawLeverage : state.current_leverage;

    var newState = {
      dd_state: dd.state,
      asym_variance: asymResult.variance,
      current_leverage: newLeverage,
      current_weights: newWeights,
      last_update_date: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')
    };
    saveState_(ss, newState);

    var logEntry = {
      date: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'),
      close: prices[prices.length - 1].close,
      dd_state: dd.state,
      dd_value: dd.value,
      asym_vol: asymResult.annualized_vol,
      trend_tv: trendTv,
      vt: vt,
      slope_mult: slopeMult,
      mom_decel: momDecel,
      vix_proxy: vixResult.vix_proxy,
      vix_z: vixResult.vix_z,
      vix_mult: vixResult.mult,
      raw_leverage: rawLeverage,
      prev_leverage: state.current_leverage,
      new_leverage: newLeverage,
      w_nasdaq: newWeights.w_nasdaq,
      w_gold: newWeights.w_gold,
      w_bond: newWeights.w_bond,
      rebalanced: shouldRebalance
    };
    appendLog_(ss, logEntry);

    if (shouldRebalance) {
      sendNotification_(logEntry);
    }

    Logger.log('日次更新完了: TQQQ=' + (newWeights.w_nasdaq * 100).toFixed(0) + '%' +
               ', Gold=' + (newWeights.w_gold * 100).toFixed(0) + '%' +
               ', Bond=' + (newWeights.w_bond * 100).toFixed(0) + '%' +
               (shouldRebalance ? ' (リバランス実行)' : ''));

  } catch (e) {
    Logger.log('エラー: ' + e.message + '\n' + e.stack);
    if (CONFIG.NOTIFY_ON_ERROR) {
      sendErrorNotification_(e);
    }
  } finally {
    lock.releaseLock();
  }
}


function dryRun() {
  var ss = getSpreadsheet_();
  var prices = loadPriceHistory_(ss);
  var state = loadState_(ss);

  Logger.log('=== ドライラン (Dyn 2x3x A2 Optimized) ===');
  Logger.log('データ数: ' + prices.length + '日');
  Logger.log('最新日付: ' + (prices.length > 0 ? prices[prices.length - 1].date : 'N/A'));
  Logger.log('現在のState: ' + JSON.stringify(state));

  var needed = calcMinDataNeeded_();
  if (prices.length < needed) {
    Logger.log('データ不足: 計算できません（' + prices.length + '/' + needed + '日）');
    return;
  }

  var dd = calcDD(prices, state.dd_state);
  var asymResult = calcAsymEWMA(prices, state.asym_variance);
  var trendTv = calcTrendTV(prices);
  var vt = calcVT(trendTv, asymResult.annualized_vol);
  var slopeMult = calcSlopeMult(prices);
  var momDecel = calcMomDecel(prices);
  var vixResult = calcVIXMult(prices);

  var rawLeverage = dd.value * vt * slopeMult * momDecel * vixResult.mult;
  rawLeverage = clip_(rawLeverage, CONFIG.REBALANCE.LEVERAGE_MIN, CONFIG.REBALANCE.LEVERAGE_MAX);

  var targetWeights = calcAllocation(rawLeverage, vixResult.vix_z);
  var prevWeights = state.current_weights;
  var drift = calcMaxDrift(prevWeights, targetWeights);
  var ddTransition = (dd.state !== state.dd_state);
  var shouldRebalance = ddTransition || drift > CONFIG.REBALANCE.THRESHOLD;

  Logger.log('--- Layer計算結果 ---');
  Logger.log('DD: state=' + dd.state + ', value=' + dd.value + ', ratio=' + dd.ratio.toFixed(4));
  Logger.log('AsymVol(年率): ' + asymResult.annualized_vol.toFixed(4));
  Logger.log('TrendTV: ' + trendTv.toFixed(4));
  Logger.log('VT: ' + vt.toFixed(4));
  Logger.log('SlopeMult: ' + slopeMult.toFixed(4));
  Logger.log('MomDecel: ' + momDecel.toFixed(4));
  Logger.log('VIX proxy: ' + vixResult.vix_proxy.toFixed(4) +
             ', Z=' + vixResult.vix_z.toFixed(4) +
             ', mult=' + vixResult.mult.toFixed(4));
  Logger.log('Raw Leverage: ' + rawLeverage.toFixed(4));
  Logger.log('--- 目標配分 ---');
  Logger.log('TQQQ (NASDAQ 3x): ' + (targetWeights.w_nasdaq * 100).toFixed(1) + '%');
  Logger.log('2036 (Gold 2x):   ' + (targetWeights.w_gold * 100).toFixed(1) + '%');
  Logger.log('TMF  (Bond 3x):   ' + (targetWeights.w_bond * 100).toFixed(1) + '%');
  Logger.log('--- リバランス判定 ---');
  Logger.log('現在配分: TQQQ=' + (prevWeights && prevWeights.w_nasdaq != null ? (prevWeights.w_nasdaq * 100).toFixed(1) : 'N/A') + '%' +
             ', Gold=' + (prevWeights && prevWeights.w_gold != null ? (prevWeights.w_gold * 100).toFixed(1) : 'N/A') + '%' +
             ', Bond=' + (prevWeights && prevWeights.w_bond != null ? (prevWeights.w_bond * 100).toFixed(1) : 'N/A') + '%');
  Logger.log('最大ドリフト: ' + (drift * 100).toFixed(1) + '%');
  Logger.log('リバランス: ' + (shouldRebalance ? '実行する' : '不要') +
             (ddTransition ? ' (DD遷移)' : '') +
             (drift > CONFIG.REBALANCE.THRESHOLD ? ' (ドリフト超過)' : ''));
}


function clip_(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isTradingDay_() {
  var now = new Date();
  var day = now.getDay();
  return day !== 0 && day !== 6;
}

function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}
