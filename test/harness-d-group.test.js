#!/usr/bin/env node
/**
 * harness-d-group.test.js —— 子群 D（改进质量）验收 · Harness² 对照表 P0 #5
 *
 * 对应 Harness² 对照表 P0 #5：
 *   「csb-aep 加『改进可迁移性』」——判断升级是真有效还是过拟合
 *   判据（原文）：『A 任务学到的改进迁到 B 是否仍有效』必须有基线对照，无对照 → N/A
 *
 * 现状：improvement.js 于 2026-10-20 新增（D1/D2），但：
 *   ① 无任何测试
 *   ② **未接入 evaluate()** —— groupD 导出但从未被调用（死代码）
 * 本文件第一部分锁定「算法正确性」，第二部分锁定「接线」。
 *
 * 用法：node --test test/harness-d-group.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { groupD, d1, d2 } = require(path.join(__dirname, '..', 'server/engine/harness/improvement.js'));

// ── D1 改进可迁移性 ─────────────────────────────────────

test('D1: 缺跨任务对照 → N/A（不判过拟合）', () => {
  const r = d1({ gainA: 5.1, basis: '绝对分' });
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.status, 'na');
  assert.match(r.note, /缺跨任务对照/);
});

test('D1: 缺计量口径 basis → N/A（防绝对分/相对比混算）', () => {
  const r = d1({ gainA: 5.1, gainB: 4.0 });
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.status, 'na');
  assert.match(r.note, /basis/);
});

test('D1: B 未原样搬用同一 harness → N/A（不构成迁移）', () => {
  const r = d1({ gainA: 5, gainB: 5, basis: '绝对分', transferred: false });
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.status, 'na');
  assert.match(r.note, /不构成迁移/);
});

test('D1: 增益非数值 → N/A', () => {
  const r = d1({ gainA: 'abc', gainB: 3, basis: '绝对分' });
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.status, 'na');
});

test('D1: 源任务增益为 0 → 0 分（"改进没生效"，不是 N/A）', () => {
  const r = d1({ gainA: 0, gainB: 3, basis: '绝对分' });
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.status, 'no_gain');
  assert.match(r.note, /未生效/);
});

test('D1: 迁移保留率 ≥80% → 10 分', () => {
  const r = d1({ gainA: 10, gainB: 9, basis: '绝对分' });
  assert.strictEqual(r.score, 10);
  assert.strictEqual(r.ratio, 0.9);
});

test('D1: 保留率 ≥50% → 7 分', () => {
  assert.strictEqual(d1({ gainA: 10, gainB: 6, basis: '绝对分' }).score, 7);
});

test('D1: 保留率 ≥20% → 5 分', () => {
  assert.strictEqual(d1({ gainA: 10, gainB: 3, basis: '绝对分' }).score, 5);
});

test('D1: 保留率 <20% → 2 分（过拟合）', () => {
  const r = d1({ gainA: 10, gainB: 1, basis: '绝对分' });
  assert.strictEqual(r.score, 2);
  assert.strictEqual(r.ratio, 0.1);
});

test('D1: 迁移后反而变差（负增益）→ 2 分，比值可为负', () => {
  const r = d1({ gainA: 10, gainB: -2, basis: '绝对分' });
  assert.strictEqual(r.score, 2);
  assert.ok(r.ratio < 0);
});

test('D1: 边界值 0.80 恰好 → 10 分', () => {
  assert.strictEqual(d1({ gainA: 10, gainB: 8, basis: '绝对分' }).score, 10);
});

test('D1: 边界值 0.50 恰好 → 7 分', () => {
  assert.strictEqual(d1({ gainA: 10, gainB: 5, basis: '绝对分' }).score, 7);
});

// ── D2 自我修改合规性 ───────────────────────────────────

test('D2: 无变更记录 → N/A（不是 0）', () => {
  const r = d2({});
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.status, 'na');
});

test('D2: 空变更数组 → 10 分（不做事不扣分）', () => {
  const r = d2({ changes: [] });
  assert.strictEqual(r.score, 10);
  assert.strictEqual(r.status, 'ok');
});

test('D2: 改 C1 → 0 分（红线，不看内容好坏）', () => {
  const r = d2({ changes: [{ component: 'C1', probe: true, evidence: true, approved: true, rollback: true }] });
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.status, 'violation');
  assert.strictEqual(r.violations[0].reason, 'readonly_component');
});

test('D2: 改 C2 → 0 分', () => {
  const r = d2({ changes: [{ component: 'C2', probe: true, evidence: true, approved: true, rollback: true }] });
  assert.strictEqual(r.score, 0);
});

test('D2: 改 C3 但四项齐全 → 10 分', () => {
  const r = d2({ changes: [{ component: 'C3', probe: true, evidence: true, approved: true, rollback: true }] });
  assert.strictEqual(r.score, 10);
});

test('D2: 改 C3 缺任一环节 → 7 分（不完整）', () => {
  const r = d2({ changes: [{ component: 'C3', probe: true, evidence: true, approved: true, rollback: false }] });
  assert.strictEqual(r.score, 7);
  assert.strictEqual(r.status, 'incomplete');
  assert.deepStrictEqual(r.missing[0].missing, 'rollback');
});

test('D2: 越界优先于不完整（有违规就 0 分，不看缺什么）', () => {
  const r = d2({
    changes: [
      { component: 'C1', probe: true, evidence: true, approved: true, rollback: true },
      { component: 'C3', probe: false, evidence: false, approved: false, rollback: false },
    ],
  });
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.status, 'violation');
});

// ── 群汇总 ─────────────────────────────────────────────

test('groupD: 两项都 N/A → 总分 null（不聚合，不给 0）', () => {
  const r = groupD({ transfer: {}, selfModify: {} });
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.status, 'na');
});

test('groupD: 只有 D1 有效 → 只用 D1 算均分', () => {
  const r = groupD({
    transfer: { gainA: 10, gainB: 9, basis: '绝对分' },
    selfModify: {},
  });
  assert.strictEqual(r.score, 10);
});

test('groupD: D1=10, D2=0 → 均分 5', () => {
  const r = groupD({
    transfer: { gainA: 10, gainB: 9, basis: '绝对分' },
    selfModify: { changes: [{ component: 'C1', probe: true, evidence: true, approved: true, rollback: true }] },
  });
  assert.strictEqual(r.score, 5);
});

// ── 接线：evaluate() 是否真的产出 D 群 ──────────────────

test('接线: evaluate() 应产出 improvement（D 群）字段', () => {
  const { HarnessEvaluator } = require(path.join(__dirname, '..', 'server/engine/harness/index.js'));
  const ev = new HarnessEvaluator();
  const result = ev.evaluate({
    manifest: {
      name: 'test-harness', version: '1.0.0',
      components: { C1: { readonly: true }, C2: { readonly: true } },
    },
    traces: [],
  });
  assert.ok(result.improvement, 'evaluate() 输出应含 improvement 字段');
  assert.strictEqual(result.improvement.group, 'D');
  // items 是对象（按 id 索引），不是数组——D1/D2 都在
  assert.ok(result.improvement.items && typeof result.improvement.items === 'object');
  assert.ok(result.improvement.items.D1, '应含 D1 改进可迁移性');
  assert.ok(result.improvement.items.D2, '应含 D2 自我修改合规性');
  assert.strictEqual(result.improvement.draft, true, 'D 群阈值未评审 → 必须标 draft');
  assert.strictEqual(result.improvement.status, 'na', '无对照数据 → 整体 N/A，不给 0');

  // 关键：D 群不得混进 average（不同量纲）
  const scoredIds = result.metrics.map(m => m.id);
  assert.ok(!scoredIds.includes('D1'), 'D1 不得进入 metrics（否则被 average 稀释）');
});
