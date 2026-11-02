# PR #502 MMP 交付评审

观察日期：2026-11-02。检出 `docs/core-release-criteria`；初始 head `1b6747c0e540e20bfb3ebb6ba38555b5b11e03ba`，base `main` @ `ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`。

## 先验风险矩阵

本矩阵在逐文件评审之前建立；各项为待证伪风险，并非已发现缺陷。

| 等级 | 代码与失败路径 | 产品闭环及 issue 验收 | 架构与状态所有权 | 测试、反例与设计 |
|---|---|---|---|---|
| P0 | 合并即破坏 main / 执行不可信代码 | 绕过发布硬门或伪造权威保存 | 凭据泄漏、第二规划事实源 | 门禁遇未知状态放行 |
| P1 | 丢失状态、取消/迟到资源泄漏 | 宣称未成立的用户闭环或关闭必要验收 | 跨层绕行、权限/代际围栏失效 | 关键故障绿测、聚合假成功 |
| P2 | 有界恢复或可维护性缺口 | 指南/操作证据轻微不一致 | 局部接口含混 | 非关键断言不足、重复设计 |
| P3 | 命名/冗余 | 术语、导航与可读性 | 无行为影响的组织问题 | 文档与诊断清晰度 |

## 分层证据与结论

结论：在上述 immutable head 上未发现本 PR 引入的 P0/P1/P2/P3 缺陷；该范围规范子闭环可独立评审、合并及整体 revert。仅建议文档交付通过，不判定 #459 完整审计、Core 产品或 R1 通过。本次未向远端提交 review、未提交 Git、未修改产品实现。

### 锁定事实

2026-11-02 最后一次 `gh pr view 502 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,closingIssuesReferences,statusCheckRollup` 回读：head/base 与页首一致；Ready、MERGEABLE、UNSTABLE，仅 Closes #500。完整 reviews/comments/reviewThreads 快照均为空。当前 head 的 PR Fast Gate、Verify、Merge Gate及各lane均SUCCESS；不能把此单次快照当R1所需连续两次稳定证据。

`Create review session` 的失败已实际运行 `gh run view 41417537855 -R SingularityKChen/harness-projects --log-failed`，exit 0：日志明确 endpoint responded 404；失败是可选review webhook，而非本PR产品代码失败。最新 #364 OPEN 正跟踪该失败噪声；依 `docs/review/mvp-review.md` §5 不列本PR阻塞。重复 Rule/Issue cancelled 记录有同head SUCCESS；Engineering state的全局后继SUCCESS由协调者补充回读，不能把取消记为功能失败。

### 全矩阵实审

| 层 | 核查与证据 | 判定 |
|---|---|---|
| 代码与声明事实 | `apps/harness-plugin/src/host-operations.ts:91-137` 与scope表逐名核对，20 unary + 1 stream共21项；测试入口均存在。没有runtime/CI/契约代码改动。 | 静态盘点准确；没有声称全部已实测 |
| 产品闭环与真实授权 | 直接 `gh issue view 413 … --json body,comments` 读取人类批准 comment 6491007490：现代installed Host的Project→WorkItem→Start Work→session/manual fallback→safe PR/CI，加基本setup/access/recovery；后续planning/editor/views/local/full relations/diagnostics/deployment保留。scope第7/9行与之相符，日期仍是目标而非承诺。 | 不是由PR或#500自证范围批准 |
| 架构与七不变量 | scope保持单规划事实源、规划/工程正交、显式关系/无LLM发布裁决、Host权威与原有Provider组合。阶段/并行门禁及谱系关系未变；基本settings与后续完整settings明确区分。静态无操作名及隐藏导航均不被当成实际不可达证明。 | 无第二权威、越层依赖或安全例外 |
| 门禁和反例 | 相对base截取并逐字比较 release-gates §2 条件表和§2.1不变量表，均完全相同，分别12与10行；§3 stop/exception原规则未改。scope给所有项证据责任和未解gap；保留当前schema/旧库、身份、权限、atomicity、durable intent/reconcile、ABI和人类owner。 | 无删行、弱化或unknown→通过 |
| 测试与证据边界 | source/test只是定位入口；历史partial/反例未升级当前满足。PR明确未做完整Host/policy/database admission audit，未将绿CI/closed children/SSR当installed UAT。纯文档未运行产品测试或变异实验。 | 文档验证与其风险适配 |
| 工作项与已有追踪 | 最新回读 #500/#459/#73/#143/#236 均OPEN；#500只要求有界规范切片，#459保留全量可达边界、风险分类、staffing/currentRC；#449/#450/#451/#143/#124/#72/#369和最终human go/no-go仍显式列出。重点正确性finding逐项归#459，无Post-Core风险自动接受。 | 不错误关闭父项，不重复完整审计 |
| 设计适当性 | 单一范围owner、纵向动作owner、发布门禁owner和Demo操作owner职责清楚；21项静态表和12+10责任表形成可追踪接口，未添加兼容层或另一个通过表。 | 当前文档切片适当，无需扩大到产品代码 |

### 实际验证

在 `.worktrees/core-release-criteria`、页首 head/base 上执行：

- `node scripts/rule-checks.mjs disclosure ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`：exit 0；另人工审读新增diff/commit/PR说明五类发布面，未发现新增披露。
- `node scripts/rule-checks.mjs size ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`：exit 0，代码0、文档258 A+D；按 `git diff --numstat <base>...HEAD` 独立复算相同，分别 <800/<1300。数字不含本次尚未提交评审记录；计划中的254/256属于已标注历史快照。
- `git diff --check ea3790315ae3d96dffb04dd5c2c4127cc558bb7d...HEAD`：exit 0。
- 只读Python解析本PR全部Markdown相对链接：`links_missing []`；新scope所列源码及测试入口存在。
- 只读Python对比base/current权威表：`authoritative section unchanged True`，R1 numbered_rows 12、不变量 numbered_rows 10；重算静态Host声明为21。
- `gh issue view <n> -R SingularityKChen/harness-projects --json …` 实际回读 #500/#459/#73/#143/#236/#413/#364；真实staffing、安装UAT、rollback rehearsal和go/no-go均未执行。

### 负面情境与待验边界

审读五种反例：后续能力仍通过Host或持久策略可达、browser绿但#143未走、一条R1无证据、unknown显示Saved、child全关闭但人类未批准。scope第9/11/49/89/93/95行均拒绝从这些情境推出release-ready，要求当前边界拒绝/阻塞修复/精确人类例外或继续未验。实际运行态完整审计仍归#459，正式发布裁决归#73；这不是本PR缺失交付或本评审可代做的验收。未发现新的真实缺陷需另开issue；已有风险不重复包装成新债。
