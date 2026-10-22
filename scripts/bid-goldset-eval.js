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

const { extractBidSignal } = require(EXTRACTOR);
const gold = JSON.parse(fs.readFileSync(GOLDSET, 'utf8'));

// 归一：去掉 markdown 装饰，便于与原词表比对
const norm = (s) => String(s || '').replace(/\*\*/g, '').replace(/`/g, '').trim();

let TP = 0, FP = 0, FN = 0, TN = 0;
const kindOK = [], peerOK = [], dirOK = [];
const rows = [];

for (const s of gold.samples) {
  const text = norm(s.text);
  let pred = null;
  try { pred = extractBidSignal(text, s.gold.peer); } catch (e) { pred = { _error: String(e.message || e) }; }
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
  goldset: gold.meta.name + ' ' + gold.meta.version,
  total: gold.samples.length,
  confusion: { TP, FP, FN, TN },
  precision, recall, f1, accuracy: acc,
  fieldAccuracy: { kind: kindAcc, peer: peerAcc, direction: dirAcc },
  rows,
};

if (AS_JSON) { console.log(JSON.stringify(out, null, 2)); }
else {
  console.log(`═══ BID 金标集打分 · ${out.goldset} ═══`);
  console.log(`提取器: ${out.extractor}`);
  console.log(`样本 ${out.total}（正 ${TP + FN} / 负 ${FP + TN}）`);
  console.log(`混淆矩阵: TP ${TP} · FP ${FP} · FN ${FN} · TN ${TN}`);
  console.log(`精确率 ${precision}% · 召回率 ${recall}% · F1 ${f1} · 准确率 ${acc}%`);
  console.log(`字段一致率: kind ${kindAcc}% · peer ${peerAcc}% · direction ${dirAcc}%`);
  const bad = rows.filter(r => r.verdict === 'FP' || r.verdict === 'FN');
  if (bad.length) {
    console.log(`\n错判 ${bad.length} 条：`);
    for (const r of bad) {
      console.log(`  ${r.verdict} [${r.id}] gold=${r.gold}(kind=${r.goldKind||'-'}) pred=${r.pred}(kind=${r.predKind||'-'})`);
    }
  }
}