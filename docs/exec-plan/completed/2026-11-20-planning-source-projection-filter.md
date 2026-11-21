# 规划来源切换后的只读投影过滤 ExecPlan

> 状态：Completed（工程根因修复与独立复评；最终 head 的托管门禁、批准与 rebase 合并按回读规则执行）
> 创建：2026-11-20
> 范围：规划来源切换后，Core 只读查询只服务启用规划挂载的投影；不新增用户可见切换命令，不改 Storage/port/schema。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：“不改 Storage/port/schema”是原实现范围，不能豁免来源正确性；修复方案待 owner 设计，本轮由人类直接指定协调者接管，当前修复方案见下文“来源事实修订”。
> 上游输入：issue #202（`fix(core): drop the disabled planning source's projections when a workspace switches source`）；本地只读读取侧过滤提案（级联提案文件不存在，见 Design 被放弃方案 2）；`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`。

## Purpose / Big Picture

工作区切换规划来源后（旧挂载停用、新挂载启用），`listPlanningItems`、`getPlanningSnapshot`、`getItemDetail` 只返回来自启用规划挂载的投影；同一份测试在内存 Fake 与 SQLite 上给出相同结果。切换前已写入的旧投影行可以继续物理存在，读取层不再把它们当作可服务事实。

最小成功证据：两适配器在独立实体与共享原生 PR 的切换、失败、重开、恢复场景中，都只服务当前来源；来源更换但业务字段相同仍得到可续传的业务修订，同源重复刷新不推进修订。命令统一列于 Batch 3，不以旧的 2/2 独立实体样例验收共享内容归属。

本任务不新增用户可见的来源切换命令：`bindPlanningSource` 在只剩停用规划挂载时仍返回 `not_supported`（`packages/core/src/workspace-setup.ts:169-171`），本计划只修读取权威性。

## Context and Orientation

- 不变量 1（`AGENTS.md` §1.1）：一个工作空间同一时刻只有一个 Planning 事实源。库层面已保证「至多一个启用的 planning 挂载」：`packages/storage/sqlite/migrations/001_init.sql:66` 的 `workspace_binding_planning_enabled` 部分唯一索引；Fake 在 `packages/providers/fake/src/storage.ts:232-235` 以同义拒绝实现。
- 同步写入按挂载作用域收敛：`packages/core/src/bootstrap.ts:238-243` 调用 `replacePlanningProjections({ workspaceId, bindingId }, ...)`；端口语义是「只收敛该 binding 的身份所指实体」——Fake 见 `packages/providers/fake/src/storage.ts:433-453`，SQLite 见 `packages/storage/sqlite/src/storage.ts:182-194`（`DELETE ... WHERE entity_id IN (SELECT entity_id FROM external_identity WHERE binding_id = ?)`）。旧挂载的行因此不会被新挂载的同步删掉。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：独立实体适用；共享 native PR 实体可被新来源重写，同一身份范围不证明 payload 来源。
- 读取侧忽略来源：`packages/core/src/queries.ts:114-125` 的 `planningSnapshot` 直接 `tx.listPlanningProjections(workspaceId)`，只跳过没有 primary 身份的行；`packages/core/src/queries.ts:91-101` 的 `getItemDetail` 只按 `entityId` 取行与 primary。切换后两个来源的行一起进入视图与详情。
- 启用来源在读取时已经可用：`packages/core/src/runtime-access.ts:179-190` 每次读都由 `singlePlanningBinding` 解析当前组合的规划挂载，返回 `access.binding.ref.bindingId`；`packages/capabilities/src/registry.ts:77-79` 取该域第一个（也是唯一）挂载。CoreContext 没有、也不需要新增「启用的规划挂载」字段。
- 树内没有切换命令：`packages/core/src/workspace-setup.ts:158-175` 在已有启用挂载时只做 create-or-verify，在只剩停用挂载时结构化返回 `not_supported`；`tests/integration/workspace-setup-commands.test.js:152-163`（AC3）钉住这次拒绝且零写入。树内可构造的切换形状是：同一 Storage 上停用旧 `provider_binding` 行，再以新 planning provider `composeCore`（issue 的 round-5 复现即此形状）。
- 术语：**投影行** = `workspace_projection` 的一行；**primary 身份** = 实体恰好一条主身份，决定 `content.identity` 展示；**启用规划挂载** = 当前 `composeCore` 注入的 planning provider 对应的 binding，读取时由 `runtimeAccess.planning` 解析。

## Design / Spec

### 来源事实修订（当前方案，2026-11-21）

在 `WorkspaceProjection` 增加必填 `sourceBindingId`，表示当前 payload（规划状态、三态内容、字段）最后一次已提交的规划来源；实体 primary/alias 继续只表达稳定身份。成功同步从经过同项目/同绑定校验的 `item.ref.bindingId` 生成来源，与 payload 在原事务中写入；显式状态修改及脱敏保留原来源。

SQLite 当前单资产基线新增 `source_binding_id TEXT NOT NULL REFERENCES provider_binding(id)`，列与对象直接往返；schema 世代从 6 到 7，逻辑基线版本仍为 1，不引入迁移或补值。旧库由现有 generation/完整 shape 准入拒绝且原文件保留。Fake 的写入与导入同样拒绝缺失/未知来源，不能从身份或当前挂载回填。

