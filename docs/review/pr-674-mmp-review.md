# PR #674 MMP 交付评审

## Purpose / Big Picture

判断两条 Local Git 边界测试是否独立闭合 issue #174，并将代码缺陷、证据限制和产品发布门禁分开。成功证据为当前 immutable head 的风险矩阵、判别性验证与完整验收回读；评审不代替 R1/UAT。

## Context and Orientation

2026-11-24 独立复审对象为 PR #674，`test/local-git-boundary-tests-20261124` → `main`；head `c46fe590e76ebdb3db1cc8ab41744a49defa4e6d`，base `c24d149151964c2fe8ef0d120a9facab3c65b356`。本次工作树为 `.worktrees/iteration12-local-git-boundary-tests`，开始时 clean。关联 issue #174 要求 zero/negative limit cursor walk 及非 ENOENT/ENOTDIR stat 失败结构化拒绝，且应证明 RED。初始回读无 review / review threads；`PR Fast Gate`、Verify、Browser、Windows Native 均 SUCCESS，可选 `Create review session` FAILURE，日志确认本地 endpoint 返回 HTTP 404（run `45359402413`），该检查不在分支保护内。后续需重跑 `gh pr view 674 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,statusCheckRollup` 和 GraphQL reviewThreads 回读。

## Design / Spec

使用 Qian Systems Router 的系统边界和 First Principles Development 的故障机制检验：测试只能提供所断言行为的证据；源码无 diff 不足以证明测试有效。优先检查调用方分页终止性、路径 stat 失败传播、零 Git 调用及测试恢复。保留已有验收记录作为历史，当前复审以本节后的证据为准。

### 复审前 P0–P3 风险矩阵

| 等级 | 代码 | 产品闭环 | 架构 | 测试 | 工作项 |
|---|---|---|---|---|---|
| P0 | 是否改生产代码/破坏 main | 是否伪造 Saved/规划状态 | 是否越层/新增事实源 | 是否损坏真实仓库/用户文件 | 是否越权写入/合并 |
| P1 | 错误路径是否被错误判绿 | #174 两个行为是否有有效保护 | 是否引入测试专用生产缝或不安全路径 | 分页是否有界、EACCES是否实到达、变异是否归因 | 验收是否与真实head匹配 |
| P2 | 失败恢复和隔离缺陷 | 证据是否过度声称 | 测试是否锁住未承诺契约 | skip是否掩盖当前 lane 缺口 | issue/文档链接与归档顺序 |
| P3 | 可维护性 | 平台范围说明 | offset编码耦合 | 是否重复覆盖/新增低价值测试 | 文档量与重复记录 |

## Global Constraints

本轮仅写 `docs/review/pr-674-mmp-review.md`；不改测试/生产代码，不 commit/push/提交review；临时日志和 mutation spec 放运行态目录或临时目录。保留已有工作与历史证据，不把当前评审当成合并授权。

## Plan of Work

### Batch 1 · 锁定和复审

最小闭环：锁定 head/base/线程/checks/issue，先建矩阵，再读 diff、关键路径、CI、ExecPlan，跑有判别力的最窄验证。
涉及文件：本评审记录。
验证（在上述分支工作树根目录）：`pnpm test:file tests/integration/development-local-git.test.js` 期望 96 pass / 0 skip；`node scripts/review-mutate.mjs .superpowers/pr674-mmp-review/mutations.json` 期望关键变异被新增用例杀死且逐字节还原。必要时执行隔离反例。
回滚：本记录恢复本轮前版本；mutation 脚本自行还原所有目标文件，随后核对 production diff 为零。

## Validation and Acceptance

验收以 Batch 1 命令和当前源码证据为准；全矩阵结束后一次性回传发现、可定位新增行和残余验收边界。不将 test-only 交付扩展为 R1、安装态或人类验收。

## Progress

- [x] 2026-11-24 锁定 head/base、全部线程、checks 与 #174 原始验收；先建风险矩阵。
- [x] 2026-11-24 文件审查、focused测试、mutation 与 CI失败日志核对。
- [x] 2026-11-24 完成全矩阵；无 P0/P1 或代码缺陷，1 条非阻塞 P3 文档事实矛盾待协调修复。

## Surprises & Discoveries

