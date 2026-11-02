#!/usr/bin/env node
/**
 * P0-1 验收：判定内核（三态 + 回执 + 门）
 *
 * 判据（机械可核）：
 *   1. 三态只有三个值，UNDECIDED 原因封闭枚举
 *   2. 「没测到」不进分母但计覆盖率；覆盖率不足 → insufficient
 *   3. 回执 7 个必填字段缺任一 → 结论降为 UNDECIDED/missing_field
 *   4. 回执签名可被第三方独立验真（不需要信我们）
 *   5. 信号不得越级：低档位不得出 FAIL；过程信号不改结论
 *   6. 形状约束：纯对象进出、不 require AEP 私有模块、无 ../ 上跳
 *   7. 门：PASS=0 / FAIL=1 / UNDECIDED=2
 *
 * 运行：node --test test/verdict.test.js   或   node test/verdict.test.js
 */

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const V = require('../server/engine/verdict/index.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

console.log('[verdict] P0-1 验收\n');

// ── 1. 三态定义 ──
t('三态只有 PASS/FAIL/UNDECIDED', () => {
  assert.deepStrictEqual(Object.values(V.VERDICT).sort(), ['FAIL', 'PASS', 'UNDECIDED']);
});

t('UNDECIDED 原因是封闭枚举（不许自由发挥）', () => {
  const valid = Object.values(V.UNDECIDED_REASON);
  assert.ok(valid.includes('unreachable'));
  const v = V.undecided('unreachable');
  assert.strictEqual(v.verdict, 'UNDECIDED');
  assert.strictEqual(v.reason, 'unreachable');
  assert.strictEqual(v.score, null, 'UNDECIDED 不得带分数');
});

// ── 2. 聚合：没测到 ≠ 做错 ──
t('JUDGE: UNDECIDED 不进分母（没测到≠做错）', () => {
  const items = [V.pass(1), V.pass(1), V.undecided('unreachable'), V.undecided('rate_limited')];
  const a = V.aggregate(items);
  assert.strictEqual(a.decided, 2, '决定项应为 2');
  assert.strictEqual(a.undecided, 2);
  assert.strictEqual(a.score, 1, '分数只按决定项算，不应被 UNDECIDED 拉成 0.5');
  assert.strictEqual(a.coverage, 0.5, '覆盖率 = 2/4');
  assert.strictEqual(a.insufficient, true, '覆盖率 0.5 < 0.6 应标 insufficient');
});

t('JUDGE: 全部 UNDECIDED 时 score=null 而非 0', () => {
  const a = V.aggregate([V.undecided('unreachable'), V.undecided('timeout')]);
  assert.strictEqual(a.score, null, '全没测到必须是 null，不能是 0');
  assert.strictEqual(a.verdict, 'UNDECIDED');
  assert.strictEqual(a.coverage, 0);
});

t('JUDGE: 拔端口场景 —— 目标是 unreachable，不得变 FAIL', () => {
  const items = [V.pass(1), V.undecided('unreachable'), V.pass(1)];
  const a = V.aggregate(items);
  assert.strictEqual(a.failed, 0, '不应有任何 FAIL');
  assert.strictEqual(a.verdict, 'PASS');
  assert.deepStrictEqual(a.undecidedReasons, { unreachable: 1 });
});

// ── 3. 回执必填 ──
const FULL = {
  verdict: 'PASS',
  score: 0.9,
  policy: { version: 'aep-2.4.2' },
  collector: { id: 'openclaw', version: '1.0' },
  telemetry_tier: 'protocol',
  config: { weights: { a: 1 } },
  evidence: { blackbox: 'sha256:aa' },
};

t('JUDGE: 完整输入 → 回执 complete=true 且 7 必填全在', () => {
  const r = V.buildReceipt({ ...FULL }, { secret: 's3cret' });
  assert.strictEqual(r.complete, true, `缺字段: ${r.missing_fields}`);
  for (const k of V.RECEIPT_REQUIRED) assert.ok(r[k] !== undefined && r[k] !== null, `${k} 缺失`);
  assert.strictEqual(r.verdict, 'PASS');
  assert.strictEqual(r.unsigned, false);
});

t('JUDGE: 缺 policy_version → 结论降为 UNDECIDED/missing_field（不抛错）', () => {
  const bad = { ...FULL };
  delete bad.policy;
  const r = V.buildReceipt(bad, { secret: 's' });
  assert.strictEqual(r.complete, false);
  assert.strictEqual(r.verdict, 'UNDECIDED');
  assert.strictEqual(r.reason, 'missing_field');
  assert.ok(r.missing_fields.includes('policy_version'));
  assert.strictEqual(r.verdict_original, 'PASS', '要保留原判定，便于追查');
});

t('chrn_ 是配置指纹且稳定（同配置同指纹）', () => {
  const a = V.configFingerprint({ weights: { a: 1, b: 2 } });
  const b = V.configFingerprint({ weights: { b: 2, a: 1 } });
  assert.match(a, /^chrn_[0-9a-f]{16}$/);
  assert.strictEqual(a, b, '键序不同但内容相同 → 指纹必须相同');
});

// ── 4. 独立验真 ──
t('JUDGE: 第三方可独立验真（不需要信我们）', () => {
  const r = V.buildReceipt({ ...FULL }, { secret: 's3cret' });
  assert.strictEqual(V.verifyReceipt(r, 's3cret').ok, true);
  assert.strictEqual(V.verifyReceipt(r, 'wrong').ok, false);
});

t('JUDGE: 改 verdict 后签名失效', () => {
  const r = V.buildReceipt({ ...FULL }, { secret: 's3cret' });
  const forged = { ...r, verdict: 'FAIL' };
  assert.strictEqual(V.verifyReceipt(forged, 's3cret').reason, 'bad_signature');
});

t('JUDGE: 改 evidence_digests 后签名失效', () => {
  const r = V.buildReceipt({ ...FULL }, { secret: 's3cret' });
  const forged = { ...r, evidence_digests: { blackbox: 'sha256:evil' } };
  assert.strictEqual(V.verifyReceipt(forged, 's3cret').ok, false);
});

t('无密钥 → unsigned:true（诚实，不假装）', () => {
  const r = V.buildReceipt({ ...FULL });
  assert.strictEqual(r.unsigned, true);
  assert.strictEqual(V.verifyReceipt(r, null).reason, 'unsigned');
});

// ── 5. 信号不得越级 ──
t('JUDGE: 低档位(NONE) + 目标失败 → 必须 UNDECIDED 不是 FAIL', () => {
  const v = V.applyTierCeiling(V.fail(0), V.TIER.NONE);
  assert.strictEqual(v.verdict, 'UNDECIDED');
  assert.strictEqual(v.reason, 'insufficient_telemetry');
  assert.ok(v.process_flag.includes('tier_downgraded'));
});

t('JUDGE: 低档位(PTY) + 失败 → 也降为 UNDECIDED', () => {
  assert.strictEqual(V.applyTierCeiling(V.fail(0), V.TIER.PTY).verdict, 'UNDECIDED');
});

t('高档位(HOOK) + 失败 → 保留 FAIL（看得清就该判错）', () => {
  assert.strictEqual(V.applyTierCeiling(V.fail(0), V.TIER.HOOK).verdict, 'FAIL');
});

t('低档位 + PASS → 保留 PASS（保守方向不越级）', () => {
  assert.strictEqual(V.applyTierCeiling(V.pass(0.8), V.TIER.NONE).verdict, 'PASS');
});

t('JUDGE: 过程信号只加标记，不改结论', () => {
  const v = V.attachProcessFlags(V.pass(0.9), ['repeat', { type: 'drift' }, 'stall']);
  assert.strictEqual(v.verdict, 'PASS', '过程可疑不等于结果错了');
  assert.deepStrictEqual(v.process_flag, ['repeat', 'drift', 'stall']);
});

// ── 6. 形状约束（可抽出性）──
const SRC = fs.readFileSync(path.join(__dirname, '../server/engine/verdict/index.js'), 'utf8');

t('JUDGE: 不 require 任何 AEP 私有模块（可抽出）', () => {
  const requires = [...SRC.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2]);
  // P1-5：允许同目录兄弟模块（./mandate）—— 抽成 csb-verdict 包时它们一起走。
  //   判定标准仍然是「能不能整体抽出去」：node 内置 + 同目录 = 能；../ 或仓内其他路径 = 不能。
  const external = requires.filter((r) => !r.startsWith('.'));
  const local = requires.filter((r) => r.startsWith('.'));
  assert.deepStrictEqual(external, ['crypto'], `只应依赖 node 内置，实际: ${JSON.stringify(requires)}`);
  for (const r of local) assert.match(r, /^\.\/[a-z-]+$/, `同目录兄弟模块才允许，实际: ${r}`);
});

