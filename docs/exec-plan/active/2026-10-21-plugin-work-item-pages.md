# Harness 插件挂载工作项列表与详情抽屉 ExecPlan

> 状态：Active
> 创建：2026-10-21
> 范围：issue #229：插件 `main` 面板经 `packages/ui` 的应用容器挂载工作项列表与详情抽屉，插件内导航；`packages/client` 的监督者让 watch 流在三种终止之后有界退避、以新 follower 重新跟随（TD-058）。D / E（#366）、字段映射（#277 / #358）、刷新控件与最后确认时间（#360 / #361）、工作区设置（#131）不在本计划内。
> 上游输入：issue #229 正文与 2026-10-03 / 10-04 / 10-07 / 10-15 评论；#351 重排（D2：评审只阻塞 P0 / P1）；`docs/exec-plan/completed/2026-10-15-host-watch-stream.md`（D7、D14、D32、D38，TD-057–060）；`docs/exec-plan/completed/2026-10-05-work-item-detail.md`；`docs/exec-plan/completed/2026-10-15-host-provider-composition.md`（Batch 7 的 S3 种子流程）；ADR-0010、ADR-0013；`docs/architecture/harness-host-spike.md` §6.1、§11.7。

## Purpose / Big Picture

完成后：宿主里打开 Harness Projects 面板，看到 watch 流推来的工作项列表；点击标题在面板内打开唯一详情抽屉，关闭回到列表。断流时页面保留最后已知值并说明正在重新连接；宿主结束一代、Host 侧读取失败或帧被拒之后，页面在 1 s 起、翻倍、30 s 封顶的退避后自动以新 follower 重新跟随，用户不必重开面板。壳只接线：插槽、监督者、生命周期。

最小成功证据：`tests/e2e/client-stream.test.js` 的 supervise 用例、`tests/contract/ui-work-item-app.test.js`、`tests/integration/harness-plugin-host-watch.test.js` 与 `tests/integration/harness-plugin-artifact.test.js` 全绿，且每条都有变异证明其判别力；人类伙伴在 Desktop 内按 Batch 4 走完 vertical-path §2 第 3–5 步，记录在 #124。

## Context and Orientation

术语：**follower** = `followWorkspace` 返回的一次跟随（一个 store、一个宿主 `RemoteStream` 句柄）；**载体断开** = 宿主 `$stream` 收到 `RemoteStreamCarrierError`，在**同一句柄**上开新一代并先给 baseline；**三种终止来源**（TD-058）= 宿主结束一代（插件重载 / 卸载 / Host 重组）、Host 侧读取异常经 `guarded` 漏斗结束本代、帧被拒；三者都让 `follower.done` reject 且句柄已死。**scope 门** = 路由的 `projectId` 必须等于当前快照的 `workspace.id`，否则不读 store。

现状（`main@f131e68`）：

- `apps/harness-plugin/src/client.ts:16-40`：`main` 只注册 `PlaceholderPanel`；一元 `baseline()` 只为打一行日志；watch 在 try/catch 里打开（D38：注入回调抛错时 Cordis 卸载 fiber，面板随之撤回）。
- `apps/harness-plugin/src/workspace-watch.ts:7-17`：`ended()` 返回普通 Error（插件 bundle 构造不出载体错误，`CLIENT_EXTERNAL` 为空），所以宿主结束一代即终止。
- `packages/client/src/stream.ts:18-50`：`WorkspaceFollower` 只有 `read() / done / close()`，无订阅、无 reopen；`sync.read()` 每次新建对象（`sync.ts:218-225`），不能直接做 `useSyncExternalStore` 快照。同一 store 拒绝修订倒退的 baseline（`sync.ts:140`，TD-059），所以恢复必须换新 follower。
- 页面零件已在 `packages/ui`：`WorkItemProjectPage`（关闭抽屉回焦 opener 或列表 `h2`）、`WorkItemDetailDrawer`（原生 `showModal`）、`TitleLink`（普通左键走 `open`，修饰键放行 href）。scope 门与中性 unresolved 只存在于 `tests/fixtures/work-item-detail-browser.mjs:35-64`，且页面被替换时焦点落到 body（#269 复评）。
- 路由 codec 在 `apps/web/src/item-route.ts`；ui 不得 import apps（`tests/contract/package-boundaries.test.js` 的 `EXPECTED`）；插件壳只允许 `.ts` 且不得 import react（同文件「壳：…」用例）。
- 宿主导航是面板选择，`lib/client.js` 面未观测到 URL 路由（spike §6.1；SPA 资产面未覆盖）；ADR-0010 第 44 行要求 #229 确认宿主 URL 路由面、`document.title` 不写条目标题。
- 浏览器 bundle 契约 `tests/contract/ui-work-item-detail-browser.test.js:18` 的 `ALLOWED` 禁止 `packages/client/src` 运行时进入 ui 的 bundle：ui 只能 import client 的**类型**（经 ui-model 的 `WorkspaceRead`）。

