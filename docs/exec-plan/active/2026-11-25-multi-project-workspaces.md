# 多项目 Host 工作区：目录、打开、创建切换与重开恢复 ExecPlan

> 状态：Active
> 创建：2026-11-25
> 范围：同一 Host/profile 内的多 Project Workspace 能力（#636 的四个 P0 实现叶子 #691–#694），以四个 stacked PR 交付
> 上游输入：`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、`docs/product/board-semantics.md`、issue #636/#691/#692/#693/#694、GitHub Project 10 README「11月25日主目标」

## Purpose / Big Picture

完成后，用户在一个受支持的 Harness Host/profile 里可以：从 Projects Home 看到已保存的全部 Project Workspace（0/1/N 个），显式打开其中一个；创建 A、B 两个项目并在不重启 Host 的前提下 A→B→A 切换；重开 Host 后回到最后成功打开的项目；显式项目/条目链接优先于恢复偏好。任何时刻，旧请求、旧 watch 帧、排队写与低修订快照都不会落到另一个项目，A 的行、设置、权限与执行记录不会被标成 B。

判断成功的最小证据：真实 composed Host + SQLite + client + 浏览器中创建两个项目、打开 B 后页面 header 与行全部属于 B 且 A 的行不出现、切回 A 后仍是 A 的数据；重开组合后恢复到同一项目；旧 peer 在切换后发出的 unary 请求被固定文案拒绝且数据库逐字不变。

## Context and Orientation

**术语**

- **Project Workspace（项目）**：本地 `workspace` 行，拥有稳定 `WorkspaceId`、名称与 `statusPolicy`；同一时刻最多一个启用的 Planning 事实源。它不是远端 GitHub Project，也不是 Host profile 或 List/Board/Timeline 视图。
- **active workspace**：Host composition 当前装配并对外提供读写的那个工作区；它是 Host 状态，不是客户端私有状态。
- **catalogue**：从本地 `workspace` 行派生的只读项目列表；不调用任何 Provider。
- **generation**：每个 Core 装配实例的随机不透明身份（`packages/controller/src/queries.ts` 的 `WeakMap<CoreApi,string>`）；切换装配必然换 generation，watch 以 gap 表达，客户端只允许 baseline 重置 generation。
- **transition**：切换 active workspace 的串行临界区；复用现有 `configure()` 的 tail/barrier/epoch/lease-drain 机制。

**当前状态（main `e7a84328`，2026-11-25）**

- Host 入口固定一个 `WORKSPACE_ID` 常量并传给 `createHostComposition`（`apps/harness-plugin/src/host.ts`）；composition 是私有根、SQLite 与装配的唯一 owner（`apps/harness-plugin/src/host-composition.ts`）。
- `assemble()` 已能按工作区行装配 Core/Controller（工作区行缺失时走 `unavailableCore` 空装配）；`configure()` 已实现 tail 串行、barrier + epoch++、排空旧 lease、原子换 `current`、退休旧装配、失败保留旧装配。
- Storage 只有 `getWorkspace/putWorkspace`，没有枚举；`createWorkspace` 以调用方给的 `workspaceId` 做 create-or-verify，名称不是自然键。
- 每个 Core 装配自动获得新 generation；`watch.ts` 见 generation 变化发 gap，客户端 `stream.restart()` 后以新 baseline 整体替换 store；`sync.ts` 只允许 baseline 重置 generation。
- 客户端 `WorkspaceSetupSource` 已有 create/connect/install 的 intent key 与失败语义；`WorkspaceSetupGate` 是唯一工作区设置门；`WorkItemApp` 的路由 scope 门要求 `route.projectId === read.workspace.id`。
- 真实 gateway 的 unary 与 stream 调用都经 `prepareInvocation` 绑定 `this.ctx.invocation.peer`（`@deepseek-ai/dsh-api-gateway` 的 `prepareInvocation`/`openStream`），因此 stream 侧也能读到 peer。
- 私有数据根只准入固定文件（`workspace.sqlite` 及 sidecar、`diagnostics.log`、`workspace-selection.json`），POSIX 与 Windows 原生 lease 各有一份允许清单。
- 安装态插件没有 URL/route 入口；`apps/web` 只转导出路由 codec。全仓无 `localStorage` 使用。

**相关文件**

见 `Global Constraints` 的完整文件集合；实现时以该集合为唯一清单。

## Design / Spec

### 2026-11-26 MMP 评审后的根因修复设计

首轮发现按归属修复：#695 的两项 P1 分别是任意 unary 追平 peer generation、工作区切换后旧连接意图继续第二步写；#696 的两项 P2 是恢复确认未结算创建意图与创建重试未交接设置页；#697 的三项 P2 是失败深链覆盖手动导航、连续深链目标被旧 pending 吞掉、Windows selection 打开失败泄漏已打开 log fd；#698 保留安装态人验并补执行归属和产物差量证据。

选择单一状态拥有者上的修复：Host 在真正激活/确认的同步发布点关联 invocation 与 generation，普通目录读或失败操作不提升准入；setup source 在收到 workspace+generation 变化时先撤销旧多阶段意图，在每个 await 后验证再发下一步写，已确认账号事实保留。创建意图在被版本栅栏接受且精确匹配 ack 目标的读取上统一结算，UI 统一从确认结果交接；链接解析的异步版本与手动导航明确失效，不把旧 pending 当作新目标已完成。Windows 文件打开维持唯一 fd owner，任何后续打开失败都关闭已经取得的 fd。

被否方案：仅把 generation 更新限制为 transition 名称仍可能在 await 后读到别人的激活；按名称猜测创建完成会破坏同名独立项目；逐个重试按钮补 `.then` 会继续漏确认读恢复；新建客户端 active store 或重做路由扩大权威边界。维持既有 wire ABI 和单一 Host active assembly。

写入 ownership：Host owner 只改 `apps/harness-plugin/src/remote.ts`、`host-composition.ts`、`host-private-data.ts` 及其 Host/privacy 回归；setup owner 只改 `apps/harness-plugin/src/client.ts`、`packages/client/src/workspace-setup.ts`、`packages/ui/src/workspace-setup.ts`、`workspace-link.ts` 及对应客户端/UI 回归。相同架构单元由同一 owner 逐层执行；主会话负责计划/评审证据、验收测试、跨层接合与最终提交。

### 状态拥有者

| 事实 | 唯一 owner | 读取方 |
|---|---|---|
| 工作区存在/名称/策略 | SQLite `workspace` 表（经 Storage 端口） | Host composition、catalogue |
| 当前 active workspace + generation | `HostComposition` 内存 `current` | 所有 unary/watch 派发 |
| 每 peer 已下发 generation | `installHostRemote` 的 `Map<peer, generation>` | unary 准入栅栏 |
| 最后确认选择（导航偏好） | Host composition → 私有根 `workspace-selection.json` | 仅启动恢复 |
| 项目内视图/筛选/草稿 | UI 内存，切换即 reset | 无持久化 |

### 关键决策与取舍

1. **单一 composition + 可切换 active assembly**（否：每项目一个 composition——多写者、生命周期乘数、与 #636 明确否定的 eager 每项目后端冲突；否：每请求带 workspaceId——22 个操作与全部 client reader 的横切 ABI 变更，且与 epoch/lease 机制职责重复）。
2. **Storage 增加只读枚举 `listWorkspaces()`**，直接扫 `workspace` 表并承诺创建序（SQLite `ORDER BY rowid`，Fake 插入序）；不建 catalogue 表/文件（第二事实源），不调 Provider。
3. **create 的 workspaceId 由 wire `idempotencyKey` 确定性派生**（UUID v5 形状——`sha256` 前 16 字节截断后写入版本位 5 与变体位，不是 RFC 9562 的 v5 命名空间 UUID；输入为 `workspace-create:v1:<idempotencyKey>`）；同 key 同名重放零写入、同 key 异名 conflict。派生只用客户端随机意图键，不编码 provider externalId/标题/bindingId，符合 ADR-0010 的 locator 内容规则。create 成功后同一 transition 激活新工作区（create-and-switch），激活失败只作用于本次命令结果（见 Decision Log 11）。**已知边界**：派生 id 没有 profile 命名空间——不同 profile 各自 SQLite、不共享 workspace id，因此同一意图键在两个 profile 里会得到同一 id 但互不可见；ADR-0010 只要求不从 provider 数据或标题派生，不要求跨 profile 唯一。
4. **请求隔离 = 双机制**：remote 的 per-peer delivered-generation 栅栏（挡"切换后到达的旧请求"）+ composition 准入时捕获 assembly（挡"检查后切换"）。没有 watch 记录的调用方（直接 `host.call` 的测试/嵌入方）放行；supported client 必须跟随 watch。
5. **偏好持久化 = 私有根固定文件 `workspace-selection.json`**，格式 `{version:1, workspaceId, confirmedAt}`，启动期由 `preparePrivateProjectData` 打开并做 ACL/nofollow/nlink 校验，运行期只重写该 fd；不新增 SQLite 表（会 bump schema 世代并拒开已安装库），不用 localStorage（多 peer 互相改选、非 Host 权威）。损坏/缺失/目标不可读 → 空装配 + 结构化 restore 状态，不回退到其它项目。
6. **策略准入收窄**：打开另一个 `statusPolicy` 不支持的项目 = 作用域拒绝并保留当前项目，不 stop 整个 Host；只有"当前活动工作区通过自身设置写变成不支持"保留现有 stop 语义。这是对 `host-composition.ts` 现有行为的显式收窄，记入 Decision Log。
7. **Home 是客户端视图，不新增 closeWorkspace**：active 保持到下一次成功 open；无 active 时 `getWorkspaceSetup` 返回 `workspace:null` 并带 `restore` 状态。
8. **同名区分**：名称 + 规划连接状态 + 仅重名时"第 N 个项目"（创建序）；永不展示 `projectNodeId`、账号、repository、计数或短 id。
9. **显式深链**：安装态插件无 URL/route 入口，本期以 composed Host+client 与浏览器 History 入口证明"链接优先于偏好、不可读不回退"，安装态证据如实记录"无外部深链入口"；不新增宿主 API 或 fragment 约定。
10. **UI 复用现有 gate 与样式**：`WorkspaceSetupGate` 的视图收敛为 `workspace|settings|projects|create`，Home 用 `section[aria-label="项目"] + h2 + ul/li + button`；项目内切换器是 `hp-list-actions` 里的「项目」按钮；不新增主题/组件库/下拉/弹层/第二 store。

### wire 协议

只在 `apps/harness-plugin/src/host-operations.ts` 声明；`Body` 增可选 `scope?: 'host' | 'transition'`（缺省 = assembly），既有操作 ABI 不变。

```ts
listWorkspaces: { mode: 'unary', params: [], scope: 'host' }
openWorkspace:  { mode: 'unary', params: [param('workspaceId', 'WorkspaceId', nonEmptyString)], scope: 'transition' }
```

返回（严格闭集，客户端 closed parse；顺序 = 创建序）：

```ts
// listWorkspaces
{ activeWorkspaceId: string | null,
  workspaces: [{ workspaceId: string, name: string,
                 planning: 'none' | 'bound',            // 本地存在启用的 planning 挂载；不调 Provider
                 policy: 'supported' | 'unsupported' }] } // statusPolicy !== provider_authoritative
