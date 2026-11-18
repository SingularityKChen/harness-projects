# PR #656–#659 复审后续修复（#663）

## Purpose / Big Picture

把 2026-11-17 MMP 评审对已合并 PR #656–#659 记录的非阻塞 P2/P3 中、能够自包含修复的产品/文档/契约缺陷一次收口：Windows 私有数据创建不再可能跟随悬空 reparse 目标写出树外对象（#662）；Windows lane 的入口与 z64 架构前提真正 fail closed；storage 单基线相关的夹具世代断言、残留编号与安装/恢复文档计数与真实产物一致；包边界契约覆盖构建脚本新增的 apps → storage 边。完成后，一个新的修复 PR 关闭本 issue 与 #662，并留下可复跑证据；Windows 11 x64 Desktop 人工验收（#647）、lane 扩展（#660）、Node 契约（#313）与 R1 保持独立。

判断成功的最小证据：本 PR 的 `PR Fast Gate`（含 Windows Native lane）在精确 head 上全绿；新增/更新的定向测试在本地与 hosted Windows 上分别给出预期红→绿；`pnpm verify`、`boundaries`、`workflow-check`、size/disclosure/diff-check 全绿。

## Context and Orientation

- 评审输入：`docs/review/pr-656-mmp-review.md` … `pr-659-mmp-review.md` 的「残余风险/未验证项/首审意见」；issue #662（悬空 reparse）、#660（lane 扩展，含 fail-closed 入口、anti-hollow、真实卷负控）、#313（Node 支持下限）。
- Windows 私有数据 helper：`apps/harness-plugin/src/host-private-windows.ts` 内的固定 PowerShell `PROGRAM`，用 `CreateDirectoryW`/`CreateFileW` + SECURITY_ATTRIBUTES 在创建调用内写入私有 DACL；`Ensure` 先创建、后由 `Open` 检查既有 reparse 位。该顺序在最终分量为悬空符号链接时会让 `CreateFileW(CREATE_NEW)` 跟随链接、在链接目标处创建文件，再被拒绝（#662）。
- Windows lane：`.github/workflows/ci.yml` 的 `windows-native` job 两阶段身份执行 `scripts/windows-native-checks.mjs`；当前两个入口只按退出码判定，脚本的 `invokedDirectly()` 为 false 时 `main()` 不执行且 exit 0（#660 的 fail-closed 子项）。
- Storage：`001_init.sql` 已是唯一物理资产；`tests/integration/storage-baseline-admission.test.js` 的旧 main 布局夹具未写 `user_version=6`，与计划/评审声称的「完整 shape + 1..7 行账本 + 当前世代」不符；`tests/integration/migration-runner.test.js`、`packages/storage/sqlite/src/storage-sync.ts`、`tests/integration/execution-relation-write-schema.test.js` 仍有已删除片段的编号/文案残留。
- 安装/恢复：`docs/development/backup-rollback.md` 的现行恢复步骤仍要求核对「12 个安装文件」，而 `migrations` 折叠后 tarball 只有 6 个条目（`docs/product/demo-install.md` 已在 #659 归档提交改为 6）。
- 包边界：`tests/contract/package-boundaries.test.js` 只收集 `src/**/*.{ts,tsx,mts,cts}`；#658 让 `apps/harness-plugin/scripts/build.mjs` 静态 import `@harness-projects/storage-sqlite`，该 apps → storage 构建边不在契约观测内（方向本身合法）。

## Design / Spec

### 1. 悬空 reparse（#662）

