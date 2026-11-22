# PR #671 MMP 交付评审

## 锁定事实

- 日期：2026-11-22。
- PR：#671；base：`main` / `f74a3b8b211f674247d330a7f9fc6afa0b397155`；head：`d22f76c6c2084fb7e1511f56b6d2cab83c68dfaa`。
- 执行上下文：`.worktrees/worktree-clean-removal`。本轮只写本评审文档与临时探针；不改生产代码或既有测试，不 commit/push，不提交 GitHub review。
- 事实源：PR、issue #138、reviews、inline comments 的协调者快照；本地 immutable head、相关 ExecPlan、ADR-0007、当前源码与真实 Git 探针。reviews 与 inline comments 均为空。
- 快照真实 checks：`PR Fast Gate`、Verify、Browser、Windows Native 等执行 lane 成功；`Create review session` 失败，另一次工程状态 reconcile 取消但有后继成功；快照 `mergeStateStatus=UNSTABLE`。不把 PR 正文的旧 `CLEAN / 12/12` 当当前聚合状态。
- 本轮采用 Qian Systems Router、First Principles Development 与 Superpowers 的证据优先评审/验证方法。主要不变量：只在显式请求下删除允许根内、仍匹配登记与分支身份的干净工作树；失败与成功都必须诚实表达实际副作用。

## 预建风险矩阵

本矩阵在读取 diff 前已建立，以下回填结果。

| 等级 | 代码 / 反例 | 产品与 issue 验收 | 架构 / 事实所有权 | 测试与设计成本 |
|---|---|---|---|---|
| P0 | 未发现无条件越界删除或破坏 main | 未发现无条件不可恢复损失 | 七条系统不变量无新增跨层破坏 | 未修改共享契约或禁用守卫 |
| P1 | R671-01 根内祖先被替换后删除根外目录；R671-02 检查后 detached 的独有提交失去引用 | 初始 clean 正常闭环成立，破坏性并发边界未兑现 | Git 的 dirty 防线不同时证明路径和分支身份稳定 | 现有测试与 8 个已杀死变异均未暴露这两条真实竞态 |
| P2 | R671-03 真实权限失败发生部分删除与登记消失，却返回普通权限错误 | 后续调用只剩 not_found，恢复语义失真 | 写后观测只覆盖 code=0 | R671-04 决策来源误写成人类批准；Windows 新移除组未原生执行 |
| P3 | 未另列纯风格建议 | provider-only 与相对 externalId 均为明确范围/设计选择 | 未新增依赖、缓存或第二权威源 | 无净收益拆分或加测试建议 |

## 全部 actionable findings

### R671-01 · P1 · 在稳定的允许根对象上执行删除

- 新增行：`packages/providers/development-local-git/src/provider.ts:326`（路径在 298–300 行准入后，经过多次 await，最终仍以字符串交给 Git）。
- 真实反例：在自建临时 fixture 创建 `allowed/container/wt`，`allowedRoot=allowed`，初始所有门均通过。runner 收到 remove argv、尚未执行真实 Git 时，将 `allowed/container` rename 为允许根外的 sibling，再在原位置创建指向 sibling 的 symlink。**允许根本身保持不动**。随后原样调用真实 `defaultGitRunner(args)`。
- 观测：provider 返回 `ok:true`，根外 sibling 下的原工作树目录消失，Git 登记消失。没有 force、没有伪造 Git 成功；Git 自身不重做本 provider 的允许根证明。
- 影响：接受时的 realpath 不是删除时的作用对象，新增破坏性方法能删除当前允许根之外的目录。写后回读发现“已删”无法撤销越界删除。
- 方向：采用能够把准入对象绑定到删除操作的稳定目录/句柄或安全隔离机制；若当前可移植实现无法提供该保证，先明确且可验证地限制/关闭这类并发环境，再由设计所有者裁决。仅再加一次 lstat/realpath 仍留下同类窗口，不构成修复。
- 重复核对：#340 是静态 symlinked checkout 的准入问题，#341 是旧 Ready 句柄恢复；均不覆盖此新增删除窗口。旧创建计划 D19 只接受 `worktree add` 的 TOCTOU，并未接受根外删除。当前 #671 的 I2/I3、port 注释和 PR 正文承诺更强。

### R671-02 · P1 · 将 detached 保护延伸到真实删除边界

