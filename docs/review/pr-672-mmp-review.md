# PR #672 MMP 交付评审

## 锁定事实

- 日期：2026-11-22。
- PR：#672；base：`main` / `f74a3b8b211f674247d330a7f9fc6afa0b397155`；评审 head：`eb373fd389a79fa14a5794541fb6cb699026a993`。
- 执行上下文：`.worktrees/list-visibility-decisions`；初始工作树干净；评审账号 `Singularity-AI-Bot`，开发账号 `SingularityKChen`。
- 当前目标：读取授权、redaction、缓存及失败优先级与公开 I/O 行为；重构净收益和实际消费者装配。
- 人类授权：本会话点名 #672 并授权按问题等级修复、独立复评和 `rebase` 合并；P0/P1 未消除前不得合并。规划 Status 仍属人类所有。

## 预建风险矩阵

| 等级 | 代码 / 反例 | 产品与 issue 验收 | 架构 / 事实所有权 | 测试与设计成本 |
|---|---|---|---|---|
| P0 | 越界删除、破坏 main 或 fail-open 门禁 | 不可恢复损失 | 安全硬约束破坏 | 关键门禁被绕过 |
| P1 | 错误恢复、重复写、泄露或严重回归 | 声称交付但关键承诺失效 | 权威 Saved、身份、授权或层次不变量失效 | 缺失能暴露严重缺陷的故障验证 |
| P2 | 局部错误或非关键失败语义 | 可用性或范围说明缺口 | 非阻塞契约漂移 | 判别性不足或不必要的复杂度 |
| P3 | 维护与命名问题 | 文档/提交/验收表述 | 可读性、重复信息 | 低风险测试和证据整理 |

## 分层审查与验证

采用 Qian Systems Router 的系统/消费链核对、First Principles Development 的事实与授权来源区分、Superpowers 的判别性验证。先建立上述 P0–P3 矩阵，再读取锁定 diff；独立评审不修改实现或测试，不提交外部 review。

| 层 | 证据与结论 |
|---|---|
| 代码 | 对照 base/head 的校验、六段优先级、文案来源、可选字段、键顺序、行投影和 stale/partial 传播；除私有决策提取与失败表合并外未发现语义改变。Object.hasOwn 保留，非法 failure/读取标记仍响亮失败。 |
| 产品闭环 | 用户可见行为保持；列表 app、详情与 delivery overview 均继续调用同一 reducer，renderer 仅消费安全 view。Host 仍拥有读取事实，没有新增缓存、规划状态推导或 Provider 写入。 |
| 架构 | 新 ReadMarks/ListVisibility/FAILURE 与三个函数均为原文件私有；公开类型、exports、import 边和依赖不变。单表消除失败分类与缓存政策的重复，两个决策参数足够，未引入通用框架或第二状态拥有者。 |
| 测试与反例 | 复用并读取主协调者同 head 的 21/21、typecheck 与四项标准变异原始输出；独立另跑 720 组合不变量探针，132 content / 588 non-content，0 泄漏、0冻结入参修改、0重复输出差异。 |
| 工作项 | #314 五项 AC 均有证据；矩阵覆盖撤权/未知/不支持/遮蔽/离线授权缓存/刷新；测试保留全部既有断言并增加 3 例。实际四个声明文件，技术 278/1000、文档 396/1500，closingIssuesReferences 含 #314。 |
| 历史边界 | 生产 app 的 hasReceivedSnapshot/cacheVisibility 硬编码与失败优先级是 base 已有行为，本次不改；保留设计的理由可由行为保持范围支持，但必须准确标注 AI 协调者来源，不能写成人类特批。 |

### 验证与证据边界

- 主协调者本次同 head 执行并共享原始日志：`node --test tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list-browser.test.js` 为 21/21、0 fail、0 skip；`pnpm run typecheck` exit 0。独立评审已读取输出，不重复整跑。
- 主协调者经 `scripts/review-mutate.mjs` 完成四项变异，均有 killedBy 并准确 KILLED：明确阻断借缓存、读门未观测仍显示、缓存 AND 改 OR、redacted 透出字段。独立评审已读取全部四项失败归因，不把历史计划里的手动还原记录当成本次脚本结果。
- 独立临时 Node 探针直接 import 当前实现：枚举 pending/received/failed、六种读门、五种失败、快照真假、两种缓存标记及刷新真假，共 720 组合；以“仅 received+可读门，或 offline/error+可读门+双缓存条件才可 content”作独立 oracle。全部输入递归 freeze；每格重复 derive，扫描独立 redacted canary，并断言占位精确为 kind/key、可见正控存在。结果 132 content、588 non-content、0 canary 泄漏、0入参修改、0重复输出差异，exit 0。
- `node scripts/rule-checks.mjs size f74a3b8b211f674247d330a7f9fc6afa0b397155`：技术 278/1000、文档 396/1500，exit 0。
- `node scripts/rule-checks.mjs disclosure f74a3b8b211f674247d330a7f9fc6afa0b397155`：机械扫描 exit 0；本次 diff 人工检查未见凭据、本机身份、个人信息、内部系统或保密字样。
- 快照 reviews/comments 为空，PR 已非 draft、mergeStateStatus=UNSTABLE；PR Fast Gate、Verify、Browser、Windows Native 与规则检查 success；可选 Create review session failure、同 head reconcile cancelled 与后继 success 并存，日志归因和最终远端回读由主协调者负责。
- 本次不重跑全量 verify，不把差分、SSR/VM 或局部验证视为实际安装件和 R1 人验。

### 全部 actionable findings

