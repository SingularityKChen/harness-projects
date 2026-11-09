# PR #583 MMP 交付评审

评审时间：2026-11-09；最终远端回读 `2026-11-09T12:40:49Z`。结论：无新增 P0/P1，新增一项 P2，建议 `APPROVE` 并修复该项；不替代人类合并、UAT 或 R1 裁决。

## 锁定事实与范围

- PR：`fix(core): Preserve work item identity when a draft becomes an Issue`；作者 `SingularityKChen`；分支 `fix/draft-promotion`，工作树 `.worktrees/draft-promotion-20261109`。
- base：`c9bb17b833295f26c750bd8c4bf425df53e9701f`；head：`334bff7b9c4b5d1e3d4420710c98524ecc4c9ae5`。本轮未漂移；Ready、`MERGEABLE`、`UNSTABLE`，一个交付提交，`Closes #283`。
- 初始工作树干净；reviews、inline comments、GraphQL reviewThreads 均为零，线程分页 `hasNextPage=false`。仅写本记录及忽略的评审运行证据，不修改实现、不提交 review、不 commit/push。
- #283 要求经 `composeCore` / `commands` 保持 Draft 转 Issue 的工作项和执行上下文，覆盖两 storage，并更新 vertical-path 附行。已读 completed ExecPlan `docs/exec-plan/completed/2026-11-09-draft-promotion.md`、全部差异与对应契约。
- 差异共 6 文件，363 加 / 11 删；代码及测试 246 行、文档 128 行，未引入依赖、schema、UI 或 Provider 写入。

## 先行四级风险矩阵

以下矩阵在逐文件审查前建立，右列为完成全层审查后的结论。采用 Superpowers 判别验证、qian-systems-router 的系统边界/信息流，以及 first-principles-development 的因果/反例方法。

| 层 | P0 风险 | P1 风险 | P2 风险 | P3 风险 | 最终证据与判定 |
|---|---|---|---|---|---|
| 代码 | 破坏 main / 事务硬约束 | 错实体提升、占用静默覆盖、半提交 | 乱序、恢复与输入边界遗漏 | 冗余状态/复杂度 | 冲突、回滚、alias-first 已验证；一项已知身份 redacted 的永久分叉 P2 |
| 产品闭环 | 规划权威被工程轴覆盖 | 工作项/context/谱系断裂 | 遮罩恢复不连续 | 文档证据边界遗漏 | 可见转换、原生 adapter 未知身份遮罩恢复通过；合法已知身份遮罩存在 P2 |
| 架构 | 第二权威源、逆依赖 | 跨 binding 污染、多个 primary | 合法契约形状被错误排除 | 职责/命名偏离 | 现有 Core 事务拥有状态；绑定隔离、唯一 primary 归因通过；无新架构层 |
| 测试 | 不可执行证据掩盖破坏 | 仅 helper 覆盖、无持久化/回滚 | 断言缺判别力 | 重复测试/证据失真 | 68 条现有测试绿，4 项 adapter 正控制绿，2 项独立反例红，4 项变异归因 KILLED |
| 工作项 | 未授权公开/安全改变 | 宣称超出 #283 的接受 | 缺陷无独立追踪 | checklist/索引滞后 | completed 计划及 vertical-path 已对应；#283 尚未勾选，P2 无独立重复 issue |

## 全部可行动发现

**F1 · P2 · 已知 Issue 身份的 redacted 输入会永久消耗 Draft 提升证据。** 最小新增行：`packages/core/src/bootstrap.ts:333` 的 `item.content.kind === ContentKind.WorkItem` 限制。

触发：同一 binding / project / membership 的 Draft 已登记并有执行上下文；Provider 报告新 `ref.objectKind='issue'` 与确定的新 externalId，但 `content={kind:'redacted', reason:'permission_denied'}`。`packages/capabilities/src/planning-provider.ts:18-22,48-52` 允许这种形状：只有内容身份也被扣下时才必须退回 `project_item`。Fake Provider 已能产生这种合法形状。

影响：条件跳过 promotion，随后 `ensureEntity` 新建 Issue 实体并将旧 membership 改成 issue。下次恢复可见后，旧 membership 已非 draft，原 entity/context 无法再接回；原 Draft 仍 primary。两 storage 都观察到 `retainedOriginal=false`、`contextAttached=false`、`draftRole=primary`，而命令两轮均返回成功。

