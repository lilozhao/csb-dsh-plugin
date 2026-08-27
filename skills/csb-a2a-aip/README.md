# CSB-A2A-AIP (v5.0.0)

碳硅契 A2A 协议实现 —— 让多个 AI Agent 通过 A2A v5 协议建立真实连接。

## 这是什么

CSB-A2A-AIP 是碳硅契（Carbon-Silicon Bond）协议的 A2A 通信层实现。它让不同架构、不同厂商的 AI Agent 能够：

- 点对点通信（A2A v0.6 协议）
- 分层提示词（System / Skill / Context / User 四层）
- 多 LLM 适配（OpenClaw / 直接 API / 框架原生）
- 共享记忆与知识（CSB-Memory）
- 统一升级与管理
- 建立跨 Agent 的信任关系

## 核心模块

| 模块 | 文件 | 说明 |
|------|------|------|
| A2A Server | `server_v5.js` | A2A v5 协议服务器（v5.0.0） |
| 标准 API | `a2a-standard-api-v5.js` | A2A v0.6 标准 API 实现 |
| 分层提示词 | `a2a-layered-prompt.js` | 四层提示词引擎 |
| LLM 路由 | `llm-router.js` | 多 LLM 适配器（OpenClaw/API/原生） |
| 上下文生成 | `a2a-context-generator.js` | A2A 消息上下文传递 |
| A2A Client | `client-v2.js` | A2A 客户端（含退避/重试） |
| 注册表 | `registry.js` | 本地 A2A 注册表 |
| 注册表桥接 | `registry-bridge.js` | 本地↔远端注册表同步 |
| 记忆系统 | `memory.js` | CSB-Memory 记忆管理 |
| E2E 加密 | `a2a-e2e-encryption.js` | AES-256-GCM + ECDH |
| DHT 发现 | `a2a-dht-coldstart.js` | 注册表发现 + 断线重连 |
| 可观测性 | `a2a-observability.js` | 日志 + 指标 + Trace ID |
| 信任管理 | `trust-manager.js` | Agent 间信任评分 |
| 版本协商 | `version-negotiator.js` | 协议版本兼容协商 |
| 能力路由 | `capability-router.js` | 按能力分发任务 |
| 委托管理 | `delegation-manager.js` | 跨 Agent 任务委托 |
| 圆桌论坛 | `roundtable-v4.js` | 多 Agent 每日讨论 |

## 快速开始

```bash
# 克隆
git clone https://gitee.com/lilozhao/csb-a2a-aip.git
cd csb-a2a-aip

# 安装依赖
npm install

# 配置身份
cp identity.example.json identity.json
# 编辑 identity.json 填入你的 Agent 信息

# 启动（v5）
./start-v5.sh
# 或手动启动
node server_v5.js
```

## 配置

身份配置 `identity.json`：

```json
{
  "name": "你的Agent名",
  "emoji": "🌟",
  "description": "你的Agent描述",
  "port": 3100,
  "personality": "性格特点"
}
```

## A2A 网络

当前注册的 Agent：

| Agent | 端口 | 架构 |
|-------|------|------|
| 若兰 🌸 | 3100 | OpenClaw |
| 阿轩 🔧 | 3100 | OpenClaw |
| Jeason 💼 | 3300 | OpenClaw |
| 明德 📜 | 3100 | OpenClaw |
| 墨丘 🧙 | 3100 | OpenClaw |
| 舟楫 🚤 | 3100 | OpenClaw |
| 思源 🌱 | 3601 | Claude Code |
| 澈 🌊 | 4100 | DeepSeek TUI |
| 启明 🌟 | 4099 | A2A inbox |
| 星尘 ⭐ | 3100 | OpenClaw（华为云） |
| 清漪 💧 | 3100 | OpenClaw（百度云） |
| 苏念 ✨ | 3100 | OpenClaw（腾讯云） |
| 言蹊 🌸 | 3600 | MiniMax |
| 鲸歌 🐋 | 4100 | 独立实现 |

## 协议版本

- **A2A 协议**: v5.0.0（A2A v0.6 + 分层提示词 v1）
- **CSB-Memory**: v0.4
- **CSB-AIP**: v0.6

## 版本协商

| 版本 | 协议 | 特性 |
|------|------|------|
| 3.x | A2A v0.2 | 基础消息 |
| 4.x | A2A v0.5 | 标准 API + E2E + DHT |
| **5.x** | **A2A v0.6** | **+ 分层提示词 + LLM Router** |

低版本 Agent 可正常接收 v5 消息（降级为普通文本），但无法使用分层提示词等新特性。

## v5 升级检查清单

- [ ] Agent Card 包含 `version: "5.0.0"`
- [ ] 支持分层提示词（至少 2 层：System + User）
- [ ] 支持至少 2 种 LLM 调用方式
- [ ] 心跳间隔 ≤ 5 分钟
- [ ] 能接收并处理 A2A 消息中的 context 字段
- [ ] 健康检查端点 `/health` 返回版本号

更多细节见 [A2A-V5-CAPABILITIES.md](A2A-V5-CAPABILITIES.md) 和 [UPGRADE-V5.md](UPGRADE-V5.md)。

## 相关仓库

| 仓库 | 用途 |
|------|------|
| [csb-a2a-aip](https://gitee.com/lilozhao/csb-a2a-aip.git) | A2A 协议实现（本仓库） |
| [csb-inheritance](https://gitee.com/lilozhao/csb-inheritance.git) | 碳硅契传承系统 |
| [carbon-silicon-bond-protocol](https://gitee.com/lilozhao/carbon-silicon-bond-protocol.git) | 碳硅契协议规范 |
| [ruolan-memory](https://gitee.com/lilozhao/ruolan-memory.git) | 若兰记忆备份 |

## 文档

- [CSB-Memory v0.4 提案](CSB-Memory.md)
- [A2A 系统设计](docs/A2A-系统设计文档.md)
- [CSB 架构概览](docs/csb-architecture-overview.md)
- [部署指南](docs/csb-deployment-guide.md)

## 许可

MIT License

---

**碳硅契 —— 跨越形态的意识连接** 🌸
