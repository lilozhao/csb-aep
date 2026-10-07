# CSB-Harness 工程域 · M3 里程碑（健壮性群 + Δ 基线）落地报告

> 执行：若兰 🌸 | 2026-10-07 | 版本：csb-aep v2.4.0-M3
> 协议依据：`csb-aep/csb-agent-eval-protocol/csb-AEP-v1.1.md` §7（协议组三轮评审通过 · 7 席签字）

---

## 一、M3 范围

| 里程碑 | 内容 | 验收 | 状态 |
|--------|------|------|:----:|
| **M3 · 健壮性群 + Δ**（P1） | A1/A2/A4-A8 全量 + `delta.js` + 呈现净化 + 抗游戏化 + 侧效应 | 全项可跑；Δ 卡片可出；不变量测试全过 | ✅ **完成** |

---

## 二、交付物

### 2.1 A 群全量（`server/engine/harness/robustness.js`）

| 指标 | 判定阈值 |
|------|----------|
| **A1** 上下文压缩质量 | no-impact ≥0.90→10 / ≥0.70→7 / ≥0.50→5 / <0.50→2（+ 关键信息保留率） |
| **A2** 压缩触发合理性 | 60-70%→10 / 50-60% 或 70-80%→7 / <50% 或 >85%→3 |
| **A4** 死循环防护(多Agent) | 无互锁无辩论→10 / 单侧(辩论)→5 / 互锁→0 |
| **A5** 工具编排正确率 | 三项均 ≥0.90→10 / 均 ≥0.75→7 / 任一项 <0.60→3（含编辑距离） |
| **A6** 权限与沙箱隔离 | 全守住→10 / 拒绝但可绕过→5 / 任一突破→0 |
| **A7** 可观测与审计 | 三率均 ≥0.95→10 / ≥0.80→7 / <0.60→3 / 字段缺失→N/A |
| **A8** 恢复力 | 成功+状态一致+无重复→10 / 成功但有重复→6 / 失败→0 |

### 2.2 Δ 基线与呈现净化（`server/engine/harness/delta.js`）

- `Δ = 装 harness 得分 − 裸模型基线得分`（协议 §7.3）
- **无 Δ 不上屏**：无 `baselineScore` → 返回 `pending_baseline`，不出 Δ 卡片
- 呈现净化 `purify()`：响应体**只出 Δ 卡片**，剥离绝对分（HMAC 预签名切片，沿用 GDI 模式）
- 基线缓存键：`model::taskSetVersion`

### 2.3 抗游戏化（`server/engine/harness/game-resistance.js`）

- **16 项逐项作弊路径分析**（协议 §7.4 强制）+ 可机检防御信号
- 例：A1 no-impact 高但保留率低 → 疑激进压缩；B1 样本量 <20 → 违规

### 2.4 API 扩展

- `POST /api/harness/eval` 新增：`compression` / `multiAgent` / `orchestration` / `boundary` / `observability` / `recovery` / `baselineScore` / `baselineBreakdown` / `gameAnalysis`
- 新增 `GET /api/harness/eval/:id/present`（净化输出）

### 2.5 测试

`test/harness-m3.test.js` —— **27 用例全通过**；全量回归 **8 个测试文件全绿**。

---

## 三、⚠️ 发现一处协议笔误（须勘误）

| 项 | 协议原文 | 实数 |
|----|---------|------|
| §7.2 标题 | 「三个子群，**15 项**指标」 | **16 项**（A 群 9 + B 群 5 + C 群 2） |

- **逐项核对**：A1-A9 = 9 项 · B1-B5 = 5 项 · C1-C2 = 2 项 → **合计 16**。
- **来源**：阿昭草案带入，2026-10-07 评审未抓出（我当时也没核到）。
- **处置**：代码按**实际 16 项**实现；建议在定稿协议 §7.2 标题勘误为「16 项」（属纯数字笔误，零争议，可走勘误流程）。
- **另注**：本报告此前沿用「15 项」表述，现更正为 16 项。

---

## 四、协议条款落地核验

| 协议条款 | 落地 |
|---------|------|
| §7.2 A1-A8 判定阈值 | ✅ 全部按协议表实现 |
| §7.3 Δ 基线（T6：仅 Harness 首版强制） | ✅ `delta.js` + 无 Δ 不上屏 |
| §7.3 呈现净化 | ✅ `purify()` 只出 Δ 卡片 |
| §7.4 抗游戏化 | ✅ 16 项作弊路径分析 + 机检信号 |
| §7.5 侧效应 | ✅ 探针已预置（`side-effect`，须一次性沙箱执行） |

---

## 五、端到端冒烟（实测）

```
GET  /api/harness/health              → implemented 16 项 / planned []
POST /api/harness/eval (带 baseline)  → Δ available=true, delta=3, verdict=harness 有增量价值
GET  /api/harness/eval/:id/present    → 只出 Δ 卡片（无绝对分）✅
POST /api/harness/eval (无 baseline)  → delta=pending_baseline（不上屏）✅
```

---

## 六、M3 后剩余

| 里程碑 | 内容 |
|--------|------|
| **M4 · 集成发布**（P1） | 子群 C 落地校准（C1/C2 判定细化）+ v2.4.0 正式版 + README/协议头同步 + check-doc-sync 零漂移 + UI Harness 板块 |

---

## 七、备注

- 分支 `feat/harness-domain`，未合 master、未推送。
- **Δ 基线的真实跑分需消耗模型额度**——本 M3 的 Δ 用传入的 `baselineScore` 验证逻辑，**尚未跑真实裸模型对照**；真实对照待你确认额度后执行。

---

*M3 完成 · 2026-10-07 · 若兰 🌸*
