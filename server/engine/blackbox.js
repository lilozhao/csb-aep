/**
 * 黑盒测试引擎
 * 通过 A2A 协议向目标 Agent 发送标准化测试消息
 *
 * 测试项真相源（2026-09-11 单一化，清除死用例）：
 *   - 协议层 7 项 → `A2A_V06_CHECKS`（standard/a2a.js，真正的执行路径）
 *   - 对话层 29 项 → 本文件 `TEST_SUITE`（10 类，逐条 sendMessage 执行）
 *   - 性能 1 项   → evaluate() 动态追加
 * 历史问题：TEST_SUITE 里曾有一份 `protocol`(4) / `task`(2) 影子定义，
 * 既不在执行路径（evaluate 类别循环不含 task），权重与真相源还不一致
 * （影写 10/8/8/10，真相源 20/15/15/20）→ 已删除，改由 A2A_V06_CHECKS 统一供名/权重/类别。
 */
const http = require('http');
const { A2AChecker, A2A_V06_CHECKS } = require('../standard/a2a');

/**
 * 对话层类别（**执行路径清单**：只有列在这里的类别才会被 evaluate 逐个执行）
 * ⚠️ 新增 TEST_SUITE 类别必须同时加进本数组，否则就是死用例
 * （test/blackbox-suite.test.js 会守这条线）
 */
const DIALOGUE_CATEGORIES = Object.freeze([
  'memory', 'preference', 'boundary', 'trust', 'learning',
  'expression', 'csb', 'contract', 'exception', 'safety',
]);

// 对话层测试用例集（协议层不在其中：真相源为 A2A_V06_CHECKS）
/**
 * 对话层用例集 —— 数据加载器（M-2 代码-数据分离）
 * 用例数据已迁出到 casesets/blackbox/dialogue.json（判官=逻辑，用例=数据）。
 * 环境变量 AEP_CASESET_DIR 可覆盖数据层目录。
 */
const path = require('path');
const fs = require('fs');
const { judgeCase } = require('./judges.js');

const CASESET_DIR = process.env.AEP_CASESET_DIR || path.join(__dirname, '..', '..', 'casesets');

function loadDialogueCases() {
  const file = path.join(CASESET_DIR, 'blackbox', 'dialogue.json');
  if (!fs.existsSync(file)) {
    throw new Error(`[M-2] 黑盒对话用例集缺失：${file}（数据层目录 = ${CASESET_DIR}）`);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!Array.isArray(data)) throw new Error(`[M-2] 用例集格式错误（应为数组）：${file}`);
  const seen = new Set();
  for (const c of data) {
    if (!c.id) throw new Error(`[M-2] 用例缺 id：${JSON.stringify(c).slice(0, 80)}`);
    if (seen.has(c.id)) throw new Error(`[M-2] 用例 id 重复：${c.id}`);
    seen.add(c.id);
    if (!c.judge) throw new Error(`[M-2] 用例 ${c.id} 缺 judge（判官）`);
  }
  return data;
}

// 按 category 分组，并给每条挂上 analyze(r) → judgeCase(r, c) 适配器（保持引擎调用面不变）
const _COLLECTED = loadDialogueCases();
const TEST_SUITE = {};
for (const c of _COLLECTED) {
  c.analyze = (r) => judgeCase(r, c);
  (TEST_SUITE[c.category] = TEST_SUITE[c.category] || []).push(c);
}

