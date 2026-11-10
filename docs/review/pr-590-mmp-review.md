# PR #590 MMP 交付评审

## Purpose / Big Picture

判断当前 Issue 的两个来源原生阻塞方向是否经生产 Provider→Core→typed Host→strict client→真实详情闭合，并在账户/来源/权限/分页变化时保持诚实且不泄露。工程子叶 #589 与父 #543 的 hierarchy/installed、人类产品接受、R1 分别核验。

## Context and Orientation

- 日期：2026-11-10（Asia/Singapore）。
- 首轮 head：`351cc5dee0d0688fc24843fb1d482602425b23bb`；base 分支 `fix/native-authority-receipts`，观测 base：`727efd5090d304c7361ec9cc5e88e080bc34dfac`。结束前远端回读保持相同。
- 两个提交：`aec070751350b170dbfe086878e87d60577f0ed1`（方案）与当前 head（能力）；关闭关联仅 #589，父 #543/#591 使用 Refs。
- 实际 worktree：`.worktrees/native-issue-dependencies-20261109`。必要栈 #592→#590；父因果模块逐字相同，SHA256 `2ca895b46888f79ae82e46e2a42e184067767632232052c07ec91543a5c8c29b`。
- 评审账号 `Singularity-AI-Bot`；开发、作者回复与合并账号 `SingularityKChen`。本独立子评审只准备本记录，没有外部评论或评审事件。
- 用户直接授权沿用预置记录：无 P0/P1 时由主评审会话负责修复、独立复评、归档、提交整理、issue 核验及 rebase 合并；有阻塞项先交已有实现会话。本记录不扩大该授权。

## Design / Spec

分别审查该 PR 相对精确父提交的全部差异，以及包含父修复的真实栈顶。主要不变量为：唯一 Planning 事实源；原生关系是本次来源观察；UI 只消费安全类型；查看不创建实体/成员/业务关系、不写 Planning；外部读取失败与完整可见空结果保持区别。

### 审查前建立、审查后更新的风险矩阵

| 等级 | 代码与反例 | 产品闭环与架构 | 测试与 issue 验收 | 结论 |
|---|---|---|---|---|
| P0 | 静态查询、闭集类型、无业务写入/泄密路径 | Provider/capability/core/controller/client/UI 层边界与唯一事实源 | code增删799、docs138；boundaries9/9 | 未发现 |
| P1 | source/account/config/binding/policy/fence、请求序、重复否定、总deadline与退休 Host | 原三元 proof 在异步前捕获并用于恢复/发布；事实在错代 render 前隐藏 | 62 窄测试、90 接线契约、2 生产浏览器、D2/D3变异 | 未发现 |
| P2 | 两方向与页游标独立；完整空、partial与拒读保持正确；UI状态映射 | 首轮 **F1：unavailable 与 unread 在页面不可区分**；当前已分支呈现 | 生产 full App 独立探针复现；#589 的状态区分验收有局部遗漏 | 首轮1项；修复独立复评通过 |
| P3 | 结构、必要栈、重复追踪与文档可定位性 | capability独立，无cache、无模型推断或关系持久化框架 | 首轮 **F2：归档后父 ExecPlan 路径仍指向不存在的 active 文件**；当前已改 completed | 首轮1项；修复独立复评通过 |

## Global Constraints

本子评审只修改当前记录；生产源码、测试、commits、分支和远端状态保持只读。运行态日志、探针、不可变副本与变异 spec 只放 `.superpowers/`。不自主合并，不写规划 Status、关系或 Provider 业务数据。

## Plan of Work

### Batch 1 · 完整分层独立评审

已阅读全部新增/修改文件，逐层跟踪 typed port、permission probe、source proof、十页/十秒上限、Host lease/retired guard、strict client 与真实 App 透传。补跑最窄可判别验证、生产状态反例与变异，在所有层完成后统一交主评审提交意见。

## Validation and Acceptance

以下均为本轮新运行，工作目录为上述 worktree；原始输出在 `.superpowers/mmp-review-20261110/`。

