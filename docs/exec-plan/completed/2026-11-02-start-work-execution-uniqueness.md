# Start Work 外部执行唯一性 ExecPlan

> 状态：Completed（工程实现与独立验收；发布门按当前 head 回读）；创建：2026-11-02；关联：Closes #421，Refs #304。
> 按根 `PLANS.md` 维护；正式归档目标为同名 `docs/exec-plan/completed/` 文件。

## Purpose / Big Picture

通过真实 startWork 公开入口证明：旧 owner 活着但租约过期、响应丢失或 Core 重启时，同一个未决执行最多产生一个外部 run；状态不明仍如实 Unknown。此 PR 可以只增加判别性组合测试；不为制造产品差异重建已存在的 fence，也不声称未知 run 可被自动找回。

## Context and Orientation

设计观察基线为 2026-11-02 `origin/main@554e6fefb1ad9781becf879b9f96e367e9f6ceff`；执行前记录 #193 当前 head 与本 PR base。#204 已在每次创建前提交 typed intent，#420 有持久 generation fence，#193 连接 durable run 与原 receipt。现有 `start-work-owner-fencing.test.js` 的部分执行用例手工安装后继 generation，只证明本地结算协议，明确没有证明公开接管和外部唯一性。这里补齐这个证据缺口。

## Design / Spec

默认不改产品。使用可控 clock、Promise barrier、真实 Fake/SQLite Storage 与独立外部 run ledger。A 在尚无未决槽位、仍 Provisioning 的 settle 前停住，B 过期后以公开命令接管并开始；A 释放后不能 dispatch/覆盖。A 已提交 execution intent 但实际调用未 dispatch 时，B 同 key/new key/新 Core/过期时间都不得发第二次创建；释放 A 只得一个外部 run。A 已被 provider 接受而 ack 被阻塞或丢弃时，同样按真实副作用数证明唯一；main/fallback 分别断言。

已知 ref 沿 #193 观察同一对象，缺 ref 永远保持未知；新 key 不能占替代 receipt。SQLite 用两个 Core/连接测试并发，并在无活动 owner 的崩溃场景真实 close/open；Fake 真实 export/import。不能关闭仍被旧 owner 使用的 SQLite 连接来冒充正常并发。

负控在隔离临时源码副本执行：删除 owned 的 generation 比较后，迟到 owner 全快照断言必须失败；在 accepted-but-held-ack、尚无 run 行的用例里，同时将 claimContext 的 pending 查找变为无匹配，并在 isTerminal 错误纳入 Ready，形成明确的双防线不安全变体；同一 public new-key 命令必须观察到第二个外部创建。两项变异必须同时记录，不能把它说成只删一行就可绕过全部冗余防线。每个负控记录最小补丁、命令和具体失败断言，随后恢复副本。若某变异仍绿色，说明它没击中所称防线，不能宣称负控有效。可另用故意绕过持久 slot 的小型 test-only 不安全参考流程证明外部 ledger 能分辨两个 run，但它不替代生产守卫变异证据。

新测试可能基线即 GREEN，这是既有安全性的证据，必须如实记录。真正发现漏窗才由 #193 的同一架构 owner 修改 dispatch 前短事务的 generation/slot 检查；不以增加 timeout、内存 Map、取消 Promise、扩 SessionPort 或全局 session 扫描代替排他。

## Global Constraints

分支 `fix/start-work-execution-uniqueness`；工作树 `.worktrees/start-work-execution-uniqueness`。本轮测试包含 #193 恢复组合，故以其冻结 head 建薄原生 stack；#193 已合并时直接基于 main。它不是新增 native blocked-by 的理由。执行架构只有一个 owner；#421 不与 #193 同时修改同一模块。

唯一允许文件集：新 `tests/integration/start-work-execution-uniqueness.test.js`；必要时 `tests/e2e/start-work-recovery.test.js`；只有新公开反例证明必要时窄改 `packages/core/src/start-work.ts`；本计划 active/completed 路径；`docs/README.md` 协调者串行登记。默认产品 0 行、测试 210–290 行；必要修正预留 35 行；文档约 130–200。严格 code/test/config <800、docs <1300，不改 Provider/Host ABI、Storage schema、lease 常量、规划状态或其他栈。

