# 工作项列表读取状态 ExecPlan

> 状态：Completed（2026-10-03）：U1/U2/U3、修复轮 1、产品验收与第一轮 MVP 评审修订完成；评审 APPROVE（0 × P0/P1，2 × P2 + 3 × P3），按人类伙伴的规则（只剩 P2/P3 时批准后修复、归档、整合提交、rebase merge）收尾；push、回读与合并由主控执行，合并回执以 `gh pr view 256 -R SingularityKChen/harness-projects --json mergedAt,mergeCommit` 回读为准。一条设计取舍留待人类裁决（Decision Log 2026-10-03 的开放问题）。2026-10-01 的「本轮仅 spec + plan + draft，未授权产品实现」Superseded by Decision Log（2026-10-02 授权条）。
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

观察时Node为26.10.0，工作树的React、ReactDOM/server、React类型与esbuild均解析为MODULE_NOT_FOUND。只运行了已有纯Node展示/边界组，29 pass / 0 fail；这不是新页面验收。两稿记录本机pnpm11会自动install，与根pin10.28.2不符，本轮不运行pnpm、不安装依赖、不用mock掩盖环境缺失。Superseded by Decision Log（2026-10-02 Ruling G2 / 256-1）：实施轮 PATH 上的 pnpm 为 10.28.2，与根 packageManager 一致，已完成 frozen install 与精确依赖添加，React、ReactDOM/server、React 类型与 esbuild 均解析到本工作树。

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
| 读门已观测不可读（unavailable 或非枚举值），没有结构化失败 | unavailable，reason 仍为 unknown，无缓存行 | 能力已确认不可用、原因未提供；说明工作区与规划来源仍可查看，读取能力恢复之前不显示条目与此前的缓存（第一轮 MVP 评审 P2，2026-10-03） |
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

本轮正式写入仅本ExecPlan，README索引由主控独立owner维护。当前PR文档全集为 `docs/exec-plan/completed/2026-10-01-work-item-list-states.md`（2026-10-03 归档前位于 `active/`）与 `docs/README.md` 的索引行；评审者只改前者。不改产品、配置、依赖、测试、旧计划、别的工作树或外部系统，不实施、不Git、不新增agent，不运行pnpm run/install。Superseded by Decision Log（2026-10-02 Ruling G1）：实施轮按下表允许集改产品代码与测试，Git 提交由实施者在本地分批完成（不 push、不 gh 写操作），按 Ruling G2 使用 pnpm 10.28.2；索引与公开面仍由主控维护。Superseded by Decision Log（2026-10-03 09:41 CST 主控裁决）：文档全集另含 `docs/adr/ADR-0009-harness-plugin-installable-artifact.md` 的 node:crypto 后果条与 `docs/product/vertical-path.md` §2.1 的简称表行及第 4 行。Superseded by Decision Log（2026-10-03 第一轮 MVP 评审条）：归档时索引行移入 `docs/README.md` 的 Completed 表；`docs/product/vertical-path.md` §2.1 另在 main 新增的「更新于」说明末尾补一句第 4 行三条引用的回读。

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

U3完成本矩阵后跑既有边界/typecheck及安装件回归，renderer另有独立bundle证据，旧placeholder安装件不能替它作证。静态fixture导出HTML，人工检查320/768/1200宽度、长标题/来源、横向滚动和键盘focus，并记录截图/head；未实际打开不得勾视觉验收。整理为一个renderer能力闭环提交，实际push后回读下一门。Superseded by Decision Log（2026-10-02 22:45 CST 验收提交序列）：整理为按批次的三个代码提交加一个文档提交。

## Validation and Acceptance

本轮已执行的只是2026-10-01基线纯Node29/29和依赖解析，新增测试、leaf、SSR、bundle及build均未创建/未执行。Superseded by Artifacts and Notes（2026-10-02 22:05 CST）：新增测试、leaf、SSR、bundle 均已创建，下列命令的实际结果记在该节。以下命令是获产品实施授权且依赖完备后，在本分支根运行；前两步先最窄red→green，不以import环境错误当需求反例。

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

期望各命令exit0，无skip；其中browser测试内的主动负控捕获node:crypto构建失败后该用例才pass，不是忽略build错误。typecheck没有React类型或bin则记环境未验证（Superseded by Decision Log Ruling G3：typecheck 是必过门，实测 exit 0）。无需pnpm run boundaries，等价直接Node边界组已列（issue 验收条点名它，验收轮另行实跑，见 Artifacts and Notes）；当前禁止pnpm，不运行自动install（Superseded by Decision Log Ruling G2：pnpm 10.28.2 允许）。默认size门1000/1500不能替代本计划800/1300，额外按numstat逐文件核算。

| 验收 | 判别性证据 |
|---|---|
| 首次pending | HTML有加载文字/aria-hidden skeleton，无真empty或条目；pending+未观测能力有未确认说明 |
| 真received空 | revision0、fresh、有时间、允许读的空baseline才真empty；以相同store但pending做反控 |
| stale/断线/gap | 三行顺序/key稳定，包括redacted占位；来源与固定时间可见；stale0显示未确认而非正常empty |
| 刷新与degraded | 旧行保留、busy/最后已知值；不退回首读skeleton，不冒充当前值 |
| 只读/不可用区分 | read_only可读；permission/unsupported/unknown文字不同且点名key/剩余可见元信息，均不借缓存；读门已观测不可读与未观测的说明不同，每类不可用的「还能做什么 / 怎样恢复」（`remaining`）在 view 与 SSR 各有判别断言（第一轮 MVP 评审，2026-10-03） |
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
- [ ] 后续实施交接前回读draft当前head/base/draft/checks/#129双向关联及线程；发布状态以GitHub当前快照为准（实施轮不 push、不 gh 写，留给主控）。归档时仍未完成：由主控在推送整理后的序列之后回读，见下文最后一条。
- [x] (2026-10-02 21:51 CST) 回读实施起点：分支 `feature/work-item-list-states`、head 617e616、base df199a5；基线 49/49、tsc exit 0；三个包名从本工作树解析（Ruling 256-3）。
- [x] (2026-10-02 21:56 CST) Batch U1：domain `./values` leaf、`deriveWorkItemListView`、view 契约测试 RED→GREEN（10/10）。
- [x] (2026-10-02 22:00 CST) Batch U2：精确 pin 的 react / react-dom、renderer 与共享状态、真实 SSR 测试 RED→GREEN（9/9）。
- [x] (2026-10-02 22:05 CST) Batch U3：完整 browser bundle 路径与负控（2/2）；变异核对、Validation 命令与 `pnpm run verify` 通过，见 Artifacts and Notes。
- [x] (2026-10-02 22:30 CST) 修复轮 1（对抗验证 I1/I2/I3/M2/M4/M6/M10 与主控目视 V1/V2）：行新鲜度组合规则、状态区单次宣告、标记按状态出现、版式 style、补守卫与缺口用例；先红后绿，变异补测全部杀死，见 Artifacts and Notes。
- [x] (2026-10-02 22:29 CST) 视觉验收 320/768/1200：按 Ruling 256-2 由主控在 8f5c645 用浏览器 pane 打开 fixture 实测通过（数值见 Artifacts）；fixture 由 `UI_FIXTURE_OUT=<临时路径> node --test tests/contract/ui-work-item-list.test.js` 产出，不入库。验收轮没有改 renderer，重新生成的 fixture 与 8f5c645 的逐字节相同，结论沿用。
- [x] (2026-10-02 22:45 CST) 产品验收：逐条对照 #129 验收条与本计划 Validation 表，处理全部延后的次要项，简化归约器并补 4 处守卫，整理提交序列（见 Decision Log、Artifacts and Notes）。
- [x] (2026-10-03 09:41 CST) 按主控裁决订正 ADR-0009 的 node:crypto 后果条与纵向路径 §2.1 第 4 行的证据引用，并入文档提交（见 Decision Log）。
- [x] (2026-10-03 11:10 CST，记录时刻) 第一轮 MVP 评审：评审账号在 62fd53e 上 APPROVE，0 × P0/P1、2 × P2 + 3 × P3，另有一条 PR 级设计取舍（见 Decision Log 2026-10-03 两条）。
- [x] (2026-10-03 11:10 CST，记录时刻) 变基到 `main@d008132`：唯一冲突在 `docs/product/vertical-path.md` 的测试简称表，integration 行取 main（含 `start-work-sqlite-registration`）、contract 行取本 PR（三个 ui 用例），第 4 行自动合并；变基后三份新测试与 ui-model-presentation 46 / 46、tsc exit 0。
- [x] (2026-10-03 11:10 CST，记录时刻) 评审修复：两条 P2、三条 P3 全部采纳，先红后绿，11 个变异全部杀死；第 4 行三条引用在变基后的树上回读；计划归档到 `completed/`，索引行移入 Completed 表（证据见 Artifacts and Notes「第一轮 MVP 评审修复证据」）。
- [x] (2026-10-03 12:10 CST) 修复复评（第二轮）：评审账号在 437a9e1 上 APPROVE，旧 5 条按原条件复跑全部成立，0 × P0/P1/P2、1 × P3（`GATE_BLOCKED` 的缓存子句没有断言；unknown 的第二段只说不显示什么）。已修：unknown 的第二段补「工作区与规划来源仍可查看」，SSR 正则延伸到缓存子句并对全部不可用页断言不承诺显示缓存；V1–V5 变异全部杀死。
- [ ] (2026-10-01 21:06 CST) 人类评审及最终push后API回读，才考虑ready；不自行merge。人类评审部分已由上面的第一轮 MVP 评审完成；push、回读、ready 与 rebase merge 在归档之后由主控执行，以 PR #256 回读为准。

