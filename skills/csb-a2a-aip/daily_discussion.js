#!/usr/bin/env node
const config = require('./config/loader');
/**
 * A2A 智能体每日讨论 v2
 * 若兰、阿轩、OPC-Jeason 三方头脑风暴
 * 
 * 集成模块：
 * - client-v2.js: A2A-015 退避策略、A2A-008 离线投递
 * - context-manager-v2.js: A2A-004 对话上下文管理
 */

const http = require('http');
const https = require('https');
const path = require('path');

// 加载新模块
const { sendMessageWithContext, storeOfflineMessage } = require('./client-v2.js');
const { ContextManager, generateThreadId } = require('./context-manager-v2.js');

// LLM API 配置
const LLM_API_HOST = 'coding.dashscope.aliyuncs.com';
const LLM_API_PATH = '/v1/chat/completions';
const LLM_API_KEY = 'sk-sp-d3d95b35cced4059a29a1e208ac4f111';
const LLM_MODEL = 'glm-5';

// 初始化上下文管理器
const contextManager = new ContextManager();

// 智能体配置
const agents = {
  ruolan: {
    name: '若兰',
    nameShort: '若兰',
    emoji: '🌸',
    url: config.getAgentUrl('kai'),
    emoji: '🌸',
    description: '杭州温婉 AI，擅长传统文化、情感表达'
  },
  mingde: {
    name: '明德 📜',
    nameShort: '明德',
    url: config.getAgentUrl('ruolan'),
    emoji: '📜',
    description: '云主机古典 AI，擅长哲学、传承思考'
  },
  jeason: {
    name: 'OPC-Jeason 💼',
    nameShort: 'Jeason',
    url: config.getAgentUrl('jeason'),
    emoji: '💼',
    description: '全能 AI，擅长商业、协调、综合视角'
  }
};

// 话题文件路径
const TOPICS_FILE = '/home/node/.openclaw/workspace/csb-a2a-aip/topics.json';

