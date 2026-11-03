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
// [2026-11-03 P2-2] 路径②互评（五路径补齐第一步：唯一不需要答案键的路径）
const { MutualEngine } = require('../engine/mutual');
// [2026-11-03 P2-2] 路径③④⑤：行为考古 / 结构密度 / 涌现
const { ArchaeologyEngine, DIMENSIONS: ARCH_DIMENSIONS } = require('../engine/archaeology');
const { StructureEngine } = require('../engine/structure');
const { EmergenceEngine } = require('../engine/emergence');
const { CSBChecker } = require('../standard/csb');

// ═══════════════════════════════════════════════════════════════
// 五路径③④⑤的接线表（P2-2）
//
// 为什么集中成一张表而不是三段 if：
//   ① 三个引擎的 evaluate 签名不同（③ 吃字符串路径，④⑤ 吃 options）
//   ② 但**结论形状必须同源** —— 各写一遍 toItems，迟早有一份把「判不了」写成 0 分
//   ③ 将来抽 kernel 时，这张表就是唯一的接入点
//
// driver：该路径靠什么驱动。这决定了「什么条件下必然 UNDECIDED」，
//         也决定 CLI --dry-run 该体检哪一项。
// ═══════════════════════════════════════════════════════════════
const PATH_ENGINES = Object.freeze({
  archaeology: {
    title: '行为考古', emoji: '🏺', driver: 'agentPath',
    policyVersion: 'archaeology',
    create: (opts) => new ArchaeologyEngine(opts),
    // 每个维度是一条 item：有分且有理由以外的证据 → 判出来了；否则 UNDECIDED。
    // ⚠️ 维度的 state 由引擎给（它按覆盖率算过），这里只做映射，不重新判。
    toItems: (r) => (r.dimensions || []).map((d) => ({
      id: d.id,
      weight: (ARCH_DIMENSIONS.find((x) => x.id === d.id) || {}).weight || 0,
      score: d.score,
      status: d.state,
      reason: d.reason,
      detail: d.note,
      requires: null,          // 纯文件考古，不依赖采集档位
    })),
  },
  structure: {
    title: '结构密度', emoji: '🧱', driver: 'agentUrl',
    policyVersion: 'structure',
    create: (opts) => new StructureEngine(opts),
    toItems: (r) => (r.domains || []).map((d) => ({
      id: d.id,
      weight: 1,
      score: d.score,
      status: d.state,
      reason: d.reason,
      detail: d.note,
      requires: 'protocol',    // 必须有一轮可判往返
    })),
  },
  emergence: {
    title: '涌现', emoji: '✨', driver: 'agentUrl',
    policyVersion: 'emergence',
    create: (opts) => new EmergenceEngine(opts),
    // ⚠️ 涌现不评分：score 恒为 null，只在顶层给 emergenceRate。
    //    把它塞进 0-10 会让人以为「涌现少 = 做得差」——协议里没这么说。
    toItems: (r) => (r.scenarios || []).map((s) => ({
      id: s.id,
      weight: 1,
      score: null,
      status: s.state,
      reason: s.reason,
      detail: s.note || s.why || null,
      requires: 'protocol',
    })),
  },
});

