# 执行与交付反馈呈现 ExecPlan

> 状态：Completed
> 创建：2026-10-30
> 范围：#448 的执行上下文、Start Work、PR/CI 谱系呈现闭环
> 规范：根 `AGENTS.md`、`PLANS.md`；关联 issue #448

## Purpose / Big Picture

用户打开详情后，能先读到运行结果、人工承接或不确定性，再找到当前可用动作，并按需展开分支、工作树和谱系来源。运行成功、CI 通过和规划完成始终是三个独立事实。最小成功证据是三个现有组件在 unknown、failed、stale、manual fallback 和确认场景中保留真实状态与操作，同时形成一致的层级和技术披露。

## Context and Orientation

`StartWorkSection` 持有表单草稿，client 拥有命令意图；`ExecutionContextSection` 逐仓库读取执行状态；`DeliveryLineageSection` 消费 Host 谱系并维护刷新与新鲜度边界。`executionContextText` 和 `deriveDeliveryLineageStrip` 是现有事实到安全文字的投影。本任务改呈现，并允许 Start Work 局部 DOM 焦点恢复；该例外不改变命令意图或结果。既有详情抽屉拥有模态、响应式与焦点循环；#437/#464 拥有真实 PR 创建；#365 拥有执行刷新事实；#472 拥有唯一生产浏览器组合载体。上述机制不迁入本任务。

调查观察为 2026-10-30 +08、`main` 检出 `b19b4eac4f12aa40c05d75b492f3335299874641`；它是设计输入而非未来 head。两份独立设计都支持一个 PR 闭合 #448，无需为预算拆分。交付与权限任务可能同时触及谱系组件；本任务只拥有 render/class/语义 markup 区域，不拥有 effect/read/access 算法。

## Design / Spec

选用垂直的三个语义 section，复用 Host 的 `--hp-*` token、44px 动作与焦点样式。标题、主要状态、恢复通知与动作始终可见；路径、外部身份、候选/确认关系等技术来源可放原生 `details/summary`。确认时刻与 stale/unknown 限定语不能因披露收起而消失。技术长串使用可换行文本，六个谱系位置继续使用有序列表，缺口继续显示缺口。

新私有呈现模块只含样式和无状态 helper。badge 只接收已知枚举/固定文字，不解析文字猜状态、不读时钟、不形成“总体健康”判定。manual fallback 是独立提示，不能显示成运行成功。Start Work 复用现有表单类，保留原 ref、label、选择、提交、unknown 读回与失败重试语义。重复展开技术来源不能触发 provider 调用。

拒绝横向六阶段仪表盘与总成功灯：窄抽屉、多仓库、多个 CI 节点下密度过高，且会掩盖缺口。拒绝只加通用 CSS：无法满足技术来源披露和主要/次要信息层级。只在完整闭环实测超过 790 增删时重新估算；先移除无关装饰，不删除判别性测试。

## Global Constraints

本轮审查收尾补充 `docs/review/pr-476-mmp-review.md`、批次记录 `docs/review/2026-10-30-pr476-pr480-mmp-review.md`、评审索引与merge queue；评审证据随本能力闭环交付。

唯一文件集合与 owner：本任务 owner 修改 `packages/ui/src/start-work-section.ts`、`packages/ui/src/execution-context-section.ts`、`packages/ui/src/delivery-lineage-section.ts`，新增 `packages/ui/src/execution-presentation.ts`；测试写入 `tests/contract/ui-start-work.test.js`、`tests/contract/ui-execution-context.test.js`、`tests/contract/ui-delivery-lineage-section.test.js`；允许仅扩展既有 `tests/fixtures/execution-drawer-browser.mjs` 的展示场景，不建立第二生产 carrier；正式文档为本计划、`docs/product/ui-execution-feedback.md` 与结束时的 `docs/README.md` 索引行。后者由协调者收敛，三个任务不得并行改索引。

代码、测试、fixture 的增删总和严格小于 800，目标 450–700，文档严格小于 1300、目标 180–300。不新增依赖、不改 public export、drawer 容器、Host/client/core/provider、主题 owner、请求生命周期、generation、cache 或能力求交。唯一 hooks 例外是 Start Work 的局部 form/action refs、单 generation 焦点票据和 pending 生命周期 focusin 监听：只在提交源属于本表单且焦点掉 body/null 时恢复；用户主动移焦永久撤销，关闭、断开、换目标及卸载清理。对外权限工作流共享文件时只修改呈现区域；最终协调者在稳定已提交的当前权限候选上做组合验证，未提交改动不作为依赖，出现同区争写即停止该文件并协调 owner。

## Plan of Work

### Batch 1 · 呈现闭环与不确定性保护

