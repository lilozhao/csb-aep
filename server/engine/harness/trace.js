/**
 * Trace 读取、规范化、统计（M1 · 地基）· CSB-AEP v2.4
 *
 * 协议依据：csb-AEP-v1.1.md §7.2 —— Trace 输出（步数 / 工具调用 / token / 错误）。
 * 格式：csb-trace-v1（协议实现清单 §2.2）
 *   { task_id, model, steps: [{ i, tool, args_hash, tokens, latency_ms, error }], total_tokens, total_ms, finished }
 * 必备字段：steps[].i / tool / tokens · total_tokens · finished
 *   - 缺 latency_ms → B1 判 N/A
 */
'use strict';

/** 解析并规范化一条 trace；返回 { valid, errors[], warnings[], steps[], totals } */
function parseTrace(trace) {
  const errors = [];
  const warnings = [];

  if (!trace || typeof trace !== 'object') {
    return { valid: false, errors: ['trace 不是对象'], warnings, steps: [], totals: null };
  }
  if (!Array.isArray(trace.steps)) {
    errors.push('trace.steps 缺失或不是数组');
    return { valid: false, errors, warnings, steps: [], totals: null };
  }

  const steps = trace.steps.map((s, idx) => ({
    i: typeof s.i === 'number' ? s.i : idx + 1,
    tool: s.tool || null,
    args_hash: s.args_hash || null,
    tokens: typeof s.tokens === 'number' ? s.tokens : null,
    latency_ms: typeof s.latency_ms === 'number' ? s.latency_ms : null,
    error: s.error || null,
  }));

  // 必备字段核验
  const missingTokens = steps.filter(s => s.tokens === null).length;
  if (missingTokens) errors.push(`${missingTokens} 步缺 tokens（B2/B3 受影响）`);
  if (steps.some(s => s.tool === null)) warnings.push('部分步缺 tool 字段（A5 受影响）');
  const hasLatency = steps.some(s => s.latency_ms !== null);
  if (!hasLatency) warnings.push('全部步缺 latency_ms → B1 判 N/A');

  if (typeof trace.total_tokens !== 'number') warnings.push('total_tokens 缺失，将按 steps 求和');
  if (typeof trace.finished !== 'boolean') warnings.push('finished 缺失，完成性判定受限');

  const sumTokens = steps.reduce((a, s) => a + (s.tokens || 0), 0);
  const latencies = steps.map(s => s.latency_ms).filter(x => x !== null).sort((a, b) => a - b);

  const totals = {
    stepCount: steps.length,
    total_tokens: typeof trace.total_tokens === 'number' ? trace.total_tokens : sumTokens,
    sumTokens,
    total_ms: typeof trace.total_ms === 'number'
      ? trace.total_ms
      : (latencies.length ? latencies.reduce((a, b) => a + b, 0) : null),
    finished: trace.finished === true,
    errorSteps: steps.filter(s => s.error).length,
    hasLatency,
    latencies,
  };

  return { valid: errors.length === 0, errors, warnings, steps, totals };
}

/** 批量解析（多任务 trace），返回聚合统计 */
function parseTraces(traces) {
  const parsed = (traces || []).map(parseTrace);
  const ok = parsed.filter(p => p.valid);
  return {
    count: parsed.length,
    validCount: ok.length,
    invalidCount: parsed.length - ok.length,
    items: parsed,
  };
}

/** 百分位（P50/P95）· 最近秩法（nearest-rank，1-based） */
function percentile(sortedArr, p) {
  if (!sortedArr || !sortedArr.length) return null;
  const rank = Math.ceil((p / 100) * sortedArr.length);
  const idx = Math.max(0, Math.min(sortedArr.length - 1, rank - 1));
  return sortedArr[idx];
}

module.exports = { parseTrace, parseTraces, percentile };
