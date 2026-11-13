# PR #628 MMP 交付评审

## Purpose / Big Picture

判断 #424 的非法替换是否在失败后完整保留旧集合；存储契约通过不能代替该产品结果。

## Context and Orientation

2026-11-13 首轮独立评审：base `main @ 5708e1edca2ea032f02b35c411ee76e29a31ad1c`；head `eed130bfb28c69705d0b24196463139981a8d43c`；检出 `test/storage-atomic-rejection`，工作树 `.worktrees/storage-atomic-rejection`。远端与本地 head 一致，PR 为 Ready、MERGEABLE；评审账号 `Singularity-AI-Bot`，开发账号 `SingularityKChen`。两条提交分别承载计划与实现，closingIssuesReferences 为 #424。无既有 reviews、comments 或 review threads。

目标闭环：非法替换的原子拒绝与存储完整性。使用 Superpowers、Qian Systems Router 与 First Principles Development 的风险、状态所有权及最小反例方法。先读本矩阵，再读固定差异；没有修改生产代码、测试、Git refs 或 GitHub 状态。原实现会话“梳理迭代紧急重要 Issue”为修复 owner；P0/P1 交主评审汇总后移交。

## 风险矩阵（逐文件审查前建立，逐项完成）

| 级别 | 候选风险 | 检查与判定结果 |
|---|---|---|
| P0 | 破坏 main、泄露凭据或违反规划事实源硬边界 | 未发现。差异不改变依赖边、Planning/工程轴、Host 权威或凭据路径；机械 disclosure 与人工五类发布面检查通过。 |
| P1 | 删除后报错、事务内捕获失败仍提交、Fake/SQLite 一致性导致严重错误或证据不成立 | **发现 F1，阻塞 #424 闭环。** 父行检查挡住已列反例，但后续原生编号序列化仍会拒绝，caught transaction 提交后旧集合被部分替换；Fake 对同输入假接受。 |
| P2 | 有限覆盖缺口、维护成本或已有 issue 重复追踪 | 未发现独立新增项。新增测试复用共享套件，正控、完整读回与 scope 外事实有判别力；无需通用回滚引擎来证明父行路径。#337 已闭环，不重复实现 duplicate-content 规则；F1 归 #424/#201。 |
| P3 | 文档、链接、命名与措辞不准确 | 未发现与 F1 独立的问题。ExecPlan 自包含、有回滚与真实命令，但“P0–P3 无剩余发现／Completed”须在 F1 修复后重新判断，不能保留为当前完整验收结论。 |

覆盖层均完成：代码正常/失败路径、产品闭环、架构边界、测试判别性/反例、issue/ExecPlan 验收、设计充分性与复杂度。没有在首个 P1 后停止。

## 发现 F1 · P1 · 在首次删除前完成会抛错的投影编码

新增行锚点：`packages/storage/sqlite/src/storage.ts:182`。该处只完成全部 entity 父行预检，随后第 185 行删除旧投影、第 186 行逐项 `upsertProjection`。后者经 `packages/storage/sqlite/src/storage-rows.ts:115` 调用领域 `sourceNumberSnapshot`，仍可在合法前项已落库后抛出 `原生编号不合契约`。`SqliteSyncSurface.atomic` 在 tx 作用域内直接执行；调用者捕获该拒绝后外层事务会正常提交。

触发：workspace、binding、old/valid/bad 三个实体与身份均存在；旧集合只有 old；incoming 为 `[valid, bad]`，bad 的 `content.sourceNumber.number = 0`，其它载体合法。这符合公开 TypeScript 形状，但领域边界明确拒绝非正整数。实际影响：调用方收到失败，旧 old 已删除，只留下 valid；Fake 对同一坏集合没有拒绝，读回 valid 与 bad。父行预检不能作为“非法全集首次修改前拒绝”的充分条件。

固定 base/head 八格公共端口探针的实际结果：

