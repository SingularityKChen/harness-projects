# Harness 插件挂载工作项列表与详情抽屉 ExecPlan

> 状态：Active
> 创建：2026-10-21
> 范围：issue #229：插件 `main` 面板经 `packages/ui` 的应用容器挂载工作项列表与详情抽屉，插件内导航；`packages/client` 的监督者让 watch 流在三种终止之后有界退避、以新 follower 重新跟随（TD-058）。D / E（#366）、字段映射（#277 / #358）、刷新控件与最后确认时间（#360 / #361）、工作区设置（#131）不在本计划内。2026-10-21 起另含独立验收的六个跟进项 #377–#382（人类伙伴决定在本 PR 内实现，Batch 5、D20）。
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
- **文件集合（只在此声明）**。代码：新增 `packages/client/src/supervise.ts`、`packages/ui/src/work-item-app.ts`；改 `packages/client/src/index.ts`、`packages/client/src/stream.ts`（头注释一句）、`packages/ui/src/index.ts`、`packages/ui/src/placeholder.ts`、`apps/web/src/index.ts`、`apps/harness-plugin/src/client.ts`（`@harness-projects/ui` import 行与 `apply` 本体）、`apps/harness-plugin/src/workspace-watch.ts`；改名 `apps/web/src/item-route.ts` → `packages/ui/src/item-route.ts`。测试：新增 `tests/contract/ui-work-item-app.test.js`；改 `tests/e2e/client-stream.test.js`、`tests/integration/harness-plugin-host-watch.test.js`、`tests/integration/harness-plugin-artifact.test.js`、`tests/contract/ui-work-item-list.test.js`、`tests/contract/ui-work-item-detail-browser.test.js`。文档：本计划、`docs/README.md`、`docs/exec-plan/tech-debt-tracker.md`、`tests/integration/README.md`、`docs/product/vertical-path.md`、`docs/adr/ADR-0010-stable-ids-are-route-locators.md`。Batch 5（D20）另改：`packages/ui/src/work-item-detail.ts`、`packages/ui/src/work-item-project.ts`、`packages/ui-model/src/work-item-list-view.ts`（只改状态文字派生与可选的 `body.partial`）、`packages/ui/src/work-item-list.ts`（横幅与页首两处判定）、`tests/contract/ui-work-item-list-view.test.js`、`tests/e2e/workspace-read-assembly.test.js`、`docs/adr/ADR-0009-harness-plugin-installable-artifact.md`。
- **零改动**：`apps/harness-plugin/src/remote.ts`、`host-composition.ts`、`host-surface.ts`（PR A #352 拥有）；`packages/ui-model`（#382 例外，见 D25）、`packages/controller`、`packages/core`、`scripts/build.mjs`。不加依赖（不引入 Playwright / jsdom），不改 `CLIENT_EXTERNAL`。
- Node 26（`.nvmrc`）；`.ts` 只用可擦除语法；组件用 `createElement`，不启用 JSX。
- 体量（增删之和，`node scripts/rule-checks.mjs size origin/main` 回读）：代码 + 测试 ≤ 800，文档 ≤ 1300。2026-10-21 设计估算（不是回读值）：代码约 205（`supervise.ts` 60、`work-item-app.ts` 70、壳 43、其余 32，改名按 0 计），测试约 280（client-stream 75、ui-work-item-app 95、host-watch 60、artifact 45、其余 5），文档约 330。超过 760 时依次削减：安装件真实 React 渲染用例改回桩断言（约 −25）；host-watch AC2 内的容器渲染断言（约 −6）。**2026-10-21 订正（D20）**：Batch 5 之后回读代码 774，越过 760 削减线；人类伙伴决定 800 是弹性目标（CI 硬限 1000 / 1500 不变），不按上面的次序削减。
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

**验证**：`node --test tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-artifact.test.js tests/e2e/client-stream.test.js tests/contract/ui-work-item-list.test.js` 期望 `ℹ fail 0`；`pnpm run boundaries` 期望 `ℹ pass 9`；`pnpm verify` 以 root 运行时只允许两条已知失败（`tests/integration/development-local-git.test.js` 的「拒绝：占用路径、被别处检出的分支与不可访问的目录都不伪造成功」与它连带的 `tests/contract/run-test-layer.test.js`「真实层 tests/integration：非空、全绿，且摘要行被透传」），用 `sudo -u <non-root-user> env "PATH=$PATH" node --test tests/integration/development-local-git.test.js`（`<non-root-user>` 是任一非 root 用户；PATH 上为 Node 26）判别，期望 `ℹ fail 0`（2026-10-21 在 `main@f131e68` 观察 73 / 73），其余任何失败都不是已知项；`node scripts/rule-checks.mjs size origin/main` 在预算内；`node scripts/rule-checks.mjs disclosure origin/main` 无命中；`git diff --check origin/main...HEAD` 无输出。**回滚**：revert 本批提交即回到占位面板，Batch 1–2 的新增无消费者、无害。

### Batch 4 · 宿主内观测（S3）与文档

**最小闭环**：A1 有真实宿主证据，所有引用 #229 的文档在关闭它的 PR 里改对。**承担者**：协调者 + 人类伙伴（S3 不得由测试替代）；文档编辑 Sonnet（中）。

- [ ] 冻结树后在检出冻结 head 的工作树根目录：`git status --short` 为空，记 `git rev-parse HEAD`；`pnpm --filter @harness-projects/app-harness-plugin pack:plugin`；`shasum -a 256 apps/harness-plugin/dist/package/lib/index.js apps/harness-plugin/dist/package/lib/client.js`（Linux 用 `sha256sum`），**比对门只有这两个值**，必须等于本节末的期望值（D27）；tgz 的 sha256 跨环境不可复现（2026-10-21 评审：同一 head 在 macOS 打包得到的 tgz 哈希与 Linux 不同，两个 lib 逐字节一致；tar 条目已归一化，差异很可能来自 gzip 实现），只在本机 `shasum -a 256 apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.0.0.tgz` 记录、作为环境相关的备注贴进 #124，不作期望值；想再核对包内容时可比 `gunzip -c apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.0.0.tgz | shasum -a 256`（未在第二个环境验证可复现，只作参考，不作门）；把 tgz 复制到仓库外的临时目录后 `rm -r apps/harness-plugin/dist`，`test ! -e apps/harness-plugin/dist && echo clean` 期望 `clean`（遗留的 `dist` 会让 `tests/e2e/delivery-lineage.test.js` 变红，#350）。期望值（评审会话把本 PR 变基到含 #348、#370 的 main 并整合提交之后的代码，2026-10-21 macOS、Node v26.11.1、pnpm 10.28.2 连打两次读回一致；变基前评审修复轮的值是 `lib/index.js` `21c0d966…`、`lib/client.js` `c970ba96…`，#370 的 Host 远程操作改动打进了两个 lib，所以变了；之后代码再变就重算并改这里）：`lib/index.js` `060f8bdcae8f8de7037984af1dce6a9ae9864b2ebeaab8092bb1d50ff47e8b2a`，`lib/client.js` `279c4b15082e788d38820bb8320e0efd3726817904fe160024007751d3a64235`。
- [ ] 人类伙伴（Desktop 按实际版本记，2026-10-21 评审方读到的是 0.2.1-rc.2；D30）：按 `docs/exec-plan/completed/2026-10-15-host-provider-composition.md` Batch 7 第 4–7 步的约定准备种子绑定（被忽略、不提交的种子脚本；令牌只在 Desktop 凭据存储的 `HARNESS_PROJECTS_GITHUB_TOKEN`；Project 为 `E1_PROJECT_A_ID`）；先 remove 再 add 这个 tgz；预先处理 Preview Notice 与 API key 对话框。打开面板后记录：第 3 步 console 有 `[harness-projects] watch baseline r=… gen=1`，条目被读入；第 4 步列表里 Issue / Draft / PR 各自是工作项、PR 不出现第二次（无字段映射时规划状态为「未知」、迭代与目标日期为「—」，属 #277）；第 5 步点标题打开详情（规划字段、来源身份、「当前值（工作区最后接收确认帧：…）」），Esc 关闭后 console 读 `document.activeElement` 是该标题链接；开关详情前后 `location.href` 不变，并顺带确认宿主自己不用 hash 路由（D30）；主题目检要在「宿主主题与操作系统主题不同」的设置下，宿主深色与浅色各看一遍列表与抽屉（D30）；宿主注册了 Escape 的「dismiss」快捷键，回焦一项要特别看（评审方提示）。scope 变化在宿主内触发不了（要 #354），A6 以 Batch 2 的测试为证据。
- [ ] 人类伙伴同意后在 #124 发英文评论：日期、head、宿主版本、两个 lib 的 sha256（与期望值一致）、本机 tgz 的 sha256（注明环境，只是备注）、逐步观测与截图。之后两个 lib 的字节再变，按 D22 / D38 先例重走或由人类裁定沿用。
- [ ] 文档：`docs/exec-plan/tech-debt-tracker.md` 把 TD-058 移入 Resolved（指本计划），TD-057 注「#229 决定保持插件生命周期」，TD-059 的遗留影响注「被拒的倒退 baseline 经监督者 1 s 后由新 store 接受，页面不必重开；metadata 根因不变」，新增 Decision Log D10 的两行债（编号与并行 PR 去重）；`tests/integration/README.md` 的 host-watch 表改写卸载 / guarded 两行并加降级一行；`docs/product/vertical-path.md` §2.1 第 4、5 行与一段带日期的「#229 订正」（按该节规则写回读命令与检出）；ADR-0010 第 15 行原处标注「D / E 已由 #351 重排移交 #366（2026-10-16）」，第 44 行原处标注插件不读写 URL、href 为片段、`document.title` 未改；回填本计划各节。
- [ ] 文档验证：`node scripts/rule-checks.mjs disclosure origin/main` 无命中；`node scripts/rule-checks.mjs size origin/main` 在预算内；`git diff --check origin/main...HEAD` 无输出；按 vertical-path 新段落的回读命令逐条重跑，各读回 `ℹ fail 0`。

### Batch 5 · 独立验收跟进项（#377–#382，D20）

**最小闭环**：独立验收列出的六个 P2 / P3 在本 PR 内落地，每个 issue 一个提交、以 `Closes #N` 关闭（#380 例外：验收 1 未满足，本 PR 只钉住实际行为并 `Refs #380`，见 D24 订正）；动手前先问能否删掉或收窄代码、能否只收紧既有断言（D21–D26 逐条记录）。**承担者**：实现者（Claude Opus）。**涉及文件**：见 `Global Constraints` 文件集合的 Batch 5 一句。

