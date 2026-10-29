# PR #454 MMP 交付评审

## 锁定事实

- 日期：2026-10-29。head：`a9d999d2cfaa24d529c4dd8a05f533e1b4519189`；base：`main@06d929017c8551e6b106fcbe7651f12ac26e4642`。
- 执行上下文：`.worktrees/start-work-visibility`；评审账号 `Singularity-AI-Bot`，开发账号 `SingularityKChen`。
- 先建立 P0–P3 风险矩阵，之后按代码、产品、架构、测试、反例与工作项逐层审查。使用 Superpowers 评审约定、Qian Systems Router 的系统边界与综合检查、First Principles Development 的结果与不变量审查。
- 本文记录独立子评审的代码与本地验证；完整 commits、全部 GitHub threads、当前 checks 以及最终提交 review 由主评审统一核查。force-push、rebase 或 retarget 后须重新锁定并复评。

## 风险矩阵

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 本轮结论 |
|---|---|---|---|---|
| P0 | main 不可运行、不可恢复数据破坏 | 权威状态或凭据硬边界失效 | 迁移/发布基线与必需门禁失真 | 未发现；无迁移、依赖或持久模型变更 |
| P1 | 越权、陈旧输入、重放、准入竞态 | Host/Core 可见性权威、拒绝无副作用 | #349 核心验收及双适配器反例 | 未发现；事务、缓存、输入捕获三类变异均被归因击杀 |
| P2 | 有限错误反馈、可恢复边缘偏差 | 既有 context 与供应顺序边界 | 相关已有 issue 与验收遗漏 | 未发现新增缺陷；持续撤权和既有执行正确性仍由原 issue 承担 |
| P3 | 命名、可读性、局部简化 | 最小职责与维护成本 | 文档、规模和冗余 | 未发现需提交意见的问题 |

## 分层证据与反例

### 代码和产品闭环

`startWork` 在 primitive/名称校验之后、key/context/routing 之前调用共享 Core 守卫；missing、其他 workspace 和所有 redaction reason 返回同一固定 `not_found / open_provider / retryable:false`，不返回旧工程句柄。`claimContext` 的第一项业务读取使用 `tx.getPlanningProjection`，先于 ledger、父实体、context 和关系写入；Fake transaction 串行提交，SQLite transaction 使用 `BEGIN IMMEDIATE`，没有把 Provider await 放入写事务。

正常可见条目、未映射规划状态、可见但无展示 primary identity 的条目均有正控。可见 ChangeRequest 保持 `invalid_input`。撤权/删除先提交的 barrier 用例确认无登记、worktree、run、attempt、实体、身份、挂载、关系和业务修订增量；合法 claim 先提交的相反顺序确认供应保留，明确准入线性化边界。Ready/Failed/Closed/Provisioning 旧 context 的 same/new key 在已撤回后均拒绝并保留旧事实。

Controller 的 settled cache 和 in-flight 入口先调用 Core 的只读目标预检；错误政策没有复制到 Controller。第一次 await 前捕获完整普通值树，同一副本用于预检、canonical 身份、key 和 Core handoff。嵌套数组顺序、undefined/null、缺键、普通/null 原型等价、非法元数据和调用方立即修改都有双适配器反例；调用方未被 freeze。Core primitive 请求投影未被错误当作 Controller 的完整请求身份。

### 架构与设计适当性

新增查询只在 Core 内复用准入守卫，不依赖展示身份，不调用 Provider，也不写控制事实或推进修订。unavailableCore 对齐既有结构化错误。未改变规划状态、secret 存储、Provider 依赖边、client/Host remote ABI 或 Storage schema。Controller 捕获是新增异步预检所必需的身份一致性措施；没有引入通用授权框架、第二个可见性政策或 Provider 持锁等待。

### 工作项与既有问题

已只读回查 live issue #349，其三项行为验收均有 Fake/SQLite 经 `composeCore` 的直接证据；其指定 status-policy 与类型检查也实际执行。PR 的 `Closes #349`、完成 ExecPlan + Batch 1、局部 vertical-path 订正与实现范围一致。问题根因由本 PR 闭合，不需要重复 issue。

同时核对已有 #420（durable owner fencing）、#421（外部执行唯一性）、#458（run/replay 一致性）。它们仍是独立正确性和 MMP release 范围，不能用本 PR 的绿色测试替它们验收；本 PR 也未把“准入后持续撤权”列为已交付。真实 installed Host、远端新鲜授权、R1、#143/#449 和 #459 的 release 风险处置不由本地 #349 测试证明。

