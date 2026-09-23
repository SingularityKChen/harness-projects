# 2026-09-24-ui-model-presentation —— 从客户端模型派生首页、列表与详情

> 状态：Completed（第二轮 MMP 评审无 P0 / P1，随 PR #158 以 rebase merge 合入并归档）
> 创建：2026-09-24
> 范围：`packages/ui-model` 的三组展示结构与能力驱动的动作可用性；不含 React 组件，不含统一详情的工程段与交付段
> 载体 issue：<https://github.com/SingularityKChen/harness-projects/issues/128>（epic #124 的子 issue）
> 上游依据：`AGENTS.md` §2（依赖方向）、§1.1 不变量 3 / 7；`docs/product/vertical-path.md` §2 步骤 1–5；`tests/README.md` §1 / §3
> 本计划同时是 spec 与 plan；正文中文，代码标识符、路径与命令英文。

## Purpose / Big Picture

`packages/ui-model` 今天只有一行 `packageId`，因此没有任何页面能从客户端模型拿到可渲染的结构。完成后：

1. 页面读**展示结构**（首页、列表行、详情段），不读 wire 对象，也不知道 provider 的存在；
2. 动作可用性只有一个来源——capability key；平台名不进入任何分支；
3. PR 支撑的规划条目在列表里是 change request 行，且**没有**"开始工作"这个动作；
4. 陈旧快照不产生空列表：每一行都在，并被标记为陈旧且带最后更新时间；
5. 统一详情给出规划段、来源身份与谱系入口，工程段与交付段留给后续增量。

判断成功的最小证据（在检出 `feat/ui-model-presentation` 的工作树根目录运行）：

```bash
export npm_config_manage_package_manager_versions=false
node --test tests/contract/ui-model-presentation.test.js
# 期望：ℹ fail 0，用例数非零，且用例名逐条点名它保护的不变量

grep -rn "github" packages/ui-model/src ; echo "grep-exit=$?"
# 期望：无输出，grep-exit=1

pnpm run boundaries
# 期望：ℹ fail 0
```

## Context and Orientation

### 术语

- **wire 对象**：`packages/controller/src/wire.ts` 的 `WireEntity` / `WireSnapshot` / `WireDelta`。它是 provider 原生结构与前端之间唯一的类型化边界；`source.freshness = degraded` 表示"最后已知"，不是当前值。
- **客户端模型**：`packages/client` 的 `EntityStore`（`StoredEntity { entityId, entity, revision, stale }`）、`WorkspaceSync`（`connected` / `revision`）与 `Transport`。React-free，`isCurrent(entityId)` 只在条目存在且不 stale 时为真。
- **展示结构**：`packages/ui-model` 的纯数据输出。它只带展示需要的字段与可用性结论，页面据此渲染；页面不 import wire 类型，也不按 provider 名分支。
- **capability key**：`packages/capabilities/src/capability-keys.ts` 的稳定取值（跨层契约，增删改名即失败），配合四态 `AccessLevel`（`available` / `read_only` / `unavailable` / `degraded`）。调用方唯一的按能力分支依据。
- **规划条目（planning item）**：列表行的键。行以 `entityId` 为键，内容三态 `work_item` / `change_request` / `redacted` 决定这一行长什么样、能做什么。

### 相关文件与当前状态

| 路径 | 当前状态 |
|---|---|
| `packages/ui-model/src/index.ts` | 8 行，只有 `packageId` 与包责任声明 |
| `packages/ui-model/package.json` | 依赖只有 `@harness-projects/domain` 与 `@harness-projects/client`（无 `ui`、无 provider、无 React） |
| `packages/client/src/store.ts` | `EntityStore`：`applyBaseline` / `applyDelta` / `markAllStale` / `get` / `list` / `isCurrent`；`list()` 按 `entityId` 稳定排序 |
| `packages/client/src/sync.ts` | `WorkspaceSync`：`connected` / `revision` / `connect` / `reconnect` / `poll`；缺口窗口内 store 整体 stale |
| `packages/controller/src/wire.ts` | `WireEntity` 的字段面：`entityId` / `kind` / `planningStatus` / `content{contentKind,title,body,bindingId,externalKind,externalId}` / `derived` / `source{revision,freshness,authority,reason}` |
| `packages/domain/src/enums.ts` | `ContentKind`、`NormalizedStatus`、`DerivedFlag`、`AccessLevel` 的权威取值 |
| `packages/capabilities/src/capability-keys.ts` | `CapabilityKey` 表与 `EffectiveCapability`；本层**不能** import 它（依赖矩阵不允许），因此 key 取值以字面量落在本层并由契约测试钉死（见 Design） |
| `tests/contract/package-boundaries.test.js` | 允许的依赖边：`ui-model -> client, domain`；外部依赖 `react` / `react-dom` 只允许出现在 `ui` 与 `apps/*` |
| `tests/contract/capabilities-keys.test.js` | 已有的"平台名不得进入调用方分支依据"写法，本层照同一纪律加一条针对 `packages/ui-model/src` 的机械扫描 |

### 上游依据

- issue #128 的验收标准逐条抄进本计划的 `Validation and Acceptance`，不改写、不合并。
- `docs/product/vertical-path.md` §2 步骤 1–5 是本层展示范围的来源：步骤 1（工作区列表与连接状态）→ 项目首页；步骤 3–4（三类内容身份、规划字段、缺能力显示不可用而不是空列表）→ 工作项列表；步骤 5（规划字段、来源身份、工程谱系入口、陈旧标记）→ 统一详情。
- `docs/README.md` 的 Active 索引表由本计划插入一行；`docs/exec-plan/active/README.md` 只描述用法，不改。

## Design / Spec

### 输入契约：一次"工作区读取"

展示结构的输入是一个显式的读取对象，而不是散落的参数。它把"客户端模型"和"宿主才知道的事实"分开：

```ts
interface WorkspaceRead {
  workspace: { id: string; name: string }          // 宿主提供：wire 目前不暴露工作区身份
  store: EntityStore                               // 客户端模型：条目、stale、revision
  connection: { connected: boolean }               // WorkspaceSync 的结构面
  lastUpdatedAt: string                            // 宿主提供：最后一次读到当前值的时刻（ISO 8601）
  capabilities?: readonly CapabilitySnapshotEntry[] // 省略 = 未观测到任何能力 = 一律不可用
  reason?: string | undefined                      // 宿主已知的连接降级原因
}
```

三条边界决策：

1. **工作区身份由宿主提供**。wire 不暴露 workspace，`EntityStore` 也不带工作区。展示层不发明身份，只把宿主给的身份与客户端模型的连接状态拼在一起。
2. **时间由宿主提供**。wire 与 client 都不带任何时间戳（`source.revision` 是修订号，不是时间）。展示层不读时钟：同一输入必须得到同一输出，否则"陈旧行带最后更新时间"这条验收无法用 fixture 判定。宿主在每次成功应用基线或增量后推进 `lastUpdatedAt`；缺口窗口里它保持在上一次成功读取的时刻，这正是陈旧行要显示的值。`lastUpdatedAt` 不可解析时**响亮失败**（`TypeError`），而不是渲染 `Invalid Date`。
3. **能力快照按结构接收**。`CapabilitySnapshotEntry { key: string; access: AccessLevel; reason?: string }` 与 `EffectiveCapability` 结构兼容，宿主可以直接把 `effectiveCapabilities(...)` 的结果传进来，而本层不需要（也不允许）import `@harness-projects/capabilities`。

### 三组展示模型

**项目首页** `deriveProjectsHome(reads) -> ProjectsHome`：

```ts
interface WorkspaceHome {
  workspace: { id: string; name: string }
  connection: 'connected' | 'degraded' | 'disconnected'
  revision: number
  lastUpdatedAt: string
  reason: string | undefined
  sources: readonly string[]            // 客户端模型里出现过的 bindingId，去重排序
  items: { total: number; stale: number; byContentKind: Record<ContentKind, number> }
}
```

连接状态是派生的，不是新的事实源：`connected === false` → `disconnected`；已连接但有任一 stale 条目或宿主给出 `reason` → `degraded`；否则 `connected`。

**工作项列表** `deriveWorkItemList(read) -> WorkItemList`：每行以 `entityId` 为键，顺序沿用 `store.list()` 的稳定顺序。

```ts
interface WorkItemRow {
  entityId: string
  contentKind: ContentKind              // 内容种类：work_item / change_request / redacted
  title: string | undefined             // redacted 必须为 undefined：页面显示占位，不得回退到缓存标题
  planningStatus: NormalizedStatus      // 规划字段：权威值
  derived: readonly DerivedFlag[]       // 派生标记：只用于展示，永不参与规划状态判定（不变量 3）
  source: SourcePresentation            // 来源：主内容身份 + 权威归属 + 模型暴露的全部身份
  freshness: FreshnessPresentation      // 新鲜度：stale / lastUpdatedAt / reason
  actions: readonly ActionAvailability[]// 该行**提供**的动作；可用性只来自 capability key
}
```

**统一详情** `deriveWorkItemDetail(read, entityId) -> WorkItemDetail | undefined`：

```ts
interface WorkItemDetail {
  entityId: string
  planning: { entityId; contentKind; title; body; status; derived }   // 规划段
  source: SourcePresentation                                          // 来源身份
  lineage: readonly LineageEntryPoint[]                               // 谱系入口
  freshness: FreshnessPresentation
  actions: readonly ActionAvailability[]
}
```

`entityId` 不在客户端模型里时返回 `undefined`（页面显示"未找到"，而不是造一个空壳）。

谱系入口是**导航目标**，不是动作：`execution_context` / `change_request` / `pipeline_run` / `check_run`，每个带 `available`、`access`、`reason`、`requiredKeys`。文案由页面拥有，展示层只给稳定的 `target` 取值。

### 动作可用性：提供与否 vs 可用与否

这是本层最容易做错的一处，拆成两条独立规则：

1. **是否提供**（结构）：只有 `contentKind === 'work_item'` 的条目提供 `start_work`。PR 支撑的条目（`change_request`）与 `redacted` 条目**不提供**这个动作——它们的 `actions` 列表里没有 `start_work`。这是 issue #128 的验收标准之一，也是唯一一处按内容种类决定动作提供的规则。
2. **是否可用**（环境）：被提供的动作，可用性**只**来自 capability key，且按**用途**分两种（与 core 的 `gateCommand(registry, key, mode)` 同一条约定，见 `packages/core/src/capabilities.ts`）：
   - **写动作**（`start_work`）：任一必需 key 为 `unavailable` 或 `read_only` → 不可用（只读凭据不能完成写动作）；任一为 `degraded` → 可用但带降级标记；全部 `available` → 可用。
   - **只读目标**（谱系入口）：只有 `unavailable` 阻断；`read_only` 与 `degraded` 都可用，`access` 原样透出让页面显示"只读"。

   未声明的 key 一律视为 `unavailable`（权限未知不得当成可用，与 `capabilities` 层的语义一致）。`reason` 在 `access !== available` 时给出并点名起作用的 key。

`start_work` 的必需 key：`development.branch.create`、`development.worktree.create`、`execution.run.start`。谱系入口的必需 key：`execution_context` → `execution.run.read`；`change_request` → `development.change_request.read`；`pipeline_run` → `delivery.pipeline.read`；`check_run` → `delivery.check.read`（四个都是 `.read`，所以只读凭据下必须可用）。

**key 取值以字面量落在本层**，因为依赖矩阵（`AGENTS.md` §2）不允许 `ui-model` import `capabilities`。这不是第二个权威源：契约测试把本层实际输出的每一个 `requiredKeys` 取值与 `CapabilityKey` 表逐字比对，表变了而本层没跟上就变红。

