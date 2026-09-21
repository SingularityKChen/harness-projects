# 持久化栈（B）ExecPlan

> 状态：Active
> 创建：2026-09-20
> 范围：只做一件事——让"建表"这件事本身可信：一个从空库可重复执行、失败不留痕的迁移运行器，外加一条最简迁移。不建任何业务表。
> 上游输入：`AGENTS.md`、`PLANS.md`、`docs/exec-plan/active/2026-09-20-mvp0-parallel-stacks.md`（控制计划）

## Purpose / Big Picture

完成后，`packages/storage/sqlite` 里有一个可以对着任意空目录运行的迁移运行器：第一次运行创建数据库并记录版本，第二次运行什么都不做，一个抛错的迁移不会留下版本记录。这是 #27/#28 那些真正的表落地之前必须可信的机制。

```bash
node --test tests/integration      # 每个用例用自己的临时数据库
pnpm run boundaries                # storage/* 仍然只依赖 capabilities 与 domain
```

最小成功证据：一个"迁移抛错后版本号不变"的用例存在且通过——如果运行器把版本号写在了迁移执行之前，这条用例必须失败。

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 迁移（migration） | 一次有序、只增不改的 schema 变更，带一个单调递增的版本号 |
| 迁移运行器 | 读当前版本、按序应用缺失迁移、记录新版本的那段代码 |
| 从空库可重复 | 在空目录上运行能建库；在已有库上再运行是幂等的 |

### 当前事实

- `packages/storage/sqlite/src/index.ts` 只有一个 `packageId` 常量；没有 `migrations/` 目录。
- 包边界：`storage/*` 只允许依赖 `capabilities` 与 `domain`，不允许 import provider 或 core。
- Node 26 提供 `node:sqlite` 的 `DatabaseSync`（本次交付不引入任何第三方数据库依赖）。
- `tests/README.md` 把"SQLite 迁移与恢复"明确归到 `tests/integration/` 层。

### 为什么这一批不依赖 Gate E1

Gate E1 门禁的是**身份键的形状**，而迁移运行器的正确性与表长什么样无关。把它排在裁决之前，是为了让 #27/#28 落地时只需要写表，不需要同时发明机制。

## Design / Spec

### D1. 版本记录与迁移体分离

`schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)` 记录"到过哪里"；迁移体本身是 `packages/storage/sqlite/migrations/*.sql`，由一个显式的有序清单（TS 模块）声明版本与文件名的对应关系。清单不扫描目录：扫描会让"文件被误删"表现为"版本静默缺失"，而显式清单让同一件事变成一次测试失败。

### D2. 每个迁移在自己的事务里，版本号在成功后写入

顺序必须是：开启事务 → 执行迁移体 → 写入 `schema_migrations` → 提交。把版本号写在执行之前，就会出现"半执行的库被标记为已迁移"——这正是本批次要防的那个失败模式。

### D3. 只增不改

已应用过的迁移文件不得再被修改；新变更用新版本号。回滚不是反向迁移，而是从备份恢复（`AGENTS.md` 与上游发布计划的立场一致）。运行器因此**不实现 downgrade**，并且要在代码注释里写清楚这是决策而不是遗漏。

### D4. 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 引入 `better-sqlite3` 等第三方驱动 | Node 内建 `node:sqlite` 已够用；引入原生依赖会让 CI 与本地环境多一个失效点 |
| 扫描 `migrations/` 目录自动发现迁移 | 文件被删或改名会静默改变已应用集合；显式清单让同一问题变成可见的测试失败 |
| 现在就建业务表（身份、成员、执行上下文） | #27/#28 明确等 Gate E1 裁决；提前建表会把错误的键固化 |
| 自动 downgrade | 反向迁移在真实数据上不可靠；回滚策略是备份恢复 |

## Global Constraints

- 不引入第三方运行时依赖。
- 单文件 ≤ 200 行，单函数 ≤ 40 行。
- 测试不得共用一个数据库文件：每个用例创建自己的临时目录与数据库，结束后清理。
- 不修改 `packages/**` 之外的文件（`package.json`、`tsconfig.json` 此处无需改动：本批次不新增包、不新增依赖）。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch B1 · 迁移运行器（Closes #26）

