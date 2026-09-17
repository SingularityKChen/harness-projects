# docs/project-management

本仓库的工作项看板：**用 GitHub Projects 承载 `AGENTS.md` 已经定义的工作单元**，不另造一套流程。

| 项 | 值 |
|---|---|
| 项目 | [harness-projects 交付工作台](https://github.com/users/SingularityKChen/projects/10)（编号 `10`） |
| 归属 | 用户级项目，已关联 `SingularityKChen/harness-projects` |
| 载体 | GitHub Issue（工作项）+ 项目字段（分类与阶段） |
| 与仓库的关系 | 项目是**视图**；约定与格式仍以 `AGENTS.md` / `PLANS.md` 为准 |

## 1. 字段

| 字段 | 类型 | 取值 | 语义 |
|---|---|---|---|
| Status | 单选（内置） | `Todo` / `In Progress` / `In Review` / `Done` | 与 PR 生命周期对齐：`In Review` = PR 已提交待评审；`Done` = 已合并或已验收 |
| Kind | 单选 | `feat` / `fix` / `docs` / `chore` / `refactor` / `test` | 与提交类型和 issue 标题前缀一致（`AGENTS.md` §8.2、§8.6） |
| Area | 单选 | 21 个取值：11 个包 + 8 个 `docs/` 子目录 + `ci` / `repo` | 与 `area:*` 标签同一套词汇（`AGENTS.md` §8.6），覆盖包所有权与文档目录 |
| ExecPlan | 文本 | 计划路径，如 `docs/exec-plan/active/2026-09-17-xxx.md` | 条目所属计划；无计划留空 |
| Batch | 文本 | 批次名，与 ExecPlan 的 `Plan of Work` 一致 | 用于把一个计划拆成可独立验收的条目 |
| Gate | 单选 | `E1` / `R1` | 阶段门禁；只有真正阻塞发布的条目才填 |

`Kind` 而不是 `Type`：GitHub 已把 `Type` 保留给原生 issue types，创建同名字段会返回 `Name cannot have a reserved value`。

## 2. 状态流转

```text
Todo ──开始实现──▶ In Progress ──提交 PR──▶ In Review ──合并/验收──▶ Done
                      ▲                        │
                      └────────评审要求修改─────┘
```

规则：

- 一个条目对应一个可独立验收的闭环；**不为了减少条目数量而聚合**（`AGENTS.md` §5.1）。
- PR 描述必须给出 ExecPlan 路径与批次；用 `Closes #N` 关联使合并后自动关闭条目。
- 合并后把 Status 改为 `Done`；如果条目是某个 Gate 的前置条件，先确认 Gate 的验收证据再改。
- 阻塞时保留在 `In Progress` 并在条目里写明阻塞原因，不新建"阻塞"状态。

## 3. 维护命令

```bash
# 列出条目与字段值
gh project item-list 10 --owner SingularityKChen --format json \
  --jq '.items[] | "#\(.content.number) \(.content.title) | \(.status) | \(.kind) | \(.area)"'

# 新建一个工作项并加入项目
url=$(gh issue create --repo SingularityKChen/harness-projects \
  --title "<标题>" --body-file <正文文件>)
item=$(gh project item-add 10 --owner SingularityKChen --url "$url" --format json --jq '.id')

# 设置单选字段（Kind / Area / Gate）
gh project item-edit --id "$item" --project-id PVT_kwHOAY1ahM4BjzAQ \
  --field-id PVTSSF_lAHOAY1ahM4BjzAQzhimAsI --single-select-option-id <option-id>

# 设置文本字段（ExecPlan / Batch）
gh project item-edit --id "$item" --project-id PVT_kwHOAY1ahM4BjzAQ \
  --field-id PVTF_lAHOAY1ahM4BjzAQzhimAs8 --text "docs/exec-plan/active/2026-09-17-xxx.md"

# 改状态
gh project item-edit --id "$item" --project-id PVT_kwHOAY1ahM4BjzAQ \
  --field-id PVTSSF_lAHOAY1ahM4BjzAQzhimAjM --single-select-option-id <status-option-id>
```

字段与选项 ID（`project-id` = `PVT_kwHOAY1ahM4BjzAQ`）：

| 字段 | 字段 ID | 选项 ID |
|---|---|---|
| Status | `PVTSSF_lAHOAY1ahM4BjzAQzhimAjM` | `Todo`=`64d36528` `In Progress`=`3193aea7` `In Review`=`00b734fd` `Done`=`9311f042` |
| Kind | `PVTSSF_lAHOAY1ahM4BjzAQzhimAsI` | `feat`=`ba8276f5` `fix`=`40530427` `docs`=`cc96fd00` `chore`=`f32757b9` `refactor`=`477cd5d0` `test`=`589ccc17` |
| Area | `PVTSSF_lAHOAY1ahM4BjzAQzhimAsM` | `domain`=`0904bab5` `capabilities`=`8c5ebc8c` `core`=`d51c5275` `controller`=`47ed6059` `client`=`83976956` `ui-model`=`5a8ed83d` `ui`=`3120e417` `providers`=`561036ae` `storage`=`1e73c960` `apps`=`0e5ee1f1` `tests`=`ff272f96` `docs`=`81b0a42c` `adr`=`a4b99604` `architecture`=`e29adf01` `product`=`6a2fb4c9` `exec-plan`=`ec88ad20` `project-management`=`3dfeb2c3` `review`=`ceddde8a` `development`=`e1077c72` `ci`=`967d5e8c` `repo`=`f2516a2c` |
| ExecPlan | `PVTF_lAHOAY1ahM4BjzAQzhimAs8` | — |
| Batch | `PVTF_lAHOAY1ahM4BjzAQzhimAuw` | — |
| Gate | `PVTSSF_lAHOAY1ahM4BjzAQzhimAwk` | `E1`=`ced298f3` `R1`=`a8c5abef` |

选项 ID 在字段被重建时会变化；变化后重新执行 `gh project field-list 10 --owner SingularityKChen --format json` 并更新本表。

**改动单选字段的选项列表会让已有条目的该字段值失效**（`updateProjectV2Field` 会重建选项，旧选项 ID 不再被引用，条目上显示为空）。因此：改选项之后必须对全部条目重新赋值一次，再回读确认——本表的 ID 与 `AGENTS.md` §8.6 的词汇表由此保持一致。

## 4. 视图

| 视图 | 布局 | 用途 |
|---|---|---|
| 看板 | Board | 按 Status 分组，看当前在做什么 |
| 计划 | Table | 按 ExecPlan / Batch 排列，核对一个计划的批次是否收敛 |

视图通过 GraphQL 的 `createProjectV2View` 创建；**分组、排序、可见字段等展示配置目前没有公开 API**，需要在网页端手工设置一次（看板按 Status 分组；计划表按 ExecPlan、Batch、Area 列出）。

## 5. 不做什么

- **标签与项目字段同源**：issue 的分类以 `kind/*`、`area/*`、`gate/*` 标签为准（见 `AGENTS.md` §8.6），本表的字段是它在看板上的投影；两套取值来自同一个词汇表，因此不构成"两份事实"。不引入优先级或严重度标签：本仓库没有事故语义，`gate:*` 已经表达"阻塞下一里程碑"。
- 不用项目状态机替代 PR 生命周期：`Status` 是**投影**，权威状态仍在 PR 与 ExecPlan。
- 不做自动生命周期投影（webhook 事件驱动改状态）：它需要常驻服务与额外凭据，收益不足以抵掉一个新的失效点。
