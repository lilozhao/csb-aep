/**
 * 架构适配器基类
 * 所有架构适配器都继承此类
 * v2.1 新增：S 类安全适配接口（getToolInventory / getPermissionConfig / getInjectionDefense / testCanary）
 */
const fs = require('fs').promises;
const path = require('path');
const { collectorFor } = require('./collector-registry');

/**
 * 运行时采集档位（P1-1）—— 与 verdict.TIER 同口径，但这里表达的是**能力上限**，
 * 不是某次评测的结果。eval.js 用它给 resolveTier 封顶：
 * 适配器声明 protocol，就不可能在本次评测里被判成 hook 档。
 */
const COLLECTOR_TIER = Object.freeze({
  HOOK: 'hook',        // 能拿到工具调用级事件（tool_use / tool_result）
  PROTOCOL: 'protocol',// 只能看到 A2A 请求/响应往返
  PTY: 'pty',          // 只能抓屏 / 读终端输出
  NONE: 'none',        // 运行时完全不可见，只能读静态文件
});

class BaseAdapter {
  constructor(name) {
    this.name = name;
    // 采集能力声明（P0-6）：决定判定档位上限，**必须如实**。
    //   hooks=true 的含义是「本适配器真的能拿到工具调用级事件」，不是「我知道哪种架构有钩子」。
    //   目前全部适配器都走 A2A 协议往返 → 一律 false（PROTOCOL 档）。
    //   哪天某个适配器接上了真实钩子，在这里改，并补一条测试证明它确实能读到工具事件。
    this.capabilities = { hooks: false };

    // ── 采集器元数据（P1-1，2026-11-02）──────────────────────────────
    // 两个概念必须分开，混在一起会得出错误结论：
    //   ① tier   = **运行时**能看见什么粒度 → 决定这条结论能不能判 FAIL（P0-6 的档位天花板）
    //   ② sources = **静态**能从 Agent 文件读到什么 → 决定白盒能查什么（S 类安全项的输入）
    // 一个适配器可以静态全知、运行时全盲（tier=none），也可以反之。
    //
    // 声明纪律：sources 里写 true **必须真能读到**，由 collector-tier.test.js 逐个用样本目录验证。
    // 读不到就写 false 并在 reason 里说明为什么 —— 宁可承认看不见，不要谎报看得见。
    // 能力声明从 collector-registry 取（P1-1）：集中一张表，审计能一眼看全。
    // 适配器可在构造后覆盖 this.collector.sources —— 覆盖必须同步更新 registry，
    // 否则 collector-tier.test.js 会报「表与实现不一致」。
    const declared = collectorFor(name);
    this.collector = {
      tier: declared.tier || COLLECTOR_TIER.PROTOCOL,   // 运行时档位上限（不是本次评测结果）
      tierReason: declared.tierReason || 'a2a_roundtrip',
      sources: { ...declared.sources },                 // 静态证据源
      sourcesReason: { ...declared.sourcesReason },     // { 字段名: '为什么是这个值' }
      registered: declared.registered === true,
    };
  }

  /**
   * 采集器元数据快照（供回执落库 / 报告展示）
   * @returns {{id:string,tier:string,tierReason:string,sources:object,declared:object}}
   */
  collectorMeta() {
    return {
      id: this.name,
      tier: this.collector.tier,
      tierReason: this.collector.tierReason,
      registered: this.collector.registered,
      sources: { ...this.collector.sources },
      sourcesReason: { ...this.collector.sourcesReason },
    };
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

module.exports = { BaseAdapter, COLLECTOR_TIER };
