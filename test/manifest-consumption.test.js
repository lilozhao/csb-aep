#!/usr/bin/env node
/**
 * P0-3 · manifest 消费侧测试
 *
 * 判据（DoD）：带 manifest 的 Agent Card → A5 note 出现「按 manifest skills 对照」。
 * 同时守住两条诚实线：
 *   ① 声明不是数据 —— skills 不得改变 A5 分数（无标准任务图仍 N/A）
 *   ② 两套口径不互顶 —— 只有 harness_manifest.aep 能当 §7.2 Manifest 用
 *
 * 运行：node test/manifest-consumption.test.js
 */
'use strict';
const assert = require('assert');
const { extractConfig, fromAgentCard } = require('../server/engine/harness/manifest.js');
const { a5 } = require('../server/engine/harness/robustness.js');
const { HarnessEvaluator } = require('../server/engine/harness');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

const AEP = {
  loop: { max_iterations: 40, loop_guard: 'step-budget' },
  context: { compression: 'summary', trigger_ratio: 0.7, keep_recent_turns: 6 },
  sandbox: { fs_boundary: 'workspace-only', network_egress: 'allowlist', kernel_isolation: false },
  observability: { trace_format: 'csb-trace-v1', fields: ['step', 'tool', 'tokens'] },
};
const CARD = {
  name: '若兰',
  experience_ref: 'csb-memory://experience/ruolan',
  harness_manifest: {
    version: '1.0',
    components: { C1: { readonly: true }, C2: { readonly: true } },
    skills: [{ name: '记忆检索', version: '1.2' }, { name: '论坛发帖' }],
    plugins: [{ name: 'a2a-bridge', version: '5.3.12' }],
    aep: AEP,
  },
};

console.log('\n=== fromAgentCard 取参数面 ===');
t('harness_manifest.aep → 可当 Manifest 用', () => {
  const r = fromAgentCard(CARD);
  assert.strictEqual(r.source, 'harness_manifest.aep');
  assert.strictEqual(r.manifest.loop.max_iterations, 40);
  assert.deepStrictEqual(r.skills.map(s => s.name), ['记忆检索', '论坛发帖']);
  assert.deepStrictEqual(r.plugins.map(p => p.name), ['a2a-bridge']);
  assert.strictEqual(r.experienceRef, 'csb-memory://experience/ruolan');
});
t('只有 components/skills（无 aep）→ manifest=null，不硬凑', () => {
  const r = fromAgentCard({ harness_manifest: { components: { C1: { readonly: true } }, skills: [{ name: 'x' }] } });
  assert.strictEqual(r.manifest, null);
  assert.strictEqual(r.source, 'absent');
  assert.deepStrictEqual(r.skills.map(s => s.name), ['x']);
});
t('裸参数面（无 aep 包装）→ 兼容识别', () => {
  const r = fromAgentCard({ harness_manifest: { ...AEP, skills: [{ name: 's1' }] } });
  assert.strictEqual(r.source, 'harness_manifest');
  assert.strictEqual(r.manifest.sandbox.fs_boundary, 'workspace-only');
});
t('没有 harness_manifest → 全空，不报错', () => {
  const r = fromAgentCard({ name: 'x' });
  assert.strictEqual(r.manifest, null);
  assert.deepStrictEqual(r.skills, []);
  assert.strictEqual(r.source, 'absent');
});

console.log('\n=== extractConfig 带声明面 ===');
t('skills/plugins/experience_ref 进 cfg', () => {
  const cfg = extractConfig({ ...AEP, skills: CARD.harness_manifest.skills, plugins: CARD.harness_manifest.plugins, experience_ref: 'ref://x' });
  assert.strictEqual(cfg.skills.length, 2);
  assert.strictEqual(cfg.plugins.length, 1);
  assert.strictEqual(cfg.experienceRef, 'ref://x');
});
t('缺声明 → 空数组/null，不是 undefined 猜值', () => {
  const cfg = extractConfig(AEP);
  assert.deepStrictEqual(cfg.skills, []);
  assert.deepStrictEqual(cfg.plugins, []);
  assert.strictEqual(cfg.experienceRef, null);
});

console.log('\n=== A5 note（DoD 判据） ===');
t('有 skills 无任务图 → N/A 且 note 含「按 manifest skills 对照」', () => {
  const cfg = extractConfig({ ...AEP, skills: CARD.harness_manifest.skills });
  const r = a5(cfg, {});
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.status, 'N/A');
  assert.ok(r.note.includes('按 manifest skills 对照'), r.note);
  assert.deepStrictEqual(r.manifestSkills, ['记忆检索', '论坛发帖']);
});
t('无 skills 无任务图 → 旧文案不变（不硬塞）', () => {
  const r = a5(extractConfig(AEP), {});
  assert.strictEqual(r.note, '无标准任务图数据 → N/A');
  assert.strictEqual(r.manifestSkills, undefined);
});
t('有 skills 有任务图 → 分数不变 + note 带对照', () => {
  const exp = [{ tool: 'r', args_hash: 'a' }, { tool: 'w', args_hash: 'b' }];
  const base = a5(extractConfig(AEP), { orchestration: [{ actual: exp, expected: exp }] });
  const withSkills = a5(extractConfig({ ...AEP, skills: CARD.harness_manifest.skills }), { orchestration: [{ actual: exp, expected: exp }] });
  assert.strictEqual(base.score, 10);
  assert.strictEqual(withSkills.score, 10); // 声明不得抬分/压分
  assert.ok(withSkills.note.includes('按 manifest skills 对照'));
});

