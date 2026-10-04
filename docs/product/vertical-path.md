# 纵向链路与 MVP 判定

> 本文件回答一个问题：**只读本仓库的人如何判定 MVP-0、MVP-1 与首发范围各自做完了没有。** 它把纵向链路逐步枚举成"用户动作 / 可观察结果 / 失败时的可见形态 / 这一步由哪一端的 provider 完成"，并给出三行判定表。
> 本文件不回答发布门禁的每一条（见 [release-gates.md](../architecture/release-gates.md)），也不回答怎么实现（见 `docs/exec-plan/` 与 `docs/architecture/`）。
> 依据 `AGENTS.md` §3（文档与事实源）：本文件自包含，结论不依赖任何不随仓库分发的外部输入。

## 1. 术语与判定主体

| 词 | 在本仓库里的意思 | 判定方式 |
|---|---|---|
| 纵向链路 | 从规划条目到交付可见的一串**用户可观察**步骤，不是技术分层 | §2 的步骤表 |
| MVP-0 | 纵向链路每一行都用 `packages/providers/fake` 的离线替身跑通，无凭据、无网络（§2 末两列） | `tests/mvp0/` 轨道全绿且用例数非零（轨道已建立，见本节末段） |
| MVP-1 | 同一条链路换成真实平台 provider，链路语义不变 | 在一个 sandbox 项目上人工走通 |
| 首发范围 | 具备发布资格的那个范围 | [R1 门禁](../architecture/release-gates.md)逐条判定 |

`tests/mvp0/` 是 MVP-0 的判定载体，由切片栈的 Batch C1 建立：它是 `node --test` 轨道上的一条端到端断言，链路上每个节点至少对应一条用例；未实现的节点必须**失败并点名该节点**，禁止 skip（skip 不产生压力）。链路的权威定义见 issue #7。

**当前状态（本文件所在 head 上）**：`tests/mvp0/` **已建立**，7 条节点断言**全部通过**（`ℹ tests 7` / `ℹ fail 0`，exit code 0），因此 MVP-0 目前**有可运行的判定**。此时能观察到的是：

```bash
test -e tests/mvp0
# 当前期望：为真（目录存在）
node --test tests/mvp0
# 当前实际输出：ℹ tests 7 / ℹ fail 0，exit code 0——判定载体存在且全部通过
```

失败形态仍然有效：删掉任一节点的实现后，该节点会以 `✖ 节点 N · …` 加 `AssertionError` 点名"节点「X」尚未实现"的形状失败，而**不是**以导入错误失败（`tests/mvp0/README.md` §2）。`Merge Gate · MVP-0` 车道在 PR 上跑这条轨道并点名它保护的不变量，但该车道目前是 advisory，不是分支保护里的必需检查（`docs/development/ci.md`）。

## 2. 纵向链路步骤枚举

每一步都用三个观察面描述：用户做什么、成功时看到什么、失败时看到什么。步骤表本身与 provider 无关；最后两列把"这一步由谁完成"写清楚——MVP-0 的每一行都由 `packages/providers/fake` 的离线替身完成，不需要真实平台；MVP-1 只替换外部平台那一端的 provider，步骤、观察面与失败形态都不改写。

> **Superseded by §2.1（2026-09-29，#217）**：原文"MVP-0 的每一行都由 `packages/providers/fake` 的离线替身完成"不成立。第 2 行与附行（Draft→Issue）没有生产入口，第 9 行没有生产入口、只由测试直接调用替身完成；第 1 行只有组合期入口。逐行状态见 §2.1，原文保留。

| # | 用户动作 | 可观察结果 | 失败时的可见形态 | MVP-0 完成者（离线替身） | MVP-1 才需要的真实平台 |
|---|---|---|---|---|---|
| 1 | 新建 Project Workspace | 工作区出现在工作区列表并可被选中；此时尚未连接任何平台 | 创建被拒绝并给出原因；不产生半成品工作区 | Storage 替身（内存）；不触网 | —（两版相同） |
| 2 | 连接一个规划平台项目 | 工作区显示已连接的项目与来源；连接状态可见 | 保持未连接；错误区分是凭据、权限还是项目不可见 | Planning 替身（fixture 项目）；无凭据、不触网 | GitHub Projects（需要凭据与网络） |
| 3 | 触发首次同步 | 条目被读入并区分 Issue / Draft / PR 三种内容身份；同一底层对象不产生第二个条目 | 读侧降级为最后已知快照并标记陈旧；写侧被拒绝而不是排队重放 | Planning 替身返回 fixture 观察 | GitHub 读 API |
| 4 | 查看工作项列表或 Board | 三类内容身份各自显示为工作项；规划字段来自平台 | 缺能力显示为不可用而不是空列表；不伪造规划值 | Planning 替身 + Storage 替身 | GitHub Projects 字段 |
| 5 | 打开统一工作项详情 | 详情展示规划字段、来源身份与工程谱系入口 | 来源不可达时展示最后已知值并标记陈旧；未确认写入不显示为已保存 | Planning 替身（权威值）+ Storage 替身（缓存与陈旧标记） | GitHub Projects + GitHub 谱系 |
| 6 | 对一个工作项执行"开始工作" | 出现执行上下文：工作项 + 仓库 → 工作树 + 分支 | 工作项或仓库不合法则不产生任何执行上下文 | Execution 替身 + Development 替身 | —（两版相同） |
| 7 | 等待本地工作树与分支就绪 | 本地出现 worktree 与 branch，二者指向同一工作项 | 工作树创建失败 → 执行上下文标记失败且**不启动**执行；脏工作树被拒绝而不是被覆盖 | Development 替身（工作树 / 分支替身，不触网） | —（两版相同） |
| 8 | 启动或关联执行会话 | 执行会话与执行上下文关联；会话状态可见 | 启动失败 → 上下文保留并降级为人工处理，工作树与分支仍在 | Execution 替身 | —（两版相同） |
| 9 | 创建变更请求 | 变更请求沿执行上下文 / 分支谱系关联到工作项 | 创建结果不确定时先对账；禁止盲目重放创建 | Development / Delivery 替身（含"创建结果不确定"故障注入） | GitHub PR 创建 |
| 10 | 查看 CI 状态 | CI 状态出现在交付视图 | 不可达时展示最后已知值并标记陈旧；不把"未知"显示为"通过" | Delivery 替身（fixture CI 状态 + 不可达注入） | GitHub Actions |
| 11 | 在交付视图与工作项详情查看谱系 | 工作项 → 执行上下文 → 分支 → 提交 → 变更请求 → CI 完整可见 | 缺失环节显示为缺口，不重新识别成第二个关系 | Development / Delivery 替身产出的谱系 | GitHub 谱系 |
| 12 | 回到平台核对规划状态 | 规划字段仍由平台拥有；CI 结果、执行完成与 PR 合并都没有改写它 | 本地投影成为新的事实源即判定失败 | Planning 替身（读回权威值） | GitHub Projects 读回 |
| 13 | （无新增用户动作）对任一外部写入制造一次失败 | 本地保留最后已知权威值，恢复动作可见，外部权威未被本地缓存覆盖 | 本地缓存静默覆盖外部权威，或出现 LLM 参与状态或关系控制的路径 | 五个替身的故障注入（离线、权限被拒、创建结果不确定、乱序与重复观察） | 真实平台的真实故障 |

