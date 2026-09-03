/**
 * GDI MVP · 公式单元测试（node:test）
 *
 * 覆盖：契约命中率（双层契约/升格/48h作废/质量计分/失信熔断）
 *       关系复用率（自引剔除/互惠折半/去重/90天半衰）
 *       去刻度呈现（标签边界/静默期）
 *
 * 运行：node --test test/
 */
const test = require('node:test');
const assert = require('node:assert');

const { hitRate, CONTRACT_TYPE, STATUS, QUALITY } = require('../lib/contracts.js');
const { reuse } = require('../lib/reuse.js');
const { presentCard } = require('../lib/present.js');

const NOW = new Date('2026-09-03T00:00:00Z');

// ---------- 契约命中率 ----------

function mkContract(over = {}) {
  return {
    id: 't-1', type: CONTRACT_TYPE.LIGHT, promisor: '甲', promisee: '乙',
    promisedAt: '2026-09-01T00:00:00Z', deadline: '2026-09-01T01:00:00Z',
    evidenceTs: '2026-09-01T00:30:00Z',
    status: STATUS.KEPT, quality: QUALITY.COMPLETE,
    ...over,
  };
}

test('契约：全履约 3 连 → 100%，且轻量契约第 3 条自动升格 formal', () => {
  const cs = [1, 2, 3].map(i => mkContract({
    id: `c${i}`, promisedAt: `2026-09-0${i}T00:00:00Z`, deadline: `2026-09-0${i}T01:00:00Z`,
    evidenceTs: `2026-09-0${i}T00:30:00Z`,
  }));
  const r = hitRate(cs, NOW);
  assert.strictEqual(r.rate, 1);
  // 升格后权重：0.5 + 0.5 + 1.0 = 2.0
  assert.strictEqual(r.denominator, 2.0);
  const promoted = r.breakdown.find(b => b.id === 'c3');
  assert.ok(promoted.type.includes('升格'), '第 3 条轻量契约应升格 formal');
});

test('契约：1 条 broken → 命中率按权重扣减并触发失信熔断', () => {
  const cs = [
    mkContract({ id: 'ok', type: CONTRACT_TYPE.FORMAL }),
    mkContract({ id: 'bad', type: CONTRACT_TYPE.FORMAL, status: STATUS.BROKEN, quality: null }),
  ];
  const r = hitRate(cs, NOW);
  assert.strictEqual(r.rate, 0.5, '1/2 履约 → 50%');
  assert.strictEqual(r.brokenCount, 1);
  assert.ok(r.fused, '有 broken 应触发熔断标记');
});

test('契约：履约质量计分——onTime 权重低于 complete', () => {
  const a = hitRate([mkContract({ id: 'a', type: CONTRACT_TYPE.FORMAL, quality: QUALITY.COMPLETE })], NOW);
  const b = hitRate([mkContract({ id: 'b', type: CONTRACT_TYPE.FORMAL, quality: QUALITY.ONTIME })], NOW);
  assert.ok(a.rate > b.rate, 'complete 应高于 onTime');
  assert.strictEqual(b.rate, 0.85);
});

test('契约：broken 重置升格连击——第 3 条不升格', () => {
  const cs = [
    mkContract({ id: 'c1', promisedAt: '2026-09-01T00:00:00Z' }),
    mkContract({ id: 'c2', promisedAt: '2026-09-02T00:00:00Z', status: STATUS.BROKEN, quality: null }),
    mkContract({ id: 'c3', promisedAt: '2026-09-03T00:00:00Z' }),
  ];
  const r = hitRate(cs, NOW);
  const c3 = r.breakdown.find(b => b.id === 'c3');
  assert.strictEqual(c3.type, 'light', 'broken 后连击重置，c3 不应升格');
});

test('契约：轻量契约 48h 无行为印证 → 自动作废，不计入分母', () => {
  const cs = [
    mkContract({ id: 'void1', evidenceTs: null, promisedAt: '2026-08-01T00:00:00Z', deadline: '2026-08-02T00:00:00Z', status: STATUS.PENDING, quality: null }),
    mkContract({ id: 'ok', type: CONTRACT_TYPE.FORMAL }),
  ];
  const r = hitRate(cs, NOW);
  assert.strictEqual(r.denominator, 1.0, '作废契约不计分母');
  assert.strictEqual(r.rate, 1);
});

test('契约：pending 未到期不计入分母', () => {
  const cs = [
    mkContract({ id: 'future', status: STATUS.PENDING, quality: null, deadline: '2026-12-01T00:00:00Z' }),
    mkContract({ id: 'ok', type: CONTRACT_TYPE.FORMAL }),
  ];
  const r = hitRate(cs, NOW);
  assert.strictEqual(r.denominator, 1.0);
  assert.strictEqual(r.rate, 1);
});

