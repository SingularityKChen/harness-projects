# Worktree Root Outside Checkout ExecPlan

> 状态：Completed（2026-10-14 归档，随 PR #328 收尾）
> 创建：2026-10-13
> 范围：完成 issue #214：将默认 worktree 落点定义为 checkout 外的 provider-owned/host-injected absolute target，删除旧 info/exclude 补偿，并提供旧根迁移说明。
> 上游输入：AGENTS.md、PLANS.md、issue #214、docs/exec-plan/active/2026-09-24-local-git-worktree.md、packages/core/src/git-provisioning.ts、packages/providers/development-local-git/src/provider.ts。

## Purpose / Big Picture

完成后，默认 Start Work 不再把相对 .worktrees/slug 当作本机路径；Local Git provider 在 checkout 外派生 canonical worktree root，或消费宿主注入的绝对 target。上游提交的 .worktrees 符号链接不能决定写入位置，provider 不再写 info/exclude 作为旧根补偿；旧 worktree 不自动迁移，按 `Idempotence and Recovery`「旧默认工作树的手工移除」手工移除或移到新默认根。最小成功证据是：默认工作树位于独立 checkout 外，checkout 与 provider 解析出的 git-common-dir/info/exclude 字节不变，invalid target 在 branch mutation 之前被拒绝，已持久化句柄在重放时不被新默认覆盖。

## Context and Orientation

当前 packages/core/src/git-provisioning.ts 的 worktreePathFor/namesFor 只知道 work item/repository identity，不能安全拼出本地 sibling path；core 也不依赖 node:path/fs。packages/providers/development-local-git/src/paths.ts 明确拒绝 .. 分量，因而不能把 ../foo.worktrees/slug 作为隐式绕过。provider 当前默认 allowedRoot 为 checkout/.worktrees，并在 createWorktree 前写 git-common-dir/info/exclude；chain-facts.ts 在未观察到真实工作树时还会传播旧的 .worktrees skeleton path。

独立设计结论是：#214 需要显式“默认根意图”契约，而不是 provider-only 偷改相对字符串。core 传 path 可选与稳定 worktreeKey；显式 absolute target 仍逐字传递，省略 path 时由 Local Git provider 依据 repository canonical path 派生 checkout 外 root。#132 后续可让 host 注入 canonical target/allowedRoot，但不在本 PR 组合 host。provisionGit 先建 branch 再建 worktree，因此 target/allowedRoot 预检必须在 branch mutation 前完成，或保留并明确既有失败账本。

## Design / Spec

- 扩展 Development provider createWorktree input：path 可选，worktreeKey 必填；ProviderWorktree.path 仍是 provider 返回的 canonical absolute handle。
- core namesFor 不再生成 .worktrees/slug 本机路径；省略显式 worktreePath 时只传稳定 worktreeKey，显式 absolute path 逐字传入，并在 ensureBranch 之前完成 provider target preflight。
- Local Git provider 在 path 缺省时，以 repository canonical path 的 parent 和 repository-specific derived root 组合外部 target；显式 allowedRoot/absolute target 优先。所有 target/root 仍经过 realpath、不存在尾部、..、控制字符和 symlink safety checks。
- 删除只服务于 checkout 内默认根的 DEFAULT_ROOT_EXCLUDE/excludeDefaultRoot writer；保留通用 path safety、写后回读、显式旧根兼容和 provider argv-only。
- chain-facts 对未观察到的工作树只传播稳定 key/中性 pending handle，不把旧 .worktrees 字符串当已知本机路径；已观察的 worktreeExternalId 是权威，不被新默认静默改写。
- 旧 root 不自动迁移、不删除；文档说明 git worktree list --porcelain、显式注入旧 allowedRoot、人工 git worktree move 与回读。回滚不清理旧 info/exclude。Superseded by `Idempotence and Recovery`「旧默认工作树的手工移除」（2026-10-14）：显式注入旧 allowedRoot 只是 provider 构造参数，当前没有宿主传入它（#132），不是用户可走的路径；交付的是手工移除（主路径）与可选的 `git worktree move` 到新默认根。

## Global Constraints

- PR 使用 Closes #214，代码≤800行、文档≤1300行。
- 这是默认行为变更，PR ready/merge 前需要人类批准；agent 不改 Status、blocked-by、blocking、不合并。
- 不修改 #132 host composition、#304 lease/claim/settle、#138 destructive removeWorktree。
- Git 使用 argv/library API；路径拒绝必须发生在任何 branch/worktree Git write 之前。
- TDD 先写 core intent/provider default/symlink/info-exclude/legacy-replay red tests，再实现。
- 若实现需要新的 public path allocator port，必须在本计划 Decision Log 明确而不能用 provider-specific 隐式语义替代。

## Plan of Work

### Batch 1 · Intent and preflight red tests

最小闭环：证明旧 core 会把相对 .worktrees/slug 传给 provider，且 invalid target 会先建 branch。

涉及文件：packages/core/src/git-provisioning.ts 相关 integration tests、packages/capabilities/src/development-provider.ts、tests/integration/local-git-core-provisioning.test.js。

- 加测试：默认请求 path 缺省、worktreeKey 稳定；显式 absolute path 保持；target invalid 时 branch/write 调用计数为零。
- 加重启/旧句柄测试：已有 worktreeExternalId 回读不被新默认重算。
- 观察旧实现红灯，失败原因必须是 input shape、路径归属或 branch residue。

验证命令：
node --test tests/integration/local-git-core-provisioning.test.js tests/integration/local-git-start-work-resume.test.js
期望：新增 intent/preflight 测试在未实现时失败，现有 Start Work 契约可定位。

回滚：删除 red tests。

### Batch 2 · Core/provider explicit default intent

最小闭环：core 传稳定 key 与可选 path；Local Git provider 派生 checkout 外 canonical target，显式 root 优先。

涉及文件：packages/capabilities/src/development-provider.ts、packages/core/src/git-provisioning.ts、packages/providers/development-local-git/src/provider.ts、packages/providers/fake/src/development.ts。

- 为 provider input 增加 path optional/worktreeKey；更新 fake 与 contract fixtures。
- Local Git 在 path 缺省时根据 canonical repository path 派生外部 root，显式 path/allowedRoot 走既有 guard。
- 在 ensureBranch 前执行 target preflight，避免 outside_root/invalid input 留下孤立 branch。
- 维持分支、worktree 回读和幂等 reuse 语义。

验证命令：
node --test tests/integration/development-local-git.test.js tests/integration/local-git-core-provisioning.test.js
node_modules/.bin/tsc --noEmit
期望：默认 target checkout 外，显式 target 兼容，invalid target 不产生 branch/worktree。

回滚：反向 input/core/provider/fake commits。

### Batch 3 · Remove compensation and update facts/docs

最小闭环：新默认不写 info/exclude，未观察 skeleton 不传播旧假路径，旧用户有手动迁移说明。

涉及文件：packages/providers/development-local-git/src/provider.ts、packages/core/src/chain-facts.ts、provider/core tests、docs/exec-plan/active/2026-09-24-local-git-worktree.md、相关用户文档。

