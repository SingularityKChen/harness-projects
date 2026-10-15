# PR #344 MMP 交付评审

评审对象：PR #344（原生栈 #346 栈底，上层 #345），immutable head `697b283c2c3442a9f58ba83cdf9354693434e06d`，base `main@21cb29eb27ccc0cc6e0eebe61df6b6ae8c2f5bea`。评审日期：2026-10-15（第一轮）。评审账号：Singularity-AI-Bot。同批评审 #316、#342、#343、#345。

## 锁定事实

| 项 | 当前事实 |
|---|---|
| 状态 | OPEN，非 draft，MERGEABLE，mergeStateStatus=UNSTABLE（只因可选检查红） |
| commits | `5c31daf6` plan → `69078ec4` docs(adr) ADR-0014 Proposed → `59117bdd` test(contract) 依赖边（H2 例外）→ `0b724c4f` feat(apps) → `697b283c` docs 回填 |
| linkage | closingIssuesReferences=[#132]；Refs #28（满足其验收 1） |
| checks | PR Fast Gate、Verify、Merge Gate 四 lane、CodeQL 成功；`Create review session` 失败是本地评审端点未运行 |
| 规模 | 代码 768 / 1000，文档 616 / 1500 |
| S3 绑定 | 评审在独立 clone 上 `pack:plugin`：`lib/index.js` `f5c436fcdea7…`、`lib/client.js` `bebdd5e6f3cf…`，与正文和 Progress 逐字相同，S3 观测适用于当前 head |

## 并集预演

见 #342 记录：并集全绿；只合本 PR（栈底先合）到 main：1589/1589 + 7/7、boundaries 9/9。本 PR 对 `tech-debt-tracker.md` 的两行删除只是在 TD-030 / TD-031 行末追加说明（词级 diff 确认原文未动）；ADR README「十三条」改「十四条」与表行数一致。

## P0–P3 风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 未见：verify 全绿，失败路径都有变异杀死 | 未见 | 未见 | **F3** 允许根未规范化时符号链接绕过检出守卫 |
| 产品闭环 | 未见 | 未见：验收 8、9 在 S3 成立，sha256 复核一致 | **F2** 启动凭据竞态在 query-only 路径不自愈，#335 无对应验收 | — |
| 架构与不变量 | 未见：boundaries 9/9，Host 是唯一状态拥有者 | 未见 | — | F3（I5）；**F8** ADR-0014 决定 3 与 TD-053 不符 |
| 凭据与安全 | 未见：canary 原文与 base64 扫描、A-M7/A-M8/A-M14/A-M17 KILLED | 未见 | 未见 | **F5** 诊断日志 0644；**F10** S3 期间检查了凭据文件结构未记偏离 |
| 测试 | — | — | 未见 | **F4** N6 存活 |
| issue 验收（#132 九条） | — | 未见：逐条成立（见下） | — | **F6** 诊断允许名单过窄 |
| 治理 | — | 未见（理由见 F1） | **F1** ADR-0013 注记写成完成态，取代范围超出 H1 问句 | **F9** H2 问句未覆盖 `packages/capabilities` |
| 工作项与文档 | — | 未见：ExecPlan lint OK，章节齐全 | — | **F7** `storage-sync.ts` 文档注释过期 |
| 发布面 | 未见：disclosure 无命中，人工五类目无命中 | — | — | — |
| 栈底只写自己的事实 | — | 未见：#276 只以「计划中」或机器状态出现 | — | — |

## 分层检查

### #132 验收逐条

验收 1、2、3、5、6、7 有 S2 测试且通过；验收 4：canary 原文与 base64 扫描、解析次数等于请求次数、wire 上无 canary；验收 8：H4 批准原话在案，探针构建只多 1 行 `client.ts`，`lib/index.js` 与生产构建相同，被验证的 Host 路径不变；验收 9：S3 干净数据根迁移 1–7、0 个工作区。

### F1（P2）：ADR 注记的时态与范围

ADR-0013 第 13、30 行写「**Superseded in part by ADR-0014（2026-10-15）**：只有『…』不再成立」，是完成态；ADR-0014 是 Proposed，D33 写「仍归人类、尚未答：H1」。人类 10:56 +08 批准的问句只写「部分取代 ADR-0013 决定 5 的**工厂句**」，D34（15:41 +08）把「`credentials` 必需、缺失 fail closed」也划进取代范围，未问人类。不定 P1：两份 ADR 状态行仍为 Proposed，仓库有对 Proposed ADR 行内订正的先例（ADR-0002、ADR-0004），PR 正文如实披露 H1 未答，被取代句来自 #329 实现者决定而非人类裁决（已查 #132、#228、#126 评论无矛盾裁决）。若注记保持完成态合并，则构成 agent 替人类宣告 supersede（#269 先例）——所以必须修。

### F2（P2）：启动竞态无承接

评审探针经 `host.ts apply` 运行、凭据服务晚于组合出现：head 上凭据服务出现后两次 `baseline` 都是 `entities:0, freshness:degraded, reason:not_found`，发命令后才 `entities:9, fresh`；栈顶 #345 相同（`streamWorkspace` 只按间隔 poll `baseline()`）。base 上 Host 在 Desktop 根本不加载，不是回归。#335 正文与 9 条验收都没有「凭据提供方晚于 Host 组合」场景；`not_found` 映射（main 上 `bootstrap.ts:124`）对用户有误导。不定 P1：#132 验收不要求首个 baseline 非空，降级标记如实，生产面板仍是占位、生产尚无工作区写者。

### D4（存储打开期放宽）核实成立

SQLite 读 `configuration_json` 的只有打开期校验与 `getBindingConfiguration`，后者仍按真实锚点的实现键拒绝；Fake 的 `exportFakeStorageState` 只在测试用。原打开期判据是 connector-account 计划里的实现者决定，#126 无人类裁决；放宽写进 ADR-0014 Consequences，随 H1 一并采纳。

## 变异表（head `697b283c`，host-providers / runtime-adapter / roundtrip 集成 + 存储契约）

| id | 改动 | 结论 | killedBy |
|---|---|---|---|
| A-M1 / A-M2 | sqlite / fake 打开期删 `continue` | KILLED | configuration-is-workspace-scoped；AC3 |
| A-M4 | 不跳过 `enabled=false` | KILLED | AC3 |
| A-M7 / A-M17 | transport / 适配器缓存凭据 | KILLED | AC2 AC4；runtime-adapter |
| A-M8 | 去掉 `redirect:'error'` | KILLED | AC2 AC4 |
| A-M10b | 不向上找检出根 | KILLED | AC6 |
| A-M13 / N1 | `guarded` 原样重抛 / 不写 `operationFailed` | KILLED | AC7 命令拒绝 |
| A-M14 / N4 | 日志写 message / NAME 允许名单放宽 | KILLED | AC7 |
| A-M18 / A-M19 | 先关库再排空 / `inject` 加回 `credentials` | KILLED | runtime-adapter |
| N2 / N8 / N9 | 不写 `bindingDisabled` / 错误码漂移 / 构造异常原文进 `disabled` | KILLED | AC3 |
| N3 / N7 | `worktreesDir` 不 realpath / 守卫只拒绝相等 | KILLED | AC6 |
| N5 | 去空令牌检查 | KILLED | AC3 AC4 |
| N6 | GitHub 条目不查句柄 | **SURVIVED** | —（F4） |
| N10 / N11 | 不写 `credentialFailed` / 去 baseline 输入校验 | KILLED | runtime-adapter / roundtrip |

21/22 KILLED，无 NOT_APPLIED；作者表抽样 11 项与声明一致。

## 命令与结果（head）

`pnpm verify` 1589+7 exit 0；boundaries 9/9；四个集成文件 35 pass；size 768/616；disclosure、`git diff --check`、workflow-check 干净；ExecPlan lint OK；`pack:plugin` sha256 如上。

## 结论

P0 = 0，P1 = 0，P2 = 2（F1、F2），P3 = 8（F3–F10）。APPROVE，进入修复。修复约束：S3 证据绑定 `lib/index.js` / `lib/client.js` 的 sha256，改变产物字节的修复须重做 S3 或经人类裁定；F1 改为提议态措辞，F2 在承接 issue 登记验收。**合并次序：#343 之后、#345 之前。**

## 修复与复评（2026-10-15）

按评审流程（只剩 P2/P3），评审会话负责修复：修复由评审会话派出的实施者完成，修复本身另派独立复评。修复约束是 S3 证据绑定的两个产物字节不变；会改字节的 P3 转承接 issue。

| 意见 | 处置 | 证据 |
|---|---|---|
| F1 ADR 注记完成态 | ADR-0013 两处、ADR-0014 决定 5、ADR 索引、计划均改为「拟由 ADR-0014（Proposed）部分取代」；取代范围是否含「credentials 必需、缺失 fail closed」半句并入 H1 待人类裁定；`docs(adr)` 提交正文与 PR 正文同步改写 | 复评 grep 无完成态；两份 ADR 状态行仍为 Proposed |
| F2 启动竞态无承接 | 登记到 #335（拟加验收：凭据服务晚于组合时首次定时刷新重新水合，只查询的客户端无需命令即恢复） | #335 评论 |
| F3 符号链接绕过守卫 | 代码不改（会改字节），四处说法收窄到实测的四种形状并注明承接 #338；登记到 #338 | #338 评论 |
| F4 缺句柄无判别用例 | 表驱动用例改为 `t.test(label)` 子用例，加「github.com 账号不带句柄」 | N6 由存活变为被杀；N6 / M6 对调 `killedBy` 后均为 KILLED_OTHER，按行归因 |
| F5 诊断日志 0644 | 登记到 #338（数据目录 0700、库与日志 0600） | #338 评论 |
| F6 允许名单过窄 | 记为 D26 的取舍，TD-030 下一步登记「只含 basename 的少量栈帧」 | D35 |
| F7 文档注释过期 | 源码不改（实测 `/** */` 文档注释会进产物），ADR-0014 说明以 ADR 为准，并入 TD-029 下一步 | 复评用三种注释文本复现产物字节变化 |
| F8 决定 3 与 TD-053 不符 | 补上 TD-053 例外 | — |
| F9 H2 未点名 capabilities | 评审会话直接问人类：「确认覆盖 (Recommended)」（2026-10-15 16:44 +08），逐字记入 D33 | 复评脚本比对问答逐字一致 |
| F10 S3 期间检查凭据文件结构 | D35 补偏离记录；Global Constraints 改为凭据文件及可能含令牌的文件或环境只做 `stat`，内容核对给人类可复制命令 | — |
| 复评 R1–R5 | 提交正文提议态（整合时替换）；计划订正改为「原文保留 + Superseded by D35」；凭据边界自洽；承接指针改为已登记事实并附链接；F4 子用例化 | 第二轮修补后计划原文逐行为前缀，丢失 0 行 |

修复后读数（整合前 head `5be1458a`）：`pnpm verify` 1592 + 7；四个 Host 集成测试 38 通过；boundaries 9/9；size 代码 773 / 文档 638；`pack:plugin` 产物 `lib/index.js` `f5c436fc…3d699`、`lib/client.js` `bebdd5e6…23b7b`，与 S3 绑定值相同。
