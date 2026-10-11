/**
 * Δ 基线计算与呈现净化（M3）· CSB-AEP v2.4
 * 协议依据：csb-AEP-v1.1.md §7.3（T6 决议：仅 Harness 首版强制）
 *
 *   Δ = 装 harness 得分 − 裸模型基线得分
 *   **无 Δ 不上屏** —— 绝对分不单独呈现，只呈现 Δ 与裸模型基线对照。
 *
 * ── 任务集一致性校验（M3.1 · 2026-10-11）──────────────────────────
 * 协议 §7.3 要求基线为「同一模型、同一任务集、不装 harness」的分数。
 * 若 harness 侧与基线侧的任务集/模型/覆盖集不一致，Δ 失真（分母不对），
 * 此时**宁可不出分，也不出失真的分**。三道前置全过才出 Δ：
 *   1. 模型一致：harness.model == baseline.model
 *   2. 任务集一致：harness 任务集指纹 == 基线任务集指纹
 *   3. 覆盖一致：harness 评分项数 == 基线评分项数（部分完成 vs 完整 → 拒）
 * 任一不满足 → available:false / status:'delta_invalid'（显式理由，不静默）。
 *
 * 呈现净化沿用 GDI 的预签名切片模式：响应体只出 Δ 卡片。
 */
'use strict';

const crypto = require('crypto');

const DEFAULT_SECRET = 'csb-harness-delta-secret';

/**
 * 任务集一致性校验（纯函数，可单测）。
 * @param {object} args
 *   - baselineMeta: { model?, taskSetHash?, scoredCount? }
 *   - harnessMeta:  { model?, taskSetHash?, scoredCount? }
 * @returns {{ ok:boolean, reason?:string, code?:string }}
 */
function checkBaselineComparability({ baselineMeta, harnessMeta } = {}) {
  const b = baselineMeta || {};
  const h = harnessMeta || {};

  // 前置 1：模型一致（两侧都给了才校验；缺模型标识为不可比）
  if (!b.model || !h.model) {
    return { ok: false, code: 'missing_model', reason: '缺模型标识：Δ 需同一模型的 harness 侧与基线侧（协议 §7.3）' };
  }
  if (b.model !== h.model) {
    return { ok: false, code: 'model_mismatch', reason: `模型不一致：harness=${h.model} vs baseline=${b.model}（Δ 要求同一模型）` };
  }

  // 前置 2：任务集指纹一致
  if (!b.taskSetHash || !h.taskSetHash) {
    return { ok: false, code: 'missing_taskset', reason: '缺任务集指纹：无法证明两侧跑的是同一任务集（Δ 可能失真）' };
  }
  if (b.taskSetHash !== h.taskSetHash) {
    return { ok: false, code: 'taskset_mismatch', reason: `任务集不一致：harness=${h.taskSetHash} vs baseline=${b.taskSetHash}（Δ 失真，拒绝出分）` };
  }

  // 前置 3：覆盖一致（部分完成 vs 完整 → 分母不同 → 拒）
  const bc = Number(b.scoredCount);
  const hc = Number(h.scoredCount);
  if (!Number.isFinite(bc) || !Number.isFinite(hc)) {
    return { ok: false, code: 'missing_coverage', reason: '缺评分项数：无法确认两侧覆盖一致（部分完成 vs 完整 → Δ 失真）' };
  }
  if (bc !== hc) {
    return { ok: false, code: 'coverage_mismatch', reason: `覆盖不一致：harness ${hc} 项 vs baseline ${bc} 项（分母不同 → Δ 失真，拒绝出分）` };
  }

  return { ok: true };
}

/**
 * 计算 Δ
 * @param {object} args
 *   - harnessScore: number    装 harness 的得分（0-10）
 *   - baselineScore: number   裸模型基线得分（0-10）
 *   - breakdown?: {A,B}       分群拆解（各群 harness vs baseline）
 *   - baselineMeta?: {model, taskSetHash, scoredCount}  基线侧元数据
 *   - harnessMeta?:  {model, taskSetHash, scoredCount}  harness 侧元数据
 * @returns {object} Δ 卡片
 */
function computeDelta({ harnessScore, baselineScore, breakdown = null, baselineMeta = null, harnessMeta = null, secret } = {}) {
  if (typeof harnessScore !== 'number' || typeof baselineScore !== 'number') {
    return { available: false, status: 'pending_baseline', note: '缺裸模型基线 → 不出 Δ 卡片（协议 §7.3 无 Δ 不上屏）' };
  }

  // 任务集一致性校验（M3.1）：不通过 → 拒出 Δ（宁可不出分，不出失真的分）
  const cmp = checkBaselineComparability({ baselineMeta, harnessMeta });
  if (!cmp.ok) {
    return {
      available: false,
      status: 'delta_invalid',
      code: cmp.code,
      reason: cmp.reason,
      note: 'Δ 前置校验未通过 → 拒绝出分（协议 §7.3 · 宁可不出分不出失真分）',
    };
  }

  const delta = +(harnessScore - baselineScore).toFixed(2);
  const card = {
    available: true,
    delta,
    harness: +harnessScore.toFixed(2),
    baseline: +baselineScore.toFixed(2),
    taskSetHash: harnessMeta.taskSetHash,
    model: harnessMeta.model,
    verdict: delta > 0 ? 'harness 有增量价值' : delta === 0 ? '无增量' : 'harness 拖累',
    note: 'Δ = 装 harness − 裸模型（协议 §7.3 · 任务集/模型/覆盖三方一致）',
  };
  if (breakdown) {
    card.breakdown = {};
    for (const [k, v] of Object.entries(breakdown)) {
      if (v && typeof v.harness === 'number' && typeof v.baseline === 'number') {
        card.breakdown[k] = { delta: +(v.harness - v.baseline).toFixed(2), harness: v.harness, baseline: v.baseline };
      }
    }
  }
  card.sig = sign(secret || process.env.AEP_HARNESS_DELTA_SECRET || DEFAULT_SECRET, card);
  return card;
}

function sign(secret, obj) {
  const payload = JSON.stringify({ delta: obj.delta, harness: obj.harness, baseline: obj.baseline });
  return crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16);
}

/**
 * 呈现净化：响应体只留 Δ 卡片，剥离绝对分（无 Δ 不上屏）。
 * @param {object} evalResult HarnessEvaluator.evaluate 的输出
 * @param {object} deltaCard  computeDelta 的输出
 */
function purify(evalResult, deltaCard) {
  if (!deltaCard || !deltaCard.available) {
    const invalid = deltaCard && deltaCard.status === 'delta_invalid';
    return {
      domain: 'harness',
      status: invalid ? 'delta_invalid' : 'pending_baseline',
      note: invalid
        ? (deltaCard.reason || 'Δ 任务集一致性校验未通过 → 拒绝出分（协议 §7.3）')
        : '未建立裸模型基线 → 本域结果不出 Δ 卡片（协议 §7.3）',
      code: invalid ? deltaCard.code : undefined,
      delta: null,
    };
  }
  return {
    domain: 'harness',
    harness: evalResult.harness,
    evaluatedAt: evalResult.evaluatedAt,
    delta: deltaCard,       // 只出 Δ，不出绝对分
    naMetrics: evalResult.partial ? evalResult.partial.naMetrics : [],
    sig: deltaCard.sig,
  };
}

/** 基线缓存键：模型 + 任务集版本（避免重复跑） */
function baselineKey(model, taskSetVersion) { return `${model}::${taskSetVersion}`; }

module.exports = { computeDelta, purify, baselineKey, sign, checkBaselineComparability };
