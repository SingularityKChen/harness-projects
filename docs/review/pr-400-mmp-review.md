# PR #400 MMP 交付评审

2026-11-02：初始head `d35f9127de0e874f16144a6b5e375147f890ea71`；在 `chore/setup-node-v7` 的 `.worktrees/setup-node-v7` 检出。用户授权接管全部开放PR的review与rebase merge；本PR仍须先完成独立评审及当前head CI。

## 先验风险矩阵

| 等级 | 风险 | 验证方向 |
|---|---|---|
| P0 | 新action越权、聚合执行候选代码或读secret | 固定SHA、权限、checkout/聚合信任边界 |
| P1 | 工具版本不兼容、CI假绿或必需门失效 | 失败日志、官方action契约、W1–W7和实际hosted运行 |
| P2 | 版本声明/测试/文档不同步、重复更新或过度调整 | 全部调用点、已有跟踪、最小修复 |
| P3 | 注释和维护说明漂移 | 发布面、可读性、回滚闭环 |

## 分层证据与结论

结论：1 个 P1，建议 REQUEST_CHANGES；没有发现额外 P0/P2/P3。范围是 setup-node action 升级与其精确 SHA 契约对齐，不能直接批准或合并当前 head。诊断使用 Superpowers、Qian Systems Router、First Principles Development 与 systematic-debugging，按“日志→失败断言→官方契约→当前 main→最小复现”追因；本阶段未修改实现、Git 历史或远端 review。

### 锁定对象与当前性

- PR #400：OPEN、非 Draft，作者 Dependabot，head `d35f9127de0e874f16144a6b5e375147f890ea71`，声明 base 为 `main`；API `baseRefOid` 为历史对象 `8b7429778c3a2bf322744ca32c1d07b32fb8c1f5`，`mergeable=MERGEABLE`、`mergeStateStatus=BEHIND`。
- 独立读取远端 `refs/heads/main` 为 `09eb366c0c7541f7cac40b3e71123e5dfe49579e`。该对象与历史 base 的 `.github/workflows/` 完全相同；当前 main 的三条旧 setup-node 精确 SHA 断言仍存在，故原失败机制尚未被 main 修复。不能用历史 base 代替后续实际 rebase 基准。
- 本 PR 一条提交、五份 workflow、10 个调用点，全部由 v4.4.0 完整 SHA 改为 v7.1.0 完整 SHA；增删合计代码 20 行、文档 0 行，无 package/lock/Node 目标版本或产品源码改动。
- reviews、inline comments、issue comments 均为零；review threads 一页完整为空，`hasNextPage=false`。`kind:chore` / `area:ci` 合规；Bot 作者适用同仓 issue 关联豁免。查询 setup-node 的开放/关闭 issue 仅得到 #236/#413 等正文引用，无专门覆盖此次三断言失配的 issue；同名 PR 只有 #400，本 PR 本身是现成跟踪，不必重复建项。

### 完整风险矩阵裁定

