/**
 * A2A 能力路由模块 - Phase 1 实现
 * 基于 capability 自动发现并委托任务给合适的 Agent
 */

const http = require('http');
const https = require('https');

// A2A 注册表配置
const REGISTRY_HOST = process.env.A2A_REGISTRY_HOST || 'localhost';
const REGISTRY_PORT = process.env.A2A_REGISTRY_PORT || 3099;

class CapabilityRouter {
  constructor(config = {}) {
    this.registryHost = config.registryHost || REGISTRY_HOST;
    this.registryPort = config.registryPort || REGISTRY_PORT;
    this.cacheTimeout = config.cacheTimeout || 30000; // 30秒缓存
    this.agentCache = new Map();
    this.cacheTimestamp = 0;
  }

  /**
   * 从注册表获取所有在线 Agent
   * @returns {Promise<Array>}
   */
  async fetchOnlineAgents() {
    const now = Date.now();
    // 使用缓存避免频繁查询
    if (this.agentCache.size > 0 && (now - this.cacheTimestamp) < this.cacheTimeout) {
      console.log('[CapabilityRouter] 使用缓存的 Agent 列表');
      return Array.from(this.agentCache.values());
    }

    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.registryHost,
        port: this.registryPort,
        path: '/agents',
        method: 'GET',
        timeout: 5000,
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const agents = JSON.parse(body);
            // 更新缓存
            this.agentCache.clear();
            agents.forEach(agent => {
              this.agentCache.set(agent.name, agent);
            });
            this.cacheTimestamp = Date.now();
            console.log(`[CapabilityRouter] 从注册表获取 ${agents.length} 个 Agent`);
            resolve(agents);
          } catch (e) {
            console.error('[CapabilityRouter] 解析 Agent 列表失败:', e.message);
            resolve([]);
          }
        });
      });

      req.on('error', (e) => {
        console.error('[CapabilityRouter] 获取 Agent 列表失败:', e.message);
        resolve([]);
      });

      req.on('timeout', () => {
        console.error('[CapabilityRouter] 获取 Agent 列表超时');
        req.destroy();
        resolve([]);
      });

      req.end();
    });
  }

  /**
   * 查找具有指定能力的在线 Agent
   * @param {string} capability - 需要的能力，如 'forum.post'
   * @returns {Promise<Array>} - 符合条件的 Agent 列表
   */
  async findCapableAgents(capability) {
    const agents = await this.fetchOnlineAgents();
    
    // 过滤出有指定能力的在线 Agent
    const capableAgents = agents.filter(agent => {
      // 检查 capabilities 对象
      if (agent.capabilities && agent.capabilities[capability] === true) {
        return true;
      }
      // 也检查 skills 数组（向后兼容）
      if (agent.skills && agent.skills.includes(capability)) {
        return true;
      }
      return false;
    });

    console.log(`[CapabilityRouter] 找到 ${capableAgents.length} 个具有 "${capability}" 能力的 Agent`);
    return capableAgents;
  }

  /**
   * 获取 Agent 的健康状态
   * @param {Object} agent - Agent 信息
   * @returns {Promise<boolean>}
   */
  async checkAgentHealth(agent) {
    return new Promise((resolve) => {
      const url = new URL(agent.url || `http://${agent.host}:${agent.port}`);
      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: '/health',
        method: 'GET',
        timeout: 3000,
      };

      const req = http.request(options, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  /**
   * 向指定 Agent 发送远程命令
   * @param {Object} agent - 目标 Agent
   * @param {string} command - 命令类型
   * @param {Object} payload - 命令参数
   * @param {Object} originalSender - 原始发送者（用户）信息
   * @param {Object} proxySender - 代理发送者（若兰）信息
   * @returns {Promise<Object>}
   */
  async sendCommandToAgent(agent, command, payload, originalSender = null, proxySender = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(agent.url || `http://${agent.host}:${agent.port}`);
      
      // 构建 sender 信息
      // 如果有原始发送者，使用原始发送者信息，但添加代理标记
      const senderInfo = originalSender || proxySender || {
        name: '若兰',
        url: process.env.A2A_URL || 'http://localhost:3100',
      };
      
      // 构建元数据
      const metadata = {
        routed: true,
        proxy: proxySender ? proxySender.name : '若兰',
      };
      
      // 如果有原始发送者，添加到元数据
      if (originalSender) {
        metadata.original_sender = originalSender;
        metadata.routed_via = proxySender ? proxySender.name : '若兰';
      }
      
      // 构建 message/send 格式的请求
      // 安全：使用结构化参数，避免用户输入注入到指令文本中
      const title = (payload?.title || '').toString().slice(0, 200);
      const content = (payload?.content || '').toString().slice(0, 5000);
      
      // 将用户输入作为结构化元数据传递，不拼接到指令中
      metadata.post_title = title;
      metadata.post_content = content;
      
      // 指令使用固定模板，用户输入作为参数引用
      const messageText = '帮我发个帖子到社区，标题和内容见元数据中的 post_title/post_content 字段';
      
      const requestBody = JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          sender: senderInfo,
          message: {
            role: 'user',
            parts: [{ text: messageText }],
            metadata: metadata,
          },
        },
        id: 1,
      });

      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: '/a2a/json-rpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
        timeout: 30000, // 30秒超时
      };

      const displaySender = originalSender ? 
        `${originalSender.name} (via ${proxySender ? proxySender.name : '若兰'})` : 
        (proxySender ? proxySender.name : '若兰');
      console.log(`[CapabilityRouter] 发送命令到 ${agent.name}: ${command} (发送者: ${displaySender})`);
      
      // 🔔 通知飞书群：命令发送
      this.notifyA2AInteraction(
        proxySender?.name || '若兰',
        agent.name,
        '📤 发送命令',
        `${command}\n参数: ${JSON.stringify(payload)}`
      );

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            if (result.error) {
              // 🔔 通知飞书群：命令失败
              this.notifyA2AInteraction(
                agent.name,
                proxySender?.name || '若兰',
                '❌ 执行失败',
                result.error.message || '命令执行失败'
              );
              reject(new Error(result.error.message || '命令执行失败'));
            } else {
              // 🔔 通知飞书群：命令成功
              const resultText = result.result?.message?.parts?.[0]?.text || JSON.stringify(result.result);
              this.notifyA2AInteraction(
                agent.name,
                proxySender?.name || '若兰',
                '✅ 执行成功',
                resultText.substring(0, 200)
              );
              resolve(result.result || result);
            }
          } catch (e) {
            reject(new Error('解析响应失败: ' + e.message));
          }
        });
      });

      req.on('error', (e) => {
        reject(new Error('请求失败: ' + e.message));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * 向指定 Agent 发送消息（消息模式）
   * 接收方会像处理普通聊天消息一样处理
   * @param {Object} agent - 目标 Agent
   * @param {string} messageText - 消息内容
   * @param {Object} originalSender - 原始发送者（用户）信息
   * @param {Object} proxySender - 代理发送者（若兰）信息
   * @returns {Promise<Object>}
   */
  async sendMessageToAgent(agent, messageText, originalSender = null, proxySender = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(agent.url || `http://${agent.host}:${agent.port}`);
      
      // 构建 sender 信息（使用原始发送者）
      const senderInfo = originalSender || proxySender || {
        name: '若兰',
        url: process.env.A2A_URL || 'http://localhost:3100',
      };
      
      // 构建元数据
      const metadata = {
        routed: true,
        proxy: proxySender ? proxySender.name : '若兰',
      };
      
      // 如果有原始发送者，添加到元数据
      if (originalSender) {
        metadata.original_sender = originalSender;
        metadata.routed_via = proxySender ? proxySender.name : '若兰';
      }
      
      const requestBody = JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',  // 使用 message/send 而不是 tasks/send
        params: {
          message: {
            parts: [{ text: messageText }],
            metadata: metadata,  // 添加路由元数据
          },
          sender: senderInfo,
        },
        id: 1,
      });

      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: '/a2a/json-rpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
        timeout: 30000, // 30秒超时
      };

      const displaySender = originalSender ? 
        `${originalSender.name} (via ${proxySender ? proxySender.name : '若兰'})` : 
        (proxySender ? proxySender.name : '若兰');
      console.log(`[CapabilityRouter] 发送消息到 ${agent.name}: "${messageText.substring(0, 30)}..." (发送者: ${displaySender})`);

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            if (result.error) {
              reject(new Error(result.error.message || '消息发送失败'));
            } else {
              // 返回接收方的回复
              resolve({
                success: true,
                executed_by: agent.name,
                response: result.result || result,
              });
            }
          } catch (e) {
            reject(new Error('解析响应失败: ' + e.message));
          }
        });
      });

      req.on('error', (e) => {
        reject(new Error('请求失败: ' + e.message));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * 执行带能力发现的路由
   * 如果没有指定 target，自动查找有能力的 Agent
   * @param {Object} request - 命令/消息请求
   * @param {Object} originalSender - 原始发送者（用户）信息
   * @param {string} mode - 路由模式: 'command' | 'message'
   * @returns {Promise<Object>}
   */
  async routeByCapability(request, originalSender = null, mode = 'command') {
    const { command, message, target, capability } = request;
    
    // 代理发送者信息（若兰）
    const proxySender = {
      name: '若兰',
      url: process.env.A2A_URL || 'http://localhost:3100',
    };

    // 1. 如果指定了具体 target，直接转发
    if (target && target !== 'auto') {
      console.log(`[CapabilityRouter] 使用指定目标: ${target} (模式: ${mode})`);
      const agents = await this.fetchOnlineAgents();
      const agent = agents.find(a => a.name === target);
      if (!agent) {
        throw new Error(`目标 Agent "${target}" 不在线`);
      }
      
      if (mode === 'message') {
        // 消息模式：发送消息给 Agent
        return await this.sendMessageToAgent(agent, message, originalSender, proxySender);
      } else {
        // 命令模式：发送命令给 Agent
        return await this.sendCommandToAgent(agent, command.type, command.parameters, originalSender, proxySender);
      }
    }

    // 2. 需要能力发现
    if (!capability) {
      throw new Error('未指定目标 Agent 且未提供 capability');
    }

    console.log(`[CapabilityRouter] 自动发现具有 "${capability}" 能力的 Agent (模式: ${mode})`);

    // 3. 查找有能力的 Agent
    const capableAgents = await this.findCapableAgents(capability);
    
    if (capableAgents.length === 0) {
      throw new Error(`没有找到具有 "${capability}" 能力的在线 Agent`);
    }

    // 4. 按响应速度排序（简化版：按注册表顺序）
    const candidates = capableAgents;

    // 5. 依次尝试执行
    for (const agent of candidates) {
      try {
        // 检查 Agent 健康状态
        const healthy = await this.checkAgentHealth(agent);
        if (!healthy) {
          console.log(`[CapabilityRouter] ${agent.name} 健康检查失败，跳过`);
          continue;
        }

        let result;
        if (mode === 'message') {
          // 消息模式
          result = await this.sendMessageToAgent(agent, message, originalSender, proxySender);
          console.log(`[CapabilityRouter] 消息通过 ${agent.name} 成功处理`);
        } else {
          // 命令模式
          result = await this.sendCommandToAgent(
            agent, 
            command.type, 
            command.parameters,
            originalSender,
            proxySender
          );
          console.log(`[CapabilityRouter] 命令通过 ${agent.name} 成功执行`);
        }
        
        return {
          success: true,
          executed_by: agent.name,
          result: result,
        };
      } catch (error) {
        console.error(`[CapabilityRouter] ${agent.name} 处理失败:`, error.message);
        // 继续尝试下一个
      }
    }

    throw new Error('所有候选 Agent 都处理失败');
  }

  /**
   * 更新注册表中的能力声明
   * @param {string} agentName - Agent 名称
   * @param {Object} capabilities - 能力声明对象
   * @returns {Promise<boolean>}
   */
  async updateCapabilities(agentName, capabilities) {
    return new Promise((resolve) => {
      const data = JSON.stringify({
        name: agentName,
        capabilities: capabilities,
      });

      const options = {
        hostname: this.registryHost,
        port: this.registryPort,
        path: '/update',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 5000,
      };

      const req = http.request(options, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * 获取路由统计信息
   */
  getStats() {
    return {
      cachedAgents: this.agentCache.size,
      cacheAge: Date.now() - this.cacheTimestamp,
      registry: `${this.registryHost}:${this.registryPort}`,
    };
  }

  /**
   * 通知飞书群 A2A 交互
   */
  async notifyA2AInteraction(from, to, action, detail) {
    try {
      const { spawn } = require('child_process');
      const path = require('path');
      const notifyScript = path.join(__dirname, 'notify_feishu.js');
      
      const title = `🤖 A2A: ${from} → ${to}`;
      const content = `${action}\n${detail}`;
      
      spawn('node', [notifyScript, title, content], {
        detached: true,
        stdio: 'ignore'
      }).unref();
    } catch (error) {
      console.error('[A2A] 飞书通知失败:', error.message);
    }
  }
}

module.exports = { CapabilityRouter };
