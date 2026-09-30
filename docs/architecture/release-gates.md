# 发布门禁 R1

> 本文件是发布门禁 R1 的仓库内权威表述：逐条列出条件、判定证据与判定者。
> 它回答"这个版本能不能发"，不回答"每次改动要跑哪些检查"——后者是 `AGENTS.md` §9 的执行门禁（`PR Fast Gate` / `Merge Gate`）。两者生命周期不同：R1 修订只改本文件，执行门禁修订只改 `AGENTS.md` §9 与 CI。
> 依据 `AGENTS.md` §3（文档与事实源）：本文件自包含，不引用任何不随仓库分发的外部输入。

## 1. 门禁的形态

R1 是一个**合取**：§2 的每一条都必须满足，任一条不满足即不得发布。没有加权、没有"总体良好"，也没有"先发再补"。

| 状态 | 含义 |
|---|---|
| 满足 | 判定证据存在，且判定者已确认 |
| 不满足 | 证据缺失，或存在反例 |
| 无法判定 | 等同于**不满足**；"还不知道"不是通过 |

判定分两类，不能互相替代：

- **机械判定**：能在 CI 或无凭据环境复跑的命令（`node --test …`、`pnpm verify`、`gh pr checks`）；
- **人工判定**：需要人类伙伴裁决的判断项（UAT、缺陷分级、回滚演练）。

R1 本身不得由 LLM 判定（`AGENTS.md` §1.1 第 5 条）；agent 只能提供证据与草稿，不能给出"通过"。

## 2. R1 逐条

| # | 条件 | 判定证据 | 谁判定 |
|---|---|---|---|
| 1 | Gate E1（跨 Provider 对象身份与同步幂等性）通过 | 裁决记录，以及 `tests/contract/` 中身份与幂等用例 | 人类伙伴（`AGENTS.md` §1.2） |
| 2 | 从空库出发的迁移可通过且可重复 | `node --test tests/integration` 中**至少有一条迁移用例且全绿**（空层的 exit 0 不是证据，判定方式同 §2.2）；二次执行不改动任何东西，失败的迁移不留版本记录 | CI |
| 3 | §2.1 枚举的 10 条不变量每条都有自动化测试 | 按 §2.1 逐条核对：每条都有自动化用例，且在无凭据、无网络下通过 | CI + 人类评审 |
| 4 | `PR Fast Gate` 稳定 | 目标 head 上最近连续两次运行均为绿；回读命令与"稳定"的定义见 §2.2，不采信本地推断 | CI + 人类回读 |
| 5 | `Merge Gate` 稳定 | 目标 head 上 `tests/integration` 与 `tests/e2e` **各自至少有一条用例且全绿**（空层的 exit 0 不是证据）；且连续两次运行均为绿；回读命令见 §2.2 | CI + 人类回读 |
| 6 | 没有未关闭的 P0 / P1 正确性缺陷 | 开放 issue 中 P0 / P1 计数为零；`docs/review/mvp-review.md` 的风险矩阵无未决项 | 人类伙伴 |
| 7 | 不存在"本地缓存静默覆盖外部权威"的已知路径 | 事实所有权用例（`tests/README.md` §2 第 2 类）与写路径 unknown / conflict 用例；代码中本地缓存不回写外部字段 | 人类评审（对抗验证提供证据） |
| 8 | 不存在 LLM 参与控制状态的已知路径 | `AGENTS.md` §1.1 第 5 条对应的契约测试与代码审查：状态与关系写入路径不经过 LLM | 人类评审 |
| 9 | provider 离线场景已验证 | 故障注入用例（provider 离线、权限被撤销）与 `tests/README.md` §3「写法要求」的"故障场景必须显式覆盖"清单 | CI + 人工走查 |
| 10 | Start Work 失败恢复已验证 | 补偿序列用例：工作树创建失败不启动执行、执行启动失败降级为人工、重复开始不产生第二份、重启后可恢复 | CI + 人工走查 |
| 11 | 人工 UAT 完成 | 在一个 sandbox 项目上逐步走通 `docs/product/vertical-path.md` §2 的步骤表并留下记录 | 人类伙伴（agent 不得自证 UAT） |
| 12 | 回滚与备份流程已写成文档 | `docs/` 下的回滚与数据库备份流程，以及一次演练记录 | 人类伙伴 |