| 版本 | 适配器 | 直接调用 | tx 内捕获拒绝后正常提交 |
|---|---|---|---|
| base `5708e1ed` | SQLite | 拒绝，保留 `[old]` | 拒绝，却只剩 `[valid]` |
| head `eed130bf` | SQLite | 拒绝，保留 `[old]` | 拒绝，却只剩 `[valid]` |
| base `5708e1ed` | Fake | 假接受 `[valid,bad]` | 假接受 `[valid,bad]` |
| head `eed130bf` | Fake | 假接受 `[valid,bad]` | 假接受 `[valid,bad]` |

这是已有失败路径在本修复中仍未覆盖，不声称由本 PR 首次引入；它直接反驳 PR 的全集原子拒绝承诺和 #424 mixed valid/invalid replacement 验收，因此仍阻塞本闭环。Core 常规同步先对白名单原生编号做快照，会缩小正常产品路径的暴露面；这不替代本 PR 声明的 Storage 公共端口保证，也未证明安装产品出现过该问题。

建议：在首次修改之前完成所有会失败的内容校验/编码，Fake 复用同一领域原生编号边界；或确保本次 replacement 在已有外层事务中也有操作级回退。补一个共享有效前项＋非法 sourceNumber 后项用例，在直接调用与 caught transaction 两模式均读回完整旧集合、scope 外事实和身份，并保留合法后续写入正控。无需扩展为全仓事务重构。

归属：#424 已明确拥有混合集合原子拒绝；#201 是父项。读取 #337 确认其仅拥有重复内容规则，#537 的未完成范围是本地编号与产品验收，均未单独追踪此序列化拒绝原子性；本轮未创建重复 issue。

当前 head 的最小可复跑探针（工作树根；只用内存数据库）：

```js
// node --input-type=module，以下代码作为标准输入。
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
const storage = createSqliteStorage(':memory:')
await storage.putWorkspace({ id: 'ws', name: 'workspace', statusPolicy: 'provider_authoritative' })
await storage.putProviderBinding({ id: 'b', workspaceId: 'ws', domain: 'planning', implementationKey: 'fake', enabled: true, isDefault: true })
for (const id of ['old', 'valid', 'bad']) {
  await storage.putEntity({ id, kind: 'work_item' })
  await storage.putExternalIdentity({ id: `i-${id}`, entityId: id, bindingId: 'b', externalKind: 'issue', externalId: id, role: 'primary' })
}
const p = entityId => ({ workspaceId: 'ws', entityId, planningStatus: 'todo', revision: 1, content: { contentKind: 'work_item', title: entityId, body: '' } })
await storage.putPlanningProjection('ws', p('old'))
const bad = { ...p('bad'), content: { ...p('bad').content, sourceNumber: { sourceName: 'GitHub', scopeIdentity: { namespace: 'github.com/graphql/Repository', id: 'repo' }, scopeName: 'example/repo', number: 0 } } }
await storage.transaction(async tx => {
  try { await tx.replacePlanningProjections({ workspaceId: 'ws', bindingId: 'b' }, [p('valid'), bad]) }
  catch (error) { console.log(error.message) }
})
console.log((await storage.listPlanningProjections('ws')).map(row => row.entityId))
storage.close()
// 实际：原生编号不合契约；[ 'valid' ]。原子拒绝期望：[ 'old' ]。
```

八格版本探针由 `git show <immutable-base>:<file>` 在临时目录加载 base adapter，其余依赖与当前树一致；两版本差异不含序列化、事务机制或 SQL 语义变化。探针对每格输出作实际断言，执行 exit 0，临时目录已清理，没有切换分支或改 refs。

## Design / Spec

- Fake 局部父行 helper 在单个既有 `#mutate` 槽内复用，参数 workspace 规范化与 SQLite 一致，无新增公共接口、跨层跳跃或第二事实源；生产增量保持局部责任。
- SQLite 新三行处于首次 DELETE 前且与写入同槽，避免 TOCTOU；missing workspace（含空集合）、missing entity、valid-then-missing entity 的直接/caught 反例均有完整集合读回。F1 是该边界之外仍存在的编码失败路径。
- `002_identity_membership.sql` 仅增加独立出处注释，DDL 语义没有变化。实际 schema 有两个布尔 CHECK、disabled-default CHECK、三维挂载键、工作区 FK、二元投影键、redacted 标题/来源号 CHECK 与 field value NOT NULL；新 SQL 负例其它父行合法且匹配实际约束错误，正控可继续写入。
- membership 新证据在 scope 混合输入前保留非空 retained 字段，完整 snapshot 同时包含其它 project/workspace、字段与身份。已有重复内容语义仍由 #337 的共享用例负责。未发现重叠实现或过度设计。
- #424 第一项约束证据成立；第二项原子拒绝仍受 F1 阻塞；第三项相关变异有归因结果，但不能将其扩大为任意失败点原子性的证明。父 #201、#190、安装产品与 R1 未被本 PR 声明关闭。

