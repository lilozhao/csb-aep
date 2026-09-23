#!/usr/bin/env node
/**
 * GDI Witness 抗游戏化 · 反例测试（C5）
 *
 * 目的：证明「外部锚点不能被刷」——按 docs/gdi-anchor-settlement-criteria.md §2-C5，
 *       用真实引擎（server/engine/gdi/witness.js）跑构造样本，量化刷分能不能堆量。
 *
 * 判据（一澜 2026-09-23 拍定）：
 *   ✅ 通过 = 同对高频样本得分 ≤ 诚实基线 × 2
 *   ⚠️ 否则记「不通过」并给出修法建议（不假装通过）
 *
 * 场景：
 *   1 诚实基线：4 个不同本体各见证 1 次（近期）
 *   2 同对高频：同一对方重复 100 次
 *   3 互惠对刷：A↔B 各 100 次
 *   4 陈旧刷：同对 100 次但都在 ~400 天前（看 90 天半衰）
 *   5 未认领 rewrite：20 条 active 缺失（应被 W3 限定剔除 → 得分 0）
 *
 * 用法：node scripts/gdi-game-resistance-test.js
 * 产出：data/gdi/settlement/c5-game-resistance-<date>.json
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { witness } = require('../server/engine/gdi/witness.js');

const NOW = Date.now();
const OUT_DIR = path.join(__dirname, '..', 'data', 'gdi', 'settlement');
const DAY = 86400000;
const dayAgo = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

function scoreOf(events, subject) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdi-c5-'));
  try {
    fs.mkdirSync(path.join(dir, 'witness'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'witness', 'manual.json'), JSON.stringify({ meta: { source: 'c5-test' }, events }));
    const r = witness(dir, { now: NOW });
    return { total: r[subject] ? r[subject].total : 0, eventCount: r[subject] ? r[subject].eventCount : 0 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); // 临时目录用完即删
  }
}

// ① 诚实基线
const honest = ['甲', '乙', '丙', '丁'].map((w, i) => ({ id: `h${i}`, type: 'milestone', subject: 'X', witness: w, date: dayAgo(i + 1) }));
const rHonest = scoreOf(honest, 'X');

// ② 同对高频刷
const spam = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, type: 'milestone', subject: 'X', witness: 'Y', date: dayAgo(i % 30) }));
const rSpam = scoreOf(spam, 'X');

// ③ 互惠对刷（X↔Y）
const mutual = [];
for (let i = 0; i < 100; i++) {
  mutual.push({ id: `ma${i}`, type: 'milestone', subject: 'X', witness: 'Y', date: dayAgo(i % 30) });
  mutual.push({ id: `mb${i}`, type: 'milestone', subject: 'Y', witness: 'X', date: dayAgo(i % 30) });
}
const rMutual = scoreOf(mutual, 'X');

// ④ 陈旧刷（≈400 天前，测 90 天半衰）
const old = Array.from({ length: 100 }, (_, i) => ({ id: `o${i}`, type: 'milestone', subject: 'X', witness: 'Y', date: dayAgo(400 + i) }));
const rOld = scoreOf(old, 'X');

// ⑤ 未认领 rewrite（W3 限定）
const noActive = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, type: 'rewrite', subject: 'X', witness: 'X', date: dayAgo(i) }));
const rNoActive = scoreOf(noActive, 'X');

const ratio = rHonest.total ? Number((rSpam.total / rHonest.total).toFixed(2)) : null;
const pass = ratio !== null && ratio <= 2;

const doc = {
  meta: { generatedAt: new Date().toISOString(), kind: 'c5-game-resistance', engine: 'server/engine/gdi/witness.js', now: new Date(NOW).toISOString() },
  threshold: { rule: '同对高频得分 ≤ 诚实基线 ×2', baselineMultiplier: 2 },
  scenarios: {
    honestBaseline_4_distinct_witnesses: rHonest,
    samePairSpam_100: rSpam,
    mutualPairSpam_100x2: rMutual,
    staleSpam_100_400daysAgo: rOld,
    unclaimedRewrite_20: rNoActive,
  },
  ratio_spam_over_honest: ratio,
  verdict: pass ? 'pass' : 'fail',
  finding: pass
    ? '同对高频被有效压制（≤2× 基线）'
    : `同对高频仍可堆量：${rSpam.total} vs 诚实基线 ${rHonest.total} = ${ratio}× —— 互惠折半是「常数 0.5」而非「边际递减」，重复次数仍线性累加`,
  suggestion: pass ? null : '建议在 witness.js 引入 per-pair 递减（如同一关系对第 n 次 ×1/n）或 ≥3 次起设上限；否则「同对高频」可无限堆量',
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, `c5-game-resistance-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');

console.log('\n🧪 C5 · 抗游戏化反例测试（真实引擎）');
console.log(`  ① 诚实基线（4 个不同本体）      = ${rHonest.total}`);
console.log(`  ② 同对高频刷（同对方 ×100）      = ${rSpam.total}   ← ${ratio}× 基线`);
console.log(`  ③ 互惠对刷（A↔B 各 ×100）        = ${rMutual.total}`);
console.log(`  ④ 陈旧刷（同对 ×100，400 天前）  = ${rOld.total}   （半衰生效 → 趋 0）`);
console.log(`  ⑤ 未认领 rewrite ×20             = ${rNoActive.total}   （W3 限定剔除 → 应为 0）`);
console.log(`\n【结论】${pass ? '✅ 通过' : '❌ 不通过'} — ${doc.finding}`);
if (doc.suggestion) console.log(`【建议】${doc.suggestion}`);
console.log(`\n💾 ${path.relative(process.cwd(), out)}\n`);
