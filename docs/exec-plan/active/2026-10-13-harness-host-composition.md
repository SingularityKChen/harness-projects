# Harness Host Composition ExecPlan

> 状态：Active
> 创建：2026-10-13
> 范围：完成 issue #228：在 Harness host 内以 SQLite 持久化组合 Core/Controller，通过 typed remote 完成一次 query+command 往返，并把凭据、迁移和卸载生命周期钉死。
> 上游输入：AGENTS.md、PLANS.md、issue #228、docs/architecture/harness-host-spike.md、packages/controller/src/index.ts、packages/client/src/transport.ts。

## Purpose / Big Picture

完成后，插件 host 是唯一组合根：host 持有 SQLite、Core 和 Controller，client 只能通过严格 typed remote 调用最小 query/command；清洁安装包可创建并迁移数据库，provider 每次操作按引用解析凭据，数据库只保存句柄，卸载会幂等关闭资源。最小成功证据是：真实安装包在 clean profile 里完成一次 baseline + bootstrap roundtrip，迁移版本为 1–7，凭据 canary 只出现在 provider 内存，不出现在 SQLite、wire 或 client bundle。

## Context and Orientation

当前 live origin/main=7c7e77cc。apps/harness-plugin/src/host.ts 只有 ready 日志；apps/harness-plugin/src/client.ts 只挂载 placeholder slots。Controller 已提供 baseline、commands 与 watch，但 host 未组合 Core/Storage。SQLite MIGRATIONS_DIR 由 import.meta.url 指向 source tree，builder 当前 manifest 只打包 lib/index.js、lib/client.js、cordis.patch.yml，没有 migrations。包边界契约目前禁止 apps host 依赖 core/controller/storage。

宿主 spike 已观测 typed remote 的 unary POST 与 stream Remote、严格 codec、凭据 ctx.credentials.resolve 按操作解析、无 cookie 401/伪造 Host 403；生成器是否可用未证实，因此本批采用手写最小 strict descriptor，不新增生成器依赖。#276 负责 watch stream；#132 负责 provider implementation-key 选择与重启恢复，本计划不吞并它们。

## Design / Spec

- Host composition：新增受控的 host-composition.ts 或 host-service.ts，创建 host-owned data path、可配置 migrationsDir 的 SqliteStorage、composeCore 和 createController，返回 controller + dispose。构造失败时先关闭 storage，成功后才注册 remote。
- Remote surface：只暴露 baseline query 与 bootstrap command；descriptor 的输入/输出使用已有 Controller wire DTO 与结构化 ProjectError，严格拒绝未知字段、原型污染和原始 credential/Provider/Storage 值。watch 留给 #276。
- Credential boundary：host 只接受宿主 CredentialRef/SecretHandle 的 opaque reference，在每次 provider operation 内调用 resolver；DB 与 remote 只持有句柄，不能把值加入 domain、capabilities 或 wire。
- Migration packaging：为 SqliteStorage 增加显式 migrationsDir 或等效的包内解析；builder 复制 001–007 SQL 到安装件并把目录加入 manifest；clean tarball 启动测试不能依赖 source checkout。
- Boundary exception：ADR Proposed 只放宽 apps/harness-plugin/src/host.ts 与 composition 对 core/controller/storage 的受控依赖；client/ui/ui-model 与其它 apps 保持原边界。#132 后续只替换 composition factory，不扩张 client 依赖。
- Rejected alternatives：client-side composition、HTTP/SSE 自定义协议、在 #228 内接 watch、引入未验证 generator、将 raw credential 放进 Core/DB。

## Global Constraints

- PR 使用 Closes #228，代码≤800 行、文档≤1300 行；不改 #276/#132/#229 的产品范围。
- 不产生第二权威源；Provider ack/reconcile 前不显示 Saved；secret 只保存 reference。
- 不写 Project Status、blocked-by、blocking；ADR 只标 Proposed，采纳需人类决定。
- 迁移无 downgrade；失败 fail closed，卸载不删除 host-owned DB。
- typed remote descriptor 的真实宿主版本、认证和 host injection 证据必须回读；不能把 spike 历史输出当作当前 PR 绿色。

## Plan of Work

### Batch 1 · Contract red tests and host API lock

最小闭环：先写包边界、host descriptor、migration package 的失败测试，锁住没有 composition 时的红灯。

涉及文件：tests/contract/package-boundaries.test.js、tests/contract/harness-host-composition.test.js、tests/integration/harness-plugin-host-roundtrip.test.js、docs/adr/ADR-0013-harness-host-composition.md。

- 读取 spike 记录与实际宿主版本，确认 hand-written strict descriptor 的最小结构。
- 先写 client 反向 import、未知 remote 字段、credential canary 过线、缺 migrations 文件的失败用例。
- ADR 写 Proposed，不把它标成 Accepted。

验证命令：
node --test tests/contract/harness-host-composition.test.js
pnpm run boundaries
期望：新增 red tests 以缺失 host composition/boundary 为原因失败，现有边界测试仍能定位唯一 host exception。

回滚：删除新增测试与 Proposed ADR。

### Batch 2 · Host composition、remote roundtrip、dispose