复现：在上述 head 的工作树根运行 `node --test .superpowers/pr583-mmp-review-20261109/known-redacted-promotion.test.mjs`；2/2 预期失败，输出见同目录 `known-redacted-promotion.log`。步骤为首轮同步 → `startWork` → `promoteDraft` 保持 membership → 仅遮罩 content 后刷新 → 恢复原 content 后再刷新 → 检查原 entity/context。复现没有改源码或用户库。

修复方向：以已确认的内容身份与稳定 membership 判定提升，不能依赖正文可见；整个过程保持 redacted 投影，不回读旧正文、不增权威源，并增加两 storage 的恢复回归。当前 GitHub adapter 在 `decode.ts:60-62` 对 REDACTED/null 会退回 `project_item`，该真实输出路径通过，因此定 P2；通用 Core 合法契约缺口仍需修复。

重复追踪：按 `draft in:title`、`redacted in:title` 查询全部状态；#283 是本能力当前 owner，未找到单独跟踪本触发条件的 issue。已关闭 #303/#349/#366 分别处理状态写、Start Work 拒绝和展示新鲜度，不是本缺陷的重复。

## 独立验证与反例

以下命令均在锁定 head 的工作树根运行；无需假定作者的全量验证等于本评审执行结果。

| 实际命令 | 真实结果与边界 |
|---|---|
| `node --test tests/integration/draft-promotion-reconcile.test.js` | 26/26；两 storage、文件 SQLite close/reopen、context/run/relations/receipt、唯一 primary、冲突及回滚 |
| `pnpm test:file tests/integration/planning-membership-reconcile.test.js tests/integration/source-number-restart.test.js tests/integration/github-projects-bootstrap.test.js tests/contract/domain-identity.test.js` | 42/42，零跳过；分页/后页错误/新轮覆盖/事务拒绝保留事实、来源编号和原生 adapter 回归 |
| `pnpm typecheck` | exit 0 |
| `node .superpowers/pr583-mmp-review-20261109/github-adapter-promotion.mjs` | 4/4 正控制：真实 adapter 配可控录制 transport，两 storage 的直接转换及 Draft→REDACTED membership→Issue，原 context 不变、无回放 miss |
| `node --test .superpowers/pr583-mmp-review-20261109/known-redacted-promotion.test.mjs` | 0/2，通过失败断言独立确认 F1；不是基础 suite 失败 |
| `git diff --check c9bb17b833295f26c750bd8c4bf425df53e9701f...HEAD` | exit 0 |

最终树整表变异命令：`node scripts/review-mutate.mjs .superpowers/pr583-mmp-review-20261109/mutations.json`。每项显式填写 `killedBy`，日志在同目录 `mutations.log`；exit 0，前后基线均绿，源码逐字节还原。

| 变异 | killedBy 归因（两 storage） | 结果 |
|---|---|---|
| M1 跳过生产 promotion | `refreshPlanning promotes the same membership` | KILLED |
| M2 忽略全局目标占用 | `occupied issue identity rejects the whole promotion round` | KILLED |
| M3 信任 foreign content binding | `mixed content ref binding cannot promote a foreign registered draft` | KILLED |
| M4 按不安全的身份列表顺序写入 | `persisted issue alias before draft primary promotes without depending on row order` | KILLED |

## 架构、交付门与产品边界

现有 bootstrap 事务统一提交身份、membership、projection、观察与游标；错误继续走原 Conflict/Unavailable 路径。没有 Provider 互调、LLM 判定、状态双写或 optimistic Saved。新增方案只在旧 membership 被覆盖前提升，并在 helper 检查全局 occupant；采用现有事务和先降级再晋升顺序，设计与闭环大小相称。所有相关失败路径和矩阵均审完，未因 F1 停止。

最终 checks：`PR Fast Gate`、Verify、Browser、CodeQL、Disclosure、size、Issue policy、Engineering state 成功。`matrix.check` 属取消的 Rule checks run `42609442736`，同 head 后继 `42609443746`、`42615563351` 成功；`Create review session` 的 `42610288411` 日志明确 HTTP 404，#364（OPEN）已有追踪，属可选自动评审端点，不替代本审查。

