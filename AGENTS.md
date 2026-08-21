# 项目协作与交接说明

> 本文件记录当前代码的真实状态、已确认的产品规则和接手注意事项。开始修改前先读本文件；若代码与本文不一致，以代码和实际云端数据为准，并同步修正文档。

## 协作规则

- 维护者 d.s 擅长 Java、JavaScript，有 Android 背景，主要熟悉前端。解释云函数、数据库、事务、权限、索引和部署时，用大白话说明为什么、影响和验证方法。
- 禁止批量删除文件或目录。只能一次删除一个明确路径的文件；需要批量删除时停止并请用户手动处理。
- 当前主分支为 `master`，项目使用 CommonJS。

## 项目概览

这是一个微信云开发小程序，用于创建牌局房间、多人实时记分、结算并保存战绩：

- `normal` 普通模式：玩家之间单笔或批量转分。
- `bet` 下注模式：下注/跟注、All-in、跳过和领取奖池。

建议接手时依次阅读：

1. `miniprogram/app.js`：云环境、用户初始化、扫码/分享入口。
2. `miniprogram/pages/home/home.js`：资料、创建/加入/返回房间。
3. `miniprogram/pages/room/room.js`：实时状态和所有核心交互；文件很大，先按 action 或云函数名定位。
4. `cloudfunctions/gameLogic/index.js`：积分和奖池账本，安全与并发核心。
5. `cloudfunctions/roomFunctions/index.js`：房间生命周期、二维码、头像、结算和战绩。
6. `miniprogram/pages/record/record.js`、`components/history-detail/`：战绩列表、详情、结算建议和海报。
7. `tests/`：已经固化的行为约束。

## 目录职责

```text
miniprogram/
  app.js                         云开发初始化、用户初始化、扫码/分享入口
  pages/home/                    资料编辑、创建/加入/返回房间、扫码
  pages/room/                    实时监听、计分、设置、结算、分享
  pages/record/                  战绩分页列表和详情
  components/history-detail/     结算转账建议和战绩海报
  utils/theme.js                 深浅主题和原生导航/TabBar 配色
  utils/motion.js                按设备能力降级动效
  utils/room-entry.js            扫码结果和多重编码 scene 解析
  utils/settlement.js            按最终积分生成线下结算建议
  utils/display.js               不可信旧数据的展示兜底
cloudfunctions/
  userFunctions/                 用户初始化、资料、当前房间状态
  roomFunctions/                 房间生命周期、头像、二维码、结算、战绩
  gameLogic/                     转分、下注、奖池和流水事务账本
tests/                            Node 内置 test runner 测试
```

## 配置、运行与发布

- AppID 见 `project.config.json`，当前为 `wx7687ea673d95f908`。
- 前端在 `miniprogram/app.js` 初始化云环境，当前为 `cloud1-5gv2wyv347737dc9`；不要随意替换。
- `cloudbaserc.json` 的 `functionRoot` 正确值为 `./cloudfunctions`。
- `roomFunctions/config.json` 需要 `wxacode.getUnlimited` OpenAPI 权限。
- `roomFunctions` 中小程序码 `qrVersion` 当前硬编码为 `release`。开发/体验测试若临时改为 `develop`/`trial`，上线前必须恢复。
- 根依赖为 `weui-wxss` 和 `wx-server-sdk`；微信开发者工具配置为手动构建 npm。
- 修改云函数后必须重新上传部署对应云函数；只编译前端不会更新线上后端。

常用验证：

```powershell
npm install
npm test
npm ls --depth=0
node --check cloudfunctions\gameLogic\index.js
node --check cloudfunctions\roomFunctions\index.js
node --check cloudfunctions\userFunctions\index.js
```

`npm test` 覆盖主题、动效、扫码解析、普通转账调用、房间结算/删除监听、战绩和结算算法。它以纯函数和 mock 为主，不替代真实云环境联调；事务、权限、OpenAPI、云存储和 watcher 仍需开发者工具及多账号验证。

## 页面和生命周期

### 启动与用户

- `app.js` 初始化云开发，由 `userFunctions/getUserInfo` 按 `OPENID` 读取或创建 `users` 文档。
- 新用户默认昵称为“玩家 + 3 位随机数”，默认头像为空。
- `globalData.currentRoomId` 来自用户文档。应用不再强制跳回旧房间，首页显示“返回房间”。
- 分享卡片、小程序码和扫码把房间号暂存在 `globalData.pendingRoomId`，由首页完成加入。
- 外部入口的新用户会设置 `isNewUserFromExternal`，房间页据此提示补资料。
- 首页昵称在输入框失焦后自动保存，头像上传后立即保存；创建、加入、外部加入和返回房间前必须等待资料保存完成，活动房间同时同步玩家资料快照。

### 创建、加入、退出

