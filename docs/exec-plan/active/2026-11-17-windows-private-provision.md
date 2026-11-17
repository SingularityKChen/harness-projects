# Windows 首次私有化 Provisioning ExecPlan

> 状态：Active（2026-11-17 实现完成，精确 head 原生证据已取得；PR base = `test/windows-native-lane`，等待 #646 合并后 retarget 与最终验收）
> 创建：2026-11-17
> 范围：#644：Windows 标准用户首次启动时，由同一 native helper 在创建调用内以目标安全描述符建立并接纳私有 plugin root、`workspace.sqlite`、`diagnostics.log`，按需建立 `worktrees`/digest；profile 与祖先只接纳不改写；无旧数据修复/迁移；不改 Host ABI。
> 上游输入：issue #644 正文与 2026-11-16 comment；`docs/exec-plan/completed/2026-11-16-windows-root-admission.md`；原生探针 run `44010858246`；`test/windows-native-qualification` 工作流原型；#646 lane 设计（`windows-native` job 与 `SETS` 清单契约）。

## Purpose / Big Picture

完成后，Windows 标准用户在一个由 launcher 普通 `mkdir` 建出的 `profileContext.dir` 上首次启动 DSH Desktop，不需要手工设 ACL、不需要提权、不需要预置任何文件：Host 在打开 SQLite、日志或发布任何可写端点之前，已经拥有一个 owner 为当前用户、DACL 受保护（`SE_DACL_PROTECTED`）、只含当前用户与受信 OS 主体的私有 plugin root，以及同一边界内的 `workspace.sqlite`、`diagnostics.log`；首次运行完成 schema 迁移，退出后重开保留数据、日志字节与既有 DACL；`worktrees`/digest 在真实使用到它们时以同一描述符创建，Git 后代只继承受信 allow。任何 permissive/foreign/linked/wrong-type/preexisting 对象都在发布端点前被有界拒绝，且拒绝不改写既有对象或祖先。

判断成功的最小证据：精确 head 的 hosted `windows-2025` 标准用户 lane 上，`private-data` 集合 fresh/reopen/拒绝/packed 用例 `fail 0`、`skipped 0`、`todo 0`，`harness-plugin-artifact.test.js` 的干净数据根用例在 Windows 真实执行；本机 POSIX 私有数据 59 项、`pnpm verify`、`boundaries`、size/disclosure 全绿。本项不代表 Win11 x64 Desktop 人类验收（#647）或发布接受（R1）。

## Context and Orientation

### 仓库与迭代现状（2026-11-17）

- `main = ddb94c9440815626a3932dcaf050653f70eedb18`，`origin/main` 与本地一致；#643 已合并（合并提交 `62e953cc`，#644 的最后前置），#645 `7e5e409e`、#190 `ddb94c94` 亦已合并。
- 迭代 11 剩余实现叶子为 #644/#646/#595/#596；本计划只覆盖 #644。Windows 交付顺序由协调层定为 #646 lane → #644（stacked）：分支 `feature/windows-private-provision`（工作树 `.worktrees/windows-private-provision`）的 PR base 是 `test/windows-native-lane`，不是 `main`。
- `main` 的 CI 只有 `verify`/`browser`/`fast-gate` 三个 job，`windows-2025` 已在 `scripts/workflow-check.mjs` 的托管 runner 白名单；分支保护唯一必需检查是 `PR Fast Gate`。本项不新增/修改 workflow。
- #643 的最终原生证据：run `43871692717`，job「Native Windows source private data」，`ImageOS=win25-vs2026`、`ImageVersion=20261103.298.1`、AMD64，`ℹ tests 69 / pass 68 / fail 0 / skipped 1`，`standard-user exit=0`；唯一 skip 是 `tests/integration/harness-plugin-artifact.test.js:281` 的 `{ skip: process.platform === 'win32' }`，由 #643 显式留给 #644。

### 术语

- **helper**：`apps/harness-plugin/src/host-private-windows.ts` 内嵌的 PowerShell 5.1 脚本 `PROGRAM`，以固定系统路径、`shell:false`、有界 stdin/stdout JSON 协议运行；#643 交付时只 admit（`OPEN_EXISTING`）。
- **lease**：helper 进程与整条 profile/root 目录 HANDLE 链组成的生命周期对象；由 `createHostComposition` 持有，释放顺序为 Storage→log→lease。
- **provision**：本计划新增的 create-or-admit 语义：缺失对象用目标 SD 在创建调用内建立；已存在对象只验证不改写。
- **adopt / refuse**：既有对象若恰好是 #643 接受的 canonical 私有形状则接纳（adopt）；否则拒绝（refuse），不改 DACL、不偷 owner。
- **受信主体**：#643 的固定例外集合——当前用户 SID、`S-1-5-18`（SYSTEM）、`S-1-5-32-544`（Administrators）、TrustedInstaller SID；威胁模型明确不隔离它们。
- **lane**：`ci.yml` 中由 #646 新增的 `windows-native` job，在 GitHub-hosted `windows-2025` 上先由 runner 管理员 checkout/install/build，再以临时标准本地用户执行 `scripts/windows-native-checks.mjs --set private-data`。

### main 上的相关实现（ddb94c94）

- `apps/harness-plugin/src/host-authority.ts:13-27`：Windows 保留原始 `profileContext.dir` 字符串（不做 realpath），交给 native 准入。
- `apps/harness-plugin/src/host-private-data.ts:90-95`：win32 分支只接受 `dataPath == rawProfile\harness-projects\workspace.sqlite`，调用 `prepareWindowsProjectData(rawProfile, signal)`；`PreparedPrivateData.lease` 是唯一传出的 native 句柄所有权。
- `apps/harness-plugin/src/host-composition.ts:191-193,262-263,272-276`：`preparePrivateProjectData` 在 Storage/log 之前；dispose 顺序 Storage→log→lease；lease signal 失效触发完整 root dispose。
- `apps/harness-plugin/src/host-providers.ts:348-351`：恢复 LocalGit binding 时把同一 lease 传给 `preparePrivateWorktreeDirectories`；`host-private-data.ts:42-60` 在 win32 上只做 `lease.assertDirectories([worktrees, digest])`，不自行创建。
- 结论：**#644 的产品代码只需改 `host-private-windows.ts`**；composition/lease/dispose 接线在 #643 已就绪，不在本项重写。上一轮运行态调研（`main=ba27b24c`）的「产品整合 0%、需要改 5 个 TS 文件」结论已被 main 推翻。

### #643 准入契约（provisioning 必须产出什么）

`host-private-windows.ts` 的 `Security`/`Open`（`:78-136`）与启动序列（`:137-152`）决定了形状：

- profile 链：逐段 `OPEN_EXISTING`；最后一段 profile 以 `private=true, inherit=false` 检查——owner 必须等于当前 SID、DACL 必须存在、**任何非受信 allow 都拒绝**，但不要求 `SE_DACL_PROTECTED`；中间祖先只要求 owner 在受信集且没有非受信危险写 allow。
- plugin root：`private=true, inherit=true`——除上述 owner/allow 约束外，**必须带 `SE_DACL_PROTECTED(0x1000)`，且有当前 SID 的 OBJECT_INHERIT full allow**（`Rights` 展开后须覆盖 `2032127`）。
- 固定文件：`workspace.sqlite`、`diagnostics.log` 必须已存在、普通非 reparse 文件、owner 当前 SID、私有 DACL、`nlink=1`；`-wal/-shm/-journal` 可缺席（`errno=2`），在场时同文件规则。
- 错误面：helper 只输出固定 token（`private-windows-v1` / `private-windows-added-v1`）或 `private-windows-error-<phase>-<code>[-<win32>]`；Host 侧统一 `HostAuthorityError('Host project data is unavailable')`，不含路径、原始输出。

### 原生事实与旧研究更新（run 44010858246）

2026-11-17 推送的 `test/windows-profile-acl-probe`（head `4a5424c9`）在 `windows-2025` 成功采集：

- 全新标准本地用户的 profile 根：`O:SY G:SY D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;S-1-5-21-…-1003)(A;;0x100020;;;S-1-15-3-65536-…)`，`AreAccessRulesProtected=True`；capability ACE 无 inherit 标记（`inheritance=None`），因此**不会**被 profile 下新建子目录继承。
- `C:\Users`：`O:SY G:SY D:PAI(…)`，含 `WD`/`BU` 读与 inherit-only ACE；新鲜 profile 本身是 protected 的，因此不继承 `C:\Users` 的宽松 ACE。
- 探针的标准用户 worker 因 `os.homedir()` 仍指向 runner 管理员 profile 而在 `EPERM mkdir 'C:\Users\runneradmin\…'` 失败，**没有**直接观测到「plain `mkdir` 子目录 SDDL」；该形状是依据上述 profile SDDL 与 Windows 继承语义的推断，本计划 Batch 0 用原生用例把它变成事实。
- 上一轮 `research-provision.md` 结论（#644 必须等 #643 合并、产品整合为零、需要 500–750 行）在本轮基线部分过期：main 已含 #643 产品接线与 68/0/1 原生证据；本计划按 main 现状重估。

### issue #644 的接口要求与处置

