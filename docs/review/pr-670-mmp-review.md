# PR #670 MMP 交付评审

## 锁定事实

- 日期：2026-11-22。
- PR：#670；base：`main` / `f74a3b8b211f674247d330a7f9fc6afa0b397155`；评审 head：`de1fed557269612cb2167478f1eaa2bd91bdb33a`。
- 执行上下文：`.worktrees/shared-source-walker`；初始工作树干净；评审账号 `Singularity-AI-Bot`，开发账号 `SingularityKChen`。
- 当前目标：共享扫描不得隐藏受管生产源码、跳过依赖违规或改变包发现口径；验证 fail-closed 与现有规则边界。
- 人类授权：本会话点名 #670 并授权按问题等级修复、独立复评和 `rebase` 合并；P0/P1 未消除前不得合并。规划 Status 仍属人类所有。

## 预建风险矩阵

| 等级 | 代码 / 反例 | 产品与 issue 验收 | 架构 / 事实所有权 | 测试与设计成本 |
|---|---|---|---|---|
| P0 | 越界删除、破坏 main 或 fail-open 门禁 | 不可恢复损失 | 安全硬约束破坏 | 关键门禁被绕过 |
| P1 | 错误恢复、重复写、泄露或严重回归 | 声称交付但关键承诺失效 | 权威 Saved、身份、授权或层次不变量失效 | 缺失能暴露严重缺陷的故障验证 |
| P2 | 局部错误或非关键失败语义 | 可用性或范围说明缺口 | 非阻塞契约漂移 | 判别性不足或不必要的复杂度 |
| P3 | 维护与命名问题 | 文档/提交/验收表述 | 可读性、重复信息 | 低风险测试和证据整理 |

## 分层审查与验证

独立评审锁定上述 immutable head，使用 Qian Systems Router 的系统边界核对、First Principles Development 的事实/假设区分，以及 Superpowers 的判别性验证方法。基线和当前实现分别读取，不采用历史验收结论代替本次验证。

| 层 | 本次证据与结论 |
|---|---|
| 代码 | 两层发现、manifest 即停、两层忽略剪枝、排序、posix 路径、失败传播和消费者调用均核对；正常与缺来源/缺 group 由现有 fixture 及负控验证。未发现 P0–P2 实现缺陷。 |
| 产品闭环 | 本切片交付工程扫描去重；没有产品 UI、数据迁移、Provider 写入或规划状态变更。当前包根与源码集合保持相同，不宣称 MMP/R1 人验完成。 |
| 架构 | `EXPECTED`、`HOST_ENTRY` 与 import 解析规则未改；helper 无状态、无依赖、仅 Node 内建文件 API；实际调用方仍拥有发现深度/扫描 scope。无需新增抽象或缓存。 |
| 测试 | 真实工作树 30/30、boundaries 10/10；独立集合对照 18/18 与 206/206，双向差集皆空；7 项定向变异均准确归因且恢复通过。 |
| 工作项 | #396 AC1–AC4 满足；仅八个声明文件，技术 131/1000、文档 301/1500；公开 issue 标签为 kind:chore 与 area:tests，closingIssuesReferences 含 #396。 |
| 既有边界 | C4 对 Git 可见源码漏扫及被跟踪 symlink 响亮失败；包根符号链接和普通文件守卫的夹具缺口、其它消费者与机械守卫已在 F9/F14、TD-086 登记，不把既有范围扩大为本 PR 缺陷。 |

### 本次独立验证

- `node --test tests/contract/source-tree.test.js tests/contract/package-boundaries.test.js tests/contract/host-node-types.test.js tests/integration/source-scan-build-output.test.js`：30 tests / 30 pass / 0 fail / 0 skipped，exit 0。
- `pnpm run boundaries`：10 tests / 10 pass / 0 fail，exit 0；包含真实工作树 resolution preflight。
- 集合对照探针直接从 base 的 `package-boundaries.test.js` 提取旧 `exists/findPackageDirs/sourceFiles`，与当前 helper 在同一真实工作树运行：包根 18=18、源码 206=206，两个方向差集均为 `[]`。
- `node scripts/rule-checks.mjs size f74a3b8b211f674247d330a7f9fc6afa0b397155`：技术 131/1000、文档 301/1500，exit 0。
- `node scripts/rule-checks.mjs disclosure f74a3b8b211f674247d330a7f9fc6afa0b397155`：机械扫描 exit 0；本次代码/文档 diff 未见凭据、本机身份、个人信息、内部系统或保密字样。
- PR 快照：reviews/comments 为空；非 draft，mergeStateStatus=UNSTABLE。`PR Fast Gate`、Verify、Browser、Windows Native 与规则检查 success；`Create review session` failure 属可选入口，`Reconcile engineering state` 一次 cancelled 同时存在同 head 后继 success；最终远端回读与可选失败日志归主协调者核实。本次未复跑全量 verify，不把现有 CI 与聚焦测试等同产品人验。

### 定向变异表

为保持本分支实现只读，使用 exact-head 源文件与测试的临时隔离副本，经仓库 `scripts/review-mutate.mjs` 执行单批。临时副本仅将 workspace resolution preflight 留空（真实工作树已独立通过），Git 根 C4 因副本不是检出而 skip；C4 在真实工作树 30/30 中已执行。每项都指定 `killedBy`，脚本前后基线为绿并逐字节恢复；不采用手写变异运行器。

