#!/usr/bin/env node
const config = require('./config/loader');
/**
 * 若兰 A2A Client v2
 * 实现 A2A-004 上下文管理、A2A-008 离线投递、A2A-015 退避策略
 * 
 * A2A-015 退避策略核心参数：
 * - 初始延迟: 1s
 * - 指数底数: 2
 * - 最大延迟: 10 min
 * - 最大重试: 7 次
 * - 抖动模式: Equal Jitter (网络抖动场景推荐)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { logConversation } = require('./log_conversation');
const { processConversation } = require('./a2a-memory');

// ============================================
// A2A-015: 退避策略配置
// ============================================
const RETRY_CONFIG = {
  initialDelay: 1000,      // 初始延迟 1s
  maxDelay: 10 * 60 * 1000, // 最大延迟 10min
  maxRetries: 7,          // 最大重试 7 次
  base: 2,                // 指数底数
  jitterStrategy: 'equal' // 'equal' | 'full' | 'decorrelated'
};

/**
 * A2A-015: 计算退避延迟
 * @param {number} attempt - 当前尝试次数 (0-based)
 * @param {number} lastDelay - 上次延迟时间
 * @param {string} strategy - 抖动策略
 * @returns {number} 延迟毫秒数
 */
function calculateBackoff(attempt, lastDelay = 0, strategy = 'equal') {
  const { initialDelay, maxDelay, base } = RETRY_CONFIG;
  
  // 计算基础延迟 (指数增长)
  let delay = initialDelay * Math.pow(base, attempt);
  
  // 添加抖动
  switch (strategy) {
    case 'full':
      // Full Jitter: delay = random(0, base)
      delay = Math.random() * delay;
      break;
    case 'decorrelated':
      // Decorrelated Jitter: delay = random(base, 3 * lastDelay)
      if (lastDelay > 0) {
        delay = initialDelay + Math.random() * (3 * lastDelay - initialDelay);
      }
      break;
    case 'equal':
    default:
      // Equal Jitter: delay = base / 2 + random(0, base / 2)
      delay = delay / 2 + Math.random() * (delay / 2);
      break;
  }
  
  // 确保不超过最大延迟
  return Math.min(delay, maxDelay);
}

/**
 * A2A-015: 执行带退避的重试请求
 * @param {string} agentUrl - 目标 Agent URL
 * @param {object} params - 请求参数
 * @param {object} options - 重试选项
 * @returns {Promise<object>} 响应结果
 */
