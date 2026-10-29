# Host 命令身份与 profile 数据根 ExecPlan

> 状态：Completed；创建：2026-10-29（Asia/Singapore）；关联：Closes #423，Refs #338。
> 规范：`PLANS.md`；使用真实宿主调用身份与已解析 profile 路径，保持 typed remote ABI。

## Purpose / Big Picture

客户端伪造 actorRef 不能冒名执行命令；审计和幂等请求身份只使用宿主为本次调用提供的 peer。配置 home 与 tilde 交给官方 launcher，两个 profile 的 SQLite 和工作树彼此隔离；元数据缺失时清楚拒绝，不偷偷回退到共享数据库。

最小成功证据是实际 Cordis+Gateway 经过同一生产 remote 后，可信 peer 写入真实 ledger/fingerprint，伪造 actor 不生效、并发身份不串；两 profile 的临时宿主实测保留独立根及重启/卸载数据。该结果不代表人类账号认证、Desktop/真实模型或父 #338 全部完成。

## Context and Orientation

在分支 `fix/host-command-authority` 工作树根执行（`.worktrees/host-command-authority`）。2026-10-29 基线为 `06d929017c8551e6b106fcbe7651f12ac26e4642`，实施前用 `git rev-parse HEAD`、`gh issue view 423 -R SingularityKChen/harness-projects --json state,body` 重核。

`apps/harness-plugin/src/host.ts` 目前手算 `DSH_HOME` 或 os.homedir，共享 `harness-projects/workspace.sqlite`；`remote.ts` 以普通 ctx.provide 对象和箭头 unary 方法直接接受 wire actorRef。`host-operations.ts` 是唯一参数/strict codec 声明，`host-composition.ts` 将 actor 送入 Controller/Core。`tests/integration/harness-plugin-host-runtime-adapter.test.js` 的假 ctx 与环境根不能证明真实 invocation 或 launcher 路径。

研究固定官方 Harness `0.2.0-rc.2` 的发布包与其 repository `deepseek-ai/deepseek-harness`：`dsh-app-boot/lib/types/profile-context.d.ts` 和 CLI `profile-boot` 公开/提供 `profileContext` 的 `dir`、`home`、`name`；`dsh-home-paths/lib/types/index.d.ts` 的 resolveDshHome/expandHomePath 负责显式配置、环境与 tilde；`dsh-typert-protocol/lib/types/types.d.ts` 的 RemoteInvocation.peer 是本次调用来源。`dsh-api-gateway` prepareInvocation 用 `receiverContext.extend({invocation}).get(service)` 再 Reflect.apply。`dsh-client-connection` 的 OperatorPeer 在 Connection 激活期持有随机 id，Host/Connection 重建后会变化。

独立取证的实际 Cordis package.json 是 **4.0.4**（两设计写 4.0.5，不能沿用）；公开 `lib/types/service.d.ts` 导出 Service.tracker，`utils.d.ts` 导出 Tracker 的 associate/property/noShadow。已执行无仓库写入的实际库探针：plain receiverSame=true、invocation 缺失；public tracker 后 receiverSame=false、读到 trusted peer；真实 TypertRegistry+Gateway strict invoke 也读到显式 peer，provide disposer 撤回成功。这只是运行时机制证据，尚非本仓库生产 remote/Connection/安装件验收。

## Design / Spec

选择 Host-only **public Tracker bridge**：Host 小适配器 import 官方 Service/Tracker，给安装前的 live service 定义 `[Service.tracker]` 元数据 `{property:'ctx',associate:'harnessProjects'}`。remote 本身只依赖窄 decorator/authority 接口，由 Host 注入；不 import Host SDK 或 Node builtin 到共享 descriptor/client 路径。禁止手写 Symbol.for 或复制内部 symbol。普通方法必须是 normal function，以动态 this.ctx 读取 Gateway 的调用级 invocation，不能在启动时捕获 ctx.invocation 或缓存全局 currentActor。

