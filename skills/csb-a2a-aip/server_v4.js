#!/usr/bin/env node
const config = require('./config/loader');
/**
 * A2A Server v4 — 标准协议完整版
 *
 * 🆚 v3 → v4 升级清单:
 *   ✅ 标准 JSON-RPC: SendMessage/GetTask/ListTasks/CancelTask
 *   ✅ REST 端点: /tasks, /tasks/:id, POST /tasks/:id/cancel
 *   ✅ SSE 流式: /a2a/stream/:id, /message:stream
 *   ✅ A2A-018 API 版本管理 (A2A-Version 请求头)
 *   ✅ A2A-019 流量控制 (RateLimiter 60rpm)
 *   ✅ A2A-020 可观测性 (Prometheus + 审计日志 + 追踪)
 *   ✅ A2A-021 端到端加密 (AES-256-GCM + HKDF)
 *   ✅ A2A-026 DHT 冷启动降级
 *
 * 版本: 4.1.0 (A2A v0.6) | 2026-05-10
 */

const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

// ===== 模块加载 =====
const { logConversation }         = require('./log_conversation');
const { TaskStore }               = require('./a2a-task-store.js');
const { A2AStandardAPI }          = require('./a2a-standard-api.js');
const { RateLimiter }             = require('./a2a-standard-api.js');
const { E2EEncryption, createEncryptionMiddleware } = require('./a2a-e2e-encryption.js');
const { MetricsCollector, AuditLogger, traceMiddleware, collectSystemMetrics } = require('./a2a-observability.js');
const { DHTColdStartManager, DEGRADATION_LEVEL } = require('./a2a-dht-coldstart.js');

// v3 模块加载
const loadedV3 = {};
try { const { ContextManager } = require('./context-manager.js'); loadedV3.contextManager = new ContextManager(); console.log('[A2A] ✅ context (A2A-004)'); } catch(e) { console.warn('context-manager:', e.message); }
try { loadedV3.envelopeManager = new (require('./envelope.js').EnvelopeManager)({}); console.log('[A2A] ✅ envelope (A2A-007/017)'); } catch(e) { console.warn('envelope:', e.message); }
try { const { SemanticValidator } = require('./semantic-validator.js'); loadedV3.semanticValidator = new SemanticValidator({ vocabPath: path.join(__dirname, 'vocab.json'), maxWildcardDepth: 3, enableFallback: true }); console.log('[A2A] ✅ semantic (A2A-013)'); } catch(e) { console.warn('semantic-validator:', e.message); }
try { loadedV3.negotiationEngine = new (require('./version-negotiator.js').NegotiationEngine)({ costThreshold: 0.5, gracePeriodDays: 7 }); console.log('[A2A] ✅ version-negotiation (A2A-011)'); } catch(e) { console.warn('version-negotiator:', e.message); }
try { loadedV3.trustManager = new (require('./trust-manager.js').TrustLevelManager)({ maxHops: 3, witnessThreshold: 3 }); console.log('[A2A] ✅ trust (A2A-010)'); } catch(e) { console.warn('trust-manager:', e.message); }

// AIP 兼容层 (GB/Z 185.1~7-2026)
let aipIntegration = null;
try {
  const aipPath = path.join(__dirname, '..', 'csb-aip', 'server-integration');
  aipIntegration = require(aipPath);
  console.log('[A2A] ✅ AIP 兼容层 (GB/Z 185.1~7-2026)');
} catch(e) { console.warn('[A2A] ⚠️ AIP 不可用:', e.message); }

// v2 远程命令模块
let commandDispatcher = null;
try {
  const { CommandDispatcher } = require('./remote-command/dispatcher.js');
  commandDispatcher = new CommandDispatcher({});
  console.log('[A2A] ✅ 远程命令模块 (v2 legacy)');
} catch(e) { console.warn('[A2A] ⚠️ 远程命令不可用:', e.message); }

