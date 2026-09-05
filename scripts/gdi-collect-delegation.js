#!/usr/bin/env node
/**
 * GDI delegation 采集器（X-1 · 2026-09-05）
 *
 * 把 A2A 委托审计日志（csb-a2a-aip/delegation-audit.jsonl）接入 GDI verify 维度
 * → data/gdi/sources/audit/delegation.jsonl（csb-security AuditLog 同构，哈希链原样保留）
 *
 * 链路：DelegationManager 动作（grant/revoke/revoke_all）→ audit 落盘（带哈希链）
 *       → 本采集器同步 → GDI verify 维度消费（通过率 = 作为 callee 的 success 占比）
 *
 * 纪律：
 *   - 原样复制（不重算哈希、不改字段）——链完整性由源头保证
 *   - 幂等：按 (timestamp|event_type|delegation_id) 指纹去重，重复跑不重复追加
 *   - 测试数据过滤：grantee 为 test 的 fixture 条目跳过并在 meta 注明（可复核）
 *
 * 用法：node scripts/gdi-collect-delegation.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const A2A_DIR = path.join(__dirname, '..', '..', 'csb-a2a-aip');
const AUDIT_SRC = path.join(A2A_DIR, 'delegations-audit.jsonl'); // DelegationManager 默认推导路径（storePath 同名 -audit.jsonl）
const OUT_FILE = path.join(__dirname, '..', 'data', 'gdi', 'sources', 'audit', 'delegation.jsonl');
const TEST_GRANTEES = new Set(['test']); // fixture 测试条目（user1 → test）

function readLines(f) {
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const src = readLines(AUDIT_SRC);
  const existing = readLines(OUT_FILE);
  const seen = new Set(existing.map(r => `${r.timestamp}|${r.event_type}|${r.delegation_id || ''}`));

  let copied = 0, skippedTest = 0, dup = 0;
  const toAppend = [];
  for (const rec of src) {
    if (TEST_GRANTEES.has(rec.callee_id)) { skippedTest++; continue; }
    const fp = `${rec.timestamp}|${rec.event_type}|${rec.delegation_id || ''}`;
    if (seen.has(fp)) { dup++; continue; }
    toAppend.push(rec); seen.add(fp); copied++;
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    source: 'csb-a2a-aip/delegation-audit.jsonl',
    copied, skippedTest, dup, totalInSource: src.length,
    note: skippedTest > 0 ? `跳过 ${skippedTest} 条 test fixture` : undefined,
  };
  console.log(JSON.stringify(meta, null, 2));

  if (!dryRun && toAppend.length > 0) {
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.appendFileSync(OUT_FILE, toAppend.map(r => JSON.stringify(r)).join('\n') + '\n');
    console.log(`✅ 追加 ${toAppend.length} 条 → ${path.relative(process.cwd(), OUT_FILE)}`);
  } else if (dryRun) {
    console.log(`（dry-run）待追加 ${toAppend.length} 条`);
  } else {
    console.log('无新增（源为空或已同步）——机制就绪，等待真实委托产生审计数据');
  }
}

main();
