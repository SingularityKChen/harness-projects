# 在插件创建工作区并连接 GitHub Project ExecPlan

> 状态：Completed · MMP 意见修复与独立复评通过，等待最终远端回读与授权合并
> 创建：2026-10-26
> 范围：issue #131；单工作区设置入口、严格 setup 读取、幂等表单与真实 Harness sandbox 步骤 1–2。
> 上游输入：issue #131、`docs/product/vertical-path.md` §2、#354 的设置 wire；按根 `PLANS.md` 维护。

## Purpose / Big Picture

新用户从空 Host 打开 Harness Projects 即可创建一个工作区，输入 sandbox Project node ID 连接已有 GitHub Project，并进入现有工作项列表。失败时保留输入、给出结构化恢复动作；双击或失联后重试不产生第二工作区。页面区分本地已配置与项目已读回，不能显示未确认 Saved。

成功的最小证据有两层：离线真实 SQLite/remote/client/UI 链路的判别测试；从构建 tarball 装入受支持的真实 Harness，在其页面实际完成步骤 1–2，记录到 #124 的脱敏证据。fake ctx、SSR 或 browser bundle 执行都不能代替宿主内 S3。

## Context and Orientation

`apps/harness-plugin/src/client.ts` 目前只挂 WorkItemApp/watch；`packages/client/src/sync.ts` 在没有 workspace descriptor 时 read 返回 undefined。空库、载体未到与项目尚未绑定不是同一状态，不能用无限 loading 或缺 planningSource 猜测。

#127 的 create/connect/bind 已有本地事务与自然键幂等，成功只报 local_only；#354 提供同一进程 remote、重新装配及 activationError。#277 提供持久映射与 derived/user 来源；单工作区省去多项目 home，库中存在的唯一工作区可以选中继续配置。

本 PR 在 `feature/plugin-workspace-setup`、工作树 `.worktrees/plugin-workspace-setup` 根执行，真实 base 为 #354 分支，父层合并后重定位 main。2026-10-26 源码调查于 `origin/main@d470308`；用 `git rev-parse HEAD`、`git status --short --branch` 回读，不沿用基线 1927+7 通过当作功能证据。

## Design / Spec

方案 A：WorkItemApp 前的单 workspace setup gate，独立 setup read/commands 从 plugin client 注入；UI 只持表单草稿与视图状态。方案 B：把“没有 workspace”扩进整个 baseline/WorkspaceRead/UI 列表模型。选 A：两份设计均推荐，最小改动半径。方案 C 可关闭 modal 叠在 loading 上容易失去空库入口，舍弃。

本 PR 新增无参数 `getWorkspaceSetup()`。它从 Host 固定 scope 的 SQLite 配置及当前活动装配读取，不能要求已有 WorkspaceRead；所有读取经过 #354 的 transition barrier/fence。返回严格 DTO：

    WorkspaceSetupDTO = {
      workspace: null | { id: string, name: string },
      planning: { state: 'unbound'|'configured'|'confirmed'|'degraded', bindingId?: string, projectNodeId?: string },
      mappingOrigin?: 'derived'|'user', activationError?: ProjectError, error?: ProjectError
    }

workspace descriptor 来自实际工作区行。无启用 planning 挂载为 unbound；配置与当前活动 fingerprint 不匹配为 configured，不能报连接成功；匹配且完整规划轮确认成功为 confirmed，失败/缺口为 degraded。只把已知 ProjectErrorCode 转固定安全 ProjectError，未知原因归 unavailable，不回显 raw exception。projectNodeId 是 allowlist 的非秘密寻址字段，其余账号、句柄、Provider configuration 原对象不出 wire。

消费 #354 四个精确位置参数：`createWorkspace(actorRef,key,name)`；`connectAccount(actorRef,key)`；`bindPlanningSource(actorRef,key,accountId,projectNodeId)`；`bindRepository(actorRef,key,repositoryId,references)`，本页仅前三项。Host 已补 workspaceId/ProviderAuthoritative、GitHub 实现/origin/句柄；connectAccount 在 Host GET /user 取得真实 node_id/login，UI 不填、猜或伪造账号 identity，也不提供 token 输入框。

