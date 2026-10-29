# PR #456 MMP 交付评审

## 锁定事实

- 日期：2026-10-29。head：`fbcb89703f15b1223f4f79facefda2ac79d7fca4`；base：`main@06d929017c8551e6b106fcbe7651f12ac26e4642`。
- 执行上下文：`.worktrees/host-command-authority`；评审账号 `Singularity-AI-Bot`，开发账号 `SingularityKChen`。
- 阶段：先建立风险矩阵，再检查代码、产品、架构、测试、反例和工作项。下面是待验证风险，不是缺陷结论。

## 风险矩阵

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 初始状态 |
|---|---|---|---|---|
| P0 | main 不可运行、不可恢复数据破坏 | 权威状态或凭据硬边界失效 | 迁移/发布基线与必需门禁失真 | 未发现新增缺陷；没有 schema/迁移或旧库搬移 |
| P1 | 越权、并发陈旧写入、重放与失败恢复错误 | 用户任务无法完成、Provider ack 或 Host 权威被绕过 | issue 核心验收缺失、判别性反例未覆盖 | 未发现新增缺陷；真实运行时与三项变异覆盖下述信任链 |
| P2 | 有限错误反馈、可恢复边缘路径偏差 | 可用性/说明缺口，范围局部 | 非核心验收或测试遗漏，重复跟踪核对 | 无新增意见；既有 #422/#338 保持开放 |
| P3 | 命名、局部可读性、可选简化 | 文案与维护成本 | 引用、证据表述与冗余 | 无新增意见；采用公开 API 的小适配器与现有 disposer，未发现过度设计 |

## 分层证据与反例

### 信任链、代码与架构

- `remote.ts` 统一枚举 `OPERATIONS`，在既有 strict 参数解析后、进入 composition 前覆盖全部声明 `actorRef` 的 unary 命令。调用 actor 是本次动态 `this.ctx.invocation.peer.id` 的非空字符串副本；没有 invocation、无效 id 均在命令/持久写入前拒绝，不接受客户端、环境或全局 operator 的回退。查询和 watch 不新增 actor 条件。
- 实际 `@deepseek-ai/dsh-client-connection@0.2.0-rc.2` 的 `HostConnectionService.admit` 先检查 Host/Origin 与 browser authentication，再返回自己拥有的 `OperatorPeer`。peer id 由 `randomUUID` 生成，寿命属于该 Connection。实际 Gateway 的 `remoteRequest` 只提取 wire `args`，peer 由 carrier 传入；`prepareInvocation` 用 `receiverContext.extend({ invocation }).get(service)` 和 `Reflect.apply` 调用服务。因此客户端 JSON 不控制 Host invocation，手工 `gateway.invoke({peer})` 用例只证明集成边界，不冒充网络认证。
- 实际 Cordis `4.0.4` 的公开 `Service.tracker`、`Tracker` 类型和 `createTraceable` 实现支持 `ctx` 动态重绑定。`host-authority.ts` 只在 Host 入口导入 SDK；共享 descriptor/client 没有引入 Node/SDK。保留 plain service 和原 disposer，未增加第二套服务或身份系统。
- `profileDataPath` 只消费公开 `ProfileContext.dir`，先验证绝对非空字符串，再 realpath/stat，失败发生在 composition 开库前。数据库、工作树、诊断沿该目录派生。实际公开 `dsh-app-boot` 类型确认 launcher 提供 `dir`、`home`、`name`；官方 home helper 负责 configured home/tilde。旧共享目录没有打开、自动搬移、合并或删除路径。
- ephemeral peer 不等于人类账号或授权 principal。Start Work 的 durable fingerprint 在新 peer 重用旧 key 时 conflict，设置命令跨重启按自然键读回；安装指南及 ExecPlan 已明确这两个不同保证。现有 Provider 确认和 Core 状态拥有不变。

### 产品、安装与恢复

- 独立回读实施者保留的三次实际 Web 观察原始 JSON：两个 profile 首次状态独立，同 profile 重启保留名称且 peer 变化；同连接合法伪造 actor 改变后，createWorkspace 的结果相同，改变 intent 得到 conflict，无认证请求为 401。
- 回读实际 observer 源码只写出 profile dir/name 与 Connection operator peer；没有修改产品服务或 artifact。回读卸载后的两 profile 认证入口均为 404，原库保留；监听记录为单一 loopback listener。artifact 当前 SHA-256 与观察记录、安装指南一致：`3b704750efebb01a660f8604a13417ac00ace87d546d67834f28fba2d81ba308`。本次是原始观察核查，没有重新启动 Web 或调用模型。
- 独立 artifact 测试重新构建并检查包名导出、Cordis peer、宿主 JS 加载、包内 migrations、client ABI 和发布面；测试中的 fake context 只用于包加载，不据此声称真实身份链成立。真实 Gateway/生产 composition/Local Git/SQLite 用例另证明 actor 写入 durable Start Work fingerprint。
- #423 的三个验收边界均有对应证据：可信 actor/伪造输入；配置 home/tilde/profile 隔离；typed remote/package ABI 与实际 sandbox 观察。未据此关闭父 #338、生命周期 #422，或安装 Host 的整体 MMP/R1 验收。

