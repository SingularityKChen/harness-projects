# Windows 原生工作树移除资格化 ExecPlan

> 状态：Active（Lead 2026-11-24 批准执行）
> 创建：2026-11-24
> 范围：在既有 required Windows lane（管理员阶段 `native-git`）内，为 #138 / PR671 已合入的显式工作树移除协议补原生资格证据；纯测试与文档，不改产品语义、不改 `SETS`/`ci.yml`/契约、不 stacked。
> 上游输入：issue #681、权威规划 issue #678、`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、`docs/review/README.md`、`docs/development/ci.md`、`docs/exec-plan/completed/2026-11-21-worktree-clean-removal.md`、2026-11-24 独立设计评审与 Lead 裁决（结论见 Decision Log）。

## Purpose / Big Picture

完成后，PR671 交付、目前只在 darwin/Linux 上被判别性证明的显式工作树移除协议，将在真实 hosted Windows（`windows-2025`，管理员阶段 1）上获得原生资格：干净往返（隔离 rename → `worktree repair` 绑定 → `worktree remove` → 回读）、脏树字节保留、越界/外来/detached 拒绝、HEAD 协调锁、真实 Windows 文件身份 `(dev, ino)`、真实 open-handle/ACL 导致的确定性拒绝与可能部分删除的诚实 `ambiguous_result` + 可恢复登记、Git 版本/引用后端矩阵与 reftable fail closed，全部零 skip 地在唯一 required lane 内执行；同时不新增清单、不改 marker/契约、不 stacked。

最小成功证据（缺一不算完成）：本 PR 当前 head 的 `Windows Native` 绿，日志 marker 为 `set=native-git files=3 tests=31 skipped=0 todo=0`（基线 22 + 9，以当前 head 回读为准），9 条 `Windows worktree removal:` 用例名与三类诊断 token 出现；同一 head 的 `PR Fast Gate` 绿；scratch 负控证明新用例真的在该 lane 执行（`assert.fail` 必红）且至少一条产品敏感性变异被对应用例钉红。本 PR 用 `Closes #681`、`Refs #138`；`#138` 保持 OPEN，残余矩阵由 Lead/人类回填。

## Context and Orientation

- **被资格化的产品协议**（已在 main）：`packages/providers/development-local-git/src/provider.ts:308-447` 的 `removeWorktree` 判定顺序固定——能力 → 身份 → 路径（纯 fs、零 Git）→ 登记 → locked/prunable/detached → ref backend → HEAD 协调锁 → 锁内复验 → 对象锚 `(dev, ino)` → 干净门 → `fs.rename` 隔离 → 对象复核 → `worktree repair` → `worktree remove` 隔离目录 → 回读。拒绝分类：脏树 `invalid_input`（`:386-388`）、reftable/`ino=0` `not_supported`（`:340-347`、`:378`）、rename 失败按 errno 分类为可证未删除（`:449-461`）、remove 非零一律 `ambiguous_result`（`:463-475`）、`finally` 释放 HEAD.lock（`:444-446`）。
- **Windows 路径准入**：`paths.ts:47-67`（允许根包含）、`:147`（纯路径形态，由 `git-runner.ts:14-59` 的 PowerShell 数值探针实现）、`sameFilesystemPath` 以 `(dev, ino)` 判同（`paths.ts:38-43`）。
- **既有判别覆盖**：POSIX 套件 `tests/integration/development-local-git.test.js` 有 15 条以 `工作树移除：` 开头的具名用例（`:392-915`），其中 `snapshotTree` 逐字节快照 `:604-621`、`quarantineEntries` `:597`、`destructiveCall` `:600`；该文件被 `docs/development/ci.md:50` 明确排除在 Windows lane 之外（POSIX fd/uid/mode/chmod 假设）。
- **缺口记录**：`docs/exec-plan/completed/2026-11-21-worktree-clean-removal.md:375-379` 把 Windows 原生未运行列为未验证项；`docs/review/pr-671-mmp-review.md:106` 记录 native-git SETS 不含该用例组。
- **lane 接线（零改动的根据）**：唯一清单 `scripts/windows-native-checks.mjs:47-63`——`native-git` 3 文件、`minTests` 15/3/4、`allowedSkips: 0`；下界是单调下限（`:41-46`，新增用例不需改）；`evaluate` 判 `tests ≥ minTests` 与 `skipped === allowedSkips`（`:168-209`）。入口 marker 只含文件数与 skip 预算：`ci.yml:127`（`files=3 tests=\d+ skipped=0 todo=0`），契约从 `SETS` 推导（`tests/contract/ci-windows-workflow.test.js:37-39`）；YAML 不得内联 `.test.js`（同文件 `:103-104`）；SETS 键集合被钉为 `['native-git','private-data']`（`tests/contract/windows-native-checks.test.js:51`）；skip 预算只数字面量 `skip: process.platform === 'win32'`（`:160-174`），而既有 Windows 文件用 `skip: process.platform !== 'win32'`（`tests/integration/development-local-git-windows.test.js:18`）。
- **当前基线（2026-11-24 回读，非永久事实）**：hosted run `45372875157` @ `eadf4901` 的 Windows Native 记录 `ImageOS=win25-vs2026 ImageVersion=20261116.315.1 AMD64`、`node v26.13.1`、`git version 2.56.1.windows.1`、`admin=True adminMember=True`、`set=native-git files=3 tests=22 skipped=0 todo=0`。该文件现贡献 15 条（22−3−4），其中 8 条 `native`（`grep -c` 于 `eadf4901`）。
- **本机只读探针（2026-11-24，main@eadf4901，macOS/git 2.56.1/node 26.13.1；只证明输出形状，不冒充 Windows 证据）**：linked worktree 的 `git rev-parse --git-path HEAD` 返回绝对路径；files 仓库 `git config --local --get extensions.refstorage` exit 1 空输出；reftable 仓库该命令 exit 0 输出 `reftable`，且 `git init --ref-format=reftable` 与 `git worktree add` 均成功；`git worktree remove` 在目录不可删时 exit 255，登记已被删除而目录仍在。本机基线：`pnpm test:file tests/integration/development-local-git-windows.test.js` → `tests 15 / pass 7 / skipped 8 / fail 0`；`pnpm test:file tests/integration/development-local-git.test.js` → `tests 96 / pass 96 / skipped 0 / fail 0`。
- **并行项与开工门**：#679 的 PR #689 只改 `SETS`、`ci.yml`、两份 Windows 契约测试、`docs/development/ci.md` 与新增 volume 用例（与本计划文件集不相交）。开工门 = #689 当前 head 的 `windows-native` 通过且回读 private-data marker `files=4`；观察时（2026-11-24T13:05Z，head `14bb6f5`）其 checks 仍在跑，门必须在 Batch 0 重读，不能沿用旧结论。

## Design / Spec

### 选定方案 A1（Lead 裁决）：把 9 条原生用例追加进已在 `SETS` 的文件