四操作结果是既有 `CommandResult<T>` 加可选 activationError；Gateway RemoteResult 是外层信封，client 先解包后严格验证字段/enum/scope。create value={workspaceId}，connectAccount value={accountId}，bind value={bindingId}；返回错误或 activationError 都不能生成本地假 descriptor。

表单提交模型放 React-free client 中：create/connect 各持一个完整 intent（本次用户目的）及稳定 root key，account/bind 子键从它派生。pending 的同 payload 调用共享 Promise；网络未知结果后的重试复用键；只有用户明确修改有效 payload 才开始新 root intent。仅有已校验合法 error 的 inner failed/conflict，为下一次用户显式提交推进失败阶段的 attempt 子键；pending/unknown、畸形响应、outer throw 与 local_only+activationError 保原键。每次 connect 重试仍调用成功 account 的同一子键，让 Host GET /user 核对完整 viewer 指纹，不能用 client 缓存 accountId 跳过它。

连接步骤固定为 connectAccount→bindPlanningSource→getWorkspaceSetup；账号已提交而绑定失败时账号保留复用，不能称整个向导事务回滚。绑定 local_only 显示“配置已记录，正在读取项目”；activationError 显示“配置已记录，激活失败”，相同 intent 可再次激活。已激活但规划读取失败时重试调用既有 refreshPlanning(actorRef)，再 getWorkspaceSetup，不靠换幂等键重复建对象。

设置状态采用一个小的可订阅 client source，getSnapshot 在两次发布间返回同一不可变对象；UI 通过 props 消费。命令后/显式重试/连接恢复才 refresh，不对每一行 watch delta 发读请求。普通 refresh 与进行中的 mutation 合并为 mutation 最终读回，不提前清 pending；读失败记录来源 read，创建/连接失败记录 create/connect，read 的 retry 只能重读。dispose 后晚响应不得发布、导航或产生 unhandled rejection。UI 不再复制 Host workspace 事实。

Host 返回 null workspace 同时带 error 只表示读失败，不能证明空库；client 归为 read 失败并保留上次已确认 setup，无缓存时仅显示错误与重读入口，不允许进入创建。带真实 scope 的 degraded 规划读取失败仍使用 refreshPlanning→setup read 恢复。

页面状态：初次 setup read 未完成→loading；无 workspace→有 label 的名称表单；创建 read-back 确认→唯一 workspace 摘要与“继续连接项目”；unbound/configured/degraded→项目 ID 表单与具体恢复动作；confirmed 且 workspace watch 已确认同 id→既有列表。尚未收到 watch 时说明正在等待工作项，不用本地对象冒充列表源；列表保留“连接设置”返回入口。

错误按 ProjectError.recovery 映射固定中文动作，覆盖 retry/refresh/reapply/open_provider/fix_permission/manual_execution/none；无自动安全动作的项只说明下一步。保留表单值、原生 label/button、pending 禁用、role=alert/aria-live、阶段替换标题回焦。#278 未提供额外证据前只显示已有结构化分类，不能宣称凭据/权限/不可见三路均已验真。

官方 HTTP 已读 `https://react.dev/reference/react/useSyncExternalStore`：未变化时返回缓存不可变快照；这里采用已有单 source 模式。Harness 官方 `https://deepseek-harness.github.io/deepseek-harness/develop/basic/` 的 inject/effect 支持既有挂载/卸载方式；真实兼容范围仍由包 peer 与宿主内观测共同确认。

## Global Constraints

代码加测试严格小于 800 行，文档严格小于 1300 行，含删除行。预算 client/DTO 约 130、ui-model/UI 约 170、Host read/接线约 70、测试约 300，总约 670，文档约 180；不加多工作区、项目 URL 解析、仓库绑定、通用 settings/表单框架或动画。

