# PR #655 MMP 交付评审

评审日期：2026-11-16。目标：原生 Windows 重开已安全预置的私有项目根；关联 #643。锁定 head `d25f938d7d02d6ca3e7988d3992036c5d61c2cfd`，base `ba27b24c7fbcc25fe30576cbf99ba73758233c80`（`main`）。执行上下文：检出本 PR 分支的 `.worktrees/windows-root-admission`。独立评审未修改产品/测试/ExecPlan/commit，未写 GitHub；本记录随 PR 合并。

结论：**首审 APPROVE（仅 P2/P3，无 P0/P1）**；修复复评见文末。该结论只覆盖「已安全预置根的重开」闭环；首次创建、更广原生 CI 与 Win11 Desktop 人验分别归 #644/#646/#647（保持独立）。

## 锁定事实与边界

- 远端回读 head/base 与上述值一致；`isDraft=false`、`mergeable=MERGEABLE`、`mergeStateStatus=UNSTABLE`；单一提交；closingIssuesReferences=[#643]；reviews/comments/threads 均为空。
- 当前 head 的 `PR Fast Gate`、Verify、Browser、CodeQL、规则与 issue policy 成功；`Create review session` 失败是 #364 跟踪的评审端点问题；`matrix.check` 是同一 head 并发被取消的重复 Rule checks。
- 原生证据独立回读：run `43861210587` job `133278210021` checkout `6c9ac4ce`，66 pass / 0 fail / 1 skip，startup 589ms；同 run 组合 job `133278210401`（`3b83c4bb`）1 pass、16 次只读 Git；最终 head run `43862514293` job `133282676995` checkout `d25f938d`，66 pass / 0 fail / 1 skip（唯一 skip 是 artifact 的 POSIX 首次创建场景），空目录对照 `{"131200":true,"131201":false}`、唯一子进程为系统 `conhost.exe` 且随 helper 退出。产品/测试树在 `6c9ac4ce` 与 `d25f938d` 之间只有文档差异。
- 安全/威胁边界（计划与 PR 一致）：隔离其它非受信 OS SID；同 SID、SYSTEM/Administrators/TrustedInstaller 等明确 OS 管理主体、以及安全 provisioning 之前已持有的恶意写句柄不在威胁范围。目录 lease 用 no-SHARE_DELETE 句柄；固定文件 probe 在整链边界形成后释放。
- 审查边界：本机无 Windows，原生判别力由精确 checkout 的 run 日志、诊断输出与断言阅读支撑；未在本机执行 PowerShell PROGRAM。

## 风险矩阵（先建立，再逐层审查）

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 结果 |
|---|---|---|---|---|
| P0 | 私有内容读取前放行、发布权威、凭据/路径泄漏 | 七条不变量、Host 权威、无公共 ABI/依赖变更 | 实际 diff、依赖边、门禁 | 无；Windows fail-closed 保留，POSIX 路线未改 |
| P1 | 任何非受信 SID 可在私有一致性上读写、对象替换、权威在验证前发布 | 真实 Host apply/reopen/SQLite/日志/撤权、Storage→log→lease 顺序 | 原生正/负控、helper 死亡、取消/超时 | 无；原始链逐段 HANDLE 校验 + 目录 lease + 原生 66 项（含 foreign owner/21 类不安全对象/helper death） |
| P2 | F1 路径词法/卷根拒绝分支无测试 | F2 与 #644 的 protected-vs-inherit 契约未对齐；F3 profile 目录私有性归属未明 | 路径拒绝列表在计划中声称已验证但无判别用例 | 3 项，均非阻塞（产品范围外前置） |
| P3 | F4 dispose 超期 kill/startup 15s/顺序断言条件化未测 | F5 原生 lane 不在 main、绿色为手工 commit status | F6「既有 skip」措辞；F7 长期句柄副作用未入风险；F8 变量遮蔽/IL 注释/共享 prelude | 5 项，均非阻塞 |

## 分层证据与结论

1. **路径与对象身份**：原始 profile 路径在 realpath/normalize 前进入 helper；只接受本机固定 NTFS、完整盘符路径；逐段 CreateFileW（OPEN_REPARSE_POINT + BACKUP_SEMANTICS、share 不含 DELETE）后用 GetFileType/GetVolumeInformationByHandleW/GetFileInformationByHandle/GetSecurityInfo 只查刚打开的 HANDLE；卷根用 GetFinalPathNameByHandleW 的 volume-GUID 核对以拒绝 subst 隐藏祖先；reparse/hardlink/非普通对象/外来 owner/broad ACE/null/callback/object ACE 均拒绝。
2. **DACL/继承**：只接受可解释 CommonAce allow/deny，按数值 mask/flags/SID 判定并展开 generic rights；private 对象拒绝任何非受信 allow（含 inherited/inherit-only）；祖先只禁危险写权限位（卷根允许 CreateSubdirectory 例外）；plugin root 要求 protected DACL + 当前 owner 的 OBJECT_INHERIT allow；DB/log 必须已存在、私有、nlink=1，sidecar 可缺省。
3. **生命周期/权威**：helper 用固定系统 PowerShell 绝对路径、清 PSModulePath、UTF-8、固定 token 协议、有界输入/输出/超时；租约失败/取消/请求超时/helper 死亡都撤回完整 Host 权威；关闭顺序 Storage→log→lease，owner 正常停止只 quiesce，超期才 kill helper。
4. **产品闭环**：原生 `positiveHost` 走真实 Host apply → 读取工作区 → 安装执行绑定 → 写日志 fd → 目录 rename 被 lease 拒绝 → SQLite 探针 → dispose 后重开保留数据与日志 → helper 死亡后端点全部卸载；拒绝场景断言无 endpoint、无 sentinel 变更、错误文本不含路径。
5. **issue #643 验收**：AC1 成立（机制选择与重估记录在 ExecPlan Design/Decision Log；729 技术行在 600–800 forecast 内）；AC2 成立但 profile 目录私有性归属未明（F3），worktrees/digest 的 protected 要求与 #644 继承策略未对齐（F2）；AC3 成立（原生 21 类不安全对象 + foreign owner + lease 反例）；AC4 成立（参数安全、固定 token、结构化 failure、句柄/进程回收）；AC5 成立（真实 Windows 正/负临时根、拒绝无端点、POSIX skip 显式、synthetic 用例显式标注）。#644/#646/#647/#642 均保持独立、未被越界关闭。

## 首审意见（全部非阻塞；inline 已随 review 提交）

### F1（P2，测试判别力 / #643 AC3）路径词法、卷根与非 NTFS/网络卷拒绝没有判别性用例

计划/PR 声称拒绝 UNC/network、device namespace、ADS、`.`/`..`、尾随点/空白、8.3 别名、drive-relative、非固定盘/非 NTFS、subst 隐藏祖先，但原生 67 项里所有 `prepareWindowsProjectData(profile)` 输入都是 fixture 生成的 `C:\Users\<user>\harness-admission-…\profile` 形态；`corrupt()` 负控只覆盖 ACL/链接/对象类型，不含路径词法；合成协议测试不执行 `PROGRAM`，无法判别 `Lexical`/volume-GUID 逻辑。删除这些检查现有测试不会失败。修复方向：补原生用例（win32 skip 语义不变）——`\\server\share\x`、`\\?\C:\…`、`C:\a\..\b`、`C:\a\b.`、`C:\a\b `、`C:\a\b:ads`、`C:\a\PROGRA~1`、`C:foo` 全部 `assert.rejects(denied)`；`subst X: <temp>` 映射后断言 denied（finally 清理）；加普通临时根 admit 的正控与「祖先 inherit-only 危险 ACE 仍 admit」正控（杀死 `AceFlags -band 8` 变异）。

### F2（P2，契约一致性 / #643↔#644）worktrees/digest 要求自身 protected DACL，与 #644「继承」策略未对齐

helper 对 plugin root 与 worktrees/digest 都要求 `SE_DACL_PROTECTED(0x1000)` + owner 的 OI 全权；受保护父目录里普通 `mkdir` 创建的子目录会继承 ACE 但自身不是 protected，因而会被 `inheritance` 拒绝。fixture 对每个目录逐个 `setAcl`（`D:P`）掩盖了这一点。安全上 fail-closed，但 #644 AC3 写的是「descendants and new Git-created entries inherit the demonstrated policy」，若按字面实现会出现「预置成功但重开不可用」。修复方向：在 #644 的 ExecPlan/AC 明确 provisioning 必须对 profile/root/worktrees/digest 逐对象显式设 protected DACL（或由 #644 owner 决策放宽为 no-untrusted-effective-grant），并在本计划记录该接口约定。

### F3（P2，产品闭环/归属）`profileContext.dir` 私有性没有 owner，真实 launcher 创建路径未验证

helper 把 profile 目录本身纳入 private 集合（owner=当前 SID、无任何非受信 allow），而原生证据中的 profile 由 fixture 显式 `D:P` 预置；#644 AC1 要求「fresh normal-user Windows profile 无需手工 ACL 即可启动」，但当前没有 issue 明确拥有把 launcher 创建的 `profileContext.dir` 私有化这一步（#644 Notes 还要求不递归改 profile）。若真实 Desktop profile 目录带 `Authenticated Users`/`CREATOR OWNER` 等继承 ACE，当前实现会拒绝启动（fail closed）。修复方向：在 #644/#647 前做一次原生事实采集（普通 `mkdir` 创建 profile 后 `icacls` 快照），并明确私有化归属；本 PR 记录为交接前置。

### F4（P3，失败路径）dispose 超期 kill、startup 15s 预算与关闭顺序断言缺少判别性

合成 dispose 用例的 helper 收到 `close` 后都会退出，没有「忽略 close 必须被 deadline kill」的用例；startup 15s 只有目录请求超时用例；`positiveHost` 的 Storage→log→lease 顺序断言在 `if (current.fd !== undefined)` 内，fd 捕获失败会静默跳过。修复方向：加「helper 忽略 close → dispose 在 deadline 内 kill 并 resolve」合成用例；把顺序断言改成 fail-closed。

### F5（P3，证据/流程）原生 lane 不在 main，PR 上的绿色是手工 commit status

`gh api commits/d25f938d/check-runs` 中没有 Windows 检查项；工作流在协调者分支 `test/windows-native-qualification`（`dd1f723c`），发布的是 commit status，不在 PR Fast Gate 聚合内；PR 的「独立复评」也无 GitHub review 记录。#646 跟踪 lane 入仓；本 PR 记录为可接受的过程状态，合并前由协调者保留可回溯 run/job 链接（PR 正文已有）与本评审记录。

### F6（P3，文档精确性）「既有 skip」措辞不准确

ExecPlan/PR 称唯一 skip 是「既有 artifact 的 POSIX 首次创建场景」，但该 skip 是本 PR 在 `harness-plugin-artifact.test.js` 新增的 `{ skip: process.platform === 'win32' }`（干净数据根首次创建归 #644）。语义正确，措辞应改为「本 PR 为 Windows 显式跳过 #644 首次创建场景」并注明 #644。

### F7（P3，产品影响记录）长期持有祖先目录 no-SHARE_DELETE 句柄未写入风险

Host 运行期间持有卷根、profile 全部祖先与 plugin root 的目录句柄（share 不含 DELETE），因此其它进程对 `C:\`、`C:\Users`、profile、插件根的 rename/delete 会失败直到 DSH 退出；空目录对照已证明 LIST access 是围栏成立条件。这是安全设计的必要代价，但未写入计划的「风险与回滚」，也未测 delete（只测 rename）。修复方向：计划风险节写明并加 RemoveDirectory 级负控。

### F8（P3，可读性）`$profile` 遮蔽 PowerShell 自动变量 `$PROFILE`；IL 段缺注释；fixture 复制 prelude 与产品可能漂移

建议改名 `$profilePath`、给 IL 段补调用约定/栈说明；「system 5.1 cmdlets」用例测的是 fixture 自己复制的 prelude，而非产品 `PROGRAM` 的 prelude，存在漂移风险。

## 实际执行与结果

所有命令在 `.worktrees/windows-root-admission` 根执行。

| 命令 | 观察到的结果 |
|---|---|
| `pnpm test:file tests/integration/harness-plugin-private-data.test.js tests/integration/harness-plugin-windows-private-data.test.js tests/integration/harness-plugin-artifact.test.js` | 104 tests / 97 pass / 0 fail / 7 skip（全部为 win32 显式 skip） |
| `pnpm test:file tests/integration/harness-plugin-host-lifetime.test.js tests/integration/harness-plugin-host-recomposition.test.js` | 30 pass / 0 fail |
| `pnpm test:file tests/integration/harness-plugin-policy-admission.test.js tests/integration/harness-plugin-host-authority.test.js` | 15 pass / 0 fail |
| `pnpm run boundaries` | 9 pass / 0 fail |
| `git diff --check ba27b24c...HEAD` | exit 0 |
| `node scripts/rule-checks.mjs size ba27b24c` | 代码 729/1000，文档 110/1500 |
| `node scripts/rule-checks.mjs disclosure ba27b24c` | 机械扫描通过；人工五类目未见敏感值 |
| `gh run view 43862514293 --job 133282676995 --log` | `ref: d25f938d`；66/0/1；startup 600ms；空目录对照与唯一 conhost 子进程符合 |
| `gh run view 43861210587 --job 133278210021/133278210401 --log` | `ref: 6c9ac4ce` 66/0/1；组合 `ref: 3b83c4bb` 1 pass |

## 反例核对（原生断言 + 威胁推演）

junction profile/root、hardlink db/log/sidecar、foreign-owner DB、null/callback ACE、inherit-only broad、ancestor DELETE_CHILD、direct-only root、wrong-type DB、missing root/db/log、helper 启动失败/未知输出/溢出/stderr、ready 后 helper 被杀、启动取消、目录请求取消/15s 超时——原生均按 fail-closed 且拒绝后无 endpoint、sentinel 不变。未验证：路径词法/卷类型拒绝（F1）、helper 无视 close 的 deadline kill（F4）、真实 launcher profile 目录 ACL（F3）、>MAX_PATH 长路径（残差）。

## 修复复评（2026-11-16，本轮修复后同 head 复核）

| 意见 | 处理 | 验证 |
|---|---|---|
| F1 路径词法/卷根拒绝无判别用例 | 新增原生用例 `native Windows path admission rejects ambiguous, foreign and substituted namespaces`：UNC、device namespace、`.`/`..`、尾随点/空白、ADS、8.3、drive-relative、forward-slash 在打开私有内容前全部拒绝；普通临时根正控 admit；`subst` 映射后断言被卷根身份校验拒绝（finally 删除映射）。真实非 NTFS/网络卷类型反例仍需 #646 lane 的真实卷。 | 原生 lane 复跑（run/head 见 PR 正文）；POSIX 上该用例按平台显式 skip |
| F4 dispose/startup/顺序断言缺判别性 | 新增 POSIX 可跑合成用例：helper 收到 `close` 后忽略并存活，`dispose(deadline)` 必须在 deadline 附近结算且 helper 被 kill（实测约 370ms 内、0 fail）。 | 合成用例通过（`synthetic lease dispose kills a helper that ignores close within its deadline`） |
| F2 protected-vs-inherit 与 #644 未对齐 | ExecPlan 记录接口约定：#644 必须对 profile/root/worktrees/digest 逐对象显式设 protected DACL（或由 #644 owner 决策放宽为 no-untrusted-effective-grant）；fixture 逐对象 setAcl 写法不变。 | 文档核对 |
| F3 profile 目录私有性归属 | ExecPlan 记录：真实 launcher 创建的 `profileContext.dir` 未做 Windows DACL 加固；若含非受信继承 ACE 会 fail closed；需在 #644/#647 前做原生事实采集并明确 owner（#644 Notes 要求不递归改 profile）。 | 文档核对 |
| F5 原生 lane 不在 main | ExecPlan/PR 正文记录：绿色是协调者分支的手工 commit status，不在 PR Fast Gate；#646 跟踪 lane 入仓，不写成 main 已支持 Windows。 | 文档核对 |
| F6 「既有 skip」措辞 | 明确该 skip 为本 PR 为 #644 首次创建场景新增（`harness-plugin-artifact.test.js`）。 | 文档/PR 正文更新 |
| F7 长期 no-SHARE_DELETE 句柄 | ExecPlan 风险认知记录：Host 运行期间其它进程对卷根/祖先/profile/插件根的 rename/delete 会失败；补 dispose deadline 反例。 | 文档与合成用例 |
| F8 `$profile` 遮蔽与 IL 注释 | 内嵌脚本变量改名 `$profilePath`，手工 IL 段补调用约定/栈说明；产品行为不变。 | 原生 lane 复跑；本地 typecheck/回归通过 |

复评命令与结果：`pnpm test:file tests/integration/harness-plugin-private-data.test.js tests/integration/harness-plugin-windows-private-data.test.js tests/integration/harness-plugin-artifact.test.js` → 106 tests / 98 pass / 0 fail / 8 native skip；`pnpm run boundaries` → 9/9；`pnpm typecheck` → exit 0。原生 lane 复跑（git-paths 与 private-data 双 job）结果记录在 PR 正文。复评结论：**无 P0/P1，P2 已补判别用例或明确交接，维持 APPROVE**。
