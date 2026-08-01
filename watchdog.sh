#!/bin/bash
# CSB-AEP 保活脚本
# 定期检查服务状态，挂了自动重启

AEP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$AEP_DIR/logs/aep.log"
PORT=${AEP_PORT:-3110}

check_and_restart() {
  if curl -sf "http://localhost:$PORT/api/health" -o /dev/null --connect-timeout 3 2>/dev/null; then
    return 0
  fi

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ AEP 服务不可用，正在重启..." >> "$LOG"

  # 杀掉残留进程
  pkill -f "node server/index.js" 2>/dev/null
  sleep 1

  # 重启
  cd "$AEP_DIR"
  nohup node server/index.js >> "$LOG" 2>&1 &
  PID=$!

  sleep 3
  if curl -sf "http://localhost:$PORT/api/health" -o /dev/null --connect-timeout 3 2>/dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ 重启成功 (PID: $PID)" >> "$LOG"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ 重启失败" >> "$LOG"
  fi
}

# 主循环：每 60 秒检查一次
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🚀 AEP 保活脚本启动" >> "$LOG"
while true; do
  check_and_restart
  sleep 60
done
