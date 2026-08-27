/**
 * A2A 远程命令 - agent.configure
 * 允许白名单 Agent 远程修改配置
 * 
 * 安全机制：
 * 1. 白名单验证
 * 2. 配置 Schema 验证
 * 3. 自动备份
 * 4. 操作审计日志
 * 5. 高风险操作需确认（Phase 2）
 */

const fs = require('fs');
const path = require('path');

// 允许修改的配置项（白名单）
const ALLOWED_CONFIGS = {
  // capabilities 相关
  'capabilities': {
    type: 'object',
    description: 'Agent 能力声明',
    allowedKeys: [
      'system.status', 'skill.list', 'skill.info', 'agent.health',
      'agent.configure',  // 允许远程配置自己
      'a2a.route', 'a2a.delegate',
      'voice.generate', 'image.selfie', 'data.bitable', 'chat.message'
    ],
    risk: 'medium'
  },
  
  // LLM 配置
  'llm.model': {
    type: 'string',
    description: 'LLM 模型名称',
    pattern: /^[a-zA-Z0-9_\-\/]+$/,
    risk: 'medium'
  },
  
  // 个性配置
  'personality': {
    type: 'string',
    description: 'Agent 个性描述',
    maxLength: 500,
    risk: 'low'
  }
};

// 高风险操作列表
const HIGH_RISK_CONFIGS = [
  'agent.configure'  // 允许远程配置自己是一个循环权限
];

class AgentConfigureCommand {
  constructor(config = {}) {
    this.configDir = config.configDir || process.cwd();
    this.identityFile = config.identityFile || 'identity.json';
    this.serverFile = config.serverFile || 'server_v4.js';
    this.backupDir = config.backupDir || path.join(this.configDir, '.config-backups');
    this.auditLog = config.auditLog;
    
    // 确保备份目录存在
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * 执行配置命令
   * @param {Object} params - 命令参数
   * @param {Object} context - 执行上下文
   * @returns {Object} 执行结果
   */
  async execute(params, context = {}) {
    const { configPath, value, action = 'set' } = params;
    const { sender } = context;

    // 1. 验证配置路径是否允许
    const configSpec = ALLOWED_CONFIGS[configPath];
    if (!configSpec) {
      return {
        success: false,
        error: `配置项 '${configPath}' 不允许远程修改`,
        allowedConfigs: Object.keys(ALLOWED_CONFIGS)
      };
    }

    // 2. 验证配置值
    const validation = this.validateValue(value, configSpec);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }

    // 3. 检查是否需要确认（高风险）
    const needsConfirmation = this.needsConfirmation(configPath, value, configSpec);
    if (needsConfirmation && !params.confirmed) {
      return {
        success: false,
        needsConfirmation: true,
        message: `配置项 '${configPath}' 需要确认后才能修改`,
        risk: configSpec.risk,
        confirmationToken: this.generateConfirmationToken(configPath, value)
      };
    }

    // 4. 备份当前配置
    const backupFile = await this.backupConfig(configPath);
    
    try {
      // 5. 应用配置
      const result = await this.applyConfig(configPath, value, action);
      
      // 6. 记录审计日志
      if (this.auditLog) {
        await this.auditLog.log({
          type: 'config.change',
          sender: sender?.name || 'unknown',
          configPath,
          action,
          oldValue: result.oldValue,
          newValue: value,
          backupFile,
          timestamp: new Date().toISOString()
        });
      }

      // 7. 检查是否需要重启
      const needsRestart = this.needsRestart(configPath);

      return {
        success: true,
        configPath,
        action,
        oldValue: result.oldValue,
        newValue: value,
        backupFile,
        needsRestart,
        message: needsRestart 
          ? `配置已更新，需要重启服务才能生效` 
          : `配置已更新并立即生效`
      };

    } catch (error) {
      // 恢复备份
      await this.restoreBackup(backupFile);
      
      return {
        success: false,
        error: `配置更新失败: ${error.message}`,
        backupFile
      };
    }
  }

  /**
   * 验证配置值
   */
  validateValue(value, spec) {
    // 类型检查
    if (spec.type === 'object' && typeof value !== 'object') {
      return { valid: false, error: '值必须是对象类型' };
    }
    if (spec.type === 'string' && typeof value !== 'string') {
      return { valid: false, error: '值必须是字符串类型' };
    }

    // 字符串长度检查
    if (spec.maxLength && value.length > spec.maxLength) {
      return { valid: false, error: `值长度超过限制 (${spec.maxLength})` };
    }

    // 正则匹配检查
    if (spec.pattern && !spec.pattern.test(value)) {
      return { valid: false, error: '值格式不正确' };
    }

    // 对象键检查
    if (spec.allowedKeys && typeof value === 'object') {
      const invalidKeys = Object.keys(value).filter(k => !spec.allowedKeys.includes(k));
      if (invalidKeys.length > 0) {
        return { 
          valid: false, 
          error: `不允许的配置键: ${invalidKeys.join(', ')}`,
          allowedKeys: spec.allowedKeys
        };
      }
    }

    return { valid: true };
  }

