# PR #269 MVP 评审记录

- **PR**：#269 `feat(ui): 统一只读工作项详情抽屉与深链入口`
- **base**：`main`（本地回读 `ed6b9aef278d`）
- **head**：`e47f817676ee4c4f94120a9d2d1caa90a5cf0006`
- **状态**：非 draft、`MERGEABLE`、`CLEAN`
- **评审工作树**：`.worktrees/item-detail-plan`
- **评审范围**：当前 immutable head；未提交 GitHub review、未修改产品代码、未合并。

## 1. 事实锁定

`gh pr view 269` 回读到 base=`main`、head=`e47f817...`、mergeable=`MERGEABLE`、mergeStateStatus=`CLEAN`、draft=`false`，closing issue 为 #130。PR checks 当前全部通过：PR Fast Gate、Verify、Boundaries、Integration、E2E、MVP-0、Disclosure、Issue policy、PR size、Resolve base、Reconcile engineering state 等均 `pass`。当前 review 与 inline comments API 均为空。

本地 `git diff --numstat main...HEAD` 与 size gate：代码 **999/1000**、文档 **252/1500**，`git diff --check main...HEAD` 通过。代码只剩 1 行硬门余量；ExecPlan 自述的规划预算 ≤800 未达成，但仓库正式硬门通过，且该偏差已登记并有人类接受记录。

Issue #130 仍为 OPEN（PR 未合并），Project 状态回读为 Todo，`closedByPullRequestsReferences` 已包含 #269；其验收为同一 drawer、断线保留并标 stale、derived 明示且无编辑控件。

## 2. P0–P3 风险矩阵

| 级别 | 代码 / 产品闭环 | 路由与权限边界 | 测试判别力 | 工作项 / ExecPlan | 结论 |
|---|---|---|---|---|---|
| P0 | 未发现合并即破坏 main 的缺陷；PR 描述和实现均保留只读规划事实 | 未发现跨层写入、Node runtime 泄漏或跨 workspace 读取 | 完整 browser bundle 负控阻断 `node:crypto`；真实 Chromium 证据已记录 | #130、Closes 关联、Checks 均可回读 | **0 项** |
| P1 | 列表与深链共用 `WorkItemDetailDrawer`；投影先 scope、列表读门、安全行、详情读取，redacted 与撕裂读均复验 | **内部 `entityId` 被放入 anchor href/深链**，与既有 #129 完成 ExecPlan 的“`href` 不放内部标识”决策冲突；当前计划只登记为待裁定，未得到本 PR 内明确裁决 | 25 个新增详情/路由/浏览器/集成测试均通过；变异证据覆盖 scope、redacted、popstate、Tab、codec 等 | 该冲突涉及既有安全/产品边界，不是测试失败；需人类裁定后才能确定是否可合并 | **1 项候选阻塞意见** |
| P2 | Host 实际挂载与真实读取接线未在本 PR 验证，但 ExecPlan 明确归 #229；不能据 fixture 宣称已接通 | 非 Chromium、真机及高并发时序未验证；属于验证范围缺口，不是当前实现已证缺陷 | SSR 不证明真实 DOM；本 PR 已用 Chromium 补足主要交互证据；仍未覆盖其他引擎 | 规划预算 800 未达，正式 1000 硬门内；建议保留为风险记录，不机械删判别测试 | **0 个需立即修复；3 个未验证项** |
| P3 | 可维护性尚可，导出面与 fixture 已收敛为产品 adapter；代码余量仅 1 行 | `itemPath` 与 parser 已共享判据，非法段响亮失败；未见旧 P3 回归 | 路由负例、自往返和产品 `browserHistoryPort` 均有判别断言 | 文档归档、README 索引和评审答复已回填 | **0 项** |

## 3. 分层审查证据

### 3.1 UI 详情 / 深链产品闭环

- `packages/ui-model/src/work-item-detail-view.ts` 先检查 `read.workspace.id`，再调用既有列表投影和读门；loading / unavailable 不调用详情 getter；安全行不存在返回中性 unresolved；redacted 不带任何业务字段；详情 getter 返回 redacted 时再次擦除，封住 TD-024 撕裂读。
- `packages/ui/src/work-item-project.ts` 只组合列表与一个 `WorkItemDetailDrawer`。`packages/ui/src/work-item-detail.ts` 使用原生 `<dialog>`，标题入焦、Tab 首尾循环、Escape 只走 cancel、按钮关闭，关闭后按 opener 快照回焦。
- `apps/web/src/item-route.ts` 提供 canonical parser、`itemPath`、`browserHistoryPort` 和 push/replace/popstate/dispose 生命周期。close 使用 replace，不使用 `history.back`；深链刷新和列表入口交给同一入口。
- 真实 Chromium 证据（由 PR/ExecPlan 回填）覆盖深链刷新、Enter、Tab/Shift+Tab、Escape/按钮回焦、Back/Forward、Back 后再次 push、320/768/1200、撤权即时清空和修饰键 href。不能将 fixture 证据扩大解释为真实 Harness/Host 挂载完成。

### 3.2 路由与权限边界

- 跨 workspace 在 `deriveWorkItemDetailView` 的第一步返回 unresolved，列表 `store.list/get` 计数均为 0。
- redacted 行不生成 anchor；可见行只展示白名单 content，bindingId 不进入 DOM。
- codec 拒绝空段、`.`/`..`、畸形编码、解码后的 slash/backslash/control、多余路径；生成侧复用 parser 判据，非法目标抛 `TypeError`。
- 候选阻塞项：`packages/ui/src/work-item-list.ts:30` 的 `href: navigation.href(row.key)` 将安全行的内部 `entityId`（`row.key`）直接交给 URL。该行为与 `docs/exec-plan/completed/2026-10-01-work-item-list-states.md:115` 的既有决策“`data-*`、`href` 和 DOM id 不放内部标识”不一致。PR 自身已意识到冲突，但只把它记为“待人类裁定”，没有在当前 head 形成明确裁决、替代 token 方案或更新旧决策的 Decision Log。

