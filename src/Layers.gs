/**
 * Layers.gs - 5つの戦略Layer計算
 *
 * Layer 1: DD（ドローダウン制御）
 * Layer 2: VT（ボラティリティ・ターゲティング）= AsymEWMA + TrendTV
 * Layer 3: SlopeMult（MA傾き乗数）
 * Layer 4: MomDecel（モメンタム減速）
 * Layer 5: VIX_MeanReversion（VIX代理変数による平均回帰）
 */

// =============================================
// Layer 1: DD（ドローダウン制御）— 出力: 0 or 1
// =============================================

function calcDD(prices, prevState) {
  var lookback = CONFIG.DD.LOOKBACK;
  var exitThreshold = CONFIG.DD.EXIT_THRESHOLD;
  var reentryThreshold = CONFIG.DD.REENTRY_THRESHOLD;

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

function calcAsymEWMA(prices, prevVariance) {
  var spanDown = CONFIG.ASYM_EWMA.SPAN_DOWN;
  var spanUp = CONFIG.ASYM_EWMA.SPAN_UP;
  var alphaDown = 2.0 / (spanDown + 1);
  var alphaUp = 2.0 / (spanUp + 1);

  var variance;

  if (prevVariance != null && prevVariance > 0) {
    var ret = prices[prices.length - 1].close / prices[prices.length - 2].close - 1;
    var alpha = ret < 0 ? alphaDown : alphaUp;
    variance = (1 - alpha) * prevVariance + alpha * ret * ret;
  } else {
    var initPeriod = Math.min(20, prices.length - 1);
    var initReturns = [];
    for (var j = prices.length - initPeriod - 1; j < prices.length - 1; j++) {
      if (j >= 0 && j + 1 < prices.length) {
        initReturns.push(prices[j + 1].close / prices[j].close - 1);
      }
    }

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


function calcTrendTV(prices) {
  var maPeriod = CONFIG.TREND_TV.MA;
  var tvMin = CONFIG.TREND_TV.TV_MIN;
  var tvMax = CONFIG.TREND_TV.TV_MAX;
  var ratioLow = CONFIG.TREND_TV.RATIO_LOW;
  var ratioHigh = CONFIG.TREND_TV.RATIO_HIGH;

  if (prices.length < maPeriod) {
    return (tvMin + tvMax) / 2;
  }

  var sum = 0;
  for (var i = prices.length - maPeriod; i < prices.length; i++) {
    sum += prices[i].close;
  }
  var ma = sum / maPeriod;

  var currentClose = prices[prices.length - 1].close;
  var ratio = currentClose / ma;

  var trendTv = tvMin + (tvMax - tvMin) * (ratio - ratioLow) / (ratioHigh - ratioLow);
  trendTv = clip_(trendTv, tvMin, tvMax);

  return trendTv;
}


/**
 * VT計算: TrendTV / AsymVol
 * 5層掛け合わせでは中間値が1.0を超えても良い。
 * Python backtestのmax_lev=3.0に合わせて上限を設定。
 * 最終rawLeverageのclip(0, 1.0)で制御する設計。
 * @param {number} trendTv
 * @param {number} asymVol
 * @return {number} VT (0.0 ~ 3.0)
 */
function calcVT(trendTv, asymVol) {
  if (asymVol <= 0) return 1.0;
  return clip_(trendTv / asymVol, 0, 3.0);
}


// =============================================
// Layer 3: SlopeMult（MA傾き乗数）
// =============================================

function calcSlopeMult(prices) {
  var maPeriod = CONFIG.SLOPE_MULT.MA;
  var normWindow = CONFIG.SLOPE_MULT.NORM_WINDOW;
  var base = CONFIG.SLOPE_MULT.BASE;
  var sensitivity = CONFIG.SLOPE_MULT.SENSITIVITY;
  var minVal = CONFIG.SLOPE_MULT.MIN;
  var maxVal = CONFIG.SLOPE_MULT.MAX;

  var needed = maPeriod + normWindow + 1;
  if (prices.length < needed) {
    return 1.0;
  }

  var maValues = [];
  for (var d = prices.length - normWindow - 1; d < prices.length; d++) {
    var sum = 0;
    for (var i = d - maPeriod + 1; i <= d; i++) {
      sum += prices[i].close;
    }
    maValues.push(sum / maPeriod);
  }

  var slopes = [];
  for (var i = 1; i < maValues.length; i++) {
    slopes.push(maValues[i] / maValues[i - 1] - 1);
  }

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
// Layer 4: MomDecel（モメンタム減速）
// =============================================

function calcMomDecel(prices) {
  var shortPeriod = CONFIG.MOM_DECEL.SHORT;
  var longPeriod = CONFIG.MOM_DECEL.LONG;
  var sensitivity = CONFIG.MOM_DECEL.SENSITIVITY;
  var minVal = CONFIG.MOM_DECEL.MIN;
  var maxVal = CONFIG.MOM_DECEL.MAX;
  var zWindow = CONFIG.MOM_DECEL.Z_WINDOW;

  var needed = longPeriod + zWindow;
  if (prices.length < needed) {
    return 1.0;
  }

  var decels = [];
  for (var d = prices.length - zWindow; d < prices.length; d++) {
    var momShort = prices[d].close / prices[d - shortPeriod].close - 1;
    var momLong = prices[d].close / prices[d - longPeriod].close - 1;
    var momLongNorm = momLong * (shortPeriod / longPeriod);
    decels.push(momShort - momLongNorm);
  }

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


// =============================================
// Layer 5: VIX_MeanReversion
// =============================================

/**
 * VIX_MeanReversion: NASDAQ実現ボラティリティをVIX代理変数として使用
 *
 * vix_proxy = 20日実現ボラティリティ * sqrt(252)
 * vix_z     = (vix_proxy - 252日MA) / 252日std
 * vix_mult  = clip(1.0 - 0.25 * vix_z, 0.50, 1.15)
 */
function calcVIXMult(prices) {
  var volWindow = CONFIG.VIX_MR.VOL_WINDOW;
  var maWindow  = CONFIG.VIX_MR.MA_WINDOW;
  var coeff     = CONFIG.VIX_MR.COEFF;
  var minVal    = CONFIG.VIX_MR.MIN;
  var maxVal    = CONFIG.VIX_MR.MAX;

  var needed = volWindow + maWindow + 1;
  if (prices.length < needed) {
    return { vix_proxy: 0.20, vix_z: 0.0, mult: 1.0 };
  }

  var vixProxies = [];
  var startIdx = prices.length - maWindow;
  for (var d = startIdx; d < prices.length; d++) {
    var sumSq = 0;
    for (var i = d - volWindow; i < d; i++) {
      var r = prices[i + 1].close / prices[i].close - 1;
      sumSq += r * r;
    }
    var realizedVol = Math.sqrt(sumSq / volWindow * 252);
    vixProxies.push(realizedVol);
  }

  var currentVixProxy = vixProxies[vixProxies.length - 1];

  var vixMean = 0;
  for (var i = 0; i < vixProxies.length; i++) {
    vixMean += vixProxies[i];
  }
  vixMean /= vixProxies.length;

  var vixVariance = 0;
  for (var i = 0; i < vixProxies.length; i++) {
    vixVariance += (vixProxies[i] - vixMean) * (vixProxies[i] - vixMean);
  }
  var vixStd = Math.sqrt(vixVariance / vixProxies.length);

  var vixZ = vixStd > 0 ? (currentVixProxy - vixMean) / vixStd : 0;
  var mult = clip_(1.0 - coeff * vixZ, minVal, maxVal);

  return {
    vix_proxy: currentVixProxy,
    vix_z: vixZ,
    mult: mult
  };
}