// openWorkspace
{ state: 'activated' | 'failed', requestedWorkspaceId: string,
  activeWorkspaceId?: string, error?: ProjectError }
```

- `createWorkspace` 参数不变；目标 id = `options.workspaceId`（显式初始目标，测试/嵌入兼容）否则由 `idempotencyKey` 派生；写成功后同一 transition 激活；返回既有 `CommandResult{value:{workspaceId}, activationError?}`。
- `getWorkspaceSetup` 增可选 `restore?: { kind: 'none'|'stale'|'corrupt'|'unreadable'|'unsupported' }`（仅 `workspace:null` 有意义；成功激活后清空）。
- 校验：`parseInput` 未知字段拒绝；`workspaceId` 非空；catalogue/open 响应 malformed → 客户端 `safeError('unavailable')` + `failure:'read'|'activate'`。

### Host transition 流程（`host-composition.ts`）

1. **准入**：`call(name, input, { peer? })` 同步捕获 `const admitted = current`。`scope==='host'` 直接派发；`scope==='transition'` 进 `transition()`；设置类写命令走 `configureFor(admitted, run)`；其它读等 barrier 后若 `admitted !== current` 抛固定文案「项目已切换，请重新读取」，否则 `lease(admitted, …)`。
2. **transition(target, run?)**：`tail.then` → closed 检查 → 建 barrier + `epoch++` → `await Promise.allSettled([...old.leases])` → `old.reconciler?.stop()` → 目标行存在性（缺失 = 作用域 `not_found`）→ `assemble(target)`（策略检查、`restoreProviders`、`composeCore`、`createController`，记录 `assembly.workspaceId/generation`）→ `candidate.reconciler?.start()` → `current = candidate; developmentCache = candidate.cache; activeFingerprint = await fingerprint(target); activationError = undefined; repositoryValidation++` → `retire(old)` →（#693）写偏好 → 返回 `activated`。
3. **失败**：`retire(candidate)`（若已建）；`current` 不变；**不写** `activationError`；**不 stop**；`finally` 重启 `current.reconciler`；返回 `failed + error`（`not_found`/`not_supported`/`unavailable` 固定文案）。
4. **readAdmitted**：`while (barrier) await barrier`；若 `current.workspaceId !== admitted.workspaceId` 抛固定文案；`lease(admitted, load)`；同 workspace 的 epoch 变化重试（保留 `harness-plugin-host-recomposition.test.js` 的两次读断言），跨 workspace 中止。
5. **watch**：`source.baseline` 继续用跨 generation 重试的 `read()` 以产生 gap；`packages/controller/src/watch.ts` 不改。
6. **参数化**：`assemble(workspaceId?)`、`fingerprint(workspaceId?)`、`handlersFor(assembly)`（读 `assembly.controller/workspaceId/executionMode/targetError/mapping`）；`Assembly` 增 `workspaceId?: WorkspaceId`、`generation: string`；`HostComposition` 增 `currentGeneration(): string | undefined`；`options.workspaceId` 改可选（初始目标）。
7. **启动选择**：显式选项 > 偏好（#693）> 恰好一个 workspace > 空装配（Home）。空装配用 `unavailableCore`；baseline 有 generation、workspace undefined，watch/gap 链照常工作。

### 请求栅栏（`remote.ts`）

- `installHostRemote` 闭包持 `delivered = new Map<string,string>()`。
- stream 包装声明 `this: { ctx: HostRemoteContext }`；每帧 yield 前从帧结构取 generation（`baseline.generation | delta.generation | metadata.generation`；gap 无 generation）记到 `this.ctx.invocation?.peer?.id`（非空字符串才记）。
- unary 包装：`peer = invocationPeer(this.ctx)`；若该操作 `scope` 不是 `host`/`transition` 且 `delivered.has(peer)` 且 `delivered.get(peer) !== composition.currentGeneration()` → 在 `composition.call` 之前抛固定 `Error('项目已切换，请重新读取')`，不进 `guarded` 诊断。
- 与准入捕获组合：栅栏挡"已切换后到达"，捕获挡"检查后切换"；两者都不改既有操作 ABI。

### 偏好文件（#693）

- 路径：`<private root>/workspace-selection.json`（POSIX 为 `path.dirname(dataPath)`；Windows 为 `profile/harness-projects`）。
- 格式（严格闭集，≤4096 字节）：`{ "version": 1, "workspaceId": "<opaque>", "confirmedAt": "<ISO-8601>" }`；未知键/版本/非字符串 → corrupt。
- owner：Host composition；启动期由 `preparePrivateProjectData` 打开并校验（POSIX 允许表 + Windows 原生 `Ensure`），保留 fd；运行期只 `ftruncate+write+fsync` 该 fd；不 rename、不按路径重开。
- 读取：仅启动期、初始装配前。有效 + 行存在 + 策略支持 → 初始目标；缺失 → 无偏好；corrupt/unreadable/stale（无行）/unsupported → 空装配 + `restore.kind`；不删除、不覆盖、不回退到其它项目或"恰好一个"。
- 写入：只在成功激活后；写失败只记诊断、不失败切换、不声称可恢复。
- 优先级：显式选项 > 显式链接（客户端）> 偏好 > 恰好一个 > 无。
- Windows 降级（仅当原生改动无法在 #693 预算内收口）：win32 关闭偏好读写，`restore.kind='unreadable'` + 诚实 Home 文案；仍是 Host 侧，不用 localStorage；作为范围削减记录，不静默。

### UI 页面 / 状态机 / 焦点

- 客户端源：扩展现有 `WorkspaceSetupSource`（snapshot 增 `catalogue?`，port 增可选 `listWorkspaces/openWorkspace`）；`refresh()` 一轮读 setup + catalogue（单 pending/revision）；`open(id)` 走同一 `run('activate')`，响应后重读 setup 并校验 `setup.workspace?.id === requestedWorkspaceId`，否则 `failure:'activate'`；`failure` 联合增 `'activate'`。
- `ui-model`：`workspaceSetupView` 增 `projects` 视图派生（行 = displayName/planningLabel/policyLabel/isActive/pending/error/empty/restoring；同名加"第 N 个项目"）；`workspace-status.ts` 摘要用同一 displayName。
- `WorkspaceSetupGate`：`view: 'workspace'|'settings'|'projects'|'create'`（替换 `settings` 布尔 + visited 派生）；Home = `section[aria-label="项目"]` + `h2 tabIndex=-1`「项目」+ `ul/li`；当前行 `aria-current="true"` +「返回项目」，其它行「打开」；空态说明 +「创建工作区」（复用现有表单，`view='create'`）；失败保留最后已知列表 +「重新读取」；pending 行 `aria-busy` + `role=status`；动作 ≥44px、只继承 `--hp-*`/`--dsw-*`、不新增主题/组件/样式文件。
- 焦点：进入 Home 回焦 h2；打开项目后焦点落项目 h2；返回时回原行，行不存在回 h2（沿用现有 initiator/returnFocus 模式）。
- 项目内切换器：「项目」按钮进 `work-item-project.ts` 的 `hp-list-actions`（与「刷新规划」「连接设置」同行）+ 设置页 header；不做下拉/弹层。
- 过渡屏：`setup.workspace.id !== read.workspace.id` 时显示「正在打开 <B>…」+ 不显示 A 行（既有 scope 门）；断线/失败给「重新读取」。
- 恢复/重置规则：跨项目 reset = 筛选/排序/列宽/时间轴锚点/详情路由/设置草稿（既有 scope-key）；跨项目 retain = 视图模式（工作项/看板/时间线/交付，会话级）；跨重开 retain = 仅 active workspace id；不做 per-project 视图偏好持久化。
- 深链：`parseItemRoute(pathname).projectId` 与 active 不同 → 先 `openWorkspace(link)`；失败 → Home/unresolved 说明，不回退；无效/跨项目 → 现有 unresolved。

### 错误映射

| 场景 | Host 返回 | 客户端/UI |
|---|---|---|
| open 目标缺失 | `failed + not_found`（固定文案） | 行内错误 + 重新读取；A 仍 active |
| open 策略不支持 | `failed + not_supported`（固定文案，不 stop） | 同上；Home 标注"当前 Host 不支持" |
| 装配失败 | `failed + unavailable` | 同上；不写全局 activationError |
| 旧 peer 请求 | 抛「项目已切换，请重新读取」 | gateway 错误信封；`failure:'read'/'activate'` + 重试 |
| Host 关闭中 | 抛「host 已关闭」 | 既有 |
| 偏好损坏/目标不可读 | `getWorkspaceSetup.restore.kind` | Home + 说明，不打开其它项目 |

## Global Constraints

- 交付形态：四个 stacked PR，分支链 `main ← feature/multiproject-catalogue-open ← feature/multiproject-create-switch ← feature/multiproject-restore-navigation ← test/multiproject-isolation-qualification`；每个 PR 关联自己的 issue，共用本 ExecPlan。#695–#697 完整验收后 Closes #691–#693；#698 用 Refs #694，安装态人验未完成不关闭叶子。
- 原规模目标：每个 PR 代码新增+删除 ≤800 行、文档 ≤1300 行，合计代码 2100–3000 行。Superseded by Batch R（2026-11-26）：修复已复现的隔离/恢复缺陷计入本层实际预算；保留 ≤1000 技术行/≤1500 文档行硬门，不为守原估算删判别证据。最终按真实父提交重新计量。
- 未正式发布：不做迁移/兼容/弃用层；不新增 SQLite schema/迁移；不新增第二套 router/store/theme/目录/后端；不用 localStorage 存权威选择。
- 一个 Host 根、一个 SQLite/私有数据生命周期 owner；旧请求/帧/写不得因切换落到新项目；切换是导航，不启动/取消外部工作、不改 Planning Status/关系、不重绑 provider。
- 合并前必须：`pnpm run typecheck`、`pnpm run boundaries`、相关窄测试、`node scripts/rule-checks.mjs disclosure <base>`、`git diff --check <base>...HEAD`；最终 push 后回读 head/base/checks/issue 关联/review threads，再 `gh pr ready`。
- 完整文件集合（跨四个 PR 的唯一清单）：
  - `packages/capabilities/src/storage.ts`、`packages/capabilities/src/registry.ts`
  - `packages/storage/sqlite/src/storage.ts`、`packages/providers/fake/src/storage.ts`
  - `packages/domain/src/ids.ts`
  - `apps/harness-plugin/src/host.ts`、`host-composition.ts`、`host-operations.ts`、`remote.ts`、`client.ts`、`host-private-data.ts`、`host-private-windows.ts`、`host-selection.ts`（新）
  - `packages/client/src/workspace-setup.ts`
  - `packages/ui-model/src/workspace-setup.ts`、`packages/ui-model/src/index.ts`
  - `packages/ui/src/workspace-setup.ts`、`projects-home.ts`（新）、`work-item-project.ts`、`work-item-app.ts`、`workspace-link.ts`、`index.ts`
  - `tests/contract/suites/storage.js`、`tests/contract/domain-identity.test.js`、`tests/contract/harness-host-remote-adapter.test.js`、`tests/contract/harness-host-operations.test.js`、`tests/contract/ui-workspace-setup.test.js`
  - `tests/integration/harness-plugin-host-catalogue.test.js`（新）、`host-switch.test.js`（新）、`host-reopen.test.js`（新）、`multiproject-matrix.test.js`（新）、`harness-plugin-multiproject-execution.test.js`（新）、`harness-plugin-setup-client.test.js`、`harness-plugin-policy-admission.test.js`、`harness-plugin-private-data.test.js`、`harness-plugin-artifact.test.js`、`harness-plugin-migrations.test.js`、`workspace-setup-commands.test.js`
  - `docs/review/pr-695-mmp-review.md`、`pr-696-mmp-review.md`、`pr-697-mmp-review.md`、`pr-698-mmp-review.md`、`docs/review/README.md`、`docs/README.md`、`docs/project-management/merge-queue.md`
  - `tests/browser/projects-home.test.js`（新）、`project-switch.test.js`（新）、`workspace-restore.test.js`（新）、`multiproject-qualification.test.js`（新）
  - `tests/fixtures/execution-drawer-browser.mjs`、`tests/fixtures/composed-workspace-browser.mjs`（#693 Web History 深链入口）
  - `docs/product/ui-workspace-frame.md`、`docs/product/installed-core-acceptance.md`、本 ExecPlan

## Plan of Work

### Batch 1 · #691 目录枚举 + 安全打开 + Projects Home

**最小闭环**：Storage 枚举 + Host `listWorkspaces/openWorkspace` + 请求栅栏 + 客户端 catalogue + Projects Home 打开已存项目。

**主文件**：`packages/capabilities/src/storage.ts`、`packages/storage/sqlite/src/storage.ts`、`packages/providers/fake/src/storage.ts`、`apps/harness-plugin/src/host-composition.ts`、`host-operations.ts`、`host.ts`、`remote.ts`、`packages/client/src/workspace-setup.ts`、`packages/ui-model/src/workspace-setup.ts`、`packages/ui/src/projects-home.ts`、`packages/ui/src/workspace-setup.ts`、`apps/harness-plugin/src/client.ts`、`tests/integration/harness-plugin-host-catalogue.test.js`、`tests/browser/projects-home.test.js`。

**步骤**

1. 先写判别测试：`listWorkspaces` 契约（0/1/多、创建序、安全字段）；Host 打开有效/缺失/策略不支持；真实 Gateway 双 peer 栅栏；watch 切换 gap→新 baseline；Home 0/1/N。
2. `Storage` 端口 + `StorageSurface` + SQLite/Fake 实现 + 契约套件。
3. `host-composition` 参数化（`assemble(workspaceId?)`、`handlersFor(assembly)`、`Assembly.workspaceId/generation`、`currentGeneration()`、`options.workspaceId` 可选）+ `transition()` + `readAdmitted` 拆分。
4. `host-operations` 增 `scope` 与两个操作；`remote.ts` 增 per-peer 栅栏与 stream `this.ctx` 读取。
5. 客户端 `WorkspaceSetupSource` 扩展 catalogue/open；`client.ts` 增"workspace id 变化即 refresh"（修复现有只在重连时 refresh 的缺陷）。
6. UI：`view` 收敛 + Projects Home + 「项目」按钮 + 焦点/空态/失败/pending。
7. 更新既有金样测试（remote adapter 方法清单、operations 参数数、policy admission 语义）。
8. 提交：`feat(ui): 从 Projects Home 枚举并安全打开已存项目`。

**验证**（在检出 `feature/multiproject-catalogue-open` 的工作树 `.worktrees/mp-691-catalogue` 根目录运行）

```bash
pnpm run typecheck
node scripts/resolution-check.mjs && node --test tests/integration/harness-plugin-host-catalogue.test.js tests/integration/harness-plugin-host-authority.test.js tests/integration/harness-plugin-host-recomposition.test.js
node --test --test-timeout=120000 tests/browser/projects-home.test.js
pnpm run boundaries
```

期望：全部 pass；`host-catalogue` 覆盖 0/1/多枚举、open 失败保留 A、双 peer 栅栏、watch 新 baseline；`projects-home` 覆盖打开已存项目并渲染列表。

**回滚**：revert 分支；无持久化格式变化；`workspaceId` 选项保留为初始目标，既有调用点语义不变。

### Batch 2 · #692 创建 A/B + 确认切换

**最小闭环**：确定性 id 的 create-and-switch + 项目内「项目」按钮 + A→B→A 确认切换与失败保留 A。

**主文件**：`packages/domain/src/ids.ts`、`apps/harness-plugin/src/host-composition.ts`、`host-operations.ts`、`packages/client/src/workspace-setup.ts`、`packages/ui/src/workspace-setup.ts`、`packages/ui/src/work-item-project.ts`、`packages/ui/src/work-item-app.ts`、`packages/ui-model/src/workspace-setup.ts`、`apps/harness-plugin/src/client.ts`、`tests/integration/harness-plugin-host-switch.test.js`、`tests/browser/project-switch.test.js`。

**步骤**

1. 先写判别测试：同 key 重放零写同 id、同 key 异名 conflict、不同 key 同名允许；A→B→A 不重启；B 装配失败 A 仍可读且 source 不 degraded；切换窗口内到达的 A 设置写按作用域 `conflict` 拒绝、不在 B 执行（PR1 已测试，本批沿用同一语义）；两个并发切换走 tail 串行、每个请求报告自己的目标且最后一次获胜（判别序列 [B, A]：FIFO 落在 A，LIFO 会落在 B）。
2. `newWorkspaceIdForCreateIntent(idempotencyKey)`（UUID v5 形状）+ 契约测试。
3. `createWorkspace` 派生 id 并在同一 transition 激活；失败保留 A，`activationError` 只写本次命令结果（`allowSwitch` 失败不污染全局状态），同作用域设置写才保留全局降级语义。
4. 客户端 create 走 catalogue 源；UI 切换器与过渡屏；焦点保持。
5. 更新既有断言（`host-recomposition` 的固定 workspace 断言改为同 key 判别）。
6. 提交：`feat(ui): 创建 A/B 项目并在同一 Host 内确认切换`。

**验证**（在检出 `feature/multiproject-create-switch` 的工作树 `.worktrees/mp-692-create-switch` 根目录运行）

```bash
pnpm run typecheck
node scripts/resolution-check.mjs && node --test tests/integration/harness-plugin-host-switch.test.js tests/integration/workspace-setup-commands.test.js tests/integration/harness-plugin-host-recomposition.test.js
node --test --test-timeout=120000 tests/browser/project-switch.test.js
pnpm run boundaries
```

**回滚**：revert；新建的 workspace 行保留（可被 Home 枚举），无数据格式变化。

### Batch 3 · #693 重开恢复 + 作用域导航

**最小闭环**：Host 启动恢复最后确认项目 + 显式链接优先级 + 损坏/不可读如实降级 + 项目内导航隔离。

**主文件**：`apps/harness-plugin/src/host-selection.ts`（新）、`host-private-data.ts`、`host-private-windows.ts`、`host-composition.ts`、`host-operations.ts`、`packages/client/src/workspace-setup.ts`、`packages/ui/src/workspace-setup.ts`、`packages/ui-model/src/workspace-setup.ts`、`apps/harness-plugin/src/client.ts`、`tests/integration/harness-plugin-host-reopen.test.js`、`tests/browser/workspace-restore.test.js`、`tests/integration/harness-plugin-private-data.test.js`。

**步骤**

1. 先写判别测试：偏好写/读/损坏/目标已删；激活失败不覆盖偏好；恢复失败 → Home 说明；链接 > 恢复项目；链接不可读不回退；B revision 低于 A；A/B 相同 item id；迟到 A 帧不落地；私有根新文件在 POSIX 与 Windows 的 ACL/lease/硬链接/junction 用例。
2. `host-selection.ts` 严格解析/写入；`host-private-data.ts` 与 `host-private-windows.ts` 允许清单 + ACL 校验。
3. 启动恢复与 `restore.kind` 投影；成功后写偏好；失败不覆盖。
4. 客户端链接优先级与恢复失败说明；`WorkspaceSetupGate` 过渡屏。
5. 更新 `docs/product/ui-workspace-frame.md` 的 Home/切换器/恢复规则。
6. 提交：`feat(ui): 重开恢复最后确认项目与项目作用域导航`。

**验证**（在检出 `feature/multiproject-restore-navigation` 的工作树 `.worktrees/mp-693-restore-navigation` 根目录运行）

```bash
pnpm run typecheck
node scripts/resolution-check.mjs && node --test tests/integration/harness-plugin-host-reopen.test.js tests/integration/harness-plugin-private-data.test.js
node --test --test-timeout=120000 tests/browser/workspace-restore.test.js
pnpm run boundaries && pnpm verify
```

**回滚**：删除偏好文件即回到"无恢复"；无 schema 迁移。Windows 原生改动是唯一超限风险；若超 800，按 Design/Spec 的 win32 降级并更新本计划。

### Batch 4 · #694 组合/打包/安装态验收

**最小闭环**：把 #636 八条验收整合为可复核证据矩阵，不新增产品行为。

**主文件**：`tests/integration/harness-plugin-multiproject-matrix.test.js`（新）、`tests/browser/multiproject-qualification.test.js`（新）、`tests/integration/harness-plugin-artifact.test.js`、`tests/integration/harness-plugin-migrations.test.js`、`docs/product/installed-core-acceptance.md`、本 ExecPlan。

**步骤**

1. 对抗矩阵：A/B 相同 work-item/repository/idempotency id；B 低修订；held/delayed 旧读与旧 provider 回复；排队写；失败/快速 A→B→A；旧 watcher/reconciler 有界退休、无重复轮询。
2. 打包件加载/重开与迁移清单不变；真实浏览器全流程（create/switch/reopen/isolation）。
3. 安装态走查记录：源 SHA、packed SHA256、Host 版本、两项目创建/切换/重开、键盘/焦点/窄屏/明暗、错误与恢复；缺失项如实标注。
4. `#636` 八条逐条映射到子测试与证据；更新 `docs/product/installed-core-acceptance.md`。
5. 提交：`test(product): 端到端验收多项目隔离与生命周期`。

