# 原生 Draft PR 创建 ExecPlan

> 状态：Active；创建：2026-11-06；执行分支：`feature/draft-pull-request`
> 范围：#548；Refs #72、#143、#545；遵循根级 `PLANS.md`。

## Purpose / Big Picture

操作者能明确选择“创建为草稿”，工作台一次调用 GitHub 原生 Draft 创建，并根据可验证的 PR 事实确认结果。
最小证据是表单选择贯通实际 Host/Core 到单次 mutation 的 `draft:true`，读回 `isDraft:true` 后才显示权威确认。
普通创建保留现有默认；未知恢复读取原操作，不创建第二个 PR。已确认 Draft 后来在平台 ready 仍能定位原 PR。

## Context and Orientation

用户于 2026-11-06 批准四 issue、三独立 PR：#547、#548、#538+#542；本计划只负责 #548。
用户明确未发布产品不需要旧数据/旧设计兼容；本轮不授权迁移、删除旧实验操作或调用真实模型。
当前 `packages/core/src/create-change-request.ts` 已有一次写、持久 marker/fingerprint、同 head 未决槽位与只读 resume。
`packages/capabilities/src/storage.ts` 的 `externalIntentSnapshot` 显式复制 PR 字段，单加类型会丢失持久 draft。
GitHub Provider 创建目前不发送 draft，查询 fragment 不含 isDraft；现有标题/正文匹配不能证明 Draft。
`packages/client/src/create-change-request.ts` 的严格 DTO 白名单、操作摘要与 UI 恢复显示也必须同步。
Draft 是 PR 当前状态及创建意图，不是 open/closed state、reviewState 或 Planning Status。
两独立设计已由第三方对照源码审读，最终取舍在此自包含记录。

## Design / Spec

### 输入与界面

创建表单新增显式 checkbox“创建为草稿”，默认 false；保留现有普通 PR 创建预期，不假定操作者偏好。
checked 时按钮显示“创建草稿 PR”；未选显示“创建 PR”。pending 冻结选择，item/repo/owner 变化清空到默认。
`draft?: boolean` 贯通 UI/client/Host/controller/Core/Provider 输入；缺省等价 false，Core 新请求准入时归一为明确 boolean。
所有显式值仅接受 boolean；字符串、null、对象被拒绝，零 mutation。沿用各入口既有存取器策略；允许 getter 只捕获一次、throw 安全失败，既有严格入口继续拒绝，不为新字段扩大通用描述符禁令。await 后不重读 caller。
持久 operation 摘要返回原 `draft` 布尔，严格 DTO 校验；重挂/重启显示原“草稿 PR / 普通 PR”选择，不用当前 checkbox 修改原操作。
resume 继续只接收 operationId 与原 scope/observer，不接收 draft/title/body 新输入。

### 持久意图与一次外部写

归一后的 boolean 无条件进入新请求 canonical fingerprint 和 externalIntent；same key 或同 head 未决槽位不同 draft 必须 conflict。
规范只服务当前请求形状；不为 false 构造旧 fingerprint 分支，不引入 version adapter、DDL、双读写或历史数据自动升级。
旧实验 fingerprint/intent 若当前校验无法支持，诚实返回 invalid_operation/conflict/unknown，保留资源与账本，仅可人工处置；绝不猜测再 create。
Provider mutation 一次发送 `draft: intent.draft`；禁止“先普通 PR 再 convert”、自动 ready、merge 或真实平台测试 PR。
`ProviderChangeRequest` 添加 `isDraft?: boolean` 已知事实：GitHub 普通 read decode 在字段存在时验证 boolean，缺失保留未知；其它 Provider 同样不能把缺失当 false。
GitHub get/list/create 的统一 fragment 携带 isDraft；create ack decoder 必须取得 boolean 并严格核对期望值；普通读取不为缺失值伪造 false，也不为本轮创建证明强迫无关历史 fixture 补值。
合成 transport 响应显式标注为 synthetic；涉及录制 query hash/观测字段的 tape 只按既有只读录制流程更新，不能伪造历史观测。

