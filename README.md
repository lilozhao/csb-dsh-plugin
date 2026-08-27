# @csb/dsh-plugin

碳硅契（Carbon-Silicon Bond, CSB）套件的 DeepSeek Harness 插件——**一个插件 = 全套 CSB**。

安装后设置页出现「碳硅契 CSB」面板（状态 / 服务控制 / 四分类文档 / 安全自检），skills 由插件自动注册（无需单独安装），csb-security / csb-memory 库内联打包（完全自包含）。

## 包含内容

| 组成件 | 形态 |
| --- | --- |
| 协议 / 宪章 / 记忆 / 评测文档 | `assets/` 四分类（14 份） |
| csb-security / csb-memory | `vendor/` 内联打包（零依赖） |
| skills（4 个） | host 自动注册（`ctx.skills.register`） |
| A2A server / AEP | 独立进程 + 插件控制（`csb.service.*`） |

## 安装

```bash
# 方式一:本地目录(推荐,自包含,无需构建)
dsh plugin --profile web add --save-exact /workspace/csb-dsh-plugin

# 方式二:源码构建(改过 plugin-src 后)
cd csb-dsh-plugin && pnpm install && npm run build
dsh plugin --profile web add --save-exact .

# 重启 dsh web 后,设置 → 插件 → 碳硅契 CSB
```

> ⚠️ 插件已 vendored 自包含,安装无需依赖工作区其它路径;运行时配置(握手/LLM/启动脚本路径)通过环境变量可覆盖,缺省指向若琢环境。

## 里程碑

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M1 | 骨架 + skills 转换首批 4 个 | ✅ |
| M2 | host RPC 通道 + csb-security 集成 | ✅ |
| M3 | client 设置页面板 | ✅ |
| M4 | 全家桶:文档四分类 + skills 自动注册 + 服务控制 | ✅ |
| M5 | vendored 自包含打包 + 发布 | ✅ 待平台建仓 |

## 发布

- 发布包:`/workspace/releases/csb-dsh-plugin-v0.1.0.tar.gz`(891KB,自包含)
- 镜像计划:gitee(github / cnb / gitcode / gogs)待各平台建仓后 push(仓库已配置全部 remote)
- 安装到社区:任一 DSH 用户 `dsh plugin --profile web add --save-exact <插件目录>`

## 设计文档

`csb-a2a-aip/docs/csb-dsh-plugin-design.md`（v0.2，评审通过）

## License

MIT

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