`replacePlanningProjections` 的移除作用域改为持久来源；所有 incoming 的来源必须等于 scope，整批预检失败零写入。共享实体 B 覆盖 A 后，A 的空集收敛不得删除 B 行。权限失败只处理当前来源行，不能把外来源内容重标为本来源。Core 三个读取 API 以 `projection.sourceBindingId` 和启用挂载匹配；无挂载沿用 D23 最后已知值，启用 A 而本行来自 B 则隐藏。A→B→A 失败时隐藏 B；本方案不保留每个来源各自的历史缓存。

来源会影响行是否进入业务快照，因此参与 `sameProjections` 的内容比较：来源变化推进一次，完全相同的同源刷新不推进；仍由 Core 掌握修订号与可见性，Storage 不拥有规划策略。来源字段不进入 UI wire，当前 view 显式组装保持 ABI。只读查询仍零 provider 调用、零写入。成功提交和失败结算都在同一事务中重新读取持久挂载，确认当前唯一启用 Planning 仍是本轮来源；停用来源的在途结果不能写投影、修订、cursor、round 或 reconcile。既有同 binding 的 epoch/round 检查保留，拒绝沿既有 stale_revision/失败路径。

方案比较：成员表不含可靠的 payload 最后写入来源，局部同步轮次不能跨 binding 定序，故不采用推断；单独切换失效需要不存在的受控命令和额外恢复生命周期，不能只在成功同步后清理。显式来源字段是最小可持久验证的事实；不按来源复制实体、不保存双份 payload。

### 历史方案：读取时按实体身份过滤（已被 F1 推翻）

投影行的来源事实只存在于 `external_identity.binding_id`，写入侧已经用它定义收敛作用域；读取侧复用同一事实，不引入第二个 visibility owner。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：身份归属与投影最后写入来源不同，现有 WorkspaceProjection 未记录后者。

1. `packages/core/src/queries.ts` 的 domain 导入加 `type ExternalIdentity`（现第 14 行）。
2. 在 `planningSnapshot` 前加模块内纯函数：

   ```ts
   /**
    * 投影可被服务的前提：其实体至少有一条身份属于启用规划挂载（与 replacePlanningProjections 的作用域同一判据）。
    * 没有启用挂载时保留 D23 的最后已知值，不把「未启用」读成「无来源」。
    */
   function servedByPlanningMount(identities: readonly ExternalIdentity[], bindingId: ProviderBindingId | undefined): boolean {
     return bindingId === undefined || identities.some((identity) => identity.bindingId === bindingId)
   }
   ```

3. `planningSnapshot`：取 `const bindingId = access.binding?.ref.bindingId`；循环内先 `const identities = await tx.listIdentitiesForEntity(projection.entityId)`，再 `const identity = identities.find((entry) => entry.role === IdentityRole.Primary)`；仅当 `identity !== undefined && servedByPlanningMount(identities, bindingId)` 时 push 视图。
4. `getItemDetail`：primary 判定之后、`syncSummary` 之前读 `const access = await context.runtimeAccess.planning(context.storage)`；`if (!servedByPlanningMount(identities, access.binding?.ref.bindingId)) return undefined`；随后沿用原 `syncSummary(context, context.storage, access)` 与返回值。净生产代码约 12-16 行，无新类型、无新 port、无 schema。

谓词用「任一身份」而不是只看 primary：与 `replacePlanningProjections` 的 scope 逐字一致，并保住原生 PR 身份跨挂载收敛的实体（primary 可能仍指向旧挂载，但新挂载会重写同一实体行）；primary 只决定 `content.identity` 展示。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：成功同步控制成立，但失败切回会放行停用来源 payload；primary-only 也会隐藏合法当前行，需重新设计来源判据。

读取语义：没有启用规划挂载（`access.binding === undefined`）时不过滤，保留现状与 degraded 的「最后已知值」；`masked` 仍走 `redactPlanning`，过滤与脱敏正交；视图仍按 `entityId` 升序；过滤不推进 `currentRevision`；`getPlanningSync`、`getWorkspaceMetadata` 不变。

### 被放弃的方案

1. **Storage port 作用域化**（`listPlanningProjections(workspaceId, bindingId)`）：要改 `packages/capabilities/src/storage.ts` 端口、Fake、SQLite 与契约套件，且 `getItemDetail` 仍要自己判身份；等于把「哪个来源可见」再交给存储层，制造第二个 visibility owner。收益只是少读旧行身份——而现状本来就在读。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：记录 payload 来源并不必然转移 Core 的可见性决策；接口取舍须由 owner 依据来源契约重评。
2. **切换时级联删除**：树内没有切换命令，唯一可执行点是 compose/bootstrap；不能挂在一条用户命令上。已核对：现有 `replacePlanningProjections(scope, [])` 本身就能表达「清空旧挂载作用域」，所以「必须新增破坏性 port 方法」并不成立（订正见 Decision Log D5）；真正的拒绝理由是：级联必须折进同步提交事务才推进修订号并保持原子，而它只在下一轮成功同步时删；新来源首轮同步失败时旧行仍然可见（fail open，恰好违反本 issue 的验收）。若放在新行 upsert 之后，共享原生 PR 身份的实体会同时属于两个身份作用域，删除旧 scope 会连带删掉刚写入的新行；放在 upsert 之前则先制造空窗。它还把「不可见」与「已删除」绑定，切回旧来源需要重新全量读取且无收益。
3. **投影行加 `binding_id` 列**：改 schema、两个适配器与契约，且共享实体一行会同时属于两个来源，需要额外合并规则；远超本 issue。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：共享实体可有多个身份，但某次投影 payload 的最后写入来源可以唯一；来源/代际字段是否采用，留待 owner 选择，不能以原规模限制排除正确方案。