**验证**（在检出 `test/multiproject-isolation-qualification` 的工作树 `.worktrees/mp-694-qualification` 根目录运行）

```bash
pnpm --filter @harness-projects/app-harness-plugin pack:plugin
pnpm run typecheck && pnpm run boundaries
node --test tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-migrations.test.js tests/integration/harness-plugin-multiproject-matrix.test.js
node --test --test-timeout=120000 tests/browser/multiproject-qualification.test.js
node scripts/rule-checks.mjs size <declared-base>
```

**回滚**：纯测试/文档；revert 无产品影响；真实缺陷修复计入本 PR 预算并重估。


### Batch R · MMP 评审修复与授权收尾（2026-11-26）

先把各自 `docs/review/pr-695-mmp-review.md` 至 `pr-698-mmp-review.md` 的反例转为最小回归并观察原实现失败，再按上述状态拥有者修复。执行对应 Batch 1–4 的最窄有效验证；修复交另一 reviewer 独立核对 spec 与代码质量。最终组合复用 Batch 4 命令、`pnpm verify` 与真实 CI；变异表只在最终修复树整表重测一次。相同问题不另开重复 issue。

#698 本轮只接受自动化资格证据：PR 改 `Refs #694`，#694 原始安装态人类走查条款和 #636 全能力接受保留 OPEN；不声称 packed/lib 等于安装态人验。补非空运行跨 A→B→A、待确认外部操作归属和 raw/gzip/packed/package graph 差量；更新真实证据映射。源码工程计划完成后归档，遗留人验由 #694 继续追踪。

