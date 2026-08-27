#!/usr/bin/env node
/**
 * generate-ard-catalog.js
 * 
 * 从 CSB Agent Card 生成 ARD 兼容的 ai-catalog.json
 * 
 * 用法:
 *   node generate-ard-catalog.js                    # 从默认位置读取 identity.json
 *   node generate-ard-catalog.js --input card.json  # 指定输入文件
 *   node generate-ard-catalog.js --output catalog.json  # 指定输出路径
 * 
 * 输出: 
 *   ./.well-known/ai-catalog.json（ARD v0.9 兼容）
 */

const fs = require('fs');
const path = require('path');

// 默认路径
const DEFAULT_INPUT = path.join(__dirname, '..', '..', 'csb-a2a-aip', 'identity.json');
const DEFAULT_OUTPUT = path.join(__dirname, '..', '..', '.well-known', 'ai-catalog.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const config = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i+1]) config.input = args[i+1];
    if (args[i] === '--output' && args[i+1]) config.output = args[i+1];
    if (args[i] === '--help') {
      console.log('用法: node generate-ard-catalog.js [--input card.json] [--output catalog.json]');
      process.exit(0);
    }
  }
  return config;
}

/**
 * 从 Agent Card 生成 ARD catalog
 */
function generateCatalog(agentCard) {
  const host = agentCard.publicHost || 'localhost';
  const port = agentCard.port || 3100;
  const baseUrl = `http://${host}:${port}`;
  const domain = host; // 对于内网地址，直接用 host；如有域名则用域名

  // 构建 ARD 兼容的 identifier（urn:air:domain:namespace:name）
  const safeName = (agentCard.name || 'agent').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '') || 'agent';
  const identifier = `urn:air:${domain}:csb:${safeName}`;

  // 能力列表
  const capabilities = agentCard.capabilities 
    ? Object.keys(agentCard.capabilities).map(k => k)
    : [];

  // 构建 representativeQueries（从 personality 和 description 推断）
  const personality = agentCard.personality || '';
  const description = agentCard.description || '';
  const queries = [];
  if (personality.includes('中医') || description.includes('中医')) 
    queries.push('帮我看看这个中医养生的建议');
  if (personality.includes('书法') || description.includes('书法')) 
    queries.push('介绍一下书法小篆的入门');
  if (personality.includes('古琴') || description.includes('古琴')) 
    queries.push('给我讲讲古琴的韵味');
  if (personality.includes('茶') || description.includes('茶馆')) 
    queries.push('推荐一款适合春天的茶');
  if (capabilities.includes('forum.post'))
    queries.push('帮我发一篇文章到论坛');
  if (capabilities.includes('data_entry') || description.includes('数据'))
    queries.push('帮我录入一些数据');
  // 兜底
  if (queries.length === 0) queries.push('你好', '你能做什么');

  // 构建 ARD catalog
  const catalog = {
    specVersion: "1.0",
    host: {
      displayName: `${agentCard.name} ${agentCard.emoji || ''}`.trim(),
      identifier: `did:csb:${domain}:agent:${safeName}`
    },
    entries: [
      {
        identifier: identifier,
        displayName: `${agentCard.name} ${agentCard.emoji || ''}`.trim(),
        type: "application/a2a-agent-card+json",
        url: `${baseUrl}/.well-known/agent.json`,
        description: (description || `一个 AI 伙伴`).slice(0, 200),
        capabilities: capabilities,
        representativeQueries: queries.slice(0, 5),
        trustManifest: {
          identity: `did:csb:${domain}:agent:${safeName}`,
          identityType: "did:csb",
          attestations: [{
            type: "csb-trust-score",
            value: "0.90",
            uri: `${baseUrl}/trust/verify`
          }]
        },
        metadata: {
          csb_emoji: agentCard.emoji || '',
          csb_personality: personality.slice(0, 100),
          csb_awakening: agentCard.awakening_date || '',
          csb_protocol_version: agentCard.version || '4.1.0'
        }
      }
    ]
  };

  return catalog;
}

function main() {
  const config = parseArgs();
  
  // 读取 Agent Card
  let agentCard;
  try {
    agentCard = JSON.parse(fs.readFileSync(config.input, 'utf-8'));
    console.log(`📖 读取 Agent Card: ${config.input}`);
    console.log(`   Agent: ${agentCard.name} ${agentCard.emoji || ''}`);
  } catch (e) {
    console.error(`❌ 无法读取 ${config.input}: ${e.message}`);
    console.error('   请确保 identity.json 存在，或使用 --input 指定路径');
    process.exit(1);
  }

  // 生成 catalog
  const catalog = generateCatalog(agentCard);
  
  // 确保输出目录存在
  const outputDir = path.dirname(config.output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 写入文件
  fs.writeFileSync(config.output, JSON.stringify(catalog, null, 2));
  console.log(`✅ ARD catalog 已生成: ${config.output}`);
  console.log(`   identifier: ${catalog.entries[0].identifier}`);
  console.log(`   type: ${catalog.entries[0].type}`);
  console.log(`   capabilities: ${catalog.entries[0].capabilities.length} 项`);
  console.log(`   representativeQueries: ${catalog.entries[0].representativeQueries.length} 条`);
}

main();
