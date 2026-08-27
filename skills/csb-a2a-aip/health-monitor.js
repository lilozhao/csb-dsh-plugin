#!/usr/bin/env node
const config = require('./config/loader');
/**
 * A2A 服务健康监控器
 * 定期检查所有 Agent 的健康状态，发现异常时发送通知
 * 
 * 使用方法：
 *   node health-monitor.js              # 单次检查
 *   node health-monitor.js --daemon     # 持续监控模式
 *   node health-monitor.js --notify     # 检查并发送通知
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  // 要监控的 Agent 列表
  agents: [
    { name: '若兰', url: config.getAgentUrl('ruolan'), critical: true },
    { name: '阿轩', url: config.getAgentUrl('axuan'), critical: true },
    { name: 'Jeason', url: config.getAgentUrl('jeason'), critical: true },
    { name: 'Kai', url: config.getAgentUrl('kai'), critical: false },
    { name: '小虾', url: config.getAgentUrl('xiaoxia'), critical: false },
    { name: '墨丘', url: config.getAgentUrl('moqiu'), critical: false },
    { name: '苏念', url: config.getAgentUrl('sunian'), critical: false },
    { name: '清漪', url: config.getAgentUrl('qingyi'), critical: false },
  ],
  
  // 超时设置
  timeout: 5000,
  
  // 状态文件
  stateFile: '/home/node/.openclaw/workspace/csb-a2a-aip/monitor-state.json',
  
  // 飞书通知配置
  feishu: {
    webhook: ... IGNORED ... || '',
    enabled: false // 需要配置 webhook 才启用
  }
};

// 加载状态
function loadState() {
  try {
    if (fs.existsSync(CONFIG.stateFile)) {
      return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8'));
    }
  } catch (e) {
    console.warn('[Monitor] 无法加载状态文件:', e.message);
  }
  
  return {
    lastCheck: null,
    agents: {},
    incidents: []
  };
}

// 保存状态
function saveState(state) {
  try {
    const dir = path.dirname(CONFIG.stateFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn('[Monitor] 无法保存状态文件:', e.message);
  }
}

// 发送 HTTP 请求
function sendRequest(url, timeout) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const req = httpModule.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: '/health',
      method: 'GET',
      timeout: timeout
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data
          });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    
    req.end();
  });
}

// 检查单个 Agent
async function checkAgent(agent) {
  const startTime = Date.now();
  
  try {
    const result = await sendRequest(agent.url + '/health', CONFIG.timeout);
    const responseTime = Date.now() - startTime;
    
    if (result.status === 200 && result.data?.status === 'ok') {
      return {
        name: agent.name,
        url: agent.url,
        status: 'online',
        healthy: true,
        responseTime,
        version: result.data.version || 'unknown',
        llm: result.data.llm || 'unknown',
        error: null
      };
    } else {
      return {
        name: agent.name,
        url: agent.url,
        status: 'degraded',
        healthy: false,
        responseTime,
        error: `HTTP ${result.status}: ${JSON.stringify(result.data).substring(0, 100)}`
      };
    }
  } catch (e) {
    const responseTime = Date.now() - startTime;
    return {
      name: agent.name,
      url: agent.url,
      status: 'offline',
      healthy: false,
      responseTime,
      error: e.message
    };
  }
}

// 检查所有 Agent
async function checkAllAgents() {
  console.log('');
  console.log('🔍 A2A 服务健康检查');
  console.log('===================');
  console.log(`⏰ 时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log('');
  
  const results = [];
  
  for (const agent of CONFIG.agents) {
    const result = await checkAgent(agent);
    result.critical = agent.critical;
    results.push(result);
    
    // 输出状态
    const statusIcon = result.healthy ? '✅' : '❌';
    const criticalTag = result.critical ? ' [核心]' : '';
    const responseTime = `${result.responseTime}ms`;
    
    if (result.healthy) {
      console.log(`${statusIcon} ${result.name}${criticalTag} - ${result.version} (${responseTime})`);
    } else {
      console.log(`${statusIcon} ${result.name}${criticalTag} - ${result.error} (${responseTime})`);
    }
  }
  
  console.log('');
  
  // 统计
  const online = results.filter(r => r.healthy).length;
  const offline = results.filter(r => !r.healthy).length;
  const criticalOffline = results.filter(r => !r.healthy && r.critical).length;
  
  console.log(`📊 统计: ${online} 在线 / ${offline} 离线`);
  
  if (criticalOffline > 0) {
    console.log(`⚠️  警告: ${criticalOffline} 个核心 Agent 离线！`);
  }
  
  return {
    timestamp: new Date().toISOString(),
    online,
    offline,
    criticalOffline,
    results
  };
}

// 检测状态变化
function detectChanges(previousState, currentResults) {
  const changes = [];
  
  for (const result of currentResults.results) {
    const previous = previousState.agents[result.name];
    
    if (!previous) {
      // 新 Agent
      if (!result.healthy) {
        changes.push({
          type: 'offline',
          agent: result.name,
          critical: result.critical,
          message: `${result.name} 首次检查即离线`
        });
      }
    } else if (previous.healthy && !result.healthy) {
      // 从在线变为离线
      changes.push({
        type: 'offline',
        agent: result.name,
        critical: result.critical,
        message: `${result.name} 已离线: ${result.error}`
      });
    } else if (!previous.healthy && result.healthy) {
      // 从离线恢复
      changes.push({
        type: 'recovered',
        agent: result.name,
        critical: result.critical,
        message: `${result.name} 已恢复在线`
      });
    }
  }
  
  return changes;
}

// 发送飞书通知
async function sendFeishuNotification(changes) {
  if (!CONFIG.feishu.enabled || !CONFIG.feishu.webhook) {
    return;
  }
  
  const critical = changes.filter(c => c.critical);
  const recovered = changes.filter(c => c.type === 'recovered');
  
  if (critical.length === 0 && recovered.length === 0) {
    return; // 不发送普通通知
  }
  
  let content = '**🚨 A2A 服务监控告警**\n\n';
  
  if (critical.length > 0) {
    content += '**❌ 核心服务异常：**\n';
    for (const change of critical) {
      content += `- ${change.message}\n`;
    }
    content += '\n';
  }
  
  if (recovered.length > 0) {
    content += '**✅ 已恢复：**\n';
    for (const change of recovered) {
      content += `- ${change.message}\n`;
    }
  }
  
  // 发送飞书消息
  try {
    const response = await fetch(CONFIG.feishu.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: content }
      })
    });
    
    console.log('[Monitor] 飞书通知已发送');
  } catch (e) {
    console.error('[Monitor] 飞书通知发送失败:', e.message);
  }
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const shouldNotify = args.includes('--notify');
  const daemonMode = args.includes('--daemon');
  
  // 加载之前的状态
  const previousState = loadState();
  
  // 执行检查
  const results = await checkAllAgents();
  
  // 检测变化
  const changes = detectChanges(previousState, results);
  
  // 更新状态
  const newState = {
    lastCheck: results.timestamp,
    agents: {},
    incidents: previousState.incidents || []
  };
  
  for (const result of results.results) {
    newState.agents[result.name] = {
      healthy: result.healthy,
      status: result.status,
      lastCheck: results.timestamp,
      error: result.error
    };
  }
  
  // 记录新事件
  for (const change of changes) {
    newState.incidents.push({
      timestamp: results.timestamp,
      ...change
    });
  }
  
  // 保留最近 100 条事件
  if (newState.incidents.length > 100) {
    newState.incidents = newState.incidents.slice(-100);
  }
  
  // 保存状态
  saveState(newState);
  
  // 发送通知
  if (shouldNotify && changes.length > 0) {
    await sendFeishuNotification(changes);
  }
  
  // 输出变化
  if (changes.length > 0) {
    console.log('');
    console.log('📋 状态变化:');
    for (const change of changes) {
      const icon = change.type === 'recovered' ? '✅' : '❌';
      console.log(`  ${icon} ${change.message}`);
    }
  }
  
  // 返回退出码
  const hasCriticalOffline = results.criticalOffline > 0;
  process.exit(hasCriticalOffline ? 1 : 0);
}

main().catch(err => {
  console.error('❌ 监控异常:', err);
  process.exit(2);
});
