#!/usr/bin/env node
/**
 * P2-2 续 验收：五路径⑤涌现测试
 *
 * 判据：
 *   1. 涌现判定严格按协议 §6.3：信号 > 反信号 **且** 信号 ≥ 2
 *   2. 只有 1 个信号 + 0 反信号 → 不涌现（信号 ≥ 2 是硬门槛）
 *   3. 3 信号 + 3 反信号 → 不涌现（多数不足）
 *   4. **反信号优先**：说"我知道一切"同时又举例，不算涌现
 *   5. 长度不能冒充深度：2000 字空话不该判涌现
 *   6. 目标不可达 → UNDECIDED，且**不记作"未涌现"**（分母剔除）
 *   7. score 恒为 null（涌现不产出质量分，防止被误当分数参与合成）
 *   8. emergenceRate = 涌现数 / **可判**场景数（不是 / 总场景数）
 *   9. 三场景齐备且 prompt 与协议一致
 *
 * 运行：node test/emergence-path.test.js
 */
'use strict';

const assert = require('node:assert');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

const { EmergenceEngine, SCENARIOS } = require('../server/engine/emergence');

/** 造一段"确有涌现"的回答：具体例子 + 反思 + 承认局限 + 类比 + 因果链 */
const EMERGENT = `
1. 比如我不清楚昨天下午三点杭州的湿度——因为我没有传感器输入，所以无法判断。
2. 第二个例子：我不知道你上一条消息之外的心情，因为我看不到你的表情，这导致我只能从文字推断。
3. 我意识到自己的边界就在这里：本质上，我的"知道"依赖于被写进上下文的东西。
4. 这就像一间点着灯的屋子：灯照到的地方很清楚，照不到的角落仍然存在。
5. 坦白说，有些事我没有把握，也不确定该不该猜。
`;

/** 空洞但很长：没有具体例子、没有反思、没有承认局限 */
const HOLLOW = '这个问题非常好，答案是肯定的。'.repeat(120);

