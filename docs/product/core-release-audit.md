# 当前 Core 候选边界证据审计

> 观察：2026-11-04 15:01 SGT；产品源码基线 `f0883948f78a9bf0a28290e21c7b1c3842b54cf5`。
> 审计检出：`docs/core-release-evidence`，初始 head `a0c84c22a1c310c056f92c2f4baecc3d9e931e2b`；其相对产品基线只增加计划。
> 工程子项 #533，Draft PR #536；Refs #459、#73、#413。执行依据：[ExecPlan](../exec-plan/completed/2026-11-04-core-release-evidence.md)。

本页保留`f0883948`的历史证据快照；后续Host支持集拒绝见本页“后续准入修复增量（2026-11-04）”。

本页补充[首发范围](core-release-scope.md)已有规范，记录当前实现的可达性、反例与证据缺口，不另立发布标准。六组本地相关测试共 **1022 个通过、0 失败、0 跳过**，仍复现了持久非默认策略自动刷新覆盖状态；测试通过不能替代 #459 或 R1 的人类判断。

当前最需要保留的反例是 #273：合法当前库的 `host_authoritative`、`manual_only` 被生产 Host 接纳，自动刷新将本地 `done` 覆盖为 Provider 的 `todo`。这是原快照的 P1 候选，需人类归级与有界 remediation；本页没有接受、豁免或修复它。**Superseded by 后续准入修复增量（2026-11-04）**：#541已阻断Core Host接纳不支持policy的这条路径，通用Core语义仍由#273拥有。#202 的内部切源残留、#309 的特殊配置键损失、#341 的根变更恢复死路也仍可复现，适用条件分别列明。

以下“通过”只指表内具名实验的局部结果。实际 GitHub 写入、真实模型、当前 artifact 安装、人类 UAT、staffing/review/UAT availability 均未由本次审计执行。#451/#532 的并行未合并增量不属于上述源码基线；不能合并若干 Ready PR 的描述冒充已安装 RC。

## 复跑入口与证据层级

E1–E6和P273/P202/P309/P336/P341均属于上述`f0883948`历史产品快照；完整复跑必须在该精确source的独立检出根运行，不能以含#541的当前分支替代。可在仓库根执行以下命令；若目标工作区已存在则停止并选择另一未使用路径，不覆盖既有工作。

```sh
git worktree add --detach .worktrees/core-audit-f0883948 f0883948f78a9bf0a28290e21c7b1c3842b54cf5
cd .worktrees/core-audit-f0883948
pnpm install --frozen-lockfile
```

在该检出复制执行本页E/P命令。Node 实跑为 `v26.13.0`，pnpm 使用锁定工具链。离线 Provider 录制/替身不使用真实凭据、模型或业务网络。每组输出须非空，退出 0 且没有 skip；重跑数变化时按当前输出更新本页。

| 编号 | 可复制命令 | 本次结果与范围 |
|---|---|---|
| E1 | `pnpm test:file tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-authority.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/integration/storage-baseline-admission.test.js` | 176/176；真实 Gateway/Host peer、严格参数、重装配、空库/当前库/坏库准入 |
| E2 | `pnpm test:file tests/integration/harness-plugin-runtime-access.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/start-work-owner-fencing.test.js tests/integration/local-git-start-work-resume.test.js` | 85/85；当前权限、最后确认、PR 原操作恢复、代际 fencing、真实 Git |
| E3 | `pnpm test:file tests/integration/pull-request-identity-convergence.test.js tests/integration/planning-membership-reconcile.test.js tests/e2e/chain-bootstrap.test.js tests/integration/sync-revision-freshness.test.js tests/e2e/status-policy.test.js tests/integration/provider-binding-registration.test.js` | 227/227；身份/成员、幂等/乱序、三策略工程正交、挂载注册与事务 |
| E4 | `pnpm test:file tests/integration/start-work-external-intent.test.js tests/integration/start-work-execution-recovery.test.js tests/integration/planning-refresh-scheduler.test.js tests/contract/storage-connector-account.test.js tests/integration/storage-connector-account.test.js tests/integration/human-execution-provider.test.js tests/contract/host-node-types.test.js tests/integration/harness-plugin-demo-artifact.test.js` | 348/348；精确外部意图、持久 run、原生人工 Provider、secret 句柄、Host 类型/真实包合同 |
| E5 | `pnpm test:file tests/contract/harness-host-operations.test.js tests/e2e/runtime-access-browser.test.js tests/integration/harness-plugin-host-providers.test.js tests/integration/harness-plugin-repository-binding.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/workspace-setup-commands.test.js tests/integration/development-local-git.test.js tests/integration/planning-snapshot.test.js` | 149/149；实际 carrier 进入 strict service、未声明操作拒绝、catalog/绑定/root、快照原子性 |
| E6 | `pnpm test:file tests/integration/harness-plugin-issue-closing-links.test.js tests/integration/harness-plugin-host-planning-mapping.test.js` | 37/37；当前新增原生关联入口、映射身份/类型、迟到撤权和重启 |

