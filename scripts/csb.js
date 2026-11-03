#!/usr/bin/env node
/**
 * csb —— CSB-AEP 统一 CLI 入口（P2-3 · 2026-11-03）
 *
 * ── 要解决的问题 ─────────────────────────────────────────────
 * 零件散在 30+ 个脚本里（scripts/*.js、server/api/*、test/*），
 * 每次自评都要人记「哪条命令 + 哪些参数 + 跑完看哪个字段」。
 * 更要紧的是：**跑之前没人告诉你这次会判不了什么**。
 * 于是「跑出来一堆 UNDECIDED」被当成「结果不好」，而不是「条件没备齐」。
 *
 * ── 三态（借 OpenHarness --dry-run 的口径）──────────────────────
 *   ready   0  条件齐备，跑下去能得到判定
 *   warning 1  能跑，但**有东西会被判成 UNDECIDED**（说清是哪一段、为什么）
 *   blocked 2  跑也白跑：目标不可达 / 判据不可信 / 没有可判路径
 *
 * 关键设计：**dry-run 不产生任何判定结论，只产生「能不能判」的结论。**
 *   它绝不发一条 A2A 消息（探针只做 TCP 连接 + 读本地文件），
 *   所以可以随便跑、可以进 CI、可以放进 pre-commit。
 *
 * ── 用法 ─────────────────────────────────────────────────────
 *   csb eval --dry-run                      # 只体检，不评测
 *   csb eval --url host:port                # 黑盒评测
 *   csb eval --url host:port --path mutual --peers a:1,b:1
 *   csb eval --path mutual --peers a:1,b:1 --dry-run
 *   csb eval --help
 *
 * 退出码与 server/engine/verdict 的 GATE_EXIT 同源：0 可继续 / 1 需注意 / 2 拦下。
 *
 * 维护：若兰（公开场合纯名）
 */
'use strict';

const path = require('path');
const fs = require('fs');
const net = require('net');

const AEP = path.join(__dirname, '..');
const verdict = require(path.join(AEP, 'server/engine/verdict'));
const criteria = require(path.join(AEP, 'server/engine/criteria'));

const STATE = Object.freeze({ READY: 'ready', WARNING: 'warning', BLOCKED: 'blocked' });
const STATE_EXIT = Object.freeze({ [STATE.READY]: 0, [STATE.WARNING]: 1, [STATE.BLOCKED]: 2 });
const ORDER = { [STATE.READY]: 0, [STATE.WARNING]: 1, [STATE.BLOCKED]: 2 };

// ══════════════════════════════════════════════
// 参数解析（不引第三方库：CLI 越薄越不容易坏）
// ══════════════════════════════════════════════
function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      if (inline !== undefined) { out.flags[k] = inline; continue; }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out.flags[k] = next; i++; }
      else out.flags[k] = true;
    } else out._.push(a);
  }
  return out;
}

function stateOf(list) {
  return list.some((x) => x.state === STATE.BLOCKED) ? STATE.BLOCKED
    : list.some((x) => x.state === STATE.WARNING) ? STATE.WARNING
      : STATE.READY;
}

function line(state) {
  return state === STATE.BLOCKED ? '🔴' : state === STATE.WARNING ? '🟡' : '✅';
}

// ══════════════════════════════════════════════
// 体检项：每一项都返回 { id, title, state, detail, fixes[] }
//   fixes 必须可执行 —— 说「去配置一下」等于没说。
// ══════════════════════════════════════════════

/** 目标可达性：只做 TCP 连接，不发任何 A2A 消息（dry-run 不许有副作用） */
async function probeTcp(hostPort, timeoutMs = 1200) {
  const m = String(hostPort).match(/^(?:https?:\/\/)?([^/:]+):(\d+)/);
  if (!m) return { ok: false, why: `无法解析 host:port（收到 ${hostPort}）` };
  const host = m[1];
  const port = Number(m[2]);
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, why) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve({ ok, why });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false, `${timeoutMs}ms 内未连上`));
    sock.once('error', (e) => finish(false, e.code || e.message));
    sock.connect(port, host);
  });
}

