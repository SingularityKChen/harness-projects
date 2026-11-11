# PR #620 MMP 交付评审

观察日期：2026-11-11（Asia/Singapore）。阶段：当前锁定 head 的独立 MMP 审查完成；未提交 GitHub review。

## Purpose / Big Picture

独立判断 PR #620 是否构成可验收、合入和回滚的 MMP 工程闭环。先覆盖各级风险，再用代码、产品流与反例检验；测试结果不代替安装和人类接受。

## Context and Orientation

- head：`905d87bd3c212dc979ff046b855337a398e3e66b`；base：`main` @ `063e427a719bd2ba2c50391279ee5b81f5f5bd56`。
- 执行上下文：检出 `feature/source-schedule` 的 `.worktrees/source-schedule` 根目录。
- 工作项：#606；远端回读：`gh pr view 620 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,mergeable,mergeStateStatus,isDraft,closingIssuesReferences`。
- 事实与未知：实现会话已找到；独立审查需重新验证产品结果，CI 绿不能替代验收。

## Design / Spec

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 合并即破坏主流程或泄露数据 | 错误状态、越权、失败恢复断裂 | 可恢复边界错误 | 冗余与可维护性 |
| 产品闭环 | 权威事实损坏 | 来源→持久化→展示→操作链断裂 | 非核心交互与提示缺口 | 文案一致性 |
| 架构 | 七条不变量/信任边界破坏 | 事实拥有权、依赖边不正确 | 不必要耦合 | 局部简化 |
| 测试/反例 | 安全假绿 | 关键失败路径无判别证据 | 次要缺口与过度测试 | 组织与命名 |
| 工作项/设计 | 无法独立交付或回滚 | issue 验收不成立、范围遗漏 | 证据或既有追踪缺口 | 记录清晰度 |

## Global Constraints

遵守七条不变量和层级依赖；子评审只读产品，仅写本记录；主审收尾不改产品文件。外部评审使用 gh-review，开发/提交/合并使用 gh。

## Plan of Work

锁定事实 → 全级别矩阵 → 分层审查与最窄反例 → 一次完整 review → 当前版本条件收尾。命令及结果统一在 Validation and Acceptance 记录。

## Validation and Acceptance

### 审查证据

本轮以 #606 的结果为边界审读全部 27 文件差异及 completed ExecPlan。目标日期与迭代窗口仍属于同一 Planning 投影：GitHub decoder 的真实 Date/Iteration 值→显式 project field id 映射→`PlanningFieldsSnapshot`→同事务 `workspace_projection` UPSERT 与整行撤回→Core query→`toWireEntity`→client store→同一安全 list row→唯一详情。controller/client 使用既有 typed snapshot 整体载体，无逐字段白名单会丢弃新增值；不存在第二条原生字段表读路或第二事实 owner。

date-only 运算纯用公历日序数，0001–9999、Gregorian 世纪闰年、右开窗口及显示末日分别成立；duration 0 明确无末日，非安全整数与溢出窗口不进入几何。Provider 共用此校验，0001/0099 的生产日期域问题已在本 head 修复。目标日与迭代两个槽可同时出现，未由迭代成员关系、标题或工程状态制造任务起止。当前 Producer 没有真实 item range，所以不制造该类型的值。详情窗口文案明确“不是任务工期”，沿现有 metadata 字体/间距/来源标识，无第二编辑器。

SQLite 增加两个 nullable 原子列，generation 3→4，既有 admission 对不兼容旧库先拒绝再保留原文件；这是明确 schema 变更。#606 的 reviewed implementation contract 已记录原禁止“日期 migration”措辞由用户未发布无需迁移/兼容指令覆盖为“不添加升级程序”，本评审不将其误判为偷偷迁移或删库。整体 revert 不会自动降级数据库，风险已声明。

| 层 | P0/P1 结果 | P2/P3 结果 |
|---|---|---|
| 代码 | 未见新增阻塞；五字段整行写入、清空、redaction 与 revision 保持原子边界 | 未见可复现错误；完整日期域、zero、invalid/缺失均明确 |
| 产品闭环 | 真实 replay→文件重开→wire/client→详情通过；失败/撤权后重开不冒充当前日期 | 目标与所属迭代窗口来源一致，无虚构任务工期 |
| 架构 | 七条不变量、依赖方向、Host 权威与权限二次遮蔽保持 | 两列扩展现有投影；无新库、兼容层或重复 store |
| 测试/反例 | 273 定向、10 真实浏览器全部通过；独立日历 oracle 与文件生命周期反例通过 | Browser 逐具名字段与全部实际值几何保护，无固定行数假绿或放宽阈值 |
| 工作项/设计 | #606 与 completed 计划及当前实际 Producer 能力一致；技术 gross 299，文档 116 | 单提交、独立基于 main；#621 为消费者，#599/R1 仍独立 |

### 验证与锁定状态

执行上下文为本记录开头 worktree、head `905d87bd`。本轮实际执行：