最终 push 前按每个 PR 的独立交付边界整合提交，保存旧 head 备份并用精确 lease；push 后重锁 head/base/checks/issue/全部 threads，当前批准与必需门通过后才 rebase 合并。每层合入后 fetch 真实 main 再接下一层。恢复：使用本地 `refs/backup/pr<N>-before-mmp-review-20261126`；不删除 workspace 数据，不写 Planning Status 或依赖关系。

## Validation and Acceptance

- 每个 PR 的判别测试必须能失败：先写测试并观察失败，再实现；不接受只跑通没有断言的用例。
- 最小证据按风险选择：包行为跑相关契约/集成测试；跨包结构跑 `boundaries`；浏览器交互跑 `test:browser`；打包/安装态跑 packed artifact 与人工走查；发布面跑 `rule-checks disclosure`。
- #636 八条验收映射：

| #636 验收组 | 主要证明 PR | #694 整合 |
|---|---|---|
| 1 Create and resume | #692 | 同 key 重放/冲突/失败恢复矩阵 |
| 2 Discover and navigate | #691 + #692 | 键盘/焦点/窄屏/明暗 |
| 3 Confirmed switch | #692 | 失败/快速 A→B→A |
| 4 Read/write isolation | #691 + #692 | 相同 id、低修订、held 旧回复、排队写 |
| 5 Execution and authority | #692 | 有界退休/无重复轮询 |
| 6 Reopen and deep links | #693 | 安装态走查 |
| 7 Product states and access | #691 + #692 + #693 | 全状态矩阵 |
| 8 Evidence and closure | 各 PR 自带 | composed+packed+installed 证据、复用清单、源/产物身份 |

