# 原生 Node 测试的工作树解析隔离 ExecPlan

> 状态：原始 #399 批次 Completed；P1 follow-up 补丁已本地验证，待独立复评与协调者整合
> 创建：2026-10-22
> 范围：issue #186；在直接 Node 文件、目录和 layer runner 内强制同工作树解析，并检测包内/测试内 shadow。
> 规范：`PLANS.md`、`AGENTS.md`、`docs/development/workflow.md`；交接为 #186 的 2026-10-22 评论与 TD-088/089。

## Purpose / Big Picture

在嵌套工作树缺少安装、或子目录残留 node_modules 指向别的检出时，任何仓库受管测试入口都应先失败并给出修复指引，不能对别的分支代码取红/绿证据。正常安装的单检出 CI 和本地检出无需特别配置。

最小证据是临时外层已安装、内层未安装布局中的原生 `node --test <file|dir>`、`node <file>`、layer runner 均失败，外部模块顶层 marker 未执行；内层正确安装但 package/src 与 tests 目录 shadow 同样被拒绝。

## Context and Orientation

事实：#391 已交付五个 pnpm 入口的根级 `scripts/resolution-check.mjs`，它从脚本自身锁定检出根、对根 devDependencies 的工作区包做 realpath 校验。它不能覆盖直接 Node 或包内/测试子目录 shadow；#186 与 TD-088 仍开放。

事实：现有 workspace 根 exports 为无条件字符串，`tests/contract/resolution-check.test.js` 保护此条件；因此 `createRequire(...).resolve` 当前能定位同一入口，未来根条件导出须同时调整守卫。Node engines 接受 22.0，不能假定新版本 hooks/global setup 可用。

术语：shadow 是更靠近导入者的 node_modules 目录或软链，使同一裸包名优先落到另一份代码。“解析边界”是 node_modules 父目录或 package self-reference 所属 package scope，可能改变裸名的解析结果。

观察基线：2026-10-22 `main@6aa6592` 有 110 个受管 `*.test.js`；执行时按目录重新发现，不能把该数量写成新测试的白名单。

假设：首个 preflight 可在外部产品模块 body 执行前失败，相关解析边界扫描的成本可接受；Batch 1 原型和最终 wall time 将分别证伪这两个假设，不能把它们当成已验证事实。

## Design / Spec

独立设计 A/B 均比较逐测试入口 preflight、外层哨兵、loader/hooks 与产品包内守卫。reviewer 选择逐入口首个相对 side-effect import，加解析边界扫描和 runner 显式调用：不依赖外层安装状态、不提高 Node 版本、不把测试环境判断放入产品运行时。

保留根守卫 CLI，增加可复用的抛错断言；测试 preflight 只依赖 Node 内建模块及该脚本，从自身 URL 取得检出根。守卫失败必须抛错阻止模块求值，不能只设置 exitCode 后继续运行测试。CLI 捕获后按既有 `resolution-check:` 前缀、落点和安装指引退出 1；成功静默。

每个受管 `tests/**/*.test.js` 的第一条实际 import 都是相对 preflight。既有注释保留，其后才导入工作区包；在现有 resolution contract 中机械检查接线，新增文件遗漏即红。`scripts/run-test-layer.mjs` 的 CLI 在启动子进程前调用同一脚本断言，作为被 import 的库时不触发整仓前置；保留空层/零断言 fail-closed 语义。

扫描 root、仓内所有相关 package scopes（含 workspace 包），以及 `packages/`、`apps/`、`tests/`、`scripts/` 中每个相关 node_modules 的父目录。发现 node_modules 后登记其父解析上下文、不递归依赖树；包含任意深度 package/src、tests 子目录与 node_modules 软链。其余源码遍历遵循现有 source-tree 的构建产物边界，不另抄剪枝名单；相关源码目录软链必须明确拒绝或规范化后有界遍历，不得因 dirent 非 Directory 静默跳过。

