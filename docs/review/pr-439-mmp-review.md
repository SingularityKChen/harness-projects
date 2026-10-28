# PR #439 MMP 交付评审

观察日期：2026-10-28（Asia/Singapore）。状态：当前 immutable head 的独立评审完成；无 P0/P1，一项 P2 文档引用待修正。建议事件：APPROVE；本文件不代表 GitHub review 已提交或 R1 获批。

## 锁定事实与控制

- base：`main@88d21ae6e0f0afb1f18afc776f54efac3ff4723a`；head：`cce5fb48262ff66e8b9e3ae09e7bd8d8ad7b2f6b`；分支：`fix/pull-request-identity-convergence`。
- 执行上下文：检出 `fix/pull-request-identity-convergence` 的 `.worktrees/pull-request-identity-convergence` 根目录。范围：原生 PR 身份：双入口/双顺序/双存储、重放与隔离。
- 事实：当前 ready、可合并；关联 issue #367；所有 review/thread 已读取，均为空且无后续页。CI 结果按当前 head 单独回读。
- 硬约束：保持规划/工程轴正交、Host 权威、Provider ack/reconcile、全局身份与工作区成员分离、既定依赖边。局部测试通过不能代替 MMP 产品闭环。
- 方法：Superpowers 独立子评审；qian-systems-router 的接口/反馈与综合判断；first-principles-development 的事实、约束、反例与最小判别验证。
- 已有实现 owner：会话「规划迭代优先级与并行交付」。P0/P1 交该 owner，评审方不并行修改产品代码；P2/P3 按本次人类授权由评审方负责收尾。
- 人类直接指令覆盖 PR #438–#440：无阻塞时修复、独立复评、归档、整理提交、核对 issue 后执行 rebase merge；有 P0/P1 时 REQUEST_CHANGES 且不合并。

## 预建风险矩阵

以下为逐文件审查之前建立的风险假设，不能当作已发现缺陷。

| 层 | P0：main/硬约束破坏 | P1：交付阻塞 | P2：可修复非阻塞 | P3：局部改进 |
|---|---|---|---|---|
| 代码/反例 | 数据丢失、越权写入、不可恢复事务 | 错 issuer/身份、迟到覆盖、失败伪成功、越界清理 | 边缘错误诊断、无害冗余 | 命名/局部可读性 |
| 产品闭环 | 工程状态篡改规划权威 | 用户入口到权威回读/投影断裂；证据误归当前版本 | 恢复提示/限制表述欠清楚 | 文案与呈现 |
| 架构/设计 | 第二权威源、secret 入业务库 | 违反依赖、身份/工作区隔离、持久化原子性 | 可避免的耦合/超范围设计 | 局部简化 |
| 测试 | 发布门禁绕过且无证据 | 主张未被判别测试覆盖、失败/并发路径失守 | 已有行为的覆盖薄点 | 重复断言/命名 |
| issue/验收 | 无授权改变规划关系/发布边界 | scope/acceptance 未闭环却关闭；已有跟踪与本次归属混淆 | 索引/验收清单遗漏 | 说明精简 |

## 分层证据与反例

### 事实、约束与设计判断

目标是让同一真实 PR 在 Planning 项目条目和 Development 分支谱系之间保持一个 ChangeRequest，使成员、检查锚点与 produced_by 端点可追溯。包含系统仍是 Planning 唯一权威、工程事实独立的交付工作台。首要风险是“局部节点相等，但持久身份、失败事务或消费者在后续轮次分叉”。

逐文件审查覆盖全部 17 个变更文件；核心链为两个 decoder → `ProviderNativeIdentity` → `identity.ts` → Planning/Delivery 各自事务 → 工作区投影与谱系读取。事实与推断分开：两个真实 decoder 契约给出同 namespace/opaque ID；四组合 Core 用例用不同 binding/implementationKey 验证消费行为。该组合支持本 issue 的软件契约，不等同于真实平台全链 UAT。