现有评审文件并非本轮独立评审，记录的是实现时 agent 的验收处置；其中“未push/V7未执行”已成为历史状态。当前 PR 已 ready，远端 head/checks 已由本轮回读，历史记录保留如下。

## Decision Log

- 2026-11-24 / 独立评审：按当前 immutable head 重新评审，保留历史但不借用其通过结论；原因是旧记录有不同验收对象与易失状态。

## Idempotence and Recovery

只读查询和测试可重复。mutation 必须经 `scripts/review-mutate.mjs`，失败后先核对还原，再继续；运行态文件不得提交。当前审查不做历史改写、分支清理或外部写入。

## Interfaces and Dependencies

Node.js/pnpm/Git 与 GitHub `gh` 只读权限；Local Git provider 的 `listBranches`、`preflightWorktree`、paths `resolveWorktreePath` 为观察接口；POSIX DAC 身份是 EACCES 用例执行前提。

## Outcomes & Retrospective

当前 head 的全矩阵结论：**无 P0/P1、无代码缺陷；1 条 P3 文档证据矛盾**。production 和测试未修改；依赖方向、规划/工程事实拥有者、Provider ack 和凭据边界不受 test-only diff 影响。两条测试以 per-test fixture 隔离，权限恢复在 finally；不新增生产注入接口或重复产品路径。64 行测试闭合 #174，设计规模合适；计划正文的多轮叙事偏长，可在交付收尾压缩而无需新增机制。

### 本轮发现 F1 · P3 · 原处未标注被推翻的变异隔离结论

新增行 `docs/exec-plan/completed/2026-11-24-local-git-provider-boundary-tests.md:53` 的 I3 声称“M2/M3 只杀用例 2”。本轮实测与计划 S8/S10 都显示它们也杀死既有长分隔符用例。计划仍把相反说法列为不变量，违反 `PLANS.md` §4“被推翻的结论就地标注”要求，读者只读 Design / Spec 会误解回归证据。请更正 I3，或原处加 `Superseded by Surprises & Discoveries S8/S10（2026-11-24）`；保留真实的 `killedBy` 归因和新用例有效性。该项只影响文档，不阻塞交付。

Inline-ready: `[P3] Supersede the disproven mutation-isolation invariant` — “I3 still says M2/M3 kill only the new stat-error test, but S8/S10 and the independent mutation run show both also fail the existing long-separator test. This leaves the completed plan with contradictory evidence. Please correct I3 or mark it superseded at this original location, as required by PLANS.md §4; the new test's killedBy attribution remains valid.”

### 本轮可复现证据

在上述分支/head 的工作树根目录执行 Batch 1 的 focused 命令：exit 0，`tests 96 / pass 96 / fail 0 / skipped 0 / todo 0`。独立变异运行完整测试文件、基线和还原后基线均绿，M1–M6 全部 `KILLED`，退出 0，`git diff -- packages` 无输出；spec 由 ExecPlan 内联 M1–M3 加下表 M4–M6 组成。复现时将同文 spec 保存到 Batch 1 所列运行态路径，运行该处命令。

| ID | 独立变异 | 失败归因 |
|---|---|---|
| M1 | 去掉 `Math.max(1, input.limit)` | 仅新分页用例 |
| M2 | 吞掉所有 stat errno | 新权限用例 + 既有长分隔符 |
| M3 | canonicalize 重抛裸错 | 新权限用例 + 既有长分隔符 |
| M4 | provider 的唯一 `nextCursor: next < rows.length ? String(next) : undefined` 替为 `nextCursor: next < rows.length ? String(start) : undefined` | 新分页用例 + 既有四条分页契约 |
| M5 | provider 的唯一 `const next = start + Math.max(1, input.limit)` 替为 `const next = start + (input.limit === 0 ? 1 : input.limit)` | 仅新分页用例（负数分支） |
| M6 | paths 的唯一 `if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error` 替为 `if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EACCES') throw error` | 仅新权限用例 |

每条的 `killedBy`：M1/M4/M5 为 `分支列表：limit 为 0 或负数`，M2/M3/M6 为 `路径安全：非 ENOENT/ENOTDIR`。M4 的额外既有失败为共享分页逻辑敏感性，不误称只被新用例杀死。

