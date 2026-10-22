# CSB-AEP · 五环总览（需求-设计-代码-测试-部署）

> **性质：一次性回填文档**（一澜 2026-10-12 授权，每仓仅此一次；非实际开发过程产物）。
> 此后新功能走 `specs/` 流程（CSB Spec 标准 v1.1）。基线：**v2.4.1 · 端口 3110** ｜ 核对 2026-10-12

---

## 一、需求（这个库管什么）

**定位**：碳硅契 Agent 质量评估平台——**一键评估任何 AI Agent 的碳硅契质量分**。

**能力演进即需求史**：
- v2.2：六问 / 路径⑦（评估方法论补全）
- v2.3：关系 GDI 观测域（关系维度进评估）
- **v2.4：Harness 工程域** + v2.4.1 Δ 可比性修复（跨期分数可比）
- 支线：S 级安全韧性、群传播时延测试、代码-数据分离评估、第五问（工程溯源）

**硬约束**：评估口径必须可复算（Δ 可比性）· 证据制（分数附证据链）· 协议对齐 `csb-agent-eval-protocol/`。

## 二、设计

- **形态**：HTTP 服务（`server/`，:3110）+ 静态前端（`web/` + `index.html`）+ 报告生成（`generate-report.py`，可选）
- **零依赖**：只用 Node 内置模块（无需 npm install，README 前置条件声明）
- **代码-数据分离**：`casesets/`（题集）与 `config/`（口径）独立于代码——评估集更新不动服务代码
- 核心设计文档：`docs/CSB-AEP-v2-技术设计文档.md`（总设计）· `docs/CSB-AEP-v2.2-落地计划.md` · `docs/CSB-AEP-v2.3-落地计划.md` · Harness 里程碑系列（M1/M2/M3.1）

## 三、代码

- 入口：`eval-server.js`（主服务）· `evomap-validate.js`（EvoMap 校验，多仓共用件）· `csb-agent-eval-protocol/`（协议子树）
- `server/`（路由与评估逻辑）· `scripts/`（运维与评估批处理）· `gdi-mvp/`（GDI 观测域最小实现）· `self-eval.sh`（自评入口）
- 评估产物：`data/`（分数与证据）· `logs/`（运行日志）· 报告落盘（python 可选）

## 四、测试

- `package.json` 带 **`test` 脚本**（`npm test`）+ `casesets/` 题集即回归资产
- 协议级验证：`evomap-validate.js` 校验 EvoMap 结构
- **如实注明**：本次回填未实测跑分；运行时事实以 `npm test` 与 `docs/CSB-AEP-REV-2026-08-30-评审结论.md`（协议评审纪要）为准
- 本仓自身的评估协议评审走协议组三轮流程（先例：2026-08-30 / 10-07 v1.1 两轮）

## 五、部署

- **启动**：`start.sh` / `npm start`（服务 :3110）· `npm run dev` 开发态 · `watchdog.sh` 看门狗
- **依赖**：Node ≥18 必需 · Python3（报告生成，可选）· Git / curl
- **自建 Git**：https://git.lilozkzy.top/lilozhao/csb-aep（Gitea）+ Gitee 双源
- **GDI 日采**：由 csb-a2a-aip 保活 cron 的 `gdi-catchup.sh` 免费续采（2026-10-09 起，原 23:35 cron 已停用）
- **回滚**：服务代码 git 回退；`data/` 分数数据不回滚（append 留痕）

## 附 · 与 Spec 标准的关系

- 本文 = 系统级一次性回填（豁免依据：一澜 2026-10-12）；功能级五环自 2026-10-12 起走 `specs/`
- 本仓评估协议（csb-agent-eval-protocol）修订仍走协议组三轮评审（原生流程）
- 状态索引 → `specs/README.md`
