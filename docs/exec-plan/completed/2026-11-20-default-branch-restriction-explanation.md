# 默认分支关闭限制提交前说明 ExecPlan

> 状态：Completed（工程实现与 #580 工程验收归档；PR 尚未声明合并）
> 创建：2026-11-20
> 范围：`Closes #580`；`Refs #556`；仅创建 PR 表单的静态说明、两条判别测试与文档索引
> 规范：`PLANS.md`、`AGENTS.md`、`docs/development/workflow.md`
> 执行上下文：分支 `fix/default-branch-restriction-explanation`，工作树 `.worktrees/default-branch-restriction-explanation`，基线 `33fcde29`（2026-11-20 检出于该 worktree 的 `git rev-parse --short HEAD`）

## Purpose / Big Picture

用户在默认分支上选择"合并时关闭"时，能在提交前、紧邻 `Closes owner/repo#N` 预览看到一条规则说明：GitHub 只在 PR 目标分支为仓库默认分支时于合并后关闭所选 Issue。说明同时通过 `aria-describedby` 关联关系下拉框，辅助技术聚焦控件时可读到。

世界的最小可观察变化：合法默认分支的 eligible 表单多出一段精确文案；非默认分支下该文案不存在，既有 `reason` 说明、禁用选项与禁用提交按钮不变，"`Closes owner/repo#N`" 预览逐字节不变。判定证据是组件测试与生产组合浏览器测试先红后绿，且浏览器测试的 `prCreates` 保持 0（无真实 PR、无模型调用）。

## Context and Orientation

#580 是 #556 验收时发现的展示遗漏：Core 已经强制默认分支限制，但 eligible 默认分支预览没有任何解释；非默认分支才通过 `reason` 解释。#580 要求保留 reference 默认、显式 closing/none 选择、精确目标/正文预览与非默认分支强制，只补提交前说明。当前仓库未发布，不存在迁移或兼容负担。

已核对的现有事实（路径均为仓库相对路径；行号是 2026-11-20 在基线上的观察，实施前用 `grep -n` 重定位）：

- `packages/core/src/change-request-issue-link.ts:11` 定义 `ChangeRequestIssueOptions { target?, targetStamp?, defaultRelation, relations, reason? }`，没有 eligibility 字段。
- 同一文件 `:48`：`relations` 恰在 `scope.base === repo.value.defaultBranch` 时为 `['reference','closing','none']`，否则为 `['reference','none']` 且带 `reason: '合并关闭仅适用于仓库默认分支'`。`:49` 的同一 `reason` 字段还承载来源/仓库不可验证错误，因此它是失败字符串，不是限制事实。
- `packages/client/src/create-change-request.ts:69-74` 严格解码：未知键在 `:27` 被拒绝，任何非 `none` relation 都要求 `target` 与 `targetStamp`（`:73`）。因此 `relations.includes('closing')` 是 Core 派生、Client 保证目标存在的唯一 eligibility 信号。
- `packages/ui/src/create-change-request-section.ts:40` 计算 `issueRelation`；`:103` 渲染关系 `select`；`:104` 的预览 `<p>` 输出 `Closes/Refs owner/repo#N`，仅当 `options.reason` 存在时追加 `；${reason}`。`packages/ui/src` 中 `defaultBranch` 出现 0 次，UI 没有默认分支事实。
- `tests/contract/ui-create-change-request.test.js:48-59` 提供 `componentHarness`；`:170-185` 是现有 eligible 选项手写 Promise 风格：eligible 断言 `Refs example/project#545`，非 eligible 断言 reason 与 `relations`。
- `tests/browser/workspace-execution.test.js:223-236` 的 `preselected Draft preserves native browser Issue choice ${relation}` 循环已在生产组合 Host/UI 上运行 `reference/closing/none` 三种选择；夹具 `tests/fixtures/composed-execution-platform.mjs:32,35` 提供 `issueTarget` 开关与合成 Issue 目标，仓库默认分支 `main` 来自 `tests/fixtures/github-development-create.mjs:59`。

## Design / Spec

**选定方案：仅 UI 的 copy-only 静态说明（Variant A）**。产品改动只在 `packages/ui/src/create-change-request-section.ts`，契约、Core、Client、Host、capabilities 全部不动。

三处改动（形状即实现约束）：

