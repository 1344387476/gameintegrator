# 自建后端：用户、房间、账本与战绩

当前已有配置校验、PostgreSQL迁移、微信登录与会话、本人资料修改、头像上传与鉴权读取、创建/加入/退出房间、房主转移、房间快照、转分/批量转分、下注/底注/All-in/领奖池、持久化幂等、计分流水分页、房主结算/解散、战绩列表/详情/头像权限、按需生成微信小程序码、同端口WebSocket实时同步、注销、限流与健康检查。小程序代码已替换为自建REST/WSS适配层，但生产HTTPS地址尚未配置，真实微信登录、小程序码、新扫码入口及多账号弱网仍未联调。

后端独立使用 Node.js 24、CommonJS、Fastify 和 `pg`，不加载 `wx-server-sdk`，也不读取根目录旧 `.env.local`。后续阶段见 [迁移计划](../docs/self-hosted-migration.md)。

## 无真实密钥即可运行测试

在仓库根目录运行：

```powershell
npm --prefix server ci --ignore-scripts
npm --prefix server test
```

测试使用 PGlite 的内存 PostgreSQL 引擎执行真实 SQL，并用假微信响应替代外部登录调用。不连接生产、不导入旧数据、不创建磁盘数据库。头像HTTP测试使用内存存储；本地存储测试在系统临时目录创建一个文件并按明确路径单文件删除，保留空测试目录，不递归或批量清理。

PGlite 是单连接串行引擎；这些本地测试不证明独立 PostgreSQL 17 的连接池、网络、角色权限或多人并发已经通过，也不替代真实微信登录。服务器隔离测试的实际进展见下文。

2026-08-31最终代码审查回归：新后端70项、根小程序/旧云端兼容70项全部通过，`server/src`、`server/test-support`、`miniprogram` 和 `tests` 共56个JavaScript文件通过 `node --check`，`git diff --check` 通过。覆盖身份与越权、迁移升级、资料/头像、房间生命周期、计分与奖池、持久化幂等、故障回滚、结算/解散、战绩、二维码、WSS和客户端原请求重试。

这些结果仍不等于真实环境验收：PGlite中的并发提交由单连接适配器排队，真实PostgreSQL 17多连接脚本尚未运行；微信登录和二维码使用测试替身，Ubuntu完整镜像、真机、合法域名、多账号弱网和备份恢复也尚未验证。

## Ubuntu服务器隔离测试

新增 `compose.smoke.yaml` 和 [分步操作说明](deploy/smoke/README.md)，与本机开发数据库配置分开。
按用户服务器实际1.6 GiB内存设置资源上限：数据库512 MiB、API256 MiB；数据库不发布端口，API只绑定宿主机127.0.0.1，运行账号与建表账号分离。
2026-08-28用户已完成上传包逐文件校验、项目镜像构建，并回传`/health/ready`成功及API/数据库均为healthy的输出。真实PostgreSQL连接与当前迁移读取通过；`dc ps`显示API仅映射127.0.0.1:3000、数据库没有宿主机端口映射。
随后已通过SSH只读复核运行账号身份及受限权限、未登录接口401、容器内存上限和使用量；具体证据见部署说明。公网隔离测试有链路不确定性，仍待独立复核；宿主机已有80端口Nginx，本次未改动。
这是基础后端的隔离测试部署，不是生产发布。真实微信登录、业务并发、重启及备份恢复仍待验收；健康检查不兑换微信code、不执行真实登录写入。

## 本机启动：需要独立开发数据库和小程序密钥

1. 安装 Node.js 24。准备独立的 PostgreSQL 17 开发数据库；不要指向生产或共享数据库。
2. 复制 `server/.env.example` 为 `server/.env`，填写开发数据库配置和小程序密钥。示例占位值会被拒绝。不要把密钥发送到聊天或提交到 Git。
3. 如果本机已有 Docker，可在 **server 目录**运行以下命令创建开发数据库（不要重复创建已有数据库）：

```powershell
docker compose -f compose.dev.yaml up -d database
```

这是开发专用配置：仅绑定本机 `127.0.0.1`，初始化用户拥有较高数据库权限，不适合生产。生产部署阶段必须区分建表账号与仅具有必要读写权限的运行账号。`PGPORT` 要与 `.env` 中应用连接端口一致。

然后仍在 **server 目录**运行：

```powershell
npm run db:migrate
npm start
```

- `db:migrate` 只需要 `PG*` 配置；启动 API 还需要 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。
- 默认只监听 `127.0.0.1:3000`。此地址供本地测试，不是小程序正式服务器地址。
- 重复运行迁移不会重复建表；已经应用的 SQL 不得修改，后续变更增加下一个编号文件。失败事务回滚，启动时会核对版本与校验和。
- `npm start` 不自动改表，避免应用重启时意外修改数据库。
- `compose.dev.yaml` 的数据保存在命名卷中；修改 `.env` 不会自动修改已有数据库密码。需要调整时先明确目标，不用删卷解决问题。
- `Dockerfile` 提供应用镜像定义，可通过 `NODE_IMAGE` 构建参数指定已验证的官方镜像来源。服务器隔离测试已有独立配置及受限运行账号；正式 Nginx/TLS、生产发布、备份、告警及切换方案仍待完成，没有公网服务可直接上线。

