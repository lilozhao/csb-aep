/**
 * GDI 观测引擎（GdiObserver）· CSB-AEP v2.3
 *
 * 编排：加载数据源（契约/引用/审计）→ 计算四维 → 去刻度呈现 + 预签名切片。
 * 数据域隔离（红线第 6 条）：本引擎只读 data/gdi/sources/ 外部数据源，
 * 不读、不写 AEP 评测域（data/eval-results、/api/eval）的任何数据。
 *
 * 数据源约定（data/gdi/sources/）：
 *   contracts/*.json   契约数据源 { meta, contracts: [...] }（schema 同 GDI MVP）
 *   references/*.json  引用数据源 { meta, references: [...] }
 *   audit/*.jsonl      审计数据源（csb-security AuditLog 落盘格式，维度 2）
 * 多源加载后按 id 去重 merge。
 *
 * 权重（config 焊死，定稿 40/30/20/10）：
 *   呈现聚合只使用可核实三维（40/30/20 归一化）；自评 10% 仅参考 + 校准提醒（不参与聚合）。
 */
const fs = require('fs');
const path = require('path');

const { hitRate } = require('./contracts.js');
const { reuse } = require('./reuse.js');
const { verifyRate } = require('./verify.js');
const { verifiableScore, calibrate } = require('./self-report.js');
const { witness } = require('./witness.js');
const { provenance } = require('./provenance.js');
const { presentCard, buildSlices } = require('./present.js');

const DEFAULT_SOURCES_DIR = path.join(__dirname, '..', '..', '..', 'data', 'gdi', 'sources');
const DEFAULT_WEIGHTS = { contract: 0.4, verify: 0.3, reuse: 0.2, selfReport: 0.1 };
const DEFAULT_SECRET = 'csb-gdi-present-dev-secret'; // 生产环境用 AEP_GDI_PRESENT_SECRET 覆盖

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

class GdiObserver {
  constructor({ sourcesDir, weights, presentSecret } = {}) {
    this.sourcesDir = sourcesDir || DEFAULT_SOURCES_DIR;
    this.weights = weights || DEFAULT_WEIGHTS;
    this.secret = presentSecret || process.env.AEP_GDI_PRESENT_SECRET || DEFAULT_SECRET;
  }

  /** 加载全部契约源，按 id 去重 merge */
  loadContracts() {
    const dir = path.join(this.sourcesDir, 'contracts');
    const out = [];
    const seen = new Set();
    if (!fs.existsSync(dir)) return out;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
      let doc;
      try { doc = loadJson(path.join(dir, f)); } catch (e) { console.warn(`[GdiObserver] 契约源解析失败 ${f}: ${e.message}`); continue; }
      for (const c of doc.contracts || []) {
        if (!c.id || seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
      }
    }
    return out;
  }

  /** 加载全部引用源，按 id 去重 merge */
  loadReferences() {
    const dir = path.join(this.sourcesDir, 'references');
    const out = [];
    const seen = new Set();
    if (!fs.existsSync(dir)) return out;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
      let doc;
      try { doc = loadJson(path.join(dir, f)); } catch (e) { console.warn(`[GdiObserver] 引用源解析失败 ${f}: ${e.message}`); continue; }
      for (const r of doc.references || []) {
        if (!r.id || seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
    }
    return out;
  }

  /** 数据源状态（API /api/gdi/sources 用） */
  sourceStatus() {
    const status = { contracts: [], references: [], audit: [] };
    for (const kind of ['contracts', 'references']) {
      const dir = path.join(this.sourcesDir, kind);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
        try {
          const doc = loadJson(path.join(dir, f));
          status[kind].push({ file: f, count: (doc[kind] || []).length, generatedAt: doc.meta?.generatedAt || null });
        } catch { /* skip */ }
      }
    }
    const auditDir = path.join(this.sourcesDir, 'audit');
    if (fs.existsSync(auditDir)) {
      for (const f of fs.readdirSync(auditDir).filter(x => x.endsWith('.jsonl')).sort()) {
        try {
          const lines = fs.readFileSync(path.join(auditDir, f), 'utf8').split('\n').filter(Boolean);
          status.audit.push({ file: f, count: lines.length });
        } catch { /* skip */ }
      }
    }
    return status;
  }

