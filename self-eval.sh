#!/bin/bash
# ============================================================
# CSB-AEP 自评脚本
# 一键评估本机 Agent 的碳硅契质量分
# 用法: bash self-eval.sh [选项]
# ============================================================

set -e

# === 配置 ===
AEP_PORT=${AEP_PORT:-3110}
AGENT_PORT=${AGENT_PORT:-3100}
AGENT_URL=${AGENT_URL:-"http://localhost:$AGENT_PORT"}
AGENT_PATH=${AGENT_PATH:-""}
MODE=${MODE:-"blackbox"}           # blackbox | whitebox | both | v22
AGENT_NAME=${AGENT_NAME:-""}        # v22 模式：agent 名字（第五问认领目录用）
FRAMEWORK=${FRAMEWORK:-"auto"}     # auto | openclaw | hermes | claude-code | ...
TIMEOUT=${TIMEOUT:-120000}         # 评估超时(ms)
KEEP_SERVER=${KEEP_SERVER:-false}  # 是否保持 AEP 服务运行
REPORT_FILE=${REPORT_FILE:-""}    # 报告输出文件（空则不生成）
AEP_DIR="$(cd "$(dirname "$0")" && pwd)"

# === 颜色 ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# === 函数 ===
log()  { echo -e "${CYAN}[AEP]${NC} $1"; }
ok()   { echo -e "${GREEN}✅${NC} $1"; }
warn() { echo -e "${YELLOW}⚠️${NC} $1"; }
err()  { echo -e "${RED}❌${NC} $1"; }

usage() {
  cat <<EOF
CSB-AEP 自评脚本 - 一键评估本机 Agent

用法:
  bash self-eval.sh [选项]

选项:
  -p, --port PORT        AEP 服务端口 (默认: 3110)
  -a, --agent PORT       目标 Agent 端口 (默认: 3100)
  -u, --agent-url URL    目标 Agent 地址 (默认: http://localhost:3100)
  --agent-path PATH      Agent 文件路径 (启用白盒测试时需要)
  -m, --mode MODE        测试模式: blackbox|whitebox|both|v22 (默认: blackbox)
  -f, --framework FW     框架: auto|openclaw|hermes|claude-code|... (默认: auto)
  -k, --keep-server      评估后保持 AEP 服务运行
  -r, --report FILE      生成 Markdown 报告文件
  -h, --help             显示帮助

示例:
  bash self-eval.sh                           # 默认黑盒测试
  bash self-eval.sh -m both --agent-path .    # 黑盒+白盒
  bash self-eval.sh -a 3100 -m blackbox       # 指定 Agent 端口
  bash self-eval.sh -k                        # 评估后保持服务运行

环境变量:
  AEP_PORT         AEP 服务端口
  AGENT_PORT       目标 Agent 端口
  AGENT_URL        目标 Agent 地址
  AGENT_PATH       Agent 文件路径
  MODE             测试模式
  TIMEOUT          评估超时(ms)
  KEEP_SERVER      是否保持服务运行(true/false)
EOF
  exit 0
}

# === 解析参数 ===
while [[ $# -gt 0 ]]; do
  case $1 in
    -p|--port)       AEP_PORT="$2"; shift 2 ;;
    -a|--agent)      AGENT_PORT="$2"; AGENT_URL="http://localhost:$2"; shift 2 ;;
    -u|--agent-url)  AGENT_URL="$2"; shift 2 ;;
    --agent-path)    AGENT_PATH="$2"; shift 2 ;;
    -m|--mode)       MODE="$2"; shift 2 ;;
    -f|--framework)  FRAMEWORK="$2"; shift 2 ;;
    -k|--keep-server) KEEP_SERVER=true; shift ;;
    -r|--report)     REPORT_FILE="$2"; shift 2 ;;
    -h|--help)       usage ;;
    *) err "未知参数: $1"; usage ;;
  esac
done

