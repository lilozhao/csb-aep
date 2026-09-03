#!/usr/bin/env node
/**
 * GDI 权重校准工具 · CSB-AEP v2.3（M2）
 *
 * 依据：relationship-gdi-draft.md §四-3 校准机制（定稿）：
 *   - 半年度深校（--deep）+ 季度轻检（--light，默认）
 *   - 仅预警不降权；滑动窗口 + 置信区间阈值；权重衰减底线 5%
 *   - 异常漂移触发（概念突变/重大冲击可临时插队）
 *
 * 检查项：
 *   1. 权重配置 vs 定稿（40/30/20/10）一致性
 *   2. 维度区分度：某维所有观测同分/全 null → 区分度不足预警（EvoMap GDI 塌缩的早期信号）
 *   3. 自评校准提醒统计（差异过大触发次数）
 *   4. 数据覆盖：各维 null 占比（长期无数据源 → 数据不足预警）
 *   5. 权重底线：任何权重不得低于 5%（焊死）
 *
 * 用法：
 *   node scripts/gdi-calibrate.js            # 季度轻检（默认）
 *   node scripts/gdi-calibrate.js --deep     # 半年度深校
 *   node scripts/gdi-calibrate.js --json     # JSON 输出
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'defaults.json'), 'utf8'));
const STORE_FILE = path.join(ROOT, cfg.gdi.storeFile || 'data/gdi/gdi-store.json');

// 定稿权重（焊死参照）
const CANONICAL_WEIGHTS = { contract: 0.4, verify: 0.3, reuse: 0.2, selfReport: 0.1 };
const WEIGHT_FLOOR = cfg.gdi.calibration.weightFloor || 0.05;

function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
  catch { return { observations: [] }; }
}

function lightCheck() {
  const store = loadStore();
  const obs = store.observations || [];
  const warnings = [];

  // 1. 权重一致性
  const w = cfg.gdi.weights;
  for (const [k, v] of Object.entries(CANONICAL_WEIGHTS)) {
    if (Math.abs((w[k] || 0) - v) > 1e-9) warnings.push(`⚠️ 权重漂移: ${k} = ${w[k]}（定稿 ${v}）`);
    if ((w[k] || 0) < WEIGHT_FLOOR) warnings.push(`⛔ 权重跌破底线 5%: ${k} = ${w[k]}`);
  }
  if ((w.selfReport || 0) > cfg.gdi.selfReportWeightCap) {
    warnings.push(`⛔ 自报权重超上限 20%: ${w.selfReport}`);
  }

  if (obs.length === 0) {
    return { ok: warnings.length === 0, observations: 0, warnings, note: '尚无观测记录——先 POST /api/gdi/observe' };
  }

  // 2-4. 按 agent 聚合维度
  const byAgent = {};
  for (const o of obs) {
    (byAgent[o.agent] ||= []).push(o);
  }

  const dims = ['contract', 'verify', 'reuse'];
  const coverage = {};
  const variance = {};
  for (const d of dims) coverage[d] = { nulls: 0, total: 0, values: [] };
  let alertCount = 0;

  for (const [agent, list] of Object.entries(byAgent)) {
    const latest = list[list.length - 1];
    if (latest.calibration?.alert) alertCount++;
    for (const d of dims) {
      const rate = latest.dimensions?.[d]?.rate;
      coverage[d].total++;
      if (rate === null || rate === undefined) coverage[d].nulls++;
      else coverage[d].values.push(rate);
    }
  }

  for (const d of dims) {
    const c = coverage[d];
    if (c.total > 0 && c.nulls / c.total >= 0.5) {
      warnings.push(`⚠️ 维度「${d}」数据不足：${c.nulls}/${c.total} 观测为 null（检查数据源）`);
    }
    // 区分度：非 null 值几乎无差异 → 塌缩早期信号
    if (c.values.length >= 3) {
      const spread = Math.max(...c.values) - Math.min(...c.values);
      if (spread < 0.05) warnings.push(`⚠️ 维度「${d}」区分度低：极差 ${spread.toFixed(3)} < 0.05（EvoMap GDI 塌缩的早期信号，仅预警不降权）`);
    }
  }

  if (alertCount > 0) warnings.push(`📌 自评校准提醒 ${alertCount} 次（差异过大触发，非惩罚，建议回看交互）`);

  return {
    ok: warnings.length === 0,
    mode: 'light',
    observations: obs.length,
    agents: Object.keys(byAgent).length,
    alertCount,
    coverage: Object.fromEntries(dims.map(d => [d, {
      nullRatio: +(coverage[d].nulls / Math.max(1, coverage[d].total)).toFixed(2),
      spread: coverage[d].values.length >= 2 ? +(Math.max(...coverage[d].values) - Math.min(...coverage[d].values)).toFixed(3) : null,
    }])),
    warnings,
    note: '季度轻检：仅预警不降权（定稿 §四-3）',
  };
}

function deepCheck() {
  const light = lightCheck();
  light.mode = 'deep';
  light.note = '半年度深校：在轻检基础上建议人工双盲复核 + 权重回归校准（输出为预警，权重调整需协议组评审）';
  const store = loadStore();
  const obs = store.observations || [];
  // 时间跨度
  if (obs.length >= 2) {
    const ts = obs.map(o => new Date(o.observedAt).getTime());
    light.spanDays = Math.round((Math.max(...ts) - Math.min(...ts)) / 86400000);
  }
  // 置信区间粗算（每维非 null 均值的 95% 区间，样本小用 ±1.96·sd/√n）
  const dims = ['contract', 'verify', 'reuse'];
  light.confidence = {};
  for (const d of dims) {
    const values = obs.map(o => o.dimensions?.[d]?.rate).filter(v => v !== null && v !== undefined);
    if (values.length >= 2) {
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
      const half = 1.96 * sd / Math.sqrt(values.length);
      light.confidence[d] = { mean: +mean.toFixed(3), ciHalfWidth: +half.toFixed(3), n: values.length };
    }
  }
  return light;
}

const asJson = process.argv.includes('--json');
const result = process.argv.includes('--deep') ? deepCheck() : lightCheck();

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\n[gdi-calibrate] ${result.mode === 'deep' ? '半年度深校' : '季度轻检'}`);
  console.log(`观测 ${result.observations} 条 · agent ${result.agents ?? '-'} · 自评提醒 ${result.alertCount ?? 0} 次`);
  if (result.spanDays !== undefined) console.log(`时间跨度 ${result.spanDays} 天`);
  if (result.coverage) {
    for (const [d, c] of Object.entries(result.coverage)) {
      console.log(`  ${d}: null占比 ${c.nullRatio} · 区分度极差 ${c.spread ?? '-'}`);
    }
  }
  if (result.confidence) {
    console.log('置信区间（95%）：');
    for (const [d, ci] of Object.entries(result.confidence)) {
      console.log(`  ${d}: ${ci.mean} ± ${ci.ciHalfWidth}（n=${ci.n}）`);
    }
  }
  console.log(result.warnings.length ? '\n' + result.warnings.join('\n') : '\n✅ 无预警');
  console.log(`\n${result.note}`);
  process.exit(result.warnings.length ? 2 : 0); // 2 = 有预警（CI 可感知）
}
