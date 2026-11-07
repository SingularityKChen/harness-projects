# PR #561 MMP 交付评审

## Purpose / Big Picture

独立判断 #558 的来源编号闭环能否保持稳定身份、单一 Planning 事实源与权限边界。此次只读审查并写证据；没有提交、推送、GitHub review 或合并，也没有修改生产代码或用户数据库。

## Context and Orientation

2026-11-07 锁定 `.worktrees/source-numbers-20261107`，分支 `feature/source-aware-numbers`，head `ea33eff78b71d0b5359fb5d162b204bb17a087ee`；base `main` / `04af317ec3bda5084ab1e44ea5e3559fd4622079`。PR #561 关闭 #558、引用父项 #537。起始工作树干净。
缓存回读为 ready、MERGEABLE/UNSTABLE，三条实现提交；唯一 CodeQL 线程已 resolved/outdated。缓存同 head 的 Verify、Browser、Merge Gate、PR Fast Gate、CodeQL 成功；可选 review session 失败与重复取消 checks 的最终归因、远端新鲜状态由主评审回读，本文不代替该门。

## Design / Spec

采用 Superpowers 证据核验、Qian 系统接口合成与 First Principles 生命周期审计，先记录下列风险矩阵再逐文件审查。
目标是 Provider 原生号及来源经过 Host、SQLite、wire/client、安全投影后，列表和详情一致显示，数字与完整限定标识只搜索已加载可读行。
主要不确定性是号码是否仍由外部事实拥有，且跨仓同号、撤权、异常输入和重启保持边界。完整 packages/tests/docs diff 已审读；fixture 大行另作结构化差异核对。

| 层 | P0 风险 | P1 风险 | P2/P3 风险 | 最终判定 |
|---|---|---|---|---|
| 代码 | 初始化/查询破坏 main | 错号、重启丢号、跨源串号、撤权泄露 | 异常/重复输入、顺序和维护性 | 无已证实 P0–P3；279 项相关测试与 3 项独立对抗通过 |
| 产品闭环 | 工作台不可用 | 列表/详情身份不一致、核心定位错误 | 标题搜索、过滤排序、无号占位退化 | 原生/数字/限定查找、默认展示、promotion 和撤权形成闭环 |
| 架构 | 新增权威源 | UI 解码身份、污染关系键、反向依赖 | 边界遗漏、无必要框架 | SourceNumber 只作观察元数据；9 项边界检查包含于48项回归 |
| 测试 | 验证入口失效 | 关键保护无判别证据 | 故障覆盖不足、脆弱断言 | 9/9 具名变异 KILLED，基线和还原后基线通过 |
| 工作项 | 硬门禁伪通过 | #558 核心验收不成立 | 规模/关联/范围/文档漂移 | Closes #558，#537 保留；403 代码测试配置 /177 文档行 |

系统取舍成立：一个领域白名单、一个展示 formatter 和沿现有读链增加可选元数据满足来源消歧；未增加分配器、第二事实源、Provider 直连 UI、双读或迁移框架。跨层小修改是完整纵向字段所需，没有观察到需要重做方案的过度设计。

## Global Constraints

只拥有本文与运行态 repro/spec/log/JSON；保留已有变更。Git 使用 argv。文档只写仓库内路径。变异仅用 `scripts/review-mutate.mjs`，所有条目都有 `killedBy`，夹具逐字节还原。

## Plan of Work

- [x] Batch 1：锁定 head/base、工作区、issue、线程，先建立完整风险矩阵。
- [x] Batch 2：逐层审读 Provider→存储→wire→安全视图/UI 与全部变更测试。
- [x] Batch 3：窄测试、异常/重复/多源对抗、整表变异与范围核对。
- [x] Batch 4：记录全部结论、证据限制和合成建议，回传主评审。

恢复点为锁定 head；没有生产修复，无代码回滚需要。外部写入与安装验收不在本轮执行范围。

## Validation and Acceptance

下列命令在锁定 head 的工作树根运行；日志位于主评审运行态目录 `.superpowers/pr559-565-review-20261107/`，不进入公开文档。

| 命令 | 2026-11-07 实际结果 |
|---|---|
| `pnpm test:file tests/integration/source-number-restart.test.js tests/contract/ui-local-table-view.test.js tests/contract/planning-github-projects-contract.test.js tests/contract/planning-github-projects-mapping.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/storage-contract.test.js tests/browser/source-numbers.test.js tests/browser/table-query.test.js` | 279/279，零失败/跳过，`numbers-baseline.log` |
| `node --test .superpowers/pr561-review/numbers-adversarial.test.mjs` | 3/3，畸形元数据、delta 原子拒绝/重复实体、多源同号与过滤稳定排序；`numbers-adversarial.log` |
| `pnpm test:file tests/contract/package-boundaries.test.js tests/integration/identity-membership-schema.test.js tests/integration/identity-membership-enums.test.js tests/contract/ui-model-presentation.test.js tests/contract/ui-table-controls.test.js` | 48/48，零失败/跳过；`numbers-boundaries-schema.log` |
| `pnpm run typecheck` | exit 0，`numbers-typecheck.log` |
| `node scripts/review-mutate.mjs <运行态 numbers-mutations.json>` | exit 0，9/9 KILLED，基线与还原后基线绿；`numbers-mutations.log` |

