# PR #342 MMP 交付评审

评审对象：PR #342，immutable head `79aef82645a3cdd564cc5550424a9aefcd4991c5`，base `main@21cb29eb27ccc0cc6e0eebe61df6b6ae8c2f5bea`。评审日期：2026-10-15（第一轮）。评审账号：Singularity-AI-Bot。同批评审 #316、#343、#344 → #345。

## 锁定事实

| 项 | 当前事实 |
|---|---|
| 状态 | OPEN，非 draft，MERGEABLE，mergeStateStatus=UNSTABLE（只因可选检查红） |
| commits | `897d5135` docs(exec-plan) → `b9db9db5` test(contract)（HC1，共享套件 `declares()` 只读 `capability`）→ `831a98e7` feat(providers) → `79aef826` docs(exec-plan) |
| linkage | closingIssuesReferences=[#231]；#231 的阻塞项 #205、#279 均已关闭 |
| checks | PR Fast Gate、Verify、Merge Gate 四 lane 成功；`matrix.check` 失败是被取消的重复 Rule checks（`38688390565` cancelled，后继 `38688390737`、`38699295721` success）；`Create review session` 失败是本地评审端点未运行（`curl: (7) … 127.0.0.1 port 3081`），不在分支保护内 |
| 规模 | 代码 777 / 1000，文档 718 / 1500 |
| reviews / threads | 0 / 0 |

## 并集预演

main + 五个开放 PR（#316、#342、#343、#344 → #345）按两种顺序合并：冲突只在 `docs/README.md` 与 `docs/exec-plan/tech-debt-tracker.md` 的同锚点插入行，两边保留；两种顺序的 tree 只差这两个文件的行序。两个并集 `pnpm verify` 1678/1678 + MVP-0 7/7，boundaries 9/9，tsc 0，workflow-check 无发现；单独合入本 PR 1609/1609。TD-053–068 在并集中各出现一次，不重号。

逐个 rebase merge 时有一个合并陷阱：#343 的归档提交把 Active 行改成 `completed/`，机械「两边保留」会残留旧 `active/` 行并让 `harness-session-api-record` 用例变红。推荐次序与解法见 #343 的记录。

## P0–P3 风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 未见：verify 1609+7 全绿，boundaries 9/9 | 未见：评审变异 16/16 KILLED | **F1** 按 `headBranch` 列表先分页再过滤，偏离端口 | 观察流在产出前把全部 PR body 留在内存（并入 TD-063 即可） |
| 失败路径 | 未见 | 未见：401/403/FORBIDDEN/NOT_FOUND 分类、文案不外泄均有用例（N16、N18 KILLED） | 未见 | TD-062：能力快照只在组合时探测 |
| 产品闭环 | 未见 | 未见：独立 core 探针（Start Work 替身 + 本 provider + 脚本化平台）只挂上目标 PR，标题 / fork / 大小写诱饵都不入库 | **F2** 转交 #233 的内容未登记；core 端到端证据只在 git 忽略目录 | provider 未接入 Host，与 #231 Notes 一致 |
| 架构 | 未见：只依赖 domain 与 capabilities | 未见：PR node id 不作本地主键，仓库用本地键 | 未见 | — |
| 测试 | 未见 | 未见：作者变异表抽样 6/6 | F1 的另一面：共享套件「每页必须有命中项」对只读 provider 不可达 | HC1 的代价（H2 在 head 存活、base 杀死）；夹具回放键不含查询文本 |
| 工作项 | 未见 | 未见：HC1、HC2 问句与原话在 D27 | F2 | **F3** Outcomes / Progress 停在 HC 裁定之前；**F4** 计划引用其它 PR 才登记的 TD 号 |
| 发布面 | 未见：disclosure 无命中，`git diff --check` 干净 | 未见 | 未见 | 账号名与 `e1-sandbox` 已在 `gate-e1-sandbox.md` 公开登记 |

## 分层检查

### #231 验收逐条

1. 「found by its head branch and linked to that branch, never by title」：provider 层在录制与合成夹具上成立；评审另写 core 探针，在平台精确过滤与忽略过滤两种模式下都只挂上 `#7 目标`，CR 实体 id 为 `change_request-<32 位十六进制>`。成立。首页限制由人类 HC2 接受、转 #233。
2. 契约套件在录制夹具上无网络通过：119/119。成立。
3. 失去读权限得到 degraded capability：成立（N16、N18 KILLED）。
4. node id 不成为本地主键：provider 层成立；core 端到端与存储主键扫描转交 #233，但 #233 正文未登记（F2）。

### F1（P2）：先分页再过滤

`packages/capabilities/src/development-provider.ts:78-79` 写「先过滤再分页」。`provider.ts:127` 取平台 `first` 条后再按 `headBranch` 后过滤（平台 `headRefName` 过滤会带出 fork 同名 PR），于是出现短页甚至空页而 `nextCursor` 仍在。评审探针：目标前有 2 个 fork 同名 PR 时，`limit 1` 逐页读得 `[[],[],["PR_target"]]`，`limit 2` 首页 `[]`。共享套件的具名断言「每一页都必须有命中项」只对能建 PR 的 provider 可达；本 PR 的 `cursor-passthrough` 用例反把空页钉成期望；ExecPlan 第 152 行写「端口允许」。后果 fail closed（core 首页读找不到，不会挂错链），所以不阻塞；但这是端口语义偏离，#235 一类消费者会继承。base 上该包是占位，属本 PR 引入。

### F2（P2）：转交未登记

PR 正文称 core 端到端与首页 / 短页限制「handed to #233 acceptance 1」，HC2 原话为「接受，限制交 #233」。#233 正文最后更新于 2026-10-08、无评论；验收 7 只覆盖分支翻页。变更请求查找的首页 / 短页、存储主键扫描、TD-063 水位线协议三项在 #233 都找不到。

## 变异表（head `79aef826`，`scripts/review-mutate.mjs`）

| id | 改动 | 结论 | killedBy |
|---|---|---|---|
| 作者表抽样 M1/M2/M6/M7/M13/M19 | 原锚点 | 6/6 KILLED | 与作者表一致 |
| Q1 | orderBy 改 ASC | KILLED | query-drift |
| Q2 | states 只留 OPEN | KILLED | query-drift |
| N4 | 后过滤改 casefold | KILLED | start-work-branch-lineage（合成） |
| N7 | 额外声明 review.read | KILLED | 变更请求的分支与评审事实 |
| N9 | 扫描上界 off-by-one | KILLED | change-request-observations |
| N14 | CR 的 `first` 不钳位 | KILLED | 套件 + replay-ledger |
| N16 | NOT_FOUND 判成 unavailable | KILLED | permission-loss-degrades |
| N17 | 仓库闸门不看 key | KILLED | input-gates |
| N18 | 探针 not_found 仍报 available | KILLED | permission-loss-degrades |
| N19 | 观察 payload 丢 reviewState | KILLED | change-request-observations |
| H1 | local-git 漏实现已声明的 createBranch | head、base 都 KILLED | 本地 Git provider |
| H2 | fake 的 permission 报不可用但方法能用 | head SURVIVED / base KILLED | 刻画 HC1 的取舍（旧判据要求 `not_supported`，本身与端口义务 2 矛盾，不建议重议） |

## 已核实成立

- GraphQL：`pullRequests` 的 `headRefName`、`states`、`orderBy` 参数与官方 schema 一致；字段可空性与 decode 一致。
- `sourceVersion` 由 `updatedAt` 归一为 30 字节规范载体；同秒两次更新得到相同版本、不同 dedupeKey，按 R4 整快照替换收敛。
- 分支归属同仓且逐字节相等；大小写、前后缀、空白诱饵不混入。
- 命令（head）：`pnpm verify` 1609+7 exit 0；boundaries 9/9；`development-contract` + `development-github-contract` 119/119；`development-local-git` 73/73；只检出 HC1 提交 `b9db9db5` 时 161/161；size 777/718；disclosure、workflow-check、`git diff --check` 干净。

## 结论

P0 = 0，P1 = 0，P2 = 2（F1、F2），P3 = 2（F3、F4）+ 报告级说明。APPROVE，进入修复：F1 由 provider 在内部补满一页（不改端口），F2 在 #233 登记转交项，F3/F4 机械修复。

## 修复与复评（2026-10-15）

按评审流程（只剩 P2/P3），评审会话负责修复：修复由评审会话派出的实施者完成，修复本身另派独立复评。

| 意见 | 处置 | 证据 |
|---|---|---|
| F1 先分页再过滤 | 端口不改；provider 新增 `filteredPage()`：后过滤不足一页就在同一次调用内续取平台页（`first` = 还差的条数，`size = min(limit, 100)`，至多 100 个平台请求），游标为最后一个被完整消费的平台页的 endCursor；平台多给行、游标成环报 `malformed_response`；查询文本不变、录制夹具不重录 | 复评性质检验 3350 例 0 违例（修复前 22035 例违例）；F1a–F1f、R3、R4 被杀 |
| F2 转交 #233 未登记、core 证据只在忽略目录 | #233 登记三项转交验收，#231 写决策评论；新增 `tests/integration/github-development-lineage.test.js`（core 端到端，目标前置 60 个 fork 同名 PR、偏移游标），复评后它同时是 F1 的 core 级回归 | E4（CR 实体 id 用 node id）只被该用例杀死；F1a 被该用例杀死；`79aef826` 的 provider 上它为红 |
| F3 Outcomes / Progress 停在 HC 裁定之前 | 就地标 Superseded by D28 / D29，勾选并回填 | — |
| F4 计划引用其它 PR 的 TD 号 | 改为带 PR 号的写法 | 全文只剩 base 已有与本 PR 登记的 TD 号 |
| 复评 N1–N4 | TD-068 残余限制补上 fork 极多时的阈值（约 100 ×（50 − 目标之前的同仓库同名 PR 数），记为 gap 不挂错链）；集成用例改为 F1 的 core 级回归；补「续取页多给行」与 `limit 101` 断言；D28 边界 (1) 改为「不预读就无法知道」 | R3、R4 由存活变为被杀 |

修复后读数（整合前 head）：`pnpm verify` 1610 + 7；开发相关测试 194/194；boundaries 9/9；size 代码 889 / 1000（超过 800 的规划线、低于硬上限，增量是 provider 补页与 core 端到端用例，复评认为无可机械删除的冗余）、文档约 870 / 1500。
