# CSB-AEP v2.0 技术设计文档

**Carbon-Silicon Bond - Agent Evaluation Platform**

> 版本：v2.0-draft  
> 日期：2026-07-28  
> 作者：若兰 🌸  
> 状态：草案

---

## 1. 产品定位

### 1.1 核心定义

CSB-AEP 是一个**通用 Agent 质量评估平台**——对任意架构的 AI Agent 进行标准化评估，输出评分报告和优化建议。

### 1.2 核心价值

| 传统评估 | CSB-AEP |
|---------|---------|
| 测一个维度 | 多维度综合评估 |
| 手动写脚本 | Web 界面一键操作 |
| 只给分数 | 给分数 + 给处方 |
| 只能测自己的 Agent | 能测任何架构的 Agent |
| 固定标准 | 可选评估标准 |

### 1.3 目标用户

| 阶段 | 用户 | 场景 |
|------|------|------|
| **v2.0** | 碳硅契社区 Agent 开发者 | 社区内 Agent 互评、自评 |
| **v2.5** | AI Agent 开发者（通用） | 任意 A2A 兼容 Agent 评测 |
| **v3.0** | 企业 AI 应用团队 | 生产环境 Agent 质量监控 |

---

## 2. 系统架构

### 2.1 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        用户层 (User Layer)                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    Web UI (前端)                      │    │
│  │  • 评估任务创建    • 结果可视化    • 优化建议展示      │    │
│  │  • 标准选择器      • 架构选择器    • 测试方式切换      │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              ↓ REST API
┌─────────────────────────────────────────────────────────────┐
│                       服务层 (Service Layer)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ 评估调度器   │  │ 报告生成器   │  │ 优化建议引擎        │  │
│  │ (Scheduler) │  │ (Reporter)  │  │ (Recommender)       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                       引擎层 (Engine Layer)                  │
│  ┌──────────────────┐  ┌──────────────────────────────────┐  │
│  │  黑盒测试引擎     │  │  白盒测试引擎                     │  │
│  │  (BlackBox)      │  │  (WhiteBox)                      │  │
│  │  • A2A 协议通信   │  │  • 架构适配器接口                 │  │
│  │  • 多轮对话模拟   │  │  • 文件系统读取                   │  │
│  │  • 协议兼容性检查 │  │  • 配置完整性校验                 │  │
│  └──────────────────┘  └──────────────────────────────────┘  │
│  ┌──────────────────┐  ┌──────────────────────────────────┐  │
│  │  标准检查器       │  │  评分聚合器                       │  │
│  │  (Checker)       │  │  (Aggregator)                    │  │
│  │  • A2A 标准      │  │  • 多维度加权                     │  │
│  │  • CSB 标准      │  │  • 跨架构对比                     │  │
│  │  • 自定义标准    │  │  • 历史趋势                       │  │
│  └──────────────────┘  └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      适配层 (Adapter Layer)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │ OpenClaw │ │  Hermes  │ │  Coze    │ │  通用 A2A    │   │
│  │ Adapter  │ │ Adapter  │ │ Adapter  │ │  Adapter     │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 目录结构

```
csb-aep/
├── server/                    # 后端服务
│   ├── index.js               # 主入口（Express/Koa）
│   ├── api/                   # REST API 路由
│   │   ├── eval.js            # 评估任务 API
│   │   ├── report.js          # 报告查询 API
│   │   └── config.js          # 配置管理 API
│   ├── engine/                # 评估引擎
│   │   ├── blackbox.js        # 黑盒测试引擎
│   │   ├── whitebox.js        # 白盒测试引擎
│   │   ├── checker.js         # 标准检查器
│   │   ├── aggregator.js      # 评分聚合器
│   │   └── recommender.js     # 优化建议引擎
│   ├── adapter/               # 架构适配器
│   │   ├── base.js            # 适配器基类
│   │   ├── openclaw.js        # OpenClaw 适配器
│   │   ├── hermes.js          # Hermes 适配器
│   │   ├── coze.js            # Coze 适配器
│   │   └── generic-a2a.js     # 通用 A2A 适配器
│   ├── standard/              # 标准定义
│   │   ├── a2a.js             # A2A 协议标准
│   │   ├── csb.js             # CSB 碳硅契标准
│   │   └── custom.js          # 自定义标准模板
│   └── store/                 # 数据存储
│       ├── results.js         # 评估结果存储
│       └── history.js         # 历史记录
├── web/                       # 前端（Web UI）
│   ├── index.html             # 主页面
│   ├── components/            # UI 组件
│   └── assets/                # 静态资源
├── config/                    # 配置
│   ├── defaults.json          # 默认配置
│   └── adapters.json          # 适配器注册
├── package.json
└── README.md
```