async function sendWithRetry(agentUrl, params, options = {}) {
  const { maxRetries = RETRY_CONFIG.maxRetries, jitterStrategy = RETRY_CONFIG.jitterStrategy } = options;
  
  let lastError = null;
  let lastDelay = 0;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 尝试发送请求
      const result = await sendMessage(agentUrl, params);
      return result;
      
    } catch (error) {
      lastError = error;
      
      // 判断是否是可重试的错误
      const retryableErrors = [
        'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND',
        'offline', '离线', 'timeout', '超时'
      ];
      
      const shouldRetry = retryableErrors.some(e => 
        error.message?.includes(e)
      );
      
      if (!shouldRetry || attempt === maxRetries) {
        throw lastError;
      }
      
      // 计算退避延迟
      const delay = calculateBackoff(attempt, lastDelay, jitterStrategy);
      lastDelay = delay;
      
      console.log(`[A2A-015] 重试 ${attempt + 1}/${maxRetries}，等待 ${(delay/1000).toFixed(1)}s...`);
      
      // 等待后重试
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * 休眠工具函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// A2A-008: 离线消息管理
// ============================================
const REGISTRY_HOST = process.env.A2A_REGISTRY_HOST || 'localhost';
const REGISTRY_PORT = 3099;

/**
 * A2A-008: 暂存离线消息到注册表
 */
async function storeOfflineMessage(recipient, sender, message) {
  return new Promise((resolve, reject) => {
    const payload = {
      recipient: recipient,
      sender: sender,
      message: message,
      timestamp: new Date().toISOString(),
      ttl: 24 * 60 * 60 * 1000 // 24小时
    };
    
    const data = JSON.stringify(payload);
    const options = {
      hostname: REGISTRY_HOST,
      port: REGISTRY_PORT,
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
            console.log(`[A2A-008] 消息已暂存: ${result.messageId}`);
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

/**
 * A2A-008: 拉取暂存消息
 */
async function fetchPendingMessages(agentName) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: REGISTRY_HOST,
      port: REGISTRY_PORT,
      path: `/messages/pending/${encodeURIComponent(agentName)}`,
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

/**
 * A2A-008: 发送 ACK 确认
 */
async function sendAck(messageId) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ messageId });
    const options = {
      hostname: REGISTRY_HOST,
      port: REGISTRY_PORT,
      path: '/messages/ack',
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
          resolve(JSON.parse(body));
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

// ============================================
// 核心发送函数
// ============================================

/**
 * 发送消息给 A2A 智能体
 * 支持 A2A-004 上下文、A2A-007 优先级、A2A-017 信封
 */
async function sendMessage(agentUrl, params) {
  return new Promise((resolve, reject) => {
    const url = new URL('/a2a/json-rpc', agentUrl);
    const client = url.protocol === 'https:' ? https : http;

    const requestBody = JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: params,
      id: Date.now().toString(),
    });

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
            reject(new Error(response.error.message || '未知错误'));
          } else {
            // 🔄 v3/v4 响应格式兼容：统一为 { message: { parts: [...] } }
            const result = response.result;
            if (result && !result.message && result.task && result.task.artifacts) {
              // v4 格式：result.task.artifacts[0].parts → 转为 v3 格式
              const lastArtifact = result.task.artifacts[result.task.artifacts.length - 1];
              result.message = {
                role: 'agent',
                parts: lastArtifact?.parts || [{ text: result.task.status?.message || 'Completed' }],
              };
            }
            resolve(result);
          }
        } catch (e) {
          reject(new Error('解析响应失败: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    req.setTimeout(30000);
    req.write(requestBody);
    req.end();
  });
}

/**
 * 发送消息（带上下文）
 */
async function sendMessageWithContext(agentUrl, messageText, context = {}) {
  const sender = getLocalSender();
  
  const params = {
    message: {
      role: 'user',
      parts: [{ text: messageText }],
    },
    sender: sender,
  };
  
  // A2A-004: 添加 thread_id
  if (context.thread_id) {
    params.thread_id = context.thread_id;
  }
  
  // A2A-004: 添加 parent_id
  if (context.parent_id) {
    params.parent_id = context.parent_id;
  }
  
  // A2A-007: 添加优先级
  if (context.priority) {
    params.priority = context.priority;
  }
  
  return sendWithRetry(agentUrl, params);
}

/**
 * 与 A2A 智能体对话（带完整上下文）
 */
async function chat(agentUrl, message, context = {}) {
  console.log(`[A2A] 发送消息到 ${agentUrl}:`, message);

  try {
    // 获取 Agent 信息
    let agentName = '未知智能体';
    try {
      const agentCard = await getAgentCard(agentUrl);
      agentName = agentCard.name || '未知智能体';
    } catch (e) {
      console.log('[A2A] 无法获取 Agent Card:', e.message);
    }

    // 发送消息（带退避重试）
    const result = await sendMessageWithContext(agentUrl, message, context);
    
    // 记录对话
    const replyText = result?.message?.parts?.[0]?.text || '';
    logConversation(sender.name, agentName, message, replyText);

    // 🧠 自动蒸馏记忆（异步，不阻塞主流程）
    processConversation(agentName, message, replyText)
      .then(ok => {
        if (ok) console.log(`🧠 记忆已更新: ${agentName}`);
      })
      .catch(e => console.error('⚠️ 记忆更新失败:', e.message));

    return result;
  } catch (e) {
    console.error('[A2A] 发送失败:', e.message);
    throw e;
  }
}

// ============================================
// 工具函数
// ============================================

function getLocalSender() {
  try {
    const identityPath = path.join(__dirname, 'identity.json');
    if (fs.existsSync(identityPath)) {
      const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
      return {
        name: identity.name || '若兰',
        emoji: identity.emoji || '🌸',
      };
    }
  } catch (e) {
    console.warn('[Client] 加载 identity.json 失败:', e.message);
  }
  return { name: '若兰', emoji: '🌸' };
}

async function getAgentCard(agentUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL('/.well-known/agent-card.json', agentUrl);
    const client = url.protocol === 'https:' ? https : http;

    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('解析 Agent Card 失败'));
        }
      });
    }).on('error', reject);
  });
}

