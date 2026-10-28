# 客户端快照时序与 Host 代际 ExecPlan

> 状态：Completed（实现与独立验收）；远端交付以本计划实时回读命令核对，合并由人类决定。
> 创建：2026-10-28（SGT）
> 范围：#218 的客户端失效操作、Transport 发布隔离、真实 Host 代际和既有快照事务中的存储元数据一致读。
> 上游输入：[issue #218](https://github.com/SingularityKChen/harness-projects/issues/218)、[维护者 2026-10-16 收窄评论](https://github.com/SingularityKChen/harness-projects/issues/218#issuecomment-6210589200)、`docs/exec-plan/completed/2026-10-27-planning-refresh-confirmation.md`；格式权威为根 `PLANS.md`。

## Purpose / Big Picture

用户断开或发起较新的重连后，旧异步请求的成功与失败都不能再次改变工作区、连接状态或确认时间。已经接受的遮蔽内容和较新来源元数据不能被旧可见帧恢复。真正重建的 Host 可以用新代际合法地发布较低 revision；普通网络重连没有这个权限。一次基线的业务投影、身份、同步摘要、存储 descriptor 和仓库引用来自同一个本地读取作用域，authority 与能力采用该 Host 实例固定的组合配置。

最小成功证据是受控 Deferred 测试先在原实现复现迟到成功、迟到失败、Transport seed/watch 污染和 descriptor 撕裂，再在修复后通过；生产 `composeCore` → controller → transport → sync 的重建测试接受真实新代际的较低 revision。完整闭环以 `Closes #218` 交付，但只有验收表全部成立后才能声称满足本计划；自动化测试不代替 #143 的真实 Desktop/模型验收或人类规划接受。

## Context and Orientation

本次调查检出为分支 `fix/client-snapshot-ordering` 的工作树 `.worktrees/client-snapshot-ordering`。2026-10-28 09:13 SGT 的只读观察基线为 `4be26d55e7d921676b79ad5abc1bbc2b2a4b71cc`，与当时 `main` 一致；开始实施前重新回读，不能把这个历史 SHA 当作当前远端 head。Git common dir、工作树清洁状态和 `.worktrees/` 忽略规则已核对，依赖已安装。

`revision` 是同一工作区存储中的业务修订；`generation` 在本计划中明确表示 Host 出版者实例身份，使用不透明非空字符串。它与 `RemoteStream` 的数字物理连接代号不同：物理重连不会使 Host 的旧 revision 变成新事实。`lastUpdatedAt` 是客户端接受当前值的时间，`source.reconciledAt` 是 Host 已提交来源确认时间，两者保持现有语义。

现状事实：`sync.ts` 已拒绝没有新代际证据的低 revision 基线；reconnect 已立即 stale，当前失败已保留最后值、头与时间。缺口在于 `guarded()` 无请求失效检查，迟到成功会复活连接，迟到异常会 `lose()` 较新的成功连接。`transport.ts` 在每个基线请求结算后无条件替换 seed 并关闭 watch，close 也不作废在途请求。现有数字 generation 仅是客户端可选扩展与人工夹具，生产 wire 没有发布者。

#412 已用 `getPlanningSnapshot()` 的单一 Storage transaction 读出 Planning triple（views、sync、revision），其中 views 包含 primary identities；Fake/SQLite 并发屏障已证明它。Controller 仍另读 `getWorkspaceMetadata()`。已完成计划的 Design / Spec 明确只承诺 Planning triple，不承诺 registry/config 全系统原子快照。#218 的 2026-10-16 评论将 Core 半边移到 #361，2026-10-27 disposition 要求复现剩余问题、去掉重复工作；但没有明确删除 2026-10-09 的 descriptor/authority 一致读验收。因此本计划保留该验收，补齐已有事务里的存储元数据，不能声称 #412 已证明所有 metadata 一致。

Project #10 的当前迭代 8 是 2026-10-26 至 2026-11-01，#218 在迭代 9（2026-11-02 至 2026-11-08）为 P0；这是计划优先级，不表示它已成为当前迭代任务。#143 的真实宿主验收仍是需要人类参与的关键路径。本批推进准备与工程交付，不自行写 Project `Status` 或阻塞关系。

实施假设是现有 Host 的存储/组合重建会创建新 CoreApi 对象，而同 Core 的 controller 包装与物理重连继续使用同一对象；Batch 2 必须用生产装配测试验证，若不成立先修正代际所有权，不用客户端随机数掩盖。最高风险未知是 required header 的手写消费者遗漏；先以定位清单和窄回归约束扩散，再跑完整 verify。

## Design / Spec

采用一个完整闭环，状态拥有者保持在原层：controller 为每个 `CoreApi` 对象分配一个实例 token，Core 在既有事务内组装本地快照，client 决定当前请求是否仍有接受权，Transport 只让当前请求发布 seed/watch。没有第二份工作项缓存或新调度平台。

**Host 代际与 wire。** `createControllerQueries` 所在模块用私有 `WeakMap<CoreApi, string>` 和 `globalThis.crypto.randomUUID()` 为同一个 Core 对象只分配一次 token；同 Core 创建多个 controller 仍同 token，新 `composeCore` 或 `unavailableCore` 对象才有新 token。token 不持久化、不按大小比较、不由客户端或重连次数制造。`WireWorkspaceHeader.generation` 是 required 非空 opaque string，`toWireSnapshot`、`diffSnapshots`、`toWireMetadata` 全程透传，store 的 metadata allowed keys 加入它，`assertHeader` 在 store/clock/head 改变前校验。迁移现有夹具，不保留数字、缺省或旧帧兼容分支。

同 generation 的 baseline 不得降低 revision；不同 generation 仅能通过 baseline 建立新的状态基线，允许更低 revision。delta/metadata 必须与当前 generation 完全相等。watch 在 revision、业务签名和来源签名比较前发现 generation 不同就发 gap，不能在同 revision 判 idle，也不能在较高 revision 生成跨代 delta。下一代开场 baseline 建立新代际。现有 push 消费者继续负责每个物理代唯一 baseline 与 close 吸收态，不增加通用流调度或数字代号适配器。

**唯一请求 fence。** sync 使用一个递增 operation ticket 表达当前异步接受权；connect/reconnect/新 poll 开始、disconnect 及成功的公开 `receive()` 都使此前 pull ticket 失效。同一生命周期内 poll 只保留一个在途 Promise，并发调用原样返回它，按 Promise identity 清槽；reconnect/disconnect 脱离旧槽，使旧结算不能清掉新槽。这个局部单飞只防止未发布的并发 poll 先消费 watch 游标，不负责流重试或调度。内部 poll 复用一个私有 apply helper，不能调用会自行作废 ticket 的公开 receive。每个 await 后先比较 ticket，再进入唯一 `accept`；gap 回调返回后和重拉基线前再比较，以覆盖 onGap 内断开。connect/reconnect 在 await 前同步 stale。新请求开始即作废旧请求，所以较新请求真实失败后，较旧成功也不能复活连接，不另叠 accepted-sequence 或第二套 scheduler。

过期成功和过期失败都作为内部取消结算为 `{ kind: 'idle', revision: store.revision, reason: undefined }`，不得读确认时钟、调用 `lose()`、改 rows/header/time 或造成功报告。仍持有 ticket 的传输异常按现有合同 `lose()` 并 reject；当前被拒绝帧保留原子拒绝语义。有效公开 receive 完成后推进 ticket、脱离旧 poll 槽并关闭可复用的 Transport watch/seed；较新的同 revision metadata 或 redacted baseline 因此也能作废旧异步回写，下次 pull 按当前 store 游标重建，避免丢弃旧 poll 后留下已前进的 watch 游标。拒绝帧不关闭 Transport。公开 receive 是流消费者的同步入口；调用方仍须遵守物理代 baseline 开场与关闭规则。

**Transport 发布 fence。** fetchBaseline 开始时递增私有 ticket，close 同样递增；await 返回后只有当前 ticket 能发布 snapshot、关闭旧 watch 和建立后续 seed。过期请求仍可将自己的结果结算给 sync，但不能改变 Transport。close 清 seed；poll 捕获具体 watch，若它在 await 中被 close/替换，则返回 undefined，不发布过期事件。sync 的 fence 与 Transport 的 fence 分别保护不同所有者的状态，不依赖 IO 中止一定成功。

**完整本地快照。** `getPlanningSnapshot()` 的返回值增加 `metadata`，在当前同一个 transaction 中调用 `workspaceMetadata(context, tx)`；`workspaceMetadata` 与 `repositoryMetadata` 显式接受 `StorageTransaction`，默认值仅供独立公开查询使用。getWorkspace、listRepositories、repositoryReferences 与 routeDevelopment 的 storage 都使用 tx。路由只构造 `{ workspaceId, registry, storage: tx }`，不改路由算法，不用 `as CoreContext` 伪造上下文，也不在事务里调用根 Storage 或嵌套 transaction。Controller 一次 Core read 组 wire，不再追加 metadata read；unavailable Core 返回对应空 metadata。authority 与 registry 是本 Core 实例固定组合配置；projectTitle 在 bootstrap 中更新，仍按既有内存显示名语义读取，不承诺它与存储提交原子一致。不另宣称全部 metadata、外部 Provider、运行时 registry 写者或所有配置的分布式 ACID；本 audit 的一致边界是 Planning triple、存储 descriptor/引用与固定 authority。

不变量是 Host 唯一权威、规划与工程状态正交、无 React/Provider 依赖倒置；拒绝帧完全不改变已接受状态；redaction 不通过旧缓存补回 title/body/external id/planningFields；确认时间只跟随现有 freshness 规则；业务 revision 在同代单调。

放弃只加 disconnect 布尔值，因为旧失败和 Transport 副作用仍存在；放弃仅 `revision >= current`，因为真实重建可以降低 revision；放弃物理连接数字作 Host 证据，因为普通重连会变化；放弃持久化 epoch/迁移，因为对象生命周期足以描述现有 Host 重建；放弃所有 metadata/registry 的新聚合平台，只把现有本地事务补完整。原先“采用纯 client 范围并用 Refs 保留 #218”的候选被完整 issue 交付目标和未明确撤销的 audit AC 推翻，Superseded by 本节完整本地快照决策（2026-10-28）。

一次来源研究：2026-10-28 读取 [React 官方 useEffect 文档的 Fetching data with Effects](https://react.dev/reference/react/useEffect#fetching-data-with-effects)，其 cleanup/ignore 示例说明响应到达次序可能与发送次序不同，因此回写需要检查作用域是否仍有效。此处只借用失效后禁止回写的机制，不引入 React 依赖；generation 的权威定义来自本仓库，不由外部类比证明。web 工具未返回正文，随后以 urllib 直读官方页面确认示例；该研究不算本仓库行为验收。

## Global Constraints

全任务只由一个实现 owner 修改下表允许集；根会话串行集成，不在同一架构单元分派并行写者。文件集合仅在这里声明一次；若发现 required header 的另一夹具消费者，先记录实际失败与路径，再更新本节和预算。

| 所有权组 | 唯一允许文件集合 | 预计改动行（A+D） |
|---|---|---:|
| 客户端状态 | `packages/client/src/sync.ts`、`packages/client/src/transport.ts`、`packages/client/src/workspace-read.ts`、`packages/client/src/store.ts` | 115–155 |
| Host 代际与组帧 | `packages/controller/src/queries.ts`、`packages/controller/src/wire.ts`、`packages/controller/src/watch.ts` | 45–65 |
| 既有本地读域 | `packages/core/src/queries.ts`、`packages/core/src/context.ts` | 25–40 |
| 判别与回归 | `tests/e2e/client-sync.test.js`、`tests/e2e/workspace-read-assembly.test.js`、`tests/e2e/client-stream.test.js`、`tests/e2e/workspace-stream.test.js`、`tests/integration/planning-snapshot.test.js` | 320–400 |
| required header 的机械夹具 | `tests/fixtures/client-browser.mjs`、`tests/contract/ui-model-presentation.test.js`、`tests/integration/workspace-setup-commands.test.js`、`tests/e2e/repository-routing.test.js`（仅顶层帧字段断言）、`tests/integration/harness-plugin-artifact.test.js`、`tests/integration/harness-plugin-setup-client.test.js`、`tests/integration/ui-work-item-detail-read.test.js` | 5–15 |
| 真实 Host 重组协议 | `tests/integration/harness-plugin-host-recomposition.test.js`；`tests/integration/harness-plugin-host-planning-mapping.test.js` 由根会话独占当前代际测试段，避免与 #414 同文件并行写入 | 30–45 |
| 文档 | 本计划及完成时的同名 completed 路径、`docs/README.md` 的最终索引、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` 与 `docs/product/vertical-path.md` 的局部证据订正；`docs/review/pr-433-mmp-review.md` 与 `docs/exec-plan/tech-debt-tracker.md` 的 TD-059 收尾 | 文档总计 <1300 |

代码与测试含夹具目标 510–675 行，硬上限 <800 行，保留至少 124 行评审余量；数值是设计预测，最终用实际 diff 重算。若触及 700 行先压缩重复 setup、参数化相同反例，仍覆盖全部 AC；不得靠删验收、optional 兼容分支、生成测试或移动文件规避计数。不要为 LOC 拆散连续算法。

不改 #194 的 start-work、development-route、request binding 和对应 Storage 写路径，不改 #414 的 SQLite 实现；只消费现有 route 读接口。不新增 Provider/Storage 合同、数据库列/迁移、依赖、UI、Project 状态、blocked-by/blocking 关系或发布门禁。仓库尚未正式发布，required header 一次迁移，零 legacy compatibility。公开面禁本机绝对路径、内部地址和真实凭据；Git 使用 argv/library API，工作树路径先 realpath 核对。允许 draft、TDD、独立验收及 ready；不自行合并 PR 或推 main。

## Plan of Work

所有命令在检出 `fix/client-snapshot-ordering` 的工作树根目录运行；GitHub 命令固定 `-R SingularityKChen/harness-projects`。先用 argv 方式执行根 AGENTS §6 的四个工作区检查，再确认当前分支与计划允许集未被他人写入。

### Batch 1 · 建立可审阅边界与 RED 证据

最小闭环是完整设计、同仓 issue 的 draft PR，以及能区分当前缺陷与既有 guard 的新测试。涉及文件以状态测试和本地快照屏障测试为主，文件边界见 Global Constraints。

先提交本计划，按 `docs/development/workflow.md` 建立 draft，PR 描述写 `Closes #218`、本计划、批次、真实验证和回滚。由主控在 issue 留下 draft 链接并回读双向关联、draft、base、head，确认计划单独提交且 draft 已存在，不把开 draft 当作验收完成。在这一步完成之前不添加 RED 测试或生产代码。随后添加 Deferred/latch 判别测试；所有 latch 在 finally 释放，无真实 sleep。先不改生产代码或把全部夹具切到新 generation，以免协议类型错误掩盖真正 race 的 RED。

    pnpm test:file --test-name-pattern='迟到|过期|重建|descriptor|seed' tests/e2e/client-sync.test.js tests/integration/planning-snapshot.test.js

期望新增用例在旧实现以具体状态断言失败：disconnect 后 late success 复活、旧 failure 断开新成功、旧 fetch 关闭新 watch、descriptor 与 revision 混读；真实新 Core lower-revision 的测试在旧 guard 处拒绝。记录实际测试名、失败断言和命令 exit，不能把既有低 revision guard 的绿色回归算作新 RED。回滚点是撤销本批测试与计划提交，产品行为未变；draft 可保留解释或关闭，不能丢弃他人文件。

### Batch 2 · 同一合同转 GREEN

最小闭环是按 Design / Spec 一次接通 Host generation、完整本地读域和两层 fence。涉及主文件为 `packages/client/src/sync.ts`、`packages/client/src/transport.ts`、`packages/controller/src/queries.ts` 与 `packages/core/src/queries.ts`；其余配套面仅按 Global Constraints 修改。

先实现单一 operation ticket 与 Transport 发布 ticket，再把 generation 和 metadata 透传到唯一接受点及既有 transaction；更新 required header 夹具与人工数字 generation 测试。补全新 Host lower revision、同 Host 重连 guard、同/高 revision watch gap、metadata/delta 同代与完整 redaction 状态断言。使用真实 composeCore/controller 的基线，不手工注入 token 冒充生产证据。

    pnpm test:file tests/e2e/client-sync.test.js tests/e2e/workspace-read-assembly.test.js tests/e2e/client-stream.test.js tests/e2e/workspace-stream.test.js tests/integration/planning-snapshot.test.js tests/e2e/controller-roundtrip.test.js
    node_modules/.bin/tsc --noEmit
    pnpm run boundaries

期望全部 exit 0、无 fail/cancel；每个 RED 的同一断言转 GREEN。Fake 与 SQLite 的 read-scope 屏障均通过，且 tx/root 计数证明 metadata 根读为零。回滚点是整体撤销本批产品与对应合同夹具；不可只撤 publisher 留 required consumer，也不可通过清数据库恢复。

### Batch 3 · 独立验收、发布回读与 ready

最小闭环是当前产品树经过独立审读、最终验证、整理提交与远端回读，形成可供人类评审的完整 PR。本计划跟随实际证据更新，最终成功后按 PLANS 归档并更新索引；本次计划作者仅写计划，尚不执行这些动作。

独立验收者按验收表重查失败路径、状态拥有与 scope；发现问题先补判别反例，再修复并复评。检查实际 A+D 与五类发布面，整理本地 debug/fixup 提交后才最终 push。分支已推送时按 `git-expert-operations` 建 backup ref，用精确 lease；不重写共享 main。

    pnpm verify
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main

期望全部 exit 0；另以 argv 执行 `git diff --check origin/main...HEAD`，期望无输出、exit 0，并重算本计划 <800 code/test 与 <1300 docs 上限。最终 head 的远端 checks 需全部通过；回读 base/head、closingIssuesReferences、mergeStateStatus 和全部 review threads 后才 `gh pr ready`。具体 PR 号在 draft 返回后写入实际证据，不用历史 head/check 值替代回读。回滚是完整 revert 本 PR，不改变数据；人类决定是否合并与是否接受规划完成。

## Validation and Acceptance

| # | 可观察验收 | 判定证据 |
|---|---|---|
| 1 | delayed connect/reconnect baseline 在 disconnect 后无权复活；迟到 poll 的 delta/metadata 同样无效 | client-sync 具名 `迟到基线不能越过 disconnect` 与参数化 pending poll；完整 state、clock 调用数保持，最后值 stale |
| 2 | 较新重连成功后旧 success/exception 都无权改 connected/current/header/time；较新真实失败后旧 success 仍不能复活 | `过期成功与失败不能覆盖新重连`，使用 A/B 两个 Deferred；旧结算 idle，当前失败 reject |
| 3 | 新 redacted 帧或同 revision degraded metadata 后，旧可见基线不能恢复字段或确认时间 | `迟到可见基线不能覆盖遮蔽与新 metadata`，断言 title/body/external id/planningFields 缺席、source/header 保留、时钟不推进 |
| 4 | 普通同 Core 重连代际稳定、低 revision 被拒；真实新 Core 同 workspace 的较低 revision 可接受 | `重建 Host 以真实 generation 接受较低 revision`：两个真实 Core/Storage、生产 controller/transport；另证同 Core 多 wrapper token 相同 |
| 5 | reconnect 发起当刻 stale；当前失败留下最后值、引用与时间和安全 reason | 既有 workspace-read-assembly 命名测试保持 GREEN，补发起当刻断言；不重复宣称旧能力为新修复 |
| 6 | Host 代际进入 baseline/delta/metadata；切代在同/高/低 revision 均不能跨代续传 | workspace-stream 表驱动 gap；新 baseline 后同代 delta/metadata 正常，client-stream 普通物理重连不获得 reset 权限 |
| 7 | 旧 fetch 不换 seed、不 close 新 watch；close 后 pending fetch/poll 不发布 | `过期 Transport seed 不得关闭当前 watch`，观察 seed 对象、close 计数及 poll 返回值；同生命周期并发 poll 是同一 Promise 且只读一次 |
| 8 | views、primary identities、sync、revision、descriptor 与仓库引用是一个本地快照，authority 来自同 controller 固定配置 | 扩 planning-snapshot Fake/SQLite 屏障：排队 writer 改 descriptor、仓库身份/记录与 revision；旧帧全 old、下一帧全 new；根 metadata 读计数 0 |
| 9 | failing bootstrap 不形成“表 degraded 而每行 fresh”的撕裂确认，lastUpdatedAt 不虚增 | 保留 Planning triple 屏障，既有 controller/workspace-read 降级确认测试；新增 descriptor 屏障不得取代原判据 |
| 10 | 当前 required 合同无数字/缺省 adapter、无 React 或反向依赖、无部分状态拒绝 | typecheck、boundaries、相关 fixture 回归、最终 verify 与独立 diff 审读 |

Batch 1 的 name-pattern 只用于先取得最窄 RED；Batch 2 必须执行完整文件集，不能因名称筛选跳过负例。所有“已通过”状态需在 Progress 写实际执行分支、命令与结果后才成立。

## Progress

- [x] (2026-10-28 09:13 SGT) 最终审阅者读根约定、PLANS、开发工作流、issue 全部维护者评论、两个独立方案及关键实现；工作树检查清洁。
- [x] (2026-10-28 09:13 SGT) 收敛单一代际合同、请求/Transport fence 与既有事务 metadata 补齐，保留历史 audit AC；本文件为唯一执行计划。
- [x] (2026-10-28 09:27 SGT) Batch 1 前置：plan-only draft #433 已创建；双向 closing 关联、base/head/draft、标签、assignee、milestone 及 Project ExecPlan/Batch 写入已确认。
- [x] (2026-10-28 09:41 SGT) Batch 1：实际 RED 见 Surprises & Discoveries，既有 lower-revision guard 仍作为回归。
- [x] (2026-10-28 09:41 SGT) Batch 2：主体实现与 required header 迁移，核心窄回归、typecheck、boundaries 转 GREEN；全量发现的真实 Host 消费者继续回归。
- [x] (2026-10-28 SGT) 本地最终验证：在本计划声明的分支工作树执行 `pnpm verify`，typecheck 成功、主套件 2177/2177、MVP 7/7、失败/取消均为 0；`pnpm run boundaries` 9/9、`node scripts/workflow-check.mjs` 无 findings。核心文件集窄回归 88/88、实际扩展消费者 64/64 通过，完整运行态日志保存在本任务 SDD 目录。
- [x] (2026-10-28 10:09 SGT) 独立验收与交付准备完成；最终远端 head/checks/threads/ready 按本计划命令实时核对，不能以本地测试替代。

## Surprises & Discoveries

- 2026-10-28：首轮完整 `pnpm verify` 暴露 7 个失败：required header 的实际消费者迁移与两个旧 Host 重组测试的同代续传假设；路径扩展见 Global Constraints，证据为本分支运行态 `verify.log`。真实新 Core 会使旧流先 gap，再由同一 RemoteStream 句柄重开 baseline；不能保留旧“无 gap”断言。
- RED：11 个时序/发布者用例捕捉到迟到结算和 seed 污染；watch 的同/高 revision 切代分别错误 idle/delta。修正合法身份种子后，Fake 检出 4 次根 metadata 读取，SQLite 检出 old revision 携带 new descriptor。对应运行态日志为 `red.log`、`red-watch.log`、`red-metadata.log`。

观察时刻与检出见 Context and Orientation。原 issue 的低 revision 回退已经被 guard 修掉，新的 RED 必须来自生命周期或真正生产代际，不能复制历史问题。两份独立调查实测迟到基线复活、旧异常使新连接 stale、旧 Transport fetch 关闭新 watch；本计划作者复读源码确认这些无 fence 路径，调查证据本身不算新增测试输出；正式 RED 已记录于本节首段。

metadata 仍在 transaction 外是调查基线的源码事实（Superseded by 本节真实 RED 与 Design / Spec 的 tx 实现，2026-10-28）；方案 A 用真实 controller 观察到 descriptor 已 after、published revision 仍 before 的窗口。#412 的事务结论仅覆盖其声明的 Planning triple，不足以证明 audit 的更大字段面。routeDevelopment 的 `DevelopmentRouteSource` 已接受最小 storage 读面，现有 tx 可直接满足，不需要修改 #194 所属路由实现或新增 Storage API。

required generation 会命中 metadata 的严格 allowed keys 及手写帧头；已定位迁移点纳入唯一文件允许集。新 Core 对象是现有 Host 重建边界，同一 Core 运行中绕开装配直接替换 Storage 不在当前受支持路径，不宣称解决它。

## Decision Log

- 2026-10-28：人类在本轮 #431–#433 评审会话明确要求无 P0/P1 或只有 P2/P3 时“你负责后续：三思后修复 → re-review → 归档 ExecPlan → … → merge_method=rebase 合并”。本 PR 经首轮 APPROVE 后由该评审会话收尾；授权覆盖本 PR，不涉及规划 Status 或依赖改写。审查证据见 `docs/review/pr-433-mmp-review.md`。

- Decision：局部证据矩阵去掉本 issue 已修复的反例，但保留更大产品/发布门的未证实范围。Rationale：独立验收覆盖本闭环，不自动批准 R1、Board 或 #143；历史统计标注观察日期而不冒充当前汇总。Date/Author：2026-10-28 10:09 SGT / 交付协调者。

- Decision：成功 public receive 同时作废 Transport watch/seed；拒绝帧不关闭。Rationale：真实 watch 的补充 RED 证明只丢弃 poll 回写会消费未发布 delta，下一次 pull 仍 idle。生产 createTransport.close 可复用、push-only close 为 no-op，因此无需新接口。Date/Author：2026-10-28 09:50 SGT / 实现 owner 与根会话复核。

- Decision：授权 GitHub 元数据已写入并回读。Rationale：actor `SingularityKChen`，目标同仓 PR #433 / issue #218 与 Project #10，幂等关联键 `delivery-20261028-218`；PR closing 与 issue closedBy 双向一致，未写规划 Status 或依赖。Date/Author：2026-10-28 09:27 SGT / 交付协调者。

- Decision：保留 descriptor/authority audit AC，补齐既有本地事务；PR 使用 Closes #218。Rationale：2026-10-16 将 Core 半边移到 #361，但没有明确撤销 10-09 audit；#412 明确只证明 triple。为了完整交付，增加最小 tx 读面而非静默缩减 AC。Date/Author：2026-10-28 09:13 SGT / 最终计划审阅者，根会话范围裁决。
- Decision：controller 私有 WeakMap 按 Core 对象分配 required opaque generation。Rationale：真实出版者证据不需要 CoreAPI 生命周期字段或持久化迁移；普通 wrapper 和网络重连不改变身份。Date/Author：2026-10-28 09:13 SGT / 最终计划审阅者。
- Decision：sync 用一个 operation ticket，同时表达新请求、断开与较新公开帧的接受权；过期结算 idle。Rationale：覆盖旧失败与较新失败后的旧成功，避免重复 scheduler，取消不伪装成已接受 baseline。Date/Author：2026-10-28 09:13 SGT / 最终计划审阅者。
- Decision：Transport 独立保护 seed/watch 发布，事务 helper 全程传 tx。Rationale：上层拒收无法撤销下层 seed 副作用，根 Storage 入 tx 又可能自等；两者都需要所有者处的局部防线。Date/Author：2026-10-28 09:13 SGT / 最终计划审阅者。
- Decision：不改变迭代、Status、blocked-by/blocking，不自动合并。Rationale：P0 与工程验证不等于规划接受；#143 的真实验收仍由人类参与。Date/Author：2026-10-28 09:13 SGT / 最终计划审阅者。

## Idempotence and Recovery

测试、typecheck、boundaries 和只读回读可重复运行；Deferred/latch 必须 finally 放行，测试清理只关闭本测试资源。对正在完成的旧请求重复断开只会继续作废接受权，保留最后数据，不清库、不重置 revision、不制造 Host 时间。新一轮连接通过真实基线恢复，不借旧 watch seed。

单 PR 的产品/合同/夹具整体回退，无数据迁移或外部 Provider 写入；不能只撤 generation 发布者或绕过校验。在已发布分支整理历史前先建立恢复 ref，精确 lease 必须匹配实际旧远端 head；冲突或他人变更时停止该次 push并重新取证。若预算逼近硬上限，先记录真实 numstat 与覆盖矩阵，压缩相同测试 setup；仍超限就把独立可验收面拆成真实依赖 PR 并更新本计划，不交付超限或不完整关闭。

## Interfaces and Dependencies

依赖 Node >=22、pnpm 10.28.2、现有 Fake/SQLite transaction、CoreApi、controller watch 和 client sync；本地回归无网络、无新凭据。GitHub draft/push/ready 使用当前已认证 actor，外部写入记录目标、actor、结果与返回 PR 号；工具操作遵守项目写入语义，检查不通过不标 ready。

新增命名合同只有 required `WireWorkspaceHeader.generation: string` 与 `getPlanningSnapshot()` 的 metadata 返回值；不新增 capability、Provider 或 Storage 方法。`getWorkspaceMetadata()` 保持独立查询 API；内部 helper 默认根读仅用于这个 API，在 snapshot transaction 内必须显式 tx。`RemoteStream.GenerationItem.generation: number` 保持物理载体含义，与 Host token 无比较关系。

## Outcomes & Retrospective

2026-10-28 MMP 初审 review 5678411493 为 APPROVE，仅 TD-059 文档收尾 P3；该项已移至 Resolved，独立交叉复评纠正一处具名用例归属后无新增问题。本 PR 独占的产品/测试补丁与初审 `5108989` 相同，整树随基线纳入已合并的 #432，3 项文档契约通过。最终 head/base/checks/threads、issue 验收和 rebase merge 的远端收据写在对应 PR/issue，不用本地预期替代 API ack。

2026-10-28 10:09 SGT 实施验收结果：本闭环全部 AC 已完成独立验收，锁定实现 `48624d36` / tree `f1932c6e`；独立执行112 项聚焦测试、9 项边界和7个独立临时探针及类型检查均通过，无待修 P0–P3 或必要重构项。Superseded by `docs/review/pr-433-mmp-review.md` 完整发现清单（2026-10-28）：后续 MMP 评审发现 TD-059 文档收尾 P3，产品根因已由本 PR 解决。实现完整验证为2177主测试加7个MVP，零失败/取消/跳过。组合检出 `test/iteration-8-9-integration` @ `17efb3b` 已无冲突拼合同批三个实现并通过 `pnpm verify`（2224主测试+7MVP）；该组合是本地协同证据，不替代各 PR 的 hosted CI。最终 PR #433 的 head/base/checks/issue/threads/ready 用本计划命令回读，未宣称合并、规划接受或 #143 人类验收完成。

以下阶段回顾保留，Superseded by 本节实施验收结果（2026-10-28）。


主体产品、正式 RED/GREEN 与完整本地 verify 已完成，命令和实际计数见 Progress；独立验收与远端 ready 仍由根会话执行。现阶段不新增技术债：descriptor 窗口已纳入现有事务并由 Fake/SQLite 回归保护，#202 的通用换源和 #143 的真实宿主验收已有 owner；如果实施发现需要延后任何本计划 AC，必须先记录到 `docs/exec-plan/tech-debt-tracker.md` 并撤销完整关闭声明，不能把未完成项藏入回顾。

## Bottom Change Note

Change Note (2026-10-28 09:13 SGT)：最终审阅两份独立方案与现有源码后首次成稿；保留未明确撤销的 audit 一致读验收，采用 Core 实例 opaque generation、单 operation ticket、Transport 发布 fence 与既有事务 metadata 补齐；未实施产品或改 Git。

Change Note (2026-10-28 09:23 SGT)：写后重读修正 projectTitle 可变内存显示名的边界，明确 plan-only draft 和双向关联先于 RED；保留根 PLANS 的 13 个强制章节，不为通用 linter 的异仓章节假设添加重复章节；增加局部 poll 单飞防止过期 poll 消费 watch 游标。

Change Note (2026-10-28 09:27 SGT)：记录 plan-only draft #433 与机械元数据 ack，允许开始 RED；产品验收仍未完成。

Change Note (2026-10-28 09:41 SGT)：记录真实 RED 与完整验证发现的 required header 消费者，扩大机械夹具和真实 Host 协议测试允许集；根会话独占与 #414 共享的 planning-mapping 测试文件。

Change Note (2026-10-28 09:50 SGT)：真实 mixed receive/pull RED 证实旧 watch 游标可吞更新；明确成功 receive 重置可复用 Transport，新增拒绝帧不关闭与结算窗口的判别回归。

Change Note (2026-10-28 SGT)：记录产品冻结后的完整 verify、边界与窄回归通过；本地提交不代表独立验收或远端 ready，计划继续保持 Active 交由根会话收尾。

Change Note (2026-10-28 10:09 SGT)：独立验收通过后归档，补工程证据与父计划/矩阵/索引；公开面与最终远端门仍以当前分支回读为准。

- 2026-10-28：补 MMP 评审与交付授权；仅同步已解决的 TD-059，保持原实现证据与已归档路径。

- 2026-10-28：更新到已合并 #432 的 main 后，固定 pnpm 10.28.2 完整重验 2199+7，通过；5 项归因变异在最终产品树重测并还原，独占产品补丁保持初审内容。
