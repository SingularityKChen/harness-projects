# PR #523 MMP 交付评审

> 状态：初审全矩阵完成；结论：APPROVE；评审日期：2026-11-03（Asia/Singapore）。

## Purpose / Big Picture

判断原生 Issue–PR 关联能否作为独立可验收、可合并、可回滚的来源观察交付。先查 P0–P3 风险矩阵，再完成代码、产品闭环、架构、测试、反例、issue 验收与设计适度性检查；本独立子评审仅更新记录，不修改实现、提交 GitHub review 或 commit/push/merge。

## Context and Orientation

锁定 head `ebc862f67b2c4da0bdbbd194fd18a8bff93857a2`，base `main@957451c684c546ddf8a5d19cb3a23a719940fa9b`；执行上下文为检出 `feature/native-link-provider` 的 `.worktrees/native-link-provider` 根目录。焦点：Provider 逐页 source proof、canonical 仓库及 PR 身份桥、输入零请求拒绝、权限观察 epoch。

已读当前 diff、全部 commits、PR 正文、closingIssuesReferences、review/threads 和 checks；初始锁定时所有线程/评审均为空，分页 hasNextPage=false；后续协调者提交的本轮 review 不属于该初始快照。当前远端为 MERGEABLE、Ready、UNSTABLE；PR Fast Gate 与 Merge Gate 均 success。取消的 Rule checks/Issue policy 均有同 head 成功运行；#523/#524 最新 Engineering state 的取消由后继 #525 全域重算 41591964923 success 覆盖。可选 Create review session 的三个失败日志均明确为本地评审端点连接失败，归现有 #364，不是代码验收豁免。

## Design / Spec

矩阵于逐文件审查之前已建立；以下填入实际结果。系统边界为 Planning Provider source proof→Development actual visibility ack→Host scoped observation→Controller/client→安全详情；原生来源事实不等于手工 implements 或执行谱系。

| 严重度 | 结果 | 代码、产品、架构、测试与工作项证据 |
|---|---|---|
| P0 | 未发现 | 不执行 mutation、不新增持久化事实或凭据；可选接口未破坏旧能力。 |
| P1 | 未发现本层缺陷 | 每页含空页回证 Project/member/Issue/repository；native getter 在 Provider 内核配置仓库与 exact PR；实际拒读 epoch 跨目标隔离旧 success。Host timeout/NOT_FOUND 的缺口归 #524。 |
| P2 | 未发现本层缺陷 | 空页、重复、null、错误 enum、partial GraphQL errors、错绑定、快照输入与来源 URL 均有判别断言。 |
| P3 | 未发现 | 没有为身份桥增加第二事实源、兼容层或全史 PR 扫描；实现尺度适当。 |

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
| #517 原生历史链接与每页证明 | 通过本层审查；显式 includeClosedPrs=true，不使用 timeline/willCloseTarget 推断；空页亦带 source proof。 |
| #517 设计、判别测试与对抗 | 通过；162/162 定向；N1–N3 均 KILLED。 |
| #517 实际来源/产物证据 | 已回读运行态 final-head-live：sourceHead 等于当前 head，三历史例 115→159、110→111、233→397，各终止单页且目标 actual ack 对应；共 7 次只读请求、externalMutations=0。不是安装产品/R1 证据。 |
| #517 规模 | 592 代码/测试/配置/fixture 行；126 文档行，均少于 800/1300。 |
| #508 父验收 | 本片只 Closes #517、Refs #508；后续 Host 当前两项 P1 未通过，不能由本片局部通过关闭父项。 |

当前准确 head 在上述根目录执行 `pnpm test:file tests/contract/planning-issue-closing-links.test.js tests/contract/development-github-contract.test.js tests/contract/development-github-create.test.js tests/contract/capabilities-keys.test.js tests/e2e/delivery-lineage.test.js tests/integration/provider-binding-registration.test.js`：162/162 通过、0 失败。原始输出保存在仓库根运行态 `.superpowers/mmp-review-20261103/native-provider-tests.log`。`git diff --check 957451c684c546ddf8a5d19cb3a23a719940fa9b...ebc862f67b2c4da0bdbbd194fd18a8bff93857a2` 退出 0；生产文件经变异还原后与该 head 无差异。全组合 verify/browser 由协调者独立执行，本记录不冒认其结果。

变异均以当前最终生产/测试树运行 `node scripts/review-mutate.mjs .superpowers/mmp-review-20261103/mutation-spec.json`；每项有 killedBy，脚本报告原文逐字还原及还原后基线绿。此执行上下文下的 mutation-result.json 保存真实输出。

