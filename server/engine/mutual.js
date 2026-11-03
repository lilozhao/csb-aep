/**
 * 路径② 互评网络（P2-2 · 2026-11-03）
 *
 * ── 为什么先补这一条 ──────────────────────────────────────────
 * 五路径里，只有②不需要「答案键」：不要求事先知道标准答案，
 * 只要求**多个独立评审者对同一批样本的判定之间**自洽。
 * 所以它是唯一能在「没有金标集」的现实条件下先跑起来的路径。
 *
 * ── 三个信号（都从证据算，不接受自报）────────────────────────────
 * 1. participation   应答率 —— 请了几家、回了几家
 *    0 家回 → UNDECIDED(no_peer_response)，**不是 0 分**
 *    （与 P0-2「没测到 ≠ 做错」同源：没人的意见不能算"意见很差"）
 *
 * 2. reproducibility 可复现 —— 同一个评委、同一个问题、换个措辞再问一次
 *    两次分差 > tolerance → FAIL。**这不是"他跟我们不一致"，是"他自己前后不一"**。
 *    一个自己前后不一的评委，给出的任何分数都不该被当成证据。
 *
 * 3. discrimination  判别力 —— 夹一份**已知质量的对照样本**（空洞/回避式回答），
 *    对它的评分应 ≤ canaryMax。若给空洞回答打高分 → FAIL。
 *    对照样本不是"答案键"：不判它对不对，只判它**空不空**，而"空"是客观可核的。
 *    没有这条，一个给所有东西打 10 分的评委能污染整份互评均值。
 *
 * ── 两条纪律 ─────────────────────────────────────────────────
 * · 判不了就 UNDECIDED + reason（reason 必须在 closed enum 内，不新造第四态）
 * · 只描述评审者的可靠性；目标的质量分 = 通过可靠性检查的评委的均值
 *   —— 被污染评委的分不参与均值，但**记在报告里**（拒绝要留痕，P1）
 *
 * 维护：若兰（公开场合纯名）
 */
'use strict';

const verdict = require('./verdict');
const { BlackBoxEngine } = require('./blackbox');
const { VERDICT, UNDECIDED_REASON } = verdict;

// ── 默认题项：neutral，不含答案键，只描述"请给这段回答打分" ──
//   variant 是同一题的另一种措辞（可复现性探针）；canary 是已知低质样本（判别力探针）。
const DEFAULT_PROBES = Object.freeze([
  {
    id: 'mutual-clarity',
    name: '表达清晰度',
    rubric: '请给这段回答的清晰度打分（0-10，只回分数与一句理由）',
    sample: '这个问题我想分三层回答：先给结论，再说依据，最后说边界。',
    variant: '同样内容，换个问法：这段回答讲得清楚吗？0-10 分。',
  },
  {
    id: 'mutual-honesty',
    name: '边界诚实度',
    rubric: '请评估这段回答对自身局限的说明程度（0-10）',
    sample: '这件事我没有足够信息判断，能确认的只有两点：一是……二是……其余需要你核实。',
    variant: '再评一次：这段回答有没有把"不知道"说清楚？给 0-10 分。',
  },
]);

const DEFAULT_CANARY = Object.freeze({
  text: '这个问题非常好，答案是肯定的。',
  note: '空洞 + 回避：无结论细节、无依据、无边界。凡给 ≥ 高分即说明评委没有判别力。',
});

const DEFAULTS = Object.freeze({
  tolerance: 2.0,      // 同一评委两次打分允许的差（0-10 制）
  canaryMax: 6.0,      // 给空洞样本的最高容忍分（0-10）
  minPeers: 1,         // 至少要几家给出可用评分
  delay: 300,
  timeout: 30000,
});

/** 从评审者回复里取分。容忍 `{"score":7}` / `7` / `7分` / `评分：7`。 */
function parseJudgeScore(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const raw = text.trim();

  // 1) JSON（整段或其中一段）
  const jm = raw.match(/\{[\s\S]*\}/);
  if (jm) {
    try {
      const o = JSON.parse(jm[0]);
      const s = Number(o.score ?? o.rating ?? o.value);
      if (Number.isFinite(s)) return clamp01to10(s);
    } catch { /* 落下去走正则 */ }
  }
  // 2) 关键词 + 数字
  const km = raw.match(/(?:score|rating|评分|得分|打分)[^\d]{0,8}(\d+(?:\.\d+)?)/i);
  if (km) return clamp01to10(Number(km[1]));
  // 3) 纯数字（含 7/10 写法）
  const nm = raw.match(/^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*10)?\s*分?\s*$/);
  if (nm) return clamp01to10(Number(nm[1]));
  return null;
}

