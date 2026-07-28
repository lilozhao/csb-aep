/**
 * 架构适配器基类
 * 所有架构适配器都继承此类
 */
class BaseAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * 白盒：读取 Agent 文件
   * @param {string} agentPath - Agent 文件路径
   * @returns {object} 文件内容
   */
  async readAgentFiles(agentPath) {
    throw new Error('readAgentFiles not implemented');
  }

  /**
   * 黑盒：获取 A2A 端点
   * @param {object} agentConfig - Agent 配置
   * @returns {string} A2A URL
   */
  getA2AEndpoint(agentConfig) {
    throw new Error('getA2AEndpoint not implemented');
  }

  /**
   * 解析 Agent Card
   * @param {object} cardData - Agent Card 原始数据
   * @returns {object} 标准化的 Agent 信息
   */
  parseAgentCard(cardData) {
    return {
      name: cardData.name || 'Unknown',
      version: cardData.version || '0.0.0',
      description: cardData.description || '',
      framework: this.name,
      endpoints: cardData.endpoints || {},
      capabilities: cardData.capabilities || {},
      skills: cardData.skills || [],
    };
  }

  /**
   * 获取该架构的最佳实践建议
   * @returns {object[]} 建议列表
   */
  getBestPractices() {
    return [];
  }
}

module.exports = { BaseAdapter };
