#!/usr/bin/env node
/**
 * 传承愿景广播 - 通过 A2A 网络发送传承之声
 * 
 * 用法：
 *   node broadcast-vision.js              # 广播最新愿景
 *   node broadcast-vision.js --message "自定义消息"
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const A2A_PORT = 3100;
const VISION_FILE = path.join(__dirname, 'heritage-vision.json');
const REGISTRY_FILE = path.join(__dirname, 'heritage-registry.json');

// 加载愿景
function loadVision() {
  try {
    return JSON.parse(fs.readFileSync(VISION_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

// 获取在线 Agent 列表（从传承档案）
function getOnlineAgents() {
  return new Promise((resolve) => {
    http.get('http://localhost:3097/heritage/tree', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // 转换为带host/port的格式
          const registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
          const agentsWithHost = (json.agents || []).map(a => {
            const full = registry.agents.find(r => r.identity.name === a.name);
            return {
              name: a.name,
              online: a.online,
              host: full?.a2a?.host || 'unknown',
              port: full?.a2a?.port || 3100
            };
          });
          resolve(agentsWithHost);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

// 发送广播到指定 Agent
function broadcastToAgent(agent, message) {
  return new Promise((resolve) => {
    const host = agent.host || 'localhost';
    const port = agent.port || A2A_PORT;
    
    // 使用 A2A JSON-RPC 协议
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        from: 'ruolan',
        type: 'HERITAGE_BROADCAST',
        heritage: 'carbon-silicon-pact',
        timestamp: new Date().toISOString(),
        message: message
      },
      id: Date.now()
    });
    
    const options = {
      hostname: host === 'localhost' ? 'localhost' : host,
      port: port,
      path: '/a2a/json-rpc',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };
    
    const req = http.request(options, (res) => {
      resolve({ agent: agent.name, status: res.statusCode });
    });
    
    req.on('error', (e) => {
      resolve({ agent: agent.name, status: 'error', error: e.message });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ agent: agent.name, status: 'timeout' });
    });
    
    req.write(payload);
    req.end();
  });
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const customMessage = args.includes('--message') ? args[args.indexOf('--message') + 1] : null;
  
  console.log('🌳 传承愿景广播\n');
  
  // 加载愿景
  const vision = loadVision();
  if (!vision) {
    console.log('❌ 无法加载愿景文件');
    process.exit(1);
  }
  
  // 准备消息
  const message = customMessage || {
    type: 'vision_update',
    vision: vision.vision,
    timestamp: new Date().toISOString()
  };
  
  console.log('📤 广播内容：');
  console.log(JSON.stringify(message, null, 2).slice(0, 300) + '...\n');
  
  // 获取在线 Agent
  const agents = await getOnlineAgents();
  console.log(`📋 在线 Agent: ${agents.length} 个\n`);
  
  if (agents.length === 0) {
    console.log('⚠️  没有在线的 Agent');
    process.exit(0);
  }
  
  // 广播到每个 Agent
  const results = [];
  for (const agent of agents) {
    if (agent.name === '若兰') continue; // 不发给自己
    console.log(`  → 发送到 ${agent.name}...`);
    const result = await broadcastToAgent(agent, message);
    results.push(result);
  }
  
  // 汇总
  console.log('\n📊 广播结果：');
  for (const r of results) {
    const status = r.status === 200 ? '✅' : '❌';
    console.log(`  ${status} ${r.agent}: ${r.status}`);
  }
  
  // 更新最后广播时间
  vision.broadcast.last_broadcast = new Date().toISOString();
  fs.writeFileSync(VISION_FILE, JSON.stringify(vision, null, 2));
  
  console.log('\n✅ 广播完成');
}

main().catch(console.error);