## Global Constraints

- 预发布仓库：不做迁移、不做兼容层、不保留双实现；改动只有一个当前语义。
- 受跟踪文件集合（唯一声明）：`packages/domain/src/entities.ts`、`packages/capabilities/src/storage.ts`、`packages/core/src/bootstrap.ts`、`packages/core/src/queries.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/src/storage.ts`、`packages/storage/sqlite/src/storage-rows.ts`、`packages/storage/sqlite/src/migrate.ts`、`packages/storage/sqlite/migrations/001_init.sql`；现有测试 `tests/integration/planning-source-switch.test.js`、`tests/contract/storage-contract.test.js`、`tests/contract/suites/storage-fixtures.js`、`tests/contract/suites/storage.js`、`tests/contract/suites/storage-identity-membership.js`、`tests/integration/storage-restart.test.js`、`tests/integration/local-git-fixture.js`、`tests/integration/identity-membership-schema.test.js`、`tests/integration/identity-membership-enums.test.js`、`tests/integration/storage-baseline-admission.test.js`、`tests/integration/harness-plugin-migrations.test.js`；本 ExecPlan、`docs/README.md`、`docs/review/pr-668-mmp-review.md`、`docs/product/demo-install.md`。如判别性失败要求调整已有投影夹具，先在本节登记实际路径再修改；不新增重复 API 或第二来源推断。

- 不新增用户可见切换命令；`bindPlanningSource` 的 `not_supported` 行为逐字保留。
- 公开接口 `CoreQueries` 的三个读取签名不变；查询路径不调用 provider、不写 Storage。
- 期望输出中的易失量（视图条数等）以实际命令输出为准，写入 Progress 时标注观察时刻。
- 证据必须带执行上下文：在检出 `fix/planning-source-projection-filter` 的工作树根目录运行；`gh` 命令带 `-R SingularityKChen/harness-projects`。
- 文档正文中文，代码标识符、路径与命令英文；所有路径写仓库内相对路径，不写本机绝对路径。

## Plan of Work

### Batch 1 · 红先测试：复现切换后旧来源仍被读取

**最小闭环**：新测试在未修改的 Core 上失败，且失败原因正是「旧来源条目仍被服务」。

**涉及文件**：`tests/integration/planning-source-switch.test.js`（新建，约 110-130 行）。

步骤：

1. 按下面骨架建测试；Fake 与 SQLite 跑同一用例（各一条 `test`）。
2. 运行红测并记录实际 `after` 外部 id 集合（预期比目标多出旧来源的 `issue-*`/`pr-7`，实际条数以输出为准）。
3. 提交（Batch 1 单独可回滚）：`test(core): 复现切换后旧规划来源投影仍被读取`，正文 `Refs #202`。