- 落点：`tests/integration/development-local-git-windows.test.js`（315 行，现 15 条 / 8 条 `native`）末尾追加 9 条 `native` 用例 + 文件内机制 helper；把平台中立的 `snapshotTree`/`quarantineEntries`/`destructiveCall` 从 POSIX 套件抽到 `tests/integration/local-git-fixture.js` 供两边 import（`PLANS.md` §4 一个事实只写一处；抽取前后 POSIX 计数必须不变）。
- **为什么零改 `SETS`/`ci.yml`/契约也拿得到 required 证据**（PR body 必须写这 5 点）：(1) 文件已在 `native-git` 的 `files` 里，lane 自动执行；(2) 新增用例只抬高 `summary.tests`，而判定是 `tests ≥ minTests`（单调下限）；(3) marker 只含 `files=3` 与 `tests=\d+`，不含条数；(4) 新用例用既有 `native` 常量（`skip: process.platform !== 'win32'`），不计入 win32-active skip 预算，`allowedSkips: 0` 与契约扫描不变；(5) SETS 键集合与 YAML 均不变，`ci-windows-workflow.test.js` 的推导断言天然继续成立。
- **并行性与不抬 `minTests`**：#679 在飞时本 PR 不写 `scripts/windows-native-checks.mjs`、`.github/workflows/ci.yml`、`tests/contract/ci-windows-workflow.test.js`、`tests/contract/windows-native-checks.test.js`、`docs/development/ci.md`，唯一共享是 `docs/README.md` 索引行（rebase 可解），不 stacked；`minTests` 保持 15——抬它要改 #679 独占的 `SETS`（单 owner），新用例条数由 lane 总 `tests` 回读 + diff/review 保护，#679 合并后可另做 1 行 follow-up。

### 被放弃的方案

- **B 新文件 + `SETS` 条目 + `ci.yml` marker `files=4`**：必须改 #679 独占的三个文件（`SETS`/`ci.yml`/`ci.md`），并行时只能 stacked，review 队列串行且 #679 一变就要 rebase；技术增量比 A1 多 60–120 行且无额外判别力。
- **C 独立 workflow / D 把同义断言加进 POSIX 套件借 Linux 跑**：C 要新增 workflow 并同步 W1–W7/契约/文档（`AGENTS.md` §9）、制造第二份清单，且不进 required CI 回归保护；D 违反 `docs/development/ci.md:50` 的排除理由（POSIX fd/uid/mode/chmod 假设在 win32 上会红或负例空心），Linux 结果也不是 Windows 证据。两者都交不出本 issue 的必答证据。

### 关键不变量

- I1 只加证据、不改产品语义：除 §Batch 3 授权的 ≤120 行修复外 `packages/**` 零改动；POSIX 套件行为与其计数不变。
- I2 Windows 上 9 条用例必须真实执行、`skipped=0`；每条都有「拒绝/故障」判别点与「正控/恢复」配对，不得只断言 `ok` 或只断言错误码。
- I3 拒绝路径零副作用：内容逐字节不变、登记不变、分支头不变、零破坏性 argv（`repair|remove|move`）。
- I4 部分失败只能是 `ambiguous_result(retryable:false)`，且必须给出隔离残留、登记读数与恢复路径；不得把清理登记或部分删除报成成功。
- I5 未知平台事实只用两种诚实方式处理：断言可证不变量 + 诊断 token，或 hosted 校准后的精确字面量；禁止 `skip`、mock 平台、放宽断言换绿。
- I6 不造第二判据源：`SETS` 仍是唯一清单；快照判据只有一份实现。
- I7 证据边界：只宣称 windows-2025 管理员阶段 1 的原生资格；不宣称 standard-user 隔离、Windows Desktop、R1、老 Git 或非 NTFS 卷；不关 `#138`。

### 残余矩阵（写进 PR body 并链接 #138；不随本 PR 关闭）

- RN1 clean 检查→rename 之间非协作同用户写入的内容可能随目录删除：已声明窗口（POSIX R1/D21 同源），只证明协作 Git 与替换攻击面，不宣称保护。
- RN2 standard-user 身份下的移除未原生资格：阶段 1 是管理员；交 #660/#647 家族。
- RN3 Windows 11 Desktop / 安装版 Node / R1 未验证：`windows-2025` ≠ Desktop；交 #647 人工验收。
- RN4 老 Git（<2.30 无 `worktree repair`）与其它 reftable 版本未原生执行：fail-closed 契约不变，本 PR 只记录当前 runner 版本。
- RN5 非 NTFS/网络卷被准入拒绝、未做支持资格：交 #679/#660。
- RN6 AV/EDR 瞬时共享冲突可能落成 `permission_denied`（可原样重试）：假阴性风险，不隐藏删除，只记 errno。
- RN7 崩溃残留（HEAD.lock、`.harness-remove-*`）未在 Windows 原生演练：沿用既有文档契约，不新增自动清理。

### 9 条用例（统一前缀 `Windows worktree removal: `，全部 `native`）

