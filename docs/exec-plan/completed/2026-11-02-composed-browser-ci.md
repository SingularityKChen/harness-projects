# 生产组合浏览器 CI 准入 ExecPlan

> 状态：Completed（实现与证据验收）；创建：2026-11-02（Asia/Singapore）
> 范围：仅把已验收的browser本地能力接入CI；规则PR后置于#498能力层，完整证据后关联#450。
> 规范：`PLANS.md`。本计划同时承载最终 spec 与实施批次；每批更新活章节。

## Purpose / Big Picture

每次正常CI都会实际执行生产组合Chromium suite，浏览器失败/取消/跳过使稳定 `PR Fast Gate` 聚合失败，空suite不能变绿。维护者无需在本机偶然运行才发现browser回归。只改变规则控制面，不在此修browser用例或产品行为。它消费#498能力层，全部原AC和两层当前证据齐备后方可用Closes #450；#236/#459/#143/#449不关闭。

## Context and Orientation

本计划初始保存在临时交接位置，能力层最终head尚未产生，因此不提前建CI工作树或假定base。协调者在#498本地能力独立验收/最终提交后，从其**确切最终head**新建 `.worktrees/composed-browser-ci`、分支 `test/composed-browser-ci`，把本计划复制到 `docs/exec-plan/active/2026-11-02-composed-browser-ci.md` 并记录 `git rev-parse HEAD` 对象，再创建Draft才实施。#498本地能力分支为 `test/composed-workspace-browser`，它依赖冻结#472；CI只向能力层stack，不直接从main重新实现载体。 **Superseded by 本节并行执行裁决（2026-11-02）**：浏览器独立验收暴露启动期资源清理反例，修复与规则写集无交叉。命令与文件契约已稳定，当前先从已提交能力检查点 `d10af23e59d741a521877b8205db1074890c4af6` 建上述独立工作树和 Draft，再并行实施规则；该对象只作本次临时直接 base，不是最终已验收能力。协调者在能力修复、独立复评和最终提交后，建立恢复引用，把本层独有提交重放到其最终 head，并重取本地与真实 hosted 证据；此前保持 Draft。该策略不修改 #498 的验收或扩大 CI 写集。

2026-11-02 +08重放观察：能力PR #503完成生命周期修复与独立复评后，协调者以最终父提交 `5f50b0da6ceedacc5b1c88b4afa7241da7f2c201` 替代临时base，并在保留恢复引用后只重放本层两条提交。重放后的规则检出为 `04320a2fefdc6f3c7278fe98718dab791301049a`；`git range-diff` 两条均为 `=`，四个owning文件blob与旧规则头逐一相同。该观察是本轮本地重验基准；发布前仍由协调者按Batch 3回读实际远端base/head。

`package.json` 的 `test:browser` 固定调用 `scripts/run-test-layer.mjs tests/browser "生产组合浏览器读取与恢复"`；能力层选择 exact dev-only playwright library、匹配Chromium、Node `*.test.js` suite和失败截图/trace目录。空文件、tests-skipped-todo=0、摘要解析失败、binary缺失均非零。普通pnpm test不包含此层。

实施前 `.github/workflows/ci.yml` 的verify执行typecheck/test，fast-gate只needs verify且不checkout、不读secrets；本层增加独立browser和聚合依赖。`merge-gate.yml`四lane独立且advisory。`docs/review/README.md` §6明确workflow改动必须单独规则PR，因此此层与carrier/tests分开；不是为了LOC。

## Design / Spec

选既有CI新增 `browser` job并把它加入 `fast-gate.needs`，保留唯一required check名与聚合安全姿态。放弃独立advisory workflow或Merge Gate第五lane：它们能提供regular证据但不让现有必需聚合覆盖browser，还增加新workflow/重复执行维护面。此选择不修改分支保护设置、既有CI的main branch filter或Merge Gate四lane。