**来源标识不参与判定**：`bindingId` 只被原样回显，任何"名字里含某平台（或某前缀）⇒ 结论改变"的分支都是缺陷。这条性质**不靠黑名单**固定，而靠判别性断言：同一份输入配 12 个对抗性标识（`gh-projects`、`gh-1`、`gh`、`github`、`binding-github-projects`、`gitlab-binding`、`azure-devops`、`sqlite-local`、空串、空白串等），断言列表 / 首页 / 详情 / 谱系入口的结论逐字相同，只有回显字段可以变。黑名单扫描（`packages/ui-model/src` 不含平台名片段）作为第二张网保留。

### 新鲜度：客户端条目标记与连接状态的合成

`stale` 是**展示结论**，由两个输入合成，任一为降级即降级（fail closed）：

```
stale = 条目在客户端模型里已陈旧 || 连接不可用 || 宿主从未读到当前值（lastUpdatedAt === undefined）
```

- 连接不可用时，store 里的值只能是"最后已知"，不能报成当前值；`lastUpdatedAt` 仍然透出，页面显示"最后已知于 …"。
- **零条目也不得看起来正常**：`WorkItemList` 带 `connection` 与 `reason`，且整表 `stale` 在连接降级时为真；"从未读到 + 零条目"必须能被页面识别成降级空态。
- 首页、列表、详情共用同一条规则（同一个 `isStale` / `connectionStateOf`），同一份读取不允许在两处给出相反结论。
- `lastUpdatedAt` 省略表示"从未读到当前值"（合法的降级形态）；给了值但不可解析才是宿主接线缺陷，抛 `TypeError`。展示层仍然不读时钟。

### 被放弃的方案

| 方案 | 放弃原因 |
|---|---|
| 在 `ui-model` 里 import `@harness-projects/controller` 拿 `WireEntity` 类型 | 依赖矩阵不允许 `ui-model -> controller`；改矩阵需要 ADR 与契约测试，而本层不需要它。改用 `StoredEntity['entity']` 的索引访问类型，类型仍然来自同一条链，但不新增依赖边 |
| 让 `ui-model` 自己记"上次成功读取的时刻" | 展示层会获得内部状态，同一输入不再得到同一输出，且与不变量 7（Host 拥有权威状态，前端只是消费者）冲突：前端不该维护第二个时间事实源 |
| 在 `ui-model` 里 import `@harness-projects/capabilities` 拿 `CapabilityKey` | 同上，依赖矩阵不允许。改用字面量 + 契约测试钉死 |
| 陈旧快照返回空列表，让页面显示空态 | 正是 issue #128 要消灭的故障形态：降级被显示成"没有工作项"。陈旧必须如实显示为陈旧 |
| 按 provider 名判断动作可用性（"某平台不支持分支创建"） | 平台名会进入调用方分支依据，且新增 provider 就要改展示层。能力差异已经由 capability key 表达 |
| 本层顺手实现 React 组件 | 超出 issue 范围（Out of scope 明列），且会把 React 带进 React-free 层，`package-boundaries` 直接失败 |

### 关键不变量

- **不变量 3**（规划与工程状态正交）：`planningStatus` 与 `derived` 在展示结构里是两个字段；`derived` 只用于展示，派生标记永不写进 `planningStatus`。
- **不变量 7**（Host 拥有权威状态，前端只是消费者）：展示层是纯函数，无内部状态、不读时钟、不写回；`source.authority` 原样透出，页面不得把 host 权威值显示成平台权威。
- **内容身份**：`redacted` 条目的 `title` / `body` 恒为 `undefined`，页面必须显示占位，不得回退到缓存标题。
- **降级不隐藏**：陈旧行留在列表里，带 `stale` 与 `lastUpdatedAt`；缺能力显示为不可用并点名 key，而不是空列表。

## Global Constraints

- 本计划改动的文件集合（唯一声明处）：
  - 新增 `docs/exec-plan/active/2026-09-24-ui-model-presentation.md`（归档后位于 `docs/exec-plan/completed/`）
  - 修改 `docs/README.md`（Active 索引表插入本计划一行）
  - 新增 `packages/ui-model/src/types.ts`、`packages/ui-model/src/capability-access.ts`、`packages/ui-model/src/derive.ts`
  - 修改 `packages/ui-model/src/index.ts`（包责任声明 + 再导出）
  - 新增 `tests/contract/ui-model-presentation.test.js`
  - 不新增其它文件；不改任何 `packages/providers/*`、`packages/capabilities/*`、`packages/client/*`、`packages/controller/*`、`packages/ui/*`、`apps/*`、`scripts/*`、workflow、`package.json`、`pnpm-lock.yaml`
- 代码变更 ≤1000 行、文档变更 ≤1500 行，按本 PR 自己声明的 base 度量：`node scripts/rule-checks.mjs size origin/test/harness-host-spike`（栈化前该分支与 `origin/main` 同点，当时用 `origin/main` 度量；Batch 6 之后 base 是 `test/harness-host-spike` 的 `ce8ca7e`，度量基线随之改为它，并在 PR 描述里写清）。
- 不新增依赖：`packages/ui-model/package.json` 的依赖保持只有 `@harness-projects/domain` 与 `@harness-projects/client`；`packages/ui-model` 不 import React，也不 import 任何 provider。
- `grep -rn "github" packages/ui-model/src` 与 `grep -rn "react" packages/ui-model/src` 均无命中；平台名（含其它平台）不进入 `packages/ui-model/src` 的任何分支或注释。
- 不实现 React 组件；不做统一详情的工程段与交付段。
- 沙箱下所有 `pnpm` 命令必须带 `npm_config_manage_package_manager_versions=false` 前缀。
- 只在检出 `feat/ui-model-presentation` 的工作树（`.worktrees/w14-d3b`）里改文件；不 push `main`；不自行合并；PR 保持 draft。
- 仓库文件里不写凭据、账号、内网信息、本机绝对路径。

## Plan of Work

### Batch 1 · 计划与索引

**最小闭环**：本计划可被第三方独立读懂，且 `docs/README.md` 的 Active 索引指向它。
**涉及文件**：`docs/exec-plan/active/2026-09-24-ui-model-presentation.md`、`docs/README.md`。
- [ ] 写全 `PLANS.md` §3 的强制章节（spec + plan 合一）
- [ ] `docs/README.md` 的 Active 表插入本计划一行（只插自己这一行，不为其它层预留）
- [ ] 提交并 push 分支，建 draft PR（base 先写 `main`），回读 closing 引用

**验证**：

```bash
node scripts/rule-checks.mjs size origin/test/harness-host-spike
node scripts/rule-checks.mjs disclosure origin/test/harness-host-spike
git diff --check origin/test/harness-host-spike...HEAD
```

（Batch 1 当时 `test/harness-host-spike` 与 `origin/main` 同点，用哪个基线都是同一组数字；栈化之后一律用本层声明的 base，见 `Global Constraints`。）
期望：size 的 docs 桶远低于 1500 行；disclosure 干净（exit 0）；`diff --check` 无输出。
**回滚**：`git checkout -- docs/README.md && rm docs/exec-plan/active/2026-09-24-ui-model-presentation.md`。

### Batch 2 · 先红：fixture 快照上的判别性用例

**最小闭环**：在实现之前，用例必须失败，且失败原因指向"展示结构还不存在"。
**涉及文件**：`tests/contract/ui-model-presentation.test.js`。
- [ ] fixture：一个 `WireSnapshot` 形态的快照，含 fresh 的 `work_item`、fresh 的 `change_request`（PR 支撑）、`degraded` 的 `redacted` 条目
- [ ] 用例逐条点名它保护的不变量（`tests/README.md` §3），覆盖：三组展示结构、PR 支撑行不提供 `start_work`、陈旧快照不返回空列表、动作可用性只来自 capability key、key 取值属于 `CapabilityKey` 表、`packages/ui-model/src` 不含平台名

**验证**：

```bash
export npm_config_manage_package_manager_versions=false
node --test tests/contract/ui-model-presentation.test.js
```

期望（先红）：`ℹ fail` 非零，失败信息指向 `@harness-projects/ui-model` 尚未导出展示结构。
**回滚**：删除该测试文件。

### Batch 3 · 转绿：实现三组展示结构

**最小闭环**：Batch 2 的用例全部通过，`pnpm verify` 与 `pnpm run boundaries` 仍全绿。
**涉及文件**：`packages/ui-model/src/types.ts`、`packages/ui-model/src/capability-access.ts`、`packages/ui-model/src/derive.ts`、`packages/ui-model/src/index.ts`。
- [ ] `types.ts`：输入契约与三组展示结构（纯类型 + 少量常量对象）
- [ ] `capability-access.ts`：capability key 字面量、四态求交与 `ActionAvailability` / `LineageEntryPoint` 派生
- [ ] `derive.ts`：`deriveProjectsHome` / `deriveWorkItemList` / `deriveWorkItemDetail`，纯函数、不读时钟、不改入参
- [ ] `index.ts`：保留 `Responsibility:` / `Allowed imports:` 声明并再导出

**验证**：

```bash
export npm_config_manage_package_manager_versions=false
node --test tests/contract/ui-model-presentation.test.js   # 期望 ℹ fail 0
pnpm verify                                                # 期望 exit 0
pnpm run boundaries                                        # 期望 ℹ fail 0
```

**回滚**：`git checkout -- packages/ui-model/src/index.ts && rm packages/ui-model/src/{types,capability-access,derive}.ts`（测试同时变红，说明还原彻底）。

### Batch 4 · 变异实验（判别性证据）

**最小闭环**：两条变异各自让对应用例变红，还原后变绿；红/绿实测输出逐条记入 `Surprises & Discoveries`。
**涉及文件**：临时改 `packages/ui-model/src/derive.ts` 与 `packages/ui-model/src/capability-access.ts`，实验后逐字还原（`git diff` 必须为空）。
- [ ] 变异 A：陈旧快照时返回空列表（`deriveWorkItemList` 在整体陈旧时返回 `rows: []`）→ 陈旧用例必须变红
- [ ] 变异 B：按 provider 名判断可用性（`bindingId` 含某平台名时 `start_work` 不可用）→ 平台名无关性用例必须变红

**验证**：每次变异后 `node --test tests/contract/ui-model-presentation.test.js`（期望 `ℹ fail` 非零且失败用例名对得上），还原后同一命令 `ℹ fail 0`。
**回滚**：`git checkout -- packages/ui-model/src`。

### Batch 5 · 验证、提交与 PR 描述

**最小闭环**：`Validation and Acceptance` 的每一行都有真实输出；PR 描述包含闭环、关联、验证证据、风险与回滚、请评审。
**涉及文件**：本计划（Progress / Surprises / Decision Log / Outcomes / Bottom Change Note）、PR 描述文件（放 `.superpowers/`，不进版本库）。
- [ ] 跑完整验证命令并把真实输出写进 PR 描述
- [ ] 整理提交（一个计划提交 + 一个实现提交，无 fixup / debug）
- [ ] push、`gh pr edit <n> --body-file <文件>`、回读 PR 的 head / base / draft / labels / milestone / closing 引用

**验证**：见 `Validation and Acceptance` 的命令清单。
**回滚**：`git revert <实现提交>`；分支删除前不合并。

### Batch 6 · 栈化到 D3 栈第 2 层

**最小闭环**：本分支真正叠在 `test/harness-host-spike` 之上（不再与它平行），rebase 后全部验证重跑通过，体量按新 base 度量。
**涉及文件**：`docs/README.md`（Active 索引表，两边都保留）、本计划（栈化记录）。
- [x] `git fetch origin`；建恢复锚点 `git branch backup/w14-d3b-pre-stack <rebase 前 head>`
- [x] `git rebase origin/test/harness-host-spike`；`docs/README.md` 冲突按"两边都保留、按栈位置排序"解
- [x] rebase 后重跑：`pnpm verify`、`pnpm run boundaries`、`node --test tests/contract/ui-model-presentation.test.js`、`node scripts/rule-checks.mjs size origin/test/harness-host-spike`、`node scripts/rule-checks.mjs disclosure origin/test/harness-host-spike`、`git diff --check origin/test/harness-host-spike...HEAD`
- [x] 精确 lease 强推：`git push --force-with-lease=refs/heads/feat/ui-model-presentation:<旧远端 head> origin HEAD:refs/heads/feat/ui-model-presentation`
- [ ] 回读 `gh pr view 158` 与 `gh pr checks 158`；**不改 PR base**（retarget 由主控执行）

