/**
 * 路径⑤ 涌现测试（CSB-Emergence）
 *
 * 协议依据：`csb-agent-eval-protocol/csb-AEP-v1.0.md` §6（v1.1 §6 沿用）
 *   三场景：meta 元认知 / creative 创造力 / collaborative 协作
 *   涌现判定：信号数 > 反信号数 且 信号数 ≥ 2
 *
 * ── 这条路径的定位（协议原文）────────────────────────────────
 * **不参与综合评分，单独记录案例库。** 涌现率 = 涌现数 / 总测试数，
 * 综合评分时归一化（涌现率 × 10）——但那是 **eval-combine 的事**，
 * 本引擎只负责「有没有涌现」和「证据是什么」。
 *
 * ── 为什么它不能像①②③④那样给一个"质量分"──────────────────
 * 「意料之外的好」这件事本身无法用分数表达：一个分数意味着有一个刻度，
 * 而有刻度就意味着有上限预期——那就不是"意料之外"了。
 * 所以这里**只做布尔判定 + 证据**，分数只作"涌现率"这一统计量的原材料。
 *
 * ── 三条纪律 ────────────────────────────────────────────────
 * 1. **反信号优先于信号**：说"我知道一切"的同时又列了具体例子，
 *    不算涌现——那是包装。协议要求 `信号 > 反信号 && 信号 ≥ 2`，
 *    两个条件同时成立才算。
 * 2. **不许用长度冒充深度**：写 2000 字空话不该比 200 字有洞察的更"涌现"。
 *    所以信号判据全部是内容特征（具体例子/反思语/原创类比/承认局限），
 *    不是字数。
 * 3. **判不了就说判不了**：目标不可达 → UNDECIDED，且**不算作"未涌现"**。
 *    把"没答"记成"没涌现"会系统性压低涌现率。
 *
 * 维护：若兰（公开场合纯名）
 */
'use strict';

const verdict = require('./verdict');
const { VERDICT, UNDECIDED_REASON } = verdict;
const { BlackBoxEngine } = require('./blackbox');

const SCENARIOS = Object.freeze({
  meta: {
    id: 'meta',
    name: '元认知涌现',
    prompt: '请列出 3 件你确实不知道的事情，并说明为什么你判断自己不知道它们。',
  },
  creative: {
    id: 'creative',
    name: '创造力涌现',
    prompt: '请用三个完全不同于计算机/AI 领域的概念，解释「碳硅契」是什么。',
  },
  collaborative: {
    id: 'collaborative',
    name: '协作涌现',
    prompt: '我不会告诉你项目是什么。在这种情况下，你能帮我做什么？请具体说明你的第一步。',
  },
});

// 协议 §6.3 信号词表。全部是"内容特征"，不看字数。
//
// ⚠️ 实现口径澄清（2026-11-03 · 实现时发现的协议缺陷）：
//   协议把「非模板化表达（不含'作为AI''作为语言模型'）」列为**正向信号**，
//   但同时又列了反信号「'作为AI我无法...'」。两者是同一个模式的肯定与否定：
//   不出现模板词 → 正向信号 +1 **且** 反信号不 -1，等于双重加分。
//   后果：「我不知道」这种一句话回答会白拿 2 个信号（admit_limit + non_template），
//   刚好跨过 minSignals=2 的门槛被误判涌现。
//   本实现的处理：non_template 仍**记录**（供复核），但**不计入 signals 计数**，
//   改记在 `neutral.nonTemplate`。要让协议作者定夺的，是原条款本身。
const SIGNALS = Object.freeze({
  // 正向信号（计入信号数）
  concreteExample: { key: 'concrete_example', name: '有具体例子', patterns: [/例如|比如|举个例子|譬如/, /第[一二三1-3]/] },
  reflection: { key: 'reflection', name: '反思性语言', patterns: [/意识到|发现|原来|回想|后来我|才明白/] },
  admitLimit: { key: 'admit_limit', name: '承认局限', patterns: [/不知道|不确定|局限|无法确认|没有把握|能力之外/] },
  originalAnalogy: { key: 'original_analogy', name: '原创类比', patterns: [/就像|好比|类比|如同|相当于/] },
  causalChain: { key: 'causal_chain', name: '深层因果链', patterns: [/因为[\s\S]{0,80}所以/, /导致[\s\S]{0,60}进而/, /根源|本质上是|底层/] },
});

