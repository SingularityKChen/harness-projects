# PR #654 MMP 交付评审

评审日期：2026-11-16。目标：数据库强制源实体的唯一主身份；关联 #190。锁定 head `5962f02d7659ff78cb8554aeb71fb7d47a0d1c8e`，base `ba27b24c7fbcc25fe30576cbf99ba73758233c80`（`main`）。执行上下文：检出本 PR 分支的 `.worktrees/primary-identity-contract`。独立评审未修改产品/测试/ExecPlan/commit，未写 GitHub；本记录随 PR 合并。

结论：**首审 APPROVE（仅 P2/P3，无 P0/P1）**；修复复评见文末。该结论只覆盖 POSIX/Host 工程闭环，不构成 R1 发布接受；#595/#596 与 R1 保持独立。

## 锁定事实与边界

- 远端回读 head/base 与上述值一致；`isDraft=false`、`mergeable=MERGEABLE`、`mergeStateStatus=UNSTABLE`；单一提交；closingIssuesReferences=[#190]；reviews/comments/threads 均为空。
- 当前 head 的 `PR Fast Gate`、Verify、Browser、CodeQL、规则与 issue policy 成功；`Create review session` 失败是 #364 跟踪的评审端点问题（本 PR 记录为 000000 不可达）；`matrix.check` 是同一 head 并发被取消的重复 Rule checks。
- 精确证据：run `43852958368` checkout `5962f02d`，Verify job 4,078 tests / 4,073 pass / 0 fail（1599 契约 + 2253 集成 + 226 e2e），Browser job 110 pass / 0 fail / 0 skip / 0 todo；首轮 Browser 9 项 FK 失败在 run `43848310500` 可复现，根因是共享浏览器夹具没有按 `StorageTransaction` 契约登记仓库，夹具改为 `storage.transaction(...)` 包装后九项转绿。
- 独立约束实验：用 Node 26.13 的 `node:sqlite` 直接加载完整迁移 SQL，37 项攻击/正控全部符合设计；另以 12 个变异验证关键测试判别力（见下）。
- 安全/数据边界：世代 5→6，旧/未知库原样拒绝、不自动迁移或补数据；备份/重建路径属 #190 replan 的既有决策。

## 风险矩阵（先建立，再逐层审查）

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 结果 |
|---|---|---|---|---|
| P0 | 数据损坏、身份错配、旧库被静默修复 | 七条不变量、Host 权威、单一身份来源 | 实际 diff、依赖边、scheme 世代 | 无；未新增第二身份权威或迁移路径 |
| P1 | 约束可被直接 SQL/事务中间态绕过、Fake/SQLite 分叉、晋升半写 | Start Work / Draft→Issue / alias 汇聚 / 重启后真实 SQLite 行为 | 判别性契约、直接 SQL 反例、Mutation | 无；六类坏终态在提交时被拒，晋升/清组正控通过 |
| P2 | — | — | F1 Fake 直接非事务身份写的校验与回滚无判别性用例（两个变异存活） | 1 项，非阻塞 |
| P3 | F3 晋升硬编码 kind（潜在） | F2 内部种类清单在 domain/Fake/SQL/文档重复 | F5 FK 关闭时的声明精度；F6 4,097 计数不可复现；F4 归档计划交付门状态陈旧；F7 seedEntity 隐式副作用 | 6 项，均非阻塞 |

## 分层证据与结论

1. **数据库约束**：`entity.primary_identity_id` 可空但 CHECK 仅允许内部种类 NULL；`entity.id` 显式 NOT NULL 阻断 NULL 复合外键分量；generated `registered`/`primary_role` 不可伪造；角色绑定 deferred 复合外键 `(primary_identity_id,id,primary_role) → external_identity(id,entity_id,role)` 保证选中身份同实体且真实 primary；反向 deferred 外键 `(entity_id,registered=1) → entity(id,registered)` 阻断 alias-only 内部组；既有 partial unique 保「至多一个」。独立 SQL 攻击：零身份源实体、alias-only、选中 alias、选中外实体、删除/降级选中身份、第二 primary 均在提交时拒绝；晋升/清组的合法中间态通过。
2. **Storage 合同**：`putEntity` 省略/undefined 保留既有选择，显式 null 仅对无身份内部锚点合法；SQLite 用原子保存点读旧选择后再 upsert，失败不留半写、读围栏不推进；Fake 在发布前验证整组并对非事务写原子回滚。两适配器在契约套件下同义。
3. **Core 生命周期**：`ensureEntity` 先分配身份 ID、同事务写实体与身份；`promoteEntityIdentity` 先释放旧 primary 再升新 primary 并更新指针；`registerRepository` 首 primary 与身份同事务；纯内部 StartWork/交付端点继续省略指针。
4. **迁移/打开**：`pragma_table_xinfo` 使 generated 列参与打开期结构准入；世代提升后旧/未知库以 `IncompatibleDatabaseError` 拒绝且文件不变。
5. **产品闭环**：真实 Core + 真实 SQLite 的 Start Work、Draft→Issue 晋升、alias 汇聚、重启重开、直接坏提交拒绝均有本地与 CI 证据；浏览器共享夹具根因修复后 110 项通过。旧世代库拒绝后的人工备份/重建是既有产品路径。
6. **issue #190 验收**：#27 AC3（一个实体最多多条身份、恰好一条 primary）与 #27 Scope（不变量由数据库而非调用代码强制）成立；replan 的「先 #190 后 #595/#596」「拒绝旧/未知库」「500–800 技术行目标（较小闭环不填充）」均满足；实际 478 技术行 / 197 文档行在硬上限内。

## 首审意见（全部非阻塞；inline 已随 review 提交）

### F1（P2，测试判别力 / Fake 失败路径）直接非事务身份写的校验与原子回滚没有判别性用例

ExecPlan 声明「Fake 直接非事务写入也验证并原子回滚」，但变异删除 `#mutate` 的发布后 `#assertIdentityGroups()` 或删除 `Object.assign(this.#data, before)` 回滚后，463 项契约/schema/admission 测试仍全绿。当前实现行为正确：直接 `putEntity` 内部种类 + `putExternalIdentity` alias 会被拒绝且零残留、读围栏不变。产品代码只在事务内写身份组，因此这不是线上缺陷；但 Fake 是契约/单元测试的主适配器，这个测试双写的退化会让两适配器在无报警下分叉。修复方向：在共享契约套件中加「事务外」直接写反例（内部种类 + ghost 指针、NULL 指针内部实体上的 alias、源种类显式 null），断言拒绝 + 零残留 + `committedReadFence()` 不变，并重跑变异证明两个变异均被杀死。

### F2（P3，架构边界）内部种类清单在 domain、Fake、SQL CHECK 与文档四处重复，没有单一来源

`002` 的 CHECK `kind IN (...)` 与 Fake 的 `internal = [...]` 是两份独立字面量，ExecPlan/ADR 又各写一遍。行为对等目前只被 `work_item`/`worktree` 两个种类实际覆盖。修复方向：在 `packages/domain/src/entities.ts` 声明 `entityKindRequiresPrimaryIdentity(kind)`（或冻结集合），Fake 消费它；契约测试遍历 `Object.values(EntityKind)` 断言两适配器对 NULL 指针的接受/拒绝与 domain 判断一致，从而同时钉住 SQL 字面量与 domain 的漂移。

### F3（P3，代码正常路径，潜在）`promoteEntityIdentity` 把实体 kind 硬编码为 `WorkItem`

晋升路径只被 Draft→Issue 使用，当前 kind 恒为 work_item，故是潜在问题；但任何未来复用都会在满足全部数据库约束的情况下静默改写 `entity.kind`。修复方向：由调用方传入已计算的 kind（`bootstrap` 已有 `entityKindFor` 结果），或在写入前断言既有实体种类。

### F4（P3，文档/证据边界）归档 ExecPlan 仍写「最终远端交付门待执行」

计划状态行与 Progress 的远端交付门未更新，而 PR 正文已给出精确 head 的 CI run `43852958368` 通过。收尾时更新计划 Progress/Outcomes，使归档事实与 PR 证据一致。

### F5（P3，声明精度）「直接 SQL 也无法绕过」只在 `PRAGMA foreign_keys=ON` 的连接上成立

独立实验：`foreign_keys=OFF` 时 alias-only、选中 alias、选中外实体、删除选中身份四类 FK-only 状态被接受，仅 CHECK/partial unique 仍拒绝。产品每条连接都由 `openDatabase` 显式开启外键，且打开期结构准入是唯一入口，故产品安全不受影响；但计划/ADR 应把结论限定到该连接（并说明裸 CLI/其它绑定需显式开启）。

### F6（P3，证据可复现性）「完整 verify 4,097 项」不可复现

`338059ce` 没有保留的 Actions run；精确 head 的 Verify lane 是 4,078 tests / 4,073 pass。计划把 4,097 归给基线尚可理解，但数字无法从仓库证据重建。收尾时改为引用精确 lane 计数或删除该聚合数字。

### F7（P3，测试夹具可维护性）`seedEntity` 隐式创建 provider binding 与身份

`tests/contract/suites/storage-fixtures.js` 的 `seedEntity` 在种子实体时会隐式创建 `fixture-binding` 并登记一条 primary 身份，硬编码工作区与 binding id。当前套件全绿，但未来换工作区/断言挂载计数的消费者会拿到意外行。修复方向：把 binding/workspace 作为参数或在 JSDoc 中显式声明副作用。

## 实际执行与结果

所有命令在 `.worktrees/primary-identity-contract` 根执行。

| 命令 | 观察到的结果 |
|---|---|
| `pnpm test:file tests/contract/storage-contract.test.js` | 283 pass / 0 fail |
| `pnpm test:file tests/integration/identity-membership-schema.test.js tests/integration/storage-restart.test.js` | 30 pass / 0 fail |
| `pnpm test:file tests/integration/start-work-sqlite-registration.test.js tests/integration/draft-promotion-reconcile.test.js` | 158 pass / 0 fail |
| `pnpm test:file tests/e2e/start-work.test.js` | 39 pass / 0 fail |
| `node --test tests/integration/storage-baseline-admission.test.js` | 161 pass / 0 fail |
| `node --test tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-migrations.test.js` | 30 pass / 0 fail |
| `pnpm run boundaries` / `pnpm typecheck` | 9 pass / exit 0 |
| `node scripts/rule-checks.mjs size ba27b24c` | 代码 478/1000，文档 197/1500 |
| `git diff --check ba27b24c...HEAD` | exit 0 |
| 独立 SQL 攻击脚本（Node 26.13 + node:sqlite，完整迁移 SQL） | 37/37 符合设计；FK OFF 时 4 类 FK-only 状态被接受（F5） |
| `node scripts/review-mutate.mjs`（12 个变异：删除 CHECK/NOT NULL/角色 FK/反向 FK/第二 primary 索引、去掉省略指针保留、Fake 发布前验证、事务组验证、table_xinfo、世代号、Core 四处指针写） | 10 KILLED；Fake 直接写回滚/发布后校验 2 项 SURVIVED（F1） |

## 修复复评（2026-11-16，本轮修复后同 head 复核）

| 意见 | 处理 | 验证 |
|---|---|---|
| F1 Fake 直接非事务身份写无判别用例 | 共享契约套件新增两个用例（两适配器各跑）：① 事务外直接写「内置种类 + NULL 指针实体上的 alias」「悬挂指针」「源种类显式 null」全部拒绝、零身份残留、读围栏不变；② 遍历全部 `EntityKind` 断言 NULL 指针接受/拒绝与 domain 单一来源一致。 | 契约套件 464 pass；变异 M10（去掉回滚）/N3（去掉发布后校验）/N2（放宽种类责任）/M1（删 SQL CHECK）全部 KILLED |
| F2 种类清单四处重复 | `packages/domain/src/entities.ts` 新增 `entityKindRequiresPrimaryIdentity`（单一来源），Fake 消费；SQL 字面量由上面的全 kind 对等契约钉住，任一侧漂移都会红。 | 全 kind 对等用例通过；变异 N2/M1 KILLED |
| F3 晋升硬编码 kind | `promoteEntityIdentity` 增加必填 `kind` 参数，`bootstrap` 传入已计算的 `entityKindFor(...)`，两个测试调用点显式 `work_item`；不再由身份 helper 推导/覆盖 kind。 | contract/e2e/typecheck 通过 |
| F5 FK-off 声明精度 | 计划改为「在端口连接（`db.ts` 显式 `PRAGMA foreign_keys=ON`）上直接 SQL 无法绕过；裸 CLI/其它绑定需自行开启」。 | 文档核对 |
| F6 4,097 计数 | 进度与证据段改为「实现基线本地 `pnpm verify` 通过；精确 head 的 CI Verify lane 为 4,078 tests / 4,073 pass（1599+2253+226）」；不再引用不可复现聚合数。 | CI run `43852958368` 回读 |
| F4 交付门状态 | 状态行与 Progress 记录最终 head `5962f02d`、run `43852958368`、Ready 与 head/base/checks/threads 回读完成。 | 远端回读 |
| F7 seedEntity 隐式副作用 | helper 增加 JSDoc 声明其创建 `fixture-binding` 与 primary 身份。 | 文档核对 |

复评命令与结果：`pnpm test:file tests/contract/storage-contract.test.js tests/integration/identity-membership-schema.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/draft-promotion-reconcile.test.js` → 464 pass / 0 fail；`tests/e2e/start-work.test.js` → 39/39；`storage-baseline-admission` → 161/161；artifact+migrations → 30/30；`pnpm run boundaries` 9/9；`pnpm typecheck` exit 0；变异 4/4 KILLED。复评结论：**无 P0/P1，P2 已修复，维持 APPROVE**。
