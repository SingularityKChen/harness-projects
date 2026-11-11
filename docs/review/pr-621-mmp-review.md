# PR #621 MMP 交付评审

观察日期：2026-11-11（Asia/Singapore）。结论：本轮独立评审未发现可行动的 P0、P1、P2 或 P3；工程范围可接受，建议 `APPROVE`。本记录不代表安装态接受或 R1 裁决，也不授权合并。

## Purpose / Big Picture

判断 #607 的只读 Timeline 是否真正消费当前授权 Host 数据，并在真实来源、共享查询、日期几何、唯一详情、撤权和不同显示条件之间构成完整能力闭环。使用 Superpowers 的证据优先核验、Qian Systems Router 的系统分析综合与 First Principles Development 的 audit 路径，先验证用户结果与状态拥有权，再判断局部实现。

## Context and Orientation

审查根 `AGENTS.md`、`docs/review/README.md`、`docs/review/mvp-review.md`、本层 diff、#607、全部线程与 [completed ExecPlan](../exec-plan/completed/2026-11-11-planning-timeline.md)。核心调查范围为 `planning-timeline.ts` 纯模型、`work-item-timeline.ts` renderer，以及既有 List/Project 的模式与局部状态 owner；按需追溯共享安全行、查询与真实 Host 浏览器夹具。

事实：当前 producer 只提供任务目标日与独立迭代窗口，没有真实任务起止区间。硬约束：Host 权威、单 Planning 源、规划与工程状态正交，撤权后不得显示旧内容。展示决定：固定周一七日、Asia/Singapore 显示日历、窗口外条目完整保留，窄区以同一安全行的完整文字回退。不能把缺少当前不存在的任务 range producer 当成本层遗漏，也不能把静态视觉语法示例当来源事实。

### 锁定事实

- head：`d274b3c86694cb897e93cccc219be506d42c9e2a`；base：`feature/source-schedule` @ `905d87bd3c212dc979ff046b855337a398e3e66b`。
- 执行上下文：检出 `feature/planning-timeline` 的 `.worktrees/planning-timeline` 根目录。
- 工作项：#607；单一提交 `feat(ui): 交付真实来源的只读时间线`，`Closes #607` 与远端 `closingIssuesReferences` 一致。
- 远端首尾回读 head/base 一致；`MERGEABLE`、非 draft、`UNSTABLE`。完整 review threads 为零，`hasNextPage=false`。标签为 `kind:feat`、`area:ui`、`gate:R1`。
- 当前 head 的 `PR Fast Gate`、Verify、Browser、CodeQL、Issue policy、Disclosure scan、PR size 与工程状态重算均成功。唯一红项是可选的 `Create review session`；已独立读取 run `42993549780`，实际原因是端点 HTTP 404，对应既有 #364，不是产品测试失败。
- 按实际 base 的代码增删 463 行、文档增删 133 行，另有八张 PNG。没有把 #620 的日期传递、持久化与详情变更算入本层。
- 实现会话已由协调者找到。本轮只写本评审记录，没有修产品、commit、push 或 GitHub 外部写入。

## Design / Spec

评审遵循三条可证伪路径：来源事实是否准确成为 marker/band/文字；共享状态在视图切换、日期定位、筛选和 scope 变化时是否一致；撤权、旧帧、断网、无能力及窄区是否破坏安全或可操作性。可行动意见必须指向本层新增行、给出可复现因果与最小修复方向；未经证实的偏好不作为缺陷。

### 审查前风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 合并即破坏主流程或泄露数据 | 错误状态、越权、失败恢复断裂 | 可恢复边界错误 | 冗余与可维护性 |
| 产品闭环 | 权威事实损坏 | 来源→持久化→展示→操作链断裂 | 非核心交互与提示缺口 | 文案一致性 |
| 架构 | 七条不变量/信任边界破坏 | 事实拥有权、依赖边不正确 | 不必要耦合 | 局部简化 |
| 测试/反例 | 安全假绿 | 关键失败路径无判别证据 | 次要缺口与过度测试 | 组织与命名 |
| 工作项/设计 | 无法独立交付或回滚 | issue 验收不成立、范围遗漏 | 证据或既有追踪缺口 | 记录清晰度 |

上表在逐文件审查前建立；下表为全矩阵审查后的判定，未在首个候选问题处停止。

| 层 | P0/P1 结果 | P2/P3 结果与证据 |
|---|---|---|
| 代码 | 无；安全行输入、日期日序运算、固定七列、受控 anchor，无写入路径 | 无；目标日居中、半开迭代裁剪、0/invalid、0001/9999、窗口外条目与日期定位均有真实断言及定向反例 |
| 产品闭环 | 无；生产 `apply` 经实际 Host 组合链进入 Timeline，唯一详情可达，读门撤回和迟到旧帧不留内容 | 无；共享查询/排序/显示列、视图往返、scope 清理、键盘 Enter/Escape/回焦、窄区文字与断网提示成立 |
| 架构 | 无；复用 List 局部展示 owner、Project 唯一详情、既有查询与安全投影，无 Provider 调用或第二业务 store | 无；没有引入新库、虚构 range、日期写入或工程状态覆盖规划状态；边界测试 9/9 |
| 测试/反例 | 无；五项变异均由指定 `killedBy` 杀死，还原后基线再次通过 | 无；独立跨时区、负时长/越界、极长合法窗口、排序/筛选/scope 与普通字段变化反例补充已提交测试 |
| 工作项/设计 | 无；#607 的工程叶与本层范围一致；父层仍独立，回滚无需修改用户数据 | 无；实际审读八图与 v3，未发现物质性视觉偏离；#599 安装/审美接受和 R1 明确保留，#608/#609/完整 #147 不被冒充完成 |