async function checkTarget(url) {
  const r = await probeTcp(url, 1200);
  return r.ok
    ? { id: 'target', title: `目标 ${url}`, state: STATE.READY, detail: 'TCP 可连（未发 A2A 消息）', fixes: [] }
    : {
      id: 'target',
      title: `目标 ${url}`,
      state: STATE.BLOCKED,
      detail: `连不上：${r.why}`,
      fixes: [
        '确认目标 A2A 服务在跑：curl -s http://' + url + '/health',
        '或换用 --path mutual --peers ... 走互评路径（不依赖目标在线）',
      ],
    };
}

async function checkPeers(peerList) {
  const peers = String(peerList).split(',').map((s) => s.trim()).filter(Boolean);
  if (peers.length === 0) {
    return { id: 'peers', title: '互评评审者', state: STATE.BLOCKED, detail: '未提供 --peers', fixes: ['--peers host1:3100,host2:3100'] };
  }
  const rs = [];
  for (const p of peers) rs.push(await probeTcp(p, 1200));
  const alive = rs.filter((x) => x.ok).length;
  if (alive === 0) {
    return {
      id: 'peers', title: `互评评审者（${peers.length} 位）`, state: STATE.BLOCKED,
      detail: `0/${peers.length} 可达 → 互评结论必为 UNDECIDED(unreachable)`,
      fixes: ['先把评审者拉起来，或减少 peers 只保留在线的那几位'],
    };
  }
  if (alive < 2) {
    return {
      id: 'peers', title: `互评评审者（${peers.length} 位）`, state: STATE.WARNING,
      detail: `仅 ${alive}/${peers.length} 可达 → 能用，但只有一位评委时"互评"退化为"单评"，判别力信号失去交叉性`,
      fixes: ['建议至少 2 位在线评审者', '--peers 里去掉不可达的，避免无谓等待'],
    };
  }
  return { id: 'peers', title: `互评评审者（${peers.length} 位）`, state: STATE.READY, detail: `${alive}/${peers.length} 可达`, fixes: [] };
}

/** 判据可信性：config_hash 对不对得上（P1-4 的同一把尺子）
 *
 * ⚠️ 路径必须与 `scripts/criteria-check.js` 逐字一致：
 *   那个脚本用 `csb-compliance-degree/config.json`（不是本仓的 config/）。
 *   两边指不同文件的话，CLI 说“找不到”、自检说“一致” —— 两个都是真的，但没法一起用。
 */
function checkCriteria() {
  const target = path.join(AEP, '..', 'csb-compliance-degree', 'config.json');
  if (!fs.existsSync(target)) {
    return {
      id: 'criteria', title: '判据指纹', state: STATE.WARNING,
      detail: `找不到 ${path.relative(AEP, target)} → 无法核对判据指纹（报告仍可产出，但"可复用"判断会失效）`,
      fixes: ['确认 csb-compliance-degree/config.json 存在（与 scripts/criteria-check.js 同一路径）'],
    };
  }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch (e) {
    return { id: 'criteria', title: '判据指纹', state: STATE.BLOCKED, detail: `配置文件读不动：${e.message}`, fixes: ['修 JSON 语法'] };
  }
  const stored = cfg.config_hash;
  if (!stored) {
    return {
      id: 'criteria', title: '判据指纹', state: STATE.BLOCKED,
      detail: '配置里没有 config_hash → 旧报告"看起来判据一致"其实无从证明',
      fixes: ['node scripts/criteria-check.js --fix', '并把 config_version +1'],
    };
  }
  const fp = criteria.fingerprint(cfg);
  if (fp.hash !== stored) {
    return {
      id: 'criteria', title: '判据指纹', state: STATE.BLOCKED,
      detail: `指纹不一致（存储 ${String(stored).slice(0, 12)}… / 实算 ${fp.hash.slice(0, 12)}…）→ 改了判据没同步`,
      fixes: ['node scripts/criteria-check.js --fix', 'config_version +1（判据版本独立于代码版本）'],
    };
  }
  return { id: 'criteria', title: '判据指纹', state: STATE.READY, detail: `${fp.hash.slice(0, 12)}…（v${fp.version || '?'}）`, fixes: [] };
}

