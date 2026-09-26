# tests/integration

跨包集成测试：可以有临时数据库与临时 Git 仓库，但仍然**不触网**。归入 Merge Gate。

## 第一批用例

以下用例是本层的第一批，按优先级排列（2026-09-26：SQLite v1 栈落地了 1、2、3、4、6；5 属于本地 Git 工作树 provider，随 #160 落地）：

1. `migration from empty` —— 空目录建立 Schema，约束与唯一索引生效（`migration-runner`、`identity-membership-schema`、`execution-relation-write-schema`）；
2. `restart restore` —— 进程重启后身份、关系与执行上下文不丢失（`storage-restart`：关句柄后重开同一文件）；
3. `event dedupe` —— 同一条 Provider 事件处理 N 次与处理 1 次结果相同（`storage-sync-surface`）；
4. `mutation idempotency` —— 重复提交同一外部写入不产生第二个外部对象（`storage-restart` 的写尝试幂等覆盖；Start Work 的同键重放见下文）；
5. `worktree lifecycle` —— 工作树创建、重复创建拦截、脏工作区拒绝清理（未落地，随 #160）；
6. `rollback on failed transaction` —— 事务失败后不留下半写状态（`storage-restart`、`storage-sync-surface`）。

## Start Work 恢复（#183 / #184 / #165）

两个文件在离线替身上组装 core，跑完整的 `startWork` 补偿序列（不触网）：

| 文件 | 用例 | 保护的不变量 |
|---|---|---|
| `start-work-step-recording.test.js` | 分支步成功后立刻回填 | 步骤结果分步落盘：「分支已建好」在**工作树步之前**就写进执行上下文记录 |
| | 基线前进后重放 | 重放**跳过**已完成的分支步、不重新解析 `fromRef`，复用既有分支 |
| | 接管的头提交 | 复用不是静默的：被接管分支的头提交出现在结果面 |
| | 退化工作项 id | `workItemId: '---'` 被结构化拒绝，不塌成共享的 `work/work-item` |
| | 重放不得改变已决定的分支身份 | 序列一旦决定了身份，本次请求就不得改写它：声明另一个分支名是**矛盾**（结构化失败），不是新输入 |
| | 不去猜 | 记录里没有 `branchExternalId` 时，即使同名分支已存在也必须**重走分支步**——不得用「名字像」推断所有权 |
| | 重放省略 `branchName` | 第三步（启动执行）也用**已决定**的分支身份：run command 不得回落到本次请求的默认名 |
| `start-work-retry-identity.test.js` | 换新幂等键重试 | 可清除的失败之后，同一个上下文能被做完（`Failed` 不再永久锁死） |
| | 接管保留步骤字段 | 接管用 `{...existing, ...}`；重建记录会让「跳过分支步」失效——与同一文件的 `branchStepCalls === 0` 互为契约 |
| | 同 key 不重新尝试 | 幂等键重放优先：同 key 返回那一次的报告，**换新 key 才是重试** |
| | 在途仍被拒 | `Provisioning` 且租约未过期时不接管——接管只针对终态 |
| | 一条 `has_worktree` | 恢复路径只写一条关系，且 `to` **精确等于**按 `(workspaceId, repositoryId, workItemId)` 算出的身份 |
| | 身份只有一处派生 | 写入与投影必须派生出**同一个**身份：复刻真实 provider 的「句柄是规范化路径」形态后，读一次谱系不得多一条 confirmed 关系 |
| | 身份不随路径变化 | 路径是属性不是身份：改 `worktreePath` 重试仍然只有一个工作树实体 |
| | 身份的作用域是仓库 | 作用域是 `(workspaceId, repositoryId, workItemId)` 而**不是 binding**：把仓库读能力置为不可用，两侧仍然一致（binding 的解析有多个来源，两个 key 可以独立不可用） |
| | 两个仓库上的两份工作树 | 同一工作项在同一 binding 的两个仓库上各有一份工作树，是两个实体而不是一个 |

**替身边界的如实说明**：这两组用例用的是离线 Development 替身（外加一处最小的 `createBranch` 覆写，用来复刻真实 provider「同名分支指向别处」的拒绝语义），**不是**真实临时仓库。真实仓库上的同一条链路归 #141（被 #137 / #120 阻塞）。

## 约定

- 每个用例使用独立的临时目录/临时数据库，测试之间不共享状态。
- 断言要说明它在保护哪条不变量，而不是说明它调用了哪个函数。
- 外部依赖（GitHub、Actions、Harness）一律使用 Fake Provider 或录制的 fixture。
