/**
 * A2A 远程命令 - system.status
 * 获取系统状态信息
 */

const os = require('os');

async function execute(params) {
  try {
    const result = {
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime(),
      loadavg: os.loadavg(),
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      },
      cpus: os.cpus().length,
      hostname: os.hostname(),
      timestamp: Date.now()
    };

    return {
      success: true,
      data: result
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = { execute };