- 新增行：`packages/providers/development-local-git/src/provider.ts:315–316`（检查结果在 326 行删除前已可失效）。
- 真实反例：初始工作树为附着分支且 clean；完成 status 后，在执行 remove 前运行真实 `git checkout --detach` 与一条独有的空提交，然后执行真实、不带 force 的 remove argv。
- 观测：provider 返回 `ok:true`，目录和登记消失；`git branch --contains <detached-commit>` 为空。Git 允许删除 clean detached 工作树，因此 dirty 二次保护不能承担这里的身份保证。
- 影响：本 PR 特意拒绝 detached 以保护未被分支引用的工作，实际仍可删除刚进入此形态的工作树；HEAD/reflog 随登记消失，独有提交只剩对象恢复机会。
- 方向：需要能覆盖 Git 身份变更与删除的协调/稳定性边界，或收窄并显式裁决并发支持范围；仅重复 symbolic-HEAD 探针不能消除竞争。补一条真实状态切换回归，不能只注入 Git 拒绝文案。
- 重复核对：全库 issue 搜索 `detached`、`race worktree` 未找到同一缺陷。历史 D19 的创建窗口与此次独有提交的删除风险不同。

### R671-03 · P2 · 不要把部分删除归为普通权限拒绝

- 新增行：`packages/providers/development-local-git/src/provider.ts:327`。
- 无并发的真实反例：提交 `a-user-file.txt` 和 `z-read-only/user-file.txt`，把 `z-read-only` chmod 为 `0555`；`git status --porcelain` 为空，所有 provider 前置门通过。
- 观测：真实 Git 报 `failed to delete ...: Permission denied`；provider 通过通用 `failureOf` 返回 `permission_denied / retryable:false`。此时 `a-user-file.txt` 已删除，`z-read-only/user-file.txt` 与 `.git` 仍在，`git worktree list` 已无目标登记。它不是“确定没做任何事”的权限拒绝，普通重试会在登记门得到 not_found。
- 影响：破坏性失败的残留与恢复要求被误分类；当前成功路径的回读完全不覆盖这种 code 非零但已经生效的写入。
- 方向：对 remove 的非零结果区分可证明的写前拒绝与可能部分生效的失败；后者使用 `ambiguous_result` 并要求对账/人工恢复，必要时回读登记与目录。不要原样复用创建/读取的通用权限分类。增加真实权限反例与残留断言。
- 重复核对：#174 仅追踪分页与 paths.ts 非 ENOENT 读取测试，未覆盖递归删除的部分成功；`worktree permission`、`partial remove` 搜索未找到相同 issue。

### R671-04 · P2 · 如实记录协调者决策来源

- 新增行：`docs/exec-plan/completed/2026-11-21-worktree-clean-removal.md:414–419`；同类表述见 521 行。
- 协调者已核对原始会话：人类授权调研后自行判断、存疑才询问，并未逐项点名批准 ignored/provider-only/相对路径决定。D13 却把 Lead 转达写成“人类伙伴批准的 5 项裁决”，剩余风险又据此称“已由人类伙伴批准”。
- 影响：实现选择的真实来源被升级为人类明确风险接受，后续评审/发布会误读批准链。
- 方向：改为协调者在已授权范围内作出的设计决定，保留可核对的授权原话与实际来源。此项不意味着重复请求批准，也不单独推翻 provider-only 或 Git-clean 选择。

## 分层审查与验证

### 产品、架构与工作项

- #138 原始 AC 三条与当前 provider-only forecast 一致：dirty 拒绝且逐字节不变、clean 仅显式移除、越界在任何 Git 命令前拒绝。正常稳定输入的三条验证通过；没有 core/controller/UI 调用点，不宣称已有用户入口。
- 能力默认声明、flag 关闭与 foreign-binding 优先级受真实集成和共享契约覆盖；共享套件在 local-git 能力形态执行真移除、集合新鲜性、二次 not_found。未削弱 suite/fake/坏 adapter。
- Git 登记/磁盘仍为唯一权威；无 storage 写入，无规划 Status 写入，无新的跨层依赖。main、未登记、prunable、独立仓库、初始 detached、locked、根外、悬空链接、含父分量等稳定拒绝路径均被覆盖。
- ignored-only 的删除是显式写明的 Git-clean 设计，不作为暗中新引入缺陷；其决策来源按 R671-04 更正。相对 externalId 仍规范化、落根、登记与身份校验，不单列为越权缺陷。
- 历史 #340/#341/#174 不作为本 PR 新缺陷；#211/#212 在当前 GitHub 已关闭，旧计划的历史引用不证明它们现在仍 open。

