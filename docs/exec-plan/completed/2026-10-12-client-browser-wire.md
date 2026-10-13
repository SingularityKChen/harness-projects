# Client 浏览器安全依赖图 ExecPlan

> 状态：Completed
> 创建：2026-10-12
> 范围：完成 issue #308；让真实 `@harness-projects/client` 入口在浏览器构建和隔离运行时中可用。
> 上游输入：`AGENTS.md`、`PLANS.md`、issue #308、`apps/harness-plugin/scripts/build.mjs`

## Purpose / Big Picture

完成后，浏览器消费者可以真实导入并运行 `createEntityStore`、`createTransport` 和 `createSync`，不再把 Controller 根入口、Core、Storage、Provider 或 Node 内置模块带入浏览器。

最小成功证据：

- 真实 client factory 入口以 `platform: browser`、`write: false`、无 external `node:*` 构建成功。
- esbuild metafile 不包含 `packages/core/**`、`packages/storage/**`、`packages/providers/**`、`packages/controller/src/index.ts`、`packages/controller/src/wire.ts`、`packages/domain/src/ids.ts` 或 `packages/capabilities/src/observation.ts`。
- 产物在不提供 Node `require` 的隔离 vm 中运行，驱动 baseline 与 delta，并证明实体、revision、stale/reconnect 语义仍由真实 client 工厂处理。

## Context and Orientation

当前 `packages/client/src/store.ts`、`sync.ts`、`workspace-read.ts` 运行时导入 `WireFreshness`，来源是 `@harness-projects/controller` 根出口。Controller 根出口同时装配 Core、commands、watch 和 Host wire 逻辑，继续导入 Node-only 的 `node:crypto`、`node:util`。

已复现的真实入口失败面：

- `packages/capabilities/src/observation.ts` → `node:crypto`
- `packages/core/src/bootstrap.ts` → `node:util`
- `packages/core/src/execution-context.ts`、`relations.ts` → `node:crypto`
- `packages/domain/src/ids.ts` → `node:crypto`

现有 UI browser fixture 是手工 store/read fixture，不会构造真实 client store/sync/transport，因此不能作为 #308 证据。#312 负责后续运行时 frame ordering 与 capability identity 校验；本计划不改变其协议语义。

## Design / Spec

### 方案比较

1. **新增 browser-safe runtime leaf，并让 client 只依赖该 leaf（采用）**：在 Controller 包新增纯值模块，定义唯一的 `WireFreshness` 等运行时常量；`wire.ts` 与 client 都从该 leaf 读取。通过 package exports 公开子路径。优点是保留 wire 类型单一来源，运行时依赖图真正断开。
2. **让 client 复制 Wire DTO/常量**：放弃。复制会形成第二个协议事实源，类型或枚举漂移时不能由真实 roundtrip 暴露。
3. **externalize 或 polyfill Node builtins**：放弃。它会掩盖 Host 反向依赖，把 `node:crypto`/`node:util` 推迟到浏览器运行时失败，并违反无 Node external/无 Host 输入门禁。

### 采用方案

- 新增 `packages/controller/src/values.ts`，只承载浏览器安全的 runtime wire 常量；不得从该 leaf re-export `wire.ts`、Core 或 Domain 根出口。
- `packages/controller/package.json` 增加 `./values` export。
- `packages/controller/src/wire.ts` 复用该 leaf，保持现有 Host wire API。
- `packages/client/src/store.ts`、`sync.ts`、`workspace-read.ts` 的 runtime import 改为 browser-safe 子路径；type-only imports 保持协议类型单一来源。
- 新增真实 client browser contract，入口实际调用三工厂，使用内存 transport 驱动 baseline、delta 和 reconnect/gap 中至少一条真实路径。
- 负控继续保留：直接导入 Domain 根的 Node-only value 必须失败；externalize/polyfill Node builtins 的实验必须被门禁拒绝。

## Global Constraints

- 只修改 Controller browser-safe leaf/exports、client runtime imports、browser contract fixture/test、必要 ExecPlan；代码增删 ≤800 行，文档增删 ≤1300 行。
- 不修改 `apps/harness-plugin/src/client.ts`、Host transport、页面挂载、真实 Provider、Storage schema 或 #312 frame semantics。
- 不复制 Wire DTO 类型或协议常量，不允许 external `node:*`，不允许 Node shim。
- TDD 顺序：先运行当前失败的真实 browser contract，再写最小生产改动；为保持一个可独立回滚的 PR 闭环，红灯与最小修复在最终提交序列中合并保留，红灯输出记录在本计划。
- 分支：`fix/client-browser-wire`；PR 使用 `Closes #308`。
- 现有 #303/#305/#306/#307 PR、worktree 和 ExecPlan 不得修改。