**验证**：见 `Progress` 的「栈化记录（Batch 6）」。
**回滚**：`git reset --hard backup/w14-d3b-pre-stack` 并再次精确 lease 强推回旧 head；恢复锚点在 rebase 前建立，未推送的历史改写不覆盖它。

### Batch 7 · 按独立对抗验证修复（3 条 P2 + 3 条 P3）

**最小闭环**：对抗验证点出的六条全部有根因修法与判别性证据；七条变异各自变红，还原后全绿。
**涉及文件**：`packages/ui-model/src/{types,derive,capability-access}.ts`、`tests/contract/ui-model-presentation.test.js`、本计划。
- [x] P2-1 来源标识无关性：把黑名单依赖改成性质断言（12 个对抗性 `bindingId`），补变异实验 M1
- [x] P2-2 连接状态参与列表派生：`stale` = 条目标记 ∪ 连接不可用 ∪ 从未读到；列表带 `connection` / `reason`；`lastUpdatedAt` 可为 `undefined`（契约里表达"从未读到"）；补用例与变异 M2 / M2b
- [x] P2-3 用途分读写：只读导航在 `read_only` 下可用（与 `packages/core/src/capabilities.ts` 的 `mode === 'write'` 门一致）；补用例与变异 M3
- [x] P3-4 / P3-5 订正本计划的易失值与基线口径（head、行数、`origin/main` → `origin/test/harness-host-spike`）
- [x] P3-6 fixture 与 wire 字段面机械同形（解析 `wire.ts` 的字段名逐字比对），补变异 M6
- [x] 第二次 rebase 到 `5151f77`（D3-L1 的订正提交），并把 #124 的两条评论（裁决 + 排序订正）记入 S6 / D10
- [x] 重跑全部验证、整理提交、精确 lease 强推

**验证**：见 `Progress` 的「对抗验证修复记录（Batch 7）」与 `Surprises & Discoveries` S7。
**回滚**：`git reset --hard backup/w14-d3b-pre-review-fix`（修复前 head）或 `backup/w14-d3b-pre-rebase2`（第二次 rebase 前 head），并精确 lease 强推回旧 head。

## Validation and Acceptance

| # | 验收项（issue #128 逐条） | 判定证据 |
|---|---|---|
| 1 | 三组展示模型：项目首页（工作区及其连接状态）、工作项列表（行以规划条目为键，带内容种类、规划字段、来源与新鲜度）、统一详情（规划段、来源身份、谱系入口） | `node --test tests/contract/ui-model-presentation.test.js` 中"首页 / 列表 / 详情"三条用例；导出面见 `packages/ui-model/src/index.ts` |
| 2 | 动作可用性只来自 capability key：`grep -rn "github" packages/ui-model/src` 无命中，不按 provider 名分支 | 该 grep 无输出（exit 1）；用例「绑定标识里出现平台名不改变可用性」；用例「本层输出的每个 requiredKeys 都在 CapabilityKey 表里」；用例「`packages/ui-model/src` 不含平台名片段」 |
| 3 | PR 支撑的规划条目 → 行内容种类是 change request，且不提供"开始工作"动作 | 用例「PR 支撑的条目是 change request 行且不提供开始工作」（同一用例里对照工作项行**提供**该动作，因此"都不提供"的实现会变红）；详情同样不提供 |
| 4 | 陈旧快照 → 行标记为陈旧并带最后更新时间，绝不返回空列表 | 用例「陈旧快照的列表非空且每行带 stale 与 lastUpdatedAt」；变异 A 的红色输出 |
| 5 | `pnpm run boundaries` 通过；`ui-model` 不 import React，也不 import 任何 provider | `pnpm run boundaries` 的 `ℹ fail 0`；`package-boundaries.test.js` 的依赖矩阵（`ui-model -> client, domain`、`react` 只允许 `ui` / `apps/*`）；`grep -rn "react" packages/ui-model/src` 无命中 |
| 6 | 单元测试建在 fixture 快照上（不触网、不需要凭据），用例名说明保护哪条不变量 | 测试文件只 import 各包源码与 `node:test`，无网络、无凭据；用例名逐条点名不变量 |
| 7 | 不实现 React 组件；不做统一详情的工程段与交付段 | `git diff --stat origin/test/harness-host-spike...HEAD` 的文件集合与 `Global Constraints` 一致（栈化前用 `origin/main` 会连带把 D3-L1 的探针文档算进来，判别不出本层文件集合）；详情类型里没有工程段 / 交付段字段 |
| 8 | 判别性证据：变异实验先红后绿（Batch 4 两条 + Batch 7 五条，共七条） | `Surprises & Discoveries` 的 S3 / S4 / S7 逐条记录命令与实测输出 |
| 9 | 规模与发布面 | `node scripts/rule-checks.mjs size origin/test/harness-host-spike`（code ≤1000、docs ≤1500）、`node scripts/rule-checks.mjs disclosure origin/test/harness-host-spike`（exit 0）、`git diff --check origin/test/harness-host-spike...HEAD`（无输出） |
| 10 | 来源标识不影响任何结论（不靠黑名单） | 用例「来源标识不影响任何结论」用 12 个对抗性 `bindingId`（含 `gh-projects`、`gh-1`、`gh`、空串）断言列表 / 首页 / 详情 / 谱系入口逐字相同；变异实验 M1（`gh-` 前缀分支）必须变红 |
| 11 | 连接降级不被显示成正常空态 | 用例「连接不可用时最后已知行一律标陈旧，首页与列表不得给出相反结论」「从未读到当前值 + 零条目也不长得像正常空态」「已连接但宿主从未给出最后更新时间时按降级处理」；变异实验 M2 / M2b 必须变红 |
| 12 | 只读凭据下只读导航仍然可用（与 core 的写门一致） | 用例「只读凭据下谱系入口仍然可用」断言四个入口 `available: true` / `access: read_only`，同份凭据下写动作不可用；变异实验 M3 必须变红 |
| 13 | fixture 与 wire 字段面机械同形 | 用例「fixture 快照与 wire 的字段面机械同形」解析 `packages/controller/src/wire.ts` 的 `WireEntity` / `WireContentRef` / `SourceMetadata` / `WireSnapshot` 字段名并与 fixture 键集合逐字比对；变异实验 M6 必须变红 |

## Progress

- [x] Batch 1 · 计划与索引（2026-09-24 完成）：计划与 `docs/README.md` 索引已提交（`c5726b6`），draft PR #158 已建，`closingIssuesReferences` 与 `closedByPullRequestsReferences` 双向回读非空
- [x] Batch 2 · 先红（2026-09-24 完成）：13 条用例、`ℹ pass 0 / ℹ fail 1`，失败信息 `SyntaxError: The requested module '@harness-projects/ui-model' does not provide an export named 'LineageTarget'`（在工作树自带的 `node_modules` 上重做，见 Surprises S1）
- [x] Batch 3 · 转绿（2026-09-24 完成）：`node --test tests/contract/ui-model-presentation.test.js` → `ℹ tests 13 / ℹ pass 13 / ℹ fail 0`；`pnpm verify` exit 0（459 + mvp0 7）；`pnpm run boundaries` → `ℹ tests 7 / ℹ fail 0`
- [x] Batch 4 · 变异实验（2026-09-24 完成）：变异 A 2 条红、变异 B 2 条红，逐字还原后 13 条绿（见 Surprises S3 / S4）
- [x] Batch 5 · 验证与 PR（2026-09-24 完成）：实现提交 `93210e4`，`size` code 815 / docs 455，`disclosure` exit 0，`git diff --check` 无输出
- [x] Batch 6 · 栈化（2026-09-23T07:49Z 完成）：本层已 rebase 到 `test/harness-host-spike` 的 `ce8ca7e` 之上，成为 **D3 栈的第 2 层**（第 1 层是宿主探针 #125）。rebase 前建了恢复锚点 `backup/w14-d3b-pre-stack`（= `a720b8a`）；rebase 后 head 为 `09274b0`，验证全部重跑并通过（见下）
- [x] Batch 7 · 按独立对抗验证修复（2026-09-23T08:00Z 完成修复，08:23:54Z 完成第二次 rebase）：3 条 P2 + 3 条 P3 逐条按根因修，七条变异实验全部变红后逐字还原；再次 rebase 到 `test/harness-host-spike` 的新 head `5151f77`（D3-L1 的订正提交，只碰探针文档，零冲突）；同时把 #124 的**排序订正回复**（08:14:42Z）记入 S6 / D10，并把"开工"口径改为 `workflow.md` §1 的"创建 draft PR"（#158 创建于 07:30:11Z，早于裁决评论 8 分 53 秒）

- [x] Batch 8 · 按评审根因修复（2026-09-23 完成）：PR #158 的 10 条 review thread 全部核实**属实**（无一条不同意），按机制归为 A–E 五组、一处改动解决一组里的多条；先 rebase 到新 `main`（`940046e`，丢掉已被 rebase-merge 进 main 的两个探针提交）再改；五组各配判别性证据（旧实现变红 / 变异变红）；代码 993 / 1000、文档见回读命令。逐条见 `评审响应（2026-09-23，根因修复）`

- [x] Batch 9 · 预算回收（2026-09-24 完成）：撤销 Batch 8"把'为什么'整体移进本计划"的做法——本计划归档后不再被读，字段级理由必须在编辑现场。恢复 6 组承载推理的注释（`capability-access.ts` 三处、`derive.ts` 两处、`types.ts` 一处，每条 1–3 行），改用**回收 dead code 与重复脚手架**支付：`readFor` 的 `workspace` 选项零调用方覆盖（`grep -c 'readFor({[^}]*workspace'` → 0），`wireEntity` / `fixtureSnapshot` / `sourceOf` / `homeOf` 的重复脚手架收敛。代码 **986 / 1000**（比 Batch 8 低 7 行），断言一条未删、判别力未降。见下方「意见 7」的 `Superseded by Batch 9` 与 `Bottom Change Note`

- [x] Batch 10 · 第二轮 MMP 评审（2026-09-23 完成）：锁定 head `8ed0d65`，**无 P0 / P1**；第一轮 10 条修复在当前 head 上全部成立；#128 四条验收逐条成立。两条新意见的处置见「评审响应（2026-09-23，第二轮 MMP 评审）」。随后变基到含 #159 的 `main`（`721e42a`，零冲突），本计划归档，提交按可独立回滚的交付物收敛为三个（实现与测试 / 本计划 / 评审记录），恢复锚点 `backup/w14-d3b-pre-review3`（`8ed0d65`）

### 对抗验证修复记录（Batch 7）

对抗验证（fresh agent）的裁决是 `partially_falsified`：核心交付经受住了变异 2/3/4/5，但有 3 条 P2、3 条 P3。逐条修法与证据：

