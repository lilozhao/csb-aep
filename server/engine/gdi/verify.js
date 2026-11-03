/**
 * GDI 维度 2：独立验证通过率 · CSB-AEP v2.3（M2）
 *
 * 依据：csb-aep/docs/relationship-gdi-draft.md §2.2 维度2（定稿 v1.0）
 * 数据源：data/gdi/sources/audit/*.jsonl —— csb-security AuditLog 落盘格式（JSONL，每条含
 *   seq/timestamp/event_type/caller_id/callee_id/result/prev_hash/hash[/signature]）
 * 算法：哈希链校验与 csb-security lib/audit/audit-log.js verifyChain 同构
 *   （prev_hash 连续性 + SHA256 内容重算；publicKey 未配置时不验签——与上游一致）
 *
 * 口径（v0.1 M2 实现）：
 *   - 全链有效才计算；链断/篡改 → rate null + reason 'chain_invalid'（宁缺毋假）
 *   - 通过率 = 该 agent 作为被校验方（callee）的交互中 result==='success' 占比
 *     （无 callee 记录时退化为 agent 参与的全部记录口径，reason 注明）
 *   - 无审计源 → rate null + reason 'no_audit_source'（诚实 N/A，不硬凑分）
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GENESIS_HASH = 'GENESIS';

/** 复刻 csb-security _canonicalContent：去掉 hash/signature 后按字段序 stringify */
function canonicalContent(record) {
  const { hash, signature, ...rest } = record;
  return JSON.stringify(rest);
}

/** 哈希链完整性校验（与 csb-security AuditLog.verifyChain 同算法） */
function verifyChain(entries) {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.prev_hash !== prevHash) return { valid: false, brokenAt: i, reason: 'hash_chain_broken' };
    const computed = crypto.createHash('sha256').update(canonicalContent(e)).digest('hex');
    if (computed !== e.hash) return { valid: false, brokenAt: i, reason: 'entry_tampered' };
    prevHash = e.hash;
  }
  return { valid: true, count: entries.length };
}

/**
 * 分段校验（[2026-11-04] 一澜定 1+2 方案）
 *
 * 为什么不能只做「整份有效/无效」二选一：
 *   2026-11-02 之前，A2A 审计走裸 append，seq 取的是进程内存里的数组长度。
 *   并发写入时多个写入者算出同样的 seq、接同样的 prev_hash → 磁盘上出现分叉。
 *   生产账本实测 695 行里 15 个 seq 重复、4 处序号倒退。
 *   整份判死会把**分叉之前那段真实有效的证据**一起丢掉，这是拿诚实的名义做浪费。
 *
 * 做法：从 GENESIS 起逐条验，遇到第一处断点就切段：
 *   · 断点之前的段：chainValid=true，可用于计分
 *   · 断点及之后：verifiable=false，**不计入分母、也不判 0**
 *   并明确报告断点位置与原因，而不是谎报「链无效」了事。
 *
 * 注意：段内仍需逐条验内容哈希（entry_tampered），不然「分段」会变成新的暗门。
 *
 * @returns {{segments, validEntries, totalEntries, fullyValid, firstBreak}}
 */
function verifyChainSegments(entries) {
  const segments = [];
  let start = 0;
  let prevHash = GENESIS_HASH;
  let i = 0;

  while (i < entries.length) {
    const e = entries[i];
    if (e.prev_hash !== prevHash) {
      // 断在这里：收掉前一段
      segments.push({ start, end: i, count: i - start, valid: i > start, reason: 'hash_chain_broken' });
      return {
        segments,
        validEntries: segments.filter(s => s.valid).reduce((a, s) => a + s.count, 0),
        totalEntries: entries.length,
        // 有断点就不是 fullyValid —— 不能因为「唯一那段是有效的」就说整份完整
        fullyValid: false,
        firstBreak: { index: i, seq: e.seq, expectedPrev: prevHash, actualPrev: e.prev_hash, reason: 'hash_chain_broken' },
      };
    }
    const computed = crypto.createHash('sha256').update(canonicalContent(e)).digest('hex');
    if (computed !== e.hash) {
      segments.push({ start, end: i, count: i - start, valid: i > start, reason: 'entry_tampered' });
      return {
        segments,
        validEntries: segments.filter(s => s.valid).reduce((a, s) => a + s.count, 0),
        totalEntries: entries.length,
        fullyValid: false,
        firstBreak: { index: i, seq: e.seq, reason: 'entry_tampered' },
      };
    }
    prevHash = e.hash;
    i++;
  }

  segments.push({ start, end: entries.length, count: entries.length - start, valid: true, reason: 'ok' });
  return {
    segments,
    validEntries: entries.length,
    totalEntries: entries.length,
    fullyValid: true,
    firstBreak: null,
  };
}

