# PR #627 MMP 修复独立复评

## Purpose / Big Picture

验证 #626 的可操作恢复引导和显式迁移所需只读历史合同。工程通过不代替实装、人类美观或R1接受。

## Context and Orientation

在 `fix/actionable-setup-recovery` 的 `.worktrees/actionable-setup-recovery` 执行，起始base `29947425ba0174fe83c73f2ee8df3e29ea12429d`。工作树产品文件清单摘要为 `81876e97eb3a6b87d236bf95188582c8d6057e0c8e854eed62a094d457e67a74`，提交整理后逐文件复核，不以旧head绿色替代当前发布门。个人数据库和原始截图不进入公开记录。

## Design / Spec

先建立风险矩阵再完整分层审查；产品UX与历史收据分别由独立评审复核，真实数据迁移另做私有保全审计。

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 原库损坏/越权副作用 | 回放旧请求、末次await后泄漏 | 失败恢复/误导文案 | 重复与命名 |
| 产品 | 权威状态虚报 | 未知变成功、历史变当前 | 无可操作步骤、假草稿 | 术语一致性 |
| 架构 | 第二事实源/反向依赖 | 历史进入write machine | 无必要RPC/兼容框架 | 局部简化 |
| 测试 | 安全假绿 | 缺直接API/撤权反例 | 仅字面断言或Web冒充Desktop | 组织清晰度 |
| 工作项 | 不可独立回滚 | 迁移无完整保全门 | 文档可执行性/链接 | 记录格式 |

## Global Constraints

用户授权为Issue、修复与当前库显式迁移；没有新PR合并、Planning Status、外部PR修改或新模型执行授权。历史格式仅显式标记且已确认时可读；当前创建意图仍严格，默认启动仍拒绝不兼容库。

## Plan of Work

UX原树观察6项RED再GREEN；历史收据原树4项RED后GREEN，再加入7个末次读取撤权反例；独立评审从直接API/事务完成竞态和私有全表保全反证，全部完成后才允许进入候选安装和切换门。最终重新回读head/base/checks、全部threads与双向issue关联。

## Validation and Acceptance

- 完整 `pnpm verify`：typecheck、1568/2251/226，共4045通过，0fail/skip。
- UX setup33项及独立source/scope反例通过；连接诊断与setup联合58项通过，原因/脱敏/计数判据保留。
- generation拒绝157项通过，原库不变、错误合同字段保留；文案给明确选择和固定恢复入口。
- 历史/UI42项及独立竞态9项通过；私有候选严格准入、全部reader、11组真实Core/client/API只读检查通过，Provider/network/total_changes均零。
- Desktop备份模板由Markdown原样提取：schema/内容/rowid正控及打开者、悬空sidecar、可写根、lsof诊断错误负控通过；真实备份独立摘要/完整性/FK通过。实际全表数据和指纹只留私有日志。
- Browser首轮109/110因旧exact文案定位失败；更新为实际新语义且保留全部交互计数，窄文件2/2通过，最终整层结果按Progress回读。

## Progress

- [x] 2026-11-12：完整全级别独立复评，原发现及根因修复如下面两节。
- [x] 2026-11-12：UX/历史合同/原库保全候选/备份实证通过，无剩余可行动P0–P3。
- [x] 2026-11-12：最终Browser110/110、安装件54/54；当前候选12安装文件逐字匹配。个人库原路径迁移完成，实际Harness打开非空原列表并显示宿主连接、来源当前读取确认，原设置可读；旧文件/独立备份保留。
- [x] 2026-11-12：工程验收完成，最终head/托管checks/全部线程/issue关联/Ready以远端回读取得；没有新PR合并或人类R1接受。

## Surprises & Discoveries

独立发现历史分支最后lineage读取后Planning撤权仍返回title/head/base（P1），用真实runtimeAccess deny/regrant和事务完成fence反例证实。修复在历史证明后重查scope/readRoute，并在事务返回后的无await窗口同步比较Planning/delivery epoch与committedFence；原红例及独立9项均GREEN，数据候选此前一直隔离。

Desktop恢复入口最初错误链接仅Web sandbox变量的备份流程（P2），后改为明确Desktop根的可执行模板；继续发现悬空sidecar/可写根/lsof错误未失败闭合，同一门补齐并用独立负控验证。最终说明不把备份/新空库/只读历史标记当成自动迁移。

