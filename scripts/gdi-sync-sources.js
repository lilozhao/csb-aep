#!/usr/bin/env node
/**
 * GDI 数据源同步 · CSB-AEP v2.3
 *
 * 将采集器产出的契约/引用 JSON 同步到 server 数据源目录 data/gdi/sources/。
 * 采集器（单一事实源）：
 *   - gdi-mvp/scripts/collect-contracts.js   → gdi-mvp/data/contracts.json（评审日志自动采集）
 *   - gdi-mvp/scripts/collect-references.js  → gdi-mvp/data/references.json（校验/重扫）
 * 本脚本只做「拷贝 + 命名」（文件名 = 数据源标识，供 /api/gdi/sources 展示）。
 *
 * 用法：
 *   node scripts/gdi-sync-sources.js                  # 默认从 gdi-mvp/data 同步
 *   node scripts/gdi-sync-sources.js --dry-run        # 只显示将同步什么
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCES_DIR = path.join(ROOT, 'data', 'gdi', 'sources');
const MVP_DATA = path.join(ROOT, 'gdi-mvp', 'data');

// 同步映射：{ mvp 文件 → sources 子目录 + 目标文件名 }
const SYNC_MAP = [
  {
    from: path.join(MVP_DATA, 'contracts.json'),
    toDir: path.join(SOURCES_DIR, 'contracts'),
    toName: 'gdi-review-2026-09-02.json', // 数据源标识（评审日志场景）
  },
  {
    from: path.join(MVP_DATA, 'references.json'),
    toDir: path.join(SOURCES_DIR, 'references'),
    toName: 'gdi-draft-forum-2026-09-02.json', // 数据源标识（定稿+论坛引用场景）
  },
];

function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? '[gdi-sync-sources] --dry-run' : '[gdi-sync-sources]');
  for (const item of SYNC_MAP) {
    if (!fs.existsSync(item.from)) {
      console.log(`  ⏭️  源不存在，跳过: ${path.relative(ROOT, item.from)}`);
      continue;
    }
    const dest = path.join(item.toDir, item.toName);
    if (dryRun) {
      console.log(`  → 将同步 ${path.relative(ROOT, item.from)} → ${path.relative(ROOT, dest)}`);
      continue;
    }
    fs.mkdirSync(item.toDir, { recursive: true });
    fs.copyFileSync(item.from, dest);
    console.log(`  ✅ ${path.relative(ROOT, item.from)} → ${path.relative(ROOT, dest)}`);
  }
  if (!dryRun) console.log('\n提示：同步后重启 AEP server 生效（GdiObserver 启动时读 sources）');
}

main();
