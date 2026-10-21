# Host 远程操作单一声明 ExecPlan

> 状态：Active
> 创建：2026-10-21
> 范围：issue #352。每个 Host 远程操作只声明一次，由声明派生 descriptor、live service、Host 侧 `call` 分发与客户端代理类型；wire 逐项不变，不新增操作。
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
| Host `call` | `host-composition.ts` | 模块级 `HANDLERS: UnaryHandlers<typeof OPERATIONS, Controller>`；`dispatch = dispatchOf(OPERATIONS, HANDLERS, guarded)`；`call` 先查 `closed` 再 `dispatch(controller, name, input)`：`parseInput` 在 `guarded` 之外（固定文案），handler 在 `guarded` 之内 |
| 代理类型 | `host-surface.ts` | `RemoteNamespace` 改为映射类型：unary `(...ArgsOf) => Promise<RemoteResult<unknown>>`，stream `(signal) => AsyncIterable<unknown>`；名字保留 |

**数据流**：网关 `codec.parse` → `service[name](...args)` → `inputOfArguments` → `composition.call` → `parseInput` → `guarded(handler)` → `encode`。三层校验是同一函数、结果幂等，不再漂移；服务层与组合层各有既有测试钉住，故都保留（D10）。**错误模型不变**：校验失败为固定中文 `TypeError`（`guarded` 之外）；Controller 失败写诊断日志、调用方得到 `OPERATION_FAILED`；关闭得 `已关闭`，卸载得 `已卸载`。

**不变量**：AGENTS.md §1.1-7 Host 拥有权威状态（handler 只透传，结果与 `writeState` 不变）；`Saved` 以 ack 为准不受影响；依赖方向不变（新模块零 import，boundaries 9 条）；LLM 不进入控制路径；ADR-0013 Decision 2（每操作一份 strict descriptor）仍成立。

**放弃**：单一命令信封（D1）；声明留在 `remote.ts`（D2）；只共享校验（不满足 AC1、AC3）；通用 `createDispatch` + `assembly()` thunk + 泛化流（D5）。**刻意不做**：新增操作；query / command 区分（D3）；逐操作输出 codec 或带类型的客户端结果（D4）；holder 与重组（#354）；带参数的流或第二条流；`Function.length` 补丁（D9）；ADR 修改（D12）。

**风险**
- R1（P3）：生成的 unary 方法 `length` 为 0（原 `bootstrapWorkspace` 为 2）；夹具测试的网关替身按 H2/H4/H10 手写；真实网关不在 CI，本构建未在 Desktop 复测。建议登记 TD（见 Interfaces）。
- R2（P3）：名为 `ctx` 或 `typertRemote` 的操作会覆盖 service 的同名键；声明是评审过的常量，只记录、不设防。
- R3（P3）：服务层未知键报错从「只报第一个」变为「列出全部」；现有测试只匹配 `/未知字段/`。
- R4：`InstalledHostRemote.service` 放宽为 `Readonly<Record<string, unknown>>`（唯一消费者是 JS 测试）；`RemoteNamespace.bootstrapWorkspace` 的 `actorRef` 从 `unknown` 收紧为 `ActorRefWire`，B（#229）不调用它。

## Global Constraints

- **写入集合（唯一一处声明）**：新增 `apps/harness-plugin/src/host-operations.ts`、`tests/contract/harness-host-operations.test.js`；修改 `apps/harness-plugin/src/remote.ts`、`host-composition.ts`、`host-surface.ts`；文档为本 ExecPlan、`docs/README.md` 一行索引、`docs/exec-plan/tech-debt-tracker.md` 一行（编号由协调者分配）。
- **字节不变**：`client.ts`、`host.ts`、`workspace-watch.ts`、`index.ts`、`apps/harness-plugin/scripts/`、全部既有测试、`packages/*`、ADR。
- **并行 PR B（#229）**：B 拥有 `client.ts` 的 `apply` 体、`workspace-watch.ts`、`packages/ui`；文件交集为空，只有 `docs/README.md` 索引行相邻。保留 `RemoteNamespace`、`ClientInjectedContext`、`RemoteResult`、`CLIENT_REMOTE` 的名字与 `baseline()`、`watch(signal)` 的签名；B 若要新增 Host 操作，须叠在本 PR 之后。
- Node 26（`.nvmrc`）；所有命令在 `.worktrees/host-operation-registry`（分支 `chore/host-operation-registry`，base `main`）的工作树根目录运行；不新增依赖。提交 `<type>(<scope>): <中文摘要>`，末尾 `Refs #352`；PR 描述 `Closes #352`。
- 规模：代码 + 测试 ≤ 800（评审原型实测约 400），文档 ≤ 1300。TDD：行为改动先有会失败的判别性测试。校验留在 `guarded` 之外，中文文案不变。发布面按 `docs/development/publication.md`：不写本机绝对路径、主机名、令牌。

## Plan of Work

三批串行：同一测试文件贯穿三批，不能并行。

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

## Validation and Acceptance