- [x] #377、#380（client）：只在 client-stream 既有的「三种终止来源」「退避」用例里加断言或换脚本，不新增用例（vertical-path 回读块的「supervise：」条数不变）；#380 不改 `supervise.ts`（D24）；#380 的验收 1 未满足，本 PR 只钉住实际行为并 `Refs #380`，按 not planned 关闭还是改写验收由人类伙伴决定（D24 订正）。
- [x] #378、#379（ui）：「列表与链接」末尾加一步；「断开说明」先红，再让 `WorkItemProjectPage` 把列表 view 的 `body.notice` 交给抽屉的稳定状态区。
- [x] #382（ui-model）：先红 `ui-work-item-list-view` 的「行新鲜度」与 e2e 的「partial：」，再只改 `deriveWorkItemListView` 的状态文字派生；#381 只在 ADR-0009 原处追加标注。
- [x] 变异：V2、U11、N1–N3、G1–G2、P1–P4（结果见 `Validation and Acceptance` 的「跟进项读回」）。

**验证**：`node --test tests/e2e/client-stream.test.js tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-list-view.test.js tests/e2e/workspace-read-assembly.test.js` 期望 `ℹ fail 0`；Batch 3 的四文件组与 Batch 2 的五文件组照旧 `ℹ fail 0`；`pnpm run typecheck` exit 0。**回滚**：每个 issue 的提交单独可 revert；#379 revert 后说明回到只在列表里，#382 revert 后部分读取回到原状态文字。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| A1 | 宿主内第 3–5 步（种子绑定） | Batch 4 的 #124 评论（head + 两个 lib 的 sha256；tgz 哈希只作环境备注），2026-10-21 已发：https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-6311541086；旁证：artifact e 节「main 面板用真实 React 渲染」 |
| A2 | 降级 → 抽屉陈旧标记 + 最后更新时间，自 controller 快照 | host-watch「来源降级时抽屉显示最后已知值与原确认时刻」；规则层既有 `tests/integration/ui-work-item-detail-read.test.js`「sync-source-degraded-retains-content」 |
| A3 | 壳只从 ui 引页面；boundaries | `pnpm run boundaries`（`ℹ pass 9`）；artifact「所有 require("…") 的参数都在宿主基线模块表里」 |
| A4 | 断传输 → 重连态；重连重拉 baseline | host-watch AC2（同一句柄、无重开、渲染有 / 无说明）；ui-work-item-app「断开说明」；client-stream「载体断开」 |
| A5 | 未知 / 跨 scope 路由中性，href 只用过门 `projectId` | ui-work-item-app「scope 门」与「列表与链接」 |
| A6 | 页面替换时焦点落在定义元素 | ui-work-item-app「焦点」；S3 记录 Esc 回焦 |
| A7 | 三种终止各有测试，有界退避后新 follower 跟随 | client-stream「三种终止来源」「退避」；host-watch 卸载与 guarded 两例 |
| 范围 | 从列表与从链接打开同一详情；插件内导航 | ui-work-item-app「列表与链接」 |
| 删除 | 占位面板、一元 baseline 调用 | ui-work-item-list 出口用例；artifact「同步抛错」只剩 watch 日志 |
| 跟进 | 独立验收跟进项 #377–#382（D20；#380 只 `Refs`，验收 1 未满足，去留待人类伙伴，D24） | 本节「跟进项读回」的逐 issue 判别证据（先红或变异） |

全部命令在检出 `feature/plugin-work-item-pages` 的工作树根目录运行；`gh` 一律带 `-R SingularityKChen/harness-projects`。

### 验证证据（实施者读回）

观察时刻 2026-10-21，检出 `feature/plugin-work-item-pages`，代码 head `d93a79f`（其后只有文档提交，不含代码），Node v26.12.0；行数与 head 是易失值，以重跑为准。变异记录不在此复述，见 `Progress` 与 `Decision Log` D11–D15。

| 命令（在该检出的工作树根目录） | 读回 | 支持 |
|---|---|---|
| `node --test tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-artifact.test.js tests/e2e/client-stream.test.js tests/contract/ui-work-item-list.test.js` | `ℹ tests 48`、`ℹ pass 48`、`ℹ fail 0` | A1 旁证、A2、A4、A7、删除 |
| `node --test tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/web-item-route.test.js tests/contract/ui-work-item-list.test.js` | `ℹ tests 30`、`ℹ pass 30`、`ℹ fail 0` | A4–A6、范围 |
| `node --test tests/contract/client-browser.test.js` | `ℹ tests 2`、`ℹ pass 2`、`ℹ fail 0` | client 仍可按浏览器打包 |
| `node --test tests/integration/ui-work-item-detail-read.test.js` | `ℹ tests 3`、`ℹ pass 3`、`ℹ fail 0` | A2 规则层 |
| `pnpm run boundaries` | `ℹ tests 9`、`ℹ pass 9`、`ℹ fail 0` | A3 |
| `pnpm run typecheck` | exit 0 | 全部 |
| `pnpm run test:mvp0` | `ℹ tests 7`、`ℹ pass 7`、`ℹ fail 0` | — |
| `pnpm run test`（以 root 运行） | `ℹ tests 1705`、`ℹ pass 1703`、`ℹ fail 2`，失败恰是两条已知项：`tests/integration/development-local-git.test.js` 的「拒绝：占用路径、被别处检出的分支与不可访问的目录都不伪造成功」，以及连带的 `tests/contract/run-test-layer.test.js` 的「真实层 tests/integration：非空、全绿，且摘要行被透传」 | 全量 |
| `sudo -u <non-root-user> env "PATH=$PATH" node --test tests/integration/development-local-git.test.js`（`<non-root-user>` 是任一非 root 用户；没有 sudo 时用 `runuser -u <non-root-user> -- env "PATH=$PATH" …`，同样需要 `HOME` 指向该用户） | `ℹ tests 73`、`ℹ pass 73`、`ℹ fail 0` | 判别两条已知失败是环境性的 |
| `node scripts/rule-checks.mjs size origin/main` | 代码 721 / 1000、文档 319 / 1500（增删之和）；计划预算代码 + 测试 ≤ 800、文档 ≤ 1300，均在内，也未触及 760 削减线 | 体量预算 |
| `node scripts/rule-checks.mjs disclosure origin/main` | 「机械扫描通过」，exit 0；五类人工检查未由它替代，已对本批 diff 另行过目 | 发布面 |
| `git diff --check origin/main...HEAD` | 无输出，exit 0 | 空白错误 |
| vertical-path §2.1 订正段的回读：`docs/product/vertical-path.md` 的回读块对 client-stream「supervise：」、harness-plugin-host-watch 四个前缀、harness-plugin-artifact「main 面板用真实 React 渲染」、ui-work-item-app「列表与链接」「断开说明」各跑一遍，并各配伪造前缀的负对照 | 「supervise：」四行 ✔、`ℹ tests 4`、`ℹ fail 0`；其余七个前缀各一行 ✔、`ℹ tests 1`、`ℹ fail 0`；每个负对照 `ℹ tests 0`、`ℹ fail 0` | 订正段的引用不失效 |

未覆盖（独立验收时）：A1 的宿主内证据（S3）当时尚未发生，上表没有任何一行替代它；`apps/harness-plugin/dist` 未构建，`ls apps/harness-plugin/dist` 读回 `No such file or directory`。2026-10-21 S3 已在整合后的 head 上完成，见 Progress。

### 独立验收读回（2026-10-21）

检出 `feature/plugin-work-item-pages`，代码 head `9f327cd`（验收修复 D18；其后只有本文档提交），base `origin/main@f131e68`，Node v26.12.0。远端 head `d52434b` 上 PR #372 的 check 读回 `{"success":15}`、评审线程 0（`gh api repos/SingularityKChen/harness-projects/commits/d52434b/check-runs --jq '[.check_runs[].conclusion] | group_by(.) | map({(.[0]): length}) | add'`）；本地提交未推送。

| 命令（在该检出的工作树根目录） | 读回 |
|---|---|
| `node --test tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-artifact.test.js tests/e2e/client-stream.test.js tests/contract/ui-work-item-list.test.js` | `ℹ tests 49`、`ℹ pass 49`、`ℹ fail 0`（client-stream 多 D18 一条） |
| `node --test tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/web-item-route.test.js tests/contract/ui-work-item-list.test.js` | `ℹ tests 30`、`ℹ fail 0` |
| `node --test tests/contract/client-browser.test.js`；`node --test tests/integration/ui-work-item-detail-read.test.js` | `ℹ pass 2`、`ℹ fail 0`；`ℹ pass 3`、`ℹ fail 0` |
| `pnpm run typecheck`；`pnpm run boundaries`；`pnpm run test:mvp0` | exit 0；`ℹ pass 9`、`ℹ fail 0`；`ℹ pass 7`、`ℹ fail 0` |
| `pnpm run test`（root） | `ℹ tests 1706`、`ℹ pass 1704`、`ℹ fail 2`，恰是两条已知项；按上表的 `runuser -u <non-root-user>` 判别命令读回 `ℹ pass 73`、`ℹ fail 0` |
| `node scripts/workflow-check.mjs`；`node scripts/rule-checks.mjs disclosure origin/main`；`git diff --check origin/main...HEAD` | `no findings（已检查 8 个文件）`；「机械扫描通过」，五类人工目检无命中；无输出 |
| `node scripts/rule-checks.mjs size origin/main` | 代码 729 / 1000（计划预算 800 以内）、文档 361 / 1500（计划预算 1300 以内） |
| `node scripts/review-mutate.mjs <spec>`：实施者的 `batch1` / `batch3` spec 重跑，另写独立 spec（Batch 2 的 M9–M13 与 Y1–Y2 复核 7 个；supervise / 容器 / 壳的新变异 17 个；修复的 F1） | `batch1` 13 / 13、`batch3` 12 / 12、复核 7 / 7、F1 KILLED 且归因正确；独立 17 个中 15 个 KILLED，存活 2 个：V2（`settle` 不关闭已终止的 follower：宿主替身里该代已自行结束，只是防御性 dispose）与 U11（关闭详情写成显式 `itemPath({ projectId })`，D13 的取舍没有用例）——都是 P3 跟进项，不对应验收项 |
| host-watch + client-stream 顺序连跑 15 次；三个文件 6 路并行、每路 4 次（4 核） | 全部 `ℹ fail 0` |
| `docs/product/vertical-path.md` §2.1 订正段的八个前缀按该节回读块各跑一遍并配伪造前缀 | 「supervise：」五行 ✔、`ℹ tests 5`；其余各一行 ✔、`ℹ tests 1`；负对照全部 `ℹ tests 0`；`ℹ fail 0` |

| 验收项 | 证据（变异证明判别力） | 结论 |
|---|---|---|
| A1 宿主内第 3–5 步 | S3（2026-10-21，Desktop 0.2.1-rc.2，head `3cea57f6`），见 Progress 与 #124 评论 | 满足 |
| A2 降级 → 抽屉陈旧标记 + 最后更新时间 | host-watch「来源降级时抽屉显示…」（U12 去掉 `lastUpdatedAt`、X6 帧不发布、X8 说明无条件均红） | 满足 |
| A3 壳只从 ui 引页面 | boundaries 9 / 9；artifact 基线模块表 | 满足 |
| A4 断传输 → 重连态、重拉 baseline | host-watch AC2（M16、S3 壳不转交 `carrierFailed` 均红） | 满足 |
| A5 未知 / 跨 scope 路由中性 | ui-work-item-app「scope 门」（U1、Y1、M9、U8 均红） | 满足 |
| A6 页面替换焦点 | ui-work-item-app「焦点」（U3、U4、U13、M10、M11 均红）；hook 桩 + 桩 DOM，不是浏览器回读 | 满足（按「a test」判定） |
| A7 三种终止有界退避重跟 | client-stream「三种终止」「退避」「同步 close」（M1–M7、V5–V7、F1 均红）；host-watch 卸载与 guarded | 满足 |
| 范围：从链接打开、宿主主题 | 容器层 `initialPath` 有用例；壳不传 `initialPath`，宿主内没有条目深链（TD-072）；主题只经继承，由 S3 目检 | 取舍已定（D30）：TD-072 与「主题只靠继承」均接受；S3 仍待人类伙伴 |

