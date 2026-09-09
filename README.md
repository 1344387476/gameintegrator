# 牌局计分小程序

一个用于多人牌局实时记分、下注、结算和战绩查询的微信小程序。项目已经完成从微信云开发到自建后端的代码迁移：小程序通过 HTTPS REST API 和 WSS 连接自建服务，后端使用 PostgreSQL 事务保存权威账本。

> 当前状态：自建后端已经部署到 `https://api.dsbyte.xyz`，但新版小程序尚未正式发布切换。旧线上版本及旧云开发服务仍需保留，不能直接删除或停用。

## 功能

- 普通模式：单笔转分、批量转分，允许出现负分。
- 下注模式：下注、底注、All-in、领取奖池。
- 房间管理：创建、加入、退出、房主转移、结算、解散。
- 实时同步：WSS 推送房间快照，断线后通过 REST 校正。
- 用户资料：昵称、受保护头像上传与读取。
- 战绩与分享：战绩分页、详情、结算建议、海报和永久邀请二维码。
- 安全账本：服务端鉴权、数据库事务、幂等操作和审计流水。

## 技术架构

```text
微信小程序
  ├─ HTTPS REST：登录、资料、房间、计分、战绩、二维码
  └─ WSS：接收房间状态变化
          │
          ▼
Nginx（HTTPS/WSS、域名 api.dsbyte.xyz）
          │ 仅转发到 127.0.0.1:3000
          ▼
Node.js 24 + Fastify + ws
          │
          ├─ PostgreSQL 17：用户、房间、账本、流水、战绩、二维码
          └─ Docker Volume：头像文件
```

后端是积分的唯一可信来源。WebSocket 只负责通知和同步，不直接执行计分；客户端提交的用户身份、昵称、头像和最终积分都不能作为可信数据。

## 目录说明

| 路径 | 用途 |
| --- | --- |
| `miniprogram/` | 当前微信小程序，使用自建 REST/WSS 后端 |
| `server/src/` | Fastify 后端、事务账本、WebSocket 和业务模块 |
| `server/migrations/` | PostgreSQL 迁移，当前为 `001`～`004` |
| `server/deploy/` | Nginx、Compose 覆盖和服务器验收文件 |
| `server/test/` | 后端接口与业务测试 |
| `tests/` | 小程序逻辑、适配层和旧基线兼容测试 |
| `cloudfunctions/` | 旧云开发基线，仅保留参考，不在新版运行链路中 |
| `docs/` | 架构、部署、迁移决策和交接文档 |

## 本地开发

环境要求：

- Node.js 24
- npm
- Docker 与 Docker Compose（启动本地 PostgreSQL 时需要）
- 微信开发者工具

安装依赖并运行全部常规测试：

```powershell
npm install
npm --prefix server install
npm test
npm --prefix server test
```

后端本地启动：

```powershell
Copy-Item server/.env.example server/.env
# 编辑 server/.env，填写独立开发库和微信小程序配置
docker compose --env-file server/.env -f server/compose.dev.yaml up -d --wait
npm --prefix server run db:migrate
npm --prefix server run dev
```

不要把 `server/.env`、微信密钥、数据库密码、登录 Token 或生产备份提交到 Git。真实 PostgreSQL 并发测试只允许指向明确配置的独立测试库，测试 schema 不会自动删除。

## 关键业务规则

- 每局最多保留 8 个历史席位。
- 普通模式允许负分；不要增加“余额不足”限制。
- 下注模式中，任意未退出成员都可以领取整个奖池。
- 结算前奖池必须为 0；结算生成不可变战绩快照。
- 最后一人退出或房主解散会删除本局及流水，不生成战绩。
- 所有写操作必须携带 `operationId`；网络结果未知时复用原 ID 重试，不能重新生成。
- 积分、奖池、版本、流水和幂等回执必须在同一数据库事务中提交。

## 测试与发布检查

```powershell
npm test
npm --prefix server test
node --check cloudfunctions/gameLogic/index.js
node --check cloudfunctions/roomFunctions/index.js
node --check cloudfunctions/userFunctions/index.js
```

正式发布前仍需完成多账号弱网、二维码与扫码、真实 PostgreSQL 多连接竞争、数据库与头像一致备份恢复、留存策略、容量告警和上线观察。新系统产生写入后不能直接切回旧数据库。

## 文档入口

- [项目技术与服务器部署手册](docs/technical-and-deployment-guide.md)：从前端视角解释后端、数据库、事务、WSS、Docker、Nginx、部署和排错。
- [后端接口说明](server/README.md)：接口参数、返回值、安全边界和测试方式。
- [自建迁移决策记录](docs/self-hosted-migration.md)：已确认方案、完成项、剩余验收和切换顺序。
- [服务器隔离部署步骤](server/deploy/smoke/README.md)：当前 Compose 部署的具体命令和验收 SQL。

## 维护提醒

- 生产 API 只绑定 `127.0.0.1:3000`，PostgreSQL 不映射宿主机端口；公网只开放 Nginx 的 80/443。
- `cloudfunctions/` 是仍在线旧版本的基线，不要因新版已迁移就删除。
- 数据库迁移文件一旦执行不能修改；新增变更应增加下一编号迁移。
- 头像卷和数据库卷是持久化数据，但“卷”不等于“备份”。
- AppID、生产域名、云环境 ID 和二维码版本不要随意改动。