## 实际验证

所有命令均在锁定 head 的上述执行上下文运行：

| 命令 | 结果与意义 |
|---|---|
| `pnpm test:file tests/integration/start-work-sqlite-registration.test.js tests/integration/start-work-request-binding.test.js tests/e2e/status-policy.test.js tests/e2e/controller-roundtrip.test.js` | 192/192，0 fail/cancelled/skipped/todo；覆盖双适配器可见性、事务顺序、请求身份和相关 Controller/status 回归 |
| `pnpm run typecheck` | exit 0 |
| `pnpm run boundaries` | 9/9，0 fail/cancelled/skipped/todo |
| `node scripts/rule-checks.mjs disclosure 06d929017c8551e6b106fcbe7651f12ac26e4642` | exit 0；范围新增行与逐提交新增行/提交信息机械扫描通过，未传入 PR_BODY，不宣称该命令扫描了 PR 描述 |
| `node scripts/rule-checks.mjs size 06d929017c8551e6b106fcbe7651f12ac26e4642` | code 308/1000；docs 164/1500；为提交 diff，不含本轮未提交评审记录 |
| `git diff --check 06d929017c8551e6b106fcbe7651f12ac26e4642...HEAD` | exit 0 |

### 变异表

最终源码树整表运行一次，使用 `node scripts/review-mutate.mjs <临时 spec>`，不是手写还原；基线和还原后基线均通过，整体 exit 0，随后 `git diff --exit-code HEAD -- packages/core/src/start-work.ts packages/controller/src/commands.ts` 再确认产品文件逐字还原。命令为 `node --test --test-timeout=120000 tests/integration/start-work-sqlite-registration.test.js`。

| ID | 变异 | killedBy | 结果 |
|---|---|---|---|
| M1-admission-without-current-target | 移除 claim 事务内目标复判 | `先于准入提交` | KILLED；Fake/SQLite × redact/remove 四个行为用例失败 |
| M2-controller-cache-without-preflight | Controller 缓存前不调用目标预检 | `settled same-key` | KILLED；Fake/SQLite × redact/remove 的 settled cache 反例失败，另有在途反例命中 |
| M3-controller-aliases-caller | Controller 保留调用方引用，取消首次 await 前捕获 | `Controller 预检等待期间` | KILLED；Fake/SQLite 深层输入变化用例失败，另有可见 A→隐藏 B 缓存切换反例命中 |

## 结论与后续

锁定 head 的独立子评审未发现可提交的 P0/P1/P2/P3 缺陷，没有新增 inline 意见或新 issue。#349 的有限软件闭环证据充分；建议主评审在统一回读当前远端 head/base、完整线程及实际必需 checks 后给出总评。子评审未提交 GitHub review，未 commit/push 或合并；本地测试不代替 hosted CI、产品验收或父级 release 裁决。

## 主控综审与收尾门

- 2026-10-29 首轮：独立子评审与主控全矩阵均无新增 P0/P1/P2/P3。初始 head/base 已锁定；所有原 review threads/reviews 为空。主控逐条查明可选评审转发失败属于 #364；取消的重复规则运行有成功后继，当前代码门通过。
- 已使用 `gh-review` / `Singularity-AI-Bot` 一次性提交完整 APPROVE review，没有可提交的 inline 缺陷；开发与后续外部写入使用 `gh` / `SingularityKChen`。
- 以四个首轮固定 head 按 #454 → #455 → #456 → #445 在隔离 clone 逐项变基预演，无冲突，组合 head `23916987d93026109a2fce8a55cc55147b521e3d`。固定 pnpm 10.28.2 后 typecheck、2551/2551 与 MVP-0 7/7 通过（0 fail/cancelled）。首次 pnpm 11 的依赖预检在测试前因非 TTY 终止，不是测试通过；离线安装也曾因缓存缺包失败，联网 frozen install 成功。
- 收尾只整合提交与审查记录；每个分支先保留原 head 的本地 backup ref，更新到真实 base 后核对源码与预演/独立审查相符，运行受影响验证和发布面/规模检查，以精确 lease 推送。远端最终 head/base/checks/issue/threads 和复评全部成立后才执行 rebase merge；任一条件改变则回到该门，不能借首轮批准跳过。
- 本轮接受对应子 issue 的有界闭环；不接受父级 MMP、真实模型、人工 Demo、独立安装或 R1。保留原跟踪问题和人类验收门。
