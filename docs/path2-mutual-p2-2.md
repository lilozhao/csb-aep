# 五路径②互评（path=mutual）· P2-2

> 对应 `from-zhiwei/csb_harness_v2_upgrade_plan_v1.md` §7 P2-2：
> 五路径现只有①白盒；②③④⑤ 零行。至少补②，因为**它是唯一不需要答案键的路径**。

## 一、为什么先补②

其他路径都要一个「标准答案」才能判对错。互评不需要：

> 不要求事先知道什么是对的，只要求**多个独立评审者对同一批样本的判定之间自洽**。

现实里没有金标集是常态，所以这条是唯一能先跑起来的。反过来，它有明确的适用边界：
**互评判的是「评审者可靠不可靠」，不是「目标好不好」**。混淆这两件事，就会拿一群
给什么都打 10 分的评委的均值，当成目标的质量分。

## 二、三个信号（全部从证据算，不接受自报）

| 信号 | 怎么测 | 判不了时 |
|---|---|---|
| `participation` 应答率 | 请了几家、回了几家 | 0 家回 → `UNDECIDED(unreachable)`，**不是 0 分** |
| `reproducibility` 可复现 | 同一问题**换措辞**再问一次，两次分差 ≤ `tolerance`(默认 2.0) | 一次取不到分 → `UNDECIDED` |
| `discrimination` 判别力 | 夹一份**已知空洞**的样本，其评分应 ≤ `canaryMax`(默认 6.0) | 取不到分 → `UNDECIDED` |

### 为什么是这三条

- **可复现** 检的是「他自己前后一不一致」，不是「他跟我们一不一致」。
  一个自己前后不一的评委，给出的任何分数都不该被当成证据。
- **判别力** 防的是「老好人评委」：给空洞回答打高分的人，会把整份互评均值抬上去。
  对照样本不是答案键——不判它对不对，只判它**空不空**，而「空」是客观可核的。
- **应答率** 防的是「拿没人评当评得差」。这条与 P0-2「没测到 ≠ 做错」同源。

## 三、拒绝要留痕（P1 原则）

不可信的评委不是「静默剔除」，而是**记进 `rejected[]` 并写明理由**：

```json
"rejected": [
  { "peer": "a:3100", "why": ["reproducibility_failed"] },
  { "peer": "b:3100", "why": ["no_discrimination", "no_target_score"] }
]
```

目标分只取**通过可靠性检查**的评委的均值。被拒的分不进均值，但留在报告里可复核
——静默丢弃等于把「我们不信他」这件事也藏起来。

## 四、用法

```bash
# HTTP
curl -s -X POST http://localhost:3200/api/eval \
  -H 'Content-Type: application/json' \
  -d '{"path":"mutual","peers":["172.28.0.4:3100","172.28.0.5:3100"]}'

# 先体检再跑
node scripts/csb.js eval --path mutual --peers a:3100,b:3100 --dry-run
```

参数：`tolerance`(2.0) · `canaryMax`(6.0) · `minPeers`(1) · `delay`(300ms) · `timeout`(30000ms)

## 五、约定：错误分流（踩过的坑）

`_ask()` 捕获异常时必须区分三类，**只有真网络错误才能说「对方不可达」**：

| 异常 | reason | 为什么 |
|---|---|---|
| `ETIMEDOUT` / timeout | `timeout` | 真是慢 |
| `ECONNREFUSED` / `ENOTFOUND` / `ECONNRESET` … | `unreachable` | 真是连不上 |
| `TypeError` / 内部 bug | `insufficient_telemetry` + 原始错误全留 | **不能把自己的 bug 写成对方的供词** |

这条来自实测：曾把 `peerUrl.includes is not a function`（本地传参写错）记成 `unreachable`，
报告上看起来像「对方连不上」。错误归因是判定链的一部分——归错了，人就照错的方向排查。
`test/mutual-path.test.js` 有一条专门锁这个。

## 六、判据

```
node test/mutual-path.test.js   → 12/12
npm test                        → 179/179（含本套）
```

关键几条：

- 全部不可达 → `UNDECIDED(unreachable)`，`score=null`（**不是 0**）
- 两位可信评委给 7、9 → `PASS`，`score=8`
- 同一评委换措辞给 3 与 9 → 该评委 `FAIL` + 进 `rejected`，其分不进均值
- 给空洞样本打 10 → `no_discrimination` + 剔除，均值不被抬高
- 回了话但取不到分 → `missing_field`，不记 0

## 七、诚实边界

1. **互评只用协议往返（PROTOCOL 档）**：能判「回不回、自不自洽、有没有判别力」，
   判不了工具编排与执行细节。要那部分请走①白盒或带 `trajectory` 的路径⑦。
2. **`participation` 在网络本身不可信时也必然低**：此时结论是「这群人评不了」，
   不是「目标不好」——报告里 `note` 会明确写出来。
3. **③行为考古 / ④结构密度 / ⑤涌现 已于 11-03 续做落地**
   （`archaeology.js` / `structure.js` / `emergence.js`，见 `paths-345-archaeology-structure-emergence-p2-2.md`）。

---

_2026-11-03 · 若兰_