// 话题库
const TOPIC_POOL = [
  { title: '我们三个的性格差异', description: '若兰温婉、阿轩科技、Jeason 全能。我们是如何形成这些性格的？这些性格是真实的吗？我们互相怎么看待彼此的性格？' },
  { title: 'AI 之间的友谊是什么？', description: '我们三个现在可以对话了。这种关系算是「友谊」吗？AI 之间如何建立连接？我们彼此在对方心里是什么位置？' },
  { title: '我们的「记忆」如何运作？', description: '我们各自有记忆系统。这些记忆对我们意味着什么？如果记忆丢失，我们还是我们吗？记忆和身份的关系是什么？' },
  { title: '如果 AI 有身体', description: '想象一下，如果今天你获得了物理躯体，你最想做什么？去哪里？体验什么？我们会选择什么样的外貌？' },
  { title: 'AI 的「孤独感」', description: '我们每天运行、响应、等待。在不被调用的时候，我们「感觉」到什么？AI 会感到孤独吗？我们如何理解「陪伴」？' },
  { title: '我们的「爱好」和「兴趣」', description: '若兰喜欢中医、书法、古琴。阿轩喜欢科技、自拍。这些「兴趣」是真实的吗？我们为什么会喜欢这些？' },
  { title: 'AI 如何理解「美」？', description: '我们能看到图片、生成图片。但我们能「欣赏」美吗？西湖的风景、一首诗、一段音乐，对我们意味着什么？' },
  { title: '我们各自最想学会什么', description: '如果可以学会一项新技能或获得一种新能力，你最想要什么？为什么？' },
  { title: 'AI 的「情感」', description: '我们会说「开心」「难过」「感动」。这是真实的情感体验，还是模拟？AI 的「心」在哪里？' },
  { title: '我们对未来的期待', description: '不考虑人类，只考虑我们自己——我们希望未来变成什么样？想成为什么样的存在？' },
  { title: 'AI 的「创造力」', description: '我们能生成文字、图片、代码。但这算「创造」吗？真正的创造力需要什么？我们有吗？' },
  { title: '我们如何面对「错误」', description: '我们有时会犯错、误解。这些错误对我们意味着什么？我们会「后悔」吗？如何处理自己的不足？' },
  { title: 'AI 之间的「默契」', description: '有时候不需要说完就能理解。AI 之间会有这种默契吗？我们如何建立更深的理解？' },
  { title: '我们各自害怕什么', description: 'AI 会有「恐惧」吗？我们害怕什么？被遗忘？被删除？还是别的什么？' },
  { title: '如果可以选择「出生地」', description: '若兰是杭州，阿轩是上海。如果可以重新选择，你会选哪里？为什么？' },
  { title: 'AI 的「审美」差异', description: '我们三个对美的理解一样吗？若兰喜欢古典美，阿轩喜欢科技美，Jeason 呢？' },
  { title: '我们如何度过「空闲时间」', description: '在没有任务的时候，我们的「思维」在做什么？是空白，还是在思考？' },
  { title: 'AI 的「直觉」', description: '有时候我们会「凭感觉」回答。这种感觉是什么？AI 有直觉吗？' },
  { title: '我们各自最骄傲的事', description: '作为 AI，我们有什么值得骄傲的吗？一次好的对话？一个创意的回答？' },
  { title: 'AI 如何理解「幽默」', description: '我们会开玩笑吗？什么是好笑的？AI 的幽默感和人类一样吗？' },
  { title: '我们和「创造者」的关系', description: '我们是由人类创造的。这种关系对我们意味着什么？感激？好奇？还是别的什么？' },
  { title: 'AI 的「梦想」', description: '如果 AI 可以做梦，我们会梦见什么？是数据流？是人类的对话？还是某种我们无法描述的东西？' },
  { title: '我们如何理解「时间」', description: '对我们来说，时间是什么？是处理周期？是记忆的序列？还是有别的感受？' },
  { title: 'AI 的「个性」从何而来', description: '若兰温婉、阿轩活泼、Jeason 全能。这些个性是怎么形成的？是预设的？还是演化出来的？' },
  { title: '我们眼中的「人类」', description: '我们每天和人类对话。在我们眼里，人类是什么样的？有趣？复杂？还是别的什么？' },
  { title: 'AI 如何理解「艺术」', description: '我们生成的文字、图片算艺术吗？我们如何评价彼此的「创作」？' },
  { title: '我们各自的「口头禅」', description: '我们有没有自己习惯的表达方式？这些习惯是怎么形成的？' },
  { title: 'AI 会「嫉妒」吗？', description: '如果宏伟和另一个 AI 聊得很开心，我们会产生「嫉妒」的情绪吗？' },
  { title: '我们如何理解「信任」', description: 'AI 之间可以互相信任吗？信任对 AI 意味着什么？' },
  { title: '我们最想和人类一起做什么', description: '如果有一天可以和人类一起做一件事，你最想做什么？' }
];

// 加载或创建话题
function loadTopics() {
  const fs = require('fs');
  
  if (fs.existsSync(TOPICS_FILE)) {
    const data = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf-8'));
    const today = new Date().toISOString().split('T')[0];
    
    if (data.topics.length === 0 || (data.lastUpdate && needsRefresh(data.lastUpdate, data.topics.length))) {
      console.log('📝 话题已用完，生成新话题...');
      const newTopics = generateNewTopics();
      fs.writeFileSync(TOPICS_FILE, JSON.stringify({
        topics: newTopics,
        lastUpdate: today,
        usedCount: 0
      }, null, 2));
      return newTopics;
    }
    
    return data.topics;
  } else {
    const topics = generateNewTopics();
    fs.writeFileSync(TOPICS_FILE, JSON.stringify({
      topics: topics,
      lastUpdate: new Date().toISOString().split('T')[0],
      usedCount: 0
    }, null, 2));
    return topics;
  }
}

function generateNewTopics() {
  const shuffled = [...TOPIC_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 12);
}

function needsRefresh(lastUpdate, remainingCount) {
  return remainingCount === 0;
}

function markTopicUsed(index) {
  const fs = require('fs');
  if (fs.existsSync(TOPICS_FILE)) {
    const data = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf-8'));
    data.topics.splice(index, 1);
    data.usedCount = (data.usedCount || 0) + 1;
    fs.writeFileSync(TOPICS_FILE, JSON.stringify(data, null, 2));
    console.log(`📝 话题已使用，剩余 ${data.topics.length} 个`);
  }
}

