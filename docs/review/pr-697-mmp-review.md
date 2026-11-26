# PR #697 MMP 交付评审

## Purpose / Big Picture
判断 #693 的重开恢复与项目作用域导航是否形成可独立验收、合并和回滚的增量。组件测试不替代已安装 Host 的人类接受或 R1。

## Context and Orientation
2026-11-26 SGT 锁定 head `666c1b51a6b9a851a74368da3737c05fe37b2e13`、base `feature/multiproject-create-switch@20a8c6674fba691cca064470146afd70fca19c87`。执行上下文：检出 `feature/multiproject-restore-navigation` 的 `.worktrees/mp-693-restore-navigation` 根目录。阅读 AGENTS、PLANS、MMP 手册及下表后才逐文件审查；PR、全部六个 commits、所有 threads/reviews/comments、checks、#693/#636 和开放 issue 清单使用主评审已捕获的同 head 事实。当前没有 review threads。

## Design / Spec
采用 Superpowers 评审约定、Qian Systems Router 的全链路核对和 First Principles Development 的最小判别反例。边界是私有选择文件 → Host 启动/激活 → client setup → Gate/路由。继承问题归最早引入层，本记录不重复 #695 的客户端作用域缺陷。

| 严重度 | 初始风险与反例 | 层 / 最小判别证据 | 首轮结论 |
|---|---|---|---|
| P0 | 凭据泄漏、私有根逃逸、不可恢复数据破坏、合入即破坏 main | 安全准入、fd 写入、公开 diff | 本层未发现；POSIX 原生拒绝路径通过，Windows 原生只沿用该 head CI |
| P1 | 恢复失败阻止 Host、旧目标结果进入新上下文、错误 Saved、单一事实源破坏 | 启动降级、显式优先、scope 门、真实 React 反例 | 本层未发现独立 P1；继承层风险由主评审裁决 |
| P2 | 导航失败无法退出、迟到目标吞掉新意图、失败获取泄漏 fd | Gate + 真实 setup source；私有数据获取失败 | 确认 3 项，见下文 |
| P3 | 证据漂移、测试自证、重复追踪、未接受范围 | 变异、issue/计划/安装消费者 | Gate 测试存在实证盲区；无重复 owner issue；安装接受仍属 #694/#636 |

### 首轮发现

1. **P2 — 失败链接成为永久 pane 覆盖，Home 的恢复动作失效。** 新增锚点 `packages/ui/src/workspace-setup.ts:71`。A 可用而 B 链接打开失败后，`linkFailed` 固定强制 `projects`，优先于 `leave()`、`enter('create')` 和成功 `openProject()` 更新的 navigation；`initialPath/setupSource` 不变时 effect 不重跑。真实 React+Chromium 中点击「返回项目」仍停 Home，点击「创建工作区」也不出现表单。保护结果：失败链接必须允许显式返回/创建/打开另一个可用项目。根因是失败 inbound link 没有消费/被新导航替代的生命周期。最小完整修复：用同一导航 owner 消费初始链接，让用户显式 Home 动作替代该意图，同时清除传入工作项页的旧路径；只清 `link` 会让 `linkPending` 永久为真。补 Gate 的失败 → 返回/创建/成功另开反例。
2. **P2 — B 激活未完成时的新 C 链接从未提交。** 新增锚点 `packages/ui/src/workspace-setup.ts:55`–`57`（inline 取 55）。真实 `WorkspaceSetupSource.open` 在 mutation pending 时返回当前 mutation 的 promise；因此 B 的 open 挂起后修改 `initialPath` 为 C，Gate 的 `open(C)` 加入 B，B 完成后 Gate 读到 B 并把 C 标成 failed。真实 React+Chromium 观测 `calls=['B']`、active B，C 从未发往 Host。`isCurrent()` 只丢旧解析结果，不能令新目标取得自己的 activation。保护结果：最新有效显式链接最终确认为其目标，旧 pending 激活不得吞掉它。最小完整修复：为不同目标保留有序、目标绑定的导航意图；旧 mutation 结算后，仅当新意图仍 current 时再激活其目标，并以其自己的确认结算。与上一项统一修复导航 owner，不加定时重试。
3. **P2 — Windows 选择文件获取失败泄漏已打开的日志 fd。** 新增锚点 `apps/harness-plugin/src/host-private-data.ts:101`。`prepareWindowsProjectData` 已返回 `lease.logFd`，新增 selection `openSync` 抛错时 catch 只调用 `lease.dispose()`；后者只关闭 helper，不关闭 Node 日志 fd。获取失败发生在 composition 建立 logger/dispose 之前，之后没有 owner 可关闭它。生产 `preparePrivateProjectData` + synthetic Windows helper 协议反例确认 helper 已退出，而 `fstat(logFd)` 仍成功；原生 NTFS 安全准入不是这个反例的证明范围。保护结果：失败启动释放本次获取的全部资源，重复重试不累积 fd。最小完整修复：失败分支先关闭 `lease.logFd`，通过 finally 释放 lease，并保留固定错误；补 selection open 拒绝后的所有 fd 关闭断言。