- 人类评审：四个 PR 置 ready 后请求规划所有者评审；agent 不自行合并。

## Progress

- [x] (2026-11-25) Batch 1 · #691 目录枚举 + 安全打开 + Projects Home
- [x] (2026-11-25) Batch 2 · #692 创建 A/B + 确认切换
- [x] (2026-11-25) Batch 3 · #693 重开恢复 + 作用域导航
- [ ] (2026-11-25) Batch 4 · #694 组合/打包/安装态验收
- [ ] (2026-11-25) 四个 PR 独立对抗验收、重构与 ready 评审

## Surprises & Discoveries

- 2026-11-25：任何 SQLite schema 变更都会让已安装库被 `migrate.ts` 的精确基线 + 世代门拒开（`CURRENT_SCHEMA_GENERATION = 7`，单资产 `001_init.sql`），因此"最后确认项目"不能进 SQLite 表，改放私有根固定文件。
- 2026-11-25：真实 gateway 的 stream 调用同样经 `prepareInvocation` 绑定 `this.ctx.invocation.peer`（`openStream` 复用同一 receiver），所以 per-peer 栅栏不需要改 22 个操作的 ABI。
- 2026-11-25：`apps/harness-plugin/src/client.ts` 的 setup 只在"重连"时 refresh；切换工作区后 setup 会停在 A，必须新增"workspace id 变化即 refresh"，否则列表永不渲染 B（#691 修复并测试）。
- 2026-11-25：实现中发现 `createWorkspace` 必须与 `openWorkspace` 一样在 wire 上声明 `scope: 'transition'`，否则它经 `readAdmitted` 取得自己的 lease 后再进 `serialize` 的 barrier 排空，会等待自身 lease 而死锁；两者都绕过 per-peer 栅栏（它们是切换的发起方）。Batch 2 的 create-and-switch 可直接复用同一 scope。
- 2026-11-25（PR1 最小实现，偏离原计划）：`createWorkspace` 在无显式初始目标时用 `newWorkspaceId()` 生成随机 id，写成功后在同一 `serialize` 临界区装配并激活（`allowSwitch`）。确定性 UUID v5 形状派生、同 key 重放零写入与 create-and-switch 的契约语义按计划留给 Batch 2（#692）；PR1 只保持既有空 profile setup 流程可用。
- 2026-11-25：启动选择实现为「显式初始目标 > 恰好一个已存工作区 > 空装配（Home）」；显式目标（含被「恰好一个」选中的目标）策略不支持时仍以 `HostPolicyAdmissionError` fail-closed，保住了 `harness-plugin-policy-admission` 的启动断言。空装配的 `assembly.workspaceId` 为 undefined，但显式目标缺行时保留该目标 id 供 `createWorkspace` 写回同一 id（既有单工作区测试语义不变）。
- 2026-11-25：作用域 `openWorkspace` 成功失败都经同一 `serialize`，失败只返回 `failed + error`：不写全局 `activationError`、不 stop、不替换当前装配；同 workspace 且指纹未变的重复打开是 no-op（不换 generation）。这比原 configure 的「失败写 activationError」语义更窄，未影响既有设置写测试。
- 2026-11-25：per-peer 栅栏与「发起切换的同一 peer 立刻重读」存在窗口：切换响应返回时 watch 的新 baseline 可能尚未到达，若只按 watch 帧更新 delivered，则 create/open 之后的 setup 重读会被自己的栅栏以固定文案拒绝（浏览器空库创建用例实测触发）。实现为：任何已跟随 watch 的 peer 在拿到 unary 响应后把 delivered 更新为当前 generation（未跟随 watch 的 peer 仍不记录、始终放行）；这样旧 peer 仍被拒绝，切换发起方无需等待下一帧。
- 2026-11-25：栅栏的 stream 侧必须把 `this.ctx` 提到 async generator 之外捕获——嵌套的 `async function*` 不继承外层 `this`；测试里对 `service.watch` 的无接收者包装会传 undefined，因此捕获时保留可选链。
- 2026-11-25（PR1 CI 修复）：Windows 原生 private-data 用例在重开时库中已有一条遗留 `manual_only` 行，启动选择因此补「唯一受支持工作区」fallback（显式目标 > 唯一已存 > 唯一 provider_authoritative > Home）；它保留既有单工作区 fail-closed 策略准入，同时避免多行遗留数据把唯一可用项目挡在 Home 之外。另：GitHub 不为非默认 base 的 PR 计算 `closingIssuesReferences`，通过临时把 PR base 指向 main 再切回可触发计算且关联保持（用于 stacked PR 的 issue 链接，属 PR 元数据操作）。
- 2026-11-25：UI 视图收敛后，planning=`unbound`（工作区已建、未连接）的默认 pane 仍是 `workspace` 摘要而不是设置页，否则 `ui-workspace-setup` 的既有「继续连接项目」金样与焦点测试会改变；只有 `configured/degraded` 默认进设置页。过渡屏文案在 `read` 尚未到达时保留「正在等待工作项。」，仅在已有旧读数且 workspace id 不同时显示「正在打开「<B>」…」，避免把「还没有帧」误报成切换。
- 2026-11-25（PR1 修复轮）：`createWorkspace` 的幂等只在本实例内成立——Host composition 用 `Map<idempotencyKey, WorkspaceId>` 复用首次决定的目标 id，同 key 重放零写入、同 key 异名 conflict；但跨 Host 重启（进程内 Map 丢失）仍可能为同一意图生成第二个 id，客户端换键重试会产生第二个同名空项目行。该残余风险由 Batch 2（#692）的 UUID v5 形状确定性派生关闭，本 PR 不实现。
- 2026-11-25（PR1 修复轮）：本 PR 同时删除了 `createController` 的 `workspaceRevision` 传参（`packages/controller/src/queries.ts` 的 `_workspaceRevision` 已注明 deprecated 且被忽略），属于简化而非行为变更：Core 快照修订号改由实体推导，既有测试未依赖该参数。
- 2026-11-25（PR1 修复轮）：Home 空态（0 个项目）在组合 UI 中由 `defaultPane` 直接进入现有 create 表单，`ProjectsHome` 不再保留 `empty` 分支与「创建工作区」按钮；0 项目路径由 `defaultPane` 的组件契约覆盖（`tests/contract/ui-workspace-setup.test.js` 的既有 create 表单断言），Home 非空行为由 `tests/browser/projects-home.test.js` 覆盖。
- 2026-11-25（Batch 2）：删除 `host-composition.ts` 的 `Map<idempotencyKey, WorkspaceId>`（`createTargets`），创建目标改由 `newWorkspaceIdForCreateIntent(idempotencyKey)` 确定性派生（UUID v5 形状 = `sha256('workspace-create:v1:'+key)` 前 16 字节 + 版本位 5/变体位 10xx）。判别证据：同 key 同名重放走 controller 账本（payload 因派生稳定而完全相同）零写入；**跨 Host composition 重放**（账本与进程内 Map 都丢失）仍复算同一 id、只有一行、库逐字不变——旧 `Map` 实现在该用例上必红（实测 3 个判别用例失败），改后 8/8 绿。只有显式初始目标 `options.workspaceId`（测试/嵌入）仍优先，既有 `value.workspaceId === WORKSPACE` 断言不改。
- 2026-11-25（Batch 2）：`WorkspaceSetupGate` 的 `creating` 原由 `setup.workspace === null` 派生，于是「Home → 创建工作区」在已有 active 项目时退化成连接表单：无法创建第二个项目（A/B 最小闭环断裂），且创建后 header 仍停在「创建工作区」、没有回 Home 的入口。改为由 pane 派生 `creating = pane === 'create' || setup.workspace === null`，并在 create 成功后的 `.then` 里 `enter('settings')` 交接新项目的连接/设置流程（不声称已完全配置，失败留在本页保留草稿）。判别证据：`tests/contract/ui-workspace-setup.test.js` 的 Home 创建入口与 create→connect 交接用例（改前 red）、`tests/browser/project-switch.test.js` 真实组合创建 A/B。
- 2026-11-25（Batch 2）：浏览器夹具增 `create-switch` seed（`createHostComposition` 不传显式初始目标，空 profile 从 create 面板开始）与 `/control` 的 `policy` 正控（把非当前项目改成 Host 不支持的策略以触发作用域失败）；其它 seed 的既有行为不变。
- 2026-11-25（Batch 2 修复轮，独立对抗验收 P2）：① UI 创建提交只看 `setup.workspace != null`，已有 A 时本地拒绝/Host 不可用/装配失败会进入 A 的设置页并丢草稿；改为要求读回无 `error`/`failure`/`activationError` 且 workspace id 与提交前不同才交接新项目。② client 的 `createIntent` 在成功读回后不清除，同名再次创建复用同一 key+payload 被 Host 当重放、静默切回旧项目；改为只在 `run('create')` 读回的新 workspace id 等于本次 command 返回值且无错误时清除，丢 ack/未确认期间仍复用同 key。③ `configure` 的激活失败无条件写全局 `activationError`，create-and-switch 失败会把仍是当前的 A 的 baseline/setup 标成 degraded；改为 `allowSwitch === false` 才写全局，`allowSwitch === true` 只把固定作用域文案放进本次命令结果。三条各有判别用例（改前实测 3 个失败：`失败必须留在 create 面板`、`确认完成后必须换键：名称不是自然键`、`全局 activationError 保持 undefined`），改后 switch 集成 9/9、contract 40/40 绿。
- 2026-11-25（Batch 2 修复轮，P3）：快速 open 判别序列改为两个请求 `[B, A]`（FIFO 最终 A、LIFO 会最终 B），并断言每个结果报告自己的 target 与 `peak=1`；失败切换补注入次数 `calls===3` 与 `controller`/`generation` 前后指针比较；导航用例的 `BUSINESS_TABLES` 补齐 `dump` 中除 `schema_migrations` 外的全部业务表（含 `sync_cursor`/`reconcile_cursor`/`workspace_planning_mapping`/`workspace_revision` 等 23 张），并把「零 fetch」收窄为「空工作区档案下无 provider 写、无规划状态变化，fetch 计数只对该档案有效」。ExecPlan 同时订正 UUID v5 形状表述、写入语义与 `options.workspaceId` 的 create 优先级。

