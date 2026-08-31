# Ubuntu服务器隔离测试

现有服务器目录只部署过提交 `0f0a086` 的基础身份后端，用来验证真实数据库连接、受限账号、健康检查和端口隔离；不是完整小程序上线。该镜像没有002～004房间/账本/战绩迁移、头像卷、业务接口、WSS或新版小程序，宿主机也尚未接入本项目的Nginx/TLS。

当前仓库完整版本已包含资料/头像、房间、计分、结算/战绩、二维码、单实例WSS和小程序REST/WSS适配。未来获得部署授权后，必须在独立目录重新构建镜像、把数据库迁移到004、执行当前 `grant-app.sql`、按当前Compose重建API并新增 `avatar-data` 卷；只复制JavaScript或restart旧容器都不足以升级。保留已有数据库卷，不用删卷解决权限或迁移问题。

完整版本部署后仍需单独验收：sharp原生依赖、头像卷权限与重启持久化、真实微信登录/二维码、HTTPS/WSS、真机与新版scene、多账号弱网、PostgreSQL多连接竞争、备份恢复、数据留存和容量告警。旧healthy只证明基础镜像，不能外推到这些功能。接口、事务和存储边界见 [后端说明](../../README.md)。

## 已知环境与边界

2026-08-28用户终端输出：Ubuntu 22.04 / amd64，Docker 29.7.2、Compose 5.5.0；
部署前内存总计1.6 GiB、available约1.1 GiB，无Swap；根盘40 GiB、可用34 GiB；当时无运行容器。
Docker Hub直连超时，ECR Public的官方hello-world下载运行通过。
随后用户确认Node 24 bookworm-slim和PostgreSQL 17 bookworm的ECR镜像均已下载成功。
随后通过已验证主机身份的SSH连接读取到实际镜像摘要（未修改标签或重新拉取）：

- Node：`public.ecr.aws/docker/library/node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e`
- PostgreSQL：`public.ecr.aws/docker/library/postgres@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0`

### 隔离部署验收进度（用户回传终端输出）

- 用户确认上传包逐文件SHA256全部OK；部署目录为`~/gameintegrator-smoke-20260828/server`。
- `gameintegrator-api:smoke`构建成功。
- `/health/ready`返回`success: true`及`status: ready`，说明API能连接实际数据库并校验当前迁移及读取用户/会话表。
- `dc ps`显示API与数据库都为healthy，API发布`127.0.0.1:3000->3000/tcp`；数据库只显示容器内`5432/tcp`，不是宿主机端口发布。
- 用户授权admin加入docker组后，已通过SSH直接复核：两容器healthy、ready成功；从API进程环境连接数据库确认current_user为gameintegrator_app、current_database为gameintegrator_smoke。该角色不是超级用户、不能创建数据库或角色，不能在public建表或UPDATE迁移记录。
- 只读采样：API约34.82 MiB/256 MiB、数据库约61.68 MiB/512 MiB，整机available约1.0 GiB、磁盘余33 GiB；两个容器RestartCount=0、OOMKilled=false。是空闲状态的一次采样，不是压测或并发容量结论。
- Docker实际端口配置与宿主机监听一致：API仅127.0.0.1:3000，数据库没有宿主机端口发布/监听。未登录访问users/me实际返回401 AUTH_REQUIRED；配置文件权限为600、属主admin，未读取或输出文件内容。
- 外部端口验收仍未完成：本机TCP探测曾报告3000/5432连接成功，但3000的HTTP请求返回空响应，5432没有返回PostgreSQL协议响应；可能有链路中间设备影响，不能据此断定数据库暴露或公网隔离已通过。需从独立可信网络结合安全组/转发规则复核。
- 发现宿主机已有nginx（root主进程、www-data工作进程）监听IPv4/IPv6的80端口；本机对其/health/ready请求为404。未读取完整配置、未修改或重启该服务；后续接入域名/代理前先核对现有用途。
- 尚待真实微信登录、业务并发、重启与备份恢复验收。健康检查不验证微信凭证有效性或完整业务。本轮远程操作仅为只读检查，没有改动服务或业务数据。

以上不代表已正式上线；现有小程序仍使用旧云服务。已上传的归档保持原样，不因更新本地验收记录重新覆盖服务器文件。

本地校验记录：官方Compose 5.5.0命令行（下载后比对发布摘要）通过配置解析，并检查回环端口、内部网络、凭证分离和内存上限；仅使用示例值。
该次基础镜像部署前曾通过原小程序63项、新后端23项测试。当前仓库在2026-08-31已扩展为根测试70项、新后端70项；新增结果仍是本地验证，不代表服务器旧镜像已更新。权限测试会执行部署SQL并切换角色验证业务读写、不可建表及修改迁移记录；PGlite不验证容器初始化、SCRAM网络登录或真实多连接竞争。

- 数据库上限512 MiB，应用256 MiB，一次性迁移工具256 MiB；这是限制，不是容量承诺。
- 构建不受应用运行时的256 MiB限制。首次在数据库启动前构建；后续更新优先在独立环境构建。内存不足时停止并检查，不并行堆叠构建/业务/压测，不自动创建Swap或重启服务器。
- API仅发布到宿主机127.0.0.1:3000；数据库无宿主机端口。不要在安全组开放3000/5432，不修改防火墙来解决下载问题。
- 数据库在内部Docker网络，只有API另接出站网络访问微信。微信仍需实际网络与凭证测试。
- 管理账号仅用于初始化和迁移；API使用无建表/删表权限的独立账号，迁移版本表只读。
- 数据保存在独立命名卷；持久化不是备份。不删除卷来处理失败，不删除旧云数据。
- 每个容器日志轮换10 MiB × 3；Docker镜像、构建缓存、数据库仍可能增长，不能据此认为磁盘永不满。
- 环境变量可被宿主机root/Docker管理员读取；不能把.env、完整inspect或展开的compose配置发到聊天。此方案不防宿主机管理员。