```js
import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newWorkspaceId } from '@harness-projects/domain'
import { composeCore } from '@harness-projects/core'
import { FakeFixtureName, createFakePlanningProvider, createFakeProviders, createFakeStorage } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const CLOCK = '2026-11-20T00:00:00Z'
const ids = (views) => views.map((view) => view.content.identity.externalId).sort()
for (const [name, open] of [['Fake', createFakeStorage], ['SQLite', () => createSqliteStorage(':memory:')]]) {
  test(`${name}: switch serves only the enabled planning mount (#202)`, async (t) => {
    const storage = open(), id = newWorkspaceId(), providers = createFakeProviders(), clock = () => CLOCK
    t.after(() => storage.close?.())
    const old = await composeCore({ workspace: { id, name: 'switch' }, providers, storage, clock })
    const before = await old.queries.listPlanningItems(), oldBindingId = providers.planning.bindingId
    assert.ok(before.length > 0, '前置：旧来源有已提交投影')
    assert.ok(before.every((view) => view.content.identity.bindingId === oldBindingId), '前置：旧投影来自旧挂载')
    const mount = (await storage.listProviderBindings(id)).find((row) => row.id === oldBindingId)
    await storage.putProviderBinding({ ...mount, enabled: false, isDefault: false })
    const planning = createFakePlanningProvider({ fixture: FakeFixtureName.DraftBacked })
    const core = await composeCore({ workspace: { id, name: 'switch' }, providers: { ...providers, planning }, storage, clock })
    const mounts = (await storage.listProviderBindings(id)).filter((row) => row.domain === 'planning')
    assert.deepEqual(mounts.filter((row) => row.enabled).map((row) => row.id), [planning.bindingId], '前置：恰好一个启用规划挂载')
    assert.deepEqual(mounts.filter((row) => !row.enabled).map((row) => row.id), [oldBindingId], '前置：旧挂载已停用')
    const after = await core.queries.listPlanningItems()
    assert.deepEqual(ids(after), ['draft-1', 'draft-2', 'issue-9'], '列表只返回启用挂载的条目')
    for (const view of after) assert.ok((await storage.listIdentitiesForEntity(view.entityId)).some((row) => row.bindingId === planning.bindingId), '每条都来自启用挂载')
    assert.deepEqual(after.filter((view) => before.some((row) => row.entityId === view.entityId)), [], '旧来源实体一条都不出现')
    assert.deepEqual((await core.queries.getPlanningSnapshot()).views.map((view) => view.entityId), after.map((view) => view.entityId), '快照与列表同源')
    assert.equal(await core.queries.getItemDetail(before[0].entityId), undefined, '旧来源条目详情不可读')
    assert.notEqual(await core.queries.getItemDetail(after[0].entityId), undefined, '启用来源条目详情仍可读')
    assert.equal((await core.queries.getWorkspaceMetadata()).planningSource.bindingId, planning.bindingId, '元数据指向启用挂载')
  })
}
```

断言顺序即判别顺序：红测在 `ids(after)` 的 `deepEqual` 处第一个失败，后续断言要到绿测才执行；这不是「每 storage 三条断言各自变红」（订正见 D4）。

**验证**：在检出 `fix/planning-source-projection-filter` 的工作树根运行

```bash
node --test --test-timeout=120000 tests/integration/planning-source-switch.test.js
```

期望输出：`ℹ fail 2`（Fake、SQLite 各一），失败信息显示 `actual` 含 `draft-1`、`draft-2`、`issue-9` 之外的旧来源条目；`ℹ pass 0`。若红测意外通过，先检查是否误改了 `packages/core/src/queries.ts` 或旧挂载未被真正停用（两条前置断言会先失败）。

**回滚**：未提交时删除新建的测试文件；已提交时 `git revert <Batch 1 commit>`。不涉及数据。

### Batch 2 · Core 读取过滤与全量验证

**最小闭环**：只改 `queries.ts`，红测转绿，相邻读取语义不回归。

**涉及文件**：`packages/core/src/queries.ts`。

步骤：按 Design 第 1-4 条落 helper 与两个调用点；不改任何其它文件；跑下列验证；提交 `fix(core): 只读服务启用规划挂载的投影`，正文 `Closes #202`。

**验证**（同一工作树根，按顺序）：

```bash
node --test --test-timeout=120000 tests/integration/planning-source-switch.test.js
node --test --test-timeout=120000 \
  tests/integration/planning-source-switch.test.js \
  tests/integration/planning-snapshot.test.js \
  tests/integration/runtime-planning-access.test.js \
  tests/integration/workspace-setup-commands.test.js \
  tests/integration/ui-work-item-detail-read.test.js
pnpm run typecheck
pnpm verify
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
```

期望输出：第一条 `ℹ pass 2 / ℹ fail 0`；第二条全部 `pass`、0 fail；`typecheck` 退出码 0 无输出；`pnpm verify` 退出码 0；size 检查通过（预计代码桶约 130-160 行、文档约 260 行，低于 1000/1500 上限）；`git diff --check` 无输出。

**回滚**：`git revert <Batch 2 commit>`。修订号、schema、投影行均未变；回滚后列表重新暴露两个来源，无需清理数据或迁移。

### Batch 3 · 实际来源与共享实体失败恢复

**最小闭环**：修复 F1 的持久来源事实，覆盖正常写入、原子收敛、失败读取、重开和恢复，保留 native PR 身份收敛及同源 D23。

先在现有 `planning-source-switch.test.js` 增加 A/B 同 native PR 的反例：A 成功、B 成功、切回离线 A，三 API 不得出现 B title/body/status；持久 reopen 后仍成立，A 恢复后同实体重新可见，二次相同刷新不推进修订；同源离线保留最后值。共享 Storage 契约补来源往返、同实体第二来源覆盖、source-only 作用域外保留、缺失/未知来源与 scope 不匹配的原子拒绝；旧 shape 准入用现有 hash/snapshot 模式证明 generation 0/6/7 均拒绝且零写入。

观察上述反例在旧实现变红后，实现当前 Design 的必填来源、typed SQL 列及 Fake 对称校验，改造 bootstrap 与三查询，调整真实旧形状夹具。权限脱敏保留来源；不扩大到新的 UI 切换命令或其他 entityId 命令语义。另用 barrier 挂起旧 A 的成功/拒读返回，B 确认后才释放；旧 A 必须零落库，B 的行、三查询、修订、新鲜度、reconcile 及 A 的已开始 cursor/已提交 round 全部保持释放前事实。

**验证命令**：均在检出 `fix/planning-source-projection-filter` 的工作树根执行，先窄后宽。

