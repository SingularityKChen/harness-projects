# PR #326 MMP 交付评审

> 评审时间：2026-10-13（Asia/Singapore）。对象：`fix/client-frame-validation@c98ad8557c54b091c3def1f75997ce2599915b34`，PR 基线 `fix/client-browser-wire@8e022c62e21b3307482381da8ed99a7d01e27252`。结论只适用于该 base/head；修复或基线移动后须重新评审。

## 1. 先建风险矩阵

| 等级 | MMP 风险判据 | 本轮结果 |
|---|---|---|
| P0 | 合并后破坏主线、泄露 redacted 内容或密钥，或越过规划权威硬约束 | 未发现。PR 不修改写入、持久化或 Provider，malformed capability 不变为可用 |
| P1 | 倒退帧成为 current、重复能力使 denied 变 available、拒绝后部分写入 rows/header/time 等严重正确性缺陷 | 本轮覆盖的合法形状反例均被拒绝；未发现新增可定位 P1。迟到异步帧仍由 #218 跟踪，不能把本 PR 视为 #218 完成 |
| P2 | 非法帧拒绝不原子、误报连接状态，或未能满足 #312 明示的 acceptance | **1 条**：`metadata.entities=null` 和 `delta=null` 在新校验前抛错，经 `guarded()` 转成断线并把已确认的行标 stale；违反 #312 拒绝原子性 |
| P3 | 计划/提交/标注一致性问题 | ExecPlan Batch 1 的建 PR 步骤仍未勾选；Batch 3 复评需按当前结论更新；正式 generation producer 仍由 #218 承接 |

矩阵按照代码、产品闭环、架构、测试与反例、工作项逐层核对。绿色测试只是局部证据。

## 2. 锁定事实

- `gh pr view 326 -R SingularityKChen/harness-projects --json baseRefOid,headRefOid,mergeStateStatus,isDraft,closingIssuesReferences,files`：open/ready；base `8e022c62`、head `c98ad855`；`mergeStateStatus=UNSTABLE`，不是 required gate 失败。native closing issue 指向 #312，反向 issue 关联亦指向 #326；review threads 为 0。
- `gh pr checks 326 -R SingularityKChen/harness-projects`：`PR Fast Gate`、Verify、Boundaries、Integration、E2E、MVP-0、size、disclosure、workflow、issue policy 等通过。`Create review session` 失败；`gh run view 38266364261 --log-failed` 显示本地可选 DSH 端点 `<local-review-endpoint>` 拒绝连接（响应 000000），符合 `docs/review/README.md` §7 的非分支保护检查，不作为此 PR 的代码失败。
- PR 相对自己的 stacked base 有代码 194/1000 行、文档 109/1500 行；`node scripts/policy-check.mjs pr 326` 输出 `links Closes #312`。两个提交是 plan + fix，归档与修复后仍须整合检查。

## 3. 分层检查与证据

### 3.1 代码与产品闭环

`packages/client/src/sync.ts:157-175` 在 delta 进入 store 前拒绝倒退或不前进修订，对前游标超前的合法 delta 先校验 shape 再进入 gap recovery。`packages/client/src/workspace-read.ts:51-64` 拒绝重复、未知或无效 access 的 capability。`accept()` 在 header/clock/store 验证后才发布 head/time/connected。真实 Controller 生产路径没有 generation 字段；本 PR 对可选 evidence 的消费只是一道接受点合同，生产与迟到操作 fencing 在 #218，不能声称端到端 generation 闭环。

**P2 反例：拒绝路径改变当前视图。** 在本 PR worktree 的实际 head 运行纯内存 client 入口：先接受 revision 1 的单行 fresh baseline（`connected=true`、`isCurrent=true`、时间 `2026-10-13T00:00:00Z`）；之后注入 `{kind:'metadata',metadata:{...baseline,entities:null}}`。`sync.poll()` 在 `sync.ts:152-153` 的 `.some()` 抛 `TypeError`，还没到 `accept()`；`guarded()` 的非 `FrameRejectedError` 路径调用 `lose()`。观测：拒绝后 `connected=false`、`isCurrent=false`，旧时间未变。另注入 `{kind:'delta',delta:null}`，在 `sync.ts:158` 访问 `previousRevision` 时同样抛错并改变连接/行 stale。此处不涉及外部 Provider；它正是 #312 规定的畸形 frame acceptance 反例。应把事件结构验证放到任何 `metadata.entities`/`delta` 字段读取之前，并统一归类为帧拒绝，确保拒绝时 `rows/header/current/stale/time` 深相等。当前新增的 `guarded()` 分支 `sync.ts:102` 只识别 `FrameRejectedError`，是建议的 inline 锚点。

