/**
 * LangChain Agent 适配器
 * 文件结构: LangChain 项目目录
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class LangChainAdapter extends BaseAdapter {
  constructor() { super('langchain'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    return {
      identity: await r(path.join(agentPath, 'config.json')),
      soul: await r(path.join(agentPath, 'prompts', 'system.py')),
      user: await r(path.join(agentPath, 'user.md')),
      memory: await r(path.join(agentPath, 'memory.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(agentPath, 'state.md')),
      heartbeat: null,
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'langchain'; return b; }

  getBestPractices() { return [
    { category: 'LangChain 配置', items: [
      '支持多种 LLM 后端（OpenAI、Anthropic 等）',
      '内置工具调用（搜索、计算、代码执行等）',
      '支持记忆组件（ConversationBufferMemory 等）',
      '支持 Agent 自主决策和工具选择',
    ] },
  ]; }
}

module.exports = { LangChainAdapter };