- `pnpm test:file tests/contract/calendar-date.test.js tests/contract/planning-github-projects-mapping.test.js tests/integration/planning-fields.test.js tests/integration/storage-baseline-admission.test.js tests/integration/migration-runner.test.js tests/integration/ui-work-item-detail-read.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js`：退出 0，273 tests / 273 pass / 0 fail / 0 cancelled / 0 skipped。含真实 GitHub replay 的普通/0001/0099/9999 日期跨落库重开、窗口变化 revision、同值不变、旧轮拒绝与三种旧shape文件 hash 不变。
- `pnpm test:file tests/browser/detail-expand.test.js`：退出 0，10 tests / 10 pass / 0 fail / 0 cancelled / 0 skipped。包含窄屏 200% 全部真实 metadata 行的可读性、列对齐、字形溢出和几何约束。
- 独立只读 `node --input-type=module` 日历探针：3,652,059 个合法日全部 `day→date→day` 往返；117,810 个抽样点与 `Date.setUTCFullYear(1,0,1)` 起算的原生 UTC 日历 oracle 相等；8 个控制字符/空白/时间戳/零年/非法闰日值拒绝，非安全 duration 拒绝；退出 0。
- 独立临时文件 SQLite 生命周期探针：mapped 两日期槽初始落库→来源 offline 失败→新 context 重开后保留字段并明确 degraded→JSON wire 往返/client/详情仍标 stale→permission denied 失败→重开后无日期且 redacted→恢复授权并重新组装后成功清空→再重开仍无旧日期；四个结果均 true，退出 0。
- 首轮生命周期探针在最后恢复阶段退出 1：它错误地对“在拒权状态组装、绑定快照 unavailable 的原 context”期待外部开关恢复后自动重取能力。已按当前 Host 的新 context 组装语义修正探针，未改产品或断言日期保真/撤回条件；此前离线重开、JSON 详情、拒权重开均已通过。该失败不构成此次日期 diff 引入的问题。
- `git diff --check 063e427a719bd2ba2c50391279ee5b81f5f5bd56...HEAD`：退出 0，无输出。
- 锁定缓存：OPEN、Ready、MERGEABLE、`UNSTABLE`；唯一提交即当前 head，closing issue #606；完整 reviewThreads 为空（`hasNextPage=false`），原生 stack #622 含两成员。Verify、Browser、PR Fast Gate、CodeQL、规则/规模/公开面检查均成功。可选 `Create review session` 失败由协调者统一核对实际原因。
- open issue 清单有 #606 来源能力、#607 只读 Timeline、#609 日期编辑及 #599 安装/R1 接受边界；本轮未见应重复登记的新增缺陷。#606 checklist 尚未勾选，交协调者以最终回读证据核销，不以绿色测试替代人类产品接受。

## Progress

- [x] 2026-11-11：锁定 immutable head/base、全矩阵独立审查和本记录所列验证完成。
- [x] 2026-11-11：主审追加真实组合证据、公开面/版本回读及直接条件授权；后续合并以远端实际 ack/readback 为准。

## Surprises & Discoveries

可选评审回调真实日志为 HTTP 404，已有 #364。已确认的测试/产品边界与未验证项见验证及结果；未把缓存或历史绿色当作新 head 通过。

## Decision Log

2026-11-11：主审重新核实两个账号、全部线程分页与每个可选评审失败的真实 run 日志：本地回调 HTTP 404，已有 #364，非 required gate。当前发现集合为空，按本会话直接点名的条件授权进入 APPROVE、文档收尾及当前版本 rebase 门；正常工程验收不推进 Planning Status。

本轮四项按 #618 → #619 → #620 → #621 顺序完整预演，只有文档索引并列插入冲突。组合 `1ae1a3246df07747ca39f33c89bec17c92f15f6f` 的 typecheck 和 4033 个 contract/integration/E2E 用例通过，独立组合权限/WAL/详情 59/59；48 个不重叠产品/测试 blob 与原各 head 相同，共享详情测试保留双方安全及日期断言。逐最终 head 的发布门不从此历史观察推导，须再次回读。

组合浏览器进一步实际通过 110/110，boundaries 9/9，workflow 7 文件无 finding；本轮无产品修复。

## Idempotence and Recovery

只读测试与临时根可重跑；原始发布 head 保存于本轮 refs/backup。最终 push 使用精确 lease，合入前可恢复备份，合入后按能力提交 revert；不删除用户数据。

## Interfaces and Dependencies

依赖本仓库 Node/pnpm、现有 Provider/Storage/Host 合同及 GitHub 两套身份。各命令的检出与执行上下文由 Context and Orientation 锁定。

## Outcomes & Retrospective

2026-11-11：在真实前序 #619 已合入后重新接合 main，仅联合文档索引；apps/packages/tests/scripts 对象与完整顺序预演本阶段 `f7c72929` 逐一一致。原发现集合仍为空；最终 head CI/线程/关联/批准重新回读，不沿用旧 head 状态。

未发现本 head 新引入、可复现的 P0–P3 可行动项；无英文 inline 建议。建议完成最终远端回读、可选失败查因与 #606 工程验收记录后进入 APPROVE 条件。未重新跑全套 `pnpm verify`、全部 Browser 或变异表；缓存的全量/托管结果和本轮独立证据分别记录。未验证真实 GitHub 在线修改、真实用户数据库、安装后美观/可用性或 R1；未改产品、commit、push、GitHub review 或 Planning 字段。

## Bottom Change Note

2026-11-11：记录独立 MMP 风险矩阵与证据；主审按仓库要求整理为 PLANS.md 的 13 章节，保留原观察、反例与不确定性。
