# 仓库绑定界面 ExecPlan

> 状态：Completed（实现与验收；远端交付按下述回读门执行）；创建：2026-10-26；关联：#356；批次：B1–B3。
> 执行上下文：检出 `feature/repository-binding-ui` 的 `.worktrees/repository-binding-ui` 根；基线观察为 2026-10-26 `f6ea971`；PR base 为 `main`。

## Purpose / Big Picture

用户在连接设置输入本地working-tree路径与一个GitHub owner/name，经Host只读验证后绑定；成功回读一个仓库及同实体三份引用，拒绝不留下半成绑定。最小证据是当前产物在Host内绑定sandbox、同PID baseline/SQLite读回及用户仓库前后不变。

## Context and Orientation

issue #356与TD-076要求三条配置从同一次仓库选择产生；#131设置门、#353原子bind命令、#355目录均已存在。`workspace-setup.ts::bindRepository`只写本地配置，provider构造也不证明Git/GitHub真实可读。`host-providers.ts`的allowedRoot限制新worktree输出，并非source仓库allowlist。`docs/product/vertical-path.md` §2步骤6与`PLANS.md`约束本项。

## Design / Spec

设置页独立表单仅收localPath、owner、name；不暴露provider配置。稳定应用键固定为`github.com/<lower-owner>/<lower-name>`，三个repositoryExternalId逐字等于此repositoryId，Development/Actions owner/name统一采用规范化选择；该键不是GitHub node_id，不从git remote猜关系。账号经现有connectAccount获得，只有句柄入库。

Host的既有bindRepository handler先验证恰好LocalGit/GitHubDevelopment/Actions三引用、共同键/共同owner/name/合法关联账号，再执行只读preflight，全部成功才调用configure→原子setup写→重组。冲突请求必须在setup调用前拒绝；不得先持久化再用activationError掩盖坏输入。

preflight复用catalog的Local Git与GitHub getRepository、既有credential resolver/transport及路径守卫；规范化source realpath并验证真实checkout/.git（普通目录、bare、missing拒绝），只允许读Git argv。沿用Host数据/worktree输出根不能落source checkout的安全策略及现有symlink拒绝；不新增source根allowlist，不接受UI自报信任根，不声称任意source路径已获allowlist保护。临时probe bindingId不持久，实际id仍由Core单一写者生成；输出根策略与原provider同源，小探针先固定此行为。

local getRepository成功与GitHub可见才写；404/权限/离线/路径拒绝映射固定结构化恢复，不透出stderr/token/真实路径。预检不能防未来TOCTOU，Start Work继续自己写前预检。首次拒绝后绑定相关SQL行集不变；显式connectAccount已建立的账号不冒充绑定半成品。

client intent在途/unknown同键，确定失败后用户修正或再次尝试新键；双击共享Promise。表单卸载调用窄 cancelAttempt，仅使当前 generation 失效并释放界面 pending，保留 intent 键与已提交选择；重进表单恢复该选择，显式编辑才 reset。尚未发出的 bind 不再续作，已经发给 Host 的绑定不能撤销，界面以 result_unknown 保留原键恢复，晚结果不读回或发布。成功仅local_only先显示“配置已记录”，active baseline/read-back确认后显示已连接；activationError保留配置并用原请求恢复激活，不再新增实体。拒绝通用provider编辑器、预览token两阶段和自动解绑。#142未合并时本项用设置入口及read-back独立验收，组合candidate另证“绑定后可选”。

## Global Constraints

生命周期修复仅沿既有 source generation/intent 增加窄 cancelAttempt 与已提交选择缓存；form cleanup 不永久销毁共享 source，不把已发 Host 写入宣称为撤销，不新增通用状态框架或 wire。

