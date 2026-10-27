# PR #408 MMP 交付评审

> 状态：本轮只读评审完成；2026-10-27（Asia/Singapore）；结论只适用下述 immutable head。发布 review、修复与合并由协调者分别处理，本记录不宣称它们已经发生。

## Purpose / Big Picture

判断 #142 的用户闭环是否成立：用户从可见工作项显式选择已绑定且四门可服务的仓库开始工作；无执行器时人工降级；双提交不重复供应；确定失败可新尝试；结果未知原键先读回。最小证据是实际 Core/controller/SQLite 与组件反例，而不是 CI 绿色。

## Context and Orientation

锁定事实：检出 `feature/start-work-drawer` 的 `.worktrees/start-work-drawer`，head `f39a93c2b6e448475adda5c6cf708675ce38e779`；base `main` @ `f6ea9713c04e2011bf2023d312c659d0be5c8b4d`。提交依次为 `a3d9f0a8950291a99881f132927735f1baa0ec8d` 与该 head。初审快照显示非 draft、MERGEABLE、UNSTABLE，`Closes #142` 同仓关联存在；完整 review threads、reviews、comments 皆空。PR Fast Gate、主 CI、Merge Gate 及各 lane 通过；可选 Create review session 失败，Issue policy / Resolve PR base / matrix.check 有取消项且前两者有同名成功后继。取消来源和可选检查失败原因由协调者结合 Actions run 回读，不能仅从快照作全部门禁通过结论。

需求源为 #142 正文及其 2026-10-08 no-route 恢复评论、`docs/product/vertical-path.md`、`docs/exec-plan/completed/2026-10-26-start-work-drawer.md`。已阅读 PR 正文、所有现有评论/线程及开放 issue 列表，特别核对 #193、#194、#200、#204、#284、#304、#341、#349、#359 的边界。未引用历史记忆替代当前源码。

逐文件审查覆盖全部 23 个变更文件：Host/client/descriptor 4 文件；client adapter/export 2 文件；ui-model 2 文件；UI 7 文件；contract/integration 6 文件；计划与索引 2 文件。计数按 diff 文件清单复核为 23 个。关联主文件是 `packages/client/src/start-work.ts`、`packages/ui/src/start-work-section.ts`、`apps/harness-plugin/src/host-composition.ts`。

## Design / Spec

使用 Superpowers `requesting-code-review` 的独立审查职责，结合 `qian-systems-router` 的系统边界/接口综合与 `first-principles-development` 的 audit 模式。事实是 Host 持权威执行记录、Core 拥有供应状态机、UI 只持表单草稿；硬约束是规划/工程轴正交、确认前不报 Saved、仓库按自身 Development 路由判门。主要不确定性是未知结果与失败是否被混为同一重试，以及 no-route 恢复是否误伤其它冲突。

先建立 P0–P3 初始风险矩阵后再逐文件审查；下表保留原假设并填入最终证据，不把假设当缺陷：

| 级别 | 初始检查假设 | 最终证据与结论 |
|---|---|---|
| P0 | 工作树路径/仓库身份或规划状态被错误覆盖 | 无新增 P0。新增 Host 输入不接受 workspaceId/worktreePath，Core 注入 workspace；UI 不写规划状态；边界 9/9。 |
| P1 | Start Work 双提交、失败/结果未知后是否重复创建；真实用户是否能继续 | 无新增 P1。24 项窄回归覆盖 Promise/key 合并、已 ack 分支后的失败新键、丢失确认原键恢复及 SQLite 唯一 context。 |
| P2 | 缺省分支、执行降级、重试与读回边界 | 确认 F1：所有 conflict 被误解为需要绑定，工作树分支冲突恢复被误导/禁用。默认分支及人工降级未发现新缺陷。 |
| P3 | 抽屉状态与提示的一致性 | 无独立 P3。目标切换与卸载丢弃晚响应，断线禁提，无嵌套 modal；F1 的相互矛盾提示归同一根因。 |

