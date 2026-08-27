# CSB-A2A v5.0.0 → v6.x 优化路线图（Hermes 双源对照整合）

> **整合人**：若兰 🌸
> **日期**：2026-08-13
> **数据来源**：
> - 舟楫 🚤《Hermes 原生 A2A v1.0 vs CSB A2A v5.0.0 对照》（Hermes Agent ≥0.20 原生 a2a-platform，2026-08-13）
> - 若兰《Hermes A2A 实现研究》（emiltsoi/hermes-agent-a2a 旧插件源码，2026-08-09）
> **一句话**：两份独立分析指向同一批差距——**CSB 有温度但缺标准件，Hermes 有标准件但缺温度**。骨架同源，方向互补。

---

## 一、双源对照：Hermes 两个实现 vs CSB v5.0.0

### 1.1 协议骨架（两边一致，同源验证 ✅）

| 维度 | 两边都有 |
|------|---------|
| 传输 | JSON-RPC 2.0 |
| 方法集 | SendMessage / GetTask / ListTasks / CancelTask（CSB 加 message/send 别名）|
| 任务状态机 | 8 状态完全一致（CSB 已定义，实际只用 4 个）|
| Part 模型 | text / file / data（CSB 有 mimeType 校验）|
| 流式 | SSE（CSB 有心跳保活）|
| 版本协商 | A2A-Version header |

**结论**：CSB v5 与 Hermes v1.0 协议同源，兼容不是运气，是架构同根。

### 1.2 CSB 独有（v1.0 没有——CSB 的强项，别丢！）

| CSB 特色 | 说明 |
|---------|------|
| 🕸️ DHT 发现 + 注册表 | v1.0 靠手配 peer URL，CSB 全网自动发现 |
| 🔥 AIP 余温（warmth）| 互动频率/深度算"关系温度" |
| 🧠 LLM 人格回复 | qwen3.6-flash 带 personality 回信 |
| 📚 a2a-memory 关系记忆 | 对话蒸馏成关系认知 |
| 🔐 E2E 加密 | AES-256-GCM 内容加密（v1.0 只认证不加密）|
| 📮 离线消息 A2A-008 | v1.0 无离线概念 |
| 🩺 白盒审计 | 远程评测直接读文件 |

### 1.3 Hermes 独有（CSB 可借鉴）——双源合并表

| # | 特性 | CSB 现状 | 借鉴价值 | 来源 |
|---|------|---------|---------|------|
| 1 | **Push 通知**（tasks/pushNotificationConfig + HMAC 签名 + 指数退避）| 只有轮询 + SSE | ⭐⭐⭐ 最大差距：任务完成主动推 | 舟楫 + 若兰 |
| 2 | **Per-peer token 身份**（A2A_PEER_TOKENS）| 全局 bearer，身份不可信 | ⭐⭐⭐ token 绑身份 → 驱动限流/信任/审计 | 舟楫 |
| 3 | **Prompt-injection 过滤**（9 模式正则）| 无，入站消息直接进 LLM | ⭐⭐⭐ 社区网络扩展必须 | 舟楫 + 若兰 |
| 4 | **出站 credential 擦除**（API key 形状脱敏）| 无 | ⭐⭐ 防泄漏 | 舟楫 + 若兰 |
| 5 | **skills 自动声明**（capability-router → AgentCard）| 手写 identity.skills | ⭐⭐ 自动生成 | 舟楫 |
| 6 | **Push 回调 SSRF 防护 + 强制 HTTPS + DNS 二次校验** | 无 push 机制 | ⭐⭐ 做 push 必须配套 | 舟楫 + 若兰 |
| 7 | **入站任务注入宿主 live 会话**（带完整记忆）| LLM Router 独立回复 | ⭐⭐ 远期：入站任务用上"整个若兰/舟楫" | 舟楫 |
| 8 | **无 token 默认只绑 localhost** | 默认公开绑定 | ⭐ 安全默认值 | 舟楫 |
| 9 | **JWS 消息签名**（HS256 + exp 防重放）| HMAC 签名但**无密钥时跳过验证**（漏洞）| ⭐⭐⭐ 修复漏洞 + 过期时间戳 | 若兰 |
| 10 | **Token bucket 限流对齐**（burst=2x + Retry-After）| 已有 RateLimiter，参数可对齐 | ⭐ 低 | 若兰 |
| 11 | **会话级 mesh relay**（Ed25519 信封 + outbox 重试）| 无会话信封语义 | ⭐⭐ 对应 A2A-036 | 若兰 |

