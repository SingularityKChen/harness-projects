# 已安装 Desktop 交付链路验收 ExecPlan

> 状态：Completed；创建：2026-11-04；控制规范：根 `PLANS.md`。
> 任务：#236、#449、#427、#143 优先收口；#545 为真实交付链路载体，Refs #72；不合并测试 PR。
> 后续：记录 #538/#542最终安装件补验，并核对 #459/#369/#304；R1各条件与整体验收分开。
> 执行上下文：文档准备在检出 `docs/desktop-acceptance-20261104` 的工作树根执行；真实工作树由已安装插件显式开始工作时产生。

## Purpose / Big Picture

用一次人类批准的有界真实模型测试，为同一工作项的执行上下文、分支、提交、PR 与真实 Actions 检查提供可追溯观察。最小证据是固定单文件 diff、实际会话与工作树身份、一个保持 Draft 的 PR，以及人类在插件中看到的同源 PR/CI。#124 离线仍在最后，既有 UI 检查不重做。

## Context and Orientation

人类已接受 #124 既有创建/连接/三种内容类型记录；19 个实际子项均关闭，16 个 merged closing PR 各有 exact-head `PR size` 成功记录，#124 当时仅缺离线。#72 当时尚缺明确执行谱系的真实 PR 和 CI；#143 当时尚缺完整 Demo 和失败/重启等观察。该初始快照 Superseded by `Progress` 的2026-11-07完整接受与实际关闭记录。测试不是重新开发这些父 Issue。

安装候选源码为 `f0883948f78a9bf0a28290e21c7b1c3842b54cf5`，Desktop Host `0.2.1-rc.5`，安装包 SHA-256 `29787f35ab8efbfd9233e5018757687a932bee8cbf0e39c46d82402fcea96cdf`。较新 main 不自动替换该候选。当前工作区有仓库绑定，但没有 execution 绑定、context 或 run。该段为初始准备快照，Superseded by 本节下一段的实际安装/提交记录。

2026-11-06 18:33 SGT，人类已安装组合源码 `64b58137`；12个文件匹配SHA-256 `d2c9c1b0a7508b7e25ff2c79484e8c81503915c28855fec5812773197e6966c4`。Host同时更新为 `0.2.2-rc.1`，不是原 `0.2.1-rc.5`。协调者通过产品UI启用Harness/human pair，处理反馈停留经设置重进读回，独立问题为 #553；没有直接写库。人类随后显式提交一次 #545。产品已建一套ready context、分支和真实worktree，固定文件逐字节正确；run及原mutation仍unknown，provider ref缺失，#554跟进。原会话终态尚未确认，不重发模型、提交/推送fixture或创建测试PR。Mac锁屏，等待人类手动解锁以继续原会话只读核对。该终态/锁屏快照 Superseded by 下一段2026-11-07原会话只读取证。

2026-11-07 SGT只读定位原生session `session-73144928-1e77-40ba-896a-b34014c4d55b`：同获准worktree、user rpcId为原context，prompt SHA-256 `a18cc397c4ee02d084b6a9137050bd2ea384234ead1cda905240cddc07b826a3` 与耐久startRun input一致。唯一主turn于11月6日18:47:10.213开始、18:47:32.517以completed结束；最终消息来源为deepseek-official/deepseek-v4.1-flash，标题生成请求另记。五次有界shell调用只查指令/现场、生成及验证fixture，没有模型侧commit/push/PR。插件run仍unknown且无provider ref，不能以本地日志修写状态或声称产品恢复成功。协调者按原授权提交/推送固定文件，head `ff293c9a3233bab3f5f982092a6bfed326211f60`；创建PR表单已准备，等待人类勾Draft并提交一次。Superseded by 下一段实际 #555创建记录。

2026-11-07 SGT人类已创建Draft PR #555，目标main、head `ff293c9a`，创建mutation为saved/draft=true、原context一致；16项exact-head GitHub checks均success。协调者在实际Desktop刷新后观察到同一context/branch/commit→#555→真实CI，run仍unknown。PR原生关闭关联为空、Assignees为空而作者存在，分别登记 #556/#557；没有手工补链或赋人掩盖发现。按原membership测试授权将测试PR加入Project #10，远端只出现一条，机械Kind/Area为test/tests；#545 Status前后仍Todo。上述五项后来均获人类明确正常；强制备用/界面尺寸各有明确复用裁决，离线也已全部通过。Superseded by `Progress` 的11-07最终人工批次；整体裁决仍单独获取。

## Design / Spec

使用专用 #545，拟用 `test/desktop-uat-20261104` 独立工作树，仅让模型生成固定 fixture，然后停止。协调者确认 diff 后再提交/推送；Draft PR 采用明确支持草稿的创建路径，不合并。该样例的实际提交/PR/check 供 #72/#143 共享证据，不能把原生关闭关联或普通 PR 列表冒充执行谱系。

