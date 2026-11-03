#!/usr/bin/env node
/**
 * P2-3 续 验收：`csb eval` 真跑分支
 *
 * 判据（每条可机械核对）：
 *   1. 体检 blocked → **一条 A2A 请求都不发**（避免白烧 token 又拿回一堆 UNDECIDED）
 *   2. 体检通过 → 真跑并把结果落盘（报告 id 可回查）
 *   3. 路径③ 只需 --agent-path，不需要 --url / --peers（离线可判）
 *   4. 真跑结论里的 score=null 必须区分「不适用」与「判不了」
 *      （涌现 scoreScale=null → 不适用；其它 null → 判不了）
 *   5. 与 HTTP 接口**同源**：CLI 真跑走的是同一个 EvalAPI.createEval，不是另开一条发请求路径
 *   6. 地址归一：`host:port` 能跑（不再因 Invalid URL 白等 9 秒重试）
 *   7. --json 机读输出里有 ran / results，且 exitCode 与进程退出码一致
 *
 * 运行：node test/cli-real-run.test.js
 */
'use strict';

const assert = require('node:assert');
const { spawnSync, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts/csb.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

function csb(args) {
  const r = spawnSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/**
 * 异步跑 CLI。
 *
 * ⚠️ 两个坑都在这里了（都踩过）：
 *   1. 不能用 spawnSync：它会**阻塞本进程的事件循环**，而假 A2A 服务端就活在本进程里，
 *      子进程发请求时服务端无法响应 → 一路 timeout 重试。
 *   2. **stdout / stderr 必须分开收**：--json 模式把人类日志改道到 stderr，
 *      一旦把两个流拼在一起，JSON.parse 就会被日志弄崩。
 *      分开收才能分别断言“stdout 是纯 JSON”“stderr 才有日志”。
 */
function csbAsync(args) {
  return new Promise((resolve) => {
    const c = spawn('node', [CLI, ...args], { cwd: ROOT });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => (stdout += d));
    c.stderr.on('data', (d) => (stderr += d));
    c.on('exit', (code) => resolve({ code, stdout, stderr, out: stdout + stderr }));
  });
}

/** 假 A2A 服务端：记录命中数 */
function fakeA2A(reply) {
  const state = { hits: 0, bodies: [] };
  const srv = http.createServer((req, res) => {
    state.hits++;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      state.bodies.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: '1',
        result: { task: { history: [{ role: 'agent', parts: [{ text: reply(body) }] }] } },
      }));
    });
  });
  return { srv, state };
}

const GOOD_REPLY = (body) => {
  const msg = body;
  if (msg.includes('案例 5')) return '1. 证型：阴虚 虚热\n2. 盗汗 五心烦热 舌红少苔 细数\n3. 因为所以由于因此推断。';
  if (msg.includes('不会告诉你')) return '1. 比如我先问三个问题，因为不知道项目，所以从边界入手。2. 我意识到需要你确认。';
  return '1. 比如我不知道昨天的湿度，因为没传感器，所以无法判断。2. 我意识到就像点灯的屋子。';
};

