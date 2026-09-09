# 项目技术与服务器部署手册

这份文档写给“熟悉前端和 JavaScript，但后端经验较少”的维护者。目标不是背命令，而是先理解一次操作从小程序到数据库经历了什么、每层为什么存在，以及服务器出现问题时应该从哪里查。

文档基于 2026-09-10 仓库现状。接口的精确字段以 [`server/README.md`](../server/README.md) 和代码为准；迁移进度与尚未完成的验收以 [`self-hosted-migration.md`](self-hosted-migration.md) 为准。

## 1. 先建立整体认识

用户点击一次“转分”后，实际链路是：

```text
room.js 生成 operationId
    │
    ▼
backend.js 携带 Bearer Token 发 HTTPS 请求
    │
    ▼
Nginx 接收 api.dsbyte.xyz 的 HTTPS，请求转发到 127.0.0.1:3000
    │
    ▼
Fastify 校验参数和登录状态
    │
    ▼
score-store.js 开启 PostgreSQL 事务、加锁、校验、记账、写流水和幂等回执
    │
    ├─ 成功：提交事务，然后通知 WSS 客户端重新获取可信快照
    └─ 失败：回滚事务，积分、奖池和流水都不应只写一半
```

这里最重要的观念是：

- 小程序负责展示和发出意图，不负责决定最终积分。
- Fastify 是 HTTP 服务框架，负责路由、参数校验、限流和统一错误响应。
- PostgreSQL 是权威数据源；事务用来保证多张表一起成功或一起失败。
- WebSocket 只让界面更快看到变化，不是第二套账本。
- Nginx 负责公网 HTTPS/WSS，Node 服务本身不直接暴露到公网。
- Docker Compose 把 API、数据库、网络和持久化卷按固定方式组合起来。

## 2. 技术栈及选择原因

| 层 | 技术 | 在本项目中的作用 |
| --- | --- | --- |
| 客户端 | 微信小程序原生 JavaScript/WXML/WXSS | 页面、交互、微信登录 code、REST/WSS 调用 |
| 传输适配 | `miniprogram/utils/backend.js` | Token、超时、有限重试、幂等、WSS 重连和数据映射 |
| 反向代理 | Nginx | TLS 证书、HTTPS、WSS Upgrade、请求大小和超时 |
| API | Node.js 24 + CommonJS + Fastify 5 | 路由、鉴权、校验、限流、业务编排和日志 |
| 实时通信 | `ws` | 同端口 `/api/v1/ws` 房间订阅与快照通知 |
| 数据库 | PostgreSQL 17 + `pg` | 用户、会话、房间、事务账本、流水、战绩和二维码 |
| 图片处理 | `sharp` | 校验并重编码头像，去除元数据和限制像素 |
| 容器 | Docker Compose | 固定运行环境、资源限制、网络隔离和持久化卷 |
| 测试 | Node.js 内置 test runner + PGlite | 快速验证接口、SQL 和业务规则 |

项目保持单 API 进程、单 PostgreSQL 实例，没有 Redis、微服务或 Kubernetes。这符合当前 2 vCPU / 2 GiB 单机规模，也减少了维护难度。

## 3. 代码应该从哪里读

建议按下面顺序阅读：

1. `miniprogram/utils/backend.js`：前端如何登录、请求、上传和连接 WSS。
2. `server/src/index.js`：服务启动时如何把配置、数据库和各业务模块组装起来。
3. `server/src/app.js`：Fastify 全局设置、登录、健康检查和统一错误格式。
4. `server/src/*-routes.js`：HTTP 路径、参数格式和鉴权入口。
5. `server/src/room-store.js` 与 `score-store.js`：房间生命周期和事务账本。
6. `server/src/realtime.js`：WebSocket 订阅、心跳和消息类型。
7. `server/migrations/*.sql`：数据库真实结构。
8. `server/test/`：业务规则的可执行示例。

后端目录职责：

