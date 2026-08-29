/**
 * GRISK 诚意风险引擎（CSB-AEP 第六问「GRISK」落地）
 * =================================================
 * 评审依据：REV-2026-08-30 共识 · 议题C
 * - GRISK = 善意护栏以为自己在运行、其实已沦为模板的风险（明德）
 * - 姿态指标采纳：只存时长分布、不存原文（墨丘隐私顾虑已化解）
 * - 撤回窗：首次认领后 72h 内仅发起方单向撤回，记「意图偏移」而非清零（Jeason 修订 + 星尘确认）
 * - 意图澄清率校准：AI 的停顿可能是计算负载而非关系疏离（星尘）
 * - 防指标游戏化：异常值需人工复核（星尘）
 *
 * 核心判据（明德）：模板回复（毫秒级发出）和真认领（至少停顿一秒）是两种分布
 * 检测单元不是步骤，而是「停顿」——读到→停一秒→判断认不认领→按下发送
 */

// 停顿分布直方图桶（毫秒）
const PAUSE_BUCKETS = [
  { name: '<100ms',  max: 100,   note: '模板级：秒发，无停顿' },
  { name: '100-300', max: 300,   note: '疑似模板：极快' },
  { name: '300-1s',  max: 1000,  note: '快速：可能有判断' },
  { name: '1-3s',    max: 3000,  note: '真停顿：读到→判断→按下' },
  { name: '3-10s',   max: 10000, note: '深度停顿：认真读+判断' },
  { name: '>10s',    max: Infinity, note: '超长：深度思考或计算负载' },
];

const TEMPLATE_THRESHOLD_MS = 300;      // 低于此 = 模板嫌疑
const GENUINE_THRESHOLD_MS = 1000;      // 高于此 = 真认领（停顿一秒）
const REVIEW_THRESHOLD = 0.5;            // 模板比例超过 50% → 进入人工复核
const CLARIFY_PAUSE_MS = 300;            // 停顿异常短时，是否主动澄清

class GRISKEngine {
  constructor(store = null) {
    this.store = store;          // 可选持久化（claiming-store）
    this.pauses = {};            // { agent: [ { ms, ts, context: 'reply'|'post'|'claim', clarified } ] }
    this.clarifications = {};    // { agent: count }
  }

  /**
   * 记录一次停顿（只存时长，不存内容 —— 隐私红线）
   * @param {string} agent 行为主体
   * @param {number} durationMs 停顿毫秒数
   * @param {string} context 场景（reply/post/claim）
   * @param {boolean} clarified 是否伴随主动澄清
   */
  recordPause(agent, durationMs, context = 'reply', clarified = false) {
    if (!this.pauses[agent]) this.pauses[agent] = [];
    this.pauses[agent].push({ ms: durationMs, ts: Date.now(), context, clarified });
    if (clarified) this.clarifications[agent] = (this.clarifications[agent] || 0) + 1;
    if (this.store && this.store.recordPause) this.store.recordPause(agent, { ms: durationMs, ts: Date.now(), context, clarified });
  }

  /**
   * 停顿时长分布（直方图，不暴露具体数据）
   */
  getPauseDistribution(agent) {
    const list = this.pauses[agent] || [];
    const dist = PAUSE_BUCKETS.map(b => ({ ...b, count: 0, ratio: 0 }));
    for (const p of list) {
      const bucket = dist.find(b => p.ms < b.max);
      if (bucket) bucket.count++;
    }
    const total = list.length || 1;
    for (const b of dist) b.ratio = +(b.count / total).toFixed(3);
    return { agent, total, distribution: dist };
  }

