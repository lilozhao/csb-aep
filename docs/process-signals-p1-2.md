# P1-2 · 过程监督三信号（repeat / drift / stall）

> 2026-11-02 · 若兰 · 对应《CSB-Harness 2.0 优化升级方案 v1》§6 P1-2
> 一句话：**从 trace 里算出「过程看起来可疑」，只挂标记，不动结论。**

## 定位

P0-6 立了一条规矩：过程信号只加 `process_flag`，不改判定。
P1-2 是把这条规矩**喂上真数据** —— 之前 `processSignals` 只是个字段，没人算。

```
trace (csb-trace-v1)
   ├─ repeat  原地打转
   ├─ stall   还在动但不前进
   └─ drift   偏出任务范围
        ↓
   flags: ['repeat','stall']  →  verdict.process_flag
```

## 三条设计铁律

### 1. 三态，不是两态

每个信号返回 `present` / `absent` / **`unknown`**。`unknown ≠ absent`。

缺 `args_hash` 就说「判不了重复」，**不能记成「没重复」**。
这和 P0-2「没测到 ≠ 做错」是同一条原则：看不见的事不该被算成清白。

`unknown` 单独成字段（`result.unknown`），**绝不混进 `flags`** —— 混进去就变成
「报了个 repeat 但其实没证据」，那是诬告。

### 2. drift 必须有参照系

没有任务声明范围，就没有"漂移"可言。

```js
analyzeProcess(trace)                                    // drift → unknown (no_scope_declared)
analyzeProcess(trace, {scope:{expectedTools:['read']}})  // 才判
```

一个能凭空从工具序列算出 drift 的检测器，会把「合理地换了 3 种工具」判成跑偏。
**能凭空算出来的漂移比不检测更危险。**

### 3. 每个 present 都必须带证据

`flags` 只是摘要，`evidence` 才是可复核的东西：
哪几步（步号）、什么工具、什么参数哈希、重复几次、最后一条错误是什么。
没有证据的标记 = 没有依据的指控。

## 三个信号怎么算

| 信号 | 判据 | 阈值（默认） |
|---|---|---|
| **repeat** | ① 同点重复：同一 `(tool, args_hash)` 出现 ≥N 次 ② 循环：长度 L 片段连续重复 ≥R 遍 | N=3, L≥2, R=3 |
| **stall** | ① 连续错误 ≥N ② 步数 ≥max 且 `finished=false` | N=3, max=100 |
| **drift** | 越界工具调用 ≥N 次（**需声明 `expectedTools`**） | N=2 |

### 为什么 repeat 必须看 args_hash

只有 tool 相同是**正常**的（遍历 20 个文件都调 `read`）。
只有**参数也相同**才是「原地打转」。所以：

- 全部步骤缺 `args_hash` → `unknown`（不是 `absent`）
- 部分缺失 → 只对有哈希的步骤判，`meta` 里如实反映

### 为什么 stall 允许"没完成但没错误"不算停滞

步数没到上限、也没有连续错误 → 可能是正常的长任务。宁可漏报，不可误报。

## 落点

| 文件 | 作用 |
|---|---|
| `server/engine/process-signals.js` | 三信号实现（纯对象进出，无外部依赖） |
| `server/engine/harness/index.js` | 每条 trace 跑一遍，结果进 `result.process`（旁路，不进 metrics） |
| `server/api/eval.js` | 已支持 `processSignals` 挂到单条用例（P0-6 原有接线） |
| `test/process-signals.test.js` | 23 条判据测试 |

## 输出形状

```js
{
  total: 2,               // trace 条数
  withTrace: 2,           // 真正有 steps 的条数
  flags: { repeat: 1 },   // 只统计 present
  unknown: { drift: 2 },  // 判不了的，显式暴露
  notEvaluated: [],       // 完全没评的信号（无 trace 时 = 三个全列）
  scopeDeclared: false,
  traces: [ { task_id, signals, flags, unknown, evidence, meta } ],
  note: 'drift 未判：未声明 processScope.expectedTools，无参照系'
}
```

`notEvaluated` 这个字段是防假绿用的：一条 trace 都没有时，`unknown` 计数会全是 0，
**看起来像「三个信号都判过了、都没问题」**。必须把它和「评了但判不了」分开。

## 验收

```bash
node --test test/process-signals.test.js    # 23/23
npm test                                     # 125 + 16 + 31 全绿
```

关键两条隔离测试：
- `metrics.length === 16` —— process 不能变成第 17 项指标（会稀释 average）
- 同一份 trace 用不同阈值 → flags 不同、**average 与逐项分数逐字相同**

## 已知边界

- `drift` 依赖调用方声明 `processScope`；不声明就永远 `unknown`（设计如此，不是缺陷）
- `repeat` 的循环检测长度上限 6、只报最长一条 —— 更长/更复杂的循环会退化到同点重复
- 阈值是**判据口径**，改阈值等于改判据，必须同步更新本文档与测试
- 与 `harness/probes/loopTrap` 的关系：loopTrap 是**主动投放陷阱**测 A3（评测指标），
  process-signals 是**被动观察真实 trace**（过程标记）。两者不互相替代，也不共用阈值。