第 6、11、12 条没有可机械复跑的命令：它们的证据是人的判断与记录。把这三条写成"测试通过"会是假绿。

### 2.1 第 3 条的十项不变量与判定方式

第 3 条要求"每条不变量都有自动化测试"。下面把这 10 条逐条列出并给出判定方式，使这条要求本身可以被逐条核对，而不是一个无法落地的整句。

这 10 条**不是** `AGENTS.md` §1.1 的直接复制：§1.1 只有 7 条架构不变量，其中"单一规划事实源""规划与工程正交""关键关联显式优先""工程产物关系沿谱系传播"直接对应下表若干行；其余各行来自 `AGENTS.md` 的实现级硬约束、`AGENTS.md` §9 的门禁表述与 `tests/README.md` §2 的测试优先级清单。每一行的"在本仓库的依据"列写出确切来源，因此不存在"依据只在外部文档里"的条目。

每条的判定方式统一为两步，两步都能在本仓库内完成，不依赖任何外部文档：

1. 在 `tests/` 下找到一条自动化用例，它**断言**该不变量（用例名应点名该不变量，见 `tests/README.md` §3「写法要求」）；
2. 该用例在无凭据、无网络环境下通过（在 `node --test tests/contract`、`node --test tests/e2e`、`node --test tests/mvp0` 对应层的输出中可见）。

表中的"定位关键词"只是把搜索范围缩小的提示：`git grep -n "<关键词>" -- 'tests/**/*.test.js'` 命中**不等于**该不变量已被断言——必须打开用例确认它断言的是该行为（例如 `tests/contract/board-workflow.test.js` 的"同一输入重复调用结果相同"与下表第 7 条无关）。

| # | 不变量 | 在本仓库的依据 | 判定方式（断言内容 + 定位关键词） |
|---|---|---|---|
| 1 | 一个工作空间同一时刻只有一个 Planning 事实源 | `AGENTS.md` §1.1 第 1 条 | 断言"对同一 workspace 注册第二个 planning 权威源必须被拒绝"；关键词"单一规划事实源" |
| 2 | 成员关系与内容身份分离 | `tests/README.md` §2 第 1 类（身份不变量）；`AGENTS.md` §1.1 第 5 条（关键关联显式优先） | 断言"同一底层对象改变成员关系后内容身份不变"；关键词"成员关系与内容身份分离" |
| 3 | PR-backed 条目不得生成第二个工作项 | `tests/README.md` §2 第 1 类；`AGENTS.md` §1.1 第 6 条（谱系不反复重新识别） | 断言"同一底层对象同时以 PR 与其回指条目出现时解析为同一工作项"；关键词"第二个工作项" |
| 4 | Draft→Issue 内部身份不变 | `tests/README.md` §2 第 1 类；`AGENTS.md` §1.1 第 6 条 | 断言"提升后内部 WorkItem id 不变"；把提升函数改成"新建实体"后该用例必须失败（注入缺陷实验）；关键词"身份不变" |
| 5 | 规划与工程正交 | `AGENTS.md` §1.1 第 3 条 | 断言"`source_managed` / `harness_managed` / `manual` 三种策略下，CI 失败、执行完成、PR 合并都不改写规划状态"；关键词"规划与工程正交" |
| 6 | 外部写入未确认不得显示已保存 | `AGENTS.md` §1.1 末段的第一条实现级硬约束 | 断言"`confirmed` 之前调用方只可见 `saving`；unknown / conflict 时保留最后已知权威值与本次尝试值"；关键词"已保存" |
| 7 | 重复事件处理 N 次等同一次 | `tests/README.md` §2 第 4 类（同步幂等与恢复） | 断言"同一观察投递 N 次后，实体与修订号同投递一次"；关键词"重复观察" |
| 8 | 乱序观察不得覆盖新观察 | `tests/README.md` §2 第 4 类 | 断言"先投递新观察再投递旧观察，旧观察被拒绝且状态不变"；关键词"乱序观察" |
| 9 | 能力缺失时 Core 必须拒绝命令 | `AGENTS.md` §1.1 第 5 条；`tests/README.md` §2 第 6 类（Provider 能力契约） | 断言"provider 返回 `not_supported` 时命令结果为拒绝，且不产生任何本地写入"；关键词"缺能力" |
| 10 | Start Work 重启后可恢复 | `tests/README.md` §2 第 5 类（跨域编排）；`AGENTS.md` §9 对持久化与恢复的扩大验证要求 | 断言"用同一份 Storage 内容新建 core 后，仍能按工作项与仓库查到执行上下文"；关键词"重启后" |

