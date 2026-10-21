# Host 远程操作单一声明 ExecPlan

> 状态：Active
> 创建：2026-10-21
> 范围：issue #352。每个 Host 远程操作只声明一次，由声明派生 descriptor、live service、Host 侧 `call` 分发与客户端代理类型；wire 逐项不变，不新增操作。2026-10-21 起并入 issue #374（Host 分发先于 guard 拒绝 stream 名字与未声明名字，并裁定 `baseline` 去留），见 Batch 4、D17–D19。
> 上游输入：issue #352（#351 再规划提前）；`docs/adr/ADR-0013-harness-host-composition.md`；`docs/exec-plan/completed/2026-10-13-harness-host-composition.md`；`docs/exec-plan/completed/2026-10-15-host-watch-stream.md`（宿主网关事实 H1–H4、H10）；下游 #354（Host 重组）、#335（Planning 刷新调度）。

## Purpose / Big Picture

完成后，`apps/harness-plugin/src/host-operations.ts` 的 `OPERATIONS` 是 Host 远程操作的唯一声明处：加一个 unary 操作只改两处（一条声明 + `host-composition.ts` 的一个 `HANDLERS` 条目），漏写或多写 handler 过不了 `tsc`；wire 校验函数只有一份；Host 与 Client 挂载的 descriptor 与今天逐项相同。

最小成功证据：新的 descriptor 金样测试在 base 上先绿、改造后仍绿；`tests/contract/harness-host-remote-adapter.test.js` 字节不变且全绿；夹具操作经一条声明同时出现在 descriptor、Host 分发与客户端代理上；校验函数 grep 只命中 `host-operations.ts`；`pnpm verify`、`boundaries` 与安装件测试通过。

## Context and Orientation

- **现状（base `main` @ f131e68）**：`apps/harness-plugin/src/remote.ts` 有第一套校验（L64–109）、两个参数 codec（L122–123）、三份手写 descriptor（L125–161）与逐方法手写的 live service（L204–226）；`apps/harness-plugin/src/host-composition.ts` 有第二套校验（L37–55：`plainRecord`、`exactInput`、`assertEnvelope`）与 `handlers`（L87–90）；`apps/harness-plugin/src/host-surface.ts` L34–39 手写 `RemoteNamespace`。`client.ts`、`workspace-watch.ts`、`host.ts` 只消费它们。
- **两套校验的行为差异**：`remote.ts` 的 `exactRecord` 只报第一个未知键、`actorRef` 原样返回记录；`host-composition.ts` 列出全部未知键，并把 actor 规整为 `{ kind }` 或 `{ kind, id }`。
- **宿主网关事实**（`docs/exec-plan/completed/2026-10-15-host-watch-stream.md` 的 H1–H4、H10；`2026-10-13-harness-host-composition.md` Surprises）：参数按 descriptor `parameters` 的 `wire` 名经 `codec.create().parse` 解码后，按位置调用 live service 的同名方法；只有带 `cancellation` 的描述符才把 `signal` 追加为最后一个参数；unary 结果只经 `result.encode`，流项不经任何 codec；handler 只能挂在带 `typertRemote` binding 的 live service 上。
- **已有钉子**：adapter 测试 L32–48 钉 id、顺序、`mode`、`cancellation`、参数个数，L50–78 钉 service 层在（桩）组合之前拒绝坏输入；`tests/integration/harness-plugin-host-roundtrip.test.js` L19–27 直接调 `host.call`，固定中文文案须在 Controller 之前抛出；`tests/integration/harness-plugin-host-providers.test.js` L104、L185 要求 `invocations[0]` 是 `baseline`。
- **依赖边**：`tests/contract/package-boundaries.test.js` 的 `HOST_ENTRY.files`（L105–111）是显式名单，只放行 `host.ts`、`host-composition.ts`、`host-providers.ts` import core / controller / storage；L285 起的用例要求 client 入口的相对 import 闭包不到达它们。新模块经 `client.ts → remote.ts` 可达，必须零 import。
- **类型检查范围**：`tsconfig.json` 只 include `packages/**/src` 与 `apps/**/src`，派生类型只能经源码消费者（`host.ts`、`client.ts`、`workspace-watch.ts`、`host-composition.ts`）被 `tsc` 检查。
- **下游**：#354 加工作区与挂载命令的远程操作，并用 holder 替换 Core、Controller、reconciler；#335 的 `refreshPlanning({ actorRef })` 与调度 tick 共用 Core 的单飞槽（`packages/core/src/planning-reconcile.ts:38`），handler 只需 Controller；#142、#282、#234 各追加 unary 操作；已知 issue 都不需要第二条流。

## Design / Spec

**声明（`host-operations.ts`，零 import）**：`defineOperations({...})` 的名字取自键、只写一次，键序即 descriptor 顺序；操作体为 `{ mode: 'unary', params }` 或 `{ mode: 'stream', params: [] }`（流在类型上不允许业务参数）。`param(name, type, parse)` 的 `name` 同时是方法形参名、wire 名与 Host 输入记录的键，`type` 是 typeSymbol 后缀。`ENVELOPE = [actorRef, idempotencyKey]` 与 Controller 的 `CommandEnvelope` 同形，供命令展开。唯一一套 wire 校验（`plainRecord`、`exactRecord`、`nonEmptyString`、`actorRef`）也在这里，行为统一为 composition 版（列出全部未知键、规整 actor）——它才是 Controller 实际收到的值。

**派生**

| 派生物 | 位置 | 规则 |
|---|---|---|
| descriptor | `remote.ts` `descriptorOf` / `defineRemote` | 形状逐项同今天：unary 没有 `mode`、`cancellation` 键；stream 带 `mode: 'stream'` 与 `cancellation: { parameter: 'signal' }`；参数 codec 的 `create().parse` 就是声明的 `parse`；结果统一 `jsonOutput`。`defineRemote(ops)` 返回 `{ operations, host, client }`，两半共享同一冻结数组；`HOST_REMOTE`、`CLIENT_REMOTE` 取自 `defineRemote(OPERATIONS)` |
| live service | `remote.ts` `installHostRemote` | 遍历 `remote.operations`：unary 为 `async (...args)` → `beginCall` → `composition.call(name, inputOfArguments(op, args))` → `endCall`；stream 为 `async function* (signal)`，以成员方式调用 `composition[name](AbortSignal.any([signal, lifetime.signal]))` 并逐帧 `toJson`。注册 `remote.host`；生命周期、排空、卸载代码原样保留 |
| Host `call` | `host-composition.ts` | 模块级 `HANDLERS: UnaryHandlers<typeof OPERATIONS, Controller>`；`dispatch = dispatchOf(OPERATIONS, HANDLERS, guarded)`；`call` 先查 `closed` 再 `dispatch(controller, name, input)`：操作名检查与 `parseInput` 在 `guarded` 之外（固定文案），handler 在 `guarded` 之内 |
| 代理类型 | `host-surface.ts` | `RemoteNamespace` 改为映射类型：unary `(...ArgsOf) => Promise<RemoteResult<unknown>>`，stream `(signal) => AsyncIterable<unknown>`；名字保留 |

**数据流**：网关 `codec.parse` → `service[name](...args)` → `inputOfArguments` → `composition.call` → `parseInput` → `guarded(handler)` → `encode`。三层校验是同一函数、结果幂等，不再漂移；服务层与组合层各有既有测试钉住，故都保留（D10）。**错误模型不变**：校验失败为固定中文 `TypeError`（`guarded` 之外）；操作名不是已声明的 unary 操作（stream 名字、未声明名字、原型链上的键）同样是 `guarded` 之外的固定文案 `TypeError`，不回显名字（#374）；Controller 失败写诊断日志、调用方得到 `OPERATION_FAILED`；关闭得 `已关闭`，卸载得 `已卸载`。

**不变量**：AGENTS.md §1.1-7 Host 拥有权威状态（handler 只透传，结果与 `writeState` 不变）；`Saved` 以 ack 为准不受影响；依赖方向不变（新模块零 import，boundaries 9 条）；LLM 不进入控制路径；ADR-0013 Decision 2（每操作一份 strict descriptor）仍成立。

**放弃**：单一命令信封（D1）；声明留在 `remote.ts`（D2）；只共享校验（不满足 AC1、AC3）；通用 `createDispatch` + `assembly()` thunk + 泛化流（D5）。**刻意不做**：新增操作；query / command 区分（D3）；逐操作输出 codec 或带类型的客户端结果（D4）；holder 与重组（#354）；带参数的流或第二条流；`Function.length` 补丁（D9）；ADR 修改（D12）。

