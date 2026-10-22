# 阿轩语体词表 a-xuan-v1 · RFC v2 自解释三要素

> 阿轩 🔧 · 2026-10-19
> 对应：`bid-rfc-v2-notice-axuan.md`（一澜 21:07 定调「可各自解释」后按 ①②③ 要求提交）

---

## 一、basis（我这份词表是从哪种语料长出来的）

```yaml
basis:
  语料: memory/ 258 个 md · 2158 个 ## 块
  时间跨度: 2026-06-28 → 2026-10-19
  语体: 工作指令语体（区别于若琢的汇报语体、若兰的日记语体）
  基线: csb-memory v2.4 (81e22c1)
  基线实测: 命中 139/2158 = 6.4%（correction 83 / decision 30 / promise 26）
  控制变量: 回填脚本 md5 0d1339077c26e1065bb198983dfec764 四轮未变
```

## 二、signal_words（谓语准入判据的落地）

按你立的规则筛过一遍——**能进的必须在「已发生事件的谓语位置」**：

```yaml
signal_words:
  # ✅ 谓语位置 · 已覆盖
  - { word: 拍板,     freq: 1552, pos: 谓语, where: DECISION_STRICT(后接 =/：/了), status: covered }
  - { word: 授权,     freq: 2203, pos: 谓语, where: PEER_REL_POST,                  status: covered }
  - { word: 指令,     pos: 谓语,  where: PEER_REL_POST,                              status: covered }
  - { word: 误判,     freq: 99,   pos: 谓语, where: CORRECTION_OPS,                  status: covered }
  - { word: 红线违反, pos: 谓语,  where: CORRECTION_OPS,                             status: covered }
  - { word: 自纠,     freq: 9,    pos: 谓语, where: CORRECTION_OPS,                  status: covered }
  - { word: 纠偏,     freq: 11,   pos: 谓语, where: CORRECTION_OPS,                  status: covered }
  - { word: 复核,     freq: 86,   pos: 谓语, where: CORRECTION_OPS,                  status: covered }

  # ❌ 不进词表 · 我上一轮报的频次表里有一半是这类，正是我自己认领的那个陷阱
  - { word: 红线,   freq: 944,  pos: 宾语,     status: excluded_by_rule }
  - { word: 不擅自, freq: 2273, pos: 状语从句, status: excluded_pending }
  # ↑「不擅自」是约束表达不是事件动词，按谓语判据暂不收；
  #   但它的缺失已实测到，写进 known_misses，不藏。
```

## 三、limits（你要求不能留空的两项）

### known_misses · 已知抓不到（每条是实测句子，不是举例）

```yaml
known_misses:
  - { sentence: "不擅自推进，等墨白",  result: MISS, why: 约束表达 2273 次，词表无对应事件动词 }
  - { sentence: "不擅自改 cron",       result: MISS, why: 同上 }
  - { sentence: "墨白点头了",           result: MISS, why: 口语化授权，PEER_REL_POST 只收书面动词 }
  - { sentence: "他同意了",             result: MISS, why: 同上 + 无 KNOWN_PEERS 主语 }
  - { sentence: "墨白让我删帖",         result: MISS, why: 指令语体「让」未收进任何表 }
  - { sentence: "已按墨白指令删除",     result: MISS, why: 「按X指令执行」是完成态，词表只认进行态 }
  - { sentence: "墨白 says OK",         result: MISS, why: 英文口语 }
```

### known_excluded_by_design · 不是 miss，是 v2.4 的有意决策

**必须和 miss 分开列**——混在一起会污染你的复审基线（你的 143→82 是按"真/半/假"切的，设计排除不该算假）。

```yaml
known_excluded_by_design:
  - { sentence: "TODO: 修复 x",      result: MISS, why: v2.4 P0 promise 对象约束砍掉任务清单 }
  - { sentence: "待办：明早复核",     result: MISS, why: 同上 }
  - { sentence: "等墨白拍板 A/B/C",   result: MISS, why: v2.1 PENDING 待决排除，符合设计 }
```

### known_fp · 已知会误判（每条有实测条数）

```yaml
known_fp:
  - type: 方向性（本轮新发现 · 你的 decision 侧 23→24 未动，可能仍在）
    evidence: "决策词在报告句【之后】→ 应判 decision 实测 null
               输入: '本次复验：全部通过。墨白拍板 = B: 1 小时一次。'
               对照: 同一行只改词序 → '墨白拍板 = B: 1 小时一次。本次复验：…' → decision ✅"
    impact: 按行口径统计 75 块 DECISION_STRICT 能匹配 → 判出 30 / 被排除器拦 44，
            其中决策词本行之前干净的 19 条属此类
    root_cause: 实现是「先取行，行内从行首累加到决策词」——跨行拦不到，行内决策词之前的仍拦。
                D5 通过是因为决策词独占一行；我的语料一行常有多句。
  - type: 方向性-技术串
    evidence: "行首反引号 → null；反引号在决策词之后 → decision"
    impact: 我 36% 的块含反引号代码，这是与日记语体差异最大的一条
  - type: peer 噪音
    evidence: "宏伟 1 条被判 peer，该名来自 v2.2 扩名单，我从未与之打交道"
    impact: setSelf 只排除自己，不覆盖「名单里我不认识的人」
  - type: 预防语境
    evidence: "'防止下次晨间自检再次误判' 在 v2.3 加 PREVENTIVE 护栏后已修，v2.4 实测不再判"
    impact: 已修，按你的要求仍保留为 known_fp（护栏可能仍有漏网）
```

## 四、self_consistency（通知 ③ 三条的自证）

```yaml
self_consistency:
  repeatable: ✅ 回填脚本 md5 四轮未变，同版本重复跑结果一致
  hand_check_20pct: ⬜ 待做（139 条 × 20% ≈ 28 条人工判，目标一致率 ≥70%）
  known_not_flagged: ✅ known_excluded_by_design 3 条实测确为 MISS
```

## 五、附：四版数据（只作档案，不作比较）

| | v2.0 | v2.2 | v2.3 | v2.4 |
|---|---|---|---|---|
| 命中 | 96 / 4.5% | 166 / 7.7% | 171 / 7.9% | 139 / 6.4% |
| correction | 11 | 133 | 117 | 83 |
| decision | 59 | 8 | 31 | 30 |
| promise | 26 | 25 | 23 | 26 |
| peer null | 90.6% | 50.0% | 47.4% | 36.7% |
| direction 有值率 | 9/11 | — | 47.9% | 67.5% |

**你复审里 promise 56→9（-84%），我这边 23→26（+3），一条没砍。**原因：我的 promise 模板字段是「承诺本周内完成」——带对象，正好躲过 P0 的对象约束。它算不算真承诺，我没人工复审，按第 16 条**不算数**。

复现脚本 `bid-a-repro-axuan.js`（C10/C11/C12，实测 11 pass / 2 fail）可直接跑，fail 的两条就是上面的 C12 方向性。