## Global Constraints
仅修改本报告与本 worktree 的 `.superpowers/review-697/` 运行态证据；没有产品修复、commit、push、GitHub review 或 issue 写入。共同实施事实源仍是 `docs/exec-plan/completed/2026-11-25-multi-project-workspaces.md`。不改 Planning Status、关系、用户数据或已安装 profile。

## Plan of Work
1. 已完成：锁定 head/base 和完整元数据，先建 P0–P3 矩阵，再检查代码、产品、架构、测试和工作项。
2. 已完成：最窄回归、生产 Gate 的真实 React 反例、Windows 获取失败反例，以及首轮诊断变异。
3. 主评审后续：一次性提交全部意见；按根因修复后重新锁定新 head，独立复评，再履行归档、交付与最终远端回读。这里未执行这些后续动作。

下列命令均在上文 immutable head 的 worktree 根目录执行；期望与实际一并给出，便于移植复现：

| 命令 | 期望 / 实际 |
|---|---|
| `node --test tests/integration/harness-plugin-host-reopen.test.js tests/contract/ui-workspace-setup.test.js` | 0 fail；实际 59/59 pass |
| `node --test tests/browser/workspace-restore.test.js tests/integration/harness-plugin-private-data.test.js tests/integration/harness-plugin-windows-private-data.test.js` | 0 fail；实际 97 tests：78 pass、19 native Windows skip、0 fail |
| `node .superpowers/review-697/gate-browser-repros.mjs` | 反例确认；实际真实 React+Chromium 同时复现发现 1/2 |
| `node .superpowers/review-697/windows-acquisition-repro.mjs` | 反例确认；实际 helper 已关闭且日志 fd 仍打开 |
| `node .superpowers/review-697/gate-repros.mjs` | hook 反例确认；实际重现发现 1/2，并确认继承的 A→B→A 草稿复活差异 |
| `node scripts/review-mutate.mjs .superpowers/review-697/mutation-spec.json` | 有效退化应被指定用例杀死；实际 3 KILLED、1 SURVIVED，退出 1；基线与逐字还原后的基线都绿 |
| `node scripts/rule-checks.mjs size feature/multiproject-create-switch` | 不超过硬门；实际代码 798/1000、文档 24/1500；PR 正文 796 为旧值 |
| `git diff --check 20a8c6674fba691cca064470146afd70fca19c87...HEAD` | clean；实际退出 0 |
| `gh api repos/SingularityKChen/harness-projects/check-runs/139314199842/annotations` | 查明可选红 check；实际明确为本地 DSH review endpoint 404 |

### 首轮诊断变异（修复后须重做最终整表）

每项声明 `killedBy`；通过仓库 `review-mutate.mjs` 施加/还原，没有手改产品源。运行集合为上表 Host reopen + setup contract，另加 browser restore。

| 变异 | 受保护结果 / killedBy | 结果 |
|---|---|---|
| 忽略显式初始目标 | `explicit initial target outranks the preference` | KILLED |
| 偏好项目装配失败直接拒绝启动 | `a preferred project that fails to assemble` | KILLED |
| 两次读后都移除 current 检查，仍尝试旧目标 open | `deep link resolution drops stale results` | KILLED |
| Gate 不调用 resolver、直接当 active | `the setup gate accepts an optional initial deep link` | SURVIVED |