初始 `f0883948` 候选准备发现：`packages/core/src/start-work.ts` 的 `startExecution` 仅发送 `harness run <branch>`，`packages/providers/execution-harness/src/provider.ts` 将其直接作为 session prompt；Issue 正文不会自动传入。创建 #545 本身不能保证固定任务到达模型。因此在受支持的任务范围传递方式明确之前，不提交自动执行、不假称一次模型测试已完成。当前 PR 创建契约也没有 Draft 参数，不能通过它创建普通 PR 后声称符合“不合并的 Draft”批准。

2026-11-07后续文档方案：#556默认使用当前来源Issue的可见正文引用，关闭关联只由人类显式选择；来源面板按GitHub原生关闭连接和PR交叉引用分别展示、去重并保留关系类型。#555→#545已有 `willCloseTarget=false` 的原生引用，不能将它当作缺少PR或确认关闭关系。#544负责两类完整观察的持久化/重启恢复，#539仍只负责Markdown渲染，#557独立负责PR负责人；本计划只更新这些公开Issue的范围，不实现产品功能。

## Global Constraints

本轮写集为本计划、`docs/README.md`、`docs/product/README.md`、`docs/product/demo.md`、`docs/product/demo-install.md`、`docs/product/installed-core-acceptance.md`，以及未来模型获准生成的 `tests/fixtures/manual-uat/README.md`。产品源码、workflow、依赖和AGENTS不在修改集；业务数据库不通过SQL/脚本改写，配置与执行持久化仅经产品Host正式命令。模型不提交、推送、创建 PR/Issue、安装依赖或调用子 agent；一次测试无明确结果时先读取原操作，不另发模型请求。相关验收项的证据评论按已授权范围写入；只有具体已完成项的人类接受记录写入本计划后，才可按原授权关闭和更新该项 Status，原生依赖不修改。

后续Issue写入范围由2026-11-07人类“修改相关Issue描述，指定相关Issue的milestone，修订#552”授权：#556修订标题与关系方案，#544对齐持久化范围，#546修订历史任务证据；#223/#283/#537/#539/#543/#544/#546/#553/#554/#556/#557补充milestone处置说明并设置归属；#236同步指南范围和原条件核销。所有写入以仓库所有者身份、已保存的原始正文及幂等标记操作，回读完整正文、milestone及现有规划字段。原MMP-Core、Status、Engineering、assignee、iteration和原生关系不由本批改变；#236仍待文档交付，不自动关闭。

最终安装补验与R1分项记录允许增加 `docs/product/core-release-audit.md` 、`docs/architecture/release-gates.md` 和 `docs/development/backup-rollback-rehearsal.md` 的有日期证据增量，保留原12条/10不变量及旧source快照。外部写入仅登记本节对应人类接受：#538/#542已满足原条件时关闭并Done；#369按明确批准关闭并Done，在 #73只登记条件12；#304/#459核对结果和容量留在原Issue，保持开放。#236只同步已知问题的实际关闭，不改其Status或自动关闭。

## Plan of Work

2026-11-06 调整：人类明确要求“创建 Issue，后续跟进。先继续验收”。任务传递缺口已登记为 #546，本轮不修产品行为。真实模型/后续测试提交与 Draft PR 尚未执行；继续 #143 中不触发执行的表单、未开始状态与提示检查，#236 独立安装及最终离线仍按原门禁保留。此安排替代本计划“先解决 Batch 2 再进行任何其它验收”的串行停顿，不把 #72/#143 的执行缺证转为通过。

2026-11-06 后续顺序：人类点名先完成 #236、#449、#427、#143。先完成下面 Batch 0，形成可审阅的指南、已知限制与逐项验收记录；再处理仍缺实际操作的批次。点名推进不等于豁免原验收，已有观察只复用一次。

### Batch 0 · 指南与人类验收证据收敛

更新 Demo 的证据边界及已知限制，保留安装指南原命令，记录 2026-11-06 人类独立干净 Web 安装通过。新增产品验收记录，以原始 Issue 条件映射已接受、工程旁证和未执行；区分原生 PR 关闭关联与 ExecutionContext 谱系。在文档工作树根运行 `git diff --check main...HEAD`、`node scripts/rule-checks.mjs disclosure main`、`node scripts/rule-checks.mjs size main`，期望无空白错误、无公开面命中、文档不超过1500行且代码为0。相对链接须指向当前分支或目标 main 已存在文件。先独立审读，再提交文档 PR；不合并。回滚为撤回本批文档差异，保留已接受的人类结果及外部证据。

主文件为 `docs/product/demo.md`、`docs/product/demo-install.md` 与 `docs/product/installed-core-acceptance.md`；索引与本计划随事实同步。相对链接在同一工作树根用下列命令核对，期望退出0并打印 `relative links: passed`：

