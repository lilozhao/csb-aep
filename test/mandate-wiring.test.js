'use strict';

/**
 * P1-5 接线测试 —— 「mandate 有没有真的进到对外路径上」
 *
 * 内核单测（mandate.test.js）证明规则对；这里证明**对外三条路都读它**：
 *   ① 报告层（落库）
 *   ② 回执（签名绑定）
 *   ③ GET /api/eval/:id?use=…（复用闸门）
 *
 * 为什么专门测第三条：P1-4 的教训是「判据指纹写了但没人查」。
 * 一个没人查的委托边界，等于没有边界。
 */
const test = require('node:test');
const assert = require('node:assert');

const { EvalAPI } = require('../server/api/eval.js');
const verdict = require('../server/engine/verdict');

function mkApi(report) {
  const api = Object.create(EvalAPI.prototype);   // 不跑构造器（不连盘、不建引擎）
  api.store = { getById: async () => report };
  return api;
}

function mkRes() {
  const out = { statusCode: 200, body: null };
  return {
    status(c) { out.statusCode = c; return this; },
    json(b) { out.body = b; return this; },
    get _out() { return out; },
  };
}

const POLICY = 'aep-2.4.2/blackbox';

function mkReport(mandate) {
  const rcpt = verdict.buildReceipt({
    verdict: verdict.VERDICT.PASS,
    score: 0.9,
    policy: { version: POLICY },
    collector: { id: 'openclaw', version: '1' },
    telemetry_tier: 'hook',
    mandate,
    config: { mode: 'blackbox' },
  });
  return {
    id: 'r1',
    score: 90,
    mode: 'blackbox',
    receipt: rcpt,
    mandate: rcpt.mandate,
    mandate_digest: rcpt.mandate_digest,
    mandate_derived: rcpt.mandate_derived,
  };
}

test('GET /api/eval/:id?use=eval:read → 可复用（默认委托的许可面）', async () => {
  const api = mkApi(mkReport());
  const res = mkRes();
  await api.getEval({ params: { id: 'r1' }, headers: { host: 'localhost' }, url: 'http://localhost/api/eval/r1?use=eval:read&strength=advisory' }, res);
  assert.strictEqual(res._out.body.reuse.reusable, true);
  assert.strictEqual(res._out.body.reuse.code, null);
});

test('GET /api/eval/:id?use=gate&strength=gating → 拒（默认委托是 advisory/read）', async () => {
  const api = mkApi(mkReport());
  const res = mkRes();
  await api.getEval({ params: { id: 'r1' }, headers: { host: 'localhost' }, url: 'http://localhost/api/eval/r1?use=gate&strength=gating' }, res);
  const reuse = res._out.body.reuse;
  assert.strictEqual(reuse.reusable, false);
  assert.strictEqual(reuse.code, 'out_of_scope');
  assert.deepStrictEqual(reuse.missing, ['gate']);
  assert.match(reuse.reason, /越界一律新开/);
});

test('GET /api/eval/:id?use=eval:gate → 显式 gating 委托可以放行', async () => {
  const api = mkApi(mkReport({
    scope: ['eval:gate'], strength: 'gating', policy_version: POLICY,
  }));
  const res = mkRes();
  await api.getEval({ params: { id: 'r1' }, headers: { host: 'localhost' }, url: 'http://localhost/api/eval/r1?use=eval:gate&strength=gating' }, res);
  assert.strictEqual(res._out.body.reuse.reusable, true);
});

test('GET /api/eval/:id：不带 use 时不改变原有返回（纯加法）', async () => {
  const api = mkApi(mkReport());
  const res = mkRes();
  await api.getEval({ params: { id: 'r1' }, headers: { host: 'localhost' }, url: 'http://localhost/api/eval/r1' }, res);
  assert.strictEqual(res._out.body.id, 'r1');
  assert.strictEqual(res._out.body.reuse, undefined, '没问就不该多塞字段');
});

test('GET /api/eval/:id?use=…：P1-5 之前的老报告 → missing_mandate（不装作可用）', async () => {
  const api = mkApi({ id: 'old', receipt: {}, mandate: null });
  const res = mkRes();
  await api.getEval({ params: { id: 'old' }, headers: { host: 'localhost' }, url: 'http://localhost/api/eval/old?use=eval:read' }, res);
  assert.strictEqual(res._out.body.reuse.reusable, false);
  assert.strictEqual(res._out.body.reuse.code, 'missing_mandate');
});

test('口径不符 → policy_mismatch（不猜哪个版本更可信）', async () => {
  const api = mkApi(mkReport());
  const res = mkRes();
  await api.getEval({ params: { id: 'r1' }, headers: { host: 'localhost' }, url: 'http://localhost/api/eval/r1?use=eval:read&policy_version=aep-3.0/blackbox' }, res);
  assert.strictEqual(res._out.body.reuse.code, 'policy_mismatch');
});