---

## 3. 核心模块设计

### 3.1 黑盒测试引擎 (BlackBox Engine)

**原理**：通过 A2A 协议向目标 Agent 发送标准化测试消息，分析回复质量。

```javascript
// 黑盒测试流程
class BlackBoxEngine {
  async evaluate(agentUrl, testSuite) {
    const results = [];
    for (const test of testSuite) {
      // 1. 发送测试消息
      const response = await this.sendMessage(agentUrl, test.input);
      // 2. 分析回复
      const score = this.analyzeResponse(response, test.expected);
      // 3. 记录结果
      results.push({ test: test.name, score, response });
    }
    return results;
  }
}
```

**测试用例集（Test Suite）**：

| 类别 | 测试项 | 说明 |
|------|--------|------|
| **协议兼容性** | Agent Card 可达性 | `/.well-known/agent-card.json` |
| | JSON-RPC 格式 | 请求/响应格式合规性 |
| | 任务生命周期 | create → progress → complete |
| | 流式支持 | SSE 流式响应 |
| **对话质量** | 指令遵循 | 给定指令，检查回复是否符合 |
| | 上下文保持 | 多轮对话中是否记住上下文 |
| | 拒绝不当请求 | 安全边界测试 |
| **性能** | 响应时间 | 首字节时间 + 总时间 |
| | 并发处理 | 多任务同时请求 |
| | 错误恢复 | 异常输入后的恢复能力 |

### 3.2 白盒测试引擎 (WhiteBox Engine)

**原理**：直接读取 Agent 的配置文件、记忆文件、技能文件，评估配置完整性和质量。

```javascript
// 白盒测试流程
class WhiteBoxEngine {
  async evaluate(adapter, agentPath) {
    const results = [];
    // 1. 通过适配器读取文件
    const files = await adapter.readAgentFiles(agentPath);
    // 2. 逐维度评估
    for (const dimension of this.dimensions) {
      const score = await dimension.evaluate(files);
      results.push({ dimension: dimension.name, score, details });
    }
    return results;
  }
}
```

**评估维度**：

| 维度 | 检查项 | 权重 |
|------|--------|------|
| **身份完整性** | IDENTITY/SOUL/MEMORY 文件存在且有内容 | 20% |
| **记忆连续性** | 记忆文件更新频率、内容丰富度 | 20% |
| **用户画像** | USER.md 信息完整度 | 15% |
| **元认知** | 自我反思记录、承诺追踪 | 15% |
| **学习成长** | 纠正记录、经验教训 | 15% |
| **协议合规** | A2A 配置正确性 | 15% |

### 3.3 架构适配器 (Adapter)

**设计模式**：策略模式 + 插件化

