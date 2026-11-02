/**
 * CSB 判定内核 · 三态 + 回执 + 门
 * 版本：1.0.0 | 2026-11-02 | P0-1
 *
 * ───────────────────────────────────────────────
 * 设计约束（硬性的，不是建议）：
 *
 * 1. **可抽出的形状**：本目录只依赖 node 内置（crypto/fs）。
 *    禁止 require 任何 csb-aep 私有模块、禁止 ../ 相对上跳。
 *    → 将来要抽成独立包 csb-verdict，改一行 require 即可。
 *
 * 2. **纯对象进出**：所有对外函数只吃 JSON 可序列化的普通对象，只吐普通对象。
 *    禁止类实例、Date、Map、undefined 出现在返回值里。
 *    → 单测锁住：JSON.parse(JSON.stringify(x)) 前后行为一致。
 *
 * 3. **单一三态定义**：PASS | FAIL | UNDECIDED(+reason)。
 *    全仓新代码只允许用 verdict.*，不许再新增第四种写法。
 *
 * 4. **信号不得越级**（P0-6 通则，硬编码在此）：
 *    · 采集档位低 → 最高 UNDECIDED，不得出 FAIL
 *    · 缺钩子/缺遥测 → 最高 UNDECIDED，label = insufficient telemetry
 *    · 过程信号（repeat/drift/stall）→ 不改变结论，只加 process_flag
 *
 * ───────────────────────────────────────────────
 * 为什么要有这个内核（而不是各子系统各写一遍）：
 * 现存四种「判不了」的写法：pass:false / status:'N/A' / exit 2 / pending_baseline。
 * 报告里一个 null 到底什么意思，没人能一句话说清。
 */

'use strict';

const crypto = require('crypto');
const mandateLib = require('./mandate');   // 同目录兄弟模块（抽出成 csb-verdict 时一起走）

// ══════════════════════════════════════════════
// 一、三态定义（唯一）
// ══════════════════════════════════════════════

const VERDICT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNDECIDED: 'UNDECIDED',
});

/** UNDECIDED 的允许原因（封闭枚举 —— 不许自由发挥，否则又回到"各说各话"） */
const UNDECIDED_REASON = Object.freeze({
  UNREACHABLE: 'unreachable',           // 目标连不上
  RATE_LIMITED: 'rate_limited',         // 被限流
  EMPTY_RESPONSE: 'empty_response',     // 返回空
  TIMEOUT: 'timeout',                   // 超时
  INSUFFICIENT_TELEMETRY: 'insufficient_telemetry',  // 缺钩子/档位不够
  MISSING_FIELD: 'missing_field',       // 回执必填字段缺失
  NO_AUDIT_SOURCE: 'no_audit_source',   // 无审计源
  CHAIN_INVALID: 'chain_invalid',       // 链不可验
  PENDING_BASELINE: 'pending_baseline', // 基线未就绪
  NOT_APPLICABLE: 'not_applicable',     // 本就不适用
});

/** 采集档位（E7/E8）—— 低档位是"看不见"，不是"没做到" */
const TIER = Object.freeze({
  HOOK: 'hook',           // 有钩子，能看到工具调用
  PROTOCOL: 'protocol',   // 只能看协议往返
  PTY: 'pty',             // 只能抓屏
  NONE: 'none',           // 什么都没有
});

/** 档位 → 最高允许结论。低档位永远不得出 FAIL。 */
const TIER_CEILING = Object.freeze({
  [TIER.HOOK]: VERDICT.FAIL,        // 看得清，可以判错
  [TIER.PROTOCOL]: VERDICT.FAIL,    // 协议往返能判"没回应"
  [TIER.PTY]: VERDICT.UNDECIDED,    // 抓屏有歧义，不得判 FAIL
  [TIER.NONE]: VERDICT.UNDECIDED,
});

const VERDICT_RANK = { [VERDICT.FAIL]: 2, [VERDICT.UNDECIDED]: 1, [VERDICT.PASS]: 0 };

// ══════════════════════════════════════════════
// 二、三态构造器
// ══════════════════════════════════════════════

function pass(score, note) {
  return { verdict: VERDICT.PASS, score: typeof score === 'number' ? score : null, reason: null, note: note || null, process_flag: [] };
}

