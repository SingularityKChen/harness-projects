# PR #677 MMP 交付评审（#632 Storage 装配契约）

> 状态：初审完成（APPROVE，1 项非阻塞 P2）；日期：2026-11-24；独立评审者仅修改本记录，不修改实现或外部状态。

## Purpose / Big Picture

判断 #677 是否把 Core Storage 注入收敛为一个真实、可回归、可回滚的装配闭环；评审覆盖实现、产品路径、架构、测试和 #632 验收，不以通过测试替代 R1/UAT。

## Context and Orientation

- 观察时刻：2026-11-24T09:04:41Z；PR #677；base `main@c24d149151964c2fe8ef0d120a9facab3c65b356`；head `e930178e9acfd1ef03abde1edbaf2c815623d6f4`；`MERGEABLE`、`UNSTABLE`、ready。复算：`gh pr view 677 -R SingularityKChen/harness-projects --json baseRefName,baseRefOid,headRefOid,mergeable,mergeStateStatus,isDraft,commits,closingIssuesReferences`。
- 执行检出：`.worktrees/iteration12-storage-assembly`，分支 `refactor/storage-assembly-20261124`；开始时工作树干净；初始 8 个 commits。评审以 immutable head 与 base 为准。
- GitHub 当前无 review、inline comment 或 review thread；关联关闭仅 #632，父项 #224 保持开放；#632 原始五条 acceptance 尚未勾选。
- 当前 CI：`PR Fast Gate`、Verify、Browser、Windows Native、CodeQL、size、disclosure 通过；唯一红项 `Create review session` 的失败步骤为转发本地 DSH 端点，日志实测返回 HTTP 404；按 `docs/review/mvp-review.md` §5 为非必需检查。复算：`gh pr checks 677 -R SingularityKChen/harness-projects`。
- 实现计划：`docs/exec-plan/completed/2026-11-24-storage-assembly-contract.md`；现有记录的旧验收保留在本文件末尾并标为历史证据。

## Design / Spec

先建立下表，再逐文件审查（2026-11-24）。这是调查风险，不预先定级为缺陷。

| 层 | P0 候选 | P1 候选 | P2 候选 | P3 候选 | 最小判别证据 |
|---|---|---|---|---|---|
| 代码 | 装配合并后使 main 无法启动 | 选错 Storage；ack 前发布；事务拒绝后半挂载；重开库使用旧句柄 | 不可用返回或竞争输入退化 | 无效导出、冗余 helper | 生产 diff、注册失败矩阵、竞争/缺失输入与 reopen 测试 |
| 产品闭环 | 真实 Host 全部不可用 | Host 读写脱离唯一权威库；规划/工程或 Saved 语义混淆 | 启动/安装恢复路径缺证据 | Host 注释过时 | Host composition → workspace setup → SQLite/baseline 回读 |
| 架构 | 新反向依赖或第二权威源 | storage 通过两个入口继续进入、身份/权限旁路 | 契约或外部 ABI 误述 | 类型哨兵承担运行态职责、公开死符号 | 全部消费者检索、package boundaries、状态拥有与类型出口 |
| 测试 | 构建/套件无法执行 | 迁移静默换实例；断言下降；失败路径未判别 | 变异误归因、命令证据不符当前 head | helper 重复、统计口径漂移 | 全 diff 对照、窄测试、必要 review-mutate 与还原 |
| 工作项 | 无法独立合并/回滚 | #632 acceptance 或 scope 未闭环 | 当前/历史结论冲突、PR/计划不一致 | 提交碎片、重复 issue 跟踪 | #632/#224、ExecPlan、规模、当前 checks/threads |

## Global Constraints

只写 `docs/review/pr-677-mmp-review.md`；不改代码、commit、push 或 GitHub review。保留已有历史证据，不把旧 head 结论当当前结论；不改规划 Status/依赖关系。所有命令在上述 immutable 检出运行；Git 使用 argv；变异只能通过仓库脚本且逐字节还原。

## Plan of Work

1. 锁事实与风险矩阵（本记录）；读取完整 diff、真实消费者及关键失败路径。
2. 运行有判别力的 focused tests 与 package boundaries；只有新风险才扩大；必要变异使用 `scripts/review-mutate.mjs`。
3. 一次返回全部 findings、精确 diff 行与 inline 文案；根评审统一提交外部评审。

## Validation and Acceptance