唯一文件集合：`packages/client/src/workspace-setup.ts`（新增）、`index.ts`；`packages/ui-model/src/workspace-setup.ts`（新增）、`index.ts`；`packages/ui/src/workspace-setup.ts`（新增）、`work-item-app.ts`、`index.ts`；`apps/harness-plugin/src/client.ts`、`host-composition.ts`、`host-operations.ts`；`tests/contract/ui-workspace-setup.test.js`（新增）、`ui-work-item-app.test.js`；`tests/integration/harness-plugin-workspace-setup.test.js`（新增）、`harness-plugin-artifact.test.js`、`harness-plugin-setup-client.test.js`（新增）；`tests/contract/harness-host-operations.test.js`、`harness-host-remote-adapter.test.js`；`docs/product/vertical-path.md`；本计划、`docs/README.md`、`docs/exec-plan/tech-debt-tracker.md`、`docs/review/pr-404-mmp-review.md`、`docs/review/2026-10-26-pr401-pr404-mmp-review.md`、`docs/review/README.md`。

一个 Host owner 在 #354 完成后顺序编辑两个 Host 文件；另一 owner 可先做 client/ui-model/UI/对应 tests，不并写同文件。测试夹具先冻结上述 DTO/wire，不以 fake 成功升级 S3。禁止写 Status、blocked-by/blocking，任何外部写入分别记录 actor、target、idempotencyKey、结果/回读。

## Plan of Work

### Batch 1 · 独立 setup 读面和幂等 client

**最小闭环**：没有 WorkspaceRead 也能读到 empty，反复提交保留同一 intent。
**涉及文件**：`packages/client/src/workspace-setup.ts`、`apps/harness-plugin/src/host-operations.ts`、`host-composition.ts`。
先 RED：空库可读；create 被拒后 workspace=null；配置与激活态分离；严格 DTO 拒绝 unknown keys/枚举/错误 scope；双击与失联同 payload 重试同键，改 payload 换键；卸载后晚响应被忽略。Host owner 接无参读面，其余 client 可先用同形 double 并行，实现至 GREEN。

    pnpm run test:file tests/integration/harness-plugin-workspace-setup.test.js tests/integration/workspace-setup-commands.test.js
    pnpm run typecheck

期望 RED 先因缺 read/wire/稳定键失败，再全部通过；reject create 时 SQLite 无工作区行。回滚 client/读面不删除已经成功创建的工作区或账号。

### Batch 2 · 页面门与恢复动作

**最小闭环**：真实 client source 通过设置页抵达既有列表，confirmed 之前不显示成功连接。
**涉及文件**：`packages/ui/src/workspace-setup.ts`、`work-item-app.ts`、`apps/harness-plugin/src/client.ts`。
先 RED：无 workspace 显示创建；创建 read-back 后唯一摘要可选；local_only/activationError 不出现 Saved/已连接；账号成功绑定失败后可重试；refresh 读取恢复才转 confirmed；watch id 不匹配不能进入列表；全部 recovery 显示安全固定动作；label、alert、pending 和焦点/输入保留。用真实构建入口保护 browser bundle 不带 Host/Core/Storage。

    pnpm run test:file tests/contract/ui-workspace-setup.test.js tests/contract/ui-work-item-app.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/harness-plugin-setup-client.test.js tests/integration/harness-plugin-artifact.test.js
    pnpm run boundaries
    pnpm --filter @harness-projects/app-harness-plugin pack:plugin
    pnpm verify
    git diff --check

期望所有命令 exit 0，artifact 仍可安装；离线测试即使全绿也仅完成本批。回滚页面及 adapter 即恢复原列表壳，持久配置保留。

### Batch 3 · 真实 Harness sandbox 验收