  /** 数据源中出现的 agent 列表（契约 promisor / 引用 target 聚合，去 emoji） */
  listAgents() {
    const { stripEmoji } = require('./contracts.js');
    const names = new Set();
    for (const c of this.loadContracts()) names.add(stripEmoji(c.promisor));
    for (const r of this.loadReferences()) names.add(stripEmoji(r.target));
    return [...names].filter(Boolean).sort();
  }

  /**
   * 观测单个 agent（四维）
   * @param {string} agentName agent 名（可带 emoji）
   * @param {object} [opts] { now, selfReport10 } selfReport10: 0-10 自评（L3，仅参考 + 校准）
   * @returns {object} { agent, observedAt, sources, dimensions, calibration, present, slices }
   */
  observe(agentName, opts = {}) {
    const now = opts.now || new Date();
    const ts = now.toISOString();
    const contracts = this.loadContracts().filter(c => c.promisor === agentName);
    const refs = this.loadReferences().filter(r => r.target === agentName);
    const auditDir = path.join(this.sourcesDir, 'audit');

    const c = hitRate(contracts, now);
    const v = verifyRate(auditDir, agentName);
    const r = reuse(refs, agentName, now);
    const comp = verifiableScore({ contract: c, verify: v, reuse: r }, this.weights);

    // Witness 外部锚点观测（评审 T1-D · 观察期双轨：采集即开始，仅供观测不计入总分）
    const witnessObs = witness(this.sourcesDir, { now });
    const myWitness = witnessObs[agentName] || { witness: { naming: 0, milestone: 0, rewrite: 0 }, total: 0, eventCount: 0 };

    // Provenance 记忆溯源链观测（X-1 · 观察期：机制指标，仅供呈现不计分）
    const provObs = provenance(this.sourcesDir);

    // 自评（仅参考）：进校准，不进聚合
    const selfReport10 = opts.selfReport10 !== undefined ? opts.selfReport10 : null;
    const cal = selfReport10 !== null ? calibrate(selfReport10, comp) : null;

    const card = presentCard(c, v, r, comp, { baseline: true });
    const slices = buildSlices(this.secret, agentName, card, ts);

    return {
      agent: agentName,
      observedAt: ts,
      sources: {
        contractCount: contracts.length,
        referenceCount: refs.length,
        auditFiles: fs.existsSync(auditDir) ? fs.readdirSync(auditDir).filter(x => x.endsWith('.jsonl')).length : 0,
        files: this.sourceStatus(),
      },
      dimensions: {
        contract: {
          rate: c.rate, kept: c.keptCount, broken: c.brokenCount,
          qualityBreakdown: c.qualityBreakdown, fused: c.fused,
        },
        verify: { rate: v.rate, reason: v.reason || null, chainValid: v.chainValid, total: v.total, passed: v.passed },
        reuse: { rate: r.rate, net: r.net, gross: r.gross, selfRefs: r.selfCount, externalRefers: r.externalRefers },
        composite: { score: comp.score, covered: comp.covered, note: '可核实三维按 40/30/20 归一化；自评仅参考不参与聚合' },
        witness: { ...myWitness.witness, total: myWitness.total, eventCount: myWitness.eventCount, note: '观察期：采集即开始，不计入总分（评审 T1-D · 双轨启动）' },
        provenance: provObs || { observation: true, note: '无 provenance 数据源（csb-memory raw 未接入）' },
      },
      calibration: cal,
      present: card,
      slices,
    };
  }
}

module.exports = { GdiObserver };