### 跟进项读回（2026-10-21，Batch 5）

检出 `feature/plugin-work-item-pages`，代码 head 为本批最后一个 issue 提交 `a2d9649`（其后只有本文档提交），base `origin/main@f131e68`，Node v26.12.0；本地提交未推送，提交号会随整理改变，以 `git log --oneline origin/main..HEAD` 为准。

| 命令（在该检出的工作树根目录） | 读回 |
|---|---|
| `node --test tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-artifact.test.js tests/e2e/client-stream.test.js tests/contract/ui-work-item-list.test.js` | `ℹ tests 49`、`ℹ pass 49`、`ℹ fail 0`（条数不变：跟进项只加断言） |
| `node --test tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/web-item-route.test.js tests/contract/ui-work-item-list.test.js` | `ℹ tests 30`、`ℹ fail 0` |
| `node --test tests/contract/ui-work-item-list-view.test.js tests/e2e/workspace-read-assembly.test.js` | `ℹ tests 35`、`ℹ pass 35`、`ℹ fail 0` |
| `pnpm run typecheck`；`pnpm run boundaries`；`pnpm run test:mvp0` | exit 0；`ℹ pass 9`、`ℹ fail 0`；`ℹ pass 7`、`ℹ fail 0` |
| `pnpm run test`（root） | `ℹ tests 1706`、`ℹ pass 1704`、`ℹ fail 2`，恰是两条已知项；`runuser -u <non-root-user>` 判别命令读回 `ℹ pass 73`、`ℹ fail 0` |
| `node scripts/workflow-check.mjs`；`node scripts/rule-checks.mjs disclosure origin/main`；`git diff --check origin/main...HEAD` | `no findings（已检查 8 个文件）`；「机械扫描通过」，五类人工目检无命中；无输出 |
| `node scripts/rule-checks.mjs size origin/main` | 代码 774 / 1000（越过 760 削减线、在弹性目标 800 以内，D20）；文档见 `Bottom Change Note` 本批一条 |
| `docs/product/vertical-path.md` 回读块对「supervise：」「列表与链接」「断开说明」 | `ℹ tests 5` / `1` / `1`、`ℹ fail 0`（条数与订正段一致） |

| Issue | 改动（本地提交） | 判别证据（先红 / 变异，手工改源码后 `git checkout --` 还原） |
|---|---|---|
| #377 | client-stream「三种终止来源」：替身句柄的 `dispose` 计数，排定重开前 `disposed` 为 `[0]`，close 后为 `[0, 1]`（`fb8082d`） | V2（`settle` 不 close 已终止的 follower）红：`actual [ 1, 1000, [] ]`，期望 `[ 1, 1000, [ 0 ] ]` |
| #378 | 「列表与链接」末尾：关闭详情之后切到 ws-2，断言出现 ws-2 的条目链接（`7c87e1b`） | U11（`onCloseDetail` 写成 `setPath(itemPath({ projectId }))`）红在这条新断言 |
| #379 | 抽屉标题下一个稳定的 `role=status` 区，内容是列表 view 的 `body.notice`（`28f3c15`） | 先红：「断开说明」在「抽屉打开时…」断言上红；N1 页面不转交、N2 抽屉改用普通 `<p>`、N3 转交 `statusText` 均红 |
| #380 | 「退避」改为宿主结束一代与开场即 gap 交替，延迟序列不变，另断言第 2 代的错误是「第一帧不是 baseline」；TD-073 订正（`ed5bb77`）。本 PR 只钉住实际行为并 `Refs #380`：issue 的验收 1 未满足，去留由人类伙伴决定，决策评论见 D24 订正 | G1（issue 原提议：只在 `report.kind !== 'gap'` 时归零）是等价变异，client-stream 8 / 8、host-watch 7 / 7 全绿，证明不可观测；G2（follower 接受开场 gap，使 gap 成为被接受的帧）红在「退避」 |
| #381 | ADR-0009 Consequences 两条原处追加 Superseded 标注（`a2d9649`） | 文档；两行都是「原文 + 标注」，原文逐字保留 |
| #382 | 状态文字：整表未确认而每条可见条目都已确认时说「部分条目尚未确认，已显示的条目是当前值」（`d8ea4f9`） | 先红：「行新鲜度」与 e2e「partial：」两例红；P1 去掉「至少一条可见条目」、P3 改看含 redacted 的 `list.rows` 新鲜度 →「行新鲜度」红；P2 去掉「每条可见条目已确认」、P4 删掉该分支 → 两例都红；横幅（`b35cd7e`）先红 ui-work-item-list「部分读取（#382）」，B1 横幅不看 `partial`、B2 页首不看 `partial`、B3 派生不暴露 `partial` 均红，B4 凡 stale 皆标 `partial` 使「内容」「真 empty」等四例红 |

### 评审修复读回（2026-10-21）

PR #372 的评审（REQUEST_CHANGES，评审对象 `c5b5da6`，1 P1 / 2 P2 / 3 P3）之后，检出 `feature/plugin-work-item-pages`，代码 head 为本轮最后一个代码提交（其后只有本文档提交），base `origin/main@f131e68`，Node v26.12.0；本地提交未推送，提交号以 `git log --oneline origin/main..HEAD` 为准。变异用 `node scripts/review-mutate.mjs <spec>`，spec 放被忽略的 `.superpowers/229/`。

| 命令（在该检出的工作树根目录） | 读回 |
|---|---|
| `node --test tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-artifact.test.js tests/e2e/client-stream.test.js tests/contract/ui-work-item-list.test.js` | `ℹ tests 50`、`ℹ pass 50`、`ℹ fail 0` |
| `node --test tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/web-item-route.test.js tests/contract/ui-work-item-list.test.js` | `ℹ tests 31`、`ℹ pass 31`、`ℹ fail 0` |
| `node --test tests/contract/ui-work-item-list-view.test.js tests/e2e/workspace-read-assembly.test.js` | `ℹ tests 35`、`ℹ pass 35`、`ℹ fail 0` |
| `node --test tests/contract/client-browser.test.js`；`node --test tests/integration/ui-work-item-detail-read.test.js` | `ℹ pass 2`、`ℹ fail 0`；`ℹ pass 3`、`ℹ fail 0` |
| `pnpm run typecheck`；`pnpm run boundaries`；`pnpm run test:mvp0` | exit 0；`ℹ pass 9`、`ℹ fail 0`；`ℹ pass 7`、`ℹ fail 0` |
| `pnpm run test`（root） | `ℹ tests 1707`、`ℹ pass 1705`、`ℹ fail 2`，恰是两条已知项；`runuser -u <non-root-user>` 判别命令读回 `ℹ pass 73`、`ℹ fail 0` |
| `docs/product/vertical-path.md` 回读块对 client-stream「supervise：」与伪造前缀 | 五行 ✔、`ℹ tests 5`、`ℹ fail 0`（条数不变：D28 只扩既有用例）；负对照 `ℹ tests 0` |
| `pnpm --filter @harness-projects/app-harness-plugin pack:plugin` 连跑两次，`sha256sum` 两个 lib；之后 `rm -r apps/harness-plugin/dist` | 两次一致：`lib/index.js` `21c0d966…`（与评审时相同）、`lib/client.js` `c970ba96…`（`supervise.ts` 改动，评审时是 `3a7510e2…`），全文见 Batch 4 第 1 项；本机 tgz `5be3edec…` 只作环境备注；`test ! -e apps/harness-plugin/dist` 读回 `clean` |
| 变异 K1–K4（D28，`client-stream`）；L1（D29，三个列表文件）；G1、G2 重跑（D24，`client-stream` + `host-watch`） | K1–K4 全部 KILLED，红在「三种终止来源」；L1 KILLED，红在「行新鲜度」，去掉新断言时 47 / 47 全绿；G1 SURVIVED（等价变异，15 / 15 全绿），G2 KILLED，红在「退避」 |

| 评审意见 | 改动 | 判别证据 |
|---|---|---|
| P1 #380 验收 1 未满足却写成关闭 | 本计划 D24 订正、Batch 5、跟进项读回、Progress、D20、Outcomes 改为只 `Refs #380`、去留由人类伙伴决定；#380 发一条英文决策评论（https://github.com/SingularityKChen/harness-projects/issues/380#issuecomment-6309821193，读回与草稿逐字一致）；提交正文与 PR 正文由协调者改 | G1 / G2 重跑见上表 |
| P2 S3 的 tgz 哈希跨环境不可复现 | Batch 4 第 1、3 项、A1 证据、Progress 的 S3 项、D5 改为只比两个 lib，tgz 哈希只作环境备注（D27） | 两次打包读回见上表 |
| P2 L1 措辞与事实不符 | `packages/ui-model/src/work-item-list-view.ts` 注释、`ui-work-item-list-view`「行新鲜度」注释与新断言、ADR-0010 第 15 行本 PR 加的标注（D29） | L1 |
| P3 订阅者或 onRetry 抛错让监督者停摆 | `packages/client/src/supervise.ts` 隔离调用方回调（D28） | 先红读回 `✖ supervise：三种终止来源…` 与 `Error: 订阅者抛错`；K1–K4 |
| P3 本机用户名 | 本计划的判别命令改为 `<non-root-user>`（任一非 root 用户） | 按评审意见里的 `git grep` 回读，本计划不再出现该账户名 |
| P3 vertical-path 承接列写着「草稿」 | 第 4 行改为「由 PR #372 交付；宿主内第 3–5 步观测（S3）待人类伙伴，见 #229 订正段，结论词不变」，第 5 行同样去掉「草稿」 | 文档 |

## Progress

