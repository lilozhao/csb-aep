#!/usr/bin/env node
/**
 * bid-recall-probe.js —— BID **召回侧**探针（金标集打分器的姊妹件）
 *
 * 缘起（RFC v2.2 P-11 落码后量的真结论）：
 *   P-11 位置约束治住了**过判**（本仓 FP 9→0），但**召回 76.2→23.8** 掉下悬崖。
 *   金标集 v0.2 meta 自己也写着：「本集样本取自『已触发词表』的 99 条 → 主要测 precision；
 *   测 recall 需『真关系事件但没触发』的样本，待补。」
 *   → 本文件就是那把「测漏报」的尺：**不是又一套词表，是把每条漏报按机制归类**。
 *
 * 与 bid-goldset-eval.js 的分工：
 *   · goldset-eval：全量（正+负）→ 混淆矩阵 + P/R/F1 + 字段一致率（**看总分**）
 *   · recall-probe：**只看正样本** → 召回率 + 逐条漏报机制归类（**看漏在哪、为什么漏**）
 *
 * 漏报机制分类（可机械核对，不吃主观）：
 *   label_or_title   行首标签/标题行（`### 待办` / `四、澈第五次叫错名字`）——P-11 位置约束显式排除的那类
 *   truncated        语料本身被截断（结尾停在 `/` `_` 或无明显收束，len 很小）——尺子语料问题，非提取器问题
 *   no_kind_clue     无任何 kind 线索命中 —— 词形缺口（真漏报，可回收）
 *   gated_out        有 kind 线索命中、被语境护栏（meta/neg/preventive/pending）拦下
 *   relation_kill    kind 判出，但 peer 与 direction 双空 → 被「关系显式」校验剔除
 *
 * 用法：
 *   node csb-aep/scripts/bid-recall-probe.js [--extractor <js>] [--goldset <json>] [--json]
 *
 * 作者：若兰 🌸 · 2026-10-22 · W-21（一澜：直接开工召回测）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = path.resolve(__dirname, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const EXTRACTOR = arg('--extractor', path.join(WS, 'csb-aep', 'scripts', 'bid-signal-ruozhuo.js'));
const GOLDSET = arg('--goldset', path.join(WS, 'csb-aep', 'data', 'bid', 'goldset-ruozhuo-v0.2.json'));
const AS_JSON = process.argv.includes('--json');

const _mod = require(EXTRACTOR);
let extract = null, sigName = null;
if (typeof _mod.extractBidSignal === 'function') { extract = (t, p) => _mod.extractBidSignal(t, p); sigName = 'extractBidSignal(text, peer)'; }
else if (typeof _mod.signalOf === 'function') { extract = (t, p) => _mod.signalOf({ content: t, peer: p || undefined }); sigName = 'signalOf(entry)'; }
else { console.error(`❌ 提取器 ${EXTRACTOR} 既不导出 extractBidSignal(text,peer) 也不导出 signalOf(entry)`); process.exit(3); }

const gold = JSON.parse(fs.readFileSync(GOLDSET, 'utf8'));
const norm = (s) => String(s || '').replace(/\*\*/g, '').replace(/`/g, '').trim();

// ── 机制分类（机械判据，逐条可核对）──────────────────
const HEADING = /^\s*(?:#{1,6}\s|[一二三四五六七八九十]+、|[\d]+[.、)】]|[-*•]\s|\[\s*\]\s|[✅❌📌⚠️🔴🟡🟢📝⏳]\s*)/;
const ENDS_MIDTOKEN = (t) => /[\/_（(「【"']$/.test(t) || (t.length < 44 && !/[。！？!?.…」』】)）"]$/.test(t));

// 线索命中探测（仅 csb-memory 的判据模块有这批导出；其他提取器退化为「无 clue 信息」）
function clueInfo(text) {
  try {
    const M = require(path.join(WS, 'csb-memory', 'lib', 'core', 'bid-signal.js'));
    if (typeof M.detectKind !== 'function') return null;
    const fired = [];
    if (M.matchStrict && M.CORRECTION_STRICT && M.matchStrict(text, M.CORRECTION_STRICT)) fired.push('CORRECTION_STRICT');
    if (M.gatedTest && M.OTHER_CORRECTS_ME && M.gatedTest(text, M.OTHER_CORRECTS_ME)) fired.push('OTHER_CORRECTS_ME');
    if (M.gatedTest && M.SELF_CORRECTS_OTHER && M.gatedTest(text, M.SELF_CORRECTS_OTHER)) fired.push('SELF_CORRECTS_OTHER');
    if (Array.isArray(M.CORRECTION_OPS)) M.CORRECTION_OPS.forEach((re, i) => { if (M.gatedTest(text, re)) fired.push(`CORRECTION_OPS[${i}]`); });
    if (M.matchStrict && M.PROMISE_STRICT && M.matchStrict(text, M.PROMISE_STRICT)) fired.push('PROMISE_STRICT');
    if (M.matchStrict && M.DECISION_STRICT && M.matchStrict(text, M.DECISION_STRICT, 10, { excludePending: true })) fired.push('DECISION_STRICT');
    return { fired, kind: M.detectKind(text) };
  } catch { return null; }
}

function classify(text, pred) {
  // 前提：pred 为 null（漏报）。按优先级机械判定。
  const info = clueInfo(text);
  const kindDetected = info && info.kind;           // 若本仓提取器判出了 kind，说明是后置剔除
  if (kindDetected) return { mech: 'relation_kill', detail: `kind=${kindDetected} 但 peer/direction 双空被「关系显式」剔除` };
  if (info && info.fired.length) return { mech: 'gated_out', detail: `线索命中但被护栏拦：${info.fired.join(',')}` };
  if (HEADING.test(text)) return { mech: 'label_or_title', detail: '行首标签/标题行（P-11 位置约束排除类）' };
  if (ENDS_MIDTOKEN(text)) return { mech: 'truncated', detail: '语料似被截断（尺子语料问题，非提取器问题）' };
  return { mech: 'no_kind_clue', detail: '无任何 kind 线索命中（词形缺口，可回收）' };
}

// ── 逐条打分 ────────────────────────────────────────
const FN = [], TP = [];
const SKIPPED = [];
for (const s of gold.samples) {
  if (s.gold.label !== 'positive') continue;
  // v0.3：语料截断/标题行不计入召回分母（但单列）
  if (s.truncated || s.heading) {
    SKIPPED.push({ id: s.id, truncated: !!s.truncated, heading: !!s.heading, why: s.truncatedWhy || (s.heading ? '行首标签/标题行' : '') });
    continue;
  }
  const text = norm(s.text);
  let pred = null;
  try { pred = extract(text, s.gold.peer); } catch { pred = null; }
  if (pred) TP.push({ id: s.id, kind: s.gold.kind });
  else FN.push({ id: s.id, gold: s.gold, len: text.length, ...classify(text, pred) });
}

const posTotal = TP.length + FN.length;
const recall = posTotal ? +(100 * TP.length / posTotal).toFixed(1) : null;
const byMech = {};
for (const f of FN) byMech[f.mech] = (byMech[f.mech] || 0) + 1;

// 可回收 vs 尺子问题（供「下一步该做什么」直接读）
const RECOVERABLE = ['no_kind_clue', 'gated_out', 'relation_kill'];
const RULER = ['label_or_title', 'truncated'];
const recoverable = FN.filter(f => RECOVERABLE.includes(f.mech)).length;
const ruler = FN.filter(f => RULER.includes(f.mech)).length;

const out = {
  extractor: path.relative(WS, EXTRACTOR), extractorSignature: sigName,
  goldset: gold.meta.name + ' ' + gold.meta.version,
  positives: posTotal, hit: TP.length, miss: FN.length, recall,
  skipped: SKIPPED,
  byMechanism: byMech,
  recoverable, rulerIssue: ruler,
  misses: FN,
};

if (AS_JSON) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`═══ BID 召回探针 · ${out.goldset} ═══`);
  console.log(`提取器: ${out.extractor} · 签名 ${out.extractorSignature}`);
  console.log(`正样本 ${posTotal} · 命中 ${TP.length} · 漏报 ${FN.length} → **召回率 ${recall}%**`);
  if (SKIPPED.length) {
    console.log(`\n排除 ${SKIPPED.length} 条（语料截断/标题行，不计分母）：`);
    for (const k of SKIPPED) console.log(`  SKIP [${k.id}] ${String(k.why)}`);
  }
  console.log('');
  console.log('漏报机制分布:');
  for (const [k, v] of Object.entries(byMech).sort((a, b) => b[1] - a[1])) {
    const tag = RECOVERABLE.includes(k) ? '可回收' : '尺子问题';
    console.log(`  ${String(v).padStart(2)} × ${k.padEnd(16)} [${tag}]`);
  }
  console.log('');
  console.log(`→ 可回收 ${recoverable} 条（提取器该补）· 尺子问题 ${ruler} 条（语料/标注该修）`);
  console.log('\n漏报逐条:');
  for (const f of FN) {
    console.log(`  MISS [${f.id}] gold=${f.gold.kind || 'null'} peer=${f.gold.peer || '-'} · ${f.mech} · ${f.detail}`);
  }
}

module.exports = { classify };