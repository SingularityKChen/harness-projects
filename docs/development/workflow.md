# 开发工作流

这份流程把 GPT-6 的持续执行、First Principles Development、Qian Systems Router、Superpowers 和 ExecPlan 约束放在一个可执行路径里。

## 1. 取证与设计

先读根 AGENTS、PLANS、相关 active ExecPlan、最近提交、测试、workflow 和开放 PR。把目标写成可观察结果，分开记录 fact、hard constraint、assumption、preference、decision 和 unknown；找出最可能改变方案的 principal uncertainty。

提出 2–3 个方案并比较系统边界、状态拥有、失败路径、可逆性、验证成本和后续维护。选最小纵向闭环，写入 active ExecPlan 的 Design / Spec 和 Plan of Work。不要复制通用 Python、LOC 或 self-hosted 模板；以本仓库证据为准。

## 2. draft PR 与并行实现

在修改代码前建立同仓 issue，标题和标签符合根规则；创建 draft PR，描述中使用 closingIssuesReferences 语义（Closes #N / Refs #N），并回读 PR 的 issue 关联、base、head、draft 状态和文件范围。一个 PR 可以关闭多个 issue，但所有 issue 必须组成同一独立闭环。

只有任务确实有两个以上互不共享写入区域的工作，才用 Agent Team 或动态工作流并行。为每个任务指定路径、输入、产出、禁止修改区域、模型能力和停止条件。deepseek-v4.1-flash、gpt-5.6-sol 等是路由示例，不是硬依赖；先核实宿主可用性、推理能力和任务风险。并行 agent 不编辑同一文件区域，不共享未经声明的临时状态。

每个批次都遵循：读 ExecPlan → 实现最小切片 → 跑该批验证 → 更新 Progress / Decision Log / Surprises → 提交。涉及行为时先写会失败的判别性测试；低风险可逆文档改动不写镜像测试。

## 3. 验收与人类评审

最后由适合验收和重构的模型或人执行独立审读：检查不变量、接口、状态拥有、错误路径、测试是否有判别力、文档链接、PR 体量和公开面。重构不得改变验收结果；重构后重新跑必要验证。

验收和重构完成后，先请求人类评审 PR。agent 不自行合并；只有人类明确要求时才执行 rebase merge。评审请求应包含当前 head、base、实际 checks、风险和回滚方式。

## 3.1 最终提交与 ready 状态

开 PR 前、以及最终 push 前，重新整理本地 commit：把同一批次的实现、文档和验证收敛为可独立审阅的提交，删除临时调试和 fixup；整理后重新跑与改动风险匹配的验证，并检查提交信息、diff 规模和发布面。

分支已推送时先创建 backup ref，再用精确 old head lease 执行 force-with-lease。push 后重新读取 PR 当前 head/base、merge state、checks、closingIssuesReferences 和 review threads。只有最终 head 的验证通过，才用 `gh pr ready <n>` 把 draft 更新为 ready；ready 状态不能沿用旧 head 的结论。

## 3.2 交付后的 `Status`

看板的 `Status` 是**规划轴**字段，回答「规划所有者是否接受这个工作项完成」，定义在 `docs/product/board-semantics.md` §1–§2。**工程事件不推进它**：PR 提交、评审通过、合并、CI 变绿都不改 `Status`——会写 `Status` 且由工程事件触发的内置工作流已按该文档 §5 全部关闭，`Item added to project` 是 §2 的唯一机械例外、保持开启；`Board invariants` 按日核对九条的启停状态。

因此 PR 合并之后：

1. 规划所有者决定这个工作项是否被接受为完成；
2. 接受则把 `Status` 置 `Done`；不接受就留在 `In Review`，并在条目里写明还差什么；
3. 写入由规划所有者本人执行——看板界面，或 `docs/project-management/README.md` §3 的 `gh project item-edit`。

**例外**：agent 可以代写，但前置是一条**点名目标**的人类批准，且必须记入所属 ExecPlan 的 `Decision Log`（`AGENTS.md` §7、`docs/development/repository-rules.md` §3）。没有这条批准的 agent 写入视为无效，应回滚或补批准。

这一步没有自动化，是刻意的：合并只是工程事实，接受与否是规划决定。把这个决定交给脚本或内置工作流，正是 `AGENTS.md` §1.1 不变量 3 禁止的「PR 合并默认覆盖规划状态」。

## 4. 风险驱动验证

文档变化执行链接、命令和规模检查；包边界执行 boundaries；行为变化执行相关契约 / 集成测试；门禁、安全、并发、持久化或外部写入变化扩大到完整相关回归和人工回读。没有新的失败、风险信号或未解问题时，不机械重复更宽测试。

交付前至少回读当前 head、base、mergeStateStatus、所有 checks、PR issue 关联和 review threads。把未验证项写成阻塞或明确遗留，不用“应该可以”。