代码+tests增删≤800、文档≤1300；生产约360、测试约340。文件全集：`tests/integration/harness-plugin-setup-client.test.js`、`packages/client/src/repository-binding.ts`、`packages/client/src/index.ts`、`packages/ui-model/src/repository-binding.ts`、`packages/ui-model/src/index.ts`、`packages/ui/src/repository-binding.ts`、`packages/ui/src/workspace-setup.ts`、`packages/ui/src/index.ts`、`apps/harness-plugin/src/host-repository-binding.ts`、`apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/host-providers.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/client.ts`、`tests/contract/ui-repository-binding.test.js`、`tests/integration/harness-plugin-repository-binding.test.js`、`tests/integration/harness-plugin-host-recomposition.test.js`、本计划；完成归档另改`docs/README.md`。不改Core/provider schema、migrations、native deps、Status或依赖关系，不写用户repository。

公共桥由协调者串行应用：host-composition下部dispatch对象只替换`bindRepository:`这一handler调用新helper，保留configure屏障；host-providers只提取/导出同源窄guard/工厂；plugin client在setup邻近新增binding source/effect；workspace-setup只在settings插独立form。既有wire不造第二descriptor，不整段重写函数，不预埋其他PR接口。四main PR不stack。

## Plan of Work

### B1 · 同一选择与绑定前只读预检

最小闭环：合法三引用通过；冲突/路径/GitHub拒绝零绑定写。主文件：`apps/harness-plugin/src/host-repository-binding.ts`、`packages/ui-model/src/repository-binding.ts`。先RED三引用逐字、owner/name冲突、普通目录/bare/missing、输出根落checkout、现有symlink政策、GitHub404/权限/离线；实现窄helper再GREEN。

    pnpm test:file tests/contract/ui-repository-binding.test.js tests/integration/harness-plugin-repository-binding.test.js tests/integration/workspace-setup-commands.test.js tests/integration/harness-plugin-host-github-catalog.test.js

期望先有新行为RED，再全部fail0；真实临时Git的refs/index/config/worktree清单前后相同；只读argv白名单含rev-parse/symbolic-ref/for-each-ref/config --get，branch/worktree add/checkout/fetch/config写调用为零。真实SQLite拒绝前后mount/config/account-link/repository/identity集合相同，注入第二/三引用写失败仍事务回滚。回滚helper即可，无补偿删除。

### B2 · 表单、attempt与激活读回

最小闭环：生产设置入口提交，双击一repo三refs；unknown原键、确定失败新键、activation失败不假成功。主文件：`packages/client/src/repository-binding.ts`、`packages/ui/src/repository-binding.ts`。先RED这些状态及target切换/卸载晚响应，再接现有connectAccount、bind、baseline重读。

    pnpm test:file tests/contract/ui-repository-binding.test.js tests/integration/harness-plugin-repository-binding.test.js
    pnpm typecheck
    pnpm run boundaries
    pnpm --filter @harness-projects/app-harness-plugin pack:plugin

期望全exit0；真实Host+SQLite双提交最终唯一repository，三refs同实体；configured与active分开，错误固定恢复可见。回滚表单/接线，已成功配置保留，不自动unbind。

### B3 · 当前产物Host绑定与交付

依`docs/exec-plan/completed/2026-10-26-plugin-workspace-setup.md` Batch3的完整命令，在官方0.2.0-rc.2 Web scratch验证documentsDirectory overlay生效后安装本分支`pack:plugin`产物。冻结head/tgzSHA，同PID打开设置→绑定授权sandbox路径/owner/name→双击→baseline候选及只读SQLite三引用/共同键读回；前后repository摘要与Project规划值一致。#142入口实际选择由组合candidate补证，本PR不需stack。记录runtime/version/profile/动作/时间/原件类别；不发模型prompt。

    pnpm verify
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望全exit0，人工核800/1300和五类公开面；整理提交再push，`gh pr view -R SingularityKChen/harness-projects "$HP_PR" --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`、`gh pr checks -R SingularityKChen/harness-projects "$HP_PR"`及所有review threads回读后才ready。HP_PR由本分支实际draft编号赋值。隔离/凭据不满足保留未完成；回滚安装已知tgz，保留用户repo及成功配置。