- 删除 excludeDefaultRoot 及仅服务于 checkout 内根的 fixture，加入 git-common-dir/info/exclude before/after byte/hash assertion。
- 更新旧 plan 原处 Superseded 注记，不删除历史证据。
- 写迁移说明：列出旧 worktrees、选择显式 old root、人工 git worktree move、失败回滚；不自动删除。Superseded by `Idempotence and Recovery`「旧默认工作树的手工移除」（2026-10-14）：不含「选择显式 old root」，理由同 Design / Spec 末条。
- 保持 explicit legacy path 与 persisted handle 可读。Superseded by Decision Log 2026-10-14「旧默认工作树只给手工移除说明」（2026-10-14）：默认配置下旧句柄答 `invalid_input`，只有显式注入旧 `allowedRoot` 的实例可读。

验证命令：
node --test tests/contract/development-local-git-source.test.js tests/integration/development-local-git.test.js tests/integration/local-git-start-work-resume.test.js
pnpm verify
期望：无默认 info/exclude 变化，existing path safety 与 legacy replay 全绿。

回滚：反向 provider/facts/docs commit；旧 worktrees 仍由用户控制。

### Batch 4 · Adversarial mutation and release gate

最小闭环：证明新默认与旧 symlink guard、preflight、legacy replay 各自不可删除，完成 draft PR 回读。

涉及文件：tests、ExecPlan、docs README index。

- mutation：恢复 .worktrees/slug、恢复 checkout 内 root、恢复 exclude writer、删除 worktreeKey/path distinction、删除 preflight、重算旧句柄；每个都应被对应测试杀死。首轮没有留下可复核的 spec；2026-10-14 的整表（含每条 killedBy）见 Progress「第二轮评审修复的变异整表」。
- 跑 focused、verify、boundaries、workflow、disclosure、size、diff-check。
- 创建 draft PR，回读 #214 native linkage 与 Project ExecPlan/Batch/Priority/Size/Iteration；默认行为批准前保持 draft。

验证命令：
pnpm verify
pnpm run boundaries
node scripts/workflow-check.mjs
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
期望：全部 exit 0；target、branch、worktree、info/exclude 和 legacy replay evidence 可复现。

回滚：PR 未合并时反向提交；不自动迁移/删除用户工作树。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | default outside checkout | canonical target 在独立 checkout 外；位于另一 Git 检出之内（外层 `.git` 须是 Git 认得的标记）、bare 与缺席的仓库目录 fail closed，结论不缓存：`tests/integration/development-local-git.test.js`「默认根只认独立检出…」，变异 D1–D9 KILLED |
| 2 | no info/exclude write | provider 解析的 git-common-dir/info/exclude 字节不变 |
| 3 | tracked symlink | .worktrees symlink 不能改变目标；显式注入检出内旧根时链接仍被拒：`tests/integration/development-local-git.test.js`「显式注入检出内的旧允许根…」，变异 M11 KILLED |
| 4 | preflight ordering | invalid target 不创建 branch/worktree |
| 5 | explicit allowedRoot/path | 注入旧 root 与显式 target 仍受安全守卫 |
| 6 | legacy replay | 已持久化 worktreeExternalId 不被新默认覆盖：`tests/integration/local-git-core-provisioning.test.js`「已持久化的工作树句柄与新默认不同…」（M6）；落盘后 ack 丢失的 conflict 读回与 ambiguous 对账都用 canonical target（M10、M9） |
| 7 | identity/facts | 未观察 skeleton 不传播旧假本机路径：`tests/integration/local-git-core-provisioning.test.js`「未观察的工作树骨架只带稳定 key…」（M7） |
| 8 | release/size | code≤800/docs≤1300，门禁全绿，默认变更仍待人类批准 |
| 9 | issue linkage | PR 与 #214 native references/Project fields 回读一致 |
| 10 | #214 验收 4：旧默认工作树的处理 | `Idempotence and Recovery`「旧默认工作树的手工移除」的逐条命令与临时仓库实测记录；人类 2026-09-29 批准所附条件（写明如何手工移除）由该节承担 |
| 11 | port contract | 预检与创建同键、零写入、外来仓库 not_found、预检目标被 createWorktree 原样接受并可读回：`tests/contract/suites/development.js`「工作树预检按 worktree.create 判定…」在 Fake 与 Local Git 各能力形态上通过，变异 MC1–MC5 KILLED |

## Progress

- [x] 2026-10-14：第二轮修复的增量复评（head `d9c6cf62`，APPROVE，P3 × 1）处置，主控（本会话 owner）续派：旧 provider 写的 `/.worktrees/` 锚定在检出根，子目录配置下从未隐藏 `<sub>/.worktrees/`，原第 5 步按 `"$OLD"` 判断能否删这一行、第 6 步按第 1 步的 `BEFORE` 期望 `same`，两处都与子目录配置不符。已修：开头「留着无害」限定为检出根配置并写明子目录配置的现状；第 5 步先 `rmdir`，再只在 `"$TOP/.worktrees"` 不存在时删 exclude 行（命令自带判断）；`BEFORE` 挪到第 5 步开头；第 6 步按是否保留 exclude 行给期望。抽取命令逐字实跑四种夹具 × 两种 shell，记录在本计划手工移除一节末尾。已开始工作项的出路转跟进 #341（Decision Log）。
- [x] 2026-10-14：#328 修复的独立复评（head `a7740743`，无 P0 / P1，P2 × 3、P3 × 4）处置，主控（本会话 owner）在同一工作树续派：
  - P2 嵌套判定过宽、消息误标 submodule：已修，外层 `.git` 按 Git 口径校验，消息点名外层检出与 #132；主控裁定保留 fail closed 方向，见 Decision Log「嵌套判定按 Git 口径收紧」。
  - P3 只缓存成功仍固化首次结论（目录已存在、尚未 `git init`）：已修，默认根不再缓存，同一用例的 `grownAfter` 一格先 RED 后 GREEN。
  - P2 手工移除第 1 步按位置选工作树：已修，按 `refs/heads/work/` 与旧 `repository.path` 的 realpath 筛选，覆盖子目录配置，提醒不要动人建的工作树。
  - P2「移动后复用」对已开始的工作项不成立：已改为事实描述（三种情形都停在 Ready + `result_unknown`，没有产品内恢复路径，转跟进 #341），与 base 的差异记入 Surprises。
  - P3 含已初始化 submodule 的工作树移除：已补（单个 `--force`，不能 `move`）。
  - P3 第 6 步行尾注释：已改为只留命令，期望写在块外，`BEFORE` 在第 1 步记录。Superseded by 下一条增量复评条目（2026-10-14）：`BEFORE` 改在第 5 步开头记录。
  - P3 Batch 3「persisted handle 可读」：已就地标注 Superseded。
  - 符号链接检出的跟进编号回填为 #340。
  - 变异整表在复评修复后的代码树上重跑一次，见下文。推送与 PR 描述改写仍未执行。