## Global Constraints

仅 `.worktrees/planning-timeline` 的本记录属于持久写集。官方变异工具短暂施加并还原五项变异；没有留下产品改动。运行只使用合成 Fake Planning Provider、临时 SQLite 与本地 HTTP 载体，不访问真实 Planning 平台或安装 Host，不更改规划状态、依赖或发布门禁。

## Plan of Work

1. 锁定 immutable head/base、issue、线程与真实 checks；建立五层 P0–P3 矩阵。
2. 追踪生产 Host → typed remote/client/store → 安全行 → Timeline；检查状态拥有权与窄区/键盘路径。
3. 跑最窄合同及生产浏览器验证、独立反例和官方变异；审读八张代表图与批准的 v3 对照。
4. 完整回填证据、排除不成立的候选发现，回读远端并交回协调者。任何后续 head/base 改变均须重锁范围。

## Validation and Acceptance

以下命令均在上述执行上下文、锁定 head 上运行；结果没有引用作者旧 head 的全套通过数冒充本轮运行：

    pnpm test:file tests/contract/ui-planning-timeline.test.js tests/browser/planning-timeline.test.js
    pnpm boundaries
    node scripts/rule-checks.mjs size 905d87bd3c212dc979ff046b855337a398e3e66b
    git diff --check 905d87bd3c212dc979ff046b855337a398e3e66b...HEAD
    gh pr checks 621 -R SingularityKChen/harness-projects
    gh run view 42993549780 -R SingularityKChen/harness-projects --log-failed

- Timeline 合同 2 项、生产组合浏览器 3 项，共 5/5 通过，无 skip/todo；边界 9/9 通过。规模与 diff whitespace 检查通过。`gh pr checks` 因已查明的可选 HTTP 404 返回 1。
- 已提交浏览器实际覆盖：28 个安全条目、target-only/iteration/zero/invalid/undated、自己的行几何与表头对齐、远日定位与 0001/9999 边界、局部滚动与有界节点；共享查询和唯一详情、Tab/Enter/Escape/回焦；授权断网保留、单项遮蔽清派生 header、读门拒绝及 held 旧帧；午夜、1440/1024/390、浅深主题与 200% 文字。
- 独立浏览器反例使用 `startExecutionServer({seed:'timeline'})` 的真实 Host 组合链：把 `Timeline zero` 的原生迭代设为 `2026-11-15/-7`，仍保留该行并显示“迭代窗口无效”，没有 band；设 `0001-01-01/3652059` 后合法长窗口可裁剪为当前七日，单行 Timeline 节点少于 100；设 `9999-12-31/2` 后无效且没有 band。逆序来源在当前 ABI 中由负时长表达，不虚构不存在的任务 end 字段。
- 独立浏览器分别设置 `America/Los_Angeles` 与 `Pacific/Kiritimati`。固定 instant `2026-11-10T15:59:30Z` 时两者均显示 `2026-11-10 · Asia/Singapore`，推进 60 秒均为 `2026-11-11`；来源 date-only `2026-11-13` 不偏移。两环境均验证 targetDate 升序与 List 完全相同、进行中筛选跨视图一致、前周 `2026-11-02` 在 workspace/binding scope 改变后重置当前周 `2026-11-09`，筛选回到全部。
- 实际打开并审读 [八张代表图](../product/timeline-evidence/README.md)，对照批准的 v3 1440 浅色图。短行密度、目标菱形、独立虚线迭代、未排期语义和选择/定位层级清楚；1024、390 和 200% 的完整文字可达且自然换行。当前 runtime 的 24 组合几何断言通过；审美判断同时依据实际图像，没有只用“不重叠”代替视觉审读。

### 变异表

在最终产品树上一次整表运行 `node scripts/review-mutate.mjs "$MMP_TIMELINE_MUTATION_SPEC"`；运行态 spec 的五项变异如下，command 为上述 Timeline 合同与浏览器联合命令。官方工具退出 0，并验证逐项字节还原与还原后的绿色基线。

| ID | 实际变异 | `killedBy` | 结果 |
|---|---|---|---|
| T1 | `planning-timeline.ts` 中目标日 `.5` 居中偏移改为 `0` | `Timeline aligns independent source target` | KILLED |
| T2 | 迭代裁剪右端 `window.endDayExclusive` 改为减 1 | `Timeline aligns independent source target` | KILLED |
| T3 | 从模型丢弃所有窗口外目标日条目 | `Timeline aligns independent source target` | KILLED |
| T4 | `work-item-list.ts` 中定位来源 key 检查改为恒真 | `composed Host Timeline preserves source dates` | KILLED |
| T5 | `work-item-timeline.ts` 分钟 timer 回调改为空 | `composed Host Timeline preserves source dates` | KILLED |

