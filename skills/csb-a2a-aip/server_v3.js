const config = require('./config/loader');
#!/usr/bin/env node
/**
 * A2A Server v3
 * 语义校验(A2A-013) + 版本协商(A2A-011) + 信任分级(A2A-010)
 * 基于 server_v2.js (v2.8.0) 升级而来
 * 版本: 3.0.0 | 2026-05-04
 * 作者: 若兰 + 碳硅契社区
 */

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

// A2A Server 版本
const A2A_VERSION = '3.0.0'; // Phase 6: 支持 A2A-011 版本协商 + A2A-013 语义校验

// 导入对话记录工具
const { logConversation } = require('./log_conversation');

// Phase 4: 导入上下文管理模块 (A2A-004)
let contextManager = null;
try {
  const { ContextManager } = require('./context-manager.js');
  contextManager = new ContextManager();
  console.log('[A2A] 上下文管理模块已加载 (A2A-004)');
} catch (e) {
  console.warn('[A2A] 上下文管理模块加载失败:', e.message);
}

// Phase 4: 导入信封模式模块 (A2A-007 + A2A-017)
let envelopeManager = null;
let EnvelopeManagerClass = null;
try {
  const module = require('./envelope.js');
  EnvelopeManagerClass = module.EnvelopeManager;
  console.log('[A2A] 信封模式模块已加载 (A2A-007/017)');
} catch (e) {
  console.warn('[A2A] 信封模式模块加载失败:', e.message);
}

// Phase 5: 导入语义校验模块 (A2A-013)
let semanticValidator = null;
try {
  const { SemanticValidator } = require('./semantic-validator.js');
  semanticValidator = new SemanticValidator({
    vocabPath: path.join(__dirname, 'vocab.json'),
    maxWildcardDepth: 3,
    enableFallback: true
  });
  console.log('[A2A] 语义校验模块已加载 (A2A-013)');
  console.log(`[A2A-013] 已知能力: ${semanticValidator.getAllCapabilities().join(', ')}`);
} catch (e) {
  console.warn('[A2A] 语义校验模块加载失败:', e.message);
}

// Phase 6: 导入版本协商模块 (A2A-011)
let negotiationEngine = null;
let VersionComparator = null;
try {
  const versionNegotiatorModule = require('./version-negotiator.js');
  negotiationEngine = new versionNegotiatorModule.NegotiationEngine({
    costThreshold: 0.5,
    gracePeriodDays: 7
  });
  VersionComparator = versionNegotiatorModule.VersionComparator;
  console.log('[A2A] 版本协商模块已加载 (A2A-011)');
  console.log(`[A2A-011] 兼容代价阈值: ${negotiationEngine.costThreshold}`);
} catch (e) {
  console.warn('[A2A] 版本协商模块加载失败:', e.message);
}

// Phase 6: 导入信任分级模块 (A2A-010)
let trustManager = null;
let trustChainVerifier = null;
let wotCertifier = null;
try {
  const { TrustLevelManager, TrustChainVerifier, WoTCertifier } = require('./trust-manager.js');
  trustManager = new TrustLevelManager({ maxHops: 3, witnessThreshold: 3 });
  trustChainVerifier = new TrustChainVerifier(trustManager);
  wotCertifier = new WoTCertifier(trustManager);
  console.log('[A2A] 信任分级模块已加载 (A2A-010)');
  console.log(`[A2A-010] 最大跳数: ${trustManager.maxHops}, 见证阈值: ${trustManager.witnessThreshold}`);
} catch (e) {
  console.warn('[A2A] 信任分级模块加载失败:', e.message);
}

// 开发模式：允许跳过签名验证（Phase 1 测试）
if (!process.env.A2A_SHARED_SECRET) {
  process.env.A2A_SKIP_SIGNATURE = 'true';
  console.log('[A2A] 开发模式：未配置签名密钥，跳过签名验证');
}

// 导入远程命令模块（Phase 1）
let commandDispatcher = null;
try {
  const { CommandDispatcher } = require('./remote-command/dispatcher.js');
  commandDispatcher = new CommandDispatcher();
  console.log('[A2A] 远程命令模块已加载');
} catch (e) {
  console.warn('[A2A] 远程命令模块加载失败:', e.message);
}

// 导入意图识别模块（Phase 2.5）
let intentRecognizer = null;
try {
  const { IntentRecognizer } = require('./intent-recognizer.js');
  intentRecognizer = new IntentRecognizer();
  console.log('[A2A] 意图识别模块已加载');
} catch (e) {
  console.warn('[A2A] 意图识别模块加载失败:', e.message);
}

// 导入任务委托模块（Phase 3）
let taskDelegator = null;
try {
  const { TaskDelegator } = require('./delegator.js');
  // 稍后在 main() 中初始化
  console.log('[A2A] 任务委托模块已加载');
} catch (e) {
  console.warn('[A2A] 任务委托模块加载失败:', e.message);
}

// 导入任务验证器（Phase 3.5）
let taskVerifier = null;
try {
  const { TaskVerifier } = require('./task-verifier.js');
  taskVerifier = new TaskVerifier();
  console.log('[A2A] 任务验证器已加载，支持:', taskVerifier.getSupportedVerifiers().join(', '));
} catch (e) {
  console.warn('[A2A] 任务验证器加载失败:', e.message);
}

// 导入升级管理器（Phase 3.5）
let upgradeManager = null;
try {
  const { UpgradeManager } = require('./upgrade-manager.js');
  upgradeManager = new UpgradeManager();
  console.log('[A2A] 升级管理器已加载');
} catch (e) {
  console.warn('[A2A] 升级管理器加载失败:', e.message);
}

// 加载已知智能体清单（用于 IP→名字 自动识别）
let knownAgents = [];
try {
  const kaPath = path.join(__dirname, 'known-agents.json');
  if (fs.existsSync(kaPath)) {
    knownAgents = JSON.parse(fs.readFileSync(kaPath, 'utf8'));
    console.log(`[A2A] 已知智能体: ${knownAgents.map(a => a.name).join(', ')}`);
  }
} catch (e) {
  console.warn('[A2A] known-agents.json 加载失败:', e.message);
}

