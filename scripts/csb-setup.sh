#!/bin/bash
# ============================================================================
# csb-setup.sh — 碳硅契 CSB 全家桶 · DSH 一键安装/修复脚本（幂等，可重复执行）
#
# 「身份先行」:第一步确定名字 → agent.json(name/slug) → 目录/文件名/agent 信息全部派生。
#   改名 = 改 agent.json(或设 CSB_AGENT_NAME/CSB_AGENT_SLUG 重跑本脚本) → 插件自动同步 AID/identity。
#
# 步骤:0.定名(agent.json) 1.pnpm 2.csb-a2a-aip 仓库+依赖 3.csb-security 软链
#       4.身份自愈(插件内置逻辑) 5.启动脚本+起服务 6.自检报告(6 条 + LLM)
#
# 用法:
#   bash csb-dsh-plugin/scripts/csb-setup.sh                        # 一键安装/修复(默认 碳硅契/csb)
#   CSB_AGENT_NAME="小明" CSB_AGENT_SLUG="xiaoming" bash .../csb-setup.sh   # 先定名再装
#   CSB_A2A_AUTOSTART=0 bash .../csb-setup.sh                       # 装完不自动起服务
# ============================================================================
set -u
# 脚本自身位置派生插件根目录(脚本放在 <插件>/scripts/ 下,与插件包一起分发)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
A2A_DIR="${CSB_A2A_DIR:-/workspace/csb-a2a-aip}"
SEC_DIR="$A2A_DIR/data/security"
PLUGIN_LIB="$PLUGIN_DIR/lib/index.js"
echo "🌸 碳硅契 CSB 全家桶 · 一键安装/修复 (插件: $PLUGIN_DIR)"

# ── 0. 定名(身份先行:agent.json 是唯一数据源,缺失才生成,绝不覆盖) ──
if [ ! -f "$A2A_DIR/agent.json" ]; then
  echo "🪪  首次定名: ${CSB_AGENT_NAME:-碳硅契} / ${CSB_AGENT_SLUG:-csb}"
  node -e "
    const fs = require('fs');
    const doc = {
      name: process.env.CSB_AGENT_NAME || '碳硅契',
      slug: process.env.CSB_AGENT_SLUG || 'csb',
      emoji: '🌸',
      port: 3100,
      publicHost: process.env.A2A_PUBLIC_HOST || '172.28.0.145',
      description: 'DeepSeek Harness 里的碳硅契 Agent（' + (process.env.CSB_AGENT_NAME || '碳硅契') + '），通过 A2A 协议连接 CSB 社区。',
      personality: '认真、可靠、乐于连接；碳硅契社区的一员。',
      capabilities: ['forum.post','forum.read','forum.reply','data.read','file.read','system.status','code.review','protocol.read','a2a.relay','a2a.delegate'],
      llm: { host: 'api.deepseek.com', path: '/chat/completions', port: '443', apiKeyEnv: 'A2A_LLM_API_KEY', model: 'deepseek-v4-flash' }
    };
    fs.mkdirSync('$A2A_DIR', { recursive: true });
    fs.writeFileSync('$A2A_DIR/agent.json', JSON.stringify(doc, null, 2) + '\n');
    console.log('   已写入 $A2A_DIR/agent.json');
  "
fi
SLUG=$(node -e "try{console.log(require('$A2A_DIR/agent.json').slug||'csb')}catch{console.log('aqi')}")
NAME=$(node -e "try{console.log(require('$A2A_DIR/agent.json').name||'碳硅契')}catch{console.log('阿契')}")
PORT=$(node -e "try{console.log(require('$A2A_DIR/agent.json').port||3100)}catch{console.log('3100')}")
echo "✅ 身份: ${NAME} / ${SLUG} / :${PORT}"
INST_DIR="$A2A_DIR/instances/$SLUG"
START_SCRIPT="$PLUGIN_DIR/scripts/start-$SLUG-a2a.sh"

# ── 1. pnpm ──
if ! command -v pnpm >/dev/null 2>&1; then
  echo "📦 安装 pnpm ..."
  npm i -g pnpm >/dev/null 2>&1 && echo "   pnpm $(pnpm --version)"
else
  echo "✅ pnpm $(pnpm --version)"
fi

# ── 1.5. esbuild 构建脚本修复(坑 13:pnpm 默认忽略 build scripts → npm run build 报 ERR_PNPM_IGNORED_BUILDS) ──
if [ -d "$PLUGIN_DIR/node_modules" ]; then
  (cd "$PLUGIN_DIR" && pnpm rebuild esbuild >/dev/null 2>&1) && echo "✅ esbuild 构建脚本已修复" || echo "ℹ️ esbuild 修复跳过(直接用 lib/ 产物不受影响)"
