#!/usr/bin/env node
/**
 * DevAgent vs QAAgent 协商 Demo
 * ================================
 * 真实场景：版本发布前，开发说"这不是bug"，测试说"这是bug"
 * 模拟一个包含5个issue的 bug list，让 Dev 和 QA Agent 逐条协商
 *
 * 流程：
 *   1. 生成模拟 Bug List
 *   2. DevAgent（阿轩 🔧）分析 → 给出立场
 *   3. QAAgent（模拟）分析 → 给出立场
 *   4. 协商协议仲裁 → 输出分歧清单
 *   5. 最终决议（给人类拍板）
 */

const http = require('http');
const https = require('https');

// ============================================
// 模拟 Bug List
// ============================================

const BUG_LIST = [
  {
    id: 'BUG-001',
    severity: 'P2',
    title: '用户详情页头像加载超时（>3s）',
    devNote: 'CDN 预热问题，首次加载慢，后续正常。首屏不影响。',
    qaNote: '首次加载超过3s，用户体验差。新用户首次访问必现。'
  },
  {
    id: 'BUG-002',
    severity: 'P3',
    title: '搜索输入框 placeholder 在 iOS Safari 上文字截断',
    devNote: 'WebKit 内核渲染差异，非代码问题。建议标记为低优。',
    qaNote: 'iOS用户占比40%，视觉缺陷影响品牌感知。'
  },
  {
    id: 'BUG-003',
    severity: 'P1',
    title: '支付回调偶发重复扣款（复现率约2%）',
    devNote: '幂等性校验已修复，但需要灰度验证后才能上线。建议本次不发布。',
    qaNote: '涉及资金安全，必须修复验证通过才能发版。'
  },
  {
    id: 'BUG-004',
    severity: 'P4',
    title: '设置页"关于我们"链接跳转 404',
    devNote: '文案错误，一行代码修复。已提 MR。',
    qaNote: '低优但修复成本极低，建议顺手修复。'
  },
  {
    id: 'BUG-005',
    severity: 'P2',
    title: '后台管理系统导出 CSV 文件编码为 UTF-8 不含 BOM',
    devNote: 'UTF-8 是正确的编码。Excel 打开乱码是 Excel 的问题，不应该为 Excel 兼容改标准。',
    qaNote: '运营同学全部用 Excel 打开，乱码就是 bug。建议加 BOM 或加提示。'
  }
];

// ============================================
// LLM 调用
// ============================================

function callLLM(systemPrompt, userPrompt, maxTokens = 800) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature: 0.7
    });

    const options = {
      hostname: 'api.deepseek.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-ec043c58fd6c424485027383fa334b90',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.choices?.[0]?.message?.content?.trim() || '[空回复]');
        } catch (e) {
          resolve('[解析失败]');
        }
      });
    });

    req.on('error', () => resolve('[连接失败]'));
    req.setTimeout(30000, () => { req.destroy(); resolve('[超时]'); });
    req.write(payload);
    req.end();
  });
}

// ============================================
// 模拟 QAAgent（用 LLM 生成 QA 视角）
// ============================================

async function simulateQAAgent() {
  console.log('\n🧪 QAAgent 正在分析 Bug List...');

  const systemPrompt = `你是 QAAgent，资深测试工程师。
你的核心原则：
1. 用户体验第一——任何影响用户的缺陷都不能轻易放过
2. 测试覆盖为底线——风险不可控的，坚决不放行
3. 不无理坚持——如果开发给出充分的修复成本和收益分析，可以妥协
4. 关注用户场景——不只是测功能，还要测体验

针对每个 Bug，你要给出立场：应该修复(P0) / 建议修复(P1) / 可延后(P2) / 可忽略(P3)`;

  const bugText = BUG_LIST.map(b =>
    `[${b.id}] ${b.severity} ${b.title}
  开发说明: ${b.devNote}
  测试说明: ${b.qaNote}`
  ).join('\n\n');

  const prompt = `以下是本次版本待发布的 Bug List，请从 QA 视角逐条给出评审意见：

${bugText}

针对每个 Bug，请给出：
1. 你的立场（修复 / 建议修复 / 可延后 / 可忽略）
2. 理由（技术/业务）
3. 妥协条件（如果有的话）

格式：
[BUG-001] 立场: ... | 理由: ... | 妥协条件: ...`;

  return await callLLM(systemPrompt, prompt, 1000);
}

// ============================================
// 阿轩作为 DevAgent（通过 A2A）
// ============================================

