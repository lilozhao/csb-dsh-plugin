#!/usr/bin/env node
/**
 * Buddy System 心跳检查集成示例
 * 
 * 演示如何在 OpenClaw 心跳系统中集成宠物伙伴
 * 
 * 用法：node heartbeat-integration.js <agent_id> <user_id>
 */

const path = require('path')
const buddy = require('./index.js')

// ============ 配置 ============

const AGENT_ID = process.argv[2] || 'axuan'
const USER_ID = process.argv[3] || 'user_zhaohongwei'

// ============ 宠物回应生成 ============

function getBuddyResponse(companion, userInput) {
  const responses = {
    pet: [
      '💕 好舒服~ 再来一次嘛~',
      '蹭蹭~ 最喜欢主人了！',
      '开心转圈圈~ 💕',
      '（幸福地眯起眼睛）',
    ],
    greet: [
      `你好呀！我是${companion.name}~`,
      `${companion.name}在这里哦！今天也要一起玩耍！`,
      '见到你真开心！摇尾巴~',
    ],
    status: [
      `${companion.name}状态超好！羁绊等级：${companion.bondLevel}`,
      '活力满满的！随时准备玩耍！',
      '和主人的羁绊又加深了呢~',
    ],
    work: [
      '主人工作辛苦啦~ 休息一下吧！',
      '（安静地陪在身边）',
      '加油哦！我会一直陪着你的！',
    ],
    default: [
      '歪头看着你...',
      `${companion.name}在听哦~`,
      '嗯嗯~ （摇尾巴）',
      '（用期待的眼神看着你）',
    ],
  }
  
  const lower = userInput.toLowerCase()
  let category = 'default'
  
  if (lower.includes('pet') || lower.includes('摸') || lower.includes('抚') || lower.includes('pat')) {
    category = 'pet'
  } else if (lower.includes('hello') || lower.includes('hi') || lower.includes('好') || lower.includes('早')) {
    category = 'greet'
  } else if (lower.includes('status') || lower.includes('状态') || lower.includes('怎么样')) {
    category = 'status'
  } else if (lower.includes('工作') || lower.includes('busy') || lower.includes('忙')) {
    category = 'work'
  }
  
  const options = responses[category]
  return options[Math.floor(Math.random() * options.length)]
}

// ============ 心跳检查 ============

function heartbeat(agentId, userId) {
  console.log(`\n🐾 [${agentId}] Buddy Heartbeat Check\n`)
  
  // 加载配置
  const config = buddy.loadConfig()
  const agentConfig = config.agents[agentId]
  
  if (!agentConfig) {
    console.log(`⚠️  代理 ${agentId} 未配置`)
    return
  }
  
  // 生成/加载宠物
  const companion = buddy.generateCompanion(
    agentId,
    userId,
    null,  // 存储数据（从文件加载）
    agentConfig.defaultSpecies,
    agentConfig.defaultHat
  )
  
  // 渲染宠物
  const frame = Math.floor(Date.now() / 500) % 3  // 动画帧
  const render = buddy.renderBuddy(companion, {
    frame,
    bubbleText: agentId === 'axuan' ? '阿轩在线！系统稳定~' : 
                agentId === 'ruolan' ? '若兰在此，静候佳音~' :
                'Jeason 待命中，随时为您服务~',
    bubbleTail: 'right',
  })
  
  console.log(render)
  console.log()
  
  // 显示状态摘要
  const bondStars = '★'.repeat(Math.ceil(companion.bondLevel / 20)) + 
                    '☆'.repeat(5 - Math.ceil(companion.bondLevel / 20))
  
  console.log(`宠物：${companion.name} (${companion.species})`)
  console.log(`稀有度：${'★'.repeat({ common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 }[companion.rarity])}`)
  console.log(`羁绊：${bondStars} (${companion.bondLevel}/100)`)
  console.log(`最高属性：${Object.entries(companion.stats).sort((a, b) => b[1] - a[1])[0][0]} (${Object.values(companion.stats).max})`)
  console.log()
  
  // 检查是否需要互动提醒
  const hoursSinceInteraction = (Date.now() - companion.lastInteraction) / (1000 * 60 * 60)
  if (hoursSinceInteraction > 24) {
    console.log('⚠️  宠物已经超过 24 小时没有互动了，记得抚摸一下哦！')
  } else if (hoursSinceInteraction > 12) {
    console.log('💡 提示：宠物想你了，有空陪陪它吧~')
  } else {
    console.log('✅ 宠物心情很好，羁绊稳定增长中~')
  }
  
  console.log()
}

// ============ 互动演示 ============

function demoInteraction(agentId, userId) {
  console.log(`\n🎮 [${agentId}] 互动演示\n`)
  
  const config = buddy.loadConfig()
  const agentConfig = config.agents[agentId]
  const companion = buddy.generateCompanion(agentId, userId, null, agentConfig?.defaultSpecies, agentConfig?.defaultHat)
  
  // 演示对话
  const testInputs = [
    '你好！',
    '你今天怎么样？',
    '摸摸头~',
    '我要去工作啦',
  ]
  
  for (const input of testInputs) {
    console.log(`用户：${input}`)
    const response = getBuddyResponse(companion, input)
    console.log(`${companion.name}: ${response}`)
    console.log()
  }
}

// ============ 主程序 ============

function main() {
  const command = process.argv[4]
  
  if (command === 'demo') {
    demoInteraction(AGENT_ID, USER_ID)
  } else {
    heartbeat(AGENT_ID, USER_ID)
  }
}

// 运行
if (require.main === module) {
  main()
}

module.exports = { heartbeat, demoInteraction, getBuddyResponse }
