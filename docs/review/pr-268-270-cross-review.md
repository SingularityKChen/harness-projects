# PR #268 / #269 / #270 跨 PR 并集与 MMP 系统审查

> 评审时点：2026-10-06（Asia/Shanghai）。锁定远端 `main` 与三个当前 head：#268 `8b258952e704f678f032736a83f53aa7ec4e3a4f`、#269 `e47f817676ee4c4f94120a9d2d1caa90a5cf0006`、#270 `e34529c5c06c722be1ba9ed75c80367dd6471aca`。三者 base 均为 `main`；#268 `mergeable=MERGEABLE / mergeStateStatus=UNSTABLE`，#269/#270 `MERGEABLE / CLEAN`。本文只记录跨 PR 证据，不修改产品代码。

## 1. 结论摘要

- **没有被跨 PR 反例直接证实的 P0/P1 运行时正确性缺陷**；但 #268 的仓库硬规模门为 **代码 1808/1000、PR size 红**，这是硬约束候选 P0，除非沿用人类「接受实测规模」裁定并明确作为合并例外，否则不应合并。
- **合并不是任意排列**：三条 PR 都共同修改 `docs/README.md`，任何排列都至少需要手工取并集；这不是“无冲突”事实。#268 与 #269 还共同修改 `packages/ui/src/work-item-list.ts`，#268 与 #270 共同修改 capabilities/storage/schema 及回归测试。
- 推荐逻辑顺序：**#270 → #268 → #269**（先落 Storage/账号底座，再落字段读取与列表列，最后接入详情/深链）。但该顺序仍需手工解决 `docs/README.md`；若实际采用 #268 → #270，则还需处理 #270 的 capabilities registry 与多个 schema 测试冲突。#269 必须排在 #268 后，避免列表实现冲突。
- #269 的 `entityId` 进入详情 `href` 与 `2026-10-01-work-item-list-states` 的“不把内部标识放入 href/data-* / DOM id”记录存在未裁定冲突；这是发布前至少 P1/P2 候选，不能默认为已解决。
- #270 的 Active ExecPlan 尚未归档；#268 的 Active ExecPlan 也未归档且规模门已超；#269 已归档。三个 PR 的 issue 关闭关联存在，但不能把 `Closes` 当作产品闭环证据。

## 2. 锁定事实与交付范围

| PR | 交付 / issue | 当前 head 与状态 | 规模与计划状态 |
|---|---|---|---|
| #268 | GitHub Project 原生字段读取、映射/快照事务、迭代/日期贯通真实列表；`Closes #133` | `8b25895`，ready，mergeable，`UNSTABLE` | **1808/1000 code、238/1500 docs**；`PR size` 红；ExecPlan `active/2026-10-05-project-field-read.md` |
| #269 | 唯一只读详情抽屉、canonical 深链与浏览器 History、真实 Chromium fixture；`Closes #130` | `e47f817`，ready，mergeable，CLEAN | 约 994/1000 code、233/1500 docs；ExecPlan 已归档 `completed/2026-10-05-work-item-detail.md`；仍明确 Host 挂载归 #229 |
| #270 | 连接账号、挂载配置、受信 secret handle、Fake/SQLite 同契约与 002 原位重写；`Closes #126` | `e34529c`，ready，mergeable，CLEAN | 约 994/1000 code、298/1500 docs；ExecPlan `active/2026-10-05-connector-account-storage.md` |

三个 PR 都有真实测试与 issue 双向关闭引用；#268/#270 的计划仍 Active 并不自动表示失败，但合并前必须按 `PLANS.md` 处理归档/回填。

## 3. 并集预演与冲突证据

在一次性 clone 中以 `origin/main` 为 queue-tip，按全部六种排列做 rebase 预演。结果第一层冲突如下：