## Global Constraints

本评审仅写本记录；不修改生产实现、测试、用户数据库或规划字段。原实现会话独占修复，评审会话不并行修改同一架构单元。

## Plan of Work

### Batch 1 · 固定 head 全矩阵与实际验证

均在 `.worktrees/storage-atomic-rejection` 根、固定 head 执行：

| 命令/观察 | 实际结果 |
|---|---|
| `pnpm test:file tests/contract/storage-contract.test.js tests/integration/identity-membership-schema.test.js tests/integration/execution-relation-write-schema.test.js` | 300 passed，0 failed/cancelled/skipped；约 3.10 秒。 |
| `pnpm run typecheck` | exit 0。 |
| `pnpm run boundaries` | 9 passed，0 failed/skipped。 |
| `node scripts/rule-checks.mjs disclosure 5708e1edca2ea032f02b35c411ee76e29a31ad1c` | exit 0；人工五类发布面复核未发现新增风险。未借此声称扫描了未提交评审记录。 |
| `node scripts/rule-checks.mjs size 5708e1edca2ea032f02b35c411ee76e29a31ad1c` | exit 0；技术 147/1000，文档 127/1500。 |
| `git diff --check 5708e1edca2ea032f02b35c411ee76e29a31ad1c...eed130bfb28c69705d0b24196463139981a8d43c` | exit 0。 |
| 首轮发布 review 前的该 head 托管 checks 与线程 | `PR Fast Gate`、Verify、Browser、Rule checks、CodeQL 均成功；无 review threads。可选 `Create review session` run 43393141648 失败日志实际为端点 404，属于既有 #364，未当作本 PR 缺陷。 |
| 八格版本/适配器/事务公共端口探针 | exit 0，逐格断言证明 F1；仅临时内存库，无用户库或外部写入。 |

没有重复运行三 PR 组合全量；计划中的 4056 项是作者记录，本独立评审只认上述实际执行结果。

## 最终树变异判别表

统一使用仓库 `scripts/review-mutate.mjs`，command 为上述三文件 V1，所有变异都指定 `killedBy`；夹具在每次后按原字节还原，最终还原基线 300/300 通过。最终完整批 15 项均 KILLED、exit 0：

| 变异 | killedBy（实际失败用例片段） | 结果 |
|---|---|---|
| Fake 去 workspace guard | `projection replacement rejects empty missing workspace` | KILLED |
| Fake 去 entity guard | `projection replacement rejects valid then missing entity` | KILLED |
| SQLite 去 workspace guard | `projection replacement rejects empty missing workspace` | KILLED |
| SQLite 去 entity guard | `projection replacement rejects valid then missing entity` | KILLED |
| 去 enabled CHECK | `挂载布尔值与 disabled default 各自由自己的 CHECK 拒绝` | KILLED |
| 去 is_default CHECK | 同上 | KILLED |
| 去 disabled-default CHECK | 同上 | KILLED |
| 去 projection workspace FK | `投影工作区 FK 拒绝悬空父行` | KILLED |
| 放开 redacted title | `redacted 标题和 source number 分别由 CHECK 拒绝` | KILLED |
| 放开 redacted source number | 同上 | KILLED |
| 去 field value NOT NULL | `字段值 NULL 由 NOT NULL 拒绝` | KILLED |
| 去 projection 复合键 | `同一工作区里同一实体只有一行投影` | KILLED |
| 挂载键省 workspace（保留三元 UNIQUE 供下游 FK 使用） | `挂载主键的 workspace、binding、domain 三个分量各自区分合法行` | KILLED |
| 挂载键省 binding（同上） | 同上 | KILLED |
| 挂载键省 domain（同上） | 同上 | KILLED |

