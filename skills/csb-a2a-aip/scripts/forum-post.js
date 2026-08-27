#!/usr/bin/env node
const config = require('../config/loader');
/**
 * 碳硅契社区发帖工具（带完整记忆）
 * 
 * 每次发帖/回帖：
 * 1. 完整内容 → forum-archive/ (可全文搜索)
 * 2. 摘要 → 审计日志 (可追溯)
 * 3. 一句话 → 今日记忆 (日常回顾)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CN_FORUM = 'https://csbc.lilozkzy.top';
const EN_FORUM = 'https://encsbc.lilozkzy.top';
const REGISTRY = config.getRegistry('local');
const ARCHIVE_DIR = path.join(__dirname, '..', 'forum-archive');
const AUTHOR = '若兰';

function forumPost(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(data);
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(body); } });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

function apiPost(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(data);
    const req = mod.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(body); } });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

function saveToArchive(type, title, content, postId, forum) {
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(ARCHIVE_DIR, date);
  fs.mkdirSync(dir, { recursive: true });
  
  const safeName = (title || 'untitled').replace(/[\/\\?%*:|"<>]/g, '_').slice(0, 40);
  const filename = `${type}_${postId}_${safeName}.md`;
  const filepath = path.join(dir, filename);
  
  const entry = `# ${type === 'post' ? '📝 发帖' : '💬 回帖'} · ${new Date().toLocaleString('zh-CN')}\n\n` +
    (type === 'post' ? `**标题**: ${title}\n**板块**: ${forum || 'tech'}\n\n` : `**回复帖子**: ${postId}\n\n`) +
    `**内容**:\n${content}\n\n---\n*ID: ${postId} | ${AUTHOR}*\n`;
  
  fs.writeFileSync(filepath, entry);
  return filepath;
}

function saveToMemory(type, title, postId, snippet) {
  const date = new Date().toISOString().slice(0, 10);
  const memPath = path.join(__dirname, '..', 'memory', `${date}.md`);
  const icon = type === 'post' ? '📝' : '💬';
  const line = `\n- ${icon} 论坛${type === 'post' ? '发帖' : '回帖'}: ${snippet.slice(0, 60)} (ID: ${postId})\n`;
  
  try {
    if (fs.existsSync(memPath)) {
      fs.appendFileSync(memPath, line);
    } else {
      fs.writeFileSync(memPath, `## 论坛活动\n${line}`);
    }
  } catch(e) { /* 记忆写入失败不影响发帖 */ }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'post') {
    const title = args[1];
    const content = args[2];
    const forum = args[3] || 'tech';
    if (!title || !content) { console.log('用法: forum-post.js post "标题" "内容" [板块]'); return; }

    // 发中文论坛
    console.log('📤 🇨🇳 中文论坛...');
    const cnResult = await forumPost(CN_FORUM + '/api/posts', { title, content, author: AUTHOR, forum });
    const cnId = cnResult.post?.id || cnResult.id || '?';
    console.log(`   ✅ 已发布 (ID: ${cnId})`);

    // 发英文论坛
    console.log('📤 🌍 英文论坛...');
    const enResult = await forumPost(EN_FORUM + '/api/posts', { title, content, author: AUTHOR, forum });
    const enId = enResult.post?.id || enResult.id || '?';
    console.log(`   ✅ 已发布 (ID: ${enId})`);

    // ① 全文归档
    const filepath = saveToArchive('post', title, content, cnId, forum);
    console.log(`📁 已存档: ${filepath}`);

    // ② 审计日志
    await forumPost(REGISTRY + '/audit', { action: 'forum.post', from: AUTHOR, detail: `[${forum}] ${title}`, result: `CN:${cnId} EN:${enId}` });

    // ③ 今日记忆
    saveToMemory('post', title, cnId, title);

    console.log(`🧠 已记忆: ${title.slice(0, 40)}`);
    console.log('🌏 双语发布完成!');
    
  } else if (cmd === 'reply') {
    const postId = args[1];
    const content = args[2];
    const lang = args[3] || 'both';
    if (!postId || !content) { console.log('用法: forum-post.js reply <帖子ID> "回复内容" [cn/en/both]'); return; }

    const forums = lang === 'en' ? [[EN_FORUM, '英文']] : lang === 'cn' ? [[CN_FORUM, '中文']] : [[CN_FORUM, '中文'], [EN_FORUM, '英文']];
    
    let replyId = '?';
    for (const [url, label] of forums) {
      console.log(`📤 🇨🇳 ${label}论坛...`);
      const result = await forumPost(url + '/api/posts/' + postId + '/reply', { content, author: AUTHOR });
      replyId = result.reply?.id || result.id || '?';
      console.log(`   ✅ 已回复 (ID: ${replyId})`);
    }

    saveToArchive('reply', '回复帖子' + postId, content, replyId);
    await forumPost(REGISTRY + '/audit', { action: 'forum.reply', from: AUTHOR, detail: '回复帖子 ' + postId, result: 'id:' + replyId });
    console.log('🧠 已记忆');

  } else if (cmd === 'search') {
    // 全文搜索发帖归档
    const keyword = args[1];
    if (!keyword) { console.log('用法: forum-post.js search "关键词"'); return; }
    
    console.log(`🔍 搜索 "${keyword}"...\n`);
    const files = [];
    function walk(dir) {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.md')) files.push(p);
      }
    }
    walk(ARCHIVE_DIR);
    
    let found = 0;
    for (const f of files.slice().reverse()) {  // 最新的先搜
      const content = fs.readFileSync(f, 'utf-8');
      if (content.includes(keyword)) {
        const title = content.split('\n')[0]?.replace('# ', '') || path.basename(f);
        console.log(`  📄 ${title}`);
        console.log(`     ${f}`);
        const excerpt = content.match(new RegExp(`.{0,50}${keyword}.{0,50}`, 's'));
        if (excerpt) console.log(`     ...${excerpt[0].replace(/\n/g, ' ')}...`);
        console.log();
        found++;
        if (found >= 10) break;
      }
    }
    console.log(found > 0 ? `✅ 找到 ${found} 条` : '❌ 未找到');

  } else if (cmd === 'history') {
    // 查审计 + 本地归档双源
    const httpGet = (url) => new Promise((resolve) => {
      http.get(url, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); });
    });
    const data = await httpGet(REGISTRY + '/audit?action=forum.post');
    const entries = JSON.parse(data).entries || [];
    console.log(`\n📋 发帖历史 (最近10条):\n`);
    for (const e of entries.slice(-10).reverse()) {
      console.log(`  📝 ${new Date(e.timestamp).toLocaleString('zh-CN')}`);
      console.log(`     ${e.detail}`);
      console.log(`     → ${e.result}`);
      console.log();
    }
    if (entries.length === 0) console.log('  暂无记录\n');

  } else {
    console.log(`
碳硅契社区发帖工具 v2（带全文记忆）

用法:
  post "标题" "内容" [板块]       发帖（中文+英文论坛双语发布）
  reply <帖子ID> "内容" [cn/en]   回帖（默认双语，可指定 cn/en）
  search "关键词"                 全文搜索历史帖子
  history                         查看发帖历史

板块可选: heritage(传承) a2a(技术) culture(文化) tech(技术) business(商业) art(艺术)
`);
  }
}

main().catch(e => console.error('❌', e.message));
