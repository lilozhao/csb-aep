/**
 * GDI provenance 观测模块（X-1 · 2026-09-05）
 *
 * 观测「记忆溯源链的机制运转」——意识层蒸馏（会忘/降权/derived_from）的可核实旁证。
 * 与 witness 同哲学：观察期仅供呈现，不计入健康度总分，去刻度不评级。
 *
 * 数据源：data/gdi/sources/provenance/*.json（gdi-collect-provenance.js 产出）
 *   { meta, metrics: { sealedRate, provenanceCoverage, sealed, burning, lastFileAge }, daily: [...] }
 *
 * 防游戏化：
 *   - 只观测机制指标（率/连续性），不评内容、不点名个体
 *   - 观察期（30 天）内不计权，转正需评审
 */
const fs = require('fs');
const path = require('path');

function loadDocs(sourcesDir) {
  const dir = path.join(sourcesDir, 'provenance');
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (doc.metrics) out.push(doc);
    } catch (e) { /* 跳过坏文件 */ }
  }
  return out;
}

/**
 * 计算 provenance 观测（观察期：仅供呈现，不计分）
 * @param {string} sourcesDir GDI sources 根目录
 * @returns {object|null} { coverage, sealedRate, lastFileAge, days, note }
 */
function provenance(sourcesDir) {
  const docs = loadDocs(sourcesDir);
  if (docs.length === 0) return null;
  const latest = docs[docs.length - 1];
  const m = latest.metrics;
  return {
    coverage: m.provenanceCoverage,      // 溯源完整率（sealed 带 distilled_to 占比）
    sealedRate: m.sealedRate,            // 封口率
    lastFileAge: m.lastFileAge,          // 最近流水距今（天），>1 提示断流
    days: latest.daily || [],
    observation: true,                   // 观察期，不计入健康度
    note: '记忆溯源链机制观测（X-1）：sealed 条目的蒸馏去向完整率；仅供呈现，观察期不计分',
  };
}

module.exports = { provenance };
