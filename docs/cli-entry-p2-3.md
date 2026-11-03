# 统一 CLI 入口 `csb`（P2-3 · 2026-11-03）

> 对应 `from-zhiwei/csb_harness_v2_upgrade_plan_v1.md` §7 P2-3：
> 学 OpenHarness `--dry-run` 的三态输出（ready / warning / blocked），
> `csb eval --dry-run` 先告你「这次会判不了什么」。

## 一、为什么要有这一步

不是「再包一层命令行」。是这个毛病：

> 跑之前没人知道这次**会判不了什么**。
> 于是跑完一堆 `UNDECIDED`，被人当成「结果不好」，而不是「条件没备齐」。

判据散在 30+ 脚本里，权重表在 `config/`，采集档位在适配器，判据指纹在另一个仓。
每次自评都要人肉记住「哪条命令 + 哪些参数 + 跑完看哪个字段」——这不叫可复现。

## 二、三态口径（与 verdict 内核同源）

| 状态 | 含义 | 退出码 |
|---|---|:-:|
| `ready` | 条件齐备，跑下去能得到判定 | **0** |
| `warning` | 能跑，但**有项目会变成 UNDECIDED**（已逐条列出） | **1** |
| `blocked` | 跑也白跑：目标不可达 / 判据不可信 / 无评测对象 | **2** |

退出码复用 `server/engine/verdict` 的 `GATE_EXIT`（PASS=0 / FAIL=1 / UNDECIDED=2），
**不另定一套** —— 两套退出码就是两种「判不了」，人还得再记一遍哪个是哪个。

> 注意语义差别：`blocked(2)` 在 CLI 里是「条件不齐，跑也白跑」，
> 在判定链里是 `UNDECIDED`（判不了）。两者都不是「做错了」(1)。
> 这条线不能糊 —— 糊了就会出现「CI 红灯 = 代码有问题」的误读。

## 三、用法

```bash
csb eval --dry-run                              # 只体检，不发任何 A2A 消息
csb eval --url 172.28.0.4:3100 --dry-run
csb eval --path mutual --peers a:3100,b:3100 --dry-run
csb eval --url host:port --json                  # 机读
csb paths                                        # 五路径实现状态

# ── 真跑（不带 --dry-run）──
csb eval --path archaeology --agent-path /path/to/agent   # ③ 离线可判
csb eval --path structure --url host:port                 # ④ 需目标在线
csb eval --path emergence --url host:port                 # ⑤ 需目标在线
csb eval --path mutual --peers a:3100,b:3100              # ② 需评审者在线
```

### 真跑时会发生什么

1. 先跑同一套体检
2. **`blocked` → 一条评测请求都不发**（白烧 token 又拿回一堆 UNDECIDED 没意义）
3. 通过 → 在**同一进程内**构造 `EvalAPI` 调 `createEval`，与 HTTP 接口同一份代码
4. 输出把**体检结论**与**评测结论**分开展示（合成一个分就会出现「因为 blocked 所以 0 分」）

> 为什么不打自己家的 HTTP：那会变成第二条发请求的路径，
> 出现「CLI 跑了一部分、HTTP 又跑了一部分」的两份结果。
> `test/cli-real-run.test.js` 用 `!/json-rpc/` 反证 CLI 没有自己拼 A2A 请求。

安装后可直接 `csb`（`package.json` 已声明 `bin.csb → scripts/csb.js`）；
未安装时 `node scripts/csb.js ...` 等价。

## 四、体检项（每一项都带可执行的修复建议）

| 项 | 判据 | 状态 |
|---|---|---|
| 目标可达 | TCP 连接成功（**不发 A2A 消息**） | blocked 若连不上 |
| 互评评审者 | 至少 1 位可达；< 2 位 → warning（互评退化成单评） | warning/blocked |
| 判据指纹 | 与 `scripts/criteria-check.js` **同一份** config，`config_hash` 实算一致 | blocked 若不一致 |
| 白盒路径 | `--agent-path` 存在且可读 | warning 若未给 |
| 采集档位预估 | 当前最高档 → 必然判不了哪些指标 | warning |

**关键设计：dry-run 零副作用。**
探针只做 TCP 连接 + 读本地文件，**一条 A2A 消息都不发**。
`test/cli-dry-run.test.js` 用假 HTTP 服务端锁死这条（零请求才算过），
所以它可以安全地进 CI / pre-commit / 每 20 分钟巡检。

## 五、判据（可机械核对）

```
node test/cli-dry-run.test.js     → 10/10
npm test                          → 179 tests / 179 pass / 0 fail
```

其中与「诚实」直接相关的三条：

1. **无任何条件 → blocked(2)**，不是 ready、也不崩溃
2. **`--json` 的 `exitCode` 必须等于进程退出码**（两处不一致 = 假绿）
3. **dry-run 对假服务端零请求**（发了就不叫 dry-run）

## 六、诚实边界（这版没做的）

1. **只有 `eval` 一个子命令**。`csb gdi` / `csb harness` 未接，目前仍需走 HTTP。
2. **真跑不带 `--dry-run` 时才发请求**，且只跑用户**显式**给的路径（`--path`）；
   不给驱动条件时直接报 blocked，不会自作主张选一条路径。
3. **采集档位是「预估」不是实测**：适配器目前无人声明 `hooks:true`，
   所以固定报 protocol 档。真档位由 `buildReportReceipt` 从证据算（P1-1）。
4. 五路径 ①~⑤ 均已接（③④⑤ 见 `docs/paths-345-...-p2-2.md`），
   **但 ⑤ 不产出质量分**（`score` 恒 null，只给 `emergenceRate`）。

## 七、踩过的三个坑（都已在代码/测试里锁住）

| 坑 | 现象 | 锁在哪 |
|---|---|---|
| `--json` 混入引擎日志 | `JSON.parse` 崩在 `[AEP] ...` | 真跑时日志改道 stderr；测试断言 stdout 无日志行 |
| 默认路径凭“没给 url”就选 mutual | 用户什么都不给，却被怪“缺 --peers” | 只有 `--peers` 才推 mutual；无任何驱动条件 → 报“无评测对象” |
| `host:port` 缺 scheme | `new URL` 抛 Invalid URL，白等 9 秒重试 | `BlackBoxEngine.normalizeUrl()` |

## 八、判据

```
node test/cli-dry-run.test.js   → 12/12
node test/cli-real-run.test.js  → 8/8
npm test                        → 191 tests / 191 pass / 0 fail
```

---

_2026-11-03 · 若兰_