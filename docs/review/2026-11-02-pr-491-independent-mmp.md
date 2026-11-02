# PR #491 独立 MMP 交付评审

## 锁定事实

- 日期：2026-11-02；评审账号 Singularity-AI-Bot，作者账号 SingularityKChen。
- 评审 head `61ba65a175131f0578504fd2d9c3734f4dcaab3a`；直接 base `feature/pull-request-command-recovery` / `1b7a8f104435a3e2d94507f62770a8334a0be32b`。
- 执行上下文 `.worktrees/pull-request-detail-recovery`；单 capability commit，Ready，全部 review threads 为 0（协调者实时回读）。
- PR Fast Gate、Merge Gate 成功；可选 Create review session 失败的 annotation 是本机 DSH endpoint answered 000000，已有 #364 跟踪（协调者核验），不是产品测试失败。
- 范围为本 PR 相对直接 base 的全部 21 文件 diff；父层后端由 #495 独立评审，不把累计栈当本层规模。
- 方法：Superpowers 独立子评审、Qian 系统接口与闭环综合、First Principles 状态拥有和故障反例；浏览器按 Playwright skill 复跑。
- 正式规格：[详情创建与恢复 ExecPlan](../exec-plan/completed/2026-11-02-pull-request-detail-creation.md)。作者历史结果仅作线索，以下测试与浏览器结果均独立执行。

## 先行风险矩阵

| 级别 | 风险与判据 | 所需证据 | 最终结论 |
|---|---|---|---|
| P0 | main 破坏、秘密发布、规划权威越界、数据丢失 | 依赖与发布扫描、持久化契约、写入拥有者 | 未发现；本层不改数据库、Planning 或 Provider 写状态机 |
| P1 | 重复外部执行/PR、虚假 Saved、重启恢复失效、权限或并发绕过 | 当前源码、公开入口故障注入、真实 SQLite/Host 边界 | 未发现；真实浏览器双故障路径及末尾授权/目标窗口通过 |
| P2 | 局部恢复/错误提示、测试盲区、issue 闭环不足 | 反例、验收映射、同问题 issue 排查 | 1 项：F1，failed 被初始提示吞掉 |
| P3 | 文档、命名、范围或不必要设计成本 | diff、ExecPlan、规模与回滚 | 未发现需单列意见的项 |

分层范围：代码、产品闭环、架构边界、测试判别力与反例、issue 验收与重复追踪、设计缺陷/适度性。测试通过只证明对应断言，不等同产品闭环。

## 全矩阵核对

| 层 | 已核对的机制及反例 | 结论 |
|---|---|---|
| 代码 | descriptor 严格字段、可信 peer 覆盖、create/query/resume 分离；未知响应按持久槽发现 | 无 P0/P1 |
| 代码 | current owner/generation、same-scope lookup 序号、submit/resume 单飞、断线/换 creator/迟到结果拒绝 | 窄测试与因果变异通过 |
| 代码 | query decode 拒绝跨 scope、多余字段、对象/数组枚举；确认需同 id/stamp、saved/currentTarget | 当前源码与负例一致 |
| 产品 | 已确认 Saved 后整个 HTTP 回复销毁；reload、真实 Host/SQLite 重建及 peer-B 后恢复 | 当前源码 Chromium 独立通过 |
| 产品 | Provider ack 丢失形成 Unknown；reload/new-peer 摘要、显式 resume、唯一 mutation | 当前源码 Chromium 独立通过 |
| 产品 | 真实 Host 403 说明与连接修复动作、后续授权/目标拒绝撤下确认、PR 陈旧和 CI 缺口分开 | 永久实际 Host 用例通过；F1 另列 |
| 架构 | Host/Core 唯一权威；原 actor/body/key/marker 不下载；当前 peer 只是 observer | 无新增事实源/状态机/身份映射 |
| 架构 | Core 独占确认后 refresh；UI onConfirmed 只 read 现有 projection；UI 不直接调 Provider | 纯读回调、边界 9 项通过 |
| 测试 | 契约、实际生产 adapter/Host/client、SQLite reopen、新 peer、当前构建安装件 | 正向 98 项全过，无 skip/cancel |
| 测试 | 新增独立 failed 呈现反例，三个最小关键守卫变异及一项冗余守卫探查 | F1 RED；3 个因果 KILLED；冗余项见下 |
| 工作项 | #437 原验收五项逐条映射；#494 后端、#235 父验收、#451 浏览器自动化、#449/R1 人工门区分 | 本层功能闭环有确定证据；不提前关闭父/人工门 |
| 适度性 | 本层 542 代码/测试增删、204 文档增删；query-first + 显式 resume，无浏览器持久意图副本 | 低于本次 800/1300 约束；无需新增框架 |

## Finding F1 · [P2] 对非权限失败显示可辨识的结果

新增行：`packages/ui/src/create-change-request-section.ts:42`（直接 base diff 的新增行，建议范围 41–43）。

