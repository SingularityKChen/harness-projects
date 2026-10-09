# PR #286 MMP 评审记录

## 锁定事实

- PR #286「feat(ui): align planning facts in the work item detail drawer」，Closes #274。
- 第一轮评审 head `730632ba`，base `main@6417d459`，5 个提交；评审前没有 review 或 thread；12 项 checks 在该 head 上 success（`Create review session` 失败是本地 DSH 端点未运行，非必需检查）。
- 评审账号：Singularity-AI-Bot；开发、回复与合并：SingularityKChen。作者是 Codex 会话，人类伙伴指定评审会话接手修订与合并。

## P0–P3 风险矩阵（第一轮）

| 层 | 结论 |
|---|---|
| 代码 | 两个新字段在 redacted 复验之后从同一次列表安全行复制；loading / unavailable / unresolved / redacted 变体不变 |
| 产品闭环 | 列表与详情三字段同源、缺值占位相同；date-only 原样；只读 |
| 架构 | 只改 ui-model / ui；不变量与依赖边不变 |
| 测试 | date-only 判别力只在手工的非 UTC 运行里存在（P2）；raw 二读的状态 canary 失活（P3） |
| 工作项 | ExecPlan 多处仍写「产品实施未执行」（P3）；Progress 写入已过期的静态 PR 状态（P3） |

结论：0 × P0 / P1，1 × P2、3 × P3，APPROVE。

## 关键证据

- 变异：view 中 `new Date(d).toLocaleDateString('sv-SE')` 只在 America/Los_Angeles 下 RED；`new Date(d + 'T00:00:00').toISOString()` 只在东八区 RED；必需检查跑在 `ubuntu-latest`（UTC），两者在 CI 中都存活。
- 状态改为从 raw 二读按同一规则重算时 20/20 全绿：raw 二读沿用 `in_progress`，`RAW-STATUS` 不可能出现。
- 并集：main + #286 / #287 / #288 / #295 / #289 全量 1314/1314。

## 修复与复评

- 两条 date-only 断言改为在用例内依次切换 UTC、Asia/Shanghai、America/Los_Angeles、Pacific/Kiritimati（修复复评补入 Kiritimati：以正午为锚的换算只有 +14 才跨日）；safe-row 来源用例的 raw 二读改为 `unknown`。
- 修复复评：0 × P0–P2、4 × P3，全部处理。最终树 12 个变异在 UTC 下全部 RED；全量 1212/1212。
- 提交整合为规划 / 代码交付物 / 归档三个，复评 APPROVE 后 rebase merge（main `4f3dccf3` → `4987411c` → `7a46a272`），#274 关闭。