1. `:40` 的 `issueRelation` 之后新增：
   ```ts
   const issueRestriction = options !== undefined && options.target !== undefined && options.relations.includes('closing')
   const restrictionId = `create-change-request-issue-restriction-${encodeURIComponent(scope.repositoryId)}`
   ```
2. `:103` 的 `select` props 中、`disabled` 之后新增 `'aria-describedby': issueRestriction ? restrictionId : undefined`，其中 `restrictionId` 按 `scope.repositoryId` 编码生成。
3. `:104` 的预览 `<p>` 之后新增独立兄弟段落：
   ```ts
   issueRestriction ? h('p', { id: restrictionId }, '“合并时关闭”仅在 PR 目标分支为仓库默认分支时生效：GitHub 会在合并后关闭所选 Issue。') : null,
   ```

规则：文案恰为上面一句（全文、含中文引号），不加 `role`/`aria-live`，不新增 CSS 或 class，不把句子拼进预览段落；eligible 状态下无论当前选中哪个 relation 都显示该说明（选择前即可解释规则）；非 eligible 状态不渲染该段落也不加 `aria-describedby`，既有 `；${reason}`、禁用 `closing` 选项与提交守卫保持不变。

选择理由（第一性原理）：

1. **eligibility 已由 Core 单点拥有。** `relations` 就是 `base === 已回证 defaultBranch` 的布尔表达式结果；UI 再比较 `fields.base` 与分支名会制造第二权威，而 UI 根本没有默认分支事实。
2. **这是不变量规则，不是请求数据。** 句子对所有仓库、所有 Host 相同，无 provider 差异、无本地化；把它放上 wire 会让 Core 拥有 UI 文案，却没有会变化的触发条件。
3. **契约变更成本被严格解码器放大。** Client 拒绝未知键，新增字段必须 Core/Client 同步、新增一致性不变量与负测、改 5–6 个夹具/测试文件，却产生与一段静态文本完全相同的行为；#580 明确要求这是有边界的展示修正。
4. **UI 已有静态 GitHub 文案先例**（设置/仓库绑定界面），没有 i18n 层，保持单层拥有。
5. **不改精确片段。** 独立段落让 `Closes owner/repo#N` 逐字节不变，既有测试的 exact-text 定位器不受影响；`aria-describedby` 让规则在聚焦下拉框时可读，静态帮助不需要 live region。
6. **不用 `reason` 的缺席推断 eligibility。** `reason` 同时是失败字符串；只有 `relations` 是限制事实。

被放弃的方案：

- **B2 结构化契约**（`closing: { eligible, explanation }` 或 `restriction` 复制字段）：它把推论从一个字段搬到另一个字段，却新增第二 eligibility 权威、解码器不一致不变量、Core 拥有 UI 文案与跨包协调；无第二消费者、无 provider 多样性、本地化也未出现，没有可证伪的收益。若未来限制变成 provider/仓库相关，再采用 typed code（如 `default_branch_required`）+ Host 文案，而不是 boolean/散文。
- **仅在选中 `closing` 后显示**：违反"在选择之前解释规则"的验收语义，并引入随选择变化的动态区域；若设计评审坚持，只需在 const 上加 `&& issueRelation === 'closing'` 并移动断言。
- **把句子追加到 `Closes owner/repo#N` 预览段落**：破坏精确目标/正文预览与既有 exact-text 浏览器定位器。
- **UI 读取仓库默认分支自行比较**：UI 无此事实，且形成第二权威。

## Global Constraints

原实现 owner 文件集与本次获准收尾的文档集如下；除列出的文件外不改其他文件：

- 产品：`packages/ui/src/create-change-request-section.ts`
- 测试：`tests/contract/ui-create-change-request.test.js`、`tests/browser/workspace-execution.test.js`
- 文档：`docs/exec-plan/completed/2026-11-20-default-branch-restriction-explanation.md`（本文件）、`docs/README.md` 的 Completed 表一行、`docs/review/pr-669-mmp-review.md`（MMP 评审记录）

硬约束：

