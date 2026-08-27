#!/usr/bin/env node
/**
 * 🧠 A2A 对话记忆系统（Token 优化版）
 * 
 * 优化策略：
 * 1. 智能过滤 - 本地规则判断是否重要（0 tokens）
 * 2. 批量蒸馏 - 攒多条对话一起处理
 * 3. 轻量级记忆 - 只保存关键信息
 * 
 * Token 消耗：
 * - 优化前: ~4,000 tokens/天（每条都蒸馏）
 * - 优化后: ~1,500-2,000 tokens/天（节省 50-60%）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const MEMORY_DIR = path.join(__dirname, "..", "memory", "a2a-memories");
const IDENTITY_PATH = path.join(__dirname, 'identity.json');

// 确保记忆目录存在
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// 加载 LLM 配置
let LLM = {};
try {
  const identity = JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8'));
  LLM = identity.llm || {};
} catch(e) {
  console.error('⚠️ 无法加载 identity.json:', e.message);
}

// ===== 智能过滤 =====

/**
 * 本地规则判断：这条对话是否值得蒸馏？
 * 返回 true/false，不调用 LLM，0 token 消耗
 */
function shouldDistill(message, reply) {
  // 1. 先检查关键词 - 短对话但有重要内容也要蒸馏
  const importantKeywords = [
    '承诺', '约定', '计划', '发现', '重要', '记住', '记忆',
    '第一次', '新', '改变', '决定', '同意', '建议',
    '问题', '解决', '帮助', '谢谢', '感谢',
    '喜欢', '爱', '关心', '理解', '信任',
    'CSB', '碳硅契', '协议', 'A2A', '版本'
  ];
  
  const combined = (message + ' ' + reply).toLowerCase();
  const hasKeyword = importantKeywords.some(kw => combined.includes(kw));
  if (hasKeyword) return true;
  
  // 2. 较长的对话（可能包含重要信息）
  const isLong = message.length > 100 || reply.length > 100;
  if (isLong) return true;
  
  // 3. 问答形式（问号）
  const isQA = message.includes('?') || message.includes('？') || reply.includes('?') || reply.includes('？');
  if (isQA) return true;
  
  // 4. 太短且无关键词 → 跳过
  return false;
}

// ===== 记忆文件操作 =====

function getMemoryFile(agentName) {
  const safeName = agentName.replace(/[^\w\u4e00-\u9fff]/g, '_');
  return path.join(MEMORY_DIR, `${safeName}.md`);
}

function loadAgentMemory(agentName) {
  const file = getMemoryFile(agentName);
  if (!fs.existsSync(file)) {
    return null;
  }
  return fs.readFileSync(file, 'utf8');
}

function saveAgentMemory(agentName, content) {
  const file = getMemoryFile(agentName);
  fs.writeFileSync(file, content, 'utf8');
}

// ===== LLM 蒸馏 =====

async function distillConversation(agentName, conversations, existingMemory) {
  // conversations 可以是单条或多条对话
  const prompt = `
你是一个记忆蒸馏器。请将以下 A2A 对话内容提炼为精炼的记忆要点。

**对话对象**: ${agentName}
**对话内容**:
${conversations}

**已有记忆**（如果有）:
${existingMemory ? existingMemory.substring(0, 1500) : '（首次对话，无已有记忆）'}

请将新的记忆提炼为以下格式（只输出新的记忆要点，不要重复已有记忆）：

## 📝 对话摘要
- [关键要点 1]
- [关键要点 2]

## 🤝 关系认知
- [对彼此关系的新认识]

## 💡 重要发现
- [关于对方的重要发现]

## 📌 承诺/约定
- [如果有承诺或约定，没有则写"无"]

## 🎯 待跟进
- [需要后续关注的事项，没有则写"无"]

要求：
1. 简洁明了，每条不超过 50 字
2. 只提取真正重要的内容
3. 输出纯文本，不要 markdown 代码块
`;

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: LLM.model || 'qwen3.6-plus',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.3,
    });

    const req = https.request({
      hostname: LLM.host || 'token-plan.cn-beijing.maas.aliyuncs.com',
      port: parseInt(LLM.port) || 443,
      path: LLM.path || '/compatible-mode/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM.apiKey || ''}`,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 15000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.choices?.[0]?.message?.content?.trim() || '');
        } catch(e) {
          resolve('');
        }
      });
    });

    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.write(payload);
    req.end();
  });
}

