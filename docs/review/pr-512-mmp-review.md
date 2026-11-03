# PR #512 MMP 交付评审

> 状态：P2 根因修复独立复评通过；当前候选门禁待主控；评审日期：2026-11-03（Asia/Singapore）。

## Purpose / Big Picture
检验 #512 的能力闭环、issue 验收及组合交付；无未修复 P0/P1、独立复评和当前版本门禁成立后，按人类本次直接授权 rebase merge。

## Context and Orientation
2026-11-03初评head最终只读回读（不覆盖下列未提交修复）：远端与本地head一致，base仍为下列main；Ready、MERGEABLE、mergeStateStatus=UNSTABLE，closingIssuesReferences仅对应#505。初始全分页reviewThreads/reviews均空；本子评审没有发送外部review。当前PR Fast Gate、Browser、Verify与Merge Gate均SUCCESS；可选Create review session日志已逐项读取，为本地转发端点连接失败（run 41591934902），不是代码lane失败。取消的Issue policy/Rule checks有同head后继SUCCESS；不以UNSTABLE推导本次代码失败。

初始观察：`feature/safe-markdown@4d0a656ab81322c91fca4b8405233f53730542de`，base `main@957451c684c546ddf8a5d19cb3a23a719940fa9b`。执行上下文为检出 `feature/safe-markdown` 的 `.worktrees/safe-markdown` 根目录。回读：`gh pr view 512 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,statusCheckRollup,reviews,closingIssuesReferences`。焦点：不可信 Markdown 的 HTML、URL 协议、远程资源与脚本执行；GFM 与安装件闭环。

## Design / Spec
先用下列矩阵覆盖全部层次，再逐文件与反例验证；不以代码测试成功推导产品/R1 验收。

| 严重度 | 代码/反例 | 产品闭环 | 架构边界 | 测试证据 | issue/设计 |
|---|---|---|---|---|---|
| P0 | 合入破坏主干或执行任意代码 | 核心任务不可恢复 | 凭据泄漏或第二权威源 | 必需门禁失效 | 违反硬约束 |
| P1 | 严重正确性/安全/竞态 | 主用户路径无法完成或越权 | scope/事实拥有者失守 | 关键故障路径缺陷可复现 | 本层验收严重缺失 |
| P2 | 有替代路径的局部缺陷 | 局部体验/状态回退 | 非关键边界欠缺 | 判别力或覆盖不足 | 文档/范围局部欠缺 |
| P3 | 命名/诊断/可维护性 | 低影响文案或可访问性细节 | 低成本收敛 | 小型验证改进 | 记录、重复追踪、过度设计 |

### 初评矩阵结论（锁定 head `4d0a656ab81322c91fca4b8405233f53730542de`）

| 层 | P0 / P1 | P2 / P3 与证据 |
|---|---|---|
| 代码 / 反例 | 未发现；HTML/协议/嵌套anchor/深层AST/自动图片均有独立检查 | 初评P2：仅长代码的只读详情缺少代码焦点区；已由下列修复复评关闭；无其他P3 |
| 产品闭环 | 现有安全detail门后才挂载；不写正文或Planning | #115/#110/#233安装样本与初评生产源码相同；新增修复需重新构建安装 |
| 架构 | 输入仅body；无Provider/raw store/sourceURL扩权；React仍外置 | gzip+83517B是显式接受的软目标取舍，不包装成微小成本 |
| 测试 | 初评聚焦32/32、打包37/37；五个变异均有归因KILLED | 原browser把code、table和link混在一起，无法暴露只有code时的焦点循环；独立RED 1/1失败 |
| issue / 设计 | #505范围、closing reference、单提交闭环及可逆性匹配 | code414行/文档114行，低于本issue800/1300；现有#505及#449/#460仍为相关追踪，无重复专门issue |

### 初评全部 findings（历史缺陷，修复状态见复评）

- **P2 — 让横向代码区进入详情的焦点枚举**；新增行锚点：`packages/ui/src/safe-markdown.ts:59`（同组件表为table显式提供tabIndex，pre尚无对应呈现器）。在支持的只读drawer消费方式中，无refresh/执行表单，body只有一个600字符长的fenced code且没有link/table，320×480实际Chromium上pre确实横溢。关闭按钮后连续Tab三次都回到关闭按钮，ArrowRight后代码scrollLeft仍0；对pre显式focus后ArrowRight变39。根因是既有cycleFocus只枚举链接、控件与显式tabindex，新pre的浏览器自动焦点不在集合里，于是关闭按钮被误认作末项并提前循环。影响为键盘用户读不到长代码右侧；鼠标与存在后置业务控件时有替代路径，判P2。最小修复是在本叶子的components增加显式可聚焦pre（保留children，必要时可访问名称），补“无其它交互内容，仅长code”的Tab→ArrowRight回归；不必扩大业务scope或重写焦点系统。运行态证据：主仓库根执行 `node --test .superpowers/mmp-review-20261103/markdown-code-keyboard.test.mjs`，exit1，具名断言“Tab must reach long code”失败；`markdown-adversarial.json`保留几何与焦点正反控。

