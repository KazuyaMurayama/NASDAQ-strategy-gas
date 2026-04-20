/**
 * NASDAQ 3x + Gold 2x + Bond 3x 動的配分戦略「Dyn 2x3x [A]」
 * メインエントリーポイント
 *
 * 戦略: DH Dyn 2x3x [Approach A / スリーブ独立型]
 *       (旧: Approach B = 統合レバレッジ方式から 2026-04-20 切替)
 *
 * シグナル: A2 Optimized (5-layer)
 *   rawLeverage = DD(0.82/0.92) × VT(AsymEWMA(30/10), TrendTV(10-30%))
 *               × SlopeMult(base=0.9, sens=0.35) × MomDecel(60/180)
 *               × VIX_MeanReversion(coeff=0.25, MA=252)
 *   rawLeverage = clip(rawLeverage, 0, 1.0)
 *   finalLeverage = rebalance_threshold(rawLeverage, 0.20)
 *
 * 実保有 (スリーブ独立):
 *   TQQQ = w_nasdaq × lev   (NASDAQスリーブ内TQQQ)
 *   Gold = w_gold            (常時100%、lev非依存)
 *   Bond = w_bond            (常時100%、lev非依存)
 *   CASH = w_nasdaq × (1-lev) (NASDAQスリーブ内バッファのみ)
 *
 * 期待CAGR (1974-2026, 全期間): +30.30% (B 24.46% から +5.84pp)
 * 詳細: docs/APPROACH_A_MIGRATION_2026-04-20.md
 */

// ===== グローバル設定 =====
var CONFIG = {
  SPREADSHEET_ID: '',

  SHEET_PRICE: 'PriceHistory',
  SHEET_STATE: 'State',
  SHEET_LOG:   'Log',

  TICKER:            '^IXIC',
  PRICE_DAYS_NEEDED: 350,  // calcMinDataNeeded_()=300営業日 + バッファ

  DD: {
    LOOKBACK:           200,
    EXIT_THRESHOLD:     0.82,
    REENTRY_THRESHOLD:  0.92
  },
  ASYM_EWMA: {
    SPAN_DOWN: 10,
    SPAN_UP:   30
  },
  TREND_TV: {
    MA:          150,
    TV_MIN:      0.10,
    TV_MAX:      0.30,
    RATIO_LOW:   0.85,
    RATIO_HIGH:  1.15
  },
  SLOPE_MULT: {
    MA:          200,
    NORM_WINDOW: 60,
    BASE:        0.9,
    SENSITIVITY: 0.35,
    MIN:         0.3,
    MAX:         1.5
  },
  MOM_DECEL: {
    SHORT:       60,
    LONG:        180,
    SENSITIVITY: 0.3,
    MIN:         0.5,
    MAX:         1.3,
    Z_WINDOW:    120
  },
  VIX_MR: {
    VOL_WINDOW: 20,
    MA_WINDOW:  252,
    COEFF:      0.25,
    MIN:        0.50,
    MAX:        1.15
  },
  REBALANCE: {
    THRESHOLD:    0.20,
    LEVERAGE_MIN: 0.0,
    LEVERAGE_MAX: 1.0
  },
  ALLOCATION: {
    W_NASDAQ_BASE:           0.55,
    W_NASDAQ_LEVERAGE_COEFF: 0.25,
    W_NASDAQ_VIX_COEFF:      0.10,
    W_NASDAQ_MIN:            0.30,
    W_NASDAQ_MAX:            0.90
  },

  LINE: {
    CHANNEL_ACCESS_TOKEN: '',
    USER_ID:              ''
  },
  EMAIL:          '',
  NOTIFY_ON_ERROR: true,

  // 毎日のステータスサマリー通知 (リバランスなしの日も通知したい場合に有効化)
  STATUS_REPORT: {
    ENABLED: false  // true に変更すると毎日通知
  }
};


/**
 * 全Layerで必要な最小データ日数
 * DD=200, SlopeMult=261, VIX_MR=273, MomDecel=300 の最大値
 * @return {number}
 */
function calcMinDataNeeded_() {
  return Math.max(
    CONFIG.DD.LOOKBACK,
    CONFIG.SLOPE_MULT.MA + CONFIG.SLOPE_MULT.NORM_WINDOW + 1,
    CONFIG.VIX_MR.MA_WINDOW + CONFIG.VIX_MR.VOL_WINDOW + 1,
    CONFIG.MOM_DECEL.LONG + CONFIG.MOM_DECEL.Z_WINDOW
  );
}


// ===== メイン処理 =====

/**
 * 毎営業日1回実行 (トリガー: 日本時間 07:00)
 */
