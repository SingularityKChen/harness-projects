# Worktree Root Outside Checkout ExecPlan

> 状态：Active
> 创建：2026-10-13
> 范围：完成 issue #214：将默认 worktree 落点定义为 checkout 外的 provider-owned/host-injected absolute target，删除旧 info/exclude 补偿，并提供旧根迁移说明。
> 上游输入：AGENTS.md、PLANS.md、issue #214、docs/exec-plan/active/2026-09-24-local-git-worktree.md、packages/core/src/git-provisioning.ts、packages/providers/development-local-git/src/provider.ts。

## Purpose / Big Picture

完成后，默认 Start Work 不再把相对 .worktrees/slug 当作本机路径；Local Git provider 在 checkout 外派生 canonical worktree root，或消费宿主注入的绝对 target。上游提交的 .worktrees 符号链接不能决定写入位置，provider 不再写 info/exclude 作为旧根补偿；旧 worktree 不自动迁移但有可执行手册。最小成功证据是：默认工作树位于 checkout 外，checkout 与 provider 解析出的 git-common-dir/info/exclude 字节不变，invalid target 在 branch mutation 之前被拒绝，旧句柄可回读。

## Context and Orientation

当前 packages/core/src/git-provisioning.ts 的 worktreePathFor/namesFor 只知道 work item/repository identity，不能安全拼出本地 sibling path；core 也不依赖 node:path/fs。packages/providers/development-local-git/src/paths.ts 明确拒绝 .. 分量，因而不能把 ../foo.worktrees/slug 作为隐式绕过。provider 当前默认 allowedRoot 为 checkout/.worktrees，并在 createWorktree 前写 git-common-dir/info/exclude；chain-facts.ts 在未观察到真实工作树时还会传播旧的 .worktrees skeleton path。

独立设计结论是：#214 需要显式“默认根意图”契约，而不是 provider-only 偷改相对字符串。core 传 path 可选与稳定 worktreeKey；显式 absolute target 仍逐字传递，省略 path 时由 Local Git provider 依据 repository canonical path 派生 checkout 外 root。#132 后续可让 host 注入 canonical target/allowedRoot，但不在本 PR 组合 host。provisionGit 先建 branch 再建 worktree，因此 target/allowedRoot 预检必须在 branch mutation 前完成，或保留并明确既有失败账本。

## Design / Spec

- 扩展 Development provider createWorktree input：path 可选，worktreeKey 必填；ProviderWorktree.path 仍是 provider 返回的 canonical absolute handle。
- core namesFor 不再生成 .worktrees/slug 本机路径；省略显式 worktreePath 时只传稳定 worktreeKey，显式 absolute path 逐字传入，并在 ensureBranch 之前完成 provider target preflight。
- Local Git provider 在 path 缺省时，以 repository canonical path 的 parent 和 repository-specific derived root 组合外部 target；显式 allowedRoot/absolute target 优先。所有 target/root 仍经过 realpath、不存在尾部、..、控制字符和 symlink safety checks。
- 删除只服务于 checkout 内默认根的 DEFAULT_ROOT_EXCLUDE/excludeDefaultRoot writer；保留通用 path safety、写后回读、显式旧根兼容和 provider argv-only。
- chain-facts 对未观察到的工作树只传播稳定 key/中性 pending handle，不把旧 .worktrees 字符串当已知本机路径；已观察的 worktreeExternalId 是权威，不被新默认静默改写。
- 旧 root 不自动迁移、不删除；文档说明 git worktree list --porcelain、显式注入旧 allowedRoot、人工 git worktree move 与回读。回滚不清理旧 info/exclude。

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
- 写迁移说明：列出旧 worktrees、选择显式 old root、人工 git worktree move、失败回滚；不自动删除。
- 保持 explicit legacy path 与 persisted handle 可读。