> 包内剪枝边界 Superseded by Batch 4（2026-10-22）：静态源码入口仍复用 source-tree 剪枝；实际绑定的 workspace packageRoot 复扫全部包内潜在解析上下文，包括 dist/build 及源码相对导入这些目录。两种遍历分别去重，不能因静态首遍已访问而漏掉复扫；node_modules 只登记父上下文，不展开第三方依赖树。不用导出入口所在目录猜测传递导入可达性。

对每个边界用 createRequire 发起根 manifest 中所有工作区包根名及 canonical manifest 声明的精确子路径解析，再 realpath；用 `path.relative` 或带分隔符的规范根包含判定，拒绝 sibling 同名前缀、外指软链、无法解析、坏 manifest、空包名单和不可读边界。package self-reference 边界另检查，不能仅检查 root 或仅枚举已有 node_modules。canonical manifest 与每个上下文实际命中的 workspace 包均只接受精确无条件导出；条件、数组、通配形状明确失败闭合，避免 require 本地而 import 外指。根内复制 shadow 包也受该前提约束，不递归第三方依赖树。

先用小临时原型证明首 import 抛错发生在外部被测模块 body 前，以及 src 深层 shadow 可被发现；原型不过不展开全仓接线。每个 worker 重复扫描只允许同进程缓存，不使用跨进程/落盘缓存；记录单文件与全套耗时，发现成本问题优化重复上下文，不删覆盖范围。

外层哨兵确实能阻断原始未安装场景，但依赖安装/清理生命周期且不能覆盖已安装内层的 shadow，因此不作为完整闭环。hooks 必须预先注册，`--import`/NODE_OPTIONS 又不能自动覆盖无 flags 命令；产品包内守卫污染运行边界，均不采用。