- [x] 2026-10-21 设计评审完成：三份提案（minimal / systems / industry）合并为本计划；评审原型在会话 scratch 里跑通（不入库，见 `Surprises & Discoveries`）。
- [x] 2026-10-21 开工前：计划与 `docs/README.md` 索引已提交（`789133b`）；draft PR #372 关联 #229（读回：`gh api repos/SingularityKChen/harness-projects/pulls/372 --jq '{state,draft,base:.base.ref}'` 期望 `open`、`true`、`main`）
- [x] 2026-10-21 Batch 1 · client 监督者：先红——加四条用例后 `node --test tests/e2e/client-stream.test.js` 在 import 处失败（`does not provide an export named 'superviseWorkspace'`）；实现后读回 `ℹ tests 7`、`ℹ fail 0`（连跑 15 次均 `ℹ fail 0`；7 而不是 8 见 `Surprises & Discoveries`），`node --test tests/contract/client-browser.test.js` `ℹ pass 2`、`ℹ fail 0`，`pnpm run typecheck` exit 0，`pnpm run boundaries` `ℹ pass 9`。变异 `node scripts/review-mutate.mjs .superpowers/229/batch1-mutate.json` exit 0：M1 →「三种终止」（另红「退避」「同步抛错」）、M2 / M3 / M4 →「退避」、M5 →「三种终止」、M6 →「载体断开」、M7 →「同步抛错」，全部 KILLED 且归因正确；另加实现守卫的 X1 删 settle 的 `follower !== current`、X2 删 `start` 里的 `pending = undefined`、X3 `getSnapshot` 每次重读、X5 终止不发布 →「三种终止」，X4 删 `close` 的幂等判定 →「退避」，X6 不透传调用方 `onReport` →「载体断开」，全部 KILLED（D11）。
- [x] 2026-10-21 Batch 2 · ui 应用容器与 codec 归位：改名先行且既有 4 个测试文件 26 / 26 绿；先红 `tests/contract/ui-work-item-app.test.js` 4 / 4 全红（`ui.WorkItemApp` 未导出），实现后 4 / 4 绿；变异 M8–M13 与自加 X1–X11（首挂聚焦、StrictMode 二次挂载、屏键不含工作区、订阅不取自 source、回到列表 / 关闭详情 / 列表点击失效、loading 标题不可聚焦、href 路径形式、`initialPath` 丢弃、loading 提前进门）共 17 个全部 KILLED，归因到所列用例。
- [x] 2026-10-21 Batch 3 · 壳接线与死代码删除：先红——host-watch 改写后 7 例中 5 例红（`h.workspace.getSnapshot is not a function`，`openWorkspaceWatch` 仍返回 follower）；安装件 e 节整节红（旧 `client.ts` 调用已删除的一元 `baseline` 桩而抛 `TypeError`，Cordis 卸载 fiber，`contextNames` / `registrations` 为空，是预期的红）；`ui-work-item-list` 出口例在旧 `index.ts` 上红（`ui.PlaceholderPanel` 是函数）。实现后四个文件 `node --test tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-artifact.test.js tests/e2e/client-stream.test.js tests/contract/ui-work-item-list.test.js` 读回 `ℹ tests 48`、`ℹ pass 48`、`ℹ fail 0`；host-watch 连跑 40 次、四核满载下再跑 20 次均 `ℹ fail 0`（不加 sleep）。变异 `node scripts/review-mutate.mjs .superpowers/229/batch3-mutate.json`：M14 →「main 面板用真实 React 渲染」、M15 →「卸载中止打开的流」与「Host 侧读取异常」、M16 →「载体断开的同一回调内整表 stale」，另加 X1–X9（删 `close` effect、删 `onRetry`、`error ?? …` 去掉、删 carrier 日志、改 `ended` 文案、监督者的帧 / 终止发布、容器的断开说明无条件、壳注入吞掉的 `schedule`）共 12 个全部 KILLED，归因正确（D14）。门：`pnpm run typecheck` exit 0、`pnpm run boundaries` `ℹ pass 9`、`pnpm run test:mvp0` `ℹ pass 7`；`pnpm verify` 以 root 运行读回 `ℹ tests 1705`、`ℹ fail 2`，恰是两条已知失败，`runuser -u <non-root-user>`（任一非 root 用户）下 `development-local-git` `ℹ pass 73`、`ℹ fail 0`；`size origin/main` 读回代码 721（削减线 760 以内，未触发削减）、文档 234；`disclosure` 无命中、`git diff --check origin/main...HEAD` 无输出；未构建安装件，`apps/harness-plugin/dist` 不存在。
- [x] 2026-10-21 Batch 4 · 文档（S3 之外的全部文档项，实施者回填）：`docs/exec-plan/tech-debt-tracker.md` 把 TD-058 移入 Resolved（指本计划，写明验证命令与未覆盖项），TD-057 注「#229 决定保持插件生命周期」，TD-059 注「被拒的倒退 baseline 经监督者 1 s 后由新 store 接受」，按 D10 新增 TD-072、TD-073（TD-069–071 留给并行 PR）；`tests/integration/README.md` 的 host-watch 表改写卸载 / guarded 两行并加降级一行（AC2 行、空数据根行与 e 节段落也因本 PR 变假，一并改写，见 `Surprises & Discoveries`）；`docs/product/vertical-path.md` §2.1 第 4、5 行与「第 4、5 行的 #229 订正」段，宿主内第 3–5 步不写成已交付（D16）；ADR-0010 第 15、44 行原处标注；本计划的验证证据、Interfaces、Outcomes 已回填。`docs/README.md` 未动（索引行归协调者）。读回见 `Validation and Acceptance` 的验证证据。
- [x] 2026-10-21 独立验收完成：逐条对照 #229 正文与评论（含 2026-10-15 的 TD-058 判据；D / E 已移 #366、字段映射已移 #277 / #358，经读回 #366 正文与 #229 Notes 核实），每项找到用例并以变异证明判别力；修复一处 P2（D18，`9f327cd`，先红：新用例修复前读回 `actual: [ 1, 1 ]`、期望 `[ 0, 1 ]`，即 close 之后仍排定了一次重开）；未做重构（D19）。读回见 `Validation and Acceptance` 的「独立验收读回」。A1 仍待 S3。
- [x] 2026-10-21 Batch 5 · 独立验收跟进项 #377–#382（D20）：每个 issue 一个提交并 `Closes`（#380 除外：只 `Refs`，D24 订正）；#379、#382 先红（「断开说明」、「行新鲜度」与 e2e「partial：」），#377、#378、#380 是只加断言的测试提交，分别由 V2、U11、G2 证明判别力；#380 的原提议改动是等价变异 G1，未改 `supervise.ts`（D24）；#381 只改文档。读回与变异见 `Validation and Acceptance` 的「跟进项读回」。
- [x] 2026-10-21 评审修复（PR #372 的 REQUEST_CHANGES，1 P1 / 2 P2 / 3 P3）：P1 #380 只 `Refs`、决策评论已发（D24 订正）；P2 S3 比对门只用两个 lib 的 sha256（D27）；P2 L1 措辞订正并钉住现状（D29）；P3 监督者隔离调用方回调（D28，先红 + K1–K4）；P3 本机用户名改占位符；P3 vertical-path 承接列去掉「草稿」。读回见 `Validation and Acceptance` 的「评审修复读回」。
- [x] 2026-10-21 16:15–16:25 +08 Batch 4 · S3（评审会话加人类伙伴，Desktop 0.2.1-rc.2，冻结 head `3cea57f6`）：
  - **构建**：在干净检出上 `pack:plugin`，两个 lib 为 `lib/index.js` `060f8bdc…`、`lib/client.js` `279c4b15…`，等于 Batch 4 第 1 项末的期望值；本机 tgz `d8531009…` 只作环境备注；`rm -r apps/harness-plugin/dist` 读回 `clean`。
  - **安装**：人类伙伴退出 Desktop，评审会话确认没有 Desktop 进程后，用应用包内的 `dsh plugin --profile desktop` 先 remove 再 add，都是 exit 0（16:15:03 +08）；已装的两个 lib 与构建逐值相同。
  - **数据**：2026-10-15 S3 留下的种子工作区（Local Git 与 GitHub Projects 两个挂载，9 个实体）。
  - **人类伙伴的观测**（截图三张，不入库）：
    - 第 3 步：console 出现 `[harness-projects] watch baseline r=2 gen=1`。
    - 第 4 步：9 个工作项，Issue 5、Draft 3、PR 1，PR 不重复，规划状态显示「未知」（#277）。
    - 第 5 步：点标题打开详情抽屉；Esc 后 `document.activeElement.textContent` 是被点的标题，宿主的 Escape「dismiss」快捷键没有影响回焦。
    - 条目 href 是片段 `#/projects/<工作区>/items/<条目>`；点标题前后 `location.href` 都是 `dsh-app://app/`，宿主不用 hash 路由。
    - 宿主主题与系统主题不同时，列表和抽屉在浅色、深色下都可读。
  - **已知限制**：页面处于降级态，原因是启动时 Host 记了两条 `credentialFailed`（`CredentialServiceUnavailable`，16:16:30 +08，即 TD-056 的启动凭据竞态），启动后也没有刷新（#335）。页面显示标了 stale 的最后已知值，「最后读取时间未知」，不冒充当前值。console 里其余的错误来自宿主自身：`[deepseek-account] account read failed`、`dsh-app://app/plugins/events` 的 ERR_FAILED、一个 `api/ch…` 404。
  - **#124 评论**：人类伙伴批准原文（所选答复「批准，按原文发布 (Recommended)」）后，评审会话用开发账号发布：https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-6311541086。A1 成立。
- [x] 2026-10-21 归档：移入 `docs/exec-plan/completed/`，`docs/README.md` 改为 Completed；`docs/exec-plan/tech-debt-tracker.md`（TD-058、TD-072、TD-073）、ADR-0010 标注与 `docs/product/vertical-path.md` 订正段里的路径同步改为 completed。

- [x] 2026-10-21 评审会话接手收尾（D31）：变基到 main `3391c01d`，整合为五个交付物级提交；`pnpm verify` 1711/1711、MVP-0 7/7；`pack:plugin` 后 artifact 23/23；两个 lib 的期望哈希重算为 `060f8bdc…`、`279c4b15…`。
## Surprises & Discoveries

