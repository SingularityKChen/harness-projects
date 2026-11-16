# Windows 既有私有根准入 ExecPlan

> 状态：Active，原生机制证据成立；产品接线待同源原生验收；创建：2026-11-16
> 范围：#643，仅安全预置本地根的 Host 重开；#644 首次创建、#647 Windows11 Desktop 人验另行。
> 规范：根 `PLANS.md`、`AGENTS.md`；上游：同仓 issue #643、#597、#648、#413。

## Purpose / Big Picture

普通或受限用户 token 在原生 Windows 上，经实际 Host startup 重开已安全预置的 profile/plugin root、数据库及日志；安全数据保持，真实 SQLite 事务和日志继续工作。不安全对象在读取私有内容或发布 remote 前拒绝；取消、超时及 helper 死亡会关闭句柄/进程并撤回权威端点。缺失 root、数据库或日志保持拒绝。最小证据是同一 source head 的原生 Windows 正反例、SQLite journal 生命周期及 OS 阻止目录置换。

## Context and Orientation

在 `feature/windows-private-root-admission` 工作树根执行，隔离目录 `.worktrees/windows-root-admission`，调查基线 `ba27b24c`。`apps/harness-plugin/src/host-private-data.ts` 只接受 darwin/linux，靠 fd、O_NOFOLLOW、owner/mode、single-link 与 `host-private-acl.ts` 的 Darwin fd ACL 检查；不能以 Windows chmod/fs.access 替代。

`host-authority.ts` 的 profileDataPath 当前先 realpath(profileContext.dir)，会丢掉原始链上的 junction 证据。`host.ts` 在发布 remote 前调用 `host-composition.ts`；后者准备数据库/日志、打开 SQLite，再提供权威。composition.dispose 已关闭 Storage/log，适合持有最后释放的 admission lease。host.ts 的 owner.stop 只停止 lifetime/composition；`remote.ts` 仅安装时检查 owner.signal，运行期 abort 没有自动撤注册，因此 helper 意外死亡必须进入根级完整 dispose。

`host-providers.ts` 还经 preparePrivateWorktreeDirectories 准备 worktrees/digest 两层。Windows 在本项只验证预置目录，不创建或收紧 ACL。已核对 Host profileContext/ctx.fs 公开接口无 SID/DACL/目录 HANDLE lease；仓库固定的 Host ABI 不因调查而升级。SQLite DatabaseSync 接受 pathname，无公开既有 Windows HANDLE 入口。

## Design / Spec

