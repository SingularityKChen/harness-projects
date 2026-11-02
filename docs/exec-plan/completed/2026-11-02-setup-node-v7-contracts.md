# setup-node v7 精确契约同步 ExecPlan

> 状态：Completed（技术验收、源CI与线程修复完成；归档后的最终head仍须当前CI及正式批准回读）；创建：2026-11-02（Asia/Singapore）
> 范围：修复 PR #400 的三条安全接线契约，最终 main 重放和发布由协调者执行。
> 规范：根 `PLANS.md`；诊断及正式评审：`docs/review/pr-400-mmp-review.md`、GitHub review `5736794478`。

## Purpose / Big Picture

维护者能继续升级到独立核实的 setup-node v7.1.0，同时三条特权 workflow 契约仍拒绝旧版本和未批准的 action 对象。最小成功证据是原三条 SHA 失配从确定的 RED 变为精确契约 GREEN，并由真实 workflow pin 负控证明没有放宽比较。局部成功不替代最终新 head 的必需 CI。

## Context and Orientation

PR #400 的既有提交为 `d35f9127de0e874f16144a6b5e375147f890ea71`，历史父提交 `8b7429778c3a2bf322744ca32c1d07b32fb8c1f5`。前序诊断时 main 为 `09eb366c0c7541f7cac40b3e71123e5dfe49579e`，五份 workflow 与历史父提交相同；此值是观察记录，不是后续重放基准。官方 v7.1.0 tag 和完整 SHA `949feb2413d6458794dcd2491c4babbbce0c15c1` 已独立核实。原托管 action、安装、typecheck 成功，测试阶段才因三条旧期望失败。

在检出 `chore/setup-node-v7` 的 `.worktrees/setup-node-v7` 执行。原三份具名契约已观察 132 tests/129 pass/3 fail 的正确 RED，失败值仅为实际新 SHA 与期望旧 SHA；无需再造镜像测试。协调者正串行合入其它 PR，本实现者不接管 main、提交、重放、推送或远端回复。

## Design / Spec

只将三个批准对象的字面期望改成官方新 SHA，保留 `assert.equal` 和所有触发、默认分支、权限及 PAT 步骤断言。放弃“任意 40 位 SHA 都通过”的正则和从 YAML 动态生成期望，二者都会消除独立批准对象。没有证据要求更新 Node、pnpm、缓存或认证配置，也不新增公共工具抽象。

负控直接临时改真实 workflow 的三个被测 pin，每处分别换成旧 SHA 和未批准的 40 位 SHA；批准期望保持不变。必须由 `scripts/review-mutate.mjs` 逐个施加和逐字还原，以对应具名用例的 `killedBy` 归因。该临时写入范围已由协调者明确授权，不能扩大为永久 workflow 修改。

## Global Constraints

本子实施者的禁止Git/远端写入约束保持；接管协调者按Batch 3处理暂存、实际main重放、提交整合、精确lease、作者回复/线程resolve与rebase merge。最终文档归档及共享索引由协调者修改；如果实际新main增加同一setup-node调用点，仅将该调用点同步到同一官方pin，不改变lane、权限或触发。

最终完整写集为 `.github/workflows/board-invariants.yml`、`.github/workflows/ci.yml`、`.github/workflows/engineering-state.yml`、`.github/workflows/merge-gate.yml`、`.github/workflows/rule-checks.yml`、`tests/contract/check-board-workflows-live.test.js`、`tests/contract/engineering-drift.test.js`、`tests/contract/engineering-state.test.js`、本计划（完成后移动到completed）、`docs/review/pr-400-mmp-review.md`与归档索引`docs/README.md`。临时变异只允许 `.github/workflows/board-invariants.yml` 与 `.github/workflows/engineering-state.yml` 的上述三个 pin，经夹具恢复；运行态 spec 位于已忽略的 `.superpowers/setup-node-v7/`。共享 `docs/README.md` 由协调者统一维护。

