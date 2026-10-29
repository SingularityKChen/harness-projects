# PR #461 MMP 交付审查

2026-10-29，独立审查锁定main基线7907efb与实现a9cfdf6，定向复评f9ebe47。最终提交整理只改变提交边界和文档；产品树由整合owner在push前后另行核对。

| 层 | P0/P1 | P2/P3与证据 |
|---|---|---|
| 代码 | 无新增状态、命令或恢复路径缺陷 | 真实入口消费共享样式；无未消费组件 |
| 产品 | 规划/工程与确认边界保持 | 无死导航；完整保留来源、新鲜度和八列内容 |
| 架构 | 无第二主题/业务权威或包反向依赖 | 原P3结构margin选择器已移除，布局归组合页owner |
| 测试 | pending、denied、redacted、跨scope反例通过 | CSS命名空间、负控和实际浏览器分别验证 |
| 工作项 | #446关联、标签和严格预算合规 | 最终远端head/base/checks/线程必须重新回读 |

独立语义探针覆盖pending禁用、遮蔽canary、不可读无表格、跨scope不读store和CSS作用域。命令在 `feature/mmp-ui-frame` 根运行；运行材料位于 `.superpowers/frame-review/`。

`node scripts/review-mutate.mjs .superpowers/frame-review/css-empty-spec.json` 在修复后整表重测：F1共享CSS清空KILLED，归因“框架覆盖 loading、列表与 unresolved；无效链接仍有原生返回动作”，前后基线绿色、源码字节一致。该证据是装配契约，不冒充浏览器布局。

整合owner实际浏览器计算负控：根padding15→0→15px，返回按钮44→24.5→44px；关闭/恢复共享CSS会使同一高度与留白判据失败/恢复。1440/1200/1024/320、两主题、长内容与键盘检查无页级横滚或遮蔽泄露。

官方固定Host的干净Web profile安装整合产物、连接真实Project并呈现当前入口与明暗主题；没有执行模型、开始工作或规划字段外部写入。具体产物观察和证据边界见所属ExecPlan。

结论：实现规格与代码质量通过，无剩余P0/P1/P2/P3。最终head的同构建报告、CI与关联回读是ready前置；未经人类决定不合并。本审查不代表#449、#457或R1完成。

## 2026-10-30 独立交付复评（调查前锁定）

- 当前 head：`56a2b6db17877458ba88b81cf793a0bba0135ca0`；base：`main@7907efbbdc5e35cc8ea4769c7067e885cec844e1`；工作区：`.worktrees/mmp-ui-frame`。开始时分支 clean。
- 评审边界：#446 视觉基础、#427 父 UI；#449 人类 UAT、#457 运行时访问控制与 R1 仍独立。本轮只追加评审记录，不改产品源文件、不发布 review。
- 方法：Superpowers、Qian Systems Router、First Principles Development；事实源是锁定 diff、当前源码、测试输出及独立浏览器观察。

| 严重度 | 代码 / 产品闭环 | 架构 / 安全 | 测试 / 工作项 | 调查门 |
| --- | --- | --- | --- | --- |
| P0 | 入口渲染失败或 main 无法构建 | 规划事实被执行覆盖、泄密、假 Saved | 必需检查误绿或硬边界失守 | 追踪实际入口、redacted、依赖边；有则阻塞 |
| P1 | 共享样式使核心导航、操作或事实不可达 | 第二主题 / 状态 authority、Host 不兼容 | 缺少关键失败反例、闭环不成立 | 浏览器操作 / 窄屏 / 主题与产品链路 |
| P2 | 局部排版、焦点、语义层次缺陷 | 私有呈现职责失配 | 可执行断言缺口、验收证据过度陈述 | 正常与异常状态及独立负控 |
| P3 | 一致性、可维护性小问题 | 过度抽象、死 token / 样式 | 文档与测试说明细节 | 设计适度性和既有 issue 去重 |

### 本轮结论与验收边界

当前锁定产品树未发现新增 P0/P1/P2/P3 代码缺陷，建议实现层批准。`WorkItemApp` 消费私有共享 CSS，Host 经 `bindWorkspaceSetupApp → WorkspaceSetupGate → WorkItemApp` 使用该入口；CSS 只改变呈现，没有增加业务状态、Provider 调用、主题选择器或 Saved 事实。规划状态 / 工程提示分列、来源 / 两种时刻和 redacted 占位均保持。原生 HTML、私有变量和局部样式足以承担当前需要，没有引入公共组件框架或新依赖的理由。

**P2：保留 #446 尚待人类确认的具体视觉参数验收**。新增行锚点：`docs/exec-plan/completed/2026-10-29-mmp-ui-frame.md:104`。#446 最末修正要求展示具体实现并“resolve only missing visual parameters with the human”。主评审回读实施会话后确认：现有原始实施授权及本轮无 P1 可合并授权未包含对具体屏幕 / 遗漏参数的最终人类确认；计划此行仅写“浏览器预览反馈”，没有可回读的人类确认原话，而当前 PR 的 `closingIssuesReferences` 含 #446。以当前 `Closes #446` 合并会自动关闭仍缺该项证据的工作项。本轮 agent 浏览器走查不能补该证据；修复方向是补已存在或新增的明确人类确认，或将 PR 改成 `Refs #446`、issue 保持 open 且首项 unchecked，并在计划中保留这道门。这是非阻塞的验收 / closing 关联缺陷，不是运行时缺陷；#449 完整安装 UAT 仍独立。