function fail(score, note) {
  return { verdict: VERDICT.FAIL, score: typeof score === 'number' ? score : null, reason: null, note: note || null, process_flag: [] };
}

function undecided(reason, note) {
  const r = UNDECIDED_REASON[reason] || reason;
  return { verdict: VERDICT.UNDECIDED, score: null, reason: r, note: note || null, process_flag: [] };
}

/**
 * 按采集档位收敛结论（P0-6「信号不得越级」）
 *
 * 规则：结论不得超过档位允许的上限。低档位下的 FAIL 一律降为 UNDECIDED，
 * 并把原因记下来——不能把「我们看不见」说成「它做错了」。
 */
function applyTierCeiling(v, tier, note) {
  const ceiling = TIER_CEILING[tier] || VERDICT.UNDECIDED;
  if (v.verdict === VERDICT.PASS) return { ...v };
  if (VERDICT_RANK[v.verdict] <= VERDICT_RANK[ceiling]) return { ...v };
  return {
    verdict: ceiling,
    score: null,
    reason: UNDECIDED_REASON.INSUFFICIENT_TELEMETRY,
    note: note || `采集档位 ${tier} 看不清，原判 ${v.verdict} 不足以支撑`,
    process_flag: (v.process_flag || []).concat(['tier_downgraded']),
  };
}

/**
 * 过程信号只加标记，不改结论（P0-6 第三条）
 * repeat / drift / stall 是「过程看起来可疑」，不是「结果错了」。
 */
function attachProcessFlags(v, signals = []) {
  if (!Array.isArray(signals) || signals.length === 0) return { ...v };
  const tags = signals.map((s) => (typeof s === 'string' ? s : s && s.type)).filter(Boolean);
  return { ...v, process_flag: Array.from(new Set((v.process_flag || []).concat(tags))) };
}

/**
 * 采集档位判定（P0-6 第一步：档位必须从**证据**来，不许调用方自报）
 *
 * 输入只认布尔证据 —— 因为「我这边能看很细」这种自述无法机械核对：
 *   hooks    : 适配器**实际提供**工具级钩子（有实现，不是有意图）
 *   protocol : 目标在协议层给出了可判定的一轮往返（不是"连上了"）
 *   screen   : 只有截屏/PTY 可读
 * 全不成立 → NONE。**宁可判低，不许判高**（判高会把"看不见"变成"做错了"）。
 *
 * @param {object} evidence { hooks, protocol, screen }
 * @returns {{tier: string, reason: string}}
 */
/**
 * 从**本次运行时的证据**算档位（P0-6），并可被采集器的能力上限封顶（P1-1）。
 *
 * 两件事必须分开：
 *   evidence  = 这一次真的看到了什么（hooks 有事件流？协议往返有结果？）
 *   ceiling   = 这个采集器**最高能**看到什么（适配器声明的能力上限）
 * 结果 = min(evidence 算出的档位, ceiling)。原因：适配器声明只能到 protocol，
 * 就不该因为某次偶然拿到一个 hook 形状的数据就自称 hook 档 —— 那会让判定链
 * 对一项它其实看不清的指标下 FAIL。
 *
 * @param {object} evidence { hooks, protocol, screen }
 * @param {object} [opts] { ceiling: 'hook'|'protocol'|'pty'|'none' }
 */
function resolveTier(evidence = {}, opts = {}) {
  const e = evidence || {};
  let got = { tier: TIER.NONE, reason: 'no_signal' };
  if (e.hooks === true) got = { tier: TIER.HOOK, reason: 'hooks_available' };
  else if (e.protocol === true) got = { tier: TIER.PROTOCOL, reason: 'protocol_roundtrip' };
  else if (e.screen === true) got = { tier: TIER.PTY, reason: 'screen_only' };

  // 能力上限封顶（P1-1）。未声明 ceiling 时行为与 P0-6 完全一致。
  const ceiling = opts.ceiling;
  if (!ceiling) return got;
  const order = [TIER.NONE, TIER.PTY, TIER.PROTOCOL, TIER.HOOK];
  const ci = order.indexOf(ceiling);
  const gi = order.indexOf(got.tier);
  if (ci < 0 || gi < 0) return got;
  if (gi <= ci) return { ...got, ceiling };
  return {
    tier: ceiling,
    reason: 'capped_by_collector',
    observed: got.tier,
    observedReason: got.reason,
    ceiling,
  };
}

