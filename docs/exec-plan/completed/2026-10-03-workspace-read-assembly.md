# Client 工作区读取生产链 ExecPlan

> 状态：Completed（2026-10-04 归档）；实施、验收与第一轮评审修订完成，合并后回读见 `Progress` 的未勾选项。PR 是否 draft / ready、远端 head 与 checks 都是易失状态，按 `Artifacts and Notes` 的两条关联读取命令回读（合并前期望：唯一 open PR、base `main`、`headRefOid` 等于本分支 `git rev-parse HEAD`，`closingIssuesReferences` 含 178），不在此写值。
> 创建：2026-10-03；关联 issue：[178](https://github.com/SingularityKChen/harness-projects/issues/178)。
> 分支：`feature/workspace-read-assembly`；工作树：`.worktrees/workspace-read-assembly`；PR base：`main`。
> 调度（调查快照）：P0 / M / 迭代 5（2026-10-15–21）/ M4 · MVP Demo：Harness 内打通 GitHub 链路；Superseded by Decision Log「人类规划启动与重排期」（2026-10-03）。
> 当前调度：P0 / M / 迭代 4（2026-10-08–14）/ M4 · MVP Demo：Harness 内打通 GitHub 链路。
> 本计划依根 `PLANS.md` 维护，设计与实施合一；审查pass只表示spec可实施。

## Purpose / Big Picture

完成后，已有展示模型能直接消费客户端生产的工作区读取：工作区身份、实体表、连接、最后成功时间、能力、原因六个字段都有真实生产者。
用户断网时仍看到最后已知内容和原成功时间，并看到连接断开；空列表的权限缺口不会被显示成正常空态，部分成功确认的行仍可保持新鲜。
最小成功证据走 `composeCore → createController → createTransport → createSync → sync.read → deriveWorkItemList`，不手写最终WorkspaceRead。
这解除 #229/#135 的输入装配缺口；React页面、Harness真实transport、凭据和插件挂载仍由后续独立闭环承担。

## Context and Orientation

`packages/ui-model/src/types.ts` 的 `WorkspaceRead` 是展示输入，当前store有生产者，其余字段靠调用者手工注入。
`packages/client/src/store.ts` 按entityId保留Stable StoredEntity引用，只保存行，不保存 `WireSnapshot.source` 整表来源。
`packages/client/src/sync.ts` 有connected和baseline/delta/gap过程，缺成功时间/工作区能力/断网结算；poll抛错后connected仍可能true。
`packages/controller/src/wire.ts` 的Snapshot已有整表source，Delta没有；`packages/controller/src/watch.ts` 同revision立即返回undefined，即使source变degraded。
业务revision是持久化投影续传游标；freshness表示当前值还是最后已知值，两者可以独立变化，不能靠给失败加revision伪造业务更新。
`packages/core/src/queries.ts` 生产行和同步摘要；`packages/core/src/context.ts` 在Storage ack后才发布工作区与registry。
`packages/ui-model/src/capability-access.ts` 复制key与四态求交，依赖矩阵只允许ui-model→client/domain，不能直接import capabilities。
`packages/ui-model/src/work-item-list-view.ts` 当前把 `read.reason` 视为整页降级并污染全部行stale；部分已确认行需要在本项小范围纠正。

独立调查基线为2026-10-03 `2b51a1b`；本轮文档检出快进到 `68524a0`，产品代码相同。
两名独立设计者分别研究事实通道与故障恢复，第三名独立reviewer核查watch/store/view后裁定下面最小完整协议。
后续命令都在检出 `feature/workspace-read-assembly` 的工作树根目录运行，实施前重锁 `git rev-parse HEAD main origin/main` 和实际依赖。

## Design / Spec

### 生产者和内部公开面

Core新增一个只读查询，descriptor来自已确认Storage记录，capabilities来自本Core已确认registry：

    getWorkspaceMetadata(): Promise<{
      workspace: { id: WorkspaceId; name: string } | undefined
      capabilities: readonly EffectiveCapability[]
    }>

逐个已知CapabilityKey按现有 `bindingForCapability` 路由唯一挂载，读取已求交access；无目标key明确unavailable。
不flatMap全部绑定后让备用执行者覆盖主执行者；不重新计算Provider权限、不暴露实例/credential/raw对象。
无Storage的unavailableCore返回workspace undefined/capabilities空，与degraded source合成；不能凭输入名字伪造已确认descriptor。
Controller在同一次baseline调用中取得实体、workspace/capabilities/source，形成一个可接受帧。client不另发一次metadata请求拼两份结果。
现有controller多次Core只读采样的并发一致性不在此扩成新持久化事务模型；本项保证传输帧与客户端接受点一致，乱序竞争归 #218。其中「多次采样的一致性归 #218」Superseded by Decision Log「单帧撕裂读」（2026-10-04）：#218 只管迟到基线与代际，不覆盖单帧内两次读游标的撕裂读，该缺口登记为 TD-024。

最终Wire头为：

    interface WireWorkspaceHeader {
      readonly workspace: WireWorkspaceDescriptor | undefined
      readonly capabilities: readonly WireCapabilityEntry[]
      readonly source: SourceMetadata
    }
    interface WireSnapshot extends WireWorkspaceHeader {
      readonly revision: number
      readonly entities: readonly WireEntity[]
    }
    interface WireDelta extends WireWorkspaceHeader {
      readonly previousRevision: number; readonly revision: number
      readonly upserts: readonly WireEntity[]; readonly removed: readonly EntityId[]
    }

WireCapabilityEntry仅key/access/reason；descriptor仅id/name，所有必需头字段一次性同步旧fixture，不保留兼容双协议。
`CapabilityKey` 和 `intersectAccess` 从capabilities经controller→client显式re-export，ui-model只从client导入同一真源。

### 同revision来源变化：窄metadata事件

业务不变、source/能力/descriptor或逐行source变化时，watch发一个独立事件：

    interface WireWorkspaceMetadata extends WireWorkspaceHeader {
      readonly revision: number
      readonly entities: readonly { entityId: EntityId; source: SourceMetadata }[]
    }
    type WireEvent =
      | { kind: 'delta'; delta: WireDelta }
      | { kind: 'metadata'; metadata: WireWorkspaceMetadata }
      | { kind: 'gap'; gap: WireGap }

metadata携完整现有entityId/source清单，不带content/status/derived/remove。整表头独自变化不能代替逐行source传播。
同revision先核对entityId集合与所有非source业务字段不变；发现同revision业务变化时fail closed为gap，不借metadata悄悄修改业务。
合法metadata的header.source.revision、metadata.revision与本地store.revision一致；逐行source.revision按原实体语义保留，不擅自归一成工作区revision。
watch比较规范化内容（capabilities按key、entities按id排序），source与行变化发metadata，完全相同仍idle；不把当前时钟装进签名造成永不idle。
metadata不调用advanceRevision，不修改business revision；更高revision仍走Delta/Gap原规则，过去revision不被metadata跨过。

Store新增 `applyMetadata(metadata):void`，先校验整个carrier的形状、revision、无重复/未知/缺失id和无业务字段，再就地更新已有entry.entity.source与stale。
runtime不可信carrier也需拒绝额外业务字段，TS形状不能替代边界验证。全部检查在任何entry变更之前，失败不留半更新。
applyBaseline/applyDelta同样先验证将应用的头与修订形状；成功时保留原Stable StoredEntity对象，metadata从不新建/删除行。
拒绝帧不推进workspace/capabilities/time/reason；sync用唯一接受函数先预检帧与clock，再应用store，成功后一次发布头和连接状态。
公开读取只在同步方法完成后可见同一接受单元，不加另一个来源缓存写者。

### 客户端读取、连接和时间

Client新增 `ClientWorkspaceRead`，结构覆盖workspace/store/connection/lastUpdatedAt/capabilities/reason；ui-model WorkspaceRead改为该类型alias/re-export。
`WorkspaceSync.read():ClientWorkspaceRead|undefined` 是assembler，绑定createSync同一个store，避免传入另一个workspace的store。
首个已确认descriptor前read返回undefined；冷启动时间undefined，能力未知不能当available。首个degraded快照若descriptor有效，read可表达缺口而不伪造成功时间。
`SyncOptions.clock?:()=>string` 默认ISO时钟，测试注入固定时间；`disconnect():void` 关闭transport、connected=false并markAllStale，保留所有最后值。
connect/reconnect开始标stale；fetch/poll/recover拒绝统一断开并保留内容/头/旧时间，reason用安全散文，原异常可以继续抛给调用者。
不能把原Error.message/堆栈/平台敏感内容送给read.reason。成功接受后清旧transport原因，来源原因仍来自source。
degraded但无reason时给中性解释，不能因undefined当fresh；输出reason优先当前transport断开，其次当前source降级。

lastUpdatedAt定义为“client最后成功接受已确认当前值的时刻”，不是Provider updated_at、外部同步结束时间或持久化重启时间。
baseline/delta被成功接受且source fresh（包括真实空集），或partial帧确有fresh行时更新时间。
metadata-only失败/degraded不更新时间；仅在来源恢复确认当前值时可更新时间；纯workspace名/能力变化、idle不更新时间。
cold degraded空表保持undefined；断网、权限失败、store拒绝、clock非法均不推进时间，已确认内容也不被清空。
clock读取并校验在任何store mutation之前；store应用失败时不发布新的clock/头。未来 #218 拒迟到帧时同一接受单元全部拒绝，不能只挡实体。

### 部分成功与展示边界

source.degraded/reason表示整表有缺口；row.source只表示该行自身是否确认。assembler保留两者，不能从fresh行把整表洗正常。
`deriveWorkItemList` 已按entry/connection/time计算行stale；列表页view移除“read.reason存在就把所有行stale”的规则。
断网、失败保行、显式refreshing仍让所有行stale；整表source缺口和能力degraded只标整表降级，fresh row可保持fresh。
权限明确拒绝/读门unavailable/redacted的原缓存安全规则保持；不从旧标题/身份回退redacted。

### 备选方案与取舍

方案B发送完整same-revisionWireSnapshot，减少carrier定义，但还需逐字段业务不变校验，消费者易误用applyBaseline越权改content/delete。
选窄carrier直接约束能更新的事实，代价是一份row-source清单与store method；预算保留这份完整清单，不回退纯header事件。
方案C允许previousRevision===revision的Delta，少一种event，但混合业务推进与来源变化两种语义，使 #218 更易错误丢弃或放行。因此拒绝。
方案D只首次额外metadata query，无同revision通道，离线已连接反例仍失败，并产生独立读取拼接窗口，因此拒绝。
若实测预算超过上限，先去重复fixture/非必需surface，不能取消metadata/空表/partial/断网验收来保数字。

外部类比只辅助思考：[TanStack QueryState](https://tanstack.com/query/latest/docs/framework/react/reference/interfaces/QueryState) 区分最后成功数据时间与错误时间；[Queries guide](https://tanstack.com/query/latest/docs/framework/react/guides/queries) 区分数据状态与获取过程。
本仓库的接受时间、source和connection裁决从本地契约推导；不引入TanStack依赖，不把类比当现有实现证据。

## Global Constraints

本轮只写本计划和索引；未来唯一文件集如下，新增路径同一行说明。

| 角色 | 唯一允许文件 |
|---|---|
| Core producer | `packages/core/src/queries.ts`；`packages/core/src/context.ts`；`packages/core/src/index.ts`（仅类型导出） |
| Controller | `packages/controller/src/wire.ts`；`packages/controller/src/queries.ts`；`packages/controller/src/watch.ts`；`packages/controller/src/index.ts` |
| Client | `packages/client/src/store.ts`；`packages/client/src/sync.ts`；`packages/client/src/index.ts`；`packages/client/src/workspace-read.ts`（将新建） |
| ui-model消费 | `packages/ui-model/src/types.ts`；`packages/ui-model/src/capability-access.ts`；`packages/ui-model/src/work-item-list-view.ts`；`packages/ui-model/src/derive.ts`（仅 `reason` 契约注释，第一轮评审修订增补） |
| 测试 / fixture | `tests/e2e/workspace-read-assembly.test.js`（将新建）；`tests/e2e/client-sync.test.js`；`tests/e2e/controller-roundtrip.test.js`；`tests/contract/ui-model-presentation.test.js`；`tests/contract/ui-work-item-list-view.test.js`；`tests/contract/ui-work-item-list.test.js`；`tests/contract/ui-work-item-list-browser.test.js` |
| 文档 | 本计划；`docs/README.md`；`docs/exec-plan/tech-debt-tracker.md`（验收追加 TD-026，第一轮评审修订追加 TD-024、TD-025）；`docs/product/vertical-path.md`（§2.1 第 4、5 行、e2e 简称表与观察基线，第一轮评审修订增补）；`docs/adr/ADR-0009-harness-plugin-installable-artifact.md`（Consequences 就地订正，第一轮评审修订增补） |
| 能力 key 纯值叶子链（Batch 3 增补，见 Decision Log） | `packages/capabilities/package.json`；`packages/capabilities/src/capability-keys.ts`（仅 AccessLevel 改从 domain 的 values 出口取）；`packages/controller/package.json`；`packages/controller/src/keys.ts`（新建）；`packages/client/package.json`；`packages/client/src/keys.ts`（新建） |

每PR code实际增删≤800、docs≤1300，含tests/fixtures，排除锁文件/生成目录。
预算区间：Core约55–85；controller约110–150；client约120–165；ui-model约45–70；测试/fixture约180–250；代码总计约510–720。文档约330–420行。
到code约650时盘点剩余fixture与协议调用者；预计超800先停增写/重划闭环，不能提交只有producer而没有consumer的半功能。
不引新层级边、Provider调用或依赖；ui-model不importcontroller/capabilities；client不importui-model/React。
不改Storage sync签名、schema、数据迁移、旧协议兼容；pre-MMP直接换最终types/fixtures，无双读写。
不做generation/并发poll仲裁、迟到baseline过滤；#218仍独立开放，#199的错误healthy producer也不被本项修复。
不改React页面、真实Host/plugin、凭据、账号、CI和规划状态；Status/blocking无人点名批准不得写。
技术债引用现有 `docs/exec-plan/tech-debt-tracker.md`；本轮未实现不新增实现债，后续新债先核已有issue归属。

## Plan of Work

### Batch 0 · 两独立方案与最终协议（已完成）

最小闭环：六字段所有权、same-revision事件、时间与partial边界可审阅；主文件是本计划与 `docs/README.md`。
reviewer独立确认watch吞source变化、store缺整表source、view的blanket-stale，选择row-source-only完整carrier和唯一接受点。
索引只紧跟ui-model-presentation增加本项；设计通过后保持Active与draft，产品全部pending。

在本分支工作树根目录运行：

    node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js
    git diff --check
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main

期望文档/披露/规模门通过；另运行已安装技能 `lint_execplan.py` 与实际docs路径扫描；不存在rule-checks doclinks，不伪造工具面。
回滚点是Batch0干净工作树，仅本轮两文档文件可撤销，不触碰其他会话内容。

### Batch 1 · 真实producer与完整来源事件（已完成）

最小闭环：controller真实基线包含全部头，same-revision metadata能观察降级/恢复；主文件为 `packages/core/src/queries.ts`、`packages/controller/src/queries.ts`、`packages/controller/src/wire.ts`、`packages/controller/src/watch.ts`。
先以actual composeCore/controller写红例：基线fresh revision N，Provider Offline后baseline仍N/degraded而watch不得idle；恢复source时仍能传播。
实现Core workspace metadata query与unavailableCore分支，按路由生产唯一key快照；更新Wire头/delta/metadata和全部必要fixture。
同revision业务字段不变检查与metadata规范化比较必须可测；未知id/重复id/额外业务字段不是合法metadata。

本分支工作树根目录运行（新e2e创建后）：

    pnpm install --frozen-lockfile
    pnpm run typecheck
    node --test tests/e2e/controller-roundtrip.test.js tests/e2e/workspace-read-assembly.test.js

期望真实descriptor/能力/source全到Wire，same-revision发metadata且revision未advance；完全相同poll idle，备用能力不覆盖主目标。
回滚点Batch0文档提交；publicWire与对应fixture一起回退，不留两种DTO兼容路径。

### Batch 2 · Client唯一接受点、assembler与断网（已完成）

最小闭环：Wire头与每行source原子成为WorkspaceRead，断网保值保time；主文件为 `packages/client/src/sync.ts`、`packages/client/src/store.ts`、`packages/client/src/workspace-read.ts`（将新建）、`tests/e2e/workspace-read-assembly.test.js`（将新建）。
测试注入固定clock，先写首次fresh/真实空表/degraded空表/partial、poll拒绝/reconnect拒绝、idle与纯能力metadata时间不推进的红例。
实现store整体预检后metadata就地应用、sync唯一commit点与read/disconnect；失败清connected/markstale但保留对象引用、内容和原timestamp。
clock合法性/store拒绝测试断言头和time完全不先推进；metadata未知实体/不匹配revision不能部分污染已接受值。
本批按顺序化连接/轮询/重连验证；不实现 #218 的代际竞争修复，不宣称所有并发场景正确。

在本分支工作树根目录运行：

    node --test tests/e2e/client-sync.test.js tests/e2e/workspace-read-assembly.test.js
    pnpm run typecheck

期望六字段全部真实生产；断网connected=false、旧store/time保持；same-revision行和整表来源同时更新，fresh→degraded→fresh可达。
回滚点Batch1 verified提交；Client新accept/read与相关store改动整体回退，不只回退头而留下time推进。

### Batch 3 · ui-model单真源与partial验收（已完成）

最小闭环：assembler可直接交展示，partial行不被整表原因洗成stale；主文件为 `packages/ui-model/src/types.ts`、`packages/ui-model/src/capability-access.ts`、`packages/ui-model/src/work-item-list-view.ts`、`tests/contract/ui-work-item-list-view.test.js`。
WorkspaceRead alias为client类型；key与intersect经两层显式出口传递，reduce每步用 `intersectAccess(acc, level, AccessLevel.Available)`（初值Available）复用现有三参数函数，保留read_only读门转换/64格差分。
view删除read.reason造成的blanket row-stale；失败/断网/refreshing仍全stale，source缺口只降级表；redacted与明确读门阻断保持。
端到端case经sync.read到derive/view，禁止最终WorkspaceRead手写fixture冒充生产证据。

在本分支工作树根目录运行：

    node --test tests/e2e/workspace-read-assembly.test.js tests/e2e/client-sync.test.js tests/e2e/controller-roundtrip.test.js tests/contract/ui-model-presentation.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-browser.test.js
    pnpm run typecheck
    pnpm run boundaries
    rg -n "'(planning|development|delivery|execution|storage)\.[^']+'" packages/ui-model/src
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    git diff --numstat origin/main...HEAD

期望测试全绿、新生产链用例非零、key扫描无命中(exit1)、边界通过、用户800/1300更窄上限真实重算。
负对照禁metadata/丢snapshot.source/先time后store/断网不clear connected/恢复view blanket stale，分别对应行为红；恢复后绿，不能以全拒绝骗正控。
回滚点Batch2已验证提交；必要时全PR的Wire producer/client consumer/alias一起回退，不保半协议。

### Concrete Steps

每批对齐→隔离→实现→窄验证→记录→整理提交→汇报；同架构单元一个owner，调研/非共享区可并行。
realpath核目标工作树；Git用argv/library；实施前盘点WireSnapshot/WireDelta fixture调用者，只把必要调用者列入已核文件集，超集合先修计划。
本项与#189独立main，公开controller/client签名不需要新的Storage cursor API；共享binding多workspace联合验收在两者落地后执行，不写人为blocking。
最终push前整理debug/fixup与提交序列，核五类敏感信息、真实diff/size；本轮仅draft，产品门后才可能ready。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| 六字段有真实producer | composeCore/controller/transport/sync.read到derive，最终输入无手写 |
| 完整空集是确认成功 | source fresh、empty、时间来自注入clock |
| degraded空集不是正常空态 | source/reason保留，cold成功时间undefined |
| 同revision降级/恢复可达 | metadata改变头与每行source，business revision/content不变 |
| idle和纯capability变化不刷新时间 | 没有确认当前数据的帧不推进timestamp |
| partial仍有fresh行 | 表degraded/reason，已确认行fresh，未确认行stale |
| 断网与重连失败 | disconnected、Stable StoredEntity引用/内容/time保留 |
| metadata不越权 | 业务shape变化/未知或重复id/revision不匹配fail closed、零partial mutation |
| 单一接受点 | clock非法/store拒绝时头/能力/time/store修订均保持旧值、行不被半更新；clock非法载体带一条改过标题的upsert |
| 权限/三态安全 | unavailable/unknown不显示未授权cache，redacted不回退标题身份 |
| redacted跟随工作区级新鲜度（#178评论的决策E） | 同revision降级/恢复用例经deriveWorkItemList点名Fake唯一的redacted条目：降级stale、恢复fresh |
| 能力真源 | 主/备用路由正确、64格差分、key字面量零命中、boundaries绿 |
| 回归与预算 | 旧controller/client/ui tests通过，实际diff≤800/1300 |

### Artifacts and Notes

基线生产链探针看到controller baseline degraded/revision N，但sync.poll idle且connected true、旧行current；此反例必须在持续连接状态修复。
已有27个client/ui-model测试绿色不包含完整assembler与same-revision来源通道；不把旧通过数当新增闭环证明。
下列关联读取在本分支工作树根目录执行，PR创建后通过branch找到编号，计划不手抄关闭引用。

    gh pr list -R SingularityKChen/harness-projects --head feature/workspace-read-assembly --state open --json number,isDraft,baseRefName,headRefOid,closingIssuesReferences
    gh api graphql -f owner=SingularityKChen -f repo=harness-projects -F number=178 -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){state closedByPullRequestsReferences(first:100){nodes{number isDraft state baseRefName headRefName}}}}}'

