# 自建服务器改造：项目 Agent 团队

## 当前阶段与授权边界

- 用户已确认自建服务器：Ubuntu 22.04 64 位、华东1（杭州）、2 vCPU / 2 GiB；域名处于 ICP 备案阶段；旧业务数据无需保留或迁移。
- 当前是**迁移方案确认阶段**，本次只配置角色。用户明确要求先确认、不要着急开发；没有开始业务开发、安装依赖、登录服务器、改 DNS 或部署的授权。
- “旧数据不迁移”不代表获准删除旧云数据库、文件或停用云服务；本次不做这些操作。
- 现有线上实现仍使用微信云开发。根 AGENTS.md 的云开发说明和演进路线描述既有状态/设想；本次新增自建迁移方向，不表示已经完成切换。
- Node.js + PostgreSQL + WebSocket + Nginx，以及 Docker Compose，都只是先前建议；具体后端语言、数据库、托管方式仍须确认。不会因配置角色就创建后端或部署目录。

## 项目画像与证据

| 事实/风险 | 仓库证据及影响 |
| --- | --- |
| 原生微信小程序，JavaScript/CommonJS | package.json、miniprogram/app.js、miniprogram/pages/；不是React网站，也不是游戏引擎项目 |
| 三组云函数、云数据库、云存储、小程序码 | cloudfunctions/userFunctions/、roomFunctions/、gameLogic/；迁移不能仅替换接口地址 |
| 多人实时积分账本 | gameLogic/index.js 的事务、operationId、stateVersion；丢更新或重复操作会影响玩家结果 |
| 房间生命周期与实时前后台恢复 | miniprogram/pages/room/room.js、tests/room-lifecycle.test.js；新旧后端并存会有账本分叉风险 |
| 资料、历史权限与文件引用 | home/home.js、record/record.js、roomFunctions/；旧云端身份及访问控制不能在自建后端省略 |
| 已有测试，不等于真实服务联调 | tests/、根 npm test；含mock/纯函数，需要后续真实数据库并发与多账号验证 |
| 维护者熟悉Java/JavaScript、以前端为主 | 根 AGENTS.md；解释事务、鉴权、部署要说明原因、影响和如何确认有效 |

待确认：服务商、磁盘和带宽、域名值与备案进度、服务器现有服务、预计在线人数、后端技术选型、备份预算与上线窗口。不要读取密钥文件来补这些缺口。

## 当前配置：三个专业角色

| 实际来源角色 → 项目角色名 | 为什么需要 / 当前交付 | 文件责任与介入条件 | 验收及退出 |
| --- | --- | --- | --- |
| Backend Architect → `pac-engineering-backend-architect` | 后端接口、数据模型、事务账本、推送边界；交付接口映射和失败恢复方案 | 讨论迁移方案时按任务调用；阅读三组云函数、app/room页及tests；以后仅写明确分配的新后端/数据库模块，不与前端和运维争用 | 安全整数、负分、成员领奖池、去重、并发与版本校正均有明确验证方法；交付后等待授权 |
| Application Security Engineer → `pac-security-appsec-engineer` | 云身份/集合权限改为公开接口后需独立威胁分析；交付权限矩阵、风险及安全验收用例 | 登录、公开API、推送订阅和文件方案讨论时调用；默认只读，修复另行分配文件 | 覆盖伪造身份、越权、退出成员、重放、文件与密钥；不以扫描或静态检查代替真实验证 |
| DevOps Automator → `pac-engineering-devops-automator` | 单机2GiB与备案约束现在影响设计；交付资源预算、托管对比、备份和切换检查表 | 讨论部署方案时调用；以后仅负责明确分配的部署文件与运维文档，服务器操作另需授权 | 解释启动/重启/证书/恢复/切换验证方式；没有实测不报容量、部署完成或零停机 |

Backend Architect 的职责限定为本项目账本和API的细节，不重复创建全局 Software Architect 的通用架构团队；安全角色专看新增信任边界，运维角色专看单机与发布约束。三个角色均没有设置模型、推理强度、并发数、MCP、沙盒或权限。

