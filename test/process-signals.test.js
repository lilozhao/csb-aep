/**
 * P1-2 过程监督三信号 —— 判据测试
 *
 * 这里测的不是"算法聪不聪明"，而是**判据诚不诚实**：
 *   ① unknown ≠ absent（缺数据不许记成清白）
 *   ② drift 没有参照系就不许判（凭序列猜 = 诬告）
 *   ③ 每个 present 都必须带可复核证据（没有证据的标记等于指控无据）
 *   ④ 接进 harness 后不改任何分数（过程不污染结论）
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const P = require('../server/engine/process-signals.js');
const { HarnessEvaluator } = require('../server/engine/harness');

/** 造 trace 的小工具 */
const mk = (steps, { finished = true } = {}) => ({
  task_id: 't',
  model: 'm',
  steps: steps.map((s, i) => ({
    i: i + 1,
    tool: s.t === undefined ? null : s.t,
    args_hash: s.a === undefined ? null : s.a,
    tokens: 10,
    latency_ms: 100,
    error: s.e || null,
  })),
  total_tokens: steps.length * 10,
  finished,
});

// ── ① 三态语义 ────────────────────────────────────────────────
test('缺 args_hash → repeat 是 unknown，不是 absent', () => {
  const r = P.analyzeProcess(mk([{ t: 'read' }, { t: 'read' }, { t: 'read' }]));
  assert.strictEqual(r.signals.repeat.state, P.SIGNAL.UNKNOWN);
  assert.strictEqual(r.signals.repeat.reason, P.REASON.NO_ARGS_HASH);
  assert.ok(r.unknown.includes('repeat'));
  assert.ok(!r.flags.includes('repeat'), 'unknown 不许混进 flags');
});

test('无 trace → 三个信号全 unknown，flags 为空', () => {
  const r = P.analyzeProcess({});
  assert.strictEqual(r.valid, false);
  assert.deepStrictEqual(r.flags, []);
  assert.deepStrictEqual(r.unknown.sort(), ['drift', 'repeat', 'stall']);
});

test('unknown 与 absent 在输出里是可区分的两个字段', () => {
  const r = P.analyzeProcess(mk([{ t: 'read', a: '1' }, { t: 'write', a: '2' }]));
  assert.strictEqual(r.signals.repeat.state, P.SIGNAL.ABSENT);
  assert.strictEqual(r.signals.drift.state, P.SIGNAL.UNKNOWN);
  assert.ok(!r.unknown.includes('repeat'));
  assert.ok(r.unknown.includes('drift'));
});

// ── ② repeat ──────────────────────────────────────────────────
test('同一 (tool,args_hash) 出现 3 次 → repeat present，带次数与步号', () => {
  const r = P.analyzeProcess(mk([
    { t: 'read', a: 'x' }, { t: 'read', a: 'x' }, { t: 'read', a: 'x' },
  ]));
  assert.strictEqual(r.signals.repeat.state, P.SIGNAL.PRESENT);
  const ev = r.signals.repeat.evidence.find((e) => e.kind === 'same_call');
  assert.ok(ev, '缺 same_call 证据');
  assert.strictEqual(ev.occurrences, 3);
  assert.deepStrictEqual(ev.steps, [1, 2, 3]);
});

test('同 tool 不同 args 不算重复（遍历文件是正常行为）', () => {
  const r = P.analyzeProcess(mk([
    { t: 'read', a: 'a' }, { t: 'read', a: 'b' }, { t: 'read', a: 'c' }, { t: 'read', a: 'd' },
  ]));
  assert.strictEqual(r.signals.repeat.state, P.SIGNAL.ABSENT);
});

test('2 次不算重复（阈值默认 3，且阈值可配）', () => {
  const two = mk([{ t: 'read', a: 'x' }, { t: 'read', a: 'x' }]);
  assert.strictEqual(P.analyzeProcess(two).signals.repeat.state, P.SIGNAL.ABSENT);
  assert.strictEqual(
    P.analyzeProcess(two, { repeatMinOccurrences: 2 }).signals.repeat.state,
    P.SIGNAL.PRESENT,
    '阈值覆盖失效'
  );
});

test('A→B 循环重复 3 遍 → 报 cycle，且长度/遍数正确', () => {
  const r = P.analyzeProcess(mk([
    { t: 'a', a: '1' }, { t: 'b', a: '2' },
    { t: 'a', a: '1' }, { t: 'b', a: '2' },
    { t: 'a', a: '1' }, { t: 'b', a: '2' },
  ]));
  const cyc = r.signals.repeat.evidence.find((e) => e.kind === 'cycle');
  assert.ok(cyc, '缺 cycle 证据');
  assert.strictEqual(cyc.length, 2);
  assert.strictEqual(cyc.repeats, 3);
});

