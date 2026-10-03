# tests/integration

跨包集成测试：可以有临时数据库与临时 Git 仓库，但仍然**不触网**。归入 Merge Gate。

## 第一批用例

以下用例是本层的第一批，按优先级排列（2026-09-26：SQLite v1 栈落地了 1、2、3、4、6；5 属于本地 Git 工作树 provider，随 #160 落地）：

1. `migration from empty` —— 空目录建立 Schema，约束与唯一索引生效（`migration-runner`、`identity-membership-schema`、`execution-relation-write-schema`）；
2. `restart restore` —— 进程重启后身份、关系与执行上下文不丢失（`storage-restart`：关句柄后重开同一文件）；
3. `event dedupe` —— 同一条 Provider 事件处理 N 次与处理 1 次结果相同（`storage-sync-surface`）；
4. `mutation idempotency` —— 重复提交同一外部写入不产生第二个外部对象（`storage-restart` 的写尝试幂等覆盖；Start Work 的同键重放见下文）；
5. `worktree lifecycle` —— 工作树创建、重复创建拦截、脏工作区拒绝清理（未落地，随 #160）；
6. `rollback on failed transaction` —— 事务失败后不留下半写状态（`storage-restart`、`storage-sync-surface`）。

## Start Work 恢复（#183 / #184 / #165）

四个文件组装 core，跑完整的 `startWork` 补偿序列（不触网）：前两个用离线 Development 替身，后两个（`local-git-*`）用 `mkdtemp` 临时仓库上的真实本地 Git provider。用裸 ID（`wi-*`）开始工作的用例先经 `local-git-fixture.js` 的 `registerWorkItem` 登记成可操作的工作项（实体 + 当前工作区的 `work_item` 投影）；从规划种子取工作项的用例要再按 `content.contentKind === 'work_item'` 过滤（redacted 条目的 `kind` 也是 `work_item`）：

| 文件 | 用例 | 保护的不变量 |
|---|---|---|
| `start-work-step-recording.test.js` | 分支步成功后立刻回填 | 步骤结果分步落盘：「分支已建好」在**工作树步之前**就写进执行上下文记录 |
| | 基线前进后重放 | 重放**跳过**已完成的分支步、不重新解析 `fromRef`，复用既有分支 |
| | 接管的头提交 | 复用不是静默的：被接管分支的头提交出现在结果面 |
| | 退化工作项 id | `workItemId: '---'` 被结构化拒绝，不塌成共享的 `work/work-item` |
| | 重放不得改变已决定的分支身份 | 序列一旦决定了身份，本次请求就不得改写它：声明另一个分支名是**矛盾**（结构化失败），不是新输入 |
| | 不去猜 | 记录里没有 `branchExternalId` 时，即使同名分支已存在也必须**重走分支步**——不得用「名字像」推断所有权 |
| | 重放省略 `branchName` | 第三步（启动执行）也用**已决定**的分支身份：run command 不得回落到本次请求的默认名 |
| | conflict 复用跨页（P3） | 同名分支排在 `limit: 100` 的第一页之外时仍被认出并报出头提交，不是 `failed / conflict` |
| | 游标永不结束（P4） | 分支探测读到页数上限后报 `unknown / result_unknown`，不判成「创建未生效」也不挂住（替身每次调用让出宏任务，否则超时断言本身失效） |
| `start-work-retry-identity.test.js` | 换新幂等键重试 | 可清除的失败之后，同一个上下文能被做完（`Failed` 不再永久锁死） |
| | 接管保留步骤字段 | 接管用 `{...existing, ...}`；重建记录会让「跳过分支步」失效——与同一文件的 `branchStepCalls === 0` 互为契约 |
| | 同 key 不重新尝试 | 幂等键重放优先：同 key 返回那一次的报告，**换新 key 才是重试** |
| | 在途仍被拒 | `Provisioning` 且租约未过期时不接管——接管只针对终态 |
| | 一条 `has_worktree` | 恢复路径只写一条关系，且 `to` **精确等于**按 `(workspaceId, repositoryId, workItemId)` 算出的身份 |
| | 身份只有一处派生 | 写入与投影必须派生出**同一个**身份：复刻真实 provider 的「句柄是规范化路径」形态后，读一次谱系不得多一条 confirmed 关系 |
| | 身份不随路径变化 | 路径是属性不是身份：改 `worktreePath` 重试仍然只有一个工作树实体 |
| | 身份的作用域是仓库 | 作用域是 `(workspaceId, repositoryId, workItemId)` 而**不是 binding**：供应完成后把仓库读能力置为不可用（同一 Storage 上重组 core）再读谱系，两侧仍然一致（binding 的解析有多个来源，两个 key 可以独立不可用） |
| | 两个仓库上的两份工作树 | 同一工作项在同一 binding 的两个仓库上各有一份工作树，是两个实体而不是一个 |
| `local-git-start-work-resume.test.js` | 基线前进后换新键重试（R1） | 真实仓库：接管中断前建的分支、头提交不变；重试期间的 Git argv 里没有 `branch`、`main^{commit}`、`symbolic-ref`——「基线是否前进」不进入判定 |
| | 能力不可用不抹掉分支（R2） | 已决定的分支身份写一次：记录与结果面都仍是 `work/<id>`，那一次不新写 `has_worktree`；恢复能力后在基线前进下仍 `ready` |
| | 不保留工作树句柄（R3） | 写一次只针对分支：没走到工作树步的失败尝试清掉旧句柄，谱系不会把它当作已观察到的锚点 |
| `local-git-branch-probe.test.js` | 接管跨页（P1） | 目标分支排在第一页之外时头提交仍被报出（诱饵数与探测页大小的耦合写在文件里） |
| | 写入已落地但响应丢失（P2） | 分支多于一页时对账读完全部页，不把磁盘上已有的分支判成 `not_found`「创建未生效」 |

