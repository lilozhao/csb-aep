#!/usr/bin/env bash
# bid-refresh — 每 4 小时回填一次 bid_signal（若琢语体 / backfill 模式）
#
# 背景（2026-10-22 一澜定）：
#   不做实时 hook，改「定时回填」——每 ≤4 小时重跑一次提取器，刷新共享落地档。
#   这样解决若兰观测侧核到的问题：落地档停在 72h 前、realtime=0。
#   我们本来就没有实时通道（origin 全是 backfill），所以与其假装 realtime，
#   不如让 backfill 保持新鲜 —— 「0 也要出声」在这里的落地形式就是：
#   每次刷新都往日志写一行，哪怕信号数没变。
#
# 用法:
#   bash bid-refresh.sh              # 前台循环（默认 4h）
#   bash bid-refresh.sh --once       # 只跑一次（测试/手动触发用）
#   nohup setsid bash bid-refresh.sh >> .../bid-refresh.log 2>&1 &   # 后台常驻
set -uo pipefail

INTERVAL=$((4 * 3600))   # 4 小时
ONCE=0
[ "${1:-}" = "--once" ] && ONCE=1

AEP=/workspace/csb-aep
EXTRACT="$AEP/scripts/extract-bid-signals.js"
DATA="$AEP/data/bid/bid-signals-ruozhuo.json"
LOGDIR="$AEP/logs"
LOG="$LOGDIR/bid-refresh.log"
LOCK="$LOGDIR/bid-refresh.lock"
MAX_LOG=1048576

mkdir -p "$LOGDIR"
log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }

trim_log() {
  [ -f "$LOG" ] || return 0
  local sz; sz=$(stat -c %s "$LOG" 2>/dev/null || echo 0)
  if [ "$sz" -gt "$MAX_LOG" ]; then tail -c 262144 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"; fi
}

# 单实例锁
if [ -e "$LOCK" ]; then
  old=$(cat "$LOCK" 2>/dev/null || true)
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
    echo "⚠️  bid-refresh 已在运行 (PID $old)，本次退出"; exit 0
  fi
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

refresh_once() {
  trim_log
  local before after ts_before ts_after
  before=$(node -e "try{console.log(require('$DATA').signals.length)}catch{console.log(0)}" 2>/dev/null || echo 0)
  ts_before=$(node -e "try{console.log(require('$DATA').extractedAt)}catch{console.log('-')}" 2>/dev/null || echo '-')

  if ! node "$EXTRACT" >> "$LOG" 2>&1; then
    log "❌ 提取失败（node $EXTRACT 非零退出）"
    return 1
  fi

  after=$(node -e "try{console.log(require('$DATA').signals.length)}catch{console.log(0)}" 2>/dev/null || echo 0)
  ts_after=$(node -e "try{console.log(require('$DATA').extractedAt)}catch{console.log('-')}" 2>/dev/null || echo '-')
  # 每次必写一行，哪怕数没变 —— 「0 也要出声」
  if [ "$before" = "$after" ]; then
    log "💓 刷新完成 · 信号数不变 ($after) · extractedAt=$ts_after"
  else
    log "🔄 刷新完成 · 信号数 $before → $after · extractedAt=$ts_after"
  fi
  return 0
}

MODE="常驻(每 $((INTERVAL/3600))h)"
[ "$ONCE" = "1" ] && MODE="once"
log "=== bid-refresh 启动 (PID $$, $MODE) ==="

if [ "$ONCE" = "1" ]; then
  refresh_once
  exit $?
fi

while true; do
  refresh_once
  sleep "$INTERVAL"
done