在上述 head 检出根目录运行：`pnpm typecheck`（期望 exit 0）、`pnpm run boundaries`（期望 10/10），以及 `pnpm test:file tests/integration/core-storage-assembly.test.js tests/integration/provider-binding-registration.test.js tests/integration/harness-plugin-host-roundtrip.test.js tests/integration/execution-run-refresh.test.js`（期望全部 pass）。完整结果只在 Outcomes 记录。判据是所有风险获得代码或运行态证据，缺口明确为未接受范围；不得凭旧日志宣称新测试通过。

## Progress

- [x] 2026-11-24：锁定当前 head/base/checks/threads、#632 验收与已有实现计划，先建立 P0–P3 全矩阵。
- [x] 2026-11-24：全量生产/测试 diff 与消费者审查，核对事务确认、不可用、权限、恢复、Host 和边界；focused 328/328、typecheck、boundaries 10/10 通过。
- [x] 2026-11-24：完成变异验证与全部矩阵，返回一项 P2；未提交 GitHub review。

## Surprises & Discoveries

1. 历史远端缺实现的交付门已被当前 head/readback 取代；旧 P1 不再成立。
2. F1 恢复「表内为空时回退 direct」后，328 个 focused cases 仍全绿（SURVIVED）；当前生产实现正确，但退役入口的测试没有覆盖 direct-only 输入。
3. 独立 AST 扫描计 193 个直接以 composeCore/createContext 命名的调用；唯一对象字面量 direct storage 是新判别文件 :25 的刻意游离键。与作者 191/194 的历史统计口径不同；判断依赖完整 diff 与唯一 direct 站点，不依赖计数。
4. #675 在 planning-refresh-scheduler.test.js 仅追加 vm import 和两条 reconciler-only 用例；#677 修改 setup 的 storage 搬运，未共享修改同一函数，自动组合语义一致。跨 PR 并集由根评审验证。

## Decision Log

- 2026-11-24，独立评审：选择审查真实 Storage 选择、注册事务与 Host 组装链作为主风险路径；理由是本 PR 的生产行为只改变 Storage 入口，47 个 JS 测试迁移不受 tsc 保护。
- 2026-11-24，组合复核：撤回历史验收的 P3-5。`:324` 所述空数据根在 `workspace === undefined` 时走 `unavailableCore`，不调用 `composeCore`；无注释缺陷、apps 清理或新 issue。

## Idempotence and Recovery

只读命令可重复。文档可恢复到 head 版本；任何变异必须由仓库脚本恢复并核对源文件字节，不保留临时实现变更。head/base 改变后重锁事实并重审受影响结论。

## Interfaces and Dependencies

依赖 GitHub CLI 只读权限、Node/pnpm、Core/capabilities/Fake/SQLite 与真实 Host 装配。未修改 schema、安装 ABI 或 Provider ack 行为的声称要以 diff 与调用链验证。

## Outcomes & Retrospective

当前初审结论：P0=0、P1=0、P2=1、P3=0（历史验收项不重复计入）。依据 `docs/review/mvp-review.md`，建议 APPROVE；先补这一低成本判别再做修复独立复评。未观察到生产正确性、安全、七条不变量或跨包边界缺陷。

### 初审完整 findings

| ID | 等级 / diff 锚点 | 缺陷、影响、证据与修复 |
|---|---|---|
| F1 | P2；`tests/integration/core-storage-assembly.test.js:36–40` | 缺失用例只传 `providers: {}`；竞争用例又始终存在表内 storage。把选择式改为 `deps.providers.storage ?? (deps as { storage?: Storage }).storage`，即可恢复退役 direct-only 装配而 328 个 focused cases 全绿。扩展现有缺失用例：表内无 storage 且顶层带 stray 时仍 unavailable，并断言 stray 零写入；无需新增测试文件或生产行为。 |

Inline-ready：**[P2] Cover direct-only input in the retired-entry guard** — The missing-storage case never supplies a top-level storage, while the competing-input case always supplies table storage. Replacing the selector with `deps.providers.storage ?? (deps as { storage?: Storage }).storage` survives all 328 focused cases, so restoring the retired direct-only assembly path would leave this guard green. Extend this existing case with a stray top-level instance, assert the same unavailable result and no writes to that instance, and require that fallback mutation to be killed. The current production selector is correct; this is a non-blocking regression-test gap for #632's sole-entry contract.

### 分层证据与 acceptance

