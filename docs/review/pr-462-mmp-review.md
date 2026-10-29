# PR #462 MMP交付审查

独立审查锁定实现2b12db1与foundation227eed7；最终整理仅替换基础文档和提交边界，own产品文件逐字核对保持。2026-10-29记录。

| 层 | 风险审查 | 结论 |
|---|---|---|
| 代码 | normal/failure、resize、cleanup、隐藏焦点、关闭 | 无新增P0/P1或当前产品缺陷 |
| 产品 | 一套详情、340px/overlay、真实回焦和安全状态 | 来源/规划/执行事实拥有保持；不新增non-modal语义 |
| 架构 | native modal、私有几何、无新依赖/公共状态 | 符合单一owner与包边界 |
| 测试 | 14项独立窄测、额外几何/实例探针、四变异 | 全部通过；宽屏CSS单独移除曾SURVIVED，属于P2证据缺口 |
| 工作项 | #430关联、严格增删预算、上下游边界 | 最终远端当前SHA检查仍须回读 |

`node scripts/review-mutate.mjs .superpowers/ui-detail/mutations.json` 四项变异精准归因KILLED，前后基线绿、源码字节相同。单独删除预留CSS的额外探针SURVIVED；未把它冒称KILLED。

整合owner随后用实际浏览器补P2：宽屏同一padding判据356px→负控0px→恢复356px，mutant失败且恢复绿色。正常1440/1200/1199/1024/320、窄Host容器、长正文和键盘正负控通过。

官方固定Host整合tarball实际连接真实Project、打开#430、检查modal/宽度/关闭与opener；实际Host与fixture、Node契约、CI分别陈述，执行和交付动作没有为截图而触发。

结论：无剩余P0/P1或产品缺陷，P2负控证据已补。最终包报告、当前head/base/checks与关联通过后ready；不替代#449、#457、人类评审或R1。


## 2026-10-30 独立复评：调查前锁定

- head：`8304307f21fea9332d13908eeeb60a5159140a59`；base：`feature/mmp-ui-frame` / `56a2b6db17877458ba88b81cf793a0bba0135ca0`；工作区 `.worktrees/mmp-ui-detail`，开始时 clean。
- 范围：#430 响应式详情闭环；#427 父 UI、#449 人类 UAT、#457 权限 P0、R1 不由本 PR 宣告完成。当前 PR 快照为 Ready、MERGEABLE、UNSTABLE；checks 与线程由主评审最终回读，不把旧运行当本轮结论。
- 方法：Superpowers、Qian Systems Router、First-Principles Development；包含系统是 Host 中的项目交付工作台，目标是保持唯一详情和 Host 权威语义，同时在实际容器几何下可读、可键盘操作并可靠关闭恢复。
- 最高不确定性：原生模态与表现布局、背景 inert、焦点恢复在真实浏览器和容器尺寸变化中是否一致。

| 等级 | 代码 / 产品 / 架构风险 | 测试 / 工作项检查 | 调查前状态 |
|---|---|---|---|
| P0 | main / 权限 / 权威状态硬约束被破坏 | 外部调用、业务事实与边界变更，#457 不被掩盖 | 待检查 |
| P1 | modal/inert 不一致、焦点逃逸或无法关闭、redaction 泄漏、动作语义回归 | 真实浏览器交互、刷新/禁用/回焦反例、#430 验收 | 待检查 |
| P2 | 容器/滚动几何错误、长内容不可读、测试不能识别关键回归 | 窄/宽与内嵌容器、判别性变异、构建和 scope 证据 | 待检查 |
| P3 | 文档/命名/维护成本或设计复杂度超出闭环需要 | ExecPlan、既有 issue、独立回滚与规模 | 待检查 |


### 本轮结果与完整矩阵

| 等级 | 结果 | 证据 / 边界 |
|---|---|---|
| P0 | 无新增 | 仅 UI 私有呈现和 fixture；没有 Provider/Storage/权限写口变更，#457 仍是独立发布阻塞 |
| P1 | 无新增 | 原生 `:modal`、背景 focus 拒绝、Tab/Shift+Tab、关闭/回焦、遮蔽和动作语义检查通过 |
| P2 | 一项：长仓库标识撑宽详情内的标题和原生选择框 | 见下方 base/head 真实浏览器反例；#430 的长 ID 不横滚验收尚有缺口 |
| P3 | 无新增 | 当前私有几何模块规模与职责适当；没有为了样式引入依赖、第二个业务状态或交互系统 |