`gh run view 45358324818 --job 138321663151 --log -R SingularityKChen/harness-projects` 的 hosted Verify 日志有两条新增用例的 `✔`，因此 root skip 目前是未来平台风险而非当前证据缺口。该 CI 完成 contract/integration/E2E：1625 tests（1 skip）、2359 tests（32 skips）、226 tests（0 skip）；不将它表述为全产品验收。`Create review session` 的 HTTP 404 已逐项核对，保留为非必需红检查。

### 工作项和验收边界

#174 两个原始结果均满足：zero/negative limit bounded walk 和真实非 ENOENT/ENOTDIR stat 结构化拒绝；当前实现已修复，以等价源码变异重建 RED，真实 chmod 失败代替新增注入缝，边界已明确。查询 open issue 的 `local Git pagination in:body` 与 `stat error in:body` 均只返回 #174，未发现重复 open 跟踪，不新增 issue。Root/Windows、NaN/Infinity、端口级 limit 语义、完整 Host/安装态和 R1/UAT 不属于此闭环，不应把其未验收写成代码阻塞。当前 ready、MERGEABLE；UNSTABLE 与可选 review-session 红检查一致，合并前仍需根协调方按当前 head 回读门禁、完成独立复评与授权收尾。

## Bottom Change Note

- 2026-11-24：追加本轮独立 MMP 复审，先固定事实和 P0–P3 矩阵；96/96 与 M1–M6 完成，记录 F1 非阻塞文档矛盾；保留此前验收处置作为历史证据。

---

# PR #674 MMP 验收处置记录（独立 agent 对抗验收）

## 锁定事实

- 日期：2026-11-24（Asia/Singapore）。
- PR：#674，分支 `test/local-git-boundary-tests-20261124` → `main`，关联 issue #174；base：`main` / `c24d149151964c2fe8ef0d120a9facab3c65b356`。
- 验收对象：实现提交 `8bef8e41797f009a3f13affa18c4e94d5bcc8251`（独立验收 v-174 实测）。处置时只 amend 其提交信息：tree `fdf7353ddb67567b28023a56e4911af893ce33a7` 不变，amend 后 head `ae7e1fe37eb1b1a6f055a149c5713b36b133b043`。处置后最终 head 由 `git rev-parse HEAD` 回读，应与 PR 面 `headRefOid` 一致。
- 执行上下文：`.worktrees/iteration12-local-git-boundary-tests`。本记录、`docs/review/README.md` 索引行、ExecPlan 更新与 4 行测试注释是验收处置的新增内容；未 push、未改其他工作树或 `main` 检出、未写 issue/PR/Project 字段、未执行 `gh` 写操作。
- 角色边界：独立 agent 对抗验收（v-174 verification-1，只读）加上本 PR 的验收处置（a-174）。**这不是人类评审，也不是 R1/UAT 或合并批准**；规划状态、是否 ready/合并由人类伙伴决定。
- 证据来源：未入库的 `.superpowers/iteration12/174/verification-1.md`（运行态记录，按 `AGENTS.md` §3 不进文档）；ExecPlan `docs/exec-plan/completed/2026-11-24-local-git-provider-boundary-tests.md`（V2 变异 spec 全文内联，可自包含复现）；`git log` / `git diff` 当前 head 回读。

## 范围与结论

只覆盖 issue #174 声明的最小闭环：`limit<1` 分页下界与 stat 错误分类两条判别性集成用例，加 `tests/integration/README.md` 两处措辞收紧；产品代码零 diff。独立验收结论为**无 P0/P1、1 条 P2（提交信息过度声称）、4 条 P3**；本记录处置后全部关闭或明确记录不修理由。工程验收不等于产品验收或 R1/UAT。

## 风险矩阵

| 等级 | 内容 | 结论 |
|---|---|---|
| P0 | 越界、破坏既有行为、虚假成功 | 未发现；`packages/**` 零 diff，既有 94 条断言零改动（测试文件此前为纯新增）。 |
| P1 | 行为缺陷、无判别力、证据造假 | 未发现；V1 96/96 独立复现，V2 M1–M3 全部 KILLED 且归因命中；计划外反例 M4–M6 均被新用例精确杀死。 |
| P2 | 发布面证据表述 | 1 条（P2-1 提交信息），已 amend。 |
| P3 | 平台门禁、维护性、契约语义、验收字面偏差 | 4 条：P3-1 补注释；P3-2/P3-3 记录不修理由并补注释；P3-4 由 D3/D5 预授权，书面化。 |

