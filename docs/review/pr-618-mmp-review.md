# PR #618 MMP 交付评审

观察日期：2026-11-11（Asia/Singapore）。阶段：当前锁定 head 的独立 MMP 审查完成；未提交 GitHub review。

## Purpose / Big Picture

独立判断 PR #618 是否构成可验收、合入和回滚的 MMP 工程闭环。先覆盖各级风险，再用代码、产品流与反例检验；测试结果不代替安装和人类接受。

## Context and Orientation

- head：`2655cdbf07f2dd340242e5cbe3fdc3c4582a1654`；base：`main` @ `063e427a719bd2ba2c50391279ee5b81f5f5bd56`。
- 执行上下文：检出 `fix/code-scanning-hardening` 的 `.worktrees/code-scanning-hardening` 根目录。
- 工作项：#617；远端回读：`gh pr view 618 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,mergeable,mergeStateStatus,isDraft,closingIssuesReferences`。
- 事实与未知：实现会话已找到；独立审查需重新验证产品结果，CI 绿不能替代验收。

## Design / Spec

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 合并即破坏主流程或泄露数据 | 错误状态、越权、失败恢复断裂 | 可恢复边界错误 | 冗余与可维护性 |
| 产品闭环 | 权威事实损坏 | 来源→持久化→展示→操作链断裂 | 非核心交互与提示缺口 | 文案一致性 |
| 架构 | 七条不变量/信任边界破坏 | 事实拥有权、依赖边不正确 | 不必要耦合 | 局部简化 |
| 测试/反例 | 安全假绿 | 关键失败路径无判别证据 | 次要缺口与过度测试 | 组织与命名 |
| 工作项/设计 | 无法独立交付或回滚 | issue 验收不成立、范围遗漏 | 证据或既有追踪缺口 | 记录清晰度 |

## Global Constraints

遵守七条不变量和层级依赖；子评审只读产品，仅写本记录；主审收尾不改产品文件。外部评审使用 gh-review，开发/提交/合并使用 gh。

## Plan of Work

锁定事实 → 全级别矩阵 → 分层审查与最窄反例 → 一次完整 review → 当前版本条件收尾。命令及结果统一在 Validation and Acceptance 记录。

## Validation and Acceptance

### 审查证据

本轮对照不可变 base/head 审读全部差异、#617、completed ExecPlan、W3 文档及调用入口。新增尾部扫描精确消费最大连续 `/`、`\\` 后缀，并保留全分隔符输入的原回退；其他 realpath、根包含、悬空/种植链接和拒绝顺序未变。`isPinnedUse` 先检查定长 SHA 再将路径拆成互不重叠段，分段总扫描与输入长度线性相关；step 与可复用 job 共用判据。合法子路径保留，空段、额外 `@`、尾部空白拒绝。本地 `./` 豁免及未验证远端仓库存在性属于原有职责边界。

HTML 用例真实调用详情/列表 SSR，逐字确认恶意文本仍以转义文本存在，再检查不分大小写且含空白、`/`、`>` 分隔的危险标签。不存在只隐藏输入得到假绿的情形。它们增强测试判据，没有改变产品 HTML 渲染实现；不能据此声称完整 XSS 审计。

| 层 | P0/P1 结果 | P2/P3 结果 |
|---|---|---|
| 代码 | 未见新增阻塞；长路径、step/job 畸形输入在有界子进程内完成 | 未见可行动问题；路径正常尾部与根保真 |
| 产品闭环 | #617 四条行动项形成修复→完整入口拒绝→可见转义文本闭环 | #7/#8 测试文本用途有明确说明，无扫描豁免 |
| 架构 | 无新事实源、依赖、Provider/规划写入或门禁权限变化 | 只变更私有校验与测试，无额外兼容层 |
| 测试/反例 | 三个长输入都穿完整入口；两处 SSR 保留正控 | 本轮 159 项全部通过；没有执行产品代码变异 |
| 工作项/设计 | #617 的 scope/验收及 completed 计划与 diff 一致 | 单提交；代码远低于上限；原历史 main 告警待合并后扫描 |