期望唯一draft/base main、最终head匹配，PR与issue双向关闭引用可证，issue开放；解析失败先修PR正文回读，不以关键字自己宣布权威关联。

验收证据（Opus 验收者，观察时刻 2026-10-03 23:05 CST，`.worktrees/workspace-read-assembly`；代码树为提交 `0f8b0cc`，其后只有文档提交）：

    pnpm install --frozen-lockfile        # 已是最新
    pnpm verify                           # 1106 + 7 通过，exit 0
    node --test <Batch 3 命令的 7 个测试文件>  # 74/74；新 e2e 17 例（两条 partial 用例合一）
    pnpm run boundaries                   # 8/8
    rg -n "<Batch 3 的 key 字面量扫描>" packages/ui-model/src   # 无命中，exit 1
    node scripts/workflow-check.mjs       # no findings
    node scripts/rule-checks.mjs disclosure origin/main         # 无命中；人工五类目复核无命中
    node scripts/rule-checks.mjs size origin/main               # 观察时刻：code 791、docs 418（用户上限 800 / 1300）
    git diff --check origin/main...HEAD   # 无输出

负对照在一次性克隆（`git clone --no-checkout` 后检出最终代码树并离线安装）上整表复跑：Batch 1 的 4 处、Batch 2 的 7 处、
Batch 3 的 3 处非重复项（另 3 处与 Batch 2 同变异）、fix round 1 的 15 处外加签名忽略 workspace / 能力两处、验收新增 5 处，
共 36 处；每处先打印变异后的行证明已生效，36/36 红且各命中预期用例，恢复后 `git status` 干净。验收新增的 5 处：

