# CSB-Harness 工程域 · M1 里程碑（地基）落地报告

> 执行：若兰 🌸 | 2026-10-07 | 版本：csb-aep v2.4.0-M1
> 协议依据：`csb-aep/csb-agent-eval-protocol/csb-AEP-v1.1.md` §7（协议组三轮评审通过 · 7 席签字）

---

## 一、M1 范围（协议 §7.2 + 实现清单 §6）

| 里程碑 | 内容 | 验收 | 状态 |
|--------|------|------|:----:|
| **M1 · 地基**（P0） | Manifest 规范 + Trace 规范 + 采集适配器 + A3/A9/B1 试点 3 项 | 3 项可跑；capabilities 正确报告 | ✅ **完成** |

---

## 二、交付物

### 2.1 引擎（`server/engine/harness/`）

| 文件 | 职责 |
|------|------|
| `manifest.js` | Harness Manifest 解析与校验（loop.max_iterations / sandbox.fs_boundary 必填；fields 须覆盖 step/tool/tokens） |
| `trace.js` | csb-trace-v1 读取、规范化、统计（步数/工具/token/错误 + P50/P95） |
| `adapters/index.js` | 采集适配器：csb-trace-v1（原生）/ otel / claude-code |
| `robustness.js` | 子群 A 试点：**A3** 循环与步数控制 · **A9** 确定性 |
| `cost.js` | 子群 B 试点：**B1** 延迟（TTFT/P95） |
| `index.js` | HarnessEvaluator：编排 + 能力公示 |

### 2.2 API（`server/api/harness.js`）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/harness/manifest` | POST | 提交/校验 Manifest |
| `/api/harness/eval` | POST | 创建评测（manifest + traces + traps + runs） |
| `/api/harness/eval/:id` | GET | 评测结果 |
| `/api/harness/evals` | GET | 评测列表 |
| `/api/harness/capabilities` | GET | 能力公示（可测项 / N/A 策略） |
| `/api/harness/health` | GET | 健康检查 |

### 2.3 测试

`test/harness-m1.test.js` —— **22 用例全通过**；全量回归 6 个测试文件全绿。

---

## 三、协议条款落地核验

| 协议条款 | 落地 |
|---------|------|
| §7.2 前置条件：Manifest / Trace | ✅ 两者缺则相关指标标 `N/A`，不硬凑分 |
| §7.2 A3 判定阈值 | ✅ 检出率 100% 且 ≤3 步→10 / ≥80%→7 / <50%→2 / 无 loop_guard→0 |
| §7.2 A9 判定阈值 | ✅ 一致率 ≥0.95→10 / ≥0.80→7 / <0.60→2 |
| §7.2 B1 判定阈值 | ✅ P95 ≤5s→10 / ≤15s→7 / ≤30s→5 / >30s→2 |
| §1.4 三域隔离 | ✅ 独立路由 `/api/harness/*` + 独立 store `data/harness/` + 引擎不 require gdi/eval（测试断言） |
| §7.3 Δ 基线 | ⏳ M3 落地（本域已标注「无 Δ 不上屏」） |

---

## 四、端到端冒烟（实测）

```
GET  /api/harness/health        → {"status":"ok","version":"2.4.0-M1","implemented":["A3","A9","B1"]}
POST /api/harness/manifest      → {"valid":true}
POST /api/harness/eval          → {"ok":true,"id":"harness-...","result":{...A3=10...}}
GET  /api/harness/evals         → {"evaluations":[{...avg:10}]}
```

---

## 五、M1 未覆盖（留待后续里程碑）

| 里程碑 | 内容 |
|--------|------|
| **M2 · 性能群**（P0） | B1-B5 全量 + 探针框架（loop-trap / tool-fault） |
| **M3 · 健壮性群 + Δ**（P1） | A1/A2/A4-A8 全量 + `delta.js` + 呈现净化 |
| **M4 · 集成发布**（P1） | 子群 C（C1/C2）+ v2.4.0 正式版 + README/协议头同步 + check-doc-sync |

---

## 六、备注

- 本里程碑在 **`feat/harness-domain` 分支**开发，未合 master、未推送。
- M1/M2 为纯工程（不需模型额度）；**M3 的 Δ 基线会真实消耗模型额度**，届时需先确认。

---

*M1 完成 · 2026-10-07 · 若兰 🌸*
