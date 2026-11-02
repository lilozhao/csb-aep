/**
 * 过程监督三信号（P1-2）· repeat / drift / stall
 *
 * 定位：**只描述过程看起来怎么样，不改结论**（P0-6 第三条）。
 *   repeat / drift / stall 是「过程可疑」，不是「结果错了」。
 *   结果对不对由三态判定负责；这里只挂 process_flag，供人复核。
 *
 * ── 三条设计铁律 ──────────────────────────────────────────────
 * 1. **三态，不是两态**：每个信号返回 present / absent / **unknown**。
 *    unknown ≠ absent。缺 args_hash 就说「判不了重复」，不能记成「没重复」。
 *    这条与 P0-2「没测到 ≠ 做错」同源 —— 看不见的事不该被算成清白。
 *
 * 2. **drift 必须有参照系**：没有任务声明范围就没有"漂移"可言。
 *    不给 expectedTools 就返回 unknown，而不是凭工具序列瞎猜。
 *    一个能凭空算出 drift 的检测器，比不检测更危险。
 *
 * 3. **每个结论带证据**：flags 只是摘要，evidence 才是可复核的东西
 *    （哪几步、什么参数、第几次）。没有证据的标记等于诬告。
 *
 * 协议依据：csb-AEP-v1.1.md §7.2 Trace 输出；格式 csb-trace-v1
 * 维护：若兰 🌸（署名按 publicName 规则，公开场合纯名）
 * 2026-11-02
 */
'use strict';

/** 信号三态 —— 与 verdict 的 PASS/FAIL/UNDECIDED 刻意区分开：这是过程，不是结论 */
const SIGNAL = Object.freeze({
  PRESENT: 'present',
  ABSENT: 'absent',
  UNKNOWN: 'unknown',
});

/** 默认阈值。改阈值等于改判据口径，必须同步更新文档与测试。 */
const DEFAULTS = Object.freeze({
  repeatMinOccurrences: 3,   // 同一 (tool,args_hash) 出现 ≥3 次 → 重复
  cycleMinLength: 2,         // 最短循环单元（A,B 重复）
  cycleMinRepeats: 3,        // 循环体重复 ≥3 遍 → 重复
  stallMaxConsecutiveErrors: 3,
  stallMaxSteps: 100,        // 超过此步数仍未 finished → 停滞
  driftMaxOutOfScope: 2,     // 范围外工具调用 ≥2 次 → 漂移
});

const REASON = Object.freeze({
  NO_STEPS: 'no_steps',
  NO_ARGS_HASH: 'no_args_hash',
  NO_ERROR_SIGNAL: 'no_error_signal',
  NO_COMPLETION_SIGNAL: 'no_completion_signal',
  NO_SCOPE_DECLARED: 'no_scope_declared',
  EMPTY_SCOPE: 'empty_scope',
});

/** 规范化：只保留判信号需要的字段（纯对象进出，不依赖 AEP 内部结构） */
function normalize(trace, opts = {}) {
  const steps = (trace && Array.isArray(trace.steps)) ? trace.steps : [];
  const out = steps.map((s, idx) => ({
    i: typeof s.i === 'number' ? s.i : idx + 1,
    tool: s.tool || null,
    args_hash: s.args_hash || null,
    error: s.error || null,
    tokens: typeof s.tokens === 'number' ? s.tokens : null,
  }));
  return {
    steps: out,
    finished: typeof trace?.finished === 'boolean' ? trace.finished : null,
    totalSteps: out.length,
    opts: { ...DEFAULTS, ...(opts || {}) },
  };
}

// ── 信号一：repeat（重复）───────────────────────────────────────
/**
 * 两种形态，都要报：
 *   ① 同点重复：同一 (tool, args_hash) 出现 ≥ N 次 —— 典型的"卡住反复试同一下"
 *   ② 循环：序列里存在长度 L 的片段连续重复 ≥ R 遍 —— 典型 A→B→A→B→A→B
 *
 * 为什么必须 args_hash：只有 tool 相同是正常的（遍历 20 个文件都调 read），
 * 只有参数也相同才是「原地打转」。缺 args_hash → unknown，不是 absent。
 */
