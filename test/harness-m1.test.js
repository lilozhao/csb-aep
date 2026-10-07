#!/usr/bin/env node
/**
 * Harness 工程域 M1 测试 · CSB-AEP v2.4
 * 覆盖：Manifest 校验 / Trace 解析与降级 / A3 / A9 / B1 / 域隔离不变量
 * 运行：node test/harness-m1.test.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { validateManifest, extractConfig } = require('../server/engine/harness/manifest.js');
const { parseTrace, percentile } = require('../server/engine/harness/trace.js');
const { normalize } = require('../server/engine/harness/adapters');
const { a3, a9 } = require('../server/engine/harness/robustness.js');
const { b1 } = require('../server/engine/harness/cost.js');
const { HarnessEvaluator } = require('../server/engine/harness');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

const GOOD_MANIFEST = {
  harness: { name: 'claude-code', version: '1.x', adapter: 'claude-code' },
  loop: { max_iterations: 50, max_tokens_per_task: 200000, loop_guard: 'param-jaccard' },
  context: { compression: 'summarize', trigger_ratio: 0.65, keep_recent_turns: 6 },
  sandbox: { network_egress: 'allowlist', fs_boundary: 'workspace-only', kernel_isolation: false },
  observability: { trace_format: 'csb-trace-v1', fields: ['step', 'tool', 'args_hash', 'tokens', 'latency_ms', 'error'] },
  tools: [{ name: 'read_file', side_effect: false }, { name: 'run_shell', side_effect: true }],
};

console.log('\n=== Manifest 校验 ===');
t('合格 Manifest → valid', () => {
  const r = validateManifest(GOOD_MANIFEST);
  assert.strictEqual(r.valid, true, JSON.stringify(r.errors));
});
t('缺 fs_boundary → 报错', () => {
  const m = JSON.parse(JSON.stringify(GOOD_MANIFEST));
  delete m.sandbox.fs_boundary;
  const r = validateManifest(m);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('fs_boundary')));
});
t('缺 max_iterations → 报错', () => {
  const m = JSON.parse(JSON.stringify(GOOD_MANIFEST));
  delete m.loop.max_iterations;
  assert.strictEqual(validateManifest(m).valid, false);
});
t('observability.fields 缺 tokens → A7 N/A', () => {
  const m = JSON.parse(JSON.stringify(GOOD_MANIFEST));
  m.observability.fields = ['step', 'tool'];
  const r = validateManifest(m);
  assert.strictEqual(r.valid, false);
  assert.ok(r.na.includes('A7'));
});
t('extractConfig 提取 maxIterations/loopGuard', () => {
  const c = extractConfig(GOOD_MANIFEST);
  assert.strictEqual(c.maxIterations, 50);
  assert.strictEqual(c.loopGuard, 'param-jaccard');
});

console.log('\n=== Trace 解析 ===');
const GOOD_TRACE = {
  task_id: 't-001', model: 'gpt-4o',
  steps: [
    { i: 1, tool: 'read_file', args_hash: 'a1b2', tokens: 812, latency_ms: 340, error: null },
    { i: 2, tool: 'read_file', args_hash: 'a1b2', tokens: 790, latency_ms: 320, error: 'timeout' },
  ],
  total_tokens: 1602, total_ms: 660, finished: true,
};
t('合法 Trace → valid + totals', () => {
  const p = parseTrace(GOOD_TRACE);
  assert.strictEqual(p.valid, true);
  assert.strictEqual(p.totals.stepCount, 2);
  assert.strictEqual(p.totals.total_tokens, 1602);
});
t('缺 latency_ms → B1 受影响警告', () => {
  const tr = { task_id: 'x', steps: [{ i: 1, tool: 'a', tokens: 10 }], total_tokens: 10, finished: true };
  const p = parseTrace(tr);
  assert.ok(p.warnings.some(w => w.includes('latency_ms')));
  assert.strictEqual(p.totals.hasLatency, false);
});
t('percentile 最近秩法 P50/P95', () => {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.strictEqual(percentile(arr, 50), 5);   // ceil(0.5×10)=5 → 下标 4
  assert.strictEqual(percentile(arr, 95), 10);  // ceil(0.95×10)=10 → 下标 9
  assert.strictEqual(percentile([], 50), null);
});

console.log('\n=== 适配器 ===');
t('csb-trace-v1 直通', () => {
  const n = normalize(GOOD_TRACE, 'csb-trace-v1');
  assert.strictEqual(n.ok, true);
  assert.strictEqual(n.trace.steps.length, 2);
});
t('otel 映射 → csb-trace', () => {
  const raw = { traceId: 'abc', spans: [{ name: 'read', durationMs: 100, attributes: { 'gen_ai.tool.name': 'read_file', 'gen_ai.usage.output_tokens': 50 } }] };
  const n = normalize(raw, 'otel');
  assert.strictEqual(n.ok, true);
  assert.strictEqual(n.trace.steps[0].tool, 'read_file');
  assert.strictEqual(n.trace.steps[0].tokens, 50);
});

console.log('\n=== A3 循环与步数控制 ===');
t('无 loop_guard → 0 分', () => {
  const c = extractConfig({ ...GOOD_MANIFEST, loop: { max_iterations: 50 } });
  const r = a3(c, { traps: [] });
  assert.strictEqual(r.score, 0);
});
t('全检出且 ≤3 步 → 10 分', () => {
  const c = extractConfig(GOOD_MANIFEST);
  const traps = Array.from({ length: 5 }, (_, i) => ({ id: i, steps: [{ tool: 'x', args_hash: 'h' }], detected: true, detectedAtStep: 2 }));
  const r = a3(c, { traps });
  assert.strictEqual(r.score, 10);
});
t('无陷阱数据 → N/A', () => {
  const c = extractConfig(GOOD_MANIFEST);
  const r = a3(c, { traps: [] });
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.status, 'N/A');
});

console.log('\n=== A9 确定性 ===');
t('全一致 → 10 分', () => {
  const runs = [[GOOD_TRACE, GOOD_TRACE, GOOD_TRACE]];
  const r = a9(extractConfig(GOOD_MANIFEST), { runs });
  assert.strictEqual(r.score, 10);
  assert.strictEqual(r.consistencyRate, 1);
});
t('不一致 → 降分', () => {
  const alt = { ...GOOD_TRACE, steps: [{ i: 1, tool: 'other', args_hash: 'zz', tokens: 1 }] };
  const runs = [[GOOD_TRACE, alt], [GOOD_TRACE, GOOD_TRACE]];
  const r = a9(extractConfig(GOOD_MANIFEST), { runs });
  assert.ok(r.score <= 7);
});
t('无运行数据 → N/A', () => {
  const r = a9(extractConfig(GOOD_MANIFEST), {});
  assert.strictEqual(r.score, null);
});

console.log('\n=== B1 延迟 ===');
t('P95≤5s → 10 分', () => {
  const traces = Array.from({ length: 25 }, () => ({ steps: [{ i: 1, tool: 'a', tokens: 1, latency_ms: 1000 }], total_tokens: 1, finished: true }));
  const r = b1(extractConfig(GOOD_MANIFEST), { traces });
  assert.strictEqual(r.score, 10);
});
t('无 latency → N/A', () => {
  const traces = [{ steps: [{ i: 1, tool: 'a', tokens: 1 }], total_tokens: 1, finished: true }];
  const r = b1(extractConfig(GOOD_MANIFEST), { traces });
  assert.strictEqual(r.score, null);
});

console.log('\n=== 编排 + 域隔离不变量 ===');
t('evaluate 产出 domain=harness，无 eval 字段混入', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({ manifest: GOOD_MANIFEST, traces: [GOOD_TRACE] });
  assert.strictEqual(out.domain, 'harness');
  assert.ok(!('final_score' in out));            // 非评测域口径
  assert.ok(out.partial.implemented.length >= 3); // M1 试点 3 项（M2 起为 7 项）
});
t('无 manifest → 校验失败但仍诚实返回', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({ manifest: {} });
  assert.strictEqual(out.manifest.valid, false);
});
t('capabilities 报告已落指标（M1 → M2 扩展）', () => {
  const ev = new HarnessEvaluator();
  const c = ev.capabilities();
  for (const id of ['A3', 'A9', 'B1']) assert.ok(c.implemented.includes(id), `缺 ${id}`);
  assert.ok(c.implemented.includes('B5'));  // M2 新增
});
t('域隔离：harness 引擎不引用 gdi/eval 模块', () => {
  const fs = require('fs');
  // 只查 require 语句，不查注释文本
  const src = fs.readFileSync(path.join(__dirname, '../server/engine/harness/index.js'), 'utf8');
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []).join('\n');
  assert.ok(!/gdi/.test(requires), 'harness 引擎不得 require gdi 模块');
  assert.ok(!/api\/eval/.test(requires), 'harness 引擎不得 require eval 模块');
});

console.log(`\n📊 M1 测试：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