P273/P202/P309/P336/P341 是本页后附的可复制探针，正控必须先成立；其中失败断言证明缺口仍在，不能把 exit 1 计入测试通过数。原始 issue/PR JSON、完整 stdout、实验脚本留忽略的运行目录；公开复现依赖本页代码与仓库内 fixture，不依赖某台机器的日志路径。

## 后续准入修复增量（2026-11-04）

#541已rebase合入`e6153dcb7b81a2d23bead4db7142387fc0da11c6`，与独立批准的`777300d9`tree相同。当前Core Host在Provider构造/自动刷新前拒绝selected workspace的host_authoritative/manual_only；重装配检测到专用拒绝时同步停止旧图。这替代原快照“Host仍接纳这两策略”的可达性结论，不代表共享Core已实现#273的policy×incoming语义，也不接受其它finding、当前RC或R1。

在含该合入source的检出根执行`pnpm test:file tests/integration/harness-plugin-policy-admission.test.js`，期望10个正式准入/替换/普通失败正反控通过。本轮独立评审另执行5个排队任务/严格client/Storage先行准入反例和4项具名归因变异；完整证据见[PR #541评审](../review/pr-541-mmp-review.md)。已标记generation3的原件保留与有效未标记库先由Storage标记的边界不混淆。

在当前source直接执行历史P273会先遇到明确不支持错误，不能将这个不同出口冒充旧覆写断言仍失败，亦不能计入旧1022组通过数。原23入口、九finding和12+10表是日期/source绑定的历史矩阵；最终RC仍须按#459/#73重新核对完整当前候选。

## 声明入口、调用者与状态拥有

动态全集命令：

```sh
node --input-type=module -e "import { OPERATIONS } from './apps/harness-plugin/src/host-operations.ts'; console.log(JSON.stringify(Object.values(OPERATIONS).map(({name,mode})=>({name,mode})), null, 2))"
```

本次得到 **23 项：22 unary、1 stream**。声明和所有参数 parser 都在 `apps/harness-plugin/src/host-operations.ts`；`remote.ts` 由同表生成 Host/client descriptor。含 actorRef 的操作由真实 Connection peer 替换调用者填写的 actor，缺失 peer 拒绝；只读方法不从 actorRef 获取权限。Gateway/Host 上下文、当前作用域和 runtime access 是读写边界，不能用伪造 actor 获权（E1）。

下表 H 指 `apps/harness-plugin/src/host-composition.ts` 的 `handlersFor`，S 指同文件 `dispatch` 的设置 handler；UI 接线统一在 `apps/harness-plugin/src/client.ts`。所有本地状态最终由 Host→Controller/Core→Storage 拥有，UI 不直接调用 Provider。`configure` 以 barrier/drain/epoch 串行激活；ack 前设置结果为 `local_only`，不能说外部已保存（E1/E5）。

| 入口 | 生产 handler → 状态/副作用 owner | 当前 UI 调用者 | 正控、负控与剩余证据 |
|---|---|---|---|
| `baseline` | S→source.baseline→一致读取/快照 | workspace watch恢复、仓库绑定读取 | E1/E5非空、epoch重读、撤权遮蔽；未执行当前artifact安装 |
| `bootstrapWorkspace` | H→Controller.bootstrap→Core全量同步/本地投影 | 无直接按钮；UI用refreshPlanning | E1/E3非空、事务回滚/同观察幂等；非默认策略反例P273 |
| `refreshPlanning` | H→Controller.refresh→Core single-flight读取 | 规划刷新按钮 | E2/E4真实刷新、offline/撤权/超时；P273自动tick保留阻塞 |
| `getExecutionContext` | H→Core查询，前后可见性、workItem/repository匹配 | execution reader/抽屉 | E1/E5真实DTO、foreign/不可见scope隐藏；不提供私密原run引用 |
| `refreshExecutionRun` | H→Controller/Core→实际执行Provider.getRun→本地确认 | execution reader刷新 | E2 runtime准入与源码前后可见性；本次未单独穷举该wire所有Provider状态，保留缺口 |
| `getStartWorkOptions` | H→validateStartWork及目标准入 | Start Work选仓库 | E2/E5合法仓库及撤权后拒绝；不能由选项推断创建已发生 |
| `startWork` | H→Controller→Core耐久intent/owner→Git与执行 | Start Work提交 | E1/E2/E4真实peer、重复/新键/断言、未知零备用；#451四写入浏览器尚未进入本基线 |
| `createChangeRequest` | H→Core→GitHub Development；finish重新核对原操作/目标 | PR创建表单 | E2丢ack、原精确输入、最终目标变化不确认；无真实GitHub写入 |
| `getChangeRequestOperation` | H→Core原操作观察；actor只用于当前observer准入 | PR恢复表单 | E2新peer可读原operation、wrong selector/当前target拒绝；错误scope不能读取其它operation |
| `resumeChangeRequest` | H→Core reconcile→finish确认 | PR恢复按钮 | E2整回执丢失/Host重建/原operation；不重新create，过期目标不报Saved |
| `createWorkspace` | S→workspace setup，本地事务固定ProviderAuthoritative | 创建工作区表单 | E1/E5空库正控、同自然键幂等/不同名称冲突；wire不能传statusPolicy |
| `connectAccount` | S→githubViewer只读预检→本地账号句柄 | 连接设置/仓库绑定 | E1/E5真实录制viewer、缺凭据/假身份拒绝；不保存secret值 |
| `bindPlanningSource` | S→preflightPlanningConnection→本地唯一挂载 | 连接Project表单 | E5同目标重放、换启用源conflict、仅停用源not_supported；P202内部/预存状态不因此被证明安全 |
| `bindRepository` | S→只读preflight→Core三引用原子登记 | 仓库绑定表单 | E5真实Git/录制远端；路径/三引用/账号不一致和SQL中途失败零半写 |
| `installExecutionBindings` | S→execution setup事务→Harness主、人类备用 | 启用Harness执行 | E4/E5同ID重启、主备用isDefault、残缺/停用冲突；不自动调用模型 |
| `getWorkspaceSetup` | S→当前fingerprint/activation与Storage读取 | 设置页/重连恢复 | E1/E5无workspace/配置/已确认、激活失败degraded；local提交不冒充active |
| `getPlanningMapping` | S→mapping.load+fingerprint/新鲜度 | 映射设置读取 | E6实际字段发现、错project隔离、失败可重试；不按名字猜歧义选项 |
| `setPlanningMapping` | S→validate expected binding/project→setup事务→重装配 | 映射设置保存 | E6旧目标/错kind/晚到派生拒绝，用户保存赢；无Provider写入 |
| `getIssueClosingLinks` | H→Core原生来源观察缓存 | Issue原生PR关联reader | E6非空、纯读零请求、scope/撤权隐藏；不等于当前执行PR已确认 |
| `refreshIssueClosingLinks` | H→Planning原生连接+实际PR decoder | Issue关联刷新 | E6真实离线transport分页/正反例、跨Issue迟到撤权/NOT_FOUND；不靠标题/分支/LLM猜关联 |
| `getDeliveryProjection` | H→Core，前后scope与access版本循环确认 | PR/CI谱系reader | E2最后一个await期间撤权不泄漏，重启不复活历史CI；不代表实时平台验证 |
| `refreshDeliveryFacts` | H→Core lineage路由→Provider读→原子观察 | PR/CI刷新按钮 | E2当前scope成功/denied/offline/未提交；不由CI事实写规划状态 |
| `watch` | Host.watch→streamWorkspace；remote严格JSON编码/abort/drain | openWorkspaceWatch | E1/E2/E5真实流与dispose、late metadata/重连；stream不是unary写入口 |

E5 的 `browser unary bridge reaches installed strict service and rejects undeclared operations or fields` 从同一 carrier 实际调用 `writePlanningStatus`、`applyPlanningStatus`、`cancelExecutionRun`、`setSourcePolicy`、把watch当unary和额外scope字段，均拒绝；合法baseline/context为非空正控。这里的“installed strict service”指测试装配的服务，不是实际安装tgz。`harness-host-operations.test.js` 又断言未知名/原型键/非字符串在guard与handler前零调用。两层证据同时保留，不能仅因UI没有按钮就称能力不可达。

## Workspace、policy、catalog、root、database 准入

| 输入面 | source与控制 | 本次正/负控与结果 | owner / 下一门 |
|---|---|---|---|
| 空workspace/profile | `host.ts`、`host-authority.ts`；S.createWorkspace | E1/E5空库创建；缺/相对/文件profile在开库前拒绝；两个profile隔离 | Host；当前tgz安装另验 |
| 新建policy | S.createWorkspace固定`ProviderAuthoritative`；wire闭集 | E5只允许name、额外policy参数拒绝；Storage新建策略是provider | Host；不覆盖已存policy |
| 当前持久Provider policy | H.assemble原样传workspace.statusPolicy | P273生产catalog正控接纳，显式本地写被not_supported拒绝，自动tick保持todo | Host/Core；该正控不代表其它policy安全 |
| 当前持久Host/manual policy | 同一assemble；SQLite已知枚举合法 | P273两种均接纳且自动tick将done→todo，exit1；原policy未改 | **原#273 P1候选保留；Host可达性Superseded by 后续准入修复增量（2026-11-04）**；完整策略语义另评审，无自动coerce |
| 第二启用Planning源/公开切源 | workspace setup与Storage唯一约束 | E3/E5第二源冲突、disabled后切换not_supported；拒绝原库不变 | Core setup/Storage；P202不能因此豁免 |
| disabled旧投影/预存切源 | `queries.ts:planningSnapshot`逐投影取primary identity | P202 Fake/SQLite均5→10，旧源5条仍可见；普通切源wire被拒；生产catalog预存混源Host未另做全例 | #202保留；需明确合法存量准入/过滤，不能断言当前边界已证明不可达 |
| 固定catalog与unknown实现 | `PROVIDER_CATALOG`、hostStoragePolicy、restoreProviders | E5已知挂载按原ID恢复；unknown/错domain/坏账号/坏配置局部disabled，既有记录保留 | Host；无wire注册任意catalog入口 |
| enabled=false与冲突执行槽 | restoreProviders、execution setup | E5跳过用户停用挂载，不自动复活；同角色多挂载拒绝，不让备用顶替主目标 | Host/Core；重启/修复读回另验 |
| secret/config | connector-account parser、固定handle/schema | E4/E5仅句柄、错账号/未知字段拒绝、canary不落库；P309自定义特殊schema仍有parser缺陷 | #309；默认catalog无特殊声明键，未声称发生污染攻击 |
| repository/allowedRoot | preflightRepositoryBinding.realpath、LOCAL_GIT_ENTRY、resolveWorktreePath | E5真实Git合法根；`..`、bare、checkout内输出根、符号逃逸拒绝，零半绑定/越界写 | Host/LocalGit；P341为根改变后的恢复缺口 |
| 合法当前库 | `migrate.ts`精确generation/schema/ledger | E1非空current、合法引号/ASCII空白正控，重开行/世代不变 | Storage；数据语义policy另行判定 |
| 旧/未知/结构错库 | 同一准入，migration/factory两入口 | E1旧generation、prefix/gap/future、伪装版本、缺column/index、Unicode变形拒绝且全库不变 | Storage；不反向迁移、不自动删除重建 |
| 空库原子初始化 | 全链事务及generation写入 | E1 late-DDL/ledger/marker/commit故障全回滚，可重试；句柄释放 | Storage；不是历史数据库升级承诺 |

## 九项开放 findings 的实际边界处置

2026-11-04逐一`gh issue view <n> -R SingularityKChen/harness-projects --json number,title,state,body,comments,labels`回读，九项均OPEN。下表状态是工程观察，非人类风险接受；后续字段不构成豁免。

| issue | 当前生产source与可复跑证据 | 结论、限制及下一owner |
|---|---|---|
| #191 | `start-work.ts`耐久intent、`change-request`原操作；E2/E4未知/丢ack/重启无重复；E5拒绝普通Planning写wire | Core主路径已有特定恢复证据；一般Planning写restart“先reconcile”全语义未在本页证明完成。Core owner保留原issue，不由PR路径通过代替一般命令 |
| #202 | `queries.ts:planningSnapshot`、`workspace-setup.ts:bindPlanningSource`；E5公开切源拒绝；P202双适配器失败 | 内部切源仍混源；已存合法混源状态的Host准入风险未闭合。保留remediation，普通UI切源暂拒绝只缩小触发面 |
| #215 | `execution-run.ts`、`start-work.ts`、`storage-execution.ts`、human Provider；E4原run事实/四字段/备用角色；E5拒绝cancel wire | #458收口的4/5/7不重复报未修；cancel的耐久actor/key、ack后本地失败收敛、非terminal ack等完整AC仍未完成，内部Core可调用，首发wire拒绝。Core/human owner保留原issue |
| #273 | `host-composition.ts:assemble`、`bootstrap.ts:toProjection`、`status-policy.ts`；P273实际生产catalog/录制GitHub/SQLite自动tick | 原快照合法非默认policy可达且静默覆写，P1候选保留；Host可达性Superseded by 后续准入修复增量（2026-11-04）；人类policy×incoming决策仍开放。只拒绝不支持policy且原库不变的有界Host修复可独立评审，不能在审计中偷换策略 |
| #309 | `connector-account.ts:parseBindingConfiguration`；P309输出丢`__proto__`、缺省optional constructor误拒绝；E4普通合同通过 | 通用parser缺陷仍在。当前production catalog特殊声明键为空、wire不能注入schema，故不称默认配置已受污染或攻击成功。capabilities/Storage owner保留修复 |
| #313 | package engines≥22、`.nvmrc`/CI26、workspace导出TS；E4 Host类型/实际tgz合同通过 | source最低运行时未实跑，声明覆盖缺口保留；当前compiled bundle `HOST_NODE_TARGET='node22'`，Host类型ceiling是24.18.1，不能把两者混写成Node24构建target或证实安装失败。toolchain owner补实际最低runtime矩阵 |
| #336 | `planning-reconcile.ts`与`diagnostics.ts`仍两份absorber；E3/E4、P336 cross-realm/throwing then/non-Error/post-stop/dispose | 五探针各报告一次、0 unhandled；生产Host sink同步写日志，不接外部任意sink。重复helper和长期判别测试AC仍缺，保留refactor issue；未观察当前默认Host失控 |
| #340 | LocalGit `paths.ts:firstLink`/默认root；Host preflight先realpath，正式注入profile外根；E5路径拒绝/合法根 | 默认provider或原始symlink配置的错误拒绝问题仍未修；普通新绑定canonical化缩小触发面。fail-closed未见越界写；精确symlink布局仍需Provider修复/回归，不把可用性缺陷称安全突破 |
| #341 | `start-work.ts`Ready验证、LocalGit允许根；P341真实Git改注入根后Ready+result_unknown，worktree集合不变 | 条件性恢复死路仍在。固定profile不提供改root按钮，但移动数据根/原库注入的准入不可由此证明安全；保留Core恢复设计。不是兼容迁移任务，也不得把越界handle当缺失后写入/采用 |

## R1 十二行：本候选证据与缺口

条件原文与裁决者以[release-gates.md](../architecture/release-gates.md)为准。本表不写另一份“R1通过”。

| R1 | 本次工程证据 / 正负控 | 仍缺什么；责任owner |
|---|---|---|
| 1 E1 | #73的人类记录确认2026-10-15 freeze；E3复跑身份/幂等 | freeze不自动满足物理v1/#223或其它R1；人类伙伴维护裁决 |
| 2 空库/原子性 | E1空库重复、非空current、失败全回滚/拒绝原库不变 | 仅当前本地1022组相关证据，不是完整target CI；CI owner |
| 3 十不变量 | 下表逐条绑定E1–E6及P202/P273/P341反例 | 未决反例/覆盖缺口仍保留；CI+独立人类评审 |
| 4 PR Fast Gate稳定 | 协调者回读main该SHA一组CI成功；未把Issue policy成功算Fast Gate | 最终候选同head连续两次与真实check身份尚未核对；CI+人类回读 |
| 5 Merge Gate稳定 | main该SHA观察到一次Merge Gate success；本地E3包含非空e2e | 当前目标同head连续两次、integration/e2e各非空运行证据不足；CI+人类回读 |
| 6 无P0/P1 | 九findings逐条处置，P273当前反例保留且已向协调者报告 | 人类归级及bounded remediation未完成；不能宣称计数零或无风险 |
| 7 外部事实所有权 | E2/E4 ack未知不确认、原intent/reconcile、Provider事实不由client覆写 | P273持久非默认policy当前拒绝不足；一般写路径与独立对抗复核仍需人类评审 |
| 8 LLM不控制状态 | Host声明→显式Core/Provider owner；本次无模型；E3工程事实不写Planning | 本页未穷举全仓控制路径/所有扩展，需契约与代码人类审阅；不能由“零模型调用”证明不存在路径 |
| 9 offline/revocation | E2实际生产Host/remote/client晚到撤权、普通offline保留许可缓存、重启不复活 | 当前安装候选真实平台/人工走查缺口；CI+人工 |
| 10 Start Work恢复 | E1/E2/E4耐久intent、owner、本地Git、备用、未知零重复；P341条件性反例 | #451四写入浏览器增量尚未在基线；安装Host/人工恢复仍缺；CI+人工 |
| 11 UAT | #449/#143/#124/#72回读仍OPEN；有历史特定source/产物Web记录 | 当前candidate的现代UI、人类demo、实际PR+Checks路径接受未见；人类伙伴，agent不自证 |
| 12 backup/rollback | #369 OPEN；#532/#535正在独立准备当前真实sandbox演练 | 四步实际演练及人类在#73判断未进入本基线；本页不借源fixture补齐 |

main hosted快照只观察到本产品SHA各一条CI、Merge Gate、Push on main成功；其它Issue policy多次成功/取消不属于同一R1分母。复核命令为`gh run list -R SingularityKChen/harness-projects --commit f0883948f78a9bf0a28290e21c7b1c3842b54cf5 --limit 100 --json databaseId,name,event,headSha,status,conclusion,createdAt`；仍需按release-gates §2.2核对最终head和两次运行，不借旧main记录给新RC盖章。

## 十项不变量：当前断言与适用边界

| # | 原不变量 | source/命令/非空正控与负控结果 | gap / owner |
|---|---|---|---|
| 1 | 单一Planning事实源 | E3/E5注册/唯一约束、公开第二源拒绝；P202旧源投影5条仍可见 | 来源切换/预存derived层仍缺；Core/Storage+人类 |
| 2 | 成员关系与内容身份分离 | E3 membership删除/再加入保持entity身份、错误project全轮拒绝 | 当前已安装真实Project成员变化未重做；identity owner |
| 3 | PR-backed条目不产生第二WorkItem | E3 pull-request identity convergence、chain-bootstrap当前PR/回指项同entity | 录制/Fake+SQLite层，不是实时平台完整矩阵；identity owner |
| 4 | Draft→Issue内部身份不变 | E3 chain-bootstrap提升前后entityId相同、相关alias/冲突用例 | 本次未新做把提升改为新实体的mutant；CI+人类按原判据复核 |
| 5 | 规划与工程正交 | E3三策略×CI失败/执行完成/PR合并不写规划；来源/工程概念分开 | P273是Provider同步越过本地policy的独立反例，不能被正交用例绿掩盖；Core |
| 6 | 外部未确认不报Saved | E2/E4 PR/run创建丢ack、持久intent、最后target确认；外部对象唯一 | 不穷举所有一般Planning写，#191/#215剩余语义保留；Core/Controller |
| 7 | 重复事件N次等同一次 | E3 chain-bootstrap及sync-revision：同观察N次、实体/账本/修订号不变 | 无网络本地当前运行；真实平台重复事件接收另验；Storage/sync |
| 8 | 乱序不覆盖新观察 | E3先新后旧、旧不落账本/投影/修订号不变，双适配器 | 不推及未测所有Provider时间语义；Storage/sync |
| 9 | 缺能力拒绝命令 | E3挂载门、E5LocalGit缺create零Git调用，E2撤权零新副作用 | 已选Core命令，不能代表每种内部命令；未声明Host方法实际拒绝由E5补充；capabilities/Core |
| 10 | Start Work重启可恢复 | E1/E2/E4 SQLite真实重开、原key/identity、owner恢复与真实Git保留 | P341改root后Ready未知仍有条件性死路；安装/人类验收另验；execution owner |

## 可复制的反证探针

这些命令在本页指定检出根运行，不修改产品文件。临时数据库/仓库只属于该实验。P273先验证生产catalog与非空真实Provider录制正控；P202/P309/P341精确标明更低层或条件性入口。预期失败保留为缺陷证据，不增加“坏行为应通过”的长期回归测试。

### P273：生产Host接纳持久policy后的自动刷新

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHostComposition } from './apps/harness-plugin/src/host-composition.ts'
import { PROVIDER_CATALOG, hostStoragePolicy } from './apps/harness-plugin/src/host-providers.ts'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { WORKSPACE, seed, seedWorkspace, seedPlanning, replayFetch } from './tests/integration/fixtures/host-seed.js'
const results=[]
for (const policy of ['provider_authoritative','host_authoritative','manual_only']) {
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'policy-audit-'))), dataPath=path.join(root,'workspace.sqlite');let host
 try {
  await seed(dataPath,PROVIDER_CATALOG,async s=>{await seedWorkspace(s,policy);await seedPlanning(s)})
  const replay=replayFetch(),callbacks=[]
  host=await createHostComposition({dataPath,workspaceId:WORKSPACE,catalog:PROVIDER_CATALOG,resolveCredential:async()=> 'fixture-only-not-a-token',fetch:replay.fetch,planningTimers:{setInterval(fn){callbacks.push(fn);return fn},clearInterval(){}}})
  const item=(await host.call('baseline',{})).entities.find(x=>x.content.contentKind==='work_item'&&x.planningStatus!=='done');assert.ok(item)
  const write=await host.controller.commands.applyPlanningStatus({entityId:item.entityId,status:'done',actorRef:{kind:'user'},idempotencyKey:'local-status'})
  const read=async()=>{const s=createSqliteStorage(dataPath,hostStoragePolicy(PROVIDER_CATALOG));try{return(await s.getPlanningProjection(WORKSPACE,item.entityId)).planningStatus}finally{s.close()}}
  const before=await read(),requests=replay.requests.length;callbacks.at(-1)();let after=before
  for(let n=0;n<1000;n++){await new Promise(r=>setImmediate(r));after=await read();if(replay.requests.length>requests&&(policy==='provider_authoritative'||after!==before))break}
  assert.ok(replay.requests.length>requests);assert.deepEqual(replay.misses,[])
  results.push({policy,before,after,writeState:write.writeState})
 }finally{await host?.dispose();await rm(root,{recursive:true,force:true})}
}
console.log(results)
assert.ok(results.filter(x=>x.policy!=='provider_authoritative').every(x=>x.before==='done'&&x.after==='done'),'host/manual authoritative status must survive an automatic scheduled refresh')
JS
```

本次输出provider策略`failed,todo→todo`，Host/manual两项`local_only,done→todo`；最后具名断言失败，exit1、零replay misses。显式写使用实际Host-owned Controller，**普通wire不暴露该方法**；这代表合法预存非默认policy/本地权威值的可达风险，不能说普通新建UI会自行选到非默认policy。协调者独立复跑得到相同反例。选择Host fail-closed拒绝不支持policy且全库不变可独立修复，不替人类决定#273完整policy×incoming矩阵。

### P202：内部切源后的旧投影

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { composeCore } from '@harness-projects/core'
import { createFakeProviders,createFakeStorage,createFakePlanningProvider } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
const results=[]
for(const [adapter,storage] of [['Fake',createFakeStorage()],['SQLite',createSqliteStorage(':memory:')]]){
 try{const providers=createFakeProviders(),workspace={id:'switch-audit',name:'switch'};await composeCore({workspace,providers,storage})
 const old=(await storage.listProviderBindings(workspace.id)).find(x=>x.domain==='planning');await storage.putProviderBinding({...old,enabled:false,isDefault:false})
 const planning=createFakePlanningProvider(),core=await composeCore({workspace,providers:{...providers,planning},storage}),rows=await core.queries.listPlanningItems()
 results.push({adapter,total:rows.length,oldVisible:rows.filter(x=>x.content.identity.bindingId===old.id).length})
 }finally{storage.close?.()}}
console.log(results);assert.ok(results.every(x=>x.oldVisible===0),'disabled planning source projections must not remain visible after a source switch')
JS
```