- 不改 Core/Client/capabilities/Host 契约，不新增 wire 字段，不修改 `ChangeRequestIssueOptions` 任一实现；不改 `reason` 文案；不改 reference 默认、`none` 处理、禁用选项与提交守卫。
- 不新增 `role="status"`、live region、CSS/class、i18n、legacy/兼容层或迁移（仓库未发布）。
- 不创建真实 PR、不联网、不启动模型；浏览器证据只使用合成夹具，必须断言 `h.platform.prCreates === 0`。
- 文案恰好是 Design 中的一句；组件测试与浏览器测试各自用该精确字符串做判别断言，这是 #580 的产品验收文本，不是行为散文锁。
- 代码/测试 changelog 预算：产品 +6/−1，测试约 +75–90，远低于 800；文档以 `docs/README.md` 一行加本计划为限（<1300）。文档正文中文，代码标识符/命令英文。
- 原规划切片不实现、不提交产品/测试代码；实现者按批次先红后绿，最终由人类决定合并，agent 不自行 merge、不改 Planning Status/blocking 关系。Superseded by Decision Log 中 2026-11-21 用户针对 #667–#669 的直接条件授权：#669 无 P0/P1 时 root 可执行修复/独立复评/归档/整合/验收核对后按 rebase merge；Planning Status 仍不变。代码/测试 owner 文件集见本节，当前只改上述三份文档。

## Plan of Work

### Batch 1 · 红测与判别边界（仅测试）

**最小闭环**：用现存组件与生产组合浏览器路径证明 eligible 说明缺失、非默认分支仍按既有方式禁止与解释，测试在未改产品源码时失败。

**涉及文件**：`tests/contract/ui-create-change-request.test.js`、`tests/browser/workspace-execution.test.js`

步骤：

1. 组件测试新增 `test('eligible default-branch closing explains the restriction beside exact clause and nondefault base still enforces', ...)`，放在现有 `:170` 的 eligible 测试之后。使用 `componentHarness` 与手写 options Promise（同 `:170` 风格）：
   - 首次 resolve `{ defaultRelation: 'reference', relations: ['reference','closing','none'], target: { repositoryName: 'example/project', number: 545 }, targetStamp: 'target-1' }`。断言：存在 `id === 'create-change-request-issue-restriction-repo'` 的段落且文本等于 Design 中的精确句；该段落无 `role`/`aria-live`；关系 `select` 的 `aria-describedby` 等于该 id；预览文本精确为 `Refs example/project#545`（无 `；` 后缀）。
   - 触发 `select.props.onChange({ target: { value: 'closing' } })` 后断言预览精确为 `Closes example/project#545`；提交后 `submitted.issueRelation === 'closing'` 且 `submitted.issueTargetStamp === 'target-1'`。
   - 把 base 输入改为 `release`，resolve 第二次 options `{ defaultRelation: 'reference', relations: ['reference','none'], target: { repositoryName: 'example/project', number: 545 }, reason: '合并关闭仅适用于仓库默认分支' }`。断言：说明段落不存在；`closing` option 的 `disabled === true`；预览含 `；合并关闭仅适用于仓库默认分支`；提交按钮 `disabled === true`；调用表单 `onSubmit` 后 create 调用计数仍为 0。
2. 浏览器测试文件顶部新增常量 `const ISSUE_RESTRICTION = '“合并时关闭”仅在 PR 目标分支为仓库默认分支时生效：GitHub 会在合并后关闭所选 Issue。'`；在 `:223` 循环里 `Title` 填完之后、`selectOption` 之前加两行：等待 `page.getByText(ISSUE_RESTRICTION, { exact: true }).waitFor()`，并断言 `await select.getAttribute('aria-describedby') === 'create-change-request-issue-restriction-local-repository'`。该循环天然覆盖三种 relation 的 always-visible 说明。
3. 在循环之后新增 `test('nondefault base removes the eligible restriction and keeps closing enforcement', { timeout: 60000 }, ...)`：`h.platform.flags.issueTarget = true`；`start(page)`，填标题，填 base `main`；等待说明与 `Closes example/project#545`（选择 `closing` 后）；断言创建按钮 `isDisabled() === false`；把 base 改为 `release`；等待精确文本 `Closes example/project#545；合并关闭仅适用于仓库默认分支`；断言 `option[value="closing"]` 计算 `disabled === true`、说明 `count() === 0`、创建按钮 `isDisabled() === true`、`h.platform.prCreates === 0`。

