/**
 * HealthCheckAgent.gs - データ整合性・State監視エージェント
 *
 * 目的: dailyUpdate() の前に自律的にヘルスチェックを実行し、
 *       問題を早期発見・自動修復・通知する。
 *
 * 主な確認項目:
 *   1. 価格データの鮮度（最終日付 vs 本日）
 *   2. 価格の妥当性（NASDAQ 1,000〜25,000 の範囲か）
 *   3. State の整合性（ウェイト合計、分散値の有効性）
 *   4. スプレッドシートのシート存在確認
 *   5. データ件数が必要最小値を満たすか
 *
 * 使い方:
 *   - dailyUpdate() 冒頭で runHealthCheck() を呼ぶ（自動）
 *   - 手動で runHealthCheck() を単独実行してもよい
 */

// ===== 設定 =====
var HC_CONFIG = {
  NASDAQ_MIN:    1000,
  NASDAQ_MAX:    30000,
  MAX_STALE_DAYS: 5     // 5営業日以上古ければ警告
};


/**
 * ヘルスチェックを実行し、結果オブジェクトを返す。
 * 致命的問題がある場合は true を返し、dailyUpdate() を中断できる。
 *
 * @return {Object} { ok: boolean, warnings: string[], errors: string[] }
 */
function runHealthCheck() {
  var ss = getSpreadsheet_();
  var result = { ok: true, warnings: [], errors: [] };

  checkSheets_(ss, result);
  if (result.errors.length > 0) {
    result.ok = false;
    notifyHealthStatus_(result);
    return result;
  }

  checkPriceData_(ss, result);
  checkStateIntegrity_(ss, result);

  if (result.errors.length > 0) result.ok = false;

  // 警告のみなら通知は送るが処理は続行
  if (!result.ok || result.warnings.length > 0) {
    notifyHealthStatus_(result);
  }

  Logger.log('[HealthCheck] ok=' + result.ok +
             ', errors=' + result.errors.length +
             ', warnings=' + result.warnings.length);
  return result;
}


// ===== 内部チェック関数 =====

function checkSheets_(ss, result) {
  var required = [CONFIG.SHEET_PRICE, CONFIG.SHEET_STATE, CONFIG.SHEET_LOG];
  required.forEach(function(name) {
    if (!ss.getSheetByName(name)) {
      result.errors.push('シート不在: ' + name);
    }
  });
}


function checkPriceData_(ss, result) {
  var prices = loadPriceHistory_(ss);

  if (prices.length === 0) {
    result.errors.push('PriceHistory が空');
    return;
  }

  // 最新価格の妥当性チェック
  var latest = prices[prices.length - 1];
  if (latest.close < HC_CONFIG.NASDAQ_MIN || latest.close > HC_CONFIG.NASDAQ_MAX) {
    result.errors.push('価格異常: ' + latest.close +
                       ' (期待範囲: ' + HC_CONFIG.NASDAQ_MIN + '〜' + HC_CONFIG.NASDAQ_MAX + ')');
  }

  // データ鮮度チェック
  var needed = calcMinDataNeeded_();
  if (prices.length < needed) {
    result.errors.push('データ不足: ' + prices.length + '/' + needed + '日');
  }

  // 最終日付の鮮度チェック
  var lastDateStr = latest.date;
  var lastDate = new Date(lastDateStr + 'T00:00:00');
  var now = new Date();
  var diffDays = Math.floor((now - lastDate) / 86400000);
  if (diffDays > HC_CONFIG.MAX_STALE_DAYS) {
    result.warnings.push('データが古い: 最終日=' + lastDateStr + ' (' + diffDays + '日前)');
  }

  // NaN/ゼロ値の有無
  var badCount = 0;
  for (var i = Math.max(0, prices.length - 10); i < prices.length; i++) {
    if (!prices[i].close || isNaN(prices[i].close)) badCount++;
  }
  if (badCount > 0) {
    result.warnings.push('直近10行中 ' + badCount + '件の無効価格');
  }
}


function checkStateIntegrity_(ss, result) {
  var state = loadState_(ss);

  // AsymEWMA variance
  if (state.asym_variance == null) {
    result.warnings.push('asym_variance 未設定 (再初期化が必要かもしれません)');
  }

  // current_leverage 範囲
  if (state.current_leverage < 0 || state.current_leverage > 1) {
    result.errors.push('current_leverage 範囲外: ' + state.current_leverage);
  }

  // ウェイトが設定されている場合の合計チェック
  var cw = state.current_weights;
  if (cw.w_nasdaq != null) {
    var sum = (cw.w_nasdaq || 0) + (cw.w_gold || 0) + (cw.w_bond || 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      result.errors.push('ウェイト合計異常: ' + sum.toFixed(4) + ' (1.000期待)');
    }
  }
}


// ===== 通知 =====

function notifyHealthStatus_(result) {
  var level = result.errors.length > 0 ? '[HealthCheck ERROR]' : '[HealthCheck WARNING]';
  var lines = [level, ''];

  if (result.errors.length > 0) {
    lines.push('ERROR:');
    result.errors.forEach(function(e) { lines.push('  - ' + e); });
  }
  if (result.warnings.length > 0) {
    lines.push('WARNING:');
    result.warnings.forEach(function(w) { lines.push('  - ' + w); });
  }

  var message = lines.join('\n');
  Logger.log(message);

  if (CONFIG.NOTIFY_ON_ERROR) {
    if (CONFIG.LINE.CHANNEL_ACCESS_TOKEN && CONFIG.LINE.USER_ID) {
      sendLineMessage_(message);
    }
    if (CONFIG.EMAIL) {
      try {
        MailApp.sendEmail({
          to: CONFIG.EMAIL,
          subject: level + ' Dyn 2x3x',
          body: message
        });
      } catch (e) {
        Logger.log('HealthCheck通知メール失敗: ' + e.message);
      }
    }
  }
}


/**
 * 手動ヘルスチェック（メニューから実行用）
 */
function runHealthCheckManual() {
  var result = runHealthCheck();
  if (result.ok && result.warnings.length === 0) {
    Logger.log('[HealthCheck] 全項目正常');
    SpreadsheetApp.getUi().alert('ヘルスチェック: 正常\n' +
                                 'データ件数: 問題なし\n' +
                                 'State: 整合性OK');
  }
}
