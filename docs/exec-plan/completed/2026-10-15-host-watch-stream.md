# Host Watch Stream ExecPlan

> 状态：Completed（2026-10-15：第一轮 MMP 评审 APPROVE，评审修复与独立复评后由评审会话整合、restack 到 #344 并发布；结果以 PR #345 最终 head 的回读为准）
> 创建：2026-10-15
> 范围：issue #276：把 `packages/controller` 的 workspace watch 经 Harness typed remote 的 stream 描述符送进 `packages/client` 的 store；断流的同一时刻整表 stale，重连在同一个逻辑流句柄上重拉 baseline，流里只有 controller 暴露的值。页面（#229）、迟到基线与库重建后的合法 reset（#218）、provider 组合（#132）不在本计划内。
> 上游输入：`AGENTS.md`、`PLANS.md`、issue #276、`docs/adr/ADR-0013-harness-host-composition.md`（Proposed）、`docs/architecture/harness-host-spike.md` §11、`docs/exec-plan/completed/2026-10-13-harness-host-composition.md`、`docs/exec-plan/completed/2026-10-12-client-frame-validation.md`、宿主 `@deepseek-ai/dsh` 0.2.0-rc.2 运行时源码（S1 静态读取，路径写成包内相对路径）。
> 基线：`origin/main` 的 `21cb29eb`（观察时刻 2026-10-15 09:50 +08；回读 `git rev-parse --short origin/main`，变了就按新 base 重算本计划里的行号）。
> 交付形态：原生栈第 2 层，叠在 PR A（#132，`feature/host-provider-composition`）之上（Decision Log D16）。Batch 0–3（Batch 3 只含 `remote.ts` 半边）先从 `main` 并行开工；A 提交它的 Batch 4（选项与 `guarded` 漏斗定稿）后 restack 到 A 的分支（Batch R），再做 Batch 4 起的宿主侧工作。合并次序 A 先于 B。

## Purpose / Big Picture

完成后，插件客户端打开面板时经 typed remote 的 `watch` stream 收到一个开场 baseline，之后宿主每次规划变更都推来一条 delta；`packages/client` 的 store 随之就地更新，页面不刷新。载体断开的那一个回调里，store 整表变 stale、连接标为断开、最后已知值保留；宿主恢复后，同一个逻辑句柄开出新一代并重拉 baseline。插件卸载时宿主先中止所有打开的流、排空，再关闭 SQLite。

最小成功证据：

1. S2：`tests/integration/harness-plugin-host-watch.test.js` 在真实 `createHostComposition`（A 的选项：种子 SQLite 库 + 只含 `harness.fake` 测试条目的目录）+ `installHostRemote` 的服务上，经 JSON 往返的载体与 RemoteStream 替身，跑通「baseline → 规划变更 → delta」「断载体即 stale → 同句柄重拉」「卸载排空」「Host 异常只上固定文案」「提前 return 结束内层一代」「空数据根不终止」六条用例。
2. S3：在 DeepSeek Harness 0.2.0-rc.2 Desktop 的真实 `desktop` profile 内（S-AB 会话 Phase 2），控制台先出现 `[harness-projects] watch baseline r=R gen=1`，人类改一次沙箱条目并触发一次 `bootstrapWorkspace` 之后出现 `[harness-projects] watch delta r=R+1 gen=1`，记录宿主版本、head、sha256 与时刻（Batch S3）。

## Context and Orientation

### 术语

- **逻辑流句柄**：宿主 `remote.$stream(options)` 返回的 `RemoteStream` 对象。它跨多次物理打开存活；本计划说「同一句柄」就是同一个 `RemoteStream` 对象。
- **代（generation）**：`RemoteStream` 每次调用 `options.open(signal)` 的序号，打开失败的尝试也算一代（spike M20）。它是**物理代**，与 `packages/client/src/sync.ts` 里帧级 `generation` 证据（#312 预留、#218 负责语义）不是一回事，本计划不把它写进帧。
- **宿主流帧** `WireStreamFrame`：`{ kind: 'baseline', baseline: WireSnapshot }` 或 controller 已有的 `WireEvent`（`delta` / `metadata` / `gap`）。
- **accept**：`RemoteStream` 交付的每一项带 `accept()`；消费方只在开场 baseline 被接受点接受之后调用它，宿主据此清零重试计数。
- **carrierFailed / ended**：`$stream` 的两个回调。载体（WebSocket）失败时先回调 `carrierFailed` 再按连接状态重开；一代正常结束时由 `ended(accepted)` 返回的错误决定是否重试——只有 `RemoteStreamCarrierError` 会重试，插件 bundle 构造不出这个类，所以本插件的「正常结束」一律终止。
- **S1 / S2 / S3**：S1 静态读源码；S2 本仓库测试（含替身）；S3 真实宿主内的记录观测。

### 仓库现状（`21cb29eb`）

- `packages/controller/src/watch.ts:45-88`：`watchWorkspace` 每次 `poll` 全量重读基线并与 seed 做 diff；保留窗口 `retain` 默认 1（`:77`），落后超过窗口、游标领先或缺 seed 时发 gap。同修订上业务字段变化发 gap，只有来源变化发 metadata。
- `packages/controller/src/index.ts:42-43`：`Controller.baseline()` 与 `watch(options)`，`watchWorkspace({ baseline: () => queries.snapshot() }, options)`。
- `packages/client/src/sync.ts:80-216`：`createSync(transport, store, options)` 是唯一接受点（`accept`，`:99-111`）；`lose()`（`:113-116`）= 断开 + `markAllStale`；`poll()`（`:165-202`）在未连接时拉基线，gap 与「delta 越过本地修订」走 `recover`（`:143-148`）。低修订 baseline 没有新的帧级 generation 证据时被拒（`:136-138`）。
- `packages/client/src/store.ts:61-93`：`applyMetadata` 只接受 `revision / workspace / capabilities / source / entities` 五个键。
- `packages/client/src/transport.ts:20-25`：`Transport` 只有拉模式（`fetchBaseline` / `poll` / `close`）。
- `apps/harness-plugin/src/remote.ts`：两个 unary 描述符 `baseline`、`bootstrapWorkspace`（`:120-143`），Host 与 Client 挂同一组对象；`installHostRemote` 卸载时等在途 unary 调用归零（`:164-214`）。一个永不结束的流若计入在途调用，卸载会永远等。
- `apps/harness-plugin/src/host-composition.ts:41-59`：组合 SQLite + Core + Controller，`call(name, input)` 路由两个 unary；`dispose()` 关 SQLite。选项 `{ dataPath, workspace, providers, migrationsDir? }` 是 `main` 上的形状；PR A 改为 `{ dataPath, workspaceId, catalog, resolveCredential, migrationsDir?, fetch? }`，Controller 拒绝经命名漏斗 `guarded` 先写 `operationFailed` 诊断行再改抛固定文案 `harness-projects：操作失败，原因已写入宿主诊断日志`，空数据根以 `unavailableCore('工作区尚未创建')` 组合、修订读回 0（A 计划 Design / Spec「启动数据流」第 3–5 步）。
- `apps/harness-plugin/src/host.ts:61`：`installHostRemote(ctx, composition)` 把 `HostComposition` 当作 `remote.ts` 的 `HostCompositionCall` 传入，所以 `HostCompositionCall` 一旦要求 `watch`，`host.ts` 的类型检查要等 `host-composition.ts` 有了 `watch` 才通过（见 Surprises、Batch 3）。`:63-65`：卸载顺序先 `remote.dispose()` 后 `composition.dispose()`（A 的不变量 I7 保持它）。`:73` 再导出 `createHostComposition`，A 删除它，测试一律从 `host-composition.ts` import。
- `tests/integration/harness-plugin-host-runtime-adapter.test.js:56`：A 的测试按下标取 `HOST_REMOTE.invocations[0]` 当作 `baseline`，所以 `watch` 描述符只能追加在 `descriptors` 末尾。
- `packages/controller/src/wire.ts:64`：帧头 `workspace` 为 `undefined` 表示尚无已确认的 descriptor；`packages/client/src/workspace-read.ts:54` 的 `assertHeader` 接受它，`packages/client/src/sync.ts:208` 的 `read()` 此时返回 `undefined`。空数据根上 Host 的开场 baseline 正是这种帧（r=0、无工作区、实体为空、来源恒定，之后每次 poll 都不产出事件）。
- `apps/harness-plugin/src/client.ts:15-30`：`$mount` 之后在 `ctx.inject(['remote.harnessProjects', 'slots'], child => …)` 子 Context 里调一次 unary `baseline()` 打日志并注册面板（M17：namespace 只能在注入子 Context 里读）。
- `tests/contract/package-boundaries.test.js:100-110`：只有 `host.ts` 与 `host-composition.ts` 可 import core / controller / storage；`remote.ts` 与 client 入口共用，不得 import controller。`tests/contract/client-browser.test.js:38-39`：浏览器构建不得含 controller 的 `index / wire / commands / queries / watch` 源文件。
- ADR-0013（Proposed）第 5 条与 Consequences 把 watch / reconnect 与「跨代 watch drain」交给 #276。

### 宿主 0.2.0-rc.2 的事实（S1，包内相对路径，行号只对该版本成立）

| # | 事实 | 出处 |
|---|---|---|
| H1 | 描述符可带 `mode: 'stream'` 与 `cancellation: { parameter: 'signal' }`；registry 只接受这两个取值 | `@deepseek-ai/dsh-typert-protocol/lib/types/types.d.ts:253-286`；`@deepseek-ai/dsh-typert-registry/lib/index.js:542-545` |
| H2 | 描述符带 `cancellation` 时，Host 把调用的 `signal` 追加为方法的最后一个参数；stream 方法必须同步返回 Iterable / AsyncIterable | `@deepseek-ai/dsh-api-gateway/lib/types/index.js:509-510`、`:233-253` |
| H3 | **流项不经过 result codec**：只有 unary 结果走 `encodeRpcResult`；`cancellableStream` 原样 yield，并在中止时 `iterator.return()` | `@deepseek-ai/dsh-api-gateway/lib/types/index.js:484`、`:695-704`、`:852-877` |
| H4 | 客户端 namespace 方法按 `descriptor.mode` 走 `invokeStream`，同步返回句柄；参数个数 = 业务参数 + 可选 signal；流项原样交付，不 decode | `@deepseek-ai/dsh-api-gateway/lib/types/client/index.js:264-268`、`:300-319`、`:413-434` |
| H5 | `RemoteStream`：每次打开 `++generation`；`restart()` 中止当前代并立即重开，旧代的项不再交付；只有 `RemoteStreamCarrierError` 先回调 `carrierFailed` 再重试，其余错误终止；正常结束交 `ended(accepted)`；`accept()` 清零重试计数；连接在线时未 accept 的连续第二次载体失败终止；离线时等上线再重开；`dispose()` 终止并关闭迭代 | `@deepseek-ai/dsh-api-gateway/lib/types/client/remote-stream.js:34-58`、`:82`、`:88-106`、`:113-118`、`:147-183` |
| H6 | 宿主自己的快照流约定：每代恰好一个开场快照，之后只有增量；快照被领域方接受后才 `accept()`；协议违例与业务失败进 `failed`（终止） | `@deepseek-ai/dsh-api-gateway/lib/types/client/snapshot-stream.js:47-71` |
| H7 | 一方插件同构写法：Host `follow(signal)` 先 yield baseline 再 yield 增量；客户端 `ended(true)` 返回 `RemoteStreamCarrierError` 以自动重开 | `@deepseek-ai/dsh-api-workspace-controller/lib/index.js:78-90`；`lib/client.js:474-478` |
| H8 | `remote.$stream(options)` 就是 `new RemoteStream(connection, options)` | `@deepseek-ai/dsh-api-gateway/lib/types/client/index.js:67-69` |
| H9 | Cordis 4.0.4 的 `effect` 是 Context 方法，`ctx.inject(names, cb)` 的回调 Context 是插件 fiber，同样有 `effect`，fiber 卸载时执行其 disposer | `@deepseek-ai/cordis/lib/index.js:1169`、`:1600-1606` |
| H10 | typed remote 的 unary HTTP 信封：`POST api/<namespace>/<method>`，JSON 体 `{ type: 'client-request', rpcId, method: '<namespace>/<method>', payload: { args } }`，`args` 按参数的 `wire` 名 | `@deepseek-ai/dsh-client-connection/lib/client.js:1212-1228`；`lib/index.js:504-509` |

## Design / Spec

### 数据流与状态拥有者

    SQLite → Core → Controller.baseline()
      → streamWorkspace（controller：帧化一代）
      → HostComposition.watch(signal)（apps Host 入口；每一步经 A 的 guarded 漏斗）
      → remote service.watch(signal)（逐帧 strict JSON、卸载中止与排空）
      → typed remote stream（/api/remote.mux）
      → 客户端 namespace watch(signal) ← 宿主 RemoteStream（重连节奏与物理代）
      → followWorkspace（packages/client：每代协议）→ WorkspaceSync.receive（唯一接受点）→ EntityStore

- Host / SQLite 拥有修订号与快照（不变量 7）；每一代的游标与 seed 只活在该代的 `streamWorkspace` 生成器里，代结束即丢弃。
- 宿主 `RemoteStream` 拥有物理代号与重试节奏；`followWorkspace` 拥有每代协议状态（是否已见开场 baseline）；`WorkspaceSync` 拥有接受规则、`connected`、头与 `lastUpdatedAt`；`EntityStore` 拥有行与 stale 标记。

### 协议（每一代）

`baseline` →（`delta` | `metadata`）* →（可选）`gap` 后宿主结束本代。

- 宿主不在同一代里发第二个 baseline（对齐 H6）。
- 客户端收到 gap 后先 `restart()` 再要下一项，所以旧一代的结束帧永远不被处理；新一代第一项必须是 baseline。
- 不续传游标、不在帧上加字段：重连永远重拉 baseline（Decision Log D2）。

### Controller：`streamWorkspace`（`packages/controller/src/watch.ts`，追加）

    /** 宿主流的一帧（#276）：每一代恰好一个开场 baseline，之后是 delta / metadata；gap 之后本代结束。 */
    export type WireStreamFrame = { readonly kind: 'baseline'; readonly baseline: WireSnapshot } | WireEvent

    export interface StreamOptions {
      /** 本代的生命周期：中止后不再读、不再产出。 */
      readonly signal: AbortSignal
      /** 两次 poll 之间的间隔（毫秒）。 */
      readonly intervalMs: number
      /** 可中止的等待，中止时提前 resolve；缺省用 setTimeout，测试注入手动节拍。 */
      readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>
    }

    const abortableDelay = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
      const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
      const timer = setTimeout(done, ms)
      signal.addEventListener('abort', done, { once: true })
    })

    /** 一代宿主流：先读一次基线并产出，再以它为 seed 按间隔 poll。保留窗口不设上限（Decision Log D4）。 */
    export async function* streamWorkspace(source: WatchSource, options: StreamOptions): AsyncGenerator<WireStreamFrame, void> {
      const { signal, wait = abortableDelay } = options
      if (signal.aborted) return
      const baseline = await source.baseline()
      yield { kind: 'baseline', baseline }
      const watch = watchWorkspace(source, { afterRevision: baseline.revision, seed: baseline, retain: Number.POSITIVE_INFINITY })
      while (!signal.aborted) {
        await wait(options.intervalMs, signal)
        if (signal.aborted) return
        const event = await watch.poll()
        if (event === undefined) continue
        yield event
        if (event.kind === 'gap') return
      }
    }

`Controller` 接口不加成员：`Controller` 自带 `baseline()`，本身就是 `WatchSource`。`packages/controller/src/index.ts` 已 `export * from './watch.ts'`，不用改。

### Host：`host-composition.ts`（restack 到 A 之后只追加）与 `remote.ts`

`host-composition.ts` 的结构（选项、组合主体、`call`、`disabled`、`guarded`）归 A；B 在 A 的 Batch 4 定稿、本分支 restack 之后（本 PR 的 Batch 4）只加三处，不删不改 A 的成员（Interfaces and Dependencies「共享文件协议」）：

- 一处 import：在 A 已有的 `@harness-projects/controller` import 里加 `streamWorkspace` 与 `type WireStreamFrame`。
- 一个可选选项：`HostCompositionOptions` 加 `readonly watchIntervalMs?: number`（缺省 1000，测试传 5）。
- 一个成员，紧挨 `call`：

      watch(signal: AbortSignal): AsyncIterable<WireStreamFrame> {
        if (closed) throw new Error('host 已关闭')
        const frames = streamWorkspace(controller, { signal, intervalMs: options.watchIntervalMs ?? 1000 })
        return { [Symbol.asyncIterator]: () => ({ next: () => guarded(() => frames.next()), return: () => frames.return() }) }
      },

  每次 `next()` 都经 A 的命名漏斗 `guarded`（按 A 的 Design 是 `guarded(run: () => Promise<T>)`；A 定稿的签名不同就按它的签名调用，不另写第二个漏斗）：中止是正常的 `done: true`，不经过漏斗的错误分支；任何抛出先写一行 `operationFailed`（允许名单字段，没有 message 与路径），再以固定文案改抛。`return` 直接转给内层生成器，网关取消或 `for await` 提前退出都会结束它。`closed` 检查在漏斗之外、同步抛出，与 A 的输入校验错误一样保留固定中文文案。`call` 与 `watch` 都隐式绑定 A 的固定 `WORKSPACE_ID`，一个组合一个 Controller；#127 / #131 引入工作区选择时经 TD-055 / TD-058 协调。

`remote.ts`（Batch 3，从 `main` 开工）：

- `InvocationDescriptor` 加 `readonly mode?: 'stream'` 与 `readonly cancellation?: { readonly parameter: 'signal' }`。
- `HostCompositionCall` 加 `watch(signal: AbortSignal): AsyncIterable<unknown>`（remote.ts 不得 import controller 类型）。
- 新描述符追加在 `descriptors` 的**末尾**（`Object.freeze([baselineDescriptor, bootstrapDescriptor, watchDescriptor])`），`HOST_REMOTE.invocations[0]` 仍是 `baseline`：

      const watchDescriptor: InvocationDescriptor = {
        id: `${REMOTE_PACKAGE}#${REMOTE_NAMESPACE}/watch`,
        service: REMOTE_SERVICE,
        namespace: REMOTE_NAMESPACE,
        method: 'watch',
        mode: 'stream',
        invocation: { kind: 'direct' },
        parameters: [],
        cancellation: { parameter: 'signal' },
        result: jsonOutput,
      }

- `installHostRemote` 加 `const lifetime = new AbortController()`；service 加：

          async *watch(signal: AbortSignal) {
            beginCall()
            try {
              for await (const frame of composition.watch(AbortSignal.any([signal, lifetime.signal]))) yield toJson(frame)
            } finally { endCall() }
          },

  `beginCall()` 放在生成器体内：网关在第一次 `next()` 之前取消时计数不会泄漏（未启动的生成器不会走 `finally`）。`toJson` 是流上唯一的严格编码点（H3）：非 JSON 值在宿主边界抛错变成错误帧，`undefined` 键在进程内就被删掉，测试看到的形状与线缆一致（spike M11）。
- `dispose()` 改为：`disposed = true; lifetime.abort(); if (activeCalls > 0) await drained; …撤回`。先中止所有打开的流，等它们的 `finally` 把计数归零，再撤回 contribution 与 service；`host.ts` 的「先 remote 后 composition」顺序保证 SQLite 关闭时没有流还在读库。
- `InstalledHostRemote.service` 类型加 `watch(signal: AbortSignal): AsyncGenerator<unknown, void>`；文件头注释从「two unary JSON methods」改为「两个 unary 与一个 stream」。

### Client：`WorkspaceSync.receive`（`packages/client/src/sync.ts`）

推模式复用唯一接受点，不另写规则（Decision Log D5）。改法（Batch 6c 起事件处理原地不动，D34）：