**最小闭环**：本 PR 的 tarball 在真实宿主页面走通 vertical-path 步骤 1–2。
**涉及文件**：`docs/product/vertical-path.md` 只增加真实证据归属与限制；本计划填写实际结果。运行日志/截图原件留忽略的运行目录，不把本机路径或访问 URL/令牌写入 docs。
先执行并保存版本及 artifact 身份，所有 shell 命令在本分支根运行；变量只指一次性目录，先核对 realpath，不改 HOME/CODEX_HOME：

    pnpm --filter @harness-projects/app-harness-plugin pack:plugin
    shasum -a 256 apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.0.0.tgz
    HP_SETUP_SCRATCH="$(mktemp -d -t hp-workspace-setup)"
    HP_SETUP_TARBALL="$(realpath apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.0.0.tgz)"
    DSH_HOME="$HP_SETUP_SCRATCH/dsh" DSH_TELEMETRY_DISABLED=1 npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh --version
    DSH_HOME="$HP_SETUP_SCRATCH/dsh" DSH_TELEMETRY_DISABLED=1 npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile web add "$HP_SETUP_TARBALL"
    python3 - "$HP_SETUP_SCRATCH" <<'PYSETUP'
    import json, pathlib, sys
    root = pathlib.Path(sys.argv[1]).resolve()
    documents = root / 'documents'
    documents.mkdir()
    overlay = [{'id':'workspace-controller','config':{'documentsDirectory':str(documents),'documentsLookupTimeoutMs':10000}}]
    (root / 'documents.patch.yml').write_text(json.dumps(overlay))
    PYSETUP
    DSH_HOME="$HP_SETUP_SCRATCH/dsh" DSH_TELEMETRY_DISABLED=1 npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh --profile web --patch "$HP_SETUP_SCRATCH/documents.patch.yml" --dump-config > "$HP_SETUP_SCRATCH/effective.yml"
    DSH_HOME="$HP_SETUP_SCRATCH/dsh" DSH_TELEMETRY_DISABLED=1 npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh web --patch "$HP_SETUP_SCRATCH/documents.patch.yml" --no-open --port 0

期望明确回读 0.2.0-rc.2、安装 exit 0、Host ready。本机 dsh 的 0.2.1-rc.2 观察不在当前 peer 支持范围；不得使用 allow-version/accept-risk，固定运行时不可用就标本批未完成。raw 启动 stdout 的鉴权 URL 不打印/提交，只在本机浏览器打开其回环会话。

浏览器首次访问的默认 native workspace 曾在真实 Documents 产生目录（`docs/architecture/harness-host-spike.md` §11.5），DSH_HOME 不代表全文件隔离。上面的 overlay 使用 0.2.0-rc.2 官方包 `@deepseek-ai/dsh-api-workspace-controller/README.md` First-use Workspace 明示的 documentsDirectory 完整路径覆盖；已独立读到该发行版 lib Config 和 initializeDefault 实际传递此值，web bundle 也明示按 id 替换整个 config，所以同时保留 timeout 默认。

打开浏览器前从 effective.yml 只核对 workspace-controller.config.documentsDirectory 的 realpath 等于本 scratch/documents；首次打开后再以只读核对 native workspace registry 与实际 default-workspace 都落该根。若配置未生效即停止 S3，修正受支持 overlay，不改 HOME、不使用版本绕过、不删除真实目录。宿主 CLI/npm 缓存新增不等于 Project 内容写入，记录它的实际边界，不夸大全文件零副作用。

通过宿主 credentials 服务仅在一次性环境配置预置句柄，记录 configured 布尔、不读出值；不提供模型 key、不发 prompt。使用 `docs/architecture/gate-e1-sandbox.md` 登记的已授权 sandbox Project ID，完成：打开 Harness Projects→空表单截图→提交空白名观察拒绝和无行→合法名称双击→read-back 唯一 workspace→输入 Project ID→连接→confirmed/列表截图；全程同一 Host PID，不能重启让配置生效。

最后经同一宿主 remote getWorkspaceSetup 与 SQLite 只读核对：一个工作区、一个 planning binding、真实账号 identity、project ID、匹配 confirmed 状态；核对 GitHub 项目规划字段未变。记录冻结 head、tarball SHA、宿主来源/版本/profile、动作、页面、时间、同 PID、read-back 结果及证据级。web S3 不能升级成 Desktop/真实模型验收。