- 2026-11-25（Batch 3）：偏好文件的安全边界分两层——`preparePrivateProjectData` 仍对私有根固定文件做既有 ACL/nofollow/nlink/0600 准入，**形状不安全即拒绝启动**（与 db/log 同一安全不变量）；只有「已安全打开后的运行期读取失败」降级为 `restore.kind='unreadable'`。因此 `unreadable` 用读取系统调用失败注入判别，而不是把 symlink/hardlink 变成可恢复状态。
- 2026-11-25（Batch 3）：启动选择本身不写偏好——只有经 `openWorkspace`/`createWorkspace` 的成功激活才写（`activate(target, old, desired, persist)` 的 `persist` 标志）；设置写即使改了 fingerprint 触发重新装配也不重写 `confirmedAt`，「唯一已存」fallback 与同项目 no-op 同样不写。这样「重开恢复」只承诺用户显式确认过的项目，同时保住单工作区既有启动兼容。
- 2026-11-25（Batch 3）：偏好写入改为「覆盖写满 → fsync → 旧文件更长才 ftruncate 到精确长度 → fsync」，任何崩溃窗口只可能留下可解析旧值或 `corrupt`，不会变成 0 字节 = `none` 而静默打开唯一已存项目。判别注入点因此是第一次 `fs.writeSync`（旧实现「先 ftruncate」会留下 0 字节）：写失败时本次切换仍 `activated`、旧偏好逐字保留、诊断日志出现 `selectionWriteFailed`，重开按旧偏好恢复；写一半后崩溃重开为 `restore.kind='corrupt'`。
- 2026-11-25（Batch 3）：显式深链只有「已存项目」才触发 `openWorkspace`；catalogue 里没有的 projectId 仍走既有 unresolved。决策与编排收敛到产品模块 `packages/ui/src/workspace-link.ts` 的 `resolveWorkspaceLink`（`active|open|invalid|failed`，每个 await 后用 `isCurrent()` 丢弃目标已变化的旧结果），`WorkspaceSetupGate` 接受可选 `initialPath` 并经它解析（`bindWorkspaceSetupApp` 透传，插件 `client.ts` 不传），浏览器夹具删除内联 resolve 改为调用同一模块。这让 `tests/browser/workspace-read.test.js` 的「跨 scope 深链拒绝」语义保持不变，同时把「链接优先于偏好/失败不回退」落在 composed Host+client 的浏览器 History 入口。该入口的链接解析必须先读 `getWorkspaceSetup` + catalogue 再决定是否 `openWorkspace`：空装配（Home）没有已确认 descriptor，supervisor 的 `read()` 按契约返回 undefined，若先等 `read()` 会把「无 active」误报成连接中并让深链永远卡住（浏览器实测捕获）。
- 2026-11-25（Batch 3）：Windows 原生允许清单加 `workspace-selection.json` 后，`prepareWindowsProjectData` 的 Node 侧用 `O_CREAT` 兜底打开持久 fd（synthetic helper 用例不执行原生 Ensure）；该 fd 由 `createHostComposition.dispose` 统一关闭，`lease.dispose()` 不再关闭它（消除双关闭/复用风险），`openSync` 失败时先关已打开的 `logFd` 再走统一失败路径。
- 2026-11-25（Batch 3 修复轮，独立对抗验收）：① P1 偏好命中行+策略但装配失败会拒绝整个 Host 启动；改为只有**偏好驱动**的初始目标容错——`assemble(preferredId)` 失败记 `restoreAssemblyFailed`、`restore.kind='failed'` 并回落到空装配 Home，显式 `options.workspaceId` 与「唯一已存/唯一受支持」fallback 保持 fail-closed。restore kind 闭集增 `failed` 并收敛到 `packages/client/src/workspace-setup.ts`（host 与 ui-model 只 import type），ui-model 文案「上次打开的项目暂时无法装配，请选择项目。」。② P2-1 偏好写入改崩溃安全顺序（见上）。③ P2-2 深链决策提取为产品模块并接入 Gate/夹具。④ P3 收敛：Windows fd 归属、`persist` 标志、闭集边界判别、文档固定文件清单。改前负向验证：P1 用例在旧实现上以 `PlanningReadTimeout` 拒绝启动、P2-1 用例旧实现留下 0 字节偏好、`persist` 用例旧实现重写 `confirmedAt`。