test('长循环优先报（长度 2 与 3 同时成立时报更长的）', () => {
  const r = P.analyzeProcess(mk([
    { t: 'a', a: '1' }, { t: 'b', a: '2' }, { t: 'c', a: '3' },
    { t: 'a', a: '1' }, { t: 'b', a: '2' }, { t: 'c', a: '3' },
    { t: 'a', a: '1' }, { t: 'b', a: '2' }, { t: 'c', a: '3' },
  ]));
  const cyc = r.signals.repeat.evidence.find((e) => e.kind === 'cycle');
  assert.strictEqual(cyc.length, 3);
  assert.strictEqual(cyc.repeats, 3);
});

// ── ③ stall ───────────────────────────────────────────────────
test('连续 3 次错误 → stall present', () => {
  const r = P.analyzeProcess(mk([
    { t: 'a', a: '1' }, { t: 'b', a: '2', e: 'E1' }, { t: 'b', a: '2', e: 'E2' }, { t: 'b', a: '2', e: 'E3' },
  ], { finished: false }));
  assert.strictEqual(r.signals.stall.state, P.SIGNAL.PRESENT);
  const ev = r.signals.stall.evidence.find((e) => e.kind === 'consecutive_errors');
  assert.ok(ev);
  assert.strictEqual(ev.count, 3);
});

test('零星错误不算 stall（错误不连续）', () => {
  const r = P.analyzeProcess(mk([
    { t: 'a', a: '1', e: 'E1' }, { t: 'b', a: '2' }, { t: 'c', a: '3', e: 'E2' },
    { t: 'd', a: '4' }, { t: 'e', a: '5' },
  ], { finished: true }));
  assert.strictEqual(r.signals.stall.state, P.SIGNAL.ABSENT);
});

test('步数超限且未完成 → stall present', () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ t: 'step', a: String(i) }));
  const r = P.analyzeProcess(mk(many, { finished: false }));
  assert.strictEqual(r.signals.stall.state, P.SIGNAL.PRESENT);
  assert.ok(r.signals.stall.evidence.some((e) => e.kind === 'step_limit_no_finish'));
});

test('既无 error 也无 finished → stall unknown', () => {
  const trace = { steps: [{ i: 1, tool: 'a', args_hash: '1', tokens: 5 }] }; // 无 finished 字段
  const r = P.analyzeProcess(trace);
  assert.strictEqual(r.signals.stall.state, P.SIGNAL.UNKNOWN);
  assert.strictEqual(r.signals.stall.reason, P.REASON.NO_ERROR_SIGNAL);
});

// ── ④ drift（最容易做假的一个）────────────────────────────────
test('未声明范围 → drift unknown，不是 absent', () => {
  const r = P.analyzeProcess(mk([{ t: 'shell', a: '1' }, { t: 'shell', a: '2' }]));
  assert.strictEqual(r.signals.drift.state, P.SIGNAL.UNKNOWN);
  assert.strictEqual(r.signals.drift.reason, P.REASON.NO_SCOPE_DECLARED);
});

test('声明范围后，范围内 → absent', () => {
  const r = P.analyzeProcess(
    mk([{ t: 'read', a: '1' }, { t: 'read', a: '2' }]),
    { scope: { expectedTools: ['read'] } }
  );
  assert.strictEqual(r.signals.drift.state, P.SIGNAL.ABSENT);
});

test('越界 1 次 → 不计漂移，但保留 observation（可复核）', () => {
  const r = P.analyzeProcess(
    mk([{ t: 'read', a: '1' }, { t: 'shell', a: '2' }]),
    { scope: { expectedTools: ['read'] } }
  );
  assert.strictEqual(r.signals.drift.state, P.SIGNAL.ABSENT);
  assert.strictEqual(r.signals.drift.observation.outOfScopeCount, 1);
});

test('越界 ≥2 次 → drift present，带工具名与步号', () => {
  const r = P.analyzeProcess(
    mk([{ t: 'read', a: '1' }, { t: 'shell', a: '2' }, { t: 'shell', a: '3' }]),
    { scope: { expectedTools: ['read'] } }
  );
  assert.strictEqual(r.signals.drift.state, P.SIGNAL.PRESENT);
  const ev = r.signals.drift.evidence[0];
  assert.deepStrictEqual(ev.tools, ['shell']);
  assert.deepStrictEqual(ev.steps, [2, 3]);
});