## Progress

- [x] 锁定当前 head/base、提交、issue、完整 threads 与 checks，建立全部严重度矩阵。
- [x] 完成模型、生产接线、安全状态拥有权、交互和视觉审查。
- [x] 跑 5 项聚焦、9 项边界、独立反例与 5 项官方变异，核对还原和最终 diff。
- [x] 完成非发现裁决、验收边界与当前远端回读，交回协调者。

## Surprises & Discoveries

独立挑战了“同一授权工作项修改/删除目标日后，旧定位周仍在 header”这一候选问题：定位 `Timeline far` 到 9999 年周，删除其 `nativeValues.target` 并刷新后，行立即成为未排期，但已选周仍是 `9999-12-27 → 9999-12-31`；再将来源目标日改成 `2033-04-12` 后，新值明确显示窗口外并提供定位。此现象不能证明越权或错误来源值：视窗本身是用户已选择的本地展示状态，计划明确只在来源不可读/读门/scope 撤回时清掉派生窗口，并要求普通刷新与视图切换保持展示状态。正常字段编辑没有改变这些权限事实。因此不把这一可恢复设计取舍报告为 P2；整项遮蔽清 header 的合同已被实测和 T4 变异证明。

## Decision Log

- 2026-11-11 / 独立评审者：以 `feature/source-schedule@905d87bd` 为唯一差分 base，避免把父层能力或缺陷误算给 #621。
- 2026-11-11 / 独立评审者：没有证据成立的新增行缺陷，英文 inline 列表为空；建议 `APPROVE`，不提交外部 review，由协调者统一处理。
- 2026-11-11 / 独立评审者：#364 已承接可选 review endpoint 的 HTTP 404，不重复创建追踪；#599 与 R1 继续由人类验收，不由测试或本记录覆盖。

2026-11-11：四个 PR 独立审查全部完成，无可行动 P0–P3。四项按 #618 → #619 → #620 → #621 顺序完整预演；组合 `1ae1a3246df07747ca39f33c89bec17c92f15f6f` typecheck、4033 个 contract/integration/E2E、110 个 browser、9 个 boundaries 和 7 份 workflow 检查均通过，0 fail/skip。独立组合 48 个不重叠产品/测试 blob 一致，共享详情保留双方断言；权限/WAL/详情 59/59。

当前发现集合为空，按本会话直接点名条件授权进入 APPROVE 与逐当前版本 rebase 门。原生 stack #622 下层 #620 合入后，本层需重新锁定真实 main、head、全部 threads/checks、issue 双向关系及当前批准；旧 head 的绿色不替代新树。Planning Status、#599 及 R1 保留独立。

## Idempotence and Recovery

没有产品修复、业务写入、迁移或 Git 历史操作。官方变异工具逐项还原并回跑基线；最终 `git status --short --branch` 只有本记录未跟踪。实现本层的回滚面仍为 Timeline mode、renderer/model 与局部接线，父层详情/schedule 可以独立保留。后续若 head/base 变化，本结论只对这里锁定的旧版本有效，应先重新取证再复评。

## Interfaces and Dependencies

来源链为 Fake Planning Provider → Core → 临时 SQLite → 实际 Host/typed remote → client/store → 生产 `apply`。本地 HTTP 是合成载体，不能称为真实 GitHub Projects 或安装 Host。没有新增包、跨层反向依赖、业务路由或权威状态副本。GitHub 仅读取，无外部 review、评论、状态或 issue mutation。

## Outcomes & Retrospective

2026-11-11：在真实前序 #620 已合入后重新接合 main，仅联合文档索引；apps/packages/tests/scripts 对象与完整顺序预演本阶段 `1ae1a324` 逐一一致。原发现集合仍为空；最终 head CI/线程/关联/批准重新回读，不沿用旧 head 状态。

本轮没有可行动发现，五层 P0–P3 矩阵完成；5 项聚焦、9 项边界、5 项变异与独立场景成立。安全、功能与视觉源码工程叶接受；issue #607 的 checkbox 仍由 owner 按当前证据核销。未重新运行本轮无关的完整 `pnpm verify` 或 pack/bundle，也未把作者记录的历史数值当作本轮结果。当前 head 托管 Verify/Browser/Fast Gate 成功已回读。没有真实平台、已安装宿主、真实辅助技术或人类审美/可用性接受证据；这些属于 #599 与 R1 的保留门，不扩大为本层已验收声明。

## Bottom Change Note

2026-11-11：把审查前矩阵补成独立 MMP 全层结论，记录实际运行、官方变异归因、跨时区与极端日期反例、八图审读、正常字段更新的非发现裁决及验收边界。未修改产品或 GitHub 状态。

2026-11-11：本轮产品无修复，所有评审证据按13章节整理且独立接受；#607 五条工程验收已逐条核销，安装/人类/R1范围仍独立。最终公开面人工五类目、机械扫描、规模与链接检查随本提交执行；实际合并结果用本记录命令回读。
