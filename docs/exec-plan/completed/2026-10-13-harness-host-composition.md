# Harness Host Composition ExecPlan

> 状态：Completed（2026-10-14 归档，随 PR #329 收尾；#228 验收 1、2 经人类批准转入 #132 联合验收）
> 创建：2026-10-13
> 范围：完成 issue #228：在 Harness host 内以 SQLite 持久化组合 Core/Controller，通过 typed remote 完成一次 query+command 往返，并把凭据、迁移和卸载生命周期钉死。
> 上游输入：AGENTS.md、PLANS.md、issue #228、docs/architecture/harness-host-spike.md、packages/controller/src/index.ts、packages/client/src/transport.ts。

## Purpose / Big Picture

完成后，插件 host 是唯一组合根：host 持有 SQLite、Core 和 Controller，client 只能通过严格 typed remote 调用最小 query/command；清洁安装包可创建并迁移数据库，provider 每次操作按引用解析凭据，数据库只保存句柄，卸载会幂等关闭资源。最小成功证据是：构建出的安装件 `lib/index.js` 在干净的临时数据根里用包内 migrations（版本 1–7）完成一次 baseline + bootstrap 往返（S2，注入 fake factory）；凭据 canary 只出现在 provider 内存，不出现在 Host 数据目录的任何文件或经 result codec `encode` 的结果里。真实 Desktop 内的正向往返与宿主内建库观测经人类批准转入 #132 联合验收（Decision Log 2026-10-14）。

## Context and Orientation

当前 live origin/main=7c7e77cc。初始 head 的 `apps/harness-plugin/src/host.ts` 只有 ready 日志，client 只挂载 placeholder slots；本批新增 `remote.ts` 后，Host 才注册 live service + strict descriptors，Client 才 mount 同一份 descriptors。Controller 已提供 baseline、commands 与 watch，但 watch 仍由 #276 承担。SQLite migrations 由 builder 打进安装件；Host 入口要求注入 provider factory 与 credential service，缺失时 fail closed；fake factory 只在测试注入，不进入安装件。

宿主 spike 已观测 typed remote 的 unary POST 与 stream Remote、严格 codec、凭据 ctx.credentials.resolve 按操作解析、无 cookie 401/伪造 Host 403；生成器是否可用未证实，因此本批采用手写最小 strict descriptor，不新增生成器依赖。#276 负责 watch stream；#132 负责 provider implementation-key 选择与重启恢复，本计划不吞并它们。

## Design / Spec

- Host composition：`host.ts` 创建 host-owned data path、可配置 migrationsDir 的 SqliteStorage、composeCore 和 createController；`remote.ts` 在所有资源成功后注册 live `harnessProjects` service 与 strict `baseline` / `bootstrapWorkspace` descriptors，返回可幂等 dispose。构造失败先关闭 storage，不发布 endpoint。
- Remote surface：只暴露 baseline query 与 bootstrap command；descriptor 的输入/输出使用 JSON-safe strict codec 与结构化 Controller 结果（参数经 `create().parse`，结果经 Host 网关调用的 `encode`），严格拒绝未知字段、原型污染、空 actor/idempotency 值和原始 credential/Provider/Storage 值。watch 留给 #276。
- Credential boundary：host 只接受宿主 CredentialRef/SecretHandle 的 opaque reference，在每次 provider operation 内调用 resolver；DB 与 remote 只持有句柄，不能把值加入 domain、capabilities 或 wire。
- Migration packaging：为 SqliteStorage 增加显式 migrationsDir 或等效的包内解析；builder 复制 001–007 SQL 到安装件并把目录加入 manifest；clean tarball 启动测试不能依赖 source checkout。
- Boundary exception：ADR-0013 Proposed 放宽 apps/harness-plugin/src/host.ts 与 composition 对 core/controller/storage 的受控依赖；client/ui/ui-model 与其它 apps 保持原边界；`tests/contract/package-boundaries.test.js` 的 `HOST_ENTRY` 只放行这两个文件，并断言 client 入口经相对 import 不可达。#132 后续提供真实 provider factory、implementation-key 与 connector account 选择，不扩张 client 依赖。
- Rejected alternatives：client-side composition、HTTP/SSE 自定义协议、在 #228 内接 watch、引入未验证 generator、将 raw credential 放进 Core/DB。