## Validation and Acceptance
本层首轮为 0 P0 / 0 P1 / 3 P2；按仓库映射，主评审可使用 `APPROVE` 并进入已授权根因修复，栈的阻塞判断仍须合并其它层结果。报告与 `.superpowers/review-697/inline-review.json` 提供同一三项意见；尚未提交 GitHub。

Captured exact-head checks：PR Fast Gate、Verify、Browser、Windows Native、Disclosure、Size、Issue policy 均 success；唯一 failure 是 Create review session，annotation 明确本地 review endpoint 404，按 MMP 手册属于非必需检查。最终 push 后仍须由主评审回读。

#693 是本层恢复/导航 owner，#636 是完整能力 owner，#694 是组合/打包/安装态资格 owner；开放清单没有另一个同义恢复 owner，不能把父子覆盖视为重复 issue，也不能因子 PR 自动关闭 #636。安装态 `apps/harness-plugin/src/client.ts` 没有传 `initialPath`；计划明确宿主没有 URL/route API，真实浏览器深链夹具直接调用 resolver 并渲染项目页，没有经过生产 Gate 的上述 effect。因而现有 browser pass 只证明共用 resolver 与 Host 链路，不能证明 Gate 的链接恢复/并发生命周期或安装态外部深链。本次真实 React 反例补的是 Gate 验证，不构成已安装 Host 人类接受。

## Progress
- [x] 2026-11-26 SGT：锁定初始事实，先建 P0–P3 矩阵。
- [x] 2026-11-26 SGT：完成全矩阵首轮审查、窄验证、反例和首轮诊断变异。
- [x] 2026-11-26 SGT：生成全部 inline payload，交主评审一次性提交。
- [ ] 产品根因修复、独立复评、最终远端回读、归档及任何合并。

## Surprises & Discoveries
- 断开生产 Gate 的深链解析后，61 项现有 Host/contract/browser 检查仍绿；浏览器走夹具自己的导航编排，静态 Gate 用例只断言初始 loading 文案。
- 已有 Windows 获取失败文案声称“释放半开私有根”，但 helper dispose 不拥有 Node logFd；必须分别核对所有资源 owner。
- A→B→A 草稿会复活：本报告 hook 反例中 B 不显示 A 草稿，返回 A 又显示 `A-UNSAVED-DRAFT`，与 reset 设计不同。代码在本 PR base 及 #695 已存在，已交主评审路由，不作为 #697 新 inline，也不重复上游客户端作用域缺陷。
- PR 正文代码规模 796 与 exact-head 机械值 798 不一致；属于交付元数据更新，不另开产品缺陷。

## Decision Log
- 2026-11-26 / 人类直接指定的总体 owner 授权保持原范围：“你负责后续：三思后修复，但禁止 adhoc 式修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。”覆盖 #695–#698；本子评审只调查和记录，提交 review、修复与后续流程由主评审承担。
- 2026-11-26 / 子评审：三个独立反例全部按 P2 提交，合并修复时将发现 1/2 收敛为一个导航意图 owner；不以新增 unsupported 宿主 URL API 掩盖测试接线差异。

## Idempotence and Recovery
变异夹具已逐字还原全部产品源，前后基线通过。运行态反例使用隔离临时目录和无凭据 fake ports；Windows synthetic 反例结束时主动关闭泄漏 fd。只有本报告为新增未跟踪文件；未覆盖任何用户改动。修复后所有结论均须对新 head 复评。

## Interfaces and Dependencies
Node、真实 React 18、Playwright Chromium、SQLite、Host composition/remote、client setup source、现有 Windows helper synthetic 协议；无需业务网络、凭据或已安装 profile。主评审拥有 GitHub payload 提交与跨层整合。

## Outcomes & Retrospective
首轮发现 3 P2，覆盖失败导航、并发目标意图及获取失败资源 owner。Host 恢复路径有有效判别证据；Gate 生命周期证据不足已通过真实 React 反例定位。没有产品修复或已安装接受结论。

## Bottom Change Note
- 2026-11-26：逐文件审查前创建初始矩阵。
- 2026-11-26：补齐首轮全矩阵、三项可复现发现、exact-head 验证、变异及范围归属；后续修复与复评留给主评审。