| # | 发现 | 根因 | 修法 | 判别性证据 |
|---|---|---|---|---|
| P2-1 | 平台名无关性只有黑名单一张网：在 `actionsFor` 首行加 `bindingId.startsWith('gh-')` 后 **13/13 全绿**，两条 grep 证据仍成立 | 行为用例只试了 `binding-github-projects` 一个标识，黑名单又不含 `gh`；性质被写成了"列举已知名字" | 把性质做成断言：12 个对抗性 `bindingId`（`gh-projects`、`gh-1`、`gh`、`github`、`gitlab-binding`、`azure-devops`、`sqlite-local`、空串、空白串等）跑同一份输入，断言列表 / 首页 / 详情 / 谱系入口逐字相同（只有回显字段可变）；黑名单扫描降为第二张网 | 变异 M1（`gh-` 前缀分支）→ `不变量：来源标识不影响任何结论…` 变红；还原后 18 绿 |
| P2-2 | 列表完全忽略 `connection.connected`：store 3 条 + `connected:false` 时首页说 `disconnected`、列表却报 `stale:false`；零条目 + 不可达时 `rows=0 / stale=false`，即"空且看起来正常" | `isStale` 只看客户端模型的条目标记，连接状态没进列表派生；`lastUpdatedAt` 又是必填，契约里没有"从未读到"的形态 | `stale = 条目标记 ∪ 连接不可用 ∪ 从未读到`（首页 / 列表 / 详情共用）；`WorkItemList` 增 `connection` 与 `reason`，整表 `stale` 含连接降级；`WorkspaceRead.lastUpdatedAt` 与 `FreshnessPresentation.lastUpdatedAt` 改为 `string \| undefined`（`undefined` = 从未读到，仍是宿主注入，展示层不读时钟） | 变异 M2（`isStale` 忽略连接）→ 2 条红；变异 M2b（列表硬编码 `connected`）→ 3 条红；还原后 18 绿 |
| P2-3 | `read_only` 被复用到只读的谱系导航：四个入口的必需 key 全是 `.read`，却在 `read_only` 下被判不可用；core 的权威约定相反 | `decide()` 对写动作与只读导航共用一条"read_only → 不可用"规则 | `decide()` 增用途参数：写动作 `read_only` 阻断，只读目标只有 `unavailable` 阻断（与 `packages/core/src/capabilities.ts` 的 `mode === 'write'` 门一致）；`access` 原样透出让页面显示"只读" | 变异 M3（谱系入口改用写模式）→ `不变量：只读凭据下谱系入口仍然可用…` 变红；还原后 18 绿 |
| P3-4 | 计划里的体量与 head 不是声明 head 上的实测值（写 455 / head `09274b0`，声明 head 上实测 499） | 栈化时只更新了部分易失值，且 amend 改了 head 而正文没跟上 | 全部按最终 head 重测，正文写明"观测时刻 + head + 回读命令"；被取代的旧值就地标 `Superseded` | `Outcomes & Retrospective` 的实测块与 `node scripts/rule-checks.mjs size origin/test/harness-host-spike` |
| P3-5 | `Validation` 第 7/9 行用 `origin/main` 作基线，会把 D3-L1 的探针文档算进本层 | 栈化后没有同步改判定证据里的命令 | 两行改为 `origin/test/harness-host-spike`，并说明为什么旧基线判别不出本层文件集合 | 表内命令与 `Global Constraints` 的基线一致 |
| P3-6 | fixture 声称与 `wire.ts` 的 `WireEntity` 同形，但没有机械手段钉住（fixture 是 `.js`，`tsconfig` 不含 `tests/**`） | "同形"只写在注释里 | 新增结构用例：解析 `wire.ts` 的 `WireEntity` / `WireContentRef` / `SourceMetadata` / `WireSnapshot` 字段名，与 fixture 的键集合逐字比对 | 变异 M6（给 fixture 加一个 wire 里不存在的字段）→ `结构：fixture 快照与 wire 的字段面机械同形…` 变红；还原后 18 绿 |

**修复后的实测（Batch 7，base `origin/test/harness-host-spike`）**：

```text
$ node --test tests/contract/ui-model-presentation.test.js
ℹ tests 17 / ℹ pass 17 / ℹ fail 0
$ pnpm verify
ℹ tests 463 / ℹ pass 463 / ℹ fail 0 ；ℹ tests 7 / ℹ pass 7 / ℹ fail 0 ；verify-exit=0
$ pnpm run boundaries
ℹ tests 7 / ℹ pass 7 / ℹ fail 0 ；boundaries-exit=0
$ grep -rn "github" packages/ui-model/src ; echo "grep-exit=$?"   → grep-exit=1
$ grep -rn "react"  packages/ui-model/src ; echo "grep-exit=$?"   → grep-exit=1
$ node scripts/rule-checks.mjs size origin/test/harness-host-spike   → 见 Outcomes（按最终 head 重测）
$ node scripts/rule-checks.mjs disclosure origin/test/harness-host-spike   → exit 0
$ git diff --check origin/test/harness-host-spike...HEAD                  → 无输出，exit 0
```

变异实验的完整清单与红/绿对照见 S7；七条变异（M1 `gh-` 前缀、M2 `isStale` 忽略连接、M2b 列表硬编码连接、M3 谱系用写模式、M4 陈旧返回空列表、M5 key 字面量漂移、M6 fixture 漂移）各自变红后逐字还原，判据是 `diff` 与备份一致。

### 栈化记录（Batch 6）

- **时间**：2026-09-23T07:49:50Z（2026-09-23T15:49:50+08:00）
- **新 base**：`origin/test/harness-host-spike` = `ce8ca7ef0786990e757905fc9f0282ba7566fe28`（该分支在 `4d46559` 之上有 3 个提交：`f40370d` 探针计划、`63f9552` 裁决记录、`ce8ca7e` 勾选 Batch 4）
- **新 head**：`09274b0`（rebase 后重写了三个提交：计划 `dd8dfbd` / 实现 `99bedf1` / 执行记录 `09274b0`）
  - **Superseded（2026-09-23T08:00Z）**：该 head 已被 Batch 7 取代；最终 head 见「对抗验证修复记录（Batch 7）」。这里保留原值是因为它记录了栈化当时的观测。
- **恢复锚点**：`backup/w14-d3b-pre-stack` = `a720b8a`（rebase 前的 head，未推送新历史前的回退点）
- **冲突与解法**：只有 `docs/README.md` 的 Active 索引表冲突（两边都在表尾追加了自己的计划行，`f40370d` 追加探针行、本层追加 ui-model 行）。按批次约定**两边都保留**，按栈位置排序——探针行（`2026-09-24-harness-host-spike`）在前，本层行（`2026-09-24-ui-model-presentation`）在后。其余 6 个文件零冲突（探针只新增 `docs/` 文档，与本层的 `packages/ui-model` 与 `tests/contract` 不重叠）
- **裁决与评论（同批记录）**：裁决 `fallback-web`（决定它的是问题 4），记录在 `docs/architecture/harness-host-spike.md` §7；#124 上的评论 <https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-5790974840>（2026-09-23T07:39:04Z）把 #128 列在「范围不变的子 issue」里。栈化不改变这条判断：本层仍与宿主承载方式无关
- **体量口径改为本层自己声明的 base**：`node scripts/rule-checks.mjs size origin/test/harness-host-spike` → 代码 815 / 1000、文档 455 / 1500（栈累计相对 `origin/main` 为代码 815、文档 1016，只记录不判定）
  - **Superseded（2026-09-23T08:00Z）**：栈化当天的 455 是 `09274b0` 上的值；Batch 7 之后按最终 head 重测，见 `Outcomes & Retrospective`。这条被对抗验证判为 P3-4（记录的体量不是声明 head 上的实测值）。
- **rebase 后重跑的真实输出**（在检出 `feat/ui-model-presentation` 的工作树根目录）：

```text
$ node --test tests/contract/ui-model-presentation.test.js
ℹ tests 13 / ℹ pass 13 / ℹ fail 0
$ pnpm verify
ℹ tests 459 / ℹ pass 459 / ℹ fail 0 ；ℹ tests 7 / ℹ pass 7 / ℹ fail 0 ；verify-exit=0
$ pnpm run boundaries
ℹ tests 7 / ℹ pass 7 / ℹ fail 0 ；boundaries-exit=0
$ grep -rn "github" packages/ui-model/src ; echo "grep-exit=$?"   → grep-exit=1
$ grep -rn "react"  packages/ui-model/src ; echo "grep-exit=$?"   → grep-exit=1
$ node scripts/rule-checks.mjs size origin/test/harness-host-spike
代码：815 / 1000 行；文档：455 / 1500 行
$ node scripts/rule-checks.mjs disclosure origin/test/harness-host-spike   → exit 0
$ git diff --check origin/test/harness-host-spike...HEAD                  → 无输出，exit 0
```

## 评审响应（2026-09-23，根因修复）

PR #158 的 10 条 review thread **逐条核实后全部属实**，没有一条不同意——因此本节不写"反驳"，只写
"根因分组 → 改法 → 实测证据"。修复的原则是**按机制改，不按条目改**：同一组里的多条意见由一处改动
同时解决，而不是在每条意见的行号上打补丁。

| # | 意见（行号） | 属实 | 根因组 | 改法落点 |
|---|---|---|---|---|
| 1 | `derive.ts:126` 首页与列表对同一份读取给出不同降级原因；`home` 还可能 `degraded` 却无原因 | 是 | A | 唯一的 `degradationOf(read, entries)` |
| 2 | `capability-access.ts:22` `execution_context` 挂在 core 从不经过的 `execution.run.read` 上 | 是 | B | `LINEAGE_KEYS[ExecutionContext] = []` |
| 3 | `capability-access.ts:71` `reason` 把合成级别当成每个 key 的级别 | 是 | A | `decide` 逐 key 给出自己的级别 |
| 4 | `tests/…:460` 只断言 key 在表里，没断言"哪个 target 需要哪些 key" | 是 | B | 每个 target 一条 `deepEqual(requiredKeys, [...])` |
| 5 | `capability-access.ts:35` `intersect` 复刻了 `intersectAccess` | 是 | C | 4×4×4 差分用例把两者绑死 |
| 6 | `derive.ts:43` 本层自造两条英文散文原因 | 是 | D | `reason` 全线明确为 display-ready 散文，三条短语改中性中文 |
| 7 | ExecPlan 写"978 → 964"而 `Outcomes` 写 965 | 是 | 文档 | 本节与 `Outcomes` 按最终 head 重测，旧值就地标 `Superseded` |
| 8 | `tests/…:467` 黑名单里 `local` / `harness` 过宽 | 是 | E | 去掉这两个片段，scope 剥离正则放宽 |
| 9 | `derive.ts:25` `Date.parse` 接受的形态比注释声明的 ISO 8601 宽 | 是 | D | ISO 8601 正则 + 日期有效性双重校验 |
| 10 | `derive.ts:72` 每个 `work_item` 行重建一次 key→access `Map` | 是 | A | `accessIndex` 一次读取建一次并传下去 |

### 根因组 A —— 降级决策被算了两遍（意见 1、3、10）

**机制**：整表 `reason` 只由 `connectionReason(read)` 算，而 `homeOf` 另外回退到条目自身的
`source.reason`；同一份读取因此可以在两处给出相反结论，`home` 还可能 `degraded` 而没有原因。
**改法**：抽出唯一的 `degradationOf(read, entries)`，返回 `{ level, reason }`，首页 / 列表 / 详情共用；
原因优先级固定为「宿主原因 → 条目自身的原因 → 本层中性短语」，`degraded` 绝不无原因；`decide` 的
`reason` 逐 key 给出**它自己的**级别；能力索引 `accessIndex` 一次读取建一次。

**判别性证据**（旧实现 = `origin/feat/ui-model-presentation` 的 `packages/ui-model/src`，新用例不变）：

```text
$ node --test tests/contract/ui-model-presentation.test.js     # 旧实现 + 新用例
ℹ tests 21 / pass 15 / fail 6
  AssertionError: 条目自身原因：降级必须有解释
  AssertionError: The input did not match the regular expression /development\.branch\.create = read_only/
$ node --test tests/contract/ui-model-presentation.test.js     # 修复后
ℹ tests 21 / pass 21 / fail 0
```