- `pnpm test:file tests/integration/planning-source-switch.test.js`：红阶段共享反例两存储因 B 内容泄露失败；绿阶段全部通过，包括同源失败/恢复和来源变化修订号。
- `pnpm test:file tests/contract/storage-contract.test.js tests/integration/storage-restart.test.js tests/integration/storage-baseline-admission.test.js tests/integration/identity-membership-schema.test.js tests/integration/identity-membership-enums.test.js tests/integration/harness-plugin-migrations.test.js tests/integration/sync-revision-freshness.test.js tests/integration/runtime-planning-access.test.js tests/integration/pull-request-identity-convergence.test.js`：来源、原子性、重开、旧库拒绝、修订、权限和身份均 0 fail。
- `pnpm verify` 与 `pnpm run boundaries`：该修复触及 domain/Storage/schema，执行当前全层回归与依赖门。
- `node scripts/review-mutate.mjs <spec.json>`：用恢复保证脚本施加 any-identity 查询回退、丢失来源写入、错误来源收敛/验证等最小变异；每个 `killedBy` 指向真实失败断言，最终整表重测后写入评审记录。
- `node scripts/rule-checks.mjs size origin/main`、`node scripts/rule-checks.mjs disclosure origin/main`、`git diff --check origin/main...HEAD`：规模、完整发布面及 whitespace 通过；最终 PR 文本通过 PR_BODY 扫描。

**回滚**：整份 PR 整理成一个交付 commit 可独立 revert。恢复旧应用必须配对原 schema 库的备份；不通过改世代号打开旧库，不自动清理用户数据。恢复引用 `refs/backup/pr-668-takeover-20261121` 保存接管前历史。

### Batch 4 · 独立复评与条件合并

独立 reviewer 按全部 P0–P3 矩阵复核新来源事实和双存储反例；无阻塞后归档本计划并更新索引，整合提交、exact lease 推送。最终 push 后重新锁定 `gh pr view 668 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,commits,closingIssuesReferences,reviews,statusCheckRollup` 和全部 reviewThreads；当前 head 必需 PR Fast Gate 成功后，以开发账号回复根因和证据并 resolve P1，评审账号重新批准。核对 #202 两项工程验收，按直接授权 rebase merge，回读合并树、issue，并清理该任务分支/worktree/临时结果。Planning Status 与 R1 独立。

## Validation and Acceptance

- issue 验收 1「切换后 `listPlanningItems` 只返回启用规划挂载的投影」：Batch 2 绿测的 `ids(after)` 与「旧来源实体一条都不出现」断言；快照与详情断言覆盖同源要求。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：共享实体 A→B→A 失败切换在两存储三 API 返回 B 内容，第一项验收未完成。
- issue 验收 2「Fake 与 SQLite 行为一致」：同一用例循环两个适配器，红测两侧同因失败、绿测两侧同时通过。
- 无用户可见切换命令：`tests/integration/workspace-setup-commands.test.js:152-163` 保持绿，`bindPlanningSource` 未改。
- 读取降级/脱敏不回归：`runtime-planning-access.test.js`、`ui-work-item-detail-read.test.js`、`planning-snapshot.test.js` 保持绿；`getPlanningSync`/`getWorkspaceMetadata` 未被修改。
- 规模：`pnpm verify` 与 size 检查通过即为合并前门禁；不跑 `boundaries`（依赖边未变）与 SQLite 契约套件（port/schema 未动）。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：这些检查保留为历史验证证据，不能替代来源正确性与 F1 修复后的独立复评。

## Progress

- [x] （2026-11-20，bf655e78）本计划创建并登记 `docs/README.md` Active 索引。
- [x] （2026-11-20，f0077ca5）Batch 1：红测落库并确认 `ℹ fail 2`；在检出 `fix/planning-source-projection-filter` 的工作树根运行 `node --test --test-timeout=120000 tests/integration/planning-source-switch.test.js` 退出码 1（`ℹ tests 2 / ℹ pass 0 / ℹ fail 2`），Fake 与 SQLite 两侧同因失败于 `ids(after)`，actual 含旧来源 `issue-1`、`issue-2`、`issue-3`、`issue-4`、`pr-7`。
- [x] （2026-11-20，8c863b5d）Batch 2：`queries.ts` 过滤落地，同一显式用例退出码 0（`ℹ tests 2 / ℹ pass 2 / ℹ fail 0`）；相邻回归 5 个文件退出码 0（`ℹ tests 255 / ℹ pass 255 / ℹ fail 0`）；`pnpm run typecheck` 退出码 0；`pnpm verify` 退出码 0（contract 1616 pass；integration tests 2324 / pass 2296 / skipped 28 / fail 0；e2e 226 pass）；`node scripts/rule-checks.mjs size origin/main` 退出码 0（HEAD `8c863b5d` 观察代码桶 55 行、文档桶 216 行）。
- [x] （2026-11-20 22:11 SGT）PR #668 回读：head `113e9ee26e08ad178284f8eba4e95c760c35d872`、base `main` @ `33fcde29`；`closingIssuesReferences` = [202]；`PR Fast Gate` / Verify / Browser / Windows Native 全 pass；交人类评审（不自行合并）。

