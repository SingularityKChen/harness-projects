# PR #472 MMP 交付评审

> R5 当前交付状态（2026-11-02）：正式 review 5732398417 请求修改；作者共享读健康修复已本地冻结，source aac45043，等待最终父层与 root 新head独立复评。历史APPROVE/Ready不是当前版本接受。

> 当前源码结论（2026-11-02）：APPROVE；source 4c777b66f0c27f4de4547af8a32f42d30f31869c / base 57a9f77d。R472-U1与整合问题已闭合，无新增P0–P3。历史REQUEST_CHANGES及未决预算按轮次保留，当前Ready授权与最终远端门见末节。

- 日期：2026-10-30；状态：独立增量评审完成；无新增 P0/P1，一项 P2；依赖门尚未通过。
- Head：`1795f5c775c815c32511dc0d2bdfff0e991e67ec`；base：`fix/delivery-runtime-access@f64e51446bd9fb07cdd899befd9d604f09a8a696`。
- 执行上下文：`.worktrees/operation-runtime-browser`；评审账号 `Singularity-AI-Bot`，作者侧 `SingularityKChen`。
- 系统目标：验证本 PR 的用户结果、状态所有权和失败恢复闭环；本地测试不替代产品/人类发布验收。
- 方法：Superpowers 独立子评审；Qian 系统接口/反馈综合；First Principles 从不变量及用户结果构造反例。

## 风险矩阵（先建后查）

| 等级 | 主要失效假设 | 检查层 | 结论 |
|---|---|---|---|
| P0 | 撤权后产生未经授权的外部副作用 | 代码、产品闭环、架构、测试/反例、issue 验收与已有跟踪 | 增量未发现；真实读、branch/worktree/primary/fallback 写前重采样当前门 |
| P1 | 逐步 gate/Unknown replay/生产浏览器恢复闭环失败 | 同上 | 增量未发现；#469 继承的跨 owner 旧 cursor 拒读问题由独立层评审跟踪，依赖门未过 |
| P2 | 实际拒绝观察、可恢复诊断不准确 | 同上 | R472-U1：同 scope 的权限 metadata 更新清空 Unknown/Pending 结果提示 |
| P3 | 文案、维护成本 | 同上 | 未发现新增项 |

## 锁定事实与验收

- 关联 issue：#457。
- 本次锁定元数据：Ready、MERGEABLE，Fast Gate、Merge Gate、Verify、CodeQL、size/disclosure 成功；可选 Create review session 失败，最终远端状态/全部线程由根协调者在统一提交前回读。当前本地 head 仍为上述值；不得把旧源码 head 的实施报告当成本次验证。
- #457 原验收包含 Planning/Delivery 局部降级与拒读遮罩、直接命令零禁止副作用、key/layer/安全恢复解释、生产 Host/controller/client/browser 以及 deferred Host entry 拒绝。它不是只检查逐步写门。依赖链 #467 → #466 → #469 → #472 必须全部成立后才能关闭父项。
- 根协调者报告 #469 已确认跨 owner 复用旧 cursor 的 P1，专属子评审验证 Host 路径。本记录不将其重复算作 #472 新增 finding，也不以本 PR 绿测试免除该依赖门；修复/rebase 后需重锁整个栈和受影响组合。

## 分层证据与设计判断

独立审读相对直接父层的全部 22 文件增量，按风险矩阵先查后验。Core 增量沿既有 runtime owner、BeforeExternalWrite 和唯一 durable intent 实施：每次真实 Development 读取分别判 key，写前在持久 intent 事务两侧重采样；binding/repository 身份保持冻结。旧 descriptor/ack 不能解除更新拒绝；明确拒绝与限流/离线不同，已确认资源保留，未决 receipt 优先维持 Unknown，不以另一个执行者盲试。未新增授权回调、持久账本、Provider 依赖或规划事实写。

Host 的既有 options 路径接入安全 validation；安全原因经 key allowlist 归一，client 不透传 Provider 原始错误。当前未发货 cancel、planning-write、source-policy 继续由 installed service 的声明与严格输入拒绝。UI 独立兄弟 key 修复有判别断言；权限原因与显式重验范围适度，但 access 失效与命令结果重置被同一个 effect 绑定，形成下面的 P2。