**验证**（在检出 `fix/default-branch-restriction-explanation` 的工作树根运行；需要时先 `pnpm exec playwright install chromium`）：

```sh
pnpm test:file tests/contract/ui-create-change-request.test.js
pnpm test:file tests/browser/workspace-execution.test.js
```

期望：两条命令 exit 1。组件命令新增用例失败，断言消息指出缺少 `create-change-request-issue-restriction`/精确句（`# fail 1`，其余 pass）；浏览器命令由新增说明等待超时造成 `# fail 4`（循环 3 个 relation + 非默认分支用例），其余场景 pass。若浏览器因缺少 chromium 启动失败，先安装浏览器再重跑；不得把启动失败当作红测证据。把失败断言原文记录到 `.superpowers/` 的执行证据（仅作运行态引用）。

**回滚**：只撤销上述两个测试文件的未提交改动（例如 `git restore --source=HEAD -- tests/contract/ui-create-change-request.test.js tests/browser/workspace-execution.test.js`）；产品行为未变，无需其他恢复。

### Batch 2 · UI 静态说明与绿灯

**最小闭环**：三处 UI 改动让 Batch 1 的精确断言全绿，既有行为与精确片段不变。

**涉及文件**：`packages/ui/src/create-change-request-section.ts`

步骤：按 Design / Spec 的三处改动实现；不添加 helper 导出、共享常量或新组件；保持 `；${reason}`、`disabled: busy || !options`、提交 `disabled` 条件与 `loadOptions` 逻辑原样。

**验证**（同一工作树根运行）：

```sh
pnpm test:file tests/contract/ui-create-change-request.test.js
pnpm test:file tests/browser/workspace-execution.test.js
pnpm run typecheck
pnpm test:file tests/integration/create-change-request-link-recovery.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/create-change-request.test.js
node scripts/rule-checks.mjs size origin/main
node scripts/rule-checks.mjs disclosure origin/main
node scripts/workflow-check.mjs
git diff --check origin/main...HEAD
```

期望：前两条命令 exit 0 且 `# fail 0`（组件与浏览器全部 pass）；`typecheck` exit 0；三个集成文件 exit 0（Core 默认分支强制与 `Closes` 文本未变）；size 与 disclosure 首行打印判定对象后 exit 0；workflow-check exit 0；`git diff --check` 无输出。`origin/main` 是 PR 声明 base 的本地别名；若 PR base 不同，用其不可变 SHA 替换，并以 `git rev-parse` 回读为准。

发布前只运行一次完整门：

```sh
pnpm verify
```

期望：exit 0（typecheck + contract/integration/e2e 全层通过）。若出现与本改动无关的既有失败，如实记录为未验证项，不修改无关代码，也不声称通过。

**回滚**：撤销 `packages/ui/src/create-change-request-section.ts` 的三处改动即回到 Batch 1 的红状态，测试保留为失败判别。

**PR 回滚**：本 PR 仅产品 UI 文件、两个测试文件、本计划与 `docs/README.md` 一行；未合并时关闭 PR 并删除分支（人类操作），已合并时按仓库流程 revert 合并提交。无数据、契约、权限或持久化迁移，无需回填或清理。

### Batch 3 · 评审、验收证据与计划归档

**最小闭环**：按用户对 #667–#669 的直接条件授权完成 #669 首轮评审、核对 #580 工程验收证据，并把实现计划和评审记录归档；不把 PR 合并或 R1 当成本计划完成条件。
**涉及文件**：本节 `Global Constraints` 声明的三份文档。

1. 依据独立矩阵复核无 P0/P1 后，由 root 负责修复/复评（如有）、归档计划、整合交付提交、核对 Issue 验收，再按 `merge_method=rebase` 处理 #669；规划 Status 保持不变。本轮 #669 首轮 APPROVE 已提交（review `6002157434`），本次只整理文件，不进行外部写入。
2. 记录组件 33/33 与 root 串行浏览器 22/22 证据、两个定向变异的替换与归因；Issue 三项均是工程验收，#556 已关闭，安装态人工验收与 R1 另计。
3. 将本计划由 `active/` 移至 `completed/`，更新 `docs/README.md` 对应索引；评审结论放入本 PR 的 MMP 记录。

