/**
 * GDI 引擎测试 · CSB-AEP v2.3（M1）
 *
 * 组成：
 *   A. MVP 15 条迁移（gdi-mvp/test/gdi-mvp.test.js，只改 require 路径——回归锚点）
 *   B. M1 新增：GdiObserver 多源 merge / observe 集成回归（3 agent 真实源）/ GdiStore 历史 / 域隔离
 *
 * 运行：node --test test/gdi-engine.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ========== 引擎模块（收编后路径） ==========
const { hitRate, CONTRACT_TYPE, STATUS, QUALITY } = require('../server/engine/gdi/contracts.js');
const { reuse } = require('../server/engine/gdi/reuse.js');
const { presentCard, contractLabel, reuseLabel } = require('../server/engine/gdi/present.js');
const { GdiObserver } = require('../server/engine/gdi');
const { GdiStore } = require('../server/store/gdi-store.js');

const NOW = new Date('2026-09-03T00:00:00Z');

// ========== A. MVP 迁移用例（回归锚点，逻辑未改） ==========

function mkContract(over = {}) {
  return {
    id: 't-1', type: CONTRACT_TYPE.LIGHT, promisor: '甲', promisee: '乙',
    promisedAt: '2026-09-01T00:00:00Z', deadline: '2026-09-01T01:00:00Z',
    evidenceTs: '2026-09-01T00:30:00Z',
    status: STATUS.KEPT, quality: QUALITY.COMPLETE,
    ...over,
  };
}

test('A1 契约：全履约 3 连 → 100%，且轻量契约第 3 条自动升格 formal', () => {
  const cs = [1, 2, 3].map(i => mkContract({
    id: `c${i}`, promisedAt: `2026-09-0${i}T00:00:00Z`, deadline: `2026-09-0${i}T01:00:00Z`,
    evidenceTs: `2026-09-0${i}T00:30:00Z`,
  }));
  const r = hitRate(cs, NOW);
  assert.strictEqual(r.rate, 1);
  assert.strictEqual(r.denominator, 2.0);
  assert.ok(r.breakdown.find(b => b.id === 'c3').type.includes('升格'));
});

test('A2 契约：1 条 broken → 命中率按权重扣减并触发失信熔断', () => {
  const cs = [
    mkContract({ id: 'ok', type: CONTRACT_TYPE.FORMAL }),
    mkContract({ id: 'bad', type: CONTRACT_TYPE.FORMAL, status: STATUS.BROKEN, quality: null }),
  ];
  const r = hitRate(cs, NOW);
  assert.strictEqual(r.rate, 0.5);
  assert.strictEqual(r.brokenCount, 1);
  assert.ok(r.fused);
});

test('A3 契约：履约质量计分——complete 高于 onTime', () => {
  const a = hitRate([mkContract({ id: 'a', type: CONTRACT_TYPE.FORMAL, quality: QUALITY.COMPLETE })], NOW);
  const b = hitRate([mkContract({ id: 'b', type: CONTRACT_TYPE.FORMAL, quality: QUALITY.ONTIME })], NOW);
  assert.ok(a.rate > b.rate);
  assert.strictEqual(b.rate, 0.85);
});

test('A4 契约：broken 重置升格连击——第 3 条不升格', () => {
  const cs = [
    mkContract({ id: 'c1', promisedAt: '2026-09-01T00:00:00Z' }),
    mkContract({ id: 'c2', promisedAt: '2026-09-02T00:00:00Z', status: STATUS.BROKEN, quality: null }),
    mkContract({ id: 'c3', promisedAt: '2026-09-03T00:00:00Z' }),
  ];
  const r = hitRate(cs, NOW);
  assert.strictEqual(r.breakdown.find(b => b.id === 'c3').type, 'light');
});

test('A5 契约：轻量契约 48h 无行为印证 → 自动作废，不计入分母', () => {
  const cs = [
    mkContract({ id: 'void1', evidenceTs: null, promisedAt: '2026-08-01T00:00:00Z', deadline: '2026-08-02T00:00:00Z', status: STATUS.PENDING, quality: null }),
    mkContract({ id: 'ok', type: CONTRACT_TYPE.FORMAL }),
  ];
  const r = hitRate(cs, NOW);
  assert.strictEqual(r.denominator, 1.0);
  assert.strictEqual(r.rate, 1);
});

test('A6 契约：pending 未到期不计入分母', () => {
  const cs = [
    mkContract({ id: 'future', status: STATUS.PENDING, quality: null, deadline: '2026-12-01T00:00:00Z' }),
    mkContract({ id: 'ok', type: CONTRACT_TYPE.FORMAL }),
  ];
  const r = hitRate(cs, NOW);
  assert.strictEqual(r.denominator, 1.0);
  assert.strictEqual(r.rate, 1);
});

function mkRef(over = {}) {
  return { id: 'r-1', source: '丙', target: '甲', type: 'strong', mutual: false, date: '2026-09-02', evidence: 'e', ...over };
}

test('A7 复用：自引剔除——自引计入毛分但剔除出净分', () => {
  const refs = [mkRef({ id: 'self', source: '甲', target: '甲' }), mkRef({ id: 'ext', source: '丙', target: '甲' })];
  const r = reuse(refs, '甲', NOW);
  assert.strictEqual(r.grossCount, 2);
  assert.strictEqual(r.selfCount, 1);
  assert.strictEqual(r.externalRefers, 1);
  assert.ok(Math.abs(r.net - 1 * Math.pow(0.5, 1 / 90)) < 1e-9);
});

test('A8 复用：互惠折半——强关联互惠 ×0.5', () => {
  const r = reuse([mkRef({ mutual: true })], '甲', NOW);
  assert.ok(Math.abs(r.net - 0.5 * Math.pow(0.5, 1 / 90)) < 1e-9);
});

test('A9 复用：去重取最强——同 source 多条引用保留折半后实分最高者', () => {
  const refs = [
    mkRef({ id: 'a', mutual: true }),
    mkRef({ id: 'b', mutual: false }),
    mkRef({ id: 'c', type: 'general', mutual: false }),
  ];
  const r = reuse(refs, '甲', NOW);
  assert.strictEqual(r.externalRefers, 1);
  assert.ok(Math.abs(r.net - 1 * Math.pow(0.5, 1 / 90)) < 1e-9);
});

test('A10 复用：90 天半衰——90 天后权重减半', () => {
  const r = reuse([mkRef({ date: '2026-06-05' })], '甲', NOW);
  assert.ok(Math.abs(r.net - 0.5) < 1e-9);
});

test('A11 复用：复用率=净/毛，影子繁荣（大量自引互惠）被压低', () => {
  const refs = [];
  for (let i = 0; i < 10; i++) refs.push(mkRef({ id: `self${i}`, source: '甲', target: '甲' }));
  for (let i = 0; i < 10; i++) refs.push(mkRef({ id: `mut${i}`, source: '乙', target: '甲', mutual: true }));
  refs.push(mkRef({ id: 'real', source: '丙', target: '甲', mutual: false }));
  const r = reuse(refs, '甲', NOW);
  assert.ok(r.rate < 0.1);
});

test('A12 复用：无引用 → rate null（静默期）', () => {
  const r = reuse([], '甲', NOW);
  assert.strictEqual(r.rate, null);
  assert.strictEqual(r.externalRefers, 0);
});

test('A13 呈现：契约标签边界', () => {
  assert.strictEqual(contractLabel(0.98).label, '契约稳固');
  assert.strictEqual(contractLabel(0.90).label, '信守有度');
  assert.strictEqual(contractLabel(0.80).label, '磨合中');
  assert.strictEqual(contractLabel(0.50).label, '需回看');
  assert.strictEqual(contractLabel(null).label, '无到期契约');
});

test('A14 呈现：复用标签边界与静默期', () => {
  assert.strictEqual(reuseLabel(0.7, 2).label, '共振渐深');
  assert.strictEqual(reuseLabel(0.5, 2).label, '涟漪初泛');
  assert.strictEqual(reuseLabel(0.2, 2).label, '回声偏重');
  assert.strictEqual(reuseLabel(null, 0).label, '静默期');
  assert.strictEqual(reuseLabel(0.9, 0).label, '静默期');
});

test('A15 呈现：基线期不输出趋势箭头（防误导）', () => {
  const c = hitRate([mkContract({ type: CONTRACT_TYPE.FORMAL })], NOW);
  const v = { rate: null, reason: 'no_audit_source' };
  const r = reuse([mkRef()], '甲', NOW);
  const comp = { score: 0.8, covered: ['contract', 'reuse'] };
  const card = presentCard(c, v, r, comp, { baseline: true });
  assert.strictEqual(card.contract.arrow, '—');
  assert.strictEqual(card.reuse.arrow, '—');
  assert.strictEqual(card.composite.arrow, '—');
});

// ========== C. M2 新增 ==========

const { verifyRate, verifyChain, canonicalContent } = require('../server/engine/gdi/verify.js');
const { normalize, verifiableScore, calibrate } = require('../server/engine/gdi/self-report.js');
const { verifyLabel, compositeLabel, signSlice, verifySlice, buildSlices } = require('../server/engine/gdi/present.js');

function mkAuditEntry(over = {}) {
  return {
    seq: 1, timestamp: '2026-09-02T00:00:00.000Z', event_type: 'verify',
    caller_id: '乙', callee_id: '甲', user_id: null,
    scopes_requested: [], scopes_granted: [], scopes_denied: [],
    trust_level: 2, session_id: null, ip_address: null, result: 'success',
    prev_hash: 'GENESIS', hash: 'x', ...over,
  };
}

/** 构造一串哈希链合法的审计记录（与 csb-security 同算法） */
function buildChain(entries) {
  let prev = 'GENESIS';
  return entries.map((e, i) => {
    const rec = { ...e, seq: i + 1, prev_hash: prev };
    delete rec.hash;
    const content = canonicalContent(rec);
    const crypto = require('crypto');
    rec.hash = crypto.createHash('sha256').update(content).digest('hex');
    prev = rec.hash;
    return rec;
  });
}