生产 browser carrier 读面确实由 OPERATIONS 推导 unary、转调 installed.service，watch 逐帧来自真实 Host；SQLite、production apply 与 typed input 皆保留。Provider fault/permission/hold seam 用于外部条件，执行 status 的直接写明确只为既有正控，不冒充权限证据。Node 的桥/stream 验证证明这条链可执行；实际 DOM/browser 结果仍需独立真实浏览器证据。

本子评审实际运行：

    node scripts/resolution-check.mjs && node --test tests/integration/runtime-operation-access.test.js tests/contract/ui-start-work.test.js tests/contract/ui-work-item-detail.test.js tests/e2e/runtime-access-browser.test.js

结果 **56/56，0 fail/skip**。覆盖 Memory/SQLite 旧 descriptor、读前撤权、实际 preflight 拒绝、Unknown replay、primary/fallback、partial ack、旧 ack、新 attempt、UI 资格、真实 installed service/watch/abort。`git diff --check f64e51446bd9fb07cdd899befd9d604f09a8a696...1795f5c775c815c32511dc0d2bdfff0e991e67ec` exit 0。没有重跑全量 verify/typecheck；不把实施者、根协调者报告冒充本子评审执行结果。

最小独立 UI 对照使用现有 `ui-start-work.test.js` 的 hook harness，在运行态加载锁定 head 与直接 base 的 StartWorkSection，给同一 target 完成 Unknown，再把 repositories 从 available 改为 unavailable 并 flush effect；未改产品/测试：

| 观察 | base f64e514 | head 1795f5c |
|---|---|---|
| Unknown 后 submit 文案 | 读回并恢复 | 读回并恢复 |
| 同 scope metadata 更新后 | 读回并恢复 | 提交开始工作 |
| 继续显式 validation、仍 denied | base 无该新控件，保留原提示 | 仍为提交开始工作 |
| 外部 submit 次数 | 1 | 1 |

两个 base/head probe 均 exit 0；另把 head 响应换成 Pending，得到相同文案丢失，submit 仍为 1，exit 0。写门导致 disabled 本身在 base 已有，本条只报告新增的未决结果提示被抹除；未复现重复写、错误确认或持久 receipt 丢失。现有 Unknown/Pending 用例保持 repositories available，未覆盖这次 metadata 变化。

根协调者另行报告：本 PR focused 196/196、三项正式 review-mutate 具名 KILLED，实际浏览器同 Host 完成 Planning offline 保留正文→denial 遮罩→恢复，以及 held branch ack 后 worktree 撤权、release 的 partial ack；计数 1/0/2→2/0/2，保留 branch、无假确认且禁提交。这些是根的本轮独立验证，非本子评审执行；根负责记录对应日志/DOM。局部与浏览器正控不能证明未覆盖的权限历史/owner 组合都安全。

## 评审与后续

R472-U1（P2，新增行 18–21，`packages/ui/src/start-work-section.ts`）：把 repositories 纳入 effect key 后，当前权限 metadata 更新会调用 setResult(undefined)/setPending(false)，同一工作项的 Unknown/Pending 提示及“读回并恢复”文案被清空；metadata 到达时还在途的同 scope command completion 也因共用 generation 被忽略。访问资格应立即撤销，但它不表示原命令的未知结果不存在。建议把 access/options/validation 失效与 target/intent 身份失效拆开，同 scope 保留未决/partial ack 结果，且旧完成不得恢复已撤销的写资格；补 available→denied metadata 更新的判别用例。

核对 all-state issue：#193 拥有 Core 执行恢复活性，#421 拥有外部唯一性，#451 拥有进一步 browser execution 总验收。本条是本 PR 新增的 UI 结果提示丢失，不重复它们的既有故障；未见本条已有活动 issue。不得把 base 已有的 denied 时 disabled 当成本次回归。

增量只有 P2，建议 APPROVE 并由现有 owner 处理；**当前栈不能合并、不能宣称 #457 原验收全部成立**，直到 #469 的继承 P1 修复并完成新 head 的依赖/组合复评。没有外部评论/review/commit/push/merge，没有改代码或测试。