**验证**：在该分支工作树根执行 `git diff --check`、`node scripts/workflow-check.mjs`，并检查 `docs/README.md` 链接指向 `completed/` 且 `docs/exec-plan/active/` 不再含本计划。PR 最终提交整合后，按 `gh -R SingularityKChen/harness-projects pr view 669 --json baseRefName,headRefOid,mergeable,mergeStateStatus,isDraft,closingIssuesReferences`、`gh -R SingularityKChen/harness-projects pr checks 669`、reviews/comments API 动态回读当前 head 与门禁；期望值以执行时远端回读为准，不复用历史 head/checks。
**回滚点**：三份文档变更可独立恢复到归档前路径与内容，不涉及产品、测试、Issue 或 PR 外部状态。

## Validation and Acceptance

| #580 验收项 | 判定证据 |
|---|---|
| eligible 默认分支 closing 选择在提交前、紧邻选择目标/片段显示限制说明 | 组件测试精确断言说明段落存在、文本等于 Design 句、与 `select` 的 `aria-describedby` 绑定；浏览器循环在三种 relation 下等待同一精确文本；均在提交前断言 |
| 非默认分支仍禁用/拒绝 closing 并解释原因；reference 与不关联按既有已验选项保持 | 组件测试断言说明消失、`closing` option 禁用、`；reason` 可见、提交按钮禁用、create 计数 0；浏览器测试断言同样状态与 `prCreates === 0`，未点击提交 |
| 组件/浏览器检查区分 eligible 说明与 ineligible 强制，且不创建真实 PR、不启动模型 | 两条命令先红后绿；浏览器使用合成夹具、断言 `prCreates === 0`；组件使用 fake creator；无网络/模型调用 |
| 保留 reference 默认、显式选择、精确目标/正文预览与非默认分支强制 | `Refs example/project#545` 与 `Closes example/project#545` 精确断言；Core/Client/契约零改动；三个集成回归通过 |
| 文档索引可发现 | `docs/README.md` Completed 表包含本计划，链接指向 `exec-plan/completed/2026-11-20-default-branch-restriction-explanation.md`；既有相对链接格式不变 |

上述验收是 #580 的工程验收，证据为组件与生产组合浏览器测试；用户已授权 root 核对并勾选对应 Issue 条目。#556 已关闭。安装态人工验收与 R1 发布门禁另计，不作为 #580 闭环门。

## Progress

- [x] Batch 1 红测：组件与浏览器测试先失败并记录断言原文
- [x] Batch 2 UI 三处改动完成
- [x] Batch 1/2 绿测：两条聚焦命令、typecheck、三个集成回归 exit 0
- [x] 规模/披露/workflow/diff-check 与完整 `pnpm verify` 通过
- [x] (2026-11-20 22:04 SGT) 独立对抗验收 P3：说明段落 id 增加 `scope.repositoryId` 后缀，避免同一工作项渲染多个 `DeliveryLineageSection` 时产生重复 DOM id；组件 33/33、浏览器 22/22 重跑通过。
- [x] (2026-11-20 22:11 SGT) PR #669 回读：head `e257b20a7ff8e6669f834ffd82b100d9c17e9dd0`、base `main` @ `33fcde29`；`closingIssuesReferences` = [580]；`PR Fast Gate` / Verify / Browser / Windows Native 全 pass（`Reconcile engineering state` 为 cancelled 的非必需并发取消，不是失败）。
- [x] (2026-11-21) 首轮 MMP 评审无 P0/P1，root 已提交 APPROVE（review `6002157434`）。
- [x] (2026-11-21) 组件聚焦测试 33/33；root 在无变异并行时串行执行 `pnpm test:file tests/browser/workspace-execution.test.js`，22/22 pass、0 fail/skip，197962 ms。
- [x] (2026-11-21) 两项变异均由新增组件测试击中；PR/Issue 验收证据已核对；Batch 3 文档归档完成。评审和本地证据不代表 PR 已合并或最终整合 head 检查已完成。

Evidence（2026-11-20 SGT；基线 `f9561bdd` 上执行，运行态日志在 `.superpowers/sdd/2026-11-20-default-branch-restriction-explanation/`，不进文档）：

