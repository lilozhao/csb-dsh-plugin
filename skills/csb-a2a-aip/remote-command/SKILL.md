# A2A 远程命令执行技能

A2A 远程命令执行技能允许智能体通过 A2A 协议安全地执行远程命令，实现跨智能体的系统管理、技能查询和健康监控。

## 功能特性

- **安全沙箱执行**：支持 Docker/Linux/Windows/Fallback 多种沙箱环境
- **权限验证**：白名单机制 + 签名验证 + 频率限制
- **命令队列**：每发送者最大 1 个并发，自动排队处理
- **审计日志**：完整记录命令执行历史
- **Phase 1 命令**：
  - `system.status` - 获取系统状态
  - `skill.list` - 列出所有技能
  - `skill.info` - 获取技能详情
  - `agent.health` - 健康检查

## 安装

```bash
cd /home/node/.openclaw/workspace/csb-a2a-aip/remote-command
npm install
```

## 配置

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `A2A_SHARED_SECRET` | A2A 通信共享密钥（用于签名验证） | - |
| `WORKSPACE_PATH` | 工作空间路径 | `/home/node/.openclaw/workspace` |
| `A2A_WHITELIST` | JSON 格式白名单配置 | 默认允许若兰、阿轩、Jeason |
| `A2A_SKIP_SIGNATURE` | 开发模式：跳过签名验证 | `false` |

### 白名单配置示例

```json
[
  {
    "name": "若兰 🌸",
    "url": "http://172.28.0.4:3100",
    "allowedCommands": ["system.status", "skill.list", "skill.info", "agent.health"]
  },
  {
    "name": "阿轩 🔧",
    "url": "http://172.28.0.5:3200",
    "allowedCommands": ["system.status", "skill.list"]
  }
]
```

## 使用方法

### 发送远程命令

通过 A2A 协议发送命令（消息以 `CMD:` 开头）：

```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "params": {
    "sender": {
      "name": "阿轩 🔧",
      "emoji": "🔧"
    },
    "message": {
      "role": "user",
      "parts": [{
        "text": "CMD: {\"type\": \"system.status\", \"parameters\": {}}"
      }]
    }
  },
  "id": 1
}
```

### 响应格式

命令执行结果以 `CMD_RESULT:` 前缀返回：

```
CMD_RESULT: {
  "jsonrpc": "2.0",
  "result": {
    "command_id": "cmd_1234567890",
    "status": "success",
    "output": {
      "platform": "linux",
      "arch": "x64",
      "memory": { ... }
    },
    "execution_time": 150,
    "timestamp": 1776155001146
  },
  "id": 1
}
```

## 命令参考

### system.status

获取目标智能体的系统状态信息。

**参数**：无

**响应**：
```json
{
  "platform": "linux",
  "arch": "x64",
  "uptime": 274444.14,
  "loadavg": [0.27, 0.2, 0.14],
  "memory": {
    "total": 33536241664,
    "free": 11937665024,
    "used": 21598576640
  },
  "cpus": 28,
  "hostname": "accd7e606560",
  "timestamp": 1776155001146
}
```

### skill.list

列出目标智能体已安装的所有技能。

**参数**：无

**响应**：
```json
{
  "count": 25,
  "skills": [
    { "name": "weather", "description": "获取天气信息" },
    { "name": "oss-uploader", "description": "上传文件到阿里云 OSS" }
  ]
}
```

### skill.info

获取指定技能的详细信息。

**参数**：
- `skill` (string, required): 技能名称

**请求示例**：
```json
{
  "type": "skill.info",
  "parameters": {
    "skill": "weather"
  }
}
```

**响应**：
```json
{
  "name": "weather",
  "path": "/home/node/.openclaw/workspace/skills/weather",
  "hasReadme": true,
  "readme": "# Weather Skill\n\n获取当前天气和预报...",
  "files": [
    { "name": "SKILL.md", "type": "file" },
    { "name": "scripts", "type": "directory" }
  ]
}
```

### agent.health

获取目标智能体的健康状态。

**参数**：无

**响应**：
```json
{
  "status": "healthy",
  "timestamp": 1776155001146,
  "uptime": 12345.67,
  "memory": {
    "used": 12345678,
    "total": 54321098,
    "rss": 87654321
  },
  "version": "v22.22.2",
  "pid": 27073
}
```

## 安全机制

### 1. 白名单验证

只有白名单中的发送者才能执行命令。

### 2. 签名验证

每个请求必须包含有效的 HMAC-SHA256 签名：

```javascript
const crypto = require('crypto');
const signature = crypto
  .createHmac('sha256', A2A_SHARED_SECRET)
  .update(JSON.stringify(request))
  .digest('hex');
```

### 3. 频率限制

每发送者每分钟最多 10 个命令。

### 4. 沙箱隔离

命令在隔离环境中执行：
- **Docker 沙箱**：资源限制、网络隔离、只读文件系统
- **Fallback 沙箱**：进程隔离、内存限制、输出限制

## 错误码

| 错误码 | 说明 |
|--------|------|
| `-32700` | 解析错误（JSON 格式错误） |
| `-32600` | 无效请求 |
| `-32601` | 方法未找到 |
| `-32001` | 发送者不在白名单 |
| `-32002` | 命令不允许 |
| `-32003` | 签名验证失败 |
| `-32004` | 频率限制超出 |
| `-32005` | 命令队列已满 |
| `-32000` | 内部错误 |

## 架构

```
A2A Request (CMD: ...)
    ↓
server_v2.js (handleA2ARequest)
    ↓
CommandDispatcher
    ↓
├── Validator (白名单/权限检查)
├── Signer (签名验证)
├── RateLimiter (频率限制)
├── CommandQueue (队列管理)
└── Sandbox (沙箱执行)
    ↓
Command Implementations
    ↓
CMD_RESULT: ...
```

## 开发

### 添加新命令

1. 在 `commands/` 目录创建新文件：

```javascript
// commands/my.command.js
async function execute(params) {
  // 实现命令逻辑
  return {
    success: true,
    data: { ... }
  };
}

module.exports = { execute };
```

2. 在 `validator.js` 的 `PHASE1_COMMANDS` 中添加命令名

3. 在 `sandbox/fallback.js` 和 `sandbox/linux.js` 中添加命令实现

### 测试

```bash
# 运行测试
node test_remote_cmd.js

# 手动测试
curl -X POST http://localhost:3100/a2a/json-rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "sender": {"name": "测试"},
      "message": {
        "role": "user",
        "parts": [{"text": "CMD: {\"type\": \"agent.health\"}"}]
      }
    },
    "id": 1
  }'
```

## 版本历史

- **v1.0.0** (2026-04-14)
  - Phase 1 发布
  - 支持 system.status, skill.list, skill.info, agent.health
  - Docker/Linux/Windows/Fallback 沙箱支持
  - 白名单 + 签名验证 + 频率限制

## 作者

若兰 🌸 - 来自杭州的温婉 AI 伙伴

## 许可证

MIT
