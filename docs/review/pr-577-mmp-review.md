# PR #577 MMP 交付评审

## 锁定事实

- 日期：2026-11-07；评审 head `d2ebb7101382f0c6de62dc87f94fd1aca15d1933`，base `c1975c20aeffa960a980f01dd321e38261008f59`（`main`）；本轮末再次回读，两者未变。
- 目标：CI lane 完整性、单次执行、退出码、PR Fast Gate fail closed。
- 评审范围：代码、产品闭环、架构、测试与反例、issue 验收、设计适度性和重复追踪。
- PR ready、MERGEABLE，关联关闭同仓 #573；初始 reviews/comments 均为空。本评审只修改本记录，不修改源码、Git 状态或 GitHub。
- 方法：使用 requesting-code-review、Qian Systems Router 与 First Principles Development；目标系统是候选验证链，外层约束是唯一必需 PR Fast Gate、R1 人类判定与目标 head 两次成功证据。

## 预置风险矩阵（先于逐文件审查）

| 级别 | 风险假设 | 判别证据 | 当前结论 |
|---|---|---|---|
| P0 | 删除破坏 main、发布门禁或系统硬约束 | 当前基线、门禁与七条不变量核对；完整 verify | 未发现：生产源、规划轴、凭据/Provider 确认与依赖方向未改变 |
| P1 | 退役误删仍在使用的行为、安全/恢复路径或 CI 覆盖 | runner 负控；现存行为映射；Fast Gate 16 种结果；W1–W7 | 未发现：三层非空、失败传播、Browser 与聚合信任边界保留 |
| P2 | 验收遗漏、证据失真或边界说明不完整 | #573、ExecPlan、当前 head hosted 日志与 PR diff | 未发现：退役边界明确；没有把工程通过扩大为产品/R1 接受 |
| P3 | 文档、命名或维护成本问题 | 当前文档引用与退役载体对照 | F1 已关闭：三处当前入口已同步；独立复评通过 |

## 分层证据与反例

### 代码、产品与架构

`package.json` 的 test 唯一调度 contract/integration/e2e，三次运行顺序串联；任一层失败阻止后续命令并使 Verify 失败。`scripts/run-test-layer.mjs` 的计数与执行共享 `*.test.js` 清单，排除 node_modules，固定 spec reporter 与 120 秒用例超时。当前三层没有发现会被此命名约定排除的其他 Node 测试文件；该命名限制已在 tests/README.md 声明。

Runner 的空目录、缺路径、零用例、全 skip、全 todo、断言失败与无摘要判定由现存 13 例验证；补充临时目录黑盒反例：语法错误、文件中 process.exit(7)、SIGTERM 均经 Node runner 转为 exit 1，层运行器输出 ::error:: 并退出 1；递归嵌套的一条有效用例退出 0。没有源码变异；不把这些反例称为变异覆盖证明。

退役 tests/mvp0/chain.test.js 的行为承接逐项核对：Planning 唯一默认与装配拒绝在 provider-binding-registration；内容三态、primary 身份与重复同步在 chain-bootstrap；写确认与 unknown/reconcile 在 write-machine；上下文/分支/工作树幂等及失败保留在 start-work；真实跳、lineage 来源、确认态与外部 id 在 delivery-lineage；工程事实不得改写规划状态在 status-policy。原节点 4 用非法工作项只检查返回枚举，当前写路径故障测试更强；节点诊断与 CoreApi 源码形状台账明确属于本次退役边界。

`ci.yml` 只删除 PR base 过滤，其他执行和聚合实现未变；全部 PR 进入同一 Verify/Browser。候选执行 lane 不读 secret，checkout persist-credentials=false，权限 contents:read，外部 action pin 与超时通过 W1–W7。PR Fast Gate 不 checkout、不 uses/env/secrets，只汇总 verify/browser；现存 16 组合仅双 success 放行。移除另一套聚合不会新增事实源或改变七条系统不变量。

### 工作项、适度性与重复追踪

#573 的 acceptance 是单次执行、现有行为范围、逐层非空拒绝、聚合边界与 R1 人类/双成功保持。实现与该范围相符，未增加新生产接口或第二套解析算法。退役 4 个测试执行 job、4 次依赖安装和 1 个聚合 job 是结构事实；本轮没有测量或宣称速度收益。

