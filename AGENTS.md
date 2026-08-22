# 项目协作与交接说明

> 本文件记录当前代码的真实状态、已确认的产品规则和接手注意事项。开始修改前先读本文件；若代码与本文不一致，以代码和实际云端数据为准，并同步修正文档。

## 协作规则

- 维护者 d.s 擅长 Java、JavaScript，有 Android 背景，主要熟悉前端。解释云函数、数据库、事务、权限、索引和部署时，用大白话说明为什么、影响和验证方法。
- 禁止批量删除文件或目录。只能一次删除一个明确路径的文件；需要批量删除时停止并请用户手动处理。
- 当前主分支为 `master`，项目使用 CommonJS。

## 项目概览

这是一个微信云开发小程序，用于创建牌局房间、多人实时记分、结算并保存战绩：

- `normal` 普通模式：玩家之间单笔或批量转分。
- `bet` 下注模式：下注/底注/跟注、All-in 和领取奖池。

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
- 新建房间把最近 100 条信息保存在 `rooms.recentMessages`，不再创建独立 `messages` 文档；旧活跃房间会在首次操作时从同 ID 的旧消息文档迁移。二维码在玩家首次打开邀请二维码时按需生成，失败不影响房间本身。
- 房主退出会把房主转交给第一位未退出玩家；最后一人退出删除房间、消息和二维码，不生成战绩。

### 实时同步

- 房间页只 watch `rooms/{roomId}` 一份聚合状态；每位前台玩家占用一条实时连接。
- 云端 `active/settled` 映射为前端 `playing/ended`。
- 云端 `pot` 映射为 `room.prizePool.total`，`baseBetVal` 映射为 `room.baseBetValue`；旧房间仅有 `allInVal` 时兼容作为底注值读取。
- watcher 收到结算或删除后立即锁定操作；非结算发起者先收到提示，再展示结果。
- 修改页面显示/隐藏、卸载、重进逻辑时要防重复监听和陈旧回调，运行 `room-lifecycle.test.js` 并双账号验证。

### 结算、解散、战绩

- 只有房主能结算或解散。
- `settle` 在事务中新增 `history` v2、将房间标为 `settled`、清空全部玩家的 `currentRoomId` 和二维码引用，并删除仅供活跃房间展示的 `messages` 文档。房间数据保留，二维码云文件在事务提交后尽力删除。
- 下注模式必须先清空奖池才能结算。
- `dismiss` 仅用于进行中房间：在主事务中物理删除房间和消息且不生成战绩；二维码在事务提交后尽力清理。
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
- `updateBaseBetValue`：仅下注模式房主可设置正安全整数底注值。
- `generateQRCode`：复用或生成上传二维码。
- `getAvatarUrls`：只为当前房间成员换取房间/消息中允许的 fileID 临时 URL。
- `listHistory`：仅调用者参与的 v2 战绩，默认每页 20、最大 50。
- `getHistoryDetail`：仅参与者可读。

### `gameLogic`

- `TRANSFER`：普通模式单笔转分。
- `BATCH_TRANSFER`：普通模式批量转分，最多 7 个不同接收者。
- `BET`：下注模式投入奖池；“跟注”本质也是此 action。
- `BASE_BET`：按房间 `baseBetVal` 固定转入奖池，不信任客户端金额；兼容旧房间的 `allInVal`。
- `ALLIN`：将调用者在事务内读取到的全部正积分转入奖池并归零；零分或负分不可使用。
- `CLAIM`：领取整个奖池并将 `pot` 归零。

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
- `pot`：非负安全整数；`baseBetVal`：可能尚未设置；旧房间可能仅有兼容字段 `allInVal`
- `players`：玩家账本数组
- `qrCode`：永久云文件 ID
- `recentMessages`：最近 100 条活跃房间信息，与积分状态由同一房间快照推送
- `stateVersion`：每次房间业务变化递增的安全整数，用于重连和未来 Socket 校正
- `qrCleanupPending`：仅在结算后二维码云文件删除失败时记录待巡检清理的 fileID
- `createTime`、`lastActiveTime`
- `recentOperationIds`：最近 50 个计分操作 ID

玩家至少含 `openid`、`nickname`、`avatar`、`avatarFileID`、`score`、`isExited`；下注后可能有 `lastDepositAmount`、`lastDepositTime`。`score` 可为负但必须是安全整数。

### `messages/{roomId}`（旧数据兼容）

