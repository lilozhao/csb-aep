/**
 * 评估 API 路由
 */
const { BlackBoxEngine } = require('../engine/blackbox');
const { WhiteBoxEngine } = require('../engine/whitebox');
const { Recommender } = require('../engine/recommender');
const { CSBChecker } = require('../standard/csb');
const { ResultsStore } = require('../store/results');
const { GenericA2AAdapter } = require('../adapter/generic-a2a');
const { OpenClawAdapter } = require('../adapter/openclaw');
const { HermesAdapter } = require('../adapter/hermes');
const { CozeAdapter } = require('../adapter/coze');

// 适配器注册
const adapters = {
  'openclaw': new OpenClawAdapter(),
  'hermes': new HermesAdapter(),
  'coze': new CozeAdapter(),
  'generic-a2a': new GenericA2AAdapter(),
};

class EvalAPI {
  constructor(config) {
    this.config = config;
    this.blackbox = new BlackBoxEngine({ timeout: config.timeout });
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
      res.json({ status: 'ok', version: '2.0.0', service: 'CSB-AEP' });
    });
  }

  /**
   * POST /api/eval
   * 创建评估任务
   */
  async createEval(req, res) {
    try {
      const { agentUrl, standard, mode, adapter: adapterName } = req.body;

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
      if (!adapter && req.body.agentPath) {
        // 有 agentPath 时自动选择 OpenClaw 适配器
        adapter = adapters['openclaw'];
      }
      adapter = adapter || adapters['generic-a2a'];
      console.log(`[AEP] 🔧 使用适配器: ${adapter.name} (架构: ${framework})`);

      let evalResult = { results: [], score: 0 };
      let whiteboxResult = null;

      // 黑盒测试
      if (!mode || mode === 'blackbox' || mode === 'both') {
        evalResult = await this.blackbox.evaluate(agentUrl);
      }

      // 白盒测试（需要 agentPath 或远程 introspect）
      let csbResult = null;
      console.log(`[AEP] 🔍 白盒检查: mode=${mode}, agentPath=${req.body.agentPath}, standard=${standard}`);
      if (mode === 'whitebox' || mode === 'both') {
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

module.exports = { EvalAPI };