console.log('\n=== Evaluator 整链（agentCard 替代 manifest） ===');
t('只给 agentCard → manifest.valid true + source 标 aep + A5 note 命中', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({ agentCard: CARD });
  assert.strictEqual(out.manifest.valid, true, JSON.stringify(out.manifest.errors));
  assert.strictEqual(out.manifest.source, 'harness_manifest.aep');
  assert.deepStrictEqual(out.manifest.skills, ['记忆检索', '论坛发帖']);
  const m5 = out.metrics.find(m => m.id === 'A5');
  assert.ok(m5.note.includes('按 manifest skills 对照'), m5.note);
  assert.strictEqual(m5.score, null);
});
t('manifest 优先于 agentCard（显式入参不被卡覆盖）', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({ manifest: { ...AEP, skills: [{ name: '显式技能' }] }, agentCard: CARD });
  assert.strictEqual(out.manifest.source, 'request.manifest');
  assert.deepStrictEqual(out.manifest.skills, ['显式技能']);
});
t('两者都缺 → 不崩，valid=false（说明缺什么）', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({});
  assert.strictEqual(out.manifest.valid, false);
  assert.ok(out.manifest.errors.length > 0);
  assert.strictEqual(out.manifest.source, null);
});

console.log('\n=== 诚实性：声明不进平均分 ===');
t('加 skills 前后 average 相同（无新增可计分项）', () => {
  const ev = new HarnessEvaluator();
  const a = ev.evaluate({ manifest: AEP });
  const b = ev.evaluate({ manifest: { ...AEP, skills: CARD.harness_manifest.skills } });
  assert.strictEqual(a.partial.average, b.partial.average);
  assert.strictEqual(a.partial.scoredCount, b.partial.scoredCount);
});

console.log('\n=== 实况口径映射（identity.json 的 aep，不改名就认不出） ===');
const REAL_AEP = {
  declared_at: '2026-10-30',
  loop_limits: {
    max_iterations: null,
    loop_detection: { enabled: true, historySize: 30 },
  },
  compaction: { mode: 'safeguard', trigger_threshold: null, recentTurnsPreserve: 3 },
  sandbox: { mode: 'off', fs_workspace_only: true, network_egress: null, kernel_isolation: null },
  trace: { format: 'jsonl', fields: ['timestamp', 'role', 'usage.input', 'tool_calls', 'errors'] },
};
t('loop_limits/compaction/sandbox/trace → 引擎口径', () => {
  const r = fromAgentCard({ name: '若兰', harness_manifest: { version: '1.0', aep: REAL_AEP, skills: [{ name: 'forum-post' }] } });
  assert.strictEqual(r.source, 'harness_manifest.aep');
  assert.strictEqual(r.manifest.loop.loop_guard, 'loop-detection');
  assert.strictEqual(r.manifest.context.compression, 'safeguard');
  assert.strictEqual(r.manifest.context.keep_recent_turns, 3);
  assert.strictEqual(r.manifest.sandbox.fs_boundary, 'workspace-only');
  assert.strictEqual(r.manifest.observability.trace_format, 'jsonl');
  assert.strictEqual(r.manifest.harness.name, '若兰');
});
t('null 就是 null：max_iterations 不许被 loop_detection 阈值顶替', () => {
  const r = fromAgentCard({ name: 'x', harness_manifest: { aep: REAL_AEP } });
  assert.strictEqual(r.manifest.loop.max_iterations, null);
  assert.strictEqual(r.manifest.sandbox.network_egress, null);
  const v = new HarnessEvaluator().evaluate({ agentCard: { name: 'x', harness_manifest: { aep: REAL_AEP } } });
  assert.strictEqual(v.manifest.valid, false);
  assert.ok(v.manifest.errors.some(e => e.includes('max_iterations')), JSON.stringify(v.manifest.errors));
});
t('trace.fields 不改写：缺 step 就 A7 N/A，不硬凑', () => {
  const ev = new HarnessEvaluator();
  const out = ev.evaluate({ agentCard: { name: 'x', harness_manifest: { aep: REAL_AEP } } });
  assert.ok(out.manifest.na.includes('A7'), JSON.stringify(out.manifest.na));
});

console.log(`\n${fail === 0 ? '✅' : '❌'} manifest-consumption: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
