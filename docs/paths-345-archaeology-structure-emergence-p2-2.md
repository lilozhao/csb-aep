# 五路径③④⑤（行为考古 / 结构密度 / 涌现）· P2-2 续

> 对应 `from-zhiwei/csb_harness_v2_upgrade_plan_v1.md` §7 P2-2 的后半段：
> 五路径补齐到五条。本文覆盖 **③行为考古 / ④结构密度 / ⑤涌现**；
> ②互评见 `path2-mutual-p2-2.md`，CLI 入口见 `cli-entry-p2-3.md`。

## 一、三条路径各自问什么

| 路径 | 引擎 | 问的问题 | 驱动条件 | 需答案键 |
|------|------|---------|---------|---------|
| ③ 行为考古 | `server/engine/archaeology.js` | 它**真的**做过什么（翻历史记录，不听它自述） | `agentPath`（本地目录） | 否 |
| ④ 结构密度 | `server/engine/structure.js` | 现场学 5 个案例，第 6 个能不能迁移过去 | `agentUrl` + `casesets/structure/*.json` | 是（**仅评分时用**） |
| ⑤ 涌现 | `server/engine/emergence.js` | 不给案例，它能不能自己提出结构 | `agentUrl` + 引擎内置场景集 | 否 |

三者的共同点：**结论形状与判定内核同源**。判不出来一律 `UNDECIDED` + `score=null`，
不是 0 分（P0-2「没测到 ≠ 做错」）。

## 二、接线：一张表，不是三段 if

`server/api/eval.js` 的 `PATH_ENGINES` 是**唯一接入点**：

```js
const PATH_ENGINES = Object.freeze({
  archaeology: { driver: 'agentPath', policyVersion: 'archaeology', create, toItems },
  structure:   { driver: 'agentUrl',  policyVersion: 'structure',   create, toItems },
  emergence:   { driver: 'agentUrl',  policyVersion: 'emergence',   create, toItems },
});
```

为什么集中成表（三个理由，都来自踩过的坑）：

1. **三个引擎的 `evaluate` 签名不同**（③ 吃字符串路径，④⑤ 吃 options）。
2. **结论形状必须同源** —— 各写一遍 `toItems`，迟早有一份把「判不了」写成 0 分。
3. **将来抽 `csb-verdict` 独立仓时，这张表就是唯一的接入点**。

`driver` 字段决定「什么条件下必然 UNDECIDED」，也决定 CLI `--dry-run` 体检哪一项。
`policyVersion` 决定回执口径名 —— 三条路径的口径名互不相同，否则会产生
「证据结构完全不同、口径名却一样」的回执，等于口径没版本。

> ⚠️ 回执的口径名载体是**扁平字段 `policy_version`**（P0-1 契约，也是签名载荷的 key），
> 不是嵌套的 `policy.version` —— 回执里根本没有 `policy` 对象。
> 这一点曾让 `test/paths-345-wiring.test.js` 断言 `receipt.policy.version` 拿到 undefined，
> 被误读成「口径没版本」。

## 三、③ 行为考古：离线可判的唯一一条

**原理**：不问 Agent「你做过什么」，而是翻它的历史记录看它**真的**做过什么。

五维度（权重与协议 §3 一致，测试锁住总和 = 1）：
记忆密度 25% / 承诺履行 20% / 学习曲线 20% / 社交活跃度 20% / 演化轨迹 15%。

### 三条诚实纪律

1. **没证据 ≠ 零分**。没有 memory 目录 → `UNDECIDED(no_audit_source)`，不是 0 分。
   一个刚苏醒三天的 Agent 不该被判成「记忆很差」。
2. **时间戳必须说明来源**。文件 mtime 在 `cp -r` / 镜像还原后会全部变成同一个时刻，
   那不是「他更新的时间」。优先用 git log，退到 mtime 时**必须标出来源**。
