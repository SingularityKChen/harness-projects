# PR #323 MMP 交付评审

- 评审对象：PR #323 `fix(client): isolate browser wire values from Host imports`
- 评审视角：MMP 独立交付闭环（代码、产品、架构、测试、反例、Issue/ExecPlan）
- 评审 worktree：`.worktrees/fix-client-browser-wire`
- 关联 issue：#308；PR body 的 `Closes #308`
- 锁定时间：2026-10-13（Asia/Singapore）
- immutable base：`79d016920c7a1456ceb617eb4f693df232a7fb38`
- immutable head：`8e022c62e21b3307482381da8ed99a7d01e27252`
- GitHub 当前状态：`mergeable=MERGEABLE`、`mergeStateStatus=CLEAN`、`isDraft=false`
- 当前 review / inline threads：`gh api .../pulls/323/reviews` 和 `.../comments` 均为空
- 当前标签：`kind:fix`、`area:domain`、`area:controller`、`area:client`、`area:tests`

## 1. 风险矩阵

| 等级 | 代码 | 产品闭环 | 架构 / 事实所有权 | 测试 / 反例 | 工作项 / 发布面 | 判定 |
|---|---|---|---|---|---|---|
| P0 | 未发现会破坏 main、引入不可逆写入、泄露凭据或让浏览器产物携带 Host/Node 运行时的缺陷 | 当前改动只读消费 wire snapshot，不新增外部写入或权威 Saved 路径 | 未发现第二 Planning 源、Provider 互调、UI→Provider 或 client→Host 反向运行时边 | exact head 的 required checks、全量验证和 browser 负控通过 | disclosure、size、diff-check、issue/pr policy 通过 | 0 项 |
| P1 | 三处 runtime import 都改到纯值 leaf；Controller root / Core / Storage / Provider / Node-only inputs 被 bundle 证据排除；正常与 gap/reconnect 失败窗口保持可执行 | 隔离 vm 真实调用 `createEntityStore/createTransport/createSync`，baseline→delta→gap/rebaseline→disconnect/reconnect 仍保持 revision、stale/current、实体和读取结果 | `packages/controller/src/values.ts` 无依赖，`wire.ts` 与 client 共享同一 runtime 常量；client 的 Controller root 引用均为 type-only，Host 仍拥有 wire authority | 真实 browser contract、UI browser 负控、client sync/workspace-read e2e、typecheck、boundaries 和 `pnpm verify` 全绿；变异 M1–M3 均 KILLED | #308 acceptance 与 `Closes #308` 对齐；无重复 issue owner | 0 项 |
| P2 | 未发现当前 head 的行为错误；实际 Harness 插件页面入口仍是后续壳/transport/page wiring 范围，不能把本 PR 当作完整首发浏览器流程 | #308 明确要求真实 client factory browser build/execute；完整页面、Host remote、watch stream 和 DOM E2E 由 #228/#229/#276/#156 继续承接 | 七条不变量均保持；#218 的 generation/late-frame fencing、#326 的 frame validation 不在本 PR 复制实现 | 既有 UI browser tests 提供 domain-root Node 负控；本 PR 自带 controller-root 负控和真实 client 正控 | 当前 PR 的 active ExecPlan Batch 4 / Outcomes 仍待作者在评审后回填 | 0 项运行时阻塞；证据回填转为 P3 |
| P3 | 无影响交付的代码风格问题 | 无新增用户可见风险 | `apps/harness-plugin/src/client.ts` 的 placeholder 仍是既定后续范围 | fixture 中的 `const fixture` 未使用，不影响判别力 | 合并后归档 active ExecPlan、更新 `docs/README.md`、回读 #308 双向链接和 #326 新 base/head | 1 项文档流程跟进 |

结论：没有 P0/P1/P2；当前评审建议 **APPROVE**。P3 只需在收尾时机械回填，不阻塞 MMP 合并。

## 2. 锁定事实与提交范围

PR #323 当前包含 6 个提交，最终提交为 `8e022c62`：

- `c6121f98`：创建 #308 ExecPlan
- `ded8d642`：新增 browser-safe wire values leaf 与 client imports
- `423c3048`：加入真实 client browser contract
- `b7ee872f`：补 metafile allow/deny 与 reconnect 断言
- `18c61bf2`：收口 ExecPlan 复评证据
- `8e022c62`：补 `disconnect` 后 `connected=false` 判别断言

相对 immutable base 的规模是代码 181/1000、文档 192/1500。变更仅落在：

- `packages/controller/src/values.ts`、`wire.ts`、`package.json`
- `packages/client/src/store.ts`、`sync.ts`、`workspace-read.ts`
- `tests/contract/client-browser.test.js`、`tests/fixtures/client-browser.mjs`
- `docs/exec-plan/active/2026-10-12-client-browser-wire.md`

工作树在评审前为 clean；评审只新增本文件，不改产品代码、不提交 commit、不写 GitHub review。