验收项（编号供本计划引用，原文见 issue）：A1 宿主内第 3–5 步（种子绑定，记录在 #124）；A2 来源降级时抽屉显示陈旧标记与最后更新时间，测试从 controller 快照出发；A3 壳只从 ui 引页面，`pnpm run boundaries` 通过；A4 断传输显示重连态，重连重拉 baseline；A5 未知路由与跨 scope 列表路由中性 unresolved：不 derive、不绑定 store、无 anchor，href 只用过门的 `projectId`；A6 scope 变化或 unresolved 在抽屉打开时替换页面，焦点落在定义元素而不是 body；A7（2026-10-15 评论）三种终止来源各有测试，页面显示可恢复态并在有界退避后以新 follower 重新跟随。范围项「从列表与从链接打开同一详情」「插件内导航」「宿主主题」也在本计划内。2026-10-03 的 D / E 已移 #366，2026-10-07 的字段映射已移 #277 / #358。

## Design / Spec

**状态拥有**

| 状态 | 拥有者 | 生命周期 |
|---|---|---|
| 条目、descriptor、能力、新鲜度 | Host（权威） | — |
| 副本（store、头、`lastUpdatedAt`、connected） | 每次尝试一个 `WorkspaceFollower` | 一次尝试 |
| 失败计数、待定重开、显示哪一个 follower、快照缓存 | `WorkspaceSupervisor`（client） | 注入 fiber，effect 里 `close()` |
| 路由（列表 / 详情）与页面替换时的焦点 | `WorkItemApp`（ui，`useState` / effect） | 面板挂载 |
| 插槽、监督者接线、主题继承 | `client.ts`（壳） | 注入 fiber |

**client：`packages/client/src/supervise.ts`**（签名见 `Interfaces and Dependencies`）。规则：

1. 构造时立即 `start()`：以包装过的 `connect` 调 `followWorkspace`。包装把 follower 的 `carrierFailed` 变成「先 `sync.disconnect()` 再发布」，把 `onReport` 变成「`shown = 本 follower`、`failures = 0`、调用方 `onReport`、发布」。所有改变读数的时刻都在 client 内发布，壳没有漏接点。
2. 终止 = `done` 以任一方向结算且不是本方 `close` 造成；`connect` 同步抛错（含首次）也是终止，**从不向调用方抛出**。终止时：关闭旧 follower、`failures += 1`、`delay = min(1000 · 2^(failures-1), 30000)`、发布、`onRetry(error, delay)`、`schedule(delay, start)`。
3. 快照 = `shown?.read()`，只在发布时重算并缓存（同一对象直到下次发布）。`shown` 是**最后一个接受过帧的 follower**：新 follower 接受 baseline 之前，页面继续看旧 follower 断开且整表 stale 的最后已知值；接受之后它的读数即权威（含宿主重组到空库时的 `undefined`）。
4. 载体断开不终止 follower，宿主在同一句柄上重拉 baseline；连续两次在线载体失败由宿主自己终止，按第 2 条处理。至多一个 follower 打开；`close()` 吸收、幂等，取消待定重开并发布一次。
5. 不加 jitter、不按时间窗归零、不设尝试上限（理由见 Decision Log D2）。`schedule` 缺省 `setTimeout`，测试注入手动调度。

**ui：`packages/ui/src/work-item-app.ts`**；codec 整文件 `git mv apps/web/src/item-route.ts packages/ui/src/item-route.ts`，内容不变，ui 出口导出全部 codec 与 History adapter，`apps/web/src/index.ts` 改为从 ui 转导出（公共 API 不变）。`WorkItemApp` 每次渲染的次序：

1. `read = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)`；`path` 是 `useState(initialPath)`，`undefined` 表示当前工作区列表。
2. `read === undefined` → loading 屏：`h2`（`tabIndex -1`，「Harness Projects」）+「正在连接宿主并读取工作项。」+ `LoadingState`；不伪造工作区。
3. **唯一 scope 门**：`route = path === undefined ? { projectId: read.workspace.id } : parseItemRoute(path)`；`route` 缺失或 `route.projectId !== read.workspace.id` → unresolved 屏：`h2`（`tabIndex -1`，「无法显示此页面」）+「链接无效，或不属于当前工作区。」（不回显路由）+ 按钮「回到工作项列表」（`setPath(undefined)`，宿主里没有地址栏与 Back）。不碰 `read.store`、不 derive、无 anchor。
4. 过门后：`input = { read, phase: 'received', refreshing: false, metadata: { sourceNames: {}, safeNotice? } }`，`!read.connection.connected` 时 `safeNotice` =「与宿主的连接已中断，正在自动重新连接；下面是最后已知值。」；渲染 `WorkItemProjectPage`，`navigation.href(id) = '#' + itemPath({ projectId, itemId: id })`，`open(id)` 与 `onCloseDetail` 都只改 `path`。列表点击与链接（`initialPath`）走同一条管线。
5. 全部屏包在 `section[aria-label=Harness Projects]`（`ref` 为根）里。焦点规则：屏键为 `loading` / `unresolved` / `page:<workspaceId>`；effect 依赖屏键，**首挂不动焦点**；键变化且 `document.activeElement` 为 null、`document.body` 或 `isConnected === false` 时，聚焦根下第一个 `h2`（列表标题、unresolved 标题或 loading 标题）；宿主持有的焦点不抢。抽屉关闭回焦仍归 `WorkItemProjectPage`。
6. `bindWorkItemApp(source)` 返回无 hook 的组件 `() => createElement(WorkItemApp, { source })`，壳不写 `createElement`、不 import react。容器不写颜色、字体与 `document.title`，主题经继承；`<dialog>` 用 UA 的 `Canvas` / `CanvasText`。

