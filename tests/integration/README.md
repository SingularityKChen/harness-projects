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

四个文件组装 core，跑完整的 `startWork` 补偿序列（不触网）：前两个用离线 Development 替身，后两个（`local-git-*`）用 `mkdtemp` 临时仓库上的真实本地 Git provider：

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
| | 身份的作用域是仓库 | 作用域是 `(workspaceId, repositoryId, workItemId)` 而**不是 binding**：把仓库读能力置为不可用，两侧仍然一致（binding 的解析有多个来源，两个 key 可以独立不可用） |
| | 两个仓库上的两份工作树 | 同一工作项在同一 binding 的两个仓库上各有一份工作树，是两个实体而不是一个 |
| `local-git-start-work-resume.test.js` | 基线前进后换新键重试（R1） | 真实仓库：接管中断前建的分支、头提交不变；重试期间的 Git argv 里没有 `branch`、`main^{commit}`、`symbolic-ref`——「基线是否前进」不进入判定 |
| | 能力不可用不抹掉分支（R2） | 已决定的分支身份写一次：记录与结果面都仍是 `work/<id>`，那一次不新写 `has_worktree`；恢复能力后在基线前进下仍 `ready` |
| | 不保留工作树句柄（R3） | 写一次只针对分支：没走到工作树步的失败尝试清掉旧句柄，谱系不会把它当作已观察到的锚点 |
| `local-git-branch-probe.test.js` | 接管跨页（P1） | 目标分支排在第一页之外时头提交仍被报出（诱饵数与探测页大小的耦合写在文件里） |
| | 写入已落地但响应丢失（P2） | 分支多于一页时对账读完全部页，不把磁盘上已有的分支判成 `not_found`「创建未生效」 |

**替身边界的如实说明**：`start-work-*` 两个文件用的是离线 Development 替身（外加一处最小的 `createBranch` 覆写，用来复刻真实 provider「同名分支指向别处」的拒绝语义），**不是**真实临时仓库。真实本地 Git 上的恢复与分页证据在 `local-git-start-work-resume.test.js` 与 `local-git-branch-probe.test.js`；四个文件都用离线 storage，SQLite 与进程重启仍归 #141（被 #137 / #120 阻塞）。「重启」在 R2 / R3 里只是「同一 storage、同一 workspace 换一套能力重新组装」。

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
| 取消与组装的边界 | succeeded / failed / timed_out 拒绝取消且记录不变；`queued` 可取消；有状态 provider 对并发的第二个取消答 conflict 时以运行记录为准；binding id 重复即拒绝组装；只注入 fallback 也承接 |

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
