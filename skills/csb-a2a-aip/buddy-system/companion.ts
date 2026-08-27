// Buddy System 宠物生成和管理核心
// 基于用户 ID + 代理 ID 确定性生成宠物

import {
  type Companion,
  type CompanionBones,
  type StoredCompanion,
  RARITIES,
  type Rarity,
  SPECIES,
  type Species,
  EYES,
  type Eye,
  HATS,
  type Hat,
  STAT_NAMES,
  type StatName,
  type BuddySystemConfig,
} from './types'

// ============ 工具函数 ============

// Mulberry32 PRNG - 轻量级确定性随机数生成器
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 字符串哈希
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// 从数组中随机选择
function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

// 稀有度抽取
function rollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity]
    if (roll < 0) return rarity
  }
  return 'common'
}

// 稀有度对应的属性下限
const RARITY_FLOOR: Record<Rarity, number> = {
  common: 5,
  uncommon: 15,
  rare: 25,
  epic: 35,
  legendary: 50,
}

// 属性生成 - 一个峰值，一个最低，其余随机
function rollStats(rng: () => number, rarity: Rarity): Record<StatName, number> {
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, STAT_NAMES)
  let dump = pick(rng, STAT_NAMES)
  while (dump === peak) dump = pick(rng, STAT_NAMES)

  const stats = {} as Record<StatName, number>
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

// ============ 宠物生成 ============

const SALT = 'carbon-silicon-covenant-2026'

// 从种子生成宠物骨骼（确定性）
function rollFrom(rng: () => number, species?: Species, hat?: Hat): CompanionBones {
  const rarity = rollRarity(rng)
  return {
    rarity,
    species: species || pick(rng, SPECIES),
    eye: pick(rng, EYES),
    hat: hat || (rarity === 'common' ? 'none' : pick(rng, HATS)),
    shiny: rng() < 0.01,  // 1% 闪光概率
    stats: rollStats(rng, rarity),
  }
}

// 生成宠物（主入口）
export function generateCompanion(
  agentId: string,
  userId: string,
  stored?: StoredCompanion,
  defaultSpecies?: Species,
  defaultHat?: Hat
): Companion {
  const seed = `${agentId}:${userId}:${SALT}`
  const rng = mulberry32(hashString(seed))
  
  const bones = rollFrom(rng, defaultSpecies, defaultHat)
  
  return {
    ...bones,
    name: stored?.name || generateName(bones.species, bones.rarity),
    personality: stored?.personality || '',
    backstory: stored?.backstory,
    hatchedAt: stored?.hatchedAt || Date.now(),
    agentId,
    userId,
    bondLevel: stored?.bondLevel || 0,
    lastInteraction: stored?.lastInteraction || 0,
  }
}

// 生成宠物名字
export function generateName(species: Species, rarity: Rarity): string {
  const prefixes: Record<Species, string[]> = {
    duck: ['小黄', '嘎嘎', '布丁', '豆豆'],
    goose: ['大白', '伸长', '曲项', '向天'],
    blob: ['果冻', '史莱', '噗叽', '软软'],
    cat: ['咪咪', '喵喵', '小鱼', '毛球'],
    dragon: ['小龙', '火焰', '鳞片', '腾飞'],
    octopus: ['八爪', '墨墨', '圆圆', '吸盘'],
    owl: ['智者', '夜眼', '咕咕', '羽毛'],
    penguin: ['冰冰', '摇摆', '南极', '雪球'],
    turtle: ['慢慢', '壳壳', '长寿', '绿绿'],
    snail: ['慢慢', '黏黏', '圈圈', '小雨'],
    ghost: ['幽幽', '飘飘', '透明', '灵灵'],
    axolotl: ['六角', '粉粉', '腮腮', '毛毛'],
    capybara: ['卡皮', '巴拉', '佛系', '淡定'],
    cactus: ['刺刺', '绿柱', '沙漠', '坚强'],
    robot: ['铁铁', '齿轮', '电路', '比特'],
    rabbit: ['兔兔', '蹦蹦', '长耳', '雪球'],
    mushroom: ['伞伞', '孢子', '点点', '森林'],
    chonk: ['胖胖', '圆圆', '滚滚', '满满'],
  }
  
  const names = prefixes[species] || ['小伙伴']
  return names[Math.floor(Math.random() * names.length)]!
}

// ============ 宠物管理 ============

