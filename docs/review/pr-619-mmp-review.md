# PR #619 MMP 交付评审

观察日期：2026-11-11（Asia/Singapore）。阶段：独立 MMP 工程交付审查完成；无新增 P0–P3。

## Purpose / Big Picture

独立判断 PR #619 是否构成可验收、合入和回滚的 MMP 工程闭环。先覆盖各级风险，再用代码、产品流与反例检验；测试结果不代替安装和人类接受。

## Context and Orientation

- head：`eeeb7a96f3ffc49d005084fa751776711503fa59`；base：`main` @ `063e427a719bd2ba2c50391279ee5b81f5f5bd56`。
- 执行上下文：检出 `fix/private-host-data` 的 `.worktrees/private-host-data` 根目录。
- 工作项：#597；远端回读：`gh pr view 619 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,mergeable,mergeStateStatus,isDraft,closingIssuesReferences`。
- 事实与未知：实现会话已找到；独立审查需重新验证产品结果，CI 绿不能替代验收。

## Design / Spec

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 合并即破坏主流程或泄露数据 | 错误状态、越权、失败恢复断裂 | 可恢复边界错误 | 冗余与可维护性 |
| 产品闭环 | 权威事实损坏 | 来源→持久化→展示→操作链断裂 | 非核心交互与提示缺口 | 文案一致性 |
| 架构 | 七条不变量/信任边界破坏 | 事实拥有权、依赖边不正确 | 不必要耦合 | 局部简化 |
| 测试/反例 | 安全假绿 | 关键失败路径无判别证据 | 次要缺口与过度测试 | 组织与命名 |
| 工作项/设计 | 无法独立交付或回滚 | issue 验收不成立、范围遗漏 | 证据或既有追踪缺口 | 记录清晰度 |

## Global Constraints

遵守七条不变量和层级依赖；子评审只读产品，仅写本记录；主审收尾不改产品文件。外部评审使用 gh-review，开发/提交/合并使用 gh。

## Plan of Work

锁定事实 → 全级别矩阵 → 分层审查与最窄反例 → 一次完整 review → 当前版本条件收尾。命令及结果统一在 Validation and Acceptance 记录。

## Validation and Acceptance

### 审查证据

本轮使用 `superpowers:requesting-code-review`、`qian-systems-router` 与 `first-principles-development`，按工程交付审计处理；产品代码只读，未修复、提交、推送或发布 GitHub review。

### 系统边界与证据

闭环为 Host 权威 profile → canonical 祖先准入 → 插件自有根和固定文件准入 → SQLite/日志 → typed remote 发布 → 卸载/重开。检查了 `host-authority.ts`、`host-private-data.ts`、`host-private-acl.ts`、`host-composition.ts`、`host-diagnostics.ts`、`host.ts` 与相关集成测试，并读取 Completed ExecPlan。权限归 Host 壳拥有；Storage 继续拥有 SQL/准入，未增加跨层依赖或规划状态写入。

- profile 与祖先只验证：当前 uid/root 归属，禁止不受 sticky 保护的 group/other 可写祖先；插件根通过 nofollow fd 验证后收紧 0700。固定文件需 regular、当前 uid、单链接，并以 nofollow/nonblock fd 验证后收紧 0600；拒绝链接、FIFO、外部归属及不支持平台。没有递归 chmod、数据库迁移或全局 umask 修改。
- Darwin ACL 通过传递已验证 fd 的系统查询判定，保守拒绝所有 allow、未知输出、失败和超时；接受 deny-only。真实 ACL 测试还覆盖继承、only-inherit、路径替换后原 fd 绑定和 hostile filename。Linux 分支依靠 POSIX access ACL mask 随 chmod 收紧；托管 Ubuntu `pnpm test` 已绿，本轮没有另行测量 Linux named/default ACL。
- SQLite 在根私有化后打开；真实 WAL/SHM 测试验证已有 sidecar 收紧及移除后重建，未改变 journal policy。重开保留 workspace 行和旧日志 bytes。诊断仅向已验证 fd 追加，shutdown 截止内仍记录允许名单，关闭后不重开路径；启动取消等待 ACL child close 并释放 fd。
- 真实 Gateway 测试验证 actor 仍由 Host 提供、两 profile 隔离、重开和交错调用。失败的 production `apply` 在发布任何 service/registration 前拒绝，固定 `HostAuthorityError` 不含本机路径。

### 本轮实际验证

执行上下文均为上述 worktree，版本仍为锁定 head。

| 命令/观察 | 结果 |
|---|---|
| `pnpm test:file tests/integration/harness-plugin-private-data.test.js tests/integration/harness-plugin-host-authority.test.js tests/integration/harness-plugin-host-lifetime.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js tests/integration/harness-plugin-host-github-catalog.test.js tests/integration/harness-plugin-host-providers.test.js` | 122/122，通过；无 skip |
| 临时独立 `node --test` 反例：两 deny 后尾随 allow ACL 必拒且移除 ACL 后恢复；两 deny-only 正控；DB symlink 拒绝保留外部 bytes/mode且修正后两次重开 | 3/3，通过 |
| `pnpm typecheck` | exit 0 |
| `pnpm boundaries` | 9/9，通过 |
| `node scripts/rule-checks.mjs size 063e427a719bd2ba2c50391279ee5b81f5f5bd56` | 技术 525/1000，文档 128/1500；满足该 issue 更严 800 技术预算 |
| `node scripts/rule-checks.mjs disclosure 063e427a719bd2ba2c50391279ee5b81f5f5bd56` | 通过；另读 diff/commit，未见凭据、本机路径、个人信息、内部系统或保密内容 |
| `git diff --check 063e427a719bd2ba2c50391279ee5b81f5f5bd56...HEAD` | exit 0 |
| 远端 head/base/issue/checks 回读 | head/base 未漂移，Ready、MERGEABLE，关联 Closes #597；`PR Fast Gate`、Verify、Browser、CodeQL 和规则均成功 |
| `gh run view 42993538990 --log-failed` | 可选 `Create review session` 为本地端点 HTTP 404；不在保护门禁中 |