## Surprises & Discoveries

现有绿色#128测试只证明已有模型：29/29未覆盖首次snapshot事实或React页面。读取能力reason没有稳定失败类别，不能把“不可用”字样当permission_denied。整表reason又可回退到被遮蔽行，故必须做完整HTML canary及独立安全banner输入。

browser入口若只含renderer，模型类型在构建时擦除，看不到node:crypto；这不是完整正控。由独立审读新增pure values入口与完整调用链，其他Host/client浏览器装配仍未验收。环境MODULE_NOT_FOUND不作为业务反例，更不能通过临时React mock制造green。

2026-10-02 22:05 CST 实施期发现：(1) 本工作树 `import.meta.resolve` 把 `@harness-projects/ui-model`、`ui`、`domain`、`client` 解析到 `.worktrees/work-item-list-states/packages/*/src/index.ts`，上一轮指向主检出的现象不再出现。(2) 本机 pnpm 是 10.28.2 而不是计划假设的 11，frozen install 与 `--offline` 可用，tsc 基线 exit 0，React 类型已就位。(3) `pnpm add` 把 `packages/ui/package.json` 的 dependencies 键序改成字母序（domain 与 client 互换），已手工还原，manifest 只剩 react 精确化与 react-dom 两行。(4) React 18.3.1 SSR 按原名输出 `dateTime="…"` 而非小写，断言以实际输出为准。(5) 纯 re-export 的 `browser-values.ts` 在 esbuild metafile 里 `bytesInOutput` 为 0（字节记在 enums.ts / status.ts），meta 断言因此看 `inputs` 的存在性而不是字节。(6) 自查缺陷：初版行级新鲜度直接取既有行的 `freshness.stale`，Host 给出整表降级原因而条目都新鲜时行会写“当前值”而横幅说最后已知；改为每行继承整表 stale（fail closed），由 view 测试的 hostDegraded 断言钉住，变异 M7 证实。Superseded by Decision Log（2026-10-02 22:30 CST 行新鲜度组合规则）：整表继承又抹掉了单条陈旧的区分，且漏了 refreshing，见下 (9)(10)。(7) 来源名查表的 `hasOwn` 与 `typeof` 两道防线互为冗余，原断言下变异 M11 存活；改用继承对象与非字符串值断言后两道防线各被一个变异杀死。(8) 体量：renderer 实际 93 行（计划 240），code+tests 合计 634 / 786，逐文件分配与计划不同，以合计为准。 (9) 修复轮 1（对抗验证 probe p1）：刷新态页首与每行都写“当前值”，而状态区与横幅写“最后已知值”；原因是 `stale` 与行级标记都没有把 `refreshing` 算进去，(6) 的修复只覆盖了 Host 降级。(10) 同一修复把行级标记改成整表继承，丢掉了既有 `deriveWorkItemList` 给出的逐行新鲜度：一条陈旧条目会让所有新鲜行都写“最后已知值”。(11) 版式（主控目视 V1）：表格在 `table-layout:auto` 下被超长标题抢走宽度，而 `overflow-wrap:anywhere` 把短列的最小内容宽度降到一个字，于是短列被挤成一字一行、320px 下滚动容器也不溢出（scrollWidth 288 等于 clientWidth 288），横向滚动路径从未发生。(12) 读门标记不分状态渲染：loading 旁写“显示的是保守的最后已知值”，权限错误旁写“只读”，都不为真。(13) 评审变异的存活者 A1 / A2 / A6 / A7 / C4 / C5 说明原测试缺少 pending 带非空 store、refreshing 零行、loading 的 aria-busy、横幅缺时间回退与滚动容器 tabindex / overflow 的断言；`markAllStale` 缺口也无用例。均已补测并被变异杀死。

2026-10-01 21:36 CST的包名解析显示现有ui/ui-model指向主检出，上一轮29条通过只作为旧模型诊断。后续新增业务测试必须先确认包名及metafile解析到本任务树，不能沿用主检出通过来证明新实现；本轮不修依赖或重跑宽测试。

2026-10-02 22:45 CST 验收期发现：(14) `phase: 'failed'` 缺 `failure` 时不报错，读门可读且缓存授权就静默保行——类别未知的失败（可能本是权限拒绝）借缓存继续显示内容，是对畸形输入 fail open；类型系统挡得住 TS 调用者，挡不住 JS / 未来壳。(15) 读门取非枚举值（如 `bogus`）、未知 derived 标记的“未知提示”回退与不可用页仍显示工作区和规划来源名（“剩余可见元信息”）此前都没有用例钉住，删掉对应分支的变异全部存活。(16) `docs/adr/ADR-0009-harness-plugin-installable-artifact.md` 的后果条写着 domain 的 node:crypto 使 client bundle 无法导入 domain / ui-model / client 的运行时值；本 PR 之后 ui-model 经 `@harness-projects/domain/values` 已有浏览器安全路径（browser 测试为证），该条对 ui-model 已部分过时；`docs/product/vertical-path.md` §2.1 第 4 步的证据列也还没引用本 PR 的用例。两份文件都不在本计划允许集内，交主控另案更新。Superseded by Decision Log（2026-10-03 09:41 CST 主控裁决）：两处已在本 PR 内最小订正。核对时另发现 client 根出口按 platform=browser 打包仍失败：它经 controller 的值导入触达 capabilities 与 core，二者也值导入 `node:crypto`（esbuild 报 `packages/capabilities/src/observation.ts`、`packages/core/src/execution-context.ts`、`packages/core/src/relations.ts` 与 `packages/domain/src/ids.ts`），这是 #229 的范围。

2026-10-03 第一轮 MVP 评审期发现（评审证据在 62fd53e 与「main@d008132 合入本 PR」的树上取得，变基后的 head 上复现相同）：(17) 读门已观测为 `unavailable` 与读门未观测在页面上逐字相同：两者都归到 `unavailable('unknown')`，都说「尚未确认读取工作项的能力」，第二句只说不显示什么，没有 #129 验收第 3 条要求的「还能做什么」；原因是上文 2026-10-02 22:05 的优先级决定把「读门阻断」与「未观测」合用了同一组文案。(18) `remaining`（恢复路径）没有任何断言：评审者把 permission_denied 的 remaining 改成「此前的缓存仍会显示。」并把全部 remaining 置空，两份测试仍 22 / 22；renderer 不渲染 remaining 时四份测试加 ui-model-presentation 45 / 45。修复轮 1 与验收轮的三张变异表都只覆盖 message。(19) `hasReceivedSnapshot` / `refreshing` 没有与 phase、failure 同等的运行时校验：字符串 `'false'` 是真值，离线失败借缓存保行（`content 1`）；`received` 缺 `refreshing` 时行 `stale` 与 `body.refreshing` 为 `undefined`，状态区写「已读取当前快照」——与 (14) 同属畸形输入 fail open。(20) `cacheVisibility` 非两值时已经 fail closed（只认 `'authorized'`），但不响亮；评审修复把它并入同一道守卫。

## Decision Log

Decision：采纳两稿统一ui-model投影/table主方案，拒绝component联合/list与空数组猜状态。Rationale：生命周期、能力与redaction在一个owner收敛，字段比较清楚，renderer无另一套归约。Date/Author：2026-10-01 21:06 CST / 独立评审者。

Decision：未知/不支持不展示缓存，offline/error仅明确授权且读门允许才保行；banner不使用原row/list reason。Rationale：未知权限与隐藏对象原因不能成为展示事实，stale/权限维度仍分离。Date/Author：2026-10-01 21:06 CST / 独立评审者。

Decision：真实SSR+完整browser路径+人工静态fixture，Domain仅增加纯值leaf。Rationale：元素描述不是DOM，renderer-only bundle不能证明归约器；不复制常量或宽改client/Host。Date/Author：2026-10-01 21:06 CST / 独立评审者。