- 文件创建：给 `CreateFileW(CREATE_NEW)` 增加 `FILE_FLAG_OPEN_REPARSE_POINT`（0x00200000）。普通新建路径无 reparse point，行为不变；最终分量是悬空符号链接时返回 `ERROR_FILE_EXISTS`，不再在目标处创建文件，随后走既有 adopt `Open`（带 OPEN_REPARSE_POINT）以 `type` 拒绝。
- 目录创建：`CreateDirectoryW` 没有等价 flag，增加一次 `ProbeChecked`（`CreateFileW(path, access=0, share=3, OPEN_EXISTING, BACKUP_SEMANTICS|OPEN_REPARSE_POINT)`）创建前探测。最终分量存在（含悬空 junction/symlink）→ 关闭句柄、只走既有 `Open` 的 adopt/拒绝，绝不让创建调用跟随链接；不存在（`ERROR_FILE_NOT_FOUND`）→ 才创建；其它探测错误有界 `create-*` 拒绝。
- 威胁模型不变：同 SID/受信主体预置的链接是前提（与 #643 一致），本修复只是消除「拒绝路径的树外写入」副作用；错误 token、固定文案与 Host ABI 不变。
- 原生回归：新增 `tests/integration/harness-plugin-windows-reparse.test.js`，加入 `SETS['native-git']`（runner 管理员阶段才能创建符号链接）。用例对 root 下固定对象（db、log）分别：先用 helper 建 canonical root，再把对象替换为指向树外不存在目标的悬空符号链接，断言 helper 拒绝、链接目标未被创建、对象仍是链接。它不主张普通用户隔离证据。

### 2. 架构前提

`[IntPtr]::Size -ne 8` 只排除 x86；ARM64 也是 8 字节指针。改为同时要求 `RuntimeInformation.ProcessArchitecture == X64`（WOW64 的 x86 进程被指针宽度拒绝，x64 on ARM64 模拟仍按 X64 接受）。保持失败 token `platform` 与固定文案。

### 3. lane 入口 fail-closed（#660 子项）

两个入口在 pwsh 中捕获 runner 输出并断言出现 `windows-native-checks: set=<id> files=… tests=… skipped=… todo=…` 标记；`native-git` 入口还要检查 `$LASTEXITCODE`。缺少标记 → `::error::windows-native-checks: …` 并以 1 退出。契约测试 `tests/contract/ci-windows-workflow.test.js` 固定 marker 断言与退出码检查；`docs/development/ci.md` 的反空心段从「尚未实现（#660）」改为已实现并说明边界（marker 只证明入口执行，不证明断言有效）。

### 4. 原生 ACL 观测收紧

`tests/integration/harness-plugin-windows-fixture.js` 的 `trustedAcl` 增加「ACE 至少 3 条」与「当前用户自己的 allow ACE 存在」，让 worktrees/digest/后代用例的独立 `Get-Acl` 观测能杀死 self-ACE 退化变异（P3-5）。

### 5. Storage 校正

- `storage-baseline-admission.test.js`：`legacyFixture(db, ledgerRows)`——多行账本用例执行完整资产并补 `PRAGMA user_version=${CURRENT_SCHEMA_GENERATION}`，只应用过 001 的旧库使用 `-- 002_identity_membership：` 前的截断前缀；截断前 `assert.notEqual(prefix, sql)`，标记失效时响亮失败而不是静默换语义；更新注释与 `partial-initialization-marked-current` 的世代。
- `001_init.sql` 头部：把「005 …其退役说明保留在此」改成可验证表述（005 无 DDL 且已删除；载体退役/写入期拒绝见 003 的 `sync_observation` 注释）。
- `migration-runner.test.js`、`storage-sync.ts`、`execution-relation-write-schema.test.js`：把已删除片段编号（007/005/003）改为语义表述。
- `docs/development/backup-rollback.md`：现行恢复步骤的 12 → 6（按 tgz 实际条目核对），历史演练记录不改。

### 6. 包边界契约

在 `package-boundaries.test.js` 增加 apps 构建脚本的观测：收集 `apps/*/scripts/**/*.mjs`，只接受已登记的宿主编译边（`apps/harness-plugin/scripts` → `packages/storage/sqlite`），外部模块与相对导入不参与包边判定。未登记的 apps → packages 构建边失败。

### 放弃的方案

- 给 `Ensure` 增加通用 pre-check 而不加创建 flag：仅靠探测仍有 TOCTOU 且不能覆盖文件创建调用本身——采用「flag + 目录探测」组合。
- 在标准用户阶段创建符号链接做原生回归：标准用户无 `SeCreateSymbolicLinkPrivilege`，改用管理员阶段并明确它不是普通用户隔离证据。
- 用源码镜像/摘要指纹强化 anti-hollow：属于 #660 的独立设计，本 PR 只修复入口 fail-open。
- 提升根 `engines.node` 或改写 build 兼容层：属于 #313 的 Node 支持契约，本 PR 只在文档/评审记录保留风险。

