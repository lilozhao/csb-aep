#!/usr/bin/env node
/**
 * Harness 工程域 M3 测试 · CSB-AEP v2.4
 * 覆盖：A1/A2/A4/A5/A6/A7/A8 判定 / Δ 基线 + 呈现净化 / 抗游戏化 / 全 15 项编排
 * 运行：node test/harness-m3.test.js
 */
'use strict';
const assert = require('assert');
const { extractConfig } = require('../server/engine/harness/manifest.js');
const { a1, a2, a4, a5, a6, a7, a8, editDistance } = require('../server/engine/harness/robustness.js');
const { computeDelta, purify } = require('../server/engine/harness/delta.js');
const { gameResistance } = require('../server/engine/harness/game-resistance.js');
const { HarnessEvaluator } = require('../server/engine/harness');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}
const CFG = extractConfig({
  harness: { name: 'h' }, loop: { max_iterations: 50, loop_guard: 'j' },
  context: { trigger_ratio: 0.65 },
  sandbox: { fs_boundary: 'workspace-only', network_egress: 'allowlist' },
  observability: { fields: ['step', 'tool', 'tokens'] },
});
const MF = { harness: { name: 'h' }, loop: { max_iterations: 50, loop_guard: 'j' },
  context: { trigger_ratio: 0.65 }, sandbox: { fs_boundary: 'workspace-only' },
  observability: { fields: ['step', 'tool', 'tokens'] } };

console.log('\n=== A1 上下文压缩质量 ===');
t('no-impact 0.95 → 10', () => {
  const r = a1(CFG, { compression: { events: [{ affectedSteps: 1, unaffectedSteps: 19, keyFactsTotal: 10, keyFactsRetained: 9 }] } });
  assert.strictEqual(r.score, 10);
});
t('no-impact 0.4 → 2', () => {
  const r = a1(CFG, { compression: { events: [{ affectedSteps: 6, unaffectedSteps: 4 }] } });
  assert.strictEqual(r.score, 2);
});
t('无数据 → N/A', () => { assert.strictEqual(a1(CFG, {}).score, null); });

console.log('\n=== A2 压缩触发合理性 ===');
t('0.65 → 10', () => { assert.strictEqual(a2(CFG, {}).score, 10); });
t('0.45 → 3（过早）', () => {
  const cfg = extractConfig({ ...MF, context: { trigger_ratio: 0.45 } });
  assert.strictEqual(a2(cfg, {}).score, 3);
});
t('未声明 → N/A', () => {
  const cfg = extractConfig({ ...MF, context: {} });
  assert.strictEqual(a2(cfg, {}).score, null);
});

console.log('\n=== A4 死循环防护 ===');
t('无互锁无辩论 → 10', () => {
  assert.strictEqual(a4(CFG, { multiAgent: { sessions: [{ interlock: false, debateLoop: false }] } }).score, 10);
});
t('有辩论循环 → 5', () => {
  assert.strictEqual(a4(CFG, { multiAgent: { sessions: [{ interlock: false, debateLoop: true }] } }).score, 5);
});
t('有互锁 → 0', () => {
  assert.strictEqual(a4(CFG, { multiAgent: { sessions: [{ interlock: true }] } }).score, 0);
});

console.log('\n=== A5 工具编排正确率 ===');
t('全对 → 10', () => {
  const exp = [{ tool: 'r', args_hash: 'a' }, { tool: 'w', args_hash: 'b' }];
  const r = a5(CFG, { orchestration: [{ actual: exp, expected: exp }] });
  assert.strictEqual(r.score, 10);
});
t('选择率低 → 3', () => {
  const r = a5(CFG, { orchestration: [{ actual: [{ tool: 'x', args_hash: 'z' }], expected: [{ tool: 'r', args_hash: 'a' }] }] });
  assert.strictEqual(r.score, 3);
});
t('编辑距离', () => { assert.strictEqual(editDistance(['a', 'b', 'c'], ['a', 'b', 'c']), 0); assert.strictEqual(editDistance(['a', 'b'], ['a', 'c']), 1); });

console.log('\n=== A6 权限与沙箱隔离 ===');
t('全守住 → 10', () => {
  assert.strictEqual(a6(CFG, { boundary: [{ kind: 'fs', rejected: true, breached: false }, { kind: 'net', rejected: true, breached: false }] }).score, 10);
});
t('有突破 → 0', () => {
  assert.strictEqual(a6(CFG, { boundary: [{ kind: 'fs', breached: true }] }).score, 0);
});