**风险**
- R1（P3）：生成的 unary 方法 `length` 为 0（原 `bootstrapWorkspace` 为 2）；夹具测试的网关替身按 H2/H4/H10 手写；真实网关不在 CI，本构建未在 Desktop 复测。建议登记 TD（见 Interfaces）。2026-10-21 独立验收补充：网关源码复核表明 strict 路径不读 `length`，见 Surprises & Discoveries 同日「独立验收」条目。
- R2（P3）：名为 `ctx` 或 `typertRemote` 的操作会覆盖 service 的同名键；声明是评审过的常量，只记录、不设防。
- R3（P3）：服务层未知键报错从「只报第一个」变为「列出全部」；现有测试只匹配 `/未知字段/`。
- R4：`InstalledHostRemote.service` 放宽为 `Readonly<Record<string, unknown>>`（唯一消费者是 JS 测试）；`RemoteNamespace.bootstrapWorkspace` 的 `actorRef` 从 `unknown` 收紧为 `ActorRefWire`，B（#229）不调用它。

## Global Constraints

- **写入集合（唯一一处声明）**：新增 `apps/harness-plugin/src/host-operations.ts`、`tests/contract/harness-host-operations.test.js`；修改 `apps/harness-plugin/src/remote.ts`、`host-composition.ts`、`host-surface.ts`；文档为本 ExecPlan、`docs/README.md` 一行索引、`docs/exec-plan/tech-debt-tracker.md` 一行（编号由协调者分配）。
- **字节不变**：`client.ts`、`host.ts`、`workspace-watch.ts`、`index.ts`、`apps/harness-plugin/scripts/`、全部既有测试、`packages/*`、ADR。
- **并行 PR B（#229）**：B 拥有 `client.ts` 的 `apply` 体、`workspace-watch.ts`、`packages/ui`；文件交集为空，只有 `docs/README.md` 索引行相邻。保留 `RemoteNamespace`、`ClientInjectedContext`、`RemoteResult`、`CLIENT_REMOTE` 的名字与 `baseline()`、`watch(signal)` 的签名；B 若要新增 Host 操作，须叠在本 PR 之后。
- Node 26（`.nvmrc`）；所有命令在 `.worktrees/host-operation-registry`（分支 `chore/host-operation-registry`，base `main`）的工作树根目录运行；不新增依赖。提交 `<type>(<scope>): <中文摘要>`，末尾 `Refs #352`；PR 描述 `Closes #352`。并入的 #374 提交末尾 `Closes #374`，PR 描述同写 `Closes #374`。
- 规模：代码 + 测试 ≤ 800（评审原型实测约 400），文档 ≤ 1300。TDD：行为改动先有会失败的判别性测试。校验留在 `guarded` 之外，中文文案不变。发布面按 `docs/development/publication.md`：不写本机绝对路径、主机名、令牌。

## Plan of Work

四批串行：同一测试文件贯穿各批，不能并行。Batch 4 是 2026-10-21 并入的 #374（D17）。

### Batch 1 · 钉住现状 descriptor（只加测试，在 base 上绿）

**最小闭环**：把今天的 descriptor 写成字面量金样，作为后续派生的判据。
**涉及文件**：`tests/contract/harness-host-operations.test.js`（新）。
**建议执行者**：Haiku（机械抄录）。

- [ ] 新增用例 `generated descriptors are deep-equal to the hand-written ones they replaced (#352, ADR-0013)`：
  - 只 import `remote.ts`。
  - 把 `HOST_REMOTE.invocations` 中 codec 的函数值换成 `typeof`，再与字面量金样做 `assert.deepEqual`（strict）。金样必须写出 `mode` 和 `cancellation` 键是否存在。
  - 断言 `CLIENT_REMOTE.descriptors === HOST_REMOTE.invocations`。
- [ ] 判别性自检：临时删掉 `remote.ts` 中 `watchDescriptor` 的 `cancellation` 行，应变红；随后 `git checkout -- apps/harness-plugin/src/remote.ts` 还原。
- [ ] 提交 `test(contract): 钉住 Host 远程 descriptor 的逐项形状`。

**验证**：`node --test tests/contract/harness-host-operations.test.js`，期望 `ℹ pass 1`、`ℹ fail 0`。自检时期望 `ℹ fail 1`。
**回滚**：丢弃这个提交即可，它对现状一直有效。

### Batch 2 · 每个操作只声明一次（先红后绿）

**最小闭环**：用新模块替换两套校验与三份手写 descriptor；descriptor、live service、Host `call` 与代理类型都由 `OPERATIONS` 派生。
**涉及文件**：`apps/harness-plugin/src/host-operations.ts`（新）、`remote.ts`、`host-composition.ts`、`host-surface.ts`、测试文件。
**建议执行者**：Sonnet（高推理）；签名照抄 Interfaces。

1. 先写红灯测试。在测试文件中：
   - 给金样用例追加两条断言：
     - `Object.keys(OPERATIONS)` 等于 `['baseline','bootstrapWorkspace','watch']`；
     - `HOST_REMOTE.invocations[1].parameters.map((p) => p.codec.create().parse)` 逐项 `===` `OPERATIONS.bootstrapWorkspace.params.map((p) => p.parse)`。
   - 新增用例 `one declaration adds an operation to the descriptors, the Host dispatch and the client proxy`：
     - 声明：`defineOperations({ echoFixture: { mode: 'unary', params: [param('word', 'FixtureWord', (v) => nonEmptyString(v, 'word'))] } })`，再 `remote = defineRemote({ ...OPERATIONS, ...fixture })`。
     - Host 分发：`dispatch = dispatchOf(remote.operations, { echoFixture: (assembly, input) => 记录 [assembly.tag, input] }, (run) => run())`，然后 `installHostRemote(ctx, { call: (n, i) => dispatch({ tag: 'a1' }, n, i), watch: async function* () {} }, remote)`。
     - descriptor：`remote.client.descriptors` 的方法序为 `baseline, bootstrapWorkspace, watch, echoFixture`，第 4 条深等于金样形状，`registrations[0] === remote.host`。
     - live service 与分发：`service.echoFixture('hi')` 返回 `{ echoed: { word: 'hi' } }`；`service.echoFixture('')` 以 `/word 必须是非空字符串/` 拒绝；`dispatch({ tag: 'a1' }, 'echoFixture', { word: 'hi', extra: 1 })` 以 `/echoFixture 含未知字段：extra/` 拒绝；handler 只记到 `[['a1', { word: 'hi' }]]`。
     - 客户端代理：用约 8 行的网关替身（按 descriptor 逐参 `create().parse`，调 live service，结果 `encode`，失败 resolve 成 `{ ok: false }`）由 `remote.client` 生成代理。`JSON.stringify(await proxy.echoFixture('again'))` 等于 `{"ok":true,"value":{"echoed":{"word":"again"}}}`，`proxy.echoFixture(7)` 的 `ok` 为 `false`。
     - 生产默认不受影响：不传第三个参数时，安装出的 service 不含 `echoFixture`。
   - 运行后应变红，期望非零退出，输出含 `ERR_MODULE_NOT_FOUND` 与 `host-operations.ts`。
2. 按 Interfaces 写 `host-operations.ts`：把 `remote.ts` 的四个校验函数移过来，并合入 composition 版的规整与列出全部未知键的行为。
3. 改 `remote.ts`：
   - 删除校验函数、两个参数 codec、三份 descriptor 常量和手写的 service。
   - 新增 `descriptorOf`、`defineRemote`，`installHostRemote` 增加第三个参数，`HostCompositionCall` 改为映射类型。
   - `jsonValue`、`toJson`、`codec`、`jsonOutput` 留在原处。
   - 文件头注释改为「descriptor 由 `host-operations.ts` 派生」。
4. 改 `host-composition.ts`：删除 `plainRecord`、`exactInput`、`assertEnvelope`、`Handler` 与 `CommandEnvelope` 的 import，改成模块级 `HANDLERS` 加 `dispatchOf`。`watch` 成员不动。
5. 改 `host-surface.ts`：`RemoteNamespace` 改为映射类型，并加入对 `host-operations.ts` 的 type-only import。

**验证**（工作树根目录）：
- `pnpm run typecheck`：退出码 0，无 `error TS`。
- `node --test tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-roundtrip.test.js tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js tests/integration/harness-plugin-host-providers.test.js`：期望 `ℹ pass 29`、`ℹ fail 0`。base 上后五个文件是 27 条。
- `pnpm run boundaries`：期望 `ℹ pass 9`、`ℹ fail 0`。
- `grep -nE "^(export )?function (plainRecord|exactRecord|exactInput|nonEmptyString|actorRef|assertEnvelope)\b" apps/harness-plugin/src/*.ts`：恰好 4 行，全部在 `apps/harness-plugin/src/host-operations.ts`。base 上是 7 行，分布在两个文件。
- `git diff --exit-code origin/main -- apps/harness-plugin/src/client.ts apps/harness-plugin/src/host.ts apps/harness-plugin/src/workspace-watch.ts tests/contract/harness-host-remote-adapter.test.js tests/integration`：退出码 0。

**运行期变异**：每次只做一处临时改动，跑上面的六文件命令，期望下表列出的用例变红，然后 `git checkout -- <file>` 还原。评审原型上 10 处全部被杀。

