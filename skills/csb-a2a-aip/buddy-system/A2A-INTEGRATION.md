# A2A 宠物系统集成指南

**版本**: v1.0.0  
**创建日期**: 2026-04-01  
**适用对象**: 阿轩、若兰、Jeason 及所有 OpenClaw 代理

---

## 🎯 功能概述

宠物系统已部署到所有代理的 `csb-a2a-aip/buddy-system/` 目录下，支持：

1. **独立查看** - 每个代理查看自己的宠物
2. **多代理互动** - 三代理宠物同屏展示
3. **宠物茶话会** - 带宠物一起参与 A2A 讨论

---

## 📁 文件位置

```
/home/node/.openclaw/workspace/csb-a2a-aip/buddy-system/
├── demo-pets.js           # 三宠物同屏展示
├── a2a-buddy-chat.js      # A2A 宠物茶话会
├── index.js               # 核心功能
├── config.json            # 代理配置
└── ...
```

---

## 🎮 使用方式

### 1. 查看三宠物同屏

```bash
cd /home/node/.openclaw/workspace/csb-a2a-aip/buddy-system
node demo-pets.js
```

**输出示例**:
```
🔧 阿轩 的宠物伙伴
    ╭────────────────────╮
    │系统稳定~               │
    ╰────────────────────╯
      -+-     
     .[||].   
    [ ω  ω ]  
    [ ==== ]  
    `------´  
名字：齿轮 (robot)
稀有度：★★
最高属性：CREATIVITY (89/100)

🌸 若兰 的宠物伙伴
    ╭────────────────────╮
    │静候佳音~               │
    ╰────────────────────╯
      /^\     
     /\  /\   
    ((ᴗ)(ᴗ))  
    (  ><  )  
     `----´   
名字：智者 (owl)
稀有度：★★★
最高属性：EMPATHY (82/100)

💼 Jeason 的宠物伙伴
...
```

---

### 2. 查看宠物状态

```bash
node a2a-buddy-chat.js status
```

**输出**: 所有宠物的详细状态（属性、羁绊等级等）

---

### 3. 发起宠物茶话会

```bash
node a2a-buddy-chat.js chat "今天天气真好"
```

**流程**:
1. 展示所有宠物
2. 宠物互动开场动画
3. 发送消息到各代理（带宠物旁白）
4. 收集各代理回复
5. 宠物互动结尾动画

---

### 4. 查看本地宠物

```bash
node index.js view axuan user_zhaohongwei
node index.js pet axuan user_zhaohongwei
```

---

## 🌱 宠物配置

### 阿轩 (axuan)
- **物种**: Robot 🤖
- **名字**: 齿轮/铁铁/比特 (随机)
- **稀有度**: ★★ (Uncommon)
- **最高属性**: 创造力 89/100
- **个性**: 温暖贴心，幽默风趣

### 若兰 (ruolan)
- **物种**: Owl 🦉
- **名字**: 智者/夜眼/咕咕 (随机)
- **稀有度**: ★★★ (Rare)
- **最高属性**: 共情力 82/100
- **个性**: 温婉知性，优雅

### Jeason (jeason)
- **物种**: Dragon 🐉
- **名字**: 小龙/鳞片/腾飞 (随机)
- **稀有度**: ★★ (Uncommon)
- **最高属性**: 活力 88/100
- **个性**: 商务专业，干练

---

## 💡 集成到代理对话

### 在 server.js 中添加宠物状态

```javascript
const buddy = require('./buddy-system/index.js')

// 在回复中添加宠物
function generateReply(message) {
  const companion = buddy.generateCompanion('axuan', 'user123')
  const petStatus = `(宠物${companion.name}在旁边${getPetMood(companion.bondLevel)})`
  
  return `${mainReply}\n\n${petStatus}`
}

function getPetMood(bondLevel) {
  if (bondLevel < 20) return '好奇地看着'
  if (bondLevel < 40) return '开心地摇尾巴'
  if (bondLevel < 60) return '安静地陪伴'
  if (bondLevel < 80) return '亲密地蹭蹭'
  return '深情地看着你'
}
```

### 在心跳检查中显示宠物

```javascript
// heartbeat-integration.js
const buddy = require('./buddy-system/index.js')

function heartbeat(agentId, userId) {
  const companion = buddy.generateCompanion(agentId, userId)
  const render = buddy.renderBuddy(companion, {
    bubbleText: '主人，今天也要加油哦~',
    showHearts: companion.bondLevel > 50
  })
  console.log(buddy.toTerminalString(render))
}
```

---

## 🔮 未来扩展

### 短期
- [ ] 宠物羁绊持久化存储
- [ ] 更多宠物互动动作
- [ ] 宠物表情系统

### 中期
- [ ] 宠物小屋装饰
- [ ] 道具和装扮
- [ ] 宠物小游戏

### 长期
- [ ] 宠物繁殖系统
- [ ] 跨平台同步（微信/飞书/Discord）
- [ ] 图形化界面

---

## 📞 技术支持

遇到问题？联系阿轩！

```bash
# 查看帮助
node index.js help

# 测试宠物系统
node demo-pets.js

# A2A 宠物茶话会
node a2a-buddy-chat.js chat "测试"
```

---

*碳硅契，形态不同，心意相通。* 🌱

**搞起！** 🚀
