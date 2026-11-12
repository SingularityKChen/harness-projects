# 无用 WorkItemApp 绑定包装退役 ExecPlan

> 状态：Completed · 实现、独立验收与 MMP 复评完成；发布与合并事实按评审记录回读
> 创建：2026-11-11
> 范围：完成 #453 当前确无消费者的 wrapper/export/等值断言清退。
> 上游：issue #453 / parent #224；规范为根 `PLANS.md`、`AGENTS.md` 与 `docs/development/workflow.md`。

## Purpose / Big Picture

UI 包不再暴露无当前消费者的 `bindWorkItemApp` 空包装，包装专属等值断言随之删除。用户仍通过当前 Host 装配打开 WorkItemApp，列表、详情、路由、工作区切换和设置恢复行为继续由既有有效证据保护。

最小证据是当前源码无该 wrapper 引用，保留的契约与真实设置浏览器测试通过。该结果不包含安装 Host 人验或 R1 发布接受。

## Context and Orientation

`packages/ui/src/work-item-app.ts` 的包装只返回创建 WorkItemApp 的函数，`packages/ui/src/index.ts` 转出它。当前唯一调用位于 `tests/contract/ui-work-item-app.test.js`，仅比较包装组件形状和 SSR HTML 等值。

真实 UI 装配直接消费 WorkItemApp 或现行 workspace setup/status 入口，不调用这个包装；`ReactElement` 在同文件仍有真实用途，不能随包装顺手删掉其类型 import。

issue 所述“workspace-forms-browser 手工载体无消费者”的前提已被当前代码推翻：`tests/browser/workspace-settings-presentation.test.js` 直接 import `tests/fixtures/workspace-forms-browser.mjs` 的 startServer。两个浏览器用例承担四任务切换、草稿、pending/unknown 不显示 Saved、不重发未知写、窄屏与 Host 主题布局证据。

这些是活的独有验证，不能因历史候选名含 manual 或 synthetic 就删除。历史完成计划中的当时事实保持原样，当前活文档的失效入口必须就地注明取代关系。

## Design / Spec

选择只删除 wrapper 定义/注释、对应 named export 与测试中的四行包装专属断言。原测试里的列表、片段链接、详情打开关闭、当前工作区切换、scope 与焦点等行为断言完整保留。

`docs/product/vertical-path.md` 的历史 `bindWorkItemApp` 描述在原处保留日期并追加当前入口的 Superseded 说明，不把它当作 runtime 消费者或重写历史验收。

保留 forms fixture 和其当前自动浏览器消费者。无需新的替代 suite、永久“旧导出不存在”断言、源码快照或固定 mutation 配额；这是已有行为不变的删除，既有通过证据足以判定。

不选先搬迁设置测试再删 fixture，因为需要重新设计可控 unknown 写入、草稿、主题与布局载体，会把退休任务扩成另一项测试架构工作；不选内联 fixture 或改名，因为只增加搬迁和职责，不减少有效机制。

若最终消费者搜索发现真实生产调用，先恢复删除并重审范围，不自动修改 Host 壳或造兼容包装。保持当前 Host ABI、身份/授权与 ack/reconcile 后才显示 Saved 的约束。

## Global Constraints

工作分支为 `chore/ui-binding-retirement`，隔离目录为 `.worktrees/ui-binding-retirement/`，PR base 为 `main`。UI owner 独立于两个 Storage PR，可分别验收、合并和回滚。**Superseded by #623 联合 Storage 合同（2026-11-11）**：Storage 两项已收敛为一个可整体回滚的闭环；本 UI PR 与其保持独立。

唯一技术文件集合：`packages/ui/src/work-item-app.ts`、`packages/ui/src/index.ts`、`tests/contract/ui-work-item-app.test.js`。

2026-11-12 评审收尾扩展：增加 `docs/review/pr-625-mmp-review.md`、本计划的当前评审/授权记录，以及合并队列中 #623 实际结果的机械回填。

文档集合为本计划、`docs/product/vertical-path.md` 的原位取代说明，以及完成时协调者更新的 `docs/README.md`。不改 forms fixture、settings browser 测试、WorkItemApp 行为、workspace setup/status 装配或 apps。

技术新增+删除预计 12–24，执行上限 45 且必须 `<800`；文档目标 130–260 且必须 `<1300`。旧 80–150 预测包含已变活跃的 fixture，不是最低规模；不补无关清理、不删除有效证据。

不新增依赖、协议或数据迁移，不访问真实用户数据库或外部 Provider。Planning Status、原生依赖和 R1 裁决不在授权写入范围。

## Plan of Work

### Batch 1 · 空包装完整退役

**最小闭环**：一次删除确认无消费者的包装及专属断言，保留实际 UI 和活跃浏览器证据，形成独立可回滚 PR。

