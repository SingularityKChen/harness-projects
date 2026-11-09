# PR #585 MMP 交付评审

## 锁定事实与边界

- 评审 head：`f4d7879313c75e2477dff2b75f1c48ce82234f14`；base：`c9bb17b833295f26c750bd8c4bf425df53e9701f`；目标 `main`。结束前再次回读，未漂移。
- 执行上下文：`.worktrees/ci-read-probes-20261109`；开始时工作树干净。只新增本评审证据；变异由仓库夹具临时施加、按字节还原，不修改实现或提交 review。
- PR `feat(apps): Observe Actions and Checks read access independently`，Closes #435；单个交付提交。评审时 Ready、MERGEABLE、UNSTABLE；reviews/comments/reviewThreads 均空。
- 已读根 `AGENTS.md`、`README.md`、`docs/review/mvp-review.md`、`docs/review/README.md`、completed ExecPlan、#435 当前验收、完整变更与直接消费路径。
- 使用 Superpowers 评审约定、Qian Systems Router 和 First Principles Development。目标是验证两轴独立、证据生命周期、Host 权威和可恢复用户闭环。

## P0/P1/P2/P3 风险矩阵

本矩阵在逐文件审查前建立，以下已回填最终观察。

| 严重度 | 层 | 风险与判别条件 | 最终证据/结果 |
|---|---|---|---|
| P0 | 架构/安全 | secret、第二权限权威、Planning 状态污染、反向依赖 | 没有新增 authority/schema/wire；原 capability 路径；数据库前后深等、token/raw canary 负断言、Planning policy 不变；boundaries 9/9 |
| P1 | 代码 | Actions 成功错误建立 Checks；空/错误 HEAD/无观察建立 available | 真实 Host 两种相反权限、empty/wrong-head/unborn/startup 对照通过；M1/M2 被指定测试杀死 |
| P1 | 状态/并发 | 账号/仓库/HEAD 变化后旧 observation 激活；重验竞争覆盖新结果 | account/binding/HEAD/stop、旧验证迟到、装配期间新验证开始用例通过；M4 被装配竞态杀死 |
| P1 | 错误与恢复 | 404、rate limit、offline 被当作确定拒绝；失败停用无关功能 | 404/403 exhausted/429/offline/malformed 均本轴 degraded、另一轴 available；拒绝轴不阻断 Development active |
| P2 | 产品闭环 | capability 显示与消费者 gating 不一致；降级缺恢复入口 | 复用原 permission snapshot/controller baseline；client 精确所选 repo+独立 key；表单重验入口和 packed Host/client JSON boundary 通过 |
| P2 | 测试 | 两轴/负例/打包边界缺判别；虚假验证 | 最终还原树 175/175；4 个变异 KILLED 且有 killedBy；没有把完整作者 verify 冒称本次执行 |
| P2 | 工作项 | #435 acceptance 不闭合、ExecPlan/规模/重复追踪遗漏 | #435 关联正确；376 代码/test 加删、133 文档加删；既有 TD-074/#278/#364 和安装人验门单列 |
| P3 | 设计 | 生命周期过度复杂或重复状态；文案/证据不明 | 最小 Host 内 observation 和序号，没有持久授权/新命令；同 fingerprint 装配有必要且 M3 有判别；无必要重构 |

## 分层调查

### 代码、错误分类与事实归属

`apps/harness-plugin/src/host-repository-binding.ts:44–63` 仅在完整当前本地 SHA 上调用两个真实 Provider 方法。Actions 与 Checks 独立 `observe`、并行执行；仅合法非空成功建立 available。已有 Provider 验证精确提交/引用/分页形状，Checks 必须通过 suites 与 check-runs；suites 成功、runs 403 仍为 unavailable。permission_denied 单轴 unavailable；其余失败和空/未观察 degraded。404 不会被冒称确定拒权。失败响应正文不回显。

`apps/harness-plugin/src/host-composition.ts:375–389` 的 observation 受单调显式验证序号、完整账号 stamp、本地 HEAD 与配置 fingerprint 约束。事务前和候选装配后复核；最后发布前同步序号检查覆盖“新验证已开始、旧装配正在完成”。`configure:308` 的 same-fingerprint 刷新是必要机制，不能为了避免重装配去掉。`host-providers.ts` 只把匹配本 workspace/binding/repo/account 的观察送入既有 permission keys，后续无 observation 装配和 restart 均回到保守状态。

凭据 stamp 包含账号身份与 secretHandle 标识，不保存 token。每次实际请求仍由宿主解析凭据；本功能提供一次显式读取的历史观察，不承诺未来权限、凭据秘密值或远端撤权的持续实时有效性。账号句柄/绑定配置变化、Host stop 和 SHA 变化均有失效测试；没有把历史读取升级成持久 grant。未观察到凭据进入数据库、wire 或诊断。

### 用户闭环、消费者与架构

