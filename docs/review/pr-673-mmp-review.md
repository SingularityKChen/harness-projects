# PR #673 MMP 交付评审

## 锁定事实

- 日期：2026-11-22。
- PR：#673；base：`main` / `f74a3b8b211f674247d330a7f9fc6afa0b397155`；评审 head：`120423b1924be68bfb06d2735e38cb052c555c75`。
- 执行上下文：`.worktrees/restart-reconciliation`；初始仅有本评审文档未跟踪。评审仅写此文档与临时探针；受控变异由标准脚本逐字节还原；未提交、推送或执行外部写入。
- 证据：当前 PR / #191 / diff / reviews / comments 快照；reviews 与 comments 均为空。快照中 `PR Fast Gate`、Verify、Browser、Windows Native 成功；可选 `Create review session` 失败、一次 Engineering reconcile 取消，另有同名后继成功；最终远端回读由协调者负责。
- 方法：先检查预建 P0–P3 矩阵，再读 diff；使用 Superpowers 的根因调查与验证、Qian 的系统边界/反馈分析、First Principles 的结果/约束/最小反例分析。
- 范围：同 key `unknown` Git intent 的对账与续跑。跨 key 接管、既有硬崩溃 `pending`、自然键 head 校验和真实平台端到端不足，分别列为既有边界，不冒充本 PR 新增缺陷。AI Lead 的工程决定不视为人类 R1 接受。

## 风险矩阵

| 等级 | 代码 / 反例 | 产品与 issue 验收 | 架构 / 事实所有权 | 测试与设计成本 | 本轮结论 |
|---|---|---|---|---|---|
| P0 | 越界删除、破坏 main、fail-open | 不可恢复损失 | 安全硬约束 | 关键门禁 | 未发现 |
| P1 | 重复写、丢失耐久恢复身份、拒绝后锁死 | 同表单恢复无法收敛 | Host 事实、Provider ack/reconcile、owner | SQLite 重开与真实磁盘反例 | 发现 2 项 |
| P2 | 局部失败语义与证据误述 | #191 关闭边界与后续责任 | 工程决定不能代替人类 gate | 覆盖与跟踪真实性 | 发现 1 项文档问题 |
| P3 | 命名、冗余与维护 | 当前交付面文字 | 事实时效 | 文档整理 | 发现 1 项过期记录 |

## 分层审查与验证

- 代码：逐项核对正常/失败、adopted/absent/conflict/inconclusive、同 key/跨 key、unknown/pending、精确请求指纹、路由 binding、owner generation、采样行双检、Provider ack 与本地结算。现有在途/旧代际/并发推进负控能阻挡陈旧采样；未发现新增依赖、schema、凭据或规划状态写入。
- 产品与架构：`Saved` 仍等待供应与执行结算；读失败保留 unknown 与实际错误码；对账读可推进 runtimeAccess/`sync_cursor`，所以“零写入”仅能指零契约事实写入。两项 P1 均处于新增的采样证据进入认领事务之后。
- 设计：复用既有 claim、读门与 WriteLedger，没有必要新增 resolution 列、port 或恢复扫描器；主要缺口是耐久信息在边界上的生命周期，修复不需要再建第二事实源。单独的 absent 路径也会读旧 canonical path、随后重新 preflight 到新默认 path，属于 F1 同一输入丢失机制，不重复立项。
- 工作项：#191 唯一关闭条件是 core 写路径“restart always re-runs reconciliation first”；本 PR 的代码证据只证明受限的同 key unknown Git 子集。2026-11-22 回读 #193 与 #421 均为 CLOSED，分别覆盖执行步骤恢复与外部 run 唯一性，不能把未跟踪的 Git pending/跨 key 余项默认归给这两个已关闭工作项。未新建重复 issue。
- 规模：技术增删 494 行，文档 325 行，位于仓库与本计划上限内。

### 当前 head 实跑