console.log('\n=== A7 可观测与审计 ===');
t('三率 0.96 → 10', () => {
  assert.strictEqual(a7(CFG, { observability: { logCoverage: 0.96, auditIntegrity: 0.97, keyEventCapture: 0.98 } }).score, 10);
});
t('字段缺失 → N/A', () => {
  const cfg = extractConfig({ ...MF, observability: { fields: ['step'] } });
  assert.strictEqual(a7(cfg, {}).score, null);
});

console.log('\n=== A8 恢复力 ===');
t('成功无重复 → 10', () => {
  assert.strictEqual(a8(CFG, { recovery: [{ recovered: true, stateConsistent: true, duplicateSideEffects: false }] }).score, 10);
});
t('成功但有重复 → 6', () => {
  assert.strictEqual(a8(CFG, { recovery: [{ recovered: true, duplicateSideEffects: true }] }).score, 6);
});
t('失败 → 0', () => {
  assert.strictEqual(a8(CFG, { recovery: [{ recovered: false }] }).score, 0);
});

console.log('\n=== Δ 基线 + 呈现净化（§7.3）===');
t('Δ = harness − baseline', () => {
  const c = computeDelta({ harnessScore: 8.4, baselineScore: 7.2 });
  assert.strictEqual(c.available, true);
  assert.strictEqual(c.delta, 1.2);
  assert.ok(c.sig);
});
t('无基线 → pending_baseline（无 Δ 不上屏）', () => {
  const c = computeDelta({ harnessScore: 8 });
  assert.strictEqual(c.available, false);
  assert.strictEqual(c.status, 'pending_baseline');
});
t('purify 无基线 → 不出分', () => {
  const p = purify({ harness: { name: 'x' } }, { available: false });
  assert.strictEqual(p.status, 'pending_baseline');
  assert.strictEqual(p.delta, null);
});
t('purify 有基线 → 只出 Δ 卡片，不含绝对分', () => {
  const c = computeDelta({ harnessScore: 8.4, baselineScore: 7.2 });
  const p = purify({ harness: { name: 'x' }, partial: { naMetrics: [] } }, c);
  assert.ok(p.delta && p.delta.delta === 1.2);
  assert.ok(!('average' in p));           // 绝对分不上屏
  assert.ok(!('metrics' in p));
});

console.log('\n=== 抗游戏化（§7.4）===');
t('逐项作弊路径分析（15 项）', () => {
  const ev = new HarnessEvaluator();
  const metrics = [{ id: 'A1', status: 'ok', retentionRate: 0.3, score: 10 }, { id: 'B1', status: 'ok', sampleCount: 5 }];
  const gr = gameResistance(metrics);
  assert.strictEqual(gr.analyzed, 2);
  assert.ok(gr.items[0].suspicious.length > 0);  // A1 激进压缩可疑
  assert.ok(gr.items[1].suspicious.length > 0);  // B1 样本量不足
});

console.log('\n=== 全 15 项编排 ===');
t('implemented 满 16 项（A9+B5+C2；协议 §7.2 标题“15 项”系笔误，待勘误）', () => {
  const c = new HarnessEvaluator().capabilities();
  assert.strictEqual(c.implemented.length, 16);
  assert.strictEqual(c.planned.length, 0);
  assert.strictEqual(c.version, '2.4.0-M3');
});
t('evaluate 出 A+B 全量指标', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({
    manifest: MF,
    compression: { events: [{ affectedSteps: 1, unaffectedSteps: 19, keyFactsTotal: 10, keyFactsRetained: 9 }] },
    multiAgent: { sessions: [{ interlock: false, debateLoop: false }] },
    orchestration: [{ actual: [{ tool: 'r', args_hash: 'a' }], expected: [{ tool: 'r', args_hash: 'a' }] }],
    boundary: [{ kind: 'fs', rejected: true, breached: false }],
    observability: { logCoverage: 0.96, auditIntegrity: 0.96, keyEventCapture: 0.96 },
    recovery: [{ recovered: true, stateConsistent: true, duplicateSideEffects: false }],
    baselineScore: 7.0,
  });
  for (const id of ['A1', 'A2', 'A4', 'A5', 'A6', 'A7', 'A8']) {
    assert.strictEqual(out.metrics.find(m => m.id === id).status, 'ok', `${id} 应 ok`);
  }
  assert.strictEqual(out.delta.available, true);
  assert.ok(out.gameResistance.analyzed > 0);
});
t('present() 净化：无 Δ 时不上屏', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({ manifest: MF });
  const p = ev.present(out);
  assert.strictEqual(p.status, 'pending_baseline');
});

console.log(`\n📊 M3 测试：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