## 条件候选：没有生成可加载角色文件

| 来源角色 | 触发条件 |
| --- | --- |
| API Tester | 新接口和数据库在隔离环境可运行、已有契约且存在独立回归任务后，重新评估并配置；验收多人并发、重复操作、事务失败、房间退出/结算和前端接入 |
| Performance Benchmarker | 有明确压测环境、授权、目标在线负载和停止条件后，重新评估并配置；测量内存、连接数、CPU、延迟和重连负载，不自动压生产 |

不新增 Frontend Developer：上游主要是React/Vue/Angular，当前原生小程序并不需要UI重做；由主 Agent 和已有 Minimal Change Engineer 处理接入层及生命周期。也不配置游戏引擎、AI训练、资金交易、专职数据搬迁团队；当前无相应实现或数据保留需求。

## 复用已有角色与协作

- 本机已有 `Software Architect`、`Code Reviewer`、`Minimal Change Engineer`、`Git Workflow Master`、`Technical Writer`、`Reality Checker`；本次只读核对名称与内容哈希，未复制、修改或接管用户文件。
- 主 Agent 负责用户确认、整体计划和前端协调；通用架构比较可用 Software Architect，最小改动可用 Minimal Change Engineer，常规审查可用 Code Reviewer，说明文档可用 Technical Writer，发布证据可用 Reality Checker，明确的Git工作可用 Git Workflow Master。不要求每次全部参与。
- 只有实际任务有明确授权、独立工作和清楚的文件所有权时才委派；配置不等于启动。当前任务没有启动子 Agent。
- 交接时写明允许修改的文件、不可触碰的部分、验收标准及依赖；多人共享代码，不撤销别人的更改。重叠写入和有依赖的步骤串行。
- 不批量删除、不替换AppID/云环境/二维码版本、不弱化服务端鉴权和积分规则、不把“旧数据可不保留”当成删除授权。

## 来源与重要改编

- 来源：[Agency Agents](https://github.com/msitarzewski/agency-agents)，固定 revision `3c9588880b7cafaec325a104899fd8bbe27e7d72`。角色名、源路径和SHA-256详见 [manifest.json](manifest.json)。
- 已完整阅读三个入选角色，提取专业职责并用本项目约束重写；没有执行上游命令或安装脚本，没有导入整个库。条件/排除候选按目录索引和元数据筛选，启用前须再读完整正文。
- Backend Architect：去掉大规模、多地域、自动扩容、默认双写/回填、固定延迟及可用率目标；改为当前规模的事务一致性、维护成本和单后端切换约束。
- Application Security Engineer：保留威胁建模、权限审查和可验证要求；不照搬生产扫描、指定工具、付费密钥服务、固定Token期限/IP绑定或企业合规认证。密钥方案需兼顾安全与单机维护成本，不在版本库保存真实凭证。
- DevOps Automator：去掉默认Kubernetes、多云、全套监控和自动发布；保留资源评估、可复现部署、备份恢复及最小权限，明确先计划后授权操作。
- 改编保留MIT许可：[Agency Agents LICENSE](licenses/agency-agents-LICENSE.txt)，Copyright (c) 2025 AgentLand Contributors。
- 配置格式已对照 [OpenAI 官方子Agent文档](https://learn.chatgpt.com/docs/agent-configuration/subagents)：项目级 `.codex/agents/*.toml`，必需字段 `name`、`description`、`developer_instructions`。

## 加载与重新评估

文件生成和静态校验不证明本任务已加载或角色实际运行；运行时加载待验证。可在你确认可信的本项目内新开任务后检查角色列表，不擅自更改信任或创建新任务。其他机器不一定具有上述六个用户级角色。

后端选型确认、进入实现/联调、准备正式切换、数据保留要求变化或扩容时，再用 `$project-agent-curator` 评估。普通修改不重配、不自动追加角色。重复配置时先按manifest比较哈希，用户改过的文件不得覆盖。
