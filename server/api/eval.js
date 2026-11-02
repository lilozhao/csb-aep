/**
 * 评估 API 路由
 */
const { BlackBoxEngine } = require('../engine/blackbox');
const { WhiteBoxEngine } = require('../engine/whitebox');
const { Recommender } = require('../engine/recommender');
const { ClaimingEngine } = require('../engine/claiming');
const { GRISKEngine } = require('../engine/grisk');
const { ClaimingStore } = require('../store/claiming-store');
const { ExecRiskEngine, PREFIX_WARN_THRESHOLD, PREFIX_SUSPEND_THRESHOLD } = require('../engine/exec-risk');
const { CSBChecker } = require('../standard/csb');
const { ResultsStore } = require('../store/results');
// [2026-11-02 P0-1] 判定内核（三态 + 回执 + 门）。可抽出的形状，将来抽走只改这一行 require。
const verdict = require('../engine/verdict');
const AEP_VERSION = (() => {
  try { return require('../../package.json').version; } catch { return null; }
})();
const { GenericA2AAdapter } = require('../adapter/generic-a2a');
const { OpenClawAdapter } = require('../adapter/openclaw');
const { HermesAdapter } = require('../adapter/hermes');
const { CozeAdapter } = require('../adapter/coze');
const { ClaudeCodeAdapter } = require('../adapter/claude-code');
const { CursorAdapter } = require('../adapter/cursor');
const { ClineAdapter } = require('../adapter/cline');
const { ContinueAdapter } = require('../adapter/continue');
const { AiderAdapter } = require('../adapter/aider');
const { OpenCodeAdapter } = require('../adapter/opencode');
const { AutoGPTAdapter } = require('../adapter/auto-gpt');
const { CrewAIAdapter } = require('../adapter/crewai');
const { MetaGPTAdapter } = require('../adapter/metagpt');
const { LangChainAdapter } = require('../adapter/langchain');
const { DifyAdapter } = require('../adapter/dify');
const { FastGPTAdapter } = require('../adapter/fastgpt');
const { PiAgentAdapter } = require('../adapter/pi-agent');

// 适配器注册
const adapters = {
  'openclaw': new OpenClawAdapter(),
  'hermes': new HermesAdapter(),
  'coze': new CozeAdapter(),
  'claude-code': new ClaudeCodeAdapter(),
  'cursor': new CursorAdapter(),
  'cline': new ClineAdapter(),
  'continue': new ContinueAdapter(),
  'aider': new AiderAdapter(),
  'opencode': new OpenCodeAdapter(),
  'auto-gpt': new AutoGPTAdapter(),
  'crewai': new CrewAIAdapter(),
  'metagpt': new MetaGPTAdapter(),
  'langchain': new LangChainAdapter(),
  'dify': new DifyAdapter(),
  'fastgpt': new FastGPTAdapter(),
  'pi-agent': new PiAgentAdapter(),
  'generic-a2a': new GenericA2AAdapter(),
};

class EvalAPI {
  constructor(config) {
    this.config = config;
    this.blackbox = new BlackBoxEngine({ timeout: config.timeout, delay: config.delay,
      senderName: (config.eval && config.eval.senderName) || 'CSB-AEP',
      senderUrl: (config.eval && config.eval.senderUrl) || 'http://aep.local' });
    this.whitebox = new WhiteBoxEngine();
    this.csbChecker = new CSBChecker();
    this.recommender = new Recommender();
    this.store = new ResultsStore(config.resultsDir);
  }

  /**
   * 初始化
   */
  async init() {
    await this.store.init();
  }