所有 OPERATIONS 中声明 actorRef 的 unary 操作：先按既有 strict codec 解析（非法 wire shape 仍拒绝），然后立即用本次可信 invocation.peer.id 覆盖 parsed.actorRef 为 `{kind:'harness_peer',id:<peer id>}`，再调用 composition/controller。每次只复制 nonempty string primitive；不要求 UUID，以免拒绝合法 PeerId。没有 invocation/peer/合法 id 时抛固定 `HostAuthorityError`（消息不带输入），零 composition command 调用、零持久或 Provider 写；保持现有 Gateway 错误 envelope，不新增 wire 参数或跨方法不一致的“成功结果”。普通业务 Error 在当前 Gateway 会映射 `gateway/internal`，不能只加 code 属性就声称线上返回 permission_denied；测试回读真实 envelope，不新增 RemoteError code。正常真实 Gateway 会提供 invocation，缺失场景另用直接服务边界验证。不回退到客户端、环境、用户名、GitHub viewer、模型凭据或全局 connection.operator。查询和 watch 保留原语义，ABI namespace、descriptor 对象、参数顺序与 JSON codec 不改。

peer 仅代表已被宿主 carrier 接纳的 **Connection 身份**，不是稳定人类账号、权限授予或凭据 principal。实际 invocation.peer 优先，不另从全局 operator 猜测。同一 peer 的 key/intent 重放不因 wire actor 变化而变；Start Work 的新 peer 复用旧 key 按现有耐久 actor-bound fingerprint 明确 conflict、不修改旧 attempt；设置命令只在同一 Controller 实例内以 actor 绑定重放，Host 重建后按 Core 自然键核对结果，不承诺持久 actor 冲突。新连接的新 key 只能按现有上下文读回/恢复语义，不能无条件重做未知外部 create。Host 重启后的旧 key conflict 是有意边界；不新增持久“人”映射来掩盖它。

Host 只消费 launcher 解析的 `profileContext.dir`：要求非空绝对路径、realpath 到实际 profile 目录，数据库位于 `<profileDir>/harness-projects/workspace.sqlite`。worktrees/diagnostics 继续由 composition 从该目录派生。缺失/无效 profile metadata 在打开库前失败，不使用 env/homedir fallback，不按 profile name 重建路径。配置 home/tilde 由官方 helper/launcher先解析；测试证明相互矛盾 env 不覆盖权威 dir。现有单 workspace Demo ID 保持，不引入多 workspace selector。

旧共享 `$DSH_HOME/harness-projects` 不自动搬动、打开、合并、删除或升级；新 profile 路径可能首次为空。说明保留旧库及 worktrees，先停进程备份，再由人类选择新位置重建或明确恢复；不承诺新库接管旧执行。相同 profile 重启沿同路径；稳定 manual issuer key 从原凭据管理器提供，不自动换钥。

选择 public tracker 而非 A 的 Service subclass+child fiber：公开类型和实际 Gateway 反证“metadata 完全内部”的假设；装饰对象保留当前 provide disposer，避免自动注册、双 provide 与新增子 fiber 生命周期。只改身份/根目录，保留现有 remote 拒绝新请求、流取消/排空、注销和 composition close 顺序，不顺带修 #422。若产品集成证明 public bridge 不能满足 pinned runtime，先修订设计并重计生命周期范围，不同时维护两套 installer。

## Global Constraints

精确写集：`apps/harness-plugin/src/host.ts`、`apps/harness-plugin/src/remote.ts`、新 `apps/harness-plugin/src/host-authority.ts`（仅 tracker/peer/profile adapter）、`apps/harness-plugin/package.json`（仅 Cordis peer 声明）、根 `package.json` 与 `pnpm-lock.yaml`（仅可复现真实运行时测试依赖）、新 `tests/integration/harness-plugin-host-authority.test.js`、`tests/integration/harness-plugin-host-runtime-adapter.test.js`、`tests/integration/harness-plugin-artifact.test.js`、`docs/adr/ADR-0013-harness-host-composition.md` 的身份/路径后果补充、`docs/product/demo-install.md` 的当前数据路径及保留/恢复说明、本控制计划与 `docs/README.md` 生命周期索引。主控另授权仅 fixture 更新：`tests/integration/harness-plugin-host-execution.test.js`、`tests/contract/harness-host-remote-adapter.test.js`、`tests/integration/harness-plugin-host-recomposition.test.js`、`tests/integration/harness-plugin-workspace-setup.test.js`、`tests/integration/harness-plugin-host-watch.test.js`、`tests/integration/harness-plugin-host-planning-refresh.test.js`、`tests/fixtures/execution-drawer-browser.mjs`；显式提供模拟可信 invocation/profile，不弱化原断言。