issue 2026-11-16 comment 提出两条由 #643 评审暴露的接口事实：

1. plugin root 与 worktrees/digest 必须**自身**带 protected DACL（普通 `mkdir` 子目录会被 `inheritance` 拒绝）。→ 本计划：每个固定目录都用 `CreateDirectoryW` + `SECURITY_ATTRIBUTES` 在创建调用内显式设 protected DACL，不放宽准入。
2. `profileContext.dir` 的私有化归属未明；真实 launcher 路径无 Windows DACL 加固，若含非受信继承 ACE 会 fail closed。→ 本计划：profile 归 launcher（插件只接纳、不创建、不改 ACL）；以探针事实 + Batch 0 原生用例记录普通 `mkdir` profile 链的接纳性；受管设备/企业 profile 变体由 #647 人验兜底，必要时另开受控项放宽，不在本项静默实现。

### #646 lane 契约（本项必须消费/修改的接口）

`test/windows-native-lane` 上即将落地的 `scripts/windows-native-checks.mjs` 定义 `SETS`（`{files:[{file,minTests}], allowedSkips}`）；按 #646 计划值（base branch 落地后以实际内容为准），`private-data` 为 `harness-plugin-windows-private-data.test.js`（minTests 39）、`harness-plugin-windows-artifact.test.js`（1）、`harness-plugin-artifact.test.js`（29），`allowedSkips=1`，唯一 skip 归 #644。本项交付时必须在同一 PR 内：

- 删除 `harness-plugin-artifact.test.js:281` 的 win32 skip；
- 把 `SETS['private-data'].allowedSkips` 改为 `0`；
- 若 `tests/contract/windows-native-checks.test.js` 或 `docs/development/ci.md` 固定在「唯一 skip 归 #644」这一事实上，同步那几行（预计 ≤3 行）；
- 不新增文件到 `SETS`（本项新用例放回既有 `harness-plugin-windows-private-data.test.js`，其 minTests 39 是下限，新增用例只增不减）；不删除/合并既有用例到低于下限。

## Design / Spec

### 1. 选定方案：同一 helper 的幂等 create-or-admit

在 #643 的 `PROGRAM` 内扩展，不新增第二个 helper、文件、模式、帧或依赖：

1. 启动时先按现有逻辑**接纳 profile 链**（只读，不创建、不改 ACL）；profile 缺失即拒绝——它是 launcher 拥有的目录。
2. 对 `harness-projects` root：先 `CreateDirectoryW(root, SA)`（SD 为私有 D:P + 当前 SID OI/CI full + SY/BA full）；`ERROR_ALREADY_EXISTS(183)` 视为已存在；随后用现有 `Open` 按 `private=true, inherit=true` 接纳。非 183 的创建错误 → 有界 `create-*` 拒绝。
3. 对 `workspace.sqlite`、`diagnostics.log`：`CreateFileW(..., CREATE_NEW, SA)`；`ERROR_FILE_EXISTS(80)`/`183` 视为已存在；随后的 `Open` 按 `private=true, inherit=false`（文件）接纳；非 80/183 的创建错误 → 有界拒绝。空文件交给后续 SQLite 初始化/Node append，不写任何敏感字节。
4. sidecar 仍按现状 optional 接纳（不预创建）。
5. `directories` 帧（`assertDirectories`）对 `worktrees` 与 digest 逐层做同样的 `CreateDirectoryW` + 接纳；父层先建、子层后建，全部并入同一 lease。
6. 任何拒绝都发生在发布 ready token 之前，因此 Host 端点/Storage/日志均未建立。

这样 fresh 与 reopen 是同一条幂等路径，与 POSIX `mkdirSync(EEXIST 容忍)+验证` 的语义对齐，但触发创建的时机在 native helper 内部，暴露窗口为零（对象从第一次可见起就带目标 DACL）。

### 2. 三路设计评估（采用/修正/放弃）

| 设计 | 采用 | 过度或不足 | 事实问题与修正 |
|---|---|---|---|
| 设计 1（系统/状态所有权） | 单进程单次幂等 ensure；沿用 #643 lease/协议；worktrees/digest 同 SD 惰性创建；`missing-*` 从拒绝矩阵移入创建正例；不加新帧/模式 | 不足：把「profile 降为 controlled-ancestor」当作必需前提，未先验证普通 `mkdir` 链是否已被接纳；未给出 lane `allowedSkips` 交接 | **修正**：profile 检查在 `inherit=false` 时不要求 protected，普通 `mkdir` 链（owner=self、AI、SY/BA/self-only）本就被 #643 接纳；详见 Surprises。 |
| 设计 2（安全/失败路径） | 创建调用内带 SD（杜绝先宽后 chmod）；显式 owner=self；`ERROR_ALREADY_EXISTS` 转验证；拒绝无端点/无路径；独立 `Get-Acl` 观测 | 过度：对既有 permissive 对象做 `SetSecurityInfo` 窄修复（+80 实现/+100 测试、TOCTOU、WRITE_DAC；与「不做旧数据修复」硬约束冲突）；sidecar 修复不需要；额外标准用户读拒绝负控需要新账户步骤，超出本项与 lane 范围 | **事实错误**：(a)「launcher 普通 `mkdir` 的 profile 是 AI、含继承只读 ACE，必被 dacl/grant 拒绝」——profile 不要求 protected，且新鲜 profile 的可继承 ACE 只有 SY/BA/self；(b) 引用「探针已给出 plain mkdir 子目录 SDDL」——探针 worker 因 homedir 错误 EPERM 失败，未观测到。 |
| 设计 3（产品/交付） | PR base=lane 的 stacked 交付；refuse-only（adopt canonical，否则拒绝）；解锁 artifact win32 skip；批次与证据结构 | 不足：未覆盖 lane 的 `allowedSkips` 契约、未给「不修复」的判别性佐证（SDDL 前后相等）、未定义并发/部分失败的具体用例 | **事实错误**：同上的 profile 前提；「packed Host 需新用例」不成立——`harness-plugin-artifact.test.js` 干净数据根用例本身就是打包产物首次创建，解锁即可。 |

共同结论：三路都在未验证的情况下把「profile 必须私有化/放宽」写成前置；本计划把它降级为 Batch 0 的原生事实门，并由事实决定（当前证据不支持改 #643 契约）。

### 3. 创建原语与安全边界

`PROGRAM` 只增下列系统能力（不新增二进制/依赖/编译）：

- P/Invoke：`CreateDirectoryW(kernel32)`、`ConvertStringSecurityDescriptorToSecurityDescriptorW(advapi32, self-relative, LocalFree)`；复用已绑定的 `CreateFileW`（第 4 参即 `LPSECURITY_ATTRIBUTES`）、`LocalFree`、`CloseHandle`。
- 两个 managed IL wrapper，与现有 `OpenChecked` 同一模式，在 IL 内紧跟 P/Invoke 用 `Marshal.GetLastWin32Error` 原子缓存错误，避免 PowerShell 反射/绑定介入；`CreateFileW` 固定 `desiredAccess=0, shareMode=3, CREATE_NEW=1, FILE_ATTRIBUTE_NORMAL=0x80`；`CreateDirectoryW` 只传路径与 SA。
- 安全描述符：SDDL 构造后经 `ConvertStringSecurityDescriptorToSecurityDescriptorW(SDDL_REVISION_1)` 得到 self-relative SD；目录 `O:<sid>D:P(A;OICI;FA;;;<sid>)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`，文件去掉 OICI。`SECURITY_ATTRIBUTES{nLength=24,lpSecurityDescriptor=<sd>,bInheritHandle=FALSE}`；helper 先校验 `[IntPtr]::Size -eq 8`（x64 目标），否则 `platform` 拒绝。
- 显式 `O:<sid>`：标准用户默认 owner 本就是自己；显式声明使提权/异常 token 下也不会静默创建出 owner=Administrators 的对象（无 `SeRestorePrivilege` 时 owner 必须是调用者 token 内的 SID；管理员 token 仍含用户 SID，因此合法）。创建失败即拒绝，不留半成品。
- 形状与 #643 fixture 的 canonical 形状一致（self/SY/BA），因为准入把 SY/BA 当作显式受信 OS 例外；不引入第二种「self-only」形状，避免 provisioning 与 admission 两份契约漂移。
- 创建后仍走既有 `Open` 复核（owner/DACL/受保护/无 reparse/nlink/NTFS/卷根身份）；复核使用刚打开的 HANDLE，不按路径 `Get-Acl`、不解析本地化文本。create→adopt 之间的窗口只对同 SID 与受信 OS 主体可见，属 #643 已声明的威胁边界。

### 4. profile 归属（launcher-owned，admit-only）

- 插件不创建 profile、不修改 profile 或任何祖先的 ACL；profile 缺失、owner 非当前用户、存在非受信 allow、reparse、非 NTFS/固定盘 → 拒绝并返回固定文案。
- 依据：探针显示新鲜标准用户 profile 是 `O:SY D:P` 且可继承 ACE 只有 SY/BA/self、capability ACE 非继承；普通 `mkdir` 的 `desktop` 目录因此是 owner=self、AI、仅受信 allow，正好是 #643 的 profile 检查接受形状。Batch 0 把这一推断变成原生事实。
- 若 Batch 0 出现 profile/ancestor 相位拒绝：**停止**本计划，保留实际 SDDL 与错误 token 交 lead 裁决（是否改为 controlled-ancestor 或由 launcher/安装器加固）；不得在本 PR 静默放宽。
- 受管设备、企业 profile 策略、launcher 提权创建等变体不在本项验证范围，由 #647 人验；出现失败时另开受控项。

