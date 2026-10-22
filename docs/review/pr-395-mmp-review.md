# PR #395 MMP 交付评审

- 日期：2026-10-22 SGT；范围：#282 的已记录执行状态到实际插件抽屉。
- 独立初审：APPROVE，无 P0/P1，两条 P2；协调者已发布 review `5608692054` 及两条 inline。
- 初审锁定 head：`fe24c5e6fba1354f0c2b821ad8da129f61069e3f`；base：`main@d7e7bca6aae31a4329f3238d3b90274dd683516c`；本地、REST、GraphQL 一致。
- 执行上下文：检出 `feature/drawer-execution-state` 的 `.worktrees/drawer-execution-state` 根目录。修复自验时证据为该父提交加受控工作树差异；不能冒充新 immutable head 的独立批准。
- 实现 owner：本评审者按协调者转录的人类授权修复；授权逐字记录在该 PR completed ExecPlan 的 Decision Log；协调者另派独立 reviewer。实现者未 commit、rebase、push 或外部回复，后续由协调者整合；Planning Status 未改。
- 初审 live facts：PR OPEN、非 draft、可合并；`PR Fast Gate`、Verify、Merge Gate 及四 lane、CodeQL、policy、size、disclosure 均成功；仅可选 `Create review session` 失败，由 #364 承接。REST reviews/comments 原为空，GraphQL threads 空且无分页；发布初审后以当前远端回读为准。
- 方法：Superpowers 独立审查、Qian 整体数据流综合、First Principles 的事实所有权和反例；后续修复采用 TDD 与已归因的统一变异。

## 初始风险矩阵与综合结果

| 级别 | 审查前风险 | 全矩阵结论 |
|---|---|---|
| P0 | 跨 workspace 泄露、规划权威被工程状态覆盖 | 未发现；Host 固定 workspace、核对三键；读取无规划/运行/关系写入 |
| P1 | Panel 链断开、运行状态错误、旧响应覆盖新条目 | 未发现；真实生产 Panel 可达，runStatus 来自 Core run；目标键与 cleanup 隔离 |
| P2 | 降级、空态、部分仓库失败误导、测试判别不足 | F1 同目标失败丢 last-success；F2 迟到成功保护变异存活；均已修，独立复评 APPROVE |
| P3 | 展示和归档表达 | 无单独意见；保留边界说明，不把绿灯当产品全交付 |

## 全部分层结论

| 层 | 已核对的事实与证据 |
|---|---|
| 代码正常/失败 | `readExecutionContext` 从 `runIdFor(contextId)` 的存储 run 取八种状态，fallback 是独立字段，不从 Ready/degraded 反推；两 Storage 覆盖无 run。Host/remote 原始错误固定化，client 先解包 RemoteResult 再严格解码 |
| 产品全链 | 生产 apply → bindWorkItemApp → App → ProjectPage → Drawer → Section；reader → OPERATIONS 派生 remote → installHostRemote → 捕获 workspace 的 handler → Controller → Core → SQLite。浏览器实际打开同一 Panel，非手工传 DTO 的演示 |
| workspace/可见性 | App 路由 scope 门、列表读门、detail 二次 contentKind 复验；只有 WorkItem 产生 target。Host 读前/后检查 WorkItem，PR/redacted/缺失返回 null，并核对结果三键；client 拒绝错 scope、未知字段/枚举/原型 |
| 竞态/恢复 | key 含 workspace/item/排序仓库，Drawer key 随目标变；cleanup 使旧 resolve/reject 失效。修复继续限制同 key 同 repo 保留结果；新目标/仓库集合不复用，断线旧响应不落地，重连重新读取 |
| 错误/部分仓库 | 同 repo 的最后成功（含明确 null）与 refreshing/error 独立；成功按 repo 替换一次，失败保留并标最后已读。一仓库失败不遮蔽另一成功；元数据缺失、无上下文、无 run、unknown 与字段缺失分开，文本转义 |
| 架构/七不变量 | 单 Planning 权威、多研发/交付连接、工程轴正交保持；无 LLM 门禁/关系判断，沿既有 run 身份读事实，Host 权威。UI 不调用 Provider；无 schema、凭据、外部写入或持久缓存；查询前后 context/run/baseline 逐字不变，Provider 陷阱调用数零 |
| 测试/产物 | 初审目标 40/40、artifact/boundaries 32/32；修复后完整 verify 1772+7 全绿。客户端纯值出口及 Node/Core/Provider 不可达由产物契约覆盖；变异和真实浏览器补充断言证据 |
| issue/计划/规模 | #282 三项 acceptance 均有 Controller/UI/真实入口证据，Closes 同仓 issue；completed ExecPlan 章节齐全、索引与纵向路径限定本切片。当前工作树相对 base 代码503行、文档317行（含本记录）；低于任务800/1300与仓库1000/1500，提交后由协调者重跑机械门禁 |
| 发布面/边界 | 初审 disclosure、size、diff-check exit 0，人工五类目未见真实敏感值；修复仅 Section、其测试和本 PR 两份文档。未把真实 Harness 安装、真实模型会话、持续采集、R1 或人类走查写成已通过 |