**壳**：`openWorkspaceWatch(child, options?)` 返回 `superviseWorkspace(...)`，`$stream` 选项与两行 info 日志不变，`onRetry` 记 `[harness-projects] watch failed` + `retry in <n>ms` + 原错误。`apply`：开监督者 → 登记 `close` effect → `Panel = bindWorkItemApp(workspace)` 只算一次 → 注册 `main` 与 `sidebar.panellist`。删除：`PlaceholderPanel`、一元 `baseline()` 调用与日志、watch 外的 try/catch（监督者不抛错，面板保留由安装件测试证明）。

**被放弃的方案**（取舍见 Decision Log）：壳内组装（fixture 照搬，scope 门成第二份，违反 `AGENTS.md` §2）；ui effect 里建 follower（ui 驱动传输、每次挂载多一条流）；同一 follower 内 reopen（要改 `acceptBaseline` 的 generation 证据规则）；声明 `dsh-api-gateway/client` external 让宿主重开（只覆盖一种来源，需宿主内验证）；内存 `HistoryPort` + `createItemNavigation`；路径形式 href；时间窗归零与 jitter；纯函数焦点判定 + 浏览器回读。

**不变量**（`AGENTS.md` §1.1）：Host 权威，前端只消费（不变量 7）：陈旧值永不显示为当前，路由是 UI 局部状态而非事实；无写入、无 `Saved`、无凭据、无 LLM；依赖方向 client → ui-model → ui → apps 不变，ui 只 import client 类型。

**刻意不做**：宿主深链与读写 `location` / `history`；主题 token 映射；来源显示名上 wire；error boundary（TD-024 → #361）；随面板开合流（TD-057 保持插件生命周期）；「无工作区」专用页（#131）；`CLIENT_EXTERNAL` 改动。

## Global Constraints

- 分支 `feature/plugin-work-item-pages`，工作树 `.worktrees/plugin-work-item-pages`，base `main`；draft PR 以 closingIssuesReferences 语义关联 #229；提交 `<type>(<scope>): <中文摘要>`，不推 `main`、不自行合并。
- **文件集合（只在此声明）**。代码：新增 `packages/client/src/supervise.ts`、`packages/ui/src/work-item-app.ts`；改 `packages/client/src/index.ts`、`packages/client/src/stream.ts`（头注释一句）、`packages/ui/src/index.ts`、`packages/ui/src/placeholder.ts`、`apps/web/src/index.ts`、`apps/harness-plugin/src/client.ts`（`@harness-projects/ui` import 行与 `apply` 本体）、`apps/harness-plugin/src/workspace-watch.ts`；改名 `apps/web/src/item-route.ts` → `packages/ui/src/item-route.ts`。测试：新增 `tests/contract/ui-work-item-app.test.js`；改 `tests/e2e/client-stream.test.js`、`tests/integration/harness-plugin-host-watch.test.js`、`tests/integration/harness-plugin-artifact.test.js`、`tests/contract/ui-work-item-list.test.js`、`tests/contract/ui-work-item-detail-browser.test.js`。文档：本计划、`docs/README.md`、`docs/exec-plan/tech-debt-tracker.md`、`tests/integration/README.md`、`docs/product/vertical-path.md`、`docs/adr/ADR-0010-stable-ids-are-route-locators.md`。
- **零改动**：`apps/harness-plugin/src/remote.ts`、`host-composition.ts`、`host-surface.ts`（PR A #352 拥有）；`packages/ui-model`、`packages/controller`、`packages/core`、`scripts/build.mjs`。不加依赖（不引入 Playwright / jsdom），不改 `CLIENT_EXTERNAL`。
- Node 26（`.nvmrc`）；`.ts` 只用可擦除语法；组件用 `createElement`，不启用 JSX。
- 体量（增删之和，`node scripts/rule-checks.mjs size origin/main` 回读）：代码 + 测试 ≤ 800，文档 ≤ 1300。2026-10-21 设计估算（不是回读值）：代码约 205（`supervise.ts` 60、`work-item-app.ts` 70、壳 43、其余 32，改名按 0 计），测试约 280（client-stream 75、ui-work-item-app 95、host-watch 60、artifact 45、其余 5），文档约 330。超过 760 时依次削减：安装件真实 React 渲染用例改回桩断言（约 −25）；host-watch AC2 内的容器渲染断言（约 −6）。
- 发布面：不写本机绝对路径、主机名、端口、令牌；沙箱 Project 只写变量名 `E1_PROJECT_A_ID`；#124 评论用英文，发布前经人类伙伴同意。

## Plan of Work

开工前：提交本计划与 `docs/README.md` Active 表一行（插在表头分隔行正下方）；建 draft PR。Batch 1 与 Batch 2 不共享文件，可由两名实现者并行；Batch 3 依赖两者；Batch 4 依赖 Batch 3。每批先写会红的判别性测试；变异用 `node scripts/review-mutate.mjs <spec.json>`，spec 放被忽略的 `.superpowers/229/`，期望 exit 0、全部 KILLED 且归因到所列用例。

### Batch 1 · client 监督者（TD-058 的 client 闭环）

**最小闭环**：`superviseWorkspace` 在 React-free 的 client 里把三种终止变成有界退避的新 follower，载体断开仍走同一句柄。**推荐实现者**：Opus（并发与状态拥有），可与 Batch 2 并行。**涉及文件**：`packages/client/src/supervise.ts`、`tests/e2e/client-stream.test.js`。

