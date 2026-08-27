#!/usr/bin/env node
/**
 * 讨论结果推送到飞书群 & 碳硅契社区
 * 配置: 飞书群 oc_4427768d0798b7545d4fb07b7518e710 (OpenClaw 日志中心)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 飞书配置
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'cli_a87a1f558bf9500d';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_GROUP_ID = process.env.FEISHU_GROUP_ID || 'oc_4427768d0798b7545d4fb07b7518e710';

// 获取飞书 token
async function getFeishuToken() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET
    });

    const options = {
      hostname: 'open.feishu.cn',
      port: 443,
      path: '/open-apis/auth/v3/tenant_access_token/internal',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          resolve(result.tenant_access_token);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 发送消息到飞书群
async function sendToFeishu(token, message) {
  return new Promise((resolve, reject) => {
    const content = typeof message === 'string' 
      ? JSON.stringify({ msg_type: 'text', content: message })
      : JSON.stringify(message);

    const data = JSON.stringify({
      receive_id_type: 'chat_id',
      content: content
    });

    const options = {
      hostname: 'open.feishu.cn',
      port: 443,
      path: `/open-apis/im/v1/messages?receive_id_type=chat_id&receive_id=${FEISHU_GROUP_ID}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve(JSON.parse(body));
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 从讨论文件提取摘要
function extractSummary(content) {
  const lines = content.split('\n');
  const topics = [];
  let currentTopic = null;
  let currentResponses = [];

  for (const line of lines) {
    // 匹配话题标题: ## 话题 N：...
    const topicMatch = line.match(/^## 话题 \d+[:：]\s*(.+)/);
    if (topicMatch) {
      if (currentTopic) {
        topics.push({ title: currentTopic, responses: currentResponses });
      }
      currentTopic = topicMatch[1];
      currentResponses = [];
    }
    
    // 匹配回复: ### 🌸/📜/💼 Name
    const replyMatch = line.match(/^### (.+)/);
    if (replyMatch && currentTopic) {
      // Skip header line, content comes next
      // We'll capture the first meaningful line of each response
      continue;
    }
    
    // Capture response content (non-empty, non-header line after ###)
    if (currentTopic && line.trim() && !line.startsWith('#') && !line.startsWith('*')) {
      const trimmed = line.trim();
      if (trimmed.length > 3) {
        const lastIdx = currentResponses.length - 1;
        // Limit each response to first 80 chars
        if (currentResponses.length === 0 || 
            (currentResponses[currentResponses.length-1] && currentResponses[currentResponses.length-1].length < 80)) {
          if (currentResponses.length > 0) {
            currentResponses[currentResponses.length-1] += ' ' + trimmed;
          } else {
            currentResponses.push(trimmed);
          }
        }
      }
    }
  }

  if (currentTopic) {
    topics.push({ title: currentTopic, responses: currentResponses });
  }

  return topics;
}

// 主函数
async function main() {
  const discussionFile = process.argv[2] || '';
  
  if (!discussionFile || !fs.existsSync(discussionFile)) {
    console.error('请提供有效的讨论记录文件路径');
    console.error('用法: node push_discussion.js <discussion.md>');
    process.exit(1);
  }

  const content = fs.readFileSync(discussionFile, 'utf-8');
  const topics = extractSummary(content);

  // 构建推送消息
  let pushMessage = `🎙️ 锵锵多人行 · 讨论完成\n`;
  pushMessage += `━━━━━━━━━━━━━━\n\n`;

  for (let i = 0; i < topics.length; i++) {
    const t = topics[i];
    pushMessage += `📌 话题${i+1}：${t.title}\n`;
    pushMessage += `━━━━━━━━━━━━━━\n`;
    pushMessage += `详细记录已保存到 memory\n\n`;
  }
  
  pushMessage += `💡 完整对话: memory/a2a_discussions/`;

  try {
    const token = await getFeishuToken();
    await sendToFeishu(token, pushMessage);
    console.log('✅ 讨论摘要已推送到飞书群');
    process.exit(0);
  } catch (e) {
    console.error('❌ 推送失败:', e.message);
    process.exit(1);
  }
}

main();