### pending/unknown 与 saved 的不同确认规则

首次创建 ack 与 pending/unknown observer 均要求已知 isDraft 等于持久期望；缺失、反值、多个匹配、分页不完整都不能 Saved。
沿用 repo/head/title/body/marker/native identity 与精确 get 回读；不得仅凭相同标题或一个 Draft 字段确认。
若 Draft 在首次确认前已被平台转 ready，当前证据无法证明原 Draft 创建，保持 unknown/conflict并提供既有恢复路径；不转回、不重建。
操作一旦 saved，confirmedRef 已是已确认身份；之后平台 ready 是新的当前事实，不得使原 operation 无效或触发第二创建。
saved resume 走现有 `finish` 身份/授权校验，不重新强求 isDraft 等于初始意图；当前谱系可展示平台实际事实，原摘要仍标示当时请求类型。
因此“首次结果未知而 isDraft 不符”与“已 saved 后平台 ready”必须有两个不同测试，不能用一个条件混淆。
Host 继续拥有 Saved 权威，只有 Provider ack/reconcile 与本地结算完成才能确认；不引入乐观 Saved。

### 方案取舍

采用可选布尔端到端：复用现有一次创建与账本，只增加明确意图及可读证据。
拒绝固定 Draft 专用操作：会收窄现有普通 PR 能力并新增命令维护成本。
拒绝先创建再 convert：两次写无法保证最初发布就是 Draft。
拒绝仅在 Provider 硬编码 true：UI/账本/恢复无法说明操作者授权，也破坏普通创建正控。
拒绝全面兼容旧实验账本：未发布范围无此要求，且静默升级会使错误输入被视作新权限。

## Global Constraints

唯一完整改动集合：`packages/capabilities/src/{development-provider,storage}.ts`；`packages/core/src/create-change-request.ts`；`packages/providers/development-github/src/{provider,queries,decode}.ts`；`packages/providers/fake/src/development.ts`；`packages/client/src/create-change-request.ts`；`packages/ui/src/create-change-request-section.ts`；下述共享区域；已有 development-github-create/contract、create-change-request、change-request-operation、UI/Host ABI/插件 integration tests 及其直接 fixtures/tapes；本计划及必要用法说明。
共享接口唯一 writer 是 #547 handoff owner/integrator：本 PR owner 交付 `packages/controller/src/commands.ts` 的 CreateChangeRequest 类型/whitelist/createChangeRequest 成员、`apps/harness-plugin/src/host-operations.ts` 的 createChangeRequest descriptor、`apps/harness-plugin/src/host-composition.ts` 的 PR handler/summary、`apps/harness-plugin/src/client.ts` 的 create adapter，以及 `tests/contract/harness-host-operations.test.js` 的 PR 专属断言最小 patch。
integrator 在 Draft worktree 串行应用、验证 patch，不把 task 字段带入本 PR；通用 helper 若需变更由其一次裁决并同步双方，不能并发编辑同一成员。
两个 feature 分支均独立 main-base，无隐含 stack；最终组合检出验证两 ABI 与状态语义共存。`docs/README.md` 由协调者维护。
每 PR code/test/config 增删少于 800 行、文档少于 1300 行；tape 变动也须审阅预算，不靠伪造/减少安全验证省行。
无新 domain 枚举、DB schema、legacy compatibility、Provider authority 跳层或第二谱系识别机制。
不修改 Status/dependency，不调用模型/操作 Desktop/真实创建 PR，不自动合并；本工程 PR Ready 与产品创建的 Draft 状态是两个独立概念。

## Plan of Work

以下命令在检出 `feature/draft-pull-request` 的 `.worktrees/iteration9-draft-pr` 根目录运行，记录实际 head/时间/结果。

### Batch 1 · 设计冻结与 Draft PR