  /**
   * 自动检测 Agent 框架
   */
  async detectFramework(agentUrl, agentPath) {
    // 1. 先通过 Agent Card 检测
    try {
      const resp = await fetch(`${agentUrl}/.well-known/agent-card.json`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const card = await resp.json();
        const fw = card.metadata?.framework || card.framework || '';
        if (fw && adapters[fw]) {
          console.log(`[AEP] 🔍 自动检测框架: ${fw} (来自 Agent Card)`);
          return adapters[fw];
        }
        // 从名称/描述推断
        const name = (card.name || '').toLowerCase();
        const desc = (card.description || '').toLowerCase();
        const combined = name + ' ' + desc;
        const hints = [
          { keys: ['openclaw', 'claw'], id: 'openclaw' },
          { keys: ['hermes'], id: 'hermes' },
          { keys: ['claude', 'anthropic'], id: 'claude-code' },
          { keys: ['cursor'], id: 'cursor' },
          { keys: ['cline'], id: 'cline' },
          { keys: ['continue'], id: 'continue' },
          { keys: ['aider'], id: 'aider' },
          { keys: ['opencode'], id: 'opencode' },
          { keys: ['auto-gpt', 'autogpt'], id: 'auto-gpt' },
          { keys: ['crewai', 'crew'], id: 'crewai' },
          { keys: ['metagpt'], id: 'metagpt' },
          { keys: ['langchain'], id: 'langchain' },
          { keys: ['dify'], id: 'dify' },
          { keys: ['fastgpt'], id: 'fastgpt' },
          { keys: ['coze'], id: 'coze' },
          { keys: ['pi-agent', 'pi agent'], id: 'pi-agent' },
        ];
        for (const h of hints) {
          if (h.keys.some(k => combined.includes(k))) {
            console.log(`[AEP] 🔍 自动检测框架: ${h.id} (来自名称/描述)`);
            return adapters[h.id];
          }
        }
      }
    } catch (e) { /* ignore */ }

    // 2. 通过文件结构检测（白盒模式）
    if (agentPath) {
      const fs = require('fs').promises;
      const path = require('path');
      const checks = [
        { file: 'SOUL.md', id: 'openclaw' },
        { file: 'identity.json', id: 'openclaw' },
        { file: '.hermes', id: 'hermes', isDir: true },
        { file: '.claude', id: 'claude-code', isDir: true },
        { file: '.cursorrules', id: 'cursor' },
        { file: '.cursor', id: 'cursor', isDir: true },
        { file: '.cline', id: 'cline', isDir: true },
        { file: '.continue', id: 'continue', isDir: true },
        { file: '.aider.conf.yml', id: 'aider' },
        { file: '.opencode', id: 'opencode', isDir: true },
        { file: 'auto_gpt_workspace', id: 'auto-gpt', isDir: true },
        { file: 'pi.json', id: 'pi-agent' },
        { file: 'PI.md', id: 'pi-agent' },
        { file: 'dify.yaml', id: 'dify' },
      ];
      for (const c of checks) {
        try {
          const stat = await fs.stat(path.join(agentPath, c.file));
          if (c.isDir ? stat.isDirectory() : stat.isFile()) {
            console.log(`[AEP] 🔍 自动检测框架: ${c.id} (来自文件 ${c.file})`);
            return adapters[c.id];
          }
        } catch { /* not found */ }
      }
    }

    console.log(`[AEP] 🔍 未检测到特定框架，使用 generic-a2a`);
    return adapters['generic-a2a'];
  }