## Global Constraints

- PR 使用 Closes #228；#228 的验收 1、2（真实宿主内的往返与带宿主版本的建库记录观测）已经人类伙伴 2026-10-14 批准转入 #132，由 #132 的真实 provider 落地后联合验收（Decision Log 2026-10-14）。代码≤800 行、文档≤1300 行；不改 #276/#132/#229 的产品范围。
- 不产生第二权威源；Provider ack/reconcile 前不显示 Saved；secret 只保存 reference。
- 不写 Project Status、blocked-by、blocking；ADR 只标 Proposed，采纳需人类决定。
- 迁移无 downgrade；失败 fail closed，卸载不删除 host-owned DB。
- typed remote descriptor 的真实宿主版本、认证和 host injection 证据必须回读；不能把 spike 历史输出当作当前 PR 绿色。

## Plan of Work

### Batch 1 · Contract red tests and host API lock

最小闭环：先写包边界、host descriptor、migration package 的失败测试，锁住没有 composition 时的红灯。

涉及文件：tests/contract/package-boundaries.test.js、tests/contract/harness-host-remote-adapter.test.js、tests/integration/harness-plugin-host-roundtrip.test.js、docs/adr/ADR-0013-harness-host-composition.md。（2026-10-14 订正：原列的 `tests/contract/harness-host-composition.test.js` 只剩源码正文正则，已删除，host-only 约束改由 package-boundaries 的 `HOST_ENTRY` 承担。）

- 读取 spike 记录与实际宿主版本，确认 hand-written strict descriptor 的最小结构。
- 先写 client 反向 import、未知 remote 字段、credential canary 过线、缺 migrations 文件的失败用例。
- ADR 写 Proposed，不把它标成 Accepted。

验证命令：
node --test tests/contract/harness-host-remote-adapter.test.js
pnpm run boundaries
期望：新增 red tests 以缺失 host composition/boundary 为原因失败，现有边界测试仍能定位唯一 host exception。实现完成后的期望：两条命令 exit 0，边界失败信息指向 `HOST_ENTRY` 以外的文件。

回滚：删除新增测试与 Proposed ADR。

### Batch 2 · Host composition、typed remote adapter、dispose

最小闭环：host 在 clean temp profile 中创建 storage/core/controller，注册 live typed remote service，client mount 同一 descriptors 完成 baseline + bootstrap，dispose 幂等。

涉及文件：apps/harness-plugin/src/host.ts、apps/harness-plugin/src/host-surface.ts、新增 apps/harness-plugin/src/host-composition.ts。

- 以稳定 workspace/binding fixture 组合 Core，不在本批选择 implementation key。
- 让 `ctx.typert.register` 与 service provide 发生在所有资源成功之后；失败路径关闭 storage 并不注册 endpoint。
- 记录 strict parse、service call、结构化结果和 unregister/close count（revision 稳定性依赖 #132 factory 的稳定 binding id，本 PR 未验证）；recording adapter 只作为离线判别测试，不冒充 Desktop transport。

验证命令：
node --test tests/integration/harness-plugin-host-roundtrip.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js
node_modules/.bin/tsc --noEmit
期望：exit 0；runtime-adapter 经 Host 入口完成 baseline + bootstrap，卸载时 storage 只关闭一次、service 撤回、保留调用被拒绝，组合或 register 失败时关闭一次且不发布；roundtrip 在 Controller 前拒绝畸形输入，二次 dispose 幂等，关闭后调用 fail closed。（2026-10-14 订正：原命令引用的 `tests/integration/harness-plugin-unload.test.js` 不存在，`node --test` 静默只跑了 roundtrip。）

回滚：反向提交 host service/descriptor；保留现有 placeholder client。

### Batch 3 · Packaged migrations and credential lifetime

最小闭环：tarball 在 clean profile 中迁移，credential resolver per operation，DB 只含 reference。

涉及文件：apps/harness-plugin/scripts/build.mjs、packages/storage/sqlite/src/migrations.ts、packages/storage/sqlite/src/migrate.ts、apps/harness-plugin/package.json、tests/integration/harness-plugin-migrations.test.js。

