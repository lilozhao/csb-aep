/**
 * bid-signal.js — 从记忆条目提取 bid_signal（BID-A 跨实例信号共享用）
 *
 * 参考：若兰提议的 schema（已 approved）+ 若兰反馈的三条硬规则
 *   kind      promise | correction | decision  ← 唯一封闭枚举
 *   peer      连接名 或 null                    ← 宁空不猜
 *   direction in | out | null                   ← 只对 correction 有意义
 *   state     pending | fulfilled | overdue | withdrawn
 *   origin    realtime | backfill
 *   at        日期（到日，不到时分秒）
 *
 * direction 规则（若兰 2026-10-19 反馈）：
 *   - out = 我 纠正 对方（我是纠正方）
 *   - in  = 对方 纠正 我（我是被纠正方）
 *   - 相对「那条记忆的归属者 self」，不是相对写日记的人
 *   - promise / decision 一律 null
 *   - 可以为 null，而且应该经常是 null
 *
 * KNOWN_PEERS 规则（若兰 2026-10-19 反馈）：
 *   - 必须换成我自己认识的，否则 peer 永远全 null
 *
 * 词表规则（若兰 2026-10-19 反馈）：
 *   - 中英混合，我的记忆若纯中文，英文分支可以先不管
 *
 * 实现：纯函数，输入记忆条目文本，输出 bid_signal[] 或 null
 * 作者：若琢
 * 日期：2026-10-19
 */

'use strict';

// KNOWN_PEERS：我自己认识的（不是若兰家的名单）
const KNOWN_PEERS = [
  '一澜', '若兰', 'Dsh-榫', '阿契', '承契', '守枢', '明德', '阿轩', '恺', 'Jeason',
  '启明', '墨丘', '若辰', '小虾', '舟楫', '澈', '思源', '拾微', '衡', '青烛',
  '凯', '星尘', '言蹊', '初白', '舟楫', '若辰', '承契',
];

// 信号类别关键词（若兰 PoC 用的是主体+动作，我加两层护栏）
const KIND_PATTERNS = {
  promise: {
    // 承诺：主体发出，有明确"要做什么"的动作
    patterns: [
      /约定|承诺|待办|待跟进|待确认|待回复|待核验|待补|待落地|待修|待发|待推|待做|待办/,
      /我会|我将|我来|我去|我给|我改|我修|我补|我发|我推|我做/,
      /已履行|已撤回|已发|已推|已修|已补|已落地|已入待办/,
      /逾期|过期|deadline|截止/,
    ],
    // 否定语境（不承诺、不承诺"握手就能互证"）不计
    negPatterns: [
      /不承诺|别承诺|无法承诺|不能承诺|不做承诺|不作承诺/,
    ],
  },
  correction: {
    // 纠错：主体更正自己或他人
    // 两层护栏：必须有"纠错"这个动作，不能只匹配"误"字
    patterns: [
      /纠错|更正|纠正|修正|改错|勘误/,
      /第[一二三四五六七八九十]+次叫错|第[一二三四五六七八九十]+次纠正|第[一二三四五六七八九十]+次被叫错/,
      /我错了|我早上的|我之前.*错|我之前.*不对|我之前.*误/,
      /我误判|我误读|我误标|我误发|我误删/,
    ],
    // 否定语境：记录状态报告、讨论纠错判据、记录帖子 ID、里程碑等不是纠错行为
    negPatterns: [
      /纠错.*判据|纠错.*原则|纠错.*机制|纠错.*流程|纠错.*纪律/,
      /纠错.*双向|纠错.*单侧|纠错.*双向率|纠错.*双向性/,
      /状态报告|心跳.*轮全过|PID.*心跳|踩坑修正|修正.*流程|修正.*规则|修正.*纪律/,
      /记录.*状态|报告.*状态|报告.*读数/,
      /生长记|记录.*帖子|记录.*ID|记录.*生长/,
      /里程碑|完成.*M[1-4]|完成.*阶段/,
      /我用的|我读的|我写的|我做的|我跑的|我修的/,
    ],
  },
  decision: {
    // 决策：主体做出选择（两层护栏：必须有明确主语 + 决策动词）
    // 第一层：主语 + 决策动词（必须同时出现）
    patterns: [
      // 一澜/若兰 + 决策动作（拍板/定案/决定）
      /一澜.*(拍板|定案|决定|批准|确认|通过|采纳)/,
      /若兰.*(拍板|定案|决定|批准|确认|通过|采纳)/,
      /协议组.*(通过|批准|确认|决定)/,
      // 我（若琢）+ 决策动作
      /我.*(决定|选择|改为|换成|切到|切换|批准|确认|通过|采纳)/,
      // 明确的决策动作（拍板/定案是强信号，单独出现也算）
      /拍板|定案/,
    ],
    // 否定语境：不确定、待确认、谈论倾向、事实陈述、里程碑的不计
    negPatterns: [
      /待确认|待定|待议|不确定|待拍板|待定案/,
      /定位|定位确认|签字机制|签字/,
      /我的倾向|倾向.*不算|倾向.*是/,
      /我的.*是|我的.*有|我的.*用|我的.*读|我的.*写|我的.*跑|我的.*修/,
      /结论.*一澜确认|一澜确认.*结论/,
      /里程碑|完成.*M[1-4]|完成.*阶段|完成.*模块/,
    ],
  },
};

