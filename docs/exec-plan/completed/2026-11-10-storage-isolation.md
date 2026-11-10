# Storage Snapshot and Transaction Isolation ExecPlan

> 状态：Completed（本计划工程验收完成；PR 与 R1 人类接受独立）
> 创建：2026-11-10
> 范围：在一条不超过 800 行的独立交付中，关闭 Fake Storage 普通端口别名和过期事务句柄缺口（#311、#426）。
> 上游输入：`AGENTS.md`、`PLANS.md`、#311、#426、#201；当前实现 `packages/providers/fake/src/storage.ts` 与 `packages/storage/sqlite/src/storage-sync.ts`。

## Purpose / Big Picture

Fake Storage 的普通读写和事务作用域与 SQLite 一样保护已提交事实。调用者修改 put 入参、get/list 返回值或事务结算后的旧 tx 句柄时，不能绕过 Storage 写入、提交或 revision 边界改变数据。成功证据是共享 Storage 行为断言在 Fake 和 SQLite 上通过，且删除 SQLite foundation suite 注册会使独立正控制失败。

## Context and Orientation

Storage 是 Core 的本地权威边界；Fake Storage 不得因被用于测试而拥有更宽的可变写入口。实施前基线的 `MemoryStorage.putWorkspace` 保存原对象，`getWorkspace` 返回内部对象；逐项盘点已确认其他普通端口也有相同别名或延迟捕获缺口。Fake 的事务已把 staged data 提交到根实例，但 staged 实例未绑定失效令牌；SQLite 在事务调用与排队执行时均检查令牌，可作为现有语义参照。

#311 要求 put 入参、get 结果、list 成员在 Fake 与 SQLite 上符合隔离语义；故障注入不能再依赖普通端口偶然返回的内部别名。#426 要求过期/关闭后的事务句柄快速拒绝，并证明 SQLite foundation suite 确实执行。两项都归共享 Storage 合约，合并的前提是实现前逐项盘点后仍能在 800 行内保留各自独有行为；否则停下并拆成顺序 PR，不以删验收项强凑预算。

## Design / Spec

采用逐端口的入口快照与返回快照，并在 scoped Fake transaction 上共享 active token。写入参数必须在进入串行队列前捕获，执行时再次检查 token；仅在队列回调中 clone 无法防止调用者在等待期间修改参数。读取和列表返回独立快照，同时保留各端口现有规范化、字段校验与键语义。

保留事务提交/回滚、外部未提交不可见、串行写入、revision/fence 以及身份/关系约束。公开 constructor 在原始导入记录经过现有专属解析器后拥有唯一状态快照；factory 不再重复克隆，事务提交 staged 实例实际拥有的状态。配置与 externalIntent 在会丢失原型/own-key 信息的复制前校验；generation、已提交同步轮次、观察版本与默认绑定约束字段显式捕获，保留非枚举合法值与原拒绝语义。测试必须经显式、仅测试可用的 inspect/inject seam 操作内部状态；不得给生产 Storage port 新增调试写能力。SQLite 当前关闭/事务语义不重写；共享队列矩阵已复现其复合写入延迟读取调用方对象，因此仅补普通复合写入入口快照。

放弃递归 Proxy 包装所有方法：它会改变 `this`、反射与异步方法语义，且隐藏显式捕获时点。放弃只冻结返回值：它不能阻止 put 入参别名。放弃机械拆类：不能修复可变对象穿过端口的问题。

## Global Constraints

- 唯一 Storage owner；代码与测试变更只限以下路径：`packages/providers/fake/src/storage.ts`、`packages/providers/fake/src/index.ts`（仅在需导出测试 seam 时）、`tests/contract/suites/storage.js`、`tests/contract/suites/storage-snapshots.js`、`tests/contract/storage-contract.test.js`、`tests/contract/storage-connector-account.test.js`、`tests/e2e/client-sync.test.js`、`tests/integration/execution-run-refresh.test.js`、`packages/storage/sqlite/src/storage.ts`、`packages/storage/sqlite/src/storage-sync.ts`、`packages/storage/sqlite/src/storage-execution.ts`（仅入口快照）、`packages/capabilities/src/connector-account.ts`（仅专属配置捕获函数，复用原形状校验）。主控另维护 `docs/README.md` 索引和 `docs/exec-plan/tech-debt-tracker.md` 的 TD-027 局部收口记录。不改 schema/migration、Core 或其它 lane 的文件；若发现必须扩大路径，先停下回报主控。
- 代码、测试、配置与 fixture 的 additions+deletions 合计不超过 800 行，文档不超过 1300 行。预估 590–780 代码/测试行；实际盘点超过 800 时，不删除独有正确性用例，按顺序拆开 #426 与 #311 并更新此计划后再实现。
- 保持现有 Storage 接口、身份/关系语义、事务原子性和 Host 状态拥有；不新增兼容层、迁移、业务关系或 Planning 写入。
- 不触碰用户数据库、个人配置或 GitHub 业务关系。实现 owner 不直接提交或推送；主控按授权流程整理并发布 draft/final PR。agent 不合并 PR。