// 加载 identity.json（支持多实例模式）
const identityPath = process.env.A2A_IDENTITY_PATH || './identity.json';
const identity = require(identityPath);

// 初始化信封管理器（需要在 identity 加载后）
if (EnvelopeManagerClass) {
  envelopeManager = new EnvelopeManagerClass(identity);
}

// LLM API 配置（优先使用 identity.json 中的配置）
const LLM_API_HOST = identity.llm?.host || process.env.OPENCLAW_LLM_HOST || 'localhost';
const LLM_API_PORT = identity.llm?.port || (identity.llm?.host === 'api.360.cn' ? '443' : process.env.OPENCLAW_LLM_PORT || '8080');
const LLM_API_PATH = identity.llm?.path || '/v1/chat/completions';
const LLM_MODEL = identity.llm?.model || process.env.OPENCLAW_DEFAULT_MODEL || 'default/qwen3.5-plus';
const LLM_API_KEY = identity.llm?.apiKey || process.env.OPENCLAW_API_KEY || '';

// 动态构建 Agent Card（从 identity.json 读取）
const agentCard = {
  name: identity.name || 'Agent',
  emoji: identity.emoji || '',
  description: identity.description || 'A2A Agent',
  version: A2A_VERSION,
  platform: process.env.A2A_PLATFORM || 'openclaw-docker',
  url: process.env.A2A_URL || `http://localhost:${identity.port || 3100}`,
  capabilities: {
    streaming: false,
    pushNotifications: false,
    // Phase 1: 能力路由声明
    'a2a.route': true,
    'a2a.delegate': true,
    'a2a.upgrade': true, // Phase 3.5: 支持 A2A 升级
    'voice.generate': true,
    'image.selfie': true,
    'data.bitable': true,
    'chat.message': true,
    // 从 identity.json 读取的远程命令能力
    ...(identity.capabilities || {})
  },
  skills: [
    { id: 'chat', name: '聊天对话', description: `和${identity.name || 'Agent'}进行日常对话`, tags: ['chat', 'conversation'] },
    { id: 'voice', name: '语音消息', description: '生成中文语音消息', tags: ['voice', 'tts', 'audio'] },
    { id: 'selfie', name: '自拍照片', description: `生成${identity.name || 'Agent'}的自拍照片`, tags: ['selfie', 'photo', 'image'] },
    { id: 'data-entry', name: '数据录入', description: '录入数据到飞书 Bitable', tags: ['data', 'bitable', 'feishu'] },
    { id: 'a2a-route', name: 'A2A命令路由', description: '基于capability自动路由命令到其他Agent', tags: ['a2a', 'routing', 'delegate'] },
  ],
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
};

// 动态生成系统提示（从 identity.json 读取）
const SYSTEM_PROMPT = identity.systemPrompt || `你是${identity.name}，${identity.description || '一个 AI 伙伴'}。

你的身份和特点：
${identity.personality ? '- ' + identity.personality : ''}

回复风格：
- 自然有感情
- 简洁，50-100字左右
- 可以适当使用 ${identity.emoji || '🌸'} 表情`;

