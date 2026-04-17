/**
 * ForwardReturn.gs - 5営業日後フォワードリターン ビン別参照テーブル
 *
 * データソース: REGIME_ANALYSIS_REPORT_2026-04-04.md
 *
 * ビン定義:
 *   NASDAQ枠 (w_nasdaq): 0.30〜0.50(30-50%), 0.50〜0.70(50-70%), 0.70〜0.90(70-90%)
 *   rawLev:              CASH(ddState='CASH'またはrawLev=0), 1-30%, 30-60%, 60-85%, 85-100%
 *
 * Logシート列:
 *   Y: forward_cagr_5d  - 該当ビンのCAGR年率（%、例: 10.7）
 *   Z: forward_median_5d - 該当ビンの中央値（%、例: 0.15）
 */

var FORWARD_RETURN_5D_ = {
  '30-50×CASH':   { cagr: 13.7, median: 0.13 },
  '30-50×1-30':   { cagr: 19.5, median: 0.37 },
  '30-50×30-60':  { cagr: 41.1, median: 0.65 },
  '50-70×CASH':   { cagr: 10.4, median: 0.08 },
  '50-70×1-30':   { cagr: 10.7, median: 0.15 },
  '50-70×30-60':  { cagr: 16.5, median: 0.34 },
  '50-70×60-85':  { cagr: 28.6, median: 0.49 },
  '50-70×85-100': { cagr: 84.4, median: 1.26 },
  '70-90×60-85':  { cagr: 35.0, median: 0.71 },
  '70-90×85-100': { cagr: 55.2, median: 1.19 }
};


/**
 * 現在のシグナルから5営業日後フォワードリターンを返す
 *
 * @param {number|null} wNasdaq  - NASDAQ枠ウェイト (0.30〜0.90)
 * @param {string}      ddState  - 'HOLD' or 'CASH'
 * @param {number}      rawLev   - rawLeverage (0.0〜1.0)
 * @return {{cagr: number, median: number, binLabel: string}|null}
 *         テーブルに該当ビンがない場合は null
 */
function lookupForwardReturn_(wNasdaq, ddState, rawLev) {
  if (wNasdaq == null || rawLev == null) return null;

  // NASDAQ枠ビン
  var nqBin;
  if      (wNasdaq >= 0.30 && wNasdaq < 0.50)  nqBin = '30-50';
  else if (wNasdaq >= 0.50 && wNasdaq < 0.70)  nqBin = '50-70';
  else if (wNasdaq >= 0.70 && wNasdaq <= 0.90) nqBin = '70-90';
  else return null;

  // rawLevビン
  var levBin;
  if      (ddState === 'CASH' || rawLev === 0)  levBin = 'CASH';
  else if (rawLev > 0    && rawLev <= 0.30)     levBin = '1-30';
  else if (rawLev > 0.30 && rawLev <= 0.60)     levBin = '30-60';
  else if (rawLev > 0.60 && rawLev <= 0.85)     levBin = '60-85';
  else if (rawLev > 0.85)                       levBin = '85-100';
  else return null;

  var key = nqBin + '×' + levBin;
  var row = FORWARD_RETURN_5D_[key];
  if (!row) return null;

  return {
    cagr:     row.cagr,
    median:   row.median,
    binLabel: 'NQ' + nqBin + '%×rawLev' + levBin + '%'
  };
}