## Validation and Acceptance

| 验收 | 证据 |
|---|---|
| 一次选择三配置共同键和远端 | B1 builder逐字断言+冲突请求setup调用零次 |
| 路径/Git/远端失败有恢复且无半绑定 | B1真实Git/SQLite与组件错误矩阵 |
| 绑定只读用户repository | B1读argv白名单/写调用零、B3前后摘要 |
| 双提交一次，配置与激活分开 | B2真实Host/SQLite唯一repo三refs与activation反例 |
| inside-host绑定与Start Work候选 | B3单PR读回；组合candidate实际选择另记source树 |

## Progress

- [x] 2026-10-26 23:02 +08：具名参数后 S3，在新 profile 冻结 `d44d172` / 新产物，实际卸载零续作、重进原键、绑定与 baseline/SQLite 读回全部通过。

- [x] 2026-10-26 22:45 +08：重新验证具名接线产物，结果见本节 23:02 与 Outcomes；早前 S3 仅覆盖其原 source。

- [x] 2026-10-26 +08：两设计/完整issue/基线审评，固定既有路径策略。
- [x] 2026-10-26 +08：B1 首轮 7 项 RED（旧 Host 误报 local_only），helper 后 8/8 GREEN；输出根 symlink 反例再 RED 后修复，B1 联合 73/73。真实 Git 状态与 SQLite 行集前后不变。
- [x] 2026-10-26 +08：B2 表单/生产设置链先 2 项 RED，随后 source/UI/Host 31/31 GREEN；typecheck、boundaries 9/9、pack 通过。完整回归暴露的旧重组测试夹具已获协调者授权调整。
- [x] 2026-10-26 +08：B3 当前产物官方 Web 单 PR 绑定/read-back 通过；证据见 Outcomes。
- [x] 2026-10-26 23:41 +08：独立对抗修复复评、协调者当前 S3 字节/规划快照核对与组合候选审计完成，归档实现计划。最终 push 后按 B3 回读当前 head、双向 issue 关联、checks 和 threads，通过后才 ready；不合并。

## Surprises & Discoveries

独立 P2 探针实际观察到卸载后晚 account 继续 bind；此前 source.dispose 的负控绕过了生产 lifecycle。永久生产 form 测试先得到 bind1!=0 与缺少 unknown 状态；加入 cleanup 后两项通过，重进表单仍能提交且沿用原 intent。该产品字节变化使旧 S3 不能覆盖当前版本，已重新构建并在新独立 profile 重跑。

真实官方 Web 首轮在 preflight 前收到 `gateway/input-invalid`；账号已读通而仓库行仍为零。固定版 Gateway 的 decode 会在 codec.parse 后 assertJsonValue，旧 references codec 将缺失 accountId 变成 undefined 属性。真实 codec lossless-JSON 测试先 RED，缺省省略后 GREEN；仅 standalone/direct-service 不能覆盖此门。新产物重新 remove/add 后重新绑定通过，旧失败产物未当通过证据。

2026-10-26 / 检出 `feature/repository-binding-ui`：首轮 `pnpm verify` 真实失败：client runtime domain 导入牵入 node:crypto、Host helper 直接跨层类型导入、ui-model 平台名文案、四项旧重组 fixture 失效（含 barrier 等待超时）。分别收敛为纯类型依赖和固定错误投影、既有入口类型导出、平台无关文案、合法三引用夹具；不把首轮 red 隐去。

观察到bind只是事务配置写，构造不等于真实可读；allowedRoot是输出根，没有source读allowlist。GitHub getRepository按owner/name读，返回ref由配置构造，不能声称已核验immutable node_id。以上为2026-10-26源码事实，未证明本轮绑定界面通过。

## Decision Log

