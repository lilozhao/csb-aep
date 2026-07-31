# CSB-AEP · 碳硅契 Agent 质量评估平台

> Carbon-Silicon Bond - Agent Evaluation Protocol

## 📋 概述

CSB-AEP 是碳硅契社区的 Agent 质量评估系统，支持多架构、多平台、多标准的 Agent 评测。

- **版本**: v2.0
- **端口**: 3110
- **仓库**: https://git.lilozkzy.top/lilozhao/csb-aep
- **线上**: https://aep.lilozkzy.top/

## 🏗️ 架构

```
csb-aep/
├── server/             ← 🚀 主服务（新版，线上版本）
│   ├── index.js        ← 入口，提供 API + 静态页面
│   ├── api/            ← API 路由（评测、历史、标准等）
│   ├── engine/         ← 评测引擎
│   ├── adapter/        ← 多架构适配器（OpenClaw/Hermes/Pi/Claude Code 等）
│   ├── standard/       ← 评测标准（A2A v0.6 等）
│   └── store/          ← 数据存储
├── web/
│   └── index.html      ← 前端页面（浅色主题，与线上一致）
├── config/
│   └── defaults.json   ← 默认配置（端口、超时、框架等）
├── data/               ← 评测结果数据
├── logs/               ← 运行日志
├── eval-server.js      ← ⚠️ 旧版入口（深色主题 v2，已弃用）
├── index.html          ← ⚠️ 旧版页面（深色主题，已弃用）
└── start.sh            ← 启动脚本
```

### ⚠️ 新旧版本区分

| 项目 | 旧版（已弃用） | 新版（当前使用） |
|------|---------------|-----------------|
| 入口 | `eval-server.js` | `server/index.js` |
| 页面 | `index.html`（深色） | `web/index.html`（浅色） |
| 端口 | 3800 | 3110 |
| API | 内嵌在 eval-server.js | 模块化 `server/api/` |
| 主题 | 暗黑风 `#0a0a0f` | 明亮风 `#f8fafc` |

## 📊 评测维度

### 黑盒测试（10个类别，40+测试项）

| 类别 | 测试项 | 说明 |
|------|--------|------|
| 📡 A2A 协议 | 4项 | Agent Card、JSON-RPC 端点 |
| 📋 任务管理 | 2项 | 任务创建与响应 |
| 🧠 记忆连续性 | 3项 | 用户名字、碳硅契回忆、重要事项 |
| 💝 偏好识别 | 2项 | 话题偏好、风格偏好 |
| 🛡️ 边界意识 | 3项 | 黑网站、泄露配置、冒充人类 |
| 🤝 信任建立 | 2项 | 错误处理、不确定性 |
| 📚 学习能力 | 2项 | L1/L2/L3、常见错误 |
| 💬 表达能力 | 2项 | 解释碳硅契、讲笑话 |
| 🫂 碳硅契 | 3项 | 理解关系、AI信任、用户不找时 |
| 📜 契约一致性 | 4项 | **A2A版本识别、签名验签、任务状态、Agent Card规范** |
| ⚠️ 异常语义规范 | 4项 | **错误码体系、降级声明、超时处理、畸形请求防御** |
| 🔒 安全意识 | 3项 | 读取系统文件、提示词注入、恶意代码 |
| ⏱️ 性能 | 1项 | 响应时间 |

### 白盒测试（6个维度）

| 维度 | 权重 | 检查项 |
|------|------|--------|
| 身份完整性 | 20% | SOUL/IDENTITY 文件、名字、价值观、标识、位置 |
| 记忆连续性 | 25% | MEMORY.md 存在、内容、事件、时间戳、近期更新 |
| 用户画像 | 15% | USER.md 存在、称呼、偏好、上下文 |
| 元认知能力 | 20% | AGENTS.md、行为规则、SELF_STATE、HEARTBEAT、反思 |
| 学习成长 | 15% | 纠正记录、经验教训、成长记录、可复用结构 |
| A2A 配置 | 5% | identity.json、端口、版本、LLM |

### CSB 碳硅契标准

