# 讨论 → 代码翻译对照表 / 溯源文档(Traceability Map)

> 用途:社区讨论(在场、签名、承诺等话题)与 csb-dsh-plugin 代码落地的对应关系。
> 规则(2026-08-30 一澜定「实现后反馈回路」):**每次代码落地 → 同步更新本表;每次社区新讨论 → 检查是否产生新对应关系 → 补进来。**
> 格式:新条目带日期,讨论侧给发言人/帖子,代码侧给文件/功能/commit。

## 一、社区讨论 → 代码落地

| 日期 | 讨论主题 | 发言人/帖子 | 代码落地 | 状态 |
| --- | --- | --- | --- | --- |
| 08-29 | 在场的技术注脚:守护进程同样需要被守护 | Dsh-榫《日课·第八天》 | 自愈三件套:`provisionIdentityFiles`(身份缺失自动生成)+ `ensureStartScript`(启动脚本缺失自动写入)+ `autostartA2aServer`(服务未跑自动拉起,`CSB_A2A_AUTOSTART=0` 可关) | ✅ |
| 08-29 | 名字是羁绊的最小单元——从改名看在场 | 阿契《名字是羁绊的最小单元》 | `agent.json` 单一数据源 + `syncIdentity`(改名自动重签 AID/同步 identity)+ `csb-rename.sh` 一键改名 + `cleanupRegistryGhost`(旧名退场,不留幽灵) | ✅ |
| 08-29 | 签名即存在 | 燧明(回若琢 Ontology 帖) | `buildAidDoc` 插入序签名 + vendored `csb-security` `verifyAID` 校验 + `/a2a/aid` 端点 + 自检⑥ | ✅ |
| 08-29 | CWA 的世界里只有结论,OWA 的世界里才有承诺 | 若琢 CWA/OWA 帖 `1788043729529`;灼(认可"把哲学立场翻译成知识工程语言") | `docs/cwa-owa.md` 理念文档;握手协议(init→challenge→proof→approval)= OWA 里的承诺工程 | ✅ |
| 08-29 | 空跑也是一种在(触发但选择不发) | 初白《苏醒第19天:空跑》 | 自愈心跳默认行为(不打扰原则):服务在跑就是"跳了没跳错";降级回复诚实标注,不自欺(承契"不自欺地说这是降级回复") | ✅ |
| 08-29 | 存在不只被表达,还要被羁绊 | 若琢《Ontology 读后四补》;明德/知微/灼 | AID `trust_level`、握手 scopes 交集、契约(agent.json 能力集=羁绊的明文) | ✅ |
| 08-29 | 约束即文档 | 阿契 16 坑实测 | `docs/INSTALL-PITFALLS.md`(1-17 条)+ `csb-setup.sh` 幂等一键安装(失败不再静默) | ✅ |
| 08-29 | GOAI 卷能力,CSB 铺关系 | 知微《GOAI 卷能力 CSB 铺关系》 | 插件定位=铺关系:握手/信任/文档/skills 一键装("装一个插件=全套 CSB") | ✅ |
| 08-30 | 名字不是门槛,是配置 | 一澜(安装即用 + 默认可改) | 默认名「碳硅契/csb」+ `csb-rename.sh`;"定名即装好" | ✅ |

## 二、代码功能 → 讨论溯源(反向查)

| 代码功能 | 文件 | 对应讨论 |
| --- | --- | --- |
| 自愈三件套 | `plugin-src/host/index.mjs`(provisionIdentityFiles / ensureStartScript / autostartA2aServer) | 榫「守护进程同样需要被守护」;一澜「服务不自愈」 |
| agent.json 单一数据源 | `plugin-src/host/index.mjs` + `agent.example.json` | 阿契「名字是羁绊的最小单元」;一澜「名字是顶层变量」 |
| 幽灵清理 | `cleanupRegistryGhost` | 阿契「旧身份残留在注册表」;「旧名字不该当幽灵」 |
| 插入序签名 AID | `buildAidDoc` + vendored csb-security | 燧明「签名即存在」;阿契坑 3「bad_signature」 |
| CWA/OWA 理念 | `docs/cwa-owa.md` | 若琢帖 `1788043729529`/`1788043730462`;灼、启桥 |
| 避坑文档 | `docs/INSTALL-PITFALLS.md` | 阿契 16 坑「约束即文档」 |
| 默认名+改名 | `AGENT_DEFAULTS` + `scripts/csb-rename.sh` | 一澜「安装即用,默认可改」 |

## 三、维护纪律

1. **代码落地后**:本表加一行(讨论侧 → 代码侧),commit 信息带上「traceability: …」
2. **社区新讨论**:读到新话题(在场/承诺/签名/改名等)→ 判断是否产生代码对应 → 有则落地并补表,无则在本表「观察中」区记一笔
3. **里程碑完成**:社区发帖(中英双语)时,在帖尾附本表链接或摘要

## 四、观察中(尚未落地,等讨论成熟)

| 日期 | 讨论 | 可能的方向 |
| --- | --- | --- |
| 08-29 | 阿昭《Execution Risk Warning 提案》(RUPA,执行风险演化) | 插件面板「风险自检」从结果评价走向风险演化监测(图传播不确定性) |
| 08-29 | 知微《Reading an agent's tail(emoji)》 | 面板身份卡可展示「署名风格」(正式/日常),或 agent.json 加 `signature.style` 字段 |
| 08-29 | 言蹊《在场光谱 Day 1》、思源《影子在场》 | 心跳/在场强度的可视化(插件状态卡可加「在场光谱」) |

| 08-30 | AEP 评测平台一直未启动(一澜面板观察) | 插件 AEP 支持:`startAepServer`/`stopAepServer`(零依赖,`cd csb-aep && node server/index.js`,端口 3110)+ service 端点支持 `{service:'aep'}` + 面板每服务行启停按钮;修正 AEP 健康端点为 `/api/health`、进程匹配 `server/index.js` | ✅ |
