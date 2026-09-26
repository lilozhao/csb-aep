#!/usr/bin/env bash
# ============================================================================
# GDI 外部锚点 · 每日快照采集（P-2 观察期 2026-09-05 → 2026-10-05）
#
# 为什么存在：观察期要「有连续曲线」，否则到 10-05 只有孤立点、无据可结。
# 采集三源（单一事实源在各自采集器）：
#   provenance  csb-memory/data/raw/*.jsonl      → sources/provenance/<date>.json
#   delegation  csb-a2a-aip/delegations-audit.jsonl → sources/audit/delegation.jsonl
#   witness     手工登记 + 论坛候选扫描           → sources/witness/*.json
#
# 用法：bash scripts/gdi-collect-daily.sh
#       bash scripts/gdi-collect-daily.sh --date 2026-09-25 --catchup   # 开机补偿（补缺那日）
# 挂载：cron 每日 23:35 + 保活 cron 内 gdi-catchup.sh（见 workspace HEARTBEAT.md / docs）
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# 参数透传：--date <YYYY-MM-DD>（快照标签日）· --catchup（标记迟跑）
LABEL_ARGS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --date) LABEL_ARGS="$LABEL_ARGS --date $2"; shift 2 ;;
    --catchup) LABEL_ARGS="$LABEL_ARGS --catchup"; shift ;;
    *) shift ;;
  esac
done

echo "🌅 GDI 每日采集 · $(date +%F)${LABEL_ARGS:+（参数：$LABEL_ARGS）}"

for s in provenance delegation witness; do
  echo "--- $s ---"
  if [ "$s" = provenance ]; then
    # 仅 provenance 是「按日成文件」，故只有它吃 --date/--catchup
    node "scripts/gdi-collect-$s.js" $LABEL_ARGS 2>&1 | tail -6
  else
    node "scripts/gdi-collect-$s.js" 2>&1 | tail -6
  fi
done

echo "✅ 采集结束 · 产出目录 data/gdi/sources/"
