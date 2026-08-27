#!/bin/bash
# ═══════════════════════════════════════════════════════
# CSB A2A Server v5 启动+守护脚本
# ═══════════════════════════════════════════════════════
# 功能:
#   1. 启动本地注册表 (registry.js, port 3099)
#   2. 启动 A2A Server (server_v5.js, port 3100)
#   3. 自动加载 delegation-manager.js（信任配置）
#   4. 健康检查 + 自动重启
# ═══════════════════════════════════════════════════════

A2A_DIR="/home/node/.openclaw/workspace/csb-a2a-aip"
LOG_DIR="$A2A_DIR/logs"
REGISTRY_PORT=${REGISTRY_PORT:-3099}
A2A_PORT=${A2A_PORT:-3100}
REGISTRY_LOG="$LOG_DIR/registry.log"
SERVER_LOG="$LOG_DIR/server.log"
WATCHDOG_LOG="$LOG_DIR/watchdog.log"

mkdir -p "$LOG_DIR"

# ============================================
# 颜色输出
# ============================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()   { log "${GREEN}✅ $1${NC}"; }
warn() { log "${YELLOW}⚠️  $1${NC}"; }
err()  { log "${RED}❌ $1${NC}"; }

# ============================================
# 1. 注册表服务管理
# ============================================
start_registry() {
    if lsof -ti:$REGISTRY_PORT 2>/dev/null | grep -q .; then
        ok "注册表已在运行 (端口 $REGISTRY_PORT)"
        return 0
    fi

    warn "注册表未运行，正在启动..."
    cd "$A2A_DIR"
    nohup node registry.js > "$REGISTRY_LOG" 2>&1 &
    local pid=$!
    sleep 2

    if kill -0 $pid 2>/dev/null; then
        ok "注册表已启动 (PID: $pid, 端口: $REGISTRY_PORT)"
    else
        err "注册表启动失败，检查 $REGISTRY_LOG"
        cat "$REGISTRY_LOG" | tail -5
        return 1
    fi
}

# ============================================
# 2. A2A Server 服务管理
# ============================================
start_server() {
    if curl -s "http://localhost:$A2A_PORT/health" --connect-timeout 2 > /dev/null 2>&1; then
        local info=$(curl -s "http://localhost:$A2A_PORT/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('identity','?')} (PID: {d.get('pid','?')})\")" 2>/dev/null)
        ok "A2A Server 已在运行 - $info"
        return 0
    fi

    warn "A2A Server 未运行，正在启动..."
    export A2A_PORT=$A2A_PORT
    export WORKSPACE=$HOME/.openclaw/workspace
    cd "$SCRIPT_DIR"
    nohup node server_v5.js > "$SERVER_LOG" 2>&1 &
    local pid=$!
    echo $pid > "$A2A_DIR/server.pid"
    sleep 3

    # 验证启动
    if curl -s "http://localhost:$A2A_PORT/health" --connect-timeout 2 > /dev/null 2>&1; then
        ok "A2A Server 已启动 (PID: $pid, 端口: $A2A_PORT)"
        return 0
    else
        err "A2A Server 启动失败，检查 $SERVER_LOG"
        cat "$SERVER_LOG" | tail -10
        return 1
    fi
}