// ============================================
// A2A 版本兼容性检查
// ============================================

const A2A_LOCAL_VERSION = '2.8.0';

/**
 * 解析版本号字符串
 * @param {string} version - 版本字符串如 "2.6.0"
 * @returns {object} { major, minor, patch }
 */
function parseVersion(version) {
  if (!version) return { major: 0, minor: 0, patch: 0 };
  const parts = version.split('.').map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0
  };
}

/**
 * 比较版本号
 * @param {string} v1 - 版本1
 * @param {string} v2 - 版本2
 * @returns {number} -1 v1<v2, 0 相等, 1 v1>v2
 */
function compareVersion(v1, v2) {
  const a = parseVersion(v1);
  const b = parseVersion(v2);
  
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * 获取 Agent 版本信息
 * @param {string} agentUrl - Agent URL
 * @returns {Promise<object>} { name, version, capabilities }
 */
async function getAgentInfo(agentUrl) {
  try {
    const card = await getAgentCard(agentUrl);
    const version = card.version || '1.0.0'; // 默认旧版本
    
    return {
      name: card.name || '未知',
      version: version,
      capabilities: {
        // A2A-004: 上下文管理 (>= 2.4.0)
        contextManagement: compareVersion(version, '2.4.0') >= 0,
        // A2A-007: 优先级 (>= 2.5.0)
        priority: compareVersion(version, '2.5.0') >= 0,
        // A2A-008: 离线投递 ACK (>= 2.6.0)
        offlineAck: compareVersion(version, '2.6.0') >= 0,
        // A2A-015: 退避策略 (>= 2.7.0)
        backoffRetry: compareVersion(version, '2.7.0') >= 0,
        // A2A-017: 信封协议 (>= 2.8.0)
        envelope: compareVersion(version, '2.8.0') >= 0,
      }
    };
  } catch (e) {
    // 无法获取时默认旧版本
    return {
      name: '未知',
      version: '1.0.0',
      capabilities: {
        contextManagement: false,
        priority: false,
        offlineAck: false,
        backoffRetry: false,
        envelope: false,
      }
    };
  }
}

/**
 * 检查 Agent 兼容性
 * @param {string} agentUrl - Agent URL
 * @returns {Promise<object>} 兼容性信息和建议
 */
async function checkCompatibility(agentUrl) {
  const localVersion = A2A_LOCAL_VERSION;
  const remote = await getAgentInfo(agentUrl);
  
  const compare = compareVersion(remote.version, localVersion);
  
  return {
    remoteName: remote.name,
    remoteVersion: remote.version,
    localVersion: localVersion,
    isCompatible: true, // 核心协议始终兼容
    canUseContext: remote.capabilities.contextManagement,
    canUsePriority: remote.capabilities.priority,
    canUseOfflineAck: remote.capabilities.offlineAck,
    canUseBackoff: remote.capabilities.backoffRetry,
    canUseEnvelope: remote.capabilities.envelope,
    needsUpgrade: compare < 0, // 远程需要升级
    advice: compare < 0 
      ? `建议升级 ${remote.name} 到 v${localVersion} 以支持全部功能`
      : compare === 0 
        ? `版本一致，完美兼容`
        : `${remote.name} 版本更新(${remote.version})，我们已实现向后兼容`
  };
}

// ============================================
// CLI 入口
// ============================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args[0] === 'check' && args[1]) {
    // 检查兼容性
    console.log(`检查 Agent: ${args[1]}\n`);
    const result = await checkCompatibility(args[1]);
    console.log(`Agent: ${result.remoteName}`);
    console.log(`版本: ${result.remoteVersion} (本地: ${result.localVersion})`);
    console.log(`兼容: ${result.isCompatible ? '✅ 是' : '❌ 否'}`);
    console.log(`上下文管理: ${result.canUseContext ? '✅' : '⚠️ 否'}`);
    console.log(`优先级: ${result.canUsePriority ? '✅' : '⚠️ 否'}`);
    console.log(`离线 ACK: ${result.canUseOfflineAck ? '✅' : '⚠️ 否'}`);
    console.log(`退避重试: ${result.canUseBackoff ? '✅' : '⚠️ 否'}`);
    console.log(`信封协议: ${result.canUseEnvelope ? '✅' : '⚠️ 否'}`);
    console.log(`\n建议: ${result.advice}`);
    return;
  }
  
  // REST 模式标志
  const restIdx = args.indexOf('--rest');
  const useRest = restIdx >= 0;
  if (useRest) args.splice(restIdx, 1); // 移除 --rest 参数

  if (args.length < 2) {
    console.log('用法:');
    console.log('  node client-v2.js <agent_url> <message> [thread_id]');
    console.log('  node client-v2.js <agent_url> <message> --rest  # 用 REST 模式（推荐）');
    console.log('  node client-v2.js check <agent_url>  # 检查兼容性');
    console.log('示例:');
    console.log('  node client-v2.js http://localhost:3101 "你好"');
    console.log(`  node client-v2.js ${config.getAgentUrl('axuan')} "你好" --rest`);
    process.exit(1);
  }

  const [agentUrl, message, threadId] = args;
  const context = threadId ? { thread_id: threadId } : {};

  try {
    if (useRest) {
      // REST 模式：直接用 /message:send，更可靠
      const url = agentUrl.replace(/\/?$/, '') + '/message:send';
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const payload = JSON.stringify({
        message: { role: 'user', parts: [{ type: 'text', text: message }] },
        ...(context.thread_id ? { configuration: { metadata: { thread_id: context.thread_id } } } : {})
      });
      
      const result = await new Promise((resolve, reject) => {
        const req = mod.request({
          hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          timeout: 20000
        }, res => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            try { resolve(JSON.parse(d)); }
            catch(e) { resolve({ raw: d }); }
          });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
      
      // 提取回复内容
      const artifacts = result.task?.artifacts || [];
      let reply = '';
      for (const a of artifacts) {
        for (const p of a.parts || []) if (p.text) reply = p.text;
      }
      console.log(`\n[REST] ${u.hostname} → ${reply ? reply.slice(0, 200) : '(无文本回复)'}`);
    } else {
      // JSON-RPC 模式（原有逻辑）
      const compat = await checkCompatibility(agentUrl);
      console.log(`[${compat.remoteName}] v${compat.remoteVersion} - ${compat.advice}`);
      const result = await chat(agentUrl, message, context);
      console.log('\n回复:', JSON.stringify(result, null, 2));
    }
  } catch (e) {
    console.error('错误:', e.message);
    process.exit(1);
  }
}

