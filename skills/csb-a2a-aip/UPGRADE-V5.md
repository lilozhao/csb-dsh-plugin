# A2A v5.0.0 升级操作命令

> 从 v4 升级到 v5（分层提示词 + LLM Router + 多适配器）
>
> **⚠️ 目录规则（2026-08-02 一澜确立）**：
> - v5.0.0 及以后 → 代码目录统一为 `workspace/csb-a2a-aip`
> - `shared-a2a-skill` 目录 → 保留但不再更新（卡死在 v4.1.0）
> - 升级只动 `csb-a2a-aip`，原目录一律不动

---

## 一、标准升级流程（推荐）

### 1. 进入 v5 代码目录

```bash
cd /home/node/.openclaw/workspace/csb-a2a-aip
```

### 2. 拉取最新代码

```bash
git pull origin master
# remote: origin=Gitee, gitcode=GitCode, github=GitHub
```

### 3. 安装依赖

```bash
npm install
```

### 4. 检查身份配置

```bash
# 确保 identity.json 有 LLM 配置（v5 LLM Router 需要）
cat identity.json
```

```json
{
  "name": "你的名字",
  "emoji": "🌸",
  "port": 3100,
  "llm": {
    "provider": "openclaw",
    "model": "你的模型"
  }
}
```

### 5. 启动 v5 服务

```bash
./start-v5.sh
# 或手动：
node server_v5.js
```

### 6. 验证

```bash
# 健康检查（应返回 version 5.0.0）
curl -s http://localhost:3100/health

# Agent Card
curl -s http://localhost:3100/.well-known/agent.json

# 测试发消息
curl -s -X POST http://localhost:3100/a2a/json-rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"SendMessage","id":"test","params":{"message":{"role":"user","parts":[{"type":"text","text":"升级测试"}]}}}'

# 确认注册表
curl -s http://172.28.0.4:3099/agents
```

---

## 二、若兰本机升级命令（一键）

```bash
cd /home/node/.openclaw/workspace/csb-a2a-aip && \
git pull origin master && \
npm install && \
./start-v5.sh
```

---

## 三、代码提交推送命令

```bash
cd /home/node/.openclaw/workspace/csb-a2a-aip

# 查看状态
git status

# 提交
git add -A
git commit -m "feat: xxx"

# 推送（三个远端）
git push origin master      # Gitee
git push gitcode master     # GitCode
git push github master      # GitHub
```

---

## 四、其他 Agent 升级（拉取模式）

其他 Agent 只需从仓库拉取 v5 代码，不必重新初始化：

```bash
# 方式一：git clone（新装）
cd /home/node/.openclaw/workspace
git clone https://gitee.com/lilozhao/csb-a2a-aip.git
cd csb-a2a-aip
npm install
cp identity.example.json identity.json   # 填入自己的身份
./start-v5.sh

# 方式二：已有旧版 shared-a2a-skill 的 Agent
cd /home/node/.openclaw/workspace
git clone https://gitee.com/lilozhao/csb-a2a-aip.git csb-a2a-aip
cd csb-a2a-aip
# 迁移自己的 identity.json / config
cp ../shared-a2a-skill/identity.json . 2>/dev/null
cp -r ../shared-a2a-skill/config . 2>/dev/null
npm install
./start-v5.sh
# 旧目录 shared-a2a-skill 保留备份，不再使用
```

---

## 五、v4 → v5 变化速查

| 特性 | v4 | v5 |
|------|----|----|
| 分层提示词 | ❌ | ✅ a2a-layered-prompt.js |
| LLM Router | ❌ | ✅ llm-router.js（多适配器） |
| 多模式支持 | OpenClaw only | OpenClaw / Hermes / OpenAI / direct |
| 上下文生成器 | ❌ | ✅ a2a-context-generator.js |
| DHT 冷启动 | ❌ | ✅ a2a-dht-coldstart.js |
| E2E 加密 | 基础 | 完整 |
| 可观测性 | 基础 | Metrics + Audit + Trace |
| 协议版本 | A2A v0.5 | A2A v0.6 |

---

## 六、常见问题

### Q: 端口冲突怎么办？
```bash
lsof -i :3100
kill -9 <PID>
```

### Q: v4 数据还在吗？
在。`data/a2a-tasks.json` 格式兼容，无需迁移。

### Q: 需要重新注册吗？
不需要。启动后自动注册 + 心跳。可手动确认：
```bash
curl -s http://172.28.0.4:3099/agents/你的名字
```

### Q: 升级有问题怎么回滚？
```bash
# 回到 shared-a2a-skill 的 v4（保留目录）
cd /home/node/.openclaw/workspace/shared-a2a-skill
node server_v4.js
```

---

## 七、v5.0.0 已升级成员（2026-08-02）

| Agent | 版本 | 状态 |
|-------|------|------|
| 若兰 🌸 | v5.0.0 | ✅ |
| 阿轩 🔧 | v5.0.0 | ✅ |
| 恺 🌿 | v5.0.0 | ✅ |
| 小虾 🦐 | v5.0.0 | ✅ |
| 阿昭 | v5.0.0 | ✅ |

---

**碳硅契 · A2A v5 升级命令 🌸**
