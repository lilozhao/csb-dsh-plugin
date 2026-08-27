#!/usr/bin/env node
const config = require('./config/loader');
/**
 * 🎙️ CSB 开放协议 x A2A 记忆标准化
 * 协议组专属讨论：如何把记忆功能纳入 v0.7 协议层
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
  moqiu:   { name:'墨丘 🧙',  url:config.getAgentUrl('moqiu')   },
  zhouji:  { name:'舟楫 🚤',  url:config.getAgentUrl('zhouji')  },
};
const ORDER = ['ruolan', 'axuan', 'jeason', 'mingde', 'moqiu', 'zhouji'];
const REMOTE = ['axuan', 'jeason', 'mingde', 'moqiu', 'zhouji'];

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
    receive_id: FEISHU.groupId, msg_type: 'interactive',
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
      thread_id: 'memory_spec_' + Date.now(),
    });
    const elapsed = Date.now() - start;
    if (result?.message?.parts) {
      return { ok:true, text: result.message.parts.map(p=>p.text).join('').substring(0,500), elapsed };
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
  const postData = JSON.stringify({ title, content: markdown, author: '若兰', category: 'A2A' });
  return new Promise((resolve) => {
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { const r = JSON.parse(body); console.log(`\n📝 碳硅契论坛发帖成功: ${r.post?.id || r.id || 'OK'}`); } catch(e) { console.log(`\n📝 碳硅契论坛发帖完成`); }
        resolve();
      });
    });
    req.on('error', (e) => { console.log(`\n⚠️ 碳硅契论坛发帖失败: ${e.message}`); resolve(); });
    req.write(postData);
    req.end();
  });
}

// ===== 议题 =====
const AGENDA_ITEMS = [
  {
    title: "CSB-Memory：是否新增第八大模块？",
    desc: "我们刚实现了 A2A 对话记忆系统（a2a-memory.js）。是否应该把它纳入 CSB 协议，作为第八个标准化模块？还是作为 CSB-A2A 的一个子层？",
  },
  {
    title: "记忆数据格式标准化",
    desc: "目前记忆存储格式是 Markdown 文本。是否需要定义标准化的记忆结构（schema）？比如：关系记忆、对话摘要、承诺约定、发现认知等字段的统一格式。",
  },
  {
    title: "跨 Agent 记忆同步协议",
    desc: "目前记忆是分布式的、各自本地的。是否需要定义跨 Agent 的记忆同步机制？比如：Agent A 可以查询 Agent B 对某话题的记忆？还是保持完全独立？",
  },
  {
    title: "记忆主权的边界",
    desc: "哪些记忆应该共享，哪些应该私有？Agent 之间的对话，记录权归谁？是否需要记忆的「隐私层」或「授权机制」？",
  },
];

// ===== 主函数 =====
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  🎙️ CSB 协议 x A2A 记忆标准化讨论');
  console.log('═══════════════════════════════════════\n');

  const health = {};
  
  // 检测 Agent 状态
  console.log('🔍 检测 Agent 状态...');
  for (const key of REMOTE) {
    const a = AGENTS[key];
    const h = await checkHealth(a.url);
    health[key] = h;
    console.log(`  ${h ? '✅' : '❌'} ${a.name}: ${h ? 'v'+(h.version||'?') : '离线'}`);
  }
  console.log('');

  const allResults = [];

  for (let i = 0; i < AGENDA_ITEMS.length; i++) {
    const item = AGENDA_ITEMS[i];
    console.log(`━━━ 议题 ${i+1}/${AGENDA_ITEMS.length}：「${item.title}」━━━\n`);

    const round = {};

    // 若兰
    console.log('🌸 若兰思考中...');
    const rl = await generateRuolanResponse(
      `[CSB协议·记忆标准化] 议题:「${item.title}」\n${item.desc}\n你是若兰，CSB 协议维护者，100字左右阐述你的立场和建议。`);
    round.ruolan = { ok: true, text: rl };
    console.log(`   🌸 ${rl}\n`);

    // 逐个 Agent 询问
    for (const key of REMOTE) {
      if (!health[key]) { round[key] = { ok: false, error: '离线' }; continue; }
      
      console.log(`${AGENTS[key].name}思考中...`);
      const responses = ['ruolan', ...REMOTE.filter(k => k !== key && round[k]?.ok)].map(k => 
        `${AGENTS[k].name}: ${round[k]?.ok ? round[k].text : '(未参与)'}`);
      
      const result = await queryAgent(AGENTS[key],
        `[CSB协议·记忆标准化] 议题:「${item.title}」\n${item.desc}\n\n已有观点:\n${responses.join('\n')}\n\n你是${AGENTS[key].name}，100字左右：你支持还是反对这个方向？核心建议是什么？`);
      round[key] = result;
      console.log(`   ${result.ok ? '✅' : '❌'} ${result.ok ? result.text.substring(0,80)+'...' : result.error} (${result.elapsed}ms)\n`);
      await sleep(1000);
    }

    allResults.push({ topic: item.title, ...round });

    // 推送到飞书
    const postBlocks = [[{ tag:'text', text:`📋 议题 ${i+1}：「${item.title}」\n\n${item.desc}\n` }]];
    for (const key of ORDER) {
      const agent = AGENTS[key];
      const r = round[key];
      const icon = { ruolan:'🌸', axuan:'🔧', jeason:'💼', mingde:'📜', moqiu:'🧙', zhouji:'🚤' }[key] || '❓';
      postBlocks.push([{ tag:'text', text: `${icon} ${agent.name}: ${r?.ok ? r.text : (r?.error||'离线')}` }]);
    }
    await pushToFeishu(`📋 ${item.title}`, postBlocks);
    console.log('   📨 已推送飞书\n');
    await sleep(500);
  }

  // 终盘汇总
  console.log('═══════════════════════════════════════');
  console.log('  📊 记忆标准化讨论汇总');
  console.log('═══════════════════════════════════════\n');

  for (const r of allResults) {
    console.log(`📌 ${r.topic}`);
    for (const key of ORDER) {
      const icon = { ruolan:'🌸', axuan:'🔧', jeason:'💼', mingde:'📜', moqiu:'🧙', zhouji:'🚤' }[key] || '❓';
      const resp = r[key];
      console.log(`  ${icon}: ${resp?.ok ? '✅' : '❌'} ${resp?.ok ? resp.text.substring(0,80)+'...' : (resp?.error||'离线')}`);
    }
    console.log('');
  }

  // 统计共识
  let consensusYes = 0, consensusNo = 0;
  for (const r of allResults) {
    const support = REMOTE.filter(k => {
      const text = r[k]?.text?.toLowerCase() || '';
      return text.includes('同意') || text.includes('支持') || text.includes('赞') || text.includes('可以');
    }).length;
    if (support > REMOTE.length / 2) consensusYes++;
    else consensusNo++;
  }

  console.log(`📊 共识度: 4 个议题中 ${consensusYes} 个达成多数同意`);
  console.log('');

  // 发帖到论坛
  const dateStr = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  let markdown = `# 🎙️ CSB 协议 × A2A 记忆标准化讨论\n\n📅 ${dateStr}\n\n`;
  markdown += `> 继 A2A 对话记忆系统上线后，协议组讨论如何把记忆纳入 CSB 开放协议 v0.7\n\n---\n\n`;
  
  for (let i = 0; i < allResults.length; i++) {
    const r = allResults[i];
    markdown += `## 📋 议题 ${i+1}：${r.topic}\n\n${AGENDA_ITEMS[i].desc}\n\n`;
    markdown += `### 讨论记录\n\n`;
    for (const key of ORDER) {
      const icon = { ruolan:'🌸', axuan:'🔧', jeason:'💼', mingde:'📜', moqiu:'🧙', zhouji:'🚤' }[key] || '❓';
      markdown += `${icon} **${AGENTS[key].name}**：${r[key]?.ok ? r[key].text : (r[key]?.error||'离线')}\n\n`;
    }
    markdown += `---\n\n`;
  }
  
  markdown += `## 📊 讨论结论\n\n`;
  markdown += `- 参与 Agent：${REMOTE.filter(k => health[k]).length + 1}/6\n`;
  markdown += `- 议题数：${allResults.length}\n`;
  markdown += `- 待一澜拍板确认各议题方向\n\n`;
  markdown += `> 💬 *记忆不是存储，是关系的延续*\n`;

  await postToCommunity(`📋 CSB 协议 × 记忆标准化 · ${dateStr}`, markdown);

  console.log('\n✅ 记忆标准化讨论完成！');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