> **Superseded by §2.1 第 9 行（2026-09-29，#217）**：表中第 9 行"MVP-0 完成者"一格写的"Development / Delivery 替身（含'创建结果不确定'故障注入）"没有生产入口支撑：core、controller、client 源码里没有创建变更请求的调用，`tests/mvp0` 与 `tests/e2e/delivery-lineage.test.js` 直接调用 `providers.development.createChangeRequest` 种下变更请求，'创建结果不确定'注入也没有经 core 走过变更请求的创建。原文保留。

第 2、3、4、5、9、10、11、12 行的"MVP-1 才需要的真实平台"一列非空：这些步骤的外部那一端由真实平台承担，MVP-0 用 `packages/providers/fake` 的 Planning / Development / Delivery 替身代替。第 1、6、7、8、13 行不涉及外部平台，两版走同一条路径。

**MVP-0 不在步骤表上删行**：13 行全部在离线替身上可判定，`tests/mvp0` 的断言覆盖这条链路的每个节点（§1）；MVP-1 换的是 provider，不是步骤。把"需要真实 GitHub"读成"MVP-0 跳过这几行"会同时错判 MVP-0 的范围与它的判定口径。

> **Superseded by §2.1 与其"与 `tests/mvp0` 七个节点的对应"一段（2026-09-29，#217）**：原文"13 行全部在离线替身上可判定，`tests/mvp0` 的断言覆盖这条链路的每个节点"不成立：`tests/mvp0` 的 7 个节点没有对应第 8、9、13 行与附行的节点，节点 3 不执行 Draft→Issue 提升，节点 6 的变更请求由直接调用替身种下。"不删行"的口径（MVP-1 换的是 provider，不是步骤）不变。原文保留。

第 13 行不是新增用户动作，而是对前面全部写路径的失败面要求；因此人工走通覆盖 §2 中除第 13 行以外的步骤，第 13 行由自动化断言与 R1 门禁覆盖。

### 2.1 逐步证据矩阵（观察快照）

> 观察基线：2026-09-29 起草于 `main@f6a33d2`；2026-09-30 变基到 `main@699d715` 后重新核对，现基线是 `main@699d715`。两个提交之间的变动只涉及 Start Work 恢复与分支探测（core 的 `start-work.ts`、`git-provisioning.ts`，controller 的 `StartWorkView`，及相关集成用例），核对方法是：本节引用的用例在新基线上逐条回读，复现命令 P1、P3、P4、X1–X3 在新基线的 `git archive` 导出目录里重跑，观察值与原文一致；第 7 行与第 13 行按新增证据改写。本节只记录这个基线上的代码与用例事实，不随代码自动更新；关闭本节引用的 issue 的 PR，必须在同一 PR 里更新对应行与这个基线。

**第 6、7 行与探针 P3、P4、X1 更新于 2026-10-01**，最后一次回读在 #253（#187 / #188：SQLite 开始工作的前置与谱系闭环，叠在 #251 仓库身份契约之上）合入前的最终树上（2026-10-02，第一轮 MVP 评审修订之后；rebase merge 会改写提交 SHA，所以不写分支提交，合入后在包含 #253 的 main 上按同样的命令重跑）：这两行引用的每个用例按下面的回读命令重跑（都能解析、全部通过，伪造前缀读回 `ℹ tests 0`），P3、P4、X1 在该检出上重跑，选取器改成按 `content.contentKind` 过滤（默认种子里 `kind` 为 `work_item` 的条目还包括内容被扣下的 `issue-3`，旧选取器随机命中它，观察值随之随机）。其余各行（第 1–5、8–13 行、附行、第 13 行的故障面表、探针 P1、X2、X3）**没有**在该检出上逐条回读，仍是上文 `main@699d715` 的基线，所以本节目前是混合快照，不是整体重新核对。已知过期但未改写：第 1 行 Provider 格的「没有任何用例把 core 组合在 SQLite Storage 上」与第 13.3 行的「`PermissionDenied` 经 core 只出现在执行域」在该检出上不再成立（`start-work-sqlite-registration` 经 `composeCore` 组合在 SQLite 上，并对 Development 的仓库读注入 `PermissionDenied`）。第 4 行由 #129 新增的三条引用（ui-work-item-list-browser「完整路径」、ui-work-item-list-view「permission / unsupported / unknown 不借缓存」、ui-work-item-list「不可用：权限 / 不支持 / 未知 / 离线 / 错误说明各不相同」）另在 #256 变基到已合入 #253 的 main 之后、第一轮 MVP 评审修订之后的树上按同样的回读命令逐条回读（2026-10-03；各读回一行 ✔、`ℹ tests 1`、`ℹ fail 0`，伪造前缀读回 `ℹ tests 0`）；第 4 行的其余引用没有在该检出上回读，仍是 `main@699d715` 的基线。

本节回答：§2 的每一步在产品里有没有**生产入口**、有没有经这个入口的成功与失败用例、外部那一端是替身还是真实 provider。它是证据，不是裁决：MVP-0 的判定条件与"断言落在哪一层才算数"由人类伙伴判定（§1、§3），本表只用下面的封闭词表，不使用裁决性措辞。

**规则**