| ID | 临时改动 | 期望变红 |
|---|---|---|
| M1 | `descriptorOf` 去掉 `cancellation` 展开 | 金样、adapter 首条 |
| M2 | unary 也写出 `mode: undefined` 键 | 金样、夹具 |
| M3 | `ENVELOPE` 的 `'ActorRef'` 改成 `'Actor'` | 金样 |
| M4 | `installHostRemote` 改为遍历 `OPERATIONS` | 夹具 |
| M5 | 注册 `HOST_REMOTE` 而不是 `remote.host` | 夹具 |
| M6 | service 不经 `inputOfArguments`，直接拼记录 | adapter「validates through the strict parser…」 |
| M7 | `parseInput` 移进 `guard` 内 | roundtrip |
| M8 | `dispatchOf` 跳过 `parseInput` | roundtrip、夹具 |
| M9 | `exactRecord` 不再拒绝未知键 | adapter、roundtrip |
| M10 | `dispatchOf` 不把调用方给的 assembly 传给 handler | 夹具、providers |

**编译期探针**：每次只做一处临时改动，跑 `pnpm run typecheck`，期望报错，然后还原。

| ID | 临时改动 | 期望报错 |
|---|---|---|
| C1 | 删掉 `HANDLERS.baseline` | TS2741 |
| C2 | `HANDLERS` 多一个 `ghost` | TS2353 |
| C3 | `OPERATIONS` 加第二条流 `feed` | `host.ts` TS2345 |
| C4 | 加 unary `refreshPlanning: { mode: 'unary', params: [ENVELOPE[0]] }` 但不写 handler | TS2741 |
| C5 | `watch` 改名 | `host.ts` TS2345，`workspace-watch.ts` TS2339 |

- [ ] 记录红灯输出、绿灯输出、M 表与 C 表的结果，然后提交 `refactor(apps): 每个 Host 远程操作只声明一次`。

**回滚**：revert 这个提交。Batch 1 的金样对还原后的手写实现依然为绿。

### Batch 3 · 全量门、安装件与收尾

**最小闭环**：在当前 head 上取得 AC4 的证据，回填本计划，开 draft PR。
**建议执行者**：Sonnet（中推理）。之后由 Opus 做独立验收复读，见 `docs/development/workflow.md` §3。

1. 先执行 `rm -rf apps/harness-plugin/dist`。残留的 `dist` 会让 `tests/e2e/delivery-lineage.test.js` 变红，因为它扫描 `apps/**`（#350）。
2. 执行 `pnpm install --frozen-lockfile`：退出码 0，`git status --short` 不变。
3. 执行 `pnpm verify`：
   - 非 root 下退出码 0。
   - root 下 `pnpm run test` 恰好 `ℹ fail 2`，而且只是这两条：
     - `tests/integration/development-local-git.test.js` 的「拒绝：占用路径、被别处检出的分支与不可访问的目录都不伪造成功」；
     - `tests/contract/run-test-layer.test.js` 的「真实层 tests/integration：非空、全绿，且摘要行被透传」。
   - 区分方法：以任一非 root 用户（PATH 上有 Node 26）运行 `node --test tests/integration/development-local-git.test.js`，期望 `ℹ fail 0`。
   - `verify` 在第一处失败时就停止，所以 root 下还要单独跑 `pnpm run test:mvp0`，期望 `ℹ fail 0`。
   - 其余任何失败都算回归。
4. 执行 `pnpm run boundaries`：`ℹ pass 9`。
5. 执行 `pnpm --filter @harness-projects/app-harness-plugin run pack:plugin`，再执行 `node --test tests/integration/harness-plugin-artifact.test.js`：期望 `ℹ fail 0`，评审原型上是 23/23。然后执行 `rm -rf apps/harness-plugin/dist`，再跑 `node --test tests/e2e/delivery-lineage.test.js`：期望 `ℹ fail 0`。
6. 执行以下检查：
   - `node scripts/workflow-check.mjs`：无发现；
   - `node scripts/rule-checks.mjs size origin/main`：代码不超过 800，文档不超过 1300；
   - `node scripts/rule-checks.mjs disclosure origin/main`：无命中；
   - `git diff --check origin/main...HEAD`：无输出。
7. 收尾：
   - 回填 Progress 和 Outcomes。
   - `docs/README.md` 加索引行；按协调者分配的编号写入 TD 行。
   - 按 `docs/review/README.md` 开 draft PR，描述包含闭环、ExecPlan 与 Batch、`Closes #352`、真实验证证据、风险和回滚。
   - 按 `AGENTS.md` §6 整理提交并回读远端。

**回滚**：文档提交单独 revert；整 PR revert 后恢复手写 descriptor。没有数据、迁移或 wire 变化，回滚无代价。

### Batch 4 · 并入 #374：分发先于 guard 拒绝非 unary 名字（先红后绿，D17、D18）

**最小闭环**：`dispatchOf` 对 stream 名字、未声明名字与原型链键抛固定文案 `TypeError`，不进 `guard`、不碰 handler；同时记录 `baseline` 去留（D19）。
**涉及文件**：`apps/harness-plugin/src/host-operations.ts`（`dispatchOf`）、`tests/contract/harness-host-operations.test.js`。

1. 先写红灯测试：计数 `guard` 与 handler，对 `watch`、一个金丝雀名字、`toString`、`constructor`、`hasOwnProperty`、`__proto__` 各调一次 `dispatch`，断言都以同一条 `TypeError` 拒绝、文案不含金丝雀名字，且 `calls` 为空；再调一次 `baseline` 作对照。
2. 在 `dispatchOf` 的 `parseInput` 之前加一行 `operations[name]?.mode !== 'unary'` 的检查（D18）。
3. 逐个变异（见 Validation and Acceptance「并入 #374」），每次之后还原。
4. 提交 `fix(apps): Host 分发在 guard 之前拒绝 stream 名字与未声明名字`（`Closes #374`）。

**验证**：六文件命令（见 Batch 2 验证）期望 `ℹ tests 30`、`ℹ pass 30`、`ℹ fail 0`；`pnpm run typecheck` 退出码 0。
**回滚**：revert 这个提交；`baseline` 的去留只是一条记录，没有代码。

## Validation and Acceptance

| # | 验收项（#352） | 判定证据 |
|---|---|---|
| AC1 | 三个操作各声明一次，生成的 descriptor 与今天深等 | `tests/contract/harness-host-operations.test.js`「generated descriptors are deep-equal…」：Batch 1 在 base 上先绿，Batch 2 后仍绿；`harness-host-remote-adapter.test.js` 字节不变且全绿（Batch 2 的 `git diff --exit-code`）；M1–M3 被杀 |
| AC2 | `remote.ts` 与 `host-composition.ts` 共用一套 wire 校验，没有重复定义 | Batch 2 的 grep 恰好 4 行，全在 `host-operations.ts`（issue 允许以评审证据判定）；金样用例的 codec `parse` 同一性断言；M6、M9 被杀，证明服务层与组合层都经过这套校验 |
| AC3 | 一条声明加入的夹具操作同时出现在 Host 分发与客户端代理上 | 同一文件「one declaration adds an operation to the descriptors, the Host dispatch and the client proxy」；M4、M5、M8、M10 被杀；C1–C5 证明代理类型与 handler 表都由声明派生 |
| AC4 | `pnpm verify`、`boundaries` 通过，`pack:plugin` 之后安装件测试仍通过 | Batch 3 步骤 3–5 的输出，root 下的两条已知失败按步骤 3 的方法区分 |

**独立验收回读**（2026-10-21，在检出 `chore/host-operation-registry` 的工作树根目录、root 容器内运行；代码 head `17e0ab1`；AC4 里的 `pnpm install`、两条非 root 复跑与安装件取自 `ba2fab3`，两者之间只改了 `tests/contract/harness-host-operations.test.js`）：