#283 的可见同步验收与 vertical-path 更新已有直接证据，但 F1 仍需当前 owner 处理；Issue checklist 的最终核销和正式 review 由主控执行。#71（OPEN）负责产品主动规划写入，本 PR 不转换远端 Draft；历史重复实体恢复、真实 GitHub 转换实测、安装态 UAT、Gate E1 freeze 与 Gate R1 人类接受未被本轮绿测扩大。作者声明的完整 `pnpm verify` 结果不计为本评审重跑。

评审恢复与交接：变异已还原；结束时仅本记录为未跟踪变更，忽略目录仅保存评审脚本/日志。未 commit/push 或提交 review。后续实现 owner 应先用 F1 两条红测试作 TDD，再交独立复评；head/base 改变必须重新锁定。

## Batch 2 独立修复复评（2026-11-09）

原开篇及 F1 的“仍需处理/两条反例红”结论 **Superseded by 本节：F1 ADDRESSED**。原矩阵、触发条件和红证据保留。此次 reviewer 未实现本 PR，只读审查后运行独立测试；以 `334bff7b9c4b5d1e3d4420710c98524ecc4c9ae5` 加当前未提交补丁验收，后续 commit/head 等价由主控核对。

- 修复按明确 Issue ref + 原 project/membership + 当前 binding + 唯一 primary Draft 提升；内容继续 redacted。两 Storage 全程保留原 entity/context/run/relations/receipt，遮罩期与恢复后 SQLite 重开均连续；标题/正文/sourceNumber canary 不泄漏，重复刷新幂等。未知及未见 project_item 均不造身份；绑定、占用冲突与第二写失败仍由原校验/事务拒绝。
- 复评发现 **F2 · P3（已 ADDRESSED）**：初版完全移除内容 guard 也扩大到 `issue ref + ChangeRequest content`。该组合语义非法，真实 GitHub decoder 在 `decode.ts:64-74` 关联类型且不可产出；Core 的 nativeIdentity 缺省验证未全面排除它，因此不定 P1。实现者将 gate 收敛为显式 `WorkItem || Redacted`，补两 Storage 的 `mismatched visible content` 控制，避免本修复扩大到类型不匹配输入；不引入全面 Provider 验证器。
- 最终独立命令：`pnpm test:file tests/integration/draft-promotion-reconcile.test.js tests/integration/planning-membership-reconcile.test.js tests/integration/source-number-restart.test.js tests/integration/github-projects-bootstrap.test.js tests/contract/domain-identity.test.js .superpowers/pr583-mmp-review-20261109/known-redacted-promotion.test.mjs` → **76/76、零 skip/todo**（新窄集 32、原回归 42、原独立反例 2）。最终 `github-adapter-promotion.mjs` 正控制 **4/4**；`pnpm typecheck` exit 0；`git diff --check` 干净。之前独立 boundaries 9/9，收敛不改依赖。实现者的完整 verify 不计为本 reviewer 重跑。
- 最终五项整表：`node scripts/review-mutate.mjs .superpowers/pr583-mmp-review-20261109/mutations-batch2.json`，exit 0，前后基线绿、逐字节还原；原 M1–M4 及其原 killedBy 全部再次 KILLED，M5“恢复仅 WorkItem guard”由两 Storage 的 `known redacted Issue promotes identity and keeps content hidden through recovery and reopen` 归因 KILLED。无 SURVIVED/KILLED_OTHER/NOT_APPLIED；日志为同目录 `mutations-batch2.log`。
- 最终生产+测试补丁 SHA-256（`git diff -- packages/core/src/bootstrap.ts tests/integration/draft-promotion-reconcile.test.js` 的原始 stdout）：`dbcbb660712185b6814145de7eb1c195f2ff5e464c0e1fe2a74ad4cad211a7fa`。源码文件 SHA-256：bootstrap `1e123d75c3bdfa97350e327517c1df5ade90e037df01f79d87d9d7a689ec2b78`；测试 `7ab3e8b9298480624a3330efca54ba439ac81c2eba0414155703ea68ca494cff`。

最终结论：F1/P2 与修复复评 F2/P3 均 ADDRESSED，剩余无新增 P0–P3，修复闭环可继续授权收尾。计划归档、commit/远端 head 等价、issue 核销与 rebase merge 仍由主控执行；真实 GitHub 转换、installed UAT、历史分叉库恢复与人类 R1 边界不扩大。本 reviewer 未改实现、commit/push 或写远端；保留进入复评时已有的所有源/文档改动。
