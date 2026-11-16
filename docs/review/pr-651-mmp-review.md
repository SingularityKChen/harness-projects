# PR #651 MMP 交付评审

评审日期：2026-11-16。目标：私有工作树容器；关联 #648。锁定 head `cf4d83fcb21b35d2bbf8cd901705535c1c1ccc4a`，base `8ace55af83a21a45397c855ba03374623b5fc3ae`（`main`）。执行上下文：检出本 PR 分支的 `.worktrees/private-worktree-roots` 根目录。独立评审只写本记录与本工作树的临时证据，没有修改产品、测试、ExecPlan、commit 或 GitHub review。

结论：**APPROVE，无可验证的 P0/P1/P2/P3 缺陷，无 inline 意见**。该结论只覆盖上述 head 的 POSIX 工程闭环；没有执行合并，也不构成 Windows 或 R1 人类接受。

## 锁定事实与边界

- 远端回读 head/base 与上述值一致；`isDraft=false`、`mergeable=MERGEABLE`、`mergeStateStatus=UNSTABLE`，两项提交均关联 #648，没有 debug/fixup 提交；reviews、comments、review threads 均为空。
- 当前 head 的 `PR Fast Gate`、类型/契约、生产浏览器、CodeQL、规则与 issue policy 成功；`Create review session` 失败是已观察到的独立可选检查，不能把 `UNSTABLE` 当成必需门禁失败。
- 闭环是生产 catalog + LocalGit 的两层0700、fresh/reopen、内容/身份保留和 canonical 第五家族拒绝。旧外层插件根已有0700；本次没有把0755差距描述为已复现跨 uid 泄漏。
- 安全前提是 Host 已保护插件根和祖先、隔离不同 OS uid；同 uid 进程不在隔离承诺内。新增路径替换实验检验同 fd 的对象一致性，不扩大这个威胁模型。
- #648 的 scope 明确限定已有 POSIX 验收差距；#644/#645 分别跟踪 Windows 私有创建与 Git/path 资格，不以 POSIX mode 代替 DACL。

## 风险矩阵（先建立，再逐层审查）

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 结果 |
|---|---|---|---|---|
| P0 | 数据、权限硬边界与发布面 | 七条不变量、Host 权威和凭据句柄 | 实际 diff、依赖边、门禁 | 无；未改规划/事务/凭据语义 |
| P1 | nofollow/owner/ACL/chmod/readback、异常关闭、恢复 | production fresh/reopen、第五家族、预检只读、catalog 所有权 | 真实 Host/Git、失败注入、9项变异 | 无；关键退化均可被断言识别 |
| P2 | 局部拒绝、恢复反馈与已有内容 | 自定义配置、绑定恢复、用户 checkout | issue acceptance、既有消费链、重复追踪 | 无；没有需另开 issue 的遗漏 |
| P3 | 命名、重复、维护成本 | 目录政策归 Host、Provider 只消费允许根 | 文档、规模、提交、回滚 | 无；不需要扩大重构 |

## 分层证据与结论

1. **代码与安全边界**：`host-private-data.ts` 的 `privateDirectory` 在同一 fd 上检查 uid/目录、查询 ACL、chmod 和回读；mkdir 的 EEXIST 不代表可信。`preparePrivateWorktreeDirectories` 先验证已私有的插件根，再只处理 worktrees/digest 两层；finally 和失败 catch 关闭获取的 fd。未增加递归遍历、用户内容写入或 ownership 接管。
2. **产品闭环**：生产 `PROVIDER_CATALOG` + Start Work 真的创建 Git worktree 并读回 ready；新进程 reopen 收紧两层且上下文、谱系、持久身份、文件 bytes/mode 保留。worktrees/digest 链入 checkout 两个第五家族分支均禁用该挂载，没有新增 context、Git 分支、linked worktree 或 checkout 文件。既有四种布局与安全外部根正控继续通过。
3. **架构与设计**：`localGitRoot` 统一摘要与 canonical/outside-checkout 规则；只读 catalog.create 保持无 mkdir。实际恢复在默认 entry 对象身份上准备目录，自定义同键 entry 可用自己的空配置与输出根。这个归属是当前组合契约所需；无需新增公共 hook 或改 LocalGit 的通用权限语义。创建时再次检查根保留了实际构造的守卫，不是重复维护第二套算法。
4. **反例**：打开前植入 digest symlink 被拒且外部内容/权限不变；打开后同 uid rename+symlink 时 chmod 仍留在原 inode，外部 sentinel 不变且 fd 关闭；fchmod 被注入为无效操作时回读拒绝，digest 尚未创建；插件根0755时拒绝且不创建两层；自定义同键 entry 配置为空时恢复成功且未生成默认目录。五项均通过。
5. **测试分层**：本次新增持久断言复用现有 Host/seed/Git fixture，未复制完整 ACL 安全矩阵。实际生产 Host、真实临时 Git、SQLite 新进程重开、绑定只读 probe、真实自定义 catalog 消费链、构建安装件与生产浏览器均有独立运行结果。foreign owner 的拒绝是合成 uid 观测，实际系统证据为 Darwin，未推断 Linux/Windows 实机资格。