| 变异 | 命中的测试 | 结果 |
|---|---|---|
| `assertFrame` 不校验逐行 source | 接受点（增量后序实体缺 source） | 红 |
| `assertFrame` 不校验 `removed` 形状 | 接受点（增量 removed 不是数组） | 红 |
| 恢复 `frame.workspace ?? head?.workspace` | 时间与头（头整帧替换） | 红 |
| `client/keys` 导出 `CapabilityKey` 副本 | 单真源 | 红 |
| Core 报告 `storage.*` key | producer（storage 域不伪造挂载） | 红 |

## Progress

- [x] (2026-10-03 21:34 CST) Batch0：两独立方案、第三方关键路径审查、最终protocol/预算/恢复收敛。
- [x] (2026-10-03 21:34 CST) 独立spec审查pass：补row.source完整carrier、同接受点、时间边界、partial view纠正与#218隔离。
- [x] (2026-10-03 21:52 CST) reviewer实跑 lint_execplan.py：OK；另核13章固定顺序、docs引用/索引存在性及相对路径，均pass。
- [x] (2026-10-03 21:56 CST) Batch 0 文档门：linter通过，文档契约9/9、计划与索引路径、暂存区披露/体量和空白检查通过；产品验收未执行。
- [x] (2026-10-03 22:23 CST) Batch1：真实producer、Wire头与metadata。红：`node --test tests/e2e/workspace-read-assembly.test.js` 5例全红（`snapshot.workspace` 为 undefined、same-revision poll 返回 undefined 而非 metadata）；绿：该文件5/5、`controller-roundtrip` 与 `ui-model-presentation` 通过，`pnpm run typecheck` 与 `pnpm verify`（1094+7）退出0；负对照4/4（见下表）；code 227/800。
  负对照（WIP提交后逐个应用，`grep -n` 回读已生效，恢复后复绿）：

  | 变异 | 命中的测试 | 结果 |
  |---|---|---|
  | watch 同revision恒返回 undefined（不发 metadata） | 来源降级与恢复；规范化比较 | 红 |
  | 能力改为 flatMap 全部挂载后取最后一个 | 唯一挂载不被备用覆盖 | 红 |
  | 去掉业务签名比较 | 业务变化 fail closed 为 gap | 红 |
  | 签名不按 key 排序能力 | 能力顺序不同仍 idle | 红 |
