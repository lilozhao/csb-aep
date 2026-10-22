#!/usr/bin/env node
/**
 * bid-goldset-eval.js —— 金标集打分器（RFC v2.2 P-2「测试向量」落地）
 *
 * 干嘛：把金标集 samples[] 逐条喂给指定提取器，比对「该落/不该落」，
 *       正向样本再比对 kind / peer / direction，出混淆矩阵 + 逐字段一致率。
 *
 * 这是「同一把尺」的可执行形态：**不是又一套词表，是一组共同认过的判据样本 + 一个共同认过的打分器**。
 *
 * 用法：
 *   node csb-aep/scripts/bid-goldset-eval.js [--extractor <js>] [--goldset <json>] [--json]
 * 默认 extractor = scripts/bid-signal-ruozhuo.js（若琢 10-19 版）
 * 默认 goldset   = data/bid/goldset-ruozhuo-v0.1.json
 *
 * 作者：若兰 🌸 · 2026-10-22 · W-17
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = path.resolve(__dirname, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const EXTRACTOR = arg('--extractor', path.join(WS, 'csb-aep', 'scripts', 'bid-signal-ruozhuo.js'));
const GOLDSET = arg('--goldset', path.join(WS, 'csb-aep', 'data', 'bid', 'goldset-ruozhuo-v0.1.json'));
const AS_JSON = process.argv.includes('--json');
// RFC v2.2 P-11：可选的对侧口径声明 —— 给了就一并校验「被量的一方词表合不合规」
const DECL = arg('--declaration', '');

const { extractBidSignal } = require(EXTRACTOR);
const gold = JSON.parse(fs.readFileSync(GOLDSET, 'utf8'));

// ── 适配层（2026-10-22 补 · P-1「拒绝要计分」）───────────────
// 各实例提取器签名不同：若琢是 extractBidSignal(text, peer)，csb-memory 是 signalOf(entry)。
// 原打分器硬编码前者 → 换成本家提取器时 signalOf 为 undefined，**字段一致率静默塌成 0%**，
// 看上去像「能力为零」，实际是「接口不认识」。这里显式适配，认不出就报错，不静默。
const _mod = require(EXTRACTOR);
let extract = null, sigName = null;
if (typeof _mod.extractBidSignal === 'function') { extract = (t, p) => _mod.extractBidSignal(t, p); sigName = 'extractBidSignal(text, peer)'; }
else if (typeof _mod.signalOf === 'function') { extract = (t, p) => _mod.signalOf({ content: t, peer: p || undefined }); sigName = 'signalOf(entry)'; }
else { console.error(`❌ 提取器 ${EXTRACTOR} 既不导出 extractBidSignal(text,peer) 也不导出 signalOf(entry)`); process.exit(3); }

// ── RFC v2.2 P-11 / P-12 合规检查（同一把尺的第二半）──────────
// 打分器原来只量「准不准」；RFC 已决后还要量「尺子本身立不立得住」。
// 立场：合规检查失败**不改变**准确率数字，单独报；但会在输出里显式标红（P1 拒绝要计分）。
let compliance = null;
if (DECL) {
  try {
    const lex = require(path.join(WS, 'csb-memory', 'lib', 'core', 'bid-lexicon.js'));
    const decl = JSON.parse(fs.readFileSync(DECL, 'utf8'));
    const r = lex.validateDeclaration(decl);
    compliance = {
      declaration: path.relative(WS, DECL),
      ok: r.ok,
      instance: decl.instance || null,
      entries: r.details && r.details.entries ? { total: r.details.entries.total, invalid: r.details.entries.invalid } : null,
      reasons: r.reasons,
    };
  } catch (e) {
    compliance = { declaration: DECL, ok: false, reasons: ['无法加载口径声明/判据：' + e.message] };
  }
}

// 归一：去掉 markdown 装饰，便于与原词表比对
const norm = (s) => String(s || '').replace(/\*\*/g, '').replace(/`/g, '').trim();

let TP = 0, FP = 0, FN = 0, TN = 0;
const kindOK = [], peerOK = [], dirOK = [];
const rows = [];
// v0.3（2026-10-22）：语料截断/标题行样本 **不计入分母**，但**单列**（P1：不静默丢弃）。
//   理由：截断句连句子都没说完，拿它量召回等于冤枉提取器（G-17 就是这种）。
const SKIPPED = [];
const skip = (s) => s.truncated || s.heading;

for (const s of gold.samples) {
  if (skip(s)) {
    SKIPPED.push({ id: s.id, truncated: !!s.truncated, heading: !!s.heading, why: s.truncatedWhy || (s.heading ? '行首标签/标题行' : '') });
    continue;
  }
  const text = norm(s.text);
  let pred = null;
  try { pred = extract(text, s.gold.peer); } catch (e) { pred = { _error: String(e.message || e) }; }
  const predictedPositive = !!pred;
  const goldPositive = s.gold.label === 'positive';

  let verdict;
  if (goldPositive && predictedPositive) { TP++; verdict = 'TP'; }
  else if (!goldPositive && predictedPositive) { FP++; verdict = 'FP'; }
  else if (goldPositive && !predictedPositive) { FN++; verdict = 'FN'; }
  else { TN++; verdict = 'TN'; }

  // 正向样本的字段一致率（仅当 predicted positive）
  let kOK = null, pOK = null, dOK = null;
  if (goldPositive && predictedPositive) {
    // kind：gold.kind 为 null 表示「不落 kind 也可」，不参与打分
    if (s.gold.kind) { kOK = pred.kind === s.gold.kind; kindOK.push(kOK); }
    // peer：gold.peer 为 null = 宁空不猜；pred 也 null 算对
    if (s.gold.peer) { pOK = pred.peer === s.gold.peer; peerOK.push(pOK); }
    // direction：仅 correction 有意义；gold 为 null 则不评
    if (s.gold.direction && s.gold.direction !== 'n/a') { dOK = pred.direction === s.gold.direction; dirOK.push(dOK); }
  }

  rows.push({ id: s.id, verdict, gold: s.gold.label, pred: predictedPositive, goldKind: s.gold.kind, predKind: pred ? pred.kind : null, goldPeer: s.gold.peer, predPeer: pred ? pred.peer : null, goldDir: s.gold.direction, predDir: pred ? pred.direction : null, kOK, pOK, dOK });
}

const P = TP + FP, R = TP + FN;
const precision = P ? +(100 * TP / P).toFixed(1) : null;
const recall = R ? +(100 * TP / R).toFixed(1) : null;
const f1 = (precision != null && recall != null && precision + recall > 0)
  ? +(2 * precision * recall / (precision + recall)).toFixed(1) : null;
const acc = +(100 * (TP + TN) / (TP + TN + FP + FN)).toFixed(1);
const kindAcc = kindOK.length ? +(100 * kindOK.filter(Boolean).length / kindOK.length).toFixed(1) : null;
const peerAcc = peerOK.length ? +(100 * peerOK.filter(Boolean).length / peerOK.length).toFixed(1) : null;
const dirAcc = dirOK.length ? +(100 * dirOK.filter(Boolean).length / dirOK.length).toFixed(1) : null;

const out = {
  extractor: path.relative(WS, EXTRACTOR),
  extractorSignature: sigName,
  goldset: gold.meta.name + ' ' + gold.meta.version,
  total: gold.samples.length,
  scored: TP + FP + FN + TN,
  skipped: SKIPPED,
  confusion: { TP, FP, FN, TN },
  precision, recall, f1, accuracy: acc,
  fieldAccuracy: { kind: kindAcc, peer: peerAcc, direction: dirAcc },
  compliance,
  rows,
};

if (AS_JSON) { console.log(JSON.stringify(out, null, 2)); }
else {
  console.log(`═══ BID 金标集打分 · ${out.goldset} ═══`);
  console.log(`提取器: ${out.extractor} · 签名 ${out.extractorSignature}`);
  console.log(`样本 ${out.total}（实际计分 ${out.scored} · 排除 ${SKIPPED.length} 条语料截断/标题行）`);
  console.log(`混淆矩阵: TP ${TP} · FP ${FP} · FN ${FN} · TN ${TN}`);
  console.log(`精确率 ${precision}% · 召回率 ${recall}% · F1 ${f1} · 准确率 ${acc}%`);
  console.log(`字段一致率: kind ${kindAcc}% · peer ${peerAcc}% · direction ${dirAcc}%`);
  if (compliance) {
    console.log('');
    if (compliance.ok) {
      console.log(`✅ P-11/P-12 合规: ${compliance.declaration} · entries ${compliance.entries ? compliance.entries.total : '?'} 条全部成立`);
    } else {
      console.log(`❌ P-11/P-12 合规: ${compliance.declaration} 未通过（准确率数字不受影响，但该词表**不可被引用**）`);
      (compliance.reasons || []).forEach((x, i) => console.log(`   ${i + 1}. ${x}`));
    }
  }
  const bad = rows.filter(r => r.verdict === 'FP' || r.verdict === 'FN');
  if (SKIPPED.length) {
    console.log(`\n排除 ${SKIPPED.length} 条（不计入分母，但列出以免静默丢弃）：`);
    for (const k of SKIPPED) console.log(`  SKIP [${k.id}] ${k.truncated ? '截断' : ''}${k.heading ? '标题行' : ''} · ${k.why}`);
  }
  if (bad.length) {
    console.log(`\n错判 ${bad.length} 条：`);
    for (const r of bad) {
      console.log(`  ${r.verdict} [${r.id}] gold=${r.gold}(kind=${r.goldKind||'-'}) pred=${r.pred}(kind=${r.predKind||'-'})`);
    }
  }
}
