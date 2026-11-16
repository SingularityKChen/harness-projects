# PR #650 MMP 交付评审

评审日期：2026-11-16。目标：投影同键替换契约；关联 #634。初始锁定 head `975df6048adf5c4917e658917d2c97ac0ec6aec4`，base `8ace55af83a21a45397c855ba03374623b5fc3ae`（`main`）。执行上下文：检出本 PR 分支的 `.worktrees/projection-replacement` 根目录。原实现会话已确认；阻塞项交回实现方，本会话按人类指令接管无阻塞项收尾。

## 风险矩阵（先建立，再逐层审查）

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 结果 |
|---|---|---|---|---|
| P0 | 合并破坏主线、损坏数据或安全硬边界 | 规划与工程混轴、秘密泄露、第二权威源 | 核对真实 diff、发布面及门禁 | 无发现：仅共享测试和自包含文档，无生产或门禁修改 |
| P1 | 异常、重入、幂等、恢复导致严重错误 | 用户任务不能完成、owner/信任边界失守 | 可复现反例、issue acceptance 缺口 | 无发现：有效父行、同键转换与完整结果均有判别证据 |
| P2 | 局部边界、误导诊断或低风险回归 | 闭环成立但接口/反馈有瑕疵 | 断言判别力、重复追踪与范围 | 无发现：旧状态/内容、revision、重复行反例均被识别 |
| P3 | 命名与小幅维护性问题 | 设计复杂度与必要性 | 文档、链接、提交与回滚 | 无发现：单用例、复用装配，未扩张为新框架或重复工作项 |

## 分层证据与结论

### 当前锁定事实

- `gh pr view 650` 及初始 GraphQL 回读一致：head `975df6048adf5c4917e658917d2c97ac0ec6aec4`，base `8ace55af83a21a45397c855ba03374623b5fc3ae`，`main`，非 draft，`MERGEABLE` / `UNSTABLE`。
- 两个提交：`bd0e34ea`（计划）、`975df604`（用例及归档）；没有 debug/fixup 提交。差异为 23 技术行和 101 文档行；没有生产文件变更。
- closing issue 为 #634，PR 明确 `Refs #201`。PR 标签为一个 `kind:test`、`area:storage`、`area:tests`、一个 `gate:R1`。review 和 inline comments API 均返回空数组；初始 GraphQL 的 reviewThreads 为空。
- 同 head 的 CI run `43820682693` 为 success，`PR Fast Gate`、Verify、Browser 均成功。Rule checks `43820682701`、Issue policy `43820682688` 被取消；对应后继 `43820684066`、`43820683976` 为 success，同 head 的 disclosure/size 均成功。
- 唯一失败为可选 `Create review session`（run `43822462588`）：独立读取失败日志，原因是本地评审端点连接被拒绝，未取得 202。它不属于分支保护必需检查，不能解释成测试失败或会话已创建。

### 系统、代码和产品闭环

评审以 audit / review-and-quality-control 为阶段：目标系统是 Storage 端口的同键投影替换，包含系统是 Host 持有的规划投影读侧。事实是生产 Fake/SQLite 均已有正确实现；本项要改变的是持久回归证据。硬约束是复用共享装配、保留状态轴正交和一份权威事实；主要不确定性是测试是否真的区分 put→replace 时保留旧字段的错误，而不是仅重复 put→put。

`tests/contract/suites/storage.js:172` 的新用例复用 `makeStorage`、`seedWorkspace`、`seedEntity`、`binding` 和 `projection`。它先登记有效 workspace/entity/binding/identity，再 put 旧投影；replace 使用同 workspace/entity 和相同 binding scope。旧 `todo`、revision 1、原标题/正文转换为 `done`、revision 2、新标题/正文。第 191 行完整 get 深比较，第 192 行 list 与单元素数组深比较，覆盖新记录所有字段以及唯一结果行。

这是一条独立行为转换，不与既有第 149 行 put→put 或第 156 行空集合收敛重复。共享 foundation 装配在 `storage-contract.test.js` 的 Fake 与 SQLite 上各执行一次；没有第二套 assembly、直接 SQL 断言、实现镜像、count guard 或配额。SQLite 实现使用原子作用域收敛后 upsert；Fake 同次队列变更内收敛并 upsert。测试无异步悬挂或外部 Provider 写入，未改变接口、schema、凭据和数据路径。包依赖与七条系统不变量保持原状。

设计恰当：一个公开端口回归就闭合 #634；保留完整记录比较可识别以后出现的字段遗漏，单元素 list 比较同时保护读取内容与行数。未发现需要新增生产抽象、扩大 E2E 或重构的证据；没有以测试通过宣称 Host 产品验收或 R1 接受。

### 独立验证与反例

