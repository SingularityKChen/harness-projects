# PR #411 MMP 交付评审

## Purpose / Big Picture
显式安装 Harness 主执行与人工回退，让 Start Work 在真实工作树启动会话或诚实记录 manual_fallback，并使安装失败后的恢复可操作。

## Context and Orientation
2026-10-27 初审 head `89cae810d0be5ed5ff8fbe3759d1f328055f2dc0` / base `b164a211b0b0d9669724dc794c2fe32896c4eed0`。修复候选 `fc5479f25cfd651a7ebc352d4218cc0fd2210b6a` 独立复评通过。#410 合入后，重锁 base main `eaaee2a9aceef131cc84962f0a96e471effe0a7b`，rebase 产品候选 `7f41713d0040a33b4d82cbc57a5cd8485a71f2a8`。执行上下文为 `feature/session-execution-binding` 的 `.worktrees/session-execution-binding` 根目录；最终 head 由回读锁定。

## Design / Spec
先建立 P0–P3 矩阵，再分别审查代码、产品闭环、边界、测试、反例和验收。使用 Superpowers、Qian Systems Router、First Principles Development；根评审亲自重放真实 Host/SQLite 反例。修复以 source 级 `{key, acknowledged}` 表达安装意图，仅由该 ack 后开始、仍属当前 revision 的干净 Host 读数结束同一对象；unknown/pending 保持原键。

## Global Constraints
惰性获取宿主服务；raw adapter 仅转译允许字段。未知会话启动不得启动第二个执行器；明确缺服务/forced 才回退，稳定签发密钥保证人工 ref 重启后可读。Host 权威、不改规划轴，不删除工作树。review 用 `gh-review`，作者操作用 `gh`。

## Plan of Work
### Batch 1 · 初审
先矩阵后全层调查；全部 inline 一次提交，无 P0/P1 时 APPROVE 后修复。
### Batch 2 · 恢复修复与整合
先真实 RED，再最小修复和独立复评，更新原 completed ExecPlan，整合能力提交；rebase 后验证共享接点、精确 lease 推送，当前 head 门禁和线程核对后授权合并。

## Validation and Acceptance

| 等级 | 代码/反例 | 产品与架构 | 裁决 |
|---|---|---|---|
| P0 | 数据损坏、基础链路崩溃、不可恢复 | 多 Planning 权威、凭据或身份越界 | 未发现 |
| P1 | 重复会话、副作用盲重试、错误成功 | 先执行后确认、丢工作树、主备混用 | 未发现；unknown 零 human start、确定失败保留工作树 |
| P2 | 首次读回失败后，后续确认未结束 intent | 同页 pair 移除再启用重放旧成功 | F411-1 已修复并独立复评 |
| P3 | 文案、接口表达、证据 | 不破坏不变量 | 无新增缺陷 |

#359 AC1：正式 remote→真实 Git ack realpath→录制 raw session→Core run/ref/status→SQLite 读回。AC2：missing/forced 记录 human ack、manual_fallback、真实工作树保留；会话 create/prompt 为零，人工签发身份重启可验证。AC3：forced 开关文档化且精确值 `1` 才开启，unset/0/true 默认不启用。这些是接口录制与真实临时 Git/SQLite 自动化，未执行真实 Desktop/模型。

F411-1 初审新增行 `packages/client/src/workspace-setup.ts:148`：install 已本地提交，首次 setup read 失败；refresh 确认安装后旧 key 没结束。经 Storage 移除 pair 再启用，Host replay 旧成功，最终 0 binding、无 error，两次 key 相同。根评审独立复现；当前 UI 无移除按钮且重开页面可恢复，故为 P2。初审 review `5665061275` 一次发布该意见并 APPROVE。

在本分支上述候选根目录执行：

```sh
node --test --test-timeout=120000 tests/integration/harness-plugin-host-execution.test.js tests/contract/host-session-adapter.test.js tests/contract/ui-workspace-setup.test.js
node --test tests/contract/package-boundaries.test.js
npx --yes pnpm@10.28.2 verify
node scripts/rule-checks.mjs disclosure eaaee2a9aceef131cc84962f0a96e471effe0a7b
node scripts/rule-checks.mjs size eaaee2a9aceef131cc84962f0a96e471effe0a7b
git diff --check eaaee2a9aceef131cc84962f0a96e471effe0a7b...HEAD
```

