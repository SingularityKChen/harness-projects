# Windows 原生真实卷/映射盘拒绝证据 ExecPlan

> 状态：Completed（2026-11-24 归档；rev-689 首审 APPROVE WITH NOTES + 修复轮复评可 ready）
> 创建：2026-11-24
> 范围：在现有 `windows-native` 阶段 2 内，用管理员预置的 exFAT 与 ReFS 固定 VHD、回环 SMB 共享，证明生产 Host/helper 在可用端点与私有库/日志写入之前拒绝真实非 NTFS 本地卷（现实 exFAT 介质与文件系统 gate）与真实映射盘，并把用例接入 `SETS`/marker/契约/文档。
> 上游输入：issue #679（`test(ci): verify Windows volume refusal on real filesystem fixtures`，Closes #679）、#660（Refs）、权威规划 issue #678；`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、`docs/development/ci.md`、`docs/review/README.md`、`docs/exec-plan/completed/2026-11-17-windows-native-lane.md`；2026-11-24 独立设计评审与 Lead 裁决（结论见 Decision Log）。

## Purpose / Big Picture

完成后，唯一必需的 Windows 原生 lane 不再只证明“固定 NTFS 卷上一切正常”，而是用三类**真实设备**证明安全准入 gate 在真实卷类型上生效：

1. 真实 exFAT 固定卷（256MB VHD，现实外接介质场景）在 `host-private-windows.ts` 的卷准入阶段被拒绝：真实 exFAT 卷根的文件标识为 0，identity gate（`:178`）先于文件系统 gate（`:181`）拒绝；
2. 真实 ReFS 固定卷（4GB sparse VHD）在卷文件系统 gate（`:181`）被拒绝：ReFS 有真实 file ID，identity gate 通过后才命中 filesystem gate；
3. 真实映射网络盘（回环 SMB + 标准用户会话内 `net use`）在 DriveType gate（`:224`）被拒绝；
4. 上述拒绝都发生在任何私有对象（`harness-projects`、`workspace.sqlite`、`diagnostics.log`、sidecar）创建之前，拒绝前后哨兵字节/元数据不变；
5. 同一文件、同一标准用户、同一生产入口在真实固定 NTFS 上被接纳，排除“拒绝一切”的假绿；
6. 拒绝分支用 helper 自己的 stdout token 判别（`volume-identity` / `volume-filesystem` / `binding-drive`），不接受只断言 generic denied。

最小成功证据：当前 PR head 的 `windows-native` 绿，日志中 `private-data` marker 为 `files=4 skipped=0`，出现三类设备事实、含各自精确 token 断言的拒绝用例通过行、`standard-user exit=0`；成功日志不要求输出原始 token 或 `writes=0` receipt。同一 head 的 `PR Fast Gate` 绿；两条 scratch 负控分别证明“gate 被放宽则新用例如实红”和“fixture 缺失则如实红而不是 skip 绿”。

## Context and Orientation

- 基线：`main = eadf4901`（2026-11-24 观察）。本计划所有行号都以该提交为准；实现分支 `test/native-volume-refusal-20261124`，worktree `.worktrees/iteration12-native-volume-refusal/`。
- lane 结构：`ci.yml` 只有 4 个 job（`verify`/`browser`/`windows-native`/`fast-gate`），唯一必需检查是聚合的 `PR Fast Gate`（`ci.yml:204-219`；`tests/contract/ci-browser-workflow.test.js:35,:57,:72-89`）。`windows-native` 跑 hosted `windows-2025`、`timeout-minutes: 15`、`defaults.run.shell: pwsh`（`ci.yml:81-100`）。
- 唯一清单：`scripts/windows-native-checks.mjs` 的 `SETS`（`:47-64`）：`native-git` 3 文件 / `private-data` 3 文件，两组 `allowedSkips: 0`；marker 形如 `windows-native-checks: set=private-data files=3 tests=\d+ skipped=0 todo=0`（YAML `:186`），marker 期望由 `SETS` 在契约测试中推导（`tests/contract/ci-windows-workflow.test.js:37-39`）。YAML 不得内联 `.test.js`（同文件 `:102-104`）。
- 两阶段身份：阶段 1（管理员）跑 `native-git`；阶段 2 在同一 step 的 `try/finally` 内建临时标准本地账户（仅 `Users`）、初始化 profile、管理员预置 foreign fixture，再 `Start-Process -Credential -LoadUserProfile` 以标准用户跑 `--set private-data`，清理在 `finally`（`ci.yml:134-198`；`tests/contract/ci-windows-workflow.test.js:82-104`；`docs/development/ci.md:52`）。标准用户身份由 `ordinaryToken` 自证 `admin:false`/`adminMember:false`（`tests/integration/harness-plugin-windows-fixture.js:71-81`）。
- 被验证产品：`prepareWindowsProjectData(profile)` 只接受 `^[A-Za-z]:\` 盘符路径，先 `DriveInfo($drive).DriveType -ne 'Fixed' ⇒ throw 'drive'`（phase 初始 `binding`，`:14/:220-224`），再打开卷根并检查 `GetVolumeInformationByHandleW` 的文件系统名 `-cne 'NTFS' ⇒ throw 'filesystem'`（phase `volume`，`:157-189`，`:181`），随后才做卷 GUID/安全描述符与 `harness-projects`/`workspace.sqlite`/`diagnostics.log` 的创建（`:226-235`）。失败在 helper 内折叠为 `private-windows-error-<phase>-<code>` 写到 stdout（`:247-255`）后 exit 1；对外 JS 一律折叠成 `HostAuthorityError('Host project data is unavailable')`（`:263`、`:325-333`）。
- 现有证据的缺口：`private-data` 已有 39 条原生用例，包括 `subst` 盘符负例（`tests/integration/harness-plugin-windows-private-data.test.js:219-236`）与“拒绝零写入 + NTFS 正控”矩阵（`:337-347`、`:396-424`），但 `subst` 的 `DriveType` 是 `Fixed`，不覆盖 `binding-drive` 分支，也不覆盖真实非 NTFS 卷；且现有负例只断言 generic denied，gate 被删除或后移时仍会因后续 gate 拒绝而保持绿。
- 现状证据口径：本机 macOS 只能证明 manifest/marker/契约/纯函数/文档；任何 win32 原生行为只能由 PR CI 证明（`scripts/windows-native-checks.mjs:110-113` 拒绝非 win32）。基线 Windows Native job 耗时的历史观察是 `gh run view <run-id> -R SingularityKChen/harness-projects --json jobs` 的回读值，不写入本计划当永久事实。

## Design / Spec

### 选定机制（系统边界不变）

```
[管理员] ci.yml 阶段 2 同一 step 的 try（既有 try/finally）
  ├─ 建临时标准账户 / profile / foreign fixture（既有）
  ├─ $stage='volume-fixture'：New-FixtureVolume 建两块真实固定卷（GUID 名 VHD）
  │    exFAT：256MB expandable，format fs=exfat quick label=HARNESSFAT
  │    ReFS ：4GB sparse expandable，format fs=refs quick label=HARNESSRFS
  │    diskpart: create vdisk → select vdisk file=… → attach vdisk
  │              → create partition primary → format fs=… quick label=…
  │              → assign letter=<预检空闲盘符>
  │    原生事实校验：Win32_LogicalDisk 恰好一条对应 VolumeName，
  │                  DriveType=3(Fixed)、FileSystem 分别为 exFAT/ReFS；不符即 throw
  ├─ $stage='share-fixture'：ProgramData\harness-vol-share-<guid>
  │    icacls 只授临时账户 Modify；New-SmbShare -Name harness-vol-fixture
  │    -FullAccess \\<COMPUTERNAME>\\<temp-user>；Get-SmbShareAccess 断言无 broad 主体
  ├─ Start-Process -Credential（既有，参数不变）→ [标准用户] windows-native-checks.mjs --set private-data
  │    └─ SETS['private-data'] 第 4 个文件：harness-plugin-windows-volume.test.js
  │         ├─ 以 spawn 的 PowerShell 子进程探测设备事实（与产品 helper 同会话可见性）
  │         ├─ 建哨兵/可写对照 → spawn tee 捕获 helper token → 生产入口拒绝
  │         ├─ 拒绝前后快照深比较 + Host apply 拒绝（services/live 为 0）
  │         └─ 同文件 NTFS 正控（windowsFixture + prepareWindowsProjectData 被接纳）
  └─ finally：先 Remove-SmbShare / detach vdisk / 删 VHD 与共享目录（`-ErrorAction SilentlyContinue` 静默吞掉清理失败），
       再加既有 profile/账户清理
