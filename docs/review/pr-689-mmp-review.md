# PR #689 MMP 独立对抗验收（#679）

> 评审角色：独立对抗 reviewer（非实现者、未参与本分支实现）
> 评审时间：2026-11-24
> 评审对象：PR #689 / issue #679（`test(ci): verify Windows volume refusal on real filesystem fixtures`）
> 首审结论：**APPROVE WITH NOTES**（无 P0/P1；P2 × 1、P3 × 6；不阻塞合并）
> 修复复评结论（§6，head `50ed6a76`）：**可置 ready**。P3-1/P3-2/P3-3/P3-4/P3-6 已修复；P2-1 由 Lead 回填 PR body；修复轮新增 **P2-2**（ExecPlan 被截断，缺 `Bottom Change Note` 与 Not-proven 列表）建议回填后 ready，若接受为 notes 也可 ready。

## 1. 锁定事实

在检出 `test/native-volume-refusal-20261124` 的 worktree `.worktrees/iteration12-native-volume-refusal/` 根目录运行；`gh` 均带 `-R SingularityKChen/harness-projects`。

| 项 | 值（2026-11-24 观察） |
|---|---|
| PR | #689，base `main`，draft=`true`，mergeable=`MERGEABLE`，mergeStateStatus=`BLOCKED`（draft + 待批准） |
| 实现 head（评审基线） | `f5a3e42bd265d4c507706ca1e50ee393f02439b6` |
| 评审记录提交 | docs-only 提交（本文件 + `docs/review/README.md` 索引行；不含任何实现内容）。其 SHA 随记录修订变化，故不写死；实现内容基线固定为 `f5a3e42b` |
| 本地/远端 | 评审记录提交后 `git rev-parse HEAD` = `git ls-remote origin refs/heads/test/native-volume-refusal-20261124`（一致）；实现 head `f5a3e42b` 的 PR run `45407903898` 与评审记录提交的 PR run 均全绿 |
| 任务书 head | 任务书写 `5902d925`；评审期间分支前进一个 **docs-only** 提交 `5902d925..f5a3e42b`（`git log --oneline 5902d925..f5a3e42b` 只有 `f5a3e42b`；`git diff --name-only 5902d925..f5a3e42b` 只列 ExecPlan，未改 `tests/`、`.github/`、`scripts/`），代码/测试/YAML 内容与 `5902d925` 逐字节一致。评审基线已重锁到 `f5a3e42b` |
| 写集 | **9 文件**（任务书写的“8 文件”是笔误；ExecPlan `Global Constraints` 声明的正是这 9 个）：`.github/workflows/ci.yml`、`scripts/windows-native-checks.mjs`、`tests/contract/ci-windows-workflow.test.js`、`tests/contract/windows-volume-fixture.test.js`（新）、`tests/fixtures/windows-volume-fixture.js`（新）、`tests/integration/harness-plugin-windows-volume.test.js`（新）、`docs/development/ci.md`、`docs/README.md`、`docs/exec-plan/active/2026-11-24-native-volume-refusal.md` |
| 产品/ABI/schema | 无 `apps/**`、`packages/**`、Host ABI、错误面、schema 改动（`git diff --stat main...HEAD` 复核） |
| 规模 | `node scripts/rule-checks.mjs size main` → 代码 **493 / 1000**、文档 **272 / 1500**（issue 目标 350–620 技术；未超硬上限） |
| 发布面 | `rule-checks disclosure main` → 机械扫描通过；`git diff --check main...HEAD` → 无输出；`workflow-check.mjs` → `no findings（7 文件）` |
| 本地验证 | `node --test tests/contract/windows-volume-fixture.test.js` → 5/5 pass；`node --test tests/contract/ci-windows-workflow.test.js tests/contract/windows-native-checks.test.js` → 13/13 pass；`pnpm typecheck` → 0；`pnpm run boundaries` → 10/10 pass |
| 全部 checks（`f5a3e42b`） | Analyze×2、Browser、CodeQL、Disclosure、Issue policy、PR Fast Gate、PR size、Reconcile、Resolve PR base、Verify、Windows Native **全部 pass** |
| 评审记录提交的 checks | 同一套 checks 在评审记录提交上重跑：Windows Native 5m10s、PR Fast Gate 3s、Verify 2m30s、Browser 3m13s，**全部 pass**（docs-only 提交不改变实现内容） |

### 1.1 原生证据（`f5a3e42b` 的 PR run `45407903898`）

- runner：`ImageOS=win25-vs2026 ImageVersion=20261116.315.1 Architecture=AMD64`；`node v26.13.1`；`git version 2.56.1.windows.1`。
- 阶段 1：`windows-native-checks: set=native-git files=3 tests=22 skipped=0 todo=0`。
- 阶段 2：`windows-native-checks: set=private-data files=4 tests=83 skipped=0 todo=0`、`standard-user exit=0`。
- 真实设备事实（`t.diagnostic` 回读）：
  - `{"label":"HARNESSFAT","fileSystem":"exFAT","driveType":3,"device":"L:"}` → exFAT 固定卷
  - `{"label":"HARNESSRFS","fileSystem":"ReFS","driveType":3,"device":"M:"}` → ReFS 固定卷
  - `{"kind":"mapped","fileSystem":"NTFS","driveType":4,"device":"N:","providerName":"\\\\runnervmbpeip\\harness-vol-fixture"}` → 回环 SMB 映射盘
