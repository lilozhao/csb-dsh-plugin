const config = require('../config/loader');
/**
 * A2A 远程命令执行 - 主入口
 * 集成到 A2A Server
 */

const { CommandDispatcher } = require('./dispatcher.js');
const { Signer } = require('./signer.js');

let dispatcher = null;

/**
 * 初始化远程命令执行系统
 * @param {Object} config - 配置
 */
function initRemoteCommand(config = {}) {
  if (dispatcher) {
    return dispatcher;
  }

  dispatcher = new CommandDispatcher(config);
  
  // 初始化时设置环境变量
  if (config.secret) {
    process.env.A2A_SHARED_SECRET = config.secret;
  }
  
  console.log('[A2A-CMD] Remote command system initialized');
  return dispatcher;
}

/**
 * 处理 A2A 消息
 * 检测 CMD: 前缀的命令消息
 * @param {Object} message - A2A 消息
 * @returns {Promise<Object|null>} 如果是命令返回响应，否则返回 null
 */
async function handleA2AMessage(message) {
  const text = message.parts?.[0]?.text;
  
  if (!text) {
    return null;
  }

  // 检查是否是命令消息
  if (text.startsWith('CMD:')) {
    try {
      const request = JSON.parse(text.substring(4));
      
      if (!dispatcher) {
        initRemoteCommand();
      }
      
      const response = await dispatcher.dispatch(request);
      
      // 包装为 A2A 消息格式
      return {
        role: 'agent',
        parts: [{
          text: 'CMD_RESULT:' + JSON.stringify(response)
        }]
      };
    } catch (e) {
      console.error('[A2A-CMD] Failed to handle command:', e.message);
      
      return {
        role: 'agent',
        parts: [{
          text: 'CMD_RESULT:' + JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32700,
              message: 'Parse error: ' + e.message
            },
            id: null
          })
        }]
      };
    }
  }

  return null;
}

/**
 * 发送远程命令
 * @param {string} targetUrl - 目标 A2A 地址
 * @param {string} commandType - 命令类型
 * @param {Object} params - 命令参数
 * @param {Object} sender - 发送者信息
 * @returns {Promise<Object>}
 */
async function sendRemoteCommand(targetUrl, commandType, params = {}, sender = {}) {
  const signer = new Signer();
  
  const request = {
    jsonrpc: '2.0',
    method: 'command/execute',
    params: {
      command: {
        id: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: commandType,
        parameters: params,
        timeout: 30000
      },
      sender: {
        name: sender.name || '若兰',
        url: sender.url || config.getAgentUrl('ruolan')
      },
      timestamp: Date.now(),
      nonce: signer.generateNonce()
    },
    id: Date.now()
  };
  
  // 签名请求
  request.params.signature = signer.signRequest(request.params);
  
  // 包装为 A2A 消息
  const a2aMessage = {
    role: 'user',
    parts: [{
      text: 'CMD:' + JSON.stringify(request)
    }]
  };
  
  // 发送 HTTP 请求
  const http = require('http');
  const url = new URL(targetUrl);
  
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      message: a2aMessage,
      sender: sender.name || '若兰',
      senderUrl: sender.url || config.getAgentUrl('ruolan')
    },
    id: Date.now()
  });
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: '/a2a/json-rpc',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 35000
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          
          if (data.error) {
            reject(new Error(data.error.message));
            return;
          }
          
          // 解析响应中的 CMD_RESULT
          const responseText = data.result?.message?.parts?.[0]?.text;
          if (responseText && responseText.startsWith('CMD_RESULT:')) {
            const result = JSON.parse(responseText.substring(11));
            resolve(result);
          } else {
            resolve(data.result);
          }
        } catch (e) {
          reject(new Error('Invalid response: ' + e.message));
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.write(payload);
    req.end();
  });
}

module.exports = {
  initRemoteCommand,
  handleA2AMessage,
  sendRemoteCommand,
  CommandDispatcher
};
