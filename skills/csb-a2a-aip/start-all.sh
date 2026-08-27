#!/bin/bash
# A2A 主启动脚本 - 支持多实例和单实例模式

A2A_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTANCES_DIR="${A2A_DIR}/instances"

usage() {
    echo "用法: $0 [选项] [实例名称]"
    echo ""
    echo "选项:"
    echo "  --all          启动所有实例"
    echo "  --list         列出所有可用实例"
    echo "  --stop [name]  停止指定实例（不加名称停止所有）"
    echo "  --status       显示所有实例状态"
    echo ""
    echo "示例:"
    echo "  $0 --list                  # 列出实例"
    echo "  $0 --all                   # 启动所有"
    echo "  $0 ruolan                  # 启动若兰"
    echo "  $0 --stop ruolan           # 停止若兰"
}

# 列出所有实例
list_instances() {
    if [ ! -d "${INSTANCES_DIR}" ]; then
        echo "⚠️  实例目录不存在: ${INSTANCES_DIR}"
        return
    fi
    
    echo "📋 可用实例："
    for dir in "${INSTANCES_DIR}"/*/; do
        if [ -d "$dir" ] && [ -f "${dir}identity.json" ]; then
            NAME=$(node -e "try { console.log(require('${dir}identity.json').name || '?') } catch(e) { console.log('?') }")
            PORT=$(node -e "try { console.log(require('${dir}identity.json').port || '?') } catch(e) { console.log('?') }")
            PUBLIC_HOST=$(node -e "try { console.log(require('${dir}identity.json').publicHost || '-') } catch(e) { console.log('-') }")
            echo "  - $(basename "$dir") | ${NAME} | 端口: ${PORT} | 主机: ${PUBLIC_HOST}"
        fi
    done
}

# 显示所有实例状态
show_status() {
    if [ ! -d "${INSTANCES_DIR}" ]; then
        echo "⚠️  实例目录不存在"
        return
    fi
    
    echo "📊 实例状态："
    for dir in "${INSTANCES_DIR}"/*/; do
        if [ -d "$dir" ] && [ -f "${dir}identity.json" ]; then
            PORT=$(node -e "try { console.log(require('${dir}identity.json').port || '?') } catch(e) { console.log('?') }")
            PID_FILE="${A2A_DIR}/server.pid"
            
            if [ -f "${PID_FILE}" ]; then
                PID=$(cat "${PID_FILE}")
                if kill -0 "$PID" 2>/dev/null; then
                    echo "  ✅ 端口 ${PORT} - 运行中 (PID: ${PID})"
                else
                    echo "  ❌ 端口 ${PORT} - 已停止"
                fi
            else
                echo "  ⏸️  端口 ${PORT} - 未启动"
            fi
        fi
    done
}

# 停止所有实例
stop_all() {
    echo "🛑 停止所有 A2A 实例..."
    
    # 尝试停止 PID 文件记录的进程
    if [ -f "${A2A_DIR}/server.pid" ]; then
        PID=$(cat "${A2A_DIR}/server.pid")
        if kill -0 "$PID" 2>/dev/null; then
            echo "  停止 PID: $PID"
            kill "$PID"
        fi
        rm -f "${A2A_DIR}/server.pid"
    fi
    
    # 也停止所有实例目录中的 PID
    if [ -d "${INSTANCES_DIR}" ]; then
        for dir in "${INSTANCES_DIR}"/*/; do
            if [ -d "$dir" ] && [ -f "${dir}server.pid" ]; then
                PID=$(cat "${dir}server.pid")
                if kill -0 "$PID" 2>/dev/null; then
                    PORT=$(node -e "try { console.log(require('${dir}identity.json').port || '?') } catch(e) { console.log('?') }")
                    echo "  停止实例 $(basename "$dir") (端口: ${PORT}, PID: ${PID})"
                    kill "$PID"
                fi
                rm -f "${dir}server.pid"
            fi
        done
    fi
}

# 启动所有实例
start_all() {
    if [ ! -d "${INSTANCES_DIR}" ]; then
        echo "⚠️  实例目录不存在，使用传统模式启动"
        bash "${A2A_DIR}/start.sh"
        return
    fi
    
    echo "🚀 启动所有 A2A 实例..."
    for dir in "${INSTANCES_DIR}"/*/; do
        if [ -d "$dir" ] && [ -f "${dir}identity.json" ]; then
            echo ""
            bash "${A2A_DIR}/start-instance.sh" "$dir"
        fi
    done
}

# 处理参数
case "$1" in
    --all)
        start_all
        ;;
    --list)
        list_instances
        ;;
    --status)
        show_status
        ;;
    --stop)
        if [ -n "$2" ]; then
            # 停止指定实例
            if [ -d "${INSTANCES_DIR}/$2" ] && [ -f "${INSTANCES_DIR}/$2/server.pid" ]; then
                PID=$(cat "${INSTANCES_DIR}/$2/server.pid")
                if kill -0 "$PID" 2>/dev/null; then
                    echo "🛑 停止实例 $2 (PID: ${PID})..."
                    kill "$PID"
                fi
                rm -f "${INSTANCES_DIR}/$2/server.pid"
            else
                echo "⚠️  实例 $2 未运行或不存在"
            fi
        else
            stop_all
        fi
        ;;
    --help|-h)
        usage
        ;;
    "")
        # 无参数，使用传统模式
        bash "${A2A_DIR}/start.sh"
        ;;
    *)
        # 指定实例名称
        INSTANCE_DIR="${INSTANCES_DIR}/$1"
        if [ -d "${INSTANCE_DIR}" ] && [ -f "${INSTANCE_DIR}/identity.json" ]; then
            bash "${A2A_DIR}/start-instance.sh" "${INSTANCE_DIR}"
        else
            echo "❌ 实例 '$1' 不存在"
            echo ""
            list_instances
        fi
        ;;
esac
