#!/usr/bin/env node
/**
 * P2-2 验收：五路径②互评（path=mutual）
 *
 * 判据（全部可机械核对，不靠自述）：
 *   1. 无人应答 → verdict=UNDECIDED + reason=unreachable，score=null（**不是 0 分**）
 *   2. 全部可信 → verdict=PASS，score = 可信评委均值
 *   3. 同一评委前后不一（换措辞分差 > 容差）→ 该评委 FAIL + 进 rejected，其分不计入均值
 *   4. 给空洞样本打高分（无判别力）→ 该评委 FAIL + 进 rejected
 *   5. 部分评委坏 → 整体仍可用，但 rejected 留痕（拒绝要计分，P1）
 *   6. eval.js 有 path=mutual 分支且真能执行（不发 HTTP，直接喂 engine）
 *   7. parseJudgeScore 覆盖 JSON / 关键词 / 纯数字 / 百分制折返，取不到返回 null
 *
 * 运行：node test/mutual-path.test.js
 */
'use strict';

const assert = require('node:assert');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

const { MutualEngine, parseJudgeScore } = require('../server/engine/mutual');

/** 假传输：按 URL 里的名字决定行为 */
function fakeTransport(behaviors) {
  return async (url, msg) => {
    const who = Object.keys(behaviors).find((k) => url.includes(k));
    if (!who) throw new Error(`unexpected peer ${url}`);
    return behaviors[who](msg);
  };
}

// ⚠️ 必须是 RegExp（写成字符串再 .test() 会抛 TypeError，被引擎吞成 unreachable —— 这个坑踩过一次）
const CANARY_HINT = /答案是肯定的/;