- 红：`pnpm test:file tests/contract/ui-create-change-request.test.js` exit 1，`tests 33 / pass 32 / fail 1`；失败断言原文 `AssertionError [ERR_ASSERTION]: eligible default base must explain the closing restriction beside the preview`（actual `undefined`，expected 精确句）。
- 红：`pnpm test:file tests/browser/workspace-execution.test.js` exit 1，`tests 22 / pass 18 / fail 4`；失败为 `preselected Draft preserves native browser Issue choice reference|closing|none` 与 `nondefault base removes the eligible restriction and keeps closing enforcement`，均为等待精确说明文本超时（约 7.7s），与计划预期一致。
- 绿：组件命令 exit 0（33/33）；浏览器命令 exit 0（22/22）；`pnpm run typecheck` exit 0；三个集成文件 exit 0（84/84）。
- 规模/披露：在测试+UI 提交 `92eddf04` 上 `node scripts/rule-checks.mjs size origin/main` exit 0（代码 61/1000 行、文档 212/1500 行；本计划 Progress 编辑后的最终 HEAD 复核仍 exit 0，文档增量远低于上限）；`disclosure origin/main` exit 0；`node scripts/workflow-check.mjs` exit 0（7 个文件无 finding）；`git diff --check origin/main...HEAD` 无输出。
- 完整门：`pnpm verify` exit 0（typecheck + contract 1617/1617 pass，integration 2294 pass / 28 skipped / 0 fail，e2e 226/226 pass）。

## Surprises & Discoveries

- 提案 B2 的"最小 diff"与 a.md 不等价：它省略了 `target` 防御合取与 `aria-describedby` 绑定，并低估浏览器侧需要区分的非默认分支场景。本计划采用 a.md 的三处形状，并把条件写成显式 `options !== undefined`（不依赖可选链收窄）——仍只 +6/−1 行。
- `reason` 在 `packages/core/src/change-request-issue-link.ts:49` 同时承载"来源或仓库不可验证"的失败字符串，因此"没有 reason"不能证明 closing eligible；唯一安全信号是 `relations.includes('closing')` 与 Client 保证的 `target`。
- 现有浏览器循环已在生产组合路径运行三种 relation，无需新夹具或新浏览器启动模式；红跑预期是 3 个循环超时加 1 个新场景超时。
- 实际红跑与预期逐项一致（组件 1 fail / 浏览器 4 fail），说明判别边界落在缺失的说明文案而非状态推进或定位器错误；Chromium 1248 已缓存并匹配 Playwright 1.64.1，浏览器证据走真实生产组合路径，未安装/降级依赖。
- 实际产品 diff 是 +4/−1（计划预估 +6/−1）：三处形状落地后仅新增 const 与注释、`aria-describedby` 属性、独立段落各一处，预算仍远低于上限。
- `docs/README.md` 的 Active 表行在基线提交 `f9561bdd` 已存在，本任务未再修改该文件，避免重复行或空提交。
- 独立对抗验收发现（2026-11-20）：说明段落的静态 DOM id 若固定，会在同一工作项映射多个仓库的 `DeliveryLineageSection` 时重复；`aria-describedby` 可能解析到另一个表单的说明。已改为带 `scope.repositoryId` 后缀的 id，并以组件与浏览器测试各一条断言固定；这是可访问性边界问题，不是 #580 的验收前提。
- 2026-11-21：#580 原三项 acceptance 均是工程验收；组件 33/33 与 root 无变异并行的串行浏览器 22/22 构成对应证据。安装态人工验收与 R1 是独立门禁，不应误标为 #580 checklist 的前置条件。

## Decision Log

- Decision：选择 copy-only UI 说明（Variant A），拒绝 B2 结构化契约。
  Rationale：`relations` 已是 Core 单点的 eligibility 事实；该句是不变的 GitHub 语义而非请求数据；严格 Client 解码器使新增字段成为跨包协调、第二权威和不一致不变量，却没有 provider/本地化变化可触发收益；#580 明确是有边界的展示修正。
  Date/Author：2026-11-20 SGT / plan-580（独立 spec/plan reviewer）

- Decision：eligible 状态下始终显示说明，而不是仅在选中 `closing` 后显示。
  Rationale：验收要求"选择前/提交前"解释规则；静态描述稳定、不引入动态区域竞态，并覆盖 eligible closing 预览。设计评审若要求 selection-scoped，仅需在 const 上加 `&& issueRelation === 'closing'` 并移动断言。
  Date/Author：2026-11-20 SGT / plan-580

