/**
 * GDI 维度 4：善意自评（仅参考）· CSB-AEP v2.3（M2）
 *
 * 依据：csb-aep/docs/relationship-gdi-draft.md §2.3（定稿 v1.0）
 * - 自评不可直接优化、不作为晋升依据、仅用于校准其他维度
 * - 自评分与可核实维度差异过大 → 触发「校准提醒」而非惩罚
 * - 自评原文 = L3 敏感（默认不落盘明文；本模块只接收分数与摘要）
 * - 权重合计 ≤20% 红线：本维度 10%（config 焊死）
 */

// 校准提醒阈值：自评（0-1 归一）与可核实加权分（0-1）的绝对差
const CALIBRATION_DELTA = 0.3;

/**
 * 归一自评分（0-10 → 0-1）
 */
function normalize(score10) {
  if (score10 === null || score10 === undefined) return null;
  return Math.max(0, Math.min(10, Number(score10))) / 10;
}

/**
 * 可核实维度加权分（不含自评）：权重来自 config（40/30/20 → 归一化）
 * @param {object} dims { contract: {rate|null}, verify: {rate|null}, reuse: {rate|null} }
 * @param {object} weights { contract, verify, reuse }（原始权重，将按可用维归一化）
 * @returns {object} { score: number|null, covered: string[] }
 */
function verifiableScore(dims, weights) {
  const parts = [];
  for (const key of ['contract', 'verify', 'reuse']) {
    const rate = dims[key]?.rate;
    if (rate !== null && rate !== undefined) parts.push({ key, w: weights[key], rate });
  }
  if (parts.length === 0) return { score: null, covered: [] };
  const wSum = parts.reduce((s, p) => s + p.w, 0);
  const score = parts.reduce((s, p) => s + (p.w / wSum) * p.rate, 0);
  return { score, covered: parts.map(p => p.key) };
}

/**
 * 自评校准：比较自评与可核实分，差异过大出提醒（非惩罚）
 * @param {number|null} selfScore10 自评 0-10
 * @param {object} verifiable verifiableScore() 结果
 * @returns {object} { delta, alert, message? }
 */
function calibrate(selfScore10, verifiable) {
  const self = normalize(selfScore10);
  if (self === null || verifiable.score === null) {
    return { delta: null, alert: false, message: null };
  }
  const delta = Math.abs(self - verifiable.score);
  if (delta >= CALIBRATION_DELTA) {
    return {
      delta: +delta.toFixed(3),
      alert: true,
      message: `自评（${(self * 10).toFixed(1)}/10）与可核实观测（${(verifiable.score * 10).toFixed(1)}/10）差异 ${delta.toFixed(2)} ≥ ${CALIBRATION_DELTA}，触发校准提醒（非惩罚）：建议回看近期交互日志`,
    };
  }
  return { delta: +delta.toFixed(3), alert: false, message: null };
}

module.exports = { normalize, verifiableScore, calibrate, CALIBRATION_DELTA };
