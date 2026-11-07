# PR #552 MMP 文档交付复审

## Purpose / Big Picture

判定安装态验收/指南文档是否准确、自包含且能独立交付；保持旧安装证据、当前源码、局部测试与人类发布接受的边界。

## Context and Orientation

2026-11-07 SGT，初始发布 head `81d5a2b0ffce6e81496d4139b3ec967229ba72b8`，原 base `45330b54c7c786f81e3453254210440437e6fd3b`；main 前进后该 PR 为 BEHIND。本会话先建立恢复锚点，再重放到 `50abd7d779f6ec332401234479e3c10cc8b96251`，本地锁定 head `ece9cabd696d2e4f179468947ecc7be047908dc1`，无冲突。此前作者评审保存在 `docs/review/pr-552-mmp-review.md`，本轮不沿用旧 head 批准。

## Design / Spec

先矩阵再分层审读，分别独立核对产品/证据/issue接受和文档/链接/发布面；协调者整合所有意见后一次性提交 review。

| 等级 | 代码与架构 | 产品、证据与测试 | Issue与范围 | 门 |
|---|---|---|---|---|
| P0 | 公开秘密或破坏性操作指令 | 不可逆丢数据/错误发布 | 失控发布面 | REQUEST_CHANGES |
| P1 | 破坏Host拥有或两轴边界 | 未有证据却宣布原run恢复、安装接受、R1通过；指南严重错误 | 漏掉关键AC或豁免必需门 | REQUEST_CHANGES，交原owner |
| P2 | source/Host/artifact归属错误 | 重要证据、恢复或版本指引不准确 | 过早关闭/当前owner错误 | APPROVE后修复复审 |
| P3 | 链接、索引与措辞 | 非阻塞可读性/追溯 | 记录一致性 | APPROVE后最小修订 |

## Global Constraints

本轮为文档任务，产品源码变化必须为0。评审用 gh-review/Singularity-AI-Bot；开发、作者回复与合并用 gh/SingularityKChen。10-29已完成计划的历史内容保持；11-04有界验收计划按本次完成范围做正常归档与最小生命周期订正，不追加看板关系/Status记账。其原实际观测、source/Host/artifact与未决外部门保持。规划Status/依赖、人类接受和现有数据库/会话均不从工程结果改写。

## Plan of Work

1. 锁定head/base、所有checks/threads/reviews与issue236/545/554/304/459/73/141原AC。
2. 两个独立子评审完成五层矩阵，核对实际证据和当前冲突；协调者一次性发布全部意见。
3. 无P0/P1时按本会话授权最小修复、独立复评、整理提交、最终push回读并rebase合并；有阻塞交原实现会话修复。

## Validation and Acceptance

在检出 `docs/desktop-acceptance-20261104` 的工作树根运行：变更Markdown相对文件链接/锚点、11-04计划唯一Completed入口及10-29计划字节保留检查；`git diff --check <base>...HEAD`、`node scripts/rule-checks.mjs disclosure <base>`（含当前PR_BODY）、`node scripts/rule-checks.mjs size <base>`。期望均exit0、代码0。当前hostedchecks/原生批准/全部线程单独回读，不把历史测试或文档绿当新安装、人验或R1通过。`<base>`固定为 `50abd7d779f6ec332401234479e3c10cc8b96251`，最终head由GitHub原生review与命令回读绑定，避免文档自引用提交哈希。

## Progress

- [x] 2026-11-07 SGT：完成初始元数据与两账号核验，先建全严重度矩阵；旧head备份后无冲突接合当前main。
- [x] 2026-11-07 SGT：两个独立审读完成；无P0/P1，两项P2，review5810701593在当前ece9cab上一次性APPROVE并提交全部inline。
- [x] 2026-11-07 SGT：两项P2已最小修复；独立复评发现的观察/快照归属和三选项条件一并订正，最终无新增P0–P3。
- [x] 2026-11-07 SGT：13份变更Markdown共274个相对链接、5个本地锚点通过；11-04计划只有一个Completed索引、无旧Active路径；10-29计划与原发布版本逐字节一致，代码变化0、空白检查通过。

## Surprises & Discoveries

初始PR已APPROVED但BEHIND，必须重新锁定实际base/head；PR是文档接受交付，不能把Refs的工作项或广义安装计划一并默认接受。

## Decision Log

- Decision：沿用本会话前序明确的MMP评审/处理流程；人类新指令“评审并处理PR#552”点名本PR，在无P0/P1且修复独立复评通过后完成rebase收尾。
  Rationale：当前任务明确是继续处理指定PR；不扩大到其他PR、Planning Status或R1批准。
  Date/Author：2026-11-07 SGT / 人类直接指令，评审协调者记录。

## Idempotence and Recovery

原head保存在 `refs/backup/pr552-before-mmp-review-20261107`，重放后的已发布head另存 `refs/backup/pr552-before-final-publication-20261107`。发布前检查远端仍为预期旧head，使用精确lease；头部变化立即停止并重新锁定。不丢既有worktree内容，不回滚并发规划字段；文档回退不能回退GitHub外部状态。

## Interfaces and Dependencies

GitHub仓库 `SingularityKChen/harness-projects`；已有 `.worktrees/desktop-acceptance-20261104`。运行态证据存 `.superpowers/pr552-mmp-review-20261107/`，正式事实在本文件及产品/验收文档；旧安装证据只保留其原source/Host/artifact身份。

## Outcomes & Retrospective

首轮结论：无P0/P1，EVID-552-1为当前源码指南未记#565选择能力，EVID-552-2为有界验收计划未归档。原#545允许诚实分类失败，原run仍unknown；#554 AC4、#141组合证据及#304/#459/#73均明确保留。机械审读通过0代码/646文档行、相对文件链接、5处本地锚点与公开面检查；这些文档证据不等价于新安装或R1接受。

修复复评：EVID-552-1/2均ADDRESSED。指南准确记录合格来源默认引用、可不关联及默认分支关闭条件；#564原生观察与#544快照持久化分别归属；11-04有界计划正常归档，不关闭独立恢复或发布门。原评审者按具体文件摘要独立复核，无新增问题。#236原四条AC已成立，使用Closes仅关闭文档叶项；#555仍保留Draft/unmerged。最终不可变head的批准、checks、线程处理和合并结果由原生PR回执绑定。

最终本地门：上列disclosure（含实际PR正文）、size与diff空白命令均exit0，代码0、文档规模低于1500行；相对链接/锚点、归档路径及保护计划检查通过。人工五类检查覆盖新增正文、提交信息、分支名与PR描述，未发现凭据、本机身份/路径、个人资料、内部系统或保密内容。未重复运行产品全仓测试、安装或模型调用。

## Bottom Change Note

- 2026-11-07 SGT：为当前main上的PR552建立独立MMP风险矩阵、角色边界和恢复路径。

- 2026-11-07 SGT：原#236四条AC逐项回证已完成，唯一剩余项为本PR文档合并；修复复评与最终公开面/链接门通过后使用Closes #236，范围不扩大到规划Status或发布接受。
- 2026-11-07 SGT：两项P2修复及独立复评完成；保留历史接受身份，补齐当前源码能力与计划生命周期。