| 命令 | 结果与证据 |
|---|---|
| `pnpm test:file tests/contract/planning-issue-dependencies.test.js tests/integration/issue-dependencies-scope.test.js tests/integration/harness-plugin-issue-closing-links.test.js` | 退出0；62/62，0失败；`narrow.log` |
| `pnpm test:file tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/contract/capabilities-keys.test.js tests/contract/planning-github-projects-mapping.test.js` | 退出0；90/90，0失败；`host-contracts.log` |
| `pnpm run boundaries` | 退出0；9/9，0失败；`boundaries.log` |
| `node --test tests/browser/issue-dependencies.test.js` | 退出0；2/2，0失败；`browser.log`。真实生产 apply/Host，HTTP transport 为离线夹具 |
| `node .superpowers/mmp-review-20261110/state-distinction-probe.mjs` | 退出0；**成功复现首轮 F1**；`state-distinction-probe.log`。该命令只描述修复前 head，修复后以独立 regression 为准 |
| 通过 Python `subprocess.run` argv 执行 `git diff --check 727efd5090d304c7361ec9cc5e88e080bc34dfac...351cc5dee0d0688fc24843fb1d482602425b23bb` | 退出0；完整实际父差异代码增删799、文档增删138（不含本评审记录） |
| `gh pr view 590 --repo SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,reviewDecision`；REST reviews/comments | head/base 未变；reviews 0、inline comments 0 |

变异在本 head 的 `git archive` 不可变副本 `.superpowers/mmp-review-20261110/immutable-590` 中执行，`pnpm install --offline --frozen-lockfile --ignore-scripts` 退出0；随后 `node scripts/review-mutate.mjs review-spec.json` 退出0。基线与还原后基线均绿，7/7 KILLED，全部被改文件与真实 worktree 最终逐字节相同；`mutation.log` 保留各 failed test 名。R1–R3 对父模块的判别详见 #592 自己的评审记录。

| 变异 | 指定 killedBy 与实际判别 |
|---|---|
| D1：非终页强制 complete | `source, malformed pages, cursor loops and later failures cannot claim empty complete`；loop/later/budget 反例失败；KILLED |
| D2：忽略 source stamp/fence | `committed A→B→A, request ordinal and denial invalidate pending success`；提交后旧结果可泄漏而失败，账户/config 反例也失败；KILLED |
| D3：未完整双流也恢复权限 | `failed streams preserve`；not_found/permission_denied/not_supported 三种恢复反例失败；KILLED |
| D4：客户端不检查 workspace | `strict dependency client refuses unknown fields, wrong scope and stale completeness`；foreign workspace 被错误接纳而失败；KILLED |

### 分层证据

Provider：两方向使用不同静态 query 与各自 cursor；每页包括精确 project/membership/content/Issue/repository 回证，complete empty 也不能跳过。canonical GitHub URL、正整数号码、closed/open、原生 identity 和坏/受限节点都验证，GraphQL errors 不与 data 混用，不读取 hidden count。来源限定号码可区分不同仓库的同号目标，Project 外目标不要求本地登记。

Core：当前唯一启用 Planning mount、primary Issue、membership、account/config 与 policy 均进入读取门或 stamp；committed fence 和 runtime epoch 覆盖已提交 A→B→A。父 receipt 在首次异步等待前捕获，重复实际拒读不能被另一 Issue 的恢复擦掉。两方向最多各10页/100项，总10秒，source等待同样被界定；current-scope 晚否定可撤销，旧 source/退休 assembly 不能影响替代者。只有完整双流能解除既有拒读，unavailable/malformed/partial 不恢复。没有 last-good 或持久 cache。

Host/client/UI：operation 声明生成真实 remote 链；actor 只表示只读发起者，不伪造 Saved/authoritative。Host 在返回后拒绝 retired assembly，client 闭集检查 workspace/workItem/LocalOnly/value、状态/时间/目标字段。App 从连接 gate 经列表到唯一 drawer 接通 section；错代/切项/断连时 render 先隐藏，metadata 不触发新 probe。浏览器覆盖320px明暗、外链 Enter、Tab/Escape、A→B→A、迟到响应、Host重建及SQLite dump不变。首轮的 F1 为 unavailable 文案区分遗漏；修复与独立复评见下文。

架构与适当性：独立只读 observation 不进入 domain relations，不推断 implements，不改变原生 PR links 或 execution lineage；没有为本叶新增数据库/缓存/get/replay/泛化权限框架。新 capability 确有生产 caller；父 API 是真实必要依赖。799行接近批准预算，但本轮没有发现以删安全断言或建立闲置 API 凑预算的证据。

