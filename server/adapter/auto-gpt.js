/**
 * Auto-GPT 适配器
 * 文件结构: auto_gpt_workspace/ 目录下
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class AutoGPTAdapter extends BaseAdapter {
  constructor() { super('auto-gpt'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    const ag = path.join(agentPath, 'auto_gpt_workspace');
    return {
      identity: await r(path.join(ag, 'ai_settings.yaml')),
      soul: await r(path.join(ag, 'system_prompt.md')),
      user: await r(path.join(ag, 'user.md')),
      memory: await r(path.join(ag, 'memory', 'summary.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(ag, 'state.md')),
      heartbeat: null,
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'auto-gpt'; return b; }

  getBestPractices() { return [
    { category: 'Auto-GPT 配置', items: [
      'auto_gpt_workspace/ai_settings.yaml 定义 AI 角色和目标',
      '支持自主任务分解和执行',
      '支持 Web 搜索和文件操作',
      '内置记忆系统（短期+长期）',
    ] },
  ]; }
}

module.exports = { AutoGPTAdapter };
