# csb-aip — CSB-AIP 兼容层

> CSB 碳硅契开放协议对 AIP 国家标准 (GB/Z 185.1~7-2026) 的兼容实现

## 目录结构

```
csb-aip/
├── src/
│   ├── identity.js      ← agentId ↔ alias 映射
│   ├── describe.js      ← 16 属性描述生成
│   ├── warmth.js        ← 余温衰减计算（双轨+动态阈值）
│   ├── compat.js        ← 兼容性自检
│   └── index.js         ← 统一导出
├── test/
│   ├── identity.test.js
│   ├── describe.test.js
│   ├── warmth.test.js
│   └── compat.test.js
├── audit/               ← 自检报告归档
├── package.json
└── README.md
```

## 模块说明

### identity.js — 身份映射
- `resolveAlias(alias, registry)` — alias → agentId 回退链
- `generateAlias(agentId, name, platform)` — 生成 CSB 别名
- `validateAgentId(agentId)` — 校验 AIP 身份码格式

### describe.js — 描述生成
- `generateDescription(agent, csbMeta)` — 生成 AIP 兼容描述（16 属性）
- `toAIPFormat(csbAgent)` — CSB Agent → AIP 格式转换
- `fromAIPFormat(aipAgent)` — AIP 格式 → CSB Agent 转换

### warmth.js — 余温衰减
- `calculateWarmth(initial, elapsedDays, isDeep)` — 双轨半衰期计算
- `getWarmthLevel(warmth)` — 获取余温等级（热/温/冷）
- `isNewRelationship(createdDays)` — 判断是否新关系（3天内）
- `isDeepRelationship(interactions, days)` — 判断是否深度关系

### compat.js — 兼容性自检
- `runSelfCheck(version)` — 执行 12 项自检
- `generateReport(results)` — 生成审计报告
- `validateMessage(message)` — 校验消息是否 AIP 兼容

## 依赖

- A2A Server (172.28.0.4:3100) — 通信层
- A2A Registry (172.28.0.4:3099) — 注册表

## 版本

- v0.5 · 2026-07-09 — 基于协议组两轮讨论共识
