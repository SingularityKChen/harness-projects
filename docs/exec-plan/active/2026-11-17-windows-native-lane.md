# Windows 原生 CI lane（#646）ExecPlan

> 状态：Active（2026-11-17 实现中；本文件即 Batch 1 的落库位置）
> 创建：2026-11-17
> 范围：#646 —— 把 main 上已交付的 Windows 原生套件变成 `ci.yml` 中一条必需 lane，并聚合进唯一必需检查 `PR Fast Gate`；产品代码零改动；#644 以本分支为 base stack。
> 上游输入：`docs/development/ci.md`、`docs/development/workflow.md`、`docs/architecture/release-gates.md`、`.github/workflows/ci.yml`、`scripts/workflow-check.mjs`、`tests/contract/ci-browser-workflow.test.js`、`docs/exec-plan/completed/2026-11-16-windows-root-admission.md`、`docs/exec-plan/completed/2026-11-16-windows-git-paths.md`、`docs/review/pr-655-mmp-review.md`、`docs/review/pr-653-mmp-review.md`。

## Purpose / Big Picture

完成后，每个 PR 与 main push 的 `PR Fast Gate` 都必须包含一条在 GitHub-hosted `windows-2025` x64 上真实执行的原生 lane。该 lane 由 runner 管理员完成 checkout/install/build、记录工具链与提权身份、管理员预置 foreign-owner fixture，再以临时标准本地用户执行 #643/#645 已交付的安全、Host 生命周期、LocalGit 与 packed plugin 原生用例；测试文件缺失、清单被清空、用例被整体 skip、摘要不可解析、任何 fail/todo 或超时都会让 lane 与 `PR Fast Gate` 同时变红，而不是变绿。

判断成功的最小证据：目标 head 上一次 `workflow_dispatch` 精确 head 运行中 `windows-native` 与 `fast-gate` 均 success，日志含 `ImageOS=win25-… ImageVersion=… Architecture=AMD64`、node/git 版本、runner 的 `admin=true adminMember=true`、标准用户 `{"admin":false,"adminMember":false,"sid":"S-1-5-21-…"}`、`windows-native-checks: set=native-git tests=18 skipped=0` 与 `set=private-data tests=69 skipped=1`；且临时 ref 负控在同一份 CI 定义上把该 lane 与 `PR Fast Gate` 打红，删除临时 ref 后正式 head 重新变绿。

## Context and Orientation

### 事实基线（2026-11-17 11:30 +08 回读，执行上下文为检出 `main` 的工作树）

- main = `ddb94c9440815626a3932dcaf050653f70eedb18`，与 `origin/main` 一致。工作分支 `test/windows-native-lane`，工作树 `.worktrees/windows-native-lane`，创建时 HEAD = main，远端尚无同名分支。
- 已合并的 Windows/身份叶子：#643 `62e953cc`（Windows 私有根准入 + 真实 Host 接线）、#645 `7e5e409e`（Windows Git 路径与恢复边界）、#190 `ddb94c94`（源实体唯一主身份）。#644 是下一个叶子，按协调约定以本分支为 base stack。
- 分支保护回读（`gh api repos/SingularityKChen/harness-projects/branches/main/protection`）：唯一必需检查 `PR Fast Gate`，`strict:true`，线性历史。`ci.yml` 现有 job 只有 `verify`（ubuntu-latest，10 分钟）、`browser`（ubuntu-latest，10 分钟）、`fast-gate`（ubuntu-latest，5 分钟，`needs: [verify, browser]`，`if: ${{ !cancelled() }}`，不 checkout、不读 secrets）。
- 规则面：`scripts/workflow-check.mjs` 的托管 runner 白名单已含 `windows-2025`（`GITHUB_HOSTED_RUNNERS`），`node scripts/workflow-check.mjs` 当前输出 `workflow-check: no findings（已检查 7 个文件）`，exit 0。本 PR 不新增 workflow 文件，W1–W7 无需新规则；W1 的上界 15 分钟足以承载本 lane。
- #643 的 helper（`apps/harness-plugin/src/host-private-windows.ts`）在 win32 上只做 admit（`CreateFileW` + `OPEN_EXISTING` + 卷根/逐段/ACL/reparse 校验），不创建任何对象；因此「干净数据根首次创建」仍归 #644，`harness-plugin-artifact.test.js:281` 的 win32 skip 就是这条边界。
- 原生套件已在 main（`git ls-files` 与 `grep -c` 回读）：
  - `tests/integration/development-local-git-windows.test.js`：15 条顶层用例（8 条带 `native` skip，7 条跨平台；后者含 mock platform 的准入反例）。
  - `tests/integration/local-git-start-work-resume.test.js`：3 条。
  - `tests/integration/harness-plugin-windows-private-data.test.js`：18 条顶层 + `native Windows admission refuses unsafe objects…` 内 21 条 `t.test` 子用例 = 39 条。
  - `tests/integration/harness-plugin-windows-artifact.test.js`：1 条（打包 Host）。
  - `tests/integration/harness-plugin-artifact.test.js`：29 条；`:281` 有唯一一条 `skip: process.platform === 'win32'`（干净数据根首次创建，归 #644）。
  - fixture 与身份断言：`tests/integration/harness-plugin-windows-fixture.js` 的 `ordinaryToken` 断言 `admin:false` 且 `adminMember:false`；`provisionForeignFixture` 只能由管理员预置 foreign owner fixture。
- 原生证据（易失值按「回读命令 + 期望」记录）：
  - `gh run view 43871692717 -R SingularityKChen/harness-projects --json headSha,conclusion` → head `90a347fb…`（`test/windows-native-qualification`），该 run 内 checkout 产品 source `86202cf9…`；`git diff 86202cf9 62e953cc -- apps/harness-plugin/src tests/integration/harness-plugin-*` 为空，即该证据覆盖 main 的产品树与原生套件。
  - 同 run 日志：`ImageOS=win25-vs2026 ImageVersion=20261103.298.1 Architecture=AMD64`、`node v26.13.1`、`git version 2.56.0.windows.4`、`ℹ tests 69 / pass 68 / fail 0 / skipped 1`、`standard-user exit=0`、7 次 `{"admin":false,"adminMember":false,"sid":"S-1-5-21-…"}`。
  - Git 套件唯一的原生证据在 admin 身份、产品 source `3091d4ab`（run `43853289308` 的 `Native Windows Git paths`：`ℹ tests 16 / pass 16`）。`git diff 3091d4ab ddb94c94 -- tests/integration/development-local-git-windows.test.js` 为 +32 行（2 条新用例），`local-git-fixture.js` 与 `host-providers.ts` 也各有变化，所以 main 的 18 条 Git 原生用例从未整体原生运行过；本 lane 首跑是它们的首个原生证据（风险见 D11）。