- [x] (2026-10-03 22:26 CST) Batch2：client接受点、assembler、断网/time。红：新增7例中6例报 `sync.read is not a function`、metadata 两例报 `gap`≠`metadata`（旧行为：重拉基线）；绿：`node --test tests/e2e/client-sync.test.js tests/e2e/workspace-read-assembly.test.js` 17/17、`pnpm run typecheck`、`pnpm verify`（1101+7）退出0；负对照7/7；code 572/800。
  负对照（WIP提交后逐个应用，`grep -n` 回读已生效，恢复后复绿）：

  | 变异 | 命中的测试 | 结果 |
  |---|---|---|
  | metadata 事件不被接受（抛错） | 同revision降级/恢复；idle与纯能力不推进时间 | 红 |
  | store.applyMetadata 不校验实体覆盖（缺失/未知/重复） | 接受点 | 红 |
  | 先写 lastUpdatedAt 再 apply | 接受点（fresh 重复增量） | 红 |
  | 传输失败不清 connected | 断网 | 红 |
  | metadata 恒推进时间 | 同revision降级/恢复；idle与纯能力不推进时间 | 红 |
  | read 忽略整表 source.degraded | 空表；partial；同revision降级/恢复 | 红 |
  | 先发布头后 apply | 接受点（头不被半发布） | 红 |
- [x] (2026-10-03 22:30 CST) Batch3：ui-model单真源与partial验收（本地部分；远端产品门/ready 属后续整合与评审）。红：partial 端到端与 view 契约 2 例因 `read.reason` 洗成整页 stale 而红（`已确认的行不被整表原因洗成 stale`）；绿：计划命令 7 个测试文件 72/72、`pnpm run typecheck`、`pnpm run boundaries` 8/8、`rg` key 扫描 exit 1、`pnpm verify`（1104+7）与 `node scripts/workflow-check.mjs` 退出0；code 720/800、docs 见 size 门。
  负对照（WIP提交后逐个应用，`grep -n` 回读已生效，恢复后复绿）：

  | 变异 | 命中的测试 | 结果 |
  |---|---|---|
  | view 恢复 `read.reason` 整页 stale | 端到端 partial；view 行新鲜度契约 | 红 |
  | 四态求交折叠成恒返回 level | 4×4×4 差分等 5 例 | 红 |
  | 禁 metadata | 同revision降级/恢复；idle与纯能力；经 view 的降级 | 红 |
  | 丢整表 source 降级 | 空表；partial；同revision降级/恢复；端到端 partial | 红 |
  | 先写 time 后 apply | 接受点 | 红 |
  | 传输失败不清 connected | 断网；端到端断网 | 红 |
- [x] (2026-10-03 22:44 CST) Fix round 1（对抗验证 353ce3a：0 P0 / 0 P1 / 5 P2）：P2-1…P2-5 全部属实，生产行为正确但无测试锁定。复现：旧测试文件下 15 处变异（B1 B2 B5 C9 C8 A4 A7 A2 C6 C7 B9 B10 C1 C2 C4）全部存活；绿：新增/收紧用例后 `tests/e2e/workspace-read-assembly.test.js` 18/18，同批 7 个测试文件 75/75，`pnpm run typecheck`、`pnpm run boundaries` 8/8 退出0，15 处变异全部红且各命中预期用例；code 799/800（为入预算把新旧用例合并，不删判别用例）、docs 见 size 门。
- [x] (2026-10-03 23:05 CST) 验收（Opus）：独立复核 `origin/main...HEAD` 与 12 行验收表，处置 P3-1…P3-4。红：新增两条接受点载体（增量后序实体缺 source、removed 非数组）与“头整帧替换”断言在旧代码上红（前序行已被写、read 仍返回旧 descriptor）；绿：`assertFrame` 预检逐行来源与删除表、头整帧替换后同批 7 个测试文件 74/74，`pnpm verify`（1106+7）、`pnpm run boundaries` 8/8、key 扫描 exit 1、workflow-check、disclosure、`git diff --check` 全过；最终代码树 36 处负对照 36/36 红；code 791/800、docs 418/1300。提交整理为 5 个（3 个 feature 原样保留，fix round 测试 + 验收修复 1 个，文档 1 个），`comm` 比对整理前后的文件集合：多出 `docs/exec-plan/tech-debt-tracker.md`（TD-026），少了 `packages/controller/src/index.ts`（删去根出口重导出后相对 main 零改动），两处都是验收的有意改动。
- [x] (2026-10-04) 第一轮 MVP 评审修订（评审对象 head `2f0e4cc`：0 P0 / 0 P1 / 0 P2 / 11 P3，已 APPROVE）：逐条核实意见属实，处置见 Decision Log 2026-10-04 各条。代码改动只有测试与注释：e2e「接受点」的「clock 非法」载体带改过标题的 upsert 并比对 store 修订，「同 revision 降级 / 恢复」点名 redacted 条目；`ClientWorkspaceRead` 与 `derive.ts` 的 `lastUpdatedAt` / `reason` 契约注释改成真实取值。文档：TD-024、TD-025、ADR-0009 订正、vertical-path 第 4、5 行与观察基线、本计划原处 Superseded 与回读规则。变异（每处先打印变异行，再 `git checkout --` 还原并复绿）：C4（`readClock` 移到 `apply()` 之后）在 Batch 3 的 7 个测试文件上 74 条中 1 条红；M9a / M9b（store 对 redacted 行保留旧 stale / 恒 stale）在本 e2e 文件上 1 / 2 条红，命名用例里首个失败的都是新断言。在检出 `feature/workspace-read-assembly` 的工作树根目录、归档提交之前的代码树上：`pnpm verify` exit 0（1106/1106，mvp0 7/7）、`pnpm run boundaries` 8/8、`node scripts/workflow-check.mjs` no findings、key 字面量扫描 exit 1、vertical-path 七个新前缀各 `ℹ tests 1` 与伪造前缀 `ℹ tests 0`；归档后的 size、disclosure、`git diff --check` 与文档契约见 Bottom Change Note 同日条目（观察值，按 `node scripts/rule-checks.mjs size origin/main` 重算）。
- [x] (2026-10-04) 修订的独立复评（只读，评审对象为本地整理后的提交）：第一轮 19 + 1 条意见按原判据复核，18 条修好；`lastUpdatedAt` 注释漏写 metadata 帧只在 degraded→fresh 恢复时推进，另有文件集表述与契约测试头注释两处措辞残留，共 3 条 P3，均已在本轮按原处修正（`packages/client/src/workspace-read.ts`、`tests/contract/ui-model-presentation.test.js`、本计划第 363 / 375 行 Decision 的 Superseded 标注与 TD-026 延期理由）；复评复跑变异 C4、M9a、M9b 均红，e2e 文件连跑 30 次无失败。
- [ ] 合并后回读 issue：`gh issue view 178 -R SingularityKChen/harness-projects --json state,closedByPullRequestsReferences`（期望：`CLOSED`，`closedByPullRequestsReferences` 含本 PR）。
- [ ] 合并后在包含 #178 的 main 上按 `docs/product/vertical-path.md` §2.1 的回读命令重跑第 4、5 行的七个 workspace-read-assembly 前缀（期望：各一行 ✔、`ℹ tests 1`、`ℹ fail 0`，伪造前缀 `ℹ tests 0`），并在该 main 上运行 `pnpm verify`（期望：exit 0，mvp0 7/7）。
- [ ] 外部写入回读：#218、#199、#229 各有一条本轮评审的承接评论（由主控发出；`gh issue view <n> -R SingularityKChen/harness-projects --comments`，期望各见一条），TD-024 的承接 issue 由人类决定并在该行「下一步」列回填。

