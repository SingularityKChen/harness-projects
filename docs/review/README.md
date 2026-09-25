# docs/review

评审怎么进行：谁看什么、按什么标准判定、意见落在哪里。分支保护与 PR 规则在 `AGENTS.md` §8，这里只讲**评审本身**。

完整 MVP 风险矩阵流程见 [mvp-review.md](mvp-review.md)，评审意见回复、根因修复和 thread resolve 见 [responding.md](responding.md)。本文件保留证据选择、严重度和意见落点标准。

## 1. 评审前先核实事实

评审的第一步不是读描述，而是把可核对的事实拿到手：

```bash
gh pr view <n> --json baseRefName,headRefOid,mergeable,mergeStateStatus,isDraft,commits
gh pr diff <n>            # 读 diff，不读摘要
gh pr checks <n>          # 哪些检查真的跑过、结果是什么
```

- `mergeStateStatus: BEHIND` 说明分支不满足 `strict` 要求，需要先更新再评审；`DIRTY` 说明有冲突。
- 分支被 force-push 或 retarget 之后，之前基于旧 head 的结论**作废**，重新读一次 diff。
- 只报告**实际跑过**的命令与**实际观察到**的输出；不要用"应该没问题"补空白（`AGENTS.md` §6.2）。

## 2. 作者侧：按改动面选最小证据

不是每次都跑全量。按"改了什么"选能判定这一面的最小证据，并把结果写进 PR 的验证证据：

| 改动面 | 最小证据 |
|---|---|
| 包内行为（`packages/*/src`） | `pnpm test`（契约 + 相关单测），必要时先在本地看到失败 |
| 跨包结构与依赖 | `pnpm run boundaries`（依赖边矩阵） |
| 门禁与 CI | 在 PR 上确认检查名出现且通过；改检查名要同时改保护配置与 `AGENTS.md` §9.2 |
| 工程配置（`package.json`、`tsconfig*`、`pnpm-lock.yaml`） | `pnpm install --frozen-lockfile` + `pnpm verify` |
| 文档 | 文档内命令逐条执行过一次；链接匿名可访问 |
| 发布面（`README`、`LICENSE`、`.gitignore`） | 链接 / 许可证识别 / 忽略规则的回读结果 |
| 外部状态（GitHub 项目、保护配置、webhook） | 创建后**回读**一次，并说明 revert 不能回退这部分 |

拿不到证据时，如实写"未验证 + 原因"，而不是省略这一栏。

## 3. 评审者：必查项

按优先级从高到低。高优先级的问题即使只有一条，也足以阻塞合并：

**阻塞级（blocking）**

1. **正确性**：逻辑是否在正常路径与失败路径上都成立；错误是否被吞掉或伪装成成功。
2. **不变量**：是否破坏 `AGENTS.md` §1.3 的七条不变量，或 §2.2 的依赖方向（后者应有契约测试覆盖，测试缺失本身就是问题）。
3. **事实所有权**：是否让本地/缓存/派生值篡位成为权威状态；是否存在乐观的"已保存"。
4. **安全边界**：密钥、token、内网地址是否入库；外部写入是否可追踪；破坏性操作是否有显式确认。
5. **证据强度**：声称验证过的项是否真有输出；测试是否只是"跑通"而没有可失败的断言。
6. **范围与归属**：改动是否超出该 PR 声明的闭环；是否顺手改了批次外的代码。

**建议级（suggestion）**

7. 命名、结构与可读性；文档表述；重复实现；后续可做的简化。

一条有证据的阻塞问题胜过一堆风格提醒；已被绿色门禁覆盖的问题不再提。

## 4. 意见落在哪里

| 情形 | 形式 |
|---|---|
| 缺陷可定位到具体行 | **行级评论**（inline），贴在最小相关行范围 |
| 跨文件、范围判断、整体结论 | PR 级评论（避免在十处重复同一句话） |
| 阻塞与建议 | 分开写，标明 `[blocking]` / `[suggestion]` |

