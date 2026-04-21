/**
 * Allocation.gs - 3資産目標配分計算
 *
 * Dyn 2x3x戦略: TQQQ (NASDAQ 3x) + 2036 (Gold 2x) + TMF (Bond 3x)
 *
 * w_nasdaq = clip(0.55 + 0.25 × rawLeverage - 0.10 × max(vix_z, 0), 0.30, 0.90)
 * w_gold   = (1 - w_nasdaq) × 0.50
 * w_bond   = (1 - w_nasdaq) × 0.50
 *
 * リバランス実行条件: 最大ドリフト > 15% または DD状態変化  ※2026-04-21: 20%→15%に変更
 *
 * 実保有計算 (Approach A / スリーブ独立方式):
 *   actual_tqqq = w_nasdaq × rawLeverage      (NASDAQスリーブ内のTQQQ)
 *   actual_gold = w_gold                       (Gold スリーブ: lev非依存・常時保有)
 *   actual_bond = w_bond                       (Bond スリーブ: lev非依存・常時保有)
 *   actual_cash = w_nasdaq × (1 - rawLeverage) (NASDAQスリーブ内バッファのみ)
 *   合計 = w_nasdaq + w_gold + w_bond = 1.0
 */

/**
 * 3資産の目標配分を計算
 * 合計が必ず1.000になるよう、w_goldとw_bondをw_nasadqから逆算して確定する。
 * @param {number} rawLeverage - クリップ済みrawLeverage [0, 1]
 * @param {number} vixZ - VIX Z-score
 * @return {Object} {w_nasdaq, w_gold, w_bond}  合計 = 1.000
 */
function calcAllocation(rawLeverage, vixZ) {
  var cfg = CONFIG.ALLOCATION;

  var wNasdaq = cfg.W_NASDAQ_BASE
              + cfg.W_NASDAQ_LEVERAGE_COEFF * rawLeverage
              - cfg.W_NASDAQ_VIX_COEFF * Math.max(vixZ, 0);

  wNasdaq = clip_(wNasdaq, cfg.W_NASDAQ_MIN, cfg.W_NASDAQ_MAX);

  // 小数点3桁に丸め、残余を Gold/Bond に等分
  wNasdaq = Math.round(wNasdaq * 1000) / 1000;
  var remaining = Math.round((1 - wNasdaq) * 1000) / 1000;

  // 奇数残余（例: 0.267）を Gold に +0.001 割り当てて合計1.000を保証
  var halfRaw = remaining / 2;
  var wGold = Math.round(halfRaw * 1000) / 1000;
  var wBond = Math.round((remaining - wGold) * 1000) / 1000;

  return {
    w_nasdaq: wNasdaq,
    w_gold:   wGold,
    w_bond:   wBond
  };
}


/**
 * Approach A: スリーブ独立型の実保有比率を計算
 * Gold/Bond は rawLeverage に依存せず常時保有、NASDAQスリーブのみレバ管理。
 * 合計は w_nasdaq + w_gold + w_bond = 1.000 を保証。
 *
 * @param {number} rawLeverage - クリップ済みrawLeverage [0, 1]
 * @param {Object} targetWeights - {w_nasdaq, w_gold, w_bond}
 * @return {Object} {actual_tqqq, actual_gold, actual_bond, actual_cash}
 */
function calcActualHoldings(rawLeverage, targetWeights) {
  var wN = targetWeights.w_nasdaq;
  var wG = targetWeights.w_gold;
  var wB = targetWeights.w_bond;
  return {
    actual_tqqq: rawLeverage * wN,         // NASDAQスリーブ内TQQQ
    actual_gold: wG,                        // lev非依存
    actual_bond: wB,                        // lev非依存
    actual_cash: (1 - rawLeverage) * wN    // NASDAQスリーブ内バッファのみ
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
