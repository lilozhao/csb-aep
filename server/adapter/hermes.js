/**
 * Hermes 适配器
 * 支持黑盒 + 白盒测试
 * Hermes 文件结构: .hermes/ 目录下
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class HermesAdapter extends BaseAdapter {
  constructor() {
    super('hermes');
  }

  async readAgentFiles(agentPath) {
    const readFile = async (filePath) => {
      try { return await fs.readFile(filePath, 'utf-8'); }
      catch (e) { return null; }
    };

    // Hermes 文件结构
    const hermesDir = path.join(agentPath, '.hermes');
    return {
      identity: await readFile(path.join(hermesDir, 'identity.json')),
      soul: await readFile(path.join(hermesDir, 'SOUL.md')),
      user: await readFile(path.join(hermesDir, 'USER.md')),
      memory: await readFile(path.join(hermesDir, 'MEMORY.md')),
      agents: await readFile(path.join(hermesDir, 'AGENTS.md')),
      selfState: await readFile(path.join(hermesDir, 'state.md')),
      heartbeat: await readFile(path.join(hermesDir, 'HEARTBEAT.md')),
    };
  }

  parseAgentCard(cardData) {
    const base = super.parseAgentCard(cardData);
    base.framework = 'hermes';
    return base;
  }

  getBestPractices() {
    return [
      {
        category: 'Hermes 身份',
        items: [
          '.hermes/SOUL.md 定义核心人格',
          '.hermes/identity.json 包含 name、version、port',
          '确保 Agent Card 在 /.well-known/agent-card.json 可访问',
        ]
      },
      {
        category: 'Hermes 记忆',
        items: [
          '.hermes/MEMORY.md 保持 ≤200 行',
          '重要事件带时间戳',
          '定期整理和归档',
        ]
      },
    ];
  }
}

module.exports = { HermesAdapter };