function dailyUpdate() {
  var ss   = getSpreadsheet_();
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);
  } catch (e) {
    Logger.log('ロック取得失敗 (既に実行中?)');
    return;
  }

  try {
    if (!isTradingDay_()) {
      Logger.log('本日は営業日ではありません');
      return;
    }

    // ヘルスチェック（致命的エラーがあれば中断）
    var hc = runHealthCheck();
    if (!hc.ok) {
      Logger.log('HealthCheckエラーのため処理を中断');
      return;
    }

    var newPrice = fetchLatestPrice();
    if (newPrice) appendPrice_(ss, newPrice);

    var prices = loadPriceHistory_(ss);
    var needed = calcMinDataNeeded_();
    if (prices.length < needed) {
      Logger.log('データ不足: ' + prices.length + '/' + needed + '日');
      return;
    }

    var state = loadState_(ss);

    // 5層計算
    var dd        = calcDD(prices, state.dd_state);
    var asym      = calcAsymEWMA(prices, state.asym_variance);
    var trendTv   = calcTrendTV(prices);
    var vt        = calcVT(trendTv, asym.annualized_vol);
    var slope     = calcSlopeMult(prices);
    var mom       = calcMomDecel(prices);
    var vix       = calcVIXMult(prices);

    var rawLev = clip_(dd.value * vt * slope * mom * vix.mult,
                       CONFIG.REBALANCE.LEVERAGE_MIN,
                       CONFIG.REBALANCE.LEVERAGE_MAX);

    var targetW = calcAllocation(rawLev, vix.vix_z);

    // リバランス判定 — バックテストの rebalance_threshold() と完全一致
    // DD退出(rawLev=0) / DD復帰(currentLev=0) は即時、それ以外は |raw - current| > THRESHOLD
    var leverageDiff    = Math.abs(rawLev - state.current_leverage);
    var ddToZero        = (rawLev === 0 && state.current_leverage > 0);
    var ddFromZero      = (state.current_leverage === 0 && rawLev > 0);
    var shouldRebalance = ddToZero || ddFromZero || (leverageDiff > CONFIG.REBALANCE.THRESHOLD);

    var newW   = shouldRebalance ? targetW : state.current_weights;
    var newLev = shouldRebalance ? rawLev  : state.current_leverage;

    // 5営業日後フォワードリターン参照
    var fwd = lookupForwardReturn_(newW ? newW.w_nasdaq : null, dd.state, rawLev);

    saveState_(ss, {
      dd_state:         dd.state,
      asym_variance:    asym.variance,
      current_leverage: newLev,
      current_weights:  newW,
      last_update_date: today_()
    });

    var entry = {
      date:              today_(),
      close:             prices[prices.length - 1].close,
      dd_state:          dd.state,
      dd_value:          dd.value,
      asym_vol:          asym.annualized_vol,
      trend_tv:          trendTv,
      vt:                vt,
      slope_mult:        slope,
      mom_decel:         mom,
      vix_proxy:         vix.vix_proxy,
      vix_z:             vix.vix_z,
      vix_mult:          vix.mult,
      raw_leverage:      rawLev,
      prev_leverage:     state.current_leverage,
      new_leverage:      newLev,
      w_nasdaq:          newW.w_nasdaq,
      w_gold:            newW.w_gold,
      w_bond:            newW.w_bond,
      rebalanced:        shouldRebalance,
      forward_cagr_5d:   fwd ? fwd.cagr   : null,
      forward_median_5d: fwd ? fwd.median : null
    };
    appendLog_(ss, entry);

    if (shouldRebalance) sendNotification_(entry);
    sendDailyStatus(entry, shouldRebalance);

    Logger.log('完了: TQQQ=' + pct_(newW.w_nasdaq) +
               ' Gold=' + pct_(newW.w_gold) +
               ' Bond=' + pct_(newW.w_bond) +
               (shouldRebalance ? ' [REBALANCE]' : '') +
               (fwd ? ' [fwd5d CAGR=+' + fwd.cagr + '%]' : ''));

  } catch (e) {
    Logger.log('ERROR: ' + e.message + '\n' + e.stack);
    if (CONFIG.NOTIFY_ON_ERROR) sendErrorNotification_(e);
  } finally {
    lock.releaseLock();
  }
}


/**
 * ドライラン: 計算結果を確認（State変更・通知なし）
 */
