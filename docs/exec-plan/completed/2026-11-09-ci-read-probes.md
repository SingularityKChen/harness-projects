# 显式独立验证 Actions 与 Checks 读取 ExecPlan

> 状态：Completed · 实际 main 接合与最终独立复评通过；最终公开门按当前版本回读
> 创建：2026-11-09
> 范围：issue #435 的仓库显式验证、两轴 capability 与现有表单显示
> 上游输入：issue #435、`PLANS.md`、`docs/adr/ADR-0014-host-composes-providers-by-implementation-key.md`

## Purpose / Big Picture

用户在现有仓库表单绑定或重新验证同一仓库后，可以分别看到 Actions、Checks 的实际读取观察。Actions 获准不使 Checks 自动可用；拒绝一个轴不关闭其它研发与规划工作。最小证据是生产 catalog、Host bind、真实 controller baseline 和 client/form 串联后，两轴相反权限准确显示；空响应、缺提交、未运行或模糊错误均不能显示已验证可用。

## Context and Orientation

观察基线为 2026-11-09 的 `main` 提交 `c9bb17b833295f26c750bd8c4bf425df53e9701f`。`host-repository-binding.ts:preflightRepositoryBinding` 已验证三个引用一致、账号、本地 realpath、研发仓库读取，但未读 CI。`host-providers.ts:GITHUB_ACTIONS_ENTRY` 当前有 secretHandle 即同时 degraded、无句柄则 unavailable。Actions Provider 已有 `listPipelineRuns` 与 `listChecks`、独立端点、完整 SHA/仓库校验、解码和错误分类，应直接复用。Core 在组合时收集 capability snapshot，仅修改探针对象不会更新 controller。

`host-composition.ts:configure` 当前只在配置 fingerprint 变化时重装配；同仓重新验证配置相同也必须更新 snapshot。`packages/client/src/repository-binding.ts` 的 source 可以重复提交同一 selection，表单已允许 active 时提交，但没有两轴 CI 结果展示。仓库级 baseline capability 已有正确来源绑定语义，应由 client 派生显示；不增加另一权限 authority、公共命令或新设置页面。

## Design / Spec

选择“显式 bind preflight 产出本次短生命观察 → 本次成功 configure/assembly 消费 → 现有 capability/controller → client/form”闭环。三份方案均支持独立观察；最终复核选择最小方案，拒绝新通用 permission registry/数据库和跨层 validation command，拒绝启动或普通 baseline 隐式探测，拒绝 credential handle、scopes header、Actions 成功或空列表推断另一轴权限。

preflight 成功返回 Host 内部闭集 `{ input: BindRepositoryInput, ci: CiReadObservation }`，失败维持现有 CommandResult。先完成已有仓库 scope 验证，在已 realpath 校验的本地 checkout 用 execFile argv 执行 `git rev-parse --verify HEAD`，仅接受完整小写 40 位 SHA。本动作明确验证用户选定仓库的当前 HEAD；不猜默认分支/任意 PR，不隐式 checkout/fetch，不改 Git。unborn/missing HEAD 时保留两个轴 degraded/未观察，零 CI 请求，仍允许无关仓库配置；路径/仓库基本验证失败仍按原 bind 规则拒绝。

在现有 catalog 中构造一次临时 github-actions 端口，不复制 Provider decoder、不从新文件 import Provider 实现。分别调用 `listPipelineRuns({repository, commit, limit:1, cursor:undefined})` 与 `listChecks` 同样参数，各自处理结果，不短路另一轴。合法非空、scope/head 匹配的成功页可证明本轴读取观察；不要求读完全部历史分页，也不声称完整 CI 事实。Checks 必须真正完成 Provider 既有 suites+check-runs 读取，suites 的成功不能冒充 runs 权限。

权限映射为：真实非空合法成功→available；明确 401/普通403 的 permission_denied→unavailable；404/not_found、rate_limited403/429、offline/unavailable、坏体、head/repo 不匹配、空集合或未运行→degraded。404 不足以区分隐藏仓库与目标不存在，不能宣称明确拒权。空成功保持 degraded 是本 issue 更保守的产品规则，不冒称 GitHub API 要求。错误仅用安全固定原因，不回显 token/raw body。单轴 denied 不使另一轴、仓库 Development、Start Work 或 Planning Status失效。