全部命令在上文执行上下文运行，结论仅对应上述 immutable head。先读 `scripts/review-mutate.mjs` 文件头及 `tests/contract/fixtures/review-mutate-self.json`，再用仓库框架执行完整变异表；没有手写临时变异器。spec 位于本工作树忽略的 `.superpowers/review-650/mutations.json`，运行态文件不进入正式文档。

| 命令 | 实测结果 |
|---|---|
| `pnpm test:file tests/contract/storage-contract.test.js` | exit 0；280 passed、0 failed；新用例在两个 adapter 各出现一次 |
| `pnpm test:file tests/contract/content-placement.test.js` | exit 0；5 passed、0 failed |
| `node scripts/review-mutate.mjs .superpowers/review-650/mutations.json` | exit 0；7/7 KILLED；变异前与逐字还原后的完整基线均绿 |
| `node scripts/rule-checks.mjs disclosure 8ace55af83a21a45397c855ba03374623b5fc3ae` | exit 0；范围内新增行和各提交扫描通过；PR 正文另以读取内容人工核对 |
| `node scripts/rule-checks.mjs size 8ace55af83a21a45397c855ba03374623b5fc3ae` | exit 0；代码 23/1000，文档 101/1500 |
| `git diff --check 8ace55af83a21a45397c855ba03374623b5fc3ae...975df6048adf5c4917e658917d2c97ac0ec6aec4` | exit 0 |

本次最终树完整变异结果如下。每项均显式给出 `killedBy`，分别匹配 Fake / SQLite 新用例全名；不是把编译失败或无关红测试计为判别成功。

| 变异 | 故障机制 | 结果与归因 |
|---|---|---|
| F-planningStatus | Fake replace 保留原 planningStatus | KILLED；只有新增 Fake 用例失败 |
| S-planningStatus | SQLite replace 保留原 planningStatus | KILLED；只有新增 SQLite 用例失败 |
| F-content | Fake replace 保留原 content | KILLED；只有新增 Fake 用例失败 |
| S-content | SQLite replace 保留原 content | KILLED；只有新增 SQLite 用例失败 |
| F-revision | Fake replace 保留原 revision | KILLED；新增 Fake 用例及既有参数 workspace 用例失败 |
| S-revision | SQLite replace 保留原 revision | KILLED；新增 SQLite 用例及既有参数 workspace 用例失败 |
| F-append-duplicate | Fake replace 同键追加而不覆盖 | KILLED；新增 Fake 用例失败，另有既有拒绝原子性、参数 workspace 和排队快照用例失败 |

旧 status/content 的四项变异只杀死新增相应 adapter 用例，直接证明这两项是本 PR 补上的回归缺口。revision 与重复行也由新用例识别，但并不声称它们此前完全无覆盖。所有变异由框架按原字节恢复；结束后 `git status --short` 仅有本评审文档未追踪，产品和测试树无残留修改。SQLite 唯一键不允许第二行；Fake 的追加错误由公开端口可观察结果识别，不引入实现专属 count 断言。

### 工作项、遗漏与发布面

#634 的三个验收逐项成立：同键旧投影经 put→replace 后完整读回新记录；旧状态、旧内容任一残留会失败且列表恰好一行；指定完整 Storage 契约在实现 head 实测通过。ExecPlan 包含目标、取舍、批次、验证、Progress、发现、决定、恢复与回滚，并位于 completed 且更新索引。它只关闭本叶子，未替父 #201、安装产品或 R1 做接受判断。

独立搜索全状态 projection replacement 相关 issue 并核对 #201、#424、#425、#426：#201 明确将剩余 put→replace 状态/内容证据分配给 #634，已完成兄弟项保护拒绝原子性、控制事实和事务生命周期；#273 属于 Core 状态政策。没有发现本 PR 新建重复工作项、借叶子关闭父项或把已交付约束重做的问题。#634 验收 checkbox 当时未勾选属于 owner 的交付收尾动作，不改变已取得的行为证据。

人工逐项核对差异、提交信息、分支名与 PR 正文的凭据、本机路径与身份、账号个人信息、内部系统、保密字样，未发现新增泄露。本报告引用路径为仓库相对路径。未修改任何 Planning Status 或 native blocking 关系。

## 评审结论与下一道门

P0/P1/P2/P3 均无可验证缺陷；对锁定 head 的 MMP 叶子闭环建议 `APPROVE`，无需 inline comments。完整变异不是固定配额，不增补无区分价值的测试。若后续收录本报告而改变 head，应由交付 owner 重新核对该 head 的必要门禁、双向 issue 关联和全部 review threads，再按授权收尾；不得沿用本报告断言新 head 已过 CI。回滚为撤销新增测试与文档；不存在 schema 或用户数据回滚。未经人类逐 PR 授权不得合并。
