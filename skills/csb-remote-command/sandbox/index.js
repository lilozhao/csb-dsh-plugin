/**
 * A2A 远程命令执行 - 沙箱提供者工厂
 * 支持 Linux/Windows/Fallback
 */

const os = require('os');

// 平台特定的沙箱实现
const platformImplementations = {
  linux: './linux.js',
  win32: './windows.js',
  fallback: './fallback.js'
};

class SandboxProvider {
  /**
   * 执行命令
   * @param {string} command - 命令类型
   * @param {Object} params - 命令参数
   * @returns {Promise<Object>}
   */
  async execute(command, params) {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * 获取平台类型
   * @returns {string}
   */
  getPlatform() {
    throw new Error('getPlatform() must be implemented by subclass');
  }

  /**
   * 检查沙箱健康状态
   * @returns {Promise<boolean>}
   */
  async health() {
    return true;
  }
}

class SandboxProviderFactory {
  static instance = null;

  /**
   * 创建沙箱提供者
   * @param {string} platform - 强制指定平台（可选）
   * @returns {SandboxProvider}
   */
  static create(platform) {
    if (this.instance) {
      return this.instance;
    }

    const detectedPlatform = platform || os.platform();
    
    console.log(`[A2A-CMD] Detected platform: ${detectedPlatform}`);

    try {
      if (detectedPlatform === 'linux') {
        const { LinuxSandbox } = require('./linux.js');
        this.instance = new LinuxSandbox();
      } else if (detectedPlatform === 'win32') {
        const { WindowsSandbox } = require('./windows.js');
        this.instance = new WindowsSandbox();
      } else {
        console.warn(`[A2A-CMD] Unsupported platform ${detectedPlatform}, using fallback`);
        const { FallbackSandbox } = require('./fallback.js');
        this.instance = new FallbackSandbox();
      }
    } catch (e) {
      console.error(`[A2A-CMD] Failed to load platform sandbox: ${e.message}`);
      console.warn('[A2A-CMD] Falling back to basic sandbox');
      const { FallbackSandbox } = require('./fallback.js');
      this.instance = new FallbackSandbox();
    }

    return this.instance;
  }

  /**
   * 重置工厂（用于测试）
   */
  static reset() {
    this.instance = null;
  }
}

module.exports = { 
  SandboxProvider, 
  SandboxProviderFactory 
};
