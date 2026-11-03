# PR #530 MMP 交付评审

> 状态：独立初审完成，待协调者统一发布及处理 P2；观察日期：2026-11-04（Asia/Singapore）。

## Purpose / Big Picture

判断 Core namespace 与显式 DeliveryScope 是否构成可独立验收、合并和回滚的契约收口。结论：未发现 P0/P1；发现一个 P2 输入隔离缺口，正常生产调用与两壳相关链路通过。本记录不代表已安装 Host、人类 UAT 或 R1 发布验收。

## Context and Orientation

执行检出为 `chore/core-namespaces`，worktree `.worktrees/core-namespaces`；本记录所有本地命令均从该检出根目录执行。锁定 head `ed13d5a4f2626119dfe39fce3f08bdc8ef11b38d`，base `main @ f5ae377d98c43ed216f680cb72e5f35d73a2b8e1`。PR 为 OPEN、Ready、MERGEABLE/CLEAN，一个提交 `refactor(core): 收敛查询命名空间与交付作用域`；`Closes #418`、`Refs #224`，closingIssuesReferences 只有 #418。

读取了本检出 `AGENTS.md`、`docs/review/mvp-review.md`、`docs/review/README.md`、`docs/exec-plan/completed/2026-11-03-core-namespaces.md`、#418 与 #224 当前正文和完整 diff。评审账号回读为 `Singularity-AI-Bot`；初审 reviews/comments 均为空，reviewThreads 分页 `hasNextPage=false`、0 线程。原实现会话“筛选迭代紧急重要 Issue”负责本分支，评审者没有并行修改产品或正式测试代码。

## Design / Spec

事实：生产 Core/controller 调用使用 `.queries.method()` / `.commands.method()`；Host 的 delivery handlers 与 client 传递对象 scope。实验 callable namespace 没有生产调用者，string 正例只由可替换 fixture 保留。硬约束是普通 namespace、单一对象契约、无效输入结构化拒绝、真实缺口和两壳保留；不承担实验 API 兼容义务。

以 First Principles Development 的 audit 模式检查“调用结果与不变量是否保持”，以 Qian Systems Router 的分析综合方法追踪 Core → controller → Host 与 Provider/Storage 反馈边界。Superpowers 入口已读，子任务按其 SUBAGENT-STOP 条款跳过通用启动流程；完成结论遵循 verification-before-completion。先建立 P0–P3 矩阵，再审完全部改动与合理反例，不以首个发现提前结束。

设计判断为适度：删除 callable 包装、收窄导出接口、在原 normalizeScope 中检查自有 data descriptor，没有引入 adapter、双实现、迁移或新的 parser 框架。`repositoryId` 省略与显式 undefined 同义，合法仓库身份原样保留；不修剪 ID 后另建身份。P2 只需把可能抛出的数组判定纳入已有错误隔离，不需要增加抽象层。

## Global Constraints

唯一正式写入为本评审文件；临时探针和变异规格位于忽略的 `.superpowers/review-530/`。不写 GitHub、不 commit/push/rebase/merge、不改 Planning Status 或依赖关系。变异仅由 `scripts/review-mutate.mjs` 瞬时施加并逐字节恢复，最终五个产品/正式测试改动文件均与锁定 head 完全相同。

保持 Host 权威、Provider ack 前无权威 Saved、规划与工程状态正交、谱系身份、依赖方向、秘密句柄隔离及失败诚实性。未改变 Provider 实现、Storage/schema、真实 Host ABI、外部写入门禁和交付事实事务算法。

## Plan of Work

1. 锁定 refs、单提交、issue、checks 与全部线程；建立风险矩阵。
2. 审核全部五个产品/测试文件与两个文档文件，搜索全部生产消费者，沿 normalizeScope 的 query/command 路径核对失败早退。
3. 运行目标链路、两壳相关测试、类型与边界检查；在已建立真实执行上下文并已有交付快照后，进行独立畸形输入、原型与 Proxy 探针。
4. 在最终产品树上一次运行六项完整变异表，检查指定 killedBy、还原后基线与文件字节；记录唯一发现及 issue 承接，交协调者统一发布。

本地可复核命令：

