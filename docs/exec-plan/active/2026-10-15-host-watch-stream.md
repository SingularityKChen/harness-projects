# Host Watch Stream ExecPlan

> 状态：Active
> 创建：2026-10-15
> 范围：issue #276：把 `packages/controller` 的 workspace watch 经 Harness typed remote 的 stream 描述符送进 `packages/client` 的 store；断流的同一时刻整表 stale，重连在同一个逻辑流句柄上重拉 baseline，流里只有 controller 暴露的值。页面（#229）、迟到基线与库重建后的合法 reset（#218）、provider 组合（#132）不在本计划内。
> 上游输入：`AGENTS.md`、`PLANS.md`、issue #276、`docs/adr/ADR-0013-harness-host-composition.md`（Proposed）、`docs/architecture/harness-host-spike.md` §11、`docs/exec-plan/completed/2026-10-13-harness-host-composition.md`、`docs/exec-plan/completed/2026-10-12-client-frame-validation.md`、宿主 `@deepseek-ai/dsh` 0.2.0-rc.2 运行时源码（S1 静态读取，路径写成包内相对路径）。
> 基线：`origin/main` 的 `21cb29eb`（观察时刻 2026-10-15 09:50 +08；回读 `git rev-parse --short origin/main`，变了就按新 base 重算本计划里的行号）。
> 交付形态：原生栈第 2 层，叠在 PR A（#132，`feature/host-provider-composition`）之上（Decision Log D16）。Batch 0–3（Batch 3 只含 `remote.ts` 半边）先从 `main` 并行开工；A 提交它的 Batch 4（选项与 `guarded` 漏斗定稿）后 restack 到 A 的分支（Batch R），再做 Batch 4 起的宿主侧工作。合并次序 A 先于 B。

## Purpose / Big Picture

完成后，插件客户端打开面板时经 typed remote 的 `watch` stream 收到一个开场 baseline，之后宿主每次规划变更都推来一条 delta；`packages/client` 的 store 随之就地更新，页面不刷新。载体断开的那一个回调里，store 整表变 stale、连接标为断开、最后已知值保留；宿主恢复后，同一个逻辑句柄开出新一代并重拉 baseline。插件卸载时宿主先中止所有打开的流、排空，再关闭 SQLite。

最小成功证据：

1. S2：`tests/integration/harness-plugin-host-watch.test.js` 在真实 `createHostComposition`（A 的选项：种子 SQLite 库 + 只含 `harness.fake` 测试条目的目录）+ `installHostRemote` 的服务上，经 JSON 往返的载体与 RemoteStream 替身，跑通「baseline → 规划变更 → delta」「断载体即 stale → 同句柄重拉」「卸载排空」「Host 异常只上固定文案」「空数据根不终止」五条用例。
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
      const wait = options.wait ?? abortableDelay
      const { signal } = options
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

推模式复用唯一接受点，不另写规则（Decision Log D5）。改法：

1. 顶部 `import type { … } from '@harness-projects/controller'` 增加 `WireSnapshot`；`const baseline = async () => { const snapshot = await transport.fetchBaseline(); … }` 改成同步的 `const acceptBaseline = (snapshot: WireSnapshot): SyncReport => { … }`（函数体不变），再加一行 `const baseline = async (): Promise<SyncReport> => acceptBaseline(await transport.fetchBaseline())`。
2. 把 `poll` 里从 `try { assertEventShape(event) }` 到 `return { kind: 'delta', … }` 的事件处理原样抽成 `const applyEvent = <R>(event: unknown, onGapDetected: (gap: WireGap) => R): R | SyncReport => { … }`，两处 `recover(…)` 改为 `onGapDetected(…)`；`poll` 的末行改为 `return applyEvent(event, recover)`。拉模式行为不变。
3. `WorkspaceSync` 加成员并实现：

         /**
          * 推模式（#276）：接受宿主流的一帧。baseline / delta / metadata 走与 poll 相同的接受点，拒绝时抛错且状态不变；
          * gap（含越过本地修订的 delta）只整体标 stale、调 onGap 并回报 `kind: 'gap'`，由流的消费者重开下一代。
          */
         receive(frame: unknown): SyncReport

   实现放在 `createSync` 返回的对象里、`read()` 之前：

           receive(frame: unknown): SyncReport {
             if (isRecord(frame) && frame.kind === 'baseline') return acceptBaseline(frame.baseline as WireSnapshot)
             return applyEvent(frame, (gap) => {
               store.markAllStale()
               options.onGap?.(gap, store)
               return { kind: 'gap', revision: store.revision, reason: gap.reason }
             })
           },

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

    /** 推模式会话从不拉取；拉模式成员不对外暴露，这个 transport 只为复用 createSync 的接受点。 */
    const PUSH_ONLY: Transport = {
      fetchBaseline: () => Promise.reject(new Error('推模式会话不拉基线')),
      poll: () => Promise.reject(new Error('推模式会话不轮询')),
      close: () => undefined,
    }

    export function followWorkspace(connect: (carrierFailed: () => void) => GenerationStream, options: FollowOptions = {}): WorkspaceFollower {
      const sync = createSync(PUSH_ONLY, createEntityStore(), options)
      let closed = false
      const stream = connect(() => sync.disconnect())
      const consume = async (): Promise<void> => {
        let generation = 0
        let opened = false
        try {
          for await (const item of stream) {
            if (closed) return
            if (item.generation !== generation) { generation = item.generation; opened = false }
            const baseline = (item.value as { readonly kind?: unknown } | null | undefined)?.kind === 'baseline'
            if (baseline === opened) throw new TypeError(opened ? `第 ${generation} 代出现第二个 baseline` : `第 ${generation} 代第一帧不是 baseline`)
            const report = sync.receive(item.value)
            if (baseline) { opened = true; item.accept() }
            options.onReport?.(report, generation)
            if (report.kind === 'gap') stream.restart()
          }
        } catch (error) {
          if (!closed) throw error
        } finally {
          sync.disconnect()
        }
      }
      const done = consume()
      return {
        read: () => sync.read(),
        done,
        close: async () => { closed = true; sync.disconnect(); await stream.dispose(); await done.catch(() => undefined) },
      }
    }

