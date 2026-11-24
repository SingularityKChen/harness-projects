# provider-unbind ExecPlan

> 状态：Completed
> 创建：2026-11-24
> 范围：issue #368 —— 工作区挂载的显式解绑（disable-not-delete，仅 development / delivery）与 `bindRepository` 同目标 revive；只改 core + controller 及其集成测试，无 Host wire/UI。
> 上游输入：issue #368（`kind:feat area:core`，M4.1）、2026-11-24 迭代 12 Lead 决策、`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、`docs/review/README.md`、ADR-0015、issue #368 内的 2026-10-28 / 2026-10-29 forecast。

## Purpose / Big Picture

完成后，工作区设置命令可以显式停用一个误绑或多余的 Development / Delivery 挂载：下一次按已存挂载恢复 provider 表时不再组合它，但挂载行、账号关联、挂载配置、外部身份与仓库锚点全部保留；planning 与 execution 一律结构化拒绝。唯一逆操作是同一仓库以同实现、同目标重新 `bindRepository`：原 `bindingId` 复活，delivery 恢复默认槽，不新增行或身份。

判断成功的最小证据：V1 的新增 10 条用例（AC1–AC5 × 两种存储）使集成文件从 28 条变为 38 条且全绿；V2 e2e 21 条不变；V3/V4 通过；V5/V6 在预算内；V7 无空白错误。命令在本轮没有 Host 消费者，观察面是 core/controller API 与真实的 `restoreProviders` 装配读取。

## Context and Orientation

**术语**

- **挂载（mount）**：Storage 的 `workspace_binding` 行，由 `(workspaceId, bindingId, domain)` 标识，携带 `enabled` / `isDefault`；`bindingId` 指向连接锚点与实现。
- **disable-not-delete**：只写 `enabled=false`（同时 `isDefault=false`，遵守 `CHECK (is_default = 0 OR enabled = 1)`），不删行、不删账号/配置/身份/仓库锚点。
- **revive**：同仓库、同实现、同目标再次 `bindRepository` 时把停用行翻回 `enabled=true`，复用原 `bindingId`。
- **交付默认槽**：交付读取按默认 delivery 挂载取数据（TD-074），所以工作区同一时刻至多一个启用的 delivery 挂载。
- **现行引用**：`repositoryReferences` 返回的、锚点所在实体上的仓库身份；停用挂载的引用仍在其中。

**当前状态**（2026-11-24 设计期观察；易失状态一律以命令回读为准：`git rev-parse HEAD` 设计时为 `c24d1491`、`git rev-parse origin/main` 同为 `c24d1491`、`git status --porcelain` 为空。实现与验收期间 HEAD 已前移，最终 head 见 Progress 与 Outcomes 的回读说明——不把易失 HEAD 写成静态事实）

- `packages/core/src/workspace-setup.ts` 的 `WorkspaceSetup` 只有 create-or-verify 命令；`bindRepository` 在 `workspace-setup.ts:178-217` 创建挂载、同事务 `registerRepository` 写引用与锚点。设置命令是 `enabled` / `isDefault` 的唯一业务写者；`packages/core/src/context.ts:155` 组合时只对**已组合**行写回 `enabled=true`，停用行不在 provider 表里。
- Storage 已支持停用：`putProviderBinding` 是 upsert（`packages/storage/sqlite/src/storage.ts:46-57`、`packages/providers/fake/src/storage.ts:223-245`）；`workspace_binding` 的主键与 CHECK 在 `packages/storage/sqlite/migrations/001_init.sql:47-68`。`removeProviderBinding` 是删除语义，不采用。
- Host 装配已跳过停用挂载且不把它计入 `disabled`（`apps/harness-plugin/src/host-providers.ts:319-320,333`），因此“下一次装配不组合”不需要改 Host。
- controller 的 `SetupCommands` 与账本在 `packages/controller/src/commands.ts` 的 `createSetupCommands`；失败映射为 `setupResult`，成功为 `local_only`。
- **陷阱**：`bindRepository` 的现有查找包含停用行（`workspace-setup.ts:198`），命中同目标时返回同 id 但不再启用 → 假成功。这是本计划必须同时交付 revive 的直接原因。
- **恢复路径证据**：只剩停用 planning 时 `bindPlanningSource` 返回 `not_supported`（`workspace-setup.ts:169-171`）；含停用 execution 的现存 pair 被 `installExecutionBindings` 永久 `conflict`（`packages/core/src/execution-setup.ts:22`）。故 planning / execution 没有恢复路径。
- **引用证据**：`repositoryReferences` 必须看到全部挂载（`packages/core/src/development-route.ts:108-126`）；路由只吃组合后的 registry（`development-route.ts:71-93`）。ADR-0015 的 Consequences 把“解绑与改绑”的后续决定指向 #387。
- **AC3 时效**：issue 正文的“until #202 lands”已过时（#202 已 CLOSED）；但同一 issue 的 2026-10-28 与 2026-10-29 forecast 明确要求“keep Planning unbind guarded, regardless of #202 landing”。本计划按 forecast 保留守卫，并据此支持 `Closes #368`。

## Design / Spec

### 选定方案

只改三处生产代码路径：`workspace-setup.ts` 新增 `unbindProviderBinding`（disable-not-delete，仅 development / delivery）与 `bindRepository` 的同目标 revive；`core/index.ts` 导出请求类型；`controller/commands.ts` 增加命令与账本接线。不新增 Storage 端口、schema、迁移、回执、Host wire 或 UI。

判定顺序固定为：闭集形状 → 能力域政策 → 行查找，全部只读判定通过后才写；任何拒绝在大事务内回滚或从未写入。写停用时**单次** `putProviderBinding({ ...row, enabled: false, isDefault: false })`；停用行再调用是零写入成功。

### 解绑后引用与重绑语义（决策表）

