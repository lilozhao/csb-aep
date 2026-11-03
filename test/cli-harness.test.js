#!/usr/bin/env node
/**
 * csb harness 子命令验收（2026-11-04）
 *
 * 为什么要有：CLI 是外部 Agent 的**第一触点**。它坏了，文档写得再好也没人走得通。
 * 这里锁的是「行为契约」，不是输出文案：
 *   · 内置示例自检能跑（没人给参数时不至于直接失败）
 *   · dry-run 打分表里不出现 result（dry-run 不出判定结论）
 *   · 该 N/A 的地方不吐 0 分
 *   · 缺必填块 → exit 2（blocked），不是 0
 *   · --json 与文本模式的 state/exitCode 一致
 *
 * 运行：node test/cli-harness.test.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts/csb.js');
const EX = path.join(ROOT, 'examples');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

/** 跑 CLI，返回 { code, out, err }（不抛异常，code 自己判） */
function run(args) {
  try {
    const out = execFileSync(process.execPath, [CLI, 'harness', ...args], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status === undefined ? 1 : e.status, out: e.stdout || '', err: e.stderr || '' };
  }
}

console.log('\n=== 参数入口 ===');
t('不给参数 → 用内置示例自检（不崩）', () => {
  const r = run(['--dry-run']);
  if (/Cannot find module|TypeError/.test(r.out + r.err)) throw new Error('崩了：' + (r.err || r.out).slice(0, 300));
  if (!/内置示例/.test(r.out)) throw new Error('未走内置示例分支：' + r.out.slice(0, 300));
});
t('--config 整包能吃', () => {
  const r = run(['--config', path.join(EX, 'harness-full-example.json'), '--dry-run']);
  if (!/16\/16/.test(r.out)) throw new Error('未识别 16 项全量：' + r.out.slice(0, 400));
});
t('--manifest + --traces 组合能吃', () => {
  const r = run(['--manifest', path.join(EX, 'harness-manifest.example.json'),
                 '--traces', path.join(EX, 'trace.example.jsonl'), '--dry-run']);
  if (!/3 条全部合法/.test(r.out)) throw new Error('trace 未解析：' + r.out.slice(0, 400));
});

console.log('\n=== dry-run 语义：不出判定结论 ===');
t('dry-run 文本模式不打分', () => {
  const r = run(['--config', path.join(EX, 'harness-full-example.json'), '--dry-run']);
  if (/average=/.test(r.out)) throw new Error('dry-run 不应输出 average：' + r.out);
});
t('dry-run --json 里没有 result', () => {
  const r = run(['--config', path.join(EX, 'harness-full-example.json'), '--dry-run', '--json']);
  const j = JSON.parse(r.out);
  if (j.result !== undefined) throw new Error('dry-run 不该带 result');
  if (j.dryRun !== true) throw new Error('dryRun 标记丢失');
});

console.log('\n=== 真跑：该出分就出分 ===');
t('全量 + 基线 → 16/16 + Δ', () => {
  const r = run(['--config', path.join(EX, 'harness-full-example.json'), '--baseline', '6.4']);
  if (r.code !== 0) throw new Error(`exit=${r.code}\n${r.out}`);
  if (!/16\/16/.test(r.out)) throw new Error('未覆盖 16 项：' + r.out.slice(0, 400));
  if (!/Δ=3\.23/.test(r.out)) throw new Error('Δ 未算出：' + r.out.slice(0, 400));
});
t('不给基线 → 明确说「不出 Δ」，不是静默省略', () => {
  // 注意：harness-full-example.json 自带 baselineScore，
  // 要验「没给基线」必须先把基线字段剔掉，否则测的是另一件事
  const src = JSON.parse(fs.readFileSync(path.join(EX, 'harness-full-example.json'), 'utf8'));
  delete src.baselineScore;
  delete src.baselineMeta;
  const tmp = path.join(ROOT, '.nobaseline.json');
  fs.writeFileSync(tmp, JSON.stringify(src));
  try {
    const r = run(['--config', tmp]);
    if (!/Δ：不出/.test(r.out)) throw new Error('应显式说明不出 Δ：' + r.out.slice(-400));
  } finally { fs.unlinkSync(tmp); }
});

