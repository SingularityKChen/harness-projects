# Windows 既有私有根准入 ExecPlan

> 状态：Completed（实现与同源原生验收）；创建、完成：2026-11-16
> 范围：#643，仅安全预置本地根的 Host 重开；#644 首次创建、#646 更广原生资格、#647 Windows11 Desktop 人验独立保留。
> 规范：根 `PLANS.md`、`AGENTS.md`；上游：同仓 issue #643、#597、#648、#413。

## Purpose / Big Picture

原生 Windows 普通用户 token 经实际 Host startup 重开已安全预置的 profile/plugin root、数据库及日志，保留数据、继续真实 SQLite 事务与日志。不安全或缺失对象在私有内容读取及 remote 发布前拒绝；取消、超时与 helper 死亡有界回收，并撤回完整 Host 权威。V1/V3 在同源 Windows Server 2025/NTFS、独立标准账户上完成；本项不代表 Windows11 DSH Desktop 人类接受或 Gate R1 发布接受。

## Context and Orientation

执行上下文为 `feature/windows-private-root-admission`、`.worktrees/windows-root-admission`；调查基线 `ba27b24c`。原实现仅接受 darwin/linux，使用 fd、O_NOFOLLOW、owner/mode、single-link 与 Darwin fd ACL；POSIX 路线保留原地。Windows 不能以 chmod/fs.access 推断隐私。

`host-authority.ts` 现在保留原始 `profileContext.dir`，Windows 在任何 realpath/normalize 前交 native 准入；`host-private-windows.ts` 是 App 私有 adapter。`host-composition.ts` 持有 lease，打开 Storage/log 后才发布权威，关闭顺序为 Storage→log→lease。`host.ts` 将 owner abort 连接唯一根 dispose，运行期失效同步撤 remote。`host-providers.ts` 只增加预置 worktrees/digest 的同一 lease 传递；未改变 #645 的路径 schema。

Host profileContext/ctx.fs 公开 ABI 无 SID/DACL/目录 HANDLE lease；SQLite DatabaseSync 接收 pathname，没有公开既有 Windows HANDLE 入口。因此采用整链 ACL、目录 lease 与安全 provisioning 前置建立 pathname reopen 边界，不跨进程桥接 CRT fd，不升级 Host ABI。

## Design / Spec

采用系统 Windows PowerShell 固定绝对 executable，argv + shell:false 启动固定程序；系统位置来自受信 Host 启动环境并验证本地绝对路径，不接受 Project/config/PATH 指定。路径只经有界 stdin JSON。清除继承的 PSModulePath，只允许系统 5.1 Modules；程序开始钉到 `$PSHOME\Modules`，Console 输入/输出显式 UTF-8、无 BOM。FullLanguage 或绑定不可用即 fail closed。