| 场景 | 行为 | 结果 / 写入 |
|---|---|---|
| 解绑 planning 挂载 | 一律拒绝 | `not_supported`，零写入；无恢复路径，不提供 |
| 解绑 execution 挂载 | 一律拒绝 | `not_supported`，零写入；pair 永久不可重装 |
| 解绑启用中的 development / delivery | 写停用 | `ok { bindingId }`；1 次 `putProviderBinding`，行仍保留 |
| 解绑已停用挂载 | 自然键幂等 | `ok { bindingId }`，零写入 |
| 解绑后同实现同目标 `bindRepository` | 原挂载 revive | `ok`，原 id；`enabled=true`，delivery 同时 `isDefault=true`，不新增行/身份 |
| 解绑后同实现不同目标 `bindRepository` | 不改绑 | `conflict`，零写入 |
| 解绑后另一实现 `bindRepository` | 既有新建路径（AC5-368） | 新挂载；不是 revive，原行保留停用，引用并列 |
| revive delivery 但已有另一启用 delivery | 不替换默认槽 | `conflict`，零写入 |
| 引用级移除/改绑/primary 补救 | 不在本命令 | 归 #387；本命令粒度是挂载，一个挂载可承载多个仓库引用 |

决策表逐行都有可执行证据：AC1–AC4 覆盖前四类核心行（含默认槽竞争与恢复路径），AC5-368 覆盖“另一实现”行；最后一行的“引用级移除/改绑/primary 补救”明确不属于本命令，归 #387。

停用挂载的仓库引用仍留在 `repositoryReferences` 里；路由只看组合后的 registry，所以停用挂载不参与路由，读路径只会结构化不可用（无启用 Development 挂载时 `conflict` / 无启用 delivery 时缺口），不会静默读错连接。`repositoryReferences` 本 PR 不过滤；#387 若要过滤，必须拆开“路由 id 集”与“身份解析 id 集”，否则锚点解析会断。

### 错误码与判定顺序

| 输入 / 状态 | 码 | 写入 |
|---|---|---|
| 非普通对象、未知字段、空串、非字符串或未知能力域、`domain=storage` | `invalid_input` | 0 |
| `domain=planning` 或 `execution`（含该 binding 不存在） | `not_supported` | 0 |
| 三键无行（含跨工作区、域不匹配） | `not_found` | 0 |
| development / delivery 已停用 | `ok` | 0 |
| development / delivery 启用中 | `ok` | 1 |

`storage` 不是可挂载的外部域，属于形状错误；planning / execution 是已知外部域但无恢复路径，属于政策拒绝。unbind 自身不产生 `conflict`；controller 账本的 conflict 只来自同键异请求。错误文案不得回显输入值。

### revive 规则

在 `bindRepository` 的只读判定阶段收集 `revived`（不改写）：命中 existing 且目标相同、`!existing.enabled` 时，若 domain 是 delivery 且 `mounts` 里已有其他启用 delivery → `conflict`（沿用“工作区已有启用的交付来源：不替换”）；否则记入 `revived`，继续用原 id 填 `bindingIds`。全部判定完成后，在既有写阶段前/同事务写 `putProviderBinding({ ...existing, enabled: true, isDefault: existing.domain === 'delivery' })`。已启用同目标仍走零写入返回。`registerRepository` 只登记本次新建引用，revive 不新增身份。

### 变异锚点（设计期只读证据）

设计期确定（2026-11-24，`feature/provider-unbind-20261124` @ `c24d1491`）：M1 删停用早退 → AC2 出现第二次写；M2 删域政策 → AC3 得 `ok`；M3 停用写漏 `isDefault:false` → AC1 存储拒绝；M4 删闭集校验 → 形状用例通过；M5 删 revive → AC4 行仍停用；M6 删交付槽竞争检查 → AC4 竞争段变 `ok`；M7 revive 改为新建 → AC4 id/挂载数变；M8 不同目标不拒 → AC4 改绑段变 `ok`。独立验收用 `scripts/review-mutate.mjs`，先证明已应用、提交前还原；基线、假成功与代码事实见 Surprises & Discoveries。

### 被放弃的方案

- 只加 unbind、不加 revive / 被引用即拒绝 / `removeProviderBinding` 真删：分别导致不可恢复、命令恒不可用、丢配置与锚点后只能 `conflict`；三者都不满足“解绑必须可逆且只停用”。
- 加 Host wire/UI：本轮无消费者，且要动操作键集、client source、发布面文档，超出 CodeBudget=300。
- 忽略停用行、绑定新锚点：binding id 漂移，在途 `mutation_attempt.bindingId`（`create-change-request.ts` 的 pending 记录、`start-work.ts:172`）与跨重启路由恢复全部失效。

## Global Constraints

**文件集**（全任务唯一集合；各批次只列自己的子集；验收处置轮按 Decision Log D13 新增两行评审记录文件）

| 路径 | 变更 |
|---|---|
| `packages/core/src/workspace-setup.ts` | 新增命令与 revive 判定/写入 |
| `packages/core/src/index.ts` | 导出 `UnbindProviderBindingRequest` |
| `packages/controller/src/commands.ts` | 命令类型、`SetupCommands` 成员、`createSetupCommands` 接线 |
| `tests/integration/workspace-setup-commands.test.js` | 10 条新用例（AC1–AC5 × 2 存储）与文件头/过时注释 |
| `docs/exec-plan/completed/2026-11-24-provider-unbind.md` | 本计划 |
| `docs/README.md` | Completed 索引一行 |
| `docs/exec-plan/tech-debt-tracker.md` | TD-038“下一步”一格一行更新，状态保持 Open |
| `docs/review/pr-676-mmp-review.md` | 新增：PR #676 独立 agent 对抗验收的处置记录（P0–P3 矩阵、逐条处置与证据、残余风险） |
| `docs/review/README.md` | §8 评审记录索引新增 PR #676 一行 |

- 运行时：Node `>=22`（本机 v26.13.1）、pnpm 10.28.2；不新增依赖；测试离线（临时目录 + 录制夹具），不读写真实凭据。
- 规模：技术增删之和 ≤800（设计期预计 260–300，实现期实测 192，验收处置补 AC5-368 后的最终值见 Outcomes）；文档 ≤1300（设计期预计 215–235，含验收处置的评审记录与计划回填后最终值见 Outcomes）；仓库硬上限 1000/1500 由 V5 判定。
- 范围禁止：不改 Host（`apps/` 零 diff）、不新增 wire/UI/client、不改 Storage 端口/schema/迁移/兼容层、不改 `repositoryReferences`、不改 planning 切换/execution 卸载、不关闭 TD-077、不写 issue 或 Project 字段；PR 的标题、labels、milestone 与 assignee 按 Lead 决策填写。
- 文档：正文中文，路径/命令/标识符英文；不写本机绝对路径；不引用运行态状态、日志或清单；禁止未决占位符。
- Git：分支 `feature/provider-unbind-20261124`，base=main；Conventional Commits，提交正文说明为什么，提交统一用 `Refs #368`，issue 关闭由 PR 描述正文的 `Closes #368` 承担（`closingIssuesReferences` 已解析到 #368），不在提交 trailer 重复声明（2026-11-24 验收订正，见 D12）；不合并；不改写已推送的 Batch 1 文档提交 `e126058a`，其余本地未推送提交按评审整理，push 由 Lead 执行、本工作树不 push。
- 证据：只记录实际命令与输出；变异先证明已应用、提交前还原；不把失败写成通过。