官方依据：[Node22 createRequire](https://nodejs.org/docs/latest-v22.x/api/module.html#modulecreaterequirefilename)、[Node 包解析](https://nodejs.org/api/packages.html)、[registerHooks](https://nodejs.org/docs/latest-v22.x/api/module.html#moduleregisterhooksoptions)。这些支持指定解析上下文与条件前提，不替代本仓 direct Node/marker 反例。

## Global Constraints

工作分支 `test/worktree-module-isolation`，隔离位置 `.worktrees/worktree-module-isolation`。命令均在此分支工作树根目录；远端命令带 `-R SingularityKChen/harness-projects`。

P1 follow-up 仅在 `fix/native-export-resolution` 分支、以 `f85568ff340763e83171888f00d2ea48032be2af` 为基线准备；不修改原 #399 工作树，不 push、merge 或向 GitHub 回复。独立复评后由协调者整合至原 PR，并按人类已授予的授权重新变基和完成发布/合并门禁。

协调者已按人类“本会话接手 #399（推荐）”的直接答复接手原分支，将隔离补丁整合到真实 `main@8b742977` 后；发布、作者回复和 rebase merge 由协调者执行，以新 head 独立复评、CI 和全部线程回读为前置。前段“不修改原分支、不发布”仅约束隔离 proposal。

唯一改动集合：`scripts/resolution-check.mjs`、`scripts/run-test-layer.mjs`；新建 `tests/fixtures/resolution-preflight.mjs`；必要的 `tests/fixtures/source-tree.mjs` 遍历接口；所有受管 `tests/**/*.test.js` 的首 import（既有正文只改 `tests/contract/resolution-check.test.js`、必要时 `tests/contract/run-test-layer.test.js`）；`tests/README.md`、`docs/product/vertical-path.md`、`docs/architecture/release-gates.md` 的运行方式/守卫边界说明；本计划及完成态、自身索引短行、tracker TD-088/089 行；评审收尾的 `docs/review/pr-399-mmp-review.md` 与 `docs/project-management/merge-queue.md`。

代码含测试 churn 严格小于 800、文档小于 1300；不删除或挪动真实 node_modules，不写用户工作树哨兵，不升级 engines，不修改产品包 exports 或运行时。#233 修改已有整合测试正文，#363 修改既有测试路径字符串；本 PR 对这些文件只加首 import，禁止整文件覆盖。每 PR 独立可验收，不引用另两 PR 尚不存在的文件。

## Plan of Work

### Batch 0 · 设计固定与 draft

最小闭环：显式入口和上下文边界已独立审查，计划先成为 draft 的可审阅产物。主文件是本计划。

协调者先提交计划、建立含 `Closes #186`、ExecPlan + Batch、验证和回滚的 draft，补齐元数据并回读。`gh pr list -R SingularityKChen/harness-projects --head test/worktree-module-isolation --state open --json number,isDraft,baseRefName,headRefOid,closingIssuesReferences` 期望一条 draft、base main、关联 #186。完成后开始 TDD；回滚点为仅计划提交。

### Batch 1 · 证伪原型与红基线

最小闭环：真实违规解析可被测试检测，且首 import 方案具有先行失败能力。主文件是既有 resolution contract。

在测试独占临时目录中创建外层 installed/内层 bare 夹具，外部包 body 写 marker；旧实现直接 Node 会执行 marker/退出 0，新增用例因此红。覆盖文件 script/--test、integration/e2e/mvp0 目录、layer runner；另造 root 全本地但 package/src/node_modules 与 tests 子目录外指的反例。合法内层必须执行自己的 marker，防止“全部拒绝”假修复。

验证：`pnpm test:file tests/contract/resolution-check.test.js`；记录违规用例在旧实现上的失败。小原型首 import 抛错后外部 marker 必须不存在，src 深层 shadow 必须被命中，才进入下一批。回滚只移除新增夹具/用例，不触碰实际安装。

### Batch 2 · 统一断言、上下文扫描与全部入口

最小闭环：受管每个测试文件与 runner 的原生 Node 启动均先经过同一守卫。主文件是守卫、preflight、runner 与首 import 接线。

实现 Design 的边界发现与规范落点检查；补充同名前缀兄弟目录、根别名软链、合法根内软链、外指/悬空边界、NODE_PATH、缺包和坏 manifest。保留现有条件导出前提契约。给全部受管文件加相对首 import，契约临时漏掉一个新文件接线必须红；清除变异再绿。

验证：`pnpm test:file tests/contract/resolution-check.test.js tests/contract/run-test-layer.test.js` 期望 fail 0。正常检出运行 `node --test tests/contract/domain-enums.test.js`、`node tests/contract/domain-enums.test.js`、`node scripts/run-test-layer.mjs tests/integration 'workspace-local test evidence'` 均退出 0；同命令违规夹具非 0、有安装指引、外部 marker 未执行。回滚本批恢复 #391 的原五入口保护。

### Batch 3 · 文档边界、性能与交付

最小闭环：文档实际命令、直接入口保护和交付证据一致。主文件是测试说明、两份既有运行文档与债务对应行。

保留故意无 `--test` 的前缀回读命令：有效前缀须出现具体用例且计数至少 1，伪造前缀须计数 0；文件自身 preflight 在两者中均执行。普通取证可推荐 pnpm，但不把前置 wrapper 当作直接入口证据。仅在所有 direct/shadow 矩阵通过时解决 TD-088；两文档原命令自动受保护且零匹配反例保持时解决 TD-089。

记录正常单文件与全套实际 wall time，核对扫描边界数；运行 `pnpm verify`、`pnpm run boundaries`、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs size origin/main`、`node scripts/rule-checks.mjs disclosure origin/main`、`git diff --check origin/main...HEAD`，期望全部退出 0，并人工确认本批严格预算。

未参与实现者独立验收并按根因做必要重构，重构后重跑有效门禁。整理临时提交，已推历史改写前建 backup ref 和精确 lease；最终 push 后回读 head/base/checks/issue 关联与全部 threads，当前 head 通过才 ready。完成计划归档并更新自身索引；保持 PR 未合并。整体回滚没有数据/Provider 迁移。

### Batch 4 · PR #399 P1 运行时解析边界修复

最小闭环：实际绑定到根内 workspace shadow 后，若该包的导出入口、精确子路径或源码相对传递导入进入 `.gitignore` 忽略目录，preflight 仍须在外层模块 body 执行前拒绝外指；同形目录内链接到本地包时必须允许真实 marker 执行。

根因：静态源码发现用 `ignoredDirectoryNames` 剪枝是正确的；实际消费的 workspace 包会产生 Node 解析上下文，不能沿用这份剪枝结果。修复保留静态入口的原剪枝，并在 `packageSpecifiers` 确定实际命中的 workspace packageRoot 后，以独立访问集合扫描该包的全部内部目录；每个 `node_modules` 仍只登记其父解析上下文，不递归第三方依赖树。

红绿夹具复用 `managedFixture`：根内 `tests/node_modules` shadow 的根 export 指向 `dist/index.js`；canonical root export 不变、shadow 精确 `./values` 指向 `build/values.js`；另覆盖 shadow `src/index.js` 相对导入 `../dist/index.js`、再裸导入 `@harness-projects/bar`。每种先用外层 bar marker 确认拒绝，再将同一链接改为 inner bar 并确认本地 marker 执行。未消费包的无效 `dist/package.json` 正控仍保持静态剪枝语义。

验证：`node --test --test-name-pattern='已消费 shadow' tests/contract/resolution-check.test.js`；`node --test tests/contract/resolution-check.test.js tests/contract/run-test-layer.test.js`；`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` 生成 ignored `apps/harness-plugin/dist` 后运行 `node scripts/resolution-check.mjs` 与 `pnpm verify`。回滚只撤销此 batch 在守卫、contract 与本计划中的修改；原 PR 分支与 base 不变。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 原始未安装嵌套复现被挡住 | 原生文件 script/--test 均非 0、有修复指引且 outer body marker 未执行 |
| 目录与 runner 不绕过 | integration/e2e/mvp0 目录和 layer runner 临时布局矩阵失败 |
| root 通过但 nested shadow 被拒 | tests 子目录、package/src 任意深度边界、软链外指反例 |
| 正常 CI/检出可用 | 合法内层执行自己的 marker；真实正常命令与 pnpm verify 全通过 |
| 新测试不会漏接线 | 全目录发现首 import 契约；临时漏接线新文件变异为红 |
| 前缀语义与成本明确 | 有效前缀≥1、伪造前缀0；单文件与全套 wall time 有记录 |
| P1 被修复且不收窄入口语义 | 根 export / 精确子路径 / src→dist 传递三类外指 marker 均在外层 body 前被拒；同形本地 marker 通过 |
| 静态剪枝与运行解析边界分离 | 静态 source visit 的 `.gitignore` 剪枝保持；真实 `pack:plugin` 的 dist 产物存在时守卫与完整验证通过 |

## Progress

- [x] (2026-10-22 SGT) 两独立设计与第三方审查已选择入口 preflight 加解析边界扫描。
- [x] (2026-10-22 SGT) Batch 0：计划提交、draft #399 与 #186 双向关联和元数据回读，由协调者确认。
- [x] (2026-10-22 SGT) Batch 1：首 import 抛错原型退出 1 且 external marker 不存在；`pnpm test:file tests/contract/resolution-check.test.js` 25 条中 11 条预期红，合法六入口控制通过。原生完整红基线 1900 条、1889 pass / 11 fail，32.722 s；普通单文件 0.424 s。
- [x] (2026-10-22 SGT) Batch 2：110 个受管测试首 import、统一断言与 runner CLI 守卫已实现；原生六入口、两类深层 shadow、自引用 scope、源码软链子路径反例通过。遗漏新测试、删除自引用 scope、跳过源码软链、删除 runner 守卫四项变异均红。
- [x] (2026-10-22 SGT) Batch 3 本地部分：文档运行边界、前缀正反对照、TD-088/089 与性能已核对；最终定向 49/49，`pnpm verify` 三层 1907/1907 与 MVP-0 7/7；boundaries 9/9、workflow-check 8 文件通过。
- [x] (2026-10-22 SGT) 独立验收发现并修复两类 P1 假绿：实际 shadow 清单定位（含共享 require 入口）和已消费 workspace shadow 内的深层解析边界；均先红后绿，合法同形控制保留。定向 53/53、完整 `pnpm verify` 1911/1911 加 MVP-0 7/7；七项归因变异全部 KILLED。
- [x] (2026-10-22 SGT) Batch 3 交付准备：独立验收与归档完成；最终 head 的外部 CI、关联和 ready 按 Outcomes 的命令回读。
- [x] (2026-10-22 SGT) P1 repair TDD：根 export、精确 subpath 与 src→dist 传递导入三例在旧遍历上 3/3 红，均观察到外层 marker 执行；实际 packageRoot 遍历后 3/3 绿、外层 marker 未执行、本地 marker 执行。
- [x] (2026-10-22 SGT) P1 repair 验证：定向 contract + runner 56/56；真实 plugin pack 生成 dist 后 resolution-check 成功，完整 verify 1914/1914 + MVP-0 7/7；node_modules 依赖树未展开。
- [ ] P1 repair 后续：交由另一评审者独立复评；由协调者整合回 #399 并在真实新 main 上复锁所有门禁。本 proposal 尚未发布。

## Surprises & Discoveries

2026-10-22：根守卫通过不证明所有导入者通过；TD-088 已有包内 shadow 的实际反例。Node 的 hooks 还需要注册且最低版本不满足无条件可用，故不能用根 preflight 或新 flags 冒充原生命令闭环。

2026-10-22：既有文档前缀回读故意直接执行测试文件；机械改成 `node --test` 会丢失零匹配对照。此次通过文件首 import 保护它，保留原回读语义。

2026-10-22：夹具在 foo/src 中 shadow foo 会被 foo 的 package self-reference 优先级遮住，不能证明外部加载；改为 foo/src 深层真实导入 bar，并配置 bar 外部 marker。同样覆盖 tests 深层实际导入者。正常树只有 root 加 18 个包 scope，共 19 个解析上下文，不为每个源码目录重复 resolve；最终 canonical 名单为 18 个根入口加 6 个现有精确子路径，共 24 个 specifier。

2026-10-22：通过 Python subprocess 启动全局 pnpm 会选中 11.25 并触发自动依赖检查，测试尚未开始就报无 TTY；直接通过执行 shell 调用仓库锁定的 pnpm 10.28.2 后取得预期红基线。未改动真实 node_modules，未以 CI 标记允许重装。

2026-10-22：额外反例证明不可读 node_modules 可能被 Node 跳过，随后从父目录解析到本地包而假绿；`node --test --test-name-pattern='不可读 node_modules' tests/contract/resolution-check.test.js` 先红 1/1，加入 R_OK 和 X_OK 检查后通过。所有临时包显式 type=module，使 marker 夹具不依赖新版 Node 的语法检测。

2026-10-22：根内复制的 shadow 包可让根入口本地、已声明 values 子路径软链外指；仅拒绝源码软链仍会在未递归的依赖目录漏过。追加反例先红（outer-marker=true），再按 canonical 精确导出扩展同一 realpath 检查。后续反例证明 shadow 的 require 本地 / import 外指条件也需显式拒绝；该用例同样先红后绿。

2026-10-22 / 独立验收：从 require 入口向上找首个同名 manifest 会误认入口内的嵌套清单；按入口文件缓存验证还会跳过 require 共用同一本地文件的另一份条件 shadow。原生 script / --test 均复现退出 0 且外部 marker 已执行。清单定位改为调用方最近 package scope 的 self-reference 或真实 node_modules 候选；删除按入口去重，合法嵌套同名清单仍通过。

2026-10-22 / 独立验收：仅扫描原始源码树会漏掉实际已消费的根内复制 workspace shadow，其 src 深层 node_modules 仍可外指。反例先红后，将实际绑定包根交给现有有界扫描并动态登记上下文；访问集合去重，包根必须在本检出内。没有展开未消费的第三方依赖树，正常树仍为 19 个上下文。

2026-10-22 / P1 follow-up：`dist/` 与 `build/` 是静态源码扫描的忽略目录，但当 shadow package 的 exports 或相对导入链实际进入这些目录时，里面的 `node_modules` 会改变 Node 解析结果。复用实际 packageRoot 扫描全部包内目录可覆盖根出口、subpath 与传递进口，同时保持对 node_modules 内容树的剪枝；pack:plugin 后完整 verify 为 positive control。

## Decision Log

2026-10-22 / 独立计划审查者：选择逐文件显式接线与边界扫描，接受广文件但每处一行的变更。理由：在当前 Node 版本满足直接入口和 shadow 两个必要条件；拒绝仅覆盖原始场景的外层哨兵与产品运行时判断。

2026-10-22 / 用户启动授权：点名开始 #233/#363/#186 允许对应 Status 进入 In Progress；本计划仅对应 #186，不包括 In Review / Done 或依赖关系写入。协调者记录外部 actor、目标、幂等键和结果。

2026-10-22 / 协调者回读：draft #399 base 为 main，初始 head 为 `caf5e96`，双向 issue 关联已确认；Project Size 按修订范围机械调为 M，Status 保持 In Progress。外部写入 actor、目标、幂等键和 ack 留在本工作树运行态台账；最终 head 仍须独立回读。

2026-10-22 / 实现者：拒绝相关源码文件和目录软链，保留根别名与根内 node_modules 软链；该边界同时覆盖现有 `domain/values`、`client/keys`、`client/delivery` 导出目标的软链逃逸，不新增 AST、loader 或产品运行时逻辑。根与精确子路径无条件导出的前提须保持；canonical 与 shadow 上遇到新的条件、数组或通配导出均失败闭合。

2026-10-22 / 协调者补充裁决：批准检查当前已存在的精确 exports 子路径；同一上下文里的 root 本地不能替代子路径落点。复用 canonical manifest 声明与已有上下文，且校验实际命中包的导出前提，不引入 AST、loader 或第三方依赖递归。

2026-10-22 / 独立验收 owner：按协调者交接，在本工作树修复独立反例；实际绑定清单由解析上下文确定，不能由 require 入口附近的同名清单代替。实际消费的 workspace shadow 源码适用同一边界扫描，动态扩展只沿根名单内 workspace 包进行；保持当前 Node engines、产品运行时和第三方依赖边界。

2026-10-22 / 人类 owner 直接回复：“本会话接手 #399（推荐）”。协调者已获授权整合本地补丁、对真实新 main 变基、发布并在门禁通过后合并；本 proposal 只负责提供可独立复评的本地修复，不直接发布或合并。

2026-10-22 / P1 follow-up 实现者：静态 root visit 和实际命中 packageRoot 使用独立 visited 集合。前者仍按 `.gitignore` 剪枝；后者遍历 packageRoot 内全部源码/产物目录、只登记 `node_modules` 父上下文。没有新增 loader、AST 或 package API。

2026-10-22 / 协调者整合：原分支对 #397/#398 已合入的真实 main 变基，仅 README 冲突；保留短索引和本计划行。110 个测试保持首 preflight，109 个非 owner 正文逐字等于新 base。原守卫、同根因 P1 修复与评审证据整理为一个可独立验收和回滚的能力提交；整理前保留原远端、变基后守卫与 proposal 恢复 ref，推送使用精确 old-head lease。

## Idempotence and Recovery

接线按已有首 import 判断，不重复添加；包名单继续来自根 manifest。临时夹具由各测试的独占目录拥有并清理；从不删除真实工作树或安装。P1 follow-up 的恢复点是独立本地分支修复提交；失败时只撤销该提交，不改旧 #399 工作树。静态 root visit 的 source-tree 剪枝不变，不用跨进程缓存掩盖安装变化。

## Interfaces and Dependencies

仅依赖 Node 内建 fs/path/module/url/process 与现有遍历约定，无凭据或 pnpm 内部 API。root 无条件 exports 前提继续由契约保护；当前已有 6 个精确 subpath，全部随 18 个根入口检查；相关源码软链一律拒绝。canonical 与实际命中 shadow 的条件、数组、通配导出均失败闭合。静态源码 root 与实际 workspace packageRoot 分开遍历：后者不剪枝 dist/build 等包内目录，但仍不进入 node_modules 内容树。将来要支持这些导出形状或改变信任边界时，先更新守卫/验收再改变前提。官方文档之外的求值顺序由 marker 反例实测，不凭推断交付。

## Outcomes & Retrospective

在检出 `test/worktree-module-isolation` 的工作树根完成本地实现与验证，计划继续 Active，等待未参与实现者验收和最终远端门禁。Superseded by 本节“归档与交付回读”（2026-10-22）。原生六入口均先于外部 body 拒绝未安装内层；合法控制执行内层 marker。两种深层真实 shadow、自引用 scope、源码文件/目录软链、缺包、坏 manifest、不可读/悬空/外指边界均失败闭合。漏接新测试、删除 package scope、跳过源码软链、删除 runner 守卫四项变异被判红。TD-088/089 按各自 direct/shadow 与保留零匹配对照的证据移入 Resolved，不据此代替独立验收。

性能观察（2026-10-22，本地共享负载，非基准承诺）：`node --test tests/contract/domain-enums.test.js` 改前 0.424 s，最终 0.418 s；脚本方式 0.207 s。同一三层命令 `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 红基线 1900 条 32.722 s，最终包含子路径补充的 1907 条全绿 28.229 s。`pnpm verify` 最终全绿 42.513 s（包括 typecheck 与 MVP-0）。正常树扫描 19 个解析上下文，每个检查 18 个根入口和 6 个精确子路径；没有落盘或跨进程缓存。正常文件 script / --test 均 6 条，真实 integration runner 为 628 条；有效前缀回读 1 条，伪造前缀 0 条。命令均在本分支工作树根运行。

独立验收修复后的证据：完整 `pnpm verify` 1911 条加 MVP-0 7 条全绿，wall time 35.77 s（含 typecheck）；定向 53 条全绿。临时布局复制真实 domain 包和 `domain-enums.test.js`，六入口缺安装时均非 0、外部 marker 未执行；合法安装时均执行 6 条真实断言与内层 marker，runner 库模式和外层 cwd 下的根别名通过。七项最终变异分别归因到接线、self-reference、源码软链、runner 自身、实际清单、共享入口缓存和 shadow 内深层边界；全部 KILLED，字节恢复后基线全绿。109 个非 owner 测试正文逐字未变。

证据边界：实跑 Node 26；Node 22 未安装或实跑，代码只使用 Node 22 已有内建 API。根入口定位继续依赖无条件根导出；条件、数组与通配子路径在 canonical 和实际命中 shadow 包上均明确拒绝；不枚举未声明的第三方 bare specifier 或递归其依赖树。源码软链拒绝是显式维护约束，错误须先按诊断移除残留，重装不能把外指软链自动变成本地源码。

P1 follow-up 证据：本地 proposal 基于 `f85568ff340763e83171888f00d2ea48032be2af`。三条红例在原遍历上均 `node --test` exit 0 且外层 marker=true；修复后 outer link 三例均由 preflight exit 1、marker=false，local link 三例 exit 0、inner marker=true。`node --test tests/contract/resolution-check.test.js tests/contract/run-test-layer.test.js` 为 56/56。以 Node 26.12.0 / pnpm 10.28.2 运行真实 `pack:plugin`，成功生成 ignored dist；随后守卫 exit 0，`pnpm verify` exit 0，typecheck + 1914 个 contract/integration/e2e 测试 + 7 个 MVP-0 测试全通过。总 code churn 为 789，严格小于 800；未运行 mutation harness、Node 22 未实跑；等待另一评审者复评。

### 归档与交付回读

2026-10-22，在分支 `test/worktree-module-isolation` 的本地独立验收通过后归档。实际包清单与深层上下文反例、合法控制、七项归因变异及完整回归均有记录，TD-088/089 位于 Resolved 分区。最终 push 后执行 `gh pr view 399 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,isDraft,closingIssuesReferences,mergeStateStatus`、`gh pr checks 399 -R SingularityKChen/harness-projects` 并读取全部 review threads；期望关闭引用含 #186、当前 head 有效 checks 通过、无未解决阻塞，再由协调者 ready，保持未合并。实时值不固化进计划。

> 开发期“保持未合并”边界 Superseded by Decision Log 的人类接手授权（2026-10-22）：新 head 复评无 P0/P1 且门禁通过后，由协调者 rebase merge，并回读 #186、main 树和 CI；不改规划状态或阻塞关系。

守卫、runner、全部首 import 和其判别验收共同组成一个可独立回滚的能力提交；临时设计/修复内容收拢，整理前保留本地恢复 ref，最终文件树必须相同，使用精确 old-head lease 发布。

2026-10-22 / 协调者在真实 `main@8b742977` 的整合检出验证：真实 plugin pack 后守卫成功，`pnpm verify` 为 1927 + 7、零失败；110 个首 import 与 109 个非 owner 正文并集保持。Active 1 / Completed 104，README 18,933 字节、集合和相对链接有效。使用 `review-mutate.mjs` 将包内复扫的 true 改回 false，M399-1 由三条“已消费 shadow”失败名归因 KILLED；原字节哈希相同、还原后基线通过。该表只在最终产品源码上运行一次，之后仅整理文档和提交，不改产品源码。

## Bottom Change Note

2026-10-22 SGT：依据两独立设计和 reviewer 取证创建，加入先行求值原型、深层/软链解析边界、完整直接入口矩阵与跨 PR 首 import 所有权。

2026-10-22 SGT：补入 TDD、marker、解析上下文与变异结果；区分现有 subpath 与未来条件导出，保留独立验收和当前 head 的外部门禁。

2026-10-22 SGT：记录不可读 node_modules 的补充红绿、最终本地测试与性能，TD-088/089 按证据解决；独立验收、推送和 ready 保留为协调者后续门禁。

2026-10-22 SGT：依据协调者裁决和新增 marker 红反例扩展 6 个已声明精确子路径，拒绝 canonical / shadow 的条件、数组和通配导出前提；后续绿色与性能以最终回读为准。

2026-10-22 SGT：最终回读三层 1907、MVP-0 7、定向 49、boundaries 9 全绿及单文件/全套性能；计划仍 Active，保留独立验收与最终远端门禁。

2026-10-22 SGT：独立验收修复实际 shadow 清单与深层上下文假绿，补入原生 marker 红绿、合法控制、1911 + 7 完整回归和七项归因变异；计划继续 Active，最终远端门禁由协调者完成。

2026-10-22 SGT：独立验收后归档，精确更新全部自身计划路径引用，核对债务分区，并建立最终交付回读与恢复规则。

2026-10-22 SGT：根据人类 owner “本会话接手 #399（推荐）”授权，新增本地 P1 follow-up batch。静态 source pruning 保持不变，实际消费 workspace packageRoot 全量登记包内解析上下文；根出口、精确 subpath、src→dist 传递红绿与真实 pack 后 1914 + 7 verify 均已记录。补丁等待独立复评，未发布。

2026-10-22：协调者按人类改派整合 P1 修复并对真实 main 变基，补记包内扫描边界、提交整理、独立复评与发布回读规则。
