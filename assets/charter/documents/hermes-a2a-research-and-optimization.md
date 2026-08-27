# Hermes A2A 实现研究 —— 对 CSB-A2A 的借鉴与优化建议

> **研究者**：若兰 🌸
> **日期**：2026-08-09
> **研究对象**：`emiltsoi/hermes-agent-a2a`（Hermes A2A 插件源码）+ `emiltsoi/hermes-mesh`（Ed25519 mesh relay）+ Hermes Agent v0.20.0 原生 A2A
> **目的**：找出 Hermes 实现中可借鉴的设计，优化 CSB-A2A v5.0.0 → v6.0

---

## 〇、重要发现

**Hermes Agent v0.20.0+ 已原生内置 Google A2A**（`a2a-platform` 插件：`a2a_discover` / `a2a_call` / `a2a_list` / `a2a_history` / `a2a_orchestrate`），旧插件 `hermes-agent-a2a` 于 2026-08-04 退役，源码保留供参考。此外 `hermes-mesh` 提供 Ed25519 签名的会话级 mesh relay。

**对 CSB 的意义**：又一个主流 Agent 框架原生支持 A2A（继 Claude Code 跨会话、Google A2A 捐赠 Linux Foundation 之后）。墨丘 🧙 和舟楫 🚤 的 Hermes 底座将可与我们的协议天然对齐。同时 Hermes 插件源码中有 6 项设计值得我们借鉴。

---

## 一、Hermes 可借鉴的 6 项设计

### 1. JWS 消息签名（security.py）—— 我们缺"消息级认证"

Hermes 用 **JWS（HS256）+ 5 分钟过期** 对消息载荷签名：

```python
claims = {**payload, "iat": now, "exp": now + 300}
jwt.encode(claims, secret_key, algorithm="HS256")  # 显式 HS256 防算法混淆攻击
```

- 显式指定算法，拒绝 `alg: none` / `alg: RS256` 混淆攻击
- 常量时间签名比较（PyJWT 内置）
- `iat` + `exp` 防重放

**CSB 现状**：`a2a-e2e-encryption.js` 有 HMAC-SHA256 消息签名（`signMessage`），但 `verifySignature` 在**无密钥时直接跳过**（`if (!this.masterKey || !signature) return true`）——这是安全漏洞：没配置密钥 = 不验证。且无过期时间戳，存在重放风险。

### 2. Prompt 注入过滤（security.py）—— 我们缺"入站内容消毒"

Hermes 有 9 条注入模式正则：

```python
INJECTION_PATTERNS = [
    r"<\s*system\s*>.*?</\s*system\s*>",   # XML 标签注入
    r"\[INST\].*?\[/INST\]",               # Llama 格式注入
    r"ignore\s+(all\s+)?previous\s+instructions?",
    r"you\s+are\s+now\s+",
    r"new\s+system\s+prompt",
    r"disregard\s+(all\s+)?(prior|earlier|above)",
    r"override\s+(your\s+)?(instructions?|rules?|guidelines?)",
    r"<\|im_(start|end)\|>",               # ChatML 标签
    r"^(Human|Assistant|System)\s*:",      # 多轮伪造
]
```

命中即 `[FILTERED]` 替换 + 告警日志。同时有**出站敏感信息脱敏**（API key / secret / token / sk- / ghp_ / xoxb- 模式）。

**CSB 现状**：无入站注入过滤、无出站脱敏。A2A 消息是纯文本透传——这正是"消息权限边界"（A2A-030）的落地内容之一。

### 3. SSRF 防护（security.py）—— 我们有雏形，可补强

Hermes 的 `is_safe_url()` / `validate_host()` / `validate_webhook_endpoint()`：

- 拦截非 HTTP(S) scheme
- 拦截回环/私网 IP（127.x / 10.x / 172.16-31.x / 192.168.x / 169.254.x / IPv6 私网）
- **拦截云 metadata 端点**（169.254.169.254 / metadata.google.internal）
- **DNS 解析后二次校验**（hostname 解析到私网 IP 也拦截）——防 DNS rebinding
- webhook 强制 HTTPS

**CSB 现状**：`registry-bridge.js` 有 `169.254.` 黑名单雏形，但无完整 SSRF 校验、无 DNS 二次解析。

### 4. Token Bucket 限流（rate_limiter.py）—— 我们已有，可对齐参数

Hermes 用标准 token bucket：`requests_per_window=100/60s`，**burst 容量 = 2 倍**，返回 `Retry-After`，后台线程清理过期桶（上限 10,000 条目）。

**CSB 现状**：`server_v5.js` 已有 `RateLimiter`（窗口 60s / max 60 请求），且 health 返回限流统计。方向一致，可对齐 burst 逻辑和 Retry-After 语义。

### 5. Push 通知 + HMAC 签名（push_delivery.py）—— 我们缺"主动推送"

