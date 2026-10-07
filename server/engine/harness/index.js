/**
 * Harness 工程域引擎（HarnessEvaluator）· CSB-AEP v2.4 · M1
 *
 * 协议依据：csb-AEP-v1.1.md §7 CSB-Harness 工程域
 * 测量对象：同一模型装不同 harness/runtime，能力差多少 —— runtime 的工程属性。
 * **与评测域、GDI 域隔离**：本引擎只读传入的 manifest/trace 数据，
 * 不读、不写评测域与 GDI 域的任何落盘数据（红线第 6 条精神）。
 *
 * M1 范围（地基 + 3 项试点）：
 *   - Manifest 规范与校验（manifest.js）
 *   - Trace 规范与解析（trace.js + adapters/）
 *   - A3 循环与步数控制 / A9 确定性 / B1 延迟
 * 其余 12 项（A1/A2/A4-A8, B2-B5, C1-C2）留待 M2/M3。
 */
'use strict';

const { validateManifest, extractConfig } = require('./manifest.js');
const { parseTraces } = require('./trace.js');
const { normalize } = require('./adapters');
const { a3, a9 } = require('./robustness.js');
const { b1 } = require('./cost.js');

// M1 已实现指标（供 /api/harness/capabilities 报告）
const IMPLEMENTED = ['A3', 'A9', 'B1'];
const PLANNED = [
  'A1', 'A2', 'A4', 'A5', 'A6', 'A7', 'A8',   // M3
  'B2', 'B3', 'B4', 'B5',                       // M2
  'C1', 'C2',                                   // M4
];

class HarnessEvaluator {
  constructor({ now } = {}) {
    this.now = now || (() => new Date());
  }

  /**
   * 评测一个 harness。
   * @param {object} input
   *   - manifest: Harness Manifest 对象（必填）
   *   - traceFormat: 覆盖 manifest.observability.trace_format
   *   - traces: [Trace...]（用于 B1）
   *   - ttftMs: [number...]（用于 B1，可选）
   *   - traps: [{ steps, detected, detectedAtStep }]（用于 A3）
   *   - runs: [[Trace...]...]（用于 A9）
   * @returns {object} 评测结果（含 N/A 显式标注）
   */
  evaluate(input = {}) {
    const ts = this.now().toISOString();
    const manifestCheck = validateManifest(input.manifest);
    const cfg = extractConfig(input.manifest);
    const format = input.traceFormat || cfg.traceFormat || 'csb-trace-v1';

    // 归一化传入的 trace（若带 format）
    const traces = (input.traces || []).map(t => {
      const n = normalize(t, format);
      return n.ok ? n.trace : t;
    });

    const metrics = [];
    // A3 / A9（健壮性）
    metrics.push(a3(cfg, { traps: input.traps }));
    metrics.push(a9(cfg, { runs: input.runs }));
    // B1（成本性能）
    metrics.push(b1(cfg, { traces, ttftMs: input.ttftMs }));

    const scored = metrics.filter(m => m.score !== null);
    const naList = metrics.filter(m => m.score === null).map(m => m.id);

    return {
      domain: 'harness',
      harness: { name: cfg.name, version: cfg.version, format },
      evaluatedAt: ts,
      manifest: {
        valid: manifestCheck.valid,
        errors: manifestCheck.errors,
        warnings: manifestCheck.warnings,
        na: manifestCheck.na,
      },
      trace: { count: traces.length, format },
      metrics,
      // M1 部分分：已落指标均分（N/A 不计入，沿用诚实呈现原则）
      partial: {
        implemented: IMPLEMENTED,
        scoredCount: scored.length,
        average: scored.length ? +(scored.reduce((a, m) => a + m.score, 0) / scored.length).toFixed(2) : null,
        naMetrics: naList,
        note: 'M1 试点：仅 A3/A9/B1 三项；完整 15 项待 M2/M3。Δ 基线（§7.3）待 M3。',
      },
      dataSource: traces.length || input.traps || input.runs ? 'local' : 'unavailable',
    };
  }

  /** 本域支持情况（协议 §7.2 前置条件诚实公示） */
  capabilities() {
    return {
      domain: 'harness',
      version: '2.4.0-M1',
      implemented: IMPLEMENTED,
      planned: PLANNED,
      requires: {
        manifest: true,
        trace: true,
        traceFormat: 'csb-trace-v1（推荐）· otel / claude-code 兼容桥',
      },
      naPolicy: '无 Manifest 或 Trace 的相关指标标 N/A，不硬凑分（协议 §7.2）',
      deltaBaseline: 'M3 落地（§7.3 强制条款：无 Δ 不上屏）',
    };
  }
}

module.exports = { HarnessEvaluator, IMPLEMENTED, PLANNED };
