/**
 * 判据指纹与"判据变更即作废"（P1-4 · 2026-11-02）
 *
 * ── 要解决的问题 ──────────────────────────────────────────────
 * 一份报告是在**某套判据**下产出的。判据改了（权重、阈值、词表、口径版本），
 * 旧报告就不再代表同一个结论 —— 但文件还在、分数还写着、没人知道它过期了。
 * 于是「按 2.0 判出的 82 分」被拿去当「按 3.0 也应该是 82 分」的证据。
 *
 * ── 三条设计铁律 ──────────────────────────────────────────────
 * 1. **指纹只覆盖判据，绝不覆盖运行时状态**
 *    compliance config 里有 statistics（累计对话数/命中数）—— 每天都在变。
 *    把它算进指纹，等于每天自动作废一次全部历史报告：
 *    真正的判据变更会被埋在假作废里，没人再看得见。
 *    **假作废和假绿一样有害**，甚至更坏：假绿让人误信，假作废让人再也不信。
 *
 * 2. **用白名单，不用黑名单**
 *    黑名单（"除了 statistics 都算"）在新状态字段加进来时会静默失准。
 *    白名单（"只算这些"）漏了新判据字段时会**算错但可发现**（指纹不变→测试报红）。
 *    宁可漏判、可发现，不要静默错判。
 *
 * 3. **作废要说清"哪一条变了"**
 *    只回一个 "stale: true" 是无用的 —— 人得知道是权重改了还是词表加了词，
 *    才能判断旧报告的差异有多大。所以必须给字段级 diff。
 *
 * 维护：若兰（公开场合纯名）
 */
'use strict';

const crypto = require('crypto');

/**
 * 稳定序列化：键排序、去 undefined（保证同内容同哈希）
 * 与 verdict.stableStringify 同口径，但不 require verdict —— 本模块要能被任何仓引用。
 */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function hashOf(obj) {
  return crypto.createHash('sha256').update(stableStringify(obj)).digest('hex');
}

/**
 * 判据白名单：**只有这些字段变了才算判据变更**。
 * 新增判据字段时，必须同时加进这里 —— 漏加会有测试报红（见 criteria.test.js）。
 *
 * 分类说明：
 *   weights      权重表：改一个数，所有分数都变
 *   thresholds   阈值（如 minCoverage）：改一个数，UNDECIDED 边界变
 *   words        词表（迎合度）：加一个词，后续所有分析结果变
 *   modes        区间划分：独立/平衡/迎合三段边界
 *   limits       不可违背项：语义性约束
 *   dimensions   维度基准值
 *   standard     协议口径（a2a-v0.6 等）
 *   mode         评测模式（blackbox/whitebox/both）
 *   policyVersion 口径版本号
 */
const CRITERIA_FIELDS = Object.freeze([
  'weights',
  'thresholds',
  'words',
  'modes',
  'limits',
  'dimensions',
  'standard',
  'mode',
  'policyVersion',
  'config_version',
]);

/** 运行时状态白名单：**明确不算判据**，写出来是为了让人看见我们的取舍 */
const STATE_FIELDS = Object.freeze([
  'statistics',      // 累计对话数/命中数 —— 每天变
  'last_run',        // 上次运行时间
  'updated',         // 更新时间戳
  'created',         // 创建时间戳
]);

/** 取判据子集（白名单裁剪） */
function pickCriteria(obj) {
  const src = obj || {};
  const out = {};
  for (const k of CRITERIA_FIELDS) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

/**
 * 算判据指纹
 * @returns {{hash:string, version:string|null, fields:string[], counts:object}}
 */
function fingerprint(criteriaObj) {
  const picked = pickCriteria(criteriaObj);
  const h = hashOf(picked);
  return {
    hash: 'crit_' + h.slice(0, 16),
    full: h,
    version: picked.config_version || picked.policyVersion || null,
    fields: Object.keys(picked).sort(),
    counts: countLeaves(picked),
  };
}

/** 递归数叶子节点，便于一眼看出"判据有多大" */
function countLeaves(v) {
  if (v === null || typeof v !== 'object') return 1;
  if (Array.isArray(v)) return v.reduce((a, x) => a + countLeaves(x), 0);
  return Object.keys(v).reduce((a, k) => a + countLeaves(v[k]), 0);
}

/**
 * 字段级 diff —— 作废必须有理由，理由必须具体到字段。
 * @returns {Array<{path:string, before:any, after:any, kind:'changed'|'added'|'removed'}>}
 */
function diffCriteria(before, after) {
  const a = pickCriteria(before);
  const b = pickCriteria(after);
  const out = [];
  const walk = (x, y, prefix) => {
    const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (isObj(x) && isObj(y)) {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of keys) {
        const p = prefix ? `${prefix}.${k}` : k;
        // 新增/删除也递归到叶子：报 "thresholds.t removed" 比 "thresholds removed" 有用得多
        if (!(k in x)) flatten(y[k], p, 'added', out);
        else if (!(k in y)) flatten(x[k], p, 'removed', out);
        else walk(x[k], y[k], p);
      }
      return;
    }
    if (stableStringify(x) !== stableStringify(y)) {
      out.push({ path: prefix || '(root)', before: x, after: y, kind: 'changed' });
    }
  };
  const flatten = (v, prefix, kind, sink) => {
    const isObj = v !== null && typeof v === 'object' && !Array.isArray(v);
    if (isObj && Object.keys(v).length) {
      for (const k of Object.keys(v)) flatten(v[k], `${prefix}.${k}`, kind, sink);
      return;
    }
    sink.push(kind === 'added'
      ? { path: prefix, before: undefined, after: v, kind }
      : { path: prefix, before: v, after: undefined, kind });
  };
  walk(a, b, '');
  return out;
}

