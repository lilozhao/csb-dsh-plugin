/**
 * 委托验证包装器
 * 用于在发起委托后自动验证结果
 */

const { TaskVerifier } = require('./task-verifier.js');

class DelegationValidator {
  constructor() {
    this.verifier = new TaskVerifier();
  }

  /**
   * 发起委托并验证结果
   * @param {Function} delegateFn - 委托函数
   * @param {string} capability - 能力类型
   * @param {object} params - 委托参数
   * @param {object} options - 选项
   * @returns {object} 包含验证信息的结果
   */
  async delegateAndVerify(delegateFn, capability, params, options = {}) {
    const { autoRetry = true, maxRetries = 3 } = options;

    let attempts = 0;
    let lastResult = null;
    let lastVerification = null;

    while (attempts < maxRetries) {
      attempts++;
      
      try {
        // 1. 执行委托
        console.log(`[Validator] 发起委托 (尝试 ${attempts}/${maxRetries}): ${capability}`);
        const result = await delegateFn();
        
        // 2. 验证结果
        console.log(`[Validator] 验证结果...`);
        const verification = await this.verifier.verify(capability, params, result);
        
        lastResult = result;
        lastVerification = verification;
        
        // 3. 如果验证通过，返回结果
        if (verification.verified) {
          console.log(`[Validator] ✅ 验证通过: ${verification.message}`);
          return {
            success: true,
            result,
            verification,
            attempts
          };
        }
        
        // 4. 验证失败，记录并决定是否重试
        console.log(`[Validator] ❌ 验证失败: ${verification.message}`);
        
        if (!autoRetry || attempts >= maxRetries) {
          // 不重试或达到最大重试次数
          return {
            success: false,
            result,
            verification,
            attempts,
            message: `任务完成但验证失败: ${verification.message}`
          };
        }
        
        // 5. 自动重试
        console.log(`[Validator] 准备重试...`);
        
      } catch (err) {
        console.error(`[Validator] 委托执行错误: ${err.message}`);
        
        if (attempts >= maxRetries) {
          return {
            success: false,
            error: err.message,
            attempts
          };
        }
      }
    }
    
    return {
      success: false,
      result: lastResult,
      verification: lastVerification,
      attempts,
      message: '达到最大重试次数'
    };
  }

  /**
   * 生成用户友好的验证报告
   */
  generateReport(capability, params, delegationResult) {
    const { success, result, verification, attempts, message } = delegationResult;
    
    let report = `## 📋 任务验证报告\n\n`;
    report += `**能力**: ${capability}\n`;
    report += `**尝试次数**: ${attempts}\n`;
    report += `**状态**: ${success ? '✅ 成功' : '❌ 失败'}\n\n`;
    
    if (verification) {
      report += `### 验证详情\n`;
      report += `- **置信度**: ${verification.confidence}\n`;
      report += `- **消息**: ${verification.message}\n`;
      
      if (verification.details) {
        if (verification.details.url) {
          report += `- **链接**: ${verification.details.url}\n`;
        }
        if (verification.details.title) {
          report += `- **标题**: ${verification.details.title}\n`;
        }
      }
    }
    
    if (message) {
      report += `\n**备注**: ${message}\n`;
    }
    
    return report;
  }
}

module.exports = { DelegationValidator };