### 本轮真实命令

| 命令 / 探针 | 输出 |
|---|---|
| `node --test tests/integration/development-local-git.test.js tests/contract/development-local-git-source.test.js tests/e2e/repository-routing.test.js` | 111 tests / 111 pass / 0 fail / 0 skip |
| `node --test tests/contract/development-contract.test.js` | 96 tests / 96 pass / 0 fail / 0 skip |
| `git diff --check f74a3b8b211f674247d330a7f9fc6afa0b397155...HEAD` | exit 0，无输出 |
| 跨 core/controller/client/ui-model/ui/apps 搜索 `.removeWorktree(` | 无调用点，exit 1 |
| `pr671-probes-descendant.mjs` | dirty-after-check 真实拒绝；detached-after-check 与 descendant-symlink-after-check 均真实删除且 ok |
| `pr671-partial-delete.mjs` | clean + 0555 目录触发真实部分删除/登记消失/permission_denied |
| `pr671-errors.mjs` | 6/6 断言通过：status 失败/中断均零 remove；真实删除后中断与未知写失败均 ambiguous；只留目录亦 ambiguous；真实 submodule 为 invalid_input 且树/登记保留 |

全部真实删除发生在自建临时 fixture；临时探针与日志由协调者留存，不作为仓库运行态内容提交。脚本 basename 供同批证据定位；复现步骤已写在每条 finding，仓库文档不记本机绝对路径。

### 变异判别力

使用 immutable head 的独立临时 archive 副本，重建副本内 workspace 包链接；未变异实际工作树。执行
`node scripts/review-mutate.mjs <temporary-root>/pr671-spec.json --root <temporary-root>`，测试命令为
`node --test --test-name-pattern=工作树移除|能力子集 tests/integration/development-local-git.test.js`。
初次 3 个歧义锚点产生 NOT_APPLIED 后加长锚点；**最终整表重测 exit 0，8/8 KILLED，均有 killedBy 归因**。

| 变异 | killedBy |
|---|---|
| 删 dirty gate | 脏工作树被拒且逐字节不变 |
| 去掉 untracked override | 脏工作树被拒且逐字节不变 |
| 加 force | 干净工作树仅显式移除 |
| 删正面身份拒绝 | 未登记、主检出、被换成独立仓库与 detached |
| 跳过写后回读 | 写命令返回成功但回读不一致 |
| 删能力 gate | 能力关闭时快照不出现该键 |
| 跳过 prunable gate | 登记在册但目录已删 |
| 准入前发 Git 命令 | 越界、含 .. 与符号链接逃逸 |

最终确认实际 provider 字节仍等于锁定 head，临时变异副本亦逐字节还原。变异证明既有断言有判别力，不证明 R671-01/02/03 已被覆盖。

### 证据边界

- 本轮没有复跑全量 verify；聚焦 207 个测试与破坏性强反例足以形成当前 findings。CI 快照成功不消除这些反例。
- `scripts/windows-native-checks.mjs` 的 native-git SETS 不含新增移除用例组；Windows lane 通过不能作为本能力的原生删除证明。本轮平台为 darwin，未伪造 Windows 实测，不单列未观察到的 Windows 代码缺陷。
- `Create review session` 属已有 #364 可选 webhook 故障；工程 reconcile 有同 head 后继成功，不作为本 PR 行为阻塞项。

## 结论与收尾

当前 head 建议 `REQUEST_CHANGES`：2 条 P1 删除边界问题、1 条 P2 失败恢复问题、1 条 P2 决策来源问题。提交评审与 owner 交接由协调者一次性执行。本子评审不提交外部 review、不改实现、不合并；修复后必须锁定新 head，按受影响反例与契约重新评审。


## 候选技术核对 · 2026-11-22

候选 `16defe1de876e56c0e746f46284929d7c82d4e3f`，base `4907adaaae126a8063ba62b1110b6afcd97db74b`；固定提交隔离检出验证，未改实现或既有测试。完整集成 93/93、boundaries 10/10、typecheck exit 0；对象锚使用 bigint dev/ino，无精度截断。

新增 P2（初审失败分类同根）：`worktree repair` 实际已把登记写到隔离目录后，若确认丢失/进程中断，目录回滚并不等于登记回滚。当前非零分支返回 invalid_input，实际原目录仍在、登记仍指已消失的隔离名，二次调用 not_found。必须对无法证明零写入的 repair 失败返回 ambiguous_result 与恢复指引，或反向 repair 并回读确认再确定分类。真实 Git repair 后丢确认的临时回归已复现。

