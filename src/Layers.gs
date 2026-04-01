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

/**
 * DDレイヤー: ヒステリシス付きドローダウン制御
 * @param {Array} prices - [{date, close}, ...] 日付昇順
 * @param {string} prevState - "HOLD" or "CASH"
 * @return {Object} {value: 0 or 1, state: "HOLD" or "CASH", ratio, peak}
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
  var spanDown = CONFIG.ASYM_EWMA.SPAN_DOWN;  // 10
  var spanUp = CONFIG.ASYM_EWMA.SPAN_UP;      // 30
  var alphaDown = 2.0 / (spanDown + 1);       // 0.1818
  var alphaUp = 2.0 / (spanUp + 1);           // 0.0645

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


/**
 * TrendTV: トレンド連動ターゲットVol
 * @param {Array} prices - [{date, close}, ...]
 * @return {number} trend_tv (0.10 ~ 0.30)
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
// Layer 3: SlopeMult（MA傾き乗数）— 出力: 0.3ー1.5
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

  var needed = maPeriod + normWindow + 1;
  if (prices.length < needed) {
    return 1.0;
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
// Layer 4: MomDecel（モメンタム減速）— 出力: 0.5ー1.3
// =============================================

/**
 * MomDecel: 短期/長期モメンタムの乖離をZ-score化
 * @param {Array} prices - [{date, close}, ...]
 * @return {number} mom_decel (0.5 ~ 1.3)
 */
function calcMomDecel(prices) {
  var shortPeriod = CONFIG.MOM_DECEL.SHORT;   // 60
  var longPeriod = CONFIG.MOM_DECEL.LONG;     // 180
  var sensitivity = CONFIG.MOM_DECEL.SENSITIVITY;
  var minVal = CONFIG.MOM_DECEL.MIN;
  var maxVal = CONFIG.MOM_DECEL.MAX;
  var zWindow = CONFIG.MOM_DECEL.Z_WINDOW;

  var needed = longPeriod + zWindow;
  if (prices.length < needed) {
    return 1.0;
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


// =============================================
// Layer 5: VIX_MeanReversion — 出力: 0.50ー1.15
// =============================================

/**
 * VIX_MeanReversion: NASDAQ実現ボラティリティをVIX代理変数として使用
 *
 * vix_proxy = 20日実現ボラティリティ × √252
 * vix_ma    = vix_proxy.rolling(252).mean()
 * vix_std   = vix_proxy.rolling(252).std()
 * vix_z     = (vix_proxy - vix_ma) / vix_std
 * vix_mult  = clip(1.0 - 0.25 × vix_z, 0.50, 1.15)
 *
 * @param {Array} prices - [{date, close}, ...] 日付昇順
 * @return {Object} {vix_proxy, vix_z, mult}
 */
function calcVIXMult(prices) {
  var volWindow = CONFIG.VIX_MR.VOL_WINDOW;  // 20
  var maWindow  = CONFIG.VIX_MR.MA_WINDOW;   // 252
  var coeff     = CONFIG.VIX_MR.COEFF;       // 0.25
  var minVal    = CONFIG.VIX_MR.MIN;         // 0.50
  var maxVal    = CONFIG.VIX_MR.MAX;         // 1.15

  // maWindow個のvix_proxyを計算するために必要な価格点数:
  // 最古のvix_proxy点(startIdx)にはvolWindow日分のリターンが必要 → volWindow+maWindow+1点必要
  var needed = volWindow + maWindow + 1;
  if (prices.length < needed) {
    return { vix_proxy: 0.20, vix_z: 0.0, mult: 1.0 };
  }

  // 直近maWindow個分のvix_proxy値を計算
  var vixProxies = [];
  var startIdx = prices.length - maWindow;
  for (var d = startIdx; d < prices.length; d++) {
    // d点でのvolWindow日実現ボラ（内部: volWindow品の対数リターン二乗和）
    var sumSq = 0;
    for (var i = d - volWindow; i < d; i++) {
      var r = prices[i + 1].close / prices[i].close - 1;
      sumSq += r * r;
    }
    var realizedVol = Math.sqrt(sumSq / volWindow * 252);
    vixProxies.push(realizedVol);
  }

  // 最新vix_proxy（最後の要素）
  var currentVixProxy = vixProxies[vixProxies.length - 1];

  // 252日MA / std
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