function dryRun() {
  var ss     = getSpreadsheet_();
  var prices = loadPriceHistory_(ss);
  var state  = loadState_(ss);
  var needed = calcMinDataNeeded_();

  Logger.log('=== Dry Run: Dyn 2x3x [A] (Approach A / スリーブ独立) ===');
  Logger.log('データ: ' + prices.length + '/' + needed + '日');
  if (prices.length < needed) { Logger.log('データ不足'); return; }

  var dd      = calcDD(prices, state.dd_state);
  var asym    = calcAsymEWMA(prices, state.asym_variance);
  var trendTv = calcTrendTV(prices);
  var vt      = calcVT(trendTv, asym.annualized_vol);
  var slope   = calcSlopeMult(prices);
  var mom     = calcMomDecel(prices);
  var vix     = calcVIXMult(prices);

  var rawLev = clip_(dd.value * vt * slope * mom * vix.mult,
                     CONFIG.REBALANCE.LEVERAGE_MIN, CONFIG.REBALANCE.LEVERAGE_MAX);
  var targetW      = calcAllocation(rawLev, vix.vix_z);
  var leverageDiff = Math.abs(rawLev - state.current_leverage);
  var ddToZero     = (rawLev === 0 && state.current_leverage > 0);
  var ddFromZero   = (state.current_leverage === 0 && rawLev > 0);
  var rebal        = ddToZero || ddFromZero || (leverageDiff > CONFIG.REBALANCE.THRESHOLD);

  Logger.log('DD:       ' + dd.state + '  ratio=' + dd.ratio.toFixed(4));
  Logger.log('AsymVol:  ' + asym.annualized_vol.toFixed(4));
  Logger.log('TrendTV:  ' + trendTv.toFixed(4) + '  VT=' + vt.toFixed(4));
  Logger.log('Slope:    ' + slope.toFixed(4));
  Logger.log('MomDecel: ' + mom.toFixed(4));
  Logger.log('VIX_z:    ' + vix.vix_z.toFixed(4) + '  mult=' + vix.mult.toFixed(4));
  Logger.log('rawLev:   ' + rawLev.toFixed(4) + '  currentLev: ' + state.current_leverage.toFixed(4));
  Logger.log('--- 目標ウェイト (w_*) ---');
  Logger.log('w_nasdaq: ' + pct_(targetW.w_nasdaq));
  Logger.log('w_gold:   ' + pct_(targetW.w_gold));
  Logger.log('w_bond:   ' + pct_(targetW.w_bond));
  // Approach A: 実保有 (スリーブ独立)
  var dryHoldings = calcActualHoldings(rawLev, targetW);
  Logger.log('--- 実保有 (Approach A / スリーブ独立) ---');
  Logger.log('TQQQ:          ' + pct_(dryHoldings.actual_tqqq) + ' (= w_nasdaq × lev)');
  Logger.log('2036 (Gold):   ' + pct_(dryHoldings.actual_gold) + ' (= w_gold, lev非依存)');
  Logger.log('TMF  (Bond):   ' + pct_(dryHoldings.actual_bond) + ' (= w_bond, lev非依存)');
  Logger.log('CASH (バッファ): ' + pct_(dryHoldings.actual_cash) + ' (= w_nasdaq × (1-lev))');
  Logger.log('現在ウェイト: TQQQ=' + pct_(state.current_weights.w_nasdaq) +
             ' Gold=' + pct_(state.current_weights.w_gold) +
             ' Bond=' + pct_(state.current_weights.w_bond));
  Logger.log('レバレッジ差: ' + (leverageDiff * 100).toFixed(1) + '%  リバランス: ' + (rebal ? 'YES' : 'NO'));

  // フォワードリターン参照
  var fwd = lookupForwardReturn_(targetW.w_nasdaq, dd.state, rawLev);
  if (fwd) {
    Logger.log('--- フォワードリターン（5営業日後） ---');
    Logger.log('CAGR年率: +' + fwd.cagr + '%  中央値: +' + fwd.median + '%');
    Logger.log('ビン: ' + fwd.binLabel);
  }
}


/**
 * 緊急リセット: Stateを初期値に戻す
 */
function emergencyResetState() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    '緊急リセット確認',
    'Stateを初期化します。次回dailyUpdateで必ずリバランスが発生します。続行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  var ss = getSpreadsheet_();
  saveState_(ss, {
    dd_state:         'HOLD',
    asym_variance:    null,
    current_leverage: 1.0,
    current_weights:  { w_nasdaq: null, w_gold: null, w_bond: null },
    last_update_date: ''
  });
  Logger.log('State をリセットしました');
  ui.alert('State をリセットしました');
}


// ===== プライベートユーティリティ =====

function clip_(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isTradingDay_() {
  var d = new Date().getDay();
  return d !== 0 && d !== 6;
}

function today_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

function pct_(v) {
  if (v == null) return 'N/A';
  return (v * 100).toFixed(1) + '%';
}

function getSpreadsheet_() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}
