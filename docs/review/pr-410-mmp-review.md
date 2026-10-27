# PR #410 MMP 交付评审

## Purpose / Big Picture
用户从真实项目字段定义选择映射，确认本地提交与来源生效，列表和已开抽屉无需重启更新。测试通过不替代整体 MVP-1/R1 验收。

## Context and Orientation
2026-10-27 初审：`feature/field-mapping-chooser` @ `d09f1f8e34be14b6d85e045b6d6373954507cb1b`，base main `b164a211b0b0d9669724dc794c2fe32896c4eed0`。修复产品候选 `a443eb2966a85edc904508a45cbdd859f69b245b` 已独立复评；本文后续仅收敛证据，最终 head/base 以带仓库参数的回读命令锁定。执行上下文为该分支的 `.worktrees/field-mapping-chooser` 根目录。

## Design / Spec
先建立下表，再由 GPT-6.1 Sol / high 独立子评审检查全层；根评审独立重放反例。使用 Superpowers、Qian Systems Router、First Principles Development。以本次 intent 的确认状态代替旧配置 origin 判断保存结果；明确拒绝保留草稿并显示安全错误码及重读动作，未知结果先读回、同键恢复，本地 ack 后读取失败保留已提交意图。

## Global Constraints
不调用 Planning Provider 写接口、不乐观报告权威 Saved；Host 拥有确认状态。review 用 `gh-review`，作者与 Git 用 `gh`。只修本能力，保留七条不变量与浏览器纯值边界，不写看板 Status/依赖关系。

## Plan of Work
### Batch 1 · 初审
锁定 head/base、所有线程、checks 和 issue；先矩阵、后代码/产品/架构/测试/反例/验收，全部 inline 一次提交。
### Batch 2 · 修复与交付
先 RED 后最小修复，独立复评，更新原 completed ExecPlan、整理为能力提交；建立恢复 ref，以精确 lease 推送，回读当前门禁与线程后授权 rebase merge。

## Validation and Acceptance
矩阵在逐文件审查前建立；当前裁决如下：

| 等级 | 代码与反例 | 产品/架构 | 测试与验收裁决 |
|---|---|---|---|
| P0 | 数据损坏、无法恢复、基础路径破坏 | 第二权威、凭据或跨身份写入 | 未发现 |
| P1 | 正常路径严重失败、旧 round 冒充当前成功 | Host/ack/作用域/依赖边失守 | 未发现；当前代提交证明、失败陈旧路径通过 |
| P2 | 明确拒绝仍提示本地保存 | 草稿被误认为已持久化，旧配置安全 | F410-1 已修复、独立复评通过 |
| P3 | 可读性、文案与证据可复现性 | 不破坏不变量 | 无新增缺陷 |

#358 验收逐项成立：AC1 按 kind/ID 选择、同名 ID 区分、孤儿/未映射项保留；AC2 五个 Provider mutation 陷阱计数为零；AC3 同一 Host watch 的列表和已开抽屉即时变为映射状态。以上为真实 SQLite 与接口回放自动化，未执行真实 Desktop/在线 GitHub 走查。

F410-1 锚定初审新增 `packages/ui/src/planning-mapping.ts:37`。合法 `failed/invalid_input` 拒绝后，读回仍为 `x→todo`、intent 为 `x→done`，React 却显示“本地已保存”。根评审亲自重放确认；初审 review `5665045132` 一次提交该 P2 并 `APPROVE`。修复增加每次 intent 的 pending/local_only/rejected/unknown 状态；拒绝不再显示保存、重读不重发 mutation，新尝试换 key。unknown 与 ack 后 read/activation 故障保留同键。

在上述产品候选工作树根目录实际执行：

```sh
node --test --test-name-pattern='definitive mapping rejections|unknown mapping results' tests/contract/ui-planning-mapping.test.js
node --test --test-timeout=120000 tests/integration/planning-mapping-command.test.js tests/contract/ui-planning-mapping.test.js tests/integration/harness-plugin-host-planning-mapping.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-recomposition.test.js
npx --yes pnpm@10.28.2 verify
node scripts/rule-checks.mjs disclosure b164a211b0b0d9669724dc794c2fe32896c4eed0
node scripts/rule-checks.mjs size b164a211b0b0d9669724dc794c2fe32896c4eed0
git diff --check b164a211b0b0d9669724dc794c2fe32896c4eed0...HEAD
```