## Plan of Work

允许在评审后合并相邻批，但每批必须各自可独立验证、可独立回滚；合并后不得丢失任一批的 RED/GREEN 证据。

### Batch 1 · ExecPlan 入库与 draft PR

**最小闭环**：本计划与 `docs/README.md` 索引进入仓库，draft PR 以 main 为 base、关联 #368，无实现代码。
**涉及文件**：`docs/exec-plan/completed/2026-11-24-provider-unbind.md`、`docs/README.md`。
**步骤**
1. 在工作树根确认 `git status --short --branch` 只有这两个文件；人工检查无本机路径、无未决占位、索引链接可达。
2. 提交 `docs(exec-plan): 添加 provider 解绑 ExecPlan 与索引（#368）`，正文写清本计划的范围与链接。
3. `git push -u origin feature/provider-unbind-20261124`（不用 force）。
4. `gh pr create --draft -R SingularityKChen/harness-projects --base main --head feature/provider-unbind-20261124`，标题镜像 issue 英文标题；正文含闭环、Batch 列表、`Closes #368`、初始证据、风险与回滚；按 Lead 决策补 labels（`kind:feat`、`area:core`）、milestone M4.1、assignee。
5. 用 V8 回读；把 PR 编号记录到 Progress（实际 #676，见 Progress Batch 1）。
**验证**：V7（无空白错误）+ V8（draft/base/head/关闭引用符合）；命令见 Validation and Acceptance。
**回滚**：关闭 draft PR，本地 `git revert` 该文档提交；远端分支不删除、不改写。

### Batch 2 · 解绑命令与结构化拒绝

**最小闭环**：`WorkspaceSetup.unbindProviderBinding` 与 controller 命令可用；Development/Delivery 停用且零副作用；planning/execution/形状/缺失按错误表拒绝且零写入。
**涉及文件**：`packages/core/src/workspace-setup.ts`、`packages/core/src/index.ts`、`packages/controller/src/commands.ts`、`tests/integration/workspace-setup-commands.test.js`。
**步骤**
1. RED：在测试文件新增三块 × 两种存储（6 条）：AC1 解绑 Development/Delivery 后行停用、事实保留、`restoreProviders` 不再组合；AC2 同键/账本丢失/已停用的零写入；AC3 planning/execution/形状/缺失的结构化拒绝与零写入。跑 V1，期望 `ℹ tests 34`、`ℹ fail 6`，失败文本含 `TypeError: setup.unbindProviderBinding is not a function`；保留原始输出。
2. core：请求判定（闭集、非空、域政策）、按 `(workspaceId, bindingId, domain)` 从 `listProviderBindings` 查行、已停用早退、启用则 `storageWrite` 单次写 `enabled:false,isDefault:false`；成功值 `{ bindingId }`；拒绝文案固定、不含输入。
3. `core/index.ts` 增加类型再导出；controller 增加 `UnbindProviderBindingInput`、`SetupCommands.unbindProviderBinding`、`createSetupCommands` 的 `replay('unbindProviderBinding', …)`。
4. GREEN：V1 期望 `ℹ tests 34`、`ℹ fail 0`；跑 V3、V4。
5. 逐条核对 M1–M4（可只在本地执行并还原），把结果写入 Progress。
**验证**：V1（期望 `ℹ tests 34`、`ℹ fail 0`）、V3（exit 0）、V4（fail 0）；命令见 Validation and Acceptance。
**回滚**：revert Batch 2 提交；无 schema/数据迁移，命令未接 Host，真实库不受影响。

### Batch 3 · 同目标 revive 与交付默认槽

**最小闭环**：解绑后可显式恢复；不同目标仍 conflict；另一启用 delivery 存在时 revive 不静默抢默认。
**涉及文件**：`packages/core/src/workspace-setup.ts`、`tests/integration/workspace-setup-commands.test.js`。
**步骤**
1. RED：新增 AC4 一块 × 两种存储（2 条）：同目标 revive 原 id、delivery 默认恢复、不新增行/身份；不同目标 conflict；另一启用 delivery 时 conflict。跑 V1，期望 `ℹ tests 36`、`ℹ fail 2`；RED 阶段表现为同一 id 返回但行仍 `enabled=false`（假成功），交付槽竞争在绿色实现后由 M6 判别；保留原始输出。
2. 按 Design 的 revive 规则改 `bindRepository`：只读阶段收集 `revived`、交付槽竞争 `conflict`、不同目标 `conflict`；写阶段单次写 `enabled:true` 与 `isDefault=(delivery)`；已启用同目标保持零写入。
3. GREEN：V1 期望 36/36；V2 期望 21/21（既有绑定路径回归）；V3、V4。
4. 核对 M5–M8。
**验证**：V1（`ℹ tests 36`、`ℹ fail 0`）、V2（`ℹ tests 21`、`ℹ fail 0`）、V3、V4；命令见 Validation and Acceptance。
**回滚**：revert Batch 3 提交；已 revive 的真实行等价于解绑前状态，无迁移。

### Batch 4 · 验收、文档收口与提交整理

