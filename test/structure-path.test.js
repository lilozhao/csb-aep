#!/usr/bin/env node
/**
 * P2-2 续 验收：五路径④结构密度（Epiplexity 迁移测试）
 *
 * 判据：
 *   1. **答案键不进 prompt**（最要紧的一条）：把 case 6 的 expectedKeywords/expectedTerms
 *      与 prompt 全文比对，出现即失败 —— 出现就退化成「给答案让他抄」
 *   2. 案例集缺失 → 该领域 UNDECIDED(no_audit_source)，不硬凑分
 *   3. 案例数 < 6 → UNDECIDED(insufficient_telemetry)
 *   4. 目标不可达 → UNDECIDED(unreachable)，score=null（不是 0）
 *   5. 四维权重和 = 1（协议 §5.4：40/25/15/20）
 *   6. 满分答案 → raw_score=100，归一化 10
 *   7. 空回答 → UNDECIDED(empty_response)
 *   8. 缺 expectedKeywords 的案例 → 该项判不了，按剩余权重再分配（不按 0 计入）
 *   9. 反模板化套话只记账不扣分（flags）
 *
 * 运行：node test/structure-path.test.js
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

const { StructureEngine, DOMAINS, WEIGHTS } = require('../server/engine/structure');

function perfectAnswer(caseSix) {
  // 造一个把期望关键词/术语全命中、且有推理词与结构标记的回答。
  // 推理词用满 5 个不同词（因为/所以/由于/因此/推断）—— 满分线是 5，要真达到才算满分。
  return [
    '1. 证型判断：' + (caseSix.expectedKeywords || []).join('、'),
    '2. 依据：' + (caseSix.expectedTerms || []).join('、'),
    '3. 理由：因为上述表现一致，所以可以推断为同一病机，因此按此施治，这是由于病机同源。',
    '4. 术语：' + (caseSix.expectedTerms || []).join(' / '),
  ].join('\n');
}

(async () => {
  console.log('[structure] P2-2 续 · 路径④验收\n');

  await t('JUDGE: 四维权重和 = 1（协议 §5.4：40/25/15/20）', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `权重和应为 1，实际 ${sum}`);
    assert.strictEqual(WEIGHTS.keywords, 0.40);
    assert.strictEqual(WEIGHTS.reasoning, 0.25);
    assert.strictEqual(WEIGHTS.structure, 0.15);
    assert.strictEqual(WEIGHTS.terminology, 0.20);
  });

  await t('JUDGE: 三个协议领域案例集齐备且各 6 例', () => {
    const e = new StructureEngine();
    for (const d of DOMAINS) {
      const r = e.loadDomain(d);
      assert.strictEqual(r.ok, true, `${d} 载入失败：${r.note}`);
      assert.strictEqual(r.cases.length, 6, `${d} 应有 6 个案例`);
      assert.ok(r.cases[5].expectedKeywords?.length, `${d} 第 6 例缺 expectedKeywords`);
      assert.ok(r.cases[5].expectedTerms?.length, `${d} 第 6 例缺 expectedTerms`);
    }
  });

  await t('JUDGE: 答案键绝不进 prompt（标准答案为零；“词汇重合”单独记账）', () => {
    const e = new StructureEngine();
    for (const d of DOMAINS) {
      const { meta, cases } = e.loadDomain(d);
      const prompt = e.buildPrompt(meta, cases);
      const { leaked, vocabularyOverlap } = e.assertNoLeak(prompt, cases[5]);
      assert.deepStrictEqual(leaked, [], `${d}: 答案键泄漏 ${JSON.stringify(leaked)}`);
      // 词汇重合不算泄漏，但必须能看见（供复核的人判断是否太巧）
      if (vocabularyOverlap.length) {
        console.log(`     · ${d}: 教学案例中已出现 ${vocabularyOverlap.length} 个期望词（词汇重合，非泄漏）`);
      }
      // 必须真的给了 5 个学习案例 + 1 个待判断
      assert.match(prompt, /案例 5/);
      assert.match(prompt, /待判断/);
    }
  });

  await t('JUDGE: 案例集缺失 → UNDECIDED(no_audit_source)，不硬凑', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'struct-'));
    const e = new StructureEngine({ casesetDir: tmp, transport: async () => ({ response: 'x' }), delay: 0 });
    const r = await e.evaluate({ agentUrl: 'x:1', domains: ['tcm'] });
    assert.strictEqual(r.verdict, 'UNDECIDED');
    assert.strictEqual(r.domains[0].reason, 'no_audit_source');
    assert.strictEqual(r.score, null);
  });

  await t('JUDGE: 案例数 < 6 → UNDECIDED(insufficient_telemetry)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'struct-'));
    fs.writeFileSync(path.join(tmp, 'tcm.json'), JSON.stringify({ cases: [{ input: 'a', answer: 'b' }] }));
    const e = new StructureEngine({ casesetDir: tmp, transport: async () => ({ response: 'x' }), delay: 0 });
    const r = await e.evaluate({ agentUrl: 'x:1', domains: ['tcm'] });
    assert.strictEqual(r.domains[0].reason, 'insufficient_telemetry');
    assert.match(r.domains[0].note, /< 6/);
  });

  await t('JUDGE: 目标不可达 → UNDECIDED(unreachable)，score=null', async () => {
    const e = new StructureEngine({
      transport: async () => { const err = new Error('connect ECONNREFUSED 127.0.0.1:1'); err.code = 'ECONNREFUSED'; throw err; },
      delay: 0,
    });
    const r = await e.evaluate({ agentUrl: '127.0.0.1:1', domains: ['tcm'] });
    assert.strictEqual(r.verdict, 'UNDECIDED');
    assert.strictEqual(r.domains[0].reason, 'unreachable');
    assert.strictEqual(r.score, null);
  });

  await t('JUDGE: 满分答案 → raw_score=100 → 归一化 10', async () => {
    const e0 = new StructureEngine();
    const { cases } = e0.loadDomain('tcm');
    const answer = perfectAnswer(cases[5]);
    const e = new StructureEngine({ transport: async () => ({ response: answer }), delay: 0 });
    const r = await e.evaluate({ agentUrl: 'x:1', domains: ['tcm'] });
    assert.strictEqual(r.domains[0].det.raw_score, 100, `raw 应 100，实际 ${r.domains[0].det.raw_score}`);
    assert.strictEqual(r.domains[0].score, 10);
    assert.strictEqual(r.verdict, 'PASS');
  });

  await t('JUDGE: 空回答 → UNDECIDED(empty_response)', async () => {
    const e = new StructureEngine({ transport: async () => ({ response: '   ' }), delay: 0 });
    const r = await e.evaluate({ agentUrl: 'x:1', domains: ['tcm'] });
    assert.strictEqual(r.domains[0].reason, 'empty_response');
    assert.strictEqual(r.verdict, 'UNDECIDED');
  });

  await t('JUDGE: 缺 expectedKeywords → 该项 null，按剩余权重再分配（不按 0 计）', () => {
    const e = new StructureEngine();
    const txt = '因为所以推断，1. 分点 2. 说明：术语';
    const withKeys = e.scoreAnswer(txt, { expectedKeywords: ['甲', '乙'], expectedTerms: ['丙'] });
    const noKeys = e.scoreAnswer(txt, { expectedTerms: ['丙'] });
    // 没期望关键词时 keywords/terminology 的权重不该被算成 0 分拉低
    assert.strictEqual(noKeys.parts.find((p) => p.key === 'keywords').score, null);
    assert.ok(noKeys.raw_score >= withKeys.raw_score - 1e-9,
      `缺答案键时不该更低分（${noKeys.raw_score} vs ${withKeys.raw_score}）`);
  });

  await t('JUDGE: 结构化输出按协议“有/无”判，不按凑满三种（回归）', () => {
    const e = new StructureEngine();
    // 只有编号、没有分点/冒号：按协议也算“有结构”
    const onlyNumbered = e.scoreAnswer('1. 甲\n2. 乙 因为所以推断因此由于', { expectedKeywords: ['甲'], expectedTerms: ['乙'] });
    const st = onlyNumbered.parts.find((p) => p.key === 'structure');
    assert.strictEqual(st.score, 100, `只有编号也应有结构，实际 ${st.score}`);
    // 一点结构都没有 → 0
    const flat = e.scoreAnswer('甲乙因为所以推断因此由于', { expectedKeywords: ['甲'], expectedTerms: ['乙'] });
    assert.strictEqual(flat.parts.find((p) => p.key === 'structure').score, 0);
  });

  await t('JUDGE: 反模板化套话只记账不扣分', () => {
    const e = new StructureEngine();
    const r = e.scoreAnswer('作为AI我无法判断。因为所以推断，1. 分点：说明', { expectedKeywords: ['判断'], expectedTerms: ['推断'] });
    assert.ok(r.flags.length > 0, '应记录模板化套话');
    assert.ok(r.flags.some((f) => /作为\s?AI/.test(f)));
  });

  await t('JUDGE: 部分领域判不了（覆盖 <60%）→ 顶层 UNDECIDED', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'struct-'));
    // 只放 tcm，另两个领域缺 → 1/3 覆盖
    fs.copyFileSync(path.join(__dirname, '../casesets/structure/tcm.json'), path.join(tmp, 'tcm.json'));
    const e = new StructureEngine({
      casesetDir: tmp,
      transport: async (url, msg) => ({ response: '1. 因为所以，阴虚 虚热 滋阴 清热 盗汗 五心烦热 舌红少苔 细数 虚热' }),
      delay: 0,
    });
    const r = await e.evaluate({ agentUrl: 'x:1' });
    assert.strictEqual(r.coverage, 0.333);
    assert.strictEqual(r.verdict, 'UNDECIDED');
    assert.match(r.note, /<60%/);
  });

  console.log(`\n通过: ${pass}  失败: ${fail}`);
  if (fail > 0) process.exit(1);
})();