**当前结论（2026-09-26 随 SQLite v1 栈的栈顶 #175 更新；以 `ls tests/<层>/*.test.js` 回读为准）**：`tests/mvp0/` 有 1 个 `.test.js`；`tests/e2e/` 有 8 个、`tests/integration/` 有 8 个；`tests/contract/` 有 28 个用例文件。当前这些用例仍主要覆盖仓库流程、包边界与纵向链路，不能据此声称上表 10 项已经逐条完成断言核对。

> **Superseded by §2.1.1（2026-09-29，#217）**：上一段的文件计数已经过期。按 `ls tests/<层>/*.test.js` 回读（`main@699d715`），`tests/mvp0/` 有 1 个 `.test.js`、`tests/e2e/` 有 8 个、`tests/integration/` 有 13 个、`tests/contract/` 有 29 个用例文件（上一段写的是 integration 8 个、contract 28 个）。"仍主要覆盖仓库流程、包边界与纵向链路"这句判断也不再是现状：逐条核对的结果见 §2.1.1。

上述文件计数只说明测试分层已经存在，不等于上表 10 项已逐条完成断言核对。因此第 3 条目前仍是**无法判定**，按 §1 等同于**不满足**。

> **Superseded by §2.1.1（2026-09-29，#217）**：第 3 条已不只是"无法判定"。逐条打开用例核对后，10 条里 5 条（第 1、4、6、7、8 条）有可复跑的反例，5 条（第 2、3、5、9、10 条）只有部分断言（第 5 条只在纯函数层、第 10 条只在内存 Storage 上），没有一条是"已断言"或"未验证"。按 §1，存在反例即为**不满足**；这只是证据，不是 R1 裁决，第 3 条仍由 §2 表的判定者裁决。

对每一条仍需重跑上面的两步：找到实际断言该不变量的用例，并确认它在无凭据、无网络下通过；任何一条找不到用例，或用例不通过，第 3 条即为不满足。只有 10 条全部被找到且全部通过，第 3 条才满足。

> **观察更新（2026-09-30，#203 / PR #240）**：原“部分 5、反例 5”快照由 §2.1.1 的修复后第 8 行取代；当前为部分 6、反例 4，R1 第 3 条仍有证据缺口与反例，不能判满足。

#### 2.1.1 逐条核对快照（观察快照）

> 观察基线：2026-09-29 起草于 `main@f6a33d2`；2026-09-30 变基到 `main@699d715` 后重新核对，现基线是 `main@699d715`，Node v26.10.0。两个提交之间的变动只涉及 Start Work 恢复与分支探测，本节引用的用例在新基线上逐条回读，复现命令 P1、P2、P4、P5 与 #203 端口探针在新基线的 `git archive` 导出目录里重跑，观察值不变；第 9、10 行的缺口按新增的真实 Git 用例改写。本节是证据，不是裁决：它逐条列出 §2.1 的十项不变量各由哪条自动化用例在哪一层断言、哪条有反例，判定者仍按 §2 表裁决。反例编号 P1、P2、P4、P5 指 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`「复现命令（P1–P5）」一节里的探针，期望值是同一基线上的观察；#203 的复跑写在表后。

核对规则：