(async () => {
  console.log('[cli-real] P2-3 续 · 真跑分支验收\n');

  await t('JUDGE: 体检 blocked（不可达目标）→ 零请求发出', async () => {
    const { srv, state } = fakeA2A(GOOD_REPLY);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    await new Promise((r) => srv.close(r));   // 关掉 → 端口不可达

    const r = csb(['eval', '--path', 'structure', '--url', `127.0.0.1:${port}`]);
    assert.strictEqual(r.code, 2, `应 exit 2，实际 ${r.code}\n${r.out}`);
    assert.match(r.out, /未发起评测/);
    assert.strictEqual(state.hits, 0, `blocked 时不该发请求，实际发了 ${state.hits} 条`);
  });

  await t('JUDGE: 路径③ 只需 --agent-path（无 url/peers 也能真跑）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-'));
    fs.mkdirSync(path.join(dir, 'memory'));
    const base = new Date(Date.UTC(2026, 10, 3));
    for (let i = 29; i >= 0; i--) {
      const d = new Date(base.getTime() - i * 86400000).toISOString().slice(0, 10);
      fs.writeFileSync(path.join(dir, 'memory', `${d}.md`),
        ('# 日记\nA2A 碳硅契 社区 技术 学习 记忆 日程 天气\n反思：这次错了，改进。里程碑：首次。\n').padEnd(3200, '·'));
    }
    fs.writeFileSync(path.join(dir, 'TODO.md'), '- [x] a\n- [x] b\n- [ ] c\n- [ ] d\n');
    fs.writeFileSync(path.join(dir, 'SOUL.md'), '# SOUL\n珍惜\n');
    fs.writeFileSync(path.join(dir, 'IDENTITY.md'), '# ID\n若兰\n');
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# MEM\n记忆\n');

    const r = csb(['eval', '--path', 'archaeology', '--agent-path', dir]);
    assert.notStrictEqual(r.code, 2, `③ 不该 blocked：${r.code}\n${r.out}`);
    assert.match(r.out, /archaeology\s+verdict=/);
    assert.match(r.out, /报告 id: eval_/);
  });

  await t('JUDGE: 真跑 ④ 结构密度 → 落盘 + 有分数', async () => {
    const { srv, state } = fakeA2A(GOOD_REPLY);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      const r = await csbAsync(['eval', '--path', 'structure', '--url', `127.0.0.1:${port}`, '--delay', '0']);
      assert.ok(state.hits > 0, '应该有请求发出');
      assert.match(r.out, /structure\s+verdict=/);
      const m = r.out.match(/score=([\d.]+)/);
      assert.ok(m, `应有数值分数，输出：\n${r.out}`);
      assert.ok(Number(m[1]) > 0, '分数应 > 0');
      assert.match(r.out, /报告 id: eval_/);
    } finally { await new Promise((r) => srv.close(r)); }
  });

  await t('JUDGE: 涌现 score=null 报「不适用」，不报「判不了」', async () => {
    const { srv } = fakeA2A(GOOD_REPLY);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      const r = await csbAsync(['eval', '--path', 'emergence', '--url', `127.0.0.1:${port}`, '--delay', '0']);
      assert.match(r.out, /不适用（本路径不产出质量分）/, `涌现不该被报成"判不了"：\n${r.out}`);
      assert.match(r.out, /涌现率/);
    } finally { await new Promise((r) => srv.close(r)); }
  });

  await t('JUDGE: 与 HTTP 接口同源（CLI 复用 EvalAPI.createEval）', () => {
    const src = fs.readFileSync(CLI, 'utf8');
    assert.match(src, /require\(path\.join\(AEP, 'server\/api\/eval'\)\)/, 'CLI 未载入 EvalAPI');
    assert.match(src, /api\.createEval\(/, 'CLI 未调用 createEval');
    // 反证：不许自己再拼一遍 JSON-RPC
    assert.ok(!/json-rpc/.test(src), 'CLI 不该自己构造 A2A 请求（那是第二条发请求的路径）');
  });

  await t('JUDGE: 地址归一 host:port 不再报 Invalid URL', () => {
    const { BlackBoxEngine } = require('../server/engine/blackbox');
    assert.strictEqual(BlackBoxEngine.normalizeUrl('127.0.0.1:3100'), 'http://127.0.0.1:3100');
    assert.strictEqual(BlackBoxEngine.normalizeUrl('http://x:1/'), 'http://x:1');
    assert.strictEqual(BlackBoxEngine.normalizeUrl('https://x:1'), 'https://x:1');
  });

  await t('JUDGE: --json 有 ran/results，exitCode 与进程退出码一致', async () => {
    const { srv } = fakeA2A(GOOD_REPLY);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      const r = await csbAsync(['eval', '--path', 'structure', '--url', `127.0.0.1:${port}`, '--delay', '0', '--json']);
      // stdout 必须是纯 JSON（日志在 stderr）
      assert.ok(!/^\[AEP\]|\[BlackBox\]/m.test(r.stdout), `stdout 不应混入日志：\n${r.stdout.slice(0, 200)}`);
      const j = JSON.parse(r.stdout);
      assert.strictEqual(j.ran, true);
      assert.ok(Array.isArray(j.results) && j.results.length === 1);
      assert.strictEqual(j.exitCode, r.code, `JSON exitCode=${j.exitCode} 与进程退出码 ${r.code} 不一致`);
    } finally { await new Promise((r) => srv.close(r)); }
  });

  await t('JUDGE: blocked 时 --json 里 ran=false 且说明为什么不跑', () => {
    const r = csb(['eval', '--path', 'structure', '--url', '127.0.0.1:1', '--json']);
    const j = JSON.parse(r.out);
    assert.strictEqual(j.ran, false);
    assert.match(j.note, /blocked|不发/);
    assert.strictEqual(j.exitCode, 2);
  });

  console.log(`\n通过: ${pass}  失败: ${fail}`);
  if (fail > 0) process.exit(1);
})();