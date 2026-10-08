# PR #289 MMP 评审记录

## 锁定事实

- PR #289「feat(providers): read GitHub Actions facts at an exact commit」，Closes #232；是 #295 之上的 adapter 片。
- 第一轮评审 head `9135cf34`，base 为 #295 的分支（`28b454a2`），2 个提交；PR Fast Gate 与 Merge Gate 各 lane 在该 head 上 success（`Create review session` 失败是本地 DSH 端点未运行，非必需检查）。
- 作者是 Codex 会话，人类伙伴指定评审会话接手两层的修订与合并。评审账号：Singularity-AI-Bot；开发、回复与合并：SingularityKChen。

## P0–P3 风险矩阵（第一轮）

| 层 | 结论 |
|---|---|
| 代码 | 精确 SHA 语义成立：请求带 `head_sha`、逐行复验、不一致整页失败；错误映射结构化。**Link 路径严格等于请求路径，会拒绝 GitHub 实际使用的 `/repositories/{id}/…` 形态**（P2，已用真实 API 回读确认）；Retry-After 解析、request id 校验、共享静态 headers 对象（P3） |
| 产品闭环 | #232 三条验收成立，但真实 GitHub 上多页读取会一直是 unknown（fail closed，不会误报 passed） |
| 架构 | 只读（rerun / cancel 返回 not_supported、零请求）；只 import capabilities 与 domain |
| 测试 | adapter 对原生 status / conclusion 的透传没有用例（P2）；分页完整性矩阵只断言 `code`，用例名所指的守卫没有判别力（P2） |
| 工作项 | 计划的 ≤800 门与本层 934 行加 `Closes #232` 矛盾（交人类裁决）；易失状态过时（P3） |

结论：0 × P0 / P1，3 × P2、5 × P3，APPROVE。

## 关键证据

- 真实回读：本仓库 check-runs、actions/runs、check-suites 响应的 `rel="next"` 都是 `https://api.github.com/repositories/<id>/<同一后缀>?…&page=N`。
- 组合变异（runs 与 checks 都伪造成 completed + success）在第一轮全量 1231/1231 下存活。

## 人类裁决与栈

- 人类伙伴裁定拆分取代归档计划中「#232 不拆」（issue #232 评论与 Decision Log「人类裁决·拆分」），两片各自不超过单 PR 1000 行的硬上限。
- #295 先合并；本层随后 rebase 到 main，只保留自己的 adapter 提交。#295 计划中只属于本层的事实（adapter 文件与验收命令、403 限流决策、回归说明）在本层的 diff 中按当前代码重写补回。

## 修复与复评

- 第一轮修复：
  - Link 先校验 host，路径接受请求路径或 `/repositories/<数字>` 加同一后缀；夹具默认使用真实形态，并加去敏的真实 envelope。
  - `PageShapeError` 带具名 rawClass，矩阵逐行断言 `[code, rawClass, 读到的 id, GET 次数]`，每个守卫都有最先触发的用例。
  - 新增原生 status / conclusion 透传用例与经 core 的接缝用例。
  - request id 只认 GitHub 的形状；Retry-After 只认纯数字秒数或 IMF-fixdate（用注入时钟）；静态 headers 按请求复制。
  - 为守住 1000 行上限，把重复用例折进表格；矩阵逐行的 `retryable` 断言删除（它由错误码派生，错误表逐行仍有断言）。
- 修复复评：0 × P0–P2、4 × P3。用真实 Link 读 3 页 runs 与 2 页 checks，三种策略下都得到完整的 CI facts，规划不变。第二轮补了非数字仓库号与非法 HTTP-date 两行，计划中接缝证据的范围在原处标注 Superseded；提交信息与 PR 描述在整合时改为当前事实。
- 最终：全量 1291/1291；代码 980/1000；第一轮与复评的变异全部 RED，只剩 4 个已论证的等价变异。
