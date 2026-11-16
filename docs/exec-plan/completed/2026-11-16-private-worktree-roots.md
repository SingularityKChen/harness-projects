# 私有工作树容器 ExecPlan

> 状态：Completed（本地工程验收）；创建：2026-11-16；Iteration 11：2026-11-16—22（Asia/Singapore）
> 范围：#648 的 POSIX 插件自有容器与 canonical-root 第五布局；规范：根 `PLANS.md`。
> 上游：#338、#648；Windows 原生私有创建由 #644 承接，本项不接受 Windows 或 R1 发布。

## Purpose / Big Picture

用户执行 Start Work 后，插件自有 `worktrees` 容器及绑定摘要目录应保持 POSIX0700；重开不损坏现有工作树与执行身份。输出根经符号链接落入仓库检出的布局必须在准备目录及 Git 写之前拒绝。最小证据是实际 Host/catalog/LocalGit 在 umask022 下 fresh/reopen 的两层权限、内容保留及第五布局拒绝。

## Context and Orientation

`apps/harness-plugin/src/host-composition.ts` 从已准备的私有数据根计算 worktreesDir；`apps/harness-plugin/src/host-providers.ts` 的 `LOCAL_GIT_ENTRY` 为每个 binding id 计算 SHA-256 前16位摘要作为 allowedRoot。`packages/providers/development-local-git/src/paths.ts` 的 `resolveWorktreePath` 负责 canonicalize：展开现有祖先的真实路径，再补回尚不存在的尾部。catalog 继续比较 canonical allowedRoot 与实际 checkout 根，保证输出留在检出外。

现有 `preparePrivateProjectData` 只保护插件根、数据库、sidecars 与日志；真实 Git 自建的 worktrees/digest 在 umask022 下为0755，外层根已有0700，不能把模式差距描述为已复现跨 uid 泄漏。`tests/integration/harness-plugin-host-providers.test.js` 只持久覆盖四种布局，worktrees 或 digest 分量链接入 checkout 的第五家族当前已被生产守卫拒绝，但缺少持久回归。

`apps/harness-plugin/src/host-repository-binding.ts` 的 `preflightRepositoryBinding` 也调用 catalog.create 做绑定前只读探测。目录准备不能混入该调用；正式恢复挂载的 `restoreProviders` 才是本批激活资源的 owner。

## Design / Spec

选择在既有 Host 私有数据模块增加两层插件自有目录准备，沿用 uid、nofollow/fstat、ACL 检查、fd chmod 与所有权语义。在 `host-providers.ts` 将现有 digest 派生和 canonical/outside-checkout 判断提取为一个模块内 helper，由 catalog.create 的只读准入与 restoreProviders 的实际资源准备复用；不创建第二份 digest 或 canonical 算法。

仅实际默认生产 LocalGit entry 的挂载恢复顺序固定为同一 helper 验证输出根 → 准备 worktrees/digest → 构造并路由 Provider。只读 catalog probe 仍只验证和构造无写入 Provider，不准备目录；对 probe 增加无新容器/无伪摘要的反证。实际构造再次验证同一根可保留，避免去掉安全守卫。目录准备失败沿用 disabled binding 的结构化失败，不发布可写的该挂载。初版“相同implementationKey即拥有相同配置和目录政策”的假设已被真实组合消费者推翻：注入catalog entry可以使用相同键并拥有独立配置与allowedRoot；生产准备以默认entry对象身份限定，不能按键接管其它entry。

准备函数只接受 Host 明确选定的两层固定路径：逐层 mkdir(mode0700)，EEXIST 后以 O_DIRECTORY/O_NOFOLLOW 打开、fstat 确认真实目录与当前 uid、验证 ACL，再以 fd 收紧并回读0700。插件根必须已受保护，验证对象和修改对象相同；所有 fd 与 helper 子进程在成功、拒绝、超时均释放，共享既有有界 ACL 预算。foreign owner、link、非目录、不可验证 ACL 一律拒绝，不夺取 ownership。

