#!/bin/bash
# A2A Skill 更新脚本
# 从共享仓库拉取最新版本

A2A_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="${A2A_DIR}/backup"

echo "🔄 更新 A2A Skill..."

# 备份 identity.json
if [ -f "${A2A_DIR}/identity.json" ]; then
    mkdir -p "${BACKUP_DIR}"
    cp "${A2A_DIR}/identity.json" "${BACKUP_DIR}/identity.json.bak"
    echo "✅ 已备份 identity.json"
fi

# 拉取最新代码（如果有 Git 仓库）
if [ -d "${A2A_DIR}/.git" ]; then
    cd "${A2A_DIR}"
    git pull origin main
    echo "✅ 已从 Git 仓库更新"
else
    echo "⚠️  不是 Git 仓库，请手动更新"
fi

# 恢复 identity.json
if [ -f "${BACKUP_DIR}/identity.json.bak" ]; then
    cp "${BACKUP_DIR}/identity.json.bak" "${A2A_DIR}/identity.json"
    echo "✅ 已恢复 identity.json"
fi

echo "✨ 更新完成！"
echo ""
echo "运行 ./start.sh 启动服务"