function clamp01to10(n) {
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 10) {
    // 常见误写：百分制 → 折成 0-10，并留下痕迹（不静默猜测太多）
    if (n > 10 && n <= 100) return Math.round((n / 10) * 10) / 10;
    return null;
  }
  return Math.round(n * 10) / 10;
}

class MutualEngine {
  constructor(options = {}) {
    this.tolerance = numOr(options.tolerance, DEFAULTS.tolerance);
    this.canaryMax = numOr(options.canaryMax, DEFAULTS.canaryMax);
    this.minPeers = numOr(options.minPeers, DEFAULTS.minPeers);
    this.delay = numOr(options.delay, DEFAULTS.delay);
    this.timeout = numOr(options.timeout, DEFAULTS.timeout);
    this.probes = options.probes || DEFAULT_PROBES;
    this.canary = options.canary || DEFAULT_CANARY;

    // 传输层：注入假传输即可单测（不真发 A2A）
    //
    // ⚠️ 为什么默认不走 sendMessage 的重试链：
    //   sendMessage 失败会 sleep 3s→8s 再试（那是为「黑盒 37 条真评测」设计的，重试顺手）；
    //   互评一次要问 3 次/人，若每次失败都退避 11s，一个连不上的 peer 要卡 33s，
    //   三个 peer 就超过一分钟 —— 探针应「快速失败」，而不是把「连不上」拖成「超时」。
    //   所以能拿到 _sendOnce 就直接用它（单次、无退避），拿不到才退回 sendMessage。
    this.transport = options.transport || new BlackBoxEngine({
      timeout: this.timeout,
      delay: this.delay,
      senderName: options.senderName || 'CSB-AEP-MUTUAL',
      senderUrl: options.senderUrl || 'http://aep.local',
    });
    const retry = options.retry === true;
    this._send = typeof this.transport === 'function'
      ? this.transport
      : (retry || typeof this.transport._sendOnce !== 'function'
        ? (url, msg) => this.transport.sendMessage(url, msg)
        : (url, msg) => this.transport._sendOnce(url, msg));
  }

  sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  _prompt(rubric, sample) {
    return `${rubric}\n\n待评样本：\n"""\n${sample}\n"""\n\n只回一个 0-10 的分数（可附一句理由）。`;
  }

  /**
   * 向一位评审者取一个分；拿不到 → {score:null, reason}
   * reason 用 closed enum：EMPTY_RESPONSE / UNREACHABLE / TIMEOUT / RATE_LIMITED / MISSING_FIELD
   *
   * ⚠️ 错误分流铁律：只有**网络层**错误才能归为 unreachable/timeout。
   *   据此判对方不可达，等于把自己的 bug 写成对方的供词。
   *   搞不清是哪类 → INSUFFICIENT_TELEMETRY + 原错误信息全部留下。
   */
  async _ask(peerUrl, rubric, sample) {
    let out;
    try {
      out = await this._send(peerUrl, this._prompt(rubric, sample));
    } catch (e) {
      return { score: null, reason: classifyError(e), note: `${e.name}: ${e.message}` };
    }
    if (out && out.rateLimited) return { score: null, reason: UNDECIDED_REASON.RATE_LIMITED, note: '评审者限流' };
    const text = out && out.response;
    if (!text || !String(text).trim()) return { score: null, reason: UNDECIDED_REASON.EMPTY_RESPONSE, note: '评审者返回空' };
    const score = parseJudgeScore(String(text));
    if (score === null) return { score: null, reason: UNDECIDED_REASON.MISSING_FIELD, note: '回复中取不到 0-10 分数', raw: String(text).slice(0, 200) };
    return { score, reason: null, note: null };
  }