| ID | 用例 | AC | 判别点（必须一起断言） |
|---|---|---|---|
| T1 | clean explicit removal round trip | AC1 | `ok`；隔离目录父目录 = 允许根 realpath；`repair`/`remove` argv 精确且无 `--force`/`-f`/`move`；目标 ENOENT、登记不含目标、分支头不变、允许根无 `.harness-remove-*`、HEAD.lock 不存在、二次调用 `not_found`；token `windows-removal-matrix:` 记录 git/node/backend、`anchor.ino != 0`，并在 `repair` 成功的注入点对隔离目录 `stat` 断言 `(dev, ino)` 与调用前 target 相同 |
| T2 | dirty/user 文件字节保留 | AC1/AC2 | 3 条 porcelain 记录（已跟踪修改含 CRLF 字节、已暂存新文件、未跟踪文件）+ 被忽略 `.env`；先设 `status.showUntrackedFiles=no` 做负控；`invalid_input`、`retryable false`、message 含 `3 个未提交路径` + 一条路径 + 出路；`snapshotTree` 前后 deepEqual；登记与 HEAD 不变；零破坏性 argv |
| T3 | HEAD 协调锁阻止真实并发 detach | AC1/AC2 | 注入点 = 干净门 `status`：断言 `<git-path HEAD>.lock` 存在且内容含本进程 marker；同一注入点真实 `git checkout --detach` 非零、stderr 指向 HEAD 引用锁（字面量可校准，语义不可退让）；未产生独有提交；随后移除 `ok`；`fsck --unreachable --no-reflogs` 为空；锁 ENOENT |
| T4 | 同 gitfile 替身被真实对象身份拒绝 | AC2 | 注入点：`rename(target, movedReal)` + `cp` 回 target + 写被忽略文件；`invalid_input`、message 含 `对象被替换`/`已回滚`；替身与被移走对象 snapshot 逐字节不变；登记仍指 target；无隔离残留；零破坏性 argv |
| T5 | 越界/命名空间/junction 逃逸拒绝（零 Git argv） | AC1 | ≥8 个 Windows 形态（允许根外绝对路径、`..` 分量、UNC、设备命名空间、ADS、尾空格、junction 逃逸、junction 作允许根）全部 `invalid_input`、`retryable false`、`recorder.calls === []`；允许根外哨兵字节不变 |
| T6 | 外来/能力/主检出/换仓库/detached 身份拒绝 | AC1 | 能力关 + 外来 binding → `not_supported` 且零 Git；外来 binding（能力开）→ `not_found`；主检出 → `invalid_input` + `主检出`；登记路径换成独立仓库 → `invalid_input` + `不是本仓库的工作树`；真实 detach → `invalid_input` + `没有检出分支`；全部零破坏性 argv、登记不变 |
| T7 | live cwd 阻止隔离 rename：可证零副作用 + 配对成功 | AC2 | 自探针：临时目录上 holder cwd 位于其内时 `rename` 必须失败，否则显式红并标记机制不可用；provider 答 `permission_denied`/`unavailable` 且 message 含 `可证未做任何删除`；target snapshot 逐字节不变、登记仍在、无隔离目录、无 HEAD.lock 残留、零破坏性 argv；释放 holder 后同一调用 `ok`（配对正控） |
| T8 | 独占句柄/ACL 拒绝 → 诚实 ambiguous + 可恢复登记 | AC1/AC2 | 自探针：句柄使 `fs.rm(file)` 必败；再探测「句柄是否也阻止父目录 rename」：受阻则把故障改注入为子文件 ACL deny DELETE（rename 不受影响，另做探针），不受阻则保持句柄；`ambiguous_result`、`retryable false`；message 含完整隔离路径、target、分支、`隔离目录仍在`、`reconcile`、`恢复`，且登记读数与本测试独立 `worktree list` 回读一致；被锁文件字节不变；释放后 `rm -rf` 隔离目录 + `git worktree prune` + `git worktree add` 恢复 → `getWorktree` `ok` → 再 `removeWorktree` `ok`；分支头全程不变；绝不 `ok` |
| T9 | Git 版本/引用后端矩阵 + reftable fail closed | AC3 | 断言 `git --version` 可解析且 ≥2.30（`worktree repair` 前提）并记入 token；files 仓库 `config --local --get extensions.refstorage` exit 1 空输出；reftable 三分支都有真实断言、无 skip：`init` 不可用 → 记 `reftable=init-unavailable` 并断言 files 事实；`worktree add` 不可用 → 记 `reftable=worktree-unavailable` 并断言 `--show-ref-format=reftable`；可用 → 真实 reftable 工作树上 `not_supported` + message 含 `reftable` 与 `git worktree remove` + 树/登记不变 + 零破坏性 argv + 无锁残留 |

### 机制选择与校准规则（Batch 3 只允许按此裁量）

- **T7 主机制**：子进程 `process.chdir(target)` 持有目录 cwd（脚本经 `process.argv.slice(1,4)` 取 target/ready/release，`-e` 下 `argv[1]` 是第一个参数，已实测）；**替代机制**：对 target 用 `icacls` 加当前用户 SID 的 `(D)` deny ACE（`*<SID>:(D)`，locale 无关），探针要求 deny 后 `rename` 必败。两者都不可用 → 记 blocked 证据并报 Lead，不用 mock。
- **T8 主机制**：PowerShell `[IO.File]::Open(path, Open, Read, None)` 持有独占句柄；若该句柄连父目录 rename 一起阻断，改用已提交子文件的 `(D)` deny ACE（probe：deny 后 `fs.rm` 失败且父目录 rename 成功）。两条路径都必须释放/撤销并 kill 子进程，写在测试体 `try/finally` 内（不依赖 after-hook 顺序）。
- **校准与升级**：errno 集合、message 文案、登记读数、`tests` 条数只允许在 hosted 校准字面量，不变量集合、拒绝/成功配对、零副作用断言不可删改；产品缺陷仅在 hosted 复现真实 Windows 失败时修，≤120 技术行、限于 `removeWorktree` 及其直接依赖、不改 Host ABI/capabilities 契约/依赖、不削弱拒绝与诚实分类，否则停止、记 blocked 证据、`#681` 保持 OPEN 并报告 Lead。

## Global Constraints

- **写入集合（唯一声明，其他章节只引用此处）**：`tests/integration/development-local-git-windows.test.js`、`tests/integration/local-git-fixture.js`、`tests/integration/development-local-git.test.js`（仅 helper 抽取的 import 换行）、`tests/integration/README.md`（1 行）、`docs/README.md`（索引行）、`docs/exec-plan/active/2026-11-24-windows-worktree-removal.md`（新；Batch 4 移入 `docs/exec-plan/completed/` 同名文件）。例外：仅当 Batch 3 触发授权时允许 `packages/providers/development-local-git/src/{provider,paths}.ts` ≤120 行。
- **不改清单**：`scripts/windows-native-checks.mjs`、`.github/workflows/ci.yml`、`tests/contract/ci-windows-workflow.test.js`、`tests/contract/windows-native-checks.test.js`、`docs/development/ci.md`（#679 owner 独占）；不新增文件到 `SETS`、不新增 workflow/lane、不新增依赖/action/secrets。
- **产品面**：不加自动清理、`--force`/prune/删分支路径、Core/UI 移除入口、兼容分支；不改 Host ABI 或 capability 契约。
- **预算**：技术增删 470–560（硬上限 800），文档 ≤1300；仓库硬帽 1000/1500。判定用 `node scripts/rule-checks.mjs size main` 的 printed 代码/文档 totals 对照 Lead 预算（脚本本身只按 1000/1500 判红）。
- **分支/工作树**：`test/windows-worktree-removal-20261124`，在 `.worktrees/iteration12-windows-worktree-removal/` 执行，base 为 `origin/main`（Batch 0 回读）。
- **证据诚实**：本机 macOS 只证明 helper/契约/POSIX 无回归；任何原生行为只由 PR CI 当前 head 证明；易失值（head、run id、tests 条数、耗时）写成命令 + 期望。禁止 `t.skip`、mock 平台、`continue-on-error`、重试掩盖。
- **发布面**：诊断 token 只写 git/node 版本、backend、布尔机制事实、errno、argv 形状；**不写绝对路径、SID、账号、主机名**（阶段 1 日志不经 `ci.yml:142-152` 的令牌化，那段只在阶段 2）。提交前跑 disclosure 并做人工五类目检查。
- **关闭语义**：全部 AC 成立才 `Closes #681`；`Refs #138` 且 `#138` 保持 OPEN；不宣称 Windows Desktop/R1/standard-user 资格；不写 Project `Status`/`blocked-by`/`blocking`、不合并 PR。

## Plan of Work

### Batch 0 · 基线、开工门与 draft PR

**最小闭环**：开工门被真实回读；分支/工作树/draft PR 只含 ExecPlan；基线计数记录。
**涉及文件**：`docs/exec-plan/active/2026-11-24-windows-worktree-removal.md`（新）、`docs/README.md`（Active 行）。
**步骤**：

