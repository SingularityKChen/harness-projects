# Host 公开能力与插件构建证据 ExecPlan

> 状态：Completed；报告工具与独立复评通过，PR 等待人类评审。
> 创建：2026-10-28；规范：根 `PLANS.md`。
> 范围：检查 Host 公开 exports/theme，比较一个可访问组件备选，并交付同生产配置的 bundle/pack 可复算证据。
> Issue：[同仓 #428](https://github.com/SingularityKChen/harness-projects/issues/428)；分支：`chore/plugin-bundle-evidence`。

## Purpose / Big Picture

后续 UI 决策可以明确回答“Host 实际提供什么”“为何需要或不需要依赖”“插件安装件增量是多少”。
本 PR 交付一个聚焦报告工具、负向检查和正式比较记录；不实现整套 UI toolkit 迁移。
最小成功证据是公开根导出/主题的版本证据，加当前 PR base/head 相同生产配置构建、真实 pack、React 输入图与现有 Loader ABI 验证。
推荐本次不新增 UI 依赖；未构建的备选没有体积数据，不用官方文档或类型声明冒充浏览器交互验证。

## Context and Orientation

`apps/harness-plugin/scripts/build.mjs` 是唯一安装件构建：Host ESM/node22，client CJS/es2022、production define，固定 minify=false/sourcemap=false。
client 必须是一次 `window.__ModuleLoader__.load({ id, factory })`，每半边恰好一个 JS 输出。
构建已返回 `metafiles.host/client`，开启 metadata 且 input 路径相对仓库；报告应消费这些数据，不复制一份 esbuild 配置。
`CLIENT_BASELINE` 已有 React、React DOM 及 `@deepseek-ai/dsh-client-ui-primitives` 根模块；包存在不表示任意 deep import 都能被 Loader 回答。
`tests/integration/harness-plugin-artifact.test.js` 已验证 manifest、pack、Loader、`apply/inject` 和真实 React 渲染，可复用。
公开发行 `@deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2` 的 root types/exports 含 Button、Input、Checkbox、Menu、Modal 等。
同版本 theme 公开说明使用 `--dsw-*` tokens；已检查的名称包括 `--dsw-focus-ring-color` 与 `--dsw-focus-ring-width`。
本次执行要固定公开发行版本及 metadata/tarball integrity，再记录实际 root exports、相关类型和主题说明；不发布本机缓存路径。
取证基线：2026-10-28 的 `main@88d21ae6e0f0afb1f18afc776f54efac3ff4723a`；issue 中更早体积不能当本轮 library delta。
架构依据：`docs/adr/ADR-0009-harness-plugin-installable-artifact.md`、`docs/architecture/harness-host-spike.md`、现有 artifact 测试。
官方依据：[esbuild metafile](https://esbuild.github.io/api/#metafile) 要求消费 JSON metadata；[external](https://esbuild.github.io/api/#external) 说明外置与打入是不同概念。
[React duplicate React](https://react.dev/warnings/invalid-hook-call-warning) 解释 singleton 对 hooks 的影响；manifest 或构建参数不能替代真实图/Loader 证据。
[Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) 是本次比较的 selective accessible alternative，官方说明只证明备选能力，不证明 Host ABI 兼容或大小。

## Design / Spec

### 推荐方案：复用唯一 build，输出真实安装件报告

新增 `apps/harness-plugin/scripts/bundle-report.mjs`，导出可测试的图/字节报告函数，并提供小 CLI。
CLI 以 argv 接收 `--out <dir>`、可选 `--source-root <checkout>` 与 `--base-report <json>`；缺省输出在已忽略的插件 dist 目录。
它将sourceRoot规范化为允许的检出根，以file URL动态import该检出现有 `apps/harness-plugin/scripts/build.mjs` 并调用其 `build({ outDir })`。
每个build模块自己的REPO_ROOT自然定位实际源检出；不增加生产build的sourceRoot参数。报告同时记source head与report工具head，不能声称base已有新CLI。原实现仅以相对 input 与末次身份推断归属的做法，**Superseded by 本节下述入口、起始身份和输出边界规则（2026-10-28）**。
随后对返回的 `packageDir` 执行与 `pack:plugin` 同样的 pnpm pack，并读取真实生成 tarball。
子进程以 argv/library API 调用，不拼接 shell；失败 exit 非零，不拿旧 tarball/report 冒充本轮成功。
报告与metafile写在outDir的package外，不进入安装件files，不增加client chunk/CSS/source map；工作区源码input不得逃逸sourceRoot，否则不能宣称测到了目标检出。
保留原 `pack:plugin` 命令和 module-loader ABI；最终验收仍须单独执行 issue 指定的原生产命令。

import/build 前固定 source HEAD 和完整 porcelain status；pack 后必须逐字一致，否则拒绝成功报告。报告使用起始身份，稳定 dirty 仅作单次诊断且不可 Δ。
实际 build 入口 realpath 必须等于该 sourceRoot 的标准路径，拒绝组件或文件 symlink 重定向。
所有 rm 之前规范化允许输出根，再检查目录、祖先和受控输出子项；先处理 worktree、home、tmp 的系统 alias，不拒绝正常 macOS tmpdir。
拒绝根目录、检出祖先/源码/受保护目录；检出内仅 `apps/harness-plugin/dist/` 或 `.superpowers/`，检出外可用显式独立目录；无效输出须保留外部 sentinel。
这只做前后乐观身份核验，不加锁或复制源快照；调用期间源码/输出必须静止，不声称检测所有瞬时修改后恢复。

JSON 至少含：schemaVersion、观察时刻、git head/base、Node/pnpm/esbuild 版本、实际构建配置指纹。
每半边包含文件名、raw bytes、gzip bytes（固定level=9）、SHA-256、outputs数、相对input图与external imports；esbuild版本从被调用build模块的解析位置读取。
安装件包含 tarball 文件名、实际 bytes、SHA-256；pack size 与 client gzip 是不同字段，不相互替代。
配置指纹取被调用 `build.mjs` 的完整SHA-256、其导出的baseline/external/target及工具链版本，不另写一份esbuild参数。
本PR保持build源码不变；base/head脚本字节与工具链相同才认定配置可比较。脚本不同即保守拒绝Δ，不解析源码猜测等价。
完整 metafile 可留在忽略产物目录；公开报告中的路径只可为仓库相对路径，不能输出账户目录、内部系统、凭据或源日志。
git 信息从显式sourceRoot以argv回读 `rev-parse HEAD`/明确base ref；路径先realpath并核对允许检出根，不fetch、不改分支，不把历史issue SHA写成当前值。

同head两个outDir的JS bytes/hash/gzip与规范化图应一致；报告驱动与直接build同检出也必须一致；tarball按实际pack记录，不预设tar元数据必定可复现。
base/head 比较必须同 Node/pnpm/esbuild、gzip level 与生产 build 配置指纹；不一致则拒绝给 Δ，并说明不可比较字段。
报告给出 client/Host raw、gzip 与 pack 的绝对值及各自 Δ，保留 input/external 差异定位增量来源。
`+20 KiB client gzip` 是选型评估目标，按 `20 * 1024` bytes 解释；不是新增 CI/R1 硬门禁。
选择零新依赖时仍实际计算 base/head 差值；不能把“没加 dependency”当作测量结果。

React 检查消费真实 `metafile.inputs` 的模块/包根；client 图不得打入 react/react-dom 实现，包括 pnpm nested 路径和 deep import。
外置 React imports 必须在已有 CLIENT_BASELINE 精确键内；一个打入副本也应失败，不等待出现两个版本。
Host 图单独报告其 React 输入；当前预期为空，出现则明确失败/调查层边界，不能因 client external 参数正确而忽略 Host 图。
保持已有 singleOutput、外置白名单与 workspace specifier 闸门，不另建第二套不一致的 ABI 判断。
现有 VM 测试继续验证一次 load、正确 package id、factory require、`apply/inject`，并使用同一个真实 React 实例渲染。
图检查证明所识别 React 包未打入；不声称可识别任意第三方文件中重新打包/改名的 React 源码。

### 公开能力比较与本次选择

比较对象是已有详情交互所需的 button/input/modal 基础能力，先对照公开 root types、exports 和主题 token。
Host primitives 已是 Loader baseline，主题由 Host 应用；使用公开入口与 CSS token 的后续采用可避免新增框架状态。
theme 包本身不在 CLIENT_BASELINE，不能因为它公开发行就新增任意 runtime require；这里只记录其 CSS 契约。
备选是单独 `@radix-ui/react-dialog`，官方提供受控 open、焦点/键盘等低层行为，插件还需承担样式、主题与版本回归。
当前没有已证明必须靠新组件包补齐的需求，故本次保留现有 UI、采用 Host public primitives/tokens 优先原则，不增加依赖。
记录 Host peer 更新时必须回读 root exports/type/token 的维护成本，以及 Radix 增加 transitive graph、React/Loader 和交互验证的成本。
未构建 Radix 方案不填估计 gzip 数字；未真实运行 Host Modal 不宣称其完整 a11y、焦点或背景隔离已通过。

### 拒绝方案

拒绝复制 esbuild 参数的独立 benchmark：配置漂移会使数字不能比较。
拒绝先安装全套 UI 库再量：本 issue 只做能力和构建证据，没有新增 dependency 的具体需求。
拒绝强制实现两个 modal 再做全套浏览器审计：超出原验收；后续真正采用组件时再验证该交互。
拒绝只 console 一次体积或只用 `pnpm why react`：没有可保存原始图、pack 与负向检查，不能证明当前 artifact。

## Global Constraints

代码、测试、配置增删严格 `<800`，文档 `<1300`；以真实判别测试与单一职责为准，不按初估行数机械拆分。
不改 production runtime/client external 表、依赖/lockfile、UI 行为、数据库或 Provider；确有需求才重新收敛依赖决策。
不修改生产build源码或minify/target/format/define/splitting等配置；sourceRoot只选择被调用build模块，不得隐式从另一个checkout解析workspace包。
本 PR 独占文件集合：

- 新增 `apps/harness-plugin/scripts/bundle-report.mjs`；`build.mjs`只读复用，不列为修改文件。
- `apps/harness-plugin/package.json`（只加 `bundle:report` 脚本）。
- 新增 `tests/integration/harness-plugin-bundle-report.test.js`；现有 `tests/integration/harness-plugin-artifact.test.js` 仅复用必要 ABI 断言。
- 新增 `docs/development/plugin-bundle-evidence.md`，本 ExecPlan。

与 #365/#367 不共享产品代码/测试写区；`docs/README.md` 由整合 owner 串行索引，其他 development index 本次无需扩展。
不改 Status、Iteration、原生依赖，不自行合并或安装到用户运行中的 Host profile。

## Plan of Work

所有命令均在检出 `chore/plugin-bundle-evidence` 的工作树根运行，对应 `.worktrees/plugin-bundle-evidence`。

### Batch 1 · 聚焦报告与负向闸门

最小闭环：生产 build/pack 的真实字节与 graph 形成可保存报告，坏图和不可比较数据不产生成功结论。
主文件：`apps/harness-plugin/scripts/bundle-report.mjs` 与 `tests/integration/harness-plugin-bundle-report.test.js`。
- 先写 RED：报告缺失；synthetic react/cjs 与 nested react-dom 输入应拒绝；缺 tarball、双输出或错误 external 不得成功。
- 实现复用 build、实际 pack、固定 gzip、配置指纹、相对图和 JSON；错误不发布陈旧成功报告。
- 真实构建验证两个 outDir 的 JS/graph 一致；报告字节用读取文件及 gzip 重算对照，不锁具体易变大小常量。
- base-report 配置或工具链不同应拒绝 Δ；报告中任何本机绝对路径应使检查失败。
- 复审修正：先 RED 重现 dirty→clean、same-tree HEAD 漂移、跨检出 build symlink、输出 leaf/ancestor symlink sentinel 和源码重叠；补前后身份/入口/输出三道局部守卫后 GREEN。
验证：`pnpm test:file tests/integration/harness-plugin-bundle-report.test.js tests/integration/harness-plugin-artifact.test.js`。
期望：新增判别测试先 RED 后 GREEN，现有 Loader/manifest/实际 React 渲染继续通过。
回滚点：本批 patch；撤回恢复原构建，无运行态数据或 UI 变化。

### Batch 2 · 公开 API 比较与同配置基线/head证据

最小闭环：当前 PR 的可复算结果支持明确选择和成本说明。
主文件：`docs/development/plugin-bundle-evidence.md`。
- 固定公开 Host 三包的 `0.2.0-rc.2` 版本/integrity，检查 package exports、root types/README；只记录实际支持的符号/token。
- 对同一基本需求比较 Host 与 selective Radix，写选择、拒绝项及维护成本；明确未构建备选与未运行交互的证据边界。
- 由整合owner准备PR实际base的只读检出 `.worktrees/plugin-bundle-base`，依赖须解析到该检出；用同一个当前report工具动态调用各自已有build，确认build脚本hash/工具链一致，保存忽略产物与source/report工具上下文。
- 当前 head 执行原 `pack:plugin`，核对 tarball 的 payload、manifest、无 report/metafile 混入和零 bundled React。
验证：在 `chore/plugin-bundle-evidence` 根执行 `pnpm --filter @harness-projects/app-harness-plugin bundle:report`，期望当前head报告成功。
比较例外上下文：在包含两个检出的仓库根执行 `node .worktrees/plugin-bundle-evidence/apps/harness-plugin/scripts/bundle-report.mjs --source-root .worktrees/plugin-bundle-base --out .superpowers/plugin-bundle-evidence/base`。
同目录执行 `node .worktrees/plugin-bundle-evidence/apps/harness-plugin/scripts/bundle-report.mjs --source-root .worktrees/plugin-bundle-evidence --out .superpowers/plugin-bundle-evidence/head --base-report .superpowers/plugin-bundle-evidence/base/report.json`，期望同配置Δ可计算。
验证：`pnpm --filter @harness-projects/app-harness-plugin pack:plugin`；期望报告与真实 pack 均 exit 0，两个半边各一输出。
验证：`pnpm verify`、`pnpm run boundaries`、`node scripts/workflow-check.mjs`；构建/配置边界变化需完整本地门禁。
回滚点：本批记录可独立撤回；保留诊断产物，不覆盖用户 Host 或删除用户数据。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 实际 Host root exports/theme | 固定版本与 integrity；public exports/root d.ts/README中真实符号及 token |
| 比较一个 selective accessible alternative | Host vs Radix 同需求、选择/拒绝/维护成本；未测内容明确写未测 |
| 同配置 client/Host raw 与 gzip | 文件实读、level=9 重算、实际 options 指纹、base/head/toolchain 一致 |
| input graph 与 duplicate React | 两半边真实 metafile；单个 bundled React/nested react-dom 负例会失败 |
| 真实安装包 | pack:plugin 当前 head exit 0、实际 stat/hash、manifest/payload 无报告混入 |
| single output / Loader ABI | 原 artifact VM 一次 load、准确 id、外置白名单、apply/inject与真实 React 渲染；重复 load/未知 require 负控 |
| +20 KiB 目标语义准确 | report Δ 用 client gzip 独立字段，不升级为 R1 gate，不填未测候选数字 |
| 可复算与诚实失败 | 两 outDir 重算一致；身份漂移/入口重定向/不安全输出拒绝；合法输出失败无陈旧成功报告，外部 sentinel 保留 |

交付前执行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`，人工检查公开面五类目和严格用户规模。
提交按两份有意义记录收敛：整合 owner 先提交方案/计划并开 draft；实现者只作一个本地未推送能力提交，独立验收修复收敛入它，最终由整合 owner 补证据/索引后 fast-forward push。
PR 必须 `Closes #428`，给出计划 + Batch、实际 current head/base结果、维护代价、风险与回滚；本地测试不冒称 hosted CI。
最终 push 后用 `gh pr view -R SingularityKChen/harness-projects chore/plugin-bundle-evidence --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup` 和 review threads 回读，符合门禁才 ready，人类决定合并。

## Progress

- [x] 2026-10-28：独立核对两设计，确认 build 已有 metadata、Loader 测试与真实公开包根能力。
- [x] 2026-10-28：Batch 1 已实现；RED 日志保存在运行态 SDD 目录，新增图/pack/config/sourceRoot/dirty 负控与原 Loader/React 契约 GREEN。
- [x] 2026-10-28：Batch 2 已实现公开发行能力、Host/Radix 成本比较和生产 build/pack 测量；clean base 的两份 JS 与 head payload 相等，完整 clean head 复算由本地能力提交后执行。真实数字、工具链、hash 与边界见 `docs/development/plugin-bundle-evidence.md`。
- [x] 2026-10-28：初轮本地 `pnpm verify`（typecheck、2352 tests、7 MVP0）、boundaries（9）、workflow-check（8 workflows）与原 `pack:plugin` 通过；本地证据不代表 hosted CI。初轮验收完毕的结论 **Superseded by 独立复审三项缺口与 fix round 1（2026-10-28）**。
- [x] 2026-10-28：fix round 1 精确 RED 为 11 tests/5 fail；新增五项反例后 focused 36/36 GREEN，完成三道局部守卫。最终 `pnpm verify` 的 typecheck、2357 tests 与 7 MVP0，以及 boundaries 9、workflow-check 8、原 pack 均通过；能力提交 amend 后在 clean HEAD 再测 base/head，并交同一 reviewer 复核。

- [x] 2026-10-28：三项独立发现修复后复评 PASS；精确反例、正常 clean 报告及 36 项聚焦复跑通过，计划归档。

## Surprises & Discoveries

- 2026-10-28：build 已返回两份 metafile，新增报告无需另起 bundler 或复制配置。
- 2026-10-28：primitives root 已在 Loader baseline，但 theme 包本身不在；公开发行和 runtime可 require 是不同事实。
- 2026-10-28：原验收只要求比较与证据，双候选 UI 迁移/全量浏览器 a11y 不构成本 PR 的隐含前提。

- 2026-10-28：本机 pnpm 发行 shim 无 shebang；Node `execFileSync` 返回 ENOEXEC，shell 手动调用却成功。报告仅在此错误下解析 shim realpath 并以 Node 执行其相邻入口；测试通过显式 stub 路径注入 pack 失败，不改全局 PATH。
- 2026-10-28：dirty head 的字节虽然与 clean base 相等，不能作为提交比较证据；compareReports 现拒绝任一 dirty source，避免方案提交 SHA 被错误归因。

- 2026-10-28：独立复审确认末次 clean 不代表构建起始 clean；相对 input 存在也不证明实际 import 所属检出；未经规范化输出的 rm 可沿目录 symlink 越界。反例已作为自动临时 registered fixture 测试，不依赖私有预建 worktree或网络安装。

## Decision Log

- 2026-10-28 / 计划评审者：选择复用生产 build 的聚焦 helper，文件范围见 Global Constraints；固定 level=9，同配置才能比较。
- 2026-10-28 / 计划评审者：本次不增加依赖，Host public primitives/tokens 优先；Radix只作有来源的备选成本比较。
- 2026-10-28 / 计划评审者：图检查+现有 VM/artifact验证组成证据，不把 private source/deep import包装成公开ABI。
- 2026-10-28 / 计划评审者：用同一个report工具与显式sourceRoot动态import各自已有build，避免base无CLI或错误测成head；生产build API/源码均无修改，脚本hash不同时保守拒绝Δ。
- 2026-10-28 / 计划评审者：+20 KiB 是评估目标；不修改父 issue #427、R1、Status/Iteration/依赖，未授权合并或真实 Host 安装。

- 2026-10-28 / 实现者：保留零新增依赖与生产 build 原字节；clean source 才可参与 Δ，dirty 单报告仅提供诊断。复用原 VM helper 验证 Loader 负控，不增加第二套产品 ABI 闸门。

- 2026-10-28 / root 批准、实现者执行：接受 F1/P1、F2/P1、F3/P2；只补固定起始身份与末次复核、入口 realpath 等同、清理前输出边界，不扩建快照/锁平台、不改 production build。修正集中 amend 到未推送能力提交，先建 backup ref，保留方案+能力两份有意义提交。

## Idempotence and Recovery

相同检出、工具链与配置可反复在独立 outDir构建；输出覆盖只限明确构建目录，不访问用户 profile。
先清本次报告成功标记，全部 build/pack/分析成功后原子写报告；失败保留诊断但不能复用旧成功状态。原无条件先清理流程 **Superseded by Design / Spec 的清理前输出检查（2026-10-28）**；不安全输出不执行删除，合法输出的失败仍清除旧成功状态。
pack tar元数据不稳定时分别报告 payload与tar真实hash，不能为凑可重现删除事实。
撤本 PR 恢复原构建脚本；没有数据库/Provider/运行时状态写入，不需要数据迁移或反向清理。

## Interfaces and Dependencies

只使用既有 esbuild、Node fs/zlib/crypto/child_process、pnpm、Git argv与当前 build API；不安装新组件库。
官方公开包 metadata用于能力证明，公开报告不包含本机实际路径；完整原始构建图留忽略产物目录。
技术债务边界：未来采用组件的真实 Host焦点/键盘/主题验证、第三方已重新打包的React识别均不在本 issue，不能宣称已覆盖。

## Outcomes & Retrospective

报告通过各检出自己的生产 build 获得两份 metafile、raw/gzip/hash 与实际 pack，拒绝源逃逸、React 打入、异常输出、失败 pack 和不兼容/dirty 比较。初轮未识别身份漂移、build 重定向与输出清理越界，因此不能视作独立验收完成；**Superseded by 本计划 fix round 1 的三道守卫与 scoped re-review（2026-10-28）**。公开发行能力与 Radix 维护成本已记录，本次选择零新依赖。base/head client gzip 均 37221 bytes、Host gzip 均 107895 bytes、pack 均 159301 bytes；clean head 的提交上下文由能力提交后 JSON 回读，不能把 dirty 预览归到方案提交。

`+20 KiB` 仍为候选选型目标，无 UI 迁移、真实 Host/a11y 或 hosted CI 声称。可识别 React 输入图、VM 与静态渲染的边界保持明确；父 UI issue 和 R1 均未据此闭合。独立复评与归档索引已完成；最终 PR head/base/checks/threads 和关闭引用以命令回读，通过后 ready，未经人类决定不合并。

## Bottom Change Note

- 2026-10-28：首次创建；收敛公开能力比较、生产同配置报告、真实 pack及React/Loader证据边界。

- 2026-10-28：补充实际报告/pack/公开能力记录、sourceRoot/dirty/config/React/Loader 负控和 pnpm shim 事实；完成本地验收并明确提交后 clean 复算及整合边界。

- 2026-10-28：依据独立复审 F1/F2/F3 补精确 RED→GREEN、固定起始身份、真实入口和清理前输出边界；就地标注初轮归属/完成结论被推翻，保留正常路径测量与无锁边界。

- 2026-10-28：独立复评 F1/F2/F3 全部 ADDRESSED 后归档；最终产品组合在独立集成检出通过 2442 + 7 与类型检查，报告来源与路径清理边界保留明确限制。