「条目自身原因：降级必须有解释」正是意见 1 的形态：旧实现里 `home.reason` 是 `规划来源离线`，而
`list.reason` 是 `undefined`。

### 根因组 B —— 谱系入口的 key 必须等于 core 真实的读门（意见 2、4）

**机制**：`packages/core/src/chain-facts.ts` 的 `gated` 只为 `DevelopmentChangeRequestRead` /
`DeliveryPipelineRead` / `DeliveryCheckRead` 设门；`readExecutionContext` 是纯本地存储读，
`readChainFacts` 直接调用它，**core 从不为执行上下文设门**。挂 `execution.run.read` 会让这个入口在
真实工作区永久不可用、只在替身工作区可用——跟着测试替身走，不是跟着真实的门走。
**改法**：`LINEAGE_KEYS[ExecutionContext] = []`（必需 key 为空 = 该事实没有门、恒可用）；`decide` 在
必需 key 为空时返回 `access: 'available'` / `reason: undefined`。意见 4 的缺口用**精确列表断言**补上：
每个 target 一条 `deepEqual(entry.requiredKeys, [...])`，换成另一个合法 key 也会变红。

**判别性证据**：

```text
$ # 旧实现
  AssertionError: execution_context 由 core 直接读本地存储，没有任何读门
$ # 变异：把 execution_context 换成另一个合法 key（planning.item.read）
ℹ tests 21 / pass 18 / fail 3   →  还原后 21 / 0
$ # 反向判别：execution.run.read 置为 unavailable 时该入口仍可用
  assert.equal(executionContext.available, true) → 通过
```

### 根因组 C —— 不是第二个权威（意见 5）

**机制**：本层不能 import `capabilities`（依赖矩阵），所以 `intersect` 必然是第二份实现；意见指出的
风险是真的：`intersectAccess` 的优先级规则改了，本层会静默漂移。
**改法**：不改依赖矩阵，改为**绑定**——`tests/contract` 已经 import `@harness-projects/capabilities`
（`package-boundaries` 不扫 `tests/`），加一条 4×4×4 = 64 格的差分用例，对本层输出的 `access` 与
`intersectAccess(a, b, c)` 逐格比对。

**判别性证据**：

```text
$ # 变异：把 intersect 的优先级改成 degraded 先于 read_only
ℹ tests 21 / pass 19 / fail 2
  AssertionError: 求交(available, read_only, degraded)   →  还原后 21 / 0
```

### 根因组 D —— `reason` 的契约与形态（意见 6、9）

**意见 6 的两个方向**：评审给了"返回稳定 code"与"在类型注释里明确 `reason` 是 display-ready 散文"
两条路。**选后者**，理由是 provider 与宿主给 `WorkspaceRead.reason` 的本来就是散文（`规划来源离线`
这类），改成 code 等于在本层与上游之间插一个映射层，而本层今天没有任何消费方需要机器可读的原因；
选它同时让"文案归页面"这条仍然成立——页面决定**怎么显示**，本层只保证"降级必有解释"。本层自造的
两条英文散文改为中性中文短语，并在 `types.ts` 与 `derive.ts` 的注释里把这条契约写死。
**意见 9**：契约是 ISO 8601，检查就必须是 ISO 8601——`assertTimestamp` 收紧为
`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$` 加日期有效性。

**判别性证据**：

```text
$ # 旧实现
  AssertionError: Missing expected exception (TypeError): 不合 ISO 8601 的时间必须被拒："2026"
$ # 修复后：'2026' / '09/24/2026' / '2026-09-24' / '2026-09-24T09:30:00' 全部被拒
```

### 根因组 E —— 测试网的形状（意见 8）

**机制**：`local` 会命中 `locale` / `localeCompare` / `toLocaleString`，`harness` 只靠精确剥壳。
本层是纯数据层，将来加一句本地化相关注释就会被拦住——那是**误报**，会训练人忽略这条测试。
**改法**：黑名单去掉 `local` / `harness`，scope 剥离放宽为 `/@harness-projects\/?/g`；性质断言
（对抗性 `bindingId` 逐字比对结论）仍是主网，黑名单只是第二张网。

**判别性证据**（同一份注入 `localeCompare` 的源码，只换黑名单）：

```text
$ # 新黑名单
ℹ tests 21 / pass 21 / fail 0
$ # 旧黑名单
ℹ tests 21 / pass 20 / fail 1
  AssertionError: packages/ui-model/src/derive.ts 含片段「local」：调用方不得按 provider 名或界面框架分支
```

### 意见 7 —— 文档里的易失值

`978 → 964` 与 `Outcomes` 的 `965` 不一致，实测 965（`09274b0` 上的值）。本轮的处置：旧值就地标
`Superseded`，`Outcomes` 与本节一律按**跑它时的 head** 重测并写明 head；Batch 8 之后最终 head 上的
读数是代码 **993 / 1000**、文档见回读命令。**Batch 8 的代价要如实说**：修复把代码从 965 推到 993，
只剩 7 行余量——增加的 28 行全在用例（原因矩阵、精确 key、4×4×4 差分、ISO 收紧），为了让总账落在
1000 以内，源码侧把"为什么"整体移进本计划、`types.ts` / `derive.ts` 只留契约本身，并对若干小的
接口与对象字面量做了等价的紧凑排版。**没有删除任何一条断言，也没有降低任何一条断言的判别力**。

> **Superseded by Batch 9（2026-09-24）：把"为什么"移进本计划是错的，已撤销。** 本计划完成后会移到
> `docs/exec-plan/completed/` 并归档、不再被读，而字段级理由正是下一个改这份代码的人**在编辑现场**
> 需要的东西。Batch 9 把承载推理的注释恢复到 `capability-access.ts` / `derive.ts` / `types.ts` 的
> 字段与函数上（每条压到 1–3 行），并改用**回收 dead code 与重复脚手架**支付：`readFor` 的
> `workspace` 选项没有任何调用方覆盖（`grep -c 'readFor({[^}]*workspace'` → 0），连同 `wireEntity` /
> `fixtureSnapshot` / `sourceOf` / `homeOf` 的重复脚手架一并收敛。结果：代码 **986 / 1000**（比 Batch 8
> 低 7 行），断言仍是一条未删、判别力未降。

## 评审响应（2026-09-23，第二轮 MMP 评审）

第二轮评审（跨 PR 记录：`docs/review/2026-09-23-mvp1-batch-review.md`）锁定 head `8ed0d65`：并集（#159 → #160 → #161 → #158）`pnpm verify` 532 / 532 + 7 / 7；本层变异（陈旧时返回 `[]` → 19 / 2、PR-backed 行给 `start_work` → 20 / 1、降级 `reason` 置空 → 19 / 2）全部变红。无 P0 / P1，两条新意见：

| # | 级别 | 意见 | 处置 |
|---|---|---|---|
| 1 | P2 | `WorkspaceRead` 六个字段只有 `store` 今天有生产者，且 epic #124 的其他子 issue 没有一个认领"组装它"这一环；缺这张表，读者会以为"只差 UI 组件" | 字段 → 生产者映射写进下方「遗留问题与技术债」；组装登记为 #178（挂 #124） |
| 2 | P3 | 能力规则与 key 字面量是 `capabilities` 的副本（D3 / D18） | 不写 ADR：它是依赖矩阵 `ui-model -> client, domain` 的直接后果，key 表逐字比对与 64 格差分让它不构成第二权威源；删掉副本的路径不需要改矩阵（见 D20），并入 #178 验收 3 |

## Surprises & Discoveries

### S1 · 工作树没有 `node_modules` 时，裸包名会解析到主检出的包

第一次"先红"跑出的失败是真的（当时的 `packages/ui-model/src/index.ts` 确实只有 `packageId`），但**加载的不是本工作树的包**：`ls -la node_modules` → `No such file or directory`，Node 沿父目录向上找到主检出的 `node_modules`，于是 `@harness-projects/ui-model` 指向主检出的 `packages/ui-model`。也就是说，那个红是"主检出的占位实现"给的，不能当作本工作树的判别性证据。

修复与重做（在检出 `feat/ui-model-presentation` 的工作树根目录运行；`XDG_CACHE_HOME` / `XDG_DATA_HOME` / `XDG_STATE_HOME` / `TMPDIR` 全部指到仓库内的运行态目录 `.tmp-pnpm/`，因为沙箱不允许 pnpm 在仓库外创建临时安装目录）：

```bash
export npm_config_manage_package_manager_versions=false
pnpm install --frozen-lockfile
# 观察：devDependencies 全部 link: 到本工作树（`+ @harness-projects/ui-model link:packages/ui-model`），Done in 2.6s
ls -la node_modules/@harness-projects/ui-model
# 观察：-> ../../packages/ui-model（工作树内相对符号链接）
```

`--offline` 不可用（`ERR_PNPM_NO_OFFLINE_META: Failed to resolve @types/node ... metadata-full/...jsonl`），需要联网解析元数据；`--frozen-lockfile` 不改 `pnpm-lock.yaml`。之后重做先红：`ℹ pass 0 / ℹ fail 1`，红的原因逐字为 `does not provide an export named 'LineageTarget'`。

### S2 · GitHub 不解析行内代码里的 closing 关键字

PR 描述里写成 `` `Closes #128` ``（反引号包住）时，`gh pr view 158 --json closingIssuesReferences` 返回 `[]`，`gh issue view 128 --json closedByPullRequestsReferences` 同样为 `[]`。去掉反引号、写成普通文本 `Closes #128` 后重新 `gh pr edit`，两侧回读都非空。结论：closing 关键字必须裸写。

### S3 · 变异 A（陈旧时返回空列表）：2 条用例变红

在 `deriveWorkItemList` 里加 `rows: stale ? [] : rows` 后：

```text
✖ 不变量：陈旧快照的列表非空，每行标 stale 且带最后更新时间
  AssertionError [ERR_ASSERTION]: 陈旧快照绝不返回空列表
✖ 不变量：缺口窗口里旧值不是当前值，但列表仍给出最后已知行
ℹ tests 13 / ℹ pass 11 / ℹ fail 2
```

逐字还原后 `ℹ pass 13 / ℹ fail 0`，`diff` 与备份逐字一致。

### S4 · 变异 B（按 provider 名判断可用性）：2 条用例变红

在 `actionsFor` 里加"绑定标识含平台名 ⇒ `start_work` 不可用"后：

```text
✖ 不变量：动作可用性只来自 capability key，绑定标识里的平台名不改变结论
  AssertionError [ERR_ASSERTION]: 绑定标识里的平台名不得让动作不可用
✖ 结构：packages/ui-model/src 不含平台名或界面框架名片段，也不 import provider
ℹ tests 13 / ℹ pass 11 / ℹ fail 2
```

两张网各自独立生效：行为用例按"只改绑定标识、结论必须相同"判定；结构用例按"源码里不得出现平台名片段"判定。逐字还原后 `ℹ pass 13 / ℹ fail 0`，`grep -rn "github" packages/ui-model/src` 无输出（exit 1）。

### S5 · `tsc` 抓到客户端模型与 wire 的实体键类型不同

`StoredEntity.entityId` 是 `string`（store 的键），`WireEntity.entityId` 是品牌类型 `EntityId`。首版实现用前者赋给 `EntityId` 字段，`pnpm run typecheck` 报三处 `TS2322: Type 'string' is not assignable to type 'EntityId'`。改为行与详情取 `entry.entity.entityId`（品牌类型，无断言），详情查找参数保持 `string`——页面可以直接把 `row.entityId` 传回来。

### S6 · 探针裁决在实现期间落地，结论正是 `fallback-web`

执行期间 `test/harness-host-spike` 从 `4d46559` 前进到 `63f9552`（`docs(architecture): 裁决宿主承载能力为 fallback-web`，PR #162），也就是说本层的最终 base 已经带着裁决。核实到的事实：

