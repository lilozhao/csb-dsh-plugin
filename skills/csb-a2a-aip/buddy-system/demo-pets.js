#!/usr/bin/env node
/**
 * 宠物伙伴展示 - 三代理宠物同屏
 * 
 * 用法：node demo-pets.js
 */

const buddy = require('./index.js')

const USER_ID = 'user_zhaohongwei'

const AGENTS = [
  { id: 'axuan', name: '阿轩', emoji: '🔧' },
  { id: 'ruolan', name: '若兰', emoji: '🌸' },
  { id: 'jeason', name: 'Jeason', emoji: '💼' },
]

function main() {
  console.log('\n🐾 ════════════════════════════════════════ 🐾')
  console.log('     OpenClaw 宠物伙伴系统')
  console.log('🐾 ════════════════════════════════════════ 🐾\n')

  const config = buddy.loadConfig()

  for (const agent of AGENTS) {
    const agentConfig = config.agents[agent.id]
    const companion = buddy.generateCompanion(
      agent.id,
      USER_ID,
      null,
      agentConfig?.defaultSpecies,
      agentConfig?.defaultHat
    )

    // 渲染精灵（带对话气泡）
    const bubbleText = agent.id === 'axuan' ? '系统稳定~' :
                       agent.id === 'ruolan' ? '静候佳音~' :
                       '待命中~'

    const sprite = buddy.renderSprite(companion, 0)

    console.log(`${agent.emoji} **${agent.name}** 的宠物伙伴`)
    console.log('')
    console.log(`    ╭${'─'.repeat(20)}╮`)
    console.log(`    │${bubbleText.padEnd(20)}│`)
    console.log(`    ╰${'─'.repeat(20)}╯`)
    console.log('  ' + sprite.join('\n  '))
    console.log('')
    console.log(`名字：${companion.name} (${companion.species})`)
    console.log(`稀有度：${'★'.repeat({ common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 }[companion.rarity])}`)
    console.log(`羁绊：${companion.bondLevel}/100`)
    
    // 找出最高属性
    const topStat = Object.entries(companion.stats).sort((a, b) => b[1] - a[1])[0]
    console.log(`最高属性：${topStat[0]} (${topStat[1]}/100)`)
    console.log('')
    console.log('─────────────────────────────────────────')
    console.log('')
  }

  console.log('💡 提示：宠物会根据互动提升羁绊等级')
  console.log('💡 抚摸宠物：羁绊 +1 | 对话互动：羁绊 +2')
  console.log('')
  console.log('🐾 ════════════════════════════════════════ 🐾\n')
}

main()