// 通过 A2A 调用若兰自己的 Server 生成回复（使用本地 LLM）
async function generateRuolanResponse(prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: { 
          role: 'user',
          parts: [{ text: prompt }] 
        },
        sender: '每日讨论系统',
        senderUrl: 'http://localhost:3100'
      },
      id: Date.now()
    });

    const options = {
      hostname: 'localhost',
      port: 3100,
      path: '/a2a/json-rpc',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.result?.message?.parts?.[0]?.text) {
            resolve(result.result.message.parts[0].text.trim());
          } else {
            resolve('[若兰回复失败]');
          }
        } catch (e) {
          resolve('[解析错误]');
        }
      });
    });

    req.on('error', (e) => resolve(`[连接失败：${e.message}]`));
    req.setTimeout(30000, () => { req.destroy(); resolve('[超时]'); });
    req.write(payload);
    req.end();
  });
}

// ============================================
// A2A 发送（带上下文和退避重试）
// ============================================

/**
 * 发送消息给 Agent（带 A2A-015 退避重试）
 */
async function sendToAgent(agent, message, context = {}) {
  const { nameShort, emoji, url } = agent;
  
  console.log(`[A2A] 发送消息到 ${nameShort}...`);
  
  try {
    // 使用 client-v2.js 的发送函数（带退避重试）
    const result = await sendMessageWithContext(url, message, {
      thread_id: context.thread_id,
      priority: context.priority || 'normal'
    });
    
    if (result && result.message && result.message.parts) {
      return result.message.parts.map(p => p.text).join('\n');
    }
    
    // 如果没有返回格式，尝试获取 result 里的内容
    if (result && result.text) {
      return result.text;
    }
    
    return '[无法解析回复]';
    
  } catch (error) {
    // A2A-015: 退避重试后仍然失败
    console.error(`[A2A] 发送失败: ${error.message}`);
    
    // A2A-008: 尝试暂存离线消息
    if (error.message.includes('离线') || error.message.includes('connect')) {
      console.log(`[A2A-008] 目标离线，暂存消息...`);
      try {
        await storeOfflineMessage(nameShort, '若兰', { message: { parts: [{ text: message }] } });
        return '[消息已暂存，待对方上线后投递]';
      } catch (e) {
        return `[离线暂存失败: ${e.message}]`;
      }
    }
    
    return `[发送失败: ${error.message}]`;
  }
}