证据摘要由获准执行者追加 #124，actor 为执行账号、target 为本仓 issue #124，幂等键 `workspace-setup-<head>-sandbox-v1`，发出后回读正文/链接；不改其 Status 或依赖关系。无宿主/凭据/隔离环境则保留 draft、明确本批阻塞，不能用 fake ctx 补写已完成。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 创建可见且可选，拒绝无半成品 | Batch 1 SQLite + Batch 2 唯一工作区摘要 + Batch 3 实点 |
| 失败显示结构化恢复动作 | Batch 2 recovery 矩阵，raw canary 不上屏；额外三路归 #278 |
| 宿主内 sandbox 步骤 1–2 | Batch 3 安装产物/版本/页面/同 PID/remote+SQLite read-back，记录 #124 |
| 双提交只创建一个工作区 | Batch 1 稳定 intent key 与最终行数；Batch 3 实际双击 |
| 配置与外部确认分离 | local_only/activationError/confirmed 的反例，没有未确认 Saved |

本 PR 以 #354 为真实 base，运行 `node scripts/rule-checks.mjs disclosure feature/host-recomposition`、`node scripts/rule-checks.mjs size feature/host-recomposition`，另核本轮 <800/<1300 与五类公开面。父层合并后改 origin/main。最终 push 用 `gh pr view -R SingularityKChen/harness-projects <实际PR号>`、`gh pr checks -R SingularityKChen/harness-projects <实际PR号>` 回读当前 head/base/checks/threads 与 issue #131 双向关联；非默认 base 的 Closes 不自动建链接，必要时经 Development 侧栏显式链接并回读。ready 需要本 PR 最终证据，人类决定合并。

## Progress

- [x] 2026-10-26 MMP：reconcile/read 分类修复先 RED（degraded≠confirmed）后 GREEN；独立复评 70/70、typecheck、最终 8/8 变异精确 KILLED。真实 Host 离线服务恢复后第二次重试 confirmed，后置 setup read 故障仍只重读。原 S3 安装件只对应初评源码，不冒充本修复的实点证据。

- [x] (2026-10-26 16:45 +08) 两份独立方案和空 WorkspaceRead 反例已核对；冻结 setup DTO/四命令 wire 与真实宿主边界，文件集合见 Global Constraints。
- [x] (2026-10-26，Phase 2) Batch 1：Host 无参读面与 client intent 完成；Host owner 真实 RED 5 fail→52/52 GREEN，包含 remote/父重组/setup 命令合同、SQLite、双方向 barrier/fence、激活失败重试、401/未知码降级恢复、同键 viewer 冲突和未知 create 一行。
- [x] (2026-10-26，Phase 1) 独立 React-free setup source、ui-model 与页面门 RED/GREEN：严格 DTO、稳定 intent、账号阶段保留、dispose 晚响应、恢复/输入/焦点行为；相关与展示契约 36/36、typecheck、boundaries 9/9、全量 test 1937/1937、MVP0 7/7 通过。Host 与真实 RemoteResult adapter 留待 #354 接入。
- [x] (2026-10-26，Phase 1 fix wave) 独立前置验收 P2-1/P2-2/P2-3 和 P3-1 已判别修复；真实 controller replay 证明确定失败新阶段 attempt、外层丢响应原键重放；成功账号重试同键再核 viewer。窄套件 44/44、typecheck、boundaries 9/9、diff-check 通过，M4 从 SURVIVED 转 KILLED；未并发重跑完整 verify。
- [x] (2026-10-26) Batch 2：真实 client/Host/SQLite 离线独立验收 PASS，唯一 P3 的 create/旧读竞态已永久化并 scoped 关闭；最终父层完整 typecheck、1983 项与 MVP 7 项及 pack:plugin 通过。
- [x] (2026-10-26，Phase 2) 实际 client adapter RED→GREEN：初挂读一次，真正断线恢复才读，普通 delta 不读；Gateway 解包、精确位置参数、scope 门、executionReader 保留、卸载晚响应均覆盖。UI/model + 真实 apply + artifact 窄套件 71/71、typecheck、boundaries 9/9、pack:plugin 通过；完整 verify 由协调者统一执行，不在此标整批完成。
- [x] (2026-10-26 18:53–18:57 +08) Batch 3：官方 0.2.0-rc.2 web profile 从空库实点走通，typed remote 与只读 SQLite 确认、同 Host 无重启、沙箱前后快照一致；[脱敏记录](https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-6414353137) 已发出并回读。冻结源码候选 `35693c4985d09a1f2dba5a3ef607ee28d3c97f51`；最终交付前核对产品文件 SHA-256 不变。

