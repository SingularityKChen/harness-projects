# PR #656–#659 复审后续修复（#663）

## Purpose / Big Picture

把 2026-11-17 MMP 评审对已合并 PR #656–#659 记录的非阻塞 P2/P3 中、能够自包含修复的产品/文档/契约缺陷一次收口：Windows 私有数据创建不再跟随预置的悬空 reparse 目标写出树外对象（#662）；Windows lane 的入口与 x64 架构前提真正 fail closed；storage 单基线相关的夹具世代断言、残留编号与安装/恢复文档计数与真实产物一致；包边界契约覆盖构建脚本新增的 apps → storage 边。完成后，一个新的修复 PR 关闭本 issue 与 #662，并留下可复跑证据；Windows 11 x64 Desktop 人工验收（#647）、lane 扩展（#660）、Node 契约（#313）与 R1 保持独立。

判断成功的最小证据：本 PR 的 `PR Fast Gate`（含 Windows Native lane）在最终 head 上全绿；新增/更新的定向测试在本地可执行部分全绿，Windows 原生结论由 hosted lane 判别（darwin 用例按平台 skip）；hosted marker 负控在 scratch ref 上给出预期红；`pnpm verify`（或环境性失败时的窄套件 + hosted Verify）、`boundaries`、`workflow-check`、size/disclosure/diff-check 全绿。

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
- 原生回归：新增 `tests/integration/harness-plugin-windows-reparse.test.js`，加入 `SETS['native-git']`（runner 管理员阶段才能创建符号链接）。用例对 root 下固定对象（db、log）与数据根目录分别：先用 helper 建 canonical root，再把对象/root 替换为指向树外不存在目标的悬空符号链接/junction，断言 helper 拒绝、链接目标未被创建、对象仍是链接且既有数据库未被改写；再摘除链接，断言既有 canonical root 能被再次正常接纳（adoption-after-release）。它只证明预置链接不被跟随，不主张普通用户隔离证据，也不构造 probe→create 竞争。
- 判别边界：文件创建 flag 只在 probe 之后的竞争窗口里独立生效，预置链接会被 probe 先行拦截，因此原生测试无法单独判别该 flag；flag 作为 defense-in-depth 保留并在 Risks 记录。

### 2. 架构前提

`[IntPtr]::Size -ne 8` 只排除 x86；ARM64 也是 8 字节指针。实现用 `$env:PROCESSOR_ARCHITECTURE -ne 'AMD64'` 同时排除 ARM64（WOW64 的 x86 进程被指针宽度拒绝，x64 on ARM64 模拟仍按 AMD64 接受）。该变量由 OS 为进程设置、随父进程环境继承；缺失或异常值的失败方向是 `platform` 拒绝（fail closed），不承担跨权限边界。保持 token 与固定文案；lane 只有 AMD64 正控，不宣称拒绝面被证明。

### 3. lane 入口 fail-closed（#660 子项）

两个入口在 pwsh 中捕获 runner 输出并断言出现与 `SETS` 计数一致的 `windows-native-checks: set=<id> files=… tests=… skipped=… todo=…` 标记（契约测试从 `SETS` 推导期望，YAML 漏改会在本地 verify 红）；`native-git` 入口还要检查 `$LASTEXITCODE`。缺少或不符合标记 → `::error::windows-native-checks: …` 并以 1 退出。契约测试固定 marker、`-notmatch` 方向与失败赋值；hosted 负控用临时 ref 证明 marker 缺失时 lane 红（见 Validation）。

### 4. 原生 ACL 观测收紧

`tests/integration/harness-plugin-windows-fixture.js` 的 `trustedAcl` 增加「ACE 至少 3 条」与「当前用户自己的 allow ACE 存在」，让 worktrees/digest/后代用例的独立 `Get-Acl` 观测能杀死 self-ACE 退化变异（P3-5）。

### 5. Storage 校正

