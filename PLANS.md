# PLANS.md —— ExecPlan 规范

> 本文件定义本仓库中"计划文档"的格式与生命周期。工作约定的其余部分见 `AGENTS.md`。

---

## 1. ExecPlan 是什么

ExecPlan 是一份**自带上下文的活文档**：一个对本仓库一无所知、也没有本次对话历史的实现者（人或 agent），只读这一份文件加上仓库代码，就能把任务做完并知道何时算做完。

它同时承载两件事：

- **Design / Spec**：为什么这样做、放弃过哪些方案（原本属于独立的设计文档）。
- **Plan of Work**：具体怎么做、每批的验证命令与回滚点（原本属于独立的实施计划文档）。

两者的生命周期不同（设计一次收敛、计划反复修订），但把它们放在同一份文件里可以避免最常见的失败模式：计划已经改变，设计说明还在描述旧世界。

---

## 2. 何时需要、放在哪里

| 情况 | 是否需要 | 位置 |
|---|---|---|
| 跨"设计 + 实现 + 验证"的任务 | 需要 | `docs/exec-plan/active/YYYY-MM-DD-<slug>.md` |
| 单行修复、文案调整、依赖小升级 | 不需要 | 直接改，提交信息说明即可 |
| 只产出一个不可回退的决策 | 不需要 ExecPlan | 记入 `docs/adr/` |

- 文件名日期用**创建**日期；`<slug>` 用小写英文连字符，描述任务而非工具（`repo-bootstrap`、`planning-identity-model`）。
- 一个任务一份 ExecPlan；同一份文件内不要塞入多个不相关目标。
- 全部验收通过后，把文件移到 `docs/exec-plan/completed/`（文件名不变），并更新 `docs/README.md` 索引。

---

## 3. 强制章节

顺序固定，标题使用下列英文名（便于脚本与检索）；正文用中文。

| 章节 | 必须包含 |
|---|---|
| `Purpose / Big Picture` | 完成后世界是什么样；判断成功的最小证据 |
| `Context and Orientation` | 读者需要的全部背景：术语、相关文件、当前状态、上游依据 |
| `Design / Spec` | 方案与取舍（含被放弃的方案及原因）、关键不变量、命名与边界决策 |
| `Global Constraints` | 全任务通用的硬约束（版本、语言、依赖限制、禁止事项） |
| `Plan of Work` | 批次列表；每批：最小闭环、涉及文件、步骤、验证命令与期望输出、回滚点 |
| `Validation and Acceptance` | 可核对的验收表（验收项 → 判定证据） |
| `Progress` | 已完成/未完成项，带日期；阻塞项显式标注 |
| `Surprises & Discoveries` | 与预期不符的事实 + 证据（命令输出、文件路径、上游文档） |
| `Decision Log` | 决策 + Rationale + 日期/作者 |
| `Idempotence and Recovery` | 哪些步骤可重复执行；失败后如何恢复；如何回到已知良好状态 |
| `Interfaces and Dependencies` | 依赖的外部工具、凭据、仓库设置、命名契约 |
| `Outcomes & Retrospective` | 完成后的实际结果、与计划的偏差、遗留问题 |
| `Bottom Change Note` | 每次修改本计划时追加一条"何时、为何改" |

---

## 4. 写作规则

**必须做到**