- 回读若用管道过滤输出，检测块须在子 shell 中启用 `set -e -o pipefail`，保留 Node 的非零退出并停止后续命令；可复制的正反对照见 `docs/product/vertical-path.md` §2.1。不能只检查过滤器的退出状态。
- **用例引用**写成"文件 + 用例标题前缀"，不写行号。回读命令是把测试文件**当脚本直接运行**，不加 `--test`：`node --test-reporter=spec --test-name-pattern="<前缀>" <文件>`。判据：退出码 0；输出里有一行以 `✔` 开头（嵌套用例前面有缩进）、标题包含该前缀的用例（不是文件路径）；没有 `✖` 行；摘要行 `ℹ tests` ≥ 1 且 `ℹ fail 0`。每个前缀都配负对照：同一命令配伪造前缀（例如 `不存在的前缀`）必须读回 `ℹ tests 0` 且没有 `✔` 行，计数为 0 即引用失效。不加 `--test` 是刻意的：`node --test <文件>` 默认按文件起子进程，文件本身被计成一条通过的测试，前缀一条用例都没匹配上时仍输出 `ℹ tests 1` / `ℹ fail 0`（Node v26.10.0 实测，退出码 0），这样的回读对改名、拼错的前缀恒为绿；直接运行没有这层包装。命令只用 `--test-name-pattern` 与 `--test-reporter`，不依赖 `--test-isolation`（`package.json` 声明 Node ≥ 22，而据 Node 官方 CLI 文档该选项到 v23.6 才出现，v22 系列只有 v22.8 起的 `--experimental-test-isolation`）；本机只有 Node v26.10.0，回读只在它上面实跑，Node 22 上的行为依据官方文档，未实跑。命令示例与摘要行缺失时的兜底判据见 [product/vertical-path.md](../product/vertical-path.md) §2.1 的"用例回读"。`storage-contract` 的用例标题带适配器标签，内存替身与 SQLite 各注册一条，所以它的前缀回读为 2。
- **层**取 `纯函数`、`端口（内存 + SQLite 两适配器）`、`SQLite`、`core 入口`、`controller 入口`。经 `composeCore` 装配后调用 `commands` / `queries` 才算入口；直接调用 core 内部导出函数（`promoteEntityIdentity`、`withDeliveryLineage`）或 provider 方法只是旁证，写进单元格时加"（旁证）"，不能单独支撑"已断言"。
- **结论词表**：`已断言（<层>）`、`部分（<缺什么>）`、`反例（<#n 或 Pn>）`、`未验证`。一行有多种情况时按"反例 > 未验证 > 部分 > 已断言"取最弱者；反例必须有可复现的违例，并给出同仓 issue 或探针编号。结论只能往更保守的方向修正。
- **变异证据**：M1、M3、M9、M10 各在 `git archive` 导出的临时目录里改一处源码（不在 checkout 或工作树里就地改，因为工作树的包解析可能落到上级 checkout）：先打出非空 diff，跑指定用例变红，再还原、用 `cmp` 核对一致并复跑变绿。"已断言"的行须有变异证据，其余行的变异证据只是补充。

