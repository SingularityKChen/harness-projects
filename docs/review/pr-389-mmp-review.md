# PR #389 MMP 交付评审

- 日期：2026-10-22。
- 锁定 head：`a8fe6d2dda6789a17e9bb4cff13bc4541ef97e6a`；锁定 base：`main` / `d7e7bca6`。
- 评审账号：`Singularity-AI-Bot`（review 5609044570，APPROVE）；开发、作者回复与合并账号：`SingularityKChen`。
- 方法：独立子评审（Superpowers、qian-systems-router、first-principles-development），先建 P0–P3 矩阵再分层核对；inline 意见一次性提交。

# PR #389 MMP 审查证据

> 以下为旧 head 的初审记录；修复状态 Superseded by「2026-10-22 七条意见修复」；初始 P0–P3 判断保留为证据，不转移到新 head。

- 锁定：head `a8fe6d2dda6789a17e9bb4cff13bc4541ef97e6a`，base `d7e7bca6`（#373 的合并提交）。审查时 main 为 `5f4dcbe6`（多出 #362、#297、#335），与本 PR 只在 `docs/README.md` 索引行重叠。
- 范围：issue #357。ui-model 的六位置谱系条派生，加一份共享年龄规则（只认 `confirmedAt`，默认 5 分钟，等于阈值即陈旧）；client 增加纯类型子路径 `./delivery`。
- 矩阵结论：P0 无、P1 无；P2 三条，P3 四条，另有一条 P3 观察不发 inline。
  - P0 已排除：verify 三层 1777/1777、MVP-0 7/7；四 PR 并集 1859/1859、boundaries 9/9（见文末「批次并集」）；浏览器包不含 client 运行时（只有 keys）；发布面扫描通过；A6 加 K4 证明没有规划控件。
  - P1 已排除：未确认 / 陈旧 / 超龄派生不出 passed；年龄不认 `attemptedAt`；六个位置与 core 的跳一一对应，Branch 由 worktree 的 label 承载，并行节点保序，缺口不补关系；只有一个年龄判定点；#297 不改投影读路径。
  - P1 降级：未来的 `confirmedAt` 夹零后 fresh，这是 ADR-0011 第 3 条明文，窗口为偏差加阈值，要改需人类修订 ADR，记为 P3 观察。
- P2：
  1. `derive.ts:24`：D17 收紧 `assertTimestamp`，没有测试；回退变异 D1 SURVIVED。client 的 `readClock` 接受 `2026-02-30T00:00:00Z`，而 head 的 `deriveWorkItemList` 抛错（base 接受）。
  2. `delivery-lineage.ts:96`：节点丢掉 `relationState`，A11 还禁读它。真实投影中工作树之后的跳全是 `deterministic/candidate`，派生成 observed / passed，与 #150 的验收「候选不得显示为已确认」冲突，Decision Log 里也没有这项取舍。
  3. tracker:78（TD-084）：翻转时机的义务没有写进 #234 / #281；「间隔不大于阈值」最坏会让 passed 多挂一个间隔，要精确翻转，消费方只能自己再写一份年龄规则。建议本 PR 输出 `nextFlipAt`。
- P3：合约夹具 `relationSource: 'provider'` 不是枚举值，e2e 没有断言候选（e2e:34）；`deliverySetFreshness(null)` 抛原生 TypeError，与注释不符（:33）；TD-083 的延期理由因 #373 已合并而过时，#297 之后分叉方向反转（tracker:77）；ExecPlan 第 251、254 行留着被推翻的结论（:251）。
- 关键验证命令（在检出本 PR head 的工作树根目录运行）：
  - `node scripts/review-mutate.mjs <spec>`：strip 两文件 15 个变异全部 KILLED；`tests/contract tests/e2e` 上 D1 SURVIVED。
  - `node --test --test-timeout=120000 tests/contract/ui-delivery-lineage-strip.test.js tests/e2e/delivery-lineage-strip.test.js`：四个时区各 16/16。
  - 分叉复现在 base 与 head 各跑一次：base 为 ok，head 抛 TypeError。
  - 真实投影探针：`composeCore` + `createFakeProviders()` + `refreshDeliveryFacts` → `deriveDeliveryLineageStrip`。