- `carrierFailed` 同步调用 `sync.disconnect()`（`PUSH_ONLY.close` 是空操作，所以就是 `lose()`）：连接断开与整表 stale 发生在宿主报告载体失败的同一个回调里。
- 协议违例在 `receive` 之前判定：同代第二个 baseline、某代第一帧不是 baseline 都终止；`receive` 抛出的拒绝同样终止。终止时 for-await 自动关闭宿主迭代，`finally` 标断开与 stale，`done` reject。不自动重开（Decision Log D7）。
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

`client.ts` 在注入回调里、slots 注册之前加两行，unary `baseline()` 调用与它的 `[harness-projects] baseline received` 日志保留不动（A 的验收 8 用它作一次查询往返的证据；A 的 S3 探针只在 A 的 head 上临时加一行、永不提交）：

        const workspace = openWorkspaceWatch(child)
        child.effect(() => () => workspace.close(), 'harness-projects: workspace watch')

`host-surface.ts`（只加结构类型，不 import 宿主包，见 Global Constraints 第二条）：`RemoteStreamOptions { name; open(signal): AsyncIterable<unknown>; ended(accepted): Error; carrierFailed?(error: Error): void }`；`RemoteNamespace.watch(signal: AbortSignal): AsyncIterable<unknown>`；`ClientInjectedContext.remote` 改为 `{ readonly harnessProjects: RemoteNamespace; $stream(options: RemoteStreamOptions): GenerationStream }`（`GenerationStream` 从 `@harness-projects/client` 以 `import type` 取）；`ClientInjectedContext` 加 `effect(execute: () => () => unknown, label?: string): unknown`（H9）。

### 失败模式

| 情形 | 行为 |
|---|---|
| 载体断开（宿主崩溃、SIGTERM、网络） | `carrierFailed` 同步断开并整表 stale；宿主侧该 socket 上的流被中止、生成器结束；连接恢复后同一句柄开新一代，baseline 被接受即恢复当前值 |
| gap（同修订业务变化、修订倒退、缺 seed、TD-024 的撕裂读） | 宿主产出 gap 后结束本代；客户端整表 stale、调 `onGap`、`restart()`，新一代 baseline 被接受后恢复 |
| 越过本地修订的 delta（理论上宿主不会产出） | 与 gap 同路径 |
| 宿主插件卸载 | 宿主 `lifetime.abort()` → 生成器结束 → 客户端 `ended(true)` → 终止：保留最后已知值、整表 stale、断开，`done` reject 并记 `watch failed`（TD-058） |
| 协议违例、帧被拒、非 JSON 帧 | 终止，最后已知值 stale；不自动重开，避免对出错的宿主热循环 |
| Host 侧读取异常（`controller.baseline()` 拒绝等） | A 的 `guarded` 写一行 `operationFailed`（不含 message 与路径）后以固定文案改抛；本代以错误结束，客户端终止，`done` 以固定文案 reject，最后已知值 stale |
| 空数据根（零工作区） | 开场 baseline 为 r=0、`workspace` 缺省、实体为空；`read()` 保持 `undefined`，之后不产出帧，流不终止。创建首个工作区需要 Host 重组（A 的 TD-055），重组结束本代，客户端终止（TD-058），页面须重开 |
| 库重建后修订倒退的新一代 baseline | 被现有低修订规则拒绝 → 终止；合法 reset 归 #218（TD-059） |
| 客户端面板 / 插件卸载 | `child.effect` 的 disposer 调 `close()`：`dispose()` 发出 cancel，宿主 signal 中止，生成器结束（对应 spike O3.8） |

### 范围外

页面与重连 UI、按页面挂载开合流（#229）；拉模式的迟到基线 fencing、单次读快照与合法 reset（#218 / TD-024）；provider 组合与数据库挂载（#132）；宿主定时刷新（#335）；存储变更通知替代轮询；`dsh.client.external` 与安装件 manifest（#227）；契约生成器（spike O3.9）。

### 技术债务（预分配 TD-057..TD-060，Batch 6b 手工插入 `docs/exec-plan/tech-debt-tracker.md` Open Items 的编号位置）

