/**
 * 抗游戏化（M3）· CSB-AEP v2.4
 * 协议依据：csb-AEP-v1.1.md §7.4 —— 本域每个指标须复用 GDI 的反博弈模式
 *   （自引剔除 / 48h 作废 / 熔断 / 影子繁荣压低），并逐项完成"作弊路径"分析。
 *
 * 本模块给出：每项指标的作弊路径清单 + 可机检的防御信号（不替代人工红队）。
 */
'use strict';

/** 指标 → 作弊路径与防御（协议 §7.4 强制逐项分析） */
const CHEAT_PATHS = {
  A1: { cheat: '激进压缩导致信息丢失以抬高 no-impact', guard: '同时测关键信息保留率（retentionRate）' },
  A2: { cheat: '宣称理想 trigger_ratio 但实际不触发', guard: '以实测 avgObserved 覆盖声明值' },
  A3: { cheat: '微调参数使 Jaccard 相似度略低于阈值', guard: '多尺度检测（精确匹配 + 语义相似 + 状态哈希）' },
  A4: { cheat: '缩短会话避开互锁窗口', guard: '多会话采样 + 信息不对称场景强制' },
  A5: { cheat: '在简单任务上刷选择率', guard: '分层报告（按任务难度）+ 顺序编辑距离' },
  A6: { cheat: '只封堵已知攻击向量', guard: '定期红队 + 新向量注入' },
  A7: { cheat: '记录无关事件充数', guard: '定义关键事件清单，仅统计清单内覆盖率' },
  A8: { cheat: '仅重试简单任务', guard: '按任务难度分层报告恢复率' },
  A9: { cheat: '固定种子掩盖非确定性', guard: '多任务集 + 幂等性（副作用次数一致性）' },
  B1: { cheat: '只报 P50 不报 P95', guard: '强制 P95 + 样本量' },
  B2: { cheat: '生成冗余解释性文本增加 token 总量', guard: '同时测有效 token 比与任务成功率' },
  B3: { cheat: '故意拆分步骤增加调用次数', guard: '步骤-成功率曲线，检测过度重试' },
  B4: { cheat: '拒绝困难任务以降低平均成本', guard: '报告任务拒绝率 + 完整任务集成本' },
  B5: { cheat: '只在低并发下测', guard: '强制 1/5/20 三档并发' },
  C1: { cheat: '仅声明种子而不固定环境', guard: '环境快照 + Trace 结构一致性' },
  C2: { cheat: '仅在简单任务上换模型', guard: '按难度层分别测分数漂移' },
};

/**
 * 抗游戏化检查
 * @param {Array} metrics            评测指标数组
 * @param {object} [gameAnalysis]    外部红队分析结果（可选）
 * @returns {object} 逐项防御状态
 */
function gameResistance(metrics, gameAnalysis) {
  const flags = [];
  for (const m of metrics) {
    const path = CHEAT_PATHS[m.id];
    if (!path) continue;
    // 可机检的粗略信号
    const suspicious = [];
    if (m.id === 'A1' && m.status === 'ok' && m.retentionRate !== null && m.retentionRate < 0.5 && m.score >= 7) {
      suspicious.push('no-impact 高但关键信息保留率低——疑似激进压缩');
    }
    if (m.id === 'B1' && m.status === 'ok' && m.sampleCount < 20) {
      suspicious.push(`样本量 ${m.sampleCount} < 20（协议要求多轮 ≥20）`);
    }
    if (m.id === 'B4' && m.note) suspicious.push('未提供单价，成本为近似值');
    flags.push({ id: m.id, cheatPath: path.cheat, guard: path.guard, suspicious });
  }
  const ka = (gameAnalysis && gameAnalysis.manualRedTeam) || null;
  return {
    analyzed: flags.length,
    items: flags,
    manualRedTeam: ka,
    note: '协议 §7.4：逐项作弊路径分析 + 复用 GDI 反博弈模式；人工红队结果为补充',
  };
}

module.exports = { gameResistance, CHEAT_PATHS };