不得改变其它工具、package/lock、权限、凭据可见面、触发器、规划字段或聚合规则。没有 Git mutation、commit/rebase/push 或远端回复。PR 按实际直接 base 保持代码 <800、文档 <1300；发布面不写本机路径、身份或内部信息。完整 verify/browser 和 hosted CI 留到协调者重放最终实际 main 后执行，本轮不提前声称最终交付或归档。

## Plan of Work

### Batch 1 · 最小 GREEN

主文件为三份安全契约。以已经核实的 RED 为起点，每份只替换唯一旧 SHA 期望，确认权限等其余断言保持。运行：

    node --test --test-timeout=120000 tests/contract/check-board-workflows-live.test.js tests/contract/engineering-drift.test.js tests/contract/engineering-state.test.js
    node scripts/workflow-check.mjs

期望三份契约 132/132、0 skip/todo，通用检查 8 文件、0 findings。回滚只反向替换本批三个字面值，保留评审记录并恢复原 RED，不用恢复整份测试抹去他人改动。

### Batch 2 · 真实配置负控与局部验收

主执行入口为 `scripts/review-mutate.mjs`，不修改夹具本身。生成 `.superpowers/setup-node-v7/pin-mutants.json`，其 `command` 为 Batch 1 的三文件 node argv。六项依次为 board-workflows、engineering-field、sync 的旧 pin / 未批准 pin；旧 SHA 为 `49933ea5288caeca8642d1e84afbd3f7d6820020`，未批准值为 `1111111111111111111111111111111111111111`。board 两处 anchor 连同后继具名步骤确保各出现一次，sync 使用唯一 setup-node 行。`killedBy` 依次为“带 PAT 的 workflow 只有 schedule 入口”“漂移 job 挂在 Board invariants 上”“特权 reconcile 只由默认分支 workflow 运行”。

    node scripts/review-mutate.mjs .superpowers/setup-node-v7/pin-mutants.json

期望全部六项 KILLED，零 KILLED_OTHER/NOT_APPLIED/SURVIVED，夹具前后基线绿。然后从有完整依赖的仓库根 cwd 执行下列命令，期望 119/119；这是规避已诊断的 worktree 缺独立 node_modules 夹具环境，不改变候选源码。

    node --test --test-timeout=120000 .worktrees/setup-node-v7/tests/contract/workflow-check.test.js .worktrees/setup-node-v7/tests/contract/merge-gate-workflow.test.js .worktrees/setup-node-v7/tests/contract/rule-checks.test.js

更新本计划和评审 addendum，交给另一独立评审者。回滚由夹具逐字还原；失败或中断先确认工作流相对 HEAD 无差异再继续。

### Batch 3 · 协调者最终基准与发布

涉及本计划的完成归档及共享索引，由协调者串行执行。建立恢复锚点、重放到现场最新 main、独立复评；在正常安装的最终 worktree 执行 `pnpm verify`、实际 browser、W1–W7、disclosure/size/diff-check 后整理提交与精确 lease 发布。最终回读命令：

    gh pr view 400 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,state,reviews,closingIssuesReferences
    gh pr checks 400 -R SingularityKChen/harness-projects

期望 head/base 等于最终候选、Verify 与必需 Fast Gate 成功，全部 threads 和 Bot 关联豁免已核对；旧红、旧绿不能沿用。只有这些门齐全才关闭计划并更新索引，回滚应一并还原 action pin 与精确期望。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| 修复根因且不降强度 | 三个精确字面值最小 diff，三文件 132/132 |
| 旧/任意 pin 仍被拒绝 | 六个真实 workflow pin 变异全部具名 KILLED，完整还原 |
| 其它 CI 边界 | 通用 CI 契约 119/119，W1–W7 8 文件无 findings |
| 最终交付 | 独立复评、最终 main 重放、verify/browser、新 head hosted checks、threads 与发布面回读 |

