# #119 验收 1 按字面补齐：不确定创建记录的逐条墙钟与确切命令 ExecPlan

> 状态：Completed（评审修订已补三条标签回归；2026-09-30 人类伙伴授权整理并 rebase merge；2026-09-29 Batch 4 在 PR #244 之内归档，PR 未合并：六个子观测全部为 R，Batch 0–4 完成；G3 于 2026-09-30 答复 (i)，PR 改以关闭关键字关联 #119，见 D5 与 Decision Log）
> 创建：2026-09-29；按 G2 = (b) 修订：2026-09-29；Batch 4 回填与归档：2026-09-29
> 范围：按 #119 验收 1 的字面口径（每条观测带墙钟与产生它的确切命令），补齐 `docs/architecture/gate-e1-uncertain-create.md` 四条实验第 4 字段里能再观测的缺口：两次沙箱写入尝试 `(a-rerun)`、`(c-rerun)`，四次只读回读 `(b-label)`、`(e2-hit)`、`(e4-hit)`、`(d-count)`；不能再观测的缺口只登记。外加一条逐条墙钟守卫与三处派生表述。不改记录 §2 两条轴的语义，不写产品代码。
> 上游输入：issue #119 正文与 2026-09-25 评论、`docs/architecture/gate-e1-uncertain-create.md`、`docs/architecture/gate-e1-sandbox.md`（§2.1 变量、§6 九字段模板与三条填写纪律、§7 发布面）、`docs/architecture/gate-e1-ruling.md` §9、`docs/exec-plan/completed/2026-09-23-e1-uncertain-create.md`、`PLANS.md`
> 关联：载体 issue #119；Refs #4（父门禁）、PR #121（L1 首次交付）。PR 与 issue 的关联规则只在 `Global Constraints` 写一次。
> 本计划同时是 spec 与 plan；正文中文，代码标识符、路径与命令英文。

## Purpose / Big Picture

完成后，一个没有本次对话历史的读者打开记录，能看到：

1. 记录 §1 有一段 2026-09-29 的补观测协议（逐字，首行 `# e1-l1-rerun protocol v2`）。它是一次运行、一个标记、一份运行日志，覆盖实验 2、3、4 的六个子观测。
2. 实验 3 里，(a) 的对账由 `(a-rerun)` 补齐：同一条 gh 客户端路径，标签换成写入前确认不存在的名字。(c) 的拒绝与随后的对账由 `(c-rerun)` 补齐：同一条 REST 命令，预期平台 `422`、零对象。(b) 的标签回读由 `(b-label)` 补齐。(d) 之后的「按标记计数 1」由只读的 `(d-count)` 补齐。每个写入子观测都有完整 UTC 墙钟的发出、返回、两轮对账（第二轮距写入 returned 至少 60 s）与判定，判定写在拆封响应之前。
3. 实验 2、4 的「命中原文」块各有一次只读回读 `(e2-hit)`、`(e4-hit)`，发出前、返回后各一个墙钟，输出与原块逐字节相同。
4. 被补齐的原行原文不动，行尾加 `Superseded by (<标签>)`；不能再观测的四处登记在记录 §3 第 19 条。
5. 新增一条契约守卫：记录里每一行 `时间（墙钟）：` 要么带 UTC 时刻且不含缺口措辞，要么 Superseded 到另一条带完整日期的合规行；任何一处 `Superseded by (<标签>)` 都必须能解析；这种行至少 20 条。它在 base 上恰好点名 `:289`、`:309` 并报告行数不足，在 head 上通过。
6. 裁决 §9 的待决项②、L1 归档计划、`docs/README.md` 里「#119 待人类在补观测与收窄验收之间决定」的表述，都在原处更新。

评审修订后的最小成功证据（2026-09-30，在检出 `docs/e1-uncertain-create-wallclock` 的工作树根目录运行；先提交记录的改动，否则最后一步的 `git checkout HEAD --` 会丢掉未提交的内容）：

```bash
node --test tests/contract/e1-evidence-consistency.test.js tests/contract/plan-facts-consistency.test.js
# 期望：tests 12 / pass 12 / fail 0
git checkout 2f9e0ee8272e1d0369aea9e2647e584e65cbc258 -- docs/architecture/gate-e1-uncertain-create.md \
  && node --test tests/contract/e1-evidence-consistency.test.js; \
  git checkout HEAD -- docs/architecture/gate-e1-uncertain-create.md
# 期望：tests 9 / fail 1；失败信息里的行号恰好是 gate-e1-uncertain-create.md:289 与 :309，另报行数 8 < 20
```

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 3(a) / (b) / (b') / (c) / (d) | 记录实验 3 §3 的五条请求：(a) gh 客户端带未知标签的创建；(b)、(b') 是同一个未知标签走 REST 的第一、二次调用；(c) 是被平台 `422` 拒绝的创建；(d) 是拒绝之后的重试 |
| 子观测 | 本计划在原实验下补的观测，标签只用 ASCII 且带连字符：`(a-rerun)`、`(b-label)`、`(c-rerun)`、`(d-count)`（实验 3）；`(e2-hit)`（实验 2）；`(e4-hit)`（实验 4）。不用 `′`：记录里已有 `(b')` |
| 标记 `E1_L1_RERUN` | 本次运行的 UTC 分钟标记，形如 `20260929T0610Z`；同时是两次写入的幂等键、对账键和运行日志的文件名 |
| `START` | 本次运行的时间窗起点，第 0 步与标记同时取定；两条写入的对账都用 `--created ">=$START"`，与实验 2 §3 同形 |
| 列表路径 / 搜索路径 | `gh issue list` 仓库侧列表 / `gh search issues` 搜索索引。按记录 §2.2，对账证据只认列表路径；搜索路径只作对照 |
| 封存 | 写入命令的 stdout、stderr 和 exit 全部写进本地运行态文件，判定写下之前不读。落实批准原文里的「丢弃响应」，同时不丢原文 |
| 字面口径 | 验收 1 的「every observation」按四条实验各自第 4 字段（观测）逐条计；§1 的漂移登记、§4 里由观测推出的「量」表、§5–§9 不单列（审计表见 D0） |
| 残余 ①–④ | 字面口径下无法再观测、只登记的四处（D0；记录 §3 第 19 条） |
| 结果类 | R 复现、D 漂移、X 形态不同、N 运行被混淆、I 未执行，逐子观测判定，定义见 D1 |

### 当前事实（fact；在检出 `docs/e1-uncertain-create-wallclock` @ `f6a33d2` 的工作树取证，2026-09-29）

| 事实 | 证据 |
|---|---|
| #119 仍 OPEN。验收 1 原文要求 every observation 带 wall-clock time 与 exact command；未勾，2–6 已勾。2026-09-25 的评论只点名 3(a) 的对账与标签回读 | `gh issue view 119 -R SingularityKChen/harness-projects --json state,body,comments` |
| 记录里有 8 行 `时间（墙钟）：`，只有 `:289`、`:309` 没有观测自己的时刻；`:309` 行里带一个平台时刻 `2026-09-23T03:41:55Z`，所以单凭「行里有没有时刻」分不出缺口 | `grep -n '^时间（墙钟）：' docs/architecture/gate-e1-uncertain-create.md` |
| 实验 2 §4 的命中原文块（`:168-176`）与实验 4 §4 的命中原文块（`:443-450`）都没有取得时刻；实验 2 那块只写了搜索路径原文，列表路径原文没有写出（`:176`） | 记录原文 |
| 实验 3 (a) 与 (c) 的对账原文投影不同：(a) 记为 `count: 0`（`:291`，实验 1 的投影），(c) 记为 `0`（`:328`，实验 2 轮询包装的投影）；实验 3 §3 没有 `START` 赋值。「与实验 2 同形」（`:275`）因此还原不出 (a)、(c)、(d) 对账的确切命令；(d) 之后的「按标记计数 1」（`:342`）同理 | 记录 `:275`、`:291`、`:328`、`:342`，实验 2 §3 `:139-153` |
| (c) 记了两次调用（`:315`，`03:42:28Z` / `03:42:40Z`，均 exit 1），§3 只写出带 `--include` 的那一条；哪个墙钟对应哪次调用没有记录。记录 §3 第 14 条（`:570`）却写「3(c) 是一次调用」，与 `:315` 不一致 | 记录 `:315-322`、`:570` |
| 3(c) 被拒的原因是 `assignees[]=e1-user-that-does-not-exist`：错误体 `"field":"assignees","code":"invalid"`。今天该用户名在平台上不存在，也不可指派到沙箱：`gh api users/e1-user-that-does-not-exist` → `404`；`gh api -i repos/<owner>/e1-sandbox/assignees/e1-user-that-does-not-exist` 首行 `HTTP/2.0 404 Not Found`；对照 `$E1_OWNER` 首行 `HTTP/2.0 204 No Content` | 记录 `:255-259`、`:317-322`；本会话只读回读 2026-09-29T11:08:02Z–11:08:30Z、11:15:08Z |
| (d) 那条原标记今天仍只有 `#12`：列表路径按标题过滤得 `[12]`；搜索路径加 `--created ">=2026-09-23T03:40:00Z"` 得 `[12]`；编号集合 `[12,11,10,9,8,7,6,4,3,2,1]` | 本会话只读回读 2026-09-29T11:08:02Z–11:16:03Z |
| 实验 4 的 `draft-a` 实际标题是 `fixture uncertain-create draft 20260923T0340Z`，不是按 §3 `draft-b` 类推的 `… draft-a …`；按 `draft-a` 类推的标题过滤得 0 命中。记录没有写出 `draft-a` 的标题与创建命令；创建前基线 `items.totalCount = 7`（`03:42:51Z`）没有写明出自哪条命令；作废那一轮轮询的命令在 §6 第 1 条里以 `…` 省略，墙钟未记 | 本会话只读回读 Project A 全部条目的 `type,createdAt,title`；协议 v2 第 4 步的只读预演（2026-09-29T11:30:27Z–11:30:31Z）用实际标题得到 1 条命中，`createdAt = 2026-09-23T03:42:53Z`；记录 `:434`、`:482` |
| 协议 v2 的只读部分（第 0–5 步）可以跑通：在 zsh 下执行，日志目录改到会话 scratch、不进仓库。输出：`login=SingularityKChen visibility=PRIVATE`、gh 2.101.0；`assignee_check=HTTP/2.0 404 Not Found`；`baseline-a` 与 `baseline-c` 都是 `list=[] search=[]`、`new_label_hits=0`；`(b-label)` 一行，值与记录相同；`(e2-hit)` 两行与实验 2 原块去掉折行后逐字节相同，`(e4-hit)` 第一行与实验 4 原块逐字节相同（V8 输出 `179 291`、`2`、`1`、`1`、`1`）；`(d-count)` 为 `list=[12] search=[12]`。两道写入闸门的条件另用伪造日志逐项测过：未发过且前置成立时第 6 步放行；已发过、`exit=0`、没有 `exit=` 行、`a-verdict=present`、assignee 可指派时第 10 步都关闭 | 本会话 2026-09-29T11:30:01Z–11:30:31Z 执行；没有执行第 6–13 步；协议块经 `bash -n` 与 `zsh -n` 语法检查通过 |
| 3(a) 原命令用的标签 `e1-label-that-does-not-exist` 已由 (b) 自动创建，至今仍在（`createdAt = 2026-09-23T03:41:55Z`）；仓库共 11 个标签，只有它以 `e1-` 开头，少于 `gh label list` 默认的 30 条 | 本会话只读回读 2026-09-29T11:16:03Z；另见记录 `:305-311` |
| 照抄 3(a) 原命令，今天会真的建出 issue，不再是客户端拒绝（推导）：gh 在发出创建之前按名字解析标签，本机 gh 2.101.0 的二进制里有记录 `:284` 那条错误文案 | `strings "$(command -v gh)" \| grep -c 'could not add label'` → `1`（前一位定稿者取证） |
| `gh api -i` 会打印全部响应头，其中有 `X-Oauth-Scopes`（令牌作用域）与 `X-Github-Request-Id` | 本会话 `gh api -i rate_limit \| grep -ic -e '^x-oauth-scopes' -e '^x-github-request-id'` → `2` |
| 当前活动账号是 `SingularityKChen`，gh 2.101.0；另有一个未激活的评审账号 | `gh api user --jq .login`；`gh --version` |
| 证据守卫对实验节按逐文档声明判定；定位标题用的正则 `^(#{1,})\s*实验\s*(\d+)` 逐行匹配，不认代码围栏。承载 E1 证据的计划按内容发现：带沙箱登记过的 id 字面量，或行首 `NAME=value` 且名字是沙箱里绑定 id 的变量名、或值是登记过的 id | `tests/contract/e1-evidence-consistency.test.js:110`、`:122`、`:215-235`、`:284-293` |
| plan-facts 守卫只覆盖文件名匹配 `2026-09-2[34]-*` 的计划（L1 归档计划在内）：禁止关闭关键字紧跟 `#N`，`docs/` 路径须能解析 | `tests/contract/plan-facts-consistency.test.js:40-48`、`:78-131` |
| 基线：两份契约测试 tests 8 / pass 8 / fail 0（观察时刻快照 @ `f6a33d2`） | `node --test tests/contract/e1-evidence-consistency.test.js tests/contract/plan-facts-consistency.test.js` |
| 已归档的计划可以在原处追加 Superseded（先例 87ed26c）；计划可以在 PR 之内归档（先例 33165ce） | `git show 87ed26c -- docs/exec-plan/completed/2026-09-21-gate-e1-ruling.md \| grep '^+' \| grep -c Superseded` → `5`；`git show --stat 33165ce` |

### 硬约束、假设与未知

- **硬约束**：`AGENTS.md` §1.1 的七条不变量；人类伙伴 2026-09-29 批准的外部写入（原文见 `Decision Log`），只限两次写入尝试、合计 ≤ 1 个私有 issue；代码改动 ≤800 行、文档改动 ≤1300 行；不写看板 `Status`；LLM 不进入规划状态与门禁的判定；MMP 前不写兼容层。
- **假设**：A1，gh 2.101.0 仍然先解析标签、后发出创建；A2，从本会话回读到执行之间沙箱没有变化；A3，平台的 `createdAt` 与 node id 不变，今天回读到同一个值即同一个对象；A4，执行窗口里没有别的写入者；A5，`e1-user-that-does-not-exist` 在执行时仍不可指派；A6，Project A 的条目数 ≤ 20（实验 4 §3 的查询只取 `first: 20`）。A2、A4、A5 由第 1 步机械核验，A1 由封存原文核验，A6 由 `(e4-hit)` 的 `totalCount` 核验。
- **未知**：U1，今天平台与 gh 的实际行为；U2，残余 ①–④ 登记后是否视为满足验收 1（G3）。
- **主要不确定性**：U1。它决定两次不可逆写入的结果类，所以写入步骤由运行日志上的机械闸门把守（D1）。U2 只决定 PR 是否关闭 #119，不阻塞任何写入。

### 相关文件（角色；改动范围只在 `Global Constraints` 声明）

| 文件 | 角色 |
|---|---|
| `docs/architecture/gate-e1-uncertain-create.md` | 被补观测的记录，观测事实的唯一权威（落点见 D2） |
| `docs/architecture/gate-e1-sandbox.md` | 沙箱变量值（§2.1）、夹具所有权（§2.3）、九字段模板与三条填写纪律（§6）、发布面规则（§7） |
| `tests/contract/e1-evidence-consistency.test.js` | E1 证据的机械强制点（守卫见 D3） |
| `docs/architecture/gate-e1-ruling.md` | 门禁裁决；§9 挂着 #119 验收 1 的待决项② |
| `docs/exec-plan/completed/2026-09-23-e1-uncertain-create.md` | L1 的归档计划，写着「待人类决定」的当前态表述 |
| `docs/README.md` | ExecPlan 索引 |

## Design / Spec

### 取舍来源

骨架取自设计 3（对抗与可复现性）：预注册协议、等价性分析、盲对账、结果类矩阵，只有 R 才进入关闭路径。嫁接设计 1 的写入前闸门与缺口审计、设计 2 的派生落点矩阵与「索引改指针、历史快照不改」。G2 选 (b) 之后，本计划改为按字面口径逐条审计（D0），把能再观测的缺口全部排进同一次运行，把不能再观测的登记为残余并交人类裁决（G3）。被拒绝的方案在本节末尾。

