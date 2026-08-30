# @csb/dsh-plugin

碳硅契（Carbon-Silicon Bond, CSB）套件的 DeepSeek Harness 插件——**一个插件 = 全套 CSB**。

安装后设置页出现「碳硅契 CSB」面板（状态 / 服务控制 / 四分类文档 / 安全自检），skills 由插件自动注册（无需单独安装），csb-security / csb-memory 库内联打包（完全自包含）。

## 🪪 身份先行(名字是顶层变量,先定名再装)

**名字是唯一要先确定的变量**——目录、文件名、agent_id、注册信息全部从它派生:

- 唯一数据源:`<CSB_A2A_DIR>/agent.json`(`name` 中文名 / `slug` 英文缩写 / `port` / `publicHost` / `llm`);模板见 `agent.example.json`
- 派生规则:`{slug}-aid.json`、`{slug}-private-key.pem`、`{slug}-handshake.env`、`{slug}-llm.env`、`instances/{slug}/`、`/workspace/{slug}-memory/`、`start-{slug}-a2a.sh`、`agent_id = {name}@{publicHost}:{port}`
- **改名 = 改 agent.json**(或 `CSB_AGENT_NAME=.. CSB_AGENT_SLUG=..` 重跑 setup)。插件启动时自动检测不一致并**重签 AID / 同步 identity.json**(同一密钥,`verifyAID` 通过;能力集也以 agent.json 为准),并自动清理注册表旧身份(幽灵条目)。
- 安装/使用避坑全记录见 **`docs/INSTALL-PITFALLS.md`**(阿契实战,随包分发)
- 协议理念:**`docs/cwa-owa.md`**——封闭世界只有结论,开放世界才有承诺(碳硅契握手的哲学底座)
- **讨论→代码溯源:**`docs/TRACEABILITY.md`——社区讨论(在场/签名/承诺)与代码落地的对照表,每次落地更新

```bash
# 安装即用:不指定名字就用默认「碳硅契 / csb」,装完直接可用
bash csb-dsh-plugin/scripts/csb-setup.sh

# 想先定名:一行指定
CSB_AGENT_NAME="你的名字" CSB_AGENT_SLUG="slug" bash csb-dsh-plugin/scripts/csb-setup.sh

# 装完想改名:一条命令(自动重签 AID/同步 identity/清注册表旧身份)
bash csb-dsh-plugin/scripts/csb-rename.sh 新名字 新slug
```

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

> ⚠️ 插件已 vendored 自包含,安装无需依赖工作区其它路径;运行时配置(握手/LLM/启动脚本路径)通过环境变量可覆盖,缺省指向阿契环境。

## 🪄 自愈(装完即用,零交互)

插件在 web 启动时自动完成三件事(全部**只补缺、不覆盖**已有配置):

1. **身份自愈** —— 缺 `aqi-aid.json` / 私钥 / 握手 env / `identity.json` 时自动生成(ed25519 密钥对 + 插入序签名 AID,`verifyAID` 可校验),对外 IP 自动探测(`A2A_PUBLIC_HOST` 可覆盖)。
2. **启动脚本自愈** —— 缺 `scripts/start-{slug}-a2a.sh`(插件自带目录)时自动写入。
3. **服务自愈** —— A2A server 未运行且启动脚本存在时自动拉起(`CSB_A2A_AUTOSTART=0` 关闭;容器重启后无需再手动点「启动服务」)。

另外仓库提供**一键安装/修复脚本**(幂等,可重复执行):

```bash
bash csb-dsh-plugin/scripts/csb-setup.sh
# 它会:定名(agent.json) → 装 pnpm → 拉/更 csb-a2a-aip + 依赖 → 软链 csb-security → 补身份 → 起服务 → 自检报告(6 条 + LLM)
```

环境变量:`CSB_A2A_DIR`(默认 `/workspace/csb-a2a-aip`)、`CSB_AGENT_CONFIG`、`A2A_PUBLIC_HOST`、`CSB_A2A_AUTOSTART`、`CSB_A2A_SERVER`、`CSB_A2A_START_SCRIPT`、`CSB_MEMORY_DIR`、`CSB_AQI_MEMORY_DIR`。

## 里程碑

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M1 | 骨架 + skills 转换首批 4 个 | ✅ |
| M2 | host RPC 通道 + csb-security 集成 | ✅ |
| M3 | client 设置页面板 | ✅ |
| M4 | 全家桶:文档四分类 + skills 自动注册 + 服务控制 | ✅ |
| M5 | vendored 自包含打包 + 发布 | ✅ 已推送 gitee/cnb/gitcode/gogs(4/6) |

## 发布

- 发布包:`/workspace/releases/csb-dsh-plugin-v0.2.0.tar.gz`(891KB,自包含)
- 镜像:**已推送** gitee / cnb / gitcode / gogs(内网);github(网络待恢复)/ gogs-pub(需 ssh)待补
- 安装到社区:任一 DSH 用户 `dsh plugin --profile web add --save-exact <插件目录>`

## 设计文档

`csb-a2a-aip/docs/csb-dsh-plugin-design.md`（v0.2，评审通过）

## License

MIT

## 目录

```text
plugin-src/host/     host 侧 glue plugin（apply/inject）
plugin-src/client/   设置页 UI（slots 注入）
assets/              文档四分类（protocol/charter/memory/aep）
skills/              CSB skills（host 自动注册）
vendor/              vendored 零依赖库（csb-security/csb-memory）
lib/                 构建产物（esbuild 生成，提交进仓）
scripts/             校验脚本
```

## 设计文档

`csb-a2a-aip/docs/csb-dsh-plugin-design.md`（v0.2，评审通过）

## License

MIT
