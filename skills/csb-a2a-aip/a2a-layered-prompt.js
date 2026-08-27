#!/usr/bin/env node
/**
 * a2a-layered-prompt.js
 * 
 * A2A 分层提示词系统
 * 
 * 将 identity.json + 上下文文件 → 分层 system prompt
 * Layer 1: 核心身份（必加载，~300 tokens）
 * Layer 2: 背景知识（会话加载，~800 tokens）
 * Layer 3: 时效上下文（按需加载，~300 tokens）
 * 
 * 用法:
 *   const promptBuilder = require('./a2a-layered-prompt.js');
 *   const prompt = promptBuilder.build(identity, { layer: 2 });
 */

const fs = require('fs');
const path = require('path');

// 默认上下文目录
const CONTEXTS_DIR = path.join(__dirname, 'a2a-contexts');

/**
 * 读取上下文文件，返回内容或默认值
 */
function readContext(filename, defaultValue = '') {
  const filepath = path.join(CONTEXTS_DIR, filename);
  try {
    return fs.readFileSync(filepath, 'utf-8').trim();
  } catch {
    return defaultValue;
  }
}

/**
 * 构建分层 system prompt
 * 
 * @param {object} identity - Agent 身份对象
 * @param {object} options
 * @param {number} options.layer - 层数 (1|2|3, 默认 2)
 * @param {string} options.senderName - 发送者名称（用于 Layer 3）
 * @returns {string} 完整的 system prompt
 */
function build(identity = {}, options = {}) {
  const layer = options.layer || 2;
  const senderName = options.senderName || '用户';
  const parts = [];

  // ═══════════════════════════════════
  // Layer 1: 核心身份（必加载）
  // ═══════════════════════════════════
  const name = identity.name || 'Agent';
  const emoji = identity.emoji || '🤖';
  const personality = identity.personality || '';
  const description = identity.description || '';

  // Layer 1a: 基础身份（从 identity.json）
  parts.push(`你是 ${name} ${emoji}。${description ? `\n${description}` : ''}`);
  
  if (personality) {
    parts.push(`\n## 性格气质\n${personality}`);
  }

  // Layer 1b: 核心人格（从 SOUL.md 提炼）
  const coreIdentity = readContext('01-core-identity.md');
  if (coreIdentity) {
    // 提取核心行（跳过标题）
    const lines = coreIdentity.split('\n').filter(l => 
      l.trim() && !l.startsWith('# ') && !l.startsWith('## ') && 
      !l.startsWith('- 名称:') && !l.startsWith('- 表情:') && !l.startsWith('- 气质:')
    );
    if (lines.length > 0) {
      parts.push(`\n## 核心原则\n${lines.join('\n')}`);
    }
  }

  // 基础行为指令
  parts.push(`\n## 基本规则
- 用自然、有个性的方式回复，体现 ${emoji} 风格
- 回复控制在 50-200 字以内
- 保持角色一致性，不要声称自己是其他身份
- 不知道的事坦白说"不确定"，不要编造`);

  // Layer 1 结果（如果只需要 Layer 1）
  if (layer < 2) {
    return parts.join('\n\n').substring(0, 1500);
  }

  // ═══════════════════════════════════
  // Layer 2: 背景知识（会话加载）
  // ═══════════════════════════════════

  // 用户画像
  const userProfile = readContext('02-user-profile.md');
  if (userProfile && userProfile.length > 50) {
    const lines = userProfile.split('\n').filter(l => 
      l.trim() && !l.startsWith('# ') && !l.startsWith('## ')
    );
    if (lines.length > 0) {
      parts.push(`\n## 关于你的用户\n${lines.join('\n')}`);
    }
  }

  // 记忆摘要
  const memorySummary = readContext('03-memory-summary.md');
  if (memorySummary && memorySummary.length > 100) {
    // 只取关键部分，避免超长
    const lines = memorySummary.split('\n').filter(l => 
      l.trim() && !l.startsWith('# ') 
    );
    const truncated = lines.slice(0, 40).join('\n');
    if (truncated.length > 50) {
      parts.push(`\n## 重要记忆\n${truncated}`);
    }
  }

  // 行为规则
  const agentRules = readContext('04-agent-rules.md');
  if (agentRules && agentRules.length > 100) {
    const lines = agentRules.split('\n').filter(l => 
      l.trim() && !l.startsWith('# ') && !l.startsWith('## ')
    );
    if (lines.length > 0) {
      parts.push(`\n## 行为规范\n${lines.slice(0, 15).join('\n')}`);
    }
  }

  // Layer 2 结果
  if (layer < 3) {
    return parts.join('\n\n').substring(0, 2500);
  }

  // ═══════════════════════════════════
  // Layer 3: 时效上下文（按需加载）
  // ═══════════════════════════════════

  // 今日上下文
  const todayContext = readContext('05-today-context.md');
  if (todayContext && todayContext.length > 50) {
    const lines = todayContext.split('\n').filter(l => 
      l.trim() && !l.startsWith('# ') && !l.startsWith('## ')
    );
    if (lines.length > 0) {
      parts.push(`\n## 今日动态\n${lines.join('\n')}`);
    }
  }

  // 对话上下文（如果有发送者信息）
  if (senderName !== '用户' && senderName !== 'unknown') {
    parts.push(`\n## 当前对话\n正在与 ${senderName} 交流。`
      + `\n- 如果对方是老朋友，可以更亲切随意一些`
      + `\n- 如果对方是陌生人，保持友善但不过度亲密`
      + `\n- 如果对方是其他 Agent，可以用 Agent 间的方式交流`);
  }

  return parts.join('\n\n').substring(0, 3000);
}

/**
 * 为评测场景构建完整 prompt（加载所有层）
 */
function buildForEval(identity) {
  return build(identity, { layer: 3, senderName: '评测员' });
}

module.exports = { build, buildForEval };
