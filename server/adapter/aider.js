/**
 * Aider 适配器
 * 文件结构: .aider* 文件
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class AiderAdapter extends BaseAdapter {
  constructor() { super('aider'); }

  async readAgentFiles(agentPath) {
    const r = async (p) => { try { return await fs.readFile(p, 'utf-8'); } catch { return null; } };
    return {
      identity: await r(path.join(agentPath, '.aider.conf.yml')),
      soul: await r(path.join(agentPath, 'CONVENTIONS.md')),
      user: await r(path.join(agentPath, '.aider.user.md')),
      memory: await r(path.join(agentPath, '.aider.chat.history.md')),
      agents: await r(path.join(agentPath, 'AGENTS.md')),
      selfState: await r(path.join(agentPath, '.aider.state')),
      heartbeat: null,
    };
  }

  parseAgentCard(c) { const b = super.parseAgentCard(c); b.framework = 'aider'; return b; }

  getBestPractices() { return [
    { category: 'Aider 配置', items: [
      '.aider.conf.yml 定义默认模型和参数',
      'CONVENTIONS.md 定义代码风格和规范',
      '支持 git 集成，自动提交变更',
      '支持多文件编辑和重构',
    ] },
  ]; }
}

module.exports = { AiderAdapter };
