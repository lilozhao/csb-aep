#!/usr/bin/env node
/**
 * P0-2 验收（端到端）：没测到 ≠ 做错
 *
 * 判据（对应知微审计「事实 2」，全部可机械核对）：
 *   1. 拔掉目标端口 → 协议层 7 项全部 UNDECIDED，**零 FAIL**
 *   2. 不可达项的 score 必须 null，不能是 0
 *   3. calculateScore 不把 UNDECIDED 计入分母；全没测到 → null（不是 0）
 *   4. calculateCoverage 如实反映覆盖率
 *   5. 报告能区分「没测到」与「答错了」——两者在字段上不同形
 *   6. 回执在这一场景下 verdict=UNDECIDED 且带 reason（不是 PASS/FAIL）
 *
 * 运行：node --test test/three-state-e2e.test.js   或   node test/three-state-e2e.test.js
 */

const assert = require('node:assert');
const net = require('net');

// ── 先占一个端口再关掉，保证它是"真的没人监听" ──
async function getClosedPort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

let pass = 0, fail = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

(async () => {
  console.log('[three-state] P0-2 端到端验收\n');

  const port = await getClosedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  目标（确认无服务）: ${baseUrl}\n`);

  const { A2AChecker } = require('../server/standard/a2a');
  const { BlackBoxEngine } = require('../server/engine/blackbox');
  const V = require('../server/engine/verdict');

  const checks = await new A2AChecker(600).runAllChecks(baseUrl);

  await t('JUDGE: 拔端口 → 协议 7 项全部 UNDECIDED', () => {
    assert.strictEqual(checks.length, 7, `应有 7 项，实际 ${checks.length}`);
    const notUndecided = checks.filter((c) => c.status !== V.VERDICT.UNDECIDED);
    assert.deepStrictEqual(notUndecided.map((c) => c.id), [], `这些项没标 UNDECIDED: ${JSON.stringify(notUndecided)}`);
  });

  await t('JUDGE: 拔端口 → 零 FAIL（一个都不能被判"做错"）', () => {
    const fails = checks.filter((c) => c.pass === false);
    assert.deepStrictEqual(fails.map((c) => c.id), [], `不应有 FAIL，实际: ${JSON.stringify(fails)}`);
  });

  await t('JUDGE: UNDECIDED 项 score 为 null 而非 0', () => {
    for (const c of checks) {
      assert.strictEqual(c.score, null, `${c.id} 的 score 应为 null，实际 ${c.score}`);
    }
  });

  await t('JUDGE: 每项都带 reason（判不了要说清为什么）', () => {
    for (const c of checks) {
      assert.ok(c.reason, `${c.id} 缺 reason`);
      assert.ok(Object.values(V.UNDECIDED_REASON).includes(c.reason), `${c.id} reason 不在枚举内: ${c.reason}`);
    }
  });

  // ── 算分：UNDECIDED 不进分母 ──
  const engine = new BlackBoxEngine({ timeout: 600, delay: 0 });
  const allUndecided = checks.map((c) => ({ ...c, weight: 5 }));

  await t('JUDGE: 全部 UNDECIDED → score=null（不是 0）', () => {
    const s = engine.calculateScore(allUndecided);
    assert.strictEqual(s, null, `应返回 null，实际 ${s}`);
  });

  await t('JUDGE: 覆盖率如实反映（全没测到 → 0）', () => {
    assert.strictEqual(engine.calculateCoverage(allUndecided), 0);
  });

  await t('JUDGE: 混合场景 —— UNDECIDED 不拉低分数', () => {
    const mixed = [
      { id: 'a', weight: 10, score: 100, pass: true },
      { id: 'b', weight: 10, score: 0, pass: false },
      { id: 'c', weight: 10, score: null, pass: null, status: V.VERDICT.UNDECIDED, reason: 'unreachable' },
      { id: 'd', weight: 10, score: null, pass: null, status: V.VERDICT.UNDECIDED, reason: 'rate_limited' },
    ];
    const s = engine.calculateScore(mixed);
    // 只按 a、b 算 → 平均 50/100 → 0-10 制即 5；
    // 若把 c/d 当 0 分进分母，会变成 2.5（旧行为）
    assert.strictEqual(s, 5, `应为 5（只按已判定项），实际 ${s}`);
    assert.strictEqual(engine.calculateCoverage(mixed), 0.5);
  });

  await t('JUDGE: 「没测到」与「做错了」字段上不同形', () => {
    const und = allUndecided[0];
    const realFail = { id: 'x', score: 0, pass: false, detail: '答错了' };
    assert.notStrictEqual(und.status, undefined, 'UNDECIDED 必须有 status 字段');
    assert.strictEqual(und.pass, null, 'UNDECIDED 的 pass 必须是 null 而非 false');
    assert.strictEqual(realFail.status, undefined, '真 FAIL 不应带 status');
    assert.strictEqual(realFail.pass, false);
    assert.strictEqual(realFail.score, 0);
  });

  // ── 回执在这一场景下的表现 ──
  await t('JUDGE: 该场景回执 verdict=UNDECIDED 且带 reason', () => {
    const agg = V.aggregate(allUndecided.map((c) => V.undecided(c.reason, c.detail)), { minCoverage: 0.6 });
    assert.strictEqual(agg.verdict, 'UNDECIDED');
    assert.strictEqual(agg.score, null);
    assert.strictEqual(agg.insufficient, true, '覆盖率 0 < 0.6 应标 insufficient');
    assert.strictEqual(agg.decided, 0);
    assert.ok(agg.undecidedReasons.unreachable >= 1);
  });

  await t('JUDGE: 低档位 + 目标失败 → UNDECIDED（信号不得越级）', () => {
    const v = V.applyTierCeiling(V.fail(0, '未回应'), V.TIER.NONE);
    assert.strictEqual(v.verdict, 'UNDECIDED');
    assert.strictEqual(v.reason, 'insufficient_telemetry');
  });

  // ── 源码守线：不许再出现硬编码 0 分 ──
  await t('JUDGE: blackbox.js 不再把"没测到"写死成 score: 0', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../server/engine/blackbox'), 'utf8')
      // 剔除注释再扫——否则会把解释旧行为的注释当成代码（本测试第一版就是这么误报的）
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const hardcoded = [...src.matchAll(/score:\s*0\b/g)];
    assert.strictEqual(hardcoded.length, 0, `仍有 ${hardcoded.length} 处 score: 0`);
  });

  await t('JUDGE: a2a.js 不再有 pass: false 的"没测到"分支', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../server/standard/a2a'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.strictEqual([...src.matchAll(/pass:\s*false/g)].length, 0);
  });

  console.log(`\n通过: ${pass}`);
  console.log(`失败: ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
