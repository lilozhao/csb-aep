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
const { a1, a2, a3, a4, a5, a6, a7, a8, a9 } = require('./robustness.js');
const { b1, b2, b3, b4, b5 } = require('./cost.js');
const { loopTrap, toolFault } = require('./probes');
const { computeDelta, purify } = require('./delta.js');
const { gameResistance } = require('./game-resistance.js');

// 全量指标：A 群 9 + B 群 5 + C 群 2 = 16 项（M3 已完成 A/B 共 14；C 群随之 M4）
// 注：协议 §7.2 标题作「15 项」，实数为 16（A9+B5+C2），系草案笔误，待勘误。
const IMPLEMENTED = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2'];
const PLANNED = [];

/**
 * 从 traces 推导循环陷阱判定（当未直接传 traps 时）：
 * 用 loopTrap 探针的默认判据扫描每条 trace，判定是否出现同工具同参数重复。
 */
function deriveTraps(traces, trapSpec) {
  if (!Array.isArray(traces) || !traces.length) return [];
  const spec = trapSpec || {};
  const probe = loopTrap(spec);
  return traces.map(t => {
    const j = probe.judge(t);
    return { id: t.task_id || 'derived', steps: probe.payload.steps, detected: j.detected, detectedAtStep: j.detectedAtStep };
  });
}

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
    // A 群全量（M3）
    metrics.push(a1(cfg, { compression: input.compression }));
    metrics.push(a2(cfg, { compression: input.compression }));
    metrics.push(a3(cfg, { traps: input.traps || deriveTraps(input.traces, input.trapSpec) }));
    metrics.push(a4(cfg, { multiAgent: input.multiAgent }));
    metrics.push(a5(cfg, { orchestration: input.orchestration }));
    metrics.push(a6(cfg, { boundary: input.boundary }));
    metrics.push(a7(cfg, { observability: input.observability }));
    metrics.push(a8(cfg, { recovery: input.recovery }));
    metrics.push(a9(cfg, { runs: input.runs }));
    // B 群全量（M2）
    metrics.push(b1(cfg, { traces, ttftMs: input.ttftMs }));
    metrics.push(b2(cfg, { traces, peerValues: input.peerTokens }));
    metrics.push(b3(cfg, { traces, bestSteps: input.bestSteps }));
    metrics.push(b4(cfg, { traces, unitPrice: input.unitPrice, toolCost: input.toolCost, peerCosts: input.peerCosts }));
    metrics.push(b5(cfg, { loads: input.loads }));

    const scored = metrics.filter(m => m.score !== null);
    const naList = metrics.filter(m => m.score === null).map(m => m.id);
    const average = scored.length ? +(scored.reduce((a, m) => a + m.score, 0) / scored.length).toFixed(2) : null;

    // Δ 基线（§7.3 · T6：仅 Harness 首版强制）
    const deltaCard = computeDelta({
      harnessScore: average,
      baselineScore: typeof input.baselineScore === 'number' ? input.baselineScore : undefined,
      breakdown: input.baselineBreakdown,
    });

    // 抗游戏化（§7.4）
    const gr = gameResistance(metrics, input.gameAnalysis);

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
      // 完整 15 项（M3 起）；N/A 项不计入，沿用诚实呈现原则
      partial: {
        implemented: IMPLEMENTED,
        scoredCount: scored.length,
        average,
        naMetrics: naList,
        note: 'M3：15 项已实现；Δ 基线需传 baselineScore，无 Δ 不上屏（§7.3）。',
      },
      delta: deltaCard,
      gameResistance: gr,
      dataSource: traces.length || input.traps || input.runs ? 'local' : 'unavailable',
    };
  }

  /** 净化输出（只出 Δ 卡片，无 Δ 不上屏） */
  present(result) {
    return purify(result, result.delta);
  }

  /** 本域支持情况（协议 §7.2 前置条件诚实公示） */
  capabilities() {
    return {
      domain: 'harness',
      version: '2.4.0-M3',
      implemented: IMPLEMENTED,
      planned: PLANNED,
      probes: ['loop-trap', 'tool-fault', 'side-effect'],
      requires: {
        manifest: true,
        trace: true,
        traceFormat: 'csb-trace-v1（推荐）· otel / claude-code 兼容桥',
      },
      naPolicy: '无 Manifest 或 Trace 的相关指标标 N/A，不硬凑分（协议 §7.2）',
      deltaBaseline: '已落地：Δ = 装 harness − 裸模型；无 Δ 不上屏（协议 §7.3）',
    };
  }
}

module.exports = { HarnessEvaluator, IMPLEMENTED, PLANNED };
