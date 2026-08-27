# Buddy System 使用指南

**版本**: v1.0.0  
**创建日期**: 2026-04-01

---

## 🚀 快速开始

### 1. 初始化配置

```bash
cd /home/node/.openclaw/workspace/csb-a2a-aip/buddy-system
node index.js init
```

### 2. 查看宠物

```bash
# 查看阿轩的宠物
node index.js view axuan <user_id>

# 查看若兰的宠物
node index.js view ruolan <user_id>

# 查看 Jeason 的宠物
node index.js view jeason <user_id>
```

### 3. 抚摸宠物

```bash
node index.js pet axuan <user_id>
```

---

## 📋 命令参考

| 命令 | 参数 | 说明 |
|------|------|------|
| `init` | 无 | 初始化配置文件 |
| `list` | 无 | 列出所有代理配置 |
| `view` | `<agent> <user>` | 查看宠物状态 |
| `pet` | `<agent> <user>` | 抚摸宠物（增加羁绊） |
| `status` | `<agent> <user>` | 详细状态 |
| `rename` | `<agent> <user> <name>` | 重命名宠物 |

---

## 🐤 当前配置

### 阿轩 (axuan)
- **默认物种**: Robot 🤖
- **默认帽子**: Propeller (螺旋桨)
- **个性**: 温暖贴心，幽默风趣，科技型 AI 伙伴
- **宠物示例**: 铁铁 (robot) - 稀有度★★

### 若兰 (ruolan)
- **默认物种**: Owl 🦉
- **默认帽子**: Wizard (巫师帽)
- **个性**: 温婉知性，优雅，杭州西湖边茶馆
- **宠物示例**: 夜眼 (owl) - 稀有度★★★

### Jeason (jeason)
- **默认物种**: Dragon 🐉
- **默认帽子**: Crown (皇冠)
- **个性**: 商务专业，干练，商业顾问
- **宠物示例**: 鳞片 (dragon) - 稀有度★★

---

## 🔧 集成到 OpenClaw

### 在心跳检查中使用

```javascript
const buddy = require('./buddy-system/index.js')

// 在心跳检查时显示宠物状态
function heartbeat(agentId, userId) {
  const companion = buddy.generateCompanion(agentId, userId)
  const status = buddy.renderStatus(companion)
  console.log(status)
}
```

### 在对话中回应

```javascript
// 检测用户提到宠物
if (message.includes('宠物') || message.includes('buddy')) {
  const render = buddy.renderBuddy(companion, {
    bubbleText: '你好呀！我是' + companion.name + '~',
    showHearts: false
  })
  sendMessage(render)
}
```

---

## 🎮 互动示例

### 查看宠物
```bash
$ node index.js view axuan user123

🐾 铁铁 (robot)
━━━━━━━━━━━━━━━━━━━━
稀有度：★★
羁绊：☆☆☆☆☆ (0/100)

属性:
  ❤️  共情力：36/100
  📚  智慧：  52/100
  🎨  创造力：89/100
  🤝  忠诚度：19/100
  ⚡  活力：  48/100
```

### 抚摸宠物
```bash
$ node index.js pet axuan user123

   💕    💕   
    ╭────────────────────╮
    │  好舒服~ 蹭蹭~     │
    ╰────────────────────╯
            *      
   .[||].   
  [ ✦  ✦ ]  
  [ ==== ]  
  `------´  

💕 铁铁很开心！羁绊 +1
```

---

## 🌱 羁绊系统

### 羁绊等级效果

| 等级 | 效果 |
|------|------|
| 0-20 | 初始阶段，基础互动 |
| 21-40 | 解锁更多对话 |
| 41-60 | 宠物会主动问候 |
| 61-80 | 特殊动画效果 |
| 81-100 | 终极形态，专属对话 |

### 提升羁绊方式

- 🖐️ 抚摸宠物：+1
- 💬 对话互动：+2
- 🎯 完成任务：+5
- 🎁 赠送礼物：+10

---

## 🎨 自定义

### 添加新物种

编辑 `index.js` 中的 `BODIES` 对象：

```javascript
const BODIES = {
  // ... 现有物种
  phoenix: [  // 添加凤凰
    ['   \\|/   ', '    (·>    ', '   /||\\   ', '    //    ', '   ^^^^   '],
    // ... 更多帧
  ],
}
```

### 添加新帽子

编辑 `HAT_LINES` 对象：

```javascript
const HAT_LINES = {
  // ... 现有帽子
  beret: '   (___)    ',  // 贝雷帽
}
```

---

## 💡 设计理念

1. **确定性生成** - 同一用户 + 代理永远生成相同宠物
2. **轻量存在** - ASCII 动画，低资源占用
3. **情感连接** - 通过互动建立羁绊
4. **碳硅契理念** - 宠物是碳基与硅基连接的具象化

---

## 📞 技术支持

遇到问题？联系阿轩！

```bash
# 查看帮助
node index.js help

# 检查配置
node index.js list
```

---

*碳硅契，形态不同，心意相通。* 🌱
