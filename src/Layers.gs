/**
 * Layers.gs - 4つの戦略Layer計算
 *
 * Layer 1: DD（ドローダウン制御）
 * Layer 2: VT（ボラティリティ・ターゲティング）= AsymEWMA + TrendTV
 * Layer 3: SlopeMult（MA傾き乗数）
 * Layer 4: MomDecel（モメンタム減速）
 */

// =============================================
// Layer 1: DD（ドローダウン制御）— 出力: 0 or 1
// =============================================

/**
 * DDレイヤー: ヒステリシス付きドローダウン制御
 * @param {Array} prices - [{date, close}, ...] 日付昇順
 * @param {string} prevState - "HOLD" or "CASH"
 * @return {Object} {value: 0 or 1, state: "HOLD" or "CASH"}
 */
function calcDD(prices, prevState) {
  var lookback = CONFIG.DD.LOOKBACK;
  var exitThreshold = CONFIG.DD.EXIT_THRESHOLD;
  var reentryThreshold = CONFIG.DD.REENTRY_THRESHOLD;

  // 直近lookback日の最高値
  var startIdx = Math.max(0, prices.length - lookback);
  var peak = 0;
  for (var i = startIdx; i < prices.length; i++) {
    if (prices[i].close > peak) {
      peak = prices[i].close;
    }
  }

  var currentClose = prices[prices.length - 1].close;
  var ratio = currentClose / peak;

  var newState = prevState;
  if (prevState === 'HOLD' && ratio <= exitThreshold) {
    newState = 'CASH';
  } else if (prevState === 'CASH' && ratio >= reentryThreshold) {
    newState = 'HOLD';
  }

  return {
    value: newState === 'HOLD' ? 1 : 0,
    state: newState,
    ratio: ratio,
    peak: peak
  };
}


// =============================================
// Layer 2: VT（ボラティリティ・ターゲティング）
// =============================================

/**
 * AsymEWMA: 非対称指数加重移動平均ボラティリティ
 * @param {Array} prices - [{date, close}, ...]
 * @param {number|null} prevVariance - 前日のvariance（Stateから）
 * @return {Object} {variance, annualized_vol}
 */
function calcAsymEWMA(prices, prevVariance) {
  var spanDown = CONFIG.ASYM_EWMA.SPAN_DOWN;
  var spanUp = CONFIG.ASYM_EWMA.SPAN_UP;
  var alphaDown = 2.0 / (spanDown + 1);  // 0.3333
  var alphaUp = 2.0 / (spanUp + 1);      // 0.0952

  var variance;

  if (prevVariance != null && prevVariance > 0) {
    // 再帰計算: 最新のリターンのみ使って更新
    var ret = prices[prices.length - 1].close / prices[prices.length - 2].close - 1;
    var alpha = ret < 0 ? alphaDown : alphaUp;
    variance = (1 - alpha) * prevVariance + alpha * ret * ret;
  } else {
    // 初期化: 直近20日のリターンの分散から開始し、全データで再帰計算
    var initPeriod = Math.min(20, prices.length - 1);
    var initReturns = [];
    for (var j = prices.length - initPeriod - 1; j < prices.length - 1; j++) {
      if (j >= 0 && j + 1 < prices.length) {
        initReturns.push(prices[j + 1].close / prices[j].close - 1);
      }
    }

    // 初期variance = 初期リターンの分散
    var mean = 0;
    for (var k = 0; k < initReturns.length; k++) {
      mean += initReturns[k];
    }
    mean /= initReturns.length;

    variance = 0;
    for (var k = 0; k < initReturns.length; k++) {
      variance += (initReturns[k] - mean) * (initReturns[k] - mean);
    }
    variance /= initReturns.length;

    // 残りのデータで再帰更新
    var startIdx = prices.length - initPeriod;
    for (var i = startIdx; i < prices.length; i++) {
      var ret = prices[i].close / prices[i - 1].close - 1;
      var alpha = ret < 0 ? alphaDown : alphaUp;
      variance = (1 - alpha) * variance + alpha * ret * ret;
    }
  }

  var annualizedVol = Math.sqrt(variance * 252);

  return {
    variance: variance,
    annualized_vol: annualizedVol
  };
}


/**
 * TrendTV: トレンド連動ターゲットVol
 * @param {Array} prices - [{date, close}, ...]
 * @return {number} trend_tv (0.15 ~ 0.35)
 */
function calcTrendTV(prices) {
  var maPeriod = CONFIG.TREND_TV.MA;
  var tvMin = CONFIG.TREND_TV.TV_MIN;
  var tvMax = CONFIG.TREND_TV.TV_MAX;
  var ratioLow = CONFIG.TREND_TV.RATIO_LOW;
  var ratioHigh = CONFIG.TREND_TV.RATIO_HIGH;

  if (prices.length < maPeriod) {
    return (tvMin + tvMax) / 2;  // データ不足時はデフォルト
  }

  // MA150
  var sum = 0;
  for (var i = prices.length - maPeriod; i < prices.length; i++) {
    sum += prices[i].close;
  }
  var ma = sum / maPeriod;

  var currentClose = prices[prices.length - 1].close;
  var ratio = currentClose / ma;

  // 線形補間 + クリップ
  var trendTv = tvMin + (tvMax - tvMin) * (ratio - ratioLow) / (ratioHigh - ratioLow);
  trendTv = clip_(trendTv, tvMin, tvMax);

  return trendTv;
}


