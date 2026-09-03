/**
 * GDI 观测引擎（GdiObserver）· CSB-AEP v2.3
 *
 * 编排：加载数据源（契约/引用）→ 计算（命中率/复用率）→ 去刻度呈现。
 * 数据域隔离（红线第 6 条）：本引擎只读 data/gdi/sources/ 外部数据源，
 * 不读、不写 AEP 评测域（data/eval-results、/api/eval）的任何数据。
 *
 * 数据源约定（data/gdi/sources/）：
 *   contracts/*.json   每个文件一个契约数据源，格式 { meta, contracts: [...] }（schema 同 GDI MVP）
 *   references/*.json  每个文件一个引用数据源，格式 { meta, references: [...] }
 * 多源加载后按契约/引用 id 去重 merge。
 */
const fs = require('fs');
const path = require('path');

const { hitRate } = require('./contracts.js');
const { reuse } = require('./reuse.js');
const { presentCard } = require('./present.js');

const DEFAULT_SOURCES_DIR = path.join(__dirname, '..', '..', '..', 'data', 'gdi', 'sources');

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

class GdiObserver {
  constructor({ sourcesDir } = {}) {
    this.sourcesDir = sourcesDir || DEFAULT_SOURCES_DIR;
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
    const status = { contracts: [], references: [] };
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
    return status;
  }

  /** 数据源中出现的 agent 列表（按契约 promisor / 引用 target 聚合，去 emoji） */
  listAgents() {
    const { stripEmoji } = require('./contracts.js');
    const names = new Set();
    for (const c of this.loadContracts()) names.add(stripEmoji(c.promisor));
    for (const r of this.loadReferences()) names.add(stripEmoji(r.target));
    return [...names].filter(Boolean).sort();
  }

  /**
   * 观测单个 agent
   * @param {string} agentName agent 名（可带 emoji）
   * @param {object} [opts] { now }
   * @returns {object} { agent, observedAt, sources, dimensions, present }
   *   dimensions 含原始数值（L1：本人 + 人类席位可查，MVP 无鉴权仅记录 requester）
   *   present 为去刻度化呈现卡（对外口径，无离散刻度）
   */
  observe(agentName, opts = {}) {
    const now = opts.now || new Date();
    const contracts = this.loadContracts().filter(c => c.promisor === agentName);
    const refs = this.loadReferences().filter(r => r.target === agentName);

    const c = hitRate(contracts, now);
    const r = reuse(refs, agentName, now);
    const card = presentCard(c, r, { baseline: true });

    return {
      agent: agentName,
      observedAt: now.toISOString(),
      sources: {
        contractCount: contracts.length,
        referenceCount: refs.length,
        files: this.sourceStatus(),
      },
      dimensions: {
        contract: {
          rate: c.rate,
          kept: c.keptCount,
          broken: c.brokenCount,
          qualityBreakdown: c.qualityBreakdown,
          fused: c.fused,
        },
        reuse: {
          rate: r.rate,
          net: r.net,
          gross: r.gross,
          selfRefs: r.selfCount,
          externalRefers: r.externalRefers,
        },
      },
      present: card,
    };
  }
}

module.exports = { GdiObserver };