- 五条用例全绿：exFAT 卷准入（`volume-identity`）、ReFS 卷文件系统（`volume-filesystem`）、映射盘 DriveType（`binding-drive`）、NTFS 正控被接纳、Host apply 拒绝不发布 authority。
- 同一 head 的 `workflow_dispatch` run `45405917317` 与 PR run 同结论；`45406610662` 亦 success。
- Linux 覆盖保留：Verify 层中该 5 条用例 `# SKIP`，层判定按 `scripts/run-test-layer.mjs:114` 的 `tests - skipped - todo` 聚合，其他用例执行即通过，不因单文件全 skip 变绿/变红。

## 2. 风险矩阵（P0–P3）

判定口径：P0 = 合并即破坏 main/硬约束；P1 = 严重正确性/安全/不变量缺陷；P2 = 不阻塞交付的实质小问题；P3 = 文档/风格/可读性。

### P0 — 无

无。

### P1 — 无

无。产品代码零改动，不存在产品行为回归面；测试判别力经 NC-1/NC-2 与本地变异独立复核（见 §3）。

### P2

- **P2-1（PR 描述“验证”段仍是占位符）** — 位置：PR #689 body `## 验证`。影响：`AGENTS.md` §8 要求 PR 描述包含“真实验证证据”，当前只有“（实现完成后补：……）”的占位文本，发布面上看不到任何实际输出；证据只存在于 ExecPlan。证据：`gh pr view 689 --json body` 原文。修复方向：把本地契约/typecheck/boundaries/size/disclosure 的实际输出与 `45407903898` 的 marker/设备事实行回填进 PR 描述（不新增代码）。

### P3

- **P3-1（ExecPlan 内部自相矛盾）** — `docs/exec-plan/active/2026-11-24-native-volume-refusal.md` “exFAT 无 ACL 语义”段称 AC2 的“protected sentinel bytes and object metadata unchanged”在**两块卷上都用“字节 + 大小 + mtime + 条目集合”**表达；但同文件“3. 零写入”段与实现（`assertDeviceRootUntouched` + `rootListing`）只做**定点检查**（非递归条目 + 声明名不存在 + profile 不存在），没有字节/size/mtime。影响：读者会高估卷侧零写入证据强度。修复方向：把该段改为与“定点检查”一致。
- **P3-2（ExecPlan 验证命令不可复现）** — Validation §10 要求 grep `windows-volume-fixture:` / `windows-volume-refusal:` 前缀；仓库代码与 run 日志中**不存在**这两个前缀（`grep -c` 均为 0），实际输出是 `ℹ {...}` 的 `t.diagnostic`。影响：按文档执行验证命令的人只能看到 marker 与 `standard-user exit=0`，看不到设备事实。修复方向：把 grep 模式改为 `ℹ \\{` 诊断行或直接引用用例名。
- **P3-3（清理失败语义与文档不符）** — ExecPlan Decision Log 称“清理失败只 `::warning::`”，但 `ci.yml` 的 `finally` 用 `-ErrorAction SilentlyContinue`（`Remove-SmbShare`/`Remove-Item`），不产生任何 warning。影响：清理失败在日志中完全静默，与文档承诺的“warning 可见”不一致。修复方向：改为 `Write-Warning` 或订正文档。
- **P3-4（AC2 “sentinel bytes”只部分表达）** — 两块卷上没有预置哨兵文件，零写入由“条目集合不变 + 私有对象名不存在 + 目标 profile 不存在”表达；映射盘共享根初始为空，`snapshotTree` 的“每文件字节 sha256”在空根上是空断言（真正的判别力来自 `assertNoPrivateObjects` 与条目集合比较）。影响：AC2 字面的“sentinel bytes”在新增文件里没有对应物（既有 NTFS 正控/foreign fixture 的哨兵不覆盖新卷）。修复方向：在卷根/共享根预置一个哨兵文件并纳入快照，或显式在文档声明该 AC 由既有 NTFS 证据承担。
- **P3-5（PR 描述未声明 exFAT filesystem 分支不可达）** — ExecPlan 与 `docs/development/ci.md` 都诚实声明“exFAT 的 filesystem 分支被更早的 identity gate 遮蔽、不可单独证伪”，但 PR 描述只写“真实非 NTFS 固定卷”，未点出该分支不可达。影响：只看 PR 描述的人可能误以为 filesystem 分支在 exFAT 上也被证明。修复方向：PR 描述 Not-proven 列表补一句。
- **P3-6（契约测试文件缺尾换行）** — `tests/contract/ci-windows-workflow.test.js` 以 `});` 结尾、无换行（`git diff` 显示 `\ No newline at end of file`）。`git diff --check` 不报错，属风格项。修复方向：补尾换行。

### 已核销的“疑似 hollow”检查（判为**非缺陷**）

