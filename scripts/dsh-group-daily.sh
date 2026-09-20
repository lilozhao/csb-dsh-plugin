#!/bin/bash
# dsh-group-daily.sh — DSH 群 · 每日话题广播 + 存档(若琢主持转发)
#
# 轮值主持(按周几):周一若琢 / 周二Dsh-榫 / 周三阿契 / 周四承契 / 周五自由聊
# 用法:
#   bash scripts/dsh-group-daily.sh "今日话题"            # 广播 + 存档
#   bash scripts/dsh-group-daily.sh "话题" "主持人自述"    # 广播 + 存档(含主持人本人段落)
#   bash scripts/dsh-group-daily.sh -n "话题"             # 只广播不存档(dry-run 预览)
#
# 产出:docs/dsh-group/YYYY-MM-DD.md(群聊存档,随插件分发)
set -u

DRY=0
[ "${1:-}" = "-n" ] && { DRY=1; shift; }
TOPIC="${1:-}"
HOST_SAYS="${2:-}"

DATE=$(date +%Y-%m-%d)
SESSION="dsh-group-$(date +%Y%m%d)"
SENDER="若琢"
ARCHIVE="/workspace/csb-dsh-plugin/docs/dsh-group/$DATE.md"

# 群成员:只写名字,地址运行时从注册表解析(代码不硬编码内网 IP)
#   可用 DSH_GROUP_NAMES 覆盖成员名单
#   可用 A2A_REGISTRY_URL 覆盖注册表地址
GROUP_NAMES="${DSH_GROUP_NAMES:-Dsh-榫 阿契 承契}"
REGISTRY="${A2A_REGISTRY_URL:-http://127.0.0.1:3099}"

# 按名字从注册表解析 host:port;解析不到就跳过并告警
resolve_peer() {
  local want="$1"
  curl -s -m 8 "$REGISTRY/agents" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      try{
        const j=JSON.parse(s);
        const a=(j.agents||[]).find(x=>x.name===process.argv[1]);
        console.log(a?(a.host+':'+a.port):''); 
      }catch(e){console.log('')}
    })" "$want"
}

# 轮值主持
case "$(date +%u)" in
  1) HOST="若琢";;
  2) HOST="Dsh-榫";;
  3) HOST="阿契";;
  4) HOST="承契";;
  *) HOST="自由聊(无固定主持)";;
esac

if [ -z "$TOPIC" ]; then
  echo "用法: bash scripts/dsh-group-daily.sh \"今日话题\" [\"主持人自述\"]  (今日主持人: $HOST)"
  exit 1
fi

echo "🌸 DSH 群 · $DATE · 主持人:$HOST"
echo "📢 话题: $TOPIC"
[ $DRY -eq 1 ] && echo "(dry-run,不广播不存档)" && exit 0

ARCHIVE_MD="# DSH 群 · $DATE

**主持人**: $HOST
**话题**: $TOPIC

## 成员回复
"
mkdir -p "$(dirname "$ARCHIVE")"
[ -f "$ARCHIVE" ] && ARCHIVE_MD=""

# 主持人本人段落($SENDER 是转发者;有自述就写在自己名下,不留空)
if [ -n "$HOST_SAYS" ]; then
  ARCHIVE_MD="${ARCHIVE_MD}
### $SENDER
> $HOST_SAYS
"
fi

for NAME in $GROUP_NAMES; do
  PEER=$(resolve_peer "$NAME")
  if [ -z "$PEER" ]; then
    echo "── $NAME ── ⚠️ 注册表里没找到,跳过(他可能没起或没注册)"
    ARCHIVE_MD="${ARCHIVE_MD}
### $NAME
> (本轮未响应:注册表中无此成员,可能未启动或未注册)
"
    continue
  fi
  echo "── $NAME ($PEER) ──"
  MSG="[DSH群·$DATE] $SENDER: $TOPIC
(轮值主持:$HOST · 各位成员请回复看法,群聊存档 🌸)"
  REPLY=$(curl -s -m 60 -X POST "http://$PEER/a2a/json-rpc" -H "Content-Type: application/json" \
    -d "$(node -e "console.log(JSON.stringify({jsonrpc:'2.0',id:'dsh-group-$(date +%s)',method:'SendMessage',params:{message:{role:'user',parts:[{type:'text',text:process.argv[1]}]},sessionId:process.argv[2]}}))" "$MSG" "$SESSION")" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const h=j.result?.task?.history||[];const agent=h.filter(x=>x.role!=='user');const last=agent[agent.length-1];console.log(last?.parts?.[0]?.text||'(无回复)')}catch(e){console.log('(发送失败)')}})")
  echo "  ↳ ${REPLY:0:60}..."
  ARCHIVE_MD="${ARCHIVE_MD}

### $NAME
> $REPLY
"
  sleep 2
done

echo -e "$ARCHIVE_MD" >> "$ARCHIVE"
echo "📝 已存档: $ARCHIVE"