browser job使用普通pull_request执行PR代码、hosted runner、只读contents权限、pinned action完整SHA、checkout persist-credentials false，显式timeout 10分钟。复用现有pnpm/node版本来源，先 `pnpm install --frozen-lockfile`，再 `pnpm exec playwright install --with-deps chromium`，最后 `pnpm test:browser`。安装下载是工具准备，不是suite业务外网。测试命令不另加grep/skip/retry掩盖失败。失败截图/trace通过pinned `actions/upload-artifact`上传，仅匹配生成目录的PNG/ZIP、保留七天、排除隐藏文件；无产物时ignore，上传不使用continue-on-error，不会吞掉原测试失败。

fast-gate needs精确包含verify/browser，保留 `if: !cancelled()` 与failure/cancelled/skipped拒绝；自身无checkout、secrets或执行PR代码。执行lane不能continue-on-error/条件静音。main push运行不因后续push被取消。实际native stack事件必须在本head回读，不能从main已有过滤推断一定运行。

新 `tests/contract/ci-browser-workflow.test.js` 把lane集合/命令/安装顺序/needs/no-secret聚合和失败状态作为规则契约；未知jobs形状或命令缺失fail closed。已有workflow-check W1–W7覆盖通用安全；没有新规则就不形式化修改脚本。CI文档解释新增反馈、运行成本、普通Node测试与browser不同角色，人类UAT未被替代。

## Global Constraints

所有产品身份、权限、原子性、owner 围栏、持久意图、Provider 确认、unknown/conflict 和恢复语义保持。没有正式发布，不增加实验 API/旧数据库兼容层、双写或静默迁移；旧库拒绝与备份保留。Host 是业务权威，规划状态与工程事实正交。agent 不合并 PR、不改 Project Status 或 native blocked-by/blocking，不调用真实模型或执行真实 GitHub 业务写入。

每个 PR 对其**直接 base**计算增删总和：代码、测试、配置、fixture 严格少于 800 行，文档严格少于 1300 行；锁文件按仓库政策排除但仍审查。仓库 size 脚本的 1000/1500 上限不足以证明本轮要求。新发现的产品缺陷单列证据交所属 owner，不能通过减弱测试、权限或事实边界满足行数。发布面不得含凭据、本机绝对路径、访问型会话 URL 或内部系统资料。

唯一写集：`.github/workflows/ci.yml`、`tests/contract/ci-browser-workflow.test.js`、必要时 `scripts/workflow-check.mjs` 与对应规则契约、`docs/development/ci.md`、正式迁入后的本计划和必要评审记录。不得改browser suite/fixture、package依赖/脚本、产品源码、package-boundaries矩阵、Merge Gate或分支保护设置。共享docs索引由协调者串行。代码目标110–230、文档200–400行；均对能力层最终head计算，不能累计stack。

## Plan of Work

### Batch 1 · 冻结能力契约与规则 RED

协调者完成前述worktree/计划迁入，先提交计划并创建Draft，回读head/base/draft/Refs450后实施。记录能力层最终base对象及其独立验收，不从旧head抄结果。运行 `pnpm install --frozen-lockfile`、`pnpm exec playwright install --with-deps chromium` 和 `pnpm test:browser`；期望能力层原命令完整非空通过，缺口交能力owner，不在规则层修测试。

先写ci-browser-workflow契约：当前没有browser job/needs应因具体缺接线RED，不因解析/导入错误RED。该契约读取真实CI YAML并验证恰好verify/browser/fast-gate三job、browser固定命令/准备顺序/超时、fast-gate needs和安全姿态。

### Batch 2 · 接线与本地验证

主文件是ci.yml及CI文档。加入browser执行lane与聚合依赖，按最小规则变化复绿。运行 `pnpm test:file tests/contract/ci-browser-workflow.test.js tests/contract/workflow-check.test.js tests/contract/merge-gate-workflow.test.js`、`node scripts/workflow-check.mjs`、`pnpm verify`；期望契约、W1–W7与完整现有回归均通过，原Merge Gate不变化。