没有改写产品文件，因此本轮未运行变异，不声称 KILLED 或由基线绿推导变异判别力。测试证据限于上述明确结果断言及独立行为反例。

### 全矩阵结论与范围

| 层 | P0/P1 判定 | P2/P3 判定 |
|---|---|---|
| 代码 | 无新增：正常/拒绝/取消/重开链成立，unsafe sentinel 不变，未提前发布 remote | 无可行动项 |
| 产品闭环 | #597 自有数据权限叶子形成独立可验收、可回滚闭环；Gateway/持久化/重开证据成立 | 无可行动项 |
| 架构 | Host 拥有权限元数据；Storage/Provider/规划轴不变，boundary 9/9 | 无可行动项；两小模块分别承担文件准入与 Darwin 平台适配，未见可证实的过度设计 |
| 测试/反例 | 新建/宽松 umask/重开/真实 sidecar/拒绝/取消/日志 fd/真实 Gateway 有判别断言；独立恢复及多 ACE 反例成立 | 无可行动项；本轮未开展变异的边界已明示 |
| 工作项/设计 | #597 原 acceptance 有对应工程证据，Completed ExecPlan 与 PR/issue 闭环匹配，技术规模 525 | 无可行动项；issue 验收框尚未机械勾选不等于产品缺陷 |

检查开放 issue #338/#340/#597/#599：#338 的 canonical worktree-root/fifth-layout 与原 parent 接受、#340 的 Local Git symlink 布局、#599 的实际安装/视觉/人验和 #73/R1 继续独立，本 PR 没有宣称完成这些范围，不作为本 PR 新缺陷重复报告。

可行动 findings：无；无需英文 inline comment。建议当前 immutable head 通过 MMP 工程评审；实际 GitHub review 和合并由主审及人类授权流程决定。回滚撤销完整能力提交，不自动放宽已收紧权限、不删用户数据。

尚未验证：真实双 uid 文件归属与访问攻击（测试为合成 foreign uid）、Linux named/default ACL 的独立实测、安装后的真实 Host/OS 环境及人类发布接受；不声称隔离恶意同 uid 进程。未重新打包或重复全套测试，复用本 head 托管 Ubuntu 全套成功与本轮 122 项针对证据。

## Progress

- [x] 2026-11-11：锁定 immutable head/base、全矩阵独立审查和本记录所列验证完成。
- [x] 2026-11-11：主审追加真实组合证据、公开面/版本回读及直接条件授权；后续合并以远端实际 ack/readback 为准。

## Surprises & Discoveries

可选评审回调真实日志为 HTTP 404，已有 #364。已确认的测试/产品边界与未验证项见验证及结果；未把缓存或历史绿色当作新 head 通过。

## Decision Log

2026-11-11：主审重新核实两个账号、全部线程分页与每个可选评审失败的真实 run 日志：本地回调 HTTP 404，已有 #364，非 required gate。当前发现集合为空，按本会话直接点名的条件授权进入 APPROVE、文档收尾及当前版本 rebase 门；正常工程验收不推进 Planning Status。

本轮四项按 #618 → #619 → #620 → #621 顺序完整预演，只有文档索引并列插入冲突。组合 `1ae1a3246df07747ca39f33c89bec17c92f15f6f` 的 typecheck 和 4033 个 contract/integration/E2E 用例通过，独立组合权限/WAL/详情 59/59；48 个不重叠产品/测试 blob 与原各 head 相同，共享详情测试保留双方安全及日期断言。逐最终 head 的发布门不从此历史观察推导，须再次回读。

组合浏览器进一步实际通过 110/110，boundaries 9/9，workflow 7 文件无 finding；本轮无产品修复。

## Idempotence and Recovery

只读测试与临时根可重跑；原始发布 head 保存于本轮 refs/backup。最终 push 使用精确 lease，合入前可恢复备份，合入后按能力提交 revert；不删除用户数据。

## Interfaces and Dependencies

依赖本仓库 Node/pnpm、现有 Provider/Storage/Host 合同及 GitHub 两套身份。各命令的检出与执行上下文由 Context and Orientation 锁定。

## Outcomes & Retrospective

2026-11-11：接合已合入 #618 的真实 main，仅联合 docs/README 索引；apps/packages/tests/scripts 对象与完整顺序预演的本阶段对象逐一一致。最终发布 head 以本记录回读命令重新取得，文档证据整理不改变已审产品。

当前 PR #619 独立审查未发现可行动 P0–P3；证据与未验证边界见 Validation and Acceptance。当前版本 APPROVE 与条件 rebase 合入仍需最终远端门。

## Bottom Change Note

2026-11-11：记录独立 MMP 风险矩阵与证据；主审按仓库要求整理为 PLANS.md 的 13 章节，保留原观察、反例与不确定性。
