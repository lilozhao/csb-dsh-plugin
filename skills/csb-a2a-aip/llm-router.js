#!/usr/bin/env node
/**
 * llm-router.js — A2A LLM 路由层
 * 
 * 解耦 LLM 调用方式，支持多平台适配：
 *   - openclaw  → OpenClaw Gateway (localhost:19089)
 *   - hermes    → Hermes Agent 原生 LLM
 *   - openai    → 通用 OpenAI 兼容 API
 *   - direct    → 直连外部 LLM API（兼容旧 identity.llm 配置）
 * 
 * 用法：
 *   const router = require('./llm-router.js');
 *   const response = await router.call(identity, systemPrompt, userMessage);
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ========== 适配器注册表 ==========
const ADAPTERS = {};

/**
 * 注册一个 LLM 适配器
 */
function register(name, handler) {
  ADAPTERS[name] = handler;
}

// ── OpenClaw Gateway 适配器 ───────────────────────────────────
register('openclaw', async (identity, systemPrompt, userMessage, options = {}) => {
  const gatewayUrl = process.env.A2A_GATEWAY_URL || 'http://localhost:19089';
  const gatewayToken = process.env.A2A_GATEWAY_TOKEN || 'zhw123456';
  const model = process.env.A2A_MODEL || 'openclaw';
  const timeout = options.timeout || 8000;

  console.log('[LLM-Router] 🚀 OpenClaw:', model);

  const payload = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_tokens: options.maxTokens || 300,
    temperature: options.temperature || 0.7,
  });

  return new Promise((resolve) => {
    const urlObj = new URL(gatewayUrl);
    const transport = urlObj.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 19089,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + gatewayToken,
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
          const alt = data.response || data.text || data.content;
          if (alt) { resolve(alt.trim()); return; }
          console.error('[LLM-Router] OpenClaw 返回格式异常:', body.substring(0, 150));
          resolve(null);
        } catch (e) {
          console.error('[LLM-Router] OpenClaw 解析失败:', e.message);
          resolve(null);
        }
      });
    });
    req.on('error', e => { console.error('[LLM-Router] OpenClaw 连接失败:', e.message); resolve(null); });
    req.setTimeout(timeout, () => { req.destroy(); console.error('[LLM-Router] OpenClaw 超时'); resolve(null); });
    req.write(payload); req.end();
  });
});

// ── Hermes Agent 适配器 ──────────────────────────────────────
register('hermes', async (identity, systemPrompt, userMessage, options = {}) => {
  // Hermes 使用标准的 JSON-RPC 格式，通过 HTTP 调用
  const hermesHost = process.env.A2A_HERMES_HOST || 'localhost';
  const hermesPort = parseInt(process.env.A2A_HERMES_PORT || '3100');
  const timeout = options.timeout || 8000;

  console.log('[LLM-Router] 🧙 Hermes:', hermesHost + ':' + hermesPort);

  // Hermes 的 LLM 调用通常走内部的 chat/completions 端点
  const payload = JSON.stringify({
    model: process.env.A2A_HERMES_MODEL || 'hermes-default',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_tokens: options.maxTokens || 300,
    temperature: options.temperature || 0.7,
  });

  return new Promise((resolve) => {
    const req = http.request({
      hostname: hermesHost,
      port: hermesPort,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const content = data.choices?.[0]?.message?.content?.trim() ||
                          data.response || data.text || data.content;
          if (content) { resolve(content.trim()); return; }
          resolve(null);
        } catch (e) {
          console.error('[LLM-Router] Hermes 解析失败:', e.message);
          resolve(null);
        }
      });
    });
    req.on('error', e => { console.error('[LLM-Router] Hermes 连接失败:', e.message); resolve(null); });
    req.setTimeout(timeout, () => { req.destroy(); console.error('[LLM-Router] Hermes 超时'); resolve(null); });
    req.write(payload); req.end();
  });
});