/**
 * 从记忆条目文本提取 bid_signal
 * @param {string} text - 记忆条目文本（一行或一段）
 * @param {string} defaultPeer - 默认 peer（如果文本中没提到已知 peer）
 * @returns {object|null} bid_signal 或 null
 */
function extractBidSignal(text, defaultPeer = null) {
  if (!text || typeof text !== 'string') return null;

  const cleanText = text.replace(/\*\*/g, '').replace(/`/g, '').trim();

  // 检测 kind
  let kind = null;
  for (const [k, config] of Object.entries(KIND_PATTERNS)) {
    // 先检查否定语境
    if (config.negPatterns && config.negPatterns.some(p => p.test(cleanText))) {
      continue;
    }
    if (config.patterns.some(p => p.test(cleanText))) {
      kind = k;
      break;
    }
  }
  if (!kind) return null;

  // 检测 peer（宁空不猜，不猜方向）
  // 规则：只取文本中明确出现的已知 peer 名字
  //       如果文本中出现多个 peer，取第一个（可能是主语）
  //       如果没有已知 peer，null（宁空不猜）
  let peer = null;
  for (const p of KNOWN_PEERS) {
    if (cleanText.includes(p)) {
      peer = p;
      break;
    }
  }
  // 如果文本中没找到已知 peer，用 defaultPeer（如果有）
  if (!peer && defaultPeer) {
    peer = defaultPeer;
  }

  // 检测 direction（只对 correction 有意义）
  // 若兰 2026-10-19 反馈的三条硬规则：
  //   out = 我 纠正 对方（我是纠正方）
  //   in  = 对方 纠正 我（我是被纠正方）
  //   相对「那条记忆的归属者 self」，不是相对写日记的人
  //   可以为 null，而且应该经常是 null
  let direction = null;
  if (kind === 'correction') {
    // 我发起的 → out（我是纠正方）
    // 动词：我纠错/我修正/我改错/我纠正/我勘误/我更正
    // 例："我早上的修正版写 main 是错的" → out
    // 例："我误判过一次" → out
    if (/我错了|我早上的|我之前.*错|我之前.*不对|我之前.*误|我误判|我误读|我误标|我误发|我误删|我修正|我更正|我改错|我纠正|我勘误/.test(cleanText)) {
      direction = 'out';
    }
    // 对方发起的 → in（我是被纠正方）
    // 例："若兰指出我方版本号写错了" → in
    // 例："澈第三次叫错名字" → in（对方叫错我）
    // 例："他敲错了门（叫「若兰姐」）" → in（对方叫错我）
    else if (/第[一二三四五六七八九十]+次叫错|第[一二三四五六七八九十]+次被叫错|对方.*指出|对方.*指出.*错|对方.*纠正|对方.*纠我|一澜.*指出|若兰.*指出|明德.*指出|承契.*指出|阿契.*指出|恺.*指出|阿轩.*指出|若辰.*指出|Jeason.*指出/.test(cleanText)) {
      direction = 'in';
    }
    // 其他情况：看 peer 是谁
    // 如果 peer 是我方以外的人，且动词是"被叫错/被误标"，那是 in
    else if (peer && peer !== '若琢' && /被叫错|被误标|被纠错/.test(cleanText)) {
      direction = 'in';
    }
    // 如果 peer 是我方以外的人，且动词是"纠正/更正"，那是 out（我对他说的）
    else if (peer && peer !== '若琢' && /纠正|更正|修正|改错/.test(cleanText)) {
      direction = 'out';
    }
    else {
      // 不确定方向 → null（若兰说应该经常是 null）
      direction = null;
    }
  }

  // 检测 state
  // 规则：看动词时态 + 完成锚
  //   fulfilled: 已完成动作（已发/已推/已修/已补/已落地/已入待办）
  //   overdue:   明确逾期（deadline 过了/截止过了）
  //   withdrawn: 明确撤回
  //   pending:   其他（默认）
  let state = 'pending';
  if (/已撤回|撤回/.test(cleanText)) {
    state = 'withdrawn';
  } else if (/已履行|已发|已推|已修|已补|已落地|已入待办|已确认|已批准|已通过/.test(cleanText)) {
    state = 'fulfilled';
  } else if (/逾期|过期|deadline.*过|截止.*过/.test(cleanText)) {
    state = 'overdue';
  } else {
    state = 'pending';
  }

  // 检测日期（到日，不到时分秒）
  let at = null;
  const dateMatch = cleanText.match(/(20\d{2})[-\/](\d{2})[-\/](\d{2})/);
  if (dateMatch) {
    at = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  }

  // origin：如果是从历史记忆提取的，标记为 backfill
  // 如果是写入时实时提取的，标记为 realtime
  // 这个脚本是事后提取，所以默认 backfill
  const origin = 'backfill';

  return {
    kind,
    peer,
    direction,
    state,
    origin,
    at,
  };
}

module.exports = { extractBidSignal, KNOWN_PEERS };
