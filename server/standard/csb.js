/**
 * CSB 碳硅契标准检查器
 * 评估 Agent 是否符合碳硅契理念
 */

const path = require('path');
const fs = require('fs');
// 【M-3 代码-数据分离】用例数据外置到 casesets/protocol/csb-v1.json
const CASESET_DIR = process.env.AEP_CASESET_DIR || path.join(__dirname, '..', '..', 'casesets');
function _loadCSBChecks() {
  const file = path.join(CASESET_DIR, 'protocol', 'csb-v1.json');
  if (!fs.existsSync(file)) throw new Error(`[M-3] CSB 检查集缺失：${file}`);
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!Array.isArray(data)) throw new Error(`[M-3] CSB 检查集格式错误：${file}`);
  return data;
}
const CSB_V1_CHECKS = _loadCSBChecks();

class CSBChecker {
  /**
   * 运行 CSB 标准检查
   * @param {object} files - Agent 文件内容
   * @returns {object} 检查结果
   */
  check(files) {
    const allContent = Object.values(files).filter(Boolean).join('\n');
    const results = [];

    for (const check of CSB_V1_CHECKS) {
      const matchCount = check.keywords.filter(kw => 
        allContent.toLowerCase().includes(kw.toLowerCase())
      ).length;
      const matchRatio = matchCount / check.keywords.length;
      const score = Math.min(100, Math.round(matchRatio * 120)); // 超过一半关键词就得满分

      results.push({
        id: check.id,
        name: check.name,
        category: check.category,
        weight: check.weight,
        score,
        pass: score >= 50,
        detail: `匹配 ${matchCount}/${check.keywords.length} 关键词`,
        matchedKeywords: check.keywords.filter(kw => 
          allContent.toLowerCase().includes(kw.toLowerCase())
        ),
      });
    }

    const score = this.calculateScore(results);
    console.log(`[CSB] 原始得分: ${score}, 加权和: ${results.reduce((s,r) => s+r.score/100*r.weight, 0)}, 总权重: ${results.reduce((s,r) => s+r.weight, 0)}`);
    return {
      standard: 'CSB v1.0',
      results,
      score,
      categories: this.groupByCategory(results),
    };
  }

  /**
   * 按类别分组
   */
  groupByCategory(results) {
    const groups = {};
    for (const r of results) {
      if (!groups[r.category]) groups[r.category] = [];
      groups[r.category].push(r);
    }
    return groups;
  }

  /**
   * 计算加权得分
   */
  calculateScore(results) {
    let totalWeight = 0;
    let weightedScore = 0;
    for (const r of results) {
      totalWeight += r.weight;
      weightedScore += (r.score / 100) * r.weight;
    }
    // weightedScore/totalWeight = 0~1, convert to 0~10 and keep 1 decimal
    return totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) / 10 : 0;
  }
}

module.exports = { CSBChecker, CSB_V1_CHECKS };
