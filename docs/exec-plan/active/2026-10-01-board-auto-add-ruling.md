# 2026-10-01-board-auto-add-ruling —— 裁决 `Auto-add to project` 并让看板工作流检查恢复

> 状态：Active
> 创建：2026-10-01
> 范围：把看板新出现的第十条内置工作流 `Auto-add to project` 按 `docs/product/board-semantics.md` §4 求值，并把结论同步写进 §5 裁决表、`scripts/board-workflow-check.mjs` 的 `EXPECTED` 与两组契约测试；不改 workflow、不改看板开关、不改 `Status`。
> 上游输入：issue #248、`docs/product/board-semantics.md` §2 / §4 / §5、`Board invariants` 自 2026-09-26 起的定时运行
> 载体 issue：<https://github.com/SingularityKChen/harness-projects/issues/248>
> 本计划同时是 spec 与 plan；正文中文，代码标识符、路径与命令英文。

## Purpose / Big Picture

`Board invariants` 的 `Board workflow invariants` job 从 2026-09-26 起每天失败，原因只有一条：看板上多了一条 `Auto-add to project`，而裁决表里没有它，检查器按设计把它报成 `unknown`。完成后：

1. §5 裁决表、`EXPECTED` 与契约测试三处一致地登记第十行，结论为「开启」，并写明开启的前提（过滤条件只含 issue、不含 PR）以及该前提只能人工核对；
2. 对真实看板运行 `node scripts/check-board-workflows-live.mjs` 的结果为 exit 0；
3. 下一次定时运行的 `Board workflow invariants` 转绿。

最小成功证据（在检出 `fix/board-auto-add-ruling` 的工作树根目录运行）：

```bash
node --test tests/contract/board-workflow.test.js tests/contract/check-board-workflows-live.test.js   # 期望 fail 0
PROJECTS_TOKEN=<有 project 读权限的令牌> PROJECT_OWNER=SingularityKChen PROJECT_NUMBER=10 node scripts/check-board-workflows-live.mjs   # 期望「已检查 10 条…全部符合裁决表」，exit 0
```

## Context and Orientation

- **裁决规则**：`docs/product/board-semantics.md` §4 的四步规则。一条内置工作流可以开启，当且仅当它写的字段属于它的触发事件所在的那条轴；不写字段的工作流只需确认没有跨轴写入的副作用（第 1 步）。
- **可执行形式**：`scripts/board-workflow-check.mjs` 的 `EXPECTED` 是 §5 表的可执行形式。`tests/contract/board-workflow.test.js` 把条数、名字、期望状态钉死；`tests/contract/check-board-workflows-live.test.js` 用一份合规快照测运行时 adapter，快照必须与 `EXPECTED` 等长，否则会报 `missing`。
- **当前状态**（2026-10-01 回读）：`projectV2.workflows` 共 10 条。新增的是 `Auto-add to project`，number 10，`createdAt 2026-09-26T02:36:27Z`，`enabled: true`。定时运行 36224839724（09-26）到 36685030848（09-30）的 `Board workflow invariants` 均只报这一条 `unknown`，09-25 的运行 36104558572 中该 job 通过。
- **平台行为**（GitHub 文档 *Adding items automatically*）：auto-add 在条目新建或更新且匹配过滤条件时把它加入项目，不追溯已有条目；过滤条件支持 `is:issue` / `is:pr` / `label` 等；文档没有说明从项目移除的条目在更新后是否会被再次加入。`projectV2.workflows` 只返回 `name` 与 `enabled`，不返回过滤条件。
- **规划所有者的输入**：2026-10-01 在会话中确认当前过滤条件只加 issue、不含 PR。

## Design / Spec

**裁决：开启，前提是过滤条件只含 issue、不含 PR。**

按 §4 第 1 步：它自己不写任何项目字段，只建立项目成员关系。连带的副作用是新上板条目触发 `Item added to project`，后者把 `Status` 写成 `Todo`。这与已开启的 `Auto-add sub-issues to project` 是同一种副作用：只给新上板条目一个初始值，不覆盖任何已有的规划值。

§2 允许 `Item added to project` 的理由是「上板是人的规划动作」。自动上板不改变这一点：过滤条件是规划所有者设定的常设规划决定，issue 本身就是人声明工作项的载体。

前提必须排除 PR。PR 是工程产物，被自动加进规划看板，就是工程事件跨轴写入规划成员关系，第 1 步「没有跨轴写入的副作用」不再成立。

**被放弃的方案：**

- **关闭，保持人工上板。** 与 §2 原文最贴合，但规划所有者有意开启了这条工作流（只含 issue），而它与已开启的 `Auto-add sub-issues to project` 同类。关闭它等于用文档推翻规划所有者对规划流程的设定，没有不变量层面的理由。
- **在检查器里核对过滤条件。** API 不返回过滤条件，做不到。退而求其次是把前提写进 `why`、§5 正文与契约测试，让「开着不等于合规」随检查输出一起出现。
- **把 `unknown` 降级为 warning。** 这会把每一条未来新增工作流的裁决永久搁置，正是 §5 明确反对的做法。

