# Windows LocalGit 路径与重开 ExecPlan

> 状态：Completed；创建/完成：2026-11-16；范围为 #645 实现与资格证据，最终 PR 回读/Ready 由协调者执行。
> 范围：#645，原生 Windows 的仓库绑定、工作树创建/复用、读回与持久恢复。
> 规范：根 `PLANS.md`、`AGENTS.md`；上游：同仓 issue #645、#137、#340。

## Purpose / Big Picture

用户在 Windows 本地 NTFS 检出中，经生产 LocalGit Provider 绑定仓库，在 Host 指定根内创建工作树；分隔符或既有对象的大小写别名仍读回同一对象，重启也不会产生第二次写入。最小证据是实际 Git for Windows 的创建、别名复用和 SQLite 重开，以及危险路径在任何 Git 调用前拒绝。

## Context and Orientation

在 `fix/windows-git-paths` 检出执行本计划，隔离目录为 `.worktrees/windows-git-paths`。调查基线为 `ba27b24c`。`packages/providers/development-local-git/src/paths.ts` 已按字符串检查、最近存在祖先 realpath、落根的顺序准入；`provider.ts` 已解析 `worktree list --porcelain -z`，但创建冲突和 getWorktree 仍直接比较路径字符串。现有 `samePath` 只用于部分写后检查。`git-runner.ts` 已采用 execFile argv，有输出上限、无超时。

`apps/harness-plugin/src/host-repository-binding.ts` 负责绑定前只读验证；`host-providers.ts` 的 localGitRoot 是 Host 默认 catalog 的 canonical/digest 根拥有者。保持这两个职责，不能让 Provider 自选另一输出根。现有私有根 win32 拒绝另由 #643 处理；本项可独立通过 Provider 和生产 catalog 边界，完整 Windows Desktop 人验由 #647 承担。

## Design / Spec

只支持完整盘符绝对路径和在明确 repositoryPath 下解析的相对工作树路径，文件系统限定本机固定 NTFS。repositoryPath 与 allowedRoot 自身须为完整盘符绝对路径。Windows 字符串准入先于 realpath/Git：拒绝 drive-relative（如 `C:repo`）、当前盘根相对、UNC/network/device namespace、ADS、控制字符、`..` 分量、保留名和尾随点/空白。不得用 resolve 把含糊输入悄悄变成合法路径；保留合法空格与 Unicode。

在现有路径模块集中规范化和身份比较。已存在对象以原生 stat 的有效 volume/file identity（dev/ino，使用不丢精度的值）或经原生证据证明等价的 canonical identity 比较；大小写不靠全局 lower-case。Windows 的 path.relative 本身可能折叠大小写，不能单独证明 case-sensitive 目录中的落根。对已存在根，以目标最近存在祖先向上追溯的对象身份确认包含关系；不存在的尾部保留精确分量，不能证明大小写别名时保守拒绝。原生 case-sensitive sibling 反例必须阻止同名异对象被合并。所有 create/reuse、branch holder、写后验证和 getWorktree 共用这一判定，返回既有 canonical ref，不改 source-qualified ID 或持久幂等键。

对每个相关已存在路径分量拒绝 junction、symbolic link 和其他 reparse 属性；lstat.isSymbolicLink 不被视作能识别全部 tag 的证明。先在 Windows 证明 Node 是否暴露充分属性；若不充分，使用 Provider 私有固定 PowerShell 脚本，通过 stdin 有界 JSON 批量调用 .NET File.GetAttributes，仅读取数值 ReparsePoint 位及 DriveInfo 的固定盘/NTFS事实，未知/不可读即拒绝。脚本不动态编译、不写 ACL、不解释本地化文本，有限输入/输出与进程超时；不得从 Provider import App helper。该探针是路径元数据快照；Host 私有根的跨用户置换保护归其原有权威，本项不另造权限权威。

Git 继续 execFile('git', argv) 与 NUL porcelain；增加有界调用（上限 30s、windowsHide），读失败为 unavailable，可能已执行的写失败/超时为 ambiguous_result，交给现有 reconcile，禁止自动重试。仅对实际 Windows 复现修正 executable、CRLF/encoding 问题，不引入 cmd.exe、安装器或通用 PathService/ProcessService。只统一斜线字符串不能证明身份，整路径 lower-case 会误合并 case-sensitive 对象，均放弃。

## Global Constraints

