/**
 * A2A 对话上下文管理模块
 * 实现 A2A-004 协议规范
 */

const fs = require('fs');
const path = require('path');

// 上下文存储目录
const CONTEXT_DIR = process.env.A2A_CONTEXT_DIR || './a2a-contexts';
const MAX_CONTEXT_MESSAGES = 50;  // 每个 thread 最多保留的消息数
const MAX_CONTEXT_CHARS = 15000;  // 上下文最大字符数

class ContextManager {
  constructor() {
    this.contexts = new Map(); // thread_id -> context
    this.ensureContextDir();
  }

  ensureContextDir() {
    if (!fs.existsSync(CONTEXT_DIR)) {
      fs.mkdirSync(CONTEXT_DIR, { recursive: true });
      console.log('[上下文] 创建上下文目录:', CONTEXT_DIR);
    }
  }

  /**
   * 获取或创建对话上下文
   * @param {string} threadId - 对话线程ID
   * @returns {object} 上下文对象
   */
  getOrCreateContext(threadId) {
    if (!threadId) {
      // 没有指定 thread_id，创建新的
      threadId = `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    if (!this.contexts.has(threadId)) {
      // 尝试从文件加载
      const loaded = this.loadContext(threadId);
      if (loaded) {
        this.contexts.set(threadId, loaded);
      } else {
        // 创建新上下文
        this.contexts.set(threadId, {
          thread_id: threadId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          participants: [],
          messages: [],
          summary: null,
          key_decisions: [],
          open_questions: []
        });
      }
    }

    return this.contexts.get(threadId);
  }

  /**
   * 添加消息到上下文
   * @param {string} threadId - 对话线程ID
   * @param {object} message - 消息对象
   * @param {string} parentId - 父消息ID（可选）
   */
  addMessage(threadId, message, parentId = null) {
    const context = this.getOrCreateContext(threadId);
    
    const msgId = message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const msgRecord = {
      id: msgId,
      parent_id: parentId,
      role: message.role,
      sender: message.sender,
      timestamp: new Date().toISOString(),
      content: message.parts?.map(p => p.text).join('\n') || '',
      truncated: false
    };

    context.messages.push(msgRecord);
    context.updated_at = new Date().toISOString();

    // 更新参与者
    if (message.sender && !context.participants.includes(message.sender)) {
      context.participants.push(message.sender);
    }

    // 检查是否需要截断
    if (context.messages.length > MAX_CONTEXT_MESSAGES) {
      this.truncateContext(context);
    }

    // 异步保存
    this.saveContext(threadId, context);

    return msgId;
  }

  /**
   * 截断上下文（保留关键决策节点）
   */
  truncateContext(context) {
    const messages = context.messages;
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);

    if (totalChars > MAX_CONTEXT_CHARS || messages.length > MAX_CONTEXT_MESSAGES) {
      // 保留最近的消息
      const keepCount = Math.floor(MAX_CONTEXT_MESSAGES * 0.7);
      const removed = messages.slice(0, messages.length - keepCount);
      
      // 生成摘要
      context.summary = this.generateSummary(removed);
      
      // 标记截断
      context.messages = messages.slice(-keepCount);
      context.messages[0].truncated = true;
      
      console.log(`[上下文] 已截断 ${removed.length} 条消息，生成摘要`);
    }
  }

  /**
   * 生成摘要（简单版本，后续可接入 LLM）
   */
  generateSummary(messages) {
    if (messages.length === 0) return null;
    
    // 提取关键信息
    const topics = new Set();
    const decisions = [];
    
    messages.forEach(m => {
      // 简单关键词提取（可后续优化）
      const text = m.content || '';
      if (text.includes('决定') || text.includes('确定') || text.includes('同意')) {
        decisions.push(text.substring(0, 100));
      }
    });

    return {
      message_count: messages.length,
      time_range: {
        start: messages[0]?.timestamp,
        end: messages[messages.length - 1]?.timestamp
      },
      decisions: decisions.slice(0, 5),
      generated_at: new Date().toISOString()
    };
  }

  /**
   * 获取上下文摘要（用于传递给对方 Agent）
   */
  getContextSummary(threadId) {
    const context = this.contexts.get(threadId);
    if (!context) return null;

    return {
      thread_id: threadId,
      summary: context.summary,
      participants: context.participants,
      key_decisions: context.key_decisions,
      open_questions: context.open_questions,
      message_count: context.messages.length,
      last_message_at: context.messages[context.messages.length - 1]?.timestamp
    };
  }

  /**
   * 获取完整消息历史（用于本地处理）
   */
  getMessageHistory(threadId, limit = 10) {
    const context = this.contexts.get(threadId);
    if (!context) return [];

    return context.messages.slice(-limit);
  }

  /**
   * 添加关键决策
   */
  addKeyDecision(threadId, decision) {
    const context = this.contexts.get(threadId);
    if (context) {
      context.key_decisions.push({
        content: decision,
        timestamp: new Date().toISOString()
      });
      context.key_decisions = context.key_decisions.slice(-10); // 保留最近 10 个
      this.saveContext(threadId, context);
    }
  }

  /**
   * 添加待解决问题
   */
  addOpenQuestion(threadId, question) {
    const context = this.contexts.get(threadId);
    if (context) {
      context.open_questions.push({
        content: question,
        timestamp: new Date().toISOString(),
        resolved: false
      });
      this.saveContext(threadId, context);
    }
  }

  /**
   * 解决待解决问题
   */
  resolveOpenQuestion(threadId, questionIndex) {
    const context = this.contexts.get(threadId);
    if (context && context.open_questions[questionIndex]) {
      context.open_questions[questionIndex].resolved = true;
      context.open_questions[questionIndex].resolved_at = new Date().toISOString();
      this.saveContext(threadId, context);
    }
  }

  /**
   * 保存上下文到文件
   */
  saveContext(threadId, context) {
    const filePath = path.join(CONTEXT_DIR, `${threadId}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(context, null, 2), 'utf8');
    } catch (e) {
      console.error('[上下文] 保存失败:', e.message);
    }
  }

  /**
   * 从文件加载上下文
   */
  loadContext(threadId) {
    const filePath = path.join(CONTEXT_DIR, `${threadId}.json`);
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('[上下文] 加载失败:', e.message);
    }
    return null;
  }

  /**
   * 清理过期上下文（超过 7 天未更新）
   */
  cleanupExpired() {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 天

    for (const [threadId, context] of this.contexts) {
      const updatedAt = new Date(context.updated_at).getTime();
      if (now - updatedAt > maxAge) {
        this.contexts.delete(threadId);
        console.log(`[上下文] 清理过期: ${threadId}`);
      }
    }
  }

  /**
   * 构建带上下文的消息（符合 A2A-004 规范）
   */
  buildContextualMessage(threadId, message, parentId = null) {
    const context = this.getOrCreateContext(threadId);
    
    return {
      thread_id: threadId,
      parent_id: parentId,
      context: this.getContextSummary(threadId),
      truncated: context.summary !== null,
      message: message
    };
  }
}

module.exports = { ContextManager };