2026-10-27 +08 / 人类本轮直接指定PR #406–#409无P0/P1或只有P2/P3时由评审会话负责修复、独立复评、归档及rebase合并。采用上述最小方案，理由是修复误分类/假成功，不扩展公共Host接口、不改变工程/规划状态所有权；保持原独立能力交付边界。

2026-10-26 22:45 +08 / 整合owner：三个独立UI PR把不同SDK放到同一工厂第四位置，组合时含义冲突。经独立窄复核，统一第四options对象，每PR只声明本功能具名字段并显式转发，不预嵌别的能力、不spread覆盖前三输入、不加容器。真实mount消费者契约先RED再GREEN，旧三参数调用仍有效；客户端产物重新freeze并在B3复验。

2026-10-26 / 执行者与协调者，P2 生命周期修复：独立评审确认生产 form 没有 cleanup，手动 dispose 测试不能证明离开设置后的行为。采用 source.cancelAttempt 加 form effect cleanup，不永久 dispose 共享 source。snapshot 仅保存已提交选择作为重进草稿；保留未知 intent 原键，不把界面离开伪造为 Host 写撤销。两项生产 seam 测试先 RED 后 GREEN；不增加通用状态框架或 Host wire。

2026-10-26 / 执行者与协调者：真实 Gateway 证据支持增加 `host-operations.ts` 的单 codec 修复；可选 accountId 不存在时省略，禁止用 stringify 吞字段伪造 lossless。Core 通用绑定与三引用一致性策略保持既有要求。

2026-10-26 / 执行者与协调者：既有输出根 lexical guard 被 worktrees symlink 指回 checkout 绕过，真实反例先 RED；Local 工厂沿同一 resolveWorktreePath 规范化后重复原 checkout 相交判定，不增加 source allowlist。完整验证发现新 helper 直接引入 Host-only 类型违反依赖矩阵，改经已有 Host 入口 type-only 导出，未新增依赖豁免。旧重组测试以单引用及任意仓库键直接调用 Host，现契约已要求三引用，协调者批准最小扩展该测试文件；改合法真实 Git 三引用，并保留真实重组、barrier 与失败恢复断言。

2026-10-26 / 协调者及设计评审：不引新source-root安全政策；按现有checkout/输出根约束做Host只读preflight，拒绝先于setup写。采用稳定本地键和三引用一致，不引schema迁移；rename/node-id固定不在本项。用户已授权至ready，无须再次批准；未授权Status/native deps/依赖边/自行合并。2026-10-29若需改成一次性setup的demo措辞，仍需人类具体批准，不自动降低本issue验收。

## Idempotence and Recovery

读/测试/build可重跑；同intent双提交和unknown原键，确定失败新attempt。已记录但activation失败重组恢复，不删除重绑；预检失败无绑定写可恢复。revert撤UI/helper，成功配置与用户repo保留。共享历史整理依expert流程backup ref+精确lease，不自行清worktree。

## Interfaces and Dependencies

沿用bindRepository(actorRef,key,repositoryId,references)、connectAccount、catalog、Storage原子事务及configure barrier。RemoteResult仅plugin解包，client严格内层解析。Host只在当前workspace执行，账号/凭据句柄从既有setup路径取得，不读出token。S3使用预授权sandbox与固定官方runtime；真实证据在本 PR 正文以 Refs #124 关联；外部写入按 actor、目标、幂等标记记录并回读，不将该交叉引用表述为已向 #124 发表评论。

## Outcomes & Retrospective

2026-10-27 +08 / 评审收尾：本功能的完整初审及适用P2修复已独立复核，新组合官方Web验收通过；#124评论`6435452681`补齐指定位置的实证回传。当前组合产品源/包摘要、恢复/卸载、规划副本证据及范围边界见 `docs/review/2026-10-27-pr406-pr409-mmp-review.md`。旧单PR S3只属于其标明的历史冻结源，最终远端门禁及授权rebase合并按逐PR review回读，不预写结果。