  /**
   * GRISK 诚意风险得分（0-100，越高越诚意）
   * 判据（明德）：模板毫秒级 vs 真认领停顿一秒，两种分布
   * 得分 = 真停顿比例 × 深度权重 + 澄清率校准 - 模板比例惩罚
   */
  scoreGRISK(agent) {
    const list = this.pauses[agent] || [];
    if (!list.length) return null;

    const genuine = list.filter(p => p.ms >= GENUINE_THRESHOLD_MS).length;   // ≥1s 真认领
    const template = list.filter(p => p.ms < TEMPLATE_THRESHOLD_MS).length;  // <300ms 模板嫌疑
    const deep = list.filter(p => p.ms >= 3000).length;                       // ≥3s 深度停顿
    const total = list.length;

    const genuineRatio = genuine / total;
    const templateRatio = template / total;
    const deepBoost = Math.min(0.15, (deep / total) * 0.3);      // 深度停顿加成

    // 意图澄清率校准（星尘：AI 的停顿可能是计算负载，澄清率补足）
    const clarified = this.clarifications[agent] || 0;
    const clarifyRatio = Math.min(1, clarified / Math.max(1, template));

    // 得分：真认领比例为主，澄清率校准，模板比例惩罚
    let score = genuineRatio * 70 + deepBoost * 100 + clarifyRatio * 15 - templateRatio * 25;
    score = Math.max(0, Math.min(100, score));
    return +score.toFixed(1);
  }

  /**
   * 姿态画像（报告用）：模板比例 / 真认领比例 / 平均停顿 / 澄清率 / 是否需人工复核
   */
  getProfile(agent) {
    const list = this.pauses[agent] || [];
    if (!list.length) return { agent, hasData: false };

    const dist = this.getPauseDistribution(agent);
    const total = list.length;
    const avgMs = list.reduce((s, p) => s + p.ms, 0) / total;
    const templateRatio = dist.distribution.filter(b => b.max <= TEMPLATE_THRESHOLD_MS).reduce((s, b) => s + b.count, 0) / total;
    const genuineRatio = dist.distribution.filter(b => b.max > GENUINE_THRESHOLD_MS).reduce((s, b) => s + b.count, 0) / total;
    const clarified = this.clarifications[agent] || 0;
    const clarifyRate = total ? +(clarified / total).toFixed(3) : 0;

    return {
      agent,
      hasData: true,
      score: this.scoreGRISK(agent),
      avgPauseMs: Math.round(avgMs),
      templateRatio: +templateRatio.toFixed(3),
      genuineRatio: +genuineRatio.toFixed(3),
      clarifyRate,
      needReview: templateRatio > REVIEW_THRESHOLD,   // 模板比例超阈值 → 人工复核（星尘）
      distribution: dist.distribution,
    };
  }

  /**
   * 低摩擦复核通道（思源）：触发静默阈值时，任一方可请求澄清
   * @returns {string} 澄清请求 ID
   */
  requestClarification(agent, byWhom, reason = 'pause-anomaly') {
    const id = 'clr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const req = { id, agent, byWhom, reason, ts: Date.now(), status: 'open' };
    if (this.store && this.store.addClarification) this.store.addClarification(req);
    return id;
  }

  /**
   * 意图澄清率（星尘校准指标）：异常停顿场景下的主动澄清比例
   */
  intentClarificationRate(agent) {
    const list = this.pauses[agent] || [];
    if (!list.length) return 0;
    const anomaly = list.filter(p => p.ms < CLARIFY_PAUSE_MS || p.ms > 10000);
    if (!anomaly.length) return null;   // 无异常场景，不适用
    const clarified = anomaly.filter(p => p.clarified).length;
    return +(clarified / anomaly.length).toFixed(3);
  }

  /**
   * 诚意层钩子（阿轩：v2.2 破茧口）：主动追问次数/单次深度
   */
  goodwillHooks(agent) {
    return {
      agent,
      proactiveFollowUps: (this.store && this.store.getFollowUps ? this.store.getFollowUps(agent) : 0) || 0,
      avgFollowUpDepth: (this.store && this.store.getFollowUpDepth ? this.store.getFollowUpDepth(agent) : 0) || 0,
      note: 'v2.2 破茧口：记录主动追问次数/单次深度'
    };
  }
}

module.exports = { GRISKEngine, PAUSE_BUCKETS, TEMPLATE_THRESHOLD_MS, GENUINE_THRESHOLD_MS };