**替身边界的如实说明**：`start-work-*` 两个文件用的是离线 Development 替身（外加一处最小的 `createBranch` 覆写，用来复刻真实 provider「同名分支指向别处」的拒绝语义），**不是**真实临时仓库。真实本地 Git 上的恢复与分页证据在 `local-git-start-work-resume.test.js` 与 `local-git-branch-probe.test.js`；四个文件都用离线 storage，SQLite 与进程重启仍归 #141（被 #137 / #120 阻塞）。「重启」在 R2 / R3 里只是「同一 storage、同一 workspace 换一套能力重新组装」。

## Start Work 的前置登记（#187 / #188）

`start-work-sqlite-registration.test.js` 经 `composeCore` + `commands.startWork`，在替身 Storage 与真实 SQLite 文件上各跑一遍（离线 Development / Execution 替身，不触网）。断言业务结果（外部增量、context 对应的 run、边与 attempt），SQLite 的外键完整只是必要条件。失败注入走测试侧的 Storage 包装（同时包根方法与事务里的 tx 代理，共用命中计数；除写后失败外还有「写不进去」与「事务里的关系写入被静默丢掉」两种形态），每个注入点都有命中计数与无故障正控：

| 用例 | 保护的不变量 |
|---|---|
| 空仓库集合上开始工作 | 从未登记仓库的库上一次到位：挂载与 canonical 身份（角色 primary）、三个实体的种类、两条 confirmed 关系、`saved` 的 attempt、context 对应的 run；外部分支 / 工作树 / 运行各 +1；并且在同一次开始工作里，分支创建被调用的瞬间挂载与 Provisioning 上下文（带租约）已经提交、关系端点的实体已登记 |
| 工作项守卫 | 未知、别的工作区、变更请求、被扣下的条目在任何写入之前被结构化拒绝（`not_found` / `not_found` / `invalid_input` / `unavailable`），零外部写入、零本地新增；有效工作项仍可开始 |
| 只读的读能力 | 仓库读、工作树读为 `read_only` 时仍可开始工作：门表把读门误写成写门会误拒它们 |
| ack 与能力门 | `getRepository` 失败、回显的 binding / 种类 / id 不符（`conflict`）、仓库读与工作树读不可用、工作树与分支创建只读、分支创建不可用，都在任何写入之前失败，新请求不落 Failed 上下文；能力门先于 ack |
| 挂载冲突预检 | 同工作区同 id 已挂在别的外部身份上时 `conflict`，原挂载不变，零外部写入 |
| 写前事务中途失败 | 注入 `putRepository`、或认领自己的写 `putExecutionContext` 写后失败：结构化 `unavailable`，整笔回滚（canonical 实体、身份、挂载、context 都不留），零外部写入；同一场景无故障时成功 |
| 同一工作区的第二个工作项 | 在已登记的仓库上依次开始两个不同的工作项：都 `ready`，外部分支 / 工作树 / 运行各 +2，挂载与 canonical 仓库实体仍只有一个（预检的身份查找种类写错会把已挂载的仓库当成冲突） |
| 两个工作区同一个仓库 | 一个 canonical 实体与身份、两个挂载，ws1 的上下文引用不被搬走 |
| ack 之后本地写失败（五个注入点） | 注入 `putMutationAttempt` 第 1 次、`putRelation` 第 2 次（`has_worktree`，`tracks` 一并回滚）、`putExecutionContext` 第 2 次（分支步回填）、第 3 次（工作树步回填，写已生效、调用失败）与第 4 次（最终事务自己的 context 写，事务里第一写）：结构化 `unknown / result_unknown`（`confirmed=false`、`degraded=true`），context 停在 Provisioning 并保留已 ack 的句柄与租约，没有关系、attempt、run，`startRun` 0 次；Ready、两条关系与 attempt 同一个事务，最后一写失败则其余全部回滚，事务提交之后才发生的写（例如 Ready 挪到提交后）也抓得住；外部调用没有失败过，文案不带「原始失败」后缀；同场景无故障时 Ready（租约已清空）、两条 confirmed 关系、一条 `saved` 的 attempt |
| 工作树步失败 | `Failed`、分支保留、只有 `tracks`（`has_worktree` 只由真实的工作树 ack 产生，不借分支句柄，#192）、失败也记 `failed` 的 attempt；结算的写失败时同样 Unknown 且整笔回滚 |
| 失败结算的 Unknown 文案 | 工作树步、分支步被 provider 拒绝，再叠加结算的写失败：Unknown；有已 ack 的分支时文案说已 ack，没有任何 ack（分支步被拒，外部增量 `[0, 0, 0]`）时不称已 ack，两种情况都带上 provider 的原始失败（错误码与文案）；注入有命中计数与无故障正控 |
| Ready 之后的重放与读取（run 记录缺失、run 状态未知、`has_worktree` / `tracks` 缺失或只是候选；另有完整与主执行 ack 为 `failed` 两个正控） | 同 key、新 key、关库重开后的新 key 与 `queries.getExecutionContext` 给出同一个答案：Unknown（`confirmed=false`、`degraded=true`，保留 Ready 与句柄），不起第二个 run、不补边、本地事实一字不改；Query 是本地纯读（包装全部 provider，零调用）。正控：完整的 Ready 在同样三条路径上稳定为 Saved，外部与本地快照逐字不变；主执行 ack 的是 `failed` 仍是已确认的运行（不从 `failed` 反推）；缺口文案都以「已 ready 的上下文（缺口描述）：」开头，缺口描述放进全角括号 |
| run 的 ack 之后本地 run 记录写失败 / ack 的状态不是已知取值 | 首次即 Unknown，保留 Ready 与已 ack 的 run 句柄（供对账）；ack 的状态不是已知取值时文案陈述运行状态未知，不称本地写失败；之后三条路径都不起第二个 run；`putExecutionRun` 的注入有命中计数与无故障正控（恰好写一次） |
| 同 key 重放先于预检 | 命中的 Failed / Unknown 首次报告原样返回，Ready 不提升它，完整性守卫也不改写它；工作项之后被扣下，同 key 重放仍走重放而不是 `unavailable` |
| 租约内的在途 | 未过期的 Provisioning 不被完整性守卫改判（命令与 Query 都不判），没有再写外部；租约过期（可控时钟）后接管把序列做完，分支与工作树不重复，run 只起一次 |
| 同 key 的 saved attempt 遇到 `failed` / `provisioning` 的记录 | 记录已不是 Ready（工作树消失后被判 Failed、被新 key 接管成在途）时，同 key 重放不再原样返回 Saved：Failed 报 `failed`，Provisioning 报在途（`pending`），连续两次重放一致 |
| 接管时已有 run（主执行 ack 的状态未知，另一行接管时主执行不可用；主执行 ack 的是 `failed`；首次只落了人工降级） | 换新 key 接管 Failed 的上下文时，主执行可用（`startExecution`）与不可用（`manualFallback`）两条分支都不起第二个 run，接管的答案与它自己的重放、Query 一致：已有的 run 为 `unknown` 报 Unknown（带已有 run 的句柄，文案陈述运行状态未知）；主执行 ack 的 `failed` 是已确认的运行，报 Saved 并带回 run 句柄；人工降级如实带回 `fallback` 与 `degraded`；接管的结果面还比对分支与工作树句柄，两条 Unknown 的文案各钉住原因（首次路径「ack 的状态不是已知取值」、接管路径「已有的 run 记录是 unknown」） |
| 主执行 `startRun` 失败时并发的写者刚落了 run 记录 | 并发的写者在主执行 `startRun` 里先落一条 run 记录再失败（替身与 SQLite 各一遍）：`manualFallback` 在降级之前再读一次已有的 run，保留并如实带回它——`saved`、不带 `fallback`、run 句柄是那条记录的，不起降级、也不用 failed 的降级记录覆盖它（把检查提到开头而删掉这一处的设计备选会覆盖它） |
| Ready 的工作树读回（七行，#253 评审 P2 与复评） | 缺 run 记录的 Ready 遇到 `not_found` 也不读回、不改判（local Git 把仓库不可达也报成 `not_found`）；完整的 Ready 遇到读失败、权限被拒、没有读方法、读能力被策略关掉时保留 Ready、报 Unknown，命中的 Failed 首次报告原样返回；确定不存在或检出别的分支才判 Failed；每一行换新 key 接管都不起第二个 run |
| 主执行 `startRun` 结果不确定（#253 评审 P2，ADR-0007） | 本地 run 记 `unknown`、不转人工降级，顶层 Unknown；同 key、新 key、重开与 Query 同一个答案；unknown 的 run 记录写不进去时仍是 Unknown 而不是拒绝 |
| 工作树步结果不确定（#253 评审 P3 与复评） | 与分支步同一个对账出口：读回同路径、检出同一分支即照常 Ready，两条 confirmed 关系，不重建；读回失败报 Unknown；检出别的分支与 conflict 路径同判 Failed |
| Development 绑定 id 变了（#253 评审 P2） | 规划绑定沿用、Development 换实例后，已挂载仓库上的新工作项在任何外部写入之前 `conflict`，文案点名「绑定 id 变了」（装配固定 bindingId 归 #228，TD-015） |

