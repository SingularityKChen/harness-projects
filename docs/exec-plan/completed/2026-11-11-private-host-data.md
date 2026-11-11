# 私有 Host 项目数据权限 ExecPlan

> 状态：Completed（独立工程验收通过；最终远端门禁以PR回读为准）
> 创建：2026-11-11；格式依据：根 `PLANS.md`。
> Issue：#597；检出：`fix/private-host-data`；初始基线：`main@063e427a`。

## Purpose / Big Picture

支持Darwin/Linux权限合同的Host从宽松umask首次打开、重开后，自有项目目录0700、SQLite与诊断常规文件0600；不安全路径在开库和发布remote前安全拒绝。最小证据是临时真实Host的mode、数据保留、无endpoint与生命周期断言。

## Context and Orientation

现有`apps/harness-plugin/src/host-authority.ts`从Host profileContext解析canonical路径。`host-composition.ts`以默认mode建目录，`host-diagnostics.ts`反复按path追加；SQLite可产生相邻sidecar。Storage继续拥有SQL/准入；Host壳拥有磁盘安全。#597是#338的剩余权限叶子，不代表父项、安装#599或R1完成。当前/下一迭代按用户2026-11-11授权取项，既有排期不变。

## Design / Spec

两份独立系统方案经第三位独立评审修订，选择apps私有`preparePrivateProjectData`，先核公开Host是否已有同等保证的primitive；没有则用Node fs。只处理canonical可信parent下的插件根、DB/log及已存在的-wal/-shm/-journal。profile parent须当前uid拥有且其它uid不可写；canonical祖先链只信任当前uid或OS root拥有的目录，group/other可写祖先仅在sticky且其下child由受信uid拥有时接受，避免其它uid重命名替换；只验证、不修改祖先mode，普通sticky `/tmp` 保持可用。同uid恶意进程不在隔离边界。根用nofollow目录fd、fstat uid/type，创建或fchmod0700并复核。常规文件用nofollow open/fstat要求当前uid、regular、nlink=1，再fchmod0600；新建不truncate旧文件。拒绝symlink/FIFO/device/hardlink/foreign owner，不递归chmod其它文件、不改全局umask。

生产`profileDataPath`验证canonical profile parent；受信Host直接注入composition时，后者只拥有已选dataDir及固定文件，既有临时composition fixture不把系统tmp当profile。根先私有再按既有路径开SQLite；边界针对其它OS用户，不声称隔离同uid恶意进程。诊断保留已验证append fd与原allowlist，写失败仍吞掉；fd在截止时间内的shutdown诊断之后关闭，失败/中止/迟到初始化也释放。截止后非合作remote disposer的迟到拒绝仍被消费，但不重开日志路径、不再追加诊断。首次安全gate失败以固定HostAuthorityError拒绝，不泄露路径、不注册remote。Darwin在profile/全部祖先、根、DB/log及存在sidecar的已验证fd上只读查询扩展ACL：只接受无ACL或deny-only，任何allow（含继承/only_inherit）与未知结果固定拒绝，不删除ACL。系统`/usr/bin/osascript`仅以固定JXA桥接libc typed ACL API，fd经stdio3..N传入，无pathname、身份文本、GUI或Apple Events；profile链批量一次，根先准入后文件批量，实际Host共三次查询。异步spawn单次1000ms/SIGKILL、输出1024bytes、单阶段3000ms单调时钟startup预算、最多64个目录fd及169个ACE；原owner signal立即取消查询，等待child close后finally释放fd；profile promise纳入原acquisitions，Host stop共享1000ms截止不扩大。Linux保留POSIX access ACL受chmod group-mask约束的合同；其它平台明确拒绝。生产journal mode不变；WAL/SHM保护必须真实临时SQLite取证。WAL fixture以Storage公开`CURRENT_SCHEMA_GENERATION`做同值header写入，真实建立sidecar且不改写seed的准入身份。

拒绝仅加mkdir mode（不覆盖重开/链接）、全局umask/递归chmod（越界）及通用ACL框架（当前无收益证据）。Node fs与SQLite官方临时文件合同指导验证，不从主库mode推断sidecar。

## Global Constraints

每PR技术新增＋删除严格小于800行，文档小于1300行，含测试、fixture、配置与删除；按实际base计量，不以net抵扣。保持Host权威、单Planning源、规划/工程正交、授权撤回、事务/revision与ack/reconcile。无正式发布兼容层、自动迁移/删库、真实安装或模型调用。只操作临时测试数据；不写Planning Status、Iteration或原生依赖。依赖及主题沿当前Host，不引入新库。

