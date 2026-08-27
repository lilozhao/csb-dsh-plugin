/**
 * 意图识别模块 - Phase 2.5
 * 分析用户自然语言，自动识别需要的路由 capability 和模式
 */

class IntentRecognizer {
  constructor() {
    // 意图模式定义
    this.intentPatterns = [
      // 论坛发帖相关 - 命令模式
      {
        name: 'forum_post',
        capability: 'forum.post',
        mode: 'command',
        patterns: [
          /发[布个]?[一]?[个]?帖[子]?/,
          /[帮]?[我]?[在]?.*[发].*帖/,
          /post.*to.*forum/i,
          /create.*thread/i,
          /发.*到.*论坛/,
        ],
        extractParams: (message) => {
          // 改进的标题提取逻辑（三层次）
          let titleMatch = null;
          
          // 1. 优先匹配「标题：xxx」格式
          titleMatch = message.match(/标题[：:]\s*([^\n]+)/);
          
          // 2. 尝试匹配【标题】xxx 格式
          if (!titleMatch) {
            titleMatch = message.match(/【标题】\s*([^\n]+)/);
          }
          
          // 3. 尝试匹配引号包裹的标题
          if (!titleMatch) {
            titleMatch = message.match(/["「]([^"」]+)["」]/);
          }
          
          // 改进的内容提取逻辑
          let contentMatch = null;
          
          // 1. 优先匹配「内容：xxx」格式（支持多行）
          contentMatch = message.match(/内容[：:]\s*([\s\S]+?)(?=\n---|\n\n\n|$)/);
          
          // 2. 尝试匹配【内容】xxx 格式
          if (!contentMatch) {
            contentMatch = message.match(/【内容】\s*([\s\S]+?)(?=\n---|\n\n\n|$)/);
          }
          
          const title = titleMatch ? titleMatch[1].trim() : '新帖子';
          const content = contentMatch ? contentMatch[1].trim() : message;
          
          return {
            title: title,
            content: content,
          };
        }
      },
      
      // 论坛查询相关 - 命令模式
      {
        name: 'forum_read',
        capability: 'forum.read',
        mode: 'command',
        patterns: [
          /查[看询]?.*帖[子]?/,
          /看.*论坛/,
          /最[新近].*帖/,
          /read.*forum/i,
          /get.*post/i,
        ],
        extractParams: (message) => {
          return { query: message };
        }
      },
      
      // 越剧聊天相关 - 消息模式
      {
        name: 'chat_yueju',
        capability: 'chat.yueju',
        mode: 'message',
        patterns: [
          /越剧/,
          /[讲讲说说聊聊].*越剧/,
          /越剧.*[故事历史]/,
          /yueju/i,
          /越剧.*[表演演员]/,
        ],
        extractParams: (message) => {
          return { topic: '越剧', query: message };
        }
      },
      
      // 丝绸文化相关 - 消息模式
      {
        name: 'chat_silk',
        capability: 'chat.silk',
        mode: 'message',
        patterns: [
          /丝绸/,
          /[讲讲说说聊聊].*丝绸/,
          /杭州.*丝绸/,
          /silk/i,
          /绸缎/,
        ],
        extractParams: (message) => {
          return { topic: '丝绸', query: message };
        }
      },
      
      // 一般聊天咨询 - 消息模式
      {
        name: 'chat_general',
        capability: 'chat.message',
        mode: 'message',
        patterns: [
          /[问问聊聊说说].*关于/,
          /[想知了解].*关于/,
          /[讲讲介绍].*/,
        ],
        extractParams: (message) => {
          return { query: message };
        }
      },
      
      // 数据录入 - 命令模式
      {
        name: 'data_entry',
        capability: 'data.bitable',
        mode: 'command',
        patterns: [
          /[录记][入下].*数据/,
          /[添加新建].*记录/,
          /data.*entry/i,
          /[写填].*表格/,
        ],
        extractParams: (message) => {
          return { data: message };
        }
      },
      
      // 天气查询 - 本地处理或命令模式
      {
        name: 'weather_query',
        capability: null,  // 本地处理
        mode: 'local',
        patterns: [
          /天气/,
          /[今明后].*天.*天气/,
          /weather/i,
          /[温度气温]/,
        ],
        extractParams: (message) => {
          return { query: message };
        }
      },
    ];
  }

  /**
   * 识别用户意图
   * @param {string} message - 用户消息
   * @returns {Object} - 识别结果
   */
  recognize(message) {
    const lowerMessage = message.toLowerCase();
    
    for (const intent of this.intentPatterns) {
      for (const pattern of intent.patterns) {
        if (pattern.test(message) || pattern.test(lowerMessage)) {
          const params = intent.extractParams ? intent.extractParams(message) : {};
          return {
            matched: true,
            intent: intent.name,
            capability: intent.capability,
            mode: intent.mode,
            confidence: 'high',
            params: params,
            originalMessage: message,
          };
        }
      }
    }
    
    // 没有匹配到任何意图
    return {
      matched: false,
      intent: null,
      capability: null,
      mode: 'local',  // 默认本地处理
      confidence: 'low',
      params: {},
      originalMessage: message,
    };
  }

  /**
   * 添加自定义意图模式
   * @param {Object} intentDef - 意图定义
   */
  addIntent(intentDef) {
    this.intentPatterns.push(intentDef);
  }

  /**
   * 获取所有支持的意图
   */
  getSupportedIntents() {
    return this.intentPatterns.map(i => ({
      name: i.name,
      capability: i.capability,
      mode: i.mode,
    }));
  }
}

module.exports = { IntentRecognizer };
