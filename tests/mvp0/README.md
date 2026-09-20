# tests/mvp0 —— MVP-0 进度轨道

这不是第四层测试，而是一条**故意允许失败**的端到端进度断言。它把 issue #7 的纵向链路
（工作区 → 规划条目 → 工作项 → 开始工作 → 执行上下文 → 分支/变更请求 → CI）写成 7 条可判定的断言，
每条对应一个节点；每实现一个节点，失败断言数就单调下降——这就是 MVP-0 的进度指标（issue #42）。

## 1. 怎么跑

```bash
pnpm test:mvp0            # 等价于 node --test tests/mvp0
node --test tests/mvp0    # 直接跑，不需要凭据、不需要网络
```

当前**必须失败**。标准输出是 7 条 `✖ 节点 N · …`，每条 `AssertionError` 都点名
"节点「X」尚未实现"，例如：

```text
✖ 节点 1 · 工作区：同一工作空间同一时刻只有一个 Planning 事实源（不变量 1 / tests/README §2.2）
  AssertionError [ERR_ASSERTION]: 节点「工作区」尚未实现：@harness-projects/core 尚未导出 composeCore。该断言保护的不变量：…
```

## 2. 为什么失败信息是断言失败，而不是语法 / 导入错误

`chain.test.js` 只 import 已经存在的包，然后逐节点断言"所需导出已存在、链路能走通"。缺导出时由
辅助函数 `notImplemented` 抛出点名节点的 `AssertionError`，所以失败原因永远是"哪个节点还没实现"，
而不是 `SyntaxError` / `TypeError`。**不允许用 `skip` 或注释掉来消音**——skip 不产生压力（issue #42）。

## 3. 每个节点保护哪条不变量

| 节点 | 覆盖的导出 | 保护的不变量 |
|---|---|---|
| 1 工作区 | `composeCore` + `queries.listProviderBindings` | 一个工作空间同一时刻只有一个 Planning 事实源（不变量 1） |
| 2 规划条目 | `commands.bootstrapWorkspace` + `queries.listPlanningItems` | 内容与字段的事实源是 provider，本地投影只承载三态内容 |
| 3 工作项 | `queries.getItemDetail` | Draft→Issue 提升后内部 `Entity` id 不变，一个实体只有一个 primary 身份 |
| 4 开始工作 | `commands.startWork` | provider 确认前不得报告为权威 `Saved`（AGENTS.md §1.1 硬约束） |
| 5 执行上下文 | `queries.getExecutionContext` | 同一工作项 + 仓库最多一个 active 执行上下文，重复开始复用 |
| 6 分支/变更请求 | `queries.getDeliveryLineage` | 谱系沿已记录关系传播，不重新识别对象（不变量 6） |
| 7 CI | `queries.getDeliveryLineage` | CI 事实不改写规划状态（不变量 3） |

`chain.test.js` 同时钉下期望的 CoreApi 表面：`composeCore(deps)` → `{ queries, commands }`，方法名沿用
capabilities 各 port 的动词。后续批次若不采用某个名字，必须显式改对应断言并说明原因。

## 4. 为什么暂时不在 `pnpm verify` 里

两个要求直接冲突，分开是同时满足它们的唯一办法：

- issue #42 要求断言**因正确的原因失败**，且明确禁止 skip；
- `main` 的分支保护要求必需检查全绿，而 `pnpm verify` 是 `PR Fast Gate` 的一部分。

把一条必然失败的断言放进 `pnpm verify`，等于让红叉常态化，随后所有人就会开始忽略它。所以它由
`test:mvp0` 单独运行，`pnpm verify` 里只有 `tests/contract`、`tests/integration`、`tests/e2e` 三层。
这条轨道因此**不归入 tests/README.md §1 的任何一层**，也不参与分支保护。

## 5. 什么时候提升进门禁

Batch C5 让 7 条断言全绿时（`packages/controller`、`packages/client` 落地，链路可从类型化 API 观测），
把 `test:mvp0` 加进 `pnpm verify` 的 `test` 或 `verify` 脚本，这条轨道随之升级为必需检查；同时更新
tests/README.md 的登记与 ExecPlan 的 Progress。