普通 Git 身份并发已增加 files 后端 HEAD 锁，reftable 显式拒绝；部分删除已转 ambiguous。修复还明确保留非协作替换隔离目录、Git 版本与 Windows 原生证据边界，不能把边界声明冒充原子保证或人类风险接受。最终 MMP 结论需在发布 head 上核对剩余错误分类与支持边界；本段不构成最终 APPROVE。


## repair 修复的独立核对 · 2026-11-22

锁定 head `ef7e84d8a1fbfbb842344c270981c95b7d2d5dcc`，base `4907adaaae126a8063ba62b1110b6afcd97db74b`，隔离检出 `.worktrees/review-671-candidate`；provider blob `1299a5dcfd13951f14f96871f134097a8581eb17`。

- 本评审方的真实 repair 成功后丢确认反例已转绿：目录回滚后完成反向 repair，回读登记只指原目标，答 `invalid_input` 并说明确认依据，下一次显式调用可成功。
- 反向 repair 同样失败时答 `ambiguous_result / retryable=false`；报告原目标、隔离路径、实际登记和恢复命令。真实登记仍指隔离名而原内容仍在，未伪称整体已恢复。
- 新增 T5 回归及全部 local-git 集成 **94/94**，typecheck exit 0，boundaries **10/10**，diff-check 通过。复评者未改实现或既有测试。R671-03 的 repair 追加问题在此候选技术关闭。
- 本段只确认锁定候选；最终远端 head、支持范围文案、issue 验收、全部线程及同 head checks 仍待收尾，不把 Windows 既有 lane 或文档化限制写成新增流程的原生证据。


## 支持范围与工作项收尾判定 · 2026-11-22

独立产品范围核对基于 `ef7e84d8`：#138 原 AC 是 provider-only 显式 clean 移除、脏树逐字节保留与越根先于 Git 拒绝；未要求原生原子删除、core/UI 入口或全平台验收。原技术 P1 关闭后，不能仅由 AI 提出的 H1/H4 文案再建立人类批准门。

- H1 的非协作进程替换隔离目录、直接改 `.git` 或内容/索引并发属于本实现未承诺的支持边界；诚实 `ambiguous_result` 不等于能防止数据损失。不得宣传为原子安全删除或全并发安全。
- H4 为 P2 资格证据缺口：新增锁/隔离/repair 只在 darwin 实测；Windows、老 Git 移除未原生证明，reftable 只证明 fail-closed 拒绝。适用条件、Git ≥2.30/files 后端与崩溃恢复须在 PR 描述明确。
- 本批收尾采用 **Refs #138，保持 OPEN**，保留现有验收与剩余资格核对，不另建重复 issue。#660 可承接 Windows lane 扩展但当前 AC 未点名该协议；#459 是总体风险审计，#665 是另一 Host 数据窗口，均不能冒充此处已有具体修复 owner。
- D25/H1–H5 应区分 AI 提出的限制、待验证项和正式 R1 人类判定；本轮只可批准已验证的 provider 子闭环，无自动移除或产品入口，不以合并推导发布接受。


## 当前发布 CI 的 Linux 测试差异 · 2026-11-22

发布 head `95962b2f39e2ca70f3ac5adef9e1137adef16481`，Verify job `137091156185`（run `44984224300`）真实失败：部分删除用例在 `tests/integration/development-local-git.test.js:475` 对隔离目录 `.git` 做 stat 得到 ENOENT。Linux/Git 2.56.1 的部分删除结果不保证 gitfile 残留；此前 ambiguous_result、retryable=false、隔离路径、分支与恢复消息断言均通过。本故障是 P2 测试平台假设，不据此断言生产删除协议错误；最终必需门仍不得放过。

修复须保留真实只读目录故障、用户文件内容/残留、登记与原路径状态、分支头保留和二次调用拒绝等承重断言，去掉 `.git` 必须残留的非契约假设；不 skip 平台、不替换为 mock。修复后独立核对测试 diff，并在当前发布 head 取得 Verify/PR Fast Gate 通过，才可最终 APPROVE。

测试口径修正的独立复核通过：删除 gitfile 残留假设合理，受保护用户文件改为内容相等更强；未改变失败分类、登记、分支与重试证据。本地完整 local-git 集成 94/94、fail 0。旧 Linux CI 在 `.git` 断言提前失败，后续断言的 Linux 证据仍需最终发布 head 的 Verify 回读，不能用本地通过代替。
