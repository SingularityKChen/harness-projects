# 交付谱系跳字段退役（#633）ExecPlan

> 状态：Completed（工程范围；最终远端门禁与 rebase 合并按回读规则执行）
> 创建：2026-11-20
> 范围：退役常量 `DeliveryLineageHop.observed` / `detail` 在 Core 生产者、Client 解码器、夹具与断言中的全部痕迹；不改变链节点观察、缺口、来源、新鲜度、Host 操作与纯读语义。
> 上游输入：issue #633（正文含 #224 的 2026-11-13 消费审计结论）；`docs/exec-plan/completed/2026-10-08-delivery-fact-writer.md:1031` 已登记这两个字段为死代码。本地只读提案不随仓库分发，本计划不依赖它成立。

## Purpose / Big Picture

完成后，交付投影的"跳"只携带会变化的结论：关系类型、来源与确认态、端点、实体种类、外部标识/标签、能力可用性、工程事实与陈旧标记。`observed` 恒为 `true`、`detail` 恒为 `undefined` 这两个字段从 `DeliveryLineageHop` 类型、Core 生产者的字面量、Client 解码器的允许键列表和合成夹具中消失；Host 返回的 JSON 投影不再包含它们，旧形状在 Client 解码时按 `TypeError` 失败关闭。

最小成功证据：解码器对"带退役字段的跳"拒绝、对"不带退役字段的同一跳"接受（正负对照各一）；`pnpm run typecheck` 通过；受影响的 Core / Client / UI-model 测试 `fail 0`；`ChainNode.observed` 与缺口相关测试原样通过。退役只清理从来不携带状态的字段，不声称行为或安装产品验收。

## Context and Orientation

- **跳（hop）**：`DeliveryProjection.hops` 的一项，读时由"已提交快照节点 + 关系表里的边"拼出，不是落库记录（`packages/core/src/delivery.ts:24-33,140-179`）。
- **链节点（ChainNode）**：交付事实写入侧的节点形状，`observed` 区分真实观察与骨架（`packages/core/src/relations.ts:21-24`；`packages/core/src/chain-facts.ts:138-139`）。
- **缺口（gap）**：链上某位置为何没有跳，由本地事实算出，原因在 `DeliveryGapReason`（`delivery.ts:44-47,154-173`）。
- **解码器**：Client 只解码 Host 权威投影；`record()` 用允许键列表拒绝多余键（`packages/client/src/delivery-lineage-reader.ts:10-13,32`）。

当前事实（2026-11-20 在分支 `refactor/delivery-lineage-hop-fields` 工作树根核对）：

1. `DeliveryLineageHop` 声明 `observed: boolean`、`detail: string | undefined`，生产者字面量写死 `observed: true, detail: undefined`（`packages/core/src/delivery.ts:28-29,149-153`）。
2. 跳只由 `(set?.nodes ?? [])` 里的节点生成（`delivery.ts:165-172`），而写入侧只保存 `node.observed` 为真的节点（`packages/core/src/delivery-facts.ts:32-52`），因此 `observed` 结构上不可能为 `false`。
3. `detail` 只在骨架节点上出现（`chain-facts.ts:299-337`）；骨架 `observed: false`，不会成为跳，"为何缺失"由缺口表达（`delivery.ts:154-173`）。
4. 读路径只读持久化快照（`delivery.ts:143-146`）；`DeliveryNodeFact` 不含 `observed`/`detail`（`packages/capabilities/src/storage.ts:266` 附近），快照 JSON 从未持久化这两个字段。
5. 生产消费者为空：`toDeliveryFacts` 只用 `hop.fact`（`packages/core/src/projection.ts:108-112`）；controller 原样转发（`packages/controller/src/queries.ts:51-52`）；Host 处理器原样返回投影（`apps/harness-plugin/src/host-composition.ts:139-148`）；ui-model 只读 `entityKind/externalId/label/fact/stale/unavailable/relationState` 与 freshness/gaps（`packages/ui-model/src/delivery-lineage.ts:85-116`）；插件 wiring 只调 `getDeliveryProjection`/`refreshDeliveryFacts`（`apps/harness-plugin/src/client.ts:83-86`）。
6. 唯一把字段形状写进测试的是合成夹具 `tests/contract/ui-delivery-lineage-strip.test.js:37-38`；另有 5 处断言读取该字段（`tests/e2e/delivery-lineage.test.js:124,178`；`tests/integration/github-development-lineage.test.js:192`；`tests/integration/delivery-repository-routing.test.js:125,134`）。