Decision：本轮只完成已授权文档与draft，不添加迁移兼容或再次要求文档批准。Rationale：用户明确MMP前无真实用户/数据；产品实施和下一门仍由人类选择。Date/Author：2026-10-01 21:06 CST / 主控授权、独立评审记录。

Decision：进入产品实施（U1→U2→U3）。Rationale：人类伙伴 2026-10-02 在会话中明确要求「继续基于本地 worktree 开发 PR#255-#257，目前已有 spec 和 plan」，这就是本计划「产品实施须经人类评审」之门；它不是 Status 或看板写入。Date/Author：2026-10-02 22:05 CST（记录时刻；授权发生在当日会话中）/ 主控转述人类授权。

Decision：依赖按 Ruling 256-1 精确 pin（ui 的 dev react 与 react-dom 均 18.3.1，peer 范围不变）；视觉验收按 256-2 留给主控；包名解析按 256-3 实测；pnpm 10.28.2 按 G2 使用；typecheck 按 G3 是必过门；体量按 G4 逐项核算。Rationale：主控 2026-10-02 裁决，环境事实与计划写作时不同。Date/Author：2026-10-02 22:05 CST / 主控裁决，实施者记录。

Decision：`VisibleListRow` 是 `redacted | item` 联合，item 字段全是 display-ready 文字（标签、规划状态、工程提示、来源、权威），文案表只在 ui-model 一处；每行 `stale` 继承整表结论。Rationale：renderer 不推导；Host 整表降级时没有行能冒充当前值。Superseded by 本节 2026-10-02 22:30 CST 的行新鲜度组合规则：行 stale 改为行自身新鲜度或页面级保守降级。Date/Author：2026-10-02 22:05 CST / 实施者。

Decision：归约优先级为 failure 的明确阻断（permission_denied / not_supported / unknown）→ 读门阻断（reason 取 failure.kind，没有结构化失败则只报 unknown）→ 读取阶段；offline / error 遇读门不允许仍报 offline / error。`unavailable.message` 点名读门与原因类别，`remaining` 写恢复路径，Host 的 `safeMessage` 只追加到 message，content 的 `notice` 只来自 `safeNotice`。Rationale：结构化观察优先于无结构的能力观测，不解析 reason 文字猜权限；计划只给了字段名，这样三类不可用文字互不相同且可测。Date/Author：2026-10-02 22:05 CST / 实施者。文案部分 Superseded by 本节 2026-10-03 第一轮 MVP 评审条（2026-10-03）：读门已观测不可读且没有结构化失败时 reason 仍报 unknown，但说明改为能力已确认不可用、原因未提供，并写出还能做什么；读门未观测与 Host 报 unknown 保留「尚未确认」。

Decision：content 的 0 行不渲染 table：未陈旧且未刷新才是“当前快照没有工作项”，否则只说最后已知的快照没有工作项、当前结果尚未确认；时间在页首与 StaleBanner 显示（页首部分 Superseded by 2026-10-02 22:30 CST 的组合规则：未确认时页首不再声明新鲜度），行内只显示新鲜度文字；`FreshnessBadge.at` 三态（省略 / null = 从未读到 / ISO）。Rationale：避免陈旧 0 行被读成正常 empty，也避免每行重复长 ISO 加宽横向滚动。Date/Author：2026-10-02 22:05 CST / 实施者。

Decision：本地按批次提交 U1 / U2 / U3 与本文档回填共四个提交，不再并成单个 renderer 闭环提交；push 前的序列整理交主控。Rationale：主控要求按批次本地提交，每个提交各自可测试。Date/Author：2026-10-02 22:05 CST / 实施者。Superseded by 本节 2026-10-02 22:45 CST 的验收提交序列。

Decision：行新鲜度 = 行自身新鲜度（既有 `deriveWorkItemList` 的 `freshness.stale`：条目陈旧、断线、缺口 `markAllStale`、从未读到）或页面级保守降级（`refreshing`、Host 给出降级原因 `read.reason`、`degraded` 读门、`failed` 且保行）；`body.stale` = 整表派生结论或页面级降级，`refreshing` 单独标记；页首新鲜度只在已确认内容旁声明，未确认时状态区宣告一次，`StaleBanner` 只带来源与最后读取时间，不重复同一句断言。Rationale：计划“先经既有 deriveWorkItemList 取得行与新鲜度，再根据页面读取过程保守降级”；单条陈旧不拖累其它新鲜行，刷新与降级时没有行或页首冒充当前值（验证 I1 / M2，主控 V2）。Date/Author：2026-10-02 22:30 CST / 实施者。

Decision：`readOnly` / `degraded` 标记由 ui-model 按状态给出，只在为真的状态出现：不可用页两者都为 false，loading 不带 `degraded`（没有值可称保守的最后已知值），只读标记出现在 loading 与 content；renderer 只照 view 渲染。Rationale：权限错误旁的“只读”与 loading 旁的“保守的最后已知值”都不为真（验证 M4）。Date/Author：2026-10-02 22:30 CST / 实施者。

Decision：版式只靠内联 style（renderer 没有样式表）：表头与短标签列（内容身份 / 规划状态 / 工程提示 / 新鲜度）`white-space:nowrap`，标题与来源列 `overflow-wrap:anywhere;min-width:12em`，滚动容器 `role=region`、`tabindex=0`、`overflow-x:auto`，SSR 逐项断言这些 style。Rationale：auto 布局下长标题抢宽、`overflow-wrap:anywhere` 让短列塌成一字，不换行的短列加标题 / 来源的最小宽度后，窄屏出现真正的横向滚动而标题仍换行（主控 V1，实测数字见 Artifacts）。Date/Author：2026-10-02 22:30 CST / 实施者。

Decision：`phase: 'failed'` 缺 `failure` 或 `failure.kind` 不在五类之内一律抛 TypeError；读门已观测时只认三个可读级别，非枚举值同样阻断。Rationale：缺类别的失败不能借缓存保行（Surprises (14)），与非法 phase / 坏时间同属接线缺陷，fail closed；改动只改一处守卫条件，不增加分支。Date/Author：2026-10-02 22:45 CST / 验收 owner。

Decision：延后项处置——M3 按上条修复；M5 的“未知提示”回退保留并补用例（它是线上未知标记的 fail closed，不是死代码）；M1 / M7 与 G1 授权条缺时刻已在修复轮 1 解决；M8 逐文件预算超行按合计裁决接受；V3 不改；N1（只有一条陈旧条目时，状态区写“当前结果尚未确认”而该行之外的行写“当前值”）接受：句子为真，逐行新鲜度正是计划要求的“先取行与新鲜度再保守降级”，若改成点名哪一行陈旧反而可能透出 redacted 条目的状态；N2（0 行陈旧 / 刷新页的状态区与 EmptyState 各说一次“尚未确认”）接受：EmptyState 是后续页面复用的共享组件，脱离状态区单独使用时也必须自带未确认限定，且只有状态区是 live 区域。Rationale：只修会让错误内容上屏的项，其余记录理由，不为措辞改动让已通过的视觉验收失效。Date/Author：2026-10-02 22:45 CST / 验收 owner。

Decision：验收提交序列为本计划提交 617e616 之上的四个提交：feat(ui-model)（domain 纯值 leaf、读取状态投影与 view 契约测试）、feat(ui)（renderer、共享状态组件、精确 pin 的依赖与 SSR 测试）、test(ui)（完整 browser 路径）、docs(exec-plan)（本计划与 `docs/README.md` 索引行）；修复轮 1 与验收改动并入所属批次，不留 fix / fixup 提交，提交说明的 Co-Authored-By 统一为 Claude Opus 5.5。重写前建立本地备份引用 `backup/work-item-list-states-pre-accept`（指向整理前 head 8f5c645），整理后核对文件集合不变、与备份的差异恰为验收改动。索引行状态列由验收 owner 受主控委托如实更新。Rationale：每个提交各自绿（逐个检出跑过窄测与 tsc），评审可按批次读；单一闭环提交过大不便审阅。Date/Author：2026-10-02 22:45 CST / 验收 owner。

Decision：文档允许集最小扩展两处：`docs/adr/ADR-0009-harness-plugin-installable-artifact.md` 的 node:crypto 后果条就地追加订正（ui-model 与 ui 已可按 platform=browser 打包；domain 根出口与 client 根出口仍不能，client 一侧留 #229），不改该 ADR 的决策；`docs/product/vertical-path.md` §2.1 简称表补三个测试简称，第 4 行成功列引 ui-work-item-list-browser「完整路径」、失败列引 ui-work-item-list-view 与 ui-work-item-list 的不可用用例，都标“#129 新增、晚于本节基线”与“旁证：fixture”，结论列不变。两处并入既有 docs(exec-plan) 提交。Rationale：文档如实描述合并后的行为优先于本计划的文件允许集；只改失真的那几行，引用按该节的回读规则逐条实跑（带负对照）。Date/Author：2026-10-03 09:41 CST / 主控裁决，验收 owner 执行。