写集仅`apps/harness-plugin/src/host-private-data.ts`（新）、`apps/harness-plugin/src/host-private-acl.ts`（新，Darwin只读适配）、`host-composition.ts`、`host-diagnostics.ts`，必要时`host-authority.ts`传可信parent、`host.ts`沿用现有signal/acquisitions管理profile查询；`tests/integration/harness-plugin-private-data.test.js`（新）、既有host-authority最少断言、`tests/integration/harness-plugin-host-lifetime.test.js`的截止后日志合同断言、`tests/integration/harness-plugin-host-github-catalog.test.js`的预开日志扫描断言、`tests/integration/harness-plugin-host-providers.test.js`的data-root symlink提前拒绝断言；本计划及docs索引。技术工作上限730、docs180–300；公开API/Storage权限默认不扩张。

## Plan of Work

### Batch 1 · 安全根、文件与生命周期

最小闭环是生产Host从安全私有文件启动并可dispose/reopen。主文件为新的host-private-data与Host/日志接线。先新增真实临时profile/umask022红例，再实现descriptor校验/收紧、日志fd及中止清理，复用现有lifetime。用少量行为组覆盖新建/0755与0644重开/业务行与旧字节保留、unsafe entry外部sentinel不变、actual apply失败无remote且无path canary、真实WAL sidecar；foreign uid若只能合成须明确边界。

在检出`fix/private-host-data`的工作树根运行：

    pnpm test:file tests/integration/harness-plugin-private-data.test.js tests/integration/harness-plugin-host-authority.test.js tests/integration/harness-plugin-host-lifetime.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js tests/integration/harness-plugin-host-github-catalog.test.js tests/integration/harness-plugin-host-providers.test.js
    pnpm test
    pnpm typecheck
    pnpm boundaries
    pnpm --filter @harness-projects/app-harness-plugin pack:plugin

期望：先因默认权限/缺gate而RED，最终行为、类型、边界与包构建通过。回滚撤销整能力提交；安全metadata不主动放宽，数据不删除。

### Batch 2 · 独立对抗验收与交付

独立验收者审查owned-root/nofollow、链接/外部归属、启动中止与日志释放，基于新风险做最小反例。修订后重跑受影响命令，完成公开检查与当前head回读。

组合修订的最窄验证在检出`fix/private-host-data`（generation 3）与协调者的组合检出（generation 4）分别运行：

    pnpm test:file --test-name-pattern='real SQLite WAL and SHM' tests/integration/harness-plugin-private-data.test.js

期望两者均保留真实WAL/SHM及重建断言并通过；组合检出修订后的复验由协调者执行，不修改Storage准入或已完成状态。

## Validation and Acceptance

实测0700/0600、重开保留业务数据和日志旧字节；拒绝无外部sentinel副作用且无remote；WAL/SHM实际行为和日志fd释放有证据。复用Batch 1命令。包构建/本地Host不是安装接受；#338其余根布局证据和R1独立。

## Progress

- [x] (2026-11-11) 组合fixture修订：在自有`fix/private-host-data`、generation 3上，最窄WAL 1/1、私有数据文件组46/46通过；组合generation 4最窄WAL 1/1、组合`pnpm verify`4027项及实际Timeline浏览器3/3通过；独立fixture复评接受，Completed状态不变。

- [x] (2026-11-11 14:41 SGT) 完成当前Project/PR取证、两份独立设计及第三位独立修订，建立隔离检出。
- [x] (2026-11-11) Batch 1：draft关联后完成RED→GREEN；在本检出运行Batch 1全部命令通过，focused 50/50、受影响回归93/93、全套contract1554/integration2209/e2e226通过。
- [x] (2026-11-11) Batch 2：原ACL P1修复经独立scoped复评接受；原反例、deny-only/继承/fd绑定/超时与实际中止回收及65项定向证据通过。最终托管head/checks与Ready按本文规则读取，不以本地通过替代。

## Surprises & Discoveries

2026-11-11组合回归：在`.worktrees/iteration-release-combination`的`f19f5b0`读取并运行上述最窄命令，旧fixture为0/1，`IncompatibleDatabaseError`的expectedGeneration=4、actualGeneration=3；seed本已建好generation 4，硬码`user_version=3`将其降级。这里是fixture耦合，Storage拒绝正确；固定3的假设被公开代际常量取代，保留同值写入的真实sidecar证据。隐私自有检出以`28e16248`为修订基线，产品/apps树不变。

