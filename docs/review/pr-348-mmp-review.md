# PR #348 MMP 交付评审

评审对象：PR #348，head `4190b9f9a3123113293e2fa82592f7dab80d1980`，base `main@f131e682`（不落后）。日期 2026-10-21，评审账号 Singularity-AI-Bot，review `5595755579`，结论 APPROVE（只有 P2 / P3）。

## 锁定事实

| 项 | 事实 |
|---|---|
| 提交 | 3 个（plan → fix → archive），作者 SingularityKChen，正文只有 `Refs #347` |
| 关联 | `closingIssuesReferences` = [#347]（来自 PR 正文） |
| 规模 | 代码 70 / 1000，文档 106 / 1500；disclosure 扫描与 `git diff --check` 干净 |
| 检查 | PR Fast Gate 通过 |
| 并集 | 与 #370–#373 无交集；五个 PR 按两种顺序合并得到同一棵树，`pnpm verify` 1755/1755、MVP-0 7/7（非 root） |

## 风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 未见：每个 `process.kill` 站点都在守卫或 `assert.ok` 之后 | 未见 | — | — |
| 产品闭环 / 架构 | 未见：只改一个测试文件，`scripts/` 未动 | 未见 | — | — |
| 测试判别力 | 未见 | 未见 | 协议用例只钉 `alive(0)`：N2、N3、N5 存活 | — |
| 工作项 | 未见：ExecPlan 已归档，索引正确 | 未见 | — | Progress 的提交号与时刻；「五个用例」实为四个 |

## 关键证据

- **延迟写者**（建文件 → 300 ms → 写入）：base 上 `基线中断后剩余进程 0 未被 SIGKILL`，head 上通过。良性观察：escaped 用例在 base 上对 pid 0 发 `SIGKILL`，在 head 上用真实 pid。
- **稳定性与全量**：全文件连跑 10 次，每次 18/18；`pnpm verify` 1697 + MVP-0 7。
- **变异**（`scripts/review-mutate.mjs`）：作者 M1–M3 KILLED；评审 N1、N4、N6、N7 KILLED，N2（守卫只判 `> 0`）、N3（`!== 0`）、N5（读者去掉结尾 `$`）SURVIVED，N8 存活属于计划 Decision Log 里 M3 替换的取舍。

## 修复与复评（评审方作为后续 owner，2026-10-21）

- 协议用例补 `alive` 对 `1.5`、`NaN`、`-1` 的断言（非整数排在 `-1` 之前，守卫被削弱时先失败，不对 `-1` 发信号），以及 `4242\n5` 不被读成 pid 的断言。
- ExecPlan 订正整理前的提交号、「五个用例」与时刻说明；`docs/README.md` 索引同步改为四个。
- 在修复后的树上整表重测：N2、N3、N5、M1、M2 全部 KILLED，killedBy 为「pid 标记」用例；文件逐字节还原。
- 修复的独立复评（同一子评审，只读）：结论可以；N3 变异下的良性追踪只记录到 `kill(1.5, 0)`，`-1` 从未被传入；`plan-facts-consistency`、`content-placement`、`e1-evidence-consistency` 18/18。
- 整合：仍是 plan → fix → archive 三个提交，最终树与修复后的工作树相同、文件集合相同；fix 提交单独 18/18。