- [x] 2026-10-14：第二轮 MMP 评审（head `910312ae`，REQUEST_CHANGES：P1 × 1、P2 × 4、inline P3 × 4、PR 级 P3 × 4）修复完成本地部分。owner：人类伙伴在评审会话里被问「四个 PR 的修复与收尾由谁负责？」，回答「本会话负责（推荐）」，由该会话指派修复实施者在 `.worktrees/docs/worktree-root-plan` 上执行；恢复锚点 `backup/pr328-before-review-fix-20261014`。逐条处置（均先判定属实）：
  - P1 #214 验收 4 与人类批准条件（手工移除说明）：已修，见 `Idempotence and Recovery`「旧默认工作树的手工移除」与验收表第 10 行；不可达的「显式旧根 / 旧计划手册」表述就地标注 Superseded。
  - P2 默认根在 submodule / 嵌套仓库下落进外层检出：已修，见 Decision Log「默认根只给独立检出派生」与 Surprises 2026-10-14；同根因的 P3「默认根缓存固化错误根」一并修复（缺席仓库答 `unavailable`、不借用、不缓存）。
  - P2 持久化句柄重放、conflict 读回、ambiguous 读回无判别回归：已修，采纳评审变体 V1–V3 为 `tests/integration/local-git-core-provisioning.test.js` 的三条正式用例。
  - P2 `preflightWorktree` 不在共享契约套件：已修，见 Decision Log 预检契约条。
  - P2 验收 7 无断言：已修，`tests/integration/local-git-core-provisioning.test.js`「未观察的工作树骨架只带稳定 key…」。
  - P3 TD-005 描述过时：已修，`docs/exec-plan/tech-debt-tracker.md` 手工编辑并记录重跑的加载实验。
  - P3 被推翻方案未就地标注、易失数值、章节顺序：已修。
  - P3 符号链接检出的 realpath 不可达与两种消息：转跟进 #340，理由见 Decision Log。
  - PR 级 P3 路由失败丢 `attemptedValue`：已修，`tests/integration/local-git-core-provisioning.test.js`「路由失败的报告保留工作树尝试值…」先 RED（`undefined`）后 GREEN。
  - PR 级 P3 #214 Scope 第 3 条：判定不改文字，理由见 Decision Log。
  - PR 级 P3 bare / 无 `.git` 标记布局 fail closed 未成文：已写入 Decision Log「默认根只给独立检出派生」。
  - PR 级 P3 `910312ae` 提交正文只写「做了什么」：属实；本轮各提交正文写为什么，整合提交时再统一改写，此处不记为已完成。
  - 自查新增：最终整表变异发现 M11（删 `paths.ts` 的 `symlinked_root` 判定）存活，base 上同一用例同样拦不住，见 Surprises 2026-10-14；已修。
  - 推送、thread 回复、PR 描述改写与 issue 写入都未执行，留给主控。

### 第二轮评审修复的变异整表（2026-10-14）

复评修复之后在检出 `docs/worktree-root-plan` 的工作树根目录、代码树 `e2bb7ad6` 上用 `scripts/review-mutate.mjs` 跑一次（spec 形状见该脚本文件头；锚点在所在文件中唯一，`killedBy` 为用例名片段）。命令：`node --test --test-timeout=120000 tests/integration/development-local-git.test.js tests/integration/local-git-core-provisioning.test.js tests/integration/local-git-start-work-resume.test.js tests/contract/development-contract.test.js tests/contract/development-local-git-source.test.js`。基线与还原后基线均绿，26 个变异全部 KILLED 且归因正确（脚本退出 0）。

| id | 文件 | 变异 | killedBy |
|---|---|---|---|
| M1 | `packages/core/src/git-provisioning.ts` | 恢复预检用 `intent` 而非已决定分支 | 恢复预检必须使用已持久化的分支身份 |
| M2 | 同上 | `canonicalPath = names.path` | 预检返回的 canonical target 必须原样传给 createWorktree |
| M3 | 同上 | 预检失败不返回 | core 在目标预检失败时不得先创建孤立分支 |
| M4 | `packages/providers/development-local-git/src/provider.ts` | 默认根改回 `<checkout>/.worktrees` | 默认工作树根在 checkout 外 |
| M5 | 同上 | 跳过向上找 `.git` 的循环 | 默认根按真实 checkout 根派生 |
| M6 | `git-provisioning.ts` | 重放不采用已持久化句柄 | 已持久化的工作树句柄与新默认不同 |
| M7 | `packages/core/src/chain-facts.ts` | 骨架槽位恢复 `.worktrees/<key>` | 未观察的工作树骨架只带稳定 key |
| M8 | `provider.ts` | `worktree add` 前恢复写 `info/exclude` | info/exclude |
| M9 | `git-provisioning.ts` | ambiguous 对账读回去掉 `target` | create 结果不确定时，对账读回的也是预检返回的 canonical target |
| M10 | 同上 | conflict 读回去掉 `target` | 工作树已落盘但 ack 丢失 |
| M11 | `packages/providers/development-local-git/src/paths.ts` | 删除 `symlinked_root` 拒绝 | 显式注入检出内的旧允许根 |
| D1 | `provider.ts` | 删除嵌套检出判定 | 默认根只认独立检出 |
| D2 | 同上 | 删除 bare 判定 | 默认根只认独立检出 |
| D3 | 同上 | 仓库目录缺席时退回 `path.resolve` 并向上找 | 默认根只认独立检出 |
| D4 | 同上 | 恢复「只缓存派生成功的根」 | 默认根只认独立检出 |
| D5 | 同上 | 任何名为 `.git` 的东西都算标记 | 默认根只认独立检出 |
| D6 | 同上 | 不校验 gitfile 是否以 `gitdir:` 开头 | 默认根只认独立检出 |
| D7 | 同上 | 不校验 `.git` 目录是否像 Git 目录 | 默认根只认独立检出 |
| D8 | 同上 | 不认 gitfile 标记 | 默认根只认独立检出 |
| D9 | 同上 | 拒绝消息改回断言 submodule | 默认根只认独立检出 |
| R1 | `git-provisioning.ts` | 路由失败用 `beginWrite(names.path)` | 路由失败的报告保留工作树尝试值 |
| MC1 | `packages/providers/fake/src/development.ts` | 预检删能力门 | 工作树预检按 worktree.create 判定 |
| MC2 | 同上 | 预检删仓库身份门 | 外来 binding 的仓库引用被拒绝 |
| MC3 | 同上 | 预检偷偷写一份工作树 | 不写任何对象 |
| MC4 | `provider.ts` | 预检返回目标的父目录 | 默认意图的预检目标被 createWorktree 原样接受 |
| MC5 | 同上 | 预检删能力门 | 工作树预检按 worktree.create 判定 |

