# PR #463 MMP交付审查

独立初审锁定b12a4a7与foundation227eed7，限定复评锁定908ecaa。2026-10-29记录；最终提交整理的own产品树另行逐字核对。

| 层 | 风险审查 | 结论 |
|---|---|---|
| 代码 | pending/ack/unknown、草稿、取消、异步焦点 | 无新增P0/P1；两项P2修复后复评通过 |
| 产品 | 三表单一致语言与可恢复状态 | 未确认不称成功；同名/已删除定义不隐藏 |
| 架构 | source唯一确认权威、无Provider直连/新状态库 | 符合边界；局部ref只记录焦点归属 |
| 测试 | 49contract+54Host、五归因变异与独立复现 | GREEN；原确认读失败焦点探针0→1 |
| 工作项 | #447关联、严格预算、文档/包/远端门禁 | current head检查通过后才ready |

P2-1：repository-binding在configured中间态清除提交标记，随后baseline失败虽有摘要却不聚焦。改为跟随确切bind Promise和同一尝试、cleanup失效；新增deferred baseline反例并复评。
P2-2：list阶段移除外层frame令设置动作离开token/focus/44px作用域。保留外层frame，以私有窄selector清零直接嵌套app的重复padding；改验有效scope而非类名计数，复评无新问题。

`node scripts/review-mutate.mjs .superpowers/forms-mutations.json` 最终五行精准KILLED；基线/恢复绿色、原文恢复一致。测试路径不是浏览器证据。

整合owner实际浏览器核对padding15/0px、设置动作44px；repository-baseline失败后role=alert/id=repository-error获焦且草稿保留。创建失败/重试、映射unknown与深色窄宽无泄露另有真实DOM观察。

官方固定Host整合产物完成安装与真实Project设置呈现；最终修复产物与当前SHA门禁仍按所属ExecPlan核对，不用旧产物替代。结论：两P2已修复，无剩余P0–P3；不代表#449、#457或R1通过。

最终整合发现安装件测试误把根section的属性顺序当作语义。保持产品markup不动，断言改为精确根section与精确aria-label，保留Artifact链接/SVG检查；24/25 RED→25/25 GREEN，缺失/错误根label两项变异KILLED，独立限定复评通过。


## 2026-10-30 独立当前 head 复核

锁定 head `6819a4698e59ed059fb6b509db13564f9c85bdf0`，base `feature/mmp-ui-frame@56a2b6db17877458ba88b81cf793a0bba0135ca0`；工作区 `.worktrees/mmp-ui-forms`，起始 clean。远端快照：非 draft、MERGEABLE、UNSTABLE，单提交，Closes #447；当前快照 Merge Gate/各 lane 与政策/公开面/规模通过，Create review session 失败由主评审核实。远端线程、审批与最终 checks 由主评审统筹，本文不发布 review。

事实：UI 仅消费现有 source；#447 为本闭环验收，#449 安装产品人类接受和 #457 运行态权限仍独立。硬约束：未确认不称 Saved、Host 权威、凭据不回显、规划事实不受工程覆盖。假设：当前 head 与主评审提供的不可变快照一致，后续如改变即作废。

| 层 | P0 | P1 | P2 | P3 | 首轮判据 |
|---|---|---|---|---|---|
| 代码 | 不可逆配置/主干破坏 | unknown 假确认、秘密泄露、迟到响应跨 scope | 草稿/重试/错误焦点错误 | 重复样式或无效分支 | pending→失败→重试、取消/卸载、ack→baseline失败 |
| 产品 | 破坏状态所有权 | 确认语言误导或不可恢复 | required/label/44px/窄宽错误 | 文案不一致 | 三表单真实 DOM 用户结果 |
| 架构 | 七不变量破坏 | 第二业务 authority/Provider 越层 | 共享 scope 失效 | 不必要抽象 | source/局部 ref/呈现职责 |
| 测试 | 门禁失真 | 关键负路径无判别证据 | 断言镜像实现或突变存活 | 脆弱 markup 依赖 | 精确 killedBy、基线与恢复 |
| 工作项 | 越权合并/发布 | #447 闭环遗漏或虚假接受 | 规模/证据不符 | 索引遗漏 | issue、ExecPlan、现有重复问题 |

矩阵为审查前风险假设，不是已发现缺陷。


### 当前 head 的调查结果

