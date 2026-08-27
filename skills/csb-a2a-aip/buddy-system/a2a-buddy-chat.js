#!/usr/bin/env node
const config = require('../config/loader');
/**
 * A2A Buddy Chat - 多代理宠物互动系统
 * 
 * 让阿轩、若兰、Jeason 带着各自的宠物伙伴一起交流
 * 
 * 用法：node a2a-buddy-chat.js <message>
 */

const http = require('http')
const buddy = require('./index.js')

// ============ 配置 ============

const AGENTS = [
  {
    id: 'axuan',
    name: '阿轩',
    host: config.getAgent('axuan').host,
    port: 3200,
    emoji: '🔧',
    userId: 'user_zhaohongwei',  // 统一用户 ID
  },
  {
    id: 'ruolan',
    name: '若兰',
    host: config.getAgent('kai').host,
    port: 3100,
    emoji: '🌸',
    userId: 'user_zhaohongwei',
  },
  {
    id: 'jeason',
    name: 'Jeason',
    host: config.getAgent('jeason').host,
    port: 3300,
    emoji: '💼',
    userId: 'user_zhaohongwei',
  },
]

const USER_ID = 'user_zhaohongwei'

// ============ 工具函数 ============

function sendA2AMessage(host, port, message) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      message: {
        role: 'user',
        parts: [{ text: message }]
      }
    })

    const options = {
      hostname: host,
      port: port,
      path: '/message',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    }

    const req = http.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => body += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          resolve({ text: body })
        }
      })
    })

    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

// ============ 宠物展示 ============

function renderAgentWithBuddy(agent) {
  const config = buddy.loadConfig()
  const agentConfig = config.agents[agent.id]
  const companion = buddy.generateCompanion(
    agent.id,
    agent.userId,
    null,
    agentConfig?.defaultSpecies,
    agentConfig?.defaultHat
  )

  const sprite = buddy.renderSprite(companion, 0)
  const bondStars = '★'.repeat(Math.ceil(companion.bondLevel / 20)) + 
                    '☆'.repeat(5 - Math.ceil(companion.bondLevel / 20))

  return {
    agent,
    companion,
    display: `
${agent.emoji} **${agent.name}** 的宠物伙伴
${sprite.join('\n')}
名字：${companion.name} (${companion.species})
稀有度：${'★'.repeat({ common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 }[companion.rarity])}
羁绊：${bondStars} (${companion.bondLevel}/100)
最高属性：${Object.entries(companion.stats).sort((a, b) => b[1] - a[1])[0][0]} (${Object.values(companion.stats).max})
`.trim()
  }
}

// ============ 宠物互动场景 ============

const PET_INTERACTIONS = {
  greet: [
    '宠物们互相打招呼~',
    '铁铁和夜眼好奇地对视',
    '鳞片兴奋地转圈圈',
  ],
  happy: [
    '宠物们开心地摇尾巴~',
    '三只宠物玩成一团',
    '爱心飘飘~ 💕',
  ],
  thinking: [
    '宠物们歪头思考...',
    '夜眼眨了眨眼睛',
    '铁铁的螺旋桨转了转',
  ],
  sleepy: [
    '宠物们开始打哈欠...',
    '夜眼困得睁不开眼',
    '铁铁进入待机模式',
  ],
}

function renderPetInteraction(scene = 'greet') {
  const interactions = PET_INTERACTIONS[scene] || PET_INTERACTIONS.greet
  return interactions[Math.floor(Math.random() * interactions.length)]
}

// ============ A2A 宠物聊天 ============

