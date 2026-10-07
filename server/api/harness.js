/**
 * Harness 工程域 API（HarnessAPI）· CSB-AEP v2.4 · M1
 *
 * 协议依据：csb-AEP-v1.1.md §7
 * 域隔离（红线第 6 条精神）：
 *   - /api/harness/* 独立于 /api/eval/* 与 /api/gdi/*
 *   - 本域路由不产生 eval 记录；eval 响应不含 harness 字段
 *   - 独立 store：data/harness/harness-store.json
 *
 * M1 端点：
 *   POST /api/harness/manifest      提交/校验 Harness Manifest
 *   POST /api/harness/eval          创建 Harness 域评测（manifest + trace 数据）
 *   GET  /api/harness/eval/:id      评测结果
 *   GET  /api/harness/capabilities  本域支持情况（哪些可测/哪些 N/A）
 *   GET  /api/harness/health        健康检查
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { HarnessEvaluator, IMPLEMENTED, PLANNED } = require('../engine/harness');
const { validateManifest } = require('../engine/harness/manifest.js');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'harness');
const STORE_FILE = path.join(DATA_DIR, 'harness-store.json');

class HarnessStore {
  constructor(file = STORE_FILE) {
    this.file = file;
    this.data = { evaluations: [] };
    this.load();
  }
  load() {
    try {
      if (fs.existsSync(this.file)) this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) { console.warn('[HarnessStore] 读取失败，使用空数据:', e.message); }
  }
  save() {
    const dir = path.dirname(this.file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
  add(record) { this.data.evaluations.push(record); this.save(); return record; }
  get(id) { return this.data.evaluations.find(e => e.id === id) || null; }
  list() { return this.data.evaluations.map(e => ({ id: e.id, harness: e.harness, evaluatedAt: e.evaluatedAt, avg: e.partial?.average })); }
}

class HarnessAPI {
  constructor(config = {}) {
    this.config = config;
    this.evaluator = new HarnessEvaluator();
    this.store = new HarnessStore((config.harness && config.harness.storeFile) || STORE_FILE);
    this._seq = 0;
  }

  _id() { return `harness-${Date.now()}-${++this._seq}`; }

  register(app) {
    // 提交/校验 Manifest
    app.post('/api/harness/manifest', (req, res) => {
      const { manifest } = req.body || {};
      const result = validateManifest(manifest);
      res.json({
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        na: result.na,
        note: 'Manifest 为 Harness 域地基；无 Manifest 的相关指标将标 N/A（协议 §7.2）',
      });
    });

    // 创建评测
    app.post('/api/harness/eval', (req, res) => {
      const { manifest = null, traces = [], ttftMs = [], traps = [], runs = [], traceFormat,
        peerTokens, bestSteps, unitPrice, toolCost, peerCosts, loads, trapSpec } = req.body || {};
      if (!manifest) {
        return res.status(400).json({ error: 'manifest 必填（协议 §7.2 前置条件）' });
      }
      try {
        const result = this.evaluator.evaluate({ manifest, traces, ttftMs, traps, runs, traceFormat,
          peerTokens, bestSteps, unitPrice, toolCost, peerCosts, loads, trapSpec });
        const rec = this.store.add({ id: this._id(), ...result });
        res.json({ ok: true, id: rec.id, result: rec });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // 结果查询
    app.get('/api/harness/eval/:id', (req, res) => {
      const rec = this.store.get(req.params.id);
      if (!rec) return res.status(404).json({ error: 'not found' });
      res.json(rec);
    });

    // 列表
    app.get('/api/harness/evals', (req, res) => {
      res.json({ evaluations: this.store.list() });
    });

    // 能力公示
    app.get('/api/harness/capabilities', (req, res) => {
      res.json(this.evaluator.capabilities());
    });

    // 探针定义（M2：loop-trap / tool-fault，只返回定义不执行）
    app.get('/api/harness/probes', (req, res) => {
      const { loopTrap, toolFault, sideEffect } = require('../engine/harness/probes');
      res.json({
        probes: [loopTrap(), toolFault(), sideEffect()],
        note: '探针仅返回定义；执行须在容器化沙箱内（破坏性探针绑定一次性环境）',
      });
    });

    // 健康
    app.get('/api/harness/health', (req, res) => {
      res.json({ status: 'ok', domain: 'harness', version: '2.4.0-M2', implemented: IMPLEMENTED, planned: PLANNED });
    });
  }
}

module.exports = { HarnessAPI, HarnessStore };