/**
 * 按「这项指标需要什么档位才能看见」来收敛单条结论（P0-6 第二条）
 *
 * 典型：工具编排类指标需要工具级可见性（HOOK）。在 PROTOCOL 档下跑，
 * 不是「它没做到」，是「我们看不见」→ UNDECIDED / insufficient_telemetry。
 *
 * @param {object} v 三态结果
 * @param {object} opts { tier, requires }
 *   requires: 'hook' | 'protocol' | 'screen' | null（null = 任何档位都能判）
 */
function applyTelemetryRequirement(v, opts = {}) {
  const tier = opts.tier || TIER.NONE;
  const requires = opts.requires || null;
  if (!requires) return { ...v };
  const order = [TIER.NONE, TIER.PTY, TIER.PROTOCOL, TIER.HOOK];
  // requires 的数值越高越难满足：HOOK(3) > PROTOCOL(2) > PTY(1) > NONE(0)
  const need = order.indexOf(requires);
  const have = order.indexOf(tier);
  if (need < 0 || have < 0) return { ...v };
  if (have >= need) return { ...v };
  // 已经 PASS 的不降（看得见的部分做对了就是做对了）；要降的是 FAIL 和缺数据
  if (v.verdict === VERDICT.PASS) return { ...v };
  return {
    verdict: VERDICT.UNDECIDED,
    score: null,
    reason: UNDECIDED_REASON.INSUFFICIENT_TELEMETRY,
    note: `需要 ${requires} 档才能判，实际 ${tier} 档 → insufficient telemetry`,
    process_flag: (v.process_flag || []).concat(['tier_insufficient']),
  };
}

/**
 * 聚合多项三态 → 综合分 + 覆盖率（P0-2 的核心）
 *
 * **UNDECIDED 不进分母**（这是「没测到 ≠ 做错」的实现），
 * 但计入覆盖率；覆盖率低于阈值时整份报告标 insufficient。
 */
function aggregate(items, opts = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const minCoverage = typeof opts.minCoverage === 'number' ? opts.minCoverage : 0.6;

  const decided = list.filter((i) => i.verdict === VERDICT.PASS || i.verdict === VERDICT.FAIL);
  const undecidedItems = list.filter((i) => i.verdict === VERDICT.UNDECIDED);
  const passed = decided.filter((i) => i.verdict === VERDICT.PASS);
  const failed = decided.filter((i) => i.verdict === VERDICT.FAIL);

  const coverage = list.length === 0 ? 0 : decided.length / list.length;
  const score = decided.length === 0 ? null : round(passed.length / decided.length, 4);

  const reasonCounts = {};
  for (const u of undecidedItems) reasonCounts[u.reason || 'unknown'] = (reasonCounts[u.reason || 'unknown'] || 0) + 1;

  return {
    verdict: list.length === 0
      ? VERDICT.UNDECIDED
      : (decided.length === 0 ? VERDICT.UNDECIDED : (failed.length === 0 ? VERDICT.PASS : VERDICT.FAIL)),
    score,
    total: list.length,
    decided: decided.length,
    passed: passed.length,
    failed: failed.length,
    undecided: undecidedItems.length,
    undecidedReasons: reasonCounts,
    coverage: round(coverage, 4),
    // 覆盖率不够 → 整份报告不能被当成完整结论
    insufficient: coverage < minCoverage,
    minCoverage,
    processFlags: Array.from(new Set(list.flatMap((i) => i.process_flag || []))),
  };
}

function round(n, d) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

// ══════════════════════════════════════════════
// 三、回执（receipt）
// ══════════════════════════════════════════════

/** 必填字段（缺任一 → 回执无效，结论降为 UNDECIDED/missing_field） */
const RECEIPT_REQUIRED = Object.freeze([
  'receipt_id',
  'policy_version',
  'chrn_',
  'collector_id',
  'collector_version',
  'telemetry_tier',
  'issued_at',
  'verdict',
]);

