# 流程知识的归属：四个桶与一条判定规则

> 本文档定义「一段流程知识应该住在哪里」。规则本身在 `AGENTS.md` §3 只用一行引用，详述在这里。
> `AGENTS.md` §0 的路由表是本文档 §4 归属表的**行键**——两者必须集合相等，由
> `tests/contract/content-placement.test.js` 机械核对。改 §0 就要同步改这里。

## 1. 为什么需要这条规则

仓库里每一段流程知识都住在 `docs/`，但它们的**性质**并不相同：有的换一个仓库仍然成立，有的只在这个仓库成立，有的是机械可判定的，有的只是某一次事故的记录。四类混在一处，于是同一个形状的故障出现过三次：

| 事故 | 形状 | 缺的是哪一步 |
|---|---|---|
| issue #110 | 自动化被移除，替代品只写在散文里，`Engineering` 冻结两天 | 本该是**机械**的没变成脚本 |
| issue #112 | 同一条断言写在两处，两套 `Status` 定义同时活着 | 本该是**约定**的被复制 |
| issue #55 | 验收用字面量 grep，同一个断言换组词就绕过 | 本该是**机械**的写成了散文 |

三次的根因是同一个：**知识住在哪里没有规则**，于是它要么被复制、要么没人执行、要么被写成无法执行的散文。

## 2. 四个桶

对任何一段流程知识，**按顺序**问四个问题，第一个命中即归属：

| # | 问题 | 命中 → |
|---|---|---|
| 1 | 它能不能被正则 / 校验**机械判定**？ | **机械** → 脚本（检查器 + 契约测试） |
| 2 | 它是「怎么做」的**技法**，换一个仓库仍然成立？ | **技法** → `.agents/skills/<name>/SKILL.md` |
| 3 | 它只在这个仓库成立（路径、字段 ID、不变量、门禁、词汇表）？ | **约定** → `docs/` 或 `AGENTS.md` |
| 4 | 它记录的是**某一次**发生过的事？ | **一次性** → 写进对应 ExecPlan（完成后进 `completed/`），不单独建 |

顺序是有意的，两条优先级各防一类已经发生过的错误：

- **1 先于 2**：机械可判定的不该写成散文，哪怕是技法。`AGENTS.md` §9 要求「链接检查」，而仓库里从来没有这个命令——它被写成了散文，于是没人执行。
- **2 先于 3**：可复用技法不该因为出现在本仓库就降级成约定。评审技法差点被这条误判。

依据是 Superpowers 技能库的 `writing-skills` 技能给出的三条边界。**规则以下面这段引用为准**，它自足、不依赖该技能在本机的安装位置：

> **Don't create for:** … **Project-specific conventions (put in your instructions file)** … **Mechanical constraints (if it's enforceable with regex/validation, automate it—save documentation for judgment calls)**
>
> Skills **are**: Reusable techniques, patterns, tools, reference guides

**放弃的方案**：按「是否可执行」切。它跨了桶 1 与桶 3——可执行的约定不是技法，`merge-queue.md` 这种纯约定会被误判成 skill 候选。
**放弃的方案**：按「是否高频」切。频率只是「可复用」的代理指标，而且它随观察窗口漂移；一条判据不该依赖观察窗口。

## 3. 两条补充规则

- **同一份文档混了两类内容 → 拆，不整份搬。** 先例：`docs/review/responding.md` 保留仓库特有部分，技法部分只写「使用 Superpowers 的接收评审流程」。整份搬走会让仓库特有的那部分无处可去，整份留下则让技法永远只是散文。
- **同一条断言不得同时存在于两个桶。** 一个桶持有它，另一个桶只能引用。这是 issue #110 与 issue #112 共同买来的教训。

## 4. 归属表

行键是 `AGENTS.md` §0 的任务名，逐字一致。「涉及的全部桶」可以多于一个——那正是 §3 第一条规则要「拆」的信号，处置列写明怎么拆。

