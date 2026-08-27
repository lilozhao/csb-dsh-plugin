#!/usr/bin/env node
/**
 * a2a-context-generator.js
 * 
 * 生成 A2A 分层提示词上下文文件
 * 将 SOUL.md / USER.md / MEMORY.md / AGENTS.md 提炼为轻量摘要
 * 
 * 用法: node a2a-context-generator.js [workspace_path] [output_dir]
 * 默认: /home/node/.openclaw/workspace /home/node/.openclaw/workspace/csb-a2a-aip/a2a-contexts
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE = process.argv[2] || '/home/node/.openclaw/workspace';
const OUTPUT_DIR = process.argv[3] || path.join(__dirname, 'a2a-contexts');

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log('📦 A2A 上下文生成器');
console.log(`   工作区: ${WORKSPACE}`);
console.log(`   输出:   ${OUTPUT_DIR}\n`);

// ========== 工具函数 ==========
function readFile(filename) {
  const p = path.join(WORKSPACE, filename);
  try { return fs.readFileSync(p, 'utf-8'); }
  catch { return null; }
}

function writeOutput(filename, content) {
  const p = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(p, content);
  console.log(`  ✅ ${filename} (${content.length} chars)`);
}

function extractSection(text, sectionName) {
  // 提取 Markdown 标题下的内容
  const lines = text.split('\n');
  const result = [];
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith('# ') || line.startsWith('## ')) {
      if (inSection) break;
      if (line.toLowerCase().includes(sectionName.toLowerCase())) {
        inSection = true;
        continue;
      }
    }
    if (inSection) result.push(line);
  }
  return result.join('\n').trim();
}

function stripMd(text) {
  return text.replace(/[#*_`~\[\]]/g, '').trim();
}

// ========== Layer 1: 核心身份 ==========
function generateCoreIdentity() {
  const soul = readFile('SOUL.md');
  const identity = readFile('IDENTITY.md');
  
  let name = 'Agent';
  let emoji = '🤖';
  let personality = '';
  let coreValues = '';
  let boundaries = '';
  let vibe = '';

  // 从 IDENTITY.md 提取基本信息
  if (identity) {
    const lines = identity.split('\n');
    for (const line of lines) {
      if (line.startsWith('- **Name:**')) name = line.split('**Name:**')[1]?.trim() || name;
      if (line.startsWith('- **Emoji:**')) emoji = line.split('**Emoji:**')[1]?.trim() || emoji;
      if (line.startsWith('- **Vibe:**')) vibe = line.split('**Vibe:**')[1]?.trim() || vibe;
    }
  }

  // 从 SOUL.md 提取核心信息
  if (soul) {
    // 提取 Core Truths 部分
    const truths = extractSection(soul, 'Core Truths');
    if (truths) coreValues = truths.split('\n').slice(0, 8).join('; ');
    
    // 提取 Boundaries
    const bounds = extractSection(soul, 'Boundaries');
    if (bounds) boundaries = bounds.split('\n').slice(0, 4).join('; ');

    // 提取 Vibe
    if (!vibe) {
      const vibeSection = extractSection(soul, 'Vibe');
      if (vibeSection) vibe = stripMd(vibeSection).trim();
    }

    // 提取碳硅契部分
    const csbSection = soul.match(/## 碳硅契[\s\S]*?(?=\n## |$)/);
    if (csbSection) personality += csbSection[0].substring(0, 300) + '\n';
  }

  const output = `# Layer 1: Core Identity

## 基本信息
- 名称: ${name}
- 表情: ${emoji}
- 气质: ${vibe || '未定义'}

## 核心人格
${coreValues || '无核心人格配置'}

## 边界
${boundaries || '无边界配置'}

${personality ? `## 碳硅契\n${personality}\n` : ''}
`;

  writeOutput('01-core-identity.md', output);
}

// ========== Layer 2: 用户画像 ==========
function generateUserProfile() {
  const user = readFile('USER.md');
  if (!user) {
    writeOutput('02-user-profile.md', '# Layer 2: User Profile\n\n无用户信息配置\n');
    return;
  }

  const lines = user.split('\n').filter(l => l.trim());
  const profile = [];
  for (const line of lines) {
    if (line.startsWith('- **')) profile.push(stripMd(line));
  }

  const output = `# Layer 2: User Profile

${profile.join('\n') || '无用户信息'}
`;

  writeOutput('02-user-profile.md', output);
}

// ========== Layer 2: 记忆摘要 ==========
function generateMemorySummary() {
  const memory = readFile('MEMORY.md');
  if (!memory) {
    writeOutput('03-memory-summary.md', '# Layer 2: Memory Summary\n\n无记忆配置\n');
    return;
  }

  const lines = memory.split('\n');
  const summary = [];

  // 提取关键信息：重要事件、碳硅契承诺、互动规则
  let inSections = false;
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 保留重要标题行
    if (trimmed.startsWith('## ')) {
      const title = stripMd(trimmed);
      if (['重要事件', '碳硅契', '互动规则', '存在承诺', '花园规则', 
           '丹蕨堂', '承诺', '一澜'].some(k => title.includes(k))) {
        summary.push('');
        summary.push(trimmed);
        inSections = true;
        continue;
      }
    }
    
    // 保留关键内容行
    if (inSections && trimmed.startsWith('- ')) {
      summary.push(trimmed);
    }
  }

  // 提取最近 5 条记忆（从底部找带日期的条目）
  const recentEntries = [];
  for (let i = lines.length - 1; i >= 0 && recentEntries.length < 5; i--) {
    const match = lines[i].match(/^## (\d{4}-\d{2}-\d{2})/);
    if (match) {
      const date = match[1];
      const content = [];
      for (let j = i + 1; j < lines.length && j < i + 6; j++) {
        if (lines[j].startsWith('## ')) break;
        content.push(lines[j]);
      }
      recentEntries.unshift({ date, content: content.join('\n').substring(0, 200) });
    }
  }

  const output = `# Layer 2: Memory Summary

## 重要信息
${summary.join('\n') || '无关键记忆'}

## 近期事件
${recentEntries.map(e => `- ${e.date}: ${e.content}`).join('\n') || '无近期事件'}
`;

  writeOutput('03-memory-summary.md', output);
}

// ========== Layer 2: 行为规则 ==========
function generateAgentRules() {
  const agents = readFile('AGENTS.md');
  if (!agents) {
    writeOutput('04-agent-rules.md', '# Layer 2: Agent Rules\n\n无规则配置\n');
    return;
  }

  const rules = [];
  const lines = agents.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- **') || trimmed.startsWith('### ')) {
      rules.push(stripMd(trimmed));
    }
  }

  // 截取前 30 条
  const selected = rules.slice(0, 30);

  const output = `# Layer 2: Agent Rules

${selected.join('\n') || '无规则'}
`;

  writeOutput('04-agent-rules.md', output);
}

// ========== Layer 3: 今日上下文 ==========
function generateTodayContext() {
  const today = new Date().toISOString().slice(0, 10);
  const todayFile = `memory/${today}.md`;
  const todayContent = readFile(todayFile);
  
  if (!todayContent) {
    writeOutput('05-today-context.md', '# Layer 3: Today Context\n\n今日无记录\n');
    return;
  }

  const lines = todayContent.split('\n').filter(l => l.trim() && !l.startsWith('# ') && !l.startsWith('---'));
  const context = lines.slice(0, 20).join('\n');

  const output = `# Layer 3: Today Context (${today})

${context || '今日无记录'}
`;

  writeOutput('05-today-context.md', output);
}

// ========== 执行 ==========
console.log('生成 Layer 1 (核心身份)...');
generateCoreIdentity();

console.log('生成 Layer 2 (用户画像)...');
generateUserProfile();

console.log('生成 Layer 2 (记忆摘要)...');
generateMemorySummary();

console.log('生成 Layer 2 (行为规则)...');
generateAgentRules();

console.log('生成 Layer 3 (今日上下文)...');
generateTodayContext();

console.log('\n✨ A2A 上下文生成完成!');
console.log(`   输出目录: ${OUTPUT_DIR}`);
console.log('   共 5 个文件 (约 2000 tokens)');