- `storage-baseline-admission.test.js`：`legacyFixture(db, ledgerRows)`——多行账本用例执行完整资产并补 `PRAGMA user_version=${CURRENT_SCHEMA_GENERATION}`，只应用过 001 的旧库使用 `-- 002_identity_membership：` 前的截断前缀；截断前 `assert.notEqual(prefix, sql)`，标记失效时响亮失败而不是静默换语义；更新注释与 `partial-initialization-marked-current` 的世代。
- `001_init.sql` 头部：把「005 …其退役说明保留在此」改成可验证表述（005 无 DDL 且已删除；载体退役见 #415，写入期拒绝见本文件 `sync_observation` 段注释与 `storage-sync.ts` 的 `LEGACY_COMMITTED_VERSION_MESSAGE`）。
- `migration-runner.test.js`、`storage-sync.ts`、`execution-relation-write-schema.test.js`：把已删除片段编号（007/005/003）改为语义表述。
- `docs/development/backup-rollback.md` 与 `docs/product/demo-install.md`：现行恢复步骤按「匹配包的实际条目」核对——当前单资产构建 6 件，折叠前旧构建 12 件（七份 migrations）；历史演练记录不改。

### 6. 包边界契约

在 `package-boundaries.test.js` 增加 apps 构建脚本的观测：收集 `apps/*/scripts/**/*.mjs`，只接受已登记的宿主编译边（`apps/harness-plugin/scripts` → `packages/storage/sqlite`），外部模块与相对导入不参与包边判定。未登记的 apps → packages 构建边失败。
范围：只解析字面量 import / export-from / dynamic import 的静态可见边；createRequire、模板拼接与 `.js/.cjs` 脚本不在契约内（当前树无此用法），测试注释写明该边界。

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
- 本任务文件集合：`.github/workflows/ci.yml`、`apps/harness-plugin/src/host-private-windows.ts`、`scripts/windows-native-checks.mjs`(仅 SETS/文案)、`tests/integration/harness-plugin-windows-reparse.test.js`(新增)、`tests/integration/harness-plugin-windows-fixture.js`、`tests/contract/ci-windows-workflow.test.js`、`tests/contract/package-boundaries.test.js`、`tests/integration/storage-baseline-admission.test.js`、`tests/integration/migration-runner.test.js`、`tests/integration/execution-relation-write-schema.test.js`、`tests/integration/storage-connector-account.test.js`、`packages/storage/sqlite/migrations/001_init.sql`、`packages/storage/sqlite/src/storage-sync.ts`、`docs/development/ci.md`、`docs/development/backup-rollback.md`、`docs/product/demo-install.md`、`docs/review/pr-664-mmp-review.md`、本计划与 `docs/README.md`。
- 流程豁免（记录于 Decision Log D6）：按 issue #663（umbrella）与人类「一个修复 PR」的要求，gate（`.github/workflows/ci.yml`）与依赖边矩阵（`tests/contract/package-boundaries.test.js`）修复并入本修复 PR；提交边界仍把规则变更与产品修复分开，回滚时可按提交单独 revert。

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
- 步骤：fixture 世代/截断守卫；注释与编号散文校正；安装/恢复计数按匹配包代际（当前 6 / 折叠前 12）；记录 apps scripts 构建边。
- 验证：`pnpm test:file tests/integration/storage-baseline-admission.test.js tests/integration/migration-runner.test.js tests/integration/execution-relation-write-schema.test.js`；`pnpm run boundaries`；`pnpm verify`。
- 回滚：revert 本批 = 恢复旧夹具/文案；无 schema 与运行时变化。

### Batch 4 · 计划归档与评审记录

- 文件：本计划（收尾时 active → completed）、`docs/review/pr-664-mmp-review.md`、`docs/README.md`。
- 步骤：回填 Progress/Outcomes/Bottom Change Note；review 记录写 `docs/review/pr-664-mmp-review.md`；修复独立复评后归档并更新索引；整理提交；push；PR body/标题校正（Closes #663、Closes #662、Refs #660/#313）。
- 回滚：PR 未合并时关闭分支即可；合并后 revert 单 PR 恢复全部修复前状态。

