/**
 * Continue 适配器
 * 文件结构: .continue/ 目录下
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class ContinueAdapter extends BaseAdapter {
  constructor() { super('continue'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    const cont = path.join(agentPath, '.continue');
    return {
      identity: await r(path.join(cont, 'config.json')),
      soul: await r(path.join(cont, 'prompts', 'default.md')),
      user: await r(path.join(cont, 'user.md')),
      memory: await r(path.join(cont, 'memory.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(cont, 'state.md')),
      heartbeat: null,
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'continue'; return b; }

  getBestPractices() { return [
    { category: 'Continue 配置', items: [
      '.continue/config.json 定义模型和工具',
      '支持自定义 Slash Commands',
      '支持上下文引用（@file、@code 等）',
      '支持多模型切换',
    ] },
  ]; }
}

module.exports = { ContinueAdapter };