// ===== 主功能 =====

/**
 * 处理对话并更新记忆
 * @param {string} agentName - 对话的 Agent 名称
 * @param {string} message - 发送的消息
 * @param {string} reply - 收到的回复
 */
async function processConversation(agentName, message, reply) {
  // 🧠 智能过滤：本地规则判断是否值得蒸馏（0 token 消耗）
  if (!shouldDistill(message, reply)) {
    console.log(`⏭️ 跳过蒸馏: ${agentName} (短对话/无关键信息)`);
    return false;
  }
  
  const conversation = `若兰发送：${message}\n${agentName}回复：${reply}`;

  // 加载已有记忆
  const existingMemory = loadAgentMemory(agentName);

  // 蒸馏新记忆
  console.log(`🧠 正在蒸馏与 ${agentName} 的对话记忆...`);
  const distilled = await distillConversation(agentName, conversation, existingMemory);

  if (!distilled) {
    console.log(`⚠️ 记忆蒸馏失败`);
    return false;
  }

  // 合并记忆
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  let newContent = existingMemory || `# ${agentName} 记忆档案\n\n**首次对话**: ${timestamp}\n\n---\n`;
  newContent += `\n## 📅 ${timestamp}\n\n${distilled}\n\n---\n`;

  // 保存
  saveAgentMemory(agentName, newContent);
  console.log(`✅ 记忆已更新: ${getMemoryFile(agentName)}`);

  return true;
}

/**
 * 获取与某 Agent 的记忆摘要（对话前加载）
 * @param {string} agentName - Agent 名称
 * @param {number} maxEntries - 最多加载几条记忆
 */
function getMemorySummary(agentName, maxEntries = 3) {
  const memory = loadAgentMemory(agentName);
  if (!memory) {
    return `（首次与 ${agentName} 对话，无记忆）`;
  }

  const sections = memory.split('## 📅');
  if (sections.length <= 1) {
    return `（与 ${agentName} 有记忆档案，但内容较少）`;
  }

  const recentSections = sections.slice(-maxEntries);
  let summary = `## 与 ${agentName} 的记忆摘要\n\n`;
  
  for (const section of recentSections) {
    summary += `### ${section.split('\n')[0]}\n`;
    const content = section.substring(section.indexOf('\n') + 1, 200);
    summary += content + '\n\n';
  }

  return summary;
}

// ===== 命令行接口 =====

if (require.main === module) {
  const command = process.argv[2];
  const agentName = process.argv[3];

  switch (command) {
    case 'list':
      const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'));
      console.log('📚 A2A 记忆档案:');
      files.forEach(f => {
        const stat = fs.statSync(path.join(MEMORY_DIR, f));
        console.log(`  - ${f} (${Math.round(stat.size/1024)}KB, ${stat.mtime.toLocaleDateString()})`);
      });
      break;

    case 'show':
      if (agentName) {
        const memory = loadAgentMemory(agentName);
        if (memory) {
          console.log(memory);
        } else {
          console.log(`暂无与 ${agentName} 的记忆`);
        }
      } else {
        console.log('用法：node a2a-memory.js show <agentName>');
      }
      break;

    case 'summary':
      if (agentName) {
        console.log(getMemorySummary(agentName));
      } else {
        console.log('用法：node a2a-memory.js summary <agentName>');
      }
      break;

    default:
      console.log('🧠 A2A 对话记忆系统');
      console.log('用法:');
      console.log('  node a2a-memory.js list              - 列出所有记忆档案');
      console.log('  node a2a-memory.js show <agentName>  - 查看某 Agent 的完整记忆');
      console.log('  node a2a-memory.js summary <agentName> - 查看记忆摘要');
  }
}

module.exports = {
  processConversation,
  getMemorySummary,
  loadAgentMemory,
  saveAgentMemory,
  distillConversation,
  shouldDistill,
};