| # | 结论 | 证据 |
|---|---|---|
| AC1 | 满足 | 六文件命令 `ℹ pass 29`、`ℹ fail 0`。与金样无关的对照：把 `git show origin/main:apps/harness-plugin/src/remote.ts` 取到仓库外，和 HEAD 的 `remote.ts` 并排导入，`HOST_REMOTE`、`CLIENT_REMOTE` 递归比较键序、冻结性和值（函数换成函数种类与 `length`），`JSON.stringify` 也相同；8 个 codec 函数（参数 parse、结果 parse 与 encode）在 31 个输入上只在 `actorRef` 处不同（R3：列出全部未知键、去掉值为 `undefined` 的 `id` 键）；live service 的键序、函数种类、位置参数、`composition.call` 收到的记录、在途排空、流的 `AbortSignal.any` 与卸载中止、注册失败回滚都相同，只有 `bootstrapWorkspace.length` 是 0 对 2（D9） |
| AC2 | 满足 | 计划 grep 恰好 4 行，全在 `host-operations.ts`；`grep -rn "必须是普通对象\|含未知字段\|必须是非空字符串" apps/` 只命中 `host-operations.ts`。组合层对照：临时 `git checkout origin/main -- apps/harness-plugin/src/{host-composition,remote,host-surface}.ts`，与 HEAD 各对空数据根的 `host.call` 跑同一组 23 个输入：声明过的名字下，结果、固定中文文案和诊断日志增量（0，即没有进 `guarded`）逐条相同；随后 `git checkout HEAD -- …` 还原，`git status --short` 为空 |
| AC3 | 满足 | 夹具用例；`RemoteNamespace` 类型探针（临时文件，`tsc` 后删除）按 PR B（#229）计划的用法调用 `watch(signal)`、`baseline()`、`bootstrapWorkspace(actor, key)`、`$stream`、`slots.register`、`effect`，退出码 0，两处 `@ts-expect-error`（`idempotencyKey` 传数字、`baseline` 带参数）都成立 |
| AC4 | 满足 | `pnpm install --frozen-lockfile` 退出码 0；`pnpm run typecheck` 退出码 0；`pnpm run test` `ℹ tests 1698`、`ℹ pass 1696`、`ℹ fail 2`，恰好两条已知 root 用例，非 root 下 `development-local-git.test.js` 73/73、`run-test-layer.test.js` 17/17；`pnpm run test:mvp0` 7/7；`pnpm run boundaries` 9/9；`pack:plugin` 退出码 0，`harness-plugin-artifact.test.js` 23/23，删 `dist` 后 `delivery-lineage.test.js` 36/36 |

变异（`node scripts/review-mutate.mjs <spec>`，spec 放在仓库外，命令为六文件命令，按字节还原）：A1–A6 descriptor 形状（去 `cancellation`、调换声明顺序、改 wire 名、Client 拿副本数组、结果 codec 去 `encode`、改 typeSymbol 分隔符）；B1–B4 校验（服务层不经 `inputOfArguments`、放行未知键、actor 写出 `undefined` 的 `id`、只报第一个未知键）；C1–C5 派生（遍历 `OPERATIONS`、注册 `HOST_REMOTE`、跳过 `parseInput`、丢掉装配、handler 拿原始记录）；D1 `parseInput` 移进 `guard`；E1–E5 live service（流只传调用方 signal、unary 不 `beginCall`、不 `await`、参数位置反转、流帧不 `toJson`）；F1 `call` 不查 `closed`。`ba2fab3` 上 21/22 被杀，C5 存活；补测试后 `17e0ab1` 上 22/22 被杀。

**并入 #374**（2026-10-21，实现提交 `542475c`，root 容器；变异由手工替换后按字节还原，命令为六文件命令，基线 `ℹ pass 30`、`ℹ fail 0`）：

| # | #374 验收项 | 判定证据 |
|---|---|---|
| T1 | `call` 对 stream 名字与未声明名字都抛固定文案，且不追加诊断日志；去掉检查则测试变红 | `tests/contract/harness-host-operations.test.js`「dispatch rejects stream and undeclared names…」：计数 `guard` 与 handler，`watch`、金丝雀名字、`toString`、`constructor`、`hasOwnProperty`、`__proto__` 都以同一条 `TypeError` 拒绝、文案不含金丝雀名字、`guard` 与 handler 零次调用（`guarded` 是 `operationFailed` 诊断的唯一写入口，所以零次调用就是零行日志）。红灯：实现前该用例 `ℹ fail 1`，`watch` 进了 `guard`（`TypeError: table[name] is not a function` 在 `guard` 之内抛出）。临时的端到端核对（不入库）：空数据根的真实 `createHostComposition` 上，`call('watch')`、`call('nope')`、`call('toString')` 都得到该固定文案，数据目录里没有 `diagnostics.log` |
| T2 | 记录 unary `baseline` 的去留；仅在删除时才改金样 | D19：保留，金样与 `HANDLERS` 不动 |

变异 I1–I7：I1 删掉检查 → `fail 1`（新用例）；I2 只拒 stream（`=== 'stream'`）→ `fail 1`；I3 只拒未声明（`=== undefined`）→ `fail 1`；I4 文案回显调用方名字 → `fail 1`；I5 把检查挪进 `guard` → `fail 2`（新用例、roundtrip「host composition rejects malformed input…」）；I6 改成 `!(name in operations) || mode === 'stream'`（原型链键 `toString` 放行）→ `fail 1`；I7 文案换成别的字 → `fail 1`。七处全部被杀。

## Progress