唯一 owner 的写入集合：上述 Provider 的 `src/paths.ts`、`src/provider.ts`、`src/git-runner.ts`、`src/index.ts`，必要的私有 `src/windows-paths.ts`，`apps/harness-plugin/src/host-repository-binding.ts`；`apps/harness-plugin/src/host-providers.ts` 只改路径 schema 和既有 Provider 入口的 helper 再导出。测试使用 `tests/integration/development-local-git-windows.test.js`（新增）、`development-local-git.test.js`、`local-git-start-work-resume.test.js`、`harness-plugin-repository-binding.test.js`、`harness-plugin-host-providers.test.js`、`harness-plugin-artifact.test.js` 和既有 `local-git-fixture.js`；文档仅本计划及 `docs/README.md`。不得修改 #643 的 OS/lifecycle 文件和 #190 的身份/存储文件。

完整技术增删含测试、配置、移动/删除严格 `<800`，预测 430–720；文档 `<1300`。Native 属性探针、case-sensitive 反例和生产包证据都计预算，机制 spike 后重新按实际文件估算；超过时呈现最小闭环调整，不删负控或缩写安全逻辑。无实验旧版迁移、数据库修复、用户数据或 ACL mutation。CI workflow、校验规则与公共 CI 文档由协调者唯一 owner；本 PR 测试必须可在同一 source head 原生执行。

## Plan of Work

### Batch 1 · 本地路径准入到持久重开

**最小闭环**：生产 Windows LocalGit 的正确对象复用及危险输入零写入，连同实际 Host catalog/包边界可独立回滚。

**涉及文件**：Provider 的 `src/paths.ts`、`src/provider.ts`、`src/git-runner.ts`，以及新增的 Windows 集成测试；附属写入限 Global Constraints。

先以 V1 在真实 Windows 临时仓库复现原始字符串比较缺陷；fixture 同时提供 case-sensitive 同名异对象和危险 namespace/junction。用固定、有限的元数据探针证明 generic reparse 能被观察；无法观察或 native helper 超预算则在产品修改前回到设计门。随后集中 input/containment/identity，替换所有 worktree 匹配点，接入有限 runner。最后通过 Core/SQLite 真实 create→丢失 ack/读回→重开→复用，并以既有生产 catalog 和构建包入口验证绑定/read；不依赖模型、网络或 GitHub 凭据。V1/V2/V3 定义如下，分别证明原生行为、POSIX回归和包边界；完整差异计数后独立审查。

**验证与期望**：复用 Validation 中 V1–V3；RED 记录具体失败，GREEN 全部通过且无 synthetic 代替原生的计数。

**回滚**：撤销本闭环提交，恢复已有 Provider；不改变存储布局和仓库/run identity。

## Validation and Acceptance

所有命令在本计划分支的工作树根执行，依赖按 frozen lock 安装。下列命令各只定义一次：

- V1（windows-2025 x64 原生）：`pnpm test:file tests/integration/development-local-git-windows.test.js tests/integration/local-git-start-work-resume.test.js`。期望真实 Git 的空格/Unicode、mixed separator、case alias 正例；case-sensitive siblings 不合并；namespace/drive-relative/alternate digest/reparse/dangling/另盘拒绝在 Git 调用前且 sentinel 不变；未知写入恢复不二次执行。缺少 case-sensitive 或安全 fixture 能力即失败，不静默 skip。
- V2（原生 Windows 及代表性 POSIX）：`pnpm test:file tests/integration/development-local-git.test.js tests/integration/harness-plugin-repository-binding.test.js tests/integration/harness-plugin-host-providers.test.js`。期望原有绑定、根权威和错误分类通过；原生限定用例明确标记平台范围。
- V3（打包与依赖）：`pnpm --filter @harness-projects/app-harness-plugin build && pnpm test:file tests/integration/harness-plugin-artifact.test.js && pnpm run boundaries`。期望测试加载构建产物，生产 catalog 可读/绑定、没有 source fallback，无反向依赖。

协调者可在短期 qualification 分支 checkout 精确 PR source head 执行 V1–V3；记录 source SHA、runner image、Node/Git 版本与产物摘要。Workflow checkout 的源与被测包必须一致。#645 独立分支证明真实 `preflightRepositoryBinding → Core WorkspaceSetup → SQLite` 与 catalog；单分支 V3 只声称实际 package 构建/加载和 POSIX 回归。Windows packed Host 的真实读取/绑定须在临时资格分支组合 #643 与 #645 后执行，记录每个 PR 的 head/tree 和组合 source SHA，不改 PR 的 main base，不把组合结果写成 #645 独立启动成功。取得组合 packed 证据之前保持 Draft。此门已由 Outcomes 中精确组件的组合资格证据满足（2026-11-16）；它只证明该组合的 #645 消费链，不替代 #643 安全资格或未合并 main 的支持声明。Windows Server 2025 结果不等于 #647 的 Windows11 Desktop 人验，也不要求本机另有 Windows。