```bash
git rev-parse origin/main test/harness-host-spike
# 4d4655907763d677ec1473737f629783c1427e86
# 63f95526db1cbfc716447820b384eafd8822c25e
git show test/harness-host-spike:docs/architecture/harness-host-spike.md | sed -n '230,236p'
# > ## `fallback-web`
# > **决定它的答案：问题四**（插件能否在一个 slot 里挂载一个页面）——**未观测到**。
gh issue view 124 --json comments -q '.comments[] | select(.body | test("fallback-web")) | .createdAt'
# 2026-09-23T07:39:04Z
```

#124 上的评论把 #128 明确列进「范围不变的子 issue」："#128 `feat(ui-model)` — React-free presentation structures; the spike verdict does not touch it."

**#124 上有两条评论，都要记**（第二条是 D3-L1 在对抗验证之后发的可见订正，原文保留、不删）：

| 评论 | 时刻 | 内容 | 链接 |
|---|---|---|---|
| 裁决评论 | 2026-09-23T07:39:04Z | `fallback-web` + 「范围不变的子 issue」清单（含 #128） | <https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-5790974840> |
| 排序订正回复 | 2026-09-23T08:14:42Z | 撤回"posted before any sub-issue of this epic starts"这句排序声明，给出实测时间戳与复现命令；裁决本身与范围判断不受影响 | <https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-5791408921> |

订正回复给出的实测事实（与本层自己测得的一致）：**PR #158 的 `createdAt` 是 07:30:11Z，比裁决评论早 8 分 53 秒**；`docs/development/workflow.md` §1 把"批次开始"定义为创建 draft PR，因此**被证伪的是「开工」口径下的排序声明**（不是裁决结论）。另外两条限定：PR #158 在 07:30:11Z 时**还不是以探针分支为 base**（`base_ref_changed` 在 07:55:57Z，而探针分支的首个提交是 07:32:30Z、PR #162 创建于 07:32:55Z），且它的 head 在 07:52:32Z 被强推过。仍然成立的是：裁决评论早于本 epic 现存的所有实现提交，也早于 #128 被叠到探针分支上。

**时间线（UTC，全部由 `git log --format=%aI/%cI`、`git reflog show feat/ui-model-presentation` 与 `gh` 回读，不写推测）**：

| 时刻 | 事件 | 证据 |
|---|---|---|
| 07:29:47 | 本层计划提交 `c5726b6`（07:30:03 推到远端） | `git log`、`git reflog show origin/feat/ui-model-presentation` |
| **07:30:11** | **本层 draft PR #158 创建**（`workflow.md` §1 的"批次开始"） | `gh pr view 158 --json createdAt` |
| 07:32:30 / 07:32:55 | 探针分支首个提交 `f40370d` / 探针 PR #162 创建 | `git log test/harness-host-spike`、`gh pr view 162 --json createdAt` |
| 07:38:16 | 本层实现提交的 author 时间（`93210e4` 经 `--amend` 后保留原 author 时间） | `git log --format=%aI` |
| 07:39:04 | #124 的**裁决评论**发出 | `gh issue view 124 --json comments` |
| 07:40:02 | 裁决记录作为提交 `63f9552` 落到 `test/harness-host-spike` | `git log test/harness-host-spike` |
| 07:40:49 | `93210e4` 的 committer 时间（`--amend` 把实现细化折回同一提交） | `git log --format=%cI` |
| 07:41:05 | 本层执行记录提交 `3fdf8a1` | `git log` |
| 07:52:32 / 07:55:57 | PR #158 的 `head_ref_force_pushed` / `base_ref_changed`（主控 retarget 到探针分支） | `gh api repos/…/issues/158/events` |
| 08:14:42 | #124 的**排序订正回复**发出 | `gh issue view 124 --json comments` |
| 08:23:54 | 本层第二次 rebase（base `ce8ca7e` → `5151f77`）完成 | `git reflog show feat/ui-model-presentation` |

**这张表支持什么、不支持什么**（如实写，不迁就结论）：本层的**计划**先于裁决（07:29:47 < 07:39:04），且计划里的 D1 在裁决出来之前就已经断言"两种裁决都不改变本层范围"——本层的范围判断不依赖裁决结果。但**实现工作并不是在裁决公布之后才开始的**：第一次实现提交的 author 时间是 07:38:16，比裁决评论早 48 秒。按 `workflow.md` §1 的"开工 = 创建 draft PR"口径，**本层开工（07:30:11）早于裁决评论 8 分 53 秒**，所以 epic #124「裁决先于其它子 issue 开工」这条对本层**没有**在墙钟意义上被满足——这正是 D3-L1 在 08:14:42 的订正回复里承认的那件事。裁决落在实现收尾（07:40:49 的 amend）之前，所以本层的**最终交付**是在知道裁决的情况下完成的，但**开工**在裁决之前。

**实质影响**：零。裁决改变的是页面被谁托管（`apps/web` 而不是宿主插件），本层的输入、输出与验收都不含宿主承载方式；#124 的裁决评论也逐字确认了这一点。与本层相邻、范围真的会变的是 #135（其 owning shell 改变）。本分支**不 rebase**、不自行改 base：retarget 与合并顺序由主控执行。
  - **Superseded（2026-09-23T08:00Z）**：末句"不 rebase"只适用于当时；主控随后要求栈化，Batch 6 已 rebase 到 `test/harness-host-spike`，"不自行改 PR base"仍然有效。

### S7 · 独立对抗验证：三条 P2 都是"性质被写成了例子或黑名单"

对抗验证（fresh agent）对 PR #158 的裁决是 `partially_falsified`：核心交付经受住了四条变异，但点出 3 条 P2、3 条 P3。**我自己逐条复现，三条 P2 全部成立**（复现命令与观测见下），修法与用例见 `Progress` 的「对抗验证修复记录（Batch 7）」。三条 P2 有同一个形状：**把一条性质实现成了"列举已知反例"**——黑名单列举已知平台名（漏掉 `gh-` 前缀）、连接状态只在一个派生函数里生效（漏掉列表）、`read_only` 规则只按"写"这一种用途写死（漏掉只读导航）。

复现（修复前，head `8680245`）：

```text
# P2-1：在 actionsFor 首行插入 if (entity.content.bindingId.startsWith('gh-')) return []
ℹ tests 13 / ℹ pass 13 / ℹ fail 0            ← 全绿，绕过成功
binding-planning -> ["start_work"]
gh-projects      -> []                        ← 分支是活的

# P2-2：store 3 条 + connected:false（未 markAllStale）
home.connection = disconnected
rows = 3  list.stale = false  row.stale = false  row.reason = undefined   ← 首页与列表互相矛盾
# 零条目 + connected:false
rows = 0  list.stale = false  keys = ["rows","stale","lastUpdatedAt"]     ← 空且看起来正常

# P2-3：read_only × 谱系入口
lineage = [["execution_context",false,"read_only"],["change_request",false,"read_only"],
           ["pipeline_run",false,"read_only"],["check_run",false,"read_only"]]
start_work = [["start_work",false,"read_only"]]                            ← 只读导航被误阻断
```

修复后的七条变异实验（每条都逐字还原，`diff` 与备份一致后确认 18 绿）：

| 变异 | 改法 | 结果 |
|---|---|---|
| M1 `gh-` 前缀 | `actionsFor` 首行 `bindingId.startsWith('gh-') → []` | 1 条红：`不变量：来源标识不影响任何结论…` |
| M2 `isStale` 忽略连接 | `return entry.stale` | 2 条红：`连接不可用时最后已知行一律标陈旧…`、`已连接但宿主从未给出最后更新时间时按降级处理…` |
| M2b 列表硬编码连接 | `connection = WorkspaceConnectionState.Connected` | 3 条红：上述 2 条 + `从未读到当前值 + 零条目也不长得像正常空态` |
| M3 谱系用写模式 | `decide(..., CapabilityUse.Write)` | 1 条红：`只读凭据下谱系入口仍然可用…` |
| M4 陈旧返回空列表 | `rows: 任一陈旧 ? [] : rows` | 3 条红：`陈旧快照的列表非空…`、`缺口窗口…`、`连接不可用时…` |
| M5 key 字面量漂移 | `execution.run.start` → `execution.run.begin` | 4 条红：含 `本层输出的每个 capability key 都在 CapabilityKey 表里…` |
| M6 fixture 漂移 | 给 fixture 实体加一个 wire 里不存在的字段 | 1 条红：`结构：fixture 快照与 wire 的字段面机械同形…` |

**教训（写给后续增量）**：一条"某字段不影响结论"的性质，用"列举若干已知坏名字 + 源码扫黑名单"来固定是**可绕过的**；正确形态是"同一输入配一组对抗性取值，断言结论逐字不变"。同理，"降级不得被显示成正常"必须断言**每个派生入口**（首页 / 列表 / 详情）的结论一致，而不是只断言被想到的那一个。

### S8 · 评审的十条意见全部属实，且最锋利的一条指向"跟着替身走"

十条 review thread 逐条核实后**没有一条不同意**。最锋利的是 P2-2：`execution_context` 的必需 key
`execution.run.read` 在 core 里**从未被读**——`packages/core/src/chain-facts.ts` 的 `gated` 只为
变更请求 / 流水线 / 检查设门，`readExecutionContext` 是纯本地存储读。也就是说那条"可用性"结论跟的是
测试替身（fake execution provider 声明了该 key），不是真实的门；真实工作区里这个入口会永久不可用，
而它要读的事实本地就有。

另外两条只有动手改才看得见的：

1. 意见 1 的分歧（`home.reason` 有、`list.reason` 无）**旧用例测不出来**——它们只在"未连接"与
   "从未读到"两种成因下断言 `reason`，"已连接 + 有条目陈旧"那一格只断言了 `home.connection`。
   所以"同一份读取在两处给出相反结论"这件事在 17 条用例下是绿的。
2. 修复的代价比预期高：代码 965 → 993，只剩 **7 行**余量。增加的 28 行全是用例，为了让总账落在
   1000 以内，源码侧把"为什么"整体移进本计划（`types.ts` / `derive.ts` 只留契约本身）并对若干小的
   接口与对象字面量做了等价的紧凑排版。**一条断言都没删，判别力一条都没降**——这条边界值得记住：
   本层再要新增代码，必须先做减法。

## Decision Log