| ID | 变异 | killedBy | 结果 |
|---|---|---|---|
| R670-1 | 包发现忽略源换成硬编码 node_modules/dist | C8（同时 C3/C7） | KILLED |
| R670-2 | 删除嵌套层忽略剪枝 | C7（同时 C8） | KILLED |
| R670-3 | 删除组层忽略剪枝 | C7 | KILLED |
| R670-4 | 找到直属 manifest 后继续下钻 | C7 | KILLED |
| R670-5 | 扩展名收窄到旧 ts/tsx/mts/cts | 共享源码集合覆盖 package-boundaries 与 local-git 扫描的扩展名 | KILLED |
| R670-6 | 包根 helper 入口抛错 | 结构：不存在未登记的包 | KILLED |
| R670-7 | 源码 helper 入口抛错 | 依赖：源码中的跨包 import 必须落在允许的边上（同时兄弟包声明） | KILLED |

### 全部 actionable findings

1. **[P3] 将扫描集合不变量限定为当前树与扩展名。** 新增行锚点：`docs/exec-plan/completed/2026-11-21-shared-source-walker.md:71`。I3 将「扩展名超集」和「忽略名超集」合称「扫描面只增不减」，后者实际会裁掉更多目录。独立临时 fixture 的 `.gitignore` 为 `coverage/`，放入 `packages/p/src/coverage/legitimate.ts`：旧 `sourceFiles` 返回该路径，当前 `listSourceFiles` 返回 `[]`。当前真实树集合相等仍成立；应把 I3 改成「当前树集合不变、支持扩展名只增不减、忽略目录按共享规则裁剪」，避免将有限验收错误外推到未来布局。属于文档事实错误，不要求更改既定剪枝行为。相关 issue #396、TD-087 承接迁移；未找到单独重复 issue，TD-086 的机械守卫不覆盖此表述。
2. **[P3] 让变异恢复步骤与已采用的字节恢复方式一致。** 新增行锚点：同文件 `:228`（同类旧命令也在 `:108`）。恢复段仍强制 `git checkout -- tests/fixtures/source-tree.mjs`，而本文件 D13（:218）已经记录此命令会把尚未提交的实现一起丢掉；跟着 Batch 2 在首次实现尚未提交时执行，会失去实现而非仅去除变异。应统一指向 `scripts/review-mutate.mjs` 的内存原文/逐字节恢复，不再要求 checkout；批次级丢弃也应明确先保存原工作树再做。该问题没有单独重复 issue，属于 #396 交付文档内自相矛盾，不能用 TD-086 豁免。

3. **[P3] 明确设计决定的 actor，统一“最终确认”与待确认状态。** 新增行锚点：同文件 `:212`。D10 将 Lead 的接受称为 D4 的“最终确认”，但 D4（:206）及遗留项（:286）又将同一行为变化留给人类验收确认。主协调者核对原始来源后，只发现人类总任务授权 Lead 调研决定，没有点名该 PR 设计的人类批准。应明确这里是 AI 协调者依据总任务裁量作出的设计选择，统一剩余待确认表述，避免后续收尾把 AI 的“最终确认”引用为人类批准；也不据此额外创造审批门。没有单独重复 issue；属于 #396 的决策来源准确性。

## 结论与收尾

全矩阵结论：P0=0、P1=0、P2=0、P3=3；没有发现应阻塞本切片的实现问题。建议主协调者一次性提交三项 P3，机械修正文档后复核对应事实；合并、历史整理、外部 review 和远端回读由主协调者负责，本独立评审未执行外部写入。

#396 的工程验收与人类产品/R1 接受分开；未来修改 head/base 后需重新锁定版本，不继承本次结论。

### 修正与最终门

首审 `6009574626` 由评审账号一次提交三项 inline 并 APPROVE。开发侧修正 I3 的适用范围，Batch 2/恢复段统一到标准变异脚本并保留已有工作，D10/D20 与遗留项明确 AI 设计决定和人类授权来源；未修改实现或测试。原判别测试/七项变异仍对应同一生产树。独立复核完成后再整理历史；最终 push 后须重读 head/base/checks、issue 与所有线程，不沿用初始 SHA 的批准。

### 文档修正独立复核（2026-11-22）

复核对象为首审 head 上的文档工作树差分：只涉及本计划、评审索引与本记录，生产代码/测试未改，未重复行为测试。

- P3-1 已修正：I3 明确限定当前树包/源码集合相同，扩展名相对旧集合扩大，目录按共享规则剪枝；并说明扩大忽略名可能缩小未来扫描面，与反例一致。
- P3-2 已修正：Batch 2 与恢复段都使用标准脚本保存施加前原文字节、逐项 killedBy、还原与基线复跑；批次失败先保存当前工作再按文件恢复，已提交批次用 revert，无 checkout/reset 抹掉未提交实现的指令。历史 D13 的 cp 记录作为实际执行历史保留，不与新恢复规范冲突。
- P3-3 尚有一处残留：D10/D20 和遗留项已准确区分 AI 协调设计决定及当前人类任务授权，但 D4（计划 :206）仍直接写“需人类在验收时确认”，没有标注失效，与 D20/遗留项“不额外增加逐项审批门”相冲突。最小修正：在 D4 末尾将该句改为“此实现语义由 AI 协调者依据原总任务裁量选择（D10/D20）；原待确认表述于 2026-11-22 由 D20 澄清取代，不构成额外审批门”。无需产品变更或追加批准。

首轮文档复核结果：两项关闭，第三项仅剩 D4 一句待同步；没有新增代码缺陷。

补充复核：D4（:206）现已明确 AI 协调者依据原总任务裁量选择，原待确认表述由 D20 澄清取代、不构成额外审批门；与 D10/D20 和遗留项一致。三项 P3 全部关闭，无剩余矛盾；本轮未修改实现或测试，未重复无风险行为验证。