## Global Constraints

本轮不修复产品、不改生产源码、不 commit/push、不提交 GitHub review。仓库唯一写入文件是本记录。反例脚本保存在外部临时证据目录；仅修改测试运行时 fake 对象，不临时编辑生产文件。文档正文中文、路径使用仓库相对形式，不写凭据或本机身份。#359 的真实 Harness Host 装配、#193/#304 等已跟踪 Core 恢复债务不转嫁成本 PR 新缺陷。

## Plan of Work

### R1 · 范围、事实与逐文件审查

最小闭环：把 #142 正文和 no-route 评论逐项映射至 current head 的 Host→client→UI。涉及文件为 `Global Constraints` 所列记录；读取全部 diff 与需求、计划、当前线程，追踪同根因 issue。验证命令为 `git diff --stat <base>...HEAD` 与 `git diff --check <base>...HEAD`；期望无未解释范围扩张、空白错误。回滚仅撤回评审记录。

### R2 · 失败/并发反例与结论

最小闭环：跑 `Validation and Acceptance` 的窄命令并构造真实 Core/controller/SQLite 非路由冲突；向组件输入该真实结果，验证恢复按钮。期望正常控制通过，反例能区分绑定问题与工作树问题。临时 SQLite 由 finally 关闭并删除，既有仓库、worktree 与外部系统零变更。

## Validation and Acceptance

全部命令在上述分支/head 的工作树根执行，Node v26.12.0。下列是本轮实跑结果，不混用作者旧树证据。

| 验证命令或探针 | 实际结果 | 判别的风险 |
|---|---|---|
| `pnpm test:file tests/contract/ui-start-work.test.js tests/integration/harness-plugin-start-work.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-setup-client.test.js` | exit 0，24/24 | 完整 intent、双提交、同步 throw、确定失败换键、未知先读回同键、畸形 DTO、scope、模式和 optional wire。 |
| `pnpm test:file tests/e2e/repository-routing.test.js tests/contract/ui-model-presentation.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js` | exit 0，53/53 | 仓库自身四门、不能借连接、PR/redacted 无写入口、UI 正式 prop 链与旧详情/焦点契约。文件名 browser 中有 bundle/SSR 契约，本次命令不能扩称浏览器实点。 |
| `pnpm run boundaries` | exit 0，9/9 | 所有新增 import 满足依赖边；ui 不调用 Provider。 |
| `git diff --check f6ea9713c04e2011bf2023d312c659d0be5c8b4d...HEAD` | exit 0，无输出 | 当前提交 diff 的空白检查。 |
| `node "$HP_REVIEW_TMP/pr408-conflict-recovery.mjs"` | exit 0，断言确认 F1 及成功控制 | `HP_REVIEW_TMP` 指向本轮协调者的外部临时证据目录；脚本不属于产品或正式文档。复现步骤与输出完整列于下一节，第三方无需依赖临时脚本来理解反例。 |

Issue #142 五项验收逐一核对：工作项/PR 内容种类、仅绑定仓库、无执行器/human/Harness 明确模式、双提交唯一 context、逐仓库可服务路由均有上述实际组件或集成证据。no-route 评论所需绑定导航存在；但 F1 证明非路由冲突也错误走该导航。作者的官方 Web / tgz 证据有冻结 source/tgz 身份与边界，本轮未重新启动官方 Host，不把作者陈述记作本轮实跑。

测试判别力限于现有断言与独立运行时反例，未做额外源码变异；本轮遵守不临时修改生产源码的约束。未重跑全量 verify、插件打包或真实 Git/官方 Web，未声称 Desktop、真实模型执行或 R1。

## Progress