验证命令：
node --test tests/contract/development-local-git-source.test.js tests/integration/development-local-git.test.js tests/integration/local-git-start-work-resume.test.js
pnpm verify
期望：无默认 info/exclude 变化，existing path safety 与 legacy replay 全绿。

回滚：反向 provider/facts/docs commit；旧 worktrees 仍由用户控制。

### Batch 4 · Adversarial mutation and release gate

最小闭环：证明新默认与旧 symlink guard、preflight、legacy replay 各自不可删除，完成 draft PR 回读。

涉及文件：tests、ExecPlan、docs README index。

- mutation：恢复 .worktrees/slug、恢复 checkout 内 root、恢复 exclude writer、删除 worktreeKey/path distinction、删除 preflight、重算旧句柄；每个都应被对应测试杀死。
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
| 1 | default outside checkout | canonical target 在 checkout 外 |
| 2 | no info/exclude write | provider 解析的 git-common-dir/info/exclude 字节不变 |
| 3 | tracked symlink | .worktrees symlink 不能改变目标 |
| 4 | preflight ordering | invalid target 不创建 branch/worktree |
| 5 | explicit allowedRoot/path | 注入旧 root 与显式 target 仍受安全守卫 |
| 6 | legacy replay | 已持久化 worktreeExternalId 不被新默认覆盖 |
| 7 | identity/facts | 未观察 skeleton 不传播旧假本机路径 |
| 8 | release/size | code≤800/docs≤1300，门禁全绿，默认变更仍待人类批准 |
| 9 | issue linkage | PR 与 #214 native references/Project fields 回读一致 |

## Progress

- [x] 2026-10-13：两份独立设计与总审阅完成；修订为“默认根意图 + provider 派生”而非 core 拼接 ../ 路径。
- [ ] Batch 1–4 未实现；PR 未创建。

## Surprises & Discoveries

- 2026-10-13：core 没有 repository filesystem path，不能安全生成 sibling absolute path；provider paths.ts 也会拒绝 ..。
- 2026-10-13：单独注入 allowedRoot 不会移动 core 传入的相对 .worktrees/slug；必须有 path optional/worktreeKey 或 host 直接传 absolute target。
- 2026-10-13：provisionGit 先 ensureBranch 再 ensureWorktree；target preflight 必须在 branch mutation 前完成，否则失败会留下孤立分支。
- 2026-10-13：info/exclude 的正确比较对象是 provider 解析后的 git-common-dir/info/exclude，不是固定 repo/.git/info/exclude。

## Decision Log

- 2026-10-13：采用 path optional + worktreeKey 的跨层契约；拒绝 core 直接拼 ../ 和 provider-only 重解释相对 path。理由是前者绕过现有 path safety，后者会让 Fake/Local Git/Core 事实分叉。
- 2026-10-13：保留所有通用 symlink/realpath/argv safety；只删除 checkout-relative 默认根的 exclude 补偿。
- 2026-10-13：显式旧路径与 persisted handle 保持可读，不自动迁移/删除；迁移由用户按手册执行。
- 2026-10-13：#214 不实现 #132 host composition；未来 host 可注入 canonical target，remote/registry ownership 留给 #132。

## Idempotence and Recovery

path intent 与 provider derivation 可重复；legacy handles are authoritative once persisted. rebase 前创建 backup ref；冲突可 abort。默认行为回滚为反向提交，不清理既有 info/exclude 或移动用户 worktrees。

## Interfaces and Dependencies

DevelopmentProvider createWorktree input、core provisionGit/namesFor/chain-facts、Local Git path safety、Fake development provider、#132 host-injected allowedRoot/absolute target、#304 Start Work fencing、AGENTS.md §7。

## Outcomes & Retrospective

完成后回填 target/branch/worktree ordering、symlink mutation、info/exclude hash、legacy replay、chain facts 与 current-head checks；人类批准前保持 Active。

## Bottom Change Note

- 2026-10-13：创建 #214 ExecPlan，记录默认工作树安全切片、intent contract、preflight 与迁移门。
