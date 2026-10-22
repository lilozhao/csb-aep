#!/usr/bin/env node
/**
 * bid-goldset-fix-truncated.js —— 金标集 v0.3 修正：剔除/标记**语料截断**样本
 *
 * 背景（2026-10-22 · W-21 召回测）：
 *   金标集 v0.2 的 text 取自若琢 99 条 raw，但 raw 本身是**按行截取的**——
 *   例如 G-17 原文停在 `/workspace/ruolan-memory/ 全套（IDENTITY/SOUL/MEMORY/SELF_`，
 *   句子被硬切断。用这种残缺句去量提取器的召回，等于「句子都没说完，怪它没读懂」。
 *
 *   这正是已经踩过一次的同类错误：v0.1 的 text 是**转述**（口径不实），v0.2 换回原文但没查**完整性**。
 *   教训升级：**尺子的语料不仅要同口径，还要完整**。
 *
 * 本脚本做的事（不删样本，只加标记，可回滚）：
 *   · 自动识别「疑似截断」——结尾停在 `/`、`_`、`(`、`（` 等，或长度很短且无收束标点
 *   · 给该条加 `truncated: true` + `truncatedWhy`
 *   · 打分器/探针据此**不计入召回分母**，但仍在输出里单列（P1：不静默丢弃）
 *
 * 用法：node csb-aep/scripts/bid-goldset-fix-truncated.js [--in <json>] [--out <json>] [--dry]
 *
 * 作者：若兰 🌸 · 2026-10-22 · W-21
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = path.resolve(__dirname, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const IN = arg('--in', path.join(WS, 'csb-aep', 'data', 'bid', 'goldset-ruozhuo-v0.2.json'));
const OUT = arg('--out', path.join(WS, 'csb-aep', 'data', 'bid', 'goldset-ruozhuo-v0.3.json'));
const DRY = process.argv.includes('--dry');

// 句末应有收束；没有收束且满足以下**硬证据**之一 → 截断。
// ⚠️ 2026-10-22 自纠：「短且无标点」是**弱推测**，不是证据——
//   初版用它把 14 条全标成截断，其中 G-03/G-08/G-21 是完整句（日记语体本就常不带句号）。
//   判据纪律：**错误标签比漏标签代价高**（会把真漏报错误归因为「尺子问题」）。
const TERMINAL = /[。！？!?.…」』】)）"]\s*$/;
// 停在路径/括号/引号中间，或末尾是「大写标识符_」被切断（SELF_ / MEMORY_）
const HARD_CUT = /(?:\/|（\s*$|\(\s*$|「\s*$|【\s*$|[A-Z][A-Z0-9_]*_)\s*$/;
const TRAILING_PATH = /[A-Za-z0-9_\/-]+\/\s*$/;                    // 末尾是未闭合路径
const TRAILING_IDENT = /\s[A-Za-z][A-Za-z0-9_.\-]{6,}\s*$/;          // 末尾挂着裸标识符

function detectTruncation(text) {
  const t = String(text || '').trim();
  if (!t) return { truncated: true, why: '空样本' };
  if (TERMINAL.test(t)) return { truncated: false };
  if (HARD_CUT.test(t)) return { truncated: true, why: '结尾停在不该停的符号（路径/括号/引号未闭合）' };
  if (TRAILING_PATH.test(t)) return { truncated: true, why: '结尾是未闭合路径' };
  if (TRAILING_IDENT.test(t)) return { truncated: true, why: '结尾挂着未闭合标识符' };
  return { truncated: false };
}

const gold = JSON.parse(fs.readFileSync(IN, 'utf8'));
let marked = 0;
const report = [];
for (const s of gold.samples) {
  const r = detectTruncation(s.text);
  delete s.truncated; delete s.truncatedWhy;
  if (r.truncated) { s.truncated = true; s.truncatedWhy = r.why; marked++; }
  // 标题行单列（不是截断，是语料粒度问题）
  const isHeading = /^\s*(?:#{1,6}\s|[一二三四五六七八九十]+、|[-*•]\s|\[\s*\]\s)/.test(String(s.text || ''));
  if (isHeading) { s.heading = true; }
  if (r.truncated || isHeading) report.push({ id: s.id, text: String(s.text).slice(0, 50), why: r.why || '行首标签/标题行', heading: isHeading, truncated: r.truncated });
}

gold.meta.version = 'v0.3';
gold.meta.v0_3_change = '剔除/标记语料截断与标题行样本（truncated / heading 字段）；打分器应把它们排除出召回分母，但仍在输出中单列（P1：不静默丢弃）。';
gold.meta.fix_script = 'csb-aep/scripts/bid-goldset-fix-truncated.js';

console.log(`═══ 金标集 v0.3 修正 ═══`);
console.log(`输入 ${path.relative(WS, IN)} → 输出 ${path.relative(WS, OUT)}`);
console.log(`共 ${gold.samples.length} 条，标记疑似截断 ${marked} 条\n`);
for (const r of report) {
  const tag = [r.truncated ? 'TRUNC' : '', r.heading ? 'HEADING' : ''].filter(Boolean).join('+');
  console.log(`  ${r.id.padEnd(5)} [${tag.padEnd(13)}] ${r.why}`);
  console.log(`        ${JSON.stringify(r.text)}`);
}
if (DRY) { console.log('\n(--dry：未写文件)'); process.exit(0); }
fs.writeFileSync(OUT, JSON.stringify(gold, null, 2), 'utf8');
console.log(`\n✅ 已写出 ${path.relative(WS, OUT)}`);