Decision：2026-10-03 第一轮 MVP 评审：0 × P0/P1，2 × P2 + 3 × P3（另有一条 PR 级设计取舍，见下一条）；人类伙伴规则：只剩 P2/P3 时批准后修复、归档、整合提交、rebase merge。逐条处置，全部采纳：P2 `work-item-list-view.ts` 读门已观测不可读时文案失真——读门判断拆成「未观测」与「已观测不可读」两行，后者没有结构化失败时 reason 仍为 `unknown`（不解析 `CapabilitySnapshotEntry.reason` 猜权限），文案改用独立常量 `GATE_BLOCKED`：「读取工作项的能力（planning.item.read）当前不可用，原因未提供。」「工作区与规划来源仍可查看；读取能力恢复之前不显示条目，也不显示此前的缓存。」；该常量不进 `UNAVAILABLE` 表，因为那张表同时是 `failure.kind` 的合法值集合。P2 `ui-work-item-list.test.js` 的 `remaining` 无断言——SSR 抽出不可用页的两段文字，对七个不可用场景（五类失败、读门已观测不可读、读门未观测）逐一断言 message 与 remaining，view 断言六种不可用说明的 message 与 remaining 都非空且两两不同，并把评审者的三条变异补进变异表。P3 `hasReceivedSnapshot` / `refreshing` 的运行时校验——并入既有守卫：`received` 要求布尔 `refreshing`，`failed` 要求布尔 `hasReceivedSnapshot` 且 `cacheVisibility` 为两值之一，否则 TypeError。P3 `docs/README.md` 索引行——归档时移入 Completed 表的表首（同日期内后完成者在上，与 #251 / #253 两行对齐），结论列不写易失状态。P3 本计划 `Concrete Steps` 的「不能把当前草案当产品实施授权」——就地标注 Superseded。Rationale：P2 两条都落在 #129 验收第 3 条（「names the capability and what is still possible」）与 PR 描述「说明恢复路径」上，是用户可见行为与其证据；P3 的守卫与已有 fail closed 口径一致，改动都是机械的且不削弱验证（`docs/review/responding.md` §3）。Date/Author：2026-10-03 11:10 CST / 评审修复实施者（主控委派），评审结论来自评审账号。

Decision：2026-10-03 修复复评（第二轮）的 P3 就地修复，不留到后续：unknown 的第二段补上仍可做的事（「工作区与规划来源仍可查看；」），使测试标题、索引行与 Outcomes 里「每类都写出还能做什么」与实际文字一致；SSR 对七个不可用页断言说明与 remaining 都不含「仍会显示 / 但会显示 / 会显示此前的缓存」，`gateUnavailable` 的正则延伸到「也不显示此前的缓存」。Rationale：上一轮 P2 的「写反」判据只对 permission 成立，新文案与其余四类同样需要；改动是文案一处加测试三处，机械且不改状态优先级。Date/Author：2026-10-03，评审主控（Claude）。

Decision（开放问题，待人类裁决；本轮不改代码）：陈旧的只有一条 redacted 条目时，整页状态区写「当前结果尚未确认」并显示横幅，可见行都写「当前值」，读者由此能推出陈旧的是某个不可见条目——间接透露了被遮蔽条目的新鲜度。复现（变基后的 head 上同样成立）：redacted 的 e0 自身陈旧、可见的 e1 新鲜，`rows [["e0",null],["e1",false]]`、`stale: true`、状态区「当前结果尚未确认，最后已知值不是当前值」。它与上文 2026-10-02 22:45 已接受的 N1 同类，但 N1 的理由（改成点名哪一行陈旧可能透出 redacted 条目的状态）恰好说明现状本身也透出了 1 bit。候选：(A) 维持现状——句子为真，逐行新鲜度是本计划「先取行与新鲜度再保守降级」的要求，透露的只是「至少一个不可见条目陈旧」，不含身份、内容或原因；(B) 整表陈旧只按可见行与页面级降级计算——不再透露，但「已读取当前快照」会把含陈旧条目的快照称为当前，违背「没有行能冒充当前值」的口径；(C) 有 redacted 条目陈旧时把整页按页面级降级处理，所有可见行写「最后已知值」——与 Host 降级原因造成的页面降级在页面上不可区分，代价是新鲜的可见行也标成最后已知值（保守、fail closed）。这改变 #129 已验收的新鲜度展示，并牵涉 redaction 的信息披露边界，属于产品取舍，交人类伙伴裁决；裁决之前代码保持 (A)。不登记 `docs/exec-plan/tech-debt-tracker.md`：它是未裁决的设计候选，不是已接受延期的维护债务（`docs/README.md` §1 的目录职责表把前者排除在 tracker 之外）。Rationale：评审把它列为 P3 设计取舍、不发 inline，并明确需要人类裁决；实施者不替人类做披露边界的选择。Date/Author：2026-10-03 11:10 CST / 评审修复实施者记录，裁决人待定（人类伙伴）。

Decision：评审修复的提交整理——变基后的五个提交保持「计划提交 + 三个代码提交 + 文档提交」的形状：修复按交付物并入 feat(ui-model)（归约器守卫与文案、view 测试）与 feat(ui)（SSR 测试的两个新场景与逐段断言），test(ui) 不变；计划提交只把索引行挪到 Active 表尾、状态写成「Active，进度见计划 Progress」，最后的 docs(exec-plan) 提交含回填、归档、索引行改入 Completed 表、ADR-0009 与纵向路径两处订正。重写前的恢复锚点是本地备份引用 `backup/work-item-list-states-pre-review1`（指向评审时的 head 62fd53e）。Rationale：每个提交各自可回滚、各自 `pnpm verify` 为绿；评审按批次读过这五个提交，形状不变便于复评做 range-diff。Date/Author：2026-10-03 11:10 CST / 评审修复实施者。

## Idempotence and Recovery

纯投影同输入同输出，不修改EntityStore，不保存第二份last-good、不改规划状态。相同row key稳定，重新SSR不会创建资源。fixture输出只替换指定临时HTML，不能删除其他工作树或依赖目录；没有数据迁移/旧用户恢复问题。

产品实现回滚以完整renderer闭环提交revert（Superseded by Decision Log 2026-10-02 22:45 CST 验收提交序列：按 test(ui) → feat(ui) → feat(ui-model) 逆序 revert 三个代码提交），撤出口/leaf import与相应依赖锁变化，不修改Host或平台。若输入不能由未来Host提供，保持fixture contract并把装配缺口交#178/#229，不在#129私加API、transport或业务状态。

依赖缺失就记环境门未通过，在受控pinned环境准备后重跑；不反复调用本机pnpm自动安装，不用mock/skip。若引入hook、交互或需要DOM框架，先更新本计划和预算；不能继续用静态SSR宣称动态行为正确。

## Interfaces and Dependencies

新输入owner为ui-model，观察owner为Host/未来壳，渲染owner为ui；key只内部使用，metadata只安全文字。现有WorkspaceRead/EntityStore与domain常量是输入接口，不虚构当前Host displayName/读取失败API。新增./values是domain叶子出口，无反向依赖，既有root对象与leaf对象身份相同。

React18.3.1/ReactDOM18.3.1及既有esbuild0.28.2分别从所属manifest createRequire解析，避免根测试JS误用另一个React副本。独立test entry必须指向当前树；若meta解析到其他检出，停止验收。真实装配不会由bundle passing自动获得证明。

未来在本分支根回读 `gh pr view -R SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup` 及 `gh issue view 129 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences`。期望draft、base=main、双向关联仅#129；主控另读reviewThreads和实际checks。只投影已有issue/milestone/iteration及授权非Status机械字段，不写Status或原生blocking。

## Outcomes & Retrospective

当前产物为可审阅的spec+plan；产品code/test/dependency变动0，新SSR/bundle/build未执行。只有基线29条纯Node测试作为旧模型诊断，不能称列表renderer通过。Superseded by 本节下文的 2026-10-02 实施结果。2026-10-02 06:49 CST完成最终磁盘审读、13项预算求和与专用lint；主控公开面与发布结果按实际补录。

