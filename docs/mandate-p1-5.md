# 判定委托不可扩 · P1-5

> 版本 v1.0.0 · 2026-11-02 · 对应 TODO `P1-5` · 内核 `csb-verdict`（`server/engine/verdict/mandate.js`）
> 落点：`server/engine/verdict/index.js`（回执）· `server/api/eval.js`（报告 + 复用查询）
> 维护：若兰（公开场合纯名）

---

## 一、要解决的问题

判定常常要委托出去，而且**应该**委托：单点自判会自证。

- AEP 把「迎合度判据」委托给 `csb-memory/bid-signal`
- 若兰把「最高层判定」委托给他者注视（MC3）
- 一次评测的结论被下游拿去当门禁

委托本身没错。错的是**委托的边界没人管**：

| 现存的扩权路径 | 后果 |
|---|---|
| 拿到回执的人把 `delegator` 换成自己再转出去 | 「让你判这一项」变成「让你判所有项」 |
| `advisory`（仅供参考）的回执被贴到门禁上 | 参考意见变成了拦人的依据 |
| `aep-2.0` 口径的结论被当成 `aep-3.0` 的结论 | 换了尺，分数照用 |
| 一整块 `mandate` 换掉，签名照样验得过 | 边界可被静默改写 |

四次扩权，**每一次都"合法"**——因为没人定义过什么叫越界。

## 二、三条设计铁律

### ① 委托只能收窄，不能平移

子委托的 `scope` 必须是父 `scope` 的子集，`strength` 不得高于父级，`policy_version` 必须字面相等。

包含判定是**机械可核的路径前缀**，不做语义猜测：

```
eval            覆盖  eval、eval:harness、eval:harness:gate
eval:harness    不覆盖 eval:whitebox        ← 同级不互 cover
eval            不覆盖 evaluation            ← 字符串前缀不算，必须是路径前缀
```

为什么不用通配符（`eval*`）：通配符会把「越界」变成「看谁写得像」，判据就不可核了。

为什么强度只能降：`advisory` 的结论拿去做门禁，是把「建议」当成「裁决」。这是**权限位移**，不是措辞问题。

### ② 默认不可再委托（两道闸）

| 闸 | 规则 |
|---|---|
| 主闸 | 子委托默认 `delegable: false` —— 到这就停。要再转必须**原授权方显式**放行。 |
| 副闸 | `depth` 封顶（默认 `max_depth=1`，只允许一次转委）。委托链可数。 |

「没说可以」= 「不可以」。审计指出的正是 `delegator` 可以被对端反复替换转发——现在第二次转发会直接撞上 `NOT_DELEGABLE` 或 `DEPTH_EXCEEDED`。

### ③ 越界一律新开，不给 `extend()`

本模块**故意不导出任何扩展函数**。单测直接断言导出键里没有 `extend|expand|upgrade|patch|widen`：

```js
assert.ok(!Object.keys(M).some(k => /extend|expand|upgrade|patch|widen/i.test(k)));
```

这不是洁癖。**只要存在一个「把 mandate 改大一点」的函数，越界就会走那条路**——因为改一个字段比重跑一次判定便宜太多。把入口拿掉，唯一的出口就只剩「重新判一次，产新回执」。

## 三、接口

```js
const M = require('./server/engine/verdict').mandate;

// 授权方开一个口子
const { mandate } = M.create({
  scope: ['eval', 'report:read'],
  strength: 'attested',          // advisory < gating < attested
  policy_version: 'aep-2.4.2/blackbox',
  delegable: false,              // 默认就是 false
  expires_at: '2026-12-31T00:00:00Z',
});

// 受托方转给下一级（只能收窄）
const r = M.delegate(mandate, { scope: ['eval:gate'], strength: 'gating' });
// r.ok=false → r.refusal = { code, reason, missing? }

// 消费方问「这份能不能用在这件事上」
const u = M.checkReuse(mandate, { scope: ['eval:gate'], strength: 'gating' });
// u.reusable=false → u.code + u.missing + 「越界一律新开」
```

**拒绝原因（封闭枚举，全部可计数）**

`missing_mandate` · `invalid_mandate` · `out_of_scope` · `strength_exceeded` · `policy_mismatch` · `not_delegable` · `depth_exceeded` · `expired` · `revoked`