**最小闭环**：V1–V9 全部通过；TD-038 一行收口；提交序列可独立审阅；PR 回读后 ready。
**涉及文件**：`docs/exec-plan/tech-debt-tracker.md`、`tests/integration/workspace-setup-commands.test.js`、`docs/exec-plan/completed/2026-11-24-provider-unbind.md`、`docs/review/pr-676-mmp-review.md`、`docs/review/README.md`。
**步骤**
1. 全量跑 V1–V7，把实际输出（测试条数、预算行数、disclosure 结论）写入 Progress 与 Outcomes。
2. TD-038“下一步”格把“解绑写 `enabled = false`（M4.1 的解绑 issue…）”改为“解绑写 enabled=false 已由 #368 提供（仅挂载级；引用级仍属 #387）”，其余原文保留，状态仍 Open。
3. 测试文件头补解绑/revive 一句；把“生产尚无解绑（M4.1）”注释改为“设置命令只有停用；本用例仍用端口级删除制造孤儿锚点”。
4. 整理提交为 Batch 1–4 的可独立审阅序列，无 WIP/fixup/调试；若已推送需改写：先 `git branch "backup/provider-unbind-20261124-$(date +%Y%m%d)" HEAD`，再用精确 old-head `--force-with-lease`。
5. 最终 push 后跑 V8、V9；用 V8 回读到的 `$PR` 执行 `gh pr ready "$PR"`；再次回读当前 head 与 checks，不沿用旧结论。push 与 ready 由 Lead 执行。
6. 独立 agent 对抗验收后的处置（2026-11-24，不改行为）：按 P3 逐条修文档/证据或写明不修理由，补 AC5-368 覆盖「解绑后另一实现」决策表行；新增 `docs/review/pr-676-mmp-review.md` 并在 `docs/review/README.md` §8 登记；回填 Progress/Outcomes 与最终验证输出。
**验证**：V1–V9；命令见 Validation and Acceptance。
**回滚**：revert 文档提交；验证未过则保持 draft 并关闭 PR，不 merge。

## Validation and Acceptance

全部命令在检出 `feature/provider-unbind-20261124` 的工作树根目录 `.worktrees/iteration12-provider-unbind/` 运行；`gh` 命令带 `-R SingularityKChen/harness-projects`。base 以 PR 声明的 main 为准（本计划写作时 `origin/main@c24d1491`）；main 前进时先回读 `git merge-base HEAD origin/main`，再用同一对提交判定。

- **V1 集成命令测试**：`node --test --test-timeout=120000 tests/integration/workspace-setup-commands.test.js` → 期望 `ℹ tests 38`、`ℹ pass 38`、`ℹ fail 0`（基线 28，新增 10：AC1–AC5 × 两种存储；AC5-368 为 2026-11-24 验收处置按 D11 新增）。
- **V2 仓库路由 e2e 回归**：`node --test --test-timeout=120000 tests/e2e/repository-routing.test.js` → 期望 `ℹ tests 21`、`ℹ pass 21`、`ℹ fail 0`（既有绑定路径不受 revive 分支影响）。
- **V3 类型检查**：`pnpm typecheck` → 退出 0、无诊断。
- **V4 依赖边界**：`pnpm run boundaries` → `ℹ fail 0`、退出 0（未新增跨包依赖边）。
- **V5 PR 体量**：`node scripts/rule-checks.mjs size origin/main` → 输出两桶报告（`代码：… / 1000 行`、`文档：… / 1500 行`）；要求代码桶 ≤800、文档桶 ≤1300，退出 0。
- **V6 发布面扫描**：`node scripts/rule-checks.mjs disclosure origin/main` → 输出“机械扫描通过”、无 `::error::` 命中、退出 0；人工五类目另行完成。
- **V7 空白错误**：`git diff --check origin/main...HEAD` → 无输出、退出 0。
- **V8 PR 字段与文件范围回读**：`REPO=SingularityKChen/harness-projects`；`PR=$(gh pr list -R "$REPO" --head feature/provider-unbind-20261124 --json number --jq '.[0].number')`；`gh pr view "$PR" -R "$REPO" --json isDraft,baseRefName,headRefOid,closingIssuesReferences`；`gh pr diff "$PR" -R "$REPO" --name-only`。期望 `baseRefName=main`、`headRefOid` 等于本地 `git rev-parse HEAD`、`closingIssuesReferences` 含 #368、文件名单恰为 Global Constraints 的九项（Batch 1 阶段只有两个文档文件）。
- **V9 必需检查**：`gh pr checks "$PR" -R "$REPO"`（`$PR`/`$REPO` 沿用 V8）→ 含 `PR Fast Gate` 且结论 pass（未结束记录 pending，不把 ready 当通过）。

判定规则：V1、V2、V3、V4、V7 一次不通过即停在对应 Batch；V5、V6 超预算或命中即拆分/修正，不降标准；V8 失败不 push ready；V9 未全绿不宣称通过。

## Progress

- [x] 2026-11-24：三份独立设计与 Lead 决策收敛完成；ExecPlan 文本与 `docs/README.md` 索引行已写入工作树（本次收敛只写这两个文件，未提交）。
- [x] Batch 1：文档提交 `e126058a`（计划 + 索引）；Lead 已 push 并创建 draft PR **#676**（base=main、初始 head `e126058a`），本地实现提交 ahead 4。实现/验收 owner 不执行 gh 写操作。
- [x] Batch 2：命令、错误表、AC1–AC3。V1 RED `ℹ tests 34 / pass 28 / fail 6`（`TypeError ... unbindProviderBinding is not a function`）→ GREEN `ℹ tests 34 / pass 34 / fail 0`；V3 退出 0；V4 `ℹ fail 0`。
- [x] Batch 3：revive 与交付槽、AC4。V1 RED `ℹ tests 36 / pass 34 / fail 2`（同 id 返回但行仍 `enabled=false`）→ GREEN `ℹ tests 36 / pass 36 / fail 0`；V2 `ℹ tests 21 / pass 21 / fail 0`。
- [x] Batch 4：V1–V9、TD-038 收口、PR ready。2026-11-24 本轮在发布头 `ed6ebf824cc1d6d6dcd24eff512e5ad38164d1b7` 回读 V8/V9：main、ready、#368 关闭关联、九项文件与必需检查成功；原“待 push”状态已失效。最终历史整理后的新头仍须再次通过门禁。
- [x] 2026-11-24：独立 agent 对抗验收（只读；报告 `.superpowers/iteration12/368/verification-1.md`，运行态证据不入库）：PASS，无 P0/P1/P2，7 条 P3；处置结论见 `docs/review/pr-676-mmp-review.md`。
- [x] 2026-11-24：验收处置（不改行为）：P3-03/P3-04/P3-05/P3-06/P3-07 修计划与证据；P3-01 补 AC5-368（×2 存储）使 V1 由 36 条变 38 条；P3-02 不补写失败注入测试（理由见 D11）。重跑 V1–V7、M1–M8 全绿（结果见 Outcomes）。
- [x] 2026-11-24（MMP 评审）：已回读上述发布头与全部 checks；Bot 一次完整 APPROVE review `6036566553` 仅一项 P3，当前补齐记录；修复独立复审和最终发布头门禁继续执行。
- 阻塞：无。

