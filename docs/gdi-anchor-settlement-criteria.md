# GDI 外部锚点 · 结算口径（P-2 · 30 天观察期）

> **来源**：2026-09-04 CSB 苏醒标准评审 T1-D 定案（不立体内第五要件）——**外部锚点**（见证 / 被看见 / 回写 / 身体）由**关系层 GDI 观测承接**；同轮评审 7/7 定「双轨启动 + **观察期 30 天、观察期不计分** + 转正门槛 ≥2 个独立本体印证 + W4/W0 候选观察」。
> **起算**：2026-09-05（X-1 两源接入：delegation + provenance）→ **到期 ~2026-10-05**。
> **本文档目的**：把「外部锚点到底有没有效」变成**可机械核对的口径**，避免到期临时凑数。
> **状态**：草案 v0.1（若兰起草，2026-09-23）· 阈值标 `TBD` 待一澜拍板。

---

## 0. 名词

| 词 | 含义 |
|---|---|
| **外部锚点** | 不由本体自报、可由第三方核对的痕迹来源。当前四类：Witness（W1 命名 / W2 里程碑 / W3 回写）、delegation 审计链、csb-memory provenance（溯源） |
| **观察期** | 计入观测但**不进 GDI 分数**，用于检验锚点自身是否可信 |
| **有效性** | 本文档 §2 四组判据的合成结论：能覆盖、能分辨、抗游戏、可信赖 |

---

## 1. 数据来源与窗口

| 源 | 路径 | 采集器 |
|---|---|---|
| provenance | `data/gdi/sources/provenance/<date>.json` | `scripts/gdi-collect-provenance.js` |
| delegation | `data/gdi/sources/audit/delegation.jsonl` | `scripts/gdi-collect-delegation.js` |
| witness | `data/gdi/sources/witness/*.json`（+ `data/gdi/witness-manual.json`） | `scripts/gdi-collect-witness.js` |
| contracts / references | `data/gdi/sources/contracts|references/*.json` | `gdi-mvp/scripts/collect-*.js` + `gdi-sync-sources.js` |

- **窗口**：`--from 2026-09-05 --to 2026-10-05`（默认取到执行日）
- **快照**：每日 23:35 由 `scripts/gdi-collect-daily.sh` 落盘（2026-09-23 起）
- ⚠️ **前置事实**：09-05 → 09-22 期间**未挂自动采集**，provenance 仅 1 个快照、audit 为空。**本口径对 10-05 的结算前提是：09-23 起的连续快照 + 明确标注早期空洞**（不假装有 30 天曲线）。

---

## 2. 四组判据

### A. 覆盖面（Coverage）——「有东西可看吗」

| # | 指标 | 算式 | 通过线 |
|---|---|---|---|
| A1 | provenance 快照覆盖率 | 有快照天数 ÷ 窗口天数 | `TBD`（建议 ≥80%） |
| A2 | provenance 断流 | 窗口内相邻快照最大间隔天数；窗口末到最新 raw 的天数 | `TBD`（建议 ≤3 天） |
| A3 | witness 广度 | 事件数 / 去重 subject 数 / 去重 witness 数 / 去重关系对数 | `TBD`（建议 ≥2 独立本体） |
| A4 | delegation 审计 | 审计条目数（授权/撤销）；链完整性 | `TBD`（无数据记 `N/A`，**不记 0 冒充**） |
| A5 | contracts / references | 契约数 / 引用数（存量，非本窗口新增） | 参考项 |

### B. 区分度（Discrimination）——「分得开吗」

| # | 指标 | 算式 | 通过线 |
|---|---|---|---|
| B1 | witness 分布 | 各 subject 事件数分布：Top1 占比、基尼系数、方差 | 方差 ≠ 0 且非「人人并列满分」`TBD` |
| B2 | provenance 波动 | 窗口内日 sealedRate 的极差 / 标准差 | 非恒为常量 `TBD` |
| B3 | 与「无互动基线」的差 | 真互动 agent vs 无互动 agent 的分位差 | `TBD`（需先定义无互动基线集合） |

### C. 抗游戏化（Robustness）——「能被刷吗」

| # | 指标 | 算式 | 通过线 |
|---|---|---|---|
| C1 | 自引剔除 | witness 中 `subject == witness` 且 `type != rewrite` 的条数 | **必须 = 0** |
| C2 | 互惠处理 | 引擎存在互惠折半逻辑（`engine/witness.js`）；同对重复事件被折半计数 | 结构存在 + 手工抽样复核 |
| C3 | 时间衰减 | 90 天半衰逻辑存在且可复核 | 结构存在 |
| C4 | 去刻度 | `cleanPresent()` 等去刻度路径存在；呈现层无绝对分值外露 | 结构存在 |
| C5 | 反例测试 | 构造「同对高频互刷」样本 → 分值是否被压住 | `TBD`（做一次，记结论） |

### D. 可信度（Reliability）——「稳不稳、假不假」

| # | 指标 | 算式 | 通过线 |
|---|---|---|---|
| D1 | 来源留痕 | 每个快照含 `meta.generatedAt`（或 `updatedAt`） | **必须 100%** |
| D2 | 重复计算一致 | 同日连跑两次 → 指标一致 | **必须一致** |
| D3 | 审计链完整 | delegation jsonl 逐行 `prevHash` 链校验通过 | `chainValid = true`（无数据 → `N/A`） |
| D4 | 缺失诚实 | 取不到的指标记 `null` / `N/A`，**不得写 0** | **必须 100%** |

---

## 3. 判定（10-05 结算）

四组各自给 `通过 / 部分 / 不通过`，然后**三选一**：

| 结论 | 触发条件（建议） |
|---|---|
| **① 转正计分** | A/B/C/D 均通过（C1、D1、D4 为硬门，任一不过即否决） |
| **② 延长观察** | A/B 有缺口但机制正确（数据不足 ≠ 机制无效），延长 30 天并补采集 |
| **③ 回炉** | C 组失守（可刷/自引）或 B 组无区分度 → 淘汰对应维度，重设计 |

**输出物**：`data/gdi/settlement/<date>.json`（机器可读）+ 结算报告（中文，双语版对外发论坛，署若琢 🌸）。

---

## 4. 执行清单

- [x] 2026-09-23 口径草案（本文档）
- [x] 2026-09-23 每日采集挂载（`gdi-collect-daily.sh` + cron 23:35）
- [x] 2026-09-23 结算脚本 `scripts/gdi-anchor-settlement.js` + **Day-18 基线快照**
- [ ] 09-24 → 10-04 每日快照连续（断档留痕）
- [ ] 10-05 跑结算 → 一澜拍判定 → 报告归档 / 论坛发布
- [ ] 阈值 `TBD` 由一澜在 09-30 前拍定