## Surprises & Discoveries

watch的same-revision分支吞掉source变化；只补assembler仍会把持续连接旧行显示current，必须有metadata通道。
纯header metadata仍漏行freshness；完整row-source清单和view的read.reason规则一起调整，才能保留partial已确认行。
Batch 1 发现：`registry` 只挂外部四域，storage 域没有挂载目标；按“无目标即unavailable”会对本地Storage说错，故 `getWorkspaceMetadata` 不报告 storage.* key（消费者对缺失 key 本就按 unavailable）。
离线替身的执行备用不声明 `execution.run.fallback`，唯一挂载用例改以 `execution.run.cancel`（主不声明、备用声明）判别。
`ui-model-presentation` 的字段面机械同形测试按 `interface X {` 解析，遇到 `extends WireWorkspaceHeader` 会找不到；解析器已跟随 extends 递归（测试侧改动）。
Batch 1 为让 client 在同一提交内编译，sync 暂把 metadata 事件当缺口重拉基线（保守且正确）；Batch 2 换成精确的 metadata 接受点。
Batch 2 发现：真实空项目必须显式传 `workspace.project`（bootstrap 靠条目观察发现项目，零条目时 `not_found`）；空表用例据此构造。
store 的修订/来源头校验会拒绝 `source.revision !== revision` 的帧；既有 fixture 本就满足，无需改。
Batch 3 发现：浏览器完整路径契约（`ui-work-item-list-browser`）只允许 domain/ui-model/ui 三个包进 bundle；ui-model 从 client 根出口取 `CapabilityKey`（运行时值）会把 controller → core 一路拖进来（`node:crypto` 不可解析）。计划里“经 client re-export”的方向对，但出口必须是纯值叶子，与 `domain/values` 同模式。
view 里“`read.reason` 存在就把所有行 stale”还被一例旧契约钉着（宿主降级 → `[[true]]`）；该断言按本计划的 partial 规则改为“只降级整表”，断网另行用 `connected:false` 钉住行 stale。
#199仍可能错误生产healthy，本项忠实传输而不catchStorage producer；#218迟到baseline竞争仍开放，不悄悄加generation算法。
无Storage时descriptor尚未确认；最终read undefined表达冷启动，不制造看似可用workspace。
Fix round 1 发现：全部 5 项 P2 都是“行为对、测试没锁”——旧用例总让整表头与逐行 source 同动、整表与各行同时恢复，任何一半退化都不会变红；`revision 不匹配` 例被 `assertFrame` 先拒绝，从没走到 store 自己的 `metadata.revision` 守卫，需要“自洽的 revision+1”载体才触达；`assert.ok(transport.close)` 只证明函数存在。
验收发现：P3-1 的根因比报告宽——store 写入阶段读的是逐行 `source` 与 delta 的 `removed`，二者任一畸形时前序行都已被写；预检这两处即可让写入阶段不可能中途抛错，metadata 的逐行来源检查也随之并入同一处。
验收发现：controller / client 根出口对能力 key 叶子的 `export *` 没有任何 importer（ui-model 只走 `client/keys`），`AcceptedHead` 与 `WireWorkspaceHeader` 同形，测试辅助里 `clock.calls` 与 `shapeOf` 的 stale 列未被使用，两条 partial 用例共享同一组装前缀。
验收发现：`docs/README.md` 索引行仍写“迭代5”，与本计划人类重排期后的“当前调度：迭代 4”矛盾；本计划 Batch 0 标题仍写“（本轮）”。
第一轮评审修订发现：e2e「metadata：整表 fresh 而一行 degraded」按 `store.list()` 的第 0 行构造载体，而实体 id 每次运行随机生成，Fake 的 redacted 条目排在第几行随之变化；所以它对 redacted 相关变异的杀伤是随机的（变异 M9a 在旧测试文件上一次运行 2 条红、新文件上一次运行 1 条红）。确定性的覆盖来自「同 revision 降级 / 恢复」用例，本轮在那里点名 redacted 条目。
第一轮评审修订发现：Core 的 `syncSummary` 在能力门不通过或没有 Planning 绑定时给出的是说明文字，在游标降级时给出的是 `lastErrorCode` 或游标状态这样的错误码；`read().reason` 两种都会原样透出，所以契约注释写成「可能是机器错误码」而不是「总是错误码」。

## Decision Log

Decision：人类已在Project将 #189/#196/#178 规划启动为In Progress，并将 #178 提前到迭代4；保留新的规划。Rationale：2026-10-03人类明确确认该调整；agent只同步PR迭代索引，不代写Status或blocking。Date/Author：2026-10-03 22:08 CST / 人类伙伴。

Decision：选独立metadata事件并带现有row-source完整清单。Rationale：业务revision与来源变化正交，机制上限制业务越权。Date/Author：2026-10-03 21:34 CST / 独立最终reviewer。
Decision：time表示client最后成功接受当前值，connection另存；degraded/失败不推进。Rationale：失败读取缓存不能冒充新确认。Date/Author：2026-10-03 21:34 CST / 独立最终reviewer。
Decision：partial表降级不等于所有行stale，修view小范围消费者。Rationale：#70交接要求仍fresh行，不能只改client留下展示反例。Date/Author：2026-10-03 21:34 CST / 独立最终reviewer。
Decision：不实现#218仲裁，未来拒迟到帧必须整帧拒头/time。Rationale：接口协作保留，同轮不暗中关闭独立竞争缺陷。Date/Author：2026-10-03 21:34 CST / 独立最终reviewer。
Decision：本轮draft/标签/milestone/Project分类/ExecPlan/Batch复制现有Priority/Size/Iteration已授权，Status/blocking未授权。Rationale：工程索引不代替人规划。Date/Author：2026-10-03 21:34 CST / 用户明确范围。

Decision：`getWorkspaceMetadata` 跳过 storage.* key，不报 unavailable。Rationale：registry 只有外部四域挂载，本地 Storage 能力不经路由；报 unavailable 会对正在读取的 Storage 说错，缺失 key 对消费者同为 unavailable。Date/Author：2026-10-03 22:23 CST / Sonnet implementer。
Decision：watch 用“业务签名（实体去 source 后按 id 排序）+ 来源签名（头、能力按 key、逐行 source）”两个规范化签名判定同revision：业务变化→gap，仅来源变化→metadata，全同→idle。Rationale：把“不得借 metadata 改业务”落在比较函数上，而不是靠 store 兜底；签名不含时钟，不会永不 idle。Date/Author：2026-10-03 22:23 CST / Sonnet implementer。
Decision：传输失败与被拒绝的帧（clock 非法、store 拒绝）走同一条 `lose`：connected=false、行 stale，头/能力/时间/内容原样保留，原异常继续抛出。Rationale：被拒绝的帧意味着本地无法确认当前值，保持 connected=true 会让旧行继续显示 current；fail closed。Date/Author：2026-10-03 22:26 CST / Sonnet implementer。
Decision：lastUpdatedAt 的推进规则——baseline/delta：整表 fresh 或帧内有 fresh 行；metadata：仅整表或某行由 degraded 恢复为 fresh。纯能力/名称 metadata 与 idle 不读时钟。Rationale：时间只表示“确认了当前值”，且 clock 只在会推进时读取，非法 clock 不会影响不推进的帧。Date/Author：2026-10-03 22:26 CST / Sonnet implementer。
Decision：`read().reason` 不单独存传输原因：connected=false 即安全散文，connected=true 时取整表 source 降级原因（无原因给中性句）。Rationale：少一份可与 connected 漂移的状态。Date/Author：2026-10-03 22:26 CST / Sonnet implementer。
Decision：ISO 8601 校验在 client 与 ui-model 各一份同口径正则。Rationale：ui-model 不得依赖 client 的运行时校验内部，且 derive.ts 不在本 PR 文件集；记为小重复，不引第二个权威源（口径相同、各自校验自己的边界）。Date/Author：2026-10-03 22:26 CST / Sonnet implementer。（Superseded by Decision Log 2026-10-04「`lastUpdatedAt` 与 `reason` 只改契约注释」（2026-10-04）：评审轮为改 `reason` 契约注释，`derive.ts` 已进入文件集，但只动注释；正则重复的结论不变。）

