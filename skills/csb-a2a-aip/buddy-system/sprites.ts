// Buddy System ASCII 精灵库
// 每个物种 3 帧动画，5 行×12 列

import type { Species, Eye, Hat } from './types'

// 精灵帧数据 - 每个物种 3 帧
const BODIES: Record<Species, string[][]> = {
  duck: [
    ['            ', '    __      ', '  <(· )___  ', '   (  ._>   ', '    `--´    '],
    ['            ', '    __      ', '  <(· )___  ', '   (  ._>   ', '    `--´~   '],
    ['            ', '    __      ', '  <(· )___  ', '   (  .__>  ', '    `--´    '],
  ],
  goose: [
    ['            ', '     (·>    ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
    ['            ', '    (·>     ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
    ['            ', '     (·>>   ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
  ],
  blob: [
    ['            ', '   .----.   ', '  ( ·  · )  ', '  (      )  ', '   `----´   '],
    ['            ', '  .------.  ', ' (  ·  ·  ) ', ' (        ) ', '  `------´  '],
    ['            ', '    .--.    ', '   (·  ·)   ', '   (    )   ', '    `--´    '],
  ],
  cat: [
    ['            ', '   /\\_/\\    ', '  ( ·   ·)  ', '  (  ω  )   ', '  (")_(")   '],
    ['            ', '   /\\_/\\    ', '  ( ·   ·)  ', '  (  ω  )   ', '  (")_(")~  '],
    ['            ', '   /\\-/\\    ', '  ( ·   ·)  ', '  (  ω  )   ', '  (")_(")   '],
  ],
  dragon: [
    ['            ', '  /^\\  /^\\  ', ' <  ·  ·  > ', ' (   ~~   ) ', '  `-vvvv-´  '],
    ['            ', '  /^\\  /^\\  ', ' <  ·  ·  > ', ' (        ) ', '  `-vvvv-´  '],
    ['   ~    ~   ', '  /^\\  /^\\  ', ' <  ·  ·  > ', ' (   ~~   ) ', '  `-vvvv-´  '],
  ],
  octopus: [
    ['            ', '   .----.   ', '  ( ·  · )  ', '  (______)  ', '  /\\/\\/\\/\\  '],
    ['            ', '   .----.   ', '  ( ·  · )  ', '  (______)  ', '  \\/\\/\\/\\/  '],
    ['     o      ', '   .----.   ', '  ( ·  · )  ', '  (______)  ', '  /\\/\\/\\/\\  '],
  ],
  owl: [
    ['            ', '   /\\  /\\   ', '  ((·)(·))  ', '  (  ><  )  ', '   `----´   '],
    ['            ', '   /\\  /\\   ', '  ((·)(·))  ', '  (  ><  )  ', '   .----.   '],
    ['            ', '   /\\  /\\   ', '  ((·)(-))  ', '  (  ><  )  ', '   `----´   '],
  ],
  penguin: [
    ['            ', '  .---.     ', '  (·>·)     ', ' /(   )\\    ', '  `---´     '],
    ['            ', '  .---.     ', '  (·>·)     ', ' |(   )|    ', '  `---´     '],
    ['  .---.     ', '  (·>·)     ', ' /(   )\\    ', '  `---´     ', '   ~ ~      '],
  ],
  turtle: [
    ['            ', '   _,--._   ', '  ( ·  · )  ', ' /[______]\\ ', '  ``    ``  '],
    ['            ', '   _,--._   ', '  ( ·  · )  ', ' /[______]\\ ', '   ``  ``   '],
    ['            ', '   _,--._   ', '  ( ·  · )  ', ' /[======]\\ ', '  ``    ``  '],
  ],
  snail: [
    ['            ', ' ·    .--.  ', '  \\  ( @ )  ', '   \\_`--´   ', '  ~~~~~~~   '],
    ['            ', '  ·   .--.  ', '  |  ( @ )  ', '   \\_`--´   ', '  ~~~~~~~   '],
    ['            ', ' ·    .--.  ', '  \\  ( @  ) ', '   \\_`--´   ', '   ~~~~~~   '],
  ],
  ghost: [
    ['            ', '   .----.   ', '  / ·  · \\  ', '  |      |  ', '  ~`~``~`~  '],
    ['            ', '   .----.   ', '  / ·  · \\  ', '  |      |  ', '  `~`~~`~`  '],
    ['    ~  ~    ', '   .----.   ', '  / ·  · \\  ', '  |      |  ', '  ~~`~~`~~  '],
  ],
  axolotl: [
    ['            ', '}~(______)~{', '}~(· .. ·)~{', '  ( .--. )  ', '  (_/  \\_)  '],
    ['            ', '~}(______){~', '~}(· .. ·){~', '  ( .--. )  ', '  (_/  \\_)  '],
    ['            ', '}~(______)~{', '}~(· .. ·)~{', '  (  --  )  ', '  ~_/  \\_~  '],
  ],
  capybara: [
    ['            ', '  n______n  ', ' ( ·    · ) ', ' (   oo   ) ', '  `------´  '],
    ['            ', '  n______n  ', ' ( ·    · ) ', ' (   Oo   ) ', '  `------´  '],
    ['    ~  ~    ', '  u______n  ', ' ( ·    · ) ', ' (   oo   ) ', '  `------´  '],
  ],
  cactus: [
    ['            ', ' n  ____  n ', ' | |·  ·| | ', ' |_|    |_| ', '   |    |   '],
    ['            ', '    ____    ', ' n |·  ·| n ', ' |_|    |_| ', '   |    |   '],
    [' n        n ', ' |  ____  | ', ' | |·  ·| | ', ' |_|    |_| ', '   |    |   '],
  ],
  robot: [
    ['            ', '   .[||].   ', '  [ ·  · ]  ', '  [ ==== ]  ', '  `------´  '],
    ['            ', '   .[||].   ', '  [ ·  · ]  ', '  [ -==- ]  ', '  `------´  '],
    ['     *      ', '   .[||].   ', '  [ ·  · ]  ', '  [ ==== ]  ', '  `------´  '],
  ],
  rabbit: [
    ['            ', '   (\\__/)   ', '  ( ·  · )  ', ' =(  ..  )= ', '  (")__(")  '],
    ['            ', '   (|__/)   ', '  ( ·  · )  ', ' =(  ..  )= ', '  (")__(")  '],
    ['            ', '   (\\__/)   ', '  ( ·  · )  ', ' =( .  . )= ', '  (")__(")  '],
  ],
  mushroom: [
    ['            ', ' .-o-OO-o-. ', '(__________)', '   |·  ·|   ', '   |____|   '],
    ['            ', ' .-O-oo-O-. ', '(__________)', '   |·  ·|   ', '   |____|   '],
    ['   . o  .   ', ' .-o-OO-o-. ', '(__________)', '   |·  ·|   ', '   |____|   '],
  ],
  chonk: [
    ['            ', '  /\\    /\\  ', ' ( ·    · ) ', ' (   ..   ) ', '  `------´  '],
    ['            ', '  /\\    /|  ', ' ( ·    · ) ', ' (   ..   ) ', '  `------´  '],
    ['            ', '  /\\    /\\  ', ' ( ·    · ) ', ' (   ..   ) ', '  `------´~ '],
  ],
}

// 帽子 ASCII 艺术
const HAT_LINES: Record<Hat, string> = {
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

// 渲染精灵
export function renderSprite(
  species: Species,
  eye: Eye,
  hat: Hat,
  frame = 0
): string[] {
  const frames = BODIES[species]
  if (!frames) return getFallbackSprite()
  
  const body = frames[frame % frames.length].map(line =>
    line.replaceAll('·', eye)
  )
  
  const lines = [...body]
  
  // 添加帽子（仅当第 0 行为空时）
  if (hat !== 'none' && !lines[0]!.trim()) {
    lines[0] = HAT_LINES[hat]
  }
  
  // 移除空白行优化
  if (!lines[0]!.trim() && frames.every(f => !f[0]!.trim())) {
    lines.shift()
  }
  
  return lines
}

// 后备精灵（未知物种）
function getFallbackSprite(): string[] {
  return [
    '            ',
    '   .----.   ',
    '  ( ?  ? )  ',
    '  (      )  ',
    '   `----´   ',
  ]
}

// 获取物种的帧数
export function getFrameCount(species: Species): number {
  return BODIES[species]?.length || 3
}

// 渲染脸部表情
export function renderFace(species: Species, eye: Eye): string {
  switch (species) {
    case 'duck':
    case 'goose':
      return `(${eye}>`
    case 'blob':
      return `(${eye}${eye})`
    case 'cat':
      return `=${eye}ω${eye}=`
    case 'dragon':
      return `<${eye}~${eye}>`
    case 'octopus':
      return `~(${eye}${eye})~`
    case 'owl':
      return `(${eye})(${eye})`
    case 'penguin':
      return `(${eye}>)`
    case 'turtle':
      return `[${eye}_${eye}]`
    case 'snail':
      return `${eye}(@)`
    case 'ghost':
      return `/${eye}${eye}\\`
    case 'axolotl':
      return `}${eye}.${eye}{`
    case 'capybara':
      return `(${eye}oo${eye})`
    case 'cactus':
      return `|${eye}  ${eye}|`
    case 'robot':
      return `[${eye}${eye}]`
    case 'rabbit':
      return `(${eye}..${eye})`
    case 'mushroom':
      return `|${eye}  ${eye}|`
    case 'chonk':
      return `(${eye}.${eye})`
    default:
      return `(${eye}${eye})`
  }
}

// 爱心动画帧
export const PET_HEARTS = [
  '   💕    💕   ',
  '  💕  💕   💕  ',
  ' 💕   💕  💕   ',
  '💕  💕      💕 ',
  '·    💕   ·  ',
]

// 稀有度颜色（终端 ANSI）
export const RARITY_COLORS: Record<string, string> = {
  common: '\x1b[90m',     // 灰色
  uncommon: '\x1b[92m',   // 绿色
  rare: '\x1b[94m',       // 蓝色
  epic: '\x1b[95m',       // 紫色
  legendary: '\x1b[93m',  // 金色
}

export function resetColor(): string {
  return '\x1b[0m'
}
