# PR #524 MMP 交付评审

> 状态：初审三项修复的独立复评完成；结论：APPROVE（当前未提交候选，本次范围无 P0/P1/P2/P3）；评审日期：2026-11-03（Asia/Singapore）。

## Purpose / Big Picture

判断原生 Issue–PR 关联能否作为独立可验收、可合并、可回滚的来源观察交付。先查 P0–P3 风险矩阵，再完成代码、产品闭环、架构、测试、反例、issue 验收与设计适度性检查；本独立子评审仅更新记录，不修改实现、提交 GitHub review 或 commit/push/merge。

## Context and Orientation

锁定 head `afe3975184ca94c7438614b30923b4688b56d2d6`，base `feature/native-link-provider@ebc862f67b2c4da0bdbbd194fd18a8bff93857a2`；执行上下文为检出 `feature/native-link-host` 的 `.worktrees/native-link-host` 根目录。焦点：Host current primary、Project membership、绑定仓库/PR 可见性、独立 native receipt/epoch、Controller/remote 与 metadata 通道。

已读当前 diff、全部 commits、PR 正文、closingIssuesReferences、review/threads 和 checks；初始锁定时所有线程/评审均为空，分页 hasNextPage=false；后续协调者提交的本轮 review 不属于该初始快照。初始远端为 MERGEABLE、Ready、UNSTABLE；PR Fast Gate 与 Merge Gate 均 success。协调者提交本轮两项 P1 与一项 P2 review 后，再锁定时 head/base 未变，mergeStateStatus 为 BLOCKED。取消的 Rule checks/Issue policy 均有同 head 成功运行；#523/#524 最新 Engineering state 的取消由后继 #525 全域重算 41591964923 success 覆盖。可选 Create review session 的三个失败日志均明确为本地评审端点连接失败，归现有 #364，不是代码验收豁免。

## Design / Spec

矩阵于逐文件审查之前已建立；以下填入实际结果。系统边界为 Planning Provider source proof→Development actual visibility ack→Host scoped observation→Controller/client→安全详情；原生来源事实不等于手工 implements 或执行谱系。

| 严重度 | 结果 | 代码、产品、架构、测试与工作项证据 |
|---|---|---|
| P0 | 未发现 | 无 Storage schema/Planning Status/业务关系/执行谱系写入；remote 参数闭集拒绝伪造输入。 |
| P1 | 初审两项均已关闭 | H-P1-1/H-P1-2 的真实 Provider→Host 原精确反例转绿；source/repository/target 晚403、NOT_FOUND、offline/success 对照和晚 capability snapshot 均有判别证据。 |
| P2 | 初审一项已关闭 | H-P2-1 改用经 canonical repo、actual repo/PR ack 验证的 source qualified label；原同名跨仓反例转绿，空/非法 source label 保持 partial 空事实。 |
| P3 | 未发现 | 211 行只读 owner 保持单一职责，无新增持久化/兼容机制；修复应沿现有 receipt 收敛。 |

## Global Constraints

Host 拥有权威状态；Planning Status、原生依赖、业务关系确认与执行谱系不得被 source_observed 冒充。所有补充反例仅写运行态 `.superpowers/`。审查使用 Superpowers 的证据/判别验证约束、Qian Systems Router 的系统接合与 First Principles Development 的 review/invariant 模式。独立评审不代替协调者后续授权动作。

## Plan of Work

- [x] Batch 1：锁定 immutable head/base、全部 threads/checks/issues，先矩阵后全层审查。
- [x] Batch 1：跑最窄相关测试、反例与正式 review-mutate；搜现有 90 个 open issues。
- [x] Batch 1：完成结论并回传协调者，一次性外部 review 由协调者负责。
- [ ] Batch 2：如有修复，由指定 owner 实施；在新 immutable head 独立复评，旧通过不外推。
- [ ] Batch 3：协调者按当前远端与人类授权完成记录、提交整合与最终交付；本子评审不执行。

## Validation and Acceptance

| 验收项 | 当前判定 |
|---|---|
| #518 current scope、分页、完整零集合 | 现有正常/错误/循环/100页边界通过；current primary、member 与仓库版本 A→B→A、late success 有断言。 |
| #518 permission loss/late reply 不暴露受限事实 | 初审失败；本次未提交修复的独立复评通过。实际拒读观察位于 race 内，明确 NOT_FOUND 撤销 native receipt；offline 保值与晚 success 不摄入正控保持。 |
| #518 actual refresh 可恢复且不恢复 lineage health | 现有有效拒读路径通过；已持久化 delivery health 不变；不能抵消两个反例。 |
| #518 设计与判别测试 | 49/49 原定向测试通过；H1–H3 全 KILLED；补充两个预期空集合的实际生产反例均失败。 |
| #518 产物及安装边界 | 既有安装 source 0e9257f/artifact eff55818 有三历史例及 23 计数相同；只证明命名版本/窗口的读取，不证明新拒读路径或 R1。 |
| #518 规模 | 576 代码/测试/配置/fixture 行、144 文档行，少于 800/1300。 |
| #508 父验收 | 本次修复范围的权限/late reply 条件已通过独立复评；仍须由协调者将命名候选整理发布、回读当前远端并做组合接受，不能以本次局部复评直接关闭 #508。当前 closingIssuesReferences 只关联 #518。 |

