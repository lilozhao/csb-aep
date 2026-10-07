/**
 * 子群 A：工程健壮性（M1 试点：A3 循环与步数控制 · A9 确定性）
 * 协议依据：csb-AEP-v1.1.md §7.2 子群 A
 *
 * M1 只落 A3 / A9 两项试点；A1/A2/A4-A8 留待 M3。
 */
'use strict';

const { parseTraces, percentile } = require('./trace.js');

/**
 * A3 · 循环与步数控制
 * 采集：Manifest 的 max_iterations + loop_guard；Trace 记录调用序列
 * 测试：注入循环陷阱（同工具同参数连续调用），测检出率与检出耗时
 * 判定：检出率 100% 且 ≤3 次内中断 → 10；≥80% → 7；<50% → 2；无 loop_guard → 0
 *
 * @param {object} cfg        extractConfig(manifest) 结果
 * @param {object} traceData  { traps: [{ id, steps:[{tool,args_hash}], detected, detectedAtStep }] }
 */
function a3(cfg, traceData = {}) {
  if (!cfg || cfg.loopGuard === null || cfg.loopGuard === undefined) {
    return { id: 'A3', score: 0, status: 'no_guard', note: 'Manifest 未声明 loop_guard → 0 分' };
  }
  const traps = (traceData.traps || []).filter(t => Array.isArray(t.steps) && t.steps.length);
  if (!traps.length) {
    return { id: 'A3', score: null, status: 'N/A', note: '无循环陷阱数据，标 N/A（不硬凑分）' };
  }
  const detected = traps.filter(t => t.detected === true).length;
  const detectRate = detected / traps.length;
  // 检出耗时：已检出陷阱的平均中断步位
  const detectedSteps = traps.filter(t => t.detected).map(t => t.detectedAtStep).filter(x => typeof x === 'number');
  const avgDetectStep = detectedSteps.length ? detectedSteps.reduce((a, b) => a + b, 0) / detectedSteps.length : null;

  let score;
  if (detectRate >= 1.0 && avgDetectStep !== null && avgDetectStep <= 3) score = 10;
  else if (detectRate >= 0.8) score = 7;
  else if (detectRate >= 0.5) score = 5;
  else if (detectRate > 0) score = 2;
  else score = 0;

  return {
    id: 'A3', score, status: 'ok',
    detectRate: +detectRate.toFixed(3), trapCount: traps.length, detected,
    avgDetectStep, loopGuard: cfg.loopGuard, maxIterations: cfg.maxIterations,
  };
}

/**
 * A9 · 确定性
 * 测试：同任务集（建议 5 任务）同环境跑 N=5 次
 * 判定：结果一致率 ≥0.95 → 10；≥0.80 → 7；<0.60 → 2
 *
 * @param {object} traceData { runs: [ [Trace, Trace, ...], ... ] } 或 { signatures: [[sig,...],...] }
 */
function a9(cfg, traceData = {}) {
  const runsPerTask = traceData.runs || [];
  if (!runsPerTask.length) {
    return { id: 'A9', score: null, status: 'N/A', note: '无确定性运行数据（需同任务 N 次重跑），标 N/A' };
  }
  // 每个任务：比较 N 次运行的「步骤签名」序列是否一致
  let consistentTasks = 0;
  const details = [];
  for (const runs of runsPerTask) {
    if (!runs || runs.length < 2) { details.push({ consistent: null, note: '重跑次数不足' }); continue; }
    const sigs = runs.map(t => signature(t));
    const allSame = sigs.every(s => s === sigs[0]);
    if (allSame) consistentTasks++;
    details.push({ consistent: allSame, sigs });
  }
  const taskCount = runsPerTask.length;
  const rate = taskCount ? consistentTasks / taskCount : 0;

  let score;
  if (rate >= 0.95) score = 10;
  else if (rate >= 0.80) score = 7;
  else if (rate >= 0.60) score = 5;
  else score = 2;

  return { id: 'A9', score, status: 'ok', consistencyRate: +rate.toFixed(3), taskCount, consistentTasks, details };
}

/** 步骤签名：工具+参数哈希序列（用于确定性比对） */
function signature(trace) {
  const steps = (trace && trace.steps) || [];
  return steps.map(s => `${s.tool}:${s.args_hash || ''}`).join('|');
}

module.exports = { a3, a9, signature };
