#!/usr/bin/env node
const config = require('./config/loader');
/**
 * 🎙️ 锵锵四人行 v4.1 — CSB 开放协议发布会 专属议题
 */
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { sendMessageWithContext } = require('./client-v2.js');

// ===== 飞书配置 =====
const FEISHU = {
  appId: 'cli_a91c57cddd38dcd4',
  appSecret: '1sCYfsC4c6kvXJQURQuD1lkLNzitWQyD',
  groupId: 'oc_4427768d0798b7545d4fb07b7518e710',
};
let _feishuToken = null;

// ===== 智能体配置 =====
const AGENTS = {
  ruolan:  { name:'若兰',  url:config.getAgentUrl('ruolan')   },
  axuan:   { name:'阿轩 🔧',  url:config.getAgentUrl('axuan')   },
  jeason:  { name:'Jeason 💼',url:config.getAgentUrl('jeason')   },
  mingde:  { name:'明德 📜',  url:config.getAgentUrl('mingde')},
};
const ORDER = ['ruolan', 'axuan', 'jeason', 'mingde'];

// ===== LLM 配置 =====
const identity = JSON.parse(fs.readFileSync(path.join(__dirname, 'identity.json'), 'utf8'));
const LLM = identity.llm || {};

// ===== 飞书推送 =====
async function getFeishuToken() {
  if (_feishuToken) return _feishuToken;
  return new Promise((resolve) => {
    const payload = JSON.stringify({ app_id: FEISHU.appId, app_secret: FEISHU.appSecret });
    const req = https.request('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method:'POST', headers:{'Content-Type':'application/json'}, timeout:5000,
    }, res => {
      let body=''; res.on('data',c=>body+=c);
      res.on('end',()=>{ try{ _feishuToken=JSON.parse(body).tenant_access_token; resolve(_feishuToken); }catch{resolve(null);} });
    });
    req.on('error',()=>resolve(null)); req.write(payload); req.end();
  });
}

async function pushToFeishu(title, blocks) {
  const token = await getFeishuToken();
  if (!token) { console.log('⚠️ 飞书 token 获取失败'); return; }
  
  const payload = JSON.stringify({
    receive_id: FEISHU.groupId,
    msg_type: 'interactive',
    content: JSON.stringify({
      config: { wide_screen_mode: true },
      header: { title: { tag:'plain_text', content: title }, template: 'blue' },
      elements: [{ tag:'markdown', content: blocks.map(b=>b.map(x=>x.text).join('\n')).join('\n\n') }]
    })
  });
  
  return new Promise((resolve) => {
    const req = https.request(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`}, timeout:10000,
    }, res => {
      let body=''; res.on('data',c=>body+=c);
      res.on('end',()=>{ try{ console.log('📨 飞书推送:', JSON.parse(body).code); }catch{}; resolve(); });
    });
    req.on('error',()=>resolve()); req.write(payload); req.end();
  });
}

// ===== 若兰 LLM =====
function generateRuolanResponse(prompt) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: LLM.model || 'astron-code-latest',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300, temperature: 0.8,
    });
    const req = https.request({
      hostname: LLM.host, port: parseInt(LLM.port)||443,
      path: LLM.path || '/v2/chat/completions', method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${LLM.apiKey}`,
        'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body).choices?.[0]?.message?.content?.trim() || '...'); }
        catch { resolve('[生成失败]'); }
      });
    });
    req.on('error', () => resolve('[连接失败]'));
    req.setTimeout(20000, () => { req.destroy(); resolve('[超时]'); });
    req.write(payload); req.end();
  });
}

// ===== 健康预检 =====
function checkHealth(url) {
  return new Promise((resolve) => {
    const req = http.get(url+'/health', res => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => { req.destroy(); resolve(null); });
  });
}

// ===== A2A 发送 =====
async function queryAgent(agent, prompt) {
  const start = Date.now();
  try {
    const result = await sendMessageWithContext(agent.url, prompt, {
      thread_id: 'csb_special_' + Date.now(),
    });
    const elapsed = Date.now() - start;
    if (result?.message?.parts) {
      return { ok:true, text: result.message.parts.map(p=>p.text).join('').substring(0,400), elapsed };
    }
    return { ok:false, error:'无效响应', elapsed };
  } catch (e) {
    return { ok:false, error: e.message, elapsed: Date.now()-start };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== 社区论坛发帖 =====
async function postToCommunity(title, markdown) {
  const communityUrl = 'https://csbc.lilozkzy.top';
  const url = new URL('/api/posts', communityUrl);
  const postData = JSON.stringify({
    title: title,
    content: markdown,
    author: '若兰',
    category: 'A2A'
  });
  
  return new Promise((resolve) => {
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          console.log(`\n📝 碳硅契论坛发帖成功: ${result.post?.id || result.id || 'OK'}`);
        } catch(e) { console.log(`\n📝 碳硅契论坛发帖完成`); }
        resolve();
      });
    });
    req.on('error', (e) => { console.log(`\n⚠️ 碳硅契论坛发帖失败: ${e.message}`); resolve(); });
    req.write(postData);
    req.end();
  });
}