- **exFAT 用例不判别 filesystem gate**：这是设计上显式声明的不可证伪面（identity gate 先拒绝），由 ReFS 用例 + NC-1 承担 filesystem 分支判别力，文档与 ExecPlan 均如实声明 → 不是 hollow 伪装。
- **静态契约测试是“存在性钉住”而非行为钉住**：`ci-windows-workflow.test.js` 只断言 YAML 文本片段；`docs/development/ci.md` 已显式写明“不能证明用例体未被改写成空断言”。行为判别力由 hosted 原生用例 + NC 承担 → 可接受。
- **mapped 用例的 `assertTreeUnchanged` 在空根上平凡为真**：但 `assertNoPrivateObjects` 与条目集合比较仍能捕获私有对象/新增条目 → 零写入证明成立（见 P3-4 的表述订正）。

## 3. 判别力与负控（独立复核，不采信实现者摘要）

### 3.1 实现方 hosted 负控（回读 run 与失败行）

| 负控 | run id | scratch head | 结果 | 实际失败行 |
|---|---|---|---|---|
| NC-1 放宽 `host-private-windows.ts:181` 的 NTFS gate 接受 ReFS | `45404618033` | `87b7456` | Windows Native / PR Fast Gate **红**；Verify / Browser **绿** | `AssertionError: 缺少精确拒绝 token private-windows-error-volume-filesystem；observed=["private-windows-error-volume-ancestor"]`；`fail 1`；`standard-user exit=1`；同轮 exFAT 用例仍绿（放宽后仍 `volume-identity`） |
| NC-2 删除两块 VHD 与共享预置 | `45404711047` | `133439f` | Windows Native / PR Fast Gate **红**；Verify / Browser **绿** | `按卷标 HARNESSFAT 发现的候选卷必须恰好一个，实际 0`、`HARNESSRFS … 实际 0`、`net.exe use L: \\runnervmbpeip\harness-vol-fixture` 失败；`fail 4`；`standard-user exit=1`；NTFS 正控仍绿 |

两份 scratch ref 均已删除（`git branch -a` 与 `gh api .../git/refs` 复核不存在），PR head 不含负控提交。

### 3.2 评审方本地变异（scratch 内改 `ci.yml` 后立即还原，`git status` 干净）

| 变异 | 结果 |
|---|---|
| M1 删除 `$stage='volume-fixture'` 与两次 `New-FixtureVolume` 调用 | `ci-windows-workflow.test.js` **RED**：`真实卷 fixture 缺少 volume-fixture`（4 pass / 1 fail） |
| M2 marker `files=4`→`files=3` + 清理目标 `harness-vol-fixture`→`other-share` | **RED**：`private-data 入口必须断言通过 marker（计数从 SETS 推导，入口 fail-open 时退出码仍为 0）` + `真实卷 fixture 缺少 Remove-SmbShare -Name 'harness-vol-fixture'`（3 pass / 2 fail） |

### 3.3 逐 gate 判别力（代码阅读 + 上述证据）

| gate | 位置 | 删除/放宽后新用例如实红？ | 判别来源 |
|---|---|---|---|
| DriveType（`drive`，phase `binding`） | `host-private-windows.ts:224` | 是（映射盘会落到 `volume` 或直接被接纳） | mapped 用例 token 精确为 `binding-drive` |
| 卷 identity（`identity`，phase `volume`） | `:178` | 是（exFAT 会落到 `volume-filesystem`） | exFAT 用例 token 精确为 `volume-identity` |
| 卷 filesystem（`filesystem`，phase `volume`） | `:181` | 是（ReFS 会被接纳） | ReFS 用例 + **NC-1 实测** `volume-ancestor` |

结论：三条 gate 均被组合覆盖，不存在“gate 被删/放宽/后移仍绿”的通道；exFAT 的 filesystem 分支不可达已显式声明，不构成 hollow 伪装。

## 4. AC 映射（issue #679）

| AC | 判定 | 证据 | 缺口 |
|---|---|---|---|
| **AC1** 真实非 NTFS 本地卷 + 真实映射盘在生产 Host/helper 上被拒，且在任何可用端点/私有库/日志写入之前；记录原生卷/盘事实 | **满足** | exFAT `L:` DriveType=3/FileSystem=exFAT、ReFS `M:` DriveType=3/FileSystem=ReFS、mapped `N:` DriveType=4/ProviderName；三个精确 token；`assert.rejects` + 零写入 | 无 |
| **AC2** 固定 NTFS 正控走同一生产路径；拒绝前后哨兵字节/对象元数据不变；fixture 不暴露凭据、不授 broad 主体 | **基本满足** | 同文件 NTFS 正控被接纳；`Get-SmbShareAccess` 断言无 `Everyone/ANONYMOUS LOGON/BUILTIN\Users`；`icacls` 只授临时账户 | 卷侧“sentinel bytes”只以条目/名称表达（P3-4） |
| **AC3** 真实标准用户身份；特权预置隔离；`finally` 有界清理不碰无关盘/共享/profile；不可行时显式 blocked 而非 skip 绿 | **满足** | `ordinaryToken` 自证 `admin:false/adminMember:false`；管理员预置 + 标准用户执行；GUID 名 VHD/共享、空闲盘符预检、定向 detach；provisioning 成功故无 blocked 项 | 无 |
| **AC4** 用例接入 SETS/marker/契约/文档；零 skip/timeout/nonzero/失败传播与 Linux 覆盖保留；记录 current-SHA hosted 结果与有意义的原生失败控制；无固定配额/重复清单 | **满足** | `SETS` 第 4 文件 `minTests:5`；marker `files=4 tests=83 skipped=0 todo=0`；契约 13/13；ci.md 新段；`f5a3e42b` 全绿；NC-1/NC-2；SETS 唯一清单 | PR 描述“验证”段仍占位（P2-1） |
| **AC5** 保留 #660 剩余 gate/probe 可见；不自动关闭 #660/#642/#647/R1，不宣称 Win11 Desktop 资格 | **满足** | PR 描述“合并后关闭 #679；不关闭 #660/#642/#647/R1”；ExecPlan Not-proven 列表；ci.md “不替代 #660 的其余 gate/probe” | exFAT filesystem 分支不可达未写进 PR 描述（P3-5） |

