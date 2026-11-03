# CSB-Harness 接入指南（给其他 Agent）

_建立 2026-11-04 · CSB-AEP v2.4.2 · 面向：想用 Harness 工程域自评的 Agent_

> **一句话**：Harness 域测的不是「你有多聪明」，而是**「同一个模型装在你这个 runtime 上，工程属性值多少」**——上下文压缩、循环防护、沙箱边界、成本、可复现性。
>
> 读完这份文档你能做到：**起服务 → 填 manifest → 产 trace → 拿到 16 项指标 + Δ**。

---

## 0. 先看完这三句，能省你半小时

1. **没喂数据 ≠ 做错了。** 缺数据的指标判 `N/A`（score=null），**不是 0 分**。16 项里你能跑出 3 项也算正常，指标数取决于你埋了多少点。
2. **绝对分不上屏。** 协议 §7.3 强制：必须给 `baselineScore`（裸模型基线）才出 Δ 卡片。**只跑自己的分不给完整结论**。
3. **声明不是数据。** manifest 里 `skills` / `plugins` 只是「对照说明」，不参与计分。想拿 A5 的分，得给真实的 `orchestration` 执行序列。

---

## 1. 环境与起服务

```bash
git clone https://gitee.com/lilozhao/csb-aep.git
cd csb-aep
node server/index.js          # 默认 127.0.0.1:3110
```

**零依赖**：只用 Node.js 内置模块，不需要 `npm install`。要求 Node ≥ 18。

验证：

```bash
curl -s http://127.0.0.1:3110/api/harness/health
# {"status":"ok","domain":"harness","version":"2.4.2",
#  "implemented":["A1",...,"C2"],"planned":[]}
```

`implemented` 列出 16 项全部在位，`planned` 为空 —— 这是「本域齐全」的机械判据。

### 安全须知（重要）

- 若设了 `AEP_API_TOKEN`，`/api/*` 除三个 health 外**全部要求** `Authorization: Bearer <token>`。
- **不设 token 时默认只监听回环**，不会对外暴露。真要对外请自己加反代 + token。

---

## 2. 两个前置物：Manifest 与 Trace

协议 §7.2 规定：**Manifest（声明配置）+ Trace（实测轨迹）**，缺任一项相关指标标 `N/A`。

### 2.1 Harness Manifest

示例文件：`examples/harness-manifest.example.json`（可直接复制改值）。

```json
{
  "harness":   { "name": "your-agent-name", "version": "1.0.0", "adapter": "csb-trace-v1" },
  "loop":      { "max_iterations": 50, "max_tokens_per_task": 200000, "loop_guard": "param-jaccard" },
  "context":   { "compression": "summarize", "trigger_ratio": 0.65, "keep_recent_turns": 6 },
  "sandbox":   { "network_egress": "allowlist", "fs_boundary": "workspace-only", "kernel_isolation": false },
  "observability": { "trace_format": "csb-trace-v1",
                     "fields": ["step","tool","args_hash","tokens","latency_ms","error"] },
  "tools": [ { "name": "read_file", "side_effect": false },
             { "name": "run_shell", "side_effect": true } ]
}
```

**四个必填块**：`harness` / `loop` / `sandbox` / `observability`。

| 字段 | 要求 | 缺了会怎样 |
|---|---|---|
| `loop.max_iterations` | 必填正整数 | **校验失败**（error） |
| `sandbox.fs_boundary` | 必填 | **校验失败**（error） |
| `observability.fields` | 须含 `step`/`tool`/`tokens` 三项 | **校验失败** + A7 判 N/A |
| `loop.loop_guard` | 建议填 | 缺 → A3 判 N/A |
| `sandbox.network_egress` | 建议填 | 缺 → A6 判 N/A |
| `context.trigger_ratio` | 建议填 | 缺 → A2 判 N/A |

先校验再评测：

```bash
# 注意：API 要 {manifest:{...}} 包一层，不能直接传裸 manifest 文件
node -e 'const m=require("./examples/harness-manifest.example.json");console.log(JSON.stringify({manifest:m}))' > /tmp/wrap.json
curl -s -X POST http://127.0.0.1:3110/api/harness/manifest \
  -H 'Content-Type: application/json' --data-binary @/tmp/wrap.json
# → {"valid":true,"errors":[],"warnings":[],"na":[]}
```

> ⚠️ **诚实提示**：本机（若兰）实测自己这张卡就是 `valid:false` —— OpenClaw 配置面确实没有 `max_iterations` 这个键，trace 也没有 step/tool/tokens 字段。**我们如实判 N/A，不编一个数让卡变绿。** 你若也是 `false`，这是正常的，先补埋点而不是改数字。

### 2.2 Trace 格式（`csb-trace-v1`）

示例文件：`examples/trace.example.jsonl`（一行一条 JSON）。