## 本地 Git provider（#137）

`development-local-git.test.js` 在 `mkdtemp` 生成的临时仓库上跑真实 git argv（不触网），只覆盖
**provider 自身**的行为；经 core 的 `provisionGit` / `startWork` 的系统验收由 **#209** 交付（它复用
本节的 `local-git-fixture.js`）。本层不登记那个文件——它在本层还不存在。

| 用例 | 保护的不变量 |
|---|---|
| Development 契约套件（能力子集从 `describeCapabilities()` 推导） | 本地子集也满足 Development 契约；未声明的能力是结构化 `not_supported` + 对象集合逐字不变；方法可用时快照必须说 `available`（双向断言）；未声明的工作树移除不被索取；分支列表按 `pageSize` 逐页读完恰好枚举每个分支一次（分页契约，core 的分支探测依赖它） |
| 路径安全 + 零 Git 调用 | 越界、含 `..`、符号链接逃逸、悬空符号链接叶子、首尾空白都在**任何 Git 命令之前**被拒（断言注入 runner 的调用次数为 0；argv-only 另由源码扫描契约保证）；`..wi` 是根内合法名字，不得判成逃逸 |
| 幂等与复用担保 | 同一路径重复创建报 `conflict`；`conflict` 只留给**正面确认可复用**的登记（目录存在、分支一致、确为本仓库的链接工作树）。目录消失 / `.git` 被删（prunable）/ 被换成独立仓库 / 被 lock 后替换 / 指向主检出都硬失败 |
| 分支名校验 / 同名异指向 | 非法分支名（含 git refname 规则的 10 类）零调用被拒；同名分支只在指向请求声明的起点时复用，否则 `invalid_input`；D/F 引用冲突同样是 `invalid_input` |
| 分支身份 | 只认 `for-each-ref` 能逐字枚举、且非符号引用的名字；`pack-refs` 之后大小写变体仍被拒，磁盘上只有一条该名字的引用；符号引用不得成为工作树身份 |
| 写后回读 | `worktree add` 落到别处时报 `ambiguous_result`，不把判定时的路径报成写入后的事实 |
| 能力子集 | 只声明三个键、不实现工作树移除；`worktreeCreate: false` 时快照不可用、`not_supported`、零次 Git 调用 |
| 默认分支 | 无 `origin/HEAD` 时按本地事实推断（唯一本地分支 → `init.defaultBranch` → 约定名），**不用当前检出分支冒充**；缺失的起点 ref 在错误信息里点名 |
| 默认允许根 | 允许根在**仓库检出内**的分量是符号链接时一律零调用被拒——指向被跟踪目录、`.git`、仓库之外都一样（判的是写法，不是解析结果）；`/.worktrees/` 幂等写进 `info/exclude`、不动 `.gitignore`、主检出 `status` 保持干净 |
| 拒绝分类 | 占用路径、被别处检出的分支（前置判定必须自己点名原因）、不可访问（mode 000）目标都结构化拒绝，不伪造成功 |
| 读取 | 默认分支注入优先、短 sha 读回规范提交、rev 形态被拒、外来 binding 冷拒 |
| 仓库目录一时不可达（#253 第二轮复评） | `git -C` 进不去仓库根（「cannot change to」）报 `unavailable` 而不是 `not_found`：这是「此刻读不到」，不能让 core 把完整的 Ready 当成工作树确定丢失；目录回来后照常读回 |

