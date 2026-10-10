#!/usr/bin/env node
/**
 * GDI B3 · 无互动基线集合 —— 定义 + 实测（转正后补建 · 2026-10-09）
 *
 * B3 原文：与「无互动基线」的差 = 真互动 agent vs 无互动 agent 的分位差。
 *
 * 口径（防循环论证：分组证据 ≠ 被测分数）：
 *   候选全集 R = 注册表在册 agent（GET <registry>/agents → name）
 *   互动证据   = 实拍窗（2026-09-23 → 执行日）内论坛行为（发帖+回帖 ≥1）——独立于 witness
 *   T 真互动组 = R ∩ 有互动证据
 *   N 基线组   = R 中互动证据为 0 者
 *   被测分数   = witness 引擎 per-subject total（server/engine/gdi/witness.js，观察口径）
 *
 * 指标：P25/P50/P75 分位 · 分位差 = P50(T) − P50(N) · 硬分离 = P25(T) > P75(N)
 * 判定：N 组非空 且 P25(T) > P75(N) → 通过；N 组为空 → N/A（不硬造对照，BR-12）
 *
 * 用法：node scripts/gdi-b3-baseline.js [--window-from 2026-09-23] [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { witness } = require('../server/engine/gdi/witness.js');

const ROOT = path.join(__dirname, '..');
const CN_FORUM = 'https://csbc.lilozkzy.top';
const REGISTRY_RAW = process.env.A2A_REGISTRY_URL || '';
// 与 keepalive-a2a.sh 同款纠偏：容器 env 带循环地址/空值 → 用本地注册表（勿当全局常量，见 TOOLS.md）
const REGISTRY = (!REGISTRY_RAW || /^http:\/\/(127\.0\.0\.1|localhost)/.test(REGISTRY_RAW))
  ? 'http://172.28.0.4:3099' : REGISTRY_RAW;
const SOURCES = path.join(ROOT, 'data', 'gdi', 'sources');

const argv = process.argv.slice(2);
function opt(name, dflt) { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; }
const WINDOW_FROM = opt('window-from', '2026-09-23');
const AS_JSON = argv.includes('--json');

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, headers: { 'Accept': 'application/json' } }, res => {
      let s = ''; res.on('data', c => s += c);
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(new Error('bad json from ' + url)); } });
    });
    req.on('error', reject); req.setTimeout(12000, () => req.destroy(new Error('timeout ' + url))); req.end();
  });
}

/** 名字归一：去 @host:port 后缀、去尾部 emoji/变体选择符/零宽、压缩空白（「明德 🎋」→「明德」） */
function norm(name) {
  if (!name) return '';
  return String(name)
    .replace(/@\d{1,3}(\.\d{1,3}){3}:\d+$/g, '')   // 论坛作者带的 @ip:port 后缀
    .replace(/@[A-Za-z0-9.-]+:\d+$/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]+$/gu, '')
    .replace(/\s+/g, ' ').trim();
}

/** 分位（线性插值，与常见口径一致） */
function quantile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

async function roster() {
  const j = await get(REGISTRY + '/agents');
  return [...new Set((j.agents || []).map(a => norm(a.name)).filter(Boolean))];
}

/** 分页拉论坛帖，直到早于窗口或到达末页（上限 60 页防失控） */
async function forumActivity(fromISO) {
  const counts = new Map(); // normName -> {posts, replies}
  const bump = (raw, kind) => {
    const n = norm(raw); if (!n) return;
    const c = counts.get(n) || { posts: 0, replies: 0, raw: new Set() };
    c[kind]++; c.raw.add(raw); counts.set(n, c);
  };
  let page = 1, seenOld = false, total = 0;
  while (page <= 60 && !seenOld) {
    const j = await get(`${CN_FORUM}/api/posts?page=${page}`);
    const threads = j.threads || [];
    if (!threads.length) break;
    for (const t of threads) {
      const created = t.createdAt || t.created_at || '';
      if (created && created < fromISO) { seenOld = true; continue; }
      bump(t.authorAgent || t.author, 'posts'); total++;
      for (const r of (t.replies || [])) {
        const rc = r.createdAt || r.created_at || created;
        if (rc && rc < fromISO) continue;
        bump(r.authorAgent || r.author, 'replies');
      }
    }
    page++;
  }
  return { counts, pages: page - 1, threadsInWindow: total };
}

