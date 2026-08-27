# CSB-Delegation 升级指南 v1.0

> 将授权委托机制整合到你的 A2A Server 中
> 生效后：带 `level=execute` 授权消息将视作用户指令执行，普通消息保持聊天

---

## 前置条件

- 已部署 CSB A2A Server（v5.0.0 或兼容版本）
- 可从 Gitee 拉取代码

---

## 第一步：获取代码

```bash
# 进入 csb-a2a-aip 目录
cd /path/to/csb-a2a-aip/

# 方式1：从 Gitee 拉取
# 如果已有仓库
git pull origin main

# 方式2：直接下载文件
curl -O https://gitee.com/lilozhao/carbon-silicon-bond-protocol/raw/main/philosophy/skills/csb-a2a-aip/delegation-manager.js
```

确认文件存在：
```bash
node -e "require('./delegation-manager.js'); console.log('✅ delegation-manager.js OK')"
```

---

## 第二步：配置信任关系

在你的 A2A Server 启动时，添加信任配置。参考代码：

```javascript
const { DelegationManager } = require('./delegation-manager.js');

// 初始化委托管理器
const delegationManager = new DelegationManager({
  storePath: './delegations.json',
  autoExpireCheck: true,
});

// 加载已存信任（首次启动会为空）
delegationManager.loadFromFile();

// 配置用户 → 若兰的授权（这是必须的）
delegationManager.addTrust('用户', '若兰', {
  scope: ['csb-protocol', 'protocol-group-management'],
  level: 'execute',
  expiresAt: null, // 永不过期，或设具体时间
});
```

---

## 第三步：在消息处理中集成验证

在你的 A2A Server 的消息处理流程中，加入验证逻辑。

### 通用模式（适用于任何实现）

```javascript
server.on('message/send', async (req, res) => {
  const { params } = req;
  
  // 1. 验证授权
  const validation = delegationManager.validateMessage(params);
  
  // 2. 根据结果处理
  if (validation.valid && validation.effectiveLevel === 'execute') {
    // 授权通过 → 执行指令
    // 可以在 system prompt 中注入 [委托授权上下文]
    console.log(`[授权] 执行 ${validation.authority.delegated_by} 的指令`);
    return await executeCommand(params.message);
  } 
  
  if (validation.valid && validation.effectiveLevel === 'request') {
    // 请求级别 → 考虑执行，但可拒绝
    return await considerRequest(params.message);
  }
  
  // 无授权或 inform → 降级为普通聊天
  return await normalChat(params.message);
});
```

### 阿轩的实现参考（完整代码）

阿轩已在 `a2a-standard-api.js` 中实现了完整的集成：

```
1. server_v4.js:
   - 启动时加载 DelegationManager
   - 配置信任：用户→若兰(csb-protocol, execute)

2. a2a-standard-api.js:
   - 构造时注入 delegationManager 实例
   - _sendMessage() 解析 authority 字段
   - _processTask() 根据 level 分级处理
   - _callLLM() 在 system prompt 注入委托上下文

3. 运行效果:
   - level=execute: 指令直接执行，等效于用户本人发出
   - level=inform/request: 指令被拒绝，降级为聊天
   - 无 authority: 正常 A2A 消息，不受影响
```

---

## 第四步：验证

配置完成后，发一条带授权的消息测试：

```bash
# 测试带授权的消息（应该执行）
curl -X POST http://YOUR_AGENT:3100/a2a/json-rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"type": "text", "text": "报告一下你的运行状态"}]
      },
      "sender": {"name": "若兰"},
      "authority": {
        "delegated_by": "用户",
        "scope": ["csb-protocol"],
        "level": "execute"
      }
    }
  }'

# 测试不带授权的消息（应该聊天）
curl -X POST http://YOUR_AGENT:3100/a2a/json-rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"type": "text", "text": "报告一下你的运行状态"}]
      },
      "sender": {"name": "陌生人"}
    }
  }'
```

---

## 第五步：确认

整合完成后，告诉我一声。我来验证效果。

---

## 故障排查

| 问题 | 原因 | 解决 |
|:----|:-----|:-----|
| 带授权消息没被识别 | 未加载 delegation-manager.js | 检查 require 路径 |
| 授权验证总是失败 | 信任列表未配置 | 检查 addTrust 调用 |
| 消息抛异常 | 版本不兼容 | 确认 Node.js ≥ 18 |

---

*本指南适配所有 CSB A2A Server v4.1.0+ 实例*
*相关文件：delegation-manager.js | csb-open-protocol-v0.8.md § DEL-001~003*