## 当前接口合约

| 方法与路径 | 输入 / 权限 | 结果 |
| --- | --- | --- |
| GET `/health/live` | 无登录 | 进程存活 |
| GET `/health/ready` | 无登录 | 数据库与迁移版本就绪；异常为503 |
| POST `/api/v1/auth/wechat` | JSON对象，仅允许 `code` | 登录凭证、到期时间、是否新用户及用户资料 |
| GET `/api/v1/users/me` | `Authorization: Bearer <token>` | 当前用户资料，不接受客户端openid或目标用户ID |
| PATCH `/api/v1/users/me` | 同上；JSON仅含 `nickname`，1～10个Unicode字符 | 更新后的本人资料；不会修改头像 |
| POST `/api/v1/users/me/avatar` | 同上；`multipart/form-data`，仅一个 `avatar` 文件字段 | 上传并立即替换本人头像，返回更新后的本人资料 |
| GET `/api/v1/avatars/:fileId` | 同上；本人头像、当前活动房间快照/流水头像，或本人参与战绩的快照头像 | JPEG二进制；无权或文件丢失均404 |
| POST `/api/v1/rooms` | 同上；`operationId, roomName, mode` | 创建房间及加入本人，返回操作回执 |
| POST `/api/v1/rooms/join` | 同上；`operationId, roomCode` | 手工输入6位房号加入，返回回执 |
| POST `/api/v1/rooms/:roomId/join` | 同上；`operationId` | 按永久UUID邀请加入，返回回执 |
| POST `/api/v1/rooms/:roomId/leave` | 同上；`operationId` | 本人退出，必要时自动转交或删除空房间 |
| POST `/api/v1/rooms/:roomId/owner` | 同上；`operationId, toUserId`；仅房主 | 主动转交给未退出成员 |
| GET `/api/v1/rooms/:roomId` | 同上；仅当前在房成员 | 同一版本的房间和玩家完整快照 |
| GET `/api/v1/users/me/room` | 同上 | `{ room: 房间快照或null }`，用于首页返回房间 |
| POST `/api/v1/rooms/:roomId/score` | 同上；`operationId, action, payload`；仅当前在房成员 | 原子计分/设置底注，返回最小回执 |
| GET `/api/v1/rooms/:roomId/ledger` | 同上；仅当前在房成员；`limit, beforeVersion` 可选 | 按版本倒序分页的计分流水 |
| POST `/api/v1/rooms/:roomId/settle` | 同上；仅当前房主；`operationId` | 结算并保存战绩，回执带historyId |
| POST `/api/v1/rooms/:roomId/dismiss` | 同上；仅当前房主；`operationId` | 放弃本局，删除房间及流水，不生成战绩 |
| GET `/api/v1/history` | 同上；`limit, cursor` 可选 | 仅本人参与的战绩，含退出过的玩家 |
| GET `/api/v1/history/:historyId` | 同上；仅该战绩参与者 | 最终战绩详情 |
| GET `/api/v1/rooms/:roomId/result` | 同上；仅该局参与者 | 按原房间UUID读取结算结果，未结算/不存在/无权均404 |
| POST `/api/v1/rooms/:roomId/qrcode` | 同上；当前未退出成员；JSON `{}` | 按需生成或复用，返回PNG二进制 |
| GET `/api/v1/rooms/:roomId/qrcode` | 同上；当前未退出成员 | 读取已生成PNG，不调用微信；未生成404 |
| POST `/api/v1/rooms/join-scene` | 同上；`operationId, scene` | 解析新版小程序码参数并加入原UUID房间 |
| POST `/api/v1/auth/logout` | 同上，不需要请求体 | 注销当前会话；其他设备有效会话保留 |

成功响应：

```json
{
  "success": true,
  "data": { "id": "用户UUID", "nickname": "玩家123", "avatarFileId": null, "currentRoomId": null },
  "requestId": "服务器生成的请求ID"
}
```

登录的 `data` 为 `{ token, expiresAt, isNewUser, user }`。`expiresAt` 使用UTC ISO日期；用户标识为服务器UUID，不返回微信openid、AppSecret或session_key。`avatarFileId` 未设置时为null，上传后为永久资源UUID，不是路径、临时URL或公开地址。`currentRoomId` 来自独立活动成员关联表，为房间UUID或null，不重复保存到users；进入房间前应通过房间接口复核。

失败响应：`{ success: false, error: { code, message }, requestId }`。

