# PR #592 MMP 交付评审

## Purpose / Big Picture

判断现有原生 Issue→PR 读取在重复拒读及另一 Issue 恢复后，是否仍拒绝旧异步成功与旧缓存。成功证据限于当前不可变提交的独立代码审查、生产 Host/浏览器读取与定向变异；installed、人类产品接受与 R1 分开。

## Context and Orientation

- 日期：2026-11-10（Asia/Singapore）。
- 首轮 head：`727efd5090d304c7361ec9cc5e88e080bc34dfac`；base 分支 `main`，观测 base：`3edeedb3eb27379b19292303d183691891eae73c`。结束前远端回读保持相同。
- 两个提交：`f347bfb655edf3c6b408608ee98809dad60f9c69`（方案）与当前 head（修复）。Issue #591，PR 关闭关联仅 #591；#589/#543/#459 为相邻边界。
- 实际 worktree：`.worktrees/native-authority-receipts-20261109`；源文件 SHA256 `2ca895b46888f79ae82e46e2a42e184067767632232052c07ec91543a5c8c29b`。
- 评审账号 `Singularity-AI-Bot`；开发、作者回复与合并账号 `SingularityKChen`。本独立子评审只准备本记录，没有外部评论或评审事件。
- 用户直接授权沿用预置记录：无 P0/P1 时由主评审会话负责修复、独立复评、归档、提交整理、issue 核验及 rebase 合并；有阻塞项先交已有实现会话。本记录不扩大该授权。

## Design / Spec

从最近否定到最后发布的因果链审查：原票据必须在首次异步等待前捕获；否定先核对当前 committed/runtime source；恢复、发布及缓存必须比较原 generation/epoch/receipt。metadata epoch 只表示可见性 cohort，不能代替否定因果票据。NOT_FOUND 仍沿资源版本处理，本次不声称扩展它的范围。

### 审查前建立、审查后更新的风险矩阵

| 等级 | 代码与反例 | 产品闭环与架构 | 测试与 issue 验收 | 结论 |
|---|---|---|---|---|
| P0 | 审查完整不可变差异、存储/泄密/主干破坏面 | 未增加持久化、外部业务写入或第二规划事实源 | 代码增删152、文档增删114；原范围与关闭关联成立 | 未发现 |
| P1 | 重复 actual deny、held A、B 恢复、缺失/过期/异 Context proof；旧源晚否定 | Provider→Core→typed Host→strict client→唯一详情，事实隔离与 retired guard | 112 集成、6 浏览器及 R1–R3 定向变异；未将本地证据扩大为产品接受 | 未发现 |
| P2 | 缓存/离线 fallback、失败/不完整恢复、source ItemRead 权限独立性 | 本代内部 bigint 未进入 wire；无新增 Provider/API/schema | 原始断言保留，来源粒度与相邻 PR 创建回证通过 | 未发现 |
| P3 | 可维护性、记录、必要栈与回滚方向 | 单 counter 的保守废弃已明确，未引入无需求的权限框架 | #592→#590 是实际 API 依赖；未把 #543 或 R1 当作关闭项 | 未发现 |

## Global Constraints

本子评审只修改当前记录；生产源码、测试、commits、分支和远端状态保持只读。运行态日志、探针、不可变副本与变异 spec 只放 `.superpowers/`。不自主合并，不写规划 Status、关系或任何 Provider 业务数据。

## Plan of Work

### Batch 1 · 完整分层独立评审

已分别检查本 PR 相对 base 的全部差异及 #590 对本 API 的真实消费，阅读 Provider、Core、Host、client、UI-model/UI 与相关 tests。先按 P0–P3 建矩阵，再完成全部层次和反例，最后更新记录；没有在首个候选问题处提前停止。正式 inline 意见由主评审统一提交。

## Validation and Acceptance

以下命令均为本轮新运行，工作目录为上述 worktree；原始输出在 `.superpowers/mmp-review-20261110/`。

| 命令 | 结果与证据 |
|---|---|
| `pnpm test:file tests/integration/issue-closing-links-scope.test.js tests/integration/harness-plugin-issue-closing-links.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/create-change-request-link-recovery.test.js` | 退出0；112/112，0失败；`narrow.log` |
| `node --test tests/browser/native-link-detail.test.js` | 退出0；6/6，0失败；`browser.log`。真实生产 apply/Host，transport 为离线夹具 |
| 通过 Python `subprocess.run` argv 执行 `git diff --check 3edeedb3eb27379b19292303d183691891eae73c...727efd5090d304c7361ec9cc5e88e080bc34dfac` | 退出0；代码增删152、文档增删114（不含本评审记录） |
| `gh pr view 592 --repo SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,reviewDecision`；REST reviews/comments | head/base 未变；reviews 0、inline comments 0 |

组合验证使用 #590 的实际必要父提交，而非近似补丁：它的 base 正是本 head，因果模块 SHA256 与本 PR 完全相同。在该栈顶新跑 Provider/client/Core/Host 62/62、Host/capability 接线90/90及 boundaries9/9；依赖浏览器2/2。该证据验证这对原生栈，不代表其它候选 PR 或完整产品。