| §0 任务 | 涉及内容 | 涉及的全部桶 | 处置 |
|---|---|---|---|
| 设计、实现、验证跨步骤工作 | `PLANS.md`、`docs/exec-plan/` | 约定 | 留。全局 `exec-plan` skill 已指向 `PLANS.md`，两者是「skill 引用仓库契约」的既有形态 |
| 理解架构和依赖 | `docs/architecture/` | 约定 | 留 |
| 日常开发和验证 | `docs/development/workflow.md`、`docs/development/ci.md` | 约定、机械 | 留。其 W1–W7 机械部分已在 `scripts/workflow-check.mjs` |
| 记录长期决策 | `docs/adr/` | 约定 | 留 |
| 提交 PR / 处理评审 | `docs/review/README.md`、`docs/review/responding.md`、`docs/review/mvp-review.md` | 技法、约定 | **拆**。技法部分进 skill（后续批次）；七条不变量、两轴、P0–P3 定级与归档路径留 docs |
| 合并堆叠 PR | `docs/project-management/merge-queue.md` | 约定 | 留。通用栈操作全局已有 `gh-stack` |
| 项目看板语义和 agent 写入 | `docs/product/board-semantics.md`、`docs/project-management/README.md` | 约定 | 留 |
| 发布面与敏感信息 | `docs/development/publication.md` | 约定、机械 | 留。机械部分已在 `scripts/rule-checks.mjs` |
| 隔离工作区 | `.worktrees/<task-slug>/` | 约定 | 留（`AGENTS.md` §6） |

## 5. 尚未补上的机械约束

这张表是观察记录，**不是路由分类**，因此不参与 §4 的机械核对。五项都是桶 1——本该是脚本，现在还是散文：

| 缺口 | 现状 |
|---|---|
| 引用 / 链接检查 | `AGENTS.md` §9 要求，从未实现。`tests/contract/content-placement.test.js` 已覆盖 §0 路由表与本文档归属表这一部分，其余 `docs/` 引用尚未覆盖 |
| `docs/` 里的本机路径 | `AGENTS.md` §3 禁止 `docs/` 引用本机路径，但没有任何检查。`rule-checks disclosure` 的机械扫描按设计不覆盖这一类（`docs/development/publication.md` 把它列为需人工过的五类目之一）。2026-09-22 实测 `docs/` 下已有约 10 处 `~/` 路径，来源是运行器注册、agent preset 与沙箱限制记录 |
| 提交信息形状 | `scripts/rule-checks.mjs` 会读每条提交信息，但只比对发布面模式，没有形状规则。2026-09-22 实测：一条被工具泄漏污染的提交信息（多出 18 行、含下一提交的完整正文）通过了 `Disclosure scan` 与 `Issue policy` |
| 工程轴 `edited` 触发 | PR body 改动会改 `closingIssuesReferences`，但不触发 reconcile |
| 每日 sweep 只报不修 | 「条目后来才被加入看板」这条路径没有事件可触发（Actions 的 `on:` 里没有 project item 事件），sweep 报红但无人修 |

**为什么「易失状态写成值」不在这张表里**：`PLANS.md` §4 已经写了那条规则，但它允许两种合规写法（「回读命令 + 期望」或「观察时刻 + head + 重算命令」），机械判定需要同时排除两种合规形式、识别多种不合规形式，误报面太大。它需要自己的设计批次，不适合塞进一条正则。

## 6. 命名约束

仓库内技能**不得与全局技能同名**。DSH 的技能发现器（`@deepseek-ai/dsh-skill-filesystem` 的 `roots()`）扫描下列 root，**数字小者优先**：

| 来源 | 路径 | rank |
|---|---|---|
| `project-dsh` | `<projectRoot>/.dsh/skills` | 100 |
| `project-agents` | `<projectRoot>/.agents/skills` | 200 |
| `custom` | 配置注入 | 300 |
| `user-dsh` | `$DSH_HOME/skills` | 400 |
| `user-agents` | `<user home>/.agents/skills` | 500 |

`projectRoot` 由 cwd 向上找第一个含 `.git` 的目录决定。项目级 rank 200 高于用户级 rank 500，所以**同名会在项目内静默遮蔽全局技能**——正是本仓库反复在修的那类静默失效。

两个已定的候选名据此避开全局同名：`reviewing-a-delivery-pr`（执行评审）与 `closing-review-feedback`（闭环回复，文首写 `REQUIRED BACKGROUND: receiving-code-review`，定位成全局技能的下半场而不是竞争者）。

## 7. 这条规则不覆盖什么

- **「同一条断言写在两处」无法机械地一般性检查。** 本仓库的形态是**棘轮**：每抓到一次真实重复，就为那条断言加一条针对性断言（先例：PR #113 的 `board-status-semantics.test.js`），而不是造一个通用检查器去猜。
- **桶的归属需要判断，不需要批准。** 判定规则是可求值的，但「这段文字是技法还是约定」仍要人读一遍；本文档的作用是让那次判断有据可依、结论可被复核，而不是取消判断。
- **本文档不定义任何流程本身。** 它只说流程知识住在哪里。