| ID | 子系统 | 简述 | 延期理由 | 下一步 |
|---|---|---|---|---|
| TD-057 | controller / apps Host | 每个打开的流每 `watchIntervalMs`（缺省 1s）全量读一次快照，代价是实体数 × 流数；流的生命周期等于客户端插件生命周期，面板关着也在轮询 | demo 单用户、百级实体；变更通知要改 core / storage，超出本 PR | 存储提交修订时通知 Host 唤醒生成器；#229 决定是否随面板开合流；触发条件：多客户端或千级实体 |
| TD-058 | apps 客户端壳 | 插件 bundle 构造不出 `RemoteStreamCarrierError`，宿主正常结束一代（插件重载 / 卸载）在客户端是终止，不自动重开；一方插件会重开（H7） | 需声明 `@deepseek-ai/dsh-api-gateway/client` 为 external 并验证 spike M23 未验证的一半，属于安装件 manifest（#227） | 验证 M23 后声明 external，`ended(true)` 返回载体错误；与 A 的 TD-055 联动：创建首个工作区需要 Host 重组，重组结束本代，在此之前页面须重开才能看到新工作区 |
| TD-059 | client 同步 | 帧级 `generation`（#312）一旦建立，metadata 帧永远被拒：带 `generation` 键被 `applyMetadata` 的键白名单拒，不带则被「generation evidence 缺失」拒；推模式因此不用帧级 generation，库重建后 fail closed | 合法 reset 与 generation 语义归 #218 | #218 二选一：把物理代号作为带外证据传给接受点，或让 metadata 键白名单接受 `generation`；补「generation 建立后 metadata 仍可接受」用例 |
| TD-060 | 测试 | `tests/fixtures/remote-stream-double.js` 按 0.2.0-rc.2 的 `RemoteStream` 语义手写，宿主升级后可能漂移，CI 发现不了 | 仓库不依赖宿主包（Global Constraints 第二条），CI 无法运行真实类 | 每次升级宿主按 Batch 5 的交叉核对命令用真实类重跑两份测试文件，并核对 H5 的行号 |

### 风险

- R1（主不确定性）：手写的 stream 描述符 + `$stream` 在真实宿主内能否在同一代送达 baseline → delta，目前只有 S1 与 S2 证据；由 Batch S3（S-AB Phase 2）判定。
- R2：替身与真实 `RemoteStream` 偏差；由 Batch 5 用真实类交叉核对、Batch S3 兜底（TD-060）。
- R3：宿主生成器停在 `yield`、网关写 socket 被背压卡住时，卸载会等到写入完成；与 unary 在途调用卡住同级，不另做机制。
- R4：本 PR 是 A 之上的栈层。A 的每次整合 force-push 都要协调者 restack B；A 拖过 B 的评审窗口时，B 不能带着未闭合的 AC1 合并，须人类裁决范围（Interfaces and Dependencies「栈与合并次序」）。

## Global Constraints

- 保持 `AGENTS.md` §1.1 七条不变量与 §2 依赖方向；`remote.ts`、`client.ts`、`workspace-watch.ts`、`host-surface.ts` 不 import core / controller / storage（本 PR 给它们新增的 import 只来自 `@harness-projects/client` 与包内相对路径）；只有 `host.ts`、`host-composition.ts` 可以 import controller（ADR-0013）；`pnpm run boundaries` 必须通过。
- 不 import、不声明任何 `@deepseek-ai/*` 包；宿主 API 只写结构类型（`apps/harness-plugin/src/host-surface.ts` 文件头所说的 D16：锁文件与构建都不需要宿主包）。`apps/harness-plugin/scripts/build.mjs` 的 `CLIENT_EXTERNAL` 保持空。
- MMP 前不做兼容层、双写或开关；不新增迁移，不改数据库。
- 不加 wire 字段；流里只有 controller 产出的值（AC3）。
- 凭据只以句柄存在；测试、夹具、日志与文档不含凭据值；不读取本机任何凭据存储。日志只打 kind、修订号与代号，不打内容或 id。
- 发布面：文档不写本机绝对路径、账号名、令牌、内部系统名；宿主源码一律写成包内相对路径。
- Git：不执行 `git config` 写入；需要指定身份时用 `git -c user.name=<name> -c user.email=<email>` 单次传入，推送前核对作者。提交格式 `<type>(<scope>): <中文摘要>`，正文说明为什么，末尾 `Refs #276`（提交正文不写关闭关键字；关闭关系只由 PR 描述的 closingIssuesReferences 承担）。
- 规模：代码桶（实现 + 测试 + 夹具）≤ 800 行、文档 ≤ 1300 行（CI 硬上限 1000 / 1500）。栈上时 base 是 A 的分支，命令写 `node scripts/rule-checks.mjs size origin/feature/host-provider-composition`；A 合并、本 PR 改到 `main` 之后改用 `origin/main` 重测。2026-10-15 10:31 +08 的诚实重估（不是回读值；size 计入空白改动，`git diff --numstat` 不带 `-w`）：实现约 270（`sync.ts` 抽取换缩进约 90、`stream.ts` 约 55、`watch.ts` 约 35、`remote.ts` 约 35、`host-surface.ts` 约 15、`workspace-watch.ts` 约 20、`host-composition.ts` 约 8、其余约 12）；测试约 535（`remote-stream-double.js` 约 120、`harness-plugin-host-watch.test.js` 约 145（含漏斗与空数据根两条）、`client-stream` 约 105、`workspace-stream` 约 60、契约约 60、安装件 e 节约 40、`client-browser` 1）；代码合计约 805。承诺的削减在 Batch 5 之前做完、目标 ≤ 760：`workspace-stream` 第 3 条（中止）并进第 2 条的脚本化源（约 −15）；安装件 e 节只测「`$stream` 被调一次、`open` 转交同一个 signal、卸载 effect 关闭它」（约 −15）；删 `client-stream` 与 `host-watch` 重复的断言（约 −15，见 Batch 2 与 Batch 4）。文档约 890（本计划约 810 行、Batch 6b 回填约 60、TD 四行、索引一行、可选的集成 README 小节约 10）。死代码复审后仍 > 800 才按 Decision Log D23 拆成 B1 / B2。
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