- [x] 原 P1 F1 经 D9 接管、D10 来源事实及 D11 提交资格修复；共享失败/重开/恢复/在途轮次反例已验证、独立复评无剩余 P0–P3。原等待修复状态由本条取代，最终托管门禁仍按 Batch 4 动态回读。

- [x] （2026-11-21 16:52 SGT）Batch 3 红：共享 native PR 反例在 Fake/SQLite 的重开前后三 API 均泄露 B payload；相同 payload 换源 revision 实际 1、期望 2。Storage 定向命令含基础套件正控制，2 pass / 3 fail：Fake 误删 B、SQLite 丢来源、Fake import 缺来源未拒绝。
- [x] （2026-11-21 16:52 SGT）Batch 3 实现：必填来源、schema 世代 7、双存储来源收敛与混批拒绝、Core 来源过滤及权限只处理本来源；共享失败/恢复/重开/同源最后值/日期字段/权限反例 12/12，Storage 窄集 5/5、typecheck、10/10 boundaries 通过。完整回归及独立复评继续，未声明最终 head 门禁。

- [x] （2026-11-21 17:22 SGT）补跨来源在途轮次红/绿：success / permission-denied × Fake/SQLite 四项先全部 RED；事务内当前来源守卫后，来源/同源轮序/权限/修订四文件 308/308 与 typecheck 通过，现有 stale_revision message 保留。新来源测试共 16 项。

- [x] （2026-11-21 17:25 SGT）最终整表 7/7 变异 KILLED、exit 0、还原后基线通过；E2E 226/226 通过，D11 后 Core 四文件308/308、typecheck通过。D11 前本机 bounded contract1620/1620；bounded集成2337项6失败，3文件单独72/72通过，事实如实保留于评审记录。
- [x] （2026-11-21 17:25 SGT）修复与内部独立复评完成，计划归档，文档索引与配对恢复边界更新；最终交付提交及当前 head 的托管标准门禁、thread/issue核对按 Batch 4执行，归档不冒充已合并。

## Surprises & Discoveries

- 2026-11-20：上游只有读取侧过滤提案一份，级联提案文件不存在；级联方案按 issue 与读取侧提案的转述重建（拒绝理由见 Design 被放弃方案 2、Decision Log D5）。
- 2026-11-20：读取侧提案的行号引用与基线 `33fcde2` 实际代码一致（`queries.ts:91-101/114-125`、`bootstrap.ts:238-243`、adapters 的 replace 实现、`runtime-access.ts:179-190`），未发现与代码相反的事实断言。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：后续独立反例推翻“identity 可证明 projection 来源”的实质假设。
- 2026-11-20：该提案两处表述需订正——红测「三条断言各自变红」与「级联需要新增破坏性 port」；订正与理由见 Decision Log D4、D5。
- 2026-11-20（impl-202）：红测实际输出与 D4 完全一致——Fake、SQLite 各一用例在 `ids(after)` 处失败，actual 为 8 个外部 id（旧 `issue-1`、`issue-2`、`issue-3`、`issue-4`、`pr-7` 与新 `draft-1`、`draft-2`、`issue-9`），说明旧 IssueBacked 的 5 条投影（含被遮蔽的 `issue-3`）仍在服务；随后断言未执行，与 D4 的「首个失败即终止用例」判断相符。
- 2026-11-20（impl-202）：测试文件实际 35 行，低于 Batch 1 的「约 110-130 行」粗估；判别断言与骨架逐条一致，没有减少。
- 2026-11-20（impl-202）：实现是净增 13 行（`queries.ts` +16/-4），代码桶实际 55 行，远低于 Batch 2 的「约 130-160 行」估算与 1000 行硬上限；估算偏差来自计划按展开格式估算，判别力未受影响。

- 2026-11-21 10:23 SGT：F1 在 Fake / SQLite 三 API 复现停用来源内容；第二位独立评审用不同项目 A/B 与同 native PR 复现 B title/body/status=done，仍挂 A primary。详见评审记录。

- 2026-11-21 16:52 SGT：受影响 9 文件 840 项首轮 839 pass / 1 fail；唯一失败是新 `source_binding_id` 外键的出处注释缺少规则编号。保留原断言，注释补“不变量 1 / #202 / ADR-0006”后 schema 文件 19/19 通过。没有放宽 CHECK、FK、准入或判别测试。

## Decision Log

