# Native Issue Hierarchy ExecPlan

> 状态：Completed（本计划工程验收完成；#543 安装与人类接受独立）
> 创建：2026-11-10
> 范围：实现 #594 的只读 GitHub Issue 父级与子 Issue 观察，供既有 Work Item 详情展示；#543 保留安装态与人类接受。
> 上游输入：`AGENTS.md`、`PLANS.md`、#543、#594、#589、#590；当前类型/实现 `packages/capabilities/src/planning-provider.ts` 与 `packages/core/src/issue-dependencies.ts`。

## Purpose / Big Picture

用户能在现有工作项详情里看到来源 Issue 的父项和子项，明确区分层级与 `blockedBy`/`blocking`。观测结果保留来源仓库、native number、标题、状态和安全目标链接；用户不必把目标加入当前 Project，也不会因查看而创建本地业务关系或改写 Planning Status。

成功的最小证据是：真实 Provider query/decode 区分父项存在与完整读取后的 null、子项多页与不完整结果；Core/client/UI 保留独立状态和迟到响应围栏；production Host→client→detail browser 流程显示可访问的父/子关系，既有 blocker 与 PR 链接行为保持正确。

## Context and Orientation

PR #590 已交付 #543 的 `blockedBy` 与 `blocking` 工程叶；它没有 `parent` 或 `subIssues` query/typed stream。当前 provider 在 `packages/providers/planning-github-projects/src/issue-dependencies.ts` 只接受两种 blocker direction，Core 与 UI 也只消费这两种结果。#594 是本次新建的工程 child，接受只读父/子观察；#543 父项继续承担原始 exact-artifact 安装和人类 UAT。

GitHub Issue.parent 是 nullable 的单个 Issue，Issue.subIssues 是可分页 Issue connection。父项 null 只有在项目、成员、Issue/source proof 成功且无错误时才表示“完整空”；子项任何分页失败都不得变为 complete empty。现有 Core 读链已提供 source/scope proof、权限变化、刷新状态和迟到结果处理，优先复用。

## Design / Spec

在现有 typed 只读 relation reader 上新增两个独立方向 `parent` 与 `children`。对外父项为零或一个 source-qualified target，子项为有界分页 targets；沿用现有安全 DTO，不建通用图、数据库缓存或新 Controller/Host 操作。层级观察与阻塞方向分别保留状态；权限撤销时遵循现有 reader 的结果失效规则，A→B→A、binding/repository 改变和迟到响应均不能发布旧目标。

拒绝从 Issue body 推断层级：文本不是权威关系。拒绝把层级持久化到统一业务 graph：当前需求是来源只读，不授权本地 relation 写入。拒绝复制整条独立 API/Host 接线：它重复现有 freshness、timeout 和权限围栏并挤压 800 行预算。若现有 reader 的 capability 类型不能表达父项 null 与子项分页的独立 completeness，则增加最小 typed 形状，不把 null、denied 或 partial 归并为空数组。

## Global Constraints

- 唯一 hierarchy owner；允许变更路径仅为 `packages/capabilities/src/planning-provider.ts`、`packages/providers/planning-github-projects/src/queries.ts`、`packages/providers/planning-github-projects/src/issue-dependencies.ts`、`packages/core/src/issue-dependencies.ts`、`packages/core/src/context.ts`、`packages/client/src/issue-dependencies-reader.ts`、`packages/ui/src/issue-dependencies-section.ts`、`tests/contract/planning-issue-dependencies.test.js`、`tests/integration/issue-dependencies-scope.test.js`、`tests/browser/issue-dependencies.test.js`、`tests/fixtures/native-link-detail-browser.mjs`。仅当 strict wire validator 因新 typed 结果实际要求调整时，先告知主控并纳入计划；不改 PR closing-link reader、Storage、migration 或其它并行 lane 文件。
- Issue 关系必须来自 Provider 的显式原生观察，保留 source identity/repository scope 和 safe URL 验证。已关闭与当前 Project 外的目标可显示；不可读目标不泄漏 title/URL/number/count/AX 信息。
- 空、unread、unsupported、unavailable、denied、partial 和 complete 状态须可区分；子项页数与总耗时均有界。UI 是 typed observations 的消费者，禁止 UI 直接访问 Provider。
- 代码/测试/config additions+deletions 不超过 800 行，文档不超过 1300 行；预估 530–760 / 220–340。无新增持久化、兼容 ABI、关系编辑、Planning 写入或发布声明。
- PR 仅 `Closes #594`、`Refs #543`。PR merge 不关闭父验收、不推进 Project Status、不表示 R1 通过。不得触碰用户 GitHub 关系或工作区数据。