- [ ] 先写 `tests/e2e/workspace-stream.test.js`（组合方式照 `tests/e2e/client-sync.test.js` 的 `compose()`：fake providers + `composeCore` + `createController(core, { authority: StatusPolicyMode.HarnessManaged, workspaceRevision })`；手动节拍 `wait`：把 resolve 压进数组，`signal` 中止时也 resolve）。两条用例：
  1. `stream：开场 baseline，两次写入只产出一条跨两修订的净 delta（#276）`：第一项深等于 `{ kind: 'baseline', baseline: await controller.baseline() }`；用 `controller.commands.applyPlanningStatus` 把两个未完成工作项改成 `blocked`（两个幂等键），放行一次节拍，第二项是 `kind: 'delta'`、`previousRevision = R`、`revision = R + 2`、`upserts.length = 2`。
  2. `stream：同修订业务变化产出 gap 后本代结束；中止后不再读取`：同一个计数读取的脚本化 `WatchSource`，`baseline()` 依次返回修订 1 标题 `a` 与之后恒为修订 1 标题 `b` 的快照。第一段 `wait` 立即 resolve：依次得到 baseline、`kind: 'gap'`，第三次 `next()` 为 `done: true`。第二段在同一个源上新开一代、`wait` 用手动节拍：拿到 baseline 后再调一次 `next()`（停在等待），中止 signal，该 `next()` 为 `done: true`，第二段的读取次数仍为 1。
- [ ] 跑测试确认红：失败原因是 `streamWorkspace` 未导出。
- [ ] 按 Design / Spec 实现。

**验证**：`node --test tests/e2e/workspace-stream.test.js` 期望 `ℹ pass 2`、`ℹ fail 0`；`pnpm run typecheck` 无输出错误。

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
- [ ] 跑测试确认红；按 Design / Spec 改 `remote.ts`。
- [ ] 本地提交，**不推送**：`HostCompositionCall` 要求 `watch` 之后，`host.ts:61` 的类型检查要到 Batch 4 给组合加上 `watch` 才通过（Surprises 第六条）；Batch 0–2 的提交照常推送。

**验证**：

    node --test tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-roundtrip.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js
    pnpm run typecheck
    pnpm run boundaries

期望：契约文件 `ℹ pass 5`，三份文件 `ℹ fail 0`（Node 类型剥离不做类型检查，运行期不受影响）；typecheck **恰好一个**错误，位于 `apps/harness-plugin/src/host.ts` 的 `installHostRemote(ctx, composition)`，内容是缺少 `watch` 属性，出现别的错误就停下修；boundaries 全绿。

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

  五条用例：
  1. `host watch：同一句柄同一代先 baseline、规划变更后 delta，帧只是 controller 值的 JSON（AC1-S2、AC3）`：等到日志 `watch baseline … gen=1`，记 `b1 = await host.controller.baseline()`；`planning.addItem(fixtureProjectRef(planning.bindingId), 'issue', '新增条目', '正文')`，`await installed.service.bootstrapWorkspace({ kind: 'agent', id: 'host-watch' }, 'host-watch-1')`；等到 `watch delta r=<b1.revision + 1> gen=1`；`streams.length === 1`、`carrier.opened === 1`、`carrier.frames.length === 2`；`carrier.frames[0]` 深等于 `{ kind: 'baseline', baseline: JSON 化的 b1 }`，`carrier.frames[1]` 深等于 `{ kind: 'delta', delta: JSON 化的 diffSnapshots(b1, await host.controller.baseline()) }`（`diffSnapshots` 从 `@harness-projects/controller` 取；两帧的深等已经蕴含键集合，不另断言键白名单）。
  2. `host watch：载体断开的同一回调内整表 stale，重连在同一句柄上重拉 baseline（AC2）`：baseline 之后记 `entry = read().store.get(id)` 与 `at = read().lastUpdatedAt`；`connection.setOnline(false)`、`carrier.break()`；在 `console.info` 桩里遇到 `[harness-projects] watch carrier lost` 时同步拍下 `read()`：`connection.connected === false`、全部行 `isCurrent === false`、`reason` 为断网文案、`lastUpdatedAt === at`、行数不变。`connection.setOnline(true)` 后等到 `watch baseline … gen=2`：`streams.length === 1`（同一句柄）、`carrier.opened === 2`、`read().store.get(id) === entry`（身份不变）、当前值恢复。随后连接保持在线连续两次 `carrier.break()`（每次等到新一代 baseline），仍收到第 4 代 baseline 且 `done` 未 reject（`accept()` 清零重试计数）。
  3. `host watch：卸载中止打开的流，客户端终止并保留 stale 的最后已知值，SQLite 只关一次`：`t.mock.method(SqliteStorage.prototype, 'close')`；baseline 之后 `t.mock.method(host.controller, 'baseline')` 计读取；`installed.dispose()` 与 1 秒超时赛跑先完成；`await assert.rejects(follower.done, /在 gap 之外结束/)`；`read()` 断开且全部 stale；`host.dispose()` 后 `close` 调用 1 次，`assert.throws(() => host.watch(new AbortController().signal), /已关闭/)`；再等 30ms，读取次数不再增长。
  4. `host watch：Host 侧读取异常经漏斗只以固定文案终止，诊断日志多一行 operationFailed 且不含路径`：baseline 之后读 `<dataDir>/diagnostics.log` 里 `operationFailed` 行数（文件不存在记 0）；`t.mock.method(host.controller, 'baseline', async () => { throw new Error('读取失败：' + dataDir) })`；`await assert.rejects(follower.done, (error) => error.message === 'harness-projects：操作失败，原因已写入宿主诊断日志')`；`operationFailed` 行数恰好加 1，日志全文不含 `dataDir`；`carrier.opened === 1`（非载体错误不重开）。
  5. `host watch：空数据根只有 r=0、无工作区的 baseline，read() 保持 undefined，流不终止`：`open(t, { seed: false })`；等到 `watch baseline r=0 gen=1`；`carrier.frames[0].kind === 'baseline'`、`.baseline.revision === 0`、`.baseline.workspace === undefined`、`.baseline.entities` 深等于 `[]`；挂上 `done` 的结算标记，`t.mock.method(host.controller, 'baseline')` 计读取并有上限地等到再读 3 次（证明过了几个 tick）；`follower.read() === undefined`、`carrier.frames.length === 1`、`done` 未结算。它钉住「客户端接受 `workspace` 缺省的帧头（`wire.ts:64`、`sync.ts:208`）」这条与 A 空数据根的兼容。