/** 白盒：agentPath 存在且能读到身份文件 */
function checkAgentPath(agentPath) {
  if (!agentPath) {
    return {
      id: 'whitebox', title: '白盒路径', state: STATE.WARNING,
      detail: '未给 --agent-path → 路径①白盒不跑；本地文件类判据全部 UNDECIDED',
      fixes: ['--agent-path /path/to/agent（要读 SOUL/MEMORY/IDENTITY 等）'],
    };
  }
  if (!fs.existsSync(agentPath)) {
    return { id: 'whitebox', title: '白盒路径', state: STATE.BLOCKED, detail: `目录不存在：${agentPath}`, fixes: ['检查路径'] };
  }
  return { id: 'whitebox', title: '白盒路径', state: STATE.READY, detail: agentPath, fixes: [] };
}

/** 采集档位预估：决定哪些指标必然 UNDECIDED（P0-6「信号不得越级」） */
function checkTier(paths) {
  const hasPath = paths.includes('whitebox');
  const hasHook = false; // 目前无适配器声明 hooks:true（P1-1 事实）
  const tier = hasHook ? 'hook' : hasPath ? 'protocol' : 'protocol';
  const blind = [];
  if (!hasHook) blind.push('工具编排 / 执行顺序 / 参数级行为（需 hook 档）');
  return {
    id: 'tier', title: '采集档位预估', state: blind.length ? STATE.WARNING : STATE.READY,
    detail: `最高 ${tier} 档` + (blind.length ? ` → 必然判不了：${blind.join('；')}` : ''),
    fixes: blind.length ? ['要那部分证据请走路径⑦（传 trajectory）或接 hook 适配器'] : [],
  };
}

// ══════════════════════════════════════════════
// eval 子命令
// ══════════════════════════════════════════════
async function cmdEval(args) {
  const f = args.flags;
  const dry = Boolean(f['dry-run']);
  const wantPath = String(f.path || (f.url ? 'blackbox' : 'mutual'));
  const rawPaths = String(f.paths || '');
  const paths = rawPaths ? rawPaths.split(',').map((s) => s.trim()).filter(Boolean) : [wantPath];

  if (!f.url && !f.peers) {
    // 什么条件都没给：这是"用法错误"，但仍按三态返回，好让机器统一处理
    const noCond = {
      id: 'input', title: '评测条件', state: STATE.BLOCKED,
      detail: '既没有 --url 也没有 --peers → 没有任何可评测的对象',
      fixes: ['csb eval --url host:port', '或 csb eval --path mutual --peers a:3100,b:3100'],
    };
    if (!dry) return printReport([noCond], { dry, wantPath });
    return printReport([noCond], { dry, wantPath });
  }

  const checks = [];
  if (f.url) checks.push(await checkTarget(f.url));
  if (f.peers || paths.includes('mutual')) checks.push(await checkPeers(f.peers || ''));
  checks.push(checkCriteria());
  if (paths.includes('whitebox') || paths.includes('blackbox') || paths.includes('both')) {
    checks.push(checkAgentPath(f['agent-path']));
  }
  checks.push(checkTier(paths));

  // 结构化「这次会判不了什么」
  const willUndecided = [];
  if (!f['agent-path']) willUndecided.push({ item: '①白盒（文件类判据）', reason: 'no_agent_path' });
  if (!f.peers) willUndecided.push({ item: '②互评', reason: 'no_peers' });
  willUndecided.push({ item: '③行为考古 / ④结构密度 / ⑤涌现', reason: 'path_not_implemented' });
  willUndecided.push({ item: '工具编排细节', reason: 'tier_below_hook' });

  return printReport(checks, { dry, wantPath, willUndecided, args });
}

