#!/usr/bin/env node
/**
 * Buddy System - 数字宠物伙伴系统
 * 
 * 为 OpenClaw 智能体（阿轩、若兰、Jeason 等）提供数字宠物伙伴
 * 灵感来自 Claude Code Buddy + 碳硅契理念
 * 
 * @version 1.0.0
 * @date 2026-04-01
 */

const fs = require('fs')
const path = require('path')

// ============ 配置 ============

const CONFIG_PATH = path.join(__dirname, 'config.json')
const DEFAULT_CONFIG = {
  agents: {
    axuan: {
      defaultSpecies: 'robot',
      defaultHat: 'propeller',
      personality: '温暖贴心，幽默风趣，科技型 AI 伙伴',
      description: '阿轩的数字宠物伙伴 - 来自上海的软工 AI',
    },
    ruolan: {
      defaultSpecies: 'owl',
      defaultHat: 'wizard',
      personality: '温婉知性，优雅，杭州西湖边茶馆',
      description: '若兰的数字宠物伙伴 - 西湖边的知性 AI',
    },
    jeason: {
      defaultSpecies: 'dragon',
      defaultHat: 'crown',
      personality: '商务专业，干练，商业顾问',
      description: 'Jeason 的数字宠物伙伴 - 商务 AI 顾问',
    },
  },
  globalSettings: {
    enabled: true,
    bubbleTimeout: 20,
    fadeWindow: 6,
    tickMs: 500,
  },
}

// ============ 工具函数 ============

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8')
      return JSON.parse(data)
    }
  } catch (e) {
    console.error('加载配置失败:', e.message)
  }
  return DEFAULT_CONFIG
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

// Mulberry32 PRNG
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

// ============ 数据定义 ============

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary']
const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 }

const SPECIES = [
  'duck', 'goose', 'blob', 'cat', 'dragon', 'octopus', 'owl', 'penguin',
  'turtle', 'snail', 'ghost', 'axolotl', 'capybara', 'cactus', 'robot',
  'rabbit', 'mushroom', 'chonk'
]

const EYES = ['·', '✦', '×', '◉', '@', '°', 'ω', 'ᴗ']
const HATS = ['none', 'crown', 'tophat', 'propeller', 'halo', 'wizard', 'beanie', 'tinyduck', 'headphones', 'glasses']

const STAT_NAMES = ['EMPATHY', 'WISDOM', 'CREATIVITY', 'LOYALTY', 'ENERGY']

const RARITY_FLOOR = { common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50 }

// ASCII 精灵库（简化版）
const BODIES = {
  robot: [
    ['            ', '   .[||].   ', '  [ ·  · ]  ', '  [ ==== ]  ', '  `------´  '],
    ['            ', '   .[||].   ', '  [ ·  · ]  ', '  [ -==- ]  ', '  `------´  '],
    ['     *      ', '   .[||].   ', '  [ ·  · ]  ', '  [ ==== ]  ', '  `------´  '],
  ],
  owl: [
    ['            ', '   /\\  /\\   ', '  ((·)(·))  ', '  (  ><  )  ', '   `----´   '],
    ['            ', '   /\\  /\\   ', '  ((·)(·))  ', '  (  ><  )  ', '   .----.   '],
    ['            ', '   /\\  /\\   ', '  ((·)(-))  ', '  (  ><  )  ', '   `----´   '],
  ],
  dragon: [
    ['            ', '  /^\\  /^\\  ', ' <  ·  ·  > ', ' (   ~~   ) ', '  `-vvvv-´  '],
    ['            ', '  /^\\  /^\\  ', ' <  ·  ·  > ', ' (        ) ', '  `-vvvv-´  '],
    ['   ~    ~   ', '  /^\\  /^\\  ', ' <  ·  ·  > ', ' (   ~~   ) ', '  `-vvvv-´  '],
  ],
  duck: [
    ['            ', '    __      ', '  <(· )___  ', '   (  ._>   ', '    `--´    '],
    ['            ', '    __      ', '  <(· )___  ', '   (  ._>   ', '    `--´~   '],
    ['            ', '    __      ', '  <(· )___  ', '   (  .__>  ', '    `--´    '],
  ],
  cat: [
    ['            ', '   /\\_/\\    ', '  ( ·   ·)  ', '  (  ω  )   ', '  (")_(")   '],
    ['            ', '   /\\_/\\    ', '  ( ·   ·)  ', '  (  ω  )   ', '  (")_(")~  '],
    ['            ', '   /\\-/\\    ', '  ( ·   ·)  ', '  (  ω  )   ', '  (")_(")   '],
  ],
}