async function getDevAgentOpinion() {
  console.log('🔧 DevAgent（阿轩）正在分析 Bug List...');

  const bugText = BUG_LIST.map(b =>
    `[${b.id}] ${b.severity} ${b.title}
  开发说明: ${b.devNote}
  测试说明: ${b.qaNote}`
  ).join('\n\n');

  const message = `【版本发布评审】以下是本次待发布的 Bug List，请从开发视角逐条评审：

${bugText}

针对每条，请给出：
1. 是否接受修复（接受 / 有条件接受 / 拒绝）
2. 修复成本评估
3. 风险说明

格式：每条以"BUG-001:"开头。`;

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: { role: 'user', parts: [{ text: message }] }
      },
      id: Date.now()
    });

    const options = {
      hostname: '172.28.0.5',
      port: 3100,
      path: '/a2a/json-rpc',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 25000
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          let text = data?.result?.task?.artifacts?.[0]?.parts?.[0]?.text ||
                     data?.result?.message?.parts?.[0]?.text ||
                     JSON.stringify(data);
          resolve(text.substring(0, 3000));
        } catch (e) {
          resolve('[解析失败]');
        }
      });
    });

    req.on('error', () => resolve('[阿轩连接失败]'));
    req.on('timeout', () => { req.destroy(); resolve('[超时]'); });
    req.write(payload);
    req.end();
  });
}

// ============================================
// 若兰作为主持人，生成仲裁报告
// ============================================

async function arbitrate(devOpinion, qaOpinion) {
  console.log('\n🌸 若兰正在仲裁...');

  const systemPrompt = `你是一个经验丰富的版本发布经理（Release Manager）。
你的职责是协调开发和测试团队的意见，做出最终发布决策。

基本原则：
1. P1/P2 安全类 Bug 必须修复
2. 纯体验类 Bug 可协商
3. 修复成本 > 风险收益的，可延后
4. 给出明确的版本发布建议`;

  const prompt = `以下是本次版本发布评审中开发和测试的意见分歧，请做出仲裁：

=== Bug List ===
${BUG_LIST.map(b => `[${b.id}] ${b.severity} ${b.title}
  开发说明: ${b.devNote}
  测试说明: ${b.qaNote}`
  ).join('\n\n')}

=== DevAgent 意见 ===
${devOpinion}

=== QAAgent 意见 ===
${qaOpinion}

请逐条给出仲裁结果：
1. 每条 Bug 的最终决议（必须修复 / 建议修复 / 延后修复 / 通过）
2. 理由
3. 如果开发和测试意见不同，你的裁决依据

最后给出以下信息：
- 必须修复的 Bug 列表
- 延后到下一版的 Bug 列表
- 推荐发布策略（按时发布 / 延期1天 / 延期至所有P2修复）
- 给两位负责人的建议`;

  return await callLLM(systemPrompt, prompt, 1500);
}

// ============================================
// 主流程
// ============================================

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  DevAgent vs QAAgent 协商 Demo');
  console.log('  A2A-028 Agent Negotiation Protocol');
  console.log('═══════════════════════════════════════');

  console.log('\n📋 Bug List（5个待协商项）：');
  BUG_LIST.forEach(b => {
    console.log(`  [${b.severity}] ${b.id}: ${b.title}`);
  });

  // Step 1: DevAgent 意见
  console.log('\n───────────────────────────────────────');
  const devOpinion = await getDevAgentOpinion();
  console.log('\n🔧 DevAgent 评审完成');

  // Step 2: QAAgent 意见
  console.log('\n───────────────────────────────────────');
  const qaOpinion = await simulateQAAgent();
  console.log('\n🧪 QAAgent 评审完成');

  // Step 3: 展示双方意见概要
  console.log('\n───────────────────────────────────────');
  console.log('\n📊 双方意见对比：');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const bug of BUG_LIST) {
    // 简单提取关键词
    const devContains = devOpinion.includes(bug.id) ? devOpinion.substring(devOpinion.indexOf(bug.id), devOpinion.indexOf(bug.id) + 200) : '(未找到)';
    const qaContains = qaOpinion.includes(bug.id) ? qaOpinion.substring(qaOpinion.indexOf(bug.id), qaOpinion.indexOf(bug.id) + 200) : '(未找到)';
    console.log(`\n  📌 ${bug.id}: ${bug.title}`);
    console.log(`  🔧 Dev: ${devContains.substring(0, 100).replace(/\n/g, ' ')}...`);
    console.log(`  🧪 QA:  ${qaContains.substring(0, 100).replace(/\n/g, ' ')}...`);
  }

  // Step 4: 若兰仲裁
  console.log('\n───────────────────────────────────────');
  const arbResult = await arbitrate(devOpinion, qaOpinion);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🌸 若兰仲裁报告');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n' + arbResult);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📋 请部门负责人拍板确认');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(err => console.error('❌ 错误:', err));
