/**
 * CrewAI 适配器
 * 文件结构: crewai 项目目录
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class CrewAIAdapter extends BaseAdapter {
  constructor() { super('crewai'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    return {
      identity: await r(path.join(agentPath, 'config', 'agents.yaml')),
      soul: await r(path.join(agentPath, 'config', 'tasks.yaml')),
      user: await r(path.join(agentPath, 'user.md')),
      memory: await r(path.join(agentPath, 'memory.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(agentPath, 'state.md')),
      heartbeat: null,
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'crewai'; return b; }

  getBestPractices() { return [
    { category: 'CrewAI 配置', items: [
      'config/agents.yaml 定义 Agent 角色和能力',
      'config/tasks.yaml 定义任务流程',
      '支持多 Agent 协作和任务委托',
      '支持顺序/并行/层级多种执行模式',
    ] },
  ]; }
}

module.exports = { CrewAIAdapter };
