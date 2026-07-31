/**
 * FastGPT 适配器
 * FastGPT 是一个基于 LLM 的知识库平台
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class FastGPTAdapter extends BaseAdapter {
  constructor() { super('fastgpt'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    return {
      identity: await r(path.join(agentPath, 'config.json')),
      soul: await r(path.join(agentPath, 'system.md')),
      user: await r(path.join(agentPath, 'user.md')),
      memory: await r(path.join(agentPath, 'memory.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(agentPath, 'state.md')),
      heartbeat: null,
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'fastgpt'; return b; }

  getBestPractices() { return [
    { category: 'FastGPT 配置', items: [
      '支持知识库导入和检索',
      '支持可视化工作流',
      '支持 API 集成',
      '支持多轮对话管理',
    ] },
  ]; }
}

module.exports = { FastGPTAdapter };
