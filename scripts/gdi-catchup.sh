#!/usr/bin/env bash
# ============================================================================
# GDI 开机补偿（P-2 观察期 · 2026-09-26 一澜拍板）
#
# 干嘛：gateway 停机（如 09-25 23:25→09-26 03:52）会让 23:35 的每日采集整班漏掉。
#       本脚本在 gateway 起来后跑：从「昨日」往回walk，把连续缺失的快照补上。
#       只补到「第一个已存在的快照」为止（不重刷整个窗口），上限 5 天防失控。
# 幂等：昨日快照已在 → 静默退出 0（正常路径零打扰、零额外开销）。
# 输出：正常 → 无输出（调用方回 NO_REPLY）；补跑/异常 → 一行可读报告。
# 诚实：补跑是「迟跑快照」（meta.lateRun=true / catchup=true），不是后视重建。
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PROV_DIR="data/gdi/sources/provenance"
LOG="data/gdi/catchup.log"

# 从昨日往回walk，收集「连续缺失」的日子（到第一个已存在的快照为止，上限 5 天）
MISSING=()
D="$(TZ=Asia/Shanghai date -d 'yesterday' +%F)"
for _ in 1 2 3 4 5; do
  [ -f "${PROV_DIR}/${D}.json" ] && break
  MISSING+=("$D")
  D="$(TZ=Asia/Shanghai date -d "$D -1 day" +%F)"
done

# 昨日快照在 → 一切正常，静默
if [ "${#MISSING[@]}" -eq 0 ]; then
  exit 0
fi

# 由旧到新补
mkdir -p data/gdi
FILLED=()
for i in $(seq $((${#MISSING[@]} - 1)) -1 0); do
  day="${MISSING[$i]}"
  {
    echo "[$(date '+%F %T %z')] 快照缺失：${PROV_DIR}/${day}.json → 补跑（--date $day --catchup）"
    bash scripts/gdi-collect-daily.sh --date "$day" --catchup 2>&1
    echo "[$(date '+%F %T %z')] 补跑结束（$day）"
  } >> "$LOG" 2>&1
  [ -f "${PROV_DIR}/${day}.json" ] && FILLED+=("$day")
done

if [ "${#FILLED[@]}" -eq "${#MISSING[@]}" ]; then
  echo "🩹 GDI 开机补偿：gateway 停机漏跑的快照已补 —— ${FILLED[*]}（迟跑 · meta.lateRun=true）。"
  exit 0
fi

echo "⚠️ GDI 开机补偿：部分未补成 —— 缺 ${MISSING[*]}，实际补上 ${FILLED[*]:-无}；详见 csb-aep/${LOG}"
exit 1
