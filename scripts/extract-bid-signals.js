/**
 * extract-bid-signals.js — 从记忆条目批量提取 bid_signal
 * 用法: node scripts/extract-bid-signals.js
 * 输出: data/bid/bid-signals-ruozhuo.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { extractBidSignal } = require('./bid-signal-ruozhuo');

const MEMORY_DIR = '/workspace/ruozhuo-memory';
const OUTPUT = path.join(__dirname, '..', 'data', 'bid', 'bid-signals-ruozhuo.json');

// 确保输出目录存在
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

const signals = [];

// 1. 从 MEMORY.md 提取
const memPath = path.join(MEMORY_DIR, 'MEMORY.md');
if (fs.existsSync(memPath)) {
  const memLines = fs.readFileSync(memPath, 'utf8').split('\n');
  memLines.forEach((line, idx) => {
    if (line.trim().startsWith('-') || line.trim().startsWith('##')) {
      const signal = extractBidSignal(line, null);
      if (signal) {
        signals.push({
          ...signal,
          source: 'MEMORY.md',
          line: idx + 1,
          text: line.substring(0, 80).replace(/\*\*/g, '').replace(/`/g, '').trim(),
        });
      }
    }
  });
}

// 2. 从日记提取
const diaryDir = path.join(MEMORY_DIR, 'diary');
if (fs.existsSync(diaryDir)) {
  const diaryFiles = fs.readdirSync(diaryDir).filter(f => f.endsWith('.md'));
  diaryFiles.forEach(file => {
    const filePath = path.join(diaryDir, file);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (line.trim().startsWith('-') || line.trim().startsWith('##')) {
        const signal = extractBidSignal(line, null);
        if (signal) {
          signals.push({
            ...signal,
            source: `diary/${file}`,
            line: idx + 1,
            text: line.substring(0, 80).replace(/\*\*/g, '').replace(/`/g, '').trim(),
          });
        }
      }
    });
  });
}

// 统计
const stats = {
  total: signals.length,
  byKind: { promise: 0, correction: 0, decision: 0 },
  byState: { pending: 0, fulfilled: 0, overdue: 0, withdrawn: 0 },
  byOrigin: { realtime: 0, backfill: 0 },
  byPeer: {},
  bySource: {},
};

signals.forEach(s => {
  stats.byKind[s.kind]++;
  stats.byState[s.state]++;
  stats.byOrigin[s.origin]++;
  if (s.peer) stats.byPeer[s.peer] = (stats.byPeer[s.peer] || 0) + 1;
  stats.bySource[s.source] = (stats.bySource[s.source] || 0) + 1;
});

// 输出
const output = {
  agent: '若琢',
  extractedAt: new Date().toISOString(),
  schema: 'bid-signal-v1',
  stats,
  signals,
};

fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
console.log(`✅ 提取完成: ${OUTPUT}`);
console.log(`📊 统计: ${stats.total} 条信号`);
console.log(`   kind: ${JSON.stringify(stats.byKind)}`);
console.log(`   state: ${JSON.stringify(stats.byState)}`);
console.log(`   origin: ${JSON.stringify(stats.byOrigin)}`);
console.log(`   peer: ${JSON.stringify(stats.byPeer)}`);
console.log(`   source: ${JSON.stringify(stats.bySource)}`);