## Decision Log

2026-11-26 / 本会话人类直接授权本评审会话负责 #695–#698 后续：“你负责后续：三思后修复，但禁止 adhoc 式修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。”本授权覆盖四个 PR 的修复、复评、条件 rebase 合并和相关清理；未授权 Planning Status/native blocking 或替代人类安装接受。

1. **交付形态：四个 stacked PR，而非单 PR 或独立并行 PR。** Rationale：四个 P0 叶子共享 Host composition/client/UI 文件与同一能力闭环，单 PR 超出 800 行；并行分支会在同一文件产生冲突且无法各自 green。日期/作者：2026-11-25 / lead。
2. **选择作用域 = Host/profile 全局。** Rationale：一个 Host 一个 active workspace 是最小实现；per-peer 独立选择需要多 Core 并发，属 V1 shared Host 范围。日期/作者：2026-11-25 / lead（三份独立设计 + 评审一致推荐）。
3. **偏好持久化 = 私有根 `workspace-selection.json`。** Rationale：不动 schema（否则拒开已安装库）；与 SQLite 同根同 ACL/lease；删除即回滚。被否：SQLite 新表（数据重置）、localStorage（多 peer 互相改选、非 Host 权威）。日期/作者：2026-11-25 / lead。
4. **策略准入收窄为作用域拒绝（公开行为变更）。** Rationale：单个不支持策略的项目不应杀死整个 Host 与其它项目；当前工作区自身设置写变成不支持仍保留 stop 语义。日期/作者：2026-11-25 / lead。
5. **显式深链验收口径 = composed Host+client + 浏览器 History 证据 + 如实声明安装态无外部入口。** Rationale：安装态插件无 URL/route API，新增 fragment 约定依赖未证实的宿主能力；不新增宿主 API。日期/作者：2026-11-25 / lead。
6. **create 的 workspaceId 由 `idempotencyKey` 确定性派生（UUID v5 形状）。** Rationale：丢 ack 重放可复算同一 id、零写入；不引入持久创建回执表；只用随机意图键，符合 ADR-0010。派生不含 profile 命名空间：不同 profile 各自 SQLite、不共享 workspace id，这是既有边界而非缺陷。日期/作者：2026-11-25 / lead。
7. **请求隔离 = per-peer generation 栅栏 + 准入 assembly 捕获。** Rationale：只做其一都有缺口（"检查后切换"或"切换后到达"）；两者都不改既有 ABI。日期/作者：2026-11-25 / lead。
8. **catalogue 扩展现有 `WorkspaceSetupSource`，不新建 source。** Rationale：单一 pending/订阅/failure 语义；open 必须原子替换 setup。日期/作者：2026-11-25 / lead。
9. **同名区分用"第 N 个项目"（创建序），不展示 projectNodeId/短 id。** Rationale：公开数据面最小；确定性；端口承诺创建序。日期/作者：2026-11-25 / lead。
10. **Home 无 active 时不清空 active、不新增 closeWorkspace。** Rationale：少一个生命周期概念；恢复失败可解释。日期/作者：2026-11-25 / lead。
11. **create-and-switch 的装配失败只作用于本次命令结果（公开行为收窄）。** Rationale：候选装配属于一次创建，把失败写进全局 `activationError` 会让仍是当前项目的 A 的 baseline/setup 降级，违反「切换失败保留 A」；同作用域设置写（`allowSwitch=false`）仍保留原有全局降级与 unsupportedPolicy stop 语义。日期/作者：2026-11-25 / lead。

12. **偏好读取失败分两层：不安全形状 fail-closed，运行期读取失败 = `restore.unreadable`。** Rationale：私有根固定文件的 symlink/hardlink/ACL 破坏属于安全边界，必须与 db/log 一样拒绝启动；只有打开后 I/O 失败才是可解释的降级，且不得抛到 wire。日期/作者：2026-11-25 / PR3。
13. **只有已存项目才从深链尝试打开。** Rationale：未知 projectId 是无效链接，保持既有 unresolved（不回显路由、不碰 store），避免为垃圾 URL 触发 Host 切换；已存但不可打开（缺失/策略不支持/装配失败）只给 Home/说明，绝不回退到偏好或当前项目。日期/作者：2026-11-25 / PR3。

## Idempotence and Recovery

- `listWorkspaces`/`getWorkspaceSetup` 是纯读；`openWorkspace` 幂等（重复打开同一目标 = 无变化成功）；`createWorkspace` 同 key 重放零写入。
- 切换失败保留旧装配与旧读数；`finally` 重启旧 reconciler；不写全局 `activationError`。
- 偏好文件损坏/缺失/目标不可读 → 空装配 + restore 说明；不删除、不覆盖、不回退到其它项目。
- 回滚：每个 PR 可独立 revert；无 schema 迁移、无数据重写；删除偏好文件即回到"无恢复"行为；新建的 workspace 行保留且可被 Home 枚举。
- 恢复锚点：分支已推送时先建 `backup/` ref，再以精确 old head 做 `--force-with-lease`；不直接推 main、不自行合并。