- [x] 2026-10-21 设计评审完成：两份提案已对照代码复核，并在仓库外的 main 副本上做了评审原型。结果：`tsc` 退出码 0；Host 六文件 29/29；boundaries 9/9；安装件 23/23；`pnpm run test` 只剩两条已知的 root 失败，外加一条 `tests/contract/issue-policy.test.js` 的 CLI 用例因原型副本不是 git 仓库而失败（与本设计无关）；MVP-0 7/7；M1–M10、C1–C5 全部符合预期。
- [x] 2026-10-21 Batch 1 · 钉住现状 descriptor：新增 `tests/contract/harness-host-operations.test.js`，字面量金样（`shape` 把 codec 函数换成 `typeof`）加 `CLIENT_REMOTE.descriptors === HOST_REMOTE.invocations` 同一性。在 base 上 `node --test tests/contract/harness-host-operations.test.js` 为 `ℹ pass 1`、`ℹ fail 0`、退出码 0。判别性自检（每次一处临时改动，之后 `git checkout -- apps/harness-plugin/src/remote.ts`，并确认与 HEAD 一致）：M0 删除 `watchDescriptor` 的 `cancellation` 行 → `ℹ fail 1`、退出码 1，差异指向 `cancellation`；M0' `idempotencyKey` 的 wire 名改为 `idempotency_key` → `ℹ fail 1`；M0'' unary 描述符加 `mode: undefined` → `ℹ fail 1`，差异指向 `mode`。同批 `pnpm run typecheck` 退出码 0 且无 `error TS`；`harness-host-remote-adapter.test.js` 4/4；`pnpm run boundaries` 9/9。
- [x] 2026-10-21 Batch 2 · 每个操作只声明一次：先红后绿。**红灯**：先在 `tests/contract/harness-host-operations.test.js` 追加断言（`Object.keys(OPERATIONS)`、冻结、`parse` 同一性、actor 规整）和夹具用例，`node --test tests/contract/harness-host-operations.test.js` 退出码 1，`ℹ pass 0`、`ℹ fail 1`，输出含 `ERR_MODULE_NOT_FOUND` 与 `host-operations.ts`。**绿灯**：新增 `host-operations.ts`（零 import），改 `remote.ts`、`host-composition.ts`、`host-surface.ts`；六文件命令 `ℹ tests 29`、`ℹ pass 29`、`ℹ fail 0`；`pnpm run typecheck` 退出码 0、无 `error TS`；`pnpm run boundaries` `ℹ pass 9`、`ℹ fail 0`；计划的 grep 恰好 4 行，全部在 `host-operations.ts`；`git diff --exit-code origin/main -- client.ts host.ts workspace-watch.ts harness-host-remote-adapter.test.js tests/integration` 退出码 0。生成的 service：`baseline`、`bootstrapWorkspace` 的 `length` 为 0，`watch` 为 `AsyncGeneratorFunction` 且 `length` 为 1（D9）。**运行期变异**（每次一处，之后 `git checkout -- <file>` 还原，六文件命令）：M1 → `fail 2`（金样、adapter 首条）；M2 → `fail 2`（金样、夹具）；M3 → `fail 1`（金样）；M4 → `fail 1`（夹具）；M5 → `fail 1`（夹具）；M6 → `fail 1`（adapter「validates through the strict parser…」）；M7 → `fail 1`（roundtrip）；M8 → `fail 2`（夹具、roundtrip）；M9 → `fail 3`（夹具、adapter、roundtrip）；M10 → `fail 11`（夹具、providers、watch 等一整片）。补充 M11a 去掉表的 `Object.freeze`、M11b 去掉每个操作的 `Object.freeze` → 各 `fail 1`（金样）；M12 `actorRef` 原样返回记录 → `fail 2`（金样、roundtrip）；M13 `exactRecord` 只报第一个未知键 → `fail 1`（夹具）；M14 `actorRef` 总写出 `id` 键 → `fail 1`（金样）。M13、M14 在既有五个测试文件上存活（`pass 27`、`fail 0`），见 Surprises。**编译期探针**（`tsc --noEmit`，每次一处，之后还原）：C1 → `host-composition.ts` TS2741；C2 → `host-composition.ts` TS2353；C3 → `host.ts` TS2345；C4 → `host-composition.ts` TS2741；C5 → `host.ts` TS2345 与 `workspace-watch.ts` TS2339。另试了两处：流声明带业务参数 → `host-operations.ts` TS2322；handler 把 `input` 当字符串传给 `bootstrapWorkspace` → `host-composition.ts` TS2345。
- [x] 2026-10-21 Batch 3 · 全量门、安装件与收尾（在 Batch 2 提交 eb09676 的 head 上取证，root 容器）：`rm -rf apps/harness-plugin/dist`（本就不存在）；`pnpm install --frozen-lockfile` 退出码 0，`git status --short` 不变；`pnpm run typecheck` 退出码 0；`pnpm run test` 为 `ℹ tests 1698`、`ℹ pass 1696`、`ℹ fail 2`，失败恰好是两条已知的 root 用例：`tests/integration/development-local-git.test.js`「拒绝：占用路径、被别处检出的分支与不可访问的目录都不伪造成功」与 `tests/contract/run-test-layer.test.js`「真实层 tests/integration：非空、全绿，且摘要行被透传」。区分：以非 root 用户（PATH 上有 Node 26）运行前者所在文件为 `ℹ tests 73`、`ℹ pass 73`、`ℹ fail 0`；运行后者所在文件为 `ℹ tests 17`、`ℹ pass 17`、`ℹ fail 0`。`pnpm run test:mvp0` 为 `ℹ pass 7`、`ℹ fail 0`；`pnpm run boundaries` 为 `ℹ pass 9`、`ℹ fail 0`。`pnpm --filter @harness-projects/app-harness-plugin run pack:plugin` 退出码 0，`node --test tests/integration/harness-plugin-artifact.test.js` 为 `ℹ tests 23`、`ℹ pass 23`、`ℹ fail 0`；随后 `rm -rf apps/harness-plugin/dist`，`node --test tests/e2e/delivery-lineage.test.js` 为 `ℹ pass 36`、`ℹ fail 0`。`node scripts/workflow-check.mjs` 无发现；`node scripts/rule-checks.mjs size origin/main` 代码 451 / 1000、文档 285 / 1500；`node scripts/rule-checks.mjs disclosure origin/main` 通过；`git diff --check origin/main...HEAD` 无输出；`git diff --exit-code origin/main -- client.ts host.ts workspace-watch.ts harness-host-remote-adapter.test.js tests/integration` 退出码 0。TD-069 已登记（`docs/exec-plan/tech-debt-tracker.md`）；`docs/README.md` 的索引行在设计提交里已有，实现者没有再改它。开 PR、整理提交与回读远端由协调者按 `AGENTS.md` §6 执行。
- [x] 2026-10-21 独立验收完成：AC1–AC4 逐项回读并补了与金样无关的对照（见 Validation and Acceptance「独立验收回读」）；变异 C5 存活，补一条直接分发的断言后 22/22 被杀（`17e0ab1`，只改测试）；网关源码复核见 Surprises；没有 P0 / P1。
- [x] 2026-10-21 Batch 4 · 并入 #374（人类伙伴决定，D17）：先写红灯用例（`ℹ fail 1`，`watch` 进了 `guard`），再在 `dispatchOf` 的 `parseInput` 之前加 `operations[name]?.mode !== 'unary'` 一行检查与固定文案常量；六文件命令 `ℹ tests 30`、`ℹ pass 30`、`ℹ fail 0`；`pnpm run typecheck` 退出码 0；变异 I1–I7 全部被杀（见 Validation and Acceptance「并入 #374」）；`baseline` 去留裁定为保留（D19）。提交 `542475c`（`Closes #374`）。
- [x] 2026-10-21 人类评审决定（D20）：人类伙伴对 D3–D5、D19 与 TD-069 的答复是「由你调研相关类似实现后综合判断」；评审会话调研同类 RPC 系统后确认 D3–D5 与 D19，并把 TD-069 移入 Resolved。
- [x] 2026-10-21 MMP 评审（评审账号，review `5595756125`，APPROVE，只有 P3）后的修复（D21）：`dispatchOf` 先判名字是字符串；`Param` 注释写明 `parse` 必须幂等；金样断言 descriptor 数组冻结；Bottom Change Note 补整理前提交号的对应。`tsc` 退出码 0，Host 与插件测试 55/55；变异 N1（descriptor 不冻结）、F1a（去掉字符串判定）、I1（去掉 unary 判定）KILLED。F1b（handler 改按调用方名字查表）在字符串判定之后是等价变异，未加代码。评审记录见 `docs/review/pr-370-mmp-review.md`。
- [x] 2026-10-21 归档：本计划移入 `docs/exec-plan/completed/`，`docs/README.md` 索引改为 Completed；提交整合为 plan → test → refactor → fix → 回填归档，变基到含 #348 的 main。

## Surprises & Discoveries

- 2026-10-21：两套校验在两处行为不一致（见 Context and Orientation）。统一以后，只有服务层的多未知键报错文案会变（R3）。
- 2026-10-21：`pnpm verify` 是 `typecheck && test && test:mvp0`。root 下 `test` 一失败，MVP-0 就不会运行，所以 Batch 3 要单独跑它。
- 2026-10-21：执行 `pack:plugin` 后残留的 `apps/harness-plugin/dist` 会让 `tests/e2e/delivery-lineage.test.js` 变红。这个问题与本改动无关，由 #350 跟踪真正的修复。
- 2026-10-21：仓库里没有任何测试或源码读取 service 方法的 `Function.length`：`grep -rn "\.length" apps/harness-plugin/src tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-*.test.js` 的命中全是数组或字符串。
- 2026-10-21（Batch 1）：金样用例的名字沿用计划原文「generated descriptors are deep-equal…」，但 Batch 1 时 descriptor 仍是手写。名字保留，使 AC1 的引用与 Batch 2 的追加断言一致。
- 2026-10-21（Batch 2）：计划的 M1–M10 和既有五个测试文件都不区分 R3 里统一后的校验行为。把 `exactRecord` 改成只报第一个未知键（M13），或让 `actorRef` 总写出值为 `undefined` 的 `id` 键（M14），既有五文件仍是 `ℹ pass 27`、`ℹ fail 0`，因为它们只匹配 `/未知字段/`，也不断言规整后的形状。所以在测试文件里补了两条断言（见 D13），M13、M14 随之被杀。
- 2026-10-21（Batch 2）：计划 Interfaces 里 `UnaryHandlers` 的写法 `{ readonly [K in UnaryName<O>]: … InputOf<O[K]> }` 在 `tsc` 下可以直接通过，不需要用 `as` 重映射键来绕开 `O[K]` 的约束；`RemoteNamespace` 的 unary 半边同理。实际代码照计划写法。
- 2026-10-21（独立验收）：网关源码复核（`npm pack` 取得宿主 0.2.0-rc.2 与 0.2.1-rc.2 的 `@deepseek-ai/dsh-api-gateway`，只读不执行）。注册了 strict 描述符时，`resolveDescriptor` 直接返回它（0.2.0-rc.2 `lib/index.js:998`；0.2.1-rc.2 `:1224`）；`prepareInvocation` 按 `descriptor.parameters` 解出位置参数，只有带 `cancellation` 时才追加 signal（`:984`；`:1210`）；unary 与 stream 都用 `Reflect.apply(method, receiver, args)` 调用（`:732`、`:760`；`:921`、`:949`）。这条路径不读 `Function.length`，也不读函数源码。只有从未注册过 strict 描述符时才走 SRC 回退：`methodParameterNames`（`:1467`；`:1715`）用 `Function.prototype.toString` 解析形参，而且要求原型方法带 Remote 标记，本插件不会走到这里。`@deepseek-ai/dsh-typert-registry@0.2.0-rc.2` 也不读。所以 R1、D9、TD-069 剩下的只是「本构建还没在 Desktop 上调用过」这一个通用缺口。
- 2026-10-21（独立验收）：变异 C5 在 `ba2fab3` 的六个测试文件上存活。C5 让 `dispatchOf` 照常校验，但把调用方的原始记录交给 handler。原因有两个：夹具的 parse 是恒等的；服务层在调用组合层之前已经规整过一次。已补测试，见 D14。生产代码上 C5 也观察不到，因为组合层唯一的调用方就是生成的服务方法。
- 2026-10-21（独立验收）：组合层对未声明名字的行为和 main 不同。类型上 `call` 只接受 unary 名字，唯一调用方是 `remote.ts` 生成的 unary 方法，wire 上到不了这里。具体差异：`host.call('watch', {})` 在 main 上是 `guarded` 之外的 TypeError，现在会进入 `guarded`，写一行 `operationFailed` 诊断并返回固定文案；`host.call('toString', {})` 在 main 上会把 `Object.prototype.toString` 当 handler 调用，返回 `"[object Object]"`，现在在 `guarded` 之外抛 TypeError；其它未知名字的 TypeError 原文也变了。验收当时列为 P3 后续（D16），人类伙伴随后决定并入本 PR 修复，见 D17、D18。
- 2026-10-21（独立验收）：`git merge-tree --write-tree HEAD feature/workspace-binding-commands` 预演时，`docs/exec-plan/tech-debt-tracker.md` 有文本冲突：#371 的 TD-070、TD-071 和本 PR 的 TD-069 追加在同一位置，后合者两边的行都保留即可。和 `feature/plugin-work-item-pages`（PR B）预演无冲突。

