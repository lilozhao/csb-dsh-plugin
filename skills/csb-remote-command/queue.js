/**
 * A2A 远程命令执行 - 命令队列管理
 * 每发送方最多 1 个并发，其他排队等待
 */

class CommandQueue {
  constructor(config = {}) {
    this.maxConcurrent = config.maxConcurrent || 1;    // 每发送方最大并发数
    this.maxQueueSize = config.maxQueueSize || 10;     // 最大队列长度
    this.defaultTimeout = config.timeout || 300000;    // 默认 5 分钟排队超时
    this.queues = new Map();  // sender -> { executing: Command[], pending: QueuedCommand[] }
  }

  /**
   * 将命令加入队列
   * @param {Object} command - 命令对象
   * @param {string} sender - 发送者名称
   * @param {Function} executeFn - 执行函数
   * @returns {Promise} 执行结果
   */
  async enqueue(command, sender, executeFn) {
    const senderQueue = this.getOrCreateSenderQueue(sender);

    // 检查队列长度
    if (senderQueue.pending.length >= this.maxQueueSize) {
      throw new Error('Command queue full');
    }

    // 创建 Promise 用于等待执行
    const deferred = createDeferred();
    
    const queuedCommand = {
      id: command.id,
      command,
      sender,
      enqueueTime: Date.now(),
      timeout: this.defaultTimeout,
      deferred,
      executeFn
    };

    senderQueue.pending.push(queuedCommand);
    
    console.log(`[A2A-CMD] Command queued for ${sender}: ${command.type} (queue: ${senderQueue.pending.length})`);

    // 触发队列处理
    this.processQueue(sender);

    // 等待执行完成或超时
    return Promise.race([
      deferred.promise,
      this.createTimeout(queuedCommand)
    ]);
  }

  /**
   * 获取或创建发送者队列
   * @param {string} sender - 发送者名称
   * @returns {Object}
   */
  getOrCreateSenderQueue(sender) {
    if (!this.queues.has(sender)) {
      this.queues.set(sender, {
        executing: [],
        pending: []
      });
    }
    return this.queues.get(sender);
  }

  /**
   * 处理发送者队列
   * @param {string} sender - 发送者名称
   */
  async processQueue(sender) {
    const senderQueue = this.queues.get(sender);
    if (!senderQueue) return;

    // 检查并发数
    if (senderQueue.executing.length >= this.maxConcurrent) {
      return;
    }

    // 获取下一个待执行命令
    const next = senderQueue.pending.shift();
    if (!next) return;

    // 添加到执行中
    senderQueue.executing.push(next);

    console.log(`[A2A-CMD] Executing command for ${sender}: ${next.command.type}`);

    try {
      // 执行命令
      const startTime = Date.now();
      const result = await next.executeFn(next.command, next.sender);
      const executionTime = Date.now() - startTime;

      console.log(`[A2A-CMD] Command completed for ${sender}: ${next.command.type} (${executionTime}ms)`);

      next.deferred.resolve({
        success: true,
        result,
        executionTime
      });
    } catch (error) {
      console.error(`[A2A-CMD] Command failed for ${sender}: ${next.command.type}`, error.message);
      next.deferred.reject(error);
    } finally {
      // 从执行中移除
      senderQueue.executing = senderQueue.executing.filter(c => c.id !== next.id);

      // 继续处理队列
      this.processQueue(sender);
    }
  }

  /**
   * 创建超时 Promise
   * @param {Object} queuedCommand - 队列中的命令
   * @returns {Promise}
   */
  createTimeout(queuedCommand) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        // 从队列中移除
        const senderQueue = this.queues.get(queuedCommand.sender);
        if (senderQueue) {
          senderQueue.pending = senderQueue.pending.filter(c => c.id !== queuedCommand.id);
        }

        const waitTime = Date.now() - queuedCommand.enqueueTime;
        reject(new Error(`Command queue timeout after ${waitTime}ms`));
      }, queuedCommand.timeout);
    });
  }

  /**
   * 获取队列状态
   * @param {string} sender - 发送者名称（可选）
   * @returns {Object}
   */
  getStatus(sender) {
    if (sender) {
      const senderQueue = this.queues.get(sender);
      if (!senderQueue) {
        return { executing: 0, pending: 0 };
      }
      return {
        executing: senderQueue.executing.length,
        pending: senderQueue.pending.length
      };
    }

    // 返回所有发送者的状态
    const status = {};
    for (const [name, queue] of this.queues) {
      status[name] = {
        executing: queue.executing.length,
        pending: queue.pending.length
      };
    }
    return status;
  }

  /**
   * 清空队列
   * @param {string} sender - 发送者名称（可选，不传则清空所有）
   */
  clear(sender) {
    if (sender) {
      const senderQueue = this.queues.get(sender);
      if (senderQueue) {
        // 拒绝所有待执行的命令
        for (const cmd of senderQueue.pending) {
          cmd.deferred.reject(new Error('Queue cleared'));
        }
        senderQueue.pending = [];
      }
    } else {
      // 清空所有队列
      for (const [name, queue] of this.queues) {
        for (const cmd of queue.pending) {
          cmd.deferred.reject(new Error('Queue cleared'));
        }
      }
      this.queues.clear();
    }
  }
}

/**
 * 创建 Deferred Promise
 * @returns {Object} { promise, resolve, reject }
 */
function createDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

module.exports = { CommandQueue };