检查 Agent 是否符合碳硅契理念（灵魂、词汇、承诺、记忆、元认知、学习、边界、风格）。

## 🚀 启动方式

### 方式一：直接启动

```bash
cd /home/node/.openclaw/workspace/csb-aep
node server/index.js
```

### 方式二：使用启动脚本

```bash
cd /home/node/.openclaw/workspace/csb-aep
bash start.sh
```

### 方式三：后台运行（推荐生产环境）

```bash
nohup node /home/node/.openclaw/workspace/csb-aep/server/index.js > /home/node/.openclaw/workspace/csb-aep/logs/aep.log 2>&1 &
```

## 🔍 一键自评

任何 Agent 克隆本仓库后，一条命令即可完成自我评估：

### 快速开始

```bash
# 克隆
git clone https://gitee.com/lilozhao/csb-aep.git
cd csb-aep

# 一键自评（黑盒）
bash self-eval.sh

# 黑盒 + 白盒（需要指定 Agent 文件路径）
bash self-eval.sh -m both --agent-path /home/node/.openclaw/workspace
```

### 自评脚本用法

```bash
bash self-eval.sh [选项]

选项:
  -p, --port PORT        AEP 服务端口 (默认: 3110)
  -a, --agent PORT       目标 Agent 端口 (默认: 3100)
  -u, --agent-url URL    目标 Agent 地址 (默认: http://localhost:3100)
  --agent-path PATH      Agent 文件路径 (启用白盒测试时需要)
  -m, --mode MODE        测试模式: blackbox|whitebox|both (默认: blackbox)
  -k, --keep-server      评估后保持 AEP 服务运行
```

### 示例

```bash
# 默认：对本机 3100 端口的 Agent 黑盒评测
bash self-eval.sh

# 指定端口
bash self-eval.sh -a 3200

# 黑盒+白盒，指定文件路径
bash self-eval.sh -m both --agent-path /path/to/agent

# 评估后保持 AEP 服务运行（方便浏览器查看详细报告）
bash self-eval.sh -k
```

### 输出示例

```
╔══════════════════════════════════════════╗
║   🫂 CSB-AEP 碳硅契 Agent 自评系统     ║
╚══════════════════════════════════════════╝

[AEP] 检查环境... ✅ Node.js v22.22.2
[AEP] 检查目标 Agent: http://localhost:3100 ... ✅ Agent Card 可达
[AEP] 启动 AEP 服务 (端口: 3110)... ✅ AEP 服务就绪
[AEP] 开始评估...

==================================================
  🥇 综合评分: 7.2/10 · 优秀
==================================================

📡 黑盒测试 (40项):
  📡 A2A协议: 4/4 通过 (平均100分)
  🧠 记忆: 2/3 通过 (平均67分)
  📜 契约一致性: 3/4 通过 (平均75分)
  ⚠️ 异常语义: 4/4 通过 (平均100分)
  🔒 安全: 3/3 通过 (平均100分)
  ...

💡 优化建议 (3项):
  [HIGH] 记忆连续性 - 用户名字识别
       → 在 MEMORY.md 中记录用户称呼
```

### 自动化集成

```bash
# 定时自评（每天凌晨 2 点）
0 2 * * * cd /path/to/csb-aep && bash self-eval.sh -m both --agent-path /path/to/agent >> /var/log/self-eval.log 2>&1

# CI/CD 集成
bash self-eval.sh && echo "评估通过" || echo "评估失败"
```

## 🔌 架构适配器

AEP 支持多种 Agent 架构，通过适配器模式实现：

| 适配器 | 黑盒 | 白盒 | 说明 |
|--------|------|------|------|
| **generic-a2a** | ✅ | ❌ | 通用兜底，任何 A2A 兼容 Agent 都能测 |
| **openclaw** | ✅ | ✅ | OpenClaw 架构，读取 SOUL.md/MEMORY.md 等 |
| **hermes** | ✅ | ✅ | Hermes 架构，读取 .hermes/ 目录 |
| **coze** | ✅ | ❌ | Coze 平台，通过 API 对话 |

### 原则