运行时测试精确锁定 `@deepseek-ai/cordis@4.0.4` 及 `dsh-api-gateway`、`dsh-typert-registry`、`dsh-home-paths` 的 `0.2.0-rc.2`，记录 lock integrity 与实际解析版本；只把必需的公开测试包放根 devDependencies，产品使用既有 Cordis peer，不 bundle 第二份 Cordis。不引入完整 dsh 为常规 devDependency、额外 auth 包或浏览器运行时。实际 Host 仍固定官方 `0.2.0-rc.2`，不称 latest。

预计生产 150–220、测试/fixture/配置 280–430，总代码小于 800、文档小于 1300；lock/生成物按仓库政策计数。没有 schema 变化、自动迁移、模型调用、外部高成本对象写或人类验收冒名。保留 Iteration、Status 和原生依赖；本项不关闭 #338/#422。与 #349/#420/指南分离实现，`demo-install.md` 由本项独占、索引由主控协调。

本次授权评审收尾增加文档证据写集 `docs/review/pr-456-mmp-review.md`，不扩展产品实现范围。

## Plan of Work

### Task 1 · Batch 1：在真实宿主 seam 下取得调用 actor 与 profile 根

**最小闭环**：生产 remote 用可信 peer，Host 用真实 profile 数据根，安装与卸载语义保留。**涉及主文件**：`apps/harness-plugin/src/host.ts`、`apps/harness-plugin/src/remote.ts`。

先提交计划建立 draft PR，关联 #423。写真实 Cordis Context+TypertRegistry+Gateway 的 RED，不用假 getInvocation API：挂生产 strict descriptor，trusted peer A 与 wire forged B 调命令，经真实 composition/Controller 读 ledger/fingerprint；两个 peer barrier 交错各持本身份，same peer 改 wire actor 精确重放、新 peer 旧 key conflict，缺 invocation/peer/非法 id 直接边界拒绝且零写。测试不能自己为产品服务塞 root invocation 后宣称 Gateway 证明。

profile RED 使用真实临时目录和官方 helper 解析的 dir，两个同 home profile 建独立库、重开不混用、与 env 冲突仍取权威 dir；missing/relative/nonexistent metadata 在开库前失败且旧共享根无新增。实现 Host-only bridge、normal receivers、actor override 和 dir 准入，更新必要 fixture/ADR/安装说明。保留原安装历史记录，只追加新证据与当前路径。

在本任务工作树根记录 head，先执行第一条以捕获行为断言 RED，再实现转绿；随后一次边界/完整验证：

```sh
pnpm test:file tests/integration/harness-plugin-host-authority.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js tests/integration/harness-plugin-artifact.test.js tests/integration/workspace-setup-commands.test.js
pnpm run typecheck
pnpm run boundaries
pnpm verify
pnpm --filter @harness-projects/app-harness-plugin pack:plugin
shasum -a 256 apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.1.0-demo.1.tgz
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
```

期望新真实-runtime用例非零、全部通过，artifact 保持 namespace/descriptors/manifest ABI，client 无新 Host/Node import，类型/边界/verify 退出 0；新 tgz 记录新摘要，不复用旧历史 hash。disclosure 无发现、size code<800/docs<1300、diff 无错误；人工五类目与文档链接独立检查。导入/版本安装失败不算 RED，真实 Gateway 不能只用 receiverContext.extend 模拟替代。

