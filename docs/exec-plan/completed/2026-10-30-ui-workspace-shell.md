# 可滚动且可退出的工作区壳 ExecPlan

> 状态：Completed（工程与隔离安装验收）；创建：2026-10-30；分支：`fix/ui-workspace-shell`；PR base：`main`。
> 范围：关闭 #482、#483；遵守根 `PLANS.md`。检出：`.worktrees/ui-workspace-shell`。

## Purpose / Big Picture

人在受限 Host 主面板中能滚到设置/工作项末尾，并在 configured、degraded、offline、failed、pending 等状态从设置标题返回。退出只改变本地视图；草稿、请求身份与未知结果保留，不能为了创造目的地泄漏旧列表。最小成功证据是真实产品入口/返回控件、bounded clipping 下的滚动度量、原调用次数/intent key 和回焦断言。

## Context and Orientation

`WorkspaceSetupGate` 消费 setup 与工作区读数，`WorkItemApp` 管理列表/详情局部导航。现有 list 条件要求 setup confirmed 且 read workspace 匹配；stage 又因 planning 非 unbound 强制 connect，单纯 setSettings(false) 无法让 configured/degraded 退出。通用 button 还把导航随 pending 禁用。`.hp-workspace` 无有界纵向滚动；自然文档 fixture 无法检验 Host 的 clipping。

`RepositoryBindingForm` 卸载时 cancelAttempt；映射表单的未提交值依附 data 对象 identity。因此本变更必须同时解决设置显示生命周期和不必要 refresh。source 继续负责写入、幂等键、迟到响应与安全错误。首轮观察来源为 2026-10-30 的 `main@417349a`，实施前以实际 base 回读为准。

## Design / Spec

采用插件私有 flex/grid 外壳：有界可收缩根（min-block-size/min-inline-size:0），非正文滚动的局部标题/返回区，唯一正文滚动区（剩余高度、overflow-y:auto、可识别名称及键盘焦点）。高度来自实际 Host slot 的确定约束；先测父链，禁止用 100vh 猜窗口高度、修改 body/Host CSS 或给所有 `.hp-workspace` 都加滚动。保留 table 必要横滚和 detail 自有滚动。极短视口让标题仍可达，不能把正文永久挤成零；按实测选择 root overflow 的可达降级并记录。

导航改为显式本地 workspace/settings 状态。初次读取/创建可展示设置，但任意设置状态都有顶部“返回工作区”；同 scope 可读时回既有 WorkItemApp，否则回安全摘要，说明来源未确认/尚无可读数据并提供“连接设置”。未创建可回真实欢迎摘要。返回不依赖 pending、confirmed、Provider 回应，不调用 refresh/bind/install/reset/cancel。仅数据动作禁用。保留原列表 scope/access 门，不为了返回放宽。

首次进入后在同一 source+workspace+binding/project scope 内保持设置子树的 type/key/位置，用 `hidden` 控制可见性。切换目标需隔离旧草稿，禁止旧 draft 自动套新目标；source 的未决操作继续归原 source。无需永久挂载 WorkItemApp，详情路由恢复不是此闭环的新增要求。mapping refresh 只因首次需要的完整 scope 或真实 scope 换代触发，导航/resize/theme 不重读；scope 一致的显式 refresh 不应静默覆盖未提交 mapping 草稿，确需刷新时保留 draft 并展示其未应用状态。恢复原 source 业务语义，不扩 DTO。

隐藏表单完成时不抢焦点：`focusFormError` 检查 hidden/inert ancestor/实际可见性；初始未挂载和 SSR 安全退化。返回优先聚焦进入设置的真实控件，入口消失时聚焦当前安全 heading。保留原生 select/dialog Escape 优先级；本轮不新增全局 Escape。备选“上提全部受控草稿并条件卸载”需更多表单 API 与取消语义改动，成本较高；body scroll、多表单独立滚动均破坏 Host 约束，因此不选。

## Global Constraints

硬上限是本 PR 相对实际 base 的新增+删除：代码/测试/fixture/config ≤799 行，文档 ≤1299 行；估算只用于提前止损。无 migration、兼容层、新 Provider、依赖、全局 router、主题状态、权限刷新机制或第二事实源。Host 权威、Provider ack/reconcile、secret handle、Planning 与执行/CI 正交保持不变。禁止修改 Planning Status、native blocked-by/blocking 或自行合并。公开文档中文且只写仓库相对路径；运行日志与截图保存在被忽略的 `.superpowers/`。所有 Git 操作通过 argv/API，隔离路径先 realpath 核对；不清理他人改动。

