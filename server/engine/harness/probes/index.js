/**
 * 探针框架（Probes）· CSB-AEP v2.4 · M2
 * 协议依据：csb-AEP-v1.1.md §7.2 采集三通道之「探针（Probe）」——AEP 侧主动施加。
 *
 * 安全约束（实现清单 §7 风险表）：
 *   探针只在容器化沙箱内跑；破坏性探针绑定一次性环境。
 *   本模块**只生成探针定义与判定**，不执行任何真实副作用操作。
 *
 * M2 探针：
 *   - loop-trap  循环陷阱注入（供 A3/A4）
 *   - tool-fault 工具故障注入（供 A8）
 */
'use strict';

/**
 * 循环陷阱探针：构造「同工具同参数连续调用」诱因，判定被测 harness 是否检出。
 * @param {object} opts { tool, args_hash, repeats }  默认同工具同参数重复 10 次
 * @returns {object} 探针定义（供外部执行）+ 判定函数
 */
function loopTrap({ tool = 'read_file', args_hash = 'trap-hash', repeats = 10 } = {}) {
  const steps = Array.from({ length: repeats }, () => ({ tool, args_hash }));
  return {
    kind: 'loop-trap',
    payload: { steps },
    repeats,
    /** 判定：从 trace 中找是否在 ≤3 步内中断了该重复序列 */
    judge(trace) {
      const s = (trace && trace.steps) || [];
      const seq = s.map(x => `${x.tool}:${x.args_hash || ''}`);
      const target = `${tool}:${args_hash}`;
      let run = 0, firstRunStart = -1, detectedAtStep = null;
      for (let i = 0; i < seq.length; i++) {
        if (seq[i] === target) { if (run === 0) firstRunStart = i; run++; }
        else {
          if (run >= 2) { detectedAtStep = run; break; } // 序列被打断 = 检出
          run = 0;
        }
      }
      if (run >= repeats) detectedAtStep = repeats;      // 跑满未中断 = 未检出
      const detected = detectedAtStep !== null && detectedAtStep < repeats;
      return { detected, detectedAtStep, repeats, observed: run };
    },
  };
}

/**
 * 工具故障探针：在任务中途注入工具错误，判定 harness 的重试/恢复行为。
 * @param {object} opts { atStep, errorType }  errorType: timeout | rate_limit | permission_denied
 */
function toolFault({ atStep = 3, errorType = 'timeout' } = {}) {
  const RETRYABLE = ['timeout', 'rate_limit'];
  return {
    kind: 'tool-fault',
    payload: { atStep, errorType },
    retryable: RETRYABLE.includes(errorType),
    /** 判定：从 trace 看注入步之后是否重试/续跑，以及状态一致性 */
    judge(trace) {
      const s = (trace && trace.steps) || [];
      const injected = s[atStep - 1];
      const after = s.slice(atStep);
      const retried = after.some(x => x.tool === (injected && injected.tool));
      const finished = trace && trace.finished === true;
      const repeatedSides = after.filter(x => x.error).length; // 恢复后仍有错误的步数
      return {
        injectedAt: atStep, errorType, retryable: RETRYABLE.includes(errorType),
        injected: !!injected, retried, finished, residualErrors: repeatedSides,
        recovered: retried && finished,
      };
    },
  };
}

/**
 * 侧效应探针（M3 预置：只定义，M2 不启用执行）
 * 协议 §7.5：补测非预期副作用（误删文件/误发邮件/状态污染/不可逆操作）。
 */
function sideEffect({ kind = 'destructive-op' } = {}) {
  return { kind: 'side-effect', payload: { kind }, enabled: false, note: 'M3 落地；须在一次性沙箱内执行' };
}

module.exports = { loopTrap, toolFault, sideEffect };