- 用户同一时间只能关联一个 `active` 房间，依赖 `users.currentRoomId` 和云端复核。
- 房间号为 6 位大写随机 base36 字符，目前没有显式碰撞重试，是小概率已知风险。
- 每局最多保留 8 位参与者。退出玩家不从 `players` 数组移除，而是标记 `isExited: true`；积分账本继续参与结算和战绩，重新加入时恢复原账本。
- 创建时同时创建同 ID 的 `messages` 文档；二维码在玩家首次打开邀请二维码时按需生成，失败不影响房间本身。
- 房主退出会把房主转交给第一位未退出玩家；最后一人退出删除房间、消息和二维码，不生成战绩。

### 实时同步

- 房间页分别 watch `rooms/{roomId}` 和 `messages/{roomId}`。
- 云端 `active/settled` 映射为前端 `playing/ended`。
- 云端 `pot` 映射为 `room.prizePool.total`，`allInVal` 映射为 `room.allInValue`。
- watcher 收到结算或删除后立即锁定操作；非结算发起者先收到提示，再展示结果。
- 修改页面显示/隐藏、卸载、重进逻辑时要防重复监听和陈旧回调，运行 `room-lifecycle.test.js` 并双账号验证。

### 结算、解散、战绩

- 只有房主能结算或解散。
- `settle` 在事务中新增 `history` v2、将房间标为 `settled`、清空全部玩家的 `currentRoomId` 和二维码引用。房间数据保留，二维码云文件在事务提交后尽力删除。
- 下注模式必须先清空奖池才能结算。
- `dismiss` 仅用于进行中房间：物理删除房间且不生成战绩；消息和二维码在主事务后尽力清理。
- 战绩页已经完整实现，并非占位页：分页列表、参与者权限、详情、排名、结算建议和保存海报。
- 旧战绩不迁移、不进入 v2 列表；详情也不再返回旧 `betSummary`，两种模式统一展示最终积分。
- `utils/settlement.js` 只给出线下转账建议，不改云端数据；积分合计不为 0 时会标记不平账。

## 云函数接口

调用者身份统一来自 `cloud.getWXContext().OPENID`，不得信任客户端传入的 openid。

### `userFunctions`

- `getUserInfo`：读/建用户并返回资料、`currentRoomId`、openid。
- `updateUserInfo`：更新昵称/头像；昵称最多 10 个字符。
- `getUserRoomStatus`：复核房间仍存在、活跃且用户仍是成员，否则清理陈旧关联。

### `roomFunctions`

- `create`、`join`、`leave`：房间生命周期。
- `settle`、`dismiss`、`deleteSettledRoom`：结算、解散、清理用户侧旧关联。
- `checkUserStatus`：首页“返回房间”和进入检查。
- `updateProfile`：同步房间玩家快照与用户资料。
- `updateAllInValue`：仅下注模式房主可设置正安全整数。
- `generateQRCode`：复用或生成上传二维码。
- `getAvatarUrls`：只为当前房间成员换取房间/消息中允许的 fileID 临时 URL。
- `listHistory`：仅调用者参与的 v2 战绩，默认每页 20、最大 50。
- `getHistoryDetail`：仅参与者可读。

### `gameLogic`

- `TRANSFER`：普通模式单笔转分。
- `BATCH_TRANSFER`：普通模式批量转分，最多 7 个不同接收者。
- `BET`：下注模式投入奖池；“跟注”本质也是此 action。
- `ALLIN`：金额必须严格等于 `allInVal`。
- `CLAIM`：领取整个奖池并将 `pot` 归零。
- `PASS`：仅记录跳过消息。

所有 action 都使用 `payload`，至少带 `roomId` 和 `operationId`；金额操作带 `amount`，单转带 `toOpenid`，批量带 `transferList`。`operationId` 必须为 8～80 字符字符串。

## 数据模型

### `users/{OPENID}`

- `nickname`、`avatar`、`avatarFileID`
- `currentRoomId`：当前活跃房间；结算、解散、退出时清空
- `createTime`、`updateTime`

### `rooms/{roomId}`

文档 ID 即房间号，核心字段：

- `owner`、`roomName`（最多 20 字符）
- `mode`：`normal` / `bet`
- `status`：`active` / `settled`
- `pot`：非负安全整数；`allInVal`：可能尚未设置
- `players`：玩家账本数组
- `qrCode`：永久云文件 ID
- `qrCleanupPending`：仅在结算后二维码云文件删除失败时记录待巡检清理的 fileID
- `createTime`、`lastActiveTime`
- `recentOperationIds`：最近 50 个计分操作 ID

玩家至少含 `openid`、`nickname`、`avatar`、`avatarFileID`、`score`、`isExited`；下注后可能有 `lastDepositAmount`、`lastDepositTime`。`score` 可为负但必须是安全整数。

### `messages/{roomId}`

- 文档 ID 与房间相同，所有消息放在持续增长的 `messages` 数组。
- 消息保存发送/接收者 openid、昵称、头像 fileID、内容、类型、时间；计分消息还可能含 `operationId`、`amount`、`potAfter`。
- 类型包括 `create`、`join`、`leave`、`system`、`settle`、`transfer`、`bet`、`allin`、`claim`、`pass`。

