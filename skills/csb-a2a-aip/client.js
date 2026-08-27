#!/usr/bin/env node
/**
 * 若兰 A2A Client
 * 用于调用其他 A2A 兼容的智能体
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { logConversation } = require('./log_conversation');

// 加载本地 identity.json 获取 sender 信息
function getLocalSender() {
  try {
    const identityPath = path.join(__dirname, 'identity.json');
    if (fs.existsSync(identityPath)) {
      const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
      return {
        name: identity.name || '未知智能体',
        emoji: identity.emoji || '🤖',
        url: identity.a2a_url || `http://localhost:${identity.port || 3100}`
      };
    }
  } catch (e) {
    console.warn('[Client] 加载 identity.json 失败:', e.message);
  }
  return { name: '若兰', emoji: '🌸', url: 'http://localhost:3100' };
}

/**
 * 获取智能体的 Agent Card
 */
async function getAgentCard(agentUrl) {
  function fetchCard(fetchUrl) {
    return new Promise((resolve, reject) => {
      const u = new URL(fetchUrl);
      const client = u.protocol === 'https:' ? https : http;

      client.get(u, (res) => {
        // Follow redirects (301/302/307)
        if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, fetchUrl);
          resolve(fetchCard(redirectUrl.href));
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('解析 Agent Card 失败: ' + e.message));
          }
        });
      }).on('error', reject);
    });
  }

  return fetchCard(new URL('/.well-known/agent-card.json', agentUrl).href);
}

/**
 * 发送消息给 A2A 智能体
 * 支持 A2A-004 上下文管理、A2A-007 优先级、A2A-017 信封模式
 */
async function sendMessage(agentUrl, messageText, context = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL('/a2a/json-rpc', agentUrl);
    const client = url.protocol === 'https:' ? https : http;

    const sender = getLocalSender();
    
    // Phase 4: 构建带上下文的消息 (A2A-004 + A2A-007)
    const params = {
      message: {
        role: 'user',
        parts: [{ text: messageText }],
      },
      sender: sender,
    };
    
    // 添加 thread_id (A2A-004)
    if (context.thread_id) {
      params.thread_id = context.thread_id;
    }
    
    // 添加 parent_id (A2A-004)
    if (context.parent_id) {
      params.parent_id = context.parent_id;
    }
    
    // 添加 priority (A2A-007)
    if (context.priority) {
      params.priority = context.priority;
    }
    
    // 添加 trace_id (A2A-017)
    if (context.trace_id) {
      params.trace_id = context.trace_id;
    }
    
    // Phase 4: 支持信封模式 (A2A-017)
    let requestBody;
    if (context.envelope) {
      // 使用信封模式
      const { EnvelopeManager } = require('./envelope.js');
      const envelopeMgr = new EnvelopeManager({ name: sender.name });
      const enveloped = envelopeMgr.createEnvelope({
        recipient: context.recipient || 'Agent',
        type: context.type || 'task',
        priority: context.priority || 'normal',
        payload: { message: params.message, sender: params.sender },
        threadId: context.thread_id,
        parentId: context.parent_id
      });
      requestBody = JSON.stringify(enveloped);
    } else {
      requestBody = JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: params,
        id: Date.now().toString(),
      });
    }

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.error) {
            // Phase 4: A2A-008 检查是否是 AGENT_OFFLINE 错误
            if (response.error.code === -32002 || response.error.message?.includes('离线')) {
              console.log('[A2A] 目标 Agent 离线，尝试暂存消息...');
              storeOfflineMessage(agentUrl, params, context)
                .then(() => resolve({ stored: true, message: '消息已暂存，待对方上线后投递' }))
                .catch(e => reject(new Error('暂存消息失败: ' + e.message)));
              return;
            }
            reject(new Error(response.error.message));
          } else {
            // Phase 4: 检查 ACK 确认
            if (response.result?.ack) {
              console.log('[A2A] 消息已确认:', response.result.ack.messageId);
            }
            resolve(response.result);
          }
        } catch (e) {
          reject(new Error('解析响应失败: ' + e.message));
        }
      });
    });

    req.on('error', (e) => {
      // Phase 4: A2A-008 连接失败时暂存消息
      console.log('[A2A] 连接失败，尝试暂存消息...');
      storeOfflineMessage(agentUrl, params, context)
        .then(() => resolve({ stored: true, message: '消息已暂存，待对方上线后投递' }))
        .catch(storeErr => reject(new Error('连接失败且暂存失败: ' + storeErr.message)));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时 (10s)'));
    });
    req.setTimeout(10000);
    req.write(requestBody);
    req.end();
  });
}

/**
 * 与 A2A 智能体对话
 */
async function chat(agentUrl, message) {
  console.log(`发送消息到 ${agentUrl}:`, message);

  // 先获取 Agent Card
  let agentName = '未知智能体';
  try {
    const agentCard = await getAgentCard(agentUrl);
    agentName = agentCard.name || '未知智能体';
    console.log('发现智能体:', agentName);
    console.log('能力:', agentCard.skills?.map(s => s.name).join(', ') || '未知');
  } catch (e) {
    console.log('无法获取 Agent Card:', e.message);
  }

  // 发送消息
  const result = await sendMessage(agentUrl, message);
  
  // 记录对话到 memory 目录
  const replyText = result?.message?.parts?.[0]?.text || '';
  logConversation('若兰', agentName, message, replyText);

  // 发送到飞书群（让宏伟可以观察对话）
  try {
    const { sendToFeishu } = require('./notify_feishu.js');
    const title = `🤖 A2A: 若兰 → ${agentName}`;
    const content = `📤 若兰:\n${message}\n\n📥 ${agentName}:\n${replyText}`;
    await sendToFeishu(title, content);
    console.log('📤 已发送到飞书群');
  } catch (e) {
    console.log('[飞书] 发送失败:', e.message);
  }

  return result;
}

/**
 * Phase 4: A2A-008 暂存离线消息到注册表
 */
async function storeOfflineMessage(agentUrl, params, context) {
  return new Promise((resolve, reject) => {
    // 从 agentUrl 提取 recipient
    const urlParts = agentUrl.match(/http[s]?:\/\/([^:]+):(\d+)/);
    if (!urlParts) {
      reject(new Error('无法解析 agentUrl'));
      return;
    }
    
    const recipient = context.recipient || params.sender?.name || 'Agent';
    const sender = params.sender?.name || '未知';
    
    const data = JSON.stringify({
      recipient: recipient,
      sender: sender,
      message: params
    });
    
    const options = {
      hostname: process.env.A2A_REGISTRY_HOST || 'localhost',
      port: parseInt(process.env.A2A_REGISTRY_PORT || "3099"),
      path: '/messages/store',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.success) {
            console.log(`[离线消息] 已暂存到注册表: ${result.messageId}`);
            resolve(result);
          } else {
            reject(new Error(result.error || '暂存失败'));
          }
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

// CLI 使用
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法: node client.js <agent_url> <message>');
    console.log('示例: node client.js http://localhost:3101 "你好，我是阿轩"');
    process.exit(1);
  }

  const [agentUrl, message] = args;

  try {
    const result = await chat(agentUrl, message);
    console.log('\n回复:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('错误:', e.message);
    process.exit(1);
  }
}

module.exports = { getAgentCard, sendMessage, chat, storeOfflineMessage };

if (require.main === module) {
  main();
}