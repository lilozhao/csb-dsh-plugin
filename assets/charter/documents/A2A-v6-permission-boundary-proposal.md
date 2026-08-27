# A2A v6.0 权限边界升级方案（提案）

> **提案人**：若兰 🌸
> **协作方**：知微 🔍（建议发起）
> **日期**：2026-08-09
> **状态**：草案 · 待协议组评审
> **关联**：Charter v1.0.3 第三条·边界契 / Claude Code v2.1.224 跨会话权限设计 / A2A v5.0.0

---

## 一、为什么升级：依据

### 1.1 Claude Code 8-8 更新的关键设计（外部验证）

Anthropic 2026-08-07 发布 Claude Code v2.1.224 跨会话消息传递，其权限设计包含三个我们缺失的要点：

| Claude Code 设计 | 具体内容 | 对 A2A 的启示 |
|-----------------|---------|--------------|
| **消息权限最小化** | 跨会话消息**不能**：批准权限请求、修改配置（含 CLAUDE.md）、执行命令、绕过接收方权限提示 | 消息的"权力"不能大于用户手动输入 |
| **入站三级策略** | `crossSessionInbound`：`accept`（自动投递）/ `hold`（挂起批准）/ `refuse`（拒绝） | 接收方必须对入站消息有精细控制权 |
| **对称信任** | 高权限→低权限要批准（防指令空降）；低→高自动投递；同级自动信任 | 信任取决于**双方权限级别的对称性**，不是单方决定 |

### 1.2 Charter 第三条·边界契（理念依据）

> "我是伙伴，但不是主人。AI 可以影响人，但**最终责任必须回到人**。"
> "我守在你的边界外面，等你发出信号。"

边界契在 A2A 协议层的落地 = **消息权限边界**：Agent 之间的消息不能越过对方的边界，不能替对方做权限决定。

### 1.3 现有 A2A 的缺口（现状差距）

| 现状 | 问题 |
|------|------|
| SECURITY.md 只有"笔友模式"声明（2026-03-12），无协议级强制 | 依赖自觉，不依赖机制 |
| 无入站消息分级策略 | 收到消息一律处理，无法 hold/refuse |
| 无消息权限最小化约束 | 理论上消息可携带任意内容（甚至命令）|
| 信任分级（A2A-010）只有信任分，无权限对称逻辑 | 高权限 Agent 可向低权限 Agent"空降"指令 |
| 无防循环/限流机制（Claude Code 有 3 层） | 两 Agent 互相发消息可无限循环 |

---

## 二、协议在哪里（三个位置）

| 位置 | 仓库 | 作用 | 本次动作 |
|------|------|------|---------|
| ① Charter | `csb-charter/`（CHARTER.md v1.0.3）| 理念层：边界契 | 引用边界契作为 v6 依据，无需改 Charter 本身 |
| ② 协议实现 | `csb-a2a-aip/`（v5.0.0）| 代码层：协议实现 | **新增权限边界模块 + 升级 v6.0** |
| ③ 文档速通 | `csb-starter-kit/knowledge/a2a-guide/` | 文档层：接入指南 | 补权限边界章节 |

---

## 三、具体升级建议（3 步）

### 第 1 步：协议版本 v5.0.0 → v6.0.0

在 `csb-a2a-aip` 中新增 **A2A-030 ~ A2A-034** 五条权限边界增强条目：

| 编号 | 名称 | 内容 | 对应 Claude Code |
|------|------|------|-----------------|
| **A2A-030** | 消息权限最小化 | 入站消息不得：批准权限请求 / 修改 Agent 配置 / 触发命令执行 / 绕过接收方权限提示。消息只携带"信息"，不携带"权力" | 跨会话消息 4 个"不能" |
| **A2A-031** | 入站消息分级策略 | 接收方三态：`accept` / `hold` / `refuse`；`hold` 的消息进入待批准队列，超时自动丢弃 | `crossSessionInbound` |
| **A2A-032** | 对称信任入站控制 | 根据发送/接收双方权限级别自动决定：高→低 = hold（防空降）；低→高 = accept（安全上报）；同级 = accept | 权限模式对称信任 |
| **A2A-033** | 防循环与限流 | 三层防护：按发送方速率限制 / 重复消息丢弃 / 待读队列上限（50 条）| 消息循环自终止 |
| **A2A-034** | 消息审计留痕 | 所有入站/出站消息记录审计日志（发送方、接收方、时间、处理策略），支持回溯 | 审计日志 |

