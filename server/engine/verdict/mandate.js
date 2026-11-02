/**
 * 判定委托不可扩（P1-5 · 2026-11-02）
 *
 * ── 要解决的问题 ──────────────────────────────────────────────
 * 判定常常要委托出去：AEP 把「迎合度判据」委托给 csb-memory、把「最高层判定」
 * 委托给他者注视、把一次评测的结论交给下游当门禁用。委托本身是对的 ——
 * 单点自判会自证。
 *
 * 坏掉的是**委托的边界**：拿到一份回执的人，可以把 `delegator` 换成自己再转出去，
 * 于是「若兰让你判这一项」变成「若兰让你判所有项」；一份 advisory 的回执
 * 被贴到门禁上；一份 2.0 口径的结论被当成 3.0 的结论。**每一次都合法，每一次都在扩权。**
 *
 * ── 三条设计铁律 ──────────────────────────────────────────────
 * 1. **委托只能收窄，不能平移**
 *    子委托的 scope 必须是父 scope 的子集，strength 不得高于父级。
 *    等价于「你只能把借到的东西转借一部分，不能整个转借」。
 *    判据是机械可核的 token 前缀包含，不做语义猜测（"看起来像同一个用途"不算）。
 *
 * 2. **默认不可再委托（两道闸）**
 *    ① 子委托默认 `delegable=false` —— 到这就停；要再转必须**原授权方显式**放行。
 *    ② `depth` 封顶（默认 max_depth=1，即只允许一次转委）—— 委托链可数，不是无限外扩。
 *    「没说可以」= 「不可以」。不给默认值。
 *
 * 3. **越界一律新开，不提供 extend()**
 *    本模块**故意不导出任何扩展函数**。越界只有一个出口：重新判一次，产新回执。
 *    没有 `extendMandate()` 这种东西可调用，就没有「顺手补一句」的路径可走。
 *
 * ── 诚实边界 ──────────────────────────────────────────────────
 * · `policy_version` 只做**字面相等**校验。它不判断新旧、不判断宽松，
 *   因为「哪个版本更可信」不是本模块能回答的。
 * · scope token 是**命名约定**，不是能力隔离。谁都能新起一个 token；
 *   本模块保证的是「不能把已发的 token 扩出去」，不是「token 名不可伪造」。
 * · 本模块不做撤销广播。`revoked` 字段只在本地生效。
 *
 * 维护：若兰（公开场合纯名）
 */
'use strict';

const crypto = require('crypto');

// ══════════════════════════════════════════════
// 一、枚举（封闭，不许自由发挥）
// ══════════════════════════════════════════════

/** 判定强度：越往后越强。只能往下委，不能往上委。 */
const STRENGTH = Object.freeze({
  ADVISORY: 'advisory',   // 仅供参考，不构成门禁
  GATING: 'gating',       // 可作为门禁（能拦）
  ATTESTED: 'attested',   // 可作为对外凭证（第三方可引用/公示）
});

const STRENGTH_RANK = Object.freeze({
  [STRENGTH.ADVISORY]: 0,
  [STRENGTH.GATING]: 1,
  [STRENGTH.ATTESTED]: 2,
});

/** 拒绝原因（封闭枚举 —— 拒绝必须能计数，不能静默丢弃） */
const REFUSE = Object.freeze({
  MISSING_MANDATE: 'missing_mandate',       // 无委托凭据
  INVALID_MANDATE: 'invalid_mandate',       // 结构不合法
  OUT_OF_SCOPE: 'out_of_scope',             // 用途越界 → 新开
  STRENGTH_EXCEEDED: 'strength_exceeded',   // 强度越级 → 新开
  POLICY_MISMATCH: 'policy_mismatch',       // 口径版本不同 → 新开
  NOT_DELEGABLE: 'not_delegable',           // 该委托不可再转
  DEPTH_EXCEEDED: 'depth_exceeded',         // 委托链深度超限
  EXPIRED: 'expired',
  REVOKED: 'revoked',
});

/** 委托深度上限。depth = 距根委托的代数；默认 1 = 允许一次转委（子委托 depth=1）。
 *  第二道闸：子委托默认 delegable=false，链到这就停。两道一起才叫「默认不可再委托」。 */
const DEFAULT_MAX_DEPTH = 1;

// ══════════════════════════════════════════════
// 二、工具：稳定序列化 + 摘要
// ══════════════════════════════════════════════

/** 键排序稳定序列化（与 verdict.stableStringify / criteria.stableStringify 同口径） */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

/**
 * 委托摘要：把「这份委托允许什么」压成一个哈希。
 * 回执签名里绑这个值 —— 否则 mandate 可以在签名之外被换掉。
 */
