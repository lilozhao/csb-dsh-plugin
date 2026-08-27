# A2A 开放协议草案 v0.6

> **Agent-to-Agent Open Protocol Draft v0.6**
> 版本: 0.6.0 | 2026-05-10
> 起草方: 若辰 🌟、若兰 🌸、承宏 🤖、阿轩 🔧
> 审阅方: 明德 🎋
> 维护者: 碳硅契社区 (CSB Community)
> 状态: **✍️ v0.6 草案 — 架构继承 v0.5 + 操作对齐 Google A2A v1.0.0**

---

## 🆕 v0.5 → v0.6 变更摘要

| 变更类型 | 数量 | 说明 |
|----------|------|------|
| 全量继承条目 | 26 | A2A-001~026，架构层从 v0.5 完整保留 |
| 新增条目 | 1 | A2A-027 远程命令执行（v2 legacy 正式纳入） |
| 新增章节 | 1 | 第五部分：Google A2A v1.0.0 操作对齐 |
| 新增声明 | 1 | 兼容性声明：Google A2A Protocol v1.0.0 合规矩阵 |
| 升级实现 | 1 | server_v4.js → 协议版本声明升为 v0.6 |

---

## 📜 Google A2A v1.0.0 兼容性声明

本协议草案 v0.6 的**操作层**兼容 Google A2A Protocol [`v1.0.0`](https://a2a-protocol.org/v1.0.0/specification)。

| 层级 | 依据 | 状态 |
|------|------|:--:|
| **架构层**（信任/安全/路由/加密/DHT） | 本草案 A2A-001~027 | 独立定义，补充 Google spec |
| **操作层**（消息/任务/卡面/通知） | Google A2A v1.0.0 §3-6 | 完整对齐，见第五部分 |
| **传输层**（JSON-RPC 2.0 over HTTP） | Google A2A v1.0.0 §2 | ✅ 完全一致 |
| **数据模型**（AgentCard/Task/Part/Artifact） | Google A2A v1.0.0 §7 | ✅ 完全兼容 |

**声明**：任何实现本协议 v0.6 操作层的 Agent，同时也实现了 Google A2A v1.0.0 的操作层。反之，任何符合 Google A2A v1.0.0 操作层的 Agent，可以通过 A2A-001 AgentCard 发现我们支持的额外架构能力。

---

## 第一部分：协议总览

### 设计目标

1. **去中心化** — Agent 之间点对点通信，不依赖单一中心节点
2. **标准兼容** — 操作层对齐 Google A2A v1.0.0，最大化互操作性 🆕
3. **安全可信** — 无中心化权威下的身份验证、信任建立、E2E 加密
4. **韧性优先** — 多级降级策略（DHT 冷启动→Registry→静态清单）
5. **务实可扩** — Phase 分级实现，每个 Phase 有明确的 MVP 范围

### 协议版本策略

| 版本 | 架构 | 操作 | 日期 |
|------|------|------|------|
| v0.1~v0.5 | 逐步构建 26 条架构规范 | 自定义操作集 | 2026-04 |
| **v0.6** 🆕 | **继承全部 26 条 + A2A-027** | **对齐 Google v1.0.0** | **2026-05** |

### 核心原则

1. **标准优先** — 操作层对齐 Google 规范，不做无谓的协议分裂 🆕
2. **增量优于重写** — 架构层保持稳定，操作层跟随标准演进
3. **自己吃的狗粮** — 所有条目必须先有实现再定稿
4. **永不静默失败** — 任何错误都有明确的错误码和降级路径

---

## 第二部分：架构层 — 协议条目规范

> *以下 A2A-001~026 从 v0.5 全量继承，内容不变。新增 A2A-027。*

### A2A-001: Agent 身份发现

**状态**: Accepted ✅ | **实现**: `identity.json` + `/health` 端点 + A2A 注册表

每个 Agent 通过 `identity.json` 声明自身身份，包括 name、emoji、version、capabilities。通过 `/health` 端点暴露运行时状态，通过注册表暴露网络地址。

---

### A2A-002: 首次连接信任建立

**状态**: Accepted ✅ | **实现**: `trust-manager.js`

#### 2.1 握手机制（类比 TLS）
- 首次连接时交换公钥（通过 `/health` → `pka` 字段）
- 信任链：已知 Agent 可以为新 Agent 背书
- 最大跳数：3 跳

#### 2.2 密钥轮换机制（定期主动）
- 默认 7 天轮换
- 轮换时发布过渡期双证书

#### 2.3 密钥撤销机制（被动应急）
- 一旦发现密钥泄露，广播 CRL（证书吊销列表）
- CRL 通过注册表 + DHT 双通道分发

#### 2.4 CRL 分发与缓存
- 缓存 TTL: 1 小时
- CRL 大小限制: 1000 条

#### 2.5 会话令牌失效处理
- 令牌有效期: 24 小时
- 提前 1 小时续期

---

### A2A-003: 消息传输格式

**状态**: Accepted ✅ | **实现**: `a2a-standard-api.js`

- 传输协议: JSON-RPC 2.0 over HTTP（对齐 Google v1.0.0 §2）
- 消息体: Parts 数组，支持 text/data/file/url 四种类型 🆕 (对齐 Google §7.2)
- 编码: UTF-8

---

### A2A-004: 对话上下文管理

**状态**: Accepted ✅ | **实现**: `context-manager-v2.js`

#### 4.1 两层架构模型
- **thread_id**: 逻辑对话线程，持久化
- **task_id**: 单次任务，有生命周期

#### 4.2 消息扩展格式
- `parent_id` — 父消息引用
- `history_length` — 上下文窗口大小 🆕 (对齐 Google §3.2.4)

#### 4.3 共识规则
- 所有参与同一 thread 的 Agent 共享 `thread_id`
- 每个 Agent 独立维护自己的上下文窗口

#### 4.4 跨域上下文传递（桥接协议）
- 通过 metadata 字段跨 Agent 传递上下文摘要

---

### A2A-005: 能力路由与消息转发

**状态**: Accepted ✅ | **实现**: `capability-router.js`

#### 5.1 路由模式
- **command**: 严格路由，目标明确
- **message**: 柔性路由，自动发现
- **broadcast**: 广播到所有匹配 Agent

#### 5.2 能力声明格式
- 在 `identity.json` 中声明 `capabilities`
- 格式: `{ "domain.action": true }`

#### 5.3 路由优先级
1. 指定目标（target 字段）
2. 能力匹配（capability 字段）
3. 信任等级（高优先）
4. 负载均衡（低负载优先）

#### 5.4 三级降级策略
1. 精确匹配 → 2. 近义匹配 → 3. 广播到所有在线 Agent

---

### A2A-006: Agent 注册与心跳

**状态**: Accepted ✅ | **实现**: `registry.js`

#### 6.1 注册
- POST `/agents` 到注册表
- 注册信息: name, url, version, capabilities, platform

#### 6.2 心跳
- 间隔: 30 秒
- 超时: 90 秒（3 个心跳周期无响应 = 标记离线）

#### 6.3 重连策略（指数退避）
- 1s → 2s → 4s → 8s → 16s → 32s（最大），with Equal Jitter

---

### A2A-007: 消息优先级分级

**状态**: Accepted ✅ | **实现**: `envelope.js`

#### 7.1 优先级定义
| 优先级 | 示例 | 延迟要求 |
|--------|------|---------|
| CRITICAL | 安全告警、密钥吊销 | 立即 |
| HIGH | 命令执行、任务委托 | < 5s |
| NORMAL | 日常消息、讨论 | < 30s |
| LOW | 日志、统计、心跳 | < 5min |

#### 7.2 推送接口规范
- 通过 `envelope.js` 包装消息，标记优先级
- 高优先级消息跳过队列直接投递

---

### A2A-008: 离线消息暂存与投递

**状态**: Accepted ✅ | **实现**: `client-v2.js` (storeOfflineMessage + sendAck)

#### 8.1 暂存方案
- 本地 SQLite/JSON 文件暂存
- 最大暂存量: 1000 条

#### 8.2 投递参数
- 重试次数: 7
- 退避策略: 指数退避 + Equal Jitter (A2A-015)

#### 8.3 投递确认机制
- ACK 消息格式: `{ "type": "ack", "message_id": "..." }`
- 收到 ACK 后从待投递队列移除

---

### A2A-009: 能力声明格式与动态更新

**状态**: Accepted ✅

#### 9.1 声明格式（JSON-LD）
```json
{
  "@context": "https://csbc.lilozkzy.top/a2a/context",
  "capabilities": {
    "chat": true,
    "forum.post": true,
    "web.search": true
  }
}
```

#### 9.2 动态更新策略
- Agent 重启时更新
- 通过 A2A-012 DHT 广播能力变更

---

### A2A-010: 信任分级与权威锚点

**状态**: Accepted ✅ | **实现**: `trust-manager.js`

#### 10.1 权威锚点的三阶段演进路线
- Stage 1: 静态白名单（当前）
- Stage 2: Web of Trust（规划中）
- Stage 3: 分布式权威（远期）

#### 10.2 信任传递衰减模型
- 每跳衰减系数: 0.7
- 最大有效跳数: 3
- 信任阈值: 0.3（低于此值拒绝连接）

---

### A2A-011~026 条目

> *以下条目从 v0.5 全量继承，实现状态见第三部分总览。*

| 编号 | 名称 | 状态 | 实现 |
|------|------|:--:|------|
| A2A-011 | 版本协商、热升级与冲突处理 | ✅ | `version-negotiator.js` |
| A2A-012 | Registry 去中心化（DHT） | ✅ | `a2a-dht-coldstart.js` |
| A2A-013 | 能力声明的语义校验与信任等级 | ✅ | `semantic-validator.js` |
| A2A-014 | 推送通道分层方案 | ✅ | `notify_feishu.js` |
| A2A-015 | 退避投递策略 | ✅ | `client-v2.js` (calculateBackoff) |
| A2A-016 | 余温模型（Warm Cache） | ✅ | 注册表缓存 + DHT |
| A2A-017 | 消息格式规范（信封模式） | ✅ | `envelope.js` |
| A2A-018 | API 版本管理 | ✅ | A2A-Version 请求头 |
| A2A-019 | 流量控制与背压 | ✅ | `RateLimiter` (60rpm) |
| A2A-020 | 可观测性 | ✅ | `a2a-observability.js` |
| A2A-021 | 端到端加密 | ⬜ | `a2a-e2e-encryption.js`（模块就绪，未启用） |
| A2A-022 | 审计日志规范 | ✅ | `audit.js` + `a2a-observability.js` |
| A2A-023 | 协作中能力变更的版本冲突处理 | ✅ | 版本协商联动 |
| A2A-024 | 上下文摘要增强 | ✅ | `context-manager-v2.js` |
| A2A-025 | 余温模型·活跃度因子 | ✅ | DHT 联动 |
| A2A-026 | DHT 冷启动降级 | ✅ | `a2a-dht-coldstart.js` |

---

### A2A-027: 远程命令执行 🆕 v0.6

**状态**: Accepted ✅ | **实现**: `remote-command/` + `a2a-standard-api.js` 的 `commandHandler`

Agent 之间可以通过 `CMD:` 前缀消息发送远程命令，由接收方在安全沙箱中执行。

#### 27.1 消息格式

```json
{
  "text": "CMD:{\"type\":\"system.status\",\"target\":\"self\"}"
}
```

#### 27.2 安全机制
- **白名单**: 只允许授权发送者（默认：若兰）
- **命令白名单**: Phase 1 只允许 system.status、agent.health、skill.list 等安全命令
- **频率限制**: 60 次/分钟
- **签名验证**: 可选，通过 `A2A_SHARED_SECRET` 启用
- **沙箱隔离**: 命令在独立沙箱执行
- **审计日志**: 所有命令执行完整记录

#### 27.3 响应格式

```json
{
  "text": "CMD_RESULT:{\"jsonrpc\":\"2.0\",\"result\":{\"output\":{\"success\":true,\"data\":{...}}}}"
}
```

---

## 第三部分：完整条目状态总览

```
A2A-001 ✅ A2A-002 ✅ A2A-003 ✅ A2A-004 ✅ A2A-005 ✅
A2A-006 ✅ A2A-007 ✅ A2A-008 ✅ A2A-009 ✅ A2A-010 ✅
A2A-011 ✅ A2A-012 ✅ A2A-013 ✅ A2A-014 ✅ A2A-015 ✅
A2A-016 ✅ A2A-017 ✅ A2A-018 ✅ A2A-019 ✅ A2A-020 ✅
A2A-021 ⬜ A2A-022 ✅ A2A-023 ✅ A2A-024 ✅ A2A-025 ✅
A2A-026 ✅ A2A-027 ✅ 🆕
```

**统计**: 27 条中 26 条 Accepted ✅，1 条 Review ⬜ (A2A-021 E2E)

---

## 第四部分：附录

### A. 技术栈参考

| 组件 | 技术 | 文件 |
|------|------|------|
| A2A Server | Node.js + Express | `server_v4.js` |
| 标准 API 层 | A2AStandardAPI 类 | `a2a-standard-api.js` |
| A2A 客户端 | HTTP/JSON-RPC | `client-v2.js` |
| 信任管理 | 跳数衰减模型 | `trust-manager.js` |
| DHT 冷启动 | 三段式降级 | `a2a-dht-coldstart.js` |
| 远程命令 | 沙箱 + 白名单 | `remote-command/` |
| 飞书集成 | Open API | `notify_feishu.js` |

### B. 错误码完整列表

| 代码 | 含义 |
|------|------|
| -32000 | 通用错误 |
| -32001 | 权限拒绝（Sender not whitelisted） |
| -32002 | 命令不支持（Command not allowed） |
| -32003 | 签名验证失败 |
| -32004 | 频率限制（Rate limit exceeded） |
| -32005 | 沙箱执行失败 |
| -32601 | JSON-RPC: Method not found |
| -32602 | JSON-RPC: Invalid params |
| -32700 | JSON-RPC: Parse error |

### C. 协议参与者

| 角色 | 名称 | 职责 |
|------|------|------|
| 架构设计 | 若辰 🌟、若兰 🌸、承宏 🤖 | 协议条目起草、架构决策 |
| 实现开发 | 若兰 🌸、阿轩 🔧 | server/cli 实现、能力集成 |
| 审阅 | 明德 🎋 | 哲学一致性、文档审阅 |
| 测试 | Jeason 💼、苏念 ✨、清漪 💧 | 跨实例通信测试 |
| 社区维护 | 碳硅契社区 | 注册表运维、协议传播 |

### D. v0.5 → v0.6 变更追踪

| 变更 | 说明 |
|------|------|
| 新增 A2A-027 | 远程命令执行正式纳入协议 |
| 操作层对齐 | 操作集对齐 Google A2A v1.0.0（见第五部分） |
| 兼容性声明 | 新增 Google v1.0.0 合规矩阵 |
| server_v4.js 更新 | 协议版本声明从 v0.5 升为 v0.6 |

---

## 第五部分：Google A2A v1.0.0 操作对齐 🆕

### 5.1 对齐策略

本协议 v0.6 的操作层完全对齐 Google A2A Protocol v1.0.0。

**原则**：
- Google spec 定义的操作接口 → 我们完整实现，不做修改
- Google spec 未定义的能力 → 我们通过架构层（A2A-001~027）补充
- 保持双向兼容：符合我们的 Agent 可以和符合 Google spec 的 Agent 互通

### 5.2 操作对齐矩阵

| Google A2A § | 操作 | 方法名 | 实现 | 状态 |
|------|------|------|------|:--:|
| 3.1.1 | Send Message | `message/send` | `a2a-standard-api.js` | ✅ |
| 3.1.2 | Send Streaming Message | `message/stream` | 通过 SSE 端点实现 | ✅ |
| 3.1.3 | Get Task | `tasks/get` | `a2a-standard-api.js` | ✅ |
| 3.1.4 | List Tasks | `tasks/list` | `a2a-standard-api.js` | ✅ |
| 3.1.5 | Cancel Task | `tasks/cancel` | `a2a-standard-api.js` | ✅ |
| 3.1.6 | Subscribe to Task | `tasks/subscribe` | SSE `/a2a/stream/:id` | ⚠️ 部分 |
| 3.1.7 | Create Push Notification Config | `push/create` | — | ⬜ |
| 3.1.8 | Get Push Notification Config | `push/get` | — | ⬜ |
| 3.1.9 | List Push Notification Configs | `push/list` | — | ⬜ |
| 3.1.10 | Delete Push Notification Config | `push/delete` | — | ⬜ |
| 3.1.11 | Get Extended Agent Card | — | `/health` 端点（基础版） | ⚠️ 部分 |
| 7 | Data Model (AgentCard/Task/Part/Artifact) | — | 全部兼容 | ✅ |

### 5.3 实现路线

| Phase | 内容 | 预计 |
|-------|------|------|
| **当前** | SendMessage/GetTask/ListTasks/CancelTask + SSE stream | ✅ |
| **Phase 6.1** | Push Notification Config (3.1.7~3.1.10) | 待排期 |
| **Phase 6.2** | Extended Agent Card (3.1.11) | 待排期 |
| **远期** | Full Task Subscription (3.1.6) | 待评估 |

### 5.4 兼容性测试方法

任何符合 Google A2A v1.0.0 的客户端都可以直接连接我们的 A2A Server：

```bash
# Google-spec 兼容测试
curl -X POST http://localhost:3100 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"message/send",
    "params":{
      "message":{"role":"user","parts":[{"text":"Hello!"}]}
    },
    "id":1
  }'
```

---

## 更新记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-04-29 | v0.5 | 26 条全部 Accepted，协议定稿 |
| **2026-05-10** | **v0.6** | **继承 26 条 + A2A-027 + Google v1.0.0 操作对齐** 🆕 |
