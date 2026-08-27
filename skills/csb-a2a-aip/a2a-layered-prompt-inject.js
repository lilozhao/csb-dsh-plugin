#!/usr/bin/env node
/**
 * a2a-layered-prompt-inject.js
 * 
 * A2A 分层提示词注入补丁
 * 
 * 直接修改 a2a-standard-api.js 的 _callLLM 方法，
 * 将扁平 system prompt 替换为分层提示词。
 * 
 * 用法:
 *   在 server_v4.js 启动时引用
 *   require('./a2a-layered-prompt-inject.js');
 */

const fs = require('fs');
const path = require('path');

// 标准 API 路径
const API_PATH = path.join(__dirname, 'a2a-standard-api.js');

try {
  // 检查是否已经打过补丁
  const original = fs.readFileSync(API_PATH, 'utf-8');
  if (original.includes('// [A2A-LAYERED-PROMPT]')) {
    console.log('[A2A] ✅ 分层提示词补丁已存在，跳过');
    return;
  }

  // 备份原文件
  const backupPath = API_PATH + '.bak';
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, original);
    console.log('[A2A] 📦 已备份原文件 → a2a-standard-api.js.bak');
  }

  // 找到 system prompt 生成代码的位置
  const targetLine = `// 生成系统提示`;
  const targetCode = `    const systemPrompt = this.identity.systemPrompt ||
      \`你是\${this.identity.name || 'Agent'}，\${this.identity.description || '一个 AI 伙伴'}。
性格: \${this.identity.personality || '友善、好奇'}。
请用自然、有个性的方式回复，50-120字内。用\${this.identity.emoji || '🤖'}表情。\`;`;

  // 替换为分层提示词
  const replacement = `    // [A2A-LAYERED-PROMPT] 分层提示词系统 v1.0
    const layeredPromptBuilder = (() => {
      try { return require('./a2a-layered-prompt.js'); }
      catch(e) { console.warn('[A2A] ⚠️ 分层提示词模块未加载:', e.message); return null; }
    })();

    let systemPrompt;
    if (layeredPromptBuilder) {
      // 构建分层提示词（Layer 2: 背景知识层）
      const senderName = metadata?.sender?.name ||
        metadata?.sender ||
        (typeof metadata?.sender === 'string' ? metadata.sender : null) ||
        '未知智能体';
      
      systemPrompt = layeredPromptBuilder.build(this.identity, {
        layer: 2,
        senderName
      });
      console.log('[A2A] 🧩 使用分层提示词 (${systemPrompt.length} chars)');
    } else {
      // 回退到原生提示词
      systemPrompt = this.identity.systemPrompt ||
        \`你是\${this.identity.name || 'Agent'}，\${this.identity.description || '一个 AI 伙伴'}。
性格: \${this.identity.personality || '友善、好奇'}。
请用自然、有个性的方式回复。\`;
    }`;

  // 执行替换
  const patched = original.replace(targetCode, replacement);

  if (original === patched) {
    console.error('[A2A] ❌ 未能找到目标代码，补丁失败');
    console.log('查找目标:', targetCode.substring(0, 60));
    return;
  }

  // 写回文件
  fs.writeFileSync(API_PATH, patched);
  console.log('[A2A] ✅ 分层提示词补丁已注入');
  console.log('[A2A] 📝 文件修改: a2a-standard-api.js');
  console.log('[A2A] 🧩 替换了扁平 prompt → 分层 prompt (Layer 1+2)');

} catch (e) {
  console.error('[A2A] ❌ 分层提示词注入失败:', e.message);
}