## Progress

- [x] (2026-11-02 20:53 +08) 承接正式 REQUEST_CHANGES，读根 PLANS 和修复技能，复用前序 132/3 RED。
- [x] (2026-11-02 21:01 +08) Batch 1：三条精确期望同步，132/132 GREEN，W1–W7 无 findings。
- [x] (2026-11-02 21:01 +08) Batch 2 本地部分：六项真实 pin 负控全部具名 KILLED，逐字还原后 132/132，通用 CI 契约 119/119。
- [x] (2026-11-02 SGT) Batch 2 外部门：另一独立评审者确认P1 ADDRESSED、无新增P0–P3，亲跑132/132且workflow完整还原。
- [x] (2026-11-02 SGT) Batch 3：在实际main9880d7e完成重放，正常pnpm10安装、3385+7完整verify、Browser7、W1–W7及源3b5273e普通PR CI/Merge Gate通过，原P1作者回复/resolve，技术归档及索引完成。归档后的新head仍按下文发布门重新回读。

## Surprises & Discoveries

原诊断中额外 CLI 夹具失败来自本 worktree 缺独立 node_modules，普通 ESM 向上找到依赖而复制脚本的软链目标不存在；保持候选文件不变、仅使用有完整依赖的仓库根 cwd 后通用 CI 契约 119/119。它不是 setup-node 行为缺陷，不在本层顺带修工具链。

## Decision Log

Decision：在实际最终主线 `9880d7e97d8c19335f56febbfd041242b3ed2961` 重放升级，并把#504新增Browser lane的同一setup-node调用点同步到已批准官方pin。Rationale：升级须覆盖当前全部11处真实调用；只增改同一action版本，不改变lane/触发/权限/缓存/Node目标。Date/Author：2026-11-02 SGT / 接管协调者。

Decision：人类在本会话直接要求“请你接手所有 PR 的 review和 rebase merge。相关 PR 均已经 approval。请你按照审批流程继续”。Rationale：本PR初始尚无批准且有明确P1，由本会话作为唯一owner完成必要最小修复、独立复评、新head CI和rebase merge；不会把概括批准当作跳过实际门禁。Date/Author：2026-11-02 SGT / 接管协调者。

Decision：复用已观察的 RED，只同步批准 SHA。Rationale：问题是安全契约的批准对象漂移，不是比较函数或产品行为失效。Date/Author：2026-11-02 20:53 +08 / 本层实现者。

Decision：由同一真实 YAML 负控检验 pin 边界，并由协调者在最终 base 执行全量门。Rationale：验证实际配置故障，同时避免重做将被串行重放的旧基准全量检查。授权覆盖三条期望、计划/评审及六项临时 pin 变异，不授权本实现者远端写入。Date/Author：2026-11-02 20:53 +08 / 协调者与本层实现者。

## Idempotence and Recovery

三条期望只出现一次，替换前校验旧值计数；重复执行应先检查已经是新值，不能模糊全仓替换。变异夹具按原字节备份、每项恢复并复验，异常时先确认两份 workflow 相对 HEAD 无 diff，再跑三文件基线。不得用 checkout/reset 覆盖工作树。最终重放和精确 lease 由协调者持恢复引用执行。

## Interfaces and Dependencies

依赖 Node、已有 yaml 安装、GitHub CLI 只读认证和官方固定 action 对象；不新增依赖。命名契约是特权接线的固定 action SHA，以及保持原有 scope/权限/凭据隔离。独立修复评审和最终 hosted Actions 是后续外部门，不能由本地测试代替。

## Outcomes & Retrospective