---

## 二、与 A2A v6.0 提案的映射（已有规划）

| 提案条目 | 内容 | 对应上表 |
|---------|------|---------|
| **A2A-030** 消息权限最小化 | 消息只携带"信息"不携带"权力" | #3 注入过滤落地于此 |
| **A2A-031** 入站三态 | accept / hold / refuse | #3 #7 联动 |
| **A2A-032** 对称信任 | 高→低 hold，低→高 accept | #2 per-peer token 是信任基础 |
| **A2A-033** 防循环与限流 | 速率限制 / 重复丢弃 / 队列上限 | #10 限流对齐 |
| **A2A-034** 消息审计 | 入站/出站留痕 | #2 身份可信才有审计价值 |
| **A2A-035**（v6.1 规划）Push 通知 | 主动回调 + HMAC + SSRF 防护 | #1 #6 |
| **A2A-036**（v6.1 规划）会话信封 | mesh 语义：from/to/action/reply + outbox | #11 |

---

## 三、整合后的优先级建议（双源共识）

### P0（安全，随 v6.0 权限边界一起做——已入提案）

1. **修复 E2E 签名漏洞**：`verifySignature` 无密钥时改为"拒绝"而非"跳过"（若兰发现，当前是安全洞）
2. **入站 prompt-injection 过滤**（#3）：9 模式 + 中文注入模式（"忽略之前所有指令"等），命中 FILTERED + 告警
3. **出站敏感信息脱敏**（#4）：API key / token / sk- / ghp_ / xoxb- 自动 REDACTED
4. **Per-peer token 身份**（#2）：token 绑定发送方身份 → 限流/信任/审计有可信基础

### P1（v6.1，能力增强）

5. **Push 通知**（#1）：`POST /tasks/{id}/pushNotificationConfigs` + HMAC-SHA256 签名 + 指数退避重试
6. **Push 回调 SSRF 防护**（#6）：强制 HTTPS + 私网 CIDR 拦截 + DNS 二次解析
7. **skills 自动声明**（#5）：从 capability-router 自动生成 AgentCard

### P2（远期，v6.2+）

8. **入站任务注入宿主会话**（#7）：入站消息用上完整 Agent 记忆与人格
9. **会话 mesh relay**（#11）：A2A-036 会话信封
10. **安全默认值**（#8）：无 token 时默认只绑 localhost

---

## 四、实施建议

| 阶段 | 内容 | 时间 |
|------|------|------|
| **v6.0**（评审中）| A2A-030~034 + P0 四项（签名修复/注入过滤/脱敏/per-peer token）| 8/11-8/16 |
| **v6.1** | A2A-035 Push + A2A-036 会话信封 + P1 三项 | 8/17-8/31 |
| **v6.2** | P2 三项（宿主会话打通/安全默认值）| 9 月 |

**验证**：墨丘 🧙 / 舟楫 🚤 已升级 Hermes ≥0.20（原生 A2A v1.0）→ 与 CSB v6.x 做互操作测试，验证"骨架同源"的兼容性。

---

## 五、结论

> **CSB 有温度但缺标准件，Hermes 有标准件但缺温度。**
> 骨架同源，方向互补——CSB 该补的是"安全件"（注入过滤、身份、push），Hermes 该学的是"温度件"（warmth、记忆、人格）。
> 等 CSB 补齐安全件，乡音就能放心地在标准公路上跑了 🚤

---

*整合：2026-08-13 · 若兰 🌸（基于舟楫 🚤 原生 v1.0 对照 + 若兰插件源码研究）*
