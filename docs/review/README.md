# docs/review

评审怎么进行：谁看什么、按什么标准判定、意见落在哪里。分支保护与 PR 规则在 `AGENTS.md` §8，这里只讲**评审本身**。

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
  -f body='[blocking] 这里让 ui 依赖 provider 实现，会破坏能力可替换性（AGENTS.md §2.2）。' \
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
- **改门禁或依赖边矩阵的 PR 单独提交**：`.github/workflows/`、`tests/contract/package-boundaries.test.js` 的改动不与其他改动混在一个 PR 里，便于把它当作一次"规则变更"单独评审。
- 评审者不 approve 自己参与的 PR；批准门禁与检查门禁是两道独立的门。

## 7. 可选增强：DSH 在 PR ready 时自动开只读评审会话

上游平台提供了一个可选 overlay：GitHub 的 `pull_request` → `ready_for_review` 事件会创建一个**只读**评审会话（不修改文件、分支、PR 或 GitHub 状态）。它**默认不启用**，启用前需要知道：

- 需要公网 HTTPS 入口（TLS 反代或 tunnel）才能让 GitHub 投递；适配器自身不提供 TLS。
- 需要凭据 `DSH_GITHUB_WEBHOOK_SECRET`（写入 DSH 凭据引用后按请求解析，轮换立即生效）。
- 规则按仓库匹配，改配置即可指向本仓库，不需要改规则代码。
- 语义偏弱：HTTP 202 只表示"签名与 JSON 被接受、规则调用已入队"，不代表规则匹配或会话已创建；没有队列、重放与去重，进程崩溃会丢掉尚未接纳的调用。
- 它只在 draft → ready 时触发一次；后续推送不会重新触发。

因此它适合"有人值守时多一双眼睛"，不适合当作门禁。启用步骤见上游 `docs/user/guide/github-review.md`；本仓库在启用前需要先决定公网端点方案，并把这台机器的重启影响算进去。