### Batch 5 · 评审后的修复（照 review 意见）

- 文件：上述 Windows/CI/storage/docs 文件，以及 `docs/review/pr-664-mmp-review.md`、本计划。
- 步骤：补目录 dangling junction 原生负控与 adoption-after-release；契约从 `SETS` 推导 marker 并断言 `-notmatch`/`exit 1`/`$nativeExit = 1`；恢复文档按代际写实际安装件；订正 storage 注释、001 头部指针与 connector 陈旧编号散文；ExecPlan 校正；补 hosted marker 负控证据。
- 验证：本地 contract/storage/boundaries/workflow-check/size/disclosure/diff-check；hosted Windows lane 新用例与 marker；独立复评通过。
- 回滚：按 Batch 5 新增改动 revert，产品/门禁行为回到首轮 head。

## Validation and Acceptance

- `node --test tests/contract/ci-windows-workflow.test.js tests/contract/ci-browser-workflow.test.js tests/contract/windows-native-checks.test.js` 全绿。
- `node scripts/workflow-check.mjs` no findings（7 文件）。
- `pnpm test:file tests/integration/storage-baseline-admission.test.js tests/integration/migration-runner.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/harness-plugin-windows-private-data.test.js` 全绿（Windows 原生用例在 darwin 按平台 skip）。
- `pnpm typecheck`、`pnpm verify`、`pnpm run boundaries` 全绿；`node scripts/rule-checks.mjs size main` 与 `disclosure main` 通过；`git diff --check main...HEAD` 干净。若本机 `pnpm verify` 因 pnpm 离线 store 缺包（`ERR_PNPM_NO_OFFLINE_TARBALL`）失败，记录为环境性并以 hosted `Verify` + 窄套件为准；本次独立复核即出现该环境性失败，不是 PR 缺陷。
- hosted：修复后精确 head 的 `PR Fast Gate`、`Verify`、`Browser`、`Windows Native` 全绿；Windows 日志出现 `native-git files=3 … tests≥22`（含目录 reparse 与 adoption-after-release 子用例）与 `private-data files=3 tests=78 skipped=0`、两个入口 marker 行。
- hosted 负控 A（native-git 入口跳过 main）：scratch ref `test/neg-664-native-git-1794970778`（commit `49b38d85`），run `44227227371`：`Windows Native`/`PR Fast Gate` failure、`Verify`/`Browser` success；日志 `::error::windows-native-checks: set=native-git 缺少或不符合通过标记` + exit 1。
- hosted 负控 B（private-data 正常执行后抑制 marker）：scratch ref `test/neg-664-private-data-suppressed-1794972130`（commit `ad67e90a`），run `44229943037`：`Windows Native`/`PR Fast Gate` failure、`Verify`/`Browser` success；日志 `::error::windows-native-checks: set=private-data 缺少或不符合通过标记` 与 `standard-user exit=1`。两个 scratch ref 已删除。

## Progress