此问题在基线已有局部代码风险，但 #312 明确要求“Rejected frames do not partially publish rows/header/time and cannot make denied cached content current”；本 PR 宣称完成原子拒绝，故必须在 #312 范围内收口。该反例是可用性误报，未见 stale 内容被错误标 current，定 P2。

### 3.2 架构与 issue 交叉追踪

Client 仍只依赖 domain/controller 的公开 leaf，`pnpm run boundaries` 8/8；`node_modules/.bin/tsc --noEmit` 退出 0。无 Planning/Engineering 状态写入、凭据持久化或 Provider 互调。#218 负责异步 generation、合法 reset 的正式 wire producer、reconnect/disconnect 迟到帧和完整 Host read；#308 负责浏览器安全 client runtime，#323 为本 PR 栈底；#276 负责接线。GitHub 搜索 `frame validation OR generation OR client reconnect OR capability` 仅发现本议题的 #312 与 #218 等独立入口，无另一个 issue 专门追踪本轮这个 pre-validation malformed event 原子拒绝缺口。

### 3.3 测试与反例

在 `fix/client-frame-validation@c98ad855` 的 worktree 根目录，本轮实际执行：

```text
node --test tests/e2e/workspace-read-assembly.test.js tests/e2e/client-sync.test.js tests/contract/client-browser.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/ui-work-item-detail-browser.test.js
→ 33 pass / 0 fail
node_modules/.bin/tsc --noEmit && pnpm run boundaries
→ tsc exit 0；boundaries 8 pass / 0 fail
node scripts/policy-check.mjs pr 326
→ links Closes #312
node scripts/rule-checks.mjs size 8e022c62e21b3307482381da8ed99a7d01e27252
→ code 194/1000, docs 109/1500
node scripts/rule-checks.mjs disclosure 8e022c62e21b3307482381da8ed99a7d01e27252
→ 机械扫描通过
git diff --check 8e022c62e21b3307482381da8ed99a7d01e27252...HEAD
→ exit 0
```

公开面人工五类目检查了 PR 新增行、标题/正文与提交信息：未见凭据、本机身份、账号个人信息、内部系统地址或保密字样。新增测试覆盖正常形状的倒退、不前进、重复/未知/坏 access、缺 generation、前游标超前 gap 及若干 shape 错误；没有 `metadata.entities=null` 或 `delta=null` 经 `sync.poll()` 的拒绝状态深相等断言。上述反例构成现有绿色测试以外的判别证据。

### 3.4 Issue 验收

#312 的第 1/2 项（倒退/不前进、能力身份）和已有可选 generation reset test 有局部证据；第 3 项“Rejected frames do not partially publish rows/header/time…”尚未对 malformed event 的完整接受路径成立。#218 明确承接正式 generation producer 与迟到操作，不把它的未完成误算为 #312 已交付。Issue checklist 目前全空；修复复评后再按实证勾选。

## 4. 本轮结论与下一门

**本轮未发现 P0/P1；有 1 条 P2，建议在一份 `APPROVE` review 中附唯一行级意见，随后按 owner 流程修复。** 修复后必须重锁 base/head，运行新增判别测试、client/浏览器合同与 required checks，并重新核实 issue acceptance、ExecPlan 归档和 commits。若新证据显示该错误可使 denied 内容成为 current，则升为 P1 并改用 `REQUEST_CHANGES`。

## 5. P2 修复与独立复评准备

按本轮 P2 意见先写反例再改实现：`tests/e2e/workspace-read-assembly.test.js` 新增 `metadata.entities=null` 与 `delta=null` 的真实 `sync.poll()` 用例。旧实现先红：普通 TypeError 进入 `guarded()` 后把已确认快照改为 disconnected/stale，深相等断言失败。

根因是 `poll()` 在 `accept()` 的 `FrameRejectedError` 边界之外直接读取 event 的嵌套字段。修复在 `packages/client/src/sync.ts` 增加 event envelope shape guard，先把非法 `delta` / `metadata` / `gap` 载体包装为专用帧拒绝，再进入任何 `.some()`、revision 或 gap 读取；因此拒绝路径不调用 `lose()`。

修复后本地证据（在 `fix/client-frame-validation` 工作树运行）：

```text
node --test tests/e2e/workspace-read-assembly.test.js --test-name-pattern='畸形 event' → 22/22
node --test tests/e2e/workspace-read-assembly.test.js tests/e2e/client-sync.test.js tests/contract/client-browser.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/ui-work-item-detail-browser.test.js → 34/34
node_modules/.bin/tsc --noEmit → exit 0
pnpm run boundaries → 8/8
```

待修复提交推送后，必须以新 head 重跑 PR checks，并由评审账号对新 head 做一次独立复评；若 malformed event 仍能改变 `connected/stale`，P2 不得关闭。#218 的 generation producer 与 late async fencing仍保持承接边界。