## Surprises & Discoveries

没有 workspace 时 client read 本来就是 undefined，不能用现有列表的加载屏完成首次设置。账号连接与项目绑定是两笔本地事务，绑定失败后账号存在属可恢复阶段事实。默认 native workspace 的 Documents 附带写入是已观测限制，不能把 DSH_HOME 写成全文件隔离保证。

Phase 1 判别用例暴露：把空草稿写成 `project || Host值` 会让已配置项目无法清空；degraded 没有 error 仍需显式规划重读动作；首次 setup read 失败的 retry 必须重读，不能提交空的连接 intent。三项均先见失败再修复。

Phase 1 首次全量 test 为 1936/1937：`ui-model-presentation` 检出新恢复文案含平台名，违反既有展示层契约。改为不依赖平台的说明后，判别套件 36/36 和全量 1937/1937 均通过；未扩大 ui-model 的依赖边界。

独立验收后新增反例先 RED：重叠 refresh 提前清 pending 并吞 mutation 读回、缓存读失败 retry 错发 connect、unknown/pending/failed/conflict 携 ID 继续 bind、跳过 Host viewer 核对。单 source 读写协调、failure 来源和 local_only 门修复后 GREEN。真实 createSetupCommands 首次确定失败被账本永久重放，显式阶段 attempt 才再次执行 core；外层丢响应则原键返回账本成功且 core 只执行一次。

Phase 2 的实际 client mount 两项测试先因入口仍仅挂原列表而 RED；接 source 后，旧 artifact fixture 缺 setup 读数的列表断言亦 RED。补真实 JSON realm 与 setup wire 后，构建入口同时验证空库可创建、已有 watch 也不能越过 configured 门。实际 Host 结构化 null+error 初版会清缓存并误出创建表单，新增首次/confirmed 缓存负控后在 source 归为 read 失败，避免把无法读取推断为空库。

## Decision Log

- 2026-10-26：人类本会话明确要求无 P0/P1 时由评审方负责修复、独立复评、归档与 rebase 合并 PR #401–#404。原实现会话当前 idle，评审方接手这四个分支的本次非阻塞收尾；不据此改规划 Status 或依赖关系。


D1 · 2026-10-26 16:45 +08 / 独立计划评审者：独立 getWorkspaceSetup 与前置 setup gate。Rationale：空库无需已有 WorkspaceRead，不扩大整个列表领域。

D2 · 同时 / 独立计划评审者：Host GET /user 真实身份，不让 UI 输入账号 ID/token；local_only 与 activationError 只表示本地阶段。Rationale：身份与确认由 Host 所有，避免伪账号与乐观成功。

D3 · 同时 / 独立计划评审者：最少栈 #277→#354→#131，纯 UI/client 先并行、Host 唯一 owner 后接线。Rationale：共享写区域保持顺序，规划 Status/依赖写入没有授权。

D4 · 2026-10-26 / Host 边界复核：confirmed 必须包含 workspace、bindingId 和 projectNodeId；configured/degraded 保留后两项可选。旧配置可能缺少可确认寻址字段，client 保留可恢复状态而不补造 ID；命令成功结果 ID 仍严格校验。对应反例已在 Phase 1 GREEN。

D5 · 2026-10-26 / 前置验收 fix wave：以单 source in-flight 协调读写，明确 read/create/connect 失败来源，只有合法 local_only 才继续设置阶段；重试 connect 不缓存跳过 Host 身份核对。仅确定 inner failed/conflict + 合法 error 推进失败阶段 attempt，成功 account 子键、网络未知及激活失败键保持稳定。依据：新增真实 RED/GREEN 与真实 controller replay；最终 Host 下仍须再次验证 viewer 与 replay 边界。

D6 · 2026-10-26 / Phase 2：实际插件初挂执行 setup read；watch 首次连接与普通帧不重复读，曾连接后 false→true 才触发恢复读，effect 同时取消订阅并 dispose source。Host 结构化 null+error 不作为空库事实，复用 read 失败路径保留缓存；scoped degraded 规划失败仍重读规划。依据：真实 apply 入口、构建 artifact 与 source/UI 负控。

