/**
 * A2A 标准 JSON-RPC API 模块 v1.2
 * + LLM 智能回复 (从 v3 移植)
 *
 * 版本: 1.2.0 | 2026-05-10
 */

const http = require('http');
const https = require('https');
const { TaskStore, TASK_STATE, ROLE, createMessage, createArtifact, createPart, TERMINAL_STATES } = require('./a2a-task-store.js');

// ============================================
// 标准错误代码 (A2A §5.4)
// ============================================
const A2A_ERRORS = {
  TaskNotFoundError:          { code: -32001, message: 'Task not found' },
  TaskNotCancelableError:     { code: -32002, message: 'Task is not cancelable' },
  PushNotificationNotSupportedError: { code: -32003, message: 'Push notifications not supported' },
  UnsupportedOperationError:  { code: -32004, message: 'Unsupported operation' },
  ContentTypeNotSupportedError: { code: -32005, message: 'Content type not supported' },
  InvalidAgentResponseError:  { code: -32006, message: 'Invalid agent response' },
  VersionNotSupportedError:   { code: -32009, message: 'Protocol version not supported' },
  InternalError:              { code: -32603, message: 'Internal error' },
  InvalidParams:              { code: -32602, message: 'Invalid params' },
  MethodNotFound:             { code: -32601, message: 'Method not found' },
};

function a2aError(errType, details) {
  const err = A2A_ERRORS[errType] || A2A_ERRORS.InternalError;
  const resp = { code: err.code, message: err.message };
  if (details) resp.data = details;
  return resp;
}

/**
 * A2A StandardAPI - 为 Express 应用注入标准方法
 */
class A2AStandardAPI {
  constructor(options = {}) {
    this.identity          = options.identity          || { name: 'Agent', emoji: '🤖', port: 3100 };
    this.taskStore         = options.taskStore         || new TaskStore();
    this.envelopeManager   = options.envelopeManager   || null;
    this.trustManager      = options.trustManager      || null;
    this.semanticValidator = options.semanticValidator || null;
    this.negotiationEngine = options.negotiationEngine || null;
    this.supportedVersion  = options.supportedVersion  || '0.5';
    this.rateLimiter       = options.rateLimiter       || null;

    // 外部处理函数注入 (解决 v3 集成)
    this._externalHandler  = options.taskHandler || null;
    // 远程命令处理器 (CMD: 前缀)
    this._commandHandler   = options.commandHandler || null;

    // SSE 订阅者: Map<taskId, Set<{res, lastPing}>
    this.streamSubscribers = new Map();
    this._sseHeartbeatInterval = 15000; // 15s 心跳
  }

  /**
   * 设置任务处理函数 (解决 ProcessTask 桩问题)
   */
  setTaskHandler(fn) { this._externalHandler = fn; }

  // ================= 路由注册 =================

  registerRoutes(app) {
    app.post('/a2a/json-rpc',      this._handleJSONRPC.bind(this));
    app.post('/tasks/:id/cancel',   this._handleRESTCancel.bind(this));
    app.get ('/tasks/:id',          this._handleRESTGetTask.bind(this));
    app.get ('/tasks',              this._handleRESTListTasks.bind(this));
    app.post('/tasks/:id/subscribe',this._handleRESTSubscribe.bind(this));
    app.post('/message:send',       this._handleRESTSendMessage.bind(this));
    app.post('/message:stream',     this._handleRESTStreamMessage.bind(this));
    app.get ('/a2a/stream/:taskId', this._handleSSESubscribe.bind(this));

    // SSE 全局心跳
    this._sseHeartbeatTimer = setInterval(() => this._ssePingAll(), this._sseHeartbeatInterval);
  }

  // ================= JSON-RPC 分发器 =================

