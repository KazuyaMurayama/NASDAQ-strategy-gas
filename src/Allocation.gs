/**
 * Allocation.gs - 3資産目標配分計算
 *
 * Dyn 2x3x戦略: TQQQ (NASDAQ 3x) + 2036 (Gold 2x) + TMF (Bond 3x)
 *
 * w_nasdaq = clip(0.55 + 0.25 × rawLeverage - 0.10 × max(vix_z, 0), 0.30, 0.90)
 * w_gold   = (1 - w_nasdaq) × 0.50
 * w_bond   = (1 - w_nasdaq) × 0.50
 *
 * リバランス実行条件: 最大ドリフト > 20% または DD状態変化
 */

/**
 * 3資産の目標配分を計算
 * @param {number} rawLeverage - クリップ済みrawLeverage [0, 1]
 * @param {number} vixZ - VIX Z-score
 * @return {Object} {w_nasdaq, w_gold, w_bond}
 */
function calcAllocation(rawLeverage, vixZ) {
  var cfg = CONFIG.ALLOCATION;

  var wNasdaq = cfg.W_NASDAQ_BASE
              + cfg.W_NASDAQ_LEVERAGE_COEFF * rawLeverage
              - cfg.W_NASDAQ_VIX_COEFF * Math.max(vixZ, 0);

  wNasdaq = clip_(wNasdaq, cfg.W_NASDAQ_MIN, cfg.W_NASDAQ_MAX);

  var remaining = 1 - wNasdaq;
  var wGold = remaining * 0.50;
  var wBond = remaining * 0.50;

  return {
    w_nasdaq: Math.round(wNasdaq * 1000) / 1000,
    w_gold:   Math.round(wGold * 1000) / 1000,
    w_bond:   Math.round(wBond * 1000) / 1000
  };
}


/**
 * 現在ウェイトと目標ウェイトの最大乖離（絶対値）を計算
 * @param {Object|null} currentWeights - {w_nasdaq, w_gold, w_bond}
 * @param {Object} targetWeights - {w_nasdaq, w_gold, w_bond}
 * @return {number} 最大ドリフト (0.0 ~ 1.0)
 */
function calcMaxDrift(currentWeights, targetWeights) {
  // 初回（現在ウェイトが未設定）は必ずリバランス
  if (!currentWeights || currentWeights.w_nasdaq == null) {
    return 1.0;
  }

  var driftNasdaq = Math.abs(targetWeights.w_nasdaq - currentWeights.w_nasdaq);
  var driftGold   = Math.abs(targetWeights.w_gold   - currentWeights.w_gold);
  var driftBond   = Math.abs(targetWeights.w_bond   - currentWeights.w_bond);

  return Math.max(driftNasdaq, driftGold, driftBond);
}