`CiReadObservation` 只含 workspace、规范 repo id/owner/name、账号身份 stamp（accountId、platformFamily/origin、identityKind/externalId、secretHandle 标识）、完整 SHA 或明确未观察、单调验证序号、observedAt 和两个 AccessLevel/安全原因。它不含 token，不进 wire、configuration_json、SQLite 或全局 WeakMap。每次 bind 在开始 preflight 前分配 Host 内单调序号；较新显式验证开始后，旧结果不可再 configure/激活，即使旧成功更晚完成。账号/仓库 scope 改变、Host stop 也使旧观察失效。

本次 setup.bindRepository 成功后，按实际持久 repository references 找到这次 github-actions binding，重新核对账号完整 stamp、配置、仓库与序号才向本次 assembly 的 ProviderBuildInput 传观察。构造正式 Provider 时只把两个 observed access 放进已有 permission keys；没有匹配观察保留原 conservative degraded/unavailable。只消费一次，不跨后续 configure 缓存授权，不持久化“grant”。Host restart 无观察，保持 conservative 状态；不启动网络探测。

configure 在本次验证有效时，即使 fingerprint 未变也重装配，让 Core 重新 collectBindings；激活失败仍返回现有 activationError，不能伪报新 snapshot 生效。已绑定仓库重复验证沿同一 entry 和自然键复用，不新增挂载、账号、execution context 或 delivery fact。请求幂等键不承担权限缓存；每次显式重新验证必须重新观察。现有 bind mutation 结果与 CI 只读观察分开，不能用 Saved 表达验证。

client 在绑定后的真实 baseline 中，按所选 repository id 和 capability key 精确派生 `ciReadAccess`，仅接受 available/unavailable/degraded，缺失/重复/非法项保守 degraded。它只是展示投影，不能写 Host 权限。现有表单追加两条文字“Actions 读取：已验证可用 / 不可用 / 尚未验证或暂时无法确认”和 Checks 对应文字，并将 active 状态提交文字改为“重新验证仓库与 CI”；无新增页面、轮询、按钮框架、secret 输入或公共 wire 字段。保留 keyboard、pending 去重、错误恢复与本地草稿。

## Global Constraints

单一实现 owner 的完整允许代码集合为 `apps/harness-plugin/src/host-repository-binding.ts`、`apps/harness-plugin/src/host-providers.ts` 的 CiReadObservation 类型/匹配/GITHUB_ACTIONS_ENTRY/restoreProviders 参数区域、`apps/harness-plugin/src/host-composition.ts` 的 bindRepository/preflight/configure/assemble 参数接线区域、`packages/client/src/repository-binding.ts`、`packages/ui/src/repository-binding.ts`。允许测试为新 `tests/integration/harness-plugin-ci-access.test.js`、现有 `tests/integration/harness-plugin-repository-binding.test.js`、`tests/integration/harness-plugin-workspace-setup.test.js`、`tests/integration/harness-plugin-host-github-catalog.test.js`、`tests/integration/harness-plugin-host-recomposition.test.js` 的受影响 fixture/期待、`tests/contract/ui-repository-binding.test.js`。文档为本计划（完成后同名移至 completed）、`docs/README.md`、`docs/review/pr-585-mmp-review.md`、本批 `docs/review/2026-11-09-pr583-pr585-mmp-review.md` 及 review/merge-queue 索引；有真实债务才登记 `docs/exec-plan/tech-debt-tracker.md`。不新增 Provider 公共 API、Core/controller wire、schema、包依赖或权限存储。

分支 `feature/ci-read-probes`，目录 `.worktrees/ci-read-probes-20261109`。代码含测试/config/fixtures 的加删必须严格小于 800、文档小于 1300；估计 Host 170–250、client/form 35–65、测试与 fixture 290–390，总 495–705，文档 160–260。若完整闭环逼近上限先删重复 fixture/无关机制，不能删权限反例。#422 拥有相同 Host 文件的 lifetime/stop/dispose/I/O 包装区域；交付 owner 顺序集成接线并重验，不让多个 worker 同时写同一检出。不改 Status/native dependencies、账号 scope、凭据服务或人类门。