| 等级/面向 | 核查与结论 |
|---|---|
| P0 · 固定来源与特权面 | 官方 `refs/tags/v7.1.0` 精确指向 `949feb2413d6458794dcd2491c4babbbce0c15c1`，与全部 10 个新 pin 相同；官方 release 标记 immutable，发布日期为 2026-10-08。未扩大 workflow/job 权限、PAT 可见步骤、默认分支 checkout 或不可信 PR 执行面。 |
| P0 · 聚合与规划权威 | Fast Gate 代码、needs、权限和不 checkout/no-secret 边界完全未改。原运行 Verify 红后聚合也红，未假绿。工程投影的 writer/Planning Status 规则、Provider 凭据保存及业务事实源未变。 |
| P1 · 真实工具兼容性 | v7 action 的 `runs.using=node24`；官方要求 runner ≥2.327.1，原托管 runner 为 2.338.0。实际 action setup、pnpm frozen install、Node v26.12.1 和 typecheck 都 success；不是 action 无法启动或 Node26 不兼容。 |
| P1 · 契约同步 | 有一项阻塞，见下节。三个安全接线契约还期待旧 action SHA，CI 在测试阶段确定失败；当前 main 同样保留这些断言，单纯 rebase 不会解决。 |
| P2 · ESM、认证与缓存 | v7 ESM 是 action 自身实现方式；仓库没有直接 import action bundle。所有调用均无 `registry-url`，所以移除 dummy `NODE_AUTH_TOKEN` fallback 不触发。项目 `packageManager=pnpm@10.28.2` 且无 npm devEngines；显式 `cache: pnpm` 的五个测试 lane 保持缓存，其余特权/规则 job 不触发 npm 自动缓存。没有证据要求增改认证、缓存或包管理器设置。 |
| P2 · 触发、门禁与工作项 | 新旧触发器、job 集合、超时、concurrency、main push 不取消策略完全一致；没有新增 workflow，因此无需扩充通用规则映射。W1–W7 本地扫描 8 文件无 finding。Board invariants 和 Engineering state 仍只允许既有默认分支可信路径，不能为了候选验证而增设携 PAT 的 dispatch。 |
| P3 · 维护与披露 | 五份 workflow 注释中的 v7.1.0 与 pin 一致，全部调用点覆盖完整。PR 只升级一个 action，范围适当；没有理由顺带升级 pnpm、Node、checkout、依赖锁或改缓存策略。发布面机械检查含 PR_BODY、规模、diff-check 全通过；人工五类目未发现新增披露项。 |

### 全部可行动意见

**[P1] 同步升级特权 workflow 的精确 SHA 契约。** 新增行锚点：`.github/workflows/engineering-state.yml:44`（同根因还涉及 `.github/workflows/board-invariants.yml:56`、`:79`）。触发条件是按此 PR 升级 action 后运行 `pnpm test`；三个现存测试仍把 `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` 作为唯一期望，因此面对经官方核实的新 pin 必然失败。影响是 Verify 和唯一必需聚合 `PR Fast Gate` 持续失败，候选无法完成合入门。根因是 dependency-only patch 只修改 YAML，漏同步这三个特权接线契约；不属于权限策略、action 运行时或工具链兼容性故障。

最小修复是保留原有精确 SHA 与其余安全断言，仅更新以下三条期望为官方新 SHA：

| 测试 | 当前 PR 行 | 当前 main 行 |
|---|---:|---:|
| `tests/contract/check-board-workflows-live.test.js` | 151 | 153 |
| `tests/contract/engineering-drift.test.js` | 504 | 506 |
| `tests/contract/engineering-state.test.js` | 486 | 488 |

不应把断言降级为只匹配 action 名、任意 SHA 或从被测 YAML 反读同一个值；这些测试仍需独立保护所批准的供应链对象。此处是原远端 head 的诊断与建议。实施状态 **Superseded by 本文“修复 addendum”（2026-11-02）**；原评审快照保留。

### 独立根因证据