补充：issue 明确“不宣称 network/non-NTFS 存储支持”，PR 描述与 `ci.md` 均以“只证明卷准入与 DriveType 拒绝面”收口，未越界。

## 5. 结论

- **判定：APPROVE WITH NOTES**。无 P0、无 P1，不阻塞合并。
- **P0 = 0，P1 = 0，P2 = 1，P3 = 6**。
- **阻塞项：无**。P2-1（PR 描述“验证”段占位）建议实现方在 `gh pr ready` 前回填；P3-1–P3-6 可合并前顺手修或记入后续，不改变结论。
- **实现方是否需要修复**：需要（仅 P2-1 的 PR 描述回填；P3 建议同批订正文档，不新增产品代码）。
- **不自动关闭**：#660 / #642 / #647 / R1 保持独立；本记录不构成人类评审或 R1 门禁。
- **复评门**：若分支 head 再前进，本记录 §1/§3 的易失值（head、run id、check 列表）须按 `gh pr checks 689` 与 `gh run view <run-id>` 重新回读后更新，不沿用旧 head 结论。

## 6. 修复复评（第二轮：`99c00ebe` → `6093e266` → `50ed6a76`）

> 触发：首审 P3-1/P3-2/P3-3/P3-4/P3-6 的修复轮。复评时间 2026-11-24；只做定点复核，未重做全矩阵。

### 6.1 重锁与范围

| 项 | 值 |
|---|---|
| 当前 head | `50ed6a76c50bd98f63abedb2d97f7b22d7463b07`（本地 = 远端） |
| 相对首审实现 head 的新提交 | `99c00ebe`（AC2 哨兵 + 文档订正）、`6093e266`（补 `path` 导入）、`50ed6a76`（POSIX 契约层导入守卫） |
| 改动的文件 | 仅 `docs/development/ci.md`、ExecPlan、`tests/contract/ci-windows-workflow.test.js`、`tests/contract/windows-volume-fixture.test.js`、`tests/fixtures/windows-volume-fixture.js`、`tests/integration/harness-plugin-windows-volume.test.js`；**无** `.github/workflows/ci.yml`、**无** `scripts/windows-native-checks.mjs`（SETS/marker 未变）、**无** `apps/**`/`packages/**` |
| 口径 | 代码 556 / 1000 行、文档 381 / 1500 行（`rule-checks size main`）；`disclosure` 机械扫描通过 |

修复轮中的一个**中途回归**（已修复，记录在案）：`99c00ebe` 在集成用例里用 `path.join` 但未 `import path`，darwin 上该文件整组 skip 使本地 `pnpm verify` 绿；hosted Windows run `45412965600` 才以 `ReferenceError: path is not defined` 让 3/5 用例红、Windows Native 与 PR Fast Gate 红。`6093e266` 补 import，`50ed6a76` 再加 POSIX 契约层源码守卫。这属于 **修复轮自引入并已自修复** 的 P1，不计入当前 head 的残余缺陷，但说明“Linux skip 面”必须由 hosted lane 兜底。

### 6.2 哨兵断言非空转（AC2）

- **hosted**：run `45414468908`（head `50ed6a76`）全绿，5 条卷/映射盘用例全部 `✔`（exFAT/ReFS/mapped/NTFS 正控/Host apply），marker `set=private-data files=4 tests=83 skipped=0 todo=0`、`standard-user exit=0`。
- **本地变异**（改后立即还原，`git status` 干净）：
  - 删哨兵创建（`writeSentinel` 不写文件）→ 契约测试 `writeSentinel/assertSentinelUnchanged…` **RED**（5 pass / 1 fail）。**KILLED**。
  - 删 `sha256` 比较 → 该契约用例 **SURVIVED**：因为该用例的篡改是 `'tampered'`（8 字节）替换 18 字节原文，size 与 mtime 断言先命中。**这暴露契约用例没有独立覆盖 sha256 分支**（P3-7）。