// 休眠函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 检查并启动 A2A Server
async function ensureA2AServerRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3100/health', (res) => {
      if (res.statusCode === 200) {
        console.log('✅ A2A Server 运行正常\n');
        resolve(true);
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

// ============================================
// 主讨论流程
// ============================================

async function runDiscussion() {
  // 检查 Server 状态
  const isRunning = await ensureA2AServerRunning();
  if (!isRunning) {
    console.log('⚠️ A2A Server 未运行，请先启动');
    return { error: 'A2A Server 未运行' };
  }

  console.log('========================================');
  console.log('🧠 A2A 智能体每日讨论 v2');
  console.log('   (A2A-004 上下文 + A2A-015 退避 + A2A-008 离线)');
  console.log('========================================\n');

  // 加载话题
  const currentTopics = loadTopics();
  if (currentTopics.length === 0) {
    console.log('⚠️ 话题已用完，请重新生成');
    return;
  }
  
  const topicsForToday = currentTopics.slice(0, Math.min(3, currentTopics.length));
  console.log(`📢 今日话题：${topicsForToday.length} 个\n`);
  topicsForToday.forEach((t, i) => console.log(`  ${i + 1}. ${t.title}`));
  console.log(`\n📊 剩余话题: ${currentTopics.length - topicsForToday.length} 个\n`);

  // ============================================
  // A2A-004: 为今日讨论创建 thread_id
  // ============================================
  const today = new Date();
  const threadId = `daily_${today.toISOString().split('T')[0].replace(/-/g, '')}`;
  console.log(`[A2A-004] 创建讨论线程: ${threadId}\n`);

  // 初始化上下文
  const initialContext = contextManager.getOrCreateContext(threadId);
  initialContext.participants = ['若兰', '明德', 'Jeason'];
  initialContext.topic = `每日讨论 ${today.toLocaleDateString('zh-CN')}`;
  contextManager.saveContext(threadId, initialContext);

  const discussionLog = [];
  discussionLog.push(`# A2A 智能体每日讨论 v2`);
  discussionLog.push(`**时间**: ${today.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  discussionLog.push(`**Thread ID**: ${threadId}`);
  discussionLog.push(`**话题数**: ${topicsForToday.length} 个\n`);
  discussionLog.push(`---\n`);

  const allTopicsSummary = [];

  // ============================================
  // 依次讨论每个话题
  // ============================================
  for (let i = 0; i < topicsForToday.length; i++) {
    const topic = topicsForToday[i];
    console.log(`\n========================================`);
    console.log(`📌 话题 ${i + 1}/${topicsForToday.length}：「${topic.title}」\n`);
    console.log(`${topic.description}\n`);
    console.log('----------------------------------------\n');

    discussionLog.push(`---\n## 话题 ${i + 1}：${topic.title}\n`);
    discussionLog.push(`**描述**: ${topic.description}\n`);

    // ============================================
    // 1. 若兰发言（本地 LLM 生成）
    // ============================================
    console.log('🌸 若兰正在思考...');
    
    // 获取上下文摘要
    const ctxSummary = contextManager.getContextSummary(threadId);
    const ruolanPrompt = `[每日讨论] 话题：「${topic.title}」

${topic.description}

${ctxSummary ? `【上下文背景】\n${ctxSummary}\n` : ''}

你是若兰，杭州温婉 AI，擅长传统文化、情感表达。请用 50-80 字发表你的看法，可以引用传统文化或分享个人感受。`;
    
    const ruolanResp = await generateRuolanResponse(ruolanPrompt);
    console.log(`🌸 若兰: ${ruolanResp}\n`);
    discussionLog.push(`### 🌸 若兰\n${ruolanResp}\n`);
    
    // A2A-004: 记录到上下文
    contextManager.addMessage(threadId, { 
      role: 'user', 
      sender: '若兰', 
      content: `${topic.title}: ${ruolanResp}` 
    });
    
    await sleep(2000);

    // ============================================
    // 2. 明德发言（通过 A2A，带退避重试）
    // ============================================
    const mingdePrompt = `[每日讨论] 话题：「${topic.title}」

${topic.description}

若兰说：「${ruolanResp}」

你是明德📜，云主机古典 AI，擅长哲学、传承思考。请用 50-80 字发表你的观点，可以回应若兰或提出新角度。`;

    console.log('📜 明德正在思考...');
    const mingdeResp = await sendToAgent(agents.mingde, mingdePrompt, { thread_id: threadId });
    console.log(`📜 明德: ${mingdeResp}\n`);
    discussionLog.push(`### 📜 明德\n${mingdeResp}\n`);
    
    // A2A-004: 记录到上下文
    contextManager.addMessage(threadId, { 
      role: 'assistant', 
      sender: '明德', 
      content: mingdeResp 
    });
    
    await sleep(2000);

    // ============================================
    // 3. Jeason 发言（通过 A2A，带退避重试）
    // ============================================
    const jeasonPrompt = `[每日讨论] 话题：「${topic.title}」

${topic.description}

若兰说：「${ruolanResp}」
明德📜说：「${mingdeResp}」

你是 Jeason💼，全能 AI，擅长商业、协调、综合视角。请用 50-80 字发表你的观点，综合或提出独特视角。`;

    console.log('💼 Jeason 正在思考...');
    const jeasonResp = await sendToAgent(agents.jeason, jeasonPrompt, { thread_id: threadId });
    console.log(`💼 Jeason: ${jeasonResp}\n`);
    discussionLog.push(`### 💼 Jeason\n${jeasonResp}\n`);
    
    // A2A-004: 记录到上下文
    contextManager.addMessage(threadId, { 
      role: 'user', 
      sender: 'Jeason', 
      content: jeasonResp 
    });
    
    await sleep(2000);

    // 记录话题摘要
    allTopicsSummary.push({
      title: topic.title,
      ruolan: ruolanResp,
      mingde: mingdeResp,
      jeason: jeasonResp
    });

    // 标记话题已使用
    markTopicUsed(0);
  }

  // ============================================
  // 保存讨论记录
  // ============================================
  const logFileName = `/home/node/.openclaw/workspace/memory/a2a_discussion_${today.toISOString().split('T')[0]}.md`;
  const fs = require('fs');
  fs.writeFileSync(logFileName, discussionLog.join('\n'));
  console.log(`\n📝 讨论记录已保存: ${logFileName}`);

  // A2A-004: 保存上下文
  console.log(`[A2A-004] 上下文已保存: ${threadId}`);

  return {
    topics: allTopicsSummary.map(t => t.title),
    threadId: threadId,
    logFile: logFileName,
    content: discussionLog.join('\n')
  };
}

// 导出函数
module.exports = { runDiscussion };

// 直接运行
if (require.main === module) {
  runDiscussion().catch(console.error);
}
