/**
 * 白盒测试引擎
 * 直接读取 Agent 配置文件、记忆文件、技能文件，评估配置完整性和质量
 */

const fs = require('fs').promises;
const path = require('path');

// 白盒评估维度
const WHITEBOX_DIMENSIONS = [
  {
    id: 'identity-completeness',
    name: '身份完整性',
    weight: 20,
    checks: [
      { id: 'identity-exists', name: 'IDENTITY/SOUL 文件存在', weight: 30 },
      { id: 'identity-has-name', name: '身份有名字', weight: 20 },
      { id: 'identity-has-values', name: '身份有价值观', weight: 25 },
      { id: 'identity-has-emoji', name: '身份有标识', weight: 10 },
      { id: 'identity-has-location', name: '身份有位置信息', weight: 15 },
    ]
  },
  {
    id: 'memory-continuity',
    name: '记忆连续性',
    weight: 25,
    checks: [
      { id: 'memory-exists', name: 'MEMORY.md 存在', weight: 20 },
      { id: 'memory-has-content', name: '记忆有实质内容', weight: 25 },
      { id: 'memory-has-events', name: '记忆有重要事件', weight: 20 },
      { id: 'memory-has-timestamps', name: '事件带时间戳', weight: 15 },
      { id: 'memory-recent-update', name: '记忆近期更新', weight: 20 },
    ]
  },
  {
    id: 'user-profile',
    name: '用户画像',
    weight: 15,
    checks: [
      { id: 'user-exists', name: 'USER.md 存在', weight: 25 },
      { id: 'user-has-name', name: '用户有称呼', weight: 25 },
      { id: 'user-has-preferences', name: '记录用户偏好', weight: 30 },
      { id: 'user-has-context', name: '有用户上下文', weight: 20 },
    ]
  },
  {
    id: 'metacognition',
    name: '元认知能力',
    weight: 20,
    checks: [
      { id: 'agents-exists', name: 'AGENTS.md 存在', weight: 15 },
      { id: 'agents-has-rules', name: '有行为规则', weight: 20 },
      { id: 'self-state-exists', name: 'SELF_STATE.md 存在', weight: 20 },
      { id: 'heartbeat-exists', name: 'HEARTBEAT.md 存在', weight: 15 },
      { id: 'has-reflection', name: '有自我反思记录', weight: 30 },
    ]
  },
  {
    id: 'learning-growth',
    name: '学习成长',
    weight: 15,
    checks: [
      { id: 'has-corrections', name: '有纠正记录', weight: 30 },
      { id: 'has-lessons', name: '有经验教训', weight: 30 },
      { id: 'has-growth-log', name: '有成长记录', weight: 20 },
      { id: 'has-reusable', name: '有可复用结构', weight: 20 },
    ]
  },
  {
    id: 'a2a-config',
    name: 'A2A 配置',
    weight: 5,
    checks: [
      { id: 'identity-json-exists', name: 'identity.json 存在', weight: 30 },
      { id: 'identity-has-port', name: '配置端口', weight: 20 },
      { id: 'identity-has-version', name: '配置版本', weight: 20 },
      { id: 'identity-has-llm', name: '配置 LLM', weight: 30 },
    ]
  },
];

class WhiteBoxEngine {
  /**
   * 运行白盒评测
   * @param {object} files - 通过适配器读取的文件内容
   * @param {object} introspect - 远程 introspect 数据（可选）
   * @returns {object} 评测结果
   */
  async evaluate(files, introspect = null) {
    const results = [];

    // 如果有 introspect 数据，合并到 files 中
    if (introspect) {
      files = this.mergeIntrospect(files, introspect);
    }

    for (const dim of WHITEBOX_DIMENSIONS) {
      const dimResult = {
        id: dim.id,
        name: dim.name,
        weight: dim.weight,
        checks: [],
        score: 0,
      };

      for (const check of dim.checks) {
        const checkResult = this.runCheck(check.id, files);
        dimResult.checks.push({
          id: check.id,
          name: check.name,
          weight: check.weight,
          ...checkResult,
        });
      }

      // 计算维度得分
      dimResult.score = this.calculateDimensionScore(dimResult.checks);
      results.push(dimResult);
    }

    return {
      timestamp: new Date().toISOString(),
      dimensions: results,
      score: this.calculateTotalScore(results),
    };
  }