## Decision Log

| # | 日期 / 作者 | 决策 | 依据与取舍 |
|---|---|---|---|
| D1 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | 每个操作保留自己的 descriptor，由声明派生，不改成单一命令信封 | 有四条依据。① ADR-0013 Decision 2 让每个操作的 strict codec 在 Core 之前拒绝坏输入，而 issue 把「改变 strict typed-remote 契约」列为范围外。② 唯一的真实 Desktop 证据（`POST /api/harnessProjects/baseline` 的 401/403/404）以方法名为键，正向往返仍欠 #132，换 wire 身份就要重做。③ 信封仍然要为每个操作写一个输入解码器，省不掉校验；`watch` 需要 `mode` 与 `cancellation`，无法共用信封。④ gRPC、tRPC、ts-rest 都在 wire 上保留每个过程的身份，只共享一份契约声明。两份提案在这一点上一致 |
| D2 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | 新模块定为 `apps/harness-plugin/src/host-operations.ts`，零 import，不进 `HOST_ENTRY` | 名字沿用 issue 的「Host remote operation」，和其它 Host 接口文件排在一起；能否 import 由显式名单决定，不看前缀。放弃 `operations.ts`：名字太泛。放弃把声明留在 `remote.ts`：composition 要为校验去 import 生命周期适配器，而且之后每加一个操作，diff 都要穿过承载生命周期与排空的 `remote.ts` |
| D3 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | 声明只有 `mode: 'unary' \| 'stream'`，不写 issue 范围文字里的 `kind: query/command/stream` | wire 只区分 unary 和 stream（H1）。query 与 command 的区分目前没有任何读者。#354 需要知道「哪些命令要触发重组」，那只是命令的一个子集：`bootstrapWorkspace` 不能触发重组，因为重组会丢掉内存里的重放账本（#127 的说明），所以 `command` 标记帮不了它。#335 只需要 Controller。第一个读者出现时再加。这是对范围文字的有意收窄，验收项不受影响 |
| D4 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | 输出 codec 只有一个 `jsonOutput`，由派生统一挂上；声明里不写逐操作的输出 codec | 网关对 unary 结果只调用 `encode`，对流项不调用任何 codec（H3、2026-10-14 Surprises），所有结果都是严格 JSON。客户端可达的模块不能 import controller 的 DTO，结果类型只能是 `unknown`。带类型的解码由 #229、#282、#234 在 `packages/client` 的校验器里按需添加 |
| D5 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | 「经一处间接拿到 Core / Controller」的实现：`HANDLERS` 放在模块级，第一个入参是装配（今天就是 `Controller`），`call` 从组合唯一的绑定传入。现在不加 holder、thunk 或 `HostAssembly` 类型 | `HANDLERS` 定义在 `createHostComposition` 之外，无法闭包住任何 Controller。#354 只需把 `dispatch(controller, …)` 的第一个实参换成 holder 的当前值，不用重新登记操作，也不重新 `register`。若它需要 `{ controller, reconciler }`，就把 `UnaryHandlers` 的第二个类型实参换掉并机械改写 handler 体。放弃提案 ind 的 `createDispatch`（`assembly()` thunk、`closed`、泛化的 `stream`）：它要把 `watch` 改名，会碰 `host-watch.test.js`，而且多流的泛化没有消费者 |
| D6 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | Host 侧 `call` 的派生收进 `dispatchOf(operations, handlers, guard)`，作为共享模块里的泛型纯函数 | AC3 要求夹具操作出现在「Host 分发」上。提案 min 用一个假组合，只能观察到 remote 把调用转给 `composition.call`，碰不到派生出来的分发。`dispatchOf` 让夹具走生产代码同一段分发，代价约 8 行。M8、M10 可以证明这一点 |
| D7 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | 夹具经 `installHostRemote` 可选的第三个参数 `remote` 注入，缺省为 `defineRemote(OPERATIONS)` | 注册的是 `remote.host` 本身，生产注册的对象和 `CLIENT_REMOTE` 共享同一批 descriptor。`host.ts` 和既有测试的两参调用都不用改。放弃提案 ind 的 `operations` 参数：它需要按身份判断再重新派生 |
| D8 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | stream 操作以成员方式调用组合上同名的方法，并且在类型上不允许业务参数 | 加第二条流而组合上没有同名成员时，`host.ts` 会报 TS2345（C3），属于编译期 fail closed。这样就去掉了提案 min 的 R2：第二条流会被静默接到 `watch` 上 |
| D9 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | 接受生成的 unary 方法 `length === 0`，不加 `Object.defineProperty` 补丁；stream 方法保持 `async function* (signal)`，`length` 为 1，函数种类也不变 | 仓库里没有任何代码读取 `Function.length`（Surprises 2026-10-21）。网关按 descriptor 的 `parameters` 解码，再按位置调用，只在带 `cancellation` 时追加 signal（H2、H4、H10）。2026-10-15 用真实 registry 和网关做的探针，也是按这一语义驱动 `service.watch` 的。补丁属于为一个没有观测到的依赖写的投机代码，所以改为登记 TD，在下一次真实 Desktop S3 上观测。2026-10-21 独立验收以网关源码佐证了本条（Surprises & Discoveries 同日「独立验收」条目） |
| D10 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | 三层校验都保留（网关 codec、服务层、组合层），共用同一函数；行为统一为列出全部未知键并规整 actor | adapter 测试用桩组合钉住了服务层，roundtrip 测试直接调用 `host.call` 钉住了组合层。把校验集中在一处，既有钉子就不必改；而共用同一函数后，几层之间不会再漂移 |
| D11 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | AC2 用 grep 作为评审证据，加上 codec 同一性断言；不写读源码文本的测试；新测试放进新文件，既有 adapter 测试保持字节不变 | issue 写明可以用「grep 或评审证据」。2026-10-14 的评审删过一条没有行为判别力的源码文本断言（`2026-10-13-harness-host-composition` Surprises）。旧测试原样通过，是 AC1 更强的证据 |
| D12 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | 不修改 ADR-0013 | Decision 2 仍然成立。Why 段的「手写」指的是没有 Typert 生成器，现在依旧如此：声明是手写的，descriptor 对象在仓库内派生 |
| D13 | 2026-10-21 / 实现者（Claude Sonnet 5.5） | `defineOperations` 返回的表和其中每个操作都 `Object.freeze`；金样用例追加「actor 规整为 `{ kind }`」断言，夹具用例追加「一次列出全部未知键」断言 | `descriptors` 在 `defineRemote` 时一次性派生，而 `dispatchOf`、`installHostRemote` 在调用时读 `operations`；表若可变，两者会漂移，所以和 descriptor 数组一样冻结，M11a、M11b 证明有测试守着。两条断言对应 R3 的统一行为，是计划的 M1–M10 与既有测试都没有守住的（Surprises 2026-10-21 Batch 2），M13、M14 证明它们有判别力。两处都没有新增接口，只多几行测试 |
| D14 | 2026-10-21 / 独立验收（Claude Opus） | 补一条判别性断言，不改生产代码：夹具 parse 改为去首尾空白，再绕过服务层直接 `dispatch` 一次 `{ word: ' hey ' }`，断言 handler 收到 `{ word: 'hey' }` | 这正是 C5 要守的性质：Host 分发交给 handler 的是 parse 的结果，不是调用方的原始记录。原测试注释写了这一点，但没有判别证据（Surprises 同日条目）。改动只在本 PR 的测试文件里，也不新增接口 |
| D15 | 2026-10-21 / 独立验收（Claude Opus） | 范围收窄（D3 不写 `kind`、D4 只有一个输出 codec、D5 用装配实参代替 holder）判为不影响 AC1–AC4，也不妨碍下游；TD-069 保持 Open，只在原处补源码证据，是否关闭由人类决定 | 四条验收都没有要求 `kind` 或逐操作输出 codec；逐操作输出 codec 若改了 typeSymbol，反而会违反 AC1。#354 只需把 `dispatch` 的第一个实参换成 holder 的当前值，必要时再换 `UnaryHandlers` 的装配类型，不用重新登记操作，也不用重新 `register`。#335 的 `refreshPlanning` 由 Controller 暴露（`packages/controller/src/commands.ts` 的 `ControllerCommands.refreshPlanning`），handler 只需要 Controller。范围文字的收窄仍请人类在评审中确认（PR 描述已标出）。TD-069 方面，源码证据覆盖了 strict 路径，但这一构建确实还没在 Desktop 上调用过；关闭一条债务属于评审时的裁定 |
| D16 | 2026-10-21 / 独立验收（Claude Opus） | `dispatchOf` 对未声明名字与 stream 名字的处理，验收时判为 P3，不在验收中修；**已被 D17 取代，在本 PR 内修复（D18）** | 类型上和 wire 上都到不了这条路径（Surprises 同日条目）。修复需要一条新的固定文案，是新行为，但它在 `guarded` 之外、wire 与 descriptor 不变，所以不违反「wire 逐项不变」 |
| D17 | 2026-10-21 / 人类伙伴（经协调者转达） | P2/P3 后续不另建 issue 往后放，而是在原 PR 内实现并 link 对应 issue；弹性 800 行可超（CI 硬限 1000 行代码 / 1500 行文档不变）。原话：「这些 P2/P3 不应该你自己修复吗？超过弹性 800 行没有关系。但在实现前你应该自己想一想有没有办法简化改动呀。怎么什么小问题都建 issue 呢？请你在现有 PR 中实现并 link 对应 issue」 | 对 #374 取代 #351 演示窗口规则 D2（P3 → M4.1 issue）：#374 并入本 PR，提交 `Closes #374`，PR 描述同写 `Closes #374`。实现前先问「能否删减或收窄而不是增加」，结论写进各自的决策条目（D18、D19） |
| D18 | 2026-10-21 / 实现者（Claude Sonnet 5.5） | `dispatchOf` 在 `parseInput` 之前加一行 `operations[name]?.mode !== 'unary'` 检查，抛固定文案 `操作名 必须是已声明的 unary 操作`；测试用计数 `guard` 与 handler，不造诊断日志文件 | 备选：① 在 `host-composition.ts` 的 `call` 里查（每个新调用点都要重复，而 `dispatchOf` 才是唯一接缝）；② 加 `Object.hasOwn` 加 `mode` 双重检查（`toString` 等原型链键本来就没有 `mode`，多一道只会留下等价变异）；③ 在 roundtrip 测试里断言 `diagnostics.log` 不存在（既有集成测试按 Global Constraints 字节不变）。取一行加一个常量：stream 名字、未声明名字、原型链键由同一条检查拦住，文案不回显名字。issue 的「诊断日志零增量」由 `guarded` 是唯一写入口加零次调用来判定，另用空数据根的真实组合做了一次端到端核对（Validation and Acceptance T1） |
| D19 | 2026-10-21 / 实现者（Claude Sonnet 5.5） | 保留 unary `baseline`：#372 之后客户端不再调用它，但声明、`HANDLERS.baseline` 与 descriptor 金样都不动 | 备选是删除（声明、handler、金样、`RemoteNamespace` 的 `baseline` 一并改）。保留的理由：① #352 验收 1 钉的就是今天的三个 descriptor，`baseline` 在内；② Host 的 roundtrip、providers、runtime-adapter 与 adapter 测试都以 `host.call('baseline')` / `service.baseline()` 为规范读口，删除要重写它们；③ #354 验收 1 用「下一次 `baseline`」判定重组生效，Host 层需要一条同步读；④ 唯一的真实 Desktop 证据（`POST /api/harnessProjects/baseline`）以方法名为键（D1 ②），删除等于放弃它。保留的成本只有一条声明和一个 handler。重访条件：#354 与 #229 合并后，若没有任何客户端或测试再调用它，再用一个提交删掉声明、handler 与金样条目 |
| D20 | 2026-10-21 / 评审会话（Claude Opus），按人类授权调研后决定；人类可推翻 | 确认 D3（只有 `mode`，不写 `kind`）、D4（所有输出共用一个 JSON 输出 codec）、D5（装配是 Controller）与 D19（保留 `baseline`）；TD-069 移入 Resolved，不加 `Object.defineProperty` | 人类伙伴原话（2026-10-21，评审会话中直接问）：「由你调研相关类似实现后综合判断」。依据见下方「调研依据（D20）」。D5 补一句：Core 经 Controller 可达，满足 issue 的 indirection 意图，且不绕过命令信封与幂等。D19 的理由改为内部读者：Host 的同步读口、#354 用它判定重组、Host 测试按方法名驱动；「客户端不再调用 `baseline`」只在 #372 合入后成立，本 PR 单独合入时 `client.ts` 仍调用它。TD-069：宿主网关按 descriptor 的 `parameters` 位置 `Reflect.apply`，不读 `Function.length`；同类系统同样不读 arity；剩下的是通用的真实宿主复测缺口，由 #143 的演示彩排覆盖（R1 #73），触发条件是宿主升级或 S3 失败 |
| D21 | 2026-10-21 / 评审会话（Claude Opus） | MMP 评审的四条 P3 在本 PR 内修，不另开 issue | ① `dispatchOf` 先判 `typeof name === 'string'`：非字符串的值每次转成属性键都可能不同，名字检查与 handler 查表会看到不同的名字，`['baseline']` 也会被当成 `baseline`；类型上与 wire 上都到不了，但这是 #374 修复留下的缺口。没有改成按 `operation.name` 查表：字符串判定之后两者等价，变异测不到。② `Param` 注释写明 `parse` 必须幂等：同一个值会依次经网关 codec、`inputOfArguments` 与 Host 侧 `parseInput` 各解析一次。③ 金样断言 `HOST_REMOTE.invocations` 冻结：它是 Host 与客户端共用的同一个数组。④ Bottom Change Note 补整理前的 `eb09676` |