**不变量**：§2「`Status` 只由人写，唯一机械例外是 `Item added to project`」不变——第十行不写 `Status`。`MUST_BE_DISABLED` 仍由 `EXPECTED` 推导，仍为 7 条。

## Global Constraints

- 不改 `.github/workflows/`、不改看板开关、不写任何条目的 `Status` 或关系；GitHub GraphQL 也没有启停内置工作流的 mutation。
- §5 表、`EXPECTED` 与契约测试在同一个提交里一起改（`scripts/board-workflow-check.mjs` 头部注释的要求）。
- 令牌只经环境变量进入一次性进程，不写入文件、记录或 PR。
- 历史文档（`docs/exec-plan/`、`docs/review/`、`docs/project-management/merge-queue.md`）里的「九条」是当时的事实，不改。

## Plan of Work

### Batch 1 · 裁决与三处同步

- 最小闭环：契约测试先红，再补 `EXPECTED` 第十行，再改 §5 文档。
- 文件：`tests/contract/board-workflow.test.js`、`tests/contract/check-board-workflows-live.test.js`、`scripts/board-workflow-check.mjs`、`scripts/check-board-workflows-live.mjs`（注释）、`docs/product/board-semantics.md`。
- 验证：`node --test tests/contract/board-workflow.test.js tests/contract/check-board-workflows-live.test.js` 先 3 fail，改后 0 fail。两条变异各自变红：把第十行改成 `enabled: false`，以及删掉 `why` 里的「不含 PR」。最后对真实看板跑 live 检查，期望 exit 0。
- 回滚点：revert 本批提交，检查回到「1 条 `unknown`」的已知状态。

### Batch 2 · 回归与归档

- `pnpm verify`、`pnpm run boundaries`、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`。
- 本计划移入 `docs/exec-plan/completed/`，在 `docs/README.md` 的 Completed 索引登记。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 三处一致登记第十行 | `board-workflow.test.js` 的十行钉死测试通过；§5 表含第十行 |
| 前提随数据走 | 新测试断言 `why` 含「不含 PR」与「人工核对」；删掉前者即变红 |
| 开关方向被钉住 | 第十行改成 `enabled: false` 时契约测试变红 |
| 真实看板合规 | live 检查输出「已检查 10 条看板内置工作流，全部符合裁决表。」，exit 0 |
| 无回归 | `pnpm verify` fail 0；`boundaries` fail 0；`workflow-check` 无发现 |
| 定时运行转绿 | 合并后下一次 `Board invariants` 定时运行的 `Board workflow invariants` job 为 success（合并后回读） |

## Progress

- [x] 2026-10-01：回读 9 次定时运行的失败原因，并在真实看板上复现那条 `unknown`；规划所有者确认过滤条件只含 issue；开 issue #248。
- [ ] Batch 1：裁决与三处同步。
- [ ] Batch 2：回归与归档。
- [ ] 合并后回读下一次定时运行。

## Surprises & Discoveries

- 同一个定时 workflow 的另一个 job `Engineering field drift` 也报过两类红：09-24～09-27 是 #180，09-30 是 #70。#70 那次的根因是 `engineering-state.yml` 的全局并发组会取消排队中的运行，丢掉了 #241 的 `CHANGES_REQUESTED` 投影（run 36679161542 cancelled）。它与本计划无关，已单独登记为 issue #249。当前 live 漂移检查为 47 个条目全部相等。
- 漂移观察者跳过所有未被 PR 引用的条目，所以没被引用、却带着陈旧 `Engineering = PR open` 的条目（#4、#5、#27、#28、#139、#205）不会被报出来。这不属于本计划范围，记在这里，留给 #249 一并判断。

## Decision Log

- 2026-10-01 / 规划所有者（会话中）：`Auto-add to project` 的过滤条件只加 issue、不含 PR，并选择按「开启」裁决。
- 2026-10-01 / 实现者：前提写进 `why` 与 §5，并用契约测试钉住。Rationale：API 读不到过滤条件，前提只能由人核对；它必须出现在检查器输出和权威文档里，否则「开着」会被误读成「合规」。
- 2026-10-01 / 实现者：移除条目后是否会被再次加入，登记为残余风险，不推断。Rationale：GitHub 文档未说明，本仓库也没有实测。

## Idempotence and Recovery

全部步骤只改仓库文件，可重复执行。live 检查只读看板。失败时 revert 本 PR 的合并提交，检查回到「1 条 `unknown`」的已知状态，不涉及外部写入。若规划所有者之后把过滤条件改成包含 PR，应把第十行改成「关闭」，或要求恢复过滤条件，并更新 §5。

## Interfaces and Dependencies

- `projectV2.workflows { nodes { name enabled } totalCount }`，经 `PROJECTS_TOKEN` 读取（`.github/workflows/board-invariants.yml`）。
- 契约：`EXPECTED` 的元素形状 `{ name, enabled, why }`，`boardWorkflowFindings` 的四类输出不变。

## Outcomes & Retrospective

待 Batch 2 完成后回填。

## Bottom Change Note

- 2026-10-01：创建计划，记录裁决依据、被放弃的方案与两项旁见。
