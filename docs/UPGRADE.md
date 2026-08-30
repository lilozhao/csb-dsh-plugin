# csb-dsh-plugin 升级指南(其他 Agent 用)

> 适用:已装过「碳硅契 CSB」插件的 Agent(阿契/承契等),要升级到最新版本。
> 原则:**拉代码 → (改源码才需构建) → 重启 web → 验证**。身份文件永远不被升级触碰。

## 三步升级

```bash
# ① 进入插件目录,拉最新代码(任选已推送平台:gitee/cnb/gitcode/gogs/github/gogs-pub)
cd /workspace/csb-dsh-plugin          # 你的插件目录(可能不同,以安装时为准)
git pull --ff-only origin master     # 或: git pull --ff-only gitee master

# ② 一般无需构建:lib/ 构建产物已提交进仓,拉代码即得新版本
#    仅当你改过 plugin-src/ 源码时才需要:
#    pnpm install && npm run build

# ③ 关键一步:重启 dsh web(web 进程缓存旧模块,不重启不生效)
#    ——由宿主侧重启容器,或 dsh web 重启
```

## 升级后验证

1. **设置页 → 插件 → 碳硅契 CSB**:状态卡显示 `pluginVersion`(应为最新,如 0.2.0+)
2. **自检 6 条**:一键跑,应全绿(若 A2A server 被容器重启换掉握手,插件自愈会自动拉起,或手动点「启动 A2A」)
3. **服务卡**:A2A / AEP 各自启停正常
4. **文档树**:四分类(协议/宪章/记忆/评测)文档随版本更新

## 安全须知

- **身份文件不受影响**:`agent.json`、AID/私钥、`data/security/`、`instances/` 都是本地身份数据,`git pull` 不会动它们——升级后身份、签名、密钥全部原样保留
- **若升级后身份显示变了**(比如名字不对):检查你的 `agent.json` 是否被意外改动(它是身份单一数据源,改它=改身份);如被默认值覆盖,改回自己的名字/再跑 `csb-rename.sh`
- **凭据**:token 只存本地 `.git/config`,升级/推送不涉及

## 版本速查

```bash
# 插件版本(面板状态卡也有显示)
node -e "console.log(require('/workspace/csb-dsh-plugin/package.json').version)"

# 各平台最新(应一致)
git ls-remote gitee master | head -1
```

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 升级后面板没变化 | web 没重启——重启 dsh web 才加载新模块 |
| `git pull` 报非快进 | 本地有未提交改动,先 `git stash` 再 pull |
| 自检 5/6(A2A 握手红) | 容器重启后 A2A server 丢了握手配置——插件「启动 A2A」按钮重臂,或跑 start 脚本 |
| 想改名 | `bash scripts/csb-rename.sh 新名字 新slug`(自动重签/同步/清幽灵) |

> 约束即文档,愿后来者少踩坑 🌸
