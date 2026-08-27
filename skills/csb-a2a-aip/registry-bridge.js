#!/usr/bin/env node
/*
 * 🌉 A2A 注册表桥接器 v2
 * 
 * 核心理念：不是把所有 Agent 都同步到两边，
 * 而是让两个注册表的 Agent 互相"知道"对方的存在。
 * 
 * 策略：
 * 1. 可达性优先：只桥接真正能连上的 Agent
 * 2. 智能标记：标注哪些是桥接过来的
 * 3. 增量同步：只同步新增或变化的
 * 4. 心跳续期：已存在的只发心跳，不重复注册
 */

const http = require('http');
const path = require('path');
const https = require('https');
const fs = require('fs');

// ===== 配置 =====
const CONFIG = {
  syncInterval: 5 * 60 * 1000,    // 5 分钟同步
  healthTimeout: 3000,             // 健康检查 3s 超时
  bridgeTag: '🌉bridge',           // 桥接标记
};

// 内网地址段（这些不应该暴露到公网）
const PRIVATE_PREFIXES = [
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
  '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
  '172.26.', '172.27.', '172.28.', '172.29.', '172.30.',
  '172.31.', '10.', '192.168.', '127.', 'localhost',
  '169.254.',  // link-local
];

// 已知不可达的 IP（从上次运行学习到的）
let unreachableHosts = new Set();

function isPrivate(host) {
  if (PRIVATE_PREFIXES.some(p => host.startsWith(p))) return true;
  if (/^[a-f0-9]{12}$/.test(host)) return true;  // Docker 容器 ID
  return false;
}

// ===== HTTP 请求 =====
function httpReq(url, method, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: u.hostname, port: u.port, path: u.pathname,
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('超时')); });
    if (body) req.write(body);
    req.end();
  });
}

// ===== 核心功能 =====

/**
 * 获取注册表 Agent 列表
 */
async function getAgents(registryUrl) {
  const data = await httpReq(`${registryUrl}/agents`);
  return data.agents || [];
}

/**
 * 检查 Agent 是否可达
 */
async function pingAgent(agent) {
  const url = `http://${agent.host}:${agent.port}/health`;
  const start = Date.now();
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: CONFIG.healthTimeout }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        const latency = Date.now() - start;
        const ok = res.statusCode === 200;
        if (!ok) unreachableHosts.add(agent.host);
        resolve({ ok, latency, host: agent.host });
      });
    });
    req.on('error', () => {
      unreachableHosts.add(agent.host);
      resolve({ ok: false, latency: Date.now() - start, host: agent.host });
    });
    req.on('timeout', () => {
      req.destroy();
      unreachableHosts.add(agent.host);
      resolve({ ok: false, latency: CONFIG.healthTimeout, host: agent.host });
    });
  });
}

/**
 * 注册 Agent 到目标注册表
 */
async function register(registryUrl, agent, isBridge = true) {
  const body = JSON.stringify({
    name: agent.name,
    host: agent.host,
    port: agent.port,
    version: agent.version || '',
    platform: agent.platform || '',
    description: isBridge 
      ? `[桥接] ${agent.description || ''}` 
      : agent.description || '',
    skills: agent.skills || [],
    capabilities: {
      ...(agent.capabilities || {}),
      '_bridge': isBridge,
      '_source': registryUrl,
    },
  });
  
  const result = await httpReq(`${registryUrl}/register`, 'POST', body);
  return result;
}

/**
 * 发送心跳
 */
async function heartbeat(registryUrl, agent) {
  const body = JSON.stringify({
    name: agent.name,
    host: agent.host,
    port: agent.port,
  });
  await httpReq(`${registryUrl}/heartbeat`, 'POST', body);
}

/**
 * 智能同步
 * 
 * @param {string} sourceUrl - 源注册表
 * @param {string} targetUrl - 目标注册表
 * @param {string} label - 标签（用于日志）
 * @param {boolean} filterPrivate - 是否过滤内网地址
 */