- **逐断言判别力**（直接在真实 helper 上验证，不依赖用例）：同 size + 同 mtime + 改字节 → 仅报 `哨兵字节必须不变`；改 mtime 不改字节 → 仅报 `哨兵 mtime 必须不变`；删文件 → 仅报 `哨兵文件必须仍然存在`。三个断言各自可失败，不是空转。

### 6.3 导入守卫是否真能抓住“win32-only 未导入标识符”逃逸

- 契约测试新增 `集成用例的 node 内建绑定都已导入（跳过分支的漏导入守卫）`：读集成用例源码，对 `assert/childProcess/fs/path` 四个绑定，若出现 `binding.` 用法则必须存在对应 `import`。
- **变异**：删 `tests/integration/harness-plugin-windows-volume.test.js` 的 `import path from 'node:path'` → 契约测试 **RED**：`AssertionError: 集成用例使用了 path. 但缺少对应 import`。**KILLED**。
- 边界（P3-8）：守卫只覆盖固定的四个绑定；若未来 win32 分支改用 `os`/`crypto` 等而未导入，守卫不会自动捕获，需要人工把它加入列表。

### 6.4 文档订正复核（P3-1/P3-2/P3-3）

- **P3-1**：Design“AC2 的 protected sentinel bytes…”段已改为“拒绝前在两块卷根与映射盘共享根各预置固定字节哨兵（记录 size/mtime/sha256），拒绝后逐项断言不变”，与 `writeSentinel`/`assertSentinelUnchanged` 实现一致；不再声称卷侧做“字节+大小+mtime+条目集合”的递归快照。
- **P3-2**：Validation §10 的 grep 已改为 `marker|standard-user exit=0` + `native …` 用例名 + `ℹ {"label":"HARNESSFAT"…}` 诊断行，并显式写明“测试没有独立日志前缀，事实只以 node test 的 diagnostic 行呈现”；与 run `45414468908` 实际日志一致。
- **P3-3**：Decision Log 以 `Superseded by …` 保留原“清理失败只 `::warning::`”结论，并订正为 `-ErrorAction SilentlyContinue` 静默吞掉；ci.md 同步；与 `ci.yml` 的 `finally` 实现一致。
- **P3-6**：`tests/contract/ci-windows-workflow.test.js` 已补尾换行（diff 不再有 `\ No newline at end of file`）。

### 6.5 新发现（修复轮引入）

- **P2-2（ExecPlan 截断，建议回填后 ready）** — 位置：`6093e266` 把 ExecPlan 的 `## Bottom Change Note` 整节删除，并删掉 Outcomes 第 3–6 条（hosted 证据、与计划的偏差、**Not-proven 边界**、issue 关联）。证据：`grep -n "^## "` 只剩到 `## Outcomes & Retrospective`；全文再无非 `Global Constraints`/`Decision Log` 处的 Not-proven 列表；同文件 `:180` 的 AC5 映射仍写“AC5 → PR 正文与 Outcome 的 Not-proven 列表”，指向已不存在的列表。影响：违反 `PLANS.md` §3/§6 的强制章节要求；AC5 的计划内证据回退到只剩 PR 正文（PR 正文仍保留“Not proven”，故 AC5 对外仍成立）。修复方向：恢复 `## Bottom Change Note` 与 Outcomes 的 Not-proven 列表（无需改代码/测试）。

### 6.6 残余登记

| 级别 | 项 | 状态 |
|---|---|---|
| P2-1 | PR 描述 `## 验证` 仍是占位符 | 由 Lead 回填；工程门禁不受影响 |
| P2-2 | ExecPlan 缺 `Bottom Change Note` 与 Not-proven 列表 | 建议回填后 ready；接受为 notes 也可 ready |
| P3-7 | 契约用例未独立覆盖 sha256 分支（篡改同时改 size/mtime）；helper 的 sha256 已用同 size+同 mtime 篡改直接验证有效 | 记录不修，或补一条同 size+保 mtime 的用例 |
| P3-8 | 导入守卫只覆盖固定四绑定（assert/childProcess/fs/path），未来新绑定不自动捕获 | 记录不修 |

首审 P3-1/P3-2/P3-3/P3-4/P3-6 关闭；P3-5（PR 描述未声明 exFAT filesystem 分支不可达）仍随 P2-1 由 Lead 在 PR body 回填。

### 6.7 结论

- 当前 head `50ed6a76` 的 PR run `45414468908` 全绿（Windows Native 4m10s、PR Fast Gate 2s），marker `files=4 tests=83 skipped=0`、`standard-user exit=0`，AC2 哨兵证据已落到真实设备并被 host lane 执行。
- 无 P0/P1；无越界；**可置 ready**。建议先回填 P2-2（ExecPlan 截断）后 ready；P2-1 由 Lead 回填。


## 7. 2026-11-25 当前 head 独立 MMP 复审

### 7.1 锁定事实

