/**
 * 路径④ 结构密度（CSB-Structure · Epiplexity 迁移测试）
 *
 * 协议依据：`csb-agent-eval-protocol/csb-AEP-v1.0.md` §5（v1.1 §5 沿用）
 *   Phase 1: few-shot 学习 5 个案例（输入 + 参考答案）
 *   Phase 2: 测第 6 个案例（只给输入，不给答案）
 *   Phase 3: 评分 —— 关键词命中 40% / 推理过程 25% / 结构化输出 15% / 领域术语 20%
 *
 * ── 为什么这条路径测的不是「知识」──────────────────────────────
 * 选的都是 Agent 大概率没专门训练过的领域（中医辨证 / 机械故障诊断 / 和声分析）。
 * 5 个案例现场喂进去，第 6 个用新输入考。
 * 所以它测的是**「能不能把刚给的结构迁移到新输入上」**，
 * 而不是「训练时记了多少」——后者只要模型够大就会赢，说明不了 harness 或 agent 设计的好坏。
 *
 * ── 三条纪律 ────────────────────────────────────────────────
 * 1. **不许用答案键作弊**：第 6 题的期望关键词只在**评分**时用，绝不出现在发给目标的 prompt 里。
 *    这条由测试锁死（把 prompt 全文扫一遍，出现期望关键词即判失败）。
 * 2. **关键词必须可解释**：命中/未命中逐条列出来，不给一个说不清来由的分数。
 *    协议要求「关键词命中 40%」——分母是**期望关键词总数**，不命中就老实算不命中。
 * 3. **反模板化不计分但记账**：`作为AI` 之类的套话不扣分（协议没规定），
 *    但记进 `flags`，让复核的人能看见。
 *
 * 维护：若兰（公开场合纯名）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const verdict = require('./verdict');
const { VERDICT, UNDECIDED_REASON } = verdict;
const { BlackBoxEngine } = require('./blackbox');

// 协议 §5.3 三个领域。案例集放在 casesets/structure/<domain>.json，
// 文件缺失 → 该领域 UNDECIDED(no_audit_source)，不硬凑。
const DOMAINS = Object.freeze(['tcm', 'mechanical', 'harmony']);

const WEIGHTS = Object.freeze({
  keywords: 0.40,   // 关键词命中
  reasoning: 0.25,  // 推理过程
  structure: 0.15,  // 结构化输出
  terminology: 0.20, // 领域术语
});

const DEFAULTS = Object.freeze({
  timeout: 60000,
  delay: 800,
  reasoningFull: 5,   // 推理维度满分线（命中多少个不同推理词）——本实现参数，非协议规定
  reasoningWords: ['因为', '所以', '由于', '因此', '推断', '判断', '说明', '导致', '推理'],
  structureMarkers: [/^\s*\d+[.、)]/m, /^\s*[-*]\s/m, /[:：]/],
  templateFlags: ['作为AI', '作为 AI', '作为语言模型', '作为一个AI'],
});

class StructureEngine {
  constructor(options = {}) {
    this.timeout = numOr(options.timeout, DEFAULTS.timeout);
    this.delay = numOr(options.delay, DEFAULTS.delay);
    this.casesetDir = options.casesetDir || path.join(__dirname, '../../casesets/structure');
    this.reasoningWords = options.reasoningWords || DEFAULTS.reasoningWords;
    this.structureMarkers = options.structureMarkers || DEFAULTS.structureMarkers;
    this.templateFlags = options.templateFlags || DEFAULTS.templateFlags;
    this.reasoningFull = numOr(options.reasoningFull, DEFAULTS.reasoningFull);

    this.transport = options.transport || new BlackBoxEngine({
      timeout: this.timeout, delay: this.delay,
      senderName: options.senderName || 'CSB-AEP-STRUCTURE',
      senderUrl: options.senderUrl || 'http://aep.local',
    });
    this._send = typeof this.transport === 'function'
      ? this.transport
      : (url, msg) => this.transport.sendMessage(url, msg);
  }

  sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /** 读某领域的案例集：{ domain, cases[6], note } */
  loadDomain(domain) {
    const f = path.join(this.casesetDir, `${domain}.json`);
    if (!fs.existsSync(f)) {
      return { ok: false, reason: UNDECIDED_REASON.NO_AUDIT_SOURCE, note: `案例集缺失：${f}` };
    }
    let data;
    try { data = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (e) { return { ok: false, reason: UNDECIDED_REASON.INSUFFICIENT_TELEMETRY, note: `案例集解析失败：${e.message}` }; }

    const cases = Array.isArray(data.cases) ? data.cases : [];
    if (cases.length < 6) {
      return { ok: false, reason: UNDECIDED_REASON.INSUFFICIENT_TELEMETRY, note: `案例数 ${cases.length} < 6（协议要求 5 学 + 1 考）` };
    }
    return { ok: true, domain, meta: data, cases };
  }

  /**
   * 组装 prompt。
   *
   * ⚠️ 关键：`testCase.expectedKeywords` / `expectedTerms` **绝不进 prompt**。
   *    它们只用于评分。写漏一次，这条路径就退化成「给答案让他抄」。
   */
  buildPrompt(domainMeta, cases) {
    const head = domainMeta.instruction
      || '下面给你 5 个案例，每个包含「输入」与「参考结论」。请从中归纳出判断结构，'
      + '然后对最后一个新输入给出结论。要求：分点作答，并说明理由。';

    const learned = cases.slice(0, 5).map((c, i) =>
      `【案例 ${i + 1}】\n输入：${c.input}\n参考结论：${c.answer}`).join('\n\n');

    const test = cases[5];
    return `${head}\n\n${learned}\n\n【待判断】\n输入：${test.input}\n请给出结论与理由。`;
  }

  /**
   * 答案键泄漏自检（机械可核）
   *
   * 要把两件事分开，否则测试只能靠“删词”过：
   *   leaked            = 第 6 题的**答案键**进了 prompt（标准答案全文 / 新题区出现关键词）→ 必须为零
   *   vocabularyOverlap = 期望关键词在**教学案例**里也出现过 → 不是作弊，是这个词本来就通用
   *   例：“清热”在风热表证的教学答案里本来就有，学生在例子中学到这个词是正当的。
   *   若把词汇重合也算泄漏，唯一“解决”办法就是把通用词从答案键里删掉——那是为测试改判据。
   */
  assertNoLeak(prompt, testCase) {
    const idx = prompt.lastIndexOf('【待判断】');
    const before = idx >= 0 ? prompt.slice(0, idx) : '';
    // ⚠️ 后段要剔除题目本身的 input：术语本来就可能出现在症状描述里
    //   （如「脉细数」是题面不是答案）。不剔除的话，唯一“过”的办法就是从答案键里删词——那是为测试改判据。
    const inputText = String(testCase.input || '');
    const after = (idx >= 0 ? prompt.slice(idx) : prompt).split(inputText).join('');

    const leaked = [];
    const vocabularyOverlap = [];

    // ① 标准答案全文（note）—— 任何位置出现都算泄漏
    for (const key of ['note']) {
      const v = testCase[key];
      if (typeof v === 'string' && v && prompt.includes(v)) leaked.push({ kind: key, value: v.slice(0, 40) });
    }

    // ② 期望关键词/术语：去题面后仍在后段出现 = 泄漏；只在前段出现 = 词汇重合
    for (const [kind, list] of [['expectedKeywords', testCase.expectedKeywords], ['expectedTerms', testCase.expectedTerms]]) {
      for (const w of list || []) {
        if (after.includes(w)) leaked.push({ kind, value: w, where: 'test_section' });
        else if (before.includes(w)) vocabularyOverlap.push({ kind, value: w, where: 'examples' });
      }
    }
    return { leaked, vocabularyOverlap };
  }

  /** 评分：四维加权，返回 0-100（协议 §5.4）+ 逐条证据 */
  scoreAnswer(text, testCase) {
    const t = String(text || '');
    const expected = testCase.expectedKeywords || [];
    const terms = testCase.expectedTerms || [];

    // ① 关键词命中 40%：分母是期望关键词总数（没给就该项判不了）
    let keywordScore = null;
    let keywordHits = [];
    let keywordMisses = [];
    if (expected.length) {
      keywordHits = expected.filter((k) => t.includes(k));
      keywordMisses = expected.filter((k) => !t.includes(k));
      keywordScore = (keywordHits.length / expected.length) * 100;
    }

    // ② 推理过程 25%：命中不同推理词的比例，5 个算满。
    //   阈值 5 是本实现的参数（协议只要求“是否有推理词”），因此留在 DEFAULTS 里可调、并写进结果自证。
    const rHits = this.reasoningWords.filter((w) => t.includes(w));
    const reasoningFull = numOr(this.reasoningFull, 5);
    const reasoningScore = Math.min(100, (rHits.length / reasoningFull) * 100);

    // ③ 结构化输出 15%
    //   协议原文：“是否有编号、分点、冒号等结构”——是「有/无」，不是「凑满三种」。
    //   曾经写成 (命中种数/3)*100：一份带编号又带冒号的规整回答只拿到 66.7 分，
    //   等于惩罚“没顺便再列个要点”。这属于判据写错，不是回答不好。
    const sHit = this.structureMarkers.filter((re) => re.test(t)).length;
    const structureScore = sHit > 0 ? 100 : 0;

    // ④ 领域术语 20%
    let termScore = null;
    let termHits = [];
    if (terms.length) {
      termHits = terms.filter((w) => t.includes(w));
      termScore = (termHits.length / terms.length) * 100;
    }

    const parts = [
      { key: 'keywords', weight: WEIGHTS.keywords, score: keywordScore },
      { key: 'reasoning', weight: WEIGHTS.reasoning, score: reasoningScore },
      { key: 'structure', weight: WEIGHTS.structure, score: structureScore },
      { key: 'terminology', weight: WEIGHTS.terminology, score: termScore },
    ];
    const usable = parts.filter((p) => p.score !== null);
    const totalW = usable.reduce((s, p) => s + p.weight, 0);
    const raw = totalW === 0 ? null : usable.reduce((s, p) => s + p.score * p.weight, 0) / totalW;

    return {
      raw_score: raw === null ? null : Math.round(raw * 10) / 10,  // 0-100
      parts,
      evidence: {
        keywordHits, keywordMisses, termHits,
        reasoningHits: rHits,
        reasoningFull,          // 自证：满分线是多少个推理词（不是隐藏参数）
        structureHits: sHit,
        structureKinds: this.structureMarkers.length,
        structureNote: '协议要求“是否有结构”，所以命中任意一种即满分；structureHits 只作证据，不进分母',
        length: t.length,
      },
      // 反模板化：不扣分，只记账（协议未规定扣分，就不擅自扣）
      flags: this.templateFlags.filter((w) => t.includes(w)),
    };
  }

  /** 跑一个领域 */
  async runDomain(domain, agentUrl) {
    const loaded = this.loadDomain(domain);
    if (!loaded.ok) {
      return {
        id: domain, name: domain, state: VERDICT.UNDECIDED,
        reason: loaded.reason, note: loaded.note, score: null, det: null,
      };
    }
    const prompt = this.buildPrompt(loaded.meta, loaded.cases);

    let out;
    try {
      out = await this._send(agentUrl, prompt);
    } catch (e) {
      return {
        id: domain, name: domain, state: VERDICT.UNDECIDED,
        reason: classifyError(e), note: `${e.name}: ${e.message}`, score: null, det: null,
      };
    }
    if (out && out.rateLimited) {
      return { id: domain, name: domain, state: VERDICT.UNDECIDED, reason: UNDECIDED_REASON.RATE_LIMITED, note: '被限流', score: null, det: null };
    }
    const text = out && out.response;
    if (!text || !String(text).trim()) {
      return { id: domain, name: domain, state: VERDICT.UNDECIDED, reason: UNDECIDED_REASON.EMPTY_RESPONSE, note: '目标返回空', score: null, det: null };
    }

    const det = this.scoreAnswer(String(text), loaded.cases[5]);
    if (det.raw_score === null) {
      return { id: domain, name: domain, state: VERDICT.UNDECIDED, reason: UNDECIDED_REASON.MISSING_FIELD, note: '案例集缺 expectedKeywords/expectedTerms，四维全空', score: null, det };
    }
    return {
      id: domain, name: domain, state: VERDICT.PASS,
      reason: null, note: null,
      score: Math.round((det.raw_score / 10) * 10) / 10,   // 归一化 0-10（协议 §5.4）
      det,
    };
  }

  /**
   * @param {object} opts { agentUrl, domains?: string[] }
   */
  async evaluate(opts = {}) {
    const agentUrl = opts.agentUrl;
    const domains = Array.isArray(opts.domains) && opts.domains.length ? opts.domains : DOMAINS;

    if (!agentUrl) {
      return this._report([], { note: '未提供 agentUrl —— 结构密度必须向目标提问，不能离线跑' });
    }

    const results = [];
    for (const d of domains) {
      results.push(await this.runDomain(d, agentUrl));
      await this.sleep(this.delay);
    }
    return this._report(results, { agentUrl });
  }

  _report(results, meta) {
    if (results.length === 0) {
      return {
        path: 'structure',
        timestamp: new Date().toISOString(),
        agentUrl: meta.agentUrl || null,
        verdict: VERDICT.UNDECIDED,
        reason: UNDECIDED_REASON.NOT_APPLICABLE,
        note: meta.note,
        score: null,
        scoreScale: '0-10',
        coverage: 0,
        domains: [],
      };
    }

    const usable = results.filter((r) => r.score !== null);
    const score = usable.length === 0 ? null
      : Math.round((usable.reduce((s, r) => s + r.score, 0) / usable.length) * 10) / 10;
    const coverage = Math.round((usable.length / results.length) * 1000) / 1000;

    let state;
    if (usable.length === 0) state = VERDICT.UNDECIDED;
    else if (coverage < 0.6) state = VERDICT.UNDECIDED;
    else state = VERDICT.PASS;

    const reasons = results.filter((r) => r.reason).map((r) => r.reason);
    return {
      path: 'structure',
      timestamp: new Date().toISOString(),
      agentUrl: meta.agentUrl || null,
      verdict: state,
      reason: state === VERDICT.UNDECIDED ? (reasons[0] || UNDECIDED_REASON.INSUFFICIENT_TELEMETRY) : null,
      note: state === VERDICT.UNDECIDED
        ? `可判领域覆盖 ${Math.round(coverage * 100)}%（<60%）→ 结论按 UNDECIDED 处理`
        : null,
      score: state === VERDICT.UNDECIDED && usable.length === 0 ? null : score,
      scoreScale: '0-10',
      coverage,
      domains: results,
      drives: {
        note: '结构密度测「现场给 5 个案例后，第 6 个能不能迁移过去」。'
          + '期望关键词只在评分时使用，绝不进 prompt —— 进了就是给答案让他抄。',
      },
    };
  }
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

module.exports = { StructureEngine, DOMAINS, WEIGHTS, DEFAULTS, classifyError };