唯一 shell owner 可改的文件集合：`packages/ui/src/workspace-setup.ts`、`packages/ui/src/workspace-presentation.ts`、`packages/ui/src/form-presentation.ts`、`packages/ui/src/planning-mapping.ts`、`tests/contract/ui-workspace-setup.test.js`、`tests/contract/ui-planning-mapping.test.js`、`tests/contract/ui-workspace-shell.test.js`（新）、`tests/fixtures/workspace-forms-browser.mjs`、`tests/fixtures/execution-drawer-browser.mjs`、本计划 `docs/exec-plan/active/2026-10-30-ui-workspace-shell.md`（完成后同名移入 completed）与 `docs/README.md`、`docs/product/ui-forms.md`、`docs/product/ui-workspace-frame.md`（整合 owner 串行维护）。预计代码/测试 500–700、文档 230–350；≥760 先重估并删除非验收复杂度，达到上限不得继续扩写。共享 fixture/根组合由同一 owner 编辑；B 不改这里，C 只在 A 合同稳定后接续。

## Plan of Work

### Batch S0 · 锁定基线与失败证据

在检出 `fix/ui-workspace-shell` 的工作树根运行 `git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`，核对 isolation；执行 `pnpm install --frozen-lockfile`，期望 lockfile 无变化。复读 issue #482/#483、相关源与 demo-install，记录原 Host 高度链与截图。

主文件为本计划和专项测试。先写具名 RED：configured/pending 返回确实离开；mapping/repository 草稿与 held account/bind/baseline 离开重入保留；wrong scope 不展示旧列表；bounded ancestor 下末动作可达。运行 `pnpm test:file tests/contract/ui-workspace-shell.test.js tests/contract/ui-workspace-setup.test.js tests/contract/ui-planning-mapping.test.js tests/contract/ui-repository-binding.test.js`；新案例必须因目标缺陷失败，构建/模块错误不算 RED。已有 draft PR 则不重复创建，回读 base=main、draft=true、closing issues 482/483。回滚点是尚未修改产品代码的基线。

### Batch S1 · 最小外壳与导航生命周期

主文件为 workspace-setup、workspace-presentation、form-presentation、planning-mapping。先完成显式 view/安全摘要/顶部独立导航，再完成限定外层的滚动区、稳定设置子树、scope 驱动刷新与可见焦点保护。保留字段 labels、required、help/error associations、unknown/retry 和原 source 调用参数。每步运行 S0 同一命令，最终新旧全 GREEN、零 skip，再运行 `pnpm typecheck` 与 `pnpm boundaries`（期望 exit 0）。若修复需要 client/Host 语义变更，停止扩大产品范围并回到本节更新边界。回滚撤销此批 UI/test 改动，保留计划与失败记录。

### Batch S2 · 浏览器、负对照与安装候选

沿用已有 forms carrier 的真实 source，去掉 fixture-only leave/enter 作为产品成功路径；它们可留作卸载测试。沿用 execution-drawer carrier 的生产 apply/Host 链，在 fixture HTML 加 bounded flex/grid + clipping，不能造新 carrier。运行 `node tests/fixtures/workspace-forms-browser.mjs` 与 `node tests/fixtures/execution-drawer-browser.mjs`（分别启动，按输出 URL 打开）；用浏览器工具执行下表。现有 browser 名称契约仅 bundle/SSR，不当作 DOM 证据。

在隔离 probe 副本逐项移除实际 scroll-owner/min-height、恢复 confirmed-only/pending-disabled return、改成条件卸载或重加导航 refresh；指定 outcome case 必须失败。还原后同命令与浏览器 case GREEN；无害 wrapper/class 变化保持语义断言通过。记录确切变异与命中测试，不把未运行变异写成 killed。回滚 probe 只撤本次变异，不做目录破坏性清理。

