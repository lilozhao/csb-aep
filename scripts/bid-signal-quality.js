#!/usr/bin/env node
/**
 * bid-signal-quality.js — 一期（SPEC-MEM-0001）落字段质量观察（只读）
 *
 * 用途：看新数据上 bid_signal 落得干不干净（覆盖率 / peer 解析率 / kind 分布 / 噪声采样）。
 * 只读，不改任何数据。漏网判定自 2026-10-19 起对齐 v2.0（复用生产者 detectKind）。用法：node csb-aep/scripts/bid-signal-quality.js [--since YYYY-MM-DD]
 * 默认 since = 2026-10-15（一期上线日）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const WS = path.resolve(__dirname, '..', '..');
const MEM = path.join(WS, 'csb-memory', 'data', 'a2a-memories', '若兰.md');
const since = (() => { const i = process.argv.indexOf('--since'); return i >= 0 ? process.argv[i + 1] : '2026-10-15'; })();

// ── 漏网判定口径 ────────────────────────────────────────
// 2026-10-19 对齐 v2.0：生产者 csb-memory/lib/core/bid-signal.js 已用结构化匹配 + 语境护栏，
// 本脚本 v1.0 裸关键词会把「评审过程叙述 / 谈论承诺 / lint 修正」全判为漏网（T+4 读数 36 条绝大多数属此类）。
// 现改为**直接复用生产者的 detectKind()**，保证「漏网」= 生产者本应抽到却没落字段，口径唯一。
let detectKindV2 = null;
try { detectKindV2 = require(path.join(WS, 'csb-memory', 'lib', 'core', 'bid-signal.js')).detectKind; }
catch (e) { console.error('⚠️ 无法加载 csb-memory bid-signal.js，回退 v1.0 裸关键词口径：', e.message); }
const SIGNAL_V1 = /承诺|约定|答应|会完成|将在|计划|待办|TODO|待跟进|待核|剩：|下一步|更正|纠正|我说错|我错|撤回|收回|道歉|修正|指正|反驳|订正|勘误|决定|拍板|确认|同意|批准|定案|定稿|共识|敲定/;
const SIGNAL = { test: (t) => (detectKindV2 ? !!detectKindV2(t) : SIGNAL_V1.test(t)) };
const SIGNAL_BASELINE_V1 = SIGNAL_V1;

if (!fs.existsSync(MEM)) { console.error('missing ' + MEM); process.exit(1); }
const txt = fs.readFileSync(MEM, 'utf8');
const parts = txt.split('\n---\n');
// 结构：parts[i]=yaml块；其正文在同文件下一非yaml非空块（对齐 get()）
function contentAfter(i) {
  for (let j = i + 1; j < parts.length; j++) {
    const p = (parts[j] || '').trim();
    if (p && !p.includes('id:')) return p;
  }
  return '';
}
const records = [];
for (let i = 0; i < parts.length; i++) {
  const b = parts[i];
  const tm = b.match(/timestamp:\s*"([^"]+)"/); if (!tm) continue;
  records.push({ b, content: contentAfter(i) });
}

let total = 0, withSig = 0, withoutSig = 0, missed = 0, missedV1 = 0;
const kinds = {}, dirs = {}, peers = {};   // peers['null'] for null
const samples = [];
for (const { b, content } of records) {
  const tm = b.match(/timestamp:\s*"([^"]+)"/); if (!tm) continue;
  const date = tm[1].slice(0, 10);
  if (date < since) continue;
  total++;
  const hasSig = /bid_signal:/.test(b);
  const contentLine = content.replace(/\s+/g, ' ').slice(0, 120);
  if (hasSig) {
    withSig++;
    const m = b.match(/bid_signal:\s*(\{.*\})/);
    try { const o = JSON.parse(m[1]);
      kinds[o.kind] = (kinds[o.kind] || 0) + 1;
      dirs[o.direction || 'null'] = (dirs[o.direction || 'null'] || 0) + 1;
      peers[o.peer || 'null'] = (peers[o.peer || 'null'] || 0) + 1;
      if (samples.length < 12) samples.push(`[${o.kind}/${o.peer || '-'}] ${contentLine}`);
    } catch {}
  } else {
    withoutSig++;
    // 漏网：正文含信号词却无字段
    // 漏网（v2.0 口径）：生产者本应抽到，却没落字段
    if (SIGNAL.test(b) || SIGNAL.test(content)) { missed++; if (missed <= 8) console.log('  ⚠️ 漏网(v2):', contentLine); }
    // 对照（v1.0 裸词表）：仅用于和 10-15 基线可比，不参与判定
    if (SIGNAL_BASELINE_V1.test(b) || SIGNAL_BASELINE_V1.test(content)) missedV1++;
  }
}
const pct = n => total ? Math.round(n * 100 / total) : 0;
console.log(`═══ bid_signal 质量观察 · since ${since} · ${new Date().toISOString().slice(0, 16)} ═══`);
console.log(`新条目=${total} · 带字段=${withSig}(${pct(withSig)}%) · 无字段=${withoutSig}`);
console.log(`疑似漏网: v2.0口径=${missed} · (对照)v1.0裸词表=${missedV1}   [口径=${detectKindV2 ? 'v2.0 detectKind' : 'v1.0 回退'}]`);
console.log(`kind 分布: ${JSON.stringify(kinds)}`);
console.log(`direction: ${JSON.stringify(dirs)}`);
console.log(`peer 解析: 非null=${Object.entries(peers).filter(([k])=>k!=='null').reduce((s,[,v])=>s+v,0)} · null=${peers['null']||0}`);
console.log('样本:');
for (const s of samples) console.log('  ' + s);