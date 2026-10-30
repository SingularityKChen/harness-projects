# PR #478 MMP 交付评审

> 首轮 F1 与测试缺口结论已由文末「修复独立复评」取代（superseded）；历史证据保留。当前修复树无遗留 P0–P3。

## Purpose / Big Picture

审查 #434 的连接错误分类与安全恢复是否构成独立闭环。先建立 P0–P3 风险矩阵，再逐文件、逐链路和反例验证；只写评审记录与本工作树运行态探针，不修改实现、不发布 review。

## Context and Orientation

- 评审日：2026-10-30 +08；工作树 `.worktrees/ui-connect-diagnostics`。
- base `main`：`b19b4eac4f12aa40c05d75b492f3335299874641`；head `eafde7d1e32f9f0cb074b0b3317e008c30efa206`；结束前回读未变化，CLEAN、MERGEABLE、非 draft。
- 关联：Closes #434，Refs #427/#413；实现计划 `docs/exec-plan/completed/2026-10-30-ui-connect-diagnostics.md`。#278 是父任务；#435 的 Actions/Checks 探针不在本 PR。
- 当前远端 reviews、inline comments、review threads 均空。锁定 head 的 `PR Fast Gate`、Verify、Merge Gate、CodeQL、规则检查成功。一次 Engineering reconcile 被取消，同 head 后继 `41014085077` 成功；不当作当前失败。
- 使用 Superpowers 独立代码评审、Qian Systems Router、First Principles Development；遇到限流反例后按 systematic-debugging 追踪输入→Host→controller→client→UI。

事实：新增只读 preflight 位于 Core 绑定写口之前；原因是设置 envelope 的闭集细化。硬约束：Host 权威、规划轴正交、失败不落绑定、错误不泄漏原文或隐藏对象、不凭模糊响应断言权限缺失。待证假设：新分类保留独立限流语义、原因仅属于本次失败。

## Design / Spec

按实际控制链审查：`githubViewer / preflightPlanningConnection` → `createConnectionCommands` → Host configure → remote → 严格 client decoder → `workspaceSetupView` → 当前表单。验证拒绝不调用 Core 写口，原因不被 success/unknown/activationError 接受，后续读数与新 intent 不沿用旧原因；不以单个测试或局部成功推断安装态或发布验收。

## 初始风险矩阵

此矩阵在逐文件审查前创建。

| 级别 | 层 | 风险 / 判据 | 初始动作 |
|---|---|---|---|
| P0 | 架构 / 安全 | secret 或原文泄漏、Host 权威或规划轴被改写 | 查全链路、泄漏 canary 与边界 |
| P1 | 代码 / 产品 | connection 失败落库、旧结果污染、权限误归因使核心恢复断链 | 查 controller 拒绝、client 状态机和恢复 |
| P2 | 测试 / 验收 | 诊断分类或测试判别遗漏 | 查失败、异步与限流反例 |
| P3 | 文档 / 设计 | 冗余文案记录、不必要抽象 | 对照 issue、计划、产品说明 |

## Plan of Work

1. 锁定当前 PR、issue、计划、checks 与线程。
2. 先矩阵后逐文件，按架构、实现、产品、测试、验收分层检查。
3. 跑定向回归、独立反例与带 `killedBy` 的变异表，所有变异恢复原字节。
4. 完成全部矩阵后一次性向主会话汇报；由主会话统一发布 inline 意见和安排修复。

## 逐文件审查与完整矩阵