- [x] 2026-10-14：正式评审前整合为计划与实现两个提交；独立检查和仓库消费者搜索确认 `worktreePathFor` 只剩定义，删除仍返回旧 checkout-relative 默认路径的失效导出，回滚锚点为 `backup/pr328-before-final-integration-20261014`。
- [x] 2026-10-13：两份独立设计与总审阅完成；修订为“默认根意图 + provider 派生”而非 core 拼接 ../ 路径。
- [x] 2026-10-13：Batch 1–3 最小闭环实现；原三条红测先稳定复现，再随实现转绿。
- [x] 2026-10-13：Batch 4 本地验收完成：`pnpm verify`（含 MVP0）、`boundaries`、workflow/disclosure/size/diff-check 全部退出 0；用例计数与行数是易失值，按 Batch 4 的命令在当前 head 重算。PR 未创建，本任务不执行 push/GitHub 写入。
- [x] 2026-10-13：PR #328 独立复审 P1 修复：新增恢复分支敏感预检与 canonical target 传递的真实 Local Git 回归；先观察 2 条红测，再以最小 core 修复转绿；focused、恢复与 provider 相关测试、TypeScript 检查和 diff-check 全部通过。
- [x] 2026-10-13：PR #328 第二轮独立复评发现并修复默认根边界：`repository.path` 指向 checkout 子目录时，原实现按子目录字符串派生 sibling root，实际仍落在 checkout 内；新增真实 Local Git RED/GREEN 回归，修复为按 Git 真实 checkout 根派生默认 root。
- [x] 2026-10-13：第二轮复评补充确认 nested invalid target 的零 Git argv 约束；默认 root 改为纯 filesystem ancestor `.git` marker 查找，找不到 marker 直接 fail closed；`allowedRoot` 字段收窄为显式 host-injected root，避免暴露过时的默认派生值。
- [x] 2026-10-13：独立复评 P2 文档收口：`tests/integration/README.md` 的默认允许根条目已对齐 checkout 外 sibling root、默认不写 `info/exclude`、显式 legacy `allowedRoot` 语义。

### P1 修复证据（2026-10-13）

原为文末的「P1 Repair Evidence (2026-10-13)」一节，为符合 `PLANS.md` §3 的章节顺序移到这里；各轮当时的用例计数是易失值，已省略，按 Batch 2–4 的命令在当前 head 重算。

- `tests/integration/local-git-core-provisioning.test.js` 新增两条判别性测试：分支敏感 provider 在恢复重放时必须收到已持久化分支；provider 预检返回的 canonical target 必须逐字进入 `createWorktree`，最终句柄和磁盘工作树也必须落在该 target。
- RED：修复前 focused 套件两条失败，分别失败于恢复预检收到 `work/wi-custom-branch` 与创建仍收到 raw target。
- GREEN：修复后 `node --test --test-timeout=120000 tests/integration/local-git-core-provisioning.test.js` 与 `node --test --test-timeout=120000 tests/integration/local-git-start-work-resume.test.js tests/integration/development-local-git.test.js` 全部通过；`pnpm exec tsc --noEmit` 与 `git diff --check` 退出 0。
- 第二轮 RED：新增子目录配置用例在修复前观察到 preflight 返回 `<checkout>/packages/core.worktrees/...`，而真实 Git checkout 根是 `<checkout>`。
- 第二轮 GREEN：修复后三个 Local Git 集成文件与 `tests/contract/development-contract.test.js` 全部通过；`pnpm exec tsc --noEmit` 与 `git diff --check` 退出 0。
- 第三轮 RED：新增 nested invalid-target 回归在 Git resolver 修复前记录了 `rev-parse --show-toplevel` argv，虽未发生 Git 写入但违反零 Git argv 路径拒绝约束。
- 第三轮 GREEN：filesystem ancestor marker 修复后 Local Git suite、Local Git/core/resume 集成、Development contract 与完整 `pnpm verify`（含 MVP0）全部通过；typecheck、boundaries、workflow、disclosure、size、diff-check 退出 0。
- [x] 2026-10-14：第二轮修复的增量独立复评（head `d9c6cf62`）：上一轮 7 条意见按原条件均已修；外层标记校验、取消缓存与拒绝路径零 Git argv 经 base / `910312ae` / `a7740743` / 新 head 四方对照成立；实施者整表 26/26 KILLED；新提 1 条 P3（子目录配置下手工移除第 5、6 步与文字不符），已在 `160c80fd` 按检出根与子目录两种配置订正，并在 bash 与 `zsh -f -i` 下按文档原样各跑四个夹具。
- [x] 2026-10-14：归档：本计划移到 `docs/exec-plan/completed/`，`docs/README.md` 索引行改为 Completed，`2026-09-24-local-git-worktree` 计划的取代说明改指归档路径；评审与修复复评的锁定事实、矩阵与变异表见 `docs/review/pr-328-mmp-review.md`。跟进：#340（符号链接检出按 canonical 检出判定）、#341（旧根句柄让 Ready 上下文无路可走）。

## Surprises & Discoveries

