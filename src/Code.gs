/**
 * NASDAQ 3倍レバレッジ 自動運用システム
 * メインエントリーポイント
 *
 * 戦略: MomDecel(40/120) + Ens2(S+T)
 * 最終レバレッジ = DD × VT × SlopeMult × MomDecel
 */

// ===== グローバル設定 =====
var CONFIG = {
  // スプレッドシートID（初回Setup実行時に自動設定、または手動設定）
  SPREADSHEET_ID: '',

  // シート名
  SHEET_PRICE: 'PriceHistory',
  SHEET_STATE: 'State',
  SHEET_LOG: 'Log',

  // データ取得設定
  TICKER: '^IXIC',  // NASDAQ Composite
  PRICE_DAYS_NEEDED: 300,  // 260営業日+バッファ

  // 戦略パラメータ
  DD: {
    LOOKBACK: 200,
    EXIT_THRESHOLD: 0.82,
    REENTRY_THRESHOLD: 0.92
  },
  ASYM_EWMA: {
    SPAN_DOWN: 5,
    SPAN_UP: 20
  },
  TREND_TV: {
    MA: 150,
    TV_MIN: 0.15,
    TV_MAX: 0.35,
    RATIO_LOW: 0.85,
    RATIO_HIGH: 1.15
  },
  SLOPE_MULT: {
    MA: 200,
    NORM_WINDOW: 60,
    BASE: 0.7,
    SENSITIVITY: 0.3,
    MIN: 0.3,
    MAX: 1.5
  },
  MOM_DECEL: {
    SHORT: 40,
    LONG: 120,
    SENSITIVITY: 0.3,
    MIN: 0.5,
    MAX: 1.3,
    Z_WINDOW: 120
  },
  REBALANCE: {
    THRESHOLD: 0.20,  // 20%超で実行
    LEVERAGE_MIN: 0.0,
    LEVERAGE_MAX: 1.0,
    PRODUCT_MULTIPLIER: 3  // 3倍商品
  },

  // 通知設定
  LINE: {
    CHANNEL_ACCESS_TOKEN: '',  // LINE Messaging API チャネルアクセストークン
    USER_ID: ''                // 送信先のLINEユーザーID（U始まりの文字列）
  },
  EMAIL: '',       // 通知先メール（手動設定）
  NOTIFY_ON_ERROR: true
};


