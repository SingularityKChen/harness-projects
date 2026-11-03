# PR #525 MMP 交付评审

> 状态：初审全矩阵完成；结论：APPROVE（本层）；整栈等待 #524 修复复评；评审日期：2026-11-03（Asia/Singapore）。

## Purpose / Big Picture

判断原生 Issue–PR 关联能否作为独立可验收、可合并、可回滚的来源观察交付。先查 P0–P3 风险矩阵，再完成代码、产品闭环、架构、测试、反例、issue 验收与设计适度性检查；本独立子评审仅更新记录，不修改实现、提交 GitHub review 或 commit/push/merge。

## Context and Orientation

锁定 head `70eaab2ed23ed8bd90b6d2a18d8a13f1fd165c10`，base `feature/native-link-host@afe3975184ca94c7438614b30923b4688b56d2d6`；执行上下文为检出 `feature/native-link-detail` 的 `.worktrees/native-link-detail` 根目录。焦点：严格 Reader、accepted generation/nativeAccessVersion、安全投影、独立详情 section、生命周期与真实生产浏览器通道。

已读当前 diff、全部 commits、PR 正文、closingIssuesReferences、review/threads 和 checks；初始锁定时所有线程/评审均为空，分页 hasNextPage=false；后续协调者提交的本轮 review 不属于该初始快照。当前远端为 MERGEABLE、Ready、UNSTABLE；PR Fast Gate 与 Merge Gate 均 success。取消的 Rule checks/Issue policy 均有同 head 成功运行；#523/#524 最新 Engineering state 的取消由后继 #525 全域重算 41591964923 success 覆盖。可选 Create review session 的三个失败日志均明确为本地评审端点连接失败，归现有 #364，不是代码验收豁免。

## Design / Spec

矩阵于逐文件审查之前已建立；以下填入实际结果。系统边界为 Planning Provider source proof→Development actual visibility ack→Host scoped observation→Controller/client→安全详情；原生来源事实不等于手工 implements 或执行谱系。

| 严重度 | 结果 | 代码、产品、架构、测试与工作项证据 |
|---|---|---|
| P0 | 未发现 | UI 不触网 GitHub、不含凭据，不新增外部写入入口或第二权威源。 |
| P1 | 未发现本层新增缺陷；继承父层阻塞 | 严格 scopeToken/closed schema、render 前遮旧、generation/nativeAccessVersion metadata、late reply ordinal 均有效；Host 未发失效的两条路径由 #524 修复。 |
| P2 | 未发现本层新增缺陷 | 固定状态文案、stale/partial 不冒充当前完整结果、安全 href、草稿/PR-backed/redacted 不 mount；跨仓短名信息源缺失归 #524。 |
| P3 | 未发现 | 独立 section 与现有 props 传递适度，无通用关系编辑器、重复缓存或 Provider 直调。 |

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
| #519 历史三例、无需 StartWork | 已回读实际安装 acceptance.json：115→159、110→111、233→397，各唯一正确安全链接、merged 与来源文字。 |
| #519 source/artifact 与只读窗口 | 0e9257f source、eff55818 artifact；安装字节等包，04:52:56–05:03:15Z 的 23 项计数相同，contexts/run/branch/worktree/关系/持久化命令尝试为零、已有 PR 实体与身份各 15 不变。排除绑定/账号/Planning sync，不能解释为全库或全部外部调用不变。 |
| #519 reader/UI/browser 判别 | 当前准确 head 10/10，通过真实 Provider/Host remote→production apply→唯一抽屉；V1–V3 全 KILLED。 |
| #519 unavailable/partial/unread/安全展示 | 当前 Host 正确拒读时通过，closed DTO/opaque receipt、安全外链、metadata 同步遮蔽、无自动 probe 热循环均有有效断言。父层晚403/NOT_FOUND未失效仍须修复。 |
| #519 规模 | 475 代码/测试/配置/fixture 行、160 文档行，少于 800/1300。 |
| #508 父验收与 closing | 当前 PR 的 closingIssuesReferences 包括 #519 和 #508；由于 #524 两项 P1，父项全验收仍未成立，必须修复并按最终组合回读后再考虑关闭。 |

当前准确 head 在上述根目录执行 `pnpm test:file tests/contract/issue-closing-links-reader.test.js tests/contract/ui-issue-closing-links.test.js tests/browser/native-link-detail.test.js`：10/10 通过、0 失败。原始输出保存在仓库根运行态 `.superpowers/mmp-review-20261103/native-detail-tests.log`。`git diff --check afe3975184ca94c7438614b30923b4688b56d2d6...70eaab2ed23ed8bd90b6d2a18d8a13f1fd165c10` 退出 0；生产文件经变异还原后与该 head 无差异。全组合 verify/browser 由协调者独立执行，本记录不冒认其结果。

变异均以当前最终生产/测试树运行 `node scripts/review-mutate.mjs .superpowers/mmp-review-20261103/mutation-spec.json`；每项有 killedBy，脚本报告原文逐字还原及还原后基线绿。此执行上下文下的 mutation-result.json 保存真实输出。

