/**
 * 评估结果存储
 */
const fs = require('fs').promises;
const path = require('path');

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
}

module.exports = { ResultsStore };