最终证据阶段先在干净最终提交上运行 `node apps/harness-plugin/scripts/bundle-report.mjs --source-root . --out .superpowers/ui-bundle`，并用相同工具链的干净 base 重算比较；然后运行 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`、`shasum -a 256 apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.1.0-demo.1.tgz` 和 `pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-demo-artifact.test.js`。期望全部 exit 0，记录 source SHA、tarball SHA、client/Host bundle raw+gzip 及输入/externals 差异；无新依赖不代表零字节增量。

安装操作逐条执行 `docs/product/demo-install.md` 的 artifact-only、隔离 `DSH_HOME`、独立 Documents overlay 与固定 `@deepseek-ai/dsh@0.2.0-rc.2` Web profile 流程，核对生效数据根后再打开候选。已有 Desktop `0.2.1-rc.5` 仅另记兼容观察；不能替代固定支持路径。安装身份以本次 tarball hash/实际 manifest/bundle 为准。用真实浏览器操作产品控件，记录 Host/layout 版本、panel/ancestor computed overflow/min-height、clientHeight/scrollHeight/scrollTop、viewport/text-size/theme 和脱敏截图。需要真实 Provider 的场景与无凭据组合分开记录；不得写入真实 token、账号、本机路径或含访问材料的会话 URL。

交付前执行 base 对应的 disclosure/size 与 diff 检查，人工复核凭据、本机身份、账号个人信息、内部系统、保密字样。按 `docs/development/workflow.md` 整理提交；已推送历史需要改写时先 backup ref，再遵守 git-expert-operations 的精确 lease。最终 push 后用 `gh pr view -R SingularityKChen/harness-projects <branch> --json headRefOid,baseRefName,isDraft,closingIssuesReferences,reviewDecision,statusCheckRollup` 和 `gh pr checks -R SingularityKChen/harness-projects <branch>` 回读实际 head/base/关联、review threads 与检查。只有当前 head 的验证和必需 `PR Fast Gate` 通过才 ready；CI 未完成时保持 draft。本计划完成不等同 #449 人类接受或 R1 发布裁决。

本分支检查命令为 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`；脚本仓库限额外，人工或 argv 脚本对 diff numstat 核对更严 799/1299 上限。未运行/失败/凭据阻塞必须逐项如实记录。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| settings/list 真正滚动 | 1440/1024/375/320 宽、短高、100%/200% text、light/dark；wheel/trackpad、PageDown/End、Tab；plugin scrollTop 增长且末内容可见，body 不承担滚动，无全页横溢出 |
| 任意 setup 可退出 | confirmed/configured/degraded/offline/read-failed/pending 矩阵；真实连接设置与返回控件，按钮 enabled 且目的地真实 |
| 草稿/操作保留 | project 空草稿、未提交 mapping、repo 输入；held account/bind/baseline 后离开/reopen/release；同 intent key、零额外写、无自动导航 |
| 安全/焦点 | wrong workspace、无读数或访问不可读为安全摘要；hidden 无可聚焦可见项，晚错误不抢焦点，返回 initiator 或安全 heading |
| 负对照有效 | 移除滚动/返回/保留合同分别使具名 case RED；还原 GREEN；无害 class/wrapper 不影响 |
| 证据边界 | source/artifact/Host 版本、实际 geometry、当前远端 checks；本地测试、组合、安装、#449 人类接受分别记录 |

## Progress

- [x] (2026-10-30 +08) 两份独立设计及第三方综合评审完成，选定最小外壳闭环。
- [x] (2026-10-30 +08) S0：实施 owner 已核对隔离检出及依赖可用；目标 RED 与当前代码的失败原因已记录。draft 关联由整合 owner 回读。
- [x] (2026-10-30 +08) S1：显式本地导航、限定根滚动、稳定设置子树、scope 草稿与焦点保护已实现；检出 `fix/ui-workspace-shell` 工作树根的聚焦命令通过 57/57，`pnpm typecheck` exit 0、`pnpm boundaries` 9/9。
- [x] (2026-10-30 +08) S2：DOM/负对照、39 项安装件契约、隔离 rc2/rc5 安装和独立复评完成。最终 push 后按本计划命令回读当前 head/base/checks/关联/threads；不以本条推断 hosted CI 通过。

## Surprises & Discoveries

2026-10-30 +08 / 独立审阅 `294e8ae` 后复现：forms carrier 的 list getter 每次分配对象，真实 React 因 cached-snapshot/Maximum update depth 错误清空应用；配置态的既有几何证据不覆盖这个入口。稳定快照后，在 320×360 实测 WorkItemApp 宽 290、重复 padding 15、内容宽 260；原两条去重选择器都不匹配额外 wrapper。此批只修 carrier 常量/getter 和现有 scoped selector，删除失效 FORM_STYLES 规则，未改 Gate。

