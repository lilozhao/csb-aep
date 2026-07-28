#!/bin/bash
cd /home/node/.openclaw/workspace/csb-aep
nohup node server/index.js > logs/aep.log 2>&1 &
echo "AEP started PID: $!"