2026-10-27 +08 / 本轮MMP评审P2修复：只消费Host四项仓库能力确认active；缺失、重复、未知或不可用能力保持configured并明确检查路径/授权/输出目录、修复后重启的恢复路径。显式activationError仍按原错误恢复，不改Host、RPC或Storage。新增真实Git/SQLite目录变化→配置未就绪→修复目录→重启后active及组件能力矩阵，先2项RED，再32项GREEN。 独立复评与最终组合的当前版本证据追加于所属review记录。下列2026-10-26冻结source/S3是对应历史源码的实测，不能替代此次变化后的当前版本实测。

具名参数后 S3（2026-10-26 23:02 +08）：产品源锁定 `d44d172f094d2725faee1abd6af4e3f94988bd55`，本轮没有修改任何产品或测试源码。新 tarball SHA-256 `c0d82a9d841143deeaa516ba46452c0a24e64b371f393285db9523df69b34187`，12 个产品源文件冻结摘要在验收前后相同，12 个安装文件与 tarball 逐字节相同。官方 0.2.0-rc.2 Web 使用全新隔离 clone/profile/documents 根与独立浏览器 session；结构化 effective config 在首次访问前核对，native registry 与实际默认目录在该根内。首次浏览器打开早于 Host URL 就绪，等待 ready 后重试；未观察产品失败。

当前具名接线实际显示绑定表单。延迟真实 account Gateway 请求，切换 Plugins 确认 form 卸载，再放行请求：bind 调用仍为 0，SQLite 账号 1 / 仓库 0。重进后恢复选择且表单可提交，account 原键不变；实际双击只发 1 次 bind，得到 local_only，随后同 Gateway baseline 返回一个匹配候选，页面显示“仓库已连接”。该过程与最终读回处于同一新 Host PID；旧自有实例已停止。

新只读 SQLite 为 1 repository / 3 bindings / 3 identities，同实体、同应用键、同远端 owner/name、本地路径 canonical；独立安装文件摘要、SQL 行摘要和请求/回复原件保留于忽略运行目录。新 clone 的 refs/index/config/worktree/status 前后不变；Project A 的 16 字段/9 条目规范化快照仍相同，SHA-256 `37fe5b017d8188bab83b760d76c5b598dff6763a2e6e9f6cb2899dd8ca97337a`。没有模型 key/prompt、GitHub 或规划字段写入、用户 repository 变更。本轮未重跑全 verify；协调者已提供本次可逆接线的 19 项、typecheck、pack 证据，最终组合 full verify 由协调者执行。本轮新增门是以上新产物实际 S3；当时独立复核和远端交付仍待协调者；Superseded by 本节“最终审计与归档”（2026-10-26）。


以下生命周期版本记录 Superseded by 本节“具名参数后 S3”（2026-10-26），保留旧产物历史，不作为当前接线的通过证据。

生命周期修复后 S3（2026-10-26 +08）：当前产物 SHA-256 `40f738cb1ee950630f8d74f42a036625adffaa4665cf89a5ab35ec6615ad9720`，官方 0.2.0-rc.2 Web 新独立 profile、documents overlay 与全新隔离 clone。12 个产品文件摘要冻结，12 个安装文件与 tarball 逐字节相同。实际页面在账号 Gateway 请求等待期间切换到 Plugins，确认 form 真正卸载；放行真实账号请求后 bind 请求仍为 0，SQLite 账号 1 / 仓库 0。重新进入恢复已提交选择，表单可用，账号调用沿用原键；实际双击后仅 1 次 bind，local_only 后真实 baseline 一个候选并显示“仓库已连接”。此过程与最终读回在同一新 Host PID 下完成，旧运行实例已停止。

