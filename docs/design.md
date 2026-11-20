# MoonFarm 设计文档

## 1. 目标

用 Moon（C++ Actor 框架 + Lua）实现一个可玩的类 QQ 农场：玩家有若干地块，
买种子 → 种植 → 浇水/施肥 → 收获 → 卖果实 → 再买种子，进度实时存档。

第一期（竖切 MVP）只做“单人农场闭环”，社交、牧场、任务等放到后续迭代。
玩法结构参考经典的 QQ 农场类游戏，数值与资源均为原创。

## 2. 总体架构

```
┌──────────────────────────────┐
│  浏览器客户端 (HTML5 Canvas) │
│  net.js + protobufjs + game.js│
└───────────────┬──────────────┘
                │ WebSocket ws://host:9002
                │ 帧: [cmd:2 LE][protobuf]
┌───────────────▼──────────────┐
│ gate 服务                     │ 连接管理 / 首包鉴权 / 按 uid 路由
└───────┬───────────────┬──────┘
        │ C2S(原始帧)    │ S2C(uid + 帧)
┌───────▼──────┐   ┌────▼──────────────┐
│ auth 服务     │   │ user 服务 × N      │
│ openid→uid    │   │ 一个玩家一个服务      │
│ 创建/复用服务  │   │ Farm/Item/Shop/User│
└───────┬──────┘   └────┬──────────────┘
        │               │
┌───────▼───────────────▼──────┐
│ db 服务 (service/redisd.lua)  │
│ Redis: farm:users / farm:openid│
└──────────────────────────────┘
```

### 2.1 服务职责

| 服务 | 文件 | 职责 |
| --- | --- | --- |
| `db` | `service/redisd.lua` | Redis 连接池，异步读写 |
| `gate` | `game/service_gate.lua` + `gate/Gate.lua` | 监听 TCP/WS；未登录连接的首包转给 auth；已登录连接的消息原样转发给对应 user 服务；S2C 按 uid 发回 socket |
| `auth` | `game/service_auth.lua` + `auth/Auth.lua` | openid → uid；为新玩家 `moon.new_service` 创建 user 服务；把连接绑定到 uid；断线通知 |
| `user` | `game/service_user.lua` + `user/*.lua` | 玩家私有状态：农场、背包、商店；定时/下线落盘 |

`user` 采用 **One Player One Service**：状态不需要加锁，玩家下线后可被回收；
玩家之间互动（第二期）通过服务间消息完成。

### 2.2 登录时序

```
client                 gate                auth                 user(新建)
  │ C2SLogin(openid)    │                   │                     │
  ├────────────────────►│ moon.send         │                     │
  │                     ├──────────────────►│ openid 查 Redis      │
  │                     │                   ├────────────────────►│ User.Load
  │                     │                   │◄────────────────────┤ 从 Redis 读档
  │                     │                   ├────────────────────►│ User.Login
  │                     │◄──────────────────┤ BindUser(fd,uid)    │
  │◄────────────────────┼── S2CLogin ───────┤                     │
  │ C2SEnterFarm        │                   │                     │
  ├────────────────────►│ redirect 原始帧 ─────────────────────────►│
  │◄────────────────────┼── S2CEnterFarm ───────────────────────────┤
```

要点：

- gate 只在**未绑定**的连接上解析首包（必须是 `C2SLogin`）；
- 绑定之后 gate 不再解包业务消息，直接 `moon.redirect` 给 user 服务；
- 服务器主动回包统一走 `S2C` 协议：`[uid 序列化][cmd:2 LE][protobuf]`，gate 解出 uid 后写到对应 fd。

## 3. 协议

- 传输：WebSocket 文本/二进制帧；业务帧内容 `[cmd:2 小端][protobuf 消息体]`
- 消息码：`server/common/CmdCode.lua` ↔ `client/js/protocol.js`
- `.proto`：`server/protocol/common.proto`、`farm.proto`
- 空消息体：只有 2 字节 cmd
- 业务错误：handler `return 错误码` → 框架下发 `S2CErrorCode`
- 操作确认：每个带状态变化的 C2S 操作成功后回 `S2COk{cmd}`，状态变化用推送消息
  （`S2CPlotUpdate` / `S2CItemUpdate` / `S2CPlayerUpdate`）

