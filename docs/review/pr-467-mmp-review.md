# PR #467 MMP 交付评审

- 日期：2026-10-30；状态：独立评审完成；未发现新增 P0/P1/P2，一项文档 P3。
- Head：`47de6dfd182766a08168abb73321532af254ad8d`；base：`main@b19b4eac4f12aa40c05d75b492f3335299874641`。
- 执行上下文：`.worktrees/durable-write-intent`；本评审只写本记录，未修改产品或测试，未提交 GitHub review、commit、push 或 merge。
- 方法：Superpowers 的 verification-before-completion；Qian Systems Router 的接口/反馈综合；First Principles Development 的审计模式，从用户结果、不变量和失败机制构造反例。
- 边界：判断 #204 的耐久意图闭环；本地验证不等于实际平台创建、安装态 Host、人类 UAT 或 R1 裁决。

## 风险矩阵（先建后查）

本文件的初始矩阵在逐文件审查前已建立；以下是在同一 immutable head 上更新的结论。

| 等级 | 主要失效假设 | 检查层 | 最终结论 |
|---|---|---|---|
| P0 | 迁移损坏旧库，或 Provider 写前没有已提交意图 | 代码、产品、架构、测试、#204 验收 | 未发现。四写入口均先提交；旧 generation 和伪装 shape 两入口拒绝且全库不变。 |
| P1 | 换键、重启、租约过期或旧 owner 制造重写/错误结算 | 代码、产品、架构、测试、已有 issue | 未发现新增缺陷。未决检查先于增代/路由拒绝结算；owned 保护各次本地回填；Provider 端唯一性仍归 #421。 |
| P2 | 丢确认、ack 后本地失败或 Storage 镜像丢失恢复证据 | 代码、产品、架构、测试、#193/#458 边界 | 未发现新增缺陷。保留 Pending/Unknown 与当次 ack 句柄；未知主执行不启动 fallback；非法持久形状拒绝。 |
| P3 | 文档阶段与归档事实矛盾，增加维护误判 | 文档、ExecPlan、验收 | 一项：completed 计划页首仍声明 Active 且独立验收/组合未完成，见 F1。 |

## 锁定事实与工作项

本轮以 `git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/` 核对检出；分支为 `fix/durable-write-intent`，除本评审文件外无未提交改动。逐项读完全部 27 个变更文件及其必要消费者。

本轮再次运行 `gh pr view 467 --repo SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,mergeStateStatus,closingIssuesReferences,statusCheckRollup`：head/base 未变，Ready，`Closes #204`，`PR Fast Gate`、Verify、Merge Gate、CodeQL、规则与 issue checks 成功。`UNSTABLE` 的唯一失败为非必需 `Create review session`；本轮读取 run `41000449659` 的失败日志，原因为转发端点回答 HTTP 404，已有 #364 跟踪，不能把它记作代码失败或自动修复。

本轮 GraphQL 回读 `reviewThreads(first:100)`：零线程，`hasNextPage=false`，返回 head 与锁定 head 一致。两个 commits 分别为设计文档与实现闭环，关联同仓 #204。对锁定 base 执行 numstat：非 docs A+D=616，docs A+D=252；本评审记录另计入最终提交后的文档规模。

#204 的四项技术验收均有当前实现与本轮证据：写中能读到 Pending 且同 key 不再发写；端口、003 与 R8 指向同一 Start Work 强制点；完整请求/实际目标/owner 在副作用前持久化；未知确认不因新 key、过期或重启重置为创建许可。issue 快照中验收框仍未勾选，由实现 owner 在最终交付回读后核对，不由测试结果推断人类验收。

## 分层证据与设计判断

1. **外部调用链**：`git-provisioning.ts:185–188,219–222` 在最终 fromRef/canonical path 构造后 await 写前 hook，随后才调用 Provider；`start-work.ts:395–399` 对主/人工执行共用写前 helper。实际 Provider 输入独立复制，持久输入保存白名单和实际 binding。四入口均在 Provider 内回读行并逐字段比对，不能用事务内未提交对象冒充耐久证据。
2. **准入与 owner**：`start-work.ts:249–260` 在决定增代前扫描同 context 的 Pending/Unknown 槽位；拒绝不消费新 key、不改 context。写前、分步、Git final、run final 都使用 `owned`。未决期间的公开 takeover 改为被拒，迟到结算另以明确后继 generation fixture 验证完整快照不变；这两类证据没有混称。
3. **结果与恢复**：Git Ready 与命令终结分开，`settle` 成功仍写根 Pending；run/根收据在同一事务结算。主/人工 throw 和 ambiguous 保留 Unknown，主未知零 fallback；ack 后本地失败保留耐久 Pending，并在当次结果中带 ack 句柄。明确拒绝仍可用新 key 合法恢复，已决定的分支身份不受基线前进影响。
4. **存储/架构**：同一 `mutation_attempt` typed 当前槽位，没有新增独立日志、资源权威、重试引擎或依赖边。Fake/SQLite 共用纯形状复制与校验，getter 一次快照、clone 隔离、非法 JSON 形状和重启检查已覆盖。generation 3 直接建立未发布基线，旧 marker/伪装形状 fail closed，拒绝过程不删数据。
5. **产品和已知边界**：#193 仍负责保守阻挡后的自动对账/恢复活性；#421/#304 仍负责 Provider 端外部唯一性；#458 仍负责已有 fallback/run 结果规范化。当前实现不把这些问题宣布解决。确定 fallback 非 running ack 的旧契约有显式回归，未因本 PR 漫延成结果重构；四入口保守阻挡会降低恢复活性，但这是已记录且诚实呈现的边界。