| 顺序 | 第一处冲突 | 结论 |
|---|---|---|
| #268 → #269 → #270 | #269：`docs/README.md` | #268 后 #269 的产品代码可接，文档索引需并集；随后 #270 仍需处理共享文档/存储面 |
| #268 → #270 → #269 | #270：`docs/README.md` | #268 后 #270 需要手工并集；#269 还会遇到文档索引 |
| #269 → #268 → #270 | #268：`packages/ui/src/work-item-list.ts` | 反例：#269 先改列表导航，#268 再加字段列，直接代码冲突；不推荐 |
| #269 → #270 → #268 | #268：`docs/README.md` | #269/#270 先落时，字段 PR 至少需手工并集文档 |
| #270 → #268 → #269 | #268：`docs/README.md` | 推荐顺序仍非零冲突；解决索引后再跑完整门禁 |
| #270 → #269 → #268 | #269：`docs/README.md` | 详情 PR 先落仍会遇到文档冲突，且最终 #268 与列表面需复核 |

进一步在 **#268 → #270** 的演练中先对 `docs/README.md` 取并集后，继续暴露代码/测试冲突：

- `packages/capabilities/src/registry.ts`
- `tests/integration/execution-relation-write-schema.test.js`
- `tests/integration/identity-membership-enums.test.js`
- `tests/integration/identity-membership-schema.test.js`

这些冲突来自 #268 的 field/storage/schema 扩面与 #270 的 connector-account/storage/schema 扩面，必须“两边都保留”并重新执行 schema 审计；不能用“首个文档冲突已解决”代替并集验证。

共享关键文件：

- #268 ↔ #269：`packages/ui/src/work-item-list.ts`。#268 增加“迭代/目标日期”列，#269 增加 anchor/navigation/heading focus。应先应用字段列，再接导航改动，随后核对列索引、redacted 行占位数、焦点与 href 语义。
- #268 ↔ #270：`packages/capabilities/src/registry.ts`、`packages/capabilities/src/storage.ts`、`packages/storage/sqlite/migrations/002_identity_membership.sql`、SQLite/Fake storage、schema/enum 回归测试。应保留两套新增 API/列并重新审计显式列清单、迁移形状、契约注册。
- 三者：`docs/README.md`、`docs/exec-plan/tech-debt-tracker.md`。索引表不能把 Active 计划放进 Completed；TD 行按当前 head 的事实取并集。

## 4. 七条不变量矩阵

| 不变量 | #268 | #269 | #270 | 跨 PR 反例 / 结论 |
|---|---|---|---|---|
| 1. 单一 Planning 事实源 | 映射只由 Host 显式确认，native-only 不归一 | 只读消费已有 snapshot | 账号/配置不写 Planning 状态 | 当前未证实第二 Planning 源；并集需防止字段快照与账号配置被误并到 `ProviderBindingRecord`/client 权威面 |
| 2. 多研发/交付 Provider | 只读 GitHub Project 字段能力 | 不增加 Provider 调用 | 账号可服务多域/多工作区 | #270 的账号共享不能被 #268 的 workspace field mapping 错当成同一事实；作用域必须保持三元/自然键隔离 |
| 3. 规划与工程状态正交 | engineering event 不改规划字段 | 派生提示只读，不提供编辑 | 配置不授予权限、不改规划 | 跨 PR 真实列表同时显示字段与工程列，需验证工程刷新不会覆盖 `planningFields`；现有各自测试有覆盖，但最终并集需重跑 |
| 4. 阶段 + 并行门禁 | provider→core/storage→wire→ui-model→UI | route/dialog 生命周期门禁 | storage transaction/队列 | 合并顺序本身是阶段门：#269 不能先于 #268 的列表 shape 而不重测；#270 schema 冲突后必须全量验证 |
| 5. 显式关联优先，LLM 不控门禁 | 显式 fieldId/project mapping | route target 显式 projectId/itemId | account natural key、真实 implementationKey、allowlist | #269 `entityId` URL 暴露与既有最小披露决策冲突，待人类裁定；不能由测试绿自动消解 |
| 6. 产物关系沿谱系传播 | field snapshot 随 membership/project field identity | detail 沿既有 safe row/identity | account↔binding↔workspace mount | #268 的 `FieldValueRecord` 与 #270 的 connector binding 不可互相推导；并集不能新增“按名称/optionId/账号”重新识别 |
| 7. Host 权威、前端消费者 | Host 确认 mapping/transaction 后才投影 | ui-model/UI 只读，Host mount 归 #229 | 宿主秘密服务持有值，DB 只存 handle | #269 fixture 不证明真实 Host mount；#270 不证明 credential resolve；三者并集仍不能宣称 Gate R1 完成 |