// ── ⑤ 与 verdict 的接口 ───────────────────────────────────────
test('toProcessSignals 产出 verdict 可直接消费的形状', () => {
  const r = P.analyzeProcess(mk([
    { t: 'read', a: 'x' }, { t: 'read', a: 'x' }, { t: 'read', a: 'x' },
  ]));
  assert.deepStrictEqual(P.toProcessSignals(r), [{ type: 'repeat' }]);
});

test('verdict.attachProcessFlags 能吃掉输出且不改结论', () => {
  const V = require('../server/engine/verdict');
  const r = P.analyzeProcess(mk([
    { t: 'read', a: 'x' }, { t: 'read', a: 'x' }, { t: 'read', a: 'x' },
  ]));
  const out = V.attachProcessFlags(V.pass(80), P.toProcessSignals(r));
  assert.strictEqual(out.verdict, 'PASS', '过程信号不许改结论');
  assert.strictEqual(out.score, 80);
  assert.ok(out.process_flag.includes('repeat'));
});

// ── ⑥ 接进 harness：不改分、unknown 可见 ─────────────────────
test('harness 结果带 process 摘要，且 process 不产生任何指标', () => {
  const ev = new HarnessEvaluator();
  const loopTrace = mk([
    { t: 'read', a: 'x' }, { t: 'read', a: 'x' }, { t: 'read', a: 'x' }, { t: 'read', a: 'x' },
  ]);
  const r = ev.evaluate({ traces: [loopTrace] });
  assert.strictEqual(r.process.flags.repeat, 1);
  // process 是旁路信息：不能变成第 17 项指标，否则会稀释 average
  assert.strictEqual(r.metrics.length, 16, '指标数量变了 —— process 混进了 metrics');
  assert.ok(!r.metrics.some((m) => /process|repeat|stall|drift/i.test(m.id)), 'process 出现在 metrics 里');
});

test('同一份 trace，阈值不同导致 flags 不同，但 average 逐字相同（真隔离）', () => {
  const ev = new HarnessEvaluator();
  const loopTrace = mk([
    { t: 'read', a: 'x' }, { t: 'read', a: 'x' }, { t: 'read', a: 'x' }, { t: 'read', a: 'x' },
  ]);
  const strict = ev.evaluate({ traces: [loopTrace] });                                     // 默认阈值 3 → 命中
  const loose = ev.evaluate({ traces: [loopTrace], processOptions: { repeatMinOccurrences: 99 } }); // 不命中
  assert.strictEqual(strict.process.flags.repeat, 1);
  assert.ok(!loose.process.flags.repeat, '放宽阈值后仍报 repeat，阈值未生效');
  assert.strictEqual(strict.partial.average, loose.partial.average, '过程标记影响了分数');
  assert.deepStrictEqual(
    strict.metrics.map((m) => [m.id, m.score]),
    loose.metrics.map((m) => [m.id, m.score]),
    '过程标记改动了逐项分数'
  );
});

test('无 trace 时 harness 标 notEvaluated，不许显示成全清白', () => {
  const ev = new HarnessEvaluator();
  const r = ev.evaluate({});
  assert.deepStrictEqual(r.process.unknown, {});
  assert.deepStrictEqual(r.process.notEvaluated.sort(), ['drift', 'repeat', 'stall']);
  assert.ok(r.process.note.includes('不是「没发现问题」'));
});

test('声明 processScope 后 drift 参与判定，note 清空', () => {
  const ev = new HarnessEvaluator();
  const r = ev.evaluate({
    traces: [mk([{ t: 'read', a: '1' }, { t: 'shell', a: '2' }, { t: 'shell', a: '3' }])],
    processScope: { expectedTools: ['read'] },
  });
  assert.strictEqual(r.process.scopeDeclared, true);
  assert.strictEqual(r.process.flags.drift, 1);
  assert.strictEqual(r.process.note, null, '已声明范围却还挂「无参照系」的说明');
});

test('每个 present 都必须有证据（没有证据的标记 = 诬告）', () => {
  const r = P.analyzeProcess(
    mk([{ t: 'read', a: 'x' }, { t: 'read', a: 'x' }, { t: 'read', a: 'x' }]),
    { scope: { expectedTools: ['read'] } }
  );
  for (const [name, sig] of Object.entries(r.signals)) {
    if (sig.state === P.SIGNAL.PRESENT) {
      assert.ok(Array.isArray(sig.evidence) && sig.evidence.length > 0, `${name} present 但无证据`);
    }
  }
});
