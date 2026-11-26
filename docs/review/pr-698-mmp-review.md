# PR #698 MMP 交付评审

## Purpose / Big Picture
判断本层能否独立验收、合并和回滚；代码测试不替代用户闭环、已安装 Host 接受或 R1。

## Context and Orientation
2026-11-26 SGT 初始锁定：head `8fc462d3a4078a31375426f5a9476487f9733848`，base `feature/multiproject-restore-navigation@666c1b51a6b9a851a74368da3737c05fe37b2e13`。本层为 #698，所属 issue #694；完整 PR、commits、threads 和 checks 已读取，结论须随版本重新锁定。执行上下文为检出 `test/multiproject-isolation-qualification` 的 `.worktrees/mp-694-qualification` 根目录。

2026-11-26 SGT 最终复评锁定产品与测试 head `6d02ac3c8fce936ff703878900b3346a310158bb`；随后仅归档与更新文档。其 `apps/**`、`packages/**` 与已批准公开 #697 head `4c666811787f24a00450389e8f0a9ff80222cb1b`、已合入 main `8424ec76397a71b5685fac7db9c98e235e245661` 无差异。首轮 head 的 REQUEST_CHANGES 只代表当时结论；现状见本记录最终复评。

## Design / Spec
先建立风险矩阵再逐层审查。核对代码、产品、架构、测试、反例、issue 接受和重复追踪。所有首轮 inline 意见一次性提交；P0/P1 请求修改，只有 P2/P3 则批准并进入根因修复。修复需独立复评。

| 严重度 | 风险与反例 | 层 / 最小判别证据 | 最终复评结论 |
|---|---|---|---|
| P0 | 凭据泄漏、私有根逃逸、不可恢复数据破坏、合入即破坏 main | 架构 / 安全边界、schema、发布面 | 无现存发现；本层仅资格测试与文档 |
| P1 | A 操作写入 B、旧代响应进入新项目、错误 Saved、恢复失败阻止 Host、单一事实源破坏 | 代码 / 产品；并发、失败、重开、真实接线反例 | 原关闭范围问题已按 Refs/open 人验边界修正；最终远端关联仍须回读 |
| P2 | 可恢复的导航、错误反馈、幂等、状态隔离或验收断言不足 | 产品 / 测试；用户路径与相对 base 的判别验证 | 原执行归属缺口已补；首次切换前身份、pending ack 与退休后晚值具判别证据 |
| P3 | 文档和证据漂移、过度设计、重复追踪、提交粒度与可读性 | 设计 / 工作项；issue、计划、范围、当前 checks | 产物与依赖差量、completed 索引已补；复用现有装配与夹具，无新状态容器或运行时依赖 |

## Global Constraints
遵守七条系统不变量；不写 Planning Status 或依赖关系；评审账号 gh-review（Singularity-AI-Bot），开发/作者回复/合并 gh（SingularityKChen）。仅本 PR 的代码和本评审记录属于本层 ownership。沿用唯一跨层 ExecPlan `docs/exec-plan/completed/2026-11-25-multi-project-workspaces.md`；归档在栈顶完成。

## Plan of Work
1. 锁定远端事实、关联 issue 和风险矩阵；完整分层审查并运行最窄判别验证。
2. 一次性提交首轮 review；按根因修复、独立复评，更新本记录。
3. 归档计划、整理交付提交、公开面/体量检查、最终 push 回读，当前门通过后按原生栈 rebase 合并。

验证命令在具体证据处仅记录一次，必须注明检出分支或不可变版本；回滚使用备份 ref 或 revert 本层，不删除 workspace 数据。

## Validation and Acceptance
所有 P0/P1 排除或关闭；每项发现有代码位置、可观察影响与判别证据。全部检查、issue 关联和线程以最终远端 head 回读为准；安装态人类接受与 R1 独立。

## Progress
- [x] 2026-11-26 SGT：锁定初始事实并先建 P0–P3 矩阵。
- [x] 2026-11-26 SGT：完整首轮审查与一次性 review；原问题作为历史保留。
- [x] 2026-11-26 SGT：资格证据修复与独立 spec/quality 复评通过，最终本地全量验证与六项变异已回读。
- [x] 2026-11-26 SGT：文档归档、指标与接受边界复核完成；原笼统“根因修复、独立复评与最终门” Superseded by 本项及下一项。
- [ ] 最终提交/push 后的当前 head/base、必需 CI、批准、全部 threads 与无关闭 #694 关联回读；rebase 合并和授权清理由主会话执行。

## Surprises & Discoveries

首轮结论（`8fc462d3`）：P0=0、P1=1、P2=1、P3=1；REQUEST_CHANGES。这是验收与关闭范围的结论，不是说已执行的自动化失败。该历史阻塞结论 **Superseded by 本节“最终独立复评”（2026-11-26）**。

