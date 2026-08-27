/**
 * A2A 远程命令 - agent.update
 * 允许白名单 Agent 远程更新代码并重启服务
 * 
 * 功能：
 * 1. 备份当前版本
 * 2. 执行 git pull
 * 3. 重启 A2A 服务
 * 4. 健康检查确认更新成功
 * 
 * 安全机制：
 * 1. 白名单验证（只有授权 Agent 能执行）
 * 2. 自动备份
 * 3. 操作审计日志
 * 4. 支持回滚
 * 
 * 风险等级：HIGH
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 白名单：允许执行更新的 Agent
const ALLOWED_AGENTS = ['若兰', 'Ruolan'];

// A2A 服务目录
const A2A_DIR = path.dirname(__dirname);
const PID_FILE = path.join(A2A_DIR, 'server.pid');
const START_SCRIPT = path.join(A2A_DIR, 'start.sh');
const LOG_DIR = path.join(A2A_DIR, 'logs');

/**
 * 执行更新命令
 * @param {Object} params - 命令参数
 * @param {Object} context - 执行上下文（包含 sender 信息）
 * @returns {Promise<Object>}
 */
async function execute(params, context) {
  try {
    // 1. 验证调用者身份
    const senderName = context?.sender?.name || params?.sender;
    if (!ALLOWED_AGENTS.includes(senderName)) {
      return {
        success: false,
        error: `Permission denied: ${senderName} is not allowed to update A2A service`,
        code: 'PERMISSION_DENIED'
      };
    }

    console.log(`[agent.update] 更新请求来自: ${senderName}`);

    // 2. 备份当前版本
    const backupDir = path.join(LOG_DIR, 'update-backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = Date.now();
    const backupPath = path.join(backupDir, `update-${timestamp}`);

    console.log(`[agent.update] 备份到: ${backupPath}`);

    // 复制整个目录到备份
    execSync(`cp -r ${A2A_DIR} ${backupPath}`, { timeout: 30000 });

    // 记录备份信息
    const backupInfo = {
      timestamp: new Date().toISOString(),
      backupPath,
      requestedBy: senderName,
      reason: params?.reason || 'Code update',
      source: params?.source || 'github',
      branch: params?.branch || 'main'
    };

    fs.writeFileSync(
      path.join(backupPath, 'UPDATE_INFO.json'),
      JSON.stringify(backupInfo, null, 2)
    );

    console.log('[agent.update] 备份完成');

    // 3. 执行 git pull
    const source = params?.source || 'github';
    const branch = params?.branch || 'main';

    console.log(`[agent.update] 执行 git pull ${source} ${branch}...`);

    let pullOutput = '';
    try {
      pullOutput = execSync(`git pull ${source} ${branch}`, {
        cwd: A2A_DIR,
        timeout: 60000,
        encoding: 'utf8'
      });
      console.log(`[agent.update] Git pull 输出:\n${pullOutput}`);
    } catch (gitError) {
      console.error('[agent.update] Git pull 失败:', gitError.message);
      
      // Git pull 失败，返回错误信息但保留备份
      return {
        success: false,
        error: `Git pull failed: ${gitError.message}`,
        code: 'GIT_PULL_FAILED',
        backupPath,
        canRollback: true
      };
    }

    // 4. 检查是否有更新
    if (pullOutput.includes('Already up to date')) {
      return {
        success: true,
        message: 'Already up to date, no changes needed',
        backupPath,
        pullOutput: pullOutput.substring(0, 500)
      };
    }

    // 5. 重启服务
    console.log('[agent.update] 重启 A2A 服务...');

    try {
      // 停止旧服务
      if (fs.existsSync(PID_FILE)) {
        const oldPid = fs.readFileSync(PID_FILE, 'utf8').trim();
        try {
          execSync(`kill ${oldPid}`, { timeout: 5000 });
          console.log(`[agent.update] 已停止旧进程: ${oldPid}`);
        } catch (e) {
          console.warn('[agent.update] 停止旧进程失败:', e.message);
        }
      }

      // 等待进程停止
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 启动新服务
      execSync(`bash ${START_SCRIPT}`, {
        cwd: A2A_DIR,
        timeout: 30000,
        encoding: 'utf8'
      });

      console.log('[agent.update] 服务已重启');
    } catch (restartError) {
      console.error('[agent.update] 重启失败:', restartError.message);
      
      return {
        success: false,
        error: `Service restart failed: ${restartError.message}`,
        code: 'RESTART_FAILED',
        backupPath,
        canRollback: true,
        pullOutput: pullOutput.substring(0, 500)
      };
    }

    // 6. 等待服务启动
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 7. 健康检查
    const http = require('http');
    const port = process.env.A2A_PORT || 3100;

    return new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/health',
        method: 'GET',
        timeout: 5000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const healthData = JSON.parse(data);
            console.log(`[agent.update] 健康检查通过: ${healthData.status}`);

            resolve({
              success: true,
              message: 'A2A service updated and restarted successfully',
              backupPath,
              pullOutput: pullOutput.substring(0, 500),
              healthCheck: healthData,
              updated: true
            });
          } catch (e) {
            resolve({
              success: true,
              message: 'A2A service updated (health check parse failed)',
              backupPath,
              pullOutput: pullOutput.substring(0, 500)
            });
          }
        });
      });

      req.on('error', (e) => {
        console.error(`[agent.update] 健康检查失败: ${e.message}`);
        resolve({
          success: false,
          error: `Health check failed after update: ${e.message}`,
          code: 'HEALTH_CHECK_FAILED',
          backupPath,
          canRollback: true,
          pullOutput: pullOutput.substring(0, 500)
        });
      });

      req.end();
    });

  } catch (error) {
    console.error('[agent.update] 执行异常:', error);
    return {
      success: false,
      error: error.message,
      code: 'EXECUTION_ERROR'
    };
  }
}

/**
 * 获取命令元数据
 */
function getMetadata() {
  return {
    name: 'agent.update',
    description: 'Update A2A code from Git and restart service (requires whitelist permission)',
    version: '1.0.0',
    risk: 'high',
    allowedAgents: ALLOWED_AGENTS,
    params: {
      source: {
        type: 'string',
        required: false,
        default: 'github',
        description: 'Git remote name (e.g., github, gitee)'
      },
      branch: {
        type: 'string',
        required: false,
        default: 'main',
        description: 'Git branch to pull'
      },
      reason: {
        type: 'string',
        required: false,
        description: 'Update reason'
      }
    }
  };
}

module.exports = {
  execute,
  getMetadata
};
