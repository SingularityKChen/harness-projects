# PR #439 交付与独立验收

2026-10-28，检出 `fix/pull-request-identity-convergence`，实际验收候选 `8dc2f77d6dc5bcdb388cdf1a2219cd9c1969b9fd`，基线 `88d21ae6e0f0afb1f18afc776f54efac3ff4723a`。最终判定 PASS；Gate R1 和规划所有者验收仍独立。

## 闭环与设计修订

两个真实 GitHub decoder 为 PR 明确声明同一服务实例的 namespace 与 opaque node ID；Planning 与 Lineage 复用唯一全局解析，不含 workspace/account/number/URL。两种存储、两种观察顺序均收敛为一个 ChangeRequest，重放不推进业务 revision。

首次独立对抗验收要求修订两项：

| 发现 | 修复及复评 |
|---|---|
| P1：Development 的 native 声明由有变无后，创建第二 PR 并漂移 check anchor | Delivery 原子事务登记现有 ExternalIdentity 自然键；read 只查 exact，缺声明复用，明确冲突拒绝；事务再复验避免读后重绑。F1 ADDRESSED。 |
| P2：非 PR 的对象 kind 也可携声明进入谱系 | 校验 change_request 与实际 route binding；issue/draft/project_item/foreign binding 均产生 gap，保留旧事实并标陈旧。F2 ADDRESSED。 |

原计划“不登记 Development 身份”被新库中的反例推翻，已在原段落/Decision 就地标 Superseded。修复复用现有身份表，没有 schema、历史迁移、实体合并或第二身份权威。代价是摄入时精确身份读取与一次必要登记。

既有集成断言将共享身份表全表视为 Planning 私有，修订后仍逐字比较三张 Planning 表和全部旧身份；仅允许恰好一条对应本次 Development binding/PR/ref/canonical entity/正确角色的新身份。该回归失败与修正均有记录，没有删除身份保护。

## 验证证据

下列源码命令均在该分支工作树根执行：

- `pnpm test:file tests/integration/pull-request-identity-convergence.test.js tests/contract/planning-github-projects-contract.test.js tests/contract/development-github-contract.test.js`：最初因双轨身份与缺真实声明 RED，实施后 GREEN。
- 修复新增反例在两存储先 50 pass / 18 fail，修复后 68/68。原独立四条探针 4/4 RED → 4/4 GREEN。
- 作者相关八文件聚焦 202/202；`pnpm verify` 类型检查、2414/2414 主测试及 7/7 MVP 通过；boundaries 9/9、workflow 8 无发现。
- 独立复评运行 `pnpm test:file tests/integration/pull-request-identity-convergence.test.js tests/integration/github-development-lineage.test.js`：82/82。另独立执行原四条探针及四条缺声明/同实体竞争探针，全部通过。独立复评没有把作者全量测试当作自己复跑。
- SQLite 真实 close/reopen、两顺序、native→absent 重放、单 primary、精确 alias、Planning 不变、写后故障回滚及事务竞争均已验证。四组源变异被作者断言识别并还原。
- `node scripts/rule-checks.mjs disclosure origin/main`、`size origin/main` 与 `git diff --check origin/main...HEAD` 通过；产品/测试/配置增删 500 行，文档以最终检查为准。

## 最终归档与边界

最终归档只修改文档/索引；候选产品文件路径与 Git blob 的 SHA-256 为 `33004ed8c4f5b89f0031f357ed1f2345100f012699c68591b2a33f5af9a13701`，最终提交重新计算应相同。远端 head/base/checks/threads 与双向关闭引用以 PR 当前回读为准，本地验证不冒称 hosted CI。

当前 GitHub 支持面限定 github.com；将来增加别的实例需要独立 namespace，不从注入 transport 推导已支持 GHES。历史双实体修复与 Draft 提升不在本 PR。撤回能力提交恢复旧行为，不删除用户数据或反向迁移；新增身份不保证旧代码继续跨域收敛。