| # | 决策 | Rationale | 日期 / 作者 |
|---|---|---|---|
| D1 | 与 #125 裁决的关系：**本层与探针裁决无关，并行开发是安全的**；叠栈只为遵守 epic #124「裁决先于其它子 issue」的合并顺序 | `ui-model` 是 React-free 的展示结构层：输入是客户端模型（`EntityStore` / `WorkspaceSync`）与 capability 快照，输出是纯数据，不承载、不挂载、不渲染。宿主承载方式改变的是"页面被谁托管"，不改变本层的范围、接口或验收。因此本层**没有**技术依赖 #125，PR 描述与本表都如实写这条判断，不假装存在技术依赖。**裁决已落地**：`fallback-web`（记录 `docs/architecture/harness-host-spike.md` §7，分支 `test/harness-host-spike` 提交 `63f9552`，PR #162；#124 上的评论见 <https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-5790974840>，2026-09-23T07:39:04Z）。该评论把 #128 列在「范围不变的子 issue」里，原文："#128 `feat(ui-model)` — React-free presentation structures; the spike verdict does not touch it."。评论与本层开工的先后见 S6 与 D10：本层计划提交在 07:29:47Z，早于该评论的 07:39:04Z，因此 epic #124「裁决先于其它子 issue 开工」对本层**没有**在墙钟意义上被满足；实质影响仍为零，因为范围判断不依赖裁决结果。 | 2026-09-24 / 执行者 |
| D2 | 时间由宿主注入（`WorkspaceRead.lastUpdatedAt`），展示层不读时钟 | wire 与 client 都不带时间戳；展示层读时钟会让同一输入产生不同输出，且与不变量 7 冲突。宿主在每次成功应用基线 / 增量后推进该值 | 2026-09-24 / 执行者 |
| D3 | capability key 以字面量落在本层，由契约测试与 `CapabilityKey` 表比对 | 依赖矩阵不允许 `ui-model -> capabilities`；改矩阵要 ADR。字面量 + 机械比对避免第二个权威源静默漂移 | 2026-09-24 / 执行者 |
| D4 | "是否提供动作"（按内容种类）与"动作是否可用"（按 capability key）拆成两条独立规则 | issue #128 同时要求"可用性只来自 capability key"与"PR 支撑的条目不提供开始工作"。合成一条会让内容种类变成可用性来源，违反第一条 | 2026-09-24 / 执行者 |
| D5 | 单元测试放在 `tests/contract/` | 该层的规则是"只有代码与 fixture，无网络、无真实凭据"（`tests/README.md` §1），正好是本层的验证形态；`tests/e2e/` 要求端到端用户链路，而本增量刻意不含页面与 React | 2026-09-24 / 执行者 |
| D6 | 谱系入口只给稳定 `target`，不给文案 | 文案归页面；展示层给结构与可用性，避免把界面措辞冻结进模型层 | 2026-09-24 / 执行者 |
| D7 | 行与详情的 `entityId` 取 `WireEntity.entityId`（品牌类型 `EntityId`），`deriveWorkItemDetail` 的查找参数取 `string` | 客户端模型的 `StoredEntity.entityId` 是 `string`，wire 的实体 id 是品牌类型；取品牌类型让展示结构保留身份语义，参数保持 `string` 让页面能把 `row.entityId` 直接传回，不必在页面里做断言 | 2026-09-24 / 执行者 |
| D8 | redacted 的标题 / 正文遮蔽在本层再确认一次 | 本层是页面的直接来源。领域层已保证 redacted 不带标题，但 wire 若回归，页面就会拿到缓存标题；本层多一行判断把这条不变量钉在离页面最近的地方，并配一条"上游带了标题也不透出"的用例 | 2026-09-24 / 执行者 |
| D9 | 本层验证的前置条件是在工作树内 `pnpm install --frozen-lockfile`（带 XDG 重定向与 pnpm 版本前缀） | 工作树没有 `node_modules` 时裸包名会解析到主检出的包，测试会对着别人的代码跑（见 S1）。这是本机环境事实，不写进仓库文件，也不改 `.npmrc` / `package.json` | 2026-09-24 / 执行者 |
| D10 | 裁决结论按"已发生的事实"记录：裁决是 `fallback-web`，#128 被 #124 的裁决评论列为范围不变；同时如实记录本层**开工早于裁决评论** | 主控要求把裁决写实（不要条件式表述），也要求时间线如实。核实后两者并不一致：本层 draft PR #158 创建于 07:30:11Z，早于裁决评论 07:39:04Z **8 分 53 秒**（按 `docs/development/workflow.md` §1「批次开始 = 创建 draft PR」的口径，这就是"开工"）；第一次实现提交的 author 时间 07:38:16Z 也早于评论 48 秒。按 `PLANS.md` §4「如实记录」，本计划写实测时间线并点名"开工在裁决之前"。**这条判断已被 D3-L1 独立确认**：它在 08:14:42Z 发了一条可见订正回复（<https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-5791408921>），撤回"posted before any sub-issue starts"，并给出同样的时间戳；裁决本身与范围判断不受影响。S6 记两条评论 | 2026-09-24 / 执行者 |
| D11 | 栈化：本分支 rebase 到 `test/harness-host-spike` 之上，成为 D3 栈第 2 层；`docs/README.md` 的 Active 索引冲突两边都保留、按栈位置排序（探针行在前、本层行在后）；体量判定基线随之改为 `origin/test/harness-host-spike` | epic #124 要求宿主探针的裁决先于该 epic 的其它子 issue，本层是 #124 的子 issue，所以合并顺序上必须叠在 D3-L1 之上；这条是**合并顺序**要求，不是技术依赖（D1）。**共 rebase 两次**：07:49:14Z 到 `ce8ca7e`，08:23:54Z 到 `5151f77`（D3-L1 的订正提交，只碰探针文档，零冲突；`git reflog show feat/ui-model-presentation` 是时间来源）。恢复锚点 `backup/w14-d3b-pre-stack`（`a720b8a`）、`backup/w14-d3b-pre-rebase2`（`8680245`）都在改写历史前建立；强推一律精确 lease，不改写他人分支 | 2026-09-23T07:49Z / 08:23Z / 执行者 |
| D12 | 能力判定按**用途**分读写：写动作在 `read_only` 下不可用，只读导航在 `read_only` 下可用 | 与 core 的权威约定对齐（`packages/core/src/capabilities.ts` 的 `gateCommand` 只在 `mode === 'write'` 时拒绝 `read_only`）。四个谱系入口的必需 key 全是 `.read`，把它们判成不可用会让"只读凭据"变成"看不见谱系"，而导航不写任何东西 | 2026-09-23T08:00Z / 执行者 |
| D13 | 连接状态参与展示陈旧结论：`stale = 条目标记 ∪ 连接不可用 ∪ 从未读到`；`lastUpdatedAt` 可为 `undefined`（= 从未读到） | 对抗验证实测：只看条目标记会让"不可达 + 有最后已知值"报成新鲜、"不可达 + 零条目"报成正常空态，且首页与列表互相矛盾。`undefined` 在契约里表达"没有最后更新时间"的降级形态，仍然由宿主注入，不引入读时钟（D2 不变） | 2026-09-23T08:00Z / 执行者 |
| D14 | "来源标识不影响结论"改成性质断言（对抗性取值逐字比对），黑名单扫描降为第二张网 | 黑名单可被 `gh-` 这类缩写前缀绕过（实测 13/13 全绿）；性质断言不依赖"想全了哪些名字" | 2026-09-23T08:00Z / 执行者 |
| D15 | fixture 与 `wire.ts` 的字段面用机械比对钉住（解析接口字段名） | fixture 是 `.js`，`tsconfig` 不检查 `tests/**`，注释里的"同形"会随 `wire.ts` 增删字段静默漂移 | 2026-09-23T08:00Z / 执行者 |
| D16 | `execution_context` 谱系入口不要求任何 capability key | 谱系入口的必需 key 必须等于 core **读该事实时真正经过的门**（`packages/core/src/chain-facts.ts` 的 `gated`）。`readExecutionContext` 是纯本地存储读，core 从不为之设门，所以"没有门"就是事实，`requiredKeys: []`。评审给的另一个候选 `storage.workspace.read` 同样不是 core 的读门（core 也不为它设门），用它会把一个不存在的门写成必需条件。`decide` 对空必需 key 返回 `access: 'available'` / `reason: undefined`：没有任何能力能约束一个没有门的事实 | 2026-09-23 / 执行者 |
| D17 | `reason` 全线明确为 **display-ready 散文**，而不是稳定 code | 评审给了两条路。选散文的理由：provider 与宿主给 `WorkspaceRead.reason` 的本来就是散文（如 `规划来源离线`），改成 code 等于在本层与上游之间插一个映射层，而本层今天没有任何消费方需要机器可读的原因。"文案归页面"仍然成立——页面决定**怎么显示**，本层只保证"降级必有解释"。本层自造的两条英文散文改中性中文短语 | 2026-09-23 / 执行者 |
| D18 | 四态求交用 **4×4×4 差分用例**绑定，而不是为本层改依赖矩阵去 import `capabilities` | 依赖矩阵（`AGENTS.md` §2）不允许 `ui-model -> capabilities`，改它要 ADR；而 `tests/contract` 本来就 import capabilities，`package-boundaries` 不扫 `tests/`。差分用例把 64 格逐格比对，优先级规则漂移会变红，代价是零 | 2026-09-23 / 执行者 |
| D19 | 平台名黑名单去掉过宽的 `local` / `harness`，性质断言是主网 | `local` 会误伤 `locale` / `localeCompare` / `toLocaleString`，`harness` 只靠精确剥壳——这类**误报**会训练人忽略这条测试。真正防"按 provider 名分支"的是对抗性 `bindingId` 的性质断言（结论逐字不变），黑名单只是第二张网 | 2026-09-23 / 执行者 |
| D20 | 能力规则副本不写 ADR、不改依赖矩阵；删除副本的路径是经 `client` 再导出 | 第二轮 MMP 评审的判断：`client -> controller -> capabilities` 是矩阵允许的链路，`WorkspaceRead.capabilities` 本来就需要 controller → client 暴露能力快照，同一通道可以再导出 key 表与求交规则，届时 ui-model 删掉副本即可。在那之前副本由 key 表逐字比对与 64 格差分钉住，不会静默漂移。落在 #178 验收 3 | 2026-09-23 / 第二轮评审 |

## Idempotence and Recovery

- 展示层是纯函数：同一输入重复调用得到逐字相同的输出，无内部状态、无缓存、无副作用；测试可重复运行。
- 每一批都可独立回滚：Batch 1 只碰两份文档；Batch 2 只新增测试文件；Batch 3 只碰 `packages/ui-model/src`；Batch 4 的变异必须逐字还原，判据是 `git diff -- packages/ui-model/src` 为空。
- 回到已知良好状态：`git fetch origin && git reset --hard origin/main`（会丢弃本分支全部本地改动，仅在本层工作可弃时使用）；已 push 的提交用 `git revert`，不改写已推送历史。
- 计划文件本身可重复编辑：`Progress` / `Surprises` / `Decision Log` / `Outcomes` / `Bottom Change Note` 每次更新追加或勾选，不删除历史结论。

## Interfaces and Dependencies

- 上游包：`@harness-projects/domain`（枚举与 id 类型）、`@harness-projects/client`（`EntityStore` / `StoredEntity` 类型）。二者已在 `packages/ui-model/package.json` 声明，本层不新增依赖。
- 下游消费者：`packages/ui` 与 `apps/*`（本层只导出纯数据与函数，不导出组件）。
- capability 契约：`packages/capabilities` 的 `CapabilityKey` 与 `AccessLevel`（`AccessLevel` 经 `domain` 取得，key 取值以字面量 + 契约测试对齐）。
- 验证工具：`node --test`（Node ≥22 原生类型剥离）、`pnpm verify`、`pnpm run boundaries`、`node scripts/rule-checks.mjs size|disclosure`。
- 凭据：无。本层不触网、不需要任何凭据或外部系统。
- 命名契约：capability key、`ContentKind`、`NormalizedStatus`、`DerivedFlag`、`AccessLevel` 的取值逐字沿用权威表，不新增取值、不改名。

## Outcomes & Retrospective

全部七个批次完成（Batch 6 栈化、Batch 7 对抗验证修复），issue #128 的七条验收标准逐条有实测证据（见 `Validation and Acceptance` 与 `Surprises & Discoveries`）。

> **Superseded by** `Progress` 的 Batch 10（2026-09-23）：最终完成的是十个批次（含 Batch 8 第一轮评审修复、Batch 9 预算回收、Batch 10 第二轮 MMP 评审）。本节下方的读数是 Batch 7 时的快照；最终 head 的实测数字只写在 PR #158 的描述里，不写进被度量的本文件。

**实际结果**（在检出 `feat/ui-model-presentation` 的工作树根目录运行）。易失值按 `PLANS.md` §4 的写法给出**观测时刻 + head + 回读命令**，不写成永久事实：

- 观测时刻：2026-09-23T08:00Z 前后（Batch 7 收尾）
- 代码 / 文件集合的实测 head：Batch 7 的修复提交（回读 `git rev-parse HEAD`；该提交之上只有一个不改代码的 docs 提交）
- 回读命令：`node scripts/rule-checks.mjs size origin/test/harness-host-spike`（base = `test/harness-host-spike`）