## Progress / Discoveries / Decision / Recovery

- [x] 先读既有 P0–P3 风险矩阵，再锁定直接父层与所有新增 diff。
- [x] 审查当前门、部分 ack、Unknown、旧 descriptor 与 Host/client/UI/carrier 接线；独立 56 项验证通过。
- [x] 用 base/head 对照确认新增 P2，并限定为 UI 可见结果丢失；未把 inherited P1 或旧 disabled 重算。
- [x] 输出一项机器 finding，交根协调者一次性反馈及跟进；未批准新技术债。

2026-10-30 决定：逐步 gate 机制与唯一 carrier 的半径适度；新发现只需局部 UI 状态生命周期修复，不扩大 Core ledger/权限架构。修复/rebase 改变 head/base 后本结论需重锁，保留分支、工作树和运行，不自动删除外部资源。局部测试不替代真实 GitHub 撤权、已安装 Harness UAT、#144 或 R1。

## R472-U1 实施交接（原 reviewer 转唯一实施 owner）

2026-10-30 根协调者根据人类条件授权指定本记录作者为唯一UI修复实施者，另一 agent 独立复评；正式首轮 review 为5709139015。本计划已从completed重开 `docs/exec-plan/active/2026-10-30-operation-runtime-browser.md` 并更新索引，本节不是实施者自批通过。

本批正规TDD：扩既有partial ack、Unknown/Pending用例并新增same-scope在途/迟到options测试，先得到13 pass/3 fail；失败分别精确命中降级事实丢失、恢复文案清空、pending提前解除。再将command target代次与options/access代次分离，得到16/16。访问变化仍撤销options/validated并使旧options失效，同scope真实command completion仍落result/onStarted；late真实成功不恢复已撤销写资格；原target变化、断连与卸载隔离保留。

关联命令为active计划Batch5列出的五文件组合，185/185；typecheck exit0。本修复产品10A/4D、测试33A/1D，共48；相对直接父层整PR代码/测试/config实际837，严格<800门未通过。未删任何安全测试、未压缩连续算法，不把837描述为符合原预算。完整主套件、正式变异、独立复评与预算/父层依赖门尚须分别记录；禁止commit/push/merge。

本批验证追加：在相同检出与本地差异上，`pnpm test`主套件2723/2723、0fail/skip；不是hosted CI、MVP0或真实browser重验。正式`node scripts/review-mutate.mjs <本批spec.json>`整表：U1-clear-result由Unknown/Pending用例KILLED，U1-clear-inflight与U1-old-options由same-scope in-flight用例KILLED；全部带killedBy，基线与逐字还原后基线GREEN，exit0。`git diff --check`通过。当前产品改动冻结交另一agent复评，不自称R472-U1已独立验收；837总代价与父层P1门仍未过。

2026-10-30 修复独立复评（与实施者分离）：R472-U1 ADDRESSED，无新增finding。另一评审者实际运行UI16/16、额外反例8/8、typecheck及diff-check通过；same-scope撤权保留unknown/pending/local_only/confirmed的在途及partial ack，旧validation/command completion均不能恢复新拒绝；workspace/workItem变化隔离旧结果。根协调者只读核对最小diff和测试，确认无Core/Host修改。总代码837仍待本会话人类预算裁决；前层#466/#469两P1与最终重放/CI门未解除。

协调者真实浏览器正控补记（入口 `node tests/fixtures/execution-drawer-browser.mjs`，bundle源为初始锁定head1795f5c，未把它当P2修复后验收）：同页Planning offline保留正文并显示最后已知，明确拒读隐藏title/body/source，恢复后显式刷新可见。issue-2挂起真实createBranch ack，再拒worktree.create并release，外部计数branch/worktree/run从1/0/2到2/0/2；详情保留分支并禁提交。恢复授权后点重新验证及提交，计数2/1/3，复用原分支，只新增工作树与run各1。正常关闭tab后inspect为held=0、streams=0，临时服务正常退出。该正控不覆盖前层新P1或尚待重放后的最终浏览器证据。

