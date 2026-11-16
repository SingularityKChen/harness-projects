# PR #653 MMP 交付评审

评审日期：2026-11-16。目标：Windows LocalGit 仓库/工作树路径与重开；关联 #645。锁定 head `84892bfd0667427989fd57f26c7921cd1909c9cf`，base `ba27b24c7fbcc25fe30576cbf99ba73758233c80`（`main`）。执行上下文：检出本 PR 分支的 `.worktrees/windows-git-paths`。独立评审未修改产品/测试/ExecPlan/commit，未写 GitHub；本记录随 PR 合并。

结论：**首审 APPROVE（仅 P2/P3，无 P0/P1）**；修复复评见文末。本轮结论只覆盖上述 head 的 Windows 原生资格 + POSIX 回归，不替代 #647 的 Win11 Desktop 人验，也不代表 main 已支持 Windows。

## 锁定事实与边界

- 远端回读 head/base 与上述值一致；`isDraft=false`、`mergeable=MERGEABLE`、`mergeStateStatus=UNSTABLE`；单一提交；closingIssuesReferences=[#645]；reviews/comments/threads 均为空。
- 当前 head 的 `PR Fast Gate`、Verify、Browser、CodeQL、规则与 issue policy 成功；`Create review session` 失败是 #364 跟踪的评审端点问题；`matrix.check` 是同一 head 并发被取消的重复 Rule checks（后继运行 success）。两项均不在分支保护内。
- 原生证据独立回读：run `43861468716` job `133279097126` checkout `84892bfd`，16 pass / 0 fail / 0 skip；run `43853289308` job `133251063319` checkout `3091d4ab`，16 pass / 0 fail / 0 skip；组合 packed run `43859918857` job `133273723581` checkout `de5eebce`，1 pass、16 次真实只读 Git 调用。产品/测试树在 `3091d4ab` 与 `84892bfd` 之间只有文档差异；组合 checkout 的 #645 文件与 `3091d4ab` 内容等价。
- 安全前提：Windows 私有根/admission 本身归 #643（独立 PR #655）；本 PR 只证明 Provider/Host 的路径身份、argv Git、未知写恢复与生产 catalog 边界。
- 审查边界：本机无 Windows，原生用例的判别力由精确 checkout 的 run 日志与断言阅读支撑；PATH 形态网络卷/非 NTFS 卷的拒绝分支无原生反例（见 F1）。

## 风险矩阵（先建立，再逐层审查）

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 结果 |
|---|---|---|---|---|
| P0 | 数据、权限硬边界、发布面 | 七条不变量、canonical-root owner、事实所有权 | 实际 diff、依赖边、门禁 | 无；未新增第二路径权威或跨层依赖 |
| P1 | 越根创建/读取、大小写误合并、reparse 逃逸、未知写被当成功/自动重试 | 真实 Windows bind/create/reuse/restart、生产 catalog 与 packed 边界 | 原生判别用例、失败注入、POSIX 回归 | 无；字符串+原生元数据+对象身份三层准入闭环，17 项原生用例通过 |
| P2 | — | F2 每次读新增 PowerShell 探针冷启动，无延迟证据 | F1 网络卷/非 NTFS 拒绝分支无判别性用例（AC2 证据缺口） | 2 项，均非阻塞 |
| P3 | F3 超时只杀 git、hook 后代存活；F4 暂态 stat 错误可抛出；F5 保留名表缺 `CONIN$`/`CONOUT$` | F6 host 落根仍用大小写折叠 `path.relative`（既有、fail-closed）；F9 bind preflight 借道工作树解析器 | F7 组合证据组件 SHA 非组合提交祖先；F8 缺评审归档/AC 勾选；F10 PowerShell 运行期依赖无契约文档 | 8 项，均非阻塞 |

## 分层证据与结论

1. **路径准入**：`localGitPathProblem` 在 win32 拒绝非完整盘符、UNC/device namespace、ADS、保留名、尾随点/空白、`..` 写法；`windowsPathsArePlain` 用固定 stdin JSON 探针拒绝非固定 NTFS、generic reparse；落根用卷/文件对象身份（dev/ino，不折叠大小写）而非 `path.relative` 前缀；`sameFilesystemPath` 统一 create 冲突、holder、复用、写后回读与 `getWorktree`。四个读/分支入口与三个工作树入口逐次准入（`repositoryError` / `resolveWorktreePath`）。
2. **Git 边界**：argv-only 不变；30s 超时与 8MiB 输出上限把中断映射为 `interrupted`；未知写返回 `ambiguous_result`、读返回 `unavailable`，无自动重试；stdin 失败终止探针并等待进程完成。原生「真实 30s 超时后登记已落地」用例验证了 ambiguous 与不重试。
3. **产品闭环**：原生 run 覆盖真实 Git for Windows 的空格/Unicode/混合分隔符、case alias 复用、case-sensitive sibling 落根拒绝、junction/危险 namespace 在 Git 前拒绝、SQLite 丢失 ack 后重开与 production catalog/preflight/Core setup；组合 packed Host 证明本 PR 改动在组合中被真实消费。完整 Desktop Start Work/PR/CI 走查按 issue 归 #647。
4. **架构**：未改 Core 身份/存储；canonical worktree 根仍由 Host catalog `localGitRoot` 唯一拥有；Provider 不自选输出根，未新增公共抽象或平台包。
5. **issue #645 验收**：AC1 成立（真实 Git 创建/复用/冲突/重启、别名与混合分隔符）；AC2 大部分成立，网络卷/非 NTFS 子分支只有实现阅读证据（F1）；AC3 大部分成立（超时/未知写/argv），executable/encoding 无实际改动，属于「未复现即不改」的正确方向；AC4 成立（原生 + POSIX 回归）。

## 首审意见（全部非阻塞；inline 已随 review 提交）

### F1（P2，测试判别力 / #645 AC2）探针「非固定 NTFS / 网络卷」拒绝分支无判别性用例

`git-runner.ts` 的 `WINDOWS_METADATA` 用 `DriveType -ne 3 -or DriveFormat -ne 'NTFS'` 拒绝网络/非 NTFS 卷，但原生用例里的 UNC/device 输入全部先被字符串规则拒绝，没有任何用例走到该分支；删除该行后 Windows 套件仍 16/0/0。盘符形态网络卷（`Z:\repo`）只有这条路径能拒。修复方向：加「探针返回 false ⇒ Provider 返回 `invalid_input` 且零 Git 调用」的 POSIX 可跑判别用例（mock 平台与探针），原生盘符网络卷用例归 #646 原生 lane。

### F2（P2，产品闭环/延迟）每次 Windows 仓库或工作树操作新增一次 `powershell.exe` 冷启动

`repositoryError` 在每次读/分支入口各跑一次探针，`resolveWorktreePath` 在每个工作树入口再跑一次；PR 没有任何 Windows 读延迟测量。正确性不受影响，但 #647 Desktop 人验会遇到每次打开/刷新仓库多一次子进程启动。修复方向：在 #647/#646 补真实延迟测量并设上限；若超预算再考虑合并探针或对卷事实做有界缓存（缓存必须不削弱逐次准入），不在本 PR 猜优化。

### F3（P3，失败路径 / 文档精确性）超时只终止 git 进程，不终结 hook 后代

原生超时用例表明 hook 后代在 Provider 返回 `ambiguous_result` 后仍继续运行（测试清理须等它退出）。`execFile` 的回调仍受 30s timeout 约束（后代持有 stdio 时最多等到超时），因此「有界」对调用成立、对进程树不成立。ExecPlan 应写明：超时只保证 git 进程终止与 ambiguous 映射，hook 后代按孤儿接受，进程树终止不做（避免 adhoc）。

### F4（P3，失败路径）`windowsInsideRoot` 未捕获暂态 stat 错误

`deepestExisting` 对非 ENOENT/ENOTDIR 错误直接 throw，`windowsInsideRoot` 没有 try/catch；provider 与 core 调用点也不捕获，破坏「Provider 永远返回结构化结果」。修复方向：`windowsInsideRoot` 整体 try/catch → 拒绝（fail closed）。

### F5（P3，防御完整性）保留设备名表缺 `CONIN$`/`CONOUT$`

`localGitPathProblem` 的保留名正则覆盖 CON/PRN/AUX/NUL/COM1-9/LPT1-9，缺 `CONIN$`/`CONOUT$`。这些名字会交给 Git 并在建目录时失败（不越根）。修复方向：补正则与零调用断言（原生）。

### F6（P3，架构一致性，既有）host catalog 落根仍用大小写折叠的 `path.relative`

`host-providers.ts` 的 `localGitRoot` 仍以 `path.relative` 前缀判断允许根是否落在检出内；Windows 上该函数折叠大小写，与本 PR Design 拒绝该技法的口径不一致。两方向推演只出现 fail-closed（在外判成在内则拒绝），未发现可利用绕过。修复方向：归 #646/#338 统一改为对象身份，或在计划中注明它是失败关闭的粗筛。

### F7（P3，证据可复现性）组合证据的组件 SHA 不在组合提交祖先里

ExecPlan 写组合 source `de5eebce` 覆盖 `3091d4ab`/`5962f02d`，但这两个 SHA 不是 `de5eebce` 的祖先（组合分支另有提交链）。逐文件内容核对成立（#645 文件全同、#190 43/43 blob 全同），字面不可复现。修复方向：改写为组合分支的实际提交 SHA，或注明内容等价。

### F8（P3，交付流程）缺 `docs/review/pr-653-mmp-review.md` 与 issue 验收勾选

按 `docs/review/mvp-review.md` §4，本轮记录应随 PR 合并；#645 四条 AC 未勾选。本轮补本记录；AC 在合并回读后处理。

### F9（P3，边界复用）bind preflight 借道工作树解析器做 FS 探针

`host-repository-binding.ts` 用 `resolveWorktreePath(raw, {repositoryPath: raw, allowedRoot: raw})` 的结果只取 `.ok`，随后又 realpath；语义耦合且重复准入。仍 fail-closed（catalog + getRepository 兜底），修复可归 #646。

### F10（P3，运行期依赖）`powershell.exe` 依赖没有契约/文档护栏

Provider 只对 win32 使用固定探针脚本，但没有「只允许 git + 固定探针两个可执行文件」的契约测试或用户文档；企业 CLM/AppLocker/Dev Drive 用户只会看到 `invalid_input`。修复方向：契约测试与错误文案区分归 #646。

## 实际执行与结果

所有命令在 `.worktrees/windows-git-paths` 根执行；产品验证发生在锁定 head 上。

| 命令 | 观察到的结果 |
|---|---|
| `pnpm test:file tests/integration/development-local-git-windows.test.js` | 5 pass / 0 fail / 8 skip（native），含真实 32.8s 超时用例 |
| `pnpm test:file tests/integration/development-local-git.test.js` | 79 pass / 0 fail |
| `pnpm test:file tests/integration/harness-plugin-repository-binding.test.js tests/integration/harness-plugin-host-providers.test.js` | 24 pass / 0 fail |
| `pnpm run boundaries` | 9 pass / 0 fail |
| `git diff --check ba27b24c...HEAD` | exit 0 |
| `node scripts/rule-checks.mjs size ba27b24c` | 代码 421/1000，文档 115/1500 |
| `node scripts/rule-checks.mjs disclosure ba27b24c` | 机械扫描通过；人工五类目未见敏感值 |
| `node scripts/review-mutate.mjs`（M1 删除 repositoryError 准入；M2 删除 interrupted 优先；M3 删除 64KiB 上限；M4 stdin 失败不终止；M5 schema pattern 回退） | 5/5 KILLED（spec 在 /tmp，未落仓库） |

## 反例核对（原生断言 + 代码推演）

`C:repo`、`\repo`、UNC/`\\?\`/`\\.\`、ADS、`CON.txt`/`LPT1`、尾随点/空白、`..` 写法均在 Git 前拒绝；大小写敏感兄弟不合并且 sentinel 不变；junction/悬空 junction/junction 根拒绝；跨盘拒绝；丢 ack 重开后只写一次；超时 + 伪装 refusal 文本仍 `ambiguous_result`；探针 stdin EPIPE 终止子进程；64KiB 边界；旧 schema 拒绝 `C:\` 形态而新 schema 通过真实 SQLite。未验证：盘符网络卷/非 NTFS（F1）、`CONIN$`（F5）。

## 修复复评（2026-11-16，本轮修复后同 head 复核）

本轮按「可验证的最小根因」修复，未改 Git 协议、canonical root owner 或 POSIX 行为：

| 意见 | 处理 | 验证 |
|---|---|---|
| F1 探针 false 分支无判别用例 | 新增 `Windows repository admission rejects before any Git call when the native metadata probe says unsafe`：mock win32 平台与探针返回 `false`，四个入口全部 `invalid_input` 且记录 runner 零调用。真实盘符网络卷/非 NTFS 反例归 #646 原生 lane（计划已记录）。 | 新用例通过；变异「探针结果不再门禁」KILLED |
| F4 `windowsInsideRoot` 暂态错误可抛出 | 判定包 try/catch，任何 stat/realpath 异常一律返回 false（fail closed），Provider 契约不再被裸异常穿透。 | 既有 POSIX 回归与 typecheck 通过；win32 分支仅防御性收口 |
| F5 保留名缺 `CONIN$`/`CONOUT$` | `localGitPathProblem` 保留名正则补 `conin$`/`conout$`。 | 新增 `Windows lexical admission rejects foreign namespaces, aliases and reserved devices`（UNC/device/`..`/尾随点空白/ADS/drive-relative/forward-slash/CONIN$/CONOUT$ + 合法 Unicode 正控）；变异「去掉设备名」KILLED |
| F3 超时语义措辞 | ExecPlan Surprises 明确：30s timeout 约束回调和 git 进程，但不终结 hook 后代；孤儿后代按接受，不引入平台进程树逻辑。 | 文档核对 |
| F7 组合证据 SHA | ExecPlan 记录组件 SHA 不是组合提交祖先，按逐文件内容等价覆盖（本 PR 文件全同、#190 43/43 blob 全同）。 | 文档核对 |
| F2 探针延迟 / F6 host 落根粗筛 / F9 bind preflight / F10 PowerShell 依赖契约 | 写入 ExecPlan 风险与归口：延迟测量归 #647（Desktop 人验）与 #646（lane），host 落根对象身份统一归 #646/#338，bind preflight 复用与 PowerShell 契约测试归 #646。不在本 PR 引入未测量的缓存或重构。 | 文档核对 |

复评命令与结果：`pnpm test:file tests/integration/development-local-git-windows.test.js` → 15 tests / 7 pass / 0 fail / 8 native skip；`pnpm test:file tests/integration/development-local-git.test.js` → 79/79；`pnpm run boundaries` → 9/9；`pnpm typecheck` → exit 0；变异 M6/M7 → 2/2 KILLED。修复后的产品/测试树由 #646 之外的原生 lane 复跑（run 与 head 见 PR 正文；本记录所在 head 与复跑 source 的差异仅文档）。复评结论：**无 P0/P1，P2 已处理或明确归口，维持 APPROVE**。
