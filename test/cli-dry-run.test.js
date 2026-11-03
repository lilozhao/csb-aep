#!/usr/bin/env node
/**
 * P2-3 验收：统一 CLI `csb`（三态 + --dry-run）
 *
 * 判据（每条可机械核对）：
 *   1. `csb eval --dry-run` 可跑，输出三态之一
 *   2. ready   → exit 0
 *   3. warning → exit 1
 *   4. blocked → exit 2
 *   5. **dry-run 真的不发 A2A 消息**（起一个假 A2A 服务端，零请求才算过）
 *   6. dry-run 会说「这次会判不了什么」（不是只说「能跑」）
 *   7. package.json 有 bin.csb → scripts/csb.js（装上就能 `csb`）
 *   8. `--json` 输出可机读，且 state/exitCode 与文本模式一致
 *   9. 未给任何条件 → blocked（不是 ready、也不是崩溃）
 *  10. 三态与 verdict 内核的 GATE_EXIT 同源（0/1/2 不许各定一套）
 *
 * 运行：node test/cli-dry-run.test.js
 */
'use strict';

const assert = require('node:assert');
const { spawnSync } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts/csb.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

function csb(args) {
  const r = spawnSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

async function closedPort() {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

(async () => {
  console.log('[cli] P2-3 统一入口验收\n');

  await t('JUDGE: 三态退出码与 verdict 内核 GATE_EXIT 同源（0/1/2）', () => {
    const V = require('../server/engine/verdict');
    const cli = require('../scripts/csb.js');
    assert.strictEqual(V.GATE_EXIT.PASS, 0);
    assert.strictEqual(V.GATE_EXIT.FAIL, 1);
    assert.strictEqual(V.GATE_EXIT.UNDECIDED, 2);
    // CLI 的三态是"能不能判"，映射到同一组退出码，不另造一套
    assert.deepStrictEqual(cli.STATE_EXIT, { ready: 0, warning: 1, blocked: 2 });
  });

  await t('JUDGE: 无任何条件 → blocked + exit 2（不崩溃、不假绿）', () => {
    const r = csb(['eval', '--dry-run']);
    assert.strictEqual(r.code, 2, `应 exit 2，实际 ${r.code}\n${r.out}`);
    assert.match(r.out, /blocked/);
    assert.match(r.out, /既没有 --url 也没有 --peers/);
  });

  await t('JUDGE: 目标不可达 → blocked + exit 2', async () => {
    const p = await closedPort();
    const r = csb(['eval', '--url', `127.0.0.1:${p}`, '--dry-run']);
    assert.strictEqual(r.code, 2, `应 exit 2，实际 ${r.code}\n${r.out}`);
    assert.match(r.out, /🔴 目标/);
  });

  await t('JUDGE: 目标可达但有缺项 → warning + exit 1', () => {
    // 本机必有监听的端口不可保证 —— 用 CLI 自己起一个临时 TCP
    const srv = net.createServer(() => {});
    return new Promise((resolve, reject) => {
      srv.listen(0, '127.0.0.1', () => {
        const p = srv.address().port;
        const r = csb(['eval', '--url', `127.0.0.1:${p}`, '--dry-run']);
        srv.close();
        try {
          assert.strictEqual(r.code, 1, `应 exit 1，实际 ${r.code}\n${r.out}`);
          assert.match(r.out, /🟡|✅/);
          assert.match(r.out, /warning|ready/);
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  await t('JUDGE: 会说「这次会判不了什么」（不只说能跑）', () => {
    const r = csb(['eval', '--url', '127.0.0.1:1', '--dry-run']);
    assert.match(r.out, /这次会判不了什么/, '缺少"会判不了什么"段落');
    assert.match(r.out, /no_agent_path|no_peers|path_not_implemented/);
  });

  await t('JUDGE: --json 可机读，state/exitCode 与文本模式一致', () => {
    const r = csb(['eval', '--url', '127.0.0.1:1', '--dry-run', '--json']);
    const j = JSON.parse(r.out);
    assert.strictEqual(j.command, 'eval');
    assert.strictEqual(j.dryRun, true);
    assert.strictEqual(j.exitCode, r.code, `JSON exitCode=${j.exitCode} 与进程退出码 ${r.code} 不一致`);
    assert.ok(['ready', 'warning', 'blocked'].includes(j.state));
    assert.ok(Array.isArray(j.checks) && j.checks.length > 0);
  });

  await t('JUDGE: dry-run 真的不发 A2A 消息（假服务端零请求）', async () => {
    const hits = [];
    const srv = http.createServer((req, res) => {
      hits.push(req.url);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      const r = csb(['eval', '--url', `127.0.0.1:${port}`, '--dry-run']);
      assert.ok(r.code === 0 || r.code === 1, `dry-run 不该 blocked：${r.code}\n${r.out}`);
      assert.deepStrictEqual(hits, [], `dry-run 发了 ${hits.length} 条请求：${hits.join(',')}`);
    } finally { await new Promise((r) => srv.close(r)); }
  });

  await t('JUDGE: package.json 有 bin.csb → scripts/csb.js', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.bin && pkg.bin.csb, 'package.json 缺 bin.csb');
    assert.strictEqual(pkg.bin.csb, 'scripts/csb.js');
    assert.ok(fs.existsSync(path.join(ROOT, pkg.bin.csb)), 'bin 指向的文件不存在');
  });

  await t('JUDGE: --help 不报错且列出三态口径', () => {
    const r = csb(['eval', '--help']);
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /ready/);
    assert.match(r.out, /warning/);
    assert.match(r.out, /blocked/);
  });

  await t('JUDGE: 判据指纹路径与 criteria-check.js 同源（否则两把尺子）', () => {
    const cliSrc = fs.readFileSync(CLI, 'utf8');
    const chkSrc = fs.readFileSync(path.join(ROOT, 'scripts/criteria-check.js'), 'utf8');
    assert.match(chkSrc, /csb-compliance-degree/);
    assert.match(cliSrc, /csb-compliance-degree/, 'CLI 没指向同一份 compliance config');
  });

  console.log(`\n通过: ${pass}  失败: ${fail}`);
  if (fail > 0) process.exit(1);
})();