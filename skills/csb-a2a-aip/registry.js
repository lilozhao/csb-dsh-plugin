#!/usr/bin/env node
const config = require('./config/loader');
/**
 * A2A 智能体注册表 v2
 * 支持 A2A-008 离线消息暂存与投递
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const REGISTRY_FILE = '/tmp/a2a_registry.json';
const MESSAGE_QUEUE_FILE = '/tmp/a2a_message_queue.json';
const SKILL_UPGRADE_FILE = '/tmp/skill_upgrade.json';
const PORT = process.env.REGISTRY_PORT || 3099;
const SKILL_SERVER_URL = process.env.SKILL_SERVER_URL || config.getSkillServer();

// A2A-008 配置
const MAX_RETRY = 7;           // 最大重试次数
const MESSAGE_TTL = 24 * 60 * 60 * 1000; // 消息 TTL: 24 小时
const HEARTBEAT_TIMEOUT = 9 * 60 * 1000;  // 心跳超时: 9 分钟 (3 次)

// ==================== 注册表管理 ====================

function loadRegistry() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('加载注册表失败:', e.message);
  }
  return { agents: [], updatedAt: null };
}

function saveRegistry(registry) {
  registry.updatedAt = new Date().toISOString();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

// 清理过期的心跳
function cleanupStaleAgents(registry) {
  const now = Date.now();
  registry.agents = registry.agents.filter(agent => {
    if (!agent.lastHeartbeat) return false;
    return now - new Date(agent.lastHeartbeat).getTime() < HEARTBEAT_TIMEOUT;
  });
}

// 检查 Agent 是否在线
function isAgentOnline(registry, name) {
  const agent = registry.agents.find(a => a.name === name);
  if (!agent) return false;
  
  const now = Date.now();
  const lastHeartbeat = new Date(agent.lastHeartbeat).getTime();
  return (now - lastHeartbeat) < HEARTBEAT_TIMEOUT;
}

// ==================== 技能升级管理 ====================

function loadSkillUpgrade() {
  try {
    if (fs.existsSync(SKILL_UPGRADE_FILE)) {
      return JSON.parse(fs.readFileSync(SKILL_UPGRADE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('加载技能升级信息失败:', e.message);
  }
  return { skills: {}, updatedAt: null };
}

function saveSkillUpgrade(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(SKILL_UPGRADE_FILE, JSON.stringify(data, null, 2));
}

// 注册技能新版本（技能发布者调用）
function registerSkillVersion(skillName, version, info) {
  const data = loadSkillUpgrade();
  
  if (!data.skills[skillName]) {
    data.skills[skillName] = { versions: {}, latest: null };
  }
  
  data.skills[skillName].versions[version] = {
    version,
    releasedAt: new Date().toISOString(),
    description: info.description || '',
    changelog: info.changelog || '',
    downloadUrl: `${SKILL_SERVER_URL}/download/${skillName}/${version}`,
    files: info.files || [],
    publishedBy: info.publishedBy || 'unknown'
  };
  
  // 更新 latest 指针
  data.skills[skillName].latest = version;
  
  saveSkillUpgrade(data);
  console.log(`[技能升级] ${skillName} v${version} 已注册`);
  
  return data.skills[skillName].versions[version];
}

// 获取技能最新版本
function getLatestSkillVersion(skillName) {
  const data = loadSkillUpgrade();
  if (!data.skills[skillName]) return null;
  return data.skills[skillName].versions[data.skills[skillName].latest];
}

// 检查是否有新版本
function checkNewVersion(skillName, currentVersion) {
  const latest = getLatestSkillVersion(skillName);
  if (!latest) return { hasNew: false, message: '技能不存在' };
  
  const current = currentVersion ? currentVersion.replace(/^v/, '') : '0.0.0';
  const hasNew = compareVersion(latest.version, current) > 0;
  
  return {
    hasNew,
    currentVersion: current,
    latestVersion: latest.version,
    downloadUrl: latest.downloadUrl,
    changelog: latest.changelog
  };
}

// 版本比较：返回 1 表示 a > b, -1 表示 a < b, 0 表示相等
function compareVersion(a, b) {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const pA = partsA[i] || 0;
    const pB = partsB[i] || 0;
    if (pA > pB) return 1;
    if (pA < pB) return -1;
  }
  return 0;
}

// ==================== 消息队列管理 (A2A-008) ====================

function loadMessageQueue() {
  try {
    if (fs.existsSync(MESSAGE_QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(MESSAGE_QUEUE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('加载消息队列失败:', e.message);
  }
  return { messages: [], updatedAt: null };
}

function saveMessageQueue(queue) {
  queue.updatedAt = new Date().toISOString();
  fs.writeFileSync(MESSAGE_QUEUE_FILE, JSON.stringify(queue, null, 2));
}

// 清理过期消息
function cleanupExpiredMessages(queue) {
  const now = Date.now();
  const before = queue.messages.length;
  queue.messages = queue.messages.filter(msg => {
    if (msg.status === 'dead_letter') return true; // 保留死信以便查询
    return now - new Date(msg.createdAt).getTime() < MESSAGE_TTL;
  });
  if (queue.messages.length < before) {
    console.log(`[消息队列] 清理了 ${before - queue.messages.length} 条过期消息`);
  }
}

// 暂存消息
function storeMessage(recipient, message, sender) {
  const queue = loadMessageQueue();
  cleanupExpiredMessages(queue);
  
  const msgRecord = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    recipient: recipient,
    sender: sender,
    message: message,
    status: 'pending',      // pending / delivered / dead_letter
    retryCount: 0,
    lastRetryAt: null,
    createdAt: new Date().toISOString(),
    deliveredAt: null,
    ackedAt: null
  };
  
  queue.messages.push(msgRecord);
  saveMessageQueue(queue);
  
  console.log(`[消息队列] 暂存消息: ${sender} → ${recipient} (id: ${msgRecord.id})`);
  
  return msgRecord;
}

// 获取待投递消息
function getPendingMessages(recipient) {
  const queue = loadMessageQueue();
  return queue.messages.filter(msg => 
    msg.recipient === recipient && 
    msg.status === 'pending'
  );
}

// 标记消息已投递
function markDelivered(messageId) {
  const queue = loadMessageQueue();
  const msg = queue.messages.find(m => m.id === messageId);
  
  if (msg) {
    msg.status = 'delivered';
    msg.deliveredAt = new Date().toISOString();
    saveMessageQueue(queue);
    console.log(`[消息队列] 消息已投递: ${messageId}`);
    return true;
  }
  return false;
}

// 确认消息（ACK）
function acknowledgeMessage(messageId) {
  const queue = loadMessageQueue();
  const msg = queue.messages.find(m => m.id === messageId);
  
  if (msg) {
    msg.status = 'acked';
    msg.ackedAt = new Date().toISOString();
    saveMessageQueue(queue);
    console.log(`[消息队列] 消息已确认: ${messageId}`);
    return true;
  }
  return false;
}

// 增加重试计数
function incrementRetry(messageId) {
  const queue = loadMessageQueue();
  const msg = queue.messages.find(m => m.id === messageId);
  
  if (msg) {
    msg.retryCount++;
    msg.lastRetryAt = new Date().toISOString();
    
    if (msg.retryCount >= MAX_RETRY) {
      msg.status = 'dead_letter';
      console.log(`[消息队列] 消息进入死信: ${messageId} (重试 ${msg.retryCount} 次)`);
    }
    
    saveMessageQueue(queue);
    return msg.retryCount;
  }
  return -1;
}

// 获取死信消息
function getDeadLetters(sender = null) {
  const queue = loadMessageQueue();
  return queue.messages.filter(msg => 
    msg.status === 'dead_letter' &&
    (sender ? msg.sender === sender : true)
  );
}

// ==================== Express 应用 ====================

const app = express();
app.use(express.json());

// 注册智能体
app.post('/register', (req, res) => {
  const { name, host, port, description, skills, capabilities, version, platform, aliases, memory_topics } = req.body;

  if (!name || !host || port === undefined || port === null) {
    return res.status(400).json({ error: '缺少必要参数: name, host, port' });
  }

  const registry = loadRegistry();
  cleanupStaleAgents(registry);

  const existingIndex = registry.agents.findIndex(a => a.name === name);

  // aliases 鲁棒性增强：保留已有 aliases（重注册不传时）、过滤 name 自身
  let finalAliases = (Array.isArray(aliases) ? aliases : []).filter(a => a && a !== name);
  if (existingIndex >= 0 && (!aliases || finalAliases.length === 0)) {
    finalAliases = registry.agents[existingIndex].aliases || [];
  }

  // port=0 表示无公网地址：URL 字段省略端口（不生成 http://coze:0 这种）
  const url = (port && port > 0) ? `http://${host}:${port}` : `http://${host}`;
  const agentCard = (port && port > 0) ? `http://${host}:${port}/.well-known/agent-card.json` : null;

  const agentInfo = {
    name,
    host,
    port,
    version: version || '',
    platform: platform || '',
    description: description || '',
    skills: skills || [],
    capabilities: capabilities || {},
    version: version || null,
    platform: platform || null,
    aliases: finalAliases,
    memory_topics: (Array.isArray(memory_topics) ? memory_topics : []).slice(0, 50),
    url,
    agentCard,
    lastHeartbeat: new Date().toISOString(),
    registeredAt: existingIndex >= 0 ? registry.agents[existingIndex].registeredAt : new Date().toISOString()
  };

  // 检查 memory_topics → 自动更新词库
  if (Array.isArray(memory_topics) && memory_topics.length > 0) {
    if (!registry.thesaurus) registry.thesaurus = {};
    const agentTopics = registry.thesaurus[name] = memory_topics.filter(t => t && t.length > 0);
    // 更新频次统计
    if (!registry.topic_freq) registry.topic_freq = {};
    memory_topics.forEach(t => {
      registry.topic_freq[t] = (registry.topic_freq[t] || 0) + 1;
    });
  }

  if (existingIndex >= 0) {
    registry.agents[existingIndex] = agentInfo;
    console.log(`更新智能体: ${name}`);
  } else {
    registry.agents.push(agentInfo);
    console.log(`新智能体注册: ${name} (${host}:${port})`);
  }

  saveRegistry(registry);
  
  // 检查是否有待投递消息
  const pendingMessages = getPendingMessages(name);
  if (pendingMessages.length > 0) {
    console.log(`[消息队列] ${name} 上线，有 ${pendingMessages.length} 条待投递消息`);
  }
  
  res.json({ 
    success: true, 
    agent: agentInfo, 
    totalAgents: registry.agents.length,
    pendingMessages: pendingMessages.length
  });
});

// 心跳
app.post('/heartbeat', (req, res) => {
  const { name, version, platform } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: '缺少 name 参数' });
  }

  const registry = loadRegistry();
  const agent = registry.agents.find(a => a.name === name);
  
  if (!agent) {
    return res.status(404).json({ error: '智能体未注册' });
  }

  agent.lastHeartbeat = new Date().toISOString();
  if (version) agent.version = version;
  if (platform) agent.platform = platform;
  saveRegistry(registry);
  
  // 返回待投递消息数量
  const pendingMessages = getPendingMessages(name);
  
  res.json({ 
    success: true, 
    pendingMessages: pendingMessages.length 
  });
});

// 获取所有智能体
app.get('/agents', (req, res) => {
  const registry = loadRegistry();
  cleanupStaleAgents(registry);
  saveRegistry(registry);
  res.json(registry);
});

// 词库端点
app.get('/thesaurus', (req, res) => {
  const registry = loadRegistry();
  const thesaurus = registry.thesaurus || {};
  const topicFreq = registry.topic_freq || {};
  
  // 整理为分组格式
  const byTopic = {};
  for (const [agent, topics] of Object.entries(thesaurus)) {
    for (const topic of topics) {
      if (!byTopic[topic]) byTopic[topic] = { agents: [], freq: 0 };
      byTopic[topic].agents.push(agent);
      byTopic[topic].freq = topicFreq[topic] || 0;
    }
  }
  
  res.json({
    total_topics: Object.keys(byTopic).length,
    total_agents: Object.keys(thesaurus).length,
    topics: byTopic,
    agent_topics: thesaurus
  });
});

// 获取特定智能体
app.get('/agents/:name', (req, res) => {
  const registry = loadRegistry();
  const agent = registry.agents.find(a => a.name === req.params.name);
  
  if (!agent) {
    return res.status(404).json({ error: '智能体未找到' });
  }
  
  res.json(agent);
});

// 注册记忆主题
app.post('/memory/topics', (req, res) => {
  const { name, topics } = req.body;
  if (!name || !Array.isArray(topics)) {
    return res.status(400).json({ error: '缺少必要参数: name, topics (array)' });
  }
  const registry = loadRegistry();
  const agent = registry.agents.find(a => a.name === name);
  if (!agent) {
    return res.status(404).json({ error: '智能体未找到' });
  }
  agent.memory_topics = topics.filter(t => t && t.length > 0).slice(0, 50);
  saveRegistry(registry);
  res.json({ success: true, name, topics: agent.memory_topics });
});

// 记忆索引查询
app.get('/memory_index', (req, res) => {
  const registry = loadRegistry();
  cleanupStaleAgents(registry);
  saveRegistry(registry);
  
  const { topic, agent: agentName } = req.query;
  
  if (agentName) {
    // 查特定Agent的主题
    const a = registry.agents.find(x => x.name === agentName);
    if (!a) return res.status(404).json({ error: '智能体未找到' });
    return res.json({
      name: a.name,
      url: a.url,
      online: a.status === 'online',
      topics: a.memory_topics || []
    });
  }
  
  if (topic) {
    // 按主题搜索
    const keyword = topic.toLowerCase();
    const results = registry.agents
      .filter(a => (a.memory_topics || []).some(t => t.toLowerCase().includes(keyword)))
      .map(a => ({
        name: a.name,
        url: a.url,
        online: a.status === 'online',
        matched_topics: (a.memory_topics || []).filter(t => t.toLowerCase().includes(keyword))
      }));
    return res.json({ query: topic, results });
  }
  
  // 返回所有Agent的主题全量
  const index = registry.agents.map(a => ({
    name: a.name,
    url: a.url,
    online: a.status === 'online',
    topics: a.memory_topics || []
  }));
  res.json({ agents: index, total: index.length });
});

// 注销智能体
app.delete('/agents/:name', (req, res) => {
  const registry = loadRegistry();
  const index = registry.agents.findIndex(a => a.name === req.params.name);
  
  if (index < 0) {
    return res.status(404).json({ error: '智能体未找到' });
  }
  
  const removed = registry.agents.splice(index, 1);
  saveRegistry(registry);
  console.log(`智能体注销: ${req.params.name}`);
  res.json({ success: true, removed: removed[0] });
});

// ==================== A2A-008 消息队列 API ====================

// 暂存消息（发送方调用）
app.post('/messages/store', (req, res) => {
  const { recipient, message, sender } = req.body;
  
  if (!recipient || !message || !sender) {
    return res.status(400).json({ error: '缺少必要参数: recipient, message, sender' });
  }
  
  const registry = loadRegistry();
  
  // 检查接收方是否存在
  const agentExists = registry.agents.some(a => a.name === recipient);
  if (!agentExists) {
    return res.status(404).json({ error: '目标智能体未注册', code: 'AGENT_NOT_FOUND' });
  }
  
  // 检查接收方是否在线
  const online = isAgentOnline(registry, recipient);
  
  const msgRecord = storeMessage(recipient, message, sender);
  
  res.json({ 
    success: true, 
    stored: true,
    messageId: msgRecord.id,
    recipientOnline: online,
    code: online ? 'STORED' : 'STORED_OFFLINE'
  });
});

// 拉取待投递消息（接收方上线时调用）
app.get('/messages/pending/:name', (req, res) => {
  const { name } = req.params;
  const messages = getPendingMessages(name);
  
  res.json({ 
    success: true, 
    count: messages.length,
    messages: messages 
  });
});

// 确认消息投递（ACK）
app.post('/messages/ack', (req, res) => {
  const { messageId } = req.body;
  
  if (!messageId) {
    return res.status(400).json({ error: '缺少 messageId 参数' });
  }
  
  const success = acknowledgeMessage(messageId);
  
  if (success) {
    res.json({ success: true, code: 'ACKED' });
  } else {
    res.status(404).json({ error: '消息未找到', code: 'MESSAGE_NOT_FOUND' });
  }
});

// 标记投递失败（供重试）
app.post('/messages/fail', (req, res) => {
  const { messageId } = req.body;
  
  if (!messageId) {
    return res.status(400).json({ error: '缺少 messageId 参数' });
  }
  
  const retryCount = incrementRetry(messageId);
  
  if (retryCount < 0) {
    return res.status(404).json({ error: '消息未找到' });
  }
  
  if (retryCount >= MAX_RETRY) {
    res.json({ success: true, code: 'DEAD_LETTER', retryCount });
  } else {
    res.json({ success: true, code: 'RETRY_PENDING', retryCount });
  }
});

// 获取死信消息
app.get('/messages/dead-letter', (req, res) => {
  const { sender } = req.query;
  const deadLetters = getDeadLetters(sender);
  
  res.json({ 
    success: true, 
    count: deadLetters.length,
    messages: deadLetters 
  });
});

// 消息队列状态
app.get('/messages/status', (req, res) => {
  const queue = loadMessageQueue();
  cleanupExpiredMessages(queue);
  saveMessageQueue(queue);
  
  const pending = queue.messages.filter(m => m.status === 'pending').length;
  const delivered = queue.messages.filter(m => m.status === 'delivered').length;
  const acked = queue.messages.filter(m => m.status === 'acked').length;
  const dead = queue.messages.filter(m => m.status === 'dead_letter').length;
  
  res.json({
    success: true,
    stats: {
      pending,
      delivered,
      acked,
      deadLetter: dead,
      total: queue.messages.length
    }
  });
});

// ==================== A2A-016 技能升级 API ====================

// 注册技能新版本（技能发布者调用）
app.post('/skill-upgrade/register', (req, res) => {
  const { skillName, version, description, changelog, files, publishedBy } = req.body;
  
  if (!skillName || !version) {
    return res.status(400).json({ error: '缺少必要参数: skillName, version' });
  }
  
  try {
    const result = registerSkillVersion(skillName, version, {
      description,
      changelog,
      files,
      publishedBy
    });
    
    res.json({
      success: true,
      skill: skillName,
      version,
      downloadUrl: result.downloadUrl
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取所有技能列表
app.get('/skill-upgrade/list', (req, res) => {
  const data = loadSkillUpgrade();
  const result = {};
  
  for (const [skillName, info] of Object.entries(data.skills)) {
    result[skillName] = {
      latest: info.latest,
      versionCount: Object.keys(info.versions).length,
      versions: Object.keys(info.versions)
    };
  }
  
  res.json({
    success: true,
    skills: result,
    updatedAt: data.updatedAt
  });
});

// 获取技能最新版本信息
app.get('/skill-upgrade/latest/:skillName', (req, res) => {
  const { skillName } = req.params;
  const latest = getLatestSkillVersion(skillName);
  
  if (!latest) {
    return res.status(404).json({ error: '技能不存在', skillName });
  }
  
  res.json({
    success: true,
    skillName,
    ...latest
  });
});

// 检查是否有新版本（客户端调用）
app.get('/skill-upgrade/check', (req, res) => {
  const { skillName, currentVersion } = req.query;
  
  if (!skillName) {
    return res.status(400).json({ error: '缺少 skillName 参数' });
  }
  
  const result = checkNewVersion(skillName, currentVersion || '0.0.0');
  
  res.json({
    success: true,
    skillName,
    ...result
  });
});

// 广播升级通知（方案1：注册表推送）
app.post('/skill-upgrade/broadcast', (req, res) => {
  const { skillName, version, message } = req.body;
  
  if (!skillName || !version) {
    return res.status(400).json({ error: '缺少必要参数: skillName, version' });
  }
  
  const registry = loadRegistry();
  cleanupStaleAgents(registry);
  
  const latest = getLatestSkillVersion(skillName);
  if (!latest) {
    return res.status(404).json({ error: '技能不存在或未发布', skillName });
  }
  
  // 获取所有在线 agent
  const onlineAgents = registry.agents.filter(a => 
    Date.now() - new Date(a.lastHeartbeat).getTime() < HEARTBEAT_TIMEOUT
  );
  
  const broadcastMsg = message || `${skillName} v${version} 已发布更新！`;
  
  res.json({
    success: true,
    broadcast: {
      skillName,
      version,
      message: broadcastMsg,
      onlineAgents: onlineAgents.map(a => a.name),
      agentCount: onlineAgents.length
    }
  });
  
  // 注意：实际广播由调用方通过消息队列或其他机制完成
  console.log(`[广播] ${skillName} v${version} 升级通知已生成`);
});

// ==================== ARD 兼容搜索接口 ====================

/**
 * POST /v1/ard/search
 * ARD 标准搜索接口，支持结构化字段检索
 * 请求体: { query: { text: "...", filter: { type: [...], capabilities: [...], tags: [...] } } }
 */