/** 条件必有：只在对应条件成立时才要求 */
const RECEIPT_CONDITIONAL = Object.freeze({
  dataset_digest: (ctx) => !!ctx.hasDataset,
  sealed_anchor: (ctx) => !!ctx.hasAuditChain,
  stage_trace: (ctx) => !!ctx.multiStage,
  retry_policy: (ctx) => !!ctx.hasRetry,
  is_finite: (ctx) => !!ctx.hasBudget,
});

/**
 * 构建回执（纯加法，不改评分逻辑）
 *
 * @param {object} input 普通对象：
 *   verdict, score, evidence, policy, collector, dataset, anchors, stages, retry, budget, ctx,
 *   mandate（可选：{scope, strength, policy_version, subject, delegable, expires_at}）
 * @param {object} opts { secret } —— 给了 secret 才签名；不给则 unsigned:true（诚实标出）
 */
function buildReceipt(input = {}, opts = {}) {
  const ctx = input.ctx || {};
  const now = input.issued_at || new Date().toISOString();

  const r = {
    receipt_id: input.receipt_id || `rcpt_${crypto.randomBytes(12).toString('hex')}`,
    issued_at: now,
    policy_version: input.policy?.version || null,
    chrn_: input.chrn_ || configFingerprint(input.config || {}),
    collector_id: input.collector?.id || null,
    collector_version: input.collector?.version || null,
    telemetry_tier: input.telemetry_tier || ctx.telemetry_tier || TIER.NONE,
    verdict: input.verdict || null,
    score: typeof input.score === 'number' ? input.score : null,
    evidence_digests: input.evidence || {},
  };

  // P1-5：委托边界。**每次回执都必须带 mandate** ——
  //   没被告知用途时补一份保守默认（eval:read / advisory / derived:true），
  //   而不是留空：留空必然有人写 `mandate || {}`，那才是真·无限授权。
  const mandate = input.mandate
    ? mandateLib.normalize({ policy_version: r.policy_version, ...input.mandate })
    : mandateLib.conservativeDefault(r.policy_version, input.subject, r.issued_at);
  r.mandate = mandate;
  r.mandate_digest = mandateLib.digestOf(mandate);
  r.mandate_derived = mandate.derived === true;
  const mv = mandateLib.validate(mandate);
  r.mandate_valid = mv.valid;
  if (!mv.valid) r.mandate_problems = mv.problems;

  // 条件必有
  if (input.dataset !== undefined) r.dataset_digest = input.dataset ? digestOf(input.dataset) : null;
  if (input.anchors !== undefined) r.sealed_anchor = input.anchors || null;
  if (input.stages !== undefined) r.stage_trace = Array.isArray(input.stages) ? input.stages : null;
  if (input.retry !== undefined) r.retry_policy = input.retry || null;
  if (input.budget !== undefined) r.is_finite = !!input.budget.finite;

  // 校验：缺必填 → 结论降级（不是抛错 —— 判定系统不该因为缺字段就崩）
  const missing = RECEIPT_REQUIRED.filter((k) => r[k] === null || r[k] === undefined || r[k] === '');
  r.complete = missing.length === 0;
  r.missing_fields = missing;
  if (!r.complete && r.verdict !== VERDICT.UNDECIDED) {
    r.verdict_original = r.verdict;
    r.verdict = VERDICT.UNDECIDED;
    r.reason = UNDECIDED_REASON.MISSING_FIELD;
  }

  // 签名：只对 {verdict, evidence_digests, policy_version} 签（复用 present.js 的 HMAC 思路）
  if (opts.secret) {
    r.signature = signReceipt(opts.secret, r);
    r.unsigned = false;
  } else {
    r.unsigned = true;   // 诚实：没有密钥就说没有，不假装已验真
  }
  return r;
}

function signPayload(r) {
  // mandate_digest 进签名：否则 mandate 可以在签名之外被整个换掉（换 scope 不破签）
  // 旧回执（无 mandate_digest）时该键为 undefined，JSON.stringify 会整键丢弃，
  // 签名串与 P0-1 逐字一致 —— 向后兼容，历史回执仍验得过。
  return JSON.stringify({
    verdict: r.verdict,
    evidence_digests: r.evidence_digests || {},
    policy_version: r.policy_version || null,
    ...(r.mandate_digest ? { mandate_digest: r.mandate_digest } : {}),
  });
}

function signReceipt(secret, receipt) {
  return crypto.createHmac('sha256', secret).update(signPayload(receipt)).digest('hex');
}