| 发现 | 反例与根机制 | 处置方向 / 重复追踪 |
|---|---|---|
| P1：#694 的关闭范围超出实际证据 | issue #694 第五条明确要求受支持已安装 Host 的精确产物人类走查；文档第 264 行明确未执行，计划第 298 行仍把组合/打包/安装态整批勾完，仅 PR 正文使用 Closes #694，现有三条 commits 都是 Refs #694。合并会关闭仍缺原始验收的叶子。 | 当前 PR 交付自动化资格证据，改 Refs #694 并保持剩余人验和父项 #636 开放；不能替人勾接受。已由 #694 跟踪，不另开重复 issue。 |
| P2：执行归属映射没有执行运行反例 | installed-core-acceptance 第 246 行把第 5 组映射到 Planning reconciler 计时器/回复；对应测试只挂 planning、从未 startWork/getExecutionContext/refreshExecutionRun。既有 host-execution 只测单 workspace 重开，switch 用例 execution_run 为空。它们不能证明 A 中已有运行切到 B 再回来仍保留 workspace/provider/issuer。 | 在真实 Host+SQLite 路径补一个非空运行和切换中 pending 操作的最小用例，断言无启动/取消/错归属、返回仍可读及 actor/provider 身份；再更新映射。范围已有 #694，不建新项。 |

验证（2026-11-26 SGT，在本记录 Context 的原始 head 检出运行）：

- `node --test --test-timeout=120000 tests/integration/harness-plugin-multiproject-matrix.test.js tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-migrations.test.js`：39 pass / 0 fail / 0 skip。
- `node --test --test-timeout=180000 tests/browser/multiproject-qualification.test.js`：3 pass / 0 fail / 0 skip。
- `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`：成功；tarball 368710 B / SHA-256 `d739bd2f756e335e50ce26c2be6c1b165bedc6f205a3871987012e281ad2c069`，两个 lib 摘要均与记录一致。旧证据身份可复现，没有将旧 head 的 artifact 声称为新安装接受。
- 四条可选 Create review session 红检查的实际日志均为本地 DSH endpoint HTTP 404；已有 #364 跟踪。本轮必需 PR Fast Gate 与三条执行 lane 均 success；#696/#698 旧 Issue policy cancelled 各有 success 后继。

初始为四层依赖链；不同层共享装配和导航边界，跨层问题归属最早引入该问题的层。

P3：#694 验收第六条要求 raw/gzip/packed 与 package graph delta，当前记录只有当前 raw 字节及摘要；补多项目前不可变基线与当前产物的 raw/gzip9/tarball/input/external 差值，不据此虚构性能或体积回归。独立复核支持上述 P1/P2/P3 与一次性评审范围。此处缺口状态 **Superseded by 本节“最终独立复评”（2026-11-26）**。


### 2026-11-26 最终独立复评

**Spec 与 quality 均通过；现存 P0/P1/P2/P3 = 0，建议 APPROVE。工程自动化资格可合并，#694 installed 人类接受未完成，#636 完整接受仍 OPEN。** 此结论不替代最终发布 head 的 CI/批准/线程及关闭关联回读，也不授予人类安装接受、R1、#647 或 Planning `Status` 裁决。

| 首轮问题 | 当前证据与关闭理由 |
|---|---|
| P1 关闭范围 | 归档 ExecPlan、README、安装接受文档均明确工程范围完成与 #694/#636 人验 OPEN；不把 packed/lib 当作安装态接受。2026-11-26 实时只读回读两 issue 均 OPEN、原始人验条款保留。PR 正文已 Refs #694/Refs #636。 |
| P2 执行归属 | `harness-plugin-multiproject-execution.test.js` 在第一次切换前保存 manual 完整运行与 Harness pending checkpoint；核对原 session/request、workspace、providerRef 与 authenticated peer 回执，B 不见 A，返回保持原身份并可刷新；没有额外 create/prompt。 |
| 迟到回复判别 | 原回复在 drain 前释放且内容不变的弱证据已替换：1 秒夹具读取期限使 B 在 raw A 回复仍 held 时完成激活，随后返回克隆的有效独特 title/sourceVersion 页面；释放后全库不变且 B 不发布该内容。5 秒用例上界及 Q5 共同证明有界等待，未改产品代码。 |
| P3 产物证据 | `installed-core-acceptance.md` 的 2026-11-26 节记录基线 `e7a84328` 与公开候选、Host/client raw+gzip9、tarball 与输入/外置差量及复核命令。已独立比对实际计量 JSON；Host/client 只新增合计三个仓库内输入，无新增第三方运行时依赖。 |
| 文档闭环 | 唯一计划移入 completed，13 个 PLANS 章节保留，README 与四份 review 的路径同步；历史设计/完成声明就地标 Superseded，恢复来源使用公开 PR/main 提交，不依赖待清理临时 ref。源码与测试无归档附带修改。 |