- D1（2026-11-20，plan-202）：采用 Core 读取时按「实体有任一身份属于启用规划挂载」过滤，不改 Storage。Rationale：来源事实已由 `external_identity.binding_id` 表达且写入侧已按它定义作用域；读取时 `access.binding.ref.bindingId` 已可用；过滤是非破坏性的，启用即生效，不依赖下一轮同步成功；Fake/SQLite 的 parity 是构造性的（过滤是 Core 纯函数，无第二份实现）。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：identity 不是 payload provenance；首轮失败仍可能暴露已停用来源。
- D2（2026-11-20，plan-202）：没有启用规划挂载时不过滤，保留 D23 最后已知值。Rationale：本 issue 的验收语境是「切换＝旧停用＋新启用」；disable-only/unbind 是另一产品路径，当前生产不存在，把「无挂载」解释为「全部不可见」会改变既有降级语义且无验收证据；出现 disable-only UX 时另开 issue 重新评估谓词。
- D3（2026-11-20，plan-202）：谓词用「任一身份」而非只看 primary。Rationale：与 `replacePlanningProjections` 的 scope 判据逐字一致；避免把原生 PR 身份共享实体误判为旧来源而丢失（不变量 6、PR 身份收敛）。primary 只决定 `content.identity` 展示。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：any identity 与 primary 均不足以独立证明当前投影来源。
- D4（2026-11-20，plan-202）：订正读取侧提案 §8 的「三条断言各自变红」。Rationale：红测在同一 `test` 内按顺序断言，首个失败即终止该用例，所以红测是「两适配器各一用例失败在 `ids(after)` 处」；`getItemDetail` 的旧/新断言与元数据断言只在绿测执行。已按此写 Batch 1 期望输出。
- D5（2026-11-20，plan-202）：订正读取侧提案 §3.3 对级联的「需要新增破坏性 port 方法」表述。Rationale：`replacePlanningProjections({ workspaceId, bindingId }, [])` 已能表达清空旧作用域，无需新 port；级联被放弃的真实理由是失败路径与原子性（见 Design 被放弃方案 2），而不是端口缺失。选择结论不变。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：原级联风险分析保留，但读取过滤方案也未闭环；来源/代际或原子失效由 owner 重评。
- D6（2026-11-20，plan-202）：不新增用户可见切换命令。Rationale：issue 明确只修「停用来源投影污染」，`bindPlanningSource` 的 `not_supported` 是当前产品边界；新增命令需要独立 issue 与人类批准。
- D7（2026-11-20，impl-202）：验证证据按「先提交实现，再重跑 size 与 `git diff --check`」采集。Rationale：`rule-checks size` 只比较 `origin/main...HEAD` 已提交 diff，提交前的中途输出会漏掉未提交的 `queries.ts`，不能作为验收证据。观察（HEAD `8c863b5d`）：代码桶 55 行、文档桶 216 行；实现与设计无偏差，D1–D6 不变。 **Superseded by docs/review/pr-668-mmp-review.md F1（2026-11-21）**：原命令结果保留，D1/D3 的正确性结论由 F1 推翻。

- D8（2026-11-21 10:23 SGT，独立评审 / 协调者）：#202 验收未完成，PR #668 已由评审账号提交 REQUEST_CHANGES（review 6002114371，锁定 head `c63e4575cae90d49b714cd8f02fdf700a4b2793b`）。保持 Active 阻塞，不关闭 issue、不归档、不合并；人类尚未指定修复 owner，禁止开始产品修复。Superseded by D9（2026-11-21）：人类已指定本会话接管；阻塞只有在修复独立复评及当前远端门禁通过后解除。Rationale：双存储共享实体反例与独立交叉复现证明任一 identity 不足，primary-only 同样不可用；明确来源/代际或受控原子失效是待 owner 的设计选择，原 schema/port 禁止不是正确性豁免，D23 同源最后值必须保留。

- D9 · 2026-11-21 16:41 SGT / 人类原话“由你接管并修复”：明确指定本会话协调者接管 PR #668。结合前文点名 #667–#669 的条件授权，修复后独立复评、归档/整合、核对 issue 并以 rebase 合并；不授权缺陷未解决时合并，不变更 Planning Status/blocking 关系。原 D8 等待 owner 的状态由本决定取代。
- D10 · 2026-11-21 16:41 SGT / 协调者：采用必填持久来源而非身份推断；schema 世代提升到 7，旧库拒绝/原样保留，单基线无兼容迁移。Rationale：两位独立设计调查确认现有 membership/round/JSON 载体都不能证明最后写入来源；来源属于可见性事实并影响业务快照。取舍是 A→B→A 失败时隐藏 B，不恢复已被覆盖的 A 历史 payload。

- D11 · 2026-11-21 17:22 SGT / 协调者：新增公开 API 并发反证推翻“既有 epoch/round 足以保护跨来源提交”的假设。A 晚于已确认 B 提交会覆写 source/revision/reconcile，使 B 空表但健康；旧拒读还会写 A 的 cursor。#305 只保护同 workspace/binding 的轮次，#368 明确不承接切换。本 #202 在成功提交和失败结算事务内加同一个当前来源校验，所有事实写入前拒绝已撤销来源；不新增 port、全局轮次或切换命令。

## Idempotence and Recovery

- 历史 Batch 1–2：每次新建工作区 id 与内存 Storage，SQLite 用 `:memory:`。Superseded by Batch 3（2026-11-21）：共享失败/恢复用例对 SQLite 真正文件关库重开、Fake 导出/导入，并由测试清理临时库。
- 历史 Batch 2：实现是查询层纯过滤，重复执行无副作用；不写数据、不推进修订号，因此不需要清理或回填。Superseded by D10 / Batch 3（2026-11-21）：正常同步与 payload 同事务持久来源；来源变化影响可见性而推进业务修订，纯查询及未改变 payload 的失败不推进；明确拒读引起本来源脱敏变化时推进一次，来源不由旧身份回填。
- 失败恢复：Batch 1 失败即修正测试（前置断言或适配器构造），不碰生产；Batch 2 失败先回滚 `queries.ts` 到上一提交，红测应重新变红，据此区分实现错误与测试错误。
- 历史已知状态：`main@33fcde2` 与 Batch 1–2 无 schema/数据变化。Superseded by D10 / Batch 3（2026-11-21）：修复提升 schema 世代至 7；回滚应用必须同时恢复与旧包匹配的原库备份，旧应用不能读新库，不修改世代号绕过准入。接管恢复引用见 Batch 3；测试和验证只使用沙箱库，不操作实际用户库。

