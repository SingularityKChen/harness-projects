# PR #495 独立 MMP 交付评审

## 锁定事实

- 日期：2026-11-02；评审账号 Singularity-AI-Bot，作者账号 SingularityKChen。
- 评审 head `1b7a8f104435a3e2d94507f62770a8334a0be32b`；直接 base `main` / `554e6fefb1ad9781becf879b9f96e367e9f6ceff`。
- 执行上下文 `.worktrees/pull-request-command-recovery`；一个能力提交、Ready；review threads 为 0（协调者回读）。
- 完整读取 22 文件 diff；代码/测试/配置 785 A+D，文档 177 A+D，均在本批严格规模内。
- 范围是 #494 的后端 API；#437 / PR #491 保留 Host/client/detail、重载和人工验收。
- 方法：Superpowers 独立子评审、Qian 系统接口与闭环综合、First Principles 状态拥有和故障反例。
- 正式设计与恢复边界见 [completed ExecPlan](../exec-plan/completed/2026-11-02-pull-request-command-recovery.md)。

## 先行风险矩阵

| 级别 | 风险与判据 | 所需证据 | 初始 → 最终 |
|---|---|---|---|
| P0 | main 破坏、秘密发布、规划权威越界、数据丢失 | 依赖与发布面、持久化契约、写入拥有者 | 待核验 → 未发现 |
| P1 | 重复外部执行/PR、虚假 Saved、重启恢复失效、权限或并发绕过 | 当前源码、公开入口故障注入、真实 SQLite 边界 | 待核验 → 未发现 |
| P2 | 局部恢复/谱系、测试盲区、issue 闭环不足 | 反例、验收映射、同问题 issue 排查 | 待核验 → 1 项新增谱系问题 |
| P3 | 文档、命名、范围或不必要设计成本 | diff、ExecPlan、规模与回滚 | 待核验 → 未发现需 inline 项 |

分层范围为代码、产品闭环、架构、测试、工作项和设计适度性；绿色测试只证明对应断言。

## 全矩阵结果

| 层 | 独立检查与判定 |
|---|---|
| 代码正常路径 | pending 与原 actor/canonical intent 先落盘；正式 GitHub adapter 单次 dispatch；ack 后 receipt、native identity 与 exact relation 同事务确认。通过。 |
| 失败与恢复 | list/get 完整分页唯一匹配；零、多、循环、读失败、正文/marker 不符均不盲创；SQLite reopen 保持原 key/actor/input。通过。 |
| 查询与隐私 | query 的 resolver 只读本地；独立 SQLite 所有业务表快照前后相等，Provider 方法全替换为抛错仍能查询；DTO 不含原 actor/key/body/marker。通过。 |
| 权限与作用域 | 原 binding 的 repository-read/PR-read、仓库引用、工作项可见性和当前目标复核；撤 create-write 不阻断 observer；异 actor 复用原 create key 冲突。通过。 |
| 并发 | creator/resumer 的迟到 ack/拒绝/unknown 不降级 Saved；最后事务复核 target/read/receipt/实际获胜 PR set。永久负例及正式变异有判别力。 |
| 产品结果 | 后端发现支持 Unknown 和整成功响应丢失后的当前 Saved；历史 Saved 排除与候选并集歧义保守。跨代际谱系有下述 P2。 |
| 架构 | controller → core → capabilities 依赖合法；无 UI/Host 依赖；Storage 仍唯一持久源，Planning Status 未被工程命令写入；边界 9/9。 |
| 存储 | typed union 保持 Start Work 契约，跨命令未决扫描加 commandName；旧 DDL shape 明确拒绝且无数据变更，备份/旧 reader 限制已披露。 |
| 测试 | 两批相关仓库测试 341+285 全通过；4 个独立正式 mutation 有 killedBy，前后基线绿且逐字恢复；额外纯查询及 base/head 因果控制 3/3。 |
| 工作项 | Closes #494 / Refs #437 与提取范围相符；#235/#284 是父级协调，#281 是后续交付视图；未发现已准确追踪本次 P2 的 issue。 |
| 设计适度性 | 一个 resolver、一个观察器和一个收据状态机足够，无新队列/平台/迁移层。保持稳定 worktree 实体正确；历史 explicit 边需按当前 operation 限定。 |

## 唯一发现：P2 历史显式 PR 关系阻断当前代际刷新

新增位置：`packages/core/src/chain-facts.ts:200–203`，最小 inline 锚点为 202 行的 `explicit.length === 1`。

触发：真实 Start Work 建立第一个 Ready；创建 PR_1 后关闭它；合成平台移除旧工作树，真实 Start Work 先观察到 Failed、随后按原分支重建到 generation 3；显式新 key 创建 PR_2。两个合法创建各执行一次，并非重试重复创建。

结果：默认 operation query 唯一发现当前 Saved 的 PR_2，create/resume 都返回权威成功，但 `lineageStale=true`；重复刷新仍保留 PR_1 的 stale 集合，当前 PR/CI 谱系不能重新收敛。