```sh
pnpm test:file tests/mvp0/chain.test.js tests/e2e/controller-roundtrip.test.js tests/e2e/delivery-lineage.test.js
pnpm test:file tests/e2e/workspace-read-assembly.test.js tests/integration/harness-plugin-start-work.test.js
pnpm run typecheck
pnpm run boundaries
node --test .superpowers/review-530/adversarial.test.mjs
node --test .superpowers/review-530/revoked-proxy.test.mjs
node scripts/review-mutate.mjs .superpowers/review-530/mutation-spec.json
node scripts/rule-checks.mjs size f5ae377d98c43ed216f680cb72e5f35d73a2b8e1
node scripts/rule-checks.mjs disclosure f5ae377d98c43ed216f680cb72e5f35d73a2b8e1
git diff --check f5ae377d98c43ed216f680cb72e5f35d73a2b8e1...HEAD
```

临时证据不随文档发布；正式行为断言、发现复现步骤、计数与变异规则在下文自包含。revoked-proxy 命令是预期失败的缺陷复现，不能算入通过总数。

## Validation and Acceptance

### 风险矩阵

| 等级 | 代码与反例 | 产品闭环 | 架构边界 | 测试与工作项 | 初审判定 |
|---|---|---|---|---|---|
| P0 | 无数据毁损、秘密输出或主分支破坏 | 主流程可执行 | 没有新增权威源或依赖跳层 | 必需 PR Fast Gate 成功 | 未发现 |
| P1 | 正常、拒读、失败恢复与多仓谱系未见严重回归 | 工作项 → Start Work → 交付摄入/查询成立，Provider ack 约束保留 | 规划/工程正交；真实谱系和事务路径未改 | 目标64/64、两壳相关35/35、边界9/9、typecheck通过 | 未发现 |
| P2 | 已撤销 Proxy 在 Array.isArray 处逃出错误隔离 | 仅本地 JS 非法对象调用；不影响可序列化 Host 请求 | 没有 Provider/Storage 副作用，但违背结构化错误承诺 | 四入口独立复现；现有正式测试未覆盖 | 发现 F1，非阻塞 |
| P3 | 命名、诊断与证据表达审查 | 普通 namespace 与真实缺节点诊断保持 | 清理范围及复杂度适度 | 文档、消费者清单及 issue 范围一致 | 未发现独立缺陷 |

### 代码、产品、架构与消费者台账

| 删除/调整项 | 生产与 fixture 检查 | 保留下来的行为证据 |
|---|---|---|
| `CoreNamespace<T>` 与 `namespace()` | `packages/core/src/context.ts` 正常与 unavailable 装配；全仓 packages/apps/tests 无 `.queries()` / `.commands()`、无 CoreNamespace 消费者 | 两种装配都是 object，叶子仍 callable；抽取成员方法可调用；MVP0 七节点全绿 |
| string DeliveryScope | `packages/core/src/queries.ts`、controller 类型/转发、Host `host-composition.ts`/`host-operations.ts`、client delivery 调用均走对象 | `{workItemId}` 与显式 undefined 等价；真实仓库 scope 保留；四入口对旧字符串返回 invalid_input |
| `ChainSkeleton` 常量 | 只有原 `relations.ts` 定义，无生产或 fixture 消费者 | 未改 `chain-facts.ts` 的未观察节点、交付 gaps、candidate/confirmed 谱系与只读投影 |
| `needMethod` helper | 仅 MVP0 fixture 使用；先检查每段存在、最后判断 callable | 缺 namespace、缺叶子、非函数叶子都带节点、完整路径和链路诊断；逐段 callable 变异被杀死 |

`context.ts` 的命令先 normalize 后进入 `delivery-facts.ts`；写者在时钟、令牌、Provider、Storage 之前检查 isDeliveryScope。查询先 normalize/guard 再进入投影读取；controller 只转发结果，不增加写入。独立探针在合法 Start Work 与一次 applied 刷新之后运行，已有至少三跳和非空快照，因此“不写入”不是空库上的真空结论。

29 种畸形 shape 覆盖 string/null/undefined、数组/稀疏数组、number/bigint/boolean/symbol/function、boxed string/Date、缺字段、空白/非字符串 ID、非法 repository、额外 enumerable/nonenumerable/symbol 字段、仅继承字段、getter/setter/undefined accessor，以及 ownKeys/descriptor 抛错的 Proxy。每种经过 Core/controller query/command 与 Core lineage，共145次：全部结构化拒绝或 lineage 空集，Provider 调用0、Storage 方法调用0，整库快照深相等，getter调用0。合法的 null prototype、自有 data 覆盖继承 getter、冻结对象及 ordinary get 会抛错的 Proxy 均可读取正确仓库谱系，未调用 getter且整库不变。