**临时宿主观察为本项验收的一部分**：按 `docs/product/demo-install.md` 的固定 CLI、安全 documents overlay 与 artifact-only 方法，用两个隔离 profile；回读实际 profileContext.dir/config 与新数据库/worktrees 根。同 profile 停止/重启后数据仍在，两 profile 不读彼此；在真实 Connection/Gateway 发起无模型、无外部写的本地 createWorkspace，合法 wire 伪造 actor 后核对同一 Connection 的重放和跨 Connection 冲突，确认 actual OperatorPeer；createWorkspace 只写自然键事实、不写耐久 actor 账本，耐久 fingerprint 证据由真实 StartWork composition+Gateway 集成测试提供。记录 Connection 重建 actor 变化及设置自然键读回；耐久旧 key conflict 由独立的 Start Work Gateway 集成证明。卸载/重启保留库和仓库，remote 撤回。若 launcher profile 只能由单一 web 映射，先用官方 profile 命令复制/创建第二隔离 profile，不手改 launcher内部；命令与有效配置实际输出追加本计划，无法取得该观察时本项保持未验收。

只开本机 loopback、只用临时 owned 进程/目录，不输出会话 access URL/凭据/绝对机器路径到公开面；不配模型不发 prompt。临时记录可用 profile 占位符及相对 artifact 路径，公开前脱敏。此宿主观察可复用真实 Gateway 测试的确切命令/参数，但必须经过实际 Connection admission；direct gateway.invoke 的手工 peer fixture 单独标为集成证据。

整理计划和实现提交，最终 push 后回读 `gh pr view -R SingularityKChen/harness-projects --json number,headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup,isDraft`、`gh pr checks -R SingularityKChen/harness-projects` 与全部 review threads；独立安全复评及最终当前 checks 满足才 ready，不合并。完成计划移 completed 并修索引。**回滚**：revert actor/root 变更时停宿主，明确选择匹配旧 artifact 的原共享库；新 profile 库保留，绝不移动合并或让两个宿主同时打开同库。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 实际 peer 权威 | 生产 remote+真 Gateway 命令持久 actor 为可信 peer，合法伪造 actor 不进 ledger/fingerprint |
| 并发与重放 | 双 peer barrier 不串；same peer 同 intent 重放，新 peer 旧 key conflict 且旧事实不变 |
| fail closed 与 ABI | 缺 peer 拒绝且零写；strict wire/descriptor/namespace 保留；client 无新 Host import；卸载 drain 保留 |
| profile 权威 | 官方 helper/launcher 的 configured/tilde home 后 dir 生效；两 profile 独立、同 profile 重启保留，env 不能覆盖 |
| 真实宿主 | 精确 host/Cordis/artifact 身份、Connection actor、profile/config/data-root 与卸载记录；无模型和外部写 |
| 交付 | RED→GREEN、本地完整/边界与远端最终 head 分开、公开面/规模与独立复评 |

## Progress

- [x] (2026-10-29 +08) 本地闭环及独立最终验收完成；最终远端发布门按本计划回读命令执行，不把本地结果冒充 hosted CI。

- [x] (2026-10-29 +08) 独立读取两设计、live #423 和当前 Host/remote；核实 public Tracker、实际 Cordis 4.0.4 与 Gateway 原型探针。
- [x] (2026-10-29 +08) 已有 draft PR #456 与计划提交 `6c432b0`；生产 Gateway/Host 的伪造 actor 与并发指纹真实 RED，修复后新增五项全部 GREEN；现有聚焦 74 项、typecheck、boundaries 9 项通过。完整 `pnpm verify` 读回 2464 项与 MVP 7 项通过；后续测试仅为 barrier 的 finally 释放补强，重跑该五项仍通过。
- [x] (2026-10-29 +08) 两 profile 的官方 CLI/Connection 实际观察完成；同 profile 重启保留、peer 改变、两 profile 独立，伪造 actor 变更不影响同连接重放；无认证请求 401。两 profile 卸载后认证入口 404、库保留；所有 owned Host 正常 SIGTERM 停止，临时观察层不再参与有效配置。
- [x] (2026-10-29 +08) 独立完整复评和生命周期索引完成；主控已推送候选 `303e164f7066`，回读当前 head/base、双向 #423 关联、全部线程和 hosted CI，PR Fast Gate、Merge Gate、CodeQL、规则/issue 检查通过。发布本记录后继续对新 head 重读才 ready；实施者未做外部写入，未合并，无新 Demo/UAT 裁决。