| 层 / #632 AC | 当前判断 |
|---|---|
| 代码 / AC2–3 | `context.ts:158` 把表内实例捕获为本地常量，后续事务/读游标/runtimeAccess/返回 context 共享它；`collectBindings` 把 storage 排除在外部挂载外；`await storage.transaction` 后才发布 runtime registry。失败注入覆盖后序挂载拒绝、快照抛错、同 id 异实现、ack 暂停与重试；没有移除这些断言。 |
| 产品 / AC3–4 | 真实 Host 仅一个生产 composeCore 调用，表内 SQLite 与 setup、baseline、直接读库 id 一致；新用例证明空根→本地创建→重组→持久化读取。Planning/工程、权限与 Provider ack/Saved 路径无行为改动。 |
| 架构 / AC1–3 | 已读唯一生产消费者、Fake standalone/test 组合、全部 47 个迁移文件；原顶层 storage 值均移到表内最后覆写，世界对象 helper 重新读取 live storage，未发现换实例或漏迁。无新增实现依赖；10 个 boundaries 通过。移除 direct type 是本次有意公共装配面变更，未改变实际 Host wire。 |
| 安装 / 恢复 / AC3、5 | `apps/` diff 为零，SQLite schema/migrations/package 配置无 diff；无需数据迁移。当前 head 的重开 SQLite 及双句柄案例通过。未运行安装产品/UAT，不以源树证据代替该层接受。 |
| 测试 / AC4–5 | 现有断言仅增加；选中表/竞争输入、缺失输入、Host、ack/拒绝、权限/身份、恢复均有可观察结果。F1 指出的 direct-only 负对照在初审时缺失，现已补齐（修复复评见文末）；M1/M2/M5/E1 现有变异按输出击穿，类型变异 M3/M4 exit 2，未把类型诊断伪装为 named-test 归因。 |
| 工作项 / AC1、5 | 首个 commit 先提交消费者/备选契约计划，再改实现；#632 是独立叶子。首审曾据 #224 历史 Remaining 文字推定“仍有 #633 的交付 hop 字段范围”；**Superseded by 本轮独立修复复评（2026-11-24）**：GitHub 回读 #633 已于 2026-11-21 由 #667 关闭，#224 当前仍 OPEN；本 PR 保持 Refs #224，只核销 #632，不自动作父项验收结论或新增重复 issue。#632 五条 AC 可在修复复评后由根 owner 根据证据核销。当前 8 commits 需要按已授权收尾整理；整分支回滚完整，Batch 4 单独 revert 会使新增契约测试红，已有计划明确合法组合回滚。 |

### 当前评审实跑证据

| 命令 / 实验（上述 head 检出根） | 观察结果 |
|---|---|
| Validation 中 focused 命令，另加 `draft-promotion-reconcile.test.js`、`start-work-request-binding.test.js`、`runtime-planning-access.test.js` | tests 328 / pass 328 / fail 0 / skipped 0 |
| `pnpm typecheck`；`pnpm run boundaries` | exit 0；tests 10 / pass 10 / fail 0 |
| `node scripts/review-mutate.mjs .superpowers/iteration12/632/storage-assembly-mutants.json` | M1/M2/M5 按预期 named tests RED；M3/M4 为 tsc exit 2；SUMMARY 全 KILLED。原 spec M3/M4/M5 未声明 killedBy，故自动归因仅认 M1/M2，M5 由输出人工复核为 5 条 SQLite 谱系用例，不声称脚本验证归因。 |
| `node scripts/review-mutate.mjs .superpowers/iteration12/632/p31-mutant.json` | E1 KILLED，归因到 reopen 正控；基线与还原基线绿。 |
| F1：通过内存管道向 `review-mutate.mjs` 传 JSON；command 为 focused 7 文件，file=`packages/core/src/context.ts`，anchor=`  const storage = deps.providers.storage`，replacement=`  const storage = deps.providers.storage ?? (deps as { storage?: Storage }).storage`，killedBy=`表内没有 storage 时结构化不可用` | GREEN exit 0、failing=[]、SURVIVED；脚本总 exit 1（期望的存活报告）。基线/还原后 328/328，逐字节还原；复算可按这组完整 spec 字段创建运行态 spec 再跑仓库脚本。 |
| `git diff --quiet c24d1491...HEAD -- apps/`；`git diff --check c24d1491...HEAD` | 两者 exit 0；Host 未改。 |
| `node scripts/rule-checks.mjs size c24d1491`；`node scripts/rule-checks.mjs disclosure c24d1491` | head 已提交树代码 411/1000、文档 308/1500；disclosure 通过。此计数不含本评审未提交文档，最终由 owner 重算；PR body 五类目人工检查无敏感命中。 |
| `gh run view 45359415516 -R SingularityKChen/harness-projects --log-failed` | 可选 review-session 本地端点 HTTP 404；`PR Fast Gate` 成功；此项不阻止评审/合并。 |

