# P1-4 · 判据变更即作废

> 2026-11-02 · 若兰 · 对应《CSB-Harness 2.0 优化升级方案 v1》§6 P1-4
> 一句话：**判据变了，旧结论就不能再当今天的证据用 —— 而且要说清是哪一条变了。**

## 要解决的问题

一份报告是在**某套判据**下产出的。判据改了（权重、阈值、词表、口径版本），
旧报告文件还在、分数还写着，**没人知道它过期了**。

于是「按 2.1.0 判出的 82 分」被拿去当「按 3.0 也应该是 82 分」的证据。
这不是数据错误，是**证据链断裂但看起来完好**。

## 三条设计铁律

### 1. 指纹只覆盖判据，绝不覆盖运行时状态

`csb-compliance-degree/config.json` 里有 `statistics`（累计对话数/命中数），天天在变。

**把它算进指纹 = 每天自动作废全部历史报告。**
真正的判据变更会被埋在假作废里，再也没人看得见。

> **假作废和假绿一样有害，甚至更坏**：假绿让人误信，假作废让人再也不信。

所以显式分成两张清单：

```js
CRITERIA_FIELDS = ['weights','thresholds','words','modes','limits',
                   'dimensions','standard','mode','policyVersion','config_version']
STATE_FIELDS    = ['statistics','last_run','updated','created']
```

### 2. 用白名单，不用黑名单

黑名单（"除了 statistics 都算"）在**新状态字段加进来时会静默失准** —— 今天加个 `last_run_at`，
指纹立刻每天变，全线假作废，而没人知道为什么。

白名单（"只算这些"）漏了新判据字段时会**算错但可发现**：指纹不变 → 测试报红。

> 宁可漏判、可发现，不要静默错判。

### 3. 作废要说清"哪一条变了"

只回一个 `stale: true` 是无用的。人得知道是权重改了还是词表加了词，
才能判断旧报告的差异有多大、能不能接受。

所以必须给**字段级 diff**，且 diff 要递归到叶子：

```
thresholds.t removed      ← 有用
thresholds removed        ← 没用（哪个阈值？）
```

## 落点

| 仓 | 文件 | 作用 |
|---|---|---|
| csb-aep | `server/engine/criteria.js` | **单一真源**：指纹 / diff / 复用闸门 |
| csb-aep | `server/api/eval.js` | 报告写入 `report.criteria`（hash + 快照）；`/api/eval/list` 标 `policyStale` / `untracked` |
| csb-aep | `server/store/results.js` | `getLatestWithReuseCheck()` —— 取最新报告并判定可复用性 |
| csb-aep | `scripts/criteria-check.js` | 核对 compliance config 的指纹 |
| csb-compliance-degree | `config.json` | 新增 `config_version` + `config_hash` |
| csb-compliance-degree | `criteria-check.js` | 本仓自检（找不到判据实现 → exit 2，不静默跳过） |

## 三种复用状态

| 状态 | 含义 | 能否复用 |
|---|---|---|
| `reusable` | 指纹一致 | ✅ |
| `stale` | 指纹不一致，附字段级 diff | ❌ |
| `unknown` | 报告没带指纹（P1-4 之前产出） | ❌ **不许当可用** |

`unknown` 这一格是刻意的：老报告可能是对的，但我们**无法证明**它一致。
「可能是对的」不能当「可以用」。这与 P0-2「没测到 ≠ 做错」是同一条原则的两面。

## 为什么快照要连内容一起存

只存 hash，只能回答"变没变"；存了快照，才能回答"哪里变"。
后者才是人做决策需要的。

```js
report.criteria = {
  hash: 'crit_8d1b2391163c395c',
  version: 'aep-2.4.2/both',
  fields: ['mode','policyVersion','standard','weights'],
  counts: 4,
  snapshot: { weights: {...}, standard: 'a2a-v0.6', mode: 'both', policyVersion: '...' },
}
```

## 改判据的正确流程（写进文档，避免下次忘）

```bash
# 1. 改 config.json 的 dimensions / words / modes / limits
# 2. config_version +1   （判据版本，独立于 package version）
# 3. 重算指纹
node criteria-check.js --fix          # csb-compliance-degree
node scripts/criteria-check.js --fix  # csb-aep 侧核对
# 4. 旧报告自动进入 stale，不会被误用
```

## 验收

```bash
node --test test/criteria.test.js          # 23/23
node scripts/criteria-check.js             # exit 0
npm test                                    # 148 + 16 + 31 全绿
cd ../csb-compliance-degree && node criteria-check.js   # exit 0
```

**实测反例**（证明闸门真的会响）：往 `words.agreement` 加一个词 →
`criteria-check.js` 立刻 exit 1，并打印
`存储 crit_d899… vs 实算 crit_bea1…`。还原后转绿。

## 已知边界

- `listEval` 的 `policyStale` 只比口径版本（`aep-<版本>/<mode>`），不比权重表 ——
  权重随题集走，在列表场景无法无歧义地确定"当前权重应是什么"。宁可比得少，不可比得错。
- `criteria.js` 放在 csb-aep，compliance-degree 通过相对路径引用。两仓分开发布时这条路径会断，
  届时需要抽成独立包（与 `csb-verdict` 抽取同一时机处理，不提前抽）。
- 老报告（无 `criteria`）会一直是 `unknown`，不会自动补指纹 —— 补了指纹也是假的。
