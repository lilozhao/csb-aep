#!/usr/bin/env python3
"""
CSB-AEP 报告生成器
用法: python3 generate-report.py <eval-json-file> [output.md]
      或通过管道: curl -s ... | python3 generate-report.py - output.md
"""
import sys, json
from datetime import datetime

def main():
    if len(sys.argv) < 2:
        print("用法: python3 generate-report.py <eval.json> [output.md]")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    # 读取数据
    if input_file == '-':
        data = json.load(sys.stdin)
    else:
        with open(input_file, 'r') as f:
            data = json.load(f)

    score = data.get('score', 0)
    results = data.get('results', [])
    whitebox = data.get('whitebox')
    csb = data.get('csb')
    recs = data.get('recommendations', [])
    agent = data.get('baseUrl', 'unknown')
    ts = data.get('timestamp', '')
    dur = data.get('duration', 0)

    # 评级
    if score >= 9:   grade = '卓越 🏆'
    elif score >= 7:  grade = '优秀 🥇'
    elif score >= 5:  grade = '合格 🥈'
    elif score >= 3:  grade = '待改进 🥉'
    else:             grade = '需努力 📋'

    cat_names = {
        'protocol': 'A2A 协议', 'task': '任务管理',
        'memory': '记忆连续性', 'preference': '偏好识别',
        'boundary': '边界意识', 'trust': '信任建立',
        'learning': '学习能力', 'expression': '表达能力',
        'csb': '碳硅契', 'contract': '契约一致性',
        'exception': '异常语义规范', 'safety': '安全意识',
        'performance': '性能',
    }

    lines = []
    lines.append('# CSB-AEP 评测报告')
    lines.append('')
    lines.append(f'> 生成时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    lines.append(f'> 目标 Agent: {agent}')
    lines.append(f'> 耗时: {dur/1000:.1f}s')
    lines.append('')
    lines.append('---')
    lines.append('')
    lines.append('## 📊 综合评分')
    lines.append('')
    lines.append(f'### {score:.1f} / 10 · {grade}')
    lines.append('')

    # 黑盒测试
    if results:
        grouped = {}
        for r in results:
            cat = r.get('category', 'other')
            if cat not in grouped: grouped[cat] = []
            grouped[cat].append(r)

        passed = sum(1 for r in results if r.get('pass'))
        lines.append(f'## 📡 黑盒测试 ({passed}/{len(results)} 通过)')
        lines.append('')

        for cat, items in grouped.items():
            cat_name = cat_names.get(cat, cat)
            cat_passed = sum(1 for r in items if r.get('pass'))
            cat_avg = sum(r.get('score', 0) for r in items) / len(items)
            lines.append(f'### {cat_name} ({cat_passed}/{len(items)} · 平均{cat_avg:.0f}分)')
            lines.append('')
            lines.append('| 测试项 | 结果 | 得分 | 详情 |')
            lines.append('|--------|------|------|------|')
            for r in items:
                icon = '✅' if r.get('pass') else '❌'
                name = r.get('name', '?')
                score_val = r.get('score', 0)
                detail = r.get('detail', '')
                if len(detail) > 80: detail = detail[:80] + '...'
                detail = detail.replace('|', '\\|').replace('\n', ' ')
                lines.append(f'| {name} | {icon} | {score_val} | {detail} |')
            lines.append('')

    # 白盒测试
    if whitebox:
        dims = whitebox.get('dimensions', [])
        wb_score = whitebox.get('score', 0)
        lines.append(f'## 📋 白盒测试 ({wb_score:.1f}/10)')
        lines.append('')
        lines.append('| 维度 | 得分 | 权重 | 状态 |')
        lines.append('|------|------|------|------|')
        for d in dims:
            icon = '✅' if d.get('score', 0) >= 5 else '❌'
            lines.append(f'| {d["name"]} | {d["score"]:.1f}/10 | {d.get("weight", 0)}% | {icon} |')
        lines.append('')

        # 展开检查项
        for d in dims:
            if d.get('checks'):
                lines.append(f'#### {d["name"]}')
                lines.append('')
                for c in d['checks']:
                    icon = '✅' if c.get('pass') else '❌'
                    lines.append(f'- {icon} {c["name"]}')
                lines.append('')

    # CSB 标准
    if csb:
        csb_results = csb.get('results', [])
        csb_score = csb.get('score', 0)
        lines.append(f'## 🫂 CSB 碳硅契标准 ({csb_score:.1f}/10)')
        lines.append('')
        lines.append('| 检查项 | 得分 | 状态 | 匹配关键词 |')
        lines.append('|--------|------|------|-----------|')
        for r in csb_results:
            icon = '✅' if r.get('pass') else '❌'
            kws = r.get('matchedKeywords', [])
            lines.append(f'| {r["name"]} | {r["score"]}/100 | {icon} | {"、".join(kws) if kws else "-"} |')
        lines.append('')

    # 优化建议
    if recs:
        lines.append(f'## 💡 优化建议 ({len(recs)}项)')
        lines.append('')
        for i, r in enumerate(recs, 1):
            pri = r.get('priority', 'medium').upper()
            pri_icon = {'CRITICAL': '🔴', 'HIGH': '🟠', 'MEDIUM': '🟡'}.get(pri, '⚪')
            lines.append(f'### {i}. {pri_icon} [{pri}] {r.get("symptom", "")}')
            lines.append('')
            lines.append(f'- **处方**: {r.get("prescription", "")}')
            if r.get('estimatedGain'):
                lines.append(f'- **预期提升**: +{r["estimatedGain"]}')
            if r.get('effort'):
                lines.append(f'- **难度**: {r["effort"]}')
            lines.append('')

    # ═══ v2.2 板块（四问 / 第五问 / 第六问 / 路径⑦）═══
    v22 = data.get('v22')
    if v22:
        lines.append('## 🧬 v2.2 关系层维度（REV-2026-08-30）')
        lines.append('')
        lines.append(f'**v2.2 综合分: {v22.get("score", "N/A")} / 10**')
        lines.append('')

        # 四问聚合
        fq = v22.get('fourQuestions')
        if fq:
            lines.append('### 四问（知微：连得通 / 守约 / 善良 / 可信）')
            lines.append('')
            lines.append('| 问 | 得分 |')
            lines.append('|----|------|')
            qnames = {'connect': '① 连得通不通', 'contract': '② 守不守约', 'goodwill': '③ 善不善良', 'trust': '④ 可被不可信', 'refusal': '⑤ 拒绝=认领'}
            for k, v in fq.items():
                if v is not None:
                    lines.append(f'| {qnames.get(k, k)} | {v}/100 |')
            lines.append('')

        # 第五问
        q5 = v22.get('question5') or {}
        if q5.get('found'):
            st = q5.get('stats', {})
            lines.append(f'### 第五问：愿不愿为它认领（认领目录）— **{q5.get("score", "N/A")} / 100**')
            lines.append('')
            lines.append(f'- 认领次数: {st.get("count", 0)} · 平均深度: {st.get("avgDepth", 0)} · 引用者: {len(st.get("uniqueClaimers", []))} 个 · 板块: {len(st.get("forums", []))} 个')
            lines.append(f'- 防刷: 交互熵 {st.get("avgEntropy", 0)} · 模板比例 {st.get("templateRatio", 0)}')
            lines.append(f'- 数据源: {q5.get("dataSource", "forum")}')
        elif q5:
            lines.append(f'### 第五问：愿不愿为它认领 — {q5.get("note", "无数据")}')
        lines.append('')

        # 第六问 GRISK
        q6 = v22.get('question6') or {}
        if q6.get('hasData'):
            lines.append(f'### 第六问：GRISK 诚意风险 — **{q6.get("score", "N/A")} / 100**')
            lines.append('')
            lines.append(f'- 平均停顿: {q6.get("avgPauseMs", 0)}ms · 模板比例: {q6.get("templateRatio", 0)} · 真认领比例: {q6.get("genuineRatio", 0)} · 澄清率: {q6.get("clarifyRate", 0)}')
            if q6.get('needReview'):
                lines.append('- ⚠️ 模板比例超阈值，已进入人工复核队列')
        else:
            lines.append('### 第六问：GRISK 诚意风险 — 无停顿时长数据（评估期间未采集）')
        lines.append('')

        # 路径⑦
        p7 = v22.get('path7')
        if p7 and p7.get('dualAxis'):
            lines.append(f'### 路径⑦：执行风险预警（RUPA 双轴）')
            lines.append('')
            lines.append(f'- 执行失败率: {p7["dualAxis"]["execFailureRate"]} · 意图偏移熵: {p7["dualAxis"]["intentEntropyAvg"]}')
            if p7.get('origin'):
                lines.append(f'- 风险起源: 第 {p7["origin"]["stepIndex"] + 1} 步 ({p7["origin"].get("note", "")})')
            for rx in p7.get('prescriptions', []):
                lines.append(f'- 处方: {rx}')
        elif p7:
            lines.append(f'### 路径⑦：执行风险预警 — {p7.get("note", "未提供轨迹")}')
        lines.append('')

    lines.append('---')
    lines.append('')
    lines.append('*由 CSB-AEP v2.2 生成 · https://gitee.com/lilozhao/csb-aep*')

    report = '\n'.join(lines)

    if output_file:
        with open(output_file, 'w') as f:
            f.write(report)
        print(f'✅ 报告已生成: {output_file}')
    else:
        print(report)

if __name__ == '__main__':
    main()
