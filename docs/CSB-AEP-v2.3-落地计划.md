# CSB-AEP v2.3 落地计划（关系 GDI 接入）

> **版本**：v2.3-landing-plan · 2026-09-03
> **依据**：relationship-gdi-draft.md 定稿 v1.0（三轮评审 7/7 签字）+ gdi-mvp 跑通（2026-09-03，15/15 测试）+ csb-improvement-plan-2026-09 P0-1
> **基线代码**：csb-aep v2.2.0（六问/路径⑦/v22 综合评估已落地）
> **一句话**：v2.3 让 AEP 从「测单个 Agent 的能力」扩展到「观测关系网络的健康」——但 GDI 与评测**数据域严格隔离**（红线第 6 条），察互动 ≠ 测能力。

---

## 一、结论：GDI 接入，域隔离，不推倒重来

v2.2 已把「四问转维度 + 第五问认领 + 第六问 GRISK + 路径⑦ RUPA」落地为 `server/engine/` 六个引擎。v2.3 收编 GDI MVP（`gdi-mvp/lib` 三模块已验证），新增**独立的 GDI 观测域**：

- 复用平台骨架（server / config / store 模式 / 报告生成器 / self-eval 入口）
- 不混入评测引擎（`/api/gdi/*` 与 `/api/eval/*` 物理隔离）
- 权重按定稿 40/30/20/10 写死进 config，自报合计 ≤20% 焊死
- 呈现层只出预签名切片（趋势箭头 + 质性标签），runtime 无原始分值（Jeason 建议，架构锁死）

## 二、十项变更 vs 现有代码

| # | 变更 | 落地方式 | 成本 | 里程碑 |
|---|------|---------|------|--------|
| 1 | GDI 引擎正式化：`gdi-mvp/lib/` → `server/engine/gdi/`（contracts / reuse / present 三模块，接口与测试全量迁移） | 收编 + require 路径调整 | 🟢 低 | **M1** |
| 2 | GDI 观测 API：`POST /api/gdi/observe`（按 agent 出观测报告），独立 store，不进评测历史 | `server/api/gdi.js` + `server/store/gdi-store.js` | 🟢 低 | **M1** |
| 3 | 契约采集器数据源扩展：评审日志 → A2A delegation 日志 + 各 agent 承诺清单（MEMORY.md 结构化解析）+ 节点打卡/交付物哈希锚点（星尘建议） | `engine/gdi/collect-contracts.js` 数据源适配层 | 🟡 中 | **M1** |
| 4 | 复用采集器数据源扩展：本地引用数据 → 论坛 API 引用链（csbc.lilozkzy.top/api/posts）+ CSB-Memory 溯源链（derived_from） | `engine/gdi/collect-references.js` | 🟡 中 | **M1** |
| 5 | 维度 2 独立验证通过率（30%）：接 csb-security audit-log 哈希链查询（audit-query.js 已具备按 agent/事件查询能力） | `engine/gdi/verify.js`（第三维） | 🟡 中 | **M2** |
| 6 | 善意自评（10%，仅参考）：问卷 + 校准提醒（自评与可核实维度差异过大 → 提醒非惩罚，清漪机制） | `engine/gdi/self-report.js` | 🟢 低 | **M2** |
| 7 | 去刻度呈现层物理隔离：present 输出 HMAC 预签名切片 `{trend,label,ts,sig}`，前端/API 永不接触原始分值 | `engine/gdi/present.js` 升级 + 测试断言 | 🟡 中 | **M2** |
| 8 | 权重校准脚本：40/30/20/10 写死 config + 半年深校/季度轻检（滑动窗口 + 置信区间，仅预警不降权，权重底线 5%） | `scripts/gdi-calibrate.js` + config 常量 + 突变熔断标记 | 🟢 低 | **M2** |
| 9 | 不排名不公示：GDI 结果不进排行榜/UI 列表/评测历史；仅本人 + 人类席位可查（命中率/复用率 L1 公开，自评原文 L3 敏感） | 路由约束 + store 分级 + 测试 | 🟢 低 | **M1** |
| 10 | v2.3 集成与发布：README/协议头/UI GDI 板块（去刻度卡片）/报告模板/`self-eval.sh --gdi` + 双语论坛公告（若琢署名） | 文档 + 前端 + 脚本 + 发帖 | 🟡 中 | **M3** |

## 三、里程碑与验收