设计采用 provider 明确声明、单一纯 ID resolver、既有 ExternalIdentity 自然键与原 Delivery 事务，没有第二身份表、跨层 Provider 调用、账号驱动的身份推断或历史实体合并。namespace 与对象种类协议由适配器负责；当前 github.com 支持面明确。按当前范围，这个设计和维护代价恰当，无需引入迁移或额外 registry。

### 分层矩阵结果

| 层 | 实际证据与反例 | 裁定 |
|---|---|---|
| 代码正常/失败/恢复 | 两存储 × 两顺序、SQLite close/reopen、native→absent、非法声明、显式冲突、读后写前身份争用、写后抛错回滚及重试；另外两存储真实命令并发 Planning/Lineage 均收敛 | 未发现 P0/P1 |
| 产品闭环 | membership/projection、PR 节点、produced_by candidate、check anchor 同实体；Lineage 不改 Planning 投影/状态/业务 revision；查询零 Provider 写入；重放实体/身份/revision 不增长 | #367 的 Core 闭环满足；R1/真实宿主 UAT 独立 |
| 架构/所有权 | native ID 不含工作区/账号；相同 ID 不同 namespace、不同 opaque ID、元组边界、无声明不误合；两工作区身份共享、成员与投影隔离；事务再验 exact identity | 保持七条不变量与既有依赖方向 |
| 测试判别力 | 本次 130 项聚焦、6 项独立探针、类型检查、9 项边界通过；5 项归因变异均 KILLED，夹具基线与还原后基线均绿 | 与主张直接对应，无“仅绿即验收”推断 |
| issue/交付物 | #367 三项 AC 可分别映射到四组合、零业务 revision 重放、release-gates 第 3 行；17 文件均在既定模块；ExecPlan 已 completed、索引正确；门禁行遗留 active 路径 | 一项 P2，见候选 inline |

共享实体的消费者也已检查：`queries.ts` 规划列表/详情继续暴露全局 primary，Lineage-first 时其 binding 可为 Development，跨工作区时可来自先观察的工作区。独立探针用不同 adapter externalId 验证该现状，列表/详情仍返回 ChangeRequest；当前 PR 条目没有规划写入/Start Work 动作，没有证明当前可观察交付失败，故不升格为缺陷。将来若增加按当前 Planning binding 的外部动作，需要按工作区挂载选择可用身份，不可直接把全局 primary 当作该动作路由。

### 本次命令与结果

命令均在本文件所述 worktree 根执行；运行态探针/spec 在 `.superpowers/pr-439-mmp-review/`，不进入交付物。

- `node --test --test-timeout=120000 tests/integration/pull-request-identity-convergence.test.js tests/contract/development-github-contract.test.js tests/contract/planning-github-projects-contract.test.js tests/integration/github-development-lineage.test.js`：130/130，exit 0。
- `node --test --test-timeout=120000 .superpowers/pr-439-mmp-review/probe.test.mjs`：6/6，exit 0。两存储分别验证 Planning/Lineage 同时开始、不同 adapter externalId 的同 native 收敛、明确 namespace 变化保持已接受成员/投影/revision。
- 并发探针初版误用了原 fixture 的“读取前后 Planning 不变”顺序断言，2/6 红；并发 Planning 本来就会增加 projection/revision。改为直接并发调用 `refreshDeliveryFacts` 并检查最终身份、集合与唯一 primary 后 6/6 绿。此处是探针前提订正，不是产品 RED→GREEN。
- `node scripts/review-mutate.mjs .superpowers/pr-439-mmp-review/mutations.json`：exit 0，5/5 KILLED；基线与每项还原后基线均绿，未手写变异 runner。
- `node node_modules/typescript/bin/tsc --noEmit`：exit 0。
- `node --test tests/contract/package-boundaries.test.js`：9/9，exit 0。
- `git diff --check 88d21ae6e0f0afb1f18afc776f54efac3ff4723a...HEAD`：exit 0。
- 旧独立候选 `8dc2f77d6dc5bcdb388cdf1a2219cd9c1969b9fd` 与本次 HEAD 的端点对比（`git diff --name-only <candidate> HEAD -- packages tests`）为空，支持“归档只改文档”的源码边界；本次结论仍由当前 head 的独立运行支撑。