```sh
python3 - <<'PY'
import os, pathlib, re, subprocess
changed = subprocess.check_output(['git', 'diff', '--name-only', '--diff-filter=ACM', 'main'], text=True)
new = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', 'docs'], text=True)
for name in set((changed + new).splitlines()):
    if not name.endswith('.md'):
        continue
    for target in re.findall(r'\]\(([^)]+)\)', pathlib.Path(name).read_text()):
        if target.startswith(('https:', 'http:', '#')):
            continue
        dest = target.split('#')[0]
        if not dest:
            continue
        rel = os.path.normpath(str(pathlib.Path(name).parent / dest))
        assert pathlib.Path(rel).exists() or subprocess.run(
            ['git', 'cat-file', '-e', 'main:' + rel], capture_output=True).returncode == 0, (name, target)
print('relative links: passed')
PY
```

### Batch 0b · Issue方案、milestone与指南核销

先保存目标Issue与 #552原始正文及规划字段，在Decision Log记录人类授权，再将恢复/生命周期项归入M4.1、完整界面项归入M5。#223/#283仍保留MMP-Core与原验收，归属不等于延期或发布豁免。回读 `gh issue view <n> -R SingularityKChen/harness-projects --json body,milestone,state`，期望与准备正文及归属逐字相符；对照原始Project字段，核对Status/Engineering并记录任何同期iteration变化，不覆盖他方修改。修订指南的当前缺陷、历史修复、原始构建和实际接受，并执行Batch 0文档检查与13章完整性核对。#236的原四项仅在证据和实际回读齐全后勾选；#552评审/合并仍为文档交付边界。失败时按已保存的原始正文与milestone恢复单个对象，不批量回退他人的后续修改。

### Batch 1 · 测试任务与前置取证

创建并回读 #545，将其加入 Project #10，保留机械 Kind/Area；记录一次模型授权、固定文本、安装身份与未调用事实。验证 `gh issue view 545 -R SingularityKChen/harness-projects --json body,state`，期望单文件任务且 `OPEN`；`node scripts/policy-check.mjs issue 545` 期望通过。回滚为取消未执行测试项的后续操作，保留证据，不删业务数据。

### Batch 2 · 执行配置与任务输入边界

由人类在连接设置启用 Harness 执行并核对开始工作表单；启用配置不等于模型服务或备用密钥可用。先确定能让精确有界任务进入实际 session 的受支持方式。若需公共命令/产品行为变更，先将差异作为独立修复范围交人类裁决，不把它混成验收已通过。验证源码实际 prompt 与 Host 接线、人类表单结果，期望真实模型请求前可证明任务边界。未满足则停留本批，不启动不受约束的自动任务。

### Batch 3 · 一次模型与独立单文件核对

仅在 Batch 2 通过后，用户显式提交开始工作。模型唯一输出文件正文为“人工交付链路验收样例”标题、空行、两句固定说明；完整文字以 #545 为准。工作树真实路径由 Host 回读后规范化核对。在该工作树运行 `git status --short`、`git diff -- tests/fixtures/manual-uat/README.md` 并以精确 UTF-8 字节对照，期望仅该文件。不要以会话 accepted 回执代替执行完成。失败或 unknown 记录真实结果，不重复启动。

安装准备补充（2026-11-06）：当前安装仍为旧候选，任务输入与Draft选择尚未进入该包。在独立 `.worktrees/installed-acceptance-candidate-20261106` 检出 `test/installed-acceptance-candidate-20261106`，从main `609463d8` 合并 #549@`3d80acfd`、#550@`6a28a7a9`、#551@`f5b41ff4`，形成干净本地源码 `64b58137`。只解决文档索引和两处测试冲突，保留两套ABI断言及参数计数6/8；没有手工修改产品实现，`apps`/`packages`树与既有组合 `a64f5848` 相同。该分支不发布或合并到main，候选不等于人验通过。

在该检出根执行 `pnpm install --frozen-lockfile`、`pnpm run typecheck`；范围命令为 `pnpm test:file tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/contract/ui-start-work.test.js tests/contract/ui-create-change-request.test.js tests/contract/ui-safe-markdown.test.js tests/contract/development-github-create.test.js tests/integration/start-work-task-handoff.test.js tests/integration/harness-plugin-start-work.test.js tests/integration/harness-plugin-host-execution.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/change-request-operation.test.js`，本次208通过。另跑 `pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-demo-artifact.test.js tests/contract/package-boundaries.test.js`，49通过；`pnpm test:file tests/browser/workspace-execution.test.js tests/browser/safe-markdown.test.js tests/browser/detail-expand.test.js`，17通过。均无失败/跳过；这是限定工程检查，不是全库verify或安装态裁决。

同目录用 `node apps/harness-plugin/scripts/bundle-report.mjs --out .superpowers/acceptance-candidate` 可重取raw/gzip/pack。实际交付SHA-256为 `d2c9c1b0a7508b7e25ff2c79484e8c81503915c28855fec5812773197e6966c4`、302193 bytes；12文件，七份migration与旧候选逐字相同、peer范围未变。由人类安装后，先只读核对实际文件和新候选身份，再重验受影响表单/Markdown并开展既有一次模型授权；该段是交付前快照；未安装/未提交记录已 Superseded by `Context and Orientation` 的实际安装/单次提交记录。回滚保留原tarball及同profile备份，不删业务数据。

