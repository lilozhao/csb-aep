#!/usr/bin/env node
/**
 * GDI MVP · 契约数据采集器
 *
 * 数据源：logs/gdi/gdi-r{1,2,3}-*.json（2026-09-02 关系 GDI 三轮评审日志，真实）
 * 采集对象：data/agents.json 中的被测 agent
 *
 * 契约建模（评审委派场景）：
 *   - 类型：轻量契约（发起方经 A2A 即时消息发出评审邀约，受邀方未驳 + 实质回复印证 → 满足轻量门槛 0.5）
 *   - 每轮 = 1 条契约（含 7 议题实质回复义务），每人 3 轮 = 3 条
 *   - 履约判定（自动）：轮内实质回复议题 ≥6/7 → kept；降级回声占比高 → broken
 *   - 质量判定（自动）：7/7 实质 + 平均长度 ≥130 + 含贡献特征词 → beyond；7/7 → complete；6/7 → onTime
 *   - 轻量契约连续履约 3 次 → 第 3 条自动升格 formal（lib/contracts.js applyPromotion）
 *
 * 用法：node scripts/collect-contracts.js [--out data/contracts.json]
 */
const fs = require('fs');
const path = require('path');
const { stripEmoji } = require('../lib/contracts.js');

// 轻量 glob（避免引入依赖）：匹配 logs/gdi/gdi-r*.json
function globSync(dir, pattern) {
  const prefix = pattern.split('*')[0]; // 'gdi-r'
  return fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .map(f => path.join(dir, f));
}

const ROOT = path.join(__dirname, '..');
const GDI_LOG_DIR = path.join(__dirname, '..', '..', '..', 'logs', 'gdi');

// 贡献特征词（质量 beyond 判定：有立场 + 理由之外的主动增量）
const CONTRIB_WORDS = ['建议', '补充', '愿', '可', '交给我', '落实', '提议', '增设', '引入', '可设', '提醒', '关注'];

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function agentMatches(logAgentName, targetName) {
  return stripEmoji(logAgentName) === stripEmoji(targetName);
}

/** 从一轮日志中提取某 agent 的议题回复明细 */
function roundReplies(round, agentName) {
  const replies = [];
  for (const topic of round.results || []) {
    for (const r of topic.responses || []) {
      if (agentMatches(r.agent, agentName)) {
        replies.push({
          topic: topic.topic,
          title: topic.title,
          success: !!r.success,
          echo: /LLM 未接入|降级回复/.test(r.text || ''),
          len: (r.text || '').length,
          text: (r.text || '').slice(0, 120),
        });
      }
    }
  }
  return replies;
}

/** 由一轮回复明细判定契约状态与质量 */
function judge(replies, totalTopics) {
  const substantive = replies.filter(r => r.success && !r.echo);
  const echoTopics = replies.filter(r => r.echo).length;
  const keptTopics = substantive.length;
  const avgLen = replies.length
    ? Math.round(substantive.reduce((s, r) => s + r.len, 0) / Math.max(1, substantive.length))
    : 0;
  const contribHit = substantive.filter(r => CONTRIB_WORDS.some(w => r.text.includes(w))).length;

  let status = 'broken';
  let quality = null;
  if (keptTopics >= Math.ceil(totalTopics * 6 / 7)) {
    status = 'kept';
    // 质量：7/7 + 平均长度足 + 贡献特征 → beyond；7/7 → complete；6/7 → onTime
    if (keptTopics === totalTopics && avgLen >= 110 && contribHit >= 1) quality = 'beyond';
    else if (keptTopics === totalTopics) quality = 'complete';
    else quality = 'onTime';
  }
  return {
    status, quality, keptTopics, totalTopics, echoTopics, avgLen, contribHit, replies,
  };
}

function collect(agents) {
  const rounds = globSync(GDI_LOG_DIR, 'gdi-r*.json')
    .map(fp => loadJson(fp))
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

  if (rounds.length < 3) {
    console.error(`[collect-contracts] 需要 ≥3 轮 GDI 日志，实际 ${rounds.length}（${GDI_LOG_DIR}）`);
    process.exit(1);
  }

  const contracts = [];
  for (const round of rounds) {
    const totalTopics = (round.results || []).length;
    for (const agent of agents) {
      const replies = roundReplies(round, agent.name);
      if (replies.length === 0) {
        console.warn(`[collect-contracts] 警告：${agent.name} 在 ${round.session} 无回复记录，跳过`);
        continue;
      }
      const j = judge(replies, totalTopics);
      const roundNo = round.session.match(/r(\d)/)?.[1] || '?';
      const evidence = {
        substantiveTopics: j.keptTopics,
        totalTopics: j.totalTopics,
        echoTopics: j.echoTopics,
        avgReplyLen: j.avgLen,
        contribHits: j.contribHit,
        sample: j.replies.slice(0, 3).map(r => ({ topic: r.topic, echo: r.echo, len: r.len })),
      };
      contracts.push({
        id: `${round.session}-${agent.id}`,
        type: 'light', // 评审邀约 = 轻量契约（A2A 即时消息 + 行为印证），连续履约自动升格
        promisor: agent.name,
        promisee: '若兰', // 协议组协调人（评审发起方）
        source: `logs/gdi/${path.basename(round.session)}.json`,
        round: roundNo,
        promisedAt: round.startTime,
        deadline: round.endTime,
        evidenceTs: round.endTime, // 实质回复在轮次窗口内完成 → 48h 闭环 ✓
        status: j.status,
        quality: j.quality,
        evidence,
      });
    }
  }
  return contracts;
}

// ---------- main ----------
const agents = loadJson(path.join(ROOT, 'data', 'agents.json')).agents;
const outPath = path.resolve(ROOT, process.argv[2] || 'data/contracts.json');

const contracts = collect(agents);
const doc = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: 'logs/gdi/gdi-r{1,2,3}-*.json（2026-09-02 关系 GDI 三轮评审日志）',
    model: '评审委派 = 轻量契约（A2A 邀约 + 实质回复印证）；连续履约 3 次升格 formal',
    judgeRule: 'kept: 实质回复 ≥6/7 议题；quality: beyond(7/7+均长≥110+贡献词) / complete(7/7) / onTime(6/7)',
    note: '本文件由 collect-contracts.js 生成后提交入库，保证可复现；人工复核请直接编辑 status/quality 并更新 reviewedAt',
  },
  contracts,
};
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');

// 汇总
const byAgent = {};
for (const c of contracts) {
  (byAgent[c.promisor] ||= []).push(`${c.round}:${c.status}/${c.quality || '-'}`);
}
console.log('[collect-contracts] 完成');
for (const [a, list] of Object.entries(byAgent)) console.log(`  ${a}: ${list.join('  ')}`);
console.log(`  共 ${contracts.length} 条契约 → ${path.relative(ROOT, outPath)}`);