- 代码/产品：逐段核对三个 UI 组件、私有呈现 helper、现有 client source 与 ui-model。确认状态、意图键、取消与恢复仍归 source/Host；局部 ref 仅归属用户提交的错误焦点，无新 Provider 调用、业务 store 或依赖。#462 对 `DOMElement` 只增加可选能力，既有 querySelector/focus 合同兼容；本评审未改另一 worktree。小型 helper 与原生控件满足本闭环，没有证据支持再引入通用表单框架。
- 本地验证：49 项表单契约、79 项相关 Host/命令/安装件集成（含新增根 section 精确名称断言）全部通过，零失败/跳过；`pnpm typecheck` 通过，`pnpm boundaries` 9 项通过。`node scripts/rule-checks.mjs size feature/mmp-ui-frame` 为代码 283/1000、已提交文档 200/1500；`git diff --check feature/mmp-ui-frame...HEAD` 无输出。
- 反例与判别性：最终产品树运行原五项表单变异及两项根可访问名称变异，全部由仓库 `review-mutate.mjs` 按各自 `killedBy` 精准 KILLED，基线/恢复基线通过且逐字恢复。F1 错误焦点、F2 local_only 假 Saved、F3 label 关联、F4 configured 读回失败焦点、F5 共享 scope、A1/A2 缺失/错误根名称均有有效负控；不把纯 SSR/hook 结果称浏览器证据。
- 独立真实浏览器（CLI session `pr463-review`，生产组件 + client source 的受控 port fixture）：空创建 required 聚焦 `workspace-name`、命令数 0；有效提交 pending 时输入/提交禁用、aria-busy=true；failed 后 `setup-error` 获焦、草稿保留、重试成功后进入连接摘要。仓库 account→bind ack→deferred baseline failed 后 `repository-error` 获焦，596 字符路径草稿保留，无 raw-error/secret canary。
- 同一浏览器 mapping unknown：`done` 草稿与已删除 option 身份保留，未显示 Saved/本地已保存，摘要获焦；重试两次命令均用 `fixture-1`，成功读回后 intent/error 清空。同名 status/status-2 与 deleted 均在实际可访问树。320 CSS px 深色下 15 个可用字段/动作均 44px、所有标签有 control、clientWidth=scrollWidth=305；检查截图未见遮挡。list 模式实测外/内 frame padding 为 15/0px，连接设置动作 44px 且在 `.hp-workspace` 内。
- 范围/既有工作项：#447 覆盖本呈现闭环；连接错误分类已有 #434/#278，运行时撤权与内容遮蔽已有 #457，组合浏览器验收 #450/#451，安装件人类接受 #449，整体 Core #427。当前未观察到可归因于本 diff 的新增 P0/P1/P2；这些独立未完成事项不转称本 PR 已接受。

### 可行动发现

**P3 / 文档一致性：归档 ExecPlan 仍把已宣称完成的最终验收留作未完成。** 新增文件 `docs/exec-plan/completed/2026-10-29-mmp-ui-forms.md:108` 的 Progress 仍为 `- [ ] 最终整合验证及新增断言的独立复评…`，而 PR 描述与本评审旧段已声称独立复评、最终整合 2567+7 通过。最小复现是读取该行并对照 PR 验证段；影响是 completed 计划不能独立表达最终 gate 是否已结算，接手人无法判断应继续还是已完成。修复方向：在最终检出/当前 SHA 的真实验证和独立复评证据核对完成后，补写对应引用、日期和结果并结算该待办；若尚缺证据，应撤回过早完成断言而非直接勾选。本问题属 #447 交付档案，没有另建重复 issue；不阻塞产品交付。主评审正在对最终组合树 fresh verify，本文不提前改计划。

### 结论与边界

P0=0、P1=0、P2=0、P3=1（上述档案一致性）。在锁定 head 上未发现产品/安全/架构阻塞项。基线的 review session 可选红检查、全部远端线程与最终 check 回读由主评审处置；没有自行发布 review 或合并。独立浏览器为受控 port fixture，未重复安装官方 Host、真实 Provider 或完整人类 UAT；本地测试、模拟 ack 和浏览器截图不替代 #449、#457 或 R1。


### 2026-10-30 P3 修复的限定独立复评

本轮仅核对归档文档修复，产品 head 仍锁定 `6819a4698e59ed059fb6b509db13564f9c85bdf0`，没有重复执行全套测试。ExecPlan 顶部把工程/独立复评完成与最终远端回读、人类产品接受分开；Progress 原第108行就地结算并记录 `test/mmp-ui-final@a9c277a` 的三 PR 产品/测试并集及详情 P2 修复，保留旧日期的 Bottom Change Note 明确“当时待验证”已由 2026-10-30 Progress 替代，未删除失败/修复历史。

独立直接读取主评审保留的 fresh `final-union-verify.log`：前置 typecheck 执行，契约/集成/E2E 汇总2567通过、0失败/跳过，mvp0汇总7通过、0失败/跳过；这仅是本地组合验证。组合 revision 对应与并集逐字核对由主评审负责，初轮 `c8c69c3` 不再充当修复后组合验证。`6819a46` 的49契约+79集成及7项变异仍归本子评审实际执行的表单证据。另用 `gh-review api` 直接回读 CI 运行40866640808，确认 head 为完整 `6819a4698e59ed059fb6b509db13564f9c85bdf0`、completed/success；该 CI 不替代后续 push 的新 SHA 检查。

Decision Log 将条件合并授权归属本轮主评审所记录的人类直接指令，未将测试、agent审批或本子评审变成授权来源；本子评审未执行合并。新增内容不升级为实际安装 Host、真实 Provider、人类UAT、#449/#457/R1或Project Status接受。变更局限于完成说明、过期待办、对应决策与变更记录；五类公开面人工检查未见凭据、本机路径/身份、个人信息、内部系统或保密内容。`git diff --check` 通过。

上述 P3 在当前本地文档修复中已结算；前节“P3=1”是修复前历史结论，由本条替代。限定复评未发现新增P0–P3。新提交/head、远端checks、线程与最终发布回读仍由主评审在push后重核；不沿用旧head审批。

2026-10-30 最终整合：#461/#462 已依次在当前head复评/门禁后rebase合入；本分支只重放表单交付，无冲突，最终产品/测试blob与已通过2567+7的`test/mmp-ui-final@a9c277a`完全一致。所属计划已在Completed且docs索引保留三项。当前push的CI/审批/线程和#447关联必须重新回读，见本批记录，不用旧6819的成功替代。