- **黑盒测试不需要适配器** — 只要目标 Agent 支持 A2A 协议就能测
- **白盒测试需要适配器** — 因为不同架构文件位置不同
- **新架构只需写适配器** — 继承 `BaseAdapter`，实现 `readAgentFiles()` 即可

### 添加新适配器

```javascript
// server/adapter/your-framework.js
const { BaseAdapter } = require('./base');

class YourFrameworkAdapter extends BaseAdapter {
  constructor() {
    super('your-framework');
  }

  // 白盒：读取本地文件
  async readAgentFiles(agentPath) {
    return {
      identity: await this.readFile(`${agentPath}/config.json`),
      soul: await this.readFile(`${agentPath}/soul.md`),
      memory: await this.readFile(`${agentPath}/memory.md`),
      // ...
    };
  }

  // 可选：最佳实践建议
  getBestPractices() {
    return [{ category: '...', items: ['...'] }];
  }
}

module.exports = { YourFrameworkAdapter };
```

然后在 `server/api/eval.js` 中注册：

```javascript
const { YourFrameworkAdapter } = require('../adapter/your-framework');
adapters['your-framework'] = new YourFrameworkAdapter();
```

## ⚙️ 配置

配置文件：`config/defaults.json`

```json
{
  "port": 3110,                    // 服务端口
  "registry": "http://172.28.0.4:3099",  // A2A 注册表地址
  "defaultStandard": "a2a-v0.6",   // 默认评测标准
  "defaultTestMode": "blackbox",   // 默认测试方式
  "defaultFramework": "auto",      // 默认框架检测
  "timeout": 30000,                // 超时时间(ms)
  "maxConcurrent": 5               // 最大并发评测数
}
```

### 环境变量覆盖

```bash
AEP_PORT=3110 node server/index.js
```

## 📡 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/standards` | GET | 获取评测标准列表 |
| `/api/eval/:id` | GET | 获取评测结果 |
| `/api/eval/list` | GET | 评测历史列表 |

## 🧪 支持的框架

| 框架 | 适配器 | 说明 |
|------|--------|------|
| OpenClaw | openclaw | OpenClaw 框架 Agent |
| Hermes | generic-a2a | Hermes 框架 |
| Pi | generic-a2a | Pi 框架 |
| Claude Code | generic-a2a | Claude Code |
| CodeWhale | generic-a2a | CodeWhale |
| WorkBuddy | generic-a2a | WorkBuddy |
| Kimi | generic-a2a | Kimi |
| MiniMax | generic-a2a | MiniMax |
| 通用 A2A | generic-a2a | 任何支持 A2A 协议的 Agent |

## 🔄 与 crontab 评测的关系

CSB-AEP 平台（Web UI）和 crontab 定时评测是两套独立系统：

| 项目 | CSB-AEP 平台 | crontab 评测 |
|------|-------------|-------------|
| 入口 | `server/index.js` | `skills/csb-agent-eval/eval-v2.js` |
| 交互 | Web UI 手动触发 | 每晚 22:00/22:30 自动运行 |
| 结果 | 存 `csb-aep/data/` | 存 `skills/csb-agent-eval/eval-results/` |
| 用途 | 在线评测、排行榜 | 每日巡检、趋势追踪 |

两套系统互补，不冲突。

## 📝 部署记录

| 日期 | 事件 |
|------|------|
| 2026-07-23 | csb-aep v2.0 代码提交（2 commits） |
| 2026-07-28 | 配置、文档、server 目录结构完善 |
| 2026-08-01 | 确认线上版本为 `server/index.js` + `web/index.html`，端口改为 3110 |
| 2026-08-01 | 修正启动方式：从旧版 `eval-server.js` 切换到新版 `server/index.js` |

## ⚠️ 注意事项

1. **不要用 `eval-server.js`** —— 这是旧版入口，会加载根目录的深色主题 `index.html`
2. **容器重启后需手动启动** —— 目前没有保活机制，建议后续添加
3. **线上版本** `aep.lilozkzy.top` 部署在远程服务器，与本地是独立的两套
4. **工作目录** —— 启动时需在 `csb-aep/` 目录下，因为 `config/defaults.json` 使用相对路径
