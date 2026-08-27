#!/bin/bash
# A2A v5 实例启动脚本 - 分层提示词 + LLM Router 版
# 用法: bash start-v5.sh ruolan

A2A_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${A2A_DIR}/logs"
INSTANCE_DIR="$1"

if [ -z "${INSTANCE_DIR}" ]; then
    echo "❌ 用法: $0 <实例目录>"
    echo "   实例: ruolan, ruolan-academic, ..."
    echo "   或: $0 instances/ruolan"
    exit 1
fi

# 支持简写
if [[ "${INSTANCE_DIR}" != instances/* && "${INSTANCE_DIR}" != */identity.json ]]; then
    INSTANCE_DIR="instances/${INSTANCE_DIR}"
fi
if [[ "${INSTANCE_DIR}" == */identity.json ]]; then
    INSTANCE_DIR="$(dirname "${INSTANCE_DIR}")"
fi

INSTANCE_DIR="${A2A_DIR}/${INSTANCE_DIR}"
INSTANCE_NAME=$(node -e "try { console.log(require('${INSTANCE_DIR}/identity.json').name || 'unknown') } catch(e) { console.log('unknown') }")
PORT=$(node -e "try { console.log(require('${INSTANCE_DIR}/identity.json').port || 3100) } catch(e) { console.log('3100') }")
PID_FILE="${INSTANCE_DIR}/server.pid"

echo "🔍 [${INSTANCE_NAME}] 检查端口 ${PORT} 是否被占用..."

# 停止旧进程
if [ -f "${PID_FILE}" ]; then
    OLD_PID=$(cat "${PID_FILE}")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "🛑 [${INSTANCE_NAME}] 停止旧进程 (PID: $OLD_PID)..."
        kill "$OLD_PID"
        sleep 2
    fi
    rm -f "${PID_FILE}"
fi

# 启动 v5 Server
mkdir -p "${LOG_DIR}"
echo "🚀 [${INSTANCE_NAME}] 启动 A2A v5 Server (端口: $PORT)..."
cd "${A2A_DIR}"
A2A_IDENTITY_PATH="${INSTANCE_DIR}/identity.json" nohup node server_v5.js > "${LOG_DIR}/server-v5-${PORT}.log" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "${PID_FILE}"

sleep 3

if kill -0 "$NEW_PID" 2>/dev/null; then
    echo "✅ [${INSTANCE_NAME}] A2A v5 Server 已启动 (PID: $NEW_PID, 端口: $PORT)"
    echo "   测试: curl http://localhost:${PORT}/health"
else
    echo "❌ [${INSTANCE_NAME}] 启动失败，请检查日志："
    echo "   cat ${LOG_DIR}/server-v5-${PORT}.log"
    exit 1
fi
