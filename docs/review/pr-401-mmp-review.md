# PR #401 MMP 交付评审

## 锁定事实

- 日期：2026-10-26；执行上下文：`.worktrees/planning-field-mapping`。
- Head：`675d371315de9ac186352b73154c54f023a43309`；Base：`main` / `d470308bb42878fdf7b65e88095fed61bacd8289`。
- 初始状态：Open、Ready、mergeable；已有 review 与 review thread 均为空（完整分页）。
- 账号：review 为 `Singularity-AI-Bot`；开发写入为 `SingularityKChen`。
- 评审方法：Superpowers 独立评审；Qian 系统闭环与反馈；First Principles 需求、状态拥有与反例。
- 事实和约束：Host 权威、Provider ack/reconcile、规划与工程轴正交；测试通过不替代产品验收。

## 预先风险矩阵

本矩阵在逐文件审查前建立；风险是假设，最终结论须以证据更新。

| 级别 | 代码与反例 | 产品闭环 | 架构边界 | 测试与 issue 验收 |
|---|---|---|---|---|
| P0 | 数据破坏、泄密、合入即破坏 main | 错报已保存或越权远端写入 | 第二权威源、规划状态被工程覆盖 | 硬约束未守住则阻断 |
| P1 | 并发、重试、冷恢复、失败路径错误 | 用户主路径无法完成或结果不可信 | 身份/租约/持久化/信任边界失效 | 反例可复现且在本 issue 验收范围则阻断 |
| P2 | 可恢复的边界行为、诊断不足 | 非关键交互与恢复体验缺口 | 局部合同不清但无不变量破坏 | 缺判别性负控、已有追踪核验 |
| P3 | 易读性、证据表述与维护性 | 文案或展示小问题 | 无行为影响的一致性 | 文档、索引、细微验证改进 |

## 分层审查与验收

审查范围是当前 head 相对锁定 base 的全部 23 个文件。以“同一 SQLite 文件重启后，用户仍看到同一 ID 映射；有限默认标明 derived，且不写 Provider”为系统结果；chooser、规划字段写入和状态政策不并入本闭环。

| 层 | 当前证据 | 判定 |
|---|---|---|
| 代码 / P0、P1 | `loadPlanningMapping` 先查已存记录、校验 binding/project，发现走 Planning lifetime；事务内重查保护迟到 user；歧义、错 kind、失败或无角色均保守降级 | 未复现 P0/P1 |
| 产品 / P0、P1 | 真实 GitHub 录制读取经过 Host→Core→controller→client→ui-model；SQLite 重开后字段重命名/定义失败仍用原 ID；写方法 throw spy 为零 | #277 三项验收均有离线集成证据 |
| 架构 / P0、P1 | scoped 配置独立于 WorkspaceRecord 与 projection revision；SQLite workspace 主键及 planning mount FK、卸载 cascade；domain 纯 validator 复用，Core 只消费显式 ID | 无第二规划权威；未改工程/规划正交边界 |
| 测试 / P1、P2 | 七文件 231/231，原边界 9/9；四个关键变异有精确 killedBy 且整表还原后基线通过 | 本轮未发现判别缺口 |
| 工作项 / P2、P3 | 当前 #277 scope/acceptance、PR closing association 与已归档 ExecPlan 对照；#358 chooser、#71 写入、#273 Host 权威策略、#278 连接诊断仍有独立 issue | 无漏关范围；一条 P3 文档状态矛盾 |

### 发现 F401-1（P3）：归档计划的状态抬头仍写 Active

新增行 `docs/exec-plan/completed/2026-10-26-planning-field-mapping.md:3` 写“Active · 实现已落地，独立验收待进行”，但 Progress、Outcomes 和 Bottom Change Note 都记载独立复评通过并归档。读者从文首会把已完成批次误判为仍待验收，违背 completed 目录与计划状态的对应关系。将此行改为 Completed 并保留“待人类 PR 评审”的实际边界即可；不需要变更产品代码。

## 验证与变异

2026-10-26，在 `.worktrees/planning-field-mapping` 的锁定 head 执行：

