# 规划投影替换回归 ExecPlan

> 状态：Active；创建：2026-11-16；Iteration 11：2026-11-16—22（Asia/Singapore）
> 范围：#634 的共享 Storage put → replace 同键状态与内容覆盖；规范：根 `PLANS.md`。
> 上游：#201、#634；不以本叶子关闭父项或接受 R1 发布。

## Purpose / Big Picture

刷新规划来源后，同一工作区同一实体应完整显示最新状态与内容，不混入旧字段。本项把已有正确行为固化为 Fake 与 SQLite 共用的回归：先 put 旧投影，再 replace 同键新记录，完整读回恰好一条新记录；仅保留旧状态或旧内容的错误实现必须被发现。

## Context and Orientation

Storage 是规划投影的持久化端口；投影是供读侧消费的工作区实体记录。`tests/contract/storage-contract.test.js` 已将 `tests/contract/suites/storage.js` 的 foundation 同时装配到 Fake 和 SQLite，使用现有临时库及种子。foundation 已有 put → put 更新和 replace 空列表收敛，缺少 put → 非空 replace 的精确转换。

`packages/storage/sqlite/src/storage.ts` 的 `replacePlanningProjections` 按 workspace/binding 收敛；替换目标必须先有相应 binding、entity、external identity，避免用非法种子绕过真实引用完整性。本项不涉及 Core 的状态政策。

## Design / Spec

选择在既有 foundation 新增一个独立端口行为用例。复用 `projection`、`seedWorkspace`、`seedEntity`、`binding`，登记相同 binding 的 external identity；put 后将相同 workspace/entity 的 `planningStatus`、revision 与 content 中 title/body 改为不同合法值，再以同 binding scope replace。对 get 使用完整记录深比较，对 list 使用 `[replacement]` 深比较，兼证一键一行。

放弃把更新塞进已有清空用例：它会混合删除和覆盖两种失败。保留已有 put → put 用例，不用替换它来省行。放弃新 suite、第二套 adapter 装配、SQL 直读或源码镜像断言：现有共享端口即可证明结果。

生产实现已满足此行为，新增测试直接 GREEN 是预期。TDD 的 RED 来自测试域可逆故障注入：临时包装现有端口，让 replace 仅保留旧 status，再独立仅保留旧 content，分别确认新断言失败；不为制造 RED 改坏生产代码，不提交注入器或永久变异框架。正常生产路径必须恢复后再验收。

不变量：单 Planning 事实源、Host 权威、规划与工程状态正交、Provider ack/reconcile 前不得显示权威 Saved、凭据只存 secret 句柄，均保持现状；此测试不产生外部写入。

## Global Constraints

唯一测试写入为 `tests/contract/suites/storage.js`；文档写入为本计划（完成后同名移至 `docs/exec-plan/completed/`）及协调者维护的 `docs/README.md` 索引。单一 owner 完成此闭环，不能修改生产 adapter、schema、Core、公共 fixture 或装配文件。

技术 additions + deletions 目标 20–60、上限 80；每 PR 总技术行不得超过 800，文档不得超过 1300，不为凑预算扩写。无依赖、公共接口、数据迁移、旧数据兼容分支或修复脚本。只使用临时测试数据库，不碰运行数据；不得合并 PR、自动写 Planning Status 或 native blocking。

## Plan of Work

### Task 1 / Batch 1 · 同键替换的共享回归

**最小闭环**：一个共享用例同时保护两 adapter 的状态、完整内容和唯一记录；可独立验收、合并及回滚。

**涉及主文件**：`tests/contract/suites/storage.js`。

先按 Design 构造有效旧行及新行，保存新增用例的正常 GREEN；执行两个测试域错误变体取得分别针对 status/content 的 RED，恢复后跑 V1。独立验收者检查 RED 来自对应深比较，且没有替换既有覆盖语义。最后更新证据与 Progress，完成计划归档/索引，整理本批提交；初始 plan-only 提交和最终实现提交保持可审阅，不产生 debug/fixup 提交。