已查同类跟踪：#430 负责详情响应式 / 键盘；#447 负责设置表单；#427 为父 UI；#450/#451 为生产组合浏览器；#449 为安装件完整人类接受；#457 为运行时权限 / 降级。没有把其未完成 scope 作为本 PR 新引入缺陷，也没有据此宣称它们已通过。

### 实际验证

命令均在 `.worktrees/mmp-ui-frame` 根执行，产品 head 为上文锁定 SHA。

| 验证 | 本轮实际结果与能证明的边界 |
| --- | --- |
| `pnpm test:file tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list-browser.test.js` | 35 pass / 0 fail / 0 skip；含入口装配、未知 / 不可用权限、跨 scope store trap、字段转义、redacted canary、规划 / 工程正交；browser 名称用例仍是 bundle / VM / SSR / HTTP |
| `pnpm boundaries` | 9 pass / 0 fail / 0 skip；依赖方向、UI 与壳边界保持 |
| `pnpm typecheck` | exit 0 |
| `git diff --check 7907efbbdc5e35cc8ea4769c7067e885cec844e1...HEAD` | exit 0 |
| 当前树独立语义探针 | pending 动作禁用且为最后已知值；只遮蔽行无 canary / href；denied 无内容表；跨 scope 不读 store；27 条 CSS 选择器均在命名空间内，私有样式无公共包出口 |
| 独立真实浏览器 `review461`，本地 fixture 端口 4461 | light / dark × 1440 / 1200 / 1024 / 320 × content / long，共 16 组；另 320 × 两主题 × 200% / 400% 等效文字放大共 4 组。每组 page scrollWidth ≤ viewport、canary absent；普通字号按钮 44px；长内容只扩大局部 table scrollWidth |
| 浏览器状态 / 导航 | 320 dark 的 loading / empty / stale / offline / unresolved 无页横滚；offline 刷新禁用、未确认状态不称当前值；unresolved 的 44px 返回按钮恢复安全当前 scope 列表并聚焦标题；1024 dark 点击详情后标题获焦，Escape 关闭并回焦原链接，刷新 / 关闭均 44px |
| 焦点 / 截图 | 实测键盘 `:focus-visible` 为 Host token 的 2px outline；1440 light 与 320 dark 400% 截图已目视。运行材料在 `.superpowers/review461-20261030/`，fixture 浏览器已关闭、服务已停止 |

### 反例 / 变异与交付限制

| 变异 | 命令与精确归因 | 结果 |
| --- | --- | --- |
| F1 清空共享 CSS | `node scripts/review-mutate.mjs .superpowers/frame-review/css-empty-spec.json`；`killedBy=框架覆盖 loading`，实际失败名为“框架覆盖 loading、列表与 unresolved；无效链接仍有原生返回动作” | KILLED；runner 前后基线均绿、字节恢复检查通过；结束后 `git diff -- packages/ui tests` 为空。该反例证明样式装配断言，不能冒充布局判别力 |

本轮回读既存同构建报告，其 `source.head` / `reportToolHead` 均为锁定 SHA、dirty=false，base 为锁定 main；Host raw/gzip Δ0、client +1882 raw / +622 gzip B、pack +623 B，input 仅增加共享模块、external 集合不变。此为既有工具报告审查，本轮未重新构建或安装 Host。先前官方 Host 观察、当前 agent fixture、最终人类 UAT 是不同证据面；本轮没有运行模型、Start Work、外部规划写入或权限撤销的生产链路。PR 当前 checks / review threads / issue closing 及最终发布由主评审回读，修改 head 后相应门禁必须重锁。

### P2 本地文档修复的独立复评（2026-10-30）

检查本地 `git diff` 的所属 Completed ExecPlan、上述本 PR 审查记录，以及跨 PR 的 `2026-10-30-pr461-pr463-mmp-review.md`。原反馈已就地标为 agent 浏览器观察；Decision Log 明确 #446 尚缺具体屏幕 / 遗漏参数的人类确认，保留 issue OPEN / 首项未勾选及独立 #449 门，并把当前条件合并授权限定于 #461–#463 无 P0/P1 后的修复、复评和 rebase 合并。没有把 agent 观察、冻结 baseline、CI 或合并授权升级为人类视觉接受。无新增 P0/P1 或需要扩大产品修改的遗漏，本地证据归属修复通过。

`Refs #446` 在 Decision Log 中是本轮处置决定；本次复评尚未观察远端 PR body / closing 关联已改，故不宣称 P2 的外部关联已全部完成。主评审仍需修改远端 `Closes → Refs` 并回读 `closingIssuesReferences`、#446 OPEN 及首项 unchecked 后，才能记录该机械修复闭环。当前记录不要求重新做人类 UAT，不扩大 #446 的实际实现范围。本次仅文档复评，沿用未变化产品树证据；`git diff --check` 通过。

主评审于2026-10-30修改PR正文为`Refs #446`后双向回读：PR closingIssuesReferences=[]，#446 closedByPullRequestsReferences=[]、state=OPEN，首项仍未勾选。该外部关联处置已完成；最终提交message同样使用Refs，合并后仍须回读。