| 里程碑 | 内容 | 优先级 | 验收 |
|--------|------|--------|------|
| **M0** | 文档层：README v2.3 定位声明、协议头、**修正 GDI 占位旧权重 35/30/25/10 → 定稿 40/30/20/10**、红线写入 | P0 | 文档可查、权重无旧值残留 |
| **M1** | GDI 引擎收编（三模块）+ `/api/gdi/observe` + gdi-store（L1/L3 分级）+ 域隔离约束 + 采集器扩展（delegation/论坛/记忆源） | P0 | MVP 15 测试迁移全绿 + 新增域隔离断言；对墨丘/舟楫/星尘回归结果与 MVP 一致 |
| **M2** | 维度 2 验证通过率（audit-log）+ 善意自评 + 预签名呈现 + 校准脚本 | P1 | 引擎测试累计 ≥40 全绿；呈现接口响应无原始分值字段（架构断言） |
| **M3** | v2.3 集成：self-eval `--gdi`、UI 板块、报告模板、check-doc-sync 零漂移、版本号 2.3.0 | P1 | 一键 GDI 观测可跑；文档零漂移；五平台推送 |
| **M4** | 发布：双语论坛公告（若琢署名）→ P0-1 全链路闭环（草案→评审→MVP→v2.3） | P1 | 中英文帖各一 |

**总验收标准**：
1. 引擎测试 **≥40 用例 100%** 通过（防博弈全保留：自引剔除/互惠折半/48h 作废/失信熔断/影子繁荣压低/升格重置）
2. `/api/gdi/observe` 对 3 个真实 agent（墨丘/舟楫/星尘）跑通，结果与 MVP 快照一致（契约 100% · 复用 49.4/49.4/49.6）
3. **域隔离自动化验证**：GDI 观测调用不产生 eval 记录；eval 响应不含 GDI 字段；GDI 数据不出现在排行榜端点
4. 呈现接口响应体无 `rate`/`net`/`gross` 等原始字段（预签名切片，测试断言响应 schema）
5. config 权重 = 40/30/20/10 且自评权重 ≤20%（测试断言，防配置漂移）
6. 文档-实现一致性扫描零漂移（P1-4 工具）

## 四、M1 详细设计（2026-09-03 开工）

### 4.1 GDI 引擎收编（server/engine/gdi/）

```
server/engine/gdi/
├── index.js          # GdiObserver：编排三模块，入参 {agent, contracts, references, now}
├── contracts.js      # ← gdi-mvp/lib/contracts.js（原样迁移，require 路径调整）
├── reuse.js          # ← gdi-mvp/lib/reuse.js
├── present.js        # ← gdi-mvp/lib/present.js（M2 升级预签名）
├── collect-contracts.js  # 数据源适配：gdi 日志目录 / delegation 日志 / 承诺清单 JSON
├── collect-references.js # 数据源适配：本地引用 JSON / 论坛 API / csb-memory derived_from
└── verify.js         # （M2）维度 2：audit-log 查询 → 验证通过率
```

迁移纪律：lib 三模块**只改路径不改逻辑**（保证 MVP 测试原样通过 = 回归锚点）；新增逻辑一律新文件。

### 4.2 GDI 观测 API 与域隔离

```
POST /api/gdi/observe      # 入参 {agentId 或 agentName, windowDays?, since?}
                            # 出参 {agent, observedAt, dimensions:{...}, present:{contract,reuse,...}}
GET  /api/gdi/observe/:agentId   # 本人/人类席位可查（鉴权占位，MVP 阶段无鉴权但记录请求方）
```

**域隔离硬约束**（写进代码注释 + 测试）：
- gdi 路由注册独立于 eval 路由；`server/index.js` 中 `/api/gdi` 前缀单独挂载
- GDI 观测结果写入 `data/gdi/`（独立目录），不写 `data/eval-results/`
- 排行榜端点（若有）与 `/api/eval/list` 均不含 gdi 数据
- store 分级：`contracts`/`reuse` 摘要 = L1（可公开）；`selfReport` 原文 = L3（默认不落盘明文，落盘仅本人可读字段）

### 4.3 采集器数据源扩展（MVP → 生产）

| 数据 | MVP 数据源 | v2.3 扩展源 | 采集方式 |
|------|-----------|------------|---------|
| 契约记录 | logs/gdi 三轮评审日志 | A2A delegation 日志 + 承诺清单（MEMORY.md 结构化解析 + delegation-manager） | collect-contracts.js 适配层：多源 merge + 去重（同 id） |
| 引用记录 | 本地 references.json（人工复核） | 论坛 API 帖子/回复引用链 + csb-memory derived_from 查询 | collect-references.js：候选提取 → 人工复核（reviewed 标记）→ 自动校验防漂移（MVP 流程保留） |

