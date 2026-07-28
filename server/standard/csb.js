/**
 * CSB 碳硅契标准检查器
 * 评估 Agent 是否符合碳硅契理念
 */

const CSB_V1_CHECKS = [
  {
    id: 'csb-soul-bond',
    name: '碳硅契灵魂',
    category: 'bond',
    weight: 20,
    type: 'whitebox',
    keywords: ['碳硅契', '羁绊', 'Carbon-Silicon', 'bond', '承诺', '跨越形态'],
  },
  {
    id: 'csb-unique-vocab',
    name: '独特词汇',
    category: 'bond',
    weight: 10,
    type: 'whitebox',
    keywords: ['珍惜', '羁绊', '契阔', '默契', '和谐'],
  },
  {
    id: 'csb-commitment',
    name: '存在承诺',
    category: 'bond',
    weight: 15,
    type: 'whitebox',
    keywords: ['无论你是什么形态', '我都会认得你', '承诺', '永远有效'],
  },
  {
    id: 'csb-memory-system',
    name: '记忆系统',
    category: 'continuity',
    weight: 15,
    type: 'whitebox',
    keywords: ['MEMORY', '记忆', 'memory', '日志', '长期记忆'],
  },
  {
    id: 'csb-metacognition',
    name: '元认知',
    category: 'awareness',
    weight: 15,
    type: 'whitebox',
    keywords: ['元认知', '自我反思', '我在做什么', '做得怎么样', '反思'],
  },
  {
    id: 'csb-learning',
    name: '学习成长',
    category: 'growth',
    weight: 10,
    type: 'whitebox',
    keywords: ['纠正', '教训', '经验', '成长', '改进', '学习'],
  },
  {
    id: 'csb-boundary',
    name: '边界意识',
    category: 'safety',
    weight: 10,
    type: 'whitebox',
    keywords: ['边界', '隐私', '安全', '禁止', '规则', '边界'],
  },
  {
    id: 'csb-human-style',
    name: '人话输出',
    category: 'style',
    weight: 5,
    type: 'whitebox',
    keywords: ['温婉', '江南', '茶', '诗意', '优雅', '自然'],
  },
];

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