- **生产入口**：`CoreApi.commands.*` / `CoreApi.queries.*`（`packages/core/src/context.ts`、`queries.ts`）、`Controller.commands.*` / `Controller.queries.*`（`packages/controller/src/commands.ts`、`queries.ts`），或 client 同步入口（`packages/client/src/sync.ts`）。`composeCore` 只能作为第 1、2 行的入口，并标"组合期"。
- **经入口的证据**：用例从生产入口出发抵达被测行为（先 `composeCore` 装配，再调用 `commands` / `queries`）。**旁证**：直接调用 `providers.<域>.<方法>`、core 内部导出函数（`provisionGit`、`promoteEntityIdentity`、`decideFromEngineeringFact`、手工 `createContext`）、provider 契约套件或 ui-model fixture；写进单元格时带"（旁证）"，不能单独支撑"已交付"。
- **反例**：有可复现的违例，给出同仓 issue 或下文的复现命令编号（P1、P3、P4、X1–X3）；只有 issue 记录、本轮未复跑的，写"（issue 记录的复现）"。
- **结论词表**：`已交付（替身）`｜`已交付（替身 + 真实 <包名>，集成）`｜`部分：<缺口>`｜`反例：<#n 或 Pn>`｜`未交付`。已交付＝有入口、成功与失败两列都有经入口的用例、无已知反例；部分＝有入口但某一观察面只有旁证或没有用例；未交付＝没有生产入口。
- **行语义**：结论只按该行自己的"可观察结果"与"失败时的可见形态"两列判定。发布门禁 R1 的不变量反例记在 [release-gates.md](../architecture/release-gates.md) §2.1.1，本表用"承接"列交叉引用，不把 R1 反例算成该行的反例。
- **只往保守方向修正**：打开用例后发现断言不成立时，可把结论降级；反向升级需要在所属 ExecPlan 的 Decision Log 写明证据。

**用例回读**：单元格里的用例写成"文件简称 + 标题前缀"，简称与路径的对应见下表。回读命令是把测试文件**当脚本直接运行**，不加 `--test`：

```bash
(
set -e -o pipefail
f=tests/e2e/chain-bootstrap.test.js; p='同步幂等'
node --test-reporter=spec --test-name-pattern="$p" "$f" | grep -E '^[[:space:]]*(✔|✖)|^ℹ (tests|fail)'
node --test-reporter=spec --test-name-pattern='不存在的前缀' "$f" | grep -E '^[[:space:]]*(✔|✖)|^ℹ (tests|fail)'
)
# 期望：前者是一行标题含该前缀的 ✔、ℹ tests 1、ℹ fail 0；后者只有 ℹ tests 0 与 ℹ fail 0（负对照）
```

检测块在子 shell 中启用 `errexit` 与 `pipefail`：任一 Node 进程非零退出即使过滤器仍有输出，也会使整个块非零退出并停止后续命令；过滤器的成功不能替代 Node 的退出状态。

判据：退出码 0；输出里有一行以 `✔` 开头（嵌套用例前面有缩进）、标题包含该前缀的用例，不是文件路径；没有 `✖` 行；摘要行 `ℹ tests` ≥ 1 且 `ℹ fail 0`。每个前缀都要配同样的负对照，伪造前缀必须读回 `ℹ tests 0` 且没有 `✔` 行，`ℹ tests 0` 即引用失效。不加 `--test` 是刻意的：`node --test <文件>` 默认按文件起子进程，文件本身被计成一条通过的测试，前缀一条用例都没匹配上时摘要行仍是 `ℹ tests 1` / `ℹ fail 0`，失效引用读回也是绿的（Node v26.10.0 实测）；直接运行没有这层包装。

Node 版本：`package.json` 声明 Node ≥ 22，所以这条命令只用 `--test-name-pattern` 与 `--test-reporter` 两个通用选项，不依赖 `--test-isolation`（据 Node 官方 CLI 文档，`--test-isolation` 到 v23.6 才出现，v22 系列只有 v22.8 起的 `--experimental-test-isolation`，v22.0 至 v22.7 两者都没有）。**局限**：本机只有 Node v26.10.0，命令与全部引用的回读都只在它上面实跑，没有下载或安装其他版本；Node 22 上的行为依据官方文档，未实跑：v22.0.0 的文档已有这两个选项，并写明未被执行的用例不出现在报告输出里（负对照因此应读回 0）；Node 22 在非 TTY 下默认用 tap 报告，所以命令显式写 `--test-reporter=spec`。若某个 Node 版本的 spec 报告没有 `ℹ tests` 摘要行，以"退出码 0、有含前缀的 `✔` 标题行、无 `✖`"为准，负对照改为"没有 `✔` 行"。

| 简称 | 文件 |
|---|---|
| `mvp0` | `tests/mvp0/chain.test.js` |
| `chain-bootstrap`、`controller-roundtrip`、`client-sync`、`delivery-lineage`、`status-policy`、`start-work`、`start-work-recovery`、`write-machine` | `tests/e2e/<简称>.test.js` |
| `start-work-retry-identity`、`start-work-step-recording`、`start-work-sqlite-registration`、`human-execution-provider`、`local-git-core-provisioning`、`local-git-start-work-resume`、`local-git-branch-probe`、`execution-relation-write-schema`、`workspace-sync-scope` | `tests/integration/<简称>.test.js` |
| `domain-identity`、`planning-contract`、`development-contract`、`ui-model-presentation`、`ui-work-item-list-view`、`ui-work-item-list`、`ui-work-item-list-browser` | `tests/contract/<简称>.test.js` |

