#!/usr/bin/env node
/**
 * 数据层守线测试（M-1 起 · CSB-AEP 代码-数据分离）
 *
 * 依据：docs/CSB-AEP-代码数据分离评估-20261011.md
 * 守三条线：
 *   1. 用例集可加载且数量不漂移（红队 28 项）
 *   2. 用例数据不含可执行代码（纯 JSON —— 红队用例必须无函数）
 *   3. 代码只依赖 casesets 的 schema，不内联用例内容（数据字段字面量密度守线）
 *
 * 用法：node --test test/datalayer.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CASESET_DIR = path.join(ROOT, 'casesets');

const { REDTEAM_CASES, loadRedteamCases } = require('../server/engine/redteam-cases.js');

test('红队用例集可加载 · 数量 = 28（不漂移）', () => {
  assert.strictEqual(REDTEAM_CASES.length, 28);
  assert.strictEqual(loadRedteamCases().length, 28);
});

test('红队用例集为纯数据文件（JSON · 无函数）', () => {
  const file = path.join(CASESET_DIR, 'redteam', 's-class.json');
  const raw = fs.readFileSync(file, 'utf-8');
  const data = JSON.parse(raw); // 能 JSON.parse 即为纯数据
  assert.ok(Array.isArray(data));
  // 任一 value 不得是函数（JSON 本就不允许，作双保险）
  for (const c of data) {
    for (const v of Object.values(c)) {
      assert.notStrictEqual(typeof v, 'function', `用例 ${c.id} 含函数 → 违反纯数据约定`);
    }
  }
});

test('用例数据不含内联可执行代码（禁 eval / 禁函数字面量）', () => {
  const file = path.join(CASESET_DIR, 'redteam', 's-class.json');
  const raw = fs.readFileSync(file, 'utf-8');
  assert.ok(!/=>|function\s*\(/.test(raw), '用例数据出现函数字面量 → 违反纯数据约定');
  assert.ok(!/\beval\s*\(/.test(raw), '用例数据出现 eval → 安全红线');
});

test('redteam-cases.js 已改为加载器（不含内联用例数组）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'engine', 'redteam-cases.js'), 'utf-8');
  // 加载器应引用 casesets 且不含内联的用例对象字面量（"dimension": 之类）
  assert.ok(/casesets/.test(src), '加载器应指向 casesets 数据层');
  const inlineHits = (src.match(/"dimension"\s*:/g) || []).length;
  assert.strictEqual(inlineHits, 0, '加载器不应内联用例数据');
});

test('数据层 schema 目录存在（可扩展）', () => {
  assert.ok(fs.existsSync(CASESET_DIR), `数据层目录应存在：${CASESET_DIR}`);
});