- [x] 2026-11-18：从 main `3b1c5f44` 建分支 `fix/mmp-review-656-659-followup` 与独立 worktree；创建 umbrella issue #663。
- [x] Batch 1：helper 增加 `ProbeChecked`（创建前探测）与 `FILE_FLAG_OPEN_REPARSE_POINT`（文件创建不跟随悬空链接）；架构门改为指针宽度 + `PROCESSOR_ARCHITECTURE=AMD64`；新增 `harness-plugin-windows-reparse.test.js` 并加入 `native-git` set；`trustedAcl` 收紧。
- [x] Batch 2：两个 lane 入口在 pwsh 中捕获输出并断言 `windows-native-checks: set=… files=… tests=…` 通过 marker；契约测试与 `docs/development/ci.md` 同步（#660 的 fail-closed 子项）。
- [x] Batch 3：`legacyFixture` 补当前世代与截断守卫、参数改名；`001_init.sql` 头部 005 说明改为可验证表述；三处已删除片段编号散文改为语义表述；`backup-rollback.md` 的现行安装文件计数改为按匹配包代际（当前 6 / 折叠前 12）；package-boundaries 契约覆盖 `apps/harness-plugin/scripts` 的构建边。
- [x] 本地验证：`node --test tests/contract/{ci-windows-workflow,ci-browser-workflow,windows-native-checks}.test.js` 17/17；`node --test tests/contract/package-boundaries.test.js` 10/10；`node --test tests/integration/harness-plugin-windows-reparse.test.js` darwin skip 1；`pnpm test:file` storage 三套 186/186；`harness-plugin-private-data.test.js` 59/59；`pnpm typecheck` exit 0；`pnpm verify` exit 0；`pnpm run boundaries` 9/9；`workflow-check` no findings；`git diff --check` 干净。
- [x] PR #664 已开（ready），head `78233077` 的 hosted 证据：Windows Native 5m5s 通过（`native-git files=3 tests=21`、`private-data files=3 tests=78 skipped=0`、两个入口 marker），`Verify`/`Browser`/`PR Fast Gate` 全绿；`Create review session` 为非必需环境性 404。
- [x] 2026-11-18：独立 review APPROVED WITH NOTES（5 P2/10 P3，无 P0/P1，head `78233077`）；按 findings 进入 Batch 5。
- [x] Batch 5 本地验证：contract 27/27、integration 192/192、boundaries 10/10、typecheck exit 0、workflow-check no findings、diff-check 干净；`pnpm verify` 环境性离线包失败，以 hosted Verify 为准。
- [x] hosted 修复 head `cf949b5b`：run `44227062981` 的 Verify/Windows Native/Browser/`PR Fast Gate` 全绿；Windows 日志 `native-git files=3 tests=22`、`private-data files=3 tests=78 skipped=0`。
- [x] hosted marker 负控：native-git run `44227227371`（skip main）与 private-data run `44229943037`（suppressed marker）均使 Windows Native/PR Fast Gate 红且 Verify/Browser 绿；日志含 `缺少或不符合通过标记`；scratch refs 已删除。
- [x] 独立复评：storage 5/5 关闭；windows P2 关闭、新 P3 已修；ci F1a/F2 关闭并补 C 变异与 clean private-data 负控；product 无新 P0/P1；收尾项转入最终 head。
- [x] 归档：本计划移入 `completed/`，review 记录 `docs/review/pr-664-mmp-review.md` 与 `docs/README.md` 同步。
- [ ] 最终 head 的 `PR Fast Gate` 回读、PR body/标题与 issue 验收勾选、rebase merge（本计划归档提交之后）。

## Surprises & Discoveries

- 2026-11-18：`CreateDirectoryW` 没有 reparse 选项（也不接受 `FILE_FLAG_OPEN_REPARSE_POINT`），因此目录创建只能以「`ProbeChecked` 先探测、存在则交给既有 `Open`」避免跟随悬空 junction/symlink；文件创建则可用创建调用自身带的 `FILE_FLAG_OPEN_REPARSE_POINT` 直接返回 `ERROR_FILE_EXISTS`。两条路径都不需要 `SetSecurityInfo`/后置改权。
- 2026-11-18：悬空 reparse 的原生回归必须放 runner 管理员阶段（标准用户没有 `SeCreateSymbolicLinkPrivilege`）；`docs/development/ci.md` 已写明该用例只证明 reparse 策略、不主张普通用户隔离证据。
- 2026-11-18：`tests/contract/package-boundaries.test.js` 的 JSDoc 以 `/**` 开头时，注释内写 `apps/*/scripts/**` 会被 `*/` 提前终止（实测 `ReferenceError: scripts is not defined`）；改为行注释后通过。
- 2026-11-18：管理员阶段的原生夹具遇到三个 Windows 事实：①管理员创建的目录默认 owner 是 `BUILTIN\Administrators`，helper 的 profile 门要求 owner=当前用户（用既有 `setAcl` 写 canonical SDACL）；②`powershell.exe` 继承 pwsh 7 的 `PSModulePath` 时 `Set-Acl` 无法加载模块（`setAcl` 的 `ps()` 已固定 5.1 模块路径）；③GitHub runner 的 `os.tmpdir()` 解析出 `C:\Users\RUNNER~1\...` 8.3 短名，被 helper 的 `Lexical` 明确拒绝（改用 `os.homedir()` 长路径，产品判定不放宽）。