- [ ] 先红：`scripted` 每代脚本加 `throws`（迭代末尾抛出）与 `gate`（首帧前等待的 Promise）。新增四条：「supervise：三种终止来源都保留 stale 的最后已知值，1 s 后以新 follower 重新跟随」（表驱动：正常结束 / 抛 `harness-projects：操作失败，原因已写入宿主诊断日志` / 不前进的 delta 被拒；手动 `schedule` 记录 `{ delayMs, run }`；断言排定前 `streams.length === 1`、延迟 1000、快照 connected false 且标题为旧值；`run()` 后新句柄打开、gate 未放行时快照仍是旧值；放行后新值 connected true）；「supervise：退避 1→2→4→8→16→30→30 s，被接受的帧归零，close 取消待定重开」；「supervise：载体断开在同一回调内发布断开，同一句柄重连，不新建 follower」（`schedule` 调用即 `assert.fail`）；「supervise：connect 同步抛错只算一次终止，不向调用方抛出」。
- [ ] 实现 `supervise.ts`（Design / Spec 的 client 五条）与 `index.ts` 导出；`stream.ts` 头注释补一句「有界退避的重开见 `supervise.ts`」。
- [ ] 变异：M1 忽略 `schedule` 立即重开 →「三种终止」；M2 帧不归零 →「退避」；M3 去掉 30 s 封顶 →「退避」；M4 `close` 不取消 →「退避」；M5 新 follower 打开即清空显示（`shown = undefined` 并发布）→「三种终止」；M6 载体回调不发布 →「载体断开」；M7 `connect` 同步抛错外抛 →「同步抛错」。

**验证**（工作树根目录）：`node --test tests/e2e/client-stream.test.js` 期望 `ℹ tests 8`、`ℹ fail 0`；`node --test tests/contract/client-browser.test.js` 期望 `ℹ fail 0`（client 仍可按浏览器打包）；`pnpm run typecheck` 期望 exit 0。**回滚**：revert 本批提交；此时无消费者。

### Batch 2 · ui 应用容器与 codec 归位

**最小闭环**：`WorkItemApp` 持有唯一 scope 门、插件内导航与页面替换焦点，codec 归 ui 共用。**推荐实现者**：Sonnet（高），可与 Batch 1 并行。**涉及文件**：`packages/ui/src/item-route.ts`（改名）、`packages/ui/src/work-item-app.ts`、`tests/contract/ui-work-item-app.test.js`。

- [ ] 纯改名：`git mv`，头注释补「#229 起移入 ui 供两个壳共用」；ui 出口与 `apps/web/src/index.ts` 转导出；`ui-work-item-detail-browser.test.js` 的 `REQUIRED` 把 `apps/web/src/item-route.ts` 换成 `packages/ui/src/item-route.ts`。此步只跑既有测试，期望全绿。
- [ ] 先红 `ui-work-item-app.test.js`（真实 React SSR + 仿 `ui-work-item-detail.test.js` 的 hook 调度器桩，按调用序号持久化 `useState` / `useRef`，按依赖变化收集 effect）：「scope 门：未知路由 `/projects/ws-1/item/ent-aa` 与跨 scope `/projects/ws-9/items` 只出中性 unresolved」（store 是任何属性访问即 `assert.fail` 的 Proxy；无 `<tr`、`<a`、`href`、`ws-9`；正控：同一陷阱 store 在 `/projects/ws-1/items` 上被访问）；「列表与链接」（缺省路由的标题是 `<a href="#/projects/ws-1/items/ent-aa">`；`initialPath` 为详情路由时 `<dialog>` 含该条目与「当前值」；桩调度器里调 `navigation.open('ent-aa')` 后重渲染出详情，`onCloseDetail` 后回到列表）；「断开说明只在 connected false 时出现；无快照时是带 `tabindex="-1"` 标题的 loading、无行」；「焦点：抽屉打开时 scope 变化替换页面」（两轮：`activeElement` 为 body 时根下 `h2` 恰好 focus 一次；为宿主元素时 0 次；首挂 0 次）。
- [ ] 实现 `work-item-app.ts`（Design / Spec 的 ui 六条）并导出 `WorkItemApp`、`bindWorkItemApp`、`WorkspaceSource`。
- [ ] 变异：M8 跳过 `projectId` 比较、M9 门前先 derive →「scope 门」；M10 删焦点 effect、M11 无条件聚焦 →「焦点」；M12 通知不看 connected →「断开说明」；M13 href 去掉 `#` →「列表与链接」（href 只在过门之后生成，A5 的无 href 断言守住「只用过门的 `projectId`」）。

**验证**：`node --test tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/web-item-route.test.js tests/contract/ui-work-item-list.test.js` 期望 `ℹ fail 0`；`pnpm run boundaries` 期望 `ℹ pass 9`、`ℹ fail 0`；`pnpm run typecheck` exit 0；`git diff -M --stat origin/main...HEAD -- apps/web/src/item-route.ts packages/ui/src/item-route.ts` 期望一行 `{apps/web => packages/ui}/src/item-route.ts`。**回滚**：revert；`apps/web` 公共 API 未变。

### Batch 3 · 壳接线与死代码删除

