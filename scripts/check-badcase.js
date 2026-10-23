#!/usr/bin/env node
/**
 * check-badcase.js —— BadCase 库结构校验
 *
 * 干嘛：保证 BadCase 库「七字段齐全 + 脱敏边界不被破坏 + 编号不重复」。
 *      不是为了卡人，是为了让「加一条」这件事有可机械核对的底线。
 *
 * 用法：
 *   node csb-aep/scripts/check-badcase.js [--file <json>]
 * 退出码：0 通过 / 1 有问题
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const i = argv.indexOf('--file');
const FILE = i >= 0 ? argv[i + 1] : path.join(ROOT, 'data', 'badcase', 'badcase-v0.1.json');

// 知微 v2 第五节七字段（结构位）
const REQUIRED = ['id', 'title', 'createdAt', 'severity', 'scene', 'trigger',
  'expectation_vs_actual', 'evidence', 'root_cause', 'fix', 'regression'];
const SEVERITY_ENUM = ['S1-致命', 'S2-严重', 'S3-一般', 'S4-轻微'];
const STATUS_ENUM = ['open', 'closed', 'recurred'];

// 脱敏边界：绝不能出现的形态（发现即报错）
// 注意：这里只查「疑似泄露」的形态，不查正文语义
const LEAK_PATTERNS = [
  { re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, why: 'IP 地址' },
  { re: /https?:\/\/[^\s"']+/, why: 'URL（可能含内部地址）' },
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, why: '邮箱' },
  { re: /\b(sk|ghp|gho|xox[baprs])[-_][A-Za-z0-9]{16,}\b/, why: '可能的密钥' },
];

let errors = [];
let warns = [];

if (!fs.existsSync(FILE)) {
  console.error(`❌ 文件不存在：${FILE}`);
  process.exit(1);
}
let doc;
try {
  doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error(`❌ JSON 解析失败：${e.message}`);
  process.exit(1);
}

if (!doc.schema || !doc.schema.startsWith('csb-badcase')) {
  errors.push(`schema 必须形如 csb-badcase-vN，实际：${doc.schema}`);
}
if (!Array.isArray(doc.cases) || doc.cases.length === 0) {
  errors.push('cases[] 缺失或为空');
}

const seen = new Set();
(doc.cases || []).forEach((c, idx) => {
  const at = `cases[${idx}]${c && c.id ? `(${c.id})` : ''}`;

  // 1) 七字段齐全
  REQUIRED.forEach(k => {
    if (c[k] === undefined || c[k] === null || c[k] === '') errors.push(`${at} 缺字段 ${k}`);
  });

  // 2) 编号唯一
  if (c.id) {
    if (seen.has(c.id)) errors.push(`${at} 编号重复：${c.id}`);
    seen.add(c.id);
    if (!/^BC-\d{3}$/.test(c.id)) errors.push(`${at} 编号格式应为 BC-数字三位`);
  }

  // 3) 枚举值
  if (c.severity && !SEVERITY_ENUM.includes(c.severity)) errors.push(`${at} severity 非法：${c.severity}`);
  if (c.status && !STATUS_ENUM.includes(c.status)) errors.push(`${at} status 非法：${c.status}`);

  // 4) evidence 必须有可复现入口（否则这条案例对别人没用）
  const ev = c.evidence || {};
  if (!ev.reproduce || !ev.reproduce.command) warns.push(`${at} evidence.reproduce.command 缺失 → 别人无法复现`);
  // 5) baseline 类案例必须有 eval_set 标注（本库的核心教训）
  ['in_sample', 'held_out', 'online'].forEach(k => {
    if (ev[k] && !ev[k].eval_set) errors.push(`${at} evidence.${k} 缺 eval_set（必须声明评测集合划分）`);
  });

  // 6) 根因必须写「泛化」——否则只是个案，进不了库
  if (c.root_cause && !c.root_cause.generalization) warns.push(`${at} root_cause.generalization 缺失 → 容易退化成个案记录`);
});

// 全文脱敏扫描
const raw = fs.readFileSync(FILE, 'utf8');
LEAK_PATTERNS.forEach(({ re, why }) => {
  const hits = raw.match(new RegExp(re.source, 'g'));
  if (hits) errors.push(`疑似泄露 ${why}：${hits.length} 处（${hits[0].slice(0, 40)}…）`);
});

// 输出
const n = (doc.cases || []).length;
if (errors.length) {
  console.error(`❌ BadCase 库校验失败 · ${n} 条 · ${errors.length} 个错误`);
  errors.forEach(e => console.error('  · ' + e));
  if (warns.length) warns.forEach(w => console.error('  ⚠️ ' + w));
  process.exit(1);
}
console.log(`✅ BadCase 库校验通过 · ${n} 条 · 七字段齐全 · 编号唯一 · 脱敏边界干净${warns.length ? ` · ${warns.length} 条提醒` : ''}`);
warns.forEach(w => console.log('  ⚠️ ' + w));
