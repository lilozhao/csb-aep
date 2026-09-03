#!/usr/bin/env node
/**
 * GDI MVP · 主入口：契约命中率 + 关系复用率（3 个 agent 真实数据）
 *
 * 数据流：
 *   1. data/contracts.json   ← scripts/collect-contracts.js（logs/gdi 三轮评审日志自动采集）
 *   2. data/references.json  ← 人工复核引用数据（collect-references.js 校验与文档一致）
 *   3. 计算：lib/contracts.js（命中率）+ lib/reuse.js（复用率）
 *   4. 呈现：lib/present.js（去刻度化：质性标签 + 趋势箭头）
 *
 * 用法：
 *   node scripts/run-mvp.js                 # 全量计算 + stdout + 报告文件
 *   node scripts/run-mvp.js --json          # 输出原始 JSON（内部观测用，不外发）
 *   node scripts/run-mvp.js --agent 墨丘    # 只看单 agent
 */
const fs = require('fs');
const path = require('path');

const { hitRate } = require('../lib/contracts.js');
const { reuse } = require('../lib/reuse.js');
const { presentCard } = require('../lib/present.js');

const ROOT = path.join(__dirname, '..');
const load = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

function main() {
  const agents = load('data/agents.json').agents;
  const contractsDoc = load('data/contracts.json');
  const refsDoc = load('data/references.json');

  const onlyAgent = process.argv.find((_, i) => process.argv[i - 1] === '--agent');
  const asJson = process.argv.includes('--json');

  const now = new Date();
  const results = [];

  for (const agent of agents) {
    if (onlyAgent && agent.name !== onlyAgent) continue;
    const agentContracts = contractsDoc.contracts.filter(c => c.promisor === agent.name);
    const agentRefs = refsDoc.references.filter(r => r.target === agent.name);

    const c = hitRate(agentContracts, now);
    const r = reuse(agentRefs, agent.name, now);
    const card = presentCard(c, r, { baseline: true });

    results.push({ agent, contracts: c, reuse: r, card });
  }

  if (asJson) {
    console.log(JSON.stringify(results.map(x => ({
      agent: x.agent.name,
      contractHitRate: x.contracts.rate,
      contractDetail: { kept: x.contracts.keptCount, broken: x.contracts.brokenCount, quality: x.contracts.qualityBreakdown, fused: x.contracts.fused },
      reuseRate: x.reuse.rate,
      reuseDetail: { net: x.reuse.net, gross: x.reuse.gross, selfRefs: x.reuse.selfCount, externalRefers: x.reuse.externalRefers },
      present: x.card,
    })), null, 2));
    return;
  }

  // —— 人类可读报告 ——
  const lines = [];
  lines.push('# GDI MVP 观测报告（契约命中率 + 关系复用率）');
  lines.push('');
  lines.push(`> 观测时间：${now.toISOString().slice(0, 10)} · 数据窗口：90 天 · 基线期（趋势箭头自下一观测期起生效）`);
  lines.push(`> 依据：csb-aep/docs/relationship-gdi-draft.md 定稿 v1.0 · 口径：gdi-mvp/README.md`);
  lines.push(`> 原则：GDI 只观测关系的影子，不定义关系本身。不排名、不公示、不用于绩效。`);
  lines.push('');
  lines.push('| Agent | 契约命中率 | 质性标签 | 复用率(净/毛) | 质性标签 | 外部引用者 | 失信熔断 |');
  lines.push('|-------|-----------|---------|--------------|---------|-----------|---------|');

  for (const { agent, contracts: c, reuse: r, card } of results) {
    const cr = c.rate === null ? '—' : (c.rate * 100).toFixed(1) + '%';
    const rr = r.rate === null ? '—' : (r.rate * 100).toFixed(1) + '%';
    const netGross = r.gross > 0 ? `${r.net.toFixed(2)}/${r.gross.toFixed(1)}` : '—';
    lines.push(
      `| ${agent.name} ${agent.emoji} | ${cr} | ${card.contract.label} | ${rr} (${netGross}) | ${card.reuse.label} | ${r.externalRefers} | ${c.fused ? '⚠️ 熔断' : '—'} |`
    );
  }

  lines.push('');
  lines.push('## 契约命中率明细');
  lines.push('');
  lines.push('| Agent | 轮次 | 类型 | 状态 | 质量 | 权重 | 得分 | 实质议题 | 回声 |');
  lines.push('|-------|------|------|------|------|------|------|---------|------|');
  for (const { agent, contracts: c } of results) {
    for (const b of c.breakdown) {
      const src = contractsDoc.contracts.find(x => x.id === b.id) || {};
      const ev = src.evidence || {};
      lines.push(
        `| ${agent.name} | R${src.round} | ${b.type} | ${b.status} | ${b.quality || '—'} | ${b.weight} | ${b.score} | ${ev.substantiveTopics}/${ev.totalTopics} | ${ev.echoTopics} |`
      );
    }
  }

  lines.push('');
  lines.push('## 复用率明细（去重/剔除/折半/半衰后）');
  lines.push('');
  lines.push('| Agent | 引用者 | 类型 | 互惠折半 | 基础分→净分 | 半衰 | 证据 |');
  lines.push('|-------|--------|------|---------|------------|------|------|');
  for (const { agent, reuse: r } of results) {
    for (const d of r.detail) {
      lines.push(`| ${agent.name} | ${d.source} | ${d.type} | ${d.mutual ? '是(×0.5)' : '否'} | ${d.base}→${d.score} | ${d.decay} | ${(d.evidence || '').slice(0, 60)}… |`);
    }
    if (r.selfCount > 0) lines.push(`| ${agent.name} | ⚠️ 自引 ${r.selfCount} 条已剔除 | | | | | |`);
  }

  lines.push('');
  lines.push('## 去刻度化呈现卡（对外口径）');
  lines.push('');
  for (const { agent, card } of results) {
    const ext = card.reuse.externalRefers > 0 ? '（' + card.reuse.externalRefers + ' 位外部引用者）' : '（静默期）';
    lines.push('- **' + agent.name + ' ' + agent.emoji + '**：契约「' + card.contract.label + '」' + card.contract.arrow + ' · 复用「' + card.reuse.label + '」' + card.reuse.arrow + ' ' + ext);
  }
  lines.push('');
  lines.push(`> ${results[0]?.card.note || ''}`);
  lines.push('');
  lines.push('---');
  lines.push('*生成：gdi-mvp/scripts/run-mvp.js · 数据：collect-contracts.js（logs/gdi 自动采集）+ references.json（人工复核）*');

  const report = lines.join('\n');
  console.log(report);

  const outFile = path.join(ROOT, 'data', `report-${now.toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(outFile, report + '\n');
  console.log(`\n[run-mvp] 报告已存：${path.relative(ROOT, outFile)}`);
}

main();