## Plan of Work

### Batch 1 · 独立设计与真实入口红灯

**最小闭环**：从真实 client factory 入口复现当前 Node 依赖失败。

**涉及文件**：`tests/fixtures/client-browser.mjs`、`tests/contract/client-browser.test.js`、本 ExecPlan。

- [x] 用 esbuild stdin 导入并调用 `createEntityStore/createTransport/createSync`。
- [x] 设置 `platform: browser`、`write: false`、`metafile: true`、`external: []`。
- [x] 运行并确认基线因 5 个 `node:crypto`/`node:util` 依赖失败。
- [x] 在隔离 vm 中实现真实 baseline/delta 驱动入口。

**验证**：

```sh
node --test tests/contract/client-browser.test.js --test-name-pattern='真实 client 入口'
```

期望：当前基线非零退出，失败来自 Node-only 依赖或 Host runtime 输入，而不是 fixture 语法错误。

**回滚**：删除红灯测试提交；不改生产依赖。

### Batch 2 · browser-safe runtime leaf 与依赖边修复

**最小闭环**：真实 client 入口不再经过 Controller Host 根图。

**涉及文件**：`packages/controller/src/values.ts`、`packages/controller/src/wire.ts`、`packages/controller/package.json`、`packages/client/src/store.ts`、`packages/client/src/sync.ts`、`packages/client/src/workspace-read.ts`。

- [x] 新增纯值 leaf 与公开 export。
- [x] 保持 `wire.ts` 使用同一运行时常量。
- [x] 改写 client runtime imports，type-only imports 不复制协议类型。
- [x] 运行真实 bundle，确认 external 集合为空且 forbidden Host inputs 数为 0。

**验证**：

```sh
node --test tests/contract/client-browser.test.js
node_modules/.bin/tsc --noEmit
node --test tests/contract/package-boundaries.test.js
```

期望：真实入口 build 通过；metafile 无 Host/core/storage/provider/Node-only inputs。

**回滚**：反向提交 leaf/export/import；无 schema/data repair。

### Batch 3 · 隔离 vm 执行与状态语义验收

**最小闭环**：构建产物实际驱动 client baseline→delta→gap/rebaseline→disconnect/reconnect。

**涉及文件**：`tests/fixtures/client-browser.mjs`、`tests/contract/client-browser.test.js`。

- [x] 在无 Node `require`、无 polyfill 的 vm 中执行 bundle。
- [x] 驱动 baseline，断言 store/sync 的 connected、revision、entity identity。
- [x] 驱动一跳 delta 与 gap/rebaseline，断言 stale 窗口和恢复结果。
- [x] 保留 negative control：controller 根入口构建仍因 Node-only 依赖失败。

**验证**：

```sh
node --test tests/contract/client-browser.test.js tests/contract/ui-work-item-list-browser.test.js
node --test tests/e2e/client-sync.test.js tests/e2e/workspace-read-assembly.test.js
```

期望：真实 client contract 与既有 renderer/e2e 全绿。

**回滚**：只回滚测试与 fixture，不改变生产协议。

### Batch 4 · 对抗验收、公开面与 draft PR

**最小闭环**：current-main 上的独立 client/browser capability 可审阅、可回滚。

- [x] 运行完整相关测试、typecheck、boundaries、workflow、size、disclosure、diff-check（2026-10-13）。
- [x] 回读当前 base/head、PR body、closingIssuesReferences、closedByPullRequestsReferences、labels、milestone 和 review threads（2026-10-13）。
- [x] 独立 reviewer approve 且 required checks 全绿，PR 已 ready（2026-10-13）。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 真实 client 入口可浏览器构建 | esbuild browser/write:false/metafile 通过 |
| 2 | 无 Node/Host 依赖 | external 集合为空；metafile 无 Node-only/Host 输入 |
| 3 | 运行时可执行 | 隔离 vm 无 Node require 运行三工厂 |
| 4 | baseline→delta→gap/rebaseline→disconnect/reconnect 语义保持 | store/sync revision、实体身份、stale/gap 断言通过 |
| 5 | 协议事实单一 | client 不复制 Wire DTO/常量；controller leaf 与 wire.ts 共用 |
| 6 | 现有产品回归 | typecheck、boundaries、renderer/client e2e 全绿 |
| 7 | 公开面和规模 | size≤800/1300、disclosure、diff-check、native issue links 回读通过 |

## Progress

