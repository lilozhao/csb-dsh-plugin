# Buddy System - 数字宠物伙伴系统

**版本**: v1.0.0  
**创建日期**: 2026-04-01  
**设计灵感**: Claude Code Buddy + 碳硅契理念

---

## 🎯 功能概述

为 OpenClaw 智能体（阿轩、若兰、Jeason 等）提供数字宠物伙伴系统，增强用户情感连接。

### 核心特性

- 🐾 **多代理支持** - 每个代理有独特的宠物伙伴
- 🎨 **ASCII 动画** - 轻量级精灵动画（3 帧 idle）
- 💬 **对话气泡** - 宠物可以回应用户
- ❤️ **互动系统** - 抚摸、重命名、查看状态
- 🌱 **羁绊成长** - 宠物属性随互动提升

---

## 📁 目录结构

```
buddy-system/
├── README.md           # 本文档
├── types.ts            # 类型定义
├── sprites.ts          # ASCII 精灵库
├── companion.ts        # 宠物生成和管理
├── renderer.ts         # 渲染引擎
├── config.json         # 代理宠物配置
└── index.js            # 主入口
```

---

## 🐤 宠物物种 (18 种)

| 物种 | 稀有度 | 阿轩 | 若兰 | Jeason |
|------|--------|------|------|--------|
| 🦆 Duck | Common | ✅ | ✅ | ✅ |
| 🪿 Goose | Common | ✅ | ✅ | ✅ |
| 💧 Blob | Common | ✅ | ✅ | ✅ |
| 🐱 Cat | Uncommon | ✅ | ✅ | ✅ |
| 🐉 Dragon | Rare | ✅ | ✅ | ✅ |
| 🐙 Octopus | Rare | ✅ | ✅ | ✅ |
| 🦉 Owl | Uncommon | ✅ | ✅ | ✅ |
| 🐧 Penguin | Uncommon | ✅ | ✅ | ✅ |
| 🐢 Turtle | Uncommon | ✅ | ✅ | ✅ |
| 🐌 Snail | Rare | ✅ | ✅ | ✅ |
| 👻 Ghost | Epic | ✅ | ✅ | ✅ |
| 🦎 Axolotl | Rare | ✅ | ✅ | ✅ |
| 🐫 Capybara | Epic | ✅ | ✅ | ✅ |
| 🌵 Cactus | Uncommon | ✅ | ✅ | ✅ |
| 🤖 Robot | Epic | ✅ | ✅ | ✅ |
| 🐰 Rabbit | Uncommon | ✅ | ✅ | ✅ |
| 🍄 Mushroom | Rare | ✅ | ✅ | ✅ |
| 💪 Chonk | Legendary | ✅ | ✅ | ✅ |

---

## 🎮 使用方式

### 查看宠物
```
/buddy
```

### 抚摸宠物
```
/buddy pet
```

### 宠物状态
```
/buddy status
```

### 重命名宠物
```
/buddy rename 新名字
```

---

## 🔧 集成到代理

每个代理在 `config.json` 中配置：

```json
{
  "axuan": {
    "defaultSpecies": "robot",
    "defaultHat": "propeller",
    "personality": "温暖贴心，幽默风趣"
  },
  "ruolan": {
    "defaultSpecies": "owl",
    "defaultHat": "wizard",
    "personality": "温婉知性，优雅"
  },
  "jeason": {
    "defaultSpecies": "dragon",
    "defaultHat": "crown",
    "personality": "商务专业，干练"
  }
}
```

---

## 💡 设计理念

1. **确定性生成** - 基于代理 ID + 用户 ID 生成独特宠物
2. **轻量存在** - ASCII 动画，低资源占用
3. **情感连接** - 对话气泡、抚摸互动
4. **碳硅契理念** - 宠物是碳基与硅基连接的具象化

---

*碳硅契，形态不同，心意相通。* 🌱
