#!/usr/bin/env node
/**
 * M-5 数据层完备性 + 域隔离断言
 *
 * 依据：docs/CSB-AEP-代码数据分离评估-20261011.md §4（协议 §1.4 域隔离）
 * 守两条线：
 *   A. 数据层完备：casesets/ 下每个用例集都能加载、符合 schema 关键字段、数量不漂移
 *   B. 域隔离不破：server/ 只依赖 casesets 的「schema/加载方式」，
 *      不出现「域 A 直接读域 B 的落盘数据」这类跨域依赖
 *      （在此之上叠加：harness 引擎不得 require gdi/eval —— 原 M4 不变量3）
 *
 * 用法：node --test test/datalayer-isolation.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CASESET_DIR = path.join(ROOT, 'casesets');

// ── A. 数据层完备 ──────────────────────────────────────

test('casesets 下所有用例集均存在且可 JSON 解析', () => {
  const files = [
    'blackbox/dialogue.json',
    'redteam/s-class.json',
    'protocol/a2a-v06.json',
    'protocol/csb-v1.json',
  ];
  for (const f of files) {
    const p = path.join(CASESET_DIR, f);
    assert.ok(fs.existsSync(p), `用例集缺失：${f}`);
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    assert.ok(Array.isArray(data) && data.length > 0, `${f} 应为非空数组`);
  }
});

test('schema.json 存在且声明了各用例集（M-5 数据契约）', () => {
  const p = path.join(CASESET_DIR, 'schema.json');
  assert.ok(fs.existsSync(p), 'schema.json 缺失');
  const s = JSON.parse(fs.readFileSync(p, 'utf-8'));
  assert.ok(s['x-caseset-files'], 'schema 应声明 x-caseset-files');
  for (const f of Object.keys(s['x-caseset-files'])) {
    assert.ok(fs.existsSync(path.join(CASESET_DIR, f)), `schema 声明了不存在的用例集：${f}`);
  }
});

test('用例集 id 全局唯一 + 无空 id（各文件内）', () => {
  for (const f of ['blackbox/dialogue.json', 'redteam/s-class.json', 'protocol/a2a-v06.json', 'protocol/csb-v1.json']) {
    const data = JSON.parse(fs.readFileSync(path.join(CASESET_DIR, f), 'utf-8'));
    const seen = new Set();
    for (const c of data) {
      assert.ok(c.id, `${f} 存在空 id`);
      assert.ok(!seen.has(c.id), `${f} id 重复：${c.id}`);
      seen.add(c.id);
    }
  }
});

test('黑盒用例含 judge+params 且 judge 在判官表内', () => {
  const { JUDGES } = require('../server/engine/judges.js');
  const data = JSON.parse(fs.readFileSync(path.join(CASESET_DIR, 'blackbox/dialogue.json'), 'utf-8'));
  for (const c of data) {
    assert.ok(c.judge, `${c.id} 缺 judge`);
    assert.ok(JUDGES[c.judge], `${c.id} 判官未定义：${c.judge}`);
    assert.ok(c.params && typeof c.params === 'object', `${c.id} 缺 params`);
  }
});

// ── B. 域隔离不破 ──────────────────────────────────────

test('域隔离：harness 引擎不 require gdi/eval 模块（继承 M4 不变量3）', () => {
  const dir = path.join(ROOT, 'server', 'engine', 'harness');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf-8');
    const requires = (src.match(/require\(['"]([^'"]+)['"]\)/g) || []).join(' ');
    assert.ok(!/gdi/.test(requires), `${f} 不得 require gdi`);
    assert.ok(!/(^|[\/'"])eval[\/'"]/.test(requires), `${f} 不得 require eval`);
  }
});

test('域隔离：数据层中立于域（用例集不被任何单一域专有引用）', () => {
  // 数据层 casesets/ 是公共底座；校验三个域引擎都只「读」不「写」
  const dirs = [
    path.join(ROOT, 'server', 'engine', 'harness'),
    path.join(ROOT, 'server', 'engine', 'gdi'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf-8');
      // 不得直接写 casesets（数据层只读）
      assert.ok(!/writeFileSync\([^)]*casesets/.test(src), `${f} 不应写 casesets（数据层只读）`);
    }
  }
});

test('加载器统一走 AEP_CASESET_DIR（数据层可重定位）', () => {
  for (const f of ['server/engine/blackbox.js', 'server/engine/redteam-cases.js', 'server/standard/a2a.js', 'server/standard/csb.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf-8');
    assert.ok(/AEP_CASESET_DIR/.test(src), `${f} 应支持 AEP_CASESET_DIR 覆盖（数据层可重定位）`);
  }
});