实现级硬约束：#270 的 secret handle 只保存引用、不是凭据值；#268/#269 无外部写入。三者均未发现“Provider ack 前显示 Saved”的跨 PR 反例。

## 5. 主动构造的跨 PR 反例

1. **字段列 + 详情导航的列错位**：若将 #269 的 `ItemRow`/navigation patch 先接入，再机械套 #268 的 `cells` 增量，`COLUMN_STYLE` 与 `COLUMNS.slice(1)` 长度、单元格索引可能错位；redacted 行可能少占位或详情 anchor 落在错误列。实测 rebase 已在 #269 → #268 处以 `work-item-list.ts` 冲突阻止该错误；推荐 #268 → #269 后重跑列表/redaction/浏览器用例。
2. **Storage 契约半并集**：#268 新增 `replaceFieldValues`，#270 新增账号/配置/卸载方法并同时改变 `StorageSurface`。只解决 TypeScript 冲突而漏掉 `registry.ts` 的一项成员或某个 Fake/SQLite 实现，会出现边界契约绿以外的运行时缺口；必须重跑 `package-boundaries` 与完整 contract/integration。
3. **002 迁移列清单错位**：两 PR 都原位编辑 `002_identity_membership.sql`，并分别更新显式 SQL columns/row codecs。若按一侧保留 SQL、另一侧保留 `storage-rows.ts`，数据库可迁移但读回字段/账号列错位或静默丢值；必须从空库、旧 v2 损坏库、重启库分别跑 schema fingerprint 与两套 adapter 套件。
4. **文档状态倒置**：#268/#270 的 Active 计划都修改 `docs/README.md`，若冲突解决时沿用 #269 的 Completed 行模板，可能把未归档 Active 计划登记到 Completed，造成计划/产品状态事实源分裂。#264/#266 评审已经证明并集预演无法发现这种分区错误，必须逐 PR 读取 README diff。
5. **账号配置与字段 mapping 误合并**：#268 的 `WorkspacePlanningFieldMapping` 与 #270 的 `workspace_binding.configuration_json` 都是 workspace-scoped JSON，但语义不同。若整合者把 mapping 塞入 connector configuration，或在 `createContext` 重登记时一并清空，会破坏单一事实源/重启恢复。两者必须保持不同列、不同 port、不同 ack/校验路径。
6. **详情 scope 与字段 redaction 撕裂读**：#269 已在详情侧复验 redacted；#268 也有字段 redaction。并集若把新字段直接从旧 `WorkItemListView` 或详情输入旁路读取，而不走各自安全投影，可能出现列表已遮蔽但详情显示 iteration/date 的泄漏。应复跑 #268 的恶意 redacted HTML 与 #269 的 TD-024 撕裂读用例。
7. **规模叠加误判**：三个 PR 单独都可能在仓库 1000 行硬门附近；#268 已 1808/1000。即使每条分支测试绿，不能把“合并后功能绿”当作规模门通过；按仓库规则逐 PR/最终 main 都要回读 size/disclosure。

## 6. P0–P3 候选与阻塞判定

