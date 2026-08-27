// Buddy System 渲染引擎
// 负责 ASCII 精灵、对话气泡、爱心动画的渲染

import type {
  Companion,
  RenderedSprite,
  SpeechBubble,
  BuddyRender,
  Species,
  Eye,
  Hat,
} from './types'
import { renderSprite as renderSpriteBase, renderFace, PET_HEARTS } from './sprites'

// ============ 常量 ============

const TICK_MS = 500           // 动画间隔
const BUBBLE_SHOW = 20        // 气泡显示 ticks (~10 秒)
const FADE_WINDOW = 6         // 渐隐窗口 (最后~3 秒)
const PET_BURST_MS = 2500     // 抚摸后爱心持续时间

// Idle 动画序列：大部分静止，偶尔抖动，罕见眨眼
const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0]

// ============ 精灵渲染 ============

export function renderSprite(
  companion: Companion,
  frameIndex = 0
): RenderedSprite {
  const lines = renderSpriteBase(
    companion.species,
    companion.eye,
    companion.hat,
    frameIndex
  )
  
  return {
    lines,
    frame: frameIndex,
    width: 12,
    height: lines.length,
  }
}

// 获取下一帧索引
export function getNextFrame(currentTick: number): number {
  const seqIndex = currentTick % IDLE_SEQUENCE.length
  const frame = IDLE_SEQUENCE[seqIndex]!
  
  // -1 表示眨眼（用 frame 0）
  return frame === -1 ? 0 : frame
}

// ============ 对话气泡渲染 ============

// 文本换行
function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  
  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  
  if (current) lines.push(current)
  return lines
}

export function renderSpeechBubble(
  text: string,
  tail: 'left' | 'right' = 'right',
  fading = false,
  maxWidth = 30
): SpeechBubble {
  return {
    text,
    tail,
    fading,
  }
}

// 渲染气泡为 ASCII
export function renderBubbleAscii(bubble: SpeechBubble): string[] {
  const lines = wrapText(bubble.text, 28)
  const borderColor = bubble.fading ? 'dim' : 'bright'
  
  // 气泡边框
  const topBorder = '╭' + '─'.repeat(28) + '╮'
  const bottomBorder = '╰' + '─'.repeat(28) + '╯'
  
  const borderedLines = lines.map(line => {
    const padded = line.padEnd(28)
    return `│${padded}│`
  })
  
  const result = [topBorder, ...borderedLines, bottomBorder]
  
  // 添加尾巴
  if (bubble.tail === 'right') {
    result[result.length - 1] = result[result.length - 1]! + '─'
  } else {
    result[0] = '─' + result[0]
  }
  
  return result
}

// ============ 爱心动画 ============

export function renderPetHearts(tick: number): string[] | undefined {
  const totalTicks = Math.ceil(PET_BURST_MS / TICK_MS) // ~5 ticks
  
  if (tick >= totalTicks) return undefined
  
  const frameIndex = tick % PET_HEARTS.length
  return [PET_HEARTS[frameIndex]!]
}

// ============ 完整渲染 ============

export interface RenderOptions {
  showBubble?: boolean
  bubbleText?: string
  bubbleTail?: 'left' | 'right'
  showHearts?: boolean
  heartTick?: number
  currentTick?: number
}

export function renderBuddy(
  companion: Companion,
  options: RenderOptions = {}
): BuddyRender {
  const currentTick = options.currentTick || 0
  const frame = getNextFrame(currentTick)
  
  // 渲染精灵
  const sprite = renderSprite(companion, frame)
  
  // 渲染气泡
  let bubble: SpeechBubble | undefined
  if (options.showBubble && options.bubbleText) {
    const fading = currentTick > (BUBBLE_SHOW - FADE_WINDOW)
    bubble = renderSpeechBubble(
      options.bubbleText,
      options.bubbleTail || 'right',
      fading
    )
  }
  
  // 渲染爱心
  let hearts: string[] | undefined
  if (options.showHearts && options.heartTick !== undefined) {
    hearts = renderPetHearts(options.heartTick)
  }
  
  return {
    sprite,
    bubble,
    hearts,
  }
}

// ============ 终端输出 ============

// 将渲染结果转换为终端字符串
export function toTerminalString(render: BuddyRender, withColors = true): string {
  const lines: string[] = []
  
  // 爱心（如果有）
  if (render.hearts) {
    lines.push(...render.hearts)
  }
  
  // 气泡（如果有）- 在精灵上方右侧
  if (render.bubble) {
    const bubbleLines = renderBubbleAscii(render.bubble)
    const padding = ' '.repeat(15)
    for (const line of bubbleLines) {
      lines.push(padding + line)
    }
  }
  
  // 精灵
  for (const line of render.sprite.lines) {
    lines.push(line)
  }
  
  // 添加颜色（如果支持）
  if (withColors) {
    // TODO: 添加 ANSI 颜色代码
  }
  
  return lines.join('\n')
}

// ============ 状态显示 ============

export function renderCompanionStatus(companion: Companion): string {
  const stars = '★'.repeat(Math.ceil(companion.bondLevel / 20))
  const emptyStars = '☆'.repeat(5 - Math.ceil(companion.bondLevel / 20))
  
  return `
🐾 ${companion.name} (${companion.species})
━━━━━━━━━━━━━━━━━━━━
稀有度：${'★'.repeat({ common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 }[companion.rarity])}
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

// ============ 工具函数 ============

// 计算帧索引
export function calculateFrame(elapsedMs: number): number {
  return Math.floor(elapsedMs / TICK_MS)
}

// 检查是否需要渐隐
export function shouldFade(tick: number, showDuration = BUBBLE_SHOW): boolean {
  return tick > (showDuration - FADE_WINDOW)
}
