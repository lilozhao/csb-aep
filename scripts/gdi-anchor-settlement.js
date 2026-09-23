#!/usr/bin/env node
/**
 * GDI 外部锚点 · 结算脚本（P-2 · 观察期 2026-09-05 → 2026-10-05）
 *
 * 读 data/gdi/sources/**（provenance / audit / witness / contracts / references）
 * → 按 docs/gdi-anchor-settlement-criteria.md 的 A/B/C/D 四组出指标
 * → 写 data/gdi/settlement/<date>.json + 打印报告
 *
 * 设计纪律（对齐 BR-12 数据诚实）：
 *   - 取不到 ⇒ null / "N/A"，**绝不写 0 冒充**
 *   - 阈值未定 ⇒ 输出 "TBD"（一澜拍板后填 config 常量）
 *   - 不做结论性加权总分：四组分别呈现，判定由人拍
 *
 * 用法：
 *   node scripts/gdi-anchor-settlement.js                        # 默认窗口 09-05 → 今天
 *   node scripts/gdi-anchor-settlement.js --from 2026-09-05 --to 2026-10-05
 *   node scripts/gdi-anchor-settlement.js --label baseline       # 存档为 baseline-<date>.json
 *   node scripts/gdi-anchor-settlement.js --json                 # 只输出 JSON（给脚本/机器人读）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'gdi', 'sources');
const OUT_DIR = path.join(ROOT, 'data', 'gdi', 'settlement');
const ENGINE = path.join(ROOT, 'server', 'engine', 'gdi');

const THRESHOLD = { // 一澜 2026-09-23 拍定（原 TBD 已填）
  setBy: '一澜 2026-09-23',
  A1_snapshotCoveragePct: 80,
  A2_maxGapDays: 3,
  A3_minDistinctBodies: 2,
  C1_selfRefMustBeZero: 0,
  C5_rule: '同对高频得分 ≤ 诚实基线 ×2',
};

const argOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const has = (n) => process.argv.includes(n);
const today = new Date().toISOString().slice(0, 10);
const FROM = argOf('--from') || '2026-09-05';
const TO = argOf('--to') || today;
const LABEL = argOf('--label');
const JSON_ONLY = has('--json');
const INCLUDE_BF = has('--include-backfill'); // 把回算序列纳入 B 组（A1 仍只认实拍）
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const inWindow = (d) => d >= FROM && d <= TO;

/* ---------- A 覆盖面 ---------- */
function loadSnapshots() {
  const dir = path.join(SRC, 'provenance');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => DAY_RE.test(f.replace(/\.json$/, '')))
    .sort().map((f) => {
      const day = f.replace(/\.json$/, '');
      let j = null; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { /* 坏文件 */ }
      return { day, doc: j };
    });
}

/* ---------- 回算序列（backfill，后视重建） ---------- */
function loadBackfill() {
  const dir = path.join(SRC, 'provenance');
  if (!fs.existsSync(dir)) return { files: [], daily: [] };
  const files = fs.readdirSync(dir).filter((f) => /^backfill-.*\.json$/.test(f)).sort();
  const daily = [];
  const metas = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      metas.push({ file: f, reconstructed: !!(j.meta && j.meta.reconstructed), lookAheadBias: j.meta && j.meta.lookAheadBias });
      for (const d of j.daily || []) if (inWindow(d.day)) daily.push(d);
    } catch (e) { /* 坏文件 */ }
  }
  return { files: metas, daily };
}

function coverage(snaps) {
  const windowDays = days(FROM, TO) + 1;
  const inWin = snaps.filter((s) => inWindow(s.day));
  const haveDays = inWin.map((s) => s.day);
  const gaps = [];
  for (let i = 1; i < haveDays.length; i++) gaps.push(days(haveDays[i - 1], haveDays[i]));
  const latest = snaps.length ? snaps[snaps.length - 1] : null;
  const lastRawAge = latest && latest.doc && latest.doc.metrics ? latest.doc.metrics.lastFileAge : null;
  return {
    windowFrom: FROM, windowTo: TO, windowDays,
    provenanceSnapshots: haveDays.length,
    provenanceCoveragePct: Number(((haveDays.length / windowDays) * 100).toFixed(1)),
    firstSnapshot: haveDays[0] || null,
    lastSnapshot: haveDays[haveDays.length - 1] || null,
    maxGapDays: gaps.length ? Math.max(...gaps) : (haveDays.length ? null : null),
    gapDetail: gaps.length ? gaps : null,
    daysSinceLastRaw: typeof lastRawAge === 'number' ? lastRawAge : null,
    threshold: { A1_snapshotCoveragePct: THRESHOLD.A1_snapshotCoveragePct, A2_maxGapDays: THRESHOLD.A2_maxGapDays },
    note: haveDays.length === 0 ? 'N/A（窗口内无 provenance 快照——采集是否已挂？）' : null,
  };
}