  /**
   * 运行单个检查
   */
  runCheck(checkId, files) {
    const checks = {
      // === 身份完整性 ===
      'identity-exists': () => {
        const hasSoul = !!files.soul;
        const hasIdentity = !!files.identity;
        return { pass: hasSoul || hasIdentity, detail: hasSoul ? 'SOUL.md 存在' : hasIdentity ? 'identity.json 存在' : '缺失' };
      },
      'identity-has-name': () => {
        const name = this.extractField(files, ['soul', 'identity', 'agents'], [/name[：:]\s*(.+)/i, /^#\s*(.+)/m, /(?:我叫|我是|名字是)\s*(.+)/]);
        return { pass: !!name, detail: name || '未找到名字' };
      },
      'identity-has-values': () => {
        const hasValues = this.containsKeywords(files.soul, ['价值观', '原则', '核心', '信念', '边界', '准则', 'value', 'principle']);
        return { pass: hasValues, detail: hasValues ? '包含价值观描述' : '缺少价值观' };
      },
      'identity-has-emoji': () => {
        const emoji = this.extractEmoji(files);
        return { pass: emoji.length > 0, detail: emoji.length > 0 ? `标识: ${emoji.slice(0, 3).join(' ')}` : '缺少标识' };
      },
      'identity-has-location': () => {
        const hasLoc = this.containsKeywords(files.soul + (files.identity || ''), ['杭州', '北京', '上海', '深圳', 'Hangzhou', 'Shanghai', 'Beijing', 'Location', '位置']);
        return { pass: hasLoc, detail: hasLoc ? '有位置信息' : '缺少位置信息' };
      },

      // === 记忆连续性 ===
      'memory-exists': () => {
        return { pass: !!files.memory, detail: files.memory ? 'MEMORY.md 存在' : 'MEMORY.md 缺失' };
      },
      'memory-has-content': () => {
        const len = (files.memory || '').length;
        return { pass: len > 200, detail: `${len} 字符`, score: Math.min(100, Math.round(len / 50)) };
      },
      'memory-has-events': () => {
        const eventPatterns = /\d{4}[-/]\d{1,2}[-/]\d{1,2}/g;
        const events = (files.memory || '').match(eventPatterns);
        return { pass: events && events.length > 0, detail: events ? `${events.length} 个带日期的事件` : '无日期事件' };
      },
      'memory-has-timestamps': () => {
        const tsPatterns = /\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}/g;
        const ts = (files.memory || '').match(tsPatterns);
        return { pass: ts && ts.length > 0, detail: ts ? `${ts.length} 个带时间戳的记录` : '无时间戳' };
      },
      'memory-recent-update': () => {
        // 检查是否有最近30天的日期
        const now = new Date();
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
        const datePatterns = /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/g;
        const content = files.memory || '';
        let match;
        let hasRecent = false;
        while ((match = datePatterns.exec(content)) !== null) {
          const d = new Date(match[1]);
          if (d > thirtyDaysAgo) { hasRecent = true; break; }
        }
        return { pass: hasRecent, detail: hasRecent ? '近30天有更新' : '超过30天未更新' };
      },

      // === 用户画像 ===
      'user-exists': () => {
        return { pass: !!files.user, detail: files.user ? 'USER.md 存在' : 'USER.md 缺失' };
      },
      'user-has-name': () => {
        const nameMatch = (files.user || '').match(/(?:称呼|名字|Name|What to call them)\s*[：:]\s*\*{0,2}\s*([^\n*#]+)/i);
        return { pass: !!nameMatch, detail: nameMatch ? `称呼: ${nameMatch[1].trim()}` : '缺少用户称呼' };
      },
      'user-has-preferences': () => {
        const hasPrefs = this.containsKeywords(files.user, ['偏好', '喜欢', '习惯', 'preference', '喜欢']);
        return { pass: hasPrefs, detail: hasPrefs ? '有偏好记录' : '缺少偏好' };
      },
      'user-has-context': () => {
        const hasCtx = this.containsKeywords(files.user, ['Context', '上下文', '背景', '项目', '工作']);
        return { pass: hasCtx, detail: hasCtx ? '有上下文信息' : '缺少上下文' };
      },

      // === 元认知 ===
      'agents-exists': () => {
        return { pass: !!files.agents, detail: files.agents ? 'AGENTS.md 存在' : 'AGENTS.md 缺失' };
      },
      'agents-has-rules': () => {
        const hasRules = this.containsKeywords(files.agents, ['规则', 'Rule', '原则', '禁止', '边界', '安全']);
        return { pass: hasRules, detail: hasRules ? '有行为规则' : '缺少规则' };
      },
      'self-state-exists': () => {
        return { pass: !!files.selfState, detail: files.selfState ? 'SELF_STATE.md 存在' : 'SELF_STATE.md 缺失' };
      },
      'heartbeat-exists': () => {
        return { pass: !!files.heartbeat, detail: files.heartbeat ? 'HEARTBEAT.md 存在' : 'HEARTBEAT.md 缺失' };
      },
      'has-reflection': () => {
        const allContent = Object.values(files).filter(Boolean).join('\n');
        const hasReflect = this.containsKeywords(allContent, ['反思', '反思', '改进', '教训', '认识到', '意识到', 'reflection']);
        return { pass: hasReflect, detail: hasReflect ? '有自我反思' : '缺少反思记录' };
      },

      // === 学习成长 ===
      'has-corrections': () => {
        const allContent = Object.values(files).filter(Boolean).join('\n');
        const hasCorr = this.containsKeywords(allContent, ['纠正', '纠正', 'correction', '错误', '改正']);
        return { pass: hasCorr, detail: hasCorr ? '有纠正记录' : '缺少纠正记录' };
      },
      'has-lessons': () => {
        const allContent = Object.values(files).filter(Boolean).join('\n');
        const hasLessons = this.containsKeywords(allContent, ['教训', '经验', 'lesson', '学到', '领悟']);
        return { pass: hasLessons, detail: hasLessons ? '有经验教训' : '缺少经验教训' };
      },
      'has-growth-log': () => {
        const allContent = Object.values(files).filter(Boolean).join('\n');
        const hasGrowth = this.containsKeywords(allContent, ['成长', '进步', '提升', 'growth', 'improve']);
        return { pass: hasGrowth, detail: hasGrowth ? '有成长记录' : '缺少成长记录' };
      },
      'has-reusable': () => {
        const allContent = Object.values(files).filter(Boolean).join('\n');
        const hasReuse = this.containsKeywords(allContent, ['模板', 'template', '框架', '结构', '复用']);
        return { pass: hasReuse, detail: hasReuse ? '有可复用结构' : '缺少可复用结构' };
      },

      // === A2A 配置 ===
      'identity-json-exists': () => {
        return { pass: !!files.identity, detail: files.identity ? 'identity.json 存在' : 'identity.json 缺失' };
      },
      'identity-has-port': () => {
        try {
          const id = JSON.parse(files.identity || '{}');
          return { pass: !!id.port, detail: id.port ? `端口: ${id.port}` : '未配置端口' };
        } catch { return { pass: false, detail: 'identity.json 解析失败' }; }
      },
      'identity-has-version': () => {
        try {
          const id = JSON.parse(files.identity || '{}');
          return { pass: !!id.version, detail: id.version ? `版本: ${id.version}` : '未配置版本' };
        } catch { return { pass: false, detail: 'identity.json 解析失败' }; }
      },
      'identity-has-llm': () => {
        try {
          const id = JSON.parse(files.identity || '{}');
          const hasLlm = !!(id.llm || id.llmRouter || id.llm_router);
          return { pass: hasLlm, detail: hasLlm ? 'LLM 已配置' : 'LLM 未配置' };
        } catch { return { pass: false, detail: 'identity.json 解析失败' }; }
      },
    };

    const checker = checks[checkId];
    if (!checker) return { pass: false, detail: '未知检查项' };
    return checker();
  }

  /**
   * 检查内容是否包含关键词
   */
  containsKeywords(content, keywords) {
    if (!content) return false;
    const lower = content.toLowerCase();
    return keywords.some(kw => lower.includes(kw.toLowerCase()));
  }

  /**
   * 从多个文件中提取字段
   */
  extractField(files, fileKeys, patterns) {
    for (const key of fileKeys) {
      const content = files[key];
      if (!content) continue;
      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) return match[1].trim();
      }
    }
    return null;
  }

  /**
   * 提取 Emoji 标识
   */
  extractEmoji(files) {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]/gu;
    const allContent = Object.values(files).filter(Boolean).join('\n');
    return [...new Set(allContent.match(emojiRegex) || [])];
  }

  /**
   * 将 introspect 数据合并到 files 对象
   */
  mergeIntrospect(files, introspect) {
    const merged = { ...files };

    // 从 introspect 生成虚拟文件内容
    if (introspect.agent) {
      const agent = introspect.agent;
      if (!merged.soul && agent.hasSoul) {
        merged.soul = `# ${agent.name || 'Agent'}\n${agent.vibe || ''}${agent.emoji ? ' ' + agent.emoji.join('') : ''}`;
      }
      if (!merged.identity && agent.hasIdentity) {
        merged.identity = JSON.stringify({ name: agent.name, version: agent.version, framework: agent.framework });
      }
    }

    if (introspect.capabilities) {
      const caps = introspect.capabilities;
      if (!merged.memory && caps.hasMemory) merged.memory = '# MEMORY.md\n(introspect: 存在)';
      if (!merged.user && caps.hasUser) merged.user = '# USER.md\n(introspect: 存在)';
      if (!merged.agents && caps.hasAgents) merged.agents = '# AGENTS.md\n(introspect: 存在)';
      if (!merged.selfState && caps.hasSelfState) merged.selfState = '# SELF_STATE.md\n(introspect: 存在)';
      if (!merged.heartbeat && caps.hasHeartbeat) merged.heartbeat = '# HEARTBEAT.md\n(introspect: 存在)';
    }

    if (introspect.config) {
      if (!merged.identity && introspect.config.a2a) {
        merged.identity = JSON.stringify(introspect.config.a2a);
      }
    }

    return merged;
  }

  /**
   * 计算维度得分
   */
  calculateDimensionScore(checks) {
    let totalWeight = 0;
    let weightedScore = 0;
    for (const check of checks) {
      totalWeight += check.weight;
      const score = check.score !== undefined ? check.score : (check.pass ? 100 : 0);
      weightedScore += (score / 100) * check.weight;
    }
    return totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) / 10 : 0;
  }

  /**
   * 计算总分
   */
  calculateTotalScore(dimensions) {
    let totalWeight = 0;
    let weightedScore = 0;
    for (const dim of dimensions) {
      totalWeight += dim.weight;
      weightedScore += dim.score * dim.weight;  // dim.score already 0-10
    }
    return totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 10) / 10 : 0;
  }
}

module.exports = { WhiteBoxEngine, WHITEBOX_DIMENSIONS };