## 逐条处置与证据

### P2-1 · 提交信息过度声称（已修复，D12）

原实现提交正文写「既有用例都观察不到」，与本 PR 自己的 V2 输出矛盾：M2/M3 同时杀死既有「路径安全：长分隔符输入有界返回结构化拒绝，不阻塞调用进程」用例。机制（verification-1 §3 探针）：正常树 `stat` 抛 `ENAMETOOLONG`，`canonicalize` 折成 `undefined` → `unresolvable`；M2 吞掉全部 code 后同一路径变成 `outside_root`（既有用例 `deepEqual` 失败）；M3 让裸错误抛穿子进程（既有用例 `status===0` 失败）。两者共用 `resolveWorktreePath`，属真实共享敏感性，但既有用例不钉 `stat` 错误分类。

处置：该提交未 push，只 amend message（不改内容）——改为「既有长分隔符用例对 paths 层变异有部分敏感性，但它不钉 stat 错误分类，因此不构成两个行为的具名保护；V2 的 M2/M3 会同时杀死该既有用例，正是两者共用 resolveWorktreePath 的体现」。核对：amend 前后 `git rev-parse HEAD^{tree}` 均为 `fdf7353d…`，`git diff` 新旧提交无树差异。ExecPlan S10 记录同一归因。

### P3-1 · root lane 下 chmod 用例静默空心（已降低风险，残余风险保留）

原状：用例在 `process.getuid()===0` 时 `t.skip`；`scripts/run-test-layer.mjs` 只拒绝「零执行/全 skip」。未来 Verify 若改为 root/容器身份，该 EACCES 用例会静默 skip 而门禁仍绿。当前 CI Verify 为 `ubuntu-latest` 非 root，本文件不在 Windows lane（`docs/development/ci.md`），故当前无损失。

处置（提交 `267b6b7`）：用例首部补注释，写明「本文件不在 Windows lane、CI Verify 非 root，未来 root lane 需补该文件 `skipped===0` 门禁」。未新增门禁脚本（会扩到 `scripts/**`，超出 test-only 范围）；残余风险写入本文与 ExecPlan R2。

### P3-2 · 分页断言耦合数值 offset 游标（记录不修，补注释）

原状：能力契约只承诺 `cursor: string` 不透明游标，本用例为证明「严格前进」解析 `Number(cursor)`，依赖本地 provider 的 `String(next)` 编码。处置：不改断言（删除严格前进或改为集合相等都会弱化对「游标原地踏步」的判别力），在断言处补一行注释说明依赖与改写要求。ExecPlan D13 记录不修理由。

### P3-3 · `limit<=0` 夹取语义被测试锁死（记录不修，补注释）

原状：用例断言 `items.length>=1` 与 `<=max(1,limit)`，把 `limit<1 → 按 1 条夹取` 语义固定；ExecPlan D7 已把端口级 `limit` 语义留给后续裁决。处置：不改断言（每页非空正是「空页 + 原地游标」回归的诊断点），在用例注释注明「若裁决改为遍历结束返回空页，须同步改写本用例」；D13 记录。

### P3-4 · issue 字面「注入文件系统失败 / 对 pre-fix 实现示红」未逐字满足（书面化，不修）

可达历史中不存在 pre-fix 实现（ExecPlan S2），RED 只能以 M1/M2 等价重建；EACCES 用真实 `chmod 000` 而非注入缝（D3/D5 预授权，加注入缝会新增接口并移出真实 stat 失败观察面）。处置：不修，本文与 ExecPlan Outcomes 的「证据边界」写明该口径，供 PR body 引用。

## 观察项（不改动，记录）

- O-1：PR 面仍停在 Batch 1（head `19ab0e88`、body 未回填、引用 active 路径）；V7 与 `gh pr ready` 属 push 后动作，本处置不执行（D10）。
- O-2：计划已在 push/V7 前归档到 `completed/`，与 `PLANS.md` §2 字面顺序有偏差；D10 已声明，push 后若 head 内容再变需重看归档结论。
- O-3：既有 chmod 000 用例的恢复不在 `finally`，属预存问题，按 D4 不改。
- O-4：计划自设文档体量估计 210–230 行，验收处置后实际见下节，仍低于自设 1300 / 硬上限 1500。
- O-5：`tests/integration/README.md` 两处新措辞与断言逐项对应，无过度声称。