所有命令在本节指定分支的工作树根目录运行；使用 Node 26 与仓库锁定的 pnpm 10.28.2。先核对 `node --version`、`pnpm --version`，执行 `pnpm install --frozen-lockfile`。本地验证只证明对应检出；不代替最终 hosted checks、真实 GitHub 写入、人工 Desktop UAT 或 Gate R1。Git 操作经 subprocess argv/library 调用，不拼接 shell；工作树路径先 realpath 并确认处于 `.worktrees/` 下。

## Plan of Work

### Batch 1 · 公开入口 barrier 与判别性证据

最小闭环：不安装人工后继 generation，也能证明一次实际接管与两类禁止接管。主文件为新唯一性集成测试。先实现三种 barrier，每次断言实际命中恰好 1 次、输入/owner generation/原 intent/外部 ledger。运行 `pnpm test:file tests/integration/start-work-execution-uniqueness.test.js`，期望 main/fallback × Fake/SQLite 的副作用数 ≤1 与 Pending/Unknown 各自成立；记录哪些直接 GREEN。执行两类临时变异，期望指定断言 RED，恢复后同命令 GREEN。回滚本批测试；不触碰外部对象。

### Batch 2 · 重启组合与当前 head 交付

最小闭环：#193 的已知引用恢复不会释放未决槽位、启动第二次或覆盖后继。主文件为同一唯一性测试和必要 E2E。运行 issue 原定命令 `pnpm test:file tests/integration/start-work-execution-uniqueness.test.js tests/e2e/start-work-recovery.test.js tests/integration/start-work-sqlite-registration.test.js`，再运行 `pnpm test:file tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-external-intent.test.js tests/integration/start-work-execution-recovery.test.js`；期望 fail 0、无跳过关键 case。回滚完整 PR；产品若无变化，公开描述明确这是组合证据闭环。

栈的 disclosure/size/diff 检查以 `fix/start-work-execution-recovery` 为直接 base（其已合并时使用 origin/main）；另外记录 origin/main 累计规模。先按默认分支 main 建 draft 及 reciprocal issue 关联，再用原生 gh stack link 声明父 PR，并回读 base/closing references；不得用手写文本模拟依赖。共享历史整理走 git-expert-operations 建恢复锚点和精确 lease。

交付前运行 `pnpm run typecheck`、`pnpm run boundaries`、`node scripts/rule-checks.mjs disclosure fix/start-work-execution-recovery`、`node scripts/rule-checks.mjs size fix/start-work-execution-recovery`；Git argv 执行 `git diff --check fix/start-work-execution-recovery...HEAD`，期望全部退出 0；另外按新增+删除重新核算任务硬限，代码/测试/配置严格 <800，文档严格 <1300，仓库默认 size 通过不代表任务硬限通过。提交前人工检查凭据、本机身份、个人信息、内部系统、保密字样。整理成可独立审阅提交，再创建/更新 draft PR，英文描述含闭环、计划/Batch、Closes/Refs、真实证据、风险、回滚。最终 push 后使用 `gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup,mergeStateStatus` 与 `gh pr checks --repo SingularityKChen/harness-projects` 回读当前分支 PR；再按返回 number 用 GraphQL 回读全部 reviewThreads（分页至结束）。期望 head/base/关联正确，当前 head 必需 checks 通过且无未处理阻塞意见，之后才 ready。只请求人类评审，不自行合并，不修改 Planning Status/native blocking 字段。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| 真正公开接管 | A 在无未决外部槽位的 Provisioning 断点暂停；B 过期后公开 startWork 成功；A 释放后零 start，赢家外部 run=1 |
| 已 durable intent、尚未 dispatch | 新 key/过期/重组只观察；无第二 attempt；放开 A 后恰好一实际副作用 |
| 接受后 lost ack | same/new key 与 reopen 不增加外部 ledger；缺 ref 明确 Unknown，primary ambiguous 的 fallback=0 |
| fallback 对称 | 仅主执行确定拒绝后可进入 fallback；fallback 的未知结果不冒充 Git Saved 或主执行失败 |
| 原 owner 迟到 | #193 已恢复或后继结算后，原调用不能覆盖全快照/新状态，也不触发额外 fallback |
| 测试可否证 | barrier hits=1；unsafe ledger 正控能计数 2；生产 generation/slot 的有效变异产生指定 RED，恢复后 GREEN |
| crash/restart 可复现 | Fake 导出导入、SQLite 实际 reopen、两个连接并发分别记录，不能用手写 generation 冒充公开接管 |

