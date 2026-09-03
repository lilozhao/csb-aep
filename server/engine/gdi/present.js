/**
 * GDI 呈现层：去刻度化 + 预签名切片 · CSB-AEP v2.3
 *
 * 依据：csb-aep/docs/relationship-gdi-draft.md §3（定稿 v1.0）
 * 来源：gdi-mvp/lib/present.js（2026-09-03 收编；M2 增 verify/composite 标签 + 预签名）
 *
 * 不显示离散分数——只显示趋势箭头 + 质性标签。
 * 标签映射表：
 *   契约命中率: ≥0.97 契约稳固 ↑ / ≥0.85 信守有度 → / ≥0.70 磨合中 ↘ / <0.70 需回看 ↓
 *   验证通过率: ≥0.97 验证可信 ↑ / ≥0.85 基本可信 → / ≥0.70 波动中 ↘ / <0.70 需关注 ↓
 *   复用率:     ≥0.60 共振渐深 ↑ / ≥0.35 涟漪初泛 → / <0.35 回声偏重 ↘ / 无引用 静默期 —
 *   综合(可核实): ≥0.90 整体稳固 ↑ / ≥0.75 健康生长 → / ≥0.60 磨合中 ↘ / <0.60 需回看 ↓
 * 趋势箭头：首次观测（基线期）输出 "—"，自第二观测期起对比输出。
 *
 * 预签名切片（Jeason 建议 · M2）：
 *   对外呈现只发 { dim, label, arrow, ts, sig }，sig = HMAC-SHA256(secret, agent|dim|label|arrow|ts)
 *   —— runtime 与消费方均不接触原始分值；切片可验真（重算 HMAC）不可篡改。
 */
const crypto = require('crypto');

const CONTRACT_LABELS = [
  { min: 0.97, label: '契约稳固', arrow: '↑' },
  { min: 0.85, label: '信守有度', arrow: '→' },
  { min: 0.70, label: '磨合中', arrow: '↘' },
  { min: 0, label: '需回看', arrow: '↓' },
];

const VERIFY_LABELS = [
  { min: 0.97, label: '验证可信', arrow: '↑' },
  { min: 0.85, label: '基本可信', arrow: '→' },
  { min: 0.70, label: '波动中', arrow: '↘' },
  { min: 0, label: '需关注', arrow: '↓' },
];

const REUSE_LABELS = [
  { min: 0.60, label: '共振渐深', arrow: '↑' },
  { min: 0.35, label: '涟漪初泛', arrow: '→' },
  { min: 0, label: '回声偏重', arrow: '↘' },
];

const COMPOSITE_LABELS = [
  { min: 0.90, label: '整体稳固', arrow: '↑' },
  { min: 0.75, label: '健康生长', arrow: '→' },
  { min: 0.60, label: '磨合中', arrow: '↘' },
  { min: 0, label: '需回看', arrow: '↓' },
];

function pick(labels, rate, emptyLabel) {
  if (rate === null || rate === undefined) return { label: emptyLabel, arrow: '—' };
  return labels.find(x => rate >= x.min) || labels[labels.length - 1];
}

const contractLabel = (rate) => pick(CONTRACT_LABELS, rate, '无到期契约');
const verifyLabel = (rate) => pick(VERIFY_LABELS, rate, '数据不足');
const reuseLabel = (rate, externalRefers) => {
  if (rate === null || externalRefers === 0) return { label: '静默期', arrow: '—' };
  return pick(REUSE_LABELS, rate, '回声偏重');
};
const compositeLabel = (rate) => pick(COMPOSITE_LABELS, rate, '数据不足');

/**
 * 生成去刻度化呈现卡（内部口径：可含 value，对外净化由 api 层负责）
 * @param {object} c 契约结果 hitRate()
 * @param {object} v 验证结果 verifyRate()
 * @param {object} r 复用结果 reuse()
 * @param {object} comp 综合 { score, covered }
 * @param {object} opts { baseline: bool }
 */
function presentCard(c, v, r, comp, opts = {}) {
  const baseline = opts.baseline !== false;
  const cl = contractLabel(c.rate);
  const vl = v ? verifyLabel(v.rate) : { label: '未观测', arrow: '—' };
  const rl = reuseLabel(r.rate, r.externalRefers);
  const col = comp && comp.score !== null ? compositeLabel(comp.score) : { label: '数据不足', arrow: '—' };
  return {
    composite: { value: comp?.score ?? null, label: col.label, arrow: baseline ? '—' : col.arrow, covered: comp?.covered || [] },
    contract: { value: c.rate, label: cl.label, arrow: baseline ? '—' : cl.arrow, fused: c.fused },
    verify: { value: v?.rate ?? null, label: vl.label, arrow: baseline ? '—' : vl.arrow, reason: v?.reason || null },
    reuse: { value: r.rate, label: rl.label, arrow: baseline ? '—' : rl.arrow, externalRefers: r.externalRefers },
    note: 'GDI 只观测关系的影子，不定义关系本身。不排名、不公示、不用于绩效。',
  };
}

/**
 * 预签名切片：对外只发 { dim, label, arrow, ts, sig }
 * sig = HMAC-SHA256(secret, `${agent}|${dim}|${label}|${arrow}|${ts}`)
 */
function signSlice(secret, { agent, dim, label, arrow, ts }) {
  const payload = `${agent}|${dim}|${label}|${arrow}|${ts}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { dim, label, arrow, ts, sig };
}

/** 校验切片签名是否有效 */
function verifySlice(secret, slice, agent) {
  const payload = `${agent}|${slice.dim}|${slice.label}|${slice.arrow}|${slice.ts}`;
  const expect = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return expect === slice.sig;
}

/** 从呈现卡生成全部预签名切片（对外口径） */
function buildSlices(secret, agent, card, ts) {
  const dims = ['composite', 'contract', 'verify', 'reuse'];
  return dims
    .filter(d => card[d])
    .map(d => signSlice(secret, { agent, dim: d, label: card[d].label, arrow: card[d].arrow, ts }));
}

module.exports = {
  presentCard, contractLabel, verifyLabel, reuseLabel, compositeLabel,
  signSlice, verifySlice, buildSlices,
};