最小闭环：固定 Draft 默认、首次确认与 saved 后变化语义，形成关联 #548 的 draft PR。
涉及主文件：本计划；建立现有行为基线和新测试设计。
步骤：核对 worktree realpath、分支与状态；形成描述及风险/rollback；由协调者整理文档提交、开 draft PR，确认同仓 issue 关联。
验证命令：

    pnpm test:file tests/contract/development-github-create.test.js tests/integration/change-request-operation.test.js
    git diff --check origin/main...HEAD

期望：既有行为 pass；设计不要求真实外部 mutation 或新模型调用。
回滚：撤销本批文档提交，不动任何已存在 PR 或账本。

### Batch 2 · RED → GREEN 原生 Draft 闭环

最小闭环：先用新 draft fixture 证明当前字段缺失失败，再实现选择、持久意图、mutation 与精确 ack/reconcile。
涉及主文件：`packages/core/src/create-change-request.ts`、GitHub provider/decode、PR integration/contract tests。
RED 要钉住 draft true/false/default、错类型零 transport、ack 缺/反 isDraft、changed draft conflict、caller mutation 与持久摘要；不能只改快照金样。
GREEN 同步 input/snapshot/DTO/fragment/decode/Fake 返回；共享文件向 integrator 交 patch，按串行协议落地。
SQLite restart 与丢 ack 用例必须证明原 operation 只读恢复、一条 PR 与一条显式关系；saved 后 ready 继续 addressable，首次 unknown 后 ready 保持未知。
验证命令：

    pnpm test:file tests/contract/development-github-create.test.js tests/integration/create-change-request.test.js tests/integration/change-request-operation.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/contract/ui-create-change-request.test.js
    pnpm test:file tests/contract/development-github-contract.test.js tests/contract/harness-host-operations.test.js

期望：全部 pass；mutation count 为一次；resume 为零 create/convert；普通默认 false 正控保留。
受影响录制字段必须真实只读重新采集并记录来源；若无凭据则标出该 evidence 未完成，不假装 synthetic 为真实观测。
回滚：撤销本批产品提交，保留远端 PR/账本；unsupported 新意图诚实只读拒绝，不按普通 PR 重发。

### Batch 3 · 独立验收、整理与 Ready

最小闭环：独立审读所有首次确认/恢复路径，验证 UI 真实组合与共享 ABI，再提交可审阅最终 head。
涉及主文件：本计划的实际证据与必要判别测试修订。
验证命令：

    pnpm typecheck
    pnpm boundaries
    pnpm test:file tests/browser/workspace-execution.test.js
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,mergeStateStatus,statusCheckRollup,closingIssuesReferences,reviewDecision
    gh pr checks --repo SingularityKChen/harness-projects

期望：相关验证、人工五类目及实际规模通过；远端最终 head/base、全部线程、issue 关联、checks 回读，`PR Fast Gate` pass；已知 advisory 若存在逐项说明。
integrator 在三个最终 head 的组合检出运行两 feature integration suites、Host ABI suite、typecheck 与 boundaries；复核 descriptor 参数序与严格字段，防止 task/Draft hunk 相互覆盖。
整理 debug/fixup，必要的已推历史重写先 backup ref 与精确 lease；最终 head 验证后由协调者标 Ready，不合并。
回滚：整 PR revert，不更改既有 PR 的 Draft 状态，不删除 PR/branch/账本。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 显式选择及默认保留 | UI true→Host→Core→GitHub variables true；false/缺省均 false 正控 |
| 真实意图持久 | fingerprint、externalIntentSnapshot、SQLite restart 摘要含原 draft；caller mutation 不影响 |
| 初次确认严格 | ack/observer isDraft 缺失或反值保持 unknown；正确且其它身份匹配才 Saved |
| 幂等/未知不新增 | same key/head pending changed draft conflict；drop ack/restart resume create count 不增 |
| saved 后 ready 可寻址 | current-shape saved confirmedRef 保留；外部改 ready 不 convert、不 create、不 invalid |
| 权限/目标/歧义守卫 | binding/target变化、multiple marker、分页不完继续现有 conflict/unknown 行为 |
| UI 原操作诚实显示 | pending 冻结；重挂显示原草稿类型；resume 仅 operationId，不采用新 checkbox |
| 评审可复核 | 独立审读、最终远端 readback、发布/规模/组合验证记录 |

