#!/bin/bash
# A2A Server 启动脚本

A2A_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${A2A_DIR}/logs"
PID_FILE="${A2A_DIR}/server.pid"

# 检查 identity.json
if [ ! -f "${A2A_DIR}/identity.json" ]; then
    echo "❌ 错误：找不到 identity.json"
    echo ""
    echo "请复制 identity.example.json 并修改："
    echo "  cp identity.example.json identity.json"
    echo "  # 编辑 identity.json，填入你的配置"
    exit 1
fi

# 创建日志目录
mkdir -p "${LOG_DIR}"

# 🔧 端口冲突检测
PORT=$(node -e "console.log(require('./identity.json').port || 3100)")
echo "🔍 检查端口 ${PORT} 是否被占用..."

# 检查是否有其他进程占用此端口
EXISTING_PID=$(lsof -ti:${PORT} 2>/dev/null || echo "")
if [ -n "${EXISTING_PID}" ]; then
    # 检查是否是自己的 PID 文件记录的进程
    if [ -f "${PID_FILE}" ]; then
        OLD_PID=$(cat "${PID_FILE}")
        if [ "${EXISTING_PID}" = "${OLD_PID}" ] && kill -0 "${OLD_PID}" 2>/dev/null; then
            echo "✅ 端口 ${PORT} 已被自己的进程占用 (PID: ${OLD_PID})"
        fi
    fi
    # 如果不是自己的进程，说明有冲突
    if [ "${EXISTING_PID}" != "${OLD_PID:-}" ] || ! kill -0 "${EXISTING_PID}" 2>/dev/null; then
        EXISTING_PROC=$(ps -p ${EXISTING_PID} -o comm= 2>/dev/null || echo "unknown")
        echo "❌ 端口 ${PORT} 已被其他进程占用 (PID: ${EXISTING_PID}, 进程: ${EXISTING_PROC})"
        echo "⚠️  可能是重复的 A2A 实例，拒绝启动"
        echo "如需覆盖，请手动 kill ${EXISTING_PID} 后重新运行"
        exit 1
    fi
fi

# 停止旧进程
if [ -f "${PID_FILE}" ]; then
    OLD_PID=$(cat "${PID_FILE}")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "🛑 停止旧进程 (PID: $OLD_PID)..."
        kill "$OLD_PID"
        sleep 2
    fi
    rm -f "${PID_FILE}"
fi

# 启动新进程（v5 分层提示词 + LLM Router 版）
echo "🚀 启动 A2A Server (v5 分层提示词版)..."
cd "${A2A_DIR}"
nohup node server_v5.js > "${LOG_DIR}/server.log" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "${PID_FILE}"

sleep 2

# 检查是否启动成功
if kill -0 "$NEW_PID" 2>/dev/null; then
    # 从 identity.json 读取端口
    PORT=$(node -e "console.log(require('./identity.json').port || 3100)")
    echo "✅ A2A Server 已启动 (PID: $NEW_PID, 端口: $PORT)"
    echo ""
    echo "测试命令："
    echo "  curl http://localhost:${PORT}/health"
else
    echo "❌ 启动失败，请检查日志："
    echo "  cat ${LOG_DIR}/server.log"
fi