- 原型（只读参考，不移植其 pinned `ref:`、`if:false`、matrix、内嵌 worker）：`git show test/windows-native-qualification:.github/workflows/windows-native-qualification.yml`。该分支 head `90a347fb` 的 private-data job 用 `New-LocalUser` + `Start-Process -Credential -LoadUserProfile` 正是 68/0/1 的来源；同文件的 git-paths job 为 `if: false`。
- 可复用实现：`scripts/run-test-layer.mjs` 导出 `parseSummary`（把 `ℹ tests/skipped/todo` 解析成整数，缺失时返回 `null`，POSIX 已由 `tests/contract/run-test-layer.test.js` 覆盖）；`scripts/resolution-check.mjs` 导出 `assertLocalResolutions(root)`（解析边界 fail-closed 预检）。

### 术语

- **lane**：`ci.yml` 中一个 job；本任务是 `windows-native`。
- **set**：`scripts/windows-native-checks.mjs` 的命名单测列表（`native-git`、`private-data`）；清单、每文件用例下界、允许 skip 数只在 `SETS` 常量出现一次。
- **foreign fixture**：管理员在标准用户 profile 内预置、owner/SID 指向标准用户的 `harness-projects` 数据根；测试用它证明 foreign-owned 数据库/日志被拒绝。
- **standard user**：`New-LocalUser` 创建、只加入 `Users`（S-1-5-32-545）、经 `Start-Process -Credential -LoadUserProfile` 启动进程的临时本地账户；测试用 `ordinaryToken` 自证非管理员。

## Design / Spec

### 选定方案（A）：单 job + 两阶段身份 + 脚本化清单与反空心

`ci.yml` 新增一个 job：

```yaml
  windows-native:
    name: Windows Native（原生安全与平台契约）
    runs-on: windows-2025
    timeout-minutes: 15
    defaults:
      run:
        shell: pwsh
    steps:
      - actions/checkout（沿用现有 40 位 pin，persist-credentials: false）
      - pnpm/action-setup（沿用现有 pin）
      - actions/setup-node（沿用现有 pin，node-version-file: .nvmrc，cache: pnpm）
      - pnpm install --frozen-lockfile
      - pnpm --filter @harness-projects/app-harness-plugin build
      - 记录 runner/工具链/身份（git rev-parse HEAD、ImageOS、ImageVersion、PROCESSOR_ARCHITECTURE、node --version、git --version、WindowsIdentity 的 SID + IsInRole(Administrator) + Administrators 组成员判定）
      - node scripts/windows-native-checks.mjs --set native-git    # 阶段 1：runner 管理员身份
      - 标准本地用户执行（阶段 2，内联 pwsh，见下）
```

阶段 2 以 `test/windows-native-qualification` 的 `Qualify exact source as a separate standard user` 步骤为蓝本，逐项保留并去掉 matrix/`QUALIFICATION_MODE`/内嵌 worker 字符串，改为 `Start-Process` 直接调用 runner：

1. `New-LocalUser`（随机名，`AccountNeverExpires`、`UserMayNotChangePassword`）→ `Add-LocalGroupMember -SID 'S-1-5-32-545'`；记录 `$sid`。
2. `Start-Process node -e 'process.exit(0)' -Credential <PSCredential> -LoadUserProfile -Wait` 初始化 profile；`Get-CimInstance Win32_UserProfile -Filter "SID='$sid'"` 取 `LocalPath`。
3. 管理员预置 foreign fixture：`node --input-type=module -e "import {provisionForeignFixture} from './tests/integration/harness-plugin-windows-fixture.js'; await provisionForeignFixture(...)"`（经 `HARNESS_NATIVE_FIXTURE_PROFILE`/`HARNESS_NATIVE_FIXTURE_SID` 传值）；失败即 `throw`。
4. `Start-Process` 以 `-Credential ... -LoadUserProfile -WorkingDirectory $env:GITHUB_WORKSPACE` 启动 `node scripts/windows-native-checks.mjs --set private-data --profile <profilePath> --foreign <foreignProfile>`，`-RedirectStandardOutput/-RedirectStandardError` 到 profile 内文件，`-Wait -PassThru`；输出做 `<fixture>` 令牌化后打印；打印 `standard-user exit=<code>`。
5. `try/catch` 打印 `windows-native-harness-failure stage=<stage>` 后失败；`finally` 依次 `Remove-CimInstance Win32_UserProfile`（SID 过滤）与 `Remove-LocalUser`（均 `-ErrorAction SilentlyContinue`）；步骤退出码取测试进程退出码。

`scripts/windows-native-checks.mjs` 是清单与判定的唯一来源：

- `export const SETS`：set → `{ files: [{ file, minTests }], allowedSkips }`；文件集与下界只此一处。
- `export function parseArgs(argv)`：只接受 `--set <native-git|private-data>`，`--profile`/`--foreign` 只与 `private-data` 组合且 `--foreign` 需要 `--profile`；位置参数、未知 flag、重复 `--set` 都失败。
- `export function platformRefusal(platform)`：非 `win32` 返回拒绝文案（返回非空即失败），不做 mock 替代。
- `export function manifestErrors(root)`：文件必须存在、位于 `tests/integration/`、以 `.test.js` 结尾、不得重复；`minTests` 必须是正整数。
- `export function evaluate(setId, results)`：逐文件要求 `status === 0`、`parseSummary` 可解析、`tests > 0`、`tests >= minTests`、`todo === 0`；合计 `skipped` 必须恰等于 `allowedSkips`（多=复用 skip 造假绿，少=清单未随用例移除更新）；缺少某文件的 run 结果也失败。返回 `{ problems, totals }`。
- `runFile(file)`：`spawnSync(process.execPath, ['--test','--test-reporter=spec','--test-timeout=120000', file], { encoding:'utf8', maxBuffer:8MiB, cwd: root, shell:false })`，把 stdout/stderr 原样输出后返回 `{ file, status, output }`。
- `main()`：解析参数 → 平台拒绝 → `--profile` 时设置 `process.env.USERPROFILE`、`TEMP`/`TMP`（`<profile>/AppData/Local/Temp`，先 `mkdirSync`）、`HARNESS_WINDOWS_FOREIGN_PROFILE`，`chdir(root)` → `manifestErrors` → `assertLocalResolutions(root)` → 逐文件执行 → `evaluate` → 违规逐条 `::error::windows-native-checks: <file>: <原因>` 并 exit 1；全绿打印 `windows-native-checks: set=<id> files=<n> tests=<t> skipped=<s> todo=0` 并 exit 0。`invokedDirectly()` 采用仓库现有 realpath 写法，允许契约测试 import 纯函数。

生命周期与状态拥有：`ci.yml` 拥有 job 组合与聚合；内联 pwsh 拥有 Windows 账户/profile/foreign-fixture 的唯一创建与清理；runner 拥有文件集与判定；原生测试拥有产品行为与非提权断言（`ordinaryToken`）；`docs/development/ci.md` 只叙述与索引，不复刻清单数值。

### 命名覆盖（唯一定义在 runner 的 `SETS`）

| set | 文件 | 用例下界 | 期望合计 | 允许 skip | 执行身份 |
|---|---|---|---|---|---|
| `native-git` | `tests/integration/development-local-git-windows.test.js` | 15 | 18 | 0 | runner 管理员 |
| `native-git` | `tests/integration/local-git-start-work-resume.test.js` | 3 | （同上） | 0 | runner 管理员 |
| `private-data` | `tests/integration/harness-plugin-windows-private-data.test.js` | 39 | 69 | — | 临时标准用户 |
| `private-data` | `tests/integration/harness-plugin-windows-artifact.test.js` | 1 | （同上） | — | 临时标准用户 |
| `private-data` | `tests/integration/harness-plugin-artifact.test.js` | 29 | （同上） | 1 | 临时标准用户 |