# ============================================
# 3. 验证 delegation-manager 加载
# ============================================
verify_delegation() {
    local dm_file="$A2A_DIR/delegation-manager.js"
    if [ ! -f "$dm_file" ]; then
        err "delegation-manager.js 不存在，请从 Gitee 拉取"
        return 1
    fi

    local result=$(node -e "
        const dm = require('$dm_file');
        const dmgr = new dm.DelegationManager({ storePath: '/tmp/a2a_delegations.json' });
        dmgr.loadFromFile();
        const status = dmgr.getStatus();
        console.log('信任数: ' + status.trustCount);
        status.trusts.forEach(t => console.log('  ' + t.grantor + ' → ' + t.grantee + ' (' + t.scope + ', ' + t.level + ')'));
    " 2>/dev/null)

    if [ $? -eq 0 ]; then
        ok "delegation-manager.js 加载正常"
        echo "$result" | while read line; do log "  $line"; done
        return 0
    else
        warn "delegation-manager.js 加载异常"
        return 1
    fi
}

# ============================================
# 4. 注册到本地注册表
# ============================================
register_agents() {
    local agents_json=$(curl -s "http://localhost:$REGISTRY_PORT/register" --connect-timeout 3 2>/dev/null)
    if [ $? -ne 0 ]; then
        warn "注册表不可用，跳过注册"
        return 1
    fi
    ok "注册表服务正常"
}

# ============================================
# 5. 守护监控（用于 watchdog 模式）
# ============================================
watchdog_loop() {
    ok "进入守护模式 (每30秒检查一次)"
    while true; do
        # 检查 A2A Server
        if ! curl -s "http://localhost:$A2A_PORT/health" --connect-timeout 3 > /dev/null 2>&1; then
            warn "A2A Server 已停止，尝试重启..."
            start_server
        fi

        # 检查注册表
        if ! curl -s "http://localhost:$REGISTRY_PORT/register" --connect-timeout 3 > /dev/null 2>&1; then
            warn "注册表已停止，尝试重启..."
            start_registry
        fi

        sleep 30
    done
}

# ============================================
# 停止服务
# ============================================
stop_services() {
    warn "正在停止服务..."

    # 停止 A2A Server
    local server_pid=$(cat "$A2A_DIR/server.pid" 2>/dev/null)
    if [ -n "$server_pid" ]; then
        kill $server_pid 2>/dev/null
        rm -f "$A2A_DIR/server.pid"
        ok "A2A Server 已停止"
    fi

    # 停止注册表
    lsof -ti:$REGISTRY_PORT 2>/dev/null | xargs kill 2>/dev/null
    ok "注册表已停止"
}

# ============================================
# 状态查看
# ============================================
show_status() {
    echo ""
    log "${CYAN}═══════════════ CSB A2A 服务状态 ═══════════════${NC}"

    # A2A Server
    local server_info=$(curl -s "http://localhost:$A2A_PORT/health" --connect-timeout 2 2>/dev/null)
    if [ -n "$server_info" ]; then
        echo "$server_info" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'  A2A Server:  {d.get(\"identity\",\"?\")}  ✅ 运行中')
print(f'  版本:        {d.get(\"version\",\"?\")}')
print(f'  运行时长:    {int(d.get(\"uptime\",0)/3600)}h {int(d.get(\"uptime\",0)%3600/60)}m')
print(f'  总任务数:    {d.get(\"tasks\",{}).get(\"total\",0)}')
" 2>/dev/null
    else
        echo "  A2A Server:  ❌ 未运行"
    fi

    # 注册表
    if lsof -ti:$REGISTRY_PORT 2>/dev/null | grep -q .; then
        local reg_count=$(python3 -c "import json; d=json.load(open('/tmp/a2a_registry.json')); print(len(d.get('agents',[])))" 2>/dev/null)
        echo "  注册表:      ✅ 运行中 (端口 $REGISTRY_PORT, $reg_count Agent)"
    else
        echo "  注册表:      ❌ 未运行"
    fi

    # Delegation
    if [ -f "$A2A_DIR/delegation-manager.js" ]; then
        local trust_count=$(node -e "try{const d=require('$A2A_DIR/delegation-manager.js');const m=new d.DelegationManager({storePath:'$A2A_DIR/data/delegations.json'});m.loadFromFile();console.log(m.getStatus().trustCount)}catch(e){console.log('?')}" 2>/dev/null)
        echo "  授权委托:    ✅ delegation-manager.js ($trust_count 信任)"
    else
        echo "  授权委托:    ❌ delegation-manager.js 未安装"
    fi

    # PID
    local pid=$(cat "$A2A_DIR/server.pid" 2>/dev/null)
    if [ -n "$pid" ]; then
        echo "  PID:         $pid"
    fi

    log "${CYAN}════════════════════════════════════════════════${NC}"
    echo ""
}

# ============================================
# 主入口
# ============================================
case "${1:-start}" in
    start)
        echo ""
        log "${CYAN}🚀 CSB A2A 服务启动中...${NC}"
        echo ""
        start_registry
        start_server
        verify_delegation
        echo ""
        ok "全部服务已启动"
        show_status
        ;;

    watch|watchdog|daemon)
        start
        watchdog_loop
        ;;

    stop)
        stop_services
        ;;

    restart)
        stop_services
        sleep 1
        exec "$0" start
        ;;

    status)
        show_status
        ;;

    verify)
        verify_delegation
        ;;

    *)
        echo "用法: $0 {start|stop|restart|status|watchdog|verify}"
        echo ""
        echo "  start     启动注册表 + A2A Server + 验证委托"
        echo "  stop      停止全部服务"
        echo "  restart   重启"
        echo "  status    查看状态"
        echo "  watchdog  启动 + 守护监控（每30秒检查）"
        echo "  verify    验证 delegation-manager.js"
        ;;
esac