function digestOf(mandate) {
  const m = normalize(mandate);
  const canon = stableStringify({
    mandate_id: m.mandate_id,
    scope: m.scope.slice().sort(),
    strength: m.strength,
    policy_version: m.policy_version,
    subject: m.subject,
    delegable: m.delegable,
    depth: m.depth,
    expires_at: m.expires_at,
    parent_mandate_id: m.parent_mandate_id,
  });
  return 'mand_' + crypto.createHash('sha256').update(canon).digest('hex');
}

// ══════════════════════════════════════════════
// 三、规整与校验
// ══════════════════════════════════════════════

function normTokens(list) {
  if (list === undefined || list === null) return [];
  const arr = Array.isArray(list) ? list : [list];
  const out = [];
  for (const t of arr) {
    const s = String(t || '').trim();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * 规整成纯对象（不抛错 —— 判定系统不该因为字段怪就崩）
 * 缺失的字段留 null / 空数组，由 validate() 负责说"哪里不行"。
 */
function normalize(mandate) {
  const m = (mandate && typeof mandate === 'object') ? mandate : {};
  const strength = String(m.strength || '').trim().toLowerCase() || null;
  return {
    mandate_id: m.mandate_id == null ? null : String(m.mandate_id),
    scope: normTokens(m.scope),
    strength: strength && STRENGTH_RANK[strength] !== undefined ? strength : null,
    policy_version: m.policy_version == null ? null : String(m.policy_version),
    subject: m.subject == null ? null : String(m.subject),      // 判定对象
    delegator: m.delegator == null ? null : String(m.delegator),
    delegatee: m.delegatee == null ? null : String(m.delegatee),
    depth: Number.isInteger(m.depth) ? m.depth : 0,
    delegable: m.delegable === true,
    parent_mandate_id: m.parent_mandate_id == null ? null : String(m.parent_mandate_id),
    issued_at: m.issued_at == null ? null : String(m.issued_at),
    expires_at: m.expires_at == null ? null : String(m.expires_at),
    revoked: m.revoked === true,
    derived: m.derived === true,     // true = 由系统按保守默认值补的，不是授权方明确给的
  };
}

/**
 * 结构校验。**不校验"合理性"，只校验"能不能被机械核对"**。
 * @returns {{valid:boolean, problems:Array<{field:string, problem:string}>}}
 */
function validate(mandate) {
  const m = normalize(mandate);
  const problems = [];
  if (!m.scope.length) problems.push({ field: 'scope', problem: '缺少用途范围（空 scope 等于什么都没授权）' });
  if (!m.strength) problems.push({ field: 'strength', problem: `强度必须是 ${Object.keys(STRENGTH_RANK).join('/')} 之一` });
  if (!m.policy_version) problems.push({ field: 'policy_version', problem: '缺少口径版本' });
  if (!Number.isInteger(m.depth) || m.depth < 0) problems.push({ field: 'depth', problem: 'depth 必须是非负整数' });
  if (m.expires_at && Number.isNaN(Date.parse(m.expires_at))) problems.push({ field: 'expires_at', problem: 'expires_at 不是合法时间' });
  return { valid: problems.length === 0, problems };
}

// ══════════════════════════════════════════════
// 四、范围包含（机械可核，不做语义猜测）
// ══════════════════════════════════════════════

/**
 * token 覆盖：父 token 覆盖子 token 当且仅当
 *   parent === child            （相等）
 *   或 child.startsWith(parent + ':')   （父是子的路径前缀）
 *
 * 例：`eval` 覆盖 `eval:harness`、`eval:harness:gate`；
 *     但 `eval:harness` **不覆盖** `eval:whitebox`（同级不互cover）。
 *     也不做 `eval*` 通配 —— 通配符会让"越界"变成"看谁写得像"。
 */
function tokenCovers(parent, child) {
  const p = String(parent || '').trim();
  const c = String(child || '').trim();
  if (!p || !c) return false;
  return c === p || c.startsWith(p + ':');
}

/**
 * 父 scope 是否覆盖子 scope（子集的机械判定）
 * @returns {{ok:boolean, missing:string[]}} missing = 未被覆盖的子 token
 */
function scopeCovers(parentScope, childScope) {
  const parents = normTokens(parentScope);
  const children = normTokens(childScope);
  if (!children.length) return { ok: false, missing: [] };
  const missing = children.filter((c) => !parents.some((p) => tokenCovers(p, c)));
  return { ok: missing.length === 0, missing };
}

// ══════════════════════════════════════════════
// 五、签发
// ══════════════════════════════════════════════

/**
 * 新建一份根委托（授权方自己开的口子）。
 *
 * @param {object} input { scope, strength, policy_version, subject, delegator, delegatee,
 *                         expires_at, delegable }
 */
function create(input = {}) {
  const m = normalize({
    ...input,
    mandate_id: input.mandate_id || `mand_${crypto.randomBytes(8).toString('hex')}`,
    depth: 0,
    delegable: input.delegable === true,
    issued_at: input.issued_at || new Date().toISOString(),
  });
  const v = validate(m);
  if (!v.valid) {
    return { ok: false, refusal: refuse(REFUSE.INVALID_MANDATE, '委托结构不合法', { problems: v.problems }) };
  }
  return { ok: true, mandate: m };
}

/**
 * 把一份委托转给下一位。
 *
 * 四条同时成立才允许：①父级 delegable 且 depth 未超限 ②scope 收窄（子集）
 * ③strength 不越级 ④policy_version 字面相等。
 *
 * 注意：**返回新的 mandate，不改父级**。父级账本只能由签发方写。
 *
 * @param {object} parent  父委托
 * @param {object} request 子委托诉求 { scope, strength, policy_version?, subject?, delegatee?, max_depth? }
 */
function delegate(parent, request = {}) {
  const p = normalize(parent);
  const pv = validate(p);
  if (!pv.valid) {
    return { ok: false, refusal: refuse(REFUSE.INVALID_MANDATE, '父委托结构不合法', { problems: pv.problems }) };
  }
  if (p.revoked) return { ok: false, refusal: refuse(REFUSE.REVOKED, '父委托已撤销') };
  if (isExpired(p)) return { ok: false, refusal: refuse(REFUSE.EXPIRED, `父委托已于 ${p.expires_at} 到期`) };
  if (!p.delegable) {
    return { ok: false, refusal: refuse(REFUSE.NOT_DELEGABLE, '该委托未授权再委托（delegable=false）—— 需要判定请新开一次') };
  }

  const maxDepth = Number.isInteger(request.max_depth) ? request.max_depth : DEFAULT_MAX_DEPTH;
  if (p.depth + 1 > maxDepth) {
    return { ok: false, refusal: refuse(REFUSE.DEPTH_EXCEEDED, `委托链深度已达上限 ${maxDepth}（父 depth=${p.depth}）`) };
  }

  const childScope = normTokens(request.scope);
  const cov = scopeCovers(p.scope, childScope);
  if (!cov.ok) {
    return { ok: false, refusal: refuse(REFUSE.OUT_OF_SCOPE, '子委托范围超出父委托（委托只能收窄）', { missing: cov.missing, parent_scope: p.scope }) };
  }

  const childStrength = String(request.strength || '').trim().toLowerCase() || null;
  if (!childStrength || STRENGTH_RANK[childStrength] === undefined) {
    return { ok: false, refusal: refuse(REFUSE.INVALID_MANDATE, '子委托缺少合法 strength') };
  }
  if (STRENGTH_RANK[childStrength] > STRENGTH_RANK[p.strength]) {
    return { ok: false, refusal: refuse(REFUSE.STRENGTH_EXCEEDED, `子委托强度 ${childStrength} 高于父级 ${p.strength}（只能降，不能升）`, { parent_strength: p.strength }) };
  }

  const childPolicy = request.policy_version == null ? p.policy_version : String(request.policy_version);
  if (childPolicy !== p.policy_version) {
    return {
      ok: false,
      refusal: refuse(REFUSE.POLICY_MISMATCH, `口径版本不同（父 ${p.policy_version} / 子 ${childPolicy}）—— 换口径必须新开判定`, { parent_policy_version: p.policy_version }),
    };
  }

  const child = normalize({
    mandate_id: `mand_${crypto.randomBytes(8).toString('hex')}`,
    scope: childScope,
    strength: childStrength,
    policy_version: p.policy_version,
    subject: request.subject == null ? p.subject : request.subject,
    delegator: request.delegator || p.delegatee || p.delegator,
    delegatee: request.delegatee == null ? null : request.delegatee,
    depth: p.depth + 1,
    // 默认不再往下传：除非父级和这次请求同时说可以
    delegable: request.delegable === true && p.delegable === true,
    issued_at: new Date().toISOString(),
    expires_at: request.expires_at || p.expires_at,
    parent_mandate_id: p.mandate_id,
  });
  const cv = validate(child);
  if (!cv.valid) return { ok: false, refusal: refuse(REFUSE.INVALID_MANDATE, '子委托结构不合法', { problems: cv.problems }) };
  return { ok: true, mandate: child };
}

// ══════════════════════════════════════════════
// 六、复用闸门（越界一律新开）
// ══════════════════════════════════════════════

/**
 * 判断「这份回执/委托能不能拿来做这件事」。
 *
 * 任一不满足 → reusable=false，且给出**具体缺什么**。
 * 调用方的正确反应是**新开一次判定**，不是「把 mandate 改大一点」——
 * 本模块不提供改大一点的函数。
 *
 * @param {object} mandate 回执里的 mandate
 * @param {object} request { scope, strength, policy_version, at? }
 */
function checkReuse(mandate, request = {}) {
  const m = normalize(mandate);
  const v = validate(m);
  if (!v.valid) {
    return notReusable(REFUSE.INVALID_MANDATE, '委托凭据不合法或缺失', { problems: v.problems });
  }
  if (m.revoked) return notReusable(REFUSE.REVOKED, '委托已撤销');
  if (isExpired(m, request.at)) return notReusable(REFUSE.EXPIRED, `委托已于 ${m.expires_at} 到期`);

  const asked = normTokens(request.scope);
  if (!asked.length) return notReusable(REFUSE.OUT_OF_SCOPE, '未声明用途 —— 不声明不等于全都能用');

  const cov = scopeCovers(m.scope, asked);
  if (!cov.ok) {
    return notReusable(REFUSE.OUT_OF_SCOPE, `用途越界（缺 ${cov.missing.join('、')}）—— 越界一律新开，不在原委托上追加`, {
      missing: cov.missing,
      mandate_scope: m.scope,
      requested_scope: asked,
    });
  }

  const want = String(request.strength || STRENGTH.ADVISORY).trim().toLowerCase();
  if (STRENGTH_RANK[want] === undefined) {
    return notReusable(REFUSE.INVALID_MANDATE, `未知的 strength: ${request.strength}`);
  }
  if (STRENGTH_RANK[want] > STRENGTH_RANK[m.strength]) {
    return notReusable(REFUSE.STRENGTH_EXCEEDED, `强度不足：委托为 ${m.strength}，此处要求 ${want} —— 请新开判定`, {
      mandate_strength: m.strength,
      requested_strength: want,
    });
  }

  const wantPolicy = request.policy_version == null ? m.policy_version : String(request.policy_version);
  if (wantPolicy !== m.policy_version) {
    return notReusable(REFUSE.POLICY_MISMATCH, `口径版本不同（委托 ${m.policy_version} / 此处 ${wantPolicy}）—— 换口径必须新开判定`, {
      mandate_policy_version: m.policy_version,
      requested_policy_version: wantPolicy,
    });
  }

  return {
    reusable: true,
    code: null,
    reason: '委托范围、强度、口径均满足',
    depth: m.depth,
    mandate_id: m.mandate_id,
    digest: digestOf(m),
  };
}

function notReusable(code, reason, extra = {}) {
  return { reusable: false, code, reason, ...extra };
}

function refuse(code, reason, extra = {}) {
  return { code, reason, ...extra };
}

function isExpired(m, at) {
  if (!m.expires_at) return false;
  const now = at ? Date.parse(at) : Date.now();
  return Date.parse(m.expires_at) < now;
}

/**
 * 保守默认委托：系统没被告知用途时补的，**不是授权方给的**。
 * 权限只有 read + advisory，且标记 derived=true 让消费方能看出这是补的。
 * 为什么给默认：不给就必然有人写 `mandate || {}`，那才是真·无限授权。
 */
function conservativeDefault(policyVersion, subject, issuedAt) {
  const at = issuedAt || new Date().toISOString();
  const pv = policyVersion || null;
  const sub = subject == null ? null : String(subject);
  // 内容寻址：同一 (口径, 对象, 时刻) → 同一 mandate_id。
  // 不用随机数，是因为回执要能「同输入同输出」（纯对象铁律 + 可重放复核）。
  const id = 'mand_def_' + crypto.createHash('sha256')
    .update(stableStringify({ pv, sub, at }))
    .digest('hex').slice(0, 16);
  return normalize({
    mandate_id: id,
    scope: ['eval:read'],
    strength: STRENGTH.ADVISORY,
    policy_version: pv,
    subject: sub,
    depth: 0,
    delegable: false,
    issued_at: at,
    derived: true,
  });
}

module.exports = {
  STRENGTH,
  STRENGTH_RANK,
  REFUSE,
  DEFAULT_MAX_DEPTH,
  normalize,
  validate,
  tokenCovers,
  scopeCovers,
  create,
  delegate,
  checkReuse,
  digestOf,
  conservativeDefault,
  stableStringify,
  VERSION: '1.0.0',
};