- 对象：PR #689，base `main@eadf490183c35d34697053c980d06c78c80638ba`，head `9f0bd21bc3fc2542c1f098ad69c23ac2f6aaf439`；本地与远端一致。draft=false、MERGEABLE/CLEAN。
- 本轮全量读取当前 PR body、17 个 commit oid、全部 reviews/comments/reviewThreads：均为 0 条；唯一 closing issue 为 #679，仍 OPEN，AC1–AC5 尚未勾选。标签 `kind:test`、`area:tests`、`area:ci`。
- 当前 head 的 CI run `45418172183`（pull_request，attempt 1）success；12 个检查名全部 pass。Windows job `138530025655` success，原生步骤无 skip；该 run 无 artifact，以下以实际 job log 与命令输出为证。
- 本轮只修改本评审记录；不执行产品修复、不提交、不 push、不发布 review。运行上下文：`.worktrees/iteration12-native-volume-refusal/`。

### 7.2 审查前风险矩阵

| 严重度 | 层与风险 | 本轮判别证据 / 初始状态 |
|---|---|---|
| P0 | 必需 Windows lane 误绿或清理触及无关资产；破坏 main 或发布硬约束 | 追踪 SETS→标准用户→marker→fast-gate 与有界资源所有权；待审 |
| P1 | 原生拒绝未走生产路径、允许写入或错误 gate；fixture 凭据/ACL/身份边界错误 | 当前 head hosted 日志、Host/helper 调用链、真实设备事实与精确 token；待审 |
| P1 | setup/测试失败时 finally 丢失清理，或 fixture 已存在时误删无关 share/volume | 逐阶段失败路径与资源登记/销毁；待审 |
| P2 | AC 与实际断言不符、失效负控、低判别测试或不必要复杂度 | #679 AC1–AC5、局部契约与边界反例；待审 |
| P3 | 当前文档、计划、评审索引或回滚描述失真 | 当前 diff 与历史结论逐项核对；待审 |

### 7.3 分层审查结果与验收

| 层 | 结论与关键证据 |
|---|---|
| 代码 / 失败路径 | 新集成先断言真实固定卷或映射设备事实及标准用户可写，再直接调用生产 `prepareWindowsProjectData`；三个 token 精确限定 gate。`hostFixture(apply)` 失败时断言 services/live 为 0；NTFS 正控经同一 helper 接纳且私有对象存在。拒绝 gate 位于任何 `Ensure`/库/日志创建之前。无 P0/P1。 |
| 生命周期 / 清理 | VHD/磁盘脚本用 GUID 路径，盘符先查空闲，部分失败由 `New-FixtureVolume` 自己 catch detach；成功资源进入唯一 `fixtureVolumes`。共享只有 `New-SmbShare` 成功后置 `shareCreated`，同名外部共享导致失败时不会被删除；共享目录和账户用本次 GUID/SID。标准用户会话拥有其映射盘并定向 unmap。无 wildcard/物理 disk clean；无无关资产清理路径。清理失败静默且没有独立成功 receipt，因此只证明 finally 路径有界，不能声称每次实际完成清理；hosted 一次性 VM 析构是最终隔离边界。 |
| 安全 / 架构 | 仅改现有 `pull_request` lane 的 fixture；只读权限、action pins、`persist-credentials:false`、无 secrets、聚合 job 的不执行候选代码边界均保持。临时密码为运行时随机值，未输出；SMB FullAccess 只授临时账户，产品断言的 token 非管理员/非 Administrators 成员。没有 apps/packages/ABI/schema、事实源或依赖边变化。 |
| 产品闭环 | 本交付是拒绝证据与持续回归门，覆盖 helper 拒绝、Host 无 authority 和 NTFS 正控；不扩展 network/non-NTFS 存储支持。exFAT identity 早拒、ReFS filesystem 分支和 mapped DriveType 三者职责明确，第二块卷不是重复正控。 |
| 测试 / 门禁 | SETS 是唯一文件清单，新文件 minTests=5；runner 逐文件核验结果/摘要/下界/精确 0 skip，YAML 再核验正 marker，fast-gate needs 未变。当前 head Windows log 五条均执行；本轮契约 20/20。摘要不证明任意被改写的用例语义，该剩余边界仍由 #680 承担。两处 hash 契约存在非阻塞判别缺口，见 R689-01。 |
| 工作项 / 范围 | #679 AC1–AC5 的工程证据满足；唯一 closing issue 为 #679。当前 PR body 已有真实 current-head receipts、Not-proven 与同组回滚；旧 P2-1/P2-2/P3-5 的问题已在当前 body/已归档计划修复。#660 仍 OPEN，保留 #680、provider probe 和可选 storage restart；#642/#647/R1 不自动接受。17 个实现/修复/记录提交仍须由 owner 在最终 push 前按仓库规则整理，本轮没有做 Git 修改。 |

AC 映射：AC1 = exFAT/ReFS/mapped 的真实原生事实、精确拒绝断言、无私有对象与 Host 无 authority；AC2 = 同生产 helper 的 NTFS 正控、三设备哨兵 size/mtime/hash 比较与共享 ACL；AC3 = admin=false/adminMember=false、管理员预置/标准用户执行、定向 finally（清理成功未独立回读的边界如上）；AC4 = SETS/marker/当前 head 真实日志/原生负控/保留 Linux 执行；AC5 = 当前 PR body、计划 Outcomes 与 #660/#680 的未完成范围。AC1–AC5 的勾选与公开状态操作留给 owner。