工作项：#589 是 #543 的 read-only blockedBy/blocking 工程首叶；parent/subIssues、installed artifact映射及人类接受仍由 #543 承担，#150 保留关系编辑/周期管理。标题、标签、关闭关联与独立回滚边界一致；“native dependencies”标题搜索只返回既有父 #543，未发现另一个同闭环 issue。F1 为本叶主要验收中的局部 UI状态缺口，F2 为正式计划归档可定位性缺口。

### 首轮可行动意见（两项现均 ADDRESSED）

**F1 / P2 / suggestion — `packages/ui/src/issue-dependencies-section.ts:29`（RIGHT，新行）。** 网络失败时两个真实方向均返回 `unavailable`，第29行将其与 `unread`/无观察一起落入“来源阻塞关系尚未确认，请刷新”。这使已尝试但当前不可用与尚未确认无法区分，违背 #589 的显式状态区分验收。复现：打开真实 App 的 Issue 详情并等待目标→fixture `flags.offline=true`→刷新；wire 为 unavailable/unavailable，而两个状态区域与 metadata 撤销后的 unread 文字完全相同。独立探针输出 `identical:true`。增加显式 unavailable 分支/明确不可用且可重试文案，保留现有清空事实与无自动 probe 合同；不需要新增 API 或缓存。

**F2 / P3 / suggestion — `docs/exec-plan/completed/2026-11-09-native-issue-dependencies.md:39`（RIGHT，新行）。** 正式 child 计划在恢复/必要父依赖段仍给出 `docs/exec-plan/active/2026-11-09-native-authority-receipts.md`；当前 head 中该文件不存在，父已在 `completed/`。接手者沿父方案/回滚合同定位时会走失效路径。更新该仓库内正式父计划路径；与 issue 正文的历史链接区别处理。

### 2026-11-10 · 两处修复的独立复评

复评候选为原 head `351cc5dee0d0688fc24843fb1d482602425b23bb` 加主评审的局部差异：`issue-dependencies-section.ts` 只在既有第29行增加 `unavailable` 分支，使用“来源阻塞关系暂不可用，请刷新重试”；child completed ExecPlan 第39行改为真实 completed 父路径，并附修复证据说明。固定 section SHA256 为 `46334b39f0f702b3274060ec902940b60bdd91e39c52e23244703036c58069d7`；父 #592 因果源仍逐字等于其不可变提交，SHA256 仍为 `2ca895b46888f79ae82e46e2a42e184067767632232052c07ec91543a5c8c29b`。独立子评审没有修改实现。

- `node .superpowers/mmp-review-20261110/state-distinction-regression.mjs`：退出0。真实 wire 为 unavailable/unavailable；页面两个方向均显示“来源阻塞关系暂不可用，请刷新重试”，metadata 撤销后的 unread 两方向均为“来源阻塞关系尚未确认，请刷新”。`notDeepEqual` 成立，DOM 链接数0；离线恢复后的显式刷新先恢复真实链接，再测试 metadata清空。原始输出 `independent-state-regression.log`。主评审先前在未修实现上运行同一断言得到预期失败，本独立复评未将转述的 RED 当成自己的运行。
- `node --test tests/browser/issue-dependencies.test.js`：退出0，2/2，0失败；`independent-fix-browser.log`。保留原有 noFacts DOM/AX、metadata 不增加 refresh 次数、第三方恢复不能续签旧 A、用户显式刷新恢复、切项与退休 Host 路径；没有因文案修正触动 effect 或接纳门。
- corrected completed 父计划实际存在，active 旧路径不存在；第39行现在可定位原 proof API/回滚合同。`git diff --check 351cc5dee0d0688fc24843fb1d482602425b23bb` 经 Python subprocess argv 退出0；相对精确父提交的全部 apps/packages/tests 代码增删仍799。
- 同步上述两处局部差异到原不可变副本后，最终整表再跑 `node scripts/review-mutate.mjs review-spec.json`：退出0，R1–R3/D1–D4 共7/7 KILLED，killedBy归因与首轮一致，基线及还原后基线均绿；`final-tree-mutation.log`。全部变异文件与当前 worktree逐字节一致，生产 worktree未被变异。

结论：F1 ADDRESSED，F2 ADDRESSED；无新增 P0/P1/P2/P3。无需重复广泛测试，四候选最终组合及远端 head门由主评审完成。