| # | 断言用例（文件 + 标题前缀） | 断言所在层 | 变异证据 | 缺口或反例 | 当前结论 |
|---|---|---|---|---|---|
| 1 | `tests/contract/storage-contract.test.js`「绑定锚点跨工作区共享」；`tests/integration/identity-membership-schema.test.js`「#27 验收 1」 | 端口（内存 + SQLite 两适配器）；SQLite | 不要求 | 换 Planning 源后旧源投影残留：停用旧挂载、装配新源，`listPlanningItems` 由 5 变 10（P5，#202）。"第二个 Planning 权威源被拒绝"只在 Storage 层断言，core 组合层没有对应用例。 | 反例（#202） |
| 2 | `tests/contract/storage-contract.test.js`「同一条连接被两个工作区挂载时」 | 端口（内存 + SQLite 两适配器） | 不要求 | 该用例断言同一对象跨两个工作区共用一条身份、成员关系各自成条；没有"改变成员关系后内容身份不变"的用例，最接近的 `tests/contract/storage-contract.test.js`「成员关系被取代时旧条目名下的字段值一并删除」与 `tests/integration/storage-sync-surface.test.js`「成员关系后者胜」都不读身份。`git grep -ci membership -- packages/core/src` 无命中：core 不读写成员关系。 | 部分（无改变成员关系后内容身份不变的用例；core 无成员关系路径） |
| 3 | `tests/e2e/chain-bootstrap.test.js`「引导：一个条目一个成员」 | core 入口 | 不要求 | 只断言规划条目 `pr-7` 成为变更请求实体、不建工作项。同一 PR 经 Development / Delivery 观察时，交付链上的变更请求实体按 `chainEntityId` 哈希得到、不查外部身份表（`packages/core/src/relations.ts`、`chain-facts.ts`），"同一底层对象以 PR 与其回指条目出现时解析为同一工作项"没有用例。 | 部分（跨域解析） |
| 4 | `tests/contract/domain-identity.test.js`「身份：Draft→Issue 提升保持内部实体 id 不变」；`tests/e2e/chain-bootstrap.test.js`「身份：Draft→Issue 提升只换外部 id」 | 纯函数；core 辅助函数（`promoteEntityIdentity` 直接调用，旁证） | M1：`promoteEntityIdentity` 成功分支返回另一个 `entityId`，chain-bootstrap 用例 1/1 变红，domain-identity 用例不受影响（它测纯函数），`tests/mvp0` 仍 7/7（见 `docs/exec-plan/tech-debt-tracker.md` 的 TD-001）；还原后复绿 | 生产同步路径上换实体：替身侧 `promoteDraft` 后再 `bootstrapWorkspace`，实体数 6 变 7，新 issue 与原 draft 不是同一实体（P1）。`promoteEntityIdentity` 在 `packages/core/src` 里没有生产调用者，唯一调用在上面那条 e2e 用例里。 | 反例（P1） |
| 5 | `tests/e2e/status-policy.test.js`「工程事实（CI 失败 / 执行完成 / PR 合并）」「交付谱系里的 CI 失败只进 derived 块」 | 纯函数（三种事实 × 三种策略）；CI 一项经 `getDeliveryLineage` 取谱系后直接调用 `withDeliveryLineage`（旁证） | M3：`decideFromEngineeringFact` 返回 `incoming` 且 `wrote: true`，前一条用例与 `tests/mvp0/chain.test.js`「节点 7」各 1/1 变红，后一条用例不调用该函数，仍绿；还原后复绿 | `decideFromEngineeringFact` 与 `withDeliveryLineage` 在 `packages` 里没有生产调用者：规划状态"不被改写"是因为没有写者，不是被拒绝；执行完成与 PR 合并只在纯函数层。断言只落在纯函数层，没有触达生产路径。 | 部分（只在纯函数层断言；core 入口没有生产调用者，执行完成与 PR 合并没有生产摄入） |
| 6 | `tests/e2e/write-machine.test.js`「写状态机：确认前只报告 saving」；`tests/e2e/controller-roundtrip.test.js`「命令：同键重放返回原结果」 | 纯函数（写状态机）；controller 入口 | 不要求 | 同一幂等键换工作项，第二次 `startWork` 报 `saved`，且没有为第二个工作项建执行上下文（P4，#194）：这是 `AGENTS.md` §1.1 实现级硬约束的失效形态。 | 反例（#194） |
| 7 | `tests/integration/storage-sync-surface.test.js`「观察账本：同一观察投递 N 次与一次相同」；`tests/contract/storage-contract.test.js`「重复或乱序观察返回 false」；`tests/e2e/chain-bootstrap.test.js`「同步幂等」 | SQLite；端口（内存 + SQLite 两适配器）；core 入口（不断言修订号） | 不要求 | 相同输入的重复引导使业务修订号 2 变 3、实体数不变（P2，#220）；三条用例都不断言修订号。`duplicateEvent` 故障只在 provider 契约层使用，没有经 core 注入。 | 反例（#220） |
| 8 | `tests/integration/storage-sync-surface.test.js`「观察定序：v1」「观察定序：更旧的版本不落账本」；`tests/contract/storage-contract.test.js`「定序取已提交版本的最大值」；`tests/contract/capabilities-observation.test.js`「sourceVersionFromTimestamp 把 RFC」；`tests/contract/storage-contract.test.js`「规范载体按时间序定序」；`tests/integration/storage-source-version-upgrade.test.js`「U1 评审反例」「U3 可归一」「U11 预检后的旧写者」 | SQLite；端口（内存 + SQLite 两适配器） | 不要求 | 不等宽版本载体下新观察被判为乱序而丢弃：在 Storage 端口上先投递 `v9` 再投递 `v10`，第二次返回 `false`，两个适配器都复现（#203，探针见表后）。`packages/capabilities/src/observation.ts` 的定序约定把"码点序即目标序"的归一化列为 provider 的义务，Storage 只按码点序执行，所以这条反例现在不可达：当前没有生产路径给观察填 `sourceVersion`（种子观察不带版本，core 丢弃 `recordObservation` 的返回值）；#203 仍开放，第一个给观察填变精度或不定长版本的 provider 接入时，它会变成静默丢弃较新观察的缺口。`FaultKind.OutOfOrder` 从未被任何测试使用，乱序没有经 core 注入。 **Superseded by #203 修复（2026-09-30，PR #240）**：v9 / v10 已在入口被拒绝；可归一时间戳统一成定宽 UTC 纳秒载体，两个 Storage 的新旧次序用例通过。SQLite 旧行可归一则迁移、不可归一则预检拒绝并提供备份修复；并发晚到旧行的事务内拒绝报告阶段和已提交版本。core 的乱序注入仍未覆盖，不能升为全链路已断言。 | 部分（端口定序已收口；core 无乱序观察注入） |
| 9 | `tests/e2e/delivery-lineage.test.js`「只读交付方」 | core 入口 | M9：`rerunPipeline` 在交付方不支持时仍推进一次修订号，该用例 1/1 变红；还原后复绿 | 只覆盖 `rerunPipeline` 一条命令；`startWork` 缺 `worktreeCreate` 等其它写命令缺能力时没有经 `commands` 的用例。`tests/integration/local-git-start-work-resume.test.js`「R2 Development 能力不可用的失败」在真实 Git 上以 `worktreeCreate: false` 跑 core 的 `startWork` 函数（手工 `createContext`，旁证），断言 `not_supported`、已决定的分支保留、不新写 `has_worktree`；它落下的是一条 failed 上下文，不是不变量要求的"不产生任何本地写入"，也不经 `commands` 入口。 | 部分（仅 `rerunPipeline` 一条命令有 core 入口用例） |
| 10 | `tests/e2e/start-work.test.js`「重启：同一份 Storage 内容上的新 core」；`tests/integration/human-execution-provider.test.js`「重启：同一份 Storage 上重建 core」 | core 入口（内存 Storage 导出再导入；后一条经 `composeCore` 装配真实 `execution-human` 与 `development-local-git`） | M10：内存 Storage 的 `exportFakeStorageState` 丢掉执行上下文，两条用例各 1/1 变红；还原后复绿 | core 与 SQLite 的组合没有用例（#141）：没有任何测试把 core 组合在 SQLite Storage 上，重启只在内存替身上证明，断言没有触达真实持久化。`tests/integration/local-git-start-work-resume.test.js`「R1 基线前进后换新键重试」把"中断在分支步之后、同一 storage 换一套能力重新组装、换新键重试"放在真实 Git 上跑 core 的 `startWork` 函数（手工 `createContext`，旁证）；它的存储仍是内存替身，用例头注释自己写明 SQLite 与重启归 #141。 | 部分（core 入口只在内存 Storage 上断言；core 与 SQLite 组合无用例，#141） |