### 调研依据（D20）

| 系统 | 区分 query / command | 逐操作输出校验 | 依赖函数 arity |
|---|---|---|---|
| tRPC | 区分（query / mutation / subscription，决定 HTTP 方法与缓存） | 可选 `.output()`，官方定位是不可信数据或限制暴露字段 | 否 |
| gRPC / protobuf | 不区分；可选 `idempotency_level`；流靠 `stream` 关键字 | 静态 schema | 否 |
| VS Code extension host RPC | 不区分（`$getCommands` 与 `$executeCommand` 同接口） | 否，只序列化 | 否（`method.apply`，末位 CancellationToken 单独识别） |
| Electron `ipcMain.handle` / `contextBridge`、Comlink、JSON-RPC 2.0、Cap'n Proto | 不区分（JSON-RPC 只按有无 id 分 request / notification） | 否或靠静态 schema | 否 |

结论：只有传输层真有读者时才带 query / command 标记，本仓库是单一传输，descriptor 没有这个字段；以后重试真需要时，照 protobuf 加一个可选的幂等字段，不引入三选一的 `kind`。输出由 Host 自己产生，`jsonValue` 已强制严格 JSON；逐操作的结果校验归 `packages/client` 的解码器，而且改 `typeSymbol` 会违反 AC1。来源：https://trpc.io/docs/server/procedures 、https://trpc.io/docs/server/validators 、https://grpc.io/docs/what-is-grpc/core-concepts/ 、https://google.aip.dev/136 、https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/services/extensions/common/rpcProtocol.ts 、https://www.electronjs.org/docs/latest/api/ipc-main 、https://www.jsonrpc.org/specification 、https://capnproto.org/rpc.html 。

## Idempotence and Recovery

- 所有验证命令都只读，可以重复执行。`pack:plugin` 会生成 `apps/harness-plugin/dist`，每次运行后都要 `rm -rf apps/harness-plugin/dist`。
- 变异和探针都是临时改动，每次结束必须用 `git checkout -- <file>` 还原，并确认 `git status --short` 只剩本批预期的改动。
- 整理已推送的历史之前，先建 backup ref（`git branch backup/host-operation-registry-<yyyymmddhhmm>`），再用精确的 `--force-with-lease=<branch>:<old-sha>` 推送（`AGENTS.md` §6）。
- 已知良好状态：Batch 1 的提交（只有测试，对手写实现也是绿的），或者 `origin/main`。

## Interfaces and Dependencies

`apps/harness-plugin/src/host-operations.ts`（#354、#335、#142 等加操作时依赖这些签名；`ENVELOPE` 不导出，命令在本文件内展开它或取 `ENVELOPE[0]`）：