| 码 | 消息 | 说明 |
| --- | --- | --- |
| 1/2 | C2SLogin / S2CLogin | openid 登录 |
| 3/4 | C2SEnterFarm / S2CEnterFarm | 拉取完整玩家数据 |
| 5 | C2SPlant | 播种 `{index, crop_id}` |
| 6 | C2SWater | 浇水 |
| 7 | C2SFertilize | 施肥（消耗化肥） |
| 8/14 | C2SHarvest / S2CHarvest | 收获 |
| 9/10 | C2SBuy / C2SSell | 商店买卖 |
| 11/17 | C2SPing / S2CPong | 心跳 |
| 12 | S2COk | 操作成功确认 |
| 13 | S2CPlotUpdate | 单块地更新 |
| 15 | S2CItemUpdate | 背包条目更新 |
| 16 | S2CPlayerUpdate | 等级/经验/金币更新 |
| 18 | S2CErrorCode | 业务错误码 |
| 19/20 | C2SHarvestAll / S2CHarvestAll | 一键收获：一次收完所有成熟地，结果合并下发 |
| 21/22 | C2SPlantAll / S2CPlantAll | 一键种植：若干空地一次种同一作物 |

批量操作（19~22）一次请求完成全部动作：地块由结果消息一次性带回，
背包、经验在服务端合并后各推一条，避免 N 块地刷 N 倍推送。
单块 `C2SPlant/C2SHarvest` 保持不变，旧客户端不受影响。

### 3.1 客户端交互

- 点地块按状态分流：可收获 → 直接 `C2SHarvest`；空地 → 弹底部“可种植条”；生长中/锁定 → 只选中
- 底部可种植条列出背包里的种子与库存数量，勾选“一键种植”（默认不勾）后点种子卡片即
  把该作物种满所有空地，实际块数 = min(空地数, 种子数)；不勾则只种当前选中地并自动跳到下一块空地
- 工具栏的“一键收获”按钮带可收获数量角标，点击发一次 `C2SHarvestAll`
- 种植条与工具栏共用底部位置：条打开时工具栏收起，避免遮住第三行地块

## 4. 数据模型

Redis：

```
farm:uid_seq   string  INCR 分配 uid
farm:openid    hash    openid -> uid
farm:users     hash    uid -> JSON(PlayerData)
```

玩家 JSON：

```json
{
  "v": 1,
  "uid": 8,
  "openid": "farmer_demo",
  "name": "小农夫",
  "level": 1,
  "exp": 12,
  "coin": 100,
  "items": { "1001": 5, "1003": 2, "1103": 4, "2001": 2 },
  "plots": [
    { "state": 2, "crop_id": 3, "planted_at": 1794919742320,
      "ready_at": 1794919762320, "watered": true, "fertilized": true },
    { "state": 1 },
    { "state": 0 }
  ],
  "ctime": 1794919700,
  "logintime": 1794919742
}
```

地块状态：`0 锁定 / 1 空地 / 2 生长中 / 3 成熟`。
服务器只在 `state=2 且 now >= ready_at` 时动态返回 3，收获后才落回 1，
因此**离线期间作物也会自然成熟**。

## 5. 数值设计（演示用短周期）

| 作物 | 种子价 | 生长 | 产量 | 卖价 | 经验 |
| --- | --- | --- | --- | --- | --- |
| 胡萝卜 | 6 | 20s | 2–4 | 3 | 4 |
| 小麦 | 10 | 45s | 3–5 | 4 | 6 |
| 番茄 | 25 | 90s | 4–6 | 10 | 12 |
| 草莓 | 50 | 150s | 3–5 | 20 | 20 |

- 浇水：总时长 −10%，每次种植限一次，+1 经验
- 施肥：总时长 −30%，消耗 1 个化肥（20 金币），每次种植限一次，+1 经验
- 升级：`下一级经验 = 100 + (等级-1) × 50`
- 初始：100 金币、5 小麦种子、3 胡萝卜种子、2 化肥、6 块解锁地