1. 环境自检（在仓库根）：`git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`、`git rev-parse origin/main`（期望 `eadf4901` 或其后继，记录实际值；不写死）。
2. 开工门回读（`-R` 显式指定仓库）：`gh pr view 689 -R SingularityKChen/harness-projects --json headRefOid,isDraft,state`；`gh pr checks 689 -R SingularityKChen/harness-projects`；`gh run view <WINDOWS_RUN_ID> -R SingularityKChen/harness-projects --log --job <WINDOWS_JOB_ID> | grep -aE 'set=(native-git|private-data) files=[0-9]+ tests=[0-9]+ skipped=0 todo=0|standard-user exit=0'`。期望：Windows Native 在该 head 为 pass，出现 `set=private-data files=4 …` 与 `standard-user exit=0`。门不成立 → 只保留计划（可开 plan-only draft PR），不进入 Batch 1，`#681` 保持 OPEN，报告 Lead 并记录 run id/head/结论。
3. 工作树按该命令预建并回读就位（`git worktree list --porcelain` 含 `.worktrees/iteration12-windows-worktree-removal`，`git rev-parse HEAD` = `eadf4901`）；在该工作树写本 ExecPlan（删除仅评审用附录后落盘），`docs/README.md` Active 索引加 1 行。
4. 提交 `docs(exec-plan): 起草 windows-worktree-removal 计划（#681）` 并 push 分支；draft PR 由 Lead 创建：base main、`Closes #681`、`Refs #138`、ExecPlan + Batch 链接、**lane marker 语义说明**（上节 5 点：为何零 `SETS`/`ci.yml` 改动仍进 required lane）、证据边界与回滚。

**验证**：`gh pr view <PR> -R SingularityKChen/harness-projects --json isDraft,baseRefName,closingIssuesReferences,headRefOid` 回读 draft/base/`#681`；`git log --oneline -1`。
**回滚**：门不成立时关闭 plan-only draft PR 并 `git worktree remove` + `git branch -D`，main 零改动。

### Batch 1 · 测试先行 RED（helper 抽取 + 9 条用例 + 本机变异判别）

**最小闭环**：平台中立快照判据只有一份实现且 POSIX 计数不变；9 条用例写完并在 POSIX 上按平台门跳过；本机变异实验证明可移植断言有判别力。
**涉及文件**：`tests/integration/local-git-fixture.js`、`tests/integration/development-local-git.test.js`、`tests/integration/development-local-git-windows.test.js`。
**步骤**：

1. 先记录 POSIX 基线：`pnpm test:file tests/integration/development-local-git.test.js`，记录 `ℹ tests/pass/skipped`（2026-11-24 在 `eadf4901` 观察到 96/96/0，执行时必须重读）。
2. 抽取 `snapshotTree`（逐字节 + 类型 + 大小 + sha256 + 链接目标）、`quarantineEntries`、`destructiveCall` 到 `local-git-fixture.js` 并导出；POSIX 套件改为 import 并删除本地定义；复跑步骤 1，期望计数与基线逐项相同、`fail 0`。
3. 在 Windows 文件写 T1–T9（`native` 门，前缀 `Windows worktree removal: `）与 T1/T2 需要的文件内小 helper（`removalRef`、提交 `.gitignore` 的夹具、token 打印）；先不写 T7/T8 的 Windows 机制 helper。
4. 本机判别 RED（**不提交**）：临时去掉 `native` 门（工作树内改动）后在 macOS 跑 T1/T2/T3/T4/T5（部分）/T6/T9，把失败项分类为「Windows-only 形态（如命名空间/junction/句柄）」并放回门内；随后对 `packages/providers/development-local-git/src/provider.ts` 逐个注入变异并跑对应用例：M13 删 HEAD.lock 创建（`:354-361`）→ T3 必红；M17 跳过 `(dev, ino)` 复核（`:400-409`）→ T4 必红；M20 去掉 `--untracked-files=normal`（`:382`）→ T2 必红；M14 跳过隔离 rename（`:394-398`）→ T1 必红。每个变异后 `git checkout -- packages/` 并确认 `git status --short` 干净，把命中行记入 Progress/Surprises。
5. 提交：`test(providers): 抽取工作树快照判据到共享夹具`、`test(providers): 追加 Windows 原生工作树移除资格用例`。

**验证**：`pnpm test:file tests/integration/development-local-git-windows.test.js` → `ℹ tests 24`、`pass 7`、`skipped 17`、`fail 0`；`pnpm test:file tests/contract/windows-native-checks.test.js tests/contract/ci-windows-workflow.test.js` → `fail 0`；POSIX 计数与基线相同。
**回滚**：两个提交可分别 revert；抽取撤销后 POSIX 套件回到原文件定义，无运行期状态。

### Batch 2 · 实现/校准（Windows 机制 helper 与结构验证）

**最小闭环**：T7/T8 的真实机制 helper 与自探针就绪、释放/撤销在 `try/finally`；本机只证明接线与语法，不产生原生证据。
**涉及文件**：`tests/integration/development-local-git-windows.test.js`（文件内 helper，约 70–90 行）。
**步骤**：

1. 写文件内 helper：`spawnCwdHolder`（`spawn(process.execPath, ['-e', script, target, ready, release])`，ready 有界等待 ≤10s、release 后等退出 ≤10s、超时显式 `assert.fail` 并 kill）、`spawnExclusiveFileHolder`（`powershell.exe -NoProfile -NonInteractive -Command`，路径与 ready/release 只经 stdin JSON 传入，不解析本地化文本）、`denyDelete`/`allowDelete`（`icacls` + `*<SID>:(D)` / `/remove:d`）、`waitFor`（有界轮询）、`headLockPath`（`git rev-parse --git-path HEAD` 的绝对化）、`diagnose(prefix, fields)`（脱敏 token 打印）。
2. 在 T7/T8 内写自探针与失败分类消息（机制不可用时显式红并输出 `windows-removal-mechanism:` token，不允许静默通过）；所有释放/撤销/kill 放在测试体 `try/finally`，不依赖 after-hook 顺序（fixture 的 rm 已带 `maxRetries` 兜底）。
3. 本机结构验证：`pnpm test:file tests/integration/development-local-git-windows.test.js`（`fail 0`、`skipped 17`）；用一次性 `node -e` 验证 `waitFor` 超时抛错与 `snapshotTree` 差异检测（输出记入 Progress，不新增契约文件，避免与预算/AC 无关的第六个文件）。
4. 提交 `test(providers): Windows 原生移除的锁/句柄/ACL 机制夹具`。

**验证**：上述本机命令 + `git diff --check`；`pnpm typecheck`、`pnpm run boundaries` 仍 green（证明未触产品/边界）。
**回滚**：revert 该提交即回到「9 条用例在 POSIX 全 skip」的结构状态。

### Batch 3 · Hosted 证据与负控

**最小闭环**：当前 head 的 Windows Native 真实执行 9 条新用例并通过；两类负控有真实 run 记录；机制/字面量的任何调整都按 §机制选择与校准规则记录。
**涉及文件**：仅修正断言字面量/机制分支时改 `tests/integration/development-local-git-windows.test.js`。
**步骤**：