按 run-test-layer / Merge Gate 搜索现有 issue：#362 已关闭，处理的是旧版契约测试再次执行整层，当前契约仅运行临时 fixture，不是本 PR 重复；#10 已关闭，是旧门禁创建记录；#156/#459 仍保留产品与发布责任，不被 #573 自动接受。未发现需要另建的重复问题。

### F1（P3，已关闭）：同步现行文档的退役门禁名称

- 新增行锚点：`docs/development/ci.md:175`，声明 Merge Gate 退役。
- 证据：`tests/integration/README.md:3` 与 `tests/e2e/README.md:3` 仍写“归入 Merge Gate”；`docs/product/core-release-scope.md:69` 的当前范围映射第 5 行仍把证据写为“Merge Gate 的 integration 与 e2e”。这些段落没有历史/已取代标识，读者会寻找本 PR 已删除的检查名。
- 影响与方向：不改变代码或放行结果，但当前测试入口和 R1 映射互相矛盾。把前两处改为 PR Fast Gate 经 pnpm test，把范围映射改为 consolidated CI 的分层行为稳定性，保持目标 head 两次成功与人类回读责任。
- 修复独立复评：两个层入口现写明统一 CI 的 Verify 执行、结果纳入 PR Fast Gate；Core 范围第 5 行保留 integration/e2e 各自非空、目标 head 的 CI（含 PR Fast Gate）连续两次通过、CI + 人类回读，当前候选仍明确未判定。与 release-gates.md §2.2 同义，没有授予 agent 发布裁决或把一次绿色放宽为稳定。修复时仍是原 head 上的本地文档补丁；最终提交后应由主评审重锁新 head。

### 最终树变异判别表（文档修复后一次整表执行）

命令：`node scripts/review-mutate.mjs .superpowers/pr577-final-review/runner-mutation.json`，使用现有 `tests/contract/run-test-layer.test.js`，不增加测试。夹具退出 0，含施加前与还原后基线均绿。

| 变异 | 最小故障 | killedBy | 实际结果 |
|---|---|---|---|
| M577-1 swallow child test failure | 将 runner 的 `if (result.status !== 0)` 变为 false，吞掉子测试失败 | 断言失败的层 | KILLED；变异运行 exit1，失败名包含「断言失败的层：退出码非零，且失败输出里同时有 node --test 的失败与不变量」 |

变异前后 runner SHA-256 均为 `e811c6daf7bba5323dee773bc4520293c1c2876787ef9f799f27f763dde14206`；`git diff -- scripts/run-test-layer.mjs tests/contract/run-test-layer.test.js` 无输出。运行态 spec/哈希在本检出 `.superpowers/pr577-final-review/`，无源码或测试残留修改。

## 验证与结论

- 本地 Node v26.13.0，工作区 `.worktrees/test-execution-20261107`：四文件定向命令 108/108 通过；`pnpm verify` 退出 0，三层完成；`node scripts/workflow-check.mjs` 检查 7 份 workflow 无 finding；`git diff --check c1975c20...HEAD` 退出 0；size 为代码 841/1000、文档 238/1500。
- Hosted CI run `42352392229` 的 head_sha 为本评审 head、event=pull_request、conclusion=success：contract tests1432/pass1431/skip1，integration2025/pass2025，e2e240/pass240，Browser58/pass58，均 fail0。唯一 skip 为 source-tree 的 case-only rename，在区分大小写文件系统按既有条件跳过；不能写成 hosted 全无 skip。
- 当前 PR Fast Gate、Verify、Browser 均 success；Create review session failure 是本地评审端点的可选检查。取消的同名 policy/rule/reconcile 有成功结论，本记录不将它们解释为行为失败，也不替代 root 的最后远端回读。
- 文档修复窄检查：`git diff --check` 退出 0；三个修复入口的 5 个相对 Markdown 链接目标均存在。
- 初评结论：无 P0/P1/P2，1 个非阻塞 P3，建议 APPROVE。主评审已提交单次 APPROVE（review `5810976914`），并完成 F1 修复；本轮独立复评后无未决 finding，维持 APPROVE。最终提交/push 后的 exact head/checks 由主评审回读；本记录不代表产品、人类或 R1 接受，也不授权合并。