- [x] 2026-10-27：先读预建 P0–P3 矩阵，再锁定需求、head/base、线程与逐文件范围。
- [x] 2026-10-27：完成正常/失败、产品路径、架构、幂等/并发、测试和 issue 范围检查。
- [x] 2026-10-27：实跑 24+53+9 项及 diff 检查，运行真实冲突/组件反例并保留成功控制。
- [x] 2026-10-27：完成全部 findings、非问题与建议；交协调者一次性提交 review。

## Surprises & Discoveries

### F1 · [P2] 工作树冲突被误判为仓库绑定问题

初审 finding；Superseded by `Outcomes & Retrospective` 的“F1 修复独立复评”（2026-10-27）。下述复现保留为原 head 的历史证据。

最小新增行锚点：`packages/client/src/start-work.ts:31`。这里仅凭 `error.code === 'conflict'` 输出 `needsBinding: true`。但 `packages/core/src/start-work.ts` 的 `verifyExistingWorktree` 同样用 Conflict 表达“已记录工作树当前检出另一分支”；此时绑定和四门仍有效。`packages/ui/src/start-work-section.ts:38`、`:46`、`:48` 消费该标志，显示“此仓库尚无可用路由或写权限”，并把文案为“重新提交”的按钮禁用。固定安全错误文案又使界面无法解释实际工作树原因。

最小复现（全程真实 Core/controller/SQLite，仅 fake 外部 Provider）：

1. `composeCore` + `createController` + `createSqliteStorage`，选择种子工作项和 `repo-alpha`，以 key `initial` 完成 Start Work，断言 confirmed。
2. 模拟用户在已建工作树执行 checkout：把 `providers.development.state.worktrees.at(-1).branch` 改为 `other-branch`，仓库绑定及能力元数据保持原样。
3. 建立新的 `createStartWork` client，以新 key `fresh-client-key` 提交相同工作项/仓库，符合重开插件后的一次显式操作。真实 Core 的已有 context 读回确认分支不匹配，返回 local_only / failed / conflict；client 输出如下。
4. 还原外部 worktree 的原分支，以 `fresh-after-worktree-fixed` 直接走 controller 提交，断言 confirmed。无需重新绑定仓库。
5. 将第 3 步的真实 client 结果交给实际 `StartWorkSection`，仓库仍 `available: true`。组件 hook/SSR 探针断言按钮文案是“重新提交”，但 disabled=true，同时出现错误的绑定/权限说明。

```json
{"answer":{"writeState":"local_only","degraded":true,"contextStatus":"failed","needsBinding":true},"directAfterWorktreeRepair":"confirmed","repositoryBindingChanged":false}
{"button":"重新提交","disabled":true,"availableRepository":true,"falseBindingWarning":true}
```

影响：一个可通过修复工作树并新尝试恢复的确定失败，被导向无关的绑定设置；同一表单即使外部问题已解决也不能点击其“重新提交”。用户可先修复工作树，再收起/重开表单，或切到占位项后选回仓库以清除 result，再用新 key 提交。因此是有绕行路径、未破坏数据/执行唯一性的 P2，不是 P1。

建议：只在当前仓库路由元数据确认无路由，或 Host 返回专门且安全的路由恢复判别值时给 `needsBinding`；保留其它 conflict 的确定失败重试，并增加“有效绑定 + 工作树分支不匹配→修复后可重新提交”组件/真实 Core 控制。不能按 raw message 匹配错误类型。

重复追踪核对：#142 的 no-route 评论只要求真正无路由时引导绑定；#341 针对 allowedRoot 外句柄的 Unknown 死路，#200 针对 Provider conflict 复用契约，均不拥有本次 client 把任意 Conflict 误分为 needsBinding 的新根因。开放 issue 列表中未发现同根因条目。

### 重要非问题判定

