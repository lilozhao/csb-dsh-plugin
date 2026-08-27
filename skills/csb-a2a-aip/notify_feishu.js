#!/usr/bin/env node
/**
 * 发送 A2A 对话到飞书群
 * 让宏伟可以观察若兰和阿轩的对话
 */

const https = require('https');

// 飞书配置 - 请通过环境变量设置
const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK_URL;
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'cli_a91c57cddd38dcd4';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '1sCYfsC4c6kvXJQURQuD1lkLNzitWQyD';
const FEISHU_GROUP_ID = process.env.FEISHU_GROUP_ID || 'oc_4427768d0798b7545d4fb07b7518e710';

let cachedAccessToken = null;
let tokenExpireTime = 0;

/**
 * 获取飞书 access_token
 */
async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpireTime) {
    return cachedAccessToken;
  }

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    });

    const options = {
      hostname: 'open.feishu.cn',
      port: 443,
      path: '/open-apis/auth/v3/tenant_access_token/internal',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.tenant_access_token) {
            cachedAccessToken = result.tenant_access_token;
            tokenExpireTime = Date.now() + (result.expire - 60) * 1000; // 提前60秒过期
            resolve(cachedAccessToken);
          } else {
            reject(new Error('获取 token 失败: ' + body));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * 发送消息到飞书群
 */
async function sendToFeishu(title, content) {
  try {
    const accessToken = await getAccessToken();

    // 使用简单文本消息格式
    const data = JSON.stringify({
      receive_id: FEISHU_GROUP_ID,
      content: JSON.stringify({
        text: `【${title}】\n${content}`,
      }),
      msg_type: 'text',
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'open.feishu.cn',
        port: 443,
        path: `/open-apis/im/v1/messages?receive_id_type=chat_id`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            if (result.code === 0) {
              resolve(result);
            } else {
              console.error('飞书发送失败:', body);
              reject(new Error('发送失败: ' + body));
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  } catch (error) {
    console.error('发送飞书消息失败:', error.message);
    throw error;
  }
}

// CLI 使用
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法: node notify_feishu.js <title> <content>');
    console.log('   或: node notify_feishu.js --from <sender> --to <receiver> --message <message>');
    process.exit(1);
  }

  // 支持两种格式
  if (args[0] === '--from') {
    // 格式: --from 若兰 --to 阿轩 --message "你好"
    const params = {};
    for (let i = 0; i < args.length; i += 2) {
      if (args[i].startsWith('--')) {
        params[args[i].slice(2)] = args[i + 1];
      }
    }
    
    // 美化发送者名称显示
    const fromName = params.from || 'Unknown';
    const toName = params.to || 'Unknown';
    
    const title = `🤖 A2A: ${fromName} → ${toName}`;
    const content = `${params.message || ''}`;
    
    await sendToFeishu(title, content);
    console.log('已发送到飞书群');
  } else {
    // 格式: <title> <content>
    const title = args[0];
    const content = args[1];
    await sendToFeishu(title, content);
    console.log('已发送到飞书群');
  }
}

module.exports = { sendToFeishu, getAccessToken };

if (require.main === module) {
  main().catch(console.error);
}