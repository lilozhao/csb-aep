/**
 * Cursor 适配器
 * 文件结构: .cursor/ 目录下
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class CursorAdapter extends BaseAdapter {
  constructor() { super('cursor'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    const cursor = path.join(agentPath, '.cursor');
    return {
      identity: await r(path.join(cursor, 'config.json')),
      soul: await r(path.join(agentPath, '.cursorrules')),
      user: await r(path.join(cursor, 'user.md')),
      memory: await r(path.join(cursor, 'memory.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(cursor, 'state.md')),
      heartbeat: null,
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'cursor'; return b; }

  getBestPractices() { return [
    { category: 'Cursor 配置', items: [
      '.cursorrules 定义 Agent 行为（项目根目录）',
      '.cursor/config.json 包含编辑器配置',
      '支持 AI 代码补全和对话',
      '支持多模型切换（GPT-4、Claude 等）',
    ] },
  ]; }
}

module.exports = { CursorAdapter };