独立真实ACL反例推翻“0700/0600足以隔离其它uid”的早期结论（Superseded by Design / Spec，2026-11-11）：Darwin fchmod保留everyone allow，实际Host曾发布。`ls -L /dev/fd/3`只读fdescfs合成metadata、漏ACL，不能用于安全判定；改为`acl_get_fd_np`/typed ACE tag查询。首次全套ACL版contract1552/1554，两个Host UI fixture固定拒绝；计时复跑1554通过、6次query最大89ms且未复现错误码，因此未将timeout写成已证实原因。普通Host实测逐fd查询7次/193ms，批量后3次，当时保留250ms限额并减少重复桥接（Superseded by Decision Log异步startup预算，2026-11-11）。随后批量版全套contract1554通过、integration2211/2226；计时层825次查询确认除故意测试外仍有3次ETIMEDOUT。未截断诊断829次正常query的p95=93ms/p99=145ms/max191ms；诊断不是交付验证。实际abort红例证明同步等待会先超时再误报启动失败，补现有owner信号的异步取消与close等待后profile/root/file阶段全部释放。

全套首次contract1554通过，integration2206/2209；失败为catalog预开空日志的目录断言、providers链接数据根的旧准入、lifetime截止后写日志的旧合同，按Decision Log逐项更新后全套通过。初始化abort监听若保留至运行期会提前关闭日志并丢失remote截止诊断；实现交付composition时移除该启动监听，由Host统一dispose顺序管理。

基线检出`fix/private-host-data`在实现前authority/roundtrip/lifetime定向25/25通过；mkdir/append默认mode不足以满足重开。已发现sidecar须单独观察，不能假定主DB0600即覆盖全部。

## Decision Log

- Decision：2026-11-11 用户在本评审会话直接点名 PR#618–621，并授权无 P0/P1（或只有 P2/P3）时由本会话完成修复、独立复评、归档、提交整理、issue 核对与 `merge_method=rebase` 合并；该条件明确覆盖 #619。Rationale：原实施阶段禁止自行合并的约束由这条直接条件授权更新；Planning Status/原生依赖不在授权内。Date/Author：2026-11-11 / 用户、主审。

2026-11-11 / 协调者与实现者：组合验证发现WAL fixture耦合schema generation；只使用已公开的当前代际常量替代固定3，同值写仍用于创建真实sidecar。不改生产准入、不复制或推断代际、不重开Active；组合generation 4由协调者拷入同一测试blob复验。

2026-11-11 / 协调者与实现者：250ms是任意startup阈值，不是shutdown规范。批量后仍实测意外timeout，因此startup采用1000ms/query、3000ms/stage（实测正常max191ms约五倍余量）；必须异步沿原owner.signal中止并等close回收，profile获取加入原acquisitions。实际20ms卸载反例先RED再GREEN，既有stop共享1000ms保持不变。

2026-11-11 / 协调者与实现者：独立P1为根因级ACL准入缺口，保守拒绝全部Darwin allow ACE（即使主体受信）、允许deny-only；由只读OS C API绑定fd而非解析path/ls文本，无法可靠查询即拒绝。单独小模块承载平台适配，不引入依赖、ACL删除或权限修改。批量profile/fixed-file fd，保留根单独先验以建立私有namespace，不加池或跨生命周期缓存。代价是显式allow ACL、未知平台及不可用OS查询不支持启动。

2026-11-11 / 协调者裁决：将canonical profile祖先视为可信输入会遗漏非sticky可写祖先的重命名攻击，属核心缺口；先真实ancestor0777/profile0700红例，再仅增加只读祖先准入。root/current uid为受信owner，sticky须保护受信child；不改祖先mode、不扩成通用文件系统框架。

2026-11-11 / 协调者裁决：全套验证揭示两条旧合同需最小更新；catalog继续扫描全部文件及凭据阳性对照，接受安全空日志；providers仅数据根symlink改为开库前拒绝并保留外部数据库字节/逻辑不变证据。其余三形状与#338更广worktree路径边界保持原责任，不扩大完成声明。

2026-11-11 / 协调者裁决：截止后继续写迟到错误与有界fd生命周期不可兼得；选择保留截止内shutdownFailed与shutdownDeadlineExceeded、消费迟到拒绝且关闭后不重开日志。扩展写集仅为既有lifetime合同断言，仍由独立验收复核。

采用Host边界小模块而非改所有Storage默认权限，保留profile与SQL既有owner；理由是只有Host知道该目录属于插件。记录日期/作者：2026-11-11 14:41 SGT / 协调者，独立方案收敛后执行。