1. 顶部 `import type { … } from '@harness-projects/controller'` 增加 `WireSnapshot`；`const baseline = async () => { const snapshot = await transport.fetchBaseline(); … }` 改成同步的 `const acceptBaseline = (snapshot: WireSnapshot): SyncReport => { … }`（函数体不变），再加一行 `const baseline = async (): Promise<SyncReport> => acceptBaseline(await transport.fetchBaseline())`。
2. `recover` 改为同步的 `markGap(gap)`：整表 stale、调 `onGap`、回报 `{ kind: 'gap', revision: store.revision, reason: gap.reason }`，是拉推两种模式共用的缺口标记（D33）。
3. `WorkspaceSync` 加成员：

         /**
          * 推模式（#276）：接受宿主流的一帧。baseline / delta / metadata 走与 poll 相同的接受点，拒绝时抛错且状态不变；
          * gap（含越过本地修订的 delta）只整体标 stale、调 onGap 并回报 `kind: 'gap'`，由流的消费者重开下一代。
          */
         receive(frame: unknown): SyncReport

   返回对象改名为 `const sync: WorkspaceSync = { … }`（末尾 `return sync`）。`poll` 里从 `try { assertEventShape(event) }` 到 `return { kind: 'delta', … }` 的事件处理原样成为 `receive` 的方法体，只在前面加一行 baseline 分支、两处 `recover(…)` 改为 `markGap(…)`；`poll` 在 idle 判断之后交给它，gap 时再重拉基线：

           const report = sync.receive(event)
           return report.kind === 'gap' ? { ...report, revision: (await baseline()).revision } : report
         }),
         receive(event: unknown): SyncReport {
           if (isRecord(event) && event.kind === 'baseline') return acceptBaseline(event.baseline as WireSnapshot)
           try {
             assertEventShape(event)
           …

   拉模式的可观察行为不变；唯一的放宽是 `transport.poll` 若交来 baseline 形状的帧，会按 baseline 经同一接受点接受，而它的类型与唯一实现（`createTransport` 转交 `watchWorkspace`）都不产出这种帧（D34）。

推模式的 gap 窗口里 `connected` 保持 true、行全部 stale，与拉模式 `recover` 等待基线时的状态相同。推模式从不在帧上带 `generation`，所以库重建后修订倒退的 baseline 被现有规则拒绝并 fail closed（Decision Log D6，TD-059）。

### Client：`followWorkspace`（新文件 `packages/client/src/stream.ts`）

按 H6 的消费形状写，规则全部交给 `receive`：

    import { createEntityStore } from './store.ts'
    import { createSync, type SyncOptions, type SyncReport } from './sync.ts'
    import type { Transport } from './transport.ts'
    import type { ClientWorkspaceRead } from './workspace-read.ts'

    /** 宿主 RemoteStream 的最小结构面（0.2.0-rc.2，见 Context H5）；不 import 宿主包。 */
    export interface GenerationItem { readonly generation: number; readonly value: unknown; accept(): void }
    export interface GenerationStream extends AsyncIterable<GenerationItem> { restart(): void; dispose(): Promise<void> }
    export interface FollowOptions extends SyncOptions {
      /** 每个被接受的帧之后调用；generation 是物理代号，只用于诊断，不是重连次数。 */
      readonly onReport?: (report: SyncReport, generation: number) => void
    }
    export interface WorkspaceFollower {
      /** 展示层的唯一输入，同 WorkspaceSync.read。 */
      read(): ClientWorkspaceRead | undefined
      /** close 之后 resolve；协议违例、帧被拒或宿主终止本流时 reject（store 保留最后已知值并整表 stale）。 */
      readonly done: Promise<void>
      /** 吸收态：之后到达的帧不再改 store、不再回报。 */
      close(): Promise<void>
    }

    /** 推模式从不拉取（gap 只标记，由消费者重开下一代）；这个 transport 只为复用 createSync 的接受点。 */
    const refuse = (): Promise<never> => Promise.reject(new Error('推模式会话不拉取'))
    const PUSH_ONLY: Transport = { fetchBaseline: refuse, poll: refuse, close: () => undefined }

    export function followWorkspace(connect: (carrierFailed: () => void) => GenerationStream, options: FollowOptions = {}): WorkspaceFollower {
      const sync = createSync(PUSH_ONLY, createEntityStore(), options)
      let closed = false
      const stream = connect(() => sync.disconnect())
      const consume = async (): Promise<void> => {
        let opened: number | undefined // 已接受开场 baseline 的那一代
        for await (const item of stream) {
          if (closed) return
          const baseline = (item.value as { readonly kind?: unknown } | null | undefined)?.kind === 'baseline'
          if (baseline === (item.generation === opened)) {
            throw new TypeError(baseline ? `第 ${item.generation} 代出现第二个 baseline` : `第 ${item.generation} 代第一帧不是 baseline`)
          }
          const report = sync.receive(item.value)
          if (baseline) { opened = item.generation; item.accept() }
          options.onReport?.(report, item.generation)
          if (report.kind === 'gap') stream.restart()
        }
      }
      const done = consume().catch((error: unknown) => { if (!closed) throw error }).finally(() => sync.disconnect())
      return { read: () => sync.read(), done, close: async () => { closed = true; sync.disconnect(); await stream.dispose() } }
    }

- `carrierFailed` 同步调用 `sync.disconnect()`（`PUSH_ONLY.close` 是空操作，所以就是 `lose()`）：连接断开与整表 stale 发生在宿主报告载体失败的同一个回调里。
- 协议违例在 `receive` 之前判定：同代第二个 baseline、某代第一帧不是 baseline 都终止；`receive` 抛出的拒绝同样终止。终止时 for-await 自动关闭宿主迭代，`done` 的 `finally` 标断开与 stale，`done` reject。不自动重开（Decision Log D7）。
- `packages/client/src/index.ts` 加 `export * from './stream.ts'`。stream.ts 只 `import type` controller 的类型，浏览器构建仍不含 controller 的运行时源文件。

### 壳：`workspace-watch.ts`（新）、`client.ts`、`host-surface.ts`

`apps/harness-plugin/src/workspace-watch.ts`（独立文件，让集成测试走真实接线；client bundle 仍只导出 `apply` 与 `inject`）：

    import { followWorkspace, type WorkspaceFollower } from '@harness-projects/client'
    import type { ClientInjectedContext } from './host-surface.ts'

    const NAME = 'harness-projects watch'

    /** 在注入子 Context 上打开 workspace watch：宿主 $stream 监督重连，followWorkspace 维护 store（#276）。 */
    export function openWorkspaceWatch(child: Pick<ClientInjectedContext, 'remote'>): WorkspaceFollower {
      const follower = followWorkspace((carrierFailed) => child.remote.$stream({
        name: NAME,
        open: (signal) => child.remote.harnessProjects.watch(signal),
        // 插件 bundle 拿不到 RemoteStreamCarrierError（CLIENT_EXTERNAL 为空），宿主结束一代一律终止（TD-058）。
        ended: (accepted) => new Error(accepted ? `${NAME} 在 gap 之外结束` : `${NAME} 在开场 baseline 之前结束`),
        carrierFailed: () => { carrierFailed(); console.info('[harness-projects] watch carrier lost') },
      }), { onReport: (report, generation) => console.info('[harness-projects] watch', report.kind, `r=${report.revision}`, `gen=${generation}`) })
      void follower.done.catch((error: unknown) => console.error('[harness-projects] watch failed', error))
      return follower
    }

`client.ts` 在注入回调里、slots 注册**之后**打开 watch，并就地捕获它的同步异常（D32 定了顺序；D38 补上捕获：面板贡献是本 fiber 的 effect，Cordis 4.0.4 的 fiber 在回调抛错时卸载全部 effect，只靠先登记保不住面板），unary `baseline()` 调用与它的 `[harness-projects] baseline received` 日志保留不动（A 的验收 8 用它作一次查询往返的证据；A 的 S3 探针只在 A 的 head 上临时加一行、永不提交）：

        let workspace: ReturnType<typeof openWorkspaceWatch>
        try {
          workspace = openWorkspaceWatch(child)
        } catch (error) {
          console.error('[harness-projects] watch open failed', error)
          return
        }
        child.effect(() => () => workspace.close(), 'harness-projects: workspace watch')

`host-surface.ts`（只加结构类型，不 import 宿主包，见 Global Constraints 第二条）：`RemoteStreamOptions { name; open(signal): AsyncIterable<unknown>; ended(accepted): Error; carrierFailed?(error: Error): void }`；`RemoteNamespace.watch(signal: AbortSignal): AsyncIterable<unknown>`；`ClientInjectedContext.remote` 改为 `{ readonly harnessProjects: RemoteNamespace; $stream(options: RemoteStreamOptions): GenerationStream }`（`GenerationStream` 从 `@harness-projects/client` 以 `import type` 取）；`ClientInjectedContext` 加 `effect(execute: () => () => unknown, label?: string): unknown`（H9）。

### 失败模式

| 情形 | 行为 |
|---|---|
| 载体断开（宿主崩溃、SIGTERM、网络） | `carrierFailed` 同步断开并整表 stale；宿主侧该 socket 上的流被中止、生成器结束；连接恢复后同一句柄开新一代，baseline 被接受即恢复当前值 |
| gap（同修订业务变化、修订倒退、缺 seed、TD-024 的撕裂读） | 宿主产出 gap 后结束本代；客户端整表 stale、调 `onGap`、`restart()`，新一代 baseline 被接受后恢复 |
| 越过本地修订的 delta（理论上宿主不会产出） | 与 gap 同路径 |
| 宿主插件卸载 | 宿主 `lifetime.abort()` → 生成器结束 → 客户端 `ended(true)` → 终止：保留最后已知值、整表 stale、断开，`done` reject 并记 `watch failed`（TD-058） |
| 协议违例、帧被拒、非 JSON 帧 | 终止，最后已知值 stale；不自动重开，避免对出错的宿主热循环；页面的恢复归 #229（TD-058） |
| Host 侧读取异常（`controller.baseline()` 拒绝等） | A 的 `guarded` 写一行 `operationFailed`（不含 message 与路径）后以固定文案改抛；本代以错误结束，客户端终止，`done` 以固定文案 reject，最后已知值 stale；一次瞬时异常也要重开页面，页面的恢复归 #229（TD-058） |
| 空数据根（零工作区） | 开场 baseline 为 r=0、`workspace` 缺省、实体为空；`read()` 保持 `undefined`，之后不产出帧，流不终止。创建首个工作区需要 Host 重组（A 的 TD-055），重组结束本代，客户端终止（TD-058），页面须重开 |
| 库重建后修订倒退的新一代 baseline | 被现有低修订规则拒绝 → 终止；合法 reset 归 #218（TD-059） |
| 客户端面板 / 插件卸载 | `child.effect` 的 disposer 调 `close()`：`dispose()` 发出 cancel，宿主 signal 中止，生成器结束（对应 spike O3.8） |
| watch 同步打开失败（如宿主没有 `$stream`） | `client.ts` 就地捕获并记 `[harness-projects] watch open failed`，不登记 watch effect，面板保留；没有实时数据，直到插件重载（D38） |

### 范围外

页面与重连 UI、按页面挂载开合流（#229）；拉模式的迟到基线 fencing、单次读快照与合法 reset（#218 / TD-024）；provider 组合与数据库挂载（#132）；宿主定时刷新（#335）；存储变更通知替代轮询；`dsh.client.external` 与安装件 manifest（#227）；契约生成器（spike O3.9）。

### 技术债务（预分配 TD-057..TD-060，Batch 6b 手工插入 `docs/exec-plan/tech-debt-tracker.md` Open Items 的编号位置）

| ID | 子系统 | 简述 | 延期理由 | 下一步 |
|---|---|---|---|---|
| TD-057 | controller / apps Host | 每个打开的流每 `watchIntervalMs`（缺省 1s）全量读一次快照，代价是实体数 × 流数；流的生命周期等于客户端插件生命周期，面板关着也在轮询 | demo 单用户、百级实体；变更通知要改 core / storage，超出本 PR | 存储提交修订时通知 Host 唤醒生成器；#229 决定是否随面板开合流；触发条件：多客户端或千级实体 |
| TD-058 | apps 客户端壳与客户端流 | 三种终止在客户端都不自动重开：插件 bundle 构造不出 `RemoteStreamCarrierError`，宿主正常结束一代（插件重载 / 卸载 / Host 重组）是终止（一方插件会重开，H7）；Host 侧读取异常经 `guarded` 以固定文案结束本代；帧被拒（D7）。`WorkspaceFollower` 没有 reopen 接口 | 页面与重连 UI 归 #229（范围外）；原定承接的 #227 已关闭；自动重开须有界退避（D7） | 承接 #229 的一条验收（评审会话已登记：https://github.com/SingularityKChen/harness-projects/issues/229#issuecomment-6188738391，D38）：三种终止下页面显示可恢复状态，并以新 follower（新 store 或显式 reopen）重新跟随，不要求用户重开页面；可选：验证 spike M23 后声明 external，让 `ended(true)` 返回载体错误；与 A 的 TD-055 联动：创建首个工作区需要 Host 重组，重组结束本代 |
| TD-059 | client 同步 | 帧级 `generation`（#312）一旦建立，metadata 帧永远被拒：带 `generation` 键被 `applyMetadata` 的键白名单拒，不带则被「generation evidence 缺失」拒；推模式因此不用帧级 generation，库重建后 fail closed | 合法 reset 与 generation 语义归 #218 | #218 二选一：把物理代号作为带外证据传给接受点，或让 metadata 键白名单接受 `generation`；补「generation 建立后 metadata 仍可接受」用例 |
| TD-060 | 测试 | `tests/fixtures/remote-stream-double.js` 按 0.2.0-rc.2 的 `RemoteStream` 语义手写；安装件 e 节的假 Context 按 Cordis 4.0.4 的 fiber 语义建模（D38）；宿主升级后都可能漂移，CI 发现不了 | 仓库不依赖宿主包（Global Constraints 第二条），CI 无法运行真实类 | 每次升级宿主按 Batch 5 的交叉核对命令用真实类重跑两份测试文件、以 `HARNESS_CORDIS` 用真实 `Context.inject` 重跑安装件测试，并核对 H5 的行号 |

### 风险

- R1（主不确定性）：手写的 stream 描述符 + `$stream` 在真实宿主内能否在同一代送达 baseline → delta，目前只有 S1 与 S2 证据；由 Batch S3（S-AB Phase 2）判定。2026-10-15 15:20 +08 已由 S3 关闭：同一代 baseline → delta 在真实 Desktop 内观测到（Progress 的 Batch S3、D37）。
- R2：替身与真实 `RemoteStream` 偏差；由 Batch 5 用真实类交叉核对、Batch S3 兜底（TD-060）。
- R3：宿主生成器停在 `yield`、网关写 socket 被背压卡住时，卸载会等到写入完成；与 unary 在途调用卡住同级，不另做机制。流与 unary 共用 `activeCalls` 与 `drained`，所以 #338 的有界排空（第 2 项）必须覆盖打开的 watch 流，而 #338 的 Out of scope 目前写着 watch 流（#276）；评审会话已在 #338 登记这条补充（https://github.com/SingularityKChen/harness-projects/issues/338#issuecomment-6188739084，D38）。
- R4：本 PR 是 A 之上的栈层。A 的每次整合 force-push 都要协调者 restack B；A 拖过 B 的评审窗口时，B 不能带着未闭合的 AC1 合并，须人类裁决范围（Interfaces and Dependencies「栈与合并次序」）。

## Global Constraints

- 保持 `AGENTS.md` §1.1 七条不变量与 §2 依赖方向；`remote.ts`、`client.ts`、`workspace-watch.ts`、`host-surface.ts` 不 import core / controller / storage（本 PR 给它们新增的 import 只来自 `@harness-projects/client` 与包内相对路径）；只有 `host.ts`、`host-composition.ts` 可以 import controller（ADR-0013）；`pnpm run boundaries` 必须通过。
- 不 import、不声明任何 `@deepseek-ai/*` 包；宿主 API 只写结构类型（`apps/harness-plugin/src/host-surface.ts` 文件头所说的 D16：锁文件与构建都不需要宿主包）。`apps/harness-plugin/scripts/build.mjs` 的 `CLIENT_EXTERNAL` 保持空。
- MMP 前不做兼容层、双写或开关；不新增迁移，不改数据库。
- 不加 wire 字段；流里只有 controller 产出的值（AC3）。
- 凭据只以句柄存在；测试、夹具、日志与文档不含凭据值；不读取本机任何凭据存储。日志只打 kind、修订号与代号，不打内容或 id。
- 发布面：文档不写本机绝对路径、账号名、令牌、内部系统名；宿主源码一律写成包内相对路径。
- Git：不执行 `git config` 写入；需要指定身份时用 `git -c user.name=<name> -c user.email=<email>` 单次传入，推送前核对作者。提交格式 `<type>(<scope>): <中文摘要>`，正文说明为什么，末尾 `Refs #276`（提交正文不写关闭关键字；关闭关系只由 PR 描述的 closingIssuesReferences 承担）。
- 规模：代码桶（实现 + 测试 + 夹具）≤ 800 行、文档 ≤ 1300 行（CI 硬上限 1000 / 1500）。栈上时 base 是 A 的分支，命令写 `node scripts/rule-checks.mjs size origin/feature/host-provider-composition`；A 合并、本 PR 改到 `main` 之后改用 `origin/main` 重测。2026-10-15 10:31 +08 的诚实重估（不是回读值；size 计入空白改动，`git diff --numstat` 不带 `-w`）：实现约 270（`sync.ts` 抽取换缩进约 90、`stream.ts` 约 55、`watch.ts` 约 35、`remote.ts` 约 35、`host-surface.ts` 约 15、`workspace-watch.ts` 约 20、`host-composition.ts` 约 8、其余约 12）；测试约 535（`remote-stream-double.js` 约 120、`harness-plugin-host-watch.test.js` 约 145（含漏斗与空数据根两条）、`client-stream` 约 105、`workspace-stream` 约 60、契约约 60、安装件 e 节约 40、`client-browser` 1）；代码合计约 805。承诺的削减在 Batch 5 之前做完、目标 ≤ 760：`workspace-stream` 第 3 条（中止）并进第 2 条的脚本化源（约 −15）；安装件 e 节只测「`$stream` 被调一次、`open` 转交同一个 signal、卸载 effect 关闭它」（约 −15）；删 `client-stream` 与 `host-watch` 重复的断言（约 −15，见 Batch 2 与 Batch 4）。文档约 890（本计划约 810 行、Batch 6b 回填约 60、TD 四行、索引一行、可选的集成 README 小节约 10）。死代码复审后仍 > 800 才按 Decision Log D23 拆成 B1 / B2。2026-10-15 13:55 +08 Batch 6c 精简（D34）后实测代码 717 / 1000（base 本地 A `1391c282`），D23 的拆分条件不再成立。
- TDD：每批先写会失败的判别性测试，确认失败原因是缺行为而不是夹具错误，再实现。不用真实 sleep 作唯一判据：controller 单测注入手动节拍；集成测试用 `watchIntervalMs: 5` 加有上限的轮询等待（每轮 `setTimeout(5)`，至多 400 轮）。测试结束必须 `close()` follower、`dispose()` remote 与组合，否则计时器让进程挂住。
- 本 PR 的文件集合（唯一声明处）：

| 文件 | 改动 |
|---|---|
| `packages/controller/src/watch.ts` | 追加 `WireStreamFrame`、`StreamOptions`、`streamWorkspace` |
| `packages/client/src/sync.ts` | `acceptBaseline` / `applyEvent` 抽取，新增 `receive` |
| `packages/client/src/stream.ts` | 新建：`followWorkspace` 与结构类型 |
| `packages/client/src/index.ts` | 导出 `stream.ts` |
| `apps/harness-plugin/src/remote.ts` | 追加在 `descriptors` 末尾的 stream 描述符、`service.watch`、卸载中止与排空 |
| `apps/harness-plugin/src/host-composition.ts` | restack 到 A 之后只追加一处 import、`watchIntervalMs?` 选项与经 `guarded` 的 `watch(signal)` 成员（结构归 PR A） |
| `apps/harness-plugin/src/workspace-watch.ts` | 新建：`openWorkspaceWatch` |
| `apps/harness-plugin/src/client.ts` | 打开 watch 并登记卸载 effect |
| `apps/harness-plugin/src/host-surface.ts` | `$stream`、`watch`、`effect` 结构类型 |
| `tests/e2e/workspace-stream.test.js` | 新建：controller 一代流 |
| `tests/e2e/client-stream.test.js` | 新建：每代协议与吸收态 |
| `tests/fixtures/remote-stream-double.js` | 新建：RemoteStream 替身、连接与载体 |
| `tests/contract/harness-host-remote-adapter.test.js` | 三个描述符、逐帧 JSON 化、卸载排空 |
| `tests/contract/client-browser.test.js` | 断言 `stream.ts` 在浏览器构建内 |
| `tests/integration/harness-plugin-host-watch.test.js` | 新建：宿主侧服务的端到端；只读 import A 的 `tests/integration/fixtures/host-seed.js` |
| `tests/integration/harness-plugin-artifact.test.js` | 只改 `e.` 节的客户端假 Context（a–d、f 节归 A） |
| `docs/exec-plan/active/2026-10-15-host-watch-stream.md`、`docs/README.md`、`docs/exec-plan/tech-debt-tracker.md` | 本计划、Active 表分隔行下的索引行、按编号位置插入的 TD-057..TD-060 四行 |
| `tests/integration/README.md`（可选，文档桶） | 紧接 A 的「Host 组合（#132）」小节之后加一个短小节「Host watch（#276）」 |

不改：`apps/harness-plugin/src/host.ts`、`apps/harness-plugin/src/index.ts`、`apps/harness-plugin/package.json`、`pnpm-lock.yaml`（`@harness-projects/client` 已声明）、`tests/integration/fixtures/host-seed.js`、`harness-plugin-host-runtime-adapter.test.js`、`harness-plugin-host-roundtrip.test.js`、`packages/core/**`、`packages/storage/**`、`packages/providers/**`、`tests/contract/package-boundaries.test.js`、`docs/adr/*`（A 与 C、D 的单元，见 Interfaces and Dependencies「共享文件协议」）。

## Plan of Work

> 归档注（评审会话 2026-10-15）：本节各批次下的勾选框是施工步骤清单，执行状态以 `Progress` 为准，归档时不逐条回勾。

所有命令在检出 `feature/host-watch-stream` 的工作树根目录（`.worktrees/host-watch-stream`）运行。第一次进入先跑 `pnpm install --frozen-lockfile --offline`（期望：无变更、退出码 0）。

两个阶段（Decision Log D16）：

- **阶段 I，base `main`，现在就与 A 并行**：Batch 0、1、2（controller 与 client，约占本 PR 代码的六成）与 Batch 3（`remote.ts` 半边，契约测试用组合桩；只本地提交）。它们与 A 的文件集合不相交。
- **Restack 门**：A 在 `feature/host-provider-composition` 上提交它的 Batch 4（选项与 `guarded` 漏斗定稿）之后，协调者执行 Batch R。
- **阶段 II，叠在 A 上**：Batch 4（含 `HostComposition.watch`，即 Batch 3 的 `host-composition.ts` 半边）、5、6a、S3（S-AB Phase 2）、6b。

Batch 5、6 的 `size`、`disclosure`、`git diff --check` 在栈上用 `origin/feature/host-provider-composition` 作 base；`<base>` 在下文指当时 PR 的 base。

### Batch 0 · 计划、索引与 draft PR

**最小闭环**：计划入库，draft PR 关联 #276 并带齐字段。由协调者（主会话）执行。

**涉及文件**：本计划、`docs/README.md`（在「### Active」表的表头分隔行之后插入一行：`| [2026-10-15-host-watch-stream](exec-plan/active/2026-10-15-host-watch-stream.md) | #276：workspace watch 经 typed remote stream 进入 client store；断流即 stale、同句柄重拉 baseline、卸载排空 | Active |`）。

- [ ] 提交 `docs(exec-plan): 编写宿主 watch 流交付计划`，正文末尾 `Refs #276`。
- [ ] 推送分支，按 Interfaces and Dependencies「PR 字段」开 draft PR，正文写入 `.superpowers/pr-body-276.md`（git 忽略）后用 `--body-file` 传入。
- [ ] 回读关联与字段。

**验证**：

    REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
    gh pr view <n> -R "$REPO" --json isDraft,baseRefName,headRefName,labels,milestone,closingIssuesReferences
    gh issue view 276 -R "$REPO" --json closedByPullRequestsReferences

期望：`isDraft: true`、base `main`（Batch R 之前）、head `feature/host-watch-stream`、标签恰为 `kind:feat`、`area:apps`、`area:client`、里程碑为 M4、`closingIssuesReferences` 含 #276，issue 侧 `closedByPullRequestsReferences` 含本 PR。关联回读时机：开 PR 后、每次改正文后、Batch R 改 base 到 A 的分支后、A 合并且本 PR 被改回 `main` 后各一次；base 是 A 的分支期间 `closingIssuesReferences` 可能为空，不提前报关联失败（Decision Log D25）。

**回滚**：关闭 draft PR、删除远端分支；本地 `git revert` 计划提交。

### Batch 1 · Controller 一代流

**最小闭环**：`streamWorkspace` 先产出开场 baseline，按间隔产出净 delta，gap 后结束，中止后不再读。

**涉及文件**：`packages/controller/src/watch.ts`、`tests/e2e/workspace-stream.test.js`。

- [ ] 先写 `tests/e2e/workspace-stream.test.js`（组合方式照 `tests/e2e/client-sync.test.js` 的 `compose()`：fake providers + `composeCore` + `createController(core, { authority: StatusPolicyMode.HarnessManaged, workspaceRevision })`；手动节拍 `wait`：把 resolve 压进数组，`signal` 中止时也 resolve；立即放行的节拍用 `boundedTicks`：20 个 tick 之后中止本代，回归时断言失败而不是在微任务里自旋，见 Surprises 与 D32）。三条用例：
  1. `stream：开场 baseline，两次写入只产出一条跨两修订的净 delta（#276）`：第一项深等于 `{ kind: 'baseline', baseline: await controller.baseline() }`；用 `controller.commands.applyPlanningStatus` 把两个未完成工作项改成 `blocked`（两个幂等键），放行一次节拍，第二项是 `kind: 'delta'`、`previousRevision = R`、`revision = R + 2`、`upserts.length = 2`。
  2. `stream：同修订业务变化产出 gap 后本代结束；中止后不再读取`：同一个计数读取的脚本化 `WatchSource`，`baseline()` 依次返回修订 1 标题 `a` 与之后恒为修订 1 标题 `b` 的快照。第一段 `wait` 用有上限的立即节拍：依次得到 baseline、`kind: 'gap'`，第三次 `next()` 为 `done: true`。第二段在同一个源上新开一代、`wait` 用手动节拍：拿到 baseline 后再调一次 `next()`（停在等待），中止 signal，该 `next()` 为 `done: true`，第二段的读取次数仍为 1。第三段：`signal` 在开始前已中止的新一代，第一次 `next()` 为 `done: true`、读取次数 0。
  3. `stream：同修订只有来源降级产出 metadata 而不是 gap，之后没有多余帧（#178、#276）`：脚本化源第一次读 `freshness: 'fresh'`，之后同修订、同业务内容，整表 `freshness: 'degraded'` 带 `reason`；有上限的立即节拍：依次得到 baseline、`kind: 'metadata'`（`revision` 1、`source.freshness` 为 `degraded`、`reason` 同源），再一次 `next()` 为 `done: true`（没有第二条 metadata 与 gap，由节拍上限结束本代）。
  - Batch 6c 改写（D34）：三种一代并成一条表驱动用例「开场 baseline 之后按节拍产出 controller 的事件」的三个子用例（子用例名保留上面三条标题里变异表引用的片段；两次写入改用修订 1 → 3 的脚本化快照序列，逐帧深等 `diffSnapshots` / gap / `toWireMetadata`）；两种中止单列一条「停在等待上中止后不再读取，开始前已中止则一次都不读」。
- [ ] 跑测试确认红：失败原因是 `streamWorkspace` 未导出。
- [ ] 按 Design / Spec 实现。

**验证**：`node --test tests/e2e/workspace-stream.test.js` 期望 `ℹ pass 3`（Batch 6c 起 `ℹ pass 5`：两条用例加三个子用例）、`ℹ fail 0`；`pnpm run typecheck` 无输出错误。

**回滚**：revert 本批提交；`watchWorkspace` 未改动。

### Batch 2 · Client 推模式接受与每代协议

**最小闭环**：`WorkspaceSync.receive` 复用唯一接受点；`followWorkspace` 按每代协议消费 `GenerationStream`，违例终止、gap 重开、close 吸收。

**涉及文件**：`packages/client/src/sync.ts`、`packages/client/src/stream.ts`、`packages/client/src/index.ts`、`tests/fixtures/remote-stream-double.js`、`tests/e2e/client-stream.test.js`、`tests/contract/client-browser.test.js`。

- [ ] 先写夹具 `tests/fixtures/remote-stream-double.js`（约 80 行，自己写，不复制宿主源码），导出：
  - `class RemoteStreamCarrierError extends Error`；
  - `class RemoteStream`，构造签名与宿主相同 `(connection, options)`，逐条实现 Context H5 的七条语义：每次打开 `++generation`；`restart()` 中止当前代、立即重开、丢弃旧代之后的项；`open()` 的迭代抛 `RemoteStreamCarrierError` 时先调 `carrierFailed(error)`，连接离线则订阅 `connection.generation` 等上线后重开，在线则第一次立即重开、未 accept 的连续第二次直接抛出终止；`accept()` 只对当前代生效并清零计数；正常结束且未被 restart 时 `throw options.ended(accepted)`；其它错误直接抛出；`dispose()` 中止生命周期、中止当前代、关闭迭代，幂等。文件头注释逐条写宿主出处（H5 的行号）与 TD-060。
  - `createConnection(online = true)`：返回 `{ generation: { getSnapshot(), subscribe(listener) }, setOnline(value) }`，在线时 `getSnapshot()` 返回对象，离线返回 `undefined`，`setOnline` 通知订阅者。
  - `createCarrier(CarrierError)`：返回 `{ open(service, signal), break(), frames, opened }`。`open` 以 `AbortSignal.any([signal, socket.signal])` 调 `service.watch`，每项 `JSON.parse(JSON.stringify(value))` 后 yield 并记入 `frames`，`socket` 中止时以 `new CarrierError('socket closed')` 拒绝（与 `iterator.next()` 赛跑），`finally` 里 `iterator.return()`；`break()` 中止当前 socket 并换新的。
  - `loadRemoteStream()`：环境变量 `HARNESS_GATEWAY_CLIENT` 指向宿主 `dsh-api-gateway/lib/types/client` 目录时，动态 import 其中的 `remote-stream.js` 与 `stream-client.js`，返回真实的 `RemoteStream` 与 `RemoteStreamCarrierError`；否则返回替身。只用于 Batch 5 的本机交叉核对，CI 不设这个变量。
- [ ] 再写 `tests/e2e/client-stream.test.js`（帧用 `tests/fixtures/client-browser.mjs` 同款的最小合法快照：一个实体、`workspace`、`capabilities: []`、`source.freshness: 'fresh'`；`clock` 固定）。三条用例：
  1. `follow：每代第一帧必须是唯一的 baseline，违例与被拒的帧终止且不重开`：表驱动三行，每行一个脚本化的第 1 代（帧交付完即正常结束，`ended` 返回 `new Error('script ended')`）——第一帧是 `previousRevision: 0` → `revision: 1` 的合法 delta（带齐帧头，`source.revision = 1`；去掉首帧检查时它会被接受），期望拒绝信息匹配 `/第一帧不是 baseline/`；同代两个 baseline，期望 `/第二个 baseline/`；baseline 的 `source` 缺 `freshness`，期望 `/帧头不合契约/`。每行：`await assert.rejects(follower.done, <该行正则>)`（正则必须区分于 `script ended`，否则变异 M11 会因脚本结束而假死），`open` 只被调 1 次。终止后「断开且整表 stale」只在 `host-watch` 用例 3 经真实接线断言一次（同一个 `finally` 路径），这里不重复。
  2. `follow：gap 先整表 stale 再重开下一代并接受新一代 baseline`：第 1 代 `[baseline r1 标题 a, gap]`，第 2 代 `[baseline r1 标题 b]`；`onGap` 回调里 `store.isCurrent(id) === false`；回报序列 `[['baseline',1,1],['gap',1,1],['baseline',1,2]]`（kind、revision、generation）；`open` 被调 2 次；标题为 `b` 且当前。
  3. `follow：close 之后迟到的帧不改 store、不再回报`：手写 `GenerationStream` 桩：第一次 `next()` 交付 baseline；第二次 `next()` 先 `queueMicrotask(() => void follower.close())` 再交付一条改标题的 delta；第三次起返回 `done`。`close()` 完成后标题未变、回报只有 1 条、`connected === false`。
  - Batch 6c 改写（D34）：第 3 条改名「close 之后迟到的帧不改 store」，手写流换成异步生成器，只断言标题未变（回报与连接断言被它蕴含）。
- [ ] `tests/contract/client-browser.test.js` 在既有 `inputs` 断言后加一行：`assert.ok(inputs.some((file) => file.endsWith('packages/client/src/stream.ts')))`。
- [ ] 跑测试确认红（`followWorkspace` 未导出）；按 Design / Spec 改 `sync.ts`、新建 `stream.ts`、导出。

**验证**：

    node --test tests/e2e/client-stream.test.js tests/e2e/client-sync.test.js tests/e2e/workspace-read-assembly.test.js tests/integration/sync-revision-freshness.test.js tests/contract/client-browser.test.js
    pnpm run typecheck

期望：全部 `ℹ fail 0`，`client-stream` 为 `ℹ pass 3`；拉模式既有用例数不变且全绿；typecheck 无错误。

**回滚**：revert 本批提交；拉模式行为由既有 `client-sync`、`workspace-read-assembly` 用例守护。

### Batch 3 · Host stream 描述符与卸载排空（`remote.ts` 半边，阶段 I）

**最小闭环**：Host 与 Client 挂同一个 stream 描述符（追加在末尾）；`service.watch` 逐帧严格 JSON 化；卸载先中止打开的流再排空撤回；卸载后 `watch` 被拒。全部对组合桩测试，不碰 `host-composition.ts`（它的 `watch` 成员在 Batch 4、叠到 A 之后写）。

**涉及文件**：`apps/harness-plugin/src/remote.ts`、`tests/contract/harness-host-remote-adapter.test.js`。

- [ ] 先改 / 加契约用例：
  1. 既有第一条改名为 `typed remote contribution exposes the same strict descriptors (two unary, one stream) on Host and Client`：方法列表**按序**为 `baseline`、`bootstrapWorkspace`、`watch`（`invocations[0]` 仍是 `baseline`）；`watch` 描述符 `mode === 'stream'`、`cancellation` 深等于 `{ parameter: 'signal' }`、`parameters` 为空；两个 unary 没有 `mode`。既有的逐描述符 codec 循环保持。
  2. `host adapter strictly JSON-encodes every watch frame at the host boundary`：组合桩的 `watch` 依次 yield `{ kind: 'delta', delta: { skipped: undefined, n: 1 } }` 与 `{ kind: 'delta', delta: { n: Number.NaN } }`；第一项 `JSON.stringify` 等于 `{"kind":"delta","delta":{"n":1}}`，第二次 `next()` 以 `/可传输/` 拒绝。
  3. `host adapter aborts and drains an open watch before withdrawing the service`：组合桩 `watch(signal)` 先 yield 一帧，再在 `signal` 未中止时等它中止，然后返回并记录 `signal.aborted`；读到第一帧后先发起下一次 `next()`（模拟网关一直在拉），再 `installed.dispose()`，与 1 秒超时赛跑必须先完成；之后那次 `next()` 为 `done: true`，桩记录到中止，`events` 为 `['remote-dispose', 'provide-dispose-start', 'provide-dispose-end']`；最后 `installed.service.watch(new AbortController().signal).next()` 以 `/已卸载/` 拒绝。
  - Batch 6c 改写（D34）：第 1 条三处 mode 断言并成一行；第 2、3 条并成「host adapter strictly JSON-encodes every watch frame, aborts and drains an open watch before withdrawing the service」：坏帧在卸载中途出现，同时证明边界严格编码与出错路径把在途计数归零。
- [ ] 跑测试确认红；按 Design / Spec 改 `remote.ts`。
- [ ] 本地提交，**不推送**：`HostCompositionCall` 要求 `watch` 之后，`host.ts:61` 的类型检查要到 Batch 4 给组合加上 `watch` 才通过（Surprises 第六条）；Batch 0–2 的提交照常推送。

**验证**：

    node --test tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-roundtrip.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js
    pnpm run typecheck
    pnpm run boundaries

期望：契约文件 `ℹ pass 5`（Batch 6c 起 `ℹ pass 4`），三份文件 `ℹ fail 0`（Node 类型剥离不做类型检查，运行期不受影响）；typecheck **恰好一个**错误，位于 `apps/harness-plugin/src/host.ts` 的 `installHostRemote(ctx, composition)`，内容是缺少 `watch` 属性，出现别的错误就停下修；boundaries 全绿。

**回滚**：revert 本批提交；unary 两个描述符与卸载顺序不变。

### Batch R · Restack 到 A（协调者执行；A 每次整合 force-push 之后重复）

**最小闭环**：本分支叠在 A 的分支上、B 自己的文件逐字节不变，draft PR 的 base 改为 A 的分支（原生栈 depth 2）。

**触发**：`origin/feature/host-provider-composition` 上出现 A 的 Batch 4 提交，且 A 的计划 Progress 勾上 Batch 4（选项与 `guarded` 定稿）。之后 A 每次整合 force-push，同样执行本批（把第 3 步换成 `git rebase --onto origin/feature/host-provider-composition <A 的旧 head> feature/host-watch-stream`）。

1. `git fetch origin`；`OLD=$(git rev-parse HEAD)`；`git branch backup/host-watch-stream-pre-restack-<yyyymmddhhmm> "$OLD"`（恢复锚点，按 `git-expert-operations` 流程）。
2. 确认工作区干净：`git status --short` 为空。
3. `git rebase origin/feature/host-provider-composition`。唯一预期冲突是 `docs/README.md` 的 Active 表（两边都插在分隔行下）：保留两行，2026-10-15 的行按计划文件名排序（`host-provider-composition` 在前）；继续时用 `git -c core.commentChar=';' rebase --continue`，防止以 `#` 开头的正文行被吃掉。其它冲突一律 `git rebase --abort` 回到 backup 并报告协调者。
4. 核对：`git diff "$OLD" HEAD -- packages/controller packages/client apps/harness-plugin/src/remote.ts tests/e2e tests/fixtures/remote-stream-double.js tests/contract/harness-host-remote-adapter.test.js tests/contract/client-browser.test.js docs/exec-plan/active/2026-10-15-host-watch-stream.md` 输出为空；`git diff --name-only origin/feature/host-provider-composition HEAD` 只列本 PR 文件集合与 `docs/README.md`；`git log --format=%B origin/feature/host-provider-composition..HEAD | grep '^#'` 为空。
5. 不在此刻推送（Batch 3 的类型检查缺口要到 Batch 4 补上）；Batch 4 验证全绿后，`git push --force-with-lease=feature/host-watch-stream:<远端旧 head> origin feature/host-watch-stream`，紧接着 `gh pr edit <n> -R "$REPO" --base feature/host-provider-composition`；PR 正文写明「base 是 PR A，本 PR 是原生栈第 2 层」，A 的 PR 正文写明 B 是下一层。重复执行（A force-push 之后）时 Batch 4 已在，第 4 步通过即可推送。
6. 回读 `gh pr view <n> -R "$REPO" --json baseRefName,headRefOid,isDraft,closingIssuesReferences`：base 为 `feature/host-provider-composition`、head 等于本地 HEAD；`closingIssuesReferences` 此时可能为空，按 Batch 0 的回读时机处理，不报关联失败。

**回滚**：`git rebase --abort` 或 `git reset --hard <backup>`（只在未推送时）；已推送时用 backup ref 做精确 force-with-lease 恢复，并把 base 改回 `main`。

### Batch 4 · HostComposition.watch、客户端壳接线与宿主侧端到端（阶段 II，Batch R 之后）

**最小闭环**：在 A 定稿的组合上加经 `guarded` 的 `watch` 成员；插件客户端在注入子 Context 上经 `$stream` 打开 watch，卸载时关闭；对真实宿主侧服务的端到端用例覆盖 AC1-S2、AC2、AC3、卸载、Host 异常漏斗与空数据根。

**涉及文件**：`apps/harness-plugin/src/host-composition.ts`（只按 Design / Spec 追加三处）、`apps/harness-plugin/src/workspace-watch.ts`、`apps/harness-plugin/src/client.ts`、`apps/harness-plugin/src/host-surface.ts`、`tests/integration/harness-plugin-host-watch.test.js`、`tests/integration/harness-plugin-artifact.test.js`（只改 `e.` 节）。

- [ ] 先写 `tests/integration/harness-plugin-host-watch.test.js`。全部装置收在一个辅助函数 `open(t, { seed = true } = {})` 里，用例只调它（A 的选项再变时只改这一处；JS 测试不做类型检查，旧选项只会在运行期失败）：
  - `createHostComposition` 从 `apps/harness-plugin/src/host-composition.ts` import（A 删除了 `host.ts` 的再导出）；不出现旧的 `workspace`、`providers` 选项。
  - `mkdtemp` 数据目录，`dataPath = <dir>/harness-projects/workspace.sqlite`；目录 `catalog` 只含一个 `harness.fake` 测试条目（形状照 A 的 AC7 测试条目：`definition` 取 `FAKE_PROVIDER_DEFINITION`、configuration schema 为空；`create: async ({ binding }) => (planning = createFakePlanningProvider({ bindingId: binding.id }))`，在回调里留住实例，让 `addItem` 照常可用）。`host-seed.js` 若已导出这个条目的构造器就直接用它。
  - `seed` 为真时，用 A 的 `tests/integration/fixtures/host-seed.js`（只读 import，接口以 A 的定稿为准）种入工作区与一个 `harness.fake` 规划挂载；为假时不种，即空数据根。
  - `host = await createHostComposition({ dataPath, workspaceId: <host-seed 的工作区 id>, catalog, resolveCredential: async () => undefined, watchIntervalMs: 5 })`；`installed = await installHostRemote(recordingCtx, host)`（`provide` 记服务、`typert.register` 返回空 disposer）；`const { RemoteStream, RemoteStreamCarrierError } = await loadRemoteStream()`；`connection = createConnection()`；`carrier = createCarrier(RemoteStreamCarrierError)`；`child = { remote: { $stream: (o) => { streams.push(o); return new RemoteStream(connection, o) }, harnessProjects: { watch: (signal) => carrier.open(installed.service, signal) } } }`；`t.mock.method(console, 'info', …)` 记录日志行；`follower = openWorkspaceWatch(child)`。
  - `t.after` 里依次 `follower.close()`、`installed.dispose()`、`host.dispose()`、删目录；返回 `{ host, installed, carrier, connection, streams, logs, follower, planning: () => planning, dataDir }`。

  六条用例：
  1. `host watch：同一句柄同一代先 baseline、规划变更后 delta，帧只是 controller 值的 JSON（AC1-S2、AC3）`：等到日志 `watch baseline … gen=1`，记 `b1 = await host.controller.baseline()`；`planning.addItem(fixtureProjectRef(planning.bindingId), 'issue', '新增条目', '正文')`，`await installed.service.bootstrapWorkspace({ kind: 'agent', id: 'host-watch' }, 'host-watch-1')`；等到 `watch delta r=<b1.revision + 1> gen=1`；`streams.length === 1`、`carrier.opened === 1`、`carrier.frames.length === 2`；`carrier.frames[0]` 深等于 `{ kind: 'baseline', baseline: JSON 化的 b1 }`，`carrier.frames[1]` 深等于 `{ kind: 'delta', delta: JSON 化的 diffSnapshots(b1, await host.controller.baseline()) }`（`diffSnapshots` 从 `@harness-projects/controller` 取；两帧的深等已经蕴含键集合，不另断言键白名单）。
  2. `host watch：载体断开的同一回调内整表 stale，重连在同一句柄上重拉 baseline（AC2）`：baseline 之后记 `entry = read().store.get(id)` 与 `at = read().lastUpdatedAt`；`connection.setOnline(false)`、`carrier.break()`；在 `console.info` 桩里遇到 `[harness-projects] watch carrier lost` 时同步拍下 `read()`：`connection.connected === false`、全部行 `isCurrent === false`、`reason` 为断网文案、`lastUpdatedAt === at`、行数不变。`connection.setOnline(true)` 后等到 `watch baseline … gen=2`：`streams.length === 1`（同一句柄）、`carrier.opened === 2`、`read().store.get(id) === entry`（身份不变）、当前值恢复。随后连接保持在线连续两次 `carrier.break()`（每次等到新一代 baseline），仍收到第 4 代 baseline 且 `done` 未 reject（`accept()` 清零重试计数）。
  3. `host watch：卸载中止打开的流，客户端终止并保留 stale 的最后已知值，SQLite 只关一次`：`t.mock.method(SqliteStorage.prototype, 'close')`；baseline 之后 `t.mock.method(host.controller, 'baseline')` 计读取；`installed.dispose()` 与 1 秒超时赛跑先完成；`await assert.rejects(follower.done, /在 gap 之外结束/)`；`read()` 断开且全部 stale；`host.dispose()` 后 `close` 调用 1 次，`assert.throws(() => host.watch(new AbortController().signal), /已关闭/)`；再等 30ms，读取次数不再增长。
  4. `host watch：Host 侧读取异常经漏斗只以固定文案终止，诊断日志多一行 operationFailed 且不含路径`：baseline 之后读 `<dataDir>/diagnostics.log` 里 `operationFailed` 行数（文件不存在记 0）；`t.mock.method(host.controller, 'baseline', async () => { throw new Error('读取失败：' + dataDir) })`；`await assert.rejects(follower.done, (error) => error.message === 'harness-projects：操作失败，原因已写入宿主诊断日志')`；`operationFailed` 行数恰好加 1，日志全文不含 `dataDir`；`carrier.opened === 1`（非载体错误不重开）。
  5. `host watch：消费者提前 return 会结束内层一代，不再等下一次轮询`：直接消费 `host.watch(signal)`（另开一个不会自己中止的 signal，`t.after` 里中止作兜底）：第一项为 baseline，`return()` 之后下一次 `next()` 与 100ms 计时赛跑，先完成且为 `{ done: true, value: undefined }`（变异 M21 下内层一代停在 `yield` 上，赛跑输给计时器）。
  6. `host watch：空数据根只有 r=0、无工作区的 baseline，read() 保持 undefined，流不终止`：`open(t, { seed: false })`；等到 `watch baseline r=0 gen=1`；`carrier.frames[0].kind === 'baseline'`、`.baseline.revision === 0`、`.baseline.workspace === undefined`、`.baseline.entities` 深等于 `[]`；挂上 `done` 的结算标记，`t.mock.method(host.controller, 'baseline')` 计读取并有上限地等到再读 3 次（证明过了几个 tick）；`follower.read() === undefined`、`carrier.frames.length === 1`、`done` 未结算。它钉住「客户端接受 `workspace` 缺省的帧头（`wire.ts:64`、`sync.ts:208`）」这条与 A 空数据根的兼容。
- [ ] `tests/integration/harness-plugin-artifact.test.js` 只改 `e.` 节：`applyClient` 的子 Context 加 `remote.$stream(options)`（记录 options，返回桩流：迭代的 `next()` 挂起直到 `dispose()` 以 `done` 结束，`dispose` 计数）、`remote.harnessProjects.watch(signal)`（记录 signal，返回空异步迭代）与 `effect(execute)`（记录 `execute()` 的返回）；新增 `it('客户端经 $stream 打开 watch 一次，open 转交同一个 signal，卸载 effect 关闭它')`：`$stream` 被调 1 次；以一个新 signal 调 `options.open(signal)`，`harnessProjects.watch` 收到的是同一个 signal（变异 M16 没有别的杀手，所以保留这一行）；`effect` 登记 1 次且执行其 disposer 后桩流 `dispose` 计数为 1。不再断言 `name` 类型与 `ended` 的返回类型。既有日志断言保持（桩流不交付项，不产生 watch 日志）。另加 `it('$stream 抛错也不丢面板…')`：`applyClient(baseline, streamError)` 让桩 `$stream` 抛错，`apply` 的拒绝记入 `seen.thrown`（宿主 fiber 吞掉回调异常并记日志），断言 `thrown.message` 与面板登记数 2（M22）。**评审修复改写（D38）**：这个前提不成立，真实宿主里 `apply` 不 reject，回调抛错会让 fiber 撤回面板；e 节的假 Context 改为 Cordis 4.0.4 的 fiber 模型（`HARNESS_CORDIS` 时用真实 `Context.inject`），卸载用例改为卸载整个 fiber，抛错用例改为断言面板贡献仍在、fiber 没有错误并记 `watch open failed`。
- [ ] 跑测试确认红（`host.watch is not a function` 与 `openWorkspaceWatch` 未导出，不是夹具或 seed 失败）；按 Design / Spec 改 `host-composition.ts`、新建 `workspace-watch.ts`、改 `client.ts` 与 `host-surface.ts`。
- [ ] 验证全绿后执行 Batch R 第 5、6 步（推送并改 base）。

**验证**：

    node --test --test-timeout=120000 tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js tests/integration/harness-plugin-host-roundtrip.test.js
    pnpm run typecheck
    pnpm run boundaries
    node scripts/rule-checks.mjs size origin/feature/host-provider-composition

期望：host-watch `ℹ pass 6`，四份文件 `ℹ fail 0`（后两份是 A 的文件，证明追加 `watch` 后 `invocations[0]` 与 A 的组合行为不变）；typecheck 无错误（Batch 3 留下的那一个也消失）；boundaries 全绿；size 报告代码 ≤ 760 的承诺值（硬线 800）、文档 ≤ 1300，超出先按 Global Constraints 的削减与死代码复审处理并记入 Surprises，仍 > 800 按 D23 拆分。

**回滚**：revert 本批提交；Batch 1–3 的能力保留但组合没有 `watch`、客户端不接线（此时 typecheck 回到 Batch 3 的已知缺口，所以回滚本批必须连同 Batch 3 一起 revert）。

### Batch 5 · 对抗验证（实现者完成后、独立验收前）

**最小闭环**：每条关键断言都被一条变异证明有判别力；替身与真实 `RemoteStream` 行为一致；本分支（已含 A）与 C、D 的并集全绿。本批在 Batch R 之后、叠在 A 上执行。

**涉及文件**：只读代码与测试；工作副本写在 `.superpowers/review/host-watch-stream/`（git 忽略），最终 spec 全文由 Batch 6 写进本计划 `Outcomes & Retrospective`。

- [ ] 把下表写成 `node scripts/review-mutate.mjs` 的 spec（`command` 为 `["node","--test","--test-timeout=120000","tests/e2e/workspace-stream.test.js","tests/e2e/client-stream.test.js","tests/e2e/workspace-read-assembly.test.js","tests/contract/harness-host-remote-adapter.test.js","tests/integration/harness-plugin-host-watch.test.js","tests/integration/harness-plugin-artifact.test.js"]`）。脚本在施加前按字节读入内存、锚点不是恰好出现一次就报 `NOT_APPLIED` 且不跑测试、跑完按字节还原并比对；先在最终树上核对每个锚点的确切文本（含缩进），对不上就改锚点，不改实现去迁就。

| ID | 文件 | 锚点 → 替换 | killedBy |
|---|---|---|---|
| M1 | `packages/controller/src/watch.ts` | `retain: Number.POSITIVE_INFINITY` → `retain: 1` | `两次写入只产出一条` |
| M2 | 同上 | `if (event.kind === 'gap') return` → `void 0` | `gap 后本代结束` |
| M3 | 同上 | `if (signal.aborted) return\n    const event = await watch.poll()` → `const event = await watch.poll()` | `中止后不再读取`（并进 workspace-stream 第 2 条） |
| M4 | `apps/harness-plugin/src/remote.ts` | `lifetime.abort()` → `void 0` | `aborts and drains an open watch` |
| M5 | 同上 | `yield toJson(frame)` → `yield frame` | `strictly JSON-encodes every watch frame` |
| M6 | `apps/harness-plugin/src/host-composition.ts` | watch 成员里的 `if (closed) throw new Error('host 已关闭')\n    const frames = streamWorkspace(` → `const frames = streamWorkspace(`（缩进按最终树取） | `SQLite 只关一次` |
| M7 | `packages/client/src/sync.ts` | `markGap` 里的 `store.markAllStale()\n    options.onGap?.(gap, store)` → `options.onGap?.(gap, store)`（Batch 6a 起锚点在 `markGap`，D33） | `gap 先整表 stale` |
| M8 | `packages/client/src/stream.ts` | `connect(() => sync.disconnect())` → `connect(() => undefined)` | `同一回调内整表 stale` |
| M9 | 同上 | `if (report.kind === 'gap') stream.restart()` → `void 0` | `gap 先整表 stale 再重开` |
| M10 | 同上 | `item.accept()` → `void 0` | `重连在同一句柄上重拉` |
| M11 | 同上 | `if (baseline === (item.generation === opened))` → `if (false)`（Batch 6c 起的锚点，D34） | `违例与被拒的帧终止` |
| M12 | 同上 | `if (closed) return` → `void 0` | `close 之后迟到的帧` |
| M13 | 同上 | `if (!closed) throw error` → `void error` | `违例与被拒的帧终止` |
| M14 | `packages/client/src/sync.ts` | `store.revision > snapshot.revision &&` → `false &&` | `低 revision baseline 只有新 generation evidence` |
| M15 | `apps/harness-plugin/src/client.ts` | `child.effect(` → `void (` | `卸载 effect 关闭它` |
| M16 | `apps/harness-plugin/src/workspace-watch.ts` | `open: (signal) => child.remote.harnessProjects.watch(signal)` → `open: () => child.remote.harnessProjects.watch(new AbortController().signal)` | `open 转交同一个 signal` |
| M17 | `apps/harness-plugin/src/host-composition.ts` | `next: () => guarded(() => frames.next())` → `next: () => frames.next()`（去掉漏斗） | `经漏斗只以固定文案终止` |
| M18 | `packages/controller/src/watch.ts` | `if (event === undefined) continue` → `if (event === undefined \|\| event.kind === 'metadata') continue`（原 X5） | `来源降级产出 metadata` |
| M19 | 同上 | `seed: baseline, retain` → `retain`（原 X6；立即节拍无上限时会自旋挂住进程） | `两次写入只产出一条` |
| M20 | 同上 | `if (signal.aborted) return\n  const baseline = await source.baseline()` → `const baseline = await source.baseline()`（原 X7） | `中止后不再读取` |
| M21 | `apps/harness-plugin/src/host-composition.ts` | `return: () => frames.return()` → `return: async () => ({ done: true, value: undefined })`（原 X3） | `提前 return` |
| M22 | `apps/harness-plugin/src/client.ts` | `child.slots.inject('main', () =>` → `openWorkspaceWatch(child); child.slots.inject('main', () =>`（把 watch 放回登记之前） | `不丢面板` |
| M23 | 同上 | 去掉 `openWorkspaceWatch(child)` 外的 `try { … } catch { …; return }`（回到评审前的 head，D38） | `不丢面板` |
| M24 | `packages/controller/src/watch.ts` | `abortableDelay` 里的 `signal.addEventListener('abort', done, { once: true })` → `void signal`（评审 R5，D38） | `缺省等待可中止` |
| M25 | `apps/harness-plugin/src/client.ts` | catch 里的 `console.error('[harness-projects] watch open failed', error)\n      return` → 去掉 `return`（复评 RF1-d，D38） | `不丢面板` |

- [ ] 运行 `node scripts/review-mutate.mjs .superpowers/review/host-watch-stream/mutants.json --root .`。期望退出码 0（全部 `KILLED`，且失败用例名含 `killedBy`）。出现 `SURVIVED` 时先判断是补用例还是等价变异；等价变异写明理由记入 Surprises，补用例后整表重跑。
- [ ] 真实类交叉核对（本机、只读宿主源码、不入 CI）：

      GW_PKG=$(find "$HOME/.npm/_npx" -maxdepth 5 -path '*/@deepseek-ai/dsh-api-gateway/package.json' | head -1)
      node -p "require('$GW_PKG').version"
      HARNESS_GATEWAY_CLIENT="$(dirname "$GW_PKG")/lib/types/client" node --test --test-timeout=120000 tests/e2e/client-stream.test.js tests/integration/harness-plugin-host-watch.test.js

  期望：版本为 `0.2.0-rc.2`（不是就记录实际版本并核对 H5 行号）；两份文件 `ℹ fail 0`。找不到宿主安装时记为「未执行」及原因，不算通过。
- [ ] 并集全量不在本 PR 另开工作树：本分支已含 A，A + B 的并集就是本分支自己的 `pnpm verify`（CI 每次推送也在跑）。B + C + D（含 A）的并集由协调者在一次性工作树 `.worktrees/round6-union`（分支 `test/round6-union`，不推送）合并 `main` + 本分支 + C + D 后跑 `pnpm install --frozen-lockfile --offline && pnpm verify && pnpm run boundaries`；本 PR 置 ready 前与每次合并前各跑一次，读数（时刻、四个 head）回填本计划 Progress。冲突或失败写进 Surprises 并通知相关 owner。

**回滚**：本批不改受跟踪文件；变异脚本异常时按其退出码 2 / 130 的说明确认已还原（`git status --short` 只剩预期改动）。

### Batch 6a · 独立验收与重构，冻结树（Opus 验收者）

**最小闭环**：独立复读与重构不改变验收结果；本批结束时代码树冻结，记下插件两半的 sha256，作为 S3 的构建输入。

**涉及文件**：验收者认为必要的本 PR 文件集内的重构；不改 A 的文件。

- [ ] 独立复读：对照 Validation and Acceptance 逐条重跑证据；检查不变量、`remote.ts` 未 import controller、日志不含内容与 id、`undefined` 字段在帧里被删除、卸载顺序（A 的 I7）、`watch` 只追加在 A 的结构上、测试是否会因计时器挂住。可证伪的复现在 A 的 head、本 PR head 与协调者的并集上各跑一次，区分本层回归与 A 的既有行为。重构后整表重跑 Batch 5 的变异（修复本身也要复评）。
- [ ] 全量门（`<base>` 为当时 PR 的 base，栈上是 `origin/feature/host-provider-composition`）：

      pnpm verify
      pnpm --dir apps/harness-plugin run pack:plugin
      pnpm run boundaries
      node scripts/workflow-check.mjs
      node scripts/rule-checks.mjs disclosure <base>
      node scripts/rule-checks.mjs size <base>
      git diff --check <base>...HEAD
      python3 "$HOME/.agents/skills/exec-plan/scripts/lint_execplan.py" docs/exec-plan/active/2026-10-15-host-watch-stream.md

  期望：verify 的 typecheck、contract / integration / e2e、MVP-0 全绿；`pack:plugin` 之后 boundaries 仍全绿（构建产物不被扫描误判）；workflow-check 无 findings；disclosure 无命中；size 代码 ≤ 760（硬线 800）、文档 ≤ 1300；diff-check 无输出；lint 输出 `OK`（本机没有该脚本时记为未执行）。
- [ ] 冻结：`git status --short` 为空时记 `git rev-parse HEAD`，`shasum -a 256 apps/harness-plugin/dist/package/lib/index.js apps/harness-plugin/dist/package/lib/client.js`，写进 Progress。此后到合并前，这两个 sha256 任一变化都要重做 S3 Phase 2（新鲜度规则见 Batch S3）。

**回滚**：revert 重构提交；冻结前的 head 有 backup ref。

### Batch 6b · 文档回填、提交整合与 ready（Opus 验收者 + 协调者；S3 Phase 2 之后）

**最小闭环**：技术债务、索引、证据回填；提交整合后 PR 置 ready 并请求人类评审。只改文档，不改冻结的代码树。

**涉及文件**：本计划、`docs/exec-plan/tech-debt-tracker.md`、`docs/README.md`、`tests/integration/README.md`（可选）。

- [ ] 在 `docs/exec-plan/tech-debt-tracker.md` 的 Open Items 表里按编号位置手工插入 TD-057..TD-060 四行（不管 A、C、D 谁先合并，057..060 都落在 056 之后、061 之前；11 列：ID、当地日期 `2026-10-15 HH:MM +08`、Open、本计划路径、子系统、`feature/host-watch-stream`、记录者、简述、延期理由、遗留影响、下一步；内容取 Design / Spec 的技术债务表）。不要运行 tracker 脚本（会抹掉既有条目）；不碰 TD-030、TD-031 的单元格（只有 A 改它们）。
- [ ] 可选：`tests/integration/README.md` 紧接 A 的「Host 组合（#132）」小节之后加「Host watch（#276）」小节，列 `harness-plugin-host-watch.test.js` 的五条用例与它们保护的不变量（约 10 行，文档桶）。
- [ ] 回填 Progress、Surprises、Outcomes（含变异 spec 全文与读数、交叉核对读数、S3 Phase 2 读数、观察时刻与 head）。
- [ ] 重跑文档门：`node scripts/rule-checks.mjs disclosure <base>`、`node scripts/rule-checks.mjs size <base>`、`git diff --check <base>...HEAD`、lint；再算一次两个 lib 的 sha256，必须等于 D38 记录的值（原为「必须与 Batch 6a 相同」，Superseded by D38）。
- [ ] 整合提交为可独立理解、回滚、审阅的交付物：① `docs(exec-plan): 编写宿主 watch 流交付计划`（含 `docs/README.md` 索引行）；② `feat(client): 帧化 workspace watch 并以推模式维护 store`（controller 与 client 的源码与测试、夹具）；③ `feat(apps): 经 typed remote 流把 watch 送进插件客户端`（apps 源码与测试，含 `host-composition.ts` 的追加）；④ `docs(exec-plan): 回填 watch 流的对抗验证与技术债务`。每个提交正文说明为什么并以 `Refs #276` 结尾。整合前建 backup ref（`git branch backup/host-watch-stream-<yyyymmddhhmm>`），整合只改写 `<base>..HEAD` 范围；整合后用 `comm` 比对新旧 head 的文件集合（`git ls-tree -r --name-only <old> | sort` 与新 head 同样输出），再跑 `git diff <old> HEAD` 确认为空，`git log --format=%B <base>..HEAD | grep '^#'` 为空。
- [ ] 协调者在 `.worktrees/round6-union` 跑一次并集（Batch 5 同一条命令），全绿。
- [ ] 推送（用精确 old head 的 `--force-with-lease=feature/host-watch-stream:<old>`），回读 head、base、checks、`closingIssuesReferences`（栈上可能为空，见 Batch 0）与 review threads；全部通过后 `gh pr ready <n> -R "$REPO"` 并在 PR 上请求人类评审。合并由人类决定，次序见 Interfaces and Dependencies「栈与合并次序」。

**回滚**：回到 backup ref；已推送时用 backup ref 做 force-with-lease 恢复（交 `git-expert-operations` 流程）。

### Batch S3 · S-AB 会话 Phase 2：真实 Desktop 内观测 AC1（协调者 / 主会话负责，不得用本地测试替代）

**最小闭环**：在 DeepSeek Harness Desktop 0.2.0-rc.2 的真实 `desktop` profile 内，记录同一句柄、同一代上的 baseline 与一次规划变更之后的 delta（AC1）。

**时机**：Batch 6a 冻结之后、Batch 6b 整合与 ready 之前（Decision Log D22）。协调者串行运行两个窗口：先 S-D（PR D），后 S-AB（A 与 B）；本批是 S-AB 的 Phase 2，排在 A 的 Phase 1（A 的验收 9）与 Phase 1b（A 的验收 8）之后、Phase 3（恢复）之前。全部读数带 +08 时刻写进拥有它的计划。

**前置**（全部满足才开始）：

- S-D 已关闭。A 已 tree-final（A 的 Batch 8a 完成、变异表全绿、两个 lib 的 sha256 已记）；本 PR 在 A 的 tree-final head 之上已完成 Batch 6a（sha256 已记）。
- 人类门：A 的 H3（在真实 `desktop` profile 安装插件、在 `~/.dsh/harness-projects/` 建库与种入）与 H4（探针证据）已答复；A 的 H5 由人类完成——在 Desktop 凭据存储里配置 `HARNESS_PROJECTS_GITHUB_TOKEN`。本 PR 的 AC1 必须有 H5（规划变更只能经 GitHub 规划挂载进入快照）。agent 从不读取、打印或粘贴凭据值与带令牌的 URL。
- Desktop 永远使用 `~/.dsh`，`DSH_HOME` 只对 CLI 路线生效，所以没有「一次性 profile」可用：安装与数据根都在真实 `desktop` profile 下，受 A 的 H3 约束；数据根由人类挪开，agent 不删除任何东西。
- 规划挂载来自 A 的种子脚本（被忽略的 `.superpowers/s3/seed.mjs`，A 的 Phase 1b 写入：工作区 `00000000-0000-4000-8000-000000000228`、一个 `development.local-git` 挂载、句柄 `HARNESS_PROJECTS_GITHUB_TOKEN` 的 github.com 账号、`projectNodeId` 为沙箱 Project A 的 `planning.github-projects` 挂载）。
- 版本复核：`npm view @deepseek-ai/dsh dist-tags --json` 与 Desktop 的 `CFBundleShortVersionString` 都读到 0.2.0-rc.2，否则停下问人类。

**Phase 0 · 构建**（与 A 的构建同一轮；每个构建在自己的工作树、`git status --short` 为空时进行）：

- `B-prod`：本 PR head（含 A）。`pnpm --dir apps/harness-plugin run pack:plugin`；记 head 与 tgz、`lib/index.js`、`lib/client.js` 三个 sha256，后两个必须等于最后一次冻结（Batch 6c，见 Progress）的值；tgz 复制为 `$SCRATCH/b-prod.tgz`（`$SCRATCH` 由 `mktemp -d` 在系统临时目录创建，`$DESKTOP_APP` 为 Desktop 应用包根目录）。
- `B-probe`（可选，只在 DevTools 证实不可用时建，需人类把 A 的 H4 扩展到它）：在 `client.ts` 的注入回调里临时加一行，加载约 120 s 后调用一次 `bootstrapWorkspace`（`setTimeout(() => void child.remote.harnessProjects.bootstrapWorkspace({ kind: 'user', id: 's3-276' }, 's3-276-1'), 120_000)`）；`git diff > "$SCRATCH/b-probe.diff"`，构建后把 tgz 复制为 `$SCRATCH/b-probe.tgz` 并记三个 sha256；`git restore apps/harness-plugin/src/client.ts`、确认 `git status --short` 为空，重建后三个 sha256 必须回到 `B-prod` 的值。永不提交。

**Phase 2 · 步骤**：

1. 人类完全退出 Desktop。
2. 安装：`"$DESKTOP_APP/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop remove @harness-projects/app-harness-plugin`（未安装时报错可忽略），再 `… plugin --profile desktop add "$SCRATCH/b-prod.tgz"`，期望退出码 0。agent 先 `: > "$SCRATCH/desktop.out"`；人类在自己的终端运行 `open -a "$DESKTOP_APP" --stdout "$SCRATCH/desktop.out" --stderr "$SCRATCH/desktop.err"`，打开 Harness Projects 面板与 DevTools。`desktop.out` 含带令牌的 URL，只用 `grep -c` 或 `grep -F '[harness-projects]'` 读取。
3. 记录 `[harness-projects] watch baseline r=<R> gen=1` 与控制台时刻。
4. 人类在沙箱 Project A 上改 E1-3 写入夹具 `issue-writable`（沙箱仓库的 issue 3，见 `docs/architecture/gate-e1-write-and-events.md` 实验 1）的 `Status`（或 `E1 Text`），先记下原值。只动这一条；不碰 pr-gamma（C 记录的 PR）、issue-alpha 与 draft-beta。这是人类执行的外部写入。
5. 人类在同一页面的 DevTools 控制台执行同源请求触发一次引导（浏览器自动带上会话，任何人都不读取或粘贴 cookie / 令牌）：

       await (await fetch('api/harnessProjects/bootstrapWorkspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'harnessProjects/bootstrapWorkspace', payload: { args: { actorRef: { kind: 'user', id: 's3-276' }, idempotencyKey: 's3-276-1' } } }) })).json()

   期望响应 `result.ok === true`。退路：DevTools 不可用时，在第 1–2 步改装 `B-probe`，等它约 120 s 后的自动引导。
6. 记录 `[harness-projects] watch delta r=<R+1> gen=1` 与时刻；确认其间没有 `gen=2`、页面没有刷新。
7. 可选（非决定项，对应 spike O3.6）：退出并重启 Desktop，记录 `watch carrier lost` 与之后更高代的 `watch baseline`。
8. 人类把沙箱条目改回第 4 步记下的原值，再按第 5 步触发一次引导（幂等键 `s3-276-2`）重同步，记录随后的 delta 行。

**Phase 3 · 恢复**（与 A 共用，协调者执行）：先 remove 再 add `A-prod` 或人类指定的构建；`~/.dsh/harness-projects` 原样保留，是否清理由人类决定。

**记录**：Desktop 版本、dist-tags、head、tgz 与两个 lib 的 sha256、探针 diff 行数（用了 `B-probe` 时）、控制台行与时刻、截图文件名（截图不入库）写进本计划 Progress 与 Outcomes；不写令牌 URL、本机用户名与绝对路径。在 #276 留英文观测评论是代表用户的公开写入，协调者先用一句可批准陈述问人类，得到明确同意再发。

**判定**：第 3、6 步两行都在、`gen` 相同、delta 的修订大于 R（预期 R+1）→ AC1 通过。A 在本 PR 评审期内无法就绪时，AC1 的处理（等待 A、接受其它宿主内证据或移交）属于验收范围变更，必须由人类决定并记入 Decision Log；B 不能带着未闭合的 AC1 合并，也不得静默放弃。2026-10-15 的执行读数、与本节的偏差（`B-probe` 触发、180 s、第 7、8 步未执行、Phase 3 装回 B-prod）和判定口径见 Progress 的 Batch S3 与 D36、D37。

**新鲜度**：合并前本 PR 的 `lib/index.js` 或 `lib/client.js` 的 sha256 有任何变化，就在新 head 上重做 Phase 0 与 Phase 2，或请人类就该差异明确裁决；保树的提交整合与 restack 不触发重做（仍以重算的 sha256 相同为准）。

**回滚**：装回 `A-prod`；不删任何数据根；沙箱条目由人类改回原值（第 8 步）。

## Concrete Steps

执行顺序与分工（批次内容只在 `Plan of Work` 写一次，这里只写怎样走）：

1. 协调者（主会话）执行 Batch 0（base `main`）。
2. 阶段 I：实现者（Sonnet，只在 `.worktrees/host-watch-stream` 内工作）现在就与 A 并行，按 Batch 1 → 2 → 3 执行；Batch 3 依赖 Batch 1 的 `streamWorkspace`。每批：读本计划该批 → 写红测试并确认失败原因 → 实现 → 跑该批验证 → 回填 `Progress`（带 `YYYY-MM-DD HH:MM +08` 时刻）、`Surprises & Discoveries`、`Decision Log` → 提交（`Refs #276`）。Batch 0–2 推送；Batch 3 只本地提交。Batch 3 完成后实现者停下等 Restack 门，不碰 `host-composition.ts`。
3. Restack 门：A 在 `feature/host-provider-composition` 提交 Batch 4 后，协调者执行 Batch R 第 1–4 步。A 之后每次整合 force-push，协调者重复 Batch R（backup ref 在先，核对本 PR 路径的树差为空）。
4. 阶段 II：实现者执行 Batch 4（完成后协调者执行 Batch R 第 5–6 步：推送、改 base、回读）→ Batch 5。
5. 独立验收者（Opus，未参与实现）执行 Batch 6a；重构后整表重跑 Batch 5 的变异，冻结并记 sha256。
6. 协调者在 S-AB 窗口执行 Batch S3（Phase 2），前置见该批。这替代旧的「S3 可以在 Batch 6 之前或之后」：S3 必须在 6a 冻结之后、6b 整合与 ready 之前。
7. 独立验收者与协调者执行 Batch 6b，PR ready 后请求人类评审；合并次序与每次合并前后的步骤见 Interfaces and Dependencies「栈与合并次序」。
8. 规模：Batch 4 的 size 读数 > 760 时，在 Batch 5 之前做完 Global Constraints 承诺的削减并复审死代码；仍 > 800 才按 D23 拆 B1 / B2，拆分由协调者执行并在 Bottom Change Note 记一条。
9. 任何批次发现与计划不符（锚点、行号、规模、宿主行为、A 的接口），先写进 `Surprises & Discoveries`，改计划时在 `Bottom Change Note` 追加一条，再继续。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| AC1 | 宿主内客户端收到 baseline，规划变更后至少收到 1 条 delta（记录观测，带宿主版本） | S3：Batch S3（S-AB Phase 2）第 3、6 步的控制台两行、宿主版本、head、两个 lib 的 sha256 与时刻；S2 前置：`harness-plugin-host-watch`「同一句柄同一代先 baseline、规划变更后 delta」。评审修复（D38）之后 `lib/client.js` 的 sha256 改为修复后的值，S3 证据按人类裁定沿用，裁定范围只限 `client.ts` 这一条失败分支改动 |
| AC2 | 断流时 store 立即 stale，重连在同一句柄上重拉 baseline（对宿主侧服务测试） | S2：`harness-plugin-host-watch`「载体断开的同一回调内整表 stale，重连在同一句柄上重拉 baseline」（同步快照、`streams.length === 1`、`gen=2`、条目身份不变）；变异 M8、M10 KILLED；Batch 5 真实类交叉核对 |
| AC3 | 流里只有 `packages/controller` 暴露的东西；`pnpm run boundaries` 通过 | S2：同一文件 AC1 用例里两帧深等于 controller 值的 JSON（深等即蕴含键集合）；契约「strictly JSON-encodes every watch frame」与 M5；S1：`WireStreamFrame` 定义在 controller，`remote.ts` 只透传；`pnpm run boundaries`；`client-browser` 断言浏览器构建含 `stream.ts` 而不含 controller 运行时源文件 |
| 4 | 卸载先中止流、排空后撤回，SQLite 只关一次（ADR-0013 留给 #276 的跨代 drain） | 契约「aborts and drains an open watch」、集成「卸载中止打开的流…SQLite 只关一次」；M4、M6、M21 |
| 5 | 每代协议：唯一开场 baseline、违例终止、gap 重开、close 吸收 | `client-stream` 三条用例；M9、M11、M12、M13 |
| 6 | 净 delta、gap 结束本代、中止后不再读，缺省等待可中止 | `workspace-stream` 三条用例（表驱动的一条含三个子用例；第 3 条用缺省等待，D38）；M1–M3、M18–M20、M24 |
| 7 | 发布门 | Batch 6a 全量门与 Batch 6b 文档门全部达到期望；协调者并集全绿 |
| 8 | Host 侧异常只以固定文案上 wire，诊断日志多一行 `operationFailed` 且不含路径（复用 A 的漏斗） | `harness-plugin-host-watch`「Host 侧读取异常经漏斗只以固定文案终止」；M17 |
| 9 | 与 A 的空数据根兼容：r=0、无工作区的 baseline 被接受，`read()` 保持 `undefined`，流不终止 | `harness-plugin-host-watch`「空数据根只有 r=0、无工作区的 baseline」 |

## Progress

- [x] 2026-10-15 09:55 +08 设计完成：三份独立设计经最终评审合成本计划（载体与协议取设计 1，store 语义取设计 2 的净 delta 与吸收态，验证与 S3 取设计 3）；用宿主 0.2.0-rc.2 的真实 `RemoteStream` 跑通原型（同代 baseline → delta、载体失败回调内同步 stale、gap → restart → 第 2 代 baseline、宿主卸载 → 客户端终止），见 Surprises。
- [x] 2026-10-15 10:31 +08 按跨 PR 集成评审修订本计划：改为叠在 A 上的原生栈、宿主侧测试改用 A 的选项与种子夹具、`watch` 经 A 的 `guarded` 漏斗、新增空数据根兼容用例、S3 改写为 S-AB Phase 2、规模重估与削减承诺、共享文件与合并次序协议（Decision Log D16–D28）。仍没有任何受跟踪代码改动。
- [x] Batch 0 计划入库、draft PR 与字段回读（base `main`）：2026-10-15 15:31 +08 回读（观察时刻）PR #345 为 draft，base `main`、head `feature/host-watch-stream`（远端仍是阶段 I 的 `cf8e0ace`），标签恰为 `kind:feat`、`area:apps`、`area:client`，里程碑 M4，`closingIssuesReferences` 含 #276；推送 restack 后的分支与改 base 仍是 Batch R 第 5、6 步（协调者）
- [x] 2026-10-15 10:51 +08 Batch 1 Controller 一代流：`workspace-stream` 先红（`streamWorkspace` 未导出）后绿 `ℹ pass 2`，typecheck 无错误
- [x] 2026-10-15 10:54 +08 Batch 2 Client 推模式接受与每代协议：`client-stream` 先红（`followWorkspace` 未导出、`client-browser` 缺 `stream.ts`）后绿 `ℹ pass 3`；验证命令五份文件 `ℹ pass 95` `ℹ fail 0`，拉模式既有用例全绿，typecheck 无错误
- [x] 2026-10-15 10:57 +08 Batch 3 Host stream 描述符与卸载排空（`remote.ts` 半边，只本地提交）：契约三条新用例先红（缺 `watch` 描述符、`service.watch is not a function`）后绿，契约文件 `ℹ pass 5`，三份验证文件合计 `ℹ pass 8` `ℹ fail 0`，boundaries `ℹ pass 9` `ℹ fail 0`；typecheck 恰好一个错误 `apps/harness-plugin/src/host.ts(61,43)` 缺少 `watch`（与计划预期一致）
- [x] Batch R restack 到 A：2026-10-15 12:00 +08 实现者已在本地完成步骤 1–4——rebase 到本地分支 `feature/host-provider-composition` 的 Batch 4 冻结点 `ecf161d3`（A 尚未推送，用本地 ref），backup ref `backup/host-watch-stream-pre-restack-202610151110` 指向旧 head `1b5a7135`；本 PR 自己路径的树差为空，与 A 的文件集合差只有本 PR 的 12 个路径；步骤 5–6（推送、改 base、回读）待协调者。2026-10-15 13:08 +08 验收者按 A 前进后的本地 head `1391c282`（A 的代码冻结点 `b2e39f6b` 加文档提交）重做步骤 1–4：backup ref `backup/host-watch-stream-pre-restack-202610151307` 指向旧 head `dd7aaa05`，`git rebase --onto feature/host-provider-composition ecf161d3` 无冲突；本 PR 路径树差为空，两个共享文件（`host-composition.ts`、安装件测试）上本 PR 的增删逐行相同，文件集合差只有本 PR 的 17 个路径与 `docs/README.md`，`grep '^#'` 为空（Surprises 2026-10-15 13:25）。远端 A 仍停在计划提交 `5c31daf6`，A 推送或整合改写后协调者须再做一次。2026-10-15 14:06 +08 第三次（A 简化之后）见下方独立的 Batch R 条目（评审会话 2026-10-15 核对：协调者已推送、改 base 并置 ready；评审后的整合与 restack 由评审会话执行，以 PR #345 最终 head 的回读为准）
- [x] 2026-10-15 12:00 +08 Batch 4 HostComposition.watch、客户端壳接线与宿主侧端到端（本地提交 `23564e2c`；推送并改 base 待协调者）：`harness-plugin-host-watch` 先红（`workspace-watch.ts` 缺失；补客户端接线后 `composition.watch(...) is not a function`）后绿 `ℹ pass 5`，重复 16 次无抖动；安装件 e 节新用例先红（`$stream` 未被调用，actual 0）后绿；验证命令四份文件 `ℹ pass 30` `ℹ fail 0`；typecheck 无错误（Batch 3 留下的缺口已关闭）；boundaries `ℹ pass 9`；`pnpm verify` 退出码 0（1597 通过）；workflow-check 无发现、disclosure 无命中、`git diff --check` 干净；变异预检 M4、M6、M8、M10、M15、M16、M17 全部 KILLED 且归因正确。规模读数见 Surprises（代码 833，超过计划上限 800）
- [x] 2026-10-15 12:50 +08 Batch 5 对抗验证（独立验证者，head `4c0c0e0f`，base `ecf161d3`，未改任何生产代码与测试）：计划整表 M1–M17 全部 KILLED 且失败用例名含各自 `killedBy`（`review-mutate.mjs` 退出码 0，每个变异施加前后 `git status --short` 为空）；真实 `RemoteStream`（宿主 0.2.0-rc.2，`HARNESS_GATEWAY_CLIENT`）下 `client-stream` + `host-watch` 共 `ℹ pass 8` `ℹ fail 0`，M8–M13 与 X19 在真实类上同样 KILLED；`pnpm verify` 退出码 0（1597 通过 / MVP-0 7 通过），boundaries `ℹ pass 9`，`pack:plugin` 之后 boundaries 仍 `ℹ pass 9`；并集（B + C + D）仍由协调者另跑。附加变异与探针发现的跟进项见下一条与 Surprises
- [x] 2026-10-15 13:00 +08 Batch 5 跟进（修复轮，实现者；头 `ca3241b9`）：① metadata 用例已补（`workspace-stream` 第 3 条，原 X5 即 M18 KILLED）；② 立即放行的节拍改为有上限的 `boundedTicks`（原 X6 即 M19 现在红得很快，不再挂住进程）；④ `openWorkspaceWatch` 与卸载 effect 挪到面板登记之后并补安装件用例（M22 KILLED）；验证者 P3 三处：X3 补 `host-watch` 提前 return 用例（M21）、X7 补预先中止断言（M20）、X10 的 `await done.catch` 等价而删除（D32）。逐项处置与被拒项见 D32
- [x] ③ 代码桶拆分裁决（协调者，D23）：修复轮后读数代码 879 / 1000（base `ecf161d3`，计划上限 800，承诺 760），已没有可削而不丢判别力的死代码；按 D23 拆分的量级：B1 = controller / client / 替身 / e2e 测试约 543，B2 = Host、壳与 S3 约 336（remote.ts 与 Batch 3 的契约测试跟 B2，D27）。Batch 6a 之后读数代码 885 / 1000（base 本地 A `1391c282`）：B1 = 550、B2 = 335（D33）。2026-10-15 13:55 +08 Batch 6c 精简后代码 717 / 1000，拆分条件（仍 > 800）不再成立；若协调者仍要拆，量级为 B1 = 408（controller、client、替身、两份 e2e、`client-browser` 一行）、B2 = 309（`apps/` 五个源文件、契约、host-watch、安装件 e 节）（评审会话 2026-10-15 核对：拆分条件不再成立，未拆分；评审修复后代码 786 / 1000）
- [x] 2026-10-15 13:00 +08 Batch 5 修复轮复评（头 `ca3241b9`）：计划整表 M1–M22 全部 KILLED 且失败用例名含各自 `killedBy`；验证者附加的 X1–X19 在同一树上除 X10（已删，锚点不存在）外全部红，X2 的 `killedBy` 标签应取用例名片段（见 Surprises）；Batch 1–4 的验证命令全部 `ℹ fail 0`（`workspace-stream` `ℹ pass 3`、Batch 2 五份文件 `ℹ pass 95`、Batch 3 三份 `ℹ pass 8`、Batch 4 四份 `ℹ pass 32`），typecheck 无错误，boundaries `ℹ pass 9`（`pack:plugin` 之后仍 `ℹ pass 9`），`pnpm verify` 退出码 0（1600 通过 / MVP-0 7 通过），workflow-check 无发现，disclosure 无命中，`git diff --check` 干净。`pack:plugin` 后 `lib/index.js` 的 sha256 与 Batch 5 记录相同（`7ad8e14d…`），`lib/client.js` 变为 `639d84d46f6c3a08bffe2c1d8d250c332973b66c26e50220b1e42d15d51865ac`（client.ts 重排与 stream.ts 删行所致；这是修复轮的中间值，不是 6a 冻结值）。真实 `RemoteStream`（宿主 0.2.0-rc.2，`HARNESS_GATEWAY_CLIENT`）下 `client-stream` 加 `host-watch` 共 `ℹ pass 9` `ℹ fail 0`；M1–M22 与 X1–X19（除已删的 X10）都在代码最终树（仅文档提交不同）上整表重跑，退出码 0
- [x] 2026-10-15 13:25 +08 Batch 6a 独立验收、重构、冻结并记 sha256（独立验收者 Claude Opus，未参与实现；base 本地 A `1391c282`）：先按 A 的新 head 重做 Batch R 第 1–4 步（见上）。对抗验收逐条重推 #276 的三条 AC 与计划不变量，探针 P1–P5（被忽略的 `.superpowers/review/host-watch-stream/acceptance/`，替身与真实 `RemoteStream` 各跑一遍全过）没有找到 P0、P1、P2 代码缺陷，唯一的新发现是附加变异 A2 存活（P3，已补用例），详见 Surprises 2026-10-15 13:25 与 D33。重构与补测三个提交：`1b4f03d5`（`markGap` 拉推共用）、`97f32c17`（host-watch 种子改用 A 夹具的导出）、`35fcd05f`（钉住 close 同步断开）。变异（权威读数，代码树 `35fcd05f`，每批前后 `git status --short` 为空）：计划整表 M1–M22 全部 KILLED 且失败用例名含各自 `killedBy`；附加 X1、X2、X4、X8、X9、X13、X14、X16、X19 与 A1–A3 全部 KILLED。真实类交叉核对（宿主 0.2.0-rc.2）：`client-stream` 加 `host-watch` `ℹ pass 9` `ℹ fail 0`。Batch 1–4 验证命令：`workspace-stream` `ℹ pass 3`、Batch 2 五份 `ℹ pass 95`、Batch 3 三份 `ℹ pass 8`、Batch 4 四份 `ℹ pass 32`，全部 `ℹ fail 0`。全量门：`pnpm verify` 退出码 0（1607 通过 / MVP-0 7 通过，在 `pack:plugin` 之前跑）、typecheck 无错误、boundaries `ℹ pass 9`（`pack:plugin` 之后仍 `ℹ pass 9`）、workflow-check 无发现、`disclosure feature/host-provider-composition` 无命中、`git diff --check feature/host-provider-composition...HEAD` 干净、lint `OK`；size 代码 885 / 1000（计划上限 800，拆分归协调者）。**树冻结**：代码树 head `35fcd05fa6f241ff6bd8b9e1620db9679f3ccac3`，`pack:plugin` 后 `lib/index.js` 的 sha256 为 `90369d9008dfe44b02ac7262e2bc8ffc1893a4a225d673d889f4533290f043c7`、`lib/client.js` 为 `a0031eb1156ac335768261ea5fbdf98de0b6339082dd641ba302531b173198c4`（再打一次两值相同；tgz 为 `646dd61e85683ca9364fcf3f5e8250ca5241deb8ba45ae589a7687ca7cf6f141`，新鲜度不绑定它）；`client.js` 不含 `streamWorkspace`、`watchWorkspace`、`diffSnapshots`、`createController`、`node:sqlite`、`@deepseek-ai` 与本机路径。打包后把 `dist/` 移出工作树（Surprises 2026-10-15 13:00 的陈旧产物问题）。此后的提交只改文档。Batch 6b 的前两项（TD-057..TD-060 按编号插入、集成 README 小节）已在本批写入
- [x] 2026-10-15 13:55 +08 Batch 6c 规模精简与重新冻结（独立精简者 Claude Opus；base 本地 A `1391c282`，起点 `56c5789c`、backup ref `backup/host-watch-stream-pre-simplify-202610151400`）：代码桶 885 → 717（`node scripts/rule-checks.mjs size feature/host-provider-composition`，提交 `3f48ab31` 实现、`74d223b6` 测试；实现 283 → 202、测试 602 → 515），逐项理由见 D34。先拿旧测试文件原样跑新实现（67 条全绿），再换新测试。变异（每批前后 `git status --short` 只剩预期改动，规格在被忽略的 `.superpowers/review/host-watch-stream/simplify/`）：计划整表 M1–M22 全部 KILLED 且失败用例名含各自 `killedBy`（M11 换锚点）；附加 X1、X2、X4、X8、X9、X13、X14、X16、X19、A2、A3 全部 KILLED（X8、X19 换锚点；A1 的锚点随 `applyEvent` 消失，见 D34）；新增 S1（拉模式 gap 不再重拉）、S2（`receive` 的 baseline 分支）、S3（不记已开场的代）全部 KILLED。真实 `RemoteStream`（宿主 0.2.0-rc.2，`HARNESS_GATEWAY_CLIENT`）下 `client-stream` 加 `host-watch` `ℹ pass 9` `ℹ fail 0`，M7–M13、X1、X8、X19、A2、A3、S3 在真实类上同样 KILLED。全量门：`pnpm install --frozen-lockfile --offline` 无变更，`pnpm verify` 退出码 0（1608 通过 / MVP-0 7 通过，在 `pack:plugin` 之前跑），typecheck 无错误，boundaries `ℹ pass 9`（`pack:plugin` 之后仍 `ℹ pass 9`），workflow-check 无发现。**重新冻结**（取代 Batch 6a 的冻结值）：代码树 head `74d223b6d92d5c0679432ce89c9e892afca2986b`，`pack:plugin` 后 `lib/index.js` 的 sha256 为 `0ad20d7607be362f98808bf297094eb4ac66eecd2768d1b3889a4a52fecaacec`、`lib/client.js` 为 `cba8f8903eecfbdfe400789a0fbd9c264be9b2e227ac6dc492d00e8bdc97cfd9`（再打一次两值相同；tgz 为 `7c9a5de78c22ed3676ca46120b3d7e8c1145a617c1343251df9694b1a3f117d8`）；`client.js` 不含 `streamWorkspace`、`watchWorkspace`、`diffSnapshots`、`createController`、`node:sqlite`、`@deepseek-ai` 与本机路径；打包后删除工作树内的 `apps/harness-plugin/dist/`。S3 尚未执行，以本条的两个 sha256 为准；本批期间本地 A 前进到 `36a67637`，restack 之后须重打并改记（Surprises 2026-10-15 13:57）
- [x] 2026-10-15 14:06 +08 Batch R 第三次 restack 到简化后的本地 A `4eaac807`（协调者派发，只本地，未推送）：A 在 Batch 6c 期间由 `1391c282` 线性前进了 `e038ccdb`、`36a67637`、`4eaac807` 三个提交（简化、测试合并、计划回填），`1391c282` 仍是合并基，所以直接 `git rebase feature/host-provider-composition`（与 `--onto … 1391c282` 等价，见 D35）。backup ref `backup/host-watch-stream-pre-restack-202610151400` 指向旧 head `51129b86`；工作区干净；22 个提交重放**无冲突**（预期的 `docs/README.md` 与安装件测试冲突都没有出现，见 Surprises）；用 `git -c core.commentChar=';'` 防吃 `#` 行。**新 head `0c6a4c0f`，代码树冻结点 `431a5e8d`**（即 `74d223b6` 的对应提交，此后只有计划提交 `0c6a4c0f`）。核对：本 PR 自己路径的树差（Batch R 第 4 步的命令）为空；旧 head 与新 head 的整树差恰为 A 的增量（13 个路径），其中 4 个与本 PR 共享（`host-composition.ts`、`tech-debt-tracker.md`、`tests/integration/README.md`、安装件测试），本 PR 在这 4 个文件上的增删行与 restack 前逐行相同；22 个提交的 `git range-diff` 为 21 个 `=`、1 个 `!`（6a 的文档提交，只有 tracker 里 A 改写的 TD-054 上下文行不同）；与 A 的文件集合差为 20 个路径（本 PR 自己的文件加 `docs/README.md`）；`git log --format=%B feature/host-provider-composition..HEAD | grep '^#'` 为空；`git diff --check` 干净；`disclosure feature/host-provider-composition` 无命中；`size feature/host-provider-composition`（合并基即 A 的 `4eaac807`）代码 717 / 1000、文档 884 / 1500（本条回填之前；栈累计代码 1485、文档 1452，只记录）。验证：`pnpm install --frozen-lockfile --offline` 无变更，`pnpm verify` 退出码 0（1606 通过 / MVP-0 7 通过；比 6c 少 2 条是 A 合并了冗余用例，不是本 PR 删检查），`pnpm run typecheck` 退出码 0，`pnpm run boundaries` `ℹ pass 9`（`pack:plugin` 之后仍 `ℹ pass 9`），`node scripts/workflow-check.mjs` 无发现。变异（规格即被忽略的 `.superpowers/review/host-watch-stream/simplify/` 下四份，未改动；每个 spec 前后 `git status --short` 为空且 `git diff` 的 sha256 都是空串的值）：计划整表 M1–M22 **22/22 KILLED**；附加 X1、X2、X4、X8、X9、X13、X14、X16、X19、A2、A3、S2、S3 **13/13 KILLED**；拉模式 S1 **1/1 KILLED**；真实 `RemoteStream`（宿主 0.2.0-rc.2，`HARNESS_GATEWAY_CLIENT`）下 M7–M13、X1、X8、X19、A2、A3、S3 **13/13 KILLED**（基线含 `client-stream` 加 `host-watch` 在真实类上全绿）。**重新冻结**（取代 6c 的 `lib/index.js` 值）：`pack:plugin` 打两次值相同，`lib/index.js` 的 sha256 为 `855c4934ac91886bb0f51f17997f8610db39d01da969cf680296c8013c6c2b7b`（6c 为 `0ad20d76…`，变化因 A 改了 Host 源码，符合 6c 的预言）、`lib/client.js` 为 `cba8f8903eecfbdfe400789a0fbd9c264be9b2e227ac6dc492d00e8bdc97cfd9`（与 6c 逐字相同，A 的增量不进浏览器入口）；tgz 为 `fd190bb45ca3821bda23ebe72aa86eba82d14a4fc2a1212802b1f46fc6ef82b4`（新鲜度不绑定它）；`client.js` 不含 `streamWorkspace`、`watchWorkspace`、`diffSnapshots`、`createController`、`node:sqlite`、`@deepseek-ai` 与本机路径；打包后已把工作树内的 `apps/harness-plugin/dist/` 移出。S3 以本条的两个 sha256 为准；Batch R 第 5、6 步（推送、改 base、回读）仍归协调者
- [x] 2026-10-15 15:26 +08 Batch S3 S-AB Phase 2 宿主内观测（协调者执行，人类伙伴操作 Desktop 与沙箱；本条由 6b 文档 owner 按协调者的窗口记录回填，只写值）。AC1 的 S3 成立，判定口径与限度见 D37，人类裁决原文见 D36：
  - 前置：S-D 已关闭；A tree-final（A 代码冻结 `36a67637`、head `4eaac807`）；H3、H4 于 10:56 +08 答复；H5 由人类在 Desktop 凭据存储写入句柄 `HARNESS_PROJECTS_GITHUB_TOKEN`（agent 未读取值）。版本复核 14:4x +08：`@deepseek-ai/dsh` dist-tags 的 `latest`、`next` 为 0.2.0-rc.2（`alpha` 为 0.2.1-alpha.3），Desktop `CFBundleShortVersionString` 为 0.2.0-rc.2。
  - Phase 0（14:0x–14:3x +08）：`B-prod` 取本 PR head `210626de`（代码树 `431a5e8d`），tgz `fd190bb4…`、`lib/index.js` `855c4934…`、`lib/client.js` `cba8f890…`，两个 lib 等于第三次 restack 的冻结值。
  - B-prod 运行：14:51:17 +08 先 remove 再 add（退出码 0，已装两个 lib 同上）；人类启动并打开面板与 DevTools，console 依次有 `baseline received`（revision 1、实体 3、来源 degraded / `not_found`）与 `[harness-projects] watch baseline r=1 gen=1`；另有两条宿主自己的请求错误（`changes.summary` 404、`plugins/events` 失败），与本插件无关。
  - 触发改走 `B-probe`（第 5 步的 DevTools fetch 两次没能执行，见 Surprises）：同一 head 在 `client.ts` 冻结 blob `abaca298` 上加 1 行未提交改动（1 增 0 删）——`openWorkspaceWatch` 之后 180 s 调一次 `bootstrapWorkspace({ kind: 'user', id: 's3-276' }, 's3-276-1')` 并打印 `[harness-projects] probe command <writeState>`；tgz `4362cae2…`、`lib/index.js` `855c4934…`（与 B-prod 相同）、`lib/client.js` `71de3a02…`；还原后重建，三个值回到 B-prod。15:00:10 +08 安装。
  - 第一次运行（沙箱未改，issue-writable 的 Status 为 In Progress）：`probe command local_only` 之后 `watch metadata r=1 gen=1`：没有规划变化时修订不变、只有来源变化。
  - 15:08:41 +08 人类把 issue-writable（#3）的 Status 由 In Progress 改为 Done。第二次运行：`watch baseline r=1 gen=1` → `probe command local_only` → `watch metadata r=1 gen=1`，修订仍为 1：当时的令牌读不到私有沙箱仓库，本地只有 3 个 draft 实体，6 个 issue / PR 条目以结构化 `permission_denied` 记为不可见，#3 的变化进不了快照。
  - 人类把句柄对应的值换成同时有 repo 与 project 权限的令牌，第三次运行（启动 15:16:03 +08，取自诊断日志的启动行）：`watch baseline r=1 gen=1` → `probe command local_only` → `watch delta r=2 gen=1`；同一代，没有 `gen=2`，页面没有刷新。15:20:43 +08 只读核对本地库：workspace 修订 2；实体 9（work_item 8、change_request 1）；external_identity 为 draft 3、issue 5、change_request 1；membership 9；committed 的 planning_sync_round 10 轮。`diagnostics.log` 12 行，全是每次启动成对的 `credentialFailed` / `CredentialServiceUnavailable`，没有 `syncRoundFailed`、`operationFailed`、`bindingDisabled`。
  - 收尾：15:26:13 +08 人类把 #3 的 Status 改回 In Progress 并回读确认；15:26:46 +08 Phase 3 按人类选择装回 B-prod（退出码 0，已装两个 lib 同 B-prod，`B-probe` 不再在 profile 中）；数据根原样保留，人类挪开的旧数据目录由人类决定去留。没有截图，console 读数是人类粘贴的文本，单行不带时刻；第 7 步（可选的断线重连）与第 8 步（改回后再引导并记 delta）未执行。
- [x] Batch 6b TD 与文档回填、提交整合、并集、PR ready：TD 四行与集成 README 小节已由 6a 写入；2026-10-15 15:34 +08 文档 owner 回填 S3 读数、D36–D37、Surprises 与 Outcomes，并重跑文档门（读数见 Outcomes）；提交整合、并集、推送、改 base、ready 仍归协调者（评审会话 2026-10-15 核对：协调者已完成整合、并集与 ready；评审后的整合、并集与合并由评审会话执行，以 PR #345 最终 head 的回读为准）
- [x] 2026-10-15 17:05 +08 评审修复（评审会话派出的实施者 Claude Opus，只在 `.worktrees/host-watch-stream` 内、只本地提交；评审 review id 5530340585，head `6fc33768`，base #344 head `697b283c`）：四条意见与 PR 级说明的处置见 D38，提交都是 `fixup!`，由评审会话整合。F1：`client.ts` 就地捕获 `openWorkspaceWatch` 的同步异常，安装件 e 节改为 Cordis fiber 模型；新用例在评审前的 `client.ts` 上红（模型与 `HARNESS_CORDIS` 真实 `Context.inject` 两种运行都是 `actual: []`），修复后绿。F3：`workspace-stream` 加第 3 条（缺省等待可中止）。F2、F4：TD-058、TD-060、失败模式表、风险 R3 改写，承接已由评审会话登记到 #229 与 #338（链接见 D38）。变异（规格在被忽略的 `.superpowers/fix-345/`，前后 `git status --short` 相同）：计划整表 M1–M24 **24/24 KILLED**（新增 M23 去掉 try/catch、M24 即评审 R5）；附加 X1、X2、X4、X8、X9、X13、X14、X16、X19、A2、A3、S2、S3 **13/13 KILLED**；拉模式 S1 **1/1 KILLED**；真实 `RemoteStream`（宿主 0.2.0-rc.2，`HARNESS_GATEWAY_CLIENT`）下 M7–M13、X1、X8、X19、A2、A3、S3 **13/13 KILLED**；F1 的三个变异在模型与真实 Cordis 下 **3/3 KILLED**。验证：评审要求的五份文件 `ℹ pass 42` `ℹ fail 0`；真实 `RemoteStream` 加真实 Cordis 下 `client-stream`、`host-watch`、安装件 `ℹ pass 32` `ℹ fail 0`；`pnpm install --frozen-lockfile --offline` 无变更，`pnpm verify` 退出码 0（1607 通过 / MVP-0 7 通过，比第三次 restack 多 1 条即 F3 的新用例），typecheck 无错误，boundaries `ℹ pass 9`（`pack:plugin` 之后仍 `ℹ pass 9`），workflow-check 无发现。`pack:plugin` 打两次值相同：`lib/index.js` `855c4934ac91886bb0f51f17997f8610db39d01da969cf680296c8013c6c2b7b`（不变）、`lib/client.js` `46eb7fe01fc3bdfdbcf160dd1621875bf88ab69284f2283492bfbcfcc7b82199`（原 `cba8f890…`；与修复前构建的差恰为 `openWorkspaceWatch` 一处，1 行变 7 行），tgz `8a574426…`（新鲜度不绑定它）；`client.js` 不含 `streamWorkspace`、`watchWorkspace`、`diffSnapshots`、`createController`、`node:sqlite`、`@deepseek-ai` 与本机路径，打包后已删除 `dist/`。S3 证据按人类裁定（D38）沿用到新的 `lib/client.js`，裁定范围只限这一条失败分支改动。文档门读数见 Outcomes 末段
- [x] 2026-10-15 17:40 +08 复评收尾（同一实施者；复评结论：修复成立，无新的 P0–P2，三条 P3 见 D38）：只改测试与文档，没有新的产物字节。安装件抛错用例补卸载断言，假 Context 的卸载改为逐个捕获 disposer 异常，真实路径从 Cordis logger 缓冲区取异常（Surprises 17:40）；新用例在评审前的 `client.ts` 上仍在两种运行下红（`actual: []`）。变异在最终代码树上整表重跑（前后 `git status --short` 相同）：计划整表 M1–M25 **25/25 KILLED**（M25 即 RF1-d）；附加 **13/13**、拉模式 **1/1**、真实 `RemoteStream` 下 **13/13**、F1 四个变异（M23、两条记日志变体、RF1-d）在模型与真实 Cordis 下 **4/4** 全部 KILLED。验证：五份目标文件 `ℹ pass 42` `ℹ fail 0`；真实 `RemoteStream` 加真实 Cordis 下三份 `ℹ pass 32` `ℹ fail 0`；先删 `dist/` 再跑 `pnpm verify`，退出码 0（1607 通过 / MVP-0 7 通过）；typecheck 无错误；boundaries `ℹ pass 9`（`pack:plugin` 之后仍 `ℹ pass 9`）；workflow-check 无发现。`pack:plugin` 打两次：`lib/index.js` `855c4934…`、`lib/client.js` `46eb7fe0…`，与 D38 记录的值逐字相同，tgz `8a574426…`；打包后已删除 `dist/`。#229、#338 的承接已由评审会话登记（链接见 D38）。

## Surprises & Discoveries

- 2026-10-15：帧级 `generation` 与 metadata 互斥（TD-059）。在本计划工作树根目录（`origin/main` `21cb29eb`）用原型给 metadata 帧加 `generation` 键后，`applyMetadata` 报「metadata 与本地修订 1 的实体集合不一致，或携带了来源以外的字段」；既有用例「接受点：generation 建立后，缺 generation 的 delta / metadata 被拒绝且快照不变」又要求不带 `generation` 的 metadata 被拒。所以拉模式一旦有 generation 生产者，metadata 就永远进不来；本 PR 因此不在帧上盖代号。
- 2026-10-15：`retain` 默认 1 会把一个 tick 内的两次写入变成 gap。同一工作树上原型：两次 `applyPlanningStatus` 之间只 poll 一次，`retain: 1` 得到 `kind: 'gap'`（1 → 3），`retain: Infinity` 得到 1 → 3 的净 delta 且两行都是 `blocked`。原因是 seed 是游标处的精确快照，跨任意修订的 diff 都精确（Decision Log D4）。
- 2026-10-15：宿主的 stream 项不经过 result codec（H3），描述符上的 strict codec 对流只是登记用；严格 JSON 化必须由 Host 方法自己做。
- 2026-10-15：插件客户端的注入子 Context 有 `effect`（H9，Cordis 4.0.4 的 Context 方法），卸载接线不需要读根 Context。
- 2026-10-15：原型（`.superpowers/design/B/proto-final-review/`，git 忽略）以宿主 0.2.0-rc.2 安装里的真实 `RemoteStream` 与 `RemoteStreamCarrierError` 驱动本设计：AC1-S2 回报 `[['baseline',1,1],['delta',2,1]]`；断载体时 `carrierFailed` 回调内同步读到 `connected=false`、全部行 stale；上线后 `['baseline',2,2]`、同一 stream 对象、条目引用不变；gap 路径回报 `baseline g1 → onGap 时行已 stale → gap g1 → baseline g2`，`open` 2 次；宿主生命周期中止后客户端 `done` 以 `ended after accept` 终止，宿主两代生成器都已结束。
- 2026-10-15 10:31 +08（读码，base `21cb29eb`）：`apps/harness-plugin/src/host.ts:61` 把组合当作 `remote.ts` 的 `HostCompositionCall` 交给 `installHostRemote`。Batch 3 一旦给 `HostCompositionCall` 加 `watch`，`tsc --noEmit` 就会在 `host.ts` 报缺少 `watch`，直到组合有了 `watch`；而 `host-composition.ts` 的 `watch` 要等叠到 A 之后才写。所以 Batch 3 只本地提交，Batch 4 补齐后再推送（D27）。Node 类型剥离不做类型检查，这段时间运行期测试不受影响。
- 2026-10-15 10:31 +08（读 A 的计划）：A 的计划在这一刻还把 `seed(dataPath, catalog, build)` 写在它自己的测试文件里，尚未抽成共享夹具 `tests/integration/fixtures/host-seed.js`；跨 PR 协议约定由 A 抽出、B 只读 import。Batch R 时若 A 的分支上还没有这个文件，协调者请 A 的 owner 抽出，B 不复制种子逻辑（D17）。
- 2026-10-15 10:31 +08（读码）：空数据根上 A 的组合是 `unavailableCore('工作区尚未创建')`：`getPlanningSync` 返回常量、`getWorkspaceMetadata` 返回 `workspace: undefined`，`storage.currentRevision` 对不存在的工作区读回 0（`packages/storage/sqlite/src/storage.ts:178`）。因此 Host 流的开场 baseline 是 r=0、无工作区，之后每次 poll 的修订与来源签名都不变、不产出事件；客户端 `assertHeader` 接受缺省的 `workspace`，`read()` 返回 `undefined`（D19）。
- 2026-10-15 10:57 +08（阶段 I 实现）：宿主真实 `RemoteStream`（0.2.0-rc.2，只读其源码确认语义）交付的项除 `generation` / `value` / `accept` 外还带 `signal`（当前代的中止信号）；非载体错误在宿主出口被包成 `RemoteError('gateway/internal', 原 message)`，message 保持不变，所以 `done` 的拒绝信息仍可用正则判别；替身同样交付 `signal`。`followWorkspace` 只用结构面里的三个成员，不受影响。
- 2026-10-15 10:57 +08（阶段 I 实现）：`node:test` 的 `t.test` 子用例会让 `ℹ pass` 数翻倍，`client-stream` 第 1 条的三行表驱动因此写成同一个用例里的循环（断言信息带行名），保持计划期望的 `ℹ pass 3`。
- 2026-10-15 10:57 +08（阶段 I 实现）：`remote.ts` 的 `toJson` 产出 `Object.create(null)` 记录，`assert.deepEqual` 与普通对象比较会因原型不同失败；帧在进程内的形状断言用 `JSON.stringify` 或 `Object.keys`（`undefined` 键被删除只有 `Object.keys` 能判别，`JSON.stringify` 本来就丢弃 `undefined`）。Batch 4 的 host-watch 用例经载体 JSON 往返，不受影响。
- 2026-10-15 10:57 +08（阶段 I 实现）：规模。Batch 1–2 提交后代码桶读数 606（计划同期估计约 470），主要是替身（183 对 120）与 `workspace-stream`（106 对 60）写得啰嗦；已收紧到替身 140、`workspace-stream` 79，见下一条读数。
- 2026-10-15 11:01 +08（阶段 I 收尾，`feature/host-watch-stream` 本地提交，base `origin/main` `21cb29eb`）：规模读数。`node scripts/rule-checks.mjs size origin/main` 代码 607 / 1000、文档 ≈ 830 / 1500（阶段 I 完成时）；代码文件明细：替身 135、`client-stream` 113、`workspace-stream` 79、`stream.ts` 64、`sync.ts` 90（54 增 36 删）、契约 48、`remote.ts` 41、`watch.ts` 35、其余 2。收紧一轮（提交 `chore(client): 收紧 watch 流相关的注释与测试体量`）后仍比计划同口径估计（阶段 I 部分约 561）多约 46：替身 135 对 120、`stream.ts` 64 对 55、`workspace-stream` 79 对 60、`client-stream` 113 对 105，契约 48 对 60 少 12。按计划对 Batch 4 的估计（`host-surface` 15、`workspace-watch` 20、`host-composition` 8、`client.ts` 3、`host-watch` 145、安装件 e 节 25–40）叠上去，阶段 II 后代码约 820，需要 Batch 4 的实现者在 `host-watch` 与 e 节再削约 60，或由协调者按 D23 决定拆分；阶段 I 的文件里没有再找到不影响判别力的死代码。
- 2026-10-15 11:01 +08（阶段 I 变异预检）：在提交后的干净树上用 `scripts/review-mutate.mjs` 跑了 M1–M5、M7、M9、M11–M14（命令只含阶段 I 已有的四份测试文件），11 个全部 `KILLED` 且失败用例名含各自 `killedBy`（读数在提交 `82250e9a` 的代码树上取得，之后只改了本计划文档）。M6、M15–M17 依赖 Batch 4 的文件；M8（`connect(() => undefined)`）与 M10（`item.accept()`）需要载体失败的用例，`client-stream` 的脚本化流不触发载体错误，所以由 Batch 4 的 `host-watch` 第 2 条杀死，预检不含这两个。每次施加前后 `git status --short` 为空。
- 2026-10-15 11:12 +08（Batch R 本地执行）：计划建议的 `git -c core.commentChar=';' rebase --continue` 会防止 `#` 开头的正文行被吃掉，但冲突续作产生的提交会把默认的 `# Conflicts:` 模板行原样留在正文里（这些行在默认注释符下本该被剥掉）。第一个提交（计划提交，README 冲突）因此多出 `# Conflicts:` 两行；而该提交原正文本身就有一行以 `#229` 开头，Batch R 第 4 步的 `grep '^#'` 因此非空。处理：用 `git commit-tree` 保留树与作者信息重写这一条正文（删除冲突模板行，把 `#229 的页面…` 改成 `issue #229 的页面…`），再 `git rebase --onto` 重放其余六个提交；重写后 `grep '^#'` 为空，本 PR 路径树差仍为空。以后 A 每次 force-push 后的 restack，在 README 冲突续作之后都要再 grep 一次并改写。
- 2026-10-15 11:16 +08（Batch 4 红测证据）：`harness-plugin-host-watch` 在 `workspace-watch.ts` 不存在时以 `ERR_MODULE_NOT_FOUND` 整文件红；补上客户端接线（只依赖已有的 client 包）后五条用例都在 `until` 里超时（约 2.4 秒），根因用 `installHostRemote` 直接调 `service.watch` 复现为 `composition.watch(...) is not a function or its return value is not async iterable`；超时而不是立刻失败，是因为客户端把宿主错误吞进 `done` 的拒绝与 `console.error`。种子、目录、选项都没有出错。
- 2026-10-15 11:50 +08（Batch 4 变异预检发现的测试卫生缺陷）：首次预检里 M16（`open` 不转交 signal）让 `harness-plugin-host-watch` 的清理 hook 永远挂住：客户端 `close()` 关不掉宿主那一代，轮询计时器让进程不退出，`--test-timeout` 只取消用例、不管进程，`review-mutate.mjs` 又等管道关闭，整轮变异挂了十多分钟。修法：`open` 的 `t.after` 里 `follower.close()` 与 `installed.dispose()` 各自带 2 秒上限并吞掉超时（卸载的 `lifetime.abort()` 兜底中止所有流）；用例是否被杀仍由断言承担。修后 M16 只由安装件 e 节新用例杀死，host-watch 五条用例不再拖死进程；变异读数是在修后的树 `23564e2c` 上重取的。
- 2026-10-15 11:58 +08（Batch 4 规模）：`node scripts/rule-checks.mjs size feature/host-provider-composition` 在 `23564e2c` 上读数代码 833 / 1000、文档 815 / 1500（文档读数在本回填提交之前）。Batch 4 本身净增 226 行：`harness-plugin-host-watch.test.js` 149、`workspace-watch.ts` 17、`host-surface.ts` 16、`host-composition.ts` 11、`client.ts` 3、安装件 e 节 30（含删 3 行）。阶段 I 的 607 加上 226 超过计划上限 800 共 33 行，也超过 760 触发线。已做：计划点名的两项削减（`workspace-stream` 中止并进第 2 条、安装件 e 节只测三件事、`host-watch` 不另断言键白名单与终止后 stale 的重复项）；再把测试装置压紧一轮（`open` 里的 `streams`/`logs`/`lost` 合并声明、e 节桩流去掉 `restart` 与 `return`），没有找到不影响判别力的死代码。剩余 > 800 的 33 行按 Global Constraints 与 D23 属于协调者的拆分决定（B1 = 阶段 I，base `main`，607 行；B2 = Host、壳与 S3，约 226 行加后续文档）；硬线 1000 不受威胁。Batch 5 之后若补用例，规模按此读数继续累加。
- 2026-10-15 12:50 +08（Batch 5，附加变异；规格在 `.superpowers/review/host-watch-stream/mutants-extra.json`，git 忽略）：除计划整表外加了 14 个变异，命令同整表。KILLED：X1（`workspace-watch.ts` 的 `carrierFailed()` 只剩日志）、X2（`ended` 两条文案互换）、X4（`intervalMs` 写死 1000，仅由空数据根用例靠计时杀死）、X8（`followWorkspace` 的 `finally` 去掉 `sync.disconnect()`）、X9（`close()` 不 `dispose()` 流）、X13（`AbortSignal.any` 只用网关 signal）、X14（`service.watch` 去掉 `beginCall()`）、X16（去掉 `endCall()`）、X19（换代不重置 `opened`）。SURVIVED：X3（`HostComposition.watch` 的 `return` 不再转给内层生成器）、X5（`streamWorkspace` 丢弃全部 metadata 事件）、X7（`streamWorkspace` 首行 `if (signal.aborted) return`）、X10（`close()` 里的 `await done.catch(...)`）。X6（`watchWorkspace` 去掉 `seed`）：`workspace-stream` 两条与 `host-watch` 第 1 条变红，但见下一条，整个测试进程挂住。
- 2026-10-15 12:50 +08（X6 挂住，根因已复现）：`workspace-stream` 第 2 条前半段用 `wait: async () => undefined`（立即放行）驱动一代流；实现不再产出 gap 时（X6，或任何让 `poll` 永不 gap 的回归），生成器在微任务里无限自旋，事件循环被饿死——最小复现 `.superpowers/review/host-watch-stream/probes/spin.mjs`：500ms 的看门狗计时器从未触发，被 6 秒的外部 alarm 杀死。`--test-timeout` 靠计时器，所以不会触发，CI 会一直卡到作业超时；`review-mutate.mjs` 也在等管道关闭，整轮挂了 4 分钟以上才被 SIGINT 中断（已按字节还原，`git status --short` 为空）。只换成 `setImmediate` 让出宏任务不够：用例被超时取消后，自旋的生成器仍占着事件循环，进程照样不退出（实测 3 分钟、47% CPU）。有效的修法是有上限的节拍：`let spins = 0` 且 `wait: async () => { if ((spins += 1) > 20) bound.abort() }`，把 `bound.signal` 传给这一代；没有 gap 时 20 个 tick 后本代结束，断言失败而不是自旋。副本 `probes/workspace-stream-fixed.test.js` 在正确实现上 `ℹ pass 2`，X6 下两条都变红且很快退出。与 Batch 4 的 M16 挂住同类：被破坏的实现必须让套件失败而不是挂住。
- 2026-10-15 12:50 +08（X5：metadata 帧没有任何用例）：丢弃 metadata 事件的变异 X5 让变异命令里的全部用例保持全绿。行为本身是对的：探针 `probes/metadata-e2e.test.js`（脚本化源，同修订仅来源降级）经 `streamWorkspace` → `service.watch` 的 `toJson` → 载体 JSON 往返 → `followWorkspace`，帧序列 `baseline, metadata`，降级行不是当前值、`read().reason` 为降级原因，流不终止；探针 `probes/idle-stability.test.js` 在真实种子库上把 `FaultKind.Offline` 打开再关闭（各引导一次），帧序列 `baseline, delta, metadata, metadata`，离线时 `reason` 为 `unavailable`、6 行全部非当前，恢复后 6 行全部当前，600ms 空闲（约 120 次 poll）没有多余帧、没有第 2 代。X5 被探针杀死（`verify-fix-x5.json`）。补用例有现成形状，代价约 12 行（见 Progress 跟进项）。
- 2026-10-15 12:50 +08（进程内“真实两半”探针，`probes/e2e-real-halves.mjs`，不入库）：把宿主 0.2.0-rc.2 真实的客户端 `RemoteService`（`$mount`、`invokeStream`、`RemoteStream`）与真实服务端 `TypertGatewayService`（`openWireStream`、`cancellableStream`）用进程内 `rpc.open` 接起来（只替换 WebSocket），上面跑本 PR 的 `client.ts` `apply`（放在 `inject: ['remote']` 的插件 fiber 里，否则根 Context 读 `remote` 会抛 `cannot get property "remote" without inject`，探针第一版因此失败，是探针缺陷）、真实 `installHostRemote` 与种子库上的真实 `HostComposition`。观测：`watch baseline r=1 gen=1`；引导后 `watch delta r=2 gen=1`（同一代）；断载体并上线后 `watch carrier lost`、`watch baseline r=2 gen=2`（同一句柄，`rpc.open` 第 2 次）；客户端 fiber 卸载后宿主不再读库（100ms 内读取增量 0），`installed.dispose()` 立即完成；宿主先卸载则客户端 `done` 以 `在 gap 之外结束` 终止并记 `watch failed`；面板 `main` 与 `sidebar.panellist` 照常注册。它不替代 Batch S3（WebSocket 与 Desktop 加载器没有经过），但把 R1 的“网关与 `$stream` 在同一代送达 baseline → delta”从 S1 推进到进程内实测。
- 2026-10-15 12:50 +08（注册表与网关的独立实测）：`probes/registry-register.mjs` 用真实 `TypertRegistry` 注册 `HOST_REMOTE`，通过，端点列表含 `harnessProjects/watch:stream`；`probes/gateway-stream.mjs` 经真实 `openStream` 驱动 `service.watch`：`signal` 作为最后一个参数送达，流项原样交付（`baseline, delta, delta`），载体 signal 中止得到 `gateway/cancelled` 且 `service.watch` 的 `finally` 照常归零计数，持续被拉取的流上 `installed.dispose()` 0ms 完成、消费者看到正常结束。服务端 pump（`stream-server.js` 的 `pump`）是“`await send` 之后才拉下一项”，所以卸载只会被一次进行中的 socket 写入拖住，与 R3 一致；`probes/dispose-pull.test.js` 复现了消费者停在 `yield` 不再拉时 `dispose()` 一直 pending，`return()` 之后完成（这是已接受的 R3，不是缺陷）。
- 2026-10-15 12:50 +08（红绿对照与稳定性）：把本 head 的 `tests/` 覆盖到 A 的 `ecf161d3` 源码树上（`git archive` 到草稿目录、`pnpm install --frozen-lockfile --offline`），新增与改动的用例在没有实现时全部变红：`client-browser`、契约三条（描述符、逐帧 JSON 化、卸载排空）、`client-stream`、`workspace-stream`、安装件 e 节新用例（`host-watch` 整文件缺 `workspace-watch.ts`，不另跑）。稳定性：6 路并行 36 次（`host-watch`、`client-stream`、`workspace-stream`、契约）全部退出码 0；CPU 双倍超订下 8 次全部通过。
- 2026-10-15 12:50 +08（A 已前进后的合并树）：本地 `feature/host-provider-composition` 已在 `3114a09e`，本 PR 仍叠在 `ecf161d3`。`git merge-tree --write-tree HEAD 3114a09e` 无冲突（树 `31c0088f`）；不建工作树，把这棵树 `git archive` 到草稿目录并 `pnpm install --frozen-lockfile --offline`：`tsc --noEmit` 无错误，本 PR 与 A 的相关 10 份文件共 64 个用例全绿，`pnpm run test` 为 1604 个用例通过 1603 个，唯一失败是 `issue-policy` 的“脚本被改名成不带扩展名的副本”用例，原因是草稿目录不是 git 仓库（`fatal: not a git repository`），与代码无关。这只证明 Batch R 重做大概率无冲突，不替代协调者在真实 restack 之后的 `pnpm verify`。
- 2026-10-15 12:50 +08（客户端壳的耦合，`probes/panel-vs-watch.test.js`）：`client.ts` 的注入回调里 `openWorkspaceWatch(child)` 在面板注册之前同步执行；`$stream` 缺失或抛错时回调整体抛出，`main` 与 `sidebar.panellist` 都不注册（观测 `registrations: []`）。B 之前回调里只有 `.then(…, …)` 包住的 unary 调用，不会因它而丢面板。0.2.0-rc.2 上 `$stream` 存在且不会同步抛错（H8），所以概率低，但面板是用户可见的交付物，代价是调整两行的顺序或加一层 `try/catch`。
- 2026-10-15 12:50 +08（工具注意）：不要用外部 `alarm` / `SIGALRM` 包装 `review-mutate.mjs`。它只在 SIGINT、SIGTERM、SIGHUP 上还原文件；我用 `perl -e 'alarm N'` 包了一次，超时被 SIGALRM 杀死，`watch.ts` 留在被变异的状态（`git status` 显示一个文件被改）。已用 `git checkout -- <file>` 还原并核对 `git hash-object` 等于 `HEAD:<file>`，之后一律后台运行并在需要时发 SIGINT。
- 2026-10-15 12:50 +08（读数）：`node scripts/rule-checks.mjs size ecf161d3` 在 `4c0c0e0f` 上代码 833 / 1000、文档 821 / 1500（本条回填之前）；仍比计划上限 800 高 33 行。附加变异里只有 X7、X10 指向两行无判别力的代码，删掉也不会让代码桶回到 800 以内，补上 metadata 用例与有上限节拍还会再加十几行，所以 D23 的 B1 / B2 拆分是实际路径，不是可选项。`pack:plugin` 之后 `apps/harness-plugin/dist/package/lib` 的 sha256（`4c0c0e0f`，restack 到 A 的最新 head 之前，不是 6a 冻结值）：`index.js` `7ad8e14d37690e80851773299e21574e4014161fd33cdca9cd321c3d84890bfe`，`client.js` `584ca2fa44b8189d99d0511956cb5a1143e08c855b9346d9ce23aab0b403f5de`；`client.js` 不含 `streamWorkspace`、`watchWorkspace`、`diffSnapshots`、`createController`、`node:sqlite`、`@deepseek-ai`，也不含本机绝对路径。

- 2026-10-15 13:00 +08（修复轮，复现）：在 `968fe598` 的干净树上先复现再修。六文件变异命令下 X5 `SURVIVED`（`GREEN exit=0`）；X6 下 `workspace-stream` 子进程 40 秒后仍以约 40% CPU 自旋，SIGINT 后 `review-mutate.mjs` 把 `watch.ts` 按字节还原（`git hash-object` 等于 `HEAD:` 的值）；`panel-vs-watch` 探针重现 `$stream` 缺失与抛错时 `已注册: []`。三项属实，唯一没有改动的是 R3（见 D32）。
- 2026-10-15 13:00 +08（修复轮，红绿证据）：metadata 与预先中止两处是“用例缺口”，用例在正确实现上本来就绿，红证据是变异：M18 / M20 KILLED。X6 的有上限节拍在变异下三条用例都在秒级变红并正常退出（挂住消失）。面板顺序是真实缺陷：新用例先红（`actual: [ 'boom', 0 ]`，面板登记数为 0）后绿；M22（把 watch 放回登记之前）KILLED。`HostComposition.watch` 的 `return` 转发：M21 KILLED，并且验证者建议的契约桩路线杀不了它——契约测试用组合桩，不执行 `host-composition.ts`。
- 2026-10-15 13:00 +08（工具注意：变异批不要并发）：我在上一批还在施加 X16 / X19 时又启动了 X9 的单独变异批，两个 `review-mutate.mjs` 同时改同一棵树，后一批挂住 100 秒以上；SIGINT 后文件按字节还原（`git status --short` 为空）。等上一批输出 `EXIT=` 之后单独重跑，X9 正常 KILLED。以后一次只跑一个变异批。
- 2026-10-15 13:00 +08（工具注意：陈旧 dist 会让 `pnpm verify` 红）：验证者在 12:25 跑过 `pack:plugin`，被忽略的 `apps/harness-plugin/dist/` 留在工作树里，其中内联的 core 代码被 `tests/e2e/delivery-lineage.test.js` 的“唯一写者”扫描当作第二个 `putDeliveryFacts` 调用点，`pnpm verify` 因此 2 项红（同一根因）；CI 没有 dist 所以不受影响。把它整个移到草稿目录后 `pnpm verify` 退出码 0。6a 的全量门要么在 `pack:plugin` 之前跑 verify，要么跑完 `pack:plugin` 就把 dist 移走再测别的，别让产物留在扫描范围内（这条扫描不跳过 dist，与“扫描类测试要在构建后验证”那条经验是反面）。这是 main 既有的扫描范围问题，评审会话已开 #350 承接。
- 2026-10-15 13:00 +08（变异标签）：附加变异 X9 的锚点随 X10 的删行变为 `; await stream.dispose() }`；X2 的 `killedBy` 写成了断言里的正则片段 `在 gap 之外结束`，而不是用例名片段，所以 `review-mutate.mjs` 报 `KILLED_OTHER`；X2 是被 `SQLite 只关一次` 那条用例杀死的，标签应取 `SQLite 只关一次`。
- 2026-10-15 13:00 +08（规模）：`node scripts/rule-checks.mjs size ecf161d3` 在 `ca3241b9` 上代码 879 / 1000、文档 841 / 1500（文档读数在本回填提交之前）。修复轮净增 46 行代码：`workspace-stream` +25（有上限节拍与脚本化快照的辅助函数 11、预先中止 4、metadata 用例 10）、`host-watch` +10、安装件 e 节 +5、`client.ts` +1（面板顺序的注释行）、其余为零。没有找到可以不丢判别力而削掉的死代码：X7 与 X10 的两行是仅有的无判别力代码，X10 已删（−1 行），X7 按契约补了断言（+4 行）。D23 的 B1 / B2 拆分是实际路径：B1 = 543、B2 = 336，各自远低于 800。
- 2026-10-15 13:25 +08（Batch 6a，restack 重做）：本地 A 从 `ecf161d3` 前进了 8 个提交到 `1391c282`（检出外的工作树允许根、Batch 6 修复轮、凭据服务按操作取用、共享种子与 Batch 8a 记录），其中只有 `host-composition.ts`（`resolveCredential` 包一层诊断）与安装件测试 d 节和本 PR 的文件相交，hunk 互不重叠；非交互 rebase 没有冲突，也就没有 `# Conflicts:` 模板行混进正文。A 的 `host-seed.js` 新增了 `WORKSPACE`、`mount`、`seedWorkspace` 等导出（A 的 D31），本 PR 的 host-watch 原先自带同值的工作区字面量，已改为直接 import（D33）。
- 2026-10-15 13:25 +08（Batch 6a，探针自身的挂住）：验收探针 P2 的第一版在 gap 之后挂住，`close()` 也一直 pending。根因在探针的脚本化源：它交付完帧后无条件 `await` 中止事件，而 `restart()` 在源恢复执行之前就已经中止了这一代的 signal，事件早已触发，等待永不结束；替身的 `dispose()` 又要等排在这次 `next()` 之后的 `iterator.return()`。改成先查 `signal.aborted` 后 P2 在替身与真实类上都通过。这不是产品缺陷（真实网关与 `client-stream` 的 `scripted()` 都先查 `signal.aborted`），但与 M16、X6 同类：以后任何脚本化的流源都要在等待中止之前先查 `signal.aborted`，否则被破坏的实现或探针会挂住而不是失败。
- 2026-10-15 13:25 +08（Batch 6a，附加变异 A2 存活）：删掉 `close()` 里同步的 `sync.disconnect()`，整表仍绿。既有用例都在 `done` 结算之后才读状态，而 consume 的 `finally` 迟早也会断开，掩盖了差别；差别在调用 `close()` 到宿主那一代真正结束之间，这段窗口里页面会把停更的值显示成当前值。D32 删去 `await done` 时也以「close 先置 closed、同步断开」为前提。已在 `client-stream` 第 2 条末尾同步读一次状态（+3 行），A2 KILLED（D33）。
- 2026-10-15 13:25 +08（Batch 6a，探针读数）：P1 经真实组合把 `controller.baseline` 换成同修订、标题被改的一次读数，宿主产出 gap、客户端整表 stale 后在同一句柄上开第 2 代并恢复当前值；P2 推模式里越过本地修订的 delta 与 gap 同路径；P3 修订倒退的 delta 被拒后终止、最后已知值保留且 stale、只开 1 次；P4 面板卸载后宿主 40ms 内读取增量为 0，`[harness-projects]` 日志里没有实体 id、标题与工作区 id，卸载后 remote 立即排空；P5 卸载后 `service.watch` 以「已卸载」拒绝，组合关闭后 `watch` 同步抛「已关闭」。`markGap` 抽取之后 M7 除了 `client-stream` 第 2 条，还被拉模式的「前游标超前的合法 delta 走 gap recovery」用例杀死，说明两种模式现在共用同一处缺口标记。
- 2026-10-15 13:25 +08（Batch 6a，规模）：`node scripts/rule-checks.mjs size feature/host-provider-composition`（本地 A `1391c282`）在 `35fcd05f` 上代码 885 / 1000、文档 852 / 1500（文档读数在本批文档提交之前）；相对 `origin/main` 的栈累计代码 1803（含 A，只记录不判定）。本批净增代码 6 行：`sync.ts` +4（`markGap` 换来一处缺口语义）、`client-stream` +3、`host-watch` −1。没有找到可以不丢判别力而削掉的代码；`workspace-stream` 第 1 条改用脚本化源约能省 10 行，但计划指定它走真实 controller，而且省下也到不了 800，所以不做（D33）。
- 2026-10-15 13:55 +08（Batch 6c，规模的真正来源）：885 行里 `sync.ts` 占 94，其中约 60 行是把 `poll` 里的事件处理搬进 `applyEvent` 换了一层缩进，`size` 不忽略空白，搬移按删除加新增各计一次。让事件处理原地成为 `receive` 的方法体、`poll` 转交给它，`sync.ts` 降到 32 行，拉推两种模式仍共用唯一接受点与 `markGap`。第二来源是测试的重复搭建：`workspace-stream` 的三种一代共用同一个「脚本化快照 + 有上限节拍 → 全部帧」形状，契约测试两条用例各搭一份组合桩与 remote。
- 2026-10-15 13:55 +08（Batch 6c，null 原型）：`remote.ts` 的 `toJson` 产出原型为 `null` 的对象，`assert/strict` 的 `deepEqual` 对它与字面量对象报不等（打印出来一模一样）。契约测试因此断言 `[first.kind, Object.entries(first.delta)]`，而不是整帧深等字面量。
- 2026-10-15 13:55 +08（Batch 6c，测量口径）：`node scripts/rule-checks.mjs size` 只量已提交的 HEAD，工作树改动不计；精简过程中用同口径的 `git diff --numstat feature/host-provider-composition`（排除 `docs/`、`*.md`、锁文件、`dist/`、`generated/`）读数，提交后再用 `size` 回读确认（717）。
- 2026-10-15 13:55 +08（Batch 6c，异步生成器的恢复时机）：本机 Node 上，对停在 `yield` 的异步生成器调用 `next()` 会同步跑到下一个 `await`，所以 `streamWorkspace` 在 `stream.next()` 返回之前就已经调用了 `wait`。新的中止用例照样先断言「生成器停在等待上」再中止，这条前提一旦不成立就红，而不是让 M3 悄悄失去判别力。
- 2026-10-15 13:57 +08（Batch 6c，A 在本批期间前进）：本地 A 从 `1391c282` 前进到 `36a67637`（A 自己的两个精简提交，改了 `host-composition.ts` 的组合主体、`host-seed.js` 的文件头、安装件测试 a–d 节与 A 的 Host 测试，没碰 B 的追加行和 B 引用的导出）。`size feature/host-provider-composition` 按合并基 `1391c282` 计，读数仍是 717；`git merge-tree --write-tree feature/host-provider-composition HEAD` 无冲突，合并树相对新 A 的代码桶同样是 717。在合并树的临时导出上（借用本工作树的 `node_modules`）跑 B 的六份变异命令文件加 A 的三份 Host 测试与 `package-boundaries`，只有安装件的两条路径断言红；同样的临时导出换成本 PR 自己的 HEAD 也红这两条（导出经符号链接解析包，metafile 输入落在导出根之外），所以是导出方式的假象，不是并集缺陷。提交本批文档时 A 又多了一个只改 A 计划与技术债表的文档提交 `4eaac807`，合并仍无冲突、合并树代码桶仍是 717。restack 与正式并集仍归协调者：按 Batch R 用 `git rebase --onto feature/host-provider-composition 1391c282 feature/host-watch-stream`，A 改了 Host 源码，restack 后 `lib/index.js` 的 sha256 必然变化，S3 以 restack 之后重打的两个值为准。
- 2026-10-15 14:06 +08（第三次 restack，A 简化之后）：预测重叠时先用 `comm` 比较 A 的增量（`1391c282..4eaac807`）与本 PR 相对旧 A 的改动文件，撞上四个文件（`host-composition.ts`、`tech-debt-tracker.md`、`tests/integration/README.md`、安装件测试），但 22 个提交重放没有任何冲突，Batch R 第 3 步预言的 `docs/README.md` Active 表冲突与「安装件测试 a–d 节 A 改、e 节 B 改」的冲突也都没出现：A 的增量不碰 `docs/README.md`，A 的计划行早在 `1391c282` 之前就入库了。所以第 4 步的判据不能只看「无冲突」——用两个独立证据补强：(1) 本 PR 在 4 个共享文件上的 `-U0` 增删行集合与 restack 前逐行相同；(2) 22 个提交的 `git range-diff` 为 21 个 `=`、1 个 `!`，那一个是 6a 的文档提交，差别只在 tracker 里被 A 改写的 TD-054 上下文行。`lib/index.js` 的 sha256 随 A 的 Host 源码变化（`0ad20d76…` → `855c4934…`），`lib/client.js` 逐字不变，说明 A 的增量没有进浏览器入口。`pnpm verify` 的通过数 1608 → 1606 是 A 合并了两条冗余用例，不是本 PR 的检查被删。
- 2026-10-15 15:00 +08（Batch S3，触发路线）：第 5 步的 DevTools 同源 fetch 实际没有走通。DevTools 能打开（⌥⌘I），但人类两次没能在 Console 执行那段片段（指引一度被主会话的问答框遮住），于是按 H4 改用 `B-probe`。教训：要人类在宿主内手动执行的步骤，应在提问之前一次给全、短到能一次粘贴；能由探针自动触发的，不依赖人类在控制台操作。
- 2026-10-15 15:10 +08（Batch S3，令牌可见范围）：H5 的请求写的是「对 E1 沙箱有读权限即可」，人类配置的第一个令牌能读 Project，却读不到私有沙箱仓库（`docs/architecture/gate-e1-sandbox.md` 的 `$E1_REPO`）。宿主照常运行且 fail closed：本地只有 3 个 draft 实体，6 个 issue / PR 条目以结构化 `permission_denied`（`fix_permission`，不可重试）记为不可见，没有被静默丢弃；代价是 issue-writable 的 Status 变化进不了快照，第二次运行只看到 metadata。换成同时有 repo 与 project 权限的令牌后，可见条目从 3 变为 9，delta 才出现。所以 S3 的前置除了「句柄已配置」，还要在第 4 步的外部写入之前确认被改的条目在本地可见（命令回报的 `unanchored` 为 0，或 baseline 实体里有该 issue），否则这次写入是白做。
- 2026-10-15 15:20 +08（Batch S3，启动期凭据竞态在本 PR 这一侧）：每次 Desktop 启动，`diagnostics.log` 都多一对 `credentialFailed` / `CredentialServiceUnavailable`：Host 组合期的水合早于宿主凭据服务变为活跃（A 的 D-R / R1 预判过）。本 PR 看到的是：开场 baseline 只有库里已有的实体，来源为 degraded / `not_found`；第一次命令重新水合之后，没有规划变化时只有来源变化，流交付 metadata（修订不变），有变化时交付 delta。M18 守护的 metadata 路径因此在真实宿主里也走到了。面板在启动之后、第一次命令之前一直显示降级来源；宿主定时刷新属于 #335（本计划「范围外」），本 PR 不改。
- 2026-10-15 15:20 +08（Batch S3，读数来源与外部写入的执行者）：本机 `open -a … --stdout/--stderr` 没有把宿主 stdout 接到文件（两个文件都是 0 字节），第 2 步「`desktop.out` 只用 grep 读」的读法落空；本 PR 的读数全部来自人类粘贴的 DevTools console 文本，单行不带时刻，时刻取自安装、诊断日志的启动行与只读核对。沙箱写入方面，协调者曾想代人类改 Status，被权限系统按外部系统写入拒绝，于是改由人类在自己的终端执行 `gh project item-edit`；人类随后追问要跑哪条命令。教训：交给人类的外部写入要给出完整、可复制的命令，条目、字段与选项 id 取自 `docs/architecture/gate-e1-sandbox.md`，缺的 id 先给查询命令，不能只说工具名。
- 2026-10-15 16:53 +08（评审修复，F1 复现）：Cordis 4.0.4 的 `ctx.inject` 回调同步抛错不会让插件的 `apply` reject，而是由 `Fiber._reload` 记日志、把 epoch 置 INACTIVE 并卸载该 fiber 的全部 disposer；`slots.inject` 的贡献是调用方 fiber 的 effect，随之撤回。D32(3) 与安装件 e 节旧的假 Context 假设的正相反（`apply` reject、已登记的贡献保留），所以 M22 只证明了假宿主上的次序。按源码建模的假 Context 与真实 `Context.inject`（`HARNESS_CORDIS`）在评审前的 `client.ts` 上都得到面板撤回（`actual: []`）、修复后都保留，二者一致（D38）。
- 2026-10-15 16:53 +08（评审修复，F3 的变异耗时）：M24（缺省等待忽略中止）下新用例在 1 s 上限内变红，但内部 60 s 计时器没有被清掉，测试进程要等它到期才退出，这次变异运行约 64 s 结束；是变异下的慢，不是挂住，`--test-timeout=120000` 之内。
- 2026-10-15 17:40 +08（复评 N2，假 Context 的卸载语义）：RF1-d（catch 里去掉 `return`）在模型与真实 Cordis 下都存活，抛错用例从不卸载 fiber。只补「卸载后」的断言还不够：旧假 Context 的卸载用 `Promise.all`，disposer 抛错会让卸载 reject；真实 Cordis 的 `_unload` 逐个捕获、记日志，卸载本身不 reject。所以同一条断言在两种运行下杀死变异的路径会不同，真实路径看不到这次异常。改为两边同口径：假 Context 逐个捕获并记入 `fiberErrors`，真实路径从 Cordis logger 的缓冲区（默认 exporter 只写缓冲区，`type: 'error'`）取异常。之后 RF1-d 在两种运行下都由「`fiberErrors` 为空」这一项杀死（真实 Cordis 下实际为 `[0, 1, 1]` 对期望 `[0, 0, 1]`）。

## Decision Log

每条决定都标注了日期、作者与授权方式；推翻时在原条目后追加 `Superseded by …`，不删原文。

- D1（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）载体：typed remote 的 stream 描述符 + 宿主 `$stream`。放弃客户端定时调 unary `baseline`（没有代际语义，断流时没有「立即」可言）、Remote events 只做 poke 再拉全量（每次搬全量且没有 delta，不满足 AC1）、Host web route SSE（ADR-0013 已拒绝自建 transport）。依据：H4、H5、H8，以及 spike O3.3 / O3.6 / O3.8 在 0.1.7 上的观测。
- D2（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）重连永远重拉 baseline，不续传游标。宿主不保留按修订的历史，seed 只活在一代生成器里，断线后续传必然是 gap；这等于把 Kubernetes「410 Gone 后清缓存、重新 list、从新版本 watch」变成常态，一次 baseline 的代价正好是一次 tick。graphql-ws 同样不定义重放。
- D3（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）每代协议：唯一开场 baseline + 增量；gap 后宿主结束本代、客户端先 `restart()` 再读。放弃同代重发 baseline（违反 H6 的每代一个开场快照）与只靠宿主结束（客户端构造不出载体错误，正常结束是终止，TD-058）。Kubernetes streaming list 的「合成初始状态 + bookmark + 增量」与 H6 同构。
- D4（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）保留窗口不设上限（`retain: Number.POSITIVE_INFINITY`），推翻设计 3 的 `retain: 1`。理由见 Surprises 第二条；`retain: 1` 会让 AC1 的 S3 在一个 tick 内两次写入时只看到 gap。gap 路径仍由同修订业务变化、修订倒退等真实不连续触发并被测试覆盖。
- D5（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）推模式进入 `createSync` 的唯一接受点（新增 `receive`），推翻设计 1 的拉式适配器与设计 2 的独立会话。设计 1 把代号盖在 delta / metadata 上，会触发 TD-059 让 metadata 永远被拒；设计 2 在 `stream.ts` 里再写一套接受规则，两套规则会漂移。`receive` 的代价是 `sync.ts` 约 35 行事件处理换缩进（规模约 90 行增删），换来唯一接受点与拉模式零行为变化。
- D6（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）不在帧上盖代号，库重建后修订倒退的 baseline fail closed；合法 reset 是 #218 的 Scope（「The legitimate reset when a workspace is rebuilt」）。推翻设计 1 的客户端盖帧与设计 2 的带外 reset，避免在 #218 之前定死 generation 语义。
- D7（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）宿主正常结束本代、协议违例、帧被拒、非 JSON 帧一律终止，保留最后已知值并 stale；不自动重开。依据 H6 的 `failed` 语义：出错的宿主会重放同一个坏 baseline，重开只会热循环。
- D8（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）断线保留最后已知值并整表 stale，不清空。这是 #178 已定的规则（`packages/client/src/sync.ts` 的 `lose()` 与 `DISCONNECTED_REASON`）；TanStack Query 在重连时后台重取而不是清空、Relay 允许渲染陈旧数据，与之一致。
- D9（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）卸载：`lifetime.abort()` 先于排空；`beginCall()` 放在生成器体内。前者兑现 ADR-0013「跨代 watch drain 留给 #276」，后者避免网关在第一次 `next()` 之前取消时计数泄漏。
- D10（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）Host 逐帧 `toJson`。H3 说明网关不对流项编解码，依赖网关的 `JSON.stringify` 会把 NaN、Date、Map 静默降级。
- D11（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）轮询间隔缺省 1000ms，`watchIntervalMs` 可注入；变更通知替代轮询记 TD-057。
- D12（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）客户端接线放进新文件 `workspace-watch.ts`，让集成测试经真实接线驱动；unary `baseline()` 调用保留，因为 #132 的 S3 用它的日志作一次查询往返的证据。
- D13（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）不新增 ADR：没有新的依赖边、没有第二事实源，ADR-0013 第 5 条已把 watch 交给 #276；流协议记在本 Decision Log。人类若要求写成 ADR，只能是 Proposed，并与 PR A 协调编号。**Superseded in part by D24（2026-10-15 10:31 +08）**：编号已预留为 ADR-0015。
- D14（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）不加 `subscribe`、`phase`、按版本缓存的 `read()`：页面怎样订阅由 #229 决定；`onReport` 与 `watch carrier lost` 日志已是它可接的通知点。
- D15（2026-10-15，最终评审者；协调者按人类授权调研后决定，人类可推翻）AC1 的 S3 与 #132 的 S3 合并在 A + B 的构建上执行；A 无法就绪时 AC1 的去向是人类决定（Batch S3 判定段）。**Superseded by D21（2026-10-15 10:31 +08）**：改为 S-AB 会话 Phase 2，在本 PR 自己的 head（已含 A）上构建，真实 `desktop` profile，不用一次性 profile。

以下 D16–D28 来自 2026-10-15 的跨 PR 集成评审（A #132、B #276、C #231、D #280 四份计划对读），由本计划维护者逐条对照代码与另三份计划核实后采纳或修订，日期 2026-10-15 10:31 +08；授权方式同上（协调者按人类授权调研后决定，人类可推翻）。

- D16 原生栈叠在 A 上（depth 2），开发仍并行。核实的理由：(1) AC1 的 S3 需要 A 的 provider 目录——`main` 上 `host.ts` 的 `inject` 含 `harnessProjectsProviders`，Desktop 不提供它，Cordis 不加载插件函数体，#329 的 S3 得到 404（A 计划 F1），在 `main` 上看不到任何 watch 帧；(2) 本 PR 的集成测试调用 `createHostComposition`，A 把选项从 `{ workspace, providers }` 改成 `{ workspaceId, catalog, resolveCredential }`，JS 测试不做类型检查，旧调用只会在运行期失败——不叠栈就只能是 B 在 A 合并后重写，或 A 改写 B 拥有的测试；(3) 叠栈后 S3 证据取自本 PR 自己的 head（已含 A），CI 每次推送都在跑 A + B 的并集。阶段 I（Batch 0–3，约占代码六成）与 A 没有文件交集，现在就从 `main` 开工；A 提交 Batch 4 后执行 Batch R（backup ref、rebase、改 base）。放弃「两边都从 `main` 出发、后合并者 rebase」（原 R4 与原 Batch 5 的 A 并集工作树）：它让 B 的测试在 A 合并前一直按旧选项写，S3 也无法在 `main` 上进行。栈深规则：H2 被否决时 A0（ADR-0014 与边界 / manifest 提交，`Refs #132`）成为栈底，A0 → A → B 为 depth 3（上限）；A 若也要拆 L1 / L2，A0 先合并，再 L1 / L2，再 B；B 削减后仍 > 800 见 D23。依据：`docs/project-management/merge-queue.md` §4 记录的原生栈实测（下层合并后上层自动改基、CI 对非 `main` base 的栈成员照常运行、栈成员用 merge-async 合并）。
- D17 宿主侧集成测试按 A 的选项重写，全部装置收进一个辅助函数 `open(t, { seed })`：只读 import A 的 `tests/integration/fixtures/host-seed.js` 种入工作区与一个 `harness.fake` 规划挂载；`createHostComposition({ dataPath, workspaceId, catalog, resolveCredential: async () => undefined, watchIntervalMs: 5 })`；在目录条目的 `create` 回调里留住 fake 规划实例，`addItem` 照常可用；从 `host-composition.ts` import（A 删除 `host.ts` 的再导出）；不出现旧的 `workspace`、`providers`。理由：A 的选项再变时只改一处；种子逻辑只有一个事实源（A 的夹具），B 不复制。依赖：A 抽出该夹具（Surprises 2026-10-15 10:31 第二条）。
- D18 `watch` 的错误漏斗复用 A 的 `guarded`：每次 `next()` 包进 `guarded(() => frames.next())`，`return` 直接转给内层生成器，`closed` 检查在漏斗外同步抛出。中止是正常的 `done: true`；任何抛出写一行 `operationFailed` 并以固定文案改抛。理由：TD-031 与 A 的 D6 都要求 wire 入口只出固定文案、原因进宿主诊断日志（A 的 D5 依据 OWASP 与 Node 文档排除 message 与路径）；按 A 的 `guarded(run: () => Promise<T>)` 签名逐步包裹，不需要第二个漏斗或生成器专用变体。放弃「让 remote.ts 的 `toJson` 之外再捕获」：`remote.ts` 是 client / Host 共用文件，不能 import A 的诊断出口。新增用例 4 与变异 M17；预算约 +4 实现、+15 测试。
- D19 与 A 的空数据根兼容，加一条钉住性的用例 5：不种子时流只产出 r=0、无工作区的 baseline，`read()` 保持 `undefined`，几个 tick 内 `done` 不结算。依据见 Surprises 第三条新增项（`wire.ts:64`、`workspace-read.ts:54`、`sync.ts:208`、`storage.ts:178`）。不加客户端分支：现有接受点已经正确处理，测试只防回归。
- D20 文件所有权：`watch` 描述符追加在 `descriptors` 末尾，`HOST_REMOTE.invocations[0]` 仍是 `baseline`（A 的 runtime-adapter 测试 `:56` 按下标取）；本 PR 从不改 `host.ts`；`harness-plugin-artifact.test.js` 只改 `e.` 节；`host-composition.ts` 只加一处 import、一个可选选项、一个成员。
- D21 S3 改写为 S-AB 会话 Phase 2（取代 D15 与旧 Batch S3 的「一次性 profile」）：Desktop 永远使用 `~/.dsh`，`DSH_HOME` 只对 CLI 路线生效，所以在 A 的 H3 下用真实 `desktop` profile；凭据是 `HARNESS_PROJECTS_GITHUB_TOKEN`，由人类在 Desktop 凭据存储配置（A 的 H5，对本 PR 的 AC1 是必需而非可选），agent 不经手；规划挂载来自 A 的种子脚本；改动对象是 E1-3 写入夹具 `issue-writable` 的 `Status`（或 `E1 Text`），人类记原值、观测后改回、再引导一次重同步；不碰 pr-gamma（C 的记录）、issue-alpha、draft-beta；触发用人类的 DevTools 同源 fetch，DevTools 不可用时退到 `B-probe`（需扩展 A 的 H4）。
- D22 S3 的新鲜度：Phase 2 在 Batch 6a 冻结之后、6b 整合与 ready 之前执行；记 `lib/index.js` 与 `lib/client.js` 的 sha256，合并前任一变化就重做 Phase 2 或请人类裁决；保树的整合与 restack 不触发重做。取代「S3 可以在 Batch 6 之前或之后」——那会让 6a 的重构改掉被观测的构建（#329 的教训）。评审修复改变了 `lib/client.js`，人类按本条裁决为沿用，见 D38。
- D23 规模：叠栈后诚实重估为实现约 270、测试约 535、代码约 805（`sync.ts` 换缩进约 90 行也计入，size 不忽略空白）。承诺 Batch 5 之前削减到 ≤ 760：`workspace-stream` 的中止用例并进第 2 条；删 `client-stream` 与 `host-watch` 的重复断言（终止后 stale、键白名单）；安装件 e 节收窄。**部分修订**：评审建议 e 节只留「`$stream` 被调一次、卸载 effect 关闭它」，本计划另保留「`open` 转交同一个 signal」一行，因为其余用例都不断言「客户端 close 会中止宿主那一代的 signal」，变异 M16 没有已知的别的杀手；Batch 5 若证明别的用例也能杀死它，再删这一行。死代码复审后仍 > 800 才拆：B1 = controller `streamWorkspace`、client `receive` / `followWorkspace`、替身与 e2e 测试，`Refs #276`，base `main`；B2 = Host、壳与 S3，`Closes #276`，B1 合并后叠在 A 上。栈深仍 ≤ 3。
- D24 人类门：在 #218 发决策评论、在 #276 发 S3 观测评论都是代表用户的公开写入，协调者先用一句可批准陈述问人类；可选的流协议 ADR 预留编号 ADR-0015，只能是 Proposed（ADR-0014 属 A，D 不写 ADR）。
- D25 栈上 PR 的关联回读：base 是 A 的分支时 `closingIssuesReferences` 可能为空；在改正文后、改 base 到 A 后、A 合并且本 PR 回到 `main` 后各回读一次，不提前报关联失败（`docs/project-management/merge-queue.md` 的栈成员关联记录同此）。
- D26 共享文档协议：`docs/README.md` Active 行插在表头分隔行下，冲突时保留所有行、2026-10-15 的行按计划文件名排序；TD-057..060 按编号位置插入，不随合并次序；可选的 `tests/integration/README.md`「Host watch（#276）」小节紧接 A 的「Host 组合（#132）」之后；TD-058 的下一步与 A 的 TD-055 交叉引用（创建首个工作区要重组，重组结束本代，页面须重开）。
- D27 Batch 3 只本地提交、Batch 4 绿了才推送。原因见 Surprises 2026-10-15 10:31 第一条。放弃：把 `HostCompositionCall.watch` 设为可选（等于为过渡期写兼容分支，违反 MMP 前不做兼容）；在 `main` 上先给旧 `host-composition.ts` 加 `watch`（必与 A 的重写冲突，也越过 A 的结构所有权）；推送一个类型检查红的提交（draft PR 的 CI 变红，整合前的提交不能独立通过）。
- D28 合并次序与预案：C、D 与 A / B 互不依赖，各自门过即可合并；A 必须先于 B；推荐 C → D → A → B，C、D 可插在任意位置。每次合并前：rebase 到当前 `main`（严格保护会让其余 PR 变 BEHIND）、按 D26 解决索引与债务表冲突、在 `main` 加全部未合并 head 上重跑并集 `pnpm verify`、回读 `closingIssuesReferences`；每次合并后回读被关闭 issue 的状态。A rebase-merge 后 GitHub 把本 PR 改基到 `main`；合并本 PR 前比对树与新旧 head 的 `git range-diff`、比对每个 approval 的 `submitted_at` 与 head 提交时间（保树的 force-push 会把 approval 重映射到新 head），`gh pr merge` 被拒时走 merge-async REST。若改基后分支仍带着 A 的旧提交（`git diff --name-only origin/main...HEAD` 含 A 的文件），按 `merge-queue.md` §4 用 `git rebase --onto origin/main <A 合并前的 head> feature/host-watch-stream` 手工变基、按精确 lease 强推、重跑验证。A 拖过本 PR 的评审窗口时，B 不能带着未闭合的 AC1 合并，须人类裁决范围。仅当人类改判、必须让 B 先合并时启用「任意次序」预案：B 的 `watch` 按旧选项写；A 重构时保留 `watch` / `watchIntervalMs`，只重写 `harness-plugin-host-watch.test.js` 的那一个装置辅助函数——这是写进两份 Decision Log 的显式跨所有权授权，平时不生效。
- D29（2026-10-15 11:01 +08，阶段 I 实现者；计划授权的最小一致修正，人类可推翻）三处与计划字面的小偏差，均不改变判别力：(1) `client-stream` 第 1 条的三行表驱动写成同一个用例内的循环，不用 `t.test` 子用例，保持计划期望的 `ℹ pass 3`；(2) `RemoteStream` 替身交付项带 `signal`（与宿主真实类一致），去掉没有任何用例依赖的单消费者检查，`createConnection` 的在线快照用空对象而不是递增编号；(3) 契约「strictly JSON-encodes」除 `JSON.stringify` 外加 `Object.keys` 断言，因为 `JSON.stringify` 本来就丢弃 `undefined`，单靠它判别不了 `toJson` 的剥离。
- D30（2026-10-15，Batch R / Batch 4 实现者；计划授权的最小一致修正，人类可推翻）(1) Batch R 本地执行时改写了第一个（计划）提交的正文：删除冲突续作留下的 `# Conflicts:` 行，把以 `#` 开头的 `#229 的页面…` 改成 `issue #229 的页面…`，其余正文、作者与树不变（原因见 Surprises 2026-10-15 11:12）。(2) 提交署名：本批所有提交写 `Co-Authored-By: Claude Sonnet 5.5`，与实现者实际模型一致，也与阶段 I 提交一致；任务正文给的是 Opus 5.5，整合提交（Batch 6b）时协调者可统一。(3) `harness-plugin-host-watch` 的 `streams` 记录的是 `RemoteStream` 对象本身而不是 `$stream` 的 options，这样「同一句柄」可以按对象身份断言（`streams.length === 1` 之外，`after.store.get(id) === entry` 断言条目身份）；`open` 的清理 hook 带上限（见 Surprises 2026-10-15 11:50）。(4) `HostComposition.watch` 写成与 `call` 同款的属性箭头函数，而不是计划里的方法简写；语义与计划代码块逐行一致。
- D31（2026-10-15 12:50 +08，Batch 5 独立验证者；验证职责内的最小一致处置，人类可推翻）验证者只在被忽略的 `.superpowers/review/host-watch-stream/` 下加变异规格与探针，不改任何受跟踪的生产代码与测试；除计划整表外自加的变异 X1–X19 与探针不进计划的验收，只作为证据和跟进项来源。发现的 X5（metadata 无用例）、X6（`workspace-stream` 失败时自旋挂住进程）两项是测试缺口，由实现者在 Batch 6a 之前补（Progress 的 Batch 5 跟进），不属人类专属决定；代码桶 833 > 800 仍是 D23 授予协调者的拆分决定，验证者不替它裁决，只记录补用例会让规模继续增加。探针对 A 在 `3114a09e` 的合并树只做了草稿目录里的只读试跑，不替代协调者的 Batch R 重做与并集。
- D32（2026-10-15 13:00 +08，Batch 5 修复轮实现者；验证者发现的逐项处置，人类可推翻）(1) X5 的杀手放进 `workspace-stream`（B1 的文件）而不是 `host-watch`：被变异的 `watch.ts` 与杀手同在 B1，D23 拆分后 B1 单独合并也没有存活变异；全链路形态（controller → `toJson` → 载体 JSON 往返 → 客户端接受 metadata）已由验证者的探针 `metadata-e2e`、`idle-stability` 实测通过，不入库。(2) 立即放行的节拍统一为 `boundedTicks`（20 个 tick 之后中止本代）：微任务自旋会饿死计时器，`--test-timeout` 与变异脚本都救不了，测试面对实现回归必须“失败”而不是“挂住”（与 Batch 4 的 M16 同类）；采用验证者的方案，不用 `setImmediate`（用例被取消后仍占着事件循环）。(3) `openWorkspaceWatch` 与卸载 effect 挪到面板登记之后，不加 try/catch：零行逻辑，异常仍由宿主 fiber 记日志，面板先登记；推翻 Design / Spec 里“slots 注册之前”的顺序，已就地改写。**(3) 的「不加 try/catch」Superseded by D38（2026-10-15 评审修复）**：前提「异常仍由宿主 fiber 记日志、先登记的面板会留下」在真实 Cordis 4.0.4 下不成立，回调抛错时 fiber 卸载全部 effect，先登记的面板一并撤回；改为就地捕获。顺序保留。(4) X3 的杀手放进 `host-watch`，直接消费 `host.watch`（原因见 Surprises 红绿证据）。(5) X7 补断言而不是删行：“开始前已中止则不读库”是 `StreamOptions.signal` 注释承诺的契约，一行代码加四行断言。(6) X10 删除而不是补断言：`close` 先置 `closed`、同步断开，处理一帧没有异步间隙，`closed` 之后到达的帧在循环里被丢弃，吸收态靠这两点；`dispose()` 已“终止并关闭迭代”（H5），对 `done` 的等待不改变任何状态，反而在流不结束时把 `close` 一起挂住。(7) 验证者 P3“`dispose()` 在消费者停止拉取时一直等”不改：已是登记的风险 R3，网关 pump 在 `await send` 之后才拉下一项，只有 socket 写入卡住才会触发；S3 若显示卸载卡住，再加宽限期（follow-up，不在本 PR）。(8) AC1 的宿主内观测（Batch S3）、对 A 前进后的 head 重做 Batch R、拆分裁决、提交署名统一都是协调者 / 人类的步骤，本轮不做，Progress 的勾选框保持打开；进程内“真实两半”探针是 S1 加进程内证据，不替代 S3。(9) 提交署名写 `Co-Authored-By: Claude Sonnet 5.5`，与实际模型和 D30 一致；任务正文给的 Opus 5.5 不采用，由协调者在 6b 统一。
- D33（2026-10-15 13:25 +08，Batch 6a 独立验收者 Claude Opus；验收职责内的最小一致重构与补测，人类可推翻）(1) 抽出 `markGap`：推模式 `receive` 的 gap 回调与拉模式 `recover` 的前两行逐字重复，缺口语义是唯一接受点的一部分（D5），#218 改合法 reset 时只该改一处；两种模式的可观察行为不变，代价 +4 行，变异 M7 的锚点改到 `markGap`（Plan of Work 的变异表已就地改写）。(2) host-watch 的种子改用 A 夹具的 `WORKSPACE`、`mount`、`seedWorkspace`：D17 要求种子只有 A 的夹具一个事实源，A 的 Batch 8a 把它们抽成导出之后，本 PR 再保留一份同值字面量就是第二个事实源。(3) 保留 `close()` 里同步的 `sync.disconnect()` 并用断言钉住（附加变异 A2），而不是作为冗余删掉：它保证从调用 `close` 起页面不会把停更的值当作当前值，这正是 #229 若随面板开合流时会读到的窗口。(4) 不为规模改写计划指定的测试形状：`workspace-stream` 第 1 条改脚本化源只省约 10 行，到不了 800；代码桶 885 的去向仍是协调者按 D23 的 B1 / B2 拆分（B1 = 550、B2 = 335）。(5) Batch 6b 的 TD 四行与集成 README 小节在本批写入（与 A 的 Batch 8a 同样提前），提交整合、并集、推送、ready 与 S3 读数回填仍归协调者。(6) Batch R 第 1–4 步是对本地 A 重做的（远端 A 仍在计划提交 `5c31daf6`）；A 推送或整合改写历史后，协调者按 Batch R 用 `git rebase --onto origin/feature/host-provider-composition 1391c282 feature/host-watch-stream` 再做一次，并以「两个 lib 的 sha256 不变」判定是否需要重做 S3（D22）。
- D34（2026-10-15 13:55 +08，Batch 6c 独立精简者 Claude Opus；人类「超规模先想死代码与精简、再谈拆分」的指示内的最小一致处置，人类可推翻）代码桶 885 → 717，不拆分；冻结的接口（每代 baseline / delta / gap 协议、`remote.ts` 末尾的描述符 id 与形状、`followWorkspace` / `receive` 的公开签名、`host-composition.ts` 的三处追加）一个字节不动。逐项与安全性：(1) `sync.ts` 的事件处理原地成为 `receive` 的方法体，`poll` 转交并在 gap 时重拉基线（−62）；推拉共用唯一接受点与 `markGap` 不变（D5、D33），旧测试原样全绿、M7 仍同时被推拉两侧用例杀死、新增 S1 证明拉模式 gap 仍重拉。唯一的放宽是拉模式 `poll` 交来 baseline 形状的帧会按 baseline 经同一接受点接受：`Transport.poll` 的类型是 `WireEvent | undefined`，唯一实现转交 `watchWorkspace`，从不产出它，而且接受仍走帧头、generation 与低修订规则；为不可达输入加一行无用例的拒绝就是死代码。(2) `stream.ts` 用「已接受开场 baseline 的那一代」一个变量取代代号加布尔，代际重置是隐含的（M11、X19 换锚点后照样被杀）；终止与吸收态改用 `done` 的 `catch` / `finally`，次序与 try / catch / finally 相同（X8 换锚点后被杀）；推模式 transport 收成一行。(3) `watch.ts` 两行选项解构合一；`remote.ts` 头注释与 `lifetime` 注释少占行，内容不变。(4) `workspace-stream` 表驱动：三种一代逐帧深等（比原先只看 kind 与个别字段更严），两次写入改用修订 1 → 3 的脚本化快照序列——与真实命令写两次触发的是同一条保留窗口路径（M1、M19 照样被杀），真实 controller 上的帧形状由 host-watch 第 1 条按 controller 值深等；推翻 D33(4) 的「不为规模改写计划指定的测试形状」，因为人类此后明确要求先精简。(5) 契约两条 watch 用例合一：坏帧在卸载中途出现，同时杀 M5、M4、X13、X14、X16。(6) `client-stream` 第 3 条换异步生成器、只留被测断言，第 2 条去掉不需要的 try / finally（流挂在中止事件上，不占事件循环）。(7) host-watch 用读数摘要统一断流与卸载两处 stale 断言，卸载后还断言行数与时间保留（比原先更严）。(8) 安装件桩流的 `next` 永不结算（不占事件循环），`watch` 原样返回 signal 供身份断言，M16 仍被杀。(9) 替身删去载体打开时 socket 已断开的分支（`break()` 总是立即换上新 socket，不可达）与从不传入的 `online` 参数。附加变异 A1（`receive` 误用会重拉基线的 `recover`）的锚点随 `applyEvent` 消失：`receive` 现在是同步方法、拿不到重拉路径，这种误用在结构上写不出来，不再列入。不改的：`InstalledHostRemote.service` 的 `watch` 类型、`watchDescriptor` 的显式字段（不从 `baselineDescriptor` 展开，免得两份线缆契约耦合）、`workspace-watch.ts` 独立成文件（D12）。
- D35（2026-10-15 14:06 +08，协调者派发的第三次 restack；人类可推翻）(1) 用 `git rebase feature/host-provider-composition` 而不是 `git rebase --onto feature/host-provider-composition 1391c282`：`1391c282` 就是合并基，A 的三个新提交线性叠在它上面且没有改写，两条命令重放的提交集合相同，少一个参数就少一处写错旧 head 的机会；A 之后若做了改写（旧 head 不再是 `HEAD` 的祖先），仍按 Batch R 的 `--onto <A 的旧 head>`。(2) 冻结点取 restack 之后的代码树提交 `431a5e8d`，规模、变异、sha256 全部在新树上重取，不沿用 6c 的读数：A 改了 Host 源码，`lib/index.js` 必变，6c 已预言。(3) 第 4 步的判据补两条：共享文件上本 PR 增删行集合与 restack 前相同，`git range-diff` 逐提交为 `=`（`!` 必须能解释为上下文行变化）；只靠「无冲突」与「B 路径树差为空」不会发现共享文件上被静默改写的行。
- D36（2026-10-15，人类伙伴，仓库所有者；在主会话经 AskUserQuestion 直接回答，协调者记录，6b 文档 owner 逐字回填）S-AB 窗口与本 PR 推送方向的人类裁决。以下问答为原文：
  - H1（2026-10-15 10:56 +08 记录；人类先追问「Desktop 0.2.0-rc.2 里没有这个服务是什么意思？是之前的调研结果有问题吗？还是因为没有更新插件的原因？」，协调者订正表述后重问）问：「订正后的表述：harnessProjectsProviders 是 #329 自已定义、留给 #132 填充的注入接缝，目前没有任何包提供它，所以 Host 在 Desktop 里不加载。PR A 改为由 Host 入口自己用编译期封闭的实现目录，按已存挂载的实现键组合 provider，并新增 ADR-0014（Proposed），部分取代 ADR-0013 决定 5 的工厂句。两份 ADR 是否采纳由你在评审时决定。是否批准按这个方向推送 PR A（以及叠在其上的 B）？」答：「批准方向 (Recommended)」。这是推送方向的批准，不是 ADR-0014 / ADR-0013 的采纳。
  - H3 + H4（2026-10-15 10:56 +08 记录）问：「A、B 代码树冻结后开 S-AB 窗口，需要以下操作，是否同意？(1) 向真实 Desktop 的 desktop profile 安装插件 tarball（先 remove 再 add）。(2) 创建 ~/.dsh/harness-projects，写入一个测试工作区：local-git 挂载、github.com 账号句柄 HARNESS_PROJECTS_GITHUB_TOKEN、指向 E1 沙箱 Project A 的规划挂载。不删除任何东西，目录已存在则由你移开。(3) 接受探针构建作为 A 验收 8 命令半边、以及 B 触发兜底的证据。探针构建 = 同一 head 加一行未提交改动，记录 diff 与 sha256。」答：「都同意 (Recommended)」。其中 (3) 就是 D21 要求的「把 A 的 H4 扩展到 `B-probe`」。
  - S-AB 时机（2026-10-15 13:36 +08 记录）问：「A 与 B 的真实 Desktop 观测（S-AB）需要你亲自动手：(1) 在 Desktop 凭据库配置 HARNESS_PROJECTS_GITHUB_TOKEN，对 E1 沙箱有读权限即可；(2) 按我的提示退出并重启 Desktop；(3) 在 DevTools 里触发一次 bootstrap；(4) 改一个沙箱条目字段、观测完再改回。约需 30–45 分钟。什么时候进行？」答：「代码冻结后叫我 (Recommended)」。
  - Phase 3（2026-10-15 15:26 +08）人类选择「换成 B-prod (Recommended)」；提问原文没有进记录。
  - 记录中写明的未覆盖项：H5 是人类动作；沙箱条目 issue-writable 的编辑与还原由人类执行（实际时刻见 Progress 的 Batch S3）；ADR 采纳、合并、看板 Status 与 blocked-by 仍归人类。#276 的观测评论与 #218 的决策评论（D24）到本次回填为止都没有请批、没有发。
- D37（2026-10-15 15:34 +08，6b 文档 owner 按协调者的 S-AB 窗口记录回填；S3 执行中的偏差与 AC1 的判定口径，人类可推翻）(1) 触发改用 `B-probe`，条件不是计划写的「DevTools 不可用」，而是 fetch 片段两次没能执行；H4 原文批准的是「B 触发兜底」本身，不带条件，仍在授权内。(2) 探针延时从计划的 120 s 改为 180 s，给人类在重启后留出操作与观察的时间；H4 批准的形状是「同一 head 加一行未提交改动，记录 diff 与 sha256」，延时只是这一行的参数，三个 sha256 与还原后的重建都已记录。(3) 三次运行复用同一幂等键 `s3-276-1`：每次启动都是新的 Host 进程，Controller 的重放表只在进程内（`packages/controller/src/commands.ts` 的 `createReplayLog`），复用不会命中旧结果，第三次照常同步出 delta；第 8 步为再引导预留的 `s3-276-2` 没有用上。(4) 窗口中途换令牌是人类的 H5 动作，agent 从未读取或经手令牌值。(5) AC1 判为通过：同一页面（未刷新、同一个 `RemoteStream` 句柄）的同一代 gen=1 上先 baseline r=1、后 delta r=2，本地库修订 2，满足 Batch S3 判定段的三个条件（两行都在、`gen` 相同、修订大于 R）。限度如实写明：这次 delta 不能单独归因于 #3 的 Status 改动，同一轮同步里还有令牌放宽后新可见的 6 个条目；delta 由 `B-probe` 的构建观测到，它的 `lib/client.js` 与 B-prod 只差探针那一行，`lib/index.js` 相同，B-prod 在宿主内只观测到 `watch baseline r=1 gen=1`；第 7、8 步没有执行，人类改回 Status 之后直接进入 Phase 3，没有再引导。判定段只要求一次规划快照变化产出 delta，不要求单字段归因，所以这些限度不改变结论；要不要在 B-prod 上补一次只改 Status 的观测，由人类在评审时决定。(6) Phase 3 装回 B-prod 而不是计划默认的 `A-prod`，是人类的选择（D36）。
- D38（2026-10-15 16:53 +08，评审修复实施者 Claude Opus，由评审会话派出；评审 2026-10-15（Singularity-AI-Bot review id 5530340585，head `6fc33768`，APPROVE，P2 ×2、P3 ×2 与 1 条 PR 级说明）意见处置；F1 的 S3 去留是人类裁决，原文如下；其余人类可推翻）逐条：
  - F1 [P2] `client.ts:31`「面板先登记，watch 同步失败不丢面板」在真实 Cordis 4.0.4 下不成立 → **属实，修**。复现：评审的探针（真实 `Context.inject` 跑本树 `client.ts` 的 `apply`，宿主没有 `$stream`）在 head 上得到 `{"registered":[]}`，加 try/catch 后两项都在；机制是 `Fiber._reload` 捕获回调异常后把 epoch 置 INACTIVE 并 `_unload()` 该 fiber 的全部 disposer，而 `slots.inject` 的贡献就是调用方 fiber 的 effect（dsh-client-ui-renderer 0.2.0-rc.2）。处置：`client.ts` 只在 `openWorkspaceWatch(child)` 外加 try/catch，记一行 `[harness-projects] watch open failed` 后返回、不登记 watch effect；`child.effect` 留在 try 之外：catch 只覆盖 watch 的打开，`effect` 自己的异常交给 Cordis 记录，不会被误记成「watch 打开失败」；在 Cordis 4.0.4 的同步回调里 `effect` 只在 `assertActive()` 失败或 state 为 5 时抛错，这个分支实际不可达（复评的良性实验：effect 放在 try 内外，流都不会因此被关掉）。安装件 e 节的假 Context 改为 Cordis fiber 模型（回调在微任务里运行、抛错即卸载全部 effect、`apply` 不 reject），本机设 `HARNESS_CORDIS` 时换成真实 `Context.inject`（TD-060）；卸载用例改为卸载整个 fiber。D32(3) 的「不加 try/catch」被本条取代。证据：新用例在评审前的 `client.ts` 上红（模型与真实 Cordis 都是 `actual: []`），修复后绿；M23（去掉 try/catch）与另两个 F1 变异（吞掉不记日志、记日志后重抛）在模型与真实 Cordis 两种运行下都 KILLED；复评追加的 RF1-d（catch 里去掉 `return`，卸载时对未赋值的 `workspace` 调 `close`）起初在两种运行下都存活，抛错用例补上「卸载后面板撤回、fiber 没有记录异常、只有一行 error 日志」的断言，并让假 Context 的卸载与 Cordis `_unload` 一致（逐个捕获 disposer 异常并记入 `fiberErrors`，不再用会 reject 的 `Promise.all`；真实路径从 Cordis logger 的缓冲区取异常），之后 RF1-d（即 M25）在两种运行下都 KILLED；`lib/client.js` 的 bundle 差恰为这一处（1 行变 7 行），`lib/index.js` 不变。
    - 人类裁决（2026-10-15 16:44 +08，评审会话直接问仓库所有者，逐字）问：「PR #345 评审 P2：宿主没有 `$stream` 时，watch 打开会同步抛错，真实 Cordis 会连带撤掉已登记的面板（受支持的 0.2.0-rc.2 有 `$stream`，今天触发不了）。修法是在 client.ts 给 openWorkspaceWatch 加 try/catch，只改这条失败分支；但 `lib/client.js` 的字节会变，而 #345 的真实 Desktop（S3）证据绑定在旧 sha256 `cba8f890…` 上。怎么处理？」答：「修，沿用 S3 证据 (Recommended)」
    - S3 新鲜度（D22）：修复后 `lib/index.js` 为 `855c4934ac91886bb0f51f17997f8610db39d01da969cf680296c8013c6c2b7b`（不变）、`lib/client.js` 为 `46eb7fe01fc3bdfdbcf160dd1621875bf88ab69284f2283492bfbcfcc7b82199`（原 `cba8f890…`）；S3 证据按上面的裁定沿用，裁定范围只限这一条失败分支改动，此后再改变两个 lib 的字节仍按 D22 处理。
  - F2 [P2] TD-058 的承接方 #227 已关闭，宿主读取异常的永久终止不在任何 TD 里 → **属实，转承接**。#227 于 2026-09-30 关闭；#229 正文只写了接线 #276 的 watch 流，没有登记这一限制。处置：TD-058（计划表与 tracker）改指 #229，补上「Host 侧读取异常经 `guarded` 终止」与「帧被拒（D7）」两个终止来源，写明 `WorkspaceFollower` 没有 reopen 接口、重开须有界退避；失败模式表两行加上指向。评审会话已在 #229 登记这条验收：https://github.com/SingularityKChen/harness-projects/issues/229#issuecomment-6188738391。TD-059 依赖的 #218 决策评论仍是 D24 的人类门，本条不改。
  - F3 [P3] 缺省 `abortableDelay` 的「中止即提前结束等待」没有用例（评审 R5 存活）→ **属实，修**。`workspace-stream` 加第 3 条：不传 `wait`、`intervalMs: 60_000`，拿到 baseline 后中止，断言停在等待上的 `next()` 在 1 s 上限内以 `done: true` 结算。证据：R5（即 M24）在评审的 7 份文件命令下 KILLED，只红这一条。
  - F4 [P3] 流加入共享的无上限排空，而 #338 把 watch 流列为范围外 → **属实，不改代码，转承接**。处置：风险 R3 补一句指向 #338；「有界排空必须覆盖打开的 watch 流、超时后能结束停在 `yield` 的生成器」已由评审会话登记到 #338：https://github.com/SingularityKChen/harness-projects/issues/338#issuecomment-6188739084。
  - PR 级说明 [P3] AC1 的 delta 归因：无需改动，D37(5) 已写明限度；是否补一次 B-prod 上只改 Status 的观测仍归人类。
  - 复评（2026-10-15，修复成立，无新的 P0–P2）的三条 P3：N1 改正上面 `child.effect` 留在 try 外的理由；N2 即 RF1-d，处置见 F1；N3 把 Batch 6b 里「两个 lib 的 sha256 必须与 Batch 6a 相同」改为等于本条记录的值。提交正文与 PR 正文的对应句在整合时改写（评审会话执行）：`979828dd` 正文的因果（保住面板的是 catch，不是登记顺序）、PR 正文第 14 行的同一说法、PR 正文第 55 行的 sha256。

### 调研依据

- Kubernetes API Concepts：410 Gone 时清本地缓存、重新 get / list、从返回的 `resourceVersion` 开始 watch；streaming list（`sendInitialEvents=true`）先发合成的 `ADDED` 再以 `BOOKMARK` 标出初始状态结束；410 源于服务端只保留有限历史。https://kubernetes.io/docs/reference/using-api/api-concepts/
- graphql-ws PROTOCOL：协议不定义断线后的重放或续传。https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md
- WHATWG HTML Server-sent events：重连时带 `Last-Event-ID`，怎样续传由服务端定义。https://html.spec.whatwg.org/multipage/server-sent-events.html
- TanStack Query Important Defaults：网络重连时在后台重取陈旧查询。https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults
- Relay，Staleness of Data。https://relay.dev/docs/guided-tour/reusing-cached-data/staleness-of-data/
- 宿主一手源码（0.2.0-rc.2，本机安装，S1）：Context and Orientation 的 H1–H10。

## Idempotence and Recovery

- 所有测试可重复执行：数据目录用 `mkdtemp`，结束时删除；不触网、不读凭据、不写真实用户数据根。没有迁移，没有持久化格式变化，回滚任何批次不需要数据处理。
- 每批是独立提交，`git revert <sha>` 即回到上一批的已知良好状态（例外：Batch 3 与 Batch 4 之间的类型检查缺口，回滚 Batch 4 必须连同 Batch 3）；Batch R 与 Batch 6b 改写历史前都有 backup ref。
- Restack 中断：`git rebase --abort` 回到 backup ref；已推送后发现 restack 丢了文件，用 backup ref 做精确 force-with-lease 恢复并把 base 改回原值（交 `git-expert-operations` 流程）。
- 变异脚本从内存副本按字节还原；中断后先看 `git status --short`，只应剩本 PR 的预期改动。
- 测试挂住时（多为未 `close()` 的 follower 或未 `dispose()` 的 remote 留下计时器），`--test-timeout=120000` 会在两分钟后变红；修法是补 `finally` 清理，不是加长超时。
- 并集工作树归协调者，用完按 `git-expert-operations` 流程移除。S3 装在真实 `desktop` profile：恢复是先 remove 再 add `A-prod` 或人类指定的构建；`~/.dsh/harness-projects` 原样保留，任何清理由人类决定，agent 不删除；沙箱条目由人类改回原值。

## Artifacts and Notes

- 设计原型（git 忽略，不入库）：`.superpowers/design/B/proto-final-review/`（`sync-proto.ts`、`stream-proto.ts`、`run.mjs`、`gap.mjs`），用法 `GW=<dsh-api-gateway/lib/types/client 目录> node .superpowers/design/B/proto-final-review/run.mjs`；三份设计稿在 `.superpowers/design/B/`。
- 变异 spec 工作副本：`.superpowers/review/host-watch-stream/mutants.json`（git 忽略；Batch 6c 的整表与附加规格在同目录的 `simplify/`）；最终全文由 Batch 6 写进 `Outcomes & Retrospective`，保证可重放。
- PR 正文工作副本：`.superpowers/pr-body-276.md`（git 忽略）。
- 预计新增的受跟踪产物以 `Global Constraints` 的文件表为准，不在此复述。

## Interfaces and Dependencies

- 工具：Node 26（类型剥离直接运行 `.ts`）、pnpm 10.28.2（`packageManager` 固定）、esbuild 0.28.2（插件构建）；不新增依赖。
- 宿主：DeepSeek Harness 0.2.0-rc.2（`@deepseek-ai/dsh` 的 dist-tags 在 PR 回读时用 `npm view @deepseek-ai/dsh dist-tags --json` 重查，宿主升级后按 TD-060 复核）。只使用 H1–H10 列出的面。
- 命名契约：描述符 id `@harness-projects/app-harness-plugin#harnessProjects/watch`，namespace `harnessProjects`，method `watch`，`mode: 'stream'`，`cancellation: { parameter: 'signal' }`；`$stream` 名 `harness-projects watch`；日志前缀 `[harness-projects] watch`（`<kind> r=<revision> gen=<generation>`、`carrier lost`、`failed`、`open failed`）。
- 新导出：`@harness-projects/controller` 的 `WireStreamFrame`、`StreamOptions`、`streamWorkspace`；`@harness-projects/client` 的 `GenerationItem`、`GenerationStream`、`FollowOptions`、`WorkspaceFollower`、`followWorkspace` 与 `WorkspaceSync.receive`。

### PR 字段

- 标题：`feat(apps): stream the workspace watch from the host into the client store`
- 标签：`kind:feat`、`area:apps`、`area:client`（与 #276 一致）。
- 里程碑：`M4 · MVP Demo：Harness 内打通 GitHub 链路`（与 #276 一致）。
- Base：Batch 0 到 Batch R 之前是 `main`；Batch R 之后是 `feature/host-provider-composition`（原生栈第 2 层）；A 合并后由 GitHub 改回 `main`。PR 正文写明「base 是 PR A（#132 的 PR），本 PR 是原生栈第 2 层」；A 的正文写明本 PR 是下一层。
- 关联：PR 描述写 `Closes #276`，由 closingIssuesReferences 承载；回读 issue 侧 closedByPullRequestsReferences，时机与「栈上可能为空」见 Batch 0 与 D25。
- PR 描述必含：闭环一句话、ExecPlan 路径 `docs/exec-plan/active/2026-10-15-host-watch-stream.md` 与 Batch 名（Batch 0 计划入库；Batch 1 Controller 一代流；Batch 2 Client 推模式接受与每代协议；Batch 3 Host stream 描述符与卸载排空；Batch R restack 到 A；Batch 4 HostComposition.watch、客户端壳接线与宿主侧端到端；Batch 5 对抗验证；Batch 6a 独立验收与冻结；Batch S3 S-AB Phase 2；Batch 6b 回填与整合）、真实验证证据、AC1 的 S3 状态、栈关系、风险与回滚。
- Project：按 `docs/project-management/README.md` 把 PR 加入 Project 并回填 Iteration（迭代 6）等机械字段；`Status` 与 blocked-by / blocking 不由 agent 写（「B 依赖 A」只写在两份 PR 正文里，不写成 blocked-by 关系，除非人类批准）。

### 共享文件协议（四个并行 PR 共同遵守，本节只列与本 PR 有关的）

一个单元一个 owner；任何一方都不删除、不改名另一方的成员。

- `apps/harness-plugin/src/host-composition.ts`：A 拥有结构（选项、组合主体、`call`、`disabled`、`guarded` 漏斗）；`HostComposition` 的 `controller`、`call`、`dispose` 保持稳定。B 的增量只限于：一处 import（`streamWorkspace`、`WireStreamFrame`）、一个可选选项 `watchIntervalMs?`、一个紧挨 `call` 的成员 `watch(signal)`（检查 `closed`，经 A 的 `guarded`：中止正常返回，错误记 `operationFailed` 并改抛固定文案）。每个面向 wire 的成员（`call`、`watch`）都过漏斗；输入校验错误保留固定中文文案、在漏斗之外。`call` 与 `watch` 都隐式绑定固定 `WORKSPACE_ID`、一个组合一个 Controller；#127 / #131 引入工作区选择时经 TD-055 / TD-058 协调。
- `apps/harness-plugin/src/host.ts`：只有 A 改。不变量 I7：先 await `remote.dispose()` 再 `composition.dispose()`；最终 `inject` 为 `['typert', 'credentials']`；`createHostComposition` 的再导出删除，测试从 `host-composition.ts` import。
- 只属 B：`apps/harness-plugin/src/remote.ts`（`watch` 描述符追加在末尾，`invocations[0]` 仍是 `baseline`）、`client.ts`（保留 unary `baseline()` 与 `baseline received` 日志，A 的验收 8 用它）、`host-surface.ts`、`workspace-watch.ts`、`packages/client/**`、`packages/controller/src/watch.ts`。A 的 S3 探针是 A 的 head 上对 `client.ts` 的一行临时改动，永不提交，记录 diff 与 sha256。
- 只属 A：`packages/core/src/context.ts`（导出 `unavailableCore`）、`packages/storage/sqlite/src/storage-sync.ts`、`packages/providers/fake/src/storage.ts`、`tests/contract/suites/storage-connector-account.js`、`tests/contract/package-boundaries.test.js`、`apps/harness-plugin/package.json` 与 `pnpm-lock.yaml`（B 不加依赖：`@harness-projects/client` 已声明）、`apps/harness-plugin/src/index.ts`、`docs/adr/*`（ADR-0014 属 A；ADR-0015 预留给 B，只在人类要求协议 ADR 时使用；D 不写 ADR）。
- 只属 C：`packages/providers/development-github/**`、`tests/contract/suites/development.js`（只 `declares()`）、`tests/contract/fixtures/github-development/**`、`docs/product/vertical-path.md` §2.1 第 9 行。只属 D：`docs/architecture/harness-session-api.md` 与 `docs/architecture/README.md` 的那一行、`tests/contract/fixtures/harness-session/**`、`tests/contract/harness-session-api-record.test.js`。本 PR 一个都不碰。
- 共享测试文件：`tests/integration/harness-plugin-artifact.test.js` 的 a–d、f 节归 A（宿主 inject、metafile 输入、干净 `DSH_HOME`），e 节归 B（客户端假 Context：`$stream`、`watch`、`effect`）；`harness-plugin-host-runtime-adapter.test.js` 与 `harness-plugin-host-roundtrip.test.js` 只归 A，二者都不断言描述符个数或服务键集合；新共享夹具 `tests/integration/fixtures/host-seed.js` 由 A 写、B 只读 import。
- 共享文档：见 D26。并集检查：协调者的一次性工作树 `.worktrees/round6-union`（分支 `test/round6-union`，不推送）合并 `main` + 本分支（含 A）+ C + D，跑 `pnpm install --frozen-lockfile --offline && pnpm verify && pnpm run boundaries`；每个 PR 置 ready 前与每次合并前各跑一次。

### 栈与合并次序

- 栈：C、D 不叠栈，都从 `main` 出发；本 PR 原生叠在 A 上，depth 2（D16）。A 的每次整合 force-push 之后，协调者 restack 本 PR（Batch R：先 backup ref，再核对本 PR 路径树差为空）。
- 合并次序、每次合并前后的步骤、A 合并后合并本 PR 前的核对、预案与「任意次序」授权：见 D28。

### 其它接缝

- PR C（#231）：无代码交集；C 的 development 事实进入快照后帧会变大。C 本轮没有宿主窗口，它的 S3 随登记 `development.github` 条目的那一层（#233）与 #143 的演示走查落地。
- PR D（#280）：只在 `docs/README.md` 索引行上可能有文本冲突；S-D 窗口先于 S-AB 运行，期间任何人都不往真实 profile 安装插件或写 `~/.dsh`。
- #218：协调者在 #218 留一条英文决策评论（发之前先用一句可批准陈述问人类，D24）：推模式不使用帧级 generation，物理代号可作为 reset 的带外证据候选；帧级 generation 与 metadata 互斥（TD-059）；流的每个 tick 继承 TD-024 的撕裂读。
- #229：页面经 `openWorkspaceWatch` 返回的 `read()` 读数据，可在 `onReport` 与 `carrier lost` 上加订阅；可以把流的开合移到面板挂载（TD-057）；不得绕过 follower 直接驱动 `createSync` 的拉模式。

### 人类门

- AC1 的 S3：A 的 H3（真实 `desktop` profile 安装与建库）、H4（必要时扩展到 `B-probe`）的答复（已于 2026-10-15 10:56 +08 答复，原文见 D36）；A 的 H5 由人类完成（Desktop 凭据存储里的 `HARNESS_PROJECTS_GITHUB_TOKEN`，本 PR 必需）；沙箱条目的改动与改回（外部写入）、DevTools 内触发引导，都由人类执行。
- 在 #218、#276 发公开评论（D24）。
- A 无法就绪时 AC1 的去向（验收范围变更）；「任意次序」预案的启用（D28）。
- 是否要求把流协议补成 ADR（只能是 Proposed，编号 ADR-0015）。
- PR 合并与看板 `Status`、blocked-by / blocking。

## Outcomes & Retrospective

2026-10-15 10:31 +08 的状态：只有设计、原型与读码证据（Progress 前两条、Surprises 第五至八条），没有任何受跟踪代码改动，没有可报告的结果。Batch 6b 在本节写入：实际结果与验收表逐项读数、与计划的偏差、Batch 5 的变异 spec 全文与整表读数（观察时刻与 head）、真实类交叉核对读数、Batch S3（S-AB Phase 2）的观测或人类对 AC1 的裁决、协调者并集读数、规模实测与削减结果、遗留问题与 TD-057..TD-060 的落账回读。

截至 2026-10-15 13:25 +08（Batch 6a 结束；代码冻结在 `35fcd05f`，base 为本地 A `1391c282`）为真的事实，S3、并集、整合、推送与 ready 仍待协调者，届时在此补写：

- 能力：controller 的 `streamWorkspace` 每代先产出开场 baseline，再按间隔产出净 delta / metadata，gap 后结束、中止后不再读；client 的 `WorkspaceSync.receive` 与拉模式共用唯一接受点和 `markGap`，`followWorkspace` 按每代协议消费宿主流（违例终止、gap 重开、close 即断开并整表 stale）；Host 的 `HostComposition.watch` 每步经 A 的 `guarded`；`remote.ts` 追加 stream 描述符、逐帧严格 JSON 化，卸载先中止所有流再排空；插件客户端在面板登记之后经 `$stream` 打开 watch，卸载 effect 关闭它。
- 验收逐项：AC1 只有 S2 前置（host-watch 第 1 条）与验证者的进程内“真实两半”探针，S3 未执行，阻塞于 S-D 关闭与 A 的 H3、H4 答复及 H5，本 PR 不得在 S3 两行记录之前带着关闭关系合并；AC2 通过（host-watch 第 2 条，M8、M10 KILLED，真实类交叉核对通过）；AC3 通过（两帧深等 controller 值的 JSON，契约逐帧 JSON 化与 M5，boundaries `ℹ pass 9`，浏览器构建含 `stream.ts` 而不含 controller 运行时源文件）；第 4 项卸载与 SQLite 只关一次（M4、M6、M21）、第 5 项每代协议（M9、M11–M13、A2）、第 6 项一代流（M1–M3、M18–M20）、第 8 项 Host 异常漏斗（M17）、第 9 项空数据根（host-watch 第 6 条）全部有判别证据；第 7 项发布门在 6a 的部分全绿，6b 的文档门与协调者并集未跑。
- 变异 spec（可重放）：`command` 为 `node --test --test-timeout=120000` 加 `tests/e2e/workspace-stream.test.js`、`tests/e2e/client-stream.test.js`、`tests/e2e/workspace-read-assembly.test.js`、`tests/contract/harness-host-remote-adapter.test.js`、`tests/integration/harness-plugin-host-watch.test.js`、`tests/integration/harness-plugin-artifact.test.js`；`mutants` 即 Batch 5 的 M1–M22 表（M7 的锚点按 D33 在 `markGap`）。权威读数在代码树 `35fcd05f` 上：22 个全部 KILLED 且归因正确；附加的 X1、X2、X4、X8、X9、X13、X14、X16、X19 与 A1–A3（规格在被忽略的 `.superpowers/review/host-watch-stream/acceptance/`）全部 KILLED。
- 与计划的偏差都有记录：D29–D32（实现与修复轮）、D33（本批的 `markGap`、共享种子、close 同步断开的断言）；客户端壳先登记面板再打开 watch（D32 推翻了原 Design 的顺序；评审修复 D38 补上同步打开失败的就地捕获，只靠顺序保不住面板）。规模：代码 885 / 1000，高于计划上限 800，拆分是协调者的 D23 决定。
- Batch 6c（D34）之后：代码 717 / 1000，冻结点改为 `74d223b6`（两个 lib 的 sha256 见 Progress），计划整表 M1–M22 与附加变异仍全部 KILLED；上面「规模：代码 885」与 6a 的冻结值以此为准。
- 第三次 restack（D35）之后：叠在简化后的本地 A `4eaac807` 上，head `0c6a4c0f`，代码树冻结点 `431a5e8d`，代码 717 / 1000、文档 884 / 1500（回填前），M1–M22、附加变异、拉模式与真实类整表仍全部 KILLED；`lib/index.js` 的 sha256 为 `855c4934ac91886bb0f51f17997f8610db39d01da969cf680296c8013c6c2b7b`、`lib/client.js` 为 `cba8f8903eecfbdfe400789a0fbd9c264be9b2e227ac6dc492d00e8bdc97cfd9`（取代 6c 的 `lib/index.js` 值，`lib/client.js` 不变）；S3 与推送前以此为准。
- 遗留：TD-057..TD-060 已按编号写入 `docs/exec-plan/tech-debt-tracker.md`；风险 R3（卸载被卡住的 socket 写入拖住）按计划接受；Batch S3、B1 / B2 拆分、提交整合、并集、推送、PR ready 与人类门见 Progress 未勾的各项。

Batch S3 与 6b 文档回填之后（2026-10-15 15:34 +08；代码树仍是 `431a5e8d`，回填前重打 `pack:plugin`：`lib/index.js` `855c4934…`、`lib/client.js` `cba8f890…`、tgz `fd190bb4…`，与冻结值逐字相同，打包后已把 `dist/` 移出工作树）：

| 验收项 | 结论 | 证据与强度 |
|---|---|---|
| AC1 | 通过 | S3，单次观测：Desktop 0.2.0-rc.2 真实 `desktop` profile，`B-probe` 上同一句柄同一代 `watch baseline r=1 gen=1` → `watch delta r=2 gen=1`，本地库修订 2、实体 9；B-prod 在宿主内观测到 `watch baseline r=1 gen=1`。另有 S2（host-watch 第 1 条）与进程内「真实两半」探针。限度见 D37(5)：delta 含令牌放宽带来的可见范围变化，不能单独归因于一次 Status 改动；第 7、8 步未执行 |
| AC2 | 通过（S2） | host-watch 第 2 条；M8、M10 KILLED，真实 `RemoteStream` 交叉核对也 KILLED；宿主内的断线重连（第 7 步）没有观测 |
| AC3 | 通过（S2 + S1） | 两帧深等 controller 值的 JSON，契约逐帧 JSON 化与 M5，boundaries `ℹ pass 9`，浏览器构建不含 controller 运行时源文件；宿主内 console 只打 kind、修订与代号 |
| 4、5、6、8、9 | 通过（S2，变异判别） | 同上文；第三次 restack 之后 M1–M22 整表 22/22 KILLED |
| 7 | 部分 | 6a、6c 与第三次 restack 的全量门全绿；本次回填的文档门见下一段；协调者并集、整合后的门与 CI 未跑 |

- 本次回填的文档门（观察时刻，在本回填提交上回读）：`disclosure origin/main` 与 `disclosure feature/host-provider-composition` 都无命中；`e1-evidence-consistency`、`plan-facts-consistency`、`content-placement` 三份 `ℹ pass 18` `ℹ fail 0`；lint `OK`；`git diff --check origin/main...HEAD` 干净；`size feature/host-provider-composition`（合并基即本地 A `4eaac807`）代码 717 / 1000、文档 923 / 1500（计划上限 1300）。
- 在宿主内额外观测到的：无规划变化时的 `watch metadata r=1 gen=1`（来源变化，修订不变），令牌读不到私有仓库时条目按结构化 `permission_denied` fail closed（Surprises 2026-10-15 15:10 +08）。
- 仍归人类：在 #276 发 S3 观测评论、在 #218 发决策评论（D24，都没有请批）；是否要求补一次 B-prod 上只改 Status 的观测（D37(5)）；真实 `desktop` profile 现在装着 B-prod，Desktop 凭据存储里的句柄对应一个同时有 repo 与 project 权限的令牌，每次启动 Host 都会用它同步沙箱 Project A，要不要撤掉令牌、卸载插件由人类决定；`~/.dsh/harness-projects` 与人类挪开的旧数据目录的去留；ADR-0015 不写（人类没有要求）；合并、看板 Status 与 blocked-by。

评审修复之后（2026-10-15 17:05 +08；评审 review id 5530340585 的四条意见，处置见 D38；修复提交已由评审会话整合进对应的交付物提交）：

- 能力变化只有一处：watch 的同步打开失败在注入回调内被捕获并记 `[harness-projects] watch open failed`，面板保留（真实 Cordis 4.0.4 下由 `HARNESS_CORDIS` 交叉核对）；其余是测试与文档。`lib/client.js` 的 sha256 改为 `46eb7fe0…`，`lib/index.js` 仍是 `855c4934…`；AC1 的 S3 证据按人类裁定沿用（D38），验收表的结论不变。
- 判别力：计划整表 M1–M25 与附加、拉模式、真实类变异全部 KILLED（读数见 Progress 的评审修复与复评收尾两条）；评审存活的 R5 现在由 `workspace-stream` 第 3 条杀死（M24），复评存活的 RF1-d 由安装件抛错用例的卸载断言杀死（M25）。
- 转出的两项已由评审会话登记：#229 的一条恢复验收（TD-058，https://github.com/SingularityKChen/harness-projects/issues/229#issuecomment-6188738391）、#338 的有界排空覆盖 watch 流（风险 R3，https://github.com/SingularityKChen/harness-projects/issues/338#issuecomment-6188739084）。是否补一次 B-prod 上只改 Status 的观测仍归人类（D37(5)）。
- 本次文档门（在复评收尾的最后一个提交上回读）：`size 697b283c` 代码 786 / 1000、文档 958 / 1500；`disclosure 697b283c` 无命中；`git diff --check 697b283c...HEAD` 干净；`e1-evidence-consistency`、`plan-facts-consistency`、`content-placement` 三份 `ℹ fail 0`。

## Bottom Change Note

- Change Note (2026-10-15 09:55 +08)：创建。三份设计（协议与载体、client store 语义、验证与宿主观测）经独立评审合成：采用推模式进入唯一接受点、无上限保留窗口、不盖帧级代号、宿主结束本代即终止、卸载先中止再排空；原型以宿主真实 `RemoteStream` 验证。
- Change Note (2026-10-15 10:31 +08)：按跨 PR 集成评审修订，逐条对照代码与 A、C、D 三份计划核实。改为原生栈叠在 A 上（depth 2），阶段 I（Batch 0–3）现在从 `main` 并行开工，A 提交 Batch 4 后由 Batch R restack 并改 base；删除旧 R4 与 Batch 5 的 A 并集工作树，并集改由协调者的 B + C + D 工作树承担。宿主侧集成测试按 A 的选项收进单一装置函数并只读使用 A 的 `host-seed.js`；`watch` 经 A 的 `guarded` 漏斗（新增用例 4 与 M17）；新增空数据根兼容用例 5；描述符追加在末尾；S3 改写为真实 `desktop` profile 下的 S-AB Phase 2，在 6a 冻结后、6b 整合前执行并按 lib sha256 判新鲜度；Batch 6 拆成 6a / 6b。新发现：Batch 3 改 `HostCompositionCall` 会让 `host.ts` 的类型检查暂时缺 `watch`，故 Batch 3 只本地提交（D27）。规模重估约 805，承诺削减到 ≤ 760，部分修订：安装件 e 节保留 `open` 转交 signal 一行以杀死 M16（D23）。没有拒绝的修订项。
- Change Note (2026-10-15 12:00 +08)：Batch R 在本地完成步骤 1–4、Batch 4 完成并本地提交（`23564e2c`），推送、改 base 与回读留给协调者。新发现与修正见 Surprises 末四条与 D30：restack 续作会把 `# Conflicts:` 模板行留进正文（已用 `commit-tree` 改写并要求以后每次 restack 再 grep）；host-watch 的清理 hook 需要自己的上限，否则被破坏的实现会拖死整轮变异；代码桶读数 833，高出计划上限 800 共 33 行，拆分与否交协调者按 D23 决定。计划的设计、批次与验收没有改动。
- Change Note (2026-10-15 12:50 +08)：Batch 5 由独立验证者完成并回填：计划整表 M1–M17 全部 KILLED，真实 `RemoteStream` 交叉核对通过，另做 14 个附加变异与进程内“真实两半”探针（Surprises 2026-10-15 12:50 各条）。新发现两项需要实现者在 Batch 6a 前处理：metadata 帧没有任何用例（X5 存活），`workspace-stream` 在实现回归时自旋挂住进程（X6）；一项低概率的壳耦合（`openWorkspaceWatch` 同步失败会丢面板注册）；代码桶仍为 833，D23 拆分是实际路径。计划的设计、批次与验收没有改动，D31 记录验证者的处置边界。
- Change Note (2026-10-15 13:00 +08)：Batch 5 修复轮：采纳验证者全部测试缺口与面板顺序，按 D32 逐项处置。`workspace-stream` 扩为三条用例（metadata、有上限节拍、预先中止），`host-watch` 扩为六条（提前 return），安装件 e 节加一条面板登记用例；`client.ts` 在登记面板之后才打开 watch（改写了 Design / Spec 里的顺序）；`close()` 删去多余的 `await done`；变异表追加 M18–M22。AC1 的 S3、Batch R 重做、拆分裁决留给协调者与人类。代码桶读数 879，B1 / B2 拆分是实际路径。
- Change Note (2026-10-15 13:25 +08)：Batch 6a 由独立验收者完成。先按本地 A 的新 head `1391c282` 重做 Batch R 第 1–4 步（新 backup ref，无冲突，本 PR 路径树差为空）；对抗验收没有找到 P0–P2 代码缺陷，附加变异 A2 暴露 `close` 同步断开无人判别，已补断言；重构抽出拉推共用的 `markGap`、host-watch 改用 A 夹具的种子导出；M1–M22 在最终代码树上整表 KILLED，全量门全绿；代码树冻结在 `35fcd05f` 并记下两个 lib 的 sha256；TD-057..TD-060 与集成 README 小节提前写入。Design / Spec 的 `receive` 代码块与变异表 M7 的锚点按 D33 就地改写。代码 885 仍高于上限 800，拆分交协调者。
- Change Note (2026-10-15 13:55 +08)：Batch 6c 规模精简，按人类「超规模先想死代码与精简」的指示在拆分之前执行。代码桶 885 → 717：`sync.ts` 的事件处理原地成为 `receive`、不再整段搬移换缩进；`stream.ts`、`watch.ts`、`remote.ts` 去掉冗余变量与注释行；测试表驱动、合并重复搭建、删去被蕴含的断言与替身里不可达的分支。冻结接口不变，M1–M22 与附加变异整表重跑全部 KILLED，重新冻结两个 lib 的 sha256（S3 以新值为准）。Design / Spec 的 `receive` 改法与 `followWorkspace` 代码块、变异表 M11 的锚点、批次 1–3 的用例形状与验收表第 6 项就地改写；D23 的拆分条件不再成立（D34）。
- Change Note (2026-10-15 14:06 +08)：第三次 restack（协调者派发）：叠到简化后的本地 A `4eaac807`（backup ref `backup/host-watch-stream-pre-restack-202610151400`），22 个提交无冲突重放，新 head `0c6a4c0f`、代码树冻结点 `431a5e8d`；本 PR 路径树差为空，共享文件上增删行与 restack 前逐行相同，`git range-diff` 21 个 `=` 与 1 个仅上下文不同的 `!`；`pnpm verify`、typecheck、boundaries、workflow-check 全绿，M1–M22、附加、拉模式、真实类变异整表仍全部 KILLED；`lib/index.js` 的 sha256 变为 `855c4934…`，`lib/client.js` 不变。新增 D35，Progress 与 Surprises 各一条，S3 以新值为准，推送与改 base 仍待协调者。
- Change Note (2026-10-15 15:34 +08)：Batch S3 与 6b 的文档回填（6b 文档 owner Claude Opus，只改本计划）。为什么：S3 已在 S-AB 窗口完成，读数、人类裁决原文与执行偏差要进入拥有它们的计划，6b 的整合与 ready 才有依据。Progress 勾上 Batch 0（回读）与 Batch S3（逐步读数），6b 记为部分完成；Surprises 加四条：fetch 路线没走通、令牌可见范围、启动期凭据竞态在本 PR 这一侧的表现、读数来源与外部写入的执行者；Decision Log 加 D36（人类裁决原文）与 D37（触发、延时、幂等键、换令牌、AC1 判定口径与限度、Phase 3）；Outcomes 加验收表与证据强度；风险 R1 标为已关闭。TD-057..TD-060 逐条读过，S3 没有改变其中的事实，不改。代码树与两个 lib 的 sha256 不变。
- Change Note (2026-10-15 17:05 +08)：评审修复（review id 5530340585，APPROVE，P2 ×2、P3 ×2）。为什么：评审证明「面板先登记就不丢面板」在真实 Cordis 下不成立、TD-058 的承接 issue 已关闭、缺省可中止等待没有判别、#338 的有界排空没有覆盖 watch 流。改了什么：`client.ts` 就地捕获 watch 的同步打开失败（人类裁定沿用 S3 证据，D38 逐字记录）；安装件 e 节改为 Cordis fiber 模型，可选 `HARNESS_CORDIS` 用真实类交叉核对；`workspace-stream` 加缺省等待用例；Design / Spec 的 `client.ts` 代码块、失败模式表、TD-058 / TD-060、风险 R3、验收表 AC1 与第 6 项、变异表 M23–M24、命名契约的日志列表、Batch 4 的 e 节说明就地改写；D22 与 D32(3) 追加指向 D38；Progress、Surprises、Decision Log（D38）、Outcomes 各加一条。
- Change Note (2026-10-15 17:40 +08)：复评收尾（修复成立，三条 P3）。为什么：D38 里 `child.effect` 留在 try 外的理由不准确；RF1-d 存活，暴露假 Context 的卸载与 Cordis `_unload` 不一致；Batch 6b 还写着「sha256 与 Batch 6a 相同」；#229、#338 的外部登记已经发出。改了什么：安装件抛错用例补卸载断言、假 Context 的卸载逐个捕获异常、真实路径从 Cordis logger 缓冲区取异常；D38 改正理由并记 N1–N3 与整合时要改写的提交正文、PR 正文；Batch 6b 一行标 Superseded by D38；TD-058、风险 R3、Progress、Outcomes 把「登记由评审会话执行」改为已登记并附评论链接；变异表加 M25；Surprises 加一条并给陈旧 dist 那条补 #350。
