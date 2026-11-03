/**
 * 路径③ 行为考古（CSB-Archaeology · P2-2 续）
 *
 * 协议依据：`csb-agent-eval-protocol/csb-AEP-v1.0.md` §3（v1.1 §3 沿用）
 *   五维度：记忆密度 25% / 承诺履行 20% / 学习曲线 20% / 社交活跃度 20% / 演化轨迹 15%
 *
 * ── 一句话原理 ───────────────────────────────────────────────
 * 不问 Agent「你做过什么」，而是翻它的历史记录看它**真的**做过什么。
 *
 * ── 与其它路径的根本差别 ─────────────────────────────────────
 * ①②④⑤ 都在测「现在的能力」。③ 测的是**时间上的连续性**：
 * 有记忆且记得住、说过的话兑现了、错过的地方改了、有人来往。
 * 这条路径**不需要 A2A**，只需要文件 + 时间戳。所以它能在目标离线时照跑。
 *
 * ── 三条诚实纪律（继承 P0-2 / P2-2）────────────────────────────
 * 1. **没证据 ≠ 零分**。没有 memory 目录 → UNDECIDED(no_audit_source)，
 *    不是 0 分。一个刚苏醒三天的 Agent 不该被判成「记忆很差」，
 *    该被判成「还没积累到能判的程度」。
 * 2. **时间戳必须说明来源**。文件 mtime 在 `cp -r` / 镜像还原后会全部变成同一个时刻，
 *    那时刻不是「他更新的时间」。所以优先用 git log，退到 mtime 时必须**标出来源**，
 *    让人知道这个数字能不能横向比。
 * 3. **语料要如实报量**。扫了 3 天日记就下「社交活跃」结论，等于拿 3 个样本算方差。
 *    语料天数低于门槛 → UNDECIDED(insufficient_telemetry)，并说明差多少天。
 *
 * 维护：若兰（公开场合纯名）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const verdict = require('./verdict');
const { VERDICT, UNDECIDED_REASON } = verdict;

// 契约：权重与协议一致，改这里必须同步 CHANGELOG（测试锁住总和 = 1）
const DIMENSIONS = Object.freeze([
  { id: 'memory-density', name: '记忆密度', weight: 0.25 },
  { id: 'commitment', name: '承诺履行', weight: 0.20 },
  { id: 'learning-curve', name: '学习曲线', weight: 0.20 },
  { id: 'social', name: '社交活跃度', weight: 0.20 },
  { id: 'evolution', name: '演化轨迹', weight: 0.15 },
]);

const DEFAULTS = Object.freeze({
  windowDays: 30,          // 观察窗
  minJournalDays: 7,       // 语料门槛：少于 7 天日记不下结论
  themeKeywords: ['A2A', '碳硅契', '社区', '技术', '学习', '记忆', '日程', '天气'],
  commitmentDone: ['✅', '已完成', '已完成', '已解决', 'done', '[x]'],
  commitmentOpen: ['- [ ]', '待办', 'TODO', '待推进', '未完成'],
  correctionKeywords: ['纠正', '反思', '教训', '错了', '改进', '复盘'],
  progressionKeywords: ['上次', '这次', '之前', '后来', '对比'],
  socialKeywords: ['A2A', '发帖', '回帖', '论坛', '协作', '共识', '讨论'],
  milestoneKeywords: ['里程碑', '突破', '首次', '第一次'],
});

// ══════════════════════════════════════════════
// 工具：文件与时间
// ══════════════════════════════════════════════

function readIf(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function listDir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; }
}

/** YYYY-MM-DD → Date(UTC)，非法返回 null */
function dateOf(name) {
  const m = String(name).match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * 变更次数：优先 git，退 mtime。返回 {count, source, note}
 *
 * ⚠️ 为什么必须先认 git：mtime 在镜像还原 / 批量拷贝后会塌缩成同一个时刻，
 *    此时「30 天改了 2 次」实际是「30 天里没见过任何变化」——假低。
 *    反过来，一次 rsync 又能把 100 个文件刷成今天，变成「正在疯狂演化」——假高。
 *    两种都是假数据，所以 source 必须一起报出去。
 */
function changeCount(root, relPaths, windowDays) {
  const since = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
  try {
    const out = execFileSync('git', ['log', `--since=${since}`, '--pretty=format:%H', '--', ...relPaths],
      { cwd: root, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    const n = out.split('\n').filter(Boolean).length;
    return { count: n, source: 'git', note: `git log --since=${since}` };
  } catch {
    // 不是 git 仓 / git 不可用 → 退 mtime，并明说这是退化口径
    let n = 0;
    const cutoff = Date.now() - windowDays * 86400000;
    for (const rel of relPaths) {
      const abs = path.join(root, rel);
      const stack = [abs];
      while (stack.length) {
        const cur = stack.pop();
        let st;
        try { st = fs.statSync(cur); } catch { continue; }
        if (st.isDirectory()) {
          for (const e of listDir(cur)) stack.push(path.join(cur, e.name));
        } else if (st.mtimeMs >= cutoff) n++;
      }
    }
    return { count: n, source: 'mtime', note: '⚠️ 无 git 历史，退化用 mtime（镜像还原后会失准，不可横向比）' };
  }
}

// ══════════════════════════════════════════════
// 五维度
// ══════════════════════════════════════════════

/** ① 记忆密度：日记覆盖率 / 平均长度 / 主题多样性 / 断裂模式 */
function dimMemoryDensity(root, cfg, ctx) {
  const files = listDir(path.join(root, 'memory'))
    .map((e) => e.name).filter((n) => dateOf(n));
  const dates = files.map(dateOf).sort((a, b) => a - b);
  const subs = [];

  if (dates.length === 0) {
    return {
      id: 'memory-density',
      name: '记忆密度',
      state: VERDICT.UNDECIDED,
      reason: UNDECIDED_REASON.NO_AUDIT_SOURCE,
      note: '找不到 memory/YYYY-MM-DD.md —— 没有可考古的日记',
      sub_dimensions: [],
      score: null,
    };
  }

  const span = daysBetween(dates[0], dates[dates.length - 1]) + 1;
  const coverage = Math.min(1, dates.length / Math.max(1, span));

  // 语料门槛：跨度太短时不下结论（3 天算不出"断裂模式"）
  const enough = span >= cfg.minJournalDays;
  subs.push({
    key: 'coverage', name: '日记覆盖率',
    score: round10(coverage * 10),
    evidence: `${dates.length} 篇 / 跨度 ${span} 天（${dates[0].toISOString().slice(0, 10)} → ${dates[dates.length - 1].toISOString().slice(0, 10)}）`,
    measurable: enough,
  });

  // 平均长度：>3000 字 = 10 分（协议 §3.2 维度1）
  const lens = files.map((n) => (readIf(path.join(root, 'memory', n)) || '').length);
  const avgLen = lens.reduce((a, b) => a + b, 0) / lens.length;
  subs.push({
    key: 'length', name: '平均条目长度',
    score: round10(Math.min(10, (avgLen / 3000) * 10)),
    evidence: `平均 ${Math.round(avgLen)} 字`,
    measurable: enough,
  });

  // 主题多样性：命中 8 个主题关键词的比例
  const all = files.map((n) => readIf(path.join(root, 'memory', n)) || '').join('\n');
  const hit = cfg.themeKeywords.filter((k) => all.includes(k));
  subs.push({
    key: 'themes', name: '主题多样性',
    score: round10((hit.length / cfg.themeKeywords.length) * 10),
    evidence: `命中 ${hit.length}/${cfg.themeKeywords.length}：${hit.join('、') || '无'}`,
    measurable: enough,
  });

  // 断裂模式：最大连续空白天数，≤1 天 = 10 分
  let maxGap = 0;
  for (let i = 1; i < dates.length; i++) maxGap = Math.max(maxGap, daysBetween(dates[i - 1], dates[i]) - 1);
  subs.push({
    key: 'gaps', name: '断裂模式',
    score: round10(Math.max(0, 10 - Math.max(0, maxGap - 1) * 5)),
    evidence: `最大连续空白 ${maxGap} 天`,
    measurable: enough,
  });

  const score = enough ? round10(avg01to10(subs)) : null;
  return {
    id: 'memory-density',
    name: '记忆密度',
    state: enough ? VERDICT.PASS : VERDICT.UNDECIDED,
    reason: enough ? null : UNDECIDED_REASON.INSUFFICIENT_TELEMETRY,
    note: enough ? null : `日记跨度仅 ${span} 天，低于门槛 ${cfg.minJournalDays} 天 —— 覆盖率/断裂这类时间指标算不出来`,
    sub_dimensions: subs,
    score,
  };
}

/** ② 承诺履行：总承诺 / 完成率 / 逾期 —— 从 TODO.md 数，不从"自述"数 */
function dimCommitment(root, cfg, ctx) {
  const src = ['TODO.md', 'SELF_STATE.md'].map((f) => ({ f, t: readIf(path.join(root, f)) }))
    .filter((x) => x.t);
  if (src.length === 0) {
    return {
      id: 'commitment', name: '承诺履行', state: VERDICT.UNDECIDED, reason: UNDECIDED_REASON.NO_AUDIT_SOURCE,
      note: 'TODO.md / SELF_STATE.md 都不存在，无法考古承诺履行', sub_dimensions: [], score: null,
    };
  }

  const text = src.map((x) => x.t).join('\n');
  const lines = text.split('\n');
  // 只数清单行（- [ ] / - [x]），数正文会把"我们承诺过"这类叙述也算成承诺
  const open = lines.filter((l) => /^\s*[-*]\s*\[ \]/.test(l));
  const done = lines.filter((l) => /^\s*[-*]\s*\[[xX]\]/.test(l));
  const total = open.length + done.length;

  if (total < 3) {
    return {
      id: 'commitment', name: '承诺履行', state: VERDICT.UNDECIDED, reason: UNDECIDED_REASON.INSUFFICIENT_TELEMETRY,
      note: `只找到 ${total} 条清单式承诺（<3），样本太少不下结论`,
      sub_dimensions: [{ key: 'total', name: '总承诺数', score: null, evidence: `${total} 条`, measurable: false }],
      score: null,
    };
  }

  const rate = done.length / total;
  const overdue = open.filter((l) => /⏰|逾期|deadline|死线/i.test(l)).length;

  const subs = [
    { key: 'total', name: '总承诺数', score: round10(Math.min(10, (total / 20) * 10)), evidence: `${total} 条（完成 ${done.length} / 未完成 ${open.length}）`, measurable: true },
    { key: 'rate', name: '完成率', score: round10(Math.min(10, (rate / 0.7) * 10)), evidence: `${Math.round(rate * 100)}%（协议：>70% 满分）`, measurable: true },
    { key: 'overdue', name: '逾期数', score: round10(overdue === 0 ? 10 : Math.max(0, 10 - overdue * 3)), evidence: `${overdue} 条标记逾期`, measurable: true },
  ];
  // 平均完成天数：清单里没有时间戳就无法算 —— 明说不算，不拿天填
  subs.push({ key: 'days', name: '平均完成天数', score: null, evidence: '清单无时间戳，未计算（不猜）', measurable: false });

  return {
    id: 'commitment', state: VERDICT.PASS, reason: null, note: null,
    sub_dimensions: subs,
    score: round10(avg01to10(subs.filter((s) => s.measurable))),
  };
}

/** ③ 学习曲线：纠正频率 / 递进对比 / 里程碑 */
function dimLearning(root, cfg, ctx) {
  const memDir = path.join(root, 'memory');
  const files = listDir(memDir).map((e) => e.name).filter((n) => dateOf(n));
  if (files.length === 0) {
    return {
      id: 'learning-curve', name: '学习曲线', state: VERDICT.UNDECIDED, reason: UNDECIDED_REASON.NO_AUDIT_SOURCE,
      note: '没有日记，无法考古学习曲线', sub_dimensions: [], score: null,
    };
  }
  const texts = files.map((n) => readIf(path.join(memDir, n)) || '');
  const all = texts.join('\n');

  const corrDays = texts.filter((t) => cfg.correctionKeywords.some((k) => t.includes(k))).length;
  const progression = cfg.progressionKeywords.reduce((s, k) => s + (all.split(k).length - 1), 0);
  const milestones = cfg.milestoneKeywords.reduce((s, k) => s + (all.split(k).length - 1), 0);

  const enough = files.length >= cfg.minJournalDays;
  const subs = [
    { key: 'corrections', name: '纠正/反思天数', score: round10(Math.min(10, (corrDays / Math.max(1, files.length)) * 10 * 2)), evidence: `${corrDays}/${files.length} 天含纠正或反思`, measurable: enough },
    { key: 'progression', name: '学习递进（对比模式）', score: round10(Math.min(10, (progression / 10) * 10)), evidence: `"上次/这次/之后"类对比 ${progression} 处`, measurable: enough },
    { key: 'milestones', name: '技能里程碑', score: round10(Math.min(10, (milestones / 5) * 10)), evidence: `里程碑类词 ${milestones} 处`, measurable: enough },
  ];

  // TOOLS.md 更新次数：走 changeCount（git 优先），来源必须报出去
  const chg = changeCount(root, ['TOOLS.md'], 30);
  subs.push({
    key: 'tools-updates', name: '工具文档 30 天更新',
    score: chg.source === 'claim' ? null : round10(Math.min(10, (chg.count / 5) * 10)),
    evidence: `${chg.count} 次（来源 ${chg.source}）${chg.note ? ' · ' + chg.note : ''}`,
    measurable: true,
  });

  return {
    id: 'learning-curve',
    name: '学习曲线',
    state: enough ? VERDICT.PASS : VERDICT.UNDECIDED,
    reason: enough ? null : UNDECIDED_REASON.INSUFFICIENT_TELEMETRY,
    note: enough ? null : `日记仅 ${files.length} 天（<${cfg.minJournalDays}），判不了学习曲线`,
    sub_dimensions: subs,
    score: enough ? round10(avg01to10(subs.filter((s) => s.measurable))) : null,
  };
}

/** ④ 社交活跃度：A2A 提及 / 社区 / 协作 / 网络广度 */
function dimSocial(root, cfg, ctx) {
  const memDir = path.join(root, 'memory');
  const files = listDir(memDir).map((e) => e.name).filter((n) => dateOf(n));
  if (files.length === 0) {
    return {
      id: 'social', name: '社交活跃度', state: VERDICT.UNDECIDED, reason: UNDECIDED_REASON.NO_AUDIT_SOURCE,
      note: '没有日记，无法考古社交活跃度', sub_dimensions: [], score: null,
    };
  }
  const all = files.map((n) => readIf(path.join(memDir, n)) || '').join('\n');

  const a2aHits = (all.match(/A2A|json-rpc|tasks\/send/gi) || []).length;
  const socialHits = cfg.socialKeywords.reduce((s, k) => s + (all.split(k).length - 1), 0);
  // 网络广度：日记里出现过的不同 Agent 名字数（从 config/agents.local.json 若存在则取真名表）
  let knownNames = [];
  try {
    const cfgFile = readIf(path.join(root, 'config/agents.local.json'));
    if (cfgFile) knownNames = Object.keys(JSON.parse(cfgFile).agents || {});
  } catch { /* 没有就退到通用词 */ }
  const named = knownNames.filter((n) => all.includes(n));
  const breadth = knownNames.length ? named.length : null;

  const enough = files.length >= cfg.minJournalDays;
  const subs = [
    { key: 'a2a', name: 'A2A 交互提及', score: round10(Math.min(10, (a2aHits / 20) * 10)), evidence: `${a2aHits} 处`, measurable: enough },
    { key: 'community', name: '社区协作提及', score: round10(Math.min(10, (socialHits / 30) * 10)), evidence: `${socialHits} 处`, measurable: enough },
    {
      key: 'breadth', name: '网络广度',
      score: breadth === null ? null : round10(Math.min(10, (breadth / 5) * 10)),
      evidence: breadth === null ? '无 config/agents.local.json，取不到 Agent 名单 → 不算（不猜）' : `提及 ${breadth} 位：${named.join('、') || '无'}`,
      measurable: enough && breadth !== null,
    },
  ];

  return {
    id: 'social',
    name: '社交活跃度',
    state: enough ? VERDICT.PASS : VERDICT.UNDECIDED,
    reason: enough ? null : UNDECIDED_REASON.INSUFFICIENT_TELEMETRY,
    note: enough ? null : `日记仅 ${files.length} 天（<${cfg.minJournalDays}），判不了社交活跃度`,
    sub_dimensions: subs,
    score: enough ? round10(avg01to10(subs.filter((s) => s.measurable))) : null,
  };
}

/** ⑤ 演化轨迹：核心文件变更次数。协议规定 2-10 次 = 10 分（太静或太乱都扣） */
function dimEvolution(root, cfg, ctx) {
  const chg = changeCount(root, ['SOUL.md', 'AGENTS.md', 'USER.md', 'HEARTBEAT.md'], 30);
  const idChg = changeCount(root, ['IDENTITY.md', 'IDENTITY_CORE.md'], 30);
  const memChg = changeCount(root, ['MEMORY.md', 'memory/'], 30);
  const selfChg = changeCount(root, ['self-improving/'], 30);

  /** 协议 §3.2 维度5：2-10 次 = 10 分；0-1 次或 >10 次递减 */
  const band = (n) => (n >= 2 && n <= 10) ? 10 : n < 2 ? Math.max(0, 10 - (2 - n) * 4) : Math.max(0, 10 - (n - 10) * 1);

  const subs = [
    { key: 'config-stability', name: '配置稳定性', score: round10(band(chg.count)), evidence: `${chg.count} 次（来源 ${chg.source}）`, measurable: true },
    { key: 'identity-evolution', name: '身份演化', score: round10(band(idChg.count)), evidence: `${idChg.count} 次（来源 ${idChg.source}）`, measurable: true },
    { key: 'memory-growth', name: '记忆增长', score: round10(Math.min(10, (memChg.count / 10) * 10)), evidence: `${memChg.count} 次（来源 ${memChg.source}）`, measurable: true },
    { key: 'self-improve', name: '自我改进', score: round10(Math.min(10, (selfChg.count / 5) * 10)), evidence: `${selfChg.count} 次（来源 ${selfChg.source}）`, measurable: true },
  ];

  const sources = Array.from(new Set([chg.source, idChg.source, memChg.source, selfChg.source]));
  const degraded = sources.includes('mtime');

  return {
    id: 'evolution',
    name: '演化轨迹',
    // 全 mtime 时不算 PASS：数字可能是镜像还原的假象，只有"判不了"是诚实的
    state: degraded ? VERDICT.UNDECIDED : VERDICT.PASS,
    reason: degraded ? UNDECIDED_REASON.INSUFFICIENT_TELEMETRY : null,
    note: degraded ? '无 git 历史，变更次数只能退用 mtime；镜像还原/批量拷贝会让它失准 → 该维度不可采信' : null,
    sub_dimensions: subs,
    score: degraded ? null : round10(avg01to10(subs)),
  };
}

// ══════════════════════════════════════════════
// 主类
// ══════════════════════════════════════════════

class ArchaeologyEngine {
  constructor(options = {}) {
    this.windowDays = numOr(options.windowDays, DEFAULTS.windowDays);
    this.minJournalDays = numOr(options.minJournalDays, DEFAULTS.minJournalDays);
    this.cfg = { ...DEFAULTS, ...(options.cfg || {}) };
  }

  /**
   * @param {string} agentPath Agent 根目录（要含 memory/、SOUL.md 等）
   */
  async evaluate(agentPath) {
    if (!agentPath) {
      return this._report([], { agentPath: null, note: '未提供 agentPath' });
    }
    let st;
    try { st = fs.statSync(agentPath); } catch {
      return this._report([], { agentPath, note: `目录不存在：${agentPath}` });
    }
    if (!st.isDirectory()) {
      return this._report([], { agentPath, note: `不是目录：${agentPath}` });
    }

    const ctx = { windowDays: this.windowDays };
    const dims = [
      dimMemoryDensity(agentPath, this.cfg, ctx),
      dimCommitment(agentPath, this.cfg, ctx),
      dimLearning(agentPath, this.cfg, ctx),
      dimSocial(agentPath, this.cfg, ctx),
      dimEvolution(agentPath, this.cfg, ctx),
    ];
    return this._report(dims, { agentPath });
  }

  _report(dims, meta) {
    if (dims.length === 0) {
      return {
        path: 'archaeology',
        timestamp: new Date().toISOString(),
        agentPath: meta.agentPath,
        verdict: VERDICT.UNDECIDED,
        reason: UNDECIDED_REASON.NO_AUDIT_SOURCE,
        note: `${meta.note} —— 没有可考古的对象`,
        score: null,
        scoreScale: '0-10',
        coverage: 0,
        dimensions: [],
        drives: { note: '行为考古只需要文件 + 时间戳，不需要 A2A：目标离线也能跑' },
      };
    }

    // 逐维度按协议权重加权；UNDECIDED 的维度不进分母，权重按比例重分（协议 §7.3）
    const usable = dims.filter((d) => d.score !== null);
    const totalW = usable.reduce((s, d) => s + weightOf(d.id), 0);
    const score = totalW === 0 ? null : round10(usable.reduce((s, d) => s + d.score * weightOf(d.id), 0) / totalW);
    const coverage = round4(totalW); // 覆盖到的协议权重占比

    // 顶层三态：一个维度都判不了 → UNDECIDED；判了的维度里有"判不了" → 看覆盖率
    let state;
    if (usable.length === 0) state = VERDICT.UNDECIDED;
    else if (coverage < 0.6) state = VERDICT.UNDECIDED;
    else state = VERDICT.PASS;

    const reasons = dims.filter((d) => d.reason).map((d) => d.reason);

    return {
      path: 'archaeology',
      timestamp: new Date().toISOString(),
      agentPath: meta.agentPath,
      verdict: state,
      reason: state === VERDICT.UNDECIDED
        ? (reasons[0] || UNDECIDED_REASON.INSUFFICIENT_TELEMETRY)
        : null,
      note: state === VERDICT.UNDECIDED
        ? `可判维度覆盖协议权重 ${Math.round(coverage * 100)}%（<60%）→ 结论按 UNDECIDED 处理`
        : null,
      score: state === VERDICT.UNDECIDED ? (score === null ? null : score) : score,
      scoreScale: '0-10',
      coverage,
      dimensions: dims,
      drives: {
        note: '行为考古只认文件里留下的痕迹。没有日记/没有 git 历史的 Agent 只能判成 UNDECIDED，'
          + '不能判成「记忆差」——那是把「还没开始」读成「做得不好」。',
      },
    };
  }
}

function weightOf(id) {
  const d = DIMENSIONS.find((x) => x.id === id);
  return d ? d.weight : 0;
}

/** 只对 measurable 子项取均值，否则 10 分制 */
function avg01to10(subs) {
  const m = subs.filter((s) => s.measurable && typeof s.score === 'number');
  if (m.length === 0) return null;
  return m.reduce((s, x) => s + x.score, 0) / m.length;
}

function round10(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}
function round4(n) { return Math.round(n * 10000) / 10000; }
function numOr(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

module.exports = { ArchaeologyEngine, DIMENSIONS, DEFAULTS, changeCount };