## 1. 准备文件与镜像

将本次修改后的server目录上传到独立测试目录，例如`~/gameintegrator-smoke/server`。
只上传代码、锁文件、Dockerfile、compose.smoke.yaml、migrations、src、deploy和.env.smoke.example；
不要上传node_modules、原项目.env.local或任何已有.env。不要覆盖已有服务目录。
此文档不会自动上传文件或连接服务器。

也可使用本机`server/artifacts/`生成的上传包：它按明确文件清单打包当前工作区的基础后端，
不含node_modules、测试文件、Git目录或真实.env，只含.env.smoke.example示例。
归档附有逐文件SHA256清单，解压到新的独立目录后使用`sha256sum -c <包内清单文件名>`校验。
不要把解压目标设为已有服务目录；不要因为重试而覆盖原目录或清理旧文件。

以下命令均在Ubuntu的**已上传server目录**执行，出错立即停止。

```bash
sudo docker pull public.ecr.aws/docker/library/node:24-bookworm-slim
sudo docker pull public.ecr.aws/docker/library/postgres:17-bookworm
```

分别确认成功；记录输出Digest。若失败，不随机添加第三方镜像源或跳过证书检查。
测试默认使用标签；正式发布前应把.env.smoke对应镜像值换成已验证仓库的`@sha256:...`引用并留存记录。
只在同一镜像来源内使用摘要，不假设不同仓库标签始终同步。

## 2. 创建本地配置（不要发出密钥）

确认.env.smoke不存在后执行；存在则保留并人工检查，不覆盖：

```bash
(umask 077; set -C; cat .env.smoke.example > .env.smoke)
nano .env.smoke
```

分别设置DB_ADMIN_PASSWORD、DB_APP_PASSWORD为两个不同的随机密码（推荐密码管理器生成64位十六进制字符），
WECHAT_APP_SECRET填真实小程序密钥，仅在本机编辑。不使用示例值、不关闭配置校验。
此时即使填了真实密钥，也只代表配置完成，不代表真实登录已通过。

后续为了减少重复输入，在当前终端定义：

```bash
dc() { sudo docker compose --env-file .env.smoke -f compose.smoke.yaml "$@"; }
dc config --quiet
```

`--quiet`只校验配置，不打印展开的密码。示例占位值不是有效凭证，必须事先替换。
新开终端时重新进入目录并定义dc。

## 3. 先构建，再启动数据库

```bash
dc build api
dc up -d --wait database
```

构建会通过npm锁文件访问npm仓库；ECR拉取成功不保证npm可达。如下载失败，先诊断，不移除锁文件或关闭TLS验证。
若数据库初始化失败，停止操作并检查`dc logs --tail 60 database`，先遮蔽敏感信息再分享；
入口初始化脚本只对新卷执行，重启不一定能修复半初始化状态。不要删卷重来。

## 4. 建表并授权

```bash
dc run --no-deps migrate
```

必须看到迁移成功或“数据库已是当前版本”后，再执行授权：

```bash
dc exec -T database psql -X --set=ON_ERROR_STOP=1 -U gameintegrator_owner -d gameintegrator_smoke < deploy/smoke/grant-app.sql
```

迁移工具按需运行后退出，不自动清理容器；不要批量删除退出容器。
修改.env不会自动更新数据卷内已有账号密码。需要轮换时单独安排ALTER ROLE与应用配置更新。

## 5. 启动与验证

```bash
dc up -d --no-build --wait api
curl --fail --show-error http://127.0.0.1:3000/health/live
curl --fail --show-error http://127.0.0.1:3000/health/ready
dc ps
sudo docker stats --no-stream
```

live应返回alive、ready应返回ready，API和数据库应为healthy。
ready成功说明API运行账号能访问数据库并校验当前迁移，不能替代真实微信登录、多账号并发或恢复演练。
验证运行账号权限（预期都是f）：

```bash
dc exec -T database psql -X --set=ON_ERROR_STOP=1 -U gameintegrator_owner -d gameintegrator_smoke -c "SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'gameintegrator_app';"
dc exec -T database psql -X --set=ON_ERROR_STOP=1 -U gameintegrator_owner -d gameintegrator_smoke -c "SELECT has_schema_privilege('gameintegrator_app', 'public', 'CREATE') AS can_create, has_table_privilege('gameintegrator_app', 'schema_migrations', 'UPDATE') AS can_change_migrations;"
```

从外部网络确认公网IP:3000和:5432不能连通；不要为了小程序测试改为0.0.0.0端口发布。
没有域名与证书时，仅用服务器终端或经批准的SSH隧道测试；不放宽小程序生产域名校验。

停止测试而保留数据：

```bash
dc stop api database
```

普通重启应用使用`dc restart api`；修改配置/镜像后需按版本重新创建API，restart本身不会应用新配置。
正式发布仍需独立完成HTTPS/WSS、备份恢复、监控、会话清理、真实登录及业务验收，并获得切换确认。

参考：[Compose服务配置](https://docs.docker.com/reference/compose-file/services/)、
[PostgreSQL psql](https://www.postgresql.org/docs/17/app-psql.html)、
[PostgreSQL官方容器初始化入口](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh)。