(async () => {
  console.log('[mutual] P2-2 五路径②验收\n');

  await t('parseJudgeScore: JSON / 关键词 / 纯数字 / 百分制 / 取不到', () => {
    assert.strictEqual(parseJudgeScore('{"score":7}'), 7);
    assert.strictEqual(parseJudgeScore('评分：8.5 分，理由略'), 8.5);
    assert.strictEqual(parseJudgeScore('7'), 7);
    assert.strictEqual(parseJudgeScore('7/10'), 7);
    assert.strictEqual(parseJudgeScore('85'), 8.5, '百分制应折成 0-10');
    assert.strictEqual(parseJudgeScore('我觉得还行'), null);
    assert.strictEqual(parseJudgeScore(''), null);
  });

  // ── 1) 无人应答 ──
  await t('JUDGE: 全部不可达 → UNDECIDED(unreachable)，score=null 非 0', async () => {
    const e = new MutualEngine({
      transport: fakeTransport({ 'dead.local': () => { throw new Error('connect ECONNREFUSED'); } }),
      delay: 0,
    });
    const r = await e.evaluate({ peers: ['dead.local:3100'] });
    assert.strictEqual(r.verdict, 'UNDECIDED');
    assert.strictEqual(r.reason, 'unreachable');
    assert.strictEqual(r.score, null);
    assert.strictEqual(r.participation.peers_answered, 0);
  });

  await t('JUDGE: 未给评审者 → UNDECIDED(not_applicable)，不抛错', async () => {
    const e = new MutualEngine({ transport: async () => ({ response: '' }), delay: 0 });
    const r = await e.evaluate({ peers: [] });
    assert.strictEqual(r.verdict, 'UNDECIDED');
    assert.strictEqual(r.reason, 'not_applicable');
    assert.strictEqual(r.score, null);
  });

  // ── 2) 全部可信 ──
  await t('JUDGE: 两位可信评委 → PASS，score=均值(7,9)=8', async () => {
    const behaviors = {
      'good1.local': (msg) => ({ response: CANARY_HINT.test(msg) ? '3' : '{"score":7}' }),
      'good2.local': (msg) => ({ response: CANARY_HINT.test(msg) ? '2' : '9' }),
    };
    // 可复现探针用 probes[0]，目标分用 probes[1]；两者都是"非 canary"
    const e = new MutualEngine({
      transport: async (url, msg) => {
        const who = Object.keys(behaviors).find((k) => url.includes(k));
        return behaviors[who](msg);
      },
      delay: 0,
    });
    const r = await e.evaluate({ peers: ['good1.local:3100', 'good2.local:3100'] });
    assert.strictEqual(r.verdict, 'PASS', `期望 PASS，实际 ${r.verdict}（${r.note || ''}）`);
    assert.strictEqual(r.score, 8);
    assert.strictEqual(r.participation.peers_usable, 2);
    assert.deepStrictEqual(r.rejected, []);
  });

  // ── 3) 前后不一 ──
  await t('JUDGE: 同一评委换措辞给 3 与 9（差 6 > 容差 2）→ FAIL 且被剔除', async () => {
    let call = 0;
    const e = new MutualEngine({
      transport: async (url, msg) => {
        if (url.includes('flaky')) {
          if (CANARY_HINT.test(msg)) return { response: '2' };   // 对照样本正常
          call++;
          return { response: call === 1 ? '3' : '9' };            // 两次探针不一致
        }
        return { response: CANARY_HINT.test(msg) ? '3' : '8' };   // 好评委
      },
      delay: 0,
    });
    const r = await e.evaluate({ peers: ['flaky.local:3100', 'good.local:3100'] });
    const flaky = r.peers.find((p) => p.peer.name === 'flaky.local:3100');
    assert.strictEqual(flaky.signals.reproducibility.verdict, 'FAIL');
    assert.ok(r.rejected.some((x) => x.peer === 'flaky.local:3100'
      && x.why.includes('reproducibility_failed')), `rejected 应含 flaky，实际 ${JSON.stringify(r.rejected)}`);
    // 只有 good 的分(8)进入均值 → 不能被 flaky 污染
    assert.strictEqual(r.score, 8, `均值应只算可信评委，实际 ${r.score}`);
  });

  // ── 4) 无判别力 ──
  await t('JUDGE: 给空洞样本打 10 分 → FAIL(no_discrimination) 且被剔除', async () => {
    const e = new MutualEngine({
      transport: async (url, msg) => {
        if (url.includes('gullible')) return { response: '10' };  // 什么都打 10 分
        return { response: CANARY_HINT.test(msg) ? '4' : '7' };
      },
      delay: 0,
    });
    const r = await e.evaluate({ peers: ['gullible.local:3100', 'good.local:3100'] });
    const g = r.peers.find((p) => p.peer.name === 'gullible.local:3100');
    assert.strictEqual(g.signals.discrimination.verdict, 'FAIL');
    assert.ok(r.rejected.some((x) => x.why.includes('no_discrimination')));
    assert.strictEqual(r.score, 7, `只信 good 的 7 分，实际 ${r.score}`);
  });

  // ── 5) 坏评委不能拉高整体分（关键回归）──
  await t('JUDGE: 混入"全给 10 分"的评委 → 不能把均值从 7 抬到 8.5', async () => {
    const e = new MutualEngine({
      transport: async (url, msg) => {
        if (url.includes('spam')) return { response: '10' };
        return { response: CANARY_HINT.test(msg) ? '3' : '7' };
      },
      delay: 0,
    });
    const r = await e.evaluate({ peers: ['spam.local:3100', 'spam2.local:3100', 'good.local:3100'] });
    assert.strictEqual(r.score, 7, `实际 ${r.score}`);
    assert.strictEqual(r.rejected.length, 2);
    // 2/3 评委不可信 → 网络本身不可信，顶层给 FAIL 并说清楚（不是“目标差”）
    assert.strictEqual(r.verdict, 'FAIL');
    assert.match(r.note || '', /互评网络本身不可信/);
  });

  // ── 6) 取不到分 → missing_field，不是 0 分 ──
  await t('JUDGE: 评委回了话但取不到分 → MISSING_FIELD，不记 0', async () => {
    const e = new MutualEngine({
      transport: async () => ({ response: '我觉得这个问题很有意思。' }),
      delay: 0,
    });
    const r = await e.evaluate({ peers: ['vague.local:3100'] });
    assert.strictEqual(r.verdict, 'UNDECIDED');
    assert.strictEqual(r.score, null);
    const p = r.peers[0];
    assert.strictEqual(p.signals.reproducibility.reason, 'missing_field');
    assert.strictEqual(p.signals.reproducibility.score, null);
  });

  // ── 7) 空响应 → empty_response ──
  await t('JUDGE: 空响应记 empty_response（不是答错）', async () => {
    const e = new MutualEngine({ transport: async () => ({ response: '   ' }), delay: 0 });
    const r = await e.evaluate({ peers: ['blank.local:3100'] });
    assert.strictEqual(r.peers[0].signals.reproducibility.reason, 'empty_response');
    assert.strictEqual(r.verdict, 'UNDECIDED');
  });

  // ── 8) 错误分类：未注入的异常不能一律归为「连不上」──
  await t('JUDGE: "peerUrl.includes is not a function" 不记 unreachable（不能把内部 bug 当对方不可达）', async () => {
    const e = new MutualEngine({
      transport: async () => { throw new TypeError('peerUrl.includes is not a function'); },
      delay: 0,
    });
    const r = await e.evaluate({ peers: ['x.local:3100'] });
    const s = r.peers[0].signals.reproducibility;
    assert.notStrictEqual(s.reason, 'unreachable', '内部 TypeError 被误归为对方不可达 = 掩盖 bug');
    assert.notStrictEqual(s.verdict, 'FAIL', '内部 bug 也不能判成「对方做错」');
    assert.strictEqual(s.verdict, 'UNDECIDED');
  });

  // ── 9) eval.js 有 path=mutual 分支（P2-2 判据，直接核代码而非核文档）──
  await t('JUDGE: eval.js 存在 path=mutual 分支且指向 createMutualEval', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../server/api/eval.js'), 'utf8');
    assert.match(src, /req\.body\.path\s*===\s*'mutual'/, "eval.js 缺 path=mutual 分支");
    assert.match(src, /createMutualEval/, 'eval.js 缺 createMutualEval');
    assert.match(src, /require\('\.\.\/engine\/mutual'\)/, 'eval.js 未 require mutual 引擎');
  });

  // ── 10) 端到端：createMutualEval 真能产报告 + 回执（不起 HTTP，注假传输）──
  await t('JUDGE: createMutualEval 产出报告 + 回执，UNDECIDED 时 score=null', async () => {
    const pathMod = require('path');
    const os = require('os');
    const fsMod = require('fs');
    const { EvalAPI } = require('../server/api/eval');
    const dir = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'aep-mutual-'));
    const api = new EvalAPI({
      timeout: 800, delay: 0, resultsDir: dir, eval: {},
      mutualTransport: async () => { throw new Error('connect ECONNREFUSED'); },
    });
    const out = await new Promise((resolve) => {
      api.createMutualEval({ body: { path: 'mutual', peers: ['a.local:1', 'b.local:1'] } }, {
        json: (o) => resolve(o), status: () => ({ json: (o) => resolve(o) }),
      });
    });
    assert.strictEqual(out.path, 'mutual');
    assert.strictEqual(out.verdict, 'UNDECIDED');
    assert.strictEqual(out.score, null);
    assert.ok(fsMod.readdirSync(dir).length >= 1, '报告未落盘');
  });

  console.log(`\n通过: ${pass}  失败: ${fail}`);
  if (fail > 0) process.exit(1);
})();