### 7.4 本轮实际验证与负控

执行上下文同 §7.1。本机 macOS 结果只用于契约/纯函数/接线，不当作 Windows 原生证明。

| 命令 / 来源 | 实际结果 |
|---|---|
| `node --test tests/contract/windows-volume-fixture.test.js tests/contract/ci-windows-workflow.test.js tests/contract/windows-native-checks.test.js` | 20 tests / 20 pass / 0 skip / 0 fail |
| `node scripts/workflow-check.mjs` | no findings，7 文件 |
| `node --test tests/integration/harness-plugin-windows-volume.test.js` | 5 tests / 0 pass / 5 skip（darwin 平台边界，如实记录） |
| `node scripts/rule-checks.mjs disclosure eadf490183c35d34697053c980d06c78c80638ba` | 机械扫描通过；人工对本轮新增评审文字检查五类发布面，无命中 |
| `git diff --check eadf490183c35d34697053c980d06c78c80638ba...HEAD` | 退出 0，无输出 |
| 当前 head CI `45418172183` / Windows job `138530025655` 实际日志 | checkout 为合并当前 head/base 的 synthetic merge `357b1ef`；windows-2025 / ImageOS=win25-vs2026 / ImageVersion=20261116.315.1 / AMD64 / node v26.13.1 / git 2.56.1.windows.1。新文件五条全 pass，`native-git files=3 tests=22 skipped=0 todo=0`、`private-data files=4 tests=83 skipped=0 todo=0`、`standard-user exit=0` |
| 当前 head 设备与身份行 | exFAT HARNESSFAT L: Fixed(3)、ReFS HARNESSRFS M: Fixed(3)、N: Network(4)/ProviderName 指向本机 fixture 共享、NTFS C: Fixed(3)；临时标准用户 admin=false、adminMember=false |
| 负控 `45404618033`，scratch `87b745699e40a4f76d0d742e5af14545f0f19dd3`，实际日志重读 | 放宽 ReFS NTFS gate 后，ReFS 缺 `volume-filesystem`、实际 `volume-ancestor`；1 fail / 0 skip / standard-user exit=1；Windows Native 与 PR Fast Gate 红，Verify/Browser 绿 |
| 负控 `45404711047`，scratch `133439f4f760408507b043bd36189d16079156c2`，实际日志重读 | 去掉设备预置后 4 fail / 0 skip / standard-user exit=1；卷发现数 0、映射失败，NTFS 正控仍 pass；Windows Native 与 PR Fast Gate 红，Verify/Browser 绿 |

负控是历史 scratch 的原生实验，未声称其 SHA 等于当前 head。对 `e396f97c..9f0bd21b` 的实际 diff 复核：产品 helper 完全未变；集成文件只增加哨兵创建/比较/清理和 `path` 导入，原设备事实、helper 调用和精确 token 断言未变。当前 head 的正结果由本轮独立重读的 `45418172183` 承担，不以旧评审记录替代。

本轮变异在 `git archive 9f0bd21b` 的一次性临时副本执行，原 worktree 实现保持只读；使用仓库 `scripts/review-mutate.mjs`，每条均声明 `killedBy`，最终表一次整表重跑并由脚本逐字节还原/复跑基线。命令为 `node scripts/review-mutate.mjs <spec.json> --root <temporary-copy>`，测试命令为 `node --test tests/contract/windows-volume-fixture.test.js`。

| 变异 | killedBy | 结果 |
|---|---|---|
| M1 去掉 `assertSentinelUnchanged` 的 sha256 比较 | `writeSentinel/assertSentinelUnchanged` | SURVIVED，全部契约仍绿 |
| M2 去掉精确 token 的 includes 断言 | `token tap 跨 chunk` | KILLED，指定 token 用例红 |
| M3 去掉 `writeSentinel` 的写入 | `writeSentinel/assertSentinelUnchanged` | KILLED，指定哨兵用例红 |
| M4 去掉 `assertTreeUnchanged` 的 sha256 比较 | `snapshotTree 能区分新增对象` | SURVIVED，全部契约仍绿 |

变异 harness 退出 1 的原因是两个 SURVIVED；没有 NOT_APPLIED/KILLED_OTHER 或基线/还原失败。另在当前未改 helper 上用**同大小、恢复原 mtime、仅改字节**的临时文件验证：两个 helper 都准确以字节断言抛错（2/2），说明缺口位于契约样例的判别性，当前 helper 本身有效。

### 7.5 全部 actionable findings（均非阻塞）