### 5. 既有对象策略（显式 narrow refuse-or-adopt，不修复）

| 既有对象状态 | 动作 |
|---|---|
| 不存在 | 以目标 SD 创建（root/文件/worktrees/digest） |
| 恰好是 #643 canonical 私有形状 | adopt：只验证，不改写；内容/字节/DACL 前后相等 |
| permissive（含 WD/broad allow）、foreign owner、reparse/junction、hardlink、wrong type、NULL/callback ACE、非受信写祖先 | refuse：不改 DACL、不改 owner、不动祖先；不创建后续对象；不发布端点 |
| 部分创建（root 已建、db/log 缺失，或反之） | 补建缺失对象；已存在对象按上面两行处理；既有数据保留 |
| 并发两个初始化 | `CreateDirectoryW/CreateFileW` 的 `EXISTS` 语义收敛；双方只 adopt，不覆盖、不截断 |

不实现 DACL 修复的 Rationale：当前无正式发布，仓库硬约束是「不做旧数据/旧设计兼容、迁移或修复」；修复需要 `SetSecurityInfo`/WRITE_DAC、身份复核与额外 TOCTOU 面，且会删除/改写明确拒绝的负控。AC 允许「explicit narrow repair-or-refuse policy」，本项选择 refuse 分支并保持可逆。

### 6. worktrees / digest 与 #338、#645 边界

- 只在 `restoreProviders` 恢复 LocalGit binding 时经既有 `directories` 帧按需创建 `root/worktrees` 与 `root/worktrees/<digest>`，两者各自带 protected DACL；不提前创建空容器。
- 帧与请求形状不变（恰好两层、第一层等于 `root/worktrees`、第二层是其直接子目录、路径仍由 `localGitRoot` 计算）；路径身份/规范根归 #645/#338，本项只负责 DACL 与创建/接纳。
- 新建 Git 后代不逐个设 ACL：它们继承 digest 的 protected DACL 中 SY/BA/self 的 OI/CI allow，得到 owner=当前用户、AI、仅受信 allow；原生用例显式断言这一继承。

### 7. 不变量

- **I1 创建即最终**：root/db/log/worktrees/digest 在第一次可见时即带目标 SD；不绑定/不调用 `SetSecurityInfo`/`SetNamedSecurityInfo`，不存在「默认宽继承 + 后 chmod」窗口。
- **I2 边界先于内容**：profile 链接纳必须先于任何创建；root 创建必须先于 db/log；全部接纳先于 ready token 与 Host Storage/日志/端点。
- **I3 既有对象不重写**：拒绝路径对既有对象与祖先零写入；adopt 路径不改 DACL/owner/内容。
- **I4 单 owner**：仍是一个 helper、一套路径语义（`Lexical`/`Open`/卷根）、一套 SD 契约；不出现第二 path owner。
- **I5 回收不变**：目录 HANDLE 仍归 lease，创建不改变 Storage→log→lease 顺序、失败 dispose、helper 死亡撤权语义。
- **I6 平台不变**：POSIX 路径零改动；Windows 仍是固定系统 PowerShell、无编译、无新依赖/二进制；`PROGRAM` 保持 <24000 字符且模板内不出现 `${`（避免 JS 插值）。
- **I7 证据不自证**：SD 形状、owner、protected、继承性由独立 `Get-Acl` 断言；不以「Host 不抛」、mock win32、build 成功代替原生资格。

### 8. 接口与错误面

- 协议请求/响应 token、schema、15s 预算、stdout/stderr 有界规则不变：首帧 `{profile}` → `private-windows-v1`；目录帧 `{directories:[worktrees,digest]}` → `private-windows-added-v1`。不新增 mode 字段或第二帧。
- 错误 token 只扩展取值域：`private-windows-error-<phase>-create-<reason>[-<win32>]`，`<reason> ∈ {notfound,path,access,sharing,other}`，`<win32>` 仅 0–65535；`phase` 复用 `plugin|database|log|worktrees`，新增 `platform`。Host 侧仍统一固定文案，不解析 token 细节。
- TS 工厂 `prepareWindowsProjectData(profile, signal)` 的签名/返回值不变；`host-private-data.ts` 的 win32 分支不变；不新增 Host ABI、公共包出口或凭据路径。
- 清单位于 #646 的 `scripts/windows-native-checks.mjs`；本项只把 `allowedSkips` 归零并按需同步固定行，不改清单结构。

### 9. 被放弃方案

1. **新增 provision 模式/帧/第二趟 admit**：fresh 与 reopen 策略相同，多一趟产生 lease 空窗与协议/测试翻倍，收益为零。
2. **第二个 helper 或 launcher 预建后交接**：复制 binder/协议/SD/错误映射，形成第二 path owner（违反 issue 与 `AGENTS.md` §5），预算超 800。
3. **launcher 负责递归加固 profile**：profile 归仓库外 launcher；#644 Notes 禁止递归改 profile；无证据表明需要。
4. **现在就放宽 profile 为 controlled-ancestor**：证据不支持（见 Surprises），且会削弱已合并的 #643 契约、删除现有 `broad-profile` 拒绝负控；留作 Batch 0 失败时的 lead 裁决分支。
5. **`icacls`/`Set-Acl` 后置改权限**：本地化输出、argv 注入面、且就是 AC 明确拒绝的「先宽后改」窗口。
6. **对既有 permissive 对象做 `SetSecurityInfo` 窄修复**：违反「不做旧数据修复/迁移」硬约束，增加 TOCTOU 与 WRITE_DAC 面；本项选择 refuse。
7. **启动时预建 worktrees/digest**：无使用者的空目录与跨项副作用；按需创建即可满足 AC。
8. **新增 workflow/job/规则**：lane 归 #646；本项不新增门禁面。
9. **为第二标准用户/服务账户加原生读拒绝负控**：需要 lane 新增账户步骤，超出本项与 lane 范围；现有 foreign owner/broad ACE 拒绝已覆盖跨主体威胁。

### 10. 规模估算与简化点

| 范围 | 估算（增删合计） |
|---|---|
| `apps/harness-plugin/src/host-private-windows.ts` | 65–85 |
| `tests/integration/harness-plugin-windows-fixture.js` | 30–45 |
| `tests/integration/harness-plugin-windows-private-data.test.js` | 170–230 |
| `tests/integration/harness-plugin-artifact.test.js` | 2 |
| lane 交接（`scripts/windows-native-checks.mjs`、`docs/development/ci.md`、可能的固定契约行） | 3–8 |
| 代码合计 | **270–370** |
| 文档（新 ExecPlan + `docs/README.md`） | 300–380（本草案实测 365 行） |
| 文档合计 | **300–380** |

满足任务约束 ≤800 代码 / ≤1300 文档，也低于仓库 1000/1500 硬帽。简化点：复用 #643 的 `Lexical`/`Open`/`Security`/lease/协议与 fixture 的 `seed`/`ps`/`setAcl`/`sqliteProbe`/`positiveHost`；`missing-root|-db|-log` 三条否定子用例改由更强的 fresh + partial-state 正例承担；不加修复矩阵、不加新帧/文件/依赖；错误码只扩取值域；worktrees 只做两层固定目录。

## Global Constraints

- **唯一允许的跟踪文件改动集合（本计划声明一次）**：
  - `apps/harness-plugin/src/host-private-windows.ts`（唯一产品文件）
  - `tests/integration/harness-plugin-windows-fixture.js`
  - `tests/integration/harness-plugin-windows-private-data.test.js`
  - `tests/integration/harness-plugin-artifact.test.js`（仅删 win32 skip 与同步注释）
  - `scripts/windows-native-checks.mjs`（仅 `SETS['private-data'].allowedSkips: 1 → 0`；该文件由 #646 在 base branch 引入）
  - `docs/development/ci.md` 与 `tests/contract/windows-native-checks.test.js` 中与「唯一 skip 归 #644」相关的固定行（预计 ≤3 行；以 base branch 实际内容为准）
  - `docs/exec-plan/active/2026-11-17-windows-private-provision.md`、`docs/README.md`
  - 不改 `host-private-data.ts`、`host-authority.ts`、`host-composition.ts`、`host-providers.ts`、`host.ts`；不改 `.github/workflows/**`、`scripts/workflow-check.mjs`、`package.json`/lockfile；不新增文件（除本 ExecPlan）。