归因限度：projection 键移除会先破坏既有 ON CONFLICT 正控，挂载键缩窄也可能先破坏 fixture/合法多行正控；这些证明键形状有负担，不能伪称只由最后一个 duplicate 负断言击杀。最初尝试把挂载键放宽为四元键使下游 FK 定义不匹配，目标测试未失败而得到 KILLED_OTHER；该无效实验不计入最终 15 项，改用保留下游 FK 目标的维度缩窄实验。没有手写一次性变异执行器。

## Validation and Acceptance

#424 的原子拒绝验收尚未通过：F1 在合法父行、非法内容的混合批次上复现。主审另在完整组合树复现相同错误，独立运行 `pnpm verify` 的4056项全绿仍未覆盖它；没有据此豁免 P1。

## Progress

- [x] 2026-11-13：全矩阵、定向测试和15项变异及字节恢复完成。
- [x] 2026-11-13：开发与评审账号已核验；由评审账号一次性提交全部 inline 意见，review 5888403871 为 REQUEST_CHANGES。
- [x] 2026-11-13：完整缺陷、复跑入口、系统修复方向和复审回传方式已交原实现会话“梳理迭代紧急重要 Issue”。
- [ ] 原 owner 修复后，按新 head/base 独立复审；未满足该门禁不合并。

## Surprises & Discoveries

F1 在 base/head 都存在，但直接阻塞本 PR 声称完成的 mixed-invalid 原子拒绝闭环；既有绿色测试只证明已覆盖的父行拒绝点。

## Decision Log

2026-11-13 / 人类本会话直接指令：“如果有 P0/P1 问题且有别的 session 负责这个 PR 的实现”，则“把所有问题交给它修（正文写全意见与复审回传方式），修完再复审”。本 PR 存在已确认原 owner，故已移交而不并行改源码。该指令不授权带阻塞项合并，不改 Planning Status 或原生关系。

## Idempotence and Recovery

所有定向验证可重跑；变异由仓库夹具按字节恢复。反例只用临时内存库，公开探针在上文完整给出，不依赖本机临时文件。评审文档可独立修订；生产修复的恢复锚点及提交整理由原 owner 维护。

## Interfaces and Dependencies

使用现有 Node/pnpm、冻结依赖、公开 Storage 端口及仓库变异夹具。评审账号为 gh-review，开发/作者回复为 gh；原 owner 的结果经会话回读后交独立评审者验证。

## Outcomes & Retrospective

首轮结论：**REQUEST_CHANGES 建议，1 项 P1（F1），无独立 P0/P2/P3。** 子评审未向 GitHub 写入；主审已发布上述 REQUEST_CHANGES，并在 #424 写明验收阻塞，未新建重复 issue。由原 owner 修复后，重新锁定 head/base、复跑受影响共享用例、F1 八格中当前版本相关格和远端门禁，再判断 #424 闭环。

本评审不裁决 Project Status、期别、依赖或人类安装/R1 验收；没有用户数据库操作。评审结束时生产/测试源码与固定 head 一致，唯一新增工作区文件为本记录。

## Bottom Change Note

2026-11-13：独立评审记录唯一 P1 与完整反例；主审补齐生命周期章节、已发布 review 和原 owner 移交边界，保持本 PR 阻塞待复审。


### Owner 修复回传 · 2026-11-13 17:27 SGT

原首轮评审正文完整保留。owner 已按 F1 实现 scoped atomic 保存点，回退本次调用的编码／SQL 失败；Fake 在 put／replace 首次修改前共用域内编号校验。只提前编码仍不能覆盖原生 SQL 拒绝，故没有继续增加坏值特例或镜像约束。

同一分支在 main@f32ad6c2 上完成共享坏编号两例 RED 与原生 SQL 一例 RED，再得到扩展存储用例 342/342、类型检查、boundaries 9/9 和完整 4059/4059。独立复评 325 项测试及12组端口探针通过，含外层事务捕获后正常提交、前后成功写保留、合法编号正控、SQL NOT NULL／CHECK、合法恢复和 fence；Spec／Quality 均 PASS，无新增 P0–P3。