## 最终验证（处置后 head 实跑）

| ID | 命令 | 结果 |
|---|---|---|
| V1 | `pnpm test:file tests/integration/development-local-git.test.js` | exit 0；`tests 96 / pass 96 / fail 0 / cancelled 0 / skipped 0 / todo 0` |
| V2 | `node scripts/review-mutate.mjs .superpowers/iteration12/174/review-mutate.json` | exit 0；M1/M2/M3 全 `KILLED`，`failing` 归因命中；还原后基线绿、`packages/` 零 diff |
| V3 | `node scripts/rule-checks.mjs size origin/main` | exit 0；`代码：64 / 1000 行`、`文档：351 / 1500 行` |
| V4 | `node scripts/rule-checks.mjs disclosure origin/main` | exit 0，「机械扫描通过」；人工五类目无命中 |
| V5 | `git diff --check origin/main...HEAD` | 无输出，exit 0 |
| V6 | `git diff --name-only origin/main...HEAD` | 6 个路径：`docs/README.md`、completed ExecPlan、`docs/review/README.md`、`docs/review/pr-674-mmp-review.md`、`tests/integration/README.md`、测试文件；无 `packages/**` 等 |
| 补充 | `pnpm run typecheck` / `pnpm run boundaries` | typecheck exit 0；boundaries 10/10、fail 0（test-only 改动，按验收要求补跑） |

V2 spec 全文内联在 ExecPlan「变异锚点与 spec」；`.superpowers/` 中的运行态 spec 不入库，复现以计划内联文本为准。

## 残余风险

1. root/容器化 Verify lane 引入时，EACCES 用例会静默 skip；需补该文件 `skipped===0` 门禁（P3-1 注释已提醒）。
2. 分页用例依赖数值 offset 游标；provider 若改不透明游标，断言会误红，需按注释同步改写（P3-2）。
3. `limit<=0` 语义若被裁决为「遍历结束返回空页」，用例需同步改写（P3-3）。
4. 本 PR 是 test-only 证据闭环，未跑完整 `pnpm verify`/E2E/Windows lane（按 `docs/review/README.md` §2 的最小证据选择）；产品/R1 仍独立。
5. V7（远端 head / checks / ready）未执行：不得 push、不写 PR 字段（D10）。

以上不是人类评审结论；`Refs #174` 保持 OPEN，关闭由 PR body 的 `Closes #174` 承担。


2026-11-24 本轮处置：review `6036469963` 已由评审账号一次提交（APPROVE + F1 一条 P3）；F1 已在原 I3 就地保留旧文并标 Superseded，明确 M2/M3 共享失败名单，未改变断言或产品。此前历史记录的未 push / draft 只指实现期，本轮当前头门禁另回读。用户直接授权 #674–#677 的修复、复审、归档、提交整理、issue 核对、rebase 合并与清理；最终发布和独立复审仍是合并前置。


2026-11-24 独立修复复评（未发布文档树，HEAD 仍为 `c46fe590e76ebdb3db1cc8ab41744a49defa4e6d`）：F1 已充分修复；I3 原处保留旧文并标 Superseded，纠正为 M2/M3 同时杀死新 stat 用例与既有长分隔符用例，判别标准为 killedBy 命中，与本视角首审的 M1–M6 真实输出一致。变更仅限本计划和本评审记录，生产/测试/断言无 diff；PLANS 强制章节、S8/S10 与评审路径均存在，历史未 push/draft 与当前远端观察已分界。#174 的两项语义和 RED 要求分别由 0/-1 有界分页、真实 chmod 非 ENOENT/ENOTDIR 拒绝以及等价源码变异映射，未声称真实历史 pre-fix 检出或完整运行产品、人验、R1/UAT 已验收。文档变更不需要重复行为测试；`git diff --check` 通过。无新增 P0–P3，复评 PASS，最终发布 head 的远端门禁仍由根协调方回读。