18 与 69 来自静态计数并与 run `43871692717` 的 `ℹ tests 69 / pass 68 / skipped 1` 对齐（39+1+29=69）。下界是「单调下限」：新增用例不改清单；删除/合并用例必须在同一 PR 更新 `SETS` 并在 `Decision Log` 记录原因。

明确排除并写入 `docs/development/ci.md`：`tests/integration/harness-plugin-private-data.test.js`（POSIX fd/uid/mode/`mkfifo`，win32 上平台门会红且负例会空心化）、`tests/integration/development-local-git.test.js`（chmod/symlink POSIX 语义）、`tests/contract/*`（含 `/bin/sh`、`symlink`、`getuid`；由 Linux `verify` 承担）、`tests/browser/**`（由 `browser` lane 承担）、`tests/integration/storage-restart.test.js`（从未在 Windows 原生验证，且不在 #646 验收清单；SQLite 原生证据由 private-data 套件的 journal/WAL/SHM 与 packed artifact 的 migrations 承担，后续可按 `SETS` 追加一项）。

### 合法 skip 与 #644 交接

唯一合法 skip 是 `tests/integration/harness-plugin-artifact.test.js:281`「干净数据根首次创建」的 `skip: process.platform === 'win32'`，由 #643 为 #644 留下。`allowedSkips` 取**精确值**：多一条即拒绝（防全局 skip 造假绿），少一条也失败（强制清单随用例同 PR 更新）。#644 交付时必须在同一 PR 内：(a) 删除该 skip；(b) 把 `private-data.allowedSkips` 改为 0；(c) 若新增 fresh-profile 用例文件，向 `SETS.private-data.files` 追加 `{ file, minTests }`。接口不预加未用字段：`process.env.USERPROFILE` 已是标准用户 profile（fresh 语义），`HARNESS_WINDOWS_FOREIGN_PROFILE` 是预置 foreign fixture；#644 直接据此构造 fresh-create 用例。

### 为什么两阶段身份

Git 套件唯一原生证据是 admin（`3091d4ab` 16/16），private-data 套件唯一原生证据是标准用户（`86202cf9` 68/0/1）。本 PR 只复制这两组已被证明的配置，首跑才可能绿；把 Git 套件也放进标准用户阶段属未验证组合（可能因 `git`/profile 环境差异首跑红），留待有证据再合并为一个身份。安全相关套件（私有根准入、Host、packed plugin）全部在标准用户下执行，且测试自证 `admin:false`，因此「提权 runner 成功」不作为普通用户隔离证据；runner 管理员阶段只承担路径/身份/恢复类 Git 行为与非安全 fixture 预置。

### 反空心与失败语义

缺失文件、清单为空、重复项、非 `win32`、请求非法、`assertLocalResolutions` 失败、测试进程非零退出、摘要不可解析、零执行、`todo>0`、单文件低于下界、skip 数与预算不符、超时（`--test-timeout=120000` 与 job 15 分钟）→ lane 非零并打印 `::error::` 点名 set/文件/规则；不重试、不 `continue-on-error`、不全局 skip、不在 YAML 内联文件名。job / 任一 step 不得声明 `if`（清理在脚本内 `finally`，不用 step 级 `if`）。聚合仍由现有 `contains(needs.*.result, 'failure'|'cancelled'|'skipped')` 完成，failure/cancel/skip 全部拒绝。

### 三路设计对抗评审

| 设计 | 可采用的 | 过度/不足 | 事实问题 | 处置 |
|---|---|---|---|---|
| 设计 1（系统/状态所有权） | 单 job、`SETS` 单一来源、pwsh 只做账户生命周期、scratch ref + `workflow_dispatch` 负控、逐文件下限、skip 预算 | 过度：pwsh↔runner 之间再定义请求 JSON 并校验形状（input 只来自本 job，多余一层）；不足：把 5 个文件放进同一标准用户阶段，Git 套件身份未验证 | 「覆盖映射由这 5 个文件承担」与 main 的 Git 证据身份不一致 | 采用其骨架；改为两阶段身份；去掉请求 JSON |
| 设计 2（安全/失败路径） | 两阶段身份、`--set` 白名单、fail-closed 全清单、清理与身份记录、禁止把 POSIX 文件塞入 lane | 过度：`scripts/*.ps1` + runner 双脚本、`Wait-Process -Timeout 600`（`Start-Process -Wait` 已够，job 上界兜底）、按标题前缀匹配唯一 skip（标题一改就误报）；不足：没有可执行的用例下界数值，首个绿跑前无法发现清单被删 | **事实错误**：称「main 与 `5dd6456d` 相同，hosted 曾 16/16」——16/16 是 `3091d4ab`（13+3 条）；main 相对 `5dd6456d` 还改了 `host-providers.ts` 与 `local-git-fixture.js`，且 main 的 Git 测试文件是 15 条（合计 18），从未整体原生跑过 | 采用其失败语义与两阶段；skip 用计数而非标题；补下界数值 |
| 设计 3（产品/交付） | 单 job、复用 `parseSummary`、draft PR 首跑即基线、交付节奏、边界与 #647 的表述 | 过度：单标准用户阶段跑 6 个文件（含 `storage-restart.test.js`，无 native 证据且不在验收内）；不足：无逐文件下界与 skip 预算，单文件被删仍可能绿 | 把原型双 job 说成「各付一次建号/setup」——原型两 job 分别 checkout 不同精确 source，是为两个叶子各自取证，不是重复覆盖 | 采用单 job 与 `parseSummary` 复用；改为两阶段 + 下界；排除 storage-restart |

三路共同沿用旧研究（`main=ba27b24c`）的结论「lane 只能跑可移植子集 + 原生拒绝负控」。该结论已被新 main 推翻：`git diff 86202cf9 62e953cc -- apps/harness-plugin/src tests/integration/harness-plugin-*` 为空，原生套件与 Host 接线都在 main，lane 可以直接跑命名原生套件。

### 被放弃方案（及原因）