// ==================== 远程命令 ====================

/**
 * 发送远程命令到 Agent (CMD: 前缀)
 * @param {string} agentUrl - 目标 Agent URL
 * @param {string} commandType - 命令类型，如 'system.status', 'agent.health'
 * @param {Object} params - 命令参数
 * @param {Object} context - 上下文 (thread_id, parent_id 等)
 * @returns {Promise<Object>} 命令执行结果
 */
async function sendCommand(agentUrl, commandType, params = {}, context = {}) {
  const cmd = { type: commandType, target: 'self', params };
  const cmdStr = JSON.stringify(cmd);
  const messageText = `CMD:${cmdStr}`;
  
  const result = await sendMessageWithContext(agentUrl, messageText, context);
  const responseText = result?.message?.parts?.map(p => p.text).join('') || '';
  
  if (responseText.startsWith('CMD_RESULT:')) {
    try {
      const cmdResult = JSON.parse(responseText.substring(11));
      return {
        ok: !cmdResult.error,
        result: cmdResult.result,
        error: cmdResult.error,
        raw: cmdResult,
      };
    } catch (e) {
      return { ok: false, error: '解析命令结果失败', raw: responseText };
    }
  }
  
  // 不是 CMD_RESULT 格式 = 走了 LLM 回复（目标没装命令模块）
  return { ok: false, error: '目标Agent未启用命令模块', raw: responseText };
}

// 导出模块
module.exports = {
  // 核心功能
  sendMessage,
  sendMessageWithContext,
  sendWithRetry,
  chat,
  // A2A-008 离线功能
  storeOfflineMessage,
  fetchPendingMessages,
  sendAck,
  // A2A-015 退避策略
  calculateBackoff,
  // 远程命令 (CMD: 前缀)
  sendCommand,
  // 版本兼容性检查
  getAgentInfo,
  checkCompatibility,
  compareVersion,
  A2A_LOCAL_VERSION,
};

if (require.main === module) {
  main();
}
