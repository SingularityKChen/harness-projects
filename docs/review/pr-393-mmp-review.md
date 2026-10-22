# PR #393 MMP 交付评审

- 日期：2026-10-22。
- 锁定 head：`85fa379ce3b0a5332209383ae3e01e3e1ef17950`。
- 锁定 base：`main` / `d7e7bca6aae31a4329f3238d3b90274dd683516c`。
- 实现会话：`规划紧急重要的并行Issue`；保留原分支 worktree。
- 评审账号：`Singularity-AI-Bot`；开发、作者回复与合并账号：`SingularityKChen`。
- 方法：Superpowers 独立评审、Qian 系统综合、First Principles 不变量与反例。

## 初始风险矩阵（逐文件审查前建立）

| 级别 | 待核对风险 | 层 | 当前结论 |
|---|---|---|---|
| P0 | 测试层被绕过导致 main 必需安全门失效 | 代码、产品闭环、架构 | 未发现；生产 runner/workflow 无变更，聚合与四 lane 接线契约通过 |
| P1 | 真实 Merge Gate 执行被删除或空层被接受 | 代码、测试、反例、issue 验收 | 未发现；最终实现 head 四 lane 实跑，缺层变异被对应断言杀死 |
| P2 | 非空检测误报、fixture 回归或性能结论失真 | 测试、产品闭环、工作项 | 未发现；fixture 全保留，计时明确为单次观察而非因果承诺 |
| P3 | 断言与文档表达 | 文档、范围 | 未发现需修改项；计数与真实执行的证据边界明确 |

## 证据与逐层结论

- 代码：四个真实层仅调用既有 `countTestFiles`，同时覆盖目录与单文件路径；`run()`、`runEnv()` 及全部 fixture/参数拒绝分支保留。与锁定 base 比较，`scripts/run-test-layer.mjs`、`.github/workflows/merge-gate.yml` 无差异。
- 产品闭环：去掉契约层内部的重复执行，真实质量门仍由原 lane 执行；不影响 Planning、Provider、持久化或用户状态。文件非空不冒充断言已执行。
- 架构：仅测试文件与验收文档改变，不新增依赖、事实源、外部写入或运行模式。
- 测试：在 `test/test-layer-single-pass` worktree 根目录执行 `node --test tests/contract/run-test-layer.test.js tests/contract/merge-gate-workflow.test.js`，34/34 通过。覆盖空层、缺路径、零用例、全 skip/todo、失败、缺参数、摘要解析及计数。
- 运行时复核：以 `--import <spawn-audit.mjs>` 包装 `spawnSync` 后运行目标测试，17/17 通过；共 8 次 CLI 调用（6 次 fixture、2 次参数拒绝），有效真实层执行 0 次。缺 invariant 的调用虽然携带真实层路径，但在参数校验即退出，未误计成一次真实层执行。
- 当前 head 的 Merge Gate run `39706784303`：日志确认 Integration 552、E2E 202、MVP-0 7、Boundaries 9 条实际用例，均 fail 0；PR Fast Gate 与聚合 Merge Gate 成功。仅检查绿灯不足以替代这次逐 lane 日志复核。
- 反例：用 `node scripts/review-mutate.mjs <review-spec.json>` 将真实层常量中的 `tests/e2e` 改成不存在的 `tests/review-missing-layer`；`killedBy` 为 `真实层 tests/review-missing-layer 非空`。M393 = KILLED，失败归因匹配，变异前后基线通过且原文字节恢复。未新增产品测试或手写变异运行器。
- issue #362 三项验收逐条成立：不再重跑真实层且四层非空、当前 head 四 lane 真执行、PR 正文记录 38.15 → 27.49 秒。后者仅为原实现者单次观测，本次不重复性能计时或承诺稳定增幅。ExecPlan 已在 completed，索引存在。
- 已查 open issue 的标题与正文：#350 属于扫描忽略目录、#364 属于可选自动评审转发、#156 属于产品浏览器验收；均不重复本 PR 闭环，没有发现应另交同一问题的未解决项。
- 2026-10-22 回读全部 review threads 为空、无分页。可选 `Create review session` 失败由 #364 跟踪，需与必需门禁区分；外部写入前再次核对 head/base/checks。

