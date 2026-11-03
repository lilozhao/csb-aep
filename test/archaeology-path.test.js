#!/usr/bin/env node
/**
 * P2-2 续 验收：五路径③行为考古
 *
 * 判据：
 *   1. 无 agentPath / 目录不存在 → UNDECIDED(no_audit_source)，score=null（不是 0）
 *   2. 没有 memory 目录 → 同样 UNDECIDED，不判「记忆差」
 *   3. 日记跨度 < 门槛（7 天）→ UNDECIDED(insufficient_telemetry)，并说清差多少
 *   4. 语料充足 → PASS，score 在 0-10，五维度权重和 = 1
 *   5. 承诺只数清单行（`- [ ]` / `- [x]`），数正文会把叙述算成承诺
 *   6. 变更次数优先 git；无 git 时退 mtime 且**明标来源**，该维度不给 PASS
 *   7. 协议权重和 = 1（改权重必须同步测试）
 *
 * 运行：node test/archaeology-path.test.js
 */
'use strict';

const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

const { ArchaeologyEngine, DIMENSIONS } = require('../server/engine/archaeology');

/** 造一个临时 Agent 目录 */
function makeAgent({ journalDays = 10, withMemory = true, todos = null, stance = 3000 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
  fs.writeFileSync(path.join(root, 'SOUL.md'), '# SOUL\n价值观：珍惜、羁绊\n');
  fs.writeFileSync(path.join(root, 'IDENTITY.md'), '# IDENTITY\n若兰\n');
  fs.writeFileSync(path.join(root, 'MEMORY.md'), '# MEMORY\n记忆\n');
  if (withMemory) {
    fs.mkdirSync(path.join(root, 'memory'));
    const base = new Date(Date.UTC(2026, 10, 3));
    for (let i = journalDays - 1; i >= 0; i--) {
      const d = new Date(base.getTime() - i * 86400000);
      const name = d.toISOString().slice(0, 10) + '.md';
      // 内容包含主题关键词 + 反思 + A2A，长度按 stance 控制
      const body = ('# 日记\n' +
        '今天讨论了 A2A 与碳硅契，社区技术学习记忆日程天气。\n' +
        '反思：这次错了，改进做法；上次与这次对比，有明显递进。\n' +
        '里程碑：首次完成；协作讨论达成共识。\n').padEnd(stance, '·');
      fs.writeFileSync(path.join(root, 'memory', name), body);
    }
  }
  if (todos) fs.writeFileSync(path.join(root, 'TODO.md'), todos);
  return root;
}

(async () => {
  console.log('[archaeology] P2-2 续 · 路径③验收\n');

  await t('JUDGE: 协议五维度权重和 = 1（改权重必须同步）', () => {
    const sum = DIMENSIONS.reduce((s, d) => s + d.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `权重和应为 1，实际 ${sum}`);
    assert.strictEqual(DIMENSIONS.length, 5);
    const ids = DIMENSIONS.map((d) => d.id).join(',');
    assert.strictEqual(ids, 'memory-density,commitment,learning-curve,social,evolution');
  });

  await t('JUDGE: 未给 agentPath → UNDECIDED(no_audit_source)，score=null', async () => {
    const r = await new ArchaeologyEngine().evaluate(null);
    assert.strictEqual(r.verdict, 'UNDECIDED');
    assert.strictEqual(r.reason, 'no_audit_source');
    assert.strictEqual(r.score, null);
  });

  await t('JUDGE: 目录不存在 → UNDECIDED，不抛错', async () => {
    const r = await new ArchaeologyEngine().evaluate('/nonexistent/agent/x');
    assert.strictEqual(r.verdict, 'UNDECIDED');
    assert.strictEqual(r.reason, 'no_audit_source');
    assert.strictEqual(r.score, null);
  });

  await t('JUDGE: 无 memory 目录 → UNDECIDED，不判「记忆差」', async () => {
    const root = makeAgent({ withMemory: false });
    const r = await new ArchaeologyEngine().evaluate(root);
    assert.strictEqual(r.verdict, 'UNDECIDED');
    // 关键：不能有 0 分
    for (const d of r.dimensions) {
      if (d.id === 'memory-density') assert.strictEqual(d.score, null, '无日记时记忆密度不能给分');
    }
  });

  await t('JUDGE: 日记仅 3 天（<门槛 7）→ UNDECIDED(insufficient_telemetry) 并说明差多少', async () => {
    const root = makeAgent({ journalDays: 3 });
    const r = await new ArchaeologyEngine({ minJournalDays: 7 }).evaluate(root);
    const mem = r.dimensions.find((d) => d.id === 'memory-density');
    assert.strictEqual(mem.state, 'UNDECIDED');
    assert.strictEqual(mem.reason, 'insufficient_telemetry');
    assert.match(mem.note, /3 天|门槛 7/);
  });

  await t('JUDGE: 语料充足（30 天）→ PASS，score ∈ [0,10]', async () => {
    const root = makeAgent({ journalDays: 30 });
    const r = await new ArchaeologyEngine().evaluate(root);
    assert.strictEqual(r.verdict, 'PASS', `期望 PASS，实际 ${r.verdict}（${r.note || ''}）`);
    assert.ok(r.score >= 0 && r.score <= 10, `score 越界：${r.score}`);
    assert.ok(r.coverage >= 0.6, `覆盖率应 ≥0.6，实际 ${r.coverage}`);
  });

  await t('JUDGE: 承诺只数清单行，不把正文叙述算成承诺', async () => {
    const root = makeAgent({
      journalDays: 10,
      todos: '# TODO\n\n我们承诺过很多事情，这是叙述不是清单。\n\n- [x] 第一件\n- [x] 第二件\n- [ ] 第三件\n- [ ] 第四件\n',
    });
    const r = await new ArchaeologyEngine().evaluate(root);
    const c = r.dimensions.find((d) => d.id === 'commitment');
    const total = c.sub_dimensions.find((s) => s.key === 'total');
    assert.match(total.evidence, /4 条/, `应数到 4 条清单承诺，实际：${total.evidence}`);
  });

  await t('JUDGE: 无 git 时退 mtime，必须明标来源，且演化维度不给 PASS', async () => {
    const root = makeAgent({ journalDays: 10 });
    const r = await new ArchaeologyEngine().evaluate(root);
    const evo = r.dimensions.find((d) => d.id === 'evolution');
    if (evo.state === 'UNDECIDED') {
      assert.match(evo.note || '', /mtime/, '退化到 mtime 时必须说明');
      assert.strictEqual(evo.score, null, 'mtime 口径下不给分');
    } else {
      // 若临时目录恰好落在某个 git 仓内，则允许 PASS，但来源必须写出来
      assert.ok(evo.sub_dimensions.every((s) => /来源 (git|mtime)/.test(s.evidence)));
    }
  });

  await t('JUDGE: 一个维度都判不了 → 顶层 UNDECIDED，score 不为 0', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-empty-'));
    const r = await new ArchaeologyEngine().evaluate(root);
    assert.strictEqual(r.verdict, 'UNDECIDED');
    assert.strictEqual(r.score, null);
  });

  await t('JUDGE: 输出结构含协议 §8.2 字段（path/verdict/score/dimensions）', async () => {
    const root = makeAgent({ journalDays: 30 });
    const r = await new ArchaeologyEngine().evaluate(root);
    for (const k of ['path', 'timestamp', 'verdict', 'score', 'dimensions']) {
      assert.ok(k in r, `缺字段 ${k}`);
    }
    assert.strictEqual(r.path, 'archaeology');
    for (const d of r.dimensions) {
      assert.ok('name' in d && 'sub_dimensions' in d, `维度 ${d.id} 缺协议字段`);
    }
  });

  console.log(`\n通过: ${pass}  失败: ${fail}`);
  if (fail > 0) process.exit(1);
})();