- 为 storage factory 增加 explicit migrationsDir，或用经测试的 package-relative resolver；不允许通过 source path 假装打包成功。
- builder 复制 001–007，manifest files 包含 migrations。
- 在 provider 外记录每次 operation 解析到的值，两次操作之间换 canary，断言第二次拿到新值且每次操作各解析一次；卸载后扫描 Host 数据目录下全部文件，并检查经 result codec `encode` 的结果，不得出现 secret value（`tests/integration/harness-plugin-host-runtime-adapter.test.js`）。

验证命令：
pnpm --filter @harness-projects/app-harness-plugin pack:plugin
node --test tests/integration/harness-plugin-migrations.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js
期望：tarball 包含 001–007；clean DB schema_migrations=[1,2,3,4,5,6,7]；第二次启动 applied=[]；凭据 canary 不出现在 Host 数据目录与编码后的结果里。

回滚：删除显式 migrationsDir/packaging 变更；不反向迁移已创建数据库。

### Batch 4 · 对抗验收、S2 安装件与发布门

最小闭环：失败 resolver/provider/migration、malformed remote、strict descriptor、unregister/dispose 与打包 Host 入口全部有判别性证据；真实 Desktop 认证和 `/api` 观察保留为 S3 人类门。

涉及文件：host tests、package boundary test、ADR/ExecPlan。

- provider 表不合法（组合失败）与 `typert.register` 失败均 fail closed、只关闭一次 handle 且不发布 service / effect（runtime-adapter 用例）；缺 factory 或 credentials 时在创建 storage 之前拒绝（`host.ts` 的 `providerTableOf`，未单独测试）；迁移失败的关闭由 `createSqliteStorage` 构造期的 `db.close()` 承担，本 PR 未新增用例。
- malformed remote 不调用 Core；adapter dispose 撤回 contribution 后不接受新请求；in-flight drain 由 typed remote 生命周期与 #276 负责。
- 从临时安装件 `lib/index.js` 加包内 migrations 启动一次 composition 并完成 baseline + bootstrap 往返，证明构建路径而不是 source-tree lookup。
- ADR-0013 保持 Proposed；真实 Desktop 401/403、typed `/api` POST、unload 与重连不写成当前 CI 已验证。
- 跑完整相关门禁，整理 commits，创建 draft PR 并回读 issue/Project linkage。

验证命令：
pnpm verify
pnpm run boundaries
node scripts/workflow-check.mjs
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
期望：所有命令 exit 0；PR draft、base/head、closingIssuesReferences 与 issue closedByPullRequestsReferences 双向回读一致。

回滚：PR 未合并时反向提交；外部 DB/credential 不删除。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | host owns composition | `package-boundaries` 的 `HOST_ENTRY`：只有 host.ts / host-composition.ts 可依赖 core/controller/storage，client 入口经相对 import 不可达；runtime-adapter 经 Host 入口组合 |
| 2 | query/command roundtrip | S2：runtime-adapter（源码 Host 入口）与安装件 `lib/index.js` 经包内 migrations 的 baseline/bootstrap 结果；真实 Desktop 内的正向往返记录观测经人类批准转入 #132 联合验收。revision 稳定性未验证：依赖 #132 factory 的稳定 binding id（`HostProviderFactory` 注释） |
| 3 | clean package migration | tarball entries、schema_migrations 1–7、second start no-op；带宿主版本的宿主内建库观测转入 #132 |
| 4 | credential safety | provider 外记录：换 canary 后拿到新值、每次操作各解析一次；卸载后 Host 数据目录与 `encode` 后的结果不含 canary；真实 provider per-operation resolve 由 #132 验收 |
| 5 | lifecycle | 组合失败与 register 失败：关闭一次、不发布；Host 卸载真正调用 disposer：先排空在途调用再关闭、只关闭一次、service 撤回、保留调用拒绝，库里有 Core 写入的 workspace 与 entity 行；composition 二次 dispose 幂等、关闭后拒绝；迁移失败的关闭由 `createSqliteStorage` 承担，本 PR 无用例 |
| 6 | strict remote | descriptor codec、unknown/prototype-polluted/空值输入在 Core 前拒绝；结果经 `encode` 严格 JSON 化、非 JSON 值在边界报错；Client mount 使用同一 descriptor 并按 RemoteResult 的 `ok` 分支 |
| 7 | boundaries/release | boundaries, verify, workflow, disclosure, size, diff-check green |
| 8 | issue linkage | native PR↔#228 references and Project agent-owned fields read back |