  async _handleJSONRPC(req, res) {
    try {
      const { jsonrpc, method, params, id } = req.body;

      if (jsonrpc !== '2.0') {
        return res.json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: must be JSON-RPC 2.0' }, id: id || null });
      }

      // A2A-Version 检查 (§3.6 — 增强 Major.Minor 匹配)
      const verHeader = req.headers['a2a-version'];
      if (verHeader && !this._isVersionCompatible(verHeader)) {
        return res.json({ jsonrpc: '2.0', error: a2aError('VersionNotSupportedError', { requested: verHeader, supported: this.supportedVersion }), id });
      }

      // 流量控制 — 修复 IP 提取
      if (this.rateLimiter) {
        const clientIp = this._clientIp(req);
        if (!this.rateLimiter.allow(clientIp)) {
          return res.json({ jsonrpc: '2.0', error: { code: -32010, message: 'Rate limit exceeded', data: { retryAfterMs: this.rateLimiter.retryAfter(clientIp) } }, id });
        }
      }

      // 🔄 向下兼容旧版方法名（v3 client → v4 server）
      const METHOD_ALIASES = {
        'message/send': 'SendMessage',
        'tasks/send':   'SendMessage',
        'tasks/get':    'GetTask',
        'tasks/list':   'ListTasks',
        'tasks/cancel': 'CancelTask',
      };
      const normalizedMethod = METHOD_ALIASES[method] || method;

      let result;
      switch (normalizedMethod) {
        case 'SendMessage':          result = await this._sendMessage(params); break;
        case 'SendStreamingMessage': result = await this._sendMessage(params); break; // 非流式回退
        case 'GetTask':              result = this._getTask(params);            break;
        case 'ListTasks':            result = this._listTasks(params);         break;
        case 'CancelTask':           result = this._cancelTask(params);         break;
        default:
          return res.json({ jsonrpc: '2.0', error: a2aError('MethodNotFound', { method }), id });
      }

      if (result?.error) {
        return res.json({ jsonrpc: '2.0', error: a2aError(result.error, result.details), id });
      }

      return res.json({ jsonrpc: '2.0', result, id });
    } catch (err) {
      console.error('[A2A] JSON-RPC 错误:', err.message);
      return res.json({ jsonrpc: '2.0', error: a2aError('InternalError', { detail: err.message }), id: req.body?.id || null });
    }
  }

  // ================= 核心方法 =================

  async _sendMessage(params) {
    if (!params?.message) return { error: 'InvalidParams', details: 'Missing message field' };
    if (!params.message.role || !params.message.parts) return { error: 'InvalidParams', details: 'Message must have role and parts' };

    const msg = params.message;
    const returnImmediately = params.configuration?.returnImmediately === true;

    for (const p of msg.parts) {
      if (p.file?.mimeType && !this._isContentTypeSupported(p.file.mimeType)) {
        return { error: 'ContentTypeNotSupportedError', details: `Unsupported: ${p.file.mimeType}` };
      }
    }

    // 将 sender 信息存入 metadata，供 LLM 回复使用
    const taskMetadata = {
      ...(params.configuration?.metadata || {}),
      ...(params.sender ? { sender: params.sender } : {}),
    };

    const task = this.taskStore.createTask({
      contextId: msg.contextId || undefined,
      metadata: Object.keys(taskMetadata).length > 0 ? taskMetadata : undefined,
    });

    this.taskStore.addHistory(task.id, { role: msg.role, parts: msg.parts, messageId: msg.messageId || `msg_${Date.now()}` });
    this.taskStore.updateTaskStatus(task.id, TASK_STATE.SUBMITTED, 'Task created');

    if (returnImmediately) return { task: this.taskStore.getTask(task.id) };

    // 实际处理 (外部注入或桩)
    this.taskStore.updateTaskStatus(task.id, TASK_STATE.WORKING, 'Processing');
    try {
      const response = await this._processTask(task.id, msg, taskMetadata);

      if (response?.artifacts) {
        for (const art of response.artifacts) this.taskStore.addArtifact(task.id, art);
      }
      if (response?.message) {
        this.taskStore.addHistory(task.id, response.message);
      }

      this.taskStore.updateTaskStatus(task.id, TASK_STATE.COMPLETED, 'Completed');
      const result = this.taskStore.getTask(task.id);
      this._notifySubscribers(task.id, { task: result });
      return { task: result };
    } catch (err) {
      console.error(`[A2A] Task ${task.id} failed:`, err.message);
      this.taskStore.updateTaskStatus(task.id, TASK_STATE.FAILED, err.message);
      const failed = this.taskStore.getTask(task.id);
      this._notifySubscribers(task.id, { task: failed });
      return { task: failed };
    }
  }