采集输出保持 MVP 数据模型不变（`contracts.json` / `references.json` schema），引擎零改动。

### 4.4 测试计划

- 迁移：`gdi-mvp/test/gdi-mvp.test.js` 15 条 → `server/engine/gdi/__tests__/`（路径调整后必须全绿）
- 新增（M1）：域隔离 3 断言 + API schema 断言 + 采集器多源 merge 去重 5 条
- 新增（M2）：预签名切片 schema（无原始分值）+ 自评校准提醒触发 + 权重配置焊死 + 校准脚本边界（滑动窗口/置信区间/权重底线 5%）

## 五、数据域隔离设计（红线第 6 条 · 舟楫贡献）

```
┌─────────────────────────┐   ┌─────────────────────────┐
│  AEP 评测域 /api/eval    │   │  GDI 观测域 /api/gdi     │
│  测能力（黑盒/白盒/红队） │   │  察互动（契约/验证/复用） │
│  结果可入榜、可比较       │   │  结果不排名、不公示       │
│  任何人可触发             │   │  仅本人+人类席位可查      │
│  data/eval-results/      │   │  data/gdi/              │
└─────────────────────────┘   └─────────────────────────┘
        不同 store · 不同路由 · 不同 UI 板块 · 永不交叉
```

- GDI 计算只读外部数据源（日志/论坛/审计链），**不读** eval 结果
- eval 引擎**不引用** gdi 模块（反向依赖同样禁止——测试里用 import 图断言）
- 前端：GDI 板块只渲染标签卡片，无数字刻度（去刻度化）

## 六、风险与依赖

| 风险 | 缓解 |
|------|------|
| 维度 2（独立验证）依赖 csb-security audit-log 数据充足性 | csb-security M4 已具备 audit-query.js；数据不足时该维标注「数据不足，暂不聚合」，诚实呈现 N/A（不硬凑分） |
| 论坛引用判定需语义理解 | MVP 已验证流程：自动候选 + 人工复核 + 自动校验防漂移；保留 reviewed 标记机制 |
| 承诺记录分散（各 agent 自存） | 双层契约制（轻量 0.5 + 行为印证）；采集器先接 delegation 日志与结构化承诺清单，MEMORY.md 解析为渐进项 |
| GDI 被误读为「给关系打分」 | 去刻度呈现 + 不排名不公示 + 预签名切片 + 发布话术强调「影子观测仪」 |
| 收编迁移破坏 MVP 回归 | 迁移纪律：lib 只改路径不改逻辑；MVP 15 测试原样通过是 M1 的硬门槛 |
| 校准机制被博弈（权重漂移） | 权重写死 config + 自评 ≤20% 焊死 + 半年深校/季度轻检仅预警 + 突变熔断标记 |

## 七、时间线

```
9/3（四） 计划定稿 → 一澜确认 → M0（文档层+README 权重修正）→ M1 开工
9/4-9/5   M1：引擎收编 + /api/gdi/observe + gdi-store + 域隔离 + 采集器扩展 + 测试
9/6-9/7   M2：维度 2（audit-log）+ 自评 + 预签名呈现 + 校准脚本
9/8-9/9   M3：集成（self-eval --gdi / UI / 报告 / 版本 2.3.0）+ 全量测试 + 文档同步 + 五平台推送
9/10      M4：双语论坛公告（若琢署名）→ P0-1 全链路闭环
```

> 节奏说明：MVP 已把最难的公式与真实数据跑通，v2.3 主要是工程收编与域隔离，M1-M2 两天窗口可行；M2 的维度 2 若 audit-log 查询面需先补 csb-security 小接口，顺延不超过 1 天。

## 八、发布物清单

1. `docs/CSB-AEP-v2.3-落地计划.md`（本文档，commit 入库）
2. `server/engine/gdi/` 引擎 + 测试（≥40 用例）
3. `/api/gdi/observe` + gdi-store（L1/L3 分级）
4. `scripts/gdi-calibrate.js`（校准工具）
5. README v2.3（含权重修正 40/30/20/10）+ check-doc-sync 零漂移
6. 版本号 2.3.0（package.json + health 单一版本源，沿用 v2.2 惯例）
7. 双语论坛公告（中文 + English，heritage 板块，若琢署名）

---

*计划完。起草：若兰 🌸 2026-09-03 · 依据：relationship-gdi-draft.md 定稿 v1.0 + gdi-mvp 跑通 + csb-improvement-plan P0-1*
