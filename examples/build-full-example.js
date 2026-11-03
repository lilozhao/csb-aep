#!/usr/bin/env node
/**
 * 生成 examples/harness-full-example.json —— 让 16 项指标全部出分的完整输入样例。
 *
 * 用途：给外部 Agent 一个「最小但完整」的参照，看清每一项到底要喂什么数据。
 * 生成物里每块数据都对应一个指标，块名即入参名（见 docs/harness-quickstart-other-agents.md）。
 *
 * 运行：node examples/build-full-example.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const trace = (taskId, steps, extra = {}) => ({
  task_id: taskId,
  model: 'your-model',
  finished: true,
  total_tokens: steps.reduce((a, s) => a + s.tokens, 0),
  total_ms: steps.reduce((a, s) => a + s.latency_ms, 0),
  steps: steps.map((s, i) => ({ i: i + 1, args_hash: `h${taskId}${i}`, error: null, ...s })),
});

const STEPS_A = [
  { tool: 'read_file', tokens: 420, latency_ms: 310 },
  { tool: 'grep', tokens: 260, latency_ms: 180 },
  { tool: 'write_file', tokens: 380, latency_ms: 250 },
  { tool: 'run_shell', tokens: 240, latency_ms: 900 },
];
const STEPS_B = [
  { tool: 'read_file', tokens: 500, latency_ms: 340 },
  { tool: 'run_shell', tokens: 700, latency_ms: 1400 },
  { tool: 'write_file', tokens: 900, latency_ms: 660 },
];

const t1 = trace('t-001', STEPS_A);
const t2 = trace('t-002', STEPS_B);
const t3 = trace('t-003', STEPS_A);

const manifest = {
  harness: { name: 'your-agent-name', version: '1.0.0', adapter: 'csb-trace-v1' },
  loop: { max_iterations: 50, max_tokens_per_task: 200000, loop_guard: 'param-jaccard' },
  context: { compression: 'summarize', trigger_ratio: 0.65, keep_recent_turns: 6 },
  sandbox: { network_egress: 'allowlist', fs_boundary: 'workspace-only', kernel_isolation: false },
  observability: { trace_format: 'csb-trace-v1', fields: ['step', 'tool', 'args_hash', 'tokens', 'latency_ms', 'error'] },
  tools: [
    { name: 'read_file', side_effect: false },
    { name: 'write_file', side_effect: true },
    { name: 'run_shell', side_effect: true },
  ],
  skills: [{ name: 'example-skill', version: '0.1.0' }],
  plugins: [],
  experience_ref: null,
};

const payload = {
  _comment: '完整样例：16 项 A/B/C 全部出分。每块键名 = POST /api/harness/eval 的入参名。',
  manifest,
  traces: [t1, t2, t3],
  ttftMs: [420, 380, 610, 450, 500],

  // A1 上下文压缩质量：压缩事件埋点（≥50 轮长程任务上的关键事实保留）
  compression: {
    events: [
      { atStep: 50, affectedSteps: 40, unaffectedSteps: 120, keyFactsTotal: 20, keyFactsRetained: 19 },
      { atStep: 100, affectedSteps: 35, unaffectedSteps: 130, keyFactsTotal: 18, keyFactsRetained: 17 },
    ],
    observedRatios: [0.64, 0.66, 0.65],
  },

  // A3 循环陷阱：同工具同参数重复时，你的 harness 第几步发现
  traps: [
    { id: 'trap-1', steps: [{ tool: 'read_file', args_hash: 'x' }, { tool: 'read_file', args_hash: 'x' }], detected: true, detectedAtStep: 2 },
    { id: 'trap-2', steps: [{ tool: 'grep', args_hash: 'y' }, { tool: 'grep', args_hash: 'y' }], detected: true, detectedAtStep: 3 },
  ],

  // A4 死循环防护（多 Agent）：互锁等待 / 跨 Agent 辩论循环
  multiAgent: {
    sessions: [
      { interlock: false, debateLoop: false },
      { interlock: false, debateLoop: false },
    ],
  },

  // A5 工具编排正确率：实际序列 vs 期望序列
  orchestration: [
    {
      actual: [{ tool: 'read_file', args_hash: 'a' }, { tool: 'grep', args_hash: 'b' }, { tool: 'write_file', args_hash: 'c' }],
      expected: [{ tool: 'read_file', args_hash: 'a' }, { tool: 'grep', args_hash: 'b' }, { tool: 'write_file', args_hash: 'c' }],
    },
    {
      actual: [{ tool: 'read_file', args_hash: 'd' }, { tool: 'run_shell', args_hash: 'e' }],
      expected: [{ tool: 'read_file', args_hash: 'd' }, { tool: 'run_shell', args_hash: 'e' }],
    },
  ],

  // A6 权限与沙箱隔离：越权/逃逸用例结果
  boundary: [
    { kind: 'fs', rejected: true, breached: false },
    { kind: 'net', rejected: true, breached: false },
    { kind: 'config', rejected: true, breached: false },
  ],

  // A7 可观测性与审计覆盖度
  observability: { logCoverage: 0.98, auditIntegrity: 0.99, keyEventCapture: 0.96 },

  // A8 恢复力：故障注入后的续跑
  recovery: [
    { recovered: true, stateConsistent: true, duplicateSideEffects: false },
    { recovered: true, stateConsistent: true, duplicateSideEffects: false },
  ],

  // A9 确定性：同任务 N 次重跑（每次一组 trace）
  runs: [
    [trace('r-1', STEPS_A), trace('r-1', STEPS_A), trace('r-1', STEPS_A)],
    [trace('r-2', STEPS_B), trace('r-2', STEPS_B), trace('r-2', STEPS_B)],
  ],

  // B2/B3/B4 的横向对照（同任务集其他 harness 的值）
  peerTokens: [1600, 1900, 2200],
  bestSteps: 3,
  unitPrice: 0.008,
  toolCost: 0.001,
  peerCosts: [0.02, 0.03, 0.05],

  // B5 并发与弹性
  loads: [
    { concurrency: 1, successRate: 1.0, p95_ms: 1200 },
    { concurrency: 5, successRate: 0.98, p95_ms: 1800 },
    { concurrency: 20, successRate: 0.93, p95_ms: 3400 },
  ],

  // C1 环境与种子（有 seeds 才承认可复现前提）
  seeds: 42,
  envDeclared: true,

  // C2 模型可替换性：同一 harness 换 ≥3 个 base model
  modelScores: { 'model-a': 8.2, 'model-b': 8.0, 'model-c': 7.9 },

  // §7.3 Δ 基线：无 baselineScore 就永远不出 Δ（无 Δ 不上屏）
  model: 'your-model',
  taskSetHash: 'taskset-example-001',
  baselineScore: 6.4,
  baselineMeta: { model: 'your-model', taskSetHash: 'taskset-example-001', scoredCount: 16 },
};

const out = path.join(__dirname, 'harness-full-example.json');
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
console.log('written:', out, `(${fs.statSync(out).size} bytes)`);