## Idempotence and Recovery

准备与验证可重复；失败关闭已获fd，未发布remote，保留旧数据。代码revert不自动放宽mode。所有破坏性修复都不在本计划；若实际Host primitive或平台合同推翻假设，先修改本计划及验证再继续。

## Interfaces and Dependencies

使用仓库Node/pnpm/Git/gh及现有Host ABI。GitHub写入以当前认证actor、同仓issue/PR和Project条目为目标；幂等键为issue编号＋分支，创建前查询已有PR，写后回读结果。机械回填ExecPlan/Batch、分类、负责人和既有milestone；Status与依赖由人类拥有。draft后TDD，最终push后读取head/base/checks、双向issue关联及完整review threads，当前head验证通过才Ready；人类决定合并。

公开检查在本计划指定检出的工作树根执行：`node scripts/rule-checks.mjs disclosure <base>`、`node scripts/rule-checks.mjs size <base>`、`git diff --check <base>...HEAD`，另人工核查凭据、本机身份、个人信息、内部系统、保密内容。最终提交整理为可独立理解/回滚的Conventional Commits；已推送改写先backup ref，再精确lease。

## Outcomes & Retrospective

组合fixture修订：自有generation 3的最窄WAL与文件组验证结果记录在Progress；组合generation 4在隔离检出 `3788786` 的根目录运行 `pnpm verify`：contract1562、integration2239、E2E226，共4027通过；同组合WAL 1/1与实际Timeline浏览器3/3通过。原expected4/actual3失败来自WAL测试硬码标记，改公开当前基线常量后保留全部sidecar与权限断言；独立fixture复评接受，未把旧4011结果冒称新组合结果。本次仅测试与本Completed计划修订。

独立P1复评在 `19aa3299` 接受完整工程闭环；原反例由RED转绿，继承/only_inherit、持有原fd后路径替换、OS查询异常和实际三阶段abort均通过，65项定向验证通过。作者全套4011项及相关122项、类型/边界/打包通过；复评没有机械重复全套。最终远端状态按当前head回读，不宣称安装、人类接受或发布。私有mode、重开保留、真实WAL/SHM与重建、unsafe actual apply无remote、合成foreign uid及fd释放均有本地证据。早期仅验证profile本身并信任祖先的假设，Superseded by Design / Spec（2026-11-11）：真实0777祖先红例后补逐级准入；补后101/101相关测试与类型/边界/打包通过，全套3989通过属于补强前证据。发现可靠性/维护性有意延后时在本节与技术债tracker记录；核心验收不得作为技术债延后。

## Bottom Change Note

2026-11-11 14:41 SGT：从两份独立方案及第三位修订形成首版，自包含约束/接口/验证与恢复路径；用户已授权必要时采用下一迭代内容并持续交付。

2026-11-11：按实现取证明确profile parent与composition根的owner分界，并记录有界日志截止裁决；保留截止内诊断与allowlist证据。

2026-11-11：记录真实RED、本地GREEN与三项旧合同修订证据；完成Batch 1，保留Active等独立对抗验收。

2026-11-11：祖先替换反例推翻早期信任假设，补只读准入及sticky临时目录正控，记录补强前后验证边界。

2026-11-11：按独立ACL P1扩展最小只读Darwin准入，记录真实红例、fd绑定与OS查询边界；保留首次全套失败并收敛为批量查询，等待修复轮scoped复评。

2026-11-11：区分startup与shutdown预算，补三阶段实际abort及fd释放；记录所有全套失败、诊断与最终4011通过，待原验收者复评。

2026-11-11：独立修订复评接受后归档并整理为单一能力提交。原ACL P1已独立复评解决，65项定向及fd绑定、继承、超时和实际中止回收反例通过；全套4011与相关122项通过。 最终head/checks/issue/threads按文内规则回读，不把本地证据等同安装或人类发布接受。

2026-11-11：组合generation 4揭示WAL fixture固定3的隐藏耦合；保留组合0/1红例，仅改公开常量的同值写入及文档，Completed状态保持不变。

2026-11-11：独立修订复评接受后归档并整理为单一能力提交。原ACL P1与最终WAL fixture修订均经独立复评接受；组合基线4完整4027项、WAL1项及真实Timeline链3项通过。 最终head/checks/issue/threads按文内规则回读，不把本地证据等同安装或人类发布接受。

2026-11-11：追加本轮直接条件收尾授权；独立评审证据保存在本 PR 自己工作树的 review 记录，实施计划继续保留 completed。