- 新房间不再创建该文档。旧房间仍可能存在同 ID 文档，首次计分、加入、退出或改资料时迁移到 `rooms.recentMessages`；前端只在旧房间尚未迁移时读取一次，不建立监听。
- 消息保存发送/接收者 openid、昵称、头像 fileID、内容、类型、时间；计分消息还可能含 `operationId`、`amount`、`potAfter`。
- 类型包括 `create`、`join`、`leave`、`system`、`transfer`、`bet`、`allin`、`claim`、`pass`。结算时直接删除消息文档，不再新增 `settle` 流水。

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
7. 底注金额必须来自 `room.baseBetVal`（旧房间兼容 `allInVal`）；All-in 必须在事务内读取调用者当前全部正积分，零分或负分不可使用。
8. 禁止给自己转分；批量拒绝空列表、重复/非成员接收者和超过 7 人。
9. 流水昵称和头像必须从房间玩家生成，不信任前端展示字段。
10. 积分、奖池、活跃时间、幂等 ID 和计分流水在同一短事务中写入。
11. 非业务型事务错误随机退避重试最多 3 次，每次重读最新账本。
12. 前端每次操作生成唯一 `operationId`；服务端保存最近 50 个，重复请求成功返回 `duplicated: true`，防止重试重复记分。

前端校验只改善体验，不能替代云端校验。新增 action 要同步处理：前端入口、防重复提交、云端白名单、模式/成员/状态/参数校验、事务、消息、动效和测试。

## 头像和分享资源

- 长期只依赖 `avatarFileID`。HTTP 临时 URL 会过期，不能写入历史快照或当作可靠头像源。
- 页面用 `roomFunctions/getAvatarUrls` 批量换临时 URL，默认头像 `/images/avatar.png`。
- 未上传新头像时必须保留已有 `avatarFileID`。用户明确换成新的 `avatars/...` fileID 后，先在事务/资料写入中同时更新 `users` 与活动房间玩家快照，提交成功后再单文件删除旧头像；删除失败只记录日志，不能回滚已保存的新资料。
- 旧战绩和旧流水保存的是当时头像 fileID。旧头像被替换清理后，这些历史位置允许回退默认头像，不为保留历史头像而无限保存旧云文件。
- 计分事务中不得换临时 URL，避免拉长事务和引入外部失败。
- 二维码在首次打开邀请二维码时生成到 `room-qrcodes/{roomId}.png`；结算、最后一人退出或解散时尽力删除。
- `onShareAppMessage` 必须同步返回，房间页因此提前准备分享图；调整时注意异步时机。

## 一致性边界和已知风险

- `gameLogic` 的账本和计分流水处于同一事务，原子性较强。
- 活跃房间的消息追加与对应业务更新处于同一事务，并统一裁剪为最近 100 条；结算、解散和最后一人退出也在主事务中删除消息文档。二维码云文件仍只能在事务提交后尽力清理。
- 房间和玩家账本是数组整包更新。8 人上限减轻体积问题，但生命周期并发仍可能覆盖。
- `roomFunctions` 部分旧代码安全性弱于 `gameLogic`。修改入口时要重新检查事务内二次鉴权、成员、状态、参数和并发，不能只靠事务外预检查。
- 数据库安全规则和已部署云函数版本不在仓库内。出现本地正确、线上不对时，先核对云环境、部署版本、集合权限和索引。
- 结算后只保留 `rooms` 和 `history`，不保留仅用于活跃房间展示的信息流水；仍需评估已结算房间本身的存储增长和隐私保留期。

## 实时同步演进路线

当前产品尚未盈利，实时通信按成本逐级演进，不能为了规避连接限制削弱 `gameLogic` 的权威事务账本：

1. 当前阶段只使用微信云开发。每个前台房间页面只监听 `rooms/{roomId}` 一份聚合状态，玩家、积分、奖池、房间状态和最近 100 条信息统一由该文档快照驱动；`onHide` 关闭监听，`onShow` 先读取最新快照再重建监听。监听失败时使用有上限的自适应低频轮询，并明确显示同步状态，不能固定高频轮询。
2. 同时在线经常超过免费/个人版 10 条实时连接后，接入 GoEasy。CloudBase 继续负责身份、事务、持久化和历史，GoEasy 只广播事务提交后的房间状态；客户端进入、重连或发现 `stateVersion` 跳跃时必须从 CloudBase 获取完整快照。
3. 小程序产生稳定收益后再自建 Socket。推荐先用单台 2 核 2GB Linux + Node.js `ws`，通过短期签名 Token 鉴权、房间频道、心跳、指数退避重连和 HTTPS 内部广播接口工作。Socket 永远不能直接决定积分，故障时回退到 CloudBase 快照/轮询；规模增长后再升级为多实例、负载均衡和 Redis Pub/Sub。
4. 所有实时方案都使用单调递增的 `stateVersion`。客户端只接受更新版本；版本跳跃、重连、回到前台时进行完整校正。第三方或自建推送失败只能造成短暂显示延迟，不能造成账本丢失或重复计分。

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
- 不要因临时 URL 失效而删除当前 `avatarFileID`；只有用户成功换用另一个受管 `avatars/...` fileID 后才能清理被替换的旧文件。
- 不要把战绩页当成空页面；它已是正式功能。