.NET Framework Reflection.Emit `DefineMethod` + 单次 DllImport 伪属性建立 Win32 映射，CreateType 后从实际 ImplMap 回读唯一 import 的 SetLastError、EntryPoint、Unicode、Winapi、PreserveSig 与 DLL。OpenChecked managed IL 紧随 CreateFileW 原子保存 Marshal 缓存错误，只有确切 ERROR_FILE_NOT_FOUND=2 才允许 optional sidecar 缺席。禁止 Add-Type/CodeDom/动态编译及 helper 启动其它应用进程；原生只接受最多一个确切系统 `Windows\System32\conhost.exe`，捕获的子进程须随 helper 在 1s 内退出。该角色见 [Microsoft console host 定义](https://learn.microsoft.com/en-us/windows/console/definitions)，不按名称放行其它来源。

仅接受本机固定 NTFS 卷、完整 drive-rooted 原始路径；拒绝 UNC/network/device namespace、ADS、drive/root-relative、`.`/`..`、不支持的别名和无法取得稳定身份/安全信息的对象。DriveInfo 确认固定盘；GetFinalPathNameByHandleW 的 volume-GUID 根确认盘符确为卷根，拒绝 subst 等隐藏祖先的映射，但不以最终路径代替原始链检查。

从卷根向下逐段 CreateFileW，OPEN_EXISTING + OPEN_REPARSE_POINT + BACKUP_SEMANTICS，share 仅 READ/WRITE，绝不 SHARE_DELETE。目录 desired access 为 READ_CONTROL | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY（0x20081），固定文件 probe 为 metadata-only 0x20080；LIST 使目录 HANDLE 参与 I/O sharing，不枚举目录或读取私有文件内容。每段验证后保有 HANDLE 才开下一段；原始祖先、profile、plugin root 及后续 worktrees/digest 均归同一 lease，直到 Storage/log 关闭后释放。

GetFileType、GetVolumeInformationByHandleW、GetFileInformationByHandle、GetSecurityInfo 只查刚打开 HANDLE 的 disk/NTFS、reparse、volume/file ID、link count、owner SID 与 DACL。descriptor 有界复制后 LocalFree，最终 CloseHandle；产品不按路径 Get-Acl 或解析本地化账户/icacls 文本。profile、plugin root 与固定文件 owner 必须当前 token User SID；祖先 owner 可为当前 SID、SYSTEM `S-1-5-18`、Administrators `S-1-5-32-544` 或固定 TrustedInstaller `S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464`。这些 OS 管理主体是明确受信例外，不是隔离对象。

DACL 仅接受可解释的 CommonAce allow/deny，按数值 mask/flags/SID 判定；拒绝 NULL、不可读、未知/conditional/callback/object ACE。保守检查 allow，deny 不抵销有害 grant。private 目录/文件的任何非受信 allow（含 inherit-only/inherited）拒绝。祖先可公开 read/traverse；generic rights 展开后，实际应用的非受信 ACE 不得有 DELETE 0x10000、WRITE_DAC 0x40000、WRITE_OWNER 0x80000、DELETE_CHILD 0x40、WRITE_DATA/ADD_FILE 0x2、WRITE_EA 0x10、WRITE_ATTRIBUTES 0x100。标准卷根仅允许 CreateSubdirectory 0x4 的例外，不能推广到 plugin root；祖先 inherit-only ACE 不作用当前对象，实际 child 仍逐段检查。

plugin root 必须有受保护、安全的 DACL，并对新普通文件提供当前 owner SID 的足够 OBJECT_INHERIT allow；可继承 allow 只含 owner/受信 OS 主体。direct-only ACL 即使眼前 DB 私有也拒绝。数据库、diagnostics.log 必须已存在、普通 disk file、owner 为当前 SID、私有 DACL、nlink=1、无 reparse；现有 -wal/-shm/-journal 同样检查。完成整链边界后释放固定文件 probe，避免阻止 SQLite journal 清理；Node log fd 持续保有，SQLite pathname reopen 在受保护边界内运行。缺 root/DB/log 不创建、不修复，留 #644；缺 worktrees/digest 则对应绑定拒绝。

威胁边界隔离其它非受信 OS SID；不隔离同一 SID、上述 OS 管理主体，也不抵御安全 provisioning 前已持有恶意写 HANDLE 的主体。这是交接前置；扩大威胁模型必须重新设计，不能把一次 pathname ACL 快照当同等保护。

原生 startup 总预算 15s，POSIX 3s；每次目录 request 独立 15s 回应预算。限制目录 HANDLE≤64、路径≤8192 UTF-16、输入≤64KiB、descriptor≤64KiB、DACL≤128 ACE、每次 probe stdout/stderr≤4KiB、静态 argv<24K UTF-16。只接受精确版本结果；未知 schema、无 pending 的额外输出、stderr、溢出均拒绝。完成/取消清 timer 与监听；dispose 立即 reject pending。owner 正常停止只 quiesce，不能在 Storage/log 关闭前 kill 已 ready helper；异常失效先撤 authority，最后释放 lease，剩余 Host shutdown deadline 到期则终止唯一 helper并等 close。所有外部失败统一 HostAuthorityError 固定文案，不含路径、原始 exception/stderr。

## Global Constraints

实现范围限 App 私有准入、Host 原始路径/生命周期、restoreProviders 的 lease 传递及相关集成/打包测试；`host-private-acl.ts`、build manifest、公共包边界与 CI workflow 未修改。#645 的 Provider/path/binding 改动独立组合，不同事实源、凭据句柄及规划状态不变量保持。

相对 `ba27b24c` 完整技术增删 729 行，包含 helper、native/token/ACL fixture、synthetic 与 artifact 测试，低于 `<800`；本文与索引文档低于 `<1300`。共享 qualification workflow 由协调者独立管理，不用外置必要负控规避预算。未新增依赖、升级 Host、下载工具、创建真实用户根或操作项目数据。

## Plan of Work

### Batch 1 · 原生机制入场与实际 Host 重开

**最小闭环**：同源 native helper 先证明 SID/DACL/目录 lease/sidecar/清理，再接实际 Host，安全根可重开，拒绝及失效无权威泄漏。

**涉及文件**：`apps/harness-plugin/src/{host-private-windows,host-private-data,host-authority,host-composition,host-providers,host}.ts`；`tests/integration/harness-plugin-{windows-private-data,windows-fixture,windows-artifact,private-data,artifact}.test.js`（fixture 文件为 `harness-plugin-windows-fixture.js`）；本文与 `docs/README.md`。

先建立原生 fixture 与实际 Host 的语义 RED；通过原生机制后接 rawProfile、composition lease、预置 worktrees/digest 和 root abort→完整 dispose。使用最窄行为反证迭代，再执行 V1–V3、完整 diff/发布扫描及独立安全复核。Windows 源与包使用同一 source head，不以 synthetic 或 build 成功替代 native。

**验证**：复用下面 V1–V3；本批命令、结果和边界只在 Validation 记录。

**回滚**：撤销整个 OS adapter/lease 闭环，Windows 恢复 fail closed；无用户数据迁移、ACL 修复或自动创建需要逆转。

## Validation and Acceptance

命令从本计划工作树根执行，依赖采用 frozen lock；native 为 GitHub hosted windows-2025 x64、NTFS，实际独立标准本地账户（Admin role=false、Admin membership=false），不是默认管理员/UAC-disabled runner。foreign-owner DB 由管理员预置后交 worker 验证，worker不提升权限。fixture 只操作自身临时根与账户，finally 清理。

- V1：`pnpm test:file tests/integration/harness-plugin-windows-private-data.test.js`。检查实际 Host read/write/reopen、完整拒绝及无端点、原始链与空 worktree rename 屏障、SQLite journal/WAL/SHM 安全继承和清理、helper death 撤权及释放。synthetic 明确区分：协议、15s、abort、overflow、pending 结算和 200 次合法响应预算。
- V2：`pnpm test:file tests/integration/harness-plugin-private-data.test.js`。Darwin/Linux 原 fd/ACL/拒绝/卸载回归；Windows 显式不执行 POSIX 新建根用例。接线后另执行已有 Host authority/lifetime/runtime 回归与 `pnpm verify`，全部通过；artifact 本机为 29 pass / 1 native skip（既有 React SSR warning）。
- V3：`pnpm --filter @harness-projects/app-harness-plugin build && pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-windows-artifact.test.js`。Windows 包装入口只载入 dist/package 实际 Host；共享 native fixture 读取 seed、安装 execution bindings 真实事务、log fd 追加、关库重开读回，并在 native release 前确认 log fd 已关及 DB 可 rename，helper death 后 services/typert 均撤回。

最终 native run [43861210587](https://github.com/SingularityKChen/harness-projects/actions/runs/43861210587)，产品 source `6c9ac4ce06079932e0b49ba1a3ee63fa55fcd946`，job `133278210021`：**66 pass / 0 fail / 1 skip，67 total**；唯一 skip 是既有 artifact 的 POSIX 首次创建场景。startup 589ms<15s；同一空目录对照 `{"131200":true,"131201":false}`，即 metadata-only 可 rename、LIST lease 拒绝；动态 container/digest、actual source/packaged Host、关闭顺序与失效撤权全部通过。

同 run 的独立组合 job `133278210401`，组合 source `3b83c4bb`：**1 pass / 0 skip**；packed public bind/reopen 的 identity/config 稳定，gitReads=16、fixture=8，产物 SHA-256 `d4778dc2f9e5a663d055b16c86270e2b175c47403b522ef996f1d4d7dda0caf2`。这项证据验证与 #645 的实际组合，不覆盖 #646 全范围，不替代 #647 Windows11 Desktop 人验。最终 commit 收敛、push/readback 和 Ready 由协调者执行，文档归档不等于合并或发布接受。

## Progress

- [x] (2026-11-16) 完成 Host 原始路径、owner/remote 生命周期与机制比较，设计经过独立对抗/native 复核。
- [x] (2026-11-16) 原生机制、标准 token、sidecar/空目录分享、helper/conhost 退出及实际 Host 语义 RED→GREEN 成立。
- [x] (2026-11-16) 接 composition-owned lease、完整 root dispose 与预置 worktree；V1–V3、POSIX/full verify、规模与发布扫描完成；更新 completed 索引。最终远端发布手续由协调者收口，不自行合并。

## Surprises & Discoveries

- realpath 会抹去原始 junction 证据；owner.stop 本身不撤 remote。现保留原始链，运行期 abort 进入完整根 dispose。同步 register 拒绝需先登记 acquisition Promise，启动期只延至 microtask 再 drain，运行期仍同步撤端点；既有回归捕获并验证修复。
- **Superseded：DefinePInvokeMethod 再加 DllImport 属性即可设置 SetLastError。** 实际 metadata 对照为 legacy=false、单次映射 declared=true；duplicate ImplMap 保留旧 flags，使原子 GLE 仍读到旧 203。现一次建立映射、回读 flags，再由 managed IL 原子捕获，只 errno2 可缺席。
- PowerShell 7 经 Node 间接启动 5.1 会继承不兼容模块搜索路径；fixture 使用系统模块边界与 typed signed system assembly 来源。**Superseded：只指定 Owner/Access 后继续 Set-Acl 足够。** protected 对象仍触发 Provider 的 SACL privilege 请求，现 fixture 直接 FileSystemInfo.SetAccessControl，只标记 Owner/Access，不提升 worker。
- **Superseded：metadata-only 0x20080 目录 HANDLE 的 no-share-delete 已由 profile/root rename 拒绝证明。** 后续空 digest 反例显示该结论不成立，早期拒绝可能来自已打开后代。最终同一空目录对照确认 0x20080 可 rename、0x20081 不可；所有目录统一 LIST access，fixed-file 仍 metadata-only。微软说明见 [CreateFile](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew) 与 [IoCheckLinkShareAccess](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdm/nf-wdm-iochecklinkshareaccess)。
- **Superseded：helper 必须 zero child。** 原生确认唯一额外进程为真实系统 conhost，helper 与捕获 child 均有界退出；最终仅接受该确切系统来源。取消/timeout 不提前释放 ready 目录 lease，pending dispose 立即结算；逐请求输出预算由 200 次合法响应反证，避免长会话误失效。

- 2026-11-16 MMP 评审：#643 与 #644 的接口假设需对齐。本 helper 要求 plugin root 与 worktrees/digest **自身** `SE_DACL_PROTECTED`；受保护父目录里普通 `mkdir` 创建的子目录会继承 ACE 但自身不是 protected，会被 `inheritance` 拒绝，而 #644 AC3 写的是 descendants 继承该策略。#644 必须显式逐对象设 protected DACL（或由 #644 owner 决策放宽为 no-untrusted-effective-grant）；原生 fixture 逐对象 `setAcl` 的写法保持不变。
- 2026-11-16 MMP 评审：`profileContext.dir` 本身被纳入 private 集合，而真实 DSH Desktop launcher 创建该目录时未做 Windows DACL 加固；原生证据里的 profile 由 fixture 显式 `D:P` 预置。若真实 profile 目录含 `Authenticated Users`/`CREATOR OWNER` 等继承 ACE，当前实现会 fail closed 拒绝启动，而 #644 AC1 要求 fresh normal-user profile 无需手工 ACL 即可启动。该私有化步骤目前没有明确 owner（#644 Notes 要求不递归改 profile）；需在 #644/#647 前做一次原生事实采集并明确归属。
- 2026-11-16 MMP 评审：原生套件新增路径词法/卷根/subst 反例（UNC、device namespace、`.`/`..`、尾随点/空白、ADS、8.3、drive-relative、forward-slash 与 `subst` 隐藏祖先全部在打开私有内容前拒绝，并保留普通临时根正控）；非 NTFS/网络卷类型分支仍需 #646 lane 的真实卷反例。
- 2026-11-16 MMP 评审：Host 运行期间长期持有卷根、profile 全部祖先与 plugin root 的 no-SHARE_DELETE 目录句柄，因此其它进程对这些目录的 rename/delete 会失败直到 DSH 退出；这是安全围栏的必要代价，已写入风险认知并补 dispose deadline 的合成判别用例（helper 忽略 close 时在 deadline 内被 kill）。
- 2026-11-16 MMP 评审：原生 lane 仍位于协调者分支 `test/windows-native-qualification`，`gh pr checks` 上的 Windows 行是手工 commit status 而非仓库 workflow、也不在 PR Fast Gate 聚合内；#646 跟踪 lane 入仓。PR 正文保留可回溯 run/job 链接，本计划不把该状态写成 main 已支持 Windows。
- 2026-11-16 MMP 评审：`harness-plugin-artifact.test.js` 的 Windows skip 是本 PR 新增（干净数据根首次创建归 #644），措辞不应写成既有 skip；同时把内嵌脚本的 `$profile` 变量改名 `$profilePath`（避免遮蔽 PowerShell 自动变量 `$PROFILE`）并给手工 IL 段补注释，产品行为不变。

## Decision Log

2026-11-16 / 独立规格与 native 审查：采用固定系统 helper + Reflection.Emit，不引入新 ABI/native dependency 或编译器树；目录 HANDLE 归 composition，固定文件 probe 在安全边界建立后释放，避免妨碍 SQLite。原生预算 15s、POSIX 3s，精确 source head 的 hosted native 证据与独立 Desktop 人验分开。

2026-11-16 / 实测修正：单次 ImplMap + managed IL、目录 LIST access、系统 conhost 例外和每请求预算均由原生/行为反例驱动；最终机制与威胁边界以 Design 为准，不保留已被反例推翻的承诺。未请求或写入规划 Status，不关闭 #644/#646/#647。

## Idempotence and Recovery

准入不修改 ACL/owner/目录，目录 LIST 权限不导致枚举。重试重新打开验证完整对象链，不复用失效 lease。dispose 共享 Promise，正常关闭先 Storage/log，再请求 helper EOF/close，剩余期限到则 kill并等 close；异常 helper 失效立即撤 authority。fixture 账户和临时根由 qualification finally 删除，不触及用户数据。回滚为恢复 Windows fail closed，无数据/权限迁移。

## Interfaces and Dependencies

私有 adapter 返回 directory/logFd/dispose、失效 signal 与有界 assertDirectories；composition 是 owner，rawProfile 仅由受信 Host 传递。Win32 方法限 CreateFileW/GetFileType/GetVolumeInformationByHandleW/GetFileInformationByHandle/GetSecurityInfo/GetSecurityDescriptorLength/GetFinalPathNameByHandleW/LocalFree/CloseHandle；SID/ACE 用 .NET typed API。helper 内嵌并随实际 Host bundle 打包，V3 无 source fallback；共享 CI 入口独立归协调者。

## Outcomes & Retrospective

#643 的已安全预置本地根重开闭环已实现并有同源 native source/packaged 证据；actual Host 可保留读写事务、日志和身份，unsafe/missing 对象拒绝，目录置换与失效清理可观测。完整技术增删 729 行，无必要负控外置或压缩，未新增技术债。本地 verify 与原生双 lane 全绿；最终远端 head/checks/issue/review readback、Ready 仍由协调者执行，不把工程完成当规划接受或合并授权。

限制仍是安全 provisioning 前置、本机固定 NTFS、当前受信 SID/OS 管理例外；首次创建、Windows 更广资格及 Windows11 Desktop 人验继续分别由 #644/#646/#647 承担。Gate R1 保持独立。

## Bottom Change Note

Change Note (2026-11-16)：建立并持续维护机制门，保留原始链、SID/DACL/继承、SQLite 与生命周期边界；原生 RED 逐一校正 module/ACL fixture、ImplMap/GLE、系统 conhost 与 metadata-only 分享假设。

Change Note (2026-11-16)：最终 source `6c9ac4ce` 与实际组合双 lane 在 run 43861210587 通过；仅文档归档至 completed，更新索引，收敛最终 spec 与 Superseded 记录。产品/测试保持冻结；协调者收口最终提交与远端验收。

Change Note (2026-11-16，MMP 评审修复)：补原生路径词法/卷根/subst 拒绝用例与 dispose deadline 合成用例；记录 #643↔#644 的 protected-vs-inherit 接口约定、profile 目录私有化归属、长期 no-SHARE_DELETE 句柄副作用、原生 lane 不在 main 与新增 skip 的准确措辞；`$profile` 改名 `$profilePath` 并补 IL 注释。
