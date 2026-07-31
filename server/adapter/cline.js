/**
 * Cline 适配器
 * 文件结构: .cline/ 目录下
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class ClineAdapter extends BaseAdapter {
  constructor() { super('cline'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    const cline = path.join(agentPath, '.cline');
    return {
      identity: await r(path.join(cline, 'config.json')),
      soul: await r(path.join(cline, 'system-prompt.md')),
      user: await r(path.join(cline, 'user.md')),
      memory: await r(path.join(cline, 'memory.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(cline, 'state.md')),
      heartbeat: null,
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'cline'; return b; }

  getBestPractices() { return [
    { category: 'Cline 配置', items: [
      '.cline/system-prompt.md 定义系统提示词',
      '支持 MCP 工具调用',
      '支持 Plan & Act 模式',
      '内置浏览器控制能力',
    ] },
  ]; }
}

module.exports = { ClineAdapter };