1. push 后 `gh pr checks <PR> -R SingularityKChen/harness-projects`；首次 Windows Native 可能红，按 §机制选择与校准规则归类 (a) 字面量校准 / (b) 机制不可用 → 替代或 blocked / (c) 产品缺陷 → 授权阈值 / (d) 夹具，逐项记入 Surprises + Decision Log，绝不加 skip 或弱化不变量。
2. 绿证回读：`gh run view <RUN_ID> -R … --log --job <WINDOWS_JOB_ID> | grep -aE 'set=native-git files=3 tests=[0-9]+ skipped=0 todo=0|ImageOS=|ImageVersion=|git version|node v|admin=|Windows worktree removal:|windows-removal-(matrix|mechanism|recovery):'`；期望 `tests=31`、`skipped=0`、9 条用例名、三类 token 至少各一条。
3. NC-1（执行证明）：`git switch -c scratch/681-nc-execute <head>`，在 T1 首行加 `assert.fail('windows-removal-executed')`，push 后 `gh workflow run ci.yml -R SingularityKChen/harness-projects --ref scratch/681-nc-execute`；期望 `windows-native` 与 `fast-gate` 红且日志出现该消息、`verify`/`browser` 绿；记录 run id 后 `gh api -X DELETE repos/SingularityKChen/harness-projects/git/refs/heads/scratch/681-nc-execute`。
4. NC-2（产品敏感性）：`scratch/681-nc-identity` 上删除 `(dev, ino)` 复核分支（`:400-409`），dispatch；期望 Windows Native 红且失败行是 T4（同 gitfile 替身）；`verify` 可能同时红（POSIX `:431` 覆盖同一分支），如实记录两者结论；删除 scratch ref。
5. 若 9 条中有用例因机制/环境被判为不可原生覆盖：保留其余证据，按 Lead 裁决记 blocked 残余、`#681` 保持 OPEN、PR 由 `Closes` 改 `Refs`，报告 Lead。

**验证**：步骤 2/3/4 的 grep 期望 + `gh run view <RUN_ID> --json jobs --jq '.jobs[]|select(.name|startswith("Windows Native"))|{conclusion,startedAt,completedAt}'`（期望 `success`，时长 <900s，回读值）。
**回滚**：scratch ref 删除即回滚；产品变异从不进入 PR 分支；PR 分支只保留测试/文档。

### Batch 4 · 全量与归档

**最小闭环**：本机全部检查 + 最终 head 的 hosted 回读通过；ExecPlan 归档、索引更新、commit 序列可独立审阅。
**涉及文件**：`docs/exec-plan/completed/2026-11-24-windows-worktree-removal.md`（由 active 移入、状态改 Completed）、`docs/README.md`、`tests/integration/README.md`、本 ExecPlan 的 Progress/Surprises/Decision Log/Outcomes。
**步骤**：

1. 回填 ExecPlan 全部记录（基线计数、变异命中、hosted run id/head、机制选择、校准、规模 printed totals、未验证项）；`tests/integration/README.md` 在 #137「工作树移除（#138）」行末加 1 行半句指向 Windows 原生资格与 `native-git` lane；`docs/README.md` 的 Active 行移入 Completed。
2. 跑 Validation 本机 1–5 与 Hosted 6–10 的全部命令；`pnpm verify`；`git diff --check main...HEAD`。
3. 整理提交（计划 / 快照抽取 / 用例 / 机制 / 文档证据，共 3–5 个），push 后回读 `gh pr view <PR> --json headRefOid,baseRefName,mergeStateStatus,closingIssuesReferences,reviewDecision` 与 checks；正式 head 连续两次 `gh workflow run ci.yml --ref test/windows-worktree-removal-20261124` 成功且 PR 的 `pull_request` run 成功。
4. PR body 写：闭环、ExecPlan + Batch、`Closes #681` + `Refs #138`、lane marker 语义 5 点、hosted 证据读数、残余矩阵（链接 #138）、未验证项、风险与回滚；`gh pr ready` 后请求人类评审（不合并）。

**验证**：Validation 全部条目 + `gh pr checks <PR>` 全 pass。
**回滚**：单 PR revert 即回到 `tests=22` 基线；无 schema/数据/ABI/依赖需要恢复。

## Validation and Acceptance

本机（在检出 `test/windows-worktree-removal-20261124` 的工作树 `.worktrees/iteration12-windows-worktree-removal/` 根目录运行；macOS 只证明 helper/契约/POSIX 无回归）：

1. `pnpm test:file tests/integration/development-local-git.test.js` → `ℹ tests 96`、`pass 96`、`skipped 0`、`fail 0`（与 Batch 0 基线逐项相同）。
2. `pnpm test:file tests/integration/development-local-git-windows.test.js` → `ℹ tests 24`、`pass 7`、`skipped 17`、`fail 0`（9 条新用例在本机按 `native` 门跳过）。
3. `pnpm test:file tests/contract/windows-native-checks.test.js tests/contract/ci-windows-workflow.test.js` → `ℹ fail 0`。
4. `node scripts/windows-native-checks.mjs --set native-git` → exit 1，输出含 `::error::windows-native-checks:` 与 `win32`（证明本机不产出原生证据）。
5. `node scripts/workflow-check.mjs` → `workflow-check: no findings`；`pnpm typecheck` → exit 0；`pnpm run boundaries` → `ℹ fail 0`；`pnpm verify` → exit 0；`node scripts/rule-checks.mjs size main` → printed 代码 470–560、文档 ≤1300（脚本只按 1000/1500 判红，Lead 预算按 printed 值人工对照）；`node scripts/rule-checks.mjs disclosure main` → 无命中；`git diff --check main...HEAD` → 无输出。

Hosted（`-R SingularityKChen/harness-projects`；只在当前 head 回读）：

6. `gh pr checks <PR>` → Verify、Browser、Windows Native、PR Fast Gate 全部 pass。
7. `gh run view <RUN_ID> --log --job <WINDOWS_JOB_ID>` grep（见 Batch 3 步骤 2）→ `set=native-git files=3 tests=31 skipped=0 todo=0` 一条；`ImageOS=win25-vs2026`、`git version 2.56.1.windows.1`、`node v26.x`、`admin=True`；9 条 `Windows worktree removal:`；`windows-removal-matrix:` / `windows-removal-mechanism:` / `windows-removal-recovery:` 至少各一条且不含绝对路径/SID。
8. `gh run view <RUN_ID> --json jobs` → Windows Native `success`，时长 <900s（回读值，不写死）。
9. NC-1：`windows-native` + `fast-gate` 红、日志含 `windows-removal-executed`、`verify`/`browser` 绿；NC-2：Windows Native 红且失败行是 T4。两 run id 与失败行写入 PR/本计划。
10. 正式 head 两次 dispatch 与 PR `pull_request` run 同 head 且成功；`gh pr view` 回读 head/base/合并态/`closingIssuesReferences`/review threads。