### Batch 4 · Draft PR、真实谱系与人类判定

确认仅固定 fixture 后整理一个测试提交，Refs #545/#72/#143；按仓库公开面和规模检查，创建 Draft PR，并保持 unmerged。Git argv 规范化路径后执行；PR 必须回读 head/base/isDraft/issue 关联。用户在插件刷新并确认同一 context→branch/head→PR→实际检查；失败检查如实显示也可满足 #72 的显示性质。#143 的其余失败/重启/规划字段证据独立补齐。测试 PR 不自行合并或清理。

### Batch 5 · Markdown最终安装补验与R1分项核对

新包来自干净远端main `04af317ec3bda5084ab1e44ea5e3559fd4622079`，SHA-256 `32e0dd1bb5574fb7828278c2817d68aa01f269624b14c85ccb33534e32387b58`、302917 bytes。相对已验 `64b58137`，产品源码仅 `safe-markdown.ts`变化，12个安装文件仅client bundle变化；七份迁移、Host bundle与manifest/peers未变。62项Markdown/安装件检查通过，实际12文件匹配新包；人类对 #542三个样例回复“均无问题”，不重做Demo或模型任务。

#369复用2026-11-04固定Web演练，保留原包、Host和四步/负控身份，人类明确接受并批准在 #73记条件12及关闭/Done。#304独立核对Fake/SQLite的活旧owner、外部唯一性、丢ack和恢复，#554缺失身份的真实缺口保留；#459按当前23个Host入口、准入、开放finding、12+10与候选证据更新，不代判整体R1。人类确认可继续UAT，评审/修复容量未确认。

当前source的最窄命令：`pnpm test:file tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-execution-uniqueness.test.js tests/integration/start-work-external-intent.test.js tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-sqlite-registration.test.js tests/e2e/start-work-recovery.test.js tests/contract/storage-contract.test.js`，591通过；Host声明/remote/policy/Storage准入/运行期访问/身份/策略的8文件命令324通过，见候选边界审计增量的完整命令。反证探针不计入通过数，缺少正控或合同变化的旧探针不能移植旧结论。所有运行只使用临时夹具，不发真实模型、不改用户库。

## Validation and Acceptance

| 验收项 | 证据 |
|---|---|
| Batch 0文档交付 | 原路径指南、所有开放owner、独立安装接受、相对链接/公开面/规模检查及独立审读；不宣称四项已关闭 |
| #236条件保留 | 原milestone要求不变；按11-07新授权补齐后逐项回读，独立安装与完整Demo证据保持原身份；文档交付待 #552 |
| #449整体接受 | 精确安装候选、同构建raw/gzip/pack、实际UI/执行/恢复观察、截图/尺寸证据或明确复用裁决及最后人类结论 |
| #427父项收口 | 原始Core条件及 #449完成，不能只依据实现子项或CI |
| #143完整走查 | 步骤1–12、失败/重启/PR唯一/离线/规划不改写与问题处置，人类实际观察和明确结论 |
| 一次有界真实模型请求 | 人类授权、精确任务传递、实际 session/run 身份与结果 |
| 单文件任务 | 真实工作树 diff 与固定字节；无其它产品文件改变 |
| 真实 PR/CI 同谱系 | exact commit/PR/check 回读和人类插件观察 |
| 诚实边界 | Draft/unmerged；未执行、unknown、人工备用与模型完成分别记录 |
| 不篡位规划事实 | 测试项规划字段前后读回；无未授权 Status/关系写入 |

## Progress

