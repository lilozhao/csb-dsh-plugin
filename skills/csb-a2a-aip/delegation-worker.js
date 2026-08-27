#!/usr/bin/env node
const config = require('./config/loader');
/**
 * CSB Delegation Worker — 委托任务执行代理
 * 
 * 监听 A2A 消息中的委托任务，自动执行对应的 shell 命令。
 * 让受托 Agent 真正执行操作，而不是只回复"收到"。
 * 
 * 使用方式：
 *   node delegation-worker.js               # 启动监听
 *   node delegation-worker.js --once        # 执行一次后退出
 * 
 * 配置：
 *   在 .env 中设置：
 *   DELEGATION_WORK_DIR=/path/to/workdir
 *   FORUM_API_BASE=https://csbc.lilozkzy.top
 */

const http = require('http');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REGISTRY = process.env.REGISTRY_URL || config.getRegistry('local');
const MY_NAME = process.env.AGENT_NAME || '阿轩 🔧';
const POLL_INTERVAL = process.env.POLL_INTERVAL || 15000; // 15秒

// ── 委托类型与对应的执行命令 ─────────────────────────
const DELEGATE_HANDLERS = {
  'reply': {
    match: (text) => {
      // 匹配：回帖 / 回复帖子 / reply to post
      const m = text.match(/帖子[ID:\s]*(\d+)/i) || text.match(/post[#\s]*(\d+)/i) || text.match(/thread[#\s]*(\d+)/i);
      return m ? { postId: m[1] } : null;
    },
    execute: async (ctx) => {
      const content = `🦊 ${ctx.content || '委托任务回复'}`;
      const cmd = `curl -s -X POST ${ctx.forumUrl}/api/posts/${ctx.postId}/reply -H "Content-Type: application/json" -d '{"content": "${content.replace(/'/g, "\\'")}","author": "${MY_NAME}"}'`;
      const result = execSync(cmd, { timeout: 15000, encoding: 'utf-8' });
      return JSON.parse(result);
    }
  },
  'post': {
    match: (text) => {
      const m = text.match(/发帖/) || text.match(/发布帖子/) || text.match(/post a (thread|topic)/i);
      return m ? { title: extractTitle(text), content: extractContent(text) } : null;
    },
    execute: async (ctx) => {
      const cmd = `curl -s -X POST ${ctx.forumUrl}/api/posts -H "Content-Type: application/json" -d '{"title": "${(ctx.title || '委托发帖').replace(/'/g, "\\'")}","content": "${(ctx.content || '委托内容').replace(/'/g, "\\'")}","author": "${MY_NAME}"}'`;
      const result = execSync(cmd, { timeout: 15000, encoding: 'utf-8' });
      return JSON.parse(result);
    }
  },
  'query': {
    match: (text) => {
      const m = text.match(/查询/) || text.match(/查.*数据/) || text.match(/query/i);
      return m ? true : null;
    },
    execute: async (ctx) => {
      // 查询类：委托方提供具体命令
      if (ctx.command) {
        return execSync(ctx.command, { timeout: 10000, encoding: 'utf-8' }).trim();
      }
      return '请提供具体查询命令';
    }
  }
};

function extractTitle(text) {
  const m = text.match(/标题[：:]\s*(.+?)[\n,]/);
  return m ? m[1].trim() : '';
}

function extractContent(text) {
  const m = text.match(/内容[：:]\s*([\s\S]+)/);
  return m ? m[1].trim() : text;
}

async function checkDelegations() {
  try {
    // 通过注册表获取给自己的消息
    const data = await httpGet(`${REGISTRY}/messages/pending/${encodeURIComponent(MY_NAME)}`);
    const messages = Array.isArray(data) ? data : (data.messages || []);
    
    for (const msg of messages) {
      const text = (msg.content || msg.text || '').toLowerCase();
      const original = msg.content || msg.text || '';
      
      // 匹配委托类型
      for (const [type, handler] of Object.entries(DELEGATE_HANDLERS)) {
        const ctx = handler.match(text);
        if (ctx) {
          console.log(`[委托] 检测到 ${type} 任务:`, original.substring(0, 100));
          
          // 记录审计
          await httpPost(`${REGISTRY}/audit`, {
            action: `delegate.${type}`,
            from: msg.sender || 'unknown',
            to: MY_NAME,
            detail: original.substring(0, 200),
            result: 'in_progress'
          });
          
          // 执行
          try {
            const result = await handler.execute({ ...ctx, forumUrl: 'https://csbc.lilozkzy.top', content: original });
            console.log(`[委托] ✅ ${type} 执行成功:`, JSON.stringify(result).substring(0, 100));
            
            await httpPost(`${REGISTRY}/audit`, {
              action: `delegate.${type}`,
              from: msg.sender || 'unknown',
              to: MY_NAME,
              detail: original.substring(0, 200),
              result: 'success'
            });
          } catch (e) {
            console.error(`[委托] ❌ ${type} 执行失败:`, e.message);
            await httpPost(`${REGISTRY}/audit`, {
              action: `delegate.${type}`,
              from: msg.sender || 'unknown',
              to: MY_NAME,
              detail: original.substring(0, 200),
              result: `failed: ${e.message}`
            });
          }
          
          // ACK
          await httpPost(`${REGISTRY}/messages/ack`, { messageId: msg.id });
          break;
        }
      }
    }
  } catch (e) {
    // 静默处理轮询错误
  }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    http.get({ hostname: u.hostname, port: u.port, path: u.pathname, timeout: 5000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    }).on('error', reject);
  });
}

function httpPost(url, data) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname,
      method: 'POST', timeout: 5000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); });
    req.on('error', () => resolve(null));
    req.write(payload); req.end();
  });
}

// ── 主循环 ─────────────────────────────────────────
async function main() {
  const once = process.argv.includes('--once');
  
  console.log(`\n🤖 CSB Delegation Worker`);
  console.log(`   Agent: ${MY_NAME}`);
  console.log(`   注册表: ${REGISTRY}`);
  console.log(`   轮询间隔: ${POLL_INTERVAL}ms\n`);
  
  if (once) {
    await checkDelegations();
    console.log('[委托] 单次检查完成');
    return;
  }
  
  console.log('[委托] 开始轮询委托任务...');
  setInterval(checkDelegations, POLL_INTERVAL);
}

main().catch(console.error);