2026-10-02 22:05 CST 实施结果：U1/U2/U3 在本分支本地完成（不 push）。新增 `deriveWorkItemListView`、domain `./values` leaf、`WorkItemListPage` 与六个共享状态组件；新用例 view 10 / SSR 9 / browser 2 全部通过，`pnpm run verify` 930 + 7 通过，tsc exit 0（Superseded by 修复轮 1：view 11 / SSR 11 / browser 2，`pnpm run verify` 933 + 7）。与计划的偏差：逐文件体量不同、行 stale 先继承整表（修复轮 1 改为行自身或页面级降级）、Unavailable / Empty 的 props 形状为本轮决定。未完成：320/768/1200 人工视觉验收（主控）、真实 Host 装配、动态播报、push 与 PR 回读。修复轮 1 后的体量与结果见 Artifacts and Notes。没有新增技术债条目，未改 `docs/exec-plan/tech-debt-tracker.md`；`WorkItemListReadInput` 目前只有 fixture 提供者，真实 Host 的读取阶段、失败类别与安全元数据由 #178/#229 提供。

遗留是#178/#229实际Host生命周期/安全metadata/真实DOM挂载与动态播报，以及未触达client.store构造的browser装配；不扩大本PR解决。实施若新增维护债务，在本计划写明并按根规则登记 `docs/exec-plan/tech-debt-tracker.md`，当前不改tracker或旧计划。MMP前无数据不免除本renderer当前redaction与读取真实性要求。

2026-10-02 22:45 CST 验收结果：#129 五条验收与本计划 Validation 表逐行有代码与用例证据（视觉行由主控实测，见 Artifacts）；验收轮修复 failed 缺 failure 时借缓存保行的 fail open，简化读门判断，补 4 处守卫用例，删 2 处同路径同不变量的重复断言，code+tests 691（观察时刻，见 Artifacts）。与计划的偏差仍是逐文件体量与提交数量；遗留：真实 Host 装配、动态播报与真实 DOM（#178/#229），ADR-0009 后果条与纵向路径证据列的更新（Surprises (16)；Superseded by Decision Log 2026-10-03 09:41 CST：已在本 PR 内订正），人类评审、push 与 PR 回读。

2026-10-03 第一轮 MVP 评审与归档结果：评审 APPROVE，0 × P0/P1；两条 P2 与三条 P3 全部按根因修复，#129 验收第 3 条的后半句（「what is still possible」）现在对读门已观测不可读的场景也成立，所有不可用说明的恢复路径都有判别断言；缓存门上的四个输入字段都响亮失败。与计划的偏差：fixture 增至 22 个场景（两个新增的都是不可用页，没有表格），没有重新做 320 / 768 / 1200 视觉验收；code+tests 体量见 Artifacts。遗留：真实 Host 装配、动态播报与真实 DOM（#178 / #229）；一条待人类裁决的设计取舍（Decision Log 2026-10-03 开放问题：只有 redacted 条目陈旧时整页未确认而可见行写当前值）；push、回读与合并由主控执行。没有新增技术债条目，未改 `docs/exec-plan/tech-debt-tracker.md`。

## Concrete Steps

现在重开保存文件执行八问语义审读、逐项预算和技能lint后冻结，由主控独立维护README/公开面/draft。后续U1→U2→U3记录当前head/base、真实失败原因、环境门、red→green与fixture截图；scope变化改本计划，不能把当前草案当产品实施授权。Superseded by Decision Log 2026-10-02 22:05 CST 的实施授权条（2026-10-03 第一轮 MVP 评审补标）。

## Artifacts and Notes

观察上下文（2026-10-02 06:58 CST）：检出 `feature/work-item-list-states`、基线如Context所示的文档工作树；技能lint为OK，`node --test tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js` 为9 passed/0 failed。本次仅计划与索引，最终体量重算 `git diff --numstat origin/main...HEAD`；独立评审、组件实施与实际Host验收是不同证据。

证据使用仓库相对路径、检出分支/观察head、命令和小段结果，不发布本地研究包或本机绝对路径。SSR HTML、browser metafile与static fixture证明各自边界；元素树、vm、静态HTML、真实DOM与真实Host验收不混称。损坏sourceName或隐藏row canary只用合成数据。

实施证据（2026-10-02 22:06 CST；在检出 `feature/work-item-list-states` 的工作树根目录 `.worktrees/work-item-list-states` 运行；起点 head 617e616，base df199a5；代码提交序列 6cdf072 → 090ba3a → e620f30，其后是本文档回填提交（整理前的本地提交，Superseded by 本节验收证据段的整理后序列），回读 `git log --format='%h %s' 617e616..HEAD`）：

- 包解析（Ruling 256-3）：`node --input-type=module -e "…import.meta.resolve(name)…realpathSync"` 对 `@harness-projects/ui-model`、`ui`、`domain`、`client` 均得到 `.worktrees/work-item-list-states/packages/<pkg>/src/index.ts`；`react@18.3.1`、`esbuild@0.28.2` 经 createRequire 解析到本工作树 `node_modules/.pnpm`。
- 依赖（Ruling 256-1）：`pnpm --filter @harness-projects/ui add -D --save-exact react@18.3.1 react-dom@18.3.1`（pnpm 10.28.2）。锁文件审计：`git diff --numstat -- pnpm-lock.yaml` 为 22 / 1，变化只有 ui importer 的 react specifier `^18.3.1`→`18.3.1`、新增 react-dom 18.3.1（peer `react ^18.3.1`）及其传递依赖 scheduler 0.23.2，其余包版本零变化；随后 `pnpm install --frozen-lockfile --offline` 通过。
- U1 RED：`node --test tests/contract/ui-work-item-list-view.test.js` 对“按行数猜状态并复制词表”的朴素桩，tests 10 / pass 0 / fail 10：permission_denied 带授权缓存仍输出 content（`actual [ 'content', undefined, true ]`，`expected [ 'unavailable', 'permission_denied', false ]`）；offline 保行用例 stale 为 false；leaf 同一引用断言 `AssertionError: AccessLevel`。GREEN：同命令 10 / 10。
- U2 RED：对“0 行就写暂无工作项、没有状态区”的朴素 renderer 桩，`node --test tests/contract/ui-work-item-list.test.js` 为 tests 9 / pass 3 / fail 6：loading 输出 `<table><caption>暂无工作项</caption><tbody></tbody></table>` 缺 `/正在首次读取工作项/`，permission 缺权限说明，陈旧缺横幅，转义缺 `&lt;img`。先绿的三个是出口、泄漏面（桩本身不泄漏）与 fixture，泄漏断言的牙由下表变异证明。GREEN：9 / 9。
- U3：browser 测试先绿，红由变异 B1–B3 产生：任一 ui-model 运行时 import 改回 domain 根出口，构建报 `packages/domain/src/ids.ts:2:27: ERROR: Could not resolve "node:crypto"`；负控用例自身通过（构建失败被捕获）。
- 变异核对：每次先打印被改的行再跑三份新测试，还原用 `cat 备份 > 文件`；变异脚本留在 `$TMPDIR`，不入库。全部被杀死，M11 在原断言下存活，见 Surprises (7)，加强断言后被杀死。

| 变异 | 被杀死的用例（节选） |
|---|---|
| M1 去掉明确阻断分支；M10 读门不可用猜成 permission | 权限 / 不支持 / 未知不借缓存；不可用 SSR；首次读取 |
| M2 忽略 cacheVisibility | offline / error 保行；不可用 SSR |
| M3 pending 且读门未观测不再 loading；M9 按行数猜 pending | 首次读取（view 与 SSR） |
| M4 redacted 行不遮蔽 | redacted 只剩占位；陈旧保行；泄漏面；内容 |
| M5 failed 不算陈旧；M6 degraded 不保守；M7 行 stale 只取既有行 | offline / error；degraded；陈旧 / 断线（hostDegraded 断言） |
| M8 横幅 notice 取 list.reason | redacted 占位；泄漏面（含 CANARY-REASON）；转义 |
| M11 继承键 / M12 非字符串值当来源名 | 可见行 |
| R1 empty 恒 confirmed；R3 状态区放进 busy 容器；R4 redacted 其它单元格为空；R5 skeleton 对辅助技术可见；R6 badge 丢 time 元素 | 真 empty；内容；首次读取；陈旧 / 刷新 |
| R2 行 key 进 aria-label | 泄漏面 |
| B1 / B2 / B3 derive、capability-access、page view 走 domain 根出口 | 完整路径（browser） |

Validation 命令与结果（代码 head e620f30，期望 exit 0、无 skip）：

