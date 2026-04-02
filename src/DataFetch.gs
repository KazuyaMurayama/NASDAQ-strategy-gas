/**
 * DataFetch.gs - Yahoo Finance から各資産の価格データを取得
 *
 * 主要: NASDAQ Composite (^IXIC)
 * オプション: Gold先物 (GC=F), 10年国債利回り (^TNX)
 */

/**
 * Yahoo Finance v8 API から最新の終値を取得
 * @return {Object|null} {date: string, close: number} or null
 */
function fetchLatestPrice() {
  var ticker = CONFIG.TICKER;
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
            encodeURIComponent(ticker) +
            '?range=5d&interval=1d';

  var options = {
    muteHttpExceptions: true,
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();

    if (code !== 200) {
      Logger.log('Yahoo Finance API エラー: HTTP ' + code);
      return fetchLatestPriceAlternative_();
    }

    var json = JSON.parse(response.getContentText());
    var result = json.chart.result[0];
    var timestamps = result.timestamp;
    var closes = result.indicators.quote[0].close;

    // 最新の有効なデータを取得
    for (var i = timestamps.length - 1; i >= 0; i--) {
      if (closes[i] != null) {
        var date = new Date(timestamps[i] * 1000);
        var dateStr = Utilities.formatDate(date, 'America/New_York', 'yyyy-MM-dd');
        return {
          date: dateStr,
          close: Math.round(closes[i] * 100) / 100
        };
      }
    }

    Logger.log('有効なデータがありません');
    return null;

  } catch (e) {
    Logger.log('Yahoo Finance取得エラー: ' + e.message);
    return fetchLatestPriceAlternative_();
  }
}


/**
 * 代替: Google Finance関数の値を読み取り
 */
function fetchLatestPriceAlternative_() {
  try {
    var ss = getSpreadsheet_();
    var stateSheet = ss.getSheetByName(CONFIG.SHEET_STATE);
    if (!stateSheet) return null;

    var cell = stateSheet.getRange('E1');
    var price = cell.getValue();
    if (!price || typeof price !== 'number') {
      Logger.log('Google Finance代替取得も失敗');
      return null;
    }

    var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
    return {
      date: today,
      close: Math.round(price * 100) / 100
    };
  } catch (e) {
    Logger.log('代替取得エラー: ' + e.message);
    return null;
  }
}


/**
 * Gold先物 (GC=F) の最新価格を取得（参考情報・筆記用）
 * @return {Object|null} {date: string, close: number} or null
 */
function fetchGoldPrice() {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
            encodeURIComponent('GC=F') +
            '?range=5d&interval=1d';

  var options = {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200) {
      Logger.log('Gold価格取得失敗: HTTP ' + response.getResponseCode());
      return null;
    }

    var json = JSON.parse(response.getContentText());
    var result = json.chart.result[0];
    var timestamps = result.timestamp;
    var closes = result.indicators.quote[0].close;

    for (var i = timestamps.length - 1; i >= 0; i--) {
      if (closes[i] != null) {
        var date = new Date(timestamps[i] * 1000);
        var dateStr = Utilities.formatDate(date, 'America/New_York', 'yyyy-MM-dd');
        return {
          date: dateStr,
          close: Math.round(closes[i] * 100) / 100
        };
      }
    }
    return null;
  } catch (e) {
    Logger.log('Gold価格取得エラー: ' + e.message);
    return null;
  }
}


/**
 * 10年国債利回り (^TNX) を取得（参考情報・筆記用）
 * @return {Object|null} {date: string, yield: number} or null
 */
function fetchBondYield() {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
            encodeURIComponent('^TNX') +
            '?range=5d&interval=1d';

  var options = {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200) {
      Logger.log('国債利回り取得失敗: HTTP ' + response.getResponseCode());
      return null;
    }

    var json = JSON.parse(response.getContentText());
    var result = json.chart.result[0];
    var timestamps = result.timestamp;
    var closes = result.indicators.quote[0].close;

    for (var i = timestamps.length - 1; i >= 0; i--) {
      if (closes[i] != null) {
        var date = new Date(timestamps[i] * 1000);
        var dateStr = Utilities.formatDate(date, 'America/New_York', 'yyyy-MM-dd');
        return {
          date: dateStr,
          yield: Math.round(closes[i] * 1000) / 1000  // 小数点3位
        };
      }
    }
    return null;
  } catch (e) {
    Logger.log('国債利回り取得エラー: ' + e.message);
    return null;
  }
}


/**
 * Yahoo Finance から過去の価格データを一括取得（初期セットアップ用）
 * @param {number} days - 取得するカレンダー日数
 * @return {Array} [{date, close}, ...]
 */
function fetchHistoricalPrices(days) {
  var ticker = CONFIG.TICKER;
  var now = Math.floor(Date.now() / 1000);
  var period1 = now - days * 24 * 60 * 60;

  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
            encodeURIComponent(ticker) +
            '?period1=' + period1 +
            '&period2=' + now +
            '&interval=1d';

  var options = {
    muteHttpExceptions: true,
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 200) {
      throw new Error('HTTP ' + response.getResponseCode());
    }

    var json = JSON.parse(response.getContentText());
    var result = json.chart.result[0];
    var timestamps = result.timestamp;
    var closes = result.indicators.quote[0].close;

    var prices = [];
    for (var i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        var date = new Date(timestamps[i] * 1000);
        var dateStr = Utilities.formatDate(date, 'America/New_York', 'yyyy-MM-dd');
        prices.push({
          date: dateStr,
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
  if (lastRow <= 1) return [];  // ヘッダーのみ

  var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var prices = [];

  for (var i = 0; i < data.length; i++) {
    if (data[i][0] && data[i][1]) {
      var dateVal = data[i][0];
      var dateStr;
      if (dateVal instanceof Date) {
        dateStr = Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy-MM-dd');
      } else {
        dateStr = String(dateVal);
      }
      prices.push({
        date: dateStr,
        close: Number(data[i][1])
      });
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

  // 重複チェック: 最終行の日付と比較
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var lastDate = sheet.getRange(lastRow, 1).getValue();
    var lastDateStr;
    if (lastDate instanceof Date) {
      lastDateStr = Utilities.formatDate(lastDate, 'Asia/Tokyo', 'yyyy-MM-dd');
    } else {
      lastDateStr = String(lastDate);
    }
    if (lastDateStr === priceData.date) {
      Logger.log('重複スキップ: ' + priceData.date);
      return;
    }
  }

  sheet.appendRow([priceData.date, priceData.close]);
  Logger.log('価格追記: ' + priceData.date + ' = ' + priceData.close);

  // 古いデータを削除（600行を超えたら先頭を削除）
  var maxRows = 600;
  var totalRows = sheet.getLastRow();
  if (totalRows > maxRows + 1) {
    var deleteCount = totalRows - maxRows - 1;
    sheet.deleteRows(2, deleteCount);
    Logger.log('古いデータ ' + deleteCount + '行を削除');
  }
}