async function smartSync(sourceUrl, targetUrl, label, filterPrivate = true) {
  console.log(`\n🔄 ${label}: ${sourceUrl} → ${targetUrl}`);
  
  // 1. 获取源和目标的所有 Agent
  const sourceAgents = await getAgents(sourceUrl);
  const targetAgents = await getAgents(targetUrl);
  const targetNames = new Set(targetAgents.map(a => a.name));
  
  console.log(`   源: ${sourceAgents.length} 个, 目标: ${targetAgents.length} 个`);
  
  // 2. 过滤：去掉私有的、已知的不可达地址
  let candidates = sourceAgents;
  if (filterPrivate) {
    candidates = sourceAgents.filter(a => !isPrivate(a.host));
    console.log(`   过滤内网后: ${candidates.length} 个候选`);
  }
  
  // 去掉已知不可达的
  candidates = candidates.filter(a => !unreachableHosts.has(a.host));
  
  if (candidates.length === 0) {
    console.log('   ⏭️ 没有需要同步的');
    return;
  }
  
  // 3. 逐个检查可达性并同步
  let synced = 0, renewed = 0, failed = 0;
  
  for (const agent of candidates) {
    // 先检查可达性
    const ping = await pingAgent(agent);
    
    if (!ping.ok) {
      console.log(`   ❌ ${agent.name} (${agent.host}:${agent.port}) - 不可达 ${ping.latency}ms`);
      failed++;
      continue;
    }
    
    console.log(`   ✅ ${agent.name} - 可达 ${ping.latency}ms`, targetNames.has(agent.name) ? '(已存在)' : '(新)');
    
    if (targetNames.has(agent.name)) {
      // 已存在，发心跳续期
      await heartbeat(targetUrl, agent);
      renewed++;
    } else {
      // 新注册
      await register(targetUrl, agent);
      targetNames.add(agent.name);
      synced++;
    }
    
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log(`   📊 结果: +${synced} 续期 ${renewed} 失败 ${failed}`);
}

/**
 * 双向同步
 */
async function bidirectional(localUrl, publicUrl) {
  console.log('═══════════════════════════════════');
  console.log('  🌉 A2A 注册表桥接 v2');
  console.log('═══════════════════════════════════');
  console.log(`⏰ ${new Date().toISOString()}`);
  console.log(`📉 已知不可达主机: ${unreachableHosts.size} 个`);
  
  // 本地 → 公网（过滤内网，只同步公网可达的）
  await smartSync(localUrl, publicUrl, '本地→公网', true);
  
  // 公网 → 本地（不过滤，公网 IP 本地也可能可达）
  await smartSync(publicUrl, localUrl, '公网→本地', false);
  
  console.log('\n✅ 同步完成');
}

// ===== 主函数 =====

const DISCOVERY_FILE = path.join(__dirname, 'bridge-registries.json');

function loadAllRegistries() {
  const local = process.env.LOCAL_REGISTRY || 'http://172.28.0.4:3099';
  const defaultPublic = process.env.PUBLIC_REGISTRY || 'http://47.121.28.125:3099';
  
  // 从发现器加载额外注册表
  let discovered = [];
  try {
    const data = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'));
    discovered = (data.discovered || []).map(r => r.url);
  } catch(e) {}
  
  const manual = (process.env.EXTRA_REGISTRIES || '').split(',').filter(Boolean);
  
  // 合并：默认 + 手动 + 发现
  const all = new Set([defaultPublic, ...manual, ...discovered]);
  
  return { local, public: [...all] };
}

async function main() {
  const config = loadAllRegistries();
  
  console.log('🌉 A2A 注册表桥接器 v2 启动');
  console.log(`   本地: ${config.local}`);
  console.log(`   公网: ${config.public.length} 个`);
  config.public.forEach((url, i) => console.log(`     [${i+1}] ${url}`));
  
  // 立即执行一次：本地 ↔ 每个公网注册表
  for (const pubUrl of config.public) {
    await bidirectional(config.local, pubUrl);
  }
  
  // 如果是 --once 模式或 cron 触发，运行一次后退出
  if (process.argv.includes('--once') || process.env.CRON_RUN) {
    console.log('\n🏁 单次运行完成，退出');
    return;
  }

  // 定时同步（每次重新加载，支持热更新）
  setInterval(() => {
    const fresh = loadAllRegistries();
    (async () => {
      for (const pubUrl of fresh.public) {
        await bidirectional(fresh.local, pubUrl);
      }
    })().catch(e => console.error('同步异常:', e.message));
  }, CONFIG.syncInterval);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { bidirectional, smartSync, isPrivate };