**最小闭环**：插件 `main` 面板渲染 `WorkItemApp`，数据来自监督者；三种终止中的两种在真实 Host 组合上恢复。**推荐实现者**：Sonnet（高）；host-watch 的异步改写若出现时序不稳，换 Opus。**涉及文件**：`apps/harness-plugin/src/client.ts`、`apps/harness-plugin/src/workspace-watch.ts`、两份集成测试。

- [ ] 先红 host-watch：`open()` 改为 `openWorkspaceWatch(child, { schedule })`（手动调度，记录 `timers`），读数改 `source.getSnapshot()`，删 `state.ended`。AC2 用例在载体失败回调里同时渲染 `WorkItemApp`，断言有重连说明、行全 stale，重连后说明消失，且 `streams.length === 1`、`timers` 为空。卸载用例：Host 侧断言不变，客户端改为「排定 1000 ms 重开、快照 = 卸载前读数但 connected false / current 0 / 断网原因」。guarded 用例：诊断与「`carrier.opened === 1`」断言不变，之后还原 mock、运行 `timers[0]`，断言 `streams.length === 2`、行回到 current。新增「来源降级时抽屉显示最后已知值与原确认时刻」：baseline 后记 `lastUpdatedAt`，fake 规划 `FaultKind.Offline` + `installed.service.bootstrapWorkspace(...)`，等 `watch metadata` 日志，渲染详情路由的 `WorkItemApp`，断言含「最后已知值，当前结果尚未确认」且 `<time dateTime>` 等于原值、connected 仍为 true。空数据根用例改断言快照 `undefined` 且 `timers` 为空。
- [ ] 先红安装件 e 节：`evaluateClientBundle` 的 vm 上下文补 `setTimeout` / `clearTimeout`（浏览器本有），可选传入真实 React；`applyClient` 去掉一元 baseline 桩，`$stream` 桩可按参数交付一个合法 baseline 项后挂起；删「baseline 按 RemoteResult 分支」用例；「`$stream` 同步抛错也不丢面板」改为期望错误日志 `['error', '[harness-projects] watch failed', 'retry in 1000ms', boom]`，卸载后不再有第二行；原面板形状用例改为「main 面板用真实 React 渲染」：`renderToStaticMarkup` 渲染 `main` 组件，断言 `section aria-label="Harness Projects"` 与 `<a href="#/projects/workspace-1/items/entity-1">`；入口图标断言保留。
- [ ] 实现 `workspace-watch.ts` 与 `client.ts`（Design / Spec 的壳）；删除 `PlaceholderPanel` 与其出口；`ui-work-item-list.test.js` 的出口用例改为断言 `ui.PlaceholderPanel === undefined`。
- [ ] 变异：M14 `client.ts` 给 `bindWorkItemApp` 一个恒为 `undefined` 的源 → artifact「main 面板用真实 React 渲染」；M15 `openWorkspaceWatch` 不转交 `schedule` → host-watch guarded 用例；M16 删监督者里的载体发布 → host-watch AC2 用例。

**验证**：`node --test tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-artifact.test.js tests/e2e/client-stream.test.js tests/contract/ui-work-item-list.test.js` 期望 `ℹ fail 0`；`pnpm run boundaries` 期望 `ℹ pass 9`；`pnpm verify` 以 root 运行时只允许两条已知失败（`tests/integration/development-local-git.test.js` 的「拒绝：占用路径、被别处检出的分支与不可访问的目录都不伪造成功」与它连带的 `tests/contract/run-test-layer.test.js`「真实层 tests/integration：非空、全绿，且摘要行被透传」），用 `sudo -u ubuntu env "PATH=$PATH" node --test tests/integration/development-local-git.test.js`（PATH 上为 Node 26）判别，期望 `ℹ fail 0`（2026-10-21 在 `main@f131e68` 观察 73 / 73），其余任何失败都不是已知项；`node scripts/rule-checks.mjs size origin/main` 在预算内；`node scripts/rule-checks.mjs disclosure origin/main` 无命中；`git diff --check origin/main...HEAD` 无输出。**回滚**：revert 本批提交即回到占位面板，Batch 1–2 的新增无消费者、无害。

### Batch 4 · 宿主内观测（S3）与文档

**最小闭环**：A1 有真实宿主证据，所有引用 #229 的文档在关闭它的 PR 里改对。**承担者**：协调者 + 人类伙伴（S3 不得由测试替代）；文档编辑 Sonnet（中）。

