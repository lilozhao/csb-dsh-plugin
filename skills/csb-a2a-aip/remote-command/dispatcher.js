/**
 * A2A 远程命令执行 - 命令调度器
 * 核心调度逻辑
 */

const { Signer } = require('./signer.js');
const { Validator } = require('./validator.js');
const { RateLimiter } = require('./ratelimit.js');
const { CommandQueue } = require('./queue.js');
const { AuditLogger } = require('./audit.js');
const { SandboxProviderFactory } = require('./sandbox/index.js');
const { CapabilityRouter } = require('../capability-router.js');

class CommandDispatcher {
  constructor(config = {}) {
    this.signer = new Signer(config.secret);
    this.validator = new Validator();
    this.rateLimiter = new RateLimiter(config.rateLimit);
    this.queue = new CommandQueue(config.queue);
    this.audit = new AuditLogger(config.audit);
    // 默认使用 fallback 沙箱（Docker 不可用时）
    this.sandbox = SandboxProviderFactory.create(config.platform || 'fallback');
    // 能力路由（Phase 1 新增）
    this.capabilityRouter = new CapabilityRouter(config.registry || {});
    
    this.initialized = false;
  }

  async init() {
    // 检查沙箱健康
    const healthy = await this.sandbox.health();
    if (!healthy) {
      console.warn('[A2A-CMD] Sandbox health check failed');
    }
    
    this.initialized = true;
    console.log('[A2A-CMD] Command dispatcher initialized');
  }

  /**
   * 处理命令请求
   * @param {Object} request - A2A 命令请求
   * @returns {Promise<Object>}
   */
  async dispatch(request) {
    if (!this.initialized) {
      await this.init();
    }

    const commandId = request.command?.id || `cmd_${Date.now()}`;
    const startTime = Date.now();

    try {
      // 1. 验证请求格式
      const validation = this.validator.validate(request);
      if (!validation.valid) {
        await this.logFailure(commandId, request, validation.error, startTime);
        return this.createErrorResponse(commandId, validation.code, validation.error);
      }

      // 2. 验证签名（仅在配置了密钥时）
      const skipSignature = !process.env.A2A_SHARED_SECRET || process.env.A2A_SKIP_SIGNATURE === 'true';
      if (!skipSignature && !this.signer.verifyRequest(request, request.signature)) {
        await this.logFailure(commandId, request, 'Signature verification failed', startTime);
        return this.createErrorResponse(commandId, -32003, 'Signature verification failed');
      }

      // 3. 检查频率限制
      const rateCheck = this.rateLimiter.checkLimit(request.sender.name, request.command.type);
      if (!rateCheck.allowed) {
        await this.logFailure(commandId, request, rateCheck.reason, startTime, true);
        return this.createErrorResponse(commandId, rateCheck.code, rateCheck.reason, {
          retryAfter: rateCheck.retryAfter
        });
      }

      // 4. 判断执行方式
      let result;
      
      // Phase 1: 支持 capability 自动路由
      if (request.command.capability || (!request.command.target && request.command.type.includes('.'))) {
        // 使用能力路由
        const capability = request.command.capability || request.command.type.split('.')[0];
        result = await this.executeWithCapabilityRouting(request, capability);
      } else if (request.command.target && request.command.target !== 'self') {
        // 指定了目标 Agent，直接转发
        result = await this.executeWithCapabilityRouting(request, null, request.command.target);
      } else {
        // 本地执行
        result = await this.queue.enqueue(
          request.command,
          request.sender.name,
          async (cmd, sender) => {
            return this.executeInSandbox(cmd, sender);
          }
        );
      }

      // 5. 记录成功日志
      await this.audit.log({
        command_id: commandId,
        sender: request.sender.name,
        sender_url: request.sender.url,
        command: request.command.type,
        parameters: request.command.parameters,
        status: 'success',
        execution_time: Date.now() - startTime,
        output: result.result,
        user_confirmed: false,
        rate_limit_hit: false
      });

      // 6. 返回成功响应
      return this.createSuccessResponse(commandId, result.result, Date.now() - startTime);

    } catch (error) {
      // 记录失败日志
      await this.logFailure(commandId, request, error.message, startTime);
      
      return this.createErrorResponse(commandId, -32000, error.message);
    }
  }

  /**
   * 使用能力路由执行命令（Phase 1 新增）
   * @param {Object} request - 原始请求
   * @param {string} capability - 需要的能力
   * @param {string} target - 指定的目标 Agent（可选）
   * @returns {Promise<Object>}
   */
  async executeWithCapabilityRouting(request, capability, target = null, mode = 'command') {
    console.log(`[A2A-CMD] 使用能力路由: capability=${capability}, target=${target || 'auto'}, mode=${mode}`);

    try {
      const routeRequest = {
        command: request.command,
        message: request.message,
        sender: request.sender,
        capability: capability,
        target: target,
      };

      // 传递原始发送者信息（让接收方知道是谁发的消息）
      const originalSender = request.sender;
      const routeResult = await this.capabilityRouter.routeByCapability(routeRequest, originalSender, mode);

      // 转换为标准执行结果格式
      return {
        result: routeResult,
        executed_by: routeResult.executed_by || target || 'remote',
        routed: true,
      };
    } catch (error) {
      console.error('[A2A-CMD] 能力路由失败:', error.message);
      throw error;
    }
  }

  /**
   * 在沙箱中执行命令
   */
  async executeInSandbox(command, sender) {
    console.log(`[A2A-CMD] Executing ${command.type} for ${sender}`);
    
    return await this.sandbox.execute(command.type, command.parameters);
  }

  /**
   * 记录失败日志
   */
  async logFailure(commandId, request, error, startTime, rateLimitHit = false) {
    await this.audit.log({
      command_id: commandId,
      sender: request.sender?.name,
      sender_url: request.sender?.url,
      command: request.command?.type,
      parameters: request.command?.parameters,
      status: 'failure',
      execution_time: Date.now() - startTime,
      error: { message: error },
      rate_limit_hit: rateLimitHit
    });
  }

  /**
   * 创建成功响应
   */
  createSuccessResponse(commandId, output, executionTime) {
    const response = {
      command_id: commandId,
      status: 'success',
      output,
      execution_time: executionTime,
      timestamp: Date.now()
    };

    // 签名响应
    response.signature = this.signer.signResponse(response);

    return {
      jsonrpc: '2.0',
      result: response,
      id: 1
    };
  }

  /**
   * 创建错误响应
   */
  createErrorResponse(commandId, code, message, data = {}) {
    return {
      jsonrpc: '2.0',
      error: {
        code,
        message,
        data: {
          command_id: commandId,
          ...data
        }
      },
      id: 1
    };
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      initialized: this.initialized,
      queue: this.queue.getStatus(),
      whitelist: this.validator.getWhitelist().map(w => w.name),
      sandbox: this.sandbox.getPlatform()
    };
  }
}

module.exports = { CommandDispatcher };
