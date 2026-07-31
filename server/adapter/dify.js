/**
 * Dify 适配器
 * Dify 是一个 LLM 应用开发平台
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class DifyAdapter extends BaseAdapter {
  constructor() { super('dify'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    return {
      identity: await r(path.join(agentPath, 'dify.yaml')),
      soul: await r(path.join(agentPath, 'prompts', 'system.md')),
      user: await r(path.join(agentPath, 'user.md')),
      memory: await r(path.join(agentPath, 'memory.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(agentPath, 'state.md')),
      heartbeat: null,
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'dify'; return b; }

  getBestPractices() { return [
    { category: 'Dify 配置', items: [
      '支持可视化工作流编排',
      '内置 RAG（检索增强生成）',
      '支持 API 和 Webhook 集成',
      '支持多轮对话和上下文管理',
    ] },
  ]; }
}

module.exports = { DifyAdapter };