| 证据 | 实际结果 |
|---|---|
| 新回归 RED | 真实 Host/SQLite 重新安装失败；两文件 29 项，27 pass/2 fail，另一项为 activationError 恢复未结束 key |
| GREEN 与独立复评 | 49/49、typecheck；独立 Host/SQLite 探针确认新 key、实际生成 2 条 binding |
| 保护反例 | unknown/pending 不借旧配置确认；激活未恢复不清 key；旧 read 不发布或结算新意图 |
| 最终产品树统一变异 | 9/9 KILLED，killedBy 全匹配，前后 49/49、字节还原；raw RPC、forced、unknown、disabled 与 5 项生命周期保护 |
| rebase 后完整验证 | root 亲跑 typecheck、2133/2133、MVP-0 7/7，通过 |
| 组合一致性 | 7 处文本冲突按已验证双能力组合 `8cc329c1ce4103995bf1c563d33727f5062cb539` 逐项保留；全部 apps/packages/tests/锁文件字节相同。三能力最终组合另有 2157+7 与 pack 成功 |

暂存和逐提交 disclosure、diff-check、规模及人工五类目检查在最终 push 前执行。最终外部证据用 `gh pr view 411 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,mergeStateStatus,closingIssuesReferences,statusCheckRollup`、`gh pr checks 411 -R SingularityKChen/harness-projects` 重读；期望当前 head 的相关门禁通过、#359 双向关联正确、原 thread 已验证回复解决。初审取消运行有同 head 后继成功；可选 endpoint 故障由 #364 跟踪。

## Progress
- [x] 2026-10-27 先矩阵后全层初审，根独立反例，唯一 P2 一次提交。
- [x] RED→GREEN、最终产品树变异、修复独立复评；更新原 completed ExecPlan 与有效索引。
- [x] #410 合入后 rebase、共享接点字节核对与完整验证。
- 最终远端 head、门禁、作者回复及串行交付由批次评审记录与回读命令维护。

## Surprises & Discoveries
仅在安装 promise.then 结算会丢失后续恢复的因果关系。无条件在 refresh 清键会让旧配置误确认 unknown，清错误/强制新键又会制造盲重试；采用 source 级已 ack 意图与版本化读数。全量开放 issue 未见同一缺陷重复项；#365 承接 start 后 run 刷新，#193/#194/#304 为既有 Start Work 恢复、幂等、lease 问题。

## Decision Log
- 2026-10-27 / 人类：对 PR #410–#412 明确授权仅 P2/P3 时由本会话修复、re-review、归档、整合、核对 issue 后 `merge_method=rebase` 合并。本 PR 条件满足，不重复请求同一授权。
- 2026-10-27 / 根评审：初审无 P0/P1；本会话修复，由另一未参与实现的子评审独立验收；rebase 后重锁 head 复评，旧 SHA 结论不直接作为新批准。

## Idempotence and Recovery
本地 `refs/backup/pr411-pre-review-20261027` 保存原发布 head，`refs/backup/pr411-fixed-review-20261027` 保存修复候选。精确 lease 防止覆盖他人推进；冲突或门禁失败先取证。整体 revert 本能力提交，不删除用户 Git 产物或已发出的会话；外部会话副作用不能靠代码 revert 撤销。

## Interfaces and Dependencies
根 AGENTS、PLANS、MMP 评审流程、`docs/exec-plan/completed/2026-10-27-session-execution-binding.md`、Host raw API、Core execution setup 与 Controller replay。三能力组合和最终回读见批次记录。

## Outcomes & Retrospective
唯一 P2 已消除，修复独立复评无新增缺陷，rebase 后本地完整验证通过。#143/#124/#136/#226 的真实宿主、模型及父项验收保留；不把本次工程合入当作全产品 MMP/R1 完成。

## Bottom Change Note
- 2026-10-27：矩阵先建；补齐独立反例、根因修复、最终变异、独立复评及 rebase 组合证据，收敛为简洁记录。