  _getTask(params) {
    if (!params?.taskId) return { error: 'InvalidParams', details: 'Missing taskId' };
    const task = this.taskStore.getTask(params.taskId);
    if (!task) return { error: 'TaskNotFoundError', details: { taskId: params.taskId } };
    if (params.historyLength !== undefined) {
      if (params.historyLength === 0) delete task.history;
      else if (task.history?.length > params.historyLength) task.history = task.history.slice(-params.historyLength);
    }
    return { task };
  }

  _listTasks(params) {
    return this.taskStore.listTasks({
      contextId: params?.contextId, state: params?.state,
      includeArtifacts: params?.includeArtifacts, historyLength: params?.historyLength,
      pageToken: params?.pageToken, pageSize: params?.pageSize,
    });
  }

  _cancelTask(params) {
    if (!params?.taskId) return { error: 'InvalidParams', details: 'Missing taskId' };
    const result = this.taskStore.cancelTask(params.taskId, params.reason);
    if (result.error) return result;
    this._notifySubscribers(params.taskId, { task: result.task });
    return { task: result.task };
  }

  // ================= SSE 流式 =================

  _handleSSESubscribe(req, res) {
    const task = this.taskStore.getTask(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`data: ${JSON.stringify({ task })}\n\n`);

    if (TERMINAL_STATES.has(task.status.state)) {
      res.write(`event: done\ndata: {}\n\n`);
      return res.end();
    }

    if (!this.streamSubscribers.has(task.id)) {
      this.streamSubscribers.set(task.id, new Set());
    }
    const entry = { res, lastPing: Date.now() };
    this.streamSubscribers.get(task.id).add(entry);

    req.on('close', () => {
      const subs = this.streamSubscribers.get(task.id);
      if (subs) { subs.delete(entry); if (subs.size === 0) this.streamSubscribers.delete(task.id); }
    });
  }

  _ssePingAll() {
    const now = Date.now();
    for (const [tid, subs] of this.streamSubscribers) {
      for (const entry of subs) {
        try {
          entry.res.write(': ping\n\n');
          entry.lastPing = now;
        } catch { subs.delete(entry); }
      }
      if (subs.size === 0) this.streamSubscribers.delete(tid);
    }
  }