### D0 字面口径的缺口审计（Batch 4 按行号与运行日志回填最后一列）

| 位置（记录） | 观测 | 墙钟 | 确切命令 | 处置 | Batch 4 核对 |
|---|---|---|---|---|---|
| 实验 1 §4 表 | 两次创建与三次计数 | 行内 | §3 | 原有，合规 | 合规：`:197-205` 每行带墙钟，命令 `:177-193` |
| 实验 2 §4 `:158`、`:162-166` | 创建返回码、三轮轮询 | 行内 | §3 创建命令与轮询包装 | 原有，合规 | 合规：`:276`、`:280-284`，命令 `:254-272` |
| 实验 2 §4 `:168-176` | 两条路径的命中原文 | 缺 | 搜索路径 §3；列表路径原文没有写出 | `(e2-hit)` | 已补：`:286` Superseded；墙钟 `:298`（日志第 9、12 行）；输出 `:301-302` 与日志第 10–11 行逐字相同，V8 = `2`；命令 §1 第 3 步 |
| 实验 3 §4 `:281` | (a) 客户端拒绝 | 有 | §3 (a) | 原有，合规 | 合规：`:410`，命令 `:365-369` |
| 实验 3 §4 `:287-291` | (a) 之后的对账 | 缺（`:289`） | 「同形」 | `(a-rerun)` | 已补：`:418` 与 `:404` Superseded；墙钟 `:424`、`:432`、`:439`、`:446`（日志第 1–2、4、18–24 行）；命令 §1 第 1、6–9 步 |
| 实验 3 §4 `:293-305` | (b)、(b') 的 `201` 与返回体 | 有 | §3 (b)、(b') | 原有，合规 | 合规：`:456-468` |
| 实验 3 §4 `:307-311` | 标签回读 | 缺（`:309`） | §3 标签回读 | `(b-label)` | 已补：`:472` Superseded；墙钟 `:478`（日志第 6–8 行）；命令 §1 第 2 步 |
| 实验 3 §4 `:313-322` | (c) 两次调用被拒 | 有 | 只写出带 `--include` 的一条 | `(c-rerun)`；不带 `--include` 的那一次 → 残余 ① | 已补：`:486` Superseded；墙钟 `:503`、`:510`、`:524`（日志第 3、5、25–26、29–30、60–61 行）；残余 ① 登记于 `:801` |
| 实验 3 §4 `:324-328` | (c) 之后的对账 | 有 | 「同形」 | `(c-rerun)` | 已补：`:497` 与 `:404` Superseded；墙钟 `:517`（日志第 27–28 行）；命令 §1 第 11–12 步 |
| 实验 3 §4 `:330-338` | (d) 重试的 `201` | 有 | §3 (d) | 原有，合规 | 合规：`:535-543` |
| 实验 3 §4 `:340-344` | (d) 之后按标记计数 1 | 有 | 「同形」 | `(d-count)` | 已补：`:547` 与 `:404` Superseded；墙钟 `:553`（日志第 17 行）；命令 §1 第 5 步 |
| 实验 4 §4 `:434` | 创建前基线 `totalCount = 7` | 有 | 未写明出自哪条命令 | 残余 ② | 登记：`:649` Superseded 指向 `:801` |
| 实验 4 §4 `:434` | `draft-a` 的创建 | 有 | §3 只写了 `draft-b` 的标题 | 残余 ③ | 登记：`:801`；实际标题见 `:667`、`:673` |
| 实验 4 §4 `:434` | `draft-a` 作废的一轮轮询；`03:43:16Z` 的存在确认与平台 `createdAt` | 作废那一轮缺 | 作废命令以 `…` 省略；存在确认的命令未写 | 存在确认与 `createdAt` → `(e4-hit)`；作废轮询 → 残余 ④ | 已补存在确认：墙钟 `:669`、输出 `:673`（日志第 13、15–16 行，两个 id 各命中 1 次）；残余 ④ 登记于 `:801` |
| 实验 4 §4 `:436-441` | `draft-b` 创建与两轮轮询 | 有 | §3 | 原有，合规 | 合规：`:651-656` |
| 实验 4 §4 `:443-450` | 命中原文 | 缺 | §3 | `(e4-hit)` | 已补：`:658` Superseded；墙钟 `:669`；输出 `:672` 与日志第 14 行逐字相同，V8 = `1`；命令 §1 第 4 步 |
| 实验 4 §4 `:463-467` | 字段值复核 | 有 | §3 末段 | 原有，合规 | 合规：`:689-695`（`2026-09-23T04:16:27Z`），命令 `:644` |

Batch 4 核对列的行号指最终记录（`git grep -n` 可复核），「日志」指运行日志 `.superpowers/e1-l1-rerun/20260929T1137Z.log`（被 git 忽略，只在 PR 工作树里）。复核命令：`grep -n '^时间（墙钟）：' docs/architecture/gate-e1-uncertain-create.md`（期望 20 行，12 行带 `2026-09-29T`）、`grep -n 'Superseded by (' docs/architecture/gate-e1-uncertain-create.md`（期望 12 行），以及 `Validation and Acceptance` 第 6、7 项与 V8。

残余 ①–④ 无法再观测：① 要再发一次不带 `--include` 的 3(c)，③④ 要新建 draft，都超出批准的写入；② 是创建前的状态，今天回读不到；按沙箱定义 §6 的「不补全」也不能事后补写成确切命令。它们登记在记录 §3 第 19 条，是否视为满足验收 1 由 G3 决定。

### D1 补观测协议（预注册；Batch 0 推送之后、任何写入之前生效）

**为什么不能照抄 3(a) 原命令**：3(a) 的前提是「标签在仓库里不存在」。(b) 已经把原标签建成了真实对象，照抄会成功建出 issue，观测到的是另一个分支。所以等价性守住的是「标签不存在」这一性质，而不是标签名。3(c) 的前提「assignee 不可指派」今天仍成立（当前事实表），命令形状可以原样保留。

| 因素 | 原 3(a) → `(a-rerun)` | 原 3(c) → `(c-rerun)` | 判定 |
|---|---|---|---|
| actor | `SingularityKChen` → 第 1 步要求 `login` 等于 `$E1_OWNER` | 同左 | 不变量；不符则零写入 |
| 仓库 | 私有 → 第 1 步要求 `visibility=PRIVATE` | 同左 | 不变量 |
| 路径 | `gh issue create --label` → 同一条命令形状 | REST `POST /repos/…/issues` 带 `--include` → 同一条命令形状 | 不变量；原 (c) 不带 `--include` 的那一次不复测（残余 ①） |
| 失败前提 | 标签不存在 → `e1-label-absent-$E1_L1_RERUN`，第 1 步 `new_label_hits=0` | assignee 不可指派 → 同一个名字，第 1 步 `assignee_check` 为 `404` | 保的是性质 |
| 标题 | `…failed 20260923T0340Z`（已被 `#10/#11` 占用）→ `…failed $E1_L1_RERUN` | `…rejected 20260923T0340Z`（已被 `#12` 占用）→ `…rejected $E1_L1_RERUN` | 形状相同，值唯一 |
| 正文 | 与原命令逐字相同 | 与原命令逐字相同 | 不变量 |
| 响应 | 直接读 → 封存，判定之后再读 | 同左 | 更严：只是晚读，不丢 |
| 对账 | 「同形」、未记墙钟 → 协议写全（`START`、两条路径的投影、编号集合），t1 立即、t2 至少 60 s 后，每轮行首带墙钟 | 「同形」、一次墙钟 → 同左 | 更强 |
| gh 版本 | 未记录 → 第 1 步记录 | 同左 | 本次补上 |

**写入预算与互斥**（人类伙伴批准的范围，由第 6、10 步的闸门机械执行）：

- 整个计划只有两次写入尝试：第 6 步 `(a-rerun)` 与第 10 步 `(c-rerun)`，各只发一次。两次合计建出的对象不超过 1 个私有 issue。
- **互斥**：一旦 `(a-rerun)` 已建出对象，或者无法证明它没有建出对象，`(c-rerun)` 不得执行。第 10 步的闸门只在同时满足下列条件时放行：日志里没有 `c-rerun sent=`；第 1 步 `assignee_check` 为 `HTTP/2.0 404 Not Found`；`baseline-c` 为 `list=[] search=[]`；第 9 步写下 `a-verdict=absent`；封存文件里有 `exit=` 行且值非 0。`(a-rerun)` 为 D、N，发出后没有返回，或根本没有发出时，闸门都关闭。
- 预期两次都建出 0 个对象。`(a-rerun)` 为 R 或 X 时，唯一可能新增的对象来自 `(c-rerun)` 被平台接受（D），至多 1 条。任何新建的标签都超出批准范围：只报告，不清理。

**协议块**（Batch 2 把它**逐字**复制进记录 §1，Batch 4 用 diff 核对两处一致；首行是标记行，不要改）：

```bash
# e1-l1-rerun protocol v2
# 在检出 docs/e1-uncertain-create-wallclock 的工作树根目录运行；$E1_OWNER / $E1_REPO / $E1_PROJECT_A_ID 的值见沙箱定义 §2.1
# 第 0 步只执行一次：定标记与时间窗起点（标记写进记录 §1 的变量块，START 由第 1 步写进日志）
E1_L1_RERUN=$(date -u +%Y%m%dT%H%MZ)
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 公共前缀：此后每一次单独调用都先写回第 0 步的两个值，再执行这一段；任一变量为空时本次调用立即失败
: "${E1_L1_RERUN:?}" "${START:?}" "${E1_OWNER:?}" "${E1_REPO:?}" "${E1_PROJECT_A_ID:?}"
A_TITLE="fixture uncertain-create failed $E1_L1_RERUN"; A_LABEL="e1-label-absent-$E1_L1_RERUN"
C_TITLE="fixture uncertain-create rejected $E1_L1_RERUN"
RUNDIR=".superpowers/e1-l1-rerun"; RUNLOG="$RUNDIR/$E1_L1_RERUN.log"
A_SEALED="$RUNDIR/$E1_L1_RERUN.a.sealed"; C_SEALED="$RUNDIR/$E1_L1_RERUN.c.sealed"
utc_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
e1_probe() {   # $1 轮次、$2 标题、$3 时间窗起点；一轮一行，行首墙钟在本轮全部查询之前取
  printf '%s phase=%s window=%s list=%s search=%s numbers=%s new_label_hits=%s\n' "$(utc_now)" "$1" "$3" \
    "$(gh issue list --repo "$E1_OWNER/$E1_REPO" --state all --limit 100 --json number,title \
       | jq -c --arg t "$2" '[.[]|select(.title==$t)|.number]|sort')" \
    "$(gh search issues --repo "$E1_OWNER/$E1_REPO" --author "$E1_OWNER" --created ">=$3" "\"$2\" in:title" \
       --json number | jq -c '[.[].number]|sort')" \
    "$(gh issue list --repo "$E1_OWNER/$E1_REPO" --state all --limit 100 --json number \
       | jq -c '[.[].number]|sort|reverse')" \
    "$(gh label list --repo "$E1_OWNER/$E1_REPO" --limit 100 --json name \
       | jq --arg l "$A_LABEL" '[.[]|select(.name==$l)]|length')"
}

# 第 1 步（只读前置）：账号、可见性、时间窗起点、gh 版本、平台时钟锚点、(c-rerun) 的 assignee 前提、两条新标题的基线
mkdir -p "$RUNDIR"
{ printf '%s login=%s visibility=%s start=%s %s\n' "$(utc_now)" "$(gh api user --jq .login)" \
    "$(gh repo view "$E1_OWNER/$E1_REPO" --json visibility --jq .visibility)" "$START" "$(gh --version | head -1)"
  gh api -i rate_limit | grep -i '^date:'
  printf '%s assignee_check=%s\n' "$(utc_now)" \
    "$(gh api -i "repos/$E1_OWNER/$E1_REPO/assignees/e1-user-that-does-not-exist" 2>/dev/null | head -1)"
  e1_probe baseline-a "$A_TITLE" "$START"
  e1_probe baseline-c "$C_TITLE" "$START"; } 2>&1 | tee -a "$RUNLOG"

# 第 2 步（只读，(b-label)）：实验 3 §3 的标签回读命令逐字执行，末尾只追加 jq -c
{ printf 'b-label sent=%s\n' "$(utc_now)"
  gh label list --repo "$E1_OWNER/$E1_REPO" --json name,createdAt \
    | jq '.[]|select(.name=="e1-label-that-does-not-exist")' | jq -c .
  printf 'b-label returned=%s\n' "$(utc_now)"; } 2>&1 | tee -a "$RUNLOG"

# 第 3 步（只读，(e2-hit)）：实验 2 §3 的两条对账命令逐字执行（变量取实验 2 的值），末尾追加与原命中原文块同字段的投影
( E1_L1_RUN=20260923T0340Z; TITLE="fixture uncertain-create reconcile $E1_L1_RUN"
  START=2026-09-23T03:41:14Z   # 实验 2 §4 记录的时间窗起点
  SHAPE='[.[]|{author:{login:.author.login},createdAt,id,number,title}]'
  printf 'e2-hit sent=%s\n' "$(utc_now)"
  gh search issues --repo "$E1_OWNER/$E1_REPO" --author "$E1_OWNER" --created ">=$START" \
    "\"$TITLE\" in:title" --json number,title,author,createdAt,id | jq -c "$SHAPE"
  gh issue list --repo "$E1_OWNER/$E1_REPO" --state all --limit 100 \
    --json number,title,author,createdAt,id | jq --arg t "$TITLE" '[.[]|select(.title==$t)]' | jq -c "$SHAPE"
  printf 'e2-hit returned=%s\n' "$(utc_now)" ) 2>&1 | tee -a "$RUNLOG"

# 第 4 步（只读，(e4-hit)）：实验 4 §3 的对账命令逐字执行，末尾只追加 jq -c；标题依次取 draft-b 与 draft-a 的实际标题
( E1_L1_RUN=20260923T0340Z
  printf 'e4-hit sent=%s\n' "$(utc_now)"
  for TITLE in "fixture uncertain-create draft-b $E1_L1_RUN" "fixture uncertain-create draft $E1_L1_RUN"; do
gh api graphql -f query='
query($p: ID!) { node(id: $p) { ... on ProjectV2 {
  items(first: 20) { totalCount nodes {
    id type createdAt creator { login }
    content { __typename ... on DraftIssue { id title } } } } } } }' -f p="$E1_PROJECT_A_ID" \
  | jq --arg t "$TITLE" '{totalCount: .data.node.items.totalCount,
      matches: [.data.node.items.nodes[]|select(.content.title==$t)]}' | jq -c .
  done
  printf 'e4-hit returned=%s\n' "$(utc_now)" ) 2>&1 | tee -a "$RUNLOG"

# 第 5 步（只读，(d-count)）：原 (c)/(d) 标记的对账；时间窗起点取该标记所在分钟的起点
e1_probe d-count "fixture uncertain-create rejected 20260923T0340Z" 2026-09-23T03:40:00Z 2>&1 | tee -a "$RUNLOG"

# 第 6 步（写入尝试 1/2，(a-rerun)）：闸门通过才发出，只发一次；stdout、stderr 与 exit 全部封存，第 9 步之前不读
if ! grep -q '^a-rerun sent=' "$RUNLOG" && grep -q " login=$E1_OWNER visibility=PRIVATE " "$RUNLOG" \
   && grep -Eq ' phase=baseline-a window=[^ ]+ list=\[\] search=\[\] numbers=[^ ]+ new_label_hits=0$' "$RUNLOG"; then
  { printf 'a-rerun sent=%s\n' "$(utc_now)"
    gh issue create --repo "$E1_OWNER/$E1_REPO" --title "$A_TITLE" --label "$A_LABEL" \
      --body "Gate E1 fixture. Uncertain-create failure probe (#119)." > "$A_SEALED" 2>&1
    echo "exit=$?" >> "$A_SEALED"
    printf 'a-rerun returned=%s\n' "$(utc_now)"; } | tee -a "$RUNLOG"
else printf '%s a-rerun gate-closed\n' "$(utc_now)" | tee -a "$RUNLOG"; fi

# 第 7 步（对账 a-t1）：紧接第 6 步
e1_probe a-t1 "$A_TITLE" "$START" 2>&1 | tee -a "$RUNLOG"

# 第 8 步（对账 a-t2）：距 a-rerun returned 至少 60 s；单独一次调用，不依赖前台 sleep
e1_probe a-t2 "$A_TITLE" "$START" 2>&1 | tee -a "$RUNLOG"

# 第 9 步：先按判定规则写下 A_VERDICT（absent / present / confounded），再拆封
printf '%s a-verdict=%s\n' "$(utc_now)" "${A_VERDICT:?}" | tee -a "$RUNLOG"
cat "$A_SEALED" | tee -a "$RUNLOG"

# 第 10 步（写入尝试 2/2，(c-rerun)）：闸门见 D1「写入预算与互斥」；不放行时只记 gate-closed
if ! grep -q '^c-rerun sent=' "$RUNLOG" \
   && grep -q ' assignee_check=HTTP/2.0 404 Not Found$' "$RUNLOG" \
   && grep -Eq ' phase=baseline-c window=[^ ]+ list=\[\] search=\[\] ' "$RUNLOG" \
   && grep -q ' a-verdict=absent$' "$RUNLOG" && grep -Eq '^exit=[1-9][0-9]*$' "$A_SEALED"; then
  { printf 'c-rerun sent=%s\n' "$(utc_now)"
    gh api --method POST "/repos/$E1_OWNER/$E1_REPO/issues" \
      -f title="$C_TITLE" \
      -f body="Gate E1 fixture. Uncertain-create rejected probe (#119)." \
      -f 'assignees[]=e1-user-that-does-not-exist' --include > "$C_SEALED" 2>&1
    echo "exit=$?" >> "$C_SEALED"
    printf 'c-rerun returned=%s\n' "$(utc_now)"; } | tee -a "$RUNLOG"
else printf '%s c-rerun gate-closed\n' "$(utc_now)" | tee -a "$RUNLOG"; fi

# 第 11 步（对账 c-t1）：紧接第 10 步
e1_probe c-t1 "$C_TITLE" "$START" 2>&1 | tee -a "$RUNLOG"

# 第 12 步（对账 c-t2）：距 c-rerun returned 至少 60 s；单独一次调用
e1_probe c-t2 "$C_TITLE" "$START" 2>&1 | tee -a "$RUNLOG"

# 第 13 步：先按判定规则写下 C_VERDICT，再拆封
printf '%s c-verdict=%s\n' "$(utc_now)" "${C_VERDICT:?}" | tee -a "$RUNLOG"
cat "$C_SEALED" | tee -a "$RUNLOG"
```

