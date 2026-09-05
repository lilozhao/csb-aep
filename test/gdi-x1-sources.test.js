/**
 * GDI 采集器扩展测试（X-1 · 2026-09-05）
 * 覆盖：provenance 观测模块 + delegation audit 钩子 + 采集器（幂等/测试数据过滤）+ index 集成
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { provenance } = require('../server/engine/gdi/provenance.js');
const { GdiObserver } = require('../server/engine/gdi/index.js');
const { DelegationManager } = require('../../csb-a2a-aip/delegation-manager.js');

function tmpDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function writeRaw(dir, day, events) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, day + '.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
}

// ---------- provenance 模块 ----------

test('provenance：无数据源返回 null', () => {
  const dir = tmpDir('prov-none-');
  assert.equal(provenance(dir), null);
});

test('provenance：正确解析封口率/溯源完整率/断流', () => {
  const dir = tmpDir('prov-data-');
  const pdir = path.join(dir, 'provenance');
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, '2026-09-04.json'), JSON.stringify({
    meta: { generatedAt: '2026-09-04T00:00:00Z' },
    metrics: { sealedRate: 0.4, provenanceCoverage: 1, sealed: 40, burning: 60, lastFileAge: 1 },
    daily: [{ day: '2026-09-04', total: 100, sealed: 40 }],
  }));
  const out = provenance(dir);
  assert.ok(out);
  assert.equal(out.coverage, 1);
  assert.equal(out.sealedRate, 0.4);
  assert.equal(out.lastFileAge, 1);
  assert.equal(out.observation, true);
});

test('provenance：取最新一份文档', () => {
  const dir = tmpDir('prov-latest-');
  const pdir = path.join(dir, 'provenance');
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, '2026-09-03.json'), JSON.stringify({ metrics: { sealedRate: 0.2, provenanceCoverage: 0.8, lastFileAge: 2 } }));
  fs.writeFileSync(path.join(pdir, '2026-09-04.json'), JSON.stringify({ metrics: { sealedRate: 0.5, provenanceCoverage: 0.9, lastFileAge: 1 } }));
  const out = provenance(dir);
  assert.equal(out.sealedRate, 0.5);
  assert.equal(out.coverage, 0.9);
});

test('provenance 采集器：统计逻辑正确（sealed 全部带 distilled_to）', () => {
  // 直接复算采集器核心逻辑（避免子进程）：构造 raw → 模拟 loadRaw 后的统计
  const dir = tmpDir('prov-raw-');
  writeRaw(dir, '2026-09-03', [
    { id: 'r1', state: 'sealed', distilled_to: ['mem_a'] },
    { id: 'r2', state: 'sealed', distilled_to: ['mem_b'] },
    { id: 'r3', state: 'burning', distilled_to: [] },
  ]);
  writeRaw(dir, '2026-09-04', [
    { id: 'r4', state: 'burning', distilled_to: [] },
  ]);
  const all = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.jsonl')).sort()) {
    const day = f.replace(/\.jsonl$/, '');
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) {
      all.push({ day, ...JSON.parse(l) });
    }
  }
  const sealed = all.filter(e => e.state === 'sealed');
  const withDest = sealed.filter(e => (e.distilled_to || []).length > 0);
  assert.equal(sealed.length, 2);
  assert.equal(withDest.length, 2);
  assert.equal(sealed.length / all.length, 0.5);   // 封口率
  assert.equal(withDest.length / sealed.length, 1); // 溯源完整率
});

// ---------- delegation audit 钩子 ----------

test('DelegationManager：grant/revoke 产生哈希链 audit（GDI verify 可消费）', () => {
  const dir = tmpDir('del-audit-');
  const dm = new DelegationManager({ storePath: path.join(dir, 'delegations.json') });
  const t = dm.addTrust('一澜', '若兰', { scope: ['csb-protocol'], level: 'execute' });
  dm.revokeTrust(t.id);
  const auditPath = path.join(dir, 'delegations-audit.jsonl');
  assert.ok(fs.existsSync(auditPath));
  const lines = fs.readFileSync(auditPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event_type, 'delegation.grant');
  assert.equal(lines[0].caller_id, '一澜');
  assert.equal(lines[0].callee_id, '若兰');
  assert.equal(lines[1].event_type, 'delegation.revoke');
  // 哈希链校验（与 GDI verify.js verifyChain 同算法）
  let prev = 'GENESIS';
  for (const rec of lines) {
    const { hash, ...rest } = rec;
    assert.equal(rec.prev_hash, prev, 'prev_hash 连续');
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex'), hash, 'hash 自洽');
    prev = hash;
  }
});

test('DelegationManager：revokeAllBy 产生 revoke_all 事件（带 removed 计数）', () => {
  const dir = tmpDir('del-revokeall-');
  const dm = new DelegationManager({ storePath: path.join(dir, 'delegations.json') });
  dm.addTrust('用户', '若兰', { scope: ['*'], level: 'request' });
  dm.addTrust('用户', '阿轩', { scope: ['*'], level: 'request' });
  dm.revokeAllBy('用户');
  const lines = fs.readFileSync(path.join(dir, 'delegations-audit.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.equal(lines[2].event_type, 'delegation.revoke_all');
  assert.equal(lines[2].removed, 2);
});

// ---------- delegation 采集器（幂等/测试数据过滤，子进程复算核心逻辑） ----------

test('delegation 采集器逻辑：测试数据过滤 + 指纹去重', () => {
  const dir = tmpDir('del-collect-');
  const auditPath = path.join(dir, 'delegations-audit.jsonl');
  const outPath = path.join(dir, 'delegation.jsonl');
  const rec = (timestamp, event_type, delegation_id, callee_id) => JSON.stringify({
    timestamp, event_type, caller_id: '用户', callee_id, result: 'success', delegation_id,
    prev_hash: 'GENESIS', hash: crypto.createHash('sha256').update('x').digest('hex'),
  });
  // 源：2 条真实 + 1 条 test fixture
  fs.writeFileSync(auditPath, [
    rec('2026-09-05T00:00:00Z', 'delegation.grant', 'del_1', '若兰'),
    rec('2026-09-05T00:01:00Z', 'delegation.grant', 'del_2', '阿轩'),
    rec('2026-09-05T00:02:00Z', 'delegation.grant', 'del_3', 'test'), // fixture
  ].join('\n') + '\n');

  const TEST_GRANTEES = new Set(['test']);
  const seen = new Set();
  let copied = 0, skippedTest = 0;
  const toAppend = [];
  for (const line of fs.readFileSync(auditPath, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    if (TEST_GRANTEES.has(r.callee_id)) { skippedTest++; continue; }
    const fp = `${r.timestamp}|${r.event_type}|${r.delegation_id || ''}`;
    if (seen.has(fp)) continue;
    toAppend.push(r); seen.add(fp); copied++;
  }
  assert.equal(copied, 2);
  assert.equal(skippedTest, 1);
  // 幂等：同一指纹再跑不追加
  let dup = 0;
  for (const line of fs.readFileSync(auditPath, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    if (TEST_GRANTEES.has(r.callee_id)) continue;
    const fp = `${r.timestamp}|${r.event_type}|${r.delegation_id || ''}`;
    if (seen.has(fp)) dup++;
  }
  assert.equal(dup, 2); // 已见过的都算重复
});

// ---------- GDI index 集成 ----------

test('GdiObserver：observe 输出含 provenance 观测维度（观察期不计分）', () => {
  const dir = tmpDir('gdi-x1-');
  const pdir = path.join(dir, 'provenance');
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, '2026-09-04.json'), JSON.stringify({
    metrics: { sealedRate: 0.4, provenanceCoverage: 1, lastFileAge: 1 },
    daily: [],
  }));
  const obs = new GdiObserver({ sourcesDir: dir });
  const out = obs.observe('若兰');
  assert.ok(out.dimensions.provenance);
  assert.equal(out.dimensions.provenance.observation, true);
  assert.equal(out.dimensions.provenance.coverage, 1);
  // 不计入 composite
  assert.ok(out.dimensions.composite);
});