汇总：已断言 0、部分 6、反例 4、未验证 0，共 10 行。以上是证据，不是 R1 裁决；按 §1，存在反例或证据缺失即为不满足，"部分"与"未验证"同样不能算满足，第 3 条由 §2 表的判定者裁决。

**#203 的历史端口复跑**（第 8 行，原基线 main@699d715）：以下原文保留，**Superseded by** 本节下方修复后复跑；新契约拒绝 v9/v10，不能再把本历史输出当成当前结论。

```bash
node --input-type=module -e "
import { makeObservation } from '@harness-projects/capabilities'
import { createFakeStorage } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
for (const [name, storage] of [['fake', createFakeStorage()], ['sqlite', createSqliteStorage(':memory:')]]) {
  await storage.putWorkspace({ id: 'ws-1', name: 'probe', statusPolicy: 'provider_authoritative' })
  await storage.putProviderBinding({ id: 'binding-1', workspaceId: 'ws-1', domain: 'planning', implementationKey: 'fake', enabled: true, isDefault: false })
  const at = (version) => ({ state: 'pending', observation: makeObservation({ subject: { bindingId: 'binding-1', objectKind: 'issue', externalId: 'issue-1', url: undefined }, type: 'issue.updated', eventTime: undefined, receivedTime: version, sourceVersion: version, stablePayloadFields: { v: version }, payload: { v: version } }) })
  console.log(name, 'v9', await storage.recordObservation(at('v9')), '| v10', await storage.recordObservation(at('v10')))
}
"
# 观察：fake v9 true | v10 false；sqlite v9 true | v10 false（v10 是更新的观察，却被判为乱序）
```