- 2026-10-21（评审原型，基于 `main@f131e68` 的源码，不入库）：按本计划写的监督者与容器原型在 Node 26 上跑通：四条 supervise 用例、四条容器用例、一条真实 Host 组合降级用例；对应本计划 M1–M6 与 M8–M12 的变异全部红（M7、M13 未在原型里跑）。原型第一版里「新 follower 打开即清空显示」存活，补了 `gate`（新 baseline 前断言仍是旧值）才红——Batch 1 的用例必须带这一步。
- minimal 提案原型的 `read()` 在新 follower 接受了无工作区的 baseline 之后仍回落到旧 follower：宿主重组到空库时会一直显示旧工作区。改为「最后一个接受过帧的 follower」（Design / Spec client 第 3 条）。
- `tests/contract/ui-work-item-detail-browser.test.js:18` 的 `ALLOWED` 不许 `packages/client/src` 运行时进入 ui 的 bundle：容器只能 import client 类型，监督者因此留在 client、由壳注入。
- 安装件测试的 vm 上下文没有 `setTimeout`：监督者吸收同步抛错后要排定重开，不补就会在注入回调里抛 `ReferenceError`、撤回面板（真实浏览器有该全局）。
- 真实 bundle 在 vm 里接主 realm 的 React 可正常 `renderToStaticMarkup`（原型 esbuild 构建核对），artifact 的真实渲染用例可行。
- 全局 mock 计时器会冻住 controller watch 的轮询（host-watch 用 `watchIntervalMs: 5`），所以监督者要可注入 `schedule`。
- #366 正文没有承接 2026-10-04 评论第 1 条（partial 读取的状态文字）；ADR-0010 第 15 行仍写 D / E「由 #229 关闭」，#351 之后已不成立。
- 2026-10-21（Batch 1 实现）：Batch 1 验证写的期望 `ℹ tests 8` 数错了：`main@f131e68` 上 `node --test tests/e2e/client-stream.test.js` 读回 `ℹ tests 3`，加本批四条后是 7，按 7 判定。
- 2026-10-21（Batch 1 实现）：设计估算偏低。提交前 `git diff --numstat` 读回 `packages/client/src/supervise.ts` +92（估 60，多出的是接口注释与 `close` 的收尾次序）、`index.ts` +1、`stream.ts` +2 −1、`tests/e2e/client-stream.test.js` +104 −5（估 75）；Batch 3 回读 `size` 时按实际值核对 760 削减线。
- 2026-10-21（Batch 2 实现）：`tests/contract/ui-work-item-detail-browser.test.js` 的 `ALLOWED` 里 `apps/web/src/(item-route|index).ts` 在改名后还留着一个不存在的 `item-route` 分支，会放行重新出现在 apps 的第二份 codec；与 `REQUIRED` 一起收紧为只许 `index.ts`（计划只点名了 `REQUIRED`）。
- 2026-10-21（Batch 3 实现）：host-watch 新增的降级用例第一版 25 次里红 4 次（`降级：抽屉说最后已知值`）：种子工作区含一条 redacted 行，`store.list()` 的顺序随随机 `entityId` 变，取 `[0]` 时抽屉对它只说「内容不可见」。不是时序问题；改为取第一条非 redacted 行后连跑 40 次、满载 20 次全绿。AC2 的「行全 stale」同理不能数 `<tr>`：redacted 行没有新鲜度格，改为数 `<span>当前值</span></td>` / `<span>最后已知值</span></td>` 的格数，与在线时的条目链接数比较。
- 2026-10-21（Batch 3 实现）：`apps/harness-plugin/src/host-surface.ts` 的 `RemoteNamespace.baseline()` 在壳删除一元调用后不再有壳内调用方；该文件归 PR A（#352）、本 PR 零改动，类型留着（`baseline` 远程操作本身仍由 Host 测试使用）。
- 2026-10-21（Batch 4 文档）：`tests/integration/README.md` 的 host-watch 表计划只点名卸载 / guarded / 降级三行，但 AC2 行（现在还断言页面出现重连说明、无重开）、空数据根行（`read()` 已不存在，改为监督者的 `getSnapshot()`）与表后 e 节段落（`setTimeout` 注入、真实 React 渲染、取消待定重开）的描述也因本 PR 变假，一并改写；否则文档与 `tests/integration/harness-plugin-host-watch.test.js`、`harness-plugin-artifact.test.js` 的用例标题自相矛盾。
- 2026-10-21（Batch 4 文档）：vertical-path §2.1 第 5 行的缺口「`deriveWorkItemDetail` 的陈旧标记没有经入口的用例」被 host-watch「来源降级时抽屉显示最后已知值与原确认时刻」补上（core 自己产生的降级 metadata 帧 → controller watch → client → 详情路由的 `WorkItemApp`），但第 4、5 行的结论词不变，且宿主内证据仍缺，见 D16。ADR-0010 第 15 行引用 #229 关闭 D / E，经 `gh api repos/SingularityKChen/harness-projects/issues/366` 读回其正文「Moved out of #229 on 2026-10-16 by the re-plan in #351」，标注日期取自它。
- 2026-10-21（Batch 4 文档）：tracker 的 Resolved 行保留原 ExecPlan 列（TD-058 仍指 `docs/exec-plan/completed/2026-10-15-host-watch-stream.md`），解决说明写在「下一步」列末尾并指向本计划，与 TD-020、TD-047、TD-049 同形；TD-072、TD-073 紧接 TD-068 追加，并行 PR 的 TD-069–071 会落在同一位置，rebase 时逐行合并、保持 ID 升序。
- 2026-10-21（Batch 3 实现）：`packages/ui/src/placeholder.ts` 删掉 `PlaceholderPanel` 与 `PLACEHOLDER_DESCRIPTION` 后只剩 `HARNESS_PANEL_TITLE` 与 `PlaceholderIcon`，文件名保留（计划只要求删面板及其出口），头注释改写为「面板标题与入口图标」。
- 2026-10-21（独立验收）：`retry` 先发布、再 `onRetry`、最后才排定。订阅者或 `onRetry` 在这次发布里同步 `close()` 时，`close` 取消不到尚未登记的 `pending`，重开仍被排定，之后在 close 之后打开一个没人关闭的 follower。现有接线走不到（React 的订阅回调只排渲染，`close` 只由 Cordis fiber 卸载触发），按 P2 处理，见 D18。修复后实施者的变异 X1（删 settle 的「本方 close 不算终止」）一度存活：它原先只靠「close 之后又排定了计时器」被判别，现在改由「close 之后 `onRetry` 不再被调用」判别。
- 2026-10-21（独立验收）：PR #372 的描述仍停在只提交了计划的状态（「Only the ExecPlan is committed」，验证项未勾），转 ready 之前要按本计划的读回改写；本 PR 未改 `docs/review` 与 ADR-0009，ADR-0009 第 79 行「占位面板文案未本地化」的暂缓项随占位面板删除已无对象，留作文档跟进。（Superseded 2026-10-21：已由 #381 在本 PR 内原处标注，D26。）
- 2026-10-21（Batch 5）：#380 的前提不成立。`followWorkspace` 要求每代第一帧是 baseline（`packages/client/src/stream.ts` 的 `consume`），非 baseline 的开场帧抛错终止、不回报，所以每个 follower 的第一个回报必是 baseline，`failures` 在任何 gap 报告之前已经归零：「gap 也归零」不可观测，把归零条件收窄的等价变异 G1 在 client-stream 与 host-watch 上全绿。issue 描述的「开场即 gap」宿主走终止分支，本来就累加退避。真正约 1 s 一次、从不退避的是「先 baseline、一个轮询间隔后 gap」的代：follower 按 #276 协议在同一句柄上 `restart()`，宿主立即开下一代（`tests/fixtures/remote-stream-double.js` 的 `restart`），节奏只由 Host `streamWorkspace` 的 `intervalMs`（插件缺省 1000，`apps/harness-plugin/src/host-composition.ts`）决定，不经监督者。
- 2026-10-21（Batch 5）：#378 设想的「抽屉打开时工作区变化、再关闭抽屉」走不到：scope 门在工作区变化时就用 unresolved 替换整页，抽屉卸载且 cleanup 不导航（`packages/ui/src/work-item-detail.ts`）。D13 两种写法的差别只在关闭详情之后工作区再变化时出现。
- 2026-10-21（Batch 5）：#379 里容器找不到一个两种状态都可感知的单一位置：`showModal` 让模态之外的内容一律 inert（不可交互、不进无障碍树），而抽屉只在打开时存在。
- 2026-10-21（Batch 5）：#382 的 e2e「partial：」原断言 `/尚未确认/` 对新文字「部分条目尚未确认，…」同样匹配，不收紧就测不到改动。另外，若按「已显示的条目都已确认」把 redacted 条目自身的新鲜度也算进去（`list.rows`），表级缺口下状态文字会随遮蔽条目新鲜与否而变；改动前这两种情形文字相同，这会新增 ADR-0010 L1 不接受的遮蔽通道（变异 P3 即这一写法）。
- 2026-10-21（Batch 5）：本计划 Batch 1–4 与独立验收引用的提交号（`789133b`、`cff3277`、`a12f03f`、`f7d3682`、`d93a79f`、`9f327cd`）已不在分支历史里：分支整理后是 `40f70e0` 起的六个提交（`git merge-base --is-ancestor cff3277 HEAD` 读回非祖先）。这些号只是当时的观察标签，复核以各节的回读命令为准。
- 2026-10-21（评审修复）：tgz 的 sha256 跨环境不可复现。评审者在 macOS（Node 26.11.1、pnpm 10.28.2）对评审 head 打包两次，tgz 都是 `48d2b0cc…`，PR 正文给的 Linux 值是 `69d0bd17…`；两个 lib 逐字节一致。tar 条目已归一化（mtime、uid、mode），差异很可能来自 gzip 实现（评审者的推测，未拿到对方的未压缩 tar 比对）。#276 的先例本来只把两个 lib 当门（`docs/exec-plan/completed/2026-10-15-host-watch-stream.md` 的 Phase 0），本计划写成了三个。
- 2026-10-21（评审修复）：#382 的代码注释、测试注释与 ADR-0010 标注把 L1 说成已守住，实际只在表级已有原因时成立。没有表级原因时，`list.stale` 经 `degradationOf` 仍因 redacted 条目 stale 而为真，可见条目都已确认时文字就在 partial 与「已读取当前快照」之间随遮蔽条目的新鲜度切换。这是 main 上 #129 既有的 1 bit 通道（base 上在「最后已知值不是当前值」加横幅与「已读取当前快照」之间切换），本 PR 没有放大，只换了措辞；新措辞在没有可见行未确认时等于直接指向被遮蔽的条目。变异 L1（partial 另要求表级原因）在没有新断言时三个列表文件 47 / 47 全绿，说明此前没有用例钉住这一格。
- 2026-10-21（评审修复）：监督者的 `publish` 与 `onRetry` 不隔离调用方代码。终止发布里一个订阅者抛错，后面的订阅者收不到通知，重开不排定，`settle` 的 promise 链以 unhandled rejection 结束；close 的发布让 `close()` 本身 reject。先红读回 `✖ supervise：三种终止来源…`、`Error: 订阅者抛错`。生产里唯一的订阅者是 React 的 `handleStoreChange`，壳的 `onRetry` 是 `console.error`，都不会抛，所以是 P3。

## Decision Log

以下均为 2026-10-21，设计评审（Claude Opus，独立评审 subagent），人类可推翻。