## 实际执行与结果

所有命令均在上述专属工作树根目录执行；代码验证发生在锁定 head 上。

| 命令 | 观察到的结果 |
|---|---|
| `pnpm test:file tests/integration/harness-plugin-private-data.test.js tests/integration/harness-plugin-host-providers.test.js tests/integration/harness-plugin-repository-binding.test.js tests/integration/development-local-git.test.js tests/integration/harness-plugin-change-request-operation.test.js` | 184 passed，0 failed，0 skipped |
| `pnpm typecheck` | exit0 |
| `pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/browser/workspace-execution.test.js` | 50 passed（安装件29 + 生产浏览器21），0 failed；存在既有 SSR useLayoutEffect 警告 |
| `node --test .superpowers/pr651-review/adversarial.test.mjs` | 上述五项独立反例5 passed |
| `pnpm test:file tests/contract/content-placement.test.js tests/contract/package-boundaries.test.js` | 14 passed，0 failed |
| `node scripts/rule-checks.mjs disclosure 8ace55af83a21a45397c855ba03374623b5fc3ae` | exit0；再次经 `PR_BODY` 传入当前 PR 正文也通过；五类公开面人工检查未见真实敏感值 |
| `node scripts/rule-checks.mjs size 8ace55af83a21a45397c855ba03374623b5fc3ae` | exit0；技术 A+D169/1000，文档126/1500（不含本次未提交评审记录） |
| `git diff --check 8ace55af83a21a45397c855ba03374623b5fc3ae...HEAD` | exit0 |

独立反例和变异 spec/log 是本次评审的临时执行内容，正式结论由这里的行为、命令和结果自包含记录；没有要求产品运行依赖临时文件。

## 最终树变异表

先读 `scripts/review-mutate.mjs` 文件头与 `tests/contract/fixtures/review-mutate-self.json`。最终源码整表执行一次：`node scripts/review-mutate.mjs .superpowers/pr651-review/mutants.json`，exit0。每项均设置 `killedBy`；无 NOT_APPLIED、SURVIVED 或 KILLED_OTHER；夹具前后基线通过，结束后两个源码文件逐字节等于 HEAD。

| 变异 | killedBy 对应实际失败断言 | 结果 |
|---|---|---|
| M1 去掉激活准备 | `AC5 AC6 umask022` | KILLED |
| M2 按 implementationKey 强加政策 | `custom local-git entry`（既有实际 Host 消费链也失败） | KILLED |
| M3 在只读 catalog probe 准备目录 | `Local catalog preflight` | KILLED |
| M4 去掉 canonical/outside-checkout 检查 | `AC6 允许根落进仓库检出`，含 digest link 第五分支 | KILLED |
| M5 去掉目录 owner 验证 | `private worktree layers` 的 worktrees/digest owner | KILLED |
| M6 去掉目录 O_NOFOLLOW | `private worktree layers` 的 worktrees/digest symlink | KILLED |
| M7 去掉目录 ACL 准入 | `private worktree layers` 的 worktrees/digest acl | KILLED |
| M8 去掉 chmod mode 回读 | `ineffective fd chmod` | KILLED |
| M9 验证后按 pathname chmod | `fd chmod remains on the opened digest` | KILLED |

## 工作项、遗漏与收尾

#648 的三个 POSIX 验收面均有当前 head 的生产链证据；原 actor/profile/disposal 的路径与约束保留，父项 #338 不自动关闭。已比较标题检索命中的 #597（已完成 Host 根/DB/log 权限）、#644（Windows 私有创建）、#645（Windows Git/path）、#138（显式移除工作树）及 #341（越界旧上下文恢复）；各自服务不同闭环，本 PR 没有重复实现或重复建 issue 的必要。

ExecPlan 已归档且 docs 索引存在，技术/文档规模在限额内。回滚撤销本 PR 的代码即可；已收紧目录继续保持私有，不应自动放宽权限或删除用户内容。下一道门由 root 统一提交该 head 的 GitHub 评审与交付回读控制；若 head/base 变化，本结论需要重锁和复评。

## 当前 main 接合复评

2026-11-16：#650 已 rebase 合入后，本分支重放到真实 `main@28aff71baf0cb056d842f66559b47304ea9a87a0`。五个技术文件逐字等于首审头，range-diff 仅评审索引上下文变化，保留两条记录；没有生产冲突。重放后的本分支独立 `pnpm verify` 4076 passed、0 failed（契约1582、集成2268、E2E226），退出0；最终仅文档补充不改变该技术树。恢复引用为 `refs/backup/pr651-before-mmp-review-20261116` 和 `refs/backup/pr651-docs-before-rebase-20261116`。最终 push 后仍须重新读取当前 head/base、批准、Fast Gate、threads 与双向 issue 关联，再以预期 head rebase 合并。