## Progress

- [x] (2026-11-16 17:19 +08) 完成 issue、现行 Provider/Host owner 与两独立方案审查，写入最终规格。
- [x] (2026-11-16) 完成 tests-only 原生判别夹具；POSIX 语法/恢复检查为 3 pass、7 个原生限定 skip，不计作原生 RED。产品保持调查基线，待协调者运行 Windows V1。
- [x] (2026-11-16) V1 原生 RED：`db91c1cd2f6d132cc020d22e827113acabb3d277`、windows-2025、Node 26.13.1/Git 2.56.0.windows.4；[run 43840846043](https://github.com/SingularityKChen/harness-projects/actions/runs/43840846043) 为 6 pass / 4 fail / 0 skip。属性与 case-sensitive fixture 通过，四个行为缺陷如预期失败。
- [x] (2026-11-16) 最小实现与 POSIX 回归完成：相关 Provider/Host/SQLite 测试 112 pass / 8 native skip；V3 构建成功、artifact 29 pass、boundaries 9 pass。原生 GREEN 与组合 packed 证据仍待取得。
- [x] (2026-11-16) 独立评审 F1–F4 已逐项复现并修复：四项最小测试先 4 fail 后 4 pass，含真实 default runner 的 30 秒超时；相关 Provider/Host 回归 88 pass，类型/构建/产物/边界通过。原生 `9cf1875` 的 run `43844819391` 为 10 pass / 2 fail；保留该失败记录，修正夹具契约后等待新头同源验证。
- [x] (2026-11-16) `fa4a378` 独立复评关闭 F1–F4；原生 run `43848500674` 为 14 pass / 2 fail / 0 skip，两个失败均为清理 afterhook 的 EBUSY，业务断言通过。按实际资源拥有顺序修正夹具：受控 hook 的完成/进程终结屏障先于目录删除，SQLite close 先于文件删除；产品实现未改。
- [x] (2026-11-16) 夹具 scoped 复评 T1 以两条成功路径断言关闭判别缺口：真实 worktree-add 必须带 interrupted，hook PID 必须是有效正整数。最窄真实超时和退出屏障本地 1 pass / 0 fail / 0 skip，约 32.6 秒；仍待新头原生回读。
- [x] (2026-11-16 10:58 UTC) 同源 Windows V1 GREEN：`3091d4ab16d36ddba2a74a8881f2a3f4da0c1997`、image `win25-vs2026/20261103.298.1`、AMD64、Node 26.13.1/Git 2.56.0.windows.4；[run 43853289308 / job 133251063319](https://github.com/SingularityKChen/harness-projects/actions/runs/43853289308/job/133251063319) 为 16 pass / 0 fail / 0 skip，真实 timeout 33,247ms，含清理无 EBUSY。F1–F4 与 T1 独立复评均 CLOSED，无新增问题。
- [x] (2026-11-16 11:42 UTC) Batch 1：V1 原生 GREEN、POSIX V2/V3、独立审查及精确组件组合的实际 packed Host 读/绑定均完成，组合边界见 Outcomes。
- [x] (2026-11-16) 完整 diff 预算、发布面扫描和本地文档收尾完成；交协调者整理最终提交并在 push 后独立回读 head/base/checks/issue/threads，再决定 Ready，不合并。

## Surprises & Discoveries

2026-11-16 `provider.ts` 现有 samePath 并未覆盖 getWorktree 和 create conflict；因此问题不是增加第二套 parser。当前 Node 的 Windows 路径字符串比较不足以单独表达 case-sensitive 文件系统身份，原生反例和对象包含判定必须一起收敛。尚未取得 Windows 产品证据，不把设计预测记为测试通过。最后一句 Superseded by `Progress` 的 `3091d4ab` 同源 GREEN 记录（2026-11-16）。

2026-11-16 原生 RED 显示 Node bigint Stats 提供有效且可区分大小写敏感 sibling 的 ino，但字段没有 generic reparse 属性；固定 PowerShell 数值探针的普通目录/ junction 属性分别为 16/1040。catalog 直接 create 绕过持久化 schema：额外真实 SQLite RED 证明原有 `/` 前缀规则拒绝完整盘符反斜线路径，须同时修正 schema。Host 的 Win32 生命周期阻塞归 #643，采用上面的独立/组合证据分工。

2026-11-16 独立评审证明非工作树 API 未过仓库准入、超时可被 stderr 误判成权限拒绝、探针 stdin 错误提前返回及输入按字符计量。已统一四个 API 的每次仓库准入，保留进程终止/输出超限标记优先于业务文本，stdin 错误终止后等 close，输入按 65,536 UTF-8 bytes 限制。

原生 Git 对同一目录下仅大小写不同的双工作树全路径拒绝登记，不用 `--force` 绕过；夹具改用大小写敏感的两个父对象及不同子名，并以已登记工作树与同根下 equal-folded 普通目录验证不能误合并。重开失败来自夹具误用新幂等键：`start-work.ts` 的 Ready 新键契约是 `existing_execution_task_not_sent`；原键才读回。保留既有 Core 契约，原键重开后再显式通过 Provider 别名读回同一对象，新键仍冲突且不二次写入，不添加无关 Execution 替身。

`fa4a378` 原生的两项 EBUSY 说明 POSIX 清理成功不能替代 Windows 句柄释放：Node afterhooks 实测按注册顺序执行，先注册 fixture rm 再注册 storage.close 会先删仍打开的 SQLite。30 秒 Git 超时也不保证任意 hook 后代已终结，正是写入保持 unknown 的原因；受控 timeout 夹具改用单个 Node hook 写 PID/完成标记，在先注册的有界条件屏障里确认标记且进程不存在后才清理，不盲等、不重试 rm，不引入产品进程树或 Host SDK 范围。

夹具 scoped 复评发现普通 hook 在写 PID 前失败也可得到保守 ambiguous_result，不能据此证明真实 timeout。成功路径现从真实 worktree-add invocation 断言 interrupted，并要求有效正安全整数 PID；setup 提前失败时的安全清理分支保持不变。

2026-11-16 MMP 评审：Windows Provider 每次仓库/分支读或工作树入口都会新起一次 `powershell.exe` 元数据探针（约数百 ms 量级），PR 没有 Windows 读延迟测量；归 #647 Desktop 人验测量并设预算，本计划不预设缓存优化（缓存不得削弱逐次准入）。

2026-11-16 MMP 评审：`execFile` 的 30s timeout 约束回调和 git 进程，但不终结 hook 后代；原生 timeout 用例证实 hook 在 Provider 返回 `ambiguous_result` 后仍运行（测试清理等待其退出）。因此「有界」只对调用成立，hook 后代按孤儿接受，不引入平台进程树管理。

2026-11-16 MMP 评审：原生探针的非固定 NTFS/盘符网络卷拒绝分支没有判别性用例（UNC/device 输入先被字符串规则拒绝）；已补「探针返回 false ⇒ Provider `invalid_input` 且零 Git 调用」的 POSIX 判别用例并在本地 KILLED 变异验证；真实盘符网络卷/非 NTFS 反例归 #646 原生 lane。

2026-11-16 MMP 评审：组合证据引用的组件 SHA 不是组合 checkout `de5eebce` 的祖先（组合分支链 `de5eebce → e79166c7 → ad1888b6 → ba27b24c`），按逐文件内容等价覆盖：本 PR 产品/测试文件与 `3091d4ab` 全同、#190 43/43 blob 全同。本记录已注明该口径，不把内容等价写成祖先关系。

2026-11-16 MMP 评审：host catalog 的 `localGitRoot` 仍用大小写折叠的 `path.relative` 粗筛允许根是否落在检出内（既有实现，本 PR 未改）；两方向推演只出现 fail-closed，未发现可利用绕过，统一改为对象身份归 #646/#338。

## Decision Log

2026-11-16 17:19 +08 / 独立规格审查者：保留当前 canonical root owner 与 argv/NUL 协议，只收敛已定位路径职责；理由是它们已承担正确边界。拒绝整路径 lower-case 与公共路径服务；理由分别是异对象误合并和无必要职责扩张。Windows CI 由协调者独占，same source head 验证即可，不把 #646 全范围塞入本 PR。

2026-11-16 / 协调 owner 与实现 owner：授权 Global Constraints 中的 Host schema/helper 小范围变更及 barrel 收窄，内部元数据/对象 helper 不意外公开；不改 #643 生命周期。最终 Ready 依赖组合 packed 证据，PR 保持 main-based、独立回滚。

## Idempotence and Recovery

临时仓库每次独立创建并在测试 finally 释放；重复 get/reconcile 只读事实。保留已有 operation ID，Git 未知写结果不得重发。超时结束进程并等待 close，fixture 清理只限所创建根；失败保留精简结构化证据。原始用户仓库和项目库不参与测试；合并前撤销提交即可恢复基线。

## Interfaces and Dependencies

Node、pnpm 版本遵守 `.nvmrc` 与 packageManager，Git for Windows 来自 runner。私有元数据协议有限 JSON、固定脚本/属性数值，路径只经 stdin，不能插入命令字符串。Host repositoryPath 与 allowedRoot 的 canonical/digest 权威不变。原生 CI 准入由协调者提供；#643 未完成时使用已有生产 catalog/Provider 入口和安全预置 fixture，不宣称完整 Host/Desktop 启动验收。

## Outcomes & Retrospective

原生 RED/GREEN 与独立复评均已建立：同源 `3091d4ab` 的 V1 全部通过，覆盖真实创建/别名复用、case-sensitive 身份与落根、危险路径/reparse、未知写入和 SQLite 重开，以及生产 catalog/preflight/Core setup。POSIX 相关行为、类型与打包边界检查通过。实际 packed 消费补证：[run 43859918857 / job 133273723581](https://github.com/SingularityKChen/harness-projects/actions/runs/43859918857/job/133273723581) 在组合 source `de5eebce8696d142407d7db7fae62ac07e05ec8d`、Windows Server 2025 AMD64、Node 26.13.1/Git 2.56.0.windows.4 下，以独立普通账号和预置目录加载真实 `apps/harness-plugin/dist/package/lib/index.js`，公开 bind/reopen 及三个 identity、selected primary、配置稳定性通过（1 pass / 0 fail / 0 skip；16 次 Git read、8 次远端 fixture 请求）。组件为 #643 `72c9206c1c52a9156cf4e469dc46bf156d00dff6`、#645 `3091d4ab16d36ddba2a74a8881f2a3f4da0c1997`、#190 `5962f02d7659ff78cb8554aeb71fb7d47a0d1c8e`；packed SHA256 为 `e3ded7b0f01aec940b33d8bb438b4d472b4ebcfa2c7d8ceee22b6cd7b9338d2f`。

#645 的实现与消费闭环据此完成，产品/测试树保持同源 qualified `3091d4ab`。该临时未合并组合不代表 main 已支持 Windows；#643 独立安全资格的 empty-digest lease 缺口仍由其 owner 处理，本计划不宣称 Windows 私有目录安全已获支持，也不关闭 #643/#644/#646/#647。未接受新的技术债；最终远端回读和 Ready 交协调者执行，合并由人类决定。

## Bottom Change Note

Change Note (2026-11-16 17:19 +08)：独立对抗 A/B 后建立初版；补全大小写敏感落根、generic reparse 和精确 source head 原生证据门，明确三 owner 写入边界。
Change Note (2026-11-16)：实现 owner 记录 tests-only 准备与 POSIX 检查，明确原生 RED 尚未取得。
Change Note (2026-11-16)：记录真正 Windows RED、schema 独立 RED 与最小实现；明确 Host 小范围 owner 及 main-based 独立/组合 packed 资格证据分工。
Change Note (2026-11-16)：记录独立审查四项 RED/GREEN 和原生两项夹具失败根因，统一 repository/process 边界并保持 Core 的既有重放契约。
Change Note (2026-11-16)：据原生 afterhook 错误和 Node 顺序探针修正资源释放屏障；产品树保持 `fa4a378`，等待同源原生清理验证。
Change Note (2026-11-16)：按 T1 scoped 意见补两条真实中断/启动断言并验证原超时用例，未改产品树或清理协议。
Change Note (2026-11-16)：回读精确 source 的 Windows V1 16/0/0 与独立复评关闭证据；保留组合 packed Host 门，计划不归档。

Change Note (2026-11-16)：核实实际 packed Host 精确组件组合的消费证据，完成 #645 计划并移入 completed；保留未合并组合与 #643 安全资格等独立边界。

Change Note (2026-11-16，MMP 评审修复)：补「探针 false ⇒ 拒绝且零 Git 调用」判别用例与本地变异验证；win32 保留 `CONIN$`/`CONOUT$` 设备名拒绝；`windowsInsideRoot` 对暂态 stat 错误 fail closed；记录超时只杀 git/hook 后代存活、探针延迟测量归 #647、组合证据按内容等价、host 落根粗筛归 #646/#338。
