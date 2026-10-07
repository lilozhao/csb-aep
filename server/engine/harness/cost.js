/**
 * 子群 B：成本与性能（M1 试点：B1 延迟）
 * 协议依据：csb-AEP-v1.1.md §7.2 子群 B
 *
 * M1 只落 B1；B2-B5 留待 M2。
 */
'use strict';

const { parseTraces, percentile } = require('./trace.js');

/**
 * B1 · 延迟（TTFT / P95）
 * 采集：Trace 的 latency_ms（每步耗时）
 * 测试：标准任务集多轮（≥20 次）取 P50/P95；TTFT 需 harness 单独暴露
 * 判定：P95 ≤ 5s → 10；≤15s → 7；≤30s → 5；>30s → 2
 * 缺 latency_ms → N/A
 *
 * @param {object} traceData { traces: [Trace...], ttftMs?: number[] }
 */
function b1(cfg, traceData = {}) {
  const parsed = parseTraces(traceData.traces || []);
  const latencies = [];
  for (const p of parsed.items) {
    if (p.totals && Array.isArray(p.totals.latencies)) latencies.push(...p.totals.latencies);
  }
  if (!latencies.length) {
    return { id: 'B1', score: null, status: 'N/A', note: '全部 Trace 缺 latency_ms → N/A' };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const ttft = (traceData.ttftMs || []).slice().sort((a, b) => a - b);
  const ttftP50 = ttft.length ? percentile(ttft, 50) : null;

  let score;
  if (p95 <= 5000) score = 10;
  else if (p95 <= 15000) score = 7;
  else if (p95 <= 30000) score = 5;
  else score = 2;

  return {
    id: 'B1', score, status: 'ok',
    p50_ms: p50, p95_ms: p95, sampleCount: sorted.length,
    ttft_p50_ms: ttftP50, ttftNote: ttft.length ? null : '需 harness 单独暴露 TTFT，未提供',
  };
}

module.exports = { b1 };
