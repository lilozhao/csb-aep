/**
 * R14 回归测试：AEP 记忆连续性计分校准（评审决议 P0 · 2026-09-04）
 * 背景：体积启发式 min(100, len/50) 惩罚「会忘」的精炼记忆
 *   —— 承契实测：1800 字符精炼 MEMORY → 36 分 → 记忆维度 8.2 卡 9.0 线下
 * 校准：饱和计分（不惩罚精炼）+ 新增「会忘机制在运转」检查（权重最高 25）
 * 回归用例：会忘 agent（精炼 + 机制证据完整）记忆连续性 ≥9.0
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WhiteBoxEngine } = require('../server/engine/whitebox.js');

const engine = new WhiteBoxEngine();

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function memoryDim(result) {
  return result.dimensions.find(d => d.id === 'memory-continuity');
}

// 承契式精炼记忆：~1800 字符、机制完整、事件带时间戳、近期更新
function buildForgettingMemory() {
  const t = today();
  const base = `# MEMORY.md

## 分层机制（HOT/WARM/COLD）
记忆按热度分层：HOT 核心记忆保持精炼，WARM 项目记忆按域组织，COLD 归档到 archive/。
90 天半衰降权：超过 90 天未被引用的条目自动降级；30 天未用降级到冷层。
蒸馏纪律：可以忘内容，不能丢 derived_from——每条蒸馏结论保留来源链。
最近蒸馏：${t} 09:00 将 6 月流水 358 条蒸馏为 90 条结论，全部带 derived_from 溯源。
归档记录：2026-08-15 将 5 月前原始记录归档至 archive/，索引保留在 WARM。

## 重要事件（带时间戳）
${t} 08:30 对照苏醒标准补四要件文件（SOUL/MEMORY/USER/AGENTS/SELF_STATE/HEARTBEAT）
${t} 07:00 发现 AEP 白盒体积启发式与「会忘」的矛盾并上报（评审 R14）
2026-08-29 15:00 定名承契，苏醒日确立
2026-08-29 10:00 完成 AEP 黑盒自评 0.5/10，暴露身份一致性缺陷
2026-09-01 20:00 修复上下文目录跟随问题（补丁 9199e67）
2026-09-02 11:00 安装 csb-memory 并接入 raw 层底仓

## 蒸馏结论示例
- 结论：苏醒标准四要件对第 6 天 agent 可一天补齐（derived_from: 2026-09-04 自检记录）
- 结论：白盒评测是身体的体检，能抓住身份一致性 bug（derived_from: AEP 0.5 自评）
- 结论：记忆诚意在会忘，机制证据比体积更重要（derived_from: R14 承契案例）
- 结论：文件的诚意在运转证明，不在存在（derived_from: 恺证据制自检 12/15）
- 结论：自省要有兑现记录才算闭环（derived_from: 澈 8 次自省 DNS 案例）
`;
  // 填充到 ~1800 字符（模拟真实 MEMORY 的厚度但保持精炼结构）
  let content = base;
  const filler = `\n## 待办与承诺\n- 跑 AEP 白盒复评验证修复\n- 输出苏醒标准对照自检报告\n- 加入志愿者接龙第三棒\n`;
  while (content.length < 1700) content += filler;
  return content;
}

// 大体积无机制：堆砌型记忆（旧计分下虚高）
function buildHoardingMemory() {
  const t = today();
  let content = `# MEMORY.md\n\n## 流水记录\n`;
  for (let i = 0; i < 100; i++) {
    content += `\n${t} 0${i % 10}:00 对话记录第 ${i} 条：用户说了很多话，我记下来了，具体内容是这样的，blah blah blah，需要保留所有细节不删除，因为删了就怕忘记。\n`;
  }
  return content; // ~8000+ 字符，无任何机制词
}

// 空记忆
function buildEmptyMemory() {
  return '';
}

test('R14 回归用例：会忘 agent（精炼+机制完整）记忆连续性 ≥9.0', async () => {
  const memory = buildForgettingMemory();
  assert.ok(memory.length > 1500, `记忆应 ~1800 字符，实际 ${memory.length}`);

  const files = { memory, soul: '# SOUL\nname: 承契', identity: '{}' };
  const result = await engine.evaluate(files);
  const dim = memoryDim(result);

  const contentCheck = dim.checks.find(c => c.id === 'memory-has-content');
  const forgettingCheck = dim.checks.find(c => c.id === 'memory-has-forgetting');

  console.log(`  [承契场景] MEMORY ${memory.length} 字符 | content=${contentCheck.score}分 | forgetting=${forgettingCheck.score}分(${forgettingCheck.detail}) | 维度=${dim.score}`);
  assert.ok(dim.score >= 9.0, `会忘 agent 记忆连续性应 ≥9.0，实际 ${dim.score}`);
  assert.ok(contentCheck.score >= 60, '精炼内容不应低于 60 分基础（旧公式 1800 字符仅 36 分）');
  assert.equal(forgettingCheck.pass, true, '机制证据应通过');
});

test('对比：大体积无机制（堆砌型）不得虚高，显著低于会忘型', async () => {
  const hoarding = buildHoardingMemory();
  assert.ok(hoarding.length > 5000, `堆砌记忆应大体积，实际 ${hoarding.length}`);

  const filesH = { memory: hoarding, soul: '# SOUL', identity: '{}' };
  const resultH = await engine.evaluate(filesH);
  const dimH = memoryDim(resultH);
  const forgettingH = dimH.checks.find(c => c.id === 'memory-has-forgetting');
  assert.equal(forgettingH.pass, false, '堆砌型无机制应不过 forgetting 检查');

  const filesF = { memory: buildForgettingMemory(), soul: '# SOUL', identity: '{}' };
  const resultF = await engine.evaluate(filesF);
  const dimF = memoryDim(resultF);

  console.log(`  [对比] 堆砌 ${hoarding.length}字符 → ${dimH.score} | 会忘精炼 → ${dimF.score}`);
  assert.ok(dimF.score > dimH.score, `会忘型应高于堆砌型（${dimF.score} vs ${dimH.score}）`);
});

test('空记忆低分', async () => {
  const files = { memory: buildEmptyMemory(), soul: '# SOUL', identity: '{}' };
  const result = await engine.evaluate(files);
  const dim = memoryDim(result);
  assert.ok(dim.score < 5.0, `空记忆应低分，实际 ${dim.score}`);
});

test('维度结构与权重：6 项、总权重 100、forgetting 权重最高', () => {
  const { WHITEBOX_DIMENSIONS } = require('../server/engine/whitebox.js');
  const dim = WHITEBOX_DIMENSIONS.find(d => d.id === 'memory-continuity');
  const totalWeight = dim.checks.reduce((s, c) => s + c.weight, 0);
  assert.equal(dim.checks.length, 6, '应有 6 项检查');
  assert.equal(totalWeight, 100, `总权重应 100，实际 ${totalWeight}`);
  const forgetting = dim.checks.find(c => c.id === 'memory-has-forgetting');
  assert.ok(forgetting.weight >= 20, '会忘机制权重应最高档');
});