最小闭环：host 在 clean temp profile 中创建 storage/core/controller，注册 unary remote，client 完成 baseline + bootstrap，dispose 幂等。

涉及文件：apps/harness-plugin/src/host.ts、apps/harness-plugin/src/host-surface.ts、新增 apps/harness-plugin/src/host-composition.ts。

- 以稳定 workspace/binding fixture 组合 Core，不在本批选择 implementation key。
- 让 remote 注册发生在所有资源成功之后；失败路径关闭 storage 并不注册 endpoint。
- 记录 query/command wire frames、revision、结构化错误和 close count。

验证命令：
node --test tests/integration/harness-plugin-host-roundtrip.test.js tests/integration/harness-plugin-unload.test.js
node_modules/.bin/tsc --noEmit
期望：query+command 成功；二次 dispose 只关闭一次；关闭后调用 fail closed。

回滚：反向提交 host service/descriptor；保留现有 placeholder client。

### Batch 3 · Packaged migrations and credential lifetime

最小闭环：tarball 在 clean profile 中迁移，credential resolver per operation，DB 只含 reference。

涉及文件：apps/harness-plugin/scripts/build.mjs、packages/storage/sqlite/src/migrations.ts、packages/storage/sqlite/src/migrate.ts、apps/harness-plugin/package.json、tests/integration/harness-plugin-migrations.test.js。

- 为 storage factory 增加 explicit migrationsDir，或用经测试的 package-relative resolver；不允许通过 source path 假装打包成功。
- builder 复制 001–007，manifest files 包含 migrations。
- provider spy 每次 operation 重新 resolve canary；扫描 DB/WAL/SHM 与 serialized frames，不得出现 secret value。

验证命令：
pnpm --filter @harness-projects/app-harness-plugin pack:plugin
node --test tests/integration/harness-plugin-migrations.test.js
期望：tarball 包含 001–007；clean DB schema_migrations=[1,2,3,4,5,6,7]；第二次启动 applied=[]；凭据只以 reference 出现。

回滚：删除显式 migrationsDir/packaging 变更；不反向迁移已创建数据库。

### Batch 4 · 对抗验收、边界与发布门

最小闭环：失败 resolver/provider/migration、malformed remote、unload in-flight 与版本认证全部有判别性证据。

涉及文件：host tests、package boundary test、ADR/ExecPlan。

- resolver undefined、provider 构造失败、migration failure 均 fail closed 且 close handle。
- malformed remote 不调用 Core；dispose 期间不接受新请求。
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
| 1 | host owns composition | host-only boundary test + runtime composition trace |
| 2 | query/command roundtrip | baseline 与 bootstrap wire frames、revision 变化 |
| 3 | clean package migration | tarball entries、schema_migrations 1–7、second start no-op |
| 4 | credential safety | provider canary received; DB/wire/client has reference only |
| 5 | lifecycle | migration/provider failure closes; dispose once; post-close rejected |
| 6 | strict remote | unknown/prototype-polluted inputs rejected before Core |
| 7 | boundaries/release | boundaries, verify, workflow, disclosure, size, diff-check green |
| 8 | issue linkage | native PR↔#228 references and Project agent-owned fields read back |

## Progress

- [x] 2026-10-13：两份独立设计与总审阅完成；确定 typed remote + controlled host boundary。
- [ ] Batch 1–4 未实现；PR 未创建。

## Surprises & Discoveries

- 2026-10-13：仓库没有本地 CredentialRef 类型；必须在 host adapter 映射宿主 opaque ref 到 capabilities SecretHandle，不能把 secret 值扩散到 domain。
- 2026-10-13：单纯把 SQL 文件复制进安装件不足以证明 clean profile；MIGRATIONS_DIR 的 source-relative 解析必须显式覆盖并测试。
- 2026-10-13：typed remote generator 尚未在本仓库验证；手写 strict descriptor 是当前可逆最小方案。

## Decision Log

- 2026-10-13：选择 typed remote，不采用自建 RPC/SSE；spike 已观测 unary/stream、认证和 strict codec，重造协议会重复错误/取消/重连边界并压缩 800 行预算。
- 2026-10-13：选择受控 apps host exception，不新增 host-composition package；新增包会扩大 boundary/manifest/打包面，且不利于本 PR 独立闭环。
- 2026-10-13：#228 不接 watch、implementation-key provider selection 或页面；分别由 #276、#132、#229 承接。
- 2026-10-13：ADR 保持 Proposed，等待人类采纳；agent 不写 Status/merge。

## Idempotence and Recovery

build 和 migration 测试可重复；失败安装件目录先清空再写入。rebase 前建立 backup ref；冲突时 abort。回滚不删除 host-owned DB，下一版本继续读同一 schema 或由备份恢复。

## Interfaces and Dependencies

composeCore、createController、createSqliteStorage、Controller wire DTO、Harness typed remote/credentials/home-path API、SQLite migrations、#276 stream contract、#132 composition factory、package-boundary contract。

## Outcomes & Retrospective

完成后回填实际宿主版本、tarball、wire、credential scan、dispose 与门禁结果；在完成前不归档计划，不宣称产品 demo 已通。

## Bottom Change Note

- 2026-10-13：创建本计划，记录 #228 根瓶颈、typed remote 选择与 migration/credential 两个设计门。