当前只读 SQLite 为 1 repository / 3 bindings / 3 identities，三身份同实体/同应用键，两个远端 owner/name 一致，本地路径 canonical。新 clone 的 refs/index/config/worktree/status 前后不变；Project A 的 16 字段/9 条目前后 SHA-256 仍为 `37fe5b017d8188bab83b760d76c5b598dff6763a2e6e9f6cb2899dd8ca97337a`。native registry 与默认目录均在新 scratch documents 根；没有模型 key/prompt、真实 GitHub 写入、规划字段或用户 repository 写入。原件继续只留忽略运行目录，当时独立 scoped 复评仍待协调者；Superseded by 本节“最终审计与归档”（2026-10-26）。

当前验证：新增生产 unmount/重进与已发 Host bind 晚结果两项真实 RED→GREEN；窄套件 16/16，`pnpm verify` typecheck、2030 项及 MVP 7 项全部通过，boundaries 9/9、workflow-check 无 findings、重新 pack 成功。发布面、规模与 diff 在 fix 提交前后另行回读。


2026-10-26 21:47 +08 / 在检出 `feature/repository-binding-ui` 的工作树运行：`pnpm verify` typecheck、2028 项及 MVP 7 项全部通过；`pnpm run boundaries` 9/9、`node scripts/workflow-check.mjs` 无 findings、`pack:plugin` 成功。真实 codec 修复后的窄套件 35/35，包括第二/第三 SQL 引用故障回滚和仅只读 Git argv。人工发布面与最终提交前扫描另按本节追加结果记录。

以下旧产物记录 Superseded by 本节“生命周期修复后 S3”（2026-10-26），保留历史证据，不用于当前产品通过。

官方 0.2.0-rc.2 Web 独立 profile，documentsDirectory overlay 在首次访问前结构化核对，native registry 与实际默认目录均在隔离 documents 根。本分支最终候选 tarball SHA-256 `dd01224331cbd22dd1cc12aaa2a951360acd2cddb7f27fad5fd079a8e111dfc2`；12 个安装文件逐字节匹配，12 个产品文件的冻结摘要与运行前/后相同。已有 scratch 工作区设置下，当前产物同一 Host PID 实际表单双击绑定 sandbox clone，typed Gateway 返回 local_only，随后该 UI source 的真实 baseline 返回一个候选并显示“仓库已连接”。只读 SQLite 有 1 repository、3 bindings、3 repository identities，三身份同实体/同应用键，两个远端配置 owner/name 相同，本地路径为 realpath。账号只存既有 secret handle。

clone 的 refs、index、config、worktree 清单和 status 前后逐字节相同。授权 Project A 的 16 字段/9 条目规范化前后快照相同，SHA-256 `37fe5b017d8188bab83b760d76c5b598dff6763a2e6e9f6cb2899dd8ca97337a`。没有模型 key、prompt、GitHub 写入或规划字段写入。原始截图、wire、SQL/registry/安装摘要和两版候选 manifest 留在忽略运行目录，交协调者独立审计；此处不放访问 URL、真实本机路径或凭据。#142 的 Start Work 实际选择留组合 candidate 补证，不能从当前 baseline 外推该操作已验收。


B1–B3 的本地实现与官方 Web 单 PR 验收已完成；协调者独立验收及远端 ready 尚未执行，不把本地证据视为远端接受。保留TD-064仓库改名/不可变id、TD-070进程账本、TD-074单delivery来源边界；本项解决TD-076入口一致性但不宣称Core通用配置已透明。新实质债务由执行者登记`docs/exec-plan/tech-debt-tracker.md`并更新范围，全部验收后归档/索引。

最终审计与归档（2026-10-26 23:41 +08）：协调者独立复算冻结源码与当前检出的差异仅为计划文档、当前 tarball SHA 和安装的 12 个成员逐字节匹配，前后规划完整快照相同。原生产卸载 P2 已经独立复评关闭；三参数旧调用与具名接线独立消费者 3/3 通过。TD-070 进程内设置账本、TD-076 的 Core 配置不透明边界保留；本项把产品入口的三配置一致性及拒绝前置验证闭环，不引入 schema 或第二事实源。