| 层 | 检查与结论 |
|---|---|
| 代码 | 正常/失败/遮蔽分支、观察器清理、viewport 裁剪、resize 不重开、回焦与一次关闭均检查；发现长内容 CSS 的 P2 遗漏 |
| 产品闭环 | 唯一模态详情在宽屏保留列表可见但 inert；窄容器覆盖，稳定关闭与正文滚动成立。开始工作/执行/交付仍走已有消费者，未宣告运行事实或 Saved |
| 架构 | 几何只写根元素 CSS 变量，依赖方向与 Host 权威不变；同一 owner 管理根与 drawer。保留原生 dialog 是满足现有语义的适量设计 |
| 测试 | 本轮 74 项聚焦契约/集成、typecheck、9 项 boundaries 通过；四变异精准 KILLED。实际浏览器另发现 SSR/Node 契约无法识别的原生控件溢出 |
| 工作项 | #430 scope、#427 父验收、已完成 ExecPlan、Closes #430、Refs #427 及独立 revert 边界一致；不把本 PR、#449 人类验收、#457 或 R1 混为一个完成结论 |

### P2：约束详情中的标题与原生控件宽度

新增行锚点：`packages/ui/src/detail-presentation.ts:19`（与第 10 行固定 340px、第 18 行可双轴滚动共同作用）。换行规则只覆盖 p/time/a/span/code/pre/h2，漏掉带 repositoryId 的 h3/h4；原生 select 也没有最大行内宽度。

复现采用真实 `deriveWorkItemListView` / `deriveWorkItemDetailView` → `WorkItemProjectPage` → drawer → `ExecutionContextSection` / `StartWorkSection`，只替换本地读数和无副作用的命令 seam。1440×900，绑定仓库标识 `github.com/singularitykchen/harness-projects-browser-regression`，打开详情并展开「开始工作」：

| 同构建产品版本 | dialog 宽 | 正文 clientWidth / scrollWidth | form clientWidth / scrollWidth | select 宽 |
|---|---:|---:|---:|---:|
| 当前 head | 340 | 323 / 424 | 291 / 408 | 407.5 |
| 精确 base | 674 | 668 / 668 | 608 / 608 | 407.5 |

base 探针用 `git show <base>:<path>` 读取原始 `work-item-detail.ts` / `work-item-project.ts` 后由 esbuild onLoad 覆载，其他输入、浏览器、数据和交互相同，没有更改工作树产品文件。短当前仓库标识 `github.com/singularitykchen/harness-projects` 在 head 作为正控为正文 323/323、select 289px。另一个合法无分隔仓库名（44 个小写 a，仍远低于 100 字符上限）使 head 的 h4 为 291/559px、正文 323/575px；base h4 608/608px、正文 668/668px。

可达性依据：`packages/client/src/repository-binding.ts` 将合法 lowercase owner/name 组合成 `github.com/<owner>/<name>`，各段允许 1–100 字符；`apps/harness-plugin/src/host-repository-binding.ts` 按相同格式核对；Core 的 `bindRepository` 保留非空 repositoryId。反例并未用不符合当前 Host 绑定格式的 opaque ID 作为最终依据。没有为验证发起实际绑定或执行。

影响：原本可读的桌面详情在收窄后要横向滚动才能完整使用仓库选择框，带长标识的执行区标题亦不能按本 PR 的长内容承诺换行。建议在详情 owner 中覆盖 h3/h4 等现有标题，并为 input/select/textarea 设合适的 box-sizing / max-inline-size，补实际组合浏览器几何断言与负控；不用重写 Start Work 业务机制。

既有工作项：#430 明确要求长 ID/时间不得强制横滚，并拥有 drawer responsiveness；#448 拥有后续执行区视觉一致性但明确把容器响应式留给 #430；#447 是设置/仓库绑定/映射表单，不是这个详情内溢出的现成豁免。#450/#451 是后续真实组合浏览器自动化覆盖。按一条 P2 归并同一长内容约束遗漏，不拆重复意见。

### 本轮实际验证

- `pnpm test:file tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/integration/ui-work-item-detail-read.test.js`：17/17 通过。
- `pnpm test:file tests/contract/ui-start-work.test.js tests/contract/ui-delivery-lineage-strip.test.js tests/contract/ui-work-item-app.test.js`：34/34 通过。
- `pnpm test:file tests/contract/ui-execution-context.test.js tests/contract/ui-delivery-lineage-section.test.js`：23/23 通过，包含刷新、拒绝、迟到结果、目标替换与实际 Host remote 确认路径。
- `pnpm run typecheck`；`pnpm run boundaries`：通过，后者 9/9。
- 独立 Chromium fixture：1440/1200 为 340px + 356px 预留；1199/1024/320 及 1440 内 1000px 容器为覆盖，实际右界不越容器。长正文/路径/时间无横滚，标题自身可滚，关闭按钮 44px。
- 原生 `:modal`、标题初始焦点、标题 Shift+Tab 到末项/末项 Tab 到关闭、disabled/hidden 跳过、背景链接 focus 不成功；刷新一次且立即禁用、content→redacted 清除旧正文/身份、Escape 一次关闭、opener/fallback 回焦通过。loading/offline/missing/denied/redacted 均能关闭；fixture 明暗 Canvas/文字跟随通过。