- [ ] 冻结树后在检出冻结 head 的工作树根目录：`git status --short` 为空，记 `git rev-parse HEAD`；`pnpm --filter @harness-projects/app-harness-plugin pack:plugin`；`shasum -a 256 apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.0.0.tgz apps/harness-plugin/dist/package/lib/index.js apps/harness-plugin/dist/package/lib/client.js`（Linux 用 `sha256sum`）记三个值；把 tgz 复制到仓库外的临时目录后 `rm -r apps/harness-plugin/dist`，`test ! -e apps/harness-plugin/dist && echo clean` 期望 `clean`（遗留的 `dist` 会让 `tests/e2e/delivery-lineage.test.js` 变红，#350）。
- [ ] 人类伙伴（Desktop 0.2.0-rc.2）：按 `docs/exec-plan/completed/2026-10-15-host-provider-composition.md` Batch 7 第 4–7 步的约定准备种子绑定（被忽略、不提交的种子脚本；令牌只在 Desktop 凭据存储的 `HARNESS_PROJECTS_GITHUB_TOKEN`；Project 为 `E1_PROJECT_A_ID`）；先 remove 再 add 这个 tgz；预先处理 Preview Notice 与 API key 对话框。打开面板后记录：第 3 步 console 有 `[harness-projects] watch baseline r=… gen=1`，条目被读入；第 4 步列表里 Issue / Draft / PR 各自是工作项、PR 不出现第二次（无字段映射时规划状态为「未知」、迭代与目标日期为「—」，属 #277）；第 5 步点标题打开详情（规划字段、来源身份、「当前值（工作区最后接收确认帧：…）」），Esc 关闭后 console 读 `document.activeElement` 是该标题链接；开关详情前后 `location.href` 不变；宿主深色与浅色下列表与抽屉可读。scope 变化在宿主内触发不了（要 #354），A6 以 Batch 2 的测试为证据。
- [ ] 人类伙伴同意后在 #124 发英文评论：日期、head、宿主版本、三个 sha256、逐步观测与截图。之后两个 lib 的字节再变，按 D22 / D38 先例重走或由人类裁定沿用。
- [ ] 文档：`docs/exec-plan/tech-debt-tracker.md` 把 TD-058 移入 Resolved（指本计划），TD-057 注「#229 决定保持插件生命周期」，TD-059 的遗留影响注「被拒的倒退 baseline 经监督者 1 s 后由新 store 接受，页面不必重开；metadata 根因不变」，新增 Decision Log D10 的两行债（编号与并行 PR 去重）；`tests/integration/README.md` 的 host-watch 表改写卸载 / guarded 两行并加降级一行；`docs/product/vertical-path.md` §2.1 第 4、5 行与一段带日期的「#229 订正」（按该节规则写回读命令与检出）；ADR-0010 第 15 行原处标注「D / E 已由 #351 重排移交 #366（2026-10-16）」，第 44 行原处标注插件不读写 URL、href 为片段、`document.title` 未改；回填本计划各节。
- [ ] 文档验证：`node scripts/rule-checks.mjs disclosure origin/main` 无命中；`node scripts/rule-checks.mjs size origin/main` 在预算内；`git diff --check origin/main...HEAD` 无输出；按 vertical-path 新段落的回读命令逐条重跑，各读回 `ℹ fail 0`。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| A1 | 宿主内第 3–5 步（种子绑定） | Batch 4 的 #124 评论（head + 三个 sha256）；旁证：artifact e 节「main 面板用真实 React 渲染」 |
| A2 | 降级 → 抽屉陈旧标记 + 最后更新时间，自 controller 快照 | host-watch「来源降级时抽屉显示最后已知值与原确认时刻」；规则层既有 `tests/integration/ui-work-item-detail-read.test.js`「sync-source-degraded-retains-content」 |
| A3 | 壳只从 ui 引页面；boundaries | `pnpm run boundaries`（`ℹ pass 9`）；artifact「所有 require("…") 的参数都在宿主基线模块表里」 |
| A4 | 断传输 → 重连态；重连重拉 baseline | host-watch AC2（同一句柄、无重开、渲染有 / 无说明）；ui-work-item-app「断开说明」；client-stream「载体断开」 |
| A5 | 未知 / 跨 scope 路由中性，href 只用过门 `projectId` | ui-work-item-app「scope 门」与「列表与链接」 |
| A6 | 页面替换时焦点落在定义元素 | ui-work-item-app「焦点」；S3 记录 Esc 回焦 |
| A7 | 三种终止各有测试，有界退避后新 follower 跟随 | client-stream「三种终止来源」「退避」；host-watch 卸载与 guarded 两例 |
| 范围 | 从列表与从链接打开同一详情；插件内导航 | ui-work-item-app「列表与链接」 |
| 删除 | 占位面板、一元 baseline 调用 | ui-work-item-list 出口用例；artifact「同步抛错」只剩 watch 日志 |

全部命令在检出 `feature/plugin-work-item-pages` 的工作树根目录运行；`gh` 一律带 `-R SingularityKChen/harness-projects`。

## Progress

- [x] 2026-10-21 设计评审完成：三份提案（minimal / systems / industry）合并为本计划；评审原型在会话 scratch 里跑通（不入库，见 `Surprises & Discoveries`）。
- [ ] 开工前：计划与 `docs/README.md` 索引提交；draft PR 关联 #229
- [ ] Batch 1 · client 监督者
- [ ] Batch 2 · ui 应用容器与 codec 归位
- [ ] Batch 3 · 壳接线与死代码删除
- [ ] Batch 4 · S3（阻塞于人类伙伴）与文档
- [ ] 全部验收后移入 `docs/exec-plan/completed/` 并更新 `docs/README.md`

## Surprises & Discoveries

