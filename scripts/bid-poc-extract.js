#!/usr/bin/env node
/**
 * BID PoC 抽数脚本 v1 — W-12
 * 判据来源：csb-aep/docs/bid-poc-criteria.md（口径先写死，脚本只实现，不改口径）
 *
 * 输入（只读，不写外部）：
 *   ../../TODO.md                       承诺（状态机条目）
 *   ../../logs/ledger.jsonl             周期型承诺（cron.* / repo.mirror.push）+ 纠错事件
 *   ../../self-improving/corrections.md 纠错（自纠条目，仅统计带对象者）
 *   ../../logs/a2a-outbox/*             跨 agent 承诺/纠错（文件名分类）
 *   ../../forum-archive/*               论坛互动基线（发帖/回帖数）
 *
 * 输出：stdout（人读表）+ bid-poc-raw.json（机器读）
 * 纪律：BR-12 —— 取不到就显式 unknown，不用 0 冒充。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = path.resolve(__dirname, '..', '..');
const NOW = new Date();
const WINDOW_DAYS = 30;
const WINDOW_LO = new Date(NOW.getTime() - WINDOW_DAYS * 86400e3);

function inWindow(d) { return d && d >= WINDOW_LO && d <= NOW; }
function dayDiff(d) { return Math.floor((NOW - d) / 86400e3); }

// ---------- 通用：ISO 时间 ----------
function iso(s) {
  if (!s) return null;
  const t = new Date(String(s).replace('Z', '+00:00'));
  return isNaN(t) ? null : t;
}
// 从文本里抽 YYYY-MM-DD / MM-DD（假设当年）
function parseDateLoose(s) {
  if (!s) return null;
  let m = s.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`);
  m = s.match(/(\d{2})-(\d{2})(?!\d)/);
  if (m) return new Date(`2026-${m[1]}-${m[2]}T00:00:00+08:00`);
  return null;
}

// ---------- 1. 承诺：TODO.md 状态机 ----------
const TERMINAL = {
  '✅': { kind: 'fulfilled' },
  '⛔': { kind: 'withdrawn' },   // 显式撤回/终止：不计违约，计入记录
  '🔴': { kind: 'open_red' },
  '🟡': { kind: 'pending_decision' },
  '🟢': { kind: 'active' },
  '🔄': { kind: 'ongoing' },
  '📋': { kind: 'suspended' },
  '⚠️': { kind: 'hazard' },
};

function extractTodoPromises() {
  const p = path.join(WS, 'TODO.md');
  if (!fs.existsSync(p)) return { unknown: 'TODO.md missing', items: [] };
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const items = [];
  for (const line of lines) {
    const m = line.match(/^\|\s*(~{0,2})([A-Z]-\d+)(~{0,2})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/);
    if (!m) continue;
    const id = m[2];
    const title = m[4].trim().replace(/\*\*/g, '').slice(0, 60);
    const body = m[5] || '';
    const startStr = (m[6] || '').trim();
    const struck = m[1] === '~~' || /~~[A-Z]-\d+~~/.test(line.split('|')[1] || '');
    // 判定状态：先看标题/正文里的 emoji（排除表头的图例）
    let state = null;
    for (const e of Object.keys(TERMINAL)) {
      if (body.includes(e) || title.includes(e) || (m[4] || '').includes(e)) { state = e; break; }
    }
    if (!state && struck) state = '⛔';
    // 起日期：取最后一个日期式
    const start = parseDateLoose(startStr);
    // 完成锚：commit hash / 证据路径 / 测试记录 / 五平台
    const anchor = [];
    if (/\b[0-9a-f]{7,40}\b/.test(body)) anchor.push('commit');
    if (/\.(md|json|js|py)\b/.test(body) || /`[^`]+\.(md|json)`/.test(body)) anchor.push('path');
    if (/\d+\/\d+\s*[）)]?|测试|绿|✅\s*\d/.test(body)) anchor.push('test');
    if (/五平台|已推|ls-remote/.test(body)) anchor.push('push');
    items.push({
      id, title,
      state, stateKind: state ? TERMINAL[state].kind : 'unknown',
      start: start ? start.toISOString() : null,
      startInWindow: inWindow(start),
      anchor,
      hasAnchor: anchor.length > 0,
      struck,
    });
  }
  return { items };
}

// ---------- 2. 承诺：ledger 周期型 ----------
function extractLedger() {
  const p = path.join(WS, 'logs', 'ledger.jsonl');
  if (!fs.existsSync(p)) return { unknown: 'ledger missing', rows: [] };
  const rows = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip */ }
  }
  const periodic = rows.filter(r => /^(cron\.|repo\.mirror)/.test(r.action || ''));
  const inWin = periodic.filter(r => inWindow(iso(r.ts)));
  const corrections = rows.filter(r => /correction|更正/.test(r.action || ''));
  return { rows, periodic, periodicInWindow: inWin, corrections };
}

// ---------- 3. 纠错：corrections.md ----------
// 已知连接名 → 归一
const AGENT_ALIASES = [
  ['阿轩', ['axuan', 'ahnxuan', '轩']],
  ['恺', ['kai']],
  ['舟楫', ['zhouji', 'hermes']],
  ['小虾', ['xiaoxia', 'shrimp']],
  ['墨丘', ['moqiu']],
  ['Jeason', ['jeason']],
  ['言蹊', ['yanxi']],
  ['明德', ['mingde']],
  ['明镜', ['mingjing']],
  ['星尘', ['xingchen', 'stardust']],
  ['思源', ['siyuan']],
  ['若琢', ['ruozhuo']],
  ['知微', ['zhiwei']],
  ['澈', ['che']],
  ['初白', ['chubai']],
  ['凯/Octop', ['octop']],
];
function canonAgent(s) {
  if (!s) return null;
  const low = String(s).toLowerCase();
  for (const [name, keys] of AGENT_ALIASES) {
    if (low.includes(name.toLowerCase()) || keys.some(k => low.includes(k))) return name;
  }
  return null;
}

function extractCorrectionsMd() {
  const p = path.join(WS, 'self-improving', 'corrections.md');
  if (!fs.existsSync(p)) return { unknown: 'corrections.md missing', entries: [] };
  const txt = fs.readFileSync(p, 'utf8');
  // 以 "## <date>" 分段
  const blocks = txt.split(/\n##\s+/).slice(1);
  const entries = [];
  for (const b of blocks) {
    const head = b.split('\n')[0].trim();
    const date = parseDateLoose(head);
    // 是否带外部对象（提及某个连接名）
    let target = null;
    for (const [name] of AGENT_ALIASES) {
      if (b.includes(name)) { target = name; break; }
    }
    // 自纠 vs 对邻：出现"若兰犯"/"自纠"→ self；出现连接名→ 双向候选
    const selfOnly = /若兰犯|自纠|一澜纠正|一澜指出/.test(b);
    entries.push({
      date: date ? date.toISOString() : null,
      head: head.slice(0, 50),
      inWindow: inWindow(date),
      target,                 // 纠错对象（连接）；null = 无对象（按判据不计入双向性）
      selfOnly,
    });
  }
  return { entries };
}

// ---------- 4. 跨 agent：a2a-outbox 文件名 ----------
function extractOutbox() {
  const dir = path.join(WS, 'logs', 'a2a-outbox');
  if (!fs.existsSync(dir)) return { unknown: 'outbox missing', files: [] };
  const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
  const byAgent = {};
  const promises = [];   // 文件名含承诺语义
  const corrections = []; // 文件名含更正/纠正语义
  for (const f of files) {
    const dm = f.match(/(20\d{2}-\d{2}-\d{2})/);
    const d = dm ? new Date(`${dm[1]}T00:00:00+08:00`) : null;
    // 目标推断：文件名首个 token 或包含的连接名
    let target = canonAgent(f);
    if (!target) {
      const tok = f.split(/[-_]/)[0];
      target = canonAgent(tok) || `?${tok}`;
    }
    if (target && !target.startsWith('?')) {
      byAgent[target] = byAgent[target] || { files: 0, inWindow: 0, first: null, last: null };
      byAgent[target].files++;
      if (inWindow(d)) byAgent[target].inWindow++;
      if (d) {
        if (!byAgent[target].first || d < byAgent[target].first) byAgent[target].first = d;
        if (!byAgent[target].last || d > byAgent[target].last) byAgent[target].last = d;
      }
    }
    const low = f.toLowerCase();
    if (/promise|commit-|承诺/.test(low) || /reply-|deleg-|brief-|next|opsheet|notice/.test(low)) {
      // 仅作为"可能含承诺"的候选，需人工核；不直接计分
      promises.push({ file: f, date: d ? d.toISOString() : null, inWindow: inWindow(d), target });
    }
    if (/correct|更正|纠错|我说错/.test(low)) {
      corrections.push({ file: f, date: d ? d.toISOString() : null, inWindow: inWindow(d), target });
    }
  }
  return { byAgent, promiseCandidates: promises, correctionFiles: corrections, total: files.length };
}

// ---------- 4b. 互动基线：a2a-memories 事件流（真源，覆盖 09-16→今） ----------
// 判据 §7 门槛：双向互动 ≥10 次。a2a-memories 是消息级事件账，优于 outbox 文件名。
const MEM_AGENTS = ['阿轩','墨丘','舟楫','小虾','Jeason','恺','澈','星尘','思源','明德','若琢','言蹊','明镜','苏念','川贝','清漪','鲸歌','初白','知微','若辰'];
function extractMemEvents() {
  const p = path.join(WS, 'csb-memory', 'data', 'a2a-memories', '若兰.md');
  if (!fs.existsSync(p)) return { unknown: 'a2a-memories/若兰.md missing', perAgent: {}, totalEvents: 0, inWindowEvents: 0 };
  const txt = fs.readFileSync(p, 'utf8');
  const blocks = txt.split('\n---\n');
  const perAgent = {};
  let total = 0, inWin = 0;
  for (const b of blocks) {
    const tm = b.match(/timestamp:\s*"([^"]+)"/);
    if (!tm) continue;
    const d = iso(tm[1]); if (!d) continue;
    total++;
    const w = inWindow(d); if (w) inWin++;
    for (const a of MEM_AGENTS) {
      if (b.includes(a)) {
        const e = perAgent[a] = perAgent[a] || { all: 0, inWindow: 0 };
        e.all++; if (w) e.inWindow++;
      }
    }
  }
  return { perAgent, totalEvents: total, inWindowEvents: inWin };
}

// ---------- 4c. 承诺（跨 agent）：入站任务库 a2a-tasks.json ----------
// sender = 发起方；state ∈ {COMPLETED, REJECTED, FAILED}。
// 逐连接履约率 = COMPLETED / (COMPLETED+REJECTED+FAILED)，窗口内。
// ⚠️ 语义警告：REJECTED 中含 self-guard/loopback 安全拦截，非关系质量信号 → 需人工标注分层。
function extractInboundTasks() {
  const p = path.join(WS, 'csb-a2a-aip', 'data', 'a2a-tasks.json');
  if (!fs.existsSync(p)) return { unknown: 'a2a-tasks.json missing', byAgent: {} };
  let d; try { d = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { unknown: 'parse error', byAgent: {} }; }
  let tasks = d.tasks || d;
  if (!Array.isArray(tasks)) tasks = Object.values(tasks);
  const perAgent = {};
  for (const t of tasks) {
    const created = iso(t.createdAt); if (!created || !inWindow(created)) continue;
    const md = t.metadata || {};
    const s = md.sender; const name = typeof s === 'object' && s ? s.name : (typeof s === 'string' ? s : null);
    const cn = name ? name.split(/\s/)[0] : null;
    const guard = md.selfGuard ? 'guard' : 'inbound';
    const st = (t.status && t.status.state || '?').replace('TASK_STATE_', '');
    const key = (cn || '(无署名/loopback)') + (guard === 'guard' ? '·guard' : '');
    const e = perAgent[key] = perAgent[key] || { done: 0, rejected: 0, failed: 0, total: 0 };
    e.total++;
    if (st === 'COMPLETED') e.done++; else if (st === 'REJECTED') e.rejected++; else if (st === 'FAILED') e.failed++;
  }
  for (const e of Object.values(perAgent)) e.rate = e.total ? +(e.done / e.total).toFixed(3) : null;
  return { byAgent: perAgent };
}
// ---------- 5. 论坛互动基线 ----------
function extractForum() {
  const root = path.join(WS, 'forum-archive');
  if (!fs.existsSync(root)) return { unknown: 'forum-archive missing' };
  const perDate = {};
  let total = 0, posts = 0, replies = 0;
  const inWin = [];
  for (const d of fs.readdirSync(root)) {
    const dm = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dm) continue;
    const dt = new Date(`${d}T23:59:00+08:00`);
    const files = fs.readdirSync(path.join(root, d));
    perDate[d] = { total: files.length, posts: files.filter(f => f.startsWith('post_')).length, replies: files.filter(f => f.startsWith('reply_')).length };
    total += files.length;
    posts += perDate[d].posts;
    replies += perDate[d].replies;
    if (inWindow(dt)) inWin.push(d);
  }
  return { total, posts, replies, perDate, inWindowDates: inWin };
}

// ---------- 6. 汇总：按连接 ----------
function buildConnections(todo, ledger, corr, outbox, forum, mem) {
  const conn = {}; // name -> stats
  const ensure = n => (conn[n] = conn[n] || {
    name: n, outboxFiles: 0, outboxInWindow: 0,
    corrOut: 0, corrIn: 0, promises: 0, promisesFulfilled: 0,
    memEvents: 0, memInWindow: 0,
  });

  // 真互动基线：a2a-memories 事件流
  for (const [name, v] of Object.entries(mem.perAgent || {})) {
    const c = ensure(name);
    c.memEvents = v.all; c.memInWindow = v.inWindow;
  }
  for (const [name, v] of Object.entries(outbox.byAgent)) {
    const c = ensure(name);
    c.outboxFiles = v.files;
    c.outboxInWindow = v.inWindow;
    c.first = v.first ? v.first.toISOString().slice(0, 10) : null;
    c.last = v.last ? v.last.toISOString().slice(0, 10) : null;
  }
  // 纠错方向：outbox correction files = 我→对方
  for (const f of outbox.correctionFiles) {
    if (f.target && !f.target.startsWith('?')) ensure(f.target).corrOut++;
  }
  // corrections.md 带对象者：我方自纠指向某连接（我→对方 的纪律性纠正）
  for (const e of corr.entries) {
    if (e.target) ensure(e.target).corrSelfNotes = (ensure(e.target).corrSelfNotes || 0) + 1;
  }
  return conn;
}

// ---------- Gini ----------
function gini(xs) {
  const a = xs.filter(x => typeof x === 'number').sort((p, q) => p - q);
  const n = a.length; if (!n) return null;
  const sum = a.reduce((s, x) => s + x, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * a[i];
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

// ---------- main ----------
const todo = extractTodoPromises();
const ledger = extractLedger();
const corr = extractCorrectionsMd();
const outbox = extractOutbox();
const mem = extractMemEvents();
const tasksIn = extractInboundTasks();
const forum = extractForum();
const conn = buildConnections(todo, ledger, corr, outbox, forum, mem);

// 判据表：TODO 承诺（窗口内起 且 有状态）
const todoInWin = todo.items.filter(i => i.startInWindow);
const todoFulfilled = todoInWin.filter(i => i.stateKind === 'fulfilled');
const todoWithdrawn = todoInWin.filter(i => i.stateKind === 'withdrawn');
const todoOpen = todoInWin.filter(i => ['active', 'ongoing', 'pending_decision', 'suspended', 'open_red'].includes(i.stateKind));
const todoUnknown = todoInWin.filter(i => i.stateKind === 'unknown');

// --- 判据裁决（二/三选一，机械可核） ---
const THRESH_CONN = 10;      // §7 门槛：互动 ≥10 次
const MIN_SAMPLE = 5;        // 判据：达标连接 ≥5 才算够说话
const CORR_OBJ_TOTAL = corr.entries.filter(e => e.target).length + outbox.correctionFiles.length;
// 达标连接：以 a2a-memories 窗口内事件数为互动基线（真源）
const activeConn = Object.values(conn).filter(c => c.memInWindow >= THRESH_CONN);

function verdictPromise() {
  // 连接级承诺可归属性：TODO/ledger 均为自/项目级（无连接归属）
  // 唯一连接级代理 = 入站任务库履约率（剔 guard/loopback/自检伪影）
  const real = Object.entries(tasksIn.byAgent)
    .filter(([k]) => !k.includes('无署名') && !k.includes('guard') && !k.includes('自检') && !k.includes('CSB-AEP'))
    .map(([k, e]) => ({ k, rate: e.rate, total: e.total }))
    .filter(x => x.rate != null && x.total >= 1);
  if (real.length < MIN_SAMPLE) return '⚠️ 样本不足（不评）：连接级承诺可归属样本 ' + real.length + '<' + MIN_SAMPLE;
  const rates = real.map(x => x.rate);
  const allSame = rates.every(v => v === rates[0]);
  if (allSame) return '❌ 无区分度（全同值 ' + rates[0] + '）— 单侧落账只记成功，无失败/延时信号';
  return '✅ 有区分度';
}
function verdictCorrection() {
  // 纠错双向率需双侧落账；单侧账本结构性取不到 → BR-12 N/A
  const withObj = CORR_OBJ_TOTAL;
  if (withObj < 2) return '⚠️ 样本不足（不评）';
  return '⚠️ 单侧不可测（需对方落账回传 → 本 PoC N/A）';
}
const giniActivity = gini(Object.values(conn).map(c => c.memInWindow).filter(x => x > 0));
// 入站任务履约率的跨连接分布（排除无署名/loopback/guard）
const inboundRates = Object.entries(tasksIn.byAgent)
  .filter(([k]) => !k.includes('无署名') && !k.includes('guard') && !k.includes('自检') && !k.includes('CSB-AEP'))
  .map(([, e]) => e.rate);
const inboundGini = gini(inboundRates);
const inboundAllSame = inboundRates.length > 1 && inboundRates.every(v => v === inboundRates[0]);

const kai_ = {
  windowDays: WINDOW_DAYS,
  window: { lo: WINDOW_LO.toISOString(), hi: NOW.toISOString() },
  promiseTodo: {
    inWindow: todoInWin.length,
    fulfilled: todoFulfilled.length,
    withdrawn: todoWithdrawn.length,
    open: todoOpen.length,
    unknown: todoUnknown.length,
    withAnchor: todoInWin.filter(i => i.hasAnchor).length,
    // 履约率（窗口内起、含终态者）：(按时+延时×0.5)/(到期且未撤回)
    // 单侧账本无"延时"细分 → 暂按 ✅=1 / ⛔撤回剔除 / 未闭环记 open（不计入分子）
    fulfillmentRate: (() => {
      const denom = todoInWin.length - todoWithdrawn.length;
      return denom > 0 ? +((todoFulfilled.length) / denom).toFixed(3) : null;
    })(),
    items: todoInWin,
  },
  verdict: {
    promise: verdictPromise(),
    correction: verdictCorrection(),
    activeConn: activeConn.map(c => c.name),
    activeConnCount: activeConn.length,
    giniActivity: giniActivity == null ? null : +giniActivity.toFixed(3),
    corrWithObjectTotal: CORR_OBJ_TOTAL,
    inboundRates,
    inboundGini: inboundGini == null ? null : +inboundGini.toFixed(3),
    inboundAllSame,
    dataSided: '若兰单侧（TODO+ledger+corrections+outbox+inbound-tasks）',
  },
  ledger: {
    total: ledger.rows.length,
    periodicTotal: ledger.periodic.length,
    periodicInWindow: ledger.periodicInWindow.length,
    actionsInWindow: ledger.rows.filter(r => inWindow(iso(r.ts))).length,
  },
  correctionsMd: {
    total: corr.entries.length,
    inWindow: corr.entries.filter(e => e.inWindow).length,
    withConnectionObject: corr.entries.filter(e => e.target).length,
    entries: corr.entries,
  },
  outbox: {
    total: outbox.total,
    byAgent: outbox.byAgent,
    correctionFiles: outbox.correctionFiles.length,
    promiseCandidates: outbox.promiseCandidates.length,
  },
  memEvents: { total: mem.totalEvents, inWindow: mem.inWindowEvents, perAgent: mem.perAgent },
  inboundTasks: tasksIn.byAgent,
  forum: { total: forum.total, posts: forum.posts, replies: forum.replies, inWindowDates: forum.inWindowDates },
  connections: conn,
};

// ---------- 打印 ----------
const pad = (s, n) => String(s == null ? '' : s).padEnd(n);
console.log('═══ BID PoC 首批读数 · ' + NOW.toISOString().slice(0, 19) + ' CST窗口=' + WINDOW_DAYS + 'd ═══');
console.log('\n[1] 承诺 · TODO.md 状态机（窗口 ' + kai_.window.lo.slice(0, 10) + ' → ' + kai_.window.hi.slice(0, 10) + '）');
console.log('  TODO 总条目=' + todo.items.length + ' · 窗口内起=' + todoInWin.length +
  ' · ✅履约=' + todoFulfilled.length + ' · ⛔撤回=' + todoWithdrawn.length + ' · 未闭环=' + todoOpen.length +
  ' · 带可回读锚=' + kai_.promiseTodo.withAnchor);
for (const i of todoInWin) {
  console.log(`   ${pad(i.id, 6)} ${pad(i.state || '?', 3)} ${pad(i.stateKind, 14)} anchor=${pad(i.anchor.join('+') || '无', 18)} start=${i.start ? i.start.slice(0, 10) : '?'}  ${i.title}`);
}
console.log('\n[2] 承诺 · ledger 周期型');
console.log('  ledger 总行=' + kai_.ledger.total + ' · 周期型(cron./mirror)=' + kai_.ledger.periodicTotal +
  ' · 窗口内周期动作=' + kai_.ledger.periodicInWindow + ' · 窗口内全部动作=' + kai_.ledger.actionsInWindow);
console.log('\n[3] 纠错 · corrections.md');
console.log('  条目=' + corr.entries.length + ' · 窗口内=' + kai_.correctionsMd.inWindow +
  ' · 带连接对象=' + kai_.correctionsMd.withConnectionObject + '（其余为自纠，按判据不计入双向性）');
console.log('\n[4] 跨 agent 互动基线·真源（a2a-memories 事件流，09-16→今全在窗口）');
console.log('  总事件=' + mem.totalEvents + ' · 窗口内=' + mem.inWindowEvents);
console.log('    ' + pad('连接', 12) + pad('事件', 6) + pad('窗口内', 8) + '   outbox文件');
const connSorted = Object.values(conn).sort((a, b) => b.memInWindow - a.memInWindow);
for (const c of connSorted) {
  console.log('    ' + pad(c.name, 12) + pad(c.memEvents, 6) + pad(c.memInWindow, 8) + '   ' + c.outboxFiles);
}
console.log('\n[4b] 承诺·跨 agent 入站任务库（a2a-tasks.json · 窗口内·sender 维度）');
console.log('    ' + pad('连接', 20) + pad('完成', 6) + pad('拒', 5) + pad('失败', 5) + pad('总', 6) + ' 履约率');
for (const [k, e] of Object.entries(tasksIn.byAgent).sort((a, b) => b[1].total - a[1].total)) {
  console.log('    ' + pad(k, 20) + pad(e.done, 6) + pad(e.rejected, 5) + pad(e.failed, 5) + pad(e.total, 6) + ' ' + (e.rate == null ? 'N/A' : e.rate));
}
console.log('\n[4c] 跨 agent · a2a-outbox（若兰侧发送的委托/回函文件）');
console.log('  文件总数=' + outbox.total + ' · 更正类=' + outbox.correctionFiles.length);
console.log('\n[5] 论坛互动（archive 归档，非全量）');
console.log('  文件=' + forum.total + ' · 发帖=' + forum.posts + ' · 回帖=' + forum.replies + ' · 窗口内归档日=' + forum.inWindowDates.length);

// 区分度：对 outbox 覆盖的连接，用"窗口内互动数"作为活跃度代理
const activity = connSorted.filter(c => c.memInWindow > 0);
console.log('\n[6] 区分度探针（互动基线 = a2a-memories 窗口内事件数）');
console.log('  达标(≥' + THRESH_CONN + '次)连接数=' + kai_.verdict.activeConnCount + ' / 有数据连接数=' + activity.length + '（判据阈值：≥' + MIN_SAMPLE + ' 才算够）');
console.log('  基尼(互动分布)=' + (giniActivity == null ? 'N/A' : giniActivity.toFixed(3)) + '（判据：>0.1 表示分布有层次）');
console.log('\n[7] 判定（机械可核 · 对齐判据表）');
console.log('  承诺·入站任务履约率跨连接分布 = ' + JSON.stringify(inboundRates) + '  基尼=' + (inboundGini == null ? 'N/A' : inboundGini.toFixed(3)) + (inboundAllSame ? ' [全同值]' : ' [有层次]'));
console.log('  承诺(履约率)  = ' + kai_.verdict.promise + '  [mem 达标连接=' + kai_.verdict.activeConnCount + '，需≥' + MIN_SAMPLE + ']');
console.log('  纠错(双向率)  = ' + kai_.verdict.correction + '  [带对象纠错=' + CORR_OBJ_TOTAL + '，全来自若兰单侧]');
console.log('  履约率(TODO窗口内起,剔除撤回) = ' + (kai_.promiseTodo.fulfillmentRate == null ? 'N/A' : kai_.promiseTodo.fulfillmentRate) + '  （N=' + (todoInWin.length - todoWithdrawn.length) + '，样本小，不外推）');

// 写机器读
const out = path.join(WS, 'csb-aep', 'data', 'bid', 'bid-poc-raw.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(kai_, null, 2));
console.log('\n→ 机器读: ' + out);