| 命令 / 对象 | 结果 |
|---|---|
| `pnpm test:file tests/integration/start-work-step-recording.test.js tests/integration/start-work-external-intent.test.js tests/integration/start-work-request-binding.test.js tests/integration/local-git-core-provisioning.test.js` | 109/109，fail 0 |
| `pnpm test:file tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-retry-identity.test.js tests/integration/start-work-execution-uniqueness.test.js tests/e2e/start-work-recovery.test.js` | 97/97，fail 0 |
| `pnpm run typecheck` | exit 0 |
| `pnpm run boundaries` | 10/10，fail 0 |
| 临时 Fake 探针：absent 原路径、写门拒绝、adopted claim 中断 | 三种反例均复现；见 F1/F2 |
| 临时 SQLite 探针：分支/工作树的写门拒绝，关库重开；adopted claim 中断，关库重开 | 3/3 反例按预期失败；拒绝后均 `failed`；中断后两份工作树仍报 `saved` |
| 临时真实 Git + SQLite 探针：adopted claim 中断、关库重开、新 canonical 默认 | 按预期失败：第二次 create 被 Git 以分支已检出拒绝，`failed/invalid_input`，原磁盘工作树仍在 |

以上两批覆盖计划 V2/V3/V4 的全部 206 条用例；不是完整仓库 `pnpm verify` 或人类 R1 验收。临时探针的红态是缺陷证据，不算现有测试失败。

### 最终变异表

使用 `node scripts/review-mutate.mjs <review-spec.json>`，命令为 `node --test --test-name-pattern=同 key|负控 tests/integration/start-work-step-recording.test.js`。整表仅在本最终树运行一次；脚本基线与还原后基线均绿、exit 0，字节还原通过；最终 Git 状态仅本评审文档未跟踪。

| 变异 | killedBy | 结果 |
|---|---|---|
| R673-M1 删除 adopted 分支身份写回 | 外部已建同名分支时采纳 | KILLED |
| R673-M2 不跳过已采纳工作树创建 | 工作树已落盘但 ack 丢失时采纳 | KILLED |
| R673-M3 将确定 not_found 留作 inconclusive | 工作树确定不存在时重发一次并收敛 | KILLED |
| R673-M4 删除 intent/current ownerGeneration 比较 | 旧代际的同 key 重放不得探测 | KILLED |
| R673-M5 将两处精确采样行比较放宽为任意未决行 | 对账采样后同 key 未决行被别的写者推进时不得采纳 | KILLED |

## 一次性交付 findings

### F1 · P1 · 在覆盖旧槽位时保留被采纳工作树的耐久身份

- 新增行锚点：`packages/core/src/start-work.ts:461-463`（最小代码行 463）；相关写入 `459-460`、`477-481`。
- 触发：工作树 A 已落盘但 ack 丢失 → unknown；同 key 对账 adopted → claim 提交之后、步骤回填之前中断；重开同一 SQLite；provider 的默认 canonical 目标改为 B；同 key 重试。
- 根因：claim 用 `createWriteLedger.record(beginWrite)` 覆盖并清空原 externalIntent，只给分支写回耐久身份；被采纳工作树路径只留在 `Claim.adopted` 的进程内值。此时 context 尚无 worktreeExternalId。重启后 `safeResume` 看见 pending 且无未决 intent，重新派生 B 并再次 create。
- 证据：Fake + 真实 SQLite 关库重开得到 `pending / hasIntent=false`，随后工作树 `[A,B]`、create=2、结果 `saved`。真实 Git + SQLite 相同窗口中 create=2，第二次被“分支已被另一份工作树检出”拒绝，结果 `failed/invalid_input`，A 仍在磁盘。
- 影响：允许同分支多工作树的 Provider 会生成第二份外部对象；本地 Git 则把本来已经可采纳的工作树变成恢复失败。计划第 259 行“不会产生第二份外部对象”被证伪。这是本 PR 新增的“消费 unknown 后丢掉身份”窗口，不是已明确排除的旧 pending 硬崩溃残留。
- 修复方向：消费/覆盖旧意图与保存精确恢复身份必须处于同一个耐久事务；在步骤回填前也要能从库中恢复 A。absent 续跑也应携带并复用已对账的精确输入；补 claim 后真实重启与默认路径变动的判别测试。
- 重复 issue：#191 本身；#193/#421 是执行域恢复，不覆盖此 Git 目标丢失，勿另开重复修复项。

### F2 · P1 · 不要让临时续跑写门拒绝终结仍未决的 intent

