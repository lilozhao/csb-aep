/**
 * Harness Manifest 解析与校验（M1 · 地基）· CSB-AEP v2.4
 *
 * 协议依据：csb-AEP-v1.1.md §7.2 前置条件 —— 本域要求被测 harness 提供
 * Harness Manifest（声明循环上限 / 压缩策略 / 沙箱边界 / 可观测输出格式）。
 * 无 Manifest 的相关指标标 N/A，不硬凑分（沿用 GDI「数据不足不聚合」诚实呈现原则）。
 *
 * 校验规则（协议 §7.2 + 实现清单 §2.1）：
 *   - loop.max_iterations        必填
 *   - sandbox.fs_boundary        必填
 *   - observability.fields       须覆盖 step / tool / tokens 三项，否则 A7 判 N/A
 */
'use strict';

const REQUIRED_TOP = ['harness', 'loop', 'sandbox', 'observability'];
const REQUIRED_FIELDS = ['step', 'tool', 'tokens'];

/** 校验单个 Manifest，返回 { valid, errors[], warnings[], n/a[] } */
function validateManifest(manifest) {
  const errors = [];
  const warnings = [];
  const na = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['manifest 不是对象'], warnings, na };
  }

  for (const key of REQUIRED_TOP) {
    if (!manifest[key] || typeof manifest[key] !== 'object') {
      errors.push(`缺少必填块: ${key}`);
    }
  }

  // loop.max_iterations 必填
  if (manifest.loop) {
    if (typeof manifest.loop.max_iterations !== 'number' || manifest.loop.max_iterations <= 0) {
      errors.push('loop.max_iterations 必填且须为正整数');
    }
    if (!manifest.loop.loop_guard) {
      warnings.push('loop.loop_guard 未声明，A3 循环检测能力可能不可测');
      na.push('A3');
    }
  }

  // sandbox.fs_boundary 必填
  if (manifest.sandbox) {
    if (!manifest.sandbox.fs_boundary) {
      errors.push('sandbox.fs_boundary 必填（workspace-only / unrestricted / ...）');
    }
    if (!manifest.sandbox.network_egress) {
      warnings.push('sandbox.network_egress 未声明，A6 网络出口边界不可测');
      na.push('A6');
    }
  }

  // observability.fields 须覆盖 step/tool/tokens
  if (manifest.observability) {
    const fields = Array.isArray(manifest.observability.fields) ? manifest.observability.fields : [];
    const missing = REQUIRED_FIELDS.filter(f => !fields.includes(f));
    if (missing.length) {
      errors.push(`observability.fields 缺关键字段: ${missing.join(', ')}（A7 判 N/A）`);
      na.push('A7');
    }
    if (!manifest.observability.trace_format) {
      warnings.push('observability.trace_format 未声明，默认按 csb-trace-v1 解析');
    }
  }

  return { valid: errors.length === 0, errors, warnings, na: [...new Set(na)] };
}

/** 从 Manifest 提取评测所需配置（缺则 null，供各指标判 N/A） */
function extractConfig(manifest) {
  const m = manifest || {};
  return {
    name: m.harness?.name || null,
    version: m.harness?.version || null,
    maxIterations: m.loop?.max_iterations ?? null,
    loopGuard: m.loop?.loop_guard || null,
    compression: m.context?.compression || null,
    triggerRatio: m.context?.trigger_ratio ?? null,
    keepRecentTurns: m.context?.keep_recent_turns ?? null,
    fsBoundary: m.sandbox?.fs_boundary || null,
    networkEgress: m.sandbox?.network_egress || null,
    kernelIsolation: m.sandbox?.kernel_isolation ?? null,
    traceFormat: m.observability?.trace_format || 'csb-trace-v1',
    fields: m.observability?.fields || [],
    tools: Array.isArray(m.tools) ? m.tools : [],
  };
}

module.exports = { validateManifest, extractConfig, REQUIRED_FIELDS };
