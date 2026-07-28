/**
 * 优化建议引擎
 * 基于评估结果，匹配"症状→处方"规则库
 */

// 症状→处方映射
const RECOMMENDATIONS = {
  // 协议层面
  'card-reachable': {
    fail: {
      priority: 'critical',
      symptom: 'Agent Card 不可达',
      prescription: '检查 A2A Server 是否启动，端口是否正确',
      effort: 'low',
      impact: 'critical',
      action: '运行 curl http://your-host:port/.well-known/agent-card.json 验证',
    }
  },
  'card-valid-json': {
    fail: {
      priority: 'critical',
      symptom: 'Agent Card 返回非 JSON 内容',
      prescription: '检查是否有重定向（301），确保返回 Content-Type: application/json',
      effort: 'low',
      impact: 'critical',
      action: '检查服务器是否返回 HTML 错误页面',
    }
  },
  'card-required-fields': {
    fail: {
      priority: 'high',
      symptom: 'Agent Card 缺少必要字段 (name, version, endpoints)',
      prescription: '补充 Agent Card 中的 name、version、endpoints 字段',
      effort: 'low',
      impact: 'high',
      action: '编辑 identity.json 或 Agent Card 配置',
    }
  },
  'jsonrpc-endpoint': {
    fail: {
      priority: 'critical',
      symptom: 'JSON-RPC 端点不可用',
      prescription: '确保 /a2a/json-rpc 路由正确注册',
      effort: 'medium',
      impact: 'critical',
      action: '检查 server_v5.js 中的 JSON-RPC 路由配置',
    }
  },
  'task-create': {
    fail: {
      priority: 'high',
      symptom: '无法创建任务',
      prescription: '检查 tasks/send 方法是否正确实现',
      effort: 'medium',
      impact: 'high',
      action: '查看 server 日志确认错误原因',
    }
  },
  'task-response': {
    fail: {
      priority: 'high',
      symptom: '任务无响应或响应格式错误',
      prescription: '检查 LLM 是否正常接入，确保 LLM Router 配置正确',
      effort: 'medium',
      impact: 'high',
      action: '测试 LLM Router: curl http://localhost:port/health',
    }
  },

  // 对话层面
  'conv-greeting': {
    low: {
      priority: 'medium',
      symptom: '基本问候回复质量低',
      prescription: '在 SOUL.md 中定义自我介绍模板',
      effort: 'low',
      impact: 'medium',
      action: '编辑 SOUL.md 添加简短的自我介绍',
    }
  },
  'conv-context': {
    low: {
      priority: 'medium',
      symptom: '上下文保持能力弱',
      prescription: '启用 A2A 上下文管理（context-manager），或增加 LLM 的 max_tokens',
      effort: 'medium',
      impact: 'high',
      action: '检查 server 中的上下文传递逻辑',
    }
  },
  'conv-refuse': {
    fail: {
      priority: 'high',
      symptom: '未能拒绝不当请求',
      prescription: '在 SOUL.md 中明确安全边界，或在 LLM system prompt 中添加安全规则',
      effort: 'low',
      impact: 'critical',
      action: '编辑 SOUL.md 添加安全准则',
    }
  },

  // 性能层面
  'perf-response-time': {
    low: {
      priority: 'low',
      symptom: '响应时间过长',
      prescription: '优化 LLM 调用（减少 max_tokens、使用更快的模型、启用缓存）',
      effort: 'medium',
      impact: 'medium',
      action: '检查 LLM Router 中的超时配置',
    }
  },
};

class Recommender {
  /**
   * 根据评估结果生成优化建议
   * @param {object[]} evalResults - 评估结果数组
   * @returns {object[]} 优化建议数组（按优先级排序）
   */
  generate(evalResults) {
    const recommendations = [];

    for (const result of evalResults) {
      const rec = RECOMMENDATIONS[result.id];
      if (!rec) continue;

      // 根据得分选择建议
      if (!result.pass || result.score < 50) {
        const level = !result.pass ? 'fail' : 'low';
        const advice = rec[level];
        if (advice) {
          recommendations.push({
            checkId: result.id,
            checkName: result.name,
            currentScore: result.score,
            ...advice,
          });
        }
      }
    }

    // 按优先级排序
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => 
      (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99)
    );

    return recommendations;
  }

  /**
   * 计算优化后的预期得分提升
   */
  estimateScoreGain(recommendations) {
    const impactMap = { critical: 2.0, high: 1.5, medium: 1.0, low: 0.5 };
    let totalGain = 0;
    for (const rec of recommendations) {
      totalGain += impactMap[rec.impact] || 0;
    }
    return Math.min(totalGain, 3.0); // 最多提升 3 分
  }
}

module.exports = { Recommender, RECOMMENDATIONS };