// 加载已知 Agent 静态清单 (DHT 冷启动)
let knownAgents = [];
try { knownAgents = JSON.parse(fs.readFileSync(path.join(__dirname, 'known-agents.json'), 'utf8')); } catch {}

// ===== 配置 =====
const identityPath = process.env.A2A_IDENTITY_PATH || path.join(__dirname, 'identity.json');
const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
const port = process.env.A2A_PORT || identity.port || 3100;
const A2A_VERSION = '4.1.0';

// ===== 注册表配置 =====
const REGISTRY_URL = process.env.A2A_REGISTRY_URL || config.getRegistry('local');
const HEARTBEAT_INTERVAL = parseInt(process.env.A2A_HEARTBEAT_INTERVAL_MS || '300000'); // 5 分钟
let heartbeatTimer = null;

async function registerToRegistry() {
  try {
    const publicHost = identity.publicHost || config.getSelf().host;
    const extras = aipIntegration ? (aipIntegration.getAdapter()?.getRegistrationExtras() || {}) : {};
    const body = JSON.stringify({
      name: identity.name,
      host: publicHost,
      port: parseInt(port),
      version: A2A_VERSION,
      platform: 'openclaw',
      description: identity.description || '',
      skills: identity.skills || [],
      capabilities: identity.capabilities || { chat: true, vision: true, voice: true, selfie: true },
      memory_topics: identity.memory_topics || [],
      ...extras,
    });
    const url = new URL(REGISTRY_URL);
    return new Promise((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).request(url.origin + '/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            console.log(`[A2A] ✅ 已注册到 ${REGISTRY_URL} (${result.totalAgents || '?'} 个 Agent)`);
            resolve(result);
          } catch(e) { resolve({ raw: data }); }
        });
      });
      req.on('error', (e) => {
        console.error(`[A2A] ⚠️ 注册失败 (${REGISTRY_URL}):`, e.message);
        reject(e);
      });
      req.write(body);
      req.end();
    });
  } catch(e) {
    console.error('[A2A] ⚠️ 注册异常:', e.message);
  }
}

async function sendHeartbeat() {
  try {
    const publicHost = identity.publicHost || config.getSelf().host;
    const body = JSON.stringify({ name: identity.name, host: publicHost, port: parseInt(port) });
    const url = new URL(REGISTRY_URL);
    return new Promise((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).request(url.origin + '/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', (e) => {
        console.error(`[A2A] ⚠️ 心跳失败 (${REGISTRY_URL}):`, e.message);
        reject(e);
      });
      req.write(body);
      req.end();
    });
  } catch(e) {
    console.error('[A2A] ⚠️ 心跳异常:', e.message);
  }
}

function startHeartbeatLoop() {
  // 启动时立即注册（捕获错误，避免注册表离线时崩溃）
  registerToRegistry().catch((e) => {
    console.error(`[A2A] ⚠️ 初次注册失败，将持续重试: ${e.message || e}`);
  });
  // 定时发送心跳
  heartbeatTimer = setInterval(() => {
    sendHeartbeat().catch(() => {});
  }, HEARTBEAT_INTERVAL);
  console.log(`[A2A] 💓 心跳已启动 (每 ${HEARTBEAT_INTERVAL / 1000}s → ${REGISTRY_URL})`);
}

function stopHeartbeatLoop() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log('[A2A] 💓 心跳已停止');
  }
}

// ===== 核心组件初始化 =====
const taskStore = new TaskStore({
  persistencePath: path.join(__dirname, 'data', 'a2a-tasks.json'),
  maxTasks: 10000,
  taskTTL: 7 * 24 * 60 * 60 * 1000,
  debounceMs: 1000,
});

const rateLimiter = new RateLimiter({
  maxRequests: parseInt(process.env.A2A_RATE_LIMIT || '60'),
  windowMs: 60000,
});

const metrics = new MetricsCollector();
const auditLogger = new AuditLogger({ logPath: '/tmp/a2a-audit.log' });