## Plan of Work

### Batch 1 · Hierarchy read and detail（#594）

**最小闭环**：现有只读 detail 路径在授权来源下展示完整 parent/subIssues，并将不完整、空与拒读保持为诚实且隔离的状态。

**涉及文件**：`packages/capabilities/src/planning-provider.ts`、`packages/providers/planning-github-projects/src/issue-dependencies.ts`、`packages/core/src/issue-dependencies.ts`、`packages/ui/src/issue-dependencies-section.ts`。

先在现有 fixture 中添加 parent present/null、子项跨仓同号与分页、closed/outside-Project target、wrong source proof、坏 URL、page-two failure、denial/recovery 与迟到响应判别例。随后增加 provider query/decode 和 typed result；parent 用单项响应而非伪分页，children 在预算耗尽或后页失败时输出 partial。Core 将两方向接入当前同一 source ticket/freshness 机制；client strict path 和 UI 展示父/子方向及状态，不改变 blocker 方向。

Browser 通过既有生产 composition 检查方向标签、same-number source disambiguation、可访问链接、complete empty vs unavailable/partial，以及切换 Issue/account/binding 后旧资料不泄漏。断言关系查看前后没有本地业务 relation、membership、context 或 Planning Status 写入。只为 hierarchy 独有风险新增断言，不重写 PR links 或 blocker 已有覆盖。

**验证**：在检出 `feature/native-issue-hierarchy` 的 `.worktrees/native-hierarchy` 根目录运行 `pnpm test:file tests/contract/planning-issue-dependencies.test.js tests/integration/issue-dependencies-scope.test.js tests/browser/issue-dependencies.test.js tests/browser/native-link-detail.test.js`（期望：目标 Provider/Core/UI 用例非空且全绿；阻塞/PR link 回归同绿）。之后运行 `pnpm run boundaries` 与 `pnpm verify`（期望：退出码 0）。

**回滚**：revert #594 PR 即恢复现有 blocker-only 读路径；无 schema、用户数据或外部关系变化。

## Validation and Acceptance

#594 工程接受要求上述 typed provider/core/client/UI 纵线与测试覆盖 parent 和 children 的完整/不完整/权限/来源边界，边界和全仓验证通过，规模受限。#543 的 installed artifact、Desktop 可用性和人类反馈必须另行按原 issue 验收；browser tests 不替代安装验收。PR 不关闭 #543。

## Progress

- [x] (2026-11-10 10:10 SGT) 完成父 issue 原始 AC 与 capability 现状审读。
- [x] (2026-11-10 10:27 SGT) 增加 parent/subIssues typed 只读 observation，并贯通既有 Provider → Core → Host/client → detail path。
- [x] (2026-11-10 10:43 SGT) 完成目标 39/39、边界 9/9、全仓 3851/3851 验证；独立审阅者另跑 39/39，无 P0–P3 发现。

## Surprises & Discoveries

- 当前 #543 的 blocker 工程叶已合并，但父/子层级仍完全没有 query 或 typed observation，不能把“关系面板存在”当成原需求全满足。
- 同一 GitHub Issue 的 parent 是 nullable 单值、subIssues 是 connection；两者需要不同解码和 completeness 规则。
- hierarchy 是来源事实，不是本地已确认业务关系；不能据来源查询创建 `Relation` 或变更工作项成员。

- 2026-11-10：层级 account 关联切换用例发现，旧来源戳只有账户记录、没有账户关联 ID；账户记录暂不可读时不同关联可能生成同一戳。现在同时纳入关联 ID，`held hierarchy is fenced after account` 已通过。
- 2026-11-10：production browser 中实际拒读会更新 `nativeAccessVersion`，UI 先清空当前事实并显示尚未确认；Core 保留 denied，且旧标题、仓库、链接均不泄漏。

## Decision Log

- 决策（2026-11-10 / 本会话人类条件授权）：PR #602 无 P0/P1 后由评审会话继续收尾；用户直接指令为“你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并”。
  理由：完整 MMP 矩阵无新增 P0–P3；独立证据和当前版本门见 [本 PR 评审](../../review/pr-602-mmp-review.md)。只关闭 #594 工程叶；#543 保留安装态和原始人类接受，Planning Status 不由工程合并改变。