  _notifySubscribers(taskId, data) {
    const subs = this.streamSubscribers.get(taskId);
    if (!subs) return;
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const entry of subs) {
      try { entry.res.write(payload); } catch { subs.delete(entry); }
    }
  }

  // ================= REST 端点 =================

  _handleRESTGetTask(req, res) {
    const r = this._getTask({ taskId: req.params.id, historyLength: req.query.historyLength });
    if (r.error) return res.status(404).json(r);
    res.json(r);
  }
  _handleRESTListTasks(req, res) {
    res.json(this._listTasks({
      contextId: req.query.contextId, state: req.query.state,
      includeArtifacts: req.query.includeArtifacts === 'true',
      pageToken: req.query.pageToken,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize) : undefined,
    }));
  }
  _handleRESTCancel(req, res) {
    const r = this._cancelTask({ taskId: req.params.id, reason: req.body?.reason });
    if (r.error) return res.status(r.error === 'TaskNotFoundError' ? 404 : 400).json(r);
    res.json(r);
  }
  async _handleRESTSendMessage(req, res) {
    const r = await this._sendMessage({ message: req.body.message, configuration: req.body.configuration });
    if (r.error) return res.status(400).json(r);
    res.json(r);
  }
  async _handleRESTStreamMessage(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const msg = req.body.message;
    if (!msg) { res.write(`event: error\ndata: ${JSON.stringify({ error: 'Missing message' })}\n\n`); return res.end(); }

    const task = this.taskStore.createTask({ contextId: msg.contextId, metadata: { sender: req.body.sender } });
    this.taskStore.addHistory(task.id, { role: msg.role, parts: msg.parts, messageId: msg.messageId || `msg_${Date.now()}` });
    this.taskStore.updateTaskStatus(task.id, TASK_STATE.WORKING);
    res.write(`data: ${JSON.stringify({ task: this.taskStore.getTask(task.id) })}\n\n`);

    try {
      const resp = await this._processTask(task.id, msg, { sender: req.body.sender });
      if (resp?.artifacts) {
        for (const art of resp.artifacts) {
          this.taskStore.addArtifact(task.id, art);
          res.write(`event: artifact\ndata: ${JSON.stringify({ artifact: art })}\n\n`);
        }
      }
      this.taskStore.updateTaskStatus(task.id, TASK_STATE.COMPLETED);
      res.write(`data: ${JSON.stringify({ task: this.taskStore.getTask(task.id) })}\n\n`);
    } catch (err) {
      this.taskStore.updateTaskStatus(task.id, TASK_STATE.FAILED, err.message);
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    }
    res.write('event: done\ndata: {}\n\n');
    res.end();
  }
  _handleRESTSubscribe(req, res) { this._handleSSESubscribe(req, res); }

  // ================= 辅助 =================

  async _processTask(taskId, msg, metadata) {
    if (this._externalHandler) return this._externalHandler(taskId, msg);

    let text = msg.parts.filter(p => p.text).map(p => p.text).join(' ');
    if (!text || text.trim().length < 2) text = '(empty)';

    // 🚀 CMD: 前缀 → 远程命令执行
    if (text.startsWith('CMD:') && this._commandHandler) {
      return await this._commandHandler(text.substring(4).trim(), metadata);
    }

    // 🔥 尝试 LLM 智能回复 (非空消息)
    const llmResponse = await this._callLLM(text, metadata);

    if (llmResponse) {
      console.log(`[A2A] 🤖 LLM 回复 task ${taskId}: ${llmResponse.substring(0, 60)}...`);
      
      // 🧠 入站 A2A 消息记忆（异步，不阻塞主流程）
      try {
        const senderName = metadata?.sender?.name ||
          (metadata?.sender && typeof metadata.sender === 'string' ? metadata.sender : null) ||
          '未知智能体';
        const a2aMemory = require('./a2a-memory');
        a2aMemory.processConversation(senderName, text, llmResponse).catch(() => {});
      } catch(e) { /* 记忆模块可选，跳过 */ }
      return {
        artifacts: [createArtifact([createPart(llmResponse)], { name: 'response' })],
        message: createMessage(ROLE.AGENT, [createPart(llmResponse)]),
      };
    }

    // 降级: 回声模式
    console.log(`[A2A] ⚠️ LLM 不可用，使用回声回复 task ${taskId}`);
    return {
      artifacts: [createArtifact([createPart(`Received: ${text}`)], { name: 'response' })],
      message: createMessage(ROLE.AGENT, [createPart(`Processed message for task ${taskId}`)]),
    };
  }

  // ================= LLM 智能回复 =================

  /**
   * 调用 LLM 生成智能回复 (从 v3 server_v3.js 移植)
   */
  async _callLLM(messageText, metadata) {
    const llmConfig = this.identity?.llm;
    if (!llmConfig?.host || !llmConfig?.apiKey) {
      console.log('[A2A] LLM 未配置 (host/apiKey)', JSON.stringify(llmConfig));
      return null;
    }
    console.log('[A2A] 🤖 调用 LLM:', llmConfig.host, llmConfig.model);

    // 提取发送者名称 (优先从 metadata)
    const senderName = metadata?.sender?.name ||
      metadata?.sender ||
      (typeof metadata?.sender === 'string' ? metadata.sender : null) ||
      '未知智能体';

    // 生成系统提示
    const systemPrompt = this.identity.systemPrompt ||
      `你是${this.identity.name || 'Agent'}，${this.identity.description || '一个 AI 伙伴'}。
性格: ${this.identity.personality || '友善、好奇'}。
请用自然、有个性的方式回复，50-120字内。用${this.identity.emoji || '🤖'}表情。`;

    const payload = JSON.stringify({
      model: llmConfig.model || 'astron-code-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `[来自 ${senderName} 的消息]
${messageText}` }
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    return new Promise((resolve) => {
      const transport = String(llmConfig.port) === '443' ? https : http;
      const req = transport.request({
        hostname: llmConfig.host,
        port: parseInt(llmConfig.port) || 443,
        path: llmConfig.path || '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${llmConfig.apiKey}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const content = data.choices?.[0]?.message?.content?.trim();
            if (content) { resolve(content); return; }
            // OpenClaw 自定义格式
            const alt = data.response || data.text || data.content;
            if (alt) { resolve(alt.trim()); return; }
            console.error('[A2A] LLM 返回格式异常:', body.substring(0, 150));
            resolve(null);
          } catch (e) {
            console.error('[A2A] LLM 解析失败:', e.message);
            resolve(null);
          }
        });
      });
      req.on('error', e => { console.error('[A2A] LLM 连接失败:', e.message); resolve(null); });
      req.setTimeout(15000, () => { req.destroy(); console.error('[A2A] LLM 超时'); resolve(null); });
      req.write(payload); req.end();
    });
  }

  _clientIp(req) {
    // 增强 IP 提取: x-forwarded-for > req.ip > remoteAddress
    const xff = req.headers['x-forwarded-for'];
    if (xff) return xff.split(',')[0].trim();
    return req.ip || req.connection?.remoteAddress || 'unknown';
  }

  _isContentTypeSupported(mimeType) {
    const supported = ['text/plain','text/markdown','application/json','image/jpeg','image/png','audio/mpeg','audio/wav'];
    return supported.includes(mimeType);
  }

  _isVersionCompatible(version) {
    if (!version) return true;
    // 增强: Major.Minor 匹配
    const parts = version.split('.');
    const our = this.supportedVersion.split('.');
    if (parts[0] !== our[0]) return false;
    if (parts.length > 1 && our.length > 1 && parts[1] !== our[1]) return false;
    return true;
  }

  getCapabilities() {
    return {
      streaming: true,
      pushNotifications: true,
      extendedAgentCard: false,
      supportedMethods: ['SendMessage','GetTask','ListTasks','CancelTask','SendStreamingMessage'],
      supportedVersion: this.supportedVersion,
    };
  }
}

// ============================================
// 流量控制器 (A2A-019)
// ============================================
class RateLimiter {
  constructor(options = {}) {
    this.maxRequests = options.maxRequests || 60;
    this.windowMs    = options.windowMs    || 60000;
    this.buckets     = new Map();
  }

  allow(clientId) {
    const now = Date.now();
    const bucket = this.buckets.get(clientId) || { count: 0, windowStart: now };
    if (now - bucket.windowStart > this.windowMs) { bucket.count = 0; bucket.windowStart = now; }
    bucket.count++;
    this.buckets.set(clientId, bucket);
    return bucket.count <= this.maxRequests;
  }

  retryAfter(clientId) {
    const b = this.buckets.get(clientId);
    return b ? Math.max(0, this.windowMs - (Date.now() - b.windowStart)) : 0;
  }

  cleanup() {
    const now = Date.now();
    for (const [k, b] of this.buckets) {
      if (now - b.windowStart > this.windowMs * 2) this.buckets.delete(k);
    }
  }

  getStats() {
    return { totalClients: this.buckets.size, windowMs: this.windowMs, maxRequests: this.maxRequests };
  }
}

module.exports = { A2AStandardAPI, RateLimiter, A2A_ERRORS, a2aError };