| HTTP | code举例 | 客户端后续处理 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | 修正参数，不自动重试 |
| 400 / 404 / 415 | `INVALID_AVATAR` / `AVATAR_NOT_FOUND` / `UNSUPPORTED_AVATAR` | 更换图片，或使用默认头像；404不能自动清空已保存资源ID |
| 401 | `AUTH_REQUIRED` / `WECHAT_CODE_INVALID` | 重新获取微信code并登录；不要循环复用一次性code |
| 413 / 415 | `REQUEST_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | 修正请求大小或JSON类型 |
| 429 | `RATE_LIMITED` / `WECHAT_RATE_LIMITED` | 延后重试，尊重限流提示 |
| 500 / 502 / 503 | `INTERNAL_ERROR` / `WECHAT_UNAVAILABLE` / `NOT_READY` | 提示暂不可用；后续请求重试必须有上限 |
| 503 | `UPLOAD_BUSY` | 正有其他头像正在处理，稍后有限重试 |
| 403 / 404 | `ROOM_MEMBER_REQUIRED` / `ROOM_OWNER_REQUIRED` / `ROOM_NOT_FOUND` | 检查成员和房主身份，或提示邀请已失效 |
| 409 | `ALREADY_IN_ROOM` / `ROOM_FULL` / `ROOM_ENDED` / `OPERATION_CONFLICT` | 按提示处理，不自动换操作编号绕过冲突 |
| 400 / 409 | `INVALID_AMOUNT` / `SELF_TRANSFER` / `INVALID_RECIPIENT` / `WRONG_ROOM_MODE` | 修正金额、接收者或操作模式 |
| 409 | `BASE_BET_NOT_SET` / `ALLIN_NOT_AVAILABLE` / `EMPTY_POT` | 刷新当前快照，按实际底注/积分/奖池状态操作 |
| 409 | `SCORE_OVERFLOW` / `LEDGER_INVALID` / `LEDGER_UNBALANCED` / `ROOM_VERSION_EXHAUSTED` | 操作未写入；金额越界需调整，异常账本需维护者核查，不能自动修账 |
| 503 | `ROOM_BUSY` / `ROOM_CODE_UNAVAILABLE` | 有限重试原请求并保持原operationId |
| 409 | `POT_NOT_EMPTY` | 奖池清空后再结算；不自动转成解散 |
| 404 | `HISTORY_NOT_FOUND` / `QRCODE_NOT_READY` | 无权/无战绩，或需先生成二维码 |
| 502 / 503 | `QRCODE_UNAVAILABLE` / `QRCODE_BUSY` | 生成失败或忙，稍后有限重试；不影响计分 |

## 房间生命周期接入

生命周期包括创建、加入、退出、房主转移、结算及解散；计分入口见下节。积分初始为0，数据库允许负安全整数，退出/重进和资料修改均不重置积分。

- 每局最多8位不同参与者，退出者仍占原席位；满员房间允许原玩家返回，不允许第9位新玩家加入。这是沿用当前玩法和界面的首版限制，后续调整需同时修改数据库约束、接口、测试及UI，不能只放开服务端数字。
- 创建只接收1～20字符的房间名及 `normal/bet` 模式；玩家身份来自会话，昵称/头像来自事务内最新用户资料。客户端不得传owner、nickname、avatar或初始积分。
- 同一用户只有一条活动成员关联，创建或加入其他房间返回409。在同一房间重复加入不重复加人、不额外增加版本；退出只清除本房间关联，并将原成员标为退出。重新加入恢复原席位/积分并读取最新个人资料。
- 房主退出时按席位顺序转给第一位未退出玩家；原房主回来不会抢回房主。房主可主动转交给在房成员，非房主、房外用户和已退出目标不能操作。转交给自己是无变化操作。
- 最后一人退出，在同一事务中删除该房间、成员、活动关联、计分流水和二维码缓存，不生成战绩，不删除用户或个人头像。房间号可复用，但UUID不复用。**分享/扫码必须绑定UUID，不能在UUID失效后回退房号加入**；6位房号接口仅用于用户主动手工输入，旧房号本身不能证明是同一局。新版小程序码scene可无损还原UUID，前端代码已接入，真机扫码待验收。
- 房间读接口只给未退出的当前成员完整快照。快照含 `id, roomCode, roomName, mode, status, ownerId, stateVersion, maxPlayers, pot, baseBetValue, createdAt, updatedAt, players`；玩家含 `userId, nickname, avatarFileId, score, isExited, seat, lastDepositAmount, lastDepositAt`，不含openid或会话凭证。未设底注及未下注记录为null，奖池初始0。云端状态仍是 `active/settled`，不改用小程序展示状态 `playing/ended`。

### 写操作与重试

所有房间写接口都必须传 `operationId`：8～80位字母、数字、下划线或连字符，推荐每次新操作生成UUID。网络重试保留相同编号与参数；新的用户动作才换编号。

成功的 `data` 示例：

```json
{
  "roomId": "永久房间UUID",
  "roomCode": "A1B2C3",
  "stateVersion": 2,
  "deleted": false,
  "duplicated": false
}
```

回执表示该次操作已经提交，**不是当前房间快照**。重复请求返回原回执和 `duplicated: true`，即使用户已经退出、房主已再次转交或房间已删除，也不会重做旧动作。相同调用者/编号用于不同动作或参数返回409。客户端收到回执后重新读当前房间/快照，不把旧回执的版本或deleted当成最新状态，也不要在403/404后自动重进。

`room_commands` 与房间变化同事务保存，只保留调用者、动作、编号、参数摘要和最小回执，不存昵称、头像或积分快照。它不随房间删除，否则旧创建/加入请求可以复活业务。当前没有自动清理；上线前需明确回执保留期、过期请求拒绝协议和容量告警，再安排清理，不能简单删记录后仍允许旧请求再次执行。失败并已回滚的请求不留成功回执。

### 一致性与部署要求

- 新增迁移 `002_rooms.sql`：`rooms`、`room_members`、`active_room_memberships`、`room_commands`，以及AppID隔离、唯一房号/席位/活动关联、房主成员外键和安全整数约束。已有 `001_identity.sql` 保持不变。
- 已有房间写操作按“房间行 → 调用者用户行”的顺序加锁；创建只锁本人后插入全新房间。修改资料先获取同样的锁并二次检查当前房间，变动则重读，防止同步到已经退出的房间。房间快照在共享房间锁内读取，避免玩家和版本属于不同次更新。明确回滚的死锁/序列化失败/锁超时最多尝试3次；网络或COMMIT结果未知不自动重放。
- 昵称/头像与当前房间玩家快照同事务更新并递增stateVersion；相同资料不增加版本。头像文件删除仍在事务提交后单文件尽力执行。已退出玩家的旧快照不随房外资料变化而更新，历史头像被替换后允许显示默认头像。事务提交后通过WSS发布最新可信快照；发布失败时客户端用REST校正。
- 未来授权更新服务器时，先由建表账号运行全部迁移，再执行当前 `deploy/smoke/grant-app.sql`，然后构建/重建API并验证。运行账号需要房间及成员表读写权限；回执表仅SELECT/INSERT，不授予UPDATE/DELETE。ready会检查完整表访问；不迁移或不授权不能启动为就绪状态。当前尚未部署或切换，无需更新旧云函数。
- 本地测试覆盖SQL与接口，不证明真实PostgreSQL 17多连接竞争通过。仍需隔离环境验证并发抢席、同人跨房间加入、退出/转交/资料更新交错、连接断开、重启和备份恢复。记录表和头像卷也应纳入后续备份方案。

锁行为参考：[PostgreSQL 17行锁说明](https://www.postgresql.org/docs/17/explicit-locking.html)。

## 计分与流水接入

`POST /api/v1/rooms/:roomId/score` 只接受以下三个字段，不接受客户端身份、昵称、头像或计算后的积分：

```json
{
  "operationId": "一次新动作生成的UUID",
  "action": "TRANSFER",
  "payload": { "toUserId": "接收者用户UUID", "amount": 10 }
}
```

| action | 模式 / 权限 | payload |
| --- | --- | --- |
| `TRANSFER` | normal；不能转给自己、退出者或房外用户 | `{ "toUserId": "用户UUID", "amount": 10 }` |
| `BATCH_TRANSFER` | normal；1～7个不同在房接收者，不含本人 | `{ "transferList": [{ "toUserId": "用户UUID", "amount": 10 }] }` |
| `BET` | bet；允许下注后为负分；跟注也使用此动作 | `{ "amount": 10 }` |
| `SET_BASE_BET` | bet；仅房主；只设置，不扣分 | `{ "amount": 10 }` |
| `BASE_BET` | bet；金额取事务内最新底注，未设置时拒绝 | `{}` |
| `ALLIN` | bet；投入本人当前全部正积分并归零，零分/负分拒绝 | `{}` |
| `CLAIM` | bet；任何未退出成员均可领取全部奖池，空池拒绝 | `{}` |

金额必须是JSON数字、正安全整数，最大 `9007199254740991`；字符串、小数、0和负金额均拒绝。批量总额也受此上限约束。内部使用BigInt精确计算，然后检查每位积分及奖池范围；**允许玩家负分，不做余额不足限制**。账本写入前后均验证“所有参与者积分（含退出者）＋奖池＝0”；异常时整笔拒绝，不偷偷调平。普通模式奖池始终为0。

成功返回 `data: { roomId, stateVersion, ledgerEntryId, duplicated }`，不返回积分快照。`SET_BASE_BET` 同样保存审计记录；每次成功的新计分/设置动作只递增一次版本。客户端收到成功后重新读取最新房间快照；回执内版本可能已经过时。

### 原子提交和幂等

在同一个数据库连接、同一个短事务内，按房间行→调用者用户行→成员行加锁，再读取最新账本和权限。积分、奖池、最近下注记录、房间版本/时间、流水主记录/成员变更、最小幂等回执一起提交；任一步失败全部回滚。退出、房主转交和资料更新也遵循同一房间锁；同房间修改按顺序执行，不同房间可分别处理。事务中不请求微信、读取头像文件或发送推送。

计分和房间生命周期共用“调用者＋operationId”编号空间，并绑定动作、房间UUID和参数摘要；批量列表先按接收者排序，因此仅调整列表顺序仍视为同一请求。超过50次操作或重建服务实例后仍能去重。网络断开/COMMIT响应丢失时，客户端有限重试**原编号和原参数**；若首次已提交，返回原最小回执及 `duplicated: true`。即使底注/奖池/成员后来变化或房间已删除，也不重复执行。失败且回滚的请求不占用成功编号。明确的死锁、序列化失败、锁超时最多尝试3次，每次重读；结果未知的网络错误不由服务端盲目重放。

### 流水分页、权限和保留

`GET /api/v1/rooms/:roomId/ledger?limit=20` 返回 `{ items, nextBeforeVersion }`。下一页带原样字符串 `beforeVersion=nextBeforeVersion`；默认20条、最多50条，按stateVersion倒序且不含游标对应项。版本可因资料或生命周期变化而跳号，不是流水连续编号。新流水插入不会把旧页向后挤出；看最新数据需重新取第一页。

每条包含 `id, roomId, operationId, action, stateVersion, amount, potBefore, potAfter, baseBetBefore, baseBetAfter, actor, changes, createdAt`。actor保存当时用户UUID/昵称/头像引用；changes保存受影响成员的当时资料和 `scoreBefore/scoreAfter`。资料来自事务内数据库；不是客户端消息文本。底注设置没有积分变更，changes为空。

独立表 `score_ledger/score_ledger_changes` 不再只保留最近100条。仅当前活动房间的未退出成员可读；退出/房外/跨App及已结束房间的此接口均拒绝。流水引用头像也按当前成员权限读取，已被替换清理的文件显示默认头像。沿用放弃本局的规则：**最后一人退出或房主解散会删除房间及其全部流水，即使存在积分或奖池；不产生战绩**。最小幂等回执继续保留，不能作为战绩。结算后的流水当前保留在库内用于核查，不通过活动流水接口开放；留存期限和清理方案需正式部署前确认，详见下节。

### 迁移与真实并发验收

计分使用 `003_score_ledger.sql`，保留001/002原文件，升级已有房间时不改积分、席位或回执；新增奖池为0、底注及下注记录为null。完整部署必须继续执行下节004迁移。应用对流水表仅有SELECT/INSERT，不能直接UPDATE/DELETE；删除整房间时数据库按既有外键级联清理。ready检查新表、列和可读权限。当前完整版本仍未部署；不需上传旧云函数，小程序代码已接新接口但尚未配置生产域名或发布。

另提供 `npm --prefix server run test:postgres`，缺少显式配置时报告跳过，不能算通过。它不读取普通PG变量、服务.env或服务器凭证，只允许独立的本机PostgreSQL17测试库，数据库名必须以 `_ledger_test` 结尾。由维护者在本机安全设置专用密码，不发到聊天；专用测试账号需能在该库创建schema和表。PowerShell设置非秘密参数示例：

```powershell
$env:LEDGER_TEST_CONFIRM = 'isolated-local-database'
$env:LEDGER_TEST_DATABASE = 'gameintegrator_ledger_test'
$env:LEDGER_TEST_USER = 'ledger_tester'
$env:LEDGER_TEST_HOST = '127.0.0.1'
$env:LEDGER_TEST_PORT = '5432'
# LEDGER_TEST_PASSWORD 在本机安全注入；不要使用生产或共享库凭证。
npm --prefix server run test:postgres
```

每次新建随机schema并保留，不覆盖现有schema、不自动DROP或清空；如需清理，由维护者核对后手动处理。测试确认至少两个不同数据库连接，使用6连接池运行对转、相同请求竞争、退出/资料交错、抢奖池及All-in，逐条重放流水校对最终状态。它不是容量压测或真实微信多账号验收。当前尚未执行真实多连接场景；PGlite会执行同一场景，但排队执行不证明行锁竞争。

## 结算、战绩与二维码接入

### 结算和解散

两者都只接受 `{ "operationId": "新动作UUID" }`，复用原请求编号重试，不能由客户端提交最终积分或玩家名单。服务端锁定最新房间，复核当前成员及房主身份，和计分/退出/转交/资料操作使用相同锁顺序。

- 结算要求奖池为0，并校验包含退出者的积分守恒。在同一事务内生成唯一战绩及成员最终快照、递增版本、标记房间settled、清除**本房间**活动关联和二维码缓存、写入幂等回执。退出后已加入其他房间的玩家不受影响。任一步失败整体回滚。
- 结算回执为 `{ roomId, roomCode, stateVersion, deleted: false, historyId, duplicated }`；同编号重试返回原historyId，不重复写战绩。已结算后换编号再结算返回ROOM_ENDED。不能用旧回执当最新状态。
- 解散沿用放弃本局规则：允许有积分或奖池，删除房间、成员、流水和二维码，不生成战绩，返回deleted:true。客户端应明确提示“不会保存战绩”，不能把结算失败自动改成解散。
- 已结束房间不能再加入或记分；其他参与者发现房间读取404后，可调用 `/api/v1/rooms/:roomId/result` 获取战绩。解散/不存在/非参与者均404；前端不能据此自动重进。当前WSS会区分结算与删除，断线或漏通知时客户端仍以该REST结果校正。

### 战绩快照、分页与留存

列表 `GET /api/v1/history?limit=20` 返回 `{ items, nextCursor }`，默认20条、最多50条；后续携带原样cursor。按结束时间和UUID倒序分页，同毫秒多条记录不会漏项；新记录插入不影响继续读旧页。只有本人参与的战绩可见，包含本局中途退出者；后来的其他房间成员无权读取。

每条及详情包含 `id, roomId, roomName, mode, ownerId, settledBy, stateVersion, endedAt, players`。players含 `userId, nickname, avatarFileId, score, isExited, seat`，是结算时的房间快照，不随之后的资料修改变化；不含openid、临时URL或会话凭证。当前两种玩法都以最终积分展示；现有前端负责排名、线下结算建议和海报，接口本身不执行支付。

战绩参与者可以读取该战绩玩家快照引用的头像，不能因此读取对方后来换的新头像。旧头像已按原规则清理时返回404，客户端显示默认头像，不能自动删除战绩中的资源ID。

当前开发版本保留结算房间、不可修改的战绩和审计流水，不自动删历史、不搬迁旧云数据。战绩外键阻止误删关联房间；应用对战绩表仅SELECT/INSERT。正式部署前必须确认留存期限、用户删除规则、数据库/头像一致备份和容量告警。**保留代码分支和持久化数据库不等于完成备份，不承诺永久保存。**

### 微信小程序码

POST `/api/v1/rooms/:roomId/qrcode`，JSON `{}`，成功返回image/png；首次调用微信，已有缓存则直接读取。GET同路径只读缓存，可用带Authorization的 `wx.downloadFile` 下载；首次POST需由客户端按二进制响应处理。不可将Bearer放入URL或公开图片目录。

仅当前活动房间未退出成员能生成/读取。缓存按房间UUID存入 `room_qrcodes.image`，每房间最多一张标准化PNG、最大256KiB，随数据库持久化；结算事务删除缓存，解散/最后退出由外键级联删除。无需新增文件卷或扫描清理任务。二维码是派生资源，生成不改变积分或stateVersion，也不占用operationId；微信失败只影响邀请图片。

微信请求和图像解码都在数据库事务外，单进程最多生成一张，同房间同时请求共享生成结果，其他房间暂返QRCODE_BUSY；生成后再在锁内验证房间及成员，避免结算/退出期间写回无效图片。跨进程可能各生成一次，但数据库只保存一份。POST每IP每分钟10次，GET每分钟60次；这些不是微信平台配额承诺。

使用固定微信 `stable_token` / `getwxacodeunlimit` 接口，access_token仅内存缓存至过期前，force_refresh=false；仅遇明确token失效最多重新取token并重试一次。禁止重定向，设置超时/响应大小上限，微信错误正文、token、AppSecret不写日志。只接受有限大小的PNG/JPEG再重编码为PNG。固定 `page: pages/home/home`、`env_version: release`、`check_path: true`，不关闭页面校验来绕过发布问题。

新版scene为 `r` 加UUID二进制的base64url，共23字符，不携带复用房号。客户端把原始scene传给 `POST /api/v1/rooms/join-scene`，JSON `{ operationId, scene }`；服务端严格校验并还原原UUID。**前端代码现已识别新版scene，但真实凭证、微信后台调用权限/IP白名单要求、已发布页面及扫码效果仍需联调；完成部署和真机验收前不应分发新码给用户。**

微信接口文档入口：[获取小程序码](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/qrcode-link/qr-code/getUnlimitedQRCode.html)、[稳定版access_token](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-access-token/getStableAccessToken.html)。当前实现已用替身验证请求合约和错误处理；实际平台响应、权限和限制仍待真实环境核对，尚未调用真实微信二维码接口。

### 当前版本部署要求

`004_history_qrcode.sql` 不修改001～003；它新增histories、history_players、room_qrcodes和操作白名单。必须由管理账号先迁移到004，再执行当前 `deploy/smoke/grant-app.sql`，然后更新API镜像。ready验证新增表；只复制JS或重启旧镜像不足以更新。二维码使用数据库卷，头像使用独立头像卷。当前没有部署、上传云函数或修改微信配置。

当前测试覆盖最终快照和越权、分页、非空奖池、不平账、事务故障、重复结算、解散、旧scene、生成期间结算、缓存重建、微信异常及“计分与结算”“重复结算”“结算与解散”竞争场景。PGlite仍会排队执行，真实PostgreSQL多连接及微信真机尚未验收。

## 修改资料与头像接入

- 改昵称示例：`PATCH /api/v1/users/me`，JSON为 `{"nickname":"小明"}`。服务端去掉首尾空白，拒绝空白昵称、控制字符、无效Unicode、超过10个字符，以及身份/头像等额外字段。只更新昵称列，不会用旧资料覆盖并发上传的头像。
- 上传即保存，不存在“上传后再把任意fileId提交给资料接口”的步骤；成功返回 `{ id, nickname, avatarFileId, currentRoomId }`。客户端不要把旧昵称一起带入上传，也不要传openid或文件路径。头像上传前后应禁止重复点击；网络结果未知时先重新查询本人资料，不无限自动上传。
- 上传文件最多2 MiB，只接收真实静态JPEG、PNG、WebP；文件MIME需匹配内容，也允许通用 `application/octet-stream` 后由服务端识别。为控制256 MiB应用容器的解码内存，拒绝SVG、GIF、APNG、多帧WebP、损坏图片和超过4,194,304像素的图片（例如2048×2048）；原始照片过大时客户端需先缩小。重编码成最长边不超过512像素的JPEG，去除EXIF/GPS等元数据，透明背景变白，不放大小图。
- Multipart字段名必须为 `avatar`，不能有第二个文件或额外表单字段。上传每IP每分钟最多10次；单进程同时只接收和处理一个头像，不排队积累图片Buffer。总请求上限为2 MiB + 16 KiB；有Content-Length的超大请求返回413，无长度的超大流直接断开连接。正式反向代理还需设置总请求大小、速率和超时限制。
- 小程序已用 `wx.uploadFile` 的 `name: 'avatar'`、`filePath` 与 Authorization头接入；没有自行拼 multipart boundary。成功后通过 `wx.downloadFile` 携带同一Authorization头读取 `/api/v1/avatars/<avatarFileId>`，再把本地临时路径交给图片组件。Bearer不放进URL，也不把受保护URL当成公开图片地址；真实设备兼容仍待联调。
- 当前允许本人读取当前头像、未退出的活动房间成员读取本房间玩家/计分流水快照头像，以及战绩参与者读取该战绩的快照头像。退出即失去活动房间读取权限，但正式结算后保留战绩参与者权限；不能因此读取对方房外更换的新头像。资料变化会在事务提交后触发WSS房间快照，失败时由REST校正。不能通过公开整个目录绕过权限，旧引用缺失时允许回退默认头像。

### 存储、事务和部署边界

用户资料仍使用 `users.nickname` 和 `users.avatar_file_id`；现在已集成房间快照同步及流水/战绩引用鉴权，因此当前完整版本需要002～004迁移及对应表权限。头像替换遵循房间→用户锁顺序，读取当前旧头像再更新引用；只改头像列，保留并发修改的昵称。

头像目录由 `AVATAR_STORAGE_DIR` 配置，必须是专用绝对路径，默认 `server/data/avatars`。文件名仅由服务端UUID生成，客户端文件名完全忽略；新文件独占创建并刷新到磁盘，不覆盖已有文件。该目录不进入Git或构建上下文，也不能由Nginx静态公开。文件存储通过独立适配层访问，后续可替换对象存储而保留资源ID。

顺序为：校验并重编码 → 保存新文件 → 提交数据库引用 → 单文件尽力删除旧头像。保存或数据库失败不会主动删除原头像；清理失败不回滚新资料。文件系统与数据库不是同一事务：写文件中途失败、进程崩溃、COMMIT结果未知或旧文件删除失败可能留下孤立文件。已知失败记录安全错误码和资源ID，数据库结果未知时保留新文件，避免误删已提交头像。需结合数据库引用和日志人工逐个核对；**没有批量清理任务，不自动遍历删除**。上线前仍需磁盘告警和运维清理流程。

`compose.smoke.yaml` 已为API增加独立 `avatar-data` 命名卷，镜像内挂载点归node用户所有；保持只读根文件系统、原回环端口和数据库隔离。更新需重新构建API镜像并按新配置重建API，单纯restart不会添加卷；已部署旧版本仍不支持新接口。保留已有数据库卷；不要用删卷处理权限问题。头像卷不是备份，正式发布前应连同数据库做一致性备份及恢复验证，且需在Ubuntu容器验证sharp原生依赖、卷权限、重启后读取和实际内存峰值。此前健康检查及空闲内存数据只适用于已部署的基础版本。

## WebSocket实时同步与小程序接入

WSS与REST共用API端口，Upgrade路径固定为 `/api/v1/ws`。客户端必须在握手Header中发送现有 `Authorization: Bearer <token>`；不接受URL查询参数中的token。连接成功后服务端先发：

```json
{ "type": "ready", "protocolVersion": 1, "heartbeatMs": 30000 }
```

客户端再订阅一个当前活动房间：

```json
{ "type": "subscribe", "roomId": "房间永久UUID", "lastStateVersion": 12 }
```

服务端重新检查会话、活动关联和未退出成员身份，随后发送完整 `room.snapshot`。积分、资料、加入/转交等事务提交后只广播“重新取可信快照”；结算发送 `room.settled`，解散发送 `room.deleted`，成员退出发送 `room.access_revoked`。WSS不接收计分命令，也不决定积分。服务端ping清理失活连接，会话到期立即关闭，并至少每分钟复核一次会话是否已注销；单实例默认最多200条连接，可用 `WEBSOCKET_MAX_CONNECTIONS`（1～1000）和 `WEBSOCKET_HEARTBEAT_MS`（10～60秒）调整。这只是保护上限，不代表已通过对应容量压测。

小程序已增加 `miniprogram/utils/backend.js` 作为自建传输适配层，`miniprogram/` 中不再调用 `wx.cloud`。它负责 `wx.login`换会话、Bearer请求、受保护头像/二维码、内部房间UUID与6位展示房号映射、流水转页面记录、WSS单调版本过滤，以及断线后的REST完整校正。写请求网络结果未知时最多重试两次，始终复用原请求体和operationId；头像上传不盲目重放。

正式/体验构建前必须在 `miniprogram/config.js` 配置API的HTTPS根地址；开发者工具可用本地存储键 `backendApiBaseUrl` 临时覆盖为HTTPS或本机回环地址。配置为空会明确报“尚未配置自建服务HTTPS地址”，不会静默回退CloudBase。对应域名还必须在微信公众平台同时加入request、socket、uploadFile、downloadFile合法域名。当前代码未填写生产域名，未部署新API，未做微信真机登录、WSS、头像、二维码或分享扫码联调。

Nginx只需把REST和WSS转发到同一个回环端口；可合并的location示例见 `deploy/nginx-location.example.conf`。宿主机已有Nginx，不能直接覆盖其server配置；合并前先核对现有用途，合并后先运行 `nginx -t`。只有确认应用端口不能绕过Nginx访问且代理会覆盖转发头后，才把 `TRUST_PROXY_HOPS` 从0改为1。

当前实时发布器是单Node进程内存连接表，符合现阶段单API容器方案。后续若运行多个API进程，必须先增加跨进程发布通道（如PostgreSQL LISTEN/NOTIFY或Redis Pub/Sub）并验证去重/版本校正，不能直接多开后假设每个客户端都能收到全部通知。

## 安全与运维约定

- 登录凭证是32字节密码学随机数，仅哈希入库；默认有效期7天，可通过 `SESSION_TTL_SECONDS` 调整为5分钟至30天。没有自动续期；到期后重新登录。重登不踢掉另一设备。
- 微信请求限定固定HTTPS地址、禁止跟随重定向、有超时、没有自动重试；此阶段不需要保存微信 `session_key`。
- 登录默认每IP每分钟10次，其他业务路由每IP每分钟120次，均为单进程内存限流；进程重启会重置。不能把它当成分布式限流或整机抗攻击措施。
- `TRUST_PROXY_HOPS=0` 时忽略转发头；部署阶段确认可信代理会覆盖转发头、应用端口不能被直接访问后，才可改为1。当前未配置生产代理。
- 日志只记录请求ID、方法、路由模板、状态和安全错误码，不记录原始请求URL、查询参数、请求体或登录凭证；响应均标记不缓存。
- 相同 `(app_id, openid)` 只能创建一个用户；创建用户和会话同一事务提交，失败不留孤立用户。
- 新登录会清理该用户已过期的会话；过期会话在查询时立即失效。长期不再登录用户的过期记录，需要部署阶段增加有上限的定期清理任务，不能无限保留。
- `PGSSLMODE=disable` 只用于本机或受控容器网络；跨主机使用 `verify-full`，不支持跳过证书校验的“兼容选项”。
- 生产环境还需受限系统用户、独立数据库角色、受保护的密钥注入、数据库和文件备份及恢复演练。真实密钥不得出现在Docker镜像、仓库或日志中。

参考：[Fastify校验](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)、[pg事务](https://node-postgres.com/features/transactions)、[PGlite测试引擎](https://pglite.dev/docs/)。微信 `code2Session` 的真实凭证、平台配置和错误场景还需在联调阶段验证。

头像实现参考：[Fastify multipart](https://github.com/fastify/fastify-multipart)、[sharp输入限制](https://sharp.pixelplumbing.com/api-constructor/)、[sharp输出与元数据](https://sharp.pixelplumbing.com/api-output/)。
