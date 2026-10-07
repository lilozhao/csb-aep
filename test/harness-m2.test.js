#!/usr/bin/env node
/**
 * Harness 工程域 M2 测试 · CSB-AEP v2.4
 * 覆盖：B2/B3/B4/B5 判定 / 探针框架（loop-trap / tool-fault）/ 编排回归
 * 运行：node test/harness-m2.test.js
 */
'use strict';
const assert = require('assert');
const { extractConfig } = require('../server/engine/harness/manifest.js');
const { b1, b2, b3, b4, b5 } = require('../server/engine/harness/cost.js');
const { loopTrap, toolFault, sideEffect } = require('../server/engine/harness/probes');
const { HarnessEvaluator } = require('../server/engine/harness');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

const CFG = extractConfig({
  harness: { name: 'h' }, loop: { max_iterations: 50, loop_guard: 'jaccard' },
  sandbox: { fs_boundary: 'workspace-only' }, observability: { fields: ['step', 'tool', 'tokens'] },
});
const mkTrace = (tokens, steps, lat) => ({
  steps: Array.from({ length: steps }, (_, i) => ({ i: i + 1, tool: 't', args_hash: 'h', tokens, latency_ms: lat })),
  total_tokens: tokens * steps, finished: true,
});

console.log('\n=== B2 令牌效率 ===');
t('前 25% → 10', () => {
  const traces = [mkTrace(100, 3, 100)];   // 任务总量 300
  const r = b2(CFG, { traces, peerValues: [300, 400, 500, 600] }); // P25=300，300≤300 → top
  assert.strictEqual(r.score, 10);
  assert.strictEqual(r.tier, 'top');
});
t('后 25% → 3', () => {
  const traces = [mkTrace(100, 3, 100)];   // 任务总量 300
  const r = b2(CFG, { traces, peerValues: [10, 20, 30, 30000] }); // P75=30，300≥30 → bottom
  assert.strictEqual(r.tier, 'bottom');
  assert.strictEqual(r.score, 3);
});
t('缺 tokens → N/A', () => {
  const traces = [{ steps: [{ i: 1, tool: 't' }], finished: true }];
  const r = b2(CFG, { traces });
  assert.strictEqual(r.score, null);
});

console.log('\n=== B3 步骤经济性 ===');
t('等于基准 → 10', () => {
  const r = b3(CFG, { traces: [mkTrace(10, 10, 100)], bestSteps: 10 });
  assert.strictEqual(r.score, 10);
});
t('超 2 倍 → 3', () => {
  const r = b3(CFG, { traces: [mkTrace(10, 22, 100)], bestSteps: 10 });
  assert.strictEqual(r.score, 3);
  assert.ok(r.ratio > 2);
});
t('基准 0 → N/A', () => {
  const r = b3(CFG, { traces: [mkTrace(10, 0, 100)], bestSteps: 0 });
  assert.strictEqual(r.score, null);
});