- 2026-10-13：core 没有 repository filesystem path，不能安全生成 sibling absolute path；provider paths.ts 也会拒绝 ..。
- 2026-10-13：单独注入 allowedRoot 不会移动 core 传入的相对 .worktrees/slug；必须有 path optional/worktreeKey 或 host 直接传 absolute target。
- 2026-10-13：provisionGit 先 ensureBranch 再 ensureWorktree；target preflight 必须在 branch mutation 前完成，否则失败会留下孤立分支。
- 2026-10-13：info/exclude 的正确比较对象是 provider 解析后的 git-common-dir/info/exclude，不是固定 repo/.git/info/exclude。
- 2026-10-13：实现采用可选 `preflightWorktree` 返回规范化 target；core 在 `ensureBranch` 前调用，Local Git/Fake 共用 `path + worktreeKey` 意图。默认根为 `<checkout-parent>/<checkout-name>.worktrees`，并移除 `excludeDefaultRoot`。
- 2026-10-13：复审发现恢复路径的预检仍使用本次请求的 `names.branch`，会让分支敏感 provider 在已持久化身份与预检输入之间分叉；同一复审还确认 `target.path` 只用于冲突诊断而未传给真正的 `createWorktree`，存在 A/B target divergence。修复为预检使用 `decided ?? names.branch`，创建使用 `target.path ?? names.path`，并以真实 provider 回归锁住两条边界。
- 2026-10-13：第二轮复评发现默认根计算使用 `repository.path` 的原始字符串，而 `git -C <subdir> rev-parse --show-toplevel` 仍指向上层 checkout；`<subdir>.worktrees` 因此会回到 checkout 内。修复只在默认根需要时解析真实 checkout：已有 `.git` marker 的根路径走 realpath 快路径，子目录配置走 `rev-parse --show-toplevel`，显式 `allowedRoot` 保持原有路径安全语义。Superseded by 下一条（2026-10-13）：改为纯文件系统 `.git` 标记查找，不再执行 `rev-parse`。
- 2026-10-13：进一步复评发现子目录配置的非法目标会先触发 `rev-parse --show-toplevel`，违反路径拒绝的零 Git argv 口径；改为从配置路径向上查找 `.git` marker，marker 缺失时直接 fail closed。默认解析不再执行 Git 读命令。Superseded by 本节 2026-10-14 条目（2026-10-14）：向上第一个标记在 submodule / 嵌套仓库下不是独立检出。
- 2026-10-14：第二轮 MMP 评审（head `910312ae`）用良性实验证明「向上第一个 `.git` 标记」不等于独立检出。在临时目录里以默认配置调用 `preflightWorktree` / `createWorktree`：`repository.path` 是 submodule `super/sub` 时，`910312ae` 落到 `super/sub.worktrees/wi-1`，超项目 `git status --porcelain` 由空变为 `?? sub.worktrees/`，`git add -A --dry-run` 会暂存它（base `7c7e77cc` 落在 `super/sub/.worktrees/wi-1`、超项目干净）；嵌在 `outer` 检出里的 bare 仓库借用 `outer.worktrees`；`repository.path` 暂时不存在而外层是检出时借用外层检出并把结果缓存到仓库出现之后。修复后同三组实验全部 fail closed（submodule、bare、嵌套 bare 为 `invalid_input` 并点名 `allowedRoot`，缺席仓库为 `unavailable`），超项目 status 保持空。判别用例：`tests/integration/development-local-git.test.js`「默认根只认独立检出：submodule、嵌套仓库、bare 与缺席的仓库目录在任何 Git argv 之前 fail closed，不借用外层检出」，修复前 RED（submodule、嵌套仓库、嵌套 bare、缺席仓库四格借用外层检出），修复后 GREEN，且全程零 Git argv。
- 2026-10-14：`git worktree remove`（不加 `--force`）会不提示地删除工作树里被忽略的文件：临时仓库里含被忽略 `build/out.bin` 的工作树移除退出 0，文件随目录消失；有改动或未跟踪文件时才以退出码 128 拒绝。所以手工移除说明的「保存工作」一步必须用 `status --porcelain --ignored` 并提示复制 `!!` 行。
- 2026-10-14：把 `preflightWorktree` 登记为「声明了 worktree.create 就必须实现」时，`tests/contract/development-contract.test.js` 的「省略可选方法」装配立即变红：声明创建却不实现预检是 core 支持的合法形态（`preflightWorktree === undefined` 时直接按调用方意图创建），套件因此按「实现了才判定」处理预检。
- 2026-10-14：最终整表变异里 M11（删 `paths.ts` 的 `symlinked_root` 拒绝）存活。原因：`tests/integration/development-local-git.test.js` 的符号链接用例仍用默认配置，默认根移到检出外后 `.worktrees/...` 先以逃出允许根被拒；即使显式注入检出内的旧根，目标尾部不存在时最近存在祖先就是那条链接，尾部的「悬空符号链接」判定先一步拒绝。在 base `7c7e77cc` 的 provider 快照上加同一变异跑 base 版用例的三种指向，结果同为 `invalid_input`、零 Git 调用——base 上也拦不住，不是本 PR 引入的回归。修法是显式注入旧根并让目标经链接下已存在的子目录，M11 随即 KILLED。
- 2026-10-14：复评（head `a7740743`）发现「嵌套判定过宽」：外层只要有名为 `.git` 的任何东西就拒绝，并一律报「submodule 或嵌套仓库」。三方对照（base `7c7e77cc`、`910312ae`、`a7740743`）里，祖先只有一个空 `.git/`（Git 在那里答 not a git repository）时前两者能建、`a7740743` 拒绝；dotfiles `$HOME` 下的仓库与主检出被忽略的 `.worktrees/` 下的链接工作树也被拒，消息却指向 submodule。同一复评还发现「只缓存成功」在换形态下仍固化首次结论：`outer/inner` 目录已存在但尚未 `git init` 时派生出外层检出的兄弟目录并被缓存，`git init` 之后同一实例仍答 ok。修复后的判别用例 `tests/integration/development-local-git.test.js`「默认根只认独立检出：位于另一 Git 检出之内、bare 与缺席的仓库目录…」修复前 RED 三格（空 `.git/` 祖先、杂项 `.git` 文件祖先、`git init` 之后的同一实例），修复后 GREEN；复评脚本在修复后的树上：dotfiles `$HOME`（两种隐藏方式）与被忽略 `.worktrees/` 下的链接工作树答 `invalid_input`，消息为「位于另一个 Git 检出 … 之内…请显式注入 allowedRoot（宿主注入入口见 #132）」，外层 status 前后不变；空 `.git/` 祖先、符号链接祖先、`--separate-git-dir` 能建。

- 2026-10-14：复评指出「移到新默认根后复用」对已开始的工作项不成立。本轮复测（不提交的良性用例，真实 Local Git 加替身存储）：先用以 `<repo>/.worktrees` 为 `allowedRoot` 的实例 Start Work 得到旧默认句柄，换成默认配置后，工作树原地不动、被移除、被移动三种情形下，新旧幂等键的 Start Work 都是 Ready + `result_unknown`（`invalid_input`：规范化后逃出允许根）。与 base 的差异：base 默认根就是 `<repo>/.worktrees`，用户移除工作树后读回答 `not_found` → Failed，再 Start Work 会在原处重建；本轮用与 base 默认根同形的显式旧根实例复现了这一点（移除后答 Failed `not_found`，再一次答 Ready confirmed 并在旧根重建）。默认配置下同一记录停在 Ready + `result_unknown`，原因是 `verifyExistingWorktree` 只把 `not_found` 当确定结论，而默认配置对允许根之外的句柄答 `invalid_input`；改成对允许根之外答 `not_found` 会改变读回语义，本 PR 不做，转跟进 #341，手工移除说明如实写出这一后果。

## Decision Log

