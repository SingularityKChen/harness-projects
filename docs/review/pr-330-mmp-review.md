# PR #330 MMP 交付评审

评审对象：PR #330（栈底），immutable head `55a994947f18a8a88ce3380c1fec508602b2d27a`，base `main@7c7e77ccc770b77f8c1cc7d3d6827ac6d854bc60`；栈顶为 PR #331（head `9ec97d4b`）。评审日期：2026-10-14（第二轮）。评审账号：Singularity-AI-Bot。

## 锁定事实

| 项 | 当前事实 |
|---|---|
| 状态 | OPEN，非 draft，MERGEABLE，mergeStateStatus=UNSTABLE |
| UNSTABLE 原因 | 本 head 上两次 `Reconcile engineering state`（`38522190588`、`38522223674`）均被全局并发组取消，由 06:26:39Z 的全域重算 `38522233783` 取代（success，changed=0）；`matrix.check` 所在 Rule checks `38522193666` 被取消，后继 `38522223340` 成功。分支保护唯一必需检查 PR Fast Gate 成功（CI `38522193628`），不阻塞 |
| commits | `8c66970a` docs(exec-plan)（Refs #134）→ `aefd4b55` feat(storage)（Closes #332、Refs #134）→ `55a99494` docs(exec-plan)（Refs #330）；无会关闭 #134 的关键字 |
| tree | 与整合前 `d882fb45`、第一轮后的 `ecc94cf1` 相同（`c45f34d0`）：2026-10-14 整合只改提交元数据 |
| linkage | native closingIssuesReferences=[#332]；#134 OPEN，无 closing PR |
| 既有批准 | APPROVED 提交于 2026-10-13T16:08Z（针对 `ecc94cf1`），GitHub 因 tree 不变重映射 commit_id；本轮视为当前 head 没有批准 |
| threads | 1 条，已 resolve；本轮按原条件复跑 |
| 规模 | 代码 242 / 文档 167 |

## 并集预演

四个开放 PR 在 `main@7c7e77cc` 上按两种顺序合并（#328→#329→#330→#331；#331 栈→#329→#328），唯一冲突是 `docs/README.md` Active 索引 add/add 行；tree 除索引行序外相同；并集 `pnpm verify` 1542 + MVP-0 7 全过。`packages/capabilities/src/registry.ts` 与 #328 改的是不同行（StorageSurface / DevelopmentProviderSurface），`Exact<>` 类型断言兜住漏合并。

## P0–P3 风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 未见：Fake 与 SQLite 的 replace 原子且结果一致 | 未见：上一轮 P1 已修，变体全过 | 未见行为缺陷 | 删除 scope 取自可变的 `context.projectRef` 并带 `?? ''` 兜底 |
| 产品闭环 | 未见 | 未见：组合期水合与 Controller `bootstrapWorkspace` 两条路径可达；删除收敛，重加（同 id / 新 id）身份不变 | — | — |
| 架构 | 未见：只动 membership 与 field value，不碰实体、身份、关系与工程表；无迁移；provider 输入在写入前校验 | 未见 | — | — |
| 测试 | — | — | #332 验收 3 的 superseded / 失败 / revision 无判别测试（M8 存活）；SQLite 空 incoming 分支无覆盖（M5 存活） | binding、objectKind 比较无判别测试（M2 存活） |
| 工作项 | 未见 | 未见：栈底没有断言 #331 的实现已存在 | ExecPlan 关闭路线仍写「#134B 用 Closes #134」「B 合并前保持 Active」，与现行 #331→#334、#335 承接 #134 的拆分矛盾，且本计划没有归档 owner | ExecPlan 路径笔误、Plan of Work 空、Batch 4 变异无读数；#332 验收清单未勾 |

## 分层检查

- **栈底只写自己的事实**：在本层 head 上 `git grep` ExecPlan 与 `docs/README.md`，没有断言 refresh / scheduler 已存在，也没有提到 #334 / #335；问题是关闭路线过时（ExecPlan 第 10、28、92、106、125、132、148、149、157、161 行），只合并本层时 main 上的计划会说「#134 由 B 关闭」，而 B（#331）现只关闭 #334。#334、#335 创建于 13:46Z，`55a99494` 正文写于 13:57Z，晚于拆分。
- **scope replace 原子性**：完整成功读取后才收敛；分页报错、截断、事务内写入抛错时 membership 与 field value 不变（Fake / SQLite）。
- **规模**：SQLite 在 50,000 条 incoming（代码上界）下 1.3s 完成，绑定变量未触上限。

## 上一轮意见复核（第一轮 head `5493627b`）

| 意见 | 结论 | 证据 |
|---|---|---|
| P1 跨 project redacted 条目 | 成立（已修） | 原反例 R1，与变体 R2（binding 不一致）、R3（objectKind 不一致）、R4（非 redacted 跨 project）在 head 与栈顶、Fake 与 SQLite 上均 `ok=false / invalid_input`，membership 与 projection 快照不变；base 上 `ok=true`。R5、R6（同一 item 可见 + redacted、完全重复）membership 保留 |
| #134 误入 native closing | 成立（已修） | closingIssuesReferences 只有 #332；提交与 PR 正文无关闭 #134 的关键字 |

额外复现（head 与栈顶全过）：可见变 redacted 后连跑三轮仍锚定；superseded 轮次 `stale_revision` 不删除；事务内抛错回滚；移走全部条目收敛为 0（base 上保留 5 条）；后续页报错不删除；新 item id 重加时实体与身份不变、旧 membership 与 field value 删除。本 PR 新增用例放回 base：删除收敛与 scope 两条变红，「不完整读取」为回归守卫保持绿。

## 变异表（当前 head，`scripts/review-mutate.mjs`，11 个文件 323 条用例）

| id | 位置 | 结论 | killedBy |
|---|---|---|---|
| M1 绕过 scope 校验 | `bootstrap.ts` | KILLED | Planning scope mismatch（Fake / SQLite） |
| M2 只比较 externalId | `bootstrap.ts` | SURVIVED | — |
| M3 redacted 已知 membership 不进 incoming | `bootstrap.ts` | KILLED | github-projects-bootstrap REDACTED → 映射失效 → 恢复 |
| M4 SQLite 删除丢掉 project 条件 | `storage-sync.ts` | KILLED | 规划成员 scope replace |
| M5 SQLite 空 incoming 变空操作 | `storage-sync.ts` | SURVIVED | — |
| M6 Fake 保留陈旧 field value | `fake/storage.ts` | KILLED | 内存替身 scope replace；full-read 集成 |
| M7 SQLite replace 去掉同内容去重 | `storage-sync.ts` | SURVIVED（core 路径上冗余） | — |
| M8 superseded 轮次仍收敛 | `bootstrap.ts` | SURVIVED | — |

M2、M5、M8 在评审复现（R2/R3、R10、R8）加入后被杀死，可作修复样例。

## 意见清单（inline 6 条）

- P2 `tests/integration/planning-membership-reconcile.test.js:40` #332 验收 3 缺判别测试（M8）。
- P2 `packages/storage/sqlite/src/storage-sync.ts:267` 空 incoming 分支无契约覆盖（M5）。
- P2 ExecPlan:28 关闭路线过时、无归档 owner。
- P3 `bootstrap.ts:158` binding / objectKind 比较无判别测试（M2）。
- P3 `bootstrap.ts:191` 删除 scope 应使用已校验的 project。
- P3 ExecPlan:132 执行记录与仓库事实三处不符。

## 结论

**APPROVE**：无 P0 / P1；上一轮 P1 与误关闭均按原条件与变体复核为已修。ExecPlan 关闭路线（P2）是只合并本层时 main 上会长期误导的文本，建议合并前改掉。

## 后续 owner 与合并条件

- 作者为 Codex 会话，本机无 Claude 作者会话；修复 owner 需人类伙伴指定，原话写入本 PR ExecPlan 的 Decision Log。
- owner 收尾：修复 → 修复本身的独立复评 → 归档本 ExecPlan（不依赖 #331 合并）→ 整合提交 → 勾选 #332 验收 → 人类逐 PR 授权后 rebase merge；#330 合并后 GitHub 会把 #331 的 base 改到 main，届时重锁 #331。

## 提交回读

2026-10-14 由 Singularity-AI-Bot 一次性提交 review `5514311132`（APPROVE，inline 6 条，commit_id 为本记录锁定的 head）；回读 inline 数一致。提交后 mergeStateStatus=BLOCKED，原因是分支保护要求所有对话已解决。

## 修复与复评（2026-10-14）

- **owner**：人类伙伴在本会话指定「本会话负责」修复与收尾（问「四个 PR 的修复与收尾由谁负责？」，答「本会话负责（推荐）」）。
- **修复**：第二轮 6 条 inline 意见均判定属实并修复：未提交轮次（分页成环、后续页 provider 错误、superseded、事务内拒绝）× Fake / SQLite 的判别用例；共享契约补空 incoming；ExecPlan 关闭路线以 `Global Constraints` 第一条为唯一表述；scope 校验三个分量各自判别；删除 scope 取本轮已校验的 project（`ValidatedPlanningRead`）；执行记录对齐。实施者在最终代码树上整表变异 13 KILLED / 1 SURVIVED（M7，理由见 ExecPlan）。
- **修复的独立复评**（head `42888169`）：6 条意见按原条件复核均已修；第一轮 P1 以 R1–R4 复跑无回退；交错轮次探针显示 `ValidatedPlanningRead` 是严格改进；#331 变基到修复后的 head 无冲突。新提 3 条 P3，已就地处理：scope 校验用例扩为三个分量 × {redacted, visible}（复评变异 X4 由 visible 用例杀死）；M7 存活理由与 `ValidatedPlanningRead` 的 Decision Log 措辞按代码事实订正。
- **归档**：ExecPlan 移到 `docs/exec-plan/completed/`，`docs/README.md` 索引行改为 Completed。
- **跟进**：M7（同一轮 incoming 含同内容两条时 Fake 后者胜、SQLite 整轮 fail closed 的端口语义）转跟进 issue。