```text
$ node --test tests/contract/ui-model-presentation.test.js
ℹ tests 17 / ℹ pass 17 / ℹ fail 0

$ pnpm verify
ℹ tests 463 / ℹ pass 463 / ℹ fail 0      # 基线 446 + 本层 17
ℹ tests 7 / ℹ pass 7 / ℹ fail 0          # tests/mvp0
verify-exit=0

$ pnpm run boundaries
ℹ tests 7 / ℹ pass 7 / ℹ fail 0

$ grep -rn "github" packages/ui-model/src ; echo "grep-exit=$?"
grep-exit=1
$ grep -rn "react" packages/ui-model/src ; echo "grep-exit=$?"
grep-exit=1

$ node scripts/rule-checks.mjs size origin/main
代码：993 / 1000 行（增删之和）
文档：见回读命令（本计划自身行数随每次编辑变化，因此不把该数字写成永久事实）
  · Superseded：Batch 7 时的 965 / 633 是 `origin/test/harness-host-spike` 基线、`f42cab0` 上的值；
    Batch 8 之后基线是 `origin/main`（栈第 1 层 #162 已合并），读数为 head 上的实测值
栈累计（相对 origin/main，仅记录，不计入判定）：只由回读命令给出

$ node scripts/rule-checks.mjs disclosure origin/test/harness-host-spike
机械扫描通过（exit 0）

$ git diff --check origin/test/harness-host-spike...HEAD
（无输出，exit 0）
```

**与计划的偏差**：

1. 计划预期代码 400–700 行，实际 986 行（其中 `tests/contract/ui-model-presentation.test.js` 552 行）；Batch 7 与 Batch 8 的修复都增加了用例与契约，没有为压数字删用例；Batch 9 用回收 dead code 与重复脚手架把 Batch 8 的 993 降回 986，仍在 1000 行预算内，余量 14 行（见 S8 与 Batch 9 的订正）。
2. 先红做了两次：第一次是在发现工作树缺 `node_modules`（S1）之前跑的，判别性不足；补装依赖后用工作树自己的包重做，红/绿证据以重做的那次为准。
3. 计划里写的 `--offline` 安装不可用，改为联网 `pnpm install --frozen-lockfile`（`pnpm-lock.yaml` 未改）。
4. 计划外新增 Batch 6（栈化）：批次 spec 要求本层最终叠在 `test/harness-host-spike` 之上，而该分支在本层开工后前进了 3 个提交，因此做了 rebase（唯一冲突在 `docs/README.md`，按"两边都保留"解）并重跑了全部验证。体量判定基线随之从 `origin/main` 改为 `origin/test/harness-host-spike`。
5. 计划外新增 Batch 7（对抗验证修复）：独立对抗验证判 `partially_falsified`，3 条 P2 + 3 条 P3 已按根因修（见 `Progress` 的修复记录与 S7）。修复期间 base 又前进到 `5151f77`（D3-L1 的订正提交），于 08:23:54Z 第二次 rebase，零冲突。修复还做了减法：把动作与只读导航的四个重复字段收敛成共用的 `CapabilityDecision`，代码从 978 降到 965 行。

**遗留问题与技术债**：

- 探针裁决是 `fallback-web`（S6）：MVP-1 的页面跑在 `apps/web`。本层不受影响，但**本层的下游消费者 `packages/ui` 与 `apps/web` 的接线方式**随裁决确定——那是 #135 的范围，不是本层。本层今天没有任何页面消费它，这也是"不实现 React 组件"的直接后果。
- **（第二轮 MMP 评审）`WorkspaceRead` 的生产者缺口。** 本层的输入契约今天只有 `store` 一个字段有生产者，组装它这一环已登记为 #178（挂在 epic #124 下）；在它落地之前，#124 步骤 1–5 无法端到端演示，哪怕页面（#129–#131）与宿主组合（#132）已经落地：

  | 字段 | 生产者（2026-09-23） |
  |---|---|
  | `store` | 有：`packages/client/src/store.ts`，经 `sync.ts` / `transport.ts` 接到 `controller.queries.snapshot()` |
  | `connection.connected` | 接近但没接上：`packages/client/src/sync.ts` 的 `WorkspaceSync.connected` |
  | `lastUpdatedAt` | 无：`WireSnapshot` / `SyncReport` / `EntityStore` 都不带时间戳 |
  | `capabilities` | 无：`EffectiveCapability[]` 从未经 `ControllerQueries` 暴露 |
  | `reason` | 无：概念上对应 `SyncReport.reason`，没接上 |
  | `workspace` | 无 |

- wire 与 client 都不带时间戳，`lastUpdatedAt` 由宿主注入（D2）。把"最后一次成功读取时刻"纳入 wire 或 client 是后续增量；在那之前，宿主接错时钟时展示层只能校验格式、无法校验真值。
- wire 只暴露一个来源身份（`content` 的主身份），因此 `source.identities` 今天恒为长度 1；`PlanningItemDetail.identities` 那层信息还没过 wire。这是本层的边界，不是本层的缺陷。
- 详情的工程段与交付段、以及 `packages/ui` 的 React 组件按 issue #128 的 Out of scope 留给后续增量。
- capability key 字面量在本层重复了一份（D3）。今天由契约测试钉死；如果本层需要更多 key，先评估是否值得为 `ui-model -> capabilities` 写 ADR 改依赖矩阵。
  > **Superseded by** D20（2026-09-23）：不需要为此改矩阵，删除副本的路径是经 `client` 再导出，见 #178 验收 3。

## Bottom Change Note

- 2026-09-24：创建本计划（spec + plan 合一），登记 issue #128 的验收标准、Design / Spec、五个批次与验证命令。
- 2026-09-24：勾选 Batch 1–5；补 `Surprises & Discoveries`（S1 工作树 `node_modules`、S2 closing 关键字、S3 变异 A、S4 变异 B、S5 实体键类型）；`Decision Log` 增 D7–D9；`Validation and Acceptance` 第 3 行的判定证据改写为"对照工作项行提供该动作"，因为原表述（"变异 B 之外另有该用例本身"）没有说清判别力来自哪里；填 `Outcomes & Retrospective`。
- 2026-09-24：探针裁决 `fallback-web` 落地后按主控要求把 D1 从条件式表述改成已发生的事实，并新增 S6 与 D10 记录时间线。**偏差说明**：主控给出的时间线是"实现是在裁决公布之后才开始的"（依据 `93210e4` 的 committer 时间 07:40:49Z），但 `git log --format=%aI` 显示该提交的 author 时间是 07:38:16Z，早于裁决评论的 07:39:04Z；07:40:49Z 只是 `--amend` 的 committer 时间。本计划按实测写"开工早于裁决评论"，不写成主控给的版本，并把两处差异写进 D10。主控随后接受该更正。
- 2026-09-23T07:49Z：新增 Batch 6（栈化）与 D11；`Progress` 增「栈化记录（Batch 6）」；`Global Constraints` 与 `Outcomes` 的体量基线从 `origin/main` 改为 `origin/test/harness-host-spike`（该分支已从 `4d46559` 前进到 `ce8ca7e`，旧基线表述会误导）；本层成为 D3 栈第 2 层，head 由 `a720b8a` 变为 `09274b0`。
- 2026-09-23T08:23Z：第二次 rebase 到 `test/harness-host-spike` 的 `5151f77`（D3-L1 的订正提交，零冲突；reflog 时间 08:23:54Z），恢复锚点 `backup/w14-d3b-pre-rebase2`（`8680245`）。S6 / D10 补记 #124 的**第二条评论**——D3-L1 在 08:14:42Z 发出的排序订正回复（<https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-5791408921>）：它撤回"posted before any sub-issue starts"，并给出与本节一致的时间戳；"开工"口径改为 `docs/development/workflow.md` §1 的"创建 draft PR"（#158 创建于 07:30:11Z，早于裁决评论 8 分 53 秒），裁决与范围判断不受影响。同时按主控提示做了减法：动作与只读导航的重复字段收敛为共用的 `CapabilityDecision`，代码 978 → 964 行。
- 2026-09-23T08:00Z：按独立对抗验证（裁决 `partially_falsified`）新增 Batch 7 与 S7、D12–D15：来源标识无关性改成性质断言（P2-1）、连接状态参与展示陈旧结论且 `lastUpdatedAt` 可为 `undefined`（P2-2）、能力判定按用途分读写（P2-3）、fixture 与 `wire.ts` 机械同形（P3-6）；订正 `Validation` 第 7/9 行的基线（P3-5）与全部易失值（P3-4，旧值就地标 `Superseded`）；`Design / Spec` 的动作可用性与新增的「新鲜度」小节按修复后的语义重写；`Global Constraints` 的文件集合不变（仍只碰 `packages/ui-model/src` 与 `tests/contract`）。同时把 base 再 rebase 到 `test/harness-host-spike` 的 `5151f77`（D3-L1 订正提交，零冲突）。
- 2026-09-23：**Batch 8 · 按评审根因修复**。PR #158 的 10 条 review thread 全部属实，按机制归为 A–E 五组一次改完（详见新增的 `评审响应（2026-09-23，根因修复）` 一节）。先 rebase 到新 `main`（`940046e`）：用 `git rebase --onto origin/main 5151f77 HEAD` 丢掉两个已被 rebase-merge 进 main 的探针提交，`docs/README.md` 的 Active 索引冲突按"只保留本层一行"解（探针计划在 main 上已进 Completed 表）。新增 S8 与 D16–D19；`Outcomes` 的体量读数按新基线重测（代码 993 / 1000，只剩 7 行），旧值就地标 `Superseded`。**没有删除任何一条断言、没有降低任何一条断言的判别力**；为腾出预算，源码侧把"为什么"整体移进本计划并对若干小接口做了等价紧凑排版。恢复锚点 `backup/w14-d3b-pre-review2`（`f42cab0`）。
- 2026-09-24：**Batch 9 · 预算回收，撤销 Batch 8 的坏交易**。Batch 8 用"把'为什么'移进本计划"换预算，这是错的：本计划完成后移到 `docs/exec-plan/completed/` 归档、不再被读，而字段级理由正是下一个改这份代码的人**在编辑现场**需要的东西。按"只恢复承载推理的那几条、每条 1–3 行"恢复 6 组注释（`capability-access.ts`：core `gateCommand` 的读写约定、`reason` 的逐 key 形态与声明顺序、`LINEAGE_ORDER` 的渲染契约；`derive.ts`：时间契约、动作"提供"与"可用"是两条独立规则；`types.ts`：`WorkspaceRead.reason` 的优先级，并把文件头"理由见 ExecPlan"改掉）。支付方式是**先找 dead code、再做等价压缩**：`readFor` 的 `workspace` 选项零调用方覆盖（`grep -c 'readFor({[^}]*workspace' tests/contract/ui-model-presentation.test.js` → 0，其余五个选项分别被覆盖 7/5/3/3/2 次），连同 `wireEntity` / `fixtureSnapshot` / `sourceOf` / `homeOf` 的重复脚手架一并收敛。结果代码 993 → **986 / 1000**，断言一条未删。分两个可独立审阅的提交：`d1093fe`（恢复注释）与 `5353f54`（回收与压缩）。
- 2026-09-23：**Batch 10 · 第二轮 MMP 评审**。无 P0 / P1；新增「评审响应（2026-09-23，第二轮 MMP 评审）」与 D20，遗留问题补 `WorkspaceRead` 的字段 → 生产者映射（#178）；`Outcomes` 首句与 D3 那条遗留就地标注 `Superseded by`。变基到含 #159 的 `main`（`721e42a`），本计划移入 `completed/`，提交收敛为三个。
