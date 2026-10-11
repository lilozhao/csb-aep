#!/usr/bin/env node
/**
 * Harness 工程域 M4 测试 · CSB-AEP v2.4.0
 * 覆盖：C1/C2 判定 / 全 16 项编排 / 不变量（Δ 强制 + 呈现净化 + 域隔离）
 * 运行：node test/harness-m4.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractConfig } = require('../server/engine/harness/manifest.js');
const { c1, c2, structSig } = require('../server/engine/harness/reproducibility.js');
const { HarnessEvaluator } = require('../server/engine/harness');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}
const MF = { harness: { name: 'h' }, loop: { max_iterations: 50, loop_guard: 'j' },
  context: { trigger_ratio: 0.65 }, sandbox: { fs_boundary: 'workspace-only' },
  observability: { fields: ['step', 'tool', 'tokens'] } };
const CFG = extractConfig(MF);
const tr = (tools) => ({ steps: tools.map((x, i) => ({ i: i + 1, tool: x, args_hash: 'h' })), finished: true });

console.log('\n=== C1 环境与种子可复现性 ===');
t('结构全一致 → 10', () => {
  const r = c1(CFG, { runs: [[tr(['a', 'b']), tr(['a', 'b']), tr(['a', 'b'])]], seeds: 42 });
  assert.strictEqual(r.score, 10);
  assert.strictEqual(r.structureConsistency, 1);
});
t('结构不一致 → 降分', () => {
  const r = c1(CFG, { runs: [[tr(['a', 'b']), tr(['a', 'c'])]], seeds: 42 });
  assert.ok(r.score <= 7);
});
t('未声明 seeds → N/A', () => {
  const r = c1(CFG, { runs: [[tr(['a']), tr(['a'])]] });
  assert.strictEqual(r.score, null);
});
t('结构签名函数', () => {
  assert.strictEqual(structSig(tr(['a', 'b'])), structSig(tr(['a', 'b'])));
  assert.notStrictEqual(structSig(tr(['a', 'b'])), structSig(tr(['a'])));
});

console.log('\n=== C2 模型可替换性 ===');
t('CV <5% → 10（harness 主导）', () => {
  const r = c2(CFG, { modelScores: { 'gpt': 8.0, 'claude': 8.1, 'qwen': 7.9 } });
  assert.strictEqual(r.score, 10);
  assert.ok(r.attribution.includes('harness 主导'));
});
t('CV >25% → 3（模型主导）', () => {
  const r = c2(CFG, { modelScores: { a: 4.0, b: 8.0, c: 10.0 } });
  assert.strictEqual(r.score, 3);
  assert.ok(r.attribution.includes('模型主导'));
});
t('模型数 <3 → N/A', () => {
  assert.strictEqual(c2(CFG, { modelScores: { a: 8, b: 9 } }).score, null);
});
t('无数据 → N/A', () => { assert.strictEqual(c2(CFG, {}).score, null); });

console.log('\n=== 全 16 项编排（v2.4.0 正式版）===');
t('implemented = 16 项', () => {
  const c = new HarnessEvaluator().capabilities();
  assert.strictEqual(c.implemented.length, 16);
  assert.strictEqual(c.version, '2.4.1');
});
t('evaluate 含 C 群指标', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({
    manifest: MF,
    runs: [[tr(['a']), tr(['a'])]],
    seeds: 42,
    modelScores: { a: 8, b: 8.1, c: 7.9 },
  });
  for (const id of ['C1', 'C2']) {
    assert.strictEqual(out.metrics.find(m => m.id === id).status, 'ok', `${id} 应 ok`);
  }
});

console.log('\n=== 不变量（守线）===');
t('不变量1：Δ 字段恒存在（无基线时为 pending）', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({ manifest: MF });
  assert.ok('delta' in out);
  assert.strictEqual(out.delta.available, false);
});
t('不变量2：呈现净化响应体不含绝对分', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({ manifest: MF, baselineScore: 7 });
  const p = ev.present(out);
  assert.ok(!('average' in p), '净化后不得含 average');
  assert.ok(!('metrics' in p), '净化后不得含 metrics');
});
t('不变量3：harness 引擎不 require gdi/eval 模块', () => {
  const files = fs.readdirSync(path.join(__dirname, '../server/engine/harness'));
  for (const f of files.filter(x => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(__dirname, '../server/engine/harness', f), 'utf8');
    const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []).join('\n');
    assert.ok(!/gdi/.test(requires), `${f} 不得 require gdi`);
    assert.ok(!/api\/eval/.test(requires), `${f} 不得 require eval`);
  }
});
t('不变量4：无数据时仅 Manifest 自报项可出分（其余一律 N/A）', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({ manifest: MF });
  const scored = out.metrics.filter(m => m.score !== null).map(m => m.id);
  // A2 的采集口径就是「Manifest 读 trigger_ratio」，纯自报即可判，是协议允许的例外
  assert.deepStrictEqual(scored, ['A2'], `无 Trace 数据时应仅 A2 出分，实际: ${scored}`);
  // 其余全部 N/A（不硬凑分）
  const na = out.metrics.filter(m => m.score === null).length;
  assert.strictEqual(na, 15, 'A/B/C 其余 15 项应全 N/A');
});

console.log(`\n📊 M4 测试：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
