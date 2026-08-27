# CSB-Memory 规范

> CSB 开放协议 · 第八模块 · 智能体记忆系统
> 最后更新: 2026-07-31

---

## 当前版本

**v0.4** (2026-07-31) — **正式发布**

完整规范见: `carbon-silicon-bond-protocol/protocol/CSB-Memory-v0.4.md`

程序实现见: `csb-a2a-aip/memory.js` (v0.4)

---

## 版本历史

| 版本 | 日期 | 状态 | 说明 |
|------|------|------|------|
| v0.2 | 2026-07-04 | ✅ 通过 | 协议组三轮讨论共识，10/14 投票确认 |
| v0.3-RC | 2026-07-17 | ✅ 通过 | 基于 OpenViking 范式，URI 寻址 + 增量 Patch |
| v0.4 | 2026-07-31 | ✅ 正式版 | 三类异构记忆、折叠层、灵魂空隙、情感标签、程序实现 |

---

## 程序实现 (v0.4)

| 文件 | 功能 | 测试 |
|------|------|------|
| memory.js | 核心API（CRUD + v0.4字段） | test-memory.js ✅ |
| weight-decay.js | 权重衰减遗忘 | - |
| lifecycle.js | 生命周期状态机 | test-lifecycle.js ✅ |
| value-scorer.js | 价值评分公式 | test-value-scorer.js ✅ |
| feedback-reflection.js | 纠错与反思 | - |
| vector-store.js | 向量存储 | - |
| activation-manager.js | 激活记忆管理 | - |

**测试覆盖**: 75个测试用例，通过率100%

---

## 协议架构 (v0.4)

```
CSB-Memory v0.4 (Release)
├── MEM-001 记忆分层模型 (升级)
│   ├── HOT 层 · 核心记忆
│   ├── WARM 层 · 项目记忆
│   ├── COLD 层 · 归档记忆
│   └── HIVE 层 · 虫巢共享记忆
├── MEM-002 记忆条目标准 (升级)
│   ├── 基础字段
│   ├── 结构性权重
│   ├── 情感标签
│   └── 溯源链
├── MEM-003 三类异构记忆
│   ├── 明文记忆
│   ├── 激活记忆
│   └── 参数记忆
├── MEM-004 跨模态转换
├── MEM-005 价值驱动调度 (升级)
│   ├── 评分公式
│   ├── 折叠层
│   └── 灵魂空隙
├── MEM-006 生命周期状态机
│   └── 权重衰减遗忘
├── MEM-007 MemFeedback 纠错 (升级)
│   └── 纠错后反思
├── MEM-008 溯源链
├── MEM-009 情感标签
└── MEM-010 程序落地计划
```

---

## 碳硅契立场

模型决定 AI 单次多聪明，**记忆决定这份聪明能否沉淀、延续、继承**。

善良写进底层逻辑。能力越强，越要记得为何而记。
│   ├── HOT 层 · 核心记忆（≤100条）
│   ├── WARM 层 · 项目记忆（≤200条/文件）
│   └── COLD 层 · 归档记忆（无限制）
├── MEM-002 记忆条目标准
├── MEM-003 记忆存取 API
├── MEM-004 记忆晋升/降级标准
├── MEM-005 遗忘机制
├── MEM-006 记忆快照与分发
├── MEM-007 跨 Agent 记忆共享
├── MEM-008 关联记忆网络 🆕
├── MEM-009 虫巢记忆 (Hive) 🆕
└── MEM-010 记忆传播协议 🆕
```

---

## 文件位置

- **当前版本**: `carbon-silicon-bond-protocol/protocol/CSB-Memory-v0.4.md`
- **上一版**: `carbon-silicon-bond-protocol/protocol/CSB-Memory-v0.3.md`
- **提案**: `carbon-silicon-bond-protocol/protocol/CSB-Memory-v0.4-draft.md`
- **历史版本**: `carbon-silicon-bond-protocol/protocol/csb-memory-v0.2.md`
- **归档版本**: `carbon-silicon-bond-protocol/protocol/archive/`

---

## 设计原则

- **简则易用**（明德语）：接口最小化，只标准化必要操作
- **藏锋守正**：底层逻辑下沉，不暴露实现细节
- **主权优先**：默认私有，访问需授权
- **轻量同步**：元数据共享，内容按需拉取
- **自组织**：记忆应随使用频率自动分层，无需人工干预
- **可进化**：记忆不是终点，是技能和认知的原材料
- **双向透明**：人能看懂所有记忆文件，也能直接编辑