重开可收紧当前 uid 拥有的真实插件目录本身；只修改这两层，不递归 chmod、不改 profile/repository/用户 checkout 或其文件。Git 后代可以保留正常 umask mode，跨 uid 隔离由已验证的私有祖先保证。同 uid 进程不在当前威胁隔离范围。第五家族参数化覆盖 worktrees-link 与 digest-link 指入 checkout；拒绝时不跟随链接做 chmod/mkdir，Git worktree 列表、checkout 状态与 sentinel 保持。

放弃 catalog.create 直接 mkdir：会使只读 preflight 出现本地副作用。放弃向 LocalGit 注入公共安全钩子或改 Provider 默认 mode：插件目录政策属于 Host，且 POSIX mode 不能证明 Windows DACL。放弃重写现有 canonical guard：缺的是回归证据。

保持 Host 单一权威、规划/工程正交、Provider ack/reconcile 前非权威 Saved、credentials-as-handles、持久身份与事务语义。无公共接口变化、迁移、旧数据兼容分支、数据修复或新原生依赖。win32 继续明确拒绝；Windows 等价由 #643/#644 的原生机制证明。

## Global Constraints

本闭环 owner 独占 `apps/harness-plugin/src/host-private-data.ts`、`apps/harness-plugin/src/host-providers.ts`、`tests/integration/harness-plugin-private-data.test.js`、`tests/integration/harness-plugin-host-providers.test.js`、`tests/integration/harness-plugin-repository-binding.test.js`。最后一个测试仅在既有绑定夹具补只读预检反证；优先合并到现有用例，不复制种子。

文档只含本计划（完成后同名移入 completed）与协调者维护的 `docs/README.md` 索引。`host-composition.ts`、LocalGit Provider、ACL 原生实现和 artifact 测试不修改；若事实要求越界，先由协调者修订 owner，避免与 #649 共享写入。

技术 additions + deletions 目标 280–460，上限500，包含测试/配置/fixtures/替换删除；每 PR 技术≤800、文档≤1300。不能为预算删安全反例或机械拆连续逻辑。只用临时根/仓库/SQLite，不改用户项目或外部平台；不合并、不写 Planning Status/native blocking。

## Plan of Work

### Task 1 / Batch 1 · 两层私有目录与第五布局闭环

**最小闭环**：真实 Host+LocalGit 创建和重开均保0700及用户内容；第五布局拒绝无 Git 写，绑定预检保持只读。

**涉及主文件**：`apps/harness-plugin/src/host-private-data.ts`、`apps/harness-plugin/src/host-providers.ts`。

先复用既有 Host seed/临时 Git 夹具，新增 fresh umask022 的两层0700断言，确认旧代码 RED 来自0755；finally 恢复进程全局 umask，避免并发污染。补 reopen 收紧并保留工作树文件 bytes/mode、数据库逻辑记录与身份的正控，以及 worktrees/digest link 和只读 probe 反证。第四/第五布局已有正确拒绝可直接 GREEN，不人为改坏守卫。

按 Design 实现私有 helper 与实际恢复接线，避免重复路径政策。先执行 V1 再 V2；独立审读 fd/ACL、EEXIST、拒绝先于写入、资源释放与只读 probe 证据。更新 Progress/实际结果；协调者归档/索引并整理提交，保留初始 plan-only 与最终实现的可审阅提交，不产生 debug/fixup。

**验证及期望**：复用 Concrete Steps 的 V1–V4。新 fresh 用例先 RED、修复后 GREEN；第五家族拒绝与 safe external-root 正控持续通过。**回滚点**：撤销本批代码和测试；已收紧目录继续私有，不自动放宽 mode、不删除现有目录或数据。

## Concrete Steps

在检出 `fix/private-worktree-roots` 的工作树 `.worktrees/private-worktree-roots` 根目录运行；依赖沿用冻结锁文件。命令只在本节定义。

