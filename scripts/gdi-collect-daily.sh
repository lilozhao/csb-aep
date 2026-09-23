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
# 挂载：cron 每日 23:35（见 workspace HEARTBEAT.md / csb-aep docs）
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

DAY="$(date +%F)"
echo "🌅 GDI 每日采集 · $DAY"

for s in provenance delegation witness; do
  echo "--- $s ---"
  node "scripts/gdi-collect-$s.js" 2>&1 | tail -6
done

echo "✅ 采集结束 · 产出目录 data/gdi/sources/"