## Design / Spec

**选择：整体退役（类型 + 生产者 + 解码器 + 夹具/断言）。**

- 类型：从 `DeliveryLineageHop` 删除两个字段；生产者字面量不再写它们；接口注释不暗示逐跳观察标记。
- 解码器：从 hop 允许键列表删除 `'observed'`、`'detail'`，不新增任何校验。旧 Host 载荷因此 `TypeError`，这是唯一跨边界行为变化，且是失败关闭（fail-closed）的预期结果。
- 测试：把"重复当前形状"改成"断言保留的真实状态"——外部标识、关系确认态、事实、陈旧、来源；再补解码器正负对照。

**放弃的方案**

1. 保留并从 `ChainNode` 派生：读路径只有持久化快照，`DeliveryNodeFact` 无这两个字段；要派生就得落第二份权威或让骨架重新成为跳，逆转 #222 的缺口设计。放弃。
2. 保留但收窄到"被消费的层"：审计结果是没有任何层消费，收窄退化为删除。放弃。
3. 保留字段、在解码器强制 `observed === true` / `detail === undefined`：这是同义反复的并行不变量，不携带状态，只增加维护面。放弃。
4. 保留为 deprecated 兼容字段：仓库预发布，无迁移/兼容义务；兼容路径会让同一事实有两个形状。放弃。

**明确不在本 PR 范围**：常量 `hop.source`（恒为 `lineage`，独立语义标记，issue 只点名 observed/detail）；`ChainNode.observed` 与骨架跳；`DeliveryGap`/原因、provenance、权限遮罩、freshness/`stale`/`confirmedAt`、仓库隔离、纯读；Host 操作名、参数、作用域与错误；存储/schema/迁移。

**不变量**：退役后 `grep -Rn "hop\.observed\|hop\.detail" packages apps tests` 无命中；`ChainNode.observed` 的过滤与锚点守卫代码零改动；快照行数、关系表、修订号不变。

## Global Constraints

- 允许改动的 tracked 文件集合（唯一声明，他处不复述）：`packages/core/src/delivery.ts`、`packages/client/src/delivery-lineage-reader.ts`、`tests/integration/harness-plugin-delivery-lineage.test.js`、`tests/e2e/delivery-lineage.test.js`、`tests/integration/github-development-lineage.test.js`、`tests/integration/delivery-repository-routing.test.js`、`tests/contract/ui-delivery-lineage-strip.test.js`、本计划、`docs/README.md`、`docs/review/pr-667-mmp-review.md`。
- 不新增校验、兼容分支、别名、迁移脚本、生成文件或锁文件变更；不改 storage/provider/controller/Host 签名。
- 预发布仓库：不设计向后兼容；旧投影形状失败关闭即可。
- 文档正文中文，标识符/路径/命令英文；计划 ≤260 行；代码变更 ≤1000 行、文档变更 ≤1500 行。
- 原始限制：不自行合并、不写看板 `Status`；人类评审由协调者组织。Superseded by D8（2026-11-21）：本次直接条件授权覆盖 PR #667 的 rebase 合并；看板规划状态仍由人类拥有。

## Plan of Work

### Batch 1 · 红先行：解码器拒绝退役字段（契约翻转）

**最小闭环**：先让新解码器反例变红，再一次性完成类型、生产者、解码器和三处生产形状断言的翻转，使受影响的窄测试回到绿。