## Progress

- [x] 2026-10-14：独立复评（head `c6e90aab`，无 P0/P1；P2 × 2、P3 × 6）修复完成：
  - P2 S3 进度项：只把 #228 验收 1、2 写成经人类批准转入 #132；unload/reconnect 与 retained-call 的宿主内观测写成未观测、作为残余风险；注明历史 S3 观测所用构建的 head；ADR-0013 Consequences 同步。
  - P2 runtime-adapter：卸载后只读打开 Host 的 `workspace.sqlite`，断言 workspace 行（固定 id 与名称）与 entity 行数，钉住注入表里的 storage 不能压过 Host SQLite（复评变异 R1 原存活）。
  - P3：补回 `workspace.name` 透传断言（R16）并订正上一轮「被相邻断言蕴含」的说法；客户端桩恢复 main 上 M17 的根 Context Proxy 守卫（R6）；Host 入口卸载先排空在途调用再关闭 SQLite 的用例（R7）；人类决定补时刻并注明节选；「转跟进」改为待开 issue。模板字面量说明符绕过边界正则是 main 既有缺口（base `7c7e77cc` 上同样复现），不在本 PR 修，转跟进 issue #339。
  - 体量：remote adapter 的逐项断言合并为 deepEqual，代码保持 800 行。
  - 证据（在检出 `docs/host-composition-plan` 的工作树根目录运行）：`node scripts/review-mutate.mjs <spec> --root .` 在最终树上整表 26 个变异全部 KILLED（exit 0）：第一轮的 M1–M11、M14–M17、M5b，加复评的 R1、R2、R3、R6、R7、R9、R10、R14、R15、R16；spec 存于被忽略的 `.superpowers/review-fix/`。复评的 R4 / R5（反引号说明符）为上述 main 既有缺口，不计入；R8（去掉 credential 引用格式校验）复评未提意见，未加用例。门禁读数（2026-10-14，最终代码提交，base `7c7e77cc`）：`pnpm verify` 1519 + MVP-0 7 全过；`pnpm run boundaries` 9 项全过；`node scripts/workflow-check.mjs` 无 finding；`node scripts/rule-checks.mjs disclosure <base>` 与 `git diff --check <base>...HEAD` 无命中；`node scripts/rule-checks.mjs size <base>` 代码 800 行（任务上限 800，重算即运行该命令）。
- [x] 2026-10-14：MMP 评审第一轮（head `1cccf9a4` 上 REQUEST_CHANGES：P1 × 1、P2 × 7、P3 × 9 inline 与 PR 级意见）修复完成。owner 由人类伙伴在本会话指定：问「四个 PR 的修复与收尾由谁负责？」，答「本会话负责（推荐）」。逐条处置：
  - P1（`Closes #228` 关闭两条未观测验收）：按人类决定保留 Closes，验收 1、2 转入 #132（Decision Log 2026-10-14）；本计划第 29 行、验收表与 S3 进度项按事实改写。
  - P2 RemoteResult：`host-surface.ts` 的 `RemoteNamespace` 返回 RemoteResult，`client.ts` 按 `ok` 分支；安装件测试补 `{ ok: false }` 用例，先红（失败结果被记成 `baseline received`）后绿。
  - P2 result codec：`remote.ts` 增加 Host 网关实际调用的 `encode`；契约测试经 `encode` 断言 Date、Map、原型污染、数组 `undefined`、NaN 报错，先红（`encode is not a function`）后绿；真实 Controller 结果经 `encode` 后 JSON 不变。
  - P2 runtime-adapter：断言移到 provider 外，换 canary 断言按操作解析；卸载真正调用 disposer 并用 `SqliteStorage.prototype.close` 的 spy 计数；补组合失败与 register 失败的故障注入；被覆盖的「直接组合 + 适配器」用例删除。
  - P2 边界：`HOST_ENTRY` 只放行 host.ts / host-composition.ts，client 入口可达集合不含它们；变异 M5 由边界测试直接杀死；删除只剩源码正文正则的 `tests/contract/harness-host-composition.test.js`（同时处置 P3 源码正则意见）。
  - P2 本计划：Batch 1–4 的验证命令、验收表第 1–6 行与 credentials 事实已订正，原文在订正处注明。
  - P3 就地修：Host 产物去掉 `minify` / `legalComments`，说明符检查改为 import 形式；「fake 不进产物」改查 metafile；`docs/adr/README.md` 改十三条并登记 ADR-0013 来源；`HostProviderFactory` 注释写明 binding id 跨启动稳定；Interfaces 订正 home-path API 未使用。其余 P3 转跟进 issue #338：`$mount` disposer、卸载等待在途调用的上限、数据根 home 解析与 profile 维度、`actorRef` 改由 Host 从已认证连接推导。
  - 体量：为守代码 ≤800 行，删除被相邻断言蕴含或同路径重复的断言（remote adapter 的两条事件计数与 `services.has`、roundtrip 的成功往返）；补一条 actorRef 多余字段用例（评审变异 M10 原存活）。（2026-10-14 复评订正：roundtrip 成功往返里的 `workspace.name` 透传并不被其它用例蕴含，变异 R16 因此存活；已在 runtime-adapter 补回。）
  - 证据：本轮的变异整表与门禁读数已被上方复评条目在最终树上的整表结果取代（2026-10-14）。