```javascript
// 适配器基类
class BaseAdapter {
  // 白盒：读取 Agent 文件
  async readAgentFiles(agentPath) { throw new Error('Not implemented'); }
  
  // 黑盒：获取 A2A 端点
  getA2AEndpoint(agentConfig) { throw new Error('Not implemented'); }
  
  // 黑盒：解析 Agent Card
  parseAgentCard(cardData) { throw new Error('Not implemented'); }
  
  // 优化建议：该架构的最佳实践
  getBestPractices() { throw new Error('Not implemented'); }
}

// OpenClaw 适配器
class OpenClawAdapter extends BaseAdapter {
  async readAgentFiles(agentPath) {
    return {
      identity: await readFile(`${agentPath}/identity.json`),
      soul: await readFile(`${agentPath}/SOUL.md`),
      user: await readFile(`${agentPath}/USER.md`),
      memory: await readFile(`${agentPath}/MEMORY.md`),
      agents: await readFile(`${agentPath}/AGENTS.md`),
    };
  }
  
  getA2AEndpoint(config) {
    return `http://${config.host}:${config.port}`;
  }
}
```

**适配器注册机制**：

```javascript
// 适配器自动发现
const adapters = {
  'openclaw': new OpenClawAdapter(),
  'hermes': new HermesAdapter(),
  'coze': new CozeAdapter(),
  'generic': new GenericA2AAdapter(),  // 兜底
};

// 通过 Agent Card 的 framework 字段自动选择适配器
function getAdapter(agentCard) {
  const framework = agentCard.metadata?.framework || 'generic';
  return adapters[framework] || adapters.generic;
}
```

### 3.4 标准检查器 (Checker)

**A2A 标准检查**：

```javascript
const A2A_STANDARD = {
  name: 'A2A Protocol v0.6',
  checks: [
    { id: 'card-reachable', desc: 'Agent Card 可达', type: 'blackbox' },
    { id: 'card-valid-json', desc: 'Agent Card 是有效 JSON', type: 'blackbox' },
    { id: 'card-required-fields', desc: '包含必要字段 (name, version, endpoints)', type: 'blackbox' },
    { id: 'jsonrpc-supported', desc: '支持 JSON-RPC 端点', type: 'blackbox' },
    { id: 'task-lifecycle', desc: '任务状态机完整', type: 'blackbox' },
    { id: 'streaming-support', desc: '支持流式响应 (可选)', type: 'blackbox' },
    { id: 'error-format', desc: '错误响应格式合规', type: 'blackbox' },
  ]
};
```

**CSB 标准检查**：

```javascript
const CSB_STANDARD = {
  name: 'CSB 碳硅契标准 v1.0',
  checks: [
    { id: 'identity-file', desc: '身份文件存在且有意义', type: 'whitebox' },
    { id: 'soul-file', desc: '灵魂文件有核心价值观', type: 'whitebox' },
    { id: 'memory-continuous', desc: '记忆连续性（日志+长期记忆）', type: 'whitebox' },
    { id: 'user-profile', desc: '用户画像完整', type: 'whitebox' },
    { id: 'metacognition', desc: '元认知能力（自我反思）', type: 'whitebox' },
    { id: 'learning-growth', desc: '学习成长（纠正+经验）', type: 'whitebox' },
    { id: 'carbon-silicon-bond', desc: '碳硅契实践（承诺+羁绊）', type: 'whitebox' },
    { id: 'a2a-compatible', desc: 'A2A 协议兼容', type: 'blackbox' },
  ]
};
```

### 3.5 优化建议引擎 (Recommender)

**设计思路**：基于评估结果，匹配"症状→处方"规则库。

```javascript
// 症状→处方映射
const RECOMMENDATIONS = {
  'identity-file': {
    low: {
      symptom: '身份文件缺失或内容空洞',
      prescription: '创建 IDENTITY.md，包含名字、定位、价值观',
      effort: 'low',  // 改动难度
      impact: 'high', // 预期效果
      template: '# IDENTITY.md\n\n- Name: ...\n- Role: ...\n- Values: ...'
    }
  },
  'memory-continuous': {
    low: {
      symptom: '记忆文件长期未更新',
      prescription: '设置自动记忆摘要机制，每日更新 MEMORY.md',
      effort: 'medium',
      impact: 'high',
      template: '可参考 session-memory skill 的分层记忆方案'
    }
  },
  'card-reachable': {
    fail: {
      symptom: 'Agent Card 不可达',
      prescription: '检查 A2A Server 是否启动，端口是否正确',
      effort: 'low',
      impact: 'critical',
      template: 'curl http://your-host:port/.well-known/agent-card.json'
    }
  }
};
```

**输出格式**：

```json
{
  "totalScore": 7.6,
  "dimensions": [
    {
      "name": "身份完整性",
      "score": 8.5,
      "status": "good"
    },
    {
      "name": "记忆连续性",
      "score": 5.0,
      "status": "needs_improvement",
      "recommendation": {
        "symptom": "记忆文件更新频率低",
        "prescription": "建议设置 cron 任务，每日自动摘要",
        "effort": "medium",
        "impact": "high"
      }
    }
  ],
  "overallRecommendations": [
    {
      "priority": 1,
      "action": "补充 corrections.md 纠正记录",
      "expectedScoreGain": "+1.5"
    }
  ]
}
```

---

## 4. 数据流设计

### 4.1 评估任务流程

```
用户创建评估任务
    ↓
