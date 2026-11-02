# PR #501 MMP 交付评审

观察日期：2026-11-02。检出 `docs/demo-guide-readiness`；初始 head `c9a8dfebe07dcc152068003e301f3f6181965d11`，base `main` @ `ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`。

## 先验风险矩阵

本矩阵在逐文件评审之前建立；各项为待证伪风险，并非已发现缺陷。

| 等级 | 代码与失败路径 | 产品闭环及 issue 验收 | 架构与状态所有权 | 测试、反例与设计 |
|---|---|---|---|---|
| P0 | 合并即破坏 main / 执行不可信代码 | 绕过发布硬门或伪造权威保存 | 凭据泄漏、第二规划事实源 | 门禁遇未知状态放行 |
| P1 | 丢失状态、取消/迟到资源泄漏 | 宣称未成立的用户闭环或关闭必要验收 | 跨层绕行、权限/代际围栏失效 | 关键故障绿测、聚合假成功 |
| P2 | 有界恢复或可维护性缺口 | 指南/操作证据轻微不一致 | 局部接口含混 | 非关键断言不足、重复设计 |
| P3 | 命名/冗余 | 术语、导航与可读性 | 无行为影响的组织问题 | 文档与诊断清晰度 |

## 分层证据与结论

结论：在上述 immutable head 上未发现本 PR 引入的 P0/P1/P2/P3 缺陷；此文档子闭环可独立评审、合并及整体 revert。仅建议文档交付通过，不判定 Demo、父项或 R1 通过。本次未向远端提交 review、未提交 Git、未修改产品实现。

### 锁定事实

2026-11-02 最后一次 `gh pr view 501 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,closingIssuesReferences,statusCheckRollup` 回读：head/base 与页首一致；Ready、MERGEABLE、CLEAN，仅 Closes #499。完整 reviews/comments/reviewThreads 快照均为空。当前 head 的 PR Fast Gate、Verify、Merge Gate 和各执行 lane 均 SUCCESS；重复 Issue policy/Rule checks 的 cancelled 记录有同 head 的 SUCCESS 后继，不将取消当产品失败或旧绿当当前证据。

### 全矩阵实审

| 层 | 核查与证据 | 判定 |
|---|---|---|
| 代码与正常路径 | `apps/harness-plugin/src/client.ts:68` 实际装配 PR creator；`packages/ui/src/create-change-request-section.ts:48-55` 的字段/按钮与指南第9步一致；文档未修改代码、配置或测试。 | 未发现缺陷 |
| 失败、恢复与反例 | `create-change-request-section.ts:14-50` 在 none 前禁止表单，读取失败仅重读；过期 target 禁止恢复；unknown 后查询持久操作。`packages/core/src/create-change-request.ts:101-118,166-180` 恢复只调用观察端口，不重发 create。`packages/client/src/start-work.ts` 对 uncertain intent 保留 key，先读上下文再调用原操作；`start-work-section.ts:44,69` 的禁用门在指南第6步得到区分。 | 未发现盲重创或越过权限/目标围栏的文档指导 |
| 产品闭环 | 第6/8/9步分别保留 unknown、会话接纳和 PR 确认边界。恢复按钮禁用时去工作区连接设置恢复同一仓库，`workspace-setup.ts:45-50,112,118-120` 证明入口可达；PR确认不等于谱系新鲜或CI成功。GitHub/session原生创建仍是 #143 允许路径。 | 满足 #499 的指南事实修订 |
| 七不变量及架构 | 文档维持单 Planning 源、可多研发交付 Provider、规划/工程正交、阶段与并行门禁、显式关联和无LLM门控、谱系传播、Host权威；没有新增依赖、第二状态源、未确认Saved或凭据落库建议。 | 未发现架构违例 |
| 测试及判别力 | 审读 `tests/contract/ui-create-change-request.test.js` 中重载原摘要、unknown无operationId、读失败/错target/断线、迟到读和确认失效用例；对应实际UI/Core分支，非纯指南字符串镜像。仅文档改动，未重跑产品测试或变异实验，不把既有测试存在写成当前运行结果。 | 文档检查足够支持该子闭环；产品验收仍独立 |
| Issue与已有追踪 | 最新 gh 回读 #204/#421/#437/#494 分别 CLOSED by #467/#492/#491/#495；#235/#223/#283/#144/#278仍OPEN，milestone与指南一致。#499只关闭指南事实纠正；#236独立安装、#143人工12步、#124/#72产品观察仍保留。 | 无错误关闭父项或冒充人验 |
| 设计适当性与规模 | 就地更新唯一指南，无第二quickstart或重复模板；安装说明继续由 `demo-install.md` 拥有。完成计划记录历史交接事实，后续root推送/Ready由协调者独立收尾；历史交接不是当前未交付缺陷。 | 适当，无需引入产品代码或扩大范围 |

### 实际验证

在 `.worktrees/demo-guide-readiness`、页首 head/base 上执行：

- `node scripts/rule-checks.mjs disclosure ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`：exit 0；另人工审读新增 diff/commit/PR说明的凭据、本机身份、个人信息、内部系统、保密字样，未发现新增披露。
- `node scripts/rule-checks.mjs size ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`：exit 0，代码0、文档172 A+D；按 `git diff --numstat <base>...HEAD` 独立复算相同，分别 <800/<1300。数字不含本次尚未提交的评审记录。
- `git diff --check ea3790315ae3d96dffb04dd5c2c4127cc558bb7d...HEAD`：exit 0。
- 只读Python解析本PR全部Markdown相对链接：`links_missing []`；第2节纵向路径与安装页“当前数据根与旧库保留”锚点均实际存在。
- `gh issue view <n> -R SingularityKChen/harness-projects --json …`：实际回读 #499/#236/#143/#204/#421/#437/#494/#235/#223/#283/#144/#278 和 #413；安装/模型调用/人工walk均未执行。

### 负面情境与待验边界

逐项审读未知PR后重载、PR写能力撤销但读能力保留、scope失效、Start Work恢复按钮禁用、原生平台替代路径、独立安装未执行六种情境；指南均保持原事实/intent并要求适当恢复或记录，未推出成功或重新创建。真实产品中的权限撤销、外部 exactly-once 和所有Provider故障行为仍由所属产品/测试工作项验收。本次无新增需另建issue的真实缺陷；#236/#143/#459/#73的现存人类边界不因本评审消失。