## Plan of Work

### Batch 1 · Storage isolation（#311 + #426）

**最小闭环**：所有被本批覆盖的共享 Storage 行为对两个适配器均断言输入捕获、输出隔离及事务作用域失效。

**涉及文件**：`packages/providers/fake/src/storage.ts`、`tests/contract/suites/storage.js`、`tests/contract/storage-contract.test.js`。

先盘点 Fake Storage 所有可变 record put/get/list 出口及真实依赖它们的故障测试；确认总量能守住预算。测试先覆盖 scalar 与嵌套记录、list member、队列等待期间修改 put 入参、事务提交与回滚后泄漏 tx 的读/写、延迟到事务结束才执行的写，以及 SQLite 现有等价正例。输出须比较已提交值和 revision/fence，不能只看对象引用。

实现入口捕获/出站快照与 staged instance token；在 tx 方法被调用和实际排队执行时都拒绝 inactive token。仅把依赖意外 alias 的故障用例改为显式测试 seam。针对 suite 装配增加运行期正控制：测试回调执行后验证 SQLite foundation 的真实提交/回滚副作用已观察到；临时移除 foundation 装配时此正控制应失败，而不能只比较源文件或测试数量。

**验证**：在检出 `fix/storage-isolation` 的 `.worktrees/storage-isolation` 根目录运行 `pnpm test:file tests/contract/storage-contract.test.js tests/contract/storage-connector-account.test.js tests/e2e/client-sync.test.js tests/integration/execution-run-refresh.test.js`（期望：相关用例非空且全绿；所有适配器的快照与事务断言均执行）。实现后对入口快照、执行时 token 和 foundation 注册各作一次定向反证，移除后指定断言须失败，恢复后复绿。之后运行 `pnpm run boundaries` 与 `pnpm verify`（期望：退出码 0）。

**回滚**：整体 revert 本 PR；无持久数据格式、schema 或用户数据变化。

## Validation and Acceptance

交付仅在以下证据齐备时满足：Fake 与 SQLite 共享行为测试均验证入参/出参隔离、队列延迟期间的入参捕获、事务提交/回滚后旧句柄拒绝及无迟到写入；SQLite foundation 注册存在可失败的运行期正控制；相关验证命令全绿且体量在上限内。测试通过只证明 Storage 合约，不表示 R1 或 #201 已接受。

## Progress

- [x] (2026-11-10 10:10 SGT) 完成独立设计审查与当前缺口取证。
- [x] (2026-11-10) 逐端口盘点别名与四处原始状态消费者；以共享矩阵实现入口捕获，预算仍低于 800 行。
- [x] (2026-11-10) 完成普通端口快照、私有 Fake 状态与显式注入接缝、scoped tx 调用/执行检查；首次相关四文件验证 278 条通过；独立评审发现两项 P2 后，修复轮 1 已完成 RED/GREEN（相关 292 条通过）与定向反证。修复轮 1 完整验证 1546 contract /2171 integration /226 E2E 全通过；独立复评已回读，F1/F2 均 ADDRESSED。
- [x] (2026-11-10 11:05 SGT) 独立复评确认 #311/#426 独有验收，F1/F2 均 ADDRESSED，无新增 P0–P3；独立 275/275 与构造/形状/事务探针通过。

## Surprises & Discoveries

- `tests/contract/storage-contract.test.js` 已装配 SQLite foundation，但 #426 的正控制仍须证明用例确实执行，不能据源代码中出现装配语句推定。
- SQLite 事务已有调用时及执行时令牌检查；Fake 事务虽有 AsyncLocalStorage token，却未把 token 绑定到 staged storage 的各方法，旧 tx 可在结算后继续改根数据。
- #311 的工作范围跨普通 Storage 端口，三处 workspace clone 不足以代表整体符合；实现前必须盘点别名出口和故障注入使用者。