| 变异 | 故障 | killedBy | 结果 |
|---|---|---|---|
| V1 | reader 忽略 opaque receipt | `strict native reader reads exact scope` | KILLED |
| V2 | 允许含凭据 href | `display union omits opaque IDs` | KILLED |
| V3 | 权限 metadata 自动实际 probe | `same source authority version changes` | KILLED |

未发现属于本 PR 新增行的可操作 P0/P1/P2/P3 finding。父层 H-P1-1/H-P1-2 能沿合法 DTO 进入此消费者；不要求 UI 独立推测 Provider 权限，修复 owner 在 Host。

## Progress

- [x] 2026-11-03：P0–P3 矩阵先于审查建立。
- [x] 2026-11-03：完成全层审查、命名版本测试、反例、变异与 issue 验收核对。
- [x] 2026-11-03：形成全部 findings；没有在首项 P1 停止。
- [ ] 修复后的新 head 复评和最终门禁由协调者继续；无缺口前不标交付完成。

## Surprises & Discoveries

真实浏览器涵盖普通 native source/target 403、旧 UI 及 Host 回包、Host 重建、partial/offline/零集合、两页、键盘外链和窄屏。实际 GitHub 历史安装与受控故障浏览器是两类证据；两类通过仍未覆盖父层 deadline+denial 与 NOT_FOUND。

## Decision Log

2026-11-03：保留主控记录的人类授权背景：用户要求本轮评审并由主控接手修复、re-review、归档、整合、issue 核对和逐 PR rebase merge。独立子评审按分工只读实现与远端，唯一工作区写入是本记录和运行态证据，不自行解释为 merge 授权。

2026-11-03：本轮结论为 APPROVE（本层）；整栈等待 #524 修复复评。现有 #508/#518 直接拥有新发现的 scoped visibility 验收，90 项 open issues 中未见另一个独立同根因项；#72/#150 是不同执行/业务关系责任，不能据此转移本次缺口。#364 仅承接可选 review webhook 的基础设施失败。

## Idempotence and Recovery

未改生产代码、未写 Git refs 或远端。补充反例可重复；正式变异由 repository review-mutate 原文恢复。head/base 漂移即停止沿用结论，重锁受影响差异与验证；回滚按 consumer→Host→Provider 次序，无 schema 迁移。共享历史收尾由协调者建立 backup ref 与精确 lease。

## Interfaces and Dependencies

原生栈顺序 #523→#524→#525；底层 optional 端口可独立留存，上层可独立撤销。#525 接合其他详情布局 PR 时必须同时保留 presentationScopeKey 与 issueClosingLinksReader；协调者已在组合中处理此交点，本独立评审未修改该文件。任何 native 读取成功均不得清旧 delivery health、创建 ExecutionContext 或确认手工业务关系。

## Outcomes & Retrospective

APPROVE（本层）；整栈等待 #524 修复复评。历史安装的三例成功与局部绿测具有证据价值，但 #524 当前两个 P1 阻塞整栈和父 #508 完整接受；修复及新 head 独立复评通过前不把 Ready、局部 APPROVE、CI 或旧安装记录写成 R1 发布接受。

## Bottom Change Note

2026-11-03：在预建矩阵上填实际代码/产品/架构/测试/issue 结果，记录 immutable head、真实执行上下文、三层接合与全部反例；只新增评审证据，不更改实现。

2026-11-03：主控核对初始版本完整矩阵与独立证据；本层无新增 finding。最终发布会在真实前序 main 上重放并重读 head/base/CI/issue/threads，随后用评审账号提交当前 head 的结论；不继承旧批准。
本层无缺陷不豁免父层 #524：两项 P1 与一项 P2 已修复且独立复评通过，当前组合 `33472f2b1451b508b3d1c15d06acf3a078058bd7` 的全部产品路径与新包另行确认；最终本层必须继承实际已接受的 Host 修复。

2026-11-03：新组合实际安装接受已由独立执行者完成，主控再次核对tarball SHA和12个已安装文件/完整文件集合逐字节相同；source33472f2b与artifact7209b6e6…115a。三历史例、qualified label、来源时间/安全外链及23计数观察均成立；光暗/窄短原生zoom200%8布局与联合状态保持通过。当前自身最终重放仍需独立刷新矩阵及 hosted gates，R1不随此接受。

2026-11-03 最终实际前序回读：在检出 `feature/native-link-detail` 的 `.worktrees/native-link-detail` 根，基于 `main@dc4ecdc468df6be890147d1127aa5e4ca2a21028` 完成 frozen install、typecheck 与 `pnpm test:file tests/contract/issue-closing-links-reader.test.js tests/contract/ui-issue-closing-links.test.js tests/browser/native-link-detail.test.js`，输出 ℹ tests 10 / ℹ pass 10 / ℹ fail 0 / ℹ skipped 0 / ℹ todo 0，exit 0。原生依赖只按真实前序重放，当前 head/CI/threads/issue 仍由文中 GH 回读命令确定；本次提交没有继承旧 SHA 的批准。最终组合 `33472f2b` 与新包 `7209b6e6…115a` 的实际接受边界见批次评审。