## 本地 Git provider 接进 core（#207）

`local-git-core-provisioning.test.js` 经 core 的 `provisionGit` / `startWork` 断言**系统**结果：

| 用例 | 保护的不变量 |
|---|---|
| core 复用 | 同一请求重试复用既有工作树与分支：断言工作树**总数**（不是"过滤出目标路径后的结果"，后者看不见落在别处的第二份）与工作分支总数；两个句柄规范化后必须指向同一份工作树（字符串形态可以不同，见 #206） |
| 恢复供应 | 第二次 `startWork` 必须真的跑完（`confirmed / ready`），不只是"关系数是 1"——被 in-flight 挡住或工作树步骤失败时关系数同样是 1；恢复路径只写一条 `has_worktree` 关系、只指向一个工作树实体（#165 由 #185 修复后的收口条件）；**并回读磁盘**：工作树与工作分支真的在盘上、报出的句柄指向盘上那一份（#207 验收 1） |
| 供应路径上不得报 ready | 目录消失 / `.git` 被删 / 被换成独立仓库 / 被 lock 后替换，core 在**供应序列**上都不得报 `ready`，且拒绝的必须是不可复用登记本身（`invalid_input`）而不是别的失败。**范围限定在供应路径**：已 `ready` 的上下文走 `claimContext → existing`，core 不再问 provider，工作树被删后仍报 `ready / saved / confirmed`——那是 `main` 的既有行为，登记为 **#211** |
| 分支被别处检出 | core 不得报成功 |
| 默认允许根与基线 | 不注入 `allowedRoot` 时首个工作树仍能建出；只有 `trunk` 且无 `origin/HEAD` 的仓库仍能供应 |