- [x] 2026-10-14：PR 级意见 `docs/review/README.md` §6「改依赖边矩阵的 PR 单独提交」与 #228 把 Host 入口边界放宽划入本 PR 的冲突，以及 ADR-0013 仍为 Proposed 时边界放宽进入 main，已由人类伙伴裁决为批准例外、留在本 PR（Decision Log 2026-10-14）。原为「待人类伙伴裁决」。
- [x] 2026-10-14：正式评审前整合为计划、功能、ADR/边界和 S3 证据四个提交；消费者搜索确认 `HostRemoteDescriptor` 只剩定义，删除与真实 strict descriptor 并存的无用类型；回滚锚点为 `backup/pr329-before-final-integration-20261014`。
- [x] 2026-10-13：两份独立设计与总审阅完成；确定 typed remote + controlled host boundary。
- [x] 2026-10-13：Batch 1–3 实现完成；host contract、SQLite roundtrip、credential boundary、packaged migrations、artifact regression 与 typecheck 通过。
- [x] 2026-10-13：Batch 4 的本地部分完成；strict descriptor、Host service adapter、Client mount/注入、adapter lifecycle、packaged Host S2 测试与 ADR-0013 已写入。
- [x] 2026-10-14：在 Desktop `0.2.0-rc.2` 真实宿主中安装 PR #329 构建 tarball；安装任务成功，启动索引的 `__DSH_BOOT__` 含 `@harness-projects/app-harness-plugin/client.js`，HTTP 200，Harness Projects 面板可见（构建来自 head `c494a62c`）。
- [x] 2026-10-14：真实 Desktop S3 的本 PR 范围已观测：Desktop 安装成功；无 cookie 的 `POST /api/harnessProjects/baseline` 返回 401；带合法 Desktop cookie 且伪造 `Host` 返回 403；带合法 cookie 的 typed remote envelope 返回 404，因为当前 Desktop profile 没有 `harnessProjectsProviders`（Desktop 0.2.0-rc.2 自带 `credentials`，即 dsh-credentials-local；原文写「未注入 `harnessProjectsProviders` 与 `credentials`」，2026-10-14 评审订正），Host 按 PR 设计 fail closed、未注册 Host service。安装与以上 401 / 403 / 404 都在 head `c494a62c` 的构建上观测（与 `1cccf9a4` 的构建逐字节相同）；评审修复改了 `client.ts` 并去掉 Host 产物的 `minify`，`lib/index.js` 与 `lib/client.js` 已变，未在新构建上复测。正向 200 往返与宿主内建库（#228 验收 1、2）**未观测**，经人类批准转入 #132 联合验收（Decision Log 2026-10-14）。unload/reconnect 与 retained-call 的宿主内观测同样**未观测**，也要等 #132 的 provider 才能在宿主内执行；#228 验收 5 由 Host 入口卸载的 S2 测试（`tests/integration/harness-plugin-host-runtime-adapter.test.js`）满足；这两项宿主内观测不在人类批准转移的范围内，作为残余风险记录。S3 未被本地测试替代。（2026-10-14 复评订正：上一版把 unload/reconnect 与 retained-call 也写成经批准转入 #132。）
- [x] 2026-10-14：一次性测试注入 bundle 在重启前成功执行 `harnessProjectsProviders.create` 与按操作 `credentials.resolve`（只记录 `source=test` 和 canary sha8，不记录原值），随后因错误地占用内置 `credentials` service key，与 Desktop 自带 `dsh-credentials-local` 冲突，触发宿主启动失败。测试 bundle 已立即从 profile 移除；该失败归类为测试注入装配错误，不改变 #329 生产包结论。
- [x] 2026-10-14：第三轮修复的增量独立复评（head `25f96606`）：上一轮 8 条意见中 6 条按原条件已修，#339（模板字面量说明符，main 既有缺口）与 #338（Host 壳加固）转跟进；本轮无新的 P0 / P1 / P2；实施者整表 26/26 KILLED 与复评补充的 10 个变体全部 KILLED；四 PR 并集上本 PR 的 6 个测试文件 37/37 通过。
- [x] 2026-10-14：归档：本计划移到 `docs/exec-plan/completed/`，`docs/README.md` 索引行改为 Completed；评审与修复复评的锁定事实、矩阵与变异表见 `docs/review/pr-329-mmp-review.md`。