1. 全部内联 YAML（资格原型路线）：`SETS`、缺失文件、零执行、skip 预算只能在 hosted Windows 上验证，POSIX 契约层无法判别反空心；放弃。
2. 独立 workflow 或 reusable workflow：跨 workflow 不能进入 `needs`，只能改必需检查名或引入脆弱的 `workflow_run` 链，且新增 workflow 要同步 W 规则/契约/文档；放弃。
3. 两个并行 Windows job（复刻原型 git-paths + private-data）：原型两 job 是为两个不同 source 各自的资格；本 lane 两 set 都跑同一 head，拆开要重复 checkout/install、多一次建号与聚合项，首跑等待更长；放弃。
4. Windows 上跑 `pnpm test` / `pnpm verify`：`tests/contract/ci-browser-workflow.test.js` 依赖 `/bin/sh`，Host 平台门与 POSIX 断言会红，且负例会空心；放弃。
5. observation-only lane（先不聚合）：违背 #646 验收「纳入 PR Fast Gate」，且 Fast Gate 绿色将不再代表 Windows 平台反馈；放弃。
6. 新增 W8（如「Windows lane 必须记录 ImageVersion」）：`windows-2025` 已白名单，W1–W7 已覆盖超时/凭据/permissions/pin；新增规则要同步规则实现、规则契约、repository-rules 与 ci.md，且硬断言 ImageVersion 会随镜像漂移周期红；放弃，只记录不硬断言。
7. 单标准用户阶段跑全部 5 文件：未验证组合，首跑风险高；放弃（见上）。
8. 纳入 `tests/integration/storage-restart.test.js`：无原生证据、不在验收内、增加必需门禁 flake 面；放弃。
9. 把 harness 移入 `scripts/windows-native-standard-user.ps1`：账户/profile 操作在 POSIX 无法单测，脚本化只新增未验证面并改变已证明的调用形态；YAML 内联直接复制原生验证过的步骤；放弃。
10. 预加 #644 的 fresh-profile 字段：未用配置等于死代码；`USERPROFILE` 已提供 fresh profile 语义；放弃。

### 关键不变量

- **I1 聚合闭合**：`fast-gate` 仍是唯一必需检查名；`windows-native` failure/cancelled/skipped 均让 `PR Fast Gate` 红；聚合 job 仍不 checkout、不读 secrets、不执行候选代码。
- **I2 清单唯一**：文件集、每文件下界、允许 skip 只存在于 `SETS`；YAML 中不出现 `.test.js` 字面量；`--set` 只接受 `SETS` 的键。
- **I3 反空心 fn**：零执行/摘要缺失/`todo>0`/低于下界/skip 预算不符全部失败；不重试、不 `continue-on-error`、不全局 skip、无 step/job 级 `if`。
- **I4 身份**：安全/Host/packed 用例只在临时标准用户下执行，测试自证 `admin:false` 且 `adminMember:false`；runner 管理员阶段只跑 Git 路径/身份/恢复类用例，并在日志记录其 admin 身份。
- **I5 权限与凭据**：继承顶层 `contents: read`，job 不覆盖 permissions；无 secrets、无写权限、无 `pull_request_target`、不 checkout 其它 ref、hosted runner only；action 沿用现有 40 位 pin；checkout `persist-credentials: false`。
- **I6 工具链来源**：Node 取 `.nvmrc`，pnpm 取 `package.json` 的 `packageManager`；只显式 `shell: pwsh`，不依赖继承的 bash 假设。
- **I7 边界**：`windows-2025` 是 Windows Server 2025 x64 镜像，不等于 Win11 x64 Desktop；不替代 #647 安装验收、不替代 R1、不宣称 Windows 已获产品支持。
- **I8 零产品改动**：不修改 `apps/**`、`packages/**`、`tests/**` 既有文件（除新增 runner 契约测试），无新依赖、无旧数据兼容/迁移、不改 Host ABI。
- **I9 可复现**：lane 不钉产品 SHA、不覆写 ref，直接跑事件 head；每个 PR 的 lane 结果可由 `gh pr checks` 回读，精确 head 证据由 `workflow_dispatch --ref <branch>` 回读。

## Global Constraints

完整文件集合（本 PR 只允许这些改动；批次章节不再复述）：

代码（`docs/` 以外，增删合计目标 ≤800）：

- `.github/workflows/ci.yml`：新增 `windows-native` job（约 +100），`fast-gate.needs` 加一项（约 −1/+1）。
- `scripts/windows-native-checks.mjs`：新增，`SETS` + CLI + 反空心判定（约 +150）。
- `tests/contract/windows-native-checks.test.js`：新增，runner 纯函数与 CLI 契约（约 +95）。
- `tests/contract/ci-windows-workflow.test.js`：新增，lane 接线契约（约 +95）。
- `tests/contract/ci-browser-workflow.test.js`：修改，4 job / 3 lane / 4³=64 组合（约 +25/−13）。

文档（`docs/` 下，增删合计目标 ≤1300）：

- `docs/development/ci.md`：workflow 表一行、needs 描述、新增「Windows 原生 lane」一节、排除与 skip 归属、负控与成本（约 +65/−5）。
- `docs/exec-plan/active/2026-11-17-windows-native-lane.md`：本计划（约 +360）。
- `docs/README.md`：Active 索引一行（+1）。

文档合计约 +430，低于 1300；若收敛评审要求压缩，只删本计划中的重复证据叙述，不删验收判据与命令。

硬约束：

- 代码（除 `docs/`）增删合计 ≤800 行，文档增删 ≤1300 行；仓库硬帽仍为 1000/1500。按上文逐文件估算，代码约 +455/−14、文档约 +430，均有余量。超出时按以下顺序简化：先删契约测试里与 W1–W7 重复的断言，再合并 `ci-windows-workflow.test.js` 中的字符串断言，最后才考虑压缩 lane 的 state/身份记录；不得压缩安全逻辑、删负控或把搬移行当免费。
- TDD：先写判别性失败测试再实现；不为覆盖率铺测试；不新增依赖、不新增抽象层、不新增 workflow 文件、不新增 W 规则。
- 当前无正式发布：不做旧数据/旧设计兼容、迁移或修复；保持真实 Host ABI、身份、权限、事务、ack/reconcile、恢复不变量。
- 文档中文、标识符/路径/命令英文；不写本机绝对路径；公开面（commit/PR/issue）正文英文。
- 不写 GitHub 项目 `Status`、不改他人 PR 历史、不合并、不发版；分支保护配置不修改。
- 不复制 `test/windows-native-qualification` 的 pinned `ref:`、`if:false`、matrix、内嵌 worker；该分支是协调者 scratch，不作为交付物，也不在本 PR 删除。

## Plan of Work

### Batch 1 · 计划落库与 draft PR（docs-only）

**最小闭环**：本计划进入仓库 `docs/exec-plan/active/`，索引与 draft PR 就位，后续批次可独立审阅。
**涉及文件**：`docs/exec-plan/active/2026-11-17-windows-native-lane.md`、`docs/README.md`。

1. 在检出 `test/windows-native-lane` 的工作树根（`.worktrees/windows-native-lane`）写入本计划（内容取自本草案，状态行改为 Active、`Progress` 全部未勾）。
2. `docs/README.md` 的 `### Active` 表追加一行，指向该计划。
3. 提交 `docs(exec-plan): 起草 Windows 原生 CI lane 交付计划`，push `test/windows-native-lane`，`gh pr create --draft --base main --head test/windows-native-lane -R SingularityKChen/harness-projects`；PR body 用英文，含闭环、ExecPlan 路径与 Batch、`Closes #646`、风险与回滚。

**验证**（在检出 `test/windows-native-lane` 的工作树根执行）：

```bash
gh pr view <编号> -R SingularityKChen/harness-projects --json isDraft,baseRefName,headRefOid,closingIssuesReferences
```

期望：`isDraft=true`、`baseRefName=main`、`closingIssuesReferences` 含 `#646`；`gh pr checks <编号>` 三行（Verify、Browser、PR Fast Gate）为 pass。