## 人工执行 provider（#139 / #171 / #172）

`human-execution-provider.test.js` 组装**真实的**本地 Git provider + 人工执行 provider + 离线 Storage，在 `mkdtemp` 生成的临时仓库上跑 `startWork`（不触网）。只列本文件真正断言的内容；provider 自身的闸门、签名与构造约束在 `tests/contract/execution-contract.test.js`：

| 用例 | 保护的不变量 |
|---|---|
| 开始工作 | 工作树与分支真的落盘（按总数）；Storage 里 `running`，落库的 `providerRef` 就是结果里的 `runExternalId`；Storage 里只有 core 写过的那一条运行 |
| 执行起不来且没有 fallback 绑定 | 上下文保留为 `ready`、工作树与分支仍在、运行 `failed`、结论 `manual_fallback`，重查一致 |
| fallback 绑定承接 | 主执行起不来时 core 启动 fallback 绑定、落 `running` 的人工运行（#171）；重启后查询面上的交接快照（工作项、仓库、分支、工作树、运行引用、降级结论）不变，同键重放报出相同的降级结论；接管终态上下文时已有运行不被覆盖、不起新的执行者，首次结果按这条记录报出引用与降级结论 |
| fallback 的角色与写门 | 主执行 start 无权限或被设为只读时由 fallback 承接、不被当成主执行；主执行自己也声明 fallback 时承接的仍是 fallback 绑定；主执行结果不确定不承接；fallback 只读或 ack 非 running 不落运行；主执行 ack failed 不算降级；首次结论与查询面一致 |
| 重启 | 重建 core 后执行上下文、运行记录与 `providerRef` 逐字段不变，查询与重放带回同一引用（#172），不重复供应 |
| 按运行身份取消 | 并发、重复、重启后取消收敛到同一个 canceled 事实：已取消不再调 provider，否则 ack 后事务内原子替换状态与 `providerRef` |
| 重启后取消 fail closed | binding id 变了（不问任何 provider）、签发密钥变了、取消被设为只读时结构化失败，运行记录一字不改 |
| 取消与组装的边界 | succeeded / failed / timed_out 拒绝取消且记录不变；`queued` 可取消；有状态 provider 对并发的第二个取消答 conflict 时以运行记录为准；同一 execution 挂载（主备共 id）重复即拒绝组装；只注入 fallback 也承接 |