产品代码前先提交本计划，协调者创建 docs-only draft PR 并回读 base/head/draft/Closes #448，然后开始实现。最小闭环是统一三区而保留全部行为。主文件为三个既有 section 和私有呈现模块。先记录 baseline 定向测试；新增判别用例要求技术披露、状态/时间/下一步在披露外、manual 与 run 独立、六位置缺口保留，旧树必须有命名断言失败。然后接入共享呈现，删除被替换的重复 markup，禁止重写已有请求 hooks/effects；经独立审阅批准的局部焦点 effect 除外。每次改布局后跑下面定向命令，期望全部 pass、无 canary 泄漏；完成一批更新 Progress/Decision Log，统一提交。

在检出 `feature/ui-execution-feedback` 的工作树根执行：

    pnpm install --frozen-lockfile
    pnpm test:file tests/contract/ui-start-work.test.js tests/contract/ui-execution-context.test.js tests/contract/ui-delivery-lineage-section.test.js tests/contract/ui-delivery-lineage-strip.test.js tests/integration/harness-plugin-execution-drawer.test.js tests/integration/harness-plugin-delivery-lineage.test.js
    pnpm typecheck
    pnpm run boundaries

### Batch 2 · 浏览器、产物与评审交付

在同一分支根运行 `node tests/fixtures/execution-drawer-browser.mjs`，用它输出的本地 URL 打开现有场景；补充的展示数据只进入现有 fixture。以 light/dark、1440/1024/375/320px、100%/200% 文字放大核对长仓库名、无空格路径、多仓库、缺 run/缺时间、失败、stale/offline。Tab/Shift+Tab 可达 summary/刷新/表单，Enter/Space 开合，Start Work 与两类刷新继续有效，Escape 关闭一次并回焦。观察横向溢出、关键状态被折叠、未知被误显为成功任一项即不通过。截图与过程存运行态目录，不提交本机路径。

干净提交后，在本分支根执行 `node apps/harness-plugin/scripts/bundle-report.mjs --out .superpowers/ui-feedback-bundle`。对冻结的干净 base 用同工具链生成一份报告，再通过 `--base-report` 指向该报告运行，记录 raw/gzip/pack 实测差；两份 source identity 必须可比较，不能以 dirty 报告宣称包差。期望无新依赖、无新增 React external；差异为证据而非人为零增量。