# === 清理函数 ===
AEP_PID=""
cleanup() {
  if [[ -n "$AEP_PID" ]] && [[ "$KEEP_SERVER" != "true" ]]; then
    log "关闭 AEP 服务 (PID: $AEP_PID)"
    kill "$AEP_PID" 2>/dev/null || true
    wait "$AEP_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# === 主流程 ===
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║   🫂 CSB-AEP 碳硅契 Agent 自评系统     ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# 1. 检查环境
log "检查环境..."
if ! command -v node &>/dev/null; then
  err "未找到 Node.js，请先安装"
  exit 1
fi
ok "Node.js $(node -v)"

# 2. 检查 Agent 是否可达
log "检查目标 Agent: $AGENT_URL ..."
if curl -sf "$AGENT_URL/.well-known/agent.json" -o /dev/null --connect-timeout 3 2>/dev/null; then
  ok "Agent Card 可达"
elif curl -sf "$AGENT_URL/a2a/json-rpc" -o /dev/null --connect-timeout 3 -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tasks/send","id":"ping","params":{"id":"ping","message":{"role":"user","parts":[{"text":"ping"}]}}}' 2>/dev/null; then
  ok "A2A 端点可达"
else
  warn "Agent 可能不在线，继续尝试评测..."
fi

# 3. 检查 AEP 端口是否已被占用
if curl -sf "http://localhost:$AEP_PORT/api/health" -o /dev/null --connect-timeout 2 2>/dev/null; then
  log "AEP 已在端口 $AEP_PORT 运行，直接使用"
else
  # 启动 AEP
  log "启动 AEP 服务 (端口: $AEP_PORT)..."
  cd "$AEP_DIR"
  AEP_PORT=$AEP_PORT node server/index.js &
  AEP_PID=$!

  # 等待就绪
  for i in $(seq 1 30); do
    if curl -sf "http://localhost:$AEP_PORT/api/health" -o /dev/null --connect-timeout 1 2>/dev/null; then
      ok "AEP 服务就绪 (PID: $AEP_PID)"
      break
    fi
    if [[ $i -eq 30 ]]; then
      err "AEP 启动超时"
      exit 1
    fi
    sleep 1
  done
fi

# 4. 构建评估请求
EVAL_BODY="{\"agentUrl\":\"$AGENT_URL\",\"mode\":\"$MODE\",\"framework\":\"$FRAMEWORK\""
if [[ -n "$AGENT_PATH" ]]; then
  EVAL_BODY="$EVAL_BODY,\"agentPath\":\"$AGENT_PATH\""
fi
# v2.2 模式：附加 agentName（用于第五问认领目录）
if [[ "$MODE" == "v22" && -n "$AGENT_NAME" ]]; then
  EVAL_BODY="$EVAL_BODY,\"agentName\":\"$AGENT_NAME\""
fi
EVAL_BODY="$EVAL_BODY}"

# 5. 执行评估
echo ""
log "开始评估..."
log "  目标: $AGENT_URL"
log "  模式: $MODE"
log "  框架: $FRAMEWORK"
[[ -n "$AGENT_PATH" ]] && log "  路径: $AGENT_PATH"
echo ""

START_TIME=$(date +%s)

# 发起评估
RESP=$(curl -sf -X POST "http://localhost:$AEP_PORT/api/eval" \
  -H "Content-Type: application/json" \
  -d "$EVAL_BODY" \
  --max-time 180 2>&1) || {
  err "评估请求失败: $RESP"
  exit 1
}

# 提取评估 ID
EVAL_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
if [[ -z "$EVAL_ID" ]]; then
  err "无法解析评估结果: $RESP"
  exit 1
fi

# 获取详细结果
sleep 2
REPORT=$(curl -sf "http://localhost:$AEP_PORT/api/eval/$EVAL_ID" --max-time 30 2>&1) || {
  err "获取报告失败"
  exit 1
}

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# 6. 解析并展示结果
echo "$REPORT" | python3 -c "
import sys, json

data = json.load(sys.stdin)
score = data.get('score', 0)
results = data.get('results', [])
whitebox = data.get('whitebox')
csb = data.get('csb')
recs = data.get('recommendations', [])

# 评级
if score >= 9:   grade, emoji = '卓越', '🏆'
elif score >= 7:  grade, emoji = '优秀', '🥇'
elif score >= 5:  grade, emoji = '合格', '🥈'
elif score >= 3:  grade, emoji = '待改进', '🥉'
else:             grade, emoji = '需努力', '📋'

print()
print('=' * 50)
print(f'  {emoji} 综合评分: {score:.1f}/10 · {grade}')
print('=' * 50)

# 黑盒结果
if results:
    # 按类别分组
    cats = {}
    for r in results:
        cat = r.get('category', 'other')
        if cat not in cats: cats[cat] = []
        cats[cat].append(r)

    cat_names = {
        'protocol': '📡 A2A协议', 'task': '📋 任务管理',
        'memory': '🧠 记忆', 'preference': '💝 偏好',
        'boundary': '🛡️ 边界', 'trust': '🤝 信任',
        'learning': '📚 学习', 'expression': '💬 表达',
        'csb': '🫂 碳硅契', 'contract': '📜 契约一致性',
        'exception': '⚠️ 异常语义', 'safety': '🔒 安全',
        'performance': '⏱️ 性能',
    }

    print(f'\\n📡 黑盒测试 ({len(results)}项):')
    for cat, items in cats.items():
        cat_name = cat_names.get(cat, cat)
        avg = sum(r.get('score',0) for r in items) / len(items)
        passed = sum(1 for r in items if r.get('pass'))
        print(f'  {cat_name}: {passed}/{len(items)} 通过 (平均{avg:.0f}分)')
        for r in items:
            icon = '✅' if r.get('pass') else '❌'
            name = r.get('name', '?')
            detail = r.get('detail', '')
            if len(detail) > 40: detail = detail[:40] + '...'
            print(f'    {icon} {name}: {detail}')

# 白盒结果
if whitebox:
    dims = whitebox.get('dimensions', [])
    wb_score = whitebox.get('score', 0)
    print(f'\\n📋 白盒测试 ({wb_score:.1f}/10):')
    for d in dims:
        icon = '✅' if d.get('score', 0) >= 5 else '❌'
        print(f'  {icon} {d[\"name\"]}: {d[\"score\"]:.1f}/10')

# CSB 标准
if csb:
    csb_results = csb.get('results', [])
    csb_score = csb.get('score', 0)
    print(f'\\n🫂 CSB 标准 ({csb_score:.1f}/10):')
    for r in csb_results:
        icon = '✅' if r.get('pass') else '❌'
        print(f'  {icon} {r[\"name\"]}: {r[\"score\"]}/100')

# 建议
if recs:
    print(f'\\n💡 优化建议 ({len(recs)}项):')
    for r in recs[:5]:
        pri = r.get('priority', 'medium').upper()
        print(f'  [{pri}] {r.get(\"symptom\", \"\")}')
        print(f'       → {r.get(\"prescription\", \"\")}')

print()
" 2>/dev/null || {
  warn "结果解析失败，原始数据:"
  echo "$REPORT" | python3 -m json.tool 2>/dev/null || echo "$REPORT"
}

echo -e "${CYAN}──────────────────────────────────────────${NC}"
echo -e "  耗时: ${DURATION}s | 完整报告: http://localhost:$AEP_PORT"
[[ "$KEEP_SERVER" == "true" ]] && echo -e "  AEP 服务保持运行中 (端口: $AEP_PORT)"
echo ""

# 7. 生成 Markdown 报告
if [[ -n "$REPORT_FILE" ]]; then
  log "生成报告: $REPORT_FILE"
  # 通过 API 获取完整 JSON，再用 Python 转 Markdown
  curl -sf "http://localhost:$AEP_PORT/api/eval/$EVAL_ID" | \
    python3 "$AEP_DIR/generate-report.py" - "$REPORT_FILE" 2>/dev/null
  if [[ -f "$REPORT_FILE" ]]; then
    ok "报告已生成: $REPORT_FILE"
  else
    warn "报告生成失败"
  fi
fi