- 代码增删合计 ≤800、文档 ≤1300（任务约束；仓库 1000/1500 硬帽同样满足）。超出时先删重复负控/简化实现，不压缩安全逻辑。
- 不做旧数据/旧设计兼容、迁移或修复；保持真实 Host ABI、身份、权限、事务、ack/reconcile、恢复不变量。
- TDD：每个新增行为先写判别性失败用例并在 lane 上记录 RED，再实现；不为覆盖率铺测试；删除/改写负控必须有替代的更强判别用例并记录 Rationale。
- 安全负控只增不减：保留 foreign owner、broad/`direct-only`/`null`/`callback`/`inherit-only`、junction、hardlink、wrong-type、非受信祖先；新增 permissive preexisting root、missing profile 的拒绝。
- 创建安全：只在创建调用内用 `SECURITY_ATTRIBUTES` 设 SD；不得先建后改；不得偷 owner；不得改无关祖先；拒绝时零写入既有对象。
- 平台：Windows x64、系统 PowerShell 5.1、NTFS 固定盘；不新增 native 二进制/依赖/编译步骤；`PROGRAM` <24000 字符且模板内无 `${`。
- POSIX 敏感路径零改动，`pnpm test:file tests/integration/harness-plugin-private-data.test.js` 必须保持 59 pass。
- lane 纪律：不得通过增加 skip、删用例、降 `minTests`、`continue-on-error` 变绿（#646 D11）；本项必须把 `allowedSkips` 归零。
- 文档中文、标识符/路径/命令英文；不写本机绝对路径；公开面（commit/PR/issue）英文正文。

## Plan of Work

### Batch 0 · 原生事实门：launcher 形状 profile 的可接纳性

**最小闭环**：用**现有产品代码**（只 admit）证明普通 `mkdir` 建出的 `profileContext.dir` 链被 #643 契约接纳；纯测试改动，零产品改动。这是 D1 的决策门：通过才实施 provisioning；失败则停止并交 lead。

**涉及文件**：`tests/integration/harness-plugin-windows-fixture.js`、`tests/integration/harness-plugin-windows-private-data.test.js`（本批新增内容）。

步骤：

1. 先把工作树 `feature/windows-private-provision` 的 base 重置到 `test/windows-native-lane` 的已验证 head（不修改 lane 分支本身，保持 `.worktrees/` 隔离）。
2. 给 `windowsFixture(t, { launcherProfile = false, provisioned = true })` 加两个选项：`launcherProfile=true` 时 `ancestor`/`profile` 只用普通 `mkdir`（不调用 `setAcl`）；`provisioned=false` 时不创建/预置 root 与固定文件。默认路径保持现行为，现有用例零改动。
3. 新增原生用例「launcher-shaped plain-mkdir profile chain is admitted by the secured-root contract」：用 `launcherProfile=true`（root/db/log 仍由测试预置为 canonical）调用 `prepareWindowsProjectData`，期望成功；用独立 `Get-Acl` 记录 profile 的 owner/SDDL/`AreAccessRulesProtected` 作为诊断（不写死具体 ACE 文本）。
4. push 到 `feature/windows-private-provision`（base 为 `test/windows-native-lane`）并建 draft PR：正文先用 `Refs #644` 关联，Ready 前确认最终合并使用 `Closes #644`；等 lane 的 `windows-native` job 执行该文件。

**验证**：复用 V2（原生 lane）与 V1（本机 POSIX 回归不受影响）。期望：lane 日志中该用例 pass，`windows-native-checks: set=private-data` 的 `skipped` 仍为 1（Batch 2 才归零）、该用例 `fail 0`。若该用例以 `profile`/`ancestor` 相位错误拒绝：**停止**，把实际 SDDL 与错误 token 交 lead，不进入 Batch 1。

**回滚**：revert 本批测试/fixture 提交；无产品改动。

### Batch 1 · fresh 创建核心 + Host 首次启动

**最小闭环**：无 root/db/log 的 launcher profile 上，helper 原子创建三类对象并以创建时的 SD 被接纳；实际 Host 首次 apply 完成迁移、dispose 后重开保留日志与既有 DACL。

**涉及文件**：`apps/harness-plugin/src/host-private-windows.ts`、`tests/integration/harness-plugin-windows-private-data.test.js`、`tests/integration/harness-plugin-windows-fixture.js`。

步骤（TDD：先 RED，后实现）：

1. 新增 RED 用例（lane 上当前应为 denied，因为 root/db/log 缺失）：
   - fresh 创建：`windowsFixture(t,{launcherProfile:true,provisioned:false})` → `prepareWindowsProjectData` 成功；`root`/`db`/`log` 存在；独立 `Get-Acl` 断言 owner=token SID、`AreAccessRulesProtected=true`、所有 ACE `IsInherited=false`、allow 主体 ⊆ {self,SY,BA}，root 含 self 的 OI/CI full，文件含 self full；db/log 字节数为 0（边界先于敏感内容）。
   - adopt 不改写：关闭 lease 后记录三个对象的 SDDL 与 log 字节；再次 prepare 成功；SDDL/字节逐字相等；dispose 后 reopen 仍成功。
   - fresh Host：同一 fresh fixture 走真实 `apply`：`(await service.getWorkspaceSetup()).workspace === null`、`(await service.baseline()).workspace === undefined`（空库），`workspace.sqlite` 的 `schema_migrations` 为 `[1,2,3,4,5,6,7]`，对象 ACL 同上；dispose 后追加日志 sentinel 再 apply，`log` 以 sentinel 开头、库可重开。
   - partial resume：分别在「root canonical 但 db 缺失」「root canonical 但 log 缺失」场景 prepare 成功，且存活的 db/log 字节不变（数据保留）。
2. 实现 helper：按 Design §3 增 Bind、IL wrapper、SD/SA、`Ensure`；启动序列改为 profile 接纳 → `Ensure(root,dir,'plugin')` → `Ensure(db,file,'database')` → `Ensure(log,file,'log')` → sidecar optional 接纳。catch 白名单增 `create-*`、`platform`，并对 `create-*` 追加 0–65535 的 win32 码；finally 释放 SD/SA。
3. 拒绝矩阵调整：从 `corrupt()`/大拒绝 loop 移除 `missing-root|-db|-log`（由本批 fresh/partial 正例承担）；`missing-profile`、`plain-root` 两个拒绝子用例在 Batch 2 与 zero-write 断言一起加；保留其余全部负控与「错误文案不含路径、sentinel 不变」。

**验证**：复用 V2；本机复用 V1。期望：lane 上本批新增用例 pass、既有负控仍 pass、`fail 0`；本机 POSIX 59 pass 不变，Windows 文件的 synthetic 用例仍 10 pass。

**回滚**：revert 本批提交 → Windows 回到 #643 的 admit-only fail-closed；本批已创建的 canonical 树可被 #643 代码继续接纳，无需迁移。

### Batch 2 · 策略矩阵、并发、worktrees 与 packed 解锁

**最小闭环**：部分失败/并发/sidecar 残留/不修复策略/worktrees 创建与继承全部有原生判别证据；打包 Host 的干净数据根用例在 Windows 真实通过；lane 的 skip 预算归零。

**涉及文件**：`apps/harness-plugin/src/host-private-windows.ts`、`tests/integration/harness-plugin-windows-private-data.test.js`、`tests/integration/harness-plugin-windows-fixture.js`、`tests/integration/harness-plugin-artifact.test.js`、`scripts/windows-native-checks.mjs`、`docs/development/ci.md`（与 lane skip 归属相关的固定行）。

步骤：

1. RED 用例：
   - worktrees/digest：在 fresh 创建的 root 上调 `preparePrivateWorktreeDirectories`，期望成功并各自带 protected、仅受信 allow 的 DACL；在 digest 下普通 `mkdir` 子目录与写文件，断言 owner=self、allow 仅受信、AI 继承（证明 Git 后代继承）；第一个 lease 持有期间 rename 两层目录被拒（沿用 #643 已验证的 no-SHARE_DELETE 反例口径）；dispose 后新 lease 再调用为 adopt（形状/字节不变）。另加负控：预先普通 `mkdir` 的 `worktrees`（非 canonical）被拒绝且 SDDL 不被修复。
   - 并发：同一 fresh profile 上 `Promise.all` 两个 `prepareWindowsProjectData` 均成功，随后两个 lease 均正常 dispose；最终 root/db/log 各一份、canonical。
   - sidecar 残留：fresh 创建后写入 `workspace.sqlite-journal` 残留（普通写入、继承 root DACL），关闭后重开 prepare 成功且残留字节不变；既有 `broad-*` sidecar 拒绝保留。
   - 不修复：`plain-root` 场景（先删除既有 root，再以普通 `mkdir` 重建）prepare/`hostFixture(apply)` 均拒绝；记录 root 的 SDDL 前后相等（仍 AI、非 protected）、db/log 不存在、`services`/`live` 为空、错误文案无路径。该用例今天即 GREEN，作用是防止后续实现引入「修复」路径。
2. 实现：`directories` 帧改为对两层 `Ensure`（目录、protected DACL、同一 SD）；不改帧形状与路径计算。
3. 同一次 push 内完成 lane 交接：删除 `harness-plugin-artifact.test.js:281` 的 `skip`；`scripts/windows-native-checks.mjs` 的 `allowedSkips` 改 `0`；同步 `docs/development/ci.md`/契约测试中「唯一 skip 归 #644」的固定行。避免中间提交出现 skip 预算红。
4. 复跑全部 lane 文件与 artifact 构建。

