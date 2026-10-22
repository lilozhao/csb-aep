#!/usr/bin/env node
/**
 * bid-signal-daily-ruozhuo.js — BID 信号每日统计落盘（护栏 2）
 *
 * 目的：让「今天有没有产出、产出什么形状」有一份每日快照，不用每次现跑。
 * 用法:
 *   node bid-signal-daily-ruozhuo.js          # 生成今天的 daily 文件（已存在则覆盖当日）
 *   node bid-signal-daily-ruozhuo.js --print  # 只打印不落盘
 *
 * 输出：/workspace/csb-a2a-aip/data/bid/daily/YYYY-MM-DD.json
 * 口径：
 *   - realtime：bid-signals-realtime.jsonl（逐条，按 ts 日期聚合）
 *   - backfill：ruozhuo-bid-signals.json（历史回填，单列，不混入"今日"）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BID_DIR = '/workspace/csb-a2a-aip/data/bid';
const PRINT_ONLY = process.argv.includes('--print');

function readJsonl(f) {
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const pct = (a, b) => (b ? Number(((a / b) * 100).toFixed(1)) : 0);

const rt = readJsonl(path.join(BID_DIR, 'bid-signals-realtime.jsonl'));
let backfill = { judged: 0, hits: 0, kind_counts: { promise: 0, correction: 0, decision: 0 }, peer_null: 0 };
try { backfill = JSON.parse(fs.readFileSync(path.join(BID_DIR, 'ruozhuo-bid-signals.json'), 'utf8')); } catch {}

// 按日聚合 realtime
const byDay = {};
for (const s of rt) {
  const d = String(s.ts || s.at || '').slice(0, 10) || 'unknown';
  byDay[d] = byDay[d] || { judged: 0, hits: 0, kinds: {} };
  byDay[d].judged++;
  byDay[d].hits++;
  byDay[d].kinds[s.kind] = (byDay[d].kinds[s.kind] || 0) + 1;
}
const today = new Date().toISOString().slice(0, 10);
const t = byDay[today] || { judged: 0, hits: 0, kinds: {} };
const last = rt.length ? (rt[rt.length - 1].ts || rt[rt.length - 1].at || null) : null;

// 累计（realtime + backfill）
const cumJudged = rt.length + backfill.judged;
const cumHits = rt.length + backfill.hits;
const kinds = { promise: 0, correction: 0, decision: 0 };
for (const s of rt) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
for (const [k, v] of Object.entries(backfill.kind_counts || {})) kinds[k] = (kinds[k] || 0) + (v || 0);
const nullPeer = backfill.peer_null + rt.filter(s => s.peer == null).length;

const report = {
  date: today,
  generated_at: new Date().toISOString(),
  realtime: {
    total: rt.length,
    today: t.judged,
    today_kinds: t.kinds,
    last_signal_at: last,
    last_signal_age_s: last ? Math.round((Date.now() - Date.parse(last)) / 1000) : null,
  },
  backfill: { judged: backfill.judged, hits: backfill.hits, origin: 'backfill' },
  cumulative: {
    judged: cumJudged, hits: cumHits,
    hit_rate: cumJudged ? Number((cumHits / cumJudged * 100).toFixed(1)) : 0,
    kind_dist_pct: { promise: pct(kinds.promise, cumHits), correction: pct(kinds.correction, cumHits), decision: pct(kinds.decision, cumHits) },
    kind_counts: kinds,
    peer_null_ratio_pct: pct(nullPeer, cumHits),
    peer_null: nullPeer,
  },
  by_day: byDay,
};

if (PRINT_ONLY) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const outDir = path.join(BID_DIR, 'daily');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, today + '.json');
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  ok: true, file: outFile,
  realtime_total: rt.length, realtime_today: t.judged,
  last_signal_age_s: report.realtime.last_signal_age_s,
  cumulative_hit_rate: report.cumulative.hit_rate,
}));