| 文件 | 职责 |
| --- | --- |
| `config.js` | 读取并严格校验环境变量 |
| `database.js` | 创建 PostgreSQL 连接池 |
| `migrations.js` / `migrate.js` | 执行迁移并核对迁移文件校验值 |
| `auth.js` / `identity-store.js` | 微信登录、Bearer 会话、注销和用户身份 |
| `profile*.js` / `avatar-storage.js` | 昵称、头像校验、保存和读取权限 |
| `room-routes.js` / `room-store.js` | 创建、加入、退出、转房主、结算、解散、二维码 |
| `score-routes.js` / `score-store.js` | 转分、下注、奖池、流水和幂等 |
| `history-routes.js` / `history-store.js` | 战绩列表、详情和房间结算结果 |
| `qrcode.js` / `wechat-qrcode.js` | 微信小程序码生成、缓存和权限 |
| `realtime.js` | WSS 鉴权、订阅、心跳和房间事件 |
| `errors.js` | 可安全返回或写日志的错误码 |

## 4. 身份与权限

### 4.1 登录是怎样工作的

1. 小程序调用 `wx.login()` 得到一次性 `code`。
2. 客户端把 `code` POST 到 `/api/v1/auth/wechat`。
3. 后端用 AppID 和 AppSecret 向微信 `code2Session` 换取 openid。
4. 后端按 `(app_id, openid)` 查找或创建用户。
5. 后端生成 32 字节随机 Token，只把 Token 哈希保存到数据库，把原 Token 返回客户端。
6. 后续请求使用 `Authorization: Bearer <token>`。

openid 不返回给客户端，客户端传来的 userId、昵称或头像也不能替代会话身份。默认会话有效期是 7 天，到期后重新登录；注销只注销当前 Token。

### 4.2 为什么接口仍要逐次检查权限

“页面上没显示按钮”不等于安全。用户可能构造请求，因此每个写操作都要在服务端确认：

- Token 是否有效；
- 房间是否存在且仍处于可操作状态；
- 调用者是否是当前未退出成员；
- 需要房主权限的操作是否确实由当前房主发起；
- 接收者是否是合法成员；
- action、金额和模式是否匹配。

## 5. 数据库与事务，用前端思维理解

可以把一张表理解为一种对象集合，把外键理解为“数据库强制保证的引用关系”。当前迁移分工如下：

- `001_identity.sql`：`users`、`sessions`，解决用户与登录会话。
- `002_rooms.sql`：`rooms`、`room_members`、`active_room_memberships`、`room_commands`，解决房间、成员、唯一活动房间和生命周期幂等。
- `003_score_ledger.sql`：奖池/底注字段、`score_ledger`、`score_ledger_changes`，解决计分流水及每位玩家的变更。
- `004_history_qrcode.sql`：`histories`、`history_players`、`room_qrcodes`，解决结算快照和二维码缓存。

### 5.1 为什么不能直接“读完再 update”

两个人同时操作时，普通的“先读、计算、再写”可能都读到旧积分，后写入的人覆盖前一个结果。事务账本会在事务内按固定顺序锁住房间和成员，让并发操作排队基于最新状态计算。

一次计分事务至少要一起处理：

- 玩家积分；
- 奖池和底注；
- 房间 `stateVersion`；
- 主流水和玩家变更明细；
- `operationId` 对应的幂等回执。

其中任何一步失败，事务回滚，不能出现“积分变了但流水没写”的半成品。

### 5.2 operationId 为什么重要

网络超时只说明客户端没有收到结果，不说明数据库一定没提交。客户端重试时复用相同 `operationId`，后端就能返回之前的结果而不重复扣分。

正确做法：同一个用户动作只生成一个 ID，超时重试沿用原请求体和原 ID。

错误做法：每次重试生成新 ID；这会被服务端理解成新的计分动作。

### 5.3 必须保持的账本规则

- JavaScript 金额及结果必须是安全整数。
- 允许负分，这是玩法，不是漏洞。
- 下注模式的 `所有玩家积分 + 奖池` 必须守恒为 0。
- All-in 金额来自事务内读取到的当前正积分。
- 底注金额来自房间内的当前配置。
- 任意未退出成员都能领取整个奖池。
- 结算前奖池必须清空。
- 每局最多 8 个历史席位，退出者仍保留在本局账本。