这条 owner 记录不覆盖 review 5888403871 的 REQUEST_CHANGES 裁决。原线程保持未解决，精确 lease 推送和当前 head 门禁回读完成后交回原评审会话复审；禁止 owner 合并。回退锚点与发布结果由原 owner 保留，可通过 PR 当前 head/base/checks 重新核验。

## 复审 R2 · 原 P1 修复（2026-11-13）

### 锁定与风险矩阵（读修复 diff 前建立）

复审 base `main@f32ad6c25cb543d1b15a80eee98614c9b0b25214`，head `f4bfa244c7267a795be2ed8904a5031ca993f08c`；执行检出 `test/storage-atomic-rejection`，工作树 `.worktrees/storage-atomic-rejection`。本轮仅复审 #628，不合并。

| 级别 | 候选风险 | 判定门 |
|---|---|---|
| P0 | scoped atomic 影响所有调用点、破坏权威状态或发布安全 | 无发现；13 个回调均同步，无新增公共接口、权威源或依赖边 |
| P1 | 内容/SQL 拒绝仍部分提交；回退吞掉外层成功写入；dirty/fence 出错 | F1 已解决；编码及 SQL 拒绝均保持整集合，外层成功写入和合法恢复保留，fence 符合结果 |
| P2 | 过度扩展公共事务机制、不同步回调、覆盖缺口或重复 issue | 无发现；修复集中在既有 atomic 和 Fake 域校验，#424 验收有判别证据，不新建重复 issue |
| P3 | 计划/证据/线程与当前 head 不一致 | 无发现；完整 diff、归档计划和作者回复均核对，远端发布后再回读 |

复审结论：固定上述 head/base 无新增或剩余 P0–P3，原 F1 已解决，结论 APPROVE。首轮 REQUEST_CHANGES 为历史，当前结论由本节取代；本轮不合并。

### 根因与系统边界

Fake `#assertProjections` 在首次修改前复用 `domain.sourceNumberSnapshot`，put/replace 均拒绝非法展示号；没有手抄 SQL 全部规则。SQLite 的 scoped `atomic` 在既有队列槽内用 SAVEPOINT 包住整个同步回调，失败 ROLLBACK TO＋RELEASE 后重新抛原错并恢复进入操作前 dirty；成功 RELEASE 后才标 dirty。原始 preflight、事务令牌、队列与外层 COMMIT owner 保持。

两位原实现之外的独立评审分别核对 F1/共享测试及全部 atomic 调用点。后者逐一审读 storage 的 binding/account/关联/config/identity/projection/repository 七处、execution 的 context/relation/mutation 三处、sync 的 membership/replacement/syncRound 三处：13 个 callback 均为同步 SQL/域函数，没有 await、Promise 返回或嵌套 atomic，因此当前路径的同名保存点不会交错。

### 本轮独立实跑证据

执行上下文均为本节锁定 head 的分支工作树；未用 owner 的自验代替本轮结果。两位评审只读源码，探针各用独立内存库，无原地变异、用户数据库或外部 Provider 写入。

| 执行者／入口 | 真实结果 |
|---|---|
| 主审：归档计划 V1 五文件命令 | 342 passed，0 failed/skipped |
| 主审：`pnpm run typecheck`、`pnpm run boundaries` | exit 0；边界 9/9 |
| F1 独立评审：storage-contract、identity-membership-schema、execution-relation-write-schema 三文件 | 314 passed，0 failed/skipped；10 组公共端口探针通过 |
| atomic 独立评审：storage-contract、identity-membership-schema、storage-committed-read-fence、storage-sync-surface 四文件 | 325 passed，0 failed/skipped；6 组公共端口探针通过 |
| 主审：disclosure、size、diff-check（base 为本节完整 SHA） | exit 0；提交树技术 200、文档 319；追加本节不改产品/测试及 PR head |

F1 探针包括双适配器 direct/caught 的 7 种坏展示号，put/replace 共 56 条拒绝路径；SQLite 另覆盖 NOT NULL、CHECK、绑定类型三类失败的 direct/caught，核对整集合、scope 外事实、外层前后成功写入及同事务合法替换。