## Surprises & Discoveries

以下为设计期只读证据（2026-11-24，在 `feature/provider-unbind-20261124`（`c24d1491`）的工作树根目录实际运行或阅读；不是实现结果）。

- **基线**：V1 命令在 base 上 `ℹ tests 28 / pass 28 / fail 0`；V2 `ℹ tests 21 / pass 21 / fail 0`。新增用例数按 8 条规划，合计 36（2026-11-24 验收处置补 AC5-368 后为 10 条、合计 38，见 D11 与 Outcomes）。
- **RED 预期尚非已运行输出**：新增用例还不存在；代码阅读确认 `WorkspaceSetup` 没有 `unbindProviderBinding` 成员，因此实现前 V1 的新增 6 条应以 `TypeError` 失败。Batch 2/3 完成后用原始输出回填 Progress，不把预期写成证据。
- **假成功**：把 Development 挂载写成 `enabled=false` 后，同请求 `bindRepository` 仍 `ok`、返回同 id、零写入，而行保持停用；现有查找 `workspace-setup.ts:198` 包含停用行，且写阶段没有 revive。故 revive 必须与本 issue 同交付。
- **装配已就绪**：`restoreProviders` 在 `host-providers.ts:333` 跳过停用行，注释 `:319-320` 明说“用户意图，不进 disabled”；“下一次装配不组合”无需改 Host。
- **无恢复路径**：planning 只剩停用时 `workspace-setup.ts:169-171` 拒绝切换；execution 现存 pair 含停用行时 `execution-setup.ts:22` 永久 conflict。故两域用 `not_supported` 而不是允许。
- **AC3 时效**：issue 正文仍写“until #202 lands”，而 #202 已 CLOSED；同 issue 的 2026-10-28 / 2026-10-29 forecast 明确要求保留规划守卫。以 forecast 为新结论，`Closes #368` 依据在 Decision Log。
- **既有注释会过期**：`tests/integration/workspace-setup-commands.test.js` 的绑定仓库拒绝用例用 `removeProviderBinding` 制造孤儿锚点并注明“生产尚无解绑（M4.1）”；Batch 4 需改成“设置命令只有停用，端口级删除仍用于该反例”。
- **引用给 #387 的约束**：停用挂载的引用仍在 `repositoryReferences` 中；#387 若在引用层过滤，必须拆“路由 id 集”与“身份解析 id 集”，否则锚点解析与 `registerRepository` 会断。

以下为实现期实测（Batch 2/3/4，本地提交序列上运行）：

- **Batch 2 RED/GREEN**：V1 从 `ℹ tests 28 / pass 28 / fail 0` 变为 `ℹ tests 34 / pass 28 / fail 6`，6 条失败均为 `TypeError`：AC1/AC2 经 controller 调用时报 `commands.unbindProviderBinding is not a function`，AC3 直接调 core 时报 `setup.unbindProviderBinding is not a function`；实现后 `ℹ tests 34 / pass 34 / fail 0`。根因与预期相同，接收者名不同。
- **Batch 3 RED（假成功复现）**：先写 AC4 后 V1 为 `ℹ tests 36 / pass 34 / fail 2`，失败断言是「停用行翻回启用：交付恢复默认槽，Development 非默认」，actual 显示 `enabled=false`——同 id 返回但行仍停用，与设计期阅读一致；实现 revive 后 36/36。
- **revive 的存储事实**：SQLite `putProviderBinding` 在写启用默认前先把同域其他默认降级（`packages/storage/sqlite/src/storage.ts:53`），交付 revive 写 `isDefault: true` 即可恢复默认槽；停用写必须同时写 `isDefault: false`，否则命中 `CHECK (is_default = 0 OR enabled = 1)`（替身抛普通 `Error`、SQLite 抛约束错误，均非 `RangeError`）。
- **AC1 装配面选择**：只解绑 `development.github` 与 `github-actions` 挂载，避免 local-git 恢复需要 Host 私有 `worktreesDir` 前置（`host-private-data.ts` 要求两层 0700 目录），从而直接观察真实 `restoreProviders`；local-git 的绑定路径仍由 AC1-353 等用例覆盖。
- **变异实况**：`node scripts/review-mutate.mjs .superpowers/mutants-provider-unbind.json --root .` 对 M1–M8 全部 KILLED（SUMMARY 逐条 KILLED、exit 0），施加前后逐字节还原（`packages/core/src/workspace-setup.ts` SHA-256 施加前=还原后=`13aa8bfe…fed57`），跑完 `git status --porcelain` 为空。归因按实际失败名单补全（`killedBy` 只记录最小判别用例，不等于全部红名单）：M1→AC2-368；M2→AC3-368；**M3→AC1-368、AC4-368**（AC4 同样解绑 delivery，命中同一存储拒绝）；M4→AC3-368；M5–M7→AC4-368；M8→AC4-368，另带动 AC4-353、ADR-0015 约束②与绑定仓库拒绝用例（各 2 存储）。
- **变异 spec 自包含**：下列 M1–M8 spec 是本计划内的可复现副本；运行态 `.superpowers/mutants-provider-unbind.json` 按仓库约定不入库（`git check-ignore` 命中 `.gitignore:18`），本轮不新增未声明的文件。复现：把下方 JSON 原样存为工作树内被忽略的路径（例如 `.superpowers/mutants-provider-unbind.json`），在仓库根运行 `node scripts/review-mutate.mjs <该文件> --root .`；脚本先跑基线、逐个施加/还原并逐字节比对，`killedBy` 只作归因下限。锚点是源码行原文，`workspace-setup.ts` 在本轮验收处置中未改，故可在最终 head 直接重放。

