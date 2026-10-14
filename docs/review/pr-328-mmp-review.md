# PR #328 MMP 交付评审

评审对象：PR #328，immutable head `910312ae445d55af0bfedd06b845049e20aa5b07`，base `main@7c7e77ccc770b77f8c1cc7d3d6827ac6d854bc60`。评审日期：2026-10-14（第二轮）。评审账号：Singularity-AI-Bot。

## 锁定事实

| 项 | 当前事实 |
|---|---|
| 状态 | OPEN，非 draft，MERGEABLE，mergeStateStatus=UNSTABLE |
| UNSTABLE 原因 | 本 head 上两次 `Reconcile engineering state`（`38522189894`、`38522205350`）均被全局并发组取消，由全域重算 `38522233783` 取代（success，changed=0）；Issue policy `38522192422`、Rule checks `38522192629`（含 `matrix.check`）被取消，后继 `38522204769`、`38522204755` 成功。PR Fast Gate 成功（CI `38522192503`），不阻塞 |
| commits | `86c9af07` docs(exec-plan)（Refs #214）→ `910312ae` fix(core)（Closes #214） |
| linkage | native closingIssuesReferences=[#214] |
| 既有批准 | APPROVED 提交于 2026-10-13T16:09Z、针对 `6c7f526d`；当前 head 的 tree 与之不同（整合删除了 `worktreePathFor`），视为当前 head 没有批准 |
| threads | 2 条，已 resolve；本轮按原条件复跑 |
| 规模 | 代码 354 / 文档 193 |
| 整合改动 | `git diff 6c7f526d 910312ae`：`git-provisioning.ts` 删 3 行（`worktreePathFor`），ExecPlan 加 3 行；`6c7f526d` 上该 helper 只剩定义、无调用方，删除成立，未丢测试或断言 |

## 并集预演

四个开放 PR 在 `main@7c7e77cc` 上按两种顺序合并，唯一冲突是 `docs/README.md` Active 索引 add/add 行；并集 `pnpm verify` 1542 + MVP-0 7 全过。`packages/capabilities/src/registry.ts` 与 #330 改不同的类型锁（DevelopmentProviderSurface / StorageSurface），语义独立；core 的 `PORT_METHODS` 只有本 PR 修改。

## P0–P3 风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 未见：依赖方向不变，Git 仍走 argv | 未见：上一轮两条 P1 已修 | 默认根取「向上第一个 `.git` 标记」的兄弟目录：submodule / 嵌套仓库时落进外层检出（超项目 status 出现 `?? sub.worktrees/`，base 干净） | 默认根缓存会固化仓库暂时缺席时推导的错误根；为符号链接检出做的 realpath 实际不可达、拒绝消息与事实相反；路由失败时 `attemptedValue` 为空（上一轮 P2，未修未回复） |
| 产品闭环 | 未见 | **#214 验收 4 与人类批准条件未交付**：验收 4 要求迁移说明；人类 2026-09-29 批准附条件「the pull request should state how to remove them by hand」。树中没有 ExecPlan 所说的「迁移手册」，PR 正文只写「通过显式注入旧根继续可用」，而当前没有宿主构造 Local Git provider（#132），该路径在产品上不可达 | 同代码层 submodule 落点 | bare 仓库与找不到 `.git` 标记的布局在默认配置下由「能建」变为 fail closed，未写进文档 |
| 架构 | 未见：七条不变量、依赖方向不变 | 未见 | 新端口方法 `preflightWorktree` 不在共享 Development 契约套件；「预检路径 = 创建路径」的义务未写进契约 | TD-005 的触发条件已满足，跟踪器描述仍点名已删除的 `worktreePathFor` |
| 测试 | — | — | 持久化句柄重放、conflict 读回、ambiguous 读回的 canonical target 无判别测试（M6、M9、M10 存活）；验收 7「未观察骨架不传播旧路径」无断言（M7 全量存活） | — |
| 工作项 | 未见（disclosure 干净） | 同产品闭环 | 上一轮「Batch 4 变异无可复核 spec」仍未处理 | ExecPlan 被推翻的方案未就地标注 Superseded、易失数值过时；#214 Scope 第 3 条（重述 #137 验收 1 与 AGENTS §7）未处理也未说明；提交正文是「做了什么」而非「为什么」 |

## 分层检查

- **路径安全**：叶子符号链接检出、默认根本身为符号链接均 fail closed；超项目跟踪 `sub.worktrees -> sub` 的变体被祖先悬空链接判定拒绝。
- **升级路径**：旧默认写过的 `/.worktrees/` 仍在 `info/exclude`，升级后主检出 status 与 `add -A` 干净；head 不再改 exclude。
- **旧句柄**：默认配置下 `getWorktree` 与预检对旧 `<repo>/.worktrees` 句柄报 `invalid_input`（逃出允许根），只有显式注入旧 `allowedRoot` 才可读回，而注入方 #132 尚未交付。
- **默认根推导**：`allowedRootForUse` 从 `repository.path` 向上找第一个存在 `.git` 的目录，取其 realpath 的兄弟 `<name>.worktrees`。submodule 的 `.git` 是 gitfile，因此根落在超项目检出内；嵌在另一检出里的 bare 仓库借用外层检出。

## 上一轮意见复核（第一轮 head `43bbc4dd`）

| 意见 | 结论 | 证据 |
|---|---|---|
| P1 恢复预检沿用已决定的分支 | 成立（已修） | 原反例在 head 通过，M1 被其杀死；变体 V1（自定义分支、工作树落盘后抛错、换 key 省略 branchName 重试）两次预检都收到已决定分支，Ready，M1v 被 V1 杀死 |
| P1 canonical target 传给 createWorktree | 代码已修，回归只覆盖一半 | 创建路径 M2 被杀；变体 V2（create 落盘后报 ambiguous_result）只读 canonical A；但 M9（ambiguous 读回）、M10（conflict 读回）存活，转为 P2 测试缺口 |
| P2 路由失败 `attemptedValue` 为空 | 未修 | head 输出 `{"ok":false,"phase":"failed","code":"not_supported"}`，base 带 `attemptedValue`；所在行未改动，列为 PR 级 P3 |
| P2 integration README 描述旧补偿 | 已修 | README 已对齐 checkout 外 sibling root |
| P2 Batch 4 变异无可复核 spec | 未修 | 计划与 PR 均无变异记录，「重算旧句柄」恰好存活（M6） |

## 变异表（当前 head，`scripts/review-mutate.mjs`）

| id | 位置 | 结论 | killedBy |
|---|---|---|---|
| M1 预检退回 `names.branch` | `git-provisioning.ts` | KILLED | 恢复预检必须使用已持久化的分支身份 |
| M2 create 不用 canonical | `git-provisioning.ts` | KILLED | 预检返回的 canonical target 必须原样传给 createWorktree |
| M3 忽略预检失败 | `git-provisioning.ts` | KILLED | core 在目标预检失败时不得先创建孤立分支 |
| M4 默认根回到检出内 | `provider.ts` | KILLED | 默认工作树根在 checkout 外 |
| M5 按子目录派生 | `provider.ts` | KILLED | 默认根按真实 checkout 根派生 |
| M8 恢复 info/exclude 写入 | `provider.ts` | KILLED | 默认工作树根在 checkout 外；显式旧根仍可注入 |
| M6 重放不用持久化句柄 | `git-provisioning.ts` | SURVIVED（聚焦与全量） | — |
| M7 骨架恢复 `.worktrees/` | `chain-facts.ts` | SURVIVED（全量） | — |
| M9 ambiguous 读回去掉 target | `git-provisioning.ts` | SURVIVED | — |
| M10 conflict 读回去掉 target | `git-provisioning.ts` | SURVIVED | — |
| M1v / M2v / M6v / M10v | 同上 | KILLED | 评审变体 V1 / V2 / V3 / V1 |

`paths.ts` 的 `symlinked_root` 判定删除后在 base 与 head 上都存活，属既有缺口，不计入本 PR。

## 意见清单（inline 9 条 + PR 级）

- P1 ExecPlan:172 验收 4 与人类批准条件未交付。
- P2 × 4：`provider.ts:339` submodule / 嵌套仓库落点；`git-provisioning.ts:130` 三处恢复 / 对账分支无判别回归；`development-provider.ts:100` 新端口方法不在共享契约；`chain-facts.ts:233` 验收 7 无断言。
- P3 × 4：默认根缓存；符号链接检出的 realpath 不可达；TD-005；ExecPlan 记录。
- PR 级 P3：`attemptedValue` 为空；#214 Scope 第 3 条；bare / 无 `.git` 标记布局的行为变化未成文；提交正文。

## 结论

**REQUEST_CHANGES**：一条 P1（工作项 / 产品闭环层），代码层两条旧 P1 已修。修复代价小：补一份可执行的手工移除 / 迁移说明（`git worktree list --porcelain` 列出旧工作树、`git worktree remove` 或 `move` 的人工步骤与回读），在 ExecPlan 验收表补验收 4 一行，PR 正文写明手工移除方式并收回「显式注入旧根继续可用」在产品上的可达性表述。

## 后续 owner 与复审条件

- 作者为 Codex 会话，本机无 Claude 作者会话；修复 owner 需人类伙伴指定。
- 复审：重锁 head / base / checks / threads；按原条件核对验收 4 与人类条件；对新增测试复测 M6、M7、M9、M10；独立复评修复本身。

## 提交回读

2026-10-14 由 Singularity-AI-Bot 一次性提交 review `5514309090`（REQUEST_CHANGES，inline 9 条，commit_id 为本记录锁定的 head）；回读 inline 数一致。提交后 mergeStateStatus=BLOCKED，原因是分支保护要求所有对话已解决。

## 修复与复评（2026-10-14）

- **owner**：人类伙伴在本会话指定「本会话负责」修复与收尾（问「四个 PR 的修复与收尾由谁负责？」，答「本会话负责（推荐）」）。
- **第一轮修复**：P1——ExecPlan 写出可执行的旧默认工作树手工移除说明（每条命令在临时仓库实跑），验收表补验收 4，「显式注入旧根继续可用」等不可达表述就地标 Superseded；P2——默认根只为独立检出派生，嵌套 / submodule / bare 默认 fail closed；持久化句柄重放、conflict / ambiguous 读回的 canonical target 有判别回归；`preflightWorktree` 进入共享 Development 契约套件；验收 7 补断言；P3——路由失败保留 `attemptedValue`、TD-005 跟踪器、Superseded 标注、检出内旧根符号链接判定的看护（main 上原本无用例）。
- **第一轮修复的独立复评**（head `a7740743`）：无 P0 / P1；新 P2 × 3（嵌套判据过宽且消息误标、第 1 步按位置选工作树、「移动后复用」对已开始工作项不成立）与 P3 × 4。
- **主控取舍**（本会话 owner，写入 ExecPlan Decision Log）：默认配置下嵌套 / submodule / bare fail closed 的方向保留——#132 验收已要求宿主注入检出外的允许根，产品路径不依赖默认推导；fail closed 符合 2026-09-29 人类批准里「never leaves artefacts inside the user's repository」。
- **第二轮修复**：外层标记按 Git 口径校验（目录须含 HEAD、objects、refs，文件须以 `gitdir:` 开头）、拒绝消息改为「位于另一个 Git 检出之内」、取消默认根缓存；手工移除第 1 步按 `work/` 分支选择并覆盖子目录配置；「已开始工作项」一段改为实测事实（停在 Ready + `result_unknown`，无产品内恢复路径，转 #341）；submodule 工作树需单个 `--force`；代码块去掉行尾注释。
- **第二轮修复的增量复评**（head `d9c6cf62`）：无新的 P0 / P1 / P2，整表 26/26 KILLED，四方对照与零 Git argv 成立；新 P3 × 1（子目录配置下第 5、6 步与文字不符），已在 `160c80fd` 订正并在 bash 与 `zsh -f -i` 下按文档原样各跑四个夹具。
- **跟进**：#340（符号链接检出按 canonical 检出判定）、#341（旧根句柄让 Ready 上下文无路可走）。
