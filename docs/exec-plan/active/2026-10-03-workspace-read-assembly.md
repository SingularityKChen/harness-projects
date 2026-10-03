# Client 工作区读取生产链 ExecPlan

> 状态：Active；Batch 0–2 已完成，Batch 3 pending。
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
现有controller多次Core只读采样的并发一致性不在此扩成新持久化事务模型；本项保证传输帧与客户端接受点一致，乱序竞争归 #218。

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
| ui-model消费 | `packages/ui-model/src/types.ts`；`packages/ui-model/src/capability-access.ts`；`packages/ui-model/src/work-item-list-view.ts` |
| 测试 / fixture | `tests/e2e/workspace-read-assembly.test.js`（将新建）；`tests/e2e/client-sync.test.js`；`tests/e2e/controller-roundtrip.test.js`；`tests/contract/ui-model-presentation.test.js`；`tests/contract/ui-work-item-list-view.test.js`；`tests/contract/ui-work-item-list.test.js`；`tests/contract/ui-work-item-list-browser.test.js` |
| 文档 | 本计划；`docs/README.md` |

每PR code实际增删≤800、docs≤1300，含tests/fixtures，排除锁文件/生成目录。
预算区间：Core约55–85；controller约110–150；client约120–165；ui-model约45–70；测试/fixture约180–250；代码总计约510–720。文档约330–420行。
到code约650时盘点剩余fixture与协议调用者；预计超800先停增写/重划闭环，不能提交只有producer而没有consumer的半功能。
不引新层级边、Provider调用或依赖；ui-model不importcontroller/capabilities；client不importui-model/React。
不改Storage sync签名、schema、数据迁移、旧协议兼容；pre-MMP直接换最终types/fixtures，无双读写。
不做generation/并发poll仲裁、迟到baseline过滤；#218仍独立开放，#199的错误healthy producer也不被本项修复。
不改React页面、真实Host/plugin、凭据、账号、CI和规划状态；Status/blocking无人点名批准不得写。
技术债引用现有 `docs/exec-plan/tech-debt-tracker.md`；本轮未实现不新增实现债，后续新债先核已有issue归属。

## Plan of Work

### Batch 0 · 两独立方案与最终协议（本轮）

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

### Batch 1 · 真实producer与完整来源事件（pending）

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

### Batch 2 · Client唯一接受点、assembler与断网（pending）

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

### Batch 3 · ui-model单真源与partial验收（pending）

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
| 单一接受点 | clock非法/store拒绝时头/能力/time均保持旧值 |
| 权限/三态安全 | unavailable/unknown不显示未授权cache，redacted不回退标题身份 |
| 能力真源 | 主/备用路由正确、64格差分、key字面量零命中、boundaries绿 |
| 回归与预算 | 旧controller/client/ui tests通过，实际diff≤800/1300 |

### Artifacts and Notes

基线生产链探针看到controller baseline degraded/revision N，但sync.poll idle且connected true、旧行current；此反例必须在持续连接状态修复。
已有27个client/ui-model测试绿色不包含完整assembler与same-revision来源通道；不把旧通过数当新增闭环证明。
下列关联读取在本分支工作树根目录执行，PR创建后通过branch找到编号，计划不手抄关闭引用。

    gh pr list -R SingularityKChen/harness-projects --head feature/workspace-read-assembly --state open --json number,isDraft,baseRefName,headRefOid,closingIssuesReferences
    gh api graphql -f owner=SingularityKChen -f repo=harness-projects -F number=178 -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){state closedByPullRequestsReferences(first:100){nodes{number isDraft state baseRefName headRefName}}}}}'

期望唯一draft/base main、最终head匹配，PR与issue双向关闭引用可证，issue开放；解析失败先修PR正文回读，不以关键字自己宣布权威关联。

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
- [ ] (2026-10-03 21:34 CST) Batch3：ui-model真源/partial/view与远端产品门。

## Surprises & Discoveries

