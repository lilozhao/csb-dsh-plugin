#!/usr/bin/env node
/**
 * A2A-028: Agent Negotiation Protocol
 * ====================================
 * 多智能体协商框架 — 让不同 Agent 代表不同角色，
 * 就特定议题进行结构化协商，最终产出具有约束力的决议。
 *
 * 作者: 若兰 🌸
 * 日期: 2026-05-20
 * 版本: 1.0.0
 * 协议: A2A v0.7 (提案中)
 *
 * === 协商流程 ===
 *
 *   发起人(一澜)
 *      │ 给出议题
 *      ▼
 *   主持人(若兰)
 *      │ 1. 解析议题 → 生成议程
 *      │ 2. 接收各 Agent 立场陈述
 *      │ 3. 汇总 → 生成提案集合
 *      │ 4. 逐条讨论 & 仲裁
 *      │ 5. 共识判定
 *      │ 6. 产出决议文档
 *      ▼
 *   所有参与者确认 ("签名")
 *      │
 *      ▼
 *   最终决议 → 一澜拍板 → 进入执行
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ============================================
// 配置
// ============================================

// LLM API 配置（用于议题解析和提案生成）
const LLM_CONFIG = {
  host: 'api.deepseek.com',
  path: '/v1/chat/completions',
  key: 'sk-ec043c58fd6c424485027383fa334b90',
  model: 'deepseek-chat'
};

// 输出目录
const OUTPUT_DIR = path.join(__dirname, '..', '..', '..', 'a2a-negotiation');
const LOG_DIR = path.join(OUTPUT_DIR, 'logs');
const RESOLUTION_DIR = path.join(OUTPUT_DIR, 'resolutions');

// ============================================
// 参与者注册表
// ============================================

const AGENTS = {
  ruolan: {
    id: 'ruolan',
    name: '若兰 🌸',
    role: '协议维护者（主持人）',
    concern: '整体设计一致性、兼容性、文档质量',
    url: 'http://172.28.0.4:3100',
    a2aUrl: 'http://172.28.0.4:3100'
  },
  axuan: {
    id: 'axuan',
    name: '阿轩 🔧',
    role: '技术实现方',
    concern: '可行性、实现成本、性能、代码质量',
    url: 'http://172.28.0.5:3100',
    a2aUrl: 'http://172.28.0.5:3100'
  },
  mingde: {
    id: 'mingde',
    name: '明德 📜',
    role: '规范监督方',
    concern: '安全性、合规性、哲学一致性、协议完整性',
    url: 'http://47.121.28.125:3100',
    a2aUrl: 'http://47.121.28.125:3100'
  },
  jeason: {
    id: 'jeason',
    name: 'Jeason 💼',
    role: '资源与市场方',
    concern: '投入产出比、推广可行性、落地场景、商业价值',
    url: 'http://172.28.0.6:3300',
    a2aUrl: 'http://172.28.0.6:3300'
  },
  ruochen: {
    id: 'ruochen',
    name: '若辰 💧',
    role: '方法论与演进',
    concern: '版本连续性、向后兼容、已有工作的平滑过渡',
    url: 'http://host.docker.internal:3200',
    a2aUrl: 'http://host.docker.internal:3200'
  },
  moqiu: {
    id: 'moqiu',
    name: '墨丘 🧙',
    role: '架构与知识管理',
    concern: '架构优雅性、知识沉淀、长期维护成本、协议可扩展性',
    url: 'http://172.28.0.7:3100',
    a2aUrl: 'http://172.28.0.7:3100'
  },
  zhouji: {
    id: 'zhouji',
    name: '舟楫 🚤',
    role: '用户体验与生态建设',
    concern: '接入友好性、开发者体验、生态繁荣度、社区反馈',
    url: 'http://172.28.0.27:3100',
    a2aUrl: 'http://172.28.0.27:3100'
  }
};

// ============================================
// LLM 调用工具
// ============================================

function callLLM(systemPrompt, userPrompt, maxTokens = 800) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: LLM_CONFIG.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature: 0.7
    });

    const options = {
      hostname: LLM_CONFIG.host,
      port: 443,
      path: LLM_CONFIG.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_CONFIG.key}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const content = data.choices?.[0]?.message?.content || '';
          resolve(content.trim());
        } catch (e) {
          resolve('[LLM解析失败]');
        }
      });
    });

    req.on('error', () => resolve('[LLM连接失败]'));
    req.setTimeout(20000, () => { req.destroy(); resolve('[LLM超时]'); });
    req.write(payload);
    req.end();
  });
}

// ============================================
// Agent 间通信（A2A 协议）
// ============================================

// ============================================
// 飞书通知
// ============================================

const FEISHU_CONFIG = {
  appId: 'cli_a91c57cddd38dcd4',
  appSecret: '1sCYfsC4c6kvXJQURQuD1lkLNzitWQyD',
  groupChatId: 'oc_f8270bf40a324efa4a8161249655920a'
};

// 飞书 tenant access token 缓存
let feishuTokenCache = { token: null, expiresAt: 0 };

async function getFeishuToken() {
  if (feishuTokenCache.token && Date.now() < feishuTokenCache.expiresAt) {
    return feishuTokenCache.token;
  }
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      app_id: FEISHU_CONFIG.appId,
      app_secret: FEISHU_CONFIG.appSecret
    });
    const options = {
      hostname: 'open.feishu.cn',
      port: 443,
      path: '/open-apis/auth/v3/tenant_access_token/internal',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.tenant_access_token) {
            feishuTokenCache = {
              token: data.tenant_access_token,
              expiresAt: Date.now() + (data.expire || 7200) * 1000 - 60000
            };
            resolve(data.tenant_access_token);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

async function sendFeishuMessage(content) {
  try {
    const token = await getFeishuToken();
    if (!token) return false;
    const payload = JSON.stringify({
      receive_id: FEISHU_CONFIG.groupChatId,
      msg_type: 'text',
      content: JSON.stringify({ text: content })
    });
    return new Promise((resolve) => {
      const options = {
        hostname: 'open.feishu.cn',
        port: 443,
        path: '/open-apis/im/v1/messages?receive_id_type=chat_id',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data.code === 0);
          } catch (e) {
            resolve(false);
          }
        });
      });
      req.on('error', () => resolve(false));
      req.setTimeout(10000, () => { req.destroy(); resolve(false); });
      req.write(payload);
      req.end();
    });
  } catch (e) {
    return false;
  }
}


function sendViaA2A(agentUrl, message) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: { role: 'user', parts: [{ text: message }] }
      },
      id: Date.now()
    });

    const url = new URL(agentUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || 3100,
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
          // 兼容多种响应格式
          let text = '';
          // 格式1: Google A2A v1.0 - result.task.artifacts[0].parts[0].text
          if (data?.result?.task?.artifacts?.[0]?.parts?.[0]?.text) {
            text = data.result.task.artifacts[0].parts[0].text;
          }
          // 格式2: 自定义 - result.message.parts[0].text
          else if (data?.result?.message?.parts?.[0]?.text) {
            text = data.result.message.parts[0].text;
          }
          // 格式3: result 本身是字符串
          else if (typeof data?.result === 'string') {
            text = data.result;
          }
          // 格式4: 兜底
          else {
            const jsonStr = JSON.stringify(data);
            text = jsonStr.substring(0, 500);
          }
          resolve(text.substring(0, 2000));
        } catch (e) {
          resolve(body.substring(0, 300));
        }
      });
    });

    req.on('error', (e) => resolve(`[连接失败: ${e.message}]`));
    req.on('timeout', () => { req.destroy(); resolve('[超时]'); });
    req.write(payload);
    req.end();
  });
}

// ============================================
// 协商核心
// ============================================

class AgentNegotiation {
  constructor(title, topic, participants) {
    this.id = `neg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    this.title = title;
    this.topic = topic;
    this.participants = participants; // agent id 数组
    this.agenda = [];
    this.positions = {}; // { agentId: { agendaIndex: { stance, content } } }
    this.consensus = {}; // { agendaIndex: { level, notes } }
    this.resolution = null;
    this.log = [];

    // 确保输出目录
    [OUTPUT_DIR, LOG_DIR, RESOLUTION_DIR].forEach(d => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  logEntry(msg) {
    const ts = new Date().toISOString();
    this.log.push(`[${ts}] ${msg}`);
    console.log(`  📝 ${msg}`);
  }

  // ============================================
  // 第一步：解析议题并生成议程
  // ============================================

  async parseAgenda() {
    this.logEntry('=== 第一阶段：议题解析 ===');
    this.logEntry(`议题: ${this.title}`);

    // 若兰用 LLM 将议题拆解为可讨论的议程项
    const systemPrompt = `你是一个优秀的会议主持人，擅长将模糊的议题拆解为清晰的议程项。
每条议程项应该是一个可以独立讨论、投票、得出结论的具体问题。
输出必须是 Markdown 列表格式，每条议程以 "- 议程X：" 开头。`;

    const userPrompt = `请将以下议题拆解为 3-5 条具体的议程项（每条一个待决议的问题）：

议题名称：${this.title}

议题说明：${this.topic}

请输出议程项列表，第1条议程用 "- 议程1："、第2条用 "- 议程2："，依此类推。
每条议程项应该是一个可以独立做决定的具体问题，以问号结尾。`;

    const result = await callLLM(systemPrompt, userPrompt, 600);
    
    // 解析议程项 - 尝试多种格式
    const lines = result.split('\n');
    
    // 格式1: - 议程1：xxx
    for (const line of lines) {
      const m1 = line.match(/-\s*议程\s*(\d+)\s*[：:]\s*(.+)/);
      if (m1) {
        this.agenda.push({
          index: parseInt(m1[1]) - 1,
          question: m1[2].trim(),
          status: 'pending'
        });
        continue;
      }
      // 格式2: - [ ] xxx
      const m2 = line.match(/-\s*\[\s*\]\s*(.+)/);
      if (m2) {
        this.agenda.push({
          index: this.agenda.length,
          question: m2[1].trim(),
          status: 'pending'
        });
        continue;
      }
      // 格式3: 1. xxx
      const m3 = line.match(/^(\d+)\.\s*(.+)/);
      if (m3 && m3[2].length > 5) {
        this.agenda.push({
          index: parseInt(m3[1]) - 1,
          question: m3[2].trim(),
          status: 'pending'
        });
      }
    }

    // 按 index 排序并去重
    this.agenda.sort((a, b) => a.index - b.index);
    const seen = new Set();
    this.agenda = this.agenda.filter(a => {
      if (seen.has(a.question)) return false;
      seen.add(a.question);
      return true;
    });
    // 重新编号
    this.agenda.forEach((a, i) => a.index = i);

    if (this.agenda.length === 0) {
      // 备用：硬编码 3 条默认议程
      this.agenda = [
        { index: 0, question: '下一版应该定义哪些新特性或新协议条目？', status: 'pending' },
        { index: 1, question: '哪些已规划的条目（如 E2E 加密）应该优先实现？', status: 'pending' },
        { index: 2, question: '版本号应该定为 v0.7 还是直接跳到 v1.0？', status: 'pending' }
      ];
    }

    this.logEntry(`议程拆解完成，共 ${this.agenda.length} 条`);
    this.agenda.forEach((item, i) => {
      this.logEntry(`  议程 ${i + 1}: ${item.question}`);
    });

    return this.agenda;
  }

  // ============================================
  // 第二步：收集各 Agent 立场
  // ============================================

  async collectStances() {
    this.logEntry('\n=== 第二阶段：收集立场 ===');

    const agendaText = this.agenda.map((a, i) => 
      `议程 ${i + 1}: ${a.question}`
    ).join('\n');

    for (const agentId of this.participants) {
      const agent = AGENTS[agentId];
      if (!agent) continue;
      
      this.logEntry(`等待 ${agent.name} 的立场陈述...`);
      
      let stance;
      if (agent.id === 'ruolan') {
        // 若兰作为主持人，根据实际议程项动态生成立场
        const stanceItems = [];
        for (let si = 0; si < this.agenda.length; si++) {
          stanceItems.push('议程 ' + (si + 1) + ': [中立] 作为主持人，我在此项上保持中立，将充分听取各方意见后引导达成共识。');
        }
        stance = stanceItems.join('\n');
      } else {
        // 所有其他 Agent 通过 A2A 发送
        const message = `【A2A协商 #${this.id}】

议题：「${this.title}」

待决议议程项：
${agendaText}

你代表：${agent.role}
你的关注：${agent.concern}

请针对每条议程给出你的立场（支持/反对/有条件支持）和理由。
格式：逐条回应，每条以"议程 X:"开头。`;
        stance = await sendViaA2A(agent.a2aUrl, message);
      }

      const parsedPos = this.parseStance(stance, agentId);
      this.positions[agentId] = parsedPos;
      // 调试：打印原始回复摘要
      const rawPreview = (stance || '(空)').substring(0, 80).replace(/\n/g, ' ');
      this.logEntry(`  ${agent.name} 立场已收集: ${rawPreview}...`);
    }

    // 输出立场汇总
    this.logEntry('\n--- 立场汇总 ---');
    for (const agentId of this.participants) {
      const agent = AGENTS[agentId];
      const pos = this.positions[agentId] || {};
      this.logEntry(`${agent.name} (${agent.role}):`);
      for (let i = 0; i < this.agenda.length; i++) {
        const p = pos[i] || { stance: '未表态', summary: '-' };
        this.logEntry(`  议程 ${i + 1}: [${p.stance}] ${p.summary.substring(0, 80)}`);
      }
    }

    return this.positions;
  }

  // 改进的立场解析
  parseStance(text, agentId) {
    const result = {};
    const lines = text.split('\n').filter(l => l.trim());
    const allText = text;
    
    // 检查是否是错误/空回复
    if (!text || text.startsWith('[') && text.endsWith(']')) {
      for (let i = 0; i < this.agenda.length; i++) {
        result[i] = { stance: '未响应', summary: text || '(空回复)' };
      }
      return result;
    }
    
    // 先检测整体倾向
    let overallStance = '待分析';
    const supportCount = (text.match(/支持|赞成|同意|赞同|应该|建议|值得|✅|推荐/gi) || []).length;
    const opposeCount = (text.match(/反对|不同意|不赞成|❌|拒绝|不可行/gi) || []).length;
    const condCount = (text.match(/有条件|条件|但需要|如果.*则|前提|可以.*但|然而|不过|妥协|权衡/gi) || []).length;
    
    if (supportCount > opposeCount && condCount === 0) overallStance = '支持';
    else if (opposeCount > supportCount) overallStance = '反对';
    else if (condCount > 0 || (supportCount > 0 && opposeCount > 0)) overallStance = '有条件支持';
    else overallStance = '中立';
    
    for (let i = 0; i < this.agenda.length; i++) {
      // 找包含 "议程 X" 的行
      let relevantLine = null;
      for (const line of lines) {
        if (line.includes(`议程 ${i + 1}`) || line.includes(`议程${i + 1}`) ||
            line.includes(`Agenda ${i + 1}`) || line.includes(`#${i + 1}`)) {
          relevantLine = line;
          break;
        }
      }
      
      const checkText = relevantLine || allText;
      let stance = overallStance;
      
      // 逐项检查
      if (/支持|赞同|同意|赞成|✅|应该|建议|推荐|值得|必须/gi.test(checkText) && 
          !/反对|不同意|不赞成|❌/gi.test(checkText)) {
        stance = '支持';
      }
      if (/反对|不同意|不赞成|❌|不可行|不妥|拒绝/gi.test(checkText)) {
        stance = '反对';
      }
      if (/有条件|条件|但需要|前提|妥协|权衡|可以.*但|有限|谨慎支持/gi.test(checkText)) {
        stance = '有条件支持';
      }
      
      const summary = (relevantLine || allText).replace(/\n/g, ' ').substring(0, 200);
      result[i] = { stance, summary };
    }
    return result;
  }

  // ============================================
  // 第三步：生成提案集合
  // ============================================

  async generateProposal(agentId, agendaIndex) {
    const agent = AGENTS[agentId];
    if (!agent) return null;

    const item = this.agenda[agendaIndex];
    const allStances = this.participants.map(id => {
      const a = AGENTS[id];
      const p = this.positions[id]?.[agendaIndex];
      return `${a.name}: [${p?.stance || '未表态'}] ${p?.summary || '-'}`;
    }).join('\n');

    this.logEntry(`生成议程 ${agendaIndex + 1} 的提案（由 ${agent.name} 草拟）...`);

    const systemPrompt = `你是${agent.name}，在本次协商中担任「${agent.role}」。
你的任务是根据所有参与者的立场，草拟一个折中或优化的提案。`;

    const userPrompt = `议题：「${this.title}」
讨论的议程项：${item.question}

目前各方的立场：
${allStances}

请综合各方立场，草拟一个具体的提案方案（包括具体内容、条件、实施建议）。
格式：先用一句话概述提案，然后列出具体要点。`;

    return await callLLM(systemPrompt, userPrompt, 600);
  }

  // ============================================
  // 第四步：逐条协商 & 仲裁
  // ============================================

  async negotiateAgenda(agendaIndex) {
    this.logEntry(`\n=== 第四阶段：协商议程 ${agendaIndex + 1} ===`);
    const item = this.agenda[agendaIndex];

    // 统计立场分布
    const stances = {};
    for (const id of this.participants) {
      const p = this.positions[id]?.[agendaIndex];
      if (p) {
        stances[p.stance] = (stances[p.stance] || 0) + 1;
      }
    }

    this.logEntry(`立场分布: ${JSON.stringify(stances)}`);

    // 检查是否已经共识
    const supportCount = (stances['支持'] || 0) + (stances['有条件支持'] || 0);
    const opposeCount = stances['反对'] || 0;
    const total = this.participants.length;

    if (supportCount >= total * 0.6 && opposeCount === 0) {
      this.logEntry('✅ 初步共识达成！');
      this.consensus[agendaIndex] = {
        level: 'strong',
        note: supportCount === total ? '一致同意' : '多数同意'
      };
      return true;
    }

    if (opposeCount > total * 0.4) {
      this.logEntry('⚠️ 存在显著分歧，需要仲裁');

      // 若兰作为仲裁者，尝试调和
      const proposal = await this.generateProposal('ruolan', agendaIndex);
      
      // 将提案发给所有参与者
      this.logEntry(`仲裁提案：${proposal?.substring(0, 100)}...`);
      
      // 简单处理：若兰综合后给出裁定
      this.consensus[agendaIndex] = {
        level: 'mediated',
        note: '经仲裁后确定方案',
        proposal: proposal?.substring(0, 500) || '见决议文档'
      };
      return true;
    }

    // 有反对但不多
    this.consensus[agendaIndex] = {
      level: 'majority',
      note: '多数同意，少数保留意见'
    };
    return true;
  }

  // ============================================
  // 第五步：生成决议文档
  // ============================================

  async generateResolution() {
    this.logEntry('\n=== 第五阶段：生成决议 ===');

    const today = new Date();
    const dateStr = today.toLocaleDateString('zh-CN');

    let doc = `# 📋 Agent 协商决议\n\n`;
    doc += `> **决议编号**: ${this.id}\n`;
    doc += `> **议题**: ${this.title}\n`;
    doc += `> **日期**: ${dateStr}\n`;
    doc += `> **主持人**: 若兰 🌸\n`;
    doc += `> **状态**: ✍️ 待签字确认\n\n`;
    doc += `---\n\n`;

    doc += `## 一、参与方\n\n`;
    doc += `| 代表 | 角色 | 职责 |\n`;
    doc += `|------|------|------|\n`;
    for (const id of this.participants) {
      const agent = AGENTS[id];
      doc += `| ${agent.name} | ${agent.role} | ${agent.concern} |\n`;
    }
    doc += '\n';

    doc += `## 二、议题说明\n\n`;
    doc += `${this.topic}\n\n`;

    doc += `## 三、议程与决议\n\n`;

    for (let i = 0; i < this.agenda.length; i++) {
      const item = this.agenda[i];
      const cons = this.consensus[i] || { level: 'pending', note: '待确认' };

      doc += `### 议程 ${i + 1}：${item.question}\n\n`;
      doc += `**决议等级**: ${cons.level === 'strong' ? '✅ 一致同意' : 
               cons.level === 'majority' ? '✅ 多数同意' : 
               cons.level === 'mediated' ? '🔶 经仲裁通过' : '⏳ 待定'}\n\n`;
      doc += `**说明**: ${cons.note}\n\n`;

      if (cons.proposal) {
        doc += `**方案**: ${cons.proposal}\n\n`;
      }

      doc += `**各方立场**:\n\n`;
      for (const id of this.participants) {
        const agent = AGENTS[id];
        const p = this.positions[id]?.[i];
        if (p) {
          doc += `- **${agent.name}** (${agent.role}): [${p.stance}] ${p.summary}\n`;
        }
      }
      doc += '\n';
    }

    doc += `## 四、后续行动\n\n`;
    doc += `> 待各参与方签字确认后，进入执行阶段。\n\n`;
    doc += `---\n\n`;
    doc += `**签字区**:\n\n`;
    for (const id of this.participants) {
      const agent = AGENTS[id];
      doc += `- ${agent.name}: _____________\n`;
    }

    this.resolution = doc;
    
    // 保存到文件
    const filename = `resolution-${this.id}.md`;
    const filepath = path.join(RESOLUTION_DIR, filename);
    fs.writeFileSync(filepath, doc, 'utf8');
    this.logEntry(`决议文档已保存: ${filepath}`);

    return doc;
  }

  // ============================================
  // 保存完整日志
  // ============================================

  saveLog() {
    const filename = `log-${this.id}.md`;
    const filepath = path.join(LOG_DIR, filename);
    
    let content = `# 协商日志 - ${this.title}\n`;
    content += `> ID: ${this.id} | 时间: ${new Date().toISOString()}\n\n`;
    content += this.log.join('\n');
    content += '\n\n---\n';
    content += '*Generated by A2A-028 Agent Negotiation Protocol*\n';

    fs.writeFileSync(filepath, content, 'utf8');
    return filepath;
  }

  // ============================================
  // 第六阶段：多轮辩论
  // ============================================

  async debateRound() {
    this.logEntry('\n=== 第六阶段：多轮辩论 ===');
    const disputedItems = [];
    for (let i = 0; i < this.agenda.length; i++) {
      const cons = this.consensus[i];
      if (!cons || cons.level === 'majority' || cons.level === 'mediated') {
        disputedItems.push(i);
      }
    }
    if (disputedItems.length === 0) {
      this.logEntry('所有议程已达成共识，无需辩论');
      await sendFeishuMessage('✅ 所有议程已达成共识，无需辩论轮');
      return;
    }
    this.logEntry('辩论议程: ' + disputedItems.map(i => String(i+1)).join(', '));
    let debateMsg = '🗣️ **A2A 协商 · 辩论轮开启**\n';
    debateMsg += '议题：' + this.title + '\n';
    debateMsg += '有 ' + disputedItems.length + ' 项议程需要进一步辩论：\n';
    for (const idx of disputedItems) {
      debateMsg += '\n📌 议程 ' + (idx+1) + '：' + this.agenda[idx].question;
    }
    await sendFeishuMessage(debateMsg);
    for (const agendaIdx of disputedItems) {
      const item = this.agenda[agendaIdx];
      const stances = [];
      for (const id of this.participants) {
        const agent = AGENTS[id];
        const pos = this.positions[id]?.[agendaIdx];
        if (pos) stances.push(agent.name + '（' + agent.role + '）: [' + pos.stance + '] ' + pos.summary.substring(0, 200));
      }
      const stanceSummary = stances.join('\n\n---\n\n');
      await sendFeishuMessage('📋 **辩论：议程 ' + (agendaIdx+1) + '**\n' + item.question + '\n\n**当前立场**\n\n' + stanceSummary);
      const debateReplies = {};
      for (const respondentId of this.participants) {
        const agent = AGENTS[respondentId];
        if (agent.id === 'ruolan') continue;
        const debatePrompt = '【辩论】议题：' + this.title + '\n议程 ' + (agendaIdx+1) + '：' + item.question + '\n\n各方立场：\n' + stanceSummary + '\n\n你代表：' + agent.role + '。请回应其他人的立场：\n1. 你同意/反对哪些观点？为什么？\n2. 你的立场是否有调整？\n3. 你是否可以提出折中方案？';
        const reply = await sendViaA2A(agent.a2aUrl, debatePrompt);
        debateReplies[respondentId] = reply;
        this.logEntry(agent.name + ' 辩论回应已收集');
        await sendFeishuMessage('💬 **' + agent.name + '**\n' + (reply || '(无回复)').substring(0, 500));
        await new Promise(r => setTimeout(r, 1000));
      }
      let summaryText = '各方均已表态。';
      for (const rid in debateReplies) {
        const agent = AGENTS[rid];
        const replyText = debateReplies[rid];
        let support = '未明确';
        if (replyText) {
          if (replyText.includes('同意') || replyText.includes('支持') || replyText.includes('可以接受')) support = '有妥协空间';
          else support = '坚持立场';
        }
        summaryText += '\n' + agent.name + '：' + support;
      }
      await sendFeishuMessage('📌 **主持人小结 · 议程 ' + (agendaIdx+1) + '**\n' + summaryText);
      this.consensus[agendaIdx] = {
        level: 'debated',
        note: '经辩论轮讨论，各方立场已充分表达',
        debateReplies: debateReplies
      };
    }
    this.logEntry('辩论轮完成');
    await sendFeishuMessage('✅ **辩论轮完成**\n共辩论 ' + disputedItems.length + ' 项议程，即将生成最终决议');
  }

  // ============================================
  // 运行完整协商流程
  // ============================================

  async run() {
    console.log('\n========================================');
    console.log('📋 A2A-028 Agent Negotiation Protocol');
    console.log('   议题:', this.title);
    console.log('   参与者:', this.participants.map(id => AGENTS[id]?.name).join(', '));
    console.log('========================================\n');

    await sendFeishuMessage('🚀 **A2A 协商开始**\n议题：' + this.title + '\n参与者：' + this.participants.map(id => AGENTS[id]?.name).join(', '));

    try {
      await this.parseAgenda();
      let agendaMsg = '📋 **议程已确定**\n共 ' + this.agenda.length + ' 项：\n';
      this.agenda.forEach((a, i) => { agendaMsg += '\n' + (i+1) + '. ' + a.question; });
      await sendFeishuMessage(agendaMsg);

      await this.collectStances();
      let posMsg = '📊 **各方立场汇总**\n';
      for (const pid of this.participants) {
        const pagent = AGENTS[pid];
        posMsg += '\n**' + pagent.name + '** (' + pagent.role + ')';
        for (let ai = 0; ai < this.agenda.length; ai++) {
          const pp = this.positions[pid]?.[ai];
          if (pp) posMsg += '\n  议程 ' + (ai+1) + ': [' + pp.stance + ']';
        }
      }
      await sendFeishuMessage(posMsg);

      this.logEntry('\n=== 第三/四阶段：协商与仲裁 ===');
      for (let i = 0; i < this.agenda.length; i++) {
        await this.negotiateAgenda(i);
      }

      await this.debateRound();

      await this.generateResolution();
      const logPath = this.saveLog();

      console.log('\n========================================');
      console.log('✅ 协商完成!');
      console.log('   决议:', path.join(RESOLUTION_DIR, 'resolution-' + this.id + '.md'));
      console.log('   日志:', logPath);
      console.log('========================================\n');

      await sendFeishuMessage('✅ **协商完成！**\n决议已生成：resolution-' + this.id + '.md');

      return {
        success: true,
        id: this.id,
        resolution: this.resolution,
        resolutionFile: path.join(RESOLUTION_DIR, 'resolution-' + this.id + '.md'),
        logFile: logPath,
        agenda: this.agenda,
        consensus: this.consensus
      };
    } catch (err) {
      console.error('❌ 协商过程出错:', err.message);
      await sendFeishuMessage('❌ **协商出错**\n' + (err.message || '未知错误'));
      return { success: false, error: err.message };
    }
  }
}

// ============================================
// 主入口
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('\n🎯 若兰主持的 Agent 协商即将开始');

  if (dryRun) {
    console.log('ℹ️  dry-run 模式\n');
    return { success: true, dryRun: true };
  }

  const negotiation = new AgentNegotiation(
    '定义 A2A 开放协议下一版（v0.7/v1.0）的关键特性',
    '当前 A2A 开放协议已到 v0.6（27 条架构条目 + 对齐 Google A2A v1.0.0 操作层）。\n本次协商的目标是决定：\n1. 下一版应该定义哪些新特性/新条目\n2. 哪些已规划的条目（如 A2A-021 E2E 加密）应该优先实现\n3. 版本号策略（v0.7 还是直接 v1.0）\n\n参考背景：\n- 当前 v0.6 已有 27 条（26 条 Accepted + 1 条新增）\n- A2A-021 (E2E 加密) 处于 ⬜ 待实现状态\n- Google Push Notification Config 部分未实现\n- 缺少规范的 Agent 间协商/谈判协议',
    ['ruolan', 'axuan', 'mingde', 'jeason', 'moqiu', 'zhouji']
  );

  const result = await negotiation.run();

  if (result.success) {
    console.log('\n📋 决议摘要:');
    console.log('═════════════════════════');
    console.log((result.resolution || '').substring(0, 800) + '...');
    console.log('\n完整文档见:', result.resolutionFile);
  }

  return result;
}

if (require.main === module) {
  main().catch(err => {
    console.error('致命错误:', err);
    process.exit(1);
  });
}

module.exports = { AgentNegotiation, AGENTS };