## Surprises & Discoveries

2026-10-29：首轮新测试真实记录伪造 `[human, forged-owner]` 而不是实际 peer；缺 invocation 的创建也未拒绝。改代码后真实断言转绿。测试挂起已隔离为同一 Node test 内重复模拟整个 process.env 的 teardown：无活动资源、fixture 已删除而 hook 未结束；只在需要验证 env 冲突的单个用例模拟一次即可，无生产或超时调整。worktrees 目录按绑定惰性建立，空 profile 不应承诺目录已存在；真正 Start Work 的工作树路径另断言落在该 profile 插件目录。

2026-10-29：官方 CLI plugin add 首次遇到已知 pnpm launcher ENOEXEC，按安装指南仅为 owned 运行目录加入 shell 转接器，未改全局工具、兼容绕过或用户 profile。实际运行 Home 使用 tilde 拼写，最终 profileContext.dir 已规范化；独立临时只读 observer 只记录 profileDir/profileName/OperatorPeer id，不进入产物。

2026-10-29：实际 createWorkspace 是自然键 create-or-verify，actor 仅参与 Controller 进程内重放，不存在持久 mutation_attempt。按主控明确授权修订真实 Web 观察为 Connection 重放/冲突、profile 持久事实；耐久 actor/fingerprint 由 StartWork 生产 composition/Gateway 测试证明，不扩大 Core/schema。安装依赖时发现该工作树由 pnpm 11.25.0 建立，使用同版本本地工具、禁 lifecycle scripts，不改全局配置。

普通对象即使改 normal function 仍 receiverSame，无法读调用 invocation；要有 public tracker。A 认为 metadata 完全内部的理由被公开 d.ts 与真实 Gateway 探针推翻，subclass 会立即注册并扩大生命周期范围。两稿标 4.0.5，但本评审实际 package.json 是 4.0.4，必须锁真实依赖。OperatorPeer 不是稳定人；改变 Host 实例可使同 key actor fingerprint 冲突。当前共享根改 profile 根会看到空库，不能无声移动数据掩盖这一行为。

Gateway rpcFailure 只识别官方 RemoteError 结构，其余错误变 gateway/internal；两稿的“结构化 permission_denied”不能不经真实 envelope 检查直接承诺。本任务以固定失败、零 command/write 为安全条件，不扩大错误词表。

## Decision Log

- Decision：主控授权安装观察使用 owned 临时只读 Host observer，明确与交付 artifact 和集成夹具分开。Rationale：产品无审计导出接口，不为测试新增产品端点；仅记录实际 profile 根与 Connection peer，观察后撤回配置并保留证据。Date/Author：2026-10-29 +08 / 主控授权、实施者记录。

- Decision：主控授权 Global Constraints 中列出的精确 fixture 扩展。Rationale：旧直接 remote 测试没有调用身份，新增真实 Gateway 用例独立证明 authority；旧测试仅补显式上下文，无产品 fallback。Date/Author：2026-10-29 +08 / 主控授权、实施者记录。

