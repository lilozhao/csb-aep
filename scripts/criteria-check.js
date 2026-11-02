/**
 * 判据指纹自检（P1-4）
 *
 * 为什么需要这个脚本：config.json 里的 config_hash 是**手写进去的**，
 * 一旦有人改了 weights 却忘了更新 config_hash，两件事会同时发生：
 *   ① 指纹失准 → 旧报告看起来"判据一致"，实际已经变了（假绿）
 *   ② 没人发现，直到某天有人拿两份分数做对比
 *
 * 所以需要一个能随时跑的核对点，并接进 CI/守门。
 *
 * 用法：
 *   node scripts/criteria-check.js           # 人类可读
 *   node scripts/criteria-check.js --json
 *   node scripts/criteria-check.js --fix     # 重算并写回 config_hash（改判据后手动跑）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COMPLIANCE_CFG = path.join(ROOT, '..', 'csb-compliance-degree', 'config.json');
const criteria = require(path.join(ROOT, 'server', 'engine', 'criteria.js'));

const AS_JSON = process.argv.includes('--json');
const FIX = process.argv.includes('--fix');

function checkCompliance() {
  if (!fs.existsSync(COMPLIANCE_CFG)) {
    return { file: 'csb-compliance-degree/config.json', status: 'missing', ok: false, msg: '配置文件不存在' };
  }
  const cfg = JSON.parse(fs.readFileSync(COMPLIANCE_CFG, 'utf8'));
  const fp = criteria.fingerprint(cfg);
  const stored = cfg.config_hash || null;
  const ok = stored === fp.hash;
  return {
    file: 'csb-compliance-degree/config.json',
    status: ok ? 'consistent' : (stored ? 'drifted' : 'unfingerprinted'),
    ok,
    stored,
    computed: fp.hash,
    version: fp.version,
    fields: fp.fields,
    counts: fp.counts,
    // 明确列出被排除的状态字段：让读者知道我们确实想过这件事
    excluded: criteria.STATE_FIELDS.filter((k) => k in cfg),
  };
}

const results = [checkCompliance()];
const bad = results.filter((r) => !r.ok);

if (FIX && bad.length) {
  const cfg = JSON.parse(fs.readFileSync(COMPLIANCE_CFG, 'utf8'));
  const fp = criteria.fingerprint(cfg);
  cfg.config_hash = fp.hash;
  fs.writeFileSync(COMPLIANCE_CFG, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`🔧 已重算并写回 config_hash → ${fp.hash}`);
  process.exit(0);
}

if (AS_JSON) {
  console.log(JSON.stringify({ ok: bad.length === 0, results }, null, 2));
  process.exit(bad.length ? 1 : 0);
}

for (const r of results) {
  if (r.status === 'missing') { console.log(`🔴 ${r.file} — ${r.msg}`); continue; }
  const icon = r.ok ? '✅' : '🔴';
  console.log(`${icon} ${r.file}`);
  console.log(`   config_version ${r.version} · 覆盖 ${r.fields.length} 类判据（${r.counts} 个叶子值）`);
  console.log(`   存储 ${r.stored || '(无)'} · 实算 ${r.computed}`);
  if (r.excluded.length) console.log(`   已排除运行时状态：${r.excluded.join('、')}（不算判据，否则每天全量作废）`);
  if (!r.ok) {
    console.log('   ⚠️  判据指纹不一致：改了 config 却忘了更新 config_hash，或用旧 hash');
    console.log('      改判据后请跑：node scripts/criteria-check.js --fix');
    console.log('      并把 config_version +1（判据版本独立于代码版本）');
  }
}

process.exit(bad.length ? 1 : 0);