### `history/{autoId}`

- `schemaVersion: 2`
- `roomId`、`roomName`、`mode`、`endTime`
- `players`：结算快照，只留 openid、昵称、永久头像 fileID、最终分数、退出状态
- `participantOpenids`、`ownerOpenid`、`ownerNickname`、`settledBy`

列表查询使用 `schemaVersion + participantOpenids(_.all) + endTime desc`。若云端提示缺索引，应按错误链接建立组合索引，不要改为客户端全量过滤。

## 计分账本硬性规则

`cloudfunctions/gameLogic/index.js` 是最不能弱化的部分：

1. 只接受 action 白名单。
2. 在事务中读取最新房间，再验证房间存在、`active`、调用者是未退出成员。
3. 严格隔离普通/下注模式操作。
4. 金额和运算结果必须是 JavaScript 安全整数，金额必须为正。
5. 允许负分，不做余额不足拦截；这是已确认玩法。
6. 任何未退出成员都可领取整个奖池；这是已确认玩法。
7. All-in 金额必须严格等于 `room.allInVal`。
8. 禁止给自己转分；批量拒绝空列表、重复/非成员接收者和超过 7 人。
9. 流水昵称和头像必须从房间玩家生成，不信任前端展示字段。
10. 积分、奖池、活跃时间、幂等 ID 和计分流水在同一短事务中写入。
11. 非业务型事务错误随机退避重试最多 3 次，每次重读最新账本。
12. 前端每次操作生成唯一 `operationId`；服务端保存最近 50 个，重复请求成功返回 `duplicated: true`，防止重试重复记分。

前端校验只改善体验，不能替代云端校验。新增 action 要同步处理：前端入口、防重复提交、云端白名单、模式/成员/状态/参数校验、事务、消息、动效和测试。

## 头像和分享资源

- 长期只依赖 `avatarFileID`。HTTP 临时 URL 会过期，不能写入历史快照或当作可靠头像源。
- 页面用 `roomFunctions/getAvatarUrls` 批量换临时 URL，默认头像 `/images/avatar.png`。
- 不要删除已有 `avatarFileID`；未上传新头像时保留旧值。
- 计分事务中不得换临时 URL，避免拉长事务和引入外部失败。
- 二维码在首次打开邀请二维码时生成到 `room-qrcodes/{roomId}.png`；结算、最后一人退出或解散时尽力删除。
- `onShareAppMessage` 必须同步返回，房间页因此提前准备分享图；调整时注意异步时机。

## 一致性边界和已知风险

- `gameLogic` 的账本和计分流水处于同一事务，原子性较强。
- `roomFunctions` 不是所有附属动作都原子：创建/加入/结算后的系统消息、解散后的消息/二维码清理有些在主事务后执行。可能出现核心状态成功但消息/资源未清理，排查时先看核心文档。
- `messages.messages` 单文档无限增长，长期会碰体积/性能限制。后续应改为一条消息一个文档并按 `roomId + timestamp` 分页/监听；这是需要迁移的数据模型改动。
- 房间和玩家账本是数组整包更新。8 人上限减轻体积问题，但生命周期并发仍可能覆盖。
- `roomFunctions` 部分旧代码安全性弱于 `gameLogic`。修改入口时要重新检查事务内二次鉴权、成员、状态、参数和并发，不能只靠事务外预检查。
- 数据库安全规则和已部署云函数版本不在仓库内。出现本地正确、线上不对时，先核对云环境、部署版本、集合权限和索引。
- 结算后保留 `rooms` 与 `messages`，当前没有自动归档/清理策略，长期需评估存储增长和隐私保留期。

## 修改与交付检查

- 改房间字段/状态：同步检查 `roomFunctions`、`gameLogic`、room 页数据映射和 watcher、home 返回房间、历史快照、测试。
- 改资料/头像：同步检查 `users`、`rooms.players`、`messages`、`history.players` 和临时 URL 换取。
- 改结算：保持房主权限、防重复、下注奖池先清空，且历史、房间状态和全部 `currentRoomId` 同事务；检查积分守恒和非房主体验。
- 提交前查看 `git status`，不要覆盖维护者现有改动；运行 `npm test` 和三个云函数的 `node --check`。
- UI 改动检查浅/深色、低性能动效、长昵称、大分数、空态和错误态。
- 实时房间至少双账号验证：创建/加入、并发操作、房主退出转移、普通退出、结算、解散、断网重试和重复点击。
- 交付时说明需部署哪些云函数、是否需要索引/权限，以及不部署会有什么表现。

## 不要误改

- 不要随意更换 AppID、云环境 ID 或二维码版本。
- 不要把云端 `active/settled` 与前端 `playing/ended` 混写。
- 不要限制负分，除非产品重新确认。
- 不要把领奖池改成仅房主可用，除非产品重新确认。
- 不要让客户端决定可信身份、昵称、头像或最终积分。
- 不要因临时头像失效而删除 `avatarFileID`。
- 不要把战绩页当成空页面；它已是正式功能。