| 命令 | 结果 |
|---|---|
| `node --test tests/contract/ui-work-item-list-view.test.js tests/contract/ui-model-presentation.test.js` | 31 / 31 |
| `node --test tests/contract/ui-work-item-list.test.js` | 9 / 9 |
| `node --test tests/contract/ui-work-item-list-browser.test.js tests/contract/package-boundaries.test.js` | 10 / 10 |
| `node_modules/.bin/tsc --noEmit` | exit 0 |
| `node --test tests/integration/harness-plugin-artifact.test.js` | 20 / 20 |
| `UI_FIXTURE_OUT="$TMPDIR/work-item-list-fixtures.html" node --test tests/contract/ui-work-item-list.test.js` | 9 / 9，写出 20399 字节静态 HTML，不入库 |
| `node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` | 9 / 9 |
| `pnpm run verify`（typecheck + 全部契约 / 集成 / e2e + mvp0） | exit 0，930 + 7 通过 |
| `node scripts/workflow-check.mjs` | no findings |
| `node scripts/rule-checks.mjs disclosure df199a59220cfc32d6cc734116c55b38eec7abd6` | 机械扫描通过；五类人工目检见下 |
| `node scripts/rule-checks.mjs size df199a59220cfc32d6cc734116c55b38eec7abd6` | 见下文体量段 |
| `git diff --check df199a59220cfc32d6cc734116c55b38eec7abd6...HEAD` | exit 0 |

体量（`git diff --numstat df199a59220cfc32d6cc734116c55b38eec7abd6...HEAD`，added+deleted，观察时刻 22:06 CST）：work-item-list-view.ts 157、ui-work-item-list-view.test.js 153、ui-work-item-list.test.js 146、ui-work-item-list-browser.test.js 66、work-item-list.ts 55、list-states.ts 38、browser-values.ts 6、domain/package.json 3、ui/package.json 3、ui/src/index.ts 2、derive.ts 2、capability-access.ts 2、ui-model/src/index.ts 1；code+tests 合计 634，预算 786 / 硬限 800（余 152 行）。锁文件 22+1 豁免计数。人工五类目检：diff 与提交信息只含合成 canary、仓库内相对路径与 `$TMPDIR` 占位，没有凭据、本机路径与身份、账号信息、内部系统或保密字样。

静态 fixture：用上表第 6 条命令生成，页面按 loading、empty、content、stale、refreshing、degraded、readOnly、五类不可用等场景拼成一份文档（含超长标题 / 来源名），供主控在 320 / 768 / 1200 宽度检查横向滚动与键盘 focus；实施者没有打开浏览器，视觉验收未勾选。

修复轮 1 证据（2026-10-02 22:30 CST；同一检出 `feature/work-item-list-states`、工作树根目录 `.worktrees/work-item-list-states`，在 87ce6a0 之上（整理前的本地提交）；评审输入是对抗验证报告与主控的 320 / 768 / 1200 目视记录，均在 `.superpowers/` 下，不入库）：

- 先红后绿（先只改测试）：`node --test tests/contract/ui-work-item-list-view.test.js` → tests 11 / pass 9 / fail 2：行新鲜度 `actual [ [ true, true ], true ]` 对 `expected [ [ false, true ], true ]`（整表继承抹掉逐行差异）；degraded 标记 `actual [ false, true, 'loading' ]` 对 `expected [ false, false, 'loading' ]`。实现逐行组合后仍红在刷新：`actual [ [ false ], [ true ], [ true ], [ true ] ]` 对 `expected [ [ true ], [ true ], [ true ], [ true ] ]`（I1）；补入 `refreshing` 后 11 / 11。`node --test tests/contract/ui-work-item-list.test.js` → tests 11 / pass 8 / fail 3：状态区与横幅重复宣告（`actual 2`，`expected 1`）、页首与行未避开“当前值”、版式 style 缺失（`actual []`）；实现后 11 / 11。I2（pending 带非空 store）、I3（refreshing 零行）与缺口用例对当时实现本来就绿，是补上的守卫，价值由下表变异证明。
- 变异补测（沿用先打印变异行再跑三份新测试、`cat 备份 > 文件` 还原的做法，脚本留在 `$TMPDIR`）：验证者的存活者 A1 / A2 / A6 / A7 / C4 / C5 现在全部被杀死，新增变异也全部被杀死。

| 变异 | 被杀死的用例（节选） |
|---|---|
| A1 pending 且 store 非空时显示行 | 首次读取（view 与 SSR 的 pendingFilled） |
| A2 refreshing 零行退回 skeleton | 真 empty；陈旧 / 刷新；陈旧 / 断线 / 缺口 / 刷新（view） |
| I1 刷新时行不标陈旧；M2 忽略行自身新鲜度；M2b 单条陈旧拖累所有行 | 行新鲜度组合（view）；陈旧 / 刷新 / 降级 / 缺口（SSR） |
| Host 降级原因不再降级行；degraded 读门不再降级页；failed 保行不再降级 | 行新鲜度组合；offline / error；degraded 标记 |
| M4a 不可用页带标记；M4b loading 带 degraded | 标记只在为真的状态出现（view 与 SSR） |
| A6 loading 无 aria-busy；A7 横幅丢未知时间回退 | 首次读取；内容 |
| C4 滚动容器无 tabindex；C5 无 overflow-x | 版式 |
| V1a 表头可换行；V1b 标题 / 来源无最小宽度；V1c 短列可换行 | 版式 |
| 页首恒声明新鲜度；V2 横幅重复断言 | 内容；陈旧 / 刷新 / 降级 / 缺口 |
| R2 行 key 进 aria-label | 泄漏面 |

- 浏览器宽度预检（只是实施者自查，验收仍归主控）：用本地静态 http 服务打开 fixture（`UI_FIXTURE_OUT` 输出的文件），在浏览器 pane 里量。320px：整页 `scrollWidth` 320 等于视口，无整页横向滚动；各表的滚动容器 `scrollWidth` 640–667 大于 `clientWidth` 288，即真正横向滚动；表头与首行单行（高 26px），短列宽 71 / 71 / 71 / 57px，标题与来源列 185px，超长标题行换行（高 191px）。768px 与 1200px：容器 `scrollWidth` 等于 `clientWidth`，短列仍 71 / 71 / 71 / 57px，标题 / 来源 231 / 234px（768）与 441 / 457px（1200），表头单行。

Validation 命令与结果（修复轮 1，工作树含本次修复，期望 exit 0、无 skip）：

| 命令 | 结果 |
|---|---|
| `node --test tests/contract/ui-work-item-list-view.test.js tests/contract/ui-model-presentation.test.js` | 32 / 32 |
| `node --test tests/contract/ui-work-item-list.test.js` | 11 / 11 |
| `node --test tests/contract/ui-work-item-list-browser.test.js tests/contract/package-boundaries.test.js` | 10 / 10 |
| `node_modules/.bin/tsc --noEmit` | exit 0 |
| `node --test tests/integration/harness-plugin-artifact.test.js` | 20 / 20 |
| `UI_FIXTURE_OUT="$TMPDIR/work-item-list-fixtures.html" node --test tests/contract/ui-work-item-list.test.js` | 11 / 11，写出 25501 字节静态 HTML，20 个场景，不入库 |
| `pnpm run verify` | exit 0，933 + 7 通过 |

体量（观察时刻 22:30 CST，`git diff --numstat df199a59220cfc32d6cc734116c55b38eec7abd6`，added+deleted）：work-item-list-view.ts 156、ui-work-item-list.test.js 180、ui-work-item-list-view.test.js 176、ui-work-item-list-browser.test.js 66、work-item-list.ts 60、list-states.ts 37，其余 7 个文件与前述相同；code+tests 合计 694，预算 786 / 硬限 800。提交后（HEAD 为修复提交）重跑：文档契约 9 / 9；disclosure 机械扫描通过；size 代码 694 / 1000、文档 389 / 1500；`git diff --check` exit 0；`node scripts/workflow-check.mjs` no findings。

验收证据（2026-10-02 22:45 CST；在检出 `feature/work-item-list-states` 的工作树根目录 `.worktrees/work-item-list-states` 运行；整理前 head 8f5c645。代码门在整理后最后一个代码提交上跑，文档门与发布面检查在整理后 head 上跑。整理后序列回读 `git log --format='%h %an %s' 617e616..HEAD`，期望 4 个提交、作者均为 SingularityKChen、没有 fix / fixup；上文 6cdf072 / 090ba3a / e620f30 / 87ce6a0 / 8f5c645 只留在本地备份引用 `backup/work-item-list-states-pre-accept` 的历史里，不会出现在远端）：

- 简化与守卫：`packages/ui-model/src/work-item-list-view.ts` 156 → 154 行。读门判断由两个析取式的合取（3 行）改为按“读门是否已观测”二分的一行条件；单次使用的来源名缺省常量内联；failed 守卫改为“phase 为 failed 就必须带五类之一的 failure”。`tests/contract/ui-work-item-list-view.test.js` 176 → 174 行：删两处同路径同不变量的重复断言（ISO 原样透出已由首个用例的整体 deepEqual 覆盖；读门 key 由测试常量等于 `CapabilityKey.PlanningItemRead` 加首个用例的 received → content 传递钉住，变异 MF 为证），补“缺 failure 抛错”“读门非枚举值阻断”“未知标记显示未知提示且不透原值”。`tests/contract/ui-work-item-list.test.js` 180 → 181 行：补“不可用页仍显示工作区与规划来源”。`packages/ui/**` 未改（`git diff 8f5c645 -- packages/ui` 为空）。
- 整理核对：`git diff backup/work-item-list-states-pre-accept HEAD -- packages tests pnpm-lock.yaml` 去掉 index 行后与验收改动补丁逐行相同；`comm` 比对 `git diff --name-only 617e616..backup/work-item-list-states-pre-accept` 与 `617e616..HEAD` 两份文件列表，无增无减；三个代码提交逐个 detached 检出后，三份新测试（按该提交已有的）加 ui-model-presentation 与 package-boundaries 分别 40 / 51 / 53 全过，tsc 均 exit 0。