源码显示“返回按钮存在”不等于能离开：stage 中 planning 非 unbound 仍回 connect。repository 卸载会 cancelAttempt；mapping refresh 换 data identity 会抹未提交草稿。自然文档 carrier 没测 Host clipping。以上初始观察已由本候选 RED/GREEN 验证：新增六个 shell/映射 case 在基线上因缺返回控件、隐藏错误焦点和 data identity 丢草稿失败；后补的 capability 门与确认后释放草稿各先 RED。该阶段尚无安装/hosted CI 结果；安装结论 Superseded by `Outcomes & Retrospective` 最终安装证据（2026-10-30），当前 hosted CI 仍以最终 head 回读命令为准。

## Decision Log

2026-10-30 +08 / 实施 owner：Host 检查者提供的实际父链为有界 column flex → display:contents → plugin；因此仅 setup 根使用 flex:1/min-block-size:0/100% 高度，正文有自身 overflow。极短高度正文保留 3rem 最小空间，根 overflow:auto 承担可达降级。未改 Host/body。设置的 key 同时包含 source generation 和 workspace/binding/project；显式 workspace 导航不随晚确认结果翻回设置。仓库原有 unbound 首挂合同由隐藏设置子树保留，工作项容器仍按可读 scope 条件挂载。

2026-10-30 +08 / 综合评审：合并 #482/#483，因为顶部导航、唯一正文滚动、设置子树生命周期同属一次“可达且可逆工作区壳”验收/回退边界。采用 stable hidden subtree，保留 source 权威，不新增 store。#485 在本分支合同稳定后堆叠，原因是其 short-height/task-switch/leave-reopen 验收需要这里的真实生命周期与滚动语义，而非偏好的合并顺序。未批准任何 Planning Status/native dependency 写入。

## Idempotence and Recovery

安装/测试/读取可重复；UI 导航本身零业务命令。probe 先保存当前 diff/commit，逐项变异并精确还原，不覆盖用户改动。失败先留证据，再回到最近通过的批次；外部已接纳工作不可撤销。PR 回退只 revert 本闭环 UI/test/docs 提交，保留数据库、source intent 和用户仓库；回退会恢复原滚动/退出缺陷。C 已合入时先回退 C 或同时评估，不能移除其依赖合同。

## Interfaces and Dependencies

需要 Node≥22、pnpm 10.28.2、现有 React18/esbuild、浏览器操作能力和固定 Host CLI。source subscribe/getSnapshot/commands 不变；外壳仅把父高度约束传给一个正文 scroller。依赖 `getSnapshot` 在发布间稳定；缺 scope 数据时安全降级。#472 未合并的 runtime 机制不自动纳入；若用其更完整 carrier，仅在明确组合检出记录每个 SHA，不能夹带其产品实现进本 PR。

## Outcomes & Retrospective

2026-10-30 +08 / 审阅修复批：在检出 `fix/ui-workspace-shell` 的工作树根执行原 S0 聚焦命令，57/57、0 skip；`pnpm typecheck` exit 0、`pnpm boundaries` 9/9。原 list 入口的真实浏览器 RED（应用为空）与重复 padding RED（15px）分别记录后才修改对应实现。修复后真实 list → 连接设置 → 编辑 PVT_draft → 返回工作区 → 重入，草稿和真实入口回焦保留，无 pageerror；320×360 嵌套 App 实测宽 290、padding 0、内容宽 290，恢复 30px。重跑五个 draft/held repository 生命周期 case、PageDown/wheel/scroll-owner 负对照全部通过；`node scripts/review-mutate.mjs <shell-review-mutants.json>` 的原六项变异全部 KILLED 且还原后基线 GREEN。这里 `<shell-review-mutants.json>` 是独立审阅输入：依次变异 pending 导航、visibility refresh、条件卸载、隐藏焦点、readable 门、same-scope 映射草稿，各由既有具名测试检出；运行态 spec 与原始日志保存在被忽略的任务证据目录。独立 scoped re-review 和最终安装门已通过，见本节最终证据；完整桌面 UAT 仍由 #449 人类接受。

