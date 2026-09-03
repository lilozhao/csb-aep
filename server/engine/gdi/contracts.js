/**
 * GDI 维度 1：契约命中率（Contract Hit Rate）· CSB-AEP v2.3
 *
 * 依据：csb-aep/docs/relationship-gdi-draft.md §2.2 维度1（定稿 v1.0，三轮评审 7/7 签字）
 * 来源：gdi-mvp/lib/contracts.js（2026-09-03 收编，只改注释不改逻辑）
 * 口径：
 *   - 双层契约制：formal 权重 1.0 / light 权重 0.5
 *   - 轻量契约连续履约 3 次 → 自动升格为正式契约（全额 1.0）
 *   - 履约质量计分（不只计次数）：beyond 1.0 / complete 1.0 / onTime 0.85 / lateDone 0.6 / broken 0
 *     （完整履约即满分；区分度在准时性折扣；beyond 以标签记录不拉分——防表演性超额竞赛）
 *   - 轻量契约硬约束：承诺后 48h 内无行为印证 → 自动作废（void，不计入分母，非违约）
 *   - 失信熔断：broken 记录触发熔断标记（交互层标注，不参与公式）
 *   - 未到期（pending）不计入分母
 */

const CONTRACT_TYPE = { FORMAL: 'formal', LIGHT: 'light' };
const STATUS = { KEPT: 'kept', BROKEN: 'broken', PENDING: 'pending', VOID: 'void' };
const QUALITY = { BEYOND: 'beyond', COMPLETE: 'complete', ONTIME: 'onTime', LATE_DONE: 'lateDone' };

// 类型权重
const TYPE_WEIGHT = { formal: 1.0, light: 0.5 };
// 质量得分（v0.1 口径：完整履约即满分；区分度在准时性折扣；beyond 以标签记录不额外拉分——防表演性超额竞赛）
const QUALITY_SCORE = { beyond: 1.0, complete: 1.0, onTime: 0.85, lateDone: 0.6, broken: 0 };
// 轻量契约升格阈值（连续履约次数）
const PROMOTION_THRESHOLD = 3;
// 轻量契约行为印证窗口（小时）
const LIGHT_EVIDENCE_WINDOW_H = 48;

function stripEmoji(name) {
  return (name || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').trim();
}

/**
 * 升格处理：对同一契约对 (promisor, promisee) 的轻量契约，按时间排序，
 * 连续履约达到阈值后，从第 N 个起升格为 formal（权重按 1.0 计）。
 * 中断（broken）则重新计数。
 */
function applyPromotion(contracts) {
  const byPair = new Map();
  for (const c of contracts) {
    const key = `${c.promisor}→${c.promisee}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(c);
  }
  const out = [];
  for (const [key, list] of byPair) {
    list.sort((a, b) => new Date(a.promisedAt) - new Date(b.promisedAt));
    let streak = 0;
    for (const c of list) {
      if (c.type === CONTRACT_TYPE.LIGHT && c.status === STATUS.KEPT) {
        streak += 1;
        if (streak >= PROMOTION_THRESHOLD) {
          c.type = CONTRACT_TYPE.FORMAL; // 升格
          c.promoted = true;
        }
      } else if (c.type === CONTRACT_TYPE.LIGHT && c.status === STATUS.BROKEN) {
        streak = 0;
      }
      out.push(c);
    }
  }
  return out;
}

/**
 * 轻量契约 48h 印证窗口校验：
 * 承诺后 48h 内无 evidence 时间戳 → 自动作废（void），不计入分母。
 * 返回 { contracts, voidedCount }
 */
function applyVoidWindow(contracts, now = new Date()) {
  let voided = 0;
  for (const c of contracts) {
    if (c.type !== CONTRACT_TYPE.LIGHT || c.status !== STATUS.PENDING) continue;
    const promised = new Date(c.promisedAt).getTime();
    const evTs = c.evidenceTs ? new Date(c.evidenceTs).getTime() : null;
    if (!evTs || now.getTime() - promised > LIGHT_EVIDENCE_WINDOW_H * 3600 * 1000) {
      c.status = STATUS.VOID;
      c.voidReason = '48h 无行为印证，自动作废';
      voided += 1;
    }
  }
  return { contracts, voidedCount: voided };
}

/**
 * 单 agent 契约命中率
 * @param {Array} rawContracts 契约记录（含 status/quality/type/promisedAt/deadline/evidenceTs）
 * @param {Date} [now] 观测时间
 * @returns {object} { rate, numerator, denominator, detail, qualityBreakdown, broken }
 */
function hitRate(rawContracts, now = new Date()) {
  // 48h 窗口校验（仅对仍 pending 的轻量契约）
  const { contracts } = applyVoidWindow(rawContracts.map(c => ({ ...c })), now);
  const promoted = applyPromotion(contracts);

  // 到期契约计入分母；pending 未到期不计
  const due = promoted.filter(c => {
    if (c.status === STATUS.PENDING) return new Date(c.deadline || c.promisedAt) <= now;
    return true;
  });

  let numerator = 0;
  let denominator = 0;
  const breakdown = [];

  for (const c of due) {
    const w = (c.promoted ? 1.0 : TYPE_WEIGHT[c.type]) || TYPE_WEIGHT[c.type];
    let score = 0;
    if (c.status === STATUS.KEPT) {
      score = QUALITY_SCORE[c.quality] ?? QUALITY_SCORE.complete;
    } else if (c.status === STATUS.BROKEN) {
      score = 0;
    } else if (c.status === STATUS.VOID) {
      continue; // 作废不计入分母
    }
    numerator += w * score;
    denominator += w;
    breakdown.push({
      id: c.id, type: c.promoted ? 'formal(↑升格)' : c.type, status: c.status,
      quality: c.quality, weight: w, score, evidence: c.evidence || null,
    });
  }

  const kept = due.filter(c => c.status === STATUS.KEPT).length;
  const broken = due.filter(c => c.status === STATUS.BROKEN);
  const qualityBreakdown = {};
  for (const c of due.filter(x => x.status === STATUS.KEPT)) {
    qualityBreakdown[c.quality] = (qualityBreakdown[c.quality] || 0) + 1;
  }

  return {
    rate: denominator > 0 ? numerator / denominator : null, // 全精度，展示层自行格式化
    numerator,
    denominator,
    keptCount: kept,
    brokenCount: broken.length,
    brokenList: broken.map(b => ({ id: b.id, evidence: b.evidence })),
    qualityBreakdown,
    breakdown,
    fused: broken.length > 0, // 失信熔断标记
  };
}

module.exports = {
  CONTRACT_TYPE, STATUS, QUALITY, TYPE_WEIGHT, QUALITY_SCORE,
  PROMOTION_THRESHOLD, LIGHT_EVIDENCE_WINDOW_H,
  hitRate, applyPromotion, applyVoidWindow, stripEmoji,
};
