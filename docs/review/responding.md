# 回复评审工作流

## 1. 先判断意见

读取完整 thread、上下文、当前 diff、相关代码、测试和 AGENTS / ExecPlan。把意见分类为事实缺陷、规则解释、范围建议或风格建议，检查它是否真实影响系统不变量、用户结果、信任边界或验收证据。过严的意见可以用技术证据反驳；不要默认同意，也不要为逐条意见打补丁。

## 2. 从根因修复

使用 First Principles Development 和 Qian Systems Router：重述要改变的结果，找症状、直接原因、根机制和使能条件，确定最小可判定实验。若意见揭示共享根因，修正单一权威、状态机、边界或契约，并补一个能区分修复前后的测试或检查。

使用 Superpowers 的接收评审流程；复杂修复建立或刷新 ExecPlan。保持一个 PR 的闭环、文件 ownership 和风险范围；不把不相关的清理、模型迁移或架构重写混入回复。

## 3. 提交和回读

先在本地验证，再整理 commits。推送后重新读取 PR 的当前 head/base、mergeStateStatus、checks、review threads 和 diff；rebase 会使旧行号和旧证据失效。只有新 head 的证据成立，才能回复“已修复”。

逐条回复 thread：说明采取的根因修复、验证命令和结果；不采纳时说明事实和规则依据。只有对应问题已修复或技术上有充分反驳，才 resolve thread；不能在未验证、未 push 或只完成局部补丁时 resolve。

P0/P1 修复后必须重新检查全部相关风险矩阵。P2/P3 只有在改动机械、范围清晰且不会削弱验证时才顺手修；否则留在 issue 或 PR 级 follow-up。rebase merge 只有人类明确要求时执行。

## 4. 模型与并行

动态工作流或 Agent Team 只用于 disjoint tasks。模型选择按任务能力与宿主可用性决定；deepseek-v4.1-flash、gpt-5.6-sol 等是候选路由，不是承诺。最终验收模型的职责是对抗验证、重构和证据审计，不能替代人类对 PR 的批准或合并决定。
