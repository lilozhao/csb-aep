#!/usr/bin/env node
/**
 * test/cli-results-dir.test.js — 「干净 clone 直接跑 csb eval」不能炸
 * ------------------------------------------------------------------
 * 2026-11-03 验算实测反馈的坑（HEAD 930475b 附近）：
 *
 *   $ csb eval --path archaeology --agent-path <dir>
 *   [AEP] ❌ 评估失败: ENOENT: no such file or directory,
 *        open '<repo>/data/eval-results/eval-results.json'
 *
 * 不是环境坏了，是两件事叠在一起：
 *   ① `data/eval-results/` 在 .gitignore 里（运行产物不入库）
 *   ② `ResultsStore.init()` 只被 `server/index.js` 调用过，**CLI 从来没调**
 *   → 新 clone / 新实例第一次跑，目录不存在，第一次落盘就炸。
 *   报错长相是「你的环境有问题」，实际一条 mkdir -p 的事。
 *
 * 本测试的判据（不看代码长什么样，只看行为）：
 *   把 resultsDir 指到一个**不存在的深层目录**，跑真 CLI，
 *   必须能跑完并落盘 —— 而不是 ENOENT。
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'csb.js');
const DEFAULTS = path.join(ROOT, 'config', 'defaults.json');

function runWithResultsDir(dir) {
  // 用环境变量注入，避免改动仓库内 config/defaults.json（那会污染其它测试）
  const r = spawnSync('node', [CLI, 'eval', '--path', 'archaeology', '--agent-path', ROOT], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, CSB_AEP_RESULTS_DIR: dir },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function hasEnvSupport() {
  try {
    const src = fs.readFileSync(CLI, 'utf8');
    return src.includes('CSB_AEP_RESULTS_DIR');
  } catch { return false; }
}

test('clean clone：resultsDir 不存在时必须自动建目录，而不是 ENOENT', () => {
  if (!hasEnvSupport()) {
    // CLI 不认这个 env 时，退回到「直接断言 init 被调过」这条较弱的判据，
    // 但要明确说出来——弱判据不许装成强判据。
    const src = fs.readFileSync(CLI, 'utf8');
    assert.ok(/await\s+api\.init\(\)/.test(src),
      'CLI 既没有 CSB_AEP_RESULTS_DIR 也没有 await api.init() —— 干净 clone 会 ENOENT');
    return;
  }

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aep-resultsdir-'));
  const deep = path.join(base, 'not', 'created', 'yet', 'eval-results');
  try {
    assert.ok(!fs.existsSync(deep), '前置条件：目标目录本不该存在');

    const { code, out } = runWithResultsDir(deep);

    assert.ok(!/ENOENT/.test(out), `仍报 ENOENT：\n${out.slice(-600)}`);
    assert.ok(fs.existsSync(path.join(deep, 'eval-results.json')),
      `目录/文件没建出来（code=${code}）：\n${out.slice(-600)}`);
    // 判定本身可以 PASS/FAIL/UNDECIDED —— 本测试只关心「跑得动」
    assert.ok(/verdict=/.test(out), `没有产出判定：\n${out.slice(-600)}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('仓库内的 config/defaults.json 不该被测试改动（回归：别用改配置的办法做测试）', () => {
  const d = JSON.parse(fs.readFileSync(DEFAULTS, 'utf8'));
  assert.strictEqual(d.resultsDir, './data/eval-results',
    'defaults.json 的 resultsDir 被测试污染了');
});