## Progress

- [x] 2026-11-10：审查前矩阵已预置；独立锁定不可变差异与实际必要父。
- [x] 2026-11-10：完成代码、产品、架构、测试判别、issue/范围及重复追踪全层审查。
- [x] 2026-11-10：62+90+9 窄验证、2 浏览器、生产状态反例与4 child变异完成；远端 head/base 再读未变。
- [x] 2026-11-10：主评审已一次提交正式评审5835143312（APPROVED），精确包含F1/P2与F2/P3；主评审实施两处修复，本子评审完成独立复评，均 ADDRESSED。
- [ ] 最终远端门禁、评审事件及任何合并由主评审继续；installed/hierarchy/R1不在本叶关闭。

## Surprises & Discoveries

已有端到端安全测试均绿，仍未判别 unavailable 与 unread 的最终文字：新生产探针明确观察到 wire状态不同而页面相同。不能用浏览器套件通过代替这条验收。归档后的父路径与真实树不一致，虽不影响运行，但应在正式交付记录中修正。

## Decision Log

2026-11-10 / 独立子评审首轮：无可行动 P0/P1；F1 P2、F2 P3均属非阻塞，建议 `APPROVE` 并同时提交建议。

2026-11-10 / 独立修复复评：F1/F2均 ADDRESSED，无新增可行动问题。修改只在既有状态映射行加入 unavailable 文案，并修正父计划路径/补充证据，不新增状态/探测/cache。低影响文字映射用完整 App 判别探针及现有生产浏览器回归验证，不为镜像表达式新增提交测试；代码预算仍799。

## Idempotence and Recovery

本轮只读命令/探针可重跑；变异副本已逐字恢复。本 PR可作为独立能力叶回退；若两层一起回退，先移除 #590 consumer，再回退 #592 proof API。无数据库迁移或业务关系回滚。

## Interfaces and Dependencies

`planning.issue_dependencies.read` 与 `listIssueDependencies` 是独立只读能力；Host 显式 refresh返回 local_only/非权威观察，UI只消费安全目标。父 proof 机制在 Core 共享，UI只见 cohort metadata。父 #543 的四向关系范围、真实账号权限和 installed artifact 接受仍独立。

## Outcomes & Retrospective

首轮全部层次已完成，无 P0/P1；原F1/P2与F2/P3现均经修复独立复评通过，无新增可行动问题。当前复评范围是原不可变 head 加主评审两处本地修复，精确源 hash 与命令见下文；新远端 head/base/checks 必须由主评审发布后重新锁定。没有真实 GitHub 内容完整性、installed、人类/UAT 或 R1 通过声明；最终组合验证和远端门禁交由主评审。

## Bottom Change Note

2026-11-10：补齐完整风险矩阵、独立 Provider/Core/Host/client/UI 因果审查、新鲜窄验证/浏览器/变异证据及 F1/F2 的精确新增行锚点；生产实现和远端未写入。

2026-11-10 SGT 首轮正式回读：`Singularity-AI-Bot` 已在锁定 head `351cc5dee0d0688fc24843fb1d482602425b23bb` 一次提交完整 review `5835143312`，事件为 APPROVED。最终 push 后须重新锁定并取得当前版本结论。

2026-11-10：补记两处主评审修复的独立复评；区分 unavailable/unread 的真实 App 回归与2项浏览器通过，最终候选副本7项变异全部KILLED，原父因果代码未变。

2026-11-10 SGT 整合门：全部四项非阻塞修复已独立复评通过，最终固定组合 f172cb02 的完整工程证据与逐实际 main 门见 `docs/review/2026-11-10-pr586-pr592-mmp-review.md`。本 PR 最终 push 后仍重读精确 head/base、托管检查、批准、全线程和双向 issue 关联；与受验前缀逐 blob 不符则回到验证。

2026-11-10 SGT 最终接合观察：#586/#588/#592 已按实际前序 rebase 合入；本层直接 base 为 main@938789c6。GitHub 自动重放远端 head 的完整非文档 manifest 已单独比对并建立备份，最终精确 lease 使用观测的26e40591。修复与安全源码字节仍等于独立接受版本及固定最终组合；最终 current-head CI/批准/issue/merge 回读由整合者执行。