- 验收：#357 的 4 条全部满足（A2/A11、A3/A5/A10/E1、A4、A6，均有变异证据），scope 的 3 条也满足。
- 非阻塞的红检查：`matrix.check`、`Reconcile engineering state` 是被重复运行取消；`Create review session` 是本机 DSH 端点未监听。
- 结论：APPROVE。P2 与 P3 由作者在原 PR 内修复，修复本身需要独立复评，然后归档、整合提交、勾选 #357 验收，并在 #234 / #150 补承接验收；是否合并由人类决定。

## 批次并集

本批四个 PR（#388–#391）合进 `main@5f4dcbe6`（已含 #297、#335），冲突只在 `docs/README.md` 与技术债表（两边保留）。先 `pack:plugin` 再 `pnpm verify`：1859/1859、MVP-0 7/7；`pnpm run boundaries` 9/9；`workflow-check` 与 `git diff --check` 通过。

## 2026-10-22 七条意见修复

执行上下文：`.worktrees/delivery-lineage-strip`，分支 `feature/delivery-lineage-strip`，本批起点 `2241ce3f1236f571dec14c9dbfea8e206d2649bd`（已由协调者变基到 `main@0d8d6094`）。人类继续修复 #388–#391 的授权记录于 ExecPlan D19；本 owner 未提交、push、回帖、改 Project 字段或合并。

### 根因与边界

关系确认是 Core 已存在的独立事实，透传 `relationState` 不构成重新识别；candidate 的 CI 可以 passed，但关系仍是 candidate。`ageOf` 同时产生新鲜度和 `nextFlipAt`（Unix 毫秒）；消费方只负责按返回时刻重新派生，不存在第二套年龄规则，也没有把纯函数改成调度器。

| commentID | 修复与判别证据 | 本地结果 |
|---|---|---|
| 4344366118 | A12 经公共 deriveWorkItemList 拒绝 02-30/非闰年 02-29，合法 2024-02-29 通过；D1 回退到旧正则+Date.parse | A12 初始绿；D1 只由 A12 杀死，补齐原测试缺口 |
| 4344366123 | LineageNode 原样保留 Core relationState，A13 证明 candidate/confirmed 与 passed/stale 正交；A11 仍禁止 from/to/type/source 重识别 | A13 原树缺 relationState 为红，修复后绿；D2/D3 KILLED |
| 4344366129 | 合约夹具改为 explicit/confirmed 命令跳、deterministic/candidate 读取跳；E1 使用真实 Core 同时核对投影和派生节点 | E1 原树红，修复后绿；D8 伪装 confirmed 由 E1 杀死 |
| 4344366130 | null 与 undefined 均降级为 unconfirmed，入参类型同步允许 null | A5 原树抛原生 TypeError；修复绿，D4 KILLED |
| 4344366133 | TD-083 更新为 #373 已合并、#297 写者路由拒绝后 stale/available 可并存；D9 与旧并集结论原处 superseded | 100 项相关回归含 Fake/SQLite route-denial；#234 精确承接已发布并回读，comment `6333217297` |
| 4344366139 | nextFlipAt 由共享年龄规则给出最早 fresh 集合边界；A14 钉边界前/等值、后续集合、无待翻转及自定义阈值；撤销粗轮询建议 | A14 原树 undefined 为红，修复绿；D5–D7 KILLED；#234/#281 消费验收已发布并回读，comments `6333217297` / `6333218148` |
| 4344366144 | Outcomes 的 TD-085 延期与等待 #373、落后 main/旧并集结论原处标注 superseded；API/消费方义务与索引同步 | 文档事实区分历史快照、当前本地验证和待发布结果 |

### 命令与结果

在上述分支工作树根目录运行；`REVIEW_TMP` 指协调者本次临时评审目录。运行态 spec/log 不加入仓库。