## Interfaces and Dependencies

- 外部工具：Node.js ≥26（`.nvmrc`）、pnpm 10.28.2、`gh`（含 `gh stack` 扩展，但本计划用显式分支链 + `gh pr create --base`）、Playwright 1.64.1、SQLite（`node:sqlite`）。
- 宿主 ABI：`@deepseek-ai/cordis` ~4.0.4、`@deepseek-ai/dsh-api-gateway` 0.2.0-rc.2、`@deepseek-ai/dsh-typert-registry` 0.2.0-rc.2；插件 peer 范围 `~0.2.0-rc.2`。
- 仓库契约：`StorageSurface` 精确成员表、`host-operations` 唯一声明、严格 `parseInput`、`WireWorkspaceHeader` 的 generation 语义、`WorkspaceSetupSource` 的 intent key 语义。
- 外部状态：GitHub Project 10 的 issue 字段（ExecPlan/Batch 可机械回填；`Status` 与原生 blocking 关系由人类拥有，agent 不写）。

## Outcomes & Retrospective

（完成时填写：实际结果、与计划的偏差、遗留问题。）

## Bottom Change Note

- 2026-11-25：创建本计划。基于三份独立设计（Host 生命周期、数据/存储、产品/UI）与一份独立评审合议稿，锁定四个 stacked PR 的边界、wire 协议、请求隔离双机制、偏好文件与 UI 结构。
- 2026-11-25：完成 Batch 1（#691）实现与验证。相对计划的偏离：① `createWorkspace` 在无显式初始目标时先发随机 id（确定性派生留 #692）；② `createWorkspace` 也声明 `scope: 'transition'` 以消除 read-lease 与 transition barrier 的自等待；③ 过渡屏文案只在已有旧读数时切换，`read` 未到达时保留「正在等待工作项。」；④ 除计划列出的金样外，还更新了 `tests/integration/harness-plugin-host-runtime-adapter.test.js`（组合失败注入改为 `listWorkspaces`）、`tests/integration/harness-plugin-setup-client.test.js` 与 `tests/contract/ui-workspace-setup.test.js` 的过渡屏断言；`harness-plugin-issue-closing-links.test.js` 的既有停止语义由 `READ_AFTER_STOP` 代码保留、测试无改动；⑤ 代码增删实测 798 行（`node scripts/rule-checks.mjs size main`），在 ≤800 目标内，文档未超 1500 行预算；实现过程中通过移除 client 的 `exposes` 兼容探测、Projects Home 的 `empty` 分支及其组件测试、并压缩冗余注释/样式/测试表达收敛规模。
- 2026-11-25（PR1 修复轮）：按独立对抗验收修正三处判别缺陷并补判别测试：① 切换窗口内到达的设置写在 `configure` 执行 `run()` 前即按作用域拒绝（`conflict`），不再写库、装配或写全局 `activationError`，B 的 baseline 与 setup 不再显示 A 的失败；② Host composition 内以 `Map<idempotencyKey, WorkspaceId>` 复用首次决定的目标 id，同 key 重放零写入且不触发账本 conflict；③ client 在首个快照后即视为已观察，Home(undefined)→项目(defined) 也重读 setup+catalogue。另订正 `listWorkspaces.activeWorkspaceId` 取 `current.workspaceId`（避免切换中返回旧 active），并补两个新文件的 EOF 换行；规模实测代码 798 行。
- 2026-11-25（PR1 CI 修复）：启动选择补「唯一受支持工作区」fallback 以兼容含遗留不支持行的 profile（Windows 原生 private-data 重开用例）；新增判别断言并复用既有测试。PR 关联：GitHub 对非默认 base 不计算 closingIssuesReferences，采用临时 retarget 到 main 再切回的方式建立 stacked PR 的双向 issue 关联。
- 2026-11-25：启动 Batch 2（#692）。本批在 Batch 1 的目录/安全打开之上补：由 wire `idempotencyKey` 确定性派生 `WorkspaceId`（UUID v5 形状，替换本实例内的 `Map` 复用）、创建 A/B 与确认切换的判别测试、失败切换保留 A 与「切换窗口内 A 设置写按作用域 conflict 拒绝」的反例、以及创建后恢复部分配置的 UI 流程；不改变 Batch 1 的请求栅栏与作用域语义。
- 2026-11-25：完成 Batch 2（#692）实现与验证。相对计划的偏离：① `packages/ui/src/work-item-project.ts`、`work-item-app.ts` 与 `apps/harness-plugin/src/client.ts` 无改动——PR1 已提供「项目」按钮、项目作用域门与 workspace id 变化重读；② 本批确实修改了 `packages/client/src/workspace-setup.ts`：创建读回确认后清空意图键（修复轮 P2-2）；③ 浏览器证据集中在 composed Host+client 的 create→switch→failed-switch 关键路径，窄屏/明暗/安装态走查留给 #694；④ 代码规模实测见 `node scripts/rule-checks.mjs size feature/multiproject-catalogue-open`（记录于汇报）。
- 2026-11-25：完成 Batch 3（#693）实现与验证。相对计划的偏离：① 偏好文件的不安全形状（symlink/hardlink/fifo/目录/ACL）仍按私有根安全不变量 fail-closed，`unreadable` 只表示已安全打开后的运行期读取失败（用 `fs.readSync` 注入判别）；② 偏好写入挂在 `activate()` 成功路径：同项目 no-op 与「唯一已存」启动 fallback 都不写，只有显式 open/create 的激活才写；③ 显式深链实现在 `tests/fixtures/composed-workspace-browser.mjs` 的 Web History 入口（该文件不在原全局集合，属测试夹具；安装态插件仍如实「无外部深链入口」），未知 projectId 保持既有 unresolved；④ Home 恢复说明放在 `ui-model` 的 `workspaceRestoreNotice` + `ProjectsHome`，`WorkspaceSetupGate` 的 `defaultPane` 在 restore 非 none 时进入 projects；⑤ Windows 原生新增 `workspace-selection.json` 的 Ensure/持久 fd 与负向用例（symlink/junction/hardlink/broad ACL/类型）本地无法验证，交 push 后 windows-native lane 复核，POSIX 判别用例全绿；⑥ `packages/ui/src/workspace-setup.ts` 只改 `defaultPane`，`apps/harness-plugin/src/client.ts` 无改动（restore 走既有 setup 重读路径）。规模与命令结果见汇报。

2026-11-26：将首轮评审反例、根因设计、disjoint ownership、恢复锚点和 #694 保留接受写入 Batch R，延续同一 ExecPlan。

2026-11-26 后续发现：#695 当前 CI 与本地 `projects-home.test.js` 一致出现 B 已激活而仍留 Home；scope 栅栏正确丢弃旧 readback，却让 open 的 raw mutation Promise 早于排队的已接受读取结束。根因修复放在 Source 完成契约：原 mutation 槽先释放，返回给调用方的 transition 完成再等待/加入现有新读取，二者不能形成互等；目标不再属于当前意图时不得发布旧结果。被否：在 Gate 额外加 open-target 状态弥补早完成，会让其它 Source 消费者仍读到未结算结果。保留已有栅栏和有限读取，不增加无界重试。原窄组通过不等于浏览器闭环，当前 PR 继续阻塞，须独立复评及新 head CI。

2026-11-26 F3复评收紧：在后续文件打开失败边界分别尝试fd/helper清理，任何cleanup异常不得覆盖原安全获取失败；不扩展其它清理路径。实物fd与child结束及四种cleanup组合已独立验证。

2026-11-26 恢复闭环取证：无active的Home baseline使sync.read返回undefined；必须把已观察项目→undefined作为作用域变化，撤销旧阶段并重读setup，保留初始已结算快照不重复读。扩展本层apps/client与mounted-client回归，原始browser超时不放宽；这是Host权威空装配的消费修复。