最后在本分支根执行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`，期望零失败，并按五类人工检查公开面。整理提交后由协调者更新既有 draft，最终 push 后回读当前 head/base/checks/issue 关联/threads，只有最终检查通过才 ready；不合并。

回滚点：整个呈现提交。两批无数据库迁移或外部写入，撤销本 PR 即恢复原呈现。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 三区视觉语言、技术披露一致 | 定向组件断言与本地浏览器截图；状态/下一步不藏在 details 内 |
| Planning/运行/CI 正交 | succeeded 不改规划文字；CI 仍注明所属提交最后已知；缺口/unknown/候选关系负控 |
| 动作机制保留 | Start Work/retry/unknown、执行刷新、谱系刷新现有契约全绿；scope 切换/晚到/断开 canary 不退化 |
| 主题、长事实与键盘 | 上述宽度/文字放大/两主题实际观察，无遮挡/横溢、焦点可见、Escape/回焦通过 |
| 交付可独立审阅 | 小于 800/1300 的最终增删、实测包差、公开面扫描和当前 PR 回读 |

## Progress

- [x] (2026-10-30 +08) 两份独立设计及第三位 spec/plan 审稿收敛；源码边界已核对。
- [x] (2026-10-30 +08) Batch 1：定向 baseline 60/60；三个命名 RED 后呈现闭环 GREEN；非法确认时间追加 RED→GREEN，复用已有新鲜度判定。呈现定向 66/66；焦点追加后定向 73/73；`pnpm verify` 类型检查、2580 项测试及 7 项 MVP0 通过；`pnpm run boundaries` 9/9。
- [x] (2026-10-30 +08) Batch 2：协调者完成四场景真实浏览器、键盘恢复和干净包差；独立审查7/7负控通过并恢复。最终远端门禁按回读命令执行后交人类评审。

## Surprises & Discoveries

初始裸段落确有层级缺口，但现有 state/effect 已保护 scope、late result、刷新和 passed 保守降级，不能把视觉整理扩大成重写状态机。调查时另一个 delivery access 工作树也改谱系组件，故“完全无共享文件”不成立；本计划把 owner 缩至呈现区域，并要求稳定候选组合验证。

新增呈现确认时刻时发现 client 接受字符串而 ui-model 会把非法日期降级为 unknown；直接打印会把非法时间称为“最后确认”。已用真实坏日历时间触发 RED，再复用 `deliverySetFreshness` 保护显示，无新年龄算法。旧浏览器夹具仅覆盖执行 reader，production apply 缺 setup/start/delivery remote seam；扩展相同 fixture 的 remote 接线，并以 HTTP + 真实 client 严格解码验证。展示 query 中的 setup/执行/交付 DTO 为受控数据，不能充当安装 Host 或 Provider 验收。

## Decision Log

2026-10-30 +08 / 用户在本评审会话指定 PR #476–#478、#480；无P0/P1或只有P2/P3时，明确要求由评审会话负责「三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → `merge_method=rebase` 合并」。本PR首轮无可行动问题，完成独立复评与当前head门禁后按该条件授权收尾。该授权取代此前本计划在未授权时的禁止自行合并；不批准规划Status、native dependency或R1。

2026-10-30 +08 / 独立 spec/plan 审稿：保留 #448 单 PR，选垂直文档式分节与原生披露；理由是 340px 详情、多仓库和真实缺口需要线性阅读，两个设计都估算完整闭环可低于预算。文件与预算唯一声明见 Global Constraints。没有批准规划 Status 或依赖关系变更。

2026-10-30 +08 / 实现：状态、确认时刻、人工承接及恢复动作默认显示；执行路径和谱系身份/候选关系使用原生披露。仅增加呈现 markup、class 和无状态 helper，已有 hooks/effects/request/access 保持。呈现批次两项判别 mutation（默认打开披露、绕过 blocked passed 屏蔽）各被真实断言杀死并恢复；Node 测试通过后才记录为有效负控。展示夹具按已有主题 fixture 输入 light/dark token、system-ui 和 `font=200`，产品不拥有主题。

2026-10-30 +08 / 协调者与独立审阅者：浏览器实测基线 pending disabled 会丢焦，批准在 #448 原有焦点/反馈验收内增加最小局部恢复，不另建 issue。保留 native disabled；只记录一个 generation 票据，pending 的真实 focusin 到其他元素后永久撤销；结果仍属当前 open/connected 目标、表单和动作仍连接且 active 为 body/null 才恢复动作焦点。旧请求不清新票据，关闭/断开/换目标/卸载清理。禁止扩大为请求、intent、结果、reader 或权限状态机重写。新增未知/失败恢复的两个命名 RED 及晚到旧目标不得破坏新票据 RED 后，73 项定向 GREEN；焦点独立负控由审阅者在提交冻结后运行。

## Idempotence and Recovery

测试/渲染/截图可重复；展开和 resize 不发命令。浏览器 server 结束后停止本次进程。失败时保留失败证据，在本分支修正；不删除其他工作树或恢复他人文件。若当前权限候选与呈现冲突，由同一 owner 人工收敛对应 render hunk 后重跑定向命令，不能接受“任取一侧”丢失访问保护。

## Interfaces and Dependencies

仅依赖现有 client 类型、ui-model 安全投影与 React 原生元素。使用分支 `feature/ui-execution-feedback`、工作树 `.worktrees/ui-execution-feedback`，独立基于 main。交付评审命令必须带仓库：`gh pr list -R SingularityKChen/harness-projects --head feature/ui-execution-feedback --json number,headRefOid,baseRefName,isDraft,statusCheckRollup,closingIssuesReferences`；选出唯一 PR 后回读其 threads。PR #448 是 issue 关联，不应误用为当前 PR 号。

## Outcomes & Retrospective

实现观察为2026-10-30 +08、`b5a77af`；定向73/73，全量2580+7，边界9/9、类型检查通过，独立审查7/7命名负控KILLED且逐字节恢复，无遗留P0–P3。最终提交整理仅收敛历史与文档；最终head/base/checks以PR #476回读为准。

协调者实际浏览器覆盖1440px浅色运行完成、1024px深色失败、375px浅色/200%文字缺运行、320px深色/200%文字未知。四场景页面宽度与viewport相等、详情正文scrollWidth等于clientWidth；原生summary为44px或放大后的73px。Enter/Space开合披露，Escape一次关闭并回列表opener。键盘Tab到提交、Enter后焦点回“读回并恢复”，分支草稿保留。该证据来自受控本地展示fixture及生产组件，200%是文字放大，不称浏览器缩放或installed Host验收。矩阵同时发现既有容器标题零宽，由独立#479闭环承担，本PR不假称修复该容器问题。

冻结干净base与上述实现head的同工具链包差为：Host raw/gzip不变，client raw +5180B、gzip +1168B、pack +1214B，external imports不变、React未新增打包。无新增接受延期债务；部署/完整diagnostics、#449人类UAT和R1仍不在本次接受范围。

## Bottom Change Note

2026-10-30 +08：第三位审稿收敛单 PR 边界；实现批次补入三区呈现、命名 RED 与恢复负控、坏日期显示保护和相同浏览器夹具的严格 client 展示接线。保持 Active 等待独立评审。

2026-10-30 +08：协调者归档独立验收、真实浏览器与干净包差，补产品说明；保留#479及人类/发布验收边界。

2026-10-30 +08：补全本轮MMP风险矩阵、独立审查与条件合并授权；实现和既有产品验收范围不扩张。