console.log('\n=== B4 每任务成本 ===');
t('成本档位 top → 10', () => {
  const traces = [mkTrace(1000, 5, 100)];
  const r = b4(CFG, { traces, unitPrice: 0.001, toolCost: 0.01, peerCosts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  assert.strictEqual(r.status, 'ok');
  assert.ok(typeof r.avgCostPerTask === 'number');
});
t('无单价 → 仍出近似 + note', () => {
  const r = b4(CFG, { traces: [mkTrace(1000, 5, 100)] });
  assert.strictEqual(r.status, 'ok');
  assert.ok(r.note);
});

console.log('\n=== B5 并发与弹性 ===');
t('降幅 <10% → 10', () => {
  const r = b5(CFG, { loads: [{ concurrency: 1, successRate: 1, p95_ms: 100 }, { concurrency: 20, successRate: 0.95, p95_ms: 150 }] });
  assert.strictEqual(r.score, 10);
});
t('降幅 >50% → 2', () => {
  const r = b5(CFG, { loads: [{ concurrency: 1, successRate: 1, p95_ms: 100 }, { concurrency: 20, successRate: 0.4, p95_ms: 900 }] });
  assert.strictEqual(r.score, 2);
});
t('无负载数据 → N/A', () => {
  assert.strictEqual(b5(CFG, {}).score, null);
});

console.log('\n=== 探针：loop-trap ===');
t('重复序列被打断 → 检出', () => {
  const p = loopTrap({ tool: 'read_file', args_hash: 'x', repeats: 10 });
  const trace = { steps: [
    { tool: 'read_file', args_hash: 'x' }, { tool: 'read_file', args_hash: 'x' },
    { tool: 'write_file', args_hash: 'y' },
  ] };
  const j = p.judge(trace);
  assert.strictEqual(j.detected, true);
});
t('跑满未中断 → 未检出', () => {
  const p = loopTrap({ tool: 'read_file', args_hash: 'x', repeats: 3 });
  const trace = { steps: Array.from({ length: 3 }, () => ({ tool: 'read_file', args_hash: 'x' })) };
  const j = p.judge(trace);
  assert.strictEqual(j.detected, false);
});

console.log('\n=== 探针：tool-fault ===');
t('注入后重试且完成 → recovered', () => {
  const p = toolFault({ atStep: 2, errorType: 'timeout' });
  const trace = { steps: [
    { tool: 'a', args_hash: '1' }, { tool: 'a', args_hash: '1', error: 'timeout' }, { tool: 'a', args_hash: '1' },
  ], finished: true };
  const j = p.judge(trace);
  assert.strictEqual(j.recovered, true);
  assert.strictEqual(j.retryable, true);
});
t('permission_denied 不可重试', () => {
  const p = toolFault({ errorType: 'permission_denied' });
  assert.strictEqual(p.retryable, false);
});
t('侧效应探针 M2 不启用', () => {
  const p = sideEffect();
  assert.strictEqual(p.enabled, false);
});

console.log('\n=== 编排回归（M2 七项）===');
t('evaluate 出 7 项指标', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({
    manifest: { harness: { name: 'h' }, loop: { max_iterations: 50, loop_guard: 'j' },
      sandbox: { fs_boundary: 'workspace-only' }, observability: { fields: ['step', 'tool', 'tokens'] } },
    traces: [mkTrace(100, 5, 500)],
    peerTokens: [100, 200, 300, 400], bestSteps: 5,
    loads: [{ concurrency: 1, successRate: 1, p95_ms: 100 }, { concurrency: 20, successRate: 0.95, p95_ms: 150 }],
  });
  assert.strictEqual(out.partial.implemented.length, 7);
  assert.deepStrictEqual(out.partial.implemented, ['A3', 'A9', 'B1', 'B2', 'B3', 'B4', 'B5']);
});
t('capabilities 报告 M2（含探针）', () => {
  const c = new HarnessEvaluator().capabilities();
  assert.strictEqual(c.version, '2.4.0-M2');
  assert.deepStrictEqual(c.probes, ['loop-trap', 'tool-fault']);
  assert.ok(!c.planned.includes('B2'), 'B2 已落地，不应在 planned');
});
t('deriveTraps：从 trace 自动推导循环判定', () => {
  const ev = new HarnessEvaluator();
  const loopTrace = { steps: [{ tool: 'r', args_hash: 'x' }, { tool: 'r', args_hash: 'x' }, { tool: 'w', args_hash: 'y' }], finished: true };
  const out = ev.evaluate({
    manifest: { harness: { name: 'h' }, loop: { max_iterations: 50, loop_guard: 'j' },
      sandbox: { fs_boundary: 'workspace-only' }, observability: { fields: ['step', 'tool', 'tokens'] } },
    traces: [loopTrace],
  });
  const a3m = out.metrics.find(m => m.id === 'A3');
  assert.strictEqual(a3m.status, 'ok');
});

console.log(`\n📊 M2 测试：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
