# tests

按"验什么"而不是"测什么文件"分层。运行方式：

```bash
pnpm test              # 三层（contract + integration + e2e，node --test）
pnpm test:contract     # 只跑契约层
pnpm test:mvp0         # 只跑 MVP-0 进度轨道
pnpm run boundaries    # 只跑包边界契约测试
pnpm test:file <path>  # 单个测试文件或目录，先查解析落点
```

**在隔离 worktree 里跑测试前必须先安装依赖。** 新建的 worktree 没有 `node_modules`，而裸包名（`@harness-projects/core`）会沿父目录向上解析到**主检出**的 `packages/`——于是测试对着未修改的源码跑，「先红」拿到的是无效证据（2026-09-24 两个并行实现者在各自 worktree 上各自撞到一次，其中一次的红基线是在主检出的代码上取得的）。

这条有机械守卫 `scripts/resolution-check.mjs`：它从自身位置锁定检出根，检查根 `package.json` 声明的每个 `@harness-projects/*` 根入口及其 canonical manifest 声明的精确子路径在相关解析边界上是否落在**本检出之内**。边界包括根、package self-reference scope，以及 `packages/`、`apps/`、`tests/`、`scripts/` 任意深度的 `node_modules` 父目录；依赖树不递归，构建输出复用 `tests/fixtures/source-tree.mjs` 的剪枝来源。缺包、坏 manifest、悬空/外指边界与不可读目录均失败闭合；源码目录和文件软链显式拒绝，避免包的子路径导出经软链逃逸。根目录别名与根内 `node_modules` 软链允许，最终落点仍取 realpath。

`pnpm test`、`pnpm test:contract`、`pnpm test:mvp0`、`pnpm run boundaries` 与 `pnpm test:file <path>` 都先跑守卫。每个受管 `tests/**/*.test.js` 的第一条 import 另相对导入 `tests/fixtures/resolution-preflight.mjs`；因此 `node --test <文件或目录>`、`node <文件>` 和故意不加 `--test` 的前缀回读也在工作区模块 body 执行前受保护。新增测试遗漏首 import 会由动态发现契约判红。layer runner 在起子进程前显式断言；把 runner 当库导入时不触发整仓检查。成功只做进程内缓存，不跨命令缓存安装状态。

失败会给出 `resolution-check:` 诊断、违规包落点或边界与安装指引。先移除诊断指出的残留 shadow 或源码软链，再在检出根目录执行：

```bash
pnpm install --frozen-lockfile
```

单独检查用 `node scripts/resolution-check.mjs`（通过时静默退出 0）。解析使用 `createRequire(...).resolve`，现有工作区包的精确无条件导出由契约保护。现有 `domain/values`、`capabilities/keys`、`controller/keys`、`controller/values`、`client/keys`、`client/delivery` 子路径全部按解析上下文取 realpath；根内复制 shadow 包的子路径外指同样拒绝。根绑定的 canonical manifest 及各上下文实际命中的 workspace 包均检查导出形状，条件、数组或通配导出明确失败闭合。引入这些形状或改变源码边界前，应同步更新守卫与反例，不能靠重新安装消除 import/require 条件差异。守卫不遍历第三方依赖树。具体 direct/shadow 与 marker 证据见 [本次 ExecPlan](../docs/exec-plan/completed/2026-10-22-worktree-module-isolation.md)。

## 1. 分层

| 目录 | 验证对象 | 允许的依赖 | 归入门禁 |
|---|---|---|---|
| `tests/contract/` | 能力契约、包边界、错误模型、幂等语义、Provider 行为一致性 | 只有代码与 fixture，无网络、无真实凭据 | PR Fast Gate；其中 `package-boundaries.test.js` 另由 Merge Gate · Boundaries 保护 |
| `tests/integration/` | 跨包集成：SQLite 迁移与恢复、本地 Git 操作、Start Work 补偿序列与身份恢复、控制器往返、插件安装件构建 | 可用临时目录与临时数据库，仍不触网 | PR Fast Gate（经 `pnpm test`）与 Merge Gate · Integration |
| `tests/e2e/` | 端到端用户链路与故障降级 | 可以启动真实进程或浏览器；默认使用 Fake Provider | PR Fast Gate（经 `pnpm test`）与 Merge Gate · E2E |
| `tests/mvp0/` | MVP-0 纵向链路：工作区 → 规划条目 → 工作项 → 开始工作 → 执行上下文 → 分支/变更请求 → CI 的 7 条节点断言（issue #42） | 只有代码与 fixture，无网络、无真实凭据 | Merge Gate · MVP-0 |

四条 lane 由 `.github/workflows/merge-gate.yml` 发布，每条 lane 通过 `scripts/run-test-layer.mjs <layer> <invariant>` 运行并点名它保护的不变量；空层与零用例层都会失败（`node --test` 对"没有用例"退出 0，"目录存在即绿"不算证据）。

`tests/mvp0/` 是一条独立的纵向进度轨道；当前 7 条断言全绿，由 `pnpm verify` 与 advisory 的 `Merge Gate · MVP-0` 运行。该目录 README 的 §4–§5 记录它尚未进入 required branch protection 的当前状态。

上行规则：下层不得依赖上层。契约测试不允许 import 集成测试的辅助代码。

## 2. 优先级

测试优先级从高到低：

1. 身份不变量（成员关系与内容身份分离、Draft → Issue 身份不变）；
2. 事实所有权（本地缓存不得篡位成为外部事实源）；
3. 外部写入安全（unknown / conflict / stale 的恢复）；
4. 同步幂等与恢复（重复、乱序、缺失事件）；
5. 跨域编排（从工作项到工作树、分支、执行会话）；
6. Provider 能力契约；
7. 客户端重连与陈旧状态；
8. 界面展示一致性。

覆盖率是结果指标，不是设计输入。

## 3. 写法要求

- 每个测试用例的**名字**要说明它在保护哪条不变量，而不是说明它调用了哪个函数。
- 结构类约束（包边界、依赖方向）用契约测试固定，见 `tests/contract/package-boundaries.test.js`。
- 涉及外部系统的测试必须能在无凭据环境下跑通（用 Fake Provider 或录制 fixture）；真实平台的验证属于 Gate E1 spike，不放进普通 CI。
- 故障场景必须显式覆盖：provider 离线、权限被撤销、重复事件、乱序事件、创建结果不确定、执行失败降级。
- 新写或改动的、遍历 `packages/`、`apps/` 找源码的扫描一律经 `tests/fixtures/source-tree.mjs`（`callSites`、`listSourceFiles`、`ignoredDirectoryNames`），不在测试里手写递归和跳过名单：什么算构建产物只由根 `.gitignore` 的裸目录规则回答。否则本机跑过 `pack:plugin` 后残留的、被忽略的 `apps/harness-plugin/dist/` 会被当成源码，扫描看到的集合与 CI 的干净检出不一致。这条没有机械守卫，靠评审核对。