触发：工作项已绑定仓库，但 execution context 未就绪或开始工作失败，当前 scoped operation query 合法返回 none。用户填写有效 base/title 并点击创建后，实际 Host 返回 `writeState=failed`、`recovery=none`，未发生外部 mutation。

缺陷：组件只特殊处理 `fix_permission`，随后 none 分支无条件选中初始“从当前执行上下文创建 PR”。生产 client 保留的 failed 结果因此对用户不可见；表单看起来与提交前相同，用户无法判断失败或知道应先完成开始工作。此处未伪造确认，故定为局部 P2。

证据：`.superpowers/pr491-independent/failure-probe.test.mjs` 通过真实 SQLite/生产 GitHub adapter/Host service/production client/组件，断言 mutation=0 且 result=failed，再断言状态应区分失败；当前树 1/1 RED，实测 status 恰为初始提示。输出保存为同目录 `failure.log`。原源码与原测试未修改。

修复方向：在合法 none 的通用提示前呈现当前 failed/conflict 的安全说明及适当下一步，保留 loading/failed-query/blocked/非当前 target 的优先门；不转发 Host 内部原始错误。补实际 Host 缺 context 或等价失败的永久回归，并保留权限修复回归。

追踪核对：开放 issue 快照中 #451 承担执行/PR 浏览器自动化，#235/#284 是父验收，#278 是连接错误；未发现已经独立追踪这项 PR 表单静默失败的 issue。本次不新增重复 issue，作为本 PR inline F1。

## 独立验证

以下均在已锁定 head 和本 worktree 执行：

- `pnpm run test:file tests/contract/ui-create-change-request.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/contract/ui-delivery-lineage-section.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/harness-plugin-delivery-lineage.test.js`：63/63 通过。
- `pnpm run test:file tests/integration/harness-plugin-artifact.test.js`：当前源码重新 build，26/26 通过；不冒称独立重打 tarball digest。
- `pnpm run boundaries`：9/9 通过；`pnpm run typecheck`：exit 0。
- `node scripts/rule-checks.mjs disclosure 1b7a8f104435a3e2d94507f62770a8334a0be32b`：exit 0；人工审阅 diff/commit 五类发布面，未见凭据、本机身份/路径、个人信息、内部系统或保密字样新增泄露。
- `node scripts/rule-checks.mjs size 1b7a8f104435a3e2d94507f62770a8334a0be32b`：542/204；`git diff --check 1b7a8f104435a3e2d94507f62770a8334a0be32b...HEAD`：exit 0。
- `node --test .superpowers/pr491-independent/failure-probe.test.mjs`：1 个独立反例 RED，归因 F1；这不包含在 98 项正向通过数中。

变异使用 `node scripts/review-mutate.mjs .superpowers/pr491-independent/mutants.json`，最终同树整表执行、exit 0，基线与还原后均绿并逐字节恢复：

| 变异 | killedBy | 结果 |
|---|---|---|
| UI_SAVED_OBSERVATION：去掉当前 saved 状态要求 | fresh operation observation supersedes earlier confirmed response（unknown） | KILLED |
| HOST_FINAL_QUERY：禁用最终本地权威降级门 | actual Host final local operation query fences（target/authorization/projection/repository） | KILLED |
| OPERATION_SINGLEFLIGHT：禁用 client flight 复用 | PR creator observes durable operation after lost response and resumes without replaying intent | KILLED |

先行探索曾仅移除 confirmed 中 currentTarget 子句而 SURVIVED；原因是前置消息分支仍拒绝非当前目标，属于冗余守卫，不据此宣称测试盲区。上表改用真正可改变行为的 saved 子句，未隐瞒先行结果。

## 当前源码真实浏览器闭环

复用并检查本地 carrier `.superpowers/sdd/2026-11-02-pull-request-detail-creation/browser-carrier.mjs`；它打包当前 WorkItemApp/production client，使用真实 Host/正式 adapter/strict transport/SQLite，平台传输确定性合成。独立 Playwright session 通过实际表单填入含空格、换行、Unicode 的正文并点击创建。

- Saved：以 `--saved` 启动；Host 先返回 confirmed，carrier 销毁整份 HTTP 回复。实际 reload 后无正文输入框而展示原摘要；`/rebuild` 真正 dispose Host、重开 SQLite、接纳 peer-B，第二次 reload 仍展示同摘要；显式读回后 `PR 已确认`。
- Saved 证据：`.superpowers/pr491-independent/saved-before.json` 与 `saved-after.json`；创建 RPC=1、resume RPC=1、mutation=1，整份 Saved attempts 深度相同；resume 之后只有 projection read 和 operation query，没有 refresh。
- Unknown：无 `--saved` 启动，Provider ack 丢失且 HTTP 回复也丢失；reload 与同样 Host/SQLite/peer-B 重建后保留摘要，显式读回成功，未重输正文或调用第二次 create。
- Unknown 证据：同目录 `unknown-before.json` 与 `unknown-after.json`；唯一原 id/key/fingerprint/input 保留、Unknown→Saved、mutation=1，最终确认。
- 同目录 `.playwright-cli/` 保存当前 DOM，`current-saved-confirmed.png` 保存当前 Saved 确认截图；浏览器证据均绑定此处 immutable head，不引用作者旧录制代替复跑。