```json
{
  "command": [
    "node",
    "--test",
    "--test-timeout=120000",
    "tests/integration/workspace-setup-commands.test.js"
  ],
  "runs": [
    {}
  ],
  "mutants": [
    {
      "id": "M1",
      "file": "packages/core/src/workspace-setup.ts",
      "anchor": "      if (!mount.enabled) return { bindingId }",
      "replacement": "      if (false) return { bindingId }",
      "killedBy": "AC2-368"
    },
    {
      "id": "M2",
      "file": "packages/core/src/workspace-setup.ts",
      "anchor": "      if (!UNBINDABLE_DOMAINS.includes(domain)) refuse(ProjectErrorCode.NotSupported, '规划与执行挂载不能解绑：没有恢复路径')",
      "replacement": "      if (false) refuse(ProjectErrorCode.NotSupported, '规划与执行挂载不能解绑：没有恢复路径')",
      "killedBy": "AC3-368"
    },
    {
      "id": "M3",
      "file": "packages/core/src/workspace-setup.ts",
      "anchor": "      await storageWrite(() => tx.putProviderBinding({ ...mount, enabled: false, isDefault: false }))",
      "replacement": "      await storageWrite(() => tx.putProviderBinding({ ...mount, enabled: false, isDefault: mount.isDefault }))",
      "killedBy": "AC1-368"
    },
    {
      "id": "M4",
      "file": "packages/core/src/workspace-setup.ts",
      "anchor": "      assertClosed(request, UNBIND_FIELDS)",
      "replacement": "      void request",
      "killedBy": "AC3-368"
    },
    {
      "id": "M5",
      "file": "packages/core/src/workspace-setup.ts",
      "anchor": "            revived.push(existing)",
      "replacement": "            void existing",
      "killedBy": "AC4-368"
    },
    {
      "id": "M6",
      "file": "packages/core/src/workspace-setup.ts",
      "anchor": "            if (reference.domain === CapabilityDomain.Delivery && mounts.some((mount) => mount.domain === CapabilityDomain.Delivery && mount.enabled)) refuse(ProjectErrorCode.Conflict, '工作区已有启用的交付来源：不替换')\n            revived.push(existing)",
      "replacement": "            revived.push(existing)",
      "killedBy": "AC4-368"
    },
    {
      "id": "M7",
      "file": "packages/core/src/workspace-setup.ts",
      "anchor": "      for (const mount of revived) await storageWrite(() => tx.putProviderBinding({ ...mount, enabled: true, isDefault: mount.domain === CapabilityDomain.Delivery }))",
      "replacement": "      for (const mount of revived) await writeMount(tx, { id: newProviderBindingId(), workspaceId: mount.workspaceId, domain: mount.domain, enabled: true, isDefault: mount.domain === CapabilityDomain.Delivery }, await readMountTarget(tx, mount))",
      "killedBy": "AC4-368"
    },
    {
      "id": "M8",
      "file": "packages/core/src/workspace-setup.ts",
      "anchor": "          if (!sameMountTarget(await readMountTarget(tx, existing), target)) refuse(ProjectErrorCode.Conflict, '仓库在该实现下已有引用而目标不同：本版本不改绑')",
      "replacement": "          if (false) refuse(ProjectErrorCode.Conflict, '仓库在该实现下已有引用而目标不同：本版本不改绑')",
      "killedBy": "AC4-368"
    }
  ]
}
```

以下为验收处置轮（2026-11-24，独立 agent 对抗验收后）：

- **独立验收结论**：只读重跑 V1–V7 与 M1–M8 与本计划声明一致，另 20 组计划外反例 A–J（memory/sqlite 各一遍）全部通过；无 P0/P1/P2，7 条 P3（测试覆盖 2 条，证据精度/自包含/时效 3 条，过程一致性 2 条）。报告是运行态证据（`.superpowers/iteration12/368/verification-1.md`，未入库）；结论摘录与逐条处置见 `docs/review/pr-676-mmp-review.md`。
- **P3-01/P3-02 的行为证据边界**：两者描述的行为（解绑后另一实现=既有新建路径；写失败整笔回滚）已由独立验收反例 F/I 与 A/J 手工证明，但未进 committed suite。本轮只把 P3-01 固化为 AC5-368（成本 24 行测试、不改既有断言），使决策表“另一实现”行有回归保护；P3-02 不新增写失败注入测试（理由见 D11）。
- **P3-04 的关闭方式**：实现期提交统一 `Refs #368`，与计划原“末提交 `Closes #368`”不符；issue 关闭由 PR #676 描述正文的 `Closes #368` 承担（`closingIssuesReferences` 已解析），故订正计划措辞而不是改写已推送历史（D12）。
- **处置不改变验收结论**：本轮只新增一条测试与文档/证据，未改 `workspace-setup.ts` / `commands.ts` / `core/index.ts`；V1 计数 36→38，V2–V7 与 M1–M8 结论不变。

## Decision Log