### Findings

**F1 — [P2] 把 Array.isArray 纳入畸形输入异常隔离（Superseded by 2026-11-04 独立修复复评）。** 新增行 `packages/core/src/delivery.ts:72`。复现：`const r = Proxy.revocable({}, {}); r.revoke();`，把 `r.proxy` 交给 Core/controller 的 `getDeliveryProjection` 或 `refreshDeliveryFacts`。四入口全部抛出/拒绝 `TypeError: Cannot perform 'IsArray' on a proxy that has been revoked`，栈首业务位置均为 normalizeScope 第72行；Core 命令甚至在返回 Promise 前同步抛出。已有 try 从第74行才开始，覆盖不到该数组检查。

影响：本地 JS 调用者无法按 error.code 处理该非法对象，违背本 PR “畸形 scope 结构化 invalid_input”的契约；没有 Provider/Storage 写入，也不能经正常 Host JSON transport 构造，所以为非阻塞 P2。它是收口承诺尚未覆盖的输入边界，不据此推断正常产品链路回归。修复方向：将 Array.isArray 与 descriptor 获取放入同一 try/catch，并补四入口撤销 Proxy 回归，验证零副作用；无需重写 parser。

独立复现命令在当前 head 退出1，四个子用例均因上述 TypeError 失败，父测试因此一并失败（runner显示0通过/5失败）。建议 inline 英文标题：`[P2] Catch revoked proxies before the array check`。现有 open issue 搜索 `revoked` 与 `proxy delivery` 只命中权限/Host/规划记录等非同根因条目，没有独立承接该 IsArray 问题的 issue；应由 #418 本次修复并复评，不重复开清理 issue。#224 的其他测试规则/注入清理仍保留父级范围，不由本 PR 宣称完成。

### 测试与变异判别力

| 证据 | 当前锁定 head 实测 |
|---|---|
| issue规定的 chain/controller/lineage | 64通过，0失败/skip |
| 两壳相关装配与 Host Start Work | 35通过，0失败/skip |
| typecheck / package boundaries | 退出0 / 9通过 |
| 独立正常/畸形/原型探针 | 3通过；29种畸形、145次调用、Provider/Storage各0 |
| 撤销 Proxy 缺陷复现 | 4子用例均失败；不能计作通过 |
| size / disclosure / diff whitespace | 代码115、文档114；均通过；评审文档尚未提交，不在该统计中 |

六项变异在最终产品树上整表仅测一次；command 为 Node test runner 同时执行上述64项与独立3项。每项指定 killedBy；工具验证基线和还原后基线成功，退出0，五个正式变更文件字节与锁定 head 一致。

| 变异 | 改动规则 | killedBy用例片段 | 结果 |
|---|---|---|---|
| M1 | 恢复 string 归一分支 | 交付：对象作用域的单契约可省略仓库 | KILLED |
| M2 | 恢复可调用 queries 包装 | CoreApi 查询与命令是普通对象 | KILLED |
| M3 | helper 每段都要求 function | CoreApi 查询与命令是普通对象 | KILLED |
| M4 | 移除 repository 类型/空白检查 | 交付：对象作用域的单契约可省略仓库 | KILLED |
| M5 | 接受额外字段 | 交付：对象作用域的单契约可省略仓库 | KILLED |
| M6 | 用 get/set 非undefined 替代 data descriptor kind | 交付：对象作用域的单契约可省略仓库 | KILLED |

### Issue 验收与证据边界

#418 三条验收分别有消费者台账/终端helper负控、普通 namespace/object scope/两壳相关验证、无消费者常量删除/真实缺口测试。保留 F1 等待修复复评后再最终勾选；本子评审不写 issue。#224 保持 Refs，不能因本子项关闭推断父级全面完成。PR代码115行、小于500预测上限及800任务预算，不为达到预测填行；没有过度拆分或额外兼容层。