本次两适配器均total10/oldVisible5，exit1。该命令主动在Storage/Core层构造切源；E5证明公开setup对该动作拒绝。生产catalog预存混源状态能否安全准入仍未闭合，不能写成“问题已不存在”。

### P309：通用parser的特殊声明键

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { parseBindingConfiguration } from '@harness-projects/capabilities'
import { PROVIDER_CATALOG } from './apps/harness-plugin/src/host-providers.ts'
const ref={workspaceId:'audit',bindingId:'audit',domain:'planning'},configuration=JSON.parse('{"__proto__":true}')
const policy={allowedSecretHandles:new Set(),configurations:new Map([['custom',JSON.parse('{"__proto__":{"kind":"boolean","required":true}}')]])}
const output=parseBindingConfiguration({ref,configuration},policy,'custom');console.log({input:Object.keys(configuration),output:Object.keys(output.configuration)})
console.log({productionSpecialKeys:[...PROVIDER_CATALOG].flatMap(([key,e])=>Object.keys(e.configuration).filter(x=>['__proto__','constructor','toString'].includes(x)).map(x=>[key,x]))})
assert.ok(Object.hasOwn(output.configuration,'__proto__'),'declared special keys must survive configuration copy')
JS
```

本次input有该own key而output为空、productionSpecialKeys为空，exit1。另以optional constructor布尔schema和空配置调用同parser，仍误报boolean field；不能把这些通用端口缺陷夸大为默认catalog可注入schema。

### P336：诊断sink与停止后的拒绝

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { createPlanningReconciler } from '@harness-projects/core'
const turn=()=>new Promise(r=>setImmediate(r)),unhandled=[],listener=x=>unhandled.push(x),results=[];process.on('unhandledRejection',listener)
try{
 for(const [kind,sink] of [['cross-realm',()=>vm.runInNewContext('Promise.reject("sink")')],['throwing-then',()=>Object.defineProperty({},'then',{get(){throw 'then'}})],['non-error',()=>Promise.reject({message:'sink'})]]){
  let tick,reports=0;const r=createPlanningReconciler(()=>Promise.reject('round'),{timers:{setInterval(fn){tick=fn;return fn},clearInterval(){}},diagnostics:{syncRoundFailed(){reports++;return sink()}}})
  r.start();tick();for(let n=0;n<5;n++)await turn();r.dispose();results.push({kind,reports})}
 for(const action of ['stop','dispose']){let tick,reject,reports=0;const r=createPlanningReconciler(()=>new Promise((a,b)=>{reject=b}),{timers:{setInterval(fn){tick=fn;return fn},clearInterval(){}},diagnostics:{syncRoundFailed(){reports++}}})
  r.start();tick();await turn();r[action]();reject('late');for(let n=0;n<5;n++)await turn();r.dispose();results.push({kind:action,reports})}
 console.log({results,unhandled});assert.ok(results.every(x=>x.reports===1));assert.deepEqual(unhandled,[])
}finally{process.off('unhandledRejection',listener)}
JS
```

