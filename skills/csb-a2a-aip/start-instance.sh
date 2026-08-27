#!/bin/bash
# A2A 实例启动脚本 - 支持多实例目录

A2A_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${A2A_DIR}/logs"
INSTANCE_DIR="$1"

if [ -z "${INSTANCE_DIR}" ]; then
    echo "❌ 用法: $0 <实例目录>"
    exit 1
fi

# 读取实例名称和端口
INSTANCE_NAME=$(node -e "try { console.log(require('${INSTANCE_DIR}/identity.json').name || 'unknown') } catch(e) { console.log('unknown') }")
PORT=$(node -e "try { console.log(require('${INSTANCE_DIR}/identity.json').port || 3100) } catch(e) { console.log('3100') }")
PID_FILE="${INSTANCE_DIR}/server.pid"

echo "🔍 [${INSTANCE_NAME}] 检查端口 ${PORT} 是否被占用..."

# 🔍 端口冲突检测
if command -v lsof &>/dev/null; then
    EXISTING_PID=$(lsof -ti:${PORT} 2>/dev/null || echo "")
    if [ -n "${EXISTING_PID}" ]; then
        # 检查是否是自己的 PID 文件记录的进程
        if [ -f "${PID_FILE}" ]; then
            OLD_PID=$(cat "${PID_FILE}")
            if [ "${EXISTING_PID}" = "${OLD_PID}" ] && kill -0 "${OLD_PID}" 2>/dev/null; then
                echo "✅ [${INSTANCE_NAME}] 端口 ${PORT} 已被自己的进程占用 (PID: ${OLD_PID})"
                exit 0
            fi
        fi
        EXISTING_PROC=$(ps -p ${EXISTING_PID} -o comm= 2>/dev/null || echo "unknown")
        echo "❌ [${INSTANCE_NAME}] 端口 ${PORT} 已被其他进程占用 (PID: ${EXISTING_PID}, 进程: ${EXISTING_PROC})"
        exit 1
    fi
fi

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

# 启动新进程
mkdir -p "${LOG_DIR}"
echo "🚀 [${INSTANCE_NAME}] 启动 A2A Server (端口: $PORT)..."
cd "${A2A_DIR}"
A2A_IDENTITY_PATH="${INSTANCE_DIR}/identity.json" nohup node server_v5.js > "${LOG_DIR}/server-${PORT}.log" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "${PID_FILE}"

sleep 2

# 检查是否启动成功
if kill -0 "$NEW_PID" 2>/dev/null; then
    echo "✅ [${INSTANCE_NAME}] A2A Server 已启动 (PID: $NEW_PID, 端口: $PORT)"
    echo "   测试: curl http://localhost:${PORT}/health"
else
    echo "❌ [${INSTANCE_NAME}] 启动失败，请检查日志："
    echo "   cat ${LOG_DIR}/server-${PORT}.log"
    exit 1
fi