- 决策：为 #543 创建的子 issue #594 作为此 PR 的唯一关闭目标，PR 同时引用 #543。
  理由：隔离可实现的工程叶，同时让父项保留安装态和人类验收范围。
  日期/作者：2026-11-10 10:10 SGT / Codex。
- 决策：复用现有 read-only reader 和 Host/client operation，不另建一条权限/freshness 管线。
  理由：当前纵线已经实现 source proof、分页、权限撤销和迟到响应；新语义只需 typed hierarchy extension。
  日期/作者：2026-11-10 10:10 SGT / Codex。

- 决策：详情总区和刷新动作使用“来源 Issue 关系”，保留“父 Issue”“子 Issue”“阻塞此 Issue”“此 Issue 阻塞”独立区。
  理由：层级不能放在命名为阻塞关系的语义容器下；沿用已有布局、链接与 status 模式。
  日期/作者：2026-11-10 10:27 SGT / 实现者。

## Idempotence and Recovery

所有行为均为只读；重复刷新不会写业务关系或状态。失败时显示当前 stream 的 unavailable/partial/denied 等状态，不发布伪空集合。回滚仅恢复旧 blocker-only UI/provider 面；无 migration 或外部原生关系变更。

## Interfaces and Dependencies

依赖现有 `PlanningProvider`、GitHub GraphQL transport、Core refresh reader、strict client schema、React detail section、Node test 与当前 harness Host production fixture。无需新增凭据范围；只处理当前授权可见的 source observations。所有命令在指定 worktree 根目录执行。易失的最终远端状态由主控在 PR #602 回读：`gh pr view 602 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,mergeStateStatus,closingIssuesReferences`、`gh pr checks 602 -R SingularityKChen/harness-projects`，并读取当前 review threads。期望 head 对应本分支、base 为 main、关闭目标仅 #594、执行检查通过且无未处理阻塞线程；满足后才 Ready，#543 installed/human gate 保持。

## Outcomes & Retrospective

在检出 `feature/native-issue-hierarchy` 的 `.worktrees/native-hierarchy` 根目录执行本计划目标验证：39 条用例全部通过；包边界验证 9 条全部通过。parent 使用不带分页变量的单项 query，null 需完整来源回证后才变为空；children 在既有十页/十秒预算内分页，后页失败保留 partial 与已验证项。四类 stream 保持独立完成时间与状态；权限撤销和来源变化使旧层级结果失效，未发生本地业务关系或 Planning 状态写入。

实现者已保存并检查 production composition 的完整与部分读取截图；截图为忽略的运行证据。同一检出运行 `pnpm verify` 退出码 0：typecheck 与契约 1444、集成 2181、E2E 226 条全部通过，共 3851 条。2026-11-10 10:29 SGT 相对基线 `b8aa03af` 的 `git diff --numstat b8aa03af` 实现者观察为代码/测试 188 行、文档 103 行，均低于预算；最终提交仍须重算。此前“独立审读待完成”的时点说明由本次独立验收取代（2026-11-10 10:43 SGT）：无 P0–P3 发现，39 项相关测试复核通过。远端 PR 回读按本计划接口规则执行。#543 的安装态与人类验收继续开放；本次 browser 验证不代替该门禁。

独立对抗探针还确认：普通后页故障保留本流已验证项；总超时导致最终来源复核无法完成时，四方向统一清空为 partial。后者是共享来源权威复验的保守失效边界，不把旧目标在未复核时保持可见。

## Bottom Change Note

- 2026-11-10 10:10 SGT：基于 #543 当前 blocker-only 合并范围与新子 issue #594，创建独立 parent/sub-Issue 只读交付计划；父项 installed gate 明确保留。
- 2026-11-10 10:10 SGT：按主控交付边界统一 Batch 标签为 `Hierarchy read and detail`。
- 2026-11-10 10:15 SGT：将已完成设计审读标为完成，保持实现与 #543 安装验收未完成。

- 2026-11-10 10:27 SGT：记录 typed 四方向实现、层级 TDD 与 production browser 结果，补充 account 关联 ID 围栏发现及容器命名决策；保留独立审读和父验收门禁。

- 2026-11-10 10:43 SGT：登记独立验收与总超时证据边界，易失远端状态改以回读命令和期望约束表达，工程计划移入 completed；#543 人验不变。

- 2026-11-10：登记完整 MMP 矩阵、独立变异和直接条件收尾授权；计划保持 completed，最终 head 的 checks/review/issue 与 rebase 结果按评审回读门判定。