采用 App 私有 Windows adapter，保留 POSIX 实现原地，不新建公共 filesystem framework。系统 Windows PowerShell 的固定绝对 executable 经 argv、shell:false 启动固定程序；系统位置只取受信 Host 启动环境并校验本地绝对系统路径，不能由 Project/config/PATH 指定。路径只走有界 stdin JSON，不插入脚本。用 .NET Framework Reflection.Emit DefineMethod + 单次 DllImport 伪属性绑定 Win32，CreateType 后回读实际 ImplMap 的 SetLastError、EntryPoint、Unicode、Winapi、PreserveSig 与 DLL；OpenChecked managed IL 在 CreateFileW 后原子捕获 Marshal 缓存错误。RawSecurityDescriptor/SecurityIdentifier 解析 typed descriptor。禁止 Add-Type/CodeDom/动态编译和 helper 启动其它应用进程；仅允许经原生证实的一个系统 Windows\System32\conhost.exe，所有捕获子进程须随 helper 在 1s 内退出。该进程是 Windows console host（[Microsoft 定义](https://learn.microsoft.com/en-us/windows/console/definitions)），不据名称放行其它来源。FullLanguage/绑定不可用则 fail closed。

原始 profileContext.dir 在任何 realpath/路径归一化前进入 Windows 准入，先拒绝含糊词法。只支持本机固定 NTFS 卷、完整 drive-rooted 路径，拒绝 UNC/network/device namespace、ADS、drive/root-relative、`.`/`..`、不支持的别名和无法取得稳定身份/安全信息的对象。helper 从卷根向下逐段 CreateFileW，OPEN_EXISTING + OPEN_REPARSE_POINT + BACKUP_SEMANTICS，share 只 READ/WRITE，绝不 SHARE_DELETE。每段验证后保留原生目录 HANDLE，才开下一段，所有原始祖先/profile/plugin root 的句柄归同一 lease，直到 Storage/log 关闭以后释放。上限 64 个目录句柄、路径 8192 UTF-16 code units、输入 64KiB、每份 descriptor 64KiB、每份 DACL 128 ACE、每次 probe 的 stdout/stderr 合计 4KiB；静态启动 argv 须低于 24K UTF-16 code units，超限拒绝。

用 .NET DriveInfo.DriveType 确认固定盘，并以 GetFinalPathNameByHandleW 的 volume-GUID 路径确认盘符根确为卷根，拒绝 subst 等隐藏实际祖先的映射；此用途不取代原始逐段检查。对刚打开的 HANDLE 用 GetFileType、GetVolumeInformationByHandleW、GetFileInformationByHandle 和 GetSecurityInfo 读取 disk/NTFS、reparse 属性、volume/file ID、link count、owner SID 与 DACL。descriptor 有界复制后 LocalFree，最终 CloseHandle；不按路径 Get-Acl、不解析账户名/icacls 文本。profile、plugin root 和固定文件 owner 必须当前 token User SID；祖先允许当前 SID、SYSTEM `S-1-5-18`、Administrators `S-1-5-32-544`，必要系统祖先可接受固定 TrustedInstaller SID `S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464`。这些 OS 管理主体是明确例外，不是隔离对象；不能扩成任意服务或管理员名称。

DACL 只接受可解释的 CommonAce allow/deny，按数值 mask/flags/SID 判断；拒绝 NULL、不可读、未知/conditional/callback/object ACE 和不受支持的安全描述符。保守检查 allow，deny 不用于抵销有害 grant。private 目录/文件的任何非受信 allow（含 inherit-only/inherited）拒绝。对祖先允许公开 read/traverse；展开 generic rights 后，非受信实际应用 ACE 不得有 DELETE `0x10000`、WRITE_DAC `0x40000`、WRITE_OWNER `0x80000`、DELETE_CHILD `0x40`、WRITE_DATA/ADD_FILE `0x2`、WRITE_EA `0x10`、WRITE_ATTRIBUTES `0x100` 或修改既有链的权限。标准卷根的 CreateSubdirectory `0x4` 可单独允许，因为全部后继已存在、受保护且保有句柄；不得把该例外推广到 plugin root。仅对祖先的 inherit-only ACE可按不作用于当前对象处理，实际 child 仍逐段检查。不能因祖先出现任何 write 位就拒绝正常 C:\Users，也不能忽略其替换 child 的权限。

plugin root 要求受保护且安全的 DACL，对未来普通文件有当前 owner SID 的足够 OBJECT_INHERIT allow，可继承 allow 只含 owner/受信 OS 主体；仅眼前 DB 私密、root 没有安全文件继承的 direct-only ACL 拒绝。实际创建 journal/wal/shm 必须证明继承安全，不能假定 token default DACL。数据库与 diagnostics.log 必须已存在、普通 disk file、当前 SID owner、私有 DACL、nlink=1、无 reparse；已存在 `-wal/-shm/-journal` 同样验证，仅确切 file-not-found 可缺席。不得为了验证先读其内容。缺失 root/DB/log 不 mkdir、不修复，留 #644。

完成原始目录整链/权限/继承边界后可释放固定文件 probe HANDLE，再由 Node 打开 log fd、SQLite 按 pathname 重开。外部非受信 SID 不能改名、换组件、修改 DACL、写私有文件或制造 sidecar；目录 lease 继续阻止 rename/delete，构成 reopen 的 race-resistant 边界。不得跨进程桥接 CRT fd；尤其不长持 sidecar deny-delete HANDLE 妨碍 SQLite journal 清理。Node log fd 保留到原有 log.close。worktrees/digest 若被生产 catalog 使用，须在同一已保护根边界内验证既有私有目录并归同一 lease/lifetime，缺失则绑定拒绝。

隔离不同非受信 OS SID，不隔离同一 SID、上述 OS 管理主体，亦不承诺抵御安全 provisioning 前已持有恶意写 HANDLE 的攻击者；这一前置必须明确写入交付说明。若目标威胁扩大到这些主体，当前 ACL 与 lease 不足，须停在设计门。放弃一次 pathname ACL 快照；放弃全程保有 fixed-file no-delete HANDLE；公开 Host Job + Add-Type 是经证据证明整树清理后可重估的备选，当前不引入新 ABI/native package 来规避机制验证。

私有 lease 提供目录、Node log fd、可重复 dispose 与失效通知；composition 拥有它。原生 startup 总 deadline 取 15s（含冷启动/整链/ACL/文件），POSIX 继续 3s；原生测量必须证明 15s 内并记录实际耗时，不无限加预算。stdin、stdout/stderr、descriptor、ACE 数分别设限，固定版本 ready 协议只允许一条精确结果；未知字段/无 pending 的额外输出/stderr/溢出拒绝。每次目录 request 均有 15s 回应预算、64KiB 输入上限和独立 4KiB 响应预算；完成或取消清 timer/监听，dispose 立即拒绝 pending。成功后清启动 timer，helper 以协议或 EOF 等待释放；owner 正常停止只 quiesce，不能在 Storage/log 关闭前 kill 已准入的 helper。abort/dispose 先请求关闭，剩余 Host shutdown deadline 内等待；超时终止唯一 helper 并确认 close 后返回。意外 close 必须触发 host.ts 唯一根 dispose：同步撤 remote→drain→Storage.close→log.close→lease release；补充 owner abort 到现有 dispose 的连接，不能仅 owner.stop。所有失败统一 HostAuthorityError 固定文案，无路径、原始 helper exception 或 stderr。

## Global Constraints

本 owner 完整写入集合：`apps/harness-plugin/src/host-private-data.ts`、`apps/harness-plugin/src/host-private-acl.ts`、`apps/harness-plugin/src/host-private-windows.ts`（新增）、`apps/harness-plugin/src/host-authority.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/host.ts`，及仅为私有 lease 传递/预置 worktree 准入所需的 `apps/harness-plugin/src/host-providers.ts`；测试 `tests/integration/harness-plugin-windows-private-data.test.js`（新增）、`tests/integration/harness-plugin-private-data.test.js`、`tests/integration/harness-plugin-artifact.test.js`、`tests/integration/harness-plugin-windows-artifact.test.js`（新增包装测试）与 `tests/integration/harness-plugin-windows-fixture.js`（新增共享原生 fixture）；如固定 helper 不能内嵌，才改 `apps/harness-plugin/scripts/build.mjs` 与对应 artifact 断言。文档本计划、`docs/README.md` 与必要的短安全边界说明。host-providers 的写入仅限 restoreProviders 私有 worktree lease 传递区域；LOCAL_GIT_ENTRY.configuration.repositoryPath.pattern 归 #645 owner，二者由协调者顺序整合。不得修改 #645 的 Provider/path/binding 文件及 #190 的身份/存储文件。

技术增删含 helper 字符串、测试/token/ACL fixture、配置、搬移/删除严格 `<800`，文档 `<1300`。当前 Reflection.Emit 路线预测 550–780，未取得源级 diff，先留 50 行余量；共享 qualification workflow 由协调者唯一 owner，作为独立 CI 能力计量，不用外置必要产品负控伪造预算。机制 gate 后按文件重估，超过则明确阻塞及最小独立闭环调整，不 minify 安全代码、删负控或冒称完成。本项不升级 Host、不下载工具、不创建安全用户根或操作真实项目库。

## Plan of Work

### Batch 1 · 原生机制入场与实际 Host 重开

**最小闭环**：同源原生 helper 的安全/清理机制经证明后接合实际 Host，安全预置根可重开，拒绝与失效都无权威泄漏。

**涉及文件**：`apps/harness-plugin/src/host-private-windows.ts`、`apps/harness-plugin/src/host-private-data.ts`、`apps/harness-plugin/src/host-authority.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/host.ts` 与新 Windows 集成测试；其余限 Global Constraints。

先在本分支建立固定 Reflection.Emit 原生探针和同源 Windows fixture，以 V1 验证默认系统祖先、SID/DACL 掩码、无 reparse/single-link、保有目录时 rename 被 OS 阻止、释放可 rename，以及真实 SQLite 事务/sidecar 创建删除不被固定文件 probe 阻塞。普通/受限 token 的实际 owner/组属性和正反例不可缺；该探针通过前不能把整合路线视为已成立。同步核对静态命令的 Windows argv 长度、15s 冷启动预算、native返回上限与源级总增删；任何一项不成立即记录阻塞并重选机制，不放松安全边界。

通过入场后保持 POSIX 原地，将单一 lease 接到 Windows 原始 profile 链和 composition；全程资源获取失败均汇入同一清理。增加 root abort→完整 dispose，使 helper 运行期意外死亡实际撤端点。V1 覆盖生产 apply/reopen，V2 保留 POSIX 与已有 Host cleanup，V3 使用实际构建包执行同组关键安全/拒绝/清理，不做 source fallback。最后按完整 diff 重估并独立做原生句柄/ACL/sidecar 对抗审查。

**验证与期望**：复用 Validation 的 V1–V3；记录原始 win32 拒绝的 RED，以及原生机制与集成的真实输出，不把非 Windows mock 计作通过。

**回滚**：撤销整个 OS adapter/lease 闭环，Windows 恢复 fail closed；本项无 ACL/用户数据 mutation 可逆迁移。

## Validation and Acceptance

命令只在本计划分支工作树根定义一次；依赖按 frozen lock 安装，source 与包来自同一精确 head：

- V1（windows-2025 x64 原生）：`pnpm test:file tests/integration/harness-plugin-windows-private-data.test.js`。期望实际 Host 安全预置根读 seed、写事务/日志并重开；缺 root/DB/log、foreign owner、broad/null/unsupported DACL、危险祖先、unsafe inheritance、junction/reparse、hardlink/错误类型均拒绝、无 endpoint 且 sentinel 原样。barrier 在 helper 保有目录后尝试替换须被 OS 拒绝，dispose 后可 rename；abort/15s timeout/overflow/坏协议/启动失败/运行期 helper death 有界，无残留进程、句柄与 endpoint，path canary 不泄露。journal/wal/shm 以实际创建/清理观察验证，不为每个 API 添 mock。
- V2（darwin/linux）：`pnpm test:file tests/integration/harness-plugin-private-data.test.js`。期望现有 fd/ACL、不安全对象拒绝与卸载中止全部通过；明确平台限定，synthetic 协议测试不冒充 Windows。
- V3（原生 Windows 打包）：`pnpm --filter @harness-projects/app-harness-plugin build && pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-windows-artifact.test.js`。两个 Windows 测试入口共享原生 fixture，artifact 包装入口只从 dist/package 载入实际 Host apply，跑关键正例/拒绝/失效；期望无源代码 fallback、同源 helper、存储/log 在 lease 之前关闭。不得只 build 成功便称 packaged Host 通过。

GitHub hosted runner 默认管理员且 UAC disabled，协调者必须预置标准本地账户并在其 token 中跑 V1/V3，或以 restricted primary token（Admin SID deny-only、去特权、非 elevated）运行并准确称“受限 token”；另由受控 foreign SID/管理员预置 foreign-owner、grant 与 replacement 负例，不能在目标测试中自动提升。记录实际 User SID/token 属性、OS/image、Node、source SHA、耗时和产物摘要；fixture 权限不足即失败，不静默跳过。

协调者可用短期 qualification 分支 checkout 精确 PR source head 执行，测试代码必须在该 source head 原生运行。无需本机 Windows，不改 main Fast Gate 的含义；该证据限 Windows Server 2025/NTFS 机制，不能关闭 #646 全范围或代替 #647 Windows11 Desktop 人验。无完整原生与包证据保持 Draft。

## Progress

- [x] (2026-11-16 17:19 +08) 完成现行 Host 原始路径/owner/remote 生命周期调查，审查 A/B 与独立 native 机制报告。
- [x] (2026-11-16) 准备未接产品的同源 Reflection.Emit 机制探针、标准账户原生 fixture、实际 Host 语义 RED 与打包入口；本机 typecheck 与 59 项 POSIX 回归通过。Windows 测试在 macOS 明确 skip，待协调者的精确 source head 原生执行。
- [x] (2026-11-16) Batch 1 入场：真实标准账户证明 metadata、570–701ms 启动、原始目录 lease、journal/WAL/SHM 与 helper death/目录释放；唯一系统 conhost 来源和 1s 内退出已锁定。已据实修正过严 zero-child 断言，待最终 head 回归。
- [ ] Batch 1 整合：实际 Host/rawProfile/lease/worktree 已接线；synthetic 与 POSIX 回归完成，V1/V3 本产品 head、独立安全复核及远端精确 head/checks 待协调者执行；达标后 Ready，不合并。

## Surprises & Discoveries

2026-11-16：realpath 在 Windows 原始链检查前会消掉 reparse 证据；owner.stop 本身不撤 remote。PowerShell 5.1 Add-Type 可创建 compiler 子进程，Node kill 不是其整树回收证据，因此选择不编译的 Reflection.Emit。现有 SQLite 仍 pathname 打开，安全论证必须依靠整链 ACL + 保有目录 HANDLE + 安全 provisioning 前置，不能许诺 CRT fd 桥接。所有 Windows 机制仍待同源原生执行，本机调查不是验收。

2026-11-16：入场代码当前技术增删以最终 numstat 为准，尚未接产品 Windows 分支。fixture 在实际标准用户 token 检查 Admin membership 与 role 均为 false；foreign-owner 数据库由 qualification 管理员预置后交给 worker 只读验证，不在目标测试中提升。机制测试和 Host 正例分别运行，避免把现有 win32 拒绝误当机制通过。

2026-11-16：首轮标准账户 qualification 已创建并加载账户，但停在管理员 foreign-owner fixture 的 `Set-Acl` 模块自动加载失败，尚未运行 native helper 或实际 Host RED。父进程为 PowerShell 7、经 Node 间接启动系统 5.1，与 Microsoft `about_PSModulePath` 记录的继承搜索路径问题一致。启动边界移除任意大小写的继承值，只传系统 5.1 Modules；固定程序开始再钉到 `$PSHOME\Modules`。新增原生 cmdlet-origin 负控，效果仍待同源重跑确认。

2026-11-16：第二轮原生 run 在标准账户下实际执行 28 项（14 pass / 14 fail / 0 skip）；foreign-owner 预置成功，Admin membership/role 均为 false。实际 source/packaged Host 安全正例因原 guard 拒绝，取得语义 RED；独立机制仍报固定 `open`，不能把负例通过视作防护验收。原生日志另暴露 fixture 对既有 ACL 使用默认 All sections 导致 SACL privilege 请求，以及 5.1 inbox cmdlet 可来自系统 GAC/snap-in。Superseded（下一轮仍有 Provider SACL 请求）：先尝试 Owner/Access-only descriptor 写入；精确 cmdlet 类型 + Microsoft strong-name + Windows 系统 assembly 来源检查。Superseded（后续仍读到 203）：曾在 open 后立即缓存 GLE 并输出有限 phase/error；最终以单次 ImplMap + managed IL 为准；不把未知错误当 sidecar 缺席。

2026-11-16：第三轮 run 43851084879 在标准账户实际执行 28 项（15 pass / 13 fail / 0 skip），系统 cmdlet 来源回归已通过。native 失败定位为 `sidecar-open-other`，因此整链、plugin root、DB/log 已经走过；缺席 sidecar 的错误码仍不能可靠跨 PowerShell binder 读取。改用同一 Reflection.Emit 类型内的 managed IL wrapper，在 CreateFileW 之后原子保存 Marshal 缓存码至 out 参数，输出仅有限 phase 与 0–65535 数值。Owner/Access-only 设置仍无法阻止 Set-Acl 对既有 protected 对象请求 SeSecurityPrivilege，fixture 改直接 FileSystemInfo.SetAccessControl，保留已标记的 Owner/Access sections，绕开 Provider 的整份 descriptor 合并路径；不提升 worker。上述修正仍待同源 native 正控，不修改实际 Host 的 win32 拒绝。

2026-11-16：第四轮 run 43853289308 在标准账户下 25 pass / 3 fail / 0 skip，所有 21 个 unsafe fixture 已成功构造并通过拒绝；机制仍为 `sidecar-open-other-203`，两个实际 Host 正例仍是预期 RED。官方 Reflection.Emit/CLR metadata 源码显示先 DefinePInvokeMethod 会建立默认 ImplMap，后续 DllImport 伪属性再定义同一映射会遇 duplicate，无法覆盖 SupportsLastError；这可解释原子 wrapper 仍读取旧缓存。修为 DefineMethod 加 DllImport 伪属性一次性建立映射，CreateType 后从实际 ImplMap 回读唯一 import 的 SetLastError、EntryPoint、Unicode、Convention、PreserveSig 与 DLL，任一不符 fail closed。新增极窄原生 metadata 对照，记录旧/新路线布尔值；实际 Framework 结论以精确 head 重跑为准，不把 203 映射为缺席。

2026-11-16：run 43854637182 原生 metadata 对照实测 declared=true / legacy=false；机制启动 701ms，目录 rename 拒绝及 SQLite journal/WAL/SHM 已越过。剩余 child-count=1 的真实进程尚未识别，不据猜测放行。探针增加有界 Name、系统 conhost 来源布尔值与捕获子进程退出观察，将旧零 child 断言移至 helper death/目录释放之后，允许同一原生运行取得身份与回收证据；产品仍未接线。

2026-11-16：run 43855864802 证实唯一 child 为 conhost.exe 且真实系统来源匹配；570ms 启动后，helper.kill→失效→dispose→root rename→捕获 child 1s 内退出均越过，最后仅旧 zero-child 断言失败。该断言按证据改为仅接受最多一个确切系统 conhost，编译器/其它进程仍拒绝。产品接线后，新 synthetic RED→GREEN 覆盖 pending dispose 结算、正常 owner stop 不提前释放、每次 15s timeout 与 200 次独立响应预算；实际 Host 失效撤服务/注册的反向 mutation 从 [1,1] 残留变 [0,0]。同步 register 失败回归暴露 acquisition 快照过早，现仅启动期延至 microtask 登记当前 Promise，运行期仍同步撤端点。旧 metadata 对照调查代码在事实锁定后移除；产品实际 metadata fail-closed 与 native 正例保留行为反证。

## Decision Log

2026-11-16 17:19 +08 / 独立规格审查者：选择固定系统 helper + Reflection.Emit、目录 no-delete-share lease；理由是具备 object-bound SID/DACL/reparse 信息且不新增 ABI/编译子进程。固定文件只在安全根边界建立后释放检查 HANDLE；理由是避免阻止 SQLite journal 清理。允许 15s Windows startup 上限、要求实测；POSIX 3s 保持。采用精确 source head 的短期原生 CI，不依赖本机 Windows；保留独立 Desktop 人验。

## Idempotence and Recovery

准入仅读 metadata，不修改 ACL/owner/目录；重试须重新打开验证完整对象链，不复用失效 lease。dispose 共享同一 Promise，EOF/abort/异常均释放所有已获取对象；helper 意外退出进入根 dispose。所有 fixture 只操作自身临时根，管理员预置账户/对象由 qualification finally 清理，不碰用户数据。若机制/预算门失败，保留 Draft 与结构化原因，不提交空壳支持或自动创建替代根。

## Interfaces and Dependencies

私有 OS adapter 返回 `directory/logFd/dispose` 与失效通知，持有者是 composition；profile 原始值由 Host 传递，不能由 Project 配置重建。Win32 方法表限 CreateFileW/GetFileType/GetVolumeInformationByHandleW/GetFileInformationByHandle/GetSecurityInfo/GetSecurityDescriptorLength/GetFinalPathNameByHandleW/LocalFree/CloseHandle，SID/ACE 由 .NET typed API处理。必要的系统 native 调用须在原生 proof 核对签名、指针宽度与失败释放；不从本机更新 Host 实现推断固定 ABI。共享 CI 入口由协调者提供，#644 provisioning 的安全交接是独立后续。

## Outcomes & Retrospective

当前原生机制证据成立；产品接线已完成本机 synthetic/POSIX 验证，尚待同源原生 source/packaged Host 完整验收，不能标为已关闭 #643。未接受新的技术债；实施若必须延期维护/正确性风险，记录 `docs/exec-plan/tech-debt-tracker.md` 后重新审查闭环。若反射 helper 在安全性、15s 或 `<800` 上不成立，明确返回设计门，最小改动是重选可独立验收机制，不降低原 AC。

## Bottom Change Note

Change Note (2026-11-16 17:19 +08)：独立对抗 A/B/native 后建立初版；采用无 compiler 子进程路线，补全原始链、侧车继承、运行期 remote 撤回、普通/受限 token 与同源原生包证据。

Change Note (2026-11-16 17:34 +08)：保存后语义复核补入固定盘与卷根 identity 校验，防止盘符映射隐藏祖先；明确限额和 packaged Windows 共享 fixture 入口。

Change Note (2026-11-16)：建立原生入场探针与真实 Host RED；记录标准 token/foreign-owner fixture 分工、本机证据和当前未集成状态。

Change Note (2026-11-16)：synthetic 协议负控先复现重复 ready 未失效（RED），补 pending-response 门后通过；仅证明 Node 协议边界，不计 Windows 原生验收。

Change Note (2026-11-16)：记录原生首跑止于 fixture 的模块加载失败；隔离 PowerShell 5.1 模块环境并新增系统模块来源回归，未提前接产品 GREEN。

Change Note (2026-11-16)：修正原生 fixture 的 descriptor sections、系统 assembly 来源与 schema 合法探针行；协议显式 UTF-8 无 BOM，临时路径含空格/Unicode。增加 open 的有限阶段码与立即 GLE 缓存，产品仍停在机制门。

Change Note (2026-11-16)：记录第三轮 sidecar GLE 与 Set-Acl protected-object 症状，加入同进程 managed IL 原子捕获和 fixture 原生 .NET ACL 持久化；保留机制门与确切 errno2 缺席条件。

Change Note (2026-11-16)：锁定已通过的 ACL fixture，改为一次性建立 P/Invoke metadata 并回读所有关键 flags；加入 native 旧/新 metadata 对照，仍以正向机制 gate 控制产品接线。

Change Note (2026-11-16)：记录 native metadata/701ms/SQLite 正向证据，新增有限子进程身份与终止观察；console child 未实证前保持零 child 拒绝。

Change Note (2026-11-16)：将 Design 就地更新为当前单次 ImplMap、系统 conhost 例外和逐 request 预算；接实际 Host/rawProfile/worktree lease、完整根清理与 source/pack 共享闭环，保留本 head 原生验收待办。
