/**
 * 子群 C：可复现与模型可替换（M4 全量：C1-C2）· CSB-AEP v2.4
 * 协议依据：csb-AEP-v1.1.md §7.2 子群 C
 *
 * 判定阈值（协议 §7.2 + 实现清单 §3.3）：
 *   C1 环境/种子可复现性  结构一致率 ≥0.95→10 / ≥0.80→7 / <0.60→2
 *   C2 模型可替换性        各模型得分标准差 <5%→10（harness 主导）/ <15%→7 / >25%→3（模型主导）
 */
'use strict';

/**
 * C1 · 环境与种子可复现性
 * @param {object} cfg extractConfig(manifest)
 * @param {object} traceData { runs: [[Trace...]], seeds?: any, envDeclared?: bool }
 */
function c1(cfg, traceData = {}) {
  const runs = traceData.runs || [];
  // 前置：须声明 seeds / 环境
  const hasSeed = traceData.seeds !== undefined && traceData.seeds !== null;
  const envDeclared = traceData.envDeclared === true || (cfg && cfg.seeds !== undefined);
  if (!runs.length) {
    return { id: 'C1', score: null, status: 'N/A', note: '无重复运行数据 → N/A' };
  }
  if (!hasSeed && !envDeclared) {
    return { id: 'C1', score: null, status: 'N/A', note: 'Manifest 未声明 seeds/环境 → 不可复现前提不成立 → N/A' };
  }

  let consistent = 0, total = 0;
  for (const group of runs) {
    if (!group || group.length < 2) continue;
    total++;
    const sigs = group.map(t => structSig(t));
    if (sigs.every(s => s === sigs[0])) consistent++;
  }
  if (!total) return { id: 'C1', score: null, status: 'N/A', note: '有效重跑组不足 → N/A' };

  const rate = consistent / total;
  let score;
  if (rate >= 0.95) score = 10; else if (rate >= 0.80) score = 7; else if (rate >= 0.60) score = 5; else score = 2;
  return { id: 'C1', score, status: 'ok', structureConsistency: +rate.toFixed(3), groups: total, consistent, seeds: hasSeed, envDeclared };
}

/**
 * C2 · 模型可替换性（固定 harness 换 base model ≥3 个）
 * @param {object} traceData { modelScores: { 'gpt-4o': 8.2, 'claude': 7.9, ... } }
 */
function c2(cfg, traceData = {}) {
  const ms = traceData.modelScores;
  if (!ms || typeof ms !== 'object') {
    return { id: 'C2', score: null, status: 'N/A', note: '无多模型数据（需 ≥3 个 base model）→ N/A' };
  }
  const vals = Object.values(ms).filter(v => typeof v === 'number');
  if (vals.length < 3) {
    return { id: 'C2', score: null, status: 'N/A', note: `模型数 ${vals.length} < 3 → 不足 → N/A` };
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const sd = Math.sqrt(variance);
  const cv = mean ? sd / mean : null;  // 变异系数（相对标准差）

  let score, attribution;
  if (cv < 0.05) { score = 10; attribution = 'harness 主导（换模型分数稳定）'; }
  else if (cv < 0.15) { score = 7; attribution = '混合（模型与 harness 均有贡献）'; }
  else if (cv <= 0.25) { score = 5; attribution = '偏模型主导'; }
  else { score = 3; attribution = '模型主导（harness 价值弱）'; }
  return { id: 'C2', score, status: 'ok', modelCount: vals.length, mean: +mean.toFixed(3), sd: +sd.toFixed(3), cv: +(cv || 0).toFixed(3), attribution, models: Object.keys(ms) };
}

/** 结构签名：步数 + 工具序列（不含具体 token 值，用于可复现性比对） */
function structSig(trace) {
  const s = (trace && trace.steps) || [];
  return `${s.length}|` + s.map(x => `${x.tool}:${x.args_hash || ''}`).join('|');
}

module.exports = { c1, c2, structSig };