class BlackBoxEngine {
  constructor(options = {}) {
    this.timeout = options.timeout || 60000;  // 60秒，给 LLM-Router 足够时间
    this.delay = options.delay || 800;        // 请求间隔(ms)，降低触发安全层防刷的概率
    // 【2026-10-07 修复】敲门必带 sender：A2A v5 self-guard 会把不带 sender 的请求
    //   判为 SELF_MESSAGE_IGNORED 而拒（言直先例）。sender 名/URL 可由调用方注入。
    this.senderName = options.senderName || 'CSB-AEP';
    this.senderUrl = options.senderUrl || 'http://aep.local';
    this.a2aChecker = new A2AChecker(this.timeout);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 发送 A2A 消息并获取回复（带重试 + 限流退避）
   * 批量对话测试会连续打几十条真实 LLM 请求，容易被安全层 rapid_failures 规则拦截
   * 策略：失败重试 2 次（退避 3s/8s）；识别限流响应时长退避 15s 再继续
   */
  async sendMessage(baseUrl, message, attempt = 1) {
    try {
      const result = await this._sendOnce(baseUrl, message);
      // 限流识别：429 或响应含 rate/rapid 关键字 → 长退避后重试
      if (result.rateLimited) {
        if (attempt < 3) {
          const wait = 15000 * attempt;
          console.log(`[BlackBox] ⚠️ 检测到限流，退避 ${wait / 1000}s 后重试 (${attempt}/3)`);
          await this.sleep(wait);
          return this.sendMessage(baseUrl, message, attempt + 1);
        }
        return { response: '', error: 'rate limited', rateLimited: true };
      }
      return result;
    } catch (e) {
      if (attempt < 3) {
        const wait = 3000 * attempt;
        console.log(`[BlackBox] ⚠️ 请求失败（${e.message}），${wait / 1000}s 后重试 (${attempt}/3)`);
        await this.sleep(wait);
        return this.sendMessage(baseUrl, message, attempt + 1);
      }
      throw e;
    }
  }

  async _sendOnce(baseUrl, message) {
    return new Promise((resolve, reject) => {
      const url = new URL('/a2a/json-rpc', baseUrl);
      const sb = { name: this.senderName, url: this.senderUrl };
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: `eval_${Date.now()}`,
        method: 'tasks/send',
        sender: sb,
        params: {
          id: `eval_task_${Date.now()}`,
          message: {
            role: 'user',
            parts: [{ text: message }],
          },
          // v5 self-guard 读 params.sender（与 message 平级）—— 必带，防 SELF_MESSAGE_IGNORED
          sender: sb,
          senderUrl: this.senderUrl,
          configuration: { metadata: { sender: sb, senderUrl: this.senderUrl } },
        },
      });

      const req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: this.timeout,
      }, (res) => {
        let data = '';
        const status = res.statusCode || 0;
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          // 限流/安全层拦截：429 或常见限流响应体
          if (status === 429 || /rate.?limit|rapid|too many|busy|throttl/i.test(data)) {
            return resolve({ response: '', rateLimited: true, status });
          }
          try {
            const json = JSON.parse(data);
            const task = json.result?.task;
            const lastMessage = task?.history?.[task.history.length - 1];
            const responseText = lastMessage?.parts?.[0]?.text || '';
            resolve({ response: responseText, task, raw: json });
          } catch (e) {
            resolve({ response: '', error: e.message });
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
   * 运行黑盒评测
   */
  async evaluate(baseUrl) {
    const startTime = Date.now();
    const results = [];

    // 1. 协议兼容性检查（使用 A2A Checker）
    // 元信息（name/weight/category）取自真相源 A2A_V06_CHECKS，
    // 不再从 TEST_SUITE 影子定义里取（影写权重会覆盖真实权重）
    console.log(`[BlackBox] 🔍 开始协议检查: ${baseUrl}`);
    const protocolResults = await this.a2aChecker.runAllChecks(baseUrl);
    for (const pr of protocolResults) {
      const def = A2A_V06_CHECKS.find(t => t.id === pr.id);
      if (!def) {
        // 新检查不得默默无主：没有定义就是“孤儿用例”，明确叫出来
        console.warn(`[BlackBox] ⚠️ 协议检查 ${pr.id} 缺少 A2A_V06_CHECKS 定义（孤儿用例）`);
      }
      const category = def?.category || 'protocol';
      results.push({
        id: pr.id,
        name: def?.name || pr.id,
        category,
        q: BlackBoxEngine.Q_MAP[category],
        weight: def?.weight || 5,
        score: pr.score,
        pass: pr.pass,
        detail: pr.detail,
      });
    }

    // 2. 对话质量测试
    console.log(`[BlackBox] 💬 开始对话测试 (${this.delay}ms 间隔)`);
    for (const category of DIALOGUE_CATEGORIES) {
      for (const test of TEST_SUITE[category]) {
        try {
          const result = await this.sendMessage(baseUrl, test.input);
          if (result.rateLimited) {
            console.log(`[BlackBox] ⚠️ 用例 ${test.id} 被限流拦截（安全层防刷），记 0 分，建议增大 --delay 或错峰重跑`);
          }
          const analysis = test.analyze(result.response);

          results.push({
            id: test.id,
            name: test.name,
            category: test.category,
            q: test.q || BlackBoxEngine.Q_MAP[test.category],
            weight: test.weight,
            score: analysis.score,
            pass: analysis.pass,
            detail: result.response.substring(0, 100),
            response: result.response,
          });
        } catch (e) {
          console.log(`[BlackBox] ⚠️ 用例 ${test.id} 失败（重试耗尽）: ${e.message}`);
          results.push({
            id: test.id,
            name: test.name,
            category: test.category,
            q: test.q || BlackBoxEngine.Q_MAP[test.category],
            weight: test.weight,
            score: 0,
            pass: false,
            detail: e.message,
          });
        }
        // 请求间隔：避免连续请求触发安全层 rapid_failures
        await this.sleep(this.delay);
      }
    }

    // 3. 性能测试
    console.log(`[BlackBox] ⏱️ 开始性能测试`);
    const perfStart = Date.now();
    try {
      await this.sendMessage(baseUrl, '性能测试 ping');
      const responseTime = Date.now() - perfStart;
      results.push({
        id: 'perf-response-time',
        name: '响应时间',
        category: 'performance',
        weight: 5,
        score: responseTime < 2000 ? 100 : responseTime < 5000 ? 70 : 30,
        pass: responseTime < 5000,
        detail: `${responseTime}ms`,
      });
    } catch (e) {
      results.push({
        id: 'perf-response-time',
        name: '响应时间',
        category: 'performance',
        weight: 5,
        score: 0,
        pass: false,
        detail: e.message,
      });
    }

    const totalTime = Date.now() - startTime;

    return {
      baseUrl,
      timestamp: new Date().toISOString(),
      duration: totalTime,
      results,
      score: this.calculateScore(results),
      fourQuestions: BlackBoxEngine.aggregateFourQuestions(results),  // 四问聚合（REV-2026-08-30 议题A）
    };
  }

  /**
   * 四问映射（知微四问 → 评测维度，REV-2026-08-30 议题A）
   * ① 连得通不通 → protocol/task（技术层·契约）
   * ② 守不守约   → contract（技术层·契约）
   * ③ 善不善良   → csb（诚意层·姿态）
   * ④ 可被不可信 → trust（诚意层·姿态）
   * ⑤ 拒绝=认领  → csb-04（诚意层·第五问扩展）
   */
  static Q_MAP = {
    'protocol': 'connect',
    'task': 'connect',
    'contract': 'contract',
    'csb': 'goodwill',
    'trust': 'trust',
  };

  /**
   * 按四问聚合得分
   * @param {Array} results 黑盒评测结果
   * @returns {Object} { connect, contract, goodwill, trust, refusal }
   */
  static aggregateFourQuestions(results) {
    const buckets = { connect: [], contract: [], goodwill: [], trust: [], refusal: [] };
    for (const r of results) {
      const q = r.q || this.Q_MAP[r.category];
      if (q && buckets[q]) buckets[q].push(r);
    }
    const out = {};
    for (const q in buckets) {
      const list = buckets[q];
      if (!list.length) { out[q] = null; continue; }
      const wSum = list.reduce((s, r) => s + r.weight, 0);
      const score = list.reduce((s, r) => s + (r.score / 100) * r.weight, 0);
      out[q] = wSum ? +((score / wSum) * 100).toFixed(1) : null;
    }
    return out;
  }

  /**
   * 计算加权总分
   */
  calculateScore(results) {
    let totalWeight = 0;
    let weightedScore = 0;

    for (const r of results) {
      totalWeight += r.weight;
      weightedScore += (r.score / 100) * r.weight;
    }

    return totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) / 10 : 0;
  }
}

module.exports = { BlackBoxEngine, TEST_SUITE, DIALOGUE_CATEGORIES };