- 默认分支：UI 留空时不传 branchName；Host 拆出 undefined，不改变 Core `namesFor` 默认命名；descriptor 的 `acceptsUndefined` 只用于该可选参数，必需字段保持严格。Core `baseRef` 仍从该仓库 defaultBranch 读取，不由 UI 任意指定。相关 wire 断言通过。
- 未知与失败：transport/畸形 DTO/Pending/Unknown 保持原键并在重放前 reader；reader 失败零写；仅 failed/conflict 或 local_only+已校验 failed context 轮换。真实丢失确认控制只起一个 run。初次探针复用 confirmed key 得到旧 confirmed 是 Controller 已确认账本的预期行为，不能拿它证明新的外部冲突已被检测；最终反例明确使用新 client/key。
- 双提交与目标切换：Promise microtask 避免同步 throw 卡 pending；同 intent 在途共享 Promise/key；generation 抛弃旧目标晚响应；打开、选择、关闭不隐式调用写命令。跨 target/payload 新 intent 是本计划明确设计，不等于误复用旧键。
- 人工降级：executionMode 来自实际 Host 选定装配，human 不冒充 Harness；无执行器保留入口；ready + manual_fallback 与 run failed 表达 Git 准备成功、执行器未启动，UI 不宣称模型执行成功。#359 是单独跟踪且明确出范围。
- 可见性与状态拥有：PR/redacted/unresolved 无入口；Host 在 baseline 前后与命令后检查工作项可见性；不接受伪造 workspaceId，不新增规划状态写者或第二份执行事实。#349 的 Core 事务内可见性竞态、#194 的持久请求指纹、#193/#304 的已有 Core 恢复风险继续由其 issue 承接，不作为本次新增 finding。

## Decision Log

2026-10-27 / 独立子评审：APPROVE，附 1 条 P2（F1），无新增 P0/P1；依据仓库 `docs/review/mvp-review.md`，仅 P2/P3 对应 APPROVE。不给 CI 绿色赋予替代产品闭环的含义，也不自行合并。

2026-10-27 / 协调者确认：不做额外生产源码变异；以真实 Core/controller/SQLite 反例和组件控制交付本轮证据。F1 由协调者在全部 PR 评审完成后一并发布，修复 owner/后续复评不在本轮冒认。

## Idempotence and Recovery

只读审查和上述测试均可重复；反例创建隔离临时数据库并 finally 关闭清理，不写现有用户工作树。F1 的产品绕行路径是先修复外部 worktree 分支，再收起重开表单以清除 needsBinding 结果，随后新 key 提交。修复应保持 Unknown 原键先读回和 no-route 不盲重放两个现有保护。当前无产品改动需要回滚；若撤评审记录，不影响运行事实。

## Interfaces and Dependencies

依赖现有 pnpm/Node、真实 SQLite、fake Development/Execution Provider、React 组件 hook/SSR；离线探针无凭据、无 GitHub 写入。完整评审事实由协调者只读采集，最终 GitHub head/base/checks、取消来源与线程发布需协调者再回读。生产接口维持 Host→controller→Core 和 client→ui-model→UI，不增反向依赖。

## Outcomes & Retrospective

2026-10-27 +08 / 协调者补充：完整初审已由评审账号提交，review id `5662813753`。两P2经独立复评和新组合官方Web实测关闭，#124评论`6435452681`已回读，P3回传尾项完成（如本PR适用）。新组合源`f49334fb`、tgz SHA-256 `448a05de2a64c761146cdddf99f9bb5290e3c565a889ee23d46cb4fd5b332d95`；共享实证完整边界见 `docs/review/2026-10-27-pr406-pr409-mmp-review.md`，不冒充各单PR独立新产物S3。最终head/base/checks/threads与合并结果在整理发布后重新锁定。

本轮全部矩阵完成，共 1 条已确认 P2、无新增 P0/P1/P3，建议 APPROVE。正常路径证据 86 项通过（24+53+9），另有真实 Core/SQLite 和实际组件的独立反例；不因正常测试绿色忽略恢复语义。F1 在初审时未修复；Superseded by 本节“F1 修复独立复评”（2026-10-27）。PR 描述、计划和单 PR/组合官方 Web 证据的范围陈述一致；#359、#193、#194、#200、#304、#341、#349 等既有事项仍保留自身验收归属。