2026-10-30：人类直接选择“允许本 PR 837 行，保留完整修复和测试（建议）”；已写所属active计划Decision Log。本项预算门仅对具体837行修复放宽，仍需前层P1修复复评与最终组合/CI，不推导产品或发布接受。

2026-10-30 依赖收尾更新：#464已rebase合并为`52b0900906b001129464e765e8849ed84ad068c5`，#436CLOSED；#467已rebase合并为`417349a3b6504b73594362a3253d9ee1565ba5c5`，#204CLOSED。#466候选90e036b原P1已解决但新增P1/P2，review5709564519继续REQUEST_CHANGES。#469的完整共享fence修复获人类明确授权收回原PR并守1000行硬限；原owner继续修复，无前层产品通过推断。

2026-10-30 冻结父层本地整合：以 `db6b01df3bfa083a82722a119876c66eefd0f516` 为直接父层，保留 Planning prior-disposition/Delivery共享提交fence与当前UI布局/焦点。窄验证首轮69/70只因视觉showcase被移除；保留显式展示场景、默认strict真实Host桥后70/70。补默认legacy输入拒绝、视觉context不进入默认权限载体、metadata不夺用户焦点断言，完整verify2837+7通过。未把合成showcase当权限证据；无Provider/Controller返回覆盖进入默认路径。最终独立接合复评及真实browser/远端门待完成，不复用旧head批准。


## 冻结父层接合独立复核 · `104644e9e2efbc6ed950d9a0ff021d17d18ecf7d`

2026-10-30，直接base `db6b01df3bfa083a82722a119876c66eefd0f516`，原已独立接受的P2修复为 `758f812e95134e7aa17c6e1c288393b8c5a828db`。本次审查者未实施该UI，按五层风险矩阵复核父层接合，**建议当前增量APPROVE，无新增P0/P1/P2/P3；R472-U1保持ADDRESSED**。不沿用旧head批准，也不替代完整#457/真实浏览器/R1接受。

默认fixture unary以OPERATIONS推导参数，经exactRecord/parseInput转真实installed.service；watch逐帧来自同一Host。默认legacy输入被拒、context为404，显式白名单scenario才提供视觉DTO或baseline长标识。独立同服务器正反对照：showcase后默认baseline与真实service的JSON wire等价、默认context仍为真实running、默认watch未混入视觉仓库。该合成分支仅保留既有展示契约，不作为权限或Provider确认依据。

UI的commandGeneration和options/access generation仍分开：同scope metadata不抹除Unknown/Pending、pending命令或partial ack；迟到options/真实完成均不恢复被撤销写资格。上游executionStyles、原生表单结构及focus ticket保留，metadata变化不重新focus字段、用户主动移焦不被夺回。兄弟execution/start-work keys独立、Planning遮蔽/恢复保留身份，operation metadata访问版本及父Delivery共享fence仍有效。

Core的git-provisioning、client start-work和status-policy相对原已评修复逐字相同，start-work的父层接缝仅恢复planningReadState读取；父committedFence、Planning恢复及唯一BeforeExternalWrite未被冲突覆盖。没有新增权限authority或账本；纯UI展示不写工程/规划事实。

| 本轮实际执行 | 结果 |
|---|---|
| `node --test --test-timeout=120000 tests/integration/runtime-operation-access.test.js tests/contract/ui-start-work.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-execution-context.test.js tests/contract/ui-delivery-lineage-section.test.js tests/e2e/runtime-access-browser.test.js` | 93/93，0 fail/cancel/skip |
| `node --test --test-timeout=10000 probe-carrier-isolation.test.mjs`（immutable隔离副本） | 2/2；按JSON wire往返规范化比较真实Host、showcase和后续默认响应；首次JS undefined形状比较未计产品RED |
| `node node_modules/typescript/bin/tsc --noEmit`；`git diff --check db6b01df3bfa083a82722a119876c66eefd0f516...104644e9e2efbc6ed950d9a0ff021d17d18ecf7d` | 均exit0 |