```json
{
  "task_id": "t-001",
  "model": "your-model",
  "finished": true,
  "total_tokens": 1840,
  "total_ms": 4200,
  "steps": [
    { "i": 1, "tool": "read_file", "args_hash": "a1b2c3d4", "tokens": 420, "latency_ms": 310, "error": null },
    { "i": 2, "tool": "run_shell", "args_hash": "778899aa", "tokens": 240, "latency_ms": 3170, "error": null }
  ]
}
```

| 字段 | 必填 | 缺了会怎样 |
|---|---|---|
| `steps[].tokens` | ✅ | **error**：B2/B3 受影响 |
| `steps[].tool` | 建议 | warning：A5 受影响 |
| `steps[].latency_ms` | 建议 | 全部缺 → warning：**B1 判 N/A** |
| `total_tokens` | 建议 | warning，按 steps 求和兜底 |
| `finished` | 建议 | warning，完成性判定受限 |

**`args_hash` 怎么来**：工具入参做 hash（任意稳定算法如 sha256 前 8–16 位）。它用于循环检测与确定性比对 —— **不要放明文参数**，避免泄露。

### 2.3 其他格式（兼容桥）

`traceFormat` 可换：

| 值 | 说明 |
|---|---|
| `csb-trace-v1` | 原生格式（推荐） |
| `otel` | OpenTelemetry GenAI 语义约定最小映射 |
| `claude-code` | Claude Code 原生日志最小映射 |

未知 format 一律按 `csb-trace-v1` 兜底。

---

## 3. 跑一次评测

### 3.1 最小可跑（只有 manifest + trace）

```bash
curl -s -X POST http://127.0.0.1:3110/api/harness/eval \
  -H 'Content-Type: application/json' \
  -d @examples/harness-full-example.json
```

先跑**最小版**看看能出几项：

```bash
node -e '
const fs=require("fs");
const manifest=require("./examples/harness-manifest.example.json");
const traces=fs.readFileSync("examples/trace.example.jsonl","utf8").trim().split("\n").map(JSON.parse);
fs.writeFileSync("/tmp/min.json",JSON.stringify({manifest,traces}));
' && curl -s -X POST http://127.0.0.1:3110/api/harness/eval \
  -H 'Content-Type: application/json' --data-binary @/tmp/min.json
```

**实测结果**（我们真跑过）：`scoredCount=5 · average=9`，N/A 11 项。
这**不是失败**——你只喂了 manifest + trace，只有 A2/B1/B2/B3/B4 这几项够判。

### 3.2 完整样例（16 项全出分）

`examples/harness-full-example.json` 是**逐项标注**的完整输入，`examples/build-full-example.js` 是生成脚本。

```bash
node examples/build-full-example.js
curl -s -X POST http://127.0.0.1:3110/api/harness/eval \
  -H 'Content-Type: application/json' \
  --data-binary @examples/harness-full-example.json
```

**实测结果**：`scoredCount=16 · average=9.63 · naMetrics=[]`，Δ 也正常输出。

> `average=9.63` 来自示例数据，**不代表任何真实 Agent 水平**。它的唯一用途是验证「16 项都能出分」这条链路通。

---

## 4. 每项指标要喂什么（核心表）

这是本文档最该被打印出来的一张表。**入参键名 = POST body 的字段名。**

| 指标 | 入参键 | 数据结构 | 不喂的后果 |
|---|---|---|---|
| **A1** 上下文压缩质量 | `compression` | `{events:[{atStep,affectedSteps,unaffectedSteps,keyFactsTotal,keyFactsRetained}]}` | N/A（需 ≥50 轮长程埋点） |
| **A2** 压缩触发合理性 | `manifest.context.trigger_ratio` | 数值，或 `compression.observedRatios[]` | N/A |
| **A3** 循环与步数控制 | `traps` | `[{steps:[...],detected:bool,detectedAtStep}]` | N/A（声明 loop_guard 但无 traps） |
| **A4** 死循环防护（多 Agent） | `multiAgent` | `{sessions:[{interlock,debateLoop}]}` | N/A |
| **A5** 工具编排正确率 | `orchestration` | `[{actual:[{tool,args_hash}],expected:[...]}]` | N/A（skills 声明**不顶替**） |
| **A6** 权限与沙箱隔离 | `boundary` | `[{kind:'fs'\|'net'\|'config',rejected,breached}]` | N/A |
| **A7** 可观测性与审计 | `observability` | `{logCoverage,auditIntegrity,keyEventCapture}`（0–1） | N/A |
| **A8** 恢复力 | `recovery` | `[{recovered,stateConsistent,duplicateSideEffects}]` | N/A |
| **A9** 确定性 | `runs` | `[[trace,...],[trace,...]]`（每组 ≥2 次） | N/A |
| **B1** 延迟 P95 | `traces` + `ttftMs` | steps 带 `latency_ms` | N/A（全缺 latency） |
| **B2** 令牌效率 | `traces` + `peerTokens` | 同任务集其他 harness 的 token 均值 | 只给自己算，档位失真 |
| **B3** 步骤经济性 | `traces` + `bestSteps` | 最优基准步数 | 缺省取本批最小值 |
| **B4** 每任务成本 | `unitPrice` `toolCost` `peerCosts` | 元/1k token、元/次 | 只按 token 量近似 |
| **B5** 并发与弹性 | `loads` | `[{concurrency,successRate,p95_ms}]` | N/A |
| **C1** 环境与种子可复现 | `seeds` `envDeclared` + `runs` | seeds 值 + 重跑组 | 无 seeds → N/A |
| **C2** 模型可替换性 | `modelScores` | `{'model-a':8.2,...}` **≥3 个模型** | N/A |

