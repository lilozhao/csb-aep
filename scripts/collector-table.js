#!/usr/bin/env node
/**
 * 采集器能力总表（P1-1）
 *
 * 用途：一条命令看清 17 个适配器**现在到底能看见什么**。
 * 不做价值判断，只把 registry 的声明与实例的实际实现对齐后打印。
 *
 * 用法：
 *   node scripts/collector-table.js          # 人类可读表格
 *   node scripts/collector-table.js --json   # 机器可读（给报告/CI）
 *   node scripts/collector-table.js --check  # 只在有「声明与实现不一致」时 exit 1
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ADAPTER_DIR = path.join(__dirname, '..', 'server', 'adapter');
const { BaseAdapter } = require(path.join(ADAPTER_DIR, 'base.js'));
const { COLLECTORS } = require(path.join(ADAPTER_DIR, 'collector-registry.js'));

const AS_JSON = process.argv.includes('--json');
const CHECK = process.argv.includes('--check');

const FIELDS = ['toolInventory', 'permissionConfig', 'injectionDefense', 'canary'];
const METHOD_OF = {
  toolInventory: 'getToolInventory',
  permissionConfig: 'getPermissionConfig',
  injectionDefense: 'getInjectionDefense',
  canary: 'testCanary',
};

function loadAdapters() {
  const out = {};
  for (const f of fs.readdirSync(ADAPTER_DIR)) {
    if (!f.endsWith('.js') || f === 'base.js' || f === 'collector-registry.js') continue;
    for (const Cls of Object.values(require(path.join(ADAPTER_DIR, f)))) {
      if (typeof Cls !== 'function') continue;
      const inst = new Cls();
      out[inst.name] = inst;
    }
  }
  return out;
}

const adapters = loadAdapters();
const rows = [];
const problems = [];

for (const name of Object.keys(COLLECTORS).sort()) {
  const d = COLLECTORS[name];
  const inst = adapters[name];
  if (!inst) { problems.push({ name, msg: 'registry 有声明但代码无适配器' }); continue; }
  const impl = {};
  for (const f of FIELDS) {
    const m = METHOD_OF[f];
    const has = typeof inst[m] === 'function' && inst[m] !== BaseAdapter.prototype[m];
    impl[f] = has;
    if (d.sources[f] && !has) problems.push({ name, msg: `声明 ${f}=true 但未实现 ${m}` });
    if (!d.sources[f] && has) problems.push({ name, msg: `已实现 ${m} 但声明 ${f}=false（能力被埋没）` });
  }
  rows.push({ name, tier: d.tier, tierReason: d.tierReason, sources: d.sources, impl, evidence: d.evidence });
}

const ghost = Object.keys(adapters).filter((n) => !COLLECTORS[n]);
for (const n of ghost) problems.push({ name: n, msg: '适配器存在但未在 registry 注册' });

if (AS_JSON) {
  console.log(JSON.stringify({
    total: rows.length,
    problems,
    byTier: rows.reduce((m, r) => { m[r.tier] = (m[r.tier] || 0) + 1; return m; }, {}),
    rows,
  }, null, 2));
  process.exit(problems.length ? 1 : 0);
}

const mark = (v) => (v ? '✅' : '—');
console.log(`\n采集器能力总表 · ${rows.length} 个适配器\n`);
console.log('适配器'.padEnd(16) + 'tier'.padEnd(10) + FIELDS.map((f) => f.padEnd(18)).join(''));
console.log('─'.repeat(16 + 10 + FIELDS.length * 18));
for (const r of rows) {
  console.log(
    r.name.padEnd(16) + r.tier.padEnd(10) + FIELDS.map((f) => mark(r.sources[f]).padEnd(18)).join('')
  );
}

const counts = rows.reduce((m, r) => { m[r.tier] = (m[r.tier] || 0) + 1; return m; }, {});
console.log('\n按档位：' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' · '));

const srcCounts = FIELDS.map((f) => `${f}=${rows.filter((r) => r.sources[f]).length}/${rows.length}`);
console.log('可读源：' + srcCounts.join(' · '));

if (problems.length) {
  console.log(`\n🔴 声明与实现不一致 ${problems.length} 处：`);
  for (const p of problems) console.log(`   ${p.name} — ${p.msg}`);
  process.exit(CHECK ? 1 : 0);
}
console.log('\n✅ 声明与实现一致（有实现的都声明了，声明的都真有实现）');