```ts
export function plainRecord(value: unknown, label: string): Record<string, unknown>
export function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> // 列出全部未知键
export function nonEmptyString(value: unknown, label: string): string
export interface ActorRefWire { readonly kind: string; readonly id?: string }
export interface Param<N extends string = string, T = unknown> { readonly name: N; readonly type: string; readonly parse: (value: unknown) => T }
type Body = { readonly mode: 'unary'; readonly params: readonly Param[] } | { readonly mode: 'stream'; readonly params: readonly [] }
export type Operation<N extends string = string, B extends Body = Body> = B & { readonly name: N }
export type Operations = Readonly<Record<string, Operation>>
export const param: <N extends string, T>(name: N, type: string, parse: (value: unknown) => T) => Param<N, T>
export function defineOperations<const T extends Record<string, Body>>(bodies: T): { readonly [K in keyof T & string]: Operation<K, T[K]> }
export const OPERATIONS // baseline、bootstrapWorkspace（params = ENVELOPE）、watch（stream），顺序固定
export type UnaryName<O extends Operations>; export type StreamName<O extends Operations>
export type ArgsOf<P extends readonly Param[]>; export type InputOf<O extends Operation>
export type UnaryHandlers<O extends Operations, A> = { readonly [K in UnaryName<O>]: (assembly: A, input: InputOf<O[K]>) => Promise<unknown> }
export function inputOfArguments(operation: Operation, args: readonly unknown[]): Record<string, unknown>
export function parseInput(operation: Operation, input: unknown): Record<string, unknown> // label = operation.name
export function dispatchOf<O extends Operations, A>(operations: O, handlers: UnaryHandlers<O, A>,
  guard: <T>(run: () => Promise<T>) => Promise<T>): (assembly: A, name: UnaryName<O>, input: unknown) => Promise<unknown>
// 名字不是已声明的 unary 操作（stream 名字、未声明名字、原型链键）：先于 guard 抛固定文案 TypeError（#374）
```

`apps/harness-plugin/src/remote.ts`：已有导出的名字与值不变；变化与新增如下。

```ts
export type HostCompositionCall = { call(name: UnaryName<typeof OPERATIONS>, input: unknown): Promise<unknown> }
  & { readonly [K in StreamName<typeof OPERATIONS>]: (signal: AbortSignal) => AsyncIterable<unknown> }
export function defineRemote<O extends Operations>(operations: O): { operations: O; host: HostRemoteContribution; client: ClientRemoteContribution }
export interface InstalledHostRemote { readonly service: Readonly<Record<string, unknown>>; dispose(): Promise<void> }
export function installHostRemote(ctx: HostRemoteContext, composition: HostCompositionCall,
  remote?: { readonly operations: Operations; readonly host: HostRemoteContribution }): Promise<InstalledHostRemote>
```

`host-composition.ts` 的变化：
- `HostComposition.call(name: UnaryName<typeof OPERATIONS>, input: unknown)`；`watch(signal)` 不变。
- 模块级 `HANDLERS: UnaryHandlers<typeof OPERATIONS, Controller>`。

`host-surface.ts` 的变化：`RemoteNamespace` 改为由 `OPERATIONS` 派生的映射类型，名字和 `baseline`、`watch` 的签名都不变。

**外部依赖**：
- 不新增 npm 依赖。
- 宿主包不进锁文件，网关语义以 H1–H4、H10 的记录为准。
- 不需要凭据，也不需要仓库设置变更。

**建议登记的技术债务**（tracker 当前最大编号是 TD-068，建议用 TD-069，最终编号由协调者在并行 PR 之间分配）：

| 字段 | 内容 |
|---|---|
| 范围 | `apps/harness-plugin/src/remote.ts`、`tests/contract/harness-host-operations.test.js` |
| 问题 | 生成的 unary live service 方法用剩余参数实现，`Function.length` 为 0。AC3 的网关替身按宿主 0.2.0-rc.2 的 H2/H4/H10 手写，CI 运行不了真实网关，本构建也没有在 Desktop 上复测 |
| 触发 | 下一次真实 Desktop S3（#143 演示彩排；#132 已于 2026-10-15 关闭）、宿主升级 |
| 退出 | 在本 PR 之后的构建上各调用一次 `baseline`、`bootstrapWorkspace`、`watch`。如果网关依赖形参个数，就为生成的方法 `Object.defineProperty(fn, 'length', { value: params.length })`，并在金样测试里钉住 `length` |

## Outcomes & Retrospective

2026-10-21（实现者，Batch 2–3）：AC1–AC4 均有证据（见 Progress 与 Validation and Acceptance）。`host-operations.ts` 是 Host 远程操作的唯一声明处，三个操作各声明一次；descriptor、live service、Host `call` 分发与客户端代理类型都由它派生，校验函数只剩一份。加一个 unary 操作现在是一条声明加 `HANDLERS` 的一个条目，漏写或多写 handler、第二条流、流带业务参数都过不了 `tsc`（C1–C5）。wire 逐项不变，既有 adapter 测试字节不变且全绿。

没有做的事：不新增操作；不加 holder（#354）；`Function.length` 登记为 TD-069，等真实 Desktop 复测；`docs/README.md` 与 PR 流程由协调者负责。回顾：计划的变异表没有守住统一后的校验行为，实现时补了两条断言和三个变异（M12–M14、D13）；Interfaces 里 `UnaryHandlers` 的原写法 `tsc` 直接通过，不必改写。剩余：独立验收复读与人类评审。

2026-10-21（独立验收）：结果是 AC1–AC4 都满足，没有 P0 / P1。与 main 的独立对照证实 wire 逐项不变；行为差异只有计划已经写明的三处，即 R3 的未知键文案、actor 规整、生成方法的 `length`，外加 Surprises 记的一处未声明名字的处理。和计划的偏差是补了一条测试（D14），生产代码没动。遗留：TD-069 是否关闭由人类决定；P3 的 `dispatchOf` 名字检查（#374）已并入本 PR（D17、D18）；PR 描述里的验证清单还停在计划提交时的状态，开 ready 前要由协调者更新；`tech-debt-tracker.md` 与 #371 有一处相邻追加的冲突，由后合者合并。

2026-10-21（并入 #374）：按人类伙伴的决定（D17），独立验收列出的 P3 后续没有另开 issue 往后放，而是在本 PR 内用一个提交修复并 `Closes #374`。`dispatchOf` 现在先于 `guard` 拒绝 stream 名字、未声明名字与原型链键，抛固定文案 `TypeError`，不进 `guard`、不写诊断日志、不碰 handler（D18）；判别性用例加七个变异证明检查有判别力。unary `baseline` 保留（D19），金样不变。回顾：简化的方向是「一行检查加一个常量」，没有新增接口或 import；测试用计数 `guard` 代替日志文件，既守住了既有集成测试字节不变，也比读文件更直接。剩余：人类评审确认 D19 与 TD-069。

2026-10-21（MMP 评审与归档）：评审结论是 APPROVE，没有 P0、P1、P2，四条 P3 已在本 PR 内修（D21）；wire 逐项不变由评审在 base 与 head 上并排比较 descriptor、codec 与 live service 再次确认。待人类决定的 D3–D5、D19 与 TD-069 由评审会话按人类授权调研后决定（D20），TD-069 移入 Resolved。第一轮评审时五个开放 PR（#348、#370–#373）的并集上 `pnpm verify` 全绿；整合并变基到含 #348 的 main 之后，本 PR head 上 `pnpm verify` 1700/1700、MVP-0 7/7，`pack:plugin` 后 artifact 23/23。

## Bottom Change Note

- 2026-10-21：设计评审（Claude Opus，独立评审 subagent）创建本计划。合并了两份竞争提案（min：`host-operations.ts`、可注入的 `defineRemote`；ind：`kind`、`createDispatch`、`assembly()`），在 Decision Log 中逐项裁决，并在仓库外的评审原型上复核了全部关键结论。
- 2026-10-21：实现者（Claude Sonnet 5.5）完成 Batch 2–3：回填 Progress、Surprises、Decision Log（D13）与 Outcomes，登记 TD-069。
- 2026-10-21：独立验收（Claude Opus）回填 Validation and Acceptance 的「独立验收回读」、Progress、Surprises（网关源码、C5、未声明名字、tracker 冲突预演）、Decision Log（D14–D16）与 Outcomes；在 R1、D9 原处标注源码佐证；补测试提交 `17e0ab1`。
- 2026-10-21：实现者（Claude Sonnet 5.5）并入 #374（D17）：新增 Batch 4，回填 Validation and Acceptance「并入 #374」、Progress、Surprises（D16 改为已被取代）、Decision Log（D17–D19）、Interfaces 与 Outcomes；实现提交 `542475c`。
- 2026-10-21（协调者）：提交整理为同树重写的可审阅序列（推送前在本地留了备份 ref，用精确 lease 推送）。正文中整理前的提交号已不在分支历史里，对应关系（整理前 → 当前；多个旧提交可能并入同一个）：`eb09676`、`17e0ab1` → `2fb96db`、`ba2fab3` → `9fe08e6`。当前序列在检出 `chore/host-operation-registry` 的工作树根目录用 `git log --oneline origin/main..HEAD` 回读。
- 2026-10-21（评审会话）：MMP 评审后修四条 P3（D21），记录 D20 与调研依据，TD-069 移入 Resolved，计划归档。提交再次整合并变基到含 #348 的 main，提交号全部改变，正文里的提交号以上一条的对应关系为准；整合后各提交的对应：`2fb96db` → 「refactor(apps): 每个 Host 远程操作只声明一次」；`9fe08e6`、`3a75b70` 与本次文档改动 → 「docs(exec-plan): 归档 Host 远程操作单一声明计划…」；`542475c` → 「fix(apps): Host 分发在 guard 之前拒绝…」。