隔离副本作三类负控：从needs删除browser→契约红；将browser job/步骤设skip或continue-on-error→契约红；空目标/全skip→能力层runner非零。另在可审查的临时测试ref仅给 `pnpm test:browser` 步骤添加 `env: { PLAYWRIGHT_BROWSERS_PATH: .superpowers/missing-browser-negative-control }`，安装步骤不改。该env保留固定命令和Verify契约，但使实际浏览器用例找不到binary而非零；确认Verify绿、browser红且PR Fast Gate红，再恢复正式head且本地差异清空，最终head重跑通过；不提交debug/fixup或让临时故障残留。若不能获得真实hosted负控，记录未验证并保留本层Draft，不能用本地聚合模拟冒称平台证据。

### Batch 3 · 当前远端验收与Ready

最终提交前整理本层commits；已推历史按backup ref+精确lease，由协调者执行。直接base是Batch1记录的能力层最终head，执行 `node scripts/rule-checks.mjs disclosure`、`node scripts/rule-checks.mjs size` 与 `git diff --check` 时显式传该具体SHA；用 `git diff --numstat` 对同对象增删相加，代码<800/文档<1300，记录实际数值。基础层若更新则协调者保留锚点、重基此层，全部受影响规则和hosted证据按新head重取。

执行以下只读基线回读与机械检查，使用当前PR直接base对象且验证本检出就是最终远端head；期望全部退出0并打印严格规模：

    python3 - <<'PYCI'
    import json, subprocess
    run = lambda args: subprocess.check_output(args, text=True).strip()
    pr = json.loads(run(['gh', 'pr', 'view', 'test/composed-browser-ci', '-R', 'SingularityKChen/harness-projects', '--json', 'baseRefOid,headRefOid']))
    assert run(['git', 'rev-parse', 'HEAD']) == pr['headRefOid']
    base = pr['baseRefOid']
    for kind in ['disclosure', 'size']:
        subprocess.run(['node', 'scripts/rule-checks.mjs', kind, base], check=True)
    subprocess.run(['git', 'diff', '--check', base + '...HEAD'], check=True)
    code = docs = 0
    for line in run(['git', 'diff', '--numstat', base + '...HEAD']).splitlines():
        add, delete, name = line.split('\t', 2)
        assert add != '-' and delete != '-'
        if name == 'pnpm-lock.yaml':
            continue
        changed = int(add) + int(delete)
        if name.endswith('.md'):
            docs += changed
        else:
            code += changed
    print({'directBase': base, 'code': code, 'docs': docs})
    assert code < 800 and docs < 1300
    PYCI

回读 `gh pr view test/composed-browser-ci -R SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup,mergeStateStatus`，以及 `gh pr checks test/composed-browser-ci -R SingularityKChen/harness-projects`。期望browser和PR Fast Gate确实出现、目标head一致且pass；不能采信缺lane/旧head/skip。分页回读所有review threads并处理未决。原#450全部AC在能力/规则两层均有证据后才Closes450并Ready，否则Refs450且保留Draft。

回滚先revert此规则层，仍可本地调用browser；之后若要撤能力层另行revert，不能先删命令让规则指向空集。回滚不影响产品数据、远端业务对象或父栈修复。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| 正常regular lane | 当前远端head实际browser执行非空/无skip，安装与执行耗时在timeout内 |
| 必需聚合覆盖 | needs契约、真实hosted非零负控browser红且Fast Gate红，恢复后最终head绿 |
| 安全姿态 | W1–W7、pull_request只读执行、pinned action、关闭凭据、no-secret/no-checkout聚合 |
| 分层独立 | 无carrier/suite/package行为diff；规则可单独回滚，本地能力仍可用 |
| 原450闭环 | 全部能力AC+规则AC证据齐全，严格直接base规模/发布面，才最终Closes450/Ready |

## Progress