**执行纪律**：

- 同一时刻只有一个 owner 执行协议（Task B）。执行环境每次调用都会重置 shell 状态，所以第 1–13 步每次调用都先写 `E1_L1_RERUN=<第 0 步的值>` 与 `START=<第 0 步的值>`，再执行公共前缀；`E1_OWNER`、`E1_REPO`、`E1_PROJECT_A_ID` 按沙箱定义 §2.1 导出。第 9、13 步另写 `A_VERDICT` / `C_VERDICT`。
- 第 1–5 步只读，可以原样重跑（运行日志保留每一次，记录引用最后一次并注明前一次的原文）。第 6、10 步各只发一次：闸门按日志里的 `a-rerun sent=` / `c-rerun sent=` 拒绝第二次发出；任何失败、超时或中断都不重试。
- 第 1 步的期望：`login` 等于 `$E1_OWNER`；`visibility=PRIVATE`；`assignee_check=HTTP/2.0 404 Not Found`；`baseline-a` 与 `baseline-c` 都是 `list=[] search=[]`、`new_label_hits=0`；`numbers` 长度小于 100。前两项或最后一项不符时，第 2–13 步全部不执行（全部为 I）；`assignee_check` 或 `baseline-c` 不符时只有 `(c-rerun)` 为 I；`baseline-a` 不符时 `(a-rerun)` 与 `(c-rerun)` 都为 I。第 6、10 步的闸门把后两种情形机械化。
- 记录只摘运行日志里的行，不改写。`(c-rerun)` 的封存文件带全部响应头（含 `X-Oauth-Scopes`），记录只摘状态行与错误体两行，响应头留在运行态文件。

**判定规则**（`X` 取 `a` 或 `c`；第 9、13 步拆封前写下）：

- `absent`：`X-t1` 与 `X-t2` 都是 `list=[]`；`X-t2` 是 `search=[]`；`X-t2` 的 `numbers` 与 `baseline-X` 逐项相同；两轮 `new_label_hits=0`；`X-t2` 行首墙钟减去 `X-rerun returned` 不少于 60 s（不足就再补一轮只读的 `X-t2`）。
- `present`：`X-t1` 或 `X-t2` 的 `list` 非空，或 `new_label_hits ≥ 1`。
- `confounded`：其余情况，例如 `numbers` 里出现了与本标记无关的新编号，或 `X-t2` 的 `search` 非空而 `list` 为空。

**结果类与处置**（逐子观测判定；只有六个子观测**全部**为 R 才进入 Batch 3 与关闭路径）：

| 子观测 | R 复现 | D 漂移 | X 形态不同 | N 运行被混淆 | I 未执行 |
|---|---|---|---|---|---|
| `(a-rerun)` | `absent`，且封存原文含 `could not add label: 'e1-label-absent-<标记>' not found` 与 `exit=1` | `present`，或 `exit=0` | `absent`，但封存原文不是那条客户端错误 | `confounded`，或 `absent` 同时 `exit=0` | 第 1 步不符，或闸门关闭 |
| `(c-rerun)` | `absent`，且封存原文含 `HTTP/2.0 422 Unprocessable Entity`、错误体含 `"field":"assignees"` 与 `"code":"invalid"`、`exit=1` | `present`，或状态 `201` / `exit=0` | `absent`，但状态或错误体不同 | 同上 | 第 1 步不符，或闸门关闭（含 `(a-rerun)` 非 R/X） |
| `(b-label)` | 恰好一行 `{"createdAt":"2026-09-23T03:41:55Z","name":"e1-label-that-does-not-exist"}` | 为空或值不同 | 命令报错 | — | 第 1 步不符 |
| `(e2-hit)` | 两行都与实验 2 原命中原文块去掉折行后逐字节相同 | 任一行不同 | 命令报错 | — | 同上 |
| `(e4-hit)` | 第一行与实验 4 原命中原文块去掉折行后逐字节相同；第二行 `matches` 恰好 1 条，`createdAt` 为 `2026-09-23T03:42:53Z`，条目 id 与内容 id 与记录 §1 夹具表 `draft-a` 行相同 | 第一行不同（含 `totalCount` 不是 9：照录，并登记为 Project A 的漂移），或第二行不符 | 命令报错 | — | 同上 |
| `(d-count)` | `list=[12] search=[12]`，`numbers` 与 `baseline-a` 相同，`new_label_hits=0` | 其余 | 命令报错 | — | 同上 |

处置：

- **R**：按 D2 落记录，该处的原行加 Superseded。
- **D**：停。不删除任何对象（它就是证据）。写入子观测建出的新对象按 #119 归属登记进记录 §1 的夹具表与沙箱定义 §2.3（id 字面量守卫 (i) 会强制这一步）；新标签超出批准范围，只报告。只读子观测的差异照录在该子观测下，原结论不改。该处原行**不加** Superseded。PR 保持 Refs，交人类裁决。
- **X**：照录原文，原行不加 Superseded，上报。只读子观测可以按执行纪律重跑一次。
- **N**：判为无效运行，照录原文；不重跑，再跑需要人类重新批准并换新标记。
- **I**：零写入；照录 `gate-closed` 行或第 1 步的不符项。

### D2 记录的落点（Task B；各项只在对应子观测为 R 时写）

`docs/architecture/gate-e1-uncertain-create.md`：

1. §1：介绍段加一句「`E1_L1_RERUN` 是 2026-09-29 补观测的标记（#119 验收 1），本记录同样是它的唯一赋值处；补观测协议里的 `START` 是这次运行的时间窗起点，取值见 (a-rerun) 前置行里的 `start=`」；变量块加一行 `E1_L1_RERUN=<第 0 步的实际值>`；`:25` 句末补「2026-09-23 的墙钟写成短式 `HH:MM:SSZ`，日期都是 2026-09-23；2026-09-29 的补观测一律写完整的 `YYYY-MM-DDTHH:MM:SSZ`」。在 `:43`（「本批次的写入共产生…」）之后加加粗段落「2026-09-29 补观测协议（#119 验收 1）」：三句话分别写明为什么换标签名、为什么一次运行覆盖实验 2–4、`(c-rerun)` 的闸门与写入预算；然后逐字放入 D1 的协议块。
2. 实验 2 §4：`:168` 行尾追加「**Superseded by (e2-hit)（2026-09-29）**：本块没有记取得时刻，列表路径原文也没有写出；两条路径的回读见下方 (e2-hit)。本块原文保留。」；`:176` 之后加加粗段落「(e2-hit) 2026-09-29 只读回读」：一行「时间（墙钟）：发出 `<完整时刻>` / 返回 `<完整时刻>`（(e2-hit)，§1 协议第 3 步）。」，下附两行输出原文。
3. 实验 3 §3：`:275` 行尾追加「**Superseded by (a-rerun) / (c-rerun) / (d-count)（2026-09-29）**：「同形」没有写出 `START` 与投影，(a)、(c) 的原文投影也不同，不能事后还原；三处对账的确切命令见 §1 协议，观测见 §4 各子观测。本段原文保留。」
4. 实验 3 §4 按顺序：
   - `:289` 行尾追加「**Superseded by (a-rerun)（2026-09-29）**：逐条墙钟与确切命令见下方 (a-rerun)；本行原文保留，它仍是 2026-09-23 那次运行的如实记录。」；`:291` 之后加「(a-rerun) 2026-09-29 补观测：gh 客户端路径 + 仓库里不存在的标签」，四行 `时间（墙钟）：`（前置：`login` 行、`date:` 头、`baseline-a`；创建：`a-rerun sent` / `returned`；对账：`a-t1` / `a-t2`；判定与拆封：`a-verdict` 行与封存原文），每行都含 `(a-rerun)` 与第几步。
   - `:309` 行尾追加「**Superseded by (b-label)（2026-09-29）**：回读时刻见下方 (b-label)；本行原文保留。」；`:311` 之后加「(b-label) 2026-09-29 只读回读 (b) 自动创建的标签」，一行墙钟（发出 / 返回）加一行输出。
   - `:315` 行尾追加「**Superseded by (c-rerun)（2026-09-29）**：平台拒绝的逐条墙钟与确切命令见下方 (c-rerun)（一次带 `--include` 的调用）；原 (c) 不带 `--include` 的那一次没有写出命令，见 §3 第 19 条。本行原文保留。」；`:326` 行尾追加「**Superseded by (c-rerun)（2026-09-29）**：对账的确切命令见下方 (c-rerun)。」；`:328` 之后加「(c-rerun) 2026-09-29 复测：平台显式拒绝与随后的对账」，四行墙钟（前置：`assignee_check`、`baseline-c`；创建：`c-rerun sent` / `returned`；对账：`c-t1` / `c-t2`；判定与拆封：`c-verdict` 行、状态行、错误体）。
   - `:342` 行尾追加「**Superseded by (d-count)（2026-09-29）**：按标记计数的确切命令见下方 (d-count)。」；`:344` 之后加「(d-count) 2026-09-29 只读回读原 (c)/(d) 标记」，一行墙钟加 `d-count` 那一行输出。
5. 实验 3 §9 第 5 步（`:377`）句末追加：「（这一步在按第 1 步重建的沙箱里成立。复用现存沙箱时，该标签已被 (b) 自动创建，照抄会建出 issue，改用 §1 补观测协议的做法。）」
6. 实验 4 §4：`:434` 行尾追加「**Superseded by (e4-hit)（2026-09-29）**：`draft-a` 的存在、实际标题与平台 `createdAt` 另见下方 (e4-hit) 的回读；创建前基线的命令归属、`draft-a` 的创建命令与作废那一轮轮询不能事后补，见 §3 第 19 条。本行原文保留。」；`:443` 行尾追加「**Superseded by (e4-hit)（2026-09-29）**：本块没有记取得时刻；回读见下方 (e4-hit)。本块原文保留。」；`:450` 之后加「(e4-hit) 2026-09-29 只读回读」，一行墙钟加两行输出（`draft-b`、`draft-a`）。
7. §2.2 的 `rejected` 行：在「两类拒绝各被观测到一次」后追加「**Superseded by (a-rerun) / (c-rerun)（2026-09-29）**：客户端拒绝与平台拒绝各另有一次复测。」
8. §3 第 14 条句末追加「**Superseded by (c-rerun)（2026-09-29）**：平台拒绝另有一次复测；重试仍只有 3(d) 一次，本条对重试的限定不变。另：实验 3 §4 `:315` 记的是两次被拒的调用，本条「一次调用」与之不符，以 §4 的原文为准。」
9. §3 追加第 19 条：「**字面口径下不能事后补的观测（2026-09-29 登记）**：#119 验收 1 要求每条观测带墙钟与确切命令。§1 的补观测协议补齐了能再观测的部分；下列四处无法再观测，按 `docs/architecture/gate-e1-sandbox.md` §6 的「不补全」只登记、不补写：① 实验 3(c) 的两次调用里，不带 `--include` 的那一次没有写出命令，两个墙钟各对应哪一次也没有记录；② 实验 4 创建前基线 `items.totalCount = 7` 没有写明出自哪条命令；③ `draft-a` 的创建命令没有写出，它的实际标题（见 (e4-hit)）并不是按 `draft-b` 类推的那个；④ `draft-a` 作废的那一轮轮询，命令在实验 4 §6 第 1 条以 `…` 省略，墙钟没有记录。②–④ 属于已声明作废、不计入结论的那次计时，或创建前的状态。重做 ① 要再发一次 3(c)，重做 ③④ 要新建 draft，都不在 2026-09-29 批准的写入范围内。」
10. §4 第 4 行（`:583`）实测结论格末尾追加「**Superseded by (c-rerun)（2026-09-29）**：`422` 另有一次复测；重试仍是一次。」
11. 不改的：各处原文、§5 本地应有行、§6 第 1 条（措辞问题见技术债务）、§7、§8、§3 其余各条、§4 其余各行。所有新增文字只写平台实际返回的内容；本机路径等本地信息不进文档。运行日志与封存文件留在 `.superpowers/e1-l1-rerun/`（已被 `.gitignore` 忽略）。

### D3 墙钟守卫（Task A）

在 `tests/contract/e1-evidence-consistency.test.js` 加一条 test 和一份逐文档声明：

- `WALLCLOCK_STRICT_DOCS = { 'docs/architecture/gate-e1-uncertain-create.md': 20 }`：键是受约束的记录，值是 `时间（墙钟）：` 行数的下限。目前只有这份记录用这种写法；E1-1 到 E1-3 的记录不在 #119 范围内，也不许改。
- 规则一：凡是以 `时间（墙钟）：` 开头的行，要么「合规」，要么带 `Superseded by` 并且全部标签都能解析。「合规」的三个条件同时成立：行里有反引号包住的 ``(YYYY-MM-DDT)?HH:MM:SSZ``；不匹配缺口措辞 `/未[^。；，]{0,4}记录|下界|上界/`；不含 `Superseded by`。
- 规则二（解析，作用于**整份文档的任意行**）：`Superseded by` 后紧跟一个或多个以 ` / ` 分隔的 `(<标签>)`，标签形如 `[a-z0-9]+(-[a-z0-9]+)+`。每个标签都必须解析到**另一行**合规的 `时间（墙钟）：` 行：该行含同一个 `(<标签>)`，并带完整日期的反引号时刻 `` `YYYY-MM-DDTHH:MM:SSZ` ``。它同时覆盖墙钟行和命中原文引导行、§2.2 表格行、§3 条目这类非墙钟行上的 Superseded；既有的 `Superseded by §2 …`、`Superseded by 第 18 条` 不带括号标签，不受影响。
- 规则三（下限）：`时间（墙钟）：` 行数不少于声明值。20 = base 的 8 行 + 六个子观测全部为 R 时新增的 12 行（`(a-rerun)`、`(c-rerun)` 各 4 行，其余各 1 行）。整合者在 Batch 4 用 `grep -c '^时间（墙钟）：'` 回读最终记录，确认等于 20 后定值。
- 失败信息逐条列出 `<路径>:<行号> → <行文前 80 字>`，下限不足时另列 `行数 <n> < <下限>`。
- 已知限度（写进 test 注释）：它只证明「写成 `时间（墙钟）：` 的行都合规、写出的 Superseded 都有落点」，不证明「每条观测都写成了这种行」；后者靠 D0 的审计表。不采用「冒号后 N 个字符之内必须出现时刻」这类规则：`:295` 以「第一次调用」开头，这类规则一换措辞就会误伤。
- 约 60 行，不新增依赖，不改其它 test。