> 真实 QQ 农场以小时计；这里压到秒级是为了方便本地联调和演示，
> 改 `server/common/config/crops.lua` 即可调整。

## 6. 服务端代码要点

### 6.1 模块自动注册

`common/setup.lua` 会加载 `game/<服务名>/` 下所有 `.lua`：

- 函数名以 `C2S` 开头 → 自动注册为客户端消息处理函数
- 其它函数 → 注册为 `"模块名.函数名"`，可被 `moon.call/send` 调用
- `Init` / `Start` / `Online` / `Offline` 是生命周期钩子

新增一个系统只需要在 `game/user/` 放一个文件，写 `C2SXxx` 函数即可。

### 6.2 为什么 user 服务要覆盖 C2S dispatch

gate 转发的是**原始客户端帧**（没有 uid 前缀），而框架默认的 `C2S` dispatch
会先 `seri.unpack_one` 读 uid。因此 `service_user.lua` 在 `setup()` 之后用
`moon.raw_dispatch("C2S", ...)` 覆盖分发逻辑，直接按消息码调用本地 handler。
（MoonDemo 也是同样做法。）

### 6.3 存档时机

- 每 5 秒检查脏标记，脏则异步 `HSET`
- 玩家下线（socket close）立即存一次
- 关服时 auth 依次调用每个 user 的 `User.Exit()` 落盘后退出

## 7. 客户端

- 纯 HTML5：`Canvas2D` 画农场，DOM 画 HUD/面板
- 协议层复用 MoonDemo 的思路：`protobufjs` 在浏览器内解析内嵌的 `.proto` 源码
  （`tools/gen_proto_inline.js` 生成 `js/proto-inline.js`）
- **`protobuf.parse(text, { keepCase: true })` 必须开启**，否则 `crop_id` 会被
  转成 `cropId`，与服务器字段对不上
- 解码用 `toObject(..., { longs: String, defaults: true })`：64 位整数不丢精度，
  且 `state=0` 这类默认值也会出现
- 生长进度由客户端按 `planted_at/ready_at` 本地插值绘制，服务器仍是权威

## 8. 目录

```
myFarm/
├── server/
│   ├── main.lua               入口: 载入 proto → 起 db/auth/gate
│   ├── serverconf.lua         端口 / Redis
│   ├── common/                框架层（setup/protocol/Database/配置）
│   ├── protocol/              .proto
│   └── game/                  gate / auth / user 及玩家模块
├── client/
│   ├── index.html
│   ├── js/{protocol,net,cfg,game,main}.js
│   └── js/vendor/             protobufjs + long.js
├── tools/
│   ├── serve.js               静态服务器
│   ├── gen_proto_inline.js    重新内嵌 proto
│   ├── test_e2e.js            27 项端到端测试
│   ├── test_persist.js        断线重连存档测试
│   └── screenshot.js          CDP 截图（文档用）
└── docs/
```

## 9. 路线图

**第二期：社交**

- 拜访好友农场（view service 或 user 服务间 RPC）
- 偷菜 / 帮浇水 / 帮除草（动作枚举参考经典农场类游戏）
- 好友列表、最近访客、好友排行
- 防刷限制（每块地每个玩家只能偷一次、偷取比例上限）

**第三期：养成与运营**

- 牧场：鸡/鸡蛋，动物成长阶段与产出
- 图鉴、任务、邮件、成就
- 皮肤/装扮、月卡

**第四期：工程化**

- 静态配置迁到 `sharetable`，支持热更配表
- 多节点：cluster + 跨服拜访
- 压力测试（`example/send_benchmark.lua` 可改造成机器人）
- 管理后台/HTTP 接口（`example/example_http.lua`）

## 10. 已知限制

- 所有 C2S 都走玩家自己的 user 服务，尚未做消息限流/防重放
- 配置在客户端与服务器各有一份，修改时要同步（后续可由服务器下发）
- 未做账号鉴权（openid 直接当身份，仅适合本地学习）
- 商店没有库存/限购、没有交易行
- 只验证了 WebSocket，TCP 通道代码保留但未测试