#!/usr/bin/env node
/**
 * A2A 对话上下文管理模块
 * 实现 A2A-004 协议规范
 * 
 * 功能：
 * - thread_id 持久化存储
 * - 消息历史记录（最多50条）
 * - 上下文摘要生成
 * - 与 client-v2.js 集成实现串行讨论
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 上下文存储目录
const CONTEXT_DIR = process.env.A2A_CONTEXT_DIR || './a2a-contexts';
const MAX_CONTEXT_MESSAGES = 50;  // 每个 thread 最多保留的消息数
const MAX_CONTEXT_CHARS = 15000;  // 上下文最大字符数

/**
 * 生成 thread_id
 */
function generateThreadId(prefix = 'thread') {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * 生成消息 ID
 */
function generateMessageId() {
  return `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * 截断上下文，保留摘要
 */
function truncateContext(context, maxChars = MAX_CONTEXT_CHARS) {
  const content = JSON.stringify(context);
  if (content.length <= maxChars) {
    return false; // 不需要截断
  }
  
  // 保留最新消息和摘要
  const recentMessages = context.messages.slice(-10);
  const summary = context.summary || '（上下文中...）';
  
  context.messages = recentMessages;
  context.summary = summary + '（已截断早期消息）';
  context.truncated = true;
  
  return true;
}

class ContextManager {
  constructor() {
    this.contexts = new Map(); // thread_id -> context (内存缓存)
    this.ensureContextDir();
  }

  ensureContextDir() {
    if (!fs.existsSync(CONTEXT_DIR)) {
      fs.mkdirSync(CONTEXT_DIR, { recursive: true });
      console.log('[上下文] 创建上下文目录:', CONTEXT_DIR);
    }
  }

  /**
   * 获取上下文文件路径
   */
  getContextPath(threadId) {
    return path.join(CONTEXT_DIR, `${threadId}.json`);
  }

  /**
   * 从文件加载上下文
   */
  loadContext(threadId) {
    const filePath = this.getContextPath(threadId);
    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
      } catch (e) {
        console.warn('[上下文] 加载失败:', e.message);
      }
    }
    return null;
  }

  /**
   * 保存上下文到文件
   */
  saveContext(threadId, context) {
    const filePath = this.getContextPath(threadId);
    try {
      fs.writeFileSync(filePath, JSON.stringify(context, null, 2));
    } catch (e) {
      console.error('[上下文] 保存失败:', e.message);
    }
  }

  /**
   * 获取或创建对话上下文
   * @param {string} threadId - 对话线程ID
   * @returns {object} 上下文对象
   */
  getOrCreateContext(threadId) {
    if (!threadId) {
      threadId = generateThreadId();
    }

    if (!this.contexts.has(threadId)) {
      const loaded = this.loadContext(threadId);
      if (loaded) {
        this.contexts.set(threadId, loaded);
      } else {
        this.contexts.set(threadId, {
          thread_id: threadId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          participants: [],
          messages: [],
          summary: null,
          key_decisions: [],
          open_questions: [],
          metadata: {}
        });
      }
    }

    return this.contexts.get(threadId);
  }

  /**
   * 添加消息到上下文
   * @param {string} threadId - 对话线程ID
   * @param {object} message - 消息对象 { role, sender, content }
   * @param {string} parentId - 父消息ID（可选）
   */
  addMessage(threadId, message, parentId = null) {
    const context = this.getOrCreateContext(threadId);
    
    const msgId = generateMessageId();
    
    const msgRecord = {
      id: msgId,
      parent_id: parentId,
      role: message.role || 'user',
      sender: message.sender || '未知',
      timestamp: new Date().toISOString(),
      content: message.content || '',
      truncated: false
    };

    context.messages.push(msgRecord);
    context.updated_at = new Date().toISOString();

    // 更新参与者
    if (message.sender && !context.participants.includes(message.sender)) {
      context.participants.push(message.sender);
    }

    // 检查是否需要截断
    const needsTruncate = truncateContext(context);
    if (needsTruncate) {
      context.truncated = true;
    }

    // 异步保存
    this.saveContext(threadId, context);

    return { msgId, truncated: context.truncated };
  }

  /**
   * 获取上下文摘要（供发送方使用）
   */
  getContextSummary(threadId) {
    const context = this.getOrCreateContext(threadId);
    
    if (context.summary) {
      return context.summary;
    }
    
    // 生成简单摘要
    const recentMessages = context.messages.slice(-5);
    const summary = recentMessages.map(m => `[${m.sender}]: ${m.content.substring(0, 50)}`).join('\n');
    
    return summary || '（暂无上下文）';
  }

  /**
   * 生成 AI 摘要（可选，需要 LLM 支持）
   */
  async generateSummary(threadId, llmClient = null) {
    const context = this.getOrCreateContext(threadId);
    
    if (!llmClient) {
      // 无 LLM，使用规则模板摘要
      return this.generateTemplateSummary(context);
    }
    
    try {
      const prompt = `请总结以下对话的要点，包括：
1. 主要讨论话题
2. 达成的共识
3. 待解决的问题

对话内容：
${context.messages.map(m => `[${m.sender}]: ${m.content}`).join('\n')}`;

      const response = await llmClient(prompt);
      
      context.summary = response;
      context.updated_at = new Date().toISOString();
      this.saveContext(threadId, context);
      
      return response;
    } catch (e) {
      console.warn('[上下文] 摘要生成失败:', e.message);
      return this.generateTemplateSummary(context);
    }
  }

  /**
   * 使用规则模板生成摘要
   */
  generateTemplateSummary(context) {
    const participants = context.participants.join(', ');
    const msgCount = context.messages.length;
    const lastMessage = context.messages[context.messages.length - 1];
    
    return `[${participants}] 共 ${msgCount} 条消息讨论。最新: [${lastMessage?.sender}]: ${lastMessage?.content?.substring(0, 30)}...`;
  }

  /**
   * 添加决策记录
   */
  addDecision(threadId, decision) {
    const context = this.getOrCreateContext(threadId);
    
    if (!context.key_decisions) {
      context.key_decisions = [];
    }
    
    context.key_decisions.push({
      decision,
      timestamp: new Date().toISOString()
    });
    
    this.saveContext(threadId, context);
  }

  /**
   * 添加开放问题
   */
  addOpenQuestion(threadId, question) {
    const context = this.getOrCreateContext(threadId);
    
    if (!context.open_questions) {
      context.open_questions = [];
    }
    
    context.open_questions.push({
      question,
      timestamp: new Date().toISOString()
    });
    
    this.saveContext(threadId, context);
  }

  /**
   * 解决开放问题
   */
  resolveOpenQuestion(threadId, questionIndex) {
    const context = this.getOrCreateContext(threadId);
    
    if (context.open_questions && context.open_questions[questionIndex]) {
      context.open_questions.splice(questionIndex, 1);
      this.saveContext(threadId, context);
    }
  }

  /**
   * 获取完整上下文（用于串行讨论）
   */
  getFullContext(threadId) {
    const context = this.getOrCreateContext(threadId);
    
    return {
      thread_id: threadId,
      participants: context.participants,
      summary: context.summary || this.getContextSummary(threadId),
      messages: context.messages,
      key_decisions: context.key_decisions || [],
      open_questions: context.open_questions || [],
      truncated: context.truncated || false
    };
  }

  /**
   * 构建发送给其他 Agent 的上下文摘要
   * A2A-004 规范：只传必要上下文，不过载
   */
  buildContextForAgent(threadId, options = {}) {
    const { maxMessages = 10, includeSummary = true } = options;
    const context = this.getOrCreateContext(threadId);
    
    const result = {
      thread_id: threadId,
      participants: context.participants,
    };
    
    // 添加摘要
    if (includeSummary) {
      result.summary = context.summary || this.getContextSummary(threadId);
    }
    
    // 添加最近的 N 条消息
    result.recent_messages = context.messages.slice(-maxMessages);
    
    // 标记是否有截断
    result.truncated = context.truncated;
    
    // 添加待解决问题
    if (context.open_questions?.length > 0) {
      result.open_questions = context.open_questions;
    }
    
    return result;
  }

  /**
   * 列出所有上下文
   */
  listContexts() {
    const files = fs.readdirSync(CONTEXT_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
    
    return files.map(threadId => {
      const context = this.loadContext(threadId);
      return {
        thread_id: threadId,
        created_at: context?.created_at,
        updated_at: context?.updated_at,
        participants: context?.participants || [],
        message_count: context?.messages?.length || 0
      };
    });
  }

  /**
   * 删除上下文
   */
  deleteContext(threadId) {
    this.contexts.delete(threadId);
    const filePath = this.getContextPath(threadId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

// 导出模块
module.exports = {
  ContextManager,
  generateThreadId,
  generateMessageId,
};

// CLI 测试
if (require.main === module) {
  const cm = new ContextManager();
  
  const args = process.argv.slice(2);
  if (args[0] === 'list') {
    console.log('所有上下文:');
    console.log(JSON.stringify(cm.listContexts(), null, 2));
  } else if (args[0] === 'create') {
    const threadId = generateThreadId();
    const context = cm.getOrCreateContext(threadId);
    console.log('创建上下文:', threadId);
    console.log(JSON.stringify(context, null, 2));
  } else if (args[0] === 'add' && args[1]) {
    const threadId = args[2] || generateThreadId();
    cm.addMessage(threadId, { role: 'user', sender: '测试', content: args[1] });
    console.log('添加消息到:', threadId);
  } else {
    console.log('用法:');
    console.log('  node context-manager.js list');
    console.log('  node context-manager.js create');
    console.log('  node context-manager.js add <内容> [thread_id]');
  }
}