托管当前head的 Verify、Browser、PR Fast Gate、Merge Gate四执行lane与聚合、CodeQL、Issue policy、size/disclosure 均成功。取消的 Issue policy 41617790361 与 Rule checks 41617790359 有同head成功后继41617790562、41617790431；不把取消行误报为未解决红检查。托管检查只证明该head的自动化执行，不等于已安装 Host、真实模型、真仓库端到端、人类验收或 R1。

## Progress

- [x] 2026-11-04：逐文件审查前建立初始 refs、线程和 P0–P3 风险矩阵。
- [x] 2026-11-04：读取当前 issues/ExecPlan、审完全部diff及消费者、产品和架构边界。
- [x] 2026-11-04：目标64、两壳相关35、边界9、类型与独立3项通过；F1四入口独立复现。
- [x] 2026-11-04：最终树六项变异整表KILLED，逐字节还原，无产品/正式测试残留。
- [ ] 协调者统一发布完整review；处理P2、独立复评和远端最终回读。

## Surprises & Discoveries

旧undefined accessor缺陷已由自有value检测及正式四入口用例覆盖，M6确认能杀死旧实现。新增F1说明把一部分对象反射放入try并不等于整个输入检查都不会抛错；应以真正会抛出的JS操作划隔离边界。普通Prototype/Proxy无需一概拒绝，独立正控表明只读自有data descriptor足以避免执行getter。

首次GitHub issue读取遇到TLS握手超时；重试成功后以当前完整正文为准，没有把读取失败解释成无变化。重复CI取消已按同head后继核对，不用历史绿色代替当前事实。

## Decision Log

- 2026-11-04 / 用户授权，由协调者记录：PR #529–531 无P0/P1或仅P2/P3时由本会话修复、独立复评、归档、按交付边界整合并使用rebase merge；有P0/P1且已有实现会话时交其修复。本子评审只返回证据，不执行外部写入或合并。
- 2026-11-04 / 独立评审：F1定级P2，理由是仅恶意/失效本地对象触发、正常Host序列化不可达、无外部副作用；仍建议就本PR机械修复和四入口复评。无P0/P1，不应将测试全绿表述为完整发布验收。

## Idempotence and Recovery

没有新增状态或迁移；功能回退按整个PR revert，恢复实验API不会回滚外部事实。本轮只读GitHub；协调者发布review前须重新锁定head/base，并将commit_id绑定当前head。任何修复、rebase、retarget或force-push后本head结论失效，需重新检查diff、相关证据、threads与checks。若变异或探针被中断，保留临时证据并确认产品字节恢复后才继续。

## Interfaces and Dependencies

本次边界为Core导出对象及DeliveryScope→controller/Host消费者；Provider/Storage只作为不变量观察点。评审读取用gh-review（Singularity-AI-Bot），开发/作者回复/合并由协调者依已有授权执行。无新增依赖；本地Node、pnpm、TypeScript和既有离线Fake/SQLite测试足以验证该范围。跨PR组合六顺序、真实线性预演和组合verify由协调者负责，本记录不替其宣称结果。

## Outcomes & Retrospective

独立初审建议按仓库规则APPROVE并附F1非阻塞inline，随后修复及独立复评；实际发布由协调者统一完成。产品设计与范围恰当，正常消费链和真实缺口未回归；当前head仍留撤销Proxy的结构化错误缺口。未修改任何产品或正式测试文件，未向GitHub写入，未提交或改变分支历史。

下一道门是F1机械修复/四入口拒绝与零副作用复评、修复head正式测试和完整变异表、最终远端回读；已安装Host、人类验收与R1继续由各自证据门承担。

## Bottom Change Note

2026-11-04：先建立风险矩阵，再完成全部diff/消费者/产品/架构/issue审查、当前head最窄测试和最终树六项归因变异；记录唯一P2撤销Proxy缺口，交协调者统一发布与分流。

### 独立修复复评（2026-11-04）

执行检出仍为 `.worktrees/core-namespaces`，提交基线为 `ed13d5a4f2626119dfe39fce3f08bdc8ef11b38d`；本轮评估该基线上的未提交修复树，不能把它当作已发布的新 head。产品修复仅 `packages/core/src/delivery.ts` 2增/1删，正式测试 `tests/e2e/controller-roundtrip.test.js` 新增32行；README/ExecPlan 的归档工作由协调者持有，本 reviewer 未编辑。修复实施者与本复评者独立。