初评未发现P0、P1或其他P2/P3，原建议为APPROVE并处理上列P2。以下独立复评已确认该P2根因修复，当前没有未解决findings。

### P2 修复独立复评（2026-11-03）

对象是 `.worktrees/safe-markdown` 的 `HEAD=4d0a656ab81322c91fca4b8405233f53730542de` 加未提交四文件修复：`safe-markdown.ts`、browser/contract测试及已归档ExecPlan。生产叶子SHA-256为 `7a46d55f9627cae952f2e7c9e9870761a98c2aa5835bc5abe864ee746a68a31d`；browser为 `9e24b5e69201333d0c7589d2101d6d9d62b65599968e9ad7da62c69cbad5bab1`，contract为 `6faed2bb39a1f14fd9af87939e87a586fb68d2c58389de595539648e8c3a6c92`。这不是已有托管检查或旧安装包验证过的产品树。

实际差异只新增一行具名、`tabIndex=0` 的pre presenter并保留children，未修改共享cycleFocus、URL/媒体策略、依赖、API、规划或Provider。原问题正是隐式浏览器滚动焦点未进入抽屉显式枚举；修复直接补叶子契约，设计范围适当。生产Chromium独立probe确认DOM仍为PRE→CODE、language-html类及代码原文逐字保持，pre/code的white-space均为pre；ARIA树为具名region包含code。600字符长code可Tab到达，ArrowRight实际横滚，Shift+Tab和末项Tab循环及Escape关闭正常。含img/onerror语法的fenced code只保持转义文本，img元素0、请求0、pageerror0。

原评审者独立重跑：

- 在主仓库根执行 `node --test .superpowers/mmp-review-20261103/markdown-code-keyboard.test.mjs`：exit0，原始反例1/1通过。
- 在上述worktree根执行 `npx --yes --package pnpm@10.28.2 pnpm test:file tests/browser/safe-markdown.test.js tests/contract/ui-safe-markdown.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js`：exit0，33pass/0fail/0skip；新增code-only、原安全/协议/无图请求、深层fallback、嵌套anchor及既有detail门全部通过。
- 主仓库根 `node .superpowers/mmp-review-20261103/markdown-code-fix/reviewer-probe.mjs`：exit0，真实DOM/ARIA/转义代码/Tab/ArrowRight/ShiftTab/Escape独立probe通过；JSON为同目录`reviewer-probe.json`。
- 核对owner的实际RED日志（两个具名断言fail）及review-mutate spec/log：只删除本行tabIndex的M6由`code-only read-only detail exposes long fenced code`归因KILLED、runner exit0、还原后基线绿。此项为owner运行证据，本复评没有冒称自行重跑变异。
- 原评审者独立执行 `npx --yes --package pnpm@10.28.2 pnpm typecheck`：exit0。

结论：初评P2已修复；本次未发现新增P0/P1/P2/P3，建议维持 **APPROVE**。原安装artifact与本次生产输入已不相同，不能继续当作当前安装接受；主控尚须在整理后的新head完成组合完整门禁、新构建成本/安装回读及GitHub线程收尾。本子评审未改实现、commit、push或提交review。

### 组合焦点断言纠偏复核（2026-11-03）

快速只读复核对象为 owner `0ac53a917389bd16b42d5c32fb5072a2dc05e3e0` 加两文件未提交修补：只把code-only测试的末项Tab目标由“关闭详情”改为 `.hp-detail-header` 中首个可访问且启用按钮，ExecPlan补充对应原因与RED/GREEN。生产 `safe-markdown.ts` SHA-256仍为 `7a46d55f9627cae952f2e7c9e9870761a98c2aa5835bc5abe864ee746a68a31d`，与前次独立复评及当前组合 `33472f2b1451b508b3d1c15d06acf3a078058bd7` 文件逐字相同；本次没有新的生产修复。

语义核对：#513的header按DOM顺序为展开/还原、关闭，所以code末项Tab正确目标应是展开/还原；单独#512只有关闭按钮时该断言仍指向关闭。`.getByRole('button', { disabled: false }).first()`默认只选可访问按钮，与既有cycleFocus首项规则相符。Tab→pre、方向键实际滚动、Shift+Tab回关闭、Escape及无pageerror断言未变，未削弱原P2判别。当前browser文件SHA-256为 `e55a9a05143fc9a1140f52cd2ba8f86a833e8d4e0554c2fef9b3541927e69cc0`，owner与冻结组合逐字相同。