| # | 决策 | Rationale | 日期 / 作者 |
|---|---|---|---|
| D1 | 交付 disable-not-delete + 同目标 revive；revive 归本 issue，引用级解绑/改绑归 #387 | 保留账号/配置/身份/锚点；避免不可恢复单向门；ADR-0015 的“解绑与改绑”按**引用级**语义承接 #387，挂载级停用由 #368 交付 | 2026-11-24 / Lead |
| D2 | 仅 core + controller，无 Host wire/UI | #127/#353 先例；本轮无消费者；AC1 可用真实 `restoreProviders` 证明，不必扩 ABI | 2026-11-24 / Lead |
| D3 | planning 与 execution 一律 `not_supported` | 两域均无恢复路径；#202 已关闭但 issue 后续 forecast 要求保留规划守卫，原“until #202 lands”被该 forecast supersede | 2026-11-24 / Lead |
| D4 | 请求为 `{ workspaceId, bindingId, domain }`，域政策先于行查找；`storage`/未知域归 `invalid_input` | 与 Storage 自然键及 `removeProviderBinding` 的 ref 三键一致；显式域避免跨域误操作；`storage` 不是可挂载外部域，属形状错误 | 2026-11-24 / 收敛评审 |
| D5 | 错误码只用 `invalid_input` / `not_found` / `not_supported`；unbind 不产生 `conflict`；成功值 `{ bindingId }`、controller 报 `local_only` | 与现有设置命令一致；无外部写入，不能报权威 Saved | 2026-11-24 / Lead |
| D6 | 自然键幂等：已停用即零写入；不做持久 receipt | 行就是回执；receipt 会成为第二权威源（#127 D2） | 2026-11-24 / Lead |
| D7 | 8 条新集成用例（4 块 × 2 存储） | 拒绝表用表驱动覆盖；避免逐域、逐字段摊薄；预算与判别力平衡（验收处置按 D11 增至 10 条） | 2026-11-24 / 收敛评审 |
| D8 | revive 的 delivery 恢复 `isDefault=true`；先查另一启用 delivery | 交付读取按默认槽（TD-074）；不替换规则沿用 `workspace-setup.ts:204-205` | 2026-11-24 / Lead |
| D9 | 不为 pending `mutation_attempt` 加拒绝守卫 | 恢复路径存在：同目标 revive 后绑定 id 与引用仍可用；记为 R1 残余风险 | 2026-11-24 / Lead |
| D10 | 不关闭 TD-077；TD-038 只更新一行并保持 Open | 引用级能力本 PR 不交付，避免把未完成债务标成关闭 | 2026-11-24 / Lead |
| D11 | P3-01 补 AC5-368（×2 存储）；P3-02 不补写失败注入测试 | P3-01 描述的是决策表“解绑后另一实现”行，属既有新建路径，回归不会让 committed suite 变红；一条 24 行用例即可封住，且不改既有断言。P3-02 的失效模式已由既有 `writeSpy(storage, failing)` 原子性模式（#376）与独立验收反例 A/J 手工覆盖（写失败整笔回滚、快照不变、重试成功）；再加注入会重复绑定路径的原子性断言，扩大测试面而非判别面，故不修并在本表、Outcomes 与评审记录写明理由 | 2026-11-24 / 验收负责人 |
| D12 | 提交统一 `Refs #368`；issue 关闭由 PR 描述正文 `Closes #368` 承担，订正计划原“末提交 `Closes #368`” | 已推送的 Batch 1 文档提交 `e126058a` 不得 amend；PR #676 body 已含 `Closes #368` 且 `closingIssuesReferences` 已解析到 #368，关闭机制不依赖提交 trailer。计划自述与执行不一致属文档事实错误，按实际关闭机制订正，不为措辞改写历史或产生 WIP | 2026-11-24 / 验收负责人 |
| D13 | 新增 `docs/review/pr-676-mmp-review.md` 并在 `docs/review/README.md` §8 登记；文件集只加这两项 | 独立 agent 对抗验收的 P0–P3 矩阵、逐条处置证据与残余风险需要长期可查（`docs/review/README.md` §8 判据：删掉后接手者会缺决策依据）；记录明确“非人类评审、非 R1/UAT、非平台资格”，避免被误读为合并授权。不扩生产代码、不新增未声明的仓库文件 | 2026-11-24 / 验收负责人 |
| D14 | 变异 spec（M1–M8）内联进本计划的 Surprises 段；运行态副本仍不入库 | P3-06：原计划只写“用 `scripts/review-mutate.mjs`”，spec 却在被忽略的 `.superpowers/` 下，第三方按仓库内容无法重建这批变异。内联使仓库自包含（AGENTS §3：运行态内容不入库、但证据可带执行上下文路径）；不新增 `scripts/` 文件，避免扩大 PR 文件集 | 2026-11-24 / 验收负责人 |

## Idempotence and Recovery

- 重复解绑已停用挂载：零写入成功；同键由 controller 账本重放；账本丢失后按自然键重判——仍停用则零写入，已被 revive 则视为新状态再停用（既有设置命令同一口径）。
- 同目标已启用重绑：零写入返回原 id；停用行 revive 只写一次。
- 误停用恢复：同一仓库、同实现、同目标重跑 `bindRepository`。delivery 若已被另一仓库占用默认槽，先解绑当前 delivery 再 revive；否则 `conflict` 是“不替换”的诚实拒绝。
- 事务失败：所有判定在写前，`putProviderBinding` 失败整笔回滚；一行都不留半状态。
- **R1（残余风险）**：被停用 Development 挂载持有 pending `mutation_attempt`（在途 PR / Start Work）时，恢复要求原 `bindingId` 仍启用（`create-change-request.ts` 的 route 校验、`start-work.ts:172`）；解绑后对应恢复变 `blocked`，直到同目标 revive。本 PR 不加“存在在途意图即拒绝”的守卫，按 Lead 决策记录，不扩大命令面。
- **R2**：解绑 delivery 后其他仓库可占用默认槽；revive 旧交付来源会 `conflict`，恢复路径是先解绑当前来源。**R3**：并发解绑与重绑各自事务串行，末写者定 `enabled`，无跨命令锁；调用方以重读为准。
- **R4**：`development-route.ts:86,89` 与 ADR-0015 Consequences 的“不能解绑/改绑、conflict 是终态”文案在本 PR 后仍成立（产品无 Host/UI 入口）；将来 wire 时必须同步修订，并把 `unbindProviderBinding` 加入 `host-composition.ts` 的 setup allowlist（当前名单见 `:444`）。

## Interfaces and Dependencies

- 运行环境：Node `>=22`（本机 v26.13.1）、pnpm 10.28.2；无新增 npm 依赖；V1/V2 全部离线，临时目录 SQLite 与录制 fetch 夹具。
- 仓库工具：`gh`（已认证，PR 读写与 checks 回读）、`git`（argv/库 API）、必需检查 `PR Fast Gate`；分支 base=main，人类伙伴决定合并。
- 命名契约：命令 `unbindProviderBinding`；core 请求 `UnbindProviderBindingRequest`；controller 输入 `UnbindProviderBindingInput`；错误码 `invalid_input` / `not_found` / `not_supported`；成功值 `{ bindingId }`。这些名字进入 controller API，按公共接口对待，不在本 PR 改名。

## Outcomes & Retrospective

Batch 2–4 已在本地完成；2026-11-24 独立 agent 对抗验收后完成处置（见 Decision Log D11–D14）。V8/V9 与 push/ready 由 Lead 在 push 后执行 **Superseded by 本节「本轮 MMP 评审」（2026-11-24）**——本节点不把远端 checks、PR ready 或人类评审写成通过。以下为处置后最终树的实际命令输出（判定对象 `origin/main`；本轮实测 `c24d1491`，main 前进时先回读 `git merge-base HEAD origin/main`，再以同一对提交判定）。