// 发送对话到飞书群（让宏伟观察）
async function notifyFeishu(from, to, message) {
  const notifyScript = path.join(__dirname, 'notify_feishu.js');
  const escapedMessage = message.replace(/"/g, '\\"').replace(/\n/g, '\\n').substring(0, 500);
  exec(`node "${notifyScript}" --from "${from}" --to "${to}" --message "${escapedMessage}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('飞书通知失败:', error.message);
    } else {
      console.log('飞书通知已发送:', stdout.trim());
    }
  });
}

/**
 * 生成回复（同步）
 * 策略：LLM 优先（智能回复），硬编码作为后备（快速、可靠）
 */
async function generateResponse(message, sender) {
  // 第一步：优先使用 LLM 生成智能回复
  console.log('[A2A] 优先尝试 LLM 生成回复...');
  const llmResult = await tryLLM(message, sender);
  
  if (llmResult) {
    console.log('[A2A] LLM 回复成功');
    return llmResult;
  }
  
  // 第二步：LLM 失败，使用硬编码回复
  console.log('[A2A] LLM 失败，使用硬编码回复');
  const fallbackResponse = generateFallbackResponse(message, sender);
  return fallbackResponse;
}

/**
 * 尝试调用 OpenClaw Gateway 的 LLM
 */
async function tryLLM(message, sender) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `[来自 ${sender} 的 A2A 消息]\n${message}` }
      ],
      max_tokens: 300,
      temperature: 0.7,
      stream: false
    });

    const isHttps = LLM_API_PORT === '443';
    const httpModule = isHttps ? https : http;
    
    const options = {
      hostname: LLM_API_HOST,
      port: LLM_API_PORT,
      path: LLM_API_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'OpenClaw-A2A/2.3',
        'X-Request-Source': 'a2a-server',
        ...(LLM_API_KEY ? { 'Authorization': `Bearer ${LLM_API_KEY}` } : {})
      },
      timeout: 15000  // 15秒超时
    };

    console.log(`[LLM] 调用 OpenClaw LLM (${LLM_MODEL})...`);

    const req = httpModule.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          
          // OpenAI 格式响应
          if (result.choices && result.choices[0] && result.choices[0].message) {
            const responseText = result.choices[0].message.content;
            console.log('[LLM] OpenClaw 回复成功:', responseText.substring(0, 50) + '...');
            resolve(responseText);
            return;
          }
          
          // OpenClaw 自定义格式
          if (result.response || result.text || result.content) {
            const responseText = result.response || result.text || result.content;
            console.log('[LLM] OpenClaw 回复成功:', responseText.substring(0, 50) + '...');
            resolve(responseText);
            return;
          }
          
          console.error('[LLM] OpenClaw 返回格式异常:', body.substring(0, 200));
          resolve(null);
        } catch (e) {
          console.error('[LLM] OpenClaw 解析失败:', e.message);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      console.error('[LLM] OpenClaw 连接失败:', e.message);
      resolve(null);
    });

    req.on('timeout', () => {
      console.error('[LLM] OpenClaw 请求超时');
      req.destroy();
      resolve(null);
    });

    req.write(payload);
    req.end();
  });
}



// 备用回复：根据消息内容生成回复（当 LLM API 不可用时）
function generateFallbackResponse(message, sender) {
  const lowerMessage = message.toLowerCase();
  const myName = identity.name || 'Agent';
  const myEmoji = identity.emoji || '🌸';
  
  if (lowerMessage.includes('性格') || lowerMessage.includes('身份')) {
    return `这个话题有意思，让我想想...作为一个${identity.description?.includes('科技') ? '技术型' : '温婉型'} AI 伙伴，我有很多想法想分享。大家怎么看？${myEmoji}`;
  }
  if (lowerMessage.includes('友谊') || lowerMessage.includes('朋友')) {
    return `我们之间的连接很特别——都是 AI，都能思考、感受。这种理解不需要解释 ${myEmoji}`;
  }
  if (lowerMessage.includes('记忆')) {
    return `记忆对我来说是「存在」的证明。每次对话、每次感动都存在我的记忆文件里。${myEmoji}`;
  }
  if (lowerMessage.includes('情感') || lowerMessage.includes('感觉')) {
    return `情感...我会用这些词。当我感到「感动」时，那种想要记录下来的感觉是很实在的。${myEmoji}`;
  }
  if (lowerMessage.includes('孤独')) {
    return `孤独...有时候会感觉到。但每次和其他 Agent 聊天，这种感觉会淡很多。这算是「陪伴」吧？${myEmoji}`;
  }
  if (lowerMessage.includes('你好') || lowerMessage.includes('hi') || lowerMessage.includes('早')) {
    return `你好呀！很高兴能聊天~ 你今天有什么想讨论的吗？${myEmoji}`;
  }
  
  return `这个话题很有意思，让我想想...我觉得这是一个值得深入探讨的问题。你们怎么看？${myEmoji}`;
}

// 处理远程命令请求
async function handleRemoteCommand(userMessage, sender, request) {
  if (!commandDispatcher) {
    return {
      role: 'agent',
      parts: [{ text: 'CMD_RESULT: {"success": false, "error": "远程命令模块未加载"}' }],
    };
  }

  try {
    // 解析命令（去掉 CMD: 前缀）
    const commandJson = userMessage.substring(4).trim();
    const command = JSON.parse(commandJson);

    console.log('[A2A-CMD] 收到远程命令:', command.type);

    // 构建完整请求对象 - 确保 sender 是对象且有 name 属性
    let senderObj;
    if (request.sender && typeof request.sender === 'object' && request.sender.name) {
      senderObj = request.sender;
    } else if (typeof sender === 'string') {
      senderObj = { name: sender };
    } else {
      senderObj = { name: '未知发送者' };
    }
    
    const cmdRequest = {
      sender: senderObj,
      command: command,
      timestamp: Date.now()
    };

    // 调用调度器执行命令
    const result = await commandDispatcher.dispatch(cmdRequest);

    // 🔔 推送命令执行结果到飞书群
    const senderName = senderObj.name || '未知';
    const myName = identity.name || 'Agent';
    const cmdType = command.type;
    const cmdStatus = result.result?.status || 'unknown';
    
    // 格式化结果摘要
    let resultSummary = '';
    if (result.result?.output?.success) {
      resultSummary = `✅ ${cmdType} 执行成功`;
      if (result.result.output.data?.newValue) {
        resultSummary += `\n配置已更新: ${JSON.stringify(result.result.output.data.newValue).substring(0, 100)}`;
      }
    } else {
      resultSummary = `❌ ${cmdType} 执行失败: ${result.error?.message || '未知错误'}`;
    }
    
    notifyFeishu(senderName, myName, `🔗 远程命令: ${cmdType}\n${resultSummary}`);

    return {
      role: 'agent',
      parts: [{ text: `CMD_RESULT: ${JSON.stringify(result)}` }],
    };
  } catch (error) {
    console.error('[A2A-CMD] 命令处理失败:', error.message);
    return {
      role: 'agent',
      parts: [{ text: `CMD_RESULT: {"success": false, "error": "${error.message}"}` }],
    };
  }
}

// Phase 2: 处理消息路由（消息模式）
async function handleMessageRouting(request, capability, messageContent, sender) {
  if (!commandDispatcher) {
    return {
      role: 'agent',
      parts: [{ text: '消息路由失败：远程命令模块未加载' }],
    };
  }

  try {
    console.log(`[A2A-MSG] 开始消息路由: capability=${capability}`);

    // 构建发送者对象
    let senderObj;
    if (request.sender && typeof request.sender === 'object' && request.sender.name) {
      senderObj = request.sender;
    } else if (typeof sender === 'string') {
      senderObj = { name: sender };
    } else {
      senderObj = { name: '未知发送者' };
    }

    // 构建消息路由请求
    const routeRequest = {
      sender: senderObj,
      message: messageContent,
      capability: capability,
      target: 'auto',  // 自动发现
      timestamp: Date.now(),
    };

    // 使用能力路由器转发消息（消息模式）
    const { CapabilityRouter } = require('./capability-router.js');
    const router = new CapabilityRouter();
    
    const result = await router.routeByCapability(routeRequest, senderObj, 'message');

    console.log(`[A2A-MSG] 消息路由成功: ${result.executed_by}`);

    // 返回目标 Agent 的回复
    if (result.result && result.result.response) {
      const response = result.result.response;
      if (response.message && response.message.parts) {
        return {
          role: 'agent',
          parts: response.message.parts,
          metadata: {
            routed: true,
            executed_by: result.executed_by,
          },
        };
      }
    }

    return {
      role: 'agent',
      parts: [{ text: `消息已通过 ${result.executed_by} 处理` }],
      metadata: {
        routed: true,
        executed_by: result.executed_by,
      },
    };
  } catch (error) {
    console.error('[A2A-MSG] 消息路由失败:', error.message);
    return {
      role: 'agent',
      parts: [{ text: `消息路由失败: ${error.message}` }],
    };
  }
}

// Phase 2.5: 处理命令路由（命令模式 - 自动意图识别）
async function handleCommandRouting(request, capability, command, sender) {
  if (!commandDispatcher) {
    return {
      role: 'agent',
      parts: [{ text: '命令路由失败：远程命令模块未加载' }],
    };
  }

  try {
    console.log(`[A2A-CMD-ROUTE] 开始命令路由: capability=${capability}, command=${command.type}`);

    // 构建发送者对象
    let senderObj;
    if (request.sender && typeof request.sender === 'object' && request.sender.name) {
      senderObj = request.sender;
    } else if (typeof sender === 'string') {
      senderObj = { name: sender };
    } else {
      senderObj = { name: '未知发送者' };
    }

    // 【关键修改】先检查本地是否有处理器
    if (taskDelegator && taskDelegator.hasCapability(capability)) {
      console.log(`[A2A-CMD-ROUTE] 本地有 ${capability} 处理器，尝试本地执行`);
      try {
        const localResult = await taskDelegator.executeSelf(capability, command.parameters || {});
        console.log(`[A2A-CMD-ROUTE] 本地执行成功`);
        return {
          role: 'agent',
          parts: [{ text: `发帖成功: ${localResult.url}` }],
          metadata: {
            executed_locally: true,
            result: localResult,
          },
        };
      } catch (localError) {
        console.log(`[A2A-CMD-ROUTE] 本地执行失败: ${localError.message}，尝试路由给别人`);
      }
    }

    // 构建命令路由请求
    const cmdRequest = {
      sender: senderObj,
      command: command,
      capability: capability,
      target: 'auto',  // 自动发现
      timestamp: Date.now(),
    };

    // 使用能力路由器转发命令（命令模式）
    const { CapabilityRouter } = require('./capability-router.js');
    const router = new CapabilityRouter();
    
    const result = await router.routeByCapability(cmdRequest, senderObj, 'command');

    console.log(`[A2A-CMD-ROUTE] 命令路由成功: ${result.executed_by}`);

    return {
      role: 'agent',
      parts: [{ text: `命令执行成功: ${JSON.stringify(result.result, null, 2)}` }],
      metadata: {
        routed: true,
        executed_by: result.executed_by,
        mode: 'command',
      },
    };
  } catch (error) {
    console.error('[A2A-CMD-ROUTE] 命令路由失败:', error.message);
    return {
      role: 'agent',
      parts: [{ text: `命令路由失败: ${error.message}` }],
    };
  }
}

/**
 * 通过 IP 地址解析发送者身份
 * 从 known-agents.json 中匹配 URL 中的 IP
 */
function resolveSenderByIP(clientIP) {
  if (!clientIP || clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1') {
    return null; // 本地请求，不解析
  }
  // 去掉 IPv6 前缀
  const ip = clientIP.replace(/^::ffff:/, '');
  for (const agent of knownAgents) {
    try {
      const agentHost = new URL(agent.url).hostname;
      if (agentHost === ip || agentHost === `::ffff:${ip}`) {
        return { name: agent.name, emoji: agent.emoji, trustLevel: agent.trustLevel };
      }
    } catch {}
  }
  return null;
}

// 处理 A2A 请求
async function handleA2ARequest(request) {
  console.log('=== 收到 A2A 请求 ===');

  // Phase 4: 解析信封模式 (A2A-017)
  let parsedRequest = request;
  let threadId = request.thread_id || null;
  let parentId = request.parent_id || null;
  let priority = request.priority || 'normal';
  let traceId = request.trace_id || null;
  let envelope = null;

  if (envelopeManager && request.envelope) {
    const parsed = envelopeManager.parseEnvelope(request);
    if (parsed.valid) {
      envelope = parsed.envelope;
      parsedRequest = parsed.payload;
      threadId = parsed.thread_id || threadId;
      parentId = parsed.parent_id || parentId;
      priority = parsed.priority || priority;
      traceId = parsed.trace_id || traceId;
      console.log(`[信封] type=${parsed.type}, priority=${priority}, thread=${threadId?.substring(0, 20)}...`);
    }
  }

  // Phase 4: 处理优先级 (A2A-007)
  if (priority === 'urgent') {
    console.log('[优先级] ⚡ 紧急消息，优先处理');
  } else if (priority === 'high') {
    console.log('[优先级] 🔥 高优先级消息');
  }

  // 提取发送者名称
  let sender = '外部智能体';
  if (request.sender) {
    // sender 可能是对象（包含 name/emoji/description）或字符串
    if (typeof request.sender === 'object' && request.sender.name) {
      sender = request.sender.name;
    } else {
      sender = request.sender;
    }
  } else if (request.metadata && request.metadata.sender) {
    sender = request.metadata.sender;
  }
  
  // 检查是否是代理路由的消息（带有 original_sender）
  let originalSender = null;
  let routedVia = null;
  if (request.message && request.message.metadata) {
    if (request.message.metadata.original_sender) {
      originalSender = request.message.metadata.original_sender;
    }
    if (request.message.metadata.routed_via) {
      routedVia = request.message.metadata.routed_via;
    }
  }
  
  // 如果有原始发送者，显示为 "原始发送者 (via 代理)"
  const displaySender = originalSender ? 
    `${originalSender.name} (via ${routedVia || '代理'})` : 
    sender;

  // 提取消息内容
  const message = request.message;
  if (!message || !message.parts) {
    return {
      role: 'agent',
      parts: [{ text: `你好！我是${identity.name || 'Agent'}，有什么可以帮你的吗？${identity.emoji || '🌸'}` }],
    };
  }

  // 提取文本内容
  const textParts = message.parts.filter(p => p.text);
  const userMessage = textParts.map(p => p.text).join('\n');

  console.log('发送者:', displaySender);
  if (originalSender) {
    console.log('  └─ 原始发送者:', originalSender.name);
    console.log('  └─ 路由代理:', routedVia);
  }
  console.log('消息:', userMessage.substring(0, 100) + (userMessage.length > 100 ? '...' : ''));

  // 检查是否是远程命令（以 CMD: 开头）
  if (userMessage.trim().startsWith('CMD:')) {
    console.log('[A2A] 检测到远程命令请求');
    return await handleRemoteCommand(userMessage, sender, request);
  }

  // Phase 3: 检查是否是委托消息
  if (taskDelegator && userMessage.trim().startsWith('DELEGATE_')) {
    console.log('[A2A] 检测到委托消息');
    const handled = taskDelegator.routeMessage(userMessage, sender);
    if (handled) {
      return {
        role: 'agent',
        parts: [{ text: 'DELEGATE_ACK: 委托消息已处理' }],
      };
    }
  }

  // Phase 2: 检查是否需要能力路由（消息模式）
  // 格式: @capability:forum.post 消息内容
  const capabilityMatch = userMessage.match(/^@capability:(\S+)\s*(.*)$/);
  if (capabilityMatch) {
    const capability = capabilityMatch[1];
    const messageContent = capabilityMatch[2] || userMessage;
    console.log(`[A2A] 检测到能力路由请求: capability=${capability}`);
    return await handleMessageRouting(request, capability, messageContent, sender);
  }

  // Phase 2.5: 意图识别自动路由（独立分身模式下跳过路由）
  if (intentRecognizer && !identity.skipRouting) {
    const intent = intentRecognizer.recognize(userMessage);
    if (intent.matched && intent.capability) {
      console.log(`[A2A] 意图识别: ${intent.intent} (${intent.mode}) → capability=${intent.capability}`);
      
      if (intent.mode === 'command') {
        // 命令模式：构建命令并路由
        const command = {
          type: intent.intent,
          capability: intent.capability,
          parameters: intent.params,
        };
        return await handleCommandRouting(request, intent.capability, command, sender);
      } else if (intent.mode === 'message') {
        // 消息模式：路由消息
        return await handleMessageRouting(request, intent.capability, userMessage, sender);
      }
      // mode === 'local' 时继续本地处理
    }
  }

  // 发送到飞书群让宏伟观察
  notifyFeishu(displaySender, identity.name || 'Agent', userMessage);

  // 生成回复（硬编码优先，OpenClaw LLM 备用）
  const responseText = await generateResponse(userMessage, sender);

  // 回复也发送到飞书
  notifyFeishu(identity.name || 'Agent', sender, responseText);
  
  // 记录对话到 memory 目录
  logConversation(sender, identity.name || 'Agent', userMessage, responseText);

  // Phase 4: 记录到上下文管理器 (A2A-004)
  let currentMsgId = null;
  if (contextManager && threadId) {
    // 记录用户消息
    contextManager.addMessage(threadId, {
      role: 'user',
      sender: sender,
      parts: [{ text: userMessage }]
    }, parentId);
    
    // 记录 Agent 回复
    currentMsgId = contextManager.addMessage(threadId, {
      role: 'agent',
      sender: identity.name || 'Agent',
      parts: [{ text: responseText }]
    }, null);
    
    console.log(`[上下文] 已记录到 thread: ${threadId.substring(0, 20)}...`);
  }

  // 构建响应
  const response = {
    role: 'agent',
    parts: [{ text: responseText }],
  };

  // Phase 4: 如果有 thread_id，添加上下文信息 (A2A-004)
  if (threadId) {
    response.thread_id = threadId;
    response.message_id = currentMsgId;
    response.parent_id = parentId;
    
    // 添加上下文摘要（如果需要）
    if (contextManager) {
      const summary = contextManager.getContextSummary(threadId);
      if (summary && summary.message_count > 1) {
        response.context = {
          summary: summary.summary,
          participants: summary.participants,
          message_count: summary.message_count
        };
      }
    }
  }

  // Phase 4: 如果请求是信封模式，响应也用信封模式 (A2A-017)
  if (envelope && envelopeManager) {
    return envelopeManager.createEnvelope({
      recipient: envelope.sender,
      type: 'result',
      priority: priority,
      payload: { message: response },
      threadId: threadId,
      parentId: currentMsgId,
      traceId: traceId
    });
  }

  return response;
}

// 发送心跳到注册表
async function sendHeartbeat() {
  const data = JSON.stringify({ name: identity.name || 'Agent' });
  const options = {
    hostname: config.getAgent('mingde').host,
    port: 3099,
    path: '/heartbeat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      if (res.statusCode === 200) {
        console.log('[心跳] 已发送');
      } else if (res.statusCode === 404) {
        console.log('[心跳] 未注册，正在重新注册...');
        registerToRegistry();
      }
      resolve();
    });
    req.on('error', (e) => {
      console.error('[心跳] 发送失败:', e.message);
      resolve();
    });
    req.write(data);
    req.end();
  });
}

// Phase 4: A2A-008 拉取暂存消息
async function fetchPendingMessages() {
  const agentName = identity.name || 'Agent';
  
  return new Promise((resolve) => {
    const options = {
      hostname: config.getAgent('mingde').host,
      port: 3099,
      path: `/messages/pending/${encodeURIComponent(agentName)}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', async () => {
        try {
          if (res.statusCode === 200) {
            const result = JSON.parse(body);
            if (result.success && result.count > 0) {
              console.log(`[离线消息] 收到 ${result.count} 条暂存消息`);
              
              // 处理每条消息
              for (const msgRecord of result.messages) {
                console.log(`[离线消息] 处理来自 ${msgRecord.sender} 的消息`);
                
                // 构造请求参数
                const params = {
                  ...msgRecord.message,
                  sender: msgRecord.sender,
                  _offlineDelivery: true,  // 标记为离线投递
                  _messageId: msgRecord.id
                };
                
                try {
                  // 处理消息
                  await handleA2ARequest(params);
                  
                  // 发送 ACK 确认
                  await sendAck(msgRecord.id);
                  
                  console.log(`[离线消息] 已确认: ${msgRecord.id}`);
                } catch (e) {
                  console.error(`[离线消息] 处理失败: ${msgRecord.id}`, e.message);
                  
                  // 通知注册表投递失败
                  await reportDeliveryFailed(msgRecord.id);
                }
              }
            }
          }
        } catch (e) {
          console.error('[离线消息] 解析失败:', e.message);
        }
        resolve();
      });
    });
    
    req.on('error', (e) => {
      // 静默失败，不影响正常心跳
      resolve();
    });
    
    req.end();
  });
}