- [ ] `tests/integration/harness-plugin-artifact.test.js` 只改 `e.` 节：`applyClient` 的子 Context 加 `remote.$stream(options)`（记录 options，返回桩流：迭代的 `next()` 挂起直到 `dispose()` 以 `done` 结束，`dispose` 计数）、`remote.harnessProjects.watch(signal)`（记录 signal，返回空异步迭代）与 `effect(execute)`（记录 `execute()` 的返回）；新增 `it('客户端经 $stream 打开 watch 一次，open 转交同一个 signal，卸载 effect 关闭它')`：`$stream` 被调 1 次；以一个新 signal 调 `options.open(signal)`，`harnessProjects.watch` 收到的是同一个 signal（变异 M16 没有别的杀手，所以保留这一行）；`effect` 登记 1 次且执行其 disposer 后桩流 `dispose` 计数为 1。不再断言 `name` 类型与 `ended` 的返回类型。既有日志断言保持（桩流不交付项，不产生 watch 日志）。
- [ ] 跑测试确认红（`host.watch is not a function` 与 `openWorkspaceWatch` 未导出，不是夹具或 seed 失败）；按 Design / Spec 改 `host-composition.ts`、新建 `workspace-watch.ts`、改 `client.ts` 与 `host-surface.ts`。
- [ ] 验证全绿后执行 Batch R 第 5、6 步（推送并改 base）。

**验证**：

    node --test --test-timeout=120000 tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js tests/integration/harness-plugin-host-roundtrip.test.js
    pnpm run typecheck
    pnpm run boundaries
    node scripts/rule-checks.mjs size origin/feature/host-provider-composition

期望：host-watch `ℹ pass 5`，四份文件 `ℹ fail 0`（后两份是 A 的文件，证明追加 `watch` 后 `invocations[0]` 与 A 的组合行为不变）；typecheck 无错误（Batch 3 留下的那一个也消失）；boundaries 全绿；size 报告代码 ≤ 760 的承诺值（硬线 800）、文档 ≤ 1300，超出先按 Global Constraints 的削减与死代码复审处理并记入 Surprises，仍 > 800 按 D23 拆分。

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
| M7 | `packages/client/src/sync.ts` | `receive` 里的 `store.markAllStale()\n        options.onGap?.(gap, store)` → `options.onGap?.(gap, store)` | `gap 先整表 stale` |
| M8 | `packages/client/src/stream.ts` | `connect(() => sync.disconnect())` → `connect(() => undefined)` | `同一回调内整表 stale` |
| M9 | 同上 | `if (report.kind === 'gap') stream.restart()` → `void 0` | `gap 先整表 stale 再重开` |
| M10 | 同上 | `item.accept()` → `void 0` | `重连在同一句柄上重拉` |
| M11 | 同上 | `if (baseline === opened) throw` → `if (false) throw` | `违例与被拒的帧终止` |
| M12 | 同上 | `if (closed) return` → `void 0` | `close 之后迟到的帧` |
| M13 | 同上 | `if (!closed) throw error` → `void error` | `违例与被拒的帧终止` |
| M14 | `packages/client/src/sync.ts` | `store.revision > snapshot.revision &&` → `false &&` | `低 revision baseline 只有新 generation evidence` |
| M15 | `apps/harness-plugin/src/client.ts` | `child.effect(` → `void (` | `卸载 effect 关闭它` |
| M16 | `apps/harness-plugin/src/workspace-watch.ts` | `open: (signal) => child.remote.harnessProjects.watch(signal)` → `open: () => child.remote.harnessProjects.watch(new AbortController().signal)` | `open 转交同一个 signal` |
| M17 | `apps/harness-plugin/src/host-composition.ts` | `next: () => guarded(() => frames.next())` → `next: () => frames.next()`（去掉漏斗） | `经漏斗只以固定文案终止` |

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
- [ ] 重跑文档门：`node scripts/rule-checks.mjs disclosure <base>`、`node scripts/rule-checks.mjs size <base>`、`git diff --check <base>...HEAD`、lint；再算一次两个 lib 的 sha256，必须与 Batch 6a 相同。
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

- `B-prod`：本 PR head（含 A）。`pnpm --dir apps/harness-plugin run pack:plugin`；记 head 与 tgz、`lib/index.js`、`lib/client.js` 三个 sha256，后两个必须等于 Batch 6a 的值；tgz 复制为 `$SCRATCH/b-prod.tgz`（`$SCRATCH` 由 `mktemp -d` 在系统临时目录创建，`$DESKTOP_APP` 为 Desktop 应用包根目录）。
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

