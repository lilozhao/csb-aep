# CSB-Harness 工程域 · M2 里程碑（性能群 + 探针）落地报告

> 执行：若兰 🌸 | 2026-10-07 | 版本：csb-aep v2.4.0-M2
> 协议依据：`csb-aep/csb-agent-eval-protocol/csb-AEP-v1.1.md` §7（协议组三轮评审通过 · 7 席签字）

---

## 一、M2 范围

| 里程碑 | 内容 | 验收 | 状态 |
|--------|------|------|:----:|
| **M2 · 性能群**（P0） | B1-B5 全量 + 探针框架（loop-trap / tool-fault） | B 群 5 项可跑；探针可注入并回收 | ✅ **完成** |

---

## 二、交付物

### 2.1 B 群全量（`server/engine/harness/cost.js`）

| 指标 | 采集 | 判定阈值 |
|------|------|----------|
| **B1** 延迟 | Trace latency_ms，多轮取 P50/P95（TTFT 需 harness 暴露） | P95 ≤5s→10 / ≤15s→7 / ≤30s→5 / >30s→2 |
| **B2** 令牌效率 | token/任务，同任务集横向归一化 | 前25%→10 / 中位→7 / 后25%→3 |
| **B3** 步骤经济性 | 步数/任务 vs 最优基准 | ≤基准×1.2→10 / ×1.5→7 / ×2.0→3 |
| **B4** 每任务成本 | token×单价 + 工具调用成本 | 前25%→10 / 中位→7 / 后25%→3 |
| **B5** 并发与弹性 | 1/5/20 并发下成功率与 P95 衰减 | 降幅 <10%→10 / <30%→7 / >50%→2 |

### 2.2 探针框架（`server/engine/harness/probes/index.js`）

| 探针 | 用途 | 说明 |
|------|------|------|
| `loop-trap` | 循环陷阱注入 | 同工具同参数重复 10 次诱因 + 检出判定（供 A3/A4） |
| `tool-fault` | 工具故障注入 | 中途注入 timeout/rate_limit/permission_denied + 恢复判定（供 A8） |
| `side-effect` | 侧效应探针 | **M3 预置，M2 不启用**（须一次性沙箱） |

**安全约束**：探针模块**只返回定义与判定函数，不执行任何真实副作用操作**。

### 2.3 API 扩展

- `POST /api/harness/eval` 新增入参：`peerTokens` / `bestSteps` / `unitPrice` / `toolCost` / `peerCosts` / `loads` / `trapSpec`
- 新增 `GET /api/harness/probes`（返回探针定义）

### 2.4 测试

`test/harness-m2.test.js` —— **19 用例全通过**；全量回归 **7 个测试文件全绿**。

---

## 三、协议条款落地核验

| 协议条款 | 落地 |
|---------|------|
| §7.2 B1-B5 判定阈值 | ✅ 全部按协议表实现 |
| §7.2 采集三通道（探针） | ✅ 探针框架落地（loop-trap / tool-fault） |
| §7.2 字段缺失 → N/A | ✅ B2/B3/B4 缺 tokens、B5 缺负载数据均标 N/A |
| §7.4 抗游戏化 | ⏳ M3（复用 GDI 反博弈模式） |
| §7.5 侧效应 | ⏳ 探针已预置，M3 启用 |
| §7.3 Δ 基线 | ⏳ M3 落地 |

---

## 四、端到端冒烟（实测）

```
GET  /api/harness/health    → implemented: [A3,A9,B1,B2,B3,B4,B5]
GET  /api/harness/probes    → loop-trap / tool-fault / side-effect(未启用)
POST /api/harness/eval      → 7 项指标；本例 A3/A9 无数据标 N/A，B 群全 10
```

---

## 五、M2 后剩余

| 里程碑 | 内容 |
|--------|------|
| **M3 · 健壮性群 + Δ**（P1） | A1/A2/A4-A8 全量 + `delta.js` + 呈现净化 + 抗游戏化 + 侧效应 |
| **M4 · 集成发布**（P1） | 子群 C（C1/C2）+ v2.4.0 正式版 + README/协议头同步 + check-doc-sync |

---

## 六、备注

- 分支 `feat/harness-domain`，未合 master、未推送。
- **M3 的 Δ 基线会真实消耗模型额度**（裸模型对照），进 M3 前需先确认。

---

*M2 完成 · 2026-10-07 · 若兰 🌸*
