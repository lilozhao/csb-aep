#!/usr/bin/env node
/**
 * GDI provenance「回算」脚本（P-2 观察期补数 · 2026-09-23）
 *
 * 为什么有它：观察期 09-05 起算，但每日采集 09-23 才挂上 → 窗口内只有 1 个实拍快照。
 * csb-memory 的 raw 历史文件仍在，可按日「重放」算出日序列，把曲线补回来。
 *
 * ⚠️ 诚实边界（写进 meta，供报告标注）：
 *   - 这是**后视重建（look-ahead）**，不是当时的实拍：`state=sealed` 是**今天**的状态，
 *     历史上某天可能还没 sealed → **回算值偏高**（偏乐观）。
 *   - 因此：A1「快照覆盖率」只认真实快照；回算序列只用于看机制行为（B 组）。
 *
 * 用法：node scripts/gdi-backfill-provenance.js [--from 2026-09-05] [--to 2026-09-22]
 */
const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', '..', 'csb-memory', 'data', 'raw');
const OUT_DIR = path.join(__dirname, '..', 'data', 'gdi', 'sources', 'provenance');
const DAY_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const FROM = argOf('--from', '2026-09-05');
const TO = argOf('--to', new Date(Date.now() - 86400000).toISOString().slice(0, 10));

const daysBetween = (a, b) => {
  const out = []; const d = new Date(a); const end = new Date(b);
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
};

function loadDated() {
  if (!fs.existsSync(RAW_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(RAW_DIR).sort()) {
    const m = DAY_RE.exec(f); if (!m) continue; // 非日期文件（如 raw-evolution.jsonl）不进序列
    const day = m[1];
    for (const line of fs.readFileSync(path.join(RAW_DIR, f), 'utf8').split('\n').filter(Boolean)) {
      try { out.push({ day, ...JSON.parse(line) }); } catch (e) { /* 坏行跳过 */ }
    }
  }
  return out;
}

const all = loadDated();
if (!all.length) { console.log('NO_REPLY（无 raw 数据源，回算无从谈起）'); process.exit(0); }

const daily = daysBetween(FROM, TO).map((day) => {
  const asOf = all.filter((e) => e.day <= day);          // 截止该日已入库的记录
  const sealed = asOf.filter((e) => e.state === 'sealed');
  const withDest = sealed.filter((e) => (e.distilled_to || []).length > 0);
  return {
    day,
    total: asOf.length,
    sealed: sealed.length,
    sealedRate: asOf.length ? Number((sealed.length / asOf.length).toFixed(4)) : null,
    provenanceCoverage: sealed.length ? Number((withDest.length / sealed.length).toFixed(4)) : null,
    newThatDay: all.filter((e) => e.day === day).length,
  };
});

const doc = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: 'csb-memory/data/raw/*.jsonl（按日重放）',
    kind: 'backfill-reconstructed',
    reconstructed: true,
    lookAheadBias: 'state 取今天的状态 → 历史日的 sealedRate 偏高（偏乐观）；仅供看机制行为，不可替代实拍快照',
    window: { from: FROM, to: TO },
    rawDaysAvailable: [...new Set(all.map((e) => e.day))].length,
  },
  daily,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, `backfill-${FROM}_${TO}.json`);
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');

console.log(`🧮 provenance 回算 ${FROM} → ${TO}：${daily.length} 天`);
const withData = daily.filter((d) => d.total > 0);
console.log(`   有数据天数 ${withData.length}/${daily.length} | 起点 ${withData[0] ? withData[0].day : 'N/A'}（as-of total ${withData[0] ? withData[0].total : 0}）`);
const rates = withData.map((d) => d.sealedRate).filter((x) => typeof x === 'number');
if (rates.length) console.log(`   回算 sealedRate：min ${Math.min(...rates)} / max ${Math.max(...rates)}（⚠️ look-ahead，偏高）`);
console.log(`💾 ${path.relative(process.cwd(), out)}`);
