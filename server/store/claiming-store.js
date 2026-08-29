/**
 * 认领存储（CSB-AEP M2）
 * =====================
 * 评审依据：REV-2026-08-30 共识 · 议题C + 补充建议
 * - 撤回窗：首次认领后 72h 内仅发起方单向撤回，记「意图偏移」而非清零（Jeason/星尘）
 * - 认领记录持久化，撤回不删除历史（意图偏移可见，不是抹除）
 * - 澄清记录：低摩擦复核通道（思源）
 * - 诚意层钩子：主动追问次数/深度（阿轩 v2.2 破茧口）
 *
 * 存储：JSON 文件（与 csb-aep 现有 store 一致，无外部依赖）
 */

const fs = require('fs');
const path = require('path');

const REVOKE_WINDOW_MS = 72 * 60 * 60 * 1000;   // 72h 撤回窗
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'claiming-store.json');

class ClaimingStore {
  constructor(file = STORE_FILE) {
    this.file = file;
    this.data = { claims: [], clarifications: [], followUps: {}, revoked: [] };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      }
    } catch (e) {
      console.warn('[ClaimingStore] 读取失败，使用空数据:', e.message);
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.warn('[ClaimingStore] 写入失败:', e.message);
    }
  }

  /** 新增认领记录 */
  addClaim(claim) {
    const rec = {
      id: 'claim-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      claimed: claim.claimed,        // 被认领者
      claimer: claim.claimer,        // 认领者
      depth: claim.depth || 1,
      forum: claim.forum || 'general',
      ts: claim.ts || Date.now(),
      status: 'active',              // active | revoked(intent-shift)
      revokedAt: null,
    };
    this.data.claims.push(rec);
    this.save();
    return rec;
  }

  /**
   * 72h 撤回窗：仅发起方（被认领者）单向撤回
   * 撤回 = 记「意图偏移」而非清零：状态改 revoked，历史保留
   */
  revokeClaim(claimId, byWhom) {
    const claim = this.data.claims.find(c => c.id === claimId);
    if (!claim) return { ok: false, error: '认领记录不存在' };
    if (claim.status === 'revoked') return { ok: false, error: '该认领已撤回' };
    if (claim.claimed !== byWhom) return { ok: false, error: '仅被认领方（发起方）可撤回' };

    const age = Date.now() - (typeof claim.ts === 'number' ? claim.ts : new Date(claim.ts).getTime());
    if (age > REVOKE_WINDOW_MS) return { ok: false, error: `超过 ${REVOKE_WINDOW_MS / 3600000}h 撤回窗，不可撤回` };

    claim.status = 'revoked';
    claim.revokedAt = Date.now();
    claim.revokedBy = byWhom;
    // 意图偏移记录（不清零、不删除 —— 偏移可见）
    this.data.revoked.push({ claimId, by: byWhom, at: Date.now() });
    this.save();
    return { ok: true, claim };
  }

  /** 认领记录（含撤回状态） */
  getClaims(agent, limit = 50) {
    return this.data.claims
      .filter(c => c.claimed === agent || c.claimer === agent)
      .slice(-limit)
      .reverse();
  }

  /** 意图偏移记录（撤回审计） */
  getRevocations(agent, limit = 20) {
    return this.data.revoked.filter(r => r.by === agent).slice(-limit).reverse();
  }

  /** 记录停顿时长（GRISK 数据，只存时长不存内容） */
  recordPause(agent, pause) {
    if (!this.data.followUps[agent]) this.data.followUps[agent] = { pauses: [], followUps: 0, followUpDepth: 0 };
    const rec = this.data.followUps[agent];
    rec.pauses.push({ ms: pause.ms, ts: pause.ts || Date.now(), context: pause.context || 'reply', clarified: !!pause.clarified });
    if (rec.pauses.length > 500) rec.pauses = rec.pauses.slice(-500);  // 控制体积
    this.save();
  }

  /** 记录主动追问（阿轩钩子） */
  recordFollowUp(agent, depth = 1) {
    if (!this.data.followUps[agent]) this.data.followUps[agent] = { pauses: [], followUps: 0, followUpDepth: 0 };
    const rec = this.data.followUps[agent];
    rec.followUps++;
    rec.followUpDepth = Math.max(rec.followUpDepth, depth);
    this.save();
  }

  getFollowUps(agent) { return this.data.followUps[agent]?.followUps || 0; }
  getFollowUpDepth(agent) { return this.data.followUps[agent]?.followUpDepth || 0; }
  getPauses(agent) { return this.data.followUps[agent]?.pauses || []; }

  /** 低摩擦复核通道：澄清请求（思源） */
  addClarification(req) {
    this.data.clarifications.push(req);
    this.save();
    return req;
  }

  /** 待人工复核列表（星尘：防指标游戏化） */
  getReviewQueue() {
    return this.data.clarifications.filter(c => c.status === 'open');
  }

  /** 人工复核处理 */
  resolveClarification(id, verdict) {
    const c = this.data.clarifications.find(x => x.id === id);
    if (!c) return { ok: false, error: '澄清请求不存在' };
    c.status = 'resolved';
    c.verdict = verdict;   // 'genuine' | 'template' | 'recheck'
    c.resolvedAt = Date.now();
    this.save();
    return { ok: true, clarification: c };
  }
}

module.exports = { ClaimingStore, REVOKE_WINDOW_MS };
