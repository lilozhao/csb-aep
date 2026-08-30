/**
 * OpenClaw 适配器
 * 支持黑盒 + 白盒测试
 */
const { BaseAdapter } = require('./base');
const fs = require('fs').promises;
const path = require('path');

class OpenClawAdapter extends BaseAdapter {
  constructor() {
    super('openclaw');
  }

  async readAgentFiles(agentPath) {
    const readFile = async (filePath) => {
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch (e) {
        return null;
      }
    };

    // 先找根目录精确位置
    const files = {
      identity: await readFile(path.join(agentPath, 'identity.json')),
      soul: await readFile(path.join(agentPath, 'SOUL.md')),
      user: await readFile(path.join(agentPath, 'USER.md')),
      memory: await readFile(path.join(agentPath, 'MEMORY.md')),
      agents: await readFile(path.join(agentPath, 'AGENTS.md')),
      selfState: await readFile(path.join(agentPath, 'SELF_STATE.md')),
      heartbeat: await readFile(path.join(agentPath, 'HEARTBEAT.md')),
    };

    // 兑底：缺失文件递归子目录查找（如 identity.json 在 csb-a2a-aip/ 子目录）
    const FILE_NAMES = {
      identity: 'identity.json',
      soul: 'soul.md',
      user: 'user.md',
      memory: 'memory.md',
      agents: 'agents.md',
      selfState: 'self_state.md',
      heartbeat: 'heartbeat.md',
    };
    const missingMap = {};
    for (const [key, content] of Object.entries(files)) {
      if (!content) missingMap[key] = FILE_NAMES[key];
    }
    if (Object.keys(missingMap).length > 0) {
      const found = await this.findInSubdirs(agentPath, missingMap);
      for (const [key, content] of Object.entries(found)) files[key] = content;
    }

    return files;
  }

  parseAgentCard(cardData) {
    const base = super.parseAgentCard(cardData);
    base.framework = 'openclaw';
    return base;
  }

  getBestPractices() {
    return [
      {
        category: '身份文件',
        items: [
          'SOUL.md 应包含核心价值观和行为准则',
          'IDENTITY.md 应包含名字、定位、emoji',
          'USER.md 应记录用户偏好和上下文',
        ]
      },
      {
        category: '记忆系统',
        items: [
          'MEMORY.md 应定期更新，保持 ≤200 行',
          '每日创建 memory/YYYY-MM-DD.md 日志',
          '重要事件带时间戳记录',
        ]
      },
      {
        category: '元认知',
        items: [
          'SELF_STATE.md 追踪当前状态和承诺',
          'HEARTBEAT.md 包含定期检查任务',
          'corrections.md 记录纠正和反思',
        ]
      },
      {
        category: 'A2A 通信',
        items: [
          'identity.json 中 port 字段与实际端口一致',
          'server_v5.js 使用分层提示词 + LLM Router',
          '确保 Agent Card 可从外部访问',
        ]
      }
    ];
  }
}

module.exports = { OpenClawAdapter };