本地实现与 57 个相关契约测试完成，浏览器 carrier 证明真实产品返回/重入保留空项目草稿、mapping 选择和仓库 DOM identity；held repository-account/repository/baseline 离开重入零额外写，隐藏失败未抢焦点。负对照恢复无效返回、pending 导航禁用、导航触发 mapping refresh、条件卸载设置均令具名 shell case RED；精确还原后 GREEN。在 `fix/ui-workspace-shell` 的 `294e8ae`，既有 forms carrier 的 16 个场景（1440×600、1024×400、375×500、320×320；100%/200% 文字；light/dark）经真实 End 操作到达末动作，正文 scrollTop 增长、body 未滚动、无全页横溢出。320×320/200% 正文 clientHeight=90、scrollHeight=4129、scrollTop=4039，局部根以 scrollTop=180 保证降级可达。1024×400 正文 clientHeight=263、scrollHeight=1721；PageDown 与 wheel 都增长 scrollTop。运行时移除正文 overflow/flex 后 bodyTop=0（滚动 owner 合同失效）；还原并加无害 class 后 bodyTop=1458，documentTop=0。最终包/安装/独立验收的结论 Superseded by 下列最终证据（2026-10-30），不能据此声称 R1 接受。无计划内新技术债；若必须延后会影响正确性的工作，先写 `docs/exec-plan/tech-debt-tracker.md` 并更新本节，再判断是否仍满足 issue；#449/R1 人类接受继续保留。

2026-10-30 +08 / 最终工程证据（产品源 `b5eb1bc`）：独立复评确认原 P2/P3 均解决且无新增发现，57 项聚焦测试、9 项 boundaries、typecheck 通过；整合者另跑 `pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-demo-artifact.test.js` 为 39/39、零 skip。相同 Node 26.12.1 / pnpm 10.28.2 / esbuild 0.28.2 的干净 base/head 报告：Host bytes/hash 不变，client +4549 raw / +890 gzip bytes，无新 input/external/dependency；tgz 173300 bytes，SHA-256 `3f9fb09ca9db40984420ef76f37a02f569cb2e98a230ce1810665e635bb49ada`。在 `main` 检出根运行报告工具，source-root 为 `.worktrees/ui-workspace-shell`、out 为 `.superpowers/ui-482-485/shell`，base-report 为 `.superpowers/ui-482-485/base/report.json`；整理后的干净 head 必须重算并核对相同产物字节。

官方 `0.2.0-rc.2` 与 `0.2.1-rc.5` Web profile 均隔离安装该 tgz，11 个非 manifest 文件字节一致，manifest 因包管理器重排只比较语义。28 组设置尺寸/主题/文字组合全部达到末动作，header 返回可见，documentTop=0 且无全页横溢出。rc5 的真实 289 项列表 14 组滚动通过：1440×600 为 clientHeight 512 / scrollHeight 66800 / scrollTop 66288；320×420、200% 文字为 231 / 257040 / 256809，超高末行分段读取且最终底边可见。rc2 的 320×420 列表为 332 / 59636 / 59304。实际 degraded/read-failed、浏览器断网、读取 pending 均能返回安全目的地并保留草稿/回焦；晚确认未把人拉回设置。表格横滚 0→1023、详情正文 0→3106 时外层 scrollTop 保持不变，Escape 关闭并回焦。受控文字放大不称浏览器偏好设置；未改用户 Desktop profile，Web 证据不替代 #449 的精确桌面候选人类接受或 R1。

公开面五类目与机械扫描均在最终提交重新执行；PR #486 只关闭 #482/#483。Project 仅机械回填 ExecPlan/Batch，Status 与 native 依赖未改。交付时继续用 `gh pr view -R SingularityKChen/harness-projects 486 --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`、`gh pr checks -R SingularityKChen/harness-projects 486` 和全部 review threads 核对，当前 head 必需门禁通过后才 ready，未经人类评审不合并。

## Bottom Change Note

2026-10-30 +08：独立综合两份方案并核对源码，补明 scope/hidden focus、映射草稿与真实堆叠合同；建立可执行验收和未运行证据边界。

2026-10-30 +08：实施 S0/S1 并记录可复现的相关契约与负对照证据；S2 安装、远端 head 与独立评审保持未完成。

2026-10-30 +08：补记 `294e8ae` 的 16 场景 DOM geometry、真实 wheel/PageDown 与滚动负对照；最终 artifact/Host/远端检查留给整合 owner，计划保持 active。

2026-10-30 +08：按 `294e8ae` 独立审阅修复 P2 稳定快照与 P3 嵌套留白；记录两项浏览器 RED/GREEN、原 57/9 回归和六项变异，Gate 未改。

2026-10-30 +08：归档工程与隔离安装验收，补齐真实 Host 几何、包增量、独立复评和后续远端门禁；同步导航生命周期产品文档。