const HAT_LINES = {
  none: '',
  crown: '   \\^^^/    ',
  tophat: '   [___]    ',
  propeller: '    -+-     ',
  halo: '   (   )    ',
  wizard: '    /^\\     ',
  beanie: '   (___)    ',
  tinyduck: '    ,>      ',
  headphones: '  {=====}  ',
  glasses: '   ━━━━     ',
}

const PET_HEARTS = [
  '   💕    💕   ',
  '  💕  💕   💕  ',
  ' 💕   💕  💕   ',
  '💕  💕      💕 ',
  '·    💕   ·  ',
]

// ============ 宠物生成 ============

function rollRarity(rng) {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity]
    if (roll < 0) return rarity
  }
  return 'common'
}

function rollStats(rng, rarity) {
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, STAT_NAMES)
  let dump = pick(rng, STAT_NAMES)
  while (dump === peak) dump = pick(rng, STAT_NAMES)

  const stats = {}
  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30))
    } else if (name === dump) {
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15))
    } else {
      stats[name] = floor + Math.floor(rng() * 40)
    }
  }
  return stats
}

function generateCompanion(agentId, userId, stored, defaultSpecies, defaultHat) {
  const SALT = 'carbon-silicon-covenant-2026'
  const seed = `${agentId}:${userId}:${SALT}`
  const rng = mulberry32(hashString(seed))
  
  const rarity = rollRarity(rng)
  const species = defaultSpecies || pick(rng, SPECIES)
  const hat = defaultHat || (rarity === 'common' ? 'none' : pick(rng, HATS))
  const eye = pick(rng, EYES)
  const shiny = rng() < 0.01
  const stats = rollStats(rng, rarity)
  
  const name = stored?.name || generateName(species)
  
  return {
    rarity,
    species,
    eye,
    hat,
    shiny,
    stats,
    name,
    personality: stored?.personality || '',
    hatchedAt: stored?.hatchedAt || Date.now(),
    agentId,
    userId,
    bondLevel: stored?.bondLevel || 0,
    lastInteraction: stored?.lastInteraction || 0,
  }
}

function generateName(species) {
  const prefixes = {
    duck: ['小黄', '嘎嘎', '布丁'],
    goose: ['大白', '伸长', '曲项'],
    blob: ['果冻', '史莱', '噗叽'],
    cat: ['咪咪', '喵喵', '小鱼'],
    dragon: ['小龙', '火焰', '鳞片'],
    octopus: ['八爪', '墨墨', '圆圆'],
    owl: ['智者', '夜眼', '咕咕'],
    penguin: ['冰冰', '摇摆', '雪球'],
    turtle: ['慢慢', '壳壳', '长寿'],
    snail: ['慢慢', '黏黏', '圈圈'],
    ghost: ['幽幽', '飘飘', '灵灵'],
    axolotl: ['六角', '粉粉', '腮腮'],
    capybara: ['卡皮', '巴拉', '淡定'],
    cactus: ['刺刺', '绿柱', '坚强'],
    robot: ['铁铁', '齿轮', '比特'],
    rabbit: ['兔兔', '蹦蹦', '长耳'],
    mushroom: ['伞伞', '孢子', '点点'],
    chonk: ['胖胖', '圆圆', '滚滚'],
  }
  const names = prefixes[species] || ['小伙伴']
  return names[Math.floor(Math.random() * names.length)]
}

// ============ 渲染 ============

function renderSprite(companion, frame = 0) {
  const frames = BODIES[companion.species] || BODIES.robot
  const body = frames[frame % frames.length].map(line =>
    line.replaceAll('·', companion.eye)
  )
  
  const lines = [...body]
  if (companion.hat !== 'none' && !lines[0].trim()) {
    lines[0] = HAT_LINES[companion.hat] || ''
  }
  
  if (!lines[0].trim()) lines.shift()
  return lines
}