## Idempotence and Recovery

同 intent 保留 root keys，unknown 时重试原阶段键；只有 D5 的已确认失败才准备新阶段 attempt。已有账号/绑定由 Host 自然键/账本找回，每次 connect 仍经过 Host viewer 核对。失败不清空草稿、不新造 workspace，不自动删除 SQLite/真实宿主目录。dispose 吸收晚响应；重装同名同版 tarball 时仅在自己的 scratch profile remove 后 add，避免 pnpm 跳过旧包。

回滚 UI/读面后配置仍留在库中，可由旧 Host 重启使用。#278 三路诊断、#356 仓库 UI、#155 settings、#230 完整安装验收不在此完成；新必需遗留写入 `docs/exec-plan/tech-debt-tracker.md`，真实宿主缺证据不能当技术债务移走验收。

## Interfaces and Dependencies

接口固定为 Design / Spec 中 DTO、既有 CommandResult+activationError 和四设置位置参数；runtime 依赖不新增。受支持 Harness 发行版、已授权 sandbox、credential resolver 与可隔离的 native 工作目录是 Batch 3 的真实前提，不等于离线代码阻塞。

GitHub 非默认 base 链接行为来源已由 HTTP 读回官方 `https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue`。本页不做规划字段写入、关系推断或模型调用。

## Outcomes & Retrospective

离线与真实 Harness Web 两层验收均已执行。Phase 1/2 的历史未观察项已由本节 S3 记录补齐；Desktop、真实模型、网络中断与 #230 完整安装矩阵仍未在本轮观察。

Phase 1 已落地上述独立文件及契约测试，未编辑 Host composition/operations，未接实际 plugin client wire，未执行 S3 或写 #124；这不是 Batch 1/2/3 整体完成。下一步在 #354 父层带入后由 Host owner 接独立读面，UI owner 再接真实 RemoteResult adapter、构建与整体回归。

Phase 2 已实现上一段接线：Host owner 定向 52/52、前端与 artifact 定向 71/71，类型、边界和插件打包通过。两侧均停止改树后交协调者统一完整回归与独立验收。此处为 Phase 2 当时边界（S3 未执行的结论 Superseded by 本节后续 S3 记录，2026-10-26）；最终发布面仍按当前 head 回读。父层既有启动 restore 在 remote 发布前遇损坏旧配置的恢复边界没有在本轮扩改。


S3 实际记录（2026-10-26 18:53–18:57 +08，执行者为协调者）：官方 npm 固定运行时 0.2.0-rc.2、web profile，无版本豁免。检出 `feature/plugin-workspace-setup@35693c4985d09a1f2dba5a3ef607ee28d3c97f51` 构建的 tarball SHA-256 为 `a9b8a71e6b40b5f214dd23f7c90c0930152658beb27061cdc3537d29e909a7c2`；安装后 12 个包文件逐字节匹配。初次安装因本机 pnpm launcher 无 shebang 而 ENOEXEC；只在隔离 runner 的 PATH 放 `/bin/sh` 转接器后成功，未修改全局 pnpm；最终 remove/add 均只作用本次 scratch profile。

真实页面空名称由原生 required 拒绝且工作区行数为 0；合法名称实际双击后只有 1 行，并可从唯一摘要继续连接。连接登记的 Project A 后同一 Host 显示 9 项列表、自动派生映射与当前快照；typed remote `getWorkspaceSetup` 返回 confirmed，只读 SQLite 有 1 工作区/1 启用 planning binding/已提交完整轮，账号 identity 与 live GET /user 相符，仅存凭据句柄。进程 PID 在开始、连接和回读期间保持同一且存活，未重启。16 个字段定义及 9 个条目成员/规划字段的前后规范化快照逐字节相同，SHA-256 `37fe5b017d8188bab83b760d76c5b598dff6763a2e6e9f6cb2899dd8ca97337a`。原生默认工作区 registry 路径与 realpath 均位于隔离 documents 根，未依赖 DSH_HOME 推断。未配置模型 key、未发 prompt。