正式review-mutate仅在隔离副本最终树整表运行：C-command-lifetime由Unknown/Pending与inflight用例KILLED；C-focus-metadata由用户移焦用例KILLED；C-default-strict由默认strict unary用例KILLED；C-upstream-showcase由显式展示契约用例KILLED。四项均有killedBy、前后基线绿、exit0，源码逐字节还原。未重复父层已闭P1全矩阵或fullverify；root另负责当前冻结head的实际浏览器正控，不把Node桥对照称为DOM验收。

同base实测非docs A+D=872、docs=403。原人类明确批准的是具体837行；新增35来自新base已交付UI/焦点/视觉契约与必要接合断言，未增加需求，仍低于仓库1000硬限。本记录不声称人类已数值批准872；预算适用、#466具体854预算及最终归档/push/CI/全部线程/issue关联由协调者收口，未重复提问。#457原验收、#451实际browser和R1保持独立；无重复issue、Status或原生依赖写入。本轮只追加review和仓库外机器结果/报告，源、测试、计划及外部状态未改。

2026-10-30 当前源码真实浏览器验收（source head `104644e9e2efbc6ed950d9a0ff021d17d18ecf7d`，父层 `db6b01df`；CUA驱动实际DOM，默认URL无showcase参数）：

- Planning offline保留正文并显示最后已知；whole-source拒读后标题/正文/来源消失，显式完整新读后同Host和client恢复。
- Execution实际ambiguous_create返回Unknown；工作项issue-2的表单经worktree.create拒权及watch metadata更新后，仍显示Unknown与“读回并恢复”并禁写。恢复当前许可后显式重验和读回，真实startWork两次使用同一key，外部branch/worktree/run计数固定2/1/2，没有盲目新run。
- Delivery offline保留已确认pipeline及确认时间为stale；仅pipeline.read拒权时pipeline遮罩，Planning正文和Execution仍可用；同scope完整刷新后恢复。Check正/反例由父层正式矩阵覆盖，本次未将空check集合冒充正控。
- 另工作项issue-4在held真实branch ack后撤worktree.create，计数2/1/2→3/1/2，确认分支仍在执行来源、无假Saved；恢复后显式重验/新key，计数3/2/3，只新建工作树及run各1、复用原branch。Planning Status保持其原已完成值。
- 从真实表单按Escape关闭详情并将焦点返回issue-4触发链接；正常卸载后inspect held=0/streams=0，临时服务正常退出。

该验收与同源完整verify2837+7、独立接合93+2及4具名KILLED相互补充；不代表真实GitHub账号撤权、安装件人类UAT或R1。新父层保留既有视觉场景/焦点契约后实际代码A+D872；已向人类给出具体872与837旧数字差异选择，尚未答复，不声称872已获批，不发布最终head。

## 2026-11-02 最终父层接合与 Ready 复评

source `4c777b66f0c27f4de4547af8a32f42d30f31869c`、base `57a9f77d039ba9a63ef02af35ae17d903cd8caf6`，工作分支`fix/operation-runtime-browser`。独立验收本层12个生产文件与旧ab20逐字一致；main新增14个生产路径相对父层无变化，fixture仅继承bounded viewport CSS。没有更换默认strict unary/watch/真实Host桥。

独立运行 runtime-operation、ui-start-work、ui-work-item-detail、ui-workspace-shell/settings/status、harness-plugin-workspace-status、runtime-access-browser 八文件组合，99/99、0 fail/cancel/skip，type/diff边界保留。Gate available→合法隐藏source denial→recovered三帧中，WorkItemApp reconciliation位置/type/key和source/startWork端口实例稳定；结合在途命令、旧options、兄弟key回归，无新增P0–P3。owner完整verify2877/2877加MVP-0 7/7与typecheck通过。

当前默认生产carrier Chrome smoke确认已开详情跨Planning拒读/恢复仍保留、无受限title/body、恢复按钮可达；Escape关闭并按断开trigger规则落到安全H2，卸载streams/held均0。原Unknown/Pending与partial ack的完整浏览器矩阵属于旧104644e9的对应历史证据，本轮本层生产代码逐字一致，未将视觉scenario-only数据或Node bridge测试冒充实际DOM。

