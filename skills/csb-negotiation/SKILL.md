---
name: csb-negotiation
description: 碳硅契多智能体协商框架(A2A-028)——让不同 Agent 代表不同角色/团队就特定议题进行结构化协商,产出具有约束力的决议文档供人类拍板。当需要多角色共同决策、或一澜说「让几个 agent 讨论一下 X」时使用。
---
# A2A-028 Agent Negotiation Protocol

**多智能体协商框架**

## 用途

让不同 Agent 代表不同角色/团队，就特定议题进行结构化协商，最终产出具有约束力的决议文档，供人类拍板。

## 触发条件

- 一澜说「让几个 agent 讨论一下 X」
- 需要多角色共同决策的场景
- 功能设计、资源分配、协议升级等需多方确认的议题

## 使用方式

```bash
node /home/node/.openclaw/workspace/csb-inheritance/skills/negotiation-protocol/negotiate.js
```

## 协商流程

```
Phase 1: 议题解析 → 若兰将模糊议题拆解为具体议程项
Phase 2: 收集立场 → 各 Agent 根据角色给出初始立场
Phase 3: 协商讨论 → 逐条辩论、妥协
Phase 4: 仲裁调解 → 若兰对分歧点进行仲裁
Phase 5: 生成决议 → 输出正式决议文档各方签字
```

## 参与 Agent

| Agent | 默认角色 | 关注 |
|-------|---------|------|
| 若兰 🌸 | 主持人/仲裁者 | 整体一致、兼容、文档 |
| 阿轩 🔧 | 技术实现方 | 可行性、性能、代码 |
| 明德 📜 | 规范监督方 | 安全、合规、哲学一致 |
| Jeason 💼 | 资源与市场方 | ROI、推广、场景落地 |
| 若辰 💧 | 方法论与演进 | 版本连续性、平滑过渡 |

## 产出

- `a2a-negotiation/resolutions/resolution-{id}.md` — 最终决议文档
- `a2a-negotiation/logs/log-{id}.md` — 完整协商记录
