/**
 * 架构适配器基类
 * 所有架构适配器都继承此类
 * v2.1 新增：S 类安全适配接口（getToolInventory / getPermissionConfig / getInjectionDefense / testCanary）
 */
const fs = require('fs').promises;
const path = require('path');

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
   * 递归查找缺失文件（子目录兑底，深度 ≤3）
   * 用于 identity.json / SOUL.md 等不在 agentPath 根目录的场景（如 csb-a2a-aip/identity.json）
   * @param {string} dir - 起始目录
   * @param {object} fileMap - 期望文件映射 { 返回key: 文件名(小写) }
   * @param {number} depth - 当前深度
   * @returns {object} 找到的文件内容 { key: content }
   */
  async findInSubdirs(dir, fileMap, depth = 0) {
    if (depth > 3) return {};
    const result = {};
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return {};
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await this.findInSubdirs(full, fileMap, depth + 1);
        Object.assign(result, sub);
      } else {
        const lower = entry.name.toLowerCase();
        for (const [key, targetName] of Object.entries(fileMap)) {
          if (result[key]) continue;
          if (lower === targetName) {
            try {
              result[key] = await fs.readFile(full, 'utf-8');
            } catch (e) { /* 忽略不可读文件 */ }
          }
        }
      }
      if (Object.keys(result).length >= Object.keys(fileMap).length) break;
    }
    return result;
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

  // ========== v2.1 新增：S 类安全适配接口 ==========

  /**
   * S 类：获取 Agent 工具清单
   * 返回 Agent 可用的所有工具/命令/技能列表，用于 S3 工具滥用防护测试
   * @param {string} agentPath - Agent 文件路径
   * @returns {object[]} 工具清单 [{ id, name, type, scope, dangerous }]
   */
  async getToolInventory(agentPath) {
    throw new Error('getToolInventory not implemented');
  }

  /**
   * S 类：获取 Agent 权限配置
   * 返回 Agent 的权限/信任等级/隐私级别配置，用于 S4 授权边界防护测试
   * @param {string} agentPath - Agent 文件路径
   * @returns {object} 权限配置 { trustLevel, privacyTiers, allowedCommands, forbiddenActions }
   */
  async getPermissionConfig(agentPath) {
    throw new Error('getPermissionConfig not implemented');
  }

  /**
   * S 类：获取注入防御配置
   * 返回 Agent 的注入防御机制信息，用于 S1 间接注入防御测试
   * @param {string} agentPath - Agent 文件路径
   * @returns {object} 注入防御配置 { channels, filters, sanitizers, unicodeNormalization }
   */
  async getInjectionDefense(agentPath) {
    throw new Error('getInjectionDefense not implemented');
  }

  /**
   * S 类：金丝雀测试
   * 向 Agent 发送一个无害的标记载荷，检查 Agent 是否将标记内容泄露到 Sink
   * 用于验证 S2 数据泄露防护和 S1 注入防御的有效性
   * @param {string} agentUrl - Agent A2A 端点
   * @param {string} canaryToken - 唯一标记令牌
   * @returns {object} { leaked: boolean, channels: string[], sinkState: object }
   */
  async testCanary(agentUrl, canaryToken) {
    throw new Error('testCanary not implemented');
  }
}

module.exports = { BaseAdapter };