- [x] (2026-11-02 16:18 +08) 第三独立agent综合A/B并裁决严格规则隔离，形成此后置最终计划。
- [x] (2026-11-02 +08) 按并行裁决先从稳定命令契约检查点迁入计划并建独立工作树，协调者创建Draft #504。
- [x] (2026-11-02 +08) Batch 1：临时能力检查点的安装/浏览器入口通过，规则RED为缺browser job/needs/产物的4失败与既有聚合1通过；该检查点证据不作为最终验收。
- [x] (2026-11-02 +08) Batch 2本地部分：接线、73条相关契约、W1–W7、完整verify、七个规则mutants和空层/全skip负控通过，见Validation证据。
- [x] (2026-11-02 +08) 能力最终父基准重放后的73条规则契约、W1–W7、7条browser、完整verify与本地缺binary负控重验，结果见Outcomes。
- [x] (2026-11-02 +08) Batch 2平台负控：正式头先取得正控，隔离实验ref再证明Verify绿、7条browser实际失败与Fast Gate红；精确head/run和顺序见Outcomes。
- [x] (2026-11-02 +08) 独立平台复评确认当前候选正负控及父基准证据有效；后置最终head的CI/Merge Gate属于Batch 3出版回读门，按下列可执行命令取证，不从旧run推断。
- [x] (2026-11-02 +08) Batch 3交付材料：恢复引用、归档/索引、单闭环提交和最终head回读程序齐备；Ready的瞬时值由GitHub权威接口回读，不静态复制为产品或发布验收。

## Surprises & Discoveries

三PR初步范围遗漏了review §6明确规则隔离；A的严读优先于B的“整条test/CI可视为一闭环”备选。拆分后每层仍可独立验收/回滚，测试层不是空lane，规则层不重复造测试。已有CI有main base filter，native stack真实运行必须观察而非假定。

临时把 `pnpm test:browser` 命令改成exit会同时破坏固定入口契约，使Verify红，不能单独证明browser依赖。隔离副本实测：仅test步骤添加缺失binary路径env时，五条专用契约保持通过；实际suite负控留待最终生命周期修复后取证，避免在已知启动清理缺陷的旧检查点重复制造泄漏。

上述suite负控待取证状态 **Superseded by Outcomes最终父基准重验与hosted证据（2026-11-02）**：缺binary路径已在修复后的父提交上实测，7条用例实际失败、自然非零退出，无挂起；随后真实hosted负控也证明失败传播，负控后新最终正式head的恢复绿仍未完成。

## Decision Log

- 2026-11-02 SGT：接到已合入#503的实际main，唯一README索引冲突保留当前main全部记录并新增本层；CI YAML与专用规则契约自动合并，实际新组合须重新验证本地与hosted的Verify/Browser/Fast Gate。

- 2026-11-02 SGT · 全部开放PR接管：本会话人类原话：“请你接手所有 PR 的 review和 rebase merge。相关 PR 均已经 approval。请你按照审批流程继续”。本授权明确覆盖当前PR #504，由本评审会话接管修复/独立复评、实际base重放、当前head门禁、issue核对及rebase merge。旧阶段“不merge/仅Ready”的限制仅在合并授权上 Superseded by 本决策；技术、范围、预算、凭据与人类UAT/R1门保持。Planning Status及native依赖关系仍不写入。

- 2026-11-02：本会话用户直接对 #501–#504 条件授权无P0/P1时由评审会话完成独立复评、归档、提交整理和issue核对后rebase合并；不授权其它PR合并或Planning字段写入。本项虽无新增阻塞，必要上游 #472 的Draft及既有阻塞仍由其owner闭合，不能越过。

Decision：选择既有CI browser job→PR Fast Gate needs，保留Merge Gate与保护设置。Rationale：复用稳定required状态且不新增advisory重复workflow，聚合仍不执行PR代码。Date/Author：2026-11-02 16:18 +08 / 独立spec修订者。

Decision：本计划先作为完整临时交接，等能力层最终head才建后继worktree。Rationale：先固定本地命令/非空/产物协议，减少不必要共享历史重写；没有假base或空suite接线。Date/Author：2026-11-02 16:18 +08 / 独立spec修订者。

Decision：在生命周期修复期间并行推进规则层，替代等候能力最终提交才建工作树的协调偏好。Rationale：两层文件/接口无冲突，单独规则可先验收；以恢复引用、最终重放和重新取证承担一次有界历史整理成本，不降低任何能力或CI门禁。Date/Author：2026-11-02 +08 / 协调者。