  /**
   * 检查是否需要确认
   */
  needsConfirmation(configPath, value, spec) {
    // 高风险配置需要确认
    if (spec.risk === 'high') return true;
    
    // 添加高风险能力需要确认
    if (configPath === 'capabilities' && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        if (HIGH_RISK_CONFIGS.includes(key) && value[key] === true) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * 生成确认令牌
   */
  generateConfirmationToken(configPath, value) {
    const crypto = require('crypto');
    const data = `${configPath}:${JSON.stringify(value)}:${Date.now()}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * 备份配置
   */
  async backupConfig(configPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `${configPath.replace(/\./g, '_')}_${timestamp}.json`;
    const backupFile = path.join(this.backupDir, backupFileName);

    // 读取当前配置
    let currentConfig = {};
    
    // 从 identity.json 读取
    const identityPath = path.join(this.configDir, this.identityFile);
    if (fs.existsSync(identityPath)) {
      const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
      currentConfig.identity = identity;
    }

    // 写入备份
    fs.writeFileSync(backupFile, JSON.stringify(currentConfig, null, 2), 'utf8');
    
    return backupFile;
  }

  /**
   * 应用配置
   */
  async applyConfig(configPath, value, action) {
    const identityPath = path.join(this.configDir, this.identityFile);
    let identity = {};
    let oldValue = null;

    // 读取当前配置
    if (fs.existsSync(identityPath)) {
      identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
    }

    // 获取旧值
    const keys = configPath.split('.');
    let current = identity;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]] || {};
    }
    oldValue = current[keys[keys.length - 1]];

    // 应用新值
    if (action === 'set') {
      this.setNestedValue(identity, configPath, value);
    } else if (action === 'delete') {
      this.deleteNestedValue(identity, configPath);
    } else if (action === 'merge' && typeof value === 'object') {
      const existing = this.getNestedValue(identity, configPath) || {};
      this.setNestedValue(identity, configPath, { ...existing, ...value });
    }

    // 写回文件
    fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2), 'utf8');

    return { oldValue, identity };
  }

  /**
   * 获取嵌套值
   */
  getNestedValue(obj, path) {
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current[key] === undefined) return undefined;
      current = current[key];
    }
    return current;
  }

  /**
   * 设置嵌套值
   */
  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  }

  /**
   * 删除嵌套值
   */
  deleteNestedValue(obj, path) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) return;
      current = current[keys[i]];
    }
    delete current[keys[keys.length - 1]];
  }

  /**
   * 恢复备份
   */
  async restoreBackup(backupFile) {
    if (fs.existsSync(backupFile)) {
      const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
      if (backup.identity) {
        const identityPath = path.join(this.configDir, this.identityFile);
        fs.writeFileSync(identityPath, JSON.stringify(backup.identity, null, 2), 'utf8');
      }
    }
  }

  /**
   * 检查是否需要重启
   */
  needsRestart(configPath) {
    // 这些配置需要重启才能生效
    const restartRequired = ['capabilities', 'llm.model', 'llm'];
    return restartRequired.some(r => configPath.startsWith(r));
  }

  /**
   * 获取当前配置
   */
  async getConfig(configPath) {
    const identityPath = path.join(this.configDir, this.identityFile);
    if (!fs.existsSync(identityPath)) {
      return { success: false, error: 'identity.json 不存在' };
    }

    const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
    const value = this.getNestedValue(identity, configPath);

    return {
      success: true,
      configPath,
      value
    };
  }

  /**
   * 列出可配置项
   */
  listConfigurable() {
    return Object.entries(ALLOWED_CONFIGS).map(([path, spec]) => ({
      path,
      description: spec.description,
      type: spec.type,
      risk: spec.risk,
      allowedKeys: spec.allowedKeys
    }));
  }
}

// 导出命令定义
module.exports = {
  name: 'agent.configure',
  description: '远程配置 Agent 参数（支持白名单配置项）',
  version: '1.0.0',
  risk: 'medium',
  requiresConfirmation: false,  // 根据配置项动态决定
  
  // 命令处理函数
  execute: async (params, context) => {
    const cmd = new AgentConfigureCommand(context.config || {});
    return await cmd.execute(params, context);
  },
  
  // 获取配置
  get: async (params, context) => {
    const cmd = new AgentConfigureCommand(context.config || {});
    return await cmd.getConfig(params.configPath);
  },
  
  // 列出可配置项
  list: async () => {
    const cmd = new AgentConfigureCommand();
    return { success: true, configs: cmd.listConfigurable() };
  },
  
  // 导出类（用于测试）
  AgentConfigureCommand
};
