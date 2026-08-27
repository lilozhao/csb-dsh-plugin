/**
 * A2A 远程命令执行 - Linux Docker 沙箱
 * 使用 Docker 容器隔离
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const { SandboxProvider } = require('./index.js');

const execAsync = promisify(exec);

class LinuxSandbox extends SandboxProvider {
  constructor(config = {}) {
    super();
    this.config = {
      image: config.image || 'node:18-alpine',
      memory: config.memory || '128m',
      cpus: config.cpus || '0.5',
      timeout: config.timeout || 30000,
      network: config.network || 'none',
      autoRemove: true,
      readOnly: true,
      ...config
    };
    
    this.dockerAvailable = null;
  }

  /**
   * 检查 Docker 是否可用
   */
  async checkDocker() {
    if (this.dockerAvailable !== null) {
      return this.dockerAvailable;
    }

    try {
      await execAsync('docker --version');
      this.dockerAvailable = true;
      console.log('[A2A-CMD] Docker is available');
    } catch (e) {
      console.warn('[A2A-CMD] Docker not available, falling back to process sandbox');
      this.dockerAvailable = false;
    }

    return this.dockerAvailable;
  }

  /**
   * 执行命令
   * @param {string} commandType - 命令类型
   * @param {Object} params - 命令参数
   * @returns {Promise<Object>}
   */
  async execute(commandType, params) {
    const dockerAvailable = await this.checkDocker();
    
    if (!dockerAvailable) {
      // 回退到进程沙箱
      return this.executeWithProcess(commandType, params);
    }

    return this.executeWithDocker(commandType, params);
  }

  /**
   * 使用 Docker 执行
   */
  async executeWithDocker(commandType, params) {
    const containerId = `a2a-cmd-${crypto.randomBytes(8).toString('hex')}`;
    
    const dockerArgs = this.buildDockerArgs(containerId);
    const script = this.buildCommandScript(commandType, params);
    
    const cmd = `docker run ${dockerArgs} ${this.config.image} node -e "${script}"`;

    console.log(`[A2A-CMD] Docker execute: ${commandType}`);

    return new Promise((resolve, reject) => {
      const child = exec(cmd, { 
        timeout: this.config.timeout + 5000,
        maxBuffer: 1024 * 1024  // 1MB output limit
      }, (error, stdout, stderr) => {
        if (error) {
          if (error.killed || error.signal === 'SIGTERM') {
            reject(new Error('Command execution timeout'));
          } else {
            reject(new Error(`Docker execution failed: ${error.message}`));
          }
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (e) {
          reject(new Error(`Invalid output format: ${stdout}`));
        }
      });
    });
  }

  /**
   * 使用进程沙箱执行（Docker 不可用时）
   */
  async executeWithProcess(commandType, params) {
    const { spawn } = require('child_process');
    
    const script = this.buildCommandScript(commandType, params);
    
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['-e', script], {
        timeout: this.config.timeout,
        detached: false
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
          reject(new Error(`Process exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (e) {
          reject(new Error(`Invalid output format: ${stdout}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Process error: ${err.message}`));
      });
    });
  }

  /**
   * 构建 Docker 参数
   */
  buildDockerArgs(containerId) {
    const args = [
      `--name ${containerId}`,
      `-m ${this.config.memory}`,
      `--cpus ${this.config.cpus}`,
      `--network ${this.config.network}`,
      '--rm'
    ];

    if (this.config.readOnly) {
      args.push('--read-only');
    }

    // 挂载只读卷
    args.push('-v /home/node/.openclaw/workspace:/workspace:ro');

    // 安全选项
    args.push('--security-opt no-new-privileges:true');

    return args.join(' ');
  }

  /**
   * 构建命令脚本
   */
  buildCommandScript(commandType, params) {
    // 安全地序列化参数
    const safeParams = JSON.stringify(params || {});
    
    return `
      const command = '${commandType}';
      const params = ${safeParams};
      
      async function execute() {
        try {
          let result;
          
          switch (command) {
            case 'system.status':
              result = await getSystemStatus(params);
              break;
            case 'skill.list':
              result = await getSkillList(params);
              break;
            case 'skill.info':
              result = await getSkillInfo(params);
              break;
            case 'agent.health':
              result = await getAgentHealth(params);
              break;
            default:
              throw new Error('Unknown command: ' + command);
          }
          
          console.log(JSON.stringify({ success: true, data: result }));
        } catch (err) {
          console.log(JSON.stringify({ success: false, error: err.message }));
        }
      }
      
      async function getSystemStatus() {
        const os = require('os');
        return {
          platform: os.platform(),
          arch: os.arch(),
          uptime: os.uptime(),
          loadavg: os.loadavg(),
          memory: {
            total: os.totalmem(),
            free: os.freemem()
          },
          cpus: os.cpus().length
        };
      }
      
      async function getSkillList() {
        const fs = require('fs');
        const path = '/workspace/skills';
        
        try {
          const items = fs.readdirSync(path, { withFileTypes: true });
          return items
            .filter(item => item.isDirectory())
            .map(item => ({ name: item.name }));
        } catch (e) {
          return { error: 'Cannot read skills directory' };
        }
      }
      
      async function getSkillInfo(params) {
        const fs = require('fs');
        const path = '/workspace/skills/' + params.skill + '/SKILL.md';
        
        try {
          const content = fs.readFileSync(path, 'utf8');
          return { name: params.skill, readme: content.substring(0, 500) };
        } catch (e) {
          return { error: 'Skill not found: ' + params.skill };
        }
      }
      
      async function getAgentHealth() {
        return {
          status: 'healthy',
          timestamp: Date.now()
        };
      }
      
      execute();
    `.replace(/\s+/g, ' ').trim();
  }

  getPlatform() {
    return 'linux';
  }

  async health() {
    try {
      await execAsync('docker ps');
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { LinuxSandbox };