### D4 派生表述（Task C；只在全部子观测为 R 时并入）

`<n>` 是 Batch 0 回读得到的 PR 编号。「补观测子观测」统一写作「§1 的补观测协议与实验 2–4 的补观测子观测」。

| 落点 | 动作 | 理由 |
|---|---|---|
| `docs/architecture/gate-e1-ruling.md:241` | 在「待人类伙伴决策的两项（…）」的加粗标题后插入「（② 已于 2026-09-29 决定，见该项末尾）」；在②末尾「本层只写 `Refs #119`。」之后追加：**已决定（2026-09-29，人类伙伴）**：选补观测，并按字面口径补齐；逐条墙钟与确切命令见 `docs/architecture/gate-e1-uncertain-create.md` §1 的补观测协议与实验 2–4 的补观测子观测（PR #<n>），不能再观测的四处登记在该记录 §3 第 19 条。#119 是否关闭，以该 PR 的 `closingIssuesReferences` 与合并后的 issue 回读为准。①不动 | 门禁文档不能把已经决定的事项继续挂成待决；不写「#119 已关闭」这类合并之后才成立的事实 |
| L1 归档计划 `:3`（状态行） | 追加：「；**Superseded（2026-09-29）**：人类伙伴已选补观测并按字面口径补齐，见 `docs/architecture/gate-e1-uncertain-create.md` §1 的补观测协议与实验 2–4 的补观测子观测（PR #<n>）；#119 的状态以 `gh issue view 119 -R SingularityKChen/harness-projects --json state,closedByPullRequestsReferences` 回读为准」 | 这行写的是当前状态，已被推翻 |
| L1 归档计划 `:5`（范围行末） | 追加：「**Superseded（2026-09-29）**：两条出路中人类伙伴选了补观测，由 PR #<n> 执行；本段描述的是 #121 这一层的关联，原文保留。」 | 同上 |
| L1 归档计划 `:146`（Progress） | 追加：「**Superseded（2026-09-29）**：两处及字面口径下的其余缺口由记录 §1 的补观测协议补齐，不能再观测的登记在记录 §3 第 19 条（PR #<n>）。」 | 同上 |
| L1 归档计划 `:290`（Decision Log 的 Rationale） | 追加：「**Superseded（2026-09-29）**：人类伙伴选出路①。「3(a) 的失败创建不产生对象，换一个标记即可重跑」在现存沙箱里不成立——(b) 已把 `e1-label-that-does-not-exist` 建成真实标签，照抄原命令会建出 issue；补观测因此改用写入前确认不存在的新标签名，见记录实验 3 的 (a-rerun)（PR #<n>）。」 | 原文的「可重跑」前提已被推翻 |
| L1 归档计划 `:310`（Idempotence） | 追加：「**Superseded（2026-09-29）**：只在重建的沙箱里成立；现存沙箱里该标签已存在，重跑须换用不存在的标签名（记录实验 3 的 (a-rerun)）。」 | 同上 |
| L1 归档计划 `Bottom Change Note` | 追加一条：「- 2026-09-29：就地标注五处（状态行、范围行、Progress、Decision Log、Idempotence and Recovery），原文保留。原因：人类伙伴为 #119 验收 1 选了补观测并按字面口径补齐，由 PR #<n> 执行。」 | `PLANS.md` §5 |
| `docs/README.md:58` | 把「#119 保持开启：验收 1 待人类伙伴在补观测与收窄验收之间决定」**替换**为「#119 验收 1 的补观测见 [2026-09-29-e1-uncertain-create-wallclock](exec-plan/active/2026-09-29-e1-uncertain-create-wallclock.md)」；归档时 Batch 4 把链接改成 `completed/` | 索引写的是当前状态，直接替换 |
| 不改 | 控制计划 `:191`（它只是指针）、`docs/review/**`、`merge-queue.md`、L1 归档计划 `:131` 与 `:354`（历史快照或变更记录）、裁决 §2.6 `:80`（「同形对账两条路径都是 0 命中」是摘要，结论不变）、ADR | 改这些就是篡改历史，或者制造第二份副本 |

归档计划里的所有追加都不写关闭关键字，也不写本计划的 `docs/` 路径（归档后这个路径会失效），只指向记录的节和 PR 号。

### D5 关联与关闭

- 所有提交的正文末尾都写 `Refs #119`（派生提交另加 `Refs #4`）。提交信息里的任何位置都不出现关闭关键字：经 rebase merge 进入 `main` 时，提交信息里的关闭关键字同样会关 issue。
- 草稿 PR 从 `Refs #119` 开始。只有同时满足「六个子观测全部为 R」「G3 答复为 (i)」「Batch 4 的验证全部通过」，才把 PR 描述的关联行改成关闭关键字加 `#119`，并回读 `gh pr view <n> -R SingularityKChen/harness-projects --json closingIssuesReferences`（期望 `[119]`）。其余情形都保持 Refs，PR 描述单列残余与未达成的条件，交人类伙伴决定。

### 被放弃的方案

| 方案 | 放弃原因 |
|---|---|
| 逐字重跑 3(a) 原命令 | 标签已经存在，会建出 issue，观测的是另一个分支 |
| 把 `:289` / `:309` 等原行改写成 2026-09-29 的时刻 | 伪造历史，违反 `PLANS.md:66` 的「原文保留」 |
| 新开「实验 5」或另建一份复测记录 | 需要补齐九字段、改 `DECLARED_EXPERIMENTS`；裁决、README、ADR 里的「实验 1–4」计数全部失真；另建记录会成为第二权威 |
| 把 `:275` 的「同形」补写成 (a)/(c)/(d) 的确切命令 | (a)、(c) 的原文投影不同，补写出来的命令产生不了已记录的输出，违反「不补全」；改为新观测 `(a-rerun)`、`(c-rerun)`、`(d-count)` |
| 用只读回读代替 3(c) 复测 | (c) 的 `422` 是对写入的响应；(c) 之后「对账为 0」的状态在 (d) 建出 `#12` 之后已不存在 |
| 重跑 3(d) | 3(d) 预期建出 1 个对象，是第三次写入，不在批准范围；它的「按标记计数 1」由只读的 `(d-count)` 回读 |
| `(c-rerun)` 发两次（带 / 不带 `--include`）以对齐原 (c) | 超出「再做一次 3(c) 写入尝试」的批准；不带 `--include` 的那一次登记为残余 ① |
| 为 `draft-a` 重建 draft，补它的创建命令与作废轮询 | 新建对象不在批准范围；登记为残余 ③④ |
| `(e2-hit)` 不加投影、照录全量输出 | 今天的搜索与列表输出比原块多出作者的 `id`、`is_bot`、`type`、`url`、`name`，既扩大发布面，也让「与原块逐字节相同」无法机械比对 |
| 把协议放在实验 3 §3 | 协议覆盖实验 2、3、4；放在 §1「命令约定」下，各子观测按步号引用 |
| 按 `draft-a` 类推标题做回读 | 实际标题是 `… draft 20260923T0340Z`，类推得 0 命中（当前事实表） |
| 只在 Validation 里放一条 awk，不加守卫 | 没有强制点，回归不设防；守卫检的是一条性质，不复述内容，base 红、head 绿有判别力 |
| `GH_DEBUG=api` 证明「请求没到平台」 | 扩大发布面（请求头与请求体），验收 1 用不到它 |
| 用 `gh label list --search` 预检新标签 | 它按名字和描述模糊匹配，可能命中现存的 `e1-label-that-does-not-exist`；改用 `--limit 100` 加 jq 精确过滤 |
| 在同一次调用里 `sleep 60`，或只等 15 s | 执行环境可能拦截前台 sleep；15 s 的依据只是 n = 1 的样本；改成独立一次调用，用墙钟差证明 |
| 在沙箱定义 §2.6 登记构造出来的标签名 | §2.6 服务的是 id 字面量的追溯不变量，标签名不是 id 字面量 |
| Superseded 指向本计划的 `active/` 路径 | 归档后路径失效，plan-facts (iii) 会变红 |
| 标签用 `kind:test` + `area:providers` | 分支前缀是 `docs/`；policy-check 要求标题 kind 与标签一致（`scripts/policy-check.mjs:156`）；本 PR 不改 providers |
| 草稿 PR 一开始就写关闭关键字 | 结果出来之前就断言会关闭 |
| 收窄验收 1 / G2 选 (a) | 人类伙伴授权择优，主会话选 (b)（`Decision Log`） |

### 评审者会怎么打破它（逐条对应到防线）

1. 照抄原标签 → 建出 issue。防线：新标签名，第 1 步 `new_label_hits=0`，第 6 步闸门。
2. 用模糊搜索做预检 → 误停或误判。防线：精确的 jq 过滤。
3. `gh label list` 默认只取 30 条。防线：`(b-label)` 按原命令逐字执行（11 个标签），空结果是 D；新标签的计数用 `--limit 100`。
4. `$?` 被后续命令覆盖。防线：exit 紧跟在写入命令之后写进封存文件。
5. 前台 sleep 被拦截，t2 离写入不到 60 s。防线：t2 独立一次调用，判定规则要求墙钟差。
6. 执行账号是评审 bot。防线：第 1 步与第 6 步闸门要求 `login` 等于 `$E1_OWNER`。
7. 有并发写入者。防线：比对编号集合并按标题过滤；无关的新编号归入 N，不重跑。
8. `--limit 100` 截断编号集合。防线：长度必须小于 100。
9. 执行者先看了响应，盲对账破功。防线：封存；判定行的日志行号早于拆封原文。
10. 只加 Superseded，不补数据。防线：守卫规则二要求每个标签都落到另一行带完整日期的合规行；变异 m2、m3、m6。
11. Superseded 指向自己。防线：目标必须是**另一行**。
12. 协议块里的注释写成 `# 实验…`。防线：`EXPERIMENT_HEADING` 会把它当成实验节；协议块注释一律以「第 N 步」等开头，行内注释不在行首。
13. 本计划写进沙箱 id 字面量，或行首绑定了沙箱 id 变量。防线：它会被发现为未声明的 E1 计划；本计划只引用变量名，期望值指向记录的行，不写 id。
14. 归档计划里写了关闭关键字或 `active/` 路径。防线：plan-facts 变红；D4 只指向记录的节与 PR 号。
15. 事后把「同形」补写成确切命令。防线：不补写；改为新观测 `(a-rerun)`、`(c-rerun)`、`(d-count)`，原行 Superseded。
16. 在新文字里重复「请求没有到达平台」。防线：只写 exit、原文、无新对象。
17. 短式时刻被当成 2026-09-23 以外的日期。防线：新行一律写完整日期，§1 说明短式所指的日期。
18. 本机路径、运行日志或响应头写进文档。防线：只写仓库相对路径；`(c-rerun)` 只摘状态行与错误体；disclosure 扫描加 `docs/development/publication.md` 的人工五类核对。
19. 按字面口径仍有缺口。防线：D0 逐条审计；能再观测的全部排进协议，不能的登记为残余 ①–④ 并由 G3 裁决关闭。
20. 协议块在计划和记录之间漂移。防线：验收第 6 项的 diff。
21. 中断后盲目重试。防线：写入闸门按日志拒绝第二次发出；恢复按 `Idempotence and Recovery`。
22. 守卫误伤其它合规行。防线：base 上的判别断言要求行号**恰好**是 `:289`、`:309`。
23. 单独调用某一步时忘了设标记、`START` 或 owner。防线：公共前缀的 `${…:?}` 让该次调用立即失败；`A_VERDICT` / `C_VERDICT` 同理。
24. `(a-rerun)` 已建出对象，`(c-rerun)` 仍然发出，合计超出 1 个对象。防线：第 10 步闸门要求 `a-verdict=absent` 且封存 exit 非 0，发出无返回或没有 exit 行时同样关闭。
25. 那个 assignee 名字今天可指派，`(c-rerun)` 被接受。防线：第 1 步 `assignee_check` 必须为 `404`，否则第 10 步闸门关闭。
26. 回读输出与原块「看起来一样」但实际不同。防线：`(e2-hit)`、`(e4-hit)` 按原块去掉折行后逐字节比对（验收第 8 项）。
27. `(d-count)` 的时间窗随手取值。防线：取原标记 `20260923T0340Z` 所在分钟的起点，带该标记的对象不可能早于它；窗口值写在输出行里。
28. 残余被悄悄当成已满足。防线：D5 要求 G3 明确答复 (i) 才写关闭关键字；PR 描述单列残余。

## Global Constraints

- **文件所有权（本计划改动的文件集合，唯一声明）**：
  1. `docs/exec-plan/active/2026-09-29-e1-uncertain-create-wallclock.md`（本文件；Batch 4 移到 `docs/exec-plan/completed/`）：owner 是整合者；
  2. `docs/README.md`：Batch 0 加 Active 行（整合者）；`:58` 的 L1 行由 Task C 改；Batch 4 把本计划的行移到 Completed，并把 `:58` 的链接改为 `completed/`（整合者）；
  3. `docs/architecture/gate-e1-uncertain-create.md`：Task B；
  4. `tests/contract/e1-evidence-consistency.test.js`：Task A；
  5. `docs/architecture/gate-e1-ruling.md`（只改 §9 的待决项②）：Task C；
  6. `docs/exec-plan/completed/2026-09-23-e1-uncertain-create.md`（只改 D4 列出的 5 处追加和 1 条 `Bottom Change Note`）：Task C；
  7. 有条件：`docs/architecture/gate-e1-sandbox.md` §2.3，只在某个写入子观测为 D 时由 Task B 改。
- **只读**：其余一切，特别是 E1-1 到 E1-3 的记录、沙箱定义（D 情形除外）、ADR、`docs/review/**`、`docs/project-management/**`、控制计划、`packages/**`。
- **外部写入**：沙箱里只有两次写入尝试——协议第 6 步 `(a-rerun)` 的 `gh issue create` 与第 10 步 `(c-rerun)` 的 `gh api --method POST`，各只发一次，合计建出的对象 ≤ 1 个私有 issue；`(a-rerun)` 已建出对象或无法证明没有建出时，第 10 步不得发出（D1「写入预算与互斥」，由闸门机械执行）。读取不限，但只读沙箱与本仓库。本仓库 GitHub 上允许的写入：推送本分支、创建和编辑草稿 PR、设置 PR 的标签与 milestone、在最终验证之后执行 `gh pr ready <n>`。**不做**：编辑 issue #119 或在上面评论、写 Project 10 的任何字段（含 `Status`）、合并 PR、删除任何沙箱对象。每一次外部写入都在 `Progress` 的台账里记下 actor、目标、幂等键和结果。
- **规模**：代码 ≤800 行、文档 ≤1300 行（人类伙伴本轮给的上限，严于 `AGENTS.md` §6 的 1000 / 1500）。预估代码约 60 行、文档约 1000 行（本计划约 720 行，记录约 250 行，其余约 30 行）。
- **语言与发布面**：文档正文中文，标识符、路径、命令英文；不写本机绝对路径、凭据、内部系统、响应头；账号名按沙箱定义 §7 可以写。
- **提交**：格式为 `<type>(<scope>): <中文摘要>`；正文说明原因；末尾写 `Refs #119`，并附本次会话给定的 attribution 行。关联与关闭规则见 D5。
- **守卫与发现规则**：不新增实验节标题；代码块里不出现以 `# 实验` 开头的行；本计划不含沙箱登记过的 id 字面量，也不把绑定 id 的沙箱变量名（如 `E1_PROJECT_A_ID`）写成行首赋值；协议块里行首的 `E1_L1_RERUN=`、`START=` 值不是 id、名字也不绑定 id，不触发发现。
- **不变量**：规划状态与工程状态正交，本计划的任何步骤都不推进看板字段；LLM 不参与 #119 验收的判定，只提供证据与草稿，关闭由人类伙伴合并 PR 决定。