## Interfaces and Dependencies

- `get/list/put/replacePlanningProjections` 方法签名保留，但 `WorkspaceProjection.sourceBindingId` 必填，replace scope 现在按实际来源收敛并拒绝混来源；来源父边指向持久连接锚点，保留卸载后的历史。`RuntimeAccess.planning` 提供当前挂载，Core 决定可见性。
- `CoreQueries` 的 `getPlanningSnapshot/listPlanningItems/getItemDetail` 签名与返回类型不变；controller/client/ui 无需改动，自动获得过滤后的列表与快照。
- 历史 Batch 1–2：无新依赖、无环境变量、无凭据、无迁移；Fake 与 SQLite 适配器均不改动。Superseded by D10 / Batch 3（2026-11-21）：两个适配器与单资产基线按新来源契约同步修改，schema 世代 7、逻辑基线仍为 1；没有兼容迁移、推断补值或新依赖，旧库保留/配对恢复方式见 `docs/product/demo-install.md#database-recovery`。
- 验证依赖：Node 26（原生 TS 类型剥离）、pnpm、`gh`（仓库 `SingularityKChen/harness-projects`）。

## Outcomes & Retrospective

工程修复完成（2026-11-21 17:25 SGT，`fix/planning-source-projection-filter`，基于 `main@471a991bebf77356d5d7e6f12d284fe98bbff019`）。首轮 any-identity 设计被 F1 反证，当前使用必填持久来源，并在事务内核对当前启用来源后才结算；实体身份收敛、同源最后值、纯读、权限脱敏和修订机制保留。A→B→失败/在途 A 不再泄露或覆盖 B，来源变化影响可见性而推进一次修订，同源重复不推进。

当前判别证据：来源场景16项及相邻四文件308项通过，Storage来源定向5项、schema19项、typecheck、10项边界、E2E226项通过，最终7项变异均由指定断言杀死并完整还原。内部独立全矩阵与新增守卫复评均无产品P0–P3；文档P2已原处修正并独立复核。完整本机运行的超时/Host拒绝和对应窄重跑结果见评审记录，不声称一次本机完整全绿；最终托管标准 Verify/Browser/Windows Native/PR Fast Gate 必须在当前 immutable head通过。

SQLite schema世代提升为7，逻辑基线仍为1，旧库零写拒绝并保留；没有自动迁移、来源推断、双缓存、UI切换命令或Host wire扩张。回滚必须配对旧包和原库备份。本次无新增实现技术债；#368/#273、disable-only语义、其它entityId命令和历史工程谱系保持原范围，Planning Status与安装人验/R1不由工程结果代替。首审等待owner与未验收状态的历史原文保留在D8/评审记录，已由D9–D11取代。

## Bottom Change Note

- 2026-11-20 21:58 SGT / plan-202：创建本计划并把「规划来源切换后只读投影过滤（#202）」登记到 `docs/README.md` Active 索引；设计取读取侧过滤，订正上游提案的两处表述。
- 2026-11-20 22:00 SGT / impl-202：回填 Batch 1-2 的 Progress、Surprises、D7 与 Outcomes 部分结果；记录红/绿输出、相邻回归、typecheck、`pnpm verify`、size 与 `git diff --check` 证据；Design、Global Constraints 与批次步骤未改。

- 2026-11-21 10:23 SGT / 独立评审：将 F1 对来源假设、最小证据与验收结论的反证逐处标记 Superseded；补 D8、P1 待修与评审记录范围，保持 Active，不触发产品修复或归档。

- 2026-11-21 16:41 SGT / 协调者：按人类接管授权重新锁定/更新到当前 main，修订实际来源设计与红绿批次；保留 F1 对历史假设的原处订正，扩大必要的 Storage/schema 契约范围。

- 2026-11-21 16:52 SGT：记录根因反例的真实 RED→GREEN、schema 出处检查修正和已完成窄验证；完整 verify、变异和独立复评尚未完成。

- 2026-11-21 16:59 SGT：处理内部独立复评 P2，原处订正 Recovery/Interfaces 与等待 owner 的历史结论；明确 schema 7 的配对恢复，不再以旧的纯查询范围描述当前修复。

- 2026-11-21 17:22 SGT：记录跨来源旧 writer 的第二条来源权威反例及 D11 守卫；完整集成层的开库前 Host 拒绝单独三文件72/72通过，最终仍以当前 head 托管全门为准。

- 2026-11-21 17:25 SGT：归档已独立复评的工程修复，记录D11后308/226验证、最终7项变异及本机完整门的实际限制；最终托管门禁与合并采用Batch4回读规则。