## Plan of Work

### Batch 1 · 显式 preflight 两轴观察贯通真实显示

**最小闭环**：现有仓库 bind/revalidate 生产路径的实际观察进入 controller capability，表单显示两个独立结果，失效观察不能升级权限。

**涉及主文件**：`apps/harness-plugin/src/host-repository-binding.ts`、`host-providers.ts`、`host-composition.ts`、`tests/integration/harness-plugin-ci-access.test.js`。

先仅以本计划创建关联 #435 的 draft PR，由交付 owner 管理 GitHub 元数据。新测试使用真实临时 Git checkout、生产 PROVIDER_CATALOG 与无凭据 transport fixtures，从 Host `call('bindRepository')` 进入并经 controller baseline codec 读回。以 Actions 非空合法/Checks 403、反向两例先 RED，当前应失败在两轴都 degraded，而非缺 REST fixture。构造 fixture 的 CI 数据 SHA 必须等于该临时 checkout 的真实 HEAD，不能通过硬编码别仓 SHA 逃过 scope 检查。

实现观察闭集、独立 Provider calls、账号/仓库/序号 fence 和本次 assembly 消费，修复 same-fingerprint 重装配。补独有对抗：empty/unborn/unrun 零升级；suites200而runs403；rate-limited403/429/offline/坏体/错head；旧成功 A 挂住、新 denied B 先完成后 A 返回；probe 期间账号或绑定变化；同仓 revalidate 撤权后恢复；restart 无授权持久化且启动零 CI 请求。只更改有判别作用的现有 fixture，复用 Provider decoder 回归，不复制其完整分页矩阵。

client/form 从 baseline capability 派生两轴文字，用 source+组件测试串联真实 Host 两种反向结果，重复同 selection 可再验证，失效响应不发布，CI 单轴拒绝仍可显示仓库已连接。确认 wire/SQLite/诊断不含 token/raw canary、不出现新 permission/config 字段；Planning Status 和用户 Git 状态不变。通过实际打包 client 与 Host 入口测试确认安装件可呈现相同结果；真实 Desktop 显式验证若环境可用仅作只读操作，结果与 fixture 证据分别记录。

**验证**：全部命令在检出 `feature/ci-read-probes` 的 `.worktrees/ci-read-probes-20261109` 根运行。先在实现前运行第一行取得指定 RED，最终运行全部；期望两轴逆向、scope/generation/same-fingerprint、保守控制、client 显示通过，其余 exit 0。

```text
pnpm test:file tests/integration/harness-plugin-ci-access.test.js
pnpm test:file tests/integration/harness-plugin-repository-binding.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/workspace-setup-commands.test.js tests/integration/harness-plugin-host-github-catalog.test.js tests/contract/delivery-github-actions-contract.test.js tests/contract/ui-repository-binding.test.js tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-host-recomposition.test.js
pnpm typecheck
pnpm boundaries
pnpm --filter @harness-projects/app-harness-plugin pack:plugin
pnpm verify
node scripts/rule-checks.mjs disclosure c9bb17b833295f26c750bd8c4bf425df53e9701f
node scripts/rule-checks.mjs size c9bb17b833295f26c750bd8c4bf425df53e9701f
git diff --check c9bb17b833295f26c750bd8c4bf425df53e9701f
```

提交前执行 publication 人工五类目核对与更严 800/1300 numstat 检查。完成后更新实际证据、移动计划并更新索引。最终 push 后由交付 owner 回读当前 head/base、issue 关联、checks 与所有 review threads，最终 head 验证通过才 Ready。真实安装 Host 无法访问时记录明确 installed 验收缺口，不冒称 Desktop 已接受。

**回滚**：整体 revert 本 PR 回到保守 degraded；保留已有仓库/账号/绑定、Git 与用户数据，不修改上游 scope 或凭据。