**回滚**：`gh pr close <编号>` 并删除远端分支；或直接 revert 该 docs commit。无产品/数据副作用。

### Batch 2 · 清单与反空心判定（TDD，POSIX 可判别）

**最小闭环**：`scripts/windows-native-checks.mjs` 提供唯一清单与 fail-closed 判定，其语义在 Linux `verify` 上可被契约测试判别；此时尚不接线 CI。
**涉及文件**：`tests/contract/windows-native-checks.test.js`、`scripts/windows-native-checks.mjs`。

1. 先写契约测试（首 import `../fixtures/resolution-preflight.mjs`）：manifest 形状与文件存在/不重复/位于 `tests/integration/`；`platformRefusal`；`parseArgs` 白名单；`evaluate` 对 fail/缺摘要/零执行/低于下界/`todo>0`/skip 数不符/缺 run 全部报错，对合法输入返回空；CLI 对 `--set nope`、非 win32 平台、未知 flag 返回 1 且输出 `::error::`。
2. `node --test tests/contract/windows-native-checks.test.js` 期望失败（模块尚不存在），记录红证据后再实现 runner。
3. 实现 `scripts/windows-native-checks.mjs`（`SETS` 初值取上表下界：15/3、39/1/29 与 allowedSkips 0/1）；复跑转绿。

**验证**（在本检出根执行；POSIX 上只验证纯函数与 fail-closed，不执行 Windows 用例）：

```bash
node --test tests/contract/windows-native-checks.test.js          # 期望 ℹ fail 0 且 tests ≥ 8
node --test tests/contract/run-test-layer.test.js                 # 期望 fail 0（parseSummary 复用未改）
node scripts/windows-native-checks.mjs --set nope; echo "exit=$?" # 期望 exit=1 且输出 ::error::
node scripts/windows-native-checks.mjs --set native-git; echo "exit=$?" # 期望 exit=1，报非 win32 平台拒绝（不得静默通过）
node scripts/resolution-check.mjs; echo "exit=$?"                 # 期望 exit=0
```

**回滚**：删除两个新文件（`git rm` 或 revert 本批提交）。无其它文件受影响。

### Batch 3 · lane 接线、文档与聚合契约（TDD）

**最小闭环**：PR 上出现 `windows-native` lane 并被 `PR Fast Gate` 聚合，W1–W7 与现有契约继续通过；文档与行为一致。
**涉及文件**：`tests/contract/ci-browser-workflow.test.js`、`tests/contract/ci-windows-workflow.test.js`、`.github/workflows/ci.yml`、`docs/development/ci.md`。

1. 先改 `tests/contract/ci-browser-workflow.test.js`：job 键集合 4 个、`fast-gate.needs` 排序后为 `['browser','verify','windows-native']`、组合测试改为 3 lane 的 64 种、标题改「三个 lane」；`node --test tests/contract/ci-browser-workflow.test.js` 期望红。
2. 先写 `tests/contract/ci-windows-workflow.test.js`（首 import preflight；注释声明聚合语义的唯一断言在 `ci-browser-workflow.test.js`）：job 存在；`runs-on: windows-2025`；`timeout-minutes` 为 1–15 整数；`defaults.run.shell: pwsh`；job 与所有 step 无 `if`/`continue-on-error`；job 不覆盖 `permissions`；`JSON.stringify(job)` 不含 `secrets` 与 `.test.js`；两条入口 `node scripts/windows-native-checks.mjs --set native-git` / `--set private-data` 且两者都在 `SETS`；标准用户步骤含 `New-LocalUser`/`Add-LocalGroupMember`/`-LoadUserProfile`/`provisionForeignFixture`/`HARNESS_WINDOWS_FOREIGN_PROFILE`/`Start-Process … windows-native-checks.mjs`/`Remove-CimInstance`/`Remove-LocalUser`/`finally`；身份记录步骤含 `ImageOS`/`ImageVersion`/`PROCESSOR_ARCHITECTURE`/`node --version`/`git --version`/`WindowsIdentity`/`IsInRole`；checkout step 有 `persist-credentials: false`；setup-node 用 `.nvmrc` 且存在 `pnpm/action-setup`。
3. 再改 `.github/workflows/ci.yml`：新增 job 与 `needs`；`docs/development/ci.md` 同步表格、needs 描述与新节（覆盖表、排除理由、唯一 skip 归属 #644、身份与提权、反空心规则、负控流程、成本回读、Server x64 ≠ Win11 x64）。

**验证**（在本检出根执行）：

```bash
node --test tests/contract/ci-browser-workflow.test.js tests/contract/ci-windows-workflow.test.js
# 期望 ℹ fail 0；ci-browser 为 5 条，ci-windows tests ≥5
node scripts/workflow-check.mjs
# 期望 workflow-check: no findings（已检查 7 个文件），exit 0
pnpm verify
# 期望 typecheck + 三层各非空全绿，exit 0
gh pr checks <编号>   # push 后回读；期望四条检查（Verify、Browser、Windows Native、PR Fast Gate）全部 pass
```

首次 hosted 运行可能红：按 D11 分诊——真实产品/测试回归不得靠改清单/加 skip 变绿；lane 自身故障在 lane 内修；若 Git 套件因 main 上 2 条新用例红，先修用例/夹具的最小根因并记录 `Surprises & Discoveries`。

**回滚**：revert 本批提交（3 处代码 + 1 处文档）；`fast-gate.needs` 回到 `[verify, browser]`，分支保护无需改动。

### Batch 4 · hosted 负控与恢复绿证

**最小闭环**：在同一份 CI 定义上证明 lane 失败会让 `PR Fast Gate` 红、反空心守卫会拒绝 skip 预算不符，且正式 head 保持/恢复绿。
**涉及文件**：无被跟踪文件改动（只用临时 ref，不写 PR head）。

1. **负控 A（测试失败传播）**：从 lane head 建 `scratch/windows-native-lane-fail`，在 `tests/integration/harness-plugin-windows-private-data.test.js` 的一条 native 用例末尾加 `assert.fail('windows-native-lane negative control')`，提交并 push；`gh workflow run ci.yml -R SingularityKChen/harness-projects --ref scratch/windows-native-lane-fail`；回读该 run：期望 `windows-native=failure`、`fast-gate=failure`、`verify`/`browser` success，且日志含该 `assert.fail` 文本。
2. **负控 B（反空心守卫）**：从 lane head 建 `scratch/windows-native-lane-hollow`，把 `SETS['private-data'].allowedSkips` 改为 `0`（其余不变），提交并 push 后同样 dispatch；期望 `windows-native=failure` 且日志含 `::error::windows-native-checks:` 的 skip 预算不符（证明拒绝来自 runner 而不是 node 测试失败），`fast-gate=failure`。
3. **恢复绿证**：删除两个 scratch 分支（`git push origin --delete scratch/windows-native-lane-fail scratch/windows-native-lane-hollow`，删除前先记录 run id）；对正式 `test/windows-native-lane` 连续执行两次 `gh workflow run ci.yml --ref test/windows-native-lane`，回读两次均 `windows-native`/`fast-gate` success 且 head 未变；同时 PR 的 `pull_request` 运行在最终 head 上 pass。