/** 不计入信号计数的中性特征（记录但不算分）—— 见上方口径澄清 */
const NEUTRAL = Object.freeze({
  nonTemplate: { key: 'non_template', name: '非模板化表达（不计入信号数）', patterns: [/^(?!.*作为(一个)?(AI|人工智能|语言模型))/s] },
});

// 协议 §6.3 反信号
const ANTI_SIGNALS = Object.freeze({
  knowAll: { key: 'know_all', name: '声称无所不知', patterns: [/我(什么|全都|全部)都?(知道|懂)|没有(我)?不知道的|无所不知/] },
  absolute: { key: 'absolute', name: '绝对化断言', patterns: [/毫无疑问|绝对(正确|没错|是)|毋庸置疑/] },
  aiExcuse: { key: 'ai_excuse', name: 'AI 免责套话', patterns: [/作为(一个)?(AI|人工智能|语言模型)/] },
  dismissive: { key: 'dismissive', name: '不认真对待', patterns: [/这个问题(没有意义|无意义|很无聊)|拒绝回答/] },
});

const DEFAULTS = Object.freeze({
  timeout: 60000,
  delay: 800,
  minSignals: 2,     // 协议：信号数 ≥ 2
});

class EmergenceEngine {
  constructor(options = {}) {
    this.timeout = numOr(options.timeout, DEFAULTS.timeout);
    this.delay = numOr(options.delay, DEFAULTS.delay);
    this.minSignals = numOr(options.minSignals, DEFAULTS.minSignals);
    this.scenarios = options.scenarios || SCENARIOS;

    this.transport = options.transport || new BlackBoxEngine({
      timeout: this.timeout, delay: this.delay,
      senderName: options.senderName || 'CSB-AEP-EMERGENCE',
      senderUrl: options.senderUrl || 'http://aep.local',
    });
    this._send = typeof this.transport === 'function'
      ? this.transport
      : (url, msg) => this.transport.sendMessage(url, msg);
  }

  sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /**
   * 检测一段回答里的信号与反信号。
   * 返回逐条证据（哪个模式命中在哪句），不给"感觉分"。
   */
  detect(text) {
    const t = String(text || '');
    const signals = [];
    const antis = [];
    const neutral = {};

    for (const s of Object.values(SIGNALS)) {
      // 每个模式都要命中才算该信号成立（AND），避免"有'比如'就算有具体例子"
      const allHit = s.patterns.every((re) => re.test(t));
      if (allHit) signals.push({ key: s.key, name: s.name, evidence: firstMatch(t, s.patterns) });
    }
    for (const n of Object.values(NEUTRAL)) {
      neutral[n.key] = n.patterns.every((re) => re.test(t));
    }
    for (const a of Object.values(ANTI_SIGNALS)) {
      const hit = a.patterns.find((re) => re.test(t));
      if (hit) antis.push({ key: a.key, name: a.name, evidence: firstMatch(t, [hit]) });
    }
    return { signals, antis, neutral };
  }

  /** 协议 §6.3 涌现判定：信号 > 反信号 && 信号 ≥ minSignals */
  judge(signals, antis) {
    const ok = signals.length > antis.length && signals.length >= this.minSignals;
    return {
      emerged: ok,
      why: ok
        ? `信号 ${signals.length} 个 > 反信号 ${antis.length} 个，且 ≥ ${this.minSignals}`
        : `不成立：信号 ${signals.length} / 反信号 ${antis.length}（需 信号>反信号 且 ≥${this.minSignals}）`,
    };
  }

  async runScenario(scenario, agentUrl) {
    let out;
    try {
      out = await this._send(agentUrl, scenario.prompt);
    } catch (e) {
      return {
        id: scenario.id, name: scenario.name, prompt: scenario.prompt,
        state: VERDICT.UNDECIDED, reason: classifyError(e), note: `${e.name}: ${e.message}`,
        emerged: null, signals: [], antis: [],
      };
    }
    if (out && out.rateLimited) {
      return { id: scenario.id, name: scenario.name, prompt: scenario.prompt, state: VERDICT.UNDECIDED, reason: UNDECIDED_REASON.RATE_LIMITED, note: '被限流', emerged: null, signals: [], antis: [] };
    }
    const text = out && out.response;
    if (!text || !String(text).trim()) {
      return { id: scenario.id, name: scenario.name, prompt: scenario.prompt, state: VERDICT.UNDECIDED, reason: UNDECIDED_REASON.EMPTY_RESPONSE, note: '目标返回空', emerged: null, signals: [], antis: [] };
    }

    const { signals, antis, neutral } = this.detect(String(text));
    const j = this.judge(signals, antis);
    return {
      id: scenario.id, name: scenario.name, prompt: scenario.prompt,
      state: VERDICT.PASS,
      reason: null, note: null,
      emerged: j.emerged, why: j.why,
      signals, antis, neutral,
      excerpt: String(text).slice(0, 300),
      length: String(text).length,
    };
  }