变异在栈顶不可变 `git archive` 副本 `.worktrees/native-issue-dependencies-20261109/.superpowers/mmp-review-20261110/immutable-590` 中执行，先离线安装依赖，再运行 `node scripts/review-mutate.mjs review-spec.json`。脚本退出0，基线及还原后基线为绿；全部被改文件与真实栈顶逐字节核对相同。未临时改写本 worktree 源码。

| 变异 | 指定 killedBy 与实际判别 |
|---|---|
| R1：receipt 仅在首次 Set 插入递增 | `repeated actual denial cannot be erased by another Issue recovery`；Planning closing/reference、Development target 三条均失败；KILLED |
| R2：恢复不比较原 receipt | `authority recovery requires the complete current Context proof`；过期证明可错误解除拒读而失败；KILLED |
| R3：旧 source 的实际否定绕过同步 fence | `a committed source change rejects late native denial`；primary/membership/projection 反例失败，Host account/configuration/binding 反例也失败；KILLED |

### 分层证据

代码：`observeIssueAuthority` 每次有效 actual 否定推进 bigint receipt；descriptor 对已知拒读去重。恢复必须保留原三元证明。`current()` 与 cache entry 使用原 receipt，离线/partial fallback 不能把旧事实重新签发；拒读控制流允许空失败结果，不允许借新 proof 恢复旧 links。

架构与安全：实际否定、describe 结果先同步回证 committed fence 与 runtime planning/delivery epoch；有效同源晚否定仍可观察，已提交账户/配置/绑定/primary/membership 切换的旧结果不能污染当前代。Host retired/stop 读拒绝和 Context 弱引用 owner 保持隔离。source version 只跟踪 ItemRead 与对应资源，不扩大 native-only deny 对独立 Issue target 的遮蔽。receipt 不序列化，未持久化 token、凭据或新权威状态。

产品：现有只读 PR 关联仍由来源关系、Development repository 与 PR actual ack 共同证明；不推断 implements，不改变 execution lineage 或规划状态。生产浏览器覆盖同 revision metadata 立即去除 DOM/AX 旧事实、迟到响应拒绝与请求数不继续增长；新显式刷新能够恢复。SQLite 业务 dump/禁止写入断言和相邻创建回证仍成立。

工作项与范围：#591 描述的三个 held 路径、当前/旧 source 晚否定、原缓存失效均有新鲜证据；现有更广关系管理与父 #543 保持独立。#590 明确消费该 API，分栈不是单纯共享文件或预算切片。Issue 正文的 active 路径为历史链接，仓库正式索引已指向 completed；未把既有 issue/PR 状态当作人类接受。

## Progress

- [x] 2026-11-10：审查前矩阵已预置；独立锁定不可变差异与权限事实链。
- [x] 2026-11-10：完成代码、产品、架构、测试判别、issue/范围及必要栈全层审查。
- [x] 2026-11-10：112 集成、6 浏览器、3 父层变异与组合消费验证已记录，远端 head/base 再读未变。
- [ ] 正式评审事件、修复/独立复评、最终门禁及任何合并由主评审按当前授权处理。

## Surprises & Discoveries

没有用绿色串行拒读测试代替 held A / repeated B deny / B recovery 反例。R1 变异实际让三个生产 Host 路径失败，证明新增断言可识别原根因。#590 的真实依赖消费与父模块逐字相同，未观察到并行框架或第二份因果状态。

## Decision Log

2026-11-10 / 独立子评审：未发现可行动 P0–P3，建议正式 `APPROVE`。依据是完整不可变差异和上述新验证，不是 PR 描述或历史验收摘要。全局 receipt 保守取消不相关并发 native 读属于明确接受的最小机制，无负载证据时不建议升级为向量权限框架。

## Idempotence and Recovery

本轮只读命令可以重跑；变异脚本已逐字还原不可变副本。实现回滚仍是先回退消费本 API 的 #590，再回退 #592，避免类型/操作断裂。本记录不能替代最终远端状态读回。

## Interfaces and Dependencies

父修复只改变既有 Core 内部观察器及原测试，不新增 Provider port、Host operation 或 schema；#590 明确导入并消费同一 proof API。原生观察、独立 Issue summary、delivery health、Planning 状态分别保持原有语义和 owner。

## Outcomes & Retrospective

首轮全部层次已完成，无可行动 P0/P1/P2/P3。建议批准当前 head；是否执行后续合并由主评审依据用户逐 PR 授权及最终远端门禁判断。本地离线生产链验证不证明真实 GitHub 账号内容完整、installed artifact 接受或 R1 发布通过。

## Bottom Change Note

2026-11-10：补齐完整风险矩阵、因果链/范围核对、112+6 新验证、真实必要栈消费与有归因变异结果；没有修改生产实现或提交外部评审。

2026-11-10 SGT 首轮正式回读：`Singularity-AI-Bot` 已在锁定 head `727efd5090d304c7361ec9cc5e88e080bc34dfac` 一次提交完整 review `5835142957`，事件为 APPROVED。最终 push 后须重新锁定并取得当前版本结论。

2026-11-10 SGT 整合门：全部四项非阻塞修复已独立复评通过，最终固定组合 f172cb02 的完整工程证据与逐实际 main 门见 `docs/review/2026-11-10-pr586-pr592-mmp-review.md`。本 PR 最终 push 后仍重读精确 head/base、托管检查、批准、全线程和双向 issue 关联；与受验前缀逐 blob 不符则回到验证。