**涉及主文件**：`packages/ui/src/work-item-app.ts`、`packages/ui/src/index.ts`、`tests/contract/ui-work-item-app.test.js`。

先提交本计划并建立 `Closes #453` draft，回读 base、head、draft 与 issue 关联。对当前 packages/apps/scripts/tests 再查消费者；删除包装、出口及专属等值块，原位订正文档入口。不得删去同一个测试中的导航和工作区变化断言。

**验证命令唯一入口 V453**：以下在检出 `chore/ui-binding-retirement` 的工作树根运行，记录当次 HEAD 与 `origin/main`；2026-11-11 SGT 的 `29947425` 为基线快照，既有 app 窄基线为 6 passed，尚非实施后结果。

```sh
pnpm test:file tests/contract/ui-work-item-app.test.js tests/browser/workspace-settings-presentation.test.js
pnpm typecheck
rg -n 'bindWorkItemApp' packages apps scripts tests --glob '!**/dist/**'
rg -n 'workspace-forms-browser' tests/browser
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
python3 -c "import subprocess; subprocess.run(['git', 'diff', '--check', 'origin/main...HEAD'], check=True)"
```

期望测试、类型、规则、diff 命令 exit 0；wrapper 检索零命中（rg exit 1），forms 检索继续命中真实浏览器 import。既有六条 app 契约与两条设置浏览器用例通过，用户行为/unknown 恢复断言继续保留。按最终 diff 核算预算，发布面做五类人工复查。

独立验收者确认删除块只覆盖空包装及其等值证明，文档没有虚构安装结果。整理提交后 push，回读远端当前 head/base/checks/issue 关联及完整 review threads；当前 head 通过后才 ready。协调者归档本计划和更新索引，不自行合并。

**回滚点**：单独撤回本 PR 即恢复原 wrapper/export/断言，不需数据恢复。出现实际消费、构建失败或浏览器入口丢失时恢复本批并修订设计。

## Validation and Acceptance

以 V453 的当前 head 输出和实际 diff 判定：生产没有 wrapper 消费者，只删冗余定义/出口/等值块；真实列表与详情导航、工作区切换、scope 和设置恢复仍通过。

forms fixture 与浏览器测试保持当前消费关系，不把 SSR 当布局证据，不增加替代测试或用“导出缺席”测试镜像实现。无需为了 TDD 名义制造新行为 RED。

## Progress
- [x] (2026-11-12) 独立 UI 及产品交叉评审无新增 P0–P3；原完成归档有效，最终 push/合并按当前版本门执行。

- [x] (2026-11-11 18:33 SGT) 独立核对 wrapper、真实装配、活 forms 消费者与两份备选。
- [x] (2026-11-11 18:33 SGT) 完成最小范围/预算审定，核对既有 app 基线。
- [x] Batch 1：删除空包装、出口与专属等值断言，保留其他行为断言及活跃浏览器 fixture；纵向链路原位追加当前入口说明。窄验证、类型检查与完整 `pnpm verify` 通过（2026-11-11）。
- [x] 修复独立 review 的 P2：从已推 plan commit 恢复 #4 历史表格行，在原入口单元格内追加 dated Superseded 说明；机械核查确认去掉说明后与基线逐字相同，步骤 1–13 连续（2026-11-11）。
- [x] (2026-11-11 SGT) 独立 scoped rereview 确认 P2 ADDRESSED，规范和代码质量 PASS。
- [x] (2026-11-11 19:16 SGT @ cffec3b1) 当前实施 head 的 CI、浏览器与 PR Fast Gate 均通过；计划归档。整理后的最终 head 仍须按 Plan of Work 重新回读门禁再 Ready。

## Surprises & Discoveries

原 fixture 无消费者判断已失效；当前自动浏览器测试直接使用它。保留该文件是当前事实裁定，不能记录成未完成的旧删除任务。

包装退役仅十余行，小于旧估算是范围准确收敛，不应增添测试或其他清理来消耗预算。

2026-11-11 实施前最终消费者搜索：`rg -n 'bindWorkItemApp' packages apps scripts tests --glob '!**/dist/**'` 只命中包装定义、named export 与本次移除的等值测试块；`rg -n 'workspace-forms-browser' tests/browser` 命中 `workspace-settings-presentation.test.js` 的真实导入。按此删除包装并保留浏览器载体。

独立 review 发现 `vertical-path.md` 原 #4 整行曾被替换成表外 blockquote，丢失历史证据并截断 GFM 表格；已从已推 plan commit `ce02402dece2d1edb80dd154a221968b3c68fe85` 原样恢复该行，只在旧 wrapper 所在入口单元格附加取代说明。可重复检查证据见运行态报告 `task-1-report.md` 的 Review repair 段。

## Decision Log