```sh
node --test tests/contract/ui-delivery-lineage-strip.test.js tests/e2e/delivery-lineage-strip.test.js
# 19/19，exit 0；修复前 contract 11/17（6 红），E1 候选断言红
pnpm run typecheck
# exit 0
node --test tests/e2e/delivery-lineage.test.js tests/integration/delivery-repository-routing.test.js tests/contract/ui-model-presentation.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/client-browser.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/package-boundaries.test.js
# 100/100，exit 0，含真实两 Storage、浏览器 bundle 与边界
node scripts/review-mutate.mjs "$REVIEW_TMP/pr389-repair-mutations.json"
# D1–D8 全部 KILLED，exit 0；前后基线通过，按原字节恢复
```

| 变异 | 错误行为 | killedBy |
|---|---|---|
| D1 | 公共日期守卫恢复旧正则+Date.parse | A12 公共列表派生 |
| D2 / D3 | relationState 恒 confirmed / 恒 candidate | A13 关系确认态 |
| D4 | 删除 null 守卫 | A5 未确认与标陈旧 |
| D5 / D6 | 取最晚翻转 / 由 now 推后翻转 | A14 最早翻转时刻 |
| D7 | 年龄等于阈值仍 fresh | A14 最早翻转时刻 |
| D8 | 真实 Core candidate 在节点中伪装 confirmed | E1 真实投影 |

发布面补充：对 `main@0d8d6094` 到当前未提交工作树的 diff 使用现有 `scanDiff`/`tally`，并对未跟踪评审文档使用 `scanText`；机械命中 0，代码 536 行、文档低于 1300 行。五类目人工检查未发现凭据、本机身份/路径、个人信息、内部系统或保密字样泄露；`git diff --check` exit 0。此结果覆盖未提交修复，不冒充已经执行最终提交范围扫描。

### 交付判定与下一道门

本地源码与文档修复覆盖七条意见；没有新增 Provider 调用、Planning 写入、持久化模型或运行时依赖。P0/P1 原风险仍由相关回归保护。共享规则的翻转工具已具备，实际页面打开/刷新/翻转/恢复/卸载调度仍属 #234/#281；#150 确认命令仍属人类显式确认。

外部 handoff 已由协调者用开发账号发布并回读：#234 comment `6333217297`；#281 comment `6333218148`；#150 comment `6333219027`。评论明确这些是PR #389修复分支的消费验收，不把未来定时渲染当成已完成；未写Project字段或依赖关系。独立复评、提交整合、最终 head CI/threads 回读、原线程回复/resolve 均在本地交付之后。不重跑无新增风险的全仓 verify，不借旧 head CI 作为本批验证。

独立复评APPROVE（2026-10-22）：目标19/19，临时副本八项变异全KILLED、归因和字节恢复确认；Fake/SQLite真实路由拒绝、未来时间/零阈值/最早翻转边界的独立探针3/3，三条外部承接均经API回读。冻结产品哈希与当前源/测试一致，未由实现者批准自身修改。

修复固定输入并集验证（2026-10-22 SGT）：独立临时检出 `test/repair-queue-pr388@7e5ab3d6a8093a3521a8d759c5b8a7a9507c2b52` 按#390→#389→#391→#388组合四个已独立复评的产品修复，`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` exit0，之后`CI=true pnpm verify`为1886/1886 + MVP-0 7/7、fail0。只发生索引/技术债表冲突并保留双方记录，产品blob清单SHA-256 `4e0a28e18b93b86710c70640095cf52ff7f4df92a9430574e1bb892cc1c43e90`。这不是某一PR单独head的CI，实际合并仍需当前head/base门禁与批准。

最终整合：在#390已合并后的真实`main@2f51f13099e273eaaf1a5e14b27825e7686bb5bc`上变基，冲突仅为索引与技术债表，保留双方事实。谱系源码与两份测试的blob保持独立复评字节，继承共享扫描helper不改变派生/关系/年龄语义；新head的受影响测试、CI和批准重新锁定。