- `node scripts/resolution-check.mjs`：exit 0，确认工作区模块解析。
- `node --test --test-timeout=120000 tests/contract/storage-contract.test.js tests/integration/storage-restart.test.js tests/integration/harness-plugin-host-planning-mapping.test.js tests/integration/planning-fields.test.js tests/e2e/workspace-read-assembly.test.js tests/contract/ui-work-item-list-view.test.js tests/integration/execution-relation-write-schema.test.js`：231/231，exit 0。
- `node --test tests/contract/package-boundaries.test.js`：9/9，exit 0。

`pnpm run test:file ...` 的首次尝试因进程中 pnpm 版本/已有 modules 布局不匹配而自动尝试 install，报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`；这一尝试没有执行测试，不记为产品失败。随后直接调用同一入口下的 resolution-check 与 Node test runner 得到上述真实结果，未安装或清理依赖。

变异统一使用 `node scripts/review-mutate.mjs <临时spec.json>`；command 为 `node --test --test-timeout=15000 tests/integration/harness-plugin-host-planning-mapping.test.js`。每个锚点恰好匹配一次，变异整表只在当前产品树执行一轮；脚本字节还原、最终基线均通过（exit 0）。

| ID | 变异锚点 → 替换 | killedBy（失败名子串） | 结果 |
|---|---|---|---|
| M401-1 | `if (saved !== undefined) return use(saved)` → `if (false) return use(saved)` | `restores IDs after rename/failure` | KILLED |
| M401-2 | `if (current !== undefined) return use(current)` → `if (false) return use(current)` | `a user save wins over late derivation` | KILLED |
| M401-3 | `candidates.length === 1 && candidates[0]?.kind === kind` → 长度条件改 `>= 1` | `rejects duplicate roles/options` | KILLED |
| M401-4 | `mappingOrigin: context.planningMappingOrigin` → 固定 `'derived' as const` | `skips discovery for user configuration` | KILLED |

M401-1–3 文件为 `apps/harness-plugin/src/host-composition.ts`；M401-4 为 `packages/core/src/queries.ts`。这组证据证明核心断言可以失败，不把代码覆盖率或既有验收者结论当成当前行为证据。

## 结论与后续门

本 head：P0=0、P1=0、P2=0、P3=1；建议 APPROVE 并修正文档抬头。尚未提交任何远端 review，未改产品、issue、规划 Status 或依赖关系。锁定后的新 head/base 必须重读；真实 Harness 页面和实时 GitHub 网络不属于本轮离线证据，不用测试通过代替整体 MMP 发布门。协调者负责后续远端 checks/线程回读、一次性 review 和修复归属。

## 修复复评（2026-10-26，冻结工作树）

复评对象是 `675d371315de9ac186352b73154c54f023a43309` 加未提交的计划文档修订；不是一个新 remote head。`docs/exec-plan/completed/2026-10-26-planning-field-mapping.md:3` 已改为 Completed，末尾新增订正原 Active 抬头的 change note。文首、归档位置与最终验收记录一致，F401-1 关闭。

工作树锚点（Git blob，以 `git hash-object <path>` 只读取得）：计划文档=`be8321d2cfee8edb295542b8f7435c5bf0ed4270`；`apps/harness-plugin/src/host-composition.ts`=`f9a2cca941c08063eabd8b15d92b1284064f944f`；`packages/core/src/queries.ts`=`16d43beba9cb9c2658515937618572f5f005a703`；映射集成测试=`e52926f63dfa697bf2644c5ddb85535194e602c9`。后三者均与锁定 HEAD blob 相同。复评前后逐文件 SHA-256 相同，确认变异没有留下源码或测试更改。

重新执行上文七文件窄回归：231/231，exit 0；resolution-check exit 0。按原 command、原四个变异和原 killedBy 在本冻结工作树整表重测一次：M401-1、M401-2、M401-3、M401-4 均精确 KILLED，脚本 exit 0；字节还原与还原后基线通过。`git diff --check` exit 0。这次复评没有新增 P0/P1/P2/P3，当前未关闭发现为 0；结论保持 APPROVE。正式提交整理后仍由协调者重锁 head/base 并回读远端事实。