代码872，文档小于1300；用户在具体差异说明后直接指示“继续并完成 ready 交付”，已记归档ExecPlan。当前自动化源码接受与人类UAT/R1/merge决定分开；最后文档提交后重新核对当前head CI、全部review线程和#457双向关联，再Ready请求人类评审。


## 2026-11-02 R5：当前 Ready 候选全矩阵复评

本节取代本文件此前“当前候选无开放finding”的结论；旧阶段证据保留为历史。冻结head `b48dc2398c5d482a5ef028814e9e211a3c4ef040`，review actor为 `Singularity-AI-Bot`。

当前结论 **REQUEST_CHANGES**：本层新增 **R472-C1 / P1** 与 **R472-C2 / P2**。

- P1，`packages/core/src/runtime-access.ts:72`：真实Start Work读拒绝只进入owner-local operations Map，未发布到既有共享read-health/返回fence。Memory、三个独立同文件SQLite root及真实installed多Host均复现：A遮罩后，既存B和拒读后重构C仍返回受限PR标题/id、2个pipeline（含ci_passed）、3个check，Provider仍拒读。
- P2，同文件136–137：恢复Provider并三轮完整Delivery refresh（ok/applied、gaps=[]）及显式options验证（available:true）后，本地operations reason仍盖过确认恢复。Memory/SQLite及真实Host均失败，base57a9正控2/2通过；额外发起新StartWork可恢复但新增branch/worktree/run各1，不能替代只读恢复。
- 父层继承阻塞：#466 ordinary-offline首次写反例在本最终组合仍复现，统一归属父层，不重复新增本层inline，也不接受#457完整闭环。

其余全矩阵未新增P0；逐步Development/Execution门、durable intent、partial ack、Unknown/Pending、scope/身份及strict唯一carrier已检查。窄验收65/65、新执行intent窗口4/4、4项具名KILLED及还原基线50/50通过；新跨owner反例0/2加真实多Host0/1，恢复反例0/2加真实Host0/1。协调者又独立重跑两个双Storage反例确认失败，carrier+boundaries13/13通过；没有把HTTP/SSR当真实DOM浏览器验收。

#457旧预测/完成计划入口的P3已同步，原5项AC、Scope、rollback、Planning Status/原生依赖不变。修复需统一既有共享读健康的发布和按版本确认恢复，不增加第二权限账本，不以describe或其它key成功清实际写拒绝。

同批正式review已提交并回读：review `5732398417`、状态 `CHANGES_REQUESTED`，新增inline 2条。完整矩阵、原始日志、探针及具名变异表位于该工作树运行态 `.superpowers/mmp-review-current-20261102/`，不进入公开分支。

本轮未修改产品或正式测试、未push或merge；本节文档由原owner在后续修复批次一并提交。源码或父层变化后须重锁head/base、受影响验证及正式复评。Issue关闭、规划接受、真实账号/安装件人类UAT与R1均独立。

## R5 作者修复冻结（待当前父层独立复评）

source `aac450431a2baf31fdf5332d1e853cb88ad86862`、原base `57a9f77d039ba9a63ef02af35ae17d903cd8caf6`。C1/C2共同根因是actual RepoRead拒绝的operations Map与Delivery持久health双重拥有：现在getRepository/listBranches在真实I/O前提交同一health marker，实际拒绝共享发布，完整Delivery facts+scope事务ack恢复，describe/单方法成功不清实际read denial或write denial。

operation读begin推进已有health version、保留原denied/scopes并重置新代pending；owned按address+started version计数和扣除，避免旧owner计数抵消新代foreign marker。旧operation成功同时受operationVersion与health started/version限制，不能越过实际新拒读或新的capability声明。RepoRead非permission声明仅镜像原Map，当前同keydescriptor可以恢复自己的声明镜像；实际permission只归共享health。WorktreeRead不属于Delivery证据闭集，保持原同keyoperation语义。

正式多owner Memory、三个同文件独立SQLite root及真实多Host验证原泄漏/恢复和无额外创建；marker未ack零Provider、denial settlement失败/旧Delivery成功、owned代际、事实恢复rollback与旧operation结果均保留。相关三个integration加runtime-access-browser E2E为82/82，原四外部probe为6/6，typecheck/diff通过；独立协议复核11项通过。新断言各有真实RED或隔离变异判别，不修改原reviewer探针断言。