- 新增行锚点：`packages/core/src/start-work.ts:438`。
- 触发：createBranch 或 createWorktree 第一次在写前抛错 → unknown；恢复时读能力可用并得到 absent，但 worktree.create 写权限临时为 read_only；随后恢复权限、关库重开并同 key 或新 key 重试。
- 根因：新增 sampled 放行跳过 unresolved observe，落入原有 `!route.ok` 分支：根 state 写成 failed、context 代际推进，但 externalIntent 仍为 unknown/旧代际。后续 `unknownGitIntent` 只接受根 unknown，因此不再对账；跨 key 的 pendingClaim 又因未决 intent 永久阻挡。
- 证据：Fake 与 SQLite 均复现；SQLite 的两种 operation 关库重开后都为 `root=failed / slot=unknown`；读探针=1，外部调用始终=1；同 key 与新 key 都只回放 failed/permission_denied，恢复权限也不收敛。
- 影响：一次临时写权限或能力拒绝把本 PR 承诺的可恢复命令永久锁死，当前命令入口无恢复路径；这一已落库状态不能靠再次提交恢复。
- 修复方向：写门拒绝时保留原可对账行与 owner，或在同一事务中诚实结算已证明的旧步骤再拒绝新步骤；不能留下 failed 根状态与 unknown 旧 intent 的组合。补 read-allowed/write-denied→权限恢复→SQLite 重开的判别测试。
- 重复 issue：属于 #191 的新增失败路由，不属于 pending 历史边界或 #193/#421。

### F3 · P2 · 更正 #191 关闭范围与裁定来源

- 新增行锚点：`docs/exec-plan/completed/2026-11-21-restart-reconciliation.md:288`。
- 问题：“跨 key 由 §2 R1 裁定排除”把现有保守阻挡契约、AI Lead 的工程范围选择与人类 R1 裁定混在一起。上游 #191 原关闭条件没有同 key/unknown/Git 子集限定，计划同时承认 pending、跨 key 与一般 Planning 不覆盖。协调者已查明原始人类要求是授权 AI 调研后自行决定，并无逐项 Q1–Q5 人类接受。
- 修复方向：如实记录工程选择的 actor/依据；将当前 PASS 限定为已验证子集，并由工作项所有者核对 #191 的关闭/剩余跟踪。跨 key 和 pending 的既有风险不要求本 PR 强行扩代码，但不得借 R1 或已关闭 #193/#421 宣称余项被接受或已有责任人。无需重复创建现有 issue。

### F4 · P3 · 清理已过期的 PR 描述回填遗留

- 新增行锚点：`docs/exec-plan/completed/2026-11-21-restart-reconciliation.md:318`。
- 问题：当前 PR 快照已含 completed 路径、最终验证摘要与“未创建 follow-up”；该段仍用现在时称描述是 draft 占位、active 路径 404。第 193、253 行也有同类过期状态。
- 修复方向：记为已补齐并标明快照日期，保留历史事件时使用过去时，避免接手者重复处理已完成工作。

## 结论与收尾

`REQUEST_CHANGES` 建议：2 项 P1 必须先修复并在新 head 独立复评；F3/F4 是不扩大实现范围的证据整理。现有 206 条测试、10 条边界和 5 个定向变异通过，不能抵消新增持久恢复反例。测试通过不等于产品或 R1 人类接受；评审者未改变规划状态，也未执行外部发布或合并。


## 候选复审 · 2026-11-22（历史：F1 未关闭，已被第二轮取代）

复评起点 `611ae33ac9b5a3e35d49c65d781f152a6d37dc5d`，base `4907adaaae126a8063ba62b1110b6afcd97db74b`；后续 `3a23053e91b0b8146ce174ffeda96e8d814be6c4` 的两生产 blob 相同。复评者使用独立临时 fixture，并在固定提交的隔离检出重现；没有修改实现或既有测试。

