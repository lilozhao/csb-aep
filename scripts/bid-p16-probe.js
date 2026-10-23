#!/usr/bin/env node
/**
 * bid-p16-probe.js —— P-16 前置测量：澈的「可指称性」正交维度到底会补进几条过判？
 *
 * 澈的原话（P-15 回帖）：
 *   「另立一个正交维度 relation_event，判据取可指称性——两端点名、出现自报或互指，
 *     即判为关系事件。这一刀会让 27 条金标里已判为非关系的条目重新过一遍，
 *     所以要预先量一下它会在 G-15/G-16 之外补进几条过判，再决定开不开。」
 *
 * 本脚本就是把那句话变成数字：把「可指称性」写成可执行谓词，在金标集 33 条上跑，
 * 出「覆盖率（补上几条真关系）vs 过判（误命中几条非关系）」的盈亏表。
 *
 * 立场：**不改协议、不改生产码**，纯测量。多个严格度各跑一遍，看的是曲线不是单点。
 *
 * 用法：node csb-aep/scripts/bid-p16-probe.js [--goldset <json>] [--json]
 *
 * 作者：若兰 🌸 · 2026-10-23 · P-16 前置
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = path.resolve(__dirname, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const GS = arg('--goldset', path.join(WS, 'csb-aep', 'data', 'bid', 'goldset-ruozhuo-v0.3.json'));
const AS_JSON = process.argv.includes('--json');

const gold = JSON.parse(fs.readFileSync(GS, 'utf8'));
const samples = gold.samples || gold;

// ── 词表（与 csb-memory 的 KNOWN_PEERS 同源；此处独立声明，测量脚本不依赖生产码版本）──
const SELF = ['若兰', '若琢'];            // 本语料作者（私名 + 分身名）
const PEERS = ['阿轩', '墨丘', '舟楫', '小虾', 'Jeason', '恺', '澈', '星尘', '思源', '明德',
  '言蹊', '苏念', '若辰', '知微', '初白', '川贝', '清漪', '鲸歌', '守枢', '启明',
  '一澜', '知砚', '默弦', '燧明', '栖澜', '墨白', '灼', '拾焰', '丹蕨', '榫', 'Dsh', '阿契', '承契'];

// ── 四个特征（澈判据的零件）──────────────────────────────
const RX = {
  // ① 对端点名：文中出现一个「对方」的名字
  peer: new RegExp(PEERS.join('|')),
  // ② 自身端在场：第一人称 或 作者名
  self: /我|我们|我方|本人|自身|这边/,
  // ③ 自报：明示身份的自我介绍
  selfReport: /自我介绍|自报|我是[^。；;\n]{0,8}(?:若兰|若琢|来自|Marvis|\S+界的)/,
  // ④ 互指：一次真实的交互动作（发起/承接/问答/回访），非单向通知
  mutual: /回应|接住|承接|回应|敲门|来访|打招呼|想请教|请教|我答|回访|两问|互指|问候|答(?:：|:|了)|问了|问了[^。]{0,10}答/,
  // 反特征：单向通知/推送——动的是「物」，不是「人」
  oneWay: /已推|已提交|已修复|已通知|通知|推送|提交|commit|fix/,
};

function features(text) {
  const t = String(text || '');
  // peer 命中要排除作者自己（若兰/若琢 出现在文中 ≠ 对方）
  const peerHits = PEERS.filter(p => t.includes(p));
  return {
    peer: peerHits.length > 0,
    peers: peerHits,
    self: RX.self.test(t),
    selfReport: RX.selfReport.test(t),
    mutual: RX.mutual.test(t),
    oneWay: RX.oneWay.test(t),
  };
}

// ── 澈判据的多个严格度 ──────────────────────────────────
// 原文「两端点名 + （自报 or 互指）」→ 直译即 V1；V2/V3 是收紧方向，看曲线。
const CRITERIA = {
  'V1 两端点名 +（自报|互指）            [澈原文直译]': f => f.peer && (f.selfReport || f.mutual),
  'V2 两端点名 + 自身端 +（自报|互指）    [+self]':   f => f.peer && f.self && (f.selfReport || f.mutual),
  'V3 两端点名 + 互指（不含单向通知）      [最紧]':     f => f.peer && f.mutual && !f.oneWay,
};

// ── 跑 ─────────────────────────────────────────────────
const rows = [];
for (const s of samples) {
  const f = features(s.text);
  const isPos = s.gold.label === 'positive';
  const noVerb = isPos && (s.gold.kind == null);
  const rec = { id: s.id, gold: s.gold.label, kind: s.gold.kind, noVerb, f, text: s.text };
  for (const [name, fn] of Object.entries(CRITERIA)) rec[name] = fn(f);
  rows.push(rec);
}

if (AS_JSON) { console.log(JSON.stringify({ goldset: path.basename(GS), rows }, null, 2)); process.exit(0); }

console.log(`═══ P-16 前置测量 · 澈的「可指称性」正交维度 ═══`);
console.log(`金标集 ${path.basename(GS)} · 样本 ${samples.length} 条`);
console.log(`（本集主要测 precision；G-15/G-16 是仅有的两条「无动词真关系事件」）\n`);

for (const name of Object.keys(CRITERIA)) {
  const hits = rows.filter(r => r[name]);
  const tp = hits.filter(r => r.gold === 'positive');
  const fp = hits.filter(r => r.gold === 'negative');
  const coversG = ['G-15', 'G-16'].filter(id => hits.some(r => r.id === id));
  const fnNoVerb = rows.filter(r => r.noVerb && !r[name]);

  console.log('─'.repeat(64));
  console.log(`▸ ${name}`);
  console.log(`  命中 ${hits.length} 条 → 真关系 ${tp.length} · **过判 ${fp.length}**`);
  console.log(`  覆盖 G-15/G-16: ${coversG.length}/2 ${coversG.length ? '('+coversG.join(',')+')' : '—— 一条没盖到'}`);
  if (fp.length) {
    console.log(`  过判明细（这就是澈要的那个数字）：`);
    fp.forEach(r => console.log(`    ✗ [${r.id}] ${r.text.slice(0, 46)}`));
  }
  if (fnNoVerb.length) console.log(`  仍漏的无动词关系事件: ${fnNoVerb.map(r=>r.id).join(',')}`);
  // 命中项的 kind 分布 —— 直接回答「relation_event 是第 4 类（互斥）还是正交轴（可并存）」
  const kindDist = {};
  tp.forEach(r => { const k = r.kind == null ? 'null(无动词)' : r.kind; kindDist[k] = (kindDist[k] || 0) + 1; });
  const coexist = Object.keys(kindDist).filter(k => k !== 'null(无动词)');
  console.log(`  命中项 kind 分布: ${Object.entries(kindDist).map(([k,v])=>k+'×'+v).join(' · ')}`);
  console.log(`  → 与默认三类并存: ${coexist.length ? '是（'+coexist.join('/')+'）——说明它是**正交轴**不是第 4 类' : '否（只在 null 上命中）'}`);
  console.log('');
}

// ── 逐条特征表（供人工复核）────────────────────────────
console.log('─'.repeat(64));
console.log('逐条特征（peer/self/自报/互指/单向通知）:');
for (const r of rows) {
  const m = (b) => b ? '✔' : '·';
  console.log(`  ${r.id.padEnd(5)} gold=${r.gold.padEnd(8)}${r.noVerb ? ' [无动词真关系]' : ''}  peer${m(r.f.peer)} self${m(r.f.self)} 自报${m(r.f.selfReport)} 互指${m(r.f.mutual)} 单向${m(r.f.oneWay)}  ${r.f.peers.length?'['+r.f.peers.join(',')+']':''}`);
}

console.log('─'.repeat(64));
console.log('⚠️ 本集局限（不隐瞒，否则数字会被读成结论）:');
console.log('  · 真关系事件只有 2 条（G-15/G-16），负例 12 条 → 分母极小，任何阈值都不具统计力；');
console.log('  · V2 的 0 过判是**样本内**结果，且判据是我看着这 33 条调的 → 有**过拟合到 N-09** 的风险；');
console.log('  · 要下结论，需一组**未参与调参**的 held-out 负例复验。本测量的价值是把澈那句话');
console.log('    从「要预先量一下」变成一个可复现的数 + 一个可讨论的判据，不是「已证成立」。');