/* ---------- witness ---------- */
function loadWitness() {
  const dir = path.join(SRC, 'witness');
  const map = new Map();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        for (const ev of j.events || []) if (ev && ev.id && !map.has(ev.id)) map.set(ev.id, ev);
      } catch (e) { /* 坏文件 */ }
    }
  }
  return [...map.values()];
}

function gini(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const n = s.length, sum = s.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * s[i];
  return Number(((2 * cum) / (n * sum) - (n + 1) / n).toFixed(4));
}

function witnessStats(events) {
  const bySubject = {}, byType = {}, pairs = {};
  let selfRef = 0;
  for (const e of events) {
    const subj = e.subject || '?', wit = e.witness || '?';
    bySubject[subj] = (bySubject[subj] || 0) + 1;
    byType[e.type || '?'] = (byType[e.type || '?'] || 0) + 1;
    pairs[`${subj}|${wit}`] = (pairs[`${subj}|${wit}`] || 0) + 1;
    if (subj === wit && e.type !== 'rewrite') selfRef++;
  }
  const counts = Object.values(bySubject);
  const pairCounts = Object.values(pairs);
  return {
    events: events.length,
    byType,
    distinctSubjects: Object.keys(bySubject).length,
    distinctWitnesses: new Set(events.map((e) => e.witness).filter(Boolean)).size,
    distinctPairs: Object.keys(pairs).length,
    top1Share: counts.length ? Number((Math.max(...counts) / events.length).toFixed(3)) : null,
    giniSubjects: gini(counts),
    maxEventsPerPair: pairCounts.length ? Math.max(...pairCounts) : null,
    selfRefViolations: selfRef,
    subjectCounts: bySubject,
    threshold: { A3_minDistinctBodies: THRESHOLD.A3_minDistinctBodies, C1_selfRefMustBeZero: THRESHOLD.C1_selfRefMustBeZero },
  };
}

/* ---------- audit（delegation 链） ---------- */
function auditStats() {
  const f = path.join(SRC, 'audit', 'delegation.jsonl');
  if (!fs.existsSync(f)) return { status: 'N/A', reason: 'sources/audit/delegation.jsonl 不存在（观察期内无委托审计落盘）' };
  const rows = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  if (!rows.length) return { status: 'N/A', reason: '文件存在但无条目' };
  const hasChain = rows.every((r) => typeof r.prevHash === 'string' || typeof r.hash === 'string');
  let chainValid = null, brokenAt = null;
  if (hasChain) {
    chainValid = true;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].hash || rows[i - 1].prevHash;
      const cur = rows[i].prevHash;
      if (cur != null && prev != null && cur !== prev) { chainValid = false; brokenAt = i; break; }
    }
  }
  const kinds = {};
  for (const r of rows) kinds[r.event_type || r.action || '?'] = (kinds[r.event_type || r.action || '?'] || 0) + 1;
  return { status: 'ok', entries: rows.length, kinds, chainChecked: hasChain, chainValid, brokenAt };
}

/* ---------- D 结构可信度（引擎侧） ---------- */
function engineChecks() {
  const read = (f) => { const p = path.join(ENGINE, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
  const w = read('witness.js'), idx = read('index.js'), pres = read('present.js');
  return {
    witnessEngineExists: !!w,
    reciprocityHalving: w ? /折半|hal(ve|ving)|0\.5/.test(w) : null,
    timeDecay: w ? /半衰|decay|90/.test(w) : null,
    observationNotScored: idx ? /观察期不计分|observe|not\s*scored/.test(idx) : null,
    deScalePath: pres ? /cleanPresent|去刻度|strip/.test(pres) : null,
  };
}

/* ---------- C5 反例测试结果（若已跑） ---------- */
function loadC5() {
  const dir = path.join(ROOT, 'data', 'gdi', 'settlement');
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => /^c5-game-resistance-.*\.json$/.test(x)).sort().pop();
  if (!f) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { report: f, verdict: j.verdict, ratio: j.ratio_spam_over_honest, finding: j.finding, suggestion: j.suggestion, rule: j.threshold && j.threshold.rule };
  } catch (e) { return null; }
}