Decision：能力 key 与求交走“纯值叶子链”：`capabilities/keys`（即 `capability-keys.ts`）→ `controller/keys` → `client/keys`，ui-model 只 import `@harness-projects/client/keys`；controller/client 根出口同时 `export *` 该叶子。Rationale：调研同仓先例 `@harness-projects/domain/values`（根出口经 ids.ts 依赖 node:crypto，故浏览器只走 values 叶子）；备选 (a) 保留字面量加 `satisfies`——违背单一真源与 rg 零命中验收，(b) 把 key 表挪进 domain——capabilities 才是 key 的所有者，(c) ui-model 从 client 根取值——浏览器 bundle 契约失败。采用 (d) 叶子链：每一跳显式、边界测试不变，代价是 6 个文件（4 个 manifest/出口 + 2 个新建 2 行文件）增补进文件集。Date/Author：2026-10-03 22:30 CST / Sonnet implementer。其中「controller/client 根出口同时 `export *` 该叶子」一句 Superseded by 本节 2026-10-03 23:05 CST「取代 22:30 叶子链裁决」条目（2026-10-04）；叶子链本身不变，透传规则另见 `docs/adr/ADR-0009-harness-plugin-installable-artifact.md` Consequences 的 2026-10-04 订正。
Decision：list view 的 `degradedPage` 去掉 `read.reason`；整表来源缺口只降级整表（`body.stale`/statusText），行 stale 只来自行自身新鲜度（含断网、从未读到）、refreshing、读门 degraded、failed 保行。Rationale：#70 交接要求已确认行保持 fresh；断网时 `connected:false` 已让 `isStale` 为真，不依赖 reason。Date/Author：2026-10-03 22:30 CST / Sonnet implementer。
Decision：`ClientWorkspaceRead` 保持 `capabilities?`/`lastUpdatedAt?`/`reason?` 可选，`WorkspaceRead` 为其别名；assembler 恒填。Rationale：与既有展示契约语义（省略=未观测/从未读到）一致，不制造第二种“未知”表示。Date/Author：2026-10-03 22:30 CST / Sonnet implementer。

Decision：fix round 1 的 P2-1…P2-5 全部采纳，只补/收紧测试，不改生产代码（探针与变异证明行为正确）；为守住 code ≤800 把“只有一行/整表变化”并入既有 watch 变体用例、把 reconnect 预 stale/reason 优先级/disconnect 关闭传输并成一个生命周期用例。Rationale：保留每处判别，少一份 compose/client 样板。Date/Author：2026-10-03 22:44 CST / Sonnet 实施者。
Decision：P3-1（baseline/delta 中途畸形实体留下已改前序行）暂不改：规格只要求 head/revision 预校验，传输失败路径会把行全标 stale 且下一次基线整体覆盖；若要“全有或全无”需给 store 加事务写入，超出本项规模，留待验收者或后续 issue 裁决。P3-2（`frame.workspace ?? head.workspace`）保留：已确认的 descriptor 不因后续无 descriptor 的帧而退回“未确认”，行为未被规格约束也未加测试（预算已满），记为已知未锁定点。P3-4 的 ISO 正则重复已在上文裁决；提交 trailer 按调度指令保持原写法。Date/Author：2026-10-03 22:44 CST / Sonnet 实施者。P3-1 的「暂不改」与 P3-2 的「保留」Superseded by 本节 2026-10-03 23:05 CST 的两条「取代 22:44」条目（2026-10-04）：两处均已按根因修复并加判别断言。

Decision：（取代 22:44 对 P3-1 的“暂不改”）P3-1 按根因修复——`assertFrame` 在任何条目变更前同时校验逐行 `source` 与 delta 的 `removed` 形状，写入阶段只读已校验字段，被拒绝的帧不再留下已写的前序行；两条新载体进接受点用例。Rationale：规格“拒绝帧不推进…失败不留半更新”“同一接受单元”对 baseline/delta 同样成立；同类惯例是 Redux 式 reducer 抛错时不提交新状态，本 store 为保稳定引用而就地写，只能靠写前全量预检达到同等原子性；净增约 0 行（metadata 的逐行 `isSource` 并入同一处）。Cost if wrong：若将来写入阶段新增读取未校验的字段，原子性会无声退化；负对照 A-1/A-2 只锁住现有两处。Date/Author：2026-10-03 23:05 CST / Opus acceptor。
Decision：（取代 22:44 对 P3-2 的“保留”）P3-2 去掉 `frame.workspace ?? head?.workspace`，头随被接受的帧整体替换；宿主在已接受的帧里不再确认 descriptor 时 `read()` 回到 undefined，并加判别断言。Rationale：规格“公开读取只在同步方法完成后可见同一接受单元”，跨帧拼头会让旧 descriptor 与新能力/来源混成一个从未被宿主同时确认的头（不变量 7）；调研 TanStack Query、Apollo Client、RTK Query：成功响应整体替换数据，last-known 只在失败时保留——本实现的 `lose` 正是失败保值；现生产者在同一 controller 内不会从有 descriptor 退回无 descriptor（`unavailableCore` 在组装时即固定），所以无已知用户可见变化。Cost if wrong：若将来宿主会短暂丢失 descriptor，页面在下一帧之前回到冷启动形态而不是显示旧名字；下一帧带回 descriptor 即恢复。Date/Author：2026-10-03 23:05 CST / Opus acceptor。
Decision：P3-3 全部刷新——状态行、Batch 0 标题、Artifacts 验收证据、Outcomes、Next gate 与 `docs/README.md` 索引行（同时把“迭代5”改为人类重排期后的“迭代4”）。Rationale：同一事实只能有一个当前答案。Cost if wrong：读者按旧状态判断进度。Date/Author：2026-10-03 23:05 CST / Opus acceptor。
Decision：P3-4 的 ISO 8601 正则重复保留并登记 TD-026；提交 trailer 不追改 feature 提交。Rationale：两处各守自己的边界且逐字相同，抽共享出口需改不在文件集的 `derive.ts` 并新增叶子出口；trailer 是本会话 harness 规定的归属行，整理后的 fix/docs 提交由 Opus 验收者写成，实施者身份以本计划 Progress 与 Decision Log 的 Author 为准。Cost if wrong：只改一处口径时两层对同一时间给出不同结论（响亮失败而非静默），见 TD-026。Date/Author：2026-10-03 23:05 CST / Opus acceptor。（Superseded by Decision Log 2026-10-04「`lastUpdatedAt` 与 `reason` 只改契约注释」（2026-10-04）：评审轮为改 `reason` 契约注释，`derive.ts` 已进入文件集，但只动注释；正则重复的结论不变。）
Decision：取代 22:30 叶子链裁决中“controller/client 根出口同时 `export *` 该叶子”一句：根出口重导出无 importer，删去；单真源用例改为直接断言 ui-model 实际所走的 `client/keys` 叶子与 capabilities 是同一对象。Rationale：少一份公开面，测试对象与生产路径一致；叶子链本身不变。Cost if wrong：将来 client 根的消费者需要 key 时改从 `client/keys` 取，一行 import。Date/Author：2026-10-03 23:05 CST / Opus acceptor。
Decision：简化只删不加——删 `AcceptedHead`（与 `WireWorkspaceHeader` 同形）、测试里未用的 `clock.calls` 与 `shapeOf` stale 列，把两条 partial 用例合一。Rationale：无判别力损失（B2-6、B3-1、B3-3 仍命中合并后的 partial 用例）；code 从 799 降到 791（另有 watch 头注释补 metadata 语义 +3）。Cost if wrong：无行为影响。Date/Author：2026-10-03 23:05 CST / Opus acceptor。
Decision：提交整理保留 `b2f3a9d`、`e2ad13f`、`353ce3a` 三个 feature 提交原样（各自批次已验证、内容按能力分层），把 fix round 1 的测试提交与验收修复合成一个 `fix(client)` 提交，把 fix round 1 的文档提交与验收文档合成一个 `docs(exec-plan)` 提交；不改写 `8b194a1` 及更早。Rationale：fix round 测试横跨三层且与验收修复改同一文件，拆回各 feature 提交需逐 hunk 改写且冲突风险高，收益只是历史外观。Cost if wrong：评审者在第 3 与第 4 个提交间看到根出口重导出先加后删。Date/Author：2026-10-03 23:05 CST / Opus acceptor。
Decision：同修订恢复用例的游标改写带上 `workspaceId`。Rationale：集成主控在临时克隆按 #264→#265→#266 合并三分支，代码文件全部自动合并，但并集 `pnpm verify` 1126/1129：#264 把游标改为工作区三元键后，本 PR 的 JS 测试辅助缺 `workspaceId`，typecheck 看不到，Fake 在运行时拒绝。现在就带上该键，在 main 上 Fake 原样忽略多余字段（本 PR 单独 17/17），在并集上定位到同一条游标，两种合并顺序都不需要再改本文件。Cost if wrong：#264 被放弃时测试里留一个无用字段。Date/Author：2026-10-03 23:09 CST / Opus 集成主控。

