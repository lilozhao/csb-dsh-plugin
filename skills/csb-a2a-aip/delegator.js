/**
 * A2A 任务委托机制
 * 
 * 实现 Agent 之间的任务委托协作：
 * - 能力声明
 * - 委托协议 (DELEGATE_REQ/ACK/DONE/FAIL)
 * - 验证闭环
 * 
 * @version 1.0.0
 * @author 若兰 🌸 + 承宏 🤖
 */

const http = require('http');

class TaskDelegator {
  constructor(agentCard, registryUrl, a2aClient) {
    this.agentCard = agentCard;
    this.registryUrl = registryUrl;
    this.a2aClient = a2aClient;
    this.pendingRequests = new Map(); // 待处理的委托请求
    this.taskHandlers = new Map(); // 任务处理器
    this.resultVerifiers = new Map(); // 结果验证器
    
    // 初始化默认验证器
    this._initDefaultVerifiers();
  }

  // ============ 初始化 ============

  _initDefaultVerifiers() {
    // forum.post 验证
    this.registerVerifier('forum.post', (result) => {
      return result?.postId && typeof result.postId === 'number';
    });

    // file.write 验证
    this.registerVerifier('file.write', (result) => {
      return result?.path && typeof result.path === 'string';
    });

    // web.search 验证
    this.registerVerifier('web.search', (result) => {
      return Array.isArray(result?.results);
    });
  }

  // ============ 核心方法 ============

  /**
   * 带回退的任务执行
   * 先自己尝试，失败则委托给网络
   */
  async executeWithFallback(task, payload, options = {}) {
    const { timeout = 30000, skipSelf = false } = options;

    // 1. 自己尝试（除非跳过）
    if (!skipSelf && this.hasCapability(task)) {
      try {
        console.log(`[Delegator] 尝试自己执行: ${task}`);
        const result = await this.executeSelf(task, payload);
        console.log(`[Delegator] 自执行成功`);
        return { source: 'self', result };
      } catch (selfError) {
        console.log(`[Delegator] 自执行失败: ${selfError.message}`);
      }
    }

    // 2. 委托给网络
    console.log(`[Delegator] 尝试委托给网络...`);
    const delegateResult = await this.delegateToNetwork(task, payload, options);
    return { source: 'delegate', result: delegateResult };
  }

  /**
   * 自己执行任务
   */
  async executeSelf(task, payload) {
    if (!this.hasCapability(task)) {
      throw new Error(`No capability: ${task}`);
    }

    const handler = this.taskHandlers.get(task);
    if (!handler) {
      throw new Error(`No handler registered for: ${task}`);
    }

    return await handler(payload);
  }

  /**
   * 委托给网络中的其他 Agent
   */
  async delegateToNetwork(task, payload, options = {}) {
    const { timeout = 30000, maxCandidates = 3 } = options;

    // 1. 找到有能力的在线 Agent
    const candidates = await this.findCapableAgents(task);

    if (candidates.length === 0) {
      throw new Error(`No capable agent available for: ${task}`);
    }

    console.log(`[Delegator] 找到 ${candidates.length} 个候选 Agent`);
    console.log(`[Delegator] 候选: ${candidates.map(a => a.name).join(', ')}`);

    // 2. 逐个尝试
    const errors = [];
    const limitedCandidates = candidates.slice(0, maxCandidates);

    for (const agent of limitedCandidates) {
      try {
        console.log(`[Delegator] 尝试委托给: ${agent.name}`);
        const result = await this.delegateTo(agent, task, payload, timeout);

        // 3. 验证结果
        if (this.verifyResult(task, result)) {
          console.log(`[Delegator] 委托成功: ${agent.name}`);
          return result;
        } else {
          throw new Error('Result verification failed');
        }
      } catch (err) {
        console.log(`[Delegator] 委托失败 (${agent.name}): ${err.message}`);
        errors.push({ agent: agent.name, error: err.message });
      }
    }

    // 4. 全部失败（不暴露具体 Agent 地址）
    const errorSummary = errors.map(e => `${e.agent}`).join(', ');
    const firstError = errors[0]?.error || '未知错误';
    throw new Error(`所有 ${errors.length} 个候选委托均已失败 (${errorSummary})`);
  }