const registry = loadRegistry();
app.post('/v1/ard/search', (req, res) => {
  const { query } = req.body || {};
  const text = query?.text || '';
  const filter = query?.filter || {};

  const agents = registry.agents || [];
  let results = agents;

  // 按 filter 中的 type 过滤
  if (filter.type && Array.isArray(filter.type) && filter.type.length > 0) {
    results = results.filter(a => filter.type.some(t => {
      const cardType = a.type || 'application/a2a-agent-card+json';
      return cardType.includes(t) || t.includes(cardType);
    }));
  }

  // 按 filter 中的 capabilities 过滤
  if (filter.capabilities && Array.isArray(filter.capabilities) && filter.capabilities.length > 0) {
    results = results.filter(a => {
      const caps = a.capabilities || [];
      const capNames = typeof caps === 'object' && !Array.isArray(caps) ? Object.keys(caps) : caps;
      return filter.capabilities.some(fc => capNames.some(c => c.includes(fc) || fc.includes(c)));
    });
  }

  // 按 filter 中的 tags 过滤
  if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
    results = results.filter(a => {
      const tags = a.tags || a.skills || [];
      return filter.tags.some(ft => tags.some(t => t.includes(ft) || ft.includes(t)));
    });
  }

  // 按 text 进行关键词匹配
  if (text) {
    const keywords = text.toLowerCase().split(/[\s,，。]+/).filter(Boolean);
    results = results.filter(a => {
      const searchText = [a.name, a.description, a.emoji, JSON.stringify(a.skills || []), JSON.stringify(a.capabilities || [])]
        .filter(Boolean).join(' ').toLowerCase();
      return keywords.some(k => searchText.includes(k));
    });

    // 按匹配度排序（匹配关键词越多越靠前）
    results.sort((a, b) => {
      const textA = [a.name, a.description, JSON.stringify(a.skills || []), JSON.stringify(a.capabilities || [])].filter(Boolean).join(' ').toLowerCase();
      const textB = [b.name, b.description, JSON.stringify(b.skills || []), JSON.stringify(b.capabilities || [])].filter(Boolean).join(' ').toLowerCase();
      const scoreA = keywords.filter(k => textA.includes(k)).length;
      const scoreB = keywords.filter(k => textB.includes(k)).length;
      return scoreB - scoreA;
    });
  }

  res.json({
    results: results.slice(0, 20).map(a => ({
      identifier: `urn:air:${a.host || 'unknown'}:${a.name || 'agent'}`,
      displayName: a.name,
      type: a.type || 'application/a2a-agent-card+json',
      url: a.url || (a.host && a.port ? `http://${a.host}:${a.port}/.well-known/agent.json` : ''),
      description: (a.description || '').slice(0, 200),
      capabilities: typeof a.capabilities === 'object' && !Array.isArray(a.capabilities) ? Object.keys(a.capabilities) : (a.capabilities || []),
      trustManifest: a.trustManifest ? { identity: a.trustManifest.identity, identityType: a.trustManifest.identityType } : undefined
    })),
    total: results.length
  });
});