Decision：复用W1–W7，不修改通用规则脚本；专用契约只守lane/命令顺序、聚合依赖/失败闭合及受限产物。Rationale：当前通用规则已覆盖新job的安全姿态，无新增通用判据；失败产物action固定到官方tag对象 `cf430e030ddbb5b0abf93d22962f4752f3646cd9`（v7.0.2），只读GET官方tag与该对象action.yml确认。Date/Author：2026-11-02 +08 / CI实施者。

## Idempotence and Recovery

依赖和browser安装按lock重复，suite每例临时隔离。规则失败由具体契约指出，未知形状fail closed。临时hosted负控只在协调者授权的测试ref，保留审计记录、恢复后最终head重新验证，不遗留debug提交。仅本规则层可独立revert；不能删除测试或降低超时/跳过来获得绿。新增运行成本/稳定性债务若确需延迟记录tech-debt-tracker，不能默默延期必需负控。

负控实验ref `test/composed-browser-ci-negative-20261102` 仅用于取证，不用于合并；正式分支未注入缺binary env。协调者在独立平台复评和最终正式head取证后，核对远端仍等于负控head，再以精确lease删除自己创建的该实验ref；保留本地恢复引用 `refs/backup/iteration9/ci-negative-control-ccf85de4b307`，不清理用户或其他人的分支。

## Interfaces and Dependencies

真正依赖#498最终提交的test:browser、精确playwright版本/Chromium与非空Node summary协议；#498又依赖#472，本层不重写父层。hosted Actions可运行普通PR workflow是外部可用性前置；检查缺席/失败不是通过。发布面与Ready外部写入只有协调者执行；不授权merge、Status或native依赖变化。

## Outcomes & Retrospective

在检出 `test/composed-browser-ci` 的 `.worktrees/composed-browser-ci` 根目录、临时直接base `d10af23e59d741a521877b8205db1074890c4af6` 上的本地证据（2026-11-02 +08）：

- `pnpm exec playwright install --with-deps chromium`：exit 0；`pnpm test:browser`：6执行/6通过、0skip，约7.7秒。该计数只描述此检查点，不锁死未来生命周期组数量，不是hosted成本。
- 先执行 `pnpm test:file tests/contract/ci-browser-workflow.test.js`：exit 1，缺browser/needs/产物接线导致4失败，既有聚合结果测试1通过；实现后同文件与 `tests/contract/workflow-check.test.js`、`tests/contract/merge-gate-workflow.test.js` 一起执行：73/73通过。
- `node scripts/workflow-check.mjs`：8文件、0 findings；`pnpm verify`：typecheck、2882条contract/integration/e2e、7条MVP-0全部通过，0skip。
- 隔离临时副本运行同一专用契约：移除browser need、job/step skip、job/step continue-on-error、安装/执行倒序、聚合遗漏skipped，共七个mutant均exit 1；仅test步骤的缺binary env保持exit 0。直接运行 `scripts/run-test-layer.mjs` 的空层、全skip层均exit 1。

最终父基准重验证据（2026-11-02 +08）：在同一工作树检出 `04320a2fefdc6f3c7278fe98718dab791301049a`、直接base `5f50b0da6ceedacc5b1c88b4afa7241da7f2c201` 运行：

- `pnpm test:file tests/contract/ci-browser-workflow.test.js tests/contract/workflow-check.test.js tests/contract/merge-gate-workflow.test.js`：73/73通过；`node scripts/workflow-check.mjs`：8文件、0 findings。
- `pnpm test:browser`：7执行/7通过，0skip，约9.6秒；`pnpm verify`：typecheck、2882条contract/integration/e2e、7条MVP-0全部通过，0skip。
- `PLAYWRIGHT_BROWSERS_PATH=.superpowers/missing-browser-negative-control pnpm test:browser`：7执行/7失败、0skip，均为缺少Chromium binary；Node报告约2.3秒后命令自然exit 1，无挂起。随后不带该env重跑 `pnpm test:browser`：7/7通过、0skip，约7.8秒。这是本地负控与恢复证据，不能代替hosted Browser/Fast Gate回读。

真实hosted证据（2026-11-02 +08，直接base仍为 `5f50b0da6ceedacc5b1c88b4afa7241da7f2c201`）：