## 综合结论与剩余门

全矩阵完成：P0=0、P1=0、P2=1、P3=0。按仓库 MMP 规则，当前评审事件应为 APPROVE 并一次提交 F1 inline；不自行合并。协调者可机械修复 F1 后再由独立评审者在新 head 复验，旧 head 结论不自动继承。

本次证明的是确定性生产路径的工程行为；没有真实 GitHub 写入/授权传播/最终一致性测量，没有 installed Desktop 人工 Host UAT、读屏人工验收、#449 或 R1 裁决。父级四能力组合 verify 由协调者单独执行，本报告不把作者全量结果当本次独立重跑。

## F1 独立修复复评 · 2026-11-02

本段 Supersedes 初评 F1 的未修复结论，仅针对协调者在 `61ba65a175131f0578504fd2d9c3734f4dcaab3a` 上的未提交修复；最终提交/restack 后仍须核对源码等价及当前 head/base/checks。原 APPROVE + F1 inline 已先发布：review `5733113234`、comment `4439720144`。

- 独立读 diff：组件仅在权限说明后、none 初始提示前增加 failed/conflict 两条固定安全文案；原 loading、query-failed、blocked、currentTarget=false、confirmed 与 permission 顺序不变。永久实际 Host context 拒绝回归验证真实 result=failed、零 PR/mutation、零 onConfirmed。
- `node --test .superpowers/pr491-independent/failure-probe.test.mjs`：原 F1 反例 1/1 GREEN，实测“创建 PR 失败，请先完成开始工作并检查输入后重试”、mutation=0。
- `pnpm run test:file tests/contract/ui-create-change-request.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/contract/ui-delivery-lineage-section.test.js`：43/43 GREEN、零跳过/取消，含实际 Host 403 修复动作与当前上下文拒绝；`pnpm run typecheck` exit 0。
- `node --test .superpowers/pr491-independent/repair-priority-probe.test.mjs`：7/7 GREEN；failed/conflict/permission 的原 base/title/body 保留、无隐式第二次 submit、无误确认；loading/query-failed/blocked/old-target 无创建表单，直接点恢复动作也零写入。
- `node scripts/review-mutate.mjs .superpowers/pr491-independent/repair-mutant.json`：整表 exit 0，回退新增两条文案由 `actual Host context rejection remains visible in the PR form` 归因 KILLED；基线与还原后基线均绿、字节恢复。
- 先行 Provider 422 探查实测走 Unknown，不能作 failed 案例；最终反例和永久用例只使用已证明的实际 context 拒绝。未改动产品源码或原测试；新探针仅在运行态目录。
- 复评对象 SHA256：组件 `db81f4b28adf91b0d8598c615fcbac03fcd64e930a7a68dab1a8d11540d1e6d2`；永久 Host 测试 `c7eeada5bff3723b9b7615de63ddec97fe7e41b52d847658a5e8ec85aa5ee47b`，供最终 restack 源码核对。

修复复评通过，F1 已闭合，当前候选残留 P0/P1/P2/P3 均为 0。此次仅改安全提示，不重复已验证的完整浏览器路径；初评浏览器仍绑定原 head，不能冒称新提交浏览器录制。最终 immutable head 与远端门由协调者发布后回读，installed Host 人工 UAT/#449/R1 仍独立。

## 协调者收尾门

首轮 review `5733113234` / inline `4439720144` 由 Singularity-AI-Bot 在原 head 一次提交 APPROVE；F1由本会话接手后独立复评通过。完整用户条件授权及重新归档记录见本PR ExecPlan。当前文案修复没有改变 Core/Host/client 的创建、恢复或确认协议；临时 Provider422探索得到Unknown，未把它改写为失败。最终重放到 #495 的当前修复head后，以产品差异和文件摘要核对UI修复，再验证组合、当前CI及完整线程，使用 rebase 合并。恢复锚点 `refs/backup/pr491-before-independent-mmp-20261102`。

## 最终组合验证 · 2026-11-02

在检出 `feature/pull-request-detail-creation` 的工作树根，以Node26/pnpm10.28.2运行 `pnpm verify`：3023/3023 + MVP-0 7/7；`pnpm run boundaries`：9/9；`node scripts/workflow-check.mjs`：no findings。全部0 failed/cancelled/skipped。此组合已包含实际main的#490/#492、独立复评后的backend和UI修复；最终归档只改docs，产品源码摘要保持复评记录值。

两位原独立评审者再次核对实际main重放：backend的19个本层技术文件与修复checkpoint一致、其它技术变化仅继承main，leaf无回环；UI本层源码patch逐字相同，stable patch-id为 `91247a75620157fc567227efcd2b4c7e305f548f`。最终直接base技术A+D为#495：839、#491：565；旧800预测不适用于本轮backend实测。最终远端head/base、CI、issue关联及全部线程由协调者按本报告收尾门回读，未把本地测试作为人类Host/R1接受。