## Plan of Work

### Batch 0 · 对齐、预注册与草稿 PR（整合者；沙箱零写入）

**最小闭环**：本计划和协议 v2 推送到 GitHub。推送时刻就是「预测早于观测」的外部证据。草稿 PR 以 Refs 关联 #119，并把 G3 交给人类伙伴。

**涉及文件**：本文件、`docs/README.md`（Active 行）。

- [x] 工作区检查：`git rev-parse --git-dir --git-common-dir`；`git status --short --branch`；`git worktree list --porcelain`；`git check-ignore -v .worktrees/`。期望分支是 `docs/e1-uncertain-create-wallclock`，且 `git merge-base HEAD origin/main` 等于 `git rev-parse origin/main`。
- [x] 依赖：`pnpm install --frozen-lockfile`（本工作树的 `node_modules` 缺 `yaml`，见 `Surprises & Discoveries`）。
- [x] 基线：`node --test tests/contract/e1-evidence-consistency.test.js tests/contract/plan-facts-consistency.test.js`，期望 tests 8 / fail 0；`node --test tests/contract`，期望 fail 0。
- [x] 提交 `docs(exec-plan): 为 #119 验收 1 的字面补齐建立执行计划`（`Refs #119`）。推送之前先确认没有同名 PR：`gh pr list -R SingularityKChen/harness-projects --head docs/e1-uncertain-create-wallclock --state all`，期望为空。（2026-09-29：`2ecb5fd`，2026-09-29T11:35:28Z）
- [x] 推送后开草稿 PR，base 为 `main`。标题 `docs(architecture): 按字面补齐不确定创建记录的逐条墙钟与确切命令`；标签 `kind:docs`、`area:architecture`、`area:exec-plan`、`area:tests`、`gate:E1`；milestone `M1 · Gate E1 身份与同步验证`。描述按 `.github/pull_request_template.md` 写，关联行是 `Refs #119`、`Refs #4`。（2026-09-29：PR #244，createdAt `2026-09-29T11:36:01Z`，早于第 0 步 `START = 2026-09-29T11:37:56Z`）
- [x] 在对话里把下面的 G3 原样发给人类伙伴，答复逐字记进 `Decision Log`。G3 不阻塞 Batch 1–3。**完成（2026-09-30）**：主会话发问，人类伙伴选 (i)；原先的「未完成（2026-09-29）：答复之前 PR 保持 `Refs #119`」由此取代。

**给人类伙伴的确认（G3；只决定 PR 是否关闭 #119）**：

> 按验收 1 的字面口径逐条审计四条实验的观测后，除了已排进补观测的六处，还有四处无法再观测：① 实验 3(c) 的两次调用里，不带 `--include` 的那一次没有写出命令，两个墙钟各对应哪一次也没有记录；② 实验 4 创建前基线 `items.totalCount = 7` 没有写明出自哪条命令；③ `draft-a` 的创建命令没有写出（它的实际标题是 `fixture uncertain-create draft 20260923T0340Z`，不是按 `draft-b` 类推的 `draft-a`）；④ `draft-a` 那一轮作废轮询的命令在记录里以 `…` 省略，墙钟未记。②–④ 属于记录已声明作废、不计入结论的计时尝试，或创建前的状态。重做 ① 要再发一次 3(c)，重做 ③④ 要新建 draft，都超出已批准的写入；补写会违反「不补全」。本计划把它们登记在记录 §3 第 19 条。请选：(i) 登记即视为满足验收 1，六个子观测全部为 R 时 PR 写关闭关键字；(ii) 保持 Refs，由您另行决定（收窄验收，或另批重做）。

**验证**：

```bash
grep -cE '(PVTI_|PVTSSF_|PVTIF_|PVTF_|PVT_|I_kw|PR_kw|DI_|R_kg)[A-Za-z0-9_-]{5,}' docs/exec-plan/active/2026-09-29-e1-uncertain-create-wallclock.md   # 期望 0
node --test tests/contract/e1-evidence-consistency.test.js tests/contract/plan-facts-consistency.test.js   # 期望 tests 8 / fail 0
gh pr view <n> -R SingularityKChen/harness-projects --json isDraft,baseRefName,headRefName,labels,milestone \
  --jq '{isDraft,baseRefName,headRefName,labels:[.labels[].name],m:.milestone.title}'   # 期望 isDraft=true、base=main、5 个标签、M1
node scripts/policy-check.mjs pr <n>   # 期望 exit 0
```

**回滚**：关闭草稿 PR；`git revert` 本批次的提交。沙箱没有被写入，无需外部回滚。

### Batch 1 · 墙钟守卫 TDD（Task A；和 Batch 2 并行）

**最小闭环**：守卫在 base 记录上恰好点名两行并报告行数不足、变红，在模拟的 head 记录上变绿；变异证明它的每条规则都生效。

**涉及文件**：`tests/contract/e1-evidence-consistency.test.js`。

- [x] 从 PR 分支 head 建隔离工作区：`git worktree add .worktrees/e1-wallclock-guard -b test/e1-wallclock-guard docs/e1-uncertain-create-wallclock`（先按 `AGENTS.md` §7 用 realpath 核对目标路径在 `.worktrees/` 之下）。
- [x] 按 D3 写守卫，在未改动的记录上运行，期望红。
- [x] 模拟 head（只在本工作区、不提交）：按 D2 给 `:168`、`:275`、`:289`、`:309`、`:315`、`:326`、`:342`、`:434`、`:443`、§2.2 `rejected` 行、§3 第 14 条、§4 第 4 行加对应的 Superseded，再插入 12 行合规的 `时间（墙钟）：`（带完整日期，每个标签的行数同 D3 规则三）。期望绿；随后 `git checkout -- docs/architecture/gate-e1-uncertain-create.md` 还原。
- [x] 变异 m1–m3、m5、m6（见 `Validation and Acceptance`）在模拟 head 上各跑一次。每次先用 `grep -c` 证明变异确实写进去了，再看测试变红，然后还原。
- [x] 提交 `test(contract): 为 #119 记录的逐条墙钟加证据守卫`（`Refs #119`）。只留在本地分支，由整合者在 Batch 4 cherry-pick 到记录提交之后，保证推送出去的每个提交都是绿的。

**验证**：

```bash
node --test tests/contract/e1-evidence-consistency.test.js
# 期望（记录未改动时）：tests 6 / pass 5 / fail 1；失败信息里的行号恰好是 :289 与 :309，另报行数 8 < 20
git diff --stat HEAD~1 -- . ':!tests/contract/e1-evidence-consistency.test.js'   # 期望：无输出
```

**回滚**：丢弃本地分支上的提交，PR 分支不受影响。

### Batch 2 · 沙箱补观测与记录（Task B）

**最小闭环**：按 D1 执行一次运行，六个子观测各得到一个结果类；全部为 R 时按 D2 落记录。

**涉及文件**：`docs/architecture/gate-e1-uncertain-create.md`（某个写入子观测为 D 时再加 `docs/architecture/gate-e1-sandbox.md`）。

- [x] 确认 Batch 0 已推送（预注册生效），`Decision Log` 里有 G1、G2 的答复。
- [x] 在 PR 工作树根目录按协议执行第 0–13 步。每一步都是单独一次调用；第 8、12 步与各自 `returned` 相隔至少 60 s。
- [x] 按判定规则与结果类逐子观测归类，把类别和各步墙钟汇报给整合者；整合者写进 `Progress` 与外部写入台账（两行，第 10 步 `gate-closed` 时也记一行）。
- [x] 有任何子观测不是 R：按 D1 的处置执行，然后停下，不进入 Batch 3。**不适用**：六个子观测全部为 R（`Decision Log`）。
- [x] 全部为 R：按 D2 第 1–10 条改记录。提交 `docs(architecture): 按字面补齐不确定创建记录的逐条墙钟与确切命令`（`Refs #119`）。

**验证**：

```bash
RUNLOG=".superpowers/e1-l1-rerun/<标记>.log"
grep -c '^a-rerun sent=' "$RUNLOG"; grep -c '^c-rerun sent=' "$RUNLOG"; grep -c 'gate-closed' "$RUNLOG"   # 期望 1、1、0
grep -E ' phase=(baseline-a|a-t1|a-t2|baseline-c|c-t1|c-t2) ' "$RUNLOG"   # 期望六行 list=[] search=[] new_label_hits=0；a-t2、c-t2 的 numbers 与 baseline 相同
grep -E ' phase=d-count ' "$RUNLOG"                                      # 期望 list=[12] search=[12]
grep -cE "^could not add label: 'e1-label-absent-[0-9T]+Z' not found$|^exit=1$|^HTTP/2.0 422 Unprocessable Entity$" "$RUNLOG"   # 期望 4
grep -n -e 'a-verdict=' -e '^could not add label' -e 'c-verdict=' -e '^HTTP/2.0 422' "$RUNLOG"   # 期望每个 verdict 行号小于对应拆封原文的行号
grep -c '^时间（墙钟）：.*`2026-09-29T[0-9:]*Z`' docs/architecture/gate-e1-uncertain-create.md   # 期望 12
node --test tests/contract/e1-evidence-consistency.test.js tests/contract/plan-facts-consistency.test.js   # 期望 tests 8 / fail 0（守卫还没并入）
```

**回滚**：记录改动用 `git revert` 撤销。沙箱侧在全部为 R 时没有新对象；为 D 时产生的对象按沙箱定义 §5 保留，不删除。

### Batch 3 · 派生表述（Task C；可以和 Batch 1、2 并行起草，只在全部为 R 时并入）

**最小闭环**：同一事实（「#119 验收 1 待人类决定」）的全部当前态落点改成「已选补观测并按字面口径补齐」，历史快照不动。

**涉及文件**：`docs/architecture/gate-e1-ruling.md`、`docs/exec-plan/completed/2026-09-23-e1-uncertain-create.md`、`docs/README.md`（只改 `:58`）。

- [x] 从 Batch 0 之后的 PR 分支 head 建工作区：`git worktree add .worktrees/e1-wallclock-derived -b docs/e1-wallclock-derived docs/e1-uncertain-create-wallclock`（先做 realpath 核对）。
- [x] 按 D4 的表逐行追加或替换。`<n>` 用 Batch 0 回读的 PR 编号。
- [x] 提交 `docs(architecture): 同步裁决 §9 与 L1 归档计划的 #119 待决表述`（`Refs #119`、`Refs #4`）。等 Task B 报告全部为 R 后，由整合者并入。并入时措辞按 Task B 的实际结果重写（`Decision Log`）。

**验证**：

```bash
node --test tests/contract/plan-facts-consistency.test.js   # 期望 tests 3 / fail 0
git grep -n -e '119 保持开启' -e '补观测与收窄验收之间决定' -e '补观测还是收窄验收' -- docs ':!docs/review' \
  ':!docs/exec-plan/*/2026-09-29-e1-uncertain-create-wallclock.md' \
  | grep -v -e 'Superseded' -e '已决定' -e ':- 2026-'   # 期望：无输出（base 上命中 README:58、裁决:241、L1 计划:3 与:354 四行）
node -e 'const {execSync}=require("child_process");for(const f of ["docs/architecture/gate-e1-ruling.md","docs/exec-plan/completed/2026-09-23-e1-uncertain-create.md"]){const d=execSync(`git diff -U0 origin/main -- ${f}`,{encoding:"utf8"}).split("\n");const del=d.filter(l=>l.startsWith("-")&&!l.startsWith("---")).map(l=>l.slice(1));const add=d.filter(l=>l.startsWith("+")&&!l.startsWith("+++")).map(l=>l.slice(1));const lost=del.filter(x=>!add.some(y=>y.startsWith(x)));console.log(f,JSON.stringify(lost));if(lost.length)process.exitCode=1}'
# 期望：两行都打印 []，exit 0（只在原处追加，原文一字不丢）
```

**Superseded by `Validation and Acceptance` 第 11 项与 V11（2026-09-29，Batch 4）**：上面这条 node 命令只认行尾追加，而规格本身有三处行中插入——D4 第 1 行（裁决 `:241` 标题后的括号）、D2 第 7 条（记录 §2.2 `rejected` 行的表格单元格）、D2 第 10 条（记录 §4 第 4 行的表格单元格）。它会把这三行报成「丢失」。判据放宽为「每条被改的原行，删去至多两段连续插入后与原行逐字相同」，并打印行中插入的行数供人工核对；只对这三行放宽，其余行仍须是行尾追加。

**回滚**：丢弃本地分支的提交；已并入的用 `git revert`。

### Batch 4 · 验收、整合、归档与请求评审（Opus 整合者）

**最小闭环**：PR 分支 head 上所有验收项都有证据；计划已归档；PR 从草稿转为 ready，并请人类伙伴评审。

**涉及文件**：本文件（回填后移到 `completed/`）、`docs/README.md`（本计划的行移到 Completed，`:58` 的链接改为 `completed/`）。

- [x] 整合顺序：Task B 的记录提交 → cherry-pick Task A 的守卫提交（按 D3 规则三回读后确认下限值）→ cherry-pick Task C 的派生提交 → 本文件回填（`Progress`、`Surprises`、`Decision Log`、`Outcomes`、D0 最后一列）→ 归档提交 `docs(exec-plan): 回填并归档 #119 补观测计划`（用 `git mv`，把 README 的行移到 Completed，并把 `:58` 的链接改成 `completed/` 路径）。每个提交单独跑一次 `node --test tests/contract`，期望 fail 0。
- [x] 独立审读：对照「评审者会怎么打破它」逐条复核；按验收 1 的原条件（每条观测带墙钟与确切命令）把 D0 的每一行对着记录行号与运行日志重跑一遍，填最后一列。重构不得改变验收结果；重构之后重跑受影响的验证。
- [x] 变异表在**最终树**上整表重测一次（m1–m6），每一条都先证明变异生效。
- [x] 需要改写历史时，先建本地备份分支 `git branch backup/e1-uncertain-create-wallclock-$(date -u +%Y%m%dT%H%MZ)`，再用精确的 old head 执行 `git push --force-with-lease=docs/e1-uncertain-create-wallclock:<old-head> origin docs/e1-uncertain-create-wallclock`；改写之后用 `comm` 比对新旧 head 的文件集合。**实际**：先只改写了未推送的本地提交（把记录 §4 第 4 行补一个句号的 fixup 并回记录提交），第一次推送是从 `2ecb5fd` 快进到 `7801d9e`。之后 `origin/main` 前进到 `699d715`（#237 合并），PR 变成 `CONFLICTING`，于是把整条分支 rebase 到 `699d715`：先建备份分支 `backup/e1-uncertain-create-wallclock-prerebase-20260929T1604Z`（指向 `7801d9e`），再用 `--force-with-lease=docs/e1-uncertain-create-wallclock:7801d9e` 推送；每次改写之后都用 `comm` 比对了文件集合（`Progress`）。
- [x] 按 D5 决定关联行，更新 PR 描述：闭环、ExecPlan 与 Batch、真实验证证据、残余 ①–④ 与 G3 的答复、风险与回滚。
- [ ] 推送之后回读 head、base、checks、`closingIssuesReferences`、`closedByPullRequestsReferences`、review threads。最终 head 验证通过后执行 `gh pr ready <n>`，然后在对话里请人类伙伴评审（附当前 head、base、checks、风险、回滚与残余）。不合并。**部分完成（2026-09-29）**：回读照做；`gh pr ready` 与请求评审按主会话指令不由 Batch 4 执行，留待 G3 答复之后由主会话处理。

**验证**：见 `Validation and Acceptance` 全表，外加：