### Batch 2 · 当前 main 接合与评审收尾

**最小闭环**：在 #583、#584 的实际合入版本之后，CI 观察仍共用 Host I/O owner、缓存 Development 端口不被旧装配退休误停。

**涉及主文件**：既有 Host 组合接线与 `tests/integration/harness-plugin-ci-access.test.js`。保留 #584 的 `lifetime`、根 owner 与统一 fetch/credential，联合本 PR 的 `ci`、sequence/fingerprint/HEAD fence；将既有本地组合的 credential/http stop 与 cached Development 三条判别探针纳入本 PR。没有新功能或权限 authority。

在实际 main 上顺序变基，完整保留文档索引；执行 Batch 1 的 verify/boundaries/公开面命令，再运行 `pnpm test:browser` 和 `pnpm test:file --test-name-pattern=combined tests/integration/harness-plugin-ci-access.test.js`，期望全部通过。独立复核接线后归档本计划，整理为交付提交，精确 lease 推送并回读当前 head/base/checks/threads/issue 关联；取得当前 head 的 Bot 批准后才 rebase merge。回滚为整体 revert 本 PR，保留用户库、Git 和未知外部结果。

## Validation and Acceptance

Batch 1 的生产 Host→controller→client/form 链路必须分别显示 Actions available/Checks unavailable 与反向；missing/empty/unrun/ambiguous 均不建立 available。显式 same-bind 重验能刷新 snapshot，旧成功不能覆盖较新拒绝，重启不复用 grant。独立轴拒绝不影响无关工作，凭据不落库/上 wire。仅 helper 测试、手工修改 snapshot 或启动时推断都不能满足。Provider 读取观察不等于所有仓库、未来权限或 CI 全量事实，也不构成人类发布接受。

## Progress

- [x] (2026-11-09) Batch 2：实际 main 接合、三条永久交界探针、完整/Chromium 验证与独立最终复评通过，计划归档。

- [x] (2026-11-09 19:02 +08) 综合三份独立方案与 Host/catalog/controller/client 源码，选定短生命观察路径。
- [x] (2026-11-09 19:26 +08) 交付 owner 已创建关联 #435 的 Draft PR #585，并验证原生双向引用和元数据。
- [x] (2026-11-09 19:26 +08) Batch 1 本地工程闭环：两轴指定 RED、19 项 CI 观察/真实打包入口/表单测试、30 项重装配与观察回归通过。
- [x] (2026-11-09 19:26 +08) `pnpm typecheck`、`pnpm boundaries`（9 项）、`pack:plugin`、`pnpm verify`（契约 1425、集成 2091、E2E 226）通过。
最终公开门：最后推送后重锁精确 head/base、checks、双向 issue、完整 review threads 与 Bot 当前版本批准；Ready 状态必须重新回读，不从旧 head 继承结论。
保留的人类门：真实 Desktop 显式重验与人类发布接受未执行；本地 packed Host/client 证据不替代此门。

- [x] (2026-11-09 19:37 +08) 独立完整代码评审通过；179 项行为与 9 项边界、typecheck、publication/size/diff 均通过，无需额外重构。

## Surprises & Discoveries

真实 capability snapshot 在组合时固定；same-fingerprint bind 不重装配会使探针成功仍显示旧 degraded。现有表单允许重复提交，但 client snapshot 没有两轴显示，因此必须补最小展示投影，不能把 Host helper 的结果当作 installed 可见。404 是不明确可见性/存在性，最终设计选择 degraded，修正其中一个备选把 not_found 一概 unavailable 的建议。

首轮 `pnpm verify` 的契约 1425 项通过，集成 2087/2089 项通过，失败名为 `same remote follows new Core generations after create/connect/bind on the same follower` 和 `a tick admitted during the barrier never joins its drain and never writes through the retired Core`。前者仍期待同绑定沿用 controller；后者的首个 Storage 只读 hook 被新增 preflight fingerprint 提前触发。经交付 owner 批准，仅更新这两处期待与语义门：Core 绑定事务确实位于 configure barrier 内，继续断言旧 tick 不读与不写旧 Core。最终完整命令通过。