- D1 路由：codec 整文件 `git mv` 进 `packages/ui` + 容器内 `useState` 路由 + 片段 href。选项：(a) 内存 `HistoryPort` + `createItemNavigation`（minimal）；(b) `useState` + 路径 href（systems）；(c) 片段 href + 把 History adapter 拆回 `apps/web`（industry）。证据：A5 要求解析字符串路由（未知路由），ui 不能 import apps；宿主导航是面板选择、客户端面无 URL 路由（spike §6.1）；ADR-0010 的部署事实。取舍：整文件改名按 numstat 计 0 行，拆分多约 100 行而无验收需要，代价是 ui 出口多带 History adapter（它只经端口碰全局，ui 规则禁止的是外部平台 API）；`useState` 比端口 + effect 少约 12 行；片段 href 在点击未被拦截或修饰键打开时只改 hash，不把宿主文档导航到未知服务端路径，locator 也不进请求与 referrer。代价：宿主里没有指向条目的深链（D10 债）。
- D2 监督者：`superviseWorkspace(connect, options)` 在 client 内拥有全部发布点，而不是 minimal 的 `keepFollowing(open(changed))`（壳要记得在帧与载体失败时调 `changed`，#276 计划第 883 行交接的订阅点被摊到壳里）。快照只是 `ClientWorkspaceRead | undefined`，不加 systems 的状态联合：没有验收区分「重连中」与「退避中」，一句说明足够。方法名 `close()` 与同包 `WorkspaceFollower` 一致。退避 1 s 起翻倍、30 s 封顶（gRPC connection-backoff 形状）；不加 jitter：单用户、回环宿主、每窗口一条流，没有要打散的并发重连，且免去注入随机数；按被接受的帧归零（与宿主 `RemoteStream` 的 `accept()` 清零一致，`tests/fixtures/remote-stream-double.js:5,63`），不取 client-go 的时间窗归零：它只多覆盖「每代都先接受 baseline 再失败」，而 baseline 与轮询读同一个 `controller.baseline()`，该情形罕见，残余记为债；`schedule` 注入而非全局 mock 计时器（见 Surprises）。首次 `connect` 同步抛错按终止吸收（minimal），不像 systems / industry 那样外抛再由壳兜底，面板恒挂容器。
- D3 D38 的 try/catch 删除：它保护的性质（`$stream` 同步抛错不撤回面板）由监督者不抛错保证，安装件「同步抛错也不丢面板」用例保留并改期望；本机有宿主包时按 TD-060 以 `HARNESS_CORDIS` 复跑。`apply` 次序改为先开监督者再注册插槽（D32(3) 的次序理由随之失效）。
- D4 焦点：Node 测试用 hook 调度器桩驱动 `WorkItemApp` 的 effect（先例 `tests/contract/ui-work-item-detail.test.js`），不导出纯判定函数、不加浏览器 fixture 入口、不引入 Playwright。规则取 WAI-ARIA APG 对话框「调用者不复存在时把焦点放到逻辑上的下一处」，只在焦点已丢失时移动、首挂不移动、不抢宿主焦点。宿主内触发不了 scope 变化（要 #354），S3 只记 Esc 回焦。
- D5 S3 分工：PR 交付冻结 head、三个 sha256、可安装 tgz 与自动化旁证（2026-10-21 订正：比对门只用两个 lib 的 sha256，tgz 哈希跨环境不可复现，只作环境备注，见 D27）；人类伙伴安装、走第 3–5 步、核对主题与焦点、同意 #124 评论。字节在 S3 之后再变时按 D22 / D38 先例处理。
- D6 删除：`PlaceholderPanel`；`client.ts` 的一元 `baseline()` 调用与日志（watch 的开场 baseline 已覆盖，S3 改看 `watch baseline` 日志）。`baseline` 远程操作本身由 PR A 声明、Host 测试仍在用，不删。
- D7 A2 用例放在 host-watch：真实 Host 组合、core 自己产生的降级 metadata 帧、壳的 `openWorkspaceWatch`、监督者与容器整条链；视图层规则复用既有 `ui-work-item-detail-read` 用例，不重写。
- D8 断开说明走 `metadata.safeNotice`、`phase: 'received'`、`refreshing: false`；不用 `refreshing: true`（那是 #360 的「正在刷新」语义）。
- D9 TD-057：流保持注入 fiber（插件）生命周期，不随面板开合：随面板开合每次切换都要全量 baseline 并丢失最后已知值，计数引用又是新状态。
- D10 新债（编号提议 TD-072、TD-073，落表前与并行 PR 去重）：TD-072 插件内路由随 `main` 插槽卸载重置，href 是片段且加载时不读，宿主里没有条目深链，宿主 URL 路由面仍未确认（触发：宿主提供导航 API 或需要深链）；TD-073 退避按被接受的帧归零，接受 baseline 后每代都失败的宿主约每「1 s + 失败时延」重开一次，每次多一次全量快照读，guarded 时多一行无轮转的诊断日志（TD-056）（触发：诊断日志出现约 1 s 节奏的重复 `operationFailed`；下一步改时间窗归零）。
- D11（2026-10-21，实现者（Claude Opus），Batch 1）：四条用例之外多三处断言——「三种终止」里本方 `close` 之后 `timers` 仍只有那一次且未被取消、两次发布之间 `getSnapshot()` 是同一对象；「载体断开」里调用方 `onReport` 收到同一句柄上的两代。理由：实现里的每个守卫（settle 的「本方 close 不算终止」、`start` 清 `pending`、快照缓存、`close` 幂等、终止时发布、`onReport` 透传）都要有能杀死变异的用例，计划的四条只覆盖 M1–M7。代价：测试多约 6 行。
- D12（2026-10-21，实现者（Claude Opus），Batch 1）：`done` 未经本方 `close` 而 resolve 也按终止处理，`onRetry` 收到的 error 是 `undefined`（宿主 `RemoteStream` 只在 dispose 之后正常结束，这一支只对其它 `GenerationStream` 实现可达，Batch 3 的日志可能打出 `undefined`）；`start` 不再判 `closed`，被取消的重开不运行由 `schedule` 的取消函数保证（缺省 `clearTimeout`），注入的调度器必须遵守。
- D13（2026-10-21，实现者（Claude Sonnet），Batch 2；人类可推翻）：关闭详情与 unresolved 屏的「回到工作项列表」都 `setPath(undefined)`（跟随当前工作区），不写成显式 `itemPath({ projectId })`，否则路由被钉在旧工作区、工作区一变又落到 unresolved。焦点 effect 用 ref 记上一屏键，`previous === undefined || previous === key` 都不动焦点：StrictMode 的二次挂载依赖数组拦不住，只有 ref 守得住（变异 X1 / X2 证明）。回到列表按钮的点击用例是计划之外加的，没有它变异 X5 存活。
- D14（2026-10-21，实现者（Claude Sonnet），Batch 3；人类可推翻）：D12 的 `onRetry(undefined, …)` 在壳里记成 `error ?? '流正常结束'`，不打印 `undefined`；安装件 e 节加一例（桩流正常结束 → 1 s 重开、日志第四项是该文案，变异 X3 证明）。理由：该分支只对非宿主 `GenerationStream` 可达，但日志行是 S3 里人读的证据，值得多约 8 行测试；不改 client 的 `onRetry` 签名。
- D15（2026-10-21，实现者（Claude Sonnet），Batch 3；人类可推翻）：安装件 e 节的 vm 上下文注入记录型 `setTimeout` / `clearTimeout`（只记 `delayMs` 与 `cancelled`），`applyClient` 恒用真实 React（`evaluateClientBundle` 的第三参数，缺省仍是 d 节的记录型 `createElement`）。理由：用取消标记证明「卸载后不再有第二行」，不真等 1 s、不 sleep；真实 React 让「main 面板用真实 React 渲染」与其余用例共用同一次 `apply`。host-watch 的 `schedule` 同理是手动调度，`fire()` 先摘掉最早排定的一次再运行，所以 `timers` 恒等于仍在等待的重开。
- D16（2026-10-21，实现者（Claude Sonnet），Batch 4 文档；人类可推翻）：vertical-path §2.1 第 4、5 行不改结论词。第 4 行仍是 #218（X3）的反例（#218 仍开放，本 PR 不碰 client 同步的修订接受）。第 5 行仍是「部分」，缺口由「陈旧标记、controller 入口」收窄为「controller 入口」加「宿主内详情」，依据是 host-watch 降级用例经入口（真实 `createHostComposition` 的降级 metadata 帧 → controller watch → client → `WorkItemApp` 抽屉，不是桩 store），原「没有经入口的用例」原处标 Superseded。宿主内第 3–5 步（S3）未发生，所以两行都不写宿主内已交付，S3 之后再按该节规则更新。理由：该节规则「只往保守方向修正；反向升级需要 Decision Log 证据」，这里没有升级结论词，只收窄缺口。
- D17（2026-10-21，实现者（Claude Sonnet），Batch 4 文档；人类可推翻）：TD-058 在独立验收与 S3 之前就移入 Resolved。依据：Resolved 表头要求「当前 head 的测试和产物回读」，A7 的判据（三种终止各有测试、有界退避后新 follower 跟随）已由 client-stream 与 host-watch 在本 head 读回，S3 观察的是宿主内面板而不是 TD-058 的重开行为；解决说明里写明未覆盖项（Desktop 宿主内观测、第三种来源只有 client-stream 覆盖、TD-059 根因）。若独立验收否决 A7，就把该行移回 Open。TD-057、TD-059 只加注、仍为 Open。
- D18（2026-10-21，独立验收（Claude Opus）；人类可推翻）：只在未关闭时排定重开（`if (!closed) pending = schedule(…)`），而不是恢复 `start` 开头的 `closed` 判定。选项：(a) `start` 判 `closed`：计时器仍会排定、到点空跑，`onRetry` 照样记一行；(b) `retry` 排定前判 `closed`：不留计时器、不开 follower，零行增量。取 (b)。`onRetry` 仍在判定之前调用，所以在发布里同步 close 时壳可能多记一行 `watch failed`；不再挪动次序，因为 close 发生在 `onRetry` 里时 (b) 同样要覆盖。A7 结论不变；TD-058 维持 Resolved（D17 的条件「独立验收否决 A7」未发生）。
- D19（2026-10-21，独立验收（Claude Opus））：不做重构。逐个看过 `supervise.ts`、`work-item-app.ts` 与壳，能省的只有一两行（如 `close` 里合并 `current` 的两步），既不降低风险也不更清楚；代码 729 / 800 有余量。V2、U11 两个存活变异与 P2 / P3 跟进项列在 `Outcomes & Retrospective`，不在本 PR 扩大测试面（#351 D2）。
- D20（2026-10-21，人类伙伴；协调者转述，原话照录）：「这些 P2/P3 不应该你自己修复吗？超过弹性 800 行没有关系。但在实现前你应该自己想一想有没有办法简化改动呀。怎么什么小问题都建 issue 呢？请你在现有 PR 中实现并 link 对应 issue」。含义：独立验收列出、已建为跟进 issue 的 #377–#382 在本 PR 内实现，每个提交以 `Closes #N` 关闭对应 issue（2026-10-21 评审订正：#380 的验收未满足，只 `Refs`，人类原话没有授权按新解释关闭它，见 D24 订正）；800 行是弹性目标（CI 硬限代码 1000、文档 1500 不变），所以 `Global Constraints` 的 760 削减线不再执行；动手前先找删除或收窄代码、收紧既有断言的改法。对这六个 issue，它取代 #351 D2「P2 / P3 → M4.1 issue」的分流，并推翻 D19 后半句「不在本 PR 扩大测试面」。
- D21（2026-10-21，实现者（Claude Opus），#377）：选项 (a) 新增一条只测释放的用例；(b) 在「三种终止来源」表驱动用例里给替身句柄的 `dispose` 计数。取 (b)：一次覆盖三种来源，排定重开前与 close 之后各一条断言即杀死 V2，vertical-path 回读块的「supervise：」条数不变。
- D22（2026-10-21，实现者（Claude Opus），#378）：issue 设想的场景走不到（见 `Surprises & Discoveries`），取其意图：在「列表与链接」关闭详情之后切换工作区，断言显示新工作区的列表。只加两行，不新增用例；unresolved 屏「回到工作项列表」那一半已由「scope 门」用例钉住。
- D23（2026-10-21，实现者（Claude Opus），#379）：选项 (a) 容器在根 `section` 里单独渲染一次说明——模态打开时 inert，不满足验收；(b) 给 `WorkItemDetailView` 加 `notice`——要改 ui-model 类型与 PR #373 可能碰的派生；(c) `WorkItemProjectPage` 把同一个列表 view 的 `body.notice` 交给抽屉。取 (c)：只改 ui 两个文件，`safeNotice` 仍只在容器设一次；抽屉用标题下稳定的 `role=status` 区，打开期间断开也会被宣告。代价：抽屉打开时 DOM 里有两份说明，列表那份 inert、不被宣告。
- D24（2026-10-21，实现者（Claude Opus），#380）：选项 (a) 照 issue 把归零条件收窄为 `report.kind !== 'gap'`——等价变异 G1，加进去是测不到的死守卫；(b) 让 gap 终止 follower、交监督者退避——改 #276 的每代协议，且开场 baseline 仍归零，单凭它到不了 2 s；(c) 不改 `supervise.ts`，把「开场即 gap 的宿主照常累加退避」钉进既有「退避」用例，同一句柄上的 gap 循环记入 TD-073。取 (c)。issue 的验收「gap 归零时测试变红」无法满足（gap 报告到不了计数器），判别证据改为 G2；TD-073 不 resolve，它记的「先 baseline 再失败」仍开放，只加订正与第二个触发信号。**订正（2026-10-21，评审修复（Claude Opus））**：验收 1 未满足就不能关闭 #380。本 PR 只钉住实际行为（开场即 gap 照常累加退避）并 `Refs #380`；前提不成立的证据（G1 等价、G2 判别）与真实残余（先 baseline 后 gap 时 follower 按 #276 在同一句柄上 `restart()`、不经监督者，每个 Host 轮询间隔重拉一次全量 baseline，TD-073）写在 #380 的决策评论里（https://github.com/SingularityKChen/harness-projects/issues/380#issuecomment-6309821193）；按 not planned 关闭（TD-073 继续跟踪），还是把验收改写成同一句柄上的重开循环并修复（`stream.ts` 让 gap 之后的 follower 终止交给监督者，加上 `supervise.ts` 按时间窗归零），由人类伙伴决定，本 PR 不替他选。
- D25（2026-10-21，实现者（Claude Opus），#382）：改动只在 `deriveWorkItemListView` 的状态文字派生（一个 `partial` 判定加一条分支），`rowView` 与 `sourceNames` 不动（PR #373 会改那里）；这是 `Global Constraints`「`packages/ui-model` 零改动」的唯一例外。判定只看可见行（理由见 `Surprises & Discoveries`）；没有可见 item 行时仍用原文字，因为「已显示的条目是当前值」无所指。协调者复核后要求横幅一并修（2026-10-21）：派生把同一判定作为可选的 `body.partial` 暴露（只在为真时出现），列表在部分读取时不出「最后已知值」横幅、页首像已确认的内容一样给出「当前值（最后读取：…）」；整页失败、冷启动、刷新与断网不受影响。
- D26（2026-10-21，实现者（Claude Opus），#381）：只在 ADR-0009 Consequences 两条的末尾追加带日期的 Superseded 标注，原文逐字保留（`docs/adr/README.md`，与本 PR 对 ADR-0010 的标注同形）；「client 根出口仍不能按浏览器打包」更早已由 #308（2026-10-13）解决，标注如实写出，不归给 #229。
- D27（2026-10-21，评审修复（Claude Opus））：S3 的比对门只用 `lib/index.js` 与 `lib/client.js` 的 sha256。tgz 哈希只在本机记录，作为环境备注贴进 #124；`gunzip -c <tgz> | shasum -a 256` 只作参考，因为没有在第二个环境验证它可复现。理由：评审在 macOS 上得到不同的 tgz 哈希，两个 lib 却一致，按 tgz 比对会让人类在 S3 第 1 步停下或误判产物被篡改；做法与 #276 的先例一致。期望值随本轮代码重算：`supervise.ts` 的改动让 `lib/client.js` 从 `3a7510e2…` 变为 `c970ba96…`，`lib/index.js` 不变，全文写在 Batch 4 第 1 项。
- D28（2026-10-21，评审修复（Claude Opus））：监督者逐个隔离订阅者与 `onRetry`，抛错时用 `console.error` 记一行。选项：(a) 在 `retry` 里用 try/finally 保证排定，只改一行，但异常仍以 unhandled rejection 冒出，后面的订阅者仍收不到，close 的发布仍让 `close()` reject，`connect` 同步抛错的路径还会从构造或计时器回调里抛出；(b) 逐个隔离，多 4 行，一处覆盖帧、载体、终止、close 四个发布点和 `onRetry`。取 (b)。D18 的 `closed` 判定与次序不变：排定仍在发布与 `onRetry` 之后。调用方的 `onReport` 不隔离，它抛错按一次终止退避重开，不会停摆。判别：「三种终止来源」表驱动用例多跑一轮 throwing（`onRetry` 记录后抛错，另有一个排在记录者之前、只在断开时抛错的订阅者），不新增用例；K1 订阅者不隔离、K2 `onRetry` 不隔离、K3 吞掉不记、K4 整个循环共用一个 try，全部红在该用例。
- D29（2026-10-21，评审修复（Claude Opus））：L1 的三处说法按事实改写：代码注释、测试注释，以及 ADR-0010 第 15 行本 PR 加的标注（ADR 原文不动）。「行新鲜度」末尾加一条断言钉住现状：没有表级原因时，redacted 条目 fresh 显示「已读取当前快照，共 2 项」，degraded 显示 partial 文字，注明由 #366 翻转。本 PR 不关这条通道：它是 #129 既有行为，由 #366 验收 1 承接（整表新鲜度改按可见行计算），超出 #229 的范围。
- **D30 待决项的结论（2026-10-21，由评审会话转达；人类原话照录，其余是评审会话按人类授权调研后的决定，人类可推翻）**：人类对 S3、TD-072、主题、#380 的答复原话是「由你调研相关类似实现后综合判断」。
  - TD-072 接受：同类宿主把面板内路由、隐藏后保留状态、深链分三层，后两层都要宿主提供入口（VS Code 的 `registerUriHandler` 与 webview `getState`、Obsidian 的 protocol handler、Raycast deeplink），本宿主没有导航 API；S3 顺带确认宿主不用 hash 路由。
  - 主题只靠继承，接受：VS Code、Figma 注入主题变量是因为面板是隔离 iframe，本插件像 Obsidian 一样挂在宿主文档里；S3 的主题目检在「宿主主题与操作系统主题不同」时深浅各看一遍。
  - #380：本 PR 只引用、不关闭（D24 订正）；处置定为 not planned 关闭，残余由 TD-073 承接、不在两处追踪；决定评论与关闭由评审会话在本 PR 合并时做，开发会话不动 #380。TD-073 的「下一步」补：时间窗归零的窗口不小于 30 s 封顶，否则 1 s 轮询的循环仍会被重置（gRPC connection-backoff 收到 SETTINGS 才重置；client-go `DelayWithReset` 在 2 min 没有退避调用后才重置）。
  - S3 仍由人类伙伴在本轮修复后的新 head 上做：期望值只比对两个 lib 的 sha256（D27），Desktop 版本按实际的 0.2.1-rc.2 记。