/**
 * VT計算: TrendTV / AsymVol, clipped to [0, 1]
 * @param {number} trendTv
 * @param {number} asymVol - 年率化ボラティリティ
 * @return {number} VT (0.0 ~ 1.0)
 */
function calcVT(trendTv, asymVol) {
  if (asymVol <= 0) return 1.0;
  return Math.min(trendTv / asymVol, 1.0);
}


// =============================================
// Layer 3: SlopeMult（MA傾き乗数）— 出力: 0.3〜1.5
// =============================================

/**
 * SlopeMult: MA200の傾きをZ-score化して乗数に変換
 * @param {Array} prices - [{date, close}, ...]
 * @return {number} slope_mult (0.3 ~ 1.5)
 */
function calcSlopeMult(prices) {
  var maPeriod = CONFIG.SLOPE_MULT.MA;
  var normWindow = CONFIG.SLOPE_MULT.NORM_WINDOW;
  var base = CONFIG.SLOPE_MULT.BASE;
  var sensitivity = CONFIG.SLOPE_MULT.SENSITIVITY;
  var minVal = CONFIG.SLOPE_MULT.MIN;
  var maxVal = CONFIG.SLOPE_MULT.MAX;

  // MA200 + 60日normの計算に必要: maPeriod + normWindow + 1日分
  var needed = maPeriod + normWindow + 1;
  if (prices.length < needed) {
    return 1.0;  // データ不足時はデフォルト
  }

  // MA200を日ごとに計算（normWindow+1日分必要）
  var maValues = [];
  for (var d = prices.length - normWindow - 1; d < prices.length; d++) {
    var sum = 0;
    for (var i = d - maPeriod + 1; i <= d; i++) {
      sum += prices[i].close;
    }
    maValues.push(sum / maPeriod);
  }

  // 日次変化率（slope）
  var slopes = [];
  for (var i = 1; i < maValues.length; i++) {
    slopes.push(maValues[i] / maValues[i - 1] - 1);
  }

  // Z-score: 直近60日のslopeでZ-score化
  var slopeMean = 0;
  for (var i = 0; i < slopes.length; i++) {
    slopeMean += slopes[i];
  }
  slopeMean /= slopes.length;

  var slopeStd = 0;
  for (var i = 0; i < slopes.length; i++) {
    slopeStd += (slopes[i] - slopeMean) * (slopes[i] - slopeMean);
  }
  slopeStd = Math.sqrt(slopeStd / slopes.length);

  if (slopeStd === 0) return base;

  var latestSlope = slopes[slopes.length - 1];
  var slopeZ = (latestSlope - slopeMean) / slopeStd;

  var slopeMult = clip_(base + sensitivity * slopeZ, minVal, maxVal);
  return slopeMult;
}


// =============================================
// Layer 4: MomDecel（モメンタム減速）— 出力: 0.5〜1.3
// =============================================

/**
 * MomDecel: 短期/長期モメンタムの乖離をZ-score化
 * @param {Array} prices - [{date, close}, ...]
 * @return {number} mom_decel (0.5 ~ 1.3)
 */
function calcMomDecel(prices) {
  var shortPeriod = CONFIG.MOM_DECEL.SHORT;
  var longPeriod = CONFIG.MOM_DECEL.LONG;
  var sensitivity = CONFIG.MOM_DECEL.SENSITIVITY;
  var minVal = CONFIG.MOM_DECEL.MIN;
  var maxVal = CONFIG.MOM_DECEL.MAX;
  var zWindow = CONFIG.MOM_DECEL.Z_WINDOW;

  // longPeriod + zWindow 日分のデータが必要
  var needed = longPeriod + zWindow;
  if (prices.length < needed) {
    return 1.0;  // データ不足時はデフォルト
  }

  // decelを過去zWindow日分計算
  var decels = [];
  for (var d = prices.length - zWindow; d < prices.length; d++) {
    var momShort = prices[d].close / prices[d - shortPeriod].close - 1;
    var momLong = prices[d].close / prices[d - longPeriod].close - 1;
    var momLongNorm = momLong * (shortPeriod / longPeriod);
    decels.push(momShort - momLongNorm);
  }

  // Z-score
  var decelMean = 0;
  for (var i = 0; i < decels.length; i++) {
    decelMean += decels[i];
  }
  decelMean /= decels.length;

  var decelStd = 0;
  for (var i = 0; i < decels.length; i++) {
    decelStd += (decels[i] - decelMean) * (decels[i] - decelMean);
  }
  decelStd = Math.sqrt(decelStd / decels.length);

  if (decelStd === 0) return 1.0;

  var latestDecel = decels[decels.length - 1];
  var decelZ = (latestDecel - decelMean) / decelStd;

  var momDecel = clip_(1.0 + sensitivity * decelZ, minVal, maxVal);
  return momDecel;
}