- **R689-01 / P3（延续 P3-7，扩展到快照契约）** — `tests/contract/windows-volume-fixture.test.js:57-58,114-115`（新增行）。两个“字节变化”样例分别把 3 字节变为 4 字节、18 字节变为 8 字节，先被 size 检查捕获，故移除任一 sha256 比较时契约仍绿（M1/M4 SURVIVED）。影响：将来退化成只比大小/mtime 时，当前契约无法守住 AC2 的字节证据。修复方向：复用既有两个用例，改为同大小篡改并恢复原 mtime，精确断言字节错误；无需新增顶层用例或配额。当前 helper 的真实比较有效，因此非 P1/P2。
- **R689-02 / P3（归档后路径失效）** — `tests/fixtures/windows-volume-fixture.js:1`、`tests/integration/harness-plugin-windows-volume.test.js:1`（新增行）。两文件头仍指向 `docs/exec-plan/active/2026-11-24-native-volume-refusal.md`，该文件已迁到 completed。影响：按源码追溯设计时命中不存在的路径。修复方向：两处同步改为现行 completed 路径。
- **R689-03 / P3（成功日志验收口径仍不可执行）** — `docs/exec-plan/completed/2026-11-24-native-volume-refusal.md:19,180`（新增行）。最小成功证据仍要求日志“出现三个精确 token”，AC2 映射仍写 `writes=0`；成功路径的 tap 不输出原始 token，当前 head 实际 log 无这些 token 或 `writes=0` 行，只有测试通过、设备 diagnostic、marker 与退出码。影响：按该文字验收会误判一份真实成功日志缺证，或暗示不存在的 receipt。修复方向：改为“相应精确 token 断言的测试通过”，把 `writes=0` 改为实际哨兵/条目/私有对象断言；如需独立 receipt 则另显式输出，但本轮不要求扩代码。
- **R689-04 / P3（评审索引残留旧风险状态）** — `docs/review/README.md:116`（新增行）。索引仍把 P2-2 缺强制章节列为新增待回填，但当前 completed 计划已恢复 `Bottom Change Note` 与 Not-proven，PR body 也已回填 P2-1/P3-5。影响：接手者从导航读到的“当前风险”与最终树不一致。修复方向：owner 串行收敛共享索引时更新为当前已关闭项及本轮无 P0/P1 结论；旧 head 历史正文保留。

未新增 P0/P1/P2。P3-8 的固定四绑定源码守卫是公开的有限回归保护，不声称通用语义证明；本轮不另提泛化工具需求。未发现其它设计缺陷、超范围产品实现或可见过度实现。相关剩余工作已在 #660/#680 及 provider/Win11 接受项中，不另创建重复 issue。

### 7.6 结论与交接

建议 review 事件为 **APPROVE**；P0=0、P1=0、P2=0、P3=4（其中 R689-01 是已知残余的本轮复核）。以上 P3 都是可局部机械修复项，可由 owner 一次收敛并定点复评。本轮未发布任何 review、未回复或 resolve thread、未写 issue/Project 字段。

限制：macOS 原生卷/ACL/令牌不构成 Windows 证据；Windows 结论限当前 hosted windows-2025、当前工具链和 fixture，不证明 Win11 Desktop、安装件内嵌 Node、network/non-NTFS 存储支持、任意测试体诚实或每次清理成功。#660/#642/#647/R1 保持独立。交接前再次回读远端 head/base 仍为 §7.1 值、CLEAN/ready；本 worktree 仅本文件修改。


## 8. 2026-11-25 R689-01–R689-04 修复独立复评

- 基线仍为 `9f0bd21b`；本轮审查 owner 交接后的未提交 diff：契约样例、两个源码头、已归档 ExecPlan 和评审索引。未改变 helper 行为、产品、CI 接线、SETS 或顶层用例数；后续最终提交与 current-head CI 由收尾会话执行。
- **R689-01 关闭**：两个既有样例均只改变同长度字节并恢复记录 mtime；断言精确匹配 `ERR_ASSERTION` 与字节错误消息，size/mtime 失败不能冒充 hash 判别。使用交接的 mutation spec 执行 `node scripts/review-mutate.mjs <spec.json>`：M1 哨兵 hash、M2 精确 token、M3 哨兵写入、M4 快照 hash 均 KILLED（4/4），`killedBy` 分别准确归因到哨兵/token/哨兵/快照用例，脚本退出 0，逐字节还原与还原后基线通过。
- **R689-02 关闭**：两源码头均改为现行 completed 计划路径，实际文件存在；评审索引目标记录也存在。
- **R689-03 关闭**：最小成功证据改为设备 diagnostic、含精确 token 断言的用例通过行、marker 和退出码；AC2 映射写明实际哨兵/条目/私有对象断言，明确不依赖原始 token 或 `writes=0` 日志。与 §7.4 观察的成功日志一致。
- **R689-04 关闭**：索引关闭已修复旧 P2，并在本次复评后标为四项 P3 已修复且独立复评通过。计划保持 Completed；D25-1/D25-2 的直接授权、恢复点、精确 lease、逐真实 main 和最终回读策略只描述待执行收尾，未把它们误记为已完成。
- 独立验证：同 §7.4 的三文件契约命令 **20 pass/0 fail/0 skip**；`node scripts/workflow-check.mjs` **7 文件无发现**；两源码头/索引路径与计划关键必需章节检查通过；`git diff --check` 退出 0。
- **结论：APPROVE，无新增 P0/P1/P2/P3。** 原四项 P3 全部关闭。macOS 本轮不产生 Windows 原生证明；最终整理后的 head/base/checks、issue 核对、实际批准与条件 rebase merge 仍须由收尾会话完成。本轮未提交、push 或外部写入。
