/**
 * A2A 远程命令执行 - 权限验证器
 * 白名单 + 命令类型检查
 */

// Phase 1 命令白名单
const PHASE1_COMMANDS = new Set([
  'system.status',
  'skill.list',
  'skill.info',
  'agent.health',
  'agent.configure'  // 新增：远程配置能力
]);

// 风险等级定义
const COMMAND_RISK = {
  'system.status': 'low',
  'skill.list': 'low',
  'skill.info': 'low',
  'agent.health': 'low',
  'agent.configure': 'medium'  // 配置修改是中等风险
};

class Validator {
  constructor() {
    this.whitelist = new Map(); // sender -> { allowedCommands, metadata }
    this.loadWhitelist();
  }

  /**
   * 加载白名单配置
   */
  loadWhitelist() {
    // 从配置文件或环境变量加载
    const whitelistConfig = process.env.A2A_WHITELIST;
    
    if (whitelistConfig) {
      try {
        const config = JSON.parse(whitelistConfig);
        config.forEach(item => {
          this.whitelist.set(item.name, {
            url: item.url,
            allowedCommands: new Set(item.allowedCommands || Array.from(PHASE1_COMMANDS))
          });
        });
      } catch (e) {
        console.error('[A2A-CMD] Failed to parse whitelist:', e.message);
      }
    }

    // 默认白名单（开发环境）- 只允许若兰发起远程命令
    if (this.whitelist.size === 0) {
      console.warn('[A2A-CMD] Using default whitelist (development mode)');
      this.whitelist.set('若兰', {
        url: 'http://172.28.0.4:3100',
        allowedCommands: new Set(PHASE1_COMMANDS)
      });
    }
  }

  /**
   * 验证发送者是否在白名单
   * @param {string} sender - 发送者名称
   * @param {string} senderUrl - 发送者 URL
   * @returns {boolean}
   */
  isWhitelisted(sender, senderUrl) {
    const entry = this.findWhitelistEntry(sender);
    
    if (!entry) {
      console.warn(`[A2A-CMD] Sender not in whitelist: ${sender}`);
      return false;
    }

    // 验证 URL 匹配（可选，增加安全性）
    if (senderUrl && entry.url && entry.url !== senderUrl) {
      console.warn(`[A2A-CMD] URL mismatch for ${sender}: expected ${entry.url}, got ${senderUrl}`);
      return false;
    }

    return true;
  }

  /**
   * 验证命令是否在白名单
   * @param {string} command - 命令类型
   * @returns {boolean}
   */
  isCommandAllowed(command) {
    return PHASE1_COMMANDS.has(command);
  }

  /**
   * 查找白名单条目（支持带/不带 emoji、前缀匹配）
   * @param {string} sender - 发送者名称
   * @returns {Object|null}
   */
  findWhitelistEntry(sender) {
    // 直接匹配
    let entry = this.whitelist.get(sender);
    
    if (!entry) {
      // 遍历白名单，检查是否匹配
      for (const [name, data] of this.whitelist) {
        // 1. 去掉 emoji 后比较
        const nameWithoutEmoji = name.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
        const senderWithoutEmoji = sender.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
        
        if (nameWithoutEmoji === senderWithoutEmoji) {
          entry = data;
          break;
        }
        
        // 2. 检查是否包含关系（支持前缀如 "OPC-Jeason" 匹配 "Jeason"）
        if (nameWithoutEmoji.includes(senderWithoutEmoji) || senderWithoutEmoji.includes(nameWithoutEmoji)) {
          entry = data;
          break;
        }
      }
    }
    
    return entry;
  }

  /**
   * 验证发送者是否有权限执行特定命令
   * @param {string} sender - 发送者名称
   * @param {string} command - 命令类型
   * @returns {boolean}
   */
  canExecute(sender, command) {
    if (!this.isCommandAllowed(command)) {
      console.warn(`[A2A-CMD] Command not allowed: ${command}`);
      return false;
    }

    const entry = this.findWhitelistEntry(sender);
    if (!entry) {
      return false;
    }

    return entry.allowedCommands.has(command);
  }

  /**
   * 获取命令风险等级
   * @param {string} command - 命令类型
   * @returns {string} 'low' | 'medium' | 'high'
   */
  getRiskLevel(command) {
    return COMMAND_RISK[command] || 'unknown';
  }

  /**
   * 检查是否需要用户确认（Phase 2 用）
   * @param {string} command - 命令类型
   * @returns {boolean}
   */
  needsConfirmation(command) {
    return this.getRiskLevel(command) === 'high';
  }

  /**
   * 完整验证
   * @param {Object} request - 请求对象
   * @returns {Object} { valid: boolean, error?: string }
   */
  validate(request) {
    const { sender, command } = request;

    // 验证发送者
    if (!this.isWhitelisted(sender.name, sender.url)) {
      return { valid: false, error: 'Sender not whitelisted', code: -32001 };
    }

    // 验证命令类型
    if (!this.isCommandAllowed(command.type)) {
      return { valid: false, error: 'Command not allowed', code: -32002 };
    }

    // 验证发送者是否有权限
    if (!this.canExecute(sender.name, command.type)) {
      return { valid: false, error: 'Permission denied', code: -32001 };
    }

    return { valid: true };
  }

  /**
   * 获取白名单列表
   * @returns {Array}
   */
  getWhitelist() {
    return Array.from(this.whitelist.entries()).map(([name, config]) => ({
      name,
      url: config.url,
      allowedCommands: Array.from(config.allowedCommands)
    }));
  }
}

module.exports = { Validator, PHASE1_COMMANDS };