- F2 已技术关闭：临时写门拒绝保留 unknown、attempt/context/owner；恢复权限、SQLite 重开后同 key 收敛。原七个反例通过。
- F1 的原认领中断与分支成功回填已修，但**普通失败仍会丢掉 A 的最后耐久引用**：同 key 对账 adopted A → claim 保存 A 并消费旧 intent → 后续 preflight 临时 unavailable 或 listBranches 临时 permission_denied → gitFailure 带 undefined，经 settle/saveContext 清掉 A → 根 failed、无 intent；恢复能力、SQLite 关库重开、新 key、默认 B 后出现 A/B 两份并 Saved。两个分支均复现，属于同一 F1 生命周期问题，不能归给历史无未决行的 R-D。
- 新增锚点：`start-work.ts:500`；失败链为 `git-provisioning.ts:200/203` → `start-work.ts:571` → `:783/787`（均指候选版本）。修复须覆盖普通失败，不只覆盖进程中断；不能为保住定位信息而提前伪造 Ready/Saved 或关系。
- 完整候选矩阵：相关套件 212/212、typecheck exit 0、boundaries 10/10；额外四项探针两绿两红，两红即上述 F1。隔离检出的两条普通失败回归也为红，排除了并行变异影响。没有其他独立技术 finding。

完整补充已由评审账号写回原 F1 线程（reply `4656334202`）。当前 REQUEST_CHANGES 保持；此段是候选反馈，不代替最终发布 head/base/checks 与 issue 关闭范围核对。


## 第二轮独立复评 · 2026-11-22（候选技术通过）

锁定 head `140baef5b246b1c423c6cf101678cefee30ce2f4`，base `4907adaaae126a8063ba62b1110b6afcd97db74b`，隔离检出 `.worktrees/review-673-candidate`。生产 blob：`start-work.ts` = `70cae3d493643103b3a86d84f617569fd73b9a1f`，`git-provisioning.ts` = `9163e6b121ceb6d57044eb0b2b9abd9678ec0dda`。复评者未修改生产代码或测试，检出前后干净且 head 一致。

- **F1/F2 技术关闭**：认领事务与后续普通失败均保留精确 A；临时写门拒绝不结算仍未决的槽位，恢复能力后可继续。上轮两个 SQLite 红探针已转绿，真实 Git 回归通过。
- 普通预检/分支读取失败时保持 Failed、`confirmed=false`、无 run、无新增 `has_worktree` 或 delivery worktree hop；保留 locator 不伪造成功。原 key 保持失败收据；SQLite 重开、新 key 显式恢复、默认目标改 B 后仍只有 A，最终只有一条关系。
- 相关核心恢复套件 **215/215**，额外失败契约 **343/343**，独立恢复探针与观察面 **13/13**；typecheck exit 0，boundaries **10/10**，diff-check 通过。代码/产品/架构/测试全矩阵未发现剩余 P0–P3 技术 finding；没有新增 schema、port 或第二事实源。
- 当前是锁定候选的技术结论；最终批准仍须核对发布 head/base、生产 blob、全部 review threads、issue 关联和同 head checks。若生产 blob 改变须重新复核。
- 本轮“无新增技术 finding”限于上述恢复与失败后的初始查询；未覆盖后续显式 refresh。新增刷新语义及并发提交残余以第三轮复评为准，不将第二轮结论扩展为所有观察路径均通过。
- 工作项边界保持 **Refs #191，issue OPEN**：原有 pending 硬崩溃、跨 key 接管旧未知槽、一般 Planning 写与完整 Host/真实平台闭环未在此证明。不得把 AI 工程选择或本轮测试当成人类 R1 接受。


## 第三轮独立复评 · 2026-11-22（1 P2 + 1 P3 待修）

候选 `fc7d28bd1e524217ac4c786900decf568d2c7022` 与仅重建消息后的 `daaef0059b2be86a6b4acb378cd843d22d1bd0b2` 完整 tree 同为 `29c7cc805e53adb7299578cf0ba297b0be5343d1`。隔离检出 `.worktrees/review-673-candidate` 干净，未修改实现。F1/F2 保持关闭；336/336 恢复与 delivery 套件、原 13/13 探针、typecheck、boundaries 10/10 通过；新刷新探针 3 绿、1 红，无新增 P0/P1。