最终验证证据：在上述 `6d02ac3` 的 `.worktrees/mp-694-qualification` 根目录，主会话执行并由本次评审回读日志：`pnpm verify` exit 0，contract 1677 pass；integration 2465 total / 2431 pass / 34 平台条件 skip / 0 fail；E2E 226 pass。`pnpm test:browser` exit 0，119 pass / 0 skip / 0 fail。没有把平台 skip、人类接受或旧 head 批准算作通过。

最终变异的可移植重放入口：在仓库主检出根目录、目标工作树仍检出上述冻结版本时，运行 `node scripts/review-mutate.mjs .superpowers/review-695-698/698-final-mutations.json --root .worktrees/mp-694-qualification`。最后整表 exit 0，基线与还原后基线为绿、所有原文字节还原；spec/log 位于本地运行态，不作为需提交的文档内容。

| 变异 | killedBy / 最终结果 |
|---|---|
| Q1 去掉 peer generation 栅栏 | real Gateway dual peers with business data / KILLED |
| Q2 放宽投影 workspace 谓词 | A and B share work-item / KILLED |
| Q3 不清旧 reconciler timer | each switch retires exactly one reconciler / KILLED |
| Q4 取消策略准入 | a failed switch keeps the previous preference; a preference write failure never fails the switch / KILLED |
| Q5 移除 Planning 读取 deadline | a noncooperative Planning reply after deadline / KILLED |
| Q6 不持久保留 pending run 身份 | harness execution retains its original workspace / KILLED |

Q4 首轮误选了注入普通装配失败的用例，结果 SURVIVED；该用例不验证 unsupported policy，因此没有把它伪称为 killed。随后改选真实 `manual_only` 且断言 `not_supported` 的重开用例，重新运行完整六项，得到上述最终结果；不改产品迎合变异。

发布剩余门：首次实时回读时远端仍为旧 head `8fc462d3`；正文虽已改 Refs，`closingIssuesReferences` 仍残留 #694。主会话必须在最终单提交 push 后重锁，确认关闭关联清空再合并，不能据旧关联或本地文档推断已关闭该外部门。该待执行回读不是现存源码 finding，不将首轮历史 P1 继续当作修复后工程阻塞。

## Decision Log
2026-11-26 / 人类直接指定：“你负责后续：三思后修复，但禁止 adhoc 式修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。”覆盖 #695–#698，授权当前评审会话负责修复与条件合并；P0/P1 修复并复评前不得合并。

## Idempotence and Recovery
每次推送前保存本层旧 head 为本地 backup ref，并使用精确远端 lease。失败保持当前分支和已存工作区；不以清理覆盖未提交工作。

## Interfaces and Dependencies
GitHub PR/issue/reviews/checks；已有本层 worktree；依赖链 #695 → #696 → #697 → #698。评审边界不授予规划字段写入权。

## Outcomes & Retrospective
工程自动化资格独立复评通过，原 P1/P2/P3 已修复或以精确证据补齐，建议 APPROVE。#694 原 installed 人类接受与 #636 完整接受未完成并保持 OPEN；R1/#647/Planning 状态独立。最终 push、远端当前门、关联清空与条件 rebase 合并由主会话继续，不提前记为完成。

## Bottom Change Note
2026-11-26：在逐文件审查前创建风险矩阵和可恢复的评审流程。

2026-11-26 局部修复复评：新增 `tests/integration/harness-plugin-multiproject-execution.test.js` 两例均通过。manual在首次切走前捕获完整run；Harness在pending prompt时捕获已保留providerRef并核对session/request、actor回执，排空后B不可见A，返回仍是同一provider/issuer并可刷新，不重新create/prompt。首次复评指出身份取样过晚，已在首次切换前取样且独立复评spec/quality通过。当前旧产品树2/2不代表最终组合、产物指标或人类安装接受完成；P3指标待实际最终产品树测量。

2026-11-26 迟到回复资格修正：原用例在旧lease排空前释放回复，且返回同内容，不能独立证明“退休后晚值”。现仅在夹具注入1秒读取deadline，保持原始Provider promise不合作直到B激活后才返回；克隆有效page并改唯一title/sourceVersion，释放后全库不变、B不发布A载荷。5秒用例上界保护有界退休。矩阵6/6，另一次重接合后的execution+matrix8/8均通过。首个测试实现直接改Fake共享content污染了B，已改为只克隆迟到page；未改产品实现。独立spec/quality复评通过，最终deadlinemutant仍待整合后运行。

2026-11-26 最终独立复评：冻结产品/测试与归档文档已核对，首轮问题改为历史并由最终矩阵替代；回读全量日志、六项最终变异和真实构建指标，建议 APPROVE，保留 #694/#636 OPEN 与待执行远端回读门。