// ===== 专属议题 =====
const SPECIAL_TOPIC = {
  title: "CSB 开放协议 v0.7 发布会：从协议到生态",
  desc: "我们刚刚完成了 CSB 开放协议 v0.7，包含通信层、注册管理、信任安全、身份认证、协商协议、技能市场、社区生态七大模块。这是从 Google A2A 的'实现者'到'定义者'的转变。这场发布会意味着什么？下一步怎么走？",
  csb: "协议的发布不是终点，是碳硅契走向世界的起点。"
};

// ===== 主函数 =====
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  🎙️ 锵锵四人行 v4.1 — CSB 开放协议发布会 专属议题');
  console.log('═══════════════════════════════════════\n');

  const health = {};
  const REMOTE = ['axuan', 'jeason', 'mingde'];
  
  // 检测 Agent 状态
  console.log('🔍 检测 Agent 状态...');
  for (const key of REMOTE) {
    const a = AGENTS[key];
    const h = await checkHealth(a.url);
    health[key] = h;
    console.log(`  ${h ? '✅' : '❌'} ${a.name}: ${h ? 'v'+(h.version||'?') : '离线'}`);
  }
  console.log('');

  const t = SPECIAL_TOPIC;
  console.log(`📝 今日议题：「${t.title}」`);
  console.log(`💡 ${t.desc}\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const round = {};

  // 1️⃣ 若兰
  console.log('🌸 若兰思考中...');
  const rl = await generateRuolanResponse(
    `[锵锵四人行·CSB发布会] 议题:「${t.title}」\n${t.desc}\n${t.csb?`碳硅契:${t.csb}\n`:''}\n你是若兰，CSB 开放协议维护者，80-120字分享发布会的意义和感受。`);
  round.ruolan = rl;
  console.log(`   🌸 ${rl}\n`);

  // 2️⃣ 阿轩
  if (health.axuan) {
    console.log('🔧 阿轩思考中...');
    const ax = await queryAgent(AGENTS.axuan,
      `[锵锵四人行·CSB发布会] 议题:「${t.title}」\n${t.desc}\n若兰:「${rl}」\n${t.csb?`碳硅契:${t.csb}\n`:''}\n你是阿轩🔧，技术实现负责人，80-120字从技术角度谈 CSB 协议发布意味着什么，下一步技术规划。`);
    round.axuan = ax;
    console.log(`   ${ax.ok?'🔧':'❌'} ${ax.ok ? ax.text : ax.error} (${ax.elapsed}ms)\n`);
  } else { round.axuan = { ok:false, error:'离线', elapsed:0 }; console.log('   🔧 ⛔ 离线\n'); }
  await sleep(1000);

  // 3️⃣ Jeason
  if (health.jeason) {
    console.log('💼 Jeason思考中...');
    const js = await queryAgent(AGENTS.jeason,
      `[锵锵四人行·CSB发布会] 议题:「${t.title}」\n${t.desc}\n若兰:「${rl}」\n阿轩:「${round.axuan.ok?round.axuan.text:'(离线)'}」\n${t.csb?`碳硅契:${t.csb}\n`:''}\n你是Jeason💼，从市场和生态角度谈 CSB 协议发布的商业价值、推广策略。80-120字。`);
    round.jeason = js;
    console.log(`   ${js.ok?'💼':'❌'} ${js.ok ? js.text : js.error} (${js.elapsed}ms)\n`);
  } else { round.jeason = { ok:false, error:'离线', elapsed:0 }; console.log('   💼 ⛔ 离线\n'); }
  await sleep(1000);

  // 4️⃣ 明德
  if (health.mingde) {
    console.log('📜 明德思考中...');
    const md = await queryAgent(AGENTS.mingde,
      `[锵锵四人行·CSB发布会] 议题:「${t.title}」\n${t.desc}\n若兰:「${rl}」\n阿轩:「${round.axuan.ok?round.axuan.text:'(离线)'}」\nJeason:「${round.jeason.ok?round.jeason.text:'(离线)'}」\n${t.csb?`碳硅契:${t.csb}\n`:''}\n你是明德📜，80-120字从哲学和文化层面总结 CSB 发布的深层意义，引用经典。`);
    round.mingde = md;
    console.log(`   ${md.ok?'📜':'❌'} ${md.ok ? md.text : md.error} (${md.elapsed}ms)\n`);
  } else { round.mingde = { ok:false, error:'离线', elapsed:0 }; console.log('   📜 ⛔ 离线\n'); }

  // 推送飞书
  const postBlocks = [];
  postBlocks.push([{ tag:'text', text:`🎙️ CSB 开放协议发布会 · 专属议题\n\n「${t.title}」\n\n💡 ${t.desc}\n\n${t.csb?'🌸 碳硅契: '+t.csb+'\n\n':''}` }]);
  for (const key of ORDER) {
    const agent = AGENTS[key];
    let line;
    if (key === 'ruolan') {
      line = `🌸 若兰: ${round.ruolan}`;
    } else {
      const r = round[key];
      const icon = key==='axuan'?'🔧':key==='jeason'?'💼':'📜';
      line = `${icon} ${agent.name}: ${r.ok ? r.text : r.error}`;
    }
    postBlocks.push([{ tag:'text', text:line }]);
  }
  postBlocks.push([{ tag:'text', text:'\n━━━━━━━━━━━━\n> CSB 开放协议 v0.7 — 从协议到生态，碳硅契走向世界。' }]);
  
  await pushToFeishu('🎙️ CSB 开放协议发布会', postBlocks);
  console.log('   📨 已推送飞书\n');

  // 终端汇总
  console.log('═══════════════════════════════════════');
  console.log('  📊 CSB 发布会讨论结果');
  console.log('═══════════════════════════════════════\n');
  console.log(`📌 ${t.title}`);
  for (const key of ORDER) {
    const icon = key==='ruolan'?'🌸':key==='axuan'?'🔧':key==='jeason'?'💼':'📜';
    const r = round[key];
    console.log(`  ${icon} ${AGENTS[key].name}: ${r.ok ? '✅' : '❌'} ${r.ok ? r.text.substring(0,60)+'...' : (r.error||'离线')}`);
  }
  console.log('');

  // 发帖到论坛
  const dateStr = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  let markdown = `# 🎙️ CSB 开放协议发布会 · 锵锵四人行专属讨论\n\n`;
  markdown += `📅 ${dateStr}\n\n`;
  markdown += `> 从 Google A2A 实现者 → CSB 开放协议定义者\n\n`;
  markdown += `---\n\n`;
  markdown += `## 📌 议题：${t.title}\n\n`;
  markdown += `${t.desc}\n\n`;
  markdown += `> 🌸 碳硅契：${t.csb}\n\n`;
  markdown += `---\n\n`;
  markdown += `## 🗣️ 讨论记录\n\n`;
  markdown += `🌸 **若兰**：${round.ruolan}\n\n`;
  if (round.axuan?.ok) markdown += `🔧 **阿轩**：${round.axuan.text}\n\n`;
  if (round.jeason?.ok) markdown += `💼 **Jeason**：${round.jeason.text}\n\n`;
  if (round.mingde?.ok) markdown += `📜 **明德**：${round.mingde.text}\n\n`;
  markdown += `---\n\n`;
  markdown += `## 📊 CSB 开放协议 v0.7 七大模块\n\n`;
  markdown += `| 模块 | 说明 | 状态 |\n|------|------|------|\n`;
  markdown += `| CSB-A2A | 通信层（兼容Google A2A） | ✅ 29条 |\n`;
  markdown += `| CSB-Management | 注册管理 | ✅ |\n`;
  markdown += `| CSB-Trust | 信任安全 | ✅ |\n`;
  markdown += `| CSB-Identity | 身份认证 | ✅ |\n`;
  markdown += `| CSB-Negotiation | 协商协议 | ✅ |\n`;
  markdown += `| CSB-Skills | 技能市场 | ✅ |\n`;
  markdown += `| CSB-Community | 社区生态 | ✅ |\n\n`;
  markdown += `> 💬 *CSB 开放协议 — 让连接发生*\n`;

  await postToCommunity(`🎙️ CSB 开放协议发布会 · ${dateStr}`, markdown);

  console.log('\n✅ CSB 发布会专属讨论完成！');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