- Decision：用户选择 #423 提前实施，保留 Iteration/Status/原生边。Rationale：授权执行不篡位规划。Date/Author：2026-10-29 +08 / 主控转达、综合评审者记录。
- Decision：保留两原稿独立；采用 B public Tracker bridge 而非 A subclass child fiber，normal method 从本次 this.ctx.invocation.peer 取值。Rationale：公开 Tracker/Service.tracker 与实际 Cordis+Gateway 实验支持，现 disposer 更小；不依赖 raw symbol。Date/Author：2026-10-29 +08 / 独立综合评审者。
- Decision：actor 为 harness_peer/actual peer id，重启同 key conflict 有意保留；路径只取 profileContext.dir 且缺失失败。Rationale：符合真实 Connection 寿命和 launcher 配置权威，不新增人类身份体系或第二路径解析器。Date/Author：2026-10-29 +08 / 独立综合评审者。
- Decision：主要研究来源为官方 npm 固定版本包和其公开 repository `https://github.com/deepseek-ai/deepseek-harness` 的 `vendor/cordis`、`packages/api/gateway`、`packages/typert/protocol`、`packages/util/home-paths` 与 `apps/cli`；可复现测试依赖及 integrity 入 lock。Rationale：不以本机缓存路径作为公开依据，不泛称 latest。Date/Author：2026-10-29 +08 / 独立综合评审者。

- Decision：外部写入 actor 为 SingularityKChen，目标为本仓 issue #423、GitHub Project #10 和 PR #456；关联键 `iteration-delivery-20261029:tracking-v1`。draft、Closes/反向关闭引用、milestone、标签、assignee 及 ExecPlan/Batch 已 ack/回读；原 Status、Iteration、blocked-by/blocking 未写。Rationale：工程跟踪与规划验收分离。Date/Author：2026-10-29 +08 / 主控记录。

- Decision：2026-10-29 用户在本会话直接授权评审 PR #445、#454–#456，且无 P0/P1 时“你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并”。本 PR #456 首轮完整评审无新增缺陷，故主控接手该分支的提交整理、最终复评和有界 issue 收尾；不重复请求 owner/merge 批准。Rationale：这是覆盖本 PR 的本次人类直接授权，优先于评审手册的默认逐次询问；有未修复 P0/P1 则不合并。原计划已经 Completed，本轮保留归档并将证据放入 `docs/review/pr-456-mmp-review.md`。Date/Author：2026-10-29 / 主控记录。

## Idempotence and Recovery

Start Work 的幂等性仍由 Core 耐久首请求 fingerprint 负责，设置命令由进程内 replay 与 Core 自然键负责；Host 只替换 actor。同一 peer 不重复创建，耐久 key 的新 peer 冲突先读结果，不自动换 key。临时 profile 可重复新建，数据根或恢复失败保留原件和日志，停止 owned Host 后再检查。回滚不复制库跨 profile，也不生成新 issuer key。必须清理的仅 owned 临时进程/浏览器，目录保留证据，不做破坏性清理。

## Interfaces and Dependencies

Host-only adapter 接 public Service.tracker/Tracker 与 profile facts；remote 保持 browser-safe 窄接口，commands 经既有 composition。不修改 Controller/Core actor idempotency或 schema。正式依赖由 package/lock 管理，不引用本机 npm cache。技术债按 `docs/exec-plan/tech-debt-tracker.md`；未完成实际宿主观察不能标债后关闭本项，#422 仍独立承担其生命周期验收。

## Outcomes & Retrospective

最终本地验收：2464/2464 + MVP-0 7/7；新真实运行时用例 5/5；边界 9/9，类型检查通过。最终仅测试清理和文档变化后重跑 5/5。 独立完整审读通过；另行复跑 5/5，核对公开运行时、依赖完整性、产物摘要及真实双 Web profile/Connection/重启/卸载记录。 原始实现/复评观察绑定的候选为 `b8f82a82e214`；之后只整理本计划生命周期、导航和文字引用，产品代码及测试未变。没有新增技术债；既有恢复/外部执行问题保持原 issue 和 tracker 边界。最终远端 head/base/checks/双向关联/全部线程以 `gh pr view 456 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup,isDraft` 及检查面板回读为准，满足门禁才 ready。


实现采用 Host-only public tracker、动态 receiver 与即时 actor 覆盖、profileContext.dir realpath 准入。生产 wire namespace/参数/codec 不变；没有新 Core/schema、账号身份或兼容迁移。根 devDependencies 精确锁 Cordis 4.0.4、Gateway/Registry/home-paths 0.2.0-rc.2；解析版本与 sha512 integrity 在 `pnpm-lock.yaml` 各同名 packages.resolution 中可回读。实际官方 CLI runtime Cordis 也是 4.0.4。安装使用局部 pnpm 11.25.0 `--pm-on-fail=ignore`、禁 scripts，与原工作树 v11 store 一致；不改 packageManager 合约或全局配置。