## 全部 finding 与修复

**F1 · P2 · 同目标刷新失败抹掉已读路径和分支。** 初审新增行锚点 `packages/ui/src/execution-context-section.ts:15`；已成功读取 manual fallback 后，临时 unary 失败并刷新，原实现先清空结果，仅剩固定失败文案。真实浏览器已复现；与计划“失败读取保留同目标最后读数”不一致，但无数据丢失，故非 P1。
修复：结果携带独立 refreshing/unavailable 标记；仅同 key 同 repo 继承 context（包括 null），成功替换该 repo、失败保留并明确“最后已读”；换目标或仓库集合仍清空。未增加持久缓存、Provider 调用或公共接口。
TDD：新 `refresh failure preserves each repository last success including null, then replaces it on success` 首次在旧实现失败，期望 `/fixture/work/` 而实得“正在读取执行状态”；修复后通过。覆盖 context/null 保留、再次成功替换、单仓库失败另一仓库成功、唯一字段与仓库集合切换。
已有 issue：#360 是 Planning 刷新，#365 是 Provider 运行刷新，均不覆盖本地 Section 的此具体丢失；#156 是广义 E2E。未重复创建 issue。状态：修复自验完成；独立复评 APPROVE。

**F2 · P2 · 删除迟到成功保护后回归仍绿。** 初审新增行锚点 `tests/contract/ui-execution-context.test.js:62`；旧 B 结果后检查无 canary，但新 A 完成后仅匹配泛化空态，未再次排除旧值。原实现保护存在，故是测试缺口而非当前代码 P1。
修复：新目标全部完成后再次排除旧 canary；按 repo 核对唯一段、路径/分支/状态不混用；增加同目标连续刷新“新结果先到、旧成功晚到”、断线旧成功/旧拒绝和重连新读的反例。
TDD：只补断言、未改实现时，原 R3 已从 SURVIVED 变 KILLED；最终树 R3 再由同目标逆序用例杀死。已有 #156 未覆盖此最小断言缺口，未另开 issue。状态：修复自验完成；独立复评 APPROVE。

## 命令、变异与真实浏览器

以下命令在上述检出根目录运行；修复后完整命令真实输出为 exit 0：

```text
node --test tests/contract/ui-execution-context.test.js
# TDD RED: tests6/pass5/fail1；实施后 GREEN: tests6/pass6/fail0
node --test tests/contract/ui-execution-context.test.js tests/integration/harness-plugin-execution-drawer.test.js tests/integration/execution-context-run-status.test.js
# tests10/pass10/fail0
pnpm verify
# typecheck success；tests1772/pass1772/fail0；MVP-0 tests7/pass7/fail0
```

变异统一经 `node scripts/review-mutate.mjs`，spec command 是上一段的十项目标测试；每项 killedBy 如下。初审四项整表 exit1（R3 存活），修复最终六项整表 exit0，前后基线全绿、原文字节恢复；不是测试失败被忽略。

