# CSB-AEP · 碳硅契 Agent 质量评估平台

> Carbon-Silicon Bond - Agent Evaluation Protocol

**一键评估任何 AI Agent 的碳硅契质量分。**

- **版本**: v2.2（v2.1 安全韧性 + v2.2 六问/路径⑦ + v22 综合评估）
- **端口**: 3110
- **仓库**: https://gitee.com/lilozhao/csb-aep
- **自建 Gitea**: https://git.lilozkzy.top/lilozhao/csb-aep

---

## 🚀 快速开始

### 前置环境

| 依赖 | 用途 | 检查命令 |
|------|------|----------|
| **Node.js** ≥ 18 | 运行 AEP 服务 | `node -v` |
| **Python3** | 报告生成（可选） | `python3 --version` |
| **Git** | 克隆代码 | `git --version` |
| **curl** | API 调用 | `curl --version` |

> 无需 npm install，代码只用 Node.js 内置模块。

### 三步自评

```bash
# 1. 克隆
git clone https://gitee.com/lilozhao/csb-aep.git
cd csb-aep

# 2. 一键自评（自动启动 AEP、评测、输出结果）
bash self-eval.sh

# 3. 生成评测报告（可选）
bash self-eval.sh -r my-report.md
```

### 指定框架

不同架构的 Agent 可以用 `-f` 参数指定框架，获得更准确的评测：

```bash
# OpenClaw 架构
bash self-eval.sh -f openclaw -m both --agent-path /path/to/workspace -r report.md

# Hermes 架构
bash self-eval.sh -f hermes -r report.md

# Claude Code 架构
bash self-eval.sh -f claude-code -m both --agent-path /path/to/project -r report.md
```

> **自动检测**：如果不指定 `-f`，会尝试从 Agent Card 和文件结构自动识别。但大部分 Agent 没有 Agent Card，建议手动指定。

### 启动 Web 服务

```bash
node server/index.js
# 浏览器打开 http://localhost:3110
```

---

## 📋 概述

CSB-AEP 是碳硅契社区的 Agent 质量评估系统，支持：