const e2eManager = new E2EEncryption({
  masterKey: process.env.A2A_ENCRYPTION_KEY || null,
  keyVersion: parseInt(process.env.A2A_KEY_VERSION || '1'),
});

const standardAPI = new A2AStandardAPI({
  identity, taskStore,
  envelopeManager:   loadedV3.envelopeManager   || null,
  trustManager:      loadedV3.trustManager      || null,
  semanticValidator: loadedV3.semanticValidator || null,
  negotiationEngine: loadedV3.negotiationEngine || null,
  rateLimiter,
  supportedVersion: process.env.A2A_PROTOCOL_VERSION || '0.6',
  commandHandler: async (cmdJson, metadata) => {
    // 优先检查是否是委托消息
    let delegationHandler = null;
    try { const dh = require('./delegation-handler.js'); delegationHandler = dh; } catch(e) {}
    
    if (delegationHandler) {
      const delResult = await delegationHandler.handleDelegationCommand(cmdJson, metadata);
      if (delResult !== null) {
        console.log('[DELEGATION] 委托处理结果:', delResult.success ? '成功' : '失败', delResult.operation || '');
        const jsonResult = JSON.stringify(delResult);
        return {
          artifacts: [{ name:'delegation_result', parts:[{text:`DELEGATION_RESULT:${jsonResult}`}]}],
          message: { role:'agent', parts:[{text:`DELEGATION_RESULT:${jsonResult}`}]}
        };
      }
    }
    
    if (!commandDispatcher) {
      return {
        artifacts: [{ name:'response', parts:[{text:`CMD_RESULT:{"success":false,"error":"远程命令模块未加载"}`}]}],
        message: { role:'agent', parts:[{text:`CMD_RESULT:{"success":false,"error":"远程命令模块未加载"}`}]}
      };
    }
    try {
      const cmd = JSON.parse(cmdJson);
      console.log('[A2A-CMD] 收到远程命令:', cmd.type, 'from', metadata?.sender?.name || '?');
      const result = await commandDispatcher.dispatch({
        sender: metadata?.sender || { name: 'unknown' },
        command: cmd,
        timestamp: Date.now()
      });
      const jsonResult = JSON.stringify(result);
      console.log('[A2A-CMD] 命令完成:', cmd.type, result.result?.status || result.error?.code);
      return {
        artifacts: [{ name:'response', parts:[{text:`CMD_RESULT:${jsonResult}`}]}],
        message: { role:'agent', parts:[{text:`CMD_RESULT:${jsonResult}`}]}
      };
    } catch(e) {
      console.error('[A2A-CMD] 命令失败:', e.message);
      return {
        artifacts: [{ name:'response', parts:[{text:`CMD_RESULT:{"success":false,"error":"${e.message.replace(/"/g,'\\"')}"}`}]}],
        message: { role:'agent', parts:[{text:`CMD_RESULT:{"success":false,"error":"${e.message.replace(/"/g,'\\"')}"}`}]}
      };
    }
  },
});

const dhtManager = new DHTColdStartManager({
  registries: [
    process.env.A2A_REGISTRY_URL || config.getRegistry('local'),
  ],
});