| 变异 | 破坏的机制 | `killedBy` 与实际归因 |
|---|---|---|
| M1-native-namespace | ID 解析去掉 namespace | `AC367 separates namespace`；Fake/SQLite 各一条失败 |
| M2-native-binding-fallback | 有 native 仍按 binding 身份 | `AC367 native PR converges`；两存储 × 两顺序四条失败 |
| M3-forget-development-exact | 声明缺省时不用持久 exact identity | `AC367 native PR converges`；四组合在 native→absent 重放失败 |
| M4-drop-transaction-revalidation | 不在 Delivery 事务登记/复验 exact identity | `AC367 revalidates Development identity inside the Delivery transaction`；两存储竞争用例均失败，同时缺省重放/身份回滚也失败 |
| M5-always-business-revision | Planning 每轮恒推进 revision | `AC367 native PR converges`；四组合重放失败 |

### issue 验收、同类工作项与证据边界

- AC1：`AC367 native PR converges` 四组合通过，真实 GitHub 两 decoder 的 namespace/node ID 契约通过；CR 持久实体只有一条，不产生第二 WorkItem。
- AC2：四组合在重开后重复两入口两轮，实体/身份/Planning 投影/业务 revision 原样；M3/M5 分别证明身份持久锚点和修订号断言可识别回归。
- AC3：`release-gates.md` §2.1.1 第 3 行已引用新测试并限定为本项证据；证据回链存在 P2 路径错误，修正不涉及产品代码。
- 已检索提供的全部 open issues：#367 精确拥有本问题；#283 是 Draft→Issue 提升，明确排除；#190 是数据库 exactly-one-primary，不能把本 PR 的生命周期保证写成该数据库约束已交付；#337 是同集合重复成员语义，#424 是既有身份/成员约束矩阵，#426 是过期事务句柄与测试注册，均无需在本 PR 扩写；#72/#143 的完整 UI/真实宿主路径和人类验收不因这里的测试自动关闭。
- 最终 metadata 快照内 required PR Fast Gate、CI Verify、Merge Gate、size/disclosure 均成功；`Create review session` 失败与 engineering reconcile 取消仍需主评审按手册逐项回读和解释。本子评审未冒称自己重新执行 hosted CI 或完整 `pnpm verify`。
- 未覆盖真实 GitHub 现场、GHES/new namespace 接入、历史双实体迁移、旧库首读无声明后再补 native 的自动收敛；后者按当前显式设计冲突拒绝，不静默迁移。并发证据为同 Storage 队列上的两个 Core 命令及事务前竞争注入，没有声称跨进程双 SQLite 句柄压力测试。

### 候选 inline 意见

F1（P2），新增行 `docs/architecture/release-gates.md:103`：**请将验收证据回链改为归档后的 ExecPlan 路径**。本 PR 把计划放在 `docs/exec-plan/completed/2026-10-28-pull-request-identity-convergence.md`，但此行仍指向 `active/`。读者从 R1 验收矩阵追溯变异命令与执行上下文时无法到达证据；本次文件存在性检查为 active=false、completed=true。按 AGENTS §3/§4 的归档与自包含要求，只需把这里的目录改为 `completed/`，保留当前证据范围。

## 结论与下一道门

当前 head `cce5fb48262ff66e8b9e3ae09e7bd8d8ad7b2f6b`：无已证实 P0/P1，一项 P2 归档路径错误。建议一次性 review 事件 **APPROVE**，列出上述 F1；由主评审按已有人类授权修正并独立复核。这里只记录发现，不 commit/push、不修改产品/原测试/ExecPlan、不提交 GitHub 意见。