**判定**：第 3、6 步两行都在、`gen` 相同、delta 的修订大于 R（预期 R+1）→ AC1 通过。A 在本 PR 评审期内无法就绪时，AC1 的处理（等待 A、接受其它宿主内证据或移交）属于验收范围变更，必须由人类决定并记入 Decision Log；B 不能带着未闭合的 AC1 合并，也不得静默放弃。

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
| AC1 | 宿主内客户端收到 baseline，规划变更后至少收到 1 条 delta（记录观测，带宿主版本） | S3：Batch S3（S-AB Phase 2）第 3、6 步的控制台两行、宿主版本、head、两个 lib 的 sha256 与时刻；S2 前置：`harness-plugin-host-watch`「同一句柄同一代先 baseline、规划变更后 delta」 |
| AC2 | 断流时 store 立即 stale，重连在同一句柄上重拉 baseline（对宿主侧服务测试） | S2：`harness-plugin-host-watch`「载体断开的同一回调内整表 stale，重连在同一句柄上重拉 baseline」（同步快照、`streams.length === 1`、`gen=2`、条目身份不变）；变异 M8、M10 KILLED；Batch 5 真实类交叉核对 |
| AC3 | 流里只有 `packages/controller` 暴露的东西；`pnpm run boundaries` 通过 | S2：同一文件 AC1 用例里两帧深等于 controller 值的 JSON（深等即蕴含键集合）；契约「strictly JSON-encodes every watch frame」与 M5；S1：`WireStreamFrame` 定义在 controller，`remote.ts` 只透传；`pnpm run boundaries`；`client-browser` 断言浏览器构建含 `stream.ts` 而不含 controller 运行时源文件 |
| 4 | 卸载先中止流、排空后撤回，SQLite 只关一次（ADR-0013 留给 #276 的跨代 drain） | 契约「aborts and drains an open watch」、集成「卸载中止打开的流…SQLite 只关一次」；M4、M6 |
| 5 | 每代协议：唯一开场 baseline、违例终止、gap 重开、close 吸收 | `client-stream` 三条用例；M9、M11、M12、M13 |
| 6 | 净 delta、gap 结束本代、中止后不再读 | `workspace-stream` 两条用例；M1–M3 |
| 7 | 发布门 | Batch 6a 全量门与 Batch 6b 文档门全部达到期望；协调者并集全绿 |
| 8 | Host 侧异常只以固定文案上 wire，诊断日志多一行 `operationFailed` 且不含路径（复用 A 的漏斗） | `harness-plugin-host-watch`「Host 侧读取异常经漏斗只以固定文案终止」；M17 |
| 9 | 与 A 的空数据根兼容：r=0、无工作区的 baseline 被接受，`read()` 保持 `undefined`，流不终止 | `harness-plugin-host-watch`「空数据根只有 r=0、无工作区的 baseline」 |

## Progress

- [x] 2026-10-15 09:55 +08 设计完成：三份独立设计经最终评审合成本计划（载体与协议取设计 1，store 语义取设计 2 的净 delta 与吸收态，验证与 S3 取设计 3）；用宿主 0.2.0-rc.2 的真实 `RemoteStream` 跑通原型（同代 baseline → delta、载体失败回调内同步 stale、gap → restart → 第 2 代 baseline、宿主卸载 → 客户端终止），见 Surprises。
- [x] 2026-10-15 10:31 +08 按跨 PR 集成评审修订本计划：改为叠在 A 上的原生栈、宿主侧测试改用 A 的选项与种子夹具、`watch` 经 A 的 `guarded` 漏斗、新增空数据根兼容用例、S3 改写为 S-AB Phase 2、规模重估与削减承诺、共享文件与合并次序协议（Decision Log D16–D28）。仍没有任何受跟踪代码改动。
- [ ] Batch 0 计划入库、draft PR 与字段回读（base `main`）
- [ ] Batch 1 Controller 一代流
- [ ] Batch 2 Client 推模式接受与每代协议
- [ ] Batch 3 Host stream 描述符与卸载排空（`remote.ts` 半边，只本地提交）
- [ ] Batch R restack 到 A（阻塞于 A 的 Batch 4 提交）
- [ ] Batch 4 HostComposition.watch、客户端壳接线与宿主侧端到端；推送并改 base
- [ ] Batch 5 对抗验证（变异整表、真实类交叉核对；并集由协调者跑）
- [ ] Batch 6a 独立验收、重构、冻结并记 sha256
- [ ] Batch S3 S-AB Phase 2 宿主内观测（阻塞于 S-D 关闭、A tree-final、A 的 H3 / H4 答复与 H5 完成）
- [ ] Batch 6b TD 与文档回填、提交整合、并集、PR ready

## Surprises & Discoveries

