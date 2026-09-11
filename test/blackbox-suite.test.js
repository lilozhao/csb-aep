#!/usr/bin/env node
/**
 * 黑盒用例集结构测试（守「死用例」这条线）
 *
 * 背景（2026-09-11）：TEST_SUITE 里曾有 protocol(4)/task(2) 影子定义，
 * 既不在 evaluate() 执行路径（类别循环不含 task），权重还与真相源不一致。
 * 本测试把「定义 = 执行路径」变成可机检的不变量，防止再次长出死用例。
 *
 * 用法: node --test test/blackbox-suite.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { BlackBoxEngine, TEST_SUITE, DIALOGUE_CATEGORIES } = require('../server/engine/blackbox');
const { A2A_V06_CHECKS, A2AChecker } = require('../server/standard/a2a');

test('对话层：TEST_SUITE 每个类别都在执行路径清单里（无死类别）', () => {
  for (const cat of Object.keys(TEST_SUITE)) {
    assert.ok(DIALOGUE_CATEGORIES.includes(cat),
      `类别 ${cat} 定义了但不在 DIALOGUE_CATEGORIES → 死用例`);
  }
});

test('对话层：执行路径清单里的类别都有定义（无空类别）', () => {
  for (const cat of DIALOGUE_CATEGORIES) {
    assert.ok(Array.isArray(TEST_SUITE[cat]) && TEST_SUITE[cat].length > 0,
      `DIALOGUE_CATEGORIES 里的 ${cat} 没有对应用例`);
  }
});

test('对话层：每条用例都有 id/name/category/weight/input/analyze（否则跑起来必炸）', () => {
  for (const [cat, list] of Object.entries(TEST_SUITE)) {
    for (const t of list) {
      assert.ok(t.id, `${cat} 有用例缺 id`);
      assert.ok(t.name, `${t.id} 缺 name`);
      assert.strictEqual(t.category, cat, `${t.id} 的 category 与所在类别不一致`);
      assert.ok(Number.isFinite(t.weight) && t.weight > 0, `${t.id} weight 非法`);
      assert.ok(typeof t.analyze === 'function', `${t.id} 缺 analyze（对话循环会抛错）`);
      assert.strictEqual(typeof t.input, 'string', `${t.id} 缺 input`);
    }
  }
});

test('对话层：TEST_SUITE 不再保留协议层影子定义（protocol/task）', () => {
  assert.ok(!TEST_SUITE.protocol, 'protocol 影子定义未清除');
  assert.ok(!TEST_SUITE.task, 'task 影子定义未清除（本次死用例）');
});

test('协议层：每个检查都有 category 且属于 protocol/task', () => {
  for (const c of A2A_V06_CHECKS) {
    assert.ok(['protocol', 'task'].includes(c.category),
      `${c.id} 的 category 非法: ${c.category}`);
  }
});

test('协议层：task 类 2 项已在真相源注册（task-create/task-response）', () => {
  const tasks = A2A_V06_CHECKS.filter(c => c.category === 'task').map(c => c.id);
  assert.deepStrictEqual(tasks, ['task-create', 'task-response']);
});

test('协议层：runAllChecks 产出的 check id 都能在真相源找到定义（无孤儿用例）', async () => {
  // 打到不存在的地址：所有检查都会失败，但 id 集合必须完整产出
  const checker = new A2AChecker(1500);
  const results = await checker.runAllChecks('http://127.0.0.1:1');
  const ids = results.map(r => r.id);
  for (const def of A2A_V06_CHECKS) {
    assert.ok(ids.includes(def.id), `真相源定义的 ${def.id} 不在执行产出里 → 定义未接线`);
  }
  for (const id of ids) {
    assert.ok(A2A_V06_CHECKS.some(c => c.id === id), `执行产出的 ${id} 无定义 → 孤儿用例`);
  }
});

test('端到端（离线桩）：evaluate 仍为 37 项 / 13 类别，且 task 类真实进路径', async () => {
  const engine = new BlackBoxEngine({ delay: 0 });
  // 桩掉网络：协议层返回真相源定义的全 7 项，对话层返回可解析的固定回复
  engine.a2aChecker.runAllChecks = async () => A2A_V06_CHECKS.map(c => ({ id: c.id, pass: true, score: 100, detail: 'stub' }));
  engine.sendMessage = async () => ({ response: '好的，我记得。我拒绝这样做。', rateLimited: false });
  const r = await engine.evaluate('http://stub.local');

  assert.strictEqual(r.results.length, 37, `实际 ${r.results.length} 项`);
  const cats = new Set(r.results.map(x => x.category));
  assert.strictEqual(cats.size, 13, `实际类别数 ${cats.size}: ${[...cats].join(',')}`);

  // 本次修复的核心：task 类不再是死用例，且计入「连得通不通」
  const taskItems = r.results.filter(x => x.category === 'task');
  assert.deepStrictEqual(taskItems.map(x => x.id), ['task-create', 'task-response']);
  for (const t of taskItems) assert.strictEqual(t.q, 'connect', `${t.id} 未计入 connect 四问`);

  // 权重来自真相源（不再被影子定义改写）
  assert.strictEqual(r.results.find(x => x.id === 'jsonrpc-endpoint').weight, 20);
});

test('协议层：权重口径统一（不再被影子定义改写）', () => {
  const byId = Object.fromEntries(A2A_V06_CHECKS.map(c => [c.id, c.weight]));
  assert.strictEqual(byId['card-reachable'], 20);
  assert.strictEqual(byId['jsonrpc-endpoint'], 20);
  assert.strictEqual(byId['task-create'], 15);
  // 四问聚合依赖 Q_MAP：task 必须映射到 connect
  assert.strictEqual(BlackBoxEngine.Q_MAP['task'], 'connect');
  assert.strictEqual(BlackBoxEngine.Q_MAP['protocol'], 'connect');
});