- 2026-10-21（评审原型，基于 `main@f131e68` 的源码，不入库）：按本计划写的监督者与容器原型在 Node 26 上跑通：四条 supervise 用例、四条容器用例、一条真实 Host 组合降级用例；对应本计划 M1–M6 与 M8–M12 的变异全部红（M7、M13 未在原型里跑）。原型第一版里「新 follower 打开即清空显示」存活，补了 `gate`（新 baseline 前断言仍是旧值）才红——Batch 1 的用例必须带这一步。
- minimal 提案原型的 `read()` 在新 follower 接受了无工作区的 baseline 之后仍回落到旧 follower：宿主重组到空库时会一直显示旧工作区。改为「最后一个接受过帧的 follower」（Design / Spec client 第 3 条）。
- `tests/contract/ui-work-item-detail-browser.test.js:18` 的 `ALLOWED` 不许 `packages/client/src` 运行时进入 ui 的 bundle：容器只能 import client 类型，监督者因此留在 client、由壳注入。
- 安装件测试的 vm 上下文没有 `setTimeout`：监督者吸收同步抛错后要排定重开，不补就会在注入回调里抛 `ReferenceError`、撤回面板（真实浏览器有该全局）。
- 真实 bundle 在 vm 里接主 realm 的 React 可正常 `renderToStaticMarkup`（原型 esbuild 构建核对），artifact 的真实渲染用例可行。
- 全局 mock 计时器会冻住 controller watch 的轮询（host-watch 用 `watchIntervalMs: 5`），所以监督者要可注入 `schedule`。
- #366 正文没有承接 2026-10-04 评论第 1 条（partial 读取的状态文字）；ADR-0010 第 15 行仍写 D / E「由 #229 关闭」，#351 之后已不成立。

## Decision Log

以下均为 2026-10-21，设计评审（Claude Opus，独立评审 subagent），人类可推翻。

- D1 路由：codec 整文件 `git mv` 进 `packages/ui` + 容器内 `useState` 路由 + 片段 href。选项：(a) 内存 `HistoryPort` + `createItemNavigation`（minimal）；(b) `useState` + 路径 href（systems）；(c) 片段 href + 把 History adapter 拆回 `apps/web`（industry）。证据：A5 要求解析字符串路由（未知路由），ui 不能 import apps；宿主导航是面板选择、客户端面无 URL 路由（spike §6.1）；ADR-0010 的部署事实。取舍：整文件改名按 numstat 计 0 行，拆分多约 100 行而无验收需要，代价是 ui 出口多带 History adapter（它只经端口碰全局，ui 规则禁止的是外部平台 API）；`useState` 比端口 + effect 少约 12 行；片段 href 在点击未被拦截或修饰键打开时只改 hash，不把宿主文档导航到未知服务端路径，locator 也不进请求与 referrer。代价：宿主里没有指向条目的深链（D10 债）。
- D2 监督者：`superviseWorkspace(connect, options)` 在 client 内拥有全部发布点，而不是 minimal 的 `keepFollowing(open(changed))`（壳要记得在帧与载体失败时调 `changed`，#276 计划第 883 行交接的订阅点被摊到壳里）。快照只是 `ClientWorkspaceRead | undefined`，不加 systems 的状态联合：没有验收区分「重连中」与「退避中」，一句说明足够。方法名 `close()` 与同包 `WorkspaceFollower` 一致。退避 1 s 起翻倍、30 s 封顶（gRPC connection-backoff 形状）；不加 jitter：单用户、回环宿主、每窗口一条流，没有要打散的并发重连，且免去注入随机数；按被接受的帧归零（与宿主 `RemoteStream` 的 `accept()` 清零一致，`tests/fixtures/remote-stream-double.js:5,63`），不取 client-go 的时间窗归零：它只多覆盖「每代都先接受 baseline 再失败」，而 baseline 与轮询读同一个 `controller.baseline()`，该情形罕见，残余记为债；`schedule` 注入而非全局 mock 计时器（见 Surprises）。首次 `connect` 同步抛错按终止吸收（minimal），不像 systems / industry 那样外抛再由壳兜底，面板恒挂容器。
- D3 D38 的 try/catch 删除：它保护的性质（`$stream` 同步抛错不撤回面板）由监督者不抛错保证，安装件「同步抛错也不丢面板」用例保留并改期望；本机有宿主包时按 TD-060 以 `HARNESS_CORDIS` 复跑。`apply` 次序改为先开监督者再注册插槽（D32(3) 的次序理由随之失效）。
- D4 焦点：Node 测试用 hook 调度器桩驱动 `WorkItemApp` 的 effect（先例 `tests/contract/ui-work-item-detail.test.js`），不导出纯判定函数、不加浏览器 fixture 入口、不引入 Playwright。规则取 WAI-ARIA APG 对话框「调用者不复存在时把焦点放到逻辑上的下一处」，只在焦点已丢失时移动、首挂不移动、不抢宿主焦点。宿主内触发不了 scope 变化（要 #354），S3 只记 Esc 回焦。
- D5 S3 分工：PR 交付冻结 head、三个 sha256、可安装 tgz 与自动化旁证；人类伙伴安装、走第 3–5 步、核对主题与焦点、同意 #124 评论。字节在 S3 之后再变时按 D22 / D38 先例处理。
- D6 删除：`PlaceholderPanel`；`client.ts` 的一元 `baseline()` 调用与日志（watch 的开场 baseline 已覆盖，S3 改看 `watch baseline` 日志）。`baseline` 远程操作本身由 PR A 声明、Host 测试仍在用，不删。
- D7 A2 用例放在 host-watch：真实 Host 组合、core 自己产生的降级 metadata 帧、壳的 `openWorkspaceWatch`、监督者与容器整条链；视图层规则复用既有 `ui-work-item-detail-read` 用例，不重写。
- D8 断开说明走 `metadata.safeNotice`、`phase: 'received'`、`refreshing: false`；不用 `refreshing: true`（那是 #360 的「正在刷新」语义）。
- D9 TD-057：流保持注入 fiber（插件）生命周期，不随面板开合：随面板开合每次切换都要全量 baseline 并丢失最后已知值，计数引用又是新状态。
- D10 新债（编号提议 TD-072、TD-073，落表前与并行 PR 去重）：TD-072 插件内路由随 `main` 插槽卸载重置，href 是片段且加载时不读，宿主里没有条目深链，宿主 URL 路由面仍未确认（触发：宿主提供导航 API 或需要深链）；TD-073 退避按被接受的帧归零，接受 baseline 后每代都失败的宿主约每「1 s + 失败时延」重开一次，每次多一次全量快照读，guarded 时多一行无轮转的诊断日志（TD-056）（触发：诊断日志出现约 1 s 节奏的重复 `operationFailed`；下一步改时间窗归零）。

