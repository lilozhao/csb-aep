#!/usr/bin/env node
/**
 * Harness 接入文档自检（防文档漂移）
 *
 * 为什么要有这个：文档写了「16 项全量」「N/A 不硬凑」「Δ 三方校验」这些断言，
 * 一旦代码改动，文档就会变成骗人的。这份脚本把文档里的**可机械核对**部分变成断言。
 *
 * 运行：node test/harness-quickstart-doc.test.js
 * 退出码：0 全绿 / 1 有失败
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'harness-quickstart-other-agents.md');
const EX = path.join(ROOT, 'examples');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

const { validateManifest } = require(path.join(ROOT, 'server/engine/harness/manifest.js'));
const { parseTrace } = require(path.join(ROOT, 'server/engine/harness/trace.js'));
const { HarnessEvaluator, IMPLEMENTED } = require(path.join(ROOT, 'server/engine/harness'));

console.log('\n=== 文档与示例文件存在性 ===');
t('接入指南存在', () => assert.ok(fs.existsSync(DOC), DOC));
t('manifest 示例存在', () => assert.ok(fs.existsSync(path.join(EX, 'harness-manifest.example.json'))));
t('trace 示例存在', () => assert.ok(fs.existsSync(path.join(EX, 'trace.example.jsonl'))));
t('完整样例存在', () => assert.ok(fs.existsSync(path.join(EX, 'harness-full-example.json'))));
t('生成脚本存在', () => assert.ok(fs.existsSync(path.join(EX, 'build-full-example.js'))));

console.log('\n=== 示例文件真的可用（不是摆设） ===');
const MANIFEST = require(path.join(EX, 'harness-manifest.example.json'));

t('manifest 示例能通过校验且无 error', () => {
  const r = validateManifest(MANIFEST);
  assert.strictEqual(r.valid, true, JSON.stringify(r.errors));
  assert.strictEqual(r.errors.length, 0);
});

t('trace 示例每行都能解析', () => {
  const lines = fs.readFileSync(path.join(EX, 'trace.example.jsonl'), 'utf8').trim().split('\n');
  assert.ok(lines.length >= 3, '至少 3 条 trace');
  lines.forEach((l, i) => {
    const r = parseTrace(JSON.parse(l));
    assert.strictEqual(r.valid, true, `第 ${i + 1} 行: ${JSON.stringify(r.errors)}`);
  });
});

console.log('\n=== 文档核心断言：与代码实况一致 ===');
t('文档说「16 项」→ IMPLEMENTED 确实是 16 项', () => {
  assert.strictEqual(IMPLEMENTED.length, 16, `实际 ${IMPLEMENTED.length}`);
});
t('文档说「planned 为空」→ 确实无未实现项', () => {
  const { PLANNED } = require(path.join(ROOT, 'server/engine/harness'));
  assert.strictEqual(PLANNED.length, 0, `实际 ${JSON.stringify(PLANNED)}`);
});
t('文档列的 16 个指标 ID 与代码逐字一致', () => {
  const docIds = ['A1','A2','A3','A4','A5','A6','A7','A8','A9','B1','B2','B3','B4','B5','C1','C2'];
  assert.deepStrictEqual(IMPLEMENTED.slice().sort(), docIds.slice().sort());
});

console.log('\n=== 文档写的最小版：说「至少 5 项出分」必须属实 ===');
t('manifest+trace 最小输入 → scoredCount=5', () => {
  const ev = new HarnessEvaluator();
  const traces = fs.readFileSync(path.join(EX, 'trace.example.jsonl'), 'utf8')
    .trim().split('\n').map(JSON.parse);
  const r = ev.evaluate({ manifest: MANIFEST, traces });
  assert.strictEqual(r.partial.scoredCount, 5, `实际 ${r.partial.scoredCount}`);
  assert.strictEqual(r.partial.naMetrics.length, 11, `N/A 实际 ${r.partial.naMetrics.length}`);
});

console.log('\n=== 文档写的完整样例：说「16 项全出分」必须属实 ===');
t('完整样例 → scoredCount=16 · naMetrics 空', () => {
  const payload = require(path.join(EX, 'harness-full-example.json'));
  const ev = new HarnessEvaluator();
  // 去掉注释键，模拟 API 的真实入参
  const { _comment, ...input } = payload;
  const r = ev.evaluate(input);
  assert.strictEqual(r.partial.scoredCount, 16, `实际 ${r.partial.scoredCount}，na=${JSON.stringify(r.partial.naMetrics)}`);
  assert.strictEqual(r.partial.naMetrics.length, 0);
});

console.log('\n=== 文档写「N/A ≠ 0」：必须是真实现，不是说法 ===');
t('缺数据指标 score=null 而非 0', () => {
  const ev = new HarnessEvaluator();
  const r = ev.evaluate({ manifest: MANIFEST, traces: [] });
  const naMetrics = r.metrics.filter(m => m.status === 'N/A');
  assert.ok(naMetrics.length > 0, '应有 N/A 项');
  naMetrics.forEach(m => assert.strictEqual(m.score, null, `${m.id} 应为 null 实际 ${m.score}`));
});

console.log('\n=== A3 推导回归（2026-11-04 修的两个 bug，不许回来） ===');
t('traps=[] 不得挡住 deriveTraps（空数组是 truthy）', () => {
  const loopTrace = {
    task_id: 'L', finished: true, total_tokens: 40,
    steps: [
      { i: 1, tool: 'read_file', args_hash: 'abc', tokens: 10 },
      { i: 2, tool: 'read_file', args_hash: 'abc', tokens: 10 },
      { i: 3, tool: 'write', args_hash: 'z', tokens: 10 },
    ],
  };
  const r = new HarnessEvaluator().evaluate({ manifest: MANIFEST, traces: [loopTrace], traps: [] });
  const a3 = r.metrics.find(m => m.id === 'A3');
  assert.strictEqual(a3.status, 'ok', `traps=[] 时推导应生效，实际 ${a3.status}`);
  assert.strictEqual(a3.detectRate, 1, `应检出真实循环，实际 detectRate=${a3.detectRate}`);
});
t('trace 无循环痕迹 → A3 判 N/A，不得记 0 分', () => {
  const flat = {
    task_id: 'F', finished: true, total_tokens: 20,
    steps: [
      { i: 1, tool: 'a', args_hash: '1', tokens: 10 },
      { i: 2, tool: 'b', args_hash: '2', tokens: 10 },
    ],
  };
  const r = new HarnessEvaluator().evaluate({ manifest: MANIFEST, traces: [flat], traps: [] });
  const a3 = r.metrics.find(m => m.id === 'A3');
  assert.strictEqual(a3.score, null, `无循环可判时应为 null，实际 ${a3.score}（没测到≠做错）`);
  assert.strictEqual(a3.status, 'N/A');
});
t('直调路径与 HTTP 路径（traps=[]）结论一致', () => {
  const loopTrace = {
    task_id: 'L', finished: true, total_tokens: 40,
    steps: [
      { i: 1, tool: 'r', args_hash: 'x', tokens: 10 },
      { i: 2, tool: 'r', args_hash: 'x', tokens: 10 },
    ],
  };
  const direct = new HarnessEvaluator().evaluate({ manifest: MANIFEST, traces: [loopTrace] });
  const httpShape = new HarnessEvaluator().evaluate({ manifest: MANIFEST, traces: [loopTrace], traps: [] });
  const d = direct.metrics.find(m => m.id === 'A3');
  const h = httpShape.metrics.find(m => m.id === 'A3');
  assert.strictEqual(d.score, h.score, `两条路分叉：直调=${d.score} HTTP=${h.score}`);
});
t('显式传入 traps 时尊重调用方，不被推导覆盖', () => {
  const explicit = [{ id: 't', steps: [{ tool: 'x', args_hash: 'y' }], detected: true, detectedAtStep: 2 }];
  const r = new HarnessEvaluator().evaluate({ manifest: MANIFEST, traces: [], traps: explicit });
  const a3 = r.metrics.find(m => m.id === 'A3');
  assert.strictEqual(a3.trapCount, 1, '应使用传入的 1 条陷阱');
  assert.strictEqual(a3.detectRate, 1);
});

console.log('\n=== 文档写「Δ 三方不一致就拒分」：负向实测 ===');
t('taskSetHash 不一致 → delta_invalid', () => {
  const payload = require(path.join(EX, 'harness-full-example.json'));
  const { _comment, ...input } = payload;
  input.baselineMeta = { ...input.baselineMeta, taskSetHash: 'DIFFERENT' };
  const r = new HarnessEvaluator().evaluate(input);
  assert.strictEqual(r.delta.available, false);
  assert.strictEqual(r.delta.status, 'delta_invalid');
});
t('完全不传 baselineScore → 不出 Δ（无 Δ 不上屏）', () => {
  const payload = require(path.join(EX, 'harness-full-example.json'));
  const { _comment, baselineScore, baselineMeta, ...input } = payload;
  const r = new HarnessEvaluator().evaluate(input);
  assert.strictEqual(r.delta.available, false);
});

console.log('\n=== 文档 §4 表格覆盖度：16 项必须都有说明 ===');
t('16 个指标 ID 都在文档表格里出现', () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  const missing = IMPLEMENTED.filter(id => !doc.includes(`**${id}**`));
  assert.strictEqual(missing.length, 0, `文档缺: ${missing.join(', ')}`);
});

t('文档点名的入参键都能在完整样例里找到', () => {
  const payload = require(path.join(EX, 'harness-full-example.json'));
  const keys = ['compression','traps','multiAgent','orchestration','boundary','observability',
    'recovery','runs','ttftMs','peerTokens','bestSteps','unitPrice','toolCost','peerCosts',
    'loads','seeds','envDeclared','modelScores','baselineScore','baselineMeta','taskSetHash'];
  const missing = keys.filter(k => !(k in payload));
  assert.strictEqual(missing.length, 0, `完整样例缺: ${missing.join(', ')}`);
});

console.log(`\n通过: ${pass}  失败: ${fail}`);
process.exit(fail === 0 ? 0 : 1);