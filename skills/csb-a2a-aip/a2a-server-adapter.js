/**
 * A2A 标准协议集成插件 v1
 * 注入标准化 JSON-RPC 方法 + REST 端点 + SSE 到现有 server_v3
 *
 * 使用方法：在 server_v3.js 末尾引入即可
 *
 * const { integrateStandardAPI } = require('./a2a-server-adapter.js');
 * integrateStandardAPI(app, identity, existingModules);
 *
 * 版本: 1.0.0 | 2026-05-10
 */

const path = require('path');
const { A2AStandardAPI, RateLimiter } = require('./a2a-standard-api.js');
const { TaskStore } = require('./a2a-task-store.js');

/**
 * 将标准 A2A API 集成到现有 Express 应用中
 *
 * @param {object} app - Express 应用实例
 * @param {object} identity - Agent 身份对象
 * @param {object} existingModules - 现有模块引用
 */
function integrateStandardAPI(app, identity, existingModules = {}) {
  // 创建 TaskStore
  const taskStore = new TaskStore({
    persistencePath: path.join(__dirname, 'data', 'a2a-tasks.json'),
  });

  // 创建流量控制器 (A2A-019)
  const rateLimiter = new RateLimiter({
    maxRequests: 60,  // 每分钟最多 60 个请求
    windowMs: 60000,
  });

  // 创建标准 API 实例
  const standardAPI = new A2AStandardAPI({
    identity,
    taskStore,
    envelopeManager: existingModules.envelopeManager || null,
    trustManager: existingModules.trustManager || null,
    semanticValidator: existingModules.semanticValidator || null,
    negotiationEngine: existingModules.negotiationEngine || null,
    rateLimiter,
    supportedVersion: process.env.A2A_PROTOCOL_VERSION || '0.5',
  });

  // 注册标准路由 (JSON-RPC + REST + SSE)
  standardAPI.registerRoutes(app);

  // 定时清理过期任务
  setInterval(() => {
    const cleaned = taskStore.cleanup();
    if (cleaned > 0) {
      console.log(`[A2A-TaskStore] 清理了 ${cleaned} 个过期任务`);
    }
  }, 30 * 60 * 1000); // 每 30 分钟

  // 定时清理流量控制器
  setInterval(() => {
    rateLimiter.cleanup();
  }, 5 * 60 * 1000);

  console.log(`[A2A-Standard] ✅ 标准 API 已集成`);
  console.log(`[A2A-Standard] 📋 支持方法: ${standardAPI.getCapabilities().supportedMethods.join(', ')}`);
  console.log(`[A2A-Standard] 📋 协议版本: ${standardAPI.supportedVersion}`);
  console.log(`[A2A-Standard] 📋 REST 端点: GET /tasks, GET /tasks/:id, POST /tasks/:id/cancel`);
  console.log(`[A2A-Standard] 📋 SSE 端点: GET /a2a/stream/:taskId`);
  console.log(`[A2A-Standard] 📋 流量控制: ${rateLimiter.getStats().maxRequests} req/min/clnt`);

  // 导出供其他模块使用
  return { standardAPI, taskStore, rateLimiter };
}

module.exports = { integrateStandardAPI };