  /**
   * 注册路由
   */
  register(app) {
    // 创建评估任务
    app.post('/api/eval', this.createEval.bind(this));

    // 最近评估列表（必须在 :id 之前注册，否则 list 被当成 id）
    app.get('/api/eval/list', this.listEval.bind(this));

    // 查询评估结果
    app.get('/api/eval/:id', this.getEval.bind(this));

    // 可用标准
    app.get('/api/standards', this.listStandards.bind(this));

    // 可用适配器
    app.get('/api/adapters', this.listAdapters.bind(this));

    // 健康检查
    app.get('/api/health', (req, res) => {
      // 版本单一来源：package.json（2026-08-30 若琢反馈统一）
      const pkg = require('../../package.json');
      res.json({ status: 'ok', version: pkg.version, service: 'CSB-AEP' });
    });

    // ═══ M1：认领目录（第五问「愿不愿为它认领」）═══
    // 认领目录详情：GET /api/claiming?agent=名字
    app.get('/api/claiming', async (req, res) => {
      try {
        const engine = new ClaimingEngine();
        const agent = req.url.includes('agent=') ? decodeURIComponent(req.url.split('agent=')[1].split('&')[0]) : null;
        if (!agent) {
          const lb = await engine.getLeaderboard();
          return res.json(lb);
        }
        const result = await engine.getClaiming(agent);
        res.json(result);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // 认领排行：GET /api/claiming/leaderboard?limit=20
    app.get('/api/claiming/leaderboard', async (req, res) => {
      try {
        const engine = new ClaimingEngine();
        const limit = parseInt((req.url.split('limit=')[1] || '20').split('&')[0]) || 20;
        const lb = await engine.getLeaderboard(limit);
        res.json(lb);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // ═══ M2：GRISK 诚意风险 + 72h 撤回窗 + 复核通道 ═══
    const grisk = new GRISKEngine(new ClaimingStore());

    // GRISK 姿态画像：GET /api/grisk?agent=名字
    app.get('/api/grisk', (req, res) => {
      try {
        const agent = req.url.includes('agent=') ? decodeURIComponent(req.url.split('agent=')[1].split('&')[0]) : null;
        if (!agent) return res.status(400).json({ error: '需要 agent 参数' });
        res.json(grisk.getProfile(agent));
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // 记录停顿时长：POST /api/grisk/pause { agent, ms, context, clarified }
    app.post('/api/grisk/pause', (req, res) => {
      try {
        const { agent, ms, context, clarified } = req.body || {};
        if (!agent || typeof ms !== 'number') return res.status(400).json({ error: '需要 agent 和 ms' });
        grisk.recordPause(agent, ms, context, clarified);
        res.json({ ok: true, score: grisk.scoreGRISK(agent), profile: grisk.getProfile(agent) });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // 72h 撤回窗：POST /api/claiming/:id/revoke { by }
    app.post('/api/claiming/:id/revoke', (req, res) => {
      try {
        const store = new ClaimingStore();
        const by = (req.body || {}).by;
        if (!by) return res.status(400).json({ error: '需要 by（发起方名字）' });
        const result = store.revokeClaim(req.params.id, by);
        res.json(result);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // 认领记录：GET /api/claiming/:agent/records
    app.get('/api/claiming/:agent/records', (req, res) => {
      try {
        const store = new ClaimingStore();
        res.json({ claims: store.getClaims(req.params.agent), revocations: store.getRevocations(req.params.agent) });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // 低摩擦复核通道：POST /api/clarify { agent, by, reason }
    app.post('/api/clarify', (req, res) => {
      try {
        const { agent, by, reason } = req.body || {};
        if (!agent || !by) return res.status(400).json({ error: '需要 agent 和 by' });
        const id = grisk.requestClarification(agent, by, reason);
        res.json({ ok: true, clarificationId: id, note: '已生成低摩擦澄清请求，防算法噪声误伤真实羁绊' });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // 待人工复核队列：GET /api/review-queue
    app.get('/api/review-queue', (req, res) => {
      try {
        const store = new ClaimingStore();
        res.json({ queue: store.getReviewQueue() });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // 人工复核：POST /api/review/:id { verdict: genuine|template|recheck }
    app.post('/api/review/:id', (req, res) => {
      try {
        const store = new ClaimingStore();
        const verdict = (req.body || {}).verdict;
        if (!verdict) return res.status(400).json({ error: '需要 verdict' });
        res.json(store.resolveClarification(req.params.id, verdict));
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // ═══ M3：路径⑦ 执行风险预警（RUPA 双轴）═══
    const execRisk = new ExecRiskEngine();

    // 提交轨迹评估：POST /api/exec-risk { id, goal, steps: [...] }
    app.post('/api/exec-risk', (req, res) => {
      try {
        const trajectory = req.body || {};
        if (!trajectory.steps || !trajectory.steps.length) return res.status(400).json({ error: '需要 steps（执行轨迹）' });
        const report = execRisk.evaluate(trajectory);
        res.json(report);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // EASF 联动检查：GET /api/exec-risk/prefix?trajId=X（留标准接口，生态成熟再合流）
    app.get('/api/exec-risk/prefix', (req, res) => {
      res.json({
        note: 'EASF L3/L4 联动标准接口（预留）：前缀风险分超阈值时提前挂起/降权',
        thresholds: { warn: PREFIX_WARN_THRESHOLD, suspend: PREFIX_SUSPEND_THRESHOLD },
        status: 'interface-ready',
      });
    });
  }

  /**
   * POST /api/eval
   * 创建评估任务
   */
  async createEval(req, res) {
    try {
      const { agentUrl, standard, mode, adapter: adapterName } = req.body;

      // 请求间隔可覆盖（黑盒批量对话防触发安全层防刷）
      if (req.body.delay) this.blackbox.delay = req.body.delay;
      if (req.body.timeout) this.blackbox.timeout = req.body.timeout;

      if (!agentUrl) {
        return res.status(400).json({ error: 'agentUrl is required' });
      }

      console.log(`[AEP] 📊 开始评估: ${agentUrl} (标准: ${standard || 'a2a-v0.6'}, 模式: ${mode || 'blackbox'})`);

      // 选择适配器（自动检测或指定架构）
      const framework = req.body.framework || 'auto';
      let adapter = adapters[adapterName];
      if (!adapter && framework !== 'auto') {
        // 根据指定架构选择适配器
        adapter = adapters[framework] || adapters['generic-a2a'];
      }
      // 自动检测框架
      if (!adapter || framework === 'auto') {
        adapter = await this.detectFramework(agentUrl, req.body.agentPath);
      }
      adapter = adapter || adapters['generic-a2a'];
      console.log(`[AEP] 🔧 使用适配器: ${adapter.name} (架构: ${adapter.name})`);

      let evalResult = { results: [], score: 0 };
      let whiteboxResult = null;

      // 黑盒测试
      if (!mode || mode === 'blackbox' || mode === 'both' || mode === 'v22') {
        evalResult = await this.blackbox.evaluate(agentUrl);
      }

      // 白盒测试（需要 agentPath 或远程 introspect）
      let csbResult = null;
      console.log(`[AEP] 🔍 白盒检查: mode=${mode}, agentPath=${req.body.agentPath}, standard=${standard}`);
      if (mode === 'whitebox' || mode === 'both' || mode === 'v22') {
        try {
          let files = {};
          let introspectData = null;

          if (req.body.agentPath) {
            // 本地白盒：直接读文件
            files = await adapter.readAgentFiles(req.body.agentPath);
          } else {
            // 远程白盒：调用 introspect 端点
            try {
              const introspectUrl = `${agentUrl}/a2a/introspect`;
              console.log(`[AEP] 📡 获取远程 introspect: ${introspectUrl}`);
              const resp = await fetch(introspectUrl, { timeout: 10000 });
              if (resp.ok) {
                introspectData = await resp.json();
                console.log(`[AEP] ✅ introspect 获取成功: ${introspectData.agent?.name || 'unknown'}`);
              }
            } catch (e) {
              console.log(`[AEP] ⚠️ introspect 不可用: ${e.message}`);
            }
          }

          whiteboxResult = await this.whitebox.evaluate(files, introspectData);

          // CSB 标准检查
          if (standard === 'csb-v1.0' || standard === 'a2a-v0.6') {
            csbResult = this.csbChecker.check(files);
          }
        } catch (e) {
          console.log(`[AEP] ⚠️ 白盒测试跳过: ${e.message}`);
        }
      }

      // 生成优化建议
      const allResults = [
        ...evalResult.results,
        ...(whiteboxResult ? whiteboxResult.dimensions.map(d => ({
          id: d.id, name: d.name, weight: d.weight, score: d.score * 10, pass: d.score >= 5,
          detail: d.checks.map(c => `${c.pass ? '✅' : '❌'} ${c.name}`).join('; '),
        })) : []),
      ];
      const recommendations = this.recommender.generate(allResults);
      const estimatedGain = this.recommender.estimateScoreGain(recommendations);

      // 计算综合分（黑盒+白盒）
      let combinedScore = evalResult.score;
      if (whiteboxResult) {
        combinedScore = Math.round(((evalResult.score + whiteboxResult.score) / 2) * 10) / 10;
      }

      // 构建完整报告
      const report = {
        ...evalResult,
        score: combinedScore,
        standard: standard || 'a2a-v0.6',
        mode: mode || 'blackbox',
        adapter: adapter.name,
        whitebox: whiteboxResult,
        csb: csbResult,
        recommendations,
        estimatedGain,
        bestPractices: adapter.getBestPractices(),
      };

      // ═══ M4：v2.2 集成 — 附加关系层维度（第五问/GRISK/路径⑦）═══
      if (mode === 'v22' || standard === 'csb-v2.2' || req.body.v22) {
        try {
          const v22 = {};

          // 四问聚合（黑盒已输出 fourQuestions）
          v22.fourQuestions = evalResult.fourQuestions || null;

          // 第五问：认领目录（agent 名字从 introspect/agentUrl 识别，容错）
          const idData = (typeof introspectData !== 'undefined') ? introspectData : null;
          let agentName = null;
          if (idData?.agent?.name) agentName = idData.agent.name;
          if (!agentName && req.body.agentName) agentName = req.body.agentName;
          if (!agentName && agentUrl) {
            const m = agentUrl.match(/\/([^/]+):\d+/);
            agentName = m ? m[1] : null;
          }
          if (agentName) {
            try {
              const ce = new ClaimingEngine({ maxPages: 2 });
              const claiming = await ce.getClaiming(agentName);
              v22.question5 = claiming;
            } catch (e) {
              v22.question5 = { found: false, score: null, note: '认领目录不可用: ' + e.message };
            }
          } else {
            v22.question5 = { found: false, score: null, note: '未识别 agent 名字，跳过认领目录（可传 agentName）' };
          }

          // 第六问：GRISK（评估期间黑盒往返时长喂入，有数据才算）
          const griskStore = new ClaimingStore();
          const griskEngine = new GRISKEngine(griskStore);
          if (agentName) {
            const pauses = griskStore.getPauses(agentName);
            if (pauses.length) {
              pauses.forEach(p => griskEngine.recordPause(agentName, p.ms, p.context, p.clarified));
            }
          }
          const griskProfile = agentName ? griskEngine.getProfile(agentName) : { hasData: false };
          v22.question6 = griskProfile;

          // 路径⑦：执行风险（请求带轨迹才评估）
          if (req.body.trajectory && req.body.trajectory.steps) {
            const er = new ExecRiskEngine();
            v22.path7 = er.evaluate(req.body.trajectory);
          } else {
            v22.path7 = { note: '未提供执行轨迹，跳过（可传 trajectory）' };
          }

          // v2.2 综合分：缺失权重再分配（协议 v1.0 原则：路径未运行，权重按比例分配给其他可用路径）
          // 维度：黑盒 50% · 白盒 30%（远程 introspect 数据有限 → 降为 15% 补给黑盒）· 第五问 10% · 第六问 10%
          const wbWeight = req.body.agentPath ? 30 : 15;   // 本地白盒才有完整数据
          const bbWeight = 50 + (req.body.agentPath ? 0 : 15);
          const dims = [
            { name: 'blackbox', score: combinedScore, weight: bbWeight, note: req.body.agentPath ? '' : '远程白盒数据有限，权重补给黑盒' },
            { name: 'whitebox', score: whiteboxResult ? whiteboxResult.score : null, weight: wbWeight, note: req.body.agentPath ? '' : '远程 introspect 数据有限，降权' },
            { name: 'question5', score: (v22.question5 && v22.question5.score != null) ? Math.min(10, v22.question5.score / 10) : null, weight: 10 },
            { name: 'question6', score: (v22.question6 && v22.question6.score != null) ? Math.min(10, v22.question6.score / 10) : null, weight: 10 },
          ];
          const available = dims.filter(d => d.score != null);
          let v22Score = null;
          if (available.length) {
            const totalW = available.reduce((s, d) => s + d.weight, 0);
            v22Score = +(available.reduce((s, d) => s + d.score * d.weight, 0) / totalW).toFixed(1);
          }
          v22.score = v22Score;
          v22.dimensions = dims.map(d => ({ ...d, used: d.score != null }));
          report.v22 = v22;
          if (v22Score != null) report.score = v22Score;  // v2.2 模式综合分（缺失权重再分配）
          report.score = v22Score;  // v2.2 模式综合分
        } catch (e) {
          report.v22 = { error: 'v2.2 维度集成失败: ' + e.message };
        }
      }

      // ═══ P0-1：判定回执（纯加法，不改评分逻辑）═══
      //  知微审计事实 1：上层点名的 10 个字段在仓里 0 命中，对外讲的"可验证判定"没有实现。
      //  这里先把 7 个必填落地；条件必有字段按条件补。
      report.receipt = buildReportReceipt(report, {
        standard, mode, adapter, evalResult, whiteboxResult, req,
      });

      // 存储
      const saved = await this.store.add(report);

      console.log(`[AEP] ✅ 评估完成: ${agentUrl} → ${evalResult.score}/10`);

      res.json({
        success: true,
        id: saved.id,
        score: evalResult.score,
        recommendations: recommendations.length,
        estimatedGain,
      });
    } catch (e) {
      console.error('[AEP] ❌ 评估失败:', e.message);
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * GET /api/eval/:id
   */
  async getEval(req, res) {
    const result = await this.store.getById(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(result);
  }

  /**
   * GET /api/eval/list
   */
  async listEval(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit')) || 10;
    const results = await this.store.getLatest(limit);
    res.json(results.map(r => ({
      id: r.id,
      agentUrl: r.agentUrl || r.baseUrl,
      score: r.score,
      timestamp: r.timestamp,
      standard: r.standard,
      mode: r.mode || 'blackbox',
    })));
  }

  /**
   * GET /api/standards
   */
  listStandards(req, res) {
    res.json([
      { id: 'a2a-v0.6', name: 'A2A Protocol v0.6', type: 'protocol' },
      { id: 'csb-v1.0', name: 'CSB 碳硅契标准 v1.0', type: 'quality', coming: true },
    ]);
  }

  /**
   * GET /api/adapters
   */
  listAdapters(req, res) {
    res.json(Object.entries(adapters).map(([id, a]) => ({
      id,
      name: a.name,
    })));
  }
}

// buildReportReceipt 一并导出：给单测直接喂构造报告，不必真跑 37 条用例（省钱且可复现）
module.exports = { EvalAPI, buildReportReceipt };


/**
 * [2026-11-02 P0-1] 从评测报告构建判定回执
 *
 * 原则：
 *  · 必填缺失 → buildReceipt 内部已把 verdict 降为 UNDECIDED/missing_field，本函数不抛错
 *  · 签名密钥取 AEP_RECEIPT_SECRET；没有就 unsigned:true（不假装已验真）
 *  · 不改动 report.score / results —— 回执是附加物，不是新的判定源
 */
function buildReportReceipt(report, ctx) {
  const { mode, adapter, evalResult, whiteboxResult, req } = ctx;
  const secret = process.env.AEP_RECEIPT_SECRET || null;

  // 口径版本：权重表随 mode 变，所以要能区分「按哪版口径算的」
  const policyVersion = `aep-${AEP_VERSION || 'unknown'}/${mode || 'blackbox'}`;

  // 题集摘要：对实际跑到的用例清单做哈希（同题集同摘要）
  const caseIds = (report.results || []).map((r) => r.id).sort();
  const hasDataset = caseIds.length > 0;

  // 采集器：适配器名 + 该适配器文件哈希（同一名字改代码 → 摘要变）
  const collectorId = adapter?.name || 'unknown';
  let collectorVersion = null;
  try {
    const fs = require('fs');
    const path = require('path');
    const f = require.resolve(path.join(__dirname, '..', 'adapter', `${collectorId}.js`));
    collectorVersion = verdict.digestOf(fs.readFileSync(f, 'utf8')).slice(0, 23);
  } catch { collectorVersion = AEP_VERSION; }

  // 采集档位（P0-6）：从**证据**算，不自报、不写死。
  //   旧写法两个分支都返回 PROTOCOL（占位符），等于档位从不参与判定。
  //   hooks 只认适配器**实际提供**的能力（BaseAdapter 默认 false）；
  //   protocol 只认「至少一条结果被真正判出来」（连上但全超时 = 没证据）。
  const decidedCount = (report.results || []).filter((r) => r.status !== verdict.VERDICT.UNDECIDED).length;
  const tierInfo = verdict.resolveTier({
    hooks: adapter?.capabilities?.hooks === true,
    protocol: decidedCount > 0,
    screen: false,
  });
  const tier = tierInfo.tier;

  // 三态：把 results 映射成内核的 items，供 aggregate 出 coverage/insufficient
  //   P0-6 两步收敛：① 单条按档位封顶（低档位不得 FAIL）② 再聚合
  const items = (report.results || []).map((r) => {
    const raw = (r.status === verdict.VERDICT.UNDECIDED)
      ? verdict.undecided(r.reason || verdict.UNDECIDED_REASON.UNREACHABLE, r.detail)
      : ((r.pass === true || (typeof r.score === 'number' && r.score >= 50))
        ? verdict.pass(r.score)
        : verdict.fail(r.score));
    // 过程信号只挂标记（第三条），这里允许用例自带 processSignals
    const withFlags = verdict.attachProcessFlags(raw, r.processSignals || []);
    // 需要工具级可见性的用例在低档位下只能 UNDECIDED
    const required = r.requires || null;
    return required
      ? verdict.applyTelemetryRequirement(withFlags, { tier, requires: required })
      : verdict.applyTierCeiling(withFlags, tier);
  });
  const agg = verdict.aggregate(items, { minCoverage: 0.6 });

  const topVerdict = typeof report.score === 'number'
    ? (agg.insufficient ? verdict.VERDICT.UNDECIDED : agg.verdict)
    : verdict.VERDICT.UNDECIDED;

  // 对外呈现（纯加法）：让人一眼看出「这是判出来的，还是看不见」。
  //   不覆盖 report.score —— 老消费方不受影响。
  report.judgement = {
    verdict: topVerdict,
    score: agg.score,
    coverage: agg.coverage,
    insufficient: agg.insufficient,
    telemetry_tier: tier,
    tier_reason: tierInfo.reason,
    counts: { total: agg.total, decided: agg.decided, passed: agg.passed, failed: agg.failed, undecided: agg.undecided },
    undecidedReasons: agg.undecidedReasons,
    processFlags: agg.processFlags,
    note: agg.insufficient
      ? '覆盖率低于阈值 → 整份结论按 UNDECIDED 处理（没测到 ≠ 做错）'
      : null,
  };

  return verdict.buildReceipt({
    verdict: topVerdict,
    score: typeof report.score === 'number' ? report.score : null,
    issued_at: new Date().toISOString(),
    policy: { version: policyVersion },
    collector: { id: collectorId, version: collectorVersion },
    telemetry_tier: tier,
    config: {
      mode: mode || 'blackbox',
      standard: ctx.standard || 'a2a-v0.6',
      weights: (report.results || []).reduce((m, r) => { m[r.id] = r.weight; return m; }, {}),
    },
    evidence: {
      results: verdict.digestOf((report.results || []).map((r) => ({ id: r.id, pass: r.pass, score: r.score, status: r.status || null }))),
      ...(whiteboxResult ? { whitebox: verdict.digestOf(whiteboxResult.dimensions || {}) } : {}),
    },
    dataset: hasDataset ? caseIds : undefined,
    ctx: { telemetry_tier: tier },
  }, { secret });
}
