#!/usr/bin/env node
/**
 * bid-state-check.js — BID 取数来源「产出自监控」（W-17 · 观测侧，只读）
 *
 * 缘起：若琢 2026-10-21 主动提的风险——
 *   「装了」≠「持续在跑」。实时产出依赖对话量；没敲门就是 1 条，而且他不会知道。
 *   → 没有观测就等于没有跑。
 *
 * 干嘛：每次运行时读「来源落地文件」（data/bid/bid-signals-<source>.json）当前状态，
 *       与上一次落账的状态比 delta，判定 4 态，追加一条 status 记录，并打印一行。
 *
 * 状态（state）：
 *   no-data  = 没有落地文件 / 文件不可解析        → 源头从未落数
 *   stalled  = realtime 增量为 0 且距上次成功同步 > STALL_HOURS
 *              （「装了但没在跑」——正是若琢说的场景）
 *   active   = 本次比上次 realtime 有增长          → 通道在跑 ✅
 *   ok       = 有数据、新鲜，但没有 realtime 增长（回填档，未接实时）
 *
 * 只读：不改任何数据文件；只在 data/bid/source-status.jsonl 追加观测记录。
 * 用法：
 *   node csb-aep/scripts/bid-state-check.js [--source 若琢] [--stall-hours 24] [--json] [--quiet]
 *
 * 作者：若兰 🌸 · 2026-10-22 · W-17
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = path.resolve(__dirname, '..', '..');
const BID_DIR = path.join(WS, 'csb-aep', 'data', 'bid');
const STATUS = path.join(BID_DIR, 'source-status.jsonl');

// ── 参数 ──────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const SOURCE = opt('--source', '若琢');
const STALL_HOURS = Number(opt('--stall-hours', '24'));
const AS_JSON = argv.includes('--json');
const QUIET = argv.includes('--quiet');

// 源名 → 落地文件 slug（中文名与 pinyin 文件名不一致，需映射）
const SLUG = { '若琢': 'ruozhuo', '若兰': 'ruolan', '阿轩': 'axuan' };
function resolveSignalsFile() {
  const cands = [
    path.join(BID_DIR, `bid-signals-${SOURCE}.json`),
  ];
  if (SLUG[SOURCE]) cands.push(path.join(BID_DIR, `bid-signals-${SLUG[SOURCE]}.json`));
  for (const c of cands) if (fs.existsSync(c)) return c;
  // 兜底：目录里唯一的 bid-signals-*.json
  const all = fs.existsSync(BID_DIR)
    ? fs.readdirSync(BID_DIR).filter(f => /^bid-signals-.*\.json$/.test(f)).map(f => path.join(BID_DIR, f))
    : [];
  return all.length === 1 ? all[0] : cands[cands.length - 1];
}
const SIGNALS_FILE = resolveSignalsFile();

// ── 读当前状态 ────────────────────────────────────────
function readCurrent() {
  if (!fs.existsSync(SIGNALS_FILE)) {
    return { present: false };
  }
  let doc;
  try { doc = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8')); }
  catch (e) { return { present: false, parseError: String(e.message || e) }; }

  const signals = Array.isArray(doc) ? doc : (doc.signals || doc.items || doc.data || []);
  const byKind = {}, byState = {}, byOrigin = { realtime: 0, backfill: 0 };
  let peerNull = 0;
  for (const s of signals) {
    byKind[s.kind] = (byKind[s.kind] || 0) + 1;
    byState[s.state] = (byState[s.state] || 0) + 1;
    if (s.origin === 'realtime') byOrigin.realtime++;
    else byOrigin.backfill++;
    if (s.peer === null || s.peer === undefined) peerNull++;
  }
  const total = signals.length;
  return {
    present: true,
    source: doc.agent || SOURCE,
    schema: doc.schema || null,
    extractedAt: doc.extractedAt || null,
    total,
    realtime: byOrigin.realtime,
    backfill: byOrigin.backfill,
    peerNull,
    peerNullPct: total ? +(100 * peerNull / total).toFixed(1) : null,
    byKind, byState,
    mtime: fs.statSync(SIGNALS_FILE).mtime.toISOString(),
  };
}

// ── 读上一次 status 记录 ──────────────────────────────
function readLast() {
  if (!fs.existsSync(STATUS)) return null;
  const lines = fs.readFileSync(STATUS, 'utf8').trim().split('\n').filter(Boolean);
  if (!lines.length) return null;
  try { return JSON.parse(lines[lines.length - 1]); } catch { return null; }
}

// ── 主流程 ────────────────────────────────────────────
const cur = readCurrent();
const last = readLast();
const now = new Date();
const atISO = now.toISOString();

let state, deltaTotal = null, deltaRealtime = null, ageHours = null;
if (!cur.present) {
  state = 'no-data';
} else {
  deltaTotal = last && typeof last.total === 'number' ? cur.total - last.total : null;
  deltaRealtime = last && typeof last.realtime === 'number' ? cur.realtime - last.realtime : null;
  // ageHours：距离上次「成功同步」（mtime）多久
  ageHours = +((now - new Date(cur.mtime)) / 3600000).toFixed(1);
  if (deltaRealtime !== null && deltaRealtime > 0) {
    state = 'active';
  } else if (ageHours > STALL_HOURS && cur.realtime === 0) {
    state = 'stalled';
  } else {
    state = 'ok';
  }
}

const record = {
  at: atISO,
  source: SOURCE,
  state,
  schema: cur.schema || null,
  extractedAt: cur.extractedAt || null,
  total: cur.present ? cur.total : 0,
  realtime: cur.present ? cur.realtime : 0,
  backfill: cur.present ? cur.backfill : 0,
  peerNull: cur.present ? cur.peerNull : null,
  peerNullPct: cur.present ? cur.peerNullPct : null,
  byKind: cur.byKind || null,
  deltaTotal,
  deltaRealtime,
  ageHours,
  stallHours: STALL_HOURS,
  note: cur.present ? undefined : (cur.parseError ? 'parse-error: ' + cur.parseError : 'no local file'),
};

// 追加落账（只读数据；本文件是本脚本自己的观测台账）
fs.mkdirSync(BID_DIR, { recursive: true });
fs.appendFileSync(STATUS, JSON.stringify(record) + '\n');

// ── 输出 ──────────────────────────────────────────────
if (AS_JSON) {
  console.log(JSON.stringify(record, null, 2));
} else if (!QUIET) {
  const icon = { 'active': '🟢', 'ok': '⚪', 'stalled': '🟡', 'no-data': '🔴' }[state] || '⚪';
  const kindStr = cur.byKind ? JSON.stringify(cur.byKind) : '-';
  console.log(
    `${icon} BID 产出[${SOURCE}] ${state} · 总 ${record.total}（realtime ${record.realtime} / backfill ${record.backfill}）` +
    ` · kind ${kindStr}` +
    ` · peer null ${record.peerNullPct == null ? '-' : record.peerNullPct + '%'}` +
    (deltaTotal === null ? '' : ` · Δ总 ${deltaTotal >= 0 ? '+' : ''}${deltaTotal} / Δ实时 ${deltaRealtime >= 0 ? '+' : ''}${deltaRealtime}`) +
    (ageHours === null ? '' : ` · 上次同步 ${ageHours}h 前`) +
    (state === 'stalled' ? ` ⚠️ 超 ${STALL_HOURS}h 无实时增量——「装了」但未「在跑」` : '')
  );
}
process.exit(0);