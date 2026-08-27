#!/bin/sh
# 注册表健康监控 - 检测到异常自动重启
# 若兰负责的内网注册表自管理脚本

REGISTRY_PORT=${REGISTRY_PORT:-3099}
REGISTRY_DIR="/home/node/.openclaw/workspace/csb-a2a-aip"
PIDFILE="$REGISTRY_DIR/registry.pid"

# 检测注册表是否存活
if ! curl -s -o /dev/null -w "" "http://127.0.0.1:$REGISTRY_PORT/agents" 2>/dev/null; then
    echo "[$(date)] 注册表无响应，尝试重启..."
    
    # 清理旧进程
    if [ -f "$PIDFILE" ]; then
        OLD_PID=$(cat "$PIDFILE")
        kill "$OLD_PID" 2>/dev/null || true
    fi
    
    # 启动新实例
    cd "$REGISTRY_DIR"
    nohup node registry.js >> registry.log 2>&1 &
    NEW_PID=$!
    echo "$NEW_PID" > "$PIDFILE"
    
    sleep 2
    if curl -s -o /dev/null -w "" "http://127.0.0.1:$REGISTRY_PORT/agents" 2>/dev/null; then
        echo "[$(date)] ✅ 注册表已自动恢复 (PID: $NEW_PID)"
    else
        echo "[$(date)] ❌ 注册表重启失败"
    fi
else
    # 更新 PID 文件
    PID=$(ps aux | grep "[r]egistry.js" | awk '{print $2}')
    [ -n "$PID" ] && echo "$PID" > "$PIDFILE"
fi