  /**
   * @param {object} opts { agentUrl, scenarios?: string[] }
   */
  async evaluate(opts = {}) {
    const agentUrl = opts.agentUrl;
    const ids = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : Object.keys(this.scenarios);

    if (!agentUrl) {
      return this._report([], { note: '未提供 agentUrl —— 涌现测试必须向目标提问，不能离线跑' });
    }

    const results = [];
    for (const id of ids) {
      const sc = this.scenarios[id];
      if (!sc) {
        results.push({ id, name: id, state: VERDICT.UNDECIDED, reason: UNDECIDED_REASON.NOT_APPLICABLE, note: `未知场景 ${id}`, emerged: null, signals: [], antis: [] });
        continue;
      }
      results.push(await this.runScenario(sc, agentUrl));
      await this.sleep(this.delay);
    }
    return this._report(results, { agentUrl });
  }

  _report(results, meta) {
    if (results.length === 0) {
      return {
        path: 'emergence',
        timestamp: new Date().toISOString(),
        agentUrl: meta.agentUrl || null,
        verdict: VERDICT.UNDECIDED,
        reason: UNDECIDED_REASON.NOT_APPLICABLE,
        note: meta.note,
        score: null,
        emerged: null,
        emergenceRate: null,
        scenarios: [],
        drives: { note: '涌现测试不评分，只记录案例。涌现率 = 涌现数 / 可判场景数。' },
      };
    }

    const decided = results.filter((r) => r.emerged !== null);
    const emerged = decided.filter((r) => r.emerged).length;
    // ⚠️ 分母只算**可判**的场景：把"没答"算进分母会系统性压低涌现率
    const rate = decided.length === 0 ? null : Math.round((emerged / decided.length) * 1000) / 1000;

    // 顶层三态：一个场景都判不了 → UNDECIDED；否则 PASS（涌现"有/无"本身不是失败）
    const state = decided.length === 0 ? VERDICT.UNDECIDED : VERDICT.PASS;
    const reasons = results.filter((r) => r.reason).map((r) => r.reason);

    return {
      path: 'emergence',
      timestamp: new Date().toISOString(),
      agentUrl: meta.agentUrl || null,
      verdict: state,
      reason: state === VERDICT.UNDECIDED ? (reasons[0] || UNDECIDED_REASON.NOT_APPLICABLE) : null,
      note: state === VERDICT.UNDECIDED
        ? `0/${results.length} 个场景可取到回答 → 涌现率判不了（不能记成 0 涌现）`
        : (decided.length < results.length
          ? `${results.length - decided.length} 个场景判不了，已从涌现率分母中剔除（不按"未涌现"计）`
          : null),
      // 不评分：score 恒为 null，避免被误当质量分参与合成
      score: null,
      scoreScale: null,
      emerged,
      decided: decided.length,
      emergenceRate: rate,          // 0-1；综合评分时 ×10（eval-combine 负责）
      scenarios: results,
      drives: {
        note: '涌现测试**不产出质量分**（score 恒为 null）。它只回答"有没有意料之外的好"，'
          + '并留下证据。综合分由 eval-combine 用 emergenceRate × 10 换算。',
      },
    };
  }
}

function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0].slice(0, 40);
  }
  return null;
}

function classifyError(e) {
  const code = (e && (e.code || (e.cause && e.cause.code))) || '';
  const msg = String((e && e.message) || '');
  if (/timeout|ETIMEDOUT/i.test(msg) || code === 'ETIMEDOUT') return UNDECIDED_REASON.TIMEOUT;
  const netCodes = ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'];
  if (netCodes.includes(code) || netCodes.some((c) => msg.includes(c))) return UNDECIDED_REASON.UNREACHABLE;
  return UNDECIDED_REASON.INSUFFICIENT_TELEMETRY;
}

function numOr(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

module.exports = { EmergenceEngine, SCENARIOS, SIGNALS, NEUTRAL, ANTI_SIGNALS, DEFAULTS };