设计恰当之处是复用现有 receipt、owned 和资源事实写者，并把写前钩子放在真实派生输入之后；没有发现需要第二账本或通用生命周期框架的证据。对全部历史收据的工作区扫描有线性成本，但本轮没有规模瓶颈证据，不将其臆定为阻塞项。

## 本轮验证

以下命令均在上述执行上下文运行，exit 0；不沿用旧会话计数。

    node --test --test-timeout=120000 tests/integration/start-work-external-intent.test.js tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-request-binding.test.js tests/integration/storage-baseline-admission.test.js tests/integration/migration-runner.test.js

结果：271/271，fail/cancelled/skipped 均 0。

    node --test --test-timeout=120000 tests/contract/storage-contract.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/start-work-step-recording.test.js tests/integration/start-work-retry-identity.test.js tests/integration/local-git-start-work-resume.test.js tests/integration/local-git-core-provisioning.test.js tests/integration/local-git-branch-probe.test.js tests/e2e/start-work.test.js tests/e2e/start-work-recovery.test.js tests/e2e/write-machine.test.js tests/e2e/delivery-lineage.test.js tests/integration/execution-relation-write-schema.test.js

结果：418/418，fail/cancelled/skipped 均 0，包含真实临时 Git argv/磁盘事实与谱系半提交回归。

    node node_modules/typescript/bin/tsc --noEmit
    node --test tests/contract/package-boundaries.test.js
    git diff --check b19b4eac4f12aa40c05d75b492f3335299874641...HEAD

结果：typecheck 无错误，boundaries 9/9，diff 检查无输出。测试合计为两组 689 项，另有 9 项边界测试；未把 runner 内部重复基线并入此计数。本轮没有重跑完整 `pnpm verify`，其 hosted Verify 证据来自当前 head 的 GitHub check。

### 正式变异表

在最终源码树整表运行一次 `node scripts/review-mutate.mjs <临时 spec.json>`，command 为 `node --test --test-timeout=120000 tests/integration/start-work-external-intent.test.js tests/integration/start-work-owner-fencing.test.js tests/contract/storage-contract.test.js`。四项均 KILLED，runner exit 0；每项有 killedBy，前/后基线绿色，按原文字节还原，结束后产品与测试无 diff。

| ID | 唯一变异 | killedBy（失败名子串） | 结果 |
|---|---|---|---|
| R467-M1 | 删除 branch 的写前 hook | `exact inputs are committed before every primary external write` | KILLED |
| R467-M2 | 同 context 未决 `.find(...)` 改为 `.find(() => false)` | `accepted createBranch with throw lost ack blocks keys and expired leases` | KILLED |
| R467-M3 | Git final 的根状态改为 Git 自身 Saved | `startRun pending storage failure fences the provider or next step` | KILLED |
| R467-M4 | 去掉 `owned` 的 generation 比较 | `live old owner held at claim cannot settle after command takeover` | KILLED |

## 发现与后续

**F1 / P3：同步已归档计划的页首阶段。** `docs/exec-plan/completed/2026-10-30-durable-write-intent.md:3` 仍写「Active，本地实现和验证完成；独立验收、组合与远端交付尚未完成」。同文 Progress、Outcomes 和末尾 Change Note 已记录独立验收、必要组合、归档，且 docs 索引已将其列为 completed。接手者只读页首会误把已完成批次当作待执行工作；根因是归档时没有更新状态摘要。将页首改为已归档及实际剩余门禁，保留真实平台/UAT/R1 未验收的限定即可，属于机械文档修复。没有发现同一问题的既有 issue。

结论：对锁定 head 建议只有 P3 的 `APPROVE`，合并仍须人类逐 PR 授权。实现 owner 已存在，F1 交由其串行收尾；本评审不自行修产品、不提交远端 review。若 head/base 改变，重新锁定并限定复评；本次记录不自动继承到新 head。

2026-10-30：Singularity-AI-Bot 正式 review `5709109628` 在锁定 head 一次性提交唯一 P3 并 APPROVE。协调者已修正页首为 Completed、保留 UAT/R1 限定并在 Decision Log 记录本会话条件授权；只改文档。待独立复评及最终 head 门禁回读后合并。

2026-10-30 文档独立复评：R467-F1 已解决；另一评审者核对批次 review编号、初始版本、分工、合并顺序、内部链接和发布面，无产品/测试差异。发现的批次措辞提前接受 #466 已改为交原owner修复复评；R1/Status 未推进。最终 head CI 与合并回读仍为独立后续门。

2026-10-30 最终真实main整合：源码head `dfbfa381d74898bd96eddd3b2979a7128ef8b9b6` 重放到已含#464与并行UI批次的 `main@52b0900906b001129464e765e8849ed84ad068c5`。仅docs索引与队列上下文冲突，双方条目完整保留；原#467 core/capabilities/storage/fake及意图测试blob逐字相同。实际完整 `pnpm verify` 为2695/2695及MVP0 7/7，boundaries9/9、workflow8文件、diff-check均通过。最终提交只是评审文档补证据；最终head/base、hosted Fast Gate、全部线程、#204双向关闭关联必须再回读后才以rebase合并，不预写未来SHA。