## Global Constraints

- 产品行为只改 Windows helper 的创建顺序/flag 与架构门；不改 Host ABI、协议帧、固定错误文案、POSIX 路径、SQL schema、storage 运行时语义。
- 不新增依赖、不改 lockfile、不改 workflow 数量、不改唯一必需检查名 `PR Fast Gate`；Windows lane 契约与文档同步。
- 仓库硬帽：代码 ≤1000 行、文档 ≤1500 行（排除 lock/generated）；目标单一可独立回滚的修复 PR。
- 证据只写实际执行过的命令与 hosted 回读；Windows 原生结论必须来自精确 head 的 hosted lane。
- 本任务文件集合：`.github/workflows/ci.yml`、`apps/harness-plugin/src/host-private-windows.ts`、`scripts/windows-native-checks.mjs`(仅 SETS/文案)、`tests/integration/harness-plugin-windows-reparse.test.js`(新增)、`tests/integration/harness-plugin-windows-fixture.js`、`tests/contract/ci-windows-workflow.test.js`、`tests/contract/package-boundaries.test.js`、`tests/integration/storage-baseline-admission.test.js`、`tests/integration/migration-runner.test.js`、`tests/integration/execution-relation-write-schema.test.js`、`packages/storage/sqlite/migrations/001_init.sql`、`packages/storage/sqlite/src/storage-sync.ts`、`docs/development/ci.md`、`docs/development/backup-rollback.md`、本计划与 `docs/README.md`。

## Plan of Work

### Batch 1 · 悬空 reparse 与架构门（Windows 产品）

- 文件：`apps/harness-plugin/src/host-private-windows.ts`、`tests/integration/harness-plugin-windows-reparse.test.js`（新增）、`scripts/windows-native-checks.mjs`（SETS 增加文件）、`tests/integration/harness-plugin-windows-fixture.js`、`docs/development/ci.md`。
- 步骤：加 `ProbeChecked` IL 包装与 `Ensure` 探测分支；`CreateChecked` 增加 `FILE_FLAG_OPEN_REPARSE_POINT`；架构门改 X64；新增原生回归并加入 `native-git` set；收紧 `trustedAcl`。
- 验证：本地 `pnpm test:file tests/integration/harness-plugin-windows-private-data.test.js`（darwin 平台门）、`node --test tests/contract/windows-native-checks.test.js`；hosted Windows lane 上 `native-git` 新用例 + `private-data` 78/0 全绿。
- 回滚：revert 本批 = 恢复「先创建后检查」与指针宽度门；不涉及数据迁移。

### Batch 2 · lane 入口 fail-closed

- 文件：`.github/workflows/ci.yml`、`tests/contract/ci-windows-workflow.test.js`、`docs/development/ci.md`。
- 步骤：两个入口捕获输出并断言 marker；契约测试固定 marker/`$LASTEXITCODE`；文档同步。
- 验证：`node --test tests/contract/ci-windows-workflow.test.js tests/contract/ci-browser-workflow.test.js`；`node scripts/workflow-check.mjs`；hosted lane 日志出现 marker。
- 回滚：revert 本批 = 入口回到只判退出码；不影响已通过的 lane 结果。

### Batch 3 · Storage 校正与包边界契约

- 文件：上述 storage 测试/资产/source 注释、`docs/development/backup-rollback.md`、`tests/contract/package-boundaries.test.js`。
- 步骤：fixture 世代/截断守卫；注释与编号散文校正；安装/恢复计数 6；记录 apps scripts 构建边。
- 验证：`pnpm test:file tests/integration/storage-baseline-admission.test.js tests/integration/migration-runner.test.js tests/integration/execution-relation-write-schema.test.js`；`pnpm run boundaries`；`pnpm verify`。
- 回滚：revert 本批 = 恢复旧夹具/文案；无 schema 与运行时变化。