Decision：单帧撕裂读——不改代码，登记 TD-024 并交人类决定承接。事实（评审在 base `68524a0`、head `2f0e4cc` 与三 PR 并集上同一脚本复现，本轮读代码核实）：controller `queries.snapshot()` 先经 `listPlanningItems()` 内的 `syncSummary` 定逐行 freshness，再经 `getPlanningSync()` 定整表 `source`，一次基线读两次游标；失败的 bootstrap 落在两次读之间时帧为「整表 degraded + 全部行 fresh」，与 partial 同形，`confirms()` 判为确认。Rationale：时间只在撕裂帧推进一次、多算不超过一次基线读取窗口，行在下一次 poll 前显示为当前值，base 上更重；根因是 main 既有的两次读，修复要改 Core 查询面（一次查询同时返回 views 与 summary），超出本 PR 文件集与代码预算。原 Design 第 47 行把它归给 #218 不对，已在原处标 Superseded；给 #218 的评论草稿说明缺口不在其范围、请人类决定并入或新开。Cost if wrong：撕裂窗口内页面把一次失败读显示成确认，直到下一次 poll。Date/Author：2026-10-04 / 第一轮评审修订（主控授权）。
Decision：`lastUpdatedAt` 与 `reason` 只改契约注释，不改行为。`ClientWorkspaceRead.lastUpdatedAt` 写明是 client 接受「宿主判定为当前值」的帧的时刻、真伪跟随宿主 freshness、idle 不推进而 reconnect / gap 重拉基线会推进；`reason` 写明断网与「降级无原因」是 client 安全散文，来源降级时原样是宿主值、可能是 `unavailable` / `permission_denied` 这类错误码，翻译归页面层（#229）；`packages/ui-model/src/derive.ts` 的同义注释一并订正（因此进文件集）。Rationale：Host 没有「最后成功同步时间」事实，client 自记接受时刻是 #178 Scope 授权的、不构成第二权威源；错误码映射是页面文案，行级 reason 在 main 上已是错误码，本 PR 只把它扩到工作区级，登记 TD-025。给 #199 的评论草稿要求修复后验收「冷启动或后续裸异常之后 client 的 lastUpdatedAt 不推进」。Cost if wrong：页面直接显示 reason 时出现英文错误码（不泄漏原异常）。Date/Author：2026-10-04 / 第一轮评审修订（主控授权）。
Decision：「先读时钟再改 store」补判别用例，W1 只记录。e2e「接受点」用例的「clock 非法」载体改为带一条改过标题的 upsert，并比对 `store.revision` 与行 entity；变异 C4（把 `const at = confirmed ? readClock(clock) : undefined` 移到 `apply()` 之后）先打印变异行，再跑 Batch 3 的 7 个测试文件：74 条里 1 条红（接受点，命中消息「clock 非法…：头 / 能力 / 时间 / store 修订不变」），还原后 17/17。W1（`sourceSignature` 去掉能力的 reason 只留 key / access）不加用例：registry 在 Core 生命周期内是静态的，能力 reason 在同一 controller 内不会单独变化，生产上不可达。Rationale：规格写了「clock 读取并校验在任何 store mutation 之前」，旧载体是空 upsert，变异存活。Cost if wrong：将来 registry 变成可热更新时，只有能力 reason 变化的同修订帧会被判 idle，需要补 W1 用例。Date/Author：2026-10-04 / 第一轮评审修订（主控授权）。
Decision：partial 时整表文案与行新鲜度的矛盾交给 #229，不改代码与断言。事实：去掉 `read.reason` 的整页 stale 后，partial 读取得到 `body.stale=true` 而全部可见行 fresh，statusText 仍是「当前结果尚未确认，最后已知值不是当前值」；整体失败、冷启动无时间、断网三种输入下行仍全部 stale，没有把全量失败显示成 fresh。Rationale：页面级新鲜度与状态行的口径是 #129 决策 D（只覆盖可见行）的落点，归 #229 的页面层验收；本 PR 改文案会抢先定页面口径。给 #229 的评论草稿建议 partial 单独文案并放宽 e2e「partial：…」用例里 `/尚未确认/` 的断言。Cost if wrong：#229 之前，partial 状态行与 fresh 行同屏矛盾。Date/Author：2026-10-04 / 第一轮评审修订（主控授权）。
Decision：`disconnect()` 不是代际边界——不改代码，交 #218。事实（评审 probe8，head 与并集一致）：降级后发起 `sync.poll()` 随即 `disconnect()`，在途 poll 晚到返回 metadata 时 `connected` 被翻回 true。另一方面，本 PR 已实现 #218 Scope 第 3 点与 Acceptance 第 3 条（reconnect 开始即标 stale、reconnect 失败保留最后已知值并标 stale；e2e「连接生命周期」「断网」用例）。Rationale：在途帧的取舍需要 #218 的连接代际，单独在 disconnect 里丢帧会与代际方案重复；给 #218 的评论草稿回写已交付部分并建议命名用例「disconnect 后在途帧不得恢复 connected」，PR 描述「不包含 #218」改为「部分交付 #218（第 3 条）」。Cost if wrong：#218 之前，disconnect 后晚到的宿主帧会让连接显示恢复（帧本身来自 Host，不是乐观显示）。Date/Author：2026-10-04 / 第一轮评审修订（主控授权）。
Decision：#178 评论要求的 redacted 用例在 e2e「metadata：同 revision 降级 / 恢复」里点名。经 `deriveWorkItemList` 过滤 `contentKind === 'redacted'`（Fake 默认种子唯一的 `issue-3`），断言降级时 `[true]`、恢复后 `[false]`。变异 M9a（`store.applyMetadata` 对 redacted 行保留旧 `stale`）与 M9b（对 redacted 行恒 `stale`）各先打印变异行再跑本文件：M9a 1 条红、M9b 2 条红，命名用例里首个失败的都是新断言（另一条红是「metadata：整表 fresh 而一行 degraded」，它是否命中取决于 redacted 是否排在第 0 行，见 Surprises）；还原后 17/17。如实说明：旧文件的 `every(stale)` / `some(stale)` 本来也会杀死这两个变异（M9a 在旧文件上同样红），新断言的价值是点名与经 ui-model 派生面断言，而不是新增杀伤力。Rationale：决策 E 要求 redacted 跟随工作区级同步状态，#229 验收可直接引用这条用例。Cost if wrong：无行为影响。Date/Author：2026-10-04 / 第一轮评审修订（主控授权）。
Decision：文档与索引按规则收尾——ADR-0009 Consequences 就地追加 `client/keys` 叶子链与透传规则的订正；`docs/product/vertical-path.md` §2.1 第 4、5 行写入新 e2e 的经入口证据、承接列去掉 #178（第 4 行补 #229），观察基线追加本次回读（七个前缀各 `ℹ tests 1`，伪造前缀 `ℹ tests 0`）；本计划的状态行与 Next gate 改成回读规则，第 47 行、22:30 与 22:44 的被取代结论原处标 Superseded；`docs/README.md` 的索引行随归档移回 Completed 表。TD-024、TD-025 由主控分配，补上本 PR 与 #264（TD-020–022）、#265（TD-023）之间的编号空缺。Rationale：PLANS.md §4 与 vertical-path §2.1 的同 PR 更新义务。Cost if wrong：无行为影响。Date/Author：2026-10-04 / 第一轮评审修订（主控授权）。

## Idempotence and Recovery