### 独立验证

以下命令均在锁定 head 的本 PR worktree 执行；全部退出 0：

```sh
pnpm test:file tests/integration/harness-plugin-host-authority.test.js tests/integration/harness-plugin-artifact.test.js tests/integration/workspace-setup-commands.test.js
pnpm test:file tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-demo-artifact.test.js
pnpm run typecheck
pnpm run boundaries
git diff --check 06d929017c8551e6b106fcbe7651f12ac26e4642...HEAD
```

结果依次为 58/58、28/28、类型检查通过、9/9、无 diff 空白错误。本次没有独立重跑完整 `pnpm verify`、Desktop/真实模型或用户验收；作者的完整测试记录不替代当前远端 checks，远端 head/base/threads/checks 由主评审另行锁定。

### 变异判别表

在最终产品树上以 `node scripts/review-mutate.mjs <owned-spec.json>` 一次整表执行，command 为 `node --test --test-timeout=15000 tests/integration/harness-plugin-host-authority.test.js`。基线和还原后基线通过，三个变异均 KILLED 且命中指定 `killedBy`；工具逐字节还原后产品文件无工作区 diff。spec/log 只留本地运行证据，不提交运行态内容。

| 变异 | 替换 | killedBy | 结果 |
|---|---|---|---|
| A1 | 取消统一 actor 覆盖，保留 wire actor | `real Gateway and production Host persist trusted peer` | KILLED |
| A2 | 取消公开 Cordis tracker 装饰 | `real Gateway and production Host persist trusted peer` | KILLED |
| A3 | 将数据库根从 profile dir 改为其父目录，使 profiles 共享根 | `authoritative profile dir isolates two profiles` | KILLED |

## 结论与后续

本次独立 MMP 交付评审未发现新增 P0/P1/P2/P3 意见，可接受 #423 这个能力闭环；不把它扩大为完整 MMP-Core、R1 或 #338/#422 完成。生命周期的无界卸载与失败 remote 撤回已核对属于现有 #422，未因本 PR 增加；#459 仍需处理其实际发布边界。

子评审没有提交 review、commit、push、issue/看板写入或合并。主评审核对当前远端 head/base、全线程、必需 checks 以及人类对各 PR 的授权后，按仓库工作流提交完整 review 和收尾；若 head 改变，本结论需要复核。

## 主控综审与收尾门

- 2026-10-29 首轮：独立子评审与主控全矩阵均无新增 P0/P1/P2/P3。初始 head/base 已锁定；所有原 review threads/reviews 为空。主控逐条查明可选评审转发失败属于 #364；取消的重复规则运行有成功后继，当前代码门通过。
- 已使用 `gh-review` / `Singularity-AI-Bot` 一次性提交完整 APPROVE review，没有可提交的 inline 缺陷；开发与后续外部写入使用 `gh` / `SingularityKChen`。
- 以四个首轮固定 head 按 #454 → #455 → #456 → #445 在隔离 clone 逐项变基预演，无冲突，组合 head `23916987d93026109a2fce8a55cc55147b521e3d`。固定 pnpm 10.28.2 后 typecheck、2551/2551 与 MVP-0 7/7 通过（0 fail/cancelled）。首次 pnpm 11 的依赖预检在测试前因非 TTY 终止，不是测试通过；离线安装也曾因缓存缺包失败，联网 frozen install 成功。
- 收尾只整合提交与审查记录；每个分支先保留原 head 的本地 backup ref，更新到真实 base 后核对源码与预演/独立审查相符，运行受影响验证和发布面/规模检查，以精确 lease 推送。远端最终 head/base/checks/issue/threads 和复评全部成立后才执行 rebase merge；任一条件改变则回到该门，不能借首轮批准跳过。
- 本轮接受对应子 issue 的有界闭环；不接受父级 MMP、真实模型、人工 Demo、独立安装或 R1。保留原跟踪问题和人类验收门。