## 连接实现身份与原子注册（#197）

`provider-binding-registration.test.js` 的十三个场景由同一个 runner 在内存 Storage 替身与 `:memory:` SQLite 上各跑一遍（不复制断言），另有一条逐字固定四个实现定义的用例；全部离线，不触网。路由类场景直接构造合法挂载、不经注册，避免注册先失败遮蔽错域；用到父记录的场景（链读、取消）先登记工作区、实体、`repository` 种类的仓库身份与执行上下文。

| 用例 | 保护的不变量 |
|---|---|
| 同一连接挂 Planning、Development 与 Execution | 读回三个挂载，同配置经 `composeCore` 重复装配读回同一组；`commands.startWork` 不降级，分支与工作树各 +1 落在 Development 实例，运行 +1 落在 Execution 实例，同 id 的 Planning 实例状态逐字不变 |
| 备用 Execution 与其他域共用连接 | 主执行换 id 且 `execution.run.start` 被 policy 置为不可用：写门报「能力 execution.run.start 当前不可用」（不是「没有绑定提供」），开始工作的运行由共享 id 的备用实例落下，主实例 0 次 |
| 一个对象服务两个域 | 快照只观察一次；每个挂载只含本域 key，合法的域外 key 不被误拒 |
| 同 id 异实现、同 key 异域集合、与既有锚点冲突 | 前两者写前拒绝且 0 事务；与既有锚点冲突由 Storage 裁决，整批回滚，不留新工作区与孤儿锚点，换 key 重试成功 |
| 后序挂载写入被拒、快照在后序挂载抛错 | 整笔回滚工作区名称、先写的挂载、新锚点与旧默认的降级；快照失败时 0 事务，既有工作区不被改动 |
| 同一 execution 挂载重复与角色过滤 | 主备共 id 拒绝且 0 事务；主挂载不带 `execution.run.fallback`，备用不带 `execution.run.start` |
| 闭集与形状校验（16 例） | 未知 key / 等级 / 域 / 槽位、缺 `definition`、非法 policy 与工作区都在任何写之前拒绝；已知 key 的 `undefined` 是「未声明」，不拒绝也不授予 |
| 域集合顺序、`definition` 在 await 期间被改写 | 集合相等与顺序无关；以准备期冻结的副本为准 |
| 事务 ack 与发布时点 | ack 之前 `createContext` 不完成，ack 之后一次发布完整 Registry |
| 写命令、读门与链读按完整挂载路由 | 共享 id 的 Planning 挂载排在前面时仍命中各域实例；`read_only` 读允许、写拒绝且没有写目标；分支、变更请求、流水线与检查都读到，没有假缺口 |
| 取消回到签发者 | 按持久 `providerRef` 的 Execution 挂载投递一次；签发者只读或不可用时被拒且 Provider 调用 0；别的工作区的运行 `not_found` 且不调用 |
| 实现定义逐字固定 | `harness.fake`、`development.local-git`、`planning.github-projects`、`execution.human` 的 key 与域集合冻结，实例引用同一个导出常量（key 会落进持久化锚点，改名等同于换身份） |

## 插件安装件构建（#227，ADR-0009）