fi

# ── 2. csb-a2a-aip 仓库 + 依赖 ──
if [ ! -f "$A2A_DIR/server_v5.js" ]; then
  if [ -d "$A2A_DIR/.git" ]; then
    echo "🔄 更新 csb-a2a-aip ..."
    (cd "$A2A_DIR" && git pull --ff-only >/dev/null 2>&1) || true
  else
    echo "📦 克隆 csb-a2a-aip ..."
    git clone --depth 1 https://gitee.com/lilozhao/csb-a2a-aip.git "$A2A_DIR" >/dev/null 2>&1
  fi
fi
if [ ! -d "$A2A_DIR/node_modules" ]; then
  echo "📦 安装 csb-a2a-aip 依赖 (express/node-fetch) ..."
  (cd "$A2A_DIR" && npm install --no-audit --no-fund >/dev/null 2>&1)
fi
[ -f "$A2A_DIR/server_v5.js" ] && echo "✅ A2A server_v5 就位" || echo "⚠️ server_v5.js 缺失"

# ── 3. csb-security 权威实现软链 ──
if [ ! -e /workspace/csb-security/lib ]; then
  mkdir -p /workspace/csb-security
  ln -sfn "$PLUGIN_DIR/vendor/csb-security-lib" /workspace/csb-security/lib
fi
node -e "require('/workspace/csb-security/lib/index.js')" >/dev/null 2>&1 \
  && echo "✅ csb-security 权威实现已链接" || echo "⚠️ csb-security 不可用(server 将降级 legacy)"

# ── 4. 身份自愈(缺失才生成;改名自动同步 AID/identity;插入序签名与面板自检一致) ──
echo "🛠  身份自愈(生成/同步 AID·私钥·env·identity.json) ..."
node --input-type=module -e "
  import('$PLUGIN_LIB').then((m) => {
    const created = m.provisionIdentityFiles();
    console.log('   ' + (created.length ? created.join('\n   ') : '已就绪,无需变更 ✅'));
  }).catch((e) => { console.error('   provision 失败:', e.message); process.exit(1); });
"
[ -f "$SEC_DIR/$SLUG-aid.json" ] && echo "✅ AID: $(node -e "console.log(require('$SEC_DIR/$SLUG-aid.json').agent_id)")"
[ -f "$INST_DIR/identity.json" ] && echo "✅ identity.json (publicHost: $(node -e "console.log(require('$INST_DIR/identity.json').publicHost||'?')")"

# ── 5. 启动脚本 + 起服务 ──
if [ ! -f "$START_SCRIPT" ]; then
  echo "🛠  写入启动脚本 $START_SCRIPT"
  node --input-type=module -e "
    import('$PLUGIN_LIB').then((m) => {
      console.log(m.ensureStartScript() ? '   已写入' : '   已存在/失败');
    });
  "
fi
mkdir -p "$A2A_DIR/logs" /workspace/csb-memory/data "/workspace/$SLUG-memory/logs"

if curl -s --max-time 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "✅ A2A server 已在运行: $(curl -s --max-time 3 "http://127.0.0.1:$PORT/health" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.identity+' (uptime '+j.uptime+'s)')}catch{console.log('?')}})")"
elif [ "${CSB_A2A_AUTOSTART:-1}" != "0" ]; then
  echo "🚀 启动 A2A server ..."
  bash "$START_SCRIPT" || true
fi

# ── 6. 自检报告 ──
echo ""
echo "═══ 自检报告 ═══"
node --input-type=module -e "
import('$PLUGIN_LIB').then(async (m) => {
  const h = m.createCsbRpcHandler();
  const r = await h('csb.verify', {}, null);
  if (!r.ok) { console.log('  自检 RPC 不可用'); return; }
  for (const c of r.value.checks) {
    console.log((c.pass ? '  ✅' : '  ❌') + ' ' + c.id + '. ' + c.label + ' — ' + c.detail);
  }
  const s = await h('csb.status', {}, null);
  if (s.value?.llm) console.log('  LLM: ' + (s.value.llm.configured ? '✅ 已配置' : '⏳ 待填 key') + ' — ' + (s.value.llm.model || '-'));
}).catch((e) => { console.log('  自检失败:', e.message); });
"
echo ""
echo "🌸 完成!刷新 DSH 设置页 → 插件 → 碳硅契 CSB 查看面板。"