- 共享矩阵在 `fix/storage-isolation` 的 `.worktrees/storage-isolation` 上取得真实 RED：SQLite 的排队 binding 写入被调用方把 `enabled: true` 改成 `false`，随后落成 false；首次完整 RED 为 245 条中 46 条失败。错误夹具的 relation class 与 Start Work intent 已在该完整 RED 前校正。
- Fake 的读取原先立即执行；补充漏 await 的迟到读取后，事务回滚时出现唯一失败。scoped 读取现在也排队并复查令牌；根实例仍按原方式读取已提交快照。
- 四处 raw state 消费者均在本批允许集合内；已迁往 `exportFakeStorageState` / `injectFakeStorageState`。Fake 的状态改为私有字段，模块私有 WeakMap 仅给显式检查/注入函数访问，生产 Storage 接口未增加调试方法。

- 最后一次完整验证前，主控为评审快照执行 `git add -N`，与 bundle-report 的 `git status --porcelain` 身份校验并发，导致 `measures real build and pack bytes with reproducible JS and portable graphs` 报 `source changed during build or pack`，依赖其报告的 `refuses deltas across changed configuration, toolchain, gzip or schema` 随后失败。主控确认此索引竞态；源码保持冻结，稳定重跑已全绿，原次失败不当作 Storage 回归或被忽略。

- 独立完整评审以两项 P2 拒绝首次实现：公开 constructor 仍保留 seed 别名；先复制再校验抹去配置原型/null 与 intent 符号字段。修复轮 1 的原始 RED 为 271 条中 6 条失败；补充非枚举原值的同根因 RED 后，两个适配器的 generation、已提交同步轮次、观察版本、默认标记与顶层 intent 五项都错误接受。现已修正且合法非枚举值保留。

## Decision Log

- 决策（2026-11-10 / 本会话人类条件授权）：PR #600 无 P0/P1 后由评审会话继续收尾；用户直接指令为“你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并”。
  理由：本轮完整 MMP 风险矩阵无新增 P0–P3；独立证据和当前版本门见 [本 PR 评审](../../review/pr-600-mmp-review.md)。合并授权仅覆盖本会话点名的 #600–#602，Planning Status 与父验收不随工程事件更新。

- 决策：把 #311 与 #426 放入同一 Storage owner 的单 PR，但设置 800 行前置停止线。
  理由：事务句柄、普通端口快照和 Storage 行为套件有共同所有权；若实际改动越线就按依赖顺序拆分，避免摊薄任一 issue 验收。
  日期/作者：2026-11-10 10:10 SGT / Codex。
- 决策：参数快照在串行队列入队之前获取，事务 token 在调用和执行两个时点检查。
  理由：仅在执行时复制或只检查调用时都无法阻止延迟写入逃逸。
  日期/作者：2026-11-10 10:10 SGT / Codex。

- 决策：把 Global Constraints 中三个 SQLite owner 文件扩展为仅入口快照修正。
  理由：共享行为测试确认排队 binding、身份、成员、投影、仓库、上下文、关系、观察、同步轮次、写尝试与配置具有同根因；主控明确授权该最小扩展，未修改队列、事务、关闭或持久格式。
  日期/作者：2026-11-10 / Codex。
- 决策：保留 Fake 的根实例读取时序，仅 scoped 读取走已有队列并复查 token。
  理由：修复迟到读取与迟到写入同族问题，同时维持既有事务外读取已提交状态的语义。
  日期/作者：2026-11-10 / Codex。

- 决策：修复轮 1 仅扩展 Global Constraints 中的 capabilities 专属配置捕获入口，复用已有 plain-object / own-key 校验，实际 schema 仍在原队列内按真实挂载解析。
  理由：队列外查询尚未提交的挂载会拒绝合法调用；在两个适配器重复输入形状规则会产生第二套判据。constructor / intent 则先用原专属解析器，再复制普通 typed records；无需通用 descriptor 或兼容框架。
  日期/作者：2026-11-10 / Codex（主控明确授权）。

## Idempotence and Recovery