- 2026-11-18（评审后）：新增文件 reparse 用例只对 `workspace.sqlite`/`diagnostics.log` 生效；单独移除 `CreateChecked` 的 reparse flag 或单独移除 `Ensure` 的 probe，该用例都仍绿，只有两者同时移除才红——因此目录分支必须单独补 dangling junction 负控，文件 flag 只能作为竞争窗口的 defense-in-depth。
- 2026-11-18（评审后）：`docs/development/backup-rollback.md` 的「旧 tgz」是拟回滚包；折叠前旧包是 12 件（七份 migrations），把现行文档写成 6 件会让正确旧包被误判。现行构建 6 件、旧构建 12 件必须同时写明。
- 2026-11-18（评审后）：契约测试只断言 marker 字符串时，`-notmatch` 反向、`exit 1`→0、`$nativeExit = 1`→0 三种变异都仍绿；marker 期望必须从 SETS 推导并断言失败方向，hosted 仍需负控。

## Decision Log

- **D1（2026-11-18，设计）**：用「文件 flag + 目录 probe」而不是统一 pre-check + 后置检查。Rationale：文件创建调用本身必须不跟随链接；目录创建 API 无 flag，只能探测 + adopt。
- **D2（2026-11-18，设计）**：原生回归放 runner 管理员阶段（`native-git` set）。Rationale：标准用户无符号链接创建权限；该用例只证明 reparse 策略，不主张普通用户隔离证据（文档写明）。
- **D3（2026-11-18，设计）**：本 PR 只做 lane 入口 fail-closed；anti-hollow 强化、真实卷负控、probe 契约留在 #660。
- **D4（2026-11-18，范围）**：Node 支持下限归 #313，不修改根 `engines` 或 build 兼容层。
- **D5（2026-11-18，文件集合）**：docs/README.md 与计划文件本身也属于本任务写集（新增/归档计划要求更新索引）。

- **D6（2026-11-18，范围/流程）**：按 issue #663（umbrella）与人类「一个修复 PR」的要求，把 gate（`.github/workflows/ci.yml`）与依赖边矩阵（`tests/contract/package-boundaries.test.js`）修复并入本修复 PR；该偏离 `docs/review/README.md` §6「单独 PR」的授权与理由记录在此。最终提交序列把 gate 契约（`ci.yml` + `ci-windows-workflow.test.js`）与 boundary 契约（`package-boundaries.test.js`）各自独立成提交，回滚时可按提交单独 revert。
- **D7（2026-11-18，设计）**：架构门使用 `$env:PROCESSOR_ARCHITECTURE` 而非 `RuntimeInformation.ProcessArchitecture`；变量由 OS 设置、随父进程继承，缺失/异常方向是 `platform` 拒绝；lane 只有 AMD64 正控，不把「拒绝面已证明」写成事实。
- **D8（2026-11-18，测试）**：文件创建 flag 与目录 probe 在预置链接场景互为冗余，原生测试无法单独判别；目录分支补 dangling junction 行为负控，文件 flag 作为竞争窗口 defense-in-depth 记录，不伪造判别测试。
- **D9（2026-11-18，收尾）**：review 记录写 `docs/review/pr-664-mmp-review.md` 随 PR 合并；顺序为先修复→独立复评→归档本计划→整理提交→issue 验收→rebase merge。

## Idempotence and Recovery