初次边界检查拒绝 preflight 直接 import capabilities。实现改沿既有 `host-providers.ts` 转出能力类型和值，保持 Host 入口白名单和依赖方向；边界复跑 9 项通过。新 observation 没有进入 schema、wire 或 SQLite；重验前后的全部数据库表深等。

## Decision Log

- Decision：本评审会话在三份完整首审均无 P0/P1 后接手 #583/#584/#585 的非阻塞修复与条件合并。用户在本会话针对这三个 PR 的原话为“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。”本批准只覆盖三个目标及所列条件，不授权 Planning Status、依赖或 R1 裁决。Date/Author：2026-11-09 / human partner，评审会话记录。
- Decision：Batch 2 顺序接合 #583 → #584 → #585，不建立 Planning 依赖；源历史改写先建 backup ref，再用精确远端 SHA lease。Rationale：独立完整前序预演发现后两 PR 的索引及两处 Host 接线冲突，必须保留全部已验收语义。Date/Author：2026-11-09 / review owner。

- Decision：复用 bind preflight 与生产 Provider list API，显式携带短生命观察供单次 assembly 消费。Rationale：沿唯一既有 capability authority，避免新命令、权限表或 side channel。Date/Author：2026-11-09 19:02 +08 / independent spec reviewer。
- Decision：单调序号、账号完整 stamp、仓库/HEAD fence，same-bind 强制刷新。Rationale：防止迟到旧成功盖掉新拒绝，不能靠 observedAt 墙钟猜先后。Date/Author：2026-11-09 19:02 +08 / independent spec reviewer。
- Decision：只增现有 client/form 的两轴投影，不改公共 wire。Rationale：闭合 installed 可显示的验收，保持状态拥有与体量约束。Date/Author：2026-11-09 19:02 +08 / independent spec reviewer。

- Decision：重装配最终发布前再次同步检查显式验证序号，并复核账号、配置与本地 HEAD。Rationale：即使新验证在候选装配期间开始，旧成功也不能激活；额外装配竞态用例通过。Date/Author：2026-11-09 19:26 +08 / implementation owner。
- Decision：仅为已改变的绑定语义调整重装配测试，不修改 Host 停止/I/O/lifetime 所有权。Rationale：#422 独立工作在最终组合时沿该任务的 host-wide I/O 包装接线集成，避免相互依赖。Date/Author：2026-11-09 19:26 +08 / delivery owner。

## Idempotence and Recovery

同 selection 可重复验证，仓库配置依原幂等键/自然键复用，每次观察独立刷新；pending UI 仍去重。失败/限流保留 conservative 结果供显式重试，不自动后台探测。旧 observation 一次使用后丢弃，restart 回到 conservative；不是丢失 durable authorization，因为没有持久授权承诺。scope/fingerprint 变化时拒绝过时证据，不删除原绑定。测试只用临时 checkout/SQLite 与录制形状 fixtures。

## Interfaces and Dependencies

Node >=22、pnpm 10.28.2、现有 Provider catalog、Git execFile、Actions/Checks list 方法和 baseline capability。Host 内 observation 不接受 client 传来的权限值，不包含 secret 值；secretHandle 只是受支持标识。原 Provider HTTP API version/分页/解码不改变，未新增 package。Host source imports 保持 provider 实现只由 `host-providers.ts` 导入；preflight 通过 catalog 构造并按 capabilities DeliveryProvider 契约调用。

## Outcomes & Retrospective

2026-11-09 Batch 2：#583/#584 分别 rebase 合入后，在实际 `main@e3e37adc08496dfa102f00c5bb7269b8585e8452` 上接合。Host 两文件联合 root owner/lifetime、统一 I/O、shutdown 诊断与 CI sequence/account/HEAD/fingerprint fence；本次 README 索引自动联合，不能把初始 clone 的索引冲突当作实际冲突。纳入 credential/http stop 与 cached Development 三条永久测试。候选 `0070b44e27450ef646cf2c6a03d0f96011f2e464` 的产品与测试全树同修复后预演，关键 blob 见 `docs/review/pr-585-mmp-review.md`。