| 证据 | 实际结果 |
|---|---|
| 新回归 RED / GREEN | 旧实现两项均因已保存提示错误失败；修复后 2/2，通过组件 9/9 |
| 修复回归及独立复评 | 47/47、typecheck；独立 ack→read失败→unknown重放→读回再失败→confirmed 探针通过 |
| 根评审完整候选验证 | typecheck、2104/2104、MVP-0 7/7，通过 |
| 最终产品树统一变异 | 旧 4 + 新 4，共 8/8 KILLED；每项 killedBy 匹配、逐字恢复、还原后基线绿 |
| 变异机制 | live 定义拒绝、intent 保留、当前代成功 round、opaque own property；拒绝 ack、新 key、拒绝恢复、unknown 提示四项新保护 |
| 发布面与规模 | 暂存扫描、每提交 disclosure、diff-check 通过；凭据、本机身份、个人信息、内部系统、保密字样人工五类目无新增披露；规模按最终 base 重算 |

最终外部证据必须重读：`gh pr view 410 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,mergeStateStatus,closingIssuesReferences,statusCheckRollup`，`gh pr checks 410 -R SingularityKChen/harness-projects`；期望当前 head 的 required `PR Fast Gate`、相关 CI 通过，#358 双向关联正确，thread 有已验证作者回复。初审取消运行已有同 head 成功后继；可选 loopback 自动评审失败由 #364 跟踪。

## Progress
- [x] 2026-10-27 先矩阵后全层初审，根独立复现，唯一 P2 一次提交。
- [x] 2026-10-27 RED→GREEN、最终产品树变异、完整验证、修复独立复评。
- [x] 原 ExecPlan 在 `docs/exec-plan/completed/2026-10-27-planning-mapping-chooser.md`，已补修复批次与授权；原索引仍有效。
- [x] 2026-10-27 当前head门禁、作者回复、issue验收与授权整合完成，已rebase merge为 `eaaee2a9`，#358关闭；最终状态见批次记录。

## Surprises & Discoveries
旧 origin 说明已有配置的来源，不能证明当前 intent 获得 ack。只换文案缺少恢复动作，失败时清 intent 会丢草稿，故采用 source 状态表达。全量开放 issue 76 条未见本问题重复项；#278 只涵盖 connect/bind 分型。原非原子规划快照由 #361/PR #412 承接，晚 baseline 由 #218 承接，不重复报新增。

## Decision Log
- 2026-10-27 / 人类：对 PR #410–#412 原授权为“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续”，包含修复、re-review、归档、整合、issue 核对及 `merge_method=rebase` 合并。本 PR 仅 P2，授权适用。
- 2026-10-27 / 根评审：初审无 P0/P1；修复由本会话负责，另一个未参与实现的子评审独立验收，未发现新缺陷。最终提交仍只含一个字段映射闭环。

## Idempotence and Recovery
原 head 保存在本地 `refs/backup/pr410-pre-review-20261027`。精确 lease 拒绝覆盖他人推进；恢复可从该 ref 新建分支。回滚按能力提交整体 revert，保留已存在配置和用户工作树。每次 rebase/推送后重锁 head，不沿用旧批准。

## Interfaces and Dependencies
根 AGENTS、PLANS、`docs/review/mvp-review.md`、原 completed ExecPlan、Host remote、Controller setup replay、Core 当前代 round 与 watch。完整组合和后续 PR 冲突证据由 `2026-10-27-pr410-pr412-mmp-review.md` 汇总。

## Outcomes & Retrospective
修复产品候选无 P0/P1，唯一 P2 已消除，独立复评建议 APPROVE。#143/#124/#226 的真实宿主与整体产品走查继续保留；本文不声称全产品 MMP 或 R1 已验收。

## Bottom Change Note
- 2026-10-27：先建立风险矩阵；完成初审、独立反例、修复、最终产品树变异和独立复评，收敛为可复现的简洁证据记录。