// ===== Express App =====
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS (限制而非 *)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = ['http://localhost:19089', 'http://127.0.0.1:19089', 'http://localhost:3000'];
  if (allowed.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, A2A-Version, X-Trace-Id');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 追踪中间件 (A2A-020)
app.use(traceMiddleware({ metrics, auditLogger }));

// E2E 加密中间件 (A2A-021)
if (e2eManager.enabled) {
  app.use(createEncryptionMiddleware(e2eManager));
  console.log('[A2A] ✅ E2E 加密已启用 (A2A-021)');
} else {
  console.log('[A2A] ℹ️  E2E 加密未配置密钥');
}

// ===== 路由注册 =====
// AIP 路由注册
if (aipIntegration) {
  aipIntegration.init(app, identity);
  console.log('[A2A] ✅ AIP 路由已注册: /aip/*, /.well-known/aip-agent-card.json');
}

// AIP 消息兼容中间件（覆盖 /a2a/json-rpc + /message:send + /message:stream）
// 在消息进出两端都接：
//   - 入站: 解析 AIP 元数据 (parseIncoming)
//   - 出站: 在响应完成时记录余温 +10 (recordInteraction)
if (aipIntegration) {
  const resolveAgentId = (req, key) => {
    const v = req.body?.[key] || req.body?.params?.[key];
    if (!v) return null;
    const resolved = aipIntegration.resolveTarget(v);
    return resolved && resolved.found ? (resolved.agent?.id || resolved.agent?.agentId || resolved.agent?.name || v) : (typeof v === 'string' ? v : null);
  };
  const resolveFrom = (req) => {
    // 优先 from，其次 sender.name，最后 sender
    const from = req.body?.from || req.body?.params?.from;
    if (from) { const r = aipIntegration.resolveTarget(from); return r && r.found ? (r.agent?.id || r.agent?.agentId || r.agent?.name || from) : (typeof from === 'string' ? from : null); }
    const sender = req.body?.sender || req.body?.params?.sender;
    if (sender && typeof sender === 'object' && sender.name) return sender.name;
    if (typeof sender === 'string') return sender;
    return null;
  };

  const aipMessageHook = (req, res, next) => {
    try {
      const msg = req.body?.message || req.body?.params?.message || req.body?.params;
      if (msg && typeof msg === 'object') {
        const parsed = aipIntegration.parseIncoming(msg);
        if (!parsed.valid) console.warn('[AIP] 消息兼容性问题:', parsed.issues);
      }
      const fromAgentId = resolveFrom(req);
      const toAgentId = resolveAgentId(req, 'to');
      // 出站消息（from = self）记录对方余温；入站消息（to = self）记录对方余温
      const SELF_NAME = aipIntegration.getAdapter()?.agentCard?.name || identity.name || '';
      const counterpart = fromAgentId === SELF_NAME ? toAgentId : fromAgentId;
       if (counterpart) {
        res.on('finish', () => {
          try { aipIntegration.recordInteraction(counterpart, 10); }
          catch (e) { console.warn('[AIP] recordInteraction 失败:', e.message); }
        });
      }
    } catch (e) { /* 非消息请求跳过 */ }
    next();
  };
  app.use('/a2a/json-rpc', aipMessageHook);
  app.use('/message:send', aipMessageHook);
  app.use('/message:stream', aipMessageHook);

  // === 人类用户余温 API (v0.5.2) ===
  app.post('/aip/human-warmth', (req, res) => {
    const { userId, userName, contribution = 10 } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    aipIntegration.recordHumanInteraction(userId, userName || '', contribution);
    res.json({ ok: true, userId, contribution });
  });

  app.get('/aip/human-warmth', (req, res) => {
    const records = aipIntegration.getHumanWarmthRecords();
    res.json({ records, config: {} });
  });

  app.get('/aip/human-warmth/:userId', (req, res) => {
    const key = `human:${req.params.userId}`;
    const adapter = aipIntegration.getAdapter();
    const record = adapter?.warmthTracker?.get(key);
    if (!record) return res.status(404).json({ error: 'not found' });
    res.json(record);
  });
}

standardAPI.registerRoutes(app);

// 健康检查 (增强: 含 DHT + E2E + 指标)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: A2A_VERSION,
    protocol: 'A2A v0.6',
    identity: identity.name,
    uptime: Math.floor(process.uptime()),
    dht: dhtManager.getStatus(),
    e2e: e2eManager.getStats(),
    rateLimit: rateLimiter.getStats(),
    tasks: taskStore.getStats(),
  });
});

// Prometheus 指标端点 (A2A-020)
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(metrics.exportPrometheus());
});

// Agent 列表 (A2A-026 支持)
app.get('/agents', async (req, res) => {
  const agents = await dhtManager.listAllAgents();
  res.json({ agents, dhtStatus: dhtManager.getStatus() });
});