## Surprises & Discoveries

- 2026-10-13：仓库没有本地 CredentialRef 类型；必须在 host adapter 映射宿主 opaque ref 到 capabilities SecretHandle，不能把 secret 值扩散到 domain。
- 2026-10-13：单纯把 SQL 文件复制进安装件不足以证明 clean profile；MIGRATIONS_DIR 的 source-relative 解析必须显式覆盖并测试。
- 2026-10-13：typed remote generator 尚未在本仓库验证；手写 strict descriptor 是当前可逆最小方案。
- 2026-10-13：运行时没有 descriptor-level handler；必须把 Host handler 放在带 `typertRemote` binding 的 live Cordis service 上，`ctx.typert.register` 只登记 descriptor。
- 2026-10-14：Desktop profile 只有插件包和现有宿主服务，没有 PR329 所需的 `harnessProjectsProviders` 注入（宿主自带 `credentials`；原文写「`harnessProjectsProviders` / `credentials` 注入」，2026-10-14 评审订正）；因此 authenticated typed endpoint 的 404 是 fail-closed 组合结果，不是把 404 当作成功 roundtrip。要取得正向 S3 证据，必须先提供一次性测试注入或等待 #132 的真实 provider factory（credential service 宿主已自带）。
- 2026-10-14：临时测试 bundle 不能通过 `ctx.provide('credentials', ...)` 覆盖内置 Credentials service；这样会让 `dsh-credentials-local`、`deepseek-account` 和 `connection` 同时失败。后续若继续 S3，测试注入必须使用宿主支持的配置/扩展点或独立服务名，并由 #329 Host adapter 通过兼容的 resolver seam 消费，不能夺占内置 service key。
- 2026-10-13：现有宿主运行时复探的认证与 WebSocket 证据是历史 S3 输入；本批新增的是离线 adapter/S2 证据，不能把两者混为当前验证。
- 2026-10-13：尝试启动真实 Desktop S3 验收时，Cua 报告 macOS 处于锁屏且无法自动解锁；未读取或修改真实宿主状态，S3 保留为人类门。
- 2026-10-13：生产 Host 不再创建 fake provider 或固定 binding；它要求注入 provider factory 与 credentials，测试通过 fake factory 证明 seam，#132 负责真实实现选择。
- 2026-10-14：真实 Desktop S3 只安装 PR329 tarball，不把 fake provider 打进生产包；当前 profile 未提供注入服务，故停止在认证负例与 fail-closed 证据，避免把 S2/fake seam 冒充生产 Host 成功。
- 2026-10-14（评审）：宿主 0.2.0-rc.2 的 dsh-api-gateway 让 unary 调用在 Host 或载体失败时 resolve 成 `{ ok: false, error }`（README 的 RemoteResult 段落、`lib/client.js` 的 `invoke()`），只有装配错误才 reject；原 client 只处理 reject，失败被记成成功。
- 2026-10-14（评审）：Host 网关对 strict 结果只调 `codec.encode`（`lib/index.js` 的 `encodeRpcResult`），`create().parse` 只用于参数解码；dsh-typert-registry 的 `validateCodec` 又要求每个 strict codec（含结果）都有 `create()`。原 result codec 只有 `create`，结果严格化在真实宿主里不生效。
- 2026-10-14（评审）：Core 的 `composeCore` / `bootstrapWorkspace` 会把 provider 内抛出的异常转成结构化降级，写在 provider 里的断言失败不会让测试失败；判别性断言必须放在 provider 之外。
- 2026-10-14（评审）：边界按整包放宽时，client 也 import 的 `remote.ts` 引入 Controller 只被 esbuild 在 browser 平台解析 `node:` 内置模块时偶然拦下；Host 产物开 minify 只是为了让 `.ts` 文本正则不误报 core 一行注释里的文件名。

