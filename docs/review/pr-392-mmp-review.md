# PR #392 MMP 交付评审

2026-10-22（SGT）先建立 P0–P3 风险矩阵，再完成代码、产品闭环、架构、测试、反例与 issue 验收。采用 Superpowers 独立子评审、Qian 系统综合和 First Principles 不变量分析。

## 锁定事实

- 初审 head：`9cfb438f5065416e9ed749343ad5bccceeec1498`；base：`main@d7e7bca6aae31a4329f3238d3b90274dd683516c`。
- 检出：`feature/delivery-repository-routing` / `.worktrees/delivery-repository-routing`；初审 OPEN、ready、MERGEABLE。
- 三提交依次为计划 `ee535006`、实现 `59ceff86`、验收 `9cfb438f`，无 debug/fixup/WIP；标签 `kind:feat`、`area:core`，原生关闭引用为 #297。
- 初审 reviews/comments/threads 为空，GraphQL 无下一页。评审用 `Singularity-AI-Bot`；开发、作者回复、合并用 `SingularityKChen`。
- 原实现会话为“规划紧急重要的并行Issue”；本次无 P0/P1，由收到人类直接授权的评审协调会话负责收尾。

## 风险矩阵（逐文件审查前建立，完成后回填）

| 级别 | 初始风险 | 分层结论 |
|---|---|---|
| P0 | 错误仓库/凭据越界或规划权威被覆盖 | 未发现。只沿持久仓库现行引用选择；其他实体及 historical 不参与；无新外部写入，规划与身份不变 |
| P1 | 歧义、缺引用、门拒绝、失败降级造成断链或混源 | 未发现。Local/GitHub 并列只读远端；拒绝时零 Development/CI 读取、四集合原样 stale；PR provider 返回结构化失败只降级 PR/checks |
| P2 | 陈旧标记、恢复或回归判别力不足 | 未发现。保留节点/锚点/confirmedAt，恢复后 fresh；双 Storage 26 例及四项归因变异通过 |
| P3 | 命名、文档和证据边界 | 无独立 finding。CR gate 的语义收敛有 ADR/计划和反例，未将离线证据冒充真实 demo |

## 逐层证据

| 层 | 已检查结果 |
|---|---|
| 代码 | `readChainFacts → developmentReadBinding → routeDevelopment` 共用一次完整 `CHANGE_REQUEST_READ_ROUTE`；两次 provider 调用仅用返回引用，未重新拼 Local ref。路由拒绝产生 RepositoryRead gap，PR provider 返回结构化失败保留 commit/pipeline 推进；抛异常则由刷新 catch 将四集合标 stale |
| 产品闭环 | 公开 bind/Start Work 生成仓库锚点，公开 refresh 由单一 delivery writer 写快照，纯 query 读回 commit/PR；覆盖拒绝保留、恢复、重复刷新、存储重开后身份稳定和 query 零 provider 调用 |
| 架构 | 复用持久身份和现有路由，无第二权威源、跨层依赖、Provider 互调或规划写入口；worktree 身份沿执行上下文传播，边界 9/9 |
| 测试与反例 | registry/primary 顺序、不同 head/PR 诱饵、other-entity/historical、unavailable 声明者、完整 gate、首次拒绝、PR 单独失败均覆盖；不是只以测试数量判断闭环 |
| 工作项 | #297 五项验收逐条成立：A 挂载唯一读取、旧 key seam 变异、缺引用零读、Local/GitHub 并列与 repository.read=conflict 对照、单挂载回归。ExecPlan 已 completed，docs 索引存在 |
| 发布面 | 原始代码/测试 332 行、文档 225 行（初审快照）；机械检查及凭据、本机身份/路径、个人信息、内部系统、保密字样五类人工检查无发现 |

在本节锁定 head 的 worktree 根运行：

```sh
node --test tests/integration/delivery-repository-routing.test.js tests/integration/github-development-lineage.test.js tests/e2e/delivery-lineage.test.js tests/integration/provider-binding-registration.test.js tests/e2e/start-work.test.js tests/e2e/repository-routing.test.js
pnpm run typecheck
pnpm run boundaries
node scripts/rule-checks.mjs disclosure d7e7bca6aae31a4329f3238d3b90274dd683516c
node scripts/rule-checks.mjs size d7e7bca6aae31a4329f3238d3b90274dd683516c
git diff --check d7e7bca6aae31a4329f3238d3b90274dd683516c...HEAD
```

结果依次为 156/156（含专用双 Storage 26 例）、exit 0、9/9、exit 0、exit 0、exit 0。disclosure 未设置 PR_BODY，PR 正文另经人工核对。

从同一 immutable head 导出临时源码副本，用 `node scripts/review-mutate.mjs review-spec.json --root .` 整表复测，spec 采用 ExecPlan 的 M1–M4；所有变异显式带 killedBy。前后基线绿、exit 0、源码 SHA-256/字节恢复一致：

| 变异 | killedBy | 结果 |
|---|---|---|
| M1 恢复 capability-key seam | `AC297 registered-repository-multi-development-read` | KILLED，两 Storage |
| M2 仅按 repository.read 路由 | `AC297 side-by-side-local-github-operation` | KILLED，两 Storage、两 primary 顺序 |
| M3 选远端却重新拼 Local ref | `AC297 side-by-side-local-github-operation` | KILLED，两 Storage |
| M4 路由拒绝只输出 CR gap | `AC297 missing-current-reference` | KILLED，两 Storage |

## 当前门禁与已有追踪

初审 exact-head CI `39706746310`、Merge Gate `39706746383` 成功，Verify、PR Fast Gate、Integration/E2E/MVP-0/Boundaries、Rule checks、Issue policy、CodeQL 均通过。optional review run `39709392770` / job `119596837099` 日志为 curl 7、loopback 端点无法连接、响应 000000；#364 精确追踪，不另列源码 finding。

| 保留边界 | 已有承接，未重复报为新缺陷 |
|---|---|
| 分支分页、真实 GitHub 权限与完整 WorkItem→CI 链路 | #233、TD-040/TD-068；当前仍 fail closed |
| Delivery CI capability-key 路由限制 | #297 明确排除；ADR-0015、TD-074 |
| gap 具体原因码 | TD-046，遵守既有脱敏边界 |
| 真实 Harness 安装/人类走查 | #143，离线 provider/SQLite 证据不能替代 |
| 解绑改绑、路由冲突的产品补救 | #387，当前不得默认回退另一个连接 |

## 结论与授权收尾

建议 APPROVE，完整搜查无新增 P0/P1/P2/P3。当前产品闭环仅为 #297，不宣告上述后续范围完成。
本次人类直接授权覆盖 PR #392–#395：无 P0/P1 或仅 P2/P3 时，由评审会话修复、独立复评、归档、整理提交、处理 issue，并以 rebase 合并；已记录在所属 ExecPlan Decision Log。
后续评审文档整合与 rebase 后，须重锁新 head/base、重查 diff/range-diff、checks、issue 关联与全部线程，再提交新 head review；不得移用旧批准。保留 backup ref，代码回滚以本 PR 能力提交为单位，Git 回滚不撤销 Project 元数据。

最终整合：#393 已以 rebase 合并为 `66a01cc412303eb1ba6ea5948c78c753d654bff0`，本 PR 随后变基至该 main。路由生产/测试文件与初审字节一致；仅继承 #393 的测试执行优化及授权队列文档，当前评审记录和计划继续由本 PR 验收提交承载。最终新 head 的验证和批准以远端回读为准。