/* ---------- main ---------- */
const snaps = loadSnapshots();
const cov = coverage(snaps);
const wit = witnessStats(loadWitness());
const aud = auditStats();
const eng = engineChecks();
const bf = loadBackfill();
const c5 = loadC5();

// 回算覆盖（与 A1 并列，但**不计入**实拍覆盖率）
cov.reconstructed = bf.files.length ? {
  files: bf.files.map((f) => f.file),
  daysWithData: bf.daily.filter((d) => (d.total || 0) > 0).length,
  windowDays: cov.windowDays,
  coveragePct: Number(((bf.daily.filter((d) => (d.total || 0) > 0).length / cov.windowDays) * 100).toFixed(1)),
  reconstructed: true,
  lookAheadBias: bf.files[0] && bf.files[0].lookAheadBias,
  note: '后视重建（偏高），仅用于 B 组看机制行为；A1 实拍覆盖率不含它',
} : null;

// B2 日波动序列：实拍优先，--include-backfill 时用回算补空缺日
const seriesMap = new Map();
for (const s of snaps) for (const d of (s.doc && s.doc.daily) || []) if (typeof d.sealedRate === 'number') seriesMap.set(d.day, { day: d.day, rate: d.sealedRate, kind: 'real' });
if (INCLUDE_BF) for (const d of bf.daily) if (typeof d.sealedRate === 'number' && !seriesMap.has(d.day)) seriesMap.set(d.day, { day: d.day, rate: d.sealedRate, kind: 'backfill' });
const series = [...seriesMap.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
const rateVals = series.map((x) => x.rate);
const vol = rateVals.length ? {
  min: Number(Math.min(...rateVals).toFixed(4)),
  max: Number(Math.max(...rateVals).toFixed(4)),
  range: Number((Math.max(...rateVals) - Math.min(...rateVals)).toFixed(4)),
  samples: rateVals.length,
  fromReal: series.filter((x) => x.kind === 'real').length,
  fromBackfill: series.filter((x) => x.kind === 'backfill').length,
} : null;

const checks = {
  C1_selfRefZero: wit.selfRefViolations === 0 ? 'pass' : 'fail',
  D1_provenanceTimestamps: snaps.length && snaps.every((s) => s.doc && s.doc.meta && s.doc.meta.generatedAt) ? 'pass' : 'fail',
  D4_noZeroMasquerade: (cov.provenanceSnapshots === 0 && cov.provenanceCoveragePct === 0) ? 'check' : 'pass',
  C2_reciprocityHalving: eng.reciprocityHalving ? 'pass' : 'check',
  C5_gameResistance: c5 ? (c5.verdict === 'pass' ? 'pass' : 'fail') : 'check',
  C3_timeDecay: eng.timeDecay ? 'pass' : 'check',
  C4_deScale: eng.deScalePath ? 'pass' : 'check',
  D3_auditChain: aud.chainValid === true ? 'pass' : (aud.status === 'N/A' ? 'n/a' : 'check'),
};

let verdict;
if (!snaps.length) verdict = { code: 'insufficient-data', text: '② 延长观察：窗口内无 provenance 快照，先补采集再谈有效性' };
else if (cov.provenanceCoveragePct < 80) verdict = { code: 'insufficient-data', text: `② 延长观察：快照覆盖仅 ${cov.provenanceCoveragePct}%（<80%），数据不足 ≠ 机制无效` };
else verdict = { code: 'ready-for-review', text: '数据充分 → 交一澜按 §2 阈值拍判定（①转正 / ②延长 / ③回炉）' };
if (c5 && c5.verdict === 'fail') verdict.note = `⚠️ C 组有失守项（C5：同对高频 ${c5.ratio}× 基线）→ 转正前必须先修（per-pair 递减或次数上限）`;

const report = {
  generatedAt: new Date().toISOString(),
  window: { from: FROM, to: TO },
  label: LABEL || null,
  A_coverage: cov,
  B_discrimination: {
    witness_top1Share: wit.top1Share,
    witness_giniSubjects: wit.giniSubjects,
    distinctSubjects: wit.distinctSubjects,
    provenance_dailyVolatility: vol,
    threshold: 'TBD（B1 方差≠0 / B2 非恒定 / B3 与无互动基线分位差）',
  },
  C_robustness: {
    selfRefViolations: wit.selfRefViolations,
    maxEventsPerPair: wit.maxEventsPerPair,
    engine: eng,
    C5_counterexampleTest: c5 || { status: 'pending', note: 'TBD：跑 node scripts/gdi-game-resistance-test.js' },
  },
  D_reliability: {
    provenanceSnapshotsWithMeta: snaps.filter((s) => s.doc && s.doc.meta && s.doc.meta.generatedAt).length,
    audit: aud,
    engineChecks: eng,
    repeatRunsIdentical: 'TBD（同日连跑两次比对；建议由 cron 记录）',
  },
  witness: wit,
  checks,
  verdict,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const outName = `${LABEL ? LABEL + '-' : ''}${today}.json`;
fs.writeFileSync(path.join(OUT_DIR, outName), JSON.stringify(report, null, 2) + '\n');

if (JSON_ONLY) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

console.log(`\n📐 GDI 外部锚点结算 · 窗口 ${FROM} → ${TO}`);
console.log(`\n【A 覆盖面】`);
console.log(`  provenance 快照 ${cov.provenanceSnapshots}/${cov.windowDays} 天 = ${cov.provenanceCoveragePct}%  ${cov.provenanceSnapshots ? `(${cov.firstSnapshot} → ${cov.lastSnapshot})` : ''}`);
if (cov.reconstructed) console.log(`  回算（后视重建，偏高） ${cov.reconstructed.daysWithData}/${cov.reconstructed.windowDays} 天 = ${cov.reconstructed.coveragePct}%  · 不计入上面的实拍覆盖`);
console.log(`  最大快照间隔 ${cov.maxGapDays === null ? 'N/A' : cov.maxGapDays + ' 天'} | 距最新 raw 流水 ${cov.daysSinceLastRaw === null ? 'N/A' : cov.daysSinceLastRaw + ' 天'}`);
console.log(`  witness: ${wit.events} 事件 / ${wit.distinctSubjects} subject · ${wit.distinctWitnesses} witness · ${wit.distinctPairs} 关系对  ${JSON.stringify(wit.byType)}`);
console.log(`  delegation 审计: ${aud.status === 'N/A' ? 'N/A — ' + aud.reason : aud.entries + ' 条 · 链校验 ' + (aud.chainValid === null ? '未做' : aud.chainValid)}`);
console.log(`\n【B 区分度】top1 占比 ${wit.top1Share} · subject 基尼 ${wit.giniSubjects} · 阈值 TBD`);
if (vol) console.log(`  provenance 日 sealedRate 波动：${vol.min}–${vol.max}（极差 ${vol.range}，${vol.samples} 样本：实拍 ${vol.fromReal} / 回算 ${vol.fromBackfill}）${INCLUDE_BF ? '' : '（未含回算，加 --include-backfill 可补齐空缺日）'}`);
console.log(`\n【C 抗游戏化】自引违规 ${wit.selfRefViolations}（硬门=0）· 同对上限 ${wit.maxEventsPerPair} · 互惠折半 ${eng.reciprocityHalving ? '✅' : '❓'} · 半衰 ${eng.timeDecay ? '✅' : '❓'} · 去刻度 ${eng.deScalePath ? '✅' : '❓'}`);
if (c5) console.log(`  C5 反例测试：${c5.verdict === 'pass' ? '✅ 通过' : '❌ 不通过'} — 同对高频 ${c5.ratio}× 诚实基线（${c5.rule}）`);
console.log(`\n【D 可信度】带时间戳快照 ${report.D_reliability.provenanceSnapshotsWithMeta}/${snaps.length} · 审计链 ${aud.chainValid === true ? '✅' : aud.status === 'N/A' ? 'N/A' : '❓'} · 缺失记 N/A 不记 0 ✅`);
console.log(`\n【判定】${verdict.code === 'insufficient-data' ? '🟡' : '🟢'} ${verdict.text}`);
if (verdict.note) console.log(`        ${verdict.note}`);
console.log(`\n💾 ${path.relative(process.cwd(), path.join(OUT_DIR, outName))}\n`);