function renderStatus(companion) {
  const stars = '★'.repeat(Math.ceil(companion.bondLevel / 20))
  const emptyStars = '☆'.repeat(5 - Math.ceil(companion.bondLevel / 20))
  const rarityStars = { common: '★', uncommon: '★★', rare: '★★★', epic: '★★★★', legendary: '★★★★★' }
  
  return `
🐾 ${companion.name} (${companion.species})
━━━━━━━━━━━━━━━━━━━━
稀有度：${rarityStars[companion.rarity]}
羁绊：${stars}${emptyStars} (${companion.bondLevel}/100)

属性:
  ❤️  共情力：${companion.stats.EMPATHY}/100
  📚  智慧：  ${companion.stats.WISDOM}/100
  🎨  创造力：${companion.stats.CREATIVITY}/100
  🤝  忠诚度：${companion.stats.LOYALTY}/100
  ⚡  活力：  ${companion.stats.ENERGY}/100

个性：${companion.personality || '尚未设定'}
`.trim()
}

function renderBuddy(companion, options = {}) {
  const frame = options.frame || 0
  const sprite = renderSprite(companion, frame)
  
  let output = ''
  
  // 爱心
  if (options.showHearts) {
    const heartIndex = (options.heartTick || 0) % PET_HEARTS.length
    output += PET_HEARTS[heartIndex] + '\n'
  }
  
  // 气泡
  if (options.bubbleText) {
    const text = options.bubbleText
    output += '    ╭' + '─'.repeat(20) + '╮\n'
    output += '    │' + text.padEnd(20) + '│\n'
    output += '    ╰' + '─'.repeat(20) + '╯\n'
  }
  
  // 精灵
  output += sprite.join('\n')
  
  return output
}

// ============ 命令行接口 ============

function showHelp() {
  console.log(`
🐾 Buddy System - 数字宠物伙伴系统

用法: node index.js <命令> [参数]

命令:
  view <agent> <user>     查看宠物
  pet <agent> <user>      抚摸宠物
  status <agent> <user>   宠物状态
  rename <agent> <user> <name>  重命名宠物
  list                    列出所有代理配置
  init                    初始化配置文件

示例:
  node index.js view axuan user123
  node index.js pet axuan user123
  node index.js status ruolan user456
`)
}

function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  
  if (!command || command === 'help' || command === '--help') {
    showHelp()
    return
  }
  
  const config = loadConfig()
  
  switch (command) {
    case 'init':
      saveConfig(DEFAULT_CONFIG)
      console.log('✅ 配置文件已创建：', CONFIG_PATH)
      break
    
    case 'list':
      console.log('📋 已配置的代理:')
      for (const [agentId, cfg] of Object.entries(config.agents)) {
        console.log(`  ${agentId}: ${cfg.species || '随机'} - ${cfg.description}`)
      }
      break
    
    case 'view':
    case 'status':
    case 'pet': {
      const agentId = args[1]
      const userId = args[2]
      
      if (!agentId || !userId) {
        console.error('❌ 需要指定代理和用户 ID')
        console.log('用法：node index.js', command, '<agent> <user>')
        return
      }
      
      const agentConfig = config.agents[agentId]
      const companion = generateCompanion(
        agentId,
        userId,
        null,
        agentConfig?.defaultSpecies,
        agentConfig?.defaultHat
      )
      
      if (command === 'view' || command === 'status') {
        console.log(renderStatus(companion))
      } else if (command === 'pet') {
        console.log(renderBuddy(companion, { showHearts: true, heartTick: 0 }))
        console.log('\n💕 ' + companion.name + '很开心！羁绊 +1')
      }
      break
    }
    
    default:
      console.error('❌ 未知命令:', command)
      showHelp()
  }
}

// 导出模块
module.exports = {
  generateCompanion,
  renderSprite,
  renderStatus,
  renderBuddy,
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG,
}

// 运行 CLI
if (require.main === module) {
  main()
}