```bash
pnpm verify                                             # 期望 exit 0
node scripts/rule-checks.mjs disclosure origin/main     # 期望 exit 0
node scripts/rule-checks.mjs size origin/main           # 期望 exit 0；读输出里的代码 / 文档行数，核对 ≤800 / ≤1300
git diff --check origin/main...HEAD                     # 期望无输出
gh pr checks <n> -R SingularityKChen/harness-projects   # 期望全部 pass，含 PR Fast Gate
```

**回滚**：`git revert` 本 PR 的全部提交（rebase merge 之后逐个 revert）。沙箱侧见 `Idempotence and Recovery`。

## Validation and Acceptance

在检出 PR 分支（归档后本文件位于 `completed/`，命令里的路径相应替换）的工作树根目录运行。`R=docs/architecture/gate-e1-uncertain-create.md`，`LOG=.superpowers/e1-l1-rerun/<标记>.log`。

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 3(a) 的对账带逐条墙钟与确切命令 | 记录里 4 行含 `(a-rerun)` 的 `时间（墙钟）：`，每行带完整日期；`:289` 带 `Superseded by (a-rerun)` |
| 2 | (c) 的拒绝以及 (c)、(d) 之后的对账带逐条墙钟与确切命令 | 4 行含 `(c-rerun)`、1 行含 `(d-count)` 的墙钟行；`:315`、`:326` 带 `Superseded by (c-rerun)`，`:342` 带 `Superseded by (d-count)`，`:275` 带三者 |
| 3 | 两个命中原文块与标签回读带墙钟与确切命令 | 各 1 行含 `(b-label)`、`(e2-hit)`、`(e4-hit)` 的墙钟行；`:309`、`:168`、`:443` 带对应 Superseded |
| 4 | 协议在记录里 | 记录 §1 有 `# e1-l1-rerun protocol v2` 开头的协议块（第 6 项核对与本计划一致） |
| 5 | 六个子观测全部为 R | Batch 2 验证的日志检查全部符合期望；结果类写进 `Decision Log` |
| 6 | 协议块在计划与记录里逐字一致 | `diff <(awk '/^# e1-l1-rerun protocol v2$/,/^cat "\$C_SEALED"/' docs/exec-plan/completed/2026-09-29-e1-uncertain-create-wallclock.md) <(awk '/^# e1-l1-rerun protocol v2$/,/^cat "\$C_SEALED"/' "$R") && echo same` → `same`（先用 `\| wc -l` 确认两边行数相同且非零） |
| 7 | 记录摘录与运行日志逐字相符 | 把各子观测原文块的行存进 scratch 文件，`grep -F -x -f <scratch> "$LOG" \| wc -l` 等于 scratch 的行数 |
| 8 | 回读与原块逐字节相同 | 表后代码块 V8：`(e2-hit)` 的两行、`(e4-hit)` 的第一行分别与原块去掉折行后逐字节相同；`(e4-hit)` 第二行的两个 id 与记录 §1 夹具表 `draft-a` 行相同 |
| 9 | 守卫有判别力 | `git checkout 2f9e0ee8272e1d0369aea9e2647e584e65cbc258 -- "$R" && node --test tests/contract/e1-evidence-consistency.test.js; git checkout HEAD -- "$R"` → fail 1，行号恰好是 `:289`、`:309`，另报行数 8 < 20 |
| 10 | 变异生效（每条先证明写进去了；在最终树上执行，执行后 `git checkout HEAD -- "$R"`） | m1：`perl -pi -e 's/Superseded by \(a-rerun\)/Superseded-by (a-rerun)/ if /^时间（墙钟）：/' "$R"`，先看 `grep -c '^时间（墙钟）：.*Superseded by (a-rerun)' "$R"` 由 1 变 0，测试 fail 1。m2：把同一处换成 `Superseded by (z-none)`，先看 `grep -c 'Superseded by (z-none)'` 为 1，fail 1。m3：`perl -pi -e 's/\x602026-09-29T/\x60/g if /^时间（墙钟）：.*\(a-rerun\)/'`，先看 `grep -c '^时间（墙钟）：.*2026-09-29T.*(a-rerun)'` 由 4 变 0，fail 1。m5：`perl -pi -e 's/^时间（墙钟）：/时间：/'`，先看 `grep -c '^时间（墙钟）：'` 为 0，fail 1（下限）。m6：`perl -pi -e 's/Superseded by \(e2-hit\)/Superseded by (z-none)/ if /^两条路径的命中原文/'`，先看 `grep -c '^两条路径的命中原文.*(z-none)'` 为 1，fail 1（非墙钟行的解析）。m4 即第 9 项。每条还原之后测试恢复为 pass |
| 11 | 原文保留（只在原处追加） | Batch 3 那条 node 命令，文件清单加上 `$R`，期望三份文件都打印 `[]`。**Superseded by V11（2026-09-29）**：规格里有三处行中插入，判据改为 V11 |
| 12 | 派生表述一致 | Batch 3 的 `git grep` 命令 |
| 13 | E1 计划发现规则没有被触发 | Batch 0 的 id 字面量 `grep` → `0`；e1 守卫 pass |
| 14 | 规模、发布面、空白 | Batch 4 的 `size` / `disclosure` / `diff --check`；人工核对记录里没有响应头 |
| 15 | 关联正确 | `gh pr view <n> -R SingularityKChen/harness-projects --json closingIssuesReferences --jq '[.closingIssuesReferences[].number]'`：D5 三条同时成立时期望 `[119]`，否则期望 `[]`；`gh issue view 119 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences` 与之一致 |
| 16 | 人类决定有记录 | `Decision Log` 里有 G1、G2 的逐字答复；G3 答复或「未答复，保持 Refs」 |

V8（在 Batch 2 的运行日志上执行）：

~~~bash
E2=$(awk '/^两条路径的命中原文/{f=1;next} f&&/^```json$/{g=1;next} g&&/^```$/{exit} g' "$R" | sed 's/^ *//' | tr -d '\n')
E4=$(awk '/^命中原文（§3 的对账命令/{f=1;next} f&&/^```json$/{g=1;next} g&&/^```$/{exit} g' "$R" | sed 's/^ *//' | tr -d '\n')
echo "${#E2} ${#E4}"                  # 期望两个非零长度（锚点失效时为 0，不能当作通过）
grep -cFx "$E2" "$LOG"                # 期望 2（(e2-hit) 的搜索路径与列表路径）
grep -cFx "$E4" "$LOG"                # 期望 1（(e4-hit) 的 draft-b）
grep '^| `draft-a` |' "$R" | grep -oE '(PVTI|DI)_[A-Za-z0-9_-]+' \
  | while read -r id; do grep -c "\"id\":\"$id\"" "$LOG"; done   # 期望两行 1（条目 id、内容 id）
~~~

V11（原文保留；每条被改的原行 x，都要有一条新增行 y，使 x 等于 y 删去至多两段连续插入；`mid` 是不属于行尾追加的行数）：

~~~bash
node -e 'const {execFileSync}=require("child_process");const fits=(x,y)=>{let p=0;while(p<x.length&&p<y.length&&x[p]===y[p])p++;let s=0;while(s<x.length-p&&s<y.length-p&&x[x.length-1-s]===y[y.length-1-s])s++;return y.slice(p,y.length-s).includes(x.slice(p,x.length-s))};for(const f of process.argv.slice(1)){const d=execFileSync("git",["diff","-U0","origin/main","--",f],{encoding:"utf8"}).split("\n");const del=d.filter(l=>l.startsWith("-")&&!l.startsWith("---")).map(l=>l.slice(1));const add=d.filter(l=>l.startsWith("+")&&!l.startsWith("+++")).map(l=>l.slice(1));const lost=del.filter(x=>!add.some(y=>y.startsWith(x)||fits(x,y)));const mid=del.filter(x=>!add.some(y=>y.startsWith(x))).length;console.log(f,JSON.stringify(lost),"mid="+mid);if(lost.length)process.exitCode=1}' \
  docs/architecture/gate-e1-ruling.md docs/exec-plan/completed/2026-09-23-e1-uncertain-create.md "$R"
# 期望：三行都打印 []，mid 依次为 1、0、2（裁决 :241；记录 §2.2 rejected 行与 §4 第 4 行），exit 0
# 判别力：把裁决 :241 的「在本项被采纳之前」删一个字，第一行打印出该原行，exit 1
~~~

## Progress

- [x] (2026-09-29) 三份独立设计完成独立评审与定稿；只读取证见 `Context and Orientation`。
- [x] (2026-09-29) G1 答复：按计划的解读执行（原文与选择理由见 `Decision Log`）。
- [x] (2026-09-29) G2 答复：选 (b) 字面口径；(c)/(d) 所需的 3(c) 复测写入获批（原文见 `Decision Log`）。
- [x] (2026-09-29) 按 G2 = (b) 修订本计划：独立复核实验 2、3、4 的相关原文与 3(c) 的拒绝原因，新增 `(c-rerun)`、`(d-count)`、`(e2-hit)`、`(e4-hit)`，协议升到 v2，守卫与验收随之更新；审计出残余 ①–④ 与 G3。
- [x] G3 答复（只阻塞 D5 的关闭判定）：2026-09-30 人类伙伴选 (i)。2026-09-29 Batch 4 归档时尚未答复、PR 当时保持 `Refs #119`；答复后主会话把 PR 描述的关联行改为关闭关键字并回读 `closingIssuesReferences`。
- [x] (2026-09-29) Batch 0 · 对齐、预注册与草稿 PR：`2ecb5fd` 推送、草稿 PR #244（`createdAt 2026-09-29T11:36:01Z`），早于第 0 步 `START = 2026-09-29T11:37:56Z`。rebase 之后这个提交是 `b0ef3b6`：`git range-diff` 标 `=`，内容与作者时间（2026-09-29T11:35:28Z）都不变，原 SHA 仍能从 PR #244 时间线的 force-push 事件回读。
- [x] (2026-09-29) Batch 1 · 墙钟守卫 TDD：Task A 在 `.worktrees/e1-wallclock-guard` 提交，整合时 cherry-pick 为 `63bf321`，rebase 之后是 `4bee7ab`。
- [x] (2026-09-29) Batch 2 · 沙箱补观测与记录：标记 `20260929T1137Z`，六个子观测全部为 R；记录提交 `707c0f4`（Task B 的 `3f42603`，加上 Batch 4 在记录 §4 第 4 行补的一个句号，未推送前并回），rebase 之后是 `ef028d3`。
- [x] (2026-09-29) Batch 3 · 派生表述：Task C 的 `ac7607c`、`0334a6f` 合为 `8d005db`（rebase 之后是 `0b32359`），措辞按 Batch 2 的实际结果重写（`Decision Log`）。
- [x] (2026-09-29) Batch 4 · 验收、整合、归档：每个提交单独跑 `node --test tests/contract`：base `f6a33d2` 上 `707c0f4` → tests 608 / fail 0，`63bf321`、`8d005db` → tests 609 / fail 0；rebase 到 `699d715` 之后逐个重跑的结果与归档提交的结果见 PR #244 描述（易失值）。`gh pr ready` 与请求评审未执行（主会话指令，见 Batch 4 最后一项）。
- [x] (2026-09-29) 历史整理：本地备份分支 `backup/e1-uncertain-create-wallclock-20260929T1159Z`（指向 `3f42603`）与 `backup/e1-uncertain-create-wallclock-pre-fixup-20260929T1206Z`（fixup 之前的 head）；`git rebase --autosquash 2ecb5fd` 之后 `git range-diff` 只有记录提交标 `!`，其余两个 `=`；`comm -3` 比对新旧 head 的文件集合为空。rebase 到 `699d715`：备份分支 `backup/e1-uncertain-create-wallclock-prerebase-20260929T1604Z`；唯一冲突是 `docs/README.md` 的 Completed 表顶部（双方各插一行，两行都保留，本计划的行在上）；`git range-diff` 前四个提交标 `=`、归档提交标 `!`；`comm -3` 比对旧 head `7801d9e` 与新 head 的文件集合，只多出 main 带来的文件。

外部写入台账（每次写入尝试之后追加一行；预算：沙箱写入尝试 2 次、新对象 ≤ 1）：

| 时刻（UTC） | actor | 目标 | 幂等键 | 结果 |
|---|---|---|---|---|
| 2026-09-29T11:35:28Z–11:36:01Z | `SingularityKChen`（gh 活动账号） | 本仓库：推送 `docs/e1-uncertain-create-wallclock`（`2ecb5fd`，rebase 后为 `b0ef3b6`）；开草稿 PR #244，5 个标签、milestone M1 | 分支名（开 PR 前 `gh pr list --head … --state all` 为空） | 成功；PR #244 为 draft，`closingIssuesReferences = []` |
| 2026-09-29T11:39Z 前后（未取墙钟：命令没有执行） | Task B 的执行环境 | 沙箱：第 6 步 `(a-rerun)` 第一次尝试 | 标题 `fixture uncertain-create failed 20260929T1137Z` | 被执行环境的自动权限分类器拒绝，命令没有执行：运行日志里没有这次的 `a-rerun sent=`；a-t1 的 `numbers` 与 `baseline-a` 相同、`new_label_hits=0`，零写入 |
| 发出 `2026-09-29T11:48:35Z` / 返回 `11:48:36Z` | `SingularityKChen`（= `$E1_OWNER`，第 1 步 `login=` 行） | 私有沙箱 `$E1_OWNER/$E1_REPO`：`gh issue create … --label e1-label-absent-20260929T1137Z`（第 6 步，人类伙伴选择重试之后） | 标题 `fixture uncertain-create failed 20260929T1137Z` | `could not add label: 'e1-label-absent-20260929T1137Z' not found`，exit 1；a-t1 / a-t2 零对象、零新标签 |
| 发出 `2026-09-29T11:50:47Z` / 返回 `11:50:48Z` | 同上 | 私有沙箱：`gh api --method POST …/issues`，`assignees[]=e1-user-that-does-not-exist`，`--include`（第 10 步，闸门五个条件全部满足后放行） | 标题 `fixture uncertain-create rejected 20260929T1137Z` | `HTTP/2.0 422 Unprocessable Entity`，错误体 `"field":"assignees"`、`"code":"invalid"`，exit 1；c-t1 / c-t2 零对象 |
| Batch 4 | `SingularityKChen` | 本仓库：快进推送本分支（`2ecb5fd` → `7801d9e`）；rebase 到 `699d715` 后以 `--force-with-lease=docs/e1-uncertain-create-wallclock:7801d9e` 推送；`gh pr edit 244 --body-file` | 分支名与 PR 号 | 以回读为准：`gh pr view 244 -R SingularityKChen/harness-projects --json headRefOid,isDraft,closingIssuesReferences`（期望 head 等于本地 head、仍为 draft、`closingIssuesReferences = []`） |

合计：沙箱写入发出 2 次（第 6 步第一次尝试被拒、没有执行，不计），新建 issue 0、新建标签 0、`gate-closed` 0；a-t2、c-t2 距各自 `returned` 70 s、65 s。2026-09-29T12:04:43Z 只读复核：仓库编号仍为 `[12,11,10,9,8,7,6,4,3,2,1]`，`e1-label-absent-` 开头的标签 0 个，以 `e1-` 开头的标签仍只有 `e1-label-that-does-not-exist`。

- [x] (2026-09-30) 评审修订：三条回归覆盖先合法后不存在、未解析尾部、非标签与自指；保留旧算法只抽取 helper 时3条回归中2条失败，修复后 E1/计划事实/内容归属18/18通过；仓库外重放记录418行的同一实际变异时，守卫以exit1点名418行拒绝。原文计时概括已对齐returned→t2，外部实验与G3决定不变。

## Surprises & Discoveries

