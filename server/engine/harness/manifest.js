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

/**
 * identity.json 的 aep 用的是「实况口径」（loop_limits / compaction / sandbox / trace），
 * 与本引擎的 Manifest 口径（loop / context / sandbox / observability）不同名。
 * 这里只做**字段改名 + 显式空值**，不做推断：
 *   - 取值不存在 → null（N/A），不拿相近字段冒充
 *   - 例如 loop_limits.max_iterations 本机就是 null（配置面无此键）→ 保持 null
 */
function mapAepShape(aep, card, hm) {
  const out = {};
  if (!aep || typeof aep !== 'object') return out;

  out.harness = aep.harness || { name: card?.name || null, version: (hm && hm.version) || null };

  if (aep.loop) out.loop = aep.loop;
  else if (aep.loop_limits && typeof aep.loop_limits === 'object') {
    const ll = aep.loop_limits;
    out.loop = {
      max_iterations: typeof ll.max_iterations === 'number' ? ll.max_iterations : null,
      loop_guard: ll.loop_detection && ll.loop_detection.enabled === true ? 'loop-detection' : null,
    };
  }

  if (aep.context) out.context = aep.context;
  else if (aep.compaction && typeof aep.compaction === 'object') {
    const cp = aep.compaction;
    out.context = {
      compression: cp.mode || null,
      trigger_ratio: typeof cp.trigger_threshold === 'number' ? cp.trigger_threshold : null,
      keep_recent_turns: typeof cp.recentTurnsPreserve === 'number' ? cp.recentTurnsPreserve : null,
    };
  }

  if (aep.sandbox && typeof aep.sandbox === 'object') {
    out.sandbox = {
      ...aep.sandbox,
      // 只认 fs_workspace_only===true 这一条机械证据；其余不猜
      fs_boundary: aep.sandbox.fs_boundary || (aep.sandbox.fs_workspace_only === true ? 'workspace-only' : null),
    };
  }

  if (aep.observability) out.observability = aep.observability;
  else if (aep.trace && typeof aep.trace === 'object') {
    out.observability = {
      trace_format: aep.trace.format || null,
      // 字段名不改写：映射不了 step/tool/tokens 就让它 N/A（诚实呈现）
      fields: Array.isArray(aep.trace.fields) ? aep.trace.fields : [],
    };
  }

  return out;
}

/**
 * 从 A2A Agent Card 取出 §7.2 参数面（P0-3 · manifest 消费侧）
 *
 * 写入侧（csb-a2a-aip `6cebf26`）把「件构成」放在 `harness_manifest.components/skills/plugins`，
 * 把「跑起来的参数」放在 `harness_manifest.aep`。两套口径不能互相顶替：
 *   - 只有 `aep` 能当 Manifest 用（loop/sandbox/observability 在这里）
 *   - `skills/plugins/experience_ref` 是**对照用的声明**，不是评测数据 → 不能靠它硬凑分
 *
 * @param {Object} card Agent Card
 * @returns {{manifest: Object|null, skills: Array, plugins: Array, experienceRef: string|null, source: string}}
 */
function fromAgentCard(card) {
  const hm = card && (card.harness_manifest || card.harnessManifest);
  if (!hm || typeof hm !== 'object') {
    return { manifest: null, skills: [], plugins: [], experienceRef: null, source: 'absent' };
  }
  const aep = (hm.aep && typeof hm.aep === 'object' && !Array.isArray(hm.aep)) ? hm.aep : null;
  // 兼容：调用方直接给参数面（无 aep 包装）
  const bare = (!aep && (hm.loop || hm.sandbox || hm.observability)) ? hm : null;
  const manifest = aep ? mapAepShape(aep, card, hm) : bare;
  const list = (x) => Array.isArray(x) ? x.filter(i => i && i.name) : [];
  return {
    manifest,
    skills: list(hm.skills),
    plugins: list(hm.plugins),
    experienceRef: card.experience_ref || hm.experience_ref || null,
    source: aep ? 'harness_manifest.aep' : (bare ? 'harness_manifest' : 'absent'),
  };
}

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
    // P0-3：Agent Card 声明面（只作对照，缺则空数组，不猜）
    skills: Array.isArray(m.skills) ? m.skills.filter(i => i && i.name) : [],
    plugins: Array.isArray(m.plugins) ? m.plugins.filter(i => i && i.name) : [],
    experienceRef: m.experience_ref || m.experienceRef || null,
    manifestSource: m.__source || null,
  };
}

module.exports = { validateManifest, extractConfig, fromAgentCard, REQUIRED_FIELDS };
