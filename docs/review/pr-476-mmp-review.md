# PR #476 MMP 交付审查

## Purpose / Big Picture

判断 #448 的呈现闭环是否让用户清楚理解执行与 PR/CI 结果并安全恢复；保留 Host 权威和规划轴/工程轴正交。结论仅覆盖下列 immutable head，不替代安装 Host、人类 UAT 或 R1。

## Context and Orientation

- 日期：2026-10-30（+08）；执行上下文：`.worktrees/ui-execution-feedback`。
- base：`main` / `b19b4eac4f12aa40c05d75b492f3335299874641`。
- head：`e7fbc275739043104f56abbc5ea52d2818430db8`；单提交 `feat(ui): 统一执行交付反馈并恢复提交焦点`。
- PR 当前为 OPEN / Ready / MERGEABLE / UNSTABLE；最后回读 head/base 未漂移。双向 `Closes #448`，标签有 `kind:feat`、`area:ui`、`area:ui-model`；reviews、comments、reviewThreads 均空。
- 已读根 AGENTS、`docs/review/mvp-review.md`、`docs/review/README.md`、实施 ExecPlan、产品说明与 #448 正文；逐个读完全部 11 个变更文件。

## Design / Spec

采用 Superpowers 代码审查模板、Qian `analysis_synthesis`、First Principles `audit` / review quality control。事实：请求/意图/数据 owner 未迁移，新 helper 无状态；硬约束：未确认不得冒充成功、Host 权威、不改规划；关键未知：焦点票据是否干扰用户主动移焦或晚到请求。先锁风险，再用原测试、独立负控和真实浏览器回答未知。

## Global Constraints

只写本记录，临时 spec 在工作树 `.superpowers/`；不修改生产代码、不 commit/push、不发布 review/resolve/合并。变异只能通过 `scripts/review-mutate.mjs` 临时施加并恢复原字节。

## Plan of Work

锁定 head/base/线程/checks → 建初始矩阵 → 逐文件与调用链审查 → 定向测试/负控/浏览器 → 核对 issue 边界 → 一次性回传主审。

## 初始风险矩阵（逐文件审查前建立）

| 级别 | 代码 | 产品闭环 | 架构 | 测试 | 工作项 |
|---|---|---|---|---|---|
| P0 | secret、redaction 与成功误报 | 未 ack 不得显示权威 Saved | Host 权威、规划轴不被覆写 | 安全 canary | 发布面与硬边界 |
| P1 | pending/ack/recovery/focus | Start Work→反馈→读回/重试任务不断链 | 无第二交互状态 owner | 失败/unknown/并发/焦点反例 | #448 原验收 |
| P2 | 诊断与技术来源完整性 | 时间与空事实可理解 | 公共展示函数职责 | 判别力和缺失故障路径 | 当前 checks 与 scope 交叉检查 |
| P3 | 冗余实现/文案 | 可读性、层次 | 过度设计 | 重复测试 | 文档与记录一致 |

## Validation and Acceptance

全部命令在上述工作树运行；本地结果与托管 CI 分开。

| 实际命令/观察 | 真实结果 |
|---|---|
| `pnpm test:file tests/contract/ui-start-work.test.js tests/contract/ui-execution-context.test.js tests/contract/ui-delivery-lineage-section.test.js tests/contract/ui-delivery-lineage-strip.test.js tests/integration/harness-plugin-execution-drawer.test.js tests/integration/harness-plugin-delivery-lineage.test.js` | 73 tests / 73 pass / 0 fail / 0 skipped，exit 0 |
| `node scripts/review-mutate.mjs .superpowers/pr476-review-mutations.json` | 六项全部 KILLED，均命中指定 killedBy；还原后基线绿，exit 0 |
| `pnpm typecheck`（负控结束且恢复后重跑） | `tsc --noEmit`，exit 0 |
| `pnpm run boundaries` | 9/9 pass，0 fail/skip |
| `node scripts/rule-checks.mjs disclosure b19b4eac4f12aa40c05d75b492f3335299874641` | 机械扫描通过；人工读 diff、commit、PR 描述五类目未见新增泄漏 |
| `node scripts/rule-checks.mjs size b19b4eac4f12aa40c05d75b492f3335299874641` | 代码/测试/fixture 259，文档117；记录文件为本轮新增未计入原 PR |
| `git diff --check b19b4eac4f12aa40c05d75b492f3335299874641...HEAD` | exit 0，无输出 |
| `git diff --exit-code -- packages/ui/src tests/contract tests/fixtures` | exit 0；临时变异未留下源码差异 |

### 负控表

最终树整表运行一次，脚本逐项原字节恢复，全部归因有效：