真实 controller baseline 的仓库 capability 是 client 两轴显示的唯一输入。`packages/client/src/repository-binding.ts` 精确匹配所选 repository；缺失、重复、非法 capability 都降级。取消/切目标不发布迟到结果；CI 拒绝不使 Development 的 active 判定失败。表单显示独立可用/不可用/未确认文案，active 时按钮提供“重新验证仓库与 CI”。现有 Core 消费路径仍根据原 permission keys 门控每个交付集合，不由 client 显示值授予权限。

本次没有跨层 dependency、额外权限注册表或第二 Planning 状态。观察不写持久配置，同仓重验数据库表深等；startup/restart 不探测 CI。实现规模适量，序号和重装配保护均有可导致错误结果的反例支持，无需为本闭环额外抽象注册表或拆分模块。

多仓库默认 delivery 限制属于 `docs/exec-plan/tech-debt-tracker.md` 的 TD-074：`packages/core/src/workspace-setup.ts` 明确拒绝第二个启用交付来源，现有 Provider 对 foreign ref fail closed。没有把此既有边界重复报成本 PR 新缺陷。#278 的连接分型父任务、#364 的评审端点故障均为既有独立范围；本次没有需新增重复追踪的行动项。

### Issue 验收与证据边界

| #435 验收 | 观察 |
|---|---|
| 两种反向权限经真实 controller 独立快照 | 两种场景进入生产 Host/catalog，并经 baseline codec、client 和表单准确显示 |
| 缺 head、模糊错误、空/未运行不能建立可用 | unborn 无 CI 请求；empty、wrong-head、offline、限流、404、坏体保持 degraded；startup 零请求 |
| 撤权不改 Planning 或停用无关工作，凭据不新增持久化 | revoke→recover、数据库全表深等、Planning policy/Git 状态不变；CI 单轴拒绝仍 active |
| 无凭据 transport fixtures 与安装件能显示同一显式结果 | packed Host 与 client 的真实导出入口，经 JSON Remote 边界渲染两种相反权限；fixture 使用临时 Git/SQLite，不调用真实凭据 |

真实 Desktop 安装后的人工显式重验本次未执行；packed 入口证明安装件接线和显示路径可运行，不等同真实账号网络、Desktop 人类接受或 R1。不能仅因没有人工安装就否定已验证功能链，也不能用 fixture 替代既有人类门。

## 最终验证命令与结果

以下均在上述 worktree 根运行，最后一组在所有变异还原后执行。

```text
pnpm test:file tests/integration/harness-plugin-ci-access.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/contract/ui-repository-binding.test.js tests/contract/delivery-github-actions-contract.test.js tests/integration/harness-plugin-repository-binding.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/workspace-setup-commands.test.js tests/integration/harness-plugin-host-github-catalog.test.js tests/integration/harness-plugin-artifact.test.js
pnpm typecheck
pnpm boundaries
node scripts/rule-checks.mjs disclosure c9bb17b833295f26c750bd8c4bf425df53e9701f
node scripts/rule-checks.mjs size c9bb17b833295f26c750bd8c4bf425df53e9701f
git diff --check c9bb17b833295f26c750bd8c4bf425df53e9701f
```

行为测试 175/175，零 fail/cancelled/skipped/todo；typecheck exit 0；boundaries 9/9；disclosure、size、diff check exit 0。原始 diff 人工五类目核查未发现凭据、本机身份、个人信息、内部系统或保密字样泄漏。首次窄集 61/61 亦通过；不累计为互不重叠 236 项。本次没有重复完整 `pnpm verify`，作者完整验证与 hosted CI 属各自来源。

## 变异判别表

仅用 `node scripts/review-mutate.mjs <spec.json>`，command 为 `node --test --test-timeout=120000 tests/integration/harness-plugin-ci-access.test.js`。初探 M4 的 killedBy 误选了旧验证迟到测试，夹具诚实报告 KILLED_OTHER；校正为实际装配竞态后，在最终实现树整表复跑一次，以下为该次结果。夹具基线/还原后基线均绿，并逐字节确认还原。

| ID | 文件和变异 | killedBy（用例名片段） | 最终结果 |
|---|---|---|---|
| M1 | `host-repository-binding.ts`：`checksAccess = observed[1]!` 改成 `observed[0]!` | `explicit bind independently observes Actions` | KILLED |
| M2 | 同文件：非空判定 `items.length > 0` 改成 `>= 0` | `ambiguous empty remains degraded` | KILLED |
| M3 | `host-composition.ts`：重装配条件删除 `|| ci` | `same binding explicitly revalidates revoke and recover` | KILLED |
| M4 | 同文件：`isCurrent` 删除验证序号比较，仅保留 `!closed` | `a newer validation starting during assembly prevents the old candidate from activating` | KILLED |

## 当前 GitHub checks 与门禁

- 必需 `PR Fast Gate`（run `42610514578`）成功；CI typecheck/契约与 Browser lane 均成功。
- 取消的 Rule checks `42610514791` 后同 head `42610516836`、`42615558174` 成功；Issue policy 取消项亦有同 head 成功后继。
- `Reconcile engineering state` 的 `42615558967` 被取消；全域并发后继 `42615564251`、`42615899337`、`42617560481` 成功，符合仓库记录的全域重算语义。
- `Create review session` run `42611400938` 的 forward 步骤日志实际返回 HTTP 404，已有 OPEN #364；属于独立可选评审自动化，不在分支保护必需门。没有隐去这一红项。