根因：worktree 实体按 workspace/repository/workItem 稳定，合法跨代际复用；新增选择器把该实体历来全部 explicit/confirmed `produced_by` 边计入唯一性，第二条历史边令所有后续读取无条件 gap。此处不能通过让 worktree id 随 generation 漂移修复。

归属：相同存储、Provider 和当前 context 上，head 刷新留下 PR_1/stale；直接调用固定 base 的原刷新模块得到 PR_2/stale=false。仅比较两版刷新读取逻辑，不冒充整个 base 已有新增 create API；因果落在本 PR 新增 explicit 选择块。

影响与级别：信息被诚实标 stale，没有重复 mutation、错误 Saved 或权限绕过，因此 P2 非阻塞；仍是当前可达的新能力组合缺口，不能由 #281 的视图或 #284 的泛生命周期标题视为已覆盖。

修复方向：用当前 target 的已确认 durable operation/ref 限定显式身份，并保留真正多候选的保守歧义；实际反例的两个 PR 同 branch/head/SHA，逐个 get 后只按这三者筛唯一仍不足，不能取最新/第一个或改 worktree 身份。补真实 Failed→新 generation→第二 PR→刷新收敛用例；技术现为 785 A+D，保留新测试后重新核算严格 <800，超限需重新细化而非删测。

## 独立命令与计数

以下命令均在本 PR 工作树根执行；运行态探针和日志位于 `.superpowers/pr-495-independent-mmp/`，不作为产品源码提交。

1. `pnpm test:file tests/integration/create-change-request.test.js tests/integration/change-request-operation.test.js tests/integration/storage-baseline-admission.test.js tests/integration/pull-request-identity-convergence.test.js tests/e2e/delivery-lineage.test.js`：341/341，零失败/跳过。
2. `pnpm test:file tests/contract/storage-contract.test.js tests/integration/start-work-external-intent.test.js tests/integration/start-work-owner-fencing.test.js tests/contract/development-github-create.test.js`：285/285，零失败/跳过。
3. `pnpm run boundaries`：9/9。
4. `node --test --test-timeout=120000 .superpowers/pr-495-independent-mmp/controls.test.mjs .superpowers/pr-495-independent-mmp/lifecycle-control.test.mjs`：3/3；两项全表纯查询，另项真实生命周期的 base/head 对照。
5. `node scripts/review-mutate.mjs .superpowers/pr-495-independent-mmp/mutations.json`：4/4 attributed KILLED；执行器验证前后基线和源码字节还原。
6. `git diff --check 554e6fefb1ad9781becf879b9f96e367e9f6ceff...HEAD`：exit 0；numstat 独立重算技术 785、文档 177；产品文件与 HEAD 相同。

| 变异 | killedBy 判别用例 | 最终结果 |
|---|---|---|
| 去掉原 binding 读门 | `reopened PR recovery respects original-binding` | KILLED |
| 去掉 candidate 的 exact 命令升级 | `observed PR candidate becomes exact command lineage` | KILLED |
| 去掉 Saved/receipt fence | `resumer Saved receipt survives` | KILLED |
| 允许缺失 resume selector | `required resume selector missing` | KILLED |

初始探索性诊断有 4 个红断言：两个存储夹具反例复现历史边问题，一个真实 Start Work 探针初稿因分支身份/绑定歧义而不具判别力（纠偏后由上述 base/head 控制证明），另一个是 base retarget 后仍 Saved 的假设。后者未列为缺陷：原 exact PR 的创建事实确已发生；当前合同未承诺远端 base 永久不变。探索失败不计入仓库通过数。

## 结论与边界

建议 APPROVE，附上述 1 条非阻塞 P2；P0/P1 未发现。公开 review 由协调者一次性汇总，本子评审不发送评论、不提交或推送。

`PR Fast Gate` / `Merge Gate` 在固定 head 成功；可选 review webhook 红检查由协调者核实为本地端点无响应，已有 #364；取消的重复任务有后继成功。远端元数据和组合全量由协调者最终回读。

独立证据未使用作者既有通过记录替代验证。本报告不建立 live GitHub 权限/最终一致性、实际安装 Host 人工 UAT、#143/#449 或 R1 验收；正式 GitHub adapter 使用严格合成 transport。没有改产品源码、原测试、Planning Status 或依赖关系。

## P2 修复独立复评（2026-11-02；冻结未提交补丁）

复评对象为上述 head 上冻结的 4 个技术文件：`chain-facts.ts`、`create-change-request.ts`、新增纯叶子 `change-request-target.ts` 与 `change-request-operation.test.js`。原 P2 已关闭，本节取代初评的残留结论；review 5733156193 / inline 4439753674 的回复由协调者处理。