完整代码从1041经自然重复清理为1000：34行未调用浏览器导出/无消费者数据，7行同类测试脚手架table复用；原preflight/branch真实拒绝、describe不清write、同key零新增和显式恢复断言全保留，branch场景扩大到SQLite。实际browser步骤和DOM/计数判断已自包含保留在Active计划；不把未运行的函数出口当已有测试。本记录不是作者自行APPROVE，待root完整组合与当前head复评后继续远端门。

## R7 作者最终根因修复冻结与规模门

2026-11-02 SGT，source `06c90c930e4163e3a78e92744423411f45d71547`，base `3c8b8da155d71ce977f340cf1eca280d23b71209`。Shared health 仍是同一 SyncCursor：marker version隔离旧facts；denialVersion隔离真实拒读；confirmedVersion只认完整facts事务；pending/owned依确认cohort结算。新begin不吞实际deny，单方法成功不清未知旧marker，旧完成不能偷扣完整确认后的新pending。已确认的分支/回执不删；普通离线不倒改首写后合法claim，真实permission/逐key/intent门仍保留。两项整库断言仅精确允许中性读健康version+1或自己的pending1→0，其它字段和全部业务表仍逐字比较。

完整 `pnpm verify` 3277/3277 加 MVP0 7/7；当前顶层原Planning7+最后cursor2+原472六项共15/15；十三个具名隔离变异均KILLED且基线/逐字还原GREEN。独立协议93+233项、健康并发Gateway3项、扩展cohort reset4项、原六诊断及最后ack13项通过。扩SQLite测试一度遗漏返回实际Storage，纠正后195项窄回归GREEN；该夹具错误不计产品RED。

真实代码1074，文档小于1300，超1000硬限74，当前只冻结本地可审阅结果，预算未批准前不publish/Ready。已自然删无消费者代码并复用late结果、marker、准备链及工作项fixture，未删判别断言或挤压连续算法。当前root完整新head复评与最终远端门仍待完成，旧review批准不覆盖本source；issue接受、Planning Status、原生依赖、UAT/R1及merge未改变。

## R10 原 C1/C2 相邻窗口及 R11 修复

2026-11-02 SGT，source06c及等价800053的正式独立结论仍REQUEST_CHANGES：原C1/C2仅PARTIALLY_ADDRESSED。C1/P1：Memory真实guarded getRepository实际拒读后，另一begin的迟到同版ack洗掉本地deny，真实Core外发2pipeline。C2/P2：Memory/独立同文件SQLite连续两拒读settle失败，本地虚增版本盖过peer完整确认，下一成功operation begin还使confirmedVersion与scopes回退。原15探针/13负控只属原条件，没有关闭这些窗口。

R11 source `a1a3a88` / 直接父 `4cf723b`（2026-11-02 SGT）将已提交health与本地cause+单调observation分开；Storage版本仅事务推进，begin不复制localhealth，marker/ordinaryack不清本地拒读，较新完整facts+scope proof可解除mask但不回observation。operation/fullread在begin await前采样观察序，访问token也包含它，旧票据不因恢复ABA复活。完整范围和回滚见同一Active ExecPlan BatchR11。

正式新增7项先2pass/5fail，修复后396定向、6原R10、完整3380+7与typecheck通过；独立当前source复评与最终远端门尚待回读。实际1162代码（精确直接父层Gitnumstat）比人类已批1074增加88，不把ignored估算1164或旧批准当作当前例外。未删原断言/Fixture，不引schema/迁移/第二权限authority，未改PlanningStatus/native依赖/UAT/R1，不merge。

R11独立协议审订补记（2026-11-02 SGT，source a1a3a88）：85正式/3健康并发与Gateway/6原R10/2独立token及oldoperation/fullread ABA诊断全部通过，无剩余本轮finding；旧13项按当前职责映射及新5项观察义务负控全KILLED、逐字还原GREEN。人类已明确批准该source1162行（新增88），不替代协调者当前source复评与最终headCI。

## R11 完整独立MMP技术接受与归档

