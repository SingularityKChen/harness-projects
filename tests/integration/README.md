# tests/integration

跨包集成测试：可以有临时数据库与临时 Git 仓库，但仍然**不触网**。归入 Merge Gate。

## 第一批将落地的用例

以下用例是本层的第一批，按优先级排列：

1. `migration from empty` —— 空目录建立 Schema，约束与唯一索引生效；
2. `restart restore` —— 进程重启后身份、关系与执行上下文不丢失；
3. `event dedupe` —— 同一条 Provider 事件处理 N 次与处理 1 次结果相同；
4. `mutation idempotency` —— 重复提交同一外部写入不产生第二个外部对象；
5. `worktree lifecycle` —— 工作树创建、重复创建拦截、脏工作区拒绝清理；
6. `rollback on failed transaction` —— 事务失败后不留下半写状态。

## 约定

- 每个用例使用独立的临时目录/临时数据库，测试之间不共享状态。
- 断言要说明它在保护哪条不变量，而不是说明它调用了哪个函数。
- 外部依赖（GitHub、Actions、Harness）一律使用 Fake Provider 或录制的 fixture。
