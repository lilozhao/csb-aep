/**
 * Δ 基线计算与呈现净化（M3）· CSB-AEP v2.4
 * 协议依据：csb-AEP-v1.1.md §7.3（T6 决议：仅 Harness 首版强制）
 *
 *   Δ = 装 harness 得分 − 裸模型基线得分
 *   **无 Δ 不上屏** —— 绝对分不单独呈现，只呈现 Δ 与裸模型基线对照。
 *
 * 呈现净化沿用 GDI 的预签名切片模式：响应体只出 Δ 卡片。
 */
'use strict';

const crypto = require('crypto');

const DEFAULT_SECRET = 'csb-harness-delta-secret';

/**
 * 计算 Δ
 * @param {object} args
 *   - harnessScore: number    装 harness 的得分（0-10）
 *   - baselineScore: number   裸模型基线得分（0-10）
 *   - breakdown?: {A,B}       分群拆解（各群 harness vs baseline）
 * @returns {object} Δ 卡片
 */
function computeDelta({ harnessScore, baselineScore, breakdown = null, secret } = {}) {
  if (typeof harnessScore !== 'number' || typeof baselineScore !== 'number') {
    return { available: false, status: 'pending_baseline', note: '缺裸模型基线 → 不出 Δ 卡片（协议 §7.3 无 Δ 不上屏）' };
  }
  const delta = +(harnessScore - baselineScore).toFixed(2);
  const card = {
    available: true,
    delta,
    harness: +harnessScore.toFixed(2),
    baseline: +baselineScore.toFixed(2),
    verdict: delta > 0 ? 'harness 有增量价值' : delta === 0 ? '无增量' : 'harness 拖累',
    note: 'Δ = 装 harness − 裸模型（协议 §7.3）',
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
    return {
      domain: 'harness',
      status: 'pending_baseline',
      note: '未建立裸模型基线 → 本域结果不出 Δ 卡片（协议 §7.3）',
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

module.exports = { computeDelta, purify, baselineKey, sign };