2026-11-02 SGT，独立source `a1a3a88` / base `4cf723b` 完整P0–P3矩阵结论APPROVE（仅本层技术），R472-C1/C2 ADDRESSED，findings=[]。实际重跑原C1旧0/1→新1/1、C2旧0/4→新4/4；126正式、3健康并发、2局部scope、6祖先/结清fence、39UI/strictcarrier、原R5真实多Host6、boundaries9与typecheck通过；六具名因果负控KILLED、805文件逐字还原。Coordinator另复跑五项关键原反例通过。未重跑独立完整verify或新DOM，owner3380+7、原浏览器证据各归其固定source。人类已明确批准a1具体1162，计划技术归档completed；最终产品等价head CI、正式review/线程/双向关联仍待回读后作者Ready，不merge，不接受issue/UAT/R1或PlanningStatus。

完整负控定义归档见 [PR #472 具名负控重放定义](pr-472-mutations.md)：作者旧13当前映射、新5和独立6分别保留id/file/anchor/replacement/killedBy与执行argv。独立6原command含临时reviewer探针，与下表正式测试重放版明确分开，不复用旧日志冒称新执行；所有重放只能在隔离同source快照运行。

正式文档重放验收（2026-11-02 SGT）：同产品 `62aa2da` 完整隔离归档实际按公开JSON分别重放，13/13、5/5、6/6具名KILLED、每批基线和逐字还原GREEN、exit0。原作者/独立评审的计数和命令来源保持区别；本轮只是证明定义在公开正式源码上可重现，无产品改动。

## R12 接手复核 · 逐层 main 重放前

2026-11-02 SGT，锁定 `dc3c19346261972f68ed48639cfa74e4f5796fdb` / 直接父 `f0e9c7db564a2e6b44a154a98326d24778ee057e`。先读原P0–P3矩阵、C1/C2与R11/R12接受，再独立比对source `a1a3a88c46f9dadf679b7c421af17ebce9c1d7a1`：全部442个非docs tree项逐字一致，无产品/正式测试/config/workflow漂移；能力和文档两提交，本层1162代码/869文档、diff-check通过。计划Decision Log的“批准这两个具体候选，继续 Ready”明确绑定该source1162（较1074增加88），不是通用上限变更；advisory size当前FAILURE如实保留。

当前源码 **APPROVE，C1/C2保持ADDRESSED，无新P0–P3，可进入逐层真实 main 重放**。复核#510同步root fence、#466共享Planning disposition、#469完整facts/scope ack接口：Delivery Map只镜像已提交health，本地cause/单调observation保留未ack拒读；begin不回写旧local health，operation/fullread在await前捕获观察号，恢复不复活旧票据。实际写拒绝与read恢复分开，唯一durable intent、partial ack和Unknown原键恢复不变。局部因果状态有真实迟到ack/结算失败反例支撑，无新schema、第二持久权限authority或过度通用框架。

本次实际窄验：`node --test --test-timeout=30000 --test-name-pattern='actual refusal remains masked through a delayed committed marker acknowledgement|complete proof clears a failed refusal mask|failed actual refusal invalidates an older full read|operation read denial shares durable Delivery health' tests/integration/runtime-delivery-access.test.js`，7/7、0 fail/cancel/skip/todo。Memory迟到同版marker ack不能洗掉真实拒读；Memory/独立SQLite的共享读拒绝、完整proof恢复及旧operation/fullread不复活均成立。未重复full verify/全部负控，未称本轮为新DOM或安装Host UAT；既有126/39等矩阵、13/5/6负控和3380+7保持各自固定source归属。

现场远端仍为上述head/base、Ready/APPROVED，R12 review `5736247121`绑定同head；三原线程均resolved、分页完整，唯一Closes #457。Verify/PR Fast Gate/Merge Gate/CodeQL/disclosure当前成功，size特例与可选建会红不伪装成绿。#457五项AC仍未勾选；根协调者在#510→#466→#469落地后仍需逐新head/base独立复评与实际CI/issue关联回读。#450/#451持续browser场景、#144未发货范围、安装Host UAT/R1各自独立。本次只追加本记录，未改实现/计划/索引、Git或远端。
