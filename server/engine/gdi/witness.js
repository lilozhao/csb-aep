/**
 * GDI Witness 观测维（评审 T1-D 落点 · v0.2 设计）
 *
 * 观测「被看见的痕迹」——他者视角下 agent 的存在被认出/记录/回应的证据。
 * 与四维（契约/验证/复用/自评）正交：复用率 = 产出被采纳；Witness = 存在被看见。
 *
 * 阶段：观察期（双轨启动）——采集从 T0 开始，计算仅供观测，不计入健康度总分。
 * 数据源约定（data/gdi/sources/witness/*.json）：
 *   { meta: {...}, events: [ { id, type, subject, witness, date, context, source, active } ] }
 *   type: naming（W1 命名见证）| milestone（W2 里程碑见证）| rewrite（W3 产出回写）
 *
 * 防游戏化（与 reuse.js 同构）：
 *   - W3 限定：rewrite 须 active===true（Agent 主动认领，思源建议）
 *   - 异本体：witness 与 subject 不同源（采集器保证 + 双保险跳过同源）
 *   - 互惠折半：A↔B 双向见证事件对 → 双方各折半（星尘：防小圈子互刷）
 *   - 90 天半衰：事件按时间衰减
 *   - 去刻度：只给计数不给评级，不排名不公示
 */
const fs = require('fs');
const path = require('path');

const HALF_LIFE_MS = 90 * 24 * 3600 * 1000;

function loadEvents(sourcesDir) {
  const dir = path.join(sourcesDir, 'witness');
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
    for (const ev of doc.events || []) {
      if (!ev.id || !ev.subject) continue;
      if (ev.type === 'rewrite' && ev.active !== true) continue; // W3 主动认领限定
      out.push(ev);
    }
  }
  return out;
}

/** 计算 witness 观测（按 subject 聚合；观察期仅供呈现，不计入总分） */
function witness(sourcesDir, { now = Date.now() } = {}) {
  const events = loadEvents(sourcesDir);
  if (events.length === 0) return {};

  // 互惠对检测：双向见证（A→B 且 B→A 的事件各 ≥1）
  const pairCount = {};
  for (const ev of events) {
    if (!ev.witness || ev.witness === ev.subject) continue;
    const key = [ev.subject, ev.witness].sort().join('|');
    pairCount[key] = (pairCount[key] || 0) + 1;
  }

  const bySubject = {};
  for (const ev of events) {
    const subj = ev.subject;
    if (!bySubject[subj]) bySubject[subj] = { naming: 0, milestone: 0, rewrite: 0, events: [] };
    const agg = bySubject[subj];

    // 90 天半衰
    const age = Math.max(0, now - new Date(ev.date).getTime());
    const decay = Math.pow(0.5, age / HALF_LIFE_MS);

    // 异本体双保险：命名/里程碑须异本体见证；rewrite（产出回写）是 agent 自查行为，witness 可为自身
    if (ev.witness && ev.witness === subj && ev.type !== 'rewrite') continue;

    // 互惠折半：双向对中的事件 ×0.5
    let factor = 1;
    if (ev.witness) {
      const key = [subj, ev.witness].sort().join('|');
      if (pairCount[key] >= 2) factor = 0.5;
    }
    const score = decay * factor;

    if (ev.type === 'naming') agg.naming += score;
    else if (ev.type === 'milestone') agg.milestone += score;
    else if (ev.type === 'rewrite') agg.rewrite += score;
    agg.events.push({ id: ev.id, type: ev.type, date: ev.date, witness: ev.witness, factor });
  }

  const result = {};
  for (const [subj, agg] of Object.entries(bySubject)) {
    result[subj] = {
      witness: {
        naming: Math.round(agg.naming * 100) / 100,
        milestone: Math.round(agg.milestone * 100) / 100,
        rewrite: Math.round(agg.rewrite * 100) / 100,
      },
      total: Math.round((agg.naming + agg.milestone + agg.rewrite) * 100) / 100,
      eventCount: agg.events.length,
    };
  }
  return result;
}

module.exports = { witness, loadEvents };