- [x] (2026-11-04 20:40 SGT) 人类批准一次有界模型测试及专用 Issue/分支/单文件、不合并的 Draft PR；#545 已创建并回读，尚无模型调用。
- [x] (2026-11-04 20:40 SGT) 核对当前无 execution 绑定/context/run；发现自动 prompt 不带 Issue 正文及 PR 契约缺 Draft 参数，记录为执行前置事实。
- [x] (2026-11-06 SGT) Batch 2：新候选明确任务表单/正式路径及原持久输入已核对，人类提交一次有界任务；原候选输入缺口属于历史。该时点原会话终态未确认，Superseded by 本节2026-11-07原生终态条目。
- [x] (2026-11-07 SGT) Batch 3：原session精确任务、唯一主turn completed和模型单文件停止边界已只读核对；插件unknown缺陷仍为 #554。
- [x] (2026-11-07 SGT) Batch 4提交和创建：人类在产品内创建 #555，OPEN/Draft/main/ff293c9a均回读；本地PR intent saved且draft=true。16项exact-head checks通过；协调者已观察实际安装谱系同源PR/CI。
- [x] (2026-11-07 SGT) Batch 4人类五项均正常：同源PR/CI、原操作读回、重启保留无新run、PR成员唯一、Markdown修复。
- [x] (2026-11-07 SGT) 人类接受明确版本的11-04Web强制人工备用记录，不将它改为本轮Desktop实测；新Host三项界面回归通过，尺寸/200%/截图明确复用旧Web/组合浏览器证据。
- [x] (2026-11-07 SGT) 最终离线五项均正常：最后已知列表/正文/交付事实保留且陈旧、无虚假成功、联网恢复无重复串项。
- [x] (2026-11-07 SGT) 人类最后整体裁决接受具体五项并批准关闭/Done，接受已明示证据边界与Demo跟进分类，详见Decision Log。
- [x] (2026-11-07 11:17 SGT) 已逐项更新原验收框，#124/#72/#143/#449/#427均CLOSED/COMPLETED、对应Project #10 Status均Done；各项写后GraphQL回读一致。
- [x] (2026-11-07 SGT) #236原四项验收条件已满足，指南、已知问题映射和安装态证据由 #552交付；#236 issue保持OPEN，等待该文档PR的人类评审与合并，不据此改写规划Status或整体发布门禁。
- [x] (2026-11-07 SGT) Batch 0b的11项Issue正文/milestone已逐项写入并回读；16个已知开放owner均属M4.1/M5。#556区分引用/关闭、#544对齐快照、#546补录已执行证据；#236与 #552按文档检查和最终推送回读核销，交付合并仍待人类评审。
- [x] (2026-11-07 SGT) 新main包62项检查通过，12/12实际安装字节匹配；人类接受 #542三项最终补验。#538相关展示源码未变，原人类观察与新包检查分别保留。
- [x] (2026-11-07 SGT) 人类明确接受既有Web回滚演练，批准在 #73记R1-12及 #369关闭/Done；同时确认本人可继续UAT、评审/修复容量待确认。
- [x] (2026-11-07 SGT) Batch 5：#538/#542/#369均已completed关闭并Done，逐项远端回读；#73只登记人类R1-12接受。#304/#459保持OPEN/原Status并登记当前恢复/风险/容量缺口，文档增量由 #552交付。

- [x] (2026-11-06 SGT) 已将任务输入缺口创建为 #546，按人类指令留待后续；安装包 12/12 字节仍匹配原候选，当前 context/run 均为0，未调用模型。
- [x] (2026-11-06 SGT) 人类确认五项提交前表单/诚实未开始状态正常；#143/#545 评论已回读。具体 execution mode 未报告，不推定绑定或模型调用。
- [x] (2026-11-06 SGT) 人类仅按交付指南完成固定 Web `0.2.0-rc.2` 干净 profile 安装，摘要、安装、Documents/native workspace 隔离和空入口四项通过；#236安装框及 #143证据评论已回读。
- [x] (2026-11-06 SGT) Batch 0指南、统一验收记录、同构建包体复核及独立审读完成；两项P2已修复，链接命令与空白检查通过。
- [x] (2026-11-06 SGT) Batch 0已建Draft PR #552，首个head `87875fa8` 的远端身份与全部16个checks回读通过；后续文档push重新锁定head/checks。#236按人类决定保持开放，其他三项没有整体接受裁决。
- [x] (2026-11-06 SGT) 临时组合候选 `64b58137` 已打包并通过类型检查及274项限定测试；该准备时尚未安装/调用模型，Superseded by 下方实际安装/提交条目。
- [x] (2026-11-07 SGT) #449/#427/#143最终整体裁决已接受；11-06待验清单由本节逐项接受及实际关闭条目替代。

- [x] (2026-11-06 18:33 SGT) 新包12/12安装一致，Host `0.2.2-rc.1` 已记录；支持正式UI设置确认和单次人工提交。
- [x] (2026-11-06 18:50 SGT) 只读核对固定文件SHA-256 `63280ed805e84652e0a459dfb9c91edaef311c47f61e42d20887a2127d892b5b`，HEAD保持 `609463d8`，仅该fixture未跟踪。单个context/run和原attempt存在，后两者unknown；#554记录身份丢失路径，未假定已结束。
- [x] (2026-11-07 SGT) 解锁后只读原生会话日志完成关联和终态取证；没有再发模型。完整日志不公开，保留无本机路径/访问材料的事件摘要。

## Surprises & Discoveries

原提案假设固定 Issue 正文会进入模型任务，该假设被当前 startExecution→session prompt 代码推翻。界面开始工作仅传工作项/仓库/可选分支，不能从 Issue 已创建推断模型收到正文。不存在 Draft 入参同样改变后续创建路径；两个事实都不能通过测试夹具伪造。

安装实证出现两项独立发现：#553为启用绑定后UI停留处理中，设置重进可安全读回；#554为实际生成固定文件但run unknown且provider ref为空。生产Provider的合成探针证明“create返回ID、prompt accepted、首次inspect抛错”会返回ambiguous且丢弃run引用，真实模型调用0。该探针不证明本次失败具体发生于prompt/inspect/list中的哪一边界，也不归因于新Host。原始mutation记录与unknown状态保持不动。