## 结论与后续

初审及独立复核均未发现 P0/P1/P2/P3，建议 APPROVE；最终 push 后重锁，再一次性提交 review。评审记录不扩大产品范围。

本次人类直接授权覆盖 PR #392–#395：无 P0/P1 或仅 P2/P3 时，由评审会话负责修复、独立复评、归档、整理提交、处理 issue，并以 rebase 合并。若后续发现 P0/P1，交原实现会话修复后复评，当前批准不可沿用。


## 独立最终复核（2026-10-22）

独立复核对象仍为 `85fa379ce3b0a5332209383ae3e01e3e1ef17950` / base `d7e7bca6aae31a4329f3238d3b90274dd683516c`，在检出 `test/test-layer-single-pass` 的工作树根运行。先确认既有 P0–P3 矩阵，再独立阅读全文、25 行代码测试差异、issue #362、ExecPlan、生产层运行器与 Merge Gate 接线契约。

- 用 Git argv 读取 base 并做区块逐字比较：`function withLayer` 起到末尾真实层章节前的全部 helper、fixture 与参数拒绝测试字节等同。`scripts/run-test-layer.mjs`、`.github/workflows/merge-gate.yml`、`tests/contract/merge-gate-workflow.test.js` 相对 base 无差异。没有隐藏删除 fixture 或放宽 runner 判据。
- 独立运行 `node --test tests/contract/run-test-layer.test.js tests/contract/merge-gate-workflow.test.js`；进一步用同一只读 `spawnSync` 包装器对这两个文件运行审计。审计执行结果为 **34/34，exit 0**；8 次 CLI 调用中 6 次完整 fixture、2 次参数拒绝，有效真实层调用 **0**。`[SCRIPT, 'tests/mvp0']` 缺 invariant，在生产 runner 的参数门立即返回；不能把它误算成真实层执行。
- 四个计数断言仍分别命名，使用 `REPO_ROOT` 绝对解析的仓库内路径；单文件边界层和其余目录由既有 `countTestFiles` 处理。它只证明用例文件存在，实际执行仍由 runner/lanes 负责；全 skip/todo 和零断言拒绝仍在 fixture 中实际运行。
- 独立审读 run `39706784303` 的逐 lane 日志：每条 checkout 都明确为 `Merge 85fa379ce3b0a5332209383ae3e01e3e1ef17950 into d7e7bca6aae31a4329f3238d3b90274dd683516c` 的合成 merge 提交；随后真实命令和成功摘要分别为 Integration **552**、E2E **202**、MVP-0 **7**、Boundaries **9**，全部 `fail 0 / skipped 0 / todo 0`。这是本次精确 head/base 的 PR 合成合并树证据，不声称 workflow 直接 checkout 原始 head。
- 在该 immutable head 的临时导出副本中独立重跑 `node scripts/review-mutate.mjs review-spec.json --root .`，沿用已审读的 M393 spec，command 为目标测试文件，`killedBy` 为 `真实层 tests/review-missing-layer 非空`。结果 **KILLED，exit 0**，失败名精确匹配；开始/恢复后基线通过，副本字节恢复且原工作树测试文件与原文字节相同。未修改被评审实现。
- issue #362 三项验收均有匹配证据。PR 已记录 38.15 → 27.49 秒，且明确是单次观察；本次未重新计时，未把前后差值当成确定因果或稳定速度承诺。

独立结论：**APPROVE，无新增 P0/P1/P2/P3 finding**。没有绕过真实门禁或丢失 fixture 的证据。保留边界为计数不证明断言执行、计时不证明稳定性能增幅、后续 head/base 变化必须重锁门禁；这些边界在本 PR 已明确，不另建问题。只补充本评审记录，未改实现、提交或执行外部写入。