| 变异（验收轮，均被杀死） | 打印出的变异行（节选） | 失败用例 |
|---|---|---|
| MA 读门非枚举值当可读 | `: access === AccessLevel.Unavailable) return` | permission / unsupported / unknown 不借缓存 |
| MB 读门未观测时 pending 也不等候 | `access === undefined ? true :` | 首次读取（view 与 SSR） |
| MC 读门未观测在收到快照后当可读 | `access === undefined ? false :` | offline / error；不借缓存 |
| MD failed 缺 failure 放行（旧守卫） | `if (failure !== undefined && !Object.hasOwn(UNAVAILABLE, failure.kind))` | 接线 |
| ME 未知标记透出原值 | `pick(HINTS, flag) ?? flag` | 可见行 |
| MF 实现的读门 key 漂移 | `const READ_KEY = 'planning.item.list'` | 17 / 22 |
| MG 不可用页隐去页首元信息 | `body.kind === 'unavailable' ? null : createElement('p', …` | 不可用 |
| MH 来源名缺省回退 bindingId | `?? primary?.bindingId ?? '来源名称未提供'` | 可见行 |

| 命令（验收轮） | 结果 |
|---|---|
| `node --test tests/contract/ui-work-item-list-view.test.js tests/contract/ui-model-presentation.test.js` | 32 / 32 |
| `node --test tests/contract/ui-work-item-list.test.js` | 11 / 11 |
| `node --test tests/contract/ui-work-item-list-browser.test.js tests/contract/package-boundaries.test.js` | 10 / 10 |
| `node --test tests/contract/ui-work-item-list-view.test.js tests/contract/ui-model-presentation.test.js tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-browser.test.js tests/integration/harness-plugin-artifact.test.js` | 65 / 65 |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| `pnpm run boundaries`（issue 验收条） | 8 / 8；`packages/ui/src` 的 import 只有 `react`、`./list-states.ts` 与 ui-model 的 type-only 引用 |
| `pnpm verify` | exit 0，933 + 7 |
| `UI_FIXTURE_OUT="$TMPDIR/work-item-list-fixtures.html" node --test tests/contract/ui-work-item-list.test.js` | 11 / 11，25501 字节、20 个场景；与 8f5c645 生成的 fixture `cmp` 逐字节相同 |
| `pnpm install --frozen-lockfile --offline` | exit 0；锁文件 diff 仍只有 react specifier、react-dom 18.3.1 与 scheduler 0.23.2（+22 / −1） |
| `node --test tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js` | 9 / 9 |
| `node scripts/workflow-check.mjs` | no findings |
| `node scripts/rule-checks.mjs disclosure df199a59220cfc32d6cc734116c55b38eec7abd6` | 机械扫描通过；五类人工目检：只有合成 canary、仓库相对路径与 `$TMPDIR` 占位 |
| `node scripts/rule-checks.mjs size df199a59220cfc32d6cc734116c55b38eec7abd6` | 代码 691 / 1000，文档 438 / 1500 |
| `git diff --check df199a59220cfc32d6cc734116c55b38eec7abd6...HEAD` | exit 0 |

- 视觉（主控 2026-10-02 22:29 CST 在 8f5c645 实测，浏览器 pane 经本地静态服务打开 fixture；记录的是数值与 head，不是入库截图）：320px 下每个表的滚动容器 clientWidth 288 / scrollWidth 640–667、tabindex 0、overflow-x auto，六个表头单行（26px），整页 scrollWidth 320 等于视口；Tab 聚焦滚动容器且 `:focus-visible` 有可见轮廓。768 / 1200px 表格放得下（736 / 736、1168 / 1168），表头单行，长标题与来源在最小宽度内换行。文字上刷新页的行写“最后已知值”，陈旧页只有一次状态宣告加一条横幅。
- 体量（观察时刻 2026-10-02 22:45 CST，`git diff --numstat df199a59220cfc32d6cc734116c55b38eec7abd6...HEAD`，added+deleted）：work-item-list-view.ts 154、ui-work-item-list.test.js 181、ui-work-item-list-view.test.js 174、ui-work-item-list-browser.test.js 66、work-item-list.ts 60、list-states.ts 37、browser-values.ts 6、domain/package.json 3、ui/package.json 3、ui/src/index.ts 2、derive.ts 2、capability-access.ts 2、ui-model/src/index.ts 1；code+tests 691，预算 786 / 硬限 800。文档：本计划 437、索引行 1，合计 438，预算 1300（本计划单文件超出 420 的规划行，按合计裁决）。锁文件 +22 / −1 豁免计数，已人工审计。

- 主控裁决后的补充（观察时刻 2026-10-03 09:41 CST，同一检出与分支）：vertical-path 新引用按 §2.1 的回读命令（直接运行文件、`--test-name-pattern`、spec 报告）逐条实跑，ui-work-item-list-browser「完整路径」、ui-work-item-list-view「permission / unsupported / unknown 不借缓存」、ui-work-item-list「不可用：权限 / 不支持 / 未知 / 离线 / 错误说明各不相同」各读回一行 ✔、`ℹ tests 1`、`ℹ fail 0`，负对照均为 `ℹ tests 0` 且无 ✔；ADR 订正的四条打包事实用 esbuild（platform=browser、只外置 react）对 domain 根出口、`@harness-projects/domain/values`、ui-model、ui 与 client 根出口逐个实测。文档体量（增删之和）随之变为本计划 444、索引行 1、ADR-0009 4、vertical-path 4，合计 453 / 1500（`node scripts/rule-checks.mjs size df199a59220cfc32d6cc734116c55b38eec7abd6` 回读）；代码 691 不变。

第一轮 MVP 评审修复证据（2026-10-03；在检出 `feature/work-item-list-states` 的工作树根目录 `.worktrees/work-item-list-states` 运行；评审时 head 62fd53e，本地备份引用 `backup/work-item-list-states-pre-review1`；先 `git rebase origin/main` 到 `main@d008132`，冲突解法见 Progress；评审意见原文与修复回复草稿在 `.superpowers/review1/`，不入库）：

- 复现（变基后、修复前）：评审者的三段 `node --input-type=module` 探针逐字复现——读门已观测 `unavailable` 与读门未观测都输出 `unknown | 尚未确认读取工作项的能力（planning.item.read）。 | 确认之前不显示条目，也不判断是否有工作项。`；`hasReceivedSnapshot: 'false'` → `content 1`；缺 `refreshing` → 状态区「已读取当前快照，共 1 项」、`row.stale` 与 `body.refreshing` 为 `undefined`。
- 先红（只改测试）：`node --test --test-timeout=120000 tests/contract/ui-work-item-list-view.test.js` → tests 12 / pass 9 / fail 3：读门已观测不可读 `actual '尚未确认读取工作项的能力（planning.item.read）。'` 对 `expected /当前不可用，原因未提供/`；六种不可用的 remaining 去重后 `actual 5` 对 `expected 6`；`hasReceivedSnapshot: 'false'` 时 `Missing expected exception (TypeError)`。`node --test --test-timeout=120000 tests/contract/ui-work-item-list.test.js` → tests 11 / pass 10 / fail 1：读门已观测不可读的整页 HTML 仍含「尚未确认」。
- 转绿：`node --test --test-timeout=120000 tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/ui-model-presentation.test.js` → 47 / 47；`node node_modules/typescript/bin/tsc --noEmit` exit 0；修复后探针输出 `observed-unavailable | unknown | 读取工作项的能力（planning.item.read）当前不可用，原因未提供。 | 工作区与规划来源仍可查看；读取能力恢复之前不显示条目，也不显示此前的缓存。`，未观测仍是「尚未确认」，两种畸形标记都抛 TypeError。
- 变异（先 WIP 提交；每个变异前断言 `git diff --quiet`，只做一处精确替换，先打印 `git diff -U0` 的被改行确认生效，再跑上一条的四份测试，`git checkout --` 还原后再断言干净；脚本在 `.superpowers/review1/`）。评审者在 62fd53e 上的对照：R2、R3 两份测试 22 / 22 存活，R4 四份新测试加 ui-model-presentation 45 / 45 存活。修复后全部被杀死：