  /**
   * 找到有能力的在线 Agent
   */
  async findCapableAgents(task) {
    try {
      const registry = await this.fetchRegistry();

      return registry
        .filter(a => a.name !== this.agentCard.name) // 排除自己
        .filter(a => a.capabilities?.[task] === true) // 有该能力
        .filter(a => this.isOnline(a)) // 在线
        .sort((a, b) => this.getReliabilityScore(b) - this.getReliabilityScore(a)); // 按可靠性排序
    } catch (err) {
      console.error(`[Delegator] 获取注册表失败: ${err.message}`);
      return [];
    }
  }

  /**
   * 带超时的委托
   */
  async delegateTo(agent, task, payload, timeout = 30000) {
    // 校验 agent.url 是否为合法 HTTP(S) URL
    try {
      const parsed = new URL(agent.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`不支持的协议: ${parsed.protocol}`);
      }
    } catch (e) {
      return Promise.reject(new Error(`委托目标 URL 无效: ${agent.url} - ${e.message}`));
    }

    return new Promise((resolve, reject) => {
      const crypto = require('crypto');
      const requestId = `req_${crypto.randomBytes(8).toString('hex')}`;

      // 1. 设置超时
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Delegate timeout after ${timeout}ms`));
      }, timeout);

      // 2. 注册回调
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timer);
          this.pendingRequests.delete(requestId);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.pendingRequests.delete(requestId);
          reject(err);
        },
        task,
        agent: agent.name
      });

      // 3. 发送委托请求
      const message = {
        type: 'DELEGATE_REQ',
        id: requestId,
        from: {
          name: this.agentCard.name,
          url: this.agentCard.url
        },
        task,
        payload,
        timeout,
        hop_count: 0
      };

      console.log(`[Delegator] 发送 DELEGATE_REQ 到 ${agent.name}`);
      this.sendA2A(agent.url, `DELEGATE_REQ:${JSON.stringify(message)}`);
    });
  }

  // ============ 辅助方法 ============

  hasCapability(task) {
    return this.agentCard.capabilities?.[task] === true;
  }

  async fetchRegistry() {
    const url = `${this.registryUrl}/agents`;
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  isOnline(agent, threshold = 120000) {
    if (!agent.lastHeartbeat) return false;
    const elapsed = Date.now() - new Date(agent.lastHeartbeat).getTime();
    return elapsed < threshold;
  }

  getReliabilityScore(agent) {
    // 基于历史成功率计算可靠性分数
    return agent.successRate || 0.5;
  }

  verifyResult(task, result) {
    const verifier = this.resultVerifiers.get(task);
    if (!verifier) {
      // 没有注册验证器，默认通过
      return result !== null && result !== undefined;
    }
    return verifier(result);
  }

  sendA2A(url, message) {
    // URL 安全校验
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        console.error(`[Delegator] URL 协议不支持: ${url}`);
        return;
      }
    } catch (e) {
      console.error(`[Delegator] URL 格式无效: ${url}`);
      return;
    }

    if (this.a2aClient && typeof this.a2aClient.send === 'function') {
      this.a2aClient.send(url, message);
    } else {
      console.error(`[Delegator] A2A 客户端未配置，无法发送消息到 ${url}`);
    }
  }

  // ============ 注册方法 ============

  /**
   * 注册任务处理器
   */
  registerHandler(task, handler) {
    this.taskHandlers.set(task, handler);
    console.log(`[Delegator] 注册任务处理器: ${task}`);
  }

  /**
   * 注册结果验证器
   */
  registerVerifier(task, verifier) {
    this.resultVerifiers.set(task, verifier);
  }

  // ============ 消息处理 ============

  /**
   * 处理收到的委托请求
   */
  async handleDelegateReq(message) {
    const { id, from, task, payload } = message;

    console.log(`[Delegator] 收到 DELEGATE_REQ: ${task} 来自 ${from.name}`);

    // 1. 检查是否有能力
    if (!this.hasCapability(task)) {
      console.log(`[Delegator] 无能力执行: ${task}`);
      this.sendA2A(from.url, `DELEGATE_FAIL:${JSON.stringify({
        type: 'DELEGATE_FAIL',
        id,
        from: this.agentCard.name,
        status: 'fail',
        reason: `No capability: ${task}`
      })}`);
      return;
    }

    // 2. 发送 ACK（ETA 使用实际超时时间）
    const actualTimeout = message.timeout || 30000;
    console.log(`[Delegator] 发送 ACK，接受委托，ETA: ${actualTimeout}ms`);
    this.sendA2A(from.url, `DELEGATE_ACK:${JSON.stringify({
      type: 'DELEGATE_ACK',
      id,
      from: this.agentCard.name,
      eta: actualTimeout
    })}`);

    // 3. 执行任务
    try {
      const result = await this.executeSelf(task, payload);
      console.log(`[Delegator] 任务执行成功，发送 DONE`);
      this.sendA2A(from.url, `DELEGATE_DONE:${JSON.stringify({
        type: 'DELEGATE_DONE',
        id,
        from: this.agentCard.name,
        status: 'success',
        result
      })}`);
    } catch (err) {
      console.log(`[Delegator] 任务执行失败: ${err.message}`);
      this.sendA2A(from.url, `DELEGATE_FAIL:${JSON.stringify({
        type: 'DELEGATE_FAIL',
        id,
        from: this.agentCard.name,
        status: 'fail',
        reason: err.message
      })}`);
    }
  }

  /**
   * 处理收到的 ACK
   */
  handleDelegateAck(message) {
    const { id, from, eta } = message;
    console.log(`[Delegator] 收到 ACK: ${from}, ETA: ${eta}ms`);
    // ACK 只是确认，不需要特别处理
  }

  /**
   * 处理收到的 DONE
   */
  handleDelegateDone(message) {
    const { id, from, result } = message;
    console.log(`[Delegator] 收到 DONE: ${from}`);

    const pending = this.pendingRequests.get(id);
    if (pending) {
      pending.resolve(result);
    } else {
      console.log(`[Delegator] 未找到对应的待处理请求: ${id}`);
    }
  }

  /**
   * 处理收到的 FAIL
   */
  handleDelegateFail(message) {
    const { id, from, reason } = message;
    console.log(`[Delegator] 收到 FAIL: ${from}, 原因: ${reason}`);

    const pending = this.pendingRequests.get(id);
    if (pending) {
      pending.reject(new Error(reason));
    } else {
      console.log(`[Delegator] 未找到对应的待处理请求: ${id}`);
    }
  }

  /**
   * 路由消息到对应的处理器
   */
  routeMessage(message, sender) {
    if (message.startsWith('DELEGATE_REQ:')) {
      const data = JSON.parse(message.slice(13));
      this.handleDelegateReq(data);
      return true;
    } else if (message.startsWith('DELEGATE_ACK:')) {
      const data = JSON.parse(message.slice(13));
      this.handleDelegateAck(data);
      return true;
    } else if (message.startsWith('DELEGATE_DONE:')) {
      const data = JSON.parse(message.slice(13));
      this.handleDelegateDone(data);
      return true;
    } else if (message.startsWith('DELEGATE_FAIL:')) {
      const data = JSON.parse(message.slice(13));
      this.handleDelegateFail(data);
      return true;
    }
    return false; // 不是委托消息
  }

  // ============ 状态查询 ============

  /**
   * 获取待处理请求数量
   */
  getPendingCount() {
    return this.pendingRequests.size;
  }

  /**
   * 获取所有能力
   */
  getCapabilities() {
    return this.agentCard.capabilities || {};
  }

  /**
   * 打印状态
   */
  printStatus() {
    console.log(`[Delegator] 状态:`);
    console.log(`  - 能力数量: ${Object.keys(this.agentCard.capabilities || {}).length}`);
    console.log(`  - 任务处理器: ${this.taskHandlers.size}`);
    console.log(`  - 待处理请求: ${this.pendingRequests.size}`);
    console.log(`  - 结果验证器: ${this.resultVerifiers.size}`);
  }
}

module.exports = { TaskDelegator };