**涉及文件**：`packages/core/src/delivery.ts`、`packages/client/src/delivery-lineage-reader.ts`、`tests/integration/harness-plugin-delivery-lineage.test.js`、`tests/e2e/delivery-lineage.test.js`、`tests/integration/github-development-lineage.test.js`、`tests/integration/delivery-repository-routing.test.js`。

**步骤**

1. 在 `tests/integration/harness-plugin-delivery-lineage.test.js` 第二个测试（`client delivery envelope rejects scope, projection and Host-time wire defects`）内，定义字段合法的一跳 `const legacyHop = { relationType: 'tracks', source: 'lineage', relationSource: 'explicit', relationState: 'confirmed', provenance: 'command', from: 'ctx-from', to: 'ctx-to', entityKind: 'execution_context', externalId: 'ctx-1', label: undefined, unavailable: false, fact: undefined, stale: false }`。
2. 加正对照：把 `legacyHop` 放进投影 `hops`，`reader.read(scope)` 必须成功（当前与退役后都成立）。
3. 加负对照（**红先行**）：对 `field of ['observed', 'detail']`，构造 `hops: [{ ...legacyHop, [field]: true }]`，断言 `assert.rejects(..., TypeError)`。在未改解码器前该断言失败（解码器允许键仍含这两个键）。
4. 运行红命令并在 `Progress` 记录退出码与失败行：
   `pnpm run test:file tests/integration/harness-plugin-delivery-lineage.test.js`
   期望：**exit 1**，新增子测试报 `Missing expected rejection`（observed 与 detail 各一次）；其余用例仍 pass。
5. 改 `packages/core/src/delivery.ts`：删除接口里的 `readonly observed: boolean` 与 `readonly detail: string | undefined`，删除 hop 字面量的 `observed: true, detail: undefined,`；保留其余字段与注释，注释不得再暗示逐跳观察标记。
6. 改 `packages/client/src/delivery-lineage-reader.ts:32`：hop 允许键列表删除 `'observed'`、`'detail'`；不加新判断。
7. 重写读取退役字段的断言，改为断言保留状态：
   - `tests/e2e/delivery-lineage.test.js:124`：提交跳断言 `typeof commitHop.externalId === 'string' && commitHop.relationState === 'confirmed' && commitHop.source === 'lineage'`。
   - `tests/e2e/delivery-lineage.test.js:178`：CI 跳断言 `ci.every((hop) => typeof hop.externalId === 'string' && hop.stale === false && hop.source === 'lineage')`。
   - `tests/integration/github-development-lineage.test.js:192`：改为 `projection.hops.every((hop) => typeof hop.externalId === 'string' && !hop.stale && hop.source === 'lineage')`。
   - `tests/integration/delivery-repository-routing.test.js:125`：helper 的元组去掉 `hop.observed`，只留 `[hop.entityKind, hop.externalId]`；`:134` 期望元组同步去掉末尾 `true`；`:285` 仍是 helper 输出自比较，不改。
8. 运行绿命令（在同一工作树根、分支 `refactor/delivery-lineage-hop-fields`）：
   `pnpm run test:file tests/integration/harness-plugin-delivery-lineage.test.js tests/e2e/delivery-lineage.test.js tests/integration/github-development-lineage.test.js tests/integration/delivery-repository-routing.test.js`
   期望：`fail 0`，exit 0，正负对照均出现。
   `pnpm run typecheck`
   期望：exit 0（ui-model 与 client 的类型叶子无残留引用）。

**回滚**：本批次一个 commit；`git revert <batch-1-commit>` 即恢复旧类型与解码器，数据无迁移、无清理。若红步骤因"解码器早已拒绝"而失败，停止并核对 `delivery-lineage-reader.ts:32`，不得跳过红色证据继续。

### Batch 2 · 夹具形状清理与全量验证

**最小闭环**：删除合成夹具里最后一次字段形状复制，跑相邻展示消费者与完整门禁，证明退役没有改变谱系条呈现。