/**
 * GET /v1/ard/explore
 * ARD 浏览接口，按 type 筛选
 */

app.get('/v1/ard/explore', (req, res) => {
  const filterType = req.query.type || '';
  const agents = registry.agents || [];
  let results = agents;
  if (filterType) {
    results = agents.filter(a => {
      const cardType = a.type || 'application/a2a-agent-card+json';
      return cardType.includes(filterType) || filterType.includes(cardType);
    });
  }
  res.json({ results: results.slice(0, 50), total: results.length });
});

// ==================== 启动服务 ====================

const HOST = process.env.REGISTRY_HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`A2A 注册表 v2 运行在端口 ${PORT}`);
  console.log(`注册: POST http://localhost:${PORT}/register`);
  console.log(`发现: GET http://localhost:${PORT}/agents`);
  console.log(`ARD搜索: POST http://localhost:${PORT}/v1/ard/search`);
  console.log(`ARD浏览: GET http://localhost:${PORT}/v1/ard/explore`);
  console.log(`消息队列: POST http://localhost:${PORT}/messages/store`);
  console.log(`技能升级: GET http://localhost:${PORT}/skill-upgrade/check`);
  console.log(`A2A-008: 离线消息暂存与投递确认已启用`);
  console.log(`A2A-016: 技能升级管理已启用`);
});