/** 读取审计源目录（*.jsonl），返回 { files: [{name, entries, chain}], error? }
 *
 * [2026-11-04] 只扫**顶层** *.jsonl，不进 archive/ 子目录：
 *   归档件（已知分叉的旧账本）是追溯用的，不参与计分。
 *   不分这一层，分段校验会把归档件也当证据用——那就变成拿旧账凑分了。
 */
function loadAuditSources(dir) {
  const out = { files: [], total: 0 };
  if (!fs.existsSync(dir)) return out;
  const names = fs.readdirSync(dir).filter(x => x.endsWith('.jsonl')).sort();
  for (const f of names) {
    const full = path.join(dir, f);
    try {
      if (fs.statSync(full).isDirectory()) continue;   // 防御：同名目录
      const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
      const entries = lines.map(l => JSON.parse(l));
      out.files.push({ name: f, entries });
      out.total += entries.length;
    } catch (e) {
      console.warn(`[GDI verify] 审计源解析失败 ${f}: ${e.message}`);
    }
  }
  return out;
}

/**
 * 计算某 agent 的独立验证通过率
 * @param {string} auditDir 审计源目录
 * @param {string} agentId  agent 标识（与审计记录 caller_id/callee_id 匹配）
 * @returns {object} { rate, reason?, chainValid, total, passed, calleeView }
 */
function verifyRate(auditDir, agentId) {
  const src = loadAuditSources(auditDir);
  if (src.total === 0) return { rate: null, reason: 'no_audit_source', chainValid: null, total: 0, passed: 0 };

  // [2026-11-04 一澜定 1+2] 改为分段校验：
  //   整份判死会把并发分叉之前那段真实有效的证据一起丢掉；
  //   但也不能装作没事——失序段必须显式报出，并入 reason。
  const brokenReasons = [];
  let fullyValid = true;
  let validTotal = 0;
  const totalEntries = src.files.reduce((a, f) => a + f.entries.length, 0);
  let firstBreak = null;

  for (const f of src.files) {
    const seg = verifyChainSegments(f.entries);
    validTotal += seg.validEntries;
    if (!seg.fullyValid) {
      fullyValid = false;
      brokenReasons.push(`${f.name}:${seg.firstBreak ? seg.firstBreak.reason : 'broken'}@${seg.firstBreak ? seg.firstBreak.index : '?'}`);
      if (!firstBreak) firstBreak = { file: f.name, ...seg.firstBreak, segments: seg.segments };
    }
  }

  // 只取**有效段**内的记录作为可验证证据（断点之后的记录不进入分母）
  const validRecords = [];
  for (const f of src.files) {
    const seg = verifyChainSegments(f.entries);
    for (const s of seg.segments) {
      if (s.valid && s.count > 0) validRecords.push(...f.entries.slice(s.start, s.end));
    }
  }

  // 被校验方视角：agent 作为 callee
  let records = validRecords.filter(e => e.callee_id === agentId);
  let calleeView = true;
  if (records.length === 0) {
    // 退化：agent 参与的全部记录（caller 或 callee）
    records = validRecords.filter(e => e.caller_id === agentId || e.callee_id === agentId);
    calleeView = false;
  }

  const chainInfo = {
    chainValid: validTotal > 0,          // 「有没有可验证证据」——不是「整份完不完整」
    fullyValid,                           // 整份是否一路不断（区分两种 true）
    verifiableEntries: validTotal,
    totalEntries,
    ...(firstBreak ? { firstBreak } : {}),
    ...(brokenReasons.length ? { unverifiable: brokenReasons } : {}),
  };

  if (records.length === 0) {
    return {
      rate: null,
      reason: brokenReasons.length
        ? `no_verifiable_records_for_agent;chain_partially_invalid@${brokenReasons.join(',')}`
        : 'no_records_for_agent',
      ...chainInfo,
      total: 0,
      passed: 0,
    };
  }

  const passed = records.filter(e => e.result === 'success').length;
  return {
    rate: passed / records.length,
    ...chainInfo,
    total: records.length,
    passed,
    calleeView,
    reason: [
      calleeView ? 'callee_view' : 'participant_view_fallback',
      brokenReasons.length ? `partial_chain@${brokenReasons.join(',')}` : null,
    ].filter(Boolean).join(';'),
  };
}

module.exports = { verifyRate, verifyChain, verifyChainSegments, canonicalContent, GENESIS_HASH };