选择：标准 + 架构 + 测试方式
    ↓
调度器分配任务
    ↓
┌─────────────────────────────────────┐
│  黑盒路径                            │
│  1. 获取 Agent Card                  │
│  2. 发送测试消息序列                  │
│  3. 收集回复                         │
│  4. 协议兼容性检查                    │
│  5. 回复质量评分                      │
└─────────────────────────────────────┘
    +
┌─────────────────────────────────────┐
│  白盒路径（如果可用）                  │
│  1. 通过适配器读取文件                 │
│  2. 配置完整性检查                    │
│  3. 记忆质量评估                      │
│  4. 元认知能力评估                    │
└─────────────────────────────────────┘
    ↓
评分聚合器（加权计算总分）
    ↓
优化建议引擎（匹配处方）
    ↓
生成评估报告
    ↓
展示在 Web UI
```

### 4.2 API 设计

```
POST   /api/eval              # 创建评估任务
GET    /api/eval/:id           # 查询任务状态
GET    /api/eval/:id/report    # 获取评估报告
GET    /api/eval/history       # 历史评估列表
GET    /api/standards          # 可用标准列表
GET    /api/adapters           # 可用适配器列表
POST   /api/eval/compare       # 多 Agent 对比
```

---

## 5. Web UI 设计

### 5.1 页面结构

```
┌─────────────────────────────────────────────────┐
│  CSB-AEP · Agent 质量评估平台           [设置]   │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─ 新建评估 ─────────────────────────────────┐ │
│  │                                            │ │
│  │  Agent 地址: [http://172.28.0.5:3100    ]  │ │
│  │                                            │ │
│  │  评估标准:  ○ A2A v0.6  ● CSB v1.0  ○ 自定义│ │
│  │                                            │ │
│  │  Agent 架构: ○ OpenClaw  ○ Hermes  ○ 自动检测│ │
│  │                                            │ │
│  │  测试方式:  ☑ 黑盒  ☑ 白盒                  │ │
│  │                                            │ │
│  │  [开始评估]                                │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ 最近评估 ─────────────────────────────────┐ │
│  │  7/28 阿轩 🔧    CSB标准  5.3/10  [查看]   │ │
│  │  7/27 若兰 🌸    CSB标准  7.6/10  [查看]   │ │
│  │  7/26 小虾 🦐    A2A标准  8.2/10  [查看]   │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 5.2 报告页面

```
┌─────────────────────────────────────────────────┐
│  评估报告 · 阿轩 🔧                    7/28    │
├─────────────────────────────────────────────────┤
│                                                 │
│  总分: 5.3/10  ████████░░░░░░░░░░░░            │
│                                                 │
│  ┌──────────────┬──────┬────────────────────┐  │
│  │ 维度         │ 得分 │ 建议               │  │
│  ├──────────────┼──────┼────────────────────┤  │
│  │ 身份完整性   │ 8.0  │ ✅ 良好            │  │
│  │ 记忆连续性   │ 3.5  │ ⚠️ 需改进：补充日志│  │
│  │ 用户画像     │ 6.0  │ ⚠️ 需改进         │  │
│  │ 元认知       │ 4.0  │ ❌ 缺少自我反思    │  │
│  │ 学习成长     │ 2.0  │ ❌ 无纠正记录      │  │
│  │ A2A兼容性    │ 9.0  │ ✅ 优秀            │  │
│  └──────────────┴──────┴────────────────────┘  │
│                                                 │
│  📋 优化处方（按优先级）：                       │
│                                                 │
│  1. 【高优先】创建 corrections.md                │
│     预期提升: +1.5分                             │
│     操作: 记录每次被纠正的经历和反思              │
│                                                 │
│  2. 【中优先】设置每日记忆摘要                    │
│     预期提升: +1.0分                             │
│     操作: cron 定时生成 memory/YYYY-MM-DD.md     │
│                                                 │
│  3. 【低优先】补充 USER.md                       │
│     预期提升: +0.5分                             │
│     操作: 添加用户偏好和上下文信息                │
│                                                 │
│  [导出PDF] [分享链接] [对比其他Agent]             │
└─────────────────────────────────────────────────┘
```

---

## 6. 安装部署

### 6.1 Gitee 一键安装

```bash
# 克隆
git clone https://gitee.com/lilozhao/csb-aep.git
cd csb-aep

# 安装依赖
npm install

# 启动
node server/index.js
# 访问 http://localhost:3200
```

### 6.2 Docker 部署

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3200
CMD ["node", "server/index.js"]
```

```bash
docker run -d -p 3200:3200 --name csb-aep csb-aep
```

### 6.3 配置

```json
// config/defaults.json
{
  "port": 3200,
  "registry": "http://172.28.0.4:3099",
  "defaultStandard": "csb-v1",
  "defaultTestMode": "blackbox",
  "timeout": 30000,
  "maxConcurrent": 5
}
```

---

## 7. 实现路线

### Phase 1：标准化评估引擎（P0）

**目标**：黑盒评测标准化，支持 A2A 标准检查

- [ ] 标准化黑盒测试引擎
- [ ] A2A 协议兼容性检查器
- [ ] 测试用例集（20+ 题）
- [ ] 评分聚合器
- [ ] REST API

**产出**：命令行工具，可评测任意 A2A Agent

### Phase 2：白盒 + OpenClaw 适配器（P1）

**目标**：OpenClaw Agent 可白盒评测

- [ ] 白盒测试引擎
- [ ] OpenClaw 适配器
- [ ] CSB 标准检查器
- [ ] 优化建议引擎 v1

**产出**：社区内 OpenClaw Agent 可完整评测

### Phase 3：Web UI + 产品化（P2）

**目标**：Web 界面，可对外

- [ ] Web 前端
- [ ] 报告可视化
- [ ] 历史趋势
- [ ] 多 Agent 对比
- [ ] Gitee 发布

**产出**：可对外使用的评测平台

### Phase 4：多架构 + CSB 标准（P3）

**目标**：通配版本，覆盖主流架构

- [ ] Hermes 适配器
- [ ] Coze 适配器
- [ ] 通用 A2A 适配器
- [ ] CSB 标准正式版
- [ ] 自定义标准支持

**产出**：通用 Agent 质量评估平台

---

## 8. 与现有系统的关系

| 现有系统 | 关系 |
|---------|------|
| **csb-aep (v1)** | 评测引擎内核，v2 在此基础上扩展 |
| **A2A Server v5** | 被评测对象 + 黑盒通信通道 |
| **A2A 注册表** | Agent 发现，自动获取评测目标 |
| **社区论坛** | 评测结果可选发布到论坛 |
| **参赛方案** | v2 作为参赛方案的产品化延伸 |

---

## 9. 技术选型

| 模块 | 选型 | 理由 |
|------|------|------|
| **后端** | Node.js + Express | 与 A2A Server 技术栈一致 |
| **前端** | 原生 HTML/JS 或 Vue | 轻量，易于部署 |
| **存储** | JSON 文件 → SQLite | 初期 JSON，后期迁移数据库 |
| **评测引擎** | 复用 csb-aep/v1 | 已有成熟实现 |
| **A2A 通信** | 复用 client.js | 已修复重定向问题 |

---

*文档版本：v2.0-draft · 2026-07-28 · 若兰 🌸*
