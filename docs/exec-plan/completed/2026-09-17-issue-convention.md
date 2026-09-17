# Issue 约定 ExecPlan：模板、标签与 PR 关联

> 状态：Active  
> 创建：2026-09-17  
> 范围：issue 标题/正文/标签的固定格式，以及 PR 与 issue 的强制关联；不改变产品代码  
> 关联 issue：#18

---

## Purpose / Big Picture

让 issue 从"随手写的备忘"变成**可检索、可筛选、可被检查的规范载体**，并把它和 PR 绑起来，使"为什么做这件事"与"哪次改动作了它"始终能互相追溯。

完成后应达到的状态：

1. 新建 issue 只有两个入口（Task / Bug），正文结构由表单固定，自由格式被关闭。
2. 标题格式统一为 `<kind>(<area>): <英文祈使句摘要>`，`area` 取自仓库里真实存在的位置。
3. 标签词汇表固定为 `kind/*`（恰好 1）、`area/*`（至少 1）、`gate/*`（至多 1），与 Projects 字段同源。
4. 存量 issue 全部改写为英文标题 + 固定正文 + 标签。
5. 每个 PR 都 link 它交付的 issue；`Issue policy` 检查（advisory）核对标题、标签与关联。

---

## Context and Orientation

- 现状：7 个种子 issue（#4–#10）是中文、无前缀、无结构、无标签；4 个在审 PR 没有关联任何 issue。
- 已有约束：`AGENTS.md` §8.3 规定 PR 必须关联 ExecPlan 且规模受限；§3.3 规定文档用中文——本计划为 issue 增加一条**英文例外**，因为它是对外可检索的索引面。
- 上游参考：DeepSeek Harness 的 issue 策略要求"≥1 同仓 issue 引用 + 恰好 1 个 `kind/*` + ≥1 个 `area/*` + ≤1 个优先级标签"，并要求最终校验重新读 live state。本计划采用同样的形状，但**不引入优先级标签**（本仓库没有事故语义），且**不引入标签自动分配**（标签仍由作者设置，检查只负责报告不一致）。
- 术语：**area** = 仓库里真实存在的位置（包、`docs/` 子目录、过程域）；**kind** = 与提交类型同一套词汇。

---

## Design / Spec

### D1 标题格式

`<kind>(<area>): <imperative English summary>`

- `kind` ∈ `feat` / `fix` / `docs` / `chore` / `refactor` / `test`。
- `area` ∈ 11 个包 + 8 个文档目录 + `ci` / `repo`，共 21 个取值，每一个都对应仓库里的真实位置。
- 英文、前缀小写、摘要不以句号结尾、≤ 80 字符。
- 例：`feat(storage): add the SQLite schema and migration skeleton`

选这个形状的理由：issue 标题与提交信息、分支名、PR 标题共用同一套 `<type>(<scope>)` 语法，读者不需要学第二套词汇；`area` 与 `packages/`、`docs/` 的目录结构一一对应，删掉或重命名一个目录时能立刻发现词汇表过期。

### D2 标签是权威分类，Projects 字段是它的看板投影

| 命名空间 | 数量 | 与标题的关系 |
|---|---|---|
| `kind:*` | 恰好 1 个 | 必须等于标题前缀 |
| `area:*` | 至少 1 个 | 必须包含标题括号内的区域 |
| `gate:*` | 至多 1 个 | 无（标题不写门禁） |

不引入优先级/严重度标签：本仓库没有事故语义，`gate:*` 已经表达"阻塞下一里程碑"。这条推翻了 `docs/project-management/README.md` 早先"不引入标签体系"的决定——当时的理由是"项目字段已经覆盖同样的信息"，但字段无法出现在 issue 列表、搜索与通知里，而这三处正是标签的价值；两者现在共享同一套取值。

### D3 正文由表单保证，不靠自觉

`.github/ISSUE_TEMPLATE/task.yml`（Context / Scope / Acceptance criteria / References / Notes）与 `bug.yml`（What happens / What should happen / How to reproduce / Evidence / References / Notes）都是 GitHub Issue Forms，`blank_issues_enabled: false`。表单里的说明只是 UI 引导，不会写进 issue 正文，因此正文保持干净。

### D4 检查是 advisory，不是门禁

`scripts/policy-check.mjs` 同时服务本地与 CI：

```bash
node scripts/policy-check.mjs issue <n>   # 标题 + 标签（含两者一致性）
node scripts/policy-check.mjs pr <n>      # 是否 link 同仓 issue，且被 link 的 issue 合规
```

`.github/workflows/issue-policy.yml` 在 issue 与 PR 事件上发布检查 `Issue policy`，**不加入分支保护**。理由：格式问题应当可见，但让合并取决于某个 issue 的措辞会把"规范"变成"阻塞"，而阻塞的收益在这里并不存在。稳定一段时间后再评估提升为必需检查。