## Decision Log

- 2026-10-14 15:38–15:49 CST 之间（下界为本 PR 第一轮修复回报主控，上界为主控收到下一份子任务回报；主控会话的时间戳）：批准 `docs/review/README.md` §6 的例外，Host 入口边界放宽留在 #329。Actor：人类伙伴，在本会话直接作答（主控转达）。问题原文：「#329 在同一个 PR 里放宽了依赖边矩阵（现已收窄为只允许 host.ts / host-composition.ts 依赖 core/controller/storage，并有可达性测试钉住）。这与 docs/review/README.md §6「改依赖边矩阵的 PR 单独提交」冲突，但 #228 的 scope 明确把它划进本 PR，#227（a6564894）也有同类先例。怎么处理？」答：「批准例外，留在 #329（推荐）」。选项说明：按 #228 scope 保留在本 PR；ADR-0013 保持 Proposed 合入（#228 验收 3 本就要求 Proposed）；整合提交时把 ADR 放在放宽之前。点名目标：PR #329 中 `tests/contract/package-boundaries.test.js` 的 `HOST_ENTRY` 例外与 `docs/adr/ADR-0013-harness-host-composition.md`（Proposed）。
- 2026-10-14 15:15–15:22 CST 之间（下界为第二轮评审提交 2026-10-14T07:15:04Z，上界为主控据此在 #228 写决策评论 2026-10-14T07:22:20Z）：#329 保留 `Closes #228`；#228 的验收 1（client→Host 一次 query + 一次 command 往返的记录观测）与验收 2（packaged 插件带宿主版本、在干净 profile 上建库迁移的记录观测）原文转进 #132 的验收清单，由 #132 的真实 provider 落地后联合验收。Actor：人类伙伴，经本会话 AskUserQuestion 直接作答（主控转达）。问题原文（节选，主控转达时以「……」截断）：「按『需要 #132 真实 provider 之后才能联合验收』，#329 的关联这样落地可以吗：#329 改为 Refs #228（不再关闭 #228）；#228 保持 OPEN 并保留验收 1、2；……」人类选择的选项原文：「保留 Closes，验收转进 #132」。另一处上下文原话：「我们上午测过需要#132 真实的 provider 之后才能联合验收」。Rationale：真实 Desktop 内的正向往返需要 `harnessProjectsProviders`，生产 factory 由 #132 提供；本 PR 交付 S2 证据与 Desktop 安装 / 401 / 403 / 404 fail-closed 观测。#132 增补验收与 #228 决策评论由主控用开发账号在 issue 上落实，证据在 issue，本计划不记录其结果。
- 2026-10-14：Host 入口例外按文件钉在 `tests/contract/package-boundaries.test.js` 的 `HOST_ENTRY`，并从 client 入口求相对 import 可达集合，不拆独立的 host 包。Rationale：`remote.ts` 被两侧共用但本身不 import core/controller/storage，文件级规则即可判定；拆包会扩大 manifest、打包与边界矩阵，超出本 PR 的体量。
- 2026-10-14：result codec 保留 `create()`，并与新增的 `encode` 共用同一个严格 JSON 化。Rationale：registry 要求 strict codec 有 `create()`，网关对结果只调 `encode`；同一函数避免两条校验漂移。
- 2026-10-14：Host 产物不再 minify，说明符检查只看 import / require 形式。Rationale：minify 只为躲一条文本正则，却让 Host 组合异常的堆栈在宿主日志里不可读。
- 2026-10-14：删除 `host-surface.ts` 的孤立 `HostRemoteDescriptor`，继续由 `remote.ts` 的 `InvocationDescriptor` 与 `HOST_REMOTE` 承载真实契约。该类型没有运行时或类型消费者；清理时发现一条 source 文本断言只靠它的 credential 注释/字段通过，删除该无行为判别力的断言，保留真实 strict codec、输入拒绝与 credential canary 证据。不改变 remote、凭据或生命周期行为。验证在检出 `docs/host-composition-plan` 的工作树根目录运行 Batch 4 命令，真实 Desktop S3 正向门保持未完成。
- 2026-10-13：选择 typed remote，不采用自建 RPC/SSE；spike 已观测 unary/stream、认证和 strict codec，重造协议会重复错误/取消/重连边界并压缩 800 行预算。
- 2026-10-13：选择受控 apps host exception，不新增 host-composition package；新增包会扩大 boundary/manifest/打包面，且不利于本 PR 独立闭环。边界与 Host/Client 接线记录在 `docs/adr/ADR-0013-harness-host-composition.md`，状态保持 Proposed。
- 2026-10-13：#228 不接 watch、implementation-key provider selection 或页面；分别由 #276、#132、#229 承接。
- 2026-10-13：ADR-0013 保持 Proposed，等待人类采纳；agent 不写 Project Status、blocked-by、blocking 或 merge。

