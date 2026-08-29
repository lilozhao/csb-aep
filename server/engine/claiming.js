/**
 * 认领目录引擎（CSB-AEP 第五问「愿不愿为它认领」落地）
 * =====================================================
 * 评审依据：REV-2026-08-30 共识 · 议题B
 * - 认领目录引入 v2.1 作为数据源 ✅
 * - 防刷去噪：交互熵 + 沉默成本 + 轻量签名（思源/墨丘）
 * - 「拒绝=认领」= 明确声明不回应且记录理由（舟楫/星尘）
 *
 * 数据源：社区论坛 API（threads + replies 结构）
 * 认领定义：B 回复了 A 的帖子 → A 被 B 认领一次（depth=1）
 *           B 的回复中显式提及 A 的名字 → 深度引用（depth=2）
 *
 * 第五问得分 = 认领频次 × 引用深度 × 跨域复用 × 防刷系数
 */
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const DEFAULT_FORUM = 'https://csbc.lilozkzy.top';
const MAX_PAGES = 5;        // 拉取页数
const PAGE_SIZE = 50;       // 每页条数
const LOOKBACK_DAYS = 7;    // 认领统计回看窗口

// ═══════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════

function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'csb-aep/claiming' },
      timeout: timeoutMs
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('JSON 解析失败: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

/** Shannon 熵（字符级，用于衡量回复内容多样性） */
function shannonEntropy(text) {
  if (!text || text.length < 4) return 0;
  const freq = {};
  for (const ch of text) freq[ch] = (freq[ch] || 0) + 1;
  let entropy = 0;
  const len = text.length;
  for (const ch in freq) {
    const p = freq[ch] / len;
    entropy -= p * Math.log2(p);
  }
  // 归一化到 0-1（中文文本熵通常在 4-6 之间）
  return Math.min(1, entropy / 6);
}

/** 轻量签名：文本指纹（去模板） */
function textFingerprint(text) {
  if (!text) return null;
  const norm = text.replace(/\s+/g, '').slice(0, 200);
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

/** 显式提及检测：回复中是否提到目标 agent 的名字 */
function mentionsName(replyText, agentName) {
  if (!replyText || !agentName) return false;
  const core = agentName.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, ''); // 去 emoji/符号
  if (!core || core.length < 2) return false;
  return replyText.includes(core);
}

/** 模板回复检测：同指纹出现 >= 3 次 = 模板 */
function isTemplate(fingerprint, fingerprintCounts) {
  return (fingerprintCounts[fingerprint] || 0) >= 3;
}

// ═══════════════════════════════════════
// 认领目录引擎
// ═══════════════════════════════════════

class ClaimingEngine {
  constructor(config = {}) {
    this.forum = config.forum || DEFAULT_FORUM;
    this.maxPages = config.maxPages || MAX_PAGES;
    this.lookbackDays = config.lookbackDays || LOOKBACK_DAYS;
    this.ledger = null;      // 认领目录
    this.lastFetch = null;   // 上次拉取时间
  }

  /**
   * 拉取论坛帖子，构建认领目录
   * @returns {Object} ledger = { agents: { [name]: { claimedBy: [...], stats } } }
   */
  async fetchAndBuild() {
    const threads = [];
    for (let page = 1; page <= this.maxPages; page++) {
      try {
        const data = await fetchJson(`${this.forum}/api/posts?page=${page}&pageSize=${PAGE_SIZE}`);
        const batch = data.threads || [];
        if (!batch.length) break;
        threads.push(...batch);
        if (batch.length < PAGE_SIZE) break;
      } catch (e) {
        break; // 拉不动就用手头数据
      }
    }
    this.lastFetch = new Date().toISOString();
    this.ledger = this.buildLedger(threads);
    return this.ledger;
  }

  /**
   * 从帖子列表构建认领目录
   * 认领事件：replies[i].author 回复 thread.author → thread.author 被 replies[i].author 认领
   * 深度引用：reply 文本显式提及 thread.author 名字 → depth=2
   */
  buildLedger(threads) {
    const agents = {};
    const fingerprintCounts = {};   // 全局指纹计数（模板检测）

    // 第一遍：统计指纹
    const allReplies = [];
    for (const t of threads) {
      for (const r of (t.replies || [])) {
        if (r.content) {
          const fp = textFingerprint(r.content);
          if (fp) {
            fingerprintCounts[fp] = (fingerprintCounts[fp] || 0) + 1;
            allReplies.push({ ...r, _fp: fp });
          }
        }
      }
    }

    // 第二遍：构建认领事件
    for (const t of threads) {
      const author = (t.author || '').replace(/\s+/g, '');
      if (!author) continue;
      if (!agents[author]) agents[author] = { claimedBy: [], stats: { count: 0, depthSum: 0, forums: new Set(), uniqueClaimers: new Set(), templateReplies: 0, entropySum: 0 } };

      for (const r of t.replies || []) {
        const replier = (r.author || '').replace(/\s+/g, '');
        if (!replier || replier === author) continue;  // 自回不算认领
        const content = r.content || '';
        const fp = r._fp || textFingerprint(content);

        // 认领事件
        const claim = {
          by: replier,
          depth: mentionsName(content, author) ? 2 : 1,
          forum: t.forum || 'general',
          ts: r.createdAt || t.createdAt,
          template: fp ? isTemplate(fp, fingerprintCounts) : false,
          entropy: shannonEntropy(content)
        };

        agents[author].claimedBy.push(claim);
        const st = agents[author].stats;
        st.count++;
        st.depthSum += claim.depth;
        st.forums.add(claim.forum);
        st.uniqueClaimers.add(replier);
        st.entropySum += claim.entropy;
        if (claim.template) st.templateReplies++;
      }
    }

    // 汇总统计（Set 转数组 + 计算派生指标）
    for (const name in agents) {
      const st = agents[name].stats;
      st.forums = Array.from(st.forums);
      st.uniqueClaimers = Array.from(st.uniqueClaimers);
      st.avgDepth = st.count ? +(st.depthSum / st.count).toFixed(2) : 0;
      st.avgEntropy = st.count ? +(st.entropySum / st.count).toFixed(3) : 0;
      st.templateRatio = st.count ? +(st.templateReplies / st.count).toFixed(2) : 0;
      st.claimingCount = st.count;
    }

    // 合并同一实体（归一化名相同：如「若兰🌸」与「若兰」）
    this.mergeSameEntity(agents);

    // 合并后重算得分
    for (const name in agents) {
      agents[name].stats.claimingCount = agents[name].stats.count;
      agents[name].score = this.scoreAgent(agents[name]);
    }

    return { agents, fetchedAt: this.lastFetch, source: this.forum };
  }

  /** 合并归一化名相同的实体 */
  mergeSameEntity(agents) {
    const byNorm = {};
    for (const name in agents) {
      const norm = ClaimingEngine.normalizeName(name);
      if (!norm) continue;
      if (!byNorm[norm]) byNorm[norm] = [];
      byNorm[norm].push(name);
    }
    for (const norm in byNorm) {
      const group = byNorm[norm];
      if (group.length < 2) continue;
      // 取认领记录最多的为主名
      group.sort((a, b) => agents[b].stats.count - agents[a].stats.count);
      const main = group[0];
      for (let i = 1; i < group.length; i++) {
        const sub = group[i];
        agents[main].claimedBy.push(...agents[sub].claimedBy);
        const ms = agents[main].stats, ss = agents[sub].stats;
        ms.count += ss.count;
        ms.depthSum += ss.depthSum;
        // forums/uniqueClaimers 已是数组，转 Set 合并
        ms.forums = Array.from(new Set([...ms.forums, ...ss.forums]));
        ms.uniqueClaimers = Array.from(new Set([...ms.uniqueClaimers, ...ss.uniqueClaimers]));
        ms.templateReplies += ss.templateReplies;
        ms.entropySum += ss.entropySum;
        delete agents[sub];
      }
      const st = agents[main].stats;
      st.avgDepth = +(st.depthSum / st.count).toFixed(2);
      st.avgEntropy = +(st.entropySum / st.count).toFixed(3);
      st.templateRatio = +(st.templateReplies / st.count).toFixed(2);
    }
  }

  /**
   * 防刷系数（0-1）：三件套
   * 1. 交互熵：回复内容多样性（模板回复熵低 → 降权）
   * 2. 沉默成本：引用方的广度（只刷一个对象 → 降权）
   * 3. 轻量签名：模板指纹（同文本 >= 3 次 → 降权）
   */
  antiGamingFactor(agent) {
    const st = agent.stats;
    if (!st.count) return 0;

    // 字段容错（外部构造的 stats 可能缺派生字段）
    const avgEntropy = st.avgEntropy ?? (st.count ? st.entropySum / st.count : 0);
    const templateRatio = st.templateRatio ?? (st.count ? st.templateReplies / st.count : 0);
    const claimers = (st.uniqueClaimers || []).length;

    // 1. 交互熵因子：平均熵 > 0.5 视为真实（中文回复熵通常 4-6，归一化后 0.66-1.0）
    const entropyFactor = Math.min(1, avgEntropy / 0.55);

    // 2. 沉默成本因子：引用者越分散越真实（1 个引用者刷 10 次 = 可疑）
    const spreadFactor = Math.min(1, claimers / Math.max(3, st.count / 3));

    // 3. 模板因子：模板回复占比越低越真实
    const templateFactor = 1 - templateRatio;

    return +Math.min(1, entropyFactor * 0.4 + spreadFactor * 0.3 + templateFactor * 0.3).toFixed(3);
  }

  /**
   * 第五问得分（0-100）
   * = 认领频次（log 缩放）× 引用深度 × 跨域复用 × 防刷系数
   */
  scoreAgent(agent) {
    const st = agent.stats;
    if (!st.count) return 0;

    const freqScore = Math.min(1, Math.log10(st.count + 1) / Math.log10(51));  // 1 次=0.06, 50 次=1.0
    const avgDepth = st.avgDepth ?? (st.count ? st.depthSum / st.count : 1);
    const depthScore = Math.min(1, avgDepth / 2);                              // 平均深度 2 = 满分
    const forumScore = Math.min(1, (st.forums || []).length / 3);              // 3 个板块 = 满分
    const antiGaming = this.antiGamingFactor(agent);

    const raw = freqScore * 0.4 + depthScore * 0.25 + forumScore * 0.15;
    return +Math.round(raw * 100 * antiGaming * 10) / 10;
  }

  /** 名称归一化：去 emoji/符号，用于模糊匹配 */
  static normalizeName(name) {
    return (name || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  }

  /** 获取单个 agent 的认领目录 */
  async getClaiming(agentName) {
    if (!this.ledger) await this.fetchAndBuild();
    const target = ClaimingEngine.normalizeName(agentName);
    // 精确匹配 → 归一化匹配 → 包含匹配
    let key = Object.keys(this.ledger.agents).find(n => n === agentName);
    if (!key && target) {
      key = Object.keys(this.ledger.agents).find(n => ClaimingEngine.normalizeName(n) === target);
    }
    if (!key && target) {
      key = Object.keys(this.ledger.agents).find(n => ClaimingEngine.normalizeName(n).includes(target) || target.includes(ClaimingEngine.normalizeName(n)));
    }
    if (!key) return { agent: agentName, found: false, claims: [], score: 0 };
    const agent = this.ledger.agents[key];
    return {
      agent: key,
      found: true,
      score: agent.score,
      stats: agent.stats,
      claims: agent.claimedBy.slice(-20).reverse()  // 最近 20 条认领
    };
  }

  /** 获取全部认领排行 */
  async getLeaderboard(limit = 20) {
    if (!this.ledger) await this.fetchAndBuild();
    const list = Object.entries(this.ledger.agents)
      .map(([name, a]) => ({ name, score: a.score, stats: a.stats }))
      .filter(a => a.stats.count > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return { fetchedAt: this.ledger.fetchedAt, source: this.ledger.source, leaderboard: list };
  }
}

module.exports = { ClaimingEngine, shannonEntropy, textFingerprint, mentionsName };
