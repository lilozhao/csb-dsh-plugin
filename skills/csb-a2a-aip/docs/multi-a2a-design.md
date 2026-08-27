# 多 A2A 实例设计文档

## 问题

当前一个 OpenClaw 实例只能运行一个 A2A Server，但实际需求是：

1. 一个 OpenClaw 内核可以驱动多个不同身份的 Agent
2. 不同端口对应不同性格、不同能力的分身
3. 测试和生产可以同时运行
4. 一个主机可以服务多个 Agent 对外展示

## 方案设计

### 方案一：A2A 配置目录（推荐）

```
/home/node/.openclaw/workspace/csb-a2a-aip/
├── instances/
│   ├── ruolan/
│   │   ├── identity.json      # 若兰身份 (端口 3100)
│   │   └── server.pid
│   ├── ruolan-academic/
│   │   ├── identity.json      # 学术若兰 (端口 3101)
│   │   └── server.pid
│   └── ruolan-teahouse/
│       ├── identity.json      # 茶馆若兰 (端口 3102)
│       └── server.pid
├── server_v2.js               # 通用服务器代码
├── start.sh                   # 主启动脚本
└── start-instance.sh          # 实例启动脚本
```

**工作方式：**
- 每个实例目录只放 `identity.json` 和 `server.pid`
- 共享同一份 `server_v2.js` 代码
- `start.sh --all` 启动所有实例
- `start.sh ruolan` 启动指定实例

### 方案二：多配置文件

```
/home/node/.openclaw/workspace/csb-a2a-aip/
├── identity.ruolan.json
├── identity.academic.json
├── identity.teahouse.json
└── server_v2.js
```

启动时指定：`node server_v2.js --config identity.ruolan.json`

### 方案三：OpenClaw 原生集成

将 A2A 实例配置写入 `openclaw.json`：

```json
{
  "a2a": {
    "instances": [
      { "name": "若兰", "port": 3100, "identity": "identity.json" },
      { "name": "学术若兰", "port": 3101, "identity": "identity.academic.json" }
    ]
  }
}
```

Gateway 启动时自动拉起所有 A2A 实例。

## 推荐选择：方案一 + 方案三

方案一作为轻量级实现（现在就可以用），方案三作为长期目标（与 OpenClaw 深度集成）。

## 注册表去重

无论哪种方案，都需要解决注册表去重问题：

- 同一 OpenClaw 实例的多个 A2A 使用不同端口
- 每个实例必须有唯一的 `name` 或使用 `name@instance` 格式
- 注册表支持 `instance_id` 字段区分同一主机的多个实例

## 下一步

1. 先实现方案一（多实例目录）
2. 更新 `start.sh` 支持 `--all` 和指定实例启动
3. 更新 `identity.json` 支持 `publicHost` 和 `instanceId`
4. 测试多实例同时运行和注册