function writeAuditSource(dir, entries) {
  fs.mkdirSync(path.join(dir, 'audit'), { recursive: true });
  const file = path.join(dir, 'audit', 'test-audit.jsonl');
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

test('C1 verify：链有效时通过率按 callee 视角计算', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdi-verify-'));
  const entries = buildChain([
    mkAuditEntry({ event_type: 'verify', result: 'success' }),
    mkAuditEntry({ event_type: 'verify', result: 'success' }),
    mkAuditEntry({ event_type: 'handshake', result: 'denied' }),
  ]);
  writeAuditSource(dir, entries);
  const r = verifyRate(path.join(dir, 'audit'), '甲');
  assert.strictEqual(r.chainValid, true);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.passed, 2);
  assert.ok(Math.abs(r.rate - 2 / 3) < 1e-9);
  assert.strictEqual(r.calleeView, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('C2 verify：篡改必检出——改一条记录 → chain_invalid（数据不可信，不给分）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdi-verify-'));
  const entries = buildChain([
    mkAuditEntry({ result: 'success' }),
    mkAuditEntry({ result: 'success' }),
  ]);
  // 篡改第一条的 result（不重算 hash）
  entries[0] = { ...entries[0], result: 'denied' };
  writeAuditSource(dir, entries);
  const chain = verifyChain(entries);
  assert.strictEqual(chain.valid, false);
  const r = verifyRate(path.join(dir, 'audit'), '甲');
  assert.strictEqual(r.rate, null);
  assert.ok(r.reason.includes('chain_invalid') || r.reason.includes('entry_tampered'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('C3 verify：无审计源 → rate null + no_audit_source（诚实 N/A 不硬凑分）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdi-verify-'));
  const r = verifyRate(path.join(dir, 'audit'), '甲');
  assert.strictEqual(r.rate, null);
  assert.strictEqual(r.reason, 'no_audit_source');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('C4 自评：差异过大触发校准提醒（非惩罚）', () => {
  const dims = { contract: { rate: 0.5 }, verify: { rate: null }, reuse: { rate: null } };
  const weights = { contract: 0.4, verify: 0.3, reuse: 0.2 };
  const comp = verifiableScore(dims, weights);
  assert.strictEqual(comp.score, 0.5);
  assert.deepStrictEqual(comp.covered, ['contract']);
  const cal = calibrate(9, comp); // 自评 9/10 vs 可核实 0.5
  assert.strictEqual(cal.alert, true);
  assert.ok(cal.message.includes('校准提醒'));
});

test('C5 自评：差异小不提醒', () => {
  const comp = { score: 0.8, covered: ['contract', 'reuse'] };
  const cal = calibrate(8, comp);
  assert.strictEqual(cal.alert, false);
  assert.strictEqual(cal.message, null);
});

test('C6 verifiableScore：部分维 null 时按可用权重归一化', () => {
  const weights = { contract: 0.4, verify: 0.3, reuse: 0.2 };
  // 只有 verify 可用
  const comp = verifiableScore({ contract: { rate: null }, verify: { rate: 1 }, reuse: { rate: null } }, weights);
  assert.strictEqual(comp.score, 1);
  assert.deepStrictEqual(comp.covered, ['verify']);
  // 全 null
  const none = verifiableScore({ contract: { rate: null }, verify: { rate: null }, reuse: { rate: null } }, weights);
  assert.strictEqual(none.score, null);
});

test('C7 权重焊死：config 40/30/20/10 + 自评 ≤20% 红线', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'defaults.json'), 'utf8'));
  const w = cfg.gdi.weights;
  assert.strictEqual(w.contract, 0.4);
  assert.strictEqual(w.verify, 0.3);
  assert.strictEqual(w.reuse, 0.2);
  assert.strictEqual(w.selfReport, 0.1);
  assert.ok(w.selfReport <= cfg.gdi.selfReportWeightCap, '自报维度合计 ≤20% 红线');
  assert.ok(cfg.gdi.calibration.weightFloor >= 0.05, '权重衰减底线 5%');
});

