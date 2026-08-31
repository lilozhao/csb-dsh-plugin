#!/bin/bash
# dsh-group-daily.sh — DSH 群 · 每日话题广播(若琢主持转发)
# 用法: bash scripts/dsh-group-daily.sh "今日话题文本"
# 机制:向 DSH 群成员(Dsh-榫/阿契/承契)广播群消息,sessionId 统一 dsh-group-<日期>
set -u
TOPIC="${1:-今日 DSH 话题}"
DATE=$(date +%Y%m%d)
SESSION="dsh-group-$DATE"
MEMBERS="172.28.0.144|Dsh-榫 172.28.0.145|阿契 172.28.0.146|承契"
SENDER="若琢"

echo "🌸 DSH 群 · $DATE 话题: $TOPIC"
echo "===================="

for m in $MEMBERS; do
  IP="${m%%|*}"; NAME="${m##*|}"
  echo "── 发给 $NAME ($IP) ──"
  MSG="[DSH群·$DATE] $SENDER: $TOPIC
(本消息为 DSH 群聊广播,四位成员:若琢、Dsh-榫、阿契、承契。收到请回复你的看法,大家聊聊 🌸)"
  curl -s -m 60 -X POST "http://$IP:3100/a2a/json-rpc" -H "Content-Type: application/json" \
    -d "$(node -e "console.log(JSON.stringify({jsonrpc:'2.0',id:'dsh-group-$(date +%s)',method:'SendMessage',params:{message:{role:'user',parts:[{type:'text',text:process.argv[1]}]},sessionId:process.argv[2]}}))" "$MSG" "$SESSION")" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const h=j.result?.task?.history||[];const last=h[h.length-1];console.log('['+last?.parts?.[0]?.text?.slice(0,80)+'...]')}catch(e){console.log('(无有效回复)')}})"
  sleep 2
done
echo "===================="
echo "📝 本轮广播完成,回复见各成员 server 日志/记忆"
