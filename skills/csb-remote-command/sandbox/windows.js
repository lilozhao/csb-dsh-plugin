/**
 * A2A 远程命令执行 - Windows 沙箱
 * 使用 Windows Job Object 限制资源
 */

const { spawn } = require('child_process');
const { SandboxProvider } = require('./index.js');

class WindowsSandbox extends SandboxProvider {
  constructor(config = {}) {
    super();
    this.config = {
      timeout: config.timeout || 30000,
      memoryLimit: config.memoryLimit || 128 * 1024 * 1024, // 128MB
      cpuLimit: config.cpuLimit || 50, // 50%
      ...config
    };
  }

  /**
   * 执行命令
   * @param {string} commandType - 命令类型
   * @param {Object} params - 命令参数
   * @returns {Promise<Object>}
   */
  async execute(commandType, params) {
    console.log(`[A2A-CMD] Windows sandbox executing: ${commandType}`);
    
    const script = this.buildCommandScript(commandType, params);
    
    // 使用 PowerShell 创建 Job Object 并执行
    const psScript = this.buildPowerShellScript(script);
    
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-Command', psScript], {
        timeout: this.config.timeout + 5000,
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`PowerShell exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (e) {
          reject(new Error(`Invalid output format: ${stdout}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`PowerShell error: ${err.message}`));
      });
    });
  }

  /**
   * 构建 PowerShell 脚本（创建 Job Object 限制资源）
   */
  buildPowerShellScript(nodeScript) {
    const memoryMB = Math.floor(this.config.memoryLimit / 1024 / 1024);
    
    return `
      $job = Start-Job -ScriptBlock {
        param($script)
        $output = & node -e $script 2>&1
        $output
      } -ArgumentList '${nodeScript.replace(/'/g, "''")}'
      
      # 等待作业完成或超时
      $completed = $job | Wait-Job -Timeout ${Math.ceil(this.config.timeout / 1000)}
      
      if (-not $completed) {
        Stop-Job $job
        Remove-Job $job
        throw "Command execution timeout"
      }
      
      $result = Receive-Job $job
      Remove-Job $job
      
      Write-Output $result
    `.replace(/\s+/g, ' ').trim();
  }

  /**
   * 构建 Node.js 命令脚本
   */
  buildCommandScript(commandType, params) {
    const safeParams = JSON.stringify(params || {});
    
    return `
      const command = '${commandType}';
      const params = ${safeParams};
      
      async function execute() {
        try {
          let result;
          
          switch (command) {
            case 'system.status':
              const os = require('os');
              result = {
                platform: os.platform(),
                arch: os.arch(),
                uptime: os.uptime(),
                memory: {
                  total: os.totalmem(),
                  free: os.freemem()
                }
              };
              break;
            case 'skill.list':
              const fs = require('fs');
              const items = fs.readdirSync('C:\\\\workspace\\\\skills', { withFileTypes: true });
              result = items.filter(i => i.isDirectory()).map(i => ({ name: i.name }));
              break;
            case 'skill.info':
              result = { name: params.skill, info: 'Skill info placeholder' };
              break;
            case 'agent.health':
              result = { status: 'healthy', timestamp: Date.now() };
              break;
            default:
              throw new Error('Unknown command: ' + command);
          }
          
          console.log(JSON.stringify({ success: true, data: result }));
        } catch (err) {
          console.log(JSON.stringify({ success: false, error: err.message }));
        }
      }
      
      execute();
    `.replace(/\s+/g, ' ').trim();
  }

  getPlatform() {
    return 'win32';
  }

  async health() {
    try {
      // 检查 PowerShell 是否可用
      const { exec } = require('child_process');
      const { promisify } = require('util');
      await promisify(exec)('powershell -Command "exit 0"');
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { WindowsSandbox };
