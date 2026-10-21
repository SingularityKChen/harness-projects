# PR #370 MMP 交付评审

评审对象：PR #370，head `3a75b703ad010a6d9e169e1164bfce38b4de5316`，base `main@f131e682`。日期 2026-10-21，评审账号 Singularity-AI-Bot，review `5595756125`，结论 APPROVE（只有 P3）。

## 锁定事实

| 项 | 事实 |
|---|---|
| 提交 | 6 个；作者 `Claude <noreply@anthropic.com>`，正文带 `Claude-Session` 链接（main 上没有先例，整合时去掉） |
| 关联 | Closes #352、#374 |
| 规模 | 代码 476 / 1000，文档 342 / 1500 |
| 检查 | PR Fast Gate 通过；`Create review session`（本地端点 404）、`Reconcile engineering state`（被全局并发组取消）都不阻塞 |
| 并集 | #348、#370–#373 按两种顺序合并得到同一棵树；`pnpm verify` 1755/1755、MVP-0 7/7；`pack:plugin` 后 artifact 23/23 |

## 风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 / wire | 未见：base 与 head 并排导入 `remote.ts`，descriptor 键序、冻结、原型深等；8 个 codec × 40 种输入只有 R3 已写明的两处差异 | 未见 | 未见 | 非字符串名字可进 guard；`parse` 幂等契约没有写出来 |
| 产品闭环 | 未见 | 未见：宿主网关按 descriptor 位置 `Reflect.apply`，不读 `Function.length` | 未见 | — |
| 架构 | 未见：boundaries 9/9；新模块零 import | 未见 | 未见 | — |
| 测试 | 未见 | 未见：16 个变异 15 个 KILLED；编译期探针 P1–P8 符合预期 | 未见 | descriptor 数组冻结没有测试守着（N1 存活） |
| 工作项 | 未见 | 未见 | 未见 | Change Note 漏 `eb09676`；过程性 docs 提交待整合；发布面 |

## 关键证据

- **宿主网关**：只读核对本机 Desktop 内置的 `@deepseek-ai/dsh-api-gateway` 0.2.1-rc.2 与 0.2.0-rc.2。有 strict descriptor 时按 `parameters` 位置调用 `Reflect.apply`，全文不读 `method.length` / `method.name`。
- **校验在 guard 之外**：在 base 与 head 上用真实 `createHostComposition` 各跑 34 个输入。声明过的名字结果与固定文案逐条相同，日志 +0；head 上 stream 名、未声明名、原型链键一律报固定文案，日志 +0。
- **变异**：I1、I3、I4、I5、I6、M6、M7、M13、M14、A1、C5、F1、E1、N2、N3 KILLED，N1 SURVIVED。

## 待人类决定与处置

人类对 D3–D5、D19、TD-069 的答复是「由你调研相关类似实现后综合判断」。评审会话调研 tRPC、gRPC / protobuf、VS Code extension host RPC、Electron IPC、Comlink、JSON-RPC 2.0、Cap'n Proto 之后，确认 D3–D5 与 D19，并关闭 TD-069（ExecPlan D20、调研依据）。

## 修复与复评（评审方作为后续 owner）

- `dispatchOf` 先判名字是字符串；`Param` 注释写明 `parse` 幂等；金样断言 `HOST_REMOTE.invocations` 冻结；Change Note 补 `eb09676`（ExecPlan D21）。
- 修复后的树：`tsc` 退出码 0，Host 与插件测试 55/55。N1、F1a（去掉字符串判定）、I1 KILLED；F1b（handler 按调用方名字查表）在字符串判定之后是等价变异，不加代码。
- 提交整合为 plan → test → refactor → fix → 回填归档，作者改为开发账号，去掉 session 链接，变基到含 #348 的 main。