## Decision Log

- Decision：采用显式original已确认历史receipt，保留原指纹/正文marker/key/ref；不为旧请求补造Issue选择或重签指纹。Rationale：该历史合法，但旧合同没有新语义，必须独立只读且不可恢复/补写。Date/Author：2026-11-12 / 主审、独立设计/审计者。
- Decision：同key create、历史resume/负责人操作必须零写；用户显式发起的新key现代请求仍走当前完整准入，不新增全scope禁止新请求限制。Rationale：区分原操作重放和新意图，不把迁移扩成产品限制。Date/Author：2026-11-12 / 主审、独立评审者。

## Idempotence and Recovery

原库和sidecar保留，独立Backup API快照与匹配generation3旧包都已固定私有恢复锚点。复制/切换目标必须不存在，保留旧文件与新候选；Git整理先backup再精确lease。产品回滚和数据库回滚须使用匹配组合，不将旧包直接开新标记库。

## Interfaces and Dependencies

无新RPC、npm依赖或SQL结构变更；仅既有PR操作读DTO新增闭合history分支。原库迁移按当前schema候选和已验证精确原JSON增加一处格式标识，不进入Host自动启动路径。

## Outcomes & Retrospective

最终接合main518（generation5）后，历史/UX源代码及反例逐字保留，独立259项/9竞态通过；新完整verify4037、artifact54、最终串行Browser110通过。首次Browser109/110的一次Host acquisition错误未稳定复现、也未证实具体原因，原失败保留，未放宽预算。4→5迁移仅改变派生view与代际，24表所有值/类型/rowid/JSON完全相等；实际25组生产reader通过、原件/独立备份保留，真实Host原列表和规划连接可读。来源确认/不完整随实际刷新显示，不能据此替代#599人类接受。

独立UX与历史合同审查、数据保全候选和备份门通过；当前个人Planning unavailable及unknown事实保留，不从正向stub推断真实授权已恢复。实际产品开库与原工作区/设置读回已观察通过，来源从原不可用状态经正常只读刷新得到确认；这不同于前述隔离stub。远端发布状态按最终回读取得，#599/R1保留独立。

## Bottom Change Note

2026-11-12：汇总全矩阵、P1/P2根因和独立复评，固定源文件清单摘要；未预写尚未执行的切库、安装或合并。

2026-11-12：追加实装/迁移实际结果并保留固定候选身份；最终文档提交不改变已审/已装产品树。

2026-11-12：记录最新main518接合、最终5迁移与真实产品结果，候选923718af产品对象在文档整合后保持。


## 2026-11-13 独立 MMP 评审

### 锁定事实与先验风险矩阵

本轮在 `fix/actionable-setup-recovery` 的 `.worktrees/actionable-setup-recovery` 评审，起始 immutable head `f6e16c894be4a1ced47c0d90bb43a92e769167b3`、base `main@518cc6f7a9ff418b81f1020a60e5525b6f10d199`。开始时无 review 或 inline thread；PR Fast Gate 成功。已有记录是历史证据，本轮独立核验当前差异与产品链路。以下是逐文件审查前建立的风险矩阵，风险假设不等于发现。

| 层 | P0 风险 | P1 风险 | P2 风险 | P3 风险 |
|---|---|---|---|---|
| 代码与反例 | 损坏既有库或泄漏凭据 | 历史重放/撤权后泄漏/事务竞态 | 恢复动作或错误反馈不准确 | 重复与命名 |
| 产品闭环 | 虚报权威 Saved | 历史被当成当前可写请求/丢失数据 | 指引不可达/输入丢失/旧快照误导 | 术语与可读性 |
| 架构边界 | 第二权威源/依赖倒置 | 绕过 Host 权限与当前创建合同 | 不必要的新协议或兼容支路 | 局部复杂度 |
| 测试 | 安全与保全假绿 | 缺直接 API、撤权和失败路径反证 | 实装声称超出证据 | 冗余与组织 |
| Issue与交付 | 无法独立回滚 | 验收缺项或迁移回滚不匹配 | 重复追踪/文档不可执行 | 标签与索引 |