### Batch 4 · 计划归档与 PR

- 文件：本计划（active → completed）、`docs/README.md`。
- 步骤：回填 Progress/Outcomes/Bottom Change Note；归档并更新索引；整理提交；push；开 PR（Closes #663、Closes #662、Refs #660/#313）；等 `PR Fast Gate` 与 Windows lane。
- 回滚：PR 未合并时关闭分支即可；合并后 revert 单 PR 恢复全部修复前状态。

## Validation and Acceptance

- `node --test tests/contract/ci-windows-workflow.test.js tests/contract/ci-browser-workflow.test.js tests/contract/windows-native-checks.test.js` 全绿。
- `node scripts/workflow-check.mjs` no findings（7 文件）。
- `pnpm test:file tests/integration/storage-baseline-admission.test.js tests/integration/migration-runner.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/harness-plugin-windows-private-data.test.js` 全绿（Windows 原生用例在 darwin 按平台 skip）。
- `pnpm typecheck`、`pnpm verify`、`pnpm run boundaries` 全绿；`node scripts/rule-checks.mjs size main` 与 `disclosure main` 通过；`git diff --check main...HEAD` 干净。
- hosted：本 PR 精确 head 的 `PR Fast Gate`、`Verify`、`Browser`、`Windows Native` 全绿，Windows 日志出现 `native-git files=3 …`（含新用例）与 `private-data files=3 tests=78 skipped=0`、两个入口 marker 行；负控（可选）用临时 ref 证明 marker 缺失时 lane 红。

## Progress

- [x] 2026-11-18：从 main `3b1c5f44` 建分支 `fix/mmp-review-656-659-followup` 与独立 worktree；创建 umbrella issue #663。
- [x] Batch 1：helper 增加 `ProbeChecked`（创建前探测）与 `FILE_FLAG_OPEN_REPARSE_POINT`（文件创建不跟随悬空链接）；架构门改为指针宽度 + `PROCESSOR_ARCHITECTURE=AMD64`；新增 `harness-plugin-windows-reparse.test.js` 并加入 `native-git` set；`trustedAcl` 收紧。
- [x] Batch 2：两个 lane 入口在 pwsh 中捕获输出并断言 `windows-native-checks: set=… files=… tests=…` 通过 marker；契约测试与 `docs/development/ci.md` 同步（#660 的 fail-closed 子项）。
- [x] Batch 3：`legacyFixture` 补当前世代与截断守卫、参数改名；`001_init.sql` 头部 005 说明改为可验证表述；三处已删除片段编号散文改为语义表述；`backup-rollback.md` 的现行安装文件计数 12→6；package-boundaries 契约覆盖 `apps/harness-plugin/scripts` 的构建边。
- [x] 本地验证：`node --test tests/contract/{ci-windows-workflow,ci-browser-workflow,windows-native-checks}.test.js` 17/17；`node --test tests/contract/package-boundaries.test.js` 10/10；`node --test tests/integration/harness-plugin-windows-reparse.test.js` darwin skip 1；`pnpm test:file` storage 三套 186/186；`harness-plugin-private-data.test.js` 59/59；`pnpm typecheck` exit 0；`pnpm verify` exit 0；`pnpm run boundaries` 9/9；`workflow-check` no findings；`git diff --check` 干净。
- [ ] PR 开启与精确 head 的 hosted 证据（Windows lane 新用例、marker 行、`PR Fast Gate`）。

## Surprises & Discoveries

- 2026-11-18：`CreateDirectoryW` 没有 reparse 选项（也不接受 `FILE_FLAG_OPEN_REPARSE_POINT`），因此目录创建只能以「`ProbeChecked` 先探测、存在则交给既有 `Open`」避免跟随悬空 junction/symlink；文件创建则可用创建调用自身带的 `FILE_FLAG_OPEN_REPARSE_POINT` 直接返回 `ERROR_FILE_EXISTS`。两条路径都不需要 `SetSecurityInfo`/后置改权。
- 2026-11-18：悬空 reparse 的原生回归必须放 runner 管理员阶段（标准用户没有 `SeCreateSymbolicLinkPrivilege`）；`docs/development/ci.md` 已写明该用例只证明 reparse 策略、不主张普通用户隔离证据。
- 2026-11-18：`tests/contract/package-boundaries.test.js` 的 JSDoc 以 `/**` 开头时，注释内写 `apps/*/scripts/**` 会被 `*/` 提前终止（实测 `ReferenceError: scripts is not defined`）；改为行注释后通过。

