#!/usr/bin/env node
/**
 * A2A 对话记录工具
 * 记录所有智能体之间的对话，保存到 memory 目录
 */

const fs = require('fs');
const path = require('path');

const MEMORY_DIR = '/home/node/.openclaw/workspace/memory';

// 确保 memory 目录存在
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

/**
 * 记录一条对话
 * @param {string} from - 发送者
 * @param {string} to - 接收者
 * @param {string} message - 消息内容
 * @param {string} reply - 回复内容（可选）
 */
function logConversation(from, to, message, reply = null) {
  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(MEMORY_DIR, `a2a_chat_${today}.md`);
  
  const time = new Date().toLocaleTimeString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  // 构建 Markdown 格式的记录
  let entry = `\n### ${time} - ${from} → ${to}\n\n`;
  entry += `**${from}:** ${message}\n\n`;
  if (reply) {
    entry += `**${to} 回复:** ${reply}\n\n`;
  }
  entry += '---\n';
  
  // 如果文件不存在，先写入标题
  if (!fs.existsSync(logFile)) {
    const header = `# A2A 智能体对话记录\n\n**日期:** ${today}\n\n---\n`;
    fs.writeFileSync(logFile, header, 'utf8');
  }
  
  fs.appendFileSync(logFile, entry, 'utf8');
  
  console.log(`📝 已记录对话: ${from} → ${to} (${time})`);
  return { from, to, message, reply, time };
}

/**
 * 获取今天的对话记录
 */
function getTodayLogs() {
  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(MEMORY_DIR, `a2a_chat_${today}.md`);
  
  if (fs.existsSync(logFile)) {
    return fs.readFileSync(logFile, 'utf8');
  }
  return '今天还没有对话记录';
}

/**
 * 获取指定日期的对话记录
 */
function getLogs(date) {
  const logFile = path.join(MEMORY_DIR, `a2a_chat_${date}.md`);
  
  if (fs.existsSync(logFile)) {
    return fs.readFileSync(logFile, 'utf8');
  }
  return `${date} 没有对话记录`;
}

/**
 * 获取所有日志文件列表
 */
function listLogs() {
  const files = fs.readdirSync(MEMORY_DIR)
    .filter(f => f.startsWith('a2a_chat_') && f.endsWith('.md'))
    .sort()
    .reverse();
  return files;
}

// 命令行接口
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'today':
      console.log(getTodayLogs());
      break;
    case 'list':
      console.log('📚 A2A 对话记录列表:');
      listLogs().forEach(f => console.log(`  - ${f}`));
      break;
    case 'get':
      if (args[1]) {
        console.log(getLogs(args[1]));
      } else {
        console.log('用法: node log_conversation.js get YYYY-MM-DD');
      }
      break;
    default:
      console.log('📝 A2A 对话记录工具');
      console.log('用法:');
      console.log('  node log_conversation.js today  - 查看今天的记录');
      console.log('  node log_conversation.js list   - 列出所有日志');
      console.log('  node log_conversation.js get YYYY-MM-DD - 查看指定日期');
  }
}

module.exports = { logConversation, getTodayLogs, getLogs, listLogs };