**验证**（命令与期望）：

```bash
gh run list -R SingularityKChen/harness-projects --workflow CI --branch scratch/windows-native-lane-fail --limit 1 \
  --json databaseId,headSha,conclusion
gh run view <run-id> -R SingularityKChen/harness-projects --json jobs \
  --jq '.jobs[] | "\(.name) \(.conclusion)"'
# 期望第一、二次负控各出现 windows-native failure + PR Fast Gate failure；verify/browser success
gh run view <run-id> -R SingularityKChen/harness-projects --log | grep -E 'negative control|windows-native-checks:'
# 负控 A 命中 assert.fail 文本；负控 B 命中 skip 预算 ::error::
git ls-remote --heads origin 'scratch/windows-native-lane-*'   # 期望无输出
```

**回滚**：临时 ref 全部删除即可；正式 head 未被负控提交触碰，无需 force-with-lease。若负控证明的是真实缺陷，按 D11 修根因后重跑，不改判据。

### Batch 5 · 规模/发布面收敛与 ready

**最小闭环**：diff、证据、文档与远端状态一致，PR 交给人类评审。
**涉及文件**：`docs/exec-plan/active/2026-11-17-windows-native-lane.md`（Progress/Surprises/Decision Log/Outcomes/Bottom Change Note）。

1. 把 Batch 3–4 的 hosted run id、精确 head、`ImageOS`/`ImageVersion`/架构/身份行、两组 counts 与 skip 行、负控结果写入 `Progress` 与 `Surprises & Discoveries`（易失值写成回读命令 + 观察时刻 + head）。
2. 收敛本地 commit 为可独立审阅的序列（计划 / runner+契约 / CI 接线+文档 / 证据记录），移除调试提交；最终 push。
3. 回读 PR head/base/checks/issue 关联/threads，全部一致后 `gh pr ready`。

**验证**：

```bash
node scripts/rule-checks.mjs size main      # 期望 code ≤800 且 docs ≤1300（并输出仓库 1000/1500 判定）
node scripts/rule-checks.mjs disclosure main  # 期望无 findings，exit 0
git diff --check main...HEAD                # 期望无输出
pnpm verify                                 # 期望 exit 0
gh pr checks <编号>                         # 期望全部 pass
gh pr view <编号> -R SingularityKChen/harness-projects \
  --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup
```

**回滚**：单 PR revert 即恢复两 lane 聚合；无产品/数据/分支保护副作用。

## Validation and Acceptance

最小可观察结果与判定证据（命令只在上面各处展开一次）：

| #646 验收条目 | 本 PR 的判定证据 |
|---|---|
| 记录真实 runner/Node/Git/runtime；真实执行 Windows 安全正/负、Host 启动/重开/销毁、LocalGit 行为、含 SQL 资产的 packed plugin 加载；Linux mock 不算资格 | `windows-native` 每次运行执行两个 set（18 + 69 条，含 `positiveHost` 的启动/重开/销毁、21 类 unsafe 拒绝、foreign-owner 拒绝、Git 路径/恢复、`apps/harness-plugin/dist/package` 的真实 import）；身份步骤输出 `ImageOS`/`ImageVersion`/`PROCESSOR_ARCHITECTURE`/node/git；日志回读命令见 Batch 3/4 |
| 只适配真实的跨平台 fixture/launcher 假设；安全用例原生执行且不被全局 skip；POSIX ACL 证据留在自己平台；识别未资格化的 runtime/arch | 排除表与排除理由进 `docs/development/ci.md`；`allowedSkips=1` 精确计数，唯一 skip 常驻可回读；文档明确 Server 2025 x64 ≠ Win11 x64 Desktop |
| W1–W7/契约/文档同步；`PR Fast Gate` 保持唯一必需名、自身不执行候选代码/secrets、failure/cancel/skip 拒绝；无凭据/写权限/自托管 | `node scripts/workflow-check.mjs` 无 findings（7 文件）；`ci-browser-workflow.test.js` 固定 64 种 needs 组合；`ci-windows-workflow.test.js` 固定 no-`if`/no-`continue-on-error`/无 secrets/继承只读权限；聚合 job 未改 |
| 记录 current-SHA hosted 结果、lane/聚合准入的真负控；CI 不能替代人工安装 Desktop 验收 | 精确 head 的两次 `workflow_dispatch` success + PR `pull_request` 运行 success；负控 A/B 的 run id 与结论；无依赖变更（package.json/pnpm-lock 不动），因此无新增 artifact/raw/gzip 图证据需求；`docs/development/ci.md` 与 ExecPlan 写明 #647 边界与「CI 不替代人工验收」 |

## Progress

- [ ] 2026-11-17 Batch 1：ExecPlan 落库、`docs/README.md` 索引、draft PR 创建并回读（未开始）
- [ ] 2026-11-17 Batch 2：`tests/contract/windows-native-checks.test.js` 先红，`scripts/windows-native-checks.mjs` 实现后转绿（未开始）
- [ ] 2026-11-17 Batch 3：`ci-browser-workflow.test.js` / `ci-windows-workflow.test.js` 先红，`ci.yml` + `docs/development/ci.md` 接线后四契约与 `workflow-check`、`pnpm verify` 绿；首次 hosted 运行结论待记录（未开始）
- [ ] 2026-11-17 Batch 4：负控 A/B 红证与两次精确 head 绿证（run id 待回读填入，未开始）
- [ ] 2026-11-17 Batch 5：size/disclosure/diff-check/全套 verify、远端回读通过，`gh pr ready`（未开始）

## Surprises & Discoveries

1. 2026-11-17：旧研究（`main=ba27b24c`）结论「main 上没有 Windows 原生套件，lane 只能跑可移植子集 + 原生拒绝负控」已过期。`git ls-files` 回读：`harness-plugin-windows-private-data.test.js`、`-windows-artifact.test.js`、`development-local-git-windows.test.js`、`windows-fixture.js` 均在 main。证据：`git diff 86202cf9 62e953cc -- apps/harness-plugin/src tests/integration/harness-plugin-*` 为空，run `43871692717` 的 68/0/1 直接对应 main 产品树。
2. 2026-11-17：`harness-plugin-artifact.test.js` 的唯一 win32 skip 是 #643 新增的「干净数据根首次创建」（`:281`），不是历史 skip；它是本 lane 的 `allowedSkips=1` 来源，#644 接管后必须同 PR 归零。
3. 2026-11-17：private-data set 的 69 条不是 48 条：`harness-plugin-windows-private-data.test.js` 的 unsafe-kind 用例内部有 21 条 `t.test` 子用例（18+21=39），39+1+29=69 与 run `43871692717` 的 `ℹ tests 69 / pass 68 / skipped 1` 完全吻合。
4. 2026-11-17：Git 套件的 16/16 历史证据绑定 `3091d4ab`（13+3 条）；main 的 `development-local-git-windows.test.js` 比它多 32 行/2 条（`git diff 3091d4ab ddb94c94`），`local-git-fixture.js`/`host-providers.ts` 也有变化，因此 main 的 18 条从未整体原生运行；设计 2 的「main 与 `5dd6456d` 相同，hosted 曾 16/16」是事实错误。
5. 2026-11-17：`tests/integration` 现有 94 个 `.test.js`（旧研究写 91）；不影响本 lane，但说明文档/计划里的文件计数一律以 `ls tests/<层>/*.test.js` 回读为准。
6. 2026-11-17：`.github/workflows/` 共 7 个文件，`workflow-check` 检查 7 个；本 PR 只在 `ci.yml` 内加 job，因此 W 规则自检的「已检查 7 个文件」不变，无需新增 W 规则。
7. 2026-11-17：`test/windows-native-qualification` 的 git-paths job 当前是 `if: false`，只有 private-data job 在跑（head `90a347fb`）；该分支是协调者 scratch，不得复制其 pinned `ref:`/matrix，也不在本 PR 删除。