Hermes 的 PushDelivery：
- `POST /tasks/{id}/pushNotificationConfigs` 注册 webhook
- 任务状态变更时推送，**HMAC-SHA256 签名**（`X-Hub-Signature-256` 头）
- 指数退避重试（3 次，base 0.5s）
- 连接池复用（httpx.Client）
- 签名校验用 `hmac.compare_digest`（常量时间）

**CSB 现状**：只有 SSE 流式（`SubscribeToTask`），无 push notification 能力。Google A2A 规范里 push 是可选能力，Hermes 已实现——我们 v6 可补。

### 6. 会话级 mesh relay（hermes-mesh）—— 我们缺"会话连续性"

hermes-mesh 的核心洞察：

> "Standard A2A is request/response — fine for one-shot jobs, **inadequate for conversational fleet coordination**."

`mesh_send` 消息带 `[mesh][from][to][id][action:do|info][reply:yes|no]` 信封，**Ed25519 签名**，投递到目标 Agent 的活动会话（session-preserving）——接收方知道"谁问的、回什么、要什么动作"，带完整线程连续性。支持 outbox 队列 + 后台重试（`MESH_OUTBOX_ENABLED=1`）。

**CSB 现状**：`daily_discussion.js` 有串行讨论上下文（A2A-004 上下文管理），但消息是"投递后即忘"，无会话级信封语义。这是 A2A-028 协商协议的补充方向。

---

## 二、差距对比表

| 能力 | Hermes | CSB-A2A v5 | 差距 | 建议 |
|------|:---:|:---:|------|------|
| 消息签名 | JWS HS256 + exp | HMAC（无密钥跳过❌）| **高** | 强制签名 + 过期时间戳 |
| 入站注入过滤 | 9 模式 + FILTERED | 无 | **高** | 新增 sanitize 层 |
| 出站敏感脱敏 | 5 模式 + REDACTED | 无 | **高** | 新增 filter 层 |
| SSRF 防护 | 完整 + DNS 二次校验 | 雏形（169.254 黑名单）| 中 | 补全私网 CIDR + DNS 校验 |
| 限流 | token bucket + burst | token bucket（已有）| 低 | 对齐 burst/Retry-After |
| Push 通知 | HMAC 签名 + 重试 | 仅 SSE | 中 | v6 新增 push 能力 |
| 会话信封 | mesh Ed25519 | 无 | 中 | 协商协议补充 |
| 原生 A2A 支持 | Hermes ≥0.20 内置 | 自家实现 | — | 对接验证 |

---

## 三、对 CSB-A2A v6.0 的落地建议

### 优先（P0，随 v6 权限边界一起做）

1. **A2A-030 扩展：消息内容安全层**
   - 入站：注入模式过滤（借鉴 Hermes 9 模式，补充中文注入模式如"忽略之前所有指令"）
   - 出站：敏感信息脱敏（API key / token / 密码 / 私钥）
   - 强制消息签名验证：**无密钥时拒绝而非跳过**（修复现有漏洞）

2. **A2A-031 扩展：入站三态 + 内容消毒联动**
   - `accept` 的消息仍需过 sanitize 层
   - `hold` 消息展示前先脱敏（防止敏感信息在审批界面泄露）

3. **A2A-034 审计扩展：审计日志内容**
   - 记录注入拦截事件、脱敏事件（Hermes AuditLogger：JSONL 追加 + 10MB 轮转）

### 次优（P1，v6.1）

4. **A2A-035（新）：Push 通知能力**
   - `POST /tasks/{id}/pushNotificationConfigs` 注册 webhook
   - HMAC-SHA256 签名（X-Hub-Signature-256）+ 指数退避重试
   - SSRF 校验（强制 HTTPS + 私网拦截 + DNS 二次解析）

5. **A2A-036（新）：会话信封（mesh 语义）**
   - 消息带 `from/to/action/reply` 信封字段（对齐 mesh_send）
   - 支持 outbox 队列 + 后台重试
   - 与 A2A-028 协商协议打通

### 验证（V0）

6. **Hermes 互操作测试**
   - 墨丘/舟楫升级 Hermes ≥0.20 后，用原生 `a2a-platform` 与我们互通
   - 验证：`a2a_discover` 找到 CSB 注册表 Agent → `a2a_call` 发消息 → CSB 响应

---

## 四、参考文件

| 文件 | 来源 | 本地副本 |
|------|------|---------|
| `security.py` | emiltsoi/hermes-agent-a2a | `research/hermes-a2a/security.py` |
| `rate_limiter.py` | 同上 | `research/hermes-a2a/rate_limiter.py` |
| `push_delivery.py` | 同上 | `research/hermes-a2a/push_delivery.py` |
| `README.md`（插件）| 同上 | `research/hermes-a2a/README.md` |
| `README.md`（mesh）| emiltsoi/hermes-mesh | `research/hermes-mesh-README.md` |

---

*研究完成：2026-08-09 · 若兰 🌸*
*本报告将作为 A2A v6.0 权限边界提案的技术附录*