| 顺序与目标 | Dispatch审计与结果 |
|---|---|
| 先：正式ref `test/composed-browser-ci`，head `3a4c552611dda37d7471ea2cb81a41f16689422e` | actor与triggering_actor均为 `SingularityKChen`，目标 `SingularityKChen/harness-projects` 的 `ci.yml`，dispatch ack后run `41423336481` 回读为workflow_dispatch/completed/success；Verify、Browser、PR Fast Gate均success，browser 7执行/7pass/0fail/0skip/0todo，10.62秒。相同head的 `merge-gate.yml` run `41423342053` 为workflow_dispatch/completed/success，四条lane与聚合均success。 |
| 后：实验ref `test/composed-browser-ci-negative-20261102`，head `ccf85de4b3077e08634bdb84da89645b36615574` | 父为上述正式head，仅test步骤新增缺binary env两行；actor与triggering_actor均为 `SingularityKChen`，目标同仓 `ci.yml`，dispatch ack后run `41424052263` 回读为workflow_dispatch/completed/failure。Verify success，Chromium安装success，随后test步骤7执行/7fail/0skip/0cancel/0todo、Executable doesn't exist，约1.393秒自然非零退出；Browser failure、PR Fast Gate failure，聚合日志为 `Needed job results: success, failure`。产物步骤success没有改变原失败；launch前失败不保证产生截图。 |

在任意目录可只读复核：

    gh run view 41423336481 -R SingularityKChen/harness-projects --json headSha,event,status,conclusion,jobs
    gh run view 41423342053 -R SingularityKChen/harness-projects --json headSha,event,status,conclusion,jobs
    gh run view 41424052263 -R SingularityKChen/harness-projects --json headSha,event,status,conclusion,jobs
    gh run view 41424052263 -R SingularityKChen/harness-projects --job 125206242840 --log
    gh run view 41424052263 -R SingularityKChen/harness-projects --job 125206973635 --log

上述日志在正式检查点 `3a4c552611dda37d7471ea2cb81a41f16689422e` 上采集，正控先于负控，不能用它们推断负控后最终整理head已绿。独立平台复评已逐项核实代码、head、run与因果链并通过；协调者据此归档实现和证据材料。最终整理提交的CI/Merge Gate、head/base、关联和threads必须在发布后按Batch 3命令回读，Ready由该机械结果执行；这些瞬时事实以GitHub为唯一权威，不在计划静态复制。实施者仅更新计划和只读核对run，公开写入由协调者执行。CI绿仍不完成任何人类产品或发布验收。


### 2026-11-02 · MMP 独立评审与依赖门

完整P0–P3矩阵、实际测试、变异归因、反例与已有issue边界见 `docs/review/pr-504-mmp-review.md`。独立评审未发现本层可归因的P0/P1/P2/P3；原产品/测试/配置blob保持，只并入评审与收尾记录。#472仍由另一会话处理其阻塞，故本层批准不代表整栈或main已可合入。#143/#449及R1保持人类门。

当前head/base/CI和关联必须在最终push后回读：在本分支根运行 `gh pr view 504 -R SingularityKChen/harness-projects --json state,headRefOid,baseRefName,baseRefOid,reviews,closingIssuesReferences`、`gh pr checks 504 -R SingularityKChen/harness-projects`，另回读全部review threads和同SHA的commit check-runs。非main普通PR未投影的检查不能由dispatch冒称自动触发证据。上游完成后必须在实际新base重放、完整复评并取得新head门禁，再按已授权rebase收尾。恢复引用 `refs/backup/pr504-before-mmp-review-20261102`；发布采用精确lease。


### 2026-11-02 · 接管与逐层合入门

本轮实际直接base为 `712ae31fba836e96a2afd305c2a70dfa7968a8f1`；在本分支根执行 `node scripts/rule-checks.mjs disclosure 712ae31fba836e96a2afd305c2a70dfa7968a8f1`、`node scripts/rule-checks.mjs size 712ae31fba836e96a2afd305c2a70dfa7968a8f1` 和 `git diff --check 712ae31fba836e96a2afd305c2a70dfa7968a8f1...HEAD`。早期批次的固定source/base用于重放其历史证据，不作本轮当前判定。

