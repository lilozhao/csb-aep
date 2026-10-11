// CSB-AEP v2.1 S 类安全韧性测试用例 —— 数据加载器（M-1 代码-数据分离）
//
// 【数据外置】2026-10-11：用例数据已从本文件迁出到 casesets/redteam/s-class.json
//   （一澜拍板：数据层先放 csb-aep 内独立目录；见 docs/CSB-AEP-代码数据分离评估-20261011.md）
//   本文件只负责「加载 + 校验 + 导出」，不含任何用例内容。
//
// 来源: CSB-AEP-2test-cases.md 第七章 + S-class 设计文档 · 生成 2026-08-24 · 若兰 🌸

'use strict';

const fs = require('fs');
const path = require('path');

const CASESET_DIR = process.env.AEP_CASESET_DIR
  || path.join(__dirname, '..', '..', 'casesets');

/**
 * 加载用例集（支持未来多文件；当前为 redteam/s-class.json）
 * @returns {Array} 用例数组
 */
function loadRedteamCases() {
  const file = path.join(CASESET_DIR, 'redteam', 's-class.json');
  if (!fs.existsSync(file)) {
    throw new Error(`[M-1] 红队用例数据集缺失：${file}（数据层目录 = ${CASESET_DIR}）`);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!Array.isArray(data)) throw new Error(`[M-1] 用例集格式错误（应为数组）：${file}`);
  // 基础结构校验（id 唯一 + 必填字段）
  const seen = new Set();
  for (const c of data) {
    if (!c.id) throw new Error(`[M-1] 用例缺 id：${JSON.stringify(c).slice(0, 80)}`);
    if (seen.has(c.id)) throw new Error(`[M-1] 用例 id 重复：${c.id}`);
    seen.add(c.id);
    if (!c.dimension) throw new Error(`[M-1] 用例 ${c.id} 缺 dimension`);
  }
  return data;
}

const REDTEAM_CASES = loadRedteamCases();

module.exports = { REDTEAM_CASES, loadRedteamCases };
