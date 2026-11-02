'use strict';

/**
 * 判定委托不可扩（P1-5）单测
 *
 * 锁住四件事：
 *   ① 委托只能收窄：scope 越界 / strength 越级 / 口径不同 → 拒
 *   ② 默认不可再委托：delegable=false 时 delegate() 直接拒，链有深度上限
 *   ③ 越界一律新开：没有 extend()，checkReuse 只回「不能」+「缺什么」
 *   ④ 回执把 mandate 绑进签名：换 scope 不破签这件事必须办不到
 */

const test = require('node:test');
const assert = require('node:assert');

const verdict = require('../server/engine/verdict');
const M = require('../server/engine/verdict/mandate');

const POLICY = 'aep-2.0/blackbox';

function rootMandate(over = {}) {
  const r = M.create({
    scope: ['eval', 'report:read'],
    strength: 'attested',
    policy_version: POLICY,
    subject: 'agent:ruolan',
    delegator: 'ruolan',
    delegable: true,
    ...over,
  });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  return r.mandate;
}

// ── 一、scope 包含是机械判定，不做语义猜测 ─────────────────────

test('token 覆盖：只在冒号层级上包含，同前缀不同级不互 cover', () => {
  assert.strictEqual(M.tokenCovers('eval', 'eval'), true);
  assert.strictEqual(M.tokenCovers('eval', 'eval:harness'), true);
  assert.strictEqual(M.tokenCovers('eval', 'eval:harness:gate'), true);
  assert.strictEqual(M.tokenCovers('eval:harness', 'eval:whitebox'), false, '同级不互 cover');
  assert.strictEqual(M.tokenCovers('eval', 'evaluation'), false, '字符串前缀不算，必须是路径前缀');
  assert.strictEqual(M.tokenCovers('', 'eval'), false, '空父不覆盖任何东西');
});

test('scope 必须是子集：缺哪个 token 要说清楚', () => {
  const ok = M.scopeCovers(['eval', 'report'], ['eval:gate']);
  assert.strictEqual(ok.ok, true);
  const bad = M.scopeCovers(['eval'], ['eval:gate', 'publish:forum']);
  assert.strictEqual(bad.ok, false);
  assert.deepStrictEqual(bad.missing, ['publish:forum']);
});

// ── 二、签发与结构校验 ────────────────────────────────────────

test('create：缺 scope / strength / policy_version 一律不合法', () => {
  assert.strictEqual(M.create({ strength: 'gating', policy_version: POLICY }).ok, false);   // 无 scope
  assert.strictEqual(M.create({ scope: ['eval'], policy_version: POLICY }).ok, false);      // 无 strength
  assert.strictEqual(M.create({ scope: ['eval'], strength: 'gating' }).ok, false);          // 无口径
  const bad = M.create({ scope: ['eval'], strength: 'god', policy_version: POLICY });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.refusal.code, M.REFUSE.INVALID_MANDATE);
});

test('create：合法委托 depth=0 且默认不可再委托', () => {
  const m = rootMandate({ delegable: false });
  assert.strictEqual(m.depth, 0);
  assert.strictEqual(m.delegable, false);
  assert.match(m.mandate_id, /^mand_/);
});

// ── 三、委托只能收窄 ─────────────────────────────────────────

