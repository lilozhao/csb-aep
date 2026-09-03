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

/** 读取审计源目录（*.jsonl），返回 { files: [{name, entries, chain}], error? } */
function loadAuditSources(dir) {
  const out = { files: [], total: 0 };
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.jsonl')).sort()) {
    try {
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean);
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

  // 所有源文件必须链有效（任一文件被篡改 → 整体不可信）
  for (const f of src.files) {
    const chain = verifyChain(f.entries);
    if (!chain.valid) {
      return { rate: null, reason: `chain_invalid@${f.name}:${chain.reason}`, chainValid: false, total: 0, passed: 0 };
    }
  }

  // 被校验方视角：agent 作为 callee
  let records = src.files.flatMap(f => f.entries).filter(e => e.callee_id === agentId);
  let calleeView = true;
  if (records.length === 0) {
    // 退化：agent 参与的全部记录（caller 或 callee）
    records = src.files.flatMap(f => f.entries).filter(e => e.caller_id === agentId || e.callee_id === agentId);
    calleeView = false;
  }
  if (records.length === 0) return { rate: null, reason: 'no_records_for_agent', chainValid: true, total: 0, passed: 0 };

  const passed = records.filter(e => e.result === 'success').length;
  return {
    rate: passed / records.length,
    chainValid: true,
    total: records.length,
    passed,
    calleeView,
    reason: calleeView ? 'callee_view' : 'participant_view_fallback',
  };
}

module.exports = { verifyRate, verifyChain, canonicalContent, GENESIS_HASH };
