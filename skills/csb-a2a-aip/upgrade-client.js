#!/usr/bin/env node
const config = require('./config/loader');
/**
 * A2A 升级客户端
 * 用于通过 A2A 协议升级其他 Agent
 * 
 * 使用方法：
 *   node upgrade-client.js <agent-url> [options]
 *   
 * 示例：
 *   node upgrade-client.js http://172.28.0.5:3200 --source gitee
 *   node upgrade-client.js http://172.28.0.5:3200 --check-status
 */

const http = require('http');
const https = require('https');

// 解析参数
const args = process.argv.slice(2);
const targetUrl = args[0];

if (!targetUrl) {
  console.log('使用方法: node upgrade-client.js <agent-url> [options]');
  console.log('');
  console.log('选项:');
  console.log('  --check-status    检查升级状态');
  console.log('  --source gitee    从 Gitee 拉取升级');
  console.log('  --dry-run         模拟升级（不实际执行）');
  console.log('  --rollback        回滚到上一个版本');
  console.log('');
  console.log('示例:');
  console.log('  node upgrade-client.js http://172.28.0.5:3200 --check-status');
  console.log('  node upgrade-client.js http://172.28.0.5:3200 --source gitee');
  process.exit(1);
}

// 解析选项
const options = {
  checkStatus: args.includes('--check-status'),
  source: args.includes('--source') ? args[args.indexOf('--source') + 1] : 'gitee',
  dryRun: args.includes('--dry-run'),
  rollback: args.includes('--rollback')
};

// 发送 HTTP 请求
function sendRequest(url, method, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      requestOptions.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }

    const req = httpModule.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// 主函数
async function main() {
  console.log(`🎯 目标 Agent: ${targetUrl}`);
  console.log('');

  try {
    // 1. 检查状态
    if (options.checkStatus) {
      console.log('📊 检查升级状态...');
      const status = await sendRequest(`${targetUrl}/upgrade/status`, 'GET');
      
      console.log('');
      console.log('## 升级状态');
      console.log(`- 当前版本: ${status.currentVersion || '未知'}`);
      console.log(`- 可升级文件: ${status.upgradableFiles?.join(', ') || '无'}`);
      console.log(`- 备份数量: ${status.backupCount || 0}`);
      console.log(`- 最新备份: ${status.lastBackup || '无'}`);
      return;
    }

    // 2. 回滚
    if (options.rollback) {
      console.log('🔄 执行回滚...');
      const result = await sendRequest(`${targetUrl}/upgrade/rollback`, 'POST');
      
      console.log('');
      console.log('## 回滚结果');
      console.log(`- 状态: ${result.success ? '✅ 成功' : '❌ 失败'}`);
      console.log(`- 使用备份: ${result.backupUsed || '无'}`);
      
      if (result.actions?.length > 0) {
        console.log('- 操作记录:');
        result.actions.forEach(action => console.log(`  • ${action}`));
      }
      
      if (result.errors?.length > 0) {
        console.log('- 错误信息:');
        result.errors.forEach(error => console.log(`  • ${error}`));
      }
      return;
    }

    // 3. 执行升级
    console.log(`🚀 发起升级...`);
    console.log(`- 来源: ${options.source}`);
    console.log(`- 模拟: ${options.dryRun ? '是' : '否'}`);
    console.log('');

    const upgradePayload = {
      version: 'latest',
      source: options.source,
      files: [],
      options: {
        dryRun: options.dryRun,
        skipBackup: false
      }
    };

    const result = await sendRequest(`${targetUrl}/upgrade/perform`, 'POST', upgradePayload);

    console.log('## 升级结果');
    console.log(`- 状态: ${result.success ? '✅ 成功' : '❌ 失败'}`);
    console.log(`- 时间: ${result.timestamp || '未知'}`);

    if (result.actions?.length > 0) {
      console.log('- 操作记录:');
      result.actions.forEach(action => console.log(`  • ${action}`));
    }

    if (result.errors?.length > 0) {
      console.log('- 错误信息:');
      result.errors.forEach(error => console.log(`  • ${error}`));
    }

    if (result.healthCheck) {
      console.log('- 健康检查:');
      console.log(`  • 名称: ${result.healthCheck.name}`);
      console.log(`  • 版本: ${result.healthCheck.version}`);
      console.log(`  • LLM: ${result.healthCheck.llm}`);
    }

    // 4. 验证升级
    if (result.success && !options.dryRun) {
      console.log('');
      console.log('🔍 验证升级...');
      
      // 等待 2 秒让服务完全启动
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const health = await sendRequest(`${targetUrl}/health`, 'GET');
      console.log(`- 服务状态: ${health.status}`);
      console.log(`- 运行版本: ${health.version}`);
    }

  } catch (err) {
    console.error('❌ 错误:', err.message);
    process.exit(1);
  }
}

main();