## Decision Log

- **D1（2026-11-18，设计）**：用「文件 flag + 目录 probe」而不是统一 pre-check + 后置检查。Rationale：文件创建调用本身必须不跟随链接；目录创建 API 无 flag，只能探测 + adopt。
- **D2（2026-11-18，设计）**：原生回归放 runner 管理员阶段（`native-git` set）。Rationale：标准用户无符号链接创建权限；该用例只证明 reparse 策略，不主张普通用户隔离证据（文档写明）。
- **D3（2026-11-18，设计）**：本 PR 只做 lane 入口 fail-closed；anti-hollow 强化、真实卷负控、probe 契约留在 #660。
- **D4（2026-11-18，范围）**：Node 支持下限归 #313，不修改根 `engines` 或 build 兼容层。
- **D5（2026-11-18，文件集合）**：docs/README.md 与计划文件本身也属于本任务写集（新增/归档计划要求更新索引）。

## Idempotence and Recovery

- 所有编辑可用 `git restore`/revert 恢复；没有数据迁移、没有远程状态写入（除 PR/issue 与 CI 运行）。
- Windows 原生修复未在本地 Windows 主机验证前，hosted lane 是唯一原生判据；失败时按 lane 的 `::error::` 归因到具体用例并回退对应批次。
- 若管理员阶段的 reparse 用例因 profile ACL 形状被拒，先核对 helper 的 profile/ancestor 断言，再决定改测试夹具（保持产品判定不变）或把用例拆到专用 set；不得用 skip 换绿。

## Interfaces and Dependencies

- 依赖：Node 26（`.nvmrc`）、pnpm 10.28.2、GitHub-hosted `windows-2025` 与仓库既有自托管 runner 配置；不新增工具或凭据。
- 命名：分支 `fix/mmp-review-656-659-followup`；PR 标题 `fix(apps): close the remaining #656–#659 review follow-ups`；issue #663（umbrella）、#662（reparse）、#660（lane 扩展）、#313（Node）。
- 观测点：`PR Fast Gate`（唯一必需检查）、Windows Native job 日志、`docs/review/` 既有记录。

## Outcomes & Retrospective

- 产品面：Windows 私有数据创建路径在文件与目录两条创建分支上都先判定最终分量是否 reparse；悬空链接只会被既有 `Open` 以 `type` 拒绝，创建调用不再可能在链接目标处写出对象；x64 支持面由 `IntPtr::Size` + `PROCESSOR_ARCHITECTURE` 共同判定（ARM64 显式拒绝）。
- 门禁面：lane 入口 marker 断言把「脚本跳过 `main()` 但 exit 0」变成红色；hosted lane 仍需在 PR 精确 head 上证明 marker 行与新原生用例。
- 文档/测试面：storage 旧库反控现在真的覆盖 generation 6；安装/恢复文档与 6 条安装件一致；构建脚本的 apps → storage 边进入边界契约。
- 与计划的偏差：无范围外改动；anti-hollow 强化、真实卷负控、provider-probe 契约与 Node engines 按 D3/D4 留给 #660/#313。
- 遗留：hosted Windows 证据、PR 评审与合并；`#662` 由本 PR 关闭，`#663` 关闭本批；`#660` 保持 OPEN。

## Bottom Change Note

- 2026-11-18：创建。范围来自 #656–#659 的合并后评审记录、#660/#662/#313 与本次人类要求（一个修复 PR）。
- 2026-11-18：实现与本地验证完成；补 Surprises（目录创建无 reparse flag、管理员阶段原生回归、边界测试注释的 `*/` 陷阱）与 Outcomes；hosted 证据待 PR 精确 head。