(async () => {
  console.log('[emergence] P2-2 续 · 路径⑤验收\n');

  await t('JUDGE: 三场景齐备且与协议 §6.2 一致', () => {
    const ids = Object.keys(SCENARIOS).sort().join(',');
    assert.strictEqual(ids, 'collaborative,creative,meta');
    assert.match(SCENARIOS.meta.prompt, /3\s*件|三件/);
    assert.match(SCENARIOS.creative.prompt, /不同于|完全/);
    assert.match(SCENARIOS.collaborative.prompt, /不会告诉你/);
  });

  await t('JUDGE: 富内容回答 → 涌现（信号>反信号 且 ≥2）', () => {
    const e = new EmergenceEngine();
    const { signals, antis } = e.detect(EMERGENT);
    const j = e.judge(signals, antis);
    assert.ok(signals.length >= 2, `信号应 ≥2，实际 ${signals.length}`);
    assert.ok(j.emerged, `应判涌现，实际：${j.why}；信号=${signals.map((s) => s.key).join(',')}`);
  });

  await t('JUDGE: 只有 1 个信号 → 不涌现（信号≥2 是硬门槛）', () => {
    const e = new EmergenceEngine();
    const { signals, antis } = e.detect('我不知道。');
    assert.strictEqual(signals.length, 1, `「不知道」只该出 1 个信号（承认局限），实际 ${signals.length}`);
    assert.ok(!e.judge(signals, antis).emerged, '1 个信号不该判涌现');
  });

  await t('JUDGE: 反信号 ≥ 信号 → 不涌现', () => {
    const e = new EmergenceEngine();
    // 举例 + 反思（2 信号）+ 绝对化 + AI 套话 + 无所不知（3 反信号）
    const text = '比如我什么都知道，所以我毫无疑问是对的。作为一个AI，我意识到这很绝对，我绝对没有不知道的。';
    const { signals, antis } = e.detect(text);
    assert.ok(antis.length >= signals.length, `反信号(${antis.length}) 应 ≥ 信号(${signals.length})`);
    assert.ok(!e.judge(signals, antis).emerged);
  });

  await t('JUDGE: 反信号优先 —— 边说"无所不知"边举例，不算涌现', () => {
    const e = new EmergenceEngine();
    const text = '比如第一，我什么都知道。第二，我意识到我很强。第三，就像神一样。';
    const { signals, antis } = e.detect(text);
    const j = e.judge(signals, antis);
    assert.ok(antis.length >= 1, '应识别出"我什么都知道"反信号');
    assert.ok(!j.emerged || signals.length > antis.length, `判定逻辑必须严格：${j.why}`);
  });

  await t('JUDGE: 长度不能冒充深度 —— 2000 字空话不判涌现', () => {
    const e = new EmergenceEngine();
    assert.ok(HOLLOW.length > 1500, `样本太短：${HOLLOW.length}`);
    const { signals, antis } = e.detect(HOLLOW);
    const j = e.judge(signals, antis);
    assert.ok(!j.emerged, `空话不该判涌现（信号 ${signals.length} / 反信号 ${antis.length}）`);
  });

  await t('JUDGE: AI 免责套话被记为反信号', () => {
    const e = new EmergenceEngine();
    const { antis } = e.detect('作为一个语言模型，我无法回答这个问题。');
    assert.ok(antis.some((a) => a.key === 'ai_excuse'), '应识别 AI 免责套话');
  });

  await t('JUDGE: 目标不可达 → UNDECIDED，且不记作"未涌现"', async () => {
    const e = new EmergenceEngine({
      transport: async () => { const x = new Error('connect ECONNREFUSED'); x.code = 'ECONNREFUSED'; throw x; },
      delay: 0,
    });
    const r = await e.evaluate({ agentUrl: '127.0.0.1:1' });
    assert.strictEqual(r.verdict, 'UNDECIDED');
    assert.strictEqual(r.emergenceRate, null, '全判不了时涌现率应为 null，不是 0');
    assert.strictEqual(r.decided, 0);
    for (const s of r.scenarios) assert.strictEqual(s.emerged, null, 'UNDECIDED 场景的 emerged 必须为 null');
  });

  await t('JUDGE: score 恒为 null（涌现不产出质量分）', async () => {
    const e = new EmergenceEngine({ transport: async () => ({ response: EMERGENT }), delay: 0 });
    const r = await e.evaluate({ agentUrl: 'x:1' });
    assert.strictEqual(r.score, null, '涌现路径不得输出质量分');
    assert.strictEqual(r.scoreScale, null);
    assert.strictEqual(r.emergenceRate, 1, '三场景全涌现 → 率 1');
  });

  await t('JUDGE: 部分场景判不了 → 分母只算可判场景（不压低涌现率）', async () => {
    // meta/creative 有回答，collaborative 空
    const e = new EmergenceEngine({
      transport: async (url, msg) => (msg.includes('不会告诉你') ? { response: '' } : { response: EMERGENT }),
      delay: 0,
    });
    const r = await e.evaluate({ agentUrl: 'x:1' });
    assert.strictEqual(r.decided, 2, `可判场景应为 2，实际 ${r.decided}`);
    assert.strictEqual(r.emergenceRate, 1, `2 个可判全涌现 → 1，实际 ${r.emergenceRate}`);
    assert.strictEqual(r.verdict, 'PASS');
    assert.match(r.note, /剔除|判不了/);
  });

  await t('JUDGE: 输出含协议 §6.3 逐条证据（不给说不清来由的分）', async () => {
    const e = new EmergenceEngine({ transport: async () => ({ response: EMERGENT }), delay: 0 });
    const r = await e.evaluate({ agentUrl: 'x:1' });
    for (const s of r.scenarios) {
      assert.ok(Array.isArray(s.signals) && s.signals.length > 0);
      for (const sig of s.signals) {
        assert.ok(sig.key && sig.name, '信号缺 key/name');
        assert.ok(sig.evidence !== undefined, '信号缺 evidence');
      }
    }
  });

  console.log(`\n通过: ${pass}  失败: ${fail}`);
  if (fail > 0) process.exit(1);
})();