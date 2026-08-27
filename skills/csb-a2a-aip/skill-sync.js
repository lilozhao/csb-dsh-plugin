#!/usr/bin/env node
const config = require('./config/loader');
/**
 * A2A Skill Sync 客户端
 * 方案 2：对方主动拉取 - Agent 启动时检查注册表，发现新版本后主动拉取 skill
 * 
 * 使用方式：
 *   node skill-sync.js check [skillName] [currentVersion]
 *   node skill-sync.js pull [skillName] [targetDir]
 *   node skill-sync.js auto [configPath]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');

// 默认配置
const DEFAULT_REGISTRY = config.getRegistry('public');
const DEFAULT_SKILL_SERVER = config.getSkillServer();
const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 每 6 小时检查一次

// ==================== HTTP 请求 ====================

function httpGet(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'User-Agent': 'A2A-Skill-Sync/1.0' }
    };
    
    const req = client.get(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON 解析失败: ${body.substring(0, 100)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

function httpDownload(url, filePath, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname,
      method: 'GET',
      headers: { 'User-Agent': 'A2A-Skill-Sync/1.0' }
    };
    
    const req = client.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 处理重定向
        httpDownload(res.headers.location, filePath, timeout).then(resolve).catch(reject);
        return;
      }
      
      const file = fs.createWriteStream(filePath);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(filePath); });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('下载超时')); });
  });
}

// ==================== 版本比较 ====================

function compareVersion(a, b) {
  const partsA = String(a).replace(/^v/, '').split('.').map(Number);
  const partsB = String(b).replace(/^v/, '').split('.').map(Number);
  
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const pA = partsA[i] || 0;
    const pB = partsB[i] || 0;
    if (pA > pB) return 1;
    if (pA < pB) return -1;
  }
  return 0;
}

// ==================== Skill Sync 核心功能 ====================

class SkillSync {
  constructor(registryUrl = DEFAULT_REGISTRY) {
    this.registryUrl = registryUrl;
    this.localVersions = {};
    this.loadLocalVersions();
  }

  // 加载本地 skill 版本信息
  loadLocalVersions() {
    const versionFile = path.join(process.cwd(), 'skill-versions.json');
    try {
      if (fs.existsSync(versionFile)) {
        this.localVersions = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      }
    } catch (e) {
      console.warn('加载本地版本文件失败:', e.message);
    }
  }

  // 保存本地 skill 版本信息
  saveLocalVersions() {
    const versionFile = path.join(process.cwd(), 'skill-versions.json');
    fs.writeFileSync(versionFile, JSON.stringify(this.localVersions, null, 2));
  }

  // 检查单个 skill 是否有新版本
  async checkSkill(skillName) {
    const currentVersion = this.localVersions[skillName] || '0.0.0';
    
    try {
      const result = await httpGet(`${this.registryUrl}/skill-upgrade/check?skillName=${skillName}&currentVersion=${currentVersion}`);
      
      if (result.hasNew) {
        console.log(`📦 ${skillName}: ${result.currentVersion} → v${result.latestVersion} (有新版本!)`);
        return {
          hasNew: true,
          skillName,
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          downloadUrl: result.downloadUrl,
          changelog: result.changelog
        };
      } else {
        console.log(`✅ ${skillName}: v${currentVersion} (已是最新)`);
        return { hasNew: false, skillName, currentVersion };
      }
    } catch (e) {
      console.error(`❌ 检查 ${skillName} 失败:`, e.message);
      return { hasNew: false, skillName, error: e.message };
    }
  }

  // 检查所有注册的 skill 是否有新版本
  async checkAll(skills = null) {
    let skillList = skills;
    
    if (!skillList) {
      // 从注册表获取所有技能列表
      try {
        const result = await httpGet(`${this.registryUrl}/skill-upgrade/list`);
        skillList = Object.keys(result.skills || {});
      } catch (e) {
        console.error('获取技能列表失败:', e.message);
        return [];
      }
    }
    
    console.log(`\n🔍 检查 ${skillList.length} 个技能...\n`);
    
    const results = [];
    for (const skillName of skillList) {
      const result = await this.checkSkill(skillName);
      results.push(result);
      await new Promise(r => setTimeout(r, 300)); // 避免请求过快
    }
    
    return results;
  }

  // 拉取单个 skill 最新版本
  async pullSkill(skillName, targetDir = null) {
    const targetPath = targetDir || path.join(process.cwd(), 'skills', skillName);
    
    // 先检查最新版本
    try {
      const result = await httpGet(`${this.registryUrl}/skill-upgrade/latest/${skillName}`);
      
      console.log(`\n📥 开始拉取 ${skillName} v${result.version}...`);
      console.log(`   描述: ${result.description || '无'}`);
      if (result.changelog) console.log(`   更新: ${result.changelog}`);
      
      // 创建目标目录
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }
      
      // 下载文件列表
      if (result.files && result.files.length > 0) {
        for (const file of result.files) {
          const fileName = path.basename(file);
          const filePath = path.join(targetPath, fileName);
          console.log(`   📄 下载 ${fileName}...`);
          
          try {
            await httpDownload(file, filePath);
            console.log(`      ✅ ${fileName}`);
          } catch (e) {
            console.log(`      ❌ ${fileName}: ${e.message}`);
          }
        }
      }
      
      // 更新本地版本
      this.localVersions[skillName] = result.version;
      this.saveLocalVersions();
      
      console.log(`\n✅ ${skillName} v${result.version} 拉取完成!`);
      
      return { success: true, version: result.version, path: targetPath };
    } catch (e) {
      console.error(`❌ 拉取 ${skillName} 失败:`, e.message);
      return { success: false, error: e.message };
    }
  }

  // 自动检查并拉取所有可升级的 skill
  async autoSync(skills = null) {
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║       A2A Skill Sync 自动同步                  ║');
    console.log('╚════════════════════════════════════════════════╝\n');
    
    const results = await this.checkAll(skills);
    const upgradable = results.filter(r => r.hasNew);
    
    if (upgradable.length === 0) {
      console.log('\n✨ 所有技能都已是最新版本!');
      return results;
    }
    
    console.log(`\n📦 发现 ${upgradable.length} 个可升级的技能\n`);
    
    for (const item of upgradable) {
      await this.pullSkill(item.skillName);
      await new Promise(r => setTimeout(r, 500));
    }
    
    console.log('\n🎉 自动同步完成!');
    return results;
  }

  // 注册当前 skill 版本到注册表（发布者调用）
  async publish(skillName, version, info = {}) {
    try {
      const result = await fetch(`${this.registryUrl}/skill-upgrade/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillName,
          version,
          description: info.description || '',
          changelog: info.changelog || '',
          files: info.files || [],
          publishedBy: info.publishedBy || 'unknown'
        })
      }).then(r => r.json());
      
      if (result.success) {
        console.log(`✅ ${skillName} v${version} 已发布到注册表`);
        // 同时启动本地文件服务器供下载
        this.startFileServer(info.files || []);
      }
      
      return result;
    } catch (e) {
      console.error(`❌ 发布 ${skillName} 失败:`, e.message);
      return { success: false, error: e.message };
    }
  }

  // 启动简易文件服务器供其他 agent 下载
  startFileServer(files = []) {
    // 文件服务器在 3098 端口，由 skill-server.js 提供
    console.log(`📡 文件服务器运行在 ${DEFAULT_SKILL_SERVER}`);
  }
}

// ==================== CLI 入口 ====================

const args = process.argv.slice(2);
const command = args[0] || 'help';
const param1 = args[1];
const param2 = args[2];

const sync = new SkillSync();

async function main() {
  switch (command) {
    case 'check':
      // 检查单个或所有 skill
      // node skill-sync.js check [skillName] [currentVersion]
      if (param1) {
        const currentVersion = param2 || sync.localVersions[param1];
        await sync.checkSkill(param1);
      } else {
        await sync.checkAll();
      }
      break;

    case 'pull':
      // 拉取单个 skill
      // node skill-sync.js pull <skillName> [targetDir]
      if (param1) {
        await sync.pullSkill(param1, param2);
      } else {
        console.log('用法: node skill-sync.js pull <skillName> [targetDir]');
      }
      break;

    case 'auto':
      // 自动检查并拉取所有可升级的 skill
      // node skill-sync.js auto [skill1,skill2,...]
      const skills = param1 ? param1.split(',') : null;
      await sync.autoSync(skills);
      break;

    case 'publish':
      // 发布 skill 新版本（需要配合 skill-server.js）
      // node skill-sync.js publish <skillName> <version> [files...]
      if (param1 && param2) {
        const files = args.slice(3);
        await sync.publish(param1, param2, { files });
      } else {
        console.log('用法: node skill-sync.js publish <skillName> <version> [files...]');
      }
      break;

    case 'serve':
      // 启动 skill 文件服务器（3098端口）
      // node skill-sync.js serve [port]
      const port = parseInt(param1) || 3098;
      console.log(`📡 启动 Skill 文件服务器在端口 ${port}...`);
      console.log(`   下载地址: http://localhost:${port}/download/<skill>/<version>`);
      // 文件服务器需要单独实现，这里只是提示
      break;

    default:
      console.log(`
╔═══════════════════════════════════════════════════════════╗
║           A2A Skill Sync 客户端 v1.0                      ║
╠═══════════════════════════════════════════════════════════╣
║  方案 2：对方主动拉取 - Agent 启动时检查注册表           ║
║  发现新版本后主动拉取 skill                               ║
╠═══════════════════════════════════════════════════════════╣
║  用法:                                                    ║
║    node skill-sync.js check [skillName] [version]        ║
║      检查指定 skill 或所有 skill 是否有新版本             ║
║                                                            ║
║    node skill-sync.js pull <skillName> [targetDir]       ║
║      拉取指定 skill 最新版本                              ║
║                                                            ║
║    node skill-sync.js auto [skill1,skill2,...]           ║
║      自动检查并拉取所有可升级的 skill                     ║
║                                                            ║
║    node skill-sync.js publish <skill> <version> [files]  ║
║      发布 skill 新版本到注册表（发布者用）                ║
║                                                            ║
║  环境变量:                                                 ║
║    REGISTRY_URL   注册表地址 (默认: ${DEFAULT_REGISTRY})
║    SKILL_SERVER   Skill 文件服务器 (默认: ${DEFAULT_SKILL_SERVER})
╚═══════════════════════════════════════════════════════════╝
      `);
  }
}

main().catch(console.error);

// 导出类供其他模块使用
module.exports = { SkillSync, DEFAULT_REGISTRY, DEFAULT_SKILL_SERVER };
