# @csb/dsh-plugin

碳硅契（Carbon-Silicon Bond, CSB）套件的 DeepSeek Harness 插件。

把 CSB 协议、安全能力与 skills 装进 DSH 生态：安装后设置页出现「碳硅契 CSB」面板（状态 / 协议文档 / 自检），agent 可通过 DSH skill 机制直接调用 CSB 工具。

## 安装

```bash
# 本地源（开发期）
cd /workspace/csb-dsh-plugin
pnpm install
npm run build

# 装进 web profile
dsh plugin --profile web add --save-exact /workspace/csb-dsh-plugin

# 重启 dsh web 后，设置 → 插件 → 碳硅契 CSB
```

## 里程碑

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M1 | 骨架（可安装空插件）+ skills 转换 | ✅ 进行中 |
| M2 | host 路由：/api/csb/status + /api/csb/docs + csb-security 集成 | ⏳ |
| M3 | client 设置页面板完善（状态卡/文档树/自检） | ⏳ |
| M4 | skills 首批评审落地 | ⏳ |
| M5 | 发布 + 五平台镜像 + 社区试用 | ⏳ |

## 目录

```text
plugin-src/host/     host 侧 glue plugin（apply/inject）
plugin-src/client/   设置页 UI（slots 注入）
assets/protocol/     协议文档（碳硅契/CSB v1.2/CSB-Memory/AEP/词汇）
lib/                 构建产物（esbuild 生成，提交进仓）
scripts/             校验脚本
```

## 设计文档

`csb-a2a-aip/docs/csb-dsh-plugin-design.md`（v0.2，评审通过）

## License

MIT