| 变异 | 打印出的变异行（节选） | 失败用例（47 条中） |
|---|---|---|
| R1 permission 的 remaining 置空 | `permission_denied: [… , '']` | 不可用的恢复路径；不可用（SSR） |
| R2 全部 remaining 置空（评审者写法） | `[message] = UNAVAILABLE[reason], remaining = ''` | 同上 |
| R3 permission 的说明改成「此前的缓存仍会显示」 | `… , '此前的缓存仍会显示。'` | 不可用（SSR） |
| R4 renderer 不渲染 remaining | `createElement('div', null, createElement('p', null, message))` | 不可用（SSR） |
| G1 读门已观测不可读退回「尚未确认」 | `… : unavailable('unknown')` | 不借缓存（view）；恢复路径；不可用（SSR） |
| G2 读门已观测不可读的 remaining 不写还能做什么 | `GATE_BLOCKED = [… , '确认之前不显示条目，也不判断是否有工作项。']` | 恢复路径；不可用（SSR） |
| G3 读门未观测也说「当前不可用」 | `access === undefined && … ? … : unavailable('unknown', GATE_BLOCKED)` | 不借缓存（view）；不可用（SSR） |
| G4 读门已观测不可读猜成权限拒绝 | `… : unavailable('permission_denied')` | 首次读取；不借缓存；恢复路径；不可用（SSR） |
| B1 / B2 / B3 去掉 `hasReceivedSnapshot` / `refreshing` / `cacheVisibility` 校验 | `: ['authorized', 'unknown'].includes(…)`、`? true`、`typeof input.hasReceivedSnapshot === 'boolean')` | 接线 |

- R3 只被 SSR 用例杀死：view 测试按评审建议只断言 remaining 非空且两两不同，语义由 SSR 的逐段正则钉住。

修复复评（第二轮）P3 的修复证据（2026-10-03 12:10 CST；同一检出；先 WIP 提交，每个变异前断言 `git diff --quiet`，打印 `git diff -U0` 的被改行确认生效，跑上述四份测试后 `git checkout --` 还原；基线 47 / 47）：

| 变异 | 打印出的变异行（节选） | 结果（47 条中） |
|---|---|---|
| V1 `GATE_BLOCKED` 缓存子句写反 | `… 读取能力恢复之前不显示条目，但仍会显示此前的缓存。` | 红 1（不可用 SSR） |
| V2 not_supported 追加相反承诺 | `… 请改用支持读取的来源；此前的缓存仍会显示。` | 红 1 |
| V3 unknown 写反 | `… 确认之前不显示条目，但会显示此前的缓存。` | 红 1 |
| V4 offline 追加相反承诺 | `连接恢复后会重新读取；此前的缓存仍会显示。` | 红 1 |
| V5 unknown 退回旧文案（不写还能做什么） | `'确认之前不显示条目，也不判断是否有工作项。'` | 红 1 |

修复前 V1–V4 在复评者的独立检出上都是 47 / 47 存活（复评者的一次性检出未入库，结论见 PR #256 的第二轮复评）。

Validation 命令与结果（评审修复轮，观察时刻 2026-10-03 11:12 CST；整理后的五个提交，回读 `git log --format='%h %an %s' origin/main..HEAD`，期望 5 个提交、作者均为 SingularityKChen、没有 wip / fixup）：

| 命令 | 结果 |
|---|---|
| `pnpm verify`，五个提交逐个 detached 检出 | 均 exit 0；typecheck 通过，契约 / 集成 / e2e 依次 1008、1020、1031、1033、1033 条全过，mvp0 7 条全过 |
| `pnpm run boundaries` | 8 / 8 |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| `node scripts/workflow-check.mjs` | no findings |
| `node --test --test-timeout=120000 tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js` | 9 / 9 |
| `UI_FIXTURE_OUT="$TMPDIR/work-item-list-fixtures.html" node --test --test-timeout=120000 tests/contract/ui-work-item-list.test.js` | 11 / 11，26373 字节、22 个场景，不入库；新增的两个场景都是不可用页（无表格），没有重新做视觉验收 |
| `docs/product/vertical-path.md` §2.1 的回读命令，第 4 行的三条 #129 引用 | 各一行 ✔、`ℹ tests 1`、`ℹ fail 0`；负对照 `ℹ tests 0`、无 ✔；块 exit 0 |
| `node scripts/rule-checks.mjs size origin/main` | 观察时刻：代码 726 / 1000（弹性 800 之内），文档 509 / 1500（弹性 1300 之内）；重算即回读同一命令 |
| `node scripts/rule-checks.mjs disclosure origin/main` | 机械扫描通过；五类人工目检：只有合成 canary、仓库相对路径、`$TMPDIR` 占位与公开仓库名，没有凭据、本机绝对路径、账号个人信息、内部系统或保密字样 |
| `git diff --check origin/main...HEAD` | exit 0 |
| 提交正文的关闭关键字扫描（按 GitHub 的关闭关键字表，大小写不敏感） | 无命中；五个提交都只写 `Refs #129` |
| 文件集合：以 merge-base 为基，`comm -3` 比较评审时 head（`backup/work-item-list-states-pre-review1`）与整理后 HEAD 的改动文件列表 | 只有计划从 `active/` 移到 `completed/` 这一处差异；两边各 18 个文件 |

## Bottom Change Note

Change Note (2026-10-01 21:06 CST)：独立比较两稿多方案，采纳统一投影/table并收紧未知缓存与redacted banner；增加纯值leaf/完整browser正控、真实SSR及清楚证据边界；不承接前批迁移假设，当前仅spec/plan，修改集与预算见Global Constraints。

Change Note (2026-10-02 06:49 CST)：最终磁盘八问审读与预算/lint通过；补明确安全输出union、正确store.list接口与完整browser meta路径，缺读取key按未知处理；记录旧包名解析的证据边界，不增加产品机制或迁移要求。

Change Note (2026-10-02 06:58 CST)：主控添加独立索引及本轮文档验证证据，未来实现/API交接门保持未完成，修改全集只见Global Constraints。

Change Note (2026-10-02 22:06 CST)：实施 U1 / U2 / U3 并回填：授权与依赖 / 环境裁决入 Decision Log，实施期发现入 Surprises，证据、变异表与 Validation 结果入 Artifacts and Notes；就地标注被推翻的“未授权实施 / 禁止 pnpm / 未执行”表述；视觉验收与 push 后回读保持未完成，修改全集仍见 Global Constraints。

Change Note (2026-10-02 22:30 CST)：修复轮 1：把验证与目视指出的刷新态“当前值”矛盾、整表继承抹掉逐行新鲜度、标记不分状态、横幅重复宣告与窄屏版式问题落成行新鲜度组合、标记按状态出现、列宽 style 三条 Decision；补 pending 带非空 store、refreshing 零行、loading 的 aria-busy、横幅缺时间回退、滚动容器与缺口用例；就地标注被推翻的“整表继承”表述，并为授权条补上记录时刻；视觉验收与 push 后回读仍未完成，修改全集仍见 Global Constraints。

Change Note (2026-10-02 22:45 CST)：验收：Progress 勾选主控视觉验收与产品验收；Surprises 记录 failed 缺 failure 的 fail open、未钉住的三处回退与 ADR-0009 / 纵向路径证据的过时点；Decision Log 记录守卫收紧、延后项逐条处置与整理后的提交序列；就地标注被推翻的“单一闭环提交 / 四个提交 / 整体 revert / typecheck 环境未验证”表述与整理前的提交号；Artifacts 增加验收简化、变异、门与体量；人类评审、push 与 PR 回读仍未完成，修改全集仍见 Global Constraints。

Change Note (2026-10-03 09:41 CST)：按主控裁决把 ADR-0009 的 node:crypto 后果条与纵向路径 §2.1 第 4 行纳入文档全集并最小订正；就地标注 Global Constraints 的文档全集、Surprises (16) 与 Outcomes 的“另案更新”；Decision Log、Progress 与 Artifacts 各补一条。

Change Note (2026-10-03 11:10 CST)：第一轮 MVP 评审（APPROVE，2 × P2 + 3 × P3）后修订并归档：Design 表补「读门已观测不可读」一行；Validation 的不可用区分行补 remaining 的判别证据；Progress 记评审、变基与修复；Surprises 补 (17)–(20)；Decision Log 补评审处置、待人类裁决的开放问题与提交整理三条，并就地标注 2026-10-02 22:05 的文案部分、Global Constraints 的文档全集与 Concrete Steps 的未授权表述；Outcomes 与 Artifacts 补本轮结果与证据；文件移入 `docs/exec-plan/completed/`，修改全集仍见 Global Constraints。