本会话主控运行完整 verify：typecheck、1425 contract、2148 integration、226 E2E，共 3799 pass，零 fail/skip/todo；实际 Chromium 77/77，workflow-check 无 findings、boundaries 9/9。另一独立复评者运行三文件 52/52 与 typecheck，最终原四项加 I/O/cache 交界两项的六项整表变异均 KILLED 且 killedBy 归因正确，前后基线绿、源码还原；无新增可行动 P0–P3。复评者未实现本接合，代码树与预演 blob 相同。工程闭环和独立复评已完成，归档计划；最终 commit 只整理文档/提交身份，产品树必须保持相同，远端条件门不预写结果。

2026-11-09 19:26 +08，在检出 `feature/ci-read-probes` 的工作树根完成本地工程验证。实现前两个 production Host→controller baseline codec 测试均在预期的两轴 `degraded` 处 RED；实现后两种反向权限、同绑定撤权恢复、空/未运行/模糊响应、完整 HEAD、账号/配置/序号/停止 fence、生产 source 与组件展示通过。新用例还实际构建并加载 `lib/index.js` 和 VM 中的 `lib/client.js`，通过 JSON Remote 边界把两个反向观察送入打包表单，19 项全部通过。命令与既有回归入口见唯一验证代码块；完整 `pnpm verify` exit 0，共 3742 项，零 skipped/todo。

无通用权限注册表、持久 grant、新公共 command/schema 或 Provider decoder；同绑定重验零数据库行变更，启动与重启的 baseline 零 CI 请求。观察只证明该次所选仓库与当前完整 HEAD 的一次非空合法读，不证明未来权限、全量 CI 或运行成功。整体 revert 保留原配置与用户 Git。没有有意延期的新技术债。

真实 Desktop 手动重验没有执行，本地 packed fixture 不等于宿主安装接受或人类 UAT/R1。独立代码评审、最终远端回读和 Ready 由交付 owner 在当前 head 上继续（独立代码评审部分 **Superseded by 本节下一段（2026-11-09 19:37 +08）**）；本计划的完成状态仅表示 Batch 1 本地实施和工程验证完成。

独立最终评审（2026-11-09 19:37 +08，观察 head `4d0318001d69e53d823d1668adfe09f06b142848`）未发现 P0–P3 问题或必要重构。reviewer 独立执行 47 项观察/重装配/UI、128 项 Host/Provider/setup/artifact、4 项额外权限/凭据/HEAD 反例，共 179 项行为测试，以及 boundaries 9、typecheck、disclosure、size、diff check 全通过。交付整理核对产品树不变，最终远端 head/base/checks/关联与 threads 仍按门禁回读；不把此结论视为实际 Desktop 人验或 R1。

## Bottom Change Note

2026-11-09 19:02 +08：最终 reviewer 创建单 Batch 自包含计划，裁决显式 ephemeral observation、404 保守映射、same-fingerprint 刷新、验证序号 fence 与真实 client 两轴显示。

2026-11-09 19:24 +08：实现完整回归发现两项旧重装配期待；交付 owner 批准将该测试加入 Global Constraints。显式重验必须刷新 controller，barrier 测试改在 Core 绑定事务的语义入口挂起，继续验证在途 tick 不入旧 Core，而不依赖 preflight 新增只读次数。

2026-11-09 19:26 +08：记录指定 RED、3742 项完整 GREEN、19 项真实打包/CI 观察证据、初次回归失败与语义修正，移入 completed 并更新索引；独立评审、远端回读与真实 Desktop/人类门单独保留。

2026-11-09 19:37 +08：交付 owner 登记独立完整代码验收通过与证据边界，进入最终单提交整理及远端门禁。

2026-11-09：完整 MMP 首审无可行动项；按直接条件授权重新激活 Batch 2，接续实际 main 接合、三条交界回归与最终版本门禁，首审结论不自动沿用到新 head。

2026-11-09：在实际两前序合入版本接合并保留安全诊断；记录3799项、77 Chromium及独立52项/六变异通过，归档计划，最终远端和条件rebase仍逐当前版本核对。