| 文件 / 层 | 检查结果 |
|---|---|
| `apps/harness-plugin/src/host-composition.ts` | connect/bind 都走专属 controller；configure 串行段、激活失败语义保留；未改规划状态 owner |
| `apps/harness-plugin/src/host-providers.ts` | 固定 origin、redirect:error、同一 30s 预算与 secret 句柄边界复用；401、INSUFFICIENT_SCOPES、NOT_FOUND/null 的闭集输出安全；发现 F1 的限流分类回归 |
| `packages/controller/src/connection-commands.ts`、`index.ts` | 明确设置包装器；失败先于 Core 写口，cause/code 组合相容；没有全局错误枚举扩张 |
| `packages/client/src/connection-failure.ts` | 原型、额外键、cause、state、recovery、retryable、activationError 组合严格检查，原文不参与归因 |
| `packages/client/src/workspace-setup.ts` | 仅 connect 当前版本的安全失败携带原因；pending、新 intent、读失败、dispose 清除；确定失败才换 stage attempt，unknown 保留原 key |
| `packages/client/src/repository-binding.ts` | 复用 account 消费者接受并校验专属字段，仓库命令不能携带；展示仍保守，不把连接原因扩入仓库产品范围 |
| `packages/ui-model/src/workspace-setup.ts`、`packages/ui/src/workspace-setup.ts` | 闭集固定文案、纯展示，平台标签由现有 UI 注入；未新增伪凭据按钮；F1 会失去 retry 动作 |
| `tests/contract/ui-connect-diagnostics.test.js`、`ui-workspace-setup.test.js` | 合同非法组合和读回/销毁覆盖有效；pending 清旧 cause 的回归断言缺口见变异表，当前代码本身正确 |
| `tests/integration/harness-plugin-connect-diagnostics.test.js` | 真实 Host/controller/remote/source/SSR 与 SQLite 零绑定覆盖有效；名为 secondary 的用例只覆盖带 `RATE_LIMITED` type，漏掉既有无头/无 type 形态 |
| `docs/README.md`、实现 ExecPlan、`docs/product/ui-forms.md` | 索引、范围和恢复说明自包含；计划第31行承诺保留已知 secondary-rate，与 F1 的实现不符；无额外 P3 |

| 级别 | 最终结论 | 关键证据 |
|---|---|---|
| P0 | 未发现 | canary 不入 remote/snapshot/SSR，边界 9/9，无 schema 或规划状态变更 |
| P1 | 未发现 | 三类拒绝零 Core 设置调用/零绑定；strict 与 dispose 变异被命名测试杀死；旧 cause 当前实现清除 |
| P2 | F1 一项 | 无限流头的已知 secondary rate response 经新增 preflight 后丢失既有分类与恢复 |
| P3 | 未发现 | 已读完整15文件差异；未发现需要机械整理的问题或超出范围的设计 |

## Finding F1 · P2 · 保留无响应头二级限流的重试分类

新增行锚点：`apps/harness-plugin/src/host-providers.ts:134-136`，最小 inline 锚点第136行。

当 `/user` 正常，而 `PlanningProject` 返回 HTTP403、无 `retry-after`/`x-ratelimit-remaining`，正文为 `You have exceeded a secondary rate limit...` 时，新 `rateLimited` 没有识别既有分类器已支持的证据。绑定预检提前返回 `permission_denied/fix_permission/retryable=false`；当前表单只引导检查访问授权，没有重试按钮。它没有伪造 `permission_missing` cause，但仍把暂时限流的恢复引向授权检查。HTTP200/errors 仅含同一 message、无 type 时从既有 `rate_limited` 退为 `unavailable`；此分支尚保留 retry。

同输入对照：实际 base Host/source/SSR 为 `rate_limited/retry/true`、degraded、一个本地绑定、显示重试；head 为 `permission_denied/fix_permission/false`、unbound、零绑定、不显示重试。零绑定是本次预检的预期改进；分类与恢复退化是独立问题。未改的 `packages/providers/planning-github-projects/src/classify.ts:30-42` 与既有映射测试已经支持这些形态。#434 明确要求保留独立限流行为，实施计划第31行也承诺已知 secondary-rate 保持 rate_limited。

修复方向：最小复用已有安全分类，保留当前结构化 RATE_LIMITED 优先级；可从 provider index 重导出纯 `classifyResponse`，Host 只读取其 `code === rate_limited`，或提取该已存在的 secondary predicate。不要回传 message/requestId/rawClass，也无需新跨包基础设施。补真实 Host→UI 的无头403、无type200、正文伪近似词反例，断言 code、retryable、重试动作、零绑定和零原文泄漏。当前通用 `permission_denied` fallback 不能单独当作权限缺失证据。

已有工作项核查：#434/#278 正是本连接闭环；查询全部状态的 secondary-rate issue 无结果。#144/#457 是运行期访问/降级，TD-061 记录 provider 分类重复的泛化债务，均没有替代本新增 preflight 的具体恢复回归。

## Validation and Acceptance

执行上下文均为本工作树，除 `--base` 探针只读引用主工作树的锁定 base 源码。