本轮未重跑全量 `pnpm verify`/browser/Windows；当前 head hosted Verify、Browser、Windows Native 与 Fast Gate 均通过，根评审负责组合后的全量验证。R1、人类接受、真实 Host 安装态及平台资格仍是独立门，不构成本 PR 新增缺陷或 #224 可关闭的证据。所有实现文件在变异后恢复，仅本记录有工作树 diff。下方保留旧验收用于历史追溯。


## Bottom Change Note

- 2026-11-24：以当前 immutable head 新建完整 MMP 评审结构并先登记风险矩阵；保留旧独立验收记录，标明其 head 与交付门已经过时。
- 2026-11-24：完成全矩阵初审与 328 focused cases、类型/边界/变异验证；记录 F1 direct-only 负对照缺口、inline 文案、#632/#224 范围与未接受产品层；不改实现或外部状态。

---

# PR #677 独立验收处置记录（#632 Storage 装配契约）

> 本记录整理一次**独立 agent 对抗验收**的结论与处置，不等于人类评审，也不等于 R1/UAT 或产品接受；规划 Status、合并与 issue 关闭仍由人类伙伴决定。

## 锁定事实

> Superseded by 本文件当前 MMP 评审的 `Context and Orientation` 与 `Outcomes & Retrospective`（2026-11-24）。以下是旧 head 的历史验收记录，不代表当前评审结论。

- 日期：2026-11-24（Asia/Singapore）。
- PR：#677（draft）；base：`main` / `c24d149151964c2fe8ef0d120a9facab3c65b356`；验收对象 head：`0b7ea897c3a26fb6e363ade53ed9995c32981f33`（本地实现 head；按实测 `git rev-parse HEAD`）。
- 执行上下文：`.worktrees/iteration12-storage-assembly`，分支 `refactor/storage-assembly-20261124`；验收开始时工作树干净。
- 独立性：验收者为独立 agent（非实现者、非 PR 作者），只读验收、未改 tracked 文件；完整对抗报告与运行态证据在 `.superpowers/iteration12/632/verification-1.md`（被 .gitignore 忽略，不进入公开文档）。本记录由验收负责人按验收发现做最小处置后整理。
- 规模与范围：`origin/main...0b7ea897` 53 文件 = 生产 2 + 迁移 47 + 测试新增 1 + 测试改动 1 + 文档 2；`apps/` 零 diff。

## 风险矩阵

| 等级 | 结论 | 处置 |
|---|---|---|
| P0 | 无 | — |
| P1 | P1-1：验收时刻（2026-11-24）远端 head 为 `b1ce84b`，PR 仍只含 Batch 1 文档提交，现有 checks/PR body 不覆盖实现 head | 交付门，由 Lead 执行 fast-forward push、更新 PR 描述（completed 路径 + 真实证据 + 风险/回滚）、按 V13 回读后 `gh pr ready`；不在本记录处置范围 |
| P2 | 无 | — |
| P3 | 初始验收有 P3-1…P3-5 五项；P3-5 随后的上下文复核已判为误报并标记 superseded | 见下表 |

### P3 处置