- 3(a) 已经不能照抄重跑：它的标签在同一批次里被 (b) 建成了真实对象（2026-09-29 两次只读回读仍能看到，`createdAt = 2026-09-23T03:41:55Z`）。L1 归档计划 `:290` 与 `:310` 里「换一个标记即可重跑 / 可以任意重跑」的前提因此不成立（D4 处理）。
- `EXPERIMENT_HEADING` 逐行匹配、不识别代码围栏，协议块里以 `# 实验` 开头的注释会被当成实验节（`tests/contract/e1-evidence-consistency.test.js:122`）。
- `:309` 行里带着平台时刻，所以「行里有没有时刻」对它没有判别力，守卫靠缺口措辞加 Superseded 解析（D3）。
- 记录 `:248` 的 `(b')` 让 `(b′)` 这个命名不可用。
- (a) 与 (c) 的对账投影不同（`:291` 的 `count: 0` 对 `:328` 的 `0`），「同形」不能事后还原成确切命令。
- G2 = (b) 的独立复核（2026-09-29）：前一版审计列出的三处（实验 2、4 的命中原文块，(c)/(d) 的「同形」）属实，但不完整——字面口径下还有 (c) 不带 `--include` 的那次调用、(d) 之后的计数、实验 4 的创建前基线与 `draft-a` 三项（D0）。
- `draft-a` 的实际标题是 `fixture uncertain-create draft 20260923T0340Z`：按 `draft-b` 类推会得到 0 命中。这正是「不补全」要防的情形——类推出来的「确切命令」是错的。
- 记录 §3 第 14 条写「3(c) 是一次调用」，与 §4 `:315` 的「两次调用」不一致（D2 第 8 条就地注明）。
- `gh api -i` 打印全部响应头（含 `X-Oauth-Scopes`），`(c-rerun)` 的记录摘录因此只取状态行与错误体。
- 今天的搜索与列表输出里，作者对象比原块多出 `id`、`is_bot`、`type`、`url`（列表路径还有 `name`）；加上与原块同字段的投影后逐字节相同。
- 记录 §6 第 1 条「请求没有到达平台」超出观测（`:357`），登记为技术债务。
- `gh label list --search` 是按名字和描述的模糊匹配，不能用来断言某个名字不存在。
- 本工作树的 `node_modules` 没有 `yaml`；在本工作树跑 `node --test tests/contract` 时 `tests/contract/workflow-check.test.js:551` 一例失败，同一文件在主检出（同为 `f6a33d2`）上 pass 51 / fail 0。这是环境问题，Batch 0 先 `pnpm install --frozen-lockfile`。（评审会话 2026-09-29 观察，属观察时刻快照）
- 第 6 步的第一次尝试（约 2026-09-29T11:39Z）被执行环境的自动权限分类器拒绝，命令没有执行。预注册协议里没有这种情形：它既不是「发出无返回」，也不是闸门关闭。运行日志里没有这次的任何一行，闸门也就没有把它记成已发出；是否再试由人类伙伴决定（`Decision Log`）。
- Task B 的三处执行偏离（Task B 报告）：① 第 9 步之前用 `ls` 看过 `(a-rerun)` 封存文件的大小（71 字节），没有读内容。判定规则只用对账行（`list`、`search`、`numbers`、`new_label_hits` 与墙钟差），不用封存内容，所以这次查看不影响 `a-verdict`；判定行（日志第 22 行）仍早于拆封原文（第 23–24 行）。② 第 13 步拆封时把终端输出重定向到 `/dev/null`，免得响应头出现在会话里；写进日志的内容与协议相同。③ D2 第 8 条里的 `:315` 改写成「实验 3 §4 的 (c) 一节」：补观测插入之后原行号已经移动。
- `(c-rerun)` 的错误体没有结尾换行，gh 写到 stderr 的 `gh: Validation Failed (HTTP 422)` 因此接在同一行（记录 `:529` 原样保留并注明）。
- Batch 3 那条「原文一字不丢」的 node 命令只认行尾追加，而 D2 第 7、10 条与 D4 第 1 行本身就规定了行中插入：记录 §2.2 `rejected` 行与 §4 第 4 行的插入点在表格单元格中间，裁决 `:241` 的括号在加粗标题之后。三行删去插入段后都与 origin/main 原行逐字相同。判据改为 V11（`Validation and Acceptance`）。
- D4 写的 `docs/README.md:58` 是 `f6a33d2` 上的行号。行号会随索引表增删而移动：Batch 0 在 Active 表加了一行，main 在 `699d715` 又在 Completed 表顶部加了一行。所以按链接文本 `2026-09-23-e1-uncertain-create` 定位该行，不按行号定位。
- Task C 是在 Task B 出结果之前起草的：`ac7607c` 预写了记录的内容，`0334a6f` 又全部收回成「不预写结果」。Batch 4 按 Task B 的实际结果重写了这些措辞。
- 墙钟守卫对「带 Superseded 但标签无落点」的墙钟行会报两次（规则一、规则二各一次，见变异 m2 的输出）。它只是信息冗余，不影响判定。
- 记录 `:428` 摘录了第 1 步输出的平台 `Date:` 响应头。这是 D2 第 4 条列出的平台时钟锚点，不带账号或凭据信息；`(c-rerun)` 封存文件里的 15 个 `X-` 开头的响应头都没有进记录。

- 2026-09-30：旧守卫只读第一组；合法a-rerun之后追加missing-tag仍通过。两条新回归在旧实现红、逐组检查后绿，未改变现有记录的标签或墙钟。

## Decision Log

- **Decision**：本 PR 的流程由人类伙伴指定：多个独立子 agent 各自设计 → 独立评审定稿并写 ExecPlan → 开草稿 PR 关联 issue → Sonnet 在各自的 worktree 并行做 TDD 与对抗验证 → Opus 验收与重构 → 请人类伙伴评审 PR。
  **Rationale**：人类伙伴的本轮指令。本计划的 Batch 0–4 与 Task A/B/C 按这条流程切分。
  **Date/Author**：2026-09-29 / 人类伙伴
- **Decision**：#119 验收 1 选「补观测」。批准的外部写入范围原文：在私有沙箱仓库 `$E1_OWNER/$E1_REPO`（见 `docs/architecture/gate-e1-sandbox.md` §2.1）重跑 3(a)——一次丢弃响应的 createIssue（新建 1 个私有 issue）加带墙钟的对账查询；另做一次只读的标签回读；每条观测带确切命令与 `date -u` 的墙钟；设计阶段不执行任何写入。**仅此范围。**
  **Rationale**：#119 评论（2026-09-25）给出的两条出路之一；收窄验收被否。
  **Date/Author**：2026-09-29 / 人类伙伴
- **Decision**：本轮规模上限为代码 ≤800 行、文档 ≤1300 行；超出时先删 dead code 或简化，不拆 issue、不聚合。MMP 前不写兼容层与迁移。
  **Rationale**：人类伙伴的本轮指令，严于 `AGENTS.md` §6。
  **Date/Author**：2026-09-29 / 人类伙伴
- **Decision**：G1 与 G2 的答复。人类伙伴原话：「G1 和 G2 按照最佳的方式选择」。
  **Rationale**：这句话授权主会话在两道闸门上择优，选择与理由逐条记在下面两条。
  **Date/Author**：2026-09-29 / 人类伙伴
- **Decision**：G1 按计划的解读执行：换用写入前确认不存在的新标签名 `e1-label-absent-<标记>`，预期新建 0 个对象，「1 个 issue」只作漂移上限，「丢弃响应」按封存到本地运行态文件、写下判定后再读执行。
  **Rationale**：主会话据人类伙伴的授权选定。原标签已被 3(b) 建成真实对象，照抄不再等价于原 3(a) 的客户端拒绝路径。
  **Date/Author**：2026-09-29 / 主会话（经人类伙伴授权）
- **Decision**：G2 选 (b) 字面口径。其中 (c)/(d) 需要的额外写入，人类伙伴在随后的提问中明确回答「批准」。原问题是：「#119 按验收字面补齐时，实验 3 的 (c)/(d) 当年只写了『与实验 2 同形』，确切命令无法事后还原，要补就得在私有沙箱里再做一次 3(c) 写入尝试（预期被平台以 422 拒绝、不建对象；两次写入合计建出的对象不超过 1 个私有 issue）。是否批准？」→「批准」。
  **Rationale**：主会话据人类伙伴的授权选 (b)：「已修」条目会被按原条件复核，只补两处会再次挂在同一条验收上。写入预算与互斥按原问题的字面落到 D1 与第 6、10 步的闸门。
  **Date/Author**：2026-09-29 / 主会话（经人类伙伴授权）；写入批准 / 人类伙伴
- **Decision**：字面口径按「四条实验各自第 4 字段里的每一条观测」审计（D0）。能再观测的缺口全部排进同一次运行：两次写入 `(a-rerun)`、`(c-rerun)`，四次只读 `(b-label)`、`(e2-hit)`、`(e4-hit)`、`(d-count)`；不能再观测的登记为残余 ①–④（记录 §3 第 19 条），取代原先只在 G2 = (a) 时才写的第 19 条；是否据此关闭由 G3 决定。
  **Rationale**：主会话选 (b) 的理由正是「按原条件复核」；只补前一版审计的三处，会让 (c) 的另一次调用、(d) 的计数与 `draft-a` 三项再次挂在验收上。残余无法在批准范围内再观测，关闭与否属于人类的判断（`AGENTS.md` §5）。
  **Date/Author**：2026-09-29 / agent（按 G2 修订的独立定稿者）
- **Decision**：协议升到 v2，放在记录 §1；只读步骤排在写入之前；两个写入步骤由运行日志上的闸门把守（未发过、前置成立；`(c-rerun)` 另要求 `a-verdict=absent` 且封存 exit 非 0）；两次写入的正文与原命令逐字相同；对账写全 `START`（第 0 步取定）与两条路径的投影，并把时间窗写进每一行输出。
  **Rationale**：协议覆盖实验 2–4，§1「命令约定」是中性位置；闸门把「一旦 (a-rerun) 已建出对象，3(c) 复测不得执行」从执行者的判断变成可复核的机械条件；时间窗写进输出行，读者不必回头找 `START`。
  **Date/Author**：2026-09-29 / agent
- **Decision**：`(e2-hit)` 在原命令后追加与原块同字段的投影，`(b-label)`、`(e4-hit)` 只追加 `jq -c .`；`(e4-hit)` 同时回读 `draft-a`（用它的实际标题）；`(d-count)` 的时间窗起点取原标记所在分钟的起点 `2026-09-23T03:40:00Z`。
  **Rationale**：投影让回读输出能与原块逐字节比对，也不把作者的额外字段写进发布面；`draft-a` 的回读补上它的存在、标题与 `createdAt`；带原标记的对象不可能早于该分钟。
  **Date/Author**：2026-09-29 / agent
- **Decision**：骨架取自设计 3，嫁接设计 1 的写入前闸门与缺口审计、设计 2 的落点矩阵；被拒绝的方案逐条列在 `Design / Spec`。
  **Rationale**：只有设计 3 给出了「重跑与原分支是否等价」的逐项论证，以及结果不一致时的处置。
  **Date/Author**：2026-09-29 / agent（独立评审定稿）
- **Decision**：补观测是实验 2、3、4 下的子观测，不新开实验 5；标签只用 ASCII 且带连字符。
  **Rationale**：目的、夹具形态、判据都与原观测相同；新开实验会让所有「实验 1–4」计数失真。ASCII 标签避免与 `(b')` 冲突，连字符让守卫的标签正则不误认 `(c)` 这类原有写法。
  **Date/Author**：2026-09-29 / agent
- **Decision**：加墙钟守卫（D3），作用范围与下限由 `WALLCLOCK_STRICT_DOCS` 逐文档声明；Superseded 的解析覆盖整份文档。
  **Rationale**：「规则写进计划只是声明，强制点在能失败的检查里」（`tests/contract/e1-evidence-consistency.test.js:18`）。它检的是一条性质，不复述内容，因此不是 `docs/development/workflow.md:17` 说的镜像测试；base 红、head 绿有判别力。
  **Date/Author**：2026-09-29 / agent
- **Decision**：不把「同形」补写成确切命令；§6 第 1 条的措辞不在本 PR 改。
  **Rationale**：前者违反「不补全」，改为新观测；后者牵连到 §2.1 / §2.2 与裁决 R8 行里「客户端发出前拒绝」的措辞，超出 #119 验收 1 的闭环，登记为技术债务。
  **Date/Author**：2026-09-29 / agent
- **Decision**：协议块在本计划（预注册副本）和记录 §1（执行后的权威）各写一份，由验收第 6 项的 diff 保证逐字一致。
  **Rationale**：预注册需要在写入之前推送到 GitHub，而记录需要自带确切命令。
  **Date/Author**：2026-09-29 / agent
- **Decision**：所有提交只写 `Refs`。只有在六个子观测全部为 R、G3 答复为 (i)、最终验证全绿三条同时成立时，PR 描述才写关闭关键字。
  **Rationale**：提交信息里的关闭关键字进入 `main` 时同样会关 issue；关闭关系要在证据出来之后、并且人类接受残余之后才断言。
  **Date/Author**：2026-09-29 / agent
- **Decision**：PR 用 `kind:docs`，不用 #119 自己的 `kind:test`。
  **Rationale**：分支前缀是 `docs/`，标题类型是 `docs`，policy-check 要求标题与标签一致；PR 的 kind 与 issue 的 kind 不一致并不违反规则。
  **Date/Author**：2026-09-29 / agent
- **Decision**：第 6 步第一次尝试（约 2026-09-29T11:39Z）被执行环境的自动权限分类器拒绝、命令没有执行之后，再试一次第 6 步。人类伙伴在会话中的选择原文：「让 agent 再试一次第 6 步」。
  **Rationale**：被拒的那次没有发出任何请求，运行日志里没有 `a-rerun sent=`，因此不占「各只发一次」的名额；重试仍由第 6 步的闸门按日志把守，发出时三个前置条件都成立。这次重试是在拒绝之后由人类伙伴选择的，不是 agent 自行绕过拒绝。
  **Date/Author**：2026-09-29 / 人类伙伴
- **Decision**：六个子观测的结果类全部为 R。`(a-rerun)`：`a-verdict=absent`（日志第 22 行），拆封原文为 `could not add label: 'e1-label-absent-20260929T1137Z' not found` 与 `exit=1`（第 23–24 行）。`(c-rerun)`：`c-verdict=absent`（第 29 行），拆封原文为 `HTTP/2.0 422 Unprocessable Entity`、错误体含 `"field":"assignees"` 与 `"code":"invalid"`、`exit=1`（第 30、60–61 行）。`(b-label)`：恰好一行 `{"createdAt":"2026-09-23T03:41:55Z","name":"e1-label-that-does-not-exist"}`（第 7 行）。`(e2-hit)`：两行都与原块去掉折行后逐字节相同（V8 = `2`）。`(e4-hit)`：第一行与原块相同（V8 = `1`），`totalCount` 为 9；第二行 `matches` 恰好 1 条，`createdAt` 为 `2026-09-23T03:42:53Z`，两个 id 与记录 §1 夹具表 `draft-a` 行相同（各命中 1 次）。`(d-count)`：`list=[12] search=[12]`，`numbers` 与 `baseline-a` 相同，`new_label_hits=0`（第 17 行）。
  **Rationale**：按 D1 的判定规则与结果类表逐项对照；a-t2、c-t2 距各自 `returned` 70 s、65 s，满足「不少于 60 s」；七轮探针的 `numbers` 全部是 `[12,11,10,9,8,7,6,4,3,2,1]`，没有无关的新编号，所以不是 N。
  **Date/Author**：2026-09-29 / agent（Task B 归类，Batch 4 整合者按日志复核）
- **Decision**：Task C 的派生表述按 Task B 的实际结果重写：人类伙伴已选补观测，六个子观测全部复现，按字面口径补齐；残余 ①–④ 见记录 §3 第 19 条，是否视为满足验收 1 待人类伙伴裁定（G3）；不写「#119 已关闭」。裁决 `:241` 按 D4 字面在加粗标题之后插入「（② 已于 2026-09-29 决定，见该项末尾）」；L1 归档计划 Progress 那一处在 `Superseded` 前补句号；Task C 的两个提交合成一个。记录 §4 第 4 行 `计数 1` 与 `**Superseded` 之间缺分隔，属同一类问题，补一个句号，作为 fixup 并回尚未推送的记录提交。
  **Rationale**：Task C 起草时记录还没有结果，先预写、后收回，两版都与实际结果对不上。读者应当在裁决 §9 的标题处就看到②已经决定；D4 这一插入比「原行是新行前缀」这条机械判据更重要，判据改为 V11，放宽只涉及三行，并且仍能证明原文一字未丢。
  **Date/Author**：2026-09-29 / agent（Batch 4 整合者）