| 命令 / 观察 | 真实输出 |
|---|---|
| PR正文列出的七文件 `pnpm test:file`（setup commands、Host setup、connect diagnostics、repository binding、UI setup、UI connect、UI-model presentation） | 111 tests，111 pass，0 fail/cancel/skip，exit 0 |
| `pnpm test:file tests/contract/planning-github-projects-mapping.test.js` | 58/58，exit 0；包含无头403、无type200二级限流 |
| `pnpm typecheck` | `tsc --noEmit`，exit 0 |
| `pnpm run boundaries` | 9/9，exit 0 |
| `git diff --check b19b4eac4f12aa40c05d75b492f3335299874641...HEAD` | 无输出，exit 0 |
| `node scripts/rule-checks.mjs disclosure b19b4eac4f12aa40c05d75b492f3335299874641` | 机械扫描通过，exit 0；人工五类检查未发现新增泄漏 |
| `node scripts/rule-checks.mjs size b19b4eac4f12aa40c05d75b492f3335299874641` | tracked PR 代码310/1000、文档145/1500，exit 0；不含本未提交评审记录 |
| `node .superpowers/pr478-review/rate-probe.mjs` | 三种输入既有 classifier 都是 rate_limited，新 preflight 分别 permission_denied、unavailable、permission_denied；exit 0 |
| `node .superpowers/pr478-review/host-secondary-probe.mjs --base` | 403与200均 rate_limited/retry/true、显示重试；exit 0 |
| `node .superpowers/pr478-review/host-secondary-probe.mjs` | 403 permission_denied/fix_permission/false、无重试；200 unavailable/retry/true；均零绑定；exit 0 |
| `node .superpowers/pr478-review/pending-cause-probe.mjs` | 5 assertions passed，下一目标 pending 前清旧原因；exit 0 |

首次跨树 SSR 探针因混用两份 React 副本出现 invalid hook call；改为 renderer 跟随目标树后，base/head 分别成功。该探针故障不计为产品失败。

### 变异表

使用 `node scripts/review-mutate.mjs .superpowers/pr478-review/mutations.json`；命令为三文件 Node tests（UI connect、UI setup、Host connect）。基线和恢复后基线均绿、逐字节恢复；SUMMARY 如下。脚本因一项 SURVIVED 预期返回1，外层日志读取命令返回0，二者不混同。

| 变异 | killedBy | 结果 |
|---|---|---|
| controller-preflight-bypass | controller connection refusal never invokes Core settings | KILLED，多数真实 Host 拒绝用例也红 |
| connection-extra-key-bypass | strict connection detail rejects extra keys | KILLED |
| pending-retains-old-cause | cause only survives current connect readback | SURVIVED；当前实现正确，现有测试缺少“已有原因→延迟的新提交→pending立即断言清空” |
| dispose-retains-old-cause | cause only survives current connect readback | KILLED |

此覆盖缺口不另造实现 finding；独立 pending 探针已证明当前实现正确。建议修 F1 时补已有原因后的延迟新目标断言，确保同类未来回归可见。

## Progress

- [x] 锁定事实、读取规则/issue/计划/所有线程，建立初始矩阵。
- [x] 全15文件差异与周边状态链路分层审查完成。
- [x] 定向111、既有限流58、类型/边界/发布面/规模检查与独立反例完成。
- [x] 完整变异表及恢复后基线完成，生产文件无遗留改动。
- [x] 全矩阵一次性汇报主会话，未发布远端 review。

## Surprises & Discoveries

现有名为 secondary 的 Host 用例使用 RATE_LIMITED type，不覆盖平台可能只有 message 的已知形态；新增 gate 会拦住既有 provider，因此局部分类变化足以改变完整用户恢复。pending 测试名字声称清原因，但相应 mutation 存活；独立延迟探针补证实际代码正确。

## Decision Log

2026-10-30 +08：F1 定为 P2，原因是限流恢复误导及独立分类语义回归，没有数据破坏、secret 泄漏、假成功或严重权限边界突破；完整矩阵未发现 P0/P1。不因测试名字或绿色111项放弃限流反例。当前仅有 P2，按仓库映射可 APPROVE；修复与独立复评由主会话协调，合并仍需人类授权。

## Idempotence and Recovery

评审不改变 Git index、HEAD、commit 或远端状态。变异工具按字节还原；临时 SQLite 在探针 finally 中关闭并清除。回滚该能力仍以整个 PR 为单位，保留用户账号、secret句柄和外部事实。只新增本记录，运行态证据留 `.superpowers/pr478-review/`。

## Interfaces and Dependencies

未提出反向依赖或 runtime 权限第二事实源。F1 的最小修复可复用同一 Provider 已有纯分类器；需要保留闭集输出与脱敏。#449/#143 人类安装态UAT、R1及#435不由本评审代验收。

## Outcomes & Retrospective

锁定 head 全矩阵完成：0 P0、0 P1、1 P2、0 P3；另记录一个当前实现正确的测试判别缺口。没有运行全量 verify、真实 GitHub 限流或安装态浏览器，本地定向与SSR证据不替代托管CI、线上测量或人类UAT。主会话将独立复核并统一发布新增行意见。