**涉及文件**：`tests/contract/ui-delivery-lineage-strip.test.js`。

**步骤**

1. 删除 `tests/contract/ui-delivery-lineage-strip.test.js:37-38` 中的 `observed: true,` 与 `detail: undefined,`；其余字段、`:145` 的"禁止重新识别"读取守卫和 `extra` 覆盖机制保持不变。
2. 运行 `pnpm run test:file tests/contract/ui-delivery-lineage-strip.test.js tests/contract/ui-delivery-lineage-section.test.js tests/e2e/delivery-lineage-strip.test.js`，期望 `fail 0`，exit 0。
3. 运行 `pnpm run test:file tests/e2e/controller-roundtrip.test.js`，期望 `fail 0`（Host→client 往返不受投影键减少影响）。
4. 运行 `pnpm run verify`，期望 exit 0（typecheck + contract/integration/e2e 三层全绿）。
5. 机械核查：`grep -Rn "hop\.observed\|hop\.detail\|observed: true, detail" packages apps tests` 期望无输出；`git diff --check` 期望无输出。

**回滚**：`git revert <batch-2-commit>` 只恢复夹具两个键；Batch 1 的退役仍成立。整个 PR 的回滚边界是单次 `git revert` 全量提交，不需要数据库清理（字段从未持久化）。

### Batch 3 · 评审、归档与交付提交

独立评审完成后归档本计划、更新文档索引并保留评审证据，整合为一个合同清理交付提交。产品和测试路径必须与首审 head `7ba19b9ad6dc0a48162d9ca3c234dc7bc7cc1854` 字节相同；命令 `git diff 7ba19b9ad6dc0a48162d9ca3c234dc7bc7cc1854 HEAD -- packages apps tests` 期望空。最终检查与独立复评执行方式见评审记录，不重复历史全量门。恢复点为本地 `refs/backup/pr-667-review-20261121`；公开合并采用 rebase。

## Validation and Acceptance

- 红色证据（实现者必须在 Batch 1 第 4 步记录真实输出）：`pnpm run test:file tests/integration/harness-plugin-delivery-lineage.test.js` → exit 1，`Missing expected rejection`；若输出不同，以实际输出为准并在 `Surprises & Discoveries` 说明。
- 绿色证据：Batch 1 第 8 步与 Batch 2 第 2–4 步的命令 exit 0 且 `fail 0`；`pnpm run typecheck` exit 0。
- 保留行为：`tests/integration/provider-binding-registration.test.js`（`ChainNode.observed` 四集合）、`tests/e2e/delivery-lineage.test.js` 缺口用例（`:646-651`、`:708-709`）、`tests/integration/harness-plugin-delivery-lineage.test.js` 第一个测试（Host 查询作用域、纯读、刷新计数）全部保持绿。
- 人工判定：PR 描述写明"无存储/schema 变更、无数据库行变化；旧 Host 形状在 Client 失败关闭是预期；不声称安装产品验收"。
- 可复现上下文：全部命令在检出 `refactor/delivery-lineage-hop-fields` 的工作树根运行；`gh` 命令需带 `-R SingularityKChen/harness-projects`。

## Progress

