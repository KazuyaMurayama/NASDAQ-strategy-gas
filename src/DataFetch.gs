/**
 * DataFetch.gs - Yahoo Finance から各資産の価格データを取得
 *
 * 主要: NASDAQ Composite (^IXIC)
 * オプション: Gold先物 (GC=F), 10年国債利回り (^TNX)
 */

// ===== 内部ユーティリティ =====

/**
 * Yahoo Finance v8 API から指定ティッカーの直近データを取得（リトライ付き）
 * @param {string} ticker
 * @param {string} range  - "5d" など
 * @return {Object|null}  {timestamp, closes} or null
 */
function fetchYahooChart_(ticker, range) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
            encodeURIComponent(ticker) +
            '?range=' + range + '&interval=1d';
  var options = {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  };

  var maxRetries = 3;
  var waitMs = 1000;

  for (var attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      Utilities.sleep(waitMs);
      waitMs *= 2;  // 指数バックオフ: 1s → 2s → 4s
    }

    try {
      var response = UrlFetchApp.fetch(url, options);
      var code = response.getResponseCode();
      if (code !== 200) {
        Logger.log('Yahoo Finance [' + ticker + '] HTTP ' + code +
                   ' (attempt ' + (attempt + 1) + ')');
        continue;
      }

      var json = JSON.parse(response.getContentText());
      var result = json.chart.result;
      if (!result || result.length === 0) {
        Logger.log('Yahoo Finance [' + ticker + '] 空レスポンス');
        continue;
      }

      return {
        timestamps: result[0].timestamp,
        closes: result[0].indicators.quote[0].close
      };

    } catch (e) {
      Logger.log('Yahoo Finance [' + ticker + '] 例外 (attempt ' + (attempt + 1) + '): ' + e.message);
    }
  }

  Logger.log('Yahoo Finance [' + ticker + '] 全リトライ失敗');
  return null;
}


/**
 * チャートデータから最新の有効な終値と日付を取り出す
 * @param {Object} chart - {timestamps, closes}
 * @param {string} timezone
 * @return {Object|null} {date, close}
 */
function extractLatestClose_(chart, timezone) {
  for (var i = chart.timestamps.length - 1; i >= 0; i--) {
    if (chart.closes[i] != null && chart.closes[i] > 0) {
      var d = new Date(chart.timestamps[i] * 1000);
      return {
        date:  Utilities.formatDate(d, timezone, 'yyyy-MM-dd'),
        close: Math.round(chart.closes[i] * 100) / 100
      };
    }
  }
  return null;
}


// ===== 公開API =====

/**
 * NASDAQ Composite (^IXIC) の最新終値を取得
 * @return {Object|null} {date, close}
 */
function fetchLatestPrice() {
  var chart = fetchYahooChart_(CONFIG.TICKER, '5d');
  if (chart) {
    var price = extractLatestClose_(chart, 'America/New_York');
    if (price) return price;
  }

  // フォールバック: スプレッドシートのGOOGLEFINANCE式
  return fetchLatestPriceAlternative_();
}


/**
 * フォールバック: State!E1 のGOOGLEFINANCE値を読む
 */
function fetchLatestPriceAlternative_() {
  try {
    var stateSheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET_STATE);
    if (!stateSheet) return null;

    var price = stateSheet.getRange('E1').getValue();
    if (typeof price !== 'number' || price <= 0) {
      Logger.log('GoogleFinance代替取得も失敗');
      return null;
    }

    return {
      date:  Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd'),
      close: Math.round(price * 100) / 100
    };
  } catch (e) {
    Logger.log('代替取得エラー: ' + e.message);
    return null;
  }
}


/**
 * Gold先物 (GC=F) の最新価格を取得（参考情報・筆記用）
 * @return {Object|null} {date, close}
 */
function fetchGoldPrice() {
  var chart = fetchYahooChart_('GC=F', '5d');
  if (!chart) return null;
  return extractLatestClose_(chart, 'America/New_York');
}


/**
 * 10年国債利回り (^TNX) を取得（参考情報・筆記用）
 * @return {Object|null} {date, yield}
 */
function fetchBondYield() {
  var chart = fetchYahooChart_('^TNX', '5d');
  if (!chart) return null;
  var row = extractLatestClose_(chart, 'America/New_York');
  if (!row) return null;
  return { date: row.date, yield: Math.round(row.close * 1000) / 1000 };
}


/**
 * 過去データを一括取得（初期セットアップ用）
 * @param {number} calendarDays - 取得するカレンダー日数
 * @return {Array} [{date, close}, ...]
 */
function fetchHistoricalPrices(calendarDays) {
  var now = Math.floor(Date.now() / 1000);
  var period1 = now - calendarDays * 86400;

  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
            encodeURIComponent(CONFIG.TICKER) +
            '?period1=' + period1 + '&period2=' + now + '&interval=1d';
  var options = {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200) {
      throw new Error('HTTP ' + response.getResponseCode());
    }

    var result = JSON.parse(response.getContentText()).chart.result[0];
    var timestamps = result.timestamp;
    var closes     = result.indicators.quote[0].close;
    var prices     = [];

    for (var i = 0; i < timestamps.length; i++) {
      if (closes[i] != null && closes[i] > 0) {
        prices.push({
          date:  Utilities.formatDate(new Date(timestamps[i] * 1000),
                                     'America/New_York', 'yyyy-MM-dd'),
          close: Math.round(closes[i] * 100) / 100
        });
      }
    }

    Logger.log('過去データ取得完了: ' + prices.length + '日分');
    return prices;

  } catch (e) {
    Logger.log('過去データ取得エラー: ' + e.message);
    return [];
  }
}


/**
 * PriceHistoryシートから価格データを読み込み
 * @param {Spreadsheet} ss
 * @return {Array} [{date, close}, ...] 日付昇順
 */
function loadPriceHistory_(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEET_PRICE);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var data   = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var prices = [];

  for (var i = 0; i < data.length; i++) {
    if (!data[i][0] || !data[i][1]) continue;
    var dateVal = data[i][0];
    var dateStr = (dateVal instanceof Date)
      ? Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(dateVal);
    var close = Number(data[i][1]);
    if (close > 0) {
      prices.push({ date: dateStr, close: close });
    }
  }

  return prices;
}


/**
 * PriceHistoryシートに新しい価格を追記（重複チェック付き）
 * @param {Spreadsheet} ss
 * @param {Object} priceData - {date, close}
 */
function appendPrice_(ss, priceData) {
  var sheet = ss.getSheetByName(CONFIG.SHEET_PRICE);
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var lastDate = sheet.getRange(lastRow, 1).getValue();
    var lastDateStr = (lastDate instanceof Date)
      ? Utilities.formatDate(lastDate, 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(lastDate);
    if (lastDateStr === priceData.date) {
      Logger.log('重複スキップ: ' + priceData.date);
      return;
    }
  }

  sheet.appendRow([priceData.date, priceData.close]);
  Logger.log('価格追記: ' + priceData.date + ' = ' + priceData.close);

  // 600行超過時に古い行を削除
  var totalRows = sheet.getLastRow();
  if (totalRows > 601) {
    sheet.deleteRows(2, totalRows - 601);
    Logger.log('古いデータ削除: ' + (totalRows - 601) + '行');
  }
}