## Bottom Change Note

2026-10-30 +08：首次独立审查，先矩阵后全文件；记录真实base/head限流反例、定向与变异证据，生产与远端状态未改。


## 修复独立复评 · 2026-10-30 +08

本节 supersedes 首轮 F1 未修复、pending 变异 SURVIVED 及首轮尚有1项P2的结论；首轮输入、输出与变异表保留为修复前证据。复评对象为 `eafde7d1e32f9f0cb074b0b3317e008c30efa206` 之上的未提交修复树，生产/测试四文件差异 SHA-256 为 `8360747749f7ac9d54ffe6dd6d48c96fcdcbb1dfe93867abb112ea08c236c9f8`。最终提交、push和当前远端CI由主会话重新锁定，不把本次结果冒充未来head证据。

### 修复与边界判定

- provider `src/index.ts` 仅把既有纯函数具名重导出为 `classifyGithubPlanningResponse`，没有复制分类算法、引入新依赖、创建新包或运行态权限 owner。Host 原已合法依赖该 provider；此出口是复用同一分类规则的最小补充。
- Host `rateLimited` 保留显式 RATE_LIMITED/type 的优先短路，随后仅消费既有 classifier 的闭集 `code`。其 `message`、`requestId`、`rawClass`、`retryAfterMs` 均未进入设置 envelope。传入 `Date.now()` 仅参与 classifier 的等待时间计算，本调用不消费该时间字段，不影响 code 归因或权威状态。
- 新增五个真实 Host 案例覆盖 bind/viewer 的无头403、无type200及近似词403；rate 分支新增 `retryable/recovery/SSR重试按钮` 断言，原有零绑定和 canary 断言继续生效。没有把普通拒绝升级为 permission_missing。
- 新增“已有原因→新目标延迟account响应→pending立即检查”用例，精确覆盖首轮存活变异。实际实现无改动，补的是可失败断言。
- 相关矩阵重新核对：P0 脱敏/权威、P1 失败零写与原因时序、P2 限流恢复、P3 规模/文档/抽象均无新增可行动缺陷。未把安装态、真实平台授权或R1并入本结论。

### 独立执行与来源区分

| 证据 | 结果 |
|---|---|
| 独立 `pnpm test:file tests/integration/harness-plugin-connect-diagnostics.test.js tests/contract/ui-connect-diagnostics.test.js tests/contract/planning-github-projects-mapping.test.js` | 88/88，0 fail/cancel/skip，exit 0 |
| 独立 `pnpm run boundaries` | 9/9，exit 0 |
| 独立 `pnpm typecheck` | `tsc --noEmit`，exit 0 |
| 独立 `git diff --check` | 无输出，exit 0 |
| 独立原F1 `node .superpowers/pr478-review/host-secondary-probe.mjs` | 无头403、无type200均 `rate_limited/retry/true`、unbound、零绑定、重试按钮存在、无授权误导 |
| 独立 `node .superpowers/pr478-review/rate-probe.mjs` | 上述两种与 FORBIDDEN+secondary 均与既有 classifier 一致为 rate_limited |
| 独立 `node .superpowers/pr478-review/pending-cause-probe.mjs` | 5 assertions passed，旧原因在新目标pending立即清空 |
| 已读取主会话 `.superpowers/review478-fix-red.log` | 修复前四个新增真实Host限流案例分别因 permission_denied、unavailable 或伪local_only而红；其余21绿，能够判别原根因 |
| 已读取主会话 `.superpowers/review478-final-mutations.log` | 四项全部KILLED；pending变异命中新增延迟用例；主会话报告逐字节恢复。未重复并行变异 |
| 主会话执行报告 | 七文件+provider分类175/175；本项为委派方报告，不冒充本评审独立执行 |

结论：原 F1 已消除，首轮测试判别缺口已补齐，当前修复树 **0 P0、0 P1、0 P2、0 P3**；可按仓库流程进入归档与最终提交后的远端回读。复评未commit、push、发布review、回复/resolve或合并。计划 active/归档路径与“拒绝message关键词解释”的限流例外说明交主会话在归档时统一收口。

主会话补充完整本地回归（原审查者独立窄测之外）：`node scripts/resolution-check.mjs`、`node node_modules/typescript/bin/tsc --noEmit`、`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e`、`node --test --test-timeout=120000 tests/mvp0` 均exit0；2597+7 tests、0失败/跳过，输出分别保存于本工作树运行态日志。此为修复后未提交产品树证据，不冒充托管CI。