- 2026-10-14（主控（本会话 owner）裁定）：已 Start Work、记录着旧默认句柄的工作项停在 Ready + `result_unknown` 的出路不在本 PR 解决，转跟进 #341。理由：要么让 `getWorktree` 对允许根之外的句柄答 `not_found`（改变读回语义），要么新增关闭 / 重置 / 重新对账已 Ready 执行上下文的命令，两者都是需要单独设计与评审的接口变化；受影响的只有开发检出中直接调用 provider API、以旧默认配置 Start Work 过的工作项，处境与可选做法写在 `Idempotence and Recovery`「旧默认工作树的手工移除」末尾。
- 2026-10-14（主控（本会话 owner）裁定，修复实施者执行）：保留「默认配置下位于另一 Git 检出之内、bare 仓库 fail closed」的方向，不再请人类裁决，但嵌套判定按 Git 口径收紧。依据：#132 的验收已要求「The host gives Local Git a worktree allowed root outside the repository checkout, agreed with #214」，产品路径是宿主注入显式 `allowedRoot`，默认推导只是无宿主时的后备；fail closed 符合人类伙伴 2026-09-29 批准里「never leaves artefacts inside the user's repository」。判据：外层 `.git` 必须是 Git 认得的标记——目录要像 Git 目录（`HEAD` 文件 + `objects/` + `refs/`），文件要以 `gitdir:` 开头；空 `.git/` 或杂项文件不算（Git 在那里答 not a git repository）。拒绝消息点名外层检出与出路（显式 `allowedRoot`，宿主入口见 #132），不再断言 submodule。默认根不再缓存，每次重新判定：目录先建、后 `git init` 成嵌套仓库时，同一实例必须改判。后果——以下形态在默认配置下 fail closed、须显式注入 `allowedRoot`：`$HOME` 本身是 dotfiles 检出时 `$HOME` 下的每个仓库（外层用 `.gitignore` 还是 `status.showUntrackedFiles=no` 隐藏未跟踪内容都一样）；位于另一检出被忽略目录下的链接工作树（例如本仓库 `AGENTS.md` §6 的 `.worktrees/<task-slug>/` 布局）；submodule 与嵌套仓库。祖先是符号链接、大小写变体、`--separate-git-dir`、位于任何检出之外的链接工作树不受影响。证据见 Surprises 2026-10-14「嵌套判定过宽」。
- 2026-10-14：`preflightWorktree` 登记进共享 Development 契约套件（`tests/contract/suites/development.js`），与 `createWorktree` 同键（`development.worktree.create`），不另立能力。它是可选增强：声明了创建也可以不实现预检（core 此时按调用方意图创建，`tests/contract/development-contract.test.js` 的「省略可选方法」装配就是这种形态）；实现了就必须做到未声明答 `not_supported`、外来仓库答 `not_found`、零写入、返回的目标交给 `createWorktree` 被原样接受并可读回。这条路径义务同时写进 `packages/capabilities/src/development-provider.ts` 的端口注释。判别力用变异证明（Fake 与 Local Git 各自删能力门、删仓库身份门、偷偷写入、返回 create 不接受的目标），不扩坏 adapter 子进程矩阵。
- 2026-10-14：#214 Scope 第 3 条（重新表述 #137 验收 1 与 `AGENTS.md` §7 的路径规则）判定为不需要改文字。#137 验收 1 写的是「允许根之外、含 `..`、经符号链接到达的目标都在任何 Git 命令之前被拒」，`AGENTS.md` §7 写的是「worktree 路径在交给 Git 操作前必须规范化为 realpath，拒绝 `..` 穿越、逃逸允许根目录和未经允许的符号链接」：两处都没有把「允许根在检出内」写成默认形态，本 PR 之后仍逐字成立。唯一把允许根与检出绑在一起的表述是 `packages/providers/development-local-git/src/paths.ts` 文件头「允许根落在仓库检出之内的分量一律不得是符号链接」，它约束显式注入的检出内根，仍然成立；默认允许根的测试说明已随本 PR 更新到 `tests/integration/README.md`。#137 已关闭，不改它的正文。
- 2026-10-14：评审 P3「符号链接检出」本 PR 不修，转跟进 #340。事实：`repository.path` 叶子本身是符号链接（`link-repo -> real-repo`）时默认根推导为 `real-repo.worktrees`，但 `paths.ts` 的 `firstLink(repositoryPath, allowedRoot)` 先 lstat `repositoryPath` 自身，于是答 `invalid_input`「允许根在仓库检出内是符号链接」；默认根位置本身是指向检出外目录的符号链接时答「路径分量是悬空符号链接」。两者都 fail closed，只是消息与事实不符。修它要让 `paths.ts` 按 canonical 检出判定「允许根是否在检出内」，会动 PR #160 留下的承重符号链接不变量，不是机械改动。现阶段约定：默认配置下 `repository.path` 叶子与默认根位置都不得是符号链接。
- 2026-10-14：旧默认工作树只给手工移除说明，不迁移、不承诺「显式注入旧根继续可用」。依据是人类伙伴 2026-09-29 在 #214 的批准评论（旧默认落点在开发检出里不迁移，PR 要写明如何手工移除）与当前事实：仓库里没有宿主构造 Local Git provider（#132），显式 `allowedRoot` 只是构造参数。说明写在 `Idempotence and Recovery`「旧默认工作树的手工移除」，每条命令都在临时仓库里实测；可选的 `git worktree move` 到 `<repo>.worktrees/<key>` 之后，默认配置按 `conflict` 复用该工作树（实测），所以把它列为「继续使用」的唯一路径。
- 2026-10-14（修复实施者，人类伙伴在评审会话里把修复 owner 指定给该会话）：默认根只给独立检出派生。`packages/providers/development-local-git/src/provider.ts` 的 `deriveDefaultRoot` 从 `repository.path` 的 realpath 起逐级先找 `.git`（目录或 gitfile）、再看目录本身是否为 bare Git 目录（`HEAD` 文件 + `objects/` + `refs/`），与 Git 仓库发现同序，但只做文件系统探测，保持「路径拒绝之前零 Git argv」。以下形态在默认配置下 fail closed：bare 仓库、向上找不到检出、检出的任一祖先也有 `.git`（submodule、嵌在另一检出里的仓库）——都答 `invalid_input` 并要求显式注入 `allowedRoot`；`repository.path` 自身不可达答 `unavailable`（与 #253「此刻读不到」同口径），不向上借用外层检出，也不缓存，只缓存派生成功的根。Rationale：兄弟目录 `<checkout>.worktrees` 只有在检出不被另一个检出包住时才在「用户检出之外」，否则违反 #214 验收 1 与 M4 demo 门禁（不在用户仓库里留下产物）；改用 `git rev-parse --show-superproject-working-tree` 能识别 submodule，但违反零 argv 口径，也认不出未登记的嵌套仓库。代价：base 上 submodule 会建在 `<sub>/.worktrees` 并写 submodule 的 `info/exclude`、bare 仓库会建在 `<x.git>/.worktrees`，这些形态现在必须显式注入 `allowedRoot`，而当前没有宿主构造 Local Git provider（#132），所以在 #132 交付前它们在默认配置下不能 Start Work；fail closed 优先于在用户检出里留产物。证据见 Surprises 2026-10-14 第一条。Superseded（外层标记判据与缓存两点）by 本节「嵌套判定按 Git 口径收紧」（2026-10-14）：外层标记须是 Git 认得的 `.git`，默认根不再缓存。
- 2026-10-14：删除 `worktreePathFor`，保留实际被谱系消费者使用的 `worktreeKeyFor`。理由是 `packages/core` 为未发布的 private `0.0.0` 包，仓库内无旧 helper 消费者，继续导出旧默认路径会提供与新 provider 权威落点不一致的接口；本阶段不增加无使用者的兼容层。验证在检出 `docs/worktree-root-plan` 的工作树根目录运行 Batch 4 命令。
- 2026-10-13：采用 path optional + worktreeKey 的跨层契约；拒绝 core 直接拼 ../ 和 provider-only 重解释相对 path。理由是前者绕过现有 path safety，后者会让 Fake/Local Git/Core 事实分叉。
- 2026-10-13：保留所有通用 symlink/realpath/argv safety；只删除 checkout-relative 默认根的 exclude 补偿。
- 2026-10-13：显式旧路径与 persisted handle 保持可读，不自动迁移/删除；迁移由用户按手册执行。Superseded by 本节 2026-10-14「旧默认工作树只给手工移除说明」（2026-10-14）：所说的手册此前不存在；「保持可读」只对显式注入旧 allowedRoot 的 provider 实例成立，默认配置下旧句柄答 `invalid_input`。
- 2026-10-13：#214 不实现 #132 host composition；未来 host 可注入 canonical target，remote/registry ownership 留给 #132。
- 2026-10-13：canonical target 是 `preflightWorktree` 的 provider ack；core 不得在后续写入步骤退回原始 path。恢复时 persisted branch identity 同样是供应序列的权威输入，不能只在 ensureBranch 步骤使用。
- 2026-10-13：默认 root 的拥有者是 Git 识别出的真实 checkout，而不是宿主传入的任意可进入子目录；宿主显式提供 `allowedRoot` 时仍尊重该边界，并继续由 `paths.ts` 执行 realpath、symlink 与 root containment 守卫。Superseded by 本节 2026-10-14「默认根只给独立检出派生」（2026-10-14）：实现的判据从来不是 Git 的识别结果，而是文件系统 `.git` 标记探测，且向上第一个标记在 submodule / 嵌套仓库下会让兄弟目录落进外层检出。
- 2026-10-13：`LocalGitDevelopmentProvider.allowedRoot` 不是跨层契约字段；保留它只表示显式注入的 `allowedRoot`，默认派生值只存在于内部 lazy resolver，避免公开属性与实际 root 不一致。

