#!/usr/bin/env node
/**
 * GDI MVP · 引用数据采集/校验器
 *
 * references.json 中每条引用都带 evidence（可验证证据描述）与 docRef（文档锚点）。
 * 本脚本：
 *   1. 校验（默认）：提取每条 evidence 中的「」引号关键词 / 关键短语，
 *      在 meta.sources 声明的源文件里全文搜索 → 全部命中输出 OK（防文档漂移）
 *   2. --rescan：扫描源文件，列出 evidence 关键词的命中位置（复核辅助）
 *
 * 用法：
 *   node scripts/collect-references.js            # 校验数据文件与源文档一致
 *   node scripts/collect-references.js --rescan   # 输出各证据关键词的文档命中位置
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WS = path.join(ROOT, '..', '..');
const refsFile = path.join(ROOT, 'data', 'references.json');

function load() { return JSON.parse(fs.readFileSync(refsFile, 'utf8')); }

/** 从 evidence 提取检索关键词：「」内短语 + 冒号后的术语 + 书名号内容 */
function extractKeys(evidence) {
  const keys = new Set();
  const quoted = evidence.match(/「([^」]+)」|《([^》]+)》|([A-Za-z0-9\u4e00-\u9fff]+(?:技能|校验|锚点|隔离|机制|建议|触发))/g) || [];
  for (const q of quoted) {
    const clean = q.replace(/[「」《》]/g, '');
    if (clean.length >= 3) keys.add(clean);
  }
  // 兜底：把 evidence 按；切段取每段前 12 字
  for (const seg of evidence.split('；')) {
    const s = seg.trim().replace(/^.*?[：:]/, '');
    if (s.length >= 4 && s.length <= 16) keys.add(s.slice(0, 12));
  }
  return [...keys].slice(0, 6);
}

function sourceTexts() {
  const doc = load();
  const map = new Map();
  for (const rel of doc.meta.sources) {
    const abs = path.join(WS, rel);
    if (fs.existsSync(abs)) map.set(rel, fs.readFileSync(abs, 'utf8'));
  }
  return map;
}

function verify() {
  const doc = load();
  const texts = sourceTexts();
  let pass = 0, fail = 0;
  const failures = [];
  for (const ref of doc.references) {
    if (!ref.reviewed) { console.log(`  ⏳ ${ref.id} 未复核，跳过`); continue; }
    const keys = extractKeys(ref.evidence);
    const allText = [...texts.values()].join('\n');
    const hitKeys = keys.filter(k => allText.includes(k));
    if (hitKeys.length >= 1) {
      pass++;
      console.log(`  ✅ ${ref.id} 命中 ${hitKeys.length}/${keys.length} 个关键词（${hitKeys.slice(0, 2).join(' / ')}）`);
    } else {
      fail++;
      failures.push(`${ref.id}（关键词: ${keys.join(' / ')}）`);
    }
  }
  console.log(`\n[collect-references] 校验完成：${pass} 通过 / ${fail} 失败`);
  if (failures.length) {
    console.log('  ⚠️ 以下引用证据失效（源文档可能已变更）：');
    failures.forEach(f => console.log(`    - ${f}`));
    console.log('  → 请人工复核 data/references.json，或确认源文档已更新');
    process.exit(1);
  }
}

function rescan() {
  const texts = sourceTexts();
  console.log('[collect-references] --rescan：evidence 关键词在源文档中的命中位置');
  const doc = load();
  for (const ref of doc.references) {
    const keys = extractKeys(ref.evidence);
    for (const k of keys) {
      for (const [file, text] of texts) {
        let idx = text.indexOf(k);
        if (idx >= 0) {
          const line = text.slice(0, idx).split('\n').length;
          console.log(`  📍 ${ref.id}「${k}」→ ${file.split('/').pop()}:${line}`);
          break;
        }
      }
    }
  }
  console.log('\n提示：若有关键词找不到出处，请复核该条引用是否仍然成立');
}

if (process.argv[2] === '--rescan') rescan();
else verify();
