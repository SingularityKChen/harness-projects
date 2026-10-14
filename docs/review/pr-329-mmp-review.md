# PR #329 MMP 交付评审

评审对象：PR #329，immutable head `1cccf9a4fea7ded73a025fb5658d7c8b8d2709d1`，base `main@7c7e77ccc770b77f8c1cc7d3d6827ac6d854bc60`。评审日期：2026-10-14（第一轮；此前没有任何评审）。评审账号：Singularity-AI-Bot。

## 锁定事实

| 项 | 当前事实 |
|---|---|
| 状态 | OPEN，非 draft，MERGEABLE，mergeStateStatus=CLEAN |
| commits | `b2e5a4d5` docs(exec-plan)（Refs #228）→ `b7e2d4f9` feat(apps)（Closes #228）→ `24976d63` docs(apps)（Refs #228）→ `1cccf9a4` docs(apps)（Refs #228） |
| linkage | native closingIssuesReferences=[#228] |
| checks | PR Fast Gate、CI Verify（`38522191787`）、Merge Gate 四 lane、Issue policy、Engineering state 均成功；被取消的 Rule checks `38522191725` 由 `38522213365`（size / disclosure success）取代 |
| reviews / threads | 0 / 0 |
| 规模 | 代码 784 / 文档 206（任务上限 800 / 1300，CI 上限 1000 / 1500） |
| 整合改动 | 相对整合前 `c494a62c` 删除无消费者的 `HostRemoteDescriptor` 与一条只匹配死类型字面量的断言；两个 head 构建出的 `lib/index.js`、`lib/client.js`、`package.json` sha256 逐一相同，历史 S3 观测对当前 head 适用 |

## 并集预演

四个开放 PR 在 `main@7c7e77cc` 上按两种顺序合并，唯一冲突是 `docs/README.md` Active 索引 add/add 行；并集 `pnpm verify` 1542 + MVP-0 7 全过。#331 的 scheduler 由 Host 生命周期持有，#335 承接，并集中没有缺陷。

## P0–P3 风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 未见：凭据入库变异 M3 被杀；产物中 grep 不到 fake，M4 被边界测试杀死 | 未见：部分初始化失败、register 失败、卸载、卸载后保留调用均关闭或拒绝 | client 把网关 `RemoteResult` 的失败分支当成功记日志；result codec 在宿主网关里从不被调用 | minify 只为躲文本正则；数据根自实现 home 解析；drain 无上限；`$mount` disposer 被丢弃；factory 契约未写 binding id 必须稳定（#132 跟踪） |
| 产品闭环 | 未见 | **`Closes #228` 会关闭两条未观测的验收**：真实 Desktop 里 Host 从未 apply（缺 `harnessProjectsProviders`），验收 1（client→Host 一次 query + 一次 command 往返的记录观测）与验收 2（packaged 插件带宿主版本、在干净 profile 上建库迁移的记录观测）均未达成，#132 的验收也不承接这两条 | 缺服务时用户看到的仍是占位面板，console 把失败记成「received」 | — |
| 架构 | 未见：不变量 7 成立；凭据只以句柄进入；无第二权威源 | 未见 | 边界按整个 `apps/harness-plugin` 包放宽，不是 #228 要求的「host entry only」，host-only 没有被测试钉住；规则变更与功能混在同一 PR（`docs/review/README.md` §6） | 边界测试文件头边表过时；`actorRef` 由 client 自报 |
| 测试 | — | — | 「provider 收到解析值」「按操作解析」无判别力（M1、M2 存活）；Host 入口卸载与部分初始化失败无用例（M6、M7、M15 存活） | 源码正文正则断言；「fake 不进产物」断言空转 |
| 工作项 | 未见 | 同产品闭环 | ExecPlan Batch 2 验证命令引用不存在的 `harness-plugin-unload.test.js`，`node --test` 静默跳过、退出码 0；验收表第 2、5 行与 Batch 3 声称的证据不存在；PR 描述「packaged `lib/index.js` + migrations roundtrip」超出证据 | ExecPlan「未注入 credentials」与第 132、140 行及事实不符；ADR 索引仍写「十二条」 |

## 分层检查

### 产品闭环（P1 的独立复核）

- #228 验收原文：验收 1 要求「From the client half inside the host, one query and one command complete a round trip (recorded observation)」；验收 2 要求「The packaged plugin creates and migrates its database on a clean profile ... (recorded observation with the host version)」。
- 本 PR 的 S3 记录：Desktop `0.2.0-rc.2` 安装成功、401、403、带合法 cookie 的 typed endpoint 返回 404（Host fail closed，未注册 service）。ExecPlan Progress 中 S3 一项仍为 `[ ]`，PR 正文也写正向 200、unload/reconnect、retained-call 待定。
- #132 的 7 条验收中没有「client→Host 正向往返」与「packaged 插件在宿主中建库」的记录观测；作者 2026-10-13 在 #228 与 #132 的交接评论把 provider factory 等实现交给 #132，但没有转移这两条验收。
- 「须等 #132 的兼容 credential service」不成立：宿主自带 `credentials`（`dsh-credentials` 的 `REF_PATTERN` 与 `host.ts` 的正则一致，`dsh-credentials-local` 的 `resolve` 返回 `{ value, source }`）。实际只缺 `harnessProjectsProviders`；ExecPlan 第 132 行记录的启动失败来自测试 bundle 覆盖了内置 `credentials`。重启探针显示 factory 若用随机 binding id，第二次 apply 报 `UNIQUE constraint failed`，固定 id 则两次成功。
- 结论：合并即关闭 #228，两条验收无人承接，定 P1。与 PR #331 第一轮（无 Host caller 却声称完成 #134）同一判据。

### 代码（P2 的独立复核）

- 网关 `@deepseek-ai/dsh-api-gateway@0.2.0-rc.2` 的 client `invoke()` 在失败时 resolve `{ ok: false, error }`、catch 分支返回 carrier failure，不 reject；`client.ts` 的 `onRejected` 碰不到宿主失败，失败会走 `console.info('... baseline received', value)`。
- 网关 Host 侧 `encodeRpcResult` 对 strict 结果只调 `codec.encode`，`create().parse` 只用于参数 `decode`；`jsonOutput` 只实现 parse，结果严格性在生产路径上不生效，`harness-host-remote-adapter.test.js` 钉住的是生产不走的路径。

### 已核实成立的部分

- `createSqliteStorage` 只加可选 `migrationsDir` 透传；锁文件只多 3 个 workspace link；新 clone 构建的 `migrations/` 001–007 与源码逐字节相同。
- codec 拒绝 `__proto__` 键、`constructor` 键、继承属性、未知字段与数组。
- 删除 `HostRemoteDescriptor` 与对应断言：在 `c494a62c` 上 `git grep` 只命中定义本身，删除成立。

## 变异表（当前 head，`scripts/review-mutate.mjs`）

| id | 改动 | 结论 | killedBy |
|---|---|---|---|
| M1 | provider 收到 reference 而不是值 | SURVIVED | — |
| M2 | 凭据跨操作缓存 | SURVIVED | — |
| M3 | 解析值写进 workspace name | KILLED | Host entry … without persisting the value |
| M4 | 缺 factory 时回退 fake provider | KILLED | 边界测试（跨包 import / manifest） |
| M5 | client 可达模块 import controller | KILLED_OTHER | 只被 esbuild 浏览器构建（`node:crypto`）拦下，边界测试通过 |
| M6 | 部分初始化失败不 close | SURVIVED | — |
| M7 | 卸载不关闭 composition | SURVIVED | — |
| M8 | dispose 不排空在途调用 | KILLED | drains an in-flight call |
| M9 | 卸载后仍接受调用 | KILLED | unregisters idempotently |
| M10 | descriptor codec 接受未知字段 | SURVIVED（composition 层仍拒绝） | — |
| M11 | 绕过包内 migrations | KILLED | 宿主就绪行 |
| M12 | 去掉 minify | KILLED | .ts 说明符用例 |
| M13 | 去掉 legalComments | SURVIVED（选项多余） | — |
| M14 | result codec 改恒等 | KILLED（但校验的是网关死路径） | same strict unary descriptors |
| M15 | Host disposer 抛错 | SURVIVED | — |

## 意见清单（inline 17 条 + PR 级）

- P1 ExecPlan:29 `Closes #228` 关闭两条未观测的验收。
- P2 × 7：`client.ts:19` RemoteResult 失败当成功；`remote.ts:113` result codec 不生效；runtime-adapter 测试:59 M1/M2；runtime-adapter 测试:76 disposer 未被调用；`package-boundaries.test.js:89` 整包放宽；ExecPlan:65 验证命令空转；ExecPlan:116 声称的证据不存在。
- P3 × 9：见矩阵。
- PR 级：修正描述中超出证据的三处说法；`actorRef` 应由 Host 从已认证连接推导（写入 ADR-0013 Consequences 或 #229）；`docs/review/README.md` §6「规则变更单独提交」与 #228 把边界放宽划入本 PR 的冲突、以及 ADR-0013 仍为 Proposed 时放宽边界进入 main，均需人类伙伴裁决。

## 结论

**REQUEST_CHANGES**：一条 P1（工作项 / 产品闭环层）。修复方向二选一：

1. 用只提供 `harnessProjectsProviders`、固定 binding id、不覆盖内置 `credentials` 的一次性测试 bundle，在真实 Desktop 补齐验收 1、2 与卸载的记录观测，保留 `Closes #228`；
2. 改为 `Refs #228`，或经人类伙伴批准把验收 1、2 转给具名 issue（原话写入 Decision Log，并在来源 / 承接 issue 写决策评论）。

## 后续 owner 与复审条件

- 作者为 Codex 会话，本机无 Claude 作者会话；修复 owner 需人类伙伴指定。
- 修复后复审：重锁 head / base / checks / threads；按原条件复核 P1（验收 1、2 的记录观测或经批准的转移）；对新增测试做 M1、M2、M6、M7、M15 的变异复测；独立复评修复本身。

## 提交回读

2026-10-14 由 Singularity-AI-Bot 一次性提交 review `5514309869`（REQUEST_CHANGES，inline 17 条，commit_id 为本记录锁定的 head）；回读 inline 数一致。提交后 mergeStateStatus=BLOCKED，原因是分支保护要求所有对话已解决。

## 人类裁决与修复（2026-10-14）

- **owner**：人类伙伴在本会话指定「本会话负责」修复与收尾（问「四个 PR 的修复与收尾由谁负责？」，答「本会话负责（推荐）」）。
- **P1 的处置**：人类伙伴先说明「我们上午测过需要#132 真实的 provider 之后才能联合验收」，随后在「改 Refs」与「保留 Closes、验收转进 #132」之间选择后者。#132 已增补 #228 验收 1、2 的原文，#228 写了决策评论；本 PR 保留 `Closes #228`，ExecPlan 的 S3 进度项与 ADR-0013 只把这两条写成转入 #132，宿主内 unload/reconnect 与 retained-call 观测写成残余风险。
- **§6 例外**：人类伙伴批准把 Host 入口的边界放宽留在本 PR（「批准例外，留在 #329（推荐）」）；ADR-0013 保持 Proposed 合入；整合时 ADR 提交排在放宽之前。
- **第一轮修复**（17 条意见）：client 按 `RemoteResult` 分支；result codec 实现 Host 侧 `encode`；凭据「收到解析值 / 按操作解析」在 provider 外记录后断言；Host 入口卸载、部分初始化失败与 register 失败真正调用 disposer；边界只允许 `host.ts` / `host-composition.ts` 依赖 core / controller / storage，并以 client 入口可达性测试钉住；ExecPlan 验证命令与验收证据对齐；去掉只为躲正则的 minify；「fake 不进产物」改查 metafile。代码体量保持 800。
- **第一轮修复的独立复评**：无 P0 / P1；新 P2 × 2（S3 进度项越权、缺 Core 写进 Host SQLite 的正向断言）与 P3 × 6。
- **第二轮修复**：S3 表述收回到人类批准范围并注明历史观测构建为 `c494a62c`；卸载后只读打开 Host SQLite 断言 workspace 与 entity 行（R1 被杀）；补回 workspace 名透传（R16）、根 Context 守卫（R6）、卸载先排空再关闭（R7）；人类决定的时刻按回读证据收紧（P1 决定在 2026-10-14T07:15:04Z 评审提交与 07:22:20Z #228 决策评论之间）。
- **第二轮修复的增量复评**（head `25f96606`）：无新的 P0 / P1 / P2；整表 26/26 KILLED，复评补充 10 个变体全部 KILLED；四 PR 并集上本 PR 测试 37/37。
- **跟进**：#338（`$mount` disposer、卸载排空上限、数据根 home 与 profile、`actorRef` 由 Host 推导）；#339（边界扫描识别模板字面量说明符，main 既有缺口）；宿主内正向往返与建库观测随 #132 联合验收。