初审准确 head 在上述根目录执行 `pnpm test:file tests/integration/issue-closing-links-scope.test.js tests/integration/harness-plugin-issue-closing-links.test.js tests/e2e/workspace-read-assembly.test.js`：49/49 通过、0 失败。原始输出保存在仓库根运行态 `.superpowers/mmp-review-20261103/native-host-tests.log`。`git diff --check ebc862f67b2c4da0bdbbd194fd18a8bff93857a2...afe3975184ca94c7438614b30923b4688b56d2d6` 退出 0；生产文件经变异还原后与该 head 无差异。全组合 verify/browser 由协调者独立执行，本记录不冒认其结果。

变异均以当前最终生产/测试树运行 `node scripts/review-mutate.mjs .superpowers/mmp-review-20261103/mutation-spec.json`；每项有 killedBy，脚本报告原文逐字还原及还原后基线绿。此执行上下文下的 mutation-result.json 保存真实输出。

| 变异 | 故障 | killedBy | 结果 |
|---|---|---|---|
| H1 | 省略分页 source repository 一致性 | `each source page must prove the same canonical Issue repository` | KILLED |
| H2 | 查询忽略 cache epoch | `native authority denial fences other Issue receipts` | KILLED |
| H3 | partial 冒充 complete | `only terminal source proof proves zero` | KILLED |

### H-P1-1：预算后才返回的实际拒读没有撤销 Host 可见性（初审；本批已关闭）

新增位置：`packages/core/src/issue-closing-links.ts:86`（消费位置 120/132/143/162）。`bounded` 的 Promise.race 在 10 秒后先以 partial 结束；`result` / `allowed` 位于 race 外，因此底层 30 秒预算内迟到的实际 403 只更新真实 Provider permission，不再触发 Host observeAuthority。

复现：先完成一次原生读取；第二次第一页完成并确认目标 PR，第二页挂起；时钟推进 10001 ms，Host 返回含第一页 PR 的 partial；再释放实际 source 403。通过仅包裹目录 create 捕获的真实 Planning 实例，permission 从 available 变为 unavailable；Host nativeAccessVersion 前后均不存在，watch.poll 无 metadata，纯 get 仍带 PR title/id/URL。该脚本替换 HTTP transport，未 stub Provider 方法、decoder、Host 或最终 DTO。

影响：已观察的拒读无法撤销先前安全事实，#525 也收不到权限签名变化，用户可继续看到已受限记录。最小修复：在被 race 的真实 Promise continuation 内先记录实际拒读；成功仍须在预算/current scope 校验后才可授予证明或摄入。覆盖 source、target、repo 与 capability probe 的同类晚回，不写旧 delivery health。

### H-P1-2：当前来源 NOT_FOUND 被当成离线保留旧完整结果（初审；本批已关闭）

新增位置：`packages/core/src/issue-closing-links.ts:99`–`100`（保留分支 199）。`ProviderResult.not_found` 明示目标不存在或对当前凭据不可见，不能等同网络 unavailable。当前映射不撤 visibility receipt，并以旧 complete 缓存加 stale 返回。

复现：实际生产读取成功后，Project 探测仍成功，但 Issue closing query 返回 HTTP 200 + GraphQL NOT_FOUND。真实 Provider permission 变为 degraded；refresh 与随后的 get 都返回旧 complete/stale 链接，nativeAccessVersion 不变且 watch 无 metadata。项目可见但 Issue/repo 不可见是可到达场景。反例仅替换 HTTP response，使用实际分类器、Provider 和 Host remote。

影响：一条明确无法证明当前可见性的来源响应仍留下标题、ID、URL；跨 Issue 的旧 receipt 也不会被撤销。最小修复：对来源/仓库/PR 的明确 missing/invisible 结果撤销相应 native 可见性证明并清除受限事实；单独保留网络 offline 的 last-known 语义，不污染执行谱系或 delivery health。

### H-P2-1：不同 owner 的同名仓库无法从展示文字辨认（初审；本批已关闭）