| 变异 | `killedBy` 精确归因 | 结果 |
|---|---|---|
| D430-geometry | `responsive-detail` | KILLED |
| D430-focus-filter | `detail-tab` | KILLED |
| D430-opener-fallback | `detail-close-focus` | KILLED |
| D430-fixture-close | `遮蔽场景关闭` | KILLED |

命令为 `node scripts/review-mutate.mjs .superpowers/ui-detail/mutations.json`；本轮整表一次，退出 0，前后基线绿，runner 逐字节恢复。该变异表不覆盖本轮新发现的原生控件几何问题，不把四项 KILLED 扩大成全部布局验收。

### 结论与证据边界

本轮无新增 P0/P1，一条 P2 长标识/原生控件溢出，建议在主评审收尾中机械修复并对修复做独立复评。本轮没有发布 review、修改产品/测试源、提交或推送。浏览器发现相同 scope 的两个 section 使用相同 key 警告，精确 base/head 均存在且该 key 未被本 PR 修改，不重复包装成新增缺陷。

本轮实际浏览器是独立 credential-free fixture 与真实 UI 组件组合探针；没有重装并验收当前官方 Host、OS 浏览器缩放、屏幕阅读器或实际 Provider/模型执行。既有安装件/同构建包增量是作者历史证据，本轮不冒称重测。精确 head 的 hosted CI、review threads、最终基线变化和三 PR 组合证据由主评审回读控制；本地通过不替代它们，也不解除 #449、#457 或 R1。


## 2026-10-30 P2 修复的独立限定复评

复评对象是主评审在原 head 上的两处 CSS 工作树修复：详情换行范围增加 h3/h4，详情 input/select 增加 `max-inline-size:100%; box-sizing:border-box`。本轮读取的 `detail-presentation.ts` blob 为 `99587b3bbcba80165ee0ab9259e776105f57d6ed`，与组合提交 `a9c277aebe665c616b7807ebc151471182e54572` 中同一路径 blob 一致；它尚不是本 PR 的最终远端 head。未改产品源、测试源、commit 或 push。

| 风险 | 修复复评结论 |
|---|---|
| P0/P1 | 无新增；只改呈现约束，无业务/权限/持久化状态变更 |
| P2 | 原长仓库标识横滚问题在真实组合浏览器内消除，负控可重现再恢复 |
| P3 | 无新增；不增加组件体系或依赖，改动留在详情 owner |

使用主评审从当前源重新构建的组合探针，独立 Chromium session 分别输入合法 canonical63 字符仓库标识 `github.com/singularitykchen/harness-projects-browser-regression`，以及 canonical 前缀加44个小写a的无分隔仓库名，真实展开 Start Work：

| 视窗 | 两种标识的正文 clientWidth / scrollWidth | h4 clientWidth / scrollWidth | select 宽 |
|---|---:|---:|---:|
| 1440×900 | 323 / 323 | 291 / 291 | 291 |
| 320×900 | 303 / 303 | 271 / 271 | 271 |

select 右界分别为 1408<1440、288<320；所有场景仍是原生 `:modal`。与主评审测量中的15px滚动条差异来自独立浏览器 profile，不改变同一 profile 内无横滚判据。

实际 CSS 负控只在浏览器 DOM 中临时覆盖两处约束，不修改工作树：无分隔44字符仓库名在同一页 GREEN 为正文323/323、h4 291/291、select291；施加 `max-inline-size:none !important` 与标题 `overflow-wrap:normal !important` 后 RED 为正文323/575、h4 291/559、select516.5；移除覆盖后恢复 GREEN 323/323、291/291、291。该判据来自实际计算布局，不是 Node CSS 字符串断言；第一次未带 important 的覆盖受样式顺序影响未施加，不将其计为负控结果。

同一真实组合页中末控件Tab回「关闭详情」、首控件Shift+Tab回「收起表单」通过。另从当前修复源重新编译详情 fixture，实际点击刷新为1次且禁用，Escape关闭为1次并回焦opener。修复后的三组详情契约/集成17项全部通过。

补充缩放相关探针：720×450有效布局重排保持overlay、正文323/323、关闭44px；再将fixture字体由14px放大至28px，正文323/323、h4 291/291、select291，关闭60px且Escape可关闭。它是受控重排/文本放大证据，不冒称操作系统或官方安装Host桌面200%缩放。CDP pinch scale2另观察到layout viewport1440/visual viewport720，而几何仍按layout viewport定位；这一既有视觉视窗行为不由本次两行CSS修复改变，不能把它记为桌面缩放验收通过，相关安装Host缩放仍留在#449的人类实测边界。

结论：此P2修复通过独立限定复评，无剩余本轮新增可行动发现。最终commit/head、完整组合verify、CI、review回复与issue验收仍由主评审收尾。本轮未重新声称安装Host/实际执行/人类UAT或R1已完成。