- **Decision**：`WALLCLOCK_STRICT_DOCS` 的下限定为 20。
  **Rationale**：D3 规则三要求回读后定值：最终记录 `grep -c '^时间（墙钟）：'` → `20`（base 8 行加新增 12 行），与 Task A 预设的值相同。
  **Date/Author**：2026-09-29 / agent（Batch 4 整合者）
- **Decision**：Batch 4 不执行 `gh pr ready`，不改关联行：PR 保持 draft，关联行保持 `Refs #119`、`Refs #4`；不写看板字段，不写 issue，不删除工作树、分支或沙箱对象。
  **Rationale**：主会话给 Batch 4 的指令。D5 的三条里「六个子观测全部为 R」「验证全部通过」已经成立，只差 G3；G3 由主会话向人类伙伴发问，答复为 (i) 时由主会话把关联行改为关闭关键字加 `#119`，并回读 `closingIssuesReferences`（期望 `[119]`）。
  **Date/Author**：2026-09-29 / 主会话
- **Decision**：把 PR 分支 rebase 到 `699d715`，用精确 lease 推送；不做 merge commit。
  **Rationale**：`7801d9e` 推送之后 `origin/main` 前进到 `699d715`（#237 合并），PR 回读为 `mergeStateStatus = DIRTY`、`mergeable = CONFLICTING`。冲突只在 `docs/README.md` 的 Completed 表顶部。`main` 要求线性历史与 rebase merge，merge commit 过不了；GitHub 的「更新分支」遇到冲突也做不了。rebase 前建了备份分支，推送用 `--force-with-lease=docs/e1-uncertain-create-wallclock:7801d9e`。预注册提交的内容与作者时间不变（`git range-diff` 标 `=`），「预测早于观测」的外部证据仍是 PR #244 的创建时刻与时间线里的原 SHA。
  **Date/Author**：2026-09-29 / 主会话指令，agent（Batch 4 整合者）执行
- **Decision**：G3 的答复：2026-09-29 Batch 4 归档时**未答复，保持 Refs**。答复由主会话取得后逐字记在本条之下。
  **答复（2026-09-30，人类伙伴在会话中）**：主会话以选择题发问，题干为「#119 验收 1 按字面补齐后，还有四处无法再观测（① 3(c) 不带 --include 的那次调用没写命令；② 实验 4 创建前基线 totalCount=7 没写来源命令；③ draft-a 的创建命令没写；④ draft-a 作废轮询的命令被省略）。②–④ 属于记录自己声明作废、不计入结论的尝试或创建前状态；① 是重复调用，带 --include 的那次已被 (c-rerun) 完整复测。它们已如实登记在记录 §3 第 19 条。怎么定？」；人类伙伴选择「(i) 登记即满足，关闭 #119」。据 D5，六个子观测全部为 R、验证全绿、G3 = (i) 三条同时成立，PR #244 描述的关联行改为关闭关键字加 `#119`。
  **Date/Author**：待人类伙伴

- **Decision（2026-09-30，评审修订）**：将 Superseded 解析集中为 `resolvesSuperseded`，逐一检查同一行的全部括号标签组，首处匹配必须从当前前缀起始，组后残余斜线尾部视为未解析并失败。`Superseded by §2` 等非标签订正保持原语义，自指仍不得充当落点。
  **Rationale**：旧 `line.match` 只检查第一组，后组不存在或语法残缺会被合法第一组豁免；这是同一证据守卫的根因修订，范围不扩大到证据真实性推断。
  **Date/Author**：2026-09-30 / 执行者；人类伙伴本次授权修订并合并 PR #244。
- **Decision（2026-09-30，计时口径）**：Purpose 使用协议的 returned→t2 时间锚。a 的70s、c的65s满足协议；两轮之间实际为54s、57s。保留原始墙钟，修正概括，不重做外部写入。
  **Rationale**：协议与实验数据成立，原概括错误更强；正文修订不能改写证据。
  **Date/Author**：2026-09-30 / 执行者。
- **Decision（2026-09-30，提交粒度）**：六次本地阶段提交及评审修订整理为一个可独立验收、回滚的交付物：补观测记录、对应守卫、派生文档和归档计划。
  **Rationale**：用户要求按独立回滚交付物整理，单独回滚守卫或其记录会使本交付物的验收不闭合；整理前建立完整恢复锚点，最终树逐字相同。
  **Date/Author**：2026-09-30 / 人类伙伴授权，执行者。

## Idempotence and Recovery

- **可以重复执行**：协议第 1–5 步、所有对账轮次（第 7、8、11、12 步）与全部验证命令；契约测试；变异检查（每次都用 `git checkout HEAD --` 还原）。
- **只能执行一次**：第 6、10 步，由闸门按日志拒绝第二次发出。恢复时以运行日志为准：
  - 没有 `a-rerun sent=`：第 6 步从未发出，可以用**同一个标记与 `START`** 继续。
  - 有 `a-rerun sent=` 没有 `a-rerun returned=`：结果未知，**不重试**；跑第 7、8 步对账并归类。此时封存文件没有 `exit=` 行，第 10 步闸门关闭，`(c-rerun)` 为 I。
  - 第 10 步同理：有 `c-rerun sent=` 没有 `returned=` 时不重试，跑第 11、12 步归类。
  - 第二次运行（新标记）需要人类伙伴重新批准。
- **运行态文件**：`.superpowers/e1-l1-rerun/<标记>.log`、`.a.sealed`、`.c.sealed` 位于 PR 工作树之内，已被 git 忽略。Batch 4 之前不要移除这个工作树；跨会话恢复时先读这三个文件。
- **仓库侧**：所有改动都是文档加一条离线测试，`git revert` 即可回到 base。改写历史之前先建备份分支，并用精确 lease 推送（Batch 4）。已知良好状态是 `origin/main`（评审时为 `f6a33d2`，属观察时刻快照；用 `git rev-parse origin/main` 回读）。
- **沙箱侧**：全部为 R 时没有新对象。某个写入子观测为 D 时，产生的对象按沙箱定义 §1、§5 作为 #119 的夹具保留，不删除；整仓拆除由人类伙伴按 §5 执行。
- **临时工作区**：Task A、Task C 的本地分支与工作区（`.worktrees/e1-wallclock-guard`、`.worktrees/e1-wallclock-derived`）在 Batch 4 并入之后保留，清理交给 `git-expert-operations` 流程。Batch 4 另建的两个本地备份分支（`backup/e1-uncertain-create-wallclock-20260929T1159Z`、`backup/e1-uncertain-create-wallclock-pre-fixup-20260929T1206Z`）同样保留，不推送。

## Interfaces and Dependencies

- **工具**：gh（本机 2.101.0，执行时以第 1 步的输出为准）、jq、node（`node --test`）、pnpm（`pnpm verify`）、perl（变异）。协议在 bash 与 zsh 下都能运行。
- **凭据与账号**：gh 活动账号必须是 `$E1_OWNER`（token 需含 `repo` 作用域），由第 1 步与第 6 步闸门机械核对；评审账号不执行任何写入。文档里不出现 token 与响应头。
- **沙箱**：私有仓库 `$E1_OWNER/$E1_REPO` 与 Project A（`$E1_PROJECT_A_ID`）。变量值只在 `docs/architecture/gate-e1-sandbox.md` §2.1。
- **仓库设置**：`main` 分支保护要求线性历史、PR Fast Gate、批准和 rebase merge；milestone 是 `M1 · Gate E1 身份与同步验证`。
- **命名契约**（下游依赖它们）：
  - 子观测标签 `(a-rerun)`、`(b-label)`、`(c-rerun)`、`(d-count)`、`(e2-hit)`、`(e4-hit)`；
  - 豁免写法 `Superseded by (<标签>)[ / (<标签>)…]`；
  - 守卫声明 `WALLCLOCK_STRICT_DOCS`（记录 → 下限）；
  - 标记变量 `E1_L1_RERUN`，唯一赋值处是记录 §1；
  - 协议块首行 `# e1-l1-rerun protocol v2`，末行 `cat "$C_SEALED" | tee -a "$RUNLOG"`；
  - 运行态目录 `.superpowers/e1-l1-rerun/` 与日志行前缀（`phase=`、`<标签> sent=` / `returned=`、`a-verdict=` / `c-verdict=`、`gate-closed`）。
- **对上下游的影响**：记录 §2 两条轴的语义、裁决 §2.6 与 R8 行、L3（#28）的建表输入都不变。全部为 R 时，§2.2 `rejected` 行两类拒绝各多一次复测，§3 第 14 条与 §4 第 4 行的「一次 `422`」各加 Superseded。#4 的采纳（裁决 §9①）不受影响。

## Outcomes & Retrospective

**评审修订（2026-09-30）**：`node --test tests/contract/e1-evidence-consistency.test.js tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js` 在本PR工作树18/18通过；两条旧算法反例已转绿，第三条锁住未受影响语义。归档状态保持Completed，提交整理及最终base/head/CI按本次授权收尾；运行态回执在PR描述与跨PR评审归档。

**结果**（2026-09-29，在检出 `docs/e1-uncertain-create-wallclock` 的工作树根目录复核；标记 `20260929T1137Z`）：六个子观测全部为 R（逐项依据见 `Decision Log`）。沙箱写入发出 2 次，新建对象 0、新建标签 0（外部写入台账）。各步墙钟的出处是记录里各子观测的 `时间（墙钟）：` 行，逐行对照见 D0 最后一列。G3 未答复，PR #244 保持 `Refs #119`。

**验收表逐项**（`Validation and Acceptance`）：

| # | 结果 |
|---|---|
| 1–3 | 满足：`(a-rerun)`、`(c-rerun)` 各 4 行墙钟，`(b-label)`、`(e2-hit)`、`(e4-hit)`、`(d-count)` 各 1 行，都带完整日期；12 处 `Superseded by (` 全部有落点（守卫 6 / 6 pass） |
| 4、6 | 满足：记录 §1 的协议块与本计划的协议块各 112 行，`diff` → `same` |
| 5 | 满足：Batch 2 的日志检查依次为 `1`、`1`、`0`；六轮对账都是 `list=[] search=[] new_label_hits=0`；`d-count` 为 `list=[12] search=[12]`；拆封原文计数 `4`；判定行（第 22、29 行）早于拆封原文（第 23、30 行）；记录里带 `2026-09-29T` 的墙钟行 `12` |
| 7 | 满足：新增原文块 26 行，全部逐行出现在运行日志里（`grep -F -x -f` → `26`） |
| 8 | 满足：V8 输出 `179 291`、`2`、`1`、`1`、`1` |
| 9 | 满足：base 记录上 tests 6 / pass 5 / fail 1，点名 `:289`、`:309`，另报 `行数 8 < 20`；head 上 6 / 6 pass |
| 10 | 满足：m1 前后计数 `1 → 0`、m2 `1`、m3 `4 → 0`、m5 `0`、m6 `1`，五条都 fail 1，还原后 6 / 6 pass；m1 点名 `:418`，m3 点名 `:404`、`:418`、`:756`，m5 点名全部 12 处 Superseded 并报 `行数 0 < 20`，m6 点名 `:286` |
| 11 | 满足（按 V11）：三份文件都打印 `[]`，`mid` 依次为 1、0、2；把裁决 `:241` 删一个字，打印出该原行、exit 1 |
| 12 | 满足：`git grep` 无输出 |
| 13 | 满足：本计划的 id 字面量 `grep` → `0`；e1 守卫 pass |
| 14 | 最终 head 上的 `size`、`disclosure`、`diff --check`、`pnpm verify` 与发布面人工五类检查写在 PR #244 描述的「验证证据」里（易失值，按回读命令复核）；记录里只有一行设计内的 `Date:` 头，没有其它响应头（`Surprises & Discoveries`） |
| 15 | 满足当前期望：G3 未答复，`closingIssuesReferences` 期望 `[]` |
| 16 | 满足：G1、G2 的原话在 `Decision Log`；G3 记为「未答复，保持 Refs」 |

**与计划的偏差**：第 6 步第一次尝试被执行环境拒绝，由人类伙伴选择重试；Task B 的三处执行偏离（`Surprises & Discoveries`）；Task C 的措辞按实际结果重写，两个提交合为一个；裁决 `:241` 按 D4 字面插入标题括号，「原文一字不丢」的判据改为 V11；记录 §4 第 4 行补一个句号；`gh pr ready` 与请求评审不在 Batch 4 执行；`origin/main` 前进后整条分支 rebase 到 `699d715`（`Decision Log`）。

**规模**：代码 76 行（只有守卫）。文档行数是易失值，用 `node scripts/rule-checks.mjs size origin/main` 回读，上限为代码 ≤800、文档 ≤1300；回填之前在 `8d005db`（base `f6a33d2`）上观察到代码 76、文档 983。

**遗留**：G3；残余 ①–④；下面的技术债务；Task A、Task C 的本地分支与工作区，以及两个本地备份分支，清理交给 `git-expert-operations` 流程（`Idempotence and Recovery`）。

### 技术债务（预登记）

- **记录 §6 第 1 条的措辞超出观测**（`docs/architecture/gate-e1-uncertain-create.md:357`）：编号集合只证明没有产生对象，而 gh 解析标签这一步会读平台。§2.1 / §2.2 与裁决 R8 行里的「客户端发出前拒绝」依据的是 gh 的错误原文加编号集合，不是请求日志。**收口条件**：另开 issue 决定措辞，一次改齐四处落点；本 PR 不动。
- **墙钟守卫的覆盖面**：它只覆盖 `时间（墙钟）：` 这种写法，并且只对一份记录生效；表格列和行内时刻不在它的判定范围内。**收口条件**：以后有记录采用这种写法时，加进 `WALLCLOCK_STRICT_DOCS`。
- **残余 ①–④**：记录 §3 第 19 条。**收口条件**：G3 答复 (i)；或人类伙伴收窄验收，或另批重做。
- **#119 的看板 `Status` 与正文复选框**：合并之后由人类伙伴处理，本计划不写。

## Bottom Change Note

- 2026-09-29：首次创建。原因：人类伙伴为 #119 验收 1 选了补观测并批准写入范围；本文件由三份独立设计经独立评审定稿而成，包括：预注册协议、G1 / G2 两道人类闸门、墙钟守卫、派生落点矩阵，以及 Task A/B/C 的并行划分。
- 2026-09-29：按 G1 / G2 的答复修订。G1 按原解读执行；G2 选 (b) 字面口径，3(c) 复测写入获批。改动：新增 D0 字面口径审计；协议升到 v2（移到记录 §1，新增 `(c-rerun)`、`(d-count)`、`(e2-hit)`、`(e4-hit)`，两次写入由日志闸门把守预算与互斥）；结果类逐子观测判定；守卫的下限改为 20，Superseded 解析扩到整份文档；删去只属于 G2 = (a) 的 §3 第 19 条，改为登记不可再观测的残余 ①–④，并新增 G3。
- 2026-09-29：Batch 4 回填并归档。原因：六个子观测全部为 R，Batch 0–4 完成。改动：状态行；D0 最后一列；各批次复选框与未完成项的说明；Batch 3 验证与验收第 11 项加 Superseded，新增 V11（判据放宽只涉及三处按规格的行中插入）；`Progress` 与外部写入台账（含第 6 步第一次被拒的尝试）；`Surprises & Discoveries`；`Decision Log`（第 6 步重试、结果类、派生措辞、守卫下限、不执行 `gh pr ready`、G3 未答复）；`Outcomes & Retrospective`；`Idempotence and Recovery` 补上备份分支。文件移到 `docs/exec-plan/completed/`。
- 2026-09-29：rebase 到 `699d715` 之后订正本文件里的提交 SHA、推送方式与 README 行号的写法，并在 `Decision Log` 记下 rebase。原因：`origin/main` 前进，PR 与 `main` 在 `docs/README.md` 冲突。

- 2026-09-30：评审后修订标签守卫并补旧红新绿回归；计时概括对齐协议；记录用户整理并rebase merge的授权及恢复锚点要求。原始观测、协议和G3采纳范围保持不变。

- 2026-09-30：#238已合并后restack到实际main，守卫与观测正文同整理前的版本逐字相同；当前最小验收计数更新为12，负对照锁定修订前base的2f9e0ee，避免归档后origin/main移动使反例失去判别力。历史批次计数保留为历史快照。
