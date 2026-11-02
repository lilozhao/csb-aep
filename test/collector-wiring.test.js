/**
 * P1-1 回执/报告接线测试 —— 防「内核有了没人调」与「字段加了没落库」
 *
 * 这两条是同一个病的两种形态：
 *   ① 声明了能力，但判定链不读 → 白标
 *   ② 把字段塞进 buildReceipt 入参，被静默丢弃 → 看着加了，实际没落库
 * 所以这里不测"函数返回值对不对"，测**端到端有没有真的出现在产物里**。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { buildReportReceipt } = require('../server/api/eval.js');
const { OpenClawAdapter } = require('../server/adapter/openclaw.js');
const { BaseAdapter } = require('../server/adapter/base.js');

const mkReport = () => ({ score: 80, results: [{ id: 'a1', weight: 10, score: 90, pass: true }] });
const mkCtx = (adapter, report) => ({ mode: 'both', adapter, evalResult: report, whiteboxResult: null, req: { body: {} } });

test('报告层出现 collector 快照（真落库，不是只在入参里）', () => {
  const report = mkReport();
  buildReportReceipt(report, mkCtx(new OpenClawAdapter(), report));
  assert.ok(report.collector, 'report.collector 缺失 —— 字段没落库');
  assert.strictEqual(report.collector.id, 'openclaw');
  assert.strictEqual(report.collector.tier, 'protocol');
  assert.strictEqual(report.collector.registered, true);
  assert.strictEqual(report.collector.sources.toolInventory, true);
});

test('回执 schema 不被 P1-1 改动（7 必填仍齐、键集不变）', () => {
  const report = mkReport();
  const rcpt = buildReportReceipt(report, mkCtx(new OpenClawAdapter(), report));
  assert.strictEqual(rcpt.complete, true);
  assert.deepStrictEqual(rcpt.missing_fields, []);
  // P1-5 新增的是 4 个 mandate 键（mandate / mandate_digest / mandate_derived / mandate_valid），
  // 7 个必填一个不动、原有键名一个不改 —— 这里锁「只增不改」。
  assert.strictEqual(Object.keys(rcpt).length, 18, `回执键数变了：${Object.keys(rcpt).join(',')}`);
  for (const k of ['mandate', 'mandate_digest', 'mandate_derived', 'mandate_valid']) {
    assert.ok(k in rcpt, `P1-5 字段未落库：${k}`);
  }
  assert.strictEqual(rcpt.collector_version.startsWith('sha256:'), true);
});

test('报告层也带 mandate（不用解签就能看可用范围）', () => {
  const report = mkReport();
  const rcpt = buildReportReceipt(report, mkCtx(new OpenClawAdapter(), report));
  assert.ok(report.mandate, 'report.mandate 缺失');
  assert.strictEqual(report.mandate_digest, rcpt.mandate_digest);
  assert.strictEqual(report.mandate_derived, true, '没显式给委托 → 必须是保守默认且标明 derived');
  assert.deepStrictEqual(report.mandate.scope, ['eval:read']);
});

test('显式 mandate 从请求体进来时，报告与回执同源', () => {
  const report = mkReport();
  const ctx = mkCtx(new OpenClawAdapter(), report);
  ctx.req = { body: { mandate: { scope: ['eval:gate'], strength: 'gating', policy_version: 'aep-2.0/both' } } };
  const rcpt = buildReportReceipt(report, ctx);
  assert.deepStrictEqual(report.mandate.scope, ['eval:gate']);
  assert.strictEqual(report.mandate.strength, 'gating');
  assert.strictEqual(report.mandate_derived, false);
  assert.strictEqual(report.mandate_digest, rcpt.mandate_digest);
});

test('judgement 带能力上限与观测档位（可审计封顶行为）', () => {
  const report = mkReport();
  buildReportReceipt(report, mkCtx(new OpenClawAdapter(), report));
  assert.strictEqual(report.judgement.tier_ceiling, 'protocol');
  assert.strictEqual(report.judgement.telemetry_tier, 'protocol');
  assert.ok(report.judgement.collector_sources);
});

test('未注册适配器：报告如实标 registered=false，档位按 none', () => {
  const report = mkReport();
  const ad = new BaseAdapter('some-future-framework');
  buildReportReceipt(report, mkCtx(ad, report));
  assert.strictEqual(report.collector.registered, false);
  assert.strictEqual(report.judgement.tier_ceiling, 'none');
  // protocol 证据被 none 上限封顶 → 结论退回 UNDECIDED（看不见就不判）
  assert.strictEqual(report.judgement.telemetry_tier, 'none');
});

test('eval.js 源码里 buildReceipt 的 collector 入参只有 id/version（不许再塞别的）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'api', 'eval.js'), 'utf8');
  const m = src.match(/collector:\s*\{([^}]*)\}/);
  assert.ok(m, '未找到 collector 入参');
  assert.ok(!/tier|sources/.test(m[1]), `collector 入参混进了会被丢弃的字段：${m[1].trim()}`);
});