已直接读取 `.superpowers/mmp-review-20261103/markdown-code-fix/union-header-order-red.log`：旧断言在组合ff1bdbdb上仅末项目标断言失败（0/1）；`owner-header-order-green.log`与`union-header-order-green.log`分别为同一具名code-only用例1/1、exit0。本次为实际diff、焦点语义与原始运行证据核验，未重复运行广泛测试，也未将这些单例提升为当前完整组合或新安装接受；后者仍由主控对33472f2b冻结输入完成。

结论：纠偏合理，**无新增finding，维持APPROVE**；原P2修复结论不变。

## Global Constraints
仅评审本 PR 差异与必要前序；评审账号 `gh-review`，开发/回复/合并账号 `gh`；不改 Planning Status 或原生依赖；证据不含本机绝对路径、凭据或内部地址。生产文件由指定 owner 单独修改。

## Plan of Work
- [ ] Batch 1：锁定 diff、threads、checks 和 issue；完成全矩阵及反例；一次性提交 review。
- [ ] Batch 2：复核意见、根因修复、独立复评；保留可回滚提交边界。
- [ ] Batch 3：归档计划、整理提交、发布面/规模检查、当前 head 回读及授权合并。
验证入口：在上述检出运行相关 `pnpm test:file <test>`，再按风险扩大；最终运行 `node scripts/rule-checks.mjs disclosure <base-ref>`、`node scripts/rule-checks.mjs size <base-ref>`、`git diff --check <base-ref>...HEAD`；期望退出码 0。回滚点为初始 head 与合并前 backup ref。

## Validation and Acceptance
| #505验收项 | 结论 |
|---|---|
| 结构、Unicode、empty、literal code、只读task、共享消费入口 | 当前contract/browser通过；唯一content分支复用 |
| HTML/事件/危险协议/relative/嵌套输入、无自动图片 | 当前SSR+真实Chromium通过；独立嵌套list1800层/强调1800层安全完整降级，无pageerror/crash/network；实际安装远程图片输入未单独测量 |
| blocked安全门、wrong-workspace、正文不写回 | 32/32覆盖，并核projection先于presenter；未加写入路径 |
| code/table横滚、键盘与窄屏 | whitespace/几何/table键盘通过；code-only初评P2已在未提交修复树独立复评关闭 |
| light/dark、200%、真实安装及同build成本 | 已核安装原始JSON和包SHA；实际#115/#110/#233、320×480、表格ArrowRight；组合原生zoom2有9case PASS；不将fixture当安装或R1接受 |

初评head的历史命令，均在 `.worktrees/safe-markdown` 根执行（本次修复独立命令见上方复评）：

- `npx --yes --package pnpm@10.28.2 pnpm test:file tests/contract/ui-safe-markdown.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js tests/browser/safe-markdown.test.js`：exit0，32pass/0fail/0skip。
- `npx --yes --package pnpm@10.28.2 pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-bundle-report.test.js`：exit0，37pass/0fail/0skip；检查了实际build/pack、Loader官方JSX runtime、React单例、source drift拒绝及offline依赖准备。
- `node scripts/review-mutate.mjs ../../.superpowers/mmp-review-20261103/safe-markdown-mutations.json`：exit0，5/5 KILLED，变异前及逐字节还原后基线均绿。
- `node scripts/rule-checks.mjs disclosure 957451c684c546ddf8a5d19cb3a23a719940fa9b`、`node scripts/rule-checks.mjs size 957451c684c546ddf8a5d19cb3a23a719940fa9b`及argv形式`git diff --check <base>...HEAD`均exit0；已人工阅读本PR新增文本、commit与PR描述五类发布面，无发现。

| 变异 | killedBy（具名用例片段） | 结果 |
|---|---|---|
| M1 删除URL绝对协议前缀拒绝 | only absolute HTTP(S) | KILLED |
| M2 图片直接输出img | HTML stays inert | KILLED |
| M3 删除深层结构预算 | ordinary nesting stays semantic | KILLED |
| M4 放行嵌套anchor | nested autolinks | KILLED |
| M5 代码white-space恢复normal | real detail browser preserves code | KILLED |