- **P2：提交事务内复核发布权威。** 新增 `delivery-facts.ts:94-96` 只在事务外采样非 Failed。真实 SQLite/公开命令反例：adopted claim 已耐久 A、preflight 挂起；刷新读到 Provisioning 后在 BEGIN 前暂停；释放供应使真实失败事务先提交（Failed、无 has_worktree）；再放行刷新，仍 applied=true 并产生 fresh commit/pipeline hops。须在写 edges/快照的同一短事务中用 tx 复核上下文及对应命令关系；不合格时不提交新的 fresh 事实、applied=false。Provider I/O 仍在事务外；保留 TD-009 合法 Provisioning，不机械收紧为仅 Ready。anchored 可保留探测阶段采样含义，本反例不要求它覆盖所有中途状态。
- **P3：注释与实际支持面一致。** `start-work.ts:781` 仍写“只认 Ready”，而门有意允许非 Failed（含合法供应中步骤回填）；改注释即可。

静态失败句柄刷新、Ready、历史 has_worktree 正控均通过；剩余问题是本轮读侧 P2 的提交时序残余，不是初审 F1 的物理对象丢失。本轮不能写成“无剩余 finding”；修复后复核该单一时序门及原正控，再回读最终远端发布 head。


## 第四轮独立复评 · 2026-11-22（候选技术通过）

锁定 head `eb541927e01e270a363e916aea93b2ad45e08f28`，base `4907adaaae126a8063ba62b1110b6afcd97db74b`，隔离检出 `.worktrees/review-673-candidate`。上轮时序 P2 与注释 P3 已关闭；F1/F2 保持关闭，未发现剩余 P0–P3 技术 finding。生产 blob：`delivery-facts.ts=8bb5bf7629bd3171a920fe79b293f0ec1f49ecc8`、`start-work.ts=c97aca316925539ffcb4436e080a15f1551cbb5f`、`git-provisioning.ts=2e34304762b5d1d85e6c21e4f83b7e95fa590c3a`。

- 原 before-BEGIN 反例转绿：供应先结算为 Failed、无 has_worktree 后，旧刷新采样仍可返回 anchored=true，但提交事务用 tx 复核后 applied=false，没有新 fresh 快照。Provider I/O 留在事务外，没有扩大事务或新增权威源。
- 静态 Failed、Ready/历史 has_worktree、TD-009 Provisioning 半提交正控通过；故障注入、SQLite/真实 Git 恢复和承重断言未在测试压缩中删除。
- 相关套件 **142/142**、独立探针 **17/17**、typecheck exit 0、boundaries **10/10**、diff-check 通过；检出前后干净，生产与测试 blob 未漂移。git-provisioning/start-work 相对此前已验收版本只整理注释，新增行为限定于同一交付写事务复核。
- 最终远端批准仍须锁定发布 head/base、比对本轮生产/测试内容，回读当前 checks、全部线程、Refs #191 与 issue OPEN。此处候选通过不替代最终放行、全平台资格或人类 R1 接受。


最终发布文案核对清单（不扩大生产范围）：本计划 AC 表的“至多一次外部写”应为“至多一份外部对象”，因为恢复可能再次调用 create 并以 conflict 复用；Batch 4 的关闭关系须与 D23 统一为 Refs #191。#671 计划的提交格式尾注同样须由 Closes #138 对齐 Refs #138。两个分支最终应补 review 索引与本批 merge-queue 当前状态，保留 #670/#672 已合入记录，不预写未来合并 SHA；最终发表前回读这些文案和关联。

事务证据补充：`packages/storage/sqlite/src/storage-sync.ts` 的唯一事务体实际使用 `BEGIN IMMEDIATE`，在队列内持有至 COMMIT/ROLLBACK；当前 SQLite 实现并非延迟事务。不要把“tx 复核与提交之间仍有延迟事务理论窗口”写成已证剩余风险或新增批准门。该结论来自实际 adapter 源码，不推广为所有未来 Storage Provider 的实测证据。


## 最终 main 接合 · 2026-11-22

#671 已以批准 head `2a1870cc` 的相同树 rebase 合入 `520ef1d7ccf1b836470699dfc20510127101a64d`；#138 保持 OPEN。#673 重放到该真实 main，仅出现 review 索引和 merge-queue 两处文档冲突，保留双方记录并回填三项已合入事实。自身 7 个代码/测试文件须与第四轮复评 blob 清单相同，继承的 #671 五文件也须与其批准内容相同；随后对组合树重新验证并等待新 head CI。最终批准与合入结果由 PR 当前 head/mergeCommit 回读，不引用旧 base 的 CI 放行。