- 2026-10-15：帧级 `generation` 与 metadata 互斥（TD-059）。在本计划工作树根目录（`origin/main` `21cb29eb`）用原型给 metadata 帧加 `generation` 键后，`applyMetadata` 报「metadata 与本地修订 1 的实体集合不一致，或携带了来源以外的字段」；既有用例「接受点：generation 建立后，缺 generation 的 delta / metadata 被拒绝且快照不变」又要求不带 `generation` 的 metadata 被拒。所以拉模式一旦有 generation 生产者，metadata 就永远进不来；本 PR 因此不在帧上盖代号。
- 2026-10-15：`retain` 默认 1 会把一个 tick 内的两次写入变成 gap。同一工作树上原型：两次 `applyPlanningStatus` 之间只 poll 一次，`retain: 1` 得到 `kind: 'gap'`（1 → 3），`retain: Infinity` 得到 1 → 3 的净 delta 且两行都是 `blocked`。原因是 seed 是游标处的精确快照，跨任意修订的 diff 都精确（Decision Log D4）。
- 2026-10-15：宿主的 stream 项不经过 result codec（H3），描述符上的 strict codec 对流只是登记用；严格 JSON 化必须由 Host 方法自己做。
- 2026-10-15：插件客户端的注入子 Context 有 `effect`（H9，Cordis 4.0.4 的 Context 方法），卸载接线不需要读根 Context。
- 2026-10-15：原型（`.superpowers/design/B/proto-final-review/`，git 忽略）以宿主 0.2.0-rc.2 安装里的真实 `RemoteStream` 与 `RemoteStreamCarrierError` 驱动本设计：AC1-S2 回报 `[['baseline',1,1],['delta',2,1]]`；断载体时 `carrierFailed` 回调内同步读到 `connected=false`、全部行 stale；上线后 `['baseline',2,2]`、同一 stream 对象、条目引用不变；gap 路径回报 `baseline g1 → onGap 时行已 stale → gap g1 → baseline g2`，`open` 2 次；宿主生命周期中止后客户端 `done` 以 `ended after accept` 终止，宿主两代生成器都已结束。
- 2026-10-15 10:31 +08（读码，base `21cb29eb`）：`apps/harness-plugin/src/host.ts:61` 把组合当作 `remote.ts` 的 `HostCompositionCall` 交给 `installHostRemote`。Batch 3 一旦给 `HostCompositionCall` 加 `watch`，`tsc --noEmit` 就会在 `host.ts` 报缺少 `watch`，直到组合有了 `watch`；而 `host-composition.ts` 的 `watch` 要等叠到 A 之后才写。所以 Batch 3 只本地提交，Batch 4 补齐后再推送（D27）。Node 类型剥离不做类型检查，这段时间运行期测试不受影响。
- 2026-10-15 10:31 +08（读 A 的计划）：A 的计划在这一刻还把 `seed(dataPath, catalog, build)` 写在它自己的测试文件里，尚未抽成共享夹具 `tests/integration/fixtures/host-seed.js`；跨 PR 协议约定由 A 抽出、B 只读 import。Batch R 时若 A 的分支上还没有这个文件，协调者请 A 的 owner 抽出，B 不复制种子逻辑（D17）。
- 2026-10-15 10:31 +08（读码）：空数据根上 A 的组合是 `unavailableCore('工作区尚未创建')`：`getPlanningSync` 返回常量、`getWorkspaceMetadata` 返回 `workspace: undefined`，`storage.currentRevision` 对不存在的工作区读回 0（`packages/storage/sqlite/src/storage.ts:178`）。因此 Host 流的开场 baseline 是 r=0、无工作区，之后每次 poll 的修订与来源签名都不变、不产出事件；客户端 `assertHeader` 接受缺省的 `workspace`，`read()` 返回 `undefined`（D19）。

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
- D22 S3 的新鲜度：Phase 2 在 Batch 6a 冻结之后、6b 整合与 ready 之前执行；记 `lib/index.js` 与 `lib/client.js` 的 sha256，合并前任一变化就重做 Phase 2 或请人类裁决；保树的整合与 restack 不触发重做。取代「S3 可以在 Batch 6 之前或之后」——那会让 6a 的重构改掉被观测的构建（#329 的教训）。
- D23 规模：叠栈后诚实重估为实现约 270、测试约 535、代码约 805（`sync.ts` 换缩进约 90 行也计入，size 不忽略空白）。承诺 Batch 5 之前削减到 ≤ 760：`workspace-stream` 的中止用例并进第 2 条；删 `client-stream` 与 `host-watch` 的重复断言（终止后 stale、键白名单）；安装件 e 节收窄。**部分修订**：评审建议 e 节只留「`$stream` 被调一次、卸载 effect 关闭它」，本计划另保留「`open` 转交同一个 signal」一行，因为其余用例都不断言「客户端 close 会中止宿主那一代的 signal」，变异 M16 没有已知的别的杀手；Batch 5 若证明别的用例也能杀死它，再删这一行。死代码复审后仍 > 800 才拆：B1 = controller `streamWorkspace`、client `receive` / `followWorkspace`、替身与 e2e 测试，`Refs #276`，base `main`；B2 = Host、壳与 S3，`Closes #276`，B1 合并后叠在 A 上。栈深仍 ≤ 3。
- D24 人类门：在 #218 发决策评论、在 #276 发 S3 观测评论都是代表用户的公开写入，协调者先用一句可批准陈述问人类；可选的流协议 ADR 预留编号 ADR-0015，只能是 Proposed（ADR-0014 属 A，D 不写 ADR）。
- D25 栈上 PR 的关联回读：base 是 A 的分支时 `closingIssuesReferences` 可能为空；在改正文后、改 base 到 A 后、A 合并且本 PR 回到 `main` 后各回读一次，不提前报关联失败（`docs/project-management/merge-queue.md` 的栈成员关联记录同此）。
- D26 共享文档协议：`docs/README.md` Active 行插在表头分隔行下，冲突时保留所有行、2026-10-15 的行按计划文件名排序；TD-057..060 按编号位置插入，不随合并次序；可选的 `tests/integration/README.md`「Host watch（#276）」小节紧接 A 的「Host 组合（#132）」之后；TD-058 的下一步与 A 的 TD-055 交叉引用（创建首个工作区要重组，重组结束本代，页面须重开）。
- D27 Batch 3 只本地提交、Batch 4 绿了才推送。原因见 Surprises 2026-10-15 10:31 第一条。放弃：把 `HostCompositionCall.watch` 设为可选（等于为过渡期写兼容分支，违反 MMP 前不做兼容）；在 `main` 上先给旧 `host-composition.ts` 加 `watch`（必与 A 的重写冲突，也越过 A 的结构所有权）；推送一个类型检查红的提交（draft PR 的 CI 变红，整合前的提交不能独立通过）。
- D28 合并次序与预案：C、D 与 A / B 互不依赖，各自门过即可合并；A 必须先于 B；推荐 C → D → A → B，C、D 可插在任意位置。每次合并前：rebase 到当前 `main`（严格保护会让其余 PR 变 BEHIND）、按 D26 解决索引与债务表冲突、在 `main` 加全部未合并 head 上重跑并集 `pnpm verify`、回读 `closingIssuesReferences`；每次合并后回读被关闭 issue 的状态。A rebase-merge 后 GitHub 把本 PR 改基到 `main`；合并本 PR 前比对树与新旧 head 的 `git range-diff`、比对每个 approval 的 `submitted_at` 与 head 提交时间（保树的 force-push 会把 approval 重映射到新 head），`gh pr merge` 被拒时走 merge-async REST。若改基后分支仍带着 A 的旧提交（`git diff --name-only origin/main...HEAD` 含 A 的文件），按 `merge-queue.md` §4 用 `git rebase --onto origin/main <A 合并前的 head> feature/host-watch-stream` 手工变基、按精确 lease 强推、重跑验证。A 拖过本 PR 的评审窗口时，B 不能带着未闭合的 AC1 合并，须人类裁决范围。仅当人类改判、必须让 B 先合并时启用「任意次序」预案：B 的 `watch` 按旧选项写；A 重构时保留 `watch` / `watchIntervalMs`，只重写 `harness-plugin-host-watch.test.js` 的那一个装置辅助函数——这是写进两份 Decision Log 的显式跨所有权授权，平时不生效。

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
- 变异 spec 工作副本：`.superpowers/review/host-watch-stream/mutants.json`（git 忽略）；最终全文由 Batch 6 写进 `Outcomes & Retrospective`，保证可重放。
- PR 正文工作副本：`.superpowers/pr-body-276.md`（git 忽略）。
- 预计新增的受跟踪产物以 `Global Constraints` 的文件表为准，不在此复述。