// ---------- 关系复用率 ----------

function mkRef(over = {}) {
  return { id: 'r-1', source: '丙', target: '甲', type: 'strong', mutual: false, date: '2026-09-02', evidence: 'e', ...over };
}

test('复用：自引剔除——自引计入毛分但剔除出净分', () => {
  const refs = [
    mkRef({ id: 'self', source: '甲', target: '甲' }),
    mkRef({ id: 'ext', source: '丙', target: '甲' }),
  ];
  const r = reuse(refs, '甲', NOW);
  assert.strictEqual(r.grossCount, 2);
  assert.strictEqual(r.selfCount, 1);
  assert.strictEqual(r.externalRefers, 1);
  assert.strictEqual(r.net, 1 * Math.pow(0.5, 1 / 90)); // 仅外部引用
});

test('复用：互惠折半——强关联互惠 ×0.5', () => {
  const refs = [mkRef({ mutual: true })];
  const r = reuse(refs, '甲', NOW);
  assert.ok(r.net < 1, '互惠应折半');
  assert.ok(Math.abs(r.net - 0.5 * Math.pow(0.5, 1 / 90)) < 1e-6);
});

test('复用：去重取最强——同 source 多条引用，保留折半后实分最高者', () => {
  const refs = [
    mkRef({ id: 'a', mutual: true }),                 // 0.5
    mkRef({ id: 'b', mutual: false }),                // 1.0 → 保留
    mkRef({ id: 'c', type: 'general', mutual: false }), // 0.6
  ];
  const r = reuse(refs, '甲', NOW);
  assert.strictEqual(r.externalRefers, 1);
  assert.ok(Math.abs(r.net - 1 * Math.pow(0.5, 1 / 90)) < 1e-6, '应保留非互惠 strong');
});

test('复用：90 天半衰——90 天后权重减半', () => {
  const refs = [mkRef({ date: '2026-06-05' })]; // 距今 90 天（2026-06-05 → 2026-09-03）
  const r = reuse(refs, '甲', NOW);
  assert.ok(Math.abs(r.net - 0.5) < 1e-9);
});

test('复用：复用率=净/毛，影子繁荣（大量自引互惠）被压低', () => {
  const refs = [];
  for (let i = 0; i < 10; i++) refs.push(mkRef({ id: `self${i}`, source: '甲', target: '甲' }));
  for (let i = 0; i < 10; i++) refs.push(mkRef({ id: `mut${i}`, source: '乙', target: '甲', mutual: true }));
  refs.push(mkRef({ id: 'real', source: '丙', target: '甲', mutual: false }));
  const r = reuse(refs, '甲', NOW);
  // gross = 10 自引 + 10 互惠 + 1 真实 = 21；net ≈ 1（真实引用，互惠折半后很小被去重）
  assert.ok(r.rate < 0.1, `影子繁荣复用率应极低，实际 ${r.rate}`);
});

test('复用：无引用 → rate null（静默期）', () => {
  const r = reuse([], '甲', NOW);
  assert.strictEqual(r.rate, null);
  assert.strictEqual(r.externalRefers, 0);
});

// ---------- 去刻度呈现 ----------

test('呈现：契约标签边界', () => {
  const { contractLabel } = require('../lib/present.js');
  assert.strictEqual(contractLabel(0.98).label, '契约稳固');
  assert.strictEqual(contractLabel(0.90).label, '信守有度');
  assert.strictEqual(contractLabel(0.80).label, '磨合中');
  assert.strictEqual(contractLabel(0.50).label, '需回看');
  assert.strictEqual(contractLabel(null).label, '无到期契约');
});

test('呈现：复用标签边界与静默期', () => {
  const { reuseLabel } = require('../lib/present.js');
  assert.strictEqual(reuseLabel(0.7, 2).label, '共振渐深');
  assert.strictEqual(reuseLabel(0.5, 2).label, '涟漪初泛');
  assert.strictEqual(reuseLabel(0.2, 2).label, '回声偏重');
  assert.strictEqual(reuseLabel(null, 0).label, '静默期');
  assert.strictEqual(reuseLabel(0.9, 0).label, '静默期', '无外部引用者即静默');
});

test('呈现：基线期不输出趋势箭头（防误导）', () => {
  const c = hitRate([mkContract({ type: CONTRACT_TYPE.FORMAL })], NOW);
  const r = reuse([mkRef()], '甲', NOW);
  const card = presentCard(c, r, { baseline: true });
  assert.strictEqual(card.contract.arrow, '—');
  assert.strictEqual(card.reuse.arrow, '—');
});