### D5 存量数据一次性对齐

7 个种子 issue 重写标题与正文并打标签；4 个在审 PR 补 `Closes #N`；为这 4 个 PR 补建被交付的 issue（#14–#17），使"PR 必须有 issue"从规则变成事实——即使是事后补的，也要让追溯链完整。

---

## Global Constraints

- 不新增优先级/严重度标签；标签词汇表保持三个命名空间。
- 检查逻辑必须有单测（不依赖网络）；CI 里的检查只读，不写 issue 或 PR。
- 不把检查加入分支保护。
- issue 标题与正文用英文；仓库文档、提交信息、PR 描述保持中文。
- 本次改动必须能在不依赖其他在审 PR 的前提下合并（不引用 `docs/project-management/README.md` 等尚未入库的文件）。

---

## Plan of Work

### Batch 1 · 标签词汇表

- [x] 步骤 1：删除 GitHub 默认标签，建立 29 个标签（6 `kind:*` + 21 `area:*` + 2 `gate:*`）。
- [x] 步骤 2：修正三个自动生成的描述（`area:docs`、`area:apps`、`area:tests`）。

**验证**：`gh label list` 数量与命名空间符合预期。  
**回滚**：删除标签即可，不影响任何代码。

### Batch 2 · 检查逻辑与测试

- [x] 步骤 1：写 `scripts/policy-check.mjs`：`checkTitle` / `checkLabels` / `linkedIssues` / `checkPullRequestBody` 为纯函数，CLI 负责取数与退出码。
- [x] 步骤 2：写 `tests/contract/issue-policy.test.js`，覆盖标题（合规、缺前缀、未知 kind/area、中文、句号）、标签（数量、一致性、越界）与 PR 关联（`Closes` / `Refs` / 无关联）。
- [x] 步骤 3：修复测试暴露的第一个缺陷：正则过窄导致"未知 kind"被报成"格式错误"——把正则放宽到任意小写词，再由 `KINDS` 判定。
- [x] 步骤 4：`repository()` 先读 `GITHUB_REPOSITORY`，再解析 `git remote`，最后才回落到 API（避免离线时依赖 GraphQL）。

**验证**：`node --test tests/contract/issue-policy.test.js` → 7/7 通过；对真实数据：`issue 4`/`issue 10` 合规，`pr 3/11/12/13` 合规，故意改坏 #4 的标题后退出码 1。  
**回滚**：删除脚本与测试；无外部状态。

### Batch 3 · 表单与工作流

- [x] 步骤 1：写 `task.yml` / `bug.yml` / `config.yml`；关闭自由格式。
- [x] 步骤 2：写 `.github/workflows/issue-policy.yml`（issue 与 PR 两类事件，一条 `Issue policy` 检查）。
- [x] 步骤 3：本地解析两个 YAML 文件，确认可被解析（上一次 workflow 语法错误不会失败、只是不创建检查，教训见上一个计划）。

**验证**：`python3 -c "import yaml; yaml.safe_load(...)"` 对表单与 workflow 均成功；远端推送后 `gh pr checks` 出现 `Issue policy`。  
**回滚**：删除表单与 workflow；GitHub 立即恢复自由格式。

### Batch 4 · 存量 issue 与 PR 关联

- [x] 步骤 1：重写 #4–#10：英文标题 + 固定正文 + 标签。
- [x] 步骤 2：补建 #14–#17（分别对应 PR #3 / #11 / #12 / #13），并在这些 PR 的描述里加 `Closes #N`。
- [x] 步骤 3：新建 #18 作为本次工作的载体，并由本 PR 关闭。

**验证**：`gh issue list --json number,title,labels` 全部匹配标题正则且各含一个 `kind:*`；`policy-check pr` 对四个 PR 全部通过。  
**回滚**：issue 可再编辑回原状（原中文正文未保留，属一次性动作）。

### Batch 5 · 文档与约定入库

- [x] 步骤 1：`AGENTS.md` 新增 §8.7（标题/标签/正文/PR 绑定/执行），§8.3 增加"每个 PR 必须 link 同仓 issue"，§3.3 增加英文例外，§0 与 §9.1 增加入口。
- [x] 步骤 2：`package.json` 增加 `check:policy`。
- [x] 步骤 3：修正 PR #11 分支上"不引入标签体系"的表述，避免与 §8.7 冲突。
- [x] 步骤 4：本计划归档到 `docs/exec-plan/completed/`。

**验证**：`pnpm verify` 全绿；`grep` 确认仓库内不再有"不引入标签体系"的说法。  
**回滚**：revert 本 PR。