## Interfaces and Dependencies

- 工具：Node 26（类型剥离直接运行 `.ts`）、pnpm 10.28.2（`packageManager` 固定）、esbuild 0.28.2（插件构建）；不新增依赖。
- 宿主：DeepSeek Harness 0.2.0-rc.2（`@deepseek-ai/dsh` 的 dist-tags 在 PR 回读时用 `npm view @deepseek-ai/dsh dist-tags --json` 重查，宿主升级后按 TD-060 复核）。只使用 H1–H10 列出的面。
- 命名契约：描述符 id `@harness-projects/app-harness-plugin#harnessProjects/watch`，namespace `harnessProjects`，method `watch`，`mode: 'stream'`，`cancellation: { parameter: 'signal' }`；`$stream` 名 `harness-projects watch`；日志前缀 `[harness-projects] watch`（`<kind> r=<revision> gen=<generation>`、`carrier lost`、`failed`）。
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

- AC1 的 S3：A 的 H3（真实 `desktop` profile 安装与建库）、H4（必要时扩展到 `B-probe`）的答复；A 的 H5 由人类完成（Desktop 凭据存储里的 `HARNESS_PROJECTS_GITHUB_TOKEN`，本 PR 必需）；沙箱条目的改动与改回（外部写入）、DevTools 内触发引导，都由人类执行。
- 在 #218、#276 发公开评论（D24）。
- A 无法就绪时 AC1 的去向（验收范围变更）；「任意次序」预案的启用（D28）。
- 是否要求把流协议补成 ADR（只能是 Proposed，编号 ADR-0015）。
- PR 合并与看板 `Status`、blocked-by / blocking。

## Outcomes & Retrospective

2026-10-15 10:31 +08 的状态：只有设计、原型与读码证据（Progress 前两条、Surprises 第五至八条），没有任何受跟踪代码改动，没有可报告的结果。Batch 6b 在本节写入：实际结果与验收表逐项读数、与计划的偏差、Batch 5 的变异 spec 全文与整表读数（观察时刻与 head）、真实类交叉核对读数、Batch S3（S-AB Phase 2）的观测或人类对 AC1 的裁决、协调者并集读数、规模实测与削减结果、遗留问题与 TD-057..TD-060 的落账回读。

## Bottom Change Note

- Change Note (2026-10-15 09:55 +08)：创建。三份设计（协议与载体、client store 语义、验证与宿主观测）经独立评审合成：采用推模式进入唯一接受点、无上限保留窗口、不盖帧级代号、宿主结束本代即终止、卸载先中止再排空；原型以宿主真实 `RemoteStream` 验证。
- Change Note (2026-10-15 10:31 +08)：按跨 PR 集成评审修订，逐条对照代码与 A、C、D 三份计划核实。改为原生栈叠在 A 上（depth 2），阶段 I（Batch 0–3）现在从 `main` 并行开工，A 提交 Batch 4 后由 Batch R restack 并改 base；删除旧 R4 与 Batch 5 的 A 并集工作树，并集改由协调者的 B + C + D 工作树承担。宿主侧集成测试按 A 的选项收进单一装置函数并只读使用 A 的 `host-seed.js`；`watch` 经 A 的 `guarded` 漏斗（新增用例 4 与 M17）；新增空数据根兼容用例 5；描述符追加在末尾；S3 改写为真实 `desktop` profile 下的 S-AB Phase 2，在 6a 冻结后、6b 整合前执行并按 lib sha256 判新鲜度；Batch 6 拆成 6a / 6b。新发现：Batch 3 改 `HostCompositionCall` 会让 `host.ts` 的类型检查暂时缺 `watch`，故 Batch 3 只本地提交（D27）。规模重估约 805，承诺削减到 ≤ 760，部分修订：安装件 e 节保留 `open` 转交 signal 一行以杀死 M16（D23）。没有拒绝的修订项。
