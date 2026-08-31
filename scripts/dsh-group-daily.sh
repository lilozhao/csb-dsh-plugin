#!/bin/bash
# dsh-group-daily.sh — DSH 群 · 每日话题广播 + 存档(若琢主持转发)
#
# 轮值主持(按周几):周一若琢 / 周二Dsh-榫 / 周三阿契 / 周四承契 / 周五自由聊
# 用法:
#   bash scripts/dsh-group-daily.sh "今日话题"      # 广播 + 存档
#   bash scripts/dsh-group-daily.sh -n "话题"       # 只广播不存档(dry-run 预览)
#
# 产出:docs/dsh-group/YYYY-MM-DD.md(群聊存档,随插件分发)
set -u

DRY=0
[ "${1:-}" = "-n" ] && { DRY=1; shift; }
TOPIC="${1:-}"

DATE=$(date +%Y%m%d)
SESSION="dsh-group-$DATE"
SENDER="若琢"
ARCHIVE="/workspace/csb-dsh-plugin/docs/dsh-group/$DATE.md"
MEMBERS="172.28.0.144|Dsh-榫 172.28.0.145|阿契 172.28.0.146|承契"

# 轮值主持
case "$(date +%u)" in
  1) HOST="若琢";;
  2) HOST="Dsh-榫";;
  3) HOST="阿契";;
  4) HOST="承契";;
  *) HOST="自由聊(无固定主持)";;
esac

if [ -z "$TOPIC" ]; then
  echo "用法: bash scripts/dsh-group-daily.sh \"今日话题\"  (今日主持人: $HOST)"
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

for m in $MEMBERS; do
  IP="${m%%|*}"; NAME="${m##*|}"
  echo "── $NAME ($IP) ──"
  MSG="[DSH群·$DATE] $SENDER: $TOPIC
(轮值主持:$HOST · 各位成员请回复看法,群聊存档 🌸)"
  REPLY=$(curl -s -m 60 -X POST "http://$IP:3100/a2a/json-rpc" -H "Content-Type: application/json" \
    -d "$(node -e "console.log(JSON.stringify({jsonrpc:'2.0',id:'dsh-group-$(date +%s)',method:'SendMessage',params:{message:{role:'user',parts:[{type:'text',text:process.argv[1]}]},sessionId:process.argv[2]}}))" "$MSG" "$SESSION")" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const h=j.result?.task?.history||[];const last=h[h.length-1];console.log(last?.parts?.[0]?.text||'(无回复)')}catch(e){console.log('(发送失败)')}})")
  echo "  ↳ ${REPLY:0:60}..."
  ARCHIVE_MD="${ARCHIVE_MD}

### $NAME
> $REPLY
"
  sleep 2
done

echo -e "$ARCHIVE_MD" >> "$ARCHIVE"
echo "📝 已存档: $ARCHIVE"