- [x] (2026-11-20 计划创建) 写完本 ExecPlan 与 `docs/README.md` Active 索引行；未开始实现。
- [x] Batch 1 红证据（2026-11-20，在检出 `refactor/delivery-lineage-hop-fields` 的工作树根运行）：`pnpm run test:file tests/integration/harness-plugin-delivery-lineage.test.js` → exit 1，`ℹ pass 4 / fail 1`，新增负对照 `actual: [ 'observed:accepted', 'detail:accepted' ]` / `expected: [ 'observed:TypeError', 'detail:TypeError' ]`；红测试提交 `398aa8b1`。
- [x] Batch 1（2026-11-20）：类型/生产者/解码器退役 + 断言重写（四处计划内 + 一处计划外，见 Surprises）；`pnpm run test:file tests/integration/harness-plugin-delivery-lineage.test.js tests/e2e/delivery-lineage.test.js tests/integration/github-development-lineage.test.js tests/integration/delivery-repository-routing.test.js` → exit 0，`ℹ tests 81 / pass 81 / fail 0`；`pnpm run typecheck` → exit 0；实现提交 `6c0c6389`。
- [x] Batch 2（2026-11-20）：合成夹具清理；`pnpm run test:file tests/contract/ui-delivery-lineage-strip.test.js tests/contract/ui-delivery-lineage-section.test.js tests/e2e/delivery-lineage-strip.test.js` → exit 0，`ℹ tests 40 / pass 40 / fail 0`；`pnpm run test:file tests/e2e/controller-roundtrip.test.js` → exit 0，`ℹ tests 25 / pass 25 / fail 0`。
- [x] Batch 2（2026-11-20）：`pnpm verify` → exit 0（contract 1616、integration 实际 2294 / 收集 2322 / skipped 28、e2e 226；均 fail 0）；机械 `grep -Rn "hop\.observed\|hop\.detail\|observed: true, detail" packages apps tests` 无输出（grep exit 1）；`git diff --check` 无输出。
- [x] (2026-11-20 22:04 SGT) 独立对抗验收 P3：`detail` 负对照值从 `true` 改为旧类型真实字符串 `'legacy'`，重跑 `pnpm run test:file tests/integration/harness-plugin-delivery-lineage.test.js` → exit 0，5/5 pass。
- [x] (2026-11-20 22:11 SGT) PR #667 回读：head `2ee67f5e5006a2eda1af47ad79482ff4c8fa6d19`、base `main` @ `33fcde29`；`closingIssuesReferences` = [633]；`PR Fast Gate` / Verify / Browser / Windows Native 全 pass。
- [x] (2026-11-21 10:14 SGT) 独立 MMP 全矩阵审查无 P0–P3，评审账号提交 APPROVE；人类在本次请求中直接给出条件收尾授权（D8），不冒充人类已逐行审阅。
- [x] (2026-11-21 10:14 SGT) 工程证据及恢复规则已保存于评审记录，计划移入 Completed；最终整理后的 head 仍须独立复评与远端门禁。

## Surprises & Discoveries

- 独立核对发现：`getDeliveryLineage` 只是 Core/controller 查询（`packages/core/src/queries.ts:75,108-110`、`packages/controller/src/queries.ts:22,51`），不是 Host 操作；Host 操作表只有 `getDeliveryProjection` 与 `refreshDeliveryFacts`（`apps/harness-plugin/src/host-operations.ts:153-154`）。因此本 PR 不改任何 Host 操作签名，唯一 wire 变化是投影内 hop 键减少；计划据此不列 Host 操作改动。
- 提案 outline 的文件名与本任务指定路径不同，已在 `Decision Log` D4 记录，计划以指定路径为准。
- 额外审计发现：`CoreQueries.getDeliveryLineage` 除测试外没有生产消费者（`packages/core/src/queries.ts:108-110`），它只是 `getDeliveryProjection().hops` 的转发。它不是 Host 操作，本 PR 按其现存接口保留；是否另行退役应作为独立 issue 决策，避免扩大本切片。
- 计划漏列第五处跳字段读取（2026-11-20 实现时发现）：`tests/integration/github-development-lineage.test.js:60` 写的是 `changeRequest?.observed`，变量名不是 `hop`，因此计划枚举的 5 处与机械 `grep "hop\.observed"` 都匹配不到；删除类型字段后窄测试报 `actual: [ '精确', 'PR_target', undefined ]` 才暴露。该处已改为断言 `provenance === 'provider_read'`，仍在本切片与 `Global Constraints` 文件集合内。
- 计划建议的提交跳替换断言与既有断言矛盾（2026-11-20）：计划写 `commitHop.relationState === 'confirmed'`，但同一用例 `:187-188` 明确说明 `derived_from` 是确定性发现、只能是 `candidate`（`packages/core/src/relations.ts:47-50,70-71`）。改为 `typeof commitHop.externalId === 'string' && commitHop.provenance === 'provider_read' && commitHop.source === RelationSource.Lineage`，断言保留状态而不重复旧形状。
- 红证据呈现方式（2026-11-20）：逐字段 `assert.rejects` 循环会在首个失败停止，只报 `observed`；改为 `Promise.all` 对两个字段各取结论后一次 `deepEqual`，红输出同时显示 `observed:accepted` 与 `detail:accepted`。
- 独立对抗验收发现（2026-11-20）：`detail` 负对照原用 `true`，但退役类型是 `string | undefined`，真实旧 JSON 不会序列化 `detail: undefined`；改成 `'legacy'` 后既覆盖未知键拒绝，也与旧类型形状一致。