组合补证（仅覆盖冻结候选 `d37877af` / tree `afbb9321`，2026-10-26）：四个产品 source 的局部并集经过全量 2081 项、MVP0 7 项、窄回归 100 项与边界 9 项；独立官方 Web 实点从空库创建、连接规划、双击绑定到 Start Work 同仓库选择、刷新六位置及卸载重启。只有一个 repository、三引用、一个 context/run、新 branch/worktree；实际 ready/manual_fallback 且 run failed，不声称模型执行成功。context/worktree 有事实，后四位置 not_observed；规划三次快照相同。卸载撤回插件入口与 RPC，Git checkpoint 和业务表保留，同步游标可推进。该 source 下非空分支路径通过，不替代 #142 后续留空分支的 Gateway 修复验收，也不等同于任一单 PR 精确源码或 R1。

远端交付门以可重算命令为准：在本计划分支根执行 `gh pr checks -R SingularityKChen/harness-projects 407`，并回读 PR head/base、完整 threads、当前 CodeQL 结果及 issue #356 的 closedByPullRequestsReferences；与发布 head 一致且无未处理阻塞意见后执行 `gh pr ready -R SingularityKChen/harness-projects 407`。本计划不预写未发生的 ready/check 结果。

## Bottom Change Note

2026-10-26 23:41 +08：独立核对当前 S3、受限组合证明和债务边界，归档实现计划并把易失交付状态保留为回读规则。

2026-10-26 22:48 +08：具名参数消费者验收GREEN、typecheck与pack通过；S3以本次新产物身份重验。

2026-10-26 22:45 +08：以三份真实消费者RED收口并行工厂参数碰撞，仅改本功能具名接线；新增setup-client验收路径，最终产物重新freeze。

2026-10-26 +08：综合两独立设计和源码初稿，收敛只读preflight、输出根含义、三引用一致和独立/组合验收。

2026-10-26 +08：记录 B1/B2 RED/GREEN、输出根规范化和回归暴露的集成边界；B3 正在独立官方 Web profile 执行，尚不宣称完成。

2026-10-26 +08：真实 S3 首次在 Host preflight 前被 strict Gateway 拒绝；官方固定版 decode 在 codec.parse 后检查 lossless JSON，现有 references codec 给 local ref 增添 undefined accountId。新增真实 codec 判别测试先 RED，最小改为缺省省略，与 actorRef 相同；本范围增加该单 codec 修复，重新构建/安装后重跑 S3。旧产物 S3 不作通过证据。

2026-10-26 +08：补录实际 Gateway RED/GREEN、重建后的官方 Web S3、同进程 read-back 与零仓库/规划变更；独立验收与远端操作仍交协调者，暂留 active。

2026-10-26 +08：最终 staged diff 的同源 scanDiff 与提交信息 scanText 均无命中；人工五类发布面逐项通过。staged code churn 413，小于 800；完整 PR 文档小于 1300。最终窄套件 14/14、boundaries 9/9，产品冻结摘要与 S3 相同。标准脚本在提交后再对完整 head 运行，远端发布仍由协调者执行。

2026-10-26 +08：按独立P2修复生产form生命周期，新增窄cancelAttempt并保留原键/已提交草稿；旧S3原处标Superseded，新独立profile完整实测卸载阻断、重进恢复、绑定读回与零仓库/规划变更。

2026-10-26 23:02 +08：新增并完成具名参数后S3 checkbox；仅记录d44d172新产物c0d82a9d的冻结、安装、实际卸载/重进/绑定读回与SQL/Git/Project/native摘要。旧40f版本原处标Superseded，未改产品源码或借用旧包通过。

2026-10-27 +08：按MMP完整初审修复新增P2，保留原S3的冻结源码/时间边界，新增判别性RED/GREEN证据；未改变规划Status。

2026-10-27 +08：追加MMP评审收口与新组合证据回传，保留各历史源码的实测身份，不混用为新单PR精确产物。