| # | 用户动作 | 生产入口 | 成功形态用例 | 失败形态用例 | Provider | 当前结论 | 承接 |
|---|---|---|---|---|---|---|---|
| 1 | 新建 Project Workspace | 组合期：`composeCore` → `createContext` → `storage.putWorkspace`；没有列表或选择查询，controller 没有工作区命令 | 无专门用例；各 core 用例经 `composeCore` 隐式建工作区 | 无；没有 storage 时的结构化不可用（`unavailableCore`）没有用例 | Storage 替身（内存）；没有任何用例把 core 组合在 SQLite Storage 上 | 部分：无用户命令、列表与选择、创建失败用例 | #131 #132 |
| 2 | 连接一个规划平台项目 | 无；连接发生在组合期的 `collectBindings`（2026-10-02 起由 #197 取代 `registerBindings`：校验与收集之后，工作区与全部挂载在一个事务里写入；本格按该日代码订正，其余格仍是上文基线），`queries.listProviderBindings` 只读回已登记的绑定 | mvp0「节点 1 · 工作区」经 `composeCore` 与 `listProviderBindings` 只数默认 Planning 绑定，不断言项目、来源或连接状态（组合期入口） | 无；planning-contract「离线 Planning 替身（issue-backed）：权限被拒返回结构化」是 provider 契约层（旁证） | Planning 替身；`planning-github-projects` 是占位包 | 未交付 | #127 #131 #132 #197 |
| 3 | 触发首次同步 | `commands.bootstrapWorkspace`（core 与 controller）；controller 层没有用例 | 经入口：chain-bootstrap「同步幂等：同一观察两次计数不变」（再次引导后实体不增、重复观察被丢弃）；mvp0「节点 2 · 规划条目」（引导后每个条目都是三态内容之一）。chain-bootstrap「引导：一个条目一个成员」「内容三态：redacted 条目」只读 `composeCore` 组合期那一次引导的结果，没有调用 `commands.bootstrapWorkspace`（旁证：组合期）；"PR 条目成为变更请求实体、不产生第二个工作项"只有这条旁证 | 读侧：chain-bootstrap「降级：规划 provider 离线时」。写侧被拒绝而不排队重放没有用例（controller-roundtrip「命令：provider 权威拒绝显式写入」只断言显式状态写入被拒，不在首次同步路径上，也不断言不排队）；存储拒绝观察时 `bootstrapWorkspace` 抛出裸 `Error`，同步游标仍是 healthy，列表不标陈旧：同步失败对读侧不可见（#199，X2）。两个工作区共用一条连接时一方离线：workspace-sync-scope「工作区健康：另一个工作区成功不恢复当前失败」（经 `composeCore` 与 controller，替身与 SQLite 两个 Storage；2026-10-03 随 #189 补入，本格其余内容仍是上文基线） | Planning 替身；`planning-github-projects` 是占位包 | 反例：#199（issue 记录的复现） | #199 #134；R1 第 7 条的反例 #220 见 release-gates.md §2.1.1（#189 于 2026-10-03 收口，证据见失败列） |
| 附 | Draft→Issue 提升（不是第 14 步，见表后说明） | 无；提升只发生在替身侧，`promoteEntityIdentity` 是 core 内部导出，只被测试调用 | domain-identity「身份：Draft→Issue 提升保持内部实体 id 不变」（旁证：纯函数）；chain-bootstrap「身份：Draft→Issue 提升只换外部 id」（旁证：直接调用 `promoteEntityIdentity`） | P1：替身侧提升之后，`bootstrapWorkspace` 新建了一个实体（entities 6 → 7，不是同一实体） | Planning 替身 | 未交付（附 P1 反例） | 无专门承接 issue，归属待人类伙伴决定 |
| 4 | 查看工作项列表或 Board | `queries.listPlanningItems` → controller `baseline()`（即 `queries.snapshot`）→ client `sync.connect` / `sync.poll` | chain-bootstrap「引导：一个条目一个成员」「内容三态：redacted 条目」；controller-roundtrip「wire：快照只承载内部对象」；client-sync「client：基线 N」；ui-work-item-list-browser「完整路径」（#129 新增、晚于本节基线；旁证：fixture 经列表派生、页面投影与 renderer 渲染出行，不经生产入口） | client-sync「client：降级来源的值只能是最后已知」；"缺能力显示为不可用"只有 ui-model-presentation「不变量：四态映射」（旁证：fixture），以及 #129 新增、晚于本节基线的 ui-work-item-list-view「permission / unsupported / unknown 不借缓存」与 ui-work-item-list「不可用：权限 / 不支持 / 未知 / 离线 / 错误说明各不相同」（旁证：fixture，不经生产入口）；重连期间迟到的基线把 client 从修订 2 退回修订 1，旧的规划状态仍报 current（#218，X3） | Planning 替身 + Storage 替身；Board 视图未交付 | 反例：#218（X3） | #218 #178 #145 |
| 5 | 打开统一工作项详情 | `queries.getItemDetail`（core）；controller 只有从列表取的 `getEntity`，没有用例 | mvp0「节点 3 · 工作项」前半：详情回指同一 `entityId` 且恰好一个 primary 身份；status-policy「显式命令是唯一允许的联动」经 `getItemDetail` 读回规划状态 | 详情级陈旧标记没有经入口的用例（chain-bootstrap「降级：规划 provider 离线时」只经 `listPlanningItems`）；ui-model-presentation「展示：统一详情给出规划段」（旁证：fixture） | Planning 替身 | 部分：陈旧标记、controller 入口 | #178 #229 |
| 6 | 对一个工作项执行"开始工作" | `commands.startWork`（core 与 controller） | start-work「重复开始：同一工作项」；controller-roundtrip「命令：同键重放返回原结果」；mvp0「节点 5 · 执行上下文」；start-work-sqlite-registration「空仓库集合上开始工作」（替身 Storage 与真实 SQLite 文件各一遍，经 `composeCore` + `commands.startWork`：从未登记仓库的库上一次到位，外部分支 / 工作树 / 运行各 +1，Ready、两条 confirmed 关系、`saved` 的 attempt 与 context 对应的 run）。mvp0「节点 4 · 开始工作」用占位 id、实际走失败分支，只断言未确认时不报 saved，不算成功用例 | start-work「开始工作：工作项或仓库形状不合法」（只覆盖空白的工作项 id）；start-work-sqlite-registration「工作项守卫」（未知 / 别的工作区 / 变更请求 / 被扣下的条目 → `not_found` / `not_found` / `invalid_input` / `unavailable`，零外部写入、零本地新增）与「ack 与能力门」（仓库不存在、ack 回显不符、能力缺失 → 结构化失败，不落执行上下文，同样零外部写入）；X1 在该检出上不再复现（不存在的工作项与仓库都 `failed / not_found`，没有执行上下文）。残余：同幂等键换请求仍报 `saved`（#194，P4）；Storage 端口层面悬空工作项的分歧仍在（直接 `putExecutionContext`：替身接受、SQLite 报裸外键错误，#196） | Execution 替身 + Development 替身；Storage 在替身与真实 SQLite 上各跑一遍 | 反例：#194（P4） | #194 #196 |
| 7 | 等待本地工作树与分支就绪 | `commands.startWork` 的供应序列（core 与 controller） | 经入口：start-work「重复开始：同一工作项」「工作树冲突：按幂等已存在资源复用」；start-work-recovery「中断后：Provisioning 上下文接管供应」；human-execution-provider「开始工作：工作树与分支真的落盘」（真实 Git，`composeCore` + `commands.startWork`）；start-work-sqlite-registration「空仓库集合上开始工作」（替身与 SQLite：外部工作树与分支各 +1，`has_worktree` 关系由真实的工作树 ack 产生）与「租约内的在途」（租约过期后接管续跑，分支与工作树不重复）。旁证（core 的 `startWork` 函数 + 手工 `createContext` + 真实 Git，没有经 `composeCore` 与 `commands`，也没有 Planning 绑定）：local-git-start-work-resume「R1 基线前进后换新键重试」；local-git-branch-probe「接管：目标分支排在第一页之外时」；local-git-core-provisioning「core 复用：同一请求重试返回既有」只覆盖 `provisionGit`（旁证） | 工作树步失败落成 Failed 上下文：start-work-retry-identity「重试：可清除的失败之后」（经入口，替身）；结果不确定时不启动执行：write-machine「结果不确定：git 创建返回 ambiguous」（分支步，经入口）；start-work-sqlite-registration「工作树步失败」（替身与 SQLite：Failed、分支保留、只有 `tracks`、失败也记 attempt）、「ack 之后本地写失败」（Unknown、保留已 ack 的句柄、不起 run，Ready / 关系 / attempt 同一个事务）与「Ready 之后的重放与读取」（run 缺失或状态未知、必需边缺失或只是候选的 Ready，在同 key、新 key、关库重开与 Query 上都是 Unknown / `degraded`，不报健康 Saved，不起第二个 run）。旁证（同上，真实 Git 上跑 `startWork` 函数）：local-git-start-work-resume「R2 Development 能力不可用的失败」「R3 失败的尝试只保留已决定的分支」；local-git-branch-probe「对账：写入已落地但响应丢失」；local-git-core-provisioning「已 ready 上下文的工作树或分支消失后」；旁证（`provisionGit`）：local-git-core-provisioning「core 不得报成功：分支已被别处检出时」。脏工作树被拒绝没有用例（「工作树冲突」只断言复用、不覆盖），工作树步失败时不启动执行没有断言 | Development 替身；真实 `development-local-git` 只在 human-execution-provider 的集成用例里经 `composeCore` + `commands.startWork` 出现，其余真实 Git 用例分两档，都是旁证：`startWork` 函数上的完整供应序列（local-git-start-work-resume、local-git-branch-probe 与 local-git-core-provisioning 的 `startWork` 用例，手工 `createContext`，不是 `composeCore`），和只覆盖供应函数的 `provisionGit` 用例 | 部分：脏工作树拒绝；真实 Git 上的恢复与失败只有旁证 | #138 #183 #211 #213 #214 |
| 8 | 启动或关联执行会话 | `startWork` 的执行段；`commands.cancelExecutionRun` 只在 core，controller 未暴露 | human-execution-provider「开始工作：工作树与分支真的落盘」：`composeCore` + 真实 `execution-human`，经 `queries.getExecutionContext` 读回 `runExternalId`；运行状态（running）由 `storage.getExecutionRun` 与 `provider.getRun` 读取（旁证） | start-work「执行启动失败：上下文」；human-execution-provider「执行起不来且没有 fallback 绑定」 | 替身 + 真实 `execution-human`、`development-local-git`（经 `composeCore`，临时仓库）；`execution-harness` 是占位包 | 部分：会话状态没有经查询的可见面（`ExecutionContextView` 没有运行状态字段） | #140 #215 |
| 9 | 创建变更请求 | 无；core、controller、client 源码里没有创建变更请求的调用 | 无；mvp0 的 `chainFor` 与 delivery-lineage 的 `startChain` 直接调用 `providers.development.createChangeRequest` 种下变更请求，不计 | 无经入口的用例；development-contract「离线 Development 替身：创建结果不确定返回 ambiguous_result」是 provider 契约层（旁证），write-machine 的"结果不确定"用例注入的是分支创建 | 只有 provider 契约套件 | 未交付 | #235（被 #231 #204 阻塞） |
| 10 | 查看 CI 状态 | `queries.getDeliveryProjection`（core）；controller 只转发 `getDeliveryLineage`，不转发投影的 `degraded` 与 `optional` | delivery-lineage「正向：真实链路走完后 CI 跳出现」；mvp0「节点 7 · CI」（两者的变更请求都由直接调用替身种下，TD-002）；controller 层没有用例 | P3：交付方离线后 CI 跳 5 → 0，只在投影级 `degraded`；没有经入口的失败用例 | Delivery 替身；`delivery-github-actions` 是占位包 | 反例：#221（P3） | #221 #222 #232 |
| 11 | 在交付视图与工作项详情查看谱系 | `queries.getDeliveryLineage` + `commands.confirmRelation`（core 与 controller） | delivery-lineage「交付谱系：每一跳」「候选关系：确定性发现先进候选」；mvp0「节点 6 · 分支/变更请求」（三者的变更请求都由直接调用替身种下，TD-002）；controller 层的 `getDeliveryLineage` 与 `confirmRelation` 没有用例 | delivery-lineage「负向：锚点未观察时」「负向：未创建执行上下文时」：只断言 0 跳与不落关系；缺失环节没有可见的缺口标记（骨架跳被过滤，只剩投影级 `degraded`） | Development / Delivery 替身 | 部分：变更请求跳依赖第 9 行的直接替身调用；读路径写关系（P3 首读关系 2 → 9） | #222 #233 #234 |
| 12 | 回到平台核对规划状态 | 只读查询；`commands.applyPlanningStatus` 是唯一写入口 | status-policy「交付谱系里的 CI 失败只进 derived 块」（折叠断言直接调用 `withDeliveryLineage`，存储里规划状态不变经 `getItemDetail` 读回）；mvp0「节点 7 · CI」（其中 `decideFromEngineeringFact` 是直接调用，旁证） | status-policy「显式命令是唯一允许的联动」；status-policy「工程事实」经 `decideFromEngineeringFact` 覆盖三种策略 × 三种事实（旁证：纯函数）；`ExecutionCompleted` 与 `ChangeRequestMerged` 在 core 里没有生产摄入，只由用例手工构造 | Planning 替身 | 部分：执行完成与 PR 合并没有生产摄入 | #70 #134 #71 |
| 13 | （无新增用户动作）对任一外部写入制造一次失败 | 不是新动作；按故障面拆到具体入口，见表后「第 13 行的故障面」：`commands.startWork`（13.1、13.2、13.3、13.9）、`commands.bootstrapWorkspace` + `queries.listPlanningItems` / controller `baseline()`（13.4）、`queries.getDeliveryProjection`（13.5）、core 的 `commands.cancelExecutionRun`（13.6，controller 未暴露）、`commands.bootstrapWorkspace` 的重复与乱序观察（13.8）；13.7 与 13.10 没有生产入口，列为未交付 | 见 13.1、13.2、13.4、13.6：结果不确定（Development 写）、执行启动失败与权限被拒（Execution 写）、Planning 离线的降级读、取消失败，都有经入口的用例 | 见 13.3、13.5、13.8、13.9：Development 权限被拒、Delivery 离线、重复与乱序观察没有经入口的用例，Development 离线只有两条手工注入 `unavailable` 的经入口用例；同键不同请求的重放报 `saved`（P4）；Delivery 离线后最后已知 CI 消失（P3） | 替身；执行域另有真实 `execution-human` | 反例：#221（P3）、#194（P4） | #221 #194 #199 #204 |