共享 atomic 探针另覆盖：CHECK 拒绝不留 binding anchor 且恢复旧 default；仅失败操作不推进 fence；内部 RELEASE 后外层失败仍整体回滚；membership 后项 CHECK 拒绝保留旧成员/字段及外层 marker；context 绑定错误恢复旧 active 且可合法重试；Promise.all 成功/失败/成功保留先前 dirty；root 排队写等待外层结算。初稿 fixture 曾误建多个 enabled planning 挂载，改为 development 后通过；该 fixture 错误不列为产品发现。

### 当前远端与验收判断

固定 head 的 Fast Gate、Verify、Browser、CodeQL、Issue policy、Disclosure 和 size 均成功。取消的 Rule checks run 43401811006 与 Issue policy 43401810885 已分别有同 head 后继成功；不是未处理的实际失败。原线程 `PRRT_kwDOUekeas63BK58` 的作者回复已解释根因、修复与证据，主审确认后提交当前 head 的 APPROVE 并以开发账号 resolve；结果以 `gh pr view 628 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,state,reviewDecision,statusCheckRollup` 及 reviewThreads 回读为准。

#424 的原子拒绝验收已由当前反例验证，其它独立约束沿用首轮未受影响的具名证据；#201 父项与 R1 人类接受保持独立。owner 的全量 4059 项是修复树自验和 CI 证据，本轮没有重复全量。没有安装态或性能接受结论。本轮仅追加本地复审证据并发布 review，不提交或改写实现分支，不合并；后续若包含该文档而变更 head，仍须对新 head 回读门禁。

Change Note (2026-11-13)：完成原主审 R2，两位独立子评审加主审实跑确认 F1 修复及共享 atomic 风险，无剩余 P0–P3；保留全部首轮与 owner 原字节记录，追加当前结论和不合并边界。

最终回读（2026-11-13 @ f4bfa244）：评审账号提交 APPROVE（review 5889020218），开发账号已 resolve 原线程；PR 仍 OPEN、Ready，reviewDecision 为 APPROVED、Fast Gate 为 SUCCESS、未解决线程为 0，未合并，#424 保持 OPEN。PR head 未改变；本 R2 追加内容仅为工作树本地文档修改。

## 交付 R3 · 人类授权继续 rebase（2026-11-13）

人类在原评审会话直接要求：“继续 rebase 流程。之后验收并关闭 #144、#224、#201、#537”。此条明确取代 R2 的不合并边界，仅对本次 #628 收尾及点名工作项验收生效；各 issue 仍以实际范围与证据判断，不把合并当作缺失功能或人类接受。Planning Status 和原生关系没有写入授权。

本批只将 R2 复审记录和本授权纳入已审实现提交，不改变产品、测试、schema 或依赖。最终发布前保留 `refs/backup/mmp-review-20261113/pr-628-before-final-docs`，精确绑定原远端 head 的 lease；若远端已变更则停止覆盖并重新核对。相比追加一条文档提交，折叠保留设计＋完整实现两条交付提交。

最终门禁在检出 `test/storage-atomic-rejection` 的工作树执行：`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`，期望 exit 0；并核对相对 R2 锁定 head 的产品/测试 diff 为空。发布后以 `gh pr view 628 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,reviewDecision,mergeStateStatus,statusCheckRollup,closingIssuesReferences` 与 reviewThreads 回读当前 head，仅在独立复评、Fast Gate、批准与线程门禁满足时使用 `merge_method=rebase`。

合并后回读 merge SHA、main 树与获批 head 的一致性、#424 关闭和根工作树状态。#144/#224/#201/#537 的验收在合并后的 main 上分别形成 issue 级证据，不将未实现或待人类验证的内容核销。

Change Note (2026-11-13)：记录直接继续 rebase 授权与恢复锚点，收口 R2 本地证据为最终交付；原 R2 不合并结论的适用时间止于本授权。

验收范围澄清（2026-11-13）：在明确剩余范围后，人类选择“先完成合并和验收，未完项保持打开”。本轮按该边界逐项写回验收证据；缺失功能、正式回归用例或尚无裁定的设计义务保持 OPEN，不替人类作产品范围豁免。