**验证**：复用 V2、V3、V4。期望：lane `set=private-data` 的 `skipped=0`、`todo=0`、`fail 0`，无 `::error::windows-native-checks:`；`harness-plugin-artifact.test.js` 的干净数据根用例在 Windows 输出中执行并通过；本机 POSIX/artifact 回归绿。

**回滚**：revert 本批测试与 skip/预算改动；若只回退 worktrees `Ensure`，缺失层恢复拒绝，已创建的 canonical 层仍可 adopt。整 PR 回滚见 Idempotence。

### Batch 3 · 证据收口与文档

**最小闭环**：ExecPlan 落库到分支、`docs/README.md` 索引更新、最终 head 的原生证据回读、规模/发布面检查、PR Ready 前的回读。

**涉及文件**：`docs/exec-plan/active/2026-11-17-windows-private-provision.md`、`docs/README.md`、PR 正文。

步骤：

1. 把本计划落到分支 `docs/exec-plan/active/`（文件名不变），补 `docs/README.md` Active 索引一行。
2. 在最终 head 上触发/回读 lane（push 或 `gh workflow run ci.yml --ref <branch>`），把 run id、head、`ImageVersion`、工具链、两组 counts、`skipped=0`、`standard-user exit=0` 写入 Progress/Outcomes；若 lane 首次红，按 #646 D11 分诊（真实产品回归不得靠删/跳变绿）。
3. 回读 PR head/base/checks/issue 关联/threads；docs 与规模检查；最终整理 commit（无 debug/fixup）与发布面扫描；Ready 前把 `Refs #644` 改为 `Closes #644`。

**验证**：复用 V2/V4/V5。

**回滚**：revert 文档提交即可；产品/测试保持冻结。

## Validation and Acceptance

### 命令（唯一展开处；执行上下文：检出 `feature/windows-private-provision` 的工作树根 `.worktrees/windows-private-provision`；原生证据在高一层 base 的 lane 定义上产生）