t('JUDGE: 无 ../ 相对上跳', () => {
  const ups = [...SRC.matchAll(/require\(['"](\.\.[^'"]*)['"]\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(ups, [], `不应有上跳 require，实际: ${JSON.stringify(ups)}`);
});

t('JUDGE: 纯对象进出（JSON 往返后行为一致）', () => {
  const roundtrip = (x) => JSON.parse(JSON.stringify(x));
  const a1 = V.aggregate([V.pass(1), V.undecided('unreachable')]);
  const a2 = V.aggregate([roundtrip(V.pass(1)), roundtrip(V.undecided('unreachable'))]);
  assert.deepStrictEqual(a1, a2, '聚合结果不应依赖对象身份');

  const r1 = V.buildReceipt({ ...FULL, receipt_id: 'fixed' }, { secret: 's' });
  const r2 = V.buildReceipt(roundtrip({ ...FULL, receipt_id: 'fixed' }), { secret: 's' });
  assert.deepStrictEqual(r1, r2, '同一输入往返后应产出同一回执');
});

t('返回值不含 Date / 类实例 / undefined', () => {
  const r = V.buildReceipt({ ...FULL }, { secret: 's' });
  const bad = [];
  (function walk(o, p) {
    if (o === undefined) { bad.push(p + '=undefined'); return; }
    if (o instanceof Date) { bad.push(p + '=Date'); return; }
    if (o && typeof o === 'object') {
      if (o.constructor && !['Object', 'Array'].includes(o.constructor.name)) bad.push(p + '=' + o.constructor.name);
      for (const k of Object.keys(o)) walk(o[k], p + '.' + k);
    }
  })(r, '$');
  assert.deepStrictEqual(bad, []);
});

// ── 7. 门 ──
t('JUDGE: 门 —— PASS=0 / FAIL=1 / UNDECIDED=2', () => {
  assert.strictEqual(V.toExitCode('PASS'), 0);
  assert.strictEqual(V.toExitCode('FAIL'), 1);
  assert.strictEqual(V.toExitCode('UNDECIDED'), 2, '判不了必须是 2，不能和做错了混');
});

t('JUDGE: 门能拒绝并说明理由（永远放行的门不是门）', () => {
  const g1 = V.gate(V.fail(0, '答案错误'));
  assert.strictEqual(g1.blocked, true);
  assert.strictEqual(g1.status, 'blocked');
  assert.match(g1.reason, /答案错误/);

  const g2 = V.gate(V.undecided('unreachable'));
  assert.strictEqual(g2.exitCode, 2);
  assert.match(g2.reason, /判不了：unreachable/);

  const g3 = V.gate(V.pass(0.9));
  assert.strictEqual(g3.blocked, false);
  assert.strictEqual(g3.status, 'ready');
});

// ── 输出（格式必须与 aep 的 node --test 兼容）──
console.log(`\n通过: ${pass}`);
console.log(`失败: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