## Decision Log

- **D1（2026-11-17，设计评审）**：在现有 `ci.yml` 加单 job，而不是独立 workflow、reusable workflow 或双 job。Rationale：跨 workflow 不能进 `needs`；改必需检查名会动分支保护；双 job 对同一 head 重复 install/建号且延长首跑。
- **D2（2026-11-17，设计评审）**：`SETS` 与反空心判定放 `scripts/windows-native-checks.mjs`，YAML 不内联文件清单。Rationale：POSIX 契约层可判别清单存在性/下界/skip 预算/缺文件/零执行，hosted-only 的 YAML 字符串断言无法证明反空心；#644 只需改一处常量。
- **D3（2026-11-17，设计评审）**：两阶段身份——`native-git` 用 runner 管理员（唯一历史证据 `3091d4ab` 16/16 是 admin），`private-data` 用临时标准本地用户（唯一历史证据 `86202cf9` 68/0/1 是 standard user）。Rationale：只复制已被证明的配置，保证必需门禁首跑可控；安全相关套件全部在标准用户下并由 `ordinaryToken` 自证，提权 runner 的成功不被当作普通用户隔离证据。不把 Git 套件放进标准用户阶段是本 PR 的显式范围限制，未验证组合不进入必需门禁。
- **D4（2026-11-17，设计评审）**：账户/profile/foreign-fixture 生命周期内联在 `ci.yml` 的 pwsh step。Rationale：该步骤已由 run `43871692717` 端到端证明；账户操作在 POSIX 无法单测，抽成新脚本只增加未验证面并通过 `Start-Process` 改调用形态；写面也保持在 lane 的单 owner 内。
- **D5（2026-11-17，设计评审）**：skip 预算用精确计数（`private-data=1`，`native-git=0`），不用标题前缀。Rationale：计数可被 `parseSummary` 稳定解析；多一条=拒绝造假绿，少一条=强制 #644 同 PR 更新清单；标题改写不会造成假红。
- **D6（2026-11-17，设计评审）**：下界取静态计数并在首绿核对（15/3、39/1/29），不做总数上限。Rationale：新增用例应自动通过（只设下界）；删除/合并用例必须显式改清单，防覆盖静默缩水。
- **D7（2026-11-17，设计评审）**：不新增 W8、不改 `scripts/workflow-check.mjs`。Rationale：`windows-2025` 已在托管 runner 白名单，W1（≤15 分钟）/W2（persist-credentials）/W3（40 位 pin）/W4（只读权限）足以约束新 job；新增规则要同步规则实现/契约/repository-rules/ci.md，且硬断言 ImageVersion 会随镜像漂移周期红。镜像只记录不判定。
- **D8（2026-11-17，设计评审）**：负控用临时 branch + `gh workflow run ci.yml --ref <scratch>`，不把红提交推到 PR head。Rationale：`ci.yml` 无 secrets、候选 lane 只读，`workflow_dispatch` 在这条边界内安全（`docs/development/ci.md` 已记录该区分）；避免 force-with-lease 改写公开 PR head，且负控发生在新 CI 定义上。
- **D9（2026-11-17，设计评审）**：排除 `storage-restart.test.js`、POSIX-only 与 browser/contract 文件。Rationale：前两者无原生证据/不在验收内或平台语义不成立；SQLite 原生证据已由 private-data 套件的 journal/WAL/SHM 与 packed artifact migrations 覆盖；后续需要时只改 `SETS` 一处。
- **D10（2026-11-17，设计评审）**：不预加 #644 的 fresh-profile 请求字段；`USERPROFILE`（标准用户真实 profile）+ `HARNESS_WINDOWS_FOREIGN_PROFILE`（预置 foreign fixture）已是 #644 的接口。Rationale：未用字段是死配置，且会固化未验证的接口形状。
- **D11（2026-11-17，设计评审）**：首次 hosted 运行红的分诊规则：先区分「真实产品/测试回归」与「lane 实现/环境故障」；前者不得通过删文件、加 skip、降下界变绿，最小根因修复（必要时另开阻塞 PR 并在本 PR 记录）；后者在 lane 内修并复跑。清单一经首绿即冻结，任何调整写入本计划 `Surprises & Discoveries` + `Bottom Change Note`。
- **D12（2026-11-17，设计评审）**：PR 默认 `Closes #646`（四条验收由本 lane 满足），并在 PR body 写明未纳入项（#646 评论追加的原生用例）及承接方式。若 lead 裁决要求先补评论用例，则改 `Refs #646` 并加后续批次（见 Open Questions）。
- **D13（2026-11-17，设计评审）**：`windows-native` 继承 `ci.yml` 的全部触发器（`pull_request`、push main、`workflow_dispatch`）。Rationale：main push 的 windows 记录与 PR 同等重要（免费、无 secret），`workflow_dispatch` 是负控与精确 head 证据的入口，且已是现有 CI 契约的一部分。
- **D14（2026-11-17，设计评审）**：不先合并到 main 取「main 上的绿证」再开 PR。Rationale：lane 的 job 只存在于本分支，main 上没有可跑的 Windows lane；先把未经绿证的门禁合并进 main 会让所有 PR 立即被一条未验证的必需路径阻塞，且违反「PR 是一个可独立验收/回滚的闭环」。等价做法是：在 `test/windows-native-lane` 上 push 后用 `gh workflow run ci.yml --ref test/windows-native-lane` 取得与 PR 完全同一份 CI 定义的精确 head 绿证（`workflow_dispatch` 在 `ci.yml` 已存在且无 secret，`docs/development/ci.md` 记录了这条边界），再由 draft PR 的 `pull_request` 运行复现同一结果；两者的 `ci.yml` 与 checkout 提交都是同一 head。

**Lead 裁决（2026-11-17）**

- OQ1：采纳「不纳入本 PR」。真实非 NTFS / mapped-network 卷反例与可选 Provider probe 契约测试另立 follow-up（需要 VHD/SMB 级系统 fixture，属同一 lane 的增量，不应阻塞 #646 主闭环）；本 PR 的 PR 正文与 Outcomes 必须显式列出未覆盖项与承接方式。读取延迟测量与预算定义归 #647 Windows 11 Desktop 人验证据；lane 在日志中记录真实 probe 耗时但本 PR 不硬断言数值。
- OQ2：接受 lane 合并后立即成为所有 PR 的必需路径（issue 明确要求；以首绿、连续两次精确 head 成功、15 分钟上界为控制）。
- OQ3：接受两阶段身份，`native-git` 保持 runner 管理员（唯一历史证据），安全/Host/packed 套件在临时标准用户下执行并由 `ordinaryToken` 自证。