AC 映射：AC1 → 第 7 条（T1–T8 的拒绝/零副作用）+ 第 9 条负控；AC2 → 第 7 条（`(dev, ino)`/句柄/ACL 事实、T7/T8 的 `ambiguous_result`+恢复、T3 真实并发控制）；AC3 → 第 7 条（git 版本/backend 与 T9 三分支 fail closed）；AC4 → 第 3、5、6、7、10 条（零 `SETS` 改动、契约不变、`PR Fast Gate` 聚合不变、marker 计数、最终 head 回读）与 §校准与升级阈值；AC5 → PR body 残余矩阵 + `#138` 保持 OPEN 的 Not-proven 列表。

## Progress

- [x] Batch 0 · 基线、开工门与 draft PR（2026-11-24：计划与 `docs/README.md` 索引已提交并 push；draft PR #690 由 Lead 创建，base main、head `1c9650bf`）
  - 开工门回读（2026-11-24，head `66da5841`）：`gh pr checks 689 -R SingularityKChen/harness-projects` 显示 Windows Native pass（run `45400911352` / job `138468941022`）；同 run 日志 grep 得 `set=native-git files=3 tests=22 skipped=0 todo=0`、`set=private-data files=4 tests=82 skipped=0 todo=0`、`standard-user exit=0`、`ImageOS=win25-vs2026 ImageVersion=20261116.315.1`、`git version 2.56.1.windows.1`、`node v26.13.1`、`admin=True`。门成立。
- [x] Batch 1 · 测试先行 RED（2026-11-24：helper 抽取 + 9 条用例 + 本机变异判别）
  - 基线回读：`pnpm test:file tests/integration/development-local-git.test.js` → `tests 96 / pass 96 / skipped 0 / fail 0`；`pnpm test:file tests/integration/development-local-git-windows.test.js` → `tests 15 / pass 7 / skipped 8 / fail 0`。
  - 抽取 `snapshotTree`/`quarantineEntries`/`destructiveCall` 到 `tests/integration/local-git-fixture.js` 后 POSIX 仍 `96 / 96 / 0 / 0`；追加 9 条后 Windows 文件本机 `tests 24 / pass 7 / skipped 17 / fail 0`（`native` 门按平台跳过）。
  - 判别性 RED（临时去掉 `native` 门的未提交副本，macOS）：T1/T2/T3/T4/T6/T9 通过；T5 在 ADS 项失败（POSIX 允许 `:` 文件名）；T7/T8 因无 `powershell.exe`/`icacls.exe` 失败——后三类保留 `native` 门并只由 hosted Windows 产出证据。
  - 产品变异负控（改 `packages/providers/development-local-git/src/provider.ts`，每次后 `git checkout -- packages/`）：M13 去掉 HEAD.lock 创建 → T3 红；M17 跳过 `(dev, ino)` 复核 → T4 红；M20 去掉 `--untracked-files=normal` → T2 红（只报 2 个未提交路径）；M14 跳过隔离 rename → T1 红（答 `ambiguous_result`）。四个变异全部 KILLED。
  - 规模与发布面：`node scripts/rule-checks.mjs size main` → 代码 475 / 1000、文档 240 / 1500；`disclosure main` 机械扫描通过；`git diff --check main...HEAD` 无输出。
- [x] Batch 2 · 实现/校准（2026-11-24：机制 helper 与 9 条用例同批交付；本机结构验证通过——`pnpm test:file …windows.test.js` → `24 / 7 / 17 / 0`、`node --check` 通过。原生校准留 Batch 3 按 hosted 日志进行）
  - 2026-11-27：hosted 挂起定位完成（scratch run `45958257472`/`45959807653`/`45960832073`）：T8 在 `readFile(keepFile)`（施加 `icacls /deny *SID:(D)` 之后）于 windows-2025 上永不完成；`--test-timeout` 只判 test 失败、不取消 pending fs 请求，`node --test` 因此不退出；`runFile` 的 `spawnSync` 无进程级超时且 `Out-String` 缓冲，放大成 15 分钟 job 级静默取消。修复：T8 的只读前置事实（keepBytes/headBefore/lockPath）移到 arm deny 之前并用 `runSync` 兜界；deny ACE 在 provider 返回后按原目标与隔离路径分别撤销。本机 `windows.test.js` 24/7/17/0、POSIX `development-local-git.test.js` 96/96/0/0。
- [ ] Batch 3 · Hosted 证据与负控
- [ ] Batch 4 · 全量与归档
- 阻塞项：无（draft PR #690 已创建）。

## Surprises & Discoveries

