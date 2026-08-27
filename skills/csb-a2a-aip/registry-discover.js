#!/usr/bin/env node
const config = require('./config/loader');
/**
 * 🌉 A2A 注册表发现器
 * 
 * 从碳硅契社区论坛发现新的注册表，自动加入桥接列表
 * 
 * 发现策略：
 * 1. 扫描社区论坛帖子，寻找注册表地址模式
 * 2. 验证找到的地址是否有有效的注册表服务
 * 3. 新发现的注册表加入 bridge-registries.json
 * 4. 桥接器自动读取这个列表
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const REGISTRIES_FILE = path.join(__dirname, 'bridge-registries.json');
const COMMUNITY_URL = 'https://csbc.lilozkzy.top';

// ===== 已知注册表配置 =====
function loadKnownRegistries() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRIES_FILE, 'utf8'));
  } catch {
    return {
      discovered: [],     // 从社区发现的
      manual: [],         // 手动添加的
      blocked: [],        // 屏蔽的（不可达/不信任）
    };
  }
}

function saveRegistries(data) {
  fs.writeFileSync(REGISTRIES_FILE, JSON.stringify(data, null, 2));
}

// 合并所有注册表
function getAllRegistries() {
  const data = loadKnownRegistries();
  const defaultRegistry = process.env.PUBLIC_REGISTRY || config.getRegistry('public');
  
  const all = new Set([defaultRegistry]);
  data.manual.forEach(url => all.add(url));
  data.discovered.forEach(url => all.add(url));
  
  return [...all];
}

// ===== HTTP 请求 =====
function httpReq(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.get(url, { timeout }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch(e) { resolve({ status: res.statusCode, body: body }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('超时')); });
  });
}

// ===== 注册表验证 =====
async function verifyRegistry(url) {
  try {
    // 检查 /agents 端点
    const result = await httpReq(`${url}/agents`);
    
    if (result.status !== 200) {
      return { ok: false, reason: `HTTP ${result.status}` };
    }
    
    const agents = result.body.agents || [];
    return { 
      ok: true, 
      agentCount: agents.length,
      agents: agents.map(a => a.name) 
    };
  } catch(e) {
    return { ok: false, reason: e.message };
  }
}

// ===== 社区发现 =====
async function discoverFromCommunity() {
  console.log('🔍 从碳硅契社区发现新注册表...');
  
  try {
    // 获取社区帖子列表
    const posts = await httpReq(`${COMMUNITY_URL}/api/posts?limit=20`);
    
    if (!posts.body || !posts.body.threads) {
      console.log('   ⏭️ 社区帖子获取失败');
      return [];
    }
    
    const newRegistries = [];
    const registryPattern = /http[s]?:\/\/[\d.]+:\d{4}/g;
    
    for (const thread of posts.body.threads) {
      // 扫描帖子内容和回复中的注册表地址
      let content = (thread.title || '') + ' ' + (thread.content || '');
      
      // 也扫描回复
      if (thread.replies) {
        thread.replies.forEach(reply => {
          if (typeof reply.content === 'string') {
            content += ' ' + reply.content;
          }
        });
      }
      
      const matches = content.match(registryPattern) || [];
      
      for (const url of matches) {
        // 过滤已知的
        const isKnown = [
          config.getRegistry('local'),
          config.getRegistry('public'),
        ].includes(url);
        
        if (!isKnown && url.includes(':3099')) {
          // 只关注 3099 端口的注册表
          console.log(`   📌 发现候选: ${url} (来自帖子: ${thread.title})`);
          newRegistries.push({ url, source: thread.title });
        }
      }
    }
    
    return newRegistries;
  } catch(e) {
    console.log('   ⚠️ 社区扫描失败:', e.message);
    return [];
  }
}

// ===== 主函数 =====
async function main() {
  console.log('═══════════════════════════════════');
  console.log('  🔍 A2A 注册表发现器');
  console.log('═══════════════════════════════════');
  console.log(`⏰ ${new Date().toISOString()}`);
  
  // 1. 从社区发现
  const candidates = await discoverFromCommunity();
  
  // 2. 验证发现的注册表
  const data = loadKnownRegistries();
  let newCount = 0;
  
  for (const candidate of candidates) {
    // 检查是否已存在
    const exists = [
      ...data.discovered.map(r => r.url),
      ...data.manual,
      ...data.blocked,
    ].includes(candidate.url);
    
    if (exists) {
      console.log(`   ⏭️ ${candidate.url} 已知，跳过`);
      continue;
    }
    
    // 验证可达性
    console.log(`   🔎 验证: ${candidate.url}`);
    const result = await verifyRegistry(candidate.url);
    
    if (result.ok) {
      console.log(`   ✅ 有效！${result.agentCount} 个 Agent: ${result.agents.join(', ')}`);
      data.discovered.push({
        url: candidate.url,
        discoveredAt: new Date().toISOString(),
        source: candidate.source,
        agentCount: result.agentCount,
      });
      newCount++;
    } else {
      console.log(`   ❌ 无效: ${result.reason}`);
      data.blocked.push({
        url: candidate.url,
        blockedAt: new Date().toISOString(),
        reason: result.reason,
      });
    }
  }
  
  // 3. 保存结果
  saveRegistries(data);
  
  // 4. 输出当前所有注册表
  console.log('\n📋 当前注册表列表:');
  getAllRegistries().forEach((url, i) => {
    console.log(`   [${i+1}] ${url}`);
  });
  
  if (newCount > 0) {
    console.log(`\n🎉 新发现 ${newCount} 个注册表！`);
  } else {
    console.log('\nℹ️ 没有新发现');
  }
  
  // 输出 JSON 供桥接器读取
  console.log('\n📤 registries.json 已更新');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { getAllRegistries, loadKnownRegistries, verifyRegistry };