- V1：`pnpm test:file tests/integration/harness-plugin-private-data.test.js tests/integration/harness-plugin-host-providers.test.js tests/integration/harness-plugin-repository-binding.test.js tests/integration/development-local-git.test.js tests/integration/harness-plugin-change-request-operation.test.js`；期望 fresh/reopen 两级0700，link拒绝无写、preflight无目录副作用，原POSIX及LocalGit控制和注入catalog的真实PR消费链全部通过。
- V1b：`pnpm test:file tests/browser/workspace-execution.test.js`；期望真实组合浏览器消费链的Start Work、fallback、PR及分配恢复全部通过，无业务网络和模型调用。
- V2：`pnpm typecheck` 与 `pnpm test:file tests/integration/harness-plugin-artifact.test.js`；期望类型及实际打包Host回归通过。包依赖无变化，不另扩边界测试；出现新边界风险再扩大。
- V3：`pnpm test:file tests/contract/content-placement.test.js`；期望文档位置及引用通过。
- V4：`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`；期望退出0；人工检查凭据、本机身份、账号个人信息、内部系统、保密字样及实际A+D。

交付 owner 最终push后在本检出用显式仓库参数回读PR当前head/base、所有checks、issue关联与review threads；只有该head Fast Gate通过才Ready，交由人类评审，不合并。

## Validation and Acceptance

V1 证明实际权限边界、重开不损坏内容、拒绝先于副作用及预检只读；不能只测 helper 或只断言stat0700。正控须经过实际 catalog+Start Work 并读回ready；拒绝场景须无新增context/linked worktree，repository与unrelated sentinel的bytes/mode不变。fd/ACL拒绝分支复用现有最小fixture，不复制全安全矩阵。V2证明实际Host打包入口仍可工作；V3–V4保护文档与公开面。

本项可关闭 #648 的明确 POSIX 剩余范围，PR必须写明原生Windows等价仍由 #644承接；不自动关闭 #338、#642 或宣称Windows资格。若验收者要求Windows等价作为 #648关闭前提，使用Refs并保留Issue，不删该门来伪造关闭。

## Progress

- [x] (2026-11-16 14:46 +08) 比较两份独立方案，核对真实catalog、preflight与私有数据路径，裁决只读/激活边界。
- [x] (2026-11-16 14:46 +08) 本分支初始基线 V1中的host-providers文件14通过、0失败；未新增权限回归。
- [x] (2026-11-16 +08) Task 1 / Batch 1 本地实现：生产 Host + Git 的 fresh RED 为两层0755，GREEN 为0700；重开保留用户文件、身份与执行关系；第五布局和只读 probe 通过。V1 162通过，V2 typecheck退出0、真实安装件29通过；V3–V4证据见 Outcomes。
- [x] (2026-11-16 +08) 修复协调者全量组合发现的entry归属回归：原有失败单测RED→GREEN，扩展V1 184通过、V1b浏览器21通过，typecheck退出0、安装件29通过；自定义catalog夹具与原失败用例未修改。
- [x] (2026-11-16 15:20 +08) 独立修复复评通过，当前无未解决P0–P3；本地工程归档与索引完成，最终Ready继续受当前head回读规则控制。

## Surprises & Discoveries

2026-11-16 @ 初始基线 `8ace55af`：第五布局已经由canonical守卫拒绝；测试文件“四种形状”注释不能证明当前绕过。独立设计者真实Host+Git探针得到root0700、worktrees/digest0755；外层已有隔离，因此修复是既定显式模式合同，不是新证实泄漏。独立代码审读发现catalog.create也用于preflight，直接加mkdir会推翻只读约定。

2026-11-16 @ `fix/private-worktree-roots`、`.worktrees/private-worktree-roots`：实际绑定现在会在激活时创建空摘要目录，原恢复测试需先移除该测试自建的空摘要再注入链接；这不是产品修复逻辑。catalog probe 在首次绑定前没有容器，重验证时也不新增摘要。

2026-11-16 @ 首版本地实现：协调者组合 `pnpm verify` 揭示窄V1遗漏的真实消费链回归；本owner独立复现既有 `Host final assignment denial` 用例在PR结果处actual failed、expected confirmed。`composed-execution-platform.mjs` 的LocalGit entry配置为 `{}`、构造返回已配置port，初版restore按键强制读取repositoryPath而禁用挂载，Start Work失败向后传播。协调者提供main对照通过；本owner既有失败用例先RED、限定entry identity后GREEN。

## Decision Log