## Progress

- [x] (2026-11-02 Asia/Singapore) 独立确认已有 fence 与旧测试证明范围。
- [x] (2026-11-02 Asia/Singapore) Batch 1：公开 barrier、外部独立分配 ledger、两项有效生产守卫负控完成；新增测试 204 行，产品 0 行。
- [x] (2026-11-02 Asia/Singapore) Batch 2：旧父层4项 RED 已由 #193 owner修复，原测试等价重放到 `1039bef` 后29/29、指定组合156/156；独立规格/质量 PASS，见最终证据。

## Surprises & Discoveries

现有 safety 实现可能已足够；#420 的执行 fixture 明说不证明公开唯一性。不能把新增测试“基线通过”误读成无交付价值，也不能捏造先 RED 的日志。

2026-11-02：公开序列确实复现 #193 父层缺陷：A 提交 unknown run journal 后暂停、receipt 仍 pending；独立 Core B 公开 startWork 读回 running 并把原 receipt 保存为 saved；A 恢复后把原 receipt 降成 unknown。Fake/SQLite × main/fallback 四项均在 `late original must not downgrade publicly reconciled Saved receipt` 断言失败（unknown ≠ saved），外部 run 仍只有一个。此处保留判别性 RED，运行时由 #193 owner 修改，本 PR 不补第二处架构实现。

composeCore 自身会进行同步轮次与 cursor 写入，因此阻挡观察的全库快照在第二个 Core 构造完成之后采集；所有公开 startWork 观察仍须保持该完整快照不变。并发 SQLite 始终保留 A 活连接并打开 B 独立连接，重启用例则在 A 已结束后真正 close/open；Fake 真正 export/import。

## Decision Log

2026-11-02 / 独立评审协调者：本会话人类直接指示“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续”，并列明“re-review → 归档 ExecPlan → … → merge_method=rebase 合并”；此条件授权具体覆盖 #490、#491、#492、#495。#492 当前全矩阵无新增 P0–P3，独立证据见 [本轮报告](../../review/2026-11-02-pr-492-independent-mmp.md)。每个最终 head 仍须当前批准、真实 CI 与线程回读；不改 Planning Status 或原生依赖。

2026-11-02 / 独立规格评审：采用 proof closure，优先测试-only；理由是 durable slot 已排除盲目重建，新增协议会扩大未知。选择依赖 #193 的薄栈仅因为本轮第 4 类验收组合恢复行为。

2026-11-02 / 执行边界：协调者确认四项迟到回归属于 #193 P1；本任务提交 test-only 证据，当时保持计划 active，等待父层修正后由协调者 rebase、重跑和最终发布（Superseded by Outcomes 最终重放记录，2026-11-02），不将当前 RED 伪装成全绿交付。

## Idempotence and Recovery

测试各建独立世界，重复运行不清用户目录。负控仅临时副本且运行后核对生产 diff 无变异残留。revert 只撤本 PR，保留远端 run/数据库。未知引用活性限制与 #193 一致；不新建“全局 exactly-once”技术债来暗示原 acceptance 已完成，不因测试通过修改规划字段。

## Interfaces and Dependencies

依赖现有 composeCore/startWork、原 intent/generation 与 #193 恢复行为。无需 Provider 或 Host 新参数。SQLite 短事务比较本地状态，Provider I/O 仍在事务外；单 writer 规则与 SQLITE_BUSY 不能当作外部去重协议。