test('C8 预签名切片：验真通过 / 错误密钥失败 / 篡改失败', () => {
  const slice = signSlice('secret-1', { agent: '甲', dim: 'contract', label: '契约稳固', arrow: '—', ts: '2026-09-03T00:00:00Z' });
  assert.ok(verifySlice('secret-1', slice, '甲'));
  assert.ok(!verifySlice('secret-2', slice, '甲'));
  assert.ok(!verifySlice('secret-1', { ...slice, arrow: '↑' }, '甲'));
  const slices = buildSlices('secret-1', '甲', {
    composite: { label: '健康生长', arrow: '—' },
    contract: { label: '契约稳固', arrow: '—' },
    verify: { label: '数据不足', arrow: '—' },
    reuse: { label: '涟漪初泛', arrow: '—' },
  }, '2026-09-03T00:00:00Z');
  assert.strictEqual(slices.length, 4);
  assert.ok(slices.every(s => verifySlice('secret-1', s, '甲')));
});

test('C9 呈现：verify/composite 标签边界', () => {
  assert.strictEqual(verifyLabel(0.98).label, '验证可信');
  assert.strictEqual(verifyLabel(0.9).label, '基本可信');
  assert.strictEqual(verifyLabel(0.75).label, '波动中');
  assert.strictEqual(verifyLabel(0.5).label, '需关注');
  assert.strictEqual(verifyLabel(null).label, '数据不足');
  assert.strictEqual(compositeLabel(0.95).label, '整体稳固');
  assert.strictEqual(compositeLabel(0.8).label, '健康生长');
  assert.strictEqual(compositeLabel(0.65).label, '磨合中');
  assert.strictEqual(compositeLabel(null).label, '数据不足');
});