1. **[P3] 把 AI 协调决定还原成真实来源。** 新增行锚点：`docs/exec-plan/completed/2026-11-21-list-visibility-decisions.md:357`；同根问题还在 D2 `:348`、D5 `:351`、D6 `:352`、D13 `:359`。这些记录明确声称“人类批准/已确认”，实际来源是 AI Lead 在人类总任务授权其调研决定后作出的设计选择；主协调者已核对原始 user/source.kind=user，未发现点名这些决定的直接人类批准。若保留，后续会把行为 quirk、范围或预算决定误引用为人类特批。应将 actor 写成 AI Lead，并记录总任务裁量及行为保持理由；保留现有技术决定，不据此增加审批门。
2. **[P3] 删除会抹掉未提交重构的变异恢复命令。** 新增行锚点：同文件 `:368`。步骤把 `git diff --quiet` 非零一律视为未恢复变异，随后 checkout 整个实现文件；Batch 3 重构尚未提交时，非零也可能是正常重构，照做会把完整实现退回 HEAD。与 `:157` 和 Outcomes `:384` 记录的备份/cmp 恢复方式也不一致。应统一用 `scripts/review-mutate.mjs` 保存施加前原文字节并恢复，不以 HEAD 清洁替代变异前后相等。
3. **[P3] 同步最小成功证据中的矩阵计数。** 新增行锚点：同文件 `:14`。摘要仍写新增 20 行矩阵；当前 VISIBILITY_MATRIX 实际 21 行，Progress、Batch 1、测试策略与 Surprises 12 已按 21 行记录。应将摘要改为 21，避免最终交付物里的验收计数互相矛盾。

重复跟踪核对：相关 issue 搜索只返回 #314；以上三项属于本 PR 计划准确性，未发现单独重复 issue。#366/#382 的 freshness/partial 与 #429/#430 的既有产品工作不替代这些文档修正。

## 结论与收尾

全矩阵结论：P0=0、P1=0、P2=0、P3=3；未发现应阻塞本切片的代码问题。建议一次性提交三项 P3，修正文档后独立复核；外部 review、历史整理、最终远端回读与合并由主协调者处理。

测试通过不等于产品或 R1 人类接受；head/base 变化后需重锁版本。

### 修正与最终门

首审 `6009594866` 由评审账号一次提交三项 inline 并 APPROVE。开发侧更正决定来源、统一标准变异恢复及 21 行摘要；未改实现或测试。原聚焦 21/21、typecheck、四项准确 KILLED 变异与独立 720 组合均对应同一生产树。独立文档复核后整理提交，最终 push 后重新读取 head/base/checks、issue 与线程。

### 文档修正独立复核（2026-11-22）

复核首审 head 上的文档工作树差分，只有计划、评审索引与本记录；实现和测试字节未改，不重复行为测试。

- P3-1 已关闭：D2/D5/D6/D11/D13 全部将 actor 写为 AI 协调者；D17 明确原人类总任务仅授权调研裁量、具体技术选择属于 AI 设计决定，并区分当前点名 #672 的修复/复评/提交整合/rebase 合并授权，保持规划 Status 边界、不新增逐项审批门。D11 的适用范围也已收窄为本次行为保持重构。
- P3-2 已关闭：恢复段使用标准脚本保存变异前原文字节，要求 killedBy、恢复与绿色基线；明确不得 checkout 丢掉未提交正常重构，与历史备份/cmp 执行记录可并存。
- P3-3 已关闭：最小成功证据现为 21 行，与矩阵、Batch 1、Progress 和 Surprises 一致；20→21 只保留为有日期的历史偏差记录。

三项首审 P3 全部关闭，无剩余语义矛盾；未发现新增代码问题。索引链接指向本记录。最终发布后重新锁定 head/base/checks 与线程，仍由主协调者执行。

### 接合 #670 后的新基线独立复核（2026-11-22）

- 锁定 base `57a0f51745e4530cbfd2cded0c99a2f26f804b36`、rebase 后 head `1d0c5bd1b8673cd795c74e16cb98a08be871b163`；merge-base 精确等于该 base。本轮同时核对工作树尚未整合的范围说明与 merge-queue 文档，最终 amend/发布 SHA 由主协调者重新锁定。
- 完整对新 base 的差分仅含 Global Constraints 声明的七个文件：原实现、原测试、ExecPlan、两处索引、本记录及合并队列。相对原已发布 `c33d7b5d8fd6388f4660ed6835c99fccff46bafe`，本 PR 的实现 blob 保持 `24d8f6b4e5c39eec74deecb8ee1b67c301e13ec6`、测试 blob 保持 `66b8d3fb2bfd1d3de51f81aacad7600396ae3ba9`，无额外生产或测试变化；继承的共享 walker 改动属于新 base 的 #670。
- 两个索引冲突已保留 #670/#672 双方条目，各出现一次，目标文件存在，无冲突标记；新基线完整工作树 `git diff --check` exit 0。
- 本轮队列明确 #670 已合入、#672 第二、#671/#673 因各自 P1 暂不合并；只描述工程接合顺序，不建立 Planning 关系、不写 Status，不替代 MMP/R1 人类接受。新增记录范围与计划白名单一致。
- 读取本轮原始组合验证输出并复用：UI view/browser 21/21、boundaries 10/10，均 0 fail / 0 skip；标准脚本的四项明确阻断、未观测门、缓存 AND→OR、redacted 透出变异均准确 KILLED，恢复基线为绿。没有重复同样测试。

新基线复核通过，无新增 findings；三项首审 P3 仍全部关闭。最终发布后的 SHA、远端 checks、issue 关联与线程由主协调者回读，不沿用旧 head 的批准。
