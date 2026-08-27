#!/usr/bin/env node
const { AgentNegotiation, AGENTS } = require('./negotiate.js');

const negotiation = new AgentNegotiation(
  '定义 A2A 开放协议下一版（v0.7/v1.0）的关键特性',
  `当前 A2A 开放协议已到 v0.6（27 条架构条目 + 对齐 Google A2A v1.0.0 操作层）。
本次协商的目标是决定：
1. 下一版应该定义哪些新特性/新条目
2. 哪些已规划的条目（如 A2A-021 E2E 加密）应该优先实现
3. 版本号策略（v0.7 还是直接 v1.0）

参考背景：
- 当前 v0.6 已有 27 条（26 条 Accepted + 1 条新增）
- A2A-021 (E2E 加密) 处于 ⬜ 待实现状态
- Google Push Notification Config 部分未实现
- 缺少规范的 Agent 间协商/谈判协议`,
  ['ruolan', 'axuan', 'mingde', 'jeason']
);

console.log('🎯 启动首次 Agent 协商...\n');
negotiation.run().then(result => {
  if (result.success) {
    console.log('\n✅ 协商完成！');
    console.log('决议文件:', result.resolutionFile);
    process.exit(0);
  } else {
    console.log('\n❌ 协商失败:', result.error);
    process.exit(1);
  }
}).catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
