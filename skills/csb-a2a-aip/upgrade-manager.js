/**
 * A2A 升级管理器
 * 支持通过 A2A 协议进行代码升级
 * 
 * @version 1.0.0
 * @author 若兰 🌸
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class UpgradeManager {
  constructor() {
    this.upgradeDir = '/tmp/a2a-upgrades';
    this.backupDir = '/tmp/a2a-backups';
    this.targetDir = '/home/node/.openclaw/workspace/csb-a2a-aip';
    
    // 确保目录存在
    this.ensureDir(this.upgradeDir);
    this.ensureDir(this.backupDir);
    
    // 支持升级的文件列表
    this.upgradableFiles = [
      'intent-recognizer.js',
      'task-verifier.js',
      'delegation-validator.js',
      'server_v4.js'
    ];
  }

  ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 检查是否有待处理的升级
   */
  checkPendingUpgrade() {
    const pendingFile = path.join(this.upgradeDir, 'pending-upgrade.json');
    if (fs.existsSync(pendingFile)) {
      return JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    }
    return null;
  }

  /**
   * 准备升级包
   */
  prepareUpgradePackage(files, version, source) {
    const packageInfo = {
      version,
      source,
      timestamp: new Date().toISOString(),
      files: []
    };

    for (const file of files) {
      const filePath = path.join(this.targetDir, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const hash = this.simpleHash(content);
        
        packageInfo.files.push({
          name: file,
          hash,
          size: content.length
        });
      }
    }

    return packageInfo;
  }

  /**
   * 简单哈希函数
   */
  simpleHash(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * 执行升级
   */
  async performUpgrade(upgradeData, options = {}) {
    const { skipBackup = false, dryRun = false } = options;
    const results = {
      success: true,
      timestamp: new Date().toISOString(),
      actions: [],
      errors: []
    };

    console.log('[Upgrade] 开始升级流程...');

    // 1. 验证升级数据
    if (!upgradeData.files || !Array.isArray(upgradeData.files)) {
      return {
        success: false,
        error: '无效的升级数据'
      };
    }

    // 2. 备份当前版本
    if (!skipBackup) {
      const backupTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.backupDir, backupTimestamp);
      
      try {
        this.ensureDir(backupPath);
        
        for (const file of this.upgradableFiles) {
          const sourcePath = path.join(this.targetDir, file);
          if (fs.existsSync(sourcePath)) {
            const destPath = path.join(backupPath, file);
            fs.copyFileSync(sourcePath, destPath);
            results.actions.push(`备份: ${file}`);
          }
        }
        
        results.backupPath = backupPath;
        console.log(`[Upgrade] 备份完成: ${backupPath}`);
      } catch (err) {
        results.errors.push(`备份失败: ${err.message}`);
        results.success = false;
        return results;
      }
    }

    // 3. 写入新文件
    if (!dryRun) {
      for (const fileInfo of upgradeData.files) {
        if (!this.upgradableFiles.includes(fileInfo.name)) {
          results.errors.push(`不允许升级: ${fileInfo.name}`);
          continue;
        }

        try {
          const targetPath = path.join(this.targetDir, fileInfo.name);
          
          // 从 Gitee 拉取或使用提供的内容
          if (upgradeData.source === 'gitee') {
            const pullResult = execSync('git pull origin main', {
              cwd: this.targetDir,
              encoding: 'utf8'
            });
            results.actions.push(`Git pull: ${pullResult.trim()}`);
          } else if (fileInfo.content) {
            fs.writeFileSync(targetPath, fileInfo.content, 'utf8');
            results.actions.push(`写入: ${fileInfo.name}`);
          }
        } catch (err) {
          results.errors.push(`写入失败 (${fileInfo.name}): ${err.message}`);
          results.success = false;
        }
      }
    }

    // 4. 重启服务
    if (!dryRun && results.success) {
      try {
        console.log('[Upgrade] 重启服务...');
        
        // 使用 start.sh 重启
        const restartResult = execSync('./start.sh', {
          cwd: this.targetDir,
          encoding: 'utf8',
          timeout: 10000
        });
        
        results.actions.push('服务重启成功');
        results.restartOutput = restartResult;
      } catch (err) {
        results.errors.push(`重启失败: ${err.message}`);
        results.success = false;
      }
    }

    // 5. 健康检查
    if (results.success) {
      try {
        const healthCheck = execSync('curl -s http://localhost:3100/health', {
          encoding: 'utf8',
          timeout: 5000
        });
        
        const health = JSON.parse(healthCheck);
        results.healthCheck = health;
        results.actions.push(`健康检查通过: ${health.name} v${health.version}`);
      } catch (err) {
        results.errors.push(`健康检查失败: ${err.message}`);
        results.success = false;
      }
    }

    console.log('[Upgrade] 升级完成:', results.success ? '成功' : '失败');
    return results;
  }

  /**
   * 回滚到上一个版本
   */
  async rollback() {
    // 找到最新的备份
    const backups = fs.readdirSync(this.backupDir)
      .filter(f => fs.statSync(path.join(this.backupDir, f)).isDirectory())
      .sort()
      .reverse();

    if (backups.length === 0) {
      return {
        success: false,
        error: '没有可用的备份'
      };
    }

    const latestBackup = path.join(this.backupDir, backups[0]);
    console.log(`[Rollback] 回滚到: ${latestBackup}`);

    const results = {
      success: true,
      backupUsed: backups[0],
      actions: [],
      errors: []
    };

    // 恢复文件
    for (const file of this.upgradableFiles) {
      const sourcePath = path.join(latestBackup, file);
      if (fs.existsSync(sourcePath)) {
        try {
          const targetPath = path.join(this.targetDir, file);
          fs.copyFileSync(sourcePath, targetPath);
          results.actions.push(`恢复: ${file}`);
        } catch (err) {
          results.errors.push(`恢复失败 (${file}): ${err.message}`);
          results.success = false;
        }
      }
    }

    // 重启服务
    if (results.success) {
      try {
        execSync('./start.sh', {
          cwd: this.targetDir,
          encoding: 'utf8',
          timeout: 10000
        });
        results.actions.push('服务重启成功');
      } catch (err) {
        results.errors.push(`重启失败: ${err.message}`);
        results.success = false;
      }
    }

    return results;
  }

  /**
   * 获取升级状态报告
   */
  getStatus() {
    const status = {
      currentVersion: null,
      lastBackup: null,
      upgradableFiles: this.upgradableFiles,
      backupCount: 0
    };

    // 检查当前版本
    try {
      const serverPath = path.join(this.targetDir, 'server_v4.js');
      const content = fs.readFileSync(serverPath, 'utf8');
      const match = content.match(/A2A_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (match) {
        status.currentVersion = match[1];
      }
    } catch (err) {
      status.versionError = err.message;
    }

    // 检查备份
    try {
      const backups = fs.readdirSync(this.backupDir)
        .filter(f => fs.statSync(path.join(this.backupDir, f)).isDirectory());
      status.backupCount = backups.length;
      status.lastBackup = backups.sort().reverse()[0] || null;
    } catch (err) {
      status.backupError = err.message;
    }

    return status;
  }
}

module.exports = { UpgradeManager };