## 四、回执与报告

### 回执：mandate 进签名

`signPayload` 增加了一项 `mandate_digest`（有 mandate 时才有）。这解决一个具体攻击：**签名不动、mandate 整个换掉**。

```
{"verdict":…,"evidence_digests":…,"policy_version":…,"mandate_digest":"mand_…"}
```

向后兼容是逐字成立的：旧回执没有 `mandate_digest`，JSON.stringify 会**整键丢弃**，签名串与 P0-1 完全一致。单测锁住了这条（`无 mandate 的旧回执仍验得过`）。

`verifyReceipt` 现在三查：必填齐 → mandate 摘要对得上 → 签名对得上。篡改 `mandate.scope` 会得到 `reason: 'mandate_tampered'`；连摘要一起伪造则会破签（`bad_signature`）。

### 每份回执都必须带 mandate

没被告知用途时补一份**保守默认**：

```js
{ scope: ['eval:read'], strength: 'advisory', delegable: false, depth: 0, derived: true }
```

`derived: true` 是关键——让消费方看出这是系统补的，不是授权方给的。
为什么不干脆留空：留空必然有人写 `mandate || {}`，那才是真·无限授权。**保守默认好过隐性全权。**

`mandate_id` 用内容寻址（口径+对象+时刻的哈希），不用随机数——回执要能「同输入同输出」，否则可重放复核就无从谈起。

### 报告层与 API

- `report.mandate` / `mandate_digest` / `mandate_derived` / `mandate_valid`：落库，和回执同源
- `GET /api/eval/list`：多给 `mandate` 摘要 + `mandateDerived` + `mandateUntracked`（老报告）
- `GET /api/eval/:id?use=gate&strength=gating`：直接回答「这份能不能当门禁用」

```json
// 默认委托想当门禁
{ "reusable": false, "code": "out_of_scope",
  "missing": ["gate"],
  "reason": "用途越界（缺 gate）—— 越界一律新开，不在原委托上追加" }
```

**不提供 `?mandate=` 或 `?extend=` 参数。** 查询接口不能成为改写接口。

## 五、诚实边界

| 边界 | 说明 |
|---|---|
| `policy_version` 只做字面相等 | 不判断新旧、不判断哪个更宽松——这不是本模块能回答的 |
| scope token 是命名约定，不是能力隔离 | 谁都能新起一个 token。本模块保证「已发的 token 扩不出去」，不保证「token 名不可伪造」 |
| 不做撤销广播 | `revoked` 只在本地生效；要全局撤销需要外部账本 |
| 不替代 P1-4 | 判据变了（criteria hash 不同）仍由 P1-4 拦；两者互补，谁都不越权代偿 |
| 不做身份认证 | 委托凭据不是签名身份的替代品。AAT 管「你是谁」，mandate 管「这件事你能不能判」 |

## 六、验收（机械可核）

```bash
npm test    # 178/178（含 mandate 22 + mandate-wiring 6）
```

| 用例组 | 证明什么 |
|---|---|
| token/scope 包含（3） | 越界判定是机械的，不做语义猜测 |
| create/validate（2） | 缺 scope/强度/口径一律不合法 |
| delegate 收窄（4） | 越界、越级、换口径、口径不同全都拒 |
| 不再委托 + 深度（3） | delegable=false 撞主闸，max_depth 撞副闸，撤销/过期各拒 |
| checkReuse（4） | 越界给「缺什么」；不声明用途 ≠ 都能用；强度不够拒 |
| 回执签名（5） | 每份都带 mandate；改 scope → `mandate_tampered`；换块 → `bad_signature`；旧回执仍验得过 |
| API 接线（6） | 默认委托当门禁被拒；显式 gating 放行；老报告 `missing_mandate` |

## 七、遗留（不在 P1-5 范围）

1. **撤销广播**：`revoked` 目前只能本地置位，缺一个外部账本（可与 P1-3 的 `headHash` 外锚合并做）
2. **scope 词表**：现在是自由 token。社区规模上来后需要一份公开词表，否则会「各写各的」（但**先有用法再有词表**，现在定等于猜）
3. **委托链可视化**：`parent_mandate_id` 已经记了，还没有工具把它画出来