| 变异 | killedBy 命名断言 | 结果 |
|---|---|---|
| M1：技术披露默认展开 | `six lineage slots expose state` | KILLED |
| M2：坏确认时间绕过 unconfirmed | `unconfirmed malformed time` | KILLED |
| M3：取消恢复动作 focus | `keyboard submission recovers lost focus` | KILLED |
| M4：不监听主动移焦、后续 body 时抢焦 | `moving focus away permanently cancels recovery` | KILLED |
| M5：旧目标结果清新目标票据 | `late target result cannot clear a newer focus ticket` | KILLED |
| M6：去掉 blocked passed→unknown 屏蔽 | `projection error cannot present passed` | KILLED |

### 实际浏览器

运行既有 `node tests/fixtures/execution-drawer-browser.mjs`，通过生产 `apply` 与真实 client 解码驱动组件。独立观察两个场景：

- 320×800、dark、`font=200`、unknown：分支输入 Enter 提交后，焦点为“读回并恢复”，草稿 `feature/review-probe` 保留；0 个 details 默认展开；四个呈现 section 各 `clientWidth=scrollWidth=108`，document scrollWidth305、viewport320，无新增横向溢出。
- 1024×900、light、failed：运行失败、CI失败、确认时间、人工承接、缺运行分别显示；Enter 展开来源后候选关系可读，Space收起，Escape关闭详情且焦点回原工作项 opener。

文字放大不是浏览器 zoom。浏览器和 server 已清理；此处未重跑作者完整四宽度/主题矩阵，未重测安装 Host 或真实 GitHub 权限。

### 托管 CI 与线程

`gh pr checks 476` 回读：唯一分支保护必需的 `PR Fast Gate` SUCCESS（run `41005509367`）；Verify、Merge Gate及其 Integration/Boundaries/E2E/MVP0、CodeQL、Issue policy、Disclosure scan、PR size 都通过。main保护回读为 strict=true、required contexts仅 `PR Fast Gate`。

唯一红项 `Create review session`（run `41012454675`）日志实测 `endpoint responded: 404`；是可选会话转发基础设施，#364 OPEN已跟踪，不能称全 checks 绿色。旧工程 reconcile取消项已有同 head 后继 `41012455161` SUCCESS。当前无 review thread。

## Progress

- [x] 锁定事实、读取验收与指导文档，先建 P0–P3 初始矩阵。
- [x] 全部源码/测试/fixture/文档逐文件审查，追查 client/UI-model 的状态与时间契约。
- [x] 完成73项定向、6项命名负控、恢复后类型检查、边界/发布面/规模检查与实际浏览器。
- [x] 检查已有 issue 与边界，回传全部结论。

## Surprises & Discoveries

320px/200%下抽屉标题/关闭按钮占用严重，与未改动的容器一致；#479 / PR #480已单独跟踪。没有把该既有问题算成本PR新增 finding，也没有称本PR已修复。六位置仍保留缺口；候选/确认关系在原生披露中，未由 passed 自动升级。运行/人工承接、确认时间/陈旧提示、结果未知/恢复动作分别可读。

## Decision Log

2026-10-30 / 独立审查：完整矩阵无可行动 P0/P1/P2/P3；建议主审复核后 APPROVE，无新增 inline finding。共享 helper 仅样式与无状态 markup，局部 focus refs/单 generation票据没有成为第二业务状态 owner；不为风格继续拆分。

明确放在本轮范围外的行为（没有静默丢弃）：

- 详情容器在大文字下标题挤压：#479 / #480，容器文件不在本PR修改面。
- Delivery运行时拒读/缓存scope隔离：#468 / PR #469负责；本PR保留现有owner，未声称验证其完整权限闭环。
- 真正PR创建：#437；唯一生产浏览器组合载体：#472；本PR只呈现原有动作与结果。
- 部署/完整diagnostics：#460；安装Host、人类UAT #449与R1：本地受控fixture不构成其接受证据。

## Idempotence and Recovery

变异由正式脚本按原字节恢复，源码工作树diff为零；server/tab/viewport override已清理。无外部写入和用户数据变更；主审可重复定向命令。head/base变更即须重新锁定与复评。

## Interfaces and Dependencies

生产变更仅 `packages/ui/src` 四文件；消费既有 client/UI-model，未改变公共导出、Provider访问、数据库、规划Status或权限状态机。审查未重新生成作者声称的干净包差；包差仍是作者ExecPlan证据，不列为本审查独立复测。

## Outcomes & Retrospective

完整矩阵结论：P0 0、P1 0、P2 0、P3 0；没有需要新增行锚点的可行动 finding。#448 的四项实现验收有局部组件/集成/浏览器证据；issue尚未勾选及人类UAT不由审查者代填。托管必需门禁通过与审查结论分开，最终合并决定留给人类伙伴。

## Bottom Change Note

2026-10-30：建立矩阵后完成独立逐文件、负控和浏览器审查；记录提交给主会话统一复核，未发布review或合并。