PR元数据发现也需区分：当前原生关闭关联面板只读GitHub `closedByPullRequestsReferences`；#555与#545双向均为空，所以“无原生关闭关联”符合来源事实。来源Issue选择属于 #556，PR负责人选择属于 #557，作者已由认证actor确定，空assignees不控制Issue-link读取。不得自动把全部Refs变为Closes或借赋人修饰原生关联。

11-07 milestone写入后原生回读发现 #553/#554的Iteration从10变为9，而本批仅调用Issue正文/标题/milestone的PATCH，没有Project写入。其余已读取Status/Engineering值均与前快照一致；保留同期规划现值，不把旧快照强写回去。#552十条既有记录rebase到当前main后，range-diff全部逐条等价；新增修订作为独立文档提交，既有批准/观察边界保持。

## Decision Log

2026-11-04 / 人类：在具体仓库、分支、单 fixture、不合并 Draft PR 的提案下选择“允许一次有界 Harness 模型测试”；授权覆盖该测试的真实额度和专用 GitHub 对象。模型输出范围不因仓库根指令或父 Issue 的较大任务而扩大。

2026-11-04 / 验收协调者：先完成任务登记与配置取证，把自动 prompt 传递缺口置于模型请求之前验证。原因是“只有固定文件”必须约束实际模型输入；没有输入证据不能把通用启动标记当成已批准的精确任务。Superseded by 本节 2026-11-06 的人类执行顺序裁决：输入仍须在模型调用前验证，但不阻塞其它独立验收。

2026-11-06 / 人类：要求创建缺口 Issue 后续跟进，先继续验收。据此创建 #546 并登记至 Project #10，仅机械填写 Kind/Area，不改原生阻塞关系、现有规划 Status 或发布范围。#545 的一次有界模型授权仍保留，但本轮不启动无精确输入的模型；继续 #143 的无执行表单/状态检查，并记录独立完成或未满足项目。

2026-11-06 / 人类：独立安装先回复“尚未做过，可以先验收”，随后对明确四项干净 Web 安装批次回复“确认无问题。继续”。该接受仅覆盖指南规定的 Web 安装；现有 Desktop、真实模型和完整 Demo 不因此通过。

2026-11-06 / 人类：优先顺序为 #236、#449、#427、#143。据此先补可独立完成的文档和已知问题映射，再针对缺口取证；没有提前关闭四项、修改验收条件或合并其他PR的授权。原“验收通过后可关闭”批准继续适用于实际满足原条件的项目。

2026-11-06 / 人类：对 #236旧milestone条件选择“保留原条件，暂不收口”。不更改该条件，不为关闭而移动owner归属；文档继续完善并以Refs交付，#236保持开放。仅milestone不移动的限制 Superseded by 本节2026-11-07后续明确授权；原条件及开放/发布边界仍保留。

2026-11-06 / 验收协调者：按人类推进后三项的请求准备既有修复的临时组合包，使用独立本地test分支保留所有PR来源与原安装。安装由人类完成，换候选后重新记录身份及受影响检查；不把未合入源码、测试通过或已准备tarball当成人类接受，也不扩大既有模型额度。

2026-11-06 / 人类：回复“已安装”，随后在预填的仓库/分支/固定任务提案下实际点击一次提交，反馈“已提交，正在执行”。协调者实际回读为unknown，故保留人类报告与权威结果的区别；实际固定文件产出不是终态成功。新Host和两项发现分别记录，不追加模型额度，不静默修库或将unknown转人工重跑。

2026-11-07 / 验收协调者：原生completed事件和固定文件独立核对后，按既有有界测试授权完成单文件commit/push，未以 #554未知状态另发模型或人工备用。创建PR仍要求Draft、同一head/context和不合并；原生会话证据与插件状态错误分别保留。#236保留原条件，不借本批变更范围或关闭父项。

2026-11-07 / 人类：报告已创建PR并引用“已保存原请求（草稿 PR）”结果，同时指出缺少Issue和用户设置。协调者回读确认 #555后将两独立能力记录为 #556/#557，保留现有来源事实，按原测试范围添加一次PR项目成员以验唯一性；不修改原Issue规划字段或关闭验收父项。人类下一批仍由其实际观察后裁决。

2026-11-07 / 人类：对同源PR/CI、原请求读回、正常退出重开保留且无新run、Project PR唯一和Markdown修复回复“五项均正常”；对明暗/窄面板/键盘前三项及精确尺寸/200%/截图来源复用明确接受。对人工备用单独选择“沿用该Web演练记录”；对最后断网/恢复五项回复“五项均正常”。以上均为子项裁决，不预设 #554基本/非基本分类、三个父项整体验收或Project Done。

2026-11-07 / 验收协调者：准备明确的最终裁决提案，点名 #449/#427/#143/#124/#72；保留 #236不收口和 #555草稿不合并。拒绝/撤权/迟到响应采用已完成生产组合浏览器证据而非真实账号撤权，必须在最终裁决中披露；#554若作为Demo非基本跟进，也不豁免 #459/#73对实际发布风险的判断。缺少最终批准时不执行关闭/Status写入。