- 所有编辑可用 `git restore`/revert 恢复；没有数据迁移、没有远程状态写入（除 PR/issue 与 CI 运行）。
- Windows 原生修复未在本地 Windows 主机验证前，hosted lane 是唯一原生判据；失败时按 lane 的 `::error::` 归因到具体用例并回退对应批次。
- 若管理员阶段的 reparse 用例因 profile ACL 形状被拒，先核对 helper 的 profile/ancestor 断言，再决定改测试夹具（保持产品判定不变）或把用例拆到专用 set；不得用 skip 换绿。

- 残余（不阻塞交付，随 PR body/评审记录保留）：目录 `ProbeChecked`→`CreateDirectoryW` 的竞争窗口无法用 `CreateDirectoryW` 原子关闭，同 SID 主动竞争不在本修复威胁模型内；helper 准入后 Host 的 log open 与 `new DatabaseSync(location)` 仍会跟随准入后被替换的 reparse。两项由 #665 追踪；#666 追踪单资产折叠后失效的 ADR 指针。

## Interfaces and Dependencies

- 依赖：Node 26（`.nvmrc`）、pnpm 10.28.2、GitHub-hosted `windows-2025` 与仓库既有自托管 runner 配置；不新增工具或凭据。
- 命名：分支 `fix/mmp-review-656-659-followup`；PR 标题 `fix(apps): close self-contained #656–#659 review follow-ups`；issue #663（umbrella）、#662（reparse）、#660（lane 扩展）、#313（Node）。
- 观测点：`PR Fast Gate`（唯一必需检查）、Windows Native job 日志、`docs/review/` 既有记录。

## Outcomes & Retrospective

- 产品面：Windows 私有数据创建路径在文件与目录两条创建分支上都先判定最终分量是否 reparse；预置的悬空链接只会被既有 `Open` 以 `type` 拒绝，不再被创建调用跟随（文件 flag 的竞争窗口属 defense-in-depth，未被测试单独判别）；x64 支持面由 `IntPtr::Size` + `PROCESSOR_ARCHITECTURE` 共同判定（ARM64 显式拒绝）。
- 门禁面：lane 入口 marker 断言把「脚本跳过 `main()` 但 exit 0」变成红色；契约测试从 `SETS` 推导 marker 并断言失败分支的 `-notmatch`/`exit 1`/`$nativeExit = 1`；hosted 负控 A（native-git，run `44227227371`）已证明 marker 缺失时 lane 红，负控 B（private-data，run `44229943037`）验证同一分支；hosted Windows lane 在精确 head 上证明 marker 行与新原生用例。
- 文档/测试面：storage 旧库反控覆盖真实 7 行/gen6 与截断 shape；恢复文档按匹配包代际写实际安装件（当前 6 件、折叠前 12 件）；构建脚本的 apps → storage 边进入边界契约（静态可见边）。
- 与计划的偏差：无范围外改动；anti-hollow 强化、真实卷负控、provider-probe 契约与 Node engines 按 D3/D4 留给 #660/#313。
- 遗留：独立复评、hosted marker 负控、issue 验收勾选与 rebase merge；`#662` 由本 PR 关闭，`#663` 关闭本批；`#660` 保持 OPEN。

## Bottom Change Note

- 2026-11-18：创建。范围来自 #656–#659 的合并后评审记录、#660/#662/#313 与本次人类要求（一个修复 PR）。
- 2026-11-18：实现与本地验证完成；补 Surprises（目录创建无 reparse flag、管理员阶段原生回归、边界测试注释的 `*/` 陷阱）与 Outcomes；hosted 证据待 PR 精确 head。

- 2026-11-18：review #664 APPROVED WITH NOTES（5 P2/10 P3，无 P0/P1；head `78233077`）；按 findings 修复并补 Batch 5。
- 2026-11-18：hosted 修复 head 全绿；marker 负控 A/B 取得实际红证；独立复评收敛后归档；残余由 #665（reparse 加固）与 #666（ADR 指针）承接。