- Decision：说明作为预览段落之后的独立 `<p>`，通过 `aria-describedby` 关联关系下拉框，不拼进 `Closes` 段落、不加 live region。
  Rationale：保持精确目标/正文片段与既有 exact-text 定位器；静态帮助不需要异步公告；组件当前不注入 CSS，纯文本与现有风格一致。
  Date/Author：2026-11-20 SGT / plan-580

- Decision：condition 保留 `options !== undefined && options.target !== undefined` 防御合取。
  Rationale：Client 解码器已保证非 `none` relation 必有 `target`，但显式检查避免未来/说谎 Host 在无可见目标时渲染"关闭所选 Issue"，且不引入分支比较；类型上也不依赖可选链收窄。
  Date/Author：2026-11-20 SGT / plan-580

- Decision：说明段落 id 采用 `create-change-request-issue-restriction-${encodeURIComponent(scope.repositoryId)}`，`aria-describedby` 引用同一 id。
  Rationale：同一工作项可映射多个仓库并各自渲染创建表单；固定 id 会制造重复 DOM id，使辅助技术可能读到另一个表单的说明。
  Date/Author：2026-11-20 22:04 SGT / lead（依据 adv-580 P3）

- Decision：不改 Core 的 `reason` 文案、不改任何契约或夹具；UI 文案与 Core reason 是不同状态下的不同句子，各自在所属层被断言。
  Rationale：两个字符串服务于不同状态（eligible 规则说明 vs ineligible 失败原因），共享常量需要跨层依赖或契约变更；保持单层拥有并分别锁定期望文本。
  Date/Author：2026-11-20 SGT / plan-580

- Decision：实现按 Design 三处形状落地，测试不新增 class/test-id 或定位器夹具；组件测试以“唯一数组 children 的 `<p>`”识别精确预览，浏览器在既有三种 relation 循环内等待说明并断言 `aria-describedby`。
  Rationale：说明段落在 eligible 三种 relation 下均渲染，循环天然覆盖 always-visible 语义；复用 `scene`/`start` 与合成夹具，避免为文案新增浏览器启动模式或产品标记。
  Date/Author：2026-11-20 SGT / impl-580

- Decision：`docs/README.md` 的 Active 行不重复修改；该行已由计划提交 `f9561bdd` 引入并指向本文件。
  Rationale：本任务写集中的文档行已存在，重复编辑只会制造空 diff；索引可发现性用 `git show f9561bdd` 回读验证。
  Date/Author：2026-11-20 SGT / impl-580

- Decision：用户直接授权对点名的 #667–#669 按条件收尾：无 P0/P1 时由 root 负责必要修复与独立复评、归档计划、整合单个交付提交、核对 Issue acceptance 后以 `merge_method=rebase` 合并；规划 Status 保持不变。
  Rationale：这是本会话中用户对三个指定 PR 的直接授权；不等同于用户逐行审阅代码，也不授权缺陷未解决时继续合并。本轮 #669 无 P0/P1，首轮 APPROVE 已由 root 提交；root 仍负责最终整合复评和当前 head 门禁回读。
  Date/Author：2026-11-21 / 用户授权（由 root 转录）

- Decision：把三项 #580 acceptance 按工程行为验收处理，允许 root 依据本计划与组件/浏览器结果核对并勾选；#556 已关闭。安装态人工验收与 R1 另计。
  Rationale：#580 的三项标准分别描述 UI 可见说明、非默认分支强制和组件/浏览器区分测试，没有另列人类验收条件；Issue checklist 更新权限已由用户授予 root。
  Date/Author：2026-11-21 / 用户授权（由 root 转录）

- Decision：归档计划表示实现与工程验收范围完成，不表示 PR 已合并或最终整合 head checks 已通过；整合后使用远端回读命令动态锁定 base/head/checks/review threads。
  Rationale：head 与 checks 易变，必须以合并前当前状态为准，不复用本计划里的历史 SHA 或旧检查结果。
  Date/Author：2026-11-21 / root

## Idempotence and Recovery