### 验证与锁定状态

执行上下文为本记录开头的 worktree、head `2655cdbf`，命令与实际输出：

- `pnpm test:file tests/contract/workflow-check.test.js tests/integration/development-local-git.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-list.test.js`：退出 0，159 tests / 159 pass / 0 fail / 0 cancelled / 0 skipped。路径长输入约 176ms；step/job 长输入约 138ms/133ms（只是本次观察，不作性能承诺）。
- `node scripts/workflow-check.mjs`：退出 0，`no findings（已检查 7 个文件）`。
- `git diff --check 063e427a719bd2ba2c50391279ee5b81f5f5bd56...HEAD`：退出 0，无输出。
- 锁定缓存中的远端事实：OPEN、Ready、MERGEABLE、`UNSTABLE`；唯一提交即锁定 head；closing issue #617；所有 review threads 为空且 `hasNextPage=false`。Verify、Browser、PR Fast Gate、CodeQL 两分析和当前 Rule checks 成功。重复 Rule/Issue 运行有 cancelled，后继同名检查成功。可选 `Create review session` 失败由协调评审统一核对原因，不将其误当 required check。
- 检查 open issue 清单：相关 #617；可选评审入口故障另有 #364；未发现应重复登记的新增缺陷。

## Progress

- [x] 2026-11-11：锁定 immutable head/base、全矩阵独立审查和本记录所列验证完成。
- [x] 2026-11-11：主审追加真实组合证据、公开面/版本回读及直接条件授权；后续合并以远端实际 ack/readback 为准。

## Surprises & Discoveries

可选评审回调真实日志为 HTTP 404，已有 #364。已确认的测试/产品边界与未验证项见验证及结果；未把缓存或历史绿色当作新 head 通过。

## Decision Log

2026-11-11：主审重新核实两个账号、全部线程分页与每个可选评审失败的真实 run 日志：本地回调 HTTP 404，已有 #364，非 required gate。当前发现集合为空，按本会话直接点名的条件授权进入 APPROVE、文档收尾及当前版本 rebase 门；正常工程验收不推进 Planning Status。

本轮四项按 #618 → #619 → #620 → #621 顺序完整预演，只有文档索引并列插入冲突。组合 `1ae1a3246df07747ca39f33c89bec17c92f15f6f` 的 typecheck 和 4033 个 contract/integration/E2E 用例通过，独立组合权限/WAL/详情 59/59；48 个不重叠产品/测试 blob 与原各 head 相同，共享详情测试保留双方安全及日期断言。逐最终 head 的发布门不从此历史观察推导，须再次回读。

组合浏览器进一步实际通过 110/110，boundaries 9/9，workflow 7 文件无 finding；本轮无产品修复。

## Idempotence and Recovery

只读测试与临时根可重跑；原始发布 head 保存于本轮 refs/backup。最终 push 使用精确 lease，合入前可恢复备份，合入后按能力提交 revert；不删除用户数据。

## Interfaces and Dependencies

依赖本仓库 Node/pnpm、现有 Provider/Storage/Host 合同及 GitHub 两套身份。各命令的检出与执行上下文由 Context and Orientation 锁定。

## Outcomes & Retrospective

未发现当前 diff 新引入且可复现的 P0–P3 可行动项；无英文 inline 建议。建议在协调者完成远端最终回读和可选失败原因核实后进入 APPROVE 条件。本轮未重新执行全套 `pnpm verify`、独立变异表或 CodeQL，本地窄测与缓存托管结果分别记录，不混作同一来源证据。main 历史告警关闭、完整 Host/浏览器安全、人类安装验收及 R1 接受不在此评审结论内。未改产品代码、commit、push、规划字段或 GitHub review。

## Bottom Change Note

2026-11-11：记录独立 MMP 风险矩阵与证据；主审按仓库要求整理为 PLANS.md 的 13 章节，保留原观察、反例与不确定性。
