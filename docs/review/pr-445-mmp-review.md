# PR #445 MMP 交付评审

## 锁定事实

- 日期：2026-10-29。head：`fc36a33a4fed67d94169632a452aad1813b59147`；base：`main@06d929017c8551e6b106fcbe7651f12ac26e4642`。
- 执行上下文：`.worktrees/demo-user-guide`；评审账号 `Singularity-AI-Bot`，开发账号 `SingularityKChen`。
- 阶段：先建立风险矩阵，再检查代码、产品、架构、测试、反例和工作项。下面是待验证风险，不是缺陷结论。

## 风险矩阵

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 初始状态 |
|---|---|---|---|---|
| P0 | main 不可运行、不可恢复数据破坏 | 权威状态或凭据硬边界失效 | 迁移/发布基线与必需门禁失真 | 未发现；文档没有授权删库、覆盖仓库或降级准入 |
| P1 | 越权、并发陈旧写入、重放与失败恢复错误 | 用户任务无法完成、Provider ack 或 Host 权威被绕过 | issue 核心验收缺失、判别性反例未覆盖 | 未发现；#444 有界准备验收与父项人工验收明确分开 |
| P2 | 有限错误反馈、可恢复边缘路径偏差 | 可用性/说明缺口，范围局部 | 非核心验收或测试遗漏，重复跟踪核对 | 无新增意见；后续组合需重读 #420 与数据根 |
| P3 | 命名、局部可读性、可选简化 | 文案与维护成本 | 引用、证据表述与冗余 | 无新增意见；一份指南和现有安装入口符合范围 |

## 分层证据与反例

- 当前 diff 仅四份文档；逐条对照 `docs/product/vertical-path.md` 的 12 步、`packages/ui/src/start-work-section.ts` 的真实按钮和 `docs/product/demo-install.md` 的安装入口。
- GitHub 当前 #444 只要求有界指南与人工记录准备；#236/#143/#124/#72 仍开放。模板全部标为“未执行”，没有把文档或历史安装当成人工验收。
- 已有问题分别由 #283、#144/#278、#223、#204/#420、#235 跟踪；闭合 #218 未作为开放缺陷。数据库备份要求停宿主、校验副本、保留原件、在新位置重建，未授权删库。
- 设计是一份指南加两处导航，无第二套安装步骤或规划事实源；复杂度与子项边界相称。
- 跨 PR 首轮协调项（已完成，Superseded by 本文“最终组合文档复核”）：#455 合入后更新 #420/owner 限制，保留 #204 的外部不确定性，并采用 #456 的实际 profile 数据根。

## 独立文档复核

2026-10-29，在上述 immutable head 上独立审读全部新增文档，并直接回读 #444/#143/#236 的当前 scope/acceptance，而非从父 issue 标题推断本 PR 应完成整个人工验收。

- **#444 验收对应**：指南有唯一 artifact-only 安装入口、当前 1–12 步、四项故障/重启观察、版本/head/artifact SHA-256、独立安装与完整走查的独立字段，以及原因/缺陷处置/跟踪 issue/backlog 影响记录。所有实际记录初值为“未执行”。明确允许第 9 步在 GitHub 或 Harness session 创建 PR，没有声称插件已有专用创建命令。
- **真实 UI 与恢复**：逐段核对 `workspace-setup.ts`、`repository-binding.ts`、`start-work-section.ts`、`work-item-app.ts` 及 `packages/client/src/start-work.ts`。指南中创建、连接、绑定、显式启用、开始工作/提交开始工作/读回并恢复的按钮与条件都有实际来源；客户端对 uncertain intent 先读回并复用原 key，文档没有建议在 unknown/pending 后盲发新 intent。列表/抽屉的目标观察保留为人工核对项，没有把源码存在写成人工已通过。
- **备份反例**：`packages/storage/sqlite/src/migrate.ts` 的当前准入返回 `incompatible_database` / `back_up_and_rebuild`。指南要求停止所有打开实际根的进程，完整复制到不存在的备份目标，核对清单与各文件 SHA-256，核对后仍保留原件，在新位置重建。它明确拒绝复制不兼容库接管执行、改代际标记、执行修复 SQL、删除/覆盖旧库；仓库、分支、工作树也保留。安装指南当前路径优先于注明 head 的历史数据根，避免 #456 合入后误按共享根备份。
- **当前 issue**：直接查询的 #71/#145/#235/#283/#144/#278/#223/#204/#420 均 OPEN；#218 CLOSED。表内列出的 M2.1/M4.1 与实际 milestone 一致；M2.1 不符合父 #236 旧措辞的差异已诚实说明，#444 没有要求为此擅改 milestone。#143/#236 仍 OPEN，人工未执行属于保留边界，不构成本准备子项的 P1。
- **检查**：独立执行 `node scripts/rule-checks.mjs disclosure 06d929017c8551e6b106fcbe7651f12ac26e4642`、`node scripts/rule-checks.mjs size 06d929017c8551e6b106fcbe7651f12ac26e4642`、`git diff --check 06d929017c8551e6b106fcbe7651f12ac26e4642...HEAD` 均通过；代码 0 行、文档 293 行，低于 #444 的 1300 行上限。人工五类目未发现真实凭据、本机身份、账号个人信息、内部系统或保密内容。主评审另已核对 147 个链接/锚点；本子评审没有重复运行该扫描，也没有为纯文档变更运行产品测试或变异。

