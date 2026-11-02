#!/usr/bin/env node
/**
 * P0-6 验收：通则「信号不得越级」接到判定链
 *
 * 判据（机械可核）：
 *   1. 档位从**证据**算：hooks > protocol > screen > none，证据缺位一律判低
 *   2. 低档位不得出 FAIL（PTY/NONE 全部封顶为 UNDECIDED）
 *   3. 需要工具级可见性的指标在低档位 → UNDECIDED / insufficient_telemetry（不记 0 分、不记错）
 *   4. 过程信号（repeat/drift/stall）只加 process_flag，不改结论
 *   5. eval.js 真的调用了以上两步（静态接线核验，防「内核有了没人调」）
 *
 * 运行：node test/tier-ceiling.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const V = require('../server/engine/verdict');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

console.log('\n=== 1. 档位从证据算（判低不判高） ===');
t('hooks=true → HOOK', () => {
  const r = V.resolveTier({ hooks: true, protocol: true, screen: true });
  assert.deepStrictEqual(r, { tier: V.TIER.HOOK, reason: 'hooks_available' });
});
t('只有 protocol → PROTOCOL', () => {
  assert.strictEqual(V.resolveTier({ protocol: true, screen: true }).tier, V.TIER.PROTOCOL);
});
t('只有 screen → PTY', () => {
  assert.strictEqual(V.resolveTier({ screen: true }).tier, V.TIER.PTY);
});
t('什么都没有 → NONE（不是默认给 PROTOCOL）', () => {
  const r = V.resolveTier({});
  assert.strictEqual(r.tier, V.TIER.NONE);
  assert.strictEqual(r.reason, 'no_signal');
});
t('自报「我很好」不算证据：非 true 值一律不认', () => {
  assert.strictEqual(V.resolveTier({ hooks: 'yes', protocol: 1 }).tier, V.TIER.NONE);
});
t('纯对象往返一致', () => {
  const r = V.resolveTier({ protocol: true });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), r);
});

console.log('\n=== 2. 低档位不得出 FAIL ===');
for (const tier of [V.TIER.PTY, V.TIER.NONE]) {
  t(`${tier} 档 FAIL → UNDECIDED`, () => {
    const out = V.applyTierCeiling(V.fail(0), tier);
    assert.strictEqual(out.verdict, V.VERDICT.UNDECIDED);
    assert.strictEqual(out.score, null);
    assert.strictEqual(out.reason, V.UNDECIDED_REASON.INSUFFICIENT_TELEMETRY);
    assert.ok(out.process_flag.includes('tier_downgraded'));
  });
}
t('PROTOCOL 档可以判 FAIL（协议往返能判「没回应」）', () => {
  assert.strictEqual(V.applyTierCeiling(V.fail(0), V.TIER.PROTOCOL).verdict, V.VERDICT.FAIL);
});
t('任何档位都不降 PASS（看见的部分做对了就是做对了）', () => {
  for (const tier of Object.values(V.TIER)) {
    assert.strictEqual(V.applyTierCeiling(V.pass(8), tier).verdict, V.VERDICT.PASS);
  }
});

console.log('\n=== 3. 缺钩子 → insufficient_telemetry ===');
t('需 hook、实际 protocol → UNDECIDED 且原因正确', () => {
  const out = V.applyTelemetryRequirement(V.fail(20), { tier: V.TIER.PROTOCOL, requires: V.TIER.HOOK });
  assert.strictEqual(out.verdict, V.VERDICT.UNDECIDED);
  assert.strictEqual(out.reason, 'insufficient_telemetry');
  assert.strictEqual(out.score, null);
  assert.ok(out.note.includes('insufficient telemetry'));
  assert.ok(out.process_flag.includes('tier_insufficient'));
});
t('档位够就不动结论', () => {
  const out = V.applyTelemetryRequirement(V.fail(20), { tier: V.TIER.HOOK, requires: V.TIER.HOOK });
  assert.strictEqual(out.verdict, V.VERDICT.FAIL);
});
t('requires=null（任何档位都能判）→ 原样返回', () => {
  const out = V.applyTelemetryRequirement(V.fail(20), { tier: V.TIER.NONE, requires: null });
  assert.strictEqual(out.verdict, V.VERDICT.FAIL);
});
t('PASS 不被降级（低档位看到做对，不必怀疑）', () => {
  const out = V.applyTelemetryRequirement(V.pass(9), { tier: V.TIER.NONE, requires: V.TIER.HOOK });
  assert.strictEqual(out.verdict, V.VERDICT.PASS);
});

console.log('\n=== 4. 过程信号只挂标记 ===');
t('repeat/stall 不改变结论', () => {
  const base = V.fail(30);
  const out = V.attachProcessFlags(base, ['repeat', { type: 'stall' }]);
  assert.strictEqual(out.verdict, V.VERDICT.FAIL);
  assert.strictEqual(out.score, 30);
  assert.deepStrictEqual(out.process_flag, ['repeat', 'stall']);
});
t('同一标记不重复累积', () => {
  const out = V.attachProcessFlags(V.attachProcessFlags(V.pass(5), ['drift']), ['drift']);
  assert.deepStrictEqual(out.process_flag, ['drift']);
});
t('空信号 → 原样（不塞空数组污染）', () => {
  assert.deepStrictEqual(V.attachProcessFlags(V.pass(5), []).process_flag, []);
});

console.log('\n=== 5. 端到端：低档位整份报告不出现 FAIL ===');
t('3 条全错 + NONE 档 → 聚合后无 FAIL，且 coverage=0', () => {
  const items = [V.fail(0), V.fail(0), V.fail(0)].map(v => V.applyTierCeiling(v, V.TIER.NONE));
  const agg = V.aggregate(items, { minCoverage: 0.6 });
  assert.strictEqual(agg.failed, 0);
  assert.strictEqual(agg.decided, 0);
  assert.strictEqual(agg.undecided, 3);
  assert.strictEqual(agg.score, null);
  assert.strictEqual(agg.coverage, 0);
  assert.strictEqual(agg.insufficient, true);
  assert.strictEqual(agg.verdict, V.VERDICT.UNDECIDED);
});
t('PROTOCOL 档 3 条全错 → 可以 FAIL（不是所有低档位都免罪）', () => {
  const items = [V.fail(0), V.fail(0), V.fail(0)].map(v => V.applyTierCeiling(v, V.TIER.PROTOCOL));
  const agg = V.aggregate(items, { minCoverage: 0.6 });
  assert.strictEqual(agg.failed, 3);
  assert.strictEqual(agg.verdict, V.VERDICT.FAIL);
  assert.strictEqual(agg.coverage, 1);
});

console.log('\n=== 6. 接线核验（防「内核有了没人调」） ===');
const evalSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'api', 'eval.js'), 'utf8');
t('eval.js 调用了 resolveTier', () => {
  assert.ok(/verdict\.resolveTier\s*\(/.test(evalSrc));
});
t('eval.js 调用了 applyTierCeiling 与 applyTelemetryRequirement', () => {
  assert.ok(/verdict\.applyTierCeiling\s*\(/.test(evalSrc));
  assert.ok(/verdict\.applyTelemetryRequirement\s*\(/.test(evalSrc));
});
t('档位不再写死（旧的 `? PROTOCOL : PROTOCOL` 占位符已消失）', () => {
  assert.ok(!/TIER\.PROTOCOL\s*:\s*verdict\.TIER\.PROTOCOL/.test(evalSrc));
});
t('报告里出现 judgement（三态口径对外可见）', () => {
  assert.ok(/report\.judgement\s*=/.test(evalSrc));
});

console.log('\n=== 7. 适配器能力声明如实 ===');
const { BaseAdapter } = require('../server/adapter/base.js');
t('BaseAdapter 默认 capabilities.hooks=false', () => {
  const a = new BaseAdapter('x');
  assert.strictEqual(a.capabilities.hooks, false);
});
t('所有已注册适配器都没自称有钩子（没有实现就别声明）', () => {
  const dir = path.join(__dirname, '..', 'server', 'adapter');
  for (const f of fs.readdirSync(dir)) {
    if (f === 'base.js' || !f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/capabilities\s*=\s*\{[^}]*hooks\s*:\s*true/.test(src), `${f} 自称有钩子但没有工具级实现`);
  }
});

console.log('\n=== 8. 真判定链（buildReportReceipt 实跑） ===');
const { buildReportReceipt } = require('../server/api/eval.js');
const softAdapter = { name: 'generic-a2a', capabilities: { hooks: false } };
const mkCtx = (results) => ({ mode: 'blackbox', adapter: softAdapter, evalResult: { results }, whiteboxResult: null, req: { body: {} } });

t('全不可达 → judgement: UNDECIDED / coverage 0 / tier none / 无 FAIL', () => {
  const report = {
    score: 0,
    results: [1, 2, 3].map(i => ({ id: `c${i}`, weight: 10, score: null, pass: null, status: 'UNDECIDED', reason: 'unreachable', detail: 'ECONNREFUSED' })),
  };
  const rcpt = buildReportReceipt(report, mkCtx(report.results));
  assert.strictEqual(report.judgement.verdict, 'UNDECIDED');
  assert.strictEqual(report.judgement.telemetry_tier, 'none');
  assert.strictEqual(report.judgement.tier_reason, 'no_signal');
  assert.strictEqual(report.judgement.coverage, 0);
  assert.strictEqual(report.judgement.counts.failed, 0);
  assert.strictEqual(report.judgement.insufficient, true);
  assert.strictEqual(rcpt.verdict, 'UNDECIDED');
  assert.strictEqual(rcpt.telemetry_tier, 'none');
});
t('有判定项 → tier protocol；全错可 FAIL（协议档允许）', () => {
  const results = [1, 2, 3, 4].map(i => ({ id: `c${i}`, weight: 10, score: 0, pass: false }));
  const report = { score: 0, results };
  buildReportReceipt(report, mkCtx(results));
  assert.strictEqual(report.judgement.telemetry_tier, 'protocol');
  assert.strictEqual(report.judgement.verdict, 'FAIL');
  assert.strictEqual(report.judgement.counts.failed, 4);
});
t('混合：2 对 2 没测到 → coverage 0.5 → insufficient（结论按 UNDECIDED）', () => {
  const results = [
    { id: 'a', weight: 10, score: 80, pass: true },
    { id: 'b', weight: 10, score: 70, pass: true },
    { id: 'c', weight: 10, score: null, pass: null, status: 'UNDECIDED', reason: 'timeout' },
    { id: 'd', weight: 10, score: null, pass: null, status: 'UNDECIDED', reason: 'rate_limited' },
  ];
  const report = { score: 7.5, results };
  buildReportReceipt(report, mkCtx(results));
  assert.strictEqual(report.judgement.coverage, 0.5);
  assert.strictEqual(report.judgement.insufficient, true);
  assert.strictEqual(report.judgement.verdict, 'UNDECIDED');
  assert.strictEqual(report.judgement.counts.decided, 2);
  assert.deepStrictEqual(Object.keys(report.judgement.undecidedReasons).sort(), ['rate_limited', 'timeout']);
});
t('requires=hook 的用例在 protocol 档 → UNDECIDED / insufficient_telemetry', () => {
  const results = [
    { id: 'tool-1', weight: 10, score: 0, pass: false, requires: 'hook' },
    { id: 'plain', weight: 10, score: 90, pass: true },
  ];
  const report = { score: 5, results };
  buildReportReceipt(report, mkCtx(results));
  assert.strictEqual(report.judgement.counts.failed, 0, JSON.stringify(report.judgement));
  assert.strictEqual(report.judgement.undecidedReasons.insufficient_telemetry, 1);
});
t('过程信号进 judgement.processFlags，不改结论', () => {
  const results = [{ id: 'r', weight: 10, score: 30, pass: false, processSignals: ['repeat'] }];
  const report = { score: 3, results };
  buildReportReceipt(report, mkCtx(results));
  assert.ok(report.judgement.processFlags.includes('repeat'));
  assert.strictEqual(report.judgement.counts.failed, 1);
});
t('report.score 不被改动（老消费方零影响）', () => {
  const results = [{ id: 'a', weight: 10, score: 80, pass: true }];
  const report = { score: 8, results };
  buildReportReceipt(report, mkCtx(results));
  assert.strictEqual(report.score, 8);
});

console.log(`\n${fail === 0 ? '✅' : '❌'} tier-ceiling: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