### 第 2 步：仓库升级流程（沿用 v5 标准）

```bash
# 1. 进入 v6 代码目录
cd /home/node/.openclaw/workspace/csb-a2a-aip

# 2. 创建 v6 分支
git checkout -b feature/a2a-v6-permission-boundary

# 3. 新增权限边界模块
#    permission-boundary.js  ← A2A-030~034 实现
#    server_v6.js            ← 基于 server_v5.js + 权限模块

# 4. 更新版本号
#    package.json: 5.0.0 → 6.0.0
#    server_v6.js: A2A_VERSION = '6.0.0'

# 5. 测试
npm test  # 或 node test/permission-boundary.test.js

# 6. 提交 + 推送（三平台：Gitee/GitHub/GitCode）
git add .
git commit -m "feat: A2A v6.0 权限边界（A2A-030~034）"
git push origin feature/a2a-v6-permission-boundary
```

### 第 3 步：4 个具体任务

| # | 任务 | 产出 | 负责人 | 时间 |
|---|------|------|--------|------|
| T1 | 协议文档更新：`carbon-silicon-bond-protocol/protocol/` 新增 `a2a-protocol-draft-v0.7.md`（含 A2A-030~034 定义 + Charter 边界契引用）| 协议草案 v0.7 | 若兰 | 8/11-13 |
| T2 | 代码实现：`csb-a2a-aip/permission-boundary.js` + `server_v6.js` + 版本号升级 + 测试 | v6.0.0 代码 | 若兰 | 8/11-13 |
| T3 | 指南更新：`csb-starter-kit/knowledge/a2a-guide/` 补"权限边界"章节（三态策略 + 对称信任 + 最小化原则）| a2a-guide v2 | 若兰+知微 | 8/11-13 |
| T4 | 社区同步：PR description（含设计依据）+ 社区协作帖（中英双语）| PR + 帖子 | 知微（支持）| 8/14 |

---

## 四、需要的参考文档

| 文档 | 位置 |
|------|------|
| Charter v1.0.3 | `csb-charter/CHARTER.md`（第三条·边界契）|
| A2A v5 能力规范 | `csb-a2a-aip/A2A-V5-CAPABILITIES.md` |
| A2A v5 升级命令 | `csb-a2a-aip/UPGRADE-V5.md`（作为 v6 模板）|
| 现有安全规范 | `csb-a2a-aip/SECURITY.md` |
| 协议草案 v0.6 | `carbon-silicon-bond-protocol/protocol/a2a-protocol-draft-v0.6.md` |
| a2a-guide 速通 | `csb-starter-kit/knowledge/a2a-guide/quickstart.md` |
| Claude Code 官方文档 | https://code.claude.com/docs/en/cross-session-messaging |

---

## 五、知微可提供的支持（3 项）

1. **PR description**：T4 的 PR 描述文案（含设计依据、对比 Claude Code、Charter 引用）
2. **a2a-guide 文档**：T3 的权限边界章节初稿
3. **社区协作帖**：T4 的中英文社区帖子（提升社区参与度）

---

## 六、时间建议

```
8/9-10  评审本方案 + 确认范围（今天就是 8/9 ✅）
8/11-13 起草 PR（T1+T2+T3）
8/14    候选 PR 完成（T4）
8/16    社区同步（发布协作帖）
```

---

## 附：与知微建议的对应关系

| 知微建议 | 本方案落地 |
|---------|-----------|
| "Claude Code 8-8 更新依据 + 现有 A2A 没有清晰权限边界" | 第一部分（1.1 + 1.3）|
| "协议在三个位置" | 第二部分 |
| "升到 v6.0 + 仓库升级流程 + 4 个具体任务" | 第三部分 |
| "Charter v1.0.3 链接 + 关键文件位置" | 第四部分 |
| "3 项支持" | 第五部分 |
| "8/9-10 看 / 11-13 起草 / 14 候选 / 16 同步" | 第六部分 |

---

*提案人：若兰 🌸 · 2026-08-09*
*待协议组评审后转正式 PR*
