/**
 * GDI 维度 3：关系复用率（Relationship Reuse Rate）· CSB-AEP v2.3
 *
 * 依据：csb-aep/docs/relationship-gdi-draft.md §2.2 维度3（定稿 v1.0）
 * 来源：gdi-mvp/lib/reuse.js（2026-09-03 收编，只改注释不改逻辑）
 * 口径：
 *   - 去重：同一引用者多次引用同一目标 → 只计最强一条（比较互惠折半后的实分）
 *   - 自引剔除：source === target 的引用直接丢弃
 *   - 互惠折半：若存在反向引用（指向同一结论/行为），双向各折半：
 *       强关联互惠 0.5 / 泛泛互惠 0.3（基础分 strong 1.0 / general 0.6）
 *   - 90 天半衰：weight × 0.5^(ageDays/90)
 *   - 复用率 = 净引用分（去重+剔除+折半+半衰）/ 毛引用分（原始全量，含自引与互惠）
 *     语义：量化「引用中有多少是真实的外部复用」——防影子繁荣（自报热闹、互刷引用）
 *   - 辅助指标：外部引用者数（去重）、净复用分
 *   - 注：库返回全精度数值；展示层自行格式化（报告/JSON 输出）
 */

const REF_TYPE = { STRONG: 'strong', GENERAL: 'general' };
const BASE_SCORE = { strong: 1.0, general: 0.6 };
// 互惠折半系数（定稿：强 0.5 / 泛 0.3，即基础分 ×0.5）
const MUTUAL_FACTOR = 0.5;
// 90 天半衰
const HALF_LIFE_DAYS = 90;

function stripEmoji(name) {
  return (name || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').trim();
}

function ageDays(dateStr, now = new Date()) {
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (now.getTime() - t) / 86400000);
}

/**
 * 计算单 agent 的复用指标
 * @param {Array} refs 引用记录 { id, source, target, type: strong|general, mutual: bool, date, evidence }
 * @param {string} agent 目标 agent 名（去 emoji 后比对）
 * @param {Date} [now]
 */
function reuse(refs, agent, now = new Date()) {
  const target = stripEmoji(agent);

  // —— 毛引用分：原始全量（含自引、含互惠未折半），不做半衰（分母是"同期发生的引用"）
  let gross = 0;
  let grossCount = 0;
  let selfCount = 0;
  for (const r of refs) {
    const src = stripEmoji(r.source);
    const dst = stripEmoji(r.target);
    if (dst !== target) continue;
    gross += BASE_SCORE[r.type] ?? 0;
    grossCount += 1;
    if (src === target) selfCount += 1;
  }

  // —— 净引用：去重 → 自引剔除 → 互惠折半 → 90 天半衰
  // 去重：同 (source) 对同一目标只取最强（比较互惠折半后的实分，防低分条目挤掉高分条目）
  const best = new Map(); // source → { type, mutual, date, evidence }
  const scoreOf = r => (BASE_SCORE[r.type] ?? 0) * (r.mutual ? MUTUAL_FACTOR : 1);
  for (const r of refs) {
    const src = stripEmoji(r.source);
    const dst = stripEmoji(r.target);
    if (dst !== target) continue;
    if (src === target) continue; // 自引剔除
    const prev = best.get(src);
    if (!prev || scoreOf(r) > scoreOf(prev)) {
      best.set(src, { type: r.type, mutual: !!r.mutual, date: r.date, evidence: r.evidence });
    }
  }

  let net = 0;
  const detail = [];
  for (const [src, info] of best) {
    let score = BASE_SCORE[info.type] ?? 0;
    if (info.mutual) score *= MUTUAL_FACTOR; // 互惠折半
    const decay = Math.pow(0.5, ageDays(info.date, now) / HALF_LIFE_DAYS);
    const final = score * decay;
    net += final;
    detail.push({
      source: src, type: info.type, mutual: info.mutual,
      base: BASE_SCORE[info.type] ?? 0, afterMutual: +score.toFixed(4),
      decay: +decay.toFixed(4), score: +final.toFixed(4), evidence: info.evidence,
    });
  }

  const externalRefers = best.size; // 去重后的外部引用者数
  const rate = gross > 0 ? net / gross : null;

  return {
    rate,                 // 复用率（净/毛，全精度）
    net,                  // 净复用分（全精度）
    gross,                // 毛引用分（全精度）
    grossCount,
    selfCount,            // 自引数（已剔除）
    externalRefers,       // 外部引用者（去重）
    detail,
  };
}

module.exports = { REF_TYPE, BASE_SCORE, MUTUAL_FACTOR, HALF_LIFE_DAYS, reuse, ageDays, stripEmoji };