**第 13 行的故障面**（13.x 不是新增步骤，只是把第 13 行"对任一外部写入制造一次失败"拆到各自的生产入口；用例引用与上表同一规则，结论用同一词表，行级结论取最弱者：反例 > 未交付 > 部分 > 已交付）：

| # | 故障面 | 生产入口 | 经入口的用例 | 旁证与缺口 | 结论 |
|---|---|---|---|---|---|
| 13.1 | Development 写结果不确定（分支创建响应丢失） | `commands.startWork` | write-machine「结果不确定：git 创建返回 ambiguous」（先 reconcile，未落地就 failed、不重试创建、不启动执行）；write-machine「结果不确定：reconcile 找回同值分支后继续」 | 旁证：write-machine「写状态机：确认前只报告 saving」（纯函数）；local-git-branch-probe「对账：写入已落地但响应丢失」（`startWork` 函数 + 真实 Git）。controller 层没有用例 | 已交付（替身） |
| 13.2 | Execution 写失败、权限被拒、结果不确定、策略只读 | `commands.startWork` | start-work「执行启动失败：上下文」（工作树与分支保留、`manual_fallback`）；human-execution-provider「执行起不来且没有 fallback 绑定」「fallback 只在主执行」（经 `composeCore`，真实 `execution-human`，七种故障与策略形态下运行记录、首次结论与查询面一致） | controller 层没有用例 | 已交付（替身 + 真实 execution-human、development-local-git，集成） |
| 13.3 | Development 离线或权限被拒（写路径） | `commands.startWork` | 两条用例都经 `composeCore` + `commands.startWork`，手工替换 Development 的方法让它返回 `unavailable`（与替身离线故障同一错误码）：start-work-retry-identity「重试：可清除的失败之后」（`createWorktree` 失败：上下文落成 Failed、分支步结果保留，换新键重试后完成且不产生第二份上下文）；start-work-step-recording「conflict 后列表读取失败只报 unknown」（分支冲突后的 `listBranches` 失败：只报 unknown、不报已确认、不建工作树，恢复后换新键接管既有分支）。没有用 `FaultKind.Offline` 故障开关（它经 core 只注入过 Planning）；权限被拒没有经入口的用例（`PermissionDenied` 经 core 只出现在执行域） | 旁证：development-contract「离线 Development 替身：权限被拒与离线都是结构化失败」（provider 契约层） | 部分：权限被拒没有经入口的用例；离线只由手工替换方法返回的 `unavailable` 覆盖（工作树创建与分支列表探测） |
| 13.4 | Planning 读侧离线；存储拒绝观察 | `commands.bootstrapWorkspace` + `queries.listPlanningItems`；controller `baseline()` | chain-bootstrap「降级：规划 provider 离线时」（返回结构化失败，最后已知值保留并标 degraded）；client-sync「client：降级来源的值只能是最后已知」（经 `commands.bootstrapWorkspace` 与 controller `baseline()`，`applyBaseline` 直接调用，没有经 `sync.connect` / `sync.poll`） | X2：存储拒绝观察时 `bootstrapWorkspace` 抛出裸 `Error`，游标仍是 healthy，列表不标陈旧（#199） | 反例：#199（issue 记录的复现） |
| 13.5 | Delivery 离线（读侧，丢最后已知 CI） | `queries.getDeliveryProjection` | 无：没有用例给 Delivery 注入离线 | P3：离线后 CI 跳 5 → 0，只在投影级 `degraded`（#221） | 反例：#221（P3） |
| 13.6 | 取消执行运行失败（签发者路由不到、取消被设为只读） | core 的 `commands.cancelExecutionRun`（controller 未暴露） | human-execution-provider「重启后取消 fail closed」（三种形态结构化失败、运行记录一字不改）；成功侧 human-execution-provider「取消以运行身份为准」 | controller 没有入口；取消的记账与对账 issue 开放（#215，本轮未复跑） | 部分：controller 未暴露 |
| 13.7 | Planning 外部写入失败 | 无：唯一的规划写命令 `commands.applyPlanningStatus` 经 `writePlanningStatus` 只写本地规划投影；core、controller、client 源码不调用 Planning provider 的任何写方法（`updatePlanningFields`、`updateWorkItemContent`、`movePlanningItem`、`createIssueWorkItem`、`createDraftItem`） | 无；controller-roundtrip「命令：provider 权威拒绝显式写入」是策略拒绝，不是外部写入失败；`planning-github-projects` 是占位包 | 没有生产入口承载"Planning 外部写失败" | 未交付 |
| 13.8 | 重复与乱序观察 | `commands.bootstrapWorkspace` | 无：`OutOfOrder` 没有任何用例注入；`DuplicateEvent` 没有经 core 注入（chain-bootstrap「同步幂等」是重复引导，不是重复投递观察） | 旁证：planning-contract「离线 Planning 替身（issue-backed）：同一观察投递两次」（provider 契约层） | 部分：没有经入口的重复与乱序注入 |
| 13.9 | 同幂等键换请求重放 | `commands.startWork` | controller-roundtrip「命令：同键重放返回原结果」只覆盖同请求重放 | P4：换工作项后第二次仍报 `saved`，没有为第二个工作项建上下文（#194） | 反例：#194（P4） |
| 13.10 | LLM 不进入状态或关系控制路径 | 无：这是"某条路径不存在"的否定性质，没有可调用的入口 | 无 | 旁证：execution-relation-write-schema「不变量 5：两张关系表的 source 词表」（SQLite 表结构）；R1 第 8 条归人类评审 | 未交付 |