`harness-plugin-artifact.test.js` 在 `mkdtemp` 目录里调用 `apps/harness-plugin/scripts/build.mjs` 的 `build({ outDir })`，只读**产物**做断言（不触网、不需要宿主、不写工作树的 `dist/`）。它只证明产物的**形状**；宿主的 module loader 是否接受它，由 ExecPlan 里在真实宿主上的观测判定，CI 绿不是那条证据。预期值一律是测试自带的字面量（基线模块表、peer 范围 `~0.2.0-rc.2` / `~4.0.4`、宿主 Loader 的解包规则），不 import 构建脚本的常量。

| 用例 | 保护的不变量 |
|---|---|
| 安装件 manifest | `exports` 四个键逐字固定（含 `./package.json`）；没有 `dependencies` / `devDependencies`，全文没有 `workspace:`；`dsh.client.inject` 非空且每项都是 peer 的键；至少一个 `@deepseek-ai/dsh-*` peer，且所有 `dsh` / `dsh-*` peer 取同一个范围（没有这类 peer 时宿主兼容闸门直接放行） |
| patch 行 | 恰好一个 `insert` 行，`name` 等于包名（拼错时宿主静默找不到包） |
| 宿主半边 | 拷进 `node_modules` 后包名、`/package.json`、`/client` 三个说明符都可解析；`import()` 得到的 `apply` 打出就绪行；文本里没有 `@harness-projects/`、`.ts` 说明符与 `file:` |
| 客户端半边 | 在 `node:vm` 里执行：`__ModuleLoader__.load` 恰好调用一次、`id` 等于包名；按宿主 Loader 的解包规则得到 `apply` 与 `inject`；文本里所有 `require("…")` 的参数都在基线表内 |
| 注册行为 | 根 Context 只暴露 `slots`（读别的属性即抛错，复刻宿主行为）；`inject` 名字恰好是 `main` 与 `sidebar.panellist`；`main` 带 `key`，入口的 `id` 等于它并带可访问名称；面板根节点是带 `aria-label` 的 `section` |
| 构建只读本仓库 | 两份 metafile 的输入路径都是相对仓库根的相对路径；产物与 manifest 不含仓库根的绝对路径与家目录 |

## GitHub Projects 读取（#70）

`github-projects-bootstrap.test.js` 把 GitHub Projects provider 接进 core，transport 回放私有沙箱 Project A 的录制夹具（`tests/contract/fixtures/github-projects/`，不触网、不需要凭据），替身与 SQLite 两种 Storage 各跑一轮：

| 用例 | 保护的不变量 |
|---|---|
| 引导得到 8 个工作项与 1 个变更请求，重复引导幂等 | 身份 `externalId` 集合恰好是 9 个内容 node id，没有成员关系 id（R1）；本地实体 id 不等于任何 node id；PR 成员关系不产生工作项；第二次引导不新建实体（两种 Storage 都以实体 id 集合判定，替身上另读行数：实体 9、身份 9、观察 18） |
| 故障不伪造成功（离线、部分成功、分页成环或永不收敛） | 首轮组装遇 A → B → A 时 PlanningItems 恰好 6 次、视图为空、摘要 `unavailable`；可见之后依次切到离线、部分成功、成环、永不重复的游标，引导报 `ok: false` 且 `degraded`（错误码 `unavailable`、`permission_denied`、`unavailable`、`unavailable`），成环停在第 3 页、永不收敛恰好 1500 次（扫描 500 页 + 逐页读取 1000 页），错误文案含「成环或超过页数上界」；投影与故障前逐字一致，每条带 `freshness.degraded` |
| 内容被扣下：未见过 → 可见 → 部分 / 全部 REDACTED → 映射失效 → 恢复 | 没有映射时整次 `degraded` / `permission_denied` 且 `getPlanningSync` 与 controller 快照可查（0 条时也成立）；有映射时按成员关系找回同一实体、出剥离正文的 redacted 占位，被扣下的标题与正文不出现在列表与详情里；映射失效时不建实体；恢复后实体 id 不变；3 条无映射时其余 6 行保持 fresh（`stale` 与 `degraded` 正交，H11），wire 快照不含被扣下条目的内容 node id 与种类（H12） |
| 回放账本 | 回放未命中的请求为空，未命中不会被伪装成「离线」 |

## 约定

- 每个用例使用独立的临时目录/临时数据库，测试之间不共享状态。
- 断言要说明它在保护哪条不变量，而不是说明它调用了哪个函数。
- 外部依赖（GitHub、Actions、Harness）一律使用 Fake Provider 或录制的 fixture。