- UI 三处改动是纯渲染分支，重复运行、重复渲染、改变 relation 选择均为幂等；每个创建表单以 `scope.repositoryId` 生成对应说明 id，多个仓库表单各自引用本仓库说明，无副作用。
- 所有验证命令可重复执行；浏览器每个场景自建临时目录/浏览器上下文并清理，不共享状态；红绿证据写入 `.superpowers/` 运行态目录，不进正式文档。
- 红测失败必须保留原断言输出与失败阶段；若失败原因不是"缺少说明"，先修正测试（例如定位器/状态推进错误），不得直接改产品源码凑绿。
- 实现失败时只撤销本 owner 文件集的未提交改动；已记录的红测可重跑。失败恢复后回到"基线 + 红测"或"基线"两种已知状态之一，不保留半改的产品文件。
- PR 已推送后如发现错误：保留 recovery ref，按仓库精确 lease 规则整理；不在本计划内自行 force-push 或合并；合并后回滚见 Batch 2 的 PR 回滚。

## Interfaces and Dependencies

- **契约不变**：`ChangeRequestIssueOptions`（`packages/core/src/change-request-issue-link.ts` 与 `packages/client/src/create-change-request.ts`）零改动；UI 只消费现有 `relations`/`target`/`reason`/`defaultRelation`。
- **依赖**：仓库 Node >=22、pnpm 10.28.2、React（组件测试通过 `componentHarness` 使用 React 内部 dispatcher）、Playwright 1.64.1 + Chromium（组合浏览器）、SQLite（浏览器夹具的 Host 持久化）。命令均在上述分支工作树根运行；未使用凭据、未联网、未启动模型。
- **上游输入**：issue `#580`（`gh issue view 580`，公开仓库 `SingularityKChen/harness-projects`）、父项 `#556`；仓库内规范 `PLANS.md`、`AGENTS.md`、`docs/development/workflow.md`。本计划不引用本机绝对路径或内部系统。
- **文档索引**：`docs/README.md` §2 Completed 表包含本计划，链接使用仓库相对路径 `exec-plan/completed/2026-11-20-default-branch-restriction-explanation.md`。

## Outcomes & Retrospective

实施与本地验证已完成（2026-11-20 SGT，分支 `fix/default-branch-restriction-explanation`）：改动一个 UI 模块与两个测试文件，全部在实现写集内；红/绿命令、失败原文、规模与完整 `pnpm verify` 证据见 Progress。首轮 MMP review `6002157434` 为 APPROVE，组件 33/33、root 串行浏览器 22/22；#580 三项工程验收证据齐备，#556 已关闭。该计划记录实现与工程验收已完成；PR 尚未在本记录中声明合并，最终整合提交后的动态 head/checks 仍由 root 回读。安装态人工验收和 R1 发布门禁独立保留。

本计划没有证明实际 GitHub 合并后自动关闭 Issue 的远端语义，也没有把安装态人工验收或 R1 发布门禁并入 #580；这两项均属独立责任。PR 首轮 checks 与 review 已核对；整合交付后的当前 head/base/checks/review threads 必须由 root 使用 Batch 3 的回读命令重新核验，不能沿用旧 head 证据。计划归档表示工程范围完成，不表示 PR 已合并。

## Bottom Change Note

- 2026-11-20 SGT：创建计划。依据 #580、a.md/b2.md 提案与基线 `33fcde29` 的源码核对，选定 copy-only UI 说明；记录契约事实、两条测试红绿命令、回滚路径与驳回 B2 的理由。
- 2026-11-20 SGT：Batch 1 红测与 Batch 2 实现完成；红跑失败与预期一致（组件 1 fail、浏览器 4 fail），绿跑与 `pnpm verify` exit 0。提交：`e5d4b8f0`（测试）、`92eddf04`（UI）。证据与未验证项见 Progress 与 Outcomes。
- 2026-11-21：按用户对 #667–#669 的直接条件授权记录评审与验收收尾；纳入 root 串行浏览器 22/22、首轮 APPROVE、#580 工程验收与 #556 关闭事实，更新最终实际设计、文档写集及动态 head 回读门槛，并归档本计划。未声称 PR 已合并或最终整合 head checks 通过。

- 2026-11-21 10:38 SGT：按最终独立复评 P3 删除已过期 LOC 台账，保留稳定文件范围与行为验收；规模以当前提交的 rule-checks 回读为准，产品与测试未变。