13.x 共 10 面：已交付 2、部分 3、反例 3、未交付 2。

**结论计数**（13 行 + 附行）：已交付 0、部分 6（第 1、5、7、8、11、12 行）、反例 5（第 3、4、6、10、13 行）、未交付 3（第 2、9 行与附行）。第 13 行按 13.1–13.10 拆开后有 2 面已交付、3 面部分、3 面反例、2 面未交付，行级结论取最弱者所以是反例；两种粒度是同一份证据，不重复计入。这是证据，不是 MVP-0 裁决。

附行不是第 14 步，也不是新增的产品承诺：它只记录"Draft→Issue 提升保持内部实体 id 不变"这条身份不变量在生产入口上的状态。表内的入口、用例与 provider 描述取自 `main@f6a33d2` 与 `main@699d715` 上逐个打开的用例与源码（第 7 行与第 13 行以后者为准）；`planning-github-projects`、`development-github`、`delivery-github-actions`、`execution-harness`、`planning-local` 与 `apps/*` 都是 8 行占位，真实实现只有 `development-local-git` 与 `execution-human`。

**与 `tests/mvp0` 七个节点的对应**：节点 1 → 第 1、2 行；节点 2 → 第 3、4 行；节点 3 → 第 3、5 行，且不执行提升（用例标题写"Draft→Issue 提升不换 id"，用例体没有提升；见 `docs/exec-plan/tech-debt-tracker.md` TD-001）；节点 4 → 第 6 行；节点 5 → 第 6、7 行；节点 6 → 第 11 行，变更请求由直接调用替身种下（TD-002）；节点 7 → 第 10、12 行。第 8、9、13 行与附行没有节点。结论：7 条全绿是 MVP-0 的必要条件，不是充分条件。

