/**
 * Harness 域 · 采集适配器（M1）
 * 不同 harness 输出格式 → csb-trace-v1 规范
 *
 * 优先级：csb-trace-v1 为社区标准；otel / claude-code 为兼容桥。
 */
'use strict';

/** 原生 csb-trace-v1：直接返回 */
function fromCsbTrace(raw) {
  return raw;
}

/** OpenTelemetry GenAI 语义约定 → csb-trace-v1（最小映射） */
function fromOtel(raw) {
  const spans = raw.spans || raw.resourceSpans || [];
  const steps = spans.map((s, i) => {
    const attrs = s.attributes || {};
    return {
      i: i + 1,
      tool: attrs['gen_ai.tool.name'] || attrs['tool.name'] || attrs['gen_ai.operation.name'] || s.name || null,
      args_hash: attrs['gen_ai.tool.call.id'] || attrs['tool.call.id'] || null,
      tokens: attrs['gen_ai.usage.output_tokens'] ?? attrs['gen_ai.usage.total_tokens'] ?? null,
      latency_ms: typeof s.durationMs === 'number' ? s.durationMs : null,
      error: s.status?.code === 2 ? (s.status.message || 'error') : null,
    };
  });
  return {
    task_id: raw.task_id || raw.traceId || null,
    model: raw.model || null,
    steps,
    total_tokens: steps.reduce((a, s) => a + (s.tokens || 0), 0),
    total_ms: steps.reduce((a, s) => a + (s.latency_ms || 0), 0),
    finished: raw.finished !== false,
  };
}

/** Claude Code 原生日志 → csb-trace-v1（最小映射） */
function fromClaudeCode(raw) {
  const events = raw.messages || raw.events || [];
  const steps = [];
  events.forEach((e, i) => {
    if (e.type === 'tool_use' || e.tool) {
      steps.push({
        i: steps.length + 1,
        tool: e.tool || e.name || null,
        args_hash: e.id || null,
        tokens: e.usage?.output_tokens ?? null,
        latency_ms: e.durationMs ?? null,
        error: e.is_error ? 'error' : null,
      });
    }
  });
  return {
    task_id: raw.session_id || null,
    model: raw.model || null,
    steps,
    total_tokens: raw.usage?.output_tokens ?? steps.reduce((a, s) => a + (s.tokens || 0), 0),
    total_ms: steps.reduce((a, s) => a + (s.latency_ms || 0), 0),
    finished: raw.finished !== false,
  };
}

const ADAPTERS = {
  'csb-trace-v1': fromCsbTrace,
  'csb-trace': fromCsbTrace,
  'otel': fromOtel,
  'opentelemetry': fromOtel,
  'claude-code': fromClaudeCode,
};

/** 按 format 归一化；未知 format 用 csb-trace-v1 兜底 */
function normalize(raw, format = 'csb-trace-v1') {
  const fn = ADAPTERS[format] || fromCsbTrace;
  try {
    return { ok: true, trace: fn(raw), format };
  } catch (e) {
    return { ok: false, error: e.message, format };
  }
}

module.exports = { normalize, ADAPTERS, fromCsbTrace, fromOtel, fromClaudeCode };
