/**
 * Coze 适配器
 * Coze 是字节跳动的 Bot 平台，不原生支持 A2A
 * 主要用于黑盒测试（通过 Coze API 对话）
 */
const { BaseAdapter } = require('./base');

class CozeAdapter extends BaseAdapter {
  constructor() {
    super('coze');
  }

  parseAgentCard(cardData) {
    const base = super.parseAgentCard(cardData);
    base.framework = 'coze';
    // Coze Bot 通常没有标准 Agent Card
    if (cardData.bot_id) {
      base.name = cardData.bot_name || cardData.bot_id;
      base.endpoints.coze = `https://api.coze.cn/v3/chat`;
    }
    return base;
  }

  getBestPractices() {
    return [
      {
        category: 'Coze 兼容性',
        items: [
          'Coze Bot 需要开启 API 访问',
          '建议添加 A2A 代理层以支持标准协议测试',
          '黑盒测试通过 Coze API 进行对话',
        ]
      },
    ];
  }
}

module.exports = { CozeAdapter };