## Outcomes & Retrospective

执行依赖点为 #193 冻结 `e24a977dc02e6127a93d368fd51afa748fd5344b`，本 PR draft 为 #492，native stack 为 #493。新套件共 29 项：独立 ledger 正控 1 项、公开接管 4 项、dispatch 前 intent 屏障 4 项、accepted held/lost ack 8 项、已知/缺引用真实重启 8 项均基线 GREEN；4 项迟到原调用结算用例准确 RED，等待父层修正。 Superseded by 本节下方最终重放与独立验收记录（2026-11-02）；旧值仅为失败断点证据。

实测命令均在本计划工作树、Node 26 与 pnpm 10.28.2 下运行。`pnpm test:file tests/integration/start-work-execution-uniqueness.test.js tests/e2e/start-work-recovery.test.js tests/integration/start-work-sqlite-registration.test.js` 为 156 项 / 152 passed / 4 failed，无 cancelled/skipped；失败仅为上述四项父层回归。`pnpm test:file tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-external-intent.test.js tests/integration/start-work-execution-recovery.test.js tests/e2e/start-work-recovery.test.js tests/integration/start-work-sqlite-registration.test.js` 为 287 passed / 0 failed；`pnpm run typecheck` 退出 0；`pnpm run boundaries` 9 passed / 0 failed。完整 verify 和 hosted 当前 head 检查在父层修正后由协调者执行；本地证据不代替它们。 Superseded by 本节下方最终重放与独立验收记录（2026-11-02）；旧值仅为失败断点证据。

有效变异由 `scripts/review-mutate.mjs` 在独立临时完整源码副本运行，使用 `killedBy`，命令为 `node --test --test-name-pattern="public takeover|accepted held ack" tests/integration/start-work-execution-uniqueness.test.js`。M1 删除 owned 的 generation 比较，四项 public takeover 均因 `late owner must not change complete winner snapshot` 失败；M2 同时令 claimContext pending 查找无匹配、把 Ready 错误列为 terminal，四项 accepted held ack 均因 `one accepted create must mean one independent external run` 失败（2 ≠ 1）。两项都是 KILLED，harness 退出 0，前后基线为 GREEN；另存每项完整失败日志核对具体断言。恢复后源码 SHA-256 为 `04fa77a6fefe37ee8b1a27318f37bea37e4018d98cce9b693877b93f82e1e3db`，与执行工作树逐字节一致。M2 明确是双守卫不安全变体，不声称只删 pending 检查即可绕过冗余防线。

本轮不裁决 R1 或人类 Host 验收；父层修正后全部通过才能归档。 Superseded by 本节下方最终重放与独立验收记录（2026-11-02）；旧值仅为失败断点证据。

2026-11-02 最终重放与独立验收：直接基底为 `1039beff9a97ba4c2d85067db3300f94b6b009c7`，技术 head 为 `6c788e93faf0ab3a232eadea7194bcadd0f36c4d`，新文件29/29；上列 issue 指定三文件156/156、零跳过/取消。协调者另在该 head 的工作树根运行本计划新文件与 #193 七个相关文件，`pnpm test:file` 为410/410、零跳过/取消。两项当前树正式变异仍由预期四项组 killedBy 杀死并逐字恢复，独立规格/质量 PASS，详见 `docs/review/pr-492-mmp-review.md`。本 PR 产品改动0行；旧152/156与pending-parent措辞只保留为已被推翻的历史断点。最终 hosted head/base/checks 与全部线程按 Plan of Work 回读。无新增接受延期的技术债；R1与人类验收保持独立。

## Bottom Change Note

2026-11-02：综合 A/B，将 #421 收敛为现行排他链的组合证明，明确直接 GREEN、有效负控、公开入口与人工协议 fixture 的边界。

2026-11-02：独立最终验收完成后归档工程闭环，旧失败/待父层结论原处标注 Superseded，最终发布依当前 head 回读。

2026-11-02：加入本轮独立 MMP 全矩阵与直接条件合并授权；原工程计划保持 Completed。
