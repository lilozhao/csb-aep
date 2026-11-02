/**
 * P1-4 判据变更即作废 —— 判据测试
 *
 * 这个模块最容易写错的地方不是"能不能算出哈希"，而是**取哪批字段算**。
 * 所以测试的重点全在边界上：
 *   ① 运行时状态变化 → 指纹**必须不变**（否则每天假作废）
 *   ② 判据变化 → 指纹**必须变**（否则假绿）
 *   ③ 没指纹的老报告 → unknown，**不许当作可用**
 *   ④ 作废必须说清哪一条变了（字段级 diff）
 *   ⑤ 白名单漏字段时能被测试发现
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const C = require('../server/engine/criteria');

// ── 基线判据样本（刻意接近 compliance config 的真实形状）─────────
const base = () => ({
  config_version: '1',
  dimensions: { empathy: 80, opinion_compliance: 50, flattery: 0 },
  limits: { fact: '不可违背', safety: '不可违背' },
  modes: { independent: [0, 30], balanced: [31, 70], compliant: [71, 100] },
  words: { agreement: ['是的', '同意'], questioning: ['但是'] },
  statistics: { total_conversations: 4, agreement_count: 3 },
  updated: '2026-04-08',
});

// ── ① 运行时状态不算判据 ─────────────────────────────────────
test('statistics 变化 → 指纹不变（否则每天假作废）', () => {
  const a = base();
  const b = { ...base(), statistics: { total_conversations: 999, agreement_count: 500 } };
  assert.strictEqual(C.fingerprint(a).hash, C.fingerprint(b).hash);
});

test('updated / created 时间戳变化 → 指纹不变', () => {
  const a = base();
  const b = { ...base(), updated: '2026-12-31', created: '2020-01-01' };
  assert.strictEqual(C.fingerprint(a).hash, C.fingerprint(b).hash);
});

test('未在白名单里的新字段默认不计入（白名单语义）', () => {
  const a = base();
  const b = { ...base(), some_future_state_field: 'x' };
  assert.strictEqual(C.fingerprint(a).hash, C.fingerprint(b).hash);
});

// ── ② 判据变化必须被抓住 ─────────────────────────────────────
test('词表加词 → 指纹变（词表就是判据）', () => {
  const b = base();
  b.words.agreement.push('说得对');
  assert.notStrictEqual(C.fingerprint(base()).hash, C.fingerprint(b).hash);
});

test('权重变化 → 指纹变', () => {
  const a = { weights: { a1: 10, a2: 20 } };
  const b = { weights: { a1: 10, a2: 25 } };
  assert.notStrictEqual(C.fingerprint(a).hash, C.fingerprint(b).hash);
});

test('阈值变化 → 指纹变', () => {
  assert.notStrictEqual(
    C.fingerprint({ thresholds: { minCoverage: 0.6 } }).hash,
    C.fingerprint({ thresholds: { minCoverage: 0.7 } }).hash
  );
});

test('config_version 变化 → 指纹变（版本号本身也是判据）', () => {
  const a = base();
  const b = { ...base(), config_version: '2' };
  assert.notStrictEqual(C.fingerprint(a).hash, C.fingerprint(b).hash);
});

test('mode/standard/policyVersion 变化 → 指纹变（口径不同结论不可比）', () => {
  const a = { mode: 'both', standard: 'a2a-v0.6' };
  const b = { mode: 'blackbox', standard: 'a2a-v0.6' };
  assert.notStrictEqual(C.fingerprint(a).hash, C.fingerprint(b).hash);
});

// ── ③ 指纹稳定性 ─────────────────────────────────────────────
test('同内容不同键序 → 同指纹（键序不该影响判据）', () => {
  const a = { words: { agreement: ['是的'], questioning: ['但是'] }, config_version: '1' };
  const b = { config_version: '1', words: { questioning: ['但是'], agreement: ['是的'] } };
  assert.strictEqual(C.fingerprint(a).hash, C.fingerprint(b).hash);
});

test('指纹格式固定（crit_ + 16 hex），且不含状态字段', () => {
  const fp = C.fingerprint(base());
  assert.match(fp.hash, /^crit_[0-9a-f]{16}$/);
  assert.ok(!fp.fields.includes('statistics'), 'statistics 混进了判据字段');
});

// ── ④ 复用闸门 ───────────────────────────────────────────────
test('判据一致 → reusable', () => {
  const cur = base();
  const report = { criteria: C.snapshot(cur) };
  const r = C.checkReusable(report, cur);
  assert.strictEqual(r.status, C.REUSE.REUSABLE);
  assert.strictEqual(r.reusable, true);
});

test('判据变了 → stale，且 diff 指出具体字段', () => {
  const before = base();
  const report = { criteria: C.snapshot(before) };
  const after = base();
  after.words.agreement.push('太好了');
  const r = C.checkReusable(report, after);
  assert.strictEqual(r.status, C.REUSE.STALE);
  assert.strictEqual(r.reusable, false);
  assert.ok(r.diff.some((d) => d.path === 'words.agreement'), `diff 未指出词表变化：${JSON.stringify(r.diff)}`);
});

test('老报告没判据指纹 → unknown，不许当可用（P1-4 之前的报告）', () => {
  const r = C.checkReusable({ score: 82, results: [] }, base());
  assert.strictEqual(r.status, C.REUSE.UNKNOWN);
  assert.strictEqual(r.reusable, false);
  assert.ok(r.reason.includes('不得复用'));
});

test('只有 chrn_ 的老回执 → 能比对但定位不到具体字段（诚实降级）', () => {
  const r = C.checkReusable({ chrn_: 'chrn_aaaaaaaaaaaaaaaa' }, base());
  assert.strictEqual(r.status, C.REUSE.STALE);
  assert.deepStrictEqual(r.diff, []);
  assert.ok(r.reason.includes('缺少快照'));
});

test('仅统计字段变化，旧报告仍可复用（这是关键：不假作废）', () => {
  const report = { criteria: C.snapshot(base()) };
  const after = base();
  after.statistics.total_conversations = 1000;
  after.updated = '2027-01-01';
  const r = C.checkReusable(report, after);
  assert.strictEqual(r.status, C.REUSE.REUSABLE, '运行时状态变化不该作废报告');
});

// ── ⑤ diff 细节 ──────────────────────────────────────────────
test('diff 能区分 added / removed / changed', () => {
  const before = { words: { a: ['x'] }, thresholds: { t: 1 } };
  const after = { words: { a: ['x', 'y'] }, limits: { l: 'z' } };
  const d = C.diffCriteria(before, after);
  assert.ok(d.some((x) => x.path === 'words.a' && x.kind === 'changed'));
  assert.ok(d.some((x) => x.path === 'limits.l' && x.kind === 'added'));
  assert.ok(d.some((x) => x.path === 'thresholds.t' && x.kind === 'removed'));
});

// ── ⑥ 真实接线：报告里必须有 criteria，且能过复用判定 ─────────
test('AEP 报告带 criteria 快照，且能通过复用判定', () => {
  const { buildReportReceipt } = require('../server/api/eval.js');
  const { OpenClawAdapter } = require('../server/adapter/openclaw.js');
  const report = { score: 80, results: [{ id: 'a1', weight: 10, score: 90, pass: true }] };
  buildReportReceipt(report, { mode: 'both', adapter: new OpenClawAdapter(), evalResult: report, whiteboxResult: null, req: { body: {} } });

  assert.ok(report.criteria, 'report.criteria 缺失 —— 判据快照没落库');
  assert.match(report.criteria.hash, /^crit_[0-9a-f]{16}$/);
  assert.ok(report.criteria.snapshot, '只有 hash 没有快照，将来无法定位差异');

  // 用同一份判据再判一次 → 应该 reusable
  const same = { ...report.criteria.snapshot };
  assert.strictEqual(C.checkReusable(report, same).status, C.REUSE.REUSABLE);
});

test('权重变化后，用旧报告判定 → stale', () => {
  const { buildReportReceipt } = require('../server/api/eval.js');
  const { OpenClawAdapter } = require('../server/adapter/openclaw.js');
  const report = { score: 80, results: [{ id: 'a1', weight: 10, score: 90, pass: true }] };
  buildReportReceipt(report, { mode: 'both', adapter: new OpenClawAdapter(), evalResult: report, whiteboxResult: null, req: { body: {} } });

  const changed = { ...report.criteria.snapshot, weights: { a1: 99 } };
  const r = C.checkReusable(report, changed);
  assert.strictEqual(r.status, C.REUSE.STALE);
  assert.ok(r.diff.some((d) => d.path === 'weights.a1'));
});

// ── ⑦ ResultsStore 接线 ──────────────────────────────────────
test('ResultsStore.getLatestWithReuseCheck：无历史 → unknown 且说明原因', async () => {
  const { ResultsStore } = require('../server/store/results.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-store-'));
  const store = new ResultsStore(dir);
  await store.init();
  const r = await store.getLatestWithReuseCheck(base());
  assert.strictEqual(r.report, null);
  assert.strictEqual(r.reuse.status, C.REUSE.UNKNOWN);
  assert.ok(r.reuse.reason.includes('没有历史结果'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ResultsStore：存过的报告能按判据判定复用', async () => {
  const { ResultsStore } = require('../server/store/results.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-store-'));
  const store = new ResultsStore(dir);
  await store.init();
  const cur = base();
  await store.add({ agentUrl: 'http://x', score: 80, criteria: C.snapshot(cur) });

  const same = await store.getLatestWithReuseCheck(cur);
  assert.strictEqual(same.reuse.status, C.REUSE.REUSABLE);

  const changed = base();
  changed.words.agreement.push('新词');
  const stale = await store.getLatestWithReuseCheck(changed);
  assert.strictEqual(stale.reuse.status, C.REUSE.STALE);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── ⑧ 白名单自检：新增判据字段必须同步白名单 ─────────────────
test('判据字段清单与 STATE 字段不重叠（分类不含糊）', () => {
  const overlap = C.CRITERIA_FIELDS.filter((f) => C.STATE_FIELDS.includes(f));
  assert.deepStrictEqual(overlap, [], `同名字段既是判据又是状态：${overlap.join(',')}`);
});

test('compliance config 的 config_hash 与实算一致（防手改忘更新）', () => {
  const cfgPath = path.join(__dirname, '..', '..', 'csb-compliance-degree', 'config.json');
  if (!fs.existsSync(cfgPath)) return;  // 独立仓场景下跳过
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(cfg.config_hash, 'config.json 缺 config_hash');
  assert.strictEqual(
    cfg.config_hash,
    C.fingerprint(cfg).hash,
    'config_hash 与实算不一致 —— 改了判据忘了跑 scripts/criteria-check.js --fix'
  );
});

// ── ⑨ 列表接口必须标出「过期」与「没指纹」，不许都显示成正常 ──
test('listEval 输出带 criteriaHash / untracked / policyStale', async () => {
  const { EvalAPI } = require('../server/api/eval.js');
  const api = Object.create(EvalAPI.prototype);
  const cur = { hash: 'crit_0123456789abcdef', version: 'aep-OLD/both' };
  api.store = {
    getLatest: async () => ([
      { id: 'old', score: 82, mode: 'both', criteria: cur },                       // 口径过期
      { id: 'no-criteria', score: 70, mode: 'both' },                              // 老报告，无指纹
    ]),
  };
  const got = await new Promise((resolve) => {
    api.listEval({ url: '/api/eval/list', headers: { host: 'x' } }, { json: resolve });
  });
  const byId = Object.fromEntries(got.map((r) => [r.id, r]));
  assert.strictEqual(byId['old'].criteriaHash, cur.hash);
  assert.strictEqual(byId['old'].policyStale, true, '旧口径版本未标为过期');
  assert.strictEqual(byId['no-criteria'].untracked, true, '无指纹报告未标 untracked');
  assert.strictEqual(byId['no-criteria'].criteriaHash, null);
});