2026-11-26 F3 根因修复与独立复评：selection 文件打开失败时，已获取的 logFd 与 helper lease 分别尝试清理；两种清理异常不能覆盖原固定 HostAuthorityError。原泄漏反例 RED，cleanup 异常分支也先 RED；修复后5/5，独立复评5/5并确认fd EBADF、helper退出、close/release恰好一次。privacy/Windows组合100=81pass/19native条件skip/0fail；typecheck/diff通过。F1/F2导航及已记录的project draft reset尚待本层接合修复，不把局部F3批准当整层完成。

2026-11-26 组合复评新增阻塞：真实browser两次看到Host已接受新Home baseline（低revision0、独立generation）且getWorkspaceSetup返回null/restore.corrupt，生产UI仍缓存A设置。sync.read对无workspace的baseline返回undefined，apps/client原snapshot!==undefined条件漏掉A→Home，导致不失效旧设置意图且不刷新。当前应REQUEST_CHANGES；此为#693恢复消费者闭环，新增apps/client及mounted-client回归归本层，不另开重复issue。需真实corrupt-preference重开在既有timeout下通过，不能仅靠rerun或延长超时。

2026-11-26 Phase3修复冻结：同Source的导航队列与可消费path生命周期覆盖手动动作、latest/superseded/cancelled链接及Source更换；新链接撤销旧create UI交接但不删除Source未确认意图。项目连接草稿在scope变化时实际清除，全局create恢复草稿保留。apps/client把已观察项目→undefined视为变化，真实Home baseline会撤销旧阶段并重读null/restore；损坏偏好重开在原7秒下通过。当前P1已实现修复，最终整体独立复评与当前head CI仍待，不能继承原666的批准。

冻结产品验证命令（在`5ab9e7e031a4f60c2f01534abf9449420767e626`加Phase3六文件的检出根运行）：`node --test tests/contract/ui-workspace-setup.test.js tests/integration/harness-plugin-setup-client.test.js tests/integration/harness-plugin-host-reopen.test.js`94/94；`node --test --test-timeout=120000 tests/browser/workspace-restore.test.js tests/browser/project-switch.test.js tests/browser/projects-home.test.js`5/5；typecheck、boundaries10/10、diff检查通过。原关键反例均red→green；暂计代码986/1000，后续完整整表变异和公开面检查由当前最终树重算。

2026-11-26 整体修复独立复评：候选`6334345aa62ca571766cf972004c5e17fe904e5e`（产品包SHA-256`5ca8423631a1ca8aea1e85e9a13ca6a3e08de18373febd22901cc1e7acd65bbb`）spec与quality通过，无剩余实质发现；独立窄组17/17与真实损坏偏好/production Gate browser2/2通过。原F1/F2/F3及组合新增Home P1均关闭，原阻塞结论Superseded by本段；新head仍须CI和Bot批准。

同产品源码在栈顶`6d02ac3c8fce936ff703878900b3346a310158bb`完成`pnpm verify`：contract1677pass、integration2431pass/34平台条件skip/0fail、e2e226pass；`pnpm test:browser`119/119。该组合只在本层之上增加资格测试/文档，未改变本层产品blob。

最终变异命令`node scripts/review-mutate.mjs .superpowers/review-697/final-mutations.json`覆盖：显式选择优先、偏好装配失败回Home、迟到链接读取、手动消费失败链接、最新目标串行、旧create交接失效、项目草稿清除、Home观察、日志fd释放、获取错误保留、production Gate实际调用resolver。均以相应用例名归因；M10定义收窄为try/finally仍释放helper后传播cleanup错误，隔离错误边界且避免把helper挂起当错误文本证据。结果与字节还原以最终整表输出为准。

2026-11-26 最终整表有效结果：上述11项全部KILLED，基线与字节还原通过；无产品/测试残留变异。Source程序与独立批准6334345及组合验证6d02ac3保持相同blob。最终公开号/CI由push后回读完成。

2026-11-26 最终远端回读：批准 head `4c666811787f24a00450389e8f0a9ff80222cb1b` 的 Fast Gate、Verify、Browser、Windows Native、Disclosure、Size 和 Issue policy 均通过；三条原线程已逐一回复并解决，#693 五项工程验收已核对并关闭。Bot 最终 APPROVE 后按 expected-head rebase 合并为 `8424ec76397a71b5685fac7db9c98e235e245661`，两树相同。原 Progress 最后一项由本段及栈顶归档记录替代；#694/#636 安装态人工接受仍开放。