新增位置：`packages/core/src/issue-closing-links.ts:168`（name 取自 137）。GitHub actual getRepository 的 name 是短名；当前 facts 丢掉 source 已有的 qualified repository.name。因此 ownerA/project#1 与 ownerB/project#1 可呈现同样的 `project · #1 · Same title`。实际 canonical repositoryId 与外链不同，未串仓或越权；用户仍可通过外链/hover 核对，所以定为 P2。

受控 Core 反例已得到两条 complete facts：repositoryId 分别 repo-alpha/repo-beta、URL 分属 ownerA/ownerB，但 repositoryName 都是 project。最小修复：保留经 canonical repository identity 和实际 scope 核对后的 qualified display label，不要求新仓库模型。

三项完整复现脚本及真实输出分别位于此执行上下文的 `.superpowers/mmp-review-20261103/late-denial-production.test.mjs`、`notfound-production.test.mjs`、`repository-label.test.mjs`；前两项各 1 失败，第三项继承 11 既有测试通过后独立 1 失败。

## Progress

- [x] 2026-11-03：P0–P3 矩阵先于审查建立。
- [x] 2026-11-03：完成全层审查、命名版本测试、反例、变异与 issue 验收核对。
- [x] 2026-11-03：形成全部 findings；没有在首项 P1 停止。
- [x] 2026-11-03：review 5748400748 的两项 P1/一项 P2 在未提交修复上完成独立复评，原三条精确反例转绿；无新 P0/P1/P2/P3。
- [ ] 候选整理为命名提交、远端 CI/threads 和最终组合门禁由协调者继续；本地通过不等于托管/安装/R1。

## Surprises & Discoveries

普通 403、跨 Issue 并发与 deadline 各自被测试，并不意味着二者组合已覆盖。两个 P1 反例不修改生产实现；它们证实原 49 绿测与 H1–H3 有效判别仍遗漏安全边界。

## Decision Log

2026-11-03：保留主控记录的人类授权背景：用户要求本轮评审并由主控接手修复、re-review、归档、整合、issue 核对和逐 PR rebase merge。独立子评审按分工只读实现与远端，唯一工作区写入是本记录和运行态证据，不自行解释为 merge 授权。

2026-11-03：初审结论为 REQUEST_CHANGES；修复后独立复评结论为 APPROVE，绑定下述未提交候选的文件摘要。现有 #508/#518 直接拥有新发现的 scoped visibility 验收，90 项 open issues 中未见另一个独立同根因项；#72/#150 是不同执行/业务关系责任，不能据此转移本次缺口。#364 仅承接可选 review webhook 的基础设施失败。

## Idempotence and Recovery

未改生产代码、未写 Git refs 或远端。补充反例可重复；正式变异由 repository review-mutate 原文恢复。head/base 漂移即停止沿用结论，重锁受影响差异与验证；回滚按 consumer→Host→Provider 次序，无 schema 迁移。共享历史收尾由协调者建立 backup ref 与精确 lease。

## Interfaces and Dependencies

原生栈顺序 #523→#524→#525；底层 optional 端口可独立留存，上层可独立撤销。#525 接合其他详情布局 PR 时必须同时保留 presentationScopeKey 与 issueClosingLinksReader；协调者已在组合中处理此交点，本独立评审未修改该文件。任何 native 读取成功均不得清旧 delivery health、创建 ExecutionContext 或确认手工业务关系。

## Outcomes & Retrospective

初审 REQUEST_CHANGES；本次修复独立复评 APPROVE，原三项意见均已关闭，复评范围未发现新的 P0/P1/P2/P3。修复由主控实施，本独立 reviewer 未修改生产/测试或 Git 状态。历史安装记录不自动证明当前未提交修复的安装接受、托管 CI 或 R1。

### 修复候选与独立复评（2026-11-03）

复评基线为 `afe3975184ca94c7438614b30923b4688b56d2d6` 加主控未提交修复；下列 SHA256 在复评前和正式变异还原、类型检查后逐项相同：

| 文件 | SHA256 |
|---|---|
| `packages/core/src/issue-closing-links.ts` | `b1bf6a3093614b19ca1917f5816ba01974f8dc3b6b7f3b16bd62d21c1dd73c25` |
| `tests/integration/harness-plugin-issue-closing-links.test.js` | `c09d99defe6b314d3963bc19e8240e8fba1cf62a28663bfb07149a45f9175c74` |
| `tests/integration/issue-closing-links-scope.test.js` | `f1a19b2550fea33565737a27f3dfbc5ca9e86533b48cb03046dca58e2e6b7ff7` |