- **V1 本机 POSIX 回归**：`pnpm test:file tests/integration/harness-plugin-private-data.test.js`。期望 `ℹ tests 59 / pass 59 / fail 0`。前置：该检出已执行 `pnpm install --frozen-lockfile`（`tests/README.md` 要求）。
- **V2 原生 lane**：push 后在 GitHub 回读 `gh run view <run-id> -R SingularityKChen/harness-projects --log | grep -E 'ImageVersion|node --version|git --version|windows-native-checks:|ℹ (tests|pass|fail|skipped)|standard-user exit='`。期望：`ImageOS=win25-*`、`ImageVersion=*`、AMD64；node/git 版本行；`standard-user exit=0`；`windows-native-checks: set=private-data files=3 tests=<比 base 69 更多，预计 72–80> skipped=0 todo=0`（若新增/合并用例导致计数变化，以 base branch 的 `SETS.minTests` 下限与最终静态计数为准）；3 个测试进程均 `fail 0`；无 `::error::windows-native-checks:`。同时 `gh pr checks <pr> -R SingularityKChen/harness-projects` 期望 `PR Fast Gate` 与 `Windows Native（原生安全与平台契约）` pass。
- **V3 打包 Host**：`pnpm --filter @harness-projects/app-harness-plugin build && pnpm test:file tests/integration/harness-plugin-artifact.test.js`。本机（darwin）期望原有用例全绿；lane 上期望干净数据根用例真实执行（`skipped=0`）。
- **V4 完整本地门禁**：`pnpm verify`、`pnpm run boundaries`、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs size <base>`（`<base>` = PR 声明的 base `test/windows-native-lane`；期望代码 <800、文档 <1300）、`node scripts/rule-checks.mjs disclosure <base>`（exit 0）、`git diff --check <base>...HEAD`（无输出）。工作树须干净或仅有预期改动。
- **V5 计划落库回读**：`git show <head>:docs/exec-plan/active/2026-11-17-windows-private-provision.md | head -5`、`grep -n 'windows-private-provision' docs/README.md`；PR `gh pr view <pr> -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,checks` 回读最终 head/base/关联。

### AC 映射

| #644 AC | 判定证据 |
|---|---|
| 标准用户 fresh profile 免手工 ACL/提权启动；创建时即私有，无「先宽后 chmod」窗口 | Batch 0 原生 profile 事实；Batch 1 fresh 用例的 owner/protected/no-inherited/仅受信断言；Batch 3 干净数据根 packed 用例；PROGRAM 不含 `SetSecurityInfo`/`SetNamedSecurityInfo` |
| 既有私有数据/日志重开不变；permissive/foreign/linked/preexisting 有明确窄策略；不偷 owner、不改祖先；部分失败保留数据；并发初始化 | Batch 1 adopt-partial 用例 + Batch 2 并发/残留/不修复用例；保留的 foreign/broad/junction/hardlink/null/callback/direct-only/ancestor 负控 |
| SQLite 主/WAL/SHM/journal、diagnostics、worktree container/digest 同一边界；不复制第二 path owner；后代继承 | 创建 SD + 继承断言；`sqliteProbe` 的 sidecar 安全继承；worktrees/digest 创建 + 子项继承断言；路径语义仍归 `Lexical`/`Open` 与 #645/#338 |
| DB 重开、锁共享、有界启动失败、unload/reload、helper 处置；拒绝不发布端点且不泄漏路径 | fresh Host apply/dispose/reapply；既有 `positiveHost` 重开/lease/helper death；拒绝矩阵的 `services`/`live` 为空与固定文案断言 |
| 真实 Windows temporary-profile fresh/reopen/denial/unsafe replacement + packed；POSIX/ABI 回归；无新 native 二进制/依赖 | V1–V3 + lane 标准用户证据；`harness-plugin-private-data.test.js` 与 Host ABI 套件回归；零依赖/零 workflow 变更 |

### 资格口径

- 资格 = 真实 `windows-2025` x64、独立临时标准本地用户（`admin:false`/`adminMember:false`）上，真实 Host startup/重开/SQLite/打包产物的 fresh/reopen/refusal 正负证据 + 独立 `Get-Acl` 观测；synthetic 协议、mock win32、仅 build 成功、仅「Host 不抛」都不算资格。
- `windows-2025`（Server 2025 x64）不等于 Win11 x64 Desktop；本项不替代 #647 人验、不替代 R1、不宣称 Windows 已获产品支持。
- 若 lane 尚未落地，本计划保持 Draft，不以协调者临时 qualification 分支的 SHA-pin 证据替代门禁证据（可作过程佐证，但必须在 PR/计划中标注不可复现）。

## Progress

- [x] (2026-11-17) 前置：`test/windows-native-lane` 提供 `windows-native` job 与 `private-data` set（#646）。lane 落地于 `8ce447594981`（`test(ci): 接入 Windows 原生 lane 并聚合进 PR Fast Gate`）；本分支先完成本地可做批次，再 rebase 到该 head 取得原生证据。
- [x] (2026-11-17) Batch 0：fixture 增 `launcherProfile`/`provisioned` 选项（默认行为不变）与 launcher-shaped plain-mkdir profile 原生用例；lane 上 GREEN，**profile/ancestor 相位未拒绝**——普通 `mkdir` 链是 `O:<user>G:<domain>D:(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;<user>)`、`AreAccessRulesProtected=false`、三条 ACE 全部 `inherited=true`，与 D1 的推断一致，未改 #643 契约。
- [x] (2026-11-17) Batch 1：fresh 创建/adopt 不改写/fresh Host 首启（迁移 1–7、零工作区、重开）/partial resume 四个原生用例；helper 改为同一 `PROGRAM` 内的幂等 create-or-admit（`CreateDirectoryW`、`ConvertStringSecurityDescriptorToSecurityDescriptorW`、两个 IL wrapper、SDDL+`SECURITY_ATTRIBUTES`），lane 上全部 pass，既有负控与 POSIX 59 pass 不回归。
- [x] (2026-11-17) Batch 2：worktrees/digest 创建+后代继承+rename 拒绝+dispose 后 adopt、并发首启、sidecar 残留接纳、plain worktrees/plain root/missing profile 的 refuse 零写入；artifact win32 skip 删除、`SETS['private-data'].allowedSkips` 归零，lane `set=private-data files=3 tests=78 skipped=0 todo=0`。
- [x] (2026-11-17) Batch 3：计划落库与索引（`32b033bd`、`81ebfd99`）、产品/测试面 head 与文档面 head 各取一次原生证据、size/disclosure/verify、PR 正文更新与 checks 回读（是否 Ready 由 lead 决定）。
- [x] (2026-11-17) 原生证据（产品/测试面 head `1a681c35`）：`CI` run `44016639839`（base `test/windows-native-lane@8ce447594981`），job「Windows Native（原生安全与平台契约）」`4m11s`（job `133816042841`）、`ImageOS=win25-vs2026`、`ImageVersion=20261103.298.1`、`AMD64`、node `v26.13.1`、git `2.56.0.windows.4`、`native-git files=2 tests=18 skipped=0`、`private-data files=3 tests=78 skipped=0 todo=0`、`standard-user exit=0`；`PR Fast Gate`/`Verify`/`Browser` 同时 pass。PowerShell 语法/绑定修正轮次为 **0**（预留的 1–2 轮未使用）。
- [x] (2026-11-17) 原生证据（文档面 head `81ebfd99`，不沿用旧 head 结论）：`CI` run `44018167753` 的 job「Windows Native（原生安全与平台契约）」`3m54s`（job `133820996188`）在同为 `win25-vs2026` / `ImageVersion=20261103.298.1` / `AMD64` / node `v26.13.1` / git `2.56.0.windows.4` 上同得 `native-git 18/0`、`private-data files=3 tests=78 skipped=0 todo=0`、`standard-user exit=0`；`PR Fast Gate` 同 head pass。
- [x] (2026-11-17，独立验收) 测试判别力：在临时 scratch ref 上跑变异体（ref 已删除、PR head 未变）——M1 去掉创建调用的 `SECURITY_ATTRIBUTES`：`private-data` 48/42/6 fail、packed 干净数据根 1 fail（fresh/adopt/Host 首启/worktrees/并发/sidecar 变红）；M2 把 `Ensure` 退化为普通 `Open`：`private-data` 48/39/9 fail、packed 干净数据根 1 fail（fresh/adopt/Host 首启/partial 两个子用例/worktrees/并发/sidecar 共 9 条变红）；M3 把创建后复核降为非私有：`windows-native` job 在 15 分钟 job timeout 被 cancelled、`PR Fast Gate` failure（`Verify`/`Browser` success）——既有 broad-* 拒绝对象被接纳后 `hostFixture` 泄漏 helper 进程使测试进程不退出，未留下逐用例归因；该 job 级红仍证明拒绝矩阵对准入强度敏感、不是空转。M1 首跑另命中一次 lane `native-git` `EBUSY` flake（与 lane `b9629891` 修复同根因），重跑后取得上述 stage-2 结果。

## Surprises & Discoveries

1. **2026-11-17**：三路设计共同假设「#643 要求 profile 自身 protected DACL，launcher 普通 `mkdir` 的 profile 会被拒绝」不成立。`host-private-windows.ts:146` 对 profile 传 `private=true, inherit=false`，而 `Security` 只有 `inherit=true` 时才要求 `SE_DACL_PROTECTED`（`:101`）；profile 只要求 owner=当前 SID、DACL 存在、无非受信 allow（`:86-99`）。探针 run `44010858246` 显示新鲜 profile 为 `O:SY D:P`，可继承 ACE 仅 SY/BA/self，capability ACE 无继承标记；因此普通 `mkdir` 链是 owner=self、AI、仅受信 allow，恰好被接纳。处置：缩短为「不改 profile、留 Batch 0 事实门」，删掉三路设计里的 profile 放宽实现。
2. **2026-11-17**：探针的标准用户 worker 实际失败——`EPERM: mkdir 'C:\Users\runneradmin\harness-acl-probe'`，原因是 `os.homedir()` 仍指 runner 管理员 profile；探针只采到 fresh profile 根 SDDL，**没有**直接采到 plain `mkdir` 子目录 SDDL。三路设计把后者写成已观测事实，属引用错误；本计划用 Batch 0 原生用例补上。
3. **2026-11-17**：sidecar 不需要「修复」。文件类 private 检查不要求 protected、只要求 owner=self 且无非受信 allow（`host-private-windows.ts:87-99,150-152`），因此 SQLite 在私有 root 内新建的 `-wal/-shm/-journal`（AI、仅继承 SY/BA/self）本就被接纳；只有 broad/foreign 残留会被拒绝。设计 2 的 sidecar 窄修复属过度设计。
4. **2026-11-17**：main 已含 #643 的全部产品接线（`host-private-data.ts:90-95`、`host-composition.ts:191,262-263`、`host-providers.ts:348-351`），上一轮「产品整合 0%」结论过期；本项产品 diff 只在 helper，composition/lease/dispose 零改动。
5. **2026-11-17**：`harness-plugin-artifact.test.js:281` 的 win32 skip 是 #643 新增给 #644 的，不是历史遗留；#646 的 lane 把 `allowedSkips=1` 精确绑定到它，因此本项必须同 PR 删 skip 并把 `allowedSkips` 归零，否则 lane 会以 skip 预算不符变红。
6. **2026-11-17**：`test/windows-native-lane` 当前与 main 同 head（`ddb94c94`），尚无 lane 实现；`test/windows-native-qualification` 的 git-paths job 为 `if: false`，只有 private-data 原型在跑（head `90a347fb`）。本项的 native 证据必须等 lane 落地后取得。
7. **2026-11-17**：本机（darwin）没有 PowerShell，`PROGRAM` 字符串在本地完全不会被执行；TypeScript/synthetic 测试只能保证不插值、不改协议，PowerShell 语法/API 错误只能由 lane 首跑发现。计划按「lane 首跑可能 1–2 轮语法/绑定修正」预留，并遵守 #646 D11 分诊纪律。
8. **2026-11-17**：`pnpm test:file tests/integration/harness-plugin-private-data.test.js` 在 main 上实测 `tests 59 / pass 59 / fail 0`；`windows-private-data.test.js` 在 macOS 上 `tests 18 / pass 10 / skip 8`（synthetic 通过、原生用例按平台 skip）。这两个数作为本计划的本地基线。
9. **2026-11-17**：lane 的标准用户阶段之前，管理员会在 fresh 用户真实 profile 下创建 `harness-foreign-profile` 子目录并对其 `setAcl`/`icacls /setowner` 到 foreign 用户（`provisionForeignFixture` 的 `profile` 参数是那个子目录，不是真实 profile 本身）；真实 profile 仍是 Windows 创建的 `O:SY D:P`、可继承 ACE 仅 SY/BA/self，因此 Batch 0 的 plain-mkdir 链与探针事实一致。
10. **2026-11-17（Batch 0 事实）**：原生用例采到 launcher 形状 profile 与 ancestor 都是 `O:<user>G:<domain>D:(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;<user>)`、`AreAccessRulesProtected=false`、owner=当前用户、三条 ACE 全部 `inherited=true`/flags=3/rights=2032127。#643 的 profile/ancestor 相位接受它，`prepareWindowsProjectData` 成功；探针 run `44010858246` 未采到的「plain mkdir 子目录 SDDL」由此变成事实，D1 的「不改 profile 契约」成立。
11. **2026-11-17（TDD 证据形状）**：实现批次在 lane 落地前完成，macOS 上所有原生用例按 `process.platform !== 'win32'` skip，判别性 RED 无法在本机观察；三个提交都是「先写用例、后写实现」，但 RED→GREEN 的实际判别由 lane 首跑承担（首跑即全绿，故 RED 只存在于用例先行的编排，不作为单独观测记录）。这是本计划唯一偏离「lane 上记录 RED」的地方，原因是外部依赖（#646 lane）当时尚未落地，已在 Decision Log D11 记录。
12. **2026-11-17（本机 PowerShell 代理验证）**：开发机没有 Windows PowerShell 5.1，`PROGRAM` 完全不会被执行。用仓库外的临时独立 PowerShell 7 解析器做了三项非资格性检查：(a) 以 PowerShell AST parser 解析完整 `PROGRAM`（3461 tokens、0 parse error）；(b) 该解析器可用的 `AssemblyBuilder.DefineDynamicAssembly` 替代入口上把 Bind + 三个 IL wrapper 真实编译成类型，确认 `OpenChecked/CreateChecked/CreateDirectoryChecked` 的签名与 `CreateFileW/CreateDirectoryW/ConvertStringSecurityDescriptorToSecurityDescriptorW` 的 `DllImport(SetLastError, Unicode, Winapi, PreserveSig)` 元数据正确；(c) 调用三个 wrapper 确认 IL 体有效（调用到达 native 加载器后因 macOS 无 `kernel32.dll` 失败，而不是 `InvalidProgramException`）。这些只降低「lane 首跑语法/绑定失败」概率，不算原生资格证据；工具未进仓库、未新增依赖。
13. **2026-11-17（lane 计数口径）**：lane 的 `ℹ tests` 含 `t.test` 子用例。base 的 `harness-plugin-windows-private-data.test.js` 在 Windows 上是 18 顶层 + 21 负控子用例 = 39（即 `minTests`）；本项后为 28 顶层 + 18 负控 + 2 partial-resume 子用例 = **48**，仍高于 39 下界。`private-data` 集合合计 `tests=78`（48+1+29）。`allowedSkips=0` 生效后三文件 `skipped=0`。
14. **2026-11-17（打包 Host 解锁）**：`harness-plugin-artifact.test.js` 的「干净数据根首次创建」用例删除 win32 skip 后在 lane 上真实执行并通过（29/29、skipped 0），确认它本身就是「打包产物首次创建私有根」的 packed fresh 资格证据，不需要新增用例。
15. **2026-11-17（首跑质量）**：lane 首跑即全绿，没有出现计划预留的 1–2 轮 PowerShell 语法/绑定修正；`windows-native` job 用时 `4m11s`（含 install/build/建号/两阶段）。原计划担心的 owner 显式写 SD、`CREATE_NEW` 属性级 desiredAccess、x64 `SECURITY_ATTRIBUTES` 布局在真实 Win32 上均按预期工作。
16. **2026-11-17（验收期 lane 前进）**：本项证据 run 绑定 base `8ce44759`；此后 lane tip 前进到 `1f28dd42`（仅 lane ExecPlan）与 `b9629891`（`tests/integration/local-git-fixture.js` 清理加有界重试，修 `native-git` 阶段 `EBUSY` flake）。两者都不改 `ci.yml`、`scripts/windows-native-checks.mjs`、lane 契约测试或本项文件，但 retarget 后的最终原生证据必须在含这些提交的 base 上重取（D9，lead-owned）。独立验收在 scratch ref 上另有一次 `native-git` `EBUSY` 红，与该修复的根因一致，进一步支持它是环境 flake 而非产品回归。

## Decision Log

- **D1（2026-11-17，设计评审 agent-14）**：profile 由 launcher 拥有，插件只 admit、不创建、不改 ACL；**不实施** controlled-ancestor 放宽。Rationale：main 代码读取 + 探针 run `44010858246` 表明普通 `mkdir` 链本就被接纳；放宽会削弱已合并 #643 契约并删除 `broad-profile` 拒绝负控，属于无证据的过度设计。门禁：Batch 0 原生用例；失败则停止并交 lead。
- **D2（2026-11-17，设计评审 agent-14）**：既有对象策略为「canonical → adopt；否则 refuse」，不实现 DACL 修复。Rationale：当前无正式发布且硬约束禁止旧数据修复/迁移；修复需 `SetSecurityInfo`/WRITE_DAC 与额外 TOCTOU，且会把明确拒绝的负控改成正例。AC 的「repair-or-refuse policy」由 refuse 分支满足。
- **D3（2026-11-17，设计评审 agent-14）**：同一 helper 内做幂等 create-or-admit，不加 provision 模式/第二帧/第二 helper/新文件。Rationale：fresh 与 reopen 策略相同；第二 path owner 违反 issue 与单 owner 约束；协议/测试翻倍无收益。
- **D4（2026-11-17，设计评审 agent-14）**：SD 通过 `ConvertStringSecurityDescriptorToSecurityDescriptorW` 生成 self-relative SD，再以 `SECURITY_ATTRIBUTES` 传入 `CreateDirectoryW`/`CreateFileW`；显式 `O:<sid>`、目录 `D:P` + OI/CI、文件去 OI/CI。Rationale：创建调用内原子设 SD 是 AC 唯一接受的方式；系统 API 明确返回 self-relative，避免 .NET `GetBinaryForm` 格式歧义；显式 owner 防提权 token 默认 owner≠用户而静默产生错误对象。
- **D5（2026-11-17，设计评审 agent-14）**：创建形状与 #643 fixture canonical 形状一致（当前 SID + SY + BA）。Rationale：#643 已把 SY/BA 声明为受信 OS 例外；保持单一形状避免 provisioning/admission 两份契约漂移；不新增 self-only 的第二种形状。
- **D6（2026-11-17，设计评审 agent-14）**：worktrees/digest 按需创建、各自显式 protected DACL；路径身份与规范根继续归 #645/#338。Rationale：用户已合并的路径 owner 是唯一实现；本项只对固定两层负责 DACL；Git 后代靠继承，不逐个改 ACL。
- **D7（2026-11-17，设计评审 agent-14）**：错误面只扩 token 取值域（phase + `create-*` + win32 码），协议/schema/预算/固定文案不变。Rationale：Host 不解析细节，无 ABI 变化；有界码对诊断足够。
- **D8（2026-11-17，设计评审 agent-14）**：artifact win32 skip 删除、`allowedSkips` 归零在本项内完成，并作为 packed fresh 资格证据。Rationale：#643 明确把该 skip 留给 #644；#646 lane 的约定也要求同 PR 交接。
- **D9（2026-11-17，设计评审 agent-14）**：PR base 为 `test/windows-native-lane`，最终 lane 合并后 rebase 到 main 并在最终 head 重跑原生证据。Rationale：协调层已定 #646→#644 顺序；stacked PR 的体量判定以 lane 为 base，不会被误读成整栈累计。
- **D10（2026-11-17，设计评审 agent-14）**：不新增 workflow/规则/账户/依赖；第二标准用户读拒绝等更强的跨主体负控不在本项。Rationale：lane 面归 #646；现有 foreign/broad 负控与威胁模型已覆盖；避免扩大必需门禁的 flake 面。
- **D11（2026-11-17，实现 owner）**：lane 落地前先完成并 push 本地可做的 Batch 0–2，lane 落地后 rebase（先建 `backup/provision-e1781310` 恢复锚点）再取原生证据；TDD 仍按「先写用例、后写实现」编排，但原生 RED 由 lane 首跑承担，且**不为制造 RED 而在本机 mock win32 或降低用例判别力**。Rationale：唯一外部依赖是 lane；mock 平台违反 #646 的反空心与 #643 的资格口径；本机无法执行 Windows PowerShell。
- **D12（2026-11-17，实现 owner）**：用仓库外临时独立 PowerShell 7 做 `PROGRAM` 的 AST 解析与 IL 编译/调用代理验证，替代不可用的 Windows PowerShell 5.1；结果只作过程降险，不写进资格口径、不进仓库、不新增依赖。Rationale：`PROGRAM` 是盲写的高风险面，lane 首跑才发现语法错误会浪费一轮 hosted 证据；D12 与 V2/V3 的真实原生证据不冲突。
- **D13（2026-11-17，实现 owner）**：`SETS['private-data'].allowedSkips` 归零按 lane 契约的三处同批改：`scripts/windows-native-checks.mjs`（1→0 与注释）、`docs/development/ci.md` 的 skip 归属段、`tests/contract/windows-native-checks.test.js` 中把合成 `skipped: 1` 期望改为 0（该测试用本地 fixture 而非真实 `SETS`，但固定的是「预算精确值」语义）；同一提交内完成，避免中间提交出现 lane 红。Rationale：lane 的文件集/预算归 #646，本项只做它明确留给 #644 的交接，不改清单结构。

**Lead 裁决（2026-11-17）**

- OQ1：接受维持 #643 的 profile 严格度（owner=当前用户、无非受信 allow、不要求 protected），以 Batch 0 原生事实门为准；不预先放宽为 controlled-ancestor。若 Batch 0 拒绝，停止并按计划交 lead，不在本 PR 静默改契约。
- OQ2：接受 refuse-only（canonical → adopt，否则拒绝；不实现 `SetSecurityInfo` 修复）。与「无正式发布、不做旧数据修复/迁移」硬约束一致，用户可删除非 canonical 旧目录后重启。

### Open Questions（历史；已由上方 Lead 裁决关闭）

1. **profile 严格度**：维持 #643 的「owner=self + 无非受信 allow，不要求 protected」并只在 Batch 0 失败时再议，是否接受？建议接受（证据支持、零契约改动、#647 兜底受管设备）。若要求现在就放宽为 controlled-ancestor（允许非受信只读 ACE、仍禁危险写），需新增准入分支与负控，约 +40 实现/+60 测试并重做 native 证据——本计划不做。
2. **既有 permissive 对象的 refuse-only**：是否接受不提供 `SetSecurityInfo` 窄修复（用户需删除非 canonical 的旧目录才能启动）？建议接受（无正式发布、仓库硬约束禁止修复；实现/测试/证据成本最低）。

## Idempotence and Recovery

- **幂等**：`Ensure` 先 create（EXISTS 视为已存在）再走既有 `Open` 接纳；重复启动/重试/并发初始化都收敛到同一 canonical 树，不覆盖、不截断、不改写既有 DACL。
- **部分失败**：已创建对象保持私有、可被下次启动 adopt；失败路径不写敏感字节、不发布端点、helper 被 dispose。重试即恢复。
- **拒绝零写入**：permissive/foreign/linked/wrong-type 路径失败后，既有对象字节、DACL、owner 与祖先不变（Batch 2 用 SDDL 前后比较断言）。
- **回滚**：整 PR revert 后 Windows 回到 #643 admit-only；本项创建的 canonical 树（含 root/db/log/worktrees）可被 #643 代码继续接纳，无数据迁移/备份需要。按批复回：Batch 0 只退测试；Batch 1 退 helper 即回 fail-closed；Batch 2 退测试与 skip/预算，已建 worktrees 仍是 canonical；Batch 3 退文档。
- **lane 交错**：lane 合并到 main 后，本 PR retarget 到 main 并 rebase；冲突面预计只有 `docs/README.md` 与 lane 的 skip/预算行；每个最终 head 必须重跑原生证据，不沿用旧 head 结论。
- **已知良好状态**：`git switch feature/windows-private-provision && git reset --hard <最近一次 lane 绿的本地提交>`（提交须先 push 或记入 Progress），随后重跑 V1/V4，并按需重新 push 取 V2。

## Interfaces and Dependencies

- **PR/合并顺序**：base `test/windows-native-lane`（#646）；#646 合并后 #644 retarget/rebase 到 main；不自行合并。
- **lane 接口**：`scripts/windows-native-checks.mjs --set private-data --profile <path> --foreign <path>`；`allowedSkips` 交接是 #646 lane 计划明确留给 #644 的改动点，不表示本项拥有清单结构；若实现期间 lane 重写 runner，按其实际常量同步并可请 lane owner 复核；`process.env.USERPROFILE` 是该临时标准用户的真实 profile，`TEMP/TMP` 指其 profile 内目录，`HARNESS_WINDOWS_FOREIGN_PROFILE` 是管理员预置的 foreign fixture；本项只消费这些环境，并把 `allowedSkips` 归零、删除 artifact skip。
- **Host/产品接口**：`prepareWindowsProjectData(profile, signal)` 签名与返回（`directory/logFd/signal/dispose/assertDirectories`）不变；`PreparedPrivateData`、composition 顺序、remote 发布点不变；无公共包出口/ABI 变化。
- **Win32/API**：仅新增 `CreateDirectoryW`（kernel32）与 `ConvertStringSecurityDescriptorToSecurityDescriptorW`（advapi32）；复用 `CreateFileW`/`LocalFree`/`CloseHandle`；系统 PowerShell 5.1、x64、NTFS 固定盘；不新增二进制/npm 依赖/编译步骤。
- **相邻工作项**：#645（路径/身份）与 #338（worktree-permission child/canonical root）保持各自 owner；#647 负责 Win11 x64 Desktop 安装/日常使用人验；#646 负责 lane 入仓；R1 与发布接受独立。
- **凭据/权限**：无 secret、无 GitHub 写权限、不改 workflow/分支保护；lane 的 runner 管理员只做 checkout/build/建号与 foreign fixture，安全用例在标准用户下执行。

## Outcomes & Retrospective

### 交付结果（2026-11-17）

**产品/测试面最终 head**：`1a681c350d6a77776db122219e9fc47aa4b6f603`；**文档面最终 head**：`81ebfd994617b854559982bb2a6745e3f7e8ef4f`（两者 base 均为 `test/windows-native-lane@8ce447594981`）。提交序列（rebase 后）：

1. `32b033bd docs(exec-plan): 起草 Windows 首次私有化 provisioning 计划`（计划落库）
2. `e99b9414 test(apps): 加入 launcher 形状 profile 链的原生接纳事实门`（Batch 0）
3. `56120b1b feat(apps): 在 Windows 私有根首次使用时原子创建并接纳数据边界`（Batch 1）
4. `1a681c35 test(apps): 补齐并发、sidecar、worktrees 与不修复的原生策略矩阵`（Batch 2 + lane skip 交接）
5. `81ebfd99 docs(exec-plan): 收口 Windows 私有化 provisioning 的原生证据`（Batch 3）

**原生证据（V2，唯一资格证据；两个 head 使用同一 lane 定义）**：`CI` run `44016639839`（`pull_request`，head `1a681c35`，job id `133816042841`，`4m11s`）与 `CI` run `44018167753`（`pull_request`，head `81ebfd99`，job id `133820996188`，`3m54s`）：

- `ImageOS=win25-vs2026`、`ImageVersion=20261103.298.1`、`Architecture=AMD64`、node `v26.13.1`、git `2.56.0.windows.4`。
- 阶段 1（runner 管理员）：`windows-native-checks: set=native-git files=2 tests=18 skipped=0 todo=0`。
- 阶段 2（临时标准本地用户 `S-1-5-21-…-1003`，`admin=false`/`adminMember=false`）：`windows-native-checks: set=private-data files=3 tests=78 skipped=0 todo=0`；逐文件 `harness-plugin-windows-private-data.test.js` 48/48/fail 0/skip 0、`harness-plugin-windows-artifact.test.js` 1/1、`harness-plugin-artifact.test.js` 29/29（干净数据根用例真实执行）；`standard-user exit=0`。
- 实际判别结果：Batch 0 launcher plain-mkdir profile 链被接纳（SDDL 见 Surprises #10）；fresh 创建/ adopt 不改写/ Host 首启迁移 1–7 与重开/ partial resume/ worktrees+digest 创建与 Git 后代继承/ 并发首启/ sidecar 残留/ plain worktrees/ plain root/ missing profile 全部按计划通过；既有 foreign/broad/junction/hardlink/null/callback/direct-only/ancestor/inherit-only 负控保留且仍拒绝。
- `PR Fast Gate`、`Verify（typecheck + 契约测试）`、`Browser（生产组合读取与恢复）`、`PR size`、`Disclosure scan`、`Issue policy`、`Resolve PR base` 同为 pass。

**本机证据（V1/V3/V4/V5，非资格）**：

- `pnpm verify` exit 0（typecheck + contract + integration + e2e 全绿）。
- `pnpm test:file tests/integration/harness-plugin-private-data.test.js`：`tests 59 / pass 59 / fail 0`（POSIX 敏感路径零改动）。
- `pnpm test:file tests/integration/harness-plugin-windows-private-data.test.js`：`tests 28 / pass 10 / skip 18`（原生用例按 darwin 平台 skip；lane 上为 48/48）。
- `pnpm test:file tests/integration/harness-plugin-artifact.test.js`：`tests 29 / pass 29 / skip 0`。
- `pnpm run boundaries` 9 pass；`node scripts/workflow-check.mjs` no findings；`node scripts/rule-checks.mjs size test/windows-native-lane` 代码 317/1000、文档（含本计划）419/1500；`node scripts/rule-checks.mjs disclosure test/windows-native-lane` 通过；`git diff --check test/windows-native-lane...HEAD` 无输出。

**与计划的偏差**：Batch 0 无需放宽 profile 契约（符合 D1 期望）；PowerShell 语法/绑定修正轮次 0（预留 1–2 轮未用）；原生 RED 未单独观测（D11，外部依赖 lane 未落地时先完成实现）；lane 计数口径见 Surprises #13；`docs/README.md` 索引行在 docs 提交时已落地，Batch 3 无需新增；文档提交产生新 head 后按同一 lane 重新取证（run `44018167753`），未把 `1a681c35` 的旧 run 当作最终 head 证据。

**仍未覆盖**：Win11 x64 Desktop 人类验收与发布接受（#647、R1）；受管设备/企业 profile 策略、launcher 提权创建变体；helper 与 `CreateDirectoryW/CreateFileW` 之外的 Windows 版本差异；并发首启只覆盖「双方成功」的收敛，「一方失败不破坏另一方 canonical 树」目前由「拒绝路径零写入 + 既有对象只经 `Open` 复核」结构性保证，未单独构造失败方。**下一步（非本 owner）**：#646 合并后把 PR #657 retarget 到 `main` 并在新 base 上重跑原生证据；lane tip 已在本项证据 run 之后前进（`1f28dd42` 文档、`b9629891` `native-git` 夹具清理有界重试），`ci.yml`/`SETS`/本项文件未变但最终证据必须在新 base 重取（D9）；是否 Ready 由 lead 决定。

## Bottom Change Note

- Change Note (2026-11-17)：创建计划。基于 main `ddb94c94` 与 run `43871692717` 更新旧研究；比较三路设计后选定「同一 helper 幂等 create-or-admit + profile admit-only + refuse-only + lane skip 交接」，并记录三路设计中的 profile/sidecar/整合面事实错误与处置。
- Change Note (2026-11-17)：接入 #646 lane 契约——明确本项必须删除 artifact win32 skip、把 `SETS['private-data'].allowedSkips` 归零；PR base 为 lane 分支，最终 head 重跑原生证据。
- Change Note (2026-11-17，lead 裁决)：关闭 OQ1/OQ2；维持 #643 profile 严格度并以 Batch 0 原生事实门裁决，既有对象 refuse-only；PR 以 `Closes #644` 交付、Base 为 `test/windows-native-lane`。
- Change Note (2026-11-17，Batch 0)：fixture 增 `launcherProfile`/`provisioned` 选项（默认行为不变）与 launcher plain-mkdir profile 原生事实门；lane 证明 #643 接受该 profile 链，未改契约。
- Change Note (2026-11-17，Batch 1)：同一 `PROGRAM` 内实现幂等 create-or-admit（两个新 P/Invoke 绑定、两个 IL wrapper、SDDL+`SECURITY_ATTRIBUTES`、`Ensure`、`directories` 帧同语义），错误 token 扩 `create-*`/`platform`，协议与 Host ABI 不变；四个原生正例 + 本机回归通过。
- Change Note (2026-11-17，Batch 2/3)：策略矩阵、并发、sidecar、worktrees 继承与 refuse 零写入用例落地；删除 artifact win32 skip 并把 lane `allowedSkips` 归零（含 `ci.md` 与契约测试固定行）；精确 head `1a681c35` 首跑即取得 win25 标准用户证据（`native-git 18/0`、`private-data 78/0`、`standard-user exit=0`）与全绿 checks。是否 Ready 留给 lead。
- Change Note (2026-11-17，最终验收)：把原生证据绑定到实际最终 head（产品/测试面 `1a681c35` run `44016639839`、文档面 `81ebfd99` run `44018167753`），补全提交序列与 lane tip 前进事实；记录三个 scratch ref 变异实验（fresh/packed/`broad-*` 拒绝用例分别变红，ref 已删除）与「并发一方失败不破坏对方树」未单独覆盖的残余风险；产品/测试面不变。