根因已闭合：`typeof` 与 null 判定对 revoked Proxy 安全；会抛出的 `Array.isArray` 和 descriptor 获取现在在同一已有 try/catch 内，捕获后返回 invalid scope。Core/controller query/command 复用原 normalize/guard，四入口均得到 `invalid_input`，不再同步抛错或拒绝 Promise。普通数组仍拒绝；合法对象、仓库作用域、省略仓库、冻结/null prototype、自有 data 覆盖继承 getter 等正控保持。未增加 parser、兼容分支、依赖、持久状态或外部写入，也未改变 Provider ack、Host 权威或 Planning/工程轴。

复评先发现一次测试证据盲点：初版新测试用 `Object.entries(storage)` 包装函数，实测 MemoryStorage 自有键仅 `data`、自有函数0，端口方法均在原型；该版本的 Storage 零调用主张不能成立，整库不变也不能证明没有读。初审临时探针同样使用该枚举模式，其 Storage 零调用数字只保留为历史观测，不作有效覆盖。实施者随后沿原型链 `Reflect.ownKeys` 收集方法、排除 constructor，以 `Reflect.apply` 保留原 receiver；新增真实 `getWorkspace` 读取正控先在旧 instrument 上红（0不等于1），修正后绿并清零。正式四入口断言现在同时覆盖 Provider、Storage 方法调用及整库快照；没有把“能捕获异常”误当作“计数器有效”。

| 本轮独立证据 | 实际结果 |
|---|---|
| `node --test .superpowers/review-530/adversarial.test.mjs .superpowers/review-530/revoked-proxy.test.mjs` | 8通过，exit 0；其中历史 Storage 计数盲点不作有效证据，保留合法 shape/四入口行为证据 |
| `pnpm run typecheck` | exit 0；`.superpowers/repair-530/independent-typecheck.log` |
| `node scripts/review-mutate.mjs .superpowers/repair-530/independent-final-mutation-spec.json` | 原六项与修复两项合并整表仅跑一次，8/8 KILLED，exit 0；command 包含正式 chain/controller/lineage 69项与独立探针3项，施加前/还原后基线均成功 |
| `git diff --check` 与还原校验 | exit 0；context.ts、delivery.ts、正式 controller 测试及 MVP0 helper 四份文件与本轮施加前 SHA256 完全相同，未抹除未提交修复 |

最终变异整表如下，取代初审六项表作为本修复树的判别力记录；spec、输出与字节校验位于 `.superpowers/repair-530/independent-final-mutation-spec.json`、`independent-final-mutation.log`、`independent-before-sha256.json`。

| 变异 | 改动规则 | killedBy 用例片段 | 结果 |
|---|---|---|---|
| M1-legacy-string | 恢复 string 归一分支 | `交付：对象作用域的单契约可省略仓库` | KILLED |
| M2-callable-namespace | 恢复可调用 queries 包装 | `CoreApi 查询与命令是普通对象` | KILLED |
| M3-each-segment-callable | helper 每段都要求 function | `CoreApi 查询与命令是普通对象` | KILLED |
| M4-invalid-repository-accepted | 接受非法 repository | `交付：对象作用域的单契约可省略仓库` | KILLED |
| M5-extra-fields-accepted | 接受额外字段 | `交付：对象作用域的单契约可省略仓库` | KILLED |
| M6-undefined-accessor-accepted | 接受 undefined accessor | `交付：对象作用域的单契约可省略仓库` | KILLED |
| R530-array-outside-catch | 将 Array.isArray 移回 try 外 | `撤销 Proxy` | KILLED |
| R530-storage-before-reject | 在 invalid query 早退前实际读取 Storage.getWorkspace | `Core query` | KILLED |

复评矩阵：P0/P1 无新增发现；F1 P2 已修复且正式测试能杀死旧边界与意外 Storage 读取；P3 无新增发现。代码失败隔离、产品返回、架构所有权、测试判别力、#418 接受与设计适度性均已复核，原 P2 结论由本节取代。局部修复可接受，未发现残余合并阻塞；发布前仍须整合提交、锁定新 head/base、托管 checks/threads 与 issue 接受回读。当前证据不代替安装 Host、人类 UAT 或 R1；本 reviewer 未修改产品/正式测试/计划/README，未 commit 或写 GitHub。