| 等级 | 候选 | 证据 | 是否阻塞 |
|---|---|---|---|
| **P0 候选** | #268 代码规模硬门失败 | `rule-checks size origin/main`：1808/1000，PR body 明示 `PR size` 红 | **是（默认）**。人类已裁定接受实测规模并 ready，但该裁定不是仓库 §8 硬门的机械豁免；若人类确认这是本轮明确例外，可转为“已授权非阻塞偏差”，仍须在合并记录中保留红灯事实 |
| **P1 候选** | #269 `entityId` 进入 href/URL 与既有最小披露决策冲突 | ExecPlan Decision Log 明确列为“待人类确认”，未改代码 | **是，直到人类裁定**。若确认 entityId 是既有稳定内部锚点且该决策已被 supersede，则转 P3/非阻塞并补记录；否则需改路由或修订正式决策后再合并 |
| **P1 候选** | #268/#270 并集后的 schema/registry 冲突未重新验证 | 实测冲突文件见 §3；错误取一侧会漏 API/列/契约 | **是，过程阻塞**。不是已证实运行时 bug，但在冲突解决并重新跑验证前不能合并 |
| **P2** | #268/#270 计划仍 Active、#268 规模后备拆分 TD-027、#270 TD-028/029 状态需与最终裁定一致 | ExecPlan 当前记录 | 非代码阻塞；合并前需归档/回填或明确保留 Active 的理由 |
| **P2** | #269 真实 Host mount 未验证（归 #229），#270 credential resolve/真实 GitHub 连接未验证 | 各 PR 风险段明确声明 | 非本 PR 阻塞；不能宣称完整 Host/R1 产品闭环 |
| **P3** | 文档索引/TD 行在冲突解决中容易出现重复、错表或旧 head 引用 | 所有排列均触发 `docs/README.md` | 合并操作阻塞，解决后为文档质量问题 |
| **P3** | #269 非 Chromium/真机与 300ms 并发未验证 | ExecPlan 明示 | 不阻塞本轮只读切片 |

## 7. 推荐合并与验收门

1. 先处理 #268 的规模裁定：若不接受硬门例外，拆分为独立可验收层；若接受，保留 `PR size` 红灯事实并由人类明确批准。
2. 以 **#270 → #268 → #269** 作为主预演顺序：Storage/账号底座、字段读取/列表列、详情/路由。每次实际 rebase 后重新锁 head/base/checks；不把本表预演替代远端当前状态。
3. 手工解决每一处冲突时：
   - `docs/README.md`：按 Active/Completed 分区逐行保留，#269 已 Completed，#268/#270 按当前是否归档决定。
   - #268/#270 shared storage/schema：两边 API、SQL 列、row codec、registry 成员和测试都保留；迁移前预检、显式列清单、旧形状拒绝、字段值事务逐项重跑。
   - #268/#269 `work-item-list.ts`：以 #268 的 8 列为基线，再叠 #269 的 navigation/heading focus，不丢 redacted 占位和修饰键 href。
4. 最终并集至少执行：`pnpm verify`、`pnpm run boundaries`、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`；再跑三条 PR 的新增 contract/integration/e2e/Chromium 判别套件。
5. 合并后检出真实 `main` 回读：三 issue 关闭关系、ExecPlan 索引分区、TD 追踪、迁移 fingerprint、字段/详情/redaction、账号 secret-canary。未经人类伙伴决定，不自行合并。

## 8. 最终裁定

**当前不建议直接合并三条 PR。** 阻塞原因不是已证实的跨 PR P0/P1 业务 bug，而是：#268 的硬规模门红灯/例外授权需再次确认；#269 的内部 `entityId` URL 决策未闭环；并集冲突尚未按推荐顺序完整解决并重跑门禁。完成上述三项并在实际合并点重锁 head/base/checks 后，预计三条 PR 可形成互不篡位的只读字段、详情导航与账号存储纵向能力；但整体仍不等于真实 Host mount、credential resolve 或 Gate R1 完成。