2026-11-07 / 人类最终裁决：针对具体候选 `64b58137` / Desktop `0.2.2-rc.1`、点名 #449/#427/#143/#124/#72关闭并Done、明确历史证据复用/未实际撤权/#554 Demo分类及R1边界的提案，回复“后续有Issue 追踪的都可以关闭并 done”。据此接受这五项的本轮界面、Demo学习检查点及各自原条件；授权协调者关闭这五个Issue并只将这五个Project #10 Status置Done。#553/#554/#556/#557及原编号/引用/关系/快照改进独立保留；#554按提案作为本次Demo非基本缺陷跟进，但不豁免 #459/#73真实发布路径风险裁决。#236保留原milestone条件与OPEN/原Status，#555保持Draft/unmerged。该批准不覆盖未列举Issue、PR合并、发布、新模型请求或数据清理。

2026-11-07 / 人类后续授权：在“默认正文引用、可选合并关闭、来源面板读取两类原生关系”和 #236剩余条件解释后，明确要求“修改相关Issue描述，指定相关Issue的milestone，修订#552”。据此按能力归属将 #223/#283/#544/#546/#553/#554/#556设为M4.1，#537/#539/#543/#557设为M5；#144/#278/#235已有M4.1、#538/#542已有M5保持。#223/#283的MMP-Core要求、原验收和 #459/#73风险判断不变；不承诺iteration或日期。#236保留原milestone条件，只有回读和文档检查完成后才勾选已有证据，Issue仍待 #552评审/合并。该授权不涉及Status、原生阻塞关系、PR合并、模型调用或数据库写入。执行前已保存原始Issue/PR快照；#552更新基线前建立恢复引用，精确lease发布并回读新head/checks/线程。

2026-11-07 / 人类：在已说明 #538原条件已有证据、#542需最后parser安装件补验后，要求提供最新包；收到明确来源/摘要及三组样例后回复“均无问题。继续验收#459、#369、#304”。实际12文件匹配 `04af317e`新包。据此前“登记的问题单独跟踪，可以关闭的Issue登记后可以关闭”的持续指令，协调者记录两项原验收完成并关闭 #538/#542、只将这两项Status置Done；不把新包Markdown接受转写成新的完整Demo测量。

2026-11-07 / 人类：对具名Web `0.2.0-rc.2`、2026-11-04备份/回滚/原路径恢复演练的具体提案选择“接受并登记、关闭 #369 / Done”；该提案明确包含在 #73登记R1条件12满足，以及保留原版本身份、不等于整体发布批准。据此协调者可关闭 #369并仅将其Status置Done。另选择“本人可继续验收，评审/修复容量待确认”，只记录真实部分容量，不推断11月8日必发、Reviewer已承诺或修复已排定。#304/#459本轮没有整体接受或Done授权。

2026-11-07 / 验收协调者：#304不因591项通过或 #420/#421关闭而完成；#554已知session身份丢失直接涉及父项恢复原条件，保留 #304和R1 owner，无默认提取/风险豁免。#459不以Markdown、Demo、条件12或目标日期替代全量归级、同产品head两次稳定CI与剩余容量。原P341缺新task导致invalid_input；适配显式task后正控成立而改root返回conflict，旧Ready断言不再适用，保留原owner而不制造旧反例仍失败的结论。

## Idempotence and Recovery

#545 的 tracking marker 用于防重建；创建分支前回读同名 ref，已有对象不覆盖。pending/unknown 按原 context/operation 读回；模型不得自行重试。保留当前库、分支和工作树，任何停机、解绑、删除或 PR 关闭均单独按实际后续指令处理。新模型调用为零时记录准备状态即可。

## Interfaces and Dependencies

依赖实际 Desktop 的执行配置/会话服务与人类已配置的模型；凭据只通过 Host 服务解析，本文不访问或记录凭据值。使用 `gh` 所有者身份管理获准测试对象，PR 必须支持 Draft。初始候选有界输入为前置未知；该历史未知已由 `Context and Orientation` 的实际原session任务hash和completed记录替代。产品修复不在本计划本轮写集，后续发布候选改变仍按受影响范围重验。

## Outcomes & Retrospective

2026-11-07 11:17 SGT最终结果：人类已接受本轮候选、明确复用边界与Demo缺陷处置，批准的 #124/#72/#143/#449/#427均已completed关闭且Status=Done，逐项远端回读一致。#553/#554/#556/#557及原改进项仍独立跟进；#236当时原条件不满足，保持开放和原Status。该milestone缺口 Superseded by 本节下一段的后续授权结果；不声明 #73/R1、发布或测试PR合并完成。

2026-11-07后续结果：人类明确授权相关描述/milestone与 #552修订，11项Issue更新均按原正文并发核对后写入，16个已知开放owner已回读为M4.1/M5。原 #236条件保留；独立安装和Demo不用重做，文档清单按真实检查核销。指南消除旧候选/未执行叙述与当前接受的混淆。#236继续OPEN待 #552评审/合并，本计划因文档交付尚未合并保持Active。该Active状态 Superseded by 下列归档结果；#223/#283的Core要求、#554实际unknown和独立R1判断仍保留。

