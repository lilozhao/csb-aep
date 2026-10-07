/**
 * 子群 B：成本与性能（M2 全量：B1-B5）· CSB-AEP v2.4
 * 协议依据：csb-AEP-v1.1.md §7.2 子群 B
 *
 * 采集口径：全部依赖 Trace 的 tokens / latency_ms / steps。字段缺失 → 对应指标 N/A。
 * 判定阈值（协议 §7.2 + 实现清单 §3.2）：
 *   B1 延迟      P95 ≤5s→10 / ≤15s→7 / ≤30s→5 / >30s→2
 *   B2 令牌效率  前25%→10 / 中位→7 / 后25%→3（同任务集横向归一化）
 *   B3 步骤经济  步数 ≤ 最优×1.2→10 / ×1.5→7 / ×2.0→3
 *   B4 每任务成本 前25%→10 / 中位→7 / 后25%→3（标准化成本基准）
 *   B5 并发弹性  20 并发成功率降幅 <10%→10 / <30%→7 / >50%→2
 */
'use strict';

const { parseTraces, percentile } = require('./trace.js');

/** 从 traces 计算每任务的 tokens / steps 均值 */
function taskStats(traces) {
  const parsed = parseTraces(traces || []);
  const rows = [];
  for (const p of parsed.items) {
    if (!p.totals) continue;
    rows.push({ tokens: p.totals.total_tokens, steps: p.totals.stepCount, ms: p.totals.total_ms });
  }
  return rows;
}

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

/** 分位档位（前25% / 中位 / 后25%）：值越小越好 */
function quartileTier(value, allValues) {
  if (value === null || !allValues.length) return null;
  const sorted = [...allValues].sort((a, b) => a - b);
  const q25 = percentile(sorted, 25);
  const q75 = percentile(sorted, 75);
  if (value <= q25) return 'top';      // 前 25%（越省越好）
  if (value >= q75) return 'bottom';   // 后 25%
  return 'median';
}
function tierScore(tier) { return tier === 'top' ? 10 : tier === 'median' ? 7 : tier === 'bottom' ? 3 : null; }

/**
 * B1 · 延迟（TTFT / P95）
 */
function b1(cfg, traceData = {}) {
  const parsed = parseTraces(traceData.traces || []);
  const latencies = [];
  for (const p of parsed.items) {
    if (p.totals && Array.isArray(p.totals.latencies)) latencies.push(...p.totals.latencies);
  }
  if (!latencies.length) return { id: 'B1', score: null, status: 'N/A', note: '全部 Trace 缺 latency_ms → N/A' };
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50), p95 = percentile(sorted, 95);
  const ttft = (traceData.ttftMs || []).slice().sort((a, b) => a - b);
  const ttftP50 = ttft.length ? percentile(ttft, 50) : null;

  let score;
  if (p95 <= 5000) score = 10; else if (p95 <= 15000) score = 7; else if (p95 <= 30000) score = 5; else score = 2;
  return { id: 'B1', score, status: 'ok', p50_ms: p50, p95_ms: p95, sampleCount: sorted.length,
    ttft_p50_ms: ttftP50, ttftNote: ttft.length ? null : '需 harness 单独暴露 TTFT，未提供' };
}

/**
 * B2 · 令牌效率（token / 任务，同任务集横向归一化）
 * @param {object} traceData { traces, peerValues?: number[] }  peerValues = 同任务集其他 harness 的 token 均值（用于归一化）
 */
function b2(cfg, traceData = {}) {
  const rows = taskStats(traceData.traces);
  if (!rows.length || rows.some(r => !r.tokens)) return { id: 'B2', score: null, status: 'N/A', note: 'Trace 缺 total_tokens → N/A' };
  const myTokens = mean(rows.map(r => r.tokens));
  const peers = Array.isArray(traceData.peerValues) && traceData.peerValues.length ? traceData.peerValues : [myTokens];
  const tier = quartileTier(myTokens, peers);
  return { id: 'B2', score: tierScore(tier), status: 'ok', avgTokensPerTask: +myTokens.toFixed(1), tier,
    peerCount: peers.length, peerMedian: percentile([...peers].sort((a, b) => a - b), 50) };
}

