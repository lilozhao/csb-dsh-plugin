#!/bin/bash
# csb-rename.sh — 一键改名(安装即用后想改名,一条命令)
# 用法: bash scripts/csb-rename.sh <新名字> <新slug>
# 示例: bash scripts/csb-rename.sh 若邻 ruolin
# 效果: 改 agent.json → 自动重签 AID(同一密钥)/同步 identity → 清理注册表旧身份(幽灵)→ 提示重启 server
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
A2A_DIR="${CSB_A2A_DIR:-/workspace/csb-a2a-aip}"
AGENT_FILE="$A2A_DIR/agent.json"
LIB="$PLUGIN_DIR/lib/index.js"

if [ $# -lt 2 ]; then
  echo "用法: bash scripts/csb-rename.sh <新名字> <新slug>"
  echo "示例: bash scripts/csb-rename.sh 若邻 ruolin"
  exit 1
fi
NEW_NAME="$1"
NEW_SLUG="$2"

if [ ! -f "$AGENT_FILE" ]; then
  echo "❌ agent.json 不存在($AGENT_FILE)——先跑 csb-setup.sh 初始化"
  exit 1
fi

OLD_NAME=$(node -e "try{console.log(require('$AGENT_FILE').name)}catch{echo '?'}")
OLD_SLUG=$(node -e "try{console.log(require('$AGENT_FILE').slug)}catch{console.log('?')}")
echo "🪪  改名: ${OLD_NAME:-?}/${OLD_SLUG:-?} → ${NEW_NAME}/${NEW_SLUG}"

node --input-type=module -e "
import('$LIB').then(async (m) => {
  const fs = require('node:fs');
  const path = '$AGENT_FILE';
  const doc = JSON.parse(fs.readFileSync(path, 'utf8'));
  const oldAgentId = \`\${doc.name}@\${doc.publicHost || '127.0.0.1'}:\${doc.port || 3100}\`;
  doc.name = '$NEW_NAME';
  doc.slug = '$NEW_SLUG';
  fs.writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  // 重签 AID / 同步 identity(插件内置,同一密钥,kid 保留)
  const created = m.provisionIdentityFiles();
  console.log(created.length
    ? '✅ 已重新生成/同步:\n  ' + created.join('\n  ')
    : '✅ 身份文件已同步(无变更)');
  // 清理注册表旧身份(坑 9 幽灵条目)
  if (oldAgentId) {
    const r = await m.cleanupRegistryGhost(oldAgentId);
    console.log(r.ok
      ? '✅ 注册表旧身份已清理: ' + oldAgentId
      : 'ℹ️ 旧身份清理跳过: ' + (r.reason ?? 'HTTP ' + r.status));
  }
  console.log('ℹ️  重启 A2A server 生效: bash scripts/start-' + doc.slug + '-a2a.sh(或面板「启动服务」)');
}).catch((e) => { console.error('❌ 改名失败:', e.message); process.exit(1); });
"