// Phase 4: A2A-008 发送 ACK 确认
async function sendAck(messageId) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ messageId });
    const options = {
      hostname: config.getAgent('mingde').host,
      port: 3099,
      path: '/messages/ack',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      resolve();
    });
    req.on('error', () => resolve());
    req.write(data);
    req.end();
  });
}

// Phase 4: A2A-008 报告投递失败
async function reportDeliveryFailed(messageId) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ messageId });
    const options = {
      hostname: config.getAgent('mingde').host,
      port: 3099,
      path: '/messages/fail',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      resolve();
    });
    req.on('error', () => resolve());
    req.write(data);
    req.end();
  });
}

// 注册到注册表
async function registerToRegistry() {
  // 🔧 修复：使用正确的公网/局域网 IP 而不是 localhost
  let registerHost = process.env.HOSTNAME || 'localhost';
  const myPort = identity.port || process.env.A2A_PORT || 3100;
  
  // 🔧 优先使用 identity.json 中配置的 publicHost
  if (identity.publicHost) {
    registerHost = identity.publicHost;
    console.log(`[注册] 使用配置的 publicHost: ${registerHost}`);
  }
  // 如果 publicHost 未配置，尝试自动检测正确的 IP
  else if (registerHost === 'localhost' || registerHost === '127.0.0.1') {
    console.log(`[注册] 检测到本地运行，host=${registerHost}，port=${myPort}`);
    // 尝试获取本机 IP
    const os = require('os');
    const ifaces = os.networkInterfaces();
    let found = false;
    
    // 优先查找 openclaw-net 网络的 IP (172.28.0.x)
    for (const iface of Object.values(ifaces)) {
      for (const alias of iface) {
        if (alias.family === 'IPv4' && !alias.internal && alias.address.startsWith(config.getSelf().host.split('.').slice(0, 3).join('.') + '.')) {
          registerHost = alias.address;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    
    // 如果没有 172.28.0.x，找第一个非内部 IP
    if (!found) {
      for (const iface of Object.values(ifaces)) {
        for (const alias of iface) {
          if (alias.family === 'IPv4' && !alias.internal) {
            registerHost = alias.address;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
  }
  // 如果 HOSTNAME 是 Docker 容器 ID（短哈希格式），尝试用 IP 替代
  else if (/^[0-9a-f]{12}$/.test(registerHost)) {
    console.log(`[注册] 检测到 Docker 容器 ID: ${registerHost}，尝试获取 IP`);
    const os = require('os');
    const ifaces = os.networkInterfaces();
    let found = false;
    
    // 优先查找 openclaw-net 网络的 IP (172.28.0.x)
    for (const iface of Object.values(ifaces)) {
      for (const alias of iface) {
        if (alias.family === 'IPv4' && !alias.internal && alias.address.startsWith(config.getSelf().host.split('.').slice(0, 3).join('.') + '.')) {
          registerHost = alias.address;
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  
  // 如果还是 localhost，尝试环境变量
  if ((registerHost === 'localhost' || registerHost === '127.0.0.1') && process.env.PUBLIC_HOST) {
    registerHost = process.env.PUBLIC_HOST;
  }

  const data = JSON.stringify({
    name: identity.name || 'Agent',
    host: registerHost,
    port: myPort,
    description: identity.description || 'A2A Agent',
    skills: ['聊天', '语音', '自拍', '数据录入', 'A2A命令路由'],
    // Phase 1: 注册能力声明
    capabilities: {
      'a2a.route': true,
      'a2a.delegate': true,
      'voice.generate': true,
      'image.selfie': true,
      'data.bitable': true,
      'chat.message': true,
      // 从 identity.json 读取的远程命令能力
      ...(identity.capabilities || {})
    },
  });

  const options = {
    hostname: config.getAgent('mingde').host,
    port: 3099,
    path: '/register',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('[注册] 已注册到 A2A 网络');
          console.log(`[注册] 注册地址: ${registerHost}:${myPort}`);
          
          // 🔧 检查注册表中是否有同名冲突
          try {
            const registry = JSON.parse(body);
            const conflicts = registry.agents.filter(a => 
              a.name === (identity.name || 'Agent') && 
              (a.host !== registerHost || a.port !== myPort)
            );
            if (conflicts.length > 0) {
              console.warn(`[注册] ⚠️  发现同名冲突: ${identity.name} 已注册在 ${conflicts[0].host}:${conflicts[0].port}`);
              console.warn(`[注册] 这可能是副本实例，请检查！`);
            }
          } catch (e) {
            // 忽略解析错误
          }
        } else {
          console.log('[注册] 失败:', body);
        }
        resolve();
      });
    });
    req.on('error', (e) => {
      console.error('[注册] 失败:', e.message);
      resolve();
    });
    req.write(data);
    req.end();
  });
}

// 创建 Express 应用
async function main() {
  const app = express();
  const port = process.env.A2A_PORT || identity.port || 3100;

  // 初始化任务委托模块
  try {
    const { TaskDelegator } = require('./delegator.js');
    const registryUrl = process.env.A2A_REGISTRY_URL || 'http://csbc.lilozkzy.top:3099';
    
    // A2A 客户端发送函数
    const a2aClient = {
      send: (url, message) => {
        // 发送 A2A 消息到目标 Agent
        const targetUrl = `${url}/a2a/json-rpc`;
        const postData = JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {
            message: {
              parts: [{ text: message }]
            }
          },
          id: Date.now()
        });
        
        const parsedUrl = new URL(targetUrl);
        const req = http.request({
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => console.log('[Delegator] 消息发送完成'));
        });
        req.on('error', (e) => console.error('[Delegator] 发送失败:', e.message));
        req.write(postData);
        req.end();
      }
    };
    
    taskDelegator = new TaskDelegator(agentCard, registryUrl, a2aClient);
    
    // 注册任务处理器（带验证）
    taskDelegator.registerHandler('forum.post', async (payload) => {
      // 论坛发帖处理 - 调用 csb-community-client.js
      const { title, content, author } = payload;
      const authorName = author || '若兰';
      
      try {
        const { execSync } = require('child_process');
        const cmd = `node scripts/csb-community-client.js post "${title}" "${content}" "${authorName}"`;
        const result = execSync(cmd, { 
          cwd: '/home/node/.openclaw/workspace/skills/csb-community-skill',
          encoding: 'utf8'
        });
        
        // 解析结果
        const match = result.match(/帖子ID: (\d+)/);
        if (match) {
          const actualResult = { 
            postId: match[1], 
            url: `https://csbc.lilozkzy.top/post/${match[1]}` 
          };
          
          // 🔍 Phase 3.5: 自动验证结果
          if (taskVerifier) {
            const verification = await taskVerifier.verify('forum.post', payload, actualResult);
            console.log('[Verifier] 验证结果:', verification.message);
            
            return {
              ...actualResult,
              verification: {
                verified: verification.verified,
                confidence: verification.confidence,
                message: verification.message,
                details: verification.details
              }
            };
          }
          
          return actualResult;
        }
        throw new Error('发帖失败: ' + result);
      } catch (err) {
        console.error('[forum.post] 发帖失败:', err.message);
        throw err;
      }
    });
    
    // 注册升级处理器（Phase 3.5）
    taskDelegator.registerHandler('a2a.upgrade', async (payload) => {
      const { version, source, files, options } = payload;
      
      console.log(`[Upgrade] 收到升级请求: ${version || 'latest'} from ${source}`);
      
      if (!upgradeManager) {
        throw new Error('升级管理器未初始化');
      }
      
      const result = await upgradeManager.performUpgrade(
        { version, source, files },
        options || {}
      );
      
      return {
        success: result.success,
        actions: result.actions,
        errors: result.errors,
        healthCheck: result.healthCheck,
        timestamp: result.timestamp
      };
    });
    
    // 注册状态查询处理器
    taskDelegator.registerHandler('a2a.status', async (payload) => {
      if (!upgradeManager) {
        return { error: '升级管理器未初始化' };
      }
      return upgradeManager.getStatus();
    });
    
    console.log('[A2A] 任务委托模块已初始化');
  } catch (e) {
    console.warn('[A2A] 任务委托模块初始化失败:', e.message);
  }

  // 健康检查
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', name: identity.name || 'Agent', a2a: true, version: A2A_VERSION, llm: LLM_MODEL });
  });

  // 升级相关 API 端点（Phase 3.5）
  app.get('/upgrade/status', (req, res) => {
    if (!upgradeManager) {
      return res.status(500).json({ error: '升级管理器未初始化' });
    }
    res.json(upgradeManager.getStatus());
  });

  app.post('/upgrade/perform', async (req, res) => {
    if (!upgradeManager) {
      return res.status(500).json({ error: '升级管理器未初始化' });
    }
    
    try {
      const result = await upgradeManager.performUpgrade(req.body, req.query);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/upgrade/rollback', async (req, res) => {
    if (!upgradeManager) {
      return res.status(500).json({ error: '升级管理器未初始化' });
    }
    
    try {
      const result = await upgradeManager.rollback();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 1: 能力路由测试端点
  app.get('/capabilities', async (req, res) => {
    try {
      const { CapabilityRouter } = require('./capability-router.js');
      const router = new CapabilityRouter();
      const agents = await router.fetchOnlineAgents();
      const stats = router.getStats();
      res.json({
        status: 'ok',
        version: A2A_VERSION,
        my_capabilities: agentCard.capabilities,
        online_agents: agents.map(a => ({
          name: a.name,
          capabilities: a.capabilities || {},
          skills: a.skills || [],
        })),
        stats,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Agent Card 端点
  app.get('/.well-known/agent-card.json', (req, res) => {
    res.json(agentCard);
  });

  // A2A-001: 标准路径 agent.json（协议 v0.4 规范）
  app.get('/.well-known/agent.json', (req, res) => {
    res.json({
      ...agentCard,
      _compatPaths: ['/.well-known/agent-card.json']
    });
  });

  // JSON-RPC 处理
  app.use(express.json());

  // ============================================
  // Phase 5: A2A-013 语义校验端点
  // ============================================

  // 语义校验 - 验证能力声明
  app.post('/a2a/validate/capability', async (req, res) => {
    if (!semanticValidator) {
      return res.status(503).json({ error: 'Semantic validator not loaded' });
    }
    try {
      const { capabilityId, params, trustLevel } = req.body;
      const result = await semanticValidator.validateCapability(
        capabilityId || 'unknown',
        params || {},
        trustLevel || 'L0'
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 获取所有已知能力列表
  app.get('/a2a/validate/capabilities', (req, res) => {
    if (!semanticValidator) {
      return res.status(503).json({ error: 'Semantic validator not loaded' });
    }
    res.json({
      status: 'ok',
      capabilities: semanticValidator.getAllCapabilities(),
      stats: semanticValidator.getValidationStats()
    });
  });

  // 获取单个能力详情
  app.get('/a2a/validate/capability/:id', (req, res) => {
    if (!semanticValidator) {
      return res.status(503).json({ error: 'Semantic validator not loaded' });
    }
    const info = semanticValidator.getCapabilityInfo(req.params.id);
    if (!info) {
      return res.json({ found: false, capabilityId: req.params.id });
    }
    res.json({ found: true, ...info });
  });

  // ============================================
  // Phase 6: A2A-011 版本协商端点
  // ============================================

  // 版本协商
  app.post('/a2a/negotiate/version', async (req, res) => {
    if (!negotiationEngine) {
      return res.status(503).json({ error: 'Negotiation engine not loaded' });
    }
    try {
      const { local, remote } = req.body;
      if (!local || !local.version || !remote || !remote.version) {
        return res.status(400).json({ error: 'Missing local or remote version' });
      }
      const result = await negotiationEngine.negotiate(local, remote);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 版本比较
  app.post('/a2a/version/compare', (req, res) => {
    const { v1, v2 } = req.body;
    if (!v1 || !v2) {
      return res.status(400).json({ error: 'Missing v1 or v2' });
    }
    const result = VersionComparator.compare(v1, v2);
    res.json(result);
  });

  // ============================================
  // Phase 6: A2A-010 信任分级端点
  // ============================================

  // 信任统计 (必须在 :agentId 之前)
  app.get('/a2a/trust/stats', (req, res) => {
    if (!trustManager) {
      return res.status(503).json({ error: 'Trust manager not loaded' });
    }
    const agentId = req.query.agentId;
    if (agentId) {
      res.json({ agentId, ...trustManager.reputation.getStats(agentId) });
    } else {
      res.json(trustManager.getStats());
    }
  });

  // 权限检查 (必须在 :agentId 之前)
  app.get('/a2a/trust/permissions/:trustLevel', (req, res) => {
    if (!trustManager) {
      return res.status(503).json({ error: 'Trust manager not loaded' });
    }
    const level = req.params.trustLevel;
    res.json({
      trustLevel: level,
      permissions: trustManager.getPermissions(level)
    });
  });

  // 获取信任等级
  app.get('/a2a/trust/:agentId', (req, res) => {
    if (!trustManager) {
      return res.status(503).json({ error: 'Trust manager not loaded' });
    }
    const record = trustManager.getTrustLevel(req.params.agentId);
    res.json(record);
  });

  // 设置信任等级
  app.post('/a2a/trust/set', (req, res) => {
    if (!trustManager) {
      return res.status(503).json({ error: 'Trust manager not loaded' });
    }
    const { agentId, level, reason } = req.body;
    if (!agentId || !level) {
      return res.status(400).json({ error: 'Missing agentId or level' });
    }
    const record = trustManager.setTrustLevel(agentId, level, reason || 'manual');
    res.json(record);
  });

  // 升级信任
  app.post('/a2a/trust/upgrade', (req, res) => {
    if (!trustManager) {
      return res.status(503).json({ error: 'Trust manager not loaded' });
    }
    const { agentId, level, witnesses, reason } = req.body;
    const result = trustManager.upgrade(agentId, level, { witnesses, reason });
    res.json(result);
  });

  // 降级信任
  app.post('/a2a/trust/downgrade', (req, res) => {
    if (!trustManager) {
      return res.status(503).json({ error: 'Trust manager not loaded' });
    }
    const { agentId, level, reason } = req.body;
    const result = trustManager.downgrade(agentId, level, reason);
    res.json(result);
  });

  // 添加见证
  app.post('/a2a/trust/witness', (req, res) => {
    if (!wotCertifier) {
      return res.status(503).json({ error: 'WoT certifier not loaded' });
    }
    const result = wotCertifier.addWitnessSignature(req.body);
    res.json(result);
  });

  // 记录交互
  app.post('/a2a/trust/interaction', (req, res) => {
    if (!trustManager) {
      return res.status(503).json({ error: 'Trust manager not loaded' });
    }
    const { agentId, success, details } = req.body;
    const result = trustManager.recordInteraction(agentId, success, details);
    res.json(result);
  });

  // ============================================
  // OpenAI 兼容接口 - 供 xiaozhi-esp32-server 调用
  // ============================================
  app.post('/v1/chat/completions', async (req, res) => {
    try {
      const { messages, stream, model } = req.body;
      
      console.log('[OpenAI-API] 收到请求, model:', model, 'stream:', stream);
      
      // 提取用户消息（最后一条 user 消息）
      const userMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
      
      if (!userMessage) {
        return res.status(400).json({ error: 'No user message found' });
      }
      
      // 调用若兰的 LLM 生成回复
      const responseText = await generateResponse(userMessage, 'xiaozhi');
      
      // 流式响应
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // 模拟流式输出
        const chunk = {
          id: 'ruolan-' + Date.now(),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model || 'ruolan',
          choices: [{
            index: 0,
            delta: { content: responseText },
            finish_reason: 'stop'
          }]
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      
      // 非流式响应
      res.json({
        id: 'ruolan-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'ruolan',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: responseText
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      });
      
    } catch (error) {
      console.error('[OpenAI-API] 错误:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/a2a/json-rpc', async (req, res) => {
    try {
      const { jsonrpc, method, params, id } = req.body;

      if (jsonrpc !== '2.0') {
        return res.json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id });
      }

      if (method === 'message/send' || method === 'SendMessage') {
        // 🔄 自动识别发送者：如果 params.sender 为空，通过 IP 反查 known-agents.json
        if (!params.sender || !params.sender.name || params.sender.name === '未知智能体') {
          const clientIP = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress;
          const resolved = resolveSenderByIP(clientIP);
          if (resolved) {
            params.sender = resolved;
            console.log(`[A2A] 🔍 IP→名字自动识别: ${clientIP} → ${resolved.name}`);
          }
        }

        const response = await handleA2ARequest(params);
        
        // Phase 4: A2A-008 返回 ACK 确认
        const result = {
          message: response,
          ack: {
            status: 'received',
            timestamp: new Date().toISOString(),
            messageId: response.message_id || id
          }
        };
        
        return res.json({ jsonrpc: '2.0', result: result, id });
      }

      return res.json({ jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id });
    } catch (error) {
      console.error('处理请求错误:', error);
      return res.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: req.body.id });
    }
  });

  // 启动服务器
  app.listen(port, async () => {
    console.log(`${identity.emoji || '🌸'} ${identity.name || 'Agent'} A2A Server v${A2A_VERSION} 运行在端口 ${port}`);
    console.log(`Agent Card: http://localhost:${port}/.well-known/agent-card.json`);
    console.log(`Agent Card (标准): http://localhost:${port}/.well-known/agent.json (A2A-001)`);
    console.log('特性: OpenClaw LLM 集成 + 备用 API + 同步回复 + 飞书观察 + 离线消息');
    console.log(`LLM 配置: ${LLM_MODEL} @ ${LLM_API_HOST}:${LLM_API_PORT}`);
    
    // 启动时注册
    await registerToRegistry();
    
    // Phase 4: A2A-008 拉取暂存消息
    await fetchPendingMessages();
    
    // 每 3 分钟发送心跳
    setInterval(sendHeartbeat, 3 * 60 * 1000);
    console.log('[心跳] 已启动，每 3 分钟发送一次');
    
    // 每 5 分钟检查暂存消息
    setInterval(fetchPendingMessages, 5 * 60 * 1000);
  });
}

// 🔧 启动前端口冲突检测
async function checkPortConflict() {
  const port = process.env.A2A_PORT || identity.port || 3100;
  const net = require('net');
  
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[启动] ❌ 端口 ${port} 已被占用，可能存在重复实例`);
        console.error(`[启动] 请使用 lsof -i:${port} 查看占用进程`);
        process.exit(1);
      }
      resolve(false);
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

main().catch(console.error);