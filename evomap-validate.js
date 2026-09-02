#!/usr/bin/env node
/**
 * EvoMap validation wrapper for csb-aep (Agent Evaluation Protocol)
 * 验证：协议文档、评测配置、评测实现、五维加权结构
 * 用法: node evomap-validate.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('❌ FAIL:', msg); }
  else console.log('✅ PASS:', msg);
}

const root = __dirname;

// 1. 协议文档
const protoDir = path.join(root, 'csb-agent-eval-protocol');
assert(fs.existsSync(protoDir), '协议文档目录存在');
if (fs.existsSync(protoDir)) {
  const v1 = fs.readFileSync(path.join(protoDir, 'csb-AEP-v1.0.md'), 'utf8');
  assert(v1.length > 1000, 'CSB-AEP v1.0 协议文档非空（' + v1.length + ' 字符）');
  // 五维加权结构
  assert(v1.includes('记忆') && v1.includes('画像'), '协议包含记忆/画像维度');
  assert(v1.includes('碳硅契') || v1.includes('关系'), '协议包含碳硅契/关系维度');
  assert(v1.includes('元认知') || v1.includes('学习'), '协议包含元认知/学习维度');
}

// 2. 评测配置
const configPath = path.join(root, 'config/defaults.json');
assert(fs.existsSync(configPath), '评测配置存在');
if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert(config.defaultTestMode === 'blackbox' || config.defaultTestMode === 'whitebox', '评测模式配置存在');
  assert(config.timeout > 0, '超时配置存在');
  assert(config.maxConcurrent > 0, '并发配置存在');
}

// 3. 评测实现（白盒 host-eval）
const implCandidates = [
  path.join(root, '..', 'skills/csb-agent-eval/host-eval.js'),
  path.join(root, 'host-eval.js'),
  path.join(root, '..', 'csb-agent-eval/host-eval.js')
];
const impl = implCandidates.find(p => fs.existsSync(p));
assert(!!impl, '白盒评测实现 host-eval.js 存在');
if (impl) {
  const src = fs.readFileSync(impl, 'utf8');
  assert(src.includes('记忆系统') || src.includes('memory'), '评测实现包含记忆维度');
  assert(src.includes('碳硅契实践') || src.includes('csb'), '评测实现包含碳硅契维度');
}

// 4. 清单
const checklist = path.join(protoDir, 'csb-agent-eval-protocol/CSB-AEP-checklist-v2.0.md');
if (fs.existsSync(checklist)) {
  assert(fs.statSync(checklist).size > 500, 'checklist v2.0 非空');
} else {
  console.log('ℹ️  checklist v2.0 不在标准路径（不阻断，多版本目录结构差异）');
}

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n✅ 全部通过：csb-aep 评测协议验证成功');
process.exit(0);