- **自包含**：不写"见上文/如前所述/参考之前的讨论"。需要的信息要么写进来，要么给出确切路径。
- **可执行**：每条验证写成可直接复制的命令，并给出期望输出。
- **确切路径**：所有文件都要给出仓库内相对路径，不写"某个配置文件"。
- **批次的四个判据**（见 `AGENTS.md` §5.1）：可判定、可回滚、最小闭环、不聚合也不摊薄。
- **如实记录**：验证失败就写失败；跳过就写跳过与原因。
- **一个事实只写一处**：批次改动的文件集合只在 `Global Constraints` 声明一次；`Plan of Work` 的「涉及文件」只列该批次新增/改动的主文件，不复述整个集合；`Progress`、`Decision Log`、`Bottom Change Note` 要提它时写"见 `Global Constraints`"，不复述、也不另立一份。理由：2026-09-21 那一轮的六份计划里，同一集合有 5–9 处副本，执行期间只更新了其中一部分，于是计划自己否证自己（五份同时声明"不改某文件"而自己的 diff 改了它）。
- **被推翻的结论就地标注，而不是只在新处写订正**：后来得到相反结论时，在**原处**追加 `Superseded by <新结论所在章节或文件>（<日期>）`，原文保留。`docs/adr/README.md` 对 ADR 已有同样规则，ExecPlan 沿用。只在新处写"订正"、把旧结论留在原地，等于同一事实两处相反。
- **易失状态写成"回读命令 + 期望"，不写成值**：head SHA、check 列表与条数、行数、`mergeable` 状态、冲突预演结论都属于易失状态。要么写成 `gh pr checks <n>`（期望：全部 pass）这样的规则，要么标注观察时刻与 head（`2026-09-22T03:20Z @ ab2c3d4`）并给出重算命令。理由：六份计划里有五份把易失值写成正文事实，其中一处的 head SHA 在写入 15 秒后就不再是 head。
- **证据带执行上下文**：记录命令时同时写清**在哪个检出上跑**——分支名（或 head SHA）是必需项，目录用可移植形式表达（"在检出 `<branch>` 的工作树根目录运行"）；`gh` 这类按当前目录解析仓库的命令还要带 `-R` / `--repo`。判据是：换一个目录跑同一条命令会得到不同结果时，这条记录必须能让第三方复现出同一个结果。**只写本机绝对路径不算**（别人没有那个目录），`.worktrees/<slug>` 这种仓库内相对路径可以写，但它是路径引用、不是把运行态内容写进文档（`AGENTS.md` §3 禁止的是后者）。理由：六份计划全篇都没有写工作目录，其中 11 条命令（`gh stack view`、`gh pr checks`、`gh project …`、依赖本地分支引用的 `git log`）换目录即变。

**禁止**

- 占位符：`TBD`、`TODO`、`稍后补充`、`实现细节待定`。
- 空泛步骤："添加适当的错误处理"、"处理边界情况"、"写相关测试"。
- 无证据的结论："应该可以工作"、"看起来没问题"。
- 只在脑子里存在的设计：Design 章节必须能让没参与讨论的人理解取舍。

---

## 5. 更新义务

| 时机 | 更新内容 |
|---|---|
| 开始执行前 | 章节齐全、批次有验证命令 |
| 每完成一批 | `Progress` 勾选 + 日期 |
| 发现与预期不符 | `Surprises & Discoveries`（附证据） |
| 做出不可轻易反悔的选择 | `Decision Log`（附 Rationale） |
| 计划本身变化 | 直接改文件 + `Bottom Change Note` 追加一条 |
| 全部完成 | `Outcomes & Retrospective`；文件移入 `completed/` |

执行过程中**不要**另建进度文件或临时笔记：运行态内容放 `.superpowers/`，持久结论放 ExecPlan。

---

## 6. 最小模板

```markdown
# <任务名> ExecPlan

> 状态：Active
> 创建：YYYY-MM-DD
> 范围：<一句话边界>
> 上游输入：<相关文档路径>

## Purpose / Big Picture
<完成后世界是什么样；最小成功证据>

## Context and Orientation
<术语、相关文件、当前状态>

## Design / Spec
<方案与取舍；被放弃的方案>

## Global Constraints
<硬约束列表>

## Plan of Work

### Batch 1 · <名称>
**最小闭环**：<一句话>
**涉及文件**：<确切路径>
- [ ] 步骤 …
**验证**：<命令 + 期望输出>
**回滚**：<如何撤销>

## Validation and Acceptance
| # | 验收项 | 判定证据 |
|---|---|---|

## Progress
- [ ] Batch 1 …

## Surprises & Discoveries
## Decision Log
## Idempotence and Recovery
## Interfaces and Dependencies
## Outcomes & Retrospective
## Bottom Change Note
```