共享测试可重复运行，目录均由测试临时资源管理。实现无数据库升级或外部副作用。任一隔离断言失败时保留失败证据并修正本批；预算超限时恢复到干净批次基线，改为两个顺序 PR，不删测试来满足预算。

## Interfaces and Dependencies

依赖 Node.js `node:test`、pnpm workspace 与现有 Fake/SQLite Storage factories。Storage 接口和生产 Host ABI 不变。GitHub issue 仅作追踪引用；所有命令均在上述指定 worktree 执行。最终易失状态由主控使用 `gh pr view 600 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,mergeStateStatus,closingIssuesReferences`、`gh pr checks 600 -R SingularityKChen/harness-projects` 及当前 review threads 回读；期望 head 对应该分支、base 为 main、仅关闭 #311/#426、执行检查通过且无未处理阻塞线程，满足后才 Ready。

## Outcomes & Retrospective

已实现共享 20 行普通端口矩阵（每行覆盖输入/输出隔离与排队捕获）以及观察/实体和事务作用域断言；相关四文件验证 278 条通过。定向删除入口快照、SQLite 入口快照、执行时 token、输出深拷贝、SQLite foundation 注册均得到非零失败，恢复后相关验证通过。在 `fix/storage-isolation` 的 `.worktrees/storage-isolation` 根目录，完整 `pnpm verify` 稳定重跑退出 0：1532 contract、2171 integration、226 E2E，全数通过且无 skipped/todo；`pnpm run boundaries` 为 9/9，`git diff --check` 退出 0。相对批次基线的首次代码/测试 additions+deletions 为 577 行。该版本后被独立评审以两项 P2 拒绝，Superseded by 本节修复轮 1 记录（2026-11-10）。通过仅证明本批 Storage 契约，不表示 R1 或 #201 获得人类验收。

修复轮 1：相关四文件验证为 292/292，边界为 9/9，`git diff --check` 退出 0；去 constructor 独立快照、丢弃 staged 提交、配置先展开再校验、intent 先 clone、导入先 clone 五种变异均被行为断言拒绝。代码/测试增删为 710 行，低于 800 硬门；最终完整 `pnpm verify` 退出 0：1546 contract、2171 integration、226 E2E，全数通过且无 skipped/todo；此前“独立 scoped 复评待完成”的状态由本次复评取代（2026-11-10 11:05 SGT）：F1/F2 均 ADDRESSED，无新增发现；独立 275 项契约与构造隔离、原形状拒绝、合法挂载和事务探针通过。远端交付门按接口章节执行。

## Bottom Change Note

- 2026-11-10 10:10 SGT：基于 #311/#426 的独立设计与当前 Storage 源码，创建合并候选计划；增加队列时输入捕获、执行时事务 token 检查和可执行的 suite 正控制，并设置拆分停止线。
- 2026-11-10 10:10 SGT：按主控交付边界统一 Batch 标签为 `Storage isolation`。
- 2026-11-10 10:15 SGT：将已完成设计调查标为完成，并明确 owner 与主控的提交/发布职责。

- 2026-11-10：记录逐端口盘点、SQLite 真实排队捕获缺陷及授权范围扩展；完成私有状态接缝与 scoped 迟到读取修复，补充 RED/GREEN 与定向反证记录。
- 2026-11-10：记录最后的配置读 ref 捕获 RED/GREEN、278 条相关用例与稳定完整验证结果；保留索引竞态造成的两条构建证据失败及其原因，不混同为持续绿的验证。
- 2026-11-10：依据独立完整评审两项 P2 进行修复轮 1；记录 constructor 所有权、原值校验顺序、capabilities 专属入口授权、同根因非枚举字段 RED/GREEN 及 710 行预算；源码冻结交付最终验证与 scoped 复评。
- 2026-11-10：回读修复轮 1 冻结源码的最终完整验证：1546 contract、2171 integration、226 E2E 全通过；保留此前被评审拒绝与索引竞态失败的历史证据，不将本地绿等同发布门禁或人类验收。

- 2026-11-10 11:05 SGT：登记独立复评通过，工程计划移入 completed 并维护索引；TD-027 仅收口已证明的 Fake 写入面，SQLite 裸句柄边界保留。

- 2026-11-10：登记 PR #600 完整矩阵、独立变异与直接条件收尾授权；计划保持 completed，公开提交按独立交付物整理，最终 head 的 checks/review/issue 与 rebase 结果按评审回读门判定。