初评head的历史安装身份回核（不覆盖本次未提交修复）：`git diff 7630f2bc6379a65650fdefd2bd7bd43903d721b4 HEAD -- packages apps`无差异；原安装source不是当前commit但生产逐路径相同。`bundle-markdown-review-fix/report.json`与tarball实算SHA-256一致，`bcc19e884f75556cae459a22a5f6db0df11d824f554f06bc69bc610481b8483a`；client646467raw/135888gzip，baseline228372/52371；Host546786/131091不变，tgz282319，bundledReact空。`installed-host-markdown/process.json`记录逐文件字节相同；本次未重新安装。组合zoom证据source `dca3e6f7844dbef7ce0da94f3ff080dadc65f0f0`、artifact `cf710bec2ec6a5a296facea9b1ba174599b60c2a53cfae3918520fca077a9509`实算SHA吻合；9case报告无errors。历史证据保留其原始身份，未当成本次重新运行。

| 验收项 | 证据与判定 |
|---|---|
| 全层矩阵与 issue 验收 | 本记录更新后的结论和 GitHub 单份 review |
| 修复/组合/当前门禁 | 独立复评与当前 head checks；未执行前不判通过 |

## Progress
- [x] 2026-11-03：先建立 P0–P3 风险矩阵。
- [x] 2026-11-03：全矩阵、反例、issue 和设计适配性独立评审完成；结论与全部finding见Design / Spec；未由子评审发送GitHub review或修改生产代码。
- [x] 2026-11-03：原评审者独立复评P2根因修复，原反例1/1及聚焦33/33通过；没有新增findings。

## Surprises & Discoveries
当前新增P2来自独立最小用户路径，既有混合fixture会掩盖它。安全反例中HTML样式文本里的HTTP字符串被GFM识别为安全文字链接，但无样式节点与请求，不是脚本或远程资源绕过。依赖成本超过20KiB软目标已在原设计中明确裁决，无硬预算/Host失败证据，不重复列finding。

初始 checks 含可选 `Create review session` 失败与取消任务；须逐项读日志，不能据旧记录豁免。

## Decision Log
2026-11-03：人类本次直接要求评审 #512 并由本会话负责后续修复、re-review、归档、commit 整合、issue 核对和 `merge_method=rebase` 合并。该授权不覆盖绕过保护、规划 Status 或依赖写入。

## Idempotence and Recovery
只读回读可重复。写操作先核对精确 head；共享历史修改先建 `refs/backup/pr512-before-mmp-review-20261103`，以精确 lease 推送；并发变化停止该写入并重新锁定。

## Interfaces and Dependencies
GitHub PR/issue/review/checks 为远端工程事实；本地测试仅证明命名版本的本地行为。依赖顺序遵循 PR base 与人类指定队列。

## Outcomes & Retrospective
初评及P2修复独立复评完成，当前没有未解决findings，建议APPROVE。复评覆盖上列精确未提交输入；新head、完整组合门禁和新安装件由主控按授权完成，旧checks/旧tarball不得覆盖修复树。

## Bottom Change Note
2026-11-03：创建风险矩阵，先于分层审查；记录人类授权与恢复路径。

2026-11-03：补充当前immutable head的全层矩阵、全部findings、原始安装身份回核、带killedBy变异及具名验证；未修改远端issue/Planning字段。

2026-11-03：原独立reviewer复评具名pre修复，记录精确未提交输入与实际DOM/ARIA、安全、键盘回归；明确旧安装和托管检查不覆盖新生产树。

2026-11-03：只读复核组合header焦点顺序测试纠偏，锁定owner/冻结组合文件hash与单例RED/GREEN证据边界，无新增finding。

2026-11-03：最终 clean 组合 `33472f2b1451b508b3d1c15d06acf3a078058bd7` 完整3474+7、browser35、boundaries9及workflow通过；新包 `7209b6e64a5572f68312bb57b43ad7fa8010d743f7995a63c9b92541a72c115a` 实际安装12文件逐字节相同。#110真实短code两次Tab可进入显式区域；长code横滚保留生产浏览器证据边界。联合详情/表格/原生关联与200%光暗布局通过。包成本相对旧组合仅client+20B gzip/Host+198B gzip，详细原20KiB软目标权衡与计数观察边界见批次评审。

2026-11-03 最终实际前序回读：在检出 `feature/safe-markdown` 的 `.worktrees/safe-markdown` 根，基于 `main@957451c684c546ddf8a5d19cb3a23a719940fa9b` 完成 frozen install、typecheck 与 `pnpm test:file tests/contract/ui-safe-markdown.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js tests/browser/safe-markdown.test.js`，输出 ℹ tests 33 / ℹ pass 33 / ℹ fail 0 / ℹ skipped 0 / ℹ todo 0，exit 0。原生依赖只按真实前序重放，当前 head/CI/threads/issue 仍由文中 GH 回读命令确定；本次提交没有继承旧 SHA 的批准。最终组合 `33472f2b` 与新包 `7209b6e6…115a` 的实际接受边界见批次评审。