- [原 CI run 39754815629](https://github.com/SingularityKChen/harness-projects/actions/runs/39754815629)：2026-10-22、pull_request、精确 head `d35f9127de0e874f16144a6b5e375147f890ea71`，目前无更新 head 运行。Verify 中 setup-node、install、typecheck 全 success，`pnpm test` failure；1899 tests、1895 pass、3 fail、1 skip，失败恰为上表三个测试，actual 新 SHA / expected 旧 SHA。聚合 job `119744511604` 因 `Needed job results: failure` 失败，是正确传播。
- 同 head 的 Merge Gate `39754815845` 与 Rule checks `39754815827` 为 success，不能覆盖 Verify 失败；同 head 的 Engineering state success 来自默认分支旧 workflow，不能证明候选特权 job 的新 action 已在平台运行。
- 当前本地检出原 head，在 `.worktrees/setup-node-v7` 运行 `node --test --test-timeout=120000 tests/contract/check-board-workflows-live.test.js tests/contract/engineering-drift.test.js tests/contract/engineering-state.test.js`：exit 1，132 tests /129 pass /3 fail，0 cancel/skip/todo；失败名和 SHA 差异与托管日志完全一致。
- 官方依据为 [v7.1.0 release](https://github.com/actions/setup-node/releases/tag/v7.1.0)、该不可变提交的 [action.yml](https://github.com/actions/setup-node/blob/949feb2413d6458794dcd2491c4babbbce0c15c1/action.yml)、[README](https://github.com/actions/setup-node/blob/949feb2413d6458794dcd2491c4babbbce0c15c1/README.md)、`src/main.ts` 与 `src/authutil.ts`。逐项检查了 node-version-file、显式/自动缓存分支和 registry-url 认证分支，没有只采信 Dependabot 的 release 摘要。

### 其余实际验证与环境区分

- `node scripts/workflow-check.mjs`：exit 0，8 文件、0 findings。
- 三份通用 CI 契约 `workflow-check.test.js`、`merge-gate-workflow.test.js`、`rule-checks.test.js` 首次执行 118/119；唯一额外失败是“CLI：脚本路径含空格时仍然真的执行检查”。原因是本 worktree 未安装独立 node_modules，普通 import 向上解析到仓库依赖，但复制脚本夹具把缺失的 worktree node_modules 软链到临时目录。它与本 PR pin 无关。保持同一 immutable worktree 的测试与脚本，仅在已有完整依赖的仓库根 cwd 运行这些文件，单例 1/1、三份完整契约 119/119，exit 0、0 cancel/skip/todo；没有为此修改源码或依赖。
- `node scripts/rule-checks.mjs disclosure 8b7429778c3a2bf322744ca32c1d07b32fb8c1f5`（含当前 PR_BODY）、`size` 与通过 Python subprocess argv 执行的 `git diff --check <base>...HEAD`：全部 exit 0。规模为 20 行，未混入产品/包变更。
- 本阶段没有跑已知会因三断言失败的全量验证、没有执行变异或特权平台写入，也没有把本地检查替代新 head 的 hosted CI。

### 建议修复与后续验证门

协调者先按本完整矩阵提交一次 REQUEST_CHANGES，再授权实现者按根因修复。先在当时最新 main 建恢复锚点并重放此 action-only patch；若期间新 lane 合入，只核对新调用点是否属于同一个 setup-node 升级闭环，不机械改变其它工具版本。现有三条红测试已经提供判别性的 TDD RED；更新三条批准对象期望后，重跑完整三份测试与上述通用 CI 契约、W1–W7，再以正常安装的隔离 worktree 执行 `pnpm verify`、发布面/体量/diff-check。

最终 push 后逐 SHA 回读 head/base、全部 threads、issue/Bot豁免和真实 CI/PR Fast Gate；原红、旧 main 绿和本地替代运行均不沿用为新 head 结果。默认分支才生效的特权 workflow 保留合并后运行回读门，不能扩权限或新增持 PAT 的候选执行路径来抢先验证。本修复不关闭 #143/#449/R1 或任何产品验收；整体回滚是还原本 action 升级及配套三条期望，聚合规则保持。


## 修复 addendum

观察时间：2026-11-02 21:01 +08。正式 REQUEST_CHANGES 为 review `5736794478`，原远端 head 仍为 `d35f9127de0e874f16144a6b5e375147f890ea71`；此 addendum 只描述该检出上的本地工作区修复，不冒称已发布新 head、已获独立复评或已 resolve thread。活计划为 `docs/exec-plan/active/2026-11-02-setup-node-v7-contracts.md`。

协调者授权唯一实现 owner 只同步三个批准 SHA 期望，并明确允许通过 review-mutate 临时修改对应真实 workflow pin 后整表恢复。现有 132/129/3 RED 是起点；持久修改只有上表三条 `assert.equal` 的旧 SHA→官方新 SHA，全部权限、默认分支、触发与凭据断言保持。工作区测试 diff 为 3 行新增/3 行删除。

实际局部验证：三份完整安全契约 132/132、0 fail/cancel/skip/todo；三份通用 CI 契约 119/119、0 fail/cancel/skip/todo；`node scripts/workflow-check.mjs` 检查 8 个文件、0 findings。通用契约按前述已核实的依赖上下文运行同一 worktree 的文件，没有安装或改动其它工具。

在最终三条修复上运行 `node scripts/review-mutate.mjs .superpowers/setup-node-v7/pin-mutants.json`，命令为三份安全契约的完整 node argv。以下六项直接改真实 YAML，独立精确期望保持原样：

| 被测 job / 文件 | 输入故障 | killedBy | 结果 |
|---|---|---|---|
| board-workflows / board-invariants.yml | 旧 SHA | 带 PAT 的 workflow 只有 schedule 入口 | KILLED |
| board-workflows / board-invariants.yml | 未批准 40 位 SHA | 带 PAT 的 workflow 只有 schedule 入口 | KILLED |
| engineering-field / board-invariants.yml | 旧 SHA | 漂移 job 挂在 Board invariants 上 | KILLED |
| engineering-field / board-invariants.yml | 未批准 40 位 SHA | 漂移 job 挂在 Board invariants 上 | KILLED |
| sync / engineering-state.yml | 旧 SHA | 特权 reconcile 只由默认分支 workflow 运行 | KILLED |
| sync / engineering-state.yml | 未批准 40 位 SHA | 特权 reconcile 只由默认分支 workflow 运行 | KILLED |

夹具整体 exit 0，六项均 RED exit 1 且失败名匹配 killedBy，没有 KILLED_OTHER/NOT_APPLIED/SURVIVED；前置与还原后基线均绿。旧 SHA 为 `49933ea5288caeca8642d1e84afbd3f7d6820020`，未批准 SHA 为 `1111111111111111111111111111111111111111`。两份 workflow 逐字 SHA-256 与变异前一致；通过 Python subprocess argv 执行 `git diff --exit-code HEAD -- .github/workflows` 和 `git diff --check` 均为 0，原 action 升级没有额外残留。还原后再跑三份安全契约，132/132、exit 0。

实现者的局部结论：已提供解决原 P1 的最小候选及判别性证据，提交另一独立评审者复核。本阶段未 Git mutation、提交、rebase、push、远端回复或更改共享索引。完整 verify、真实 browser 和 hosted checks 按已授权分工留给协调者在最终实际 main 重放后执行；原远端红不作为修复候选结果，局部绿也不代表新 head 的必需门已经通过。

## 最小修复的独立复评

2026-11-02 SGT，独立于实现者的评审对原head d35f9127加三条期望修改的工作副本复核：仍为独立assert.equal固定SHA，无动态期望、任意SHA或权限/触发/凭据断言弱化；132/132实际通过，workflow无额外diff，结论P1 ADDRESSED、无新P0–P3。最终实际main重放及新head托管门仍待执行；初始REQUEST_CHANGES不由工作区绿直接消除。

## 最终主线重放范围

2026-11-02 SGT：在实际main `9880d7e97d8c19335f56febbfd041242b3ed2961` 上重放；原升级10处调用及三个精确期望保留，并将#504新增Browser lane的同action调用点同步同一官方对象，合计11处。不改其它action、Node目标、包管理器、缓存、触发或权限。后续完整verify/browser和新head平台证据独立取证，未沿用历史红/绿。

## 最终主线的技术接受与归档

2026-11-02 SGT，代码源 `3b5273ea12852870d8b32e3a0d9e5845c3f3cf5f` / base `9880d7e97d8c19335f56febbfd041242b3ed2961`：直接声明pnpm10正常frozen安装、完整verify3385+7、Browser7/7、W1–W7 8文件0findings，均无fail/skip。独立复评精确3/3及通用119/119，P1 ADDRESSED、无新P0–P3；所有11真实调用点一致，其余workflow逐字未改。普通PR CI41457542573及MergeGate41457542140同源success；hosted Browser实际新pin且7/7、0skip。作者回复4443302082并resolve原线程，Bot issue关联豁免保留。

精确lease前置核验曾发现Bot刷新58e5611；已保存该源，并确认本候选完整保留其所有workflow，差异仅三条精确期望和计划/评审。当前将计划归档到 `docs/exec-plan/completed/2026-11-02-setup-node-v7-contracts.md` 并补索引，随后新head仍独立复核/真实CI，不把上述固定源证据伪写成最终head已经通过。
