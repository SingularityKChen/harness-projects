# PR #406 MMP 交付评审

## Purpose / Big Picture

判定 #230 是否交付可独立安装、打开与卸载的 Demo 包，并在合并前保留证据边界。

## Context and Orientation

2026-10-27（Asia/Singapore）初审；分支 `chore/plugin-demo-artifact`，检出 `.worktrees/plugin-demo-artifact`。head `00894b0cdae31a34dfe9a4069d5fb8681508d27a`；base `main` @ `f6ea9713c04e2011bf2023d312c659d0be5c8b4d`。本次只读产品源码；评审记录是本会话唯一写入区。评审账号 `Singularity-AI-Bot`，开发账号 `SingularityKChen`。

## Design / Spec

本矩阵在逐文件审查前建立。风险是检查假设，不能视为已确认缺陷。

| 级别 | 检查假设 | 证据与结论 |
|---|---|---|
| P0 | 安装/启动、凭据与发布面 | 未发现；真实 tgz 12 文件白名单、路径/凭据/源码引用负控通过，无新增安装 hook。 |
| P1 | 独立安装、加载、卸载与仓库保留 | 未发现；38 项通过；当前包与已实测 Web 包摘要及 12 文件逐字节一致，安装/卸载截图和 21 文件前后快照复核相符。 |
| P2 | 版本、重复安装与恢复 | 未发现新增缺陷；明确同版本 remove→add，保留 Project 数据与用户仓库；当前 builtin 判定严格到完整说明符。 |
| P3 | 安装说明与证据范围 | 无需修改；版本、Web 支持线、credentials reference、Documents overlay 与回滚均明确。 |

分层覆盖：代码正常/失败路径、产品闭环、架构与事实所有权、测试判别力、反例、issue 验收和重复追踪。结论需等全矩阵完成后一次性提交。

## Global Constraints

唯一持久写入区为本记录及本批评审索引；产品源码只读（受控变异由仓库脚本逐字节恢复）。账号分离、无规划状态写入、无凭据/本机路径公开。

## Plan of Work

B1 锁定版本并先建矩阵；B2 分层审查、窄测及三项变异；B3 一次性提交评审、独立复核、证据整理、最终 head 回读。撤销本记录不改变产品行为，安装回滚沿指南 remove→add 已知摘要包。

## Validation and Acceptance

2026-10-27 在上述 head 的分支根独立运行：

- `pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-demo-artifact.test.js`：38/38，通过。
- `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`：exit 0，12 文件；当前 tgz SHA-256 `450afc5c90c82504fe71dfd8bca82d5b4cdfa8f6d92c09e9ee9ff223e8fad6a3`，与安装指南已实测包一致。
- 当前 `apps/`、`packages/` 产品源码对历史 S3 源 `a17de25a693b9f1ac7e6fba9df5d2a5394eff7b7` 无差异；12 个 packed 成员摘要与安装时快照全部相同。已读取实际安装/卸载截图、原生 registry 隔离和卸载 RPC 读回记录；21 个仓库文件前后快照相同。此轮复核已有 Web 实证，未声称重新执行完整 S3。
- `node scripts/review-mutate.mjs <spec.json>`：M406-builtin（错误允许 bare sqlite）、M406-license（漏 LICENSE）、M406-version（退回 0.0.0）均 KILLED，分别归因于 `host builtin gate uses complete specifiers` / `the packed artifact has a demo identity`；基线与还原基线绿色、源码还原相等。spec 是运行态输入，不随正式文档提交。

产品闭环限 #230 的预构建包→干净官方 `0.2.0-rc.2` Web profile→Projects 创建入口→卸载撤回。没有扩充为 Desktop、模型运行或完整 Demo。#338 继续承接 Host 身份/根目录/卸载加固，#236 承接完整产品指南与已知问题，#143 承接完整走查；本 PR 未引入这些既有缺口的另一事实源。

## Progress

- [x] 2026-10-27 +08：锁定 head/base、线程、CI，先建立 P0–P3 矩阵。
- [x] 2026-10-27 +08：完成代码、产品、边界、测试、反例、issue 与重复追踪审查。
- [ ] 一次性提交评审，整理证据并锁定最终远端版本。

## Surprises & Discoveries

初审 head 的 `PR Fast Gate`、CI、Merge Gate、两类 CodeQL（0 result）通过；分支保护回读只要求 `PR Fast Gate` 且 strict。`Create review session` 失败已查对应 run 40343105933，实际原因是本地转发端点无法连接，已有 #364；取消的 Rule checks/Issue policy 均有同 head 成功后继。历史 CodeQL thread 已 resolved/outdated，全部线程分页未截断。issue #230 的安装、卸载及 disclosure 验收与 PR 范围一致。

## Decision Log

2026-10-27 +08 / 评审会话：初审无新增问题，建议 APPROVE。人类本轮直接指定 PR #406–#409 在无 P0/P1 或只有 P2/P3 时由本会话负责修复、复评和 rebase 合并；该授权不涉及规划 Status 或依赖关系。

## Idempotence and Recovery

测试/构建可重复；变异脚本归因到指定断言，结束时还原源码。版本漂移后重锁 head/base 并重审，不沿用旧结论。安装回退保留仓库和 Project 数据。

## Interfaces and Dependencies

依赖官方固定 Web runtime、现有 pack 入口与 GitHub 两账号 API。外部评审写入 actor 为 Singularity-AI-Bot，目标同仓 PR #406；幂等键使用 `mmp-review-406-00894b0-initial`，先回读查重、提交后回读。

## Outcomes & Retrospective

2026-10-27 +08 / 协调者补充：完整初审已由评审账号提交，review id `5662812687`。两P2经独立复评和新组合官方Web实测关闭，#124评论`6435452681`已回读，P3回传尾项完成（如本PR适用）。新组合源`f49334fb`、tgz SHA-256 `448a05de2a64c761146cdddf99f9bb5290e3c565a889ee23d46cb4fd5b332d95`；共享实证完整边界见 `docs/review/2026-10-27-pr406-pr409-mmp-review.md`，不冒充各单PR独立新产物S3。最终head/base/checks/threads与合并结果在整理发布后重新锁定。

独立子评审另行只读核对完整6文件、tgz SHA/12成员、冻结源差异与4项builtin负控，与本记录结论一致；未重复把协调者38项/3变异冒认为自己的实跑。未发现 P0/P1/P2/P3 新增问题，建议 APPROVE。全部意见等待其余 PR 完成后统一发布；独立复核、证据提交后的最终 head 回读及合并结果继续写在此处。

## Bottom Change Note

2026-10-27 +08：先建矩阵后完成初审；记录当前字节与真实 Web 实证的等价核对，不混用测试与完整产品验收。

2026-10-27 +08：记录初审发布、独立修复复评、新组合Web与#124回传；最终远端状态仍以当前头回读为准。