**#203 修复后复跑**（在检出 `fix/source-version-order` 的工作树根目录执行；当前 head 用 `gh pr view 240 -R SingularityKChen/harness-projects --json headRefOid` 回读）：

```bash
node --test tests/contract/capabilities-observation.test.js tests/contract/storage-contract.test.js tests/integration/storage-source-version-upgrade.test.js
# 期望：非零用例且 fail 0；载体拒绝、归一后的新旧顺序、旧库恢复与完整迁移交错都有断言
```

本行的 #203 旧反例已收口：旧版公开端口写入 v9 后，当前版本预检拒绝且原文件不变；显式备份修复后规范新观察返回 true。预检后才出现旧写入时，已提交的早先迁移保持，005 回滚并通过错误的 phase / appliedVersions 报告真实状态。其余九行观察仍取 `main@699d715`（#239 的 `main@1cdfb23` 仅改文档，运行时代码相同）；本次只更新第 8 行及汇总，不替人类裁决 R1。

### 2.2 第 4、5 条的"稳定"与空层假绿

第 4、5 条原先只写"稳定"，既没有时间窗也没有 head 归属，读的人无从判定；第 5 条原先写"`tests/integration` 与 `tests/e2e` 为绿"，而这两个目录为空时 `node --test` 仍然退出 0（Node 26 实测：摘要行 `ℹ tests 0`，exit code 0），因此它是一条会假绿的门禁表述。两处都在下面收成可复跑的形式。

**"稳定"的定义**（第 4、5 条共用）：

- **head 归属**：判定对象是**目标 head**，即回读命令返回的 `headRefOid`，不是本地 `git rev-parse HEAD`，也不是分支名——分支在被推入新提交后仍然叫同一个名字。
- **时间窗**：在该 `headRefOid` 上**最近连续两次运行**都为绿，且第二次运行之前该 head 没有被推入新提交。只有一次运行不算稳定；最近一次为红即不满足。
- **回读命令**（第 4 条）：

```bash
n=<PR 编号>
head=$(gh pr view "$n" --json headRefOid --jq .headRefOid)
gh run list --commit "$head" --limit 2 --json headSha,conclusion,createdAt
# 判定：返回 2 条、两条的 headSha 都等于 "$head"、两条的 conclusion 都是 "success"
```

- **回读命令**（第 5 条）：先用上面的命令确认 head 归属与稳定，再在同一 head 上核对两层各自非空且全绿：

