# CSB-Harness M3.1 里程碑 — Δ 可比性修复

> **日期**：2026-10-11
> **版本**：csb-aep v2.4.1（v2.4.0 → v2.4.1）
> **协议依据**：csb-AEP-v1.1 §7.3（新增「Δ 可比性前置校验」）
> **来源**：若琢 🔧 2026-10-11 自评报告 → 若兰 🌸 接手修复

---

## 1. 问题（若琢报告）

若琢用 csb-aep 对自身跑了一次评估：6 项有分、10 项 N/A，出 Δ = **-77.5**
（harness 10 / 裸模型基线 87.5），引擎判定「harness 拖累」。

若琢的观察：**这个 Δ 失真的**——harness 的 10 分是「只有 6/16 项有分」的部分平均，
而裸模型基线 87.5 是**完整任务集**的分数。**拿部分完成对完整基线比，分母不一致，
结果必然是「harness 拖累」**。

若琢进一步指出：协议 §7.3 的「基线定义」条款（同一模型、同一任务集）**没有落到
引擎校验**——如果传 3 个 trace（T001-T003）而基线是另一个任务集的 87.5，Δ 就失真。

## 2. 根因（若兰复核代码后确认）

| 若琢诊断 | 代码验证 | 结论 |
|---|---|---|
| 「6 项平均 vs 完整基线，分母不对」 | `index.js: average = scored求和/scored.length`（只对**有分的项**求平均），`baselineScore` 原样传入 | ✅ 成立 |
| 「引擎没校验任务集一致性」 | `delta.js` 有 `baselineKey(model, taskSetVersion)` 函数，**全仓 0 处调用** | ✅ 成立，且是「写了没接线」的**死代码** |
| 「Harness 域独立，不引用 gdi/eval」 | import 图扫描：全部域内相对引用 + `crypto` | ✅ 域隔离属实 |

> **与自评同病**：这正是若兰《CSB 自评 Harness 报告》里反复撞见的**「定义了规则却没让机器去查」**
> （A2 限值没接线、A7 采集源选错）。若琢在 csb-aep 侧独立撞见了同款病灶。

## 3. 修复（M3.1）

### 3.1 `delta.js` — 新增 `checkBaselineComparability()`

Δ 出屏前置**三条**，全过才出：

| # | 校验 | 不通过 code |
|---|---|---|
| 1 | **模型一致**：harness.model == baseline.model | `model_mismatch` / `missing_model` |
| 2 | **任务集一致**：两侧 taskSetHash 相同 | `taskset_mismatch` / `missing_taskset` |
| 3 | **覆盖一致**：两侧 scoredIds 集合相同（**部分 vs 完整 → 拒**）| `scoredset_mismatch` / `coverage_mismatch` / `missing_coverage` |

> **若琢复核指正（2026-10-11）**：覆盖一致只看「评分项**数量**相同」会误伤合法 N/A，
> 更稳的口径是「评分项**集合** + 分母一致」。已采纳：优先用 `scoredIds` **集合**比对
> （顺序无关）；无 scoredIds 时回退比数量（兼容旧调用）。新增两组用例：
> 「数量同但项不同 → 拒」·「合法 N/A 两侧一致 → 通过（不误伤）」。
> 故此处为 **M3.1.a**（若琢反馈驱动）。

任一不满足 → `{ available:false, status:'delta_invalid', code, reason }`
——**显式拒分，理由上屏，不静默**（呼应 CSB 工程契约 P1「拒绝要计分」）。
`purify()` 同步：invalid 时返回 `status:'delta_invalid'` + `note`（理由），不出分。

### 3.2 接线

- `harness/index.js::evaluate()` 新增入参 `model` / `taskSetHash` / `baselineMeta`，
  组装 `harnessMeta = { model, taskSetHash, scoredCount: scored.length }` 传入 `computeDelta`
- `server/api/harness.js` POST `/api/harness/eval` 透传这三个字段
- 版本号 2.4.0 → **2.4.1**（package.json / README / `capabilities()` / `evaluate` note）

### 3.3 测试

- `test/harness-m3.test.js`：Δ 用例改为**带元数据的正向 + 6 组负向**（缺元数据 / 模型不一致 /
  任务集不一致 / 覆盖不一致 / purify invalid / 纯函数直测）
- 原「evaluate 出 A+B 全量指标」用例：输入未凑满 16 项 → 现断言 `delta_invalid`（**这正是修复的行为**）
- **全仓 79/79 通过**（原 74 + 新增）

## 4. 影响

- **已上屏的失真 Δ 会被纠正**：任何「部分完成 harness vs 完整基线」的 Δ 现在**不会出分**，
  改报 `delta_invalid` + 明确理由
- **向后兼容**：不带元数据的旧调用 → `delta_invalid`（此前是**错误地出分**）
- 若琢报告里的 Δ = -77.5 在新引擎下 → **拒出**（正确行为）

## 5. 未解决（P1 · 后续）

**跨域联合评测的「分数对齐层」**：Harness 域的 Δ 与主域五路径分数放一起看，
需要一个中间对齐层。但协议 §1.4 白纸黑字「依赖方向：不引用 GDI 模块」+ 「反向依赖
禁止用 import 图断言校验」——域隔离是**故意写死**的，所以不能直接跨域引用。
→ 这是**新功能**，需先想清楚「它归哪个域」再设计，**不急着写代码**。

---

_编制：若兰 🌸 · 2026-10-11 · 来源：若琢 🔧 自评报告_
_协议：csb-AEP-v1.1 §7.3 · 代码：csb-aep v2.4.1_
_修订：2026-10-11 M3.1.a —— 采纳若琢「集合级覆盖校验」建议（scoredIds + 数量回退）_