下一道门：F1 修正后核对门禁行与 completed 文件、回锁最终 head/base 与 checks/threads，并按仓库授权收尾。任何产品源码/head 变化使当前运行证据需要重新匹配；不得把本项软件契约证据提升为 R1 或规划所有者验收。

## 协调者综合与发布回读

2026-10-28 +08，`gh-review` actor Singularity-AI-Bot 对本仓 PR #439 / head `cce5fb48262ff66e8b9e3ae09e7bd8d8ad7b2f6b` 提交 `APPROVE` review `5681134434`；初次所有 inline 均随这一份 review 一次提交。幂等标识为 `mmp-review-20261028:439:cce5fb48262f:initial`。P0/P1 均无新增；唯一 P2 为已归档计划的 active 回链，后续修复复评见本记录。

协调者重算三 PR 合并树 `14ccba46db29ccc81ebfac55f183533ebf31ca72`，与 `test/iteration9-independent-integration@b300535b418683e9910ac372b3ccc40f75467fb5` 的 apps/packages/tests/scripts/workflows 及配置 blob 一致（清单 SHA-256 `8a81e2f22c6cb4652eb37e37ca57074c7f8fbbae559be65f131cabe01cb19638`）。在该命名集成检出运行 `pnpm verify`：类型检查、2442/2442 主测试、7/7 MVP 通过，执行后检出仍 clean。这是本地并集证据，不能替代单 PR CI、官方安装件真人路径或 R1。

初评当前 head 的必需 PR Fast Gate、CI Verify、Merge Gate、规模与披露检查均成功。#439/#440 的可选 Create review session 日志分别为 run 40661235450 / 40661250684，已确认本地 loopback 服务连接拒绝；分支保护 API 当前 strict=true，仅要求 PR Fast Gate。最终 push 后仍执行当前 head/base/checks、issue 双向关联与 threads 回读。


## F1 文档修正的独立复评（2026-10-28）

初评 head 与矩阵保留原状；此段将 F1 状态更新为 **ADDRESSED**。主评审回报已一次性提交 GitHub review `5681134434`，事件为 **APPROVE**、仅列 F1/P2；本子评审没有修改 GitHub。

独立读回确认：`docs/architecture/release-gates.md:103` 的本次修改仅将计划路径从 `active/` 改为 `completed/`；`docs/exec-plan/completed/2026-10-28-pull-request-identity-convergence.md` 是实际存在的文件，门禁行已无旧 active 引用。原 completed 计划的 Bottom Change Note 只追加本轮路径订正与评审记录指向，没有改写产品证据或扩大验收主张。评审记录完整保留最初风险矩阵、发现、130/6/9 项独立验证与五项变异的归因及限制。

在同一 worktree 根执行：

- `git diff cce5fb48262ff66e8b9e3ae09e7bd8d8ad7b2f6b -- docs/architecture/release-gates.md docs/exec-plan/completed/2026-10-28-pull-request-identity-convergence.md`：仅上述两个文档修改。
- `git diff --name-only cce5fb48262ff66e8b9e3ae09e7bd8d8ad7b2f6b -- packages tests apps scripts package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json .github`：输出为空、exit 0；产品、原测试及相关配置与初评 head 无差异。
- completed 目标存在性与第 103 行读回：completed=true、旧 active=false，当前行只引用 completed。
- `git diff --check cce5fb48262ff66e8b9e3ae09e7bd8d8ad7b2f6b`：exit 0。HEAD 仍为初评 `cce5fb48262ff66e8b9e3ae09e7bd8d8ad7b2f6b`，修正尚在工作树。

复评 **PASS**，F1 **ADDRESSED**，无新增 P0/P1/P2/P3；维持 **APPROVE** 建议。本轮只涉及文档，未重复全量测试；原源码验证仍适用。最终提交/push 后的 head/base、checks、关闭引用与 review thread 回读由主评审继续，不提升为 R1 或真实平台 UAT 结论。