## 3. 分层证据

### 3.1 代码、正常路径和失败路径

`packages/controller/src/values.ts:1-6` 只导出 `WireFreshness` / `WireAuthority` 的字符串常量及其类型，无 import，因此可作为浏览器运行时 leaf。`packages/controller/src/wire.ts:15-18` 复用并重新导出同一对象；没有复制第二份协议值。

`packages/client/src/store.ts:8`、`sync.ts:11`、`workspace-read.ts:5` 将唯一 runtime value import 从 Controller 根出口移到 `@harness-projects/controller/values`；DTO 仍在相应文件的 type-only import 中从 Controller 根出口读取。由 esbuild metafile 可见 browser bundle 触达真实 client store/sync/transport/workspace-read 和 values leaf，同时排除：

- `packages/core/**`
- `packages/storage/**`
- `packages/providers/**`
- `packages/controller/src/index.ts`、`wire.ts`、`commands.ts`、`queries.ts`、`watch.ts`
- `packages/domain/src/ids.ts`、`identity.ts`、`relations.ts`
- `packages/capabilities/src/observation.ts`

真实 fixture 执行了：

1. baseline revision 1；
2. delta revision 2；
3. gap 后 rebaseline revision 3；
4. `disconnect()` 后确认 `store.isCurrent=false` 且 `sync.connected=false`；
5. reconnect 后恢复 `current=true`、revision 3、title `recovered`。

`tests/contract/client-browser.test.js:27-58` 的期望同时钉住 external 集合为空、隔离 vm 无 Node `require`、实体和工作区读取结果。负控 `tests/contract/client-browser.test.js:61-77` 证明 Controller 根入口仍因 `node:crypto|node:util` 失败，不能把 Host 图错误地当作 browser client 依赖。

失败语义未被本 PR 重写：store 的 stale/current 仍由已接收 wire source 与 gap/disconnect 窗口决定，sync 的 head/connected/revision 仍只在既有 accept 点发布；本批只改变 runtime import 依赖边并增加真实 browser contract。

### 3.2 产品闭环与状态拥有

#308 的产品结果是“真实 client factory 在浏览器构建并可执行”，不是页面已经挂载。该结果由隔离 vm 的真实 `createEntityStore/createTransport/createSync` 调用证明；手写 store/read fixture 只作为既有 UI browser 回归，不能单独替代本正控。

Host 仍是 wire authority 的拥有者：`WireFreshness` / `WireAuthority` 由 Controller leaf 统一定义，client 只保存 Host 已确认的 snapshot/delta/metadata 投影并计算 stale/current 读取状态。PR 没有加入 Planning 状态、工程状态、Provider 写入、凭据持久化或“Saved”显示路径。外部写入 ack/reconcile、页面和 Host transport 继续由后续 issue 负责。

实际 Harness client 半边 `apps/harness-plugin/src/client.ts:1-17` 仍是 placeholder；这是 ExecPlan 已明确排除的 #228/#229/#276 范围。#156 的十条首发浏览器 E2E 也明确把 #308 作为前置，不与 #308 重复验收。

### 3.3 架构七条不变量和依赖边

- 不变量 1：只读 client projection，不创建第二 Planning 事实源。
- 不变量 2：不改变多 Provider 连接模型。
- 不变量 3：不把工程事件写入规划状态；本 PR 无状态写入。
- 不变量 4：不改变阶段 + 并行门禁。
- 不变量 5：不把 LLM 放进规划关系或发布门禁。
- 不变量 6：不改变产物谱系传播。
- 不变量 7：Host 拥有权威状态；client 只读消费 wire 事实。

`tests/contract/package-boundaries.test.js` 通过，`packages/client -> controller, domain` 仍是登记依赖。新的 `controller/values` 子路径没有反向 import；`wire.ts` 仍保留 Controller→Core 的 Host 侧图，但该文件不再进入 client runtime bundle。没有 Provider→Provider、UI→Provider、client→Storage 或 controller→UI 的新增边。

### 3.4 测试判别力与反例

精确 head 本地验证：

```text
pnpm verify
  typecheck: pass
  tests: 1497 pass, 0 fail
  tests/mvp0: 7 pass, 0 fail

node --test tests/contract/client-browser.test.js \\
  tests/contract/ui-work-item-list-browser.test.js \\
  tests/contract/ui-work-item-detail-browser.test.js
  7 pass, 0 fail

node --test tests/contract/client-browser.test.js \\
  tests/contract/package-boundaries.test.js \\
  tests/e2e/client-sync.test.js \\
  tests/e2e/workspace-read-assembly.test.js
  32 pass, 0 fail

node scripts/workflow-check.mjs
  no findings (8 workflows)

node scripts/rule-checks.mjs size 79d016920c7a1456ceb617eb4f693df232a7fb38
  code 181/1000, docs 192/1500

node scripts/rule-checks.mjs disclosure 79d016920c7a1456ceb617eb4f693df232a7fb38
  pass

git diff --check 79d016920c7a1456ceb617eb4f693df232a7fb38...8e022c62e21b3307482381da8ed99a7d01e27252
  pass
```