metadata重复内容为idle；重复baseline按现有稳定身份覆盖；时间只在确认接受点更新，不以poll次数增长。
disconnect/异常保留last-known并标stale；后续成功重连从controller baseline恢复，client会话重启从undefined时间重新积累。
无schema/历史数据迁移；whole协议回滚同时恢复producer/consumer/fixture，不能只回滚一端。
外部actor是 `SingularityKChen`，target公开repo `SingularityKChen/harness-projects` 与Project10；逻辑重试键 `178+feature/workspace-read-assembly`。
先读同branch PR/issue Project item再创建或更新；未知结果回读确认，不声称GitHub提供此幂等键，不将draft伪装Engineering PR open。
写trace记录actor/目标/请求/ack/readback；共享历史重写须恢复锚点/专家流程，本轮不合并或清理其他worktree。

## Interfaces and Dependencies

Core只读metadata→controllerWire→clientread→ui-model alias，能力key/intersect沿允许依赖出口传递（`capabilities/keys` → `controller/keys` → `client/keys` 三个纯值叶子，ui-model 只取 `client/keys`）；不新增跨层反向边。
Transport现有baseline/watch消费面保留，WireEvent新增metadata；sync报告kind加metadata，assembler通过sync.read固定store归属。
#189是共享binding健康隔离，#178是六字段生产通道，两者联合验收但无编译前置；不把合并顺序写成blocked-by。
#218未来竞争修复须在唯一接受点拒整帧metadata/time；本项不宣称其旧红例通过。#199/真实Host服务/页面挂载由各自issue承担。
Next gate：人类决定是否合并本 PR（只用 rebase merge）。提交数、是否已 push / ready、远端 head 与 checks 都按 `Artifacts and Notes` 的关联读取命令与 `gh pr checks <n> -R SingularityKChen/harness-projects`（期望：全部 pass）回读，不在此写值；最终 push 前按 AGENTS.md §6 建 backup ref、精确 force-with-lease，合并后的回读见 `Progress` 的未勾选项。

## Outcomes & Retrospective

结果：六字段（workspace / store / connection / lastUpdatedAt / capabilities / reason）都有真实生产者，最小成功证据 `composeCore → createController → createTransport → createSync → sync.read → deriveWorkItemList` 在 e2e 里跑通，最终展示输入无手写。
同 revision 的来源降级与恢复经窄 metadata 事件可达（业务变化 fail closed 为 gap）；断网保行、保头、保时间；真实空集推进时间、degraded 空表不推进；partial 表降级而已确认行保持 fresh；接受点对非法时钟与畸形载体整体拒绝。
验证：`pnpm verify` 1106+7 通过；Batch 3 命令 74/74；boundaries 8/8；最终代码树 36 处负对照全红；code 791/800、docs 418/1300（观察时刻值）。
偏差：文件集增补能力 key 纯值叶子链 6 个文件（浏览器 bundle 契约强制）与技术债 tracker；Batch 1 为保持可编译在 `client/src/sync.ts` 暂把 metadata 当缺口；`controller/src/index.ts` 最终相对 main 零改动。
债务：TD-026（ISO 8601 校验两份同口径正则）。#218（迟到帧 / 并发 poll 仲裁）与 #199（错误 healthy producer）仍开放，本项不宣称修复；真实 Host transport、React 页面挂载与凭据由后续闭环承担。
复盘：对抗验证第 1 轮的 5 项 P2 都是“行为对、测试没锁”，验收又在单一接受点的边界上找到两处语义缺口（畸形帧中途抛错、跨帧拼头）。教训：原子性的预检要按写入阶段实际读取的字段清点，而不是只按规格点名的字段；“整体发布”要连同回退表达式一起审。
第一轮 MVP 评审（2026-10-04）：0 P0 / 0 P1 / 0 P2、11 条 P3，均已处置。改了测试与注释，没有改生产行为；新登记 TD-024（单帧撕裂读，承接待人类定）与 TD-025（reason 错误码映射，归 #229）。#218 / #199 / #229 各得到一条承接评论草稿（disconnect 在途帧、lastUpdatedAt 在 #199 修复前后的验收、partial 文案与错误码映射）；本 PR 实际部分交付了 #218 的第 3 条（reconnect 即标 stale、失败保值）。
偏差（评审轮）：文件集增补 `packages/ui-model/src/derive.ts`（仅注释）、`docs/product/vertical-path.md` 与 ADR-0009；代码体量因新增断言与注释从 792 升到 804（CI 硬上限 1000；比规划弹性上限 800 多 4 行，来自独立复评后补的注释；2026-10-04 在基于 `main@0b1c5dd` 的 head 上按 `node scripts/rule-checks.mjs size origin/main` 重算）。
复盘（评审轮）：两条 P3 都是「规格写了、测试没锁」的同类——「先读时钟再改 store」的载体是空 upsert，redacted 的决策 E 只被 every(stale) 顺带覆盖；另有一条按随机排序行号构造载体的用例，杀伤力随运行而变。教训：负对照表要按规格逐句对照（不仅按实现点），载体要选能让变异产生可见副作用的形状。

## Bottom Change Note

Change Note (2026-10-03 21:34 CST)：独立reviewer收敛两设计，采用窄metadata+完整row-source、单接受点和明确时间，补partial页面消费及#199/#218边界；产品pending。
Change Note (2026-10-03 21:52 CST)：补canonical三参数intersect调用，独立linter和结构/路径检查已通过；全仓文档门由主执行者继续落账。

Change Note (2026-10-03 21:56 CST)：主执行者全文复核并运行文档契约与独立路径/暂存扫描，记录Batch 0文档门；后续产品批次保持pending。

Change Note (2026-10-03 22:08 CST)：记录人类在Project上的规划启动与#178重排期确认；保留原调查调度快照并明确取代，产品实施仍pending。

Change Note (2026-10-03 22:23 CST)：Batch 1 完成：Core 元数据查询、Wire 头/metadata 事件、watch 同revision判定与4项负对照落账；文件集无新增（client/sync.ts 的编译补丁在集合内）。

Change Note (2026-10-03 22:26 CST)：Batch 2 完成：workspace-read.ts、store.applyMetadata 与 sync 唯一接受点/read/disconnect 落地，7项负对照落账；文件集无新增。

Change Note (2026-10-03 22:30 CST)：Batch 3 完成：WorkspaceRead 别名、纯值叶子链单真源、view 去掉整页 stale 规则与端到端 partial 验收落地；文件集增补叶子链 6 个文件（浏览器 bundle 契约强制）；6 项负对照落账。

Change Note (2026-10-03 22:44 CST)：Fix round 1：对抗验证 5 项 P2 全部以判别性测试落实（15 处存活变异全红），生产代码零改动；P3-3 同步修正本计划的 Batch 状态、Next gate、Outcomes 与索引行；P3-1/P3-2 记录为未改的裁决。

Change Note (2026-10-03 23:05 CST)：Opus 验收：独立复核 diff 与验收表，按根因修 P3-1/P3-2 并补判别断言，删无用出口、同形类型与测试辅助，最终代码树 36 处负对照全红；刷新状态、Artifacts、Outcomes、Next gate 与索引行，登记 TD-026，提交整理为 5 个。

Change Note (2026-10-03 23:09 CST)：集成预演发现与 #264 的语义冲突（测试辅助缺工作区键），本 PR 测试辅助对齐后单独与三分支并集均通过；见 Decision Log 同时刻条目。

Change Note (2026-10-04)：第一轮 MVP 评审修订：11 条 P3 逐条核实与处置（Decision Log 2026-10-04 各条），补判别断言与真实契约注释，登记 TD-024 / TD-025，订正 ADR-0009 与 vertical-path 第 4、5 行，状态行与 Next gate 改成回读规则、被取代结论原处标注；随后归档到 `docs/exec-plan/completed/`，`docs/README.md` 索引行移入 Completed 表，tech-debt-tracker 中本 PR 三行的计划路径改到 completed。归档提交上的观察值（检出 `feature/workspace-read-assembly`，按命令重算）：`node scripts/rule-checks.mjs size origin/main` 代码 804 / 1000（独立复评的注释修订之后）、文档见该命令输出；`node scripts/rule-checks.mjs disclosure origin/main` 机械扫描通过且人工五类目无命中；`git diff --check origin/main...HEAD` 无输出；文档契约两文件全过。

Change Note (2026-10-04)：修订的独立复评留下 3 条 P3 措辞问题，已原处修正：`lastUpdatedAt` 注释补 metadata 帧的推进条件，契约测试头注释与 `reason` 新契约对齐，`derive.ts` 进入文件集后第 363 / 375 行 Decision 与 TD-026 的「不在文件集」表述加 Superseded 标注；结论不变。