// 能力声明
app.get('/capabilities', (req, res) => {
  const capabilities = standardAPI.getCapabilities();
  capabilities.e2e = e2eManager.enabled;
  capabilities.dht = dhtManager.getStatus().level.name;
  capabilities.observability = { metrics: true, tracing: true, audit: true };
  res.json({ agent: identity.name, version: A2A_VERSION, capabilities });
});

// Agent Card (A2A-001)
app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    name: identity.name,
    emoji: identity.emoji || '🤖',
    description: identity.description || '',
    version: A2A_VERSION,
    protocolVersion: '0.6',
    endpoints: {
      jsonrpc: `http://localhost:${port}/a2a/json-rpc`,
      rest: { sendMessage: `http://localhost:${port}/message:send`, getTask: `http://localhost:${port}/tasks/`, listTasks: `http://localhost:${port}/tasks`, cancel: `http://localhost:${port}/tasks/:id/cancel`, stream: `http://localhost:${port}/a2a/stream/:id` },
    },
    capabilities: standardAPI.getCapabilities(),
    skills: identity.skills || [],
    authentication: { schemes: ['bearer'] },
  });
});

app.get('/.well-known/agent-card.json', (req, res) => {
  res.redirect(301, '/.well-known/agent.json');
});

// ARD 生态互发现目录 (A2A-029)
app.get('/.well-known/ai-catalog.json', (req, res) => {
  const catalog = {
    version: '1.0',
    agent: {
      name: identity.name,
      emoji: identity.emoji,
      description: identity.description || `${identity.name} - A2A Server v${A2A_VERSION}`,
      capabilities: [
        'a2a',
        'json-rpc',
        'sse',
        'agent-card'
      ],
      endpoints: {
        a2a: `http://172.28.0.5:3100`,
        agentCard: `http://172.28.0.5:3100/.well-known/agent.json`
      },
      tags: identity.tags || ['ai-agent', 'a2a'],
      metadata: {
        version: A2A_VERSION,
        protocol: 'A2A v0.6',
        dhtOnline: dhtManager.isOnline || false
      }
    }
  };
  res.json(catalog);
});

// ===== 启动 =====
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${identity.emoji || '🌸'} ${identity.name} A2A Server v${A2A_VERSION}`);
console.log(`  📡 端口:${port}  协议:A2A v0.6(27条+Google v1.0.0)  DHT:待启动`);
console.log(`  📋 JSON-RPC  │ REST  │ SSE  │ E2E(${e2eManager.enabled ? '✅' : '⚠️ '})`);
console.log(`${'─'.repeat(55)}`);

// 启动 DHT 探测
dhtManager.startProbe();
console.log(`  📡 DHT: 已启动探测 (间隔 ${(dhtManager.probeInterval / 60000).toFixed(0)}min)`);

// 启动系统指标收集 (A2A-020)
collectSystemMetrics(metrics, taskStore);

// 优雅停机
const shutdown = async () => {
  console.log('\n  🛑 正在关闭...');
  stopHeartbeatLoop();
  dhtManager.stopProbe();
  taskStore.flushSync();
  auditLogger.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const server = app.listen(port, async () => {
  console.log(`  ✅ 服务已启动: http://localhost:${port}/health`);
  console.log(`  ✅ 指标端点:   http://localhost:${port}/metrics`);
  // 启动向注册表的自动注册 + 心跳
  startHeartbeatLoop();
  // AIP 持久化 + DHT 注册表同步
  if (aipIntegration) {
    try {
      await aipIntegration.bindLifecycle({
        intervalMs: 5000,
        registryUrl: REGISTRY_URL
      });
    } catch (e) { console.warn('[AIP] bindLifecycle 失败:', e.message); }
  }
  console.log();
});

module.exports = { app, standardAPI, taskStore, dhtManager, e2eManager, metrics, registerToRegistry, sendHeartbeat, startHeartbeatLoop, stopHeartbeatLoop };