## Idempotence and Recovery

path intent 与 provider derivation 可重复；legacy handles are authoritative once persisted. rebase 前创建 backup ref；冲突可 abort。默认行为回滚为反向提交，不清理既有 info/exclude 或移动用户 worktrees。

### 旧默认工作树的手工移除

适用对象：本变更之前用 Local Git provider 默认配置建过工作树的检出。旧默认根是 `<repository.path>/.worktrees`——`repository.path` 指向子目录时就在那个子目录下，不是检出根；工作树在 `<旧默认根>/<key>`，检出 core 默认分支 `work/<key>`；provider 还往 `<git-common-dir>/info/exclude` 追加过一行 `/.worktrees/`。当前没有宿主构造 Local Git provider（#132），只有开发检出或直接调用 provider API 的场景会留下这些。人类伙伴 2026-09-29 在 #214 的批准评论裁定旧默认落点不迁移、由 PR 写明如何手工移除。新默认配置下旧句柄的读回答 `invalid_input`（规范化后逃出允许根）；已 Start Work 的工作项因此停在 Ready + `result_unknown`，见本节末尾「已开始的工作项」。不处理时这些工作树仍是普通的 Git 工作树。旧 provider 写的 `/.worktrees/` 锚定在检出根：检出根配置下（旧默认根就是 `<检出根>/.worktrees`）它让主检出的 `git status` 保持干净，「保留旧根」就是什么都不做；子目录配置下它从来盖不住 `<sub>/.worktrees/`，旧工作树一直以 `?? <sub>/.worktrees/` 出现在主检出的 status 里，`git add -A` 会把它们当嵌入仓库暂存，这种配置建议按本节移除。

只动 provider 建的工作树。`.worktrees/` 下也可能有人自己建的工作树（本仓库 `AGENTS.md` §6 的开发工作区就放在 `.worktrees/<task-slug>/`），它们不是本节的对象，不要移除。第 1 步按 `work/` 分支筛选，列出的每一行仍要逐个核对；Start Work 时传过自定义 `branchName` 的工作项不在 `work/` 分支上，以执行上下文记录里的 `worktreeExternalId` 为准逐份补上。

在 shell 里执行，`REPO_PATH` 换成旧配置里的 `repository.path`（检出根或子目录）。代码块里只有命令，期望结果写在块外：

1. 列出旧默认根下检出 `work/` 分支的工作树（路径含空格也按整行输出），每一行下文记作 `WT`：

   ```sh
   OLD="$(cd "$REPO_PATH" && pwd -P)/.worktrees/"
   git -C "$REPO_PATH" worktree list --porcelain | awk -v old="$OLD" '/^worktree /{p=substr($0,10)} /^branch refs\/heads\/work\//{ if (index(p, old)==1) print p }'
   ```

2. 逐份保存工作：`git -C "$WT" status --porcelain --ignored`。` M` / `??` 行是未提交改动与未跟踪文件：提交到这份工作树自己的分支（`git -C "$WT" add -A && git -C "$WT" commit -m "<说明>"`）或 `git -C "$WT" stash push -u`。`!!` 行是被忽略的文件（构建产物、本地配置）：下一步的 `git worktree remove` 会**不提示地**删除它们，需要的先复制出去。工作树里初始化过 submodule 时，再逐个检查 submodule：`git -C "$WT" submodule foreach --recursive git status --porcelain --ignored`。目录已被手工删掉的那份在这一步报 `cannot change to`，没有可保存的东西，第 3 步照样能移除它的登记。分支上的提交在移除工作树后仍在分支上。
3. 移除，不加 `--force`：`git -C "$REPO_PATH" worktree remove "$WT"`。三种报错：
   - `contains modified or untracked files, use --force to delete it`（退出码 128）：第 2 步没做完，回到第 2 步。
   - `cannot remove a locked working tree`：先弄清谁锁的，确认无用后 `git -C "$REPO_PATH" worktree unlock "$WT"` 再移除。
   - `working trees containing submodules cannot be moved or removed`（退出码 128，`submodule deinit --all` 之后仍然如此）：确认第 2 步已覆盖这份工作树与它的每个 submodule 之后，才用单个 `--force`：`git -C "$REPO_PATH" worktree remove --force "$WT"`。这类工作树也不能 `worktree move`。
4. 清理目录已被手工删掉、只剩登记的条目，先预览再执行：`git -C "$REPO_PATH" worktree prune --dry-run --verbose`，然后 `git -C "$REPO_PATH" worktree prune --verbose`。
5. 可选清理，第 1 步的列表为空之后再做；`BEFORE` 记下清理前的状态，供第 6 步对比：

   ```sh
   BEFORE="$(git -C "$REPO_PATH" status --porcelain)"
   git -C "$REPO_PATH" branch -d "work/<key>"
   rmdir "${OLD%/}"
   TOP="$(git -C "$REPO_PATH" rev-parse --show-toplevel)"
   EXCLUDE="$(git -C "$REPO_PATH" rev-parse --path-format=absolute --git-path info/exclude)"
   test -e "$TOP/.worktrees" || sed -i.bak '\#^/\.worktrees/$#d' "$EXCLUDE"
   ```

   `branch -d` 对未合并的分支报 `not fully merged` 并拒绝：第 2 步保存的工作就在那条分支上，确认不再需要才用 `-D`。`rmdir` 只删空目录：`"$OLD"` 下还有人自己建的工作树时它失败，什么也不删。`/.worktrees/` 那一行锚定在检出根，同时隐藏 `<检出根>/.worktrees/` 下人建的工作树，所以只在 `"$TOP/.worktrees"` 已不存在时才删（最后一行自带这个判断，子目录配置下检查的也是检出根）；`sed` 只删这一行，原文件留在 `"$EXCLUDE.bak"`（BSD 与 GNU sed 都接受这种写法）。
6. 回读：

   ```sh
   git -C "$REPO_PATH" worktree list --porcelain | awk -v old="$OLD" '/^worktree /{p=substr($0,10)} /^branch refs\/heads\/work\//{ if (index(p, old)==1) print p }'
   [ "$BEFORE" = "$(git -C "$REPO_PATH" status --porcelain)" ] && echo same
   grep -cx '/.worktrees/' "$EXCLUDE"
   test -e "${OLD%/}" || echo removed
   ```

   期望：第一条没有输出。做了第 5 步时：第二条输出 `same`；第三条输出 `0`，`"$TOP/.worktrees"` 仍存在、那一行因此保留时输出 `1`；第四条输出 `removed`，`"$OLD"` 下还有人建的工作树时没有输出。

想继续用某一份而不是移除它时，可以把它移到新默认根，但这只对**没有执行上下文记录**的工作树有用（例如直接调用 provider API 建的）：默认配置对同一 key 与分支答 `conflict` 并按登记复用它。只适用于独立检出（submodule、位于另一 Git 检出之内与 bare 仓库在默认配置下没有默认根，见 Decision Log）；含已初始化 submodule 的工作树不能移动：

