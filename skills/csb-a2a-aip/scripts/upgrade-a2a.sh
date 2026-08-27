#!/bin/bash
# A2A 一键升级脚本
# 用法: curl -sSL https://raw.githubusercontent.com/.../upgrade-a2a.sh | bash

set -e

echo "🚀 A2A 升级脚本"
echo "================"

A2A_DIR="/home/node/.openclaw/workspace/csb-a2a-aip"

# 1. 检查目录
if [ ! -d "$A2A_DIR" ]; then
    echo "❌ A2A 目录不存在: $A2A_DIR"
    exit 1
fi

cd "$A2A_DIR"

# 2. 备份
BACKUP_DIR="/tmp/a2a-backup-$(date +%Y%m%d-%H%M%S)"
echo "📦 备份当前版本到: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp -r *.js "$BACKUP_DIR/" 2>/dev/null || true

# 3. 拉取最新代码
echo "📥 拉取最新代码..."
git fetch origin
git pull origin main || git pull github main

# 4. 更新 identity.json (如果需要)
if [ -f "identity.json" ]; then
    echo "📝 检查 identity.json..."
    if ! grep -q "a2a.upgrade" identity.json; then
        echo "添加 a2a.upgrade 能力..."
        # 使用 jq 或 sed 添加能力
        if command -v jq &> /dev/null; then
            tmp=$(mktemp)
            jq '.capabilities["a2a.upgrade"] = true' identity.json > "$tmp"
            mv "$tmp" identity.json
        else
            echo "⚠️  jq 未安装，请手动更新 identity.json"
        fi
    fi
fi

# 5. 重启服务
echo "🔄 重启 A2A 服务..."
if [ -f "./start.sh" ]; then
    ./start.sh
else
    echo "⚠️  start.sh 不存在，请手动重启"
fi

# 6. 健康检查
echo "🏥 健康检查..."
sleep 3
HEALTH=$(curl -s http://localhost:3100/health 2>/dev/null || echo "{}")

if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo "✅ 升级成功!"
    echo "版本: $(echo "$HEALTH" | grep -o '"version":"[^"]*"')"
else
    echo "⚠️  健康检查失败，请检查日志"
fi

echo ""
echo "完成! 🌸"
