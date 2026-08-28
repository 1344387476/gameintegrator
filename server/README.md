# 自建后端：第一批基础服务

当前已有配置校验、PostgreSQL 迁移、微信登录、服务端会话、本人资料查询、注销、限流与健康检查。**房间、计分、战绩、文件上传和 WebSocket 尚未实现，小程序仍走原云开发。**

后端独立使用 Node.js 24、CommonJS、Fastify 和 `pg`，不加载 `wx-server-sdk`，也不读取根目录旧 `.env.local`。后续阶段见 [迁移计划](../docs/self-hosted-migration.md)。

## 无真实密钥即可运行测试

在仓库根目录运行：

```powershell
npm --prefix server ci --ignore-scripts
npm --prefix server test
```

测试使用 PGlite 的内存 PostgreSQL 引擎执行真实 SQL，并用假微信响应替代外部登录调用。不连接生产、不导入旧数据、不创建磁盘数据库、不删除文件。

PGlite 是单连接串行引擎；测试不证明独立 PostgreSQL 17 的连接池、网络、角色权限或多人并发已经通过，也不替代真实微信登录。当前没有部署到 Ubuntu 或验证 Docker 镜像。

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
- `Dockerfile` 仅提供应用镜像定义。正式 Nginx/TLS、生产 Compose、最小权限账号、备份、告警及切换方案留到部署阶段，没有公网服务可直接上线。

## 当前接口合约

| 方法与路径 | 输入 / 权限 | 结果 |
| --- | --- | --- |
| GET `/health/live` | 无登录 | 进程存活 |
| GET `/health/ready` | 无登录 | 数据库与迁移版本就绪；异常为503 |
| POST `/api/v1/auth/wechat` | JSON对象，仅允许 `code` | 登录凭证、到期时间、是否新用户及用户资料 |
| GET `/api/v1/users/me` | `Authorization: Bearer <token>` | 当前用户资料，不接受客户端openid或目标用户ID |
| POST `/api/v1/auth/logout` | 同上，不需要请求体 | 注销当前会话；其他设备有效会话保留 |

成功响应：

```json
{
  "success": true,
  "data": { "id": "用户UUID", "nickname": "玩家123", "avatarFileId": null },
  "requestId": "服务器生成的请求ID"
}
```

登录的 `data` 为 `{ token, expiresAt, isNewUser, user }`。`expiresAt` 使用 UTC ISO 日期；用户标识为服务器 UUID，不向客户端返回微信 openid、AppSecret 或 session_key。`avatarFileId` 为未来文件模块预留，目前为空。房间关联字段将在房间模块实现时增加，不用一个始终为空的字段冒充已有房间功能。

失败响应：`{ success: false, error: { code, message }, requestId }`。

| HTTP | code举例 | 客户端后续处理 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | 修正参数，不自动重试 |
| 401 | `AUTH_REQUIRED` / `WECHAT_CODE_INVALID` | 重新获取微信code并登录；不要循环复用一次性code |
| 413 / 415 | `REQUEST_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | 修正请求大小或JSON类型 |
| 429 | `RATE_LIMITED` / `WECHAT_RATE_LIMITED` | 延后重试，尊重限流提示 |
| 500 / 502 / 503 | `INTERNAL_ERROR` / `WECHAT_UNAVAILABLE` / `NOT_READY` | 提示暂不可用；后续请求重试必须有上限 |

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