- [x] 读取 current main、issue #308、现有 build/browser fixtures 和依赖图。
- [x] 完成三份独立设计与反方分析；推荐 browser-safe leaf + real client contract。
- [x] 创建隔离 worktree：`.worktrees/fix-client-browser-wire`，base `origin/main@ee07c323`。
- [x] 独立最终 reviewer 收敛 spec；确认 browser-safe leaf + real client factory contract，排除 UI shell/Host wiring。
- [x] Batch 1 红灯。
- [x] Batch 2–3 实现与相关回归验证；真实 client/browser 与既有 client/UI suites 共 37 项通过。
- [x] Batch 4 current-head review、required checks、PR metadata 和 ready（2026-10-13）。

## Surprises & Discoveries

- 2026-10-12：现有 UI browser tests 全绿但不构造真实 client factories，不能作为 #308 证据。
- 2026-10-12：externalize `node:*` 能使 esbuild 暂时通过，但 metafile 仍含 Host/core 输入，隔离 vm 会在运行时失败。
- 2026-10-12：直接穿透 `@harness-projects/controller/src/wire.ts` 不受 package exports 支持，必须公开 browser-safe 子路径。
- 2026-10-12：独立 reviewer 确认 runtime leaf 至少承载 `WireFreshness`/`WireAuthority`，并由 `wire.ts` 复用；client 正控必须执行 baseline→delta/gap/reconnect，不能只看 esbuild 成功。

## Decision Log

- 2026-10-12：选择 Controller browser-safe leaf，不复制 client 协议类型；理由是维持单一 Wire 事实源。
- 2026-10-12：真实 browser contract 必须调用三工厂并执行 baseline→delta/gap；理由是“bundle 成功”不能证明运行时可执行。
- 2026-10-12：#308 与 #312 分成两个 PR，#312 在 #308 后 stacked；二者接受点、失败域和回滚面不同。
- 2026-10-12：不触及插件壳/Host transport/page wiring；这些属于 #228/#229/#276 的后续闭环。
- 2026-10-12：独立 reviewer 复核后保留 UI shell/history/Host wiring 在本 issue 之外；现有 UI browser tests 只作为回归。
- 2026-10-12：TDD 红灯基线稳定复现 5 个 Node-only imports；browser-safe leaf 修复后真实 bundle 在隔离 vm 中完成 baseline→delta→gap/rebaseline→disconnect/reconnect，相关 37 项测试通过。
- 2026-10-12：红灯在生产改动前运行并稳定失败；为保持 #308 的单一可回滚能力闭环，未把仅有红灯测试的中间提交单独推送，最终 diff 仍保留该判别性 contract。

## Idempotence and Recovery

测试/构建可重复执行；产物目录失败时由 build 脚本清理。代码回滚不需要迁移或数据修复。若 package export 变更造成消费者失败，恢复原 export 与 client imports 即可。

## Interfaces and Dependencies

- `@harness-projects/controller/values` package export。
- esbuild、Node vm、真实 client transport/store/sync。
- `tests/contract/package-boundaries.test.js`、现有 client/browser/e2e suites。
- PR #317 已合并的 current main；不依赖未合并 #316/#318/#321。

## Outcomes & Retrospective

实际结果：真实 client browser contract、隔离 vm、client/UI 回归、typecheck、boundaries、workflow、size、disclosure 和 diff-check 均通过；独立 MMP 评审无 P0/P1/P2，P3 仅为记录与收尾项。PR #323 已由评审账号 APPROVE；#312/#218 的 frame/generation 与 Host wiring 继续由后续 issue 承接。计划随 PR #323 归档，合并前按 `gh pr checks 323 -R SingularityKChen/harness-projects` 重读最终 head。

## Bottom Change Note

- 2026-10-12：创建本 ExecPlan；基于三份独立设计、反方分析和当前 origin/main 事实，选择 browser-safe leaf + real client factory browser contract。
- 2026-10-12：实现采用 `packages/controller/src/values.ts` 与 `@harness-projects/controller/values`，补齐真实 client browser contract 的 forbidden Host inputs、gap/rebaseline 与 disconnect/reconnect 验收。
- 2026-10-12：独立复评后补强 metafile allow/deny 断言，并将回归证据统一为 37 项；未扩大到 UI shell、Host transport 或 #312。
- 2026-10-12：按 reviewer 复评补齐 values path、controller root/wire forbidden inputs、gap stale/rebaseline 与 disconnect/reconnect 断言，并记录红灯到绿灯证据。
- 2026-10-13：完成 current-head MMP 评审、required checks 与 PR metadata 回读；将 Batch 4 由 Active 收口为 Completed，评审记录写入 `docs/review/pr-323-mmp-review.md`。