```

- 状态拥有：设备（VHD 文件、卷、SMB 共享、ProgramData 目录）归阶段 2 的 YAML 片段；映射盘符归**标准用户测试进程**（per-logon-session，管理员无法代替它拥有该状态）；断言与证据归新测试文件；清单归 `SETS`；拒绝分支归产品 helper。测试进程不自我提权。
- 设备发现契约（不新增 argv/env 管道）：卷用固定标签 `HARNESSFAT` / `HARNESSRFS`（均 10 字符，不超过 exFAT/FAT 的 11 字符上限）经 `Win32_LogicalDisk` 发现；共享用固定名 `harness-vol-fixture`，UNC 由标准用户进程用 `$env:COMPUTERNAME` 拼接。`Start-Process -Credential` 用目标用户环境创建进程，不继承调用者自定义环境变量（既有 fixture 坐标因此都走 argv：`ci.yml:168-177`）；新增 `--volume/--mapped` 还会改动 `parseArgs` 返回形状，而该形状被两条 `assert.deepEqual` 精确钉住（`tests/contract/windows-native-checks.test.js:93-96`）。发现失败 = 测试显式红（不 skip），不引入第二事实源；若发现式坐标在 Batch 0 被证明不可行，降级为 argv 需先报告 Lead 批准（Q4），不预授权。
- 证据深度（四段式，顺序固定）：
  1. **设备事实先于产品断言**：用测试侧 spawn 的 PowerShell 子进程（与产品 helper 相同会话语义）断言 `DriveType/DriveTypeCode`、`FileSystem`、`VolumeLabel`、`ProviderName`，并以写/读/删探测文件证明目标目录当时可达可写；事实断言失败即红，避免“fixture 缺失 → NoRootDirectory → 也报 drive” 的假绿。
  2. **精确 token**：monkey-patch `childProcess.spawn` 累积子进程 stdout（生产 `import childProcess from 'node:child_process'` 并在 `:273` 取 `.spawn`，patch 有效；先例 `harness-plugin-windows-private-data.test.js:358-365` 证明可读）；期望 `private-windows-error-volume-identity`（exFAT）/ `private-windows-error-volume-filesystem`（ReFS）/ `private-windows-error-binding-drive`（映射盘），token 缺失或不符即红。
  3. **零写入与 AC2 哨兵**：`prepareWindowsProjectData` 与 `hostFixture(apply)` 都拒绝（后者在 catch 中断言 `services.size === 0 && live.size === 0`）。拒绝前在两块真实卷根与映射盘共享根各预置固定字节哨兵（记录 size/mtime/sha256），拒绝后逐项断言不变。两块真实卷根另做**定点检查**：非递归列出卷根可见条目并前后比较、按声明名检查 `harness-projects`/`workspace.sqlite*`/`diagnostics.log` 不存在、目标 profile 路径拒绝前后都不存在；不递归进入 `System Volume Information` 等系统目录（ReFS 卷根存在标准用户不可读的系统目录）。映射盘共享根没有系统目录，保留递归快照（条目集合 + 每文件字节 sha256 + 大小 + mtime）。
  4. **正控**：同文件用 `windowsFixture(t)` 建真实 NTFS fixture，`prepareWindowsProjectData(f.profile)` 被接纳、`signal.aborted === false`、私有对象存在，随后关 fd 并 `dispose()`；同时断言 C: 为 `Fixed`+NTFS。
- 拒绝 token 由代码结构决定：mapped 路径在 `:224` 抛 `drive` 时 `$script:phase` 仍为 `binding`；exFAT 路径的真实卷根在 `:178` 就已因文件标识为 0 抛 `identity`（phase `volume`），文件系统 gate 在真实 exFAT 上不可达；ReFS 有真实 file ID，在 `:181` 抛 `filesystem`（phase `volume`）。两卷并行正是为同时保留“现实 exFAT 介质仍被拒”与“filesystem 分支可判别”：spike run `45401513696` 实测 ReFS=`volume-filesystem`、放宽 NTFS gate 后 ReFS=`volume-ancestor`，exFAT/FAT32 放宽后仍 `volume-identity`。不改产品 gate 顺序。
- AC2 的 “protected sentinel bytes and object metadata unchanged” 的实际表达：拒绝前在两块卷根与映射盘共享根各预置固定字节哨兵（`volume-refusal-sentinel.bin` / `mapped-refusal-sentinel.bin`，记录 size/mtime/sha256），拒绝后逐项断言不变；卷根另做非递归条目集合比较 + 声明私有对象名 + 目标 profile 不存在（不进入系统目录），映射盘共享根保留递归快照。exFAT 无 ACL 语义、ReFS 的 ACL 不参与本判定（拒绝发生在创建对象之前）；ACL/owner 证据由既有 NTFS 正控与 `trustedAcl` 覆盖。共享侧是 NTFS 目录，`Get-SmbShareAccess` 与 `icacls` 只授临时账户，不授 `Everyone`/`Users`/`Anonymous`。

### 被放弃的方案（及理由）

- **新增 job/lane（`windows-native-volumes`）或 dispatch-only 证据**：不放进 `fast-gate.needs` 就不阻断合并，证据会腐烂；放进去要改 `tests/contract/ci-browser-workflow.test.js` 的 4-job/64 组合聚合契约并复制一份身份与清理逻辑（`ci.yml` 阶段 2 约 60 行）。issue #679 明确要求复用 SETS/身份/清理；dispatch-only 只留一次性 run 链接，没有回归保护。
- **改产品错误面**（让 `HostAuthorityError` 携带 reason code）：#660 明确保留 Host ABI，且拒绝原因折叠是刻意的安全面；测试侧读 helper 自有 stdout 即可获得分支判别力，不需要改产品。
- **mock `DriveInfo` / 畸形字符串 / `New-PSDrive` / `subst` 充当网络盘**：issue AC1 明文不认；`subst` 是 `Fixed`，打不到 `binding-drive`；`New-PSDrive` 是 provider 级映射，`IO.DriveInfo` 看不到。
- **只保留单一非 NTFS 卷（仅 exFAT 或仅 ReFS）**：仅 exFAT 时 filesystem 分支与 NC-1 不可证伪（identity gate 先拒绝）；仅 ReFS 时最终 head 丢掉“现实 exFAT 外接介质仍被拒”的证据。Lead 2026-11-24 裁决保留 exFAT + ReFS 两块真实卷，两卷共享同一预置/发现/清理路径。
- **把 fixture 坐标用 argv/env 传进标准用户进程**：见上节，成本与契约耦合不划算；仅作为发现式坐标失败时的降级选项（需 Lead 批准，+约 30 行并改两条契约断言）。
- **FAT32 替代 exFAT**：两者都满足 AC “non-NTFS”；Lead 2026-11-24 裁决 Q3 允许在 exFAT 不可用时显式切换。spike run `45401513696` 实测 FAT32 与 exFAT 一样在真实卷根被 identity gate 先拒绝、不增加 filesystem 分支判别力，因此 FAT32 不作为 fixture；卷标上限 11 字符对两者同样适用。

### 关键不变量

1. 无产品行为变更：diff 不触碰 `apps/`、`packages/`、Host ABI、错误面、schema。
2. 事实先于断言、token 先于结论：不接受只断言 generic denied。
3. 拒绝先于写入：零新对象、哨兵字节/元数据不变、Host apply 无可用端点。
4. 不是拒绝一切：同文件、同函数、同身份的 NTFS 正控被接纳。
5. 清单唯一、零 skip、无 retry/无 `if`/无 `continue-on-error`；`allowedSkips` 保持 0。
6. 清理定向有界：只按本次自建的 VHD 文件、固定共享名、自建 ProgramData 目录、自建账户操作；不做 `select disk`/`clean`/`net use *`，不碰无关盘/共享/profile。
7. 身份真实：所有产品断言在标准用户进程内执行并有 `ordinaryToken` 自证；管理员只预置/清理。

## Global Constraints

- 写入边界（唯一声明，其他章节只引用本节）：`.github/workflows/ci.yml`、`scripts/windows-native-checks.mjs`、`tests/integration/harness-plugin-windows-volume.test.js`（新）、`tests/fixtures/windows-volume-fixture.js`（新，共享测试 helper；契约与集成都只 import 它，不被层收集）、`tests/contract/windows-volume-fixture.test.js`（新）、`tests/contract/ci-windows-workflow.test.js`、`docs/development/ci.md`、`docs/README.md`（只加/移动本计划一行）、`docs/exec-plan/completed/2026-11-24-native-volume-refusal.md`（新）。
- 不做清单：不改 `apps/**`、`packages/**`、Host ABI/错误文案、schema/迁移/数据；不新增 job/lane/set/workflow、不改 `fast-gate.needs`/权限/action pin/secrets；不加 `if`/`continue-on-error`/retry/动态 skip；不新增依赖或 model/session 调用；不写 Project `Status`/`blocked-by`/`blocking`；不合并 PR；不关 #660/#642/#647/R1，不宣称 network/non-NTFS 存储支持或 Win11 Desktop 资格；不纳入 Git provider 的 `windowsPathsArePlain` 探针（#681/#660 范围；Lead 2026-11-24 裁决 Q1：不纳入，该边界写入 PR 的 Not-proven 列表）。
  **Superseded（2026-11-25，D25-1–D25-2）**：只对直接授权的 PR #687–#689，由本评审会话执行后续条件 rebase merge、相关分支历史整理与范围内清理；恢复点和精确 lease 是改写前置条件。Planning Status、依赖关系、产品范围与 R1 边界保持。本轮修复额外允许串行更新 `docs/review/README.md` 的 #689 索引一行。
- 并行写集：本 PR 不改 `package.json`/`.nvmrc`/`tsconfig*`/`tests/contract/host-node-types.test.js`/`docs/development/workflow.md`（#313 写集），不改 `docs/adr/**`（#666 写集）；`docs/README.md` 只允许本计划一行（起草时加入 Active 表，归档时同一行移入 Completed，Lead 裁决 Q5），保证三份 PR 文件集互不重叠。
- 预算：技术增删 ≤800（本 issue 目标 350–620），含全部文档 ≤1300（估算文档约 300）；以 `node scripts/rule-checks.mjs size main` 的 printed totals 判定。
- 证据诚实：本机 macOS 不产生任何原生证据；hosted 结论必须以当前 head 回读为准（`gh pr checks`/`gh run view`），易失值写成“命令 + 期望”，不写成永久事实。
- 发布面：日志只写盘符、标签、文件系统、驱动类型、token、marker 与 `<fixture>` 令牌化后的路径；不写密码、账户名、runner 绝对路径；提交前跑 `rule-checks disclosure` 并做人工五类目检查。
- 失败语义：fixture 预置失败 → 既有 `catch` 的 `windows-native-harness-failure stage=…` + `nativeExit=1`（红，不 skip）；清理命令一律 `-ErrorAction SilentlyContinue`，失败被静默吞掉（不产生 warning、不覆盖测试结论；一次性 runner 无残留）；hosted 无法构造设备 → 按 AC3 写显式 blocked evidence，`#679` 保持 open，`Closes` 改 `Refs`，报告 Lead。

## Plan of Work

### Batch 0 · Spike 门（scratch 分支，不进入 PR）

**最小闭环**：在 hosted `windows-2025` 实测（a）`diskpart` 建/挂 256MB expandable VHD、`format fs=exfat quick label=HARNESSFAT` 后卷是 `DriveType=Fixed`/`FileSystem=exFAT` 且标准用户可写；（b）标准用户会话内 `net use` 回环 SMB 映射成功、`DriveType=Network`、`ProviderName` 指向该共享、可写。任一不成立即按失败阶梯处理，不进入 Batch 1。
**涉及文件**：scratch 分支上的 `.github/workflows/ci.yml`（临时 `volume-probe` job，不合并；main 与工作分支无改动）。
**步骤**：

1. `git switch -c scratch/679-volume-spike main`；在 `ci.yml` 加 job `volume-probe`（`runs-on: windows-2025`、`timeout-minutes: 15`、`if: ${{ github.event_name == 'workflow_dispatch' }}`），单 step 内联 pwsh：建临时标准账户并初始化 profile → `RUNNER_TEMP` 下 GUID 名 VHD（`diskpart` 脚本：`create vdisk file=… maximum=256 type=expandable` / `select vdisk file=…` / `attach vdisk` / `create partition primary` / `format fs=exfat quick label=HARNESSFAT` / `assign letter=<空闲盘符>`，检查 `$LASTEXITCODE`）→ `Get-CimInstance Win32_LogicalDisk` 断言事实 → `ProgramData\harness-vol-share-<guid>` + `icacls` 只授临时账户 + `New-SmbShare -Name harness-vol-fixture` → 把标准用户探针脚本写到 `$env:PUBLIC\harness-volume-spike-<guid>.ps1` → `Start-Process powershell.exe -Credential $credential -LoadUserProfile -Wait` 执行探针（身份自证、按标签发现卷并写哨兵、查事实、`net use` 映射并写映射盘哨兵、`net use /delete`）→ `finally` 删共享/删除挂载并删 VHD/删共享目录/删账户（仅 warning）。
2. `git add -A && git commit -m "chore(ci): 临时卷/映射探针（scratch，不合并）" && git push -u origin scratch/679-volume-spike`。
3. `gh workflow run ci.yml -R SingularityKChen/harness-projects --ref scratch/679-volume-spike`；`gh run list -R SingularityKChen/harness-projects --workflow ci.yml --branch scratch/679-volume-spike --limit 1 --json databaseId,headSha,conclusion`。
4. `gh run view <run-id> -R SingularityKChen/harness-projects --log | grep -E 'volume-spike'`。

**验证**：日志至少出现 `volume-spike: vhd letter=<X> driveType=Fixed fileSystem=exFAT label=HARNESSFAT elapsed_ms=<n>`、`volume-spike: user admin=False adminMember=False`、`volume-spike: volume-write ok=True`、`volume-spike: mapping letter=<Y> driveType=Network providerName=\\<host>\harness-vol-fixture`、`volume-spike: mapped-write ok=True`。scratch 分支的 `verify` 预期红（临时新增 job 破坏 `tests/contract/ci-browser-workflow.test.js:35` 的 4-job 断言），属预期噪音；证据只取 `volume-probe` job 的日志、结论与时长（`gh run view <run-id> --json jobs`）。
**门控与失败阶梯**：两类事实都成立 → 进入 Batch 1（L1，5 条顶层用例）。仅 VHD 成立、映射不成立 → 进入 Batch 1 但只实现 VHD 半区（L2，4 条顶层用例、`minTests: 4`），映射半区在 Progress/Surprises 记为 blocked evidence，PR 用 `Refs #679`，`#679` 保持 open 并报告 Lead。VHD 不成立 → 停在 Batch 0：删除 scratch，不落 fixture 代码，在 Surprises/Progress 记录 blocked evidence（run id、head、`ImageVersion`、错误行、探针输出），报告 Lead。
**回滚**：`gh api -X DELETE repos/SingularityKChen/harness-projects/git/refs/heads/scratch/679-volume-spike`；回到工作分支后 `git branch -D scratch/679-volume-spike`；main 与工作分支零改动。

### Batch 1 · 接线与本地判别 RED→GREEN（macOS 可证）

**最小闭环**：`SETS`↔marker↔契约一致，helper 纯逻辑（卷标上限、快照比较、token 分片重组）在 POSIX 有判别测试，YAML 的预置/清理在静态契约下可审。
**涉及文件**：见 `Global Constraints` 的写入边界（本批主要改 `scripts/windows-native-checks.mjs`、新测试文件与 `tests/fixtures/windows-volume-fixture.js`、`.github/workflows/ci.yml`、`tests/contract/ci-windows-workflow.test.js`，并提交 `docs/exec-plan/completed/2026-11-24-native-volume-refusal.md`）。
**步骤**：

1. 阶段 1：提交本 ExecPlan 与 `docs/README.md` 索引行并 push；draft PR 由 Lead 创建（`Refs #679`，Batch 2 通过两类设备后改 `Closes #679`）。
2. RED-A：只改 `scripts/windows-native-checks.mjs` 的 `SETS['private-data'].files` 追加 `{ file: 'tests/integration/harness-plugin-windows-volume.test.js', minTests: 5 }`（L2 为 4），不建文件；`node --test tests/contract/windows-native-checks.test.js` 期望红，消息含 `文件不存在或不是普通文件：tests/integration/harness-plugin-windows-volume.test.js`。
3. GREEN-A：新建共享 helper（常量 `HARNESSFAT`/`HARNESSRFS`/`harness-vol-fixture`、哨兵字节、`snapshotTree`/`assertTreeUnchanged`、`createTokenTap`/`assertRefusalToken`、`driveFacts`/`findVolumeDrive`、`mapDrive`/`unmapDrive`、`assertWritable`、`assertNoPrivateObjects`；POSIX 上 import 无副作用）与 5 条顶层用例骨架（`{ skip: process.platform !== 'win32' }`），再建 `tests/contract/windows-volume-fixture.test.js` 测纯逻辑；同命令期望 `ℹ fail 0`。
4. RED-B：`node --test tests/contract/ci-windows-workflow.test.js` 期望红（SETS 变 4 而 YAML marker 仍 `files=3`，报 `private-data 入口必须断言通过 marker`）。
5. GREEN-B：在 `ci.yml` 阶段 2 的 `try` 内（foreign fixture 之后、`Start-Process` 之前）插入 `$stage='volume-fixture'` 与 `$stage='share-fixture'` 的预置片段，`finally` 开头插入定向清理（顺序在既有 profile/账户清理之前），marker 字面量 `files=3`→`files=4`；在 `tests/contract/ci-windows-workflow.test.js` 增加 6–8 条语义锚点（`diskpart`、`format fs=$FileSystem`、两卷的 `New-FixtureVolume` 调用与卷标、`New-SmbShare`、`Remove-SmbShare`、detach、清理位于 `finally` 之后、无 broad 主体、无 `net use *`）；同命令期望 `ℹ fail 0`。
6. 跑 `Validation and Acceptance` 第 1 组命令并记录输出。

**验证**：见 Validation `1（关键：两个契约测试 `ℹ fail 0`；新 contract 测试证明卷标 >11 字符、两卷卷标互异、快照能识别新增对象/字节变化、跨 chunk token 能重组、无 token 时断言必须抛错）。
**回滚**：以同组 commit 一起 revert（只回退其中一部分会让 lane 红或契约红）；或删除分支重建。

### Batch 2 · Hosted 原生证据 RED→GREEN（首次 PR CI）

**最小闭环**：当前 PR head 的 `windows-native` 真实执行 5 条新用例并通过：marker `files=4 skipped=0`，三类设备事实、三个精确 token、`standard-user exit=0` 可回读；若事实或 token 与预期不符，在同一 PR 内一次性校准并保留首跑证据。
**涉及文件**：Batch 1 的文件（仅修正断言/常量时改动）。
**步骤**：

1. push 分支；`gh pr checks <PR> -R SingularityKChen/harness-projects` 期望 Verify/Browser 绿；Windows Native 若红，先读失败断言与 `stage=volume-fixture|share-fixture`：fixture 阶段红按 Batch 0 结论走失败阶梯，产品断言红按实际 token/事实校准，不得加 skip 或重试变绿。
2. 绿证回读：Validation `2 的 `gh run view … --log | grep -E …` 与 `--json jobs`。
3. 若 `tests` 数低于 `minTests`（例如把两个用例合并了），按实际顶层用例数在同一 PR 内一次性修正 `minTests`（单调下限；偏高即红，偏低只是弱约束）。
4. exFAT 首跑（run `45399781677`）实测 token 为 `volume-identity` 后，为保住 filesystem 分支判别力追加 ReFS 卷（见 Progress/Surprises 的 spike run `45401513696` 证据）；两块卷的预置/发现/清理由同一 helper 与同一 `finally` 路径承担。

**验证**：Validation `2；另在 PR 描述记录第一组 hosted 事实行与 run id（不写绝对路径与账户名）。
**回滚**：revert Batch 1 同组 commit；lane 回到 `files=3` 基线，无数据/ABI 影响。

### Batch 3 · 失败控制、文档与最终证据

**最小闭环**：AC4 的 “meaningful native failure control” 有真实 run 记录；文档同步；最终 head 的 checks 与 issue 关联回读通过。
**步骤**：

1. NC-1（filesystem gate 放宽必须红）：从 PR head 拉 `scratch/679-nc-gate`，把 `host-private-windows.ts:181` 的 `-cne 'NTFS'` 放宽为 `-notin @('NTFS','ReFS')`（scratch only，不改 PR head）；`gh workflow run ci.yml --ref scratch/679-nc-gate`；期望 `windows-native` 与 `PR Fast Gate` 红、`verify`/`browser` 绿：ReFS 用例 observed token 变为 `private-windows-error-volume-ancestor`（spike run `45401513696` 已实测），不再等于期望的 `volume-filesystem`。同时记录 exFAT 半区放宽后仍是 `volume-identity`——它的 token 语义已在设计/文档显式声明，不是 hollow。记录 run id + 失败断言行后删除 scratch。
2. NC-2（fixture 缺失必须红）：从 PR head 拉 `scratch/679-nc-fixture`，删掉两块卷与共享的预置片段并同步移除该 scratch 上的新静态锚点测试（只改 scratch，避免 verify 因静态锚点红），保留 `SETS`/marker；dispatch；期望 `windows-native` 红在本文件的显式消息「按卷标 HARNESSFAT 发现的候选卷必须恰好一个，实际 0」，而不是 skip 或绿；`verify`/`browser` 绿。记录后删除 scratch。
3. 文档：`docs/development/ci.md` 在「Windows 原生 lane」内新增「真实卷/映射盘拒绝证据（#679）」段（机制、身份/会话边界、断言设备事实与 token、零写入与正控、失败语义与 `stage` 归属、成本、证据边界、blocked 协议），并把 `:50`/`:54` 的“三条文件”等过时表述改为四条，写清“exFAT 现实介质被 identity gate 更早拒绝、ReFS 用于精确 filesystem 分支”的两卷理由；同步本 ExecPlan 的 Progress/Surprises/Decision Log/Outcomes。
4. 最终 head 证据：正式 head 连续两次 `gh workflow run ci.yml -R SingularityKChen/harness-projects --ref test/native-volume-refusal-20261124` 成功，且 PR 的 `pull_request` run 成功；回读 head/base/mergeStateStatus/checks/closingIssuesReferences/review threads（Validation `3）。
5. 收口检查：`Validation `1` 的规模/发布面/空白命令。

**验证**：Validation `2、`3 与 NC 期望矩阵。
**回滚**：NC 分支删除即回滚；文档 revert 无行为影响；最终证据必须重取，不沿用旧 head 结论。

## Validation and Acceptance

本机（在检出 `test/native-volume-refusal-20261124` 的 worktree `.worktrees/iteration12-native-volume-refusal/` 根目录运行；macOS 只证明契约/纯函数/文档）：

1. `node --test tests/contract/windows-volume-fixture.test.js` → `ℹ fail 0`。
2. `node --test tests/contract/ci-windows-workflow.test.js tests/contract/windows-native-checks.test.js` → `ℹ fail 0`。
3. `node scripts/windows-native-checks.mjs --set private-data` → exit 1，输出含 `::error::windows-native-checks:` 与 `win32`（证明本机不产出原生证据）。
4. `node scripts/workflow-check.mjs` → `workflow-check: no findings`。
5. `pnpm typecheck` → 0；`pnpm run boundaries` → `ℹ fail 0`。
6. `pnpm verify` → 0（contract/integration/e2e 各层非空；新 integration 文件在 darwin 全 skip，不改变层判定）。
7. `node scripts/rule-checks.mjs size main` → 打印 code ≤800、docs ≤1300（本轮口径）；`node scripts/rule-checks.mjs disclosure main` → 无命中。
8. `git diff --check main...HEAD` → 无输出。

Hosted（`-R SingularityKChen/harness-projects`；只在当前 head 上回读）：

9. `gh pr checks <PR>` → Verify、Browser、Windows Native、PR Fast Gate 全部 pass。
10. `gh run view <RUN_ID> --log | grep -E 'windows-native-checks: set=private-data files=4 tests=[0-9]+ skipped=0 todo=0|standard-user exit=0'` → marker 一条、`standard-user exit=0` 一条；再 `grep -E 'native exFAT fixed volume|native ReFS fixed volume|native mapped network drive|native NTFS positive control|native volume refusals publish no Host authority|ℹ \{"label":"HARNESSFAT"|ℹ \{"label":"HARNESSRFS"'` → 5 条 `✔` 用例名与两条设备事实诊断行（`ℹ {"label":"HARNESSFAT","fileSystem":"exFAT",…}`、`ℹ {"label":"HARNESSRFS","fileSystem":"ReFS",…}`）均出现（用 `tests=[0-9]+` 而非 `tests=\d+`，避免 `--log` 回显源码行造成的假匹配；测试没有独立日志前缀，事实只以 node test 的 diagnostic 行呈现）。
11. `gh run view <RUN_ID> --json jobs --jq '.jobs[]|select(.name|startswith("Windows Native"))|{conclusion,startedAt,completedAt}'` → `success`，时长 < 900s（回读值，不写成永久事实）。
12. NC-1/NC-2 run → `windows-native` 与 `PR Fast Gate` 红、`verify`/`browser` 绿，失败消息分别指出 ReFS token 由 `volume-filesystem` 变为 `volume-ancestor`、以及卷标发现数为 0；run id 与失败行写入 PR/本计划。
13. 正式 head 两次 dispatch 与 PR `pull_request` run 同 head 且 success；`gh pr view <PR> --json headRefOid,baseRefName,mergeStateStatus,closingIssuesReferences` 回读 head/base/issue 关联。

AC 映射：AC1 → 第 10 条三类设备事实与各自精确 token 断言的测试通过（exFAT 现实介质 / ReFS filesystem 分支 / mapped 盘）；AC2 → 三设备哨兵的 sha256/size/mtime 逐项不变、卷根条目集合/声明私有对象/目标 profile 不存在断言、映射共享根递归快照 + YAML `Get-SmbShareAccess` 断言（无 broad 主体），不依赖独立 `writes=0` 日志；AC3 → 测试内 `ordinaryToken` 诊断（`admin=False/adminMember=False`）+ YAML 同一 step `try/finally` 清理 + 第 12 条失败传播；AC4 → 第 10–13 条（SETS/marker/契约/零 skip/Linux 层/current-SHA/负控）；AC5 → PR 正文与 Outcome 的 Not-proven 列表（不关 #660/#642/#647/R1、不宣称 Desktop 资格）。

## Progress

- [x] 阶段 1 · 计划起草、评审附录清理与 `docs/README.md` 索引行（2026-11-24）
- [x] Batch 0 · spike 门（2026-11-24）：hosted `windows-2025` 上 exFAT 固定 VHD 与标准用户回环 SMB 映射盘均成立，走 L1 全量路径；spike run `45398368511`（首跑 `45397836950` 为驱动脚本缺陷），scratch ref 已删除。
- [x] Batch 1 · 接线与本地判别 RED→GREEN（2026-11-24）：SETS 第 4 文件（`minTests: 5`）→ ENOENT RED；共享 fixture、契约测试与 5 条集成用例完成后契约 17/17；YAML marker `files=4` 修复前 `ci-windows-workflow` RED；本地变异 M1（卷文件系统字面量）/ M2（清理共享名）均 KILLED（M2 首版锚点 SURVIVED 后收紧）；darwin 上 5 skipped；workflow-check / typecheck / boundaries / verify 全绿。
- [x] Batch 2 · Hosted 原生证据（2026-11-24）：首跑 run `45399781677` 在真实 exFAT 卷实测 token=`volume-identity`（按首跑协议校准后 run `45400911352` 全绿，Windows Native 5m0s）；为保住 filesystem 分支判别力，spike run `45401513696` 实测 ReFS=`volume-filesystem`、放宽 NTFS gate 后 ReFS=`volume-ancestor`（exFAT/FAT32 仍 `volume-identity`），Lead 裁决保留 exFAT+ReFS 双卷；双卷最终 head（`e396f97`）的 PR run `45404414163` 全绿：Verify 2m38s、Browser 2m39s、Windows Native 5m20s、PR Fast Gate 绿。
- [x] Batch 3 · NC-1/NC-2 与文档（2026-11-24）：NC-1 scratch run `45404618033`（放宽 `:181` 的 NTFS gate 接受 ReFS）→ Windows Native / PR Fast Gate 红、Verify / Browser 绿，ReFS 用例 `缺少精确拒绝 token private-windows-error-volume-filesystem；observed=["private-windows-error-volume-ancestor"]`，同轮 exFAT 用例仍绿（放宽后仍 `volume-identity`）；NC-2 scratch run `45404711047`（删两块 VHD 与共享预置）→ Windows Native / PR Fast Gate 红、Verify / Browser 绿，4/5 用例红在本文件显式消息（`按卷标 HARNESSFAT 发现的候选卷必须恰好一个，实际 0`、`HARNESSRFS … 实际 0`、`net.exe use …` 失败），`skipped 0`、NTFS 正控仍绿。两份 scratch ref 已删除。`docs/development/ci.md` 新增真实卷/映射盘段并把“三条文件”改为四条。
- [x] 最终 head 回读（2026-11-24）：实现/文档 head `5902d925` 的 PR run `45405900553` 与两次 `workflow_dispatch`（`45405917317`、`45406610662`）全部 success（Windows Native 5m02s / 5m01s / 5m03s，PR Fast Gate success）；docs-only 证据回填提交（本提交）的 PR run 由 `gh pr checks 689` 回读，期望全 pass。
- [x] 修复轮（2026-11-24，rev-689 P3）：P3-4 在既有 5 条用例内补 AC2 哨兵（两块卷根与映射盘共享根预置固定字节、记录 size/mtime/sha256，拒绝后逐项断言不变；新增契约判别用例先 RED 后 GREEN）；P3-1/P3-2/P3-3 订正计划与 ci.md 的零写入/日志/清理语义（删除不可复现的 `windows-volume-fixture:` 前缀，改为实际 `ℹ {"label":…}` diagnostic 行；清理失败按 `-ErrorAction SilentlyContinue` 实况改写）；P3-6 补 `tests/contract/ci-windows-workflow.test.js` 尾换行；另因 hosted run `45412965600` 暴露 `path is not defined`，补 import 并加 POSIX 契约层“集成用例内建绑定导入守卫”（mutation 已证明判别力）。本地验证与最终 head 回读见 Outcomes。
- [x] 独立对抗验收（rev-689，2026-11-24）：首审 APPROVE WITH NOTES（无 P0/P1，不阻塞）+ P3 修复轮（AC2 哨兵、文档订正、尾换行、path 导入与导入守卫）；修复轮复评结论“可置 ready”；PR #689 已 ready 且 12/12 checks pass（含 PR Fast Gate），issue 双向关联已回读。
- [x] 归档（2026-11-24）：文件移入 `docs/exec-plan/completed/`（文件名不变），状态行改 Completed；`docs/README.md` 只动本计划两行（Active 行移除、Completed 行加入）。
- [x] 2026-11-25 R689-01–R689-04 局部修复准备：两个既有字节样例同大小且恢复 mtime、精确校验字节错误；两处源码头改 completed；成功日志与 AC2/评审索引写实。契约 20/20；M1–M4 整表 4/4 KILLED，详见 Outcomes。本批不新增顶层用例或通用框架，保持 Completed。
- [x] 2026-11-25 修复本身独立复评：R689-01–R689-04 全部关闭；三文件契约 20/20，M1–M4 整表 4/4 KILLED 且归因准确，workflow/路径/章节与 diff 检查通过；无新增发现，详见评审记录 §8。
- [ ] 2026-11-25 后续收尾：D25-2 恢复点与提交整理、逐真实 main/最终门禁回读、核对 #679、条件 rebase merge 与相关资产清理。
- 阻塞项：无。

## Surprises & Discoveries

- 2026-11-24（收敛评审，证据为 `main@eadf4901` 代码与独立设计评审记录）：候选设计在卷文件系统上不一致——一份正文与方案段用 exFAT，但其 YAML 片段写 `format fs=fat32`（自相矛盾）；另一份全程用 FAT32（`HARNESSFAT`，64MB）。收敛结论：按 Lead 裁决默认用 exFAT，并保留 11 字符卷标上限约束（`HARNESSFAT` = 10 字符）；FAT32 仅按 Q3 显式切换。
- 2026-11-24：一份候选设计的 exFAT 卷标常量 `HARNESS-NATIVE-EXFAT` 有 20 字符，超过 exFAT/FAT 卷标 11 字符上限，`format … label=` 会失败或截断；本计划改用 `HARNESSFAT`。
- 2026-11-24：共享根不能放在 `RUNNER_TEMP`（位于 runner 管理员 profile 下，标准用户对祖先目录没有 traverse 权限，共享级授权不足以绕过 NTFS ACL），改为 `$env:ProgramData\harness-vol-share-<guid>` + `icacls` 只授临时账户；这同时避免给 `Show-NativeOutput` 增加新的令牌化根。
- 2026-11-24：`ci.yml:7` 已有 `workflow_dispatch`，`gh workflow run ci.yml --ref <scratch>` 可直接使用；但 scratch 上新增 job 会破坏 `tests/contract/ci-browser-workflow.test.js:35` 的 4-job 断言，spike 的 `verify` 必红——这是预期的隔离噪音，证据只取 `volume-probe` job。
- 2026-11-24（Batch 0 spike）：`[IO.DriveInfo]::ProviderName` 在标准用户进程里对回环映射盘返回空串（run `45398368511`）；映射盘的 provider 事实改由 `Win32_NetworkConnection.RemoteName`（实测指向 `\\<runner-host>\harness-vol-fixture`）与 `Win32_LogicalDisk.ProviderName` 断言。Batch 1 不再依赖 `DriveInfo.ProviderName`。
- 2026-11-24（Batch 0 spike）：hosted `windows-2025` 上 256MB expandable VHD 的 exFAT 格式化一次即成，无需 1GB 回退；整个 spike job（建号/VHD/共享/标准用户探针/清理）约 50s（`gh run view <run-id> --json jobs` 回读）。
- 2026-11-24（Batch 0 spike）：spike 驱动脚本首跑在 `stage=account` 失败，原因是 Windows PowerShell 5.1 没有 `RandomNumberGenerator.GetBytes`（pwsh 7 专有）；改用 `Guid` 生成密码后成功。生产 lane 阶段 2 运行在 pwsh 7，新 fixture 片段仍避免依赖该 API。
- 2026-11-24（Batch 2 首跑 run `45399781677`）：真实 exFAT 卷根的 helper 拒绝 token 是 `private-windows-error-volume-identity` 而非 `volume-filesystem`——exFAT 卷根的 `BY_HANDLE_FILE_INFORMATION` 文件标识（index high/low）为 0，`:178` 的 identity gate 先于 `:181` 的 `GetVolumeInformationByHandleW` 文件系统 gate 拒绝。测试按计划首跑协议校准：exFAT 期望 token 固定为 `volume-identity`，用例名改为“volume admission gate”。Superseded by 2026-11-24 双卷裁决（下条）：ReFS 被追加用于精确命中 `filesystem` 分支，exFAT 保留为现实介质证据。
- 2026-11-24（token spike run `45401513696`，scratch ref 已删除）：真实非 NTFS 卷根 token 对比——exFAT=`private-windows-error-volume-identity`、FAT32=`volume-identity`、ReFS=`private-windows-error-volume-filesystem`；把 `:181` 的 NTFS gate 放宽为接受 ReFS 后，ReFS token 变为 `private-windows-error-volume-ancestor`（identity 已通过、filesystem 已放行），exFAT/FAT32 放宽后仍是 `volume-identity`。据此 Lead 裁决保留 exFAT + ReFS 双卷：exFAT 证明现实外接介质仍被拒，ReFS 承担 filesystem 分支与 NC-1 判别力；FAT32 不增加判别力，不作为 fixture。
- 2026-11-24（Batch 2 第二次 hosted run `45403057740`）：ReFS 卷根存在标准用户不可读的 `System Volume Information`，卷根递归快照抛 `EPERM`。先试过“记录不可读子树并参与比较”，经 Lead 复核改为**卷根定点检查**（非递归可见条目 + 声明私有对象名 + 目标 profile 不存在），不遍历系统目录、也不以忽略不可读掩盖私有对象；映射盘共享根没有系统目录，保留递归快照。契约测试新增“定点检查不进入不可读系统目录且对私有对象/profile 有判别力”（先 RED 后 GREEN）。
- 2026-11-24（修复轮 hosted run `45412965600`）：哨兵改动里集成用例使用 `path.join` 但漏了 `import path from 'node:path'`；darwin 上该文件整组 skip，本地无法执行该分支，只有 hosted Windows 才暴露 `ReferenceError: path is not defined`。补 import 后重跑；并在契约层新增“集成用例内建绑定导入守卫”（读源码断言 `assert/childProcess/fs/path` 的使用都有 import），mutation（删 `path` 导入）已证明其判别力，避免同类漏导入再次只在 hosted 暴露。
- 2026-11-24（修复轮 P3）：验收指出 AC2 只有“零写入”而没有哨兵字节/元数据证据；在既有 exFAT/ReFS/mapped 用例内各预置固定字节哨兵并断言 sha256/size/mtime 不变，避免新增顶层用例与 marker 计数变化。同时发现计划里的 `windows-volume-fixture:` / `windows-volume-refusal:` 前缀从未实现，实际证据只是 node test 的 `ℹ {"label":…}` diagnostic 行，已按回读命令订正。
- 2026-11-24（Batch 1 变异）：新 CI 契约锚点的首版只断言 `Remove-SmbShare` 存在与 finally 顺序，把清理共享名改成 `other-share` 的变异 SURVIVED；改为断言 `Remove-SmbShare -Name 'harness-vol-fixture'` 后 KILLED。锚点必须钉住清理的**对象**，只钉住动作名会放过越界清理。
- 2026-11-24（实现前核查）：`tests/README.md:38` 规定契约测试不得 import 集成测试 helper；原计划把 helper 放 `tests/integration/` 会让新契约测试违反分层，改为共享 fixture `tests/fixtures/windows-volume-fixture.js`。
- 2026-11-24：mapped 盘的事实必须在 **spawn 的 PowerShell 子进程**里断言（与产品 helper 相同会话语义）。若只在测试进程内做 `[IO.DriveInfo]`，无法排除“子进程看不到映射 → `DriveType=NoRootDirectory` → 同样抛 `drive`”的假绿通道。

## Decision Log

- **2026-11-25 / 用户直接授权 · D25-1 本评审会话负责 PR #687–#689 后续。** 用户原话：「你负责后续：三思后修复，但禁止 adhoc 式修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并」「清理本地和远端相关 branch、worktree 和评审过程中产生的测试文件和中间结果」。据此接管三条 PR 收尾；只在无 P0/P1、修复已独立复评且当前门禁通过时串行 rebase merge；不改 Planning Status/原生依赖，不扩大产品范围，不以工程批准代替 R1。本轮修复 owner 仅准备指定文件，不提交、push、回复 review 或改评审者记录。
- **2026-11-25 / 收尾策略 · D25-2 一个能力提交与恢复/发布顺序。** 三条 PR 各整合成一个可独立理解、验收、审阅和回滚的 Conventional Commit；#689 同批保留真实卷拒绝证据、计划/评审记录与 `Closes #679`。改写前建立并读回 `refs/backup/pr689-before-mmp-review-20261125`（原已推 head `9f0bd21b`）及 `refs/backup/pr689-final-tree-20261125`（含本轮修复与文档的最终树），记录 object ID；未读回恢复点不改写。使用 argv 执行 Git，发布时只用刚回读旧远端 head 的精确 `--force-with-lease=<ref>:<oid>`，lease 不符先核查。每条 PR 轮到时更新到真实 `main`、处理内容冲突并重跑受影响验证；最终 push 后回读远端 head/base/checks、issue 关联和全部 review threads，再确认当前 APPROVE/ready，不能沿用旧 head 批准。合并只用 rebase，之后回读 merge commit/main/#679 关闭结果；清理只覆盖授权的相关分支/worktree/测试中间结果，先核对真实路径与恢复点，不改写 main。以上仍待收尾会话实际执行后回填。
- 2026-11-24（Lead 裁决，独立设计评审收敛）：机制采用“现有 `windows-native` 阶段 2 + 管理员在同一 `try/finally` 预置 exFAT/ReFS 两块 VHD 与回环 SMB 共享；标准用户测试进程自建/自删映射盘”；不新增 job/set/lane，不改产品与 Host ABI。Rationale：复用两阶段身份、`SETS` 唯一清单与 `finally` 清理；新增 job 会触碰 4-job/64 组合聚合契约且复制身份逻辑。
- 2026-11-24（Lead 裁决，独立设计评审收敛）：证据深度采用“设备事实 → 精确 token → 零写入/哨兵不变 → 同文件 NTFS 正控”，放弃只断言 generic denied。Rationale：后续 gate 会兜住拒绝，generic denied 无判别力；token 来自 helper 自身 stdout，不需要改产品错误面。
- 2026-11-24（Lead 裁决，独立设计评审收敛）：fixture 坐标走确定性发现（固定卷标 + 固定共享名），不新增 `--volume/--mapped` argv。Rationale：`Start-Process -Credential` 用目标用户环境，不继承调用者自定义 env（既有 fixture 都走 argv）；`parseArgs` 返回形状被 `windows-native-checks.test.js:93-96` 精确钉住，新增字段需同步改契约。若发现式坐标被 Batch 0 证明不可行，降级 argv 需先报告 Lead 批准（Q4），不预授权。
- 2026-11-24（Lead 裁决，独立设计评审收敛）：非 NTFS 卷用 exFAT（256MB expandable VHD），不用 FAT32；卷标 `HARNESSFAT`（≤11 字符）。Rationale：Lead 裁决；exFAT 与外部盘语义更接近；FAT32 仅作显式裁决后的替代。Superseded by 2026-11-24 双卷裁决（下文）：保留 exFAT 并新增 ReFS（4GB sparse，`HARNESSRFS`）承担 filesystem 分支。
- 2026-11-24（Lead 裁决，独立设计评审收敛）：SMB 共享根放 `ProgramData` 而非 `RUNNER_TEMP`，只授临时账户 Modify，YAML 内断言访问列表无 `Everyone`/`Users`/`Anonymous`。Rationale：跨用户 profile 的祖先 ACL 会挡住标准用户。
- 2026-11-24（Lead 裁决，独立设计评审收敛）：新增测试文件固定为 `tests/integration/harness-plugin-windows-volume.test.js`，接入 `SETS['private-data']` 第 4 位，`allowedSkips` 保持 0，`minTests` 取实际顶层用例数（L1=5，L2=4，单调下限，首跑允许一次校准）。
- 2026-11-24（Lead 裁决 Q1）：不纳入 Git provider 的 `windowsPathsArePlain` 探针。issue #679 Scope 的 “production private-data/path admission” 由 helper 的路径/卷准入覆盖；provider 边界写入 PR 的 Not-proven 列表，不在本 PR 追加 `windowsPathsArePlain` 返回值断言。
- 2026-11-24（Lead 裁决，独立设计评审收敛）：清理失败只 `::warning::`，不覆盖测试结论；fixture 预置失败重抛进既有 `catch` → `nativeExit=1`。Rationale：一次性 hosted runner 无残留，重点是让产品失败可见。Superseded by 2026-11-24 修复轮（P3-3）：实际实现是 `-ErrorAction SilentlyContinue` 静默吞掉清理失败，不产生 warning；计划与 ci.md 已按代码实况改写。
- 2026-11-24（Lead 裁决，独立设计评审收敛）：所有负控（NC-1/NC-2）与 spike 改动只存在于 scratch ref，绝不进入 PR head；删除 ref 即完成回滚。
- 2026-11-24（Lead 裁决 Q2）：若 mapped 半区被 Batch 0 判为不可行，交 VHD 半区 + 契约/文档 + mapped blocked evidence；PR 用 `Refs #679`，`#679` 保持 open 并报告 Lead，不静默缩小范围。
- 2026-11-24（Lead 裁决 Q3）：spike 证明 exFAT 不可用而 FAT32 可用时，允许切 FAT32 并显式记录（断言 `FileSystem=FAT32`，卷标与其余命名契约不变）；不静默替换。
- 2026-11-24（Lead 裁决 Q4）：发现式坐标（固定卷标/固定共享名）失败时，降级为 argv 需先报告 Lead 批准，不预授权；未获批前按 fixture 缺失显式红。
- 2026-11-24（Lead 裁决 Q5）：`docs/README.md` 只允许本计划一行——起草时加入 Active 表，归档时同一行移入 Completed；不改其他行。
- 2026-11-24（Batch 0 门结论，依据 run `45398368511`）：两类设备均在 hosted `windows-2025` 成立，进入 L1 全量路径（5 条顶层用例）；不启用 Q2 的 VHD 半区降级，也不需要 Q4 的 argv 降级。
- 2026-11-24（Batch 2 校准）：exFAT 固定卷的期望拒绝 token 由 `volume-filesystem` 改为 `volume-identity`。Rationale：真实 exFAT 卷根文件标识为 0，identity gate 先于文件系统 gate；AC 要求的是真实非 NTFS 卷被拒（已满足），不能为命中预期分支去改产品，也不把未到达分支写成已证明（PR Not-proven 保留）。Superseded by 2026-11-24 双卷裁决（下下条）：exFAT 保留并断言 `volume-identity`，另加 ReFS 断言 `volume-filesystem`。
- 2026-11-24（Lead 裁决，双卷）：保留 exFAT（256MB VHD，现实外接介质场景，token 精确为 `volume-identity`）与 ReFS（4GB sparse VHD，token 精确为 `volume-filesystem`）两块真实固定卷，不二选一；mapped 盘与 NTFS 正控保持。Rationale：只留 exFAT 会让 filesystem 分支与 NC-1 不可证伪（identity 先拒绝）；只留 ReFS 会让最终 head 丢掉“现实 exFAT 仍被拒”的证据。AC1 映射为 exFAT 现实介质 + ReFS filesystem 分支 + mapped 盘三类真实设备拒绝。
- 2026-11-24（Batch 2 快照语义，经 Lead 复核）：真实卷根的零写入证据用定点检查（非递归条目集合 + 声明私有对象名 + 目标 profile 不存在），不递归遍历系统目录；映射盘共享根保留递归快照。Rationale：递归快照在 ReFS 卷根被 `System Volume Information` 的 EPERM 打断，而“记录/忽略不可读子树”会让私有对象的判别依赖可读性；定点检查把证据面限定在本次可写的目标区域。AC2 的哨兵字节/大小/mtime 在两块卷与映射盘上单独断言（P3-4 修复轮补齐）。
- 2026-11-24（Batch 3 NC 设计）：NC-1 用“放宽 `:181` 的 NTFS gate 接受 ReFS”证明红——spike run `45401513696` 已实测 relaxed ReFS token=`volume-ancestor`；exFAT 半区在放宽后仍 `volume-identity`，该不可证伪性由 token 语义与文档显式声明，不当作 hollow。NC-2 删预置并在同一 scratch 移除新静态锚点测试，证明 fixture 缺失时红在本文件的卷标发现消息而不是 skip/绿。
- 2026-11-24（修复轮 P3 决策）：AC2 哨兵放在既有用例内（两块卷根 + 映射盘共享根），用 `writeSentinel`/`assertSentinelUnchanged` 记录并比较 sha256/size/mtime；不新增顶层用例、不改 marker `tests` 计数。文档按代码实况改写：无独立日志前缀、清理失败为静默吞掉。
- 2026-11-24（实现期）：新 volume fixture helper 放 `tests/fixtures/windows-volume-fixture.js` 而非草案的 `tests/integration/harness-plugin-windows-volume-fixture.js`。Rationale：契约层不得 import 集成 helper（`tests/README.md:38`）；fixture 是共享层，契约侧纯逻辑判别与集成用例共用同一实现。

## Idempotence and Recovery

- 本地命令可重复执行：契约/纯函数/文档检查无外部状态；`pnpm verify` 不写仓库外状态。
- hosted fixture 每次运行使用 GUID 名的 VHD/共享目录与随机临时账户，重复 dispatch 不会撞名；盘符先预检空闲再用；`finally` 清理幂等（`Remove-SmbShare -Force -ErrorAction SilentlyContinue`、按文件路径 detach、`Remove-Item -Force`），失败被 `SilentlyContinue` 静默吞掉。
- 预置中途失败：同一 step 的 `catch` 记录 `stage` 并置 `nativeExit=1`，`finally` 仍执行；runner 随后销毁，无跨运行残留。
- 恢复锚点：`main = eadf4901`；分支 `test/native-volume-refusal-20261124`。需要改写已推送分支时先建 backup ref，再用精确 old-head 的 `--force-with-lease`；scratch ref 由 `gh api -X DELETE` 精确删除。
- 2026-11-25 收尾依 D25-2：before ref 保留已推历史，final-tree ref 保留完整交付树，改写和清理前均回读可达性；未合并可从恢复点重建，合并后按完整能力提交 revert，不改写 main。
- 回滚层级：Batch 1 同组 revert（SETS+新文件+契约+YAML 必须一起）；合并后单 PR revert 即恢复 `private-data files=3` 基线；无 schema/数据/ABI 需要恢复。
- blocked 路径：不落 fixture 代码、不写 skip/空文件；在 Progress/Surprises 记录 run id、head、`ImageVersion`、错误行；PR 改 `Refs #679`，issue 保持 open。

## Interfaces and Dependencies

- 运行环境：GitHub-hosted `windows-2025`（Windows Server 2025 x64）、Windows PowerShell 5.1（`SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe`）、`diskpart`、`net.exe`、`New-SmbShare`/`Get-SmbShareAccess`、CIM `Win32_LogicalDisk`；Node 26（`.nvmrc`）、pnpm 10.28.2；实现调查期 `gh` CLI 只读 PR/run/ref。**Superseded（2026-11-25，D25-1）**：后续授权写入与合并由收尾会话执行，本轮修复 owner 不外写。
- 触发：`ci.yml` 的 `pull_request`/`push: main`/`workflow_dispatch`（`ci.yml:3-7`）；scratch 负控沿用 `docs/development/ci.md:56` 的临时 ref + `gh workflow run --ref` 协议。
- 命名契约（测试与 YAML 两处字面量，漂移时运行期显式红）：卷标 `HARNESSFAT` / `HARNESSRFS`（均 10 字符）、共享名 `harness-vol-fixture`、拒绝目标目录名 `volume-refusal`、哨兵固定字节；token `private-windows-error-volume-identity`（exFAT）/ `private-windows-error-volume-filesystem`（ReFS）/ `private-windows-error-binding-drive`（映射盘）；日志事实是 node test 的 `ℹ {"label":"HARNESSFAT",…}` diagnostic 行与 `✔ native …` 用例名（无独立日志前缀）；marker `windows-native-checks: set=private-data files=4 …`。
- 无新增依赖、action、权限或 secrets；不使用凭据自动化（`net use` 只用当前登录会话 token）。

## Outcomes & Retrospective

2026-11-24 完成 #679 的工程闭环（实现会话自测；独立对抗验收与人类评审/R1 由其他角色承担）：

1. **结果**。`windows-native` 阶段 2 在临时标准用户进程内对三类真实设备证明拒绝：真实 exFAT 固定卷（256MB VHD，`volume-identity`：真实卷根文件标识为 0，identity gate 先于 filesystem gate 拒绝，属现实外接介质场景）、真实 ReFS 固定卷（4GB sparse VHD，`volume-filesystem`：identity 通过后命中 `GetVolumeInformationByHandleW` 的 filesystem gate）、真实回环 SMB 映射盘（`binding-drive`）。每次拒绝前在两块卷根与映射盘共享根预置固定字节哨兵并逐项断言 sha256/size/mtime 不变，卷根另用非递归可见条目 + 声明私有对象名 + 目标 profile 不存在证明零写入，并用同文件 NTFS 正控排除“拒绝一切”、Host apply 拒绝不发布 authority。
2. **规模**。归档前 `node scripts/rule-checks.mjs size main` 实测：代码 556 / 1000、文档 456 / 1500（含计划与 `docs/development/ci.md`），在 issue 目标 350–620（技术）与 1300（文档）内；以合并时 size 回读为准。
3. **hosted 证据**。实现 head 的 PR run `45404414163` 全绿（Windows Native 5m20s）；实现/文档 head `5902d925` 的 PR run `45405900553` 与两次 `workflow_dispatch`（`45405917317`、`45406610662`）全部 success（Windows Native 5m02s / 5m01s / 5m03s）；修复轮 head `50ed6a76` 的 PR run `45414468908` success（Windows Native 4m10s、Verify 2m1s、Browser 2m53s、PR Fast Gate 2s）；docs-only 修复 head `80ff5447` 的 PR run `45416289297` success（Verify 2m27s、Browser 3m8s、Windows Native 5m30s、PR Fast Gate 3s）；`f5a3e42b` 为证据回填 head，日志 marker `set=private-data files=4 tests=83 skipped=0`、`standard-user exit=0`、5/5 卷用例 ✔；NC-1 run `45404618033` 与 NC-2 run `45404711047` 均为 Windows Native / PR Fast Gate 红而 Verify / Browser 绿，失败消息分别指出 ReFS token 变为 `volume-ancestor` 与卷标发现数为 0；所有 scratch ref 已删除，PR head 不含调试/负控提交。
4. **与计划的偏差**。非 NTFS 卷由单 exFAT 扩为 exFAT + ReFS 双卷（Lead 2026-11-24 裁决，token spike run `45401513696`）；exFAT 的 filesystem 分支在真实卷根不可达，已由 token 语义与文档显式声明（不是 hollow），ReFS 承担精确分支与 NC-1 判别力。零写入证据从卷根递归快照改为定点检查（第二次 hosted run `45403057740` 的 ReFS `System Volume Information` EPERM）。修复轮（rev-689 P3）补 AC2 哨兵（既有 5 条用例内）、订正零写入/日志/清理文档、补 `path` 导入与 POSIX 导入守卫；P2-2 恢复本计划的 `## Bottom Change Note` 与 Not-proven 列表。
5. **Not-proven 边界**（应写入 PR 正文）：不证明 network/non-NTFS 存储支持、不宣称 Win11 Desktop 资格；不对 Git provider `windowsPathsArePlain` 做探针（#681/#660 范围）；exFAT 的 `filesystem` 分支本身不单独可证伪（被更早的 identity gate 遮蔽）；不关 #660/#642/#647/R1。
6. **issue 关联**。闭环满足 AC1–AC5 的证据面，PR 用 `Closes #679`、`Refs #660`；是否关闭由合并与人类接受决定，不写 Project `Status`。
7. **验收与归档**。rev-689 独立对抗验收：首审 APPROVE WITH NOTES（无 P0/P1，不阻塞），P3 修复轮后复评“可置 ready”；PR #689 已 ready，12/12 checks pass（含 PR Fast Gate），issue 双向关联已回读。2026-11-24 把本计划从 `docs/exec-plan/active/` 移到 `docs/exec-plan/completed/`（文件名不变），`docs/README.md` 只动本计划两行。

2026-11-25 当前修复准备（检出 `test/native-volume-refusal-20261124`，原 head `9f0bd21b`，macOS / Node v26.13.1）：独立确认 R689-01 的根因是两个样例改变大小且错误匹配过宽。修前通过 `scripts/review-mutate.mjs` 跑 M1–M4 整表：删除哨兵 sha256 比较（M1）/快照 sha256 比较（M4）均 SURVIVED，精确 token（M2）/写哨兵（M3）均 KILLED。修后只复用既有样例，同大小篡改并恢复记录 mtime，校验 `ERR_ASSERTION` 和精确字节错误消息；最终整表 4/4 KILLED，`killedBy` 分别归因于哨兵/token/哨兵/快照用例，逐字节还原与还原后基线通过。`node --test tests/contract/windows-volume-fixture.test.js tests/contract/ci-windows-workflow.test.js tests/contract/windows-native-checks.test.js` 为 20 pass/0 skip/0 fail，`workflow-check` 检查 7 文件无发现；未新增顶层用例、未改 helper 行为/产品/CI 接线。R689-02 两源码头指向现行 completed，R689-03 成功证据/AC2 写实，R689-04 索引关闭旧 P2 并等待修复独立复评。日志/spec 本地保留，不写本机路径；本批未产生新 Windows 原生证明。保持 Completed，独立复评、恢复点、历史整理、push、issue 验收核对、合并和清理仍待收尾会话执行。

2026-11-25 独立修复复评通过：复评者重读本批全部 diff，并独立运行三文件契约（20/20）、指定 M1–M4 最终变异表（4/4 KILLED、killedBy 正确、还原与还原后基线通过）、workflow（7 文件无发现）、两源码头/评审索引路径与计划章节、diff 检查。R689-01–R689-04 全部关闭，无新增 P0–P3；评审记录见 `docs/review/pr-689-mmp-review.md` §8。上一段准备期的“独立复评待执行”已完成；最终提交、原生 CI、issue 核对、合并和清理仍待收尾会话实际执行。

## Bottom Change Note

- 2026-11-24（收敛评审）：初稿。读取 issue #679/#678、`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、`docs/review/README.md`、`main@eadf4901` 代码与 2026-11-24 独立设计评审与 Lead 裁决（结论见 Decision Log）后收敛：采用机制与证据深度裁决，统一 exFAT/卷标/共享根/发现方式，剔除第二块 NTFS VHD 与 provider 探针，补入“子进程可见性”事实断言与 `ProgramData` 共享根修正。
- 2026-11-24（阶段 1）：按 Lead 任务段清理提交版——删除草稿末尾仅评审用的待裁决附录（Q1–Q4 的裁决结论并入 Decision Log）；把运行态设计路径引用改为“独立设计评审与 Lead 裁决（结论见 Decision Log）”；状态行改为“Active（Lead 2026-11-24 批准执行）”；补入 Q1–Q5 裁决；把计划文件名与分支名对齐本 worktree；在 `docs/README.md` Active 表增加本计划一行。
- 2026-11-24（Batch 0 完成）：记录 spike 结论与 run 证据（`45398368511`；首次成功 `45398017522`；首跑 `45397836950` 为驱动脚本缺陷）。按分层规则把新 helper 位置改为 `tests/fixtures/windows-volume-fixture.js` 并同步写入边界与 Decision Log；Progress 勾选 Batch 0。
- 2026-11-24（Batch 1 完成）：接入 SETS/marker/契约与真实卷 fixture 预置清理；新增共享 fixture、契约测试与 5 条原生集成用例；记录本地 RED→GREEN、M1/M2 变异与窄验证/全量验证结果。
- 2026-11-24（Batch 2 首跑校准）：按首跑实际 token 把 exFAT 卷准入期望从 `volume-filesystem` 校准为 `volume-identity`，同步 Purpose、Design、Validation、命名契约与 Surprises；不改产品 gate 顺序。
- 2026-11-24（Batch 2 双卷扩展）：按 token spike run `45401513696` 与 Lead 裁决把非 NTFS 本地卷扩为 exFAT（256MB，`volume-identity`）+ ReFS（4GB sparse，`volume-filesystem`）两块，mapped/NTFS 正控不变；同步 Purpose/Design/Batch/Validation/Naming/Progress/Surprises/Decision Log，并清理 Progress 中的过期占位行。
- 2026-11-24（Batch 2 修复轮）：ReFS 系统目录 EPERM 使第二次 hosted run 红；零写入证据改为卷根定点检查（按 Lead 复核），补契约判别用例；不改产品与 YAML fixture 语义。
- 2026-11-24（Batch 3 收口）：记录 NC-1/NC-2 hosted 负控证据、ci.md 双卷说明、规模与 Not-proven 边界。
- 2026-11-24（最终 head 回读）：实现/文档 head `5902d925` 的 PR run 与两次 dispatch 全绿，回填 run id；docs-only 证据提交的 PR run 由 `gh pr checks 689` 回读。
- 2026-11-24（修复轮 P3）：按 rev-689 P3 补 AC2 哨兵字节/size/mtime 证据（既有 5 条用例内，新增契约判别用例），订正计划/ci.md 的零写入、日志前缀与清理失败语义，补 CI 契约测试尾换行；本地验证全绿后 push 最终 head。
- 2026-11-24（修复轮 2）：补 integration 测试缺失的 `path` 导入（hosted run `45412965600` 暴露），本地 darwin 全 skip 无法覆盖该分支。
- 2026-11-24（修复轮 3）：新增跳过分支的导入守卫（契约层源码检查，mutation RED → GREEN），防止 darwin 全 skip 的集成用例再次漏 import。
- 2026-11-24（修复轮 4 / P2-2）：恢复被修复提交截断的 `## Bottom Change Note` 与 Outcomes Not-proven 列表，更新规模数字为最终回读（代码 556 / 文档 381），并以 `grep '^## '` 自检 PLANS.md §3 强制章节齐全。
- 2026-11-24（归档）：按仓库约定把文件移入 `docs/exec-plan/completed/`（文件名不变），状态行改 Completed；`docs/README.md` Active 行移除、Completed 行加入（只动本计划两行）；Progress 勾选验收/归档，Outcomes 回填最终 head 与终值。
- 2026-11-25（R689-01–R689-04 修复准备）：保持 Completed；同大小/恢复 mtime 的既有样例使两条 hash 变异由 SURVIVED 转为 KILLED，M1–M4 整表归因通过；订正源码头、最小成功日志与 AC2/评审索引，追加 D25-1 直接用户授权和 D25-2 恢复/提交/精确 lease/逐真实 main/最终回读策略；本批尚未独立复评、提交或外部写入。

- 2026-11-25（独立修复复评）：R689-01–R689-04 全部技术关闭，回填独立 20/20 契约与 4/4 归因变异结果；只勾选修复复评，保留最终 Git/CI/issue/合并/清理为未完成，计划保持 Completed。
