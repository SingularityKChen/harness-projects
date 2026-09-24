# tests

按"验什么"而不是"测什么文件"分层。运行方式：

```bash
pnpm test              # 三层（contract + integration + e2e，node --test）
pnpm test:contract     # 只跑契约层
pnpm test:mvp0         # 只跑 MVP-0 进度轨道
pnpm run boundaries    # 只跑包边界契约测试
```

**在隔离 worktree 里跑测试前必须先安装依赖。** 新建的 worktree 没有 `node_modules`，而裸包名（`@harness-projects/core`）会沿父目录向上解析到**主检出**的 `packages/`——于是测试对着未修改的源码跑，「先红」拿到的是无效证据（2026-09-24 两个并行实现者在各自 worktree 上各自撞到一次，其中一次的红基线是在主检出的代码上取得的）。正确做法：

```bash
pnpm install --frozen-lockfile
ls -l node_modules/@harness-projects/core    # 期望：-> ../../packages/core（相对本 worktree）
```

这条没有机械守卫，靠人按上面两步核对。

## 1. 分层

| 目录 | 验证对象 | 允许的依赖 | 归入门禁 |
|---|---|---|---|
| `tests/contract/` | 能力契约、包边界、错误模型、幂等语义、Provider 行为一致性 | 只有代码与 fixture，无网络、无真实凭据 | PR Fast Gate；其中 `package-boundaries.test.js` 另由 Merge Gate · Boundaries 保护 |
| `tests/integration/` | 跨包集成：SQLite 迁移与恢复、本地 Git 操作、Start Work 补偿序列与身份恢复、控制器往返 | 可用临时目录与临时数据库，仍不触网 | PR Fast Gate（经 `pnpm test`）与 Merge Gate · Integration |
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