## Idempotence and Recovery

build 和 migration 测试可重复；失败安装件目录先清空再写入。rebase 前建立 backup ref；冲突时 abort。回滚不删除 host-owned DB，下一版本继续读同一 schema 或由备份恢复。

## Interfaces and Dependencies

composeCore、createController、createSqliteStorage、Controller wire DTO、Harness typed remote（RemoteResult、strict codec 的 `create` / `encode`）与 credentials API（数据根目前由 `DSH_HOME` 或 `~/.dsh` 自行解析，未使用宿主 home-path API，转跟进 issue #338）、SQLite migrations、#276 stream contract、#132 composition factory、package-boundary contract。

## Outcomes & Retrospective

已回填 Desktop 版本、安装件、typed `/api` 负例、测试注入的 credential-resolution 证据和装配失败原因。正向 200 roundtrip、unload/reconnect 和 retained-call 尚未取得真实 Desktop 证据；测试 bundle 已从 profile 移除。2026-10-14 人类伙伴批准把 #228 验收 1、2 转入 #132，由 #132 的真实 provider 落地后联合验收（Decision Log 2026-10-14）；unload/reconnect 与 retained-call 的宿主内观测不在转移范围内，作为残余风险；历史 S3 观测的构建来自 head `c494a62c`，评审修复后的构建未复测；本 PR 交付 S2 证据与 Desktop 安装 / 401 / 403 / 缺生产服务时 404 fail-closed 观测，不宣称产品 demo 已通。

## Bottom Change Note

- 2026-10-14：独立复评修复：S3 进度项与 ADR-0013 只把验收 1、2 写成转入 #132，unload/reconnect 与 retained-call 记为残余风险并注明观测构建的 head；记录人类关于 §6 例外的裁决，补 P1 决策的时刻与节选标注；「转跟进」改为待开 issue；主控随后开立 #338（Host 壳卸载、数据根与 actor 身份加固）与 #339（边界扫描识别模板字面量说明符），编号已回填。
- 2026-10-14：MMP 评审第一轮修复：订正 Batch 1–4 验证命令、验收表与 credentials 事实，记录人类关于 #228 验收 1、2 转入 #132 的决定、本轮处置与变异整表结果。
- 2026-10-14：整理提交、真实换行和 Issue 尾注，记录孤立 Host descriptor 的删除依据；保留 Desktop S3 负向观察及 #132 正向组合验收缺口，不把本地门禁写成真实宿主闭环完成。
- 2026-10-13：创建本计划，记录 #228 根瓶颈、typed remote 选择与 migration/credential 两个设计门。
- 2026-10-13：将 Batch 2/4 从 fake unary seam 修订为 live typed-remote adapter + S2 packaged Host；补记 revision 稳定性、ADR-0013 和 S3 人类验收边界。