| ID | 变异/所在文件 | killedBy | 初审 → 最终 |
|---|---|---|---|
| R1 | Core `execution-context.ts` 的 `runStatus: run?.status` → undefined | `Controller runStatus is the stored run` | KILLED → KILLED |
| R2 | client 同名文件移除 `dto[key] !== scope[key]` 比较 | `reader decodes nullable JSON roundtrip` | KILLED → KILLED |
| R3 | Section 成功回调 `if (current)` → `if (true)` | 最终：`same-target refresh keeps the newest` | SURVIVED → KILLED |
| R4 | Host `!visible` 读后守卫改 false | `real Host/remote returns exact nullable DTO` | KILLED → KILLED |
| R5 | Section 刷新初始化不继承同 key 同 repo 的旧结果 | `refresh failure preserves each repository last success` | 新增 → KILLED |
| R6 | Section 将明确 null 当成从未成功读取 | `refresh failure preserves each repository last success` | 新增 → KILLED |

真实浏览器由 `node tests/fixtures/execution-drawer-browser.mjs` 启动真实 Host/SQLite，Playwright CLI 使用独立 session；JSON 桥复用生产 apply 与实际原生 drawer。
初审复核 manual fallback、succeeded 刷新、PR/遮蔽无段、断线晚响应和重连。修复后控制 `window.fixture.command('fail', true)` 再点刷新，工作树/分支/运行状态/人工处理四项逐字保留，新增“暂时无法读取执行状态（最后已读）”，原始错误不泄露。
再恢复读取并改本地 run=succeeded，显示“已完成”且清除陈旧标记；pause旧请求→切换另一条目→release 后旧四项不出现，新条目明确空；PR无段；redacted baseline→release后仍无段。
最后把本地 run 改 failed、pause刷新→disconnect→release，仍保留旧 completed；重连 baseline 后读取 failed。探针返回 targetIsolation/prAndRedacted/disconnectAndReconnect 全 true，planning revision `1→1`。
控制台只有夹具 favicon404 与正常 watch 日志，无脚本异常观察；fixture 和浏览器已关闭。测试桩 run 更新不代表真实会话结束，桥验证不等于已安装真实 Harness。

## 结论、边界与下一道门

初审建议 APPROVE，所有分层搜查已完成，无 P0/P1；F1/F2 已按授权修复并自验，另派 reviewer 的独立复评 APPROVE、无新增问题；本人未批准自己的修复。
#365 已跟踪持续运行采集、确认时间和 Provider 不可达 stale；本 PR 只读取已存状态，不能声称当前真实会话仍 running。#140/#359 真实执行接线、#143 人类宿主走查、完整 R1 保持原边界，未重复报阻塞；#341 的历史句柄处理也非本 PR 新写入行为。
协调者在提交整合后必须重锁新 head/base、checks、threads、issue关联与规模/披露，再处理外部回复和人类已授权的 rebase merge；Planning Status 保持人类拥有。head/base变化使旧独立结论失效，不能转移旧绿灯。

## 恢复与证据归属

变异 runner 已恢复原文字节，浏览器与 SQLite 夹具关闭；代码回滚只需撤销这次 Section/测试差异，不操作用户工作树或持久运行记录。初审、修复自验与独立复评证据分开；协调者提交后的精确 head 仍须重锁远端门禁，不将旧 head 的 checks 转移。

独立复评（协调者转录，2026-10-22）：组件/详情30/30，临时副本的旧拒绝、workspace切换、reader替换三项反例共9/9；四项成功/拒绝guard、last-success、明确null变异均KILLED且killedBy准确，字节恢复。本地读取独立变异日志确认四项归因，复评所锁 Section SHA256 `7f2b503b23b8a576a0ce6a85dc311c2bae523bce215055e997f44b5f1eaadce8` 与当前文件实算一致；未重复运行其测试或全量验证。

## 最终真实 main 整合

#393/#392/#394 已依次 rebase 合并，本 PR 变基至 `main@5f4dcbe6f080d30b9df3e1cddd4832ff03a1e9ca`。四处冲突按已审方案解决：同时保留 refreshPlanning/getExecutionContext，使用捕获 workspace 的 handlersFor，保留 scheduler start 与 stop/drain/close。
产品文件集合与已通过 1808/1808 + MVP-0 7/7 的修复并集 `a4440bd45b725d7f2c398127200db765bab49c06` 的完整 Git blob 清单一致，SHA-256 为 `dcbd55267c3ca727ec892aef0825d965127ddd2ab515c9ba8f71b21c3d6f2807`；UI 修复源码也保持独立复评哈希不变。当前文档、最终 head 的相关回归、CI、threads、原生 issue 关联仍由协调者在发布后回读，旧批准不转移。
