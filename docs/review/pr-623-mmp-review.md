# PR #623 MMP 交付评审

## 锁定事实

2026-11-12 首审：base `main@29947425ba0174fe83c73f2ee8df3e29ea12429d`，head `dbf2b04fb29f11a169720a466047ee0e7f581ccf`。Ready、MERGEABLE，首审前全部 review/comment/thread 为空，当次 PR Fast Gate 成功。`gh pr view 623 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,statusCheckRollup,closingIssuesReferences` 可重算。评审账号 Singularity-AI-Bot，开发/回复/合并账号 SingularityKChen。

先建覆盖 P0–P3 的风险矩阵，再由独立 Storage 与产品审查交叉验证（gpt-6.1-sol，high）。

## 风险矩阵

| 级别 | 检查的失败路径 | 首审结论 |
|---|---|---|
| P0 | 旧库被误接纳或改写，当前库不可打开，事务/凭据硬约束破坏 | 无新增发现 |
| P1 | 跨主体版本串扰，去重/乱序/恢复失效，webhook 身份守卫丢失 | 当前实现正确，无新增发现 |
| P2 | 替代旧 view 后关键隔离行为失去判别证据，范围/恢复处置误导 | R623-20261112-1：跨 kind 后续旧观察拒绝缺口 |
| P3 | 冗余兼容层、无消费者投影、文档与测试维护负担 | 无新增发现 |

## 分层证据与首审

- 代码/架构：准入独属 migrate；generation 4 及伪装 generation 5 的旧 view 无损拒绝。metadata/policy、事务队列、失败释放句柄、append-only 原始观察账本保留。
- 当前消费者：三维主体 MAX(updated_at) 派生承接 runtime；退役未消费的完整快照 view，保留实际 webhook subscription reader 与账号身份守卫，无第二事实源。
- 产品：拒绝信息与公开 demo 的停机、备份核对、新 profile/位置重建和匹配 artifact 回滚一致；不修改、迁移、降世代或删除用户库。
- 工作项/设计：#415/#416 共享 schema 与旧 fixture 生命周期，一个完整回滚单元合理；#417/#595/#596 仍承担物理单基线，manifest 仍 1–7。#223/#413、安装态接受及 R1 不因本 PR 完成。
- 反例：现有跨 kind 用例只覆盖 issue V3 → draft V2 均接受。移除 GROUP BY 的 object_kind 后套件仍通过，但后续 draft V1 被错误追加；临时端口反例确认期望 [true,true,false]、变异 [true,true,true]。这是证据缺口，当前生产 SQL 正确。

全部意见一次性提交 review `5867569123`：无 P0/P1，按本次流程 APPROVE，仅一条 P2 inline（SQL 第 103 行）。不把首审批准当作后续新 head 的批准。

## 实际验证

以下在 `.worktrees/source-version-contract`、检出上述首审 head 运行：

`pnpm test:file tests/integration/storage-sync-surface.test.js tests/integration/storage-baseline-admission.test.js tests/contract/storage-contract.test.js tests/integration/storage-connector-account.test.js tests/integration/storage-restart.test.js tests/integration/migration-runner.test.js tests/integration/harness-plugin-migrations.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/sync-revision-freshness.test.js`：528 passed，0 failed。命令已与首审实际 argv 逐项核对。

五项负控确认 MAX、binding 分组、webhook guard 与坏 committed guard 有效；kind 分组缺口通过临时最小端口反例定位。最终交付测试的完整变异表随修复复评记录，不把临时反例当作永久保障。

可选 Create review session 失败日志确认 HTTP 404，既有 #364 追踪；取消的 Rule checks/Issue policy 均有同 head 后继成功。未重跑完整 verify、安装人验或 R1。

## 修复复评与收尾门

按 R623-20261112-1 只在现有共享跨 kind 用例补更旧 draft/new dedupeKey 的 false 断言，生产 SQL 无需改动。另一位实施者只增加一行端口断言；原 Storage reviewer 独立复评 APPROVE。修复后三个 tracked 文件 278 passed，独立重跑 storage-contract 260 passed；生产源码相对首审 head 无差异、diff 检查通过。GitHub 首审编号 F623-1 对应本记录 R623-20261112-1，与 2026-11-11 的同名 P3 区分。

最终测试树的变异整表仅重测一次，命令为 `node scripts/review-mutate.mjs .superpowers/mmp-623-review-20261112/repair-final-mutations.json`，仅运行 storage-sync-surface、storage-connector-account、storage-contract 三个 tracked 文件，无临时反例依赖：

| 变异 | killedBy（行为用例） | 结果 |
|---|---|---|
| MAX → MIN | 观察定序 v1 → v3 → v2 | KILLED |
| 去掉 kind 分组 | 同 external_id 的 issue/draft 各自版本序列 | KILLED |
| 去掉 binding 分组 | 两个绑定观察同一内容互不影响 | KILLED |
| 删除 webhook 身份 guard | webhook-only 事实阻止补绑、重开仍拒绝 | KILLED |
| 删除坏 committed guard | 当前账本损坏拒绝且零追加 | KILLED |

整表 exit 0，源码还原后基线通过。新断言约束端口行为，不镜像 SQL/私有函数。评审文档经独立复核，已核正首审命令清单、发现编号作用域；发布前 backup refs 已建立。

本次人类直接条件授权覆盖 #623/#625；满足无 P0/P1、独立复评及当前 head 门后，只以 expected-head rebase 合并。先 #623，再接合真实 main 的 #625；只处理索引冲突并保留双方。最终 push 后重锁 head/base、diff/checks、全部 threads、双向 issue 关联与当前批准。Planning Status、父项与 R1 保持各自接受权。

回滚须整体撤回 Storage 合同；generation 5 数据使用匹配 binary/备份，不提供降代兼容。恢复 ref 与精确 lease 保护发布前版本。最终结果用 `gh pr view 623 -R SingularityKChen/harness-projects --json state,headRefOid,baseRefName,mergeCommit` 与 #415/#416 回读，不预写未来 merge SHA。