/**
 * 独立验真（第三方拿到回执即可验，不需要信我们）
 * @returns {{ok:boolean, reason?:string}}
 */
function verifyReceipt(receipt, secret) {
  if (!receipt || typeof receipt !== 'object') return { ok: false, reason: 'not_an_object' };
  const missing = RECEIPT_REQUIRED.filter((k) => receipt[k] === null || receipt[k] === undefined || receipt[k] === '');
  if (missing.length) return { ok: false, reason: 'missing_fields', missing };
  if (receipt.unsigned) return { ok: false, reason: 'unsigned' };
  if (!secret) return { ok: false, reason: 'no_secret_provided' };
  // 有 mandate 就必须与摘要对得上（防「签名不动、mandate 换掉」）
  if (receipt.mandate || receipt.mandate_digest) {
    if (!receipt.mandate) return { ok: false, reason: 'missing_mandate' };
    const expectDigest = mandateLib.digestOf(receipt.mandate);
    if (expectDigest !== receipt.mandate_digest) return { ok: false, reason: 'mandate_tampered' };
    if (!mandateLib.validate(receipt.mandate).valid) return { ok: false, reason: 'invalid_mandate' };
  }
  const expect = signReceipt(secret, receipt);
  if (expect !== receipt.signature) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}

/** 配置指纹：把参与判定的配置规范化后哈希（不含时间戳等易变值） */
function configFingerprint(config) {
  const canon = stableStringify(config || {});
  return 'chrn_' + crypto.createHash('sha256').update(canon).digest('hex').slice(0, 16);
}

/** 题集/证据摘要 */
function digestOf(obj) {
  let canon;
  if (typeof obj === 'string') canon = obj;
  else canon = stableStringify(obj);
  return 'sha256:' + crypto.createHash('sha256').update(canon).digest('hex');
}

/** 键排序的稳定序列化（保证同内容同哈希） */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// ══════════════════════════════════════════════
// 四、门（gate）：三态 → exit code
// ══════════════════════════════════════════════

const GATE_EXIT = Object.freeze({
  [VERDICT.PASS]: 0,
  [VERDICT.FAIL]: 1,
  [VERDICT.UNDECIDED]: 2,
});

/**
 * 三态 → exit code（取代各子系统自己定的 exit(ok?0:2)）
 * UNDECIDED 必须是 2，不是 1 —— 「判不了」和「做错了」在退出码层就要分开。
 */
function toExitCode(verdict) {
  return GATE_EXIT[verdict] !== undefined ? GATE_EXIT[verdict] : 2;
}

/** 门：给结论 + 理由，能拒绝才叫门 */
function gate(v, opts = {}) {
  const code = toExitCode(v.verdict);
  const reasons = [];
  if (v.verdict === VERDICT.FAIL) reasons.push(v.note || '判定为失败');
  if (v.verdict === VERDICT.UNDECIDED) reasons.push(`判不了：${v.reason || 'unknown'}`);
  const blocked = code !== 0;
  return {
    exitCode: code,
    blocked,
    verdict: v.verdict,
    reason: reasons.join('; ') || null,
    status: blocked ? 'blocked' : 'ready',
    ...(opts.insufficient ? { insufficient: true } : {}),
  };
}

module.exports = {
  VERDICT,
  UNDECIDED_REASON,
  TIER,
  TIER_CEILING,
  RECEIPT_REQUIRED,
  RECEIPT_CONDITIONAL,
  GATE_EXIT,
  // 三态
  pass,
  fail,
  undecided,
  applyTierCeiling,
  attachProcessFlags,
  resolveTier,
  applyTelemetryRequirement,
  aggregate,
  // 回执
  buildReceipt,
  verifyReceipt,
  signReceipt,
  // 委托边界（P1-5）
  mandate: mandateLib,
  createMandate: mandateLib.create,
  delegateMandate: mandateLib.delegate,
  checkMandateReuse: mandateLib.checkReuse,
  mandateDigest: mandateLib.digestOf,
  configFingerprint,
  digestOf,
  stableStringify,
  // 门
  gate,
  toExitCode,
  // 元
  VERSION: '1.1.0',
  SHAPE: 'pure-object / no-aep-private-require',
};