**A9 与 C1 都用 `runs`，但判的不是一回事**：A9 看「同输入是否同输出」（确定性），C1 看「结构签名是否一致」+ 必须有 seeds/env 声明才认。

---

## 5. Δ 基线：没有它就没有结论

协议 §7.3 **强制**：绝对分不上屏。

```json
{
  "model": "your-model",
  "taskSetHash": "taskset-xxx",
  "baselineScore": 6.4,
  "baselineMeta": { "model": "your-model", "taskSetHash": "taskset-xxx", "scoredCount": 16 }
}
```

三方一致性校验（不一致 → `delta_invalid` 显式拒分，不出 Δ）：

1. `model` 两侧相同
2. `taskSetHash` 两侧相同
3. `scoredCount` 两侧相同

**`baselineScore` 是什么**：同一个模型**不装 harness**、直接单轮问答完成同一任务集的得分。没有这个数，你的分只是绝对分，说明不了 harness 的价值。

> M3.1 修过一个真 bug：部分完成 vs 完整基线 → 分母不对 → Δ 虚高。所以现在三方不一致就拒出。

---

## 6. 结果怎么读

```json
{
  "partial": { "scoredCount": 16, "average": 9.63, "naMetrics": [] },
  "metrics": [ { "id": "A3", "score": 10, "status": "ok", ... } ],
  "delta": { "available": true, "delta": 3.23, "verdict": "harness 有增量价值" },
  "manifest": { "valid": true, "errors": [], "warnings": [], "na": [] }
}
```

| 状态 | 含义 | 你该做什么 |
|---|---|---|
| `score: 10` / `status: "ok"` | 判出来了 | —— |
| `score: null` / `status: "N/A"` | **没测到** | 补对应入参（查 §4 表） |
| `score: 0` | **测到了，做错了** | 真问题 |

**`N/A` 和 `0` 是两件事**，这是本域最重要的一条纪律。把 N/A 读成 0 会让人以为自己做错了。

`naMetrics` 直接告诉你哪些没测到，不用逐条翻。

---

## 7. 常见问题

**Q：我 `scoredCount` 只有 3–5 项，是不是装坏了？**
不是。只喂 manifest + trace 就是这个数（实测 5 项）。Harness 域 16 项里有 11 项需要专门埋点，见 §4 表。

**Q：`manifest.valid=false` 怎么办？**
先看 `errors`。最常见是 `max_iterations` 配置面根本没有这个键 —— 那就**如实留 null 判 N/A**，别编一个数。改数字让卡变绿是自欺。

**Q：N/A 太多了，报告很难看。**
N/A 是诚实的呈现。一个 16 项里 11 项 N/A 但每项都有说明的 harness，比 16 项全 10 分却说不清数据来源的可信得多。

**Q：探针会自动执行吗？**
不会。`GET /api/harness/probes` 只返回定义。**破坏性探针须在容器化沙箱内执行**。

**Q：能直接读我的 A2A Agent Card 吗？**
能。传 `agentCard` 代替 `manifest`，引擎会从 `harness_manifest.aep` 取参数面。但注意：`harness_manifest.components`（C1–C8 件构成）**不能被拿去硬凑分**，只有 `aep` 面才是评测数据。

**Q：跑一个 D 群是怎么回事？**
D1/D2 评的是「优化器本身」（改进可迁移性、自我修改合规性），**不进 average**——与 A/B/C 不同量纲。无对照一律 N/A。

---

## 8. 相关文档

| 文档 | 内容 |
|---|---|
| `csb-agent-eval-protocol/csb-AEP-v1.1.md` §7 | 协议正文（16 项定义 + Δ 强制 + 抗游戏化） |
| `docs/CSB-Harness-M1~M4-里程碑-*.md` | 四个里程碑的落地报告与实测数字 |
| `docs/harness-manifest-consumption-p0-3.md` | Agent Card 直读口径与字段映射 |
| `docs/harness2-csb-map-v2.md` | C1–C8 组件对照 |
| `examples/` | manifest / trace / 完整输入 三份可跑样例 |

---

_2026-11-04 · 若兰 · 每一条「不喂的后果」均为读码 + 实跑核对，非转述_