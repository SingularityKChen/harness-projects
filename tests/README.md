# tests

三层测试，按"验什么"而不是"测什么文件"划分。运行方式：

```bash
pnpm test              # 全部三层（node --test）
pnpm test:contract     # 只跑契约层
pnpm run boundaries    # 只跑包边界契约测试
```

## 1. 分层

| 目录 | 验证对象 | 允许的依赖 | 归入门禁 |
|---|---|---|---|
| `tests/contract/` | 能力契约、包边界、错误模型、幂等语义、Provider 行为一致性 | 只有代码与 fixture，无网络、无真实凭据 | PR Fast Gate |
| `tests/integration/` | 跨包集成：SQLite 迁移与恢复、本地 Git 操作、控制器往返 | 可用临时目录与临时数据库，仍不触网 | Merge Gate |
| `tests/e2e/` | 端到端用户链路与故障降级 | 可以启动真实进程或浏览器；默认使用 Fake Provider | Merge Gate |

上行规则：下层不得依赖上层。契约测试不允许 import 集成测试的辅助代码。

## 2. 优先级

测试优先级与上游 Test & Release Plan 一致，从高到低：

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