| 编号 | 发现 | 处置 | 证据 |
|---|---|---|---|
| P3-1 | ExecPlan S11/R5 称「真实陷阱」，但无测试判别：验收期 E1 反向变异（deps 改回创建时快照）全绿 SURVIVED | 选**补正控用例**（不降级表述）：`tests/integration/execution-run-refresh.test.js` 新增 1 条「sqlite: reopen 后重新组装读到新 storage 句柄…」，断言 reopen 后重新组装的 `storage` 为新句柄并能读到既有执行事实；不改既有断言、不扩生产行为。理由：成本 +9 行、可回归 R5；降级只会留下无法判别的声明。同一 E1 变异现 KILLED，V14 固化 | 11/11 绿；E1 KILLED 归因到新增用例；S14/D12 |
| P3-2 | `@ts-expect-error` 可被 `@ts-ignore` 或删除接口绕过，计划却称硬保证 | 只改措辞、不改实现：`packages/core/src/context.ts` 注释与 ExecPlan S9/D3/剩余风险改为「编译期哨兵而非不可绕过机制；指令原样存续由评审把关」；M3/M4 仍证明指令在时可失败 | S15/D13 |
| P3-3 | 新判别文件的非法多余 `storage` 键依赖 tests 不受 tsc | 刻意设计：退役入口的运行时护栏；在测试文件注释与本记录说明，若未来 tests 纳入 tsc 应改用具名类型断言/`as` 断言保住运行时形状，不删护栏 | D14 |
| P3-4 | 5 行 `depsOf` 在 7 个文件重复（md5 相同） | 计划 R3 已显式取舍（文件内局部 helper，不建共享 helper）；当前无缺陷，不修；若未来再迁移 world 形文件再评估抽 helper（需权衡 #632 范围） | D14 |
| P3-5 | **历史误报，已 Superseded（2026-11-24）**：先前仅按 `providers` 对象构造推断 `:324` 注释过时 | 上下文复核确认注释限定「空数据根」；当 `workspace === undefined` 时不会调用 `composeCore`，故不是缺陷、债务或新 issue。`apps/` 零 diff 约束保持 | 本轮上下文复核，见当前 disposition |

## 处置期间的改动

- 测试：`tests/integration/execution-run-refresh.test.js` +9 行（1 条 R5 正控用例 + 说明）；`tests/integration/core-storage-assembly.test.js` 仅补注释（P3-3）。
- 注释：`packages/core/src/context.ts` 编译期哨兵说明（P3-2）；无生产行为变更。
- 文档：本计划 Global Constraints/Progress/Surprises/Decision Log/Validation/Outcomes/Bottom Change Note 回填；新增本记录。
- 未改：`apps/`、`packages/capabilities`、历史文档、既有断言；未写 issue/PR/Project 字段；未 push。

## 最终验证（处置后树，工作树根执行）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0、无输出 |
| `node --test --test-timeout=120000 tests/integration/core-storage-assembly.test.js tests/integration/execution-run-refresh.test.js` | tests 13 / pass 13 / fail 0 |
| `node --test --test-timeout=120000 tests/integration/execution-run-refresh.test.js` | tests 11 / pass 11 / fail 0（既有 10 + 正控 1） |
| `node scripts/review-mutate.mjs .superpowers/iteration12/632/p31-mutant.json` | E1（deps 改回创建时快照）KILLED，失败名含新增正控；施加前/还原后基线均绿、逐字节还原 |
| `node scripts/review-mutate.mjs .superpowers/iteration12/632/storage-assembly-mutants.json` | M1–M5 全部 KILLED、exit 0 |
| `node scripts/rule-checks.mjs size origin/main` | exit 0（技术/文档分桶均在仓库与计划预算内） |
| `node scripts/rule-checks.mjs disclosure origin/main` | exit 0（机械扫描通过） |
| `git diff --check origin/main...HEAD` | 无输出 |
| `git diff --quiet origin/main...HEAD -- apps/` | exit 0（apps/ 零 diff 保持） |

独立对抗验收已在实现 head 复现 V1–V12、三层测试、browser 与 boundaries（见 `.superpowers/iteration12/632/verification-1.md`）；本记录只重跑处置受影响面与三项规则检查，未重复全矩阵。

## 残余风险

- P1-1：验收时刻远端 PR 仍未包含实现；push/PR 描述/ready 由 Lead 执行，完成前不能按 #632 闭环评审或合并。
- P3-2：编译期哨兵可被指令改写绕过，防回退依赖评审；M3/M4 只证明指令在时的失败。
- P3-3：`tests/` 不受 tsc 保护；未来纳入时需按注释改断言写法。
- P3-4：7 份 `depsOf` 副本仍可能漂移（JS 无类型保护）；按 R3 接受。
- P3-5：历史判断已 **Superseded（2026-11-24）**。`workspace === undefined` 时走 `unavailableCore` 且不调用 `composeCore`，该注释准确描述空数据根分支；没有剩余 Host 注释清理项。
- 本记录是独立 agent 工程验收，不等于人类评审、R1/UAT 或产品接受；合并/关闭资格由人类判定。

## 结论

实现 head 无 P0/P2 代码缺陷；P3-5 的历史判断经上下文复核撤回，其余 P3 按上表处置或登记。处置只新增测试、注释与文档，无生产行为变更。处置后树可 push、可请求人类评审；完成 P1-1（push + PR body + V13 回读 + ready）后本 PR 达到可评审状态，但不表示批准或合并。