行级评论命令：

```bash
gh api repos/SingularityKChen/harness-projects/pulls/<n>/comments \
  -f body='[blocking] 这里让 ui 依赖 provider 实现，会破坏能力可替换性（AGENTS.md §2）。' \
  -f path='packages/ui/src/index.ts' -F line=12 -f side=RIGHT \
  -f commit_id="$(gh api repos/SingularityKChen/harness-projects/pulls/<n> --jq .head.sha)"
```

每条意见写清：**缺陷是什么、在哪、影响是什么、证据是什么**。收到评审的人逐条核实，用技术理由修复或反驳，不做表演式同意；不同意时在同一个 thread 里回复，不开新 thread。

## 5. 评审归属

本仓库按**领域**声明归属，不按人；当前所有领域由维护者负责。扩展点：出现第二位维护者时，把下表映射为 `.github/CODEOWNERS`，并重新评估是否启用"需要 code owner 批准"。

| 领域 | 关注点 | 对应文件 |
|---|---|---|
| 架构与依赖方向 | 七条不变量、依赖边矩阵 | `AGENTS.md` §2、`tests/contract/` |
| 领域与核心 | 身份模型、状态策略、投影语义 | `packages/domain/`、`packages/core/` |
| 提供方实现 | 能力契约一致、无跨 Provider 调用 | `packages/providers/`、`packages/capabilities/` |
| 前端 | React-free 边界、展示与事实分离 | `packages/{client,ui-model,ui}/` |
| 文档与发布面 | 可分发性、命名中性、许可与商标 | `docs/`、`README.md`、`LICENSE`、`.gitignore` |
| 门禁与 CI | 检查名与保护配置一致 | `.github/workflows/`、`package.json` scripts |

## 6. 安全姿态

- **必需检查只引用一个名字**（`PR Fast Gate`）。它由聚合 job 发布，该 job **不执行 PR 代码、不读 secrets**，只汇总其他 lane 的结果；增删 lane 不需要改分支保护。
- 运行 PR 代码的 lane 使用 `pull_request` 事件（fork 场景下 token 只读），不使用 `pull_request_target`。
- `github-review.yml` 是明确的特例：它响应 `pull_request_target`，只使用默认分支定义、过滤同仓 PR、转发事件 payload，不 checkout 或执行 PR 代码；它运行在 self-hosted runner 上，权限为空。不要把这个只读信号入口推广成普通 PR 执行入口。
- **改门禁或依赖边矩阵的 PR 单独提交**：`.github/workflows/`、`tests/contract/package-boundaries.test.js` 的改动不与其他改动混在一个 PR 里，便于把它当作一次"规则变更"单独评审。
- 评审者不 approve 自己参与的 PR；批准门禁与检查门禁是两道独立的门。

## 7. 可选增强：DSH 在 PR ready 时自动开只读评审会话

上游平台提供了一个可选 overlay：GitHub 的 `pull_request` → `ready_for_review` 事件会创建一个**只读**评审会话（不修改文件、分支、PR 或 GitHub 状态）。

**本仓库已选定自托管 runner 路径**（只出站、零入站暴露），落地细节见 `docs/review/github-runner.md`（由同期的 runner PR 引入）。如果你要用上游文档里的公网 webhook 路线，下面是它的前置条件：

- 需要公网 HTTPS 入口（TLS 反代或 tunnel）才能让 GitHub 投递；适配器自身不提供 TLS。
- 需要凭据 `DSH_GITHUB_WEBHOOK_SECRET`（写入 DSH 凭据引用后按请求解析，轮换立即生效）。
- 规则按仓库匹配，改配置即可指向本仓库，不需要改规则代码。
- 语义偏弱：HTTP 202 只表示"签名与 JSON 被接受、规则调用已入队"，不代表规则匹配或会话已创建；没有队列、重放与去重，进程崩溃会丢掉尚未接纳的调用。
- 它只在 draft → ready 时触发一次；后续推送不会重新触发。

