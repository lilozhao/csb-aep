# BID 缺口补法：在记忆生成过程落「关系信号」字段（W-12 · 2026-10-15）

> **缘起**：一澜问「`csb-memory/data/a2a-memories/` 由 A2A 交互生成，能否在生成过程补上缺口的部分？」
> **结论**：**能，且成本很低**——信号**已经在事件正文里**，只是生成管线**没把它写成结构化字段**。
> 本文件 = 补法设计（不动现有代码，待批后再实现）。

---

## 一、现状：管线在哪、丢了什么

`a2a-memories/若兰.md` 的生成链（两入口，都汇到 `csb-memory/lib/core/memory.js#add → toFrontMatter`）：

| 入口 | 触发 | 语义 | 是否知连接名 |
|---|---|---|---|
| `csb-memory/scripts/sync-daily.js` | 每日 23:45 cron 从 `memory/*.md` 抽事件 | 日记流水 | ⚠️ 连接名埋在**正文**里，未提字段 |
| `csb-a2a-aip/a2a-memory.js#processConversation` | A2A 对话即时蒸馏 | 逐对话 | ✅ **agentName 就是连接** |

**每条记忆现在落盘的字段**（`toFrontMatter`）：`id / type / timestamp / source / confidence / tags / visibility / structural_weight / is_core_identity / affective_tag / provenance / access_count / last_access / (derived_from) / (verification_evidence)`。

**丢掉的**：`peer`（连接）、`signal_kind`（承诺/纠错/决策）、`direction`（我→/→我）、`promise_state`（四态）。

### 实测：信号其实都在（反抽原型）

`node csb-aep/scripts/bid-signal-from-memory.js`（只读）结果：

- **4534 条中，1100 条（24%）正文直接带连接名**
- 带信号的连接（示例）：墨丘 纠错 12 · 阿轩 承诺 8/纠错 3 · 小虾 纠错 6 · 舟楫 承诺 11 · Jeason 纠错 4
- → **信号可反抽**；只要生成时落字段，BID 直接可算

> **⚠️ 诚实边界（原型暴露）**：方向判别（"对方→我" vs "我→对方"）用粗正则**判不出**（原型全 0）。
> 方向字段需要**上游把方向显式带入**——这正是「在生成过程补」的价值：生成时知道「谁发的」，不用事后猜。

---

## 二、补法设计（最小侵入）

### 2.1 Schema：新增可选 `bid_signal` front-matter 块

由 `toFrontMatter` 在 `entry.bid_signal` 存在时输出（**复用现有 `if (entry.x) fields.push(...)` 模式**，零破坏性；老条目无此字段，向后兼容）：

```yaml
bid_signal: {"kind":"promise|correction|decision","peer":"阿轩","direction":"out|in","state":"pending|fulfilled|overdue|withdrawn|n/a"}
```

字段说明：

| 字段 | 取值 | 来源 |
|---|---|---|
| `kind` | promise / correction / decision | 复用现成词表（见 2.2） |
| `peer` | 连接名 | **a2a-memory 入口：直接用 `agentName`**；sync-daily：从 tags/正文抽 |
| `direction` | `out`=我→对方 / `in`=对方→我 | **a2a 入口可判**：我方发出=out，对方消息里含更正=in |
| `state` | 四态（承诺）· `n/a`（纠错/决策） | 见 2.3 |

### 2.2 词表（生成时复用，与反抽原型同一张表）

```js
const BID_SIGNAL_RE = {
  correction: /更正|纠正|我说错|我错|撤回|收回|道歉|修正|指正|反驳|订正|勘误|推翻我/,
  promise:    /承诺|约定|答应|会完成|将在|待跟进|待核|剩：/,
  decision:   /决定|拍板|确认|同意|批准|定案|定稿|共识|敲定/,
};
```
（与 `sync-daily.js` 现有 `IMPORTANT_PATTERNS`、`inferType` **重叠度高**，可共用，避免第三张表漂移。）

### 2.3 承诺四态怎么落

单条事件只知道"说了承诺"，**不知道后来履约没有**——四态需要**回填**：

- 生成时先落 `state:"pending"`；
- **回填钩子**（可选，二期）：复用现有 `ledger.jsonl`（周期型承诺本就落账）+ A2A 任务终态，按 `(peer, 内容指纹)` 关联"完成事件"，把 `pending → fulfilled/overdue/withdrawn`。
- 显式撤回（`⛔`/终止）→ `withdrawn`（不计违约）。

> **这一环是本补法唯一"不是零成本"的地方**——但注意：**它不新增采集**，只是把已存在的 ledger/任务终态**关联**到记忆条目。

---

## 三、覆盖增益（预估）

| BID 维度 | 现状（PoC v1） | 补字段后 |
|---|---|---|
| 承诺·连接级 | ❌ 无归属 | ✅ `peer` + `state`，逐连接可算 |
| 承诺·四态 | ❌ 无 | 🟡 需回填钩子（二期） |
| 纠错·双向 | ❌ 单侧不可测 | ✅ **`direction` 字段直接给双向**（生成时知道谁发的，不用等对方落账） |
| 决策·方向 | ❌ 无 | ✅ 顺带可得 |

---

## 四、落地路径（合规）

1. **规格先行**（csb-memory 已走 Spec 流程）：起一份 `specs/SPEC-MEM-000X`（BID signal field）——它是**功能级**变更，须过 spec-lint → gate。
2. **代码**：改 `lib/core/memory.js#toFrontMatter`（+1 可选块）+ 两个入口各加 `extractBidSignals()`。
3. **测试**：新增 `test/bid-signal.test.js`（词表命中 + 方向 + 向后兼容无字段条目不报错）。
4. **回填**：仅新条目带字段；存量 1100 条可选一次性反抽（用原型脚本）→ 生成迁移条。
5. **发布**：五平台镜像 + README/ARCHITECTURE 同步（开发规则：代码文档同提交）。

---

## 五、给一澜的决策点

| # | 决策 | 选项 |
|---|---|---|
| 1 | **补法形态** | A. 落 `bid_signal` 字段（推荐，最小侵入）· B. 只做反抽脚本不加字段 · C. 不补 |
| 2 | **四态回填** | 现在做（连带 ledger 关联）· 只做一期（pending 起步） |
| 3 | **谁来实现** | 若兰直接改 csb-memory（走 spec）· 先出 spec 待批 |
| 4 | **存量回填** | 1100 条一次性反抽 · 不回填只算增量 |

> 若兰倾向：**1A + 2 一期先行 + 3 先出 spec**。理由：schema 是契约，先定规格再动代码，符合我们刚立的 Spec 流程；
> 一期（只落 pending，不回填）就能把"纠错双向率"这条从 N/A 救活——因为 `direction` 在生成时天然可得。

---
_若兰 🌸 · 2026-10-15 12:05 · 缺口不在数据，在"生成时少写了一个字段"_