- 2026-11-24（收敛评审，基线 `main@eadf4901`）：设计 A 写「POSIX 17 条工作树移除用例、94/94」，与当前仓库不符——`grep -c` 得 15 条以 `工作树移除：` 开头的用例，本机 `pnpm test:file tests/integration/development-local-git.test.js` 为 `tests 96 / pass 96 / skipped 0`。结论：基线一律 Batch 0 重读，不沿用旧数字。
- 2026-11-24：设计 A §3.4 说诊断路径「沿用 `ci.yml:142-152` 令牌化」不成立——那段 `Show-NativeOutput` 只在阶段 2；阶段 1 直接 `Write-Output $output`（`ci.yml:124-130`）。结论：新 token 自身不得含绝对路径/SID/账号。
- 2026-11-24：两份设计对部分删除的登记读数互斥（A 期望 `登记已不含隔离目录与原目标`，B 期望 `登记仍指隔离目录或原目标`）。本机 probe：`git worktree remove` 在目录不可删时 exit 255、先删登记、目录仍在。结论：不在断言里写死平台顺序，改由测试独立 `git worktree list` 回读决定期望 token。
- 2026-11-24：设计 B 把 `git rev-parse --show-ref-format` 当产品判据，产品实际读 `config --local --get extensions.refstorage`（`provider.ts:340-347`）。本机 probe：files 仓库 exit 1 空输出；reftable 仓库 exit 0 `reftable`；git 2.56.1 支持 `init --ref-format=reftable` + `worktree add`。结论：`--show-ref-format` 只作诊断，三分支保留以防 Windows 构建差异。
- 2026-11-24 / Batch 1：Windows 夹具的允许根是 `<root>/WorkTrees`，主检出 `<root>/Repo 空 格` 不在其内；主检出的 `invalid_input` 会先被 `outside_root` 拦下，所以 T6 的主检出调用改用 `allowedRoot: f.root`（包含仓库的父根）才走到身份拒绝。证据：未加门副本在 macOS 上原写法得到「规范化后逃出允许根：…/Repo 空 格」。
- 2026-11-24 / Batch 1：独占句柄必须用 `FileShare.Read` 而不是 `FileShare.None`——后者同时挡住干净门 `git status` 的读取，产品会答 `unavailable` 而不是部分删除的 `ambiguous_result`；`FileShare.Read` 仍拒写/拒删。T8 自探针同时要求「`rm` 必败 + 父目录 rename 成功」，不成立才退到 ACL deny DELETE（同样门槛）。
- 2026-11-24：规模算术不一致——设计 A §7.1 合计约 527，但按其用例清单（490 + 45 helper + 抽取净增约 6）应为约 541；本计划按 470–560 重估并给裁剪阶梯（超 560 时依次把 T3 锁观察并入 T1、压缩 T5 反例清单、压缩 T8 探针文案，不删 AC 覆盖）。本机 windows 文件基线 `tests 15 / pass 7 / skipped 8 / fail 0`，追加 9 条后预期 `24 / 7 / 17 / 0`（`native` 门本机全跳不是造假绿，lane 判定只在 win32 生效）。
- 2026-11-27（Batch 3 定位，scratch 证据）：T8 的挂起点不是 helper 子进程，也不是产品：`readFile(<worktree>/keep.bin)` 在 `icacls /deny *<SID>:(D)` 之后于 hosted windows-2025 永不返回（fine marker run `45960832073`：`before-denyKeep`→`after-denyKeep` 16 ms，`before-readKeep` 后 8 分钟无任何输出，停在 `before-remove` 之前）。同一布局下 `denyDelete`/`allowDelete` 与释放后的读取都正常；无产品 Git 调用发生。
- 2026-11-27：`--test-timeout` 只把 test 标失败，不取消挂起的 libuv fs 请求；本地 `node --test` 语义实验（E16）显示 pending `readFile` 会让测试进程永不退出——这解释了 diagnose1 在 T8 `✖ 122073ms` 之后仍静默 6 分 41 秒直至 step kill。`commit 53214148` 只兜住了 helper 子进程与 `spawnSync`，没有覆盖 fs promises 与 fixture 的无超时 `execFile`。
- 2026-11-27（run `45962513620`，head `47e0d552`）：挂起修复生效——T8 从 120s 超时降到 2.3s 并按普通断言失败。新失败：`invalid_input 工作树有 1 个未提交路径…keep.bin`。原因：`icacls` 改 DACL 会更新 NTFS change time，已跟踪文件被 provider 的 `git status --porcelain` 干净门判成未提交；因此 ACL 机制只能作用在 ignored/untracked 文件上。修复：T8 先 `commitIgnore(f, ['keep.bin'])` 再建工作树，`keep.bin` 不再 add/commit；干净门仍成立，`git worktree remove` 仍须真实删除它并被 deny-DELETE 挡住。
- 2026-11-27：Lane 放大是第二个独立缺陷：`scripts/windows-native-checks.mjs` 的 `runFile()` 用无 `timeout` 的 `spawnSync` 且在子进程退出后才写输出，`ci.yml` 阶段 1 又用 `Out-String` 缓冲，于是任何挂起都表现为“零输出 15 分钟取消”。该文件属 #679 owner，本 PR 不改；作为 #681 残余诊断能力缺口记录，建议另立 follow-up（给 runFile 加进程级 timeout 并流式输出，保持 fail-closed）。


## Decision Log

- 2026-11-24 / Lead 裁决 + r681（独立收敛评审）：采用 A1——追加到已在 `SETS` 的 `development-local-git-windows.test.js`，零 `SETS`/`ci.yml`/契约改动、不新增 workflow、不 stacked。Rationale：5 点推导链（单调下界、marker 只数文件数、skip 预算只数 `=== 'win32'`、SETS 键集合不变、YAML 不内联文件名）保证仍进入 required lane；B 需 #679 独占文件，C 交不出 required 证据，D 违反 `ci.md:50`。
- 2026-11-24 / r681：不抬 `native-git` 的 `minTests`（保持 15）。Rationale：`SETS` 属 #679 的 architecture unit（单 owner），本轮不与其并发编辑；新用例条数由 lane 总 `tests` 回读与 review 保护，#679 合并后可另做 1 行 follow-up。
- 2026-11-24 / r681：抽取 3 个平台中立快照 helper 到 `local-git-fixture.js`，Windows 专用机制 helper 留在被测文件内。Rationale：`PLANS.md` §4 一个事实只写一处，抽取为机械移动且以 POSIX 96/96 不变为证；机制 helper 只被这 9 条使用，独立成文件只会增加预算与 review 面。
- 2026-11-24 / r681：T9 采用三分支（init 不可用 / `worktree add` 不可用 / 全可用）且都含真实断言、禁止 skip。Rationale：设计 A 只覆盖两分支；本机 probe 证明 2.56.1 支持 reftable worktree，但 hosted 构建差异必须由日志回答而不是靠假设。
- 2026-11-24 / r681：部分删除的登记 token 由测试独立回读决定，不写死平台顺序。Rationale：见 Surprises 第 3 条；这样断言仍具判别力且不会因 Windows 删除顺序差异变成假红/假绿。
- 2026-11-24 / r681：机制不可用时允许换**真实** OS 机制（ACL deny / 目录 cwd），不允许 mock/skip；两者都不可用则记 blocked 证据并保持 `#681` OPEN。Rationale：Lead 裁决「不降级安全门」，替代真实机制不降低断言强度（Q1 裁决确认，见 2026-11-24 Lead 裁决条目）。
- 2026-11-24 / impl-681：T6 主检出用例改用 `allowedRoot: f.root`；Rationale 见 Surprises（Windows 夹具几何），身份拒绝语义不变（仍须 `invalid_input` + 点名主检出）。
- 2026-11-24 / impl-681：T8 主机制 = `FileShare.Read` 的独占写/删除句柄 + 双事实自探针；ACL deny DELETE 只在探针不成立时启用。Rationale：真实 OS 拒绝，且不阻断只读干净门（Q1 授权范围内）。
- 2026-11-24 / impl-681：判别性 RED 用未提交的 ungated 副本 + 产品变异完成，不把平台门移除提交。Rationale：TDD 证据留在本计划 Progress 与运行态证据，不牺牲 Windows lane 的真实性。
- 2026-11-24 / Lead 裁决：产品修复仅在 hosted 复现真实失败时进行，≤120 技术行、不动 Host ABI/依赖、不削弱拒绝与诚实分类；否则停止并报告。本计划把该阈值写成 Batch 3 的硬规则。
- 2026-11-24 / r681：文档只改 `tests/integration/README.md` 1 行 + `docs/README.md` 索引，不写 `docs/development/ci.md`（#679 owner 独占）；PR body 解释 marker 语义；归档在 PR 内完成（状态 Completed、移入 `docs/exec-plan/completed/` 并更新索引），沿用 PR671 的 `520ef1d7` 先例，合并仍由人类决定。
- 2026-11-24 / r681（独立评审上下文）：本计划由独立收敛评审上下文（`r681`）依据两份独立设计与 `main@eadf4901` 仓库事实收敛，未复用设计者推理；实现者须用独立上下文执行，对抗验收另行起上下文（不复用实现者结论代替证据）。
- 2026-11-24 / Lead 裁决 Q1（机制替代授权）：若主机制（live cwd / ACL deny / 独占句柄）在 hosted Windows 上不可构造，允许改用**真实替代机制**（真实 ACL deny / 真实独占句柄 / 真实文件系统行为）完成同一 AC，并在 Surprises & Discoveries 与 Decision Log 记录实际采用的机制与探针结果；不得用 mock 或 skip 充绿，也不得弱化零副作用与诚实分类断言。
- 2026-11-24 / Lead 裁决 Q2（负控预算）：允许在 scratch ref 上做至多一次**产品变异**负控（证明新增用例可被证伪），用完即删该分支，变异不得进入 PR 分支；NC-1（测试侧 `assert.fail` 执行证明）不是产品变异，不受此上限约束。
- 2026-11-24 / Lead 裁决 Q3（关闭语义）：只有 AC1/AC2 的可判别真实原生证据完整时才用 `Closes #681`；若某一核心用例无法原生覆盖，先报告 Lead，允许 `#681` 保持 OPEN 并写 blocked 残余，不硬关、不把未覆盖说成已覆盖。
- 2026-11-24 / Lead 裁决 Q4（裁剪触发）：技术增删超过 560 行时按 §Surprises & Discoveries 的阶梯自动裁剪（T3 锁观察并入 T1、压缩 T5 反例清单、压缩 T8 探针文案，不删 AC 覆盖），并在交付报告中说明裁剪项与实际规模。