**验证及期望**：具体命令集中在 Concrete Steps；V1 必须包含两 adapter 的新用例并全部通过；V2–V3 必须通过。**回滚点**：本批前已有生产行为正确，撤销新增测试及本计划即可，不改变数据。

## Concrete Steps

在检出 `test/projection-replacement` 的工作树 `.worktrees/projection-replacement` 根目录运行；如依赖缺失先按根 `package.json` 的 pnpm 版本安装冻结锁文件依赖。命令只在本节定义，其余章节以编号引用。

- V1：`pnpm test:file tests/contract/storage-contract.test.js`；期望所有 Storage 契约通过，新标题在 Fake/SQLite 各出现一次。
- V2：`pnpm test:file tests/contract/content-placement.test.js`；期望文档位置及链接通过。
- V3：`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`；期望均退出 0，人工复核凭据、本机身份、账号个人信息、内部系统、保密字样。

最终 push 后由交付 owner 在本检出用显式仓库参数回读 PR head/base/checks/issue 关联/全部 review threads；当前 head 的 Fast Gate 通过才 Ready。此规则不授予合并或规划状态写入。

## Validation and Acceptance

V1 的完整 get/list 比较就是结果证据；两项故障注入的失败输出只留最窄断言与恢复结果，不建立固定变异数量门禁。V2–V3 保护文档与公开面。测试无产品行为改动，因此不机械扩大到全量 verify；若发现真实实现缺陷，先修订范围与预算再实施。完成只可 `Closes #634`，父 #201 的原始验收继续独立。

## Progress

- [x] (2026-11-16 14:40 +08) 独立核对两份设计与实际 suite、adapter 入口，选定单用例闭环。
- [x] (2026-11-16 14:40 +08) 在本分支初始基线执行 V1：278 通过、0 失败；尚无新用例。
- [ ] (2026-11-16 14:40 +08) 完成 Task 1 / Batch 1 的判别回归、独立验收、发布回读及归档。

## Surprises & Discoveries

2026-11-16 在初始基线 `8ace55af` 观察到生产无须修复：现有 put → put 已比较完整新 status/content，replace 用例只验证空列表与作用域。以强制生产 RED 作为门禁会制造无意义修补；本计划改用可逆端口故障注入验证新断言。

## Decision Log

2026-11-16 14:40 +08 / 独立 spec 评审：采用独立 foundation case，保留已有覆盖与装配。理由：精确关闭 #634，减少重复与实现耦合；正常 GREEN 加两个根因错误变体 RED，满足行为判别目的。

## Idempotence and Recovery

V1–V3 可重复；测试继续使用既有临时库生命周期。故障注入无论成功失败均在 finally 恢复原端口，确认 diff 无生产改动，再执行 V1。出现测试挂起或无关文件差异，保留输出并停止该注入，恢复本 owner 改动，不重置其他任务文件。不做数据库迁移或内容修复。

## Interfaces and Dependencies

沿用 Storage 的 put/get/list/replacePlanningProjections 契约、现有 Fake/SQLite assembly、Node 与 pnpm；无需网络、凭据、模型、安装 Host 或原生 Windows。无新增反向依赖。PR 关联本仓 #634，精确 issue/readback 由交付 owner 执行。

## Outcomes & Retrospective

目前交付的是可执行计划和基线，尚未增加回归或取得实现 head 的验证。没有有意延期的本闭环技术债；若实施发现维护性妥协，先核对 `docs/exec-plan/tech-debt-tracker.md` 再由协调者登记，不复制父 Issue 历史。

## Artifacts and Notes

最终只保留新用例、V1 摘要、status/content 错误变体的失败断言与恢复证明。计划完成时把实际结果写入 Outcomes，移入 completed 并更新索引；运行输出留在忽略的运行态目录，不写绝对本机路径。

## Bottom Change Note

Change Note (2026-11-16 14:40 +08)：综合独立方案并核对真实实现后创建；将 test-only GREEN 与故障注入 RED、单 owner、独立交付边界写入同一份计划。