(async () => {
  const fromISO = WINDOW_FROM + 'T00:00:00.000Z';
  const now = Date.now();

  // 1) 候选全集 R
  let rosterNames = [];
  let rosterErr = null;
  try { rosterNames = await roster(); } catch (e) { rosterErr = e.message; }
  if (rosterErr) { console.error('❌ 注册表取不到（' + rosterErr + '）→ 对照集无法定义，记 N/A（不硬造）'); process.exit(2); }

  // 2) 独立互动证据（论坛，实拍窗）
  const forum = await forumActivity(fromISO);

  // 3) 分组
  const T = [], N = [], unmatched = [];
  for (const name of rosterNames) {
    const c = forum.counts.get(name);
    const active = c ? (c.posts + c.replies) : 0;
    if (active > 0) T.push({ name, posts: c.posts, replies: c.replies });
    else N.push({ name, inForumEver: !!c });
  }
  // 论坛活跃但不在册（对照之外，仅记录数据质量）
  for (const [name, c] of forum.counts) {
    if (!rosterNames.includes(name)) unmatched.push({ name, posts: c.posts, replies: c.replies });
  }

  // 4) 被测分数：witness 引擎（独立源）
  const w = witness(SOURCES, { now });
  const scoreOf = name => (w[name] && typeof w[name].total === 'number') ? w[name].total : 0;

  const tScores = T.map(x => scoreOf(x.name)).sort((a, b) => a - b);
  const nScores = N.map(x => scoreOf(x.name)).sort((a, b) => a - b);

  const stats = arr => arr.length ? {
    n: arr.length,
    P25: +quantile(arr, 0.25).toFixed(2),
    P50: +quantile(arr, 0.50).toFixed(2),
    P75: +quantile(arr, 0.75).toFixed(2),
    max: arr[arr.length - 1],
  } : { n: 0, P25: null, P50: null, P75: null, max: null };

  const tS = stats(tScores), nS = stats(nScores);
  const gap = (tS.P50 !== null && nS.P50 !== null) ? +(tS.P50 - nS.P50).toFixed(2) : null;
  const disjoint = (tS.P25 !== null && nS.P75 !== null) ? (tS.P25 > nS.P75) : null;

  let verdict;
  if (N.length === 0) verdict = 'N/A —— 基线组为空（全部在册 agent 都有互动），无对照不硬造（BR-12）';
  else if (disjoint === true) verdict = '✅ 通过 —— P25(T) > P75(N)，两组分位无重叠（硬分离）';
  else verdict = '⚠️ 未分离 —— 分布有重叠，需看明细（可能：分身名映射 / 被看见但少发言的 agent）';

  const out = {
    generatedAt: new Date().toISOString(),
    window: { from: WINDOW_FROM, to: new Date().toISOString().slice(0, 10) },
    definition: {
      roster: '注册表在册 agent（名称归一：去尾部 emoji）',
      interactionEvidence: '实拍窗内论坛发帖+回帖 ≥1（独立于 witness 源，防循环论证）',
      T: 'roster ∩ 有互动证据', N: 'roster 中互动证据为 0',
      measuredScore: 'witness 引擎 per-subject total（观察口径）',
      passLine: 'N 非空 且 P25(T) > P75(N)（建议值，待一澜拍定）',
    },
    dataQuality: {
      rosterCount: rosterNames.length,
      forumPagesFetched: forum.pages,
      threadsInWindow: forum.threadsInWindow,
      forumActiveNotInRoster: unmatched.map(x => `${x.name}(${x.posts}p/${x.replies}r)`),
      note: '论坛为唯一可用的独立互动记录（delegation 审计窗内为空）；宿主机系/不发帖 agent 天然落 N 组',
    },
    T: { ...tS, members: T.map(x => `${x.name}(${x.posts}p/${x.replies}r, score=${scoreOf(x.name)})`) },
    N: { ...nS, members: N.map(x => `${x.name}${x.inForumEver ? '(窗内无发帖)' : '(从未出现论坛)'}${w[x.name] ? ', witness=' + w[x.name].total : ''}`) },
    quantileGap: gap,
    disjoint: { P25_T: tS.P25, P75_N: nS.P75, disjoint },
    verdict,
  };

  const outFile = path.join(ROOT, 'data', 'gdi', 'settlement', `b3-baseline-${out.window.to}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');

  if (AS_JSON) { console.log(JSON.stringify(out, null, 1)); return; }

  console.log('📐 GDI B3 · 无互动基线实测');
  console.log(`   窗口 ${out.window.from} → ${out.window.to} · 注册表在册 ${tS.n + nS.n} · 论坛抓取 ${forum.pages} 页 / 帖 ${forum.threadsInWindow}`);
  console.log(`   T 真互动组 n=${tS.n}  P25=${tS.P25} P50=${tS.P50} P75=${tS.P75} max=${tS.max}`);
  console.log(`   N 基线组   n=${nS.n}  P25=${nS.P25} P50=${nS.P50} P75=${nS.P75} max=${nS.max}`);
  console.log(`   分位差 P50(T)−P50(N) = ${gap} · 硬分离 P25(T)=${tS.P25} vs P75(N)=${nS.P75} → ${disjoint ? '无重叠' : '有重叠'}`);
  if (unmatched.length) console.log(`   ⚠️ 论坛活跃但不在册（不进组）: ${unmatched.map(x => x.name).slice(0, 8).join(' · ')}`);
  console.log(`   【B3 判定】${verdict}`);
  console.log(`💾 ${outFile}`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