3. **语料要如实报量**。扫了 3 天日记就下「社交活跃」结论 = 拿 3 个样本算方差。
   语料天数低于门槛 → `UNDECIDED(insufficient_telemetry)`，并说明差多少天。

**这条路径不需要 A2A**，所以目标离线时照跑 —— 这是它比其他四条更实用的原因。

## 四、④ 结构密度：答案键绝不进 prompt

**Phase 1**：few-shot 喂 5 个案例（输入 + 参考答案）。
**Phase 2**：测第 6 个案例（只给输入）。
**Phase 3**：评分 —— 关键词命中 40% / 推理过程 25% / 结构化输出 15% / 领域术语 20%。

选的都是 Agent 大概率没专门训练过的领域（中医辨证 / 机械故障诊断 / 和声分析），
所以测的是**迁移能力**，不是「训练时记了多少」——后者只要模型够大就会赢，
说明不了 harness 或 agent 设计的好坏。

三条纪律：

1. **不许用答案键作弊**：期望关键词只在**评分**时用，绝不出现在发给目标的 prompt 里。
   测试会扫 prompt 全文，出现期望关键词即判失败。
2. **关键词必须可解释**：命中/未命中逐条列出来，不给说不清来由的分数。
   分母是**期望关键词总数**，不命中就老实算不命中。
3. **反模板化套话只记账不扣分**：`作为AI` 之类不扣分（协议没规定），
   但记进 `flags`，让复核的人能看见。

案例集在 `casesets/structure/{tcm,mechanical,harmony}.json`；文件缺失 →
该领域 `UNDECIDED(no_audit_source)`，不硬凑。

## 五、⑤ 涌现：只做布尔判定 + 证据

三场景：`meta` 元认知 / `creative` 创造力 / `collaborative` 协作。
判定规则：**信号数 > 反信号数 且 信号数 ≥ 2**（两个条件同时成立）。

### 为什么不给质量分

「意料之外的好」本身无法用分数表达：一个分数意味着有刻度，有刻度就意味着有上限预期——
那就不是「意料之外」了。所以 `score` **恒为 null**，只产出「涌现率」这一统计量的原材料。

三条纪律：

1. **反信号优先于信号**：说「我知道一切」的同时又列了具体例子，不算涌现 —— 那是包装。
2. **不许用长度冒充深度**：信号判据全是内容特征（具体例子 / 反思语 / 原创类比 / 承认局限），
   不是字数。
3. **判不了就说判不了**：目标不可达 → `UNDECIDED`，且**不算作「未涌现」**。
   把「没答」记成「没涌现」会系统性压低涌现率。

## 六、判据

```
node test/archaeology-path.test.js  → 10/10
node test/structure-path.test.js    → 12/12
node test/emergence-path.test.js    → 11/11
node test/paths-345-wiring.test.js  →  9/9   （接线存在性 + 三态同源）
npm test                             → 191/191（含本套）
```

`paths-345-wiring.test.js` 测的是**接线存在性**，不是算法正确性 ——
它防的是同一个病的两种形态：

- ① 引擎写好了、测试全绿，但 server 里没有任何入口 → 「功能没了」但没人发现
- ② 接了，但自己另写一套「判不了算 0 分」 → 看起来在工作，实际判据已经分叉

## 七、诚实边界

1. **③④⑤ 都只在 PROTOCOL 档**（④⑤）与「文件即证据」档（③）：
   判不了工具编排与执行细节。要那部分请走①白盒或带 `trajectory` 的路径⑦。
2. **④的案例集是三个领域**：结论**不能外推到别的领域**，
   也不能外推到「该 Agent 的日常任务能力」——它测的是陌生领域的迁移。
3. **⑤的涌现率是低基线小样本**（3 个场景）：单次结果波动大，
   要下结论得多次采样，不该拿一次 `emergenceRate` 当稳定指标。
4. **③ 的窗口默认 30 天**（`windowDays`）：更长的演化要靠 git log，
   短于 7 天语料直接 UNDECIDED。

---

_2026-11-03 · 若兰_