/**
 * メイン処理: 毎営業日1回実行
 */
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
    // 1. 今日が営業日か確認
    if (!isTradingDay_()) {
      Logger.log('本日は営業日ではありません');
      return;
    }

    // 2. Yahoo Financeから最新価格を取得してPriceHistoryに追記
    var newPrice = fetchLatestPrice();
    if (newPrice) {
      appendPrice_(ss, newPrice);
    }

    // 3. PriceHistoryから直近データを読み込み
    var prices = loadPriceHistory_(ss);
    if (prices.length < CONFIG.DD.LOOKBACK) {
      Logger.log('データ不足: ' + prices.length + '日分しかありません（最低' + CONFIG.DD.LOOKBACK + '日必要）');
      return;
    }

    // 4. Stateを読み込み
    var state = loadState_(ss);

    // 5. 4つのLayerを計算
    var dd = calcDD(prices, state.dd_state);
    var asymResult = calcAsymEWMA(prices, state.asym_variance);
    var trendTv = calcTrendTV(prices);
    var vt = calcVT(trendTv, asymResult.annualized_vol);
    var slopeMult = calcSlopeMult(prices);
    var momDecel = calcMomDecel(prices);

    // 6. raw_leverage算出
    var rawLeverage = dd.value * vt * slopeMult * momDecel;
    rawLeverage = clip_(rawLeverage, CONFIG.REBALANCE.LEVERAGE_MIN, CONFIG.REBALANCE.LEVERAGE_MAX);

    // 7. リバランス判定
    var prevLeverage = state.current_leverage;
    var ddTransition = (dd.state !== state.dd_state);
    var leverageDiff = Math.abs(rawLeverage - prevLeverage);
    var shouldRebalance = ddTransition || leverageDiff > CONFIG.REBALANCE.THRESHOLD;

    var newLeverage = shouldRebalance ? rawLeverage : prevLeverage;

    // 8. State更新
    var newState = {
      dd_state: dd.state,
      asym_variance: asymResult.variance,
      current_leverage: newLeverage,
      last_update_date: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')
    };
    saveState_(ss, newState);

    // 9. ログ記録
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
      raw_leverage: rawLeverage,
      prev_leverage: prevLeverage,
      new_leverage: newLeverage,
      rebalanced: shouldRebalance
    };
    appendLog_(ss, logEntry);

    // 10. 変更があれば通知
    if (shouldRebalance) {
      sendNotification_(logEntry);
    }

    Logger.log('日次更新完了: leverage=' + (newLeverage * 100).toFixed(1) + '%' +
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


/**
 * 手動実行: 計算結果を確認（リバランスは実行しない）
 */
function dryRun() {
  var ss = getSpreadsheet_();
  var prices = loadPriceHistory_(ss);
  var state = loadState_(ss);

  Logger.log('=== ドライラン ===');
  Logger.log('データ数: ' + prices.length + '日');
  Logger.log('最新日付: ' + (prices.length > 0 ? prices[prices.length - 1].date : 'N/A'));
  Logger.log('現在のState: ' + JSON.stringify(state));

  if (prices.length < CONFIG.DD.LOOKBACK) {
    Logger.log('データ不足: 計算できません');
    return;
  }

  var dd = calcDD(prices, state.dd_state);
  var asymResult = calcAsymEWMA(prices, state.asym_variance);
  var trendTv = calcTrendTV(prices);
  var vt = calcVT(trendTv, asymResult.annualized_vol);
  var slopeMult = calcSlopeMult(prices);
  var momDecel = calcMomDecel(prices);

  var rawLeverage = dd.value * vt * slopeMult * momDecel;
  rawLeverage = clip_(rawLeverage, CONFIG.REBALANCE.LEVERAGE_MIN, CONFIG.REBALANCE.LEVERAGE_MAX);

  Logger.log('--- 計算結果 ---');
  Logger.log('DD: state=' + dd.state + ', value=' + dd.value);
  Logger.log('AsymVol: ' + asymResult.annualized_vol.toFixed(4));
  Logger.log('TrendTV: ' + trendTv.toFixed(4));
  Logger.log('VT: ' + vt.toFixed(4));
  Logger.log('SlopeMult: ' + slopeMult.toFixed(4));
  Logger.log('MomDecel: ' + momDecel.toFixed(4));
  Logger.log('Raw Leverage: ' + rawLeverage.toFixed(4));
  Logger.log('現在のポジション: ' + (state.current_leverage * 100).toFixed(1) + '%');
  Logger.log('差分: ' + (Math.abs(rawLeverage - state.current_leverage) * 100).toFixed(1) + '%');

  var ddTransition = (dd.state !== state.dd_state);
  var leverageDiff = Math.abs(rawLeverage - state.current_leverage);
  var shouldRebalance = ddTransition || leverageDiff > CONFIG.REBALANCE.THRESHOLD;
  Logger.log('リバランス: ' + (shouldRebalance ? '実行する' : '不要') +
             (ddTransition ? ' (DD遷移)' : '') +
             (leverageDiff > CONFIG.REBALANCE.THRESHOLD ? ' (閾値超過)' : ''));
}


// ===== ユーティリティ =====

function clip_(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isTradingDay_() {
  var now = new Date();
  var day = now.getDay();
  // 土日は休場（米国祝日は厳密にはチェックしないが、データ取得失敗で自然にスキップ）
  return day !== 0 && day !== 6;
}

function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}