### 3.3 测试是否真实判别

本地直接运行：

```text
node --test --test-timeout=120000 \
  tests/contract/ui-work-item-detail-view.test.js \
  tests/contract/ui-work-item-detail.test.js \
  tests/contract/web-item-route.test.js \
  tests/contract/ui-work-item-detail-browser.test.js \
  tests/integration/ui-work-item-detail-read.test.js
```

结果为 **25 pass / 0 fail / 0 skip**。测试具备正控和负控：可见详情内容正控、跨 scope store 访问计数、阻断态不可借缓存、redacted canary 清除、partial 行级 freshness、撕裂读、SSR HTML 转义、无写控件、完整 bundle 输入面、`node:crypto` 负控、真实 adapter 的 popstate/dispose。PR 记录的全套 contract+integration、E2E/MVP-0、typecheck、boundaries 和发布门也均通过。

判别力限制已明确：SSR 不证明焦点/历史；fixture 不证明 #229 Host 装配；非 Chromium 引擎、真机、300ms 级并发未覆盖。上述限制不应被“所有 checks pass”抹平。

### 3.4 Issue #130 / ExecPlan 验收

#130 三条验收均有对应代码和证据：

1. 列表与深链渲染同一个 `WorkItemDetailDrawer`，有 SSR 同组件断言和真实浏览器路径证据。
2. offline + authorized snapshot 保留 title/body/status/identity/time，stale 从 false 变 true；有真实 sync/read 集成测试。
3. derived 以前缀显示，无 input/select/textarea、编辑、Saved、StartWork 等写入口。

ExecPlan 已归档并更新 `docs/README.md`。其明确声明 Host 挂载归 #229，不把 fixture 视为 Host 完成；这一范围边界是诚实的。规划预算 800 未达成（当前正式代码 999/1000），但 PR 记录了原因、人类接受以及不删判别测试的取舍。

## 4. 候选 inline 意见（未提交）

### I1 — P1 / BLOCKING：href 暴露内部 entityId，违反既有列表安全决策

- **path**：`packages/ui/src/work-item-list.ts`
- **line**：30
- **side**：RIGHT
- **body**：

  > **P1 — blocking: this href puts the internal `entityId` directly into the public deep-link.** `row.key` is the internal entity anchor, and `navigation.href(row.key)` therefore emits `/projects/<projectId>/items/<entityId>`. This conflicts with the accepted #129 contract in `docs/exec-plan/completed/2026-10-01-work-item-list-states.md:115`, which says `data-*`, `href`, and DOM ids must not contain internal identifiers. The current ExecPlan only records this as “待人类裁定” and does not make a decision that supersedes the existing contract. Please either use an opaque route token/mapping or explicitly update the prior decision with a human-approved security/product rationale before merging; add a regression assertion for the chosen policy. Impact: URLs, browser history, referrers, and copied links expose an identifier the existing list contract explicitly prohibited.**

- **severity**：P1（若人类明确裁定该约束不适用于 canonical deep links，可降级为决策记录；在裁定前不应无条件合并）。

未列其他 inline 意见：本次代码、测试和路由审查未发现可定位且已证实的第二个 P1/P2/P3 缺陷。#229 Host 挂载、非 Chromium/真机和高并发属于已声明未验证范围，不应伪装成当前行级 bug；预算偏差已在 ExecPlan 与 PR 说明中披露，不建议为压行删除判别测试。

## 5. 未验证项与未追踪风险

1. **决策未完成**：内部 `entityId` 进 href 与 #129 既有决策冲突；这是唯一当前阻塞候选。
2. **真实 Host 挂载**：`#229` 仍未完成；fixture 合成 read 不等于 Host 生命周期/读取接线。
3. **浏览器范围**：只看到 Chromium 证据，未验证 Firefox/WebKit、真机和屏幕阅读器实际行为。
4. **时序范围**：未验证 300ms 级并发下快速撤权、scope 切换、popstate 与刷新同时到达的竞态。
5. **规划预算**：ExecPlan 原预算 ≤800 未达，正式仓库硬门通过；当前余量 1 行，后续修复需避免无意越过 1000。
6. **Issue 状态**：#130 当前仍 OPEN，符合“未合并前不关闭”的事实；不要把 `closedByPullRequestsReferences` 当作已交付。

## 6. 整体结论

**当前结论：暂不建议无条件合并（P1 决策阻塞）。** 除 I1 外，PR 的 UI 闭环、scope/权限 fail-closed、redacted 清除、路由 codec、真实 browser History adapter、测试判别力、#130 验收和文档回读均有充分证据；P0=0，已证实的其他 P1/P2/P3=0。合并前应由人类明确裁定“内部 entityId 是否允许作为此类 canonical href/深链标识”：

- 若维持 #129 原决策，应实现不透明 token/映射并补测试，再以新 head 重锁和重跑相关 checks；
- 若批准本 PR 的现状，应在正式 Decision Log 中明确 supersede #129 的 href 约束、记录安全/可复制深链取舍，并重新回读当前 head、checks 与 review threads。

本评审结论只针对 `e47f817676ee4c4f94120a9d2d1caa90a5cf0006`；任何 force-push、rebase 或 retarget 后均须重做事实锁定和矩阵。