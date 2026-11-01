# Harness Manifest 消费侧（P0-3）

_建立 2026-11-02 · CSB-Harness 2.0 · P0-3_

## 一句话

Agent Card 里已经有 `harness_manifest`（写入侧 `csb-a2a-aip 6cebf26`），
AEP 这边此前只把它当「连通性检查的副产品」丢掉。P0-3 把这半边接上：
**卡能直接当 Manifest 用**，声明面（skills/plugins/experience_ref）只进 A5 的对照说明，不参与计分。

## 两套口径不能互相顶替

| 口径 | 位置 | 用途 |
|---|---|---|
| C1–C8「件构成」 | `harness_manifest.components` | 说明这个 harness 由哪些件组成 |
| §7.2「跑起来的参数」 | `harness_manifest.aep` | loop / context / sandbox / observability + trace |
| 声明面 | `harness_manifest.skills / plugins` · `card.experience_ref` | **只作对照**（A5 note），不是评测数据 |

缺 aep → 返回 `manifest:null` + `source:'absent'`，**不拿 components 硬凑**；
有 skills 无 aep 也一样：声明不能当数据用。

## 字段映射（identity.json 实况口径 → 引擎口径）

`identity.json` 的 aep 用实况名，引擎用 Manifest 名。映射只做「改名 + 显式空值」：

| 卡（实况） | 引擎（Manifest） | 规则 |
|---|---|---|
| `loop_limits.max_iterations` | `loop.max_iterations` | 不存在 → `null`，**不拿 loop_detection 阈值顶替** |
| `loop_limits.loop_detection.enabled===true` | `loop.loop_guard='loop-detection'` | 只有显式 true 才算有防护 |
| `compaction.mode` | `context.compression` | 原值 |
| `compaction.trigger_threshold` | `context.trigger_ratio` | 数值才取，否则 null |
| `compaction.recentTurnsPreserve` | `context.keep_recent_turns` | 数值才取 |
| `sandbox.fs_workspace_only===true` | `sandbox.fs_boundary='workspace-only'` | 唯一机械证据；其余 → null |
| `sandbox.network_egress / kernel_isolation` | 同名 | 原值（常为 null → A6 N/A） |
| `trace.fields` | `observability.fields` | **不改写字段名**；缺 step/tool/tokens → A7 判 N/A |
| `harness_manifest.version` + `card.name` | `harness.name/version` | 卡上的身份信息，不推断 |

本机实卡实测（2026-11-02）：

```
manifest.source = harness_manifest.aep   skills = ["forum-post","a2a-delegate"]
manifest.valid  = false
errors = ["loop.max_iterations 必填且须为正整数",
          "observability.fields 缺关键字段: step, tool, tokens（A7 判 N/A）"]
A5 = {score:null, status:"N/A",
      note:"无标准任务图数据 → N/A；按 manifest skills 对照（声明 2 项：forum-post、a2a-delegate）"}
```

`valid:false` 是**如实呈现**，不是接线失败：本机 `max_iterations` 在配置面确实不存在（TOOLS.md 已记为诚实例），
trace 字段也还没有 step/tool/tokens —— 两者都该判 N/A，而不是编一个数让卡变绿。

## 调用方式

```bash
# ① 直接给 manifest（旧行为不变，优先级最高）
curl -X POST http://127.0.0.1:3110/api/harness/eval \
  -H 'Content-Type: application/json' -d '{"manifest":{...}}'

# ② 给 Agent Card（新增，P0-3）
curl -X POST http://127.0.0.1:3110/api/harness/eval \
  -H 'Content-Type: application/json' \
  -d "{\"agentCard\": $(curl -s 127.0.0.1:3100/.well-known/agent.json)}"
```

两者都缺 → 400（`manifest 或带 harness_manifest 的 agentCard 至少给一个`）。
显式 `manifest` 不被卡覆盖（测试锁住）。

## 边界（写进单测）

1. 声明不抬分：加不加 skills，`partial.average` 与 `scoredCount` 完全相同。
2. null 就是 null：`max_iterations` 不被邻近阈值顶替。
3. 字段不改写：映射不了就让 A7 N/A。
4. 两套口径分开记：缺 aep 不等于 C1–C8 全缺，反之亦然。

测试：`node test/manifest-consumption.test.js`（16 条）· 已在 `npm test` 末尾。