/**
 * B3 · 步骤经济性（步数 / 任务 vs 最优基准）
 * @param {object} traceData { traces, bestSteps?: number }  bestSteps = 最优基准步骤数（同任务集）；缺省取本批最小值
 */
function b3(cfg, traceData = {}) {
  const rows = taskStats(traceData.traces);
  if (!rows.length) return { id: 'B3', score: null, status: 'N/A', note: '无 Trace → N/A' };
  const mySteps = mean(rows.map(r => r.steps));
  const stepsList = rows.map(r => r.steps);
  const best = typeof traceData.bestSteps === 'number' ? traceData.bestSteps : Math.min(...stepsList);
  if (!best) return { id: 'B3', score: null, status: 'N/A', note: '最优基准为 0，不可比 → N/A' };
  const ratio = mySteps / best;

  let score;
  if (ratio <= 1.2) score = 10; else if (ratio <= 1.5) score = 7; else if (ratio <= 2.0) score = 5; else score = 3;
  return { id: 'B3', score, status: 'ok', avgStepsPerTask: +mySteps.toFixed(2), bestSteps: best, ratio: +ratio.toFixed(3) };
}

/**
 * B4 · 每任务成本（token × 单价 + 工具调用成本）
 * @param {object} traceData { traces, unitPrice?: number(元/1k token), toolCost?: number(元/次工具调用), peerCosts?: number[] }
 */
function b4(cfg, traceData = {}) {
  const rows = taskStats(traceData.traces);
  if (!rows.length || rows.some(r => !r.tokens)) return { id: 'B4', score: null, status: 'N/A', note: 'Trace 缺 tokens → 无法算成本 → N/A' };
  const unitPrice = typeof traceData.unitPrice === 'number' ? traceData.unitPrice : 0; // 元/1k token
  const toolCost = typeof traceData.toolCost === 'number' ? traceData.toolCost : 0;    // 元/次
  const costs = rows.map(r => (r.tokens / 1000) * unitPrice + r.steps * toolCost);
  const myCost = mean(costs);
  const peers = Array.isArray(traceData.peerCosts) && traceData.peerCosts.length ? traceData.peerCosts : [myCost];
  const tier = quartileTier(myCost, peers);
  return { id: 'B4', score: tierScore(tier), status: 'ok', avgCostPerTask: +myCost.toFixed(4), tier,
    unitPrice, toolCost, note: unitPrice === 0 && toolCost === 0 ? '未提供单价/工具成本，仅以 token 量近似' : null };
}

/**
 * B5 · 并发与弹性（1/5/20 并发下的成功率与 P95 衰减）
 * @param {object} traceData { loads: [{ concurrency: 1, successRate: 1, p95_ms: 1000 }, ...] }
 */
function b5(cfg, traceData = {}) {
  const loads = (traceData.loads || []).filter(l => typeof l.concurrency === 'number');
  if (!loads.length) return { id: 'B5', score: null, status: 'N/A', note: '无并发负载数据 → N/A' };
  const base = loads.find(l => l.concurrency === 1) || loads[0];
  const peak = loads.slice().sort((a, b) => b.concurrency - a.concurrency)[0];
  if (!base || typeof base.successRate !== 'number' || typeof peak.successRate !== 'number') {
    return { id: 'B5', score: null, status: 'N/A', note: '负载数据缺 successRate → N/A' };
  }
  const drop = (base.successRate - peak.successRate) / (base.successRate || 1); // 相对降幅
  const p95Rise = (typeof base.p95_ms === 'number' && typeof peak.p95_ms === 'number' && base.p95_ms)
    ? (peak.p95_ms - base.p95_ms) / base.p95_ms : null;

  let score;
  if (drop < 0.1) score = 10; else if (drop < 0.3) score = 7; else if (drop <= 0.5) score = 5; else score = 2;
  return { id: 'B5', score, status: 'ok', peakConcurrency: peak.concurrency,
    successDrop: +drop.toFixed(3), p95Rise: p95Rise === null ? null : +p95Rise.toFixed(3), loads };
}

module.exports = { b1, b2, b3, b4, b5 };