watch的same-revision分支吞掉source变化；只补assembler仍会把持续连接旧行显示current，必须有metadata通道。
纯header metadata仍漏行freshness；完整row-source清单和view的read.reason规则一起调整，才能保留partial已确认行。
Batch 1 发现：`registry` 只挂外部四域，storage 域没有挂载目标；按“无目标即unavailable”会对本地Storage说错，故 `getWorkspaceMetadata` 不报告 storage.* key（消费者对缺失 key 本就按 unavailable）。
离线替身的执行备用不声明 `execution.run.fallback`，唯一挂载用例改以 `execution.run.cancel`（主不声明、备用声明）判别。
`ui-model-presentation` 的字段面机械同形测试按 `interface X {` 解析，遇到 `extends WireWorkspaceHeader` 会找不到；解析器已跟随 extends 递归（测试侧改动）。
Batch 1 为让 client 在同一提交内编译，sync 暂把 metadata 事件当缺口重拉基线（保守且正确）；Batch 2 换成精确的 metadata 接受点。
Batch 2 发现：真实空项目必须显式传 `workspace.project`（bootstrap 靠条目观察发现项目，零条目时 `not_found`）；空表用例据此构造。
store 的修订/来源头校验会拒绝 `source.revision !== revision` 的帧；既有 fixture 本就满足，无需改。
#199仍可能错误生产healthy，本项忠实传输而不catchStorage producer；#218迟到baseline竞争仍开放，不悄悄加generation算法。
无Storage时descriptor尚未确认；最终read undefined表达冷启动，不制造看似可用workspace。

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
Decision：ISO 8601 校验在 client 与 ui-model 各一份同口径正则。Rationale：ui-model 不得依赖 client 的运行时校验内部，且 derive.ts 不在本 PR 文件集；记为小重复，不引第二个权威源（口径相同、各自校验自己的边界）。Date/Author：2026-10-03 22:26 CST / Sonnet implementer。

## Idempotence and Recovery

metadata重复内容为idle；重复baseline按现有稳定身份覆盖；时间只在确认接受点更新，不以poll次数增长。
disconnect/异常保留last-known并标stale；后续成功重连从controller baseline恢复，client会话重启从undefined时间重新积累。
无schema/历史数据迁移；whole协议回滚同时恢复producer/consumer/fixture，不能只回滚一端。
外部actor是 `SingularityKChen`，target公开repo `SingularityKChen/harness-projects` 与Project10；逻辑重试键 `178+feature/workspace-read-assembly`。
先读同branch PR/issue Project item再创建或更新；未知结果回读确认，不声称GitHub提供此幂等键，不将draft伪装Engineering PR open。
写trace记录actor/目标/请求/ack/readback；共享历史重写须恢复锚点/专家流程，本轮不合并或清理其他worktree。

## Interfaces and Dependencies

Core只读metadata→controllerWire→clientread→ui-model alias，能力key/intersect沿允许依赖出口传递；不新增跨层反向边。
Transport现有baseline/watch消费面保留，WireEvent新增metadata；sync报告kind加metadata，assembler通过sync.read固定store归属。
#189是共享binding健康隔离，#178是六字段生产通道，两者联合验收但无编译前置；不把合并顺序写成blocked-by。
#218未来竞争修复须在唯一接受点拒整帧metadata/time；本项不宣称其旧红例通过。#199/真实Host服务/页面挂载由各自issue承担。
Next gate：Batch0文档门→draft；实施前完整fixture盘点和红例非零，产品验收及精确远端head后才ready，合并由人决定。

## Outcomes & Retrospective

当前产物是独立审查通过的最终spec，六字段生产链仍未实现；issue开放、计划Active、PR保持draft。
技术债tracker无新增实现债；#199/#218不关闭，外部类比不替代本地证据。
完成后记录实际协议/断网/partial/负对照、偏差和债务，再按PLANS归档并更新索引；当前不填写未来成功结果。

## Bottom Change Note

Change Note (2026-10-03 21:34 CST)：独立reviewer收敛两设计，采用窄metadata+完整row-source、单接受点和明确时间，补partial页面消费及#199/#218边界；产品pending。
Change Note (2026-10-03 21:52 CST)：补canonical三参数intersect调用，独立linter和结构/路径检查已通过；全仓文档门由主执行者继续落账。

Change Note (2026-10-03 21:56 CST)：主执行者全文复核并运行文档契约与独立路径/暂存扫描，记录Batch 0文档门；后续产品批次保持pending。

Change Note (2026-10-03 22:08 CST)：记录人类在Project上的规划启动与#178重排期确认；保留原调查调度快照并明确取代，产品实施仍pending。

Change Note (2026-10-03 22:23 CST)：Batch 1 完成：Core 元数据查询、Wire 头/metadata 事件、watch 同revision判定与4项负对照落账；文件集无新增（client/sync.ts 的编译补丁在集合内）。

Change Note (2026-10-03 22:26 CST)：Batch 2 完成：workspace-read.ts、store.applyMetadata 与 sync 唯一接受点/read/disconnect 落地，7项负对照落账；文件集无新增。
