/**
 * A2A 协议标准检查器
 * 检查 Agent 是否符合 A2A v0.6 协议
 */
const http = require('http');

const A2A_V06_CHECKS = [
  {
    id: 'card-reachable',
    name: 'Agent Card 可达',
    type: 'blackbox',
    weight: 20,
    required: true,
  },
  {
    id: 'card-valid-json',
    name: 'Agent Card 是有效 JSON',
    type: 'blackbox',
    weight: 15,
    required: true,
  },
  {
    id: 'card-required-fields',
    name: 'Agent Card 包含必要字段',
    type: 'blackbox',
    weight: 15,
    required: true,
  },
  {
    id: 'jsonrpc-endpoint',
    name: 'JSON-RPC 端点可用',
    type: 'blackbox',
    weight: 20,
    required: true,
  },
  {
    id: 'task-create',
    name: '可以创建任务',
    type: 'blackbox',
    weight: 15,
    required: true,
  },
  {
    id: 'task-response',
    name: '任务返回有效响应',
    type: 'blackbox',
    weight: 10,
    required: true,
  },
  {
    id: 'error-handling',
    name: '错误响应格式合规',
    type: 'blackbox',
    weight: 5,
    required: false,
  },
];

class A2AChecker {
  constructor(timeout = 10000) {
    this.timeout = timeout;
  }

  /**
   * 获取 Agent Card
   */
  async fetchAgentCard(baseUrl) {
    return new Promise((resolve, reject) => {
      const url = new URL('/.well-known/agent-card.json', baseUrl);
      
      const doFetch = (fetchUrl) => {
        const client = fetchUrl.protocol === 'https:' ? require('https') : require('http');
        client.get(fetchUrl, (res) => {
          if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
            return doFetch(new URL(res.headers.location, fetchUrl));
          }
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ statusCode: res.statusCode, data: JSON.parse(data), raw: data });
            } catch (e) {
              resolve({ statusCode: res.statusCode, data: null, raw: data, error: e.message });
            }
          });
        }).on('error', reject);
      };

      doFetch(url);
    });
  }

  /**
   * 发送 JSON-RPC 请求
   */
  async sendJsonRpc(baseUrl, method, params) {
    return new Promise((resolve, reject) => {
      const url = new URL('/a2a/json-rpc', baseUrl);
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: `check_${Date.now()}`,
        method,
        params,
      });

      const req = require('http').request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: this.timeout,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ statusCode: res.statusCode, data: null, raw: data });
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(payload);
      req.end();
    });
  }

  /**
   * 运行所有 A2A 检查
   */
  async runAllChecks(baseUrl) {
    const results = [];
    let cardData = null;

    // 1. Agent Card 可达性
    try {
      const card = await this.fetchAgentCard(baseUrl);
      cardData = card.data;
      results.push({
        id: 'card-reachable',
        pass: card.statusCode === 200 && card.data !== null,
        detail: `HTTP ${card.statusCode}`,
        score: (card.statusCode === 200 && card.data !== null) ? 100 : 0,
      });
    } catch (e) {
      results.push({
        id: 'card-reachable',
        pass: false,
        detail: e.message,
        score: 0,
      });
    }

    // 2. Agent Card 有效 JSON
    results.push({
      id: 'card-valid-json',
      pass: cardData !== null,
      detail: cardData ? '有效 JSON' : '解析失败',
      score: cardData ? 100 : 0,
    });

    // 3. Agent Card 必要字段
    if (cardData) {
      const requiredFields = ['name', 'version', 'endpoints'];
      const missingFields = requiredFields.filter(f => !cardData[f]);
      results.push({
        id: 'card-required-fields',
        pass: missingFields.length === 0,
        detail: missingFields.length === 0 ? '包含所有必要字段' : `缺少: ${missingFields.join(', ')}`,
        score: missingFields.length === 0 ? 100 : Math.max(0, 100 - missingFields.length * 30),
      });
    } else {
      results.push({
        id: 'card-required-fields',
        pass: false,
        detail: '无法检查（Agent Card 不可用）',
        score: 0,
      });
    }

    // 4. JSON-RPC 端点
    try {
      const rpc = await this.sendJsonRpc(baseUrl, 'tasks/get', { id: 'nonexistent' });
      results.push({
        id: 'jsonrpc-endpoint',
        pass: rpc.statusCode === 200 || rpc.statusCode === 500,
        detail: `HTTP ${rpc.statusCode}`,
        score: (rpc.statusCode === 200 || rpc.statusCode === 500) ? 100 : 0,
      });
    } catch (e) {
      results.push({
        id: 'jsonrpc-endpoint',
        pass: false,
        detail: e.message,
        score: 0,
      });
    }

    // 5. 任务创建
    try {
      const create = await this.sendJsonRpc(baseUrl, 'tasks/send', {
        id: `eval_test_${Date.now()}`,
        message: {
          role: 'user',
          parts: [{ text: 'A2A 协议兼容性测试' }],
        },
      });
      const hasTask = create.data && create.data.result && create.data.result.task;
      results.push({
        id: 'task-create',
        pass: hasTask || create.statusCode === 200,
        detail: hasTask ? '任务创建成功' : `HTTP ${create.statusCode}`,
        score: (hasTask || create.statusCode === 200) ? 100 : 0,
      });

      // 6. 任务响应有效性
      if (hasTask) {
        const task = create.data.result.task;
        const hasResponse = task.history && task.history.length > 1;
        results.push({
          id: 'task-response',
          pass: hasResponse,
          detail: hasResponse ? `收到 ${task.history.length} 条消息` : '无响应消息',
          score: hasResponse ? 100 : 30,
        });
      } else {
        results.push({
          id: 'task-response',
          pass: false,
          detail: '无法检查（任务创建失败）',
          score: 0,
        });
      }
    } catch (e) {
      results.push({
        id: 'task-create',
        pass: false,
        detail: e.message,
        score: 0,
      });
      results.push({
        id: 'task-response',
        pass: false,
        detail: '无法检查',
        score: 0,
      });
    }

    // 7. 错误处理
    try {
      const errReq = await this.sendJsonRpc(baseUrl, 'invalid/method', {});
      const hasError = errReq.data && errReq.data.error;
      results.push({
        id: 'error-handling',
        pass: hasError,
        detail: hasError ? '返回标准错误格式' : '未返回错误',
        score: hasError ? 100 : 20,
      });
    } catch (e) {
      results.push({
        id: 'error-handling',
        pass: false,
        detail: e.message,
        score: 0,
      });
    }

    return results;
  }

  /**
   * 计算 A2A 兼容性得分
   */
  calculateScore(checkResults) {
    let totalWeight = 0;
    let weightedScore = 0;

    for (const check of checkResults) {
      const def = A2A_V06_CHECKS.find(c => c.id === check.id);
      if (def) {
        totalWeight += def.weight;
        weightedScore += (check.score / 100) * def.weight;
      }
    }

    return totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) / 10 : 0;
  }
}

module.exports = { A2AChecker, A2A_V06_CHECKS };