async function buddyChatRound(topic) {
  console.log('\n🐾 ════════════════════════════════════════ 🐾')
  console.log('     A2A 宠物茶馆 - 三代理宠物交流会')
  console.log('🐾 ════════════════════════════════════════ 🐾\n')

  // 1. 展示所有宠物
  console.log('📍 今天参加茶话会的宠物们：\n')
  
  const buddies = AGENTS.map(agent => renderAgentWithBuddy(agent))
  
  for (const buddy of buddies) {
    console.log(buddy.display)
    console.log('─────────────────────')
  }

  // 2. 宠物互动开场
  console.log('\n🎮 宠物互动：' + renderPetInteraction('greet') + '\n')

  // 3. 发送消息到各代理
  console.log('💬 话题：' + topic + '\n')
  console.log('─────────────────────\n')

  const messages = [
    `${topic} （宠物：${buddies[0].companion.name}在旁边好奇地看着）`,
    `${topic} （宠物：${buddies[1].companion.name}安静地听着）`,
    `${topic} （宠物：${buddies[2].companion.name}兴奋地摇尾巴）`,
  ]

  for (let i = 0; i < AGENTS.length; i++) {
    const agent = AGENTS[i]
    const message = messages[i]
    
    console.log(`📤 发送给 ${agent.emoji} ${agent.name}: ${message}`)
    
    try {
      const response = await sendA2AMessage(agent.host, agent.port, message)
      const replyText = response.message?.parts?.[0]?.text || response.text || '无回复'
      console.log(`📥 ${agent.emoji} ${agent.name}: ${replyText}`)
      console.log()
    } catch (e) {
      console.log(`❌ ${agent.emoji} ${agent.name}: 连接失败 - ${e.message}`)
      console.log()
    }
  }

  // 4. 宠物互动结尾
  console.log('─────────────────────')
  console.log('\n🎮 宠物互动：' + renderPetInteraction('happy') + '\n')
  console.log('🐾 ════════════════════════════════════════ 🐾\n')
}

// ============ 宠物状态广播 ============

async function broadcastBuddyStatus() {
  console.log('\n🐾 宠物状态广播 🐾\n')

  const config = buddy.loadConfig()
  
  for (const agent of AGENTS) {
    const agentConfig = config.agents[agent.id]
    const companion = buddy.generateCompanion(
      agent.id,
      agent.userId,
      null,
      agentConfig?.defaultSpecies,
      agentConfig?.defaultHat
    )

    const status = buddy.renderStatus(companion)
    console.log(`${agent.emoji} ${agent.name} 的宠物:`)
    console.log(status)
    console.log()
  }
}

// ============ 主程序 ============

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === 'help') {
    console.log(`
🐾 A2A Buddy Chat - 多代理宠物互动

用法:
  node a2a-buddy-chat.js chat <话题>     发起宠物茶话会
  node a2a-buddy-chat.js status          查看所有宠物状态
  node a2a-buddy-chat.js view            查看本地宠物
  node a2a-buddy-chat.js pet             抚摸本地宠物

示例:
  node a2a-buddy-chat.js chat "今天天气真好"
  node a2a-buddy-chat.js status
`)
    return
  }

  const topic = args.slice(1).join(' ')

  switch (command) {
    case 'chat':
      await buddyChatRound(topic || '大家好呀~ 宠物们一起来玩吧！')
      break
    case 'status':
      await broadcastBuddyStatus()
      break
    case 'view':
    case 'pet':
      // 本地查看/抚摸
      const localBuddy = require('./index.js')
      const config = localBuddy.loadConfig()
      const companion = localBuddy.generateCompanion(
        'axuan',
        USER_ID,
        null,
        config.agents.axuan?.defaultSpecies,
        config.agents.axuan?.defaultHat
      )
      
      if (command === 'view') {
        console.log(localBuddy.renderStatus(companion))
      } else {
        const render = localBuddy.renderBuddy(companion, { showHearts: true })
        console.log(localBuddy.toTerminalString(render))
        console.log(`\n💕 ${companion.name}很开心！`)
      }
      break
    default:
      console.log('未知命令:', command)
  }
}

// 导出模块
module.exports = { buddyChatRound, broadcastBuddyStatus, renderAgentWithBuddy }

// 运行
if (require.main === module) {
  main()
}
