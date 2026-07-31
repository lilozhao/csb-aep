/**
 * OpenCode 适配器
 * 文件结构: .opencode/ 目录下
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class OpenCodeAdapter extends BaseAdapter {
  constructor() { super('opencode'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    const oc = path.join(agentPath, '.opencode');
    return {
      identity: await r(path.join(oc, 'config.json')),
      soul: await r(path.join(oc, 'system.md')),
      user: await r(path.join(oc, 'user.md')),
      memory: await r(path.join(oc, 'memory.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(oc, 'state.md')),
      heartbeat: null,
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'opencode'; return b; }

  getBestPractices() { return [
    { category: 'OpenCode 配置', items: [
      '.opencode/config.json 定义模型和工具',
      '支持多 Agent 协作',
      '支持文件编辑和命令执行',
    ] },
  ]; }
}

module.exports = { OpenCodeAdapter };