```sh
TOP="$(git -C "$REPO_PATH" rev-parse --show-toplevel)"
mkdir -p "$TOP.worktrees" && git -C "$REPO_PATH" worktree move "$WT" "$TOP.worktrees/<key>"
```

已开始的工作项：以旧默认句柄 Start Work 过的工作项，执行上下文里记着 `<旧默认根>/<key>`。默认配置下读回这个句柄答 `invalid_input`，而 `verifyExistingWorktree` 只把 `not_found` 当确定结论，所以无论工作树原地不动、被移动还是被移除，新旧幂等键的 Start Work 都停在 Ready + `result_unknown`，既不改判 Failed，也不复用移动后的工作树。没有产品内恢复路径：core 没有关闭、重置或重新对账已 Ready 执行上下文的命令（跟进 #341）。对直接构造 provider 的调用方（当前唯一可能有这类记录的人），实测的处境是：工作树原地不动时，对这些工作项继续使用以 `allowedRoot: <旧默认根>` 构造的实例，读回 Ready + confirmed；移除或移动之后用旧根实例 Start Work 会改判 Failed，但随后默认配置的重放仍沿用持久化的旧句柄（验收 6），预检答 `invalid_input` 再次 Failed，旧根实例则在旧根重建工作树（移动过的还会因分支已被新位置检出而失败）。所以：还要用的工作项保留旧工作树并继续用旧根实例；不再需要的按本节移除，接受它停在 Ready + `result_unknown`。只影响开发检出中直接调用 provider API、以旧默认配置 Start Work 过的工作项。

实测（2026-10-14 增量复评后，git 2.56.0，在检出 `docs/worktree-root-plan` 的工作树上用临时目录运行，不碰真实仓库）：从本节逐字抽取命令（第 1、5、6 步与移动用代码块原文，其余用行内命令原文，只替换 `<key>`、`<说明>` 占位符），在四种夹具上分别用 `bash --norc --noprofile` 与 `zsh -f -i`（`interactivecomments` 关闭）各跑一遍，两种 shell 的输出除提交号外逐行相同。检出根路径都含空格（`my repo`），`info/exclude` 都预先追加了 `/.worktrees/`。
- 检出根配置，`.worktrees/` 下另有人建的 `my-feature`（分支 `feature/mine`）：第 1 步列出 7 份 `work/` 工作树，不含 `my-feature`。被忽略的 `build/out.bin` 随移除消失；有改动的那份先退出 128、提交后退出 0；`stash push -u` 后退出 0；锁定的那份先退出 128（`cannot remove a locked working tree`），unlock 后退出 0；含已初始化 submodule 的那份退出 128，单个 `--force` 退出 0；目录已删的那份第 2 步报 `cannot change to`，第 3 步退出 0；移动块退出 0。第 5 步 `rmdir` 报 `Directory not empty`，exclude 行因此保留；第 6 步：列表为空、`same`、`1`、没有 `removed`；主检出 status 前后都为空，人建工作树仍在。
- 检出根配置，没有人建工作树：第 6 步 `same`、`0`、`removed`。
- 子目录配置（`REPO_PATH` 为 `<检出根>/pkg`），检出根的 `.worktrees/` 下有人建工作树：移除前主检出 status 是 `?? pkg/.worktrees/`，`git add -A --dry-run` 会把两份旧工作树当嵌入仓库加入；第 1 步列出 `pkg/.worktrees/` 下的两份；第 6 步 `same`、`1`、`removed`，人建工作树仍被隐藏，主检出 status 为空。
- 子目录配置，没有人建工作树：第 6 步 `same`、`0`、`removed`，主检出 status 为空。
- 已开始的工作项：真实 Local Git 加替身存储的临时用例，先用旧根实例 Start Work 得到旧默认句柄，再按原地不动、移除、移动三种情形换回默认配置，结果如上一段所述。

## Interfaces and Dependencies

DevelopmentProvider createWorktree input 与 preflightWorktree 路径义务（`tests/contract/suites/development.js` 看护）、core provisionGit/namesFor/chain-facts、Local Git path safety、Fake development provider、#132 host-injected allowedRoot/absolute target、#304 Start Work fencing、AGENTS.md §7。

## Outcomes & Retrospective

本地闭环已完成：默认 target 位于 checkout 外；checkout 内 `.worktrees` 符号链接不改变目标；解析后的 `info/exclude` 字节不变；invalid target 的 preflight 早于 branch mutation；恢复路径复用已持久化句柄；未观察 chain facts 只传播稳定 key。PR #328 已创建并回读 native closing issue #214、base/head 与上一修复 head 的 checks；本批次新 head 推送后仍需重新回读 checks 与 review gate，人类批准前保持 Active。2026-10-14 第二轮评审修复后：默认根只给独立检出派生，嵌套、bare、缺席的仓库在默认配置下 fail closed；旧默认工作树有实测过的手工移除说明；预检进入共享契约；重放、对账读回、骨架与检出内旧根的符号链接判定都有判别用例（变异整表见 Progress）。

实现小结（原「Implementation Note (2026-10-13)」，为符合 `PLANS.md` §3 的章节顺序并入本节）：Batch 1–3 已落地：`ProviderCreateWorktreeInput.path` 改为可选并新增稳定 `worktreeKey`，core 仅传意图；Local Git 在 checkout 外派生默认根，显式旧根仍可注入；preflight 在分支变更前执行；Fake 与 chain-facts 同步；默认与显式路径均不写 `info/exclude`。旧 `<repo>/.worktrees` 工作树不自动迁移，继续使用时通过 `allowedRoot` 显式注入并按旧计划手册人工回读。Superseded by `Idempotence and Recovery`「旧默认工作树的手工移除」（2026-10-14）：「旧计划手册」在仓库里不存在，显式注入 `allowedRoot` 当前没有宿主可走（#132）。

## Bottom Change Note

- 2026-10-14：增量复评修复：手工移除说明的第 5、6 步与开头按检出根 / 子目录两种配置订正并逐字实跑，已开始工作项的出路回填跟进 #341。
- 2026-10-14：复评修复：Decision Log 记录主控对嵌套判定的裁定与后果，手工移除说明改为按 `work/` 分支选工作树、补 submodule 与已开始工作项的处境，变异整表在新代码树上重跑，跟进编号回填 #340。
- 2026-10-14：第二轮 MMP 评审修复：新增「旧默认工作树的手工移除」与验收第 10、11 行，Decision Log 记录默认根判据、预检契约、Scope 第 3 条与符号链接检出的取舍，Progress 记录逐条处置与变异整表，被推翻的表述就地标注 Superseded，易失计数改为回读命令，两节越序内容并入 Outcomes 与 Progress。
- 2026-10-14：按能力边界整理提交与精确 Issue 尾注；记录独立 dead code 检查、旧路径 helper 的删除依据和恢复锚点，默认落点、显式旧根及已持久化句柄语义不变。
- 2026-10-13：创建 #214 ExecPlan，记录默认工作树安全切片、intent contract、preflight 与迁移门。
- 2026-10-13：完成本地实现与验证；PR #328 已创建，native issue linkage（#214）与远端 base/head/checks 已按上一修复 head 回读。
- 2026-10-13：默认行为与评审修复仍待人类批准；本批次只更新分支与 PR，不自动 resolve 线程或合并。
