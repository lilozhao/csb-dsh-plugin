#!/usr/bin/env node
/**
 * A2A Skill 文件服务器
 * 提供 skill 文件下载服务，供其他 agent 拉取
 * 
 * 运行: node skill-server.js [port]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SKILL_SERVER_PORT || 3098;
const SKILL_DIR = process.env.SKILL_DIR || '/home/node/.openclaw/workspace/csb-a2a-aip';

// MIME 类型
const MIME_TYPES = {
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.sh': 'application/x-sh',
  '.py': 'text/x-python',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml'
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function sendFile(res, filePath, skillName, version) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '文件不存在', path: filePath }));
    return;
  }

  const mimeType = getMimeType(filePath);
  const stat = fs.statSync(filePath);
  
  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`,
    'X-Skill-Name': skillName,
    'X-Skill-Version': version
  });

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Skill-Name, X-Skill-Version');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

  // GET / - 列出所有可用 skill
  if (pathname === '/' || pathname === '/list') {
    const skills = {};
    
    if (fs.existsSync(SKILL_DIR)) {
      const entries = fs.readdirSync(SKILL_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.js')) {
          const skillName = entry.name.replace('.js', '');
          skills[skillName] = {
            name: skillName,
            files: [entry.name],
            downloadUrl: `http://localhost:${PORT}/download/${skillName}/${entry.name}`
          };
        }
      }
    }

    sendJson(res, {
      success: true,
      server: 'A2A Skill File Server',
      version: '1.0',
      port: PORT,
      skills
    });
    return;
  }

  // GET /download/:skill/:filename - 下载文件
  const downloadMatch = pathname.match(/^\/download\/([^\/]+)\/(.+)$/);
  if (downloadMatch) {
    const [, skillName, filename] = downloadMatch;
    
    // 安全检查：只允许字母数字下划线
    if (!/^[a-zA-Z0-9_-]+$/.test(skillName) || !/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '无效的文件名' }));
      return;
    }

    const filePath = path.join(SKILL_DIR, filename);
    sendFile(res, filePath, skillName, 'latest');
    return;
  }

  // GET /download/:skill/:version/:filename - 下载指定版本文件
  const downloadVMatch = pathname.match(/^\/download\/([^\/]+)\/([^\/]+)\/(.+)$/);
  if (downloadVMatch) {
    const [, skillName, version, filename] = downloadVMatch;
    
    if (!/^[a-zA-Z0-9_-]+$/.test(skillName) || !/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '无效的文件名' }));
      return;
    }

    const filePath = path.join(SKILL_DIR, filename);
    sendFile(res, filePath, skillName, version);
    return;
  }

  // GET /health - 健康检查
  if (pathname === '/health') {
    sendJson(res, { status: 'ok', uptime: process.uptime() });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: '路由不存在', path: pathname }));
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   A2A Skill 文件服务器 v1.0                   ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📡 服务运行在: http://localhost:${PORT}`);
  console.log(`📁 文件目录: ${SKILL_DIR}`);
  console.log('');
  console.log('可用路由:');
  console.log(`  GET /                    - 列出所有 skill`);
  console.log(`  GET /download/:skill/:file - 下载文件`);
  console.log(`  GET /download/:skill/:v/:file - 下载指定版本`);
  console.log(`  GET /health              - 健康检查`);
  console.log('');
});
