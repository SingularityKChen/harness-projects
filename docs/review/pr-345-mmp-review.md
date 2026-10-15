# PR #345 MMP 交付评审

评审对象：PR #345（原生栈 #346 上层），immutable head `6fc33768215860aa56261e5d729342bdc1368e07`，base `feature/host-provider-composition@697b283c2c3442a9f58ba83cdf9354693434e06d`（#344），main `21cb29eb`。评审日期：2026-10-15（第一轮）。评审账号：Singularity-AI-Bot。同批评审 #316、#342、#343、#344。

## 锁定事实

| 项 | 当前事实 |
|---|---|
| 状态 | OPEN，非 draft，MERGEABLE，mergeStateStatus=UNSTABLE（只因可选检查红） |
| commits（本层） | `06bf19c6` plan → `d2897a47` feat(client) → `979828dd` feat(apps) → `6fc33768` docs 回填 |
| linkage | closingIssuesReferences=[#276] |
| checks | PR Fast Gate、Verify、Merge Gate 四 lane、CodeQL 成功；`matrix.check` 失败是被取消的重复运行（`38701292822` cancelled，后继 `38701305674`、`38701667918` success）；`Reconcile engineering state` 被全局并发组顶掉（`38701795048` cancelled，后继 success）；`Create review session` 失败是本地评审端点未运行 |
| 规模（相对 #344） | 代码 717 / 1000，文档 923 / 1500 |
| S3 绑定 | 评审在 head 重建：`lib/index.js` `855c4934ac91…`、`lib/client.js` `cba8f8903eec…`，与正文一致；冻结代码树 `431a5e8d` 与 head 在 `apps`、`packages`、`tests` 下无差异 |

## 并集预演

见 #342 记录：并集全绿；#344 + 本层合并点 1606/1606 + 7/7、boundaries 9/9。本层与 #316 无语义交互（Host wire 面只有 `baseline`、`bootstrapWorkspace`、`watch`，`applyPlanningStatus` 不经 Host）。

## P0–P3 风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 未见：verify 1606+7 全绿 | 未见：`gap` 后同步 `restart()` 在同一句柄重拉 baseline，自愈 | **F1** 面板保护在真实 Cordis 下不成立 | **F3** 缺省可中止等待无用例 |
| 产品闭环 | 未见 | 未见：AC1 有宿主内观测 | **F2** 宿主结束一代即永久停更，承接 issue 已关闭 | AC1 delta 归因限度（作者已披露 D37(5)） |
| 架构 / 依赖 | 未见：boundaries 9/9 | 未见：浏览器 bundle 只带入 `controller/src/values.ts` | 未见 | 未见 |
| 测试 | 未见 | 未见：抽样变异在替身与真实 `RemoteStream` 类上都杀死 | F1 的测试建模错误 | F3（R5 存活） |
| 卸载 / 并发 | 未见：卸载排空用例 + R2、R4 KILLED | 未见 | 未见 | **F4** 无上限排空，#338 把流列为范围外 |
| issue 验收（#276） | 未见 | 未见：三条都有证据 | F2：#229 承接缺口 | 未见 |
| 工作项 | 未见 | 未见：ExecPlan lint OK，TD-057–060 不冲突 | F2 | 未见 |
| 发布面 | 未见：disclosure（含 PR 正文）无命中 | 未见 | 未见 | 未见 |
| 栈 | 未见：本层只引用 #344 已有事实 | 未见 | 未见 | 未见 |

## 分层检查

### #276 验收逐条

1. 宿主内 baseline + 至少一个 delta：S3 `watch baseline r=1 gen=1` → `watch delta r=2 gen=1`，同一句柄同一代。delta 同时含换令牌后新可见的 6 个条目，#3 的 Status 改动在这次 upsert 里且发生在规划改动之后，判定满足；只改 Status 的复观测由人类决定。
2. 断流整表 stale、重连在同一句柄重拉 baseline：S2 宿主侧测试，替身与真实 `RemoteStream`（`HARNESS_GATEWAY_CLIENT` 指向 `@deepseek-ai/dsh-api-gateway` 0.2.0-rc.2，原型方法 `signal/restart/dispose/read`）上 9/9 通过，变异杀死。宿主内断线重连未观测（正文已披露）。
3. 只承载 controller 暴露的值：帧深等 controller 值的 JSON，`toJson` 是严格编码点（M5）；浏览器 bundle 不含 `streamWorkspace`、`watchWorkspace`、`diffSnapshots`、`createController`、`node:sqlite`。

### `gap` 种子（作为 P1 被证伪）

在 retain=∞ 且带 seed 的流里，controller 只在「同修订上业务字段变化」与「修订倒退」时发 `gap`；之后 `restart()` 在同一句柄重拉 baseline，自愈（client-stream 第 2 条，M9 在真实类上 KILLED）。真正会永久停更的是：宿主结束一代、宿主读取异常、帧被拒、库重建（TD-059）——归入 F2。

### F1（P2）：面板保护不成立

`client.ts:30-31` 注释、提交 `979828dd` 正文、PR 正文与 D32(3) 都说「面板先登记，watch 同步打开失败不丢面板」。Cordis 4.0.4 `Fiber._reload` 捕获回调异常后把 epoch 置 INACTIVE 并 `_unload()` 该 fiber 全部 disposables；renderer 0.2.0-rc.2 `slots.inject` 的控制器属于调用方 fiber。真实 Cordis `Context.inject` 跑各树真实 `client.ts` 的 `apply`、子 Context 不带 `$stream`：base `{"registered":["main:harness-projects","sidebar.panellist:harness-projects"]}`，head `{"registered":[]}`，head 加 try/catch 后两项保留。安装件测试 e 节的假 Context 不建模「抛错 → fiber 卸载」。0.2.0-rc.2 有 `$stream`，受支持宿主上触发不了，所以 P2。

### F2（P2）：TD-058 无活着的承接

TD-058 延期理由指向已关闭的 #227；#127、#131、#229 都未登记。触发场景：插件重载、卸载、TD-055 的 Host 重组（空数据根上创建首个工作区即触发）；宿主读取异常经 `guarded` 后客户端同样永久终止（真实类上 `carrier.opened===1`），不在任何 TD 里。`WorkspaceFollower` 无 reopen 接口，#229 的「reconnecting repulls the baseline」会原样继承缺口。

### 负载核实（TD-057）

每流每秒一次全量本地读，不发 provider 网络调用：15 实体 0.34 ms / 20 次 SQLite 读；205 实体 3.98 ms / 210；1005 实体 36.8 ms / 1010。面板关着也在轮询，与 TD-057 的触发条件一致；读与事务共用一条队列，不会读到未提交值。

## 变异表（head `6fc33768`）

| id | 改动 | 结论 | killedBy |
|---|---|---|---|
| R1 | 壳里不调 `carrierFailed` | KILLED（替身与真实类） | host-watch AC2 |
| R2 | watch 不计入排空 | KILLED | 契约 drains an open watch |
| R3 | 终止时不标 stale | KILLED（替身与真实类） | host-watch 卸载 |
| R4 | 不接入 lifetime | KILLED | 契约 + host-watch 卸载 |
| R5 | 缺省等待忽略中止 | **SURVIVED** | —（F3） |
| R6 | 客户端侧 gap 改为终止 | KILLED | client-sync 接受点 |
| R7 | 允许同代第二个 baseline | KILLED | follow 违例 |
| M8 / M9 / M10 / M13 | 作者原锚点，真实类复跑 | KILLED | 与作者表一致 |

## 命令与结果（head）

四份目标测试 18/18；`pnpm verify` 1606+7 exit 0；boundaries 9/9；workflow-check 无发现；size 717/923；disclosure、`git diff --check` 干净；ExecPlan lint OK；plan-facts、content-placement 9/9。

## 结论

P0 = 0，P1 = 0，P2 = 2（F1、F2），P3 = 2（F3、F4）+ PR 级一条。APPROVE，进入修复。修复约束同 #344：改变 `lib/*.js` 字节的修复须重做 S3 或经人类裁定。**合并次序：#344 之后。**

## 修复与复评（2026-10-15）

按评审流程（只剩 P2/P3），评审会话负责修复：修复由评审会话派出的实施者完成，修复本身另派独立复评。F1 的代码修复会改变 `lib/client.js` 字节；评审会话就此直接问仓库所有者，答「修，沿用 S3 证据 (Recommended)」（2026-10-15 16:44 +08，逐字记入计划 D38），裁定范围只限这一条失败分支改动。

| 意见 | 处置 | 证据 |
|---|---|---|
| F1 面板保护不成立 | `client.ts` 用 try/catch 包住 `openWorkspaceWatch(child)`，同步打开失败记日志并 return，面板保持；安装件测试 e 节的假 Context 按 Cordis 4.0.4 fiber 语义建模（回调抛错卸载该 fiber 全部 effect，卸载逐个捕获并记日志），另可经 `HARNESS_CORDIS` 用真实 Cordis 复跑 | 新用例在评审前的 `client.ts` 上模型与真实 Cordis 都红、修复后绿；M23（去 try/catch）、M25（catch 不 return）等 F1 变异全杀；新旧 bundle 只差这一处 |
| F2 TD-058 承接已关闭 | 登记到 #229（Host 结束一代、Host 读取异常、帧被拒三种终止都要能自愈），TD-058 补上读取异常这一终止来源 | #229 评论 |
| F3 缺省可中止等待无用例 | `workspace-stream` 第 3 条 | R5 / M24 被杀，只红这一条 |
| F4 流加入无上限排空 | 登记到 #338（有界排空覆盖 watch 流），风险 R3 指向该登记 | #338 评论 |
| 复评 N1–N3 | D38 理由订正；RF1-d 由抛错用例末尾的卸载断言杀死；Batch 6b 的 sha256 表述改为「等于 D38 记录的值」 | — |
| 复评观察：`dist/` 让单写者扫描变红 | main 既有，开 #350 承接 | — |

修复后产物：`lib/index.js` `855c4934…`（不变），`lib/client.js` `46eb7fe01fc3…`（只差 try/catch）。修复后读数（整合前 head）：五份目标测试 42/42，真实 `RemoteStream` + 真实 Cordis 三份 32/32，`pnpm verify` 1607 + 7，计划变异整表 M1–M25 全杀；size 代码 786 / 1000、文档 958 / 1500（相对 #344 原 head）。