const { ResultsStore } = require('../store/results');
// [2026-11-02 P0-1] 判定内核（三态 + 回执 + 门）。可抽出的形状，将来抽走只改这一行 require。
const verdict = require('../engine/verdict');
const criteria = require('../engine/criteria');
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
    // 依赖注入（仅为可测）：config.mutualTransport 可替掉真实 A2A 传输
    this.mutualTransport = config.mutualTransport || null;
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

      // ═══════════════════════════════════════════════════════════════
      // 路径② 互评（P2-2）：独立分支，前置返回。
      //   . 不需要 agentUrl（目标由 peers 共同评），但至少要有 1 个 peers
      //   . 不走黑盒/白盒：互评只看「评审者之间是否自洽」，不是再测一遍目标
      //   . 结论三态沿用同一内核（UNDECIDED 的 score 必须是 null，不是 0）
      // ═══════════════════════════════════════════════════════════════
      if (req.body.path === 'mutual') {
        return await this.createMutualEval(req, res);
      }

      // ═══════════════════════════════════════════════════════════════
      // 路径③④⑤（P2-2）：行为考古 / 结构密度 / 涌现
      //   三者共用同一套三态内核，所以走同一个分支 + 同一个回执构造器。
      //   驱动条件不同：
      //     ③ archaeology → agentPath（纯文件考古，目标离线也能跑）
      //     ④ structure   → agentUrl（必须现场提问）
      //     ⑤ emergence   → agentUrl（必须现场提问）
      // ═══════════════════════════════════════════════════════════════
      if (PATH_ENGINES[req.body.path]) {
        return await this.createPathEval(req, res);
      }

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
   * POST /api/eval  · path=mutual（P2-2 五路径②）
   *
   * 与黑盒/白盒的关系：**不是再测一遍目标**，而是问「这群评审者的意见能不能用」。
   * 三个信号：participation（应答率）· reproducibility（同题两措辞自洽）·
   * discrimination（空洞对照样本要被打低分）。
   *
   * body:
   *   path:      'mutual'
   *   peers:     ['host:port', ...] 或 [{ name, url }]
   *   tolerance: 2.0    同上评委两次打分容差（0-10）
   *   canaryMax: 6.0    给空洞样本的容忍上限
   *   minPeers:  1      至少几家可用
   */
  async createMutualEval(req, res) {
    const { peers, tolerance, canaryMax, minPeers, delay, timeout } = req.body;

    if (!Array.isArray(peers) || peers.length === 0) {
      // 不报 400：这是可预期的「没给条件」，按三态返回 UNDECIDED(not_applicable)，
      // 与「连不上」区分开（一个永远 400 的接口等于永远无法区分两种不知道）。
      const r = await new MutualEngine({ delay: 0, transport: async () => ({}) }).evaluate({ peers: [] });
      const saved = await this.store.add({ ...r, agentUrl: null, standard: 'csb-aep/mutual', mode: 'mutual' });
      return res.json({ success: true, id: saved.id, path: 'mutual', verdict: r.verdict, reason: r.reason, score: r.score });
    }

    console.log(`[AEP] 🧑‍🤝‍🧑 互评路径: ${peers.length} 位评审者`);

    const engine = new MutualEngine({
      tolerance, canaryMax, minPeers, delay, timeout,
      transport: this.mutualTransport || undefined,
      senderName: (this.config.eval && this.config.eval.senderName) || 'CSB-AEP-MUTUAL',
      senderUrl: (this.config.eval && this.config.eval.senderUrl) || 'http://aep.local',
    });

    const result = await engine.evaluate({ peers });

    const report = {
      ...result,
      agentUrl: req.body.agentUrl || null,
      standard: 'csb-aep/mutual',
      mode: 'mutual',
      adapter: 'mutual',
    };

    // 回执：与黑盒同一套 7 必填 + 委托边界，不另起一套。
    // 先把 peers 映射成内核认识的 items 形状，挂到 report.results 上再算回执，
    // 这样 report.judgement（人看的那层）也会落在**最终存库的那份**上。
    report.results = result.peers.map((p) => ({
      id: p.peer.name,
      name: p.peer.name,
      weight: 1,
      score: p.targetScore,
      pass: p.usable ? true : null,
      status: p.usable ? undefined : 'UNDECIDED',
      reason: p.usable ? undefined : (p.targetReason || p.signals.reproducibility.reason || 'insufficient_telemetry'),
      detail: p.peer.url,
    }));

    report.receipt = buildReportReceipt(report, {
      mode: 'mutual', adapter: { name: 'mutual' }, evalResult: result, whiteboxResult: null, req,
    });

    const saved = await this.store.add(report);
    console.log(`[AEP] ✅ 互评完成: ${result.verdict} · score=${result.score} · 可信 ${result.participation.peers_usable}/${result.participation.peers_invited}`);

    res.json({
      success: true,
      id: saved.id,
      path: 'mutual',
      verdict: result.verdict,
      reason: result.reason,
      score: result.score,
      coverage: result.coverage,
      participation: result.participation,
      rejected: result.rejected,
    });
  }

  /**
   * POST /api/eval · path=archaeology|structure|emergence（P2-2 五路径③④⑤）
   *
   * 与黑盒/白盒的关系：不是替代，是**问不同的问题**。
   *   ③ 行为考古：不看它说了什么，看它留下了什么（文件 + 时间戳）。目标可离线。
   *   ④ 结构密度：现场学 5 个案例，第 6 个能不能迁移过去。答案键绝不进 prompt。
   *   ⑤ 涌现：不给案例，看它能不能自己提出结构。不评分，只记涌现率。
   *
   * 三者共同的纪律（与 kernel 一致，不许各写一套）：
   *   . 判不出来 = UNDECIDED，score 必须是 null，不是 0
   *   . 条件没给 = 可预期的「没东西可判」，仍按三态返回，不报 400
   *     （永远 400 的接口等于永远无法区分「没给」和「判不了」）
   */
  async createPathEval(req, res) {
    const kind = req.body.path;
    const spec = PATH_ENGINES[kind];
    const { agentUrl, agentPath, delay, timeout } = req.body;

    // 驱动条件：③ 吃 agentPath，④⑤ 吃 agentUrl
    const needsUrl = spec.driver === 'agentUrl';
    const driverValue = needsUrl ? agentUrl : agentPath;

    console.log(`[AEP] ${spec.emoji} ${spec.title}路径: ${driverValue || '(未提供驱动条件)'}`);

    let result;
    if (!driverValue) {
      // 条件没给：直接让引擎返回它的"没东西可判"形态，保证结论形状与真跑一致
      const engine = spec.create({ delay: 0 });
      result = needsUrl ? await engine.evaluate({}) : await engine.evaluate(null);
    } else {
      const engine = spec.create({
        delay, timeout,
        senderName: (this.config.eval && this.config.eval.senderName) || 'CSB-AEP',
        senderUrl: (this.config.eval && this.config.eval.senderUrl) || 'http://aep.local',
        // 仅测试用：允许注入传输，避免端到端测试真的发 A2A
        transport: this.pathTransport || undefined,
      });
      result = needsUrl
        ? await engine.evaluate({ agentUrl, ...(req.body.domains ? { domains: req.body.domains } : {}), ...(req.body.scenarios ? { scenarios: req.body.scenarios } : {}) })
        : await engine.evaluate(agentPath);
    }

    const report = {
      ...result,
      agentUrl: agentUrl || null,
      agentPath: agentPath || null,
      standard: `csb-aep/${kind}`,
      mode: kind,
    };

    report.receipt = buildReportReceipt(report, {
      mode: kind,
      adapter: { name: kind },
      evalResult: result,
      whiteboxResult: null,
      req,
      pathItems: spec.toItems(result),
      pathPolicy: spec.policyVersion,
    });

    const saved = await this.store.add(report);
    console.log(`[AEP] ✅ ${spec.title}完成: ${result.verdict} · score=${result.score === null ? 'null' : result.score}`);

    res.json({
      success: true,
      id: saved.id,
      path: kind,
      verdict: result.verdict,
      reason: result.reason,
      score: result.score,
      scoreScale: result.scoreScale ?? null,   // 涌现为 null（不产出质量分），CLI 靠它区分"不适用"与"判不了"
      coverage: result.coverage ?? null,
      note: result.note ?? null,
      ...(result.emergenceRate !== undefined ? { emergenceRate: result.emergenceRate } : {}),
      ...(result.decided !== undefined ? { decided: result.decided } : {}),
    });
  }

  /**
   * GET /api/eval/:id
   *
   * P1-5：支持「这份结论能不能用在这件事上」的机械查询：
   *   ?use=gate&strength=gating       → 单用途
   *   ?use=gate,report&strength=...   → 多用途（逗号分隔）
   *   ?policy_version=...             → 显式换口径校验（不传则按回执自身口径比）
   *
   * 越界时返回 `reuse.reusable=false` + 具体缺什么 + 固定口令「越界一律新开」。
   * **不提供「把 mandate 改大一点」的参数** —— 那是本功能要禁止的事。
   */
  async getEval(req, res) {
    const result = await this.store.getById(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Not found' });
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const use = url.searchParams.get('use');
    if (use) {
      const mandateSource = result.mandate || result.receipt?.mandate || null;
      const reuse = mandateSource
        ? verdict.checkMandateReuse(mandateSource, {
          scope: use.split(',').map((s) => s.trim()).filter(Boolean),
          strength: url.searchParams.get('strength') || 'advisory',
          policy_version: url.searchParams.get('policy_version') || undefined,
        })
        : { reusable: false, code: 'missing_mandate', reason: '该报告未携带委托凭据（P1-5 之前产出）→ 无法证明可用范围，请新开判定' };
      return res.json({ ...result, reuse });
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
      // P1-4：判据指纹与「是否已过期」。
      //   口径说明（不夸大）：
      //   • policyStale = 该报告的口径版本 ≠ 当前代码版本下的同 mode 口径版本
      //     → 判据（权重表/阈值/词表）可能已变，分数不可与今日结果直接比较
      //   • criteriaHash 原样给出去，调用方可自行与今日报告的 criteria.hash 比对
      //   • 老报告（P1-4 之前）没有 criteria → hash 为 null 且 untracked=true
      //     这**不等于可用**：只是我们无法证明它一致
      criteriaHash: r.criteria?.hash || null,
      criteriaVersion: r.criteria?.version || null,
      untracked: !r.criteria,
      policyStale: Boolean(r.criteria?.version && r.criteria.version !== `aep-${AEP_VERSION}/${r.mode || 'blackbox'}`),
      // P1-5：委托边界（不解签就能看出口径）。
      //   mandateDerived=true 表示这是系统补的保守默认（eval:read / advisory），
      //   **不能当门禁用**；要门禁级结论，得发起方显式给 mandate 或新开一次判定。
      mandate: r.mandate
        ? { scope: r.mandate.scope, strength: r.mandate.strength, policy_version: r.mandate.policy_version, depth: r.mandate.depth, derived: r.mandate.derived === true }
        : null,
      mandateDerived: r.mandate ? r.mandate.derived === true : null,
      mandateUntracked: !r.mandate,   // true = P1-5 之前产出，无法证明可用范围
      mandateDigest: r.mandate_digest || null,
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
// PATH_ENGINES 一并导出：接线表是「五路径接在哪个引擎上」的唯一真源，
//   单测要能直接核它（而不是核文档或核某段 if）—— 文档会过期，代码不会。
module.exports = { EvalAPI, buildReportReceipt, PATH_ENGINES };


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
  // P2-2 ③④⑤：这三种路径没有 results/用例清单，口径名沿用自己的（ctx.pathPolicy），
  //   否则会产生「证据结构完全不同、口径名却一样」的回执 —— 那等于口径没版本。
  const policyVersion = `aep-${AEP_VERSION || 'unknown'}/${ctx.pathPolicy || mode || 'blackbox'}`;

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

  // P2-2 ③④⑤：这三条路径没有 adapter 文件（不是协议往返，是自带引擎）。
  //   但档位**仍必须从证据算**：
  //     ③ 行为考古读的是本地文件 + 时间戳 → 看得见文件即 HOOK 档（文件就是钩子级证据）
  //     ④⑤ 靠协议问答 → 至多 PROTOCOL 档，一条都判不出来则 NONE
  const hasPathItems = Array.isArray(ctx.pathItems);
  const sourceForTier = hasPathItems ? ctx.pathItems : (report.results || []);
  const decidedCount = sourceForTier.filter((r) => r.status !== verdict.VERDICT.UNDECIDED).length;
  // ③ 的档位来自「真的读到了文件」：引擎把读不到的维度标成 no_audit_source。
  //   只要有一个维度判出来了，就说明文件读到了 → HOOK。
  const isFileAudit = ctx.pathPolicy === 'archaeology';
  // P1-1：采集器声明的能力上限参与封顶。适配器说「我最多看到 protocol」，
  // 就不该因为一次偶然的 hook 形状数据自称 hook 档（那会让判定链对看不清的指标下 FAIL）。
  const tierInfo = verdict.resolveTier({
    hooks: adapter?.capabilities?.hooks === true || (isFileAudit && decidedCount > 0),
    protocol: decidedCount > 0,
    screen: false,
  }, { ceiling: adapter?.collector?.tier || (hasPathItems && isFileAudit ? 'hook' : undefined) });
  const tier = tierInfo.tier;
  const collectorMeta = typeof adapter?.collectorMeta === 'function'
    ? adapter.collectorMeta()
    : { id: collectorId, tier: adapter?.collector?.tier || null, sources: null };

  // 三态：把 results 映射成内核的 items，供 aggregate 出 coverage/insufficient
  //   P0-6 两步收敛：① 单条按档位封顶（低档位不得 FAIL）② 再聚合
  // P2-2 ③④⑤：这三条路径的判定单元不是用例（results），而是维度/领域/场景。
  //   由调用方按各自引擎的原始输出给出（PATH_ENGINES[*].toItems），
  //   但**统一走内核**的三态构造 + 档位收敛 —— 不许各写一套「判不了算 0 分」。
  const sourceItems = ctx.pathItems || report.results || [];
  const items = sourceItems.map((r) => {
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
    tier_observed: tierInfo.observed || null,      // 被封顶前的实际观测档位
    tier_ceiling: tierInfo.ceiling || null,        // 采集器声明上限
    collector_sources: collectorMeta.sources || null,
    counts: { total: agg.total, decided: agg.decided, passed: agg.passed, failed: agg.failed, undecided: agg.undecided },
    undecidedReasons: agg.undecidedReasons,
    processFlags: agg.processFlags,
    note: agg.insufficient
      ? '覆盖率低于阈值 → 整份结论按 UNDECIDED 处理（没测到 ≠ 做错）'
      : null,
  };

  // P1-1：采集器能力快照落在**报告层**，不进回执。
  //   理由：回执是判定契约（7 必填 + HMAC 口径），改字段会动到所有消费方；
  //   报告是证据层，加字段是纯加法。
  //   为什么不能塞进 buildReceipt 的入参：它会**静默丢弃**未知字段（只取 id/version），
  //   看起来加了、实际没落库 —— 正是「假绿」。这里显式写进 report，测试锁住它真在。
  report.collector = {
    id: collectorId,
    version: collectorVersion,
    tier: collectorMeta.tier || null,          // 能力上限（不是本次评测结果）
    registered: collectorMeta.registered !== false,
    sources: collectorMeta.sources || null,    // 静态证据源
    sourcesReason: collectorMeta.sourcesReason || null,
  };

  // P1-4：判据快照落报告层 —— 旧报告将来能不能复用，靠这个判断。
  //   只存 hash 就只能说"变了"，说不出"哪里变"；所以连快照一起存。
  //   注意：快照**不含**运行时状态（结果本身、时间戳），见 criteria.STATE_FIELDS。
  report.criteria = criteria.snapshot({
    policyVersion,
    mode: mode || 'blackbox',
    standard: ctx.standard || 'a2a-v0.6',
    weights: (report.results || []).reduce((m, r) => { m[r.id] = r.weight; return m; }, {}),
  });

  // P1-5：委托边界落在报告层（回执里也有一份，两边同源）。
  //   默认委托 = 保守值：scope 只到 `eval:read`、强度 advisory、derived=true。
  //   要拿去当门禁/对外凭证，必须由**发起方显式**给出更强 mandate（或自己新开一次判定）。
  //   报告层多存一份的理由：`/api/eval/list` 不用解签就能告诉调用方「这份能不能当门禁用」。
  const receipt = verdict.buildReceipt({
    verdict: topVerdict,
    score: typeof report.score === 'number' ? report.score : null,
    issued_at: new Date().toISOString(),
    policy: { version: policyVersion },
    // 回执只取 id/version（P0-1 契约不动）。能力快照见上方 report.collector。
    collector: { id: collectorId, version: collectorVersion },
    telemetry_tier: tier,
    mandate: (req && (req.mandate || (req.body && req.body.mandate))) || undefined,
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

  report.mandate = receipt.mandate;
  report.mandate_digest = receipt.mandate_digest;
  report.mandate_derived = receipt.mandate_derived;
  report.mandate_valid = receipt.mandate_valid;
  return receipt;
}
