# 工作项列表读取状态 ExecPlan

> 状态：Active；本轮仅 spec + plan + draft，未授权产品实现。
> 创建：2026-10-01；Asia/Shanghai（CST）；规范：根 `PLANS.md`。
> 范围：#129，只读列表 renderer、共用状态与来源/新鲜度 badge。
> 分支：`feature/work-item-list-states`；独立于 #197、#249，不与它们堆叠。

## Purpose / Big Picture

实施后，读者能区分正在首次读取、真正收到的空快照、最后已知条目和无法读取；规划状态与工程提示分开显示，来源与时间可见。首次 pending 显示 skeleton，不以空数组猜测“暂无工作项”。陈旧或安全离线快照保留行；权限拒绝不借缓存继续展示内容。

最小交付是明确读取输入 → ui-model 纯投影 → React 实际静态 HTML → 完整路径的浏览器 bundle。fixture renderer 可以独立验收 [#129](https://github.com/SingularityKChen/harness-projects/issues/129)，不需要真实 GitHub 或 Host 装配先完成。真实 Harness 页面挂载、首次读取事件与动态播报留给 #178/#229，本计划不把导出一个组件描述为已经接通真实页面。

## Context and Orientation

取证于2026-10-01，基线 `df199a59220cfc32d6cc734116c55b38eec7abd6`。所有实施命令在检出本分支的工作树根运行；目录可为 `.worktrees/work-item-list-states`。实施前由执行者回读 `git rev-parse HEAD origin/main`、`git status --short --branch`，基线变化则更新计划与证据。本轮独立评审不执行Git或外部写入。

issue要求首次skeleton、stale保行并点名Provider与时刻、缺能力呈现可解释的不可用、每态有组件测试且不用颜色独占语义。#128已closed，历史blockedBy记录不构成当前前置阻塞；它建立的内容/权限正交和stale不滤行仍必须成立。

`packages/ui/src/index.ts` 目前只导出PlaceholderPanel/Icon；`placeholder.ts` 采用 `.ts` 与createElement，根tsconfig不启用JSX、noEmit。`packages/ui-model/src/types.ts` 的WorkItemList有rows/stale/connection/reason/lastUpdatedAt，没有loading；WorkspaceRead缺Provider显示名称、首个snapshot到达事件，CapabilitySnapshotEntry只有key/access/reason，没有读取失败类别。

`derive.ts/deriveWorkItemList` 沿EntityStore的稳定次序保行，遮蔽redacted标题与身份，但其行仍含entityId、planningStatus、derived与freshness.reason。尤其整表reason可能来自某条redacted行的source.reason；仅隐藏行标题仍可能通过banner泄漏。新页面不能直接传递原row或使用这些reason作为正文/tooltip。

`client/store.ts` 的revision初值0，合法空baseline也可为0；connected、空数组或lastUpdatedAt不能单独证明首读到达。`sync.ts` 的baseline/gap报告将来可作为壳的观察输入，本issue不修改该API、不注册订阅或缓存。`core/queries.ts` 的真实读门是planning.item.read；read_only允许读，不能拿写动作被禁用当作列表不可读。

另一个可执行性缺口是browser import：domain根barrel导出ids.ts，其runtime依赖node:crypto。只打包接受type-only view的renderer会漏掉实际归约路径。本闭环需要一个复用现有领域常量的纯值leaf，并让新旧列表投影都从它读取运行时值；不能复制枚举、把node:*外置或假称归约器属于尚未设计的Host API。

观察时Node为26.10.0，工作树的React、ReactDOM/server、React类型与esbuild均解析为MODULE_NOT_FOUND。只运行了已有纯Node展示/边界组，29 pass / 0 fail；这不是新页面验收。两稿记录本机pnpm11会自动install，与根pin10.28.2不符，本轮不运行pnpm、不安装依赖、不用mock掩盖环境缺失。

## Design / Spec

本工作按brainstorming的接口设计路径比较方案；First Principles以可观察结果和权威输入为起点，Qian综合状态、安全与构建边界。两位独立设计者每人给了两种完整候选，以下裁决吸收其具体内容而非简单汇总。

| 候选与证据 | 取舍 | 最终裁决 |
|---|---|---|
| 设计A方案A、设计B方案一：ui-model拥有纯page归约，UI消费安全view | 多一层窄输入，但状态与redaction只有一个owner，未来两壳共享 | 采纳；不是有订阅/缓存的第二状态机 |
| 设计A方案B、设计B方案二：component输入union与纵向ul/dl | 窄屏自然，但UI/壳承担状态选择及redaction，下一页容易复制逻辑 | 拒绝本轮采用；保留为布局需求改变后的候选 |
| table / list | table便于同列比较规划状态与工程提示；list重复标签且比较较慢 | 采用原生table；无grid、选择、排序、虚拟化或导航 |
| 设计A元素树检查 / 设计B真实SSR | 元素对象只描述type/props；SSR实际生成文本、属性与转义 | 用真实ReactDOM SSR，不把元素树当DOM验收 |
| DOM框架或浏览器自动化 | 可以证明挂载/查询，但静态只读renderer没有hook/交互，新增成本无法证明真实Host | 本轮SSR+完整browser bundle+静态fixture人工视觉；动态DOM/Host留#229 |

对设计A的not_supported/unknown仍可展示缓存建议予以拒绝：这两个输入不足以确认当前可见性。采纳设计B的权限fail closed与sanitized row联合。对两稿的renderer-only构建验证都加完整read/presentation路径正控，避免type擦除形成空验证。

输入事实由Host/壳拥有；ui-model只做确定性投影，UI不读取store、时钟、capability API或transport。新 `WorkItemListReadInput` / `WorkItemListView` / `VisibleListRow` / `deriveWorkItemListView` 在ui-model拥有，既有首页/详情/列表函数保持其职责，不为MMP前不存在的真实用户/数据增加兼容层或迁移。

输入用一个共同WorkspaceRead加封闭生命周期，避免两份列表缓存或两个读能力值：

    type ListReadFailure = {
      kind: 'permission_denied' | 'not_supported' | 'unknown' | 'offline' | 'error'
      safeMessage?: string
    }
    type ListDisplayMetadata = {
      planningSourceName?: string
      sourceNames: Readonly<Record<string, string>>
      safeNotice?: string
    }
    type WorkItemListReadInput = {
      read: WorkspaceRead
      metadata: ListDisplayMetadata
    } & (
      | { phase: 'pending' }
      | { phase: 'received'; refreshing: boolean }
      | {
          phase: 'failed'; hasReceivedSnapshot: boolean
          failure: ListReadFailure
          cacheVisibility: 'authorized' | 'unknown'
        }
    )

这些是将新增的纯展示输入，不是已存在的Host DTO。Host/未来壳明确记录首个baseline是否收到，空baseline同样收到；刷新不撤销received。切换workspace重置pending并更换对应store，不把旧workspace缓存当新scope。能力来自read.capabilities中的planning.item.read；没有该key是未观测，access unavailable且缺结构化原因只能说明原因未知，不能解析reason猜“权限不足”。

failure.kind由Host对确切读取结果做结构化观察，offline不能通过错误字符串猜出；safeMessage、安全来源名与safeNotice必须来自独立工作区元数据，不含原异常/堆栈/对象权限细节。名称缺失显示“规划来源名称未提供”或“来源名称未提供”；bindingId只作为非redacted来源字典的关联键，不作为显示名、平台分支、权限或排序依据。

优先级先处理明确permission_denied/not_supported及已观测的unavailable，再处理生命周期。pending尚未收到snapshot且无明确阻断时显示loading；若读能力也尚未观测，附“读取能力尚未确认”，仍不展示条目。收到snapshot后能力缺失/未知必须转不可用并隐藏rows；pending期间明确拒绝或不支持则立即停止skeleton显示原因，不无限等候。

| 输入 | 主体 / 行 | 解释 |
|---|---|---|
| pending，无明确阻断 | loading，3条装饰skeleton，无业务行 | 正在读取；缺能力观察只说明未确认，不伪造grant或empty |
| received，允许读，fresh，0行 | 真empty | “当前快照没有工作项”；revision=0也合法 |
| received，非空且fresh | content，原次序全部行 | 规划状态与工程提示分列 |
| stale/disconnected/gap | content保安全行；0行也不真empty | 最后已知值，来源与时间；不是过滤条件 |
| received refreshing | 保行或最后已知空快照，busy=true | 正在刷新，不退回首读skeleton、不称当前结果已确认 |
| read_only | 可读content/empty/loading，独立只读标记 | 不增加编辑或开始工作按钮 |
| degraded | 可读最后已知content，独立能力降级提示 | 保守新鲜度，不冒充实时fresh |
| permission_denied | unavailable.permission，无缓存行 | 点名planning.item.read，说明恢复授权 |
| not_supported | unavailable.unsupported，无缓存行 | 来源不支持读取，不建议补授权 |
| unknown / received缺读门 | unavailable.unknown，无缓存行 | 尚未确认读取能力，不声称权限拒绝或无内容 |
| offline/error，已received且cache authorized，读门仍允许 | content保行并stale | Host明确缓存可见才保留；不增加Provider事实 |
| offline/error，无安全快照或读门不允许 | unavailable.offline/error，无行 | 尚无可显示快照/读取失败，不能empty或永远loading |

每次投影先经既有deriveWorkItemList取得行与新鲜度，再根据页面读取过程保守降级；不修改其输入store/原row，不改变规划状态。输出不含actions、读取方法或原始错误，UI只接 `{ view: WorkItemListView }`，不另维护loading布尔或last-good缓存。

输出联合固定为下列结构；安全行的字段与redacted最小形状由随后两段规定，renderer不再推导能力或读取过程：

    type WorkItemListView = {
      workspaceName: string
      planningSourceName: string
      statusText: string
      readOnly: boolean
      degraded: boolean
      body:
        | { kind: 'loading' }
        | {
            kind: 'unavailable'; reason: ListReadFailure['kind']
            message: string; remaining: string
          }
        | {
            kind: 'content'; rows: readonly VisibleListRow[]
            stale: boolean; refreshing: boolean
            lastUpdatedAt?: string; notice?: string
          }
    }

visible行输出标题、Issue/Draft/PR/身份未知标签、规划状态文字、独立工程提示、安全来源名/authority及新鲜度。source的provider/host/manual权威必须分别显示，不能把Host权威标成平台。缺标题显示“标题未提供”，缺身份不能回退为Issue，未知规划状态显示“未知”。安全行顺序/key沿现有entity锚点，data-*、href和DOM id不放内部标识。

redacted输出仅 `{ kind: 'redacted', key: entityId }`，key只供框架内部。该行只显示“内容不可见”，其它单元格为“—”；不显示是否权限撤销/删除，不透title/body/externalId/externalKind/bindingId/entityId属性/authority/planningStatus/derived/row.reason，亦无tooltip、aria-label、隐藏文本或JSON脚本。新投影不返回原WorkItemRow，防止renderer重新读取敏感字段。

横幅不使用WorkItemList.reason或row.freshness.reason；它们可源自redacted条目。横幅只用Host独立safeNotice或中性短语。工作区来源名及最后成功读取时间可以展示，它们不能从redacted身份反推。时间使用read.lastUpdatedAt的绝对ISO文字与相同time.dateTime；缺失显示“最后读取时间未知”，坏ISO沿现有接线TypeError，绝不用Date.now补事实。

共享组件只导出LoadingState、EmptyState、UnavailableState、StaleBanner、SourceBadge、FreshnessBadge，不预建全产品组件库。页面是一处workspace标题、一处稳定状态区和一个table；列为工作项/内容身份/规划状态/工程提示/来源/新鲜度。caption、thead/tbody、th scope=col/row；没有行按钮、死链接、详情或连接入口。

采用一个持续存在的role=status、aria-live=polite、aria-atomic=true区域，在aria-busy内容容器外；不把整表文本放进live区域，不自动移焦。Skeleton aria-hidden且静态。文字说明只读、未知、降级、陈旧与状态，图标若用仅装饰，不能只靠颜色。窄屏容器允许横向滚动、可聚焦且保留可见focus；标题换行，不隐藏列。

[React createElement](https://react.dev/reference/react/createElement)支持无JSX的元素描述；[renderToStaticMarkup](https://react.dev/reference/react-dom/server/renderToStaticMarkup)生成静态非交互HTML。这里选择SSR只证明HTML与转义，不证明真实DOM、布局、焦点和动态屏幕阅读器播报。原生table的选择依据[WAI Table Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/table/)，状态区依据[ARIA status](https://www.w3.org/TR/wai-aria-1.2/#status)。

browser闭环将新增domain的 `./values` leaf，只re-export现有enums.ts的AccessLevel/ContentKind/NormalizedStatus与status.ts的DerivedFlag，不复制常量、不接入ids/identity。现有derive/capability-access的runtime import与新归约器使用该leaf；类型import可以仍经原入口。UI仅type import安全view，runtime只依赖React。

完整browser正控入口必须调用既有deriveWorkItemList、新deriveWorkItemListView与WorkItemListPage；用可注入EntityStore只读接口的fixture提供read，不将client.store构造/真实Host transport一并搬进本PR。metafile须实际包含这些当前工作树模块与domain leaf；不是type-only renderer smoke。未触达的真实client浏览器装配由#178/#229验证，不把该限定隐藏。

## Global Constraints

本轮正式写入仅本ExecPlan，README索引由主控独立owner维护。当前PR文档全集为 `docs/exec-plan/active/2026-10-01-work-item-list-states.md` 与 `docs/README.md` 的索引行；评审者只改前者。不改产品、配置、依赖、测试、旧计划、别的工作树或外部系统，不实施、不Git、不新增agent，不运行pnpm run/install。

未来code+tests完整允许集与新增+删除预算如下；新文件标将新建，测试/helper/manifest均计入，不能另建镜像fixture逃避预算。Domain owner只负责纯值出口，不碰#251/#253的identity/storage/core区域；同一UI架构单元由一个实施owner修改。

| 文件 | 未来职责 | 行数 |
|---|---|---:|
| `packages/ui-model/src/work-item-list-view.ts`（将新建） | 输入/输出union、唯一归约与安全投影 | 160 |
| `packages/ui-model/src/index.ts` | 新出口 | 6 |
| `packages/ui/src/work-item-list.ts`（将新建） | WorkItemListPage/table/可見行 | 135 |
| `packages/ui/src/list-states.ts`（将新建） | 四state/banner与两badge | 105 |
| `packages/ui/src/index.ts` | 共用出口、保留placeholder | 8 |
| `packages/ui/package.json` | dev React/ReactDOM精确pin | 4 |
| `packages/domain/src/browser-values.ts`（将新建） | 纯值re-export，无第二词表 | 6 |
| `packages/domain/package.json` | ./values显式出口 | 4 |
| `packages/ui-model/src/derive.ts` | 仅runtime import换leaf | 4 |
| `packages/ui-model/src/capability-access.ts` | 同样换leaf | 4 |
| `tests/contract/ui-work-item-list-view.test.js`（将新建） | 状态矩阵/正交/模型安全 | 120 |
| `tests/contract/ui-work-item-list.test.js`（将新建） | 真实SSR每态/全HTML泄漏/fixture输出 | 175 |
| `tests/contract/ui-work-item-list-browser.test.js`（将新建） | 完整browser路径/负控/运行边界 | 55 |
| 小计 / 余量 / 硬限 | SQL、tests、helpers、删行不豁免 | 786 / 14 / 800 |

未来生成的 `pnpm-lock.yaml` 只记录上述ReactDOM与dev pin，按仓库生成锁豁免计数，但须人工审计无附带升级。未来文档仍为当前集：计划≤420、索引≤6，合计426/余874/硬限1300，完成后同名移completed并由主控更新索引。本次不先移完成文件。

React runtime peer保留宿主18系列契约，开发React改精确18.3.1，新增测试dev react-dom精确18.3.1，与同一UI createRequire路径解析；已有React类型由锁固定，SSR测试是JS，不额外引ReactDOM类型。已有apps/harness-plugin的esbuild精确0.28.2供测试createRequire解析，不加根依赖或改build外置表。Node按.nvmrc，未来依赖须由受控10.28.2环境准备，本轮不安装。

不改client/controller/core/provider、apps注册、JSX/tsconfig、真实连接/重连、详情、编辑、StartWork、平台动作或全局设计系统。UI不import Provider/transport，不直接runtime importclient或Node内置；模型不import capabilities/Provider/UI框架。不存在数据迁移、备份恢复或旧API兼容义务。

若实际diff超800、需要hooks/交互、真实Host接线或更广browser边界修复，停止扩大实施并重审闭环；不删安全反例、SSR或完整browser正控凑行数。14行余量较小，预算是明确实施门，不保证尚未写出的代码一定合限。

## Plan of Work

当前Batch 0完成独立方案裁决、保存计划、磁盘语义审读与文档lint，主控维护索引、公开面、提交、draft及#129双向关联。已有授权覆盖spec/plan/draft，不再请求文档阶段批准；产品实施是随后的人类设计评审门。

未来Batch U1主文件为新page归约器及domain leaf：先确认工作树依赖完整并记录版本，不能把缺React/esbuild作为业务红。新增独立输入fixture，包含pending store和revision0空baseline；先写类型出口未实现/状态误归约的有判别力失败，再实现唯一归约与safe row。capabilities数组可以包含其它合法key，缺planning.item.read按未知处理；只有非法phase/failure种类或坏时间才是接线错误，不偷变权限原因。

U1最窄命令为纯view测试和既有ui-model-presentation组。读门值与CapabilityKey/AccessLevel的独立契约比较；leaf导出的对象与domain原出口严格同一引用，不能仅比较复制常量值。permission/unsupported/unknown隐藏缓存，offline/error授权保行，规划状态与derived独立。回滚只撤本批未发布代码，不动store事实或生成另一数据源。

未来Batch U2主文件为页面、共用状态与SSR测试：先以真实ReactDOM写每态HTML断言，再实现createElement组件。SSR通过ui manifest的createRequire取同一React/ReactDOM；assert出口存在后渲染，不自制mock或递归调用函数组件冒充renderer。new props重新渲染不同场景，不在UI维护缓存。

U2使用恶意redacted的独立ASCII canary覆盖title/body/identity/derived/planningStatus/rowreason与整表reason；同时有相同字段可见行正控，防止“全部隐藏所以绿”。检查完整HTML、属性、aria、hidden文本，不能只检查标题。安全Host文字中的HTML样式文本应正常转义。回滚是撤本批renderer/出口，保留模型与失败证据，不删依赖缓存当产品回滚。

未来Batch U3主文件为browser契约测试与计划：esbuild以platform=browser、format=cjs、write=false、metafile=true、external仅react，虚拟入口实际组合现有列表派生、新page归约与renderer。输出只允许react外置，meta路径须落当前工作树且含 `packages/ui-model/src/derive.ts`、`packages/ui-model/src/work-item-list-view.ts`、`packages/ui/src/work-item-list.ts` 和 `packages/domain/src/browser-values.ts`；不能通过external node:*或alias隐藏问题。

U3将browser输出在隔离vm中用唯一真实React执行，输入fixture的read.store.list()提供条目，得到组件后再做真实SSR；这证明完整路径被执行，但仍不称vm是浏览器DOM。负控将Domain根的newEntityId用于入口，build必须因node:crypto不可解析而失败；旧derive根barrel尚未换leaf时正控也应红，修复后绿。

U3完成本矩阵后跑既有边界/typecheck及安装件回归，renderer另有独立bundle证据，旧placeholder安装件不能替它作证。静态fixture导出HTML，人工检查320/768/1200宽度、长标题/来源、横向滚动和键盘focus，并记录截图/head；未实际打开不得勾视觉验收。整理为一个renderer能力闭环提交，实际push后回读下一门。

## Validation and Acceptance

本轮已执行的只是2026-10-01基线纯Node29/29和依赖解析，新增测试、leaf、SSR、bundle及build均未创建/未执行。以下命令是获产品实施授权且依赖完备后，在本分支根运行；前两步先最窄red→green，不以import环境错误当需求反例。

    node --test tests/contract/ui-work-item-list-view.test.js tests/contract/ui-model-presentation.test.js
    node --test tests/contract/ui-work-item-list.test.js
    node --test tests/contract/ui-work-item-list-browser.test.js tests/contract/package-boundaries.test.js
    node_modules/.bin/tsc --noEmit
    node --test tests/integration/harness-plugin-artifact.test.js
    UI_FIXTURE_OUT="$TMPDIR/work-item-list-fixtures.html" node --test tests/contract/ui-work-item-list.test.js
    node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js
    node scripts/rule-checks.mjs disclosure df199a59220cfc32d6cc734116c55b38eec7abd6
    node scripts/rule-checks.mjs size df199a59220cfc32d6cc734116c55b38eec7abd6
    git diff --check df199a59220cfc32d6cc734116c55b38eec7abd6...HEAD

期望各命令exit0，无skip；其中browser测试内的主动负控捕获node:crypto构建失败后该用例才pass，不是忽略build错误。typecheck没有React类型或bin则记环境未验证。无需pnpm run boundaries，等价直接Node边界组已列；当前禁止pnpm，不运行自动install。默认size门1000/1500不能替代本计划800/1300，额外按numstat逐文件核算。

| 验收 | 判别性证据 |
|---|---|
| 首次pending | HTML有加载文字/aria-hidden skeleton，无真empty或条目；pending+未观测能力有未确认说明 |
| 真received空 | revision0、fresh、有时间、允许读的空baseline才真empty；以相同store但pending做反控 |
| stale/断线/gap | 三行顺序/key稳定，包括redacted占位；来源与固定时间可见；stale0显示未确认而非正常empty |
| 刷新与degraded | 旧行保留、busy/最后已知值；不退回首读skeleton，不冒充当前值 |
| 只读/不可用区分 | read_only可读；permission/unsupported/unknown文字不同且点名key/剩余可见元信息，均不借缓存 |
| offline/error | received+authorized+允许读保行，否则错误说明无伪行，无永远loading/empty |
| redacted | safe row仅kind/key；全HTML不含所有ASCII canary，含可见正控；banner不泄list.reason |
| 规划/工程正交 | 相同规划状态下derived变化仅改变工程列，不合成规划Done或改排序 |
| 来源/时间安全 | 恶意displayName正常转义；缺名称不退bindingId；缺时间说明未知，固定ISO相同文本/dateTime |
| 语义与视觉 | SSR验证caption/th/time/status/aria-busy；人工fixture截图验证三种宽度/滚动/focus，动态播报另案 |
| 完整browser链 | meta与实际执行同时触达derive→page view→renderer+pure values；根barrel负控红，无Node内置/transport |
| 既有#128不退化 | 旧展示与边界套件通过，stale不是过滤，内容种类与权限仍正交 |

人类设计评审后才实施；实施人类验收只要求本renderer fixture可审阅，不把缺真实Host作为不可审设计的借口。真实Host内容来源、生命周期注入与动态可访问性由#178/#229另行验收；本轮不完成MVP或E1/R1。

## Progress

- [x] (2026-10-01 21:06 CST) 重读本树规则、两位设计者各两候选，核实缺失输入、redacted泄漏面与browser barrel机制。
- [x] (2026-10-01 21:06 CST) 运行已有ui-model/边界纯Node组29 pass；React/ReactDOM/类型/esbuild解析为缺失，记录环境限制。
- [x] (2026-10-01 21:06 CST) 独立裁决统一纯投影、table、真实SSR与完整browser链，保存本spec+plan。
- [x] (2026-10-02 06:49 CST) 重开磁盘完成八问语义审读，原生awk求和13项786/余14，专用lint通过；补明确输出union并纠正缺读key、store.list及完整meta路径表述。
- [x] (2026-10-02 06:58 CST) 主控完成README索引、技能lint与文档契约9/9，正式SSR/bundle验收仍未执行。
- [ ] 后续实施交接前回读draft当前head/base/draft/checks/#129双向关联及线程；发布状态以GitHub当前快照为准。
- [ ] (2026-10-01 21:06 CST) 后续U1/U2/U3实现、正式red→green/SSR/bundle/视觉验收；当前未执行。
- [ ] (2026-10-01 21:06 CST) 后续产品验收及最终push后API回读，才考虑ready；不自行merge。

## Surprises & Discoveries

现有绿色#128测试只证明已有模型：29/29未覆盖首次snapshot事实或React页面。读取能力reason没有稳定失败类别，不能把“不可用”字样当permission_denied。整表reason又可回退到被遮蔽行，故必须做完整HTML canary及独立安全banner输入。

browser入口若只含renderer，模型类型在构建时擦除，看不到node:crypto；这不是完整正控。由独立审读新增pure values入口与完整调用链，其他Host/client浏览器装配仍未验收。环境MODULE_NOT_FOUND不作为业务反例，更不能通过临时React mock制造green。

2026-10-01 21:36 CST的包名解析显示现有ui/ui-model指向主检出，上一轮29条通过只作为旧模型诊断。后续新增业务测试必须先确认包名及metafile解析到本任务树，不能沿用主检出通过来证明新实现；本轮不修依赖或重跑宽测试。

## Decision Log

Decision：采纳两稿统一ui-model投影/table主方案，拒绝component联合/list与空数组猜状态。Rationale：生命周期、能力与redaction在一个owner收敛，字段比较清楚，renderer无另一套归约。Date/Author：2026-10-01 21:06 CST / 独立评审者。

Decision：未知/不支持不展示缓存，offline/error仅明确授权且读门允许才保行；banner不使用原row/list reason。Rationale：未知权限与隐藏对象原因不能成为展示事实，stale/权限维度仍分离。Date/Author：2026-10-01 21:06 CST / 独立评审者。

Decision：真实SSR+完整browser路径+人工静态fixture，Domain仅增加纯值leaf。Rationale：元素描述不是DOM，renderer-only bundle不能证明归约器；不复制常量或宽改client/Host。Date/Author：2026-10-01 21:06 CST / 独立评审者。

Decision：本轮只完成已授权文档与draft，不添加迁移兼容或再次要求文档批准。Rationale：用户明确MMP前无真实用户/数据；产品实施和下一门仍由人类选择。Date/Author：2026-10-01 21:06 CST / 主控授权、独立评审记录。

## Idempotence and Recovery

纯投影同输入同输出，不修改EntityStore，不保存第二份last-good、不改规划状态。相同row key稳定，重新SSR不会创建资源。fixture输出只替换指定临时HTML，不能删除其他工作树或依赖目录；没有数据迁移/旧用户恢复问题。

产品实现回滚以完整renderer闭环提交revert，撤出口/leaf import与相应依赖锁变化，不修改Host或平台。若输入不能由未来Host提供，保持fixture contract并把装配缺口交#178/#229，不在#129私加API、transport或业务状态。

依赖缺失就记环境门未通过，在受控pinned环境准备后重跑；不反复调用本机pnpm自动安装，不用mock/skip。若引入hook、交互或需要DOM框架，先更新本计划和预算；不能继续用静态SSR宣称动态行为正确。

## Interfaces and Dependencies

新输入owner为ui-model，观察owner为Host/未来壳，渲染owner为ui；key只内部使用，metadata只安全文字。现有WorkspaceRead/EntityStore与domain常量是输入接口，不虚构当前Host displayName/读取失败API。新增./values是domain叶子出口，无反向依赖，既有root对象与leaf对象身份相同。

React18.3.1/ReactDOM18.3.1及既有esbuild0.28.2分别从所属manifest createRequire解析，避免根测试JS误用另一个React副本。独立test entry必须指向当前树；若meta解析到其他检出，停止验收。真实装配不会由bundle passing自动获得证明。

未来在本分支根回读 `gh pr view -R SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup` 及 `gh issue view 129 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences`。期望draft、base=main、双向关联仅#129；主控另读reviewThreads和实际checks。只投影已有issue/milestone/iteration及授权非Status机械字段，不写Status或原生blocking。

## Outcomes & Retrospective

当前产物为可审阅的spec+plan；产品code/test/dependency变动0，新SSR/bundle/build未执行。只有基线29条纯Node测试作为旧模型诊断，不能称列表renderer通过。2026-10-02 06:49 CST完成最终磁盘审读、13项预算求和与专用lint；主控公开面与发布结果按实际补录。

遗留是#178/#229实际Host生命周期/安全metadata/真实DOM挂载与动态播报，以及未触达client.store构造的browser装配；不扩大本PR解决。实施若新增维护债务，在本计划写明并按根规则登记 `docs/exec-plan/tech-debt-tracker.md`，当前不改tracker或旧计划。MMP前无数据不免除本renderer当前redaction与读取真实性要求。

## Concrete Steps

现在重开保存文件执行八问语义审读、逐项预算和技能lint后冻结，由主控独立维护README/公开面/draft。后续U1→U2→U3记录当前head/base、真实失败原因、环境门、red→green与fixture截图；scope变化改本计划，不能把当前草案当产品实施授权。

## Artifacts and Notes

观察上下文（2026-10-02 06:58 CST）：检出 `feature/work-item-list-states`、基线如Context所示的文档工作树；技能lint为OK，`node --test tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js` 为9 passed/0 failed。本次仅计划与索引，最终体量重算 `git diff --numstat origin/main...HEAD`；独立评审、组件实施与实际Host验收是不同证据。

证据使用仓库相对路径、检出分支/观察head、命令和小段结果，不发布本地研究包或本机绝对路径。SSR HTML、browser metafile与static fixture证明各自边界；元素树、vm、静态HTML、真实DOM与真实Host验收不混称。损坏sourceName或隐藏row canary只用合成数据。

## Bottom Change Note

Change Note (2026-10-01 21:06 CST)：独立比较两稿多方案，采纳统一投影/table并收紧未知缓存与redacted banner；增加纯值leaf/完整browser正控、真实SSR及清楚证据边界；不承接前批迁移假设，当前仅spec/plan，修改集与预算见Global Constraints。

Change Note (2026-10-02 06:49 CST)：最终磁盘八问审读与预算/lint通过；补明确安全输出union、正确store.list接口与完整browser meta路径，缺读取key按未知处理；记录旧包名解析的证据边界，不增加产品机制或迁移要求。

Change Note (2026-10-02 06:58 CST)：主控添加独立索引及本轮文档验证证据，未来实现/API交接门保持未完成，修改全集只见Global Constraints。