实现从现存 context/intent 选择当前 target 的唯一 Saved/ref，仅缩小既有 explicit/confirmed 身份集合；仍需原 route 读门、准确 ref、head/SHA 与 native identity 独立读回。真实 Saved+Saved / Saved+Unknown 保留 stale，不取首项。历史关系和稳定 worktree anchor 不变，无第二份持久权威。

纯叶子只含原有 workspace/context/workItem/repository/generation/head/worktree 比较，布尔语义与原 resolver 相同；resolver 的 canonical/actor/marker/原 binding 校验完整保留，避免命令与链读取模块循环依赖。typed storage/唯一 Core 写者是收据完整性的边界；artifact 的独立 Provider 确认与 command request 校验语义不同，不能仅因任意篡改 fingerprint 的白盒假设便判整个交付事实无效。未发现来自支持的公开命令、恢复、Storage hydration 或并发写者的错误收据选择路径；未声称抵抗任意物理数据库篡改。

独立重跑四套件 `create-change-request`、`change-request-operation`、`pull-request-identity-convergence`、`delivery-lineage`：189/189。`pnpm run typecheck` exit 0，`pnpm run boundaries` 9/9，`git diff --check` exit 0。

`node --test --test-timeout=120000 .superpowers/pr-495-independent-mmp/controls.test.mjs .superpowers/pr-495-independent-mmp/fix-lifecycle.test.mjs`：3/3；独立 public Start Work 原反例现得到 generation 3 / PR_2 / fresh / mutation 2。

`node --test --test-timeout=120000 .superpowers/pr-495-independent-mmp/fix-negative.test.mjs`：7/7；Fake/SQLite 的历史边+当前 Unknown 先 stale、exact resume 后 fresh；错误 native identity/binding/kind 均保持 stale；repository/PR 读撤权零 Provider I/O、Saved 收据不变。

`node scripts/review-mutate.mjs .superpowers/pr-495-independent-mmp/fix-mutations.json`：3/3 attributed KILLED，前后基线通过、字节恢复。去掉 generation、取首个历史 explicit ref 均由永久 `successor operation refreshes exact PR across a real Start Work generation` 击败；取首个歧义 operation 由永久 `eligible Saved plus Saved` 击败。

最终技术规模独立核算 **841 A+D**：符合本会话根 AGENTS 的 ≤1000，未满足原 issue/计划的 <800 承诺；该规模差异由协调者显式更新，不能写成已满足旧承诺。本子评审保留全部判别性测试，未改产品源码或永久测试，未提交/推送/远端操作。

冻结技术内容指纹 `f3d038b8db56f38072b50f681b3ce5ff124a6ba9e97881e05ce68f5971a440ad`（SHA-256，四路径字典序，依次拼接 UTF-8 路径、NUL、文件字节、NUL）。四个 Git blob 依次为 chain-facts `157650cc642a0575943b35a2264caa970c811cba`、target `39bdfd7656a95db1a93a27c0938201eba24b0fa7`、create `6ccca59bddf475c9fc0f697ac7455178c507454b`、operation-test `003a0937820bce8a6ca4655ebfc3e014a7eaca8c`。

复评结论：P0/P1/P2/P3 无残留，APPROVE；独立修复验收完成。后续归档 ExecPlan、整理提交、restack、组合验证、更新规模承诺和当前远端门由协调者完成；人工 Host、live GitHub 与 R1 边界保持。

## 协调者收尾门

首轮 review `5733156193` / inline `4439753674` 由 Singularity-AI-Bot 在原head一次提交APPROVE；本会话实现owner修复F1、原评审者独立复评无残留。当前841 A+D超过旧800预测，依据用户本会话提供的根AGENTS §6≤1000硬门保留完整修复与永久反例；具体处置及直接四PR条件合并授权见本PR ExecPlan，不声称旧规模满足。最终重放到实际main，保留#490的observe恢复及本层startWork命令类型过滤；完整组合、当前CI/issue/线程均回读后，按原生栈#496的#495→#491使用rebase。恢复锚点 `refs/backup/pr495-before-independent-mmp-20261102`。

## 最终组合验证 · 2026-11-02

在检出 `feature/pull-request-detail-creation` 的工作树根，以Node26/pnpm10.28.2运行 `pnpm verify`：3023/3023 + MVP-0 7/7；`pnpm run boundaries`：9/9；`node scripts/workflow-check.mjs`：no findings。全部0 failed/cancelled/skipped。此组合已包含实际main的#490/#492、独立复评后的backend和UI修复；最终归档只改docs，产品源码摘要保持复评记录值。

两位原独立评审者再次核对实际main重放：backend的19个本层技术文件与修复checkpoint一致、其它技术变化仅继承main，leaf无回环；UI本层源码patch逐字相同，stable patch-id为 `91247a75620157fc567227efcd2b4c7e305f548f`。最终直接base技术A+D为#495：839、#491：565；旧800预测不适用于本轮backend实测。最终远端head/base、CI、issue关联及全部线程由协调者按本报告收尾门回读，未把本地测试作为人类Host/R1接受。
