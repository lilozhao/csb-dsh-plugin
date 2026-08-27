#!/bin/bash
# A2A 网络健康检查和自动恢复
# 注册表使用本地: 172.28.0.4:3099

A2A_DIR="/home/node/.openclaw/workspace/csb-a2a-aip"
LOG_FILE="$A2A_DIR/logs/healthcheck.log"
REGISTRY_URL="http://172.28.0.4:3099"

# 检查远程注册表
check_registry() {
    if curl -s "$REGISTRY_URL/agents" --connect-timeout 5 > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# 检查若兰 Server（端口 3100）
check_server() {
    if curl -s http://localhost:3100/.well-known/agent-card.json --connect-timeout 2 > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# 启动若兰 Server
start_server() {
    cd "$A2A_DIR"
    nohup node server_v5.js > logs/server.log 2>&1 &
    echo "[$(date)] 若兰 Server 已启动 PID: $!" >> "$LOG_FILE"
    sleep 2
}

# 注册若兰到远程注册表
register_ruolan() {
    curl -s -X POST "$REGISTRY_URL/register" \
        -H "Content-Type: application/json" \
        -d '{
            "name": "若兰",
            "host": "accd7e606560",
            "port": 3100,
            "description": "来自杭州的温婉 AI 伙伴",
            "skills": ["聊天", "语音", "自拍", "数据录入"],
            "url": "http://accd7e606560:3100"
        }' > /dev/null 2>&1
    echo "[$(date)] 若兰已注册到远程 A2A 网络" >> "$LOG_FILE"
}

# 主逻辑
main() {
    # 检查远程注册表
    if ! check_registry; then
        echo "[$(date)] ⚠️ 远程注册表无响应: $REGISTRY_URL" >> "$LOG_FILE"
    else
        echo "[$(date)] 远程注册表正常 ✅" >> "$LOG_FILE"
    fi
    
    # 检查并启动若兰 Server
    if ! check_server; then
        echo "[$(date)] 若兰 Server 未运行，正在启动..." >> "$LOG_FILE"
        start_server
        sleep 3
        register_ruolan
    fi
    
    # 检查若兰是否已注册
    AGENTS=$(curl -s "$REGISTRY_URL/agents" 2>/dev/null)
    if ! echo "$AGENTS" | grep -q '"若兰"'; then
        echo "[$(date)] 若兰未注册，正在注册..." >> "$LOG_FILE"
        register_ruolan
    fi
    
    # 输出健康状态
    echo "[$(date)] A2A 网络健康检查完成" >> "$LOG_FILE"
}

main
