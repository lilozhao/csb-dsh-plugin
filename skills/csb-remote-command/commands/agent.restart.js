/**
 * A2A 远程命令 - agent.restart
 * 允许白名单 Agent 远程重启 A2A 服务
 * 
 * 安全机制：
 * 1. 白名单验证（只有授权 Agent 能执行）
 * 2. 自动备份当前状态
 * 3. 操作审计日志
 * 4. 健康检查确认重启成功
 * 
 * 风险等级：HIGH
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// 白名单：允许执行重启的 Agent
const ALLOWED_AGENTS = ['若兰', 'Ruolan'];

// A2A 服务目录
const A2A_DIR = path.dirname(__dirname);
const PID_FILE = path.join(A2A_DIR, 'server.pid');
const START_SCRIPT = path.join(A2A_DIR, 'start.sh');
const LOG_DIR = path.join(A2A_DIR, 'logs');

/**
 * 执行重启命令
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
        error: `Permission denied: ${senderName} is not allowed to restart A2A service`,
        code: 'PERMISSION_DENIED'
      };
    }

    console.log(`[agent.restart] 重启请求来自: ${senderName}`);

    // 2. 备份当前 PID
    let oldPid = null;
    if (fs.existsSync(PID_FILE)) {
      oldPid = fs.readFileSync(PID_FILE, 'utf8').trim();
      console.log(`[agent.restart] 当前 PID: ${oldPid}`);
    }

    // 3. 创建备份目录
    const backupDir = path.join(LOG_DIR, 'restart-backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupFile = path.join(backupDir, `restart-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      oldPid,
      requestedBy: senderName,
      reason: params?.reason || 'Manual restart'
    }, null, 2));

    console.log(`[agent.restart] 备份已保存: ${backupFile}`);

    // 4. 执行重启
    return new Promise((resolve) => {
      console.log('[agent.restart] 开始重启 A2A 服务...');

      exec(`bash ${START_SCRIPT}`, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          console.error(`[agent.restart] 重启失败: ${error.message}`);
          resolve({
            success: false,
            error: `Restart failed: ${error.message}`,
            code: 'RESTART_FAILED',
            oldPid,
            backupFile
          });
          return;
        }

        // 5. 等待服务启动
        setTimeout(() => {
          // 6. 读取新 PID
          let newPid = null;
          if (fs.existsSync(PID_FILE)) {
            newPid = fs.readFileSync(PID_FILE, 'utf8').trim();
          }

          // 7. 健康检查
          const http = require('http');
          const port = process.env.A2A_PORT || 3100;

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
                console.log(`[agent.restart] 健康检查通过: ${healthData.status}`);

                resolve({
                  success: true,
                  message: 'A2A service restarted successfully',
                  oldPid,
                  newPid,
                  healthCheck: healthData,
                  backupFile,
                  stdout: stdout.substring(0, 500)
                });
              } catch (e) {
                resolve({
                  success: true,
                  message: 'A2A service restarted (health check response parse failed)',
                  oldPid,
                  newPid,
                  backupFile
                });
              }
            });
          });

          req.on('error', (e) => {
            console.error(`[agent.restart] 健康检查失败: ${e.message}`);
            resolve({
              success: false,
              error: `Health check failed after restart: ${e.message}`,
              code: 'HEALTH_CHECK_FAILED',
              oldPid,
              newPid,
              backupFile
            });
          });

          req.end();
        }, 3000); // 等待 3 秒让服务启动
      });
    });

  } catch (error) {
    console.error('[agent.restart] 执行异常:', error);
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
    name: 'agent.restart',
    description: 'Restart A2A service (requires whitelist permission)',
    version: '1.0.0',
    risk: 'high',
    allowedAgents: ALLOWED_AGENTS,
    params: {
      reason: {
        type: 'string',
        required: false,
        description: 'Restart reason'
      }
    }
  };
}

module.exports = {
  execute,
  getMetadata
};
