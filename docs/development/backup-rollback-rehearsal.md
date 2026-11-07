# 2026-11-04 停机备份与产物回滚演练

这是一份工程演练记录，承接 #532，Refs #369、#73、#459。操作方法见[流程](backup-rollback.md)。官方 Web 实装、备份、旧包回滚、原路径恢复及换回当前包均实际执行；工程记录形成时人类尚未在 #73 裁决 R1 条件12；2026-11-07人类明确接受本次具名演练并批准登记条件12满足、关闭 #369/Done，原待裁决状态由该裁决接续。本记录不代表 #449 的界面接受、完整 Demo UAT 或 release go/no-go。

## 候选与环境

在检出 `docs/backup-rollback-rehearsal` 的专用工作树执行，时间为 2026-11-04 14:51–15:16 SGT。官方 CLI 为 `@deepseek-ai/dsh@0.2.0-rc.2`，由已缓存的官方 `lib/bin.js` 直接启动；Web Host 使用 Node `26.13.0`。仓库命令使用 pnpm `10.28.2`；CLI 安装日志报告其插件管理使用 pnpm `12.16.1`。这不扩大固定 Host ABI 或 Desktop 支持范围。

| 身份 | 当前包 | 回滚包 |
|---|---|---|
| 插件版本 | `0.1.0-demo.1` | `0.1.0-demo.1` |
| source | `dbc1bf14ba56ee0731f691c7ea48ebf5a4061990` | `f5ae377d98c43ed216f680cb72e5f35d73a2b8e1` |
| source tree | `26f346f63726c9e623c9863523bcdc73f32aca2b` | `3ae73b90495fcb0721d1b4814b49145b46e5b110` |
| tgz SHA-256 | `29787f35ab8efbfd9233e5018757687a932bee8cbf0e39c46d82402fcea96cdf` | `8dd2eb47685211cf655e9a98016f9114fa44ed63757dcadfd5972733c5e8245c` |
| 持久基线 | generation `3`；完整七份迁移 | 同左，迁移逐字相同，实际实装另行核验 |
| Host peer ABI | Cordis `~4.0.4`、dsh peers `~0.2.0-rc.2` | 同左 |

当前包 source 只比产品基线 `f0883948` 多本轮计划提交；本次工程 PR 不改产品代码。回滚包是已保留的 clean-source 旧构建，不是对当前包改名或改版本。它早于运行事实修复，故本演练仅验证只读回滚，不承诺旧版可继续执行。

使用新建的专用 `DSH_HOME` 和固定 `web` profile。Documents overlay 同时设置 `documentsDirectory` 与 `documentsLookupTimeoutMs=10000`；每次安装后的 dump-config 都核对了原 Documents，原生 workspace registry 中的唯一默认工作区也实际位于该 Documents 内。数据库、worktree allowedRoot 和原仓库保持相同 realpath，恢复没有换 profile。实际安装目录中的 manifest、patch、两份 JS、七份迁移和 LICENSE 共 12 个文件，当前包、旧包、最后换回当前包分别与对应 tgz 逐字节相同。

## 非空正控

没有 synthetic seed。通过实际安装页面创建工作区，使用宿主凭据服务的环境适配只读连接既有 GitHub Project，读到 316 个条目：301 个 WorkItem、15 个 PR-backed 条目。Planning `Status` 未被工程动作推进。

本地 Git 仓库是新建 scratch 仓库，仅含演练文件；绑定真实仓库的来源身份用于只读观察，未向 GitHub 创建分支、PR 或写规划字段。通过产品设置显式启用 Harness 主执行与 human 备用，随后从工作项 detail 实际点击 Start Work，使用 `rehearsal/backup-sandbox` 分支。

主执行设置官方 `HARNESS_PROJECTS_FORCE_SESSION_START_FAILURE=1`，在接纳会话前明确失败；人工备用使用本次演练只生成一次、仅驻控制进程内存的高熵 issuer，经原 credentials 环境适配跨全部重启复用。没有保存 secret 值，也没有声称该临时 issuer 可在控制进程结束后由数据库恢复。

2026-11-04 15:03:49 SGT，真实 typed 返回 `confirmed`、`ready`、`manual_fallback`。随后实际 `getExecutionContext` 和浏览器执行区均显示运行中：

| 事实 | 备份前的观测 |
|---|---|
| 工作项 | `77ae3e89-7354-4cc1-a6ff-1fb9ffd4cb01` |
| context | `ctx-49e14bff9910dddccc76b38ad3a3265a`，`ready` |
| run | `run-c5c7dbeb8c2e6c1e8161ee0d7b0c2495`，`running`，`fallback=1` |
| run 确认时刻 | `2026-11-04T07:03:49.134Z`；只读演练后未变 |
| Git | 一个实际新 worktree；分支/head `354c40073160338ebc472c36ccc25e791260e1fb` |
| 用户现场 | 源仓库和 worktree 的 README，以及 worktree 内未提交 note |