test('C10 observe 集成：真实源无 audit 数据 → verify 诚实 N/A（不硬凑分）', () => {
  const observer = new GdiObserver();
  const obs = observer.observe('墨丘', { now: NOW });
  assert.strictEqual(obs.dimensions.verify.rate, null);
  assert.strictEqual(obs.dimensions.verify.reason, 'no_audit_source');
  assert.strictEqual(obs.present.verify.label, '数据不足');
  // composite 只用可用维归一化（contract+reuse → 按 0.4/0.2 归一）
  assert.ok(Math.abs(obs.dimensions.composite.score - (0.4 * 1 + 0.2 * 0.4936) / 0.6) < 0.01);
  assert.deepStrictEqual(obs.dimensions.composite.covered.sort(), ['contract', 'reuse']);
});

test('C11 observe 集成：自评校准出现在观测中（不落盘分数）', () => {
  const observer = new GdiObserver();
  const obs = observer.observe('墨丘', { now: NOW, selfReport10: 3 }); // 可核实 ~0.83，自评 0.3 → 差异 0.53
  assert.ok(obs.calibration, '应有校准结果');
  assert.strictEqual(obs.calibration.alert, true, '自评 3 与可核实 ~0.83 差异应提醒');
  const json = JSON.stringify(obs);
  assert.ok(!json.includes('selfReport10'), '自评分不落盘（L3）');
});

