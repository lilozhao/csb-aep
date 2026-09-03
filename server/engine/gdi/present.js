/**
 * GDI 呈现层：去刻度化 · CSB-AEP v2.3
 *
 * 依据：csb-aep/docs/relationship-gdi-draft.md §3（定稿 v1.0）
 * 来源：gdi-mvp/lib/present.js（2026-09-03 收编）
 * 不显示离散分数——只显示趋势箭头 + 质性标签。
 * 质性标签映射表：
 *   契约命中率: ≥0.97 契约稳固 ↑ / 0.85-0.97 信守有度 → / 0.70-0.85 磨合中 ↘ / <0.70 需回看 ↓
 *   复用率:     ≥0.60 共振渐深 ↑ / 0.35-0.60 涟漪初泛 → / <0.35 回声偏重 ↘ / 无引用 静默期 —
 * 趋势箭头：首次观测（基线期）输出 "—"，自第二观测期起对比输出 ↑/→/↘/↓。
 */

const CONTRACT_LABELS = [
  { min: 0.97, label: '契约稳固', arrow: '↑' },
  { min: 0.85, label: '信守有度', arrow: '→' },
  { min: 0.70, label: '磨合中', arrow: '↘' },
  { min: 0, label: '需回看', arrow: '↓' },
];

const REUSE_LABELS = [
  { min: 0.60, label: '共振渐深', arrow: '↑' },
  { min: 0.35, label: '涟漪初泛', arrow: '→' },
  { min: 0, label: '回声偏重', arrow: '↘' },
];

function contractLabel(rate) {
  if (rate === null) return { label: '无到期契约', arrow: '—' };
  return CONTRACT_LABELS.find(x => rate >= x.min) || CONTRACT_LABELS[CONTRACT_LABELS.length - 1];
}

function reuseLabel(rate, externalRefers) {
  if (rate === null || externalRefers === 0) return { label: '静默期', arrow: '—' };
  return REUSE_LABELS.find(x => rate >= x.min) || REUSE_LABELS[REUSE_LABELS.length - 1];
}

/**
 * 生成去刻度化呈现卡
 * @param {object} c 契约结果 hitRate()
 * @param {object} r 复用结果 reuse()
 * @param {object} opts { baseline: bool } 是否基线期（无历史对比）
 */
function presentCard(c, r, opts = {}) {
  const baseline = opts.baseline !== false; // MVP 默认基线期
  const cl = contractLabel(c.rate);
  const rl = reuseLabel(r.rate, r.externalRefers);
  const card = {
    contract: { value: c.rate, label: cl.label, arrow: baseline ? '—' : cl.arrow, fused: c.fused },
    reuse: { value: r.rate, label: rl.label, arrow: baseline ? '—' : rl.arrow, externalRefers: r.externalRefers },
    note: 'GDI 只观测关系的影子，不定义关系本身。不排名、不公示、不用于绩效。',
  };
  return card;
}

module.exports = { presentCard, contractLabel, reuseLabel };