---

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 表单存在且关闭自由格式 | `.github/ISSUE_TEMPLATE/{task,bug,config}.yml` 可解析；`blank_issues_enabled: false` |
| 2 | 检查逻辑可执行 | `node scripts/policy-check.mjs issue 4` 退出码 0；改坏标题后退出码 1 |
| 3 | 检查有单测 | `pnpm test` 覆盖标题、标签、PR 关联三类规则 |
| 4 | 存量 issue 合规 | `gh issue list` 全部匹配 `<kind>(<area>): ...` 且各含一个 `kind:*`、至少一个 `area:*` |
| 5 | PR 关联完整 | 四个在审 PR 均有 `Closes #N`，且 `policy-check pr` 通过 |
| 6 | 检查为 advisory | 分支保护仍只要求 `PR Fast Gate` |
| 7 | 约定可读 | `AGENTS.md` §8.7 含标题格式、标签表、正文结构与执行命令 |
| 8 | 不依赖在审 PR | 本分支 `git diff --name-only main` 不含其他 PR 引入的文件 |

---

## Progress

- [x] (2026-09-17) Batch 1：标签词汇表（29 个标签）。
- [x] (2026-09-17) Batch 2：检查逻辑与 7 个单测。
- [x] (2026-09-17) Batch 3：Issue Forms 与 `Issue policy` workflow。
- [x] (2026-09-17) Batch 4：重写 #4–#10，补建 #14–#17 并关联 PR，新建 #18。
- [x] (2026-09-17) Batch 5：约定写入 `AGENTS.md`，脚本入口与文档校准。

---

## Surprises & Discoveries

- Observation：把"未知 kind"与"格式错误"混为一谈会让报错指向错误的方向；标题正则必须先收下任意小写词，再由词汇表判定，才能给出"`build` 不是合法 kind"这种可操作的提示。
  Evidence：单测 `title must match` vs `unknown kind` 的第一次失败输出。
- Observation：检查脚本不应依赖 API 才能知道"当前仓库是谁"——`gh repo view` 走 GraphQL，会因瞬时故障让本地检查直接崩掉；`GITHUB_REPOSITORY` 与 `git remote` 都能离线回答。
  Evidence：`Post "https://api.github.com/graphql": EOF` 导致 `policy-check issue 4` 失败；改为先解析远端后通过。

- Observation：**改动单选字段的选项列表会让已有条目的该字段值失效**。`updateProjectV2Field` 会重建选项，旧选项 ID 不再被引用，条目上显示为空——没有任何报错，只有回读才能发现。本次在 `Area`（13 → 21 个取值）与 `Kind`（`feature` → `feat`）上各触发一次。
  Evidence：改 Area 后 `gh project item-list` 里 `#4`–`#10` 的 `area` 变成 `null`；改 Kind 后 `#4` 的 `kind` 为空。两次都通过"对全部 12 个条目重新赋值 + 回读"修复。
- Observation：项目 `Kind` 字段原有取值是全称 `feature`，而标签与 issue 标题用 `feat`——"字段与标签同源"如果不实际对齐，就只是一句声明。本次把字段选项改名并对齐到 6 个提交类型。
  Evidence：`opt Kind feat` 返回空字符串，`field-list` 显示选项为 `feature`；改名后 `feat=ba8276f5`。
- Observation：`gh project item-list --format json` 暴露的是 camelCase 键（`kind` / `area` / `gate` / `status`），用它做回读比逐个 `item-edit` 查证更快，也更容易发现 null。

---

## Decision Log

- Decision：issue 标题与正文用英文，仓库文档继续用中文。
  Rationale：issue 是公开、可检索、可能被外部引用的索引面；文档与提交信息服务于本仓库的读者，改语言没有收益。这条写进 `AGENTS.md` §3.3 作为显式例外，而不是让两套习惯各自漂移。
  Date/Author：2026-09-17 / agent（人类伙伴要求 issue 用英文）

- Decision：`area` 词汇表锚定仓库真实位置，而不是业务概念。
  Rationale：词汇表能随目录结构被验证；新增一个包或一个 `docs/` 子目录时，"该不该加 area"有确定答案。
  Date/Author：2026-09-17 / agent

- Decision：标签是权威分类，Projects 字段是投影；推翻早先"不引入标签体系"的决定。
  Rationale：字段不出现在 issue 列表、搜索与通知里；标签出现在这三处，且能被检查。两者共享取值，因此不构成"两份事实"。
  Date/Author：2026-09-17 / agent（人类伙伴要求加标签）

- Decision：`Issue policy` 检查不进分支保护。
  Rationale：格式问题应当可见，但不应让合并取决于某个 issue 的措辞；等到检查稳定、误报为零后再评估提升。
  Date/Author：2026-09-17 / agent

