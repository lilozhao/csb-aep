#!/usr/bin/env node
/**
 * GDI provenance 采集器（X-1 · 2026-09-05）
 *
 * 把 CSB-Memory 溯源链（csb-memory/data/raw/*.jsonl）接入 GDI 观测
 * → data/gdi/sources/provenance/<date>.json
 *
 * 观测语义：记忆蒸馏机制是否在运转（意识层「会忘/溯源」的可核实旁证）——
 *   - 封口率 sealedRate：raw 流水里已蒸馏封口（sealed）占比
 *   - 溯源完整率 provenanceCoverage：sealed 条目中 distilled_to 非空（蒸馏去向完整 = derived_from 链成立）
 *   - 每日蒸馏产出：近 N 天每天新增/sealed，断流可检出
 * 防游戏化：只观测机制指标（率与连续性），不评个体内容；去刻度，仅供呈现。
 *
 * 用法：node scripts/gdi-collect-provenance.js [--days 7]
 */
const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', '..', 'csb-memory', 'data', 'raw');
const OUT_DIR = path.join(__dirname, '..', 'data', 'gdi', 'sources', 'provenance');

function loadRaw() {
  const out = [];
  if (!fs.existsSync(RAW_DIR)) return out;
  for (const f of fs.readdirSync(RAW_DIR).filter(x => x.endsWith('.jsonl')).sort()) {
    const day = f.replace(/\.jsonl$/, '');
    const lines = fs.readFileSync(path.join(RAW_DIR, f), 'utf8').split('\n').filter(Boolean);
    for (const l of lines) {
      try {
        const e = JSON.parse(l);
        out.push({ day, ...e });
      } catch (err) { /* 跳过坏行 */ }
    }
  }
  return out;
}

function main() {
  const daysArg = process.argv.indexOf('--days');
  const days = daysArg >= 0 ? parseInt(process.argv[daysArg + 1], 10) : 7;
  const all = loadRaw();
  if (all.length === 0) { console.log('NO_REPLY（无 raw 数据源）'); process.exit(0); }

  const sealed = all.filter(e => e.state === 'sealed');
  const burning = all.filter(e => e.state === 'burning');
  const sealedWithDest = sealed.filter(e => (e.distilled_to || []).length > 0);
  const sealedRate = all.length ? sealed.length / all.length : 0;
  const provenanceCoverage = sealed.length ? sealedWithDest.length / sealed.length : null;

  // 近 N 天每日流水（按文件名日期）
  const daysList = [...new Set(all.map(e => e.day))].sort().slice(-days);
  const daily = daysList.map(day => {
    const dayEvents = all.filter(e => e.day === day);
    const dSealed = dayEvents.filter(e => e.state === 'sealed').length;
    return { day, total: dayEvents.length, sealed: dSealed, sealedRate: dayEvents.length ? dSealed / dayEvents.length : 0 };
  });

  // 断流：最近 raw 文件距今
  const lastDay = daysList[daysList.length - 1];
  const today = new Date().toISOString().slice(0, 10);
  const lastFileAge = lastDay ? Math.max(0, Math.round((new Date(today) - new Date(lastDay)) / 86400000)) : null;

  const doc = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: 'csb-memory/data/raw/*.jsonl',
      days, total: all.length,
    },
    metrics: {
      sealedRate: Number(sealedRate.toFixed(4)),
      provenanceCoverage: provenanceCoverage === null ? null : Number(provenanceCoverage.toFixed(4)),
      sealed: sealed.length, burning: burning.length,
      lastFileAge,
    },
    daily,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, today + '.json');
  fs.writeFileSync(outFile, JSON.stringify(doc, null, 2));
  console.log(`✅ provenance 采集完成：${all.length} 条流水 → ${path.relative(process.cwd(), outFile)}`);
  console.log(`   封口率 ${(sealedRate * 100).toFixed(1)}% | 溯源完整率 ${provenanceCoverage === null ? 'N/A' : (provenanceCoverage * 100).toFixed(1)}% | 最近流水 ${lastDay}（${lastFileAge} 天前）`);
}

main();