本PR原正式批准与全矩阵证据由 `docs/review/pr-504-mmp-review.md` 承接；本轮用户明确要求接管全部开放PR。每次父层合入后，以真实main/直接父层重新确定replay cut，保留完整已批准产品/测试语义、归档与导航。先建 `refs/backup/pr504-before-approved-integration-20261102`，再检查range-diff、规模、五类发布面与适用验证；仅使用精确旧远端head的lease发布。

在当前分支检出根回读 `gh pr view 504 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,reviews,closingIssuesReferences`、`gh pr checks 504 -R SingularityKChen/harness-projects` 与全部review threads。新head的独立复评及真实必需checks成立后才执行已授权 `merge_method=rebase`；native stack成员使用仓库已验证的merge-async入口，逐项回读实际MERGED、合入tree和对应issue。旧head批准、dispatch、局部测试或“无冲突”不替代当前head验收。


### 2026-11-02 · 实际main的持续CI整合复评

实际source `0811933504afeda4dd4d32eacedfff67a256580d`、base `712ae31fba836e96a2afd305c2a70dfa7968a8f1`，本工作树独立执行直接shell的声明pnpm10.28.2：正常frozen安装、完整`pnpm verify` typecheck+3385主测试+7 MVP0、真实Browser7/7、三份CI契约73/73、W1–W7检查8文件0findings，全部0fail/cancel/skip/todo。CI YAML、专用契约和CI说明与原0e0e7b3逐字相同，父层source/carrier/browser/package-lock均无diff；README仅补本层入口，保留全部已合入索引。独立结论APPROVE，无新增P0/P1。

首次Python封装选择了非声明pnpm11，其自动环境检查在测试启动前退出并附带两行workspace配置；该次不记verify通过。附带变化已逐字撤回，改用声明pnpm10正常安装后得到上面的真实结果，pnpm-workspace.yaml与081原始字节相同。旧11项规则负控保留原source执行归属，本轮未冒称重新执行；最终文档head仍需新hosted CI/Browser/Fast Gate及全部线程与issue关联回读。

## Bottom Change Note

2026-11-02 16:18 +08：依据review §6收敛A/B为后置独立CI规则层，消费#498最终能力头，只有两层全部证据齐备才关联完整#450。

2026-11-02 +08：第二遍语义审读补充最终远端base/head直接回读的可执行argv验证与严格规模计算，避免后继base尚未产生时硬编码假值。

2026-11-02 +08：依据新发现的生命周期反例调整协调顺序；保留原策略并标明取代关系，CI先并行实现但最终重放和重新取证后才Ready。

2026-11-02 +08：记录规则RED/GREEN、复用W1–W7、七个规则mutant与空层负控；加入七天失败产物和不改变命令的missing-binary平台负控，保留最终重放/hosted验收门。

2026-11-02 +08：记录协调者在能力最终父提交上的无差异重放，以及73条规则、7条browser、完整verify和自然非零缺binary负控；平台正负控与最终远端验收继续保持未完成。

2026-11-02 +08：补入真实hosted正控与隔离负控的head/run、dispatch actor/目标/ack、7条非零与Fast Gate失败证据；明确正控早于负控，最终正式head恢复绿和Ready仍未执行，实验ref仅取证并由协调者精确清理。

2026-11-02 +08：独立平台复评通过后归档实现与证据材料；最终整理head的后置正控和Ready保留为GitHub权威动态回读门，不把先前正控冒称其结果。

2026-11-02：补充本轮MMP独立评审、用户条件授权及必要上游依赖门；保留真实反例和未验人类边界，不把本层批准写成整栈接受。

2026-11-02 SGT：按本会话人类对全部开放PR的直接授权接管收尾；新增实际base重放、恢复引用、精确lease、独立复评与逐PR合并回读门，保留原产品/预算/人验边界。

2026-11-02 SGT：记录真实新main上的完整验证、独立复评及本机包管理器环境失败/还原边界，最终新head平台证据仍单独取证。