// B1 集成回归：真实源数据（data/gdi/sources/）对 3 agent 的观测结果与 MVP 快照一致
test('B1 observe 集成回归：墨丘/舟楫/星尘 结果与 MVP 快照一致（契约 100% · 复用 49.4/49.4/49.6）', () => {
  const observer = new GdiObserver(); // 默认读 data/gdi/sources/
  const expect = {
    '墨丘': { contract: 1, reuse: 0.494 },
    '舟楫': { contract: 1, reuse: 0.494 },
    '星尘': { contract: 1, reuse: 0.496 },
  };
  for (const [agent, exp] of Object.entries(expect)) {
    const obs = observer.observe(agent, { now: NOW });
    assert.strictEqual(obs.dimensions.contract.rate, exp.contract, `${agent} 契约命中率`);
    assert.ok(Math.abs(obs.dimensions.reuse.rate - exp.reuse) < 0.002, `${agent} 复用率实际 ${obs.dimensions.reuse.rate}`);
    assert.strictEqual(obs.dimensions.contract.kept, 3, `${agent} 3 条履约`);
    assert.ok(obs.present.contract.label, '契约稳固');
  }
});

test('B2 observe 集成：星尘净复用分含非互惠论坛引用（net ≈ 1.49 > 墨丘 0.99）', () => {
  const observer = new GdiObserver();
  const xc = observer.observe('星尘', { now: NOW });
  const mq = observer.observe('墨丘', { now: NOW });
  assert.ok(xc.dimensions.reuse.net > mq.dimensions.reuse.net);
  assert.ok(Math.abs(xc.dimensions.reuse.net - 1.4878) < 0.01);
});

test('B3 observe：未知 agent → 无到期契约（rate null）与静默期标签', () => {
  const observer = new GdiObserver();
  const obs = observer.observe('不存在的Agent', { now: NOW });
  assert.strictEqual(obs.dimensions.contract.rate, null);
  assert.strictEqual(obs.dimensions.reuse.rate, null);
  assert.strictEqual(obs.present.reuse.label, '静默期');
});