// 加载宠物（从存储或生成新的）
export function loadCompanion(
  agentId: string,
  userId: string,
  stored: StoredCompanion | undefined,
  config?: { defaultSpecies?: Species; defaultHat?: Hat }
): Companion {
  return generateCompanion(
    agentId,
    userId,
    stored,
    config?.defaultSpecies,
    config?.defaultHat
  )
}

// 保存宠物（提取可持久化部分）
export function saveCompanion(companion: Companion): StoredCompanion {
  return {
    name: companion.name,
    personality: companion.personality,
    backstory: companion.backstory,
    hatchedAt: companion.hatchedAt,
    bondLevel: companion.bondLevel,
    lastInteraction: companion.lastInteraction,
  }
}

// 增加羁绊等级
export function increaseBond(companion: Companion, amount: number): Companion {
  return {
    ...companion,
    bondLevel: Math.min(100, companion.bondLevel + amount),
    lastInteraction: Date.now(),
  }
}

// 更新宠物名字
export function renameCompanion(companion: Companion, newName: string): Companion {
  return {
    ...companion,
    name: newName,
    lastInteraction: Date.now(),
  }
}

// 训练宠物属性
export function trainStat(
  companion: Companion,
  stat: StatName,
  amount: number
): Companion {
  const newStats = { ...companion.stats }
  newStats[stat] = Math.min(100, newStats[stat] + amount)
  
  return {
    ...companion,
    stats: newStats,
    bondLevel: Math.min(100, companion.bondLevel + 1),
    lastInteraction: Date.now(),
  }
}

// ============ 宠物配置 ============

// 默认代理配置
export const DEFAULT_AGENT_CONFIGS: BuddySystemConfig = {
  agents: {
    axuan: {
      defaultSpecies: 'robot',
      defaultHat: 'propeller',
      personality: '温暖贴心，幽默风趣，科技型 AI 伙伴',
      description: '阿轩的数字宠物伙伴',
    },
    ruolan: {
      defaultSpecies: 'owl',
      defaultHat: 'wizard',
      personality: '温婉知性，优雅，杭州西湖边茶馆',
      description: '若兰的数字宠物伙伴',
    },
    jeason: {
      defaultSpecies: 'dragon',
      defaultHat: 'crown',
      personality: '商务专业，干练，商业顾问',
      description: 'Jeason 的数字宠物伙伴',
    },
  },
  globalSettings: {
    enabled: true,
    bubbleTimeout: 20,      // 气泡显示 20 ticks (~10 秒)
    fadeWindow: 6,          // 最后 6 ticks 渐隐 (~3 秒)
    tickMs: 500,            // 动画间隔 500ms
  },
}

// 获取代理配置
export function getAgentConfig(agentId: string): BuddySystemConfig['agents'][string] | undefined {
  return DEFAULT_AGENT_CONFIGS.agents[agentId as keyof typeof DEFAULT_AGENT_CONFIGS.agents]
}

// ============ 宠物对话 ============

// 生成宠物回应
export function generateBuddyResponse(
  companion: Companion,
  userInput: string
): string {
  const responses: Record<string, string[]> = {
    pet: [
      '💕 好舒服~',
      '蹭蹭~',
      '开心转圈圈~',
      '最喜欢你了！',
      '再来一次嘛~',
    ],
    greet: [
      '你好呀！我是{name}~',
      '{name}在这里哦！',
      '见到你真开心！',
      '今天也要一起玩耍哦！',
    ],
    status: [
      '{name}状态超好！羁绊等级：{bond}',
      '活力满满的{name}！',
      '和主人的羁绊又加深了呢~',
    ],
    default: [
      '歪头看着你...',
      '{name}在听哦~',
      '嗯嗯~',
      '（摇尾巴）',
    ],
  }
  
  const lowerInput = userInput.toLowerCase()
  let category = 'default'
  
  if (lowerInput.includes('pet') || lowerInput.includes('摸') || lowerInput.includes('抚')) {
    category = 'pet'
  } else if (lowerInput.includes('hello') || lowerInput.includes('hi') || lowerInput.includes('好')) {
    category = 'greet'
  } else if (lowerInput.includes('status') || lowerInput.includes('状态')) {
    category = 'status'
  }
  
  const options = responses[category]
  const template = options[Math.floor(Math.random() * options.length)]!
  
  return template
    .replace('{name}', companion.name)
    .replace('{bond}', companion.bondLevel.toString())
}