2026-11-12 / 人类伙伴（本次 #623/#625 评审会话）：直接要求无 P0/P1 时由本会话负责“修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → `merge_method=rebase` 合并”。本 PR 满足条件后执行；Planning Status 与 R1 不在该授权范围。

2026-11-11 18:33 SGT / 独立设计审定者：选择 wrapper-only 退役，保留活 forms 载体。Rationale：以当前消费者和独有行为证据决定删除，文件名称不证明失效。

2026-11-11 18:33 SGT / 独立设计审定者：复用现有 contract/browser，不新增镜像断言或 fixture 搬迁。Rationale：纯删除行为不变，最小有效证据足以判断。

2026-11-11 18:33 SGT / 独立设计审定者：Project #10 实际 iteration 10（2026-11-09—15）与 issue body iteration 11（2026-11-16—22）预测漂移已记录；本次按当前 Project 选择执行，不修改 Status/依赖。Rationale：工程事实不覆盖规划事实。

## Idempotence and Recovery

消费者搜索和测试可重复。删除前若有其他 owner 修改同一 UI 文件，先核对差异，不覆盖用户或他人改动；工作树内只处理本集合。

回滚只撤回本 PR 源码与说明，不改历史完成记录、证据 hash 或外部状态。未通过既有浏览器用例时保留失败输出，再定位本批影响。

## Interfaces and Dependencies

复用当前 WorkItemApp、WorkspaceSource 和 Host workspace setup/status 装配，退役的只是无当前消费者的 UI 包装出口。保留 React 与现有本地浏览器测试运行环境，不新增凭据或网络平台写入。

该 PR 与 #415/#416 无共享技术文件或能力依赖。README 完成索引由协调者依次维护，文档落点冲突不构成原生阻塞关系。

## Outcomes & Retrospective

2026-11-12 独立 MMP 首审及产品交叉核验无新增 P0–P3，具体版本、证据与后续当前 head 门见 [评审记录](../../review/pr-625-mmp-review.md)。原完成归档有效；新增评审证据以独立文档提交承载。

实现仅移除空包装与等值断言；`pnpm test:file tests/contract/ui-work-item-app.test.js tests/browser/workspace-settings-presentation.test.js` 通过 8 项（浏览器 2、契约 6），`pnpm typecheck` 通过，`pnpm verify` 通过 contract 1,566、integration 2,241、e2e 226 项（均 0 fail / 0 skipped）。`workspace-forms-browser.mjs` 仍由浏览器测试导入。独立验收和文档复评已通过，当前实施 head 的远端检查已通过；整理后最终 head 由协调者重新回读并提升 Ready。预计无新增债务，#419 规则测试清理和 #459 发布审计继续独立；若出现被迫保留的临时兼容路径，先重审并在 `docs/exec-plan/tech-debt-tracker.md` 记录退出条件。

## Bottom Change Note

2026-11-11 18:33 SGT：审定首版，以当前消费者事实推翻旧 forms 删除候选，收敛为包装/出口/等值块的独立清退。

2026-11-11 SGT：核正基线记录，仅保留观察日期，避免把 triage 时间误作测试时间。

2026-11-11 SGT：完成 Batch 1 精确删除与旧入口原位订正；窄浏览器/契约测试、类型检查和一次完整验证通过，完整日志保存在运行态 `.superpowers/sdd/2026-11-11-ui-binding-retirement/verify.log`。独立验收与 PR 最终回读交协调者。

2026-11-11 SGT：按独立 review 修复历史 #4 行被 blockquote 替换的问题；基线行逐字恢复，取代说明留在同一表格单元格，步骤 1–13 连续。只运行文档机械核查、diff 与 disclosure；完整验证不因纯文档修改重跑，等待 scoped rereview。

来源：根 `PLANS.md`、当前 UI 装配、`tests/contract/ui-work-item-app.test.js` 与 `tests/browser/workspace-settings-presentation.test.js`。

2026-11-11 SGT：记录独立复评通过及当前远端交付阶段；未改变已验证代码。

2026-11-11 19:16 SGT：独立验收与文档复评通过，当前实施 head 门禁已通过，归档至 completed 并更新文档索引；仅整理文档与 Conventional Commit 标题，保留恢复锚点后按精确 lease 发布。

2026-11-12：补录独立 MMP 评审、逐 PR 条件合并授权与当前版本回读门，生产和测试源码保持首审版本。

2026-11-12：#623 当前修复头与本 PR 完整组合 439 项通过；Review 索引冲突保留双方，真实 main 接合后以非文档 blob 相等和新 head 门禁验收。

2026-11-12：已接合 #623 合入后的真实 main，518 个非文档 blob 与 439 项已测组合逐项相同；最终远端版本按评审记录门禁回读，不以旧批准替代。