- **D31 评审会话接手收尾（2026-10-21，评审会话（Claude Opus）；人类可推翻）**：第二轮复评 APPROVE（review `5596322633`，只剩 PR 级 P3）后，由评审会话接手本 PR 的收尾。
  - 变基到含 #348、#370 的 main，只有 tracker 相邻行一处冲突，两边保留。
  - 提交整合为交付物级的五个：plan → client → ui（含 codec 原样迁移与 #378、#379、#382）→ apps → docs。`Closes` 随交付物移动：#377 在 client，#378、#379、#382 在 ui，#229、#381 在 docs。提交正文里以 `#` 开头的行改为「issue #…」。每个中间提交的 typecheck 与本层测试都通过。
  - #370 的改动打进了两个 lib，所以 S3 的期望哈希按变基后的代码重算（Batch 4 第 1 项）。
  - 宿主内 S3 由人类伙伴在整合后的 head 上做，之后回填并归档。

## Idempotence and Recovery

- 所有测试离线、可重复；host-watch 每例在自己的临时数据根里组合并在 `t.after` 有上限地清理。变异工具按字节还原，不依赖 git；spec 与笔记只放被忽略的 `.superpowers/229/`。
- `git mv` 可由 revert 还原；Batch 2 之后 `apps/web` 的公共 API 与 `tests/contract/web-item-route.test.js` 不变。
- 每批单独提交、单独可 revert；Batch 3 revert 后回到占位面板。已推送分支整理提交前先建 backup ref，再用精确的 force-with-lease。
- `pack:plugin` 可重复，但每次之后都要删除 `apps/harness-plugin/dist` 并确认 `clean`；S3 证据绑定两个 lib 的 sha256，冻结后再改代码就重算并按 D5 处理。
- Batch 4 的文档提交可单独 revert，tracker 行按 ID 还原；它不含任何代码，也不触发 S3。
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
export function superviseWorkspace(connect: (carrierFailed: () => void) => GenerationStream, options: SuperviseOptions = {}): WorkspaceSupervisor

// packages/ui/src/work-item-app.ts（index 导出）
export interface WorkspaceSource { subscribe(listener: () => void): () => void; getSnapshot(): WorkspaceRead | undefined }
export function WorkItemApp(props: { readonly source: WorkspaceSource; readonly initialPath?: string | undefined }): ReactElement
export function bindWorkItemApp(source: WorkspaceSource): () => ReactElement

// packages/ui/src/item-route.ts（自 apps/web 改名，签名不变；ui 与 apps/web 的 index 都导出下面这些，apps/web 从 ui 转导出）
export { parseItemRoute, itemPath, browserHistoryPort, createItemNavigation }; export type { ItemRoute, HistoryPort }
// 删除：packages/ui 的 PlaceholderPanel 及其出口；HARNESS_PANEL_TITLE 与 PlaceholderIcon 保留
// packages/ui/src/work-item-detail.ts（#379，Batch 5）：抽屉多一个可选的页面级说明，WorkItemProjectPage 传入列表 view 的 body.notice
export function WorkItemDetailDrawer(props: { view: WorkItemDetailView; notice?: string | undefined; onClose: () => void }): ReactElement