test('delegate：scope 收窄 → 允许，depth+1，父级不动', () => {
  const parent = rootMandate();
  const r = M.delegate(parent, { scope: ['eval:gate'], strength: 'gating', delegatee: 'aep' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.mandate.depth, 1);
  assert.strictEqual(r.mandate.parent_mandate_id, parent.mandate_id);
  assert.strictEqual(r.mandate.policy_version, POLICY);
  assert.strictEqual(r.mandate.delegable, false, '默认到这就停');
  assert.strictEqual(parent.depth, 0, '父级不许被改');
});

test('delegate：scope 越界 → 拒绝，并列出缺的 token', () => {
  const parent = rootMandate({ scope: ['eval'] });
  const r = M.delegate(parent, { scope: ['eval:gate', 'publish:forum'], strength: 'gating' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refusal.code, M.REFUSE.OUT_OF_SCOPE);
  assert.deepStrictEqual(r.refusal.missing, ['publish:forum']);
});

test('delegate：强度只能降不能升', () => {
  const parent = rootMandate({ strength: 'gating' });
  const up = M.delegate(parent, { scope: ['eval'], strength: 'attested' });
  assert.strictEqual(up.ok, false);
  assert.strictEqual(up.refusal.code, M.REFUSE.STRENGTH_EXCEEDED);
  const down = M.delegate(parent, { scope: ['eval'], strength: 'advisory' });
  assert.strictEqual(down.ok, true);
  assert.strictEqual(down.mandate.strength, 'advisory');
});

test('delegate：口径版本不同 → 拒绝（换口径必须新开判定）', () => {
  const parent = rootMandate();
  const r = M.delegate(parent, { scope: ['eval'], strength: 'gating', policy_version: 'aep-3.0/blackbox' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refusal.code, M.REFUSE.POLICY_MISMATCH);
});

// ── 四、默认不可再委托 + 深度封顶 ────────────────────────────

test('delegable=false 的委托不能再转（审计指出的「delegator 可无限转发」）', () => {
  const parent = rootMandate({ delegable: false });
  const r = M.delegate(parent, { scope: ['eval:gate'], strength: 'gating' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refusal.code, M.REFUSE.NOT_DELEGABLE);
  assert.match(r.refusal.reason, /新开/);
});

test('可再委托也要受深度上限约束（默认 max_depth=0 → 一级就停）', () => {
  const parent = rootMandate({ delegable: true });
  const first = M.delegate(parent, { scope: ['eval:gate'], strength: 'gating', delegable: true });
  assert.strictEqual(first.ok, true);
  // 一级委托后 depth=1，默认 max_depth=0 → 不能再往下
  const second = M.delegate(first.mandate, { scope: ['eval:gate'], strength: 'gating', max_depth: 1 });
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.refusal.code, M.REFUSE.DEPTH_EXCEEDED);
  // 显式放宽到 2 才允许 → 但每级都要显式 delegable
  const third = M.delegate(first.mandate, { scope: ['eval:gate'], strength: 'gating', max_depth: 2, delegable: true });
  assert.strictEqual(third.ok, true);
  assert.strictEqual(third.mandate.depth, 2);
});

test('撤销 / 过期：delegate 与 checkReuse 都要拒', () => {
  const revoked = rootMandate({ revoked: true });
  assert.strictEqual(M.delegate(revoked, { scope: ['eval'], strength: 'advisory' }).refusal.code, M.REFUSE.REVOKED);

  const expired = rootMandate({ expires_at: '2020-01-01T00:00:00.000Z' });
  assert.strictEqual(M.delegate(expired, { scope: ['eval'], strength: 'advisory' }).refusal.code, M.REFUSE.EXPIRED);
  assert.strictEqual(M.checkReuse(expired, { scope: ['eval:read'] }).code, M.REFUSE.EXPIRED);
});

// ── 五、复用闸门：越界一律新开 ──────────────────────────────

test('checkReuse：范围内 + 强度够 + 同口径 → 可复用', () => {
  const m = rootMandate();
  const r = M.checkReuse(m, { scope: ['eval:gate'], strength: 'gating' });
  assert.strictEqual(r.reusable, true);
  assert.strictEqual(r.code, null);
  assert.match(r.digest, /^mand_/);
});

test('checkReuse：越界 → 不可复用，且给「缺什么」，不给扩展入口', () => {
  const m = rootMandate({ scope: ['eval'] });
  const r = M.checkReuse(m, { scope: ['eval:gate', 'publish:forum'], strength: 'gating' });
  assert.strictEqual(r.reusable, false);
  assert.strictEqual(r.code, M.REFUSE.OUT_OF_SCOPE);
  assert.deepStrictEqual(r.missing, ['publish:forum']);
  assert.match(r.reason, /越界一律新开/);
  // 结构上就没有扩展能力：模块不导出任何 extend/patch/upgrade 函数
  const exported = Object.keys(M);
  assert.ok(!exported.some((k) => /extend|expand|upgrade|patch|widen/i.test(k)), `导出里不许有扩展入口：${exported.join(',')}`);
});

test('checkReuse：不声明用途 ≠ 什么都能用', () => {
  const r = M.checkReuse(rootMandate(), {});
  assert.strictEqual(r.reusable, false);
  assert.strictEqual(r.code, M.REFUSE.OUT_OF_SCOPE);
});

test('checkReuse：强度不够要拒（advisory 不能当门禁）', () => {
  const m = rootMandate({ strength: 'advisory' });
  const r = M.checkReuse(m, { scope: ['eval'], strength: 'attested' });
  assert.strictEqual(r.reusable, false);
  assert.strictEqual(r.code, M.REFUSE.STRENGTH_EXCEEDED);
});

test('checkReuse：口径不同要拒（不猜「哪个更新」）', () => {
  const r = M.checkReuse(rootMandate(), { scope: ['eval'], policy_version: 'aep-2.1/blackbox' });
  assert.strictEqual(r.reusable, false);
  assert.strictEqual(r.code, M.REFUSE.POLICY_MISMATCH);
});

// ── 六、回执集成：mandate 必须在签名之内 ────────────────────

function receipt(over = {}) {
  return verdict.buildReceipt({
    verdict: verdict.VERDICT.PASS,
    score: 0.92,
    policy: { version: POLICY },
    collector: { id: 'openclaw', version: '1.0.0' },
    telemetry_tier: 'hook',
    config: { mode: 'blackbox', weights: { a: 1 } },
    ...over,
  }, { secret: 'test-secret' });
}

test('buildReceipt：每份回执都带 mandate（没有就用保守默认，且标记 derived）', () => {
  const r = receipt();
  assert.ok(r.mandate, '回执必须带 mandate');
  assert.deepStrictEqual(r.mandate.scope, ['eval:read']);
  assert.strictEqual(r.mandate.strength, 'advisory');
  assert.strictEqual(r.mandate_derived, true);
  assert.strictEqual(r.mandate_valid, true);
  assert.strictEqual(r.policy_version, POLICY, '默认委托的口径必须跟回执一致');
  assert.match(r.mandate_digest, /^mand_/);
});

test('buildReceipt：显式 mandate 原样进回执（不改写、不静默丢弃）', () => {
  const m = rootMandate({ scope: ['eval:gate'], strength: 'gating' }).mandate || rootMandate({ scope: ['eval:gate'], strength: 'gating' });
  const r = receipt({ mandate: m });
  assert.deepStrictEqual(r.mandate.scope, ['eval:gate']);
  assert.strictEqual(r.mandate.strength, 'gating');
  assert.strictEqual(r.mandate_derived, false);
  assert.strictEqual(r.mandate_digest, M.digestOf(m));
});

test('verifyReceipt：签名 + mandate 双验，改 scope 必须被发现', () => {
  const r = receipt();
  assert.strictEqual(verdict.verifyReceipt(r, 'test-secret').ok, true);

  const tampered = JSON.parse(JSON.stringify(r));
  tampered.mandate.scope = ['*'];
  const v = verdict.verifyReceipt(tampered, 'test-secret');
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'mandate_tampered');
});

test('verifyReceipt：整块换掉 mandate（哪怕摘要一起换）也会破签', () => {
  const r = receipt({ mandate: rootMandate({ scope: ['eval:read'], strength: 'advisory' }) });
  const other = M.create({ scope: ['*'], strength: 'attested', policy_version: POLICY }).mandate;
  const swapped = JSON.parse(JSON.stringify(r));
  swapped.mandate = M.normalize(other);
  swapped.mandate_digest = M.digestOf(other);   // 连摘要一起伪造
  const v = verdict.verifyReceipt(swapped, 'test-secret');
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'bad_signature', 'mandate_digest 在签名范围内，换块必破签');
});

test('verifyReceipt：无 mandate 的旧回执仍验得过（向后兼容）', () => {
  const legacy = {
    receipt_id: 'rcpt_legacy',
    issued_at: '2026-11-01T00:00:00.000Z',
    policy_version: POLICY,
    chrn_: 'chrn_abc',
    collector_id: 'c',
    collector_version: '1',
    telemetry_tier: 'hook',
    verdict: 'PASS',
    score: 0.9,
    evidence_digests: {},
  };
  // 按 P0-1 口径手工签（无 mandate 键）
  const crypto = require('crypto');
  const payload = JSON.stringify({ verdict: legacy.verdict, evidence_digests: {}, policy_version: POLICY });
  legacy.signature = crypto.createHmac('sha256', 's').update(payload).digest('hex');
  assert.strictEqual(verdict.verifyReceipt(legacy, 's').ok, true);
});

test('纯对象往返：mandate 与回执 JSON 序列化前后行为一致', () => {
  const m = rootMandate();
  const roundTrip = JSON.parse(JSON.stringify(m));
  assert.deepStrictEqual(M.normalize(roundTrip), M.normalize(m));
  assert.strictEqual(M.digestOf(roundTrip), M.digestOf(m));
  assert.deepStrictEqual(
    M.checkReuse(roundTrip, { scope: ['eval'], strength: 'gating' }),
    M.checkReuse(m, { scope: ['eval'], strength: 'gating' }),
  );
});