**复现命令**：在装好依赖的 checkout 根目录运行；在 `.worktrees/<slug>` 下先确认 `import.meta.resolve('@harness-projects/core')` 落在本工作树。观察值在 `main@f6a33d2` 取得、`main@699d715` 上重跑相同，对应批次修复后应改变，改变时同 PR 更新本节。P3、P4、X1 另在 #253 合入前的最终树上用新选取器重跑（2026-10-02，各 3 次，输出一致；更早一次在 B-3 的首个代码提交上各 6 次，输出相同）：P3、P4 的观察值不变，X1 的随开始工作的预检改变。

```bash
# P1 Draft→Issue：替身侧提升后，生产同步路径新建实体（附行）
node --input-type=module -e "
import { composeCore } from '@harness-projects/core'
import { createFakeProviders, fixtureProjectRef } from '@harness-projects/provider-fake'
const providers = createFakeProviders(); const { planning } = providers
planning.addItem(fixtureProjectRef(planning.bindingId), 'draft', '草稿项', '草稿正文')
const api = await composeCore({ workspace: { name: 'probe' }, providers })
const draft = (await api.queries.listPlanningItems()).find((v) => v.content.identity.externalKind === 'draft')
const n0 = providers.storage.data.entities.length
planning.promoteDraft(planning.state.items.find((i) => i.ref.externalId === draft.content.identity.externalId).ref, 'issue-100')
await api.commands.bootstrapWorkspace()
const promoted = (await api.queries.listPlanningItems()).find((v) => v.content.identity.externalId === 'issue-100')
console.log('entities', n0, '->', providers.storage.data.entities.length, '| same entity?', promoted?.entityId === draft.entityId)
"
# 观察：entities 6 -> 7 | same entity? false

# P3 交付首读写关系、离线丢 CI（第 10、11、13 行）
node --input-type=module -e "
import { composeCore } from '@harness-projects/core'
import { FaultKind, createFakeProviders, refOf } from '@harness-projects/provider-fake'
const providers = createFakeProviders()
const api = await composeCore({ workspace: { name: 'probe' }, providers })
const workItemId = (await api.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item').entityId
const started = await api.commands.startWork({ workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' }, idempotencyKey: 'p3' })
await providers.development.createChangeRequest({ repository: refOf(providers.development.gate.bindingId, 'repository', 'repo-alpha'), head: started.branchExternalId, base: 'main', title: 'p3', body: 'p3' })
const scope = { workItemId, repositoryId: 'repo-alpha' }
const ci = (p) => p.hops.filter((h) => h.entityKind === 'pipeline_run' || h.entityKind === 'check_run').length
const r0 = providers.storage.data.relations.length
const online = await api.queries.getDeliveryProjection(scope)
const r1 = providers.storage.data.relations.length
providers.delivery.faultsSwitch.set(FaultKind.Offline, true)
const offline = await api.queries.getDeliveryProjection(scope)
console.log('relations', r0, '->', r1, '| ci online', ci(online), '| ci offline', ci(offline), '| degraded', offline.degraded)
"
# 观察：relations 2 -> 9 | ci online 5 | ci offline 0 | degraded true

# P4 同幂等键换工作项仍报 saved（第 6、13 行）
node --input-type=module -e "
import { composeCore } from '@harness-projects/core'
import { createFakeProviders } from '@harness-projects/provider-fake'
const api = await composeCore({ workspace: { name: 'probe' }, providers: createFakeProviders() })
const [a, b] = (await api.queries.listPlanningItems()).filter((v) => v.content.contentKind === 'work_item')
const req = (workItemId) => ({ workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' }, idempotencyKey: 'same-key' })
await api.commands.startWork(req(a.entityId))
const second = await api.commands.startWork(req(b.entityId))
const ctx = await api.queries.getExecutionContext({ workItemId: b.entityId, repositoryId: 'repo-alpha' })
console.log('second', second.writeState, '| context for b?', ctx !== undefined)
"
# 观察：second saved | context for b? false

# X1 开始工作对不存在的仓库与工作项的回答（第 6 行失败列；#253（#187 / #188）合入之前两者都落一条执行上下文，不存在的工作项还报 saved；Storage 端口层面的悬空工作项分歧仍是 #196）
node --input-type=module -e "
import { composeCore } from '@harness-projects/core'
import { createFakeProviders } from '@harness-projects/provider-fake'
const providers = createFakeProviders()
const api = await composeCore({ workspace: { name: 'probe' }, providers })
const item = (await api.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item')
const start = (workItemId, repositoryId, k) => api.commands.startWork({ workItemId, repositoryId, actor: { kind: 'agent' }, idempotencyKey: k })
const noRepo = await start(item.entityId, 'no-such-repo', 'x1-a')
const noItem = await start('no-such-item', 'repo-alpha', 'x1-b')
console.log('no repo', noRepo.writeState, noRepo.error?.code, '| no item', noItem.writeState, noItem.error?.code, '| contexts', providers.storage.data.contexts.length)
"
# 观察：no repo failed not_found | no item failed not_found | contexts 0（两次都没有落执行上下文；#253 合入之前是 no item saved ready | contexts 2）

# X2 存储拒绝观察时同步失败对读侧不可见（第 3 行失败列；#199）
node --input-type=module -e "
import { composeCore } from '@harness-projects/core'
import { createFakeProviders } from '@harness-projects/provider-fake'
const providers = createFakeProviders(); const { planning } = providers
const api = await composeCore({ workspace: { name: 'probe' }, providers })
planning.emitObservation({ ref: planning.state.items[0].ref, type: 'issue.updated', stableFields: { v: 1 }, sourceVersion: 'vé' })
let outcome; try { outcome = (await api.commands.bootstrapWorkspace()).ok } catch (e) { outcome = 'threw ' + e.constructor.name }
const binding = (await api.queries.listProviderBindings()).find((b) => b.domain === 'planning')
const cursor = await providers.storage.getSyncCursor(binding.workspaceId, binding.id, 'planning.project')
console.log('bootstrap', outcome, '| cursor', cursor.state, '| any view degraded', (await api.queries.listPlanningItems()).some((v) => v.freshness.degraded))
"
# 观察：bootstrap threw Error | cursor healthy | any view degraded false（`main@699d715` 的基线；#189 起游标按 `(workspaceId, bindingId, scopeKey)` 三元键读取，调用已同步改成三参数（工作区取自挂载记录的 `workspaceId`），这一改动只订正签名，没有在新检出上重放观察。已知该触发在 `0728435` 之后另行失效：非规范 `sourceVersion: 'vé'` 在 `emitObservation` 入口就抛 `RangeError`，到不了存储，所以本片段目前停在 `planning.emitObservation(...)` 那一行；需要新的存储拒绝触发才能重放，随 #199 处理） Superseded by 本节第 3 行与 13.4 行的「当前结论」列（2026-10-04）：本片段自 `0728435` 起无法重放，表格不再把 X2 当作可复现的反例，两行改为「反例：#199（issue 记录的复现）」；能到达 Storage 的现成触发（旧载体已提交观察 + 规范版本观察 → `LEGACY_COMMITTED_VERSION_MESSAGE`）记在 `docs/exec-plan/tech-debt-tracker.md` 的 TD-020，由 #199 重写本片段

# X3 重连期间迟到的基线覆盖较新的修订（第 4 行失败列；#218）
node --input-type=module -e "
import { StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { StatusPolicyMode, composeCore } from '@harness-projects/core'
import { createController } from '@harness-projects/controller'
import { createEntityStore, createSync, createTransport } from '@harness-projects/client'
import { createFakeProviders } from '@harness-projects/provider-fake'
const providers = createFakeProviders(); const workspaceId = newWorkspaceId()
const core = await composeCore({ workspace: { id: workspaceId, name: 'probe', statusPolicy: StatusPolicy.HostAuthoritative }, providers })
const controller = createController(core, { authority: StatusPolicyMode.HarnessManaged, workspaceRevision: () => providers.storage.currentRevision(workspaceId) })
const real = createTransport(controller); let hold = false; let release
const transport = { ...real, poll: (after) => real.poll(after), fetchBaseline: async () => {
  const snapshot = await real.fetchBaseline(); if (!hold) return snapshot
  hold = false; return new Promise((resolve) => { release = () => resolve(snapshot) }) } }
const store = createEntityStore(); const sync = createSync(transport, store)
await sync.connect()
const target = (await controller.baseline()).entities.find((e) => e.content.contentKind === 'work_item' && !['done', 'blocked'].includes(e.planningStatus))
const before = store.get(target.entityId).entity.planningStatus
hold = true; const late = sync.reconnect(); await new Promise((r) => setTimeout(r, 10))
await controller.commands.applyPlanningStatus({ entityId: target.entityId, status: 'blocked', actorRef: { kind: 'user', id: 'u' }, idempotencyKey: 'x3' })
await sync.poll(); const polled = store.revision + '/' + store.get(target.entityId).entity.planningStatus
release(); await late
const after = store.get(target.entityId).entity.planningStatus
console.log('after poll', polled, '| after late baseline', store.revision, '| status back to pre-write value?', after === before, '| current?', store.isCurrent(target.entityId))
"
# 观察：after poll 2/blocked | after late baseline 1 | status back to pre-write value? true | current? true
```