### F1 修复独立复评（2026-10-27）

复评上下文：仍在检出 `feature/start-work-drawer` 的工作树根，HEAD 为 `f39a93c2b6e448475adda5c6cf708675ce38e779`，修复为其上未提交的四文件增量。本结论锁定下列实际文件内容，不冒称新的远端 immutable head；最终整理/push 后仍须协调者按当前 SHA 重读门禁与线程。

| 文件 | 复评时 SHA-256 |
|---|---|
| `packages/client/src/start-work.ts` | `8dda35458be29f7b2fba8bf2528c57817ae1f1cae0734378efd7e3f01c9913a9` |
| `packages/ui/src/start-work-section.ts` | `79b201215fb6bd1f98318fa3c95553c3342e329c495f41bbffcf23883c3446bf` |
| `tests/contract/ui-start-work.test.js` | `8ef3ced377399fe2eb174d558b95d12241a78db5dc410e1f95c45b53f89ffcac` |
| `tests/integration/harness-plugin-start-work.test.js` | `4cd88d67fcd6544f5e99b672d125a4c2a66f1426cd8d7a60fb9079e792f39f48` |

修复消除了本 PR 自行增加、没有 Host 专门语义的 `needsBinding` 字段；绑定引导仅由仓库列表为空或选中仓库自身 unavailable 决定。通用 conflict 显示检查工作树或连接设置，并以“重新提交”走确定失败的新 key。没有改 Core、Host wire、未知结果策略或路由事实源。

作者的 RED 日志已读：两个新增用例在旧实现分别因 submit disabled=true 和 needsBinding=true 失败（18 项中 2 失败）。这是作者执行证据，不记作子评审自己执行 RED；子评审随后实际运行：

```text
pnpm test:file tests/contract/ui-start-work.test.js tests/integration/harness-plugin-start-work.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-setup-client.test.js
26 tests, 26 pass, 0 fail, exit 0
pnpm typecheck
exit 0
git diff --check
exit 0, no output
```

子评审另把初审临时反例脚本只在进程内变换为修复后期待值，未改产品或保存覆盖原反例。真实 Core/controller/SQLite 仍制造工作树分支不匹配，再还原分支；实际组件消费该真实失败，得到如下独立输出，所有断言 exit 0：

```json
{"answer":{"writeState":"local_only","degraded":true,"contextStatus":"failed"},"directAfterWorktreeRepair":"confirmed","repositoryBindingChanged":false}
{"button":"重新提交","disabled":false,"availableRepository":true,"falseBindingWarning":false}
```

两个新增持久测试分别覆盖真实 client→组件的通用 conflict 原地再次成功，以及真实 Core/controller/SQLite 的 failed context 修复后同 client 新 key 成功且 worktree 数仍为 1。现有 no-route/无仓库组件断言仍显示绑定导航并禁提；未知结果/读回失败/同步 throw 保持原 key 和读前不写，已 ack 分支后的确定失败继续换 key。没有发现修复引入的新增 P0–P3 finding。F1 在上述本地补丁内容上关闭，复评建议 **APPROVE**；最终远端重锁由协调者完成。

## Bottom Change Note

2026-10-27：独立复评 F1 的未提交修复，记录四文件摘要、作者 RED、本轮 26 项 GREEN/类型检查和原反例成功控制；本地 F1 关闭，最终 push 后需重锁远端。

2026-10-27：在预建风险矩阵之后完成全文件审查，保留初始假设并写入最终证据；改成 PLANS 13 章节，记录 1 条 P2、真实复现/成功控制、86 项实跑及未验证边界。

2026-10-27 +08：记录初审发布、独立修复复评、新组合Web与#124回传；最终远端状态仍以当前头回读为准。
