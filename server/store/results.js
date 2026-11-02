/**
 * 评估结果存储
 */
const fs = require('fs').promises;
const path = require('path');
const criteria = require('../engine/criteria');

class ResultsStore {
  constructor(storeDir) {
    this.storeDir = storeDir;
    this.resultsFile = path.join(storeDir, 'eval-results.json');
  }

  async init() {
    await fs.mkdir(this.storeDir, { recursive: true });
    try {
      await fs.access(this.resultsFile);
    } catch {
      await fs.writeFile(this.resultsFile, JSON.stringify([], null, 2));
    }
  }

  async load() {
    try {
      const data = await fs.readFile(this.resultsFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async save(results) {
    await fs.writeFile(this.resultsFile, JSON.stringify(results, null, 2));
  }

  async add(result) {
    const results = await this.load();
    results.push({
      id: `eval_${Date.now()}`,
      ...result,
    });
    await this.save(results);
    return results[results.length - 1];
  }

  async getAll() {
    return this.load();
  }

  async getById(id) {
    const results = await this.load();
    return results.find(r => r.id === id);
  }

  async getLatest(limit = 10) {
    const results = await this.load();
    return results.slice(-limit).reverse();
  }

  async getByAgent(agentUrl) {
    const results = await this.load();
    return results.filter(r => r.agentUrl === agentUrl);
  }

  /**
   * P1-4：取最近一份结果，并**判断它能否在当前判据下复用**。
   *
   * 为什么不在 getLatest 里自动过滤：调用方需要知道"为什么不能用"，
   * 静默过滤会让人以为"从来没有跑过"，而实际上是"跑过但判据变了"。
   * 两种情况的处理方式完全不同（前者重跑，后者要评估差异是否可接受）。
   *
   * @param {object} currentCriteria 当前判据（weights/standard/mode/policyVersion…）
   * @param {object} [filter] { agentUrl }
   * @returns {Promise<{report:object|null, reuse:object}>}
   */
  async getLatestWithReuseCheck(currentCriteria, filter = {}) {
    const all = await this.load();
    let list = all;
    if (filter.agentUrl) list = list.filter((r) => r.agentUrl === filter.agentUrl);
    const report = list.length ? list[list.length - 1] : null;
    if (!report) {
      return {
        report: null,
        reuse: { status: criteria.REUSE.UNKNOWN, reusable: false, reason: '没有历史结果' , diff: [] },
      };
    }
    return { report, reuse: criteria.checkReusable(report, currentCriteria) };
  }
}

module.exports = { ResultsStore };
