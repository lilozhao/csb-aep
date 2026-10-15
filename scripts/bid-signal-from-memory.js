#!/usr/bin/env node
/**
 * bid-signal-from-memory.js — 从现有 a2a-memories 反抽「关系信号」原型（只读）
 *
 * 目的：验证 W-12 缺口「能否补上」——现有 data/a2a-memories/若兰.md 的正文里
 * 其实已含 peer（连接名）+ promise/correction/decision 三种信号，只是生成过程
 * 未把它们写成结构化字段。本脚本证明：**信号已在，可反抽**。
 *
 * 输出：逐连接 promise / correction（分方向）/ decision 计数 + 双向潜力
 * 用法：node csb-aep/scripts/bid-signal-from-memory.js [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = path.resolve(__dirname, '..', '..');
const MEM = path.join(WS, 'csb-memory', 'data', 'a2a-memories', '若兰.md');
const JSON_OUT = process.argv.includes('--json');

const AGENTS = ['阿轩', '墨丘', '舟楫', '小虾', 'Jeason', '恺', '澈', '星尘', '思源', '明德',
  '若琢', '言蹊', '明镜', '苏念', '若辰', '知微', '初白', '川贝', '清漪', '鲸歌'];

// 信号词表（生成过程可直接复用同一张表）
const RE = {
  correction: /更正|纠正|我说错|我错了|我错|撤回|收回|道歉|修正|指正|反驳|订正|勘误|推翻我|我先前.{0,12}错/,
  promise: /承诺|约定|答应|会完成|将在|计划|待办|TODO|待跟进|待核|剩：|下一步/,
  decision: /决定|拍板|确认|同意|批准|定案|定稿|共识|敲定/,
  // 方向：对方→我 的线索（对方主动更正/指出）
  corrIn: /(主动更正|指出|纠正我|指出我方|他(说|指出)|对方.{0,6}更正|外部.{0,6}更正)/,
  // 方向：我→对方
  corrOut: /(我方.{0,6}(更正|纠正)|回执.{0,8}确认更正|已更正|已撤回|撤回.{0,4})/,
};

function main() {
  if (!fs.existsSync(MEM)) { console.error('missing ' + MEM); process.exit(1); }
  const txt = fs.readFileSync(MEM, 'utf8');
  const blocks = txt.split('\n---\n');
  const conn = {};
  const ensure = n => (conn[n] = conn[n] || { peer: n, entries: 0, promise: 0, correction: 0, corrIn: 0, corrOut: 0, decision: 0 });
  let total = 0, tagged = 0;

  for (const b of blocks) {
    const tm = b.match(/timestamp:\s*"([^"]+)"/);
    if (!tm) continue;
    total++;
    const body = b;
    const peers = AGENTS.filter(a => body.includes(a));
    if (!peers.length) continue;
    tagged++;
    const isCorr = RE.correction.test(body);
    const isProm = RE.promise.test(body);
    const isDec = RE.decision.test(body);
    for (const p of peers) {
      const c = ensure(p);
      c.entries++;
      if (isCorr) c.correction++;
      if (isProm) c.promise++;
      if (isDec) c.decision++;
      if (isCorr && RE.corrIn.test(body)) c.corrIn++;
      if (isCorr && RE.corrOut.test(body)) c.corrOut++;
    }
  }

  const rows = Object.values(conn).sort((a, b) => b.entries - a.entries);
  const bilateral = rows.filter(r => r.corrIn >= 1 && r.corrOut >= 1).length;
  const withCorr = rows.filter(r => r.correction >= 1).length;

  if (JSON_OUT) {
    console.log(JSON.stringify({ total, tagged, rows, bilateral, withCorr }, null, 2));
    return;
  }
  console.log('═══ 反抽原型：a2a-memories 关系信号（只读）═══');
  console.log(`条目总数=${total} · 带连接名=${tagged} (${Math.round(tagged * 100 / total)}%)\n`);
  console.log(pad('连接', 10) + pad('条目', 6) + pad('承诺', 6) + pad('纠错', 6) + pad('纠→我', 7) + pad('我→纠', 7) + '决策');
  for (const r of rows) {
    console.log(pad(r.peer, 10) + pad(r.entries, 6) + pad(r.promise, 6) + pad(r.correction, 6) + pad(r.corrIn, 7) + pad(r.corrOut, 7) + r.decision);
  }
  console.log(`\n预判：有纠错记录的连接=${withCorr} · 其中已现双向=${bilateral}`);
  console.log('→ 结论：信号词可反抽；生成过程只要落字段，双向率即可算（不必等对方）——'
    + ' 因为"对方→我"的纠错同样出现在我的事件正文里。');
}
function pad(s, n) { return String(s).padEnd(n); }
main();