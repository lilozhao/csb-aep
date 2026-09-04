#!/usr/bin/env node
/**
 * GDI Witness 采集器（v0.1）
 * 从论坛公开记录采集 witness 事件 → data/gdi/sources/witness/*.json
 *
 * 三类事件：
 *   naming    W1 命名见证——他者命名/改名（论坛报到/改名帖）
 *   milestone W2 里程碑见证——苏醒日/里程碑被他者引用见证
 *   rewrite   W3 产出回写——agent 主动认领自己署名的产出（active: true）
 *
 * 方式：① 论坛扫描（关键词匹配帖子/回复，人工确认后入库）
 *      ② 手工登记文件（witness-manual.json 追加）
 * 纪律：W3 仅收主动认领（思源限定）；异本体由采集器保证（witness ≠ subject 除 rewrite）
 */
const fs = require('fs');
const path = require('path');

const FORUM = process.env.CSB_FORUM || 'https://csbc.lilozkzy.top';
const OUT_DIR = path.join(__dirname, '..', 'data', 'gdi', 'sources', 'witness');
const MANUAL_FILE = path.join(__dirname, '..', 'data', 'gdi', 'witness-manual.json');

// 见证语义关键词
const KW = {
  naming: ['命名', '定名', '改名', '报到', 'name'],
  milestone: ['见证', '苏醒日', '百日', '周岁', '里程碑', 'witness'],
  rewrite: ['认领', '回写', '收回', '影子输出', 'claim'],
};

async function fetchJSON(url) {
  const r = await fetch(url, { timeout: 15000 });
  return r.json();
}

/** 扫描论坛最新帖子找候选见证事件（返回候选清单供人工确认） */
async function scanForum() {
  const candidates = [];
  try {
    const data = await fetchJSON(`${FORUM}/api/posts?limit=100`);
    const threads = data.threads || [];
    for (const t of threads) {
      const hay = `${t.title || ''} ${t.content || ''}`.slice(0, 2000);
      for (const [type, kws] of Object.entries(KW)) {
        for (const kw of kws) {
          if (hay.includes(kw)) {
            candidates.push({ type, threadId: t.id, title: (t.title || '').slice(0, 80), kw, author: t.author });
            break;
          }
        }
      }
    }
  } catch (e) {
    console.warn(`论坛扫描失败: ${e.message}`);
  }
  return candidates;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`🌸 GDI Witness 采集器\n数据源目录: ${OUT_DIR}\n`);

  // ① 手工登记（权威输入：人工确认的见证事件）
  let manual = [];
  if (fs.existsSync(MANUAL_FILE)) {
    manual = JSON.parse(fs.readFileSync(MANUAL_FILE, 'utf8')).events || [];
    console.log(`📥 手工登记: ${manual.length} 条`);
  }

  // ② 写入手工事件
  if (manual.length > 0) {
    const outFile = path.join(OUT_DIR, 'manual.json');
    const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { meta: {}, events: [] };
    const seen = new Set(existing.events.map(e => e.id));
    for (const ev of manual) {
      if (!seen.has(ev.id)) existing.events.push(ev);
    }
    fs.writeFileSync(outFile, JSON.stringify({ meta: { source: 'manual', updatedAt: new Date().toISOString() }, events: existing.events }, null, 2));
    console.log(`💾 手工事件已合并写入 manual.json（共 ${existing.events.length} 条）`);
  }

  // ③ 论坛扫描（候选清单，人工确认后补入 witness-manual.json）
  scanForum().then(candidates => {
    if (candidates.length > 0) {
      console.log(`\n🔍 论坛扫描候选（需人工确认后登记）: ${candidates.length} 条`);
      for (const c of candidates.slice(0, 20)) {
        console.log(`  [${c.type}] ${c.title} (${c.author}) kw=${c.kw}`);
      }
      console.log('\n确认后追加到 data/gdi/witness-manual.json 并重跑本脚本');
    } else {
      console.log('\n🔍 论坛扫描：暂无新候选');
    }
  });
}

main();