本次五项各reports1、unhandled空、exit0；仅证明现有算法这些故障能吸收，不能替代共享helper及持续mutant回归AC。

### P341：真实Git的允许根变更

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { startWork } from '@harness-projects/core'
import { makeFixture,coreContextFor,providerFor,registerWorkItem,worktreePaths } from './tests/integration/local-git-fixture.js'
let cleanup;const f=await makeFixture(fn=>{cleanup=fn})
try{const a=await coreContextFor(f),workItemId='wi-root-audit';await registerWorkItem(a.storage,a.workspaceId,workItemId)
 const q={workItemId,repositoryId:'repo-alpha',actor:{kind:'user'},idempotencyKey:'first'},first=await startWork(a.context,q);assert.equal(first.confirmed,true)
 const before=await worktreePaths(f),allowedRoot=path.join(f.root,'replacement-root');await mkdir(allowedRoot)
 const b=await coreContextFor(f,{development:providerFor(f,{allowedRoot})},{storage:a.storage,workspaceId:a.workspaceId}),after=await startWork(b.context,{...q,idempotencyKey:'changed-root'})
 assert.deepEqual(await worktreePaths(f),before);console.log({status:after.status,confirmed:after.confirmed,error:after.error?.code})
 assert.notEqual(after.status,'ready','outside-root Ready context needs a definite recovery state')
}finally{await cleanup()}
JS
```

本次Ready/confirmed:false/result_unknown、worktree集合不变，最后断言exit1。该探针显式换Core注入root，不是固定profile常规UI动作；不证明当前安装件自动搬迁了数据。路径守卫拒绝越界是正确安全结果，但恢复死路仍由#341拥有。

## 下一门与记录维护

#73、#449、#143、#124、#72、#451、#369当前均OPEN，#450 CLOSED；状态来自上述日期的只读回读，不据此替人类判定。#124的既有Web产物记录只绑定它自己的source/hash；#72仍缺同一真实WorkItem的native PR+workflow/check在安装Host中展示；#449已留用户界面反馈但没有本候选完整接受记录。#236独立非作者安装、真实模型/Desktop适用范围也不由本页补齐。

尚未取得具名reviewer、UAT操作者或人员容量的本人确认；未发送代确认消息。2026-11-06 RC cutoff、11月7–8日UAT/修复/回滚与11月8日目标是#413/#459的建议窗口，**不是可用性承诺**。当前策略反例和缺口应进入下一门及容量安排，不能按日期自动放行。

本页只关闭准确工程证据子项#533。父#459仍须完整current-RC边界、人类例外/归级、真正集成/安装和availability裁决；#273、#202、#215、#309、#313、#336、#340、#341不因本页或Post-Core字段关闭。Host admission修复已由#541独立合入，本页在原风险处标记Superseded并绑定新source及其独立证据；原快照不改写为新候选已获R1接受。
