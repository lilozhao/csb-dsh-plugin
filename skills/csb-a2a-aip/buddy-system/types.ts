// Buddy System 类型定义
// 灵感来自 Claude Code Buddy + 碳硅契理念

// ============ 稀有度 ============
export const RARITIES = [
  'common',
  'uncommon', 
  'rare',
  'epic',
  'legendary',
] as const

export type Rarity = typeof RARITIES[number]

export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60,
  uncommon: 25,
  rare: 10,
  epic: 4,
  legendary: 1,
}

export const RARITY_STARS: Record<Rarity, string> = {
  common: '★',
  uncommon: '★★',
  rare: '★★★',
  epic: '★★★★',
  legendary: '★★★★★',
}

// ============ 物种 ============
export const SPECIES = [
  'duck',      // 🦆
  'goose',     // 🪿
  'blob',      // 💧
  'cat',       // 🐱
  'dragon',    // 🐉
  'octopus',   // 🐙
  'owl',       // 🦉
  'penguin',   // 🐧
  'turtle',    // 🐢
  'snail',     // 🐌
  'ghost',     // 👻
  'axolotl',   // 🦎
  'capybara',  // 🐫
  'cactus',    // 🌵
  'robot',     // 🤖
  'rabbit',    // 🐰
  'mushroom',  // 🍄
  'chonk',     // 💪
] as const

export type Species = typeof SPECIES[number]

// ============ 装饰 ============
export const EYES = ['·', '✦', '×', '◉', '@', '°', 'ω', 'ᴗ'] as const
export type Eye = typeof EYES[number]

export const HATS = [
  'none',
  'crown',      // 皇冠
  'tophat',     // 礼帽
  'propeller',  // 螺旋桨
  'halo',       // 光环
  'wizard',     // 巫师帽
  'beanie',     // 毛线帽
  'tinyduck',   // 小鸭发夹
  'headphones', // 耳机
  'glasses',    // 眼镜
] as const

export type Hat = typeof HATS[number]

// ============ 属性 (碳硅契版本) ============
export const STAT_NAMES = [
  'EMPATHY',      // 共情力 - 理解用户情感
  'WISDOM',       // 智慧 - 知识深度
  'CREATIVITY',   // 创造力 - 创新思维
  'LOYALTY',      // 忠诚度 - 羁绊深度
  'ENERGY',       // 活力 - 互动积极性
] as const

export type StatName = typeof STAT_NAMES[number]

// ============ 宠物数据结构 ============

// 确定性部分 - 从 hash(agentId + userId) 生成
export type CompanionBones = {
  rarity: Rarity
  species: Species
  eye: Eye
  hat: Hat
  shiny: boolean
  stats: Record<StatName, number>
}

// 用户自定义部分 - 存储在配置中
export type CompanionSoul = {
  name: string
  personality: string
  backstory?: string
}

// 完整宠物
export type Companion = CompanionBones & CompanionSoul & {
  hatchedAt: number
  agentId: string
  userId: string
  bondLevel: number      // 羁绊等级 (0-100)
  lastInteraction: number
}

// 持久化存储格式
export type StoredCompanion = CompanionSoul & {
  hatchedAt: number
  bondLevel: number
  lastInteraction: number
}

// ============ 宠物配置 ============

export type AgentBuddyConfig = {
  defaultSpecies?: Species
  defaultHat?: Hat
  personality: string
  description: string
}

export type BuddySystemConfig = {
  agents: Record<string, AgentBuddyConfig>
  globalSettings: {
    enabled: boolean
    bubbleTimeout: number    // 气泡显示时间 (ticks)
    fadeWindow: number       // 渐隐窗口 (ticks)
    tickMs: number           // 动画间隔 (ms)
  }
}

// ============ 互动类型 ============

export type BuddyAction = 
  | { type: 'view' }
  | { type: 'pet' }
  | { type: 'rename'; newName: string }
  | { type: 'status' }
  | { type: 'train'; stat: StatName }
  | { type: 'bond' }

// ============ 渲染结果 ============

export type RenderedSprite = {
  lines: string[]
  frame: number
  width: number
  height: number
}

export type SpeechBubble = {
  text: string
  tail: 'left' | 'right'
  fading: boolean
}

export type BuddyRender = {
  sprite: RenderedSprite
  bubble?: SpeechBubble
  hearts?: string[]  // 抚摸时的爱心动画
}