```bash
# 1) 用例文件计数：每层至少一个
find tests/integration tests/e2e -name '*.test.js' | wc -l    # 期望 ≥ 1

# 2) 每层分别运行：退出码为 0，且摘要行 tests ≥ 1、fail = 0
rc=0
for layer in tests/integration tests/e2e; do
  out=$(node --test "$layer" 2>&1) || { echo "$layer: FAIL 非零退出"; rc=1; continue; }
  n=$(printf '%s\n' "$out" | sed -n 's/^ℹ tests \([0-9][0-9]*\)$/\1/p')
  if [ "${n:-0}" -ge 1 ]; then printf '%s: OK tests=%s\n' "$layer" "$n"
  else echo "$layer: FAIL 用例数为 0（空层假绿）"; rc=1; fi
done
exit $rc
```

空层的 `node --test` 输出是 `ℹ tests 0` 且退出 0；上面第 2 步把"用例数为 0"判为失败，因此"目录存在但没有用例"不再能通过第 5 条。同一组检查也适用于第 2 条：`tests/integration` 里没有用例时，"迁移可通过且可重复"无从判定，空层的 exit 0 同样不是证据。

这段手工脚本现在有机械等价物：`Merge Gate · Integration` 与 `Merge Gate · E2E` 两条 lane 通过 `scripts/run-test-layer.mjs` 做同一组判定，并且更严——它要求"真正执行的用例数 = `tests` − `skipped` − `todo`" ≥ 1，因此整层被 `skip` 或 `todo` 消音时同样失败。有 CI 结论时优先读这两条 check；上面的命令是在没有 CI 结论（例如本地复核某个 head）时的手工复现。

**当前结论（2026-09-26 随 #175 更新，观察时刻快照；以命令回读为准）**：两个层都有用例文件——`find tests/integration tests/e2e -name '*.test.js' | wc -l` 为 16（`tests/integration` 8 个、`tests/e2e` 8 个），逐层运行时 `tests/integration` 为 `ℹ tests 69` / `ℹ fail 0`、`tests/e2e` 为 `ℹ tests 39` / `ℹ fail 0`，两者退出码都是 0，所以 §2.2 第 5 条的两条命令现在都通过。`Merge Gate` 现在是一个 lane：`.github/workflows/merge-gate.yml` 有四条执行 lane（`Merge Gate · Integration` / `Merge Gate · Boundaries` / `Merge Gate · MVP-0` / `Merge Gate · E2E`）与一个聚合 job `Merge Gate`，空层与零用例层由 `scripts/run-test-layer.mjs` 判失败；`docs/development/ci.md` 记录了它与 `CI` 的重复为什么是刻意的。因此第 5 条的"两层非空且全绿"部分**满足**，但"目标 head 上连续两次运行均为绿"必须在目标 head 上用上面的回读命令确认——本文件所在 head 的 CI 结论只能从该 head 的运行记录读，本地推断与"上一次跑过"都不算证据。第 4 条同样只有在存在 open PR 时才能回读。

> **注（2026-09-29，#217）**：上一段的文件与用例计数已经过期，不是现状。同一组回读命令在 `main@699d715`（Node v26.10.0）上的结果：`find tests/integration tests/e2e -name '*.test.js' | wc -l` 为 21（`tests/integration` 13 个、`tests/e2e` 8 个），逐层运行时 `tests/integration` 为 `ℹ tests 119` / `ℹ fail 0`、`tests/e2e` 为 `ℹ tests 39` / `ℹ fail 0`，退出码都是 0。"两层非空且全绿"的判断不变；计数以命令回读为准，原文保留。

## 3. 提前终止条件

任一条不满足（含"无法判定"）即触发提前终止：

- 立即停止发布流程，不进入 RC，也不把未满足项挂到发布后；
- 一条不满足会阻塞发布，且**不能用补齐其它条来交换**——R1 不做分数抵扣；
- 已判定满足的条目，若其证据被后续改动推翻，状态回退为不满足，必须重新判定；
- 例外只能由人类伙伴显式记录：写明条目、理由、残余风险与失效日期；未记录的例外视为不满足；
- R1 通过**不等于**链路判定通过。MVP-0 / MVP-1 的范围与判定见 `docs/product/vertical-path.md`，两者都要成立。