2026-11-16 14:46 +08 / 独立spec评审、协调者确认：保留模块内唯一输出根helper，将目录准备归restoreProviders实际激活，catalog只读。理由：避免伪probe目录、第二路径owner与公共Provider钩子，同时使安全检查先于目录/Git写。

2026-11-16 14:46 +08 / 独立spec评审：本批只承诺现有POSIX边界，win32继续fail closed。理由：0700不能替代真实DACL/对象绑定；#644已有原生生命周期owner，不建立假兼容路径。

2026-11-16 / 集成回归修正、协调者确认：生产目录政策仅在 `entry === LOCAL_GIT_ENTRY` 时执行。同键注入entry拥有自己的配置与allowedRoot；不新增activation协议或通用生命周期框架。既有preflight测试直接用t.mock.method观测真实默认entry，保留actual prepare与只读断言，不用wrapper替换该owner；原composed夹具与回归用例保持不变。

## Idempotence and Recovery

准备可重复；合法既存目录只收紧自身mode并保内容，部分成功后不递归删除或回滚成宽权限。遇foreign/link/异常对象立即拒绝并关闭本次fd，保持外部sentinel；Git未调用时不需要补偿写。所有测试自行清理仅本次创建的临时根。代码回滚保留已有安全mode；需要修复未知数据/所有权时停止，不能偷改祖先或接管对象。

## Interfaces and Dependencies

仅使用Node POSIX fs fd能力、既有ACL验证、Git argv及Storage/Host现有契约，无新包和凭据。受保护父目录与current uid是前提。`restoreProviders`拥有实际激活，catalog/helper拥有路径派生，私有数据模块拥有对象验证和mode；LocalGit只消费允许根。后续#643/#644需在本闭环后串行接入同一安全owner。依据 [Node fs.chmod 官方文档](https://nodejs.org/api/fs.html#fschmodpath-mode-callback)，Windows只能调整写权限，未实现owner/group/others权限区分；本项0700证据只覆盖当前支持的POSIX平台，不能替代#643/#644的Windows原生机制。

## Outcomes & Retrospective

本批在 `fix/private-worktree-roots` 的工作树完成两层0700、fresh/reopen内容与身份保留、canonical第五家族拒绝及preflight只读。原V1在加入真实PR消费链后扩为184通过；工作台浏览器消费链21通过、typecheck退出0、实际打包Host29通过、文档位置5通过。最初的0755反例先RED、修后GREEN。

组合验证暴露按implementationKey强加默认配置的P1；默认entry身份限定修复后，原PR确认用例恢复GREEN，原composed夹具及失败用例不变。独立修复复评确认真实默认prepare未绕过、自定义catalog保留配置/输出根、拒绝无路由且fd释放；当前无未解决P0–P3，无必要重构。实际系统证据为Darwin；win32继续fail closed，Linux/Windows原生资格不由本批测试推断。SSR渲染警告未改变该责任面。

本地工程验收、归档和索引已完成；PR #651 的当前head/checks/Ready由Concrete Steps的最终回读规则控制，不能从归档推断发布接受。没有新增技术债；原生Windows工作仍由既有责任项承担。

## Artifacts and Notes

本计划与持久回归共同保留RED/GREEN、真实Host与打包入口、失败恢复及独立复评的最小证据；临时输出不构成正式文档依赖。计划已归档，PR当前状态由交付回读确认。

## Bottom Change Note

Change Note (2026-11-16 14:46 +08)：综合两份方案后创建；修订catalog副作用位置，明确只读预检、两层安全owner、POSIX范围和独立回滚。

Change Note (2026-11-16)：完成两层fd私有准备、唯一根helper与实际激活接线；记录fresh RED/GREEN及本地V1–V2证据，独立验收与远端交付保持未勾选。

Change Note (2026-11-16)：记录窄V1遗漏的真实组合回归与被推翻的key假设；默认entry identity限定生产目录政策，扩展既有消费链验证且不改composed夹具。

Change Note (2026-11-16 15:20 +08)：记录独立P1修复复评和最终本地工程验收，归档并更新索引；当前PR门禁仍以远端回读为准。
