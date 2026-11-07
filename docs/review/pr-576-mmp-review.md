# PR #576 MMP 交付评审

## 锁定事实

- 日期：2026-11-07；初始 head `956fc31c4bdc37440b72f10d88bb6fa06730a6fa`，base `c1975c20aeffa960a980f01dd321e38261008f59`（`main`）；最终结论须重新锁定。
- 目标：Gate E1 冻结事实、历史证据与当前运行门禁边界。
- 评审范围：代码、产品闭环、架构、测试与反例、issue 验收、设计适度性和重复追踪。

## 预置风险矩阵（先于逐文件审查）

| 级别 | 风险假设 | 判别证据 | 当前结论 |
|---|---|---|---|
| P0 | 删除破坏 main、发布门禁或系统硬约束 | 当前基线、门禁与七条不变量核对 | 未发现；生产、fixture 与 freeze 未改 |
| P1 | 退役误删仍在使用的行为、安全/恢复路径或 CI 覆盖 | 调用方追踪、失败路径与反例、判别性现有验证 | 未发现；删除对象只有历史文档 parser |
| P2 | 验收遗漏、证据失真或边界说明不完整 | issue/ExecPlan/真实输出与 PR diff 对照 | 初审 F1；三处链接与证据均已修复并独立复评通过 |
| P3 | 文档、命名或维护成本问题 | 链接、范围、设计适度性审读 | 未发现其他可行动问题 |

## 分层证据与反例

- 代码与产品：938 行删除对象只读取文档/目录及运行自定义解析断言；没有 Provider 或应用生产函数 import，没有线上数据操作。9 条用例保护实验标题、id/变量、计数、索引、时间与 Superseded 落点，不是当前软件运行行为；独有损失已如实记录。人类 freeze 裁决、原实验与 fixture 不变，没有把本地回归冒充重新观测。
- 架构与范围：七条不变量、Planning/Engineering 正交、Host 权威性不变。active 架构计划只退役 E1 parser 引出的扫描限制和 B0-11 命令；其余原架构范围未被关闭。删除整块 parser 而不新造元模型与 #572 目标一致，无额外设计层。
- 工作项与重复追踪：读取 #572 acceptance，九条历史用例删除、不新增替代测试、损失说明和现存行为回归均符合。`gh issue list --state all --search 'e1 evidence'` 找到 #182，已拥有通用 active ExecPlan 引用检查缺口；读取其正文确认此类归档后失效链接属于已知检查空白。本 PR 的三链接可以直接修，不需新建同类 issue。

### F1 · P2：归档后更新 active 计划的退役链接

`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md:46`（同类新增行 146、458）使用相对目标 `2026-11-07-e1-record-retirement.md`，但本 PR 最终文件在 `docs/exec-plan/completed/`。三条链接从 active 文档目录解析均不存在，读者无法到达退役理由；PR 与计划中的 208 个链接全通过也不是最终树事实。修复为 `../completed/2026-11-07-e1-record-retirement.md`，在归档后的最终树重新检查并刷新证据。来源规则为 `PLANS.md` 自包含/确切路径与 #572 的当前说明准确性。无需扩展实现通用链接检查器；后者已有 #182。

## 验证与结论

执行上下文为 `.worktrees/e1-record-retirement-20261107`，head `956fc31c`；在检出根目录运行：

```text
pnpm test:file tests/contract/planning-contract.test.js tests/contract/planning-github-projects-contract.test.js tests/contract/planning-github-projects-mapping.test.js tests/integration/github-projects-bootstrap.test.js tests/contract/package-boundaries.test.js tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js
tests 110; pass 110; fail 0; cancelled 0; skipped 0; exit 0
```

按变更 Markdown 文件的 citing 目录解析 `[label](relative-path)`（排除 URL 与纯锚点）得到 210 个文件链接，207 存在、3 个不存在，恰为 F1 三处；未验证所有 heading 锚点。直接 `Path(citing.parent / target).exists()` 三处均 False。现存 `content-placement`/`plan-facts` 全绿可复现其扫描范围不覆盖此缺陷。不新增变异或测试，不声称删除后的历史一致性由这些回归替代。

## F1 修复的独立复评

2026-11-07，在 `956fc31c` 上叠加协调者未提交的修复树，独立审读完整 tracked diff：active 架构计划三处链接均改为 `../completed/2026-11-07-e1-record-retirement.md`；completed 计划保留原 208 链接观察并明确 supersede 其最终树覆盖结论，新增本次发现与复评路径。新增 Decision Log 明确修复/复评/归档/整理与合并授权范围，同时继续排除 Planning Status 和依赖写入；本评审只核对记录与本轮任务一致，合并授权由协调者依据人类原话判断。

按本次 PR 全部变更 Markdown 文件重新解析本地文件链接：210/210 存在，0 missing；F1 的三处原失败目标现在均可到达 completed 文件。命令 `pnpm test:file tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js` 实际输出为 tests 9、pass 9、fail/cancelled/skipped 均 0、exit 0。修复仅为文档链接与真实证据订正，无需扩大运行回归。未发现新增可行动 P0–P3；F1 已关闭。

初审未发现 P0/P1；修复后的本地树支持批准，最终不可变 head/checks/threads 仍由协调者重锁。协调者统一提交 review 与远端收尾；本记录不代表产品、人类或 R1 接受。