没有配置模型 key 或发送 prompt；没有独立的全宿主 session-create 计数，因此不把空白宿主会话的自动创建表述成“所有 session 创建为零”。Start Work 的人工备用来源、真实 Git 副作用和存储记录分别保留了证据。

## 四步实证

| 步骤 | 实际操作与结果 |
|---|---|
| 停机备份 | 关闭浏览器、停止当前 Host；实际进程正常退出 `0`，`lsof` 对主库及存在的 sidecars 返回无打开 PID。只读 SQLite 源通过 Backup API 写入不存在目标；integrity=`ok`、FK 为空、generation/schema/全表逻辑摘要和计数一致。 |
| 产物回滚 | 在原 profile 实际 remove 当前包、add 旧 tgz；命令均退出 `0`，12 个安装文件匹配旧包。旧官方 Host 实际启动，认证 typed reader 读回 316 项与同一 ready/running/manual context；浏览器打开同一 detail 并显示“运行状态：运行中”。 |
| 原路径恢复 | 再次停止旧 Host并确认无打开者，将原主库隔离保留；现场没有 WAL/SHM/journal。独立备份校验后在原 dataPath 生成新主库，全表逻辑内容与备份一致。相同旧包、原 profile 启动，实际 typed reader 与浏览器重复读回 316 项和相同执行上下文。 |
| 换回当前包 | 再次正常停机，实际 remove 旧包、add 当前 tgz，12 文件重新匹配当前包；Documents 未变。当前官方 Host 的 reader 与浏览器再次读回 316 项、ready/running/manual、原 worktree；最后正常停机，原件和工作树保留。 |

每轮比较均要求 WorkItem ID 集合、完整 context 记录、run 的 ID/context/status/updatedAt/fallback、Git worktree 登记、分支 head和用户文件摘要保持一致。结果均相同，context/run 始终各一个；没有通过再次 Start Work 或恢复外部操作来填充结果。

快照 SHA-256 为 `5cc60f44905a58b42277ef085656861870e875ef0fa6f8381dce5d68277ebcad`；schema 摘要为 `44cb6ef5b010ac708e3d35ec790c49023d4b36a7c9bed1b274d4b1d39ffa07b1`。这两个摘要属于本次固定快照，不是未来构建的通用期望值。

README 摘要为 `13bf5252c947483d4c33e83c1bd6bb1209c7a2538a7650407820a430df765fab`；未提交 note 为 `f56cb29b600bdf56b965e00717802bb6fdbfd8548c66356208c052e59abd5f9e`。所有阶段均未变；数据库恢复没有删除用户内容或重新创建工作树。

## 负控、命令与局限

损坏 SQLite、错 generation、缺失文件、已有 backup 目标、越界路径和仍有数据库打开描述符六类负控均明确拒绝，原数据库摘要未变。负控只在隔离副本或受控只读描述符上执行，没有改生产基线骗准入。流程正文中两段完整 Python 命令还从 Markdown 原样提取，在独立副本实际执行备份和原路径恢复；两段退出 `0`，隔离原件保留。这项命令验证独立于官方 Host 的四步实装证据。

在上述分支工作树根运行以下命令，首组实际通过 `194` 个非跳过用例：

```sh
pnpm --filter @harness-projects/app-harness-plugin pack:plugin
pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-demo-artifact.test.js tests/integration/storage-baseline-admission.test.js
```

收尾的基线/真实重开/产物命令又通过179个用例，无skip。

原始安装日志、typed 请求与响应、四个阶段的 product reader 结果、SQLite/Git 比较和浏览器截图保留在专用隔离运行目录供独立验收；访问地址、issuer、签名执行句柄、用户内容和本机绝对路径不进入本记录。

首次设置有未解决的观察：启用执行后紧接绑定仓库，UI 长时间显示处理中，数据库已有两个执行挂载但尚无仓库。该轮没有请求级抓包，不能确定请求是否分发、Host 是否仍在等待或 UI 是否遗漏结果；保留了页面、PID与数据库事实。正常停机退出 `0` 后，同 profile 重启的 `getWorkspaceSetup` 明确读回 `executionInstalled=true`；重新读取规划，再绑定仓库的实际 typed 调用于 15:02:10 SGT 返回 `local_only`，随后真实路由可读。UI 一度仍显示“仓库操作结果未知”，未把它改写成无障碍安装成功。该观察需独立归因，不在本篇文档 PR 暗改产品。

旧包与恢复后的旧包 UI曾显示来源读取不完整/最后已知值；执行上下文的实际读取已单独确认，未把缓存或工程事实冒充新的规划确认。最后当前包的非空页面显示当前读取已确认。本演练不证明离线/撤权矩阵、真实模型、Desktop、跨 profile 执行迁移、旧包继续执行或外部系统回滚安全；也不清除上述设置观察、人类 UAT 或 R1 的未决项。