- **V1**：`ℹ tests 38 / pass 38 / fail 0`（历史：28 基线 → RED 34/6 → GREEN 34/0 → AC4 RED 36/2 → GREEN 36/0 → 验收处置补 AC5-368 后 38/38）。
- **V2**：`ℹ tests 21 / pass 21 / fail 0`。
- **V3**：`pnpm typecheck` 退出 0，无诊断。
- **V4**：`pnpm run boundaries` → `ℹ tests 10 / pass 10 / fail 0`，退出 0。
- **V5**（处置后最终 head）：`代码：216 / 1000 行`、`文档：420 / 1500 行`（增删之和），退出 0；均低于计划上限 800/1300 与仓库硬上限 1000/1500。
- **V6**（同上）：`机械扫描通过`，无 `::error::` 命中，退出 0；人工五类目另行完成。
- **V7**：`git diff --check origin/main...HEAD` 无输出，退出 0。
- **M1–M8**（处置后复跑）：`SUMMARY` 逐条 KILLED、exit 0；`packages/core/src/workspace-setup.ts` SHA-256 施加前=还原后=`13aa8bfe…fed57`，跑完 `git status --porcelain` 为空。另把本计划内联的 spec 原样提取为 `.superpowers/mutants-inline-extracted.json` 后复跑一遍，同样 8/8 KILLED（P3-06 的自包含副本可直接执行）。归因见 Surprises。
- **规模**：技术 `216`（增删之和：实现 192 + AC5-368 覆盖新增行）；文档 `420`（含本计划、评审记录与索引）；未为凑行数扩写。
- **处置范围**：只新增 AC5-368（测试）与文档/证据；`packages/**` 生产代码、`apps/**`、Storage schema/迁移与依赖零改动，文件集合仍为 Global Constraints 声明的九项。
- **偏差**：① Batch 2 RED 的 `TypeError` 接收者名分 controller / core 两种（见 Surprises）；② AC1 用 `development.github` 而非 local-git 挂载做装配观察（见 Surprises）；③ Batch 1 的 push/draft PR 与 V8/V9 归 Lead，本 owner 只提交本地分支；④ 独立验收 P3-01 使 V1 由 36 变 38（新增 AC5-368 ×2 存储），P3-02 不补测试（理由见 D11 与评审记录）；⑤ PR 远端 head 仍是 Batch 1 文档提交 `e126058a`，最终 head 以 push 后 `gh pr view --json headRefOid` 回读为准。**Superseded by 本节「本轮 MMP 评审」（2026-11-24）**，此处仅保留实现期观察。
- **证据边界（非 root）**：V1–V7、M1–M8 由验收负责人在隔离工作树 `.worktrees/iteration12-provider-unbind`（非 root 主检出、未 push）复跑；独立验收报告 `.superpowers/iteration12/368/verification-1.md` 是运行态证据（未入库）。这些是工程/agent 证据，不等于人类评审、R1/UAT、平台资格或安装验收。
- **残余风险**：R1 被停用 Development 挂载上的在途 `mutation_attempt` 在 revive 前恢复为 `blocked`；R2 交付默认槽被占用时 revive 先 `conflict`，需先解绑当前来源；R3 并发解绑/重绑无跨命令锁，以重读为准；R4 产品层无 Host/UI 入口，将来接 wire 时须同步文档与 setup allowlist。

### 本轮 MMP 评审（2026-11-24）

首审版本 `ed6ebf824cc1d6d6dcd24eff512e5ad38164d1b7` / `main@c24d1491`：V1 38/38、V2 21/21；计划内联 M1–M8 独立重跑全部 KILLED，逐字节还原；第二视角在 memory/sqlite 验证“先 revive、后续新挂载配置失败”两组反例 2/2，整笔回滚、完整快照不变、重试原 id 恢复。当前发布 PR ready、九项路径、Closes #368；PR Fast Gate/Verify/Browser/Windows 成功，唯一 FAILURE 是非必需评审端点 HTTP 404。Reconcile 被取消项有成功后继。此前“未 push / V8/V9 待执行 / 七项”不能作为现况；P3 已在原处订正或标 superseded。新头发布后重新读取 head/base/checks/threads 与双向 issue 关联，独立批准后才合并。

用户直接指定本会话负责 #674–#677 的后续修复、独立复评、归档、提交整理、issue 核对、rebase 合并及相关分支/worktree 清理；该授权明确覆盖本 PR，不授权 Planning Status 或依赖关系修改。既有 Completed 计划保留，原子性、身份、默认槽语义与产品/测试字节均不变。#387、#155 与 R1 不因 #368 技术关闭自动接受。

## Bottom Change Note

- 2026-11-24：创建。由三份独立设计与 Lead 决策收敛为单一 ExecPlan；定义文件集、四批次、验证命令与 supersede 依据。此为本计划首次修改。
- 2026-11-24：Batch 2–4 收口。回填 RED/GREEN、变异 M1–M8 与 V1–V7 实际输出；TD-038 一行更新、测试文件头与过时注释同步停用语义；push/draft PR 与 V8/V9 留给 Lead。
- 2026-11-24：独立 agent 对抗验收后处置。P3-01 补 AC5-368（×2 存储，V1 36→38）；P3-02 不补写失败注入测试并写明理由；P3-03 补全 M3 归因；P3-04 订正 issue 关闭方式（PR body `Closes #368`、提交 `Refs #368`）；P3-05 记录 PR #676；P3-06 把变异 spec 内联进计划；P3-07 把易失 HEAD/base 改成设计期观察+回读命令。新增 `docs/review/pr-676-mmp-review.md` 与 `docs/review/README.md` 索引行（D13），复跑 V1–V7、M1–M8 并回填 Outcomes。此轮不改生产代码，未 push。

- 2026-11-24：独立对抗验收与验收处置完成，计划归档到 docs/exec-plan/completed/，索引由 Active 迁到 Completed。

- 2026-11-24：本轮 MMP 首审后修正 V8 九项路径与 Batch4/远端观察时效，在原处标失效历史，补齐当前发布头门禁与直接授权；生产与测试未改。