console.log('\n=== N/A 的正确表达：不能说成 0 分 ===');
t('缺数据项显示为 N/A 而非 0', () => {
  const r = run(['--manifest', path.join(EX, 'harness-manifest.example.json'),
                 '--traces', path.join(EX, 'trace.example.jsonl'), '--dry-run', '--json']);
  const j = JSON.parse(r.out);
  if (!j.wouldNA || !j.wouldNA.length) throw new Error('应有 N/A 项');
  if (j.wouldNA.some(id => /^0/.test(String(id)))) throw new Error('N/A 里混进了 0 分');
});
t('文本模式写明「不是 0 分」', () => {
  const r = run(['--manifest', path.join(EX, 'harness-manifest.example.json'),
                 '--traces', path.join(EX, 'trace.example.jsonl'), '--dry-run']);
  if (!/不是 0 分/.test(r.out)) throw new Error('缺少 N/A 释义：' + r.out);
});

console.log('\n=== 负向：坏输入必须拦下（exit 2）===');
t('缺必填块 → exit 2', () => {
  const tmp = path.join(ROOT, '.bad-manifest.json');
  fs.writeFileSync(tmp, JSON.stringify({ harness: { name: 'x' } }));
  try {
    const r = run(['--manifest', tmp, '--dry-run']);
    if (r.code !== 2) throw new Error(`应 exit 2，实际 ${r.code}\n${r.out}`);
    if (!/Manifest 校验失败/.test(r.out)) throw new Error('未报告校验失败');
  } finally { fs.unlinkSync(tmp); }
});
t('trace 文件不存在 → 非 0 退出且说明原因', () => {
  const r = run(['--manifest', path.join(EX, 'harness-manifest.example.json'),
                 '--traces', '/nonexistent/nope.jsonl', '--dry-run']);
  if (r.code === 0) throw new Error('不该 exit 0');
  if (!/不存在/.test(r.out + r.err)) throw new Error('未说明文件不存在');
});
t('trace 行非法 JSON → 说明第几行', () => {
  const tmp = path.join(ROOT, '.bad-trace.jsonl');
  fs.writeFileSync(tmp, '{"steps":[{"i":1,"tool":"a","tokens":1}]}\nnot-json\n');
  try {
    const r = run(['--manifest', path.join(EX, 'harness-manifest.example.json'),
                   '--traces', tmp, '--dry-run']);
    if (r.code === 0) throw new Error('不该 exit 0');
    if (!/第 2 行/.test(r.out + r.err)) throw new Error('未定位到行号：' + (r.out + r.err).slice(0, 300));
  } finally { fs.unlinkSync(tmp); }
});
t('--baseline 不是数字 → 拦下', () => {
  const r = run(['--config', path.join(EX, 'harness-full-example.json'), '--baseline', 'abc', '--dry-run']);
  if (r.code !== 2) throw new Error(`应 exit 2，实际 ${r.code}`);
});

console.log('\n=== 两种输出模式口径一致 ===');
t('--json 的 exitCode 与进程退出码相同', () => {
  const args = ['--manifest', path.join(EX, 'harness-manifest.example.json'),
                '--traces', path.join(EX, 'trace.example.jsonl'), '--dry-run', '--json'];
  const r = run(args);
  const j = JSON.parse(r.out);
  if (j.exitCode !== r.code) throw new Error(`json.exitCode=${j.exitCode} 进程=${r.code}`);
});

console.log('\n=== paths 子命令要认得 Harness 域 ===');
t('csb paths 列出 ⑥ Harness', () => {
  const out = execFileSync(process.execPath, [CLI, 'paths'], { cwd: ROOT, encoding: 'utf8' });
  if (!/⑥ Harness/.test(out)) throw new Error('paths 未列出 Harness：' + out);
});

console.log(`\n通过: ${pass}  失败: ${fail}`);
process.exit(fail === 0 ? 0 : 1);