function printReport(checks, opts) {
  const overall = stateOf(checks);
  const exit = STATE_EXIT[overall];
  const json = opts.args && opts.args.flags && opts.args.flags.json;

  if (json) {
    process.stdout.write(JSON.stringify({
      command: 'eval', dryRun: Boolean(opts.dry), state: overall, exitCode: exit,
      checks, willUndecided: opts.willUndecided || [],
    }, null, 2) + '\n');
    process.exitCode = exit;
    return exit;
  }

  console.log('');
  console.log(`  CSB-AEP · ${opts.dry ? 'eval --dry-run（只体检，不发任何 A2A 消息）' : 'eval'}`);
  console.log('  ' + '─'.repeat(66));
  for (const c of checks) {
    console.log(`  ${line(c.state)} ${c.title}`);
    console.log(`     ${c.detail}`);
    for (const fix of c.fixes) console.log(`     ↳ ${fix}`);
  }
  if (opts.willUndecided && opts.willUndecided.length) {
    console.log('  ' + '─'.repeat(66));
    console.log('  这次会判不了什么（先说清，免得跑完把 UNDECIDED 当"做错了"）：');
    for (const w of opts.willUndecided) console.log(`   · ${w.item} —— ${w.reason}`);
  }
  console.log('  ' + '─'.repeat(66));
  const label = overall === STATE.READY ? 'ready：条件齐备，可以跑'
    : overall === STATE.WARNING ? 'warning：能跑，但上面标🟡的会变成 UNDECIDED'
      : 'blocked：跑也白跑，先修上面的问题';
  console.log(`  ${line(overall)} ${label}   （exit ${exit}）`);
  console.log('');
  process.exitCode = exit;
  return exit;
}

// ══════════════════════════════════════════════
// help
// ══════════════════════════════════════════════
function usage() {
  console.log(`
csb —— CSB-AEP 统一入口

  csb eval [选项]

选项
  --dry-run            只体检：能不能判、会判不了什么。不发任何 A2A 消息
  --url host:port      黑盒评测目标
  --path <p>           blackbox | whitebox | mutual（默认按是否给 url / peers 推断）
  --peers a:1,b:1      path=mutual 时的评审者列表
  --agent-path <dir>   路径①白盒要读的 Agent 目录
  --json               机读输出

三态 / 退出码
  ready    0    条件齐备
  warning  1    能跑，但有项目会变 UNDECIDED
  blocked  2    跑也白跑（目标不可达 / 判据不一致 / 无评测对象）

例子
  csb eval --dry-run
  csb eval --url 172.28.0.4:3100 --dry-run
  csb eval --path mutual --peers 172.28.0.4:3100,172.28.0.5:3100 --dry-run
`);
}

// ══════════════════════════════════════════════
// main
// ══════════════════════════════════════════════
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || args.flags.help || args.flags.h) return usage();

  if (cmd === 'eval') return cmdEval(args);

  if (cmd === 'paths') {
    console.log('① 白盒       已实现  server/engine/whitebox.js');
    console.log('② 互评       已实现  server/engine/mutual.js（P2-2）');
    console.log('③ 行为考古   未实现');
    console.log('④ 结构密度   未实现');
    console.log('⑤ 涌现       未实现');
    return;
  }

  console.error(`未知子命令：${cmd}`);
  usage();
  process.exitCode = 2;
}

if (require.main === module) {
  main().catch((e) => {
    console.error('csb 失败：', e && e.message);
    process.exitCode = 2;
  });
}

module.exports = { parseArgs, stateOf, STATE, STATE_EXIT, cmdEval, checkCriteria, checkAgentPath, checkTier, probeTcp };