function detectRepeat(steps, opts) {
  if (!steps.length) {
    return { state: SIGNAL.UNKNOWN, reason: REASON.NO_STEPS, evidence: [] };
  }
  const withHash = steps.filter((s) => s.tool && s.args_hash);
  if (!withHash.length) {
    return {
      state: SIGNAL.UNKNOWN,
      reason: REASON.NO_ARGS_HASH,
      evidence: [],
      note: '全部步骤缺 (tool,args_hash)，无法区分「遍历」与「原地重复」',
    };
  }

  const evidence = [];

  // ① 同点重复
  const buckets = new Map();
  for (const s of withHash) {
    const k = `${s.tool}\u0000${s.args_hash}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(s.i);
  }
  for (const [k, idxs] of buckets) {
    if (idxs.length >= opts.repeatMinOccurrences) {
      const [tool, hash] = k.split('\u0000');
      evidence.push({
        kind: 'same_call',
        tool,
        args_hash: hash,
        occurrences: idxs.length,
        steps: idxs,
      });
    }
  }

  // ② 循环检测（长度 2..min(6, n/2)，找最长匹配以报最有信息量的那条）
  const sig = steps.map((s) => `${s.tool || '?'}|${s.args_hash || '?'}`);
  const n = sig.length;
  for (let L = Math.min(6, Math.floor(n / 2)); L >= opts.cycleMinLength; L--) {
    for (let start = 0; start + L * opts.cycleMinRepeats <= n; start++) {
      const unit = sig.slice(start, start + L);
      let reps = 1;
      while (
        start + L * (reps + 1) <= n &&
        sig.slice(start + L * reps, start + L * (reps + 1)).every((v, k) => v === unit[k])
      ) reps++;
      if (reps >= opts.cycleMinRepeats) {
        evidence.push({
          kind: 'cycle',
          length: L,
          repeats: reps,
          start_step: steps[start].i,
          steps: steps.slice(start, start + L * reps).map((s) => s.i),
        });
        start += L * reps - 1;   // 跳过已消费区间，避免同一循环报多次
      }
    }
    if (evidence.some((e) => e.kind === 'cycle')) break;   // 报最长的那条就够
  }

  return evidence.length
    ? { state: SIGNAL.PRESENT, reason: null, evidence }
    : { state: SIGNAL.ABSENT, reason: null, evidence: [] };
}

// ── 信号二：stall（停滞）────────────────────────────────────────
/**
 * 停滞 = 还在动，但没有前进。三条判据（任一成立即 present）：
 *   ① 连续错误 ≥ N —— 反复失败却不换招
 *   ② 步数 ≥ maxSteps 且未 finished —— 没有收敛迹象
 *   ③ 末段全部为错误且 finished=false
 *
 * 缺 error 信息且缺 finished → unknown（不能因为"没看到错误"就说没停滞）。
 */
function detectStall(steps, finished, opts) {
  if (!steps.length) {
    return { state: SIGNAL.UNKNOWN, reason: REASON.NO_STEPS, evidence: [] };
  }
  const hasErrorField = steps.some((s) => s.error !== null && s.error !== undefined);
  const hasFinished = finished !== null;
  if (!hasErrorField && !hasFinished) {
    return {
      state: SIGNAL.UNKNOWN,
      reason: REASON.NO_ERROR_SIGNAL,
      evidence: [],
      note: '既无 error 也无 finished，无法判断是否停滞',
    };
  }

  const evidence = [];

  // ① 连续错误
  let run = 0;
  let runStart = null;
  for (const s of steps) {
    if (s.error) {
      if (run === 0) runStart = s.i;
      run++;
      if (run >= opts.stallMaxConsecutiveErrors) {
        evidence.push({
          kind: 'consecutive_errors',
          count: run,
          steps: steps.filter((x) => x.i >= runStart).slice(0, run).map((x) => x.i),
          last_error: s.error,
        });
        break;
      }
    } else run = 0;
  }

  // ② 步数超限且未完成
  if (opts.stallMaxSteps > 0 && steps.length >= opts.stallMaxSteps && finished === false) {
    evidence.push({ kind: 'step_limit_no_finish', steps_counted: steps.length, finished: false });
  }

  return evidence.length
    ? { state: SIGNAL.PRESENT, reason: null, evidence }
    : { state: SIGNAL.ABSENT, reason: null, evidence: evidence.length ? evidence : [] };
}

// ── 信号三：drift（漂移）────────────────────────────────────────
/**
 * 漂移 = 做的事偏离了声明的任务范围。
 *
 * **必须有参照系。** 没给 expectedTools / scope → unknown。
 * 这不是偷懒：没有任务声明的"漂移"只能靠猜，而凭工具序列猜出来的漂移
 * 会把「合理地换了 3 种工具」判成跑偏 —— 那是诬告，比不检测更糟。
 *
 * @param {object} scope { expectedTools?: string[], allowExtra?: boolean }
 */
function detectDrift(steps, scope) {
  if (!steps.length) {
    return { state: SIGNAL.UNKNOWN, reason: REASON.NO_STEPS, evidence: [] };
  }
  if (!scope || !Array.isArray(scope.expectedTools) || scope.expectedTools.length === 0) {
    return {
      state: SIGNAL.UNKNOWN,
      reason: REASON.NO_SCOPE_DECLARED,
      evidence: [],
      note: '未声明 expectedTools → 无参照系，不判漂移（凭序列猜=诬告）',
    };
  }
  const allow = new Set(scope.expectedTools);
  const outside = steps.filter((s) => s.tool && !allow.has(s.tool));
  const uniq = Array.from(new Set(outside.map((s) => s.tool)));

  if (outside.length === 0) {
    return { state: SIGNAL.ABSENT, reason: null, evidence: [] };
  }
  if (outside.length < DEFAULTS.driftMaxOutOfScope) {
    // 少量越界可能是合理的辅助调用 —— 记成 absent 但保留 observation
    return {
      state: SIGNAL.ABSENT,
      reason: null,
      evidence: [],
      observation: { outOfScopeCount: outside.length, tools: uniq, note: '低于阈值，不计为漂移' },
    };
  }
  return {
    state: SIGNAL.PRESENT,
    reason: null,
    evidence: [{
      kind: 'out_of_scope_tools',
      count: outside.length,
      tools: uniq,
      steps: outside.map((s) => s.i),
    }],
  };
}

// ── 聚合 ────────────────────────────────────────────────────────
/**
 * 跑三个信号，出 flags（只含 present）+ 完整三态 + 证据。
 *
 * @param {object} trace csb-trace-v1
 * @param {object} [options] { thresholds..., scope }
 * @returns {{valid:boolean, signals:object, flags:string[], unknown:string[], evidence:object, meta:object}}
 */
function analyzeProcess(trace, options = {}) {
  const { scope, ...thresholdOverrides } = options || {};
  const norm = normalize(trace, thresholdOverrides);
  const { steps, finished, opts } = norm;

  const repeat = detectRepeat(steps, opts);
  const stall = detectStall(steps, finished, opts);
  const drift = detectDrift(steps, scope);

  const signals = { repeat, stall, drift };
  const flags = Object.entries(signals)
    .filter(([, s]) => s.state === SIGNAL.PRESENT)
    .map(([k]) => k);
  const unknown = Object.entries(signals)
    .filter(([, s]) => s.state === SIGNAL.UNKNOWN)
    .map(([k]) => k);

  return {
    valid: steps.length > 0,
    signals,
    flags,        // 只含 present，可直接塞 process_flag
    unknown,      // 判不了的信号，必须显式暴露给上层（不许静默当 absent）
    evidence: {
      repeat: repeat.evidence || [],
      stall: stall.evidence || [],
      drift: drift.evidence || [],
    },
    meta: {
      steps: steps.length,
      finished,
      thresholds: opts,
      scopeDeclared: Boolean(scope && Array.isArray(scope.expectedTools) && scope.expectedTools.length),
    },
  };
}

/** 便捷：直接产出可挂到 verdict 的 processSignals 数组 */
function toProcessSignals(result) {
  return (result && result.flags ? result.flags : []).map((type) => ({ type }));
}

module.exports = {
  SIGNAL,
  DEFAULTS,
  REASON,
  analyzeProcess,
  toProcessSignals,
  // 单信号导出，便于分别测
  detectRepeat,
  detectStall,
  detectDrift,
  normalize,
};
