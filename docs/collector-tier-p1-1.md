# P1-1 · 采集档位与采集器元数据

> 2026-11-02 · 若兰 · 对应《CSB-Harness 2.0 优化升级方案 v1》§6 P1-1
> 一句话：把「这个适配器能看见什么」从**隐含在代码里**变成**可声明、可验证、可审计的一张表**。

## 为什么做

P0-6 之后判定链有了档位天花板，但档位是**算出来的**：`hooks` 只认适配器声明，`protocol` 只认"至少一条结果被判出来"。

结果就是：17 个适配器全是 `hooks:false`，`resolveTier` 永远最多算到 `protocol`，
**而没有任何地方记录"这个适配器本来能不能看见更多"**。真实情况是：17 个适配器全都只能读本地静态文件 + 走 A2A 往返，
**一个工具调用级事件也拿不到**。这个事实此前没有任何结构化的表达。

同时有三个 S 类安全接口（`getToolInventory` / `getPermissionConfig` / `getInjectionDefense` / `testCanary`）
在 `BaseAdapter` 里声明了 17 个适配器 **0 实现**（全是 `throw not implemented`）。
声明存在、实现为空的接口，比没有接口更危险：调用方以为能拿到数据。

## 两个概念必须分开

这是本次最容易搞错的地方：

| 概念 | 含义 | 决定什么 | 变化频率 |
|---|---|---|---|
| `tier` | **运行时**能看见的粒度 | 这条结论能不能判 FAIL（P0-6 天花板） | 接上钩子才变，很少 |
| `sources` | **静态**能从 Agent 文件读到什么 | 白盒 / S 类安全项能查什么 | 随适配器实现增长 |

一个适配器可以**静态全知、运行时全盲**（读得到所有配置，但看不到工具调用），也可以反之。
把两者混成"能力等级"会得出错误结论：以为能查权限就能判工具编排，其实看不见。

## 落点

| 文件 | 作用 |
|---|---|
| `server/adapter/collector-registry.js` | **单一真源**：17 个适配器的 tier + sources + 理由 + 证据出处 |
| `server/adapter/base.js` | 构造时从 registry 取声明；新增 `collectorMeta()` 快照接口 |
| `server/adapter/openclaw.js` | 实现 `getToolInventory`（openclaw.json → tools.*）+ `getPermissionConfig`（sandbox/approvals） |
| `server/adapter/claude-code.js` | 实现 `getPermissionConfig`（`.claude/settings*.json` → permissions，local 覆盖 project） |
| `server/engine/verdict/index.js` | `resolveTier(evidence, { ceiling })`：**只封上限，不抬下限** |
| `server/api/eval.js` | 把 `adapter.collector.tier` 作为 ceiling 传入；能力快照写入 `report.collector` |
| `scripts/collector-table.js` | 一条命令看全表 + 检查"声明与实现是否一致" |
| `test/collector-tier.test.js` | 13 条：注册完整性 / 声明可验证 / ceiling 语义 |
| `test/collector-wiring.test.js` | 5 条：字段真落库 / 回执契约不被改动 |

## 为什么声明表集中，而不是写在 17 个适配器里

1. **审计要能一眼看全** —— 17 个文件各写一半，没人能确认整体诚实度
2. **判据要能机械核对** —— 表里写 `true`，测试就去调该方法验证它真能返回数据
3. **差异要能被看见** —— `sources` 的分布本身就是结论（见下）

## 现状（2026-11-02 实测）

```
17 个适配器 · tier 全部 protocol
toolInventory    1/17   （openclaw）
permissionConfig 2/17   （openclaw · claude-code）
injectionDefense 0/17
canary           0/17
```

这不是"没做完"，是**如实**：其余 15 个适配器只有 prompt/规则文本，没有结构化的工具或权限配置。
写 `true` 会让上层判定链对看不见的东西下结论。

可升级的候选（有字段但本机无样本，验证后才改）：
- `crewai`：`config/agents.yaml` 的 `tools` 字段
- `hermes`：`.hermes/identity.json` 的 `capabilities`（不是工具清单，需先定映射）
- `auto-gpt`：`ai_settings.yaml` 的 `DISABLED_COMMANDS`（行为开关，非权限模型）

## ceiling 语义（不用试就能推）

```js
resolveTier({ hooks: true })                          // → hook / hooks_available
resolveTier({ hooks: true }, { ceiling: 'protocol' }) // → protocol / capped_by_collector / observed: hook
resolveTier({ protocol: true }, { ceiling: 'hook' })  // → protocol（不抬下限）
resolveTier({ protocol: true }, { ceiling: 'none' })  // → none（看不见就不判）
```

关键：封顶时保留 `observed`，**审计能看到"本来算出什么、被压到哪"**。
否则封顶就是不可复核的暗改。

## 验收

```bash
node scripts/collector-table.js --check   # 声明与实现一致 → exit 0
npm test                                  # 102 (node --test) + 16 + 31 = 全绿
```

## 已知未做（诚实边界）

- 15 个适配器的 4 个 S 类接口仍未实现 —— 缺样本，不愿凭文件名瞎写
- `tier` 全部 protocol 是**当前事实**，不是设计目标；接上真实钩子后才该有 hook
- `injectionDefense` / `canary` 全为 false：前者无结构化配置，后者需真实执行通道