变异命令的测试 argv 固定为 `node --test --test-timeout=120000 tests/integration/source-number-restart.test.js tests/contract/ui-local-table-view.test.js`。最终生产树整表仅执行一次，逐项归因为：

| ID | 注入缺陷 | killedBy 用例片段 | 结果 |
|---|---|---|---|
| N1 | Provider 丢 PR 原生号 | production provider | KILLED |
| N2 | SQLite 丢号 | production provider | KILLED |
| N3 | wire 丢号 | production provider | KILLED |
| N4 | formatter 丢 scope | production provider | KILLED |
| N5 | 限定号回退标题 | qualified native tokens exclude | KILLED |
| N6 | 显式井号回退子串 | native number search is exact across | KILLED |
| N7 | client 跳过白名单 | client rejects malformed source metadata | KILLED |
| N8 | Core 放过 PR 双号冲突 | Core rejects inconsistent PR dual numbers | KILLED |
| N9 | 查询丢大小写归一 | qualified native tokens exclude | KILLED |

生产链测试覆盖真实 Provider 实现、临时 SQLite reopen、controller/client、安全列表/详情、撤权清字段、Draft promotion 同 EntityId 和冲突拒绝。跨仓/权限反例是显式 synthetic transport；浏览器测试证明默认五列内展示与详情一致，不冒称真实 Desktop 安装。
完整限定 token 是显式精确查询语法；未知 token 不回退标题。普通数字保留标题包含，井号数字只匹配原生号；筛选/排序只操作安全行，redacted 不贡献匹配计数。

## Progress

- 2026-11-07：四批完成。全部审查层均完成后才形成结论；无可提交 inline 的已证实 P0/P1/P2/P3。
- 外部门仍由主评审最终回读；本文不把本地验证当产品接受或授权合并。

## Surprises & Discoveries

当前线性解析通过单调扫描末尾数字与 scope 边界避免旧正则重叠回溯；百万空格隔离用例通过。已有安全线程对应旧实现，不构成当前缺陷。
结构化 fixture 差异只含 query hash/重录时间、repository 字段与实际观测时间戳更新；未替换对象身份。真实平台数据与 synthetic 对抗数据保持分离。
新 schema 直接修改未发布 002 基线并 fail closed 拒绝缺列库，符合本轮设计；未实施旧库迁移。403/177 为锁定 PR diff 的 additions+deletions，不包含未提交评审文档。

## Decision Log

- 2026-11-07：无已证实 P0/P1/P2/P3；建议在主评审完成当前 head 外部门回读后按仓库映射 APPROVE。不自行批准、merge 或更新 Status。
- 2026-11-07：检查缓存 83 个开放 issue；#558 是本闭环唯一叶，#537 继续拥有本地编号及人类 Desktop 接受。未发现需要另建的重复缺陷项；未创建 issue。

## Idempotence and Recovery

测试只使用临时库，可重复。夹具原文字节已恢复，`git diff --exit-code HEAD -- packages tests` exit 0。结束时唯一未跟踪文件是本文；运行态证据被忽略。若 head/base 变化，重锁并重跑相关验证。

## Interfaces and Dependencies

依赖当前 Provider、Domain、Core、SQLite、controller/client 与 ui-model/ui 的既有接口；没有新增依赖或公共 capability。读取缓存 PR/issue/thread 元数据；外部状态不由缓存永久证明。

## Outcomes & Retrospective

本轮独立检查支持 #558 的有界闭环，无已证实缺陷。核心变化保持 Host 权威、稳定 EntityId、规划/工程轴正交及 redaction。#537 本地 allocator、真实 Desktop 安装/人类接受与远端最终 readback 保持独立，未据本地测试关闭。

## Bottom Change Note

- 2026-11-07：逐文件审查前建立初始风险矩阵；完成完整审读、独立对抗、真实命令和9项变异后填入结论及边界。

2026-11-07 SGT：首轮 review `5810367190` 已由 Singularity-AI-Bot 对原锁定 head 提交 APPROVE。本会话按人类条件授权归档本叶工程 ExecPlan；安装态及父项接受保留。最终整理/push 改变 head 后须按本记录的当前回读规则重新批准，不沿用首轮批准。