因此它适合"有人值守时多一双眼睛"，不适合当作门禁。启用步骤见上游 `docs/user/guide/github-review.md`；本仓库在启用前需要先决定公网端点方案，并把这台机器的重启影响算进去。

## 8. 评审记录

本目录除评审标准外，也保存**成批评审的记录**：跨多个 PR、结论需要长期可查的那种。单个 PR 的意见留在 PR 上，不进这里；判据与 §3.4 一致——删掉之后接手的人会不会缺失决策依据。

| 记录 | 范围 | 结论 |
|---|---|---|
| [2026-09-18-mvp-delivery-review](2026-09-18-mvp-delivery-review.md) | 9 个开放 PR（#3 #11 #12 #13 #19 #21 #33 #35 #37）的 MVP 交付评审 | 8 个合并、#37 因两条 P0 暂缓；风险矩阵、38 条行级意见、13 个跟踪 issue（#38–#50） |
| [2026-09-18-stacked-checker-convergence-review](2026-09-18-stacked-checker-convergence-review.md) | 规则语义收敛栈 7 个 PR（#56–#61 #63）的交付评审：逐 PR 锁定 head 与体量证据 | 本轮一个都不合并——1 条 P0、7 条 P1；队列首位自身带 3 条 P1，事实上堵住整条队列 |
| [2026-09-18-rule-semantics-stacked-review](2026-09-18-rule-semantics-stacked-review.md) | 同一栈（#60 #56–#59 #61 #63）的 MVP 交付评审：批次划分、合并顺序假设与合并并集模拟 | #61 存在未解决的 P0/P1 而 Blocked；其余 6 个可继续排队，并给出 #61 的可复现修复路径 |
| [2026-09-20-pr37-pr61-rereview](2026-09-20-pr37-pr61-rereview.md) | PR #37 / #61 的合并后续栈复评，只复评当前 head | #37 Blocked（新增 P1）；#61 无新增 P0/P1，可在满足批准门禁后继续合并 |
| [2026-09-21-pr37-mvp-review](2026-09-21-pr37-mvp-review.md) | PR37 最新 head 的最终复评与合并收尾 | P0–P2 无新增阻塞项；已 rebase、归档并 rebase merge |
| [2026-09-23-mvp1-batch-review](2026-09-23-mvp1-batch-review.md) | MVP-1 三交付批次剩余四个 PR（#158 #159 #160 #161）的第二轮 MMP 交付评审：并集预演、P1 独立复现、34 条行级意见 | #159、#158 修复后合并；#160（2 × P1）与 #161（1 × P1）本轮不合并；follow-up #176–#178 |
| [2026-09-24-start-work-batch-review](2026-09-24-start-work-batch-review.md) | Start Work 批次 #160（第三轮）→ #161（第三轮）与 #185（第一轮）：两种顺序的并集预演、P1 的 base / head / 并集对照复现、33 条行级意见 | #185 改 `Refs #183` 后合并；#160（2 × P1）与 #161（叠在其上）本轮不合并；follow-up #192–#194 |
| [2026-09-26-mmp-round5-batch-review](2026-09-26-mmp-round5-batch-review.md) | SQLite v1 栈第五轮（#121–#175）与 Start Work 栈第四轮（#160 → #161）：两栈两种顺序的并集预演、五条 P1 的独立复现、101 条行级意见、L1–L4 的修复与合并 | #121 / #122 / #157 / #167 修复后合并；#170（1 × P1）、#175（2 × P1）、#160（2 × P1 + 体量）不合并，#161 受 #160 阻塞；新开 #201–#204 |

单 PR 的记录（`pr-NN-mvp-review.md` 与 `2026-09-21-pr-NN-risk-matrix.md`）同样放在本目录，但不进上表——判据就是上面那条：**跨多个 PR、且删掉之后接手的人会缺失决策依据**的才登记。

记录按 `PLANS.md` §3 的 ExecPlan 章节写——评审本身也是一次有批次、有验收、有决策的工作。