## Idempotence and Recovery

- 所有测试离线、可重复；host-watch 每例在自己的临时数据根里组合并在 `t.after` 有上限地清理。变异工具按字节还原，不依赖 git；spec 与笔记只放被忽略的 `.superpowers/229/`。
- `git mv` 可由 revert 还原；Batch 2 之后 `apps/web` 的公共 API 与 `tests/contract/web-item-route.test.js` 不变。
- 每批单独提交、单独可 revert；Batch 3 revert 后回到占位面板。已推送分支整理提交前先建 backup ref，再用精确的 force-with-lease。
- `pack:plugin` 可重复，但每次之后都要删除 `apps/harness-plugin/dist` 并确认 `clean`；S3 证据绑定两个 lib 的 sha256，冻结后再改代码就重算并按 D5 处理。
- 已知良好状态：`main@f131e68` 上本计划列出的测试全绿（2026-10-21 在本工作树观察：6 个相关文件 51 / 51、boundaries 9 / 9）。

## Interfaces and Dependencies

```ts
// packages/client/src/supervise.ts（index 导出）
export interface SuperviseOptions extends FollowOptions {
  /** 安排一次重开，返回取消函数；缺省 setTimeout。 */
  readonly schedule?: (delayMs: number, run: () => void) => () => void
  /** follower 终止、重开已排定时调用。 */
  readonly onRetry?: (error: unknown, delayMs: number) => void
}
export interface WorkspaceSupervisor {
  subscribe(listener: () => void): () => void
  /** 两次发布之间返回同一对象；首个接受过帧的 follower 之前为 undefined。 */
  getSnapshot(): ClientWorkspaceRead | undefined
  /** 吸收、幂等：取消待定重开、关闭当前 follower、发布一次。 */
  close(): Promise<void>
}
export function superviseWorkspace(connect: (carrierFailed: () => void) => GenerationStream, options?: SuperviseOptions): WorkspaceSupervisor

// packages/ui/src/work-item-app.ts（index 导出）
export interface WorkspaceSource { subscribe(listener: () => void): () => void; getSnapshot(): WorkspaceRead | undefined }
export function WorkItemApp(props: { readonly source: WorkspaceSource; readonly initialPath?: string }): ReactElement
export function bindWorkItemApp(source: WorkspaceSource): () => ReactElement

// packages/ui/src/item-route.ts（自 apps/web 改名，签名不变；apps/web 转导出）
export { parseItemRoute, itemPath, browserHistoryPort, createItemNavigation }; export type { ItemRoute, HistoryPort }

// apps/harness-plugin/src/workspace-watch.ts
export function openWorkspaceWatch(child: Pick<ClientInjectedContext, 'remote'>, options?: Pick<SuperviseOptions, 'schedule'>): WorkspaceSupervisor
```

- 与 PR A（#352）：本 PR 不改 `remote.ts`、`host-composition.ts`、`host-surface.ts`；依赖其中 `CLIENT_REMOTE`、`ClientContext`、`ClientInjectedContext`、`installHostRemote`、`createHostComposition` 的名字。PR A 若改名，后合者只改 import 行；`client.ts` 第 7–9 行相邻 import 可能产生文本冲突，rebase 时逐行合并。两者都可能改 `tests/integration/harness-plugin-artifact.test.js`，本 PR 只动 e 节。
- 下游：#131 在 `WorkItemApp` 内加「无工作区」与设置屏；#360 在容器里加刷新控件（届时 `refreshing` 由它驱动）；#354 Host 重组结束一代后由监督者自动跟随新一代；#142、#230、#234、#282、#358 只依赖本 PR 挂好的面板。
- 外部：DeepSeek Harness Desktop 0.2.0-rc.2 与其 `dsh plugin` CLI、Desktop 凭据存储句柄 `HARNESS_PROJECTS_GITHUB_TOKEN`、沙箱 Project A（`E1_PROJECT_A_ID`，`docs/architecture/gate-e1-sandbox.md` §2.1）。假设宿主 React ≥ 18（`useSyncExternalStore`；客户端基线含 `react-dom/client`），S3 面板能渲染即证实。

## Outcomes & Retrospective

未开始。

## Bottom Change Note

- 2026-10-21：创建。为什么：#229 进入迭代 7（PR B），三份设计提案经独立评审合并为一份 spec + plan；分歧点与证据见 `Decision Log` D1–D10。