## 6. REST 和 WebSocket 如何配合

REST 负责所有命令和完整读取，主要接口见 [`server/README.md`](../server/README.md#当前接口合约)。常用分组：

- `/api/v1/auth/*`：登录、注销；
- `/api/v1/users/me*`：本人资料和头像；
- `/api/v1/rooms*`：房间生命周期、快照和二维码；
- `/api/v1/rooms/:roomId/score`：所有计分 action；
- `/api/v1/rooms/:roomId/ledger`：流水分页；
- `/api/v1/history*`：战绩。

WSS 使用同一端口，路径是 `/api/v1/ws`。连接时也必须在 Header 发送 Bearer Token，Token 不能放在 URL。客户端订阅一个活动房间，服务端先检查权限，再发送完整快照。

`stateVersion` 是房间单调递增的版本号：

- 新版本大于本地版本才接收；
- 发现版本跳跃、重连或回到前台时，通过 REST 拉完整快照；
- WSS 临时失败只造成显示延迟，不能影响已经提交的数据库账本。

当前发布器保存在单 Node 进程内存里。如果以后启动多个 API 容器，必须先增加 PostgreSQL LISTEN/NOTIFY 或 Redis Pub/Sub 等跨进程广播，否则连接到不同进程的用户会漏通知。

## 7. 本地启动后端

### 7.1 准备环境

需要 Node.js 24、npm、Docker 和 Docker Compose。根目录与 `server/` 各有自己的 `package.json`：根依赖用于小程序与旧基线测试，`server` 依赖才是自建后端运行依赖。

```powershell
npm install
npm --prefix server install
Copy-Item server/.env.example server/.env
```

编辑 `server/.env`，至少替换数据库密码和 `WECHAT_APP_SECRET`。不要使用生产数据库或生产密码做本地测试。

### 7.2 启动数据库、迁移和 API

```powershell
docker compose --env-file server/.env -f server/compose.dev.yaml up -d --wait
npm --prefix server run db:migrate
npm --prefix server run dev
```

检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health/live
Invoke-RestMethod http://127.0.0.1:3000/health/ready
```

`live` 成功只说明 Node 进程活着；`ready` 还会检查数据库可访问且迁移版本与代码一致。

### 7.3 测试层次

```powershell
npm test
npm --prefix server test
npm --prefix server run test:postgres
```

- 根测试验证小程序纯逻辑、传输适配和旧基线行为。
- 后端常规测试使用 PGlite 和 HTTP 替身，速度快，但不能证明真实网络和多连接锁竞争。
- `test:postgres` 只允许显式配置的独立测试库；随机 schema 会保留，不会自动删除。

## 8. 生产服务器拓扑

当前服务器是 Ubuntu 22.04、2 vCPU / 2 GiB，部署拓扑如下：

```text
互联网
  │ 80/443
  ▼
Nginx + Let's Encrypt 证书
  │ 127.0.0.1:3000
  ▼
API 容器（只读根文件系统，头像目录挂载 volume）
  │ Docker 内部网络 :5432
  ▼
PostgreSQL 17 容器（数据库 volume）
```

安全边界：

- API 的宿主机映射必须保持 `127.0.0.1:3000:3000`。
- PostgreSQL 不映射宿主机端口。
- 数据库网络是 Docker internal network；只有 API 需要访问微信公网。
- Nginx 代理生产请求时 `TRUST_PROXY_HOPS=1`，直接本地运行默认是 0。
- API 使用受限数据库账号，迁移使用 owner 账号，两者密码必须不同。
- `.env.smoke` 权限应为 600，不进入 Git，不把展开后的 Compose 配置发到聊天或日志。

## 9. 当前服务器部署流程

当前生产实际基于 `server/compose.smoke.yaml` 加 `server/deploy/compose.proxy.yaml` 运行。文件名保留了早期“隔离测试”的命名，因此每次部署都应同时阅读 [`server/deploy/smoke/README.md`](../server/deploy/smoke/README.md)，不要仅凭下面摘要操作。

### 9.1 部署前

1. 确认当前 Git 提交、迁移编号和变更范围。
2. 备份 PostgreSQL，并记录备份文件位置、时间、大小和校验值。
3. 备份头像卷；数据库备份和头像备份应属于同一个维护窗口。
4. 保存当前服务器代码目录、镜像摘要、Compose 配置与 Nginx 站点配置。
5. 确认磁盘、内存、证书有效期和当前容器健康状态。
6. 使用新目录上传代码，不覆盖当前运行目录；不要上传 `node_modules`、`.env`、密钥或本地工具配置。

### 9.2 服务器本地配置

在服务器新版本的 `server` 目录创建 `.env.smoke`。如果已经存在，人工检查，不能直接覆盖。至少包括：

- 两个不同的 `DB_ADMIN_PASSWORD`、`DB_APP_PASSWORD`；
- `WECHAT_APP_SECRET`；
- 已验证镜像来源，最好固定到镜像摘要；
- 与现有生产一致的 AppID、数据库名和资源限制。

为了避免每条命令重复参数，可以只在当前终端定义：

```bash
dc() {
  sudo docker compose --env-file .env.smoke \
    -f compose.smoke.yaml \
    -f deploy/compose.proxy.yaml "$@"
}
dc config --quiet
```

`config --quiet` 只校验，不应输出展开后的密钥。

### 9.3 构建、迁移、授权、启动

```bash
dc build api
dc up -d --wait database
dc run --no-deps migrate
dc exec -T database psql -X --set=ON_ERROR_STOP=1 \
  -U gameintegrator_owner -d gameintegrator_smoke \
  < deploy/smoke/grant-app.sql
dc up -d --no-build --wait api
```

迁移脚本会记录文件校验值。已经执行的迁移文件不能修改；数据库结构变化必须新增 `005_*.sql` 之类的新迁移。

普通 `restart` 不会应用新镜像、环境变量或新挂载；这类变化需要重新创建 API 容器。不要通过删除数据库卷来解决迁移或权限问题。

### 9.4 内外部验收

服务器本机：

```bash
curl --fail --show-error http://127.0.0.1:3000/health/live
curl --fail --show-error http://127.0.0.1:3000/health/ready
dc ps
sudo docker stats --no-stream
```

公网：

```bash
curl --fail --show-error https://api.dsbyte.xyz/health/live
curl --fail --show-error https://api.dsbyte.xyz/health/ready
```

还应确认：

- 未登录的业务接口返回 401，而不是 Nginx 404/502；
- WSS Upgrade 能到达应用，未登录握手返回应用层 401；
- 公网不能连接 3000 和 5432；
- API 和数据库重启后数据、头像和健康状态仍在；
- 真机完成登录、头像、建房、两种计分模式、结算、战绩、二维码和 WSS 重连；
- 多账号弱网和重复点击不会造成重复计分。

### 9.5 Nginx

生产站点模板是 `server/deploy/nginx-api.dsbyte.xyz.conf`，它负责：

- 80 跳转 443；
- 使用 Let's Encrypt 证书；
- `/health/*` 和 `/api/v1/*` 转发到回环 API；
- `/api/v1/ws` 保留 Upgrade 与 Authorization Header；
- 头像上传请求大小限制和接口超时；
- 其他路径返回 404。

修改后先备份旧站点，再执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

只有 `nginx -t` 成功才能 reload。证书更新后也要验证 TLS 握手和 WSS。

## 10. 数据、备份与恢复

Docker volume 让容器重建后数据仍在，但它不是备份：误操作、磁盘损坏和宿主机故障仍可能同时破坏容器与卷。

至少需要两类备份：

- PostgreSQL 逻辑备份：用户、房间、账本、流水、战绩、二维码和迁移记录。
- 头像卷备份：实际 JPEG 文件。

恢复演练必须在独立目录或独立测试环境完成，不能直接覆盖生产卷。恢复后验证：迁移版本、表行数、受限角色权限、典型房间/战绩、头像读取、API ready 和业务登录。当前项目已经生成过逻辑备份，但完整的一致恢复演练仍是正式切换前缺口。

头像文件与数据库引用不是同一事务：数据库结果未知时宁可保留可能的孤立文件，也不能自动批量删除。清理时先查数据库引用与日志，再一次处理一个明确文件。

## 11. 日常运维和排错

### 11.1 先看哪一层

| 现象 | 优先检查 |
| --- | --- |
| 域名完全打不开 | DNS、证书、Nginx、80/443 防火墙 |
| 返回 502 | API 容器状态、127.0.0.1:3000、Nginx upstream |
| `live` 200、`ready` 503 | PostgreSQL、账号权限、迁移版本 |
| 登录 502/503 | 微信 AppID/AppSecret、服务器出网、微信接口状态和超时 |
| REST 正常、WSS 不更新 | Nginx Upgrade Header、Token、订阅权限、心跳、是否误开多个 API 进程 |
| 计分返回 409 | 先按错误码刷新快照，检查房间模式、成员、奖池、operationId 冲突 |
| 头像上传失败 | 大小、格式、像素、卷权限、磁盘空间、并发限制 |
| 重启后头像丢失 | `avatar-data` 卷是否仍正确挂载，不能把镜像目录当持久化目录 |
| 数据库连接多或变慢 | `PGPOOL_MAX`、PostgreSQL 连接数、锁等待、CPU/内存，不先盲目增大参数 |

### 11.2 日志原则

应用日志设计为只记录 requestId、方法、路由模板、状态码和安全错误码，不记录原始 URL、查询参数、请求体和 Token。排错时让客户端提供 `requestId`，再在同一时间范围查服务日志。

不要把以下内容粘贴到聊天、Issue 或公开日志：

- `.env` 和完整 `docker inspect`；
- Authorization Header、登录 Token、微信 code/session_key；
- AppSecret、数据库密码、私钥和生产备份；
- 未脱敏的用户数据。

### 11.3 资源限制

当前 Compose 给 API 256 MiB、数据库 512 MiB，并限制 CPU、进程数和日志轮换。空闲内存不是容量结论；上线前要观察真实并发、头像处理峰值、数据库锁等待、连接数、磁盘和 WSS 数量。

## 12. 发布与回滚要点

新版尚未正式发布，旧线上小程序继续使用云开发。正式切换时要避免新旧客户端同时写两套独立账本：

1. 先完成真实环境验收和备份恢复演练。
2. 确认旧端活跃房间的处理方式和维护窗口。
3. 发布新版小程序，并持续观察登录、计分、WSS、错误率和资源。
4. 只有用户明确确认后，才能停用旧服务；旧代码基线仍保留。

如果新系统已经产生有效写入，不能直接把小程序切回旧云数据库，否则新数据会丢失或形成两套事实。回滚前要先停写，再决定新数据如何保存、迁移或人工处理。

## 13. 改代码时的检查清单

改后端业务前问自己：

- 身份是否只来自会话？
- 参数是否由服务端严格校验？
- 成员、房主、房间状态是否在事务内基于最新数据检查？
- 多人同时操作会不会覆盖？锁顺序是否保持一致？
- operationId 和事务回执是否覆盖网络结果未知场景？
- 积分、奖池、流水和版本是否原子提交？
- REST 成功后是否发出正确的 WSS 事件？
- 前端能否在漏通知后通过 REST 完整恢复？
- 是否需要新增迁移、权限和测试？
- 部署时是否需要重建镜像、重建容器或更新 Nginx？

最后运行：

```powershell
npm test
npm --prefix server test
git status --short
```

涉及真实 PostgreSQL 锁竞争、微信登录、头像、扫码、WSS、备份或 Nginx 的变化，还必须在对应真实环境验证；单元测试通过不能代替这些验收。