2026-11-24 本轮 P2 F1 修复处置（根会话授权 owner；review `6036636080`；HEAD `e930178e9acfd1ef03abde1edbaf2c815623d6f4` 上的未提交修复）：扩展现有缺失 storage 用例，保留空表原输入，新增有效 workspace + 空表 + 顶层 stray 输入；两形态都断言 createContext 缺席、查询 degraded/stale、命令 not_supported，并比较 stray 全量状态及提交读栅栏不变。生产、Host、类型和接口未改动，无新增用例/兼容入口。F1 fallback 变异修复前独立复现 SURVIVED（exit 1）；修复后由同一缺失用例精确 KILLED（exit 0），脚本逐字节还原，随后 focused 2/2、零 skip 与 diff check 通过。可复现 spec 与命令已内联 Completed ExecPlan 的 Design / Spec；计划已补设计、Progress、S16、D15 直接授权和 Outcomes，独立修复复评与最终发布仍待根协调方完成。本轮未 commit/push/外部写入；全量组合验证与当前远端回读由根协调方负责，未将本测试护栏结果扩大为 R1/UAT 或真实安装态接受。


2026-11-24 F1 修复独立复评（原首审者、非修复作者；检出 `refactor/storage-assembly-20261124`，HEAD `e930178e9acfd1ef03abde1edbaf2c815623d6f4` 上的未提交修复）：PASS，原 P2 F1 已闭环，无新增 P0–P3。现有纯缺失输入及断言保留，新增 direct-only 输入具备有效 workspace，故 fallback 变异会真的选中 stray、写入工作区并返回 context；失败不可能归因于 workspace 形状错误。独立运行计划内联 F1 spec 一次，RED exit 1、唯一失败名“表内没有 storage 时结构化不可用”、SUMMARY KILLED、脚本 exit 0；施加前及还原后基线均 2/2。`exportFakeStorageState` 使用 structuredClone，完整状态对比不是可变别名；提交读栅栏对照进一步证明未产生已提交写入，足以覆盖本次 sole-entry 行为，无需增加方法调用镜像断言。`git diff --quiet HEAD -- packages apps` exit 0，唯一测试 diff 是该文件，公共类型、生产选择式、Host 与 schema 均未改；13 个计划章节齐全，修复前 SURVIVED/修复后 KILLED、执行者与最终发布待执行边界准确；`git diff --check` 通过。未重复 328 既有用例或全量验证，交根协调方完成组合/最终发布头门禁。另已按 GitHub 当前状态在原表格订正 #633 范围：该 issue 于 2026-11-21 经 #667 关闭，不能继续用它证明 #224 有未交付叶子；#224 保持 Refs，父项验收由根协调方单独核对。


2026-11-24 组合验证：四 PR 的原始产品/测试差异在 `test/mmp-674-677-combined` 基于 `c24d1491` 合成，完整 `pnpm verify` exit0：contract1625 pass、integration2366 pass/28 skip、E2E226 pass。随后加入本轮 F1 测试修复，现有存储装配用例2/2、零skip；生产字节不变，未重复完整套件。最终组合 tree `671c1c9f9cf9db7dcd857cdbe72b9f9450d4c342`；合并完成后对 apps/packages/tests/scripts/workflows 等产品 blob 与该树比对，有差异回到验证门。

## 当前上下文复核与父项交接（2026-11-24）

先前 P3-5 把空数据根注释与新 Storage 契约作了错误比较，现明确 superseded：`assemble` 在 `workspace === undefined` 时令 `table = {}`；`:324` 的注释只描述此空根路径；`:325` 选择 `unavailableCore('工作区尚未创建')`，不会调用 `composeCore` 或把 `providers` 交给 Core。非空 workspace 才进入 `composeCore({ ..., providers, diagnostics })`。因此无注释缺陷、后续清理、额外 issue 或 Host 代码变更；`apps/` 零 diff 仍是本 PR 的范围约束。

父项 #224 的两个命名技术叶子中，#633 已由 #667 于 2026-11-21 关闭；#632 仍 OPEN，等待本 PR #677 实际合并后回读核销。父项在 #677 落地与 #632 状态确认前保持 OPEN；root 协调方负责合并后的 issue 更新与父项关闭回读。该技术关闭不代表 R1、UAT 或产品接受。