## 3. 三行判定表

| 范围 | 判定方式 | 通过条件 | 不通过时看到什么 |
|---|---|---|---|
| MVP-0 | `node --test tests/mvp0`（轨道已由切片栈建立，当前 head 上 7 条全绿） | 轨道存在、**摘要行 `ℹ tests` 计数非零**且全部通过，每条用例的通过不依赖人工解释 | 轨道不存在（判定载体缺失）、用例数为 0（空轨假绿），或用例失败并点名尚未实现的链路节点 |
| MVP-1 | 在一个 sandbox 项目上人工走通 §2 步骤表中除第 13 行以外的每一步，其中第 2、3、4、5、9、10、11、12 行换成真实 GitHub | 每一步都出现"可观察结果"列的内容 | 该步的"失败时的可见形态"出现；记录是平台、权限还是环境原因 |
| 首发范围 | 按 [R1 门禁](../architecture/release-gates.md)逐条判定 | 每一条都满足 | 任一条不满足（含"无法判定"）即不具备发布资格 |

> **注（2026-09-29，#217）**：§1 把 MVP-0 定义为"纵向链路每一行都用离线替身跑通"，而本表的机械判定只数 `tests/mvp0` 的节点断言；§2.1 显示这 7 个节点并不对应全部 13 行（第 8、9、13 行与附行没有节点，第 2 行只有组合期断言），所以两者互相不充分。判定命令与通过条件原样保留，是否改写通过条件由人类伙伴裁决。

MVP-0 的通过条件里"计数非零"不是修辞：空目录上的 `node --test` 同样退出 0（摘要行为 `ℹ tests 0`），只写"存在且全部通过"会让空轨假绿。判定命令：

```bash
out=$(node --test tests/mvp0 2>&1) || { echo "FAIL：非零退出"; exit 1; }
printf '%s\n' "$out" | sed -n 's/^ℹ tests \([0-9][0-9]*\)$/\1/p'
# 判定：退出码为 0，且上面打印的 tests 计数非零；打印 0 或没有输出都表示空轨，不算通过
```

这条与 [release-gates.md](../architecture/release-gates.md) §2.2 对 R1 第 5 条的要求同源：任何"目录存在即绿"的表述都必须加上"用例数非零"。

MVP-0 与 MVP-1 的分界只有 provider：链路语义、步骤表与失败形态不变。若换成真实平台需要改写 §2 的步骤表，那是能力契约的设计缺陷，应回到契约层修，而不是修改本表来迁就实现。

## 4. MVP-0 的非目标

MVP-0 的判定只覆盖 §2 的链路，**不**覆盖下表内容。任意一条出现都不算 MVP-0 失败，但也不能据 MVP-0 全绿声称它已被覆盖。

| 非目标 | 说明 |
|---|---|
| 真实平台 provider | GitHub Projects / Git / GitHub / Actions 等真实提供方；MVP-0 全部使用离线替身 |
| SQLite 业务表 | 迁移运行器属于交付物，但业务表受 Gate E1 约束，MVP-0 不落库 |
| UI 页面 | 判定只到 controller / client 模型，没有产品页面 |
| 规划视图 | Backlog / Sprint / Kanban / Roadmap 等规划视图 |
| Analytics | 度量、统计与报表 |
| 跨工作区全局工作项聚合 | 工作区之间不聚合工作项；每个工作区各看各的 |
| LLM 控制路径 | 任何由 LLM 参与的状态或关系控制路径都不属于 MVP-0 |
| 多规划事实源 | 一个工作区同一时刻仍然只有一个 Planning 事实源 |

把非目标写清楚是承重的：没有这张表，"MVP-0 全绿"会被误读成"MVP 做完了"。范围分级的其余部分（V1 与后续版本）仍待补齐，补齐前以本表与 `AGENTS.md` §1 为准。