外部记录 actor 为执行 GitHub 账号、target 为本仓 issue #124、幂等键 `workspace-setup-35693c4985d09a1f2dba5a3ef607ee28d3c97f51-sandbox-v1`，结果与回读见[评论](https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-6414353137)；没有改 Status、依赖、epic 勾选或 issue 状态。截图与原始读回留忽略运行目录，不在 docs 写本机路径、账号、凭据或访问 URL。TD-055 的多工作区/disabled/schema 边界保持 Open；本轮没有新增被接受延期的必需缺口。

独立 S3 证据审计 PASS：reviewer 未代替执行者点击；重新计算 tarball/12 个安装文件、15 个冻结产品文件、同进程、只读 SQLite 与 native registry、前后快照及截图均一致。报告不外推 Desktop、真实模型或完整 #230；离线全部 P2/P3 与最后 scoped P3 已关闭。

## Bottom Change Note

2026-10-26 16:45 +08：综合两份独立设计创建，固定独立 setup 读面、Host 身份发现、幂等阶段和真实支持版本 sandbox 步骤，补 DSH_HOME 对 native workspace 的已知隔离边界。

2026-10-26 Phase 1：记录真实 RED/GREEN、可选 degraded/configured 寻址字段决定和独立 source/UI 验证；Host wire、artifact 最终链路及 inside-host S3 仍待后续阶段，不以离线 green 替代。

2026-10-26 Phase 1 fix wave：完成前置验收三项 P2 和 confirmed 缺字段测试缺口，补来源安全重试、mutation 最终读回、local_only 继续门及最小阶段 attempt；44 项窄验收与 targeted M4 变异通过。最终 Host replay/viewer 和完整回归留 Phase 2。

2026-10-26 18:09 +08：Phase 1 及唯一修复波次独立复评 PASS（44 项、5/5变异）；以父层候选 7687e364 为实现接线基准开始 Phase 2，父层仍在独立验收，最终发布前按最终父head重定位并重验。Host owner独占两个Host源文件与Host协议/SQLite测试；UI owner独占client.ts、front/client source与artifact/client接线测试，ExecPlan仅由UI owner记录本批，避免共享写入。

2026-10-26 Phase 2：汇总 Host 52 项与前端 71 项真实 RED/GREEN，完成 typed Gateway adapter、初挂/恢复/卸载及构建新入口；补 null+error 不构成空库事实的缓存负控。pack/typecheck/boundaries 通过，完整 verify 与 S3 交协调者；本计划仍 Active。

2026-10-26：最终离线独立验收 PASS 后补强唯一 P3 真实 create/旧 setup-read 竞态，永久测试删除 fence 变异精确 KILLED，scoped 复评关闭。工作树停写后保全精确 stash，重定位最终父层 d74212ff；本层 product patch-id 与未跟踪文件哈希保持一致。协调者在 `feature/plugin-workspace-setup` 最终父层产品树运行 `pnpm verify`，typecheck、1983 项和 MVP 7 项通过；正在以该源码构建产物进入 S3。

2026-10-26：记录真实 web S3 的版本、产物、空名/双击/连接/同进程/read-back、原生工作区隔离及沙箱零变化；#124 脱敏评论已回读。保留 #278/#230/Desktop/真实模型证据边界，不改规划事实。

2026-10-26：据离线最终与 scoped PASS、真实 web S3 和独立证据审计完成归档；更新索引及纵向步骤 1–2 的实际边界。最终源码与 S3 候选哈希须一致，只有远端当前 head 通过门禁后才 Ready。

- 2026-10-26 MMP 修复批：已复现刷新规划失败被误归 read，恢复后一次重试只读旧 degraded。选择给 client failure 增 reconcile 类别（替代 UI 按 degraded 猜来源或复用 connect）；真正 setup read 失败仍归 read。先写结构化失败/抛错后恢复的 UI 测试和 degraded 纯读负控，预期旧树因未重新刷新失败；再最小修改 run kind，独立复评后归档。回滚该分类与新增测试即可恢复原行为，不写远端项目。

- 2026-10-26：MMP 非阻塞修复完成独立复评后归档，评审记录纳入 Global Constraints；最终提交与远端证据另行回读，不预写合并结果。