在检出 `fix/host-command-authority` 的工作树根，代码基于计划 head `6c432b0`：真实 RED 为 actor 指纹/并发身份错误及缺身份未拒绝；GREEN 五项包括重建后耐久 conflict、invalid peer 固定错误经 Gateway 编为 `gateway/internal`、profile/env/tilde。聚焦旧链路 74 项、typecheck、boundaries 9 项通过，完整 verify 为 2464/2464 与 MVP 7/7；均为本地证据，最终远端 checks 尚由主控回读。

打包命令与 SHA-256 依 Plan of Work，实际产物摘要 `3b704750efebb01a660f8604a13417ac00ace87d546d67834f28fba2d81ba308`；之后仅修改测试/文档，交付字节未变。实际官方 CLI 命令为 `dsh --profile authority-one --from-default-profile web --dump-config`、对应 `plugin --profile <profile> add <artifact>`、带安装指南 documents overlay 的 `dsh --profile <profile> --patch <overlay> --no-open --port 0`；第二 profile 为 authority-two。只用 owned scratch、loopback 与浏览器 cookie admission，经 `/api/harnessProjects/createWorkspace` 发本地请求，两个合法伪造 wire actor 的同 intent 都得到相同 local_only；同 key 不同名称 conflict，未认证请求 401。单独 observer 确认实际 profile 根为 `$DSH_HOME/profiles/<profile>`，重启前后 peer 不同；同 profile 原名称保留，第二 profile 原为空。createWorkspace 不保存耐久 actor，重启相同自然键成功是预期，耐久冲突只由 Start Work 集成证明。

撤去 observer overlay，remove 插件并重启后两 profile 认证入口均 404；有效配置无 observer/插件层，SQLite 工作区名称各自保留。用户仓库、原共享库均未打开/移动/删除；没有模型调用、prompt 或真实 GitHub 写入。补充在安装同一产物的 owned profile 上用 `lsof -nP -a -p <owned-pid> -iTCP -sTCP:LISTEN -Fn` 实际回读监听，仅有 `127.0.0.1:<ephemeral-port>`；不是只凭会话 URL 推断。固定 Web runtime 源码默认 loopback，未开放外部网络。所有 owned Host 通过 SIGTERM 正常停止，私有原始 session URL、cookie、路径、peer 等只留 owned 运行证据；公开文档仅可移植路径和范围。独立复评与最终远端 gates 尚待主控，父 #338/#422 未据此完成。 **Superseded by 最终本地验收与 Progress 的候选交付回读（2026-10-29）**；父项边界仍保留。

## Bottom Change Note

- 2026-10-29 +08：在候选的远端代码门通过后记录独立验收/交付回读，清除过时未完成状态并原处标注历史结论；本次仅文档审计，不改产品或测试，新的当前 head 仍需回读。

- 2026-10-29 +08：独立最终验收通过，归档计划、整理导航和外部交付回读规则；仅更新本地完成证据，不代替人类验收或 R1。

- 2026-10-29 +08：按公开类型、源码和真实 Gateway 独立修订两方案；确定 public tracker bridge、Connection actor 寿命、权威 profile 根及无迁移恢复边界。

- 2026-10-29 +08：主控授权纠正 createWorkspace 无持久 actor 账本的证据假设，分开实际 Web 自然键/Connection 观察与 StartWork 耐久指纹测试。

- 2026-10-29 +08：记录真实 RED/GREEN、精确依赖、2464+7 本地验证与双 profile Connection/卸载证据；将设置自然键与 Start Work 耐久身份分开，保留独立复评/远端门。

- 2026-10-29：追加本次人类授权、独立全矩阵评审与收尾证据引用；源代码变异已还原，无未修复新缺陷。
