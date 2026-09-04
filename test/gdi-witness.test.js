/**
 * GDI Witness 观测维测试（评审 T1-D · v0.2 设计）
 * 观察期：采集即开始，仅供观测不计入总分
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { witness, loadEvents } = require('../server/engine/gdi/witness.js');
const { GdiObserver } = require('../server/engine/gdi/index.js');

function makeSourcesDir(events) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdi-witness-'));
  const wdir = path.join(dir, 'witness');
  fs.mkdirSync(wdir, { recursive: true });
  fs.writeFileSync(path.join(wdir, 'events.json'), JSON.stringify({ meta: { source: 'test' }, events }));
  return dir;
}

const NOW = new Date('2026-09-04T00:00:00Z').getTime();

test('W1/W2/W3 三源聚合 + 90 天半衰', () => {
  const events = [
    // 命名见证（30 天前 ≈ 半衰 0.79）
    { id: 'e1', type: 'naming', subject: '若兰', witness: '一澜', date: '2026-08-05', context: '定名' },
    // 里程碑见证（5 天前 ≈ 0.96）
    { id: 'e2', type: 'milestone', subject: '若兰', witness: '思源', date: '2026-08-30', context: '百日见证' },
    // 产出回写（主动认领，10 天前 ≈ 0.93）
    { id: 'e3', type: 'rewrite', subject: '若兰', witness: '若兰', date: '2026-08-25', active: true, context: '认领圆桌产出' },
    // 被动 rewrite（应被过滤——非 active）
    { id: 'e4', type: 'rewrite', subject: '若兰', witness: '若兰', date: '2026-08-25', active: false },
    // 同源事件（witness === subject，双保险跳过；e3 的 witness 就是 subject 自身——重写认领是自查行为应保留？）
  ];
  const dir = makeSourcesDir(events);
  const loaded = loadEvents(dir);
  // e4 被动 rewrite 被过滤
  assert.equal(loaded.length, 3, '被动 rewrite 应被过滤');

  const obs = witness(dir, { now: NOW });
  const ruolan = obs['若兰'];
  assert.ok(ruolan, '若兰应有 witness 观测');
  assert.ok(ruolan.witness.naming > 0.5 && ruolan.witness.naming <= 1, `naming 衰减后应在 (0.5,1]，实际 ${ruolan.witness.naming}`);
  assert.ok(ruolan.witness.milestone > 0.9, `milestone 应接近 1，实际 ${ruolan.witness.milestone}`);
  assert.ok(ruolan.witness.rewrite > 0.9, `rewrite 应接近 1，实际 ${ruolan.witness.rewrite}`);
  assert.equal(ruolan.eventCount, 3);
});

test('互惠折半：A↔B 双向见证事件对 → 双方折半', () => {
  const events = [
    { id: 'a1', type: 'naming', subject: '甲', witness: '乙', date: '2026-09-01' },
    { id: 'b1', type: 'milestone', subject: '乙', witness: '甲', date: '2026-09-01' },
  ];
  const dir = makeSourcesDir(events);
  const obs = witness(dir, { now: NOW });
  // 双向对 → 各 ×0.5；3 天前事件 decay ≈0.98 → 各 ≈0.49
  assert.ok(Math.abs(obs['甲'].witness.naming - 0.49) < 0.02, `甲应折半 ≈0.49，实际 ${obs['甲'].witness.naming}`);
  assert.ok(Math.abs(obs['乙'].witness.milestone - 0.49) < 0.02, `乙应折半 ≈0.49，实际 ${obs['乙'].witness.milestone}`);
});

test('观察期：witness 进入 dimensions 但不计入 composite', () => {
  const dir = makeSourcesDir([
    { id: 'x1', type: 'milestone', subject: '若兰', witness: '星尘', date: '2026-09-02' },
  ]);
  // 空契约/引用源
  fs.mkdirSync(path.join(dir, 'contracts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'references'), { recursive: true });

  const obs = new GdiObserver({ sourcesDir: dir });
  const result = obs.observe('若兰', { now: new Date(NOW) });
  assert.ok(result.dimensions.witness, '应有 witness 维度');
  assert.ok(result.dimensions.witness.milestone > 0, 'milestone 应被观测到');
  assert.ok(result.dimensions.witness.note.includes('观察期'), '应标注观察期');
  // composite 不受 witness 影响（无契约/引用 → composite 应为 0 或 null 语义不变）
  assert.ok(!('witness' in result.dimensions.composite), 'witness 不得进入 composite');
});

test('空数据：无 witness 源返回空观测', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdi-witness-empty-'));
  const obs = witness(dir, { now: NOW });
  assert.deepEqual(obs, {});
});