## 结论与交接

本 head 未发现可行动 P0/P1/P2/P3，建议 `APPROVE`，无 inline 行项。#435 的工程功能链和可逆闭环成立；真实 Desktop 人验、其他 release gates 与合并授权保持独立。评审方没有提交 review、commit、push、改 issue 勾选或合并；最终正式 review 由主控一次性提交，开发 owner 再收录本证据。最终工作树只新增本文件。

## 最终 Host 接合独立复评（2026-11-09）

初审 head 的结论保留为历史；本节验收实际基线 `e3e37adc08496dfa102f00c5bb7269b8585e8452`（#584 已合并）上的本地候选 `0070b44e27450ef646cf2c6a03d0f96011f2e464`。reviewer 未实现 #584/#585；先静态审查仓库外前序预演 `781d70c4`，待主控完整验证结束后才在 `.worktrees/ci-read-probes-20261109` 独立运行，未并发修改源码。

- 实际 apps/packages/tests/scripts、package/lock 与 `.github` 全树和 `refs/backup/pr583-pr585-expected-integration-20261109`（`2638c8d`）一致；三个关键 blob 与静态预演逐字相同：composition `3a4002f11f8912032ce9f25ac270d7cbd34c6a65`、providers `6cd873b2ed6a3e4e066cad5e4ddc427f7aae9d0f`、CI 测试 `2128a9e103393ddde66ab0dd5837e936b59c9559`。变异还原后再次核对相同。
- #584 的 host/remote/lifetime/session-adapter 四文件相对基线未改；composition 保留 owner、同一 stopDeadline、assemblies retire、diagnoseShutdown、安全错误投影与 Host-scoped fetch/credential/body。#585 preflight 明确经 `io.wait(..., Infinity)` 与该 Host I/O，restoreProviders 同时接 ci 和 assembly lifetime；CI 序号/accountStamp/HEAD/fingerprint/候选装配后检查/发布前同步 isCurrent 均保留，没有从 raw options 旁路。
- 三条 combined 探针覆盖 preflight 凭据等待与真实 Actions HTTP 等待的停止、有界 dispose、迟到结果零后续 HTTP/持久绑定/装配激活；HTTP 实际 signal 已 abort。凭据探针挂首凭据解析，可能仍在 Development preflight，不冒称单独隔离后续 CI 凭据阶段。缓存探针复用一个真实 Development port，旧装配 retire 后 `getRepository` 仍实际发送 GraphQL，撤权/恢复均可读；不是只检查缓存对象身份。
- 独立命令 `pnpm test:file tests/integration/harness-plugin-ci-access.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/integration/harness-plugin-host-lifetime.test.js` → **52/52，零 fail/skip/todo**；`pnpm typecheck`、`git diff --check` exit 0。实际 Cordis 正常/超限/reject 清理诊断及 SQLite create/checkpoint/prompt 迟到窗口也在本窄集通过。
- 交付主控另行报告并读取实际 candidate 日志：完整 `pnpm verify` **1425 contract + 2148 integration + 226 E2E = 3799**，零 fail/skip/todo，Chromium **77/77**、boundaries **9/9**；这是主控来源，未冒称为本 reviewer 重跑。

最终完整六项变异只在上述最终树整表执行一次：`node scripts/review-mutate.mjs .superpowers/pr585-final-integration-review-20261109/mutations-final.json`，完整输出在同目录 `mutations-final.log`。exit 0，前后基线绿、逐字节还原，6/6 KILLED，无 KILLED_OTHER/SURVIVED/NOT_APPLIED；不把基线重跑与 52 项相加。

| 变异 | killedBy（实际失败用例名片段） | 结果 |
|---|---|---|
| M1 两轴错误共享 Actions 观察 | `explicit bind independently observes Actions` | KILLED |
| M2 空集合错误建立 available | `ambiguous empty remains degraded` | KILLED |
| M3 删除 same-fingerprint 的 CI 重装配 | `same binding explicitly revalidates revoke and recover` | KILLED |
| M4 绕过验证序号 | `a newer validation starting during assembly prevents the old candidate from activating` | KILLED |
| M5 preflight 改用 raw fetch/credential、外层 io.wait 保留 | `combined CI http wait aborts on Host stop without late activation`（实际 signal abort 断言） | KILLED |
| M6 缓存 Development 凭据错误归旧 assembly lifetime | `combined same-bind CI revalidation keeps the cached Development port usable across retirement`（retire 后真实 getRepository） | KILLED |

最终独立结论：接合差异与全部矩阵未发现新增 P0–P3，可继续当前候选的远端 head/base/checks/threads 门禁与授权收尾。产品/测试树完整保持已审版本，变异后仅本记录待收录；reviewer 未改实现、Git、远端或规划字段。真实 Desktop 手动重验、未来权限与人类 R1 仍独立，fixture/local green 不扩大接受范围。
