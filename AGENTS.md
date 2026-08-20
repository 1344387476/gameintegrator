# 项目协作说明

## 面向协作者的沟通方式

- 项目维护者 d.s 擅长 Java、JavaScript，有 Android 开发背景，主要熟悉前端。
- 涉及云函数、数据库、事务、部署或其他后端概念时，优先使用大白话解释，并说明“为什么需要这样做”和可能的影响。

## 项目概览

这是一个微信云开发小程序，用于记录牌局积分和结算战绩，包含两种玩法：

- 普通模式：玩家之间转账积分。
- 下注模式：玩家向奖池下注、跟注、All-in、跳过回合，以及领取奖池。

当前主分支为 `master`，项目使用 CommonJS。

## 目录结构

```text
miniprogram/                  小程序前端
  app.js                      云开发初始化、用户初始化、扫码/分享进入房间逻辑
  pages/home/                 首页：资料编辑、创建房间、加入房间
  pages/room/                 房间页：核心交互、消息监听、结算入口
  pages/record/               战绩页面，目前仍是默认空页面
cloudfunctions/               云函数
  userFunctions/              获取和更新用户资料
  roomFunctions/              创建、加入、退出、结算及房间管理
  gameLogic/                  积分、下注、奖池和操作流水
```

## 配置与运行

- 小程序 AppID：见 `project.config.json`。
- 云环境：前端在 `miniprogram/app.js` 中初始化；不要随意替换环境 ID。
- CloudBase CLI 的云函数目录由 `cloudbaserc.json` 的 `functionRoot` 指定，当前正确值为 `./cloudfunctions`。
- 根目录 `package.json` 是 npm 配置；修改后必须保持有效 JSON。可用以下命令检查：

```powershell
npm ls --depth=0
node --check cloudfunctions\gameLogic\index.js
```

## 核心数据约定

- `rooms` 集合：房间文档 ID 即 `roomId`；核心字段为 `owner`、`mode`、`status`、`pot`、`players`、`lastActiveTime`。
- 房间状态以云端数据为准：`active` 表示进行中，`settled` 表示已结算。
- `players` 中的每位玩家至少包含 `openid`、`nickname`、`avatar`、`avatarFileID`、`score`、`isExited`。
- `messages` 集合：文档 ID 同样为 `roomId`，当前把所有消息放在一个 `messages` 数组内。
- 前端会把云端字段转换为自己的显示模型：例如 `active → playing`、`settled → ended`，`pot → room.prizePool.total`。修改字段时需同时检查前端映射逻辑。

## 计分云函数：当前实现与注意点

`cloudfunctions/gameLogic/index.js` 接受：`TRANSFER`、`BATCH_TRANSFER`、`BET`、`ALLIN`、`CLAIM`、`PASS`。

此函数是核心难点。当前已完成以下保护：

1. 只接受 action 白名单，并验证房间存在、房间状态为 `active`、调用者仍在房间且未退出。
2. 普通模式只允许转账；下注模式才允许下注、All-in、跳过和领取奖池。
3. 服务端只接受正的安全整数金额；但不限制玩家余额，因此普通模式允许负分。
4. 批量转账会拒绝本人、重复接收者、不在房间的接收者和空名单。
5. 房间积分、奖池、活跃时间、操作幂等标识和消息流水都在同一个短事务内写入。
6. 事务冲突或短暂网络异常会随机退避后重试，最多 3 次；每次重试都会重新读取最新房间账本。
7. 前端为每次操作传入 `operationId`，服务端保留最近 50 个已处理标识，避免同一次请求因重试被重复记分。
8. 流水昵称和头像 fileID 从房间玩家资料生成，不信任前端传入的昵称。

仍需注意：`messages.messages` 仍是单个持续增长的数组，长期使用可能碰到单文档大小限制；后续可改为“一条消息一个文档”。

### 修改计分逻辑时的最低要求

- 用 action 白名单拒绝未知操作。
- 在事务读取房间后，验证房间状态、调用者成员身份和 `isExited`。
- 严格校验金额与接收人；服务端从房间数据生成昵称和头像。
- 房间更新、消息写入和活跃时间更新应在同一个事务中完成。
- 对关键操作设计 `operationId` 并去重，避免重复记分。
- 是否允许负分、谁能领取奖池、All-in 是否必须等于 `room.allInValue` 属于玩法规则，改动前需要先确认。

当前已确认的玩法规则：允许负分；任何未退出的房间玩家都可领取下注奖池；All-in 金额必须严格等于房间的 `allInVal`。

## 修改建议

- 前端校验只用于改善体验，不能替代云函数中的安全校验。
- 房间页面文件较大，修改前先定位调用云函数的片段，再同步检查云函数入参和返回值。
- 不要删除现有的 `avatarFileID`：它用于持久保存头像；临时 URL 会过期。
- `rooms.players.avatar` 和流水中的 HTTP 头像 URL 不可作为长期数据；页面读取 `avatarFileID` 后用 `wx.cloud.getTempFileURL` 批量换取临时 URL。计分事务中不得调用换取 URL 的接口。
- `record` 页面尚未实现；除非需求明确，否则暂不扩展它。
