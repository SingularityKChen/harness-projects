# PR #100 MVP 再评审证据

> head：`5aa70aadbdbdcef218f21d4456e75d8d1da4b8ed`
> base：`61d68330611f6fc18485f61f594a918d9946ebef`
> 状态：Draft，`CLEAN` / `MERGEABLE`

## 风险矩阵

| 等级 | 风险 | 当前结论 |
|---|---|---|
| P0 | 错误执行、权限越界、secret 泄露或错误成功 | 未发现；API 只读、解析 fail closed、无 write 权限、对象输入经 env/引号传递 |
| P1 | 移动 base ref 造成判定漂移 | 已修复；判定固定为 API `base.sha` 与事件 `head.sha`，下游显式 checkout `head_sha`，并校验两个对象 |
| P1 | stacked PR 的真实 post-merge 运行未验证 | 仍是未闭环的 MVP 证据门；ExecPlan 验收项 5 与 Progress 仍待完成，不能把当前本地/非栈 PR 运行当作证明 |
| P2 | 旧脚本基线说明过时 | 已在前一轮 `b12cd8c` 修复，并在当前 head 保留正确说明 |
| P3 | 运行时依赖 API / checkout 时序 | 已通过固定对象和 fail closed 降为可观察失败路径，无新增阻塞发现 |

## 当前验证

- 当前 head 的 GitHub checks：Resolve PR base、PR size、Disclosure scan、Verify、PR Fast Gate、Issue policy 全部通过。
- 全套测试在隔离 worktree 中 `341/341`，但仓库已有的 `workflow-check` 路径含空格用例仍失败（base 与本 PR 均存在，stdout 为空）；该失败未归因给 PR #100。
- `workflow-check` 本身输出 `no findings（已检查 5 个文件）`。
- 新增真实 git 回归测试验证：固定对象对只计算 PR 的改动；移动 branch tip 在 force-push 到无关历史时会产生假红。
- 真实 stack-member 运行仍不可在 PR #100 合并前完成；因此本轮不提交 approve。

## 评审结论

上次 P1 代码问题已修复，本轮未发现新的 P0/P1 代码缺陷。保留 P1 级交付证据门：合并后至少对一个真实 stack member 回读 `Resolve PR base`、`PR size` 与 `Disclosure scan` 日志，确认同一 `(base_sha, head_sha)` 贯穿解析、checkout 和判定范围；在该证据完成前，不应将 ExecPlan 归档或宣称 MVP 完成。