分工：历史合同与权限竞态、设置/恢复产品闭环、文档与 issue 验收分别独立只读审查；主审负责证据整合、反例裁决和一次性 GitHub review。用户在本会话直接授权本 PR 按既定条件修复、复评和 rebase merge；无 P0/P1 时由本会话收尾，有阻塞且原实现会话存在时交原 owner。

### 当前树结论与证据

三位 `gpt-6.1-sol-hc / high` 子评审按上述互斥范围完整审查；本轮没有新增可行动 P0/P1/P2/P3，结论为 APPROVE。原实现会话最近两轮已完成，当前未运行，本轮按用户直接授权负责最终回读和条件合并。下列命令在起始 head 的产品树上实际通过；收尾只改评审/计划文档，最终提交须逐一确认 `apps/`、`packages/`、`tests/` tree object 与该 head 相同。

- `pnpm typecheck` 通过；主审 `pnpm test:file tests/integration/create-change-request.test.js tests/integration/change-request-operation.test.js tests/integration/create-change-request-link-recovery.test.js tests/integration/create-change-request-assignees.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/storage-baseline-admission.test.js tests/integration/harness-plugin-host-lifetime.test.js tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-demo-artifact.test.js tests/contract/package-boundaries.test.js`：400/400。
- 恢复评审 `node --test tests/contract/ui-workspace-setup.test.js tests/contract/ui-create-change-request.test.js tests/integration/harness-plugin-connect-diagnostics.test.js tests/integration/storage-baseline-admission.test.js`：249/249；`node --test tests/browser/workspace-settings-presentation.test.js`：2/2；独立 source/scope 草稿隔离、纯读恢复、晚到历史及断连遮蔽反例4/4。
- 历史评审：相关既有78项通过；事务返回窗口的 Planning/Development deny、deny/regrant、projection、binding、context、receipt 变化及现代新意图保留原历史的独立9项通过。历史查询及同 key create/resume/负责人入口零 Provider 调用、零收据改写；现代新 key 请求保持当前严格合同。
- 交付评审：从 Markdown 原样提取 Desktop 备份模板；rowid/BLOB 与遗留 WAL 正控、打开者/悬空或目录 sidecar/hardlink/可写根/symlink 根/lsof 诊断错误共9组隔离反证。只读 SQLite 在 WAL 正控可更新 SHM 读标记；原主库、WAL 与备份逻辑保全，不承诺 SHM 字节不变。
- `node scripts/workflow-check.mjs` 无发现；disclosure、size、diff-check 与链接检查须在最终文档提交后重跑。人工五类发布面已检查，无新私有数据。运行日志与反例仅留忽略目录，不纳入产品。

最终产品树使用 `node scripts/review-mutate.mjs <spec.json>` 整表运行一次；三项均 KILLED、`killedBy` 归因吻合，前后基线通过且源码逐字恢复：

| 变异 | 判别用例 | 结果 |
|---|---|---|
| 去除 history 返回前 epoch / committed fence | `history response commit window: planning-deny-regrant`；既有 `original history fences planning-regranted at its final lineage read` 同时变红 | KILLED |
| original 错走现代操作分支 | `explicit original saved PR receipt survives reopen and every mutation entry remains inert` | KILLED |
| 首次读取失败无条件声称保留输入 | `initial read recovery has no fictional draft and only rereads settings with static Host help` | KILLED |

#626 六项工程验收与差异匹配，ExecPlan 已在 completed 且文档索引存在。#223/#595/#596 继续负责基线整理，#599 负责人类实装接受，#364 继续跟踪可选评审端点失败；没有新增重复 issue。现有同 head 的取消 Rule/Issue 运行均有成功后继；可选 `Create review session` 的 HTTP404 不冒充必需门通过。

本轮验证的是恢复引导、历史只读及安全边界；没有重做个人库迁移或 Desktop 安装，没有重新判定真实 Provider 授权、#599 人类接受或 R1。旧记录中的迁移/实装结果保持为 2026-11-12 的历史事实。最终发布门使用 `gh pr view 627 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,commits,statusCheckRollup,closingIssuesReferences,reviews`、完整 threads 回读及 `gh pr checks 627 -R SingularityKChen/harness-projects --required`；只在当前 head 无 P0/P1、必需检查通过且 issue 关联正确时由开发账号执行 `merge_method=rebase`，随后核对合并 commit 与 #626 closure。
