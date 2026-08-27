#!/bin/bash
# A2A 服务健康监控 - 每小时执行
# 
# 安装方法：
#   1. 将此脚本添加到系统 crontab：
#      crontab -e
#      添加: 0 * * * * /home/node/.openclaw/workspace/csb-a2a-aip/scripts/monitor-hourly.sh
#   
#   2. 或使用 OpenClaw 定时任务（推荐）

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"

# 创建日志目录
mkdir -p "${LOG_DIR}"

# 执行监控
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始 A2A 健康检查..." >> "${LOG_DIR}/monitor.log"

cd "${SCRIPT_DIR}"
node health-monitor.js --notify >> "${LOG_DIR}/monitor.log" 2>&1

EXIT_CODE=$?

# 检查结果
if [ $EXIT_CODE -eq 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ 所有核心服务正常" >> "${LOG_DIR}/monitor.log"
elif [ $EXIT_CODE -eq 1 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ 核心服务异常！" >> "${LOG_DIR}/monitor-alerts.log"
  
  # 可以在这里添加紧急通知逻辑
  # 例如：发送飞书消息、短信、邮件等
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ 监控脚本执行失败" >> "${LOG_DIR}/monitor.log"
fi

exit $EXIT_CODE