- 2026-11-27 / impl-681：T8 的只读前置事实（`keepBytes`、`headBefore`、`lockPath`）全部移到 arm `denyDelete(keepFile)` 之前，并用文件内 `runSync`（60s 上限）替代无超时的 fixture `execFile` 读取这两项 Git 事实。Rationale：hosted 证据表明 deny-DELETE ACE 生效后对同一文件的 Node fs 读取会永不完成；这不改变任何断言、不做 skip，也不会把失败路径变成成功。
- 2026-11-27 / impl-681：deny ACE 的撤销放在 provider 返回后的 `finally`，同时尝试原目标路径与隔离目录内的路径（rename 成功后文件已随目录移动）。Rationale：只撤销原路径会因路径不存在而失败并把“诚实 ambiguous + 可恢复”变成测试错误；两处都尝试是可幂等的清理。
- 2026-11-27 / impl-681：不做产品修复。Rationale：hang 发生在 `port.removeWorktree` 之前，产品路径未被进入；23 条其他 Windows 用例在 hosted 通过；ExecPlan 的 ≤120 行产品修复门槛未被触发。Lane 级 `runFile` 超时另开 follow-up，不在本 PR 扩大 #679 owner 的文件。

## Idempotence and Recovery

- 本地命令可重复执行：测试只用 `mkdtemp` 临时仓库/允许根，`t.after` 的 `rm` 带 `maxRetries: 10 / retryDelay: 100`；holder/ACL 在测试体 `try/finally` 释放与撤销，重复跑不积累外部状态。
- hosted 运行可重复：`workflow_dispatch` 对同一 head 重跑无副作用；每次记录 run id/head，不把旧 run 当当前证据。
- 变异与负控只存在于未提交改动与 scratch ref：`git checkout -- packages/` 恢复产品；`gh api -X DELETE .../git/refs/heads/scratch/…` 删除负控 ref，删除即完成回滚。
- 恢复锚点：Batch 0 记录 `origin/main` 实值；本分支为 `test/windows-worktree-removal-20261124`。需要改写已推送分支时先建 backup ref，再用精确 old-head 的 `--force-with-lease`；不改写 main。
- 回滚层级与 blocked：Batch 1/2 提交可分别 revert，合并后单 PR revert 即恢复 `tests=22` 基线，无 schema/数据/ABI/依赖需恢复；blocked 时不写 skip/空断言、不删用例换绿，保留其余绿证 + 诊断/失败行，PR 改 `Refs #681`（或保持 draft），`#681` OPEN，报告 Lead。

## Interfaces and Dependencies

- 运行环境：GitHub-hosted `windows-2025`（Windows Server 2025 x64，管理员阶段 1），`powershell.exe` 5.1、`icacls.exe`、`fsutil.exe`；Git for Windows（当前观测 `2.56.1.windows.1`，需 `worktree repair` ≥2.30）；Node 来自 `.nvmrc`（当前 26.x）；`gh` 只读 + 对 scratch ref 的 `workflow_dispatch`。
- 门禁接口：`PR Fast Gate` 仍是唯一必需检查；`native-git` 入口 marker 不变；`SETS` 仍是唯一清单（本 PR 不写它）。
- 命名契约（漂移时运行期显式红）：用例前缀 `Windows worktree removal: `；token 前缀 `windows-removal-matrix:` / `windows-removal-mechanism:` / `windows-removal-recovery:`；隔离目录 `.harness-remove-*`；分支 `work/<slug>`；HEAD 协调锁内容含 `harness worktree removal <pid>`。
- 无新增依赖/action/secrets/权限；测试不触网；`#138` 的证据回填与合并由 Lead/人类执行。

## Outcomes & Retrospective

截至 2026-11-24 只有收敛评审与计划起草；本 PR 当前仅含计划与索引，实现从 Batch 1 开始、尚无 hosted run。实现完成后在此填写：实际规模（`rule-checks size` printed totals）、开工门结论（#689 head/run）、首次 hosted 红的原因与校准次数、T7/T8 实际采用的机制、T9 落到的分支、时长增量、变异命中表，以及是否 `Closes #681` 或降级为 blocked 证据（`Refs`）。

## Bottom Change Note

- 2026-11-24 / r681（收敛评审）：初稿。读取 issue #681/#678、`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、`docs/review/README.md`、`docs/development/ci.md`、两份独立设计 A/B 与 `main@eadf4901` 代码/本机 probe 后收敛：采用 Lead 裁决的 A1，统一 9 条用例与 AC 映射、机制替代与校准规则、登记读数的回读式断言、T9 三分支、预算裁剪阶梯与 blocked/授权阶梯，并剔除 B 的新文件/新契约测试与 C/D 方案。
- 2026-11-24 / Lead 批准执行：状态改为 Active；删除仅评审用附录（Reviewer Handoff）并把 Q1–Q4 裁决写入 Decision Log；工作树路径校正为 `.worktrees/iteration12-windows-worktree-removal`；Batch 0 记录开工门回读（PR #689 @ `66da5841` 的 Windows Native pass 与 `files=4`）。
- 2026-11-24 / Batch 1：记录基线与抽取后计数、9 条用例结构、ungated 判别分类、四个产品变异 KILLED 与 475/240 规模；补 T6 允许根与 T8 句柄共享模式两条 Discovery。

- 2026-11-27：Batch 2/3 hosted 挂起定位与 T8 修复（证据见 Progress/Surprises/Decision Log）；本机 focused 验证通过，push 后等待当前 head 的 Windows Native 回读。

- 2026-11-27：T8 改为 ignored 文件 + 记录 DACL/ctime 与 Git 干净门交互的 hosted 证据；再次 push 等待当前 head 的 Windows Native 回读。