变异批在最终树上运行并由 harness 逐字节还原，命令为：

```sh
node scripts/review-mutate.mjs /tmp/pr323-client-browser-mutate.json --root .
```

| 变异 | 施加位置 | 变异内容 | 结果 |
|---|---|---|---|
| M1 | `packages/client/src/store.ts:8` | runtime import 从 `controller/values` 改回 Controller 根出口 | **KILLED**；真实 browser contract 构建因 Node-only 依赖失败 |
| M2 | `tests/fixtures/client-browser.mjs:61` | 删除 `sync.disconnect()` | **KILLED**；真实 browser contract 的 disconnected current/connected 期望失败 |
| M3 | `tests/contract/client-browser.test.js:51` | 把 `disconnectedConnected: false` 改为 `true` | **KILLED**；同一具名 browser contract 失败 |

结果摘要：3/3 `KILLED`，exit 0；变异后文件按字节恢复，复跑基线通过，工作树无产品代码修改。

### 3.5 Issue、ExecPlan、规模、链接与重复 owner

- #308 仍 OPEN，标题、scope、acceptance 与 PR 实现一致；PR 通过 `Closes #308` 关联，未合并前没有 `closedByPullRequestsReferences` 结果可宣称。
- `node scripts/policy-check.mjs pr 323` 与 `issue 308` 均通过。
- #156 是更宽的首发浏览器 E2E owner；#218 是 reconnect generation / late-frame fencing owner；#228 是 Host controller remote；#229 是 pages + client transport/watch wiring；#276 是 watch stream；#312（PR #326）是 frame ordering/capability identity/拒绝原子性。未发现别的 issue 重复拥有 #308 的 browser-safe runtime leaf scope。
- active ExecPlan 已记录 Design、Plan of Work、验证、反例和决策，但 Batch 4 的当前-head review/checks/metadata 复选框与 Outcomes 仍是待回填。该文档跟进不改变当前 runtime 结论；合并收尾时应按仓库流程迁移到 `docs/exec-plan/completed/` 并更新 `docs/README.md`。

## 4. 与 PR #326 的栈接口风险

PR #326 当前 immutable base 是 `fix/client-browser-wire@8e022c62e21b3307482381da8ed99a7d01e27252`，head 为 `c98ad8557c54b091c3def1f75997ce2599915b34`；`8e022c62` 是 `c98ad855` 的祖先。#326 的 `workspace-read.ts`、`sync.ts`、`store.ts` 修改建立在本 PR 的 `@harness-projects/controller/values` import 与 browser-safe leaf 上。

因此：

1. 必须先按当前 exact head 评审/合并 #323，再把 #326 rebase/retarget 到 #323 的新 merge commit，并重新锁定 base/head、diff、checks 和 review threads。
2. #326 不得把三处 runtime import 恢复成 Controller 根出口，也不能删除 `packages/controller/package.json` 的 `./values` export；否则会重新引入 Host/Core/Node-only browser 依赖。
3. #323 合并后的 merge commit 会改变 #326 的 base SHA；沿用旧 `8e022c62` 结论不合规。若 #326 继续以栈方式提交，需重新验证它相对新 base 的独立规模与 `Closes #312` 关联，不能把 #323 的 `Closes #308` 当作 #326 的 issue linkage。
4. #326 自己的 generation / late-frame fencing 仍是 #218 的接口边界；#323 不声称已完成该 owner。

## 5. 未验证项和建议行号

- `docs/exec-plan/active/2026-10-12-client-browser-wire.md:125-131,183-185`：评审后由作者回填 Batch 4、最终 head/checks、实际测试数与 Outcomes，再按合并流程归档；这是 P3 文档流程项。
- `apps/harness-plugin/src/client.ts:1-17`：仍是 placeholder，完整 Host/page/watch/browser E2E 不属于 #308；由 #228/#229/#276/#156 接续。
- `tests/contract/client-browser.test.js:10`：`fixture` 常量未使用，属于可选清理，不影响交付或测试判别力。

未发现需要当前 PR 追加代码修复的 P0/P1/P2，也未提交 inline 意见或 GitHub review/comment。

## 6. 结论

基于 immutable head `8e022c62e21b3307482381da8ed99a7d01e27252`，PR #323 已形成独立可验收、可合并、可回滚的 browser-safe client dependency capability 闭环。没有 P0、P1 或 P2。按仓库评审规则，评审结论为 **APPROVE**；完成 P3 的 ExecPlan 归档和 #326 栈重新锁定后再进行后续集成。
wc -l docs/review/pr-323-mmp-review.md
git diff --check -- docs/review/pr-323-mmp-review.md
git status --short --branch