## Decision Log

- D1 · 退役两个字段（而非保留/派生/兼容）。Rationale：没有任何生产/Host 消费者；`observed` 由构造恒真、`detail` 由构造恒 `undefined`；保留需要第二份权威并逆转 #222 缺口设计。Date/Author：2026-11-20 21:45 SGT / plan-633。
- D2 · 保留 `ChainNode.observed`、骨架语义、`DeliveryGap`/原因、provenance、权限、freshness、仓库隔离、纯读与 Host 操作。Rationale：这些是真实状态与既有验收对象；本 PR 只删除无状态字段。Date/Author：2026-11-20 21:45 SGT / plan-633。
- D3 · 常量 `hop.source` 不在本 PR 退役。Rationale：issue #633 只点名 `observed`/`detail`；`source` 有独立语义与既有断言，混入会扩大写入面。Date/Author：2026-11-20 21:45 SGT / plan-633。
- D4 · 计划路径采用 `docs/exec-plan/active/2026-11-20-delivery-lineage-hop-fields.md`；提案 outline 里的 `2026-11-20-delivery-hop-field-retirement.md` 被本决定取代（Superseded by D4，2026-11-20）。Date/Author：2026-11-20 21:45 SGT / plan-633。
- D5 · 旧投影形状在 Client 失败关闭，不提供兼容解码。Rationale：仓库预发布、无迁移义务；单 PR 原子更新生产者与解码器，兼容路径会造成双形状。Date/Author：2026-11-20 21:45 SGT / plan-633。
- D6 · Batch 1 拆成“红测试提交 `398aa8b1` + 实现提交 `6c0c6389`”两个 commit（取代 Plan of Work “本批次一个 commit”的提交粒度表述；退役设计不变）。Rationale：TDD 要求先提交可复现的红色基线，再提交转绿实现，审阅者能逐 commit 复核红→绿；回滚 Batch 1 需 revert 两个 commit，数据无迁移、无清理步骤。Date/Author：2026-11-20 22:19 SGT / impl-633。
- D7 · 对抗验收 P3：负对照的 `detail` 值采用 `'legacy'` 字符串（旧类型 `string | undefined` 的真实形态），不采用 `true`。Rationale：前者同时证明未知键拒绝与旧类型形状，后者只证明任意未知键被拒绝，可能在“重新允许 detail + 类型校验”的未来变异下漏报。Date/Author：2026-11-20 22:04 SGT / lead（依据 adv-633 P3）。

- D8 · 2026-11-21 10:14 SGT / 本会话人类条件授权与协调者：用户点名评审 PR #667–#669，并要求“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续”，依次修复、复评、归档、整合 commit、核对 issue 后以 `merge_method=rebase` 合并。本决定对 PR #667 生效；仅在当前 head 无 P0/P1 且门禁通过时合并，不变更 Planning Status 或 blocking 关系。将历史红绿提交收敛为一个可审阅/回滚的交付提交；D6 的历史拆分保留作取证，最终提交粒度由本决定取代。

## Idempotence and Recovery