// apps/harness-plugin/src/workspace-watch.ts
export function openWorkspaceWatch(child: Pick<ClientInjectedContext, 'remote'>, options: Pick<SuperviseOptions, 'schedule'> = {}): WorkspaceSupervisor
```

- 与 PR A（#352）：本 PR 不改 `remote.ts`、`host-composition.ts`、`host-surface.ts`；依赖其中 `CLIENT_REMOTE`、`ClientContext`、`ClientInjectedContext`、`installHostRemote`、`createHostComposition` 的名字。PR A 若改名，后合者只改 import 行；`client.ts` 第 7–9 行相邻 import 可能产生文本冲突，rebase 时逐行合并。两者都可能改 `tests/integration/harness-plugin-artifact.test.js`，本 PR 只动 e 节。
- 下游：#131 在 `WorkItemApp` 内加「无工作区」与设置屏；#360 在容器里加刷新控件（届时 `refreshing` 由它驱动）；#354 Host 重组结束一代后由监督者自动跟随新一代；#142、#230、#234、#282、#358 只依赖本 PR 挂好的面板。
- 外部：DeepSeek Harness Desktop 0.2.0-rc.2（2026-10-21 评审方读到本机已是 0.2.1-rc.2，S3 按实际版本记，D30）与其 `dsh plugin` CLI、Desktop 凭据存储句柄 `HARNESS_PROJECTS_GITHUB_TOKEN`、沙箱 Project A（`E1_PROJECT_A_ID`，`docs/architecture/gate-e1-sandbox.md` §2.1）。假设宿主 React ≥ 18（`useSyncExternalStore`；客户端基线含 `react-dom/client`），S3 面板能渲染即证实。

## Outcomes & Retrospective

**状态：实施、独立验收与跟进项（Batch 5）完成，S3 待人类伙伴。** A1 在人类伙伴于 Desktop 内走完第 3–5 步并发 #124 评论之前不成立；A2–A7 满足，读回见 `Validation and Acceptance` 的「独立验收读回」。

**独立验收**（2026-10-21）：无 P0 / P1。P2 一处已修（D18：订阅者或 `onRetry` 在终止发布里同步 close 后仍排定重开，`9f327cd`）。需人类伙伴裁定：范围里的「从链接打开」在宿主内没有入口（壳不传 `initialPath`，TD-072），「宿主主题」只经继承、由 S3 目检。跟进项按 D20 已在本 PR 内实现（Batch 5，除 #380 外每个提交 `Closes` 对应 issue，#380 只 `Refs`；读回见「跟进项读回」）：

- #377 `test(client)`：V2 现在被「三种终止来源」杀死（D21）。
- #378 `test(ui)`：U11 现在被「列表与链接」杀死（D22）。
- #379 `fix(ui)`：抽屉打开时重连说明也在抽屉的状态区里（D23）。
- #380 `test(client)`：issue 提议的归零改动不可观测，未改 `supervise.ts`；开场即 gap 的退避已钉进「退避」，TD-073 订正（D24）。验收 1 未满足，本 PR 只 `Refs #380`，去留由人类伙伴决定（D24 订正）。
- #381 `docs(adr)`：ADR-0009 两条原处标注（D26）。
- #382 `fix(ui-model)` + `fix(ui)`：部分读取有自己的列表状态文字，横幅不再说「最后已知值」（D25；来自 #229 的 2026-10-04 评论第 1 条，此前没有 issue 承接）。

**评审修复**（2026-10-21，REQUEST_CHANGES，1 P1 / 2 P2 / 3 P3）：全部按根因处理，读回见「评审修复读回」。P1：#380 只 `Refs`，决策评论已发，去留待人类伙伴（D24 订正）；P2：S3 只比两个 lib（D27），L1 措辞订正并钉住现状（D29）；P3：监督者隔离调用方回调（D28）、本机用户名改占位符、vertical-path 承接列去掉「草稿」。

**交付**（提交序列以在该检出运行 `git log --oneline origin/main..HEAD` 为准；早先引用的提交号已不在分支历史里，见 `Surprises & Discoveries`）：

- client：`superviseWorkspace` 把三种终止来源（宿主结束一代、`guarded` 读取异常、帧被拒）变成 1 s 起翻倍、30 s 封顶、被接受的帧归零的有界退避之后的新 follower；载体断开仍走同一句柄；`connect` 同步抛错按终止吸收，从不外抛。
- ui：`WorkItemApp` / `bindWorkItemApp` 持有唯一 scope 门、插件内导航（`useState` 路由、片段 href）与页面替换时的焦点；路由 codec 整文件自 `apps/web` 迁入 `packages/ui`。
- 壳：`main` 面板渲染 `WorkItemApp`，数据来自监督者；`PlaceholderPanel`、一元 `baseline()` 调用与 watch 外的 try/catch 已删除。
- 文档与债务：TD-058 移入 Resolved（D17），TD-057、TD-059 加注，新增 TD-072、TD-073；README、vertical-path、ADR-0010 已订正（D16）。
- 跟进（Batch 5）：抽屉里的重连说明、部分读取的状态文字、V2 / U11 的判别断言、ADR-0009 标注、TD-073 订正。

**与计划的偏差**（证据在 `Surprises & Discoveries` 与 `Decision Log`）：Batch 1 的 `ℹ tests` 期望 8 实为 7；`supervise.ts` 与 `client-stream` 的实际行数高于设计估算；`ui-work-item-detail-browser` 的 `ALLOWED` 额外收紧；`onRetry` 的 `undefined` 在壳里记成「流正常结束」（D14）；各批多加了让实现守卫可被杀死的断言（D11、D13）；文档批次多改了 `tests/integration/README.md` 的三处过期描述；Batch 5（D20）超出原范围：改了 `packages/ui-model` 的状态文字派生（D25）与 ui 的抽屉（D23），代码回读 774 越过 760 削减线而不削减，#380 未按 issue 文字改代码（D24）。

**仍开放**：S3 与 #124 评论；TD-072、TD-073；TD-057、TD-059 的原债仍开；`host-surface.ts` 的 `RemoteNamespace.baseline()` 在壳内已无调用方（归 PR A，本 PR 零改动）；D3 提到的以 `HARNESS_CORDIS` 复跑安装件 e 节（TD-060）在 `Progress` 里没有记录，需要有宿主包的环境补跑；同一句柄上「先 baseline、后 gap」的代每个轮询间隔重开一次、不退避（TD-073 订正）；#380 的去留（not planned 关闭，或改写验收后修复）待人类伙伴决定（D24 订正）。

**回顾**：

- 把全部发布点放进 client 监督者，壳没有漏接点，三种终止来源共用一条路径；评审原型里「新 follower 打开即清空显示」的变异一度存活，靠 `gate` 步骤才被杀死，这一步必须留在用例里。
- 计划里的数字（`ℹ tests 8`、行数估算）两处与实测不符，应当写成回读命令加期望，而不是预估值。
- 文档批次最容易漏的是被改写那一行的邻居：同表的其它行与表后的段落会一起变假，搜索应覆盖整张表与其后一段，而不只是计划点名的行。
- 跟进项先核实前提再动手：#380 的提议改动是等价变异、#378 的场景走不到、#382 按字面实现会新增遮蔽通道，三处都是读代码并跑变异才判出，照 issue 文字实现会留下死守卫或新的泄露面。


2026-10-21（S3 与归档，评审会话）：A1 由宿主内 S3 证实（Desktop 0.2.1-rc.2，head `3cea57f6`，#124 评论）。#229 的全部验收成立，计划归档。S3 同时实测了 TD-056 的启动凭据竞态：降级态下页面如实显示最后已知值，状态区不冒充当前值；页面要在首次启动后读到当前值，取决于 #335 的刷新。
## Bottom Change Note

- 2026-10-21：创建。为什么：#229 进入迭代 7（PR B），三份设计提案经独立评审合并为一份 spec + plan；分歧点与证据见 `Decision Log` D1–D10。
- 2026-10-21：Batch 4 文档回填（实施者）。为什么：S3 之外的文档项在冻结代码前先落地，使独立验收者能读回 tracker、README、vertical-path、ADR 与本计划的一致状态；`Interfaces and Dependencies` 的三处签名按实际导出订正（`options` 为缺省参数、`initialPath?: string | undefined`）；`Progress` 把 S3 拆成待人类伙伴的独立项；新增 D16、D17。
- 2026-10-21：独立验收（Claude Opus）。为什么：按 #229 逐条验收并以变异证明判别力；修复 D18 的 P2 后，client-stream「supervise：」多一条，`docs/product/vertical-path.md` 订正段的快照 head 与条数随之订正；新增「独立验收读回」、D18、D19 与跟进项。
- 2026-10-21：Batch 5 · 独立验收跟进项（实现者（Claude Opus））。为什么：人类伙伴决定把已建为跟进 issue 的 #377–#382 在本 PR 内实现（D20）；新增 Batch 5、「跟进项读回」、D20–D26 与五条 Surprises；`Global Constraints` 的文件集合、`packages/ui-model` 零改动与 760 削减线按 D20 / D25 订正；Outcomes 的跟进项清单改为已实现、交付不再引用已不在分支历史里的提交号；`Interfaces` 补抽屉的 `notice`。`node scripts/rule-checks.mjs size origin/main` 回读代码 774 / 1000、文档 420 / 1500。
- 2026-10-21：#382 横幅补充（实现者（Claude Opus），协调者复核要求）。为什么：部分读取的「最后已知值」横幅与已确认的行矛盾，随 `b35cd7e` 一并修复；D25、文件集合、「跟进项读回」#382 行与 Outcomes 随之订正；`size origin/main` 回读代码 795 / 1000（弹性目标 800 以内）、文档 421 / 1500。
- 2026-10-21（协调者）：提交历史按人类伙伴的决定整理过多次（同树重写：先收敛为可审阅序列、并回跟进项，再把作者与提交者统一为仓库所有者、保留 Co-Authored-By、去掉会话链接；每次推送前在本地留备份 ref，用精确 lease 推送）。所以正文里引用的提交号都是**整理前**的观察值，不在当前分支历史里；对应关系按提交标题（`<type>(<scope>): <摘要>`）认，被并入的提交见所在提交的正文。当前序列在检出 `feature/plugin-work-item-pages` 的工作树根目录用 `git log --format="%h %s" origin/main..HEAD` 回读。
- 2026-10-21：评审修复（Claude Opus）。为什么：PR #372 的评审（REQUEST_CHANGES，1 P1 / 2 P2 / 3 P3）。#380 的验收 1 未满足，本计划改为只 `Refs` 并在 #380 发决策评论（D24 订正）；S3 的比对门改为只用两个 lib 的 sha256，期望值随本轮代码重算（D27）；新增 D28、D29、三条 Surprises、「评审修复读回」与 Progress 一项；判别命令里的本机用户名换成占位符。本轮提交后 `node scripts/rule-checks.mjs size origin/main` 读回代码 811 / 1000（越过弹性目标 800，D20 允许）、文档 457 / 1500。
- 2026-10-21（协调者）：记录评审会话转达的待决项结论（D30）：TD-072、主题只靠继承接受；#380 定为 not planned（由评审会话在合并时关闭），TD-073 的「下一步」补时间窗下限；S3 步骤改记实际 Desktop 版本、补 hash 路由确认与「宿主主题 ≠ 系统主题」的深浅目检；范围行标注取舍已定。
- 2026-10-21（评审会话）：接手收尾（D31）。变基到含 #348、#370 的 main，整合为五个交付物级提交，S3 期望哈希按变基后的代码重算；正文里整理前的提交号以提交标题对应。
- 2026-10-21（评审会话）：回填宿主内 S3 的读数与 #124 评论链接，A1 成立，计划归档。
