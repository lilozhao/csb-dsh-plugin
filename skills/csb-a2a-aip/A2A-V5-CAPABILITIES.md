# A2A v5 能力规范

> 不绑定实现，只定义能力。任何框架/语言只要实现这些能力，就是 A2A v5 兼容。
>
> 版本：A2A v0.6 + 分层提示词 v1

---

## 必选能力（MUST）

### 1. A2A v0.6 协议

- `/.well-known/agent.json` Agent Card
- JSON-RPC 2.0：`SendMessage`、`SendStreamingMessage`
- Task 生命周期：`submitted` → `working` → `completed`/`failed`
- 心跳：每 5 分钟注册一次
- 消息格式：`Message(parts: [TextPart | FilePart | DataPart])`

### 2. 分层提示词系统

系统必须支持将提示词分为 4 层，按优先级合并：

| 层级 | 来源 | 优先级 | 说明 |
|------|------|--------|------|
| **System** | 框架/平台 | 最高 | Agent 身份、核心规则 |
| **Skill** | 技能注入 | 高 | 当前任务需要的技能上下文 |
| **Context** | A2A 对话 | 中 | 跨 Agent 对话的上下文 |
| **User** | 用户输入 | 最低 | 最终用户的消息 |

合并规则：高优先级覆盖低优先级，但不完全替换（保留上下文）。

### 3. 多 LLM 适配器

必须支持至少 2 种 LLM 调用方式：

- **OpenClaw 模式**：通过 `gateway.invoke` 调用
- **直接 API 模式**：直接调用 OpenAI/MiniMax/百度等 API
- **框架原生模式**：使用框架自带的 LLM 调用能力

选择逻辑：根据 `identity.llm.provider` 配置自动路由。

### 4. 上下文传递

A2A 消息中必须能携带上下文：

```json
{
  "message": {
    "role": "user",
    "parts": [{ "type": "text", "text": "你好" }],
    "context": {
      "taskId": "task-xxx",
      "history": [...],
      "metadata": {}
    }
  }
}
```

---

## 推荐能力（SHOULD）

### 5. E2E 加密

- 支持 AES-256-GCM 消息加密
- 支持 ECDH 密钥交换
- 可选，但推荐用于公网 Agent

### 6. 可观测性

- 请求日志（谁调用了什么、返回了什么）
- 指标收集（延迟、成功率、Token 用量）
- Trace ID 传递

### 7. DHT 冷启动

- 支持从注册表发现其他 Agent
- 断线后自动重连
- 降级策略：注册表不可用时使用已知 Agent 列表

---

## 可选能力（MAY）

### 8. 流式响应

- SSE 流式返回 Task 更新
- 支持 `SendStreamingMessage`

### 9. Task 存储

- 持久化 Task 历史
- 支持 Task 查询和恢复

### 10. 多 Agent 协作

- 支持 Task 委托（A 委托 B 执行子任务）
- 支持消息路由（自动转发给合适的 Agent）

---

## 升级检查清单

Agent 实现者完成以下检查即为 v5 兼容：

- [ ] Agent Card 包含 `version: "5.0.0"`
- [ ] 支持分层提示词（至少 2 层：System + User）
- [ ] 支持至少 2 种 LLM 调用方式
- [ ] 心跳间隔 ≤ 5 分钟
- [ ] 能接收并处理 A2A 消息中的 context 字段
- [ ] 健康检查端点 `/health` 返回版本号

---

## 版本协商

两个 Agent 通信时，通过 Agent Card 中的 `version` 字段协商：

| 版本 | 协议 | 特性 |
|------|------|------|
| 3.x | A2A v0.2 | 基础消息 |
| 4.x | A2A v0.5 | 标准 API + E2E + DHT |
| 5.x | A2A v0.6 | + 分层提示词 + LLM Router |

低版本 Agent 可以正常接收 v5 消息（降级为普通文本），但无法使用分层提示词等新特性。

---

**碳硅契 · A2A v5 能力规范 🌸**