- 重跑安全：所有验证命令只读或使用临时沙箱库，不依赖上一次运行的残留；`grep`/`git diff --check` 可任意重复。
- 失败恢复：任一绿命令失败时，先 `git diff` 定位到 Batch 1 的六个文件之一，`git restore <path>` 回到已知良好状态后重做；红证据必须保留原始输出，不因"看起来该红"而补写。
- 回到已知良好状态：`git revert` 对应批次 commit，或 `git checkout 33fcde29 -- <paths>`（基线 `33fcde29`）；无数据库/迁移清理步骤。
- 分支改写、push、PR 状态由协调者按 `docs/development/workflow.md` §3.1 执行；本计划不授权 agent 合并。

## Interfaces and Dependencies

- 运行时：Node.js ≥22、pnpm 10.28.2（`package.json`）；命令 `pnpm run typecheck`、`pnpm run test:file`、`pnpm verify` 已存在。
- 类型依赖链：core `DeliveryLineageHop` → controller 查询返回 → client `DeliveryProjection` 纯类型叶子（`packages/client/src/delivery.ts:1-4`）→ ui-model 派生；tsc 会捕获任何残留读取。
- wire 契约：Host `getDeliveryProjection` 参数/作用域/错误不变；返回 `projection.hops[]` 不再含两个键。`refreshDeliveryFacts` 不变。
- 外部依赖：无凭据、无网络、无 Provider 调用；`gh` 仅用于 issue 回读与 PR 关联（`-R SingularityKChen/harness-projects`）。
- 上游依据：issue #633、parent #224、ADR-0011（新鲜度年龄规则）、`docs/exec-plan/completed/2026-10-08-delivery-fact-writer.md:1031`。

## Outcomes & Retrospective

历史状态（2026-11-20，在检出 `refactor/delivery-lineage-hop-fields` 的工作树根、基线 `33fcde29`）：实现与本地验证完成、等待人类评审。Superseded by D8 与本节收尾记录（2026-11-21）。

- 退役：`DeliveryLineageHop` 删除 `observed`/`detail`，生产者不再写这两个键，client 解码器移除两个允许键；旧 Host 投影形状按 `TypeError` 失败关闭，不提供兼容路径。
- 断言：四处计划内断言 + 一处计划外（`changeRequest?.observed`）改为断言外部标识 / provenance / 陈旧 / `lineage` 来源；合成夹具删除两个键。`ChainNode.observed`、缺口、provenance、freshness、权限遮罩与纯读逻辑零改动。
- 证据：Batch 1 红 exit 1（`pass 4 / fail 1`，`observed:accepted` / `detail:accepted`）；退役后四个窄测试 81 pass / 0 fail、typecheck exit 0；Batch 2 展示层 40 pass / 0 fail、controller 往返 25 pass / 0 fail；`pnpm verify` exit 0（contract 1616、integration 2294、e2e 226，0 fail）。
- 与计划偏差：Batch 1 拆成红测试与实现两个 commit（D6）；补充计划外第五处断言并改用 provenance（Surprises）；无新增技术债，未声称安装产品验收。

独立首审实际执行 179 项窄测试、typecheck、10 项边界与 6/6 有失败归因的变异，全部通过；#633 工程验收成立。当前无新增技术债；#224/#632、安装产品与 R1 继续独立。最终远端状态按评审记录回读，不能把旧 head 的批准沿用到整理后的提交。

## Bottom Change Note

- 2026-11-20 21:45 SGT / plan-633：创建本 ExecPlan；建立退役选择、两批工作、红先行解码器证据与回滚边界。
- 2026-11-20 22:20 SGT / impl-633：按 Batch 1–2 执行完毕，补记 Progress 真实命令/exit code/条数、三条 Surprises、D6 提交粒度决定与 Outcomes；未改动 Design / Spec、范围与 `Global Constraints`。

- 2026-11-21 10:14 SGT / 协调者：按 D8 保存 MMP 证据、归档计划并安排单个交付提交；产品合同未改变，最终 head 重锁复评。
