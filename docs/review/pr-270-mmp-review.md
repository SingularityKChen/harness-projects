# PR #270 MVP 评审记录

## 锁定事实

- 评审目标：PR #270，当前 head `e34529c5c06c722be1ba9ed75c80367dd6471aca`，base `main`。
- 当前 PR 为非 draft、`MERGEABLE`、`BLOCKED`（原因是评审状态待满足合并门）、closing issue 为 #126；当前 GitHub checks 全部成功。旧 head `7d76cc8` 的评审证据不再作为当前 head 依据，已按 §1 重新锁定并回读。
- 本地工作树分支为 `feature/connector-account-storage`，当前 checkout 为 `e34529c`，与远端 head 一致。
- 当前 head 代码规模为 `1000/1000`、文档约 `313/1500`；规模事实已由人类接受为本轮授权例外/实测预算，不作为本 PR 的阻塞项。

## P0–P3 风险矩阵

| 层 | P0 | P1 | P2 | P3 | 结论 |
|---|---|---|---|---|---|
| 代码 | 未发现 | 未发现 | Fake 导入状态完整性与 SQLite 不完全同形；见下方意见 | 个别固定错误文本/排序属于契约维护成本 | 无 P0/P1；P2 保留为已登记债务 |
| 产品闭环 | 未发现立即破坏 main 的路径 | 真实 credential resolve、宿主装配不在本 PR，且 PR 明确 out-of-scope | 账号/配置 Storage 闭环满足 issue #126 的范围；不能宣称真实 GitHub 连接完成 | 无 | #126 验收范围基本闭合 |
| 架构/信任边界 | 未发现反向依赖或凭据值写入 | schema review 依赖受信组合根前提，不能当作 TEXT 物理保密；PR 已明确该限制 | Fake 的公开 `data` 面与 SQLite 裸 SQL 旁路是已知纵深边界；读取复验已覆盖主要元数据 | 无 | 不变量基本保持 |
| 失败/恢复 | 未发现半事务写入路径 | 真实 credential resolve/宿主装配不在本 PR | 当前 head 的 002 形状、非法策略、句柄清理均有判别测试 | 无 | 无 P0/P1 |
| 测试判别力 | 未发现测试全绿但完全无对象 | 当前 head checks 已回读且全绿 | Fake webhook 事实未能与 SQLite 对齐测试；`FakeStorageData` 没有 webhook 表（已在注释承认） | 变异证据主要在 ExecPlan，非自动门禁 | P2 parity debt，非阻塞 |
| 工作项/ExecPlan | 未发现 issue 关联缺失 | 当前实际 head 漂移使旧证据失效 | 代码余量仅 6 行，后续净增须先减量；ExecPlan 仍 Active 是预期评审状态 | 计划文案较长 | 不因规模单独阻塞 |

## 候选 inline 意见

### 1. P2（非阻塞，测试/适配器判别力）

- path: `packages/providers/fake/src/storage.ts`
- line: 186–189
- side: RIGHT
- body: `Fake 的 setProviderBindingAccount 只检查 identities/cursors/attempts/observations，未能表达 SQLite 侧同一守卫检查的 webhook_subscription 事实（此处注释也承认替身没有 webhook port）。因此“有旧事实的锚点不得补账号”并非两个适配器同形：若未来新增/导入 webhook 事实，Fake 可能接受而 SQLite 拒绝。建议为 Fake 状态/契约增加 webhook fixture，或明确把该事实检查移出共享契约并登记 parity debt。`
- severity: P2
- blocking: 否

### 2. P2（非阻塞，测试/公开可变面）

- path: `packages/providers/fake/src/storage.ts`
- line: 79–101
- side: RIGHT
- body: `MemoryStorage.data 是公开可变字段；构造时只复验 accounts/configurations/bindingAccounts 的部分引用完整性，不复验自然键重复、账号同 id/自然键冲突或所有 workspace/mount 父边。任何测试/宿主直接写 data 都可制造 SQLite 不会接受的状态，随后读口可能才失败。PR 风险段已将公开 data 列为 TD-027；请保留该债务并确保它不被描述为 Fake 与 SQLite 的完整等价。`
- severity: P2
- blocking: 否

## 代码与反例审查摘要

- 账号自然键 `(platformFamily, platformOrigin, identityKind, externalId)` 的同 id 换自然键、同自然键换 id 均有显式守卫；SQLite 的 `UNIQUE` 不再是唯一判别，契约已要求 `RangeError` 且不暴露驱动文案。
- `secret_handle` 只接受 POSIX 名称形状并命中受信 allowlist；schema review 正确声明这依赖受信组合根，不能证明任意 TEXT 列物理上不能存秘密。canary 测试覆盖 DB/WAL/SHM、Fake export、错误文本和发布面，但不构成通用秘密检测。
- 配置按真实锚点 `implementationKey` 选择受信 schema，闭集字段、显式 `undefined`、原型对象、数组、嵌套值和坏正则均有拒绝路径；`__proto__` 使用 null-prototype fields，避免静默丢字段。
- 旧 002 形状判据既在工厂 `migrate` 前检查，也挂到迁移 003 的 `data.preflight`，直接 `migrate(db)` 不会先落 003–005；列集比较按 SQLite 标识符大小写语义处理。
- 事务失败回滚、关闭句柄、策略失败先于 IO、重启逐字段相等均有窄测试；当前远端 head `e34529c5` 的 GitHub Verify/Merge Gate/Boundaries/Integration/E2E/MVP-0/PR Fast Gate/PR size/Disclosure/Issue policy 全部 pass。

## 整体结论

当前 head `e34529c5c06c722be1ba9ed75c80367dd6471aca` 已重新锁定；checks 全部通过，未发现 P0/P1 运行时缺陷。两条 P2（Fake webhook parity、公开 `MemoryStorage.data`）均属于非阻塞债务：Fake webhook port 不在本 PR 的现有范围内，公开 data 收口会影响既有测试注入面且当前规模余量为零，因此本轮不扩大代码范围。#270 可进入评审后归档与合并流程。真实 credential resolve、Host 装配与 Gate R1 仍不属于本 PR 的产品闭环。