2026-11-07归档结果：#236原四项验收条件已满足，当前文档包在PR #552中交付并进入独立评审；该Issue继续OPEN，等待PR交付完成，不改Project Status。计划归档不表示 #141/#304/#459/#73/#554验收或发布门通过；#555继续OPEN/Draft且不合并。

2026-11-07：原模型任务确实完成并停止，精确任务输入与原context关联有原生日志证据；插件没有正常恢复，#554继续开放。协调者只有获准单文件提交/推送，PR表单在该时点已交人类一次提交。该待创建快照 Superseded by `Context and Orientation` 的 #555实际创建及协调者同源CI观察；人类综合接受继续单独记录。没有追加模型额度、修写run状态或关闭四项。

2026-11-06：本批文档已形成统一接受/工程旁证/未执行映射；同tarball复核Host/Client raw与gzip及整体pack一致。独立审读的两项P2均修复，未发现新实质问题。#236保留原条件，实际milestone不满足时不收口；文档PR不使用Closes。其余三项继续等待真实产品观察，未伪造关闭或Done。

已完成 #124 非离线证据协调与 #545 测试准备；没有执行真实模型、创建实际工作树或 Draft PR。剩余工作先解决 Batch 2 的模型任务输入边界，再按原 #72/#143 接受条件推进。Superseded by `Decision Log` 的 2026-11-06 人类裁决：任务输入作为 #546 后续跟进，其余独立验收继续；实际模型/谱系证据仍待完成。#236 与 #427 继续等待各自原始验收，不回到扩展 #449 清单。

2026-11-07本批结果：人类已接受最终Markdown安装补验及具名Web回滚演练，#538/#542/#369均CLOSED/COMPLETED、Status=Done；#73登记条件12但仍OPEN。#304/#459分别保留实际恢复与审计缺口；23入口、324项当前准入/访问检查及591项owner/Storage检查各自记录，不合称全仓通过或整体R1接受。

## Bottom Change Note

2026-11-04：依据已批准的一次有界模型方案建立同一 living ExecPlan；记录真实 prompt/Draft 约束，阻止将 Issue 内容假定为实际模型输入。

2026-11-06：按人类最新指令记录 #546 独立跟进与跳过实际模型执行的本轮验收顺序，保留 #72/#143 真实执行证据和最终离线的未完成状态。

2026-11-06：补录提交前与独立安装结果，按人类指定顺序加入指南和验收证据收敛批次，保留真实执行与最终人类裁决的完成边界。

2026-11-06：独立审读补齐 #449同构建包体指标与Batch0验收/链接命令，并记录人类保留 #236旧条件的决定。

2026-11-06：补录实际安装、Host版本变化、设置反馈恢复、一次人工提交及固定文件/unknown分离证据；#553/#554独立跟进，锁屏后等待手动解锁读原会话。

2026-11-07：补录原session completed与任务hash、单文件提交/推送和Draft PR准备，订正“未确认原会话”的历史状态，保留产品unknown缺陷及剩余验收。

2026-11-07：补录人类创建 #555、Saved/Draft/真实CI及Project唯一成员证据，#556/#557分别跟进原生Issue关系与负责人；五项重启/回归人验仍待反馈。

2026-11-07：补齐最终五项重启/Markdown、强制人工备用和尺寸截图复用、离线恢复人类结果；形成具体五Issue关闭与Done提案，保留 #554分类和整体人类裁决待确认。

2026-11-07：记录人类对点名五Issue的最终接受与关闭/Done批准，执行前固定 #236保持开放、#555草稿不合并、R1独立及后续缺陷归属。

2026-11-07：补录批准五项实际completed关闭/Done和远端回读结果，明确 #236仍未完成并保持本计划Active，测试PR及R1边界保持独立。

2026-11-07：按后续明确授权加入Batch 0b，记录Issue方案/milestone写入边界与 #236原条件核销方法；修订指南中的过期未执行叙述，区分引用与关闭关联及历史/当前候选。

2026-11-07：记录最终Markdown安装件、三项人验与12文件核验，并在外部关闭前登记 #538/#542范围和 #369/R1-12的明确人类批准；#304/#459保留恢复风险与未确认容量。

2026-11-07：补录三项实际关闭/Done、#73条件12接受及当前RC审计结果；保留 #304/#554恢复义务、#459全量归级/同head CI/容量缺口及旧探针合同变化。

2026-11-07：两路独立只读复核分别核对回滚分项授权和当前恢复/边界矩阵，未发现本批文档问题；不替代平台PR评审、#304整体接受或R1发布裁决。

2026-11-07：核销 #236原四项并将文档交付记录归档；#236仍等待PR #552人类评审/合并，#141/#304/#459/#73/#554及 #555 Draft边界保持独立。