| # | 验收项（#352） | 判定证据 |
|---|---|---|
| AC1 | 三个操作各声明一次，生成的 descriptor 与今天深等 | `tests/contract/harness-host-operations.test.js`「generated descriptors are deep-equal…」：Batch 1 在 base 上先绿，Batch 2 后仍绿；`harness-host-remote-adapter.test.js` 字节不变且全绿（Batch 2 的 `git diff --exit-code`）；M1–M3 被杀 |
| AC2 | `remote.ts` 与 `host-composition.ts` 共用一套 wire 校验，没有重复定义 | Batch 2 的 grep 恰好 4 行，全在 `host-operations.ts`（issue 允许以评审证据判定）；金样用例的 codec `parse` 同一性断言；M6、M9 被杀，证明服务层与组合层都经过这套校验 |
| AC3 | 一条声明加入的夹具操作同时出现在 Host 分发与客户端代理上 | 同一文件「one declaration adds an operation to the descriptors, the Host dispatch and the client proxy」；M4、M5、M8、M10 被杀；C1–C5 证明代理类型与 handler 表都由声明派生 |
| AC4 | `pnpm verify`、`boundaries` 通过，`pack:plugin` 之后安装件测试仍通过 | Batch 3 步骤 3–5 的输出，root 下的两条已知失败按步骤 3 的方法区分 |

## Progress

- [x] 2026-10-21 设计评审完成：两份提案已对照代码复核，并在仓库外的 main 副本上做了评审原型。结果：`tsc` 退出码 0；Host 六文件 29/29；boundaries 9/9；安装件 23/23；`pnpm run test` 只剩两条已知的 root 失败，外加一条 `tests/contract/issue-policy.test.js` 的 CLI 用例因原型副本不是 git 仓库而失败（与本设计无关）；MVP-0 7/7；M1–M10、C1–C5 全部符合预期。
- [ ] Batch 1 · 钉住现状 descriptor
- [ ] Batch 2 · 每个操作只声明一次
- [ ] Batch 3 · 全量门、安装件与收尾
- [ ] 独立验收复读与人类评审（合并由人类决定）

## Surprises & Discoveries

- 2026-10-21：两套校验在两处行为不一致（见 Context and Orientation）。统一以后，只有服务层的多未知键报错文案会变（R3）。
- 2026-10-21：`pnpm verify` 是 `typecheck && test && test:mvp0`。root 下 `test` 一失败，MVP-0 就不会运行，所以 Batch 3 要单独跑它。
- 2026-10-21：执行 `pack:plugin` 后残留的 `apps/harness-plugin/dist` 会让 `tests/e2e/delivery-lineage.test.js` 变红。这个问题与本改动无关，由 #350 跟踪真正的修复。
- 2026-10-21：仓库里没有任何测试或源码读取 service 方法的 `Function.length`：`grep -rn "\.length" apps/harness-plugin/src tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-*.test.js` 的命中全是数组或字符串。

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
| D9 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | 接受生成的 unary 方法 `length === 0`，不加 `Object.defineProperty` 补丁；stream 方法保持 `async function* (signal)`，`length` 为 1，函数种类也不变 | 仓库里没有任何代码读取 `Function.length`（Surprises 2026-10-21）。网关按 descriptor 的 `parameters` 解码，再按位置调用，只在带 `cancellation` 时追加 signal（H2、H4、H10）。2026-10-15 用真实 registry 和网关做的探针，也是按这一语义驱动 `service.watch` 的。补丁属于为一个没有观测到的依赖写的投机代码，所以改为登记 TD，在下一次真实 Desktop S3 上观测 |
| D10 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | 三层校验都保留（网关 codec、服务层、组合层），共用同一函数；行为统一为列出全部未知键并规整 actor | adapter 测试用桩组合钉住了服务层，roundtrip 测试直接调用 `host.call` 钉住了组合层。把校验集中在一处，既有钉子就不必改；而共用同一函数后，几层之间不会再漂移 |
| D11 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | AC2 用 grep 作为评审证据，加上 codec 同一性断言；不写读源码文本的测试；新测试放进新文件，既有 adapter 测试保持字节不变 | issue 写明可以用「grep 或评审证据」。2026-10-14 的评审删过一条没有行为判别力的源码文本断言（`2026-10-13-harness-host-composition` Surprises）。旧测试原样通过，是 AC1 更强的证据 |
| D12 | 2026-10-21 / 设计评审（Claude Opus，独立评审 subagent） | 不修改 ADR-0013 | Decision 2 仍然成立。Why 段的「手写」指的是没有 Typert 生成器，现在依旧如此：声明是手写的，descriptor 对象在仓库内派生 |

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
| 触发 | 下一次真实 Desktop S3（#132 联合验收或演示彩排）、宿主升级 |
| 退出 | 在本 PR 之后的构建上各调用一次 `baseline`、`bootstrapWorkspace`、`watch`。如果网关依赖形参个数，就为生成的方法 `Object.defineProperty(fn, 'length', { value: params.length })`，并在金样测试里钉住 `length` |

## Outcomes & Retrospective

未开始。

## Bottom Change Note

- 2026-10-21：设计评审（Claude Opus，独立评审 subagent）创建本计划。合并了两份竞争提案（min：`host-operations.ts`、可注入的 `defineRemote`；ind：`kind`、`createDispatch`、`assembly()`），在 Decision Log 中逐项裁决，并在仓库外的评审原型上复核了全部关键结论。