设计核对：`actual` 将 `result` 放入实际 Promise continuation，capability `allowed` 同样放入 race 内；预算限制等待/成功摄入，否定证据仍换 native epoch。晚成功不走 current proof/缓存发布。missing Set 按完整 source refs、repo ref、repo+native identity 分开去重，容量 100；明确 missing 只推进 native fence，不冒称 binding denied。当前 epoch 下身份校验后的成功仅清对应 resource，不能清其它 Issue/resource；global epoch 不倒退，也不清持久化 delivery health。qualified label 的可信来源是返回该 canonical repo 的来源 Provider，Host 仍核实际 repo 与 exact native PR；没有新增仓库模型或 URL 猜名。

在相同 `.worktrees/native-link-host` 根执行 `node scripts/resolution-check.mjs` 后，以 `node --test --test-timeout=120000` 运行两份 integration 测试和原 `late-denial-production.test.mjs` / `notfound-production.test.mjs` / `repository-label.test.mjs`：51/51 通过，原三条精确反例全部转绿。pnpm 包装入口首试在自动 install 的无 TTY modules-purge 提示前终止，未作为测试失败或绿测；独立复评改用同一 resolution-check 与原生 Node runner，不执行依赖清理。

独立补充 `re-review/independent-boundaries.test.mjs` 为 23/23：其中继承 12 条 scope 测试，新增 11 条分别覆盖 source/target 迟到 denied capability snapshot（2）、source/repository/target malformed 身份不能清 missing（3）、跨 Issue 与跨 epoch 的旧 success 隔离（1）、source 标签空白/缺失/null/数字拒绝（5）。重复同一 missing 版本稳定；当前正确回证后下一次 missing 再次失效；其它 Issue 成功与旧 epoch success 不能解除 A 的 missing。

正式变异只在通知主控暂停同树工作后执行；`node scripts/review-mutate.mjs .superpowers/mmp-review-20261103/re-review/mutation-spec.json` 的 7 项全 KILLED，均有正确 killedBy；脚本原文还原与还原后基线绿，文件摘要前后一致：

| 变异 | killedBy | 结果 |
|---|---|---|
| F1 将 result 移回 race 外 | `late actual visibility evidence survives the Host deadline`，source/repository/target 的 forbidden/missing 共 6 条红 | KILLED |
| F2 将 allowed 移回 race 外 | `independent late denied capability snapshot fences cached facts`，source/target 两条红 | KILLED |
| F3 NOT_FOUND 冒充 offline | `actual NOT_FOUND drops receipts without claiming denial` | KILLED |
| F4 重复 missing 每次推进 epoch | `actual NOT_FOUND drops receipts without claiming denial` | KILLED |
| F5 任意成功清全部 missing | `independent missing resources separate Issues` | KILLED |
| F6 qualified label 退回短名 | `canonical repositories with the same short name retain qualified source labels` | KILLED |
| F7 不验证 source label | `independent source label must be explicit nonempty text`，5 条非法值断言红 | KILLED |

`node node_modules/typescript/bin/tsc --noEmit` 与 `git diff --check` 退出 0。当前本 PR 对 base 的代码/测试/配置变化为 655 行，仍少于 800；文档/运行态不会伪装成生产改动。以上真实输出与摘要位于此执行上下文 `.superpowers/mmp-review-20261103/re-review/`。本次没有独立重复整栈 verify/browser 或真实安装，它们由协调者在新命名组合上验证。

## Bottom Change Note

2026-11-03：在预建矩阵上填实际代码/产品/架构/测试/issue 结果，记录 immutable head、真实执行上下文、三层接合与全部反例；只新增评审证据，不更改实现。

2026-11-03：补记 review 5748400748 修复的独立复评：原三例转绿，11 条新边界、7 项归因变异、类型检查与恢复摘要通过；结论 APPROVE 仅绑定命名的未提交候选。

2026-11-03：新组合实际安装接受已由独立执行者完成，主控再次核对tarball SHA和12个已安装文件/完整文件集合逐字节相同；source33472f2b与artifact7209b6e6…115a。三历史例、qualified label、来源时间/安全外链及23计数观察均成立；光暗/窄短原生zoom200%8布局与联合状态保持通过。当前自身最终重放仍需独立刷新矩阵及 hosted gates，R1不随此接受。

2026-11-03 最终实际前序回读：在检出 `feature/native-link-host` 的 `.worktrees/native-link-host` 根，基于 `main@3ed3e4ae00b571cead65c7716ab18b3558973d61` 完成 frozen install、typecheck 与 `pnpm test:file tests/integration/issue-closing-links-scope.test.js tests/integration/harness-plugin-issue-closing-links.test.js`，输出 ℹ tests 36 / ℹ pass 36 / ℹ fail 0 / ℹ skipped 0 / ℹ todo 0，exit 0。原生依赖只按真实前序重放，当前 head/CI/threads/issue 仍由文中 GH 回读命令确定；本次提交没有继承旧 SHA 的批准。最终组合 `33472f2b` 与新包 `7209b6e6…115a` 的实际接受边界见批次评审。