当前独立结论为无新增 P0/P1/P2/P3 finding，可接受 #444 的文档准备闭环。发布前重读随先行 PR 改变的 owning issue；若 #455 先行，则更新 #420/旧 owner 表述并保留 #204 的外部不确定性边界，再对最终文档 head 做一次复核。

## 实际验证与远端状态

- `docs/product/demo.md`、产品/文档索引和本 ExecPlan 共 147 个本地链接/锚点解析成功。
- 在本 worktree、锁定 head 上，`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD` 均 exit 0；当时代码 0、文档 293 行，不含本轮评审记录。
- 四个 PR 初始全部 review threads 与历史 reviews 均为空。当前 head 的 `PR Fast Gate`、Merge Gate、CodeQL、disclosure/size/issue 策略均成功；可选 `Create review session` 的失败日志明确为 loopback 评审转发端点离线（#364）。取消的同 head 重复规则运行有成功后继。
- 当前分支保护要求 strict `PR Fast Gate` 和线性历史；本轮仍单独执行独立评审门。未把 CI 绿色作为 #143、#236 或 R1 产品验收。

## 结论与后续

子评审没有提交 GitHub review、产品改动、commit、push 或合并。主评审仍需锁定最终 head/base/threads/checks 并按人类逐 PR 授权收尾；#143/#236/#124/#72、Gate R1 与 Demo milestone 均不因本指南获接受。若先行 PR 改变文档事实，则在最终文档 head 复核后再提交完整 review。

## 主控综审与收尾门

- 2026-10-29 首轮：独立子评审与主控全矩阵均无新增 P0/P1/P2/P3。初始 head/base 已锁定；所有原 review threads/reviews 为空。主控逐条查明可选评审转发失败属于 #364；取消的重复规则运行有成功后继，当前代码门通过。
- 已使用 `gh-review` / `Singularity-AI-Bot` 一次性提交完整 APPROVE review，没有可提交的 inline 缺陷；开发与后续外部写入使用 `gh` / `SingularityKChen`。
- 以四个首轮固定 head 按 #454 → #455 → #456 → #445 在隔离 clone 逐项变基预演，无冲突，组合 head `23916987d93026109a2fce8a55cc55147b521e3d`。固定 pnpm 10.28.2 后 typecheck、2551/2551 与 MVP-0 7/7 通过（0 fail/cancelled）。首次 pnpm 11 的依赖预检在测试前因非 TTY 终止，不是测试通过；离线安装也曾因缓存缺包失败，联网 frozen install 成功。
- 收尾只整合提交与审查记录；每个分支先保留原 head 的本地 backup ref，更新到真实 base 后核对源码与预演/独立审查相符，运行受影响验证和发布面/规模检查，以精确 lease 推送。远端最终 head/base/checks/issue/threads 和复评全部成立后才执行 rebase merge；任一条件改变则回到该门，不能借首轮批准跳过。
- 本轮接受对应子 issue 的有界闭环；不接受父级 MMP、真实模型、人工 Demo、独立安装或 R1。保留原跟踪问题和人类验收门。

## 最终组合文档复核

- #454/#455/#456 已逐项最终复评、当前 head 门禁成功后 rebase merge；#349/#420/#423 均按实际验收勾选并闭合。对应已合并 main 为 `ba13dd90af9ceeff7405f95496a8ecc77bb6ce5c`，本指南在此 base 更新；原始 head 的 issue 状态仅为历史观察。
- 修正已交付 #420 的 owner 结算表述，开放限制只保留 #204/#421 等外部结果未知与恢复问题。数据库指南改为当前 profile 数据根及唯一安装指南锚点，移除历史共享根作为当前操作依据；停机、完整副本校验、保留原件、新位置重建和匹配版本回滚的保障保留。
- 操作步骤、人工记录与 #444 的准备范围不变；#143/#236/#124/#72、#459 与 R1 不因指南合入获得验收。
- 独立最终复评 PASS：直接回读先行 PR/issue 和 owning Host/安装源码，无新增 finding；最终7份变更文档共152个本地链接/锚点解析成功，`git diff --check` exit 0。此次仅文档，不重跑不变产品测试。