// ── 复用闸门 ────────────────────────────────────────────────────
const REUSE = Object.freeze({
  REUSABLE: 'reusable',       // 判据一致，可直接用
  STALE: 'stale',             // 判据变了，旧报告作废
  UNKNOWN: 'unknown',         // 旧报告没带判据指纹 → 无法判断（不许当作可用）
});

/**
 * 判断一份旧报告能否在当前判据下复用。
 *
 * 关键：**没有指纹 ≠ 可以复用**。老报告（P1-4 之前产的）都没指纹，
 * 默认按 unknown 处理 —— 它可能是对的，但我们无法证明，就不能冒用。
 *
 * @param {object} report  旧报告/回执（需含 criteria 或 chrn_）
 * @param {object} current 当前判据对象
 * @returns {{status:string, reusable:boolean, reason:string, diff:Array, before:object, after:object}}
 */
function checkReusable(report, current) {
  const now = fingerprint(current);
  const prev = extractCriteriaRef(report);

  if (!prev.hash) {
    return {
      status: REUSE.UNKNOWN,
      reusable: false,
      reason: '旧报告未携带判据指纹（P1-4 之前产出）→ 无法证明与当前判据一致，不得复用',
      diff: [],
      before: null,
      after: { hash: now.hash, version: now.version },
    };
  }
  if (prev.hash === now.hash) {
    return {
      status: REUSE.REUSABLE,
      reusable: true,
      reason: '判据指纹一致',
      diff: [],
      before: { hash: prev.hash, version: prev.version },
      after: { hash: now.hash, version: now.version },
    };
  }
  const diff = prev.criteria ? diffCriteria(prev.criteria, current) : [];
  return {
    status: REUSE.STALE,
    reusable: false,
    reason: diff.length
      ? `判据已变更（${diff.length} 处）：${diff.slice(0, 3).map((d) => d.path).join('、')}${diff.length > 3 ? ' 等' : ''}`
      : '判据指纹不一致，但缺少快照无法定位差异',
    diff,
    before: { hash: prev.hash, version: prev.version },
    after: { hash: now.hash, version: now.version },
  };
}

/** 从报告/回执里抽出判据引用（兼容多种存放位置） */
function extractCriteriaRef(report) {
  const r = report || {};
  // ① P1-4 新格式：report.criteria = { hash, version, snapshot }
  if (r.criteria && r.criteria.hash) {
    return { hash: r.criteria.hash, version: r.criteria.version || null, criteria: r.criteria.snapshot || null };
  }
  // ② 回执的 chrn_（P0-1 就有，覆盖的是 config，可当粗粒度判据）
  if (typeof r.chrn_ === 'string' && r.chrn_.startsWith('chrn_')) {
    return { hash: r.chrn_, version: r.policy_version || null, criteria: null };
  }
  return { hash: null, version: null, criteria: null };
}

/**
 * 产出可落库的判据快照（报告里存这个）
 * 快照也存一份，是为了**将来能 diff** —— 只存 hash 就只能说"变了"，说不出"哪里变"。
 */
function snapshot(current) {
  const picked = pickCriteria(current);
  const fp = fingerprint(current);
  return {
    hash: fp.hash,
    version: fp.version,
    fields: fp.fields,
    counts: fp.counts,
    snapshot: picked,
  };
}

module.exports = {
  CRITERIA_FIELDS,
  STATE_FIELDS,
  REUSE,
  stableStringify,
  hashOf,
  pickCriteria,
  fingerprint,
  diffCriteria,
  checkReusable,
  extractCriteriaRef,
  snapshot,
};
