/**
 * 通用 A2A 适配器
 * 适用于任何 A2A 兼容 Agent（兜底）
 */
const { BaseAdapter } = require('./base');

class GenericA2AAdapter extends BaseAdapter {
  constructor() {
    super('generic-a2a');
  }

  parseAgentCard(cardData) {
    const base = super.parseAgentCard(cardData);
    // 尝试从 metadata 推断框架
    if (cardData.metadata?.framework) {
      base.framework = cardData.metadata.framework;
    }
    return base;
  }

  getBestPractices() {
    return [
      {
        category: 'A2A 兼容性',
        items: [
          '确保 Agent Card 在 /.well-known/agent-card.json 可访问',
          'JSON-RPC 端点需支持 SendMessage 和 GetTask 方法',
          '任务状态机需完整：submitted → working → completed/failed',
          '错误响应需包含 code、message、data 字段',
        ]
      }
    ];
  }
}

module.exports = { GenericA2AAdapter };