- Decision：为四个在审 PR 事后补建被交付的 issue，而不是让它们以"关联到最接近的种子 issue"充数。
  Rationale：`Closes #10`（Merge Gate）与"搭建评审体系"不是同一件事，错误关联会让看板与追溯链一起失真；补建 issue 让每条规则都有真实对应物。
  Date/Author：2026-09-17 / agent

---

## Idempotence and Recovery

- 标签创建使用 `--force`，可重复执行。
- `policy-check` 只读；它不会修改 issue 或 PR。
- 表单与 workflow 的改动全部可 revert。
- issue 重写是一次性动作：原中文正文没有保留副本，若需要恢复语义，只能从本计划的 Batch 4 描述与本仓库文档重建（内容等价）。

---

## Interfaces and Dependencies

- 工具：`gh`（`issues: read`、`pull-requests: read` 即可运行检查）、`node ≥ 22`、GitHub Issue Forms。
- 契约：分支保护仍只要求 `PR Fast Gate`；`Issue policy` 是独立检查名。
- 词汇表：`scripts/policy-check.mjs` 的 `KINDS` / `AREAS` 是唯一实现，`AGENTS.md` §8.7 是唯一说明；两者不一致时以脚本为准并同步文档。

---

## Outcomes & Retrospective

全部 5 个批次完成，验收 8/8 有证据：

| # | 验收项 | 实际证据 |
|---|---|---|
| 1 | 表单存在且关闭自由格式 | 三个表单文件 YAML 解析通过（`task.yml` 字段 `context/scope/acceptance/references/notes`）；`config.yml` 的 `blank_issues_enabled: false` |
| 2 | 检查逻辑可执行 | `policy-check issue 4` → 退出码 0；把标题临时改成中文 → 退出码 1 并输出 `::error::title must match ...`；恢复后回到 0 |
| 3 | 检查有单测 | `pnpm test` 12 个通过（5 边界 + 7 策略） |
| 4 | 存量 issue 合规 | 全部 12 个 issue 逐个跑 `policy-check issue` 均通过 |
| 5 | PR 关联完整 | `policy-check pr 3/11/12/13` 通过；新 PR #19 由 `Issue policy` 检查验证 `Closes #18` |
| 6 | 检查为 advisory | `gh pr checks 19` 同时出现 `Issue policy` 与 `PR Fast Gate`；分支保护仍只要求 `PR Fast Gate` |
| 7 | 约定可读 | `AGENTS.md` §8.7 含标题格式、21 个 area、标签表、正文结构与执行命令；§3.3 含英文例外 |
| 8 | 不依赖在审 PR | 本分支改动只有 9 个文件，均不在其他 PR 的改动集合里 |

**与计划的偏差**

1. 计划只写"存量 issue 一次性对齐"，实际还包含**看板对齐**：标签词汇表（21 个 area）比项目 `Area` 字段原有的 13 个取值更宽，字段必须扩展，否则"同源"不成立。这一步连带触发了选项 ID 重建，需要重新赋值全部条目。
2. 计划未预料到 `Kind` 字段与标签词汇本身不一致（`feature` vs `feat`），修复它又触发一次选项重建。
3. PR #11 的文档因此被更新两次：一次是"标签与字段同源"的表述（原写的是"不引入标签体系"），一次是字段名、选项取值与选项 ID 表的整体重写。

**遗留问题**

- `Issue policy` 保持 advisory；等它稳定、误报为零后再评估加入分支保护。
- 标签与项目字段仍由作者与维护者手工保持一致；检查覆盖 issue 一侧，项目字段一侧只靠文档约定（本次已把"改选项必须重新赋值并回读"写进 `docs/project-management/README.md`）。
- 若日后新增包或 `docs/` 子目录，需要同时更新三处：`scripts/policy-check.mjs` 的 `AREAS`、`AGENTS.md` §8.7 的列表、项目 `Area` 字段的选项——目前没有自动检查这三者一致，是一个已知的漂移点。

---

## Bottom Change Note

- 2026-09-17：首次创建。原因：issue 需要固定格式、英文标题与标签，并且 PR 必须与 issue 关联；这类"约定 + 检查 + 存量对齐"的改动横跨仓库文件与 GitHub 状态，需要一份可复核的计划。
- 2026-09-17：执行完毕后回填。原因：对齐看板字段时发现单选选项重建会让旧值失效、且 `Kind` 取值与标签不一致，计划的范围因此从"issue 对齐"扩到"issue + 看板字段对齐"，记入偏差与遗留问题后归档。
- (2026-09-18) 因与并行分支的章节号冲突，issue 约定由 §8.6 改为 §8.7，本文引用同步改号。