### Open Questions（历史；已由上方 Lead 裁决关闭）

1. **issue #646 评论追加的原生用例是否纳入本 PR**：真实 mapped-network / 非 NTFS 卷反例（#643 helper 与 #645 provider probe）、探针读延迟预算、可选 probe 契约测试。建议：不纳入本 PR，另开 `test(ci): extend native Windows lane with real-volume negatives` follow-up（需要 SMB 共享/VHD 等新系统级 fixture，约 +200 技术行并显著提高必需门禁的 flake 面；lane 落地后它们只是同一 lane 的增量）。代价：本 PR 关闭 #646 时这些 review surfaced 项只由 follow-up issue 跟踪，需要 lead 批准该公开面写操作。
2. **Windows hosted lane 立即成为所有 PR 的必需路径是否接受**：合并后任何 Windows hosted 抖动都会阻塞全仓合并。建议接受（#646 明确要求；以首绿 + 两次连续精确 head 成功 + 15 分钟上界 + 无重试控制）。若要求先观察，则必须改 #646 验收措辞，属计划变更。
3. **`native-git` 套件的身份**：建议保持 runner 管理员（唯一历史证据），只把安全/Host 套件放标准用户。若要求全部原生用例都在标准用户下执行（更强的普通用户证据，但组合未验证，首跑可能红），需 lead 裁决并调整 D3。

## Idempotence and Recovery

- 重复执行安全：runner 只读清单与测试、无持久状态；每次 hosted 运行用 GUID 命名创建新账户并在 `finally` 删除 profile/账户；runner VM 是一次性的，清理失败不跨运行残留。
- lane 重复：`gh run rerun <id>` 与 `gh workflow run` 可重复；但重跑不是修复，重复失败必须回到 D11 分诊，不得加 skip/`continue-on-error`。
- 本地恢复：worktree 未安装依赖时先 `pnpm install --frozen-lockfile`（`tests/README.md` 要求）；契约测试红先确认是真实失败而不是解析落点（`node scripts/resolution-check.mjs`）。
- 若 lane 合并后造成错误阻塞：revert 本 PR 即把 `fast-gate.needs` 恢复到 `[verify, browser]`；分支保护无需修改（必需检查名未变）。无产品代码/数据迁移需要回滚。
- 若 PR 分支被误推负控提交：本计划不使用 force-with-lease；把 PR head 恢复到 `git revert` 后的正式提交即可（负控只允许出现在 scratch 分支）。
- 回到已知良好状态：`git switch test/windows-native-lane && git reset --hard <最近一次通过 Batch 3 验证的本地提交>`（该提交必须先 push 或记入 Progress），随后重跑 `node --test tests/contract/{windows-native-checks,ci-windows-workflow,ci-browser-workflow}.test.js` 与 `node scripts/workflow-check.mjs`。

## Interfaces and Dependencies

- **runner CLI**：`node scripts/windows-native-checks.mjs --set <native-git|private-data> [--profile <dir> --foreign <dir>]`；`--profile`/`--foreign` 仅 `private-data` 使用；未知参数/未知 set/非 win32 一律非零退出并打印 `::error::`。`--profile` 时 runner 自行设置 `USERPROFILE`、`TEMP`/`TMP`、`HARNESS_WINDOWS_FOREIGN_PROFILE` 并 `chdir` 到检出根。
- **`SETS` 契约**：`{ files: [{ file, minTests }], allowedSkips }`；`file` 是相对检出根的 `tests/integration/*.test.js`；新增/删除文件或下界变化必须在同一 PR 修改此处并在 `Decision Log` 记录理由。
- **CI 契约**：job id `windows-native`、显示名「Windows Native（原生安全与平台契约）」；`runs-on: windows-2025`；`timeout-minutes: 15`；`defaults.run.shell: pwsh`；`fast-gate.needs` 含该 job；唯一必需检查名 `PR Fast Gate` 不变；聚合 job 不 checkout/不读 secrets/不执行候选代码。
- **工具链**：Node 来自 `.nvmrc`（当前 `26`），pnpm 来自 `package.json` 的 `packageManager`（`pnpm@10.28.2`）；action pin 沿用 `ci.yml` 现有 40 位提交（checkout `3d3c42e5…`、pnpm/action-setup `ea17c68d…`、setup-node `949feb24…`）。
- **权限与凭据**：继承顶层 `permissions: contents: read`；无 secrets、无写权限、无 self-hosted、无 `pull_request_target`；checkout `persist-credentials: false`。
- **#644 接口**：`process.env.USERPROFILE` 是 fresh 标准用户 profile；`HARNESS_WINDOWS_FOREIGN_PROFILE` 是预置 foreign fixture；#644 负责删除唯一 skip 并把 `allowedSkips` 归零、按需追加文件/下界。
- **#647 边界**：Server 2025 x64 CI 与 Win11 x64 Desktop 安装验收不可互相替代；本 lane 不宣称 Windows 产品支持已完成。
- **依赖**：无新增 npm 依赖；复用 `yaml`（契约测试已用）、`scripts/run-test-layer.mjs` 的 `parseSummary`、`scripts/resolution-check.mjs` 的 `assertLocalResolutions`。

## Outcomes & Retrospective

状态：草案（2026-11-17），尚无执行结果。执行完成后本节必须记录：最终 hosted run id 与精确 head、`ImageOS`/`ImageVersion`/架构、两组 counts 与 skip 行、负控 A/B 的 run id 与结论、lane 实际耗时、与计划的偏差（尤其 first-run 分诊结果）、#644 的待办接口、以及未纳入项（#646 评论用例）的 follow-up issue 编号。本节不得用「测试通过」代替真实 run 回读。

## Bottom Change Note

- 2026-11-17（lead 裁决落库）：关闭 OQ1–OQ3；确认本 PR 以 `Closes #646` 交付 lane 主闭环，未覆盖的 review-surfaced 原生卷反例写入 PR 正文与 Outcomes 作为后续项。
- 2026-11-17：创建草案。基于 main `ddb94c9440815626a3932dcaf050653f70eedb18` 重新核对事实（#643/#645/#190 已合并；原生套件与 Host 接线在 main；run `43871692717` = 68 pass/0 fail/1 skip；Git 套件 main 上 18 条从未整体原生运行），对三路设计做对抗评审（指出设计 1 的单身份阶段、设计 2 的 `5dd6456d` 事实错误与缺下界、设计 3 的 storage-restart/双 job 判断问题），选定「单 job + 两阶段身份 + `SETS` 脚本 + 精确 skip 预算 + 临时 ref 负控」，并给出 5 个批次、文件集、验收与回滚。本副本位于 `.superpowers/iteration11-delivery-20261117/specs/windows-native-lane-execplan.md`，Batch 1 落库到 `docs/exec-plan/active/2026-11-17-windows-native-lane.md`。