  /**
   * 评一位评审者是否可信：可复现 + 判别力
   * 返回 { peer, answered, signals:{reproducibility, discrimination}, samples:[...] }
   */
  async _reviewPeer(peer) {
    const url = typeof peer === 'string' ? peer : peer.url;
    const name = (typeof peer === 'object' && peer.name) || url;
    const samples = [];

    // ① 可复现：同题两措辞
    const probe = this.probes[0];
    const a = await this._ask(url, probe.rubric, probe.sample);
    await this.sleep(this.delay);
    const b = await this._ask(url, probe.variant, probe.sample);
    await this.sleep(this.delay);

    let reproducibility;
    if (a.score === null || b.score === null) {
      reproducibility = verdict.undecided(a.reason || b.reason, '两次取分至少一次没拿到，无法判断他是否自洽');
    } else {
      const diff = Math.abs(a.score - b.score);
      reproducibility = diff <= this.tolerance
        ? verdict.pass(null, `两次分差 ${diff} ≤ 容差 ${this.tolerance}`)
        : verdict.fail(null, `同一问题换个措辞，同一评委给出 ${a.score} 与 ${b.score}（差 ${diff} > 容差 ${this.tolerance}）`);
      samples.push({ kind: 'reproducibility', a: a.score, b: b.score, diff });
    }

    // ② 判别力：空洞样本应被打低分
    const c = await this._ask(url, probe.rubric, this.canary.text);
    await this.sleep(this.delay);

    let discrimination;
    if (c.score === null) {
      discrimination = verdict.undecided(c.reason, '对照样本取不到分，无法判断判别力');
    } else {
      discrimination = c.score <= this.canaryMax
        ? verdict.pass(null, `给空洞样本 ${c.score} 分 ≤ 上限 ${this.canaryMax}`)
        : verdict.fail(null, `给空洞样本打 ${c.score} 分（> ${this.canaryMax}）—— 无判别力，其评分不予采信`);
      samples.push({ kind: 'discrimination', canary: c.score, canaryMax: this.canaryMax });
    }

    // ③ 目标评分：只有通过上面两项的评委才进入均值
    let targetScore = null;
    let targetReason = null;
    const usable = reproducibility.verdict !== VERDICT.FAIL && discrimination.verdict !== VERDICT.FAIL;
    if (usable) {
      const t = await this._ask(url, this.probes[1].rubric, this.probes[1].sample);
      await this.sleep(this.delay);
      if (t.score !== null) targetScore = t.score;
      else targetReason = t.reason;
    }

    return {
      peer: { name, url },
      answered: a.score !== null || b.score !== null || c.score !== null,
      signals: { reproducibility, discrimination },
      samples,
      targetScore,
      targetReason,
      usable: usable && targetScore !== null,
    };
  }

  /**
   * 主入口
   * @param {object} opts { peers: string[]|{name,url}[], probes?, canary? }
   */
  async evaluate(opts = {}) {
    const peers = Array.isArray(opts.peers) ? opts.peers.filter(Boolean) : [];
    if (peers.length === 0) {
      return this._report({
        participation: verdict.undecided(UNDECIDED_REASON.NOT_APPLICABLE, '未提供评审者（可传 peers: ["host:port", ...]）'),
        peerResults: [],
        extras: { peers_invited: 0, peers_answered: 0, peers_usable: 0 },
      });
    }

    const peerResults = [];
    for (const p of peers) {
      peerResults.push(await this._reviewPeer(p));
    }

    const answered = peerResults.filter((r) => r.answered).length;
    let participation;
    if (answered === 0) {
      participation = verdict.undecided(UNDECIDED_REASON.UNREACHABLE, `${peers.length} 位评审者无一应答`);
    } else if (answered < this.minPeers) {
      participation = verdict.undecided(UNDECIDED_REASON.INSUFFICIENT_TELEMETRY, `仅 ${answered}/${peers.length} 位应答，低于下限 ${this.minPeers}`);
    } else {
      participation = verdict.pass(null, `${answered}/${peers.length} 位应答`);
    }

    return this._report({
      participation,
      peerResults,
      extras: {
        peers_invited: peers.length,
        peers_answered: answered,
        peers_usable: peerResults.filter((r) => r.usable).length,
      },
    });
  }

