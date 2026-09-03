/**
 * GDI 观测 API（GdiAPI）· CSB-AEP v2.3
 *
 * 数据域隔离（红线第 6 条）：/api/gdi/* 独立于 /api/eval/*。
 * - GDI 观测不产生评测记录，不进排行榜，不进评测历史
 * - 观测结果仅本人 + 人类席位可查（MVP 无鉴权：requester 字段留痕，默认 'anonymous'）
 * - 呈现层只出去刻度卡片（present），数值明细（dimensions）L1 分级随响应（内部校准用）
 */
const { GdiObserver } = require('../engine/gdi');
const { GdiStore } = require('../store/gdi-store');

/** 对外口径净化：呈现卡去除离散刻度（value 等原始数值），只留质性标签/箭头 */
function cleanPresent(card) {
  const out = { note: card.note };
  for (const k of ['contract', 'reuse']) {
    if (card[k]) {
      out[k] = {};
      for (const [kk, vv] of Object.entries(card[k])) {
        if (kk !== 'value') out[k][kk] = vv; // value = 原始分值，去刻度红线
      }
    }
  }
  return out;
}

class GdiAPI {
  constructor(config = {}) {
    this.config = config;
    this.observer = new GdiObserver({ sourcesDir: config.gdiSourcesDir });
    this.store = new GdiStore(config.gdiStoreFile);
  }

  register(app) {
    // 观测（触发一次计算 + 存历史）
    app.post('/api/gdi/observe', (req, res) => {
      const { agentName, requester } = req.body || {};
      if (!agentName) {
        return res.status(400).json({ error: 'agentName 必填（数据源中的 agent 名，可用 /api/gdi/agents 查）' });
      }
      try {
        const obs = this.observer.observe(agentName);
        obs.requester = requester || 'anonymous';
        obs.present = cleanPresent(obs.present); // 对外呈现去刻度（红线：不显示离散分数）
        const record = this.store.saveObservation(obs);
        res.json({
          agent: record.agent,
          observedAt: record.observedAt,
          present: record.present,       // 去刻度呈现卡（对外口径）
          dimensions: record.dimensions, // L1 数值（本人 + 人类席位）
          note: 'GDI 只观测关系的影子，不定义关系本身。不排名、不公示、不用于绩效。',
        });
      } catch (e) {
        res.status(500).json({ error: `观测失败: ${e.message}` });
      }
    });

    // 最近一次观测（本人/人类席位复查用）
    app.get('/api/gdi/observe/:agent', (req, res) => {
      const agent = decodeURIComponent(req.params.agent);
      const latest = this.store.latest(agent);
      if (!latest) return res.status(404).json({ error: `无观测记录: ${agent}（先 POST /api/gdi/observe）` });
      res.json(latest);
    });

    // 观测历史（趋势箭头自第二期起生效）
    app.get('/api/gdi/history/:agent', (req, res) => {
      const agent = decodeURIComponent(req.params.agent);
      res.json({ agent, observations: this.store.history(agent) });
    });

    // 数据源中的可用 agent
    app.get('/api/gdi/agents', (req, res) => {
      res.json({ agents: this.observer.listAgents() });
    });

    // 数据源状态（每个文件的记录数）
    app.get('/api/gdi/sources', (req, res) => {
      res.json(this.observer.sourceStatus());
    });

    // 健康探针（域隔离自证：GDI 域可达且与 eval 域无交叉）
    app.get('/api/gdi/health', (req, res) => {
      res.json({
        domain: 'gdi',
        isolated: true,
        note: 'GDI 观测域独立于 AEP 评测域（红线第 6 条）',
        sources: this.observer.sourceStatus(),
        observationCount: this.store.data.observations.length,
      });
    });
  }
}

module.exports = { GdiAPI, cleanPresent };