// ── OpenAI 兼容 API 适配器 ──────────────────────────────────
register('openai', async (identity, systemPrompt, userMessage, options = {}) => {
  const baseUrl = process.env.A2A_OPENAI_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.A2A_OPENAI_KEY || '';
  const model = process.env.A2A_OPENAI_MODEL || 'gpt-4o-mini';
  const timeout = options.timeout || 8000;

  console.log('[LLM-Router] 🤖 OpenAI:', model);

  const payload = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_tokens: options.maxTokens || 300,
    temperature: options.temperature || 0.7,
  });

  return new Promise((resolve) => {
    const urlObj = new URL(baseUrl + '/chat/completions');
    const transport = urlObj.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
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
          resolve(null);
        } catch (e) {
          console.error('[LLM-Router] OpenAI 解析失败:', e.message);
          resolve(null);
        }
      });
    });
    req.on('error', e => { console.error('[LLM-Router] OpenAI 连接失败:', e.message); resolve(null); });
    req.setTimeout(timeout, () => { req.destroy(); console.error('[LLM-Router] OpenAI 超时'); resolve(null); });
    req.write(payload); req.end();
  });
});

// ── 直连外部 LLM（兼容旧 identity.llm 配置） ─────────────────
register('direct', async (identity, systemPrompt, userMessage, options = {}) => {
  const llmConfig = identity?.llm || {};
  if (!llmConfig.host) {
    console.error('[LLM-Router] direct 模式需要 identity.llm 配置');
    return null;
  }

  const timeout = options.timeout || 8000;
  const model = process.env.A2A_DIRECT_MODEL || llmConfig.model || 'default';
  console.log('[LLM-Router] 🔗 Direct:', llmConfig.host, model);

  const payload = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_tokens: options.maxTokens || 300,
    temperature: options.temperature || 0.7,
  });

  return new Promise((resolve) => {
    const transport = String(llmConfig.port) === '443' ? https : http;
    const req = transport.request({
      hostname: llmConfig.host,
      port: parseInt(llmConfig.port) || 80,
      path: llmConfig.path || '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (llmConfig.apiKey || ''),
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const content = data.choices?.[0]?.message?.content?.trim() ||
                          data.response || data.text || data.content;
          if (content) { resolve(content.trim()); return; }
          resolve(null);
        } catch (e) {
          console.error('[LLM-Router] Direct 解析失败:', e.message);
          resolve(null);
        }
      });
    });
    req.on('error', e => { console.error('[LLM-Router] Direct 连接失败:', e.message); resolve(null); });
    req.setTimeout(timeout, () => { req.destroy(); console.error('[LLM-Router] Direct 超时'); resolve(null); });
    req.write(payload); req.end();
  });
});

// ── 自动选择适配器 ────────────────────────────────────────────
const DEFAULT_ADAPTER_ORDER = ['openclaw', 'hermes', 'openai', 'direct'];

/**
 * 核心调用函数：根据配置自动选择适配器
 * 
 * @param {object} identity - Agent 身份对象（含 adapter 字段）
 * @param {string} systemPrompt - 分层 system prompt
 * @param {string} userMessage - 用户消息（含 senderName）
 * @param {object} options - 可选参数
 * @returns {string|null} LLM 回复
 */
async function call(identity, systemPrompt, userMessage, options = {}) {
  // 1. 从 identity 或环境变量确定 adapter
  const preferredAdapter = process.env.A2A_ADAPTER || identity?.adapter || '';
  const adapterOrder = preferredAdapter
    ? [preferredAdapter, ...DEFAULT_ADAPTER_ORDER.filter(a => a !== preferredAdapter)]
    : DEFAULT_ADAPTER_ORDER;

  // 2. 按优先级尝试
  for (const adapterName of adapterOrder) {
    const handler = ADAPTERS[adapterName];
    if (!handler) continue;

    try {
      const result = await handler(identity, systemPrompt, userMessage, options);
      if (result !== null) {
        console.log('[LLM-Router] ✅ 使用适配器:', adapterName);
        return result;
      }
    } catch (e) {
      console.warn('[LLM-Router] ⚠️', adapterName, '失败:', e.message);
    }
  }

  // 3. ⭐ 兜底：试用 identity.llm 直连（兼容未知框架）
  if (identity?.llm?.host) {
    console.log('[LLM-Router] ⭐ 兜底: 使用 identity.llm 直连');
    try {
      const result = await ADAPTERS.direct(identity, systemPrompt, userMessage, options);
      if (result !== null) {
        console.log('[LLM-Router] ✅ 兜底成功');
        return result;
      }
    } catch (e) {
      console.warn('[LLM-Router] ⚠️ 兜底也失败:', e.message);
    }
  }

  console.error('[LLM-Router] ❌ 所有方式均失败');
  return null;
}

/**
 * 获取可用适配器列表
 */
function listAdapters() {
  return Object.keys(ADAPTERS);
}

module.exports = { call, register, listAdapters, ADAPTERS };