工程 Ready 不要求真实创建测试 PR、付费模型或完整手工 UAT；Desktop 安装件、#545 原授权试验与 #72/#143/#449/R1 人类验收保持独立。

## Progress

- [x] (2026-11-06 SGT) 读两独立设计与 owning code，锁定默认 false 及两类恢复判据。
- [ ] (2026-11-06 SGT) Batch 1：设计冻结、baseline、draft PR 回读。
- [ ] (2026-11-06 SGT) Batch 2：判别 RED/GREEN 与持久恢复证据。
- [ ] (2026-11-06 SGT) Batch 3：独立验收、组合验证、最终 Ready。

## Surprises & Discoveries

2026-11-06 源码审读：externalIntentSnapshot 白名单会丢弃仅新增到接口的 draft，必须同时扩展保存投影。
2026-11-06 源码审读：saved resume 已直接走 finish，不重新 observer；保留此边界可正确接受平台后续 ready，而 pending/unknown 必须检查 isDraft。
2026-11-06 综合发现：给 canonical 增加归一 boolean 会使旧实验 fingerprint 失配；这是本轮显式无兼容范围的已知成本，不能靠再创建掩盖。

## Decision Log

2026-11-06 / 人类授权、综合审读者记录：四 issue/三 PR，本计划仅 #548，不挪用 #545 为产品实现 issue。
2026-11-06 / 协调者确认、综合审读者：checkbox 默认 false；理由是保留已存在普通创建选择，true 具备完整严格验证。
2026-11-06 / 综合审读者：pending/unknown 严格匹配 draft；saved 后依 confirmedRef 身份，不把可变状态当原 PR 身份。
2026-11-06 / 人类范围、协调者确认：新 canonical 始终包含归一 boolean；拒绝 false-only legacy 分支。旧实验意图可能需人工恢复，保留且不重放外部写。

## Idempotence and Recovery

同原 key 与同完整意图可重放，只读 resume 可重复；不接受在原 operation 上变更 draft。
Provider 未确认或本地结算失败继续 unknown；恢复只观察，不 convert 或 create。错误不推导“不存在 PR”。
saved 的当前形状操作按 confirmedRef 与 scope/授权恢复，平台当前 ready 不撤销当时已确认的创建事实。
不支持的历史形状报告真实阻塞并保留账本；没有迁移、自动清理、普通创建 fallback。
整 PR 回滚不撤销外部效果；若引入必要但延期的维护缺口，先登记 `docs/exec-plan/tech-debt-tracker.md`，不能以债务名义弱化 Saved。

## Interfaces and Dependencies

依赖现有 GraphQL transport、GitHub query/tape 契约、SQLite/fake 与 Host ABI；合成 mutation tests 不需平台写权限。
GitHub `CreatePullRequestInput.draft` 与 `PullRequest.isDraft` 为 Provider 原生能力；实际结果仍按本 PR decoder 与契约验证。
读录制需要既有只读凭据；不得打印凭据、内部地址或本机路径，synthetic/录制证据分开标注。

## Outcomes & Retrospective

本次只形成审读后的计划，没有产品实现、新测试运行、真实平台 mutation 或 Desktop/模型验收。
工程完成后写实际结果/偏差，迁至 completed；协调者维护索引，保留所有未执行人类验收的边界。

## Bottom Change Note

2026-11-06 SGT：综合独立设计，采纳默认 false、首次匹配与 saved 后 ready 区分、无历史兼容及单 writer 接口集成规则。

2026-11-06 SGT：收窄 getter 契约为保持既有入口规则与一次捕获，不要求全 Provider 输入拒绝存取器。