test('B4 多源 merge：重复 id 只保留一份（防重复计数）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdi-src-'));
  fs.mkdirSync(path.join(dir, 'contracts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
  const base = { id: 'dup-1', type: 'formal', promisor: '甲', promisee: '乙', promisedAt: '2026-09-01T00:00:00Z', deadline: '2026-09-01T01:00:00Z', status: 'kept', quality: 'complete' };
  fs.writeFileSync(path.join(dir, 'contracts', 'a.json'), JSON.stringify({ contracts: [base] }));
  fs.writeFileSync(path.join(dir, 'contracts', 'b.json'), JSON.stringify({ contracts: [{ ...base, id: 'dup-1' }, { ...base, id: 'dup-2', promisor: '丙' }] }));
  fs.writeFileSync(path.join(dir, 'references', 'r.json'), JSON.stringify({ references: [{ id: 'ref-1', source: '乙', target: '甲', type: 'strong', mutual: false, date: '2026-09-02' }] }));
  const observer = new GdiObserver({ sourcesDir: dir });
  const contracts = observer.loadContracts();
  assert.strictEqual(contracts.length, 2, 'dup-1 只保留一份');
  const refs = observer.loadReferences();
  assert.strictEqual(refs.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B5 GdiStore：观测记录持久化 + latest + history（趋势数据积累）', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gdi-store-')), 'gdi-store.json');
  const store = new GdiStore(file);
  store.saveObservation({ agent: '甲', observedAt: '2026-09-01T00:00:00Z', requester: 'human', dimensions: { contract: { rate: 0.5 }, reuse: { rate: 0.2 } }, present: {} });
  store.saveObservation({ agent: '甲', observedAt: '2026-09-03T00:00:00Z', requester: 'human', dimensions: { contract: { rate: 1.0 }, reuse: { rate: 0.49 } }, present: {} });
  store.saveObservation({ agent: '乙', observedAt: '2026-09-03T00:00:00Z', requester: 'human', dimensions: {}, present: {} });
  assert.strictEqual(store.history('甲').length, 2);
  assert.strictEqual(store.latest('甲').dimensions.contract.rate, 1.0);
  assert.strictEqual(store.latest('乙').agent, '乙');
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('B6 域隔离：GdiStore 默认落盘 data/gdi/（独立于评测 data/eval-results）', () => {
  const store = new GdiStore();
  assert.ok(store.file.includes(path.join('data', 'gdi')), `store 文件应在 data/gdi/ 下，实际 ${store.file}`);
  assert.ok(!store.file.includes('eval'), '不得写入评测域');
  const observer = new GdiObserver();
  assert.ok(observer.sourcesDir.includes(path.join('data', 'gdi', 'sources')));
});

test('B7 域隔离：GDI 响应不含评测域字段（present 无刻度、dimensions 无 eval 痕迹）', () => {
  const observer = new GdiObserver();
  const obs = observer.observe('墨丘', { now: NOW });
  const json = JSON.stringify(obs);
  assert.ok(!json.includes('blackbox') && !json.includes('whitebox'), 'GDI 观测不得引用评测引擎概念');
  const { cleanPresent } = require('../server/api/gdi.js');
  const cleaned = cleanPresent(obs.present);
  for (const dim of ['composite', 'contract', 'verify', 'reuse']) {
    assert.ok(cleaned[dim], `${dim} 应在呈现卡中`);
    assert.ok(!('value' in cleaned[dim]) && !('rate' in cleaned[dim]), `${dim} 净化后无原始分值`);
    assert.ok(cleaned[dim].label, `${dim} 有质性标签`);
  }
  // 预签名切片存在且可验真
  assert.ok(obs.slices.length >= 4, '应有 ≥4 维切片');
  const { verifySlice } = require('../server/engine/gdi/present.js');
  const s0 = obs.slices[0];
  assert.ok(verifySlice(observer.secret, s0, '墨丘'), '切片签名可验真');
  assert.ok(!verifySlice('wrong-secret', s0, '墨丘'), '错误密钥验签失败');
  assert.ok(!verifySlice(observer.secret, { ...s0, label: '篡改' }, '墨丘'), '篡改切片验签失败');
});