**最小闭环**：一个从空库可重复执行、失败不留版本记录的迁移运行器，加一条最简迁移。

**涉及文件**：`packages/storage/sqlite/src/{index.ts,db.ts,migrate.ts,migrations.ts,types.ts}`、`packages/storage/sqlite/migrations/001_init.sql`、`tests/integration/migration-runner.test.js`

- [ ] `db.ts`：打开数据库（路径或 `:memory:`）、开启外键、设置忙等待，返回一个窄接口
- [ ] `migrations.ts`：有序清单（版本 + 文件名），以及"清单必须严格递增且无重复"的自检
- [ ] `migrate.ts`：读当前版本 → 逐个应用缺失迁移（每个一个事务）→ 记录版本；返回应用了哪些版本
- [ ] `001_init.sql`：只创建 `schema_migrations` 本身，证明机制可用
- [ ] 集成测试：空库建库与版本记录；第二次运行无变更；抛错迁移后版本不变；`migrations.ts` 清单自检失败的用例

**验证**：

```bash
node --test tests/integration
node_modules/.bin/tsc --noEmit
pnpm run boundaries
```

期望：全部通过；把版本号写入移到迁移体执行之前，"抛错后版本不变"的用例失败。

**回滚**：`git revert` 本批提交。本批次不触碰任何其它包，回滚后仓库回到"没有迁移机制"的状态，其它栈不受影响。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 空目录上运行迁移会创建数据库并记录版本 | `node --test tests/integration` 的第一个用例 | 待验证 |
| 2 | 第二次运行不改动任何东西并报告同一版本 | 同一文件内"重复运行"用例（比较 schema 内容与版本） | 待验证 |
| 3 | 抛错的迁移不留下版本记录 | 注入缺陷实验：交换版本写入与迁移执行的顺序 → 用例失败 | 待验证 |
| 4 | 每个用例用自己的临时数据库且互不影响 | 用例内的临时目录 + 并行运行仍全绿 | 待验证 |
| 5 | `storage/*` 不 import provider 或 core | `pnpm run boundaries` | 待验证 |
| 6 | 清单自检能拦住重复或不递增的版本 | 一条针对 `migrations.ts` 的单元用例 | 待验证 |

## Progress

- [ ] Batch B1 · 迁移运行器（#26）

## Surprises & Discoveries

（实现期间如实记录。已知一条：本机跑 `pnpm install`/`pnpm run` 需要 `npm_config_manage_package_manager_versions=false`，否则 pnpm 会尝试安装被 pin 的版本并因沙箱写权限失败——这是本机限制，不是仓库问题。）

## Decision Log

- **Decision**：用 Node 内建 `node:sqlite`，不引入第三方驱动。
  **Rationale**：仓库目前零运行时依赖；迁移运行器的正确性与驱动选择无关，而原生依赖会给 CI 与本地各加一个失效点。
  **Date/Author**：2026-09-20 / agent

- **Decision**：只增不改，不实现 downgrade。
  **Rationale**：反向迁移在真实数据上不可靠；回滚策略是从备份恢复。这是决策，不是遗漏，因此写进代码注释。
  **Date/Author**：2026-09-20 / agent

## Idempotence and Recovery

- 迁移运行器本身是幂等的：重复运行只报告"无事可做"。
- 测试用临时目录，失败后可重复执行；不需要清理全局状态。
- 若某个迁移文件被误改导致已应用的库与清单不一致，运行器必须报错而不是静默跳过——恢复方式是恢复到未修改的迁移文件，或从备份重建数据库。

## Interfaces and Dependencies

**对外提供的接口（供 #27/#28 与切片栈使用）**

```text
openDatabase(location: string | ':memory:'): WorkspaceDatabase
migrate(db: WorkspaceDatabase): { applied: number[]; version: number }
MIGRATIONS: readonly { version: number; file: string }[]
```

**依赖的仓库设置**

- Node 26（`node:sqlite`），无第三方依赖。
- 分支保护：只允许 rebase merge。

## Outcomes & Retrospective

完成后填写：实际签名的形状、与设计的偏差、留给 #27/#28 的未决项。

## Bottom Change Note

- 2026-09-20：首次创建。原因：持久化是控制计划中的独立栈，它与契约栈并行，且刻意不依赖 Gate E1 裁决。