| 变异 | 故障 | killedBy | 结果 |
|---|---|---|---|
| N1 | includeClosedPrs 置 false | `closing source keeps historical159` | KILLED |
| N2 | 不递增 source denialEpoch | `late older source success cannot erase a newer denial receipt` | KILLED |
| N3 | 省略 Issue id 相等校验 | `closing source verifies current membership/project/Issue/repository` | KILLED |

未发现可操作的 P0/P1/P2/P3 finding。

## Progress

- [x] 2026-11-03：P0–P3 矩阵先于审查建立。
- [x] 2026-11-03：完成全层审查、命名版本测试、反例、变异与 issue 验收核对。
- [x] 2026-11-03：形成全部 findings；没有在首项 P1 停止。
- [ ] 修复后的新 head 复评和最终门禁由协调者继续；无缺口前不标交付完成。

## Surprises & Discoveries

实参参数变异证明 query 契约，不证明去掉参数必然丢失 merged #159；归档来源 receipt 本身保留 #159。当前语义与 installed 接受证据不可用来掩盖后继 Host 新发现。

## Decision Log

2026-11-03：保留主控记录的人类授权背景：用户要求本轮评审并由主控接手修复、re-review、归档、整合、issue 核对和逐 PR rebase merge。独立子评审按分工只读实现与远端，唯一工作区写入是本记录和运行态证据，不自行解释为 merge 授权。

2026-11-03：本轮结论为 APPROVE。现有 #508/#518 直接拥有新发现的 scoped visibility 验收，90 项 open issues 中未见另一个独立同根因项；#72/#150 是不同执行/业务关系责任，不能据此转移本次缺口。#364 仅承接可选 review webhook 的基础设施失败。

## Idempotence and Recovery

未改生产代码、未写 Git refs 或远端。补充反例可重复；正式变异由 repository review-mutate 原文恢复。head/base 漂移即停止沿用结论，重锁受影响差异与验证；回滚按 consumer→Host→Provider 次序，无 schema 迁移。共享历史收尾由协调者建立 backup ref 与精确 lease。

## Interfaces and Dependencies

原生栈顺序 #523→#524→#525；底层 optional 端口可独立留存，上层可独立撤销。#525 接合其他详情布局 PR 时必须同时保留 presentationScopeKey 与 issueClosingLinksReader；协调者已在组合中处理此交点，本独立评审未修改该文件。任何 native 读取成功均不得清旧 delivery health、创建 ExecutionContext 或确认手工业务关系。

## Outcomes & Retrospective

APPROVE。历史安装的三例成功与局部绿测具有证据价值，但 #524 当前两个 P1 阻塞整栈和父 #508 完整接受；修复及新 head 独立复评通过前不把 Ready、局部 APPROVE、CI 或旧安装记录写成 R1 发布接受。

## Bottom Change Note

2026-11-03：在预建矩阵上填实际代码/产品/架构/测试/issue 结果，记录 immutable head、真实执行上下文、三层接合与全部反例；只新增评审证据，不更改实现。

2026-11-03：主控核对初始版本完整矩阵与独立证据；本层无新增 finding。最终发布会在真实前序 main 上重放并重读 head/base/CI/issue/threads，随后用评审账号提交当前 head 的结论；不继承旧批准。

2026-11-03：新组合实际安装接受已由独立执行者完成，主控再次核对tarball SHA和12个已安装文件/完整文件集合逐字节相同；source33472f2b与artifact7209b6e6…115a。三历史例、qualified label、来源时间/安全外链及23计数观察均成立；光暗/窄短原生zoom200%8布局与联合状态保持通过。当前自身最终重放仍需独立刷新矩阵及 hosted gates，R1不随此接受。

2026-11-03 最终实际前序回读：在检出 `feature/native-link-provider` 的 `.worktrees/native-link-provider` 根，基于 `main@6e20192de806b604d75da751ede3dca862b8ddd4` 完成 frozen install、typecheck 与 `pnpm test:file tests/contract/planning-issue-closing-links.test.js tests/contract/development-github-contract.test.js`，输出 ℹ tests 51 / ℹ pass 51 / ℹ fail 0 / ℹ skipped 0 / ℹ todo 0，exit 0。原生依赖只按真实前序重放，当前 head/CI/threads/issue 仍由文中 GH 回读命令确定；本次提交没有继承旧 SHA 的批准。最终组合 `33472f2b` 与新包 `7209b6e6…115a` 的实际接受边界见批次评审。
