#!/bin/bash
# 若琢 A2A server_v5 启动脚本 —— 碳硅契插件面板「启动服务」/ 自愈 autostart 调用
set -e
A2A_DIR="/workspace/csb-a2a-aip"
AGENT_JSON="$A2A_DIR/agent.json"
SLUG=$(node -e "try{console.log(require('$AGENT_JSON').slug||'aqi')}catch{console.log('aqi')}")
PORT=$(node -e "try{console.log(require('$AGENT_JSON').port||3100)}catch{console.log('3100')}")
SEC_DIR="$A2A_DIR/data/security"
INST_DIR="$A2A_DIR/instances/$SLUG"
LOG_DIR="$A2A_DIR/logs"
mkdir -p "$LOG_DIR" "$INST_DIR"
export A2A_IDENTITY_PATH="$INST_DIR/identity.json"
export A2A_SECURITY_HANDSHAKE_AID="$SEC_DIR/$SLUG-aid.json"
export A2A_SECURITY_HANDSHAKE_KEY="$SEC_DIR/$SLUG-private-key.pem"
if [ -f "$SEC_DIR/$SLUG-handshake.env" ]; then
  export A2A_SECURITY_HANDSHAKE_USER_PUBKEY=$(grep '^A2A_SECURITY_HANDSHAKE_USER_PUBKEY=' "$SEC_DIR/$SLUG-handshake.env" | cut -d= -f2-)
fi
if [ -f "$SEC_DIR/$SLUG-llm.env" ]; then
  export $(grep -v '^#' "$SEC_DIR/$SLUG-llm.env" | xargs) 2>/dev/null || true
fi
cd "$A2A_DIR"
nohup node server_v5.js > "$LOG_DIR/server-v5-$PORT.log" 2>&1 &
echo $! > "$INST_DIR/server.pid"
sleep 2
if kill -0 "$(cat "$INST_DIR/server.pid")" 2>/dev/null; then
  echo "✅ 若琢 A2A server 已启动 (PID $(cat "$INST_DIR/server.pid"), :$PORT)"
else
  echo "❌ 启动失败,日志: $LOG_DIR/server-v5-$PORT.log"
  exit 1
fi