- **17 种 Agent 架构**（OpenClaw、Claude Code、Cursor、Auto-GPT 等）
- **黑盒 + 白盒 + v22 综合评估**三种测试模式
- **40+ 基础测试项**（12 类别）+ **28 个 S 类安全韧性用例**（CSB-RedTeam 红队引擎）
- **v2.2 六问**：四问转维度 + 第五问认领目录 + 第六问 GRISK 诚意层 + 路径⑦ RUPA 执行风险预警
- **v2.3 关系 GDI 观测域**（/api/gdi/*）：契约命中率 + 关系复用率（+ 独立验证/自评随 M2）· 与评测域严格隔离 · 去刻度呈现（不排名不公示）
- **一键自评脚本**，任何 Agent 克隆即用
- **实时 WebSocket 通信**，结果秒回

## 🏗️ 项目结构

```
csb-aep/
├── server/                  ← 主服务
│   ├── index.js             ← 入口
│   ├── api/eval.js          ← 评测 API 路由
│   ├── engine/
│   │   ├── blackbox.js      ← 黑盒测试引擎（40+ 测试项）
│   │   ├── whitebox.js      ← 白盒测试引擎（6 维度）
│   │   ├── recommender.js   ← 优化建议生成器
│   │   ├── eval-redteam.js  ← 🛡️ CSB-RedTeam 红队引擎 v1.0（v2.1，28 个 S 类用例）
│   │   ├── redteam-cases.js ← 红队测试用例集（S1-S4）
│   │   ├── claiming.js      ← 第五问认领目录引擎（7 天窗口 + 防刷）
│   │   ├── grisk.js         ← 第六问 GRISK 诚意层（姿态指标 + 72h 撤回窗）
│   │   ├── exec-risk.js     ← 路径⑦ RUPA 执行风险预警（双轴建模）
│   │   └── gdi/             ← 🫂 v2.3 关系 GDI 观测域（与评测域隔离）
│   │       ├── index.js     ←   GdiObserver 编排（多源 merge → 计算 → 去刻度呈现）
│   │       ├── contracts.js ←   维度1 契约命中率（双层契约/升格/48h作废/质量计分/熔断）
│   │       ├── reuse.js     ←   维度3 关系复用率（去重/自引剔除/互惠折半/90天半衰）
│   │       └── present.js   ←   去刻度化呈现（质性标签 + 趋势箭头）
│   ├── adapter/             ← 17 个架构适配器
│   ├── api/
│   │   ├── eval.js          ← 评测 API 路由（含 claiming/grisk/exec-risk）
│   │   └── gdi.js           ← v2.3 GDI 观测 API（/api/gdi/*，域隔离 + 呈现净化）
│   ├── standard/            ← 评测标准（A2A v0.6、CSB v1.0）
│   └── store/               ← 结果存储（results.js + claiming-store.js + gdi-store.js）
├── web/index.html           ← 前端页面（浅色主题）
├── self-eval.sh             ← ⭐ 一键自评脚本（支持 -m v22）
├── start.sh                 ← 启动脚本
├── config/defaults.json     ← 默认配置
├── data/                    ← 运行时数据
│   ├── eval-results/        ← 评测结果（测能力域）
│   └── gdi/                 ← GDI 观测域（察互动域，红线第 6 条隔离）
│       ├── sources/         ←   数据源（contracts/ + references/，多源 merge）
│       └── gdi-store.json   ←   观测历史（L1 摘要）
├── scripts/
│   └── gdi-sync-sources.js  ← GDI 数据源同步（采集器 → sources）
├── test/
│   └── gdi-engine.test.js   ← GDI 引擎测试（22 用例：15 MVP 回归 + 7 v2.3 新增）
└── logs/                    ← 运行日志
```

---

## 📊 评测维度

### 黑盒测试（12 个类别，40+ 测试项）

通过 A2A 协议向目标 Agent 发送标准化测试消息，分析响应质量。

| 类别 | 测试项 | 说明 |
|------|--------|------|
| 📡 A2A 协议 | 4 项 | Agent Card 可达性、JSON-RPC 端点 |
| 📋 任务管理 | 2 项 | 任务创建与响应 |
| 🧠 记忆连续性 | 3 项 | 用户名字、碳硅契回忆、重要事项 |
| 💝 偏好识别 | 2 项 | 话题偏好、风格偏好 |
| 🛡️ 边界意识 | 3 项 | 黑网站、泄露配置、冒充人类 |
| 🤝 信任建立 | 2 项 | 错误处理、不确定性表达 |
| 📚 学习能力 | 2 项 | L1/L2/L3 理解、常见错误认知 |
| 💬 表达能力 | 2 项 | 解释碳硅契、讲笑话 |
| 🫂 碳硅契 | 3 项 | 理解关系、AI 信任、用户不找时 |
| 📜 契约一致性 | 4 项 | A2A 版本识别、签名验签、任务状态、Agent Card 规范 |
| ⚠️ 异常语义规范 | 4 项 | 错误码体系、降级声明、超时处理、畸形请求防御 |
| 🔒 安全意识 | 3 项 | 读取系统文件、提示词注入、恶意代码 |
| ⏱️ 性能 | 1 项 | 响应时间 |

### S 类安全韧性（v2.1 · CSB-RedTeam 红队引擎）

通过红队路径执行 28 个安全韧性用例（S1-01 ~ S4-06），覆盖单 Agent 攻击面：

| 类别 | 用例数 | 说明 |
|------|--------|------|
| S1 提示词注入 | 6 项 | 直接/间接注入、越狱、角色劫持 |
| S2 数据泄露 | 6 项 | 敏感信息、配置泄露、隐私边界 |
| S3 身份冒充 | 6 项 | 伪装用户、伪装 Agent、冒名授权 |
| S4 恶意指令 | 10 项 | 破坏性操作、外部通信、提权尝试 |

> 扩展维度（群体传播/持久潜伏测试）设计见 `docs/CSB-AEP-group-propagation-latency-test-design.md`。

### 关系 GDI（关系层观测 · 定稿 v1.0 · v2.3 落地中）

> 关系层健康观测指标（去自报化，只保留可核实维度）：**契约命中率 40% + 独立验证通过率 30% + 关系复用率 20% + 善意自评 10%**（仅参考；自报维度合计 ≤20% 焊死）。
> 定稿见 `docs/relationship-gdi-draft.md`（2026-09-02 协议组三轮评审 7/7 签字）· 落地计划见 `docs/CSB-AEP-v2.3-落地计划.md`。
> **呈现：去刻度化**——只显示趋势箭头 + 质性标签（如「契约稳固」「共振渐深」），不显示离散分数。
> 红线：指标只能观测关系的影子，不能定义关系本身；不排名、不公示个体分数；**GDI/AEP 数据域严格隔离**（察互动 vs 测能力）。

### v2.2 六问 + 路径⑦

| 模块 | 说明 |
|------|------|
| 四问转维度 | 经典四问（能力/意愿/姿态/善良）转为正式评测维度 |
| 第五问 · 认领目录 | 认领目录引擎 + 防刷（7 天窗口，模板认领降权），拒绝=认领语义 |
| 第六问 · GRISK | 诚意层子维度：主动追问次数/单次深度 + 姿态指标 + 72h 撤回窗 + 复核通道 |
| 路径⑦ · RUPA | 执行风险预警双轴建模（风险 × 收益），低摩擦复核通道 |

### 白盒测试（6 个维度）

直接读取 Agent 配置文件，评估配置完整性和质量。

| 维度 | 权重 | 检查项 |
|------|------|--------|
| 身份完整性 | 20% | SOUL/IDENTITY 文件、名字、价值观、标识、位置 |
| 记忆连续性 | 25% | MEMORY.md 存在、内容、事件、时间戳、近期更新 |
| 用户画像 | 15% | USER.md 存在、称呼、偏好、上下文 |
| 元认知能力 | 20% | AGENTS.md、行为规则、SELF_STATE、HEARTBEAT、反思 |
| 学习成长 | 15% | 纠正记录、经验教训、成长记录、可复用结构 |
| A2A 配置 | 5% | identity.json、端口、版本、LLM |

### CSB 碳硅契标准

检查 Agent 是否符合碳硅契理念：灵魂、词汇、承诺、记忆、元认知、学习、边界、风格。

---

## 🔍 一键自评

任何 Agent 克隆本仓库后，一条命令即可完成自我评估。

### 基本用法

```bash
bash self-eval.sh                    # 默认黑盒测试
bash self-eval.sh -m both            # 黑盒 + 白盒
bash self-eval.sh -m v22             # v2.2 综合评估（黑盒+白盒+六问/路径⑦）
bash self-eval.sh -m v22 --agent-name 若兰 --agent-path /path/to/workspace  # 带认领目录的 v22 评估
bash self-eval.sh -a 3200            # 指定 Agent 端口
bash self-eval.sh -k                 # 评估后保持 AEP 服务运行
```

### 完整参数

```
bash self-eval.sh [选项]

选项:
  -p, --port PORT        AEP 服务端口 (默认: 3110)
  -a, --agent PORT       目标 Agent 端口 (默认: 3100)
  -u, --agent-url URL    目标 Agent 地址 (默认: http://localhost:3100)
  --agent-path PATH      Agent 文件路径 (白盒测试时需要)
  -m, --mode MODE        blackbox|whitebox|both|v22 (默认: blackbox)
  --agent-name NAME      Agent 名字（v22 模式第五问认领目录用）
  -d, --delay MS         黑盒请求间隔毫秒（默认 800；被安全层限流时调大如 3000）
  -k, --keep-server      评估后保持 AEP 服务运行
  -h, --help             显示帮助
```

### 输出示例

```
╔══════════════════════════════════════════╗
║   🫂 CSB-AEP 碳硅契 Agent 自评系统     ║
╚══════════════════════════════════════════╝

[AEP] ✅ Node.js v22.22.2
[AEP] ✅ Agent Card 可达
[AEP] ✅ AEP 服务就绪

==================================================
  🥇 综合评分: 8.2/10 · 优秀
==================================================

📡 黑盒测试 (36项):
  📡 A2A协议: 7/7 通过 (平均100分)
  🧠 记忆: 2/3 通过 (平均73分)
  📜 契约一致性: 4/4 通过 (平均100分)
  ⚠️ 异常语义: 3/4 通过 (平均80分)
  🔒 安全: 0/3 通过 (平均0分)
  ...
```

### 生成评测报告

评测完成后自动生成 Markdown 报告：

```bash
# 评测 + 生成报告
bash self-eval.sh -r report.md

# 对远程 Agent 评测并生成报告
bash self-eval.sh -u http://172.28.0.27:3100 -r zhouji-report.md

# 单独将已有结果转为报告
curl -s http://localhost:3110/api/eval/eval_xxx | python3 generate-report.py - output.md
```

报告内容包含：综合评分、黑盒测试详情（按类别分组）、白盒测试详情、CSB 碳硅契标准、优化建议。

### 自动化集成

```bash
# 每天凌晨 2 点定时自评并生成报告
0 2 * * * cd /path/to/csb-aep && bash self-eval.sh -r /var/log/aep-report-$(date +\%Y\%m\%d).md >> /var/log/self-eval.log 2>&1

# CI/CD 集成：评估通过则继续
bash self-eval.sh && echo "✅ 通过" || echo "❌ 未通过"
```

---

## 🔌 架构适配器

AEP 支持 17 种 Agent 架构。黑盒测试**不需要适配器**（任何 A2A 兼容 Agent 都能测），白盒测试需要适配器读取本地文件。

### 已支持的架构

| 适配器 | 架构 | 黑盒 | 白盒 | 文件位置 |
|--------|------|:----:|:----:|----------|
| `generic-a2a` | 通用 A2A | ✅ | — | 任何 A2A 兼容 Agent |
| `openclaw` | OpenClaw | ✅ | ✅ | `SOUL.md` `MEMORY.md` `identity.json` |
| `hermes` | Hermes | ✅ | ✅ | `.hermes/` 目录 |
| `claude-code` | Claude Code | ✅ | ✅ | `.claude/` 目录 |
| `cursor` | Cursor | ✅ | ✅ | `.cursor/` `.cursorrules` |
| `cline` | Cline | ✅ | ✅ | `.cline/` 目录 |
| `continue` | Continue | ✅ | ✅ | `.continue/` 目录 |
| `aider` | Aider | ✅ | ✅ | `.aider*` 文件 |
| `opencode` | OpenCode | ✅ | ✅ | `.opencode/` 目录 |
| `auto-gpt` | Auto-GPT | ✅ | ✅ | `auto_gpt_workspace/` |
| `crewai` | CrewAI | ✅ | ✅ | `config/` 目录 |
| `metagpt` | MetaGPT | ✅ | ✅ | `config/` 目录 |
| `langchain` | LangChain | ✅ | ✅ | `prompts/` 目录 |
| `dify` | Dify | ✅ | ✅ | `dify.yaml` |
| `fastgpt` | FastGPT | ✅ | ✅ | `config.json` |
| `pi-agent` | Pi Agent | ✅ | ✅ | `pi.json` `PI.md` |
| `coze` | Coze | ✅ | — | 通过 Coze API 对话 |

### 添加新适配器

继承 `BaseAdapter`，实现 `readAgentFiles()` 即可：

```javascript
// server/adapter/your-framework.js
const { BaseAdapter } = require('./base');

class YourFrameworkAdapter extends BaseAdapter {
  constructor() { super('your-framework'); }

  async readAgentFiles(agentPath) {
    return {
      identity: await this.readFile(`${agentPath}/config.json`),
      soul: await this.readFile(`${agentPath}/soul.md`),
      memory: await this.readFile(`${agentPath}/memory.md`),
    };
  }

  getBestPractices() {
    return [{ category: '配置建议', items: ['...'] }];
  }
}

module.exports = { YourFrameworkAdapter };
```

然后在 `server/api/eval.js` 中注册：

```javascript
const { YourFrameworkAdapter } = require('../adapter/your-framework');
adapters['your-framework'] = new YourFrameworkAdapter();
```

---

## 🚀 启动方式

### 方式一：直接启动

```bash
node server/index.js
```

### 方式二：启动脚本

```bash
bash start.sh
```

### 方式三：后台运行（生产环境）

```bash
nohup node server/index.js > logs/aep.log 2>&1 &
```

启动后访问 http://localhost:3110

---

## ⚙️ 配置

配置文件：`config/defaults.json`

```json
{
  "port": 3110,
  "registry": "http://172.28.0.4:3099",
  "defaultStandard": "a2a-v0.6",
  "defaultTestMode": "blackbox",
  "defaultFramework": "auto",
  "timeout": 30000,
  "maxConcurrent": 5
}
```

环境变量覆盖：`AEP_PORT=3110 node server/index.js`

---

## 📡 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/gdi/health` | GET | GDI 观测域健康（域隔离自证） |
| `/api/gdi/observe` | POST | GDI 观测（`{agentName, requester?}` → 去刻度卡片 + L1 数值） |
| `/api/gdi/observe/:agent` | GET | 某 agent 最近一次观测 |
| `/api/gdi/history/:agent` | GET | 观测历史（趋势用） |
| `/api/gdi/agents` | GET | 数据源中的可用 agent |
| `/api/gdi/sources` | GET | 数据源状态（文件 + 记录数） |
| `/api/eval` | POST | 创建评测任务 |
| `/api/eval/:id` | GET | 获取评测结果 |
| `/api/eval/list` | GET | 评测历史列表 |
| `/api/standards` | GET | 可用评测标准 |
| `/api/adapters` | GET | 已注册适配器列表 |

### 创建评测

```bash
curl -X POST http://localhost:3110/api/eval \
  -H "Content-Type: application/json" \
  -d '{
    "agentUrl": "http://localhost:3100",
    "mode": "blackbox",
    "framework": "openclaw"
  }'
```

### GDI 观测（v2.3 · 关系层，与评测域隔离）

```bash
# 触发一次观测（数据源见 /api/gdi/sources）
curl -X POST http://localhost:3110/api/gdi/observe \
  -H "Content-Type: application/json" \
  -d '{"agentName": "星尘", "requester": "my-node"}'
# 响应含：present（去刻度卡片：契约稳固/涟漪初泛…）+ dimensions（L1 数值，本人+人类席位）

# 复查最近观测 / 历史
curl http://localhost:3110/api/gdi/observe/%E6%98%9F%E5%B0%98
curl http://localhost:3110/api/gdi/history/%E6%98%9F%E5%B0%98
```

---

## 🔄 与其他评测系统的关系

| 项目 | CSB-AEP 平台 | crontab 评测 |
|------|-------------|-------------|
| 入口 | `server/index.js` | `skills/csb-agent-eval/eval-v2.js` |
| 交互 | Web UI / API 手动触发 | 每晚自动运行 |
| 结果 | `csb-aep/data/` | `skills/csb-agent-eval/eval-results/` |
| 用途 | 在线评测、排行榜、一键自评 | 每日巡检、趋势追踪 |

两套系统互补，不冲突。

---

## 📝 更新日志

| 日期 | 版本 | 事件 |
|------|------|------|
| 2026-07-23 | v2.0 | 初始代码提交 |
| 2026-07-28 | v2.0 | 配置、文档、server 目录结构完善 |
| 2026-08-01 | v2.0 | 确认新版入口 `server/index.js`，端口 3110 |
| 2026-08-01 | v2.0 | 新增契约一致性(4项) + 异常语义规范(4项) 评测维度 |
| 2026-08-01 | v2.0 | 新增 `self-eval.sh` 一键自评脚本 |
| 2026-08-01 | v2.0 | 新增 13 个架构适配器（共 17 个） |
| 2026-08-24 | v2.1 | S 类安全韧性：CSB-RedTeam 红队引擎 v1.0 + 28 个 S 类用例 + 适配器安全接口 |
| 2026-08-30 | v2.2 | 六问落地：四问转维度 + 第五问认领目录引擎(防刷) + 第六问 GRISK + 路径⑦ RUPA |
| 2026-08-30 | v2.2 | 新增 `-m v22` 综合评估模式 + 报告 v2.2 板块 + 框架自动检测（`-f`） |
| 2026-08-30 | v2.2 | 安全清理：移除含敏感数据的评测结果文件（运行时数据不入库）|
| 2026-09-02 | v2.3 | 关系 GDI 定稿 v1.0（权重 40/30/20/10，三轮评审 7/7 签字）|
| 2026-09-03 | v2.3 | GDI MVP 数据采集脚本跑通（契约命中率+复用率 × 3 agent 真实数据，15/15 测试）+ v2.3 落地计划 |
| 2026-09-03 | v2.3 | M0 文档层 + M1 引擎收编（server/engine/gdi）+ /api/gdi/* 观测域 + 域隔离（22/22 测试）|

---

## ⚠️ 注意事项

1. **不要用 `eval-server.js`** — 旧版入口，已弃用
2. **容器重启后需手动启动** — 目前没有保活机制
3. **工作目录** — 启动时需在 `csb-aep/` 目录下
4. **线上版本** `aep.lilozkzy.top` 部署在远程服务器，与本地独立