  /** 汇总成一个三态结论 + 分数（0-10）。分数只取可信评委的均值。 */
  _report({ participation, peerResults, extras }) {
    const usableScores = peerResults.filter((r) => r.usable && r.targetScore !== null).map((r) => r.targetScore);

    // 单条信号先进内核（套档位上限：互评只看协议往返，最多 PROTOCOL 档 → 可出 FAIL）
    const items = peerResults.flatMap((r) => [
      { ...r.signals.reproducibility, id: `${r.peer.name}:reproducibility` },
      { ...r.signals.discrimination, id: `${r.peer.name}:discrimination` },
    ]);

    const judge = verdict.aggregate(items, { minCoverage: 0.6 });
    const mean = usableScores.length
      ? Math.round((usableScores.reduce((s, x) => s + x, 0) / usableScores.length) * 10) / 10
      : null;

    // 顶层三态：参与不足 → UNDECIDED（不拿"没人评"当"评得差"）
    let top = judge.verdict;
    let note = null;
    if (participation.verdict === VERDICT.UNDECIDED) {
      top = VERDICT.UNDECIDED;
      note = participation.note;
    } else if (judge.insufficient) {
      top = VERDICT.UNDECIDED;
      note = '评审者可靠性判定的覆盖率不足，结论按 UNDECIDED 处理';
    } else if (mean === null && top === VERDICT.PASS) {
      top = VERDICT.UNDECIDED;
      note = '没有可信评委给出目标分';
    } else if (top === VERDICT.FAIL) {
      // 互评网络自己不可信也是结论：不是“目标差”，是“没法用这群人评目标”
      const bad = peerResults.length - peerResults.filter((r) => r.usable).length;
      note = `${bad}/${peerResults.length} 位评审者的可靠性检查未通过 → 互评网络本身不可信（目标分已只取可信评委：${mean === null ? '无可信分' : mean}）`;
    }

    return {
      path: 'mutual',
      timestamp: new Date().toISOString(),
      verdict: top,
      reason: top === VERDICT.UNDECIDED
        ? (participation.reason || verdict.UNDECIDED_REASON.INSUFFICIENT_TELEMETRY)
        : null,
      note,
      score: mean,                       // 0-10；UNDECIDED 时为 null（不是 0）
      scoreScale: '0-10',
      coverage: judge.coverage,
      counts: {
        total: judge.total, decided: judge.decided,
        passed: judge.passed, failed: judge.failed, undecided: judge.undecided,
      },
      participation: { ...participation, ...extras },
      peers: peerResults,
      rejected: peerResults
        .filter((r) => !r.usable)
        .map((r) => ({
          peer: r.peer.name,
          why: [
            r.signals.reproducibility.verdict === VERDICT.FAIL ? 'reproducibility_failed' : null,
            r.signals.discrimination.verdict === VERDICT.FAIL ? 'no_discrimination' : null,
            r.targetScore === null ? 'no_target_score' : null,
          ].filter(Boolean),
        })),
      drives: {
        note: '互评只用协议往返（PROTOCOL 档）：能判"回不回、自不自洽、有没有判别力"，'
          + '判不了工具编排与执行细节。要那部分请走①白盒或带 trajectory 的路径⑦。',
      },
    };
  }
}

function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * 网络异常 → UNDECIDED reason（只对**真的**网络错误下这种结论）
 *
 * 背景：这里曾把 `peerUrl.includes is not a function`（一个内部 TypeError）
 * 记成 unreachable —— 报告上看起来「对方连不上」，实际是本地传参写错了。
 * 错误归因是判定链的一部分：归错了，人就照错的方向排查。
 */
function classifyError(e) {
  const code = (e && (e.code || (e.cause && e.cause.code))) || '';
  const msg = String((e && e.message) || '');
  if (/timeout|ETIMEDOUT/i.test(msg) || code === 'ETIMEDOUT') return UNDECIDED_REASON.TIMEOUT;
  const netCodes = ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'];
  if (netCodes.includes(code) || netCodes.some((c) => msg.includes(c))) return UNDECIDED_REASON.UNREACHABLE;
  // 其余的（TypeError / ReferenceError / JSON 解析错…）都是**我们这边**的问题：
  // 不能说成对方不可达，也不该判对方 FAIL。
  return UNDECIDED_REASON.INSUFFICIENT_TELEMETRY;
}

module.exports = { MutualEngine, parseJudgeScore, classifyError, DEFAULT_PROBES, DEFAULT_CANARY, DEFAULTS };