2026-11-02 21:01 +08，在原 head `d35f9127de0e874f16144a6b5e375147f890ea71` 加三条测试工作区修改的检出上，三文件 132/132、通用 CI 契约 119/119、W1–W7 8 文件无 findings；六项真实配置旧/未批准 pin 均由指定用例杀死。夹具前后基线绿，两份 workflow SHA-256 与变异前一致，且 workflow 相对 HEAD 无 diff；恢复后三文件再跑 132/132。持久测试 diff 仅 3 行新增/3 行删除。

独立修复复评、最终 main 重放、完整 verify/browser 和新 head hosted checks 未执行；本计划保持 Active。上述门属于明确后续批次，不记为已完成或隐性技术债；本最小修复没有新增技术债。 Superseded by 本节“2026-11-02 · 最终主线源验收及归档”（2026-11-02）。


2026-11-02 SGT修复独立复评：三条固定字面值和安全断言完整，亲跑132/132，P1 ADDRESSED、无新增P0–P3。上文“独立修复复评未执行”的本地交接状态 Superseded by 本段；最终main/完整验证/hosted门仍待执行。


实际重放base `9880d7e97d8c19335f56febbfd041242b3ed2961`（2026-11-02 SGT）。原action升级五文件在该base干净重放，三条安全期望保持；#504新增的一处Browser调用点从旧pin同步同一新pin。所有11处真实workflow调用均使用官方固定SHA；测试仍精确比较。完整本地与新head hosted尚待执行，Active状态保留。


### 2026-11-02 · 最终主线源验收及归档

实际代码源 `3b5273ea12852870d8b32e3a0d9e5845c3f3cf5f`、实际直接base `9880d7e97d8c19335f56febbfd041242b3ed2961`。直接shell确认pnpm10.28.2并执行 `CI=true pnpm install --frozen-lockfile` exit0；`CI=true pnpm verify` typecheck+3385/3385主测试+7/7 MVP0；`CI=true pnpm test:browser` 7/7；`node scripts/workflow-check.mjs` 8文件0findings。全部测试无fail/cancel/skip/todo，正常安装未改manifest或lock。独立新base复评确认P1 ADDRESSED、无新增P0–P3，亲跑精确契约3/3及通用CI119/119；旧六负控保持原源执行归属。

同源普通PR的CI `41457542573`、Merge Gate `41457542140` completed/success；Browser日志实际setup-node949feb2、7/7及0skip，commit checks同SHA回读。原评审唯一P1已由作者回复 `4443302082` 并resolve。此前Dependabot后台刷新为 `58e56110a5f55e5bfdc1ad03e825cbe42a540212` 被精确lease前置检查拦截；该版本已建立恢复引用，其所有workflow与本候选逐字相同，接入修复时未丢弃其新调用点或其它改动。

本归档只接受已完成的技术范围和上述固定源证据；随后只移动计划/更新索引与证据文档，产品/测试/workflow blob必须与该源相同。归档后的具体新head仍要重新独立复评、普通PR CI/Browser/Fast Gate、全部线程、Bot issue关联豁免及实际main回读后，才执行人类已授权的rebase merge。上述源绿色不冒称为未来新head绿色；人类产品/UAT/R1继续独立。

## Bottom Change Note

2026-11-02 20:53 +08：依据已授权的唯一 P1 最小修复建立 13 节活计划，明确三条持久修改、真实配置临时变异和最终基准验证分工。

2026-11-02 21:01 +08：记录最小 GREEN、六项真实配置负控的具名归因和逐字还原；保留独立复评及最终基准完整验证门。

2026-11-02 SGT：按人类全部PR接管授权记录独立修复接受、协调者边界和最终新main调用点核对；本计划仍Active，未预写完整交付成功。

2026-11-02 SGT：在六层实际合入后的最终main重放，纳入新Browser lane的同action调用点；准备同一闭环的单提交，不扩大其它工具/权限/产品范围。

2026-11-02 SGT：记录最终实际主线上的正常依赖安装、完整验证、真实同SHA托管门、独立接受及作者线程闭合；技术归档并保留最终归档head重新取证，不提前声明合并或R1。
