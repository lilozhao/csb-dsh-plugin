#!/usr/bin/env node
/**
 * gen-identity.js — 生成/同步本 Agent 的 CSB 身份（薄封装，身份先行）
 *
 * 一切以 agent.json(name/slug/port/publicHost/llm) 为唯一数据源:
 *   - 缺失文件自动生成(密钥对 + AID + 握手/LLM env + identity.json)
 *   - 与 agent.json 不一致时自动同步(改名只改 agent.json,重跑本脚本即可)
 *
 * 用法: node <插件>/scripts/gen-identity.js
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginLib = join(dirname(dirname(fileURLToPath(import.meta.url))), 'lib', 'index.js');

import(pluginLib)
  .then((m) => {
    const created = m.provisionIdentityFiles();
    if (created.length === 0) {
      console.log('✅ 身份已就绪且与 agent.json 一致,无需变更');
      return;
    }
    console.log('已生成/同步:');
    for (const f of created) console.log('  ' + f);
    console.log('\nℹ️  改过 agent.json 后,重启 A2A server 让新身份在注册表生效:');
    console.log('   面板「碳硅契 CSB → 服务控制」重启,或运行插件 scripts/ 下的 start-<slug>-a2a.sh');
  })
  .catch((e) => {
    console.error('❌ 身份生成失败:', e.message);
    process.exit(1);
  });
