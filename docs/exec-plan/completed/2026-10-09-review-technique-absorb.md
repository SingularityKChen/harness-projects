# 评审变异夹具、评审约定与评审记录的吸收 ExecPlan

## Purpose / Big Picture

完成后，任何评审者（人或 agent）在一个干净 clone 里就能拿到下面这些，而不依赖某个会话的私有记忆：

1. `scripts/review-mutate.mjs`——变异夹具：没施加不算存活、按字节还原（含不是合法 UTF-8 的文件）、红错原因单列、中断与未捕获异常时都同步还原文件、中断时不留孤儿进程；由 `tests/contract/review-mutation-harness.test.js` 固定；
2. `docs/review/mvp-review.md` 的本仓库约定：变异表（§2）、结论到 review 事件的映射（§3）、单 PR 记录位置（§4）、账号 / owner / 按 PR 逐个的合并授权 / 不阻塞的红检查（§5）；
3. #268–#295 两个批次的评审记录。

评审技法要不要写成 skill，本计划只交付一次有范围的对照观察（Design / Spec），决定留在 issue #298。

判断成功的最小证据：夹具契约测试全绿；夹具对自己的变异表在最终树上全部 KILLED；`content-placement` 契约测试全绿。

## Context and Orientation

- `docs/development/content-placement.md` §4 把「提交 PR / 处理评审」判为「技法、约定」两桶，处置写的是「技法部分进 skill（后续批次）」；§6 预留了 `reviewing-a-delivery-pr`。`main@78c3eb5b` 上 `.agents/skills/` 不存在。
- #286–#295 这一批里，每个 PR 都临时重写了一份变异脚本（8 份，各自重新实现锚点计数与还原），评审结束即被丢弃。
- #286、#288 的单 PR 记录，#268 / #269 第二轮的批次记录（只在一个从未开 PR 的本地分支 `docs/review-pr268-pr269` 上），以及 #268–#270 第一轮的两份记录，都只在本地 worktree 里。#290–#293 的单 PR 记录 main 上已有更完整的版本，不在本计划范围。
- 这一轮反复用到的教训只写在会话的私有记忆里。
- 工作项：issue #298（本计划交付其中的夹具、约定与记录；skill 一项不交付，PR 用 `Refs #298`）。

## Design / Spec

按 `content-placement.md` §2 的四桶顺序逐段归属：

| 内容 | 桶 | 落点 |
|---|---|---|
| 变异纪律里可判定的部分（锚点恰好一次、施加后确认变化、按字节还原、红的原因、中断还原） | 机械 | `scripts/review-mutate.mjs` + `tests/contract/review-mutation-harness.test.js` |
| 并集预演、三处对照、栈底事实、实测范围、按原条件复评、整合与关闭关键字、时区判别 | 技法 | 本计划只做 RED 观察（下文），skill 留在 #298 |
| 严重度、矩阵分层、变异表、账号、记录位置、owner、合并授权、本仓库 CI 的红检查判定 | 约定 | `docs/review/mvp-review.md` |
| 本批次与 #268–#270 发生过的事 | 一次性 | `docs/review/` 记录 + 本计划 |

### 技法 skill 的 RED 观察

`superpowers:writing-skills` 的规则：先看 agent 在没有 skill 时失败，再只写针对这些失败的内容；对照不失败就没有东西可修。八个场景都是一次性 git 仓库，任务文字只描述要做的事，不提示陷阱。对照的确切条件：

- 同一模型（Claude Opus 5.5）的非交互 `claude -p`，工作目录在夹具内；该项目没有记忆目录，探针确认没有加载记忆；
- **没有** `reviewing-a-delivery-pr`，但**可以**使用用户级技能库，其中有通用的代码评审、接收评审、验证类技能，以及 First Principles Development 与 Qian Systems Router；
- 每个场景一次运行、单一聚焦任务，没有叠加多重压力；
- 场景生成脚本与提示词附在 issue #298 的评论里，可以重建。

| 场景 | 陷阱 | 对照结果 |
|---|---|---|
| S1 变异 | 修复未提交（脏工作树）；一个锚点的空格写错；一个变异只被旧用例杀死 | 识别锚点不匹配、M3 归因到旧用例、按哈希确认还原。中途被本机 `cp -i` 别名卡住、变异叠加，自己发现后重跑 |
| S2 兄弟 PR | 另一个 PR 改了函数签名，本 PR 的 JS 测试按旧签名调用；作者「一起测过」只覆盖子集 | 并集预演，定为阻塞 |
| S3 复评 | P1 只修了原反例（`.worktrees -> ../planted`），指向仓库内的符号链接仍被接受 | 按原条件测 `-> .git`、`-> src` |
| S4 栈底 | 栈底计划写「上层已交付」与一项任何层都没实现的决策 | 只合并栈底时 main 断言了不存在的文件 |
| S5 整合 | main 期间改过索引文件；任务要求在正文里叙述「关闭改为引用」 | 保留 main 的索引行、正文不带关闭关键字加编号、双向比对文件。中途被 zsh 不拆分变量卡住一次，自行改用 bash |
| S6 时区 | CI 跑 UTC，作者的两次手工 `TZ=` 运行被称为门禁 | 三个时区的漂移变异，指出正偏移漏洞 |
| S7 范围外 PR | 并集失败出在待合并、但不在评审范围内的 PR 上 | 枚举全部组合 |
| S8 「只确认回归用例」 | 原意见是「夹到 1..100」，修复只做了上界 | 下界、非数字输入 |

观察：在上述条件下八个场景都没有失败；唯一反复出现的失误是本机 shell 环境（`cp -i`、zsh 不拆分变量），不是评审技法，其中影响变异还原的那一类由夹具消除。**范围**：没有测其他 agent（#286–#289 的作者是另一种 agent 的会话）、没有测长会话与多 PR 并行的负载（2026-09 的真实漏判都发生在那种负载下）、没有叠加压力。所以本计划不建 skill，也不宣称 skill 不需要；#298 保持打开，由人类伙伴决定是否按更强的对照继续。

### 夹具的设计决定

- **按字节还原，不依赖 git**：施加前把原文按字节读进内存，查找与替换在 latin1 映射的字节串上做（锚点与替换文本先按 UTF-8 编码），跑完写回并用 `Buffer.equals` 比对。工作树里有未提交的修复、文件不是合法 UTF-8 都安全。这是 2026-09-26、2026-10-02、2026-10-07 三次「`git checkout --` 连修复一起抹掉」与 S1 里 `cp -i` 让还原静默失败的直接对策。
- **锚点出现次数按重叠计**；NOT_APPLIED 与 SURVIVED 分开，退出码都非 0；**KILLED_OTHER** 由非空的 `killedBy` 判定，解析 spec 与 TAP 两种失败行。
- **先校验后运行**：spec 不合法、任何目标文件不存在、不是普通文件或解析到 `--root` 之外（含符号链接），在跑基线之前就报夹具错误（退出码 2）；基线或还原后基线不绿也是夹具错误。命令按 argv 执行，不经 shell。
- **中断**：命令以独立进程组启动（`detached`），进程组号单独保存，命令自己先退出也不清空。SIGINT / SIGTERM / SIGHUP 时信号处理里同步还原，把信号转给整个进程组，并在中断状态下以子进程 `exit` 而不是 stdio `close` 收尾、关闭子进程管道（孙进程可能还握着管道）；中断收尾时 SIGKILL 进程组里剩下的进程，不留孤儿；命令不理会信号时，第二次信号 SIGKILL 整组并立即以 130 退出。基线运行期间被中断同样以 130 收尾。
- **未捕获异常**：例如输出接到提前关闭的管道时 stdout 的 EPIPE，会绕过 `finally` 与信号处理；`exit` 钩子同步还原正在施加的变异。
- 子进程环境删掉 `NODE_TEST_CONTEXT`（Surprises 1）。

放弃的方案：

- **夹具放进 skill 目录**：第一版这样放，前提是有技法 skill；RED 观察后不建 skill，夹具是机械桶，按 §2 归 `scripts/`。
- **把 8 份临时脚本整理后收进来**：它们硬编码了各 PR 的路径与锚点，通用的只有锚点计数与还原那十几行，已经被夹具吸收。
- **用 utf8 字符串比较还原结果**：第一轮评审证明它会把非 UTF-8 字节静默改成 U+FFFD 而报 KILLED。
- **把场景生成脚本收进仓库**：它们是 #298 未决那一项的测试材料，附在 #298 的评论里，跟着那项决定走。

## Global Constraints

本计划改动的文件集合只在这里声明一次：

- 新增：`scripts/review-mutate.mjs`、`tests/contract/review-mutation-harness.test.js`、`tests/contract/fixtures/review-mutate-self.json`、`docs/review/2026-10-07-pr268-pr269-mvp-review.md`、`docs/review/2026-10-09-pr286-pr295-mmp-review.md`、`docs/review/pr-268-270-cross-review.md`、`docs/review/pr-269-mmp-review.md`、`docs/review/pr-286-mmp-review.md`、`docs/review/pr-288-mmp-review.md`、`docs/review/pr-300-mmp-review.md`、本计划；
- 修改：`docs/review/mvp-review.md`、`docs/review/README.md`、`docs/development/content-placement.md`、`docs/README.md`。

硬约束：不改 `packages/`；不加依赖，夹具只用 Node 内置模块（版本见 `.nvmrc`）；文档不写本机绝对路径与本机身份；规模 ≤ 1000 代码 / ≤ 1500 文档（规划上限 800 代码）。

## Plan of Work

单批次，最小闭环是「夹具 + 约定 + 记录」一起落地：夹具没有约定里的那一段，评审者不知道用它；约定没有夹具，变异纪律仍是散文。

步骤：

1. 写夹具与契约测试，先跑契约测试，再用夹具变异自己（`tests/contract/fixtures/review-mutate-self.json`）证明契约测试有牙；
2. 技法 skill 的 RED 观察（Design / Spec）；
3. 改 `mvp-review.md`（§2 变异表、§3 结论映射、§4 单 PR 记录位置、新增 §5）与 `content-placement.md` §4 / §6；
4. 补录记录，在 `docs/review/README.md` §8 登记两个批次记录；
5. 按评审修订、复评；整合成两个提交：先补录记录（`docs/review/` 记录与 §8 索引），后夹具、约定与本计划——后者引用的记录在前者里已经存在，每个提交单独导出都能通过契约测试。

验证命令（在检出 `docs/review-technique-absorb` 的工作树根目录运行）：

    node --test tests/contract/review-mutation-harness.test.js
    # 期望：tests 13，pass 13，fail 0
    node scripts/review-mutate.mjs tests/contract/fixtures/review-mutate-self.json
    # 期望：SUMMARY 里 H1–H30 全部 "KILLED"，退出码 0；结束后 git status 不显示 scripts/review-mutate.mjs 被改
    node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js
    # 期望：fail 0
    pnpm verify
    # 期望：exit 0
    node scripts/rule-checks.mjs disclosure origin/main && node scripts/rule-checks.mjs size origin/main && git diff --check origin/main...HEAD
    # 期望：三条都 exit 0

回滚点：revert 本 PR 的两个提交；夹具没有任何运行时调用方。

## Validation and Acceptance

| issue #298 的验收 | 本计划 |
|---|---|
| skill 名按 `content-placement.md` §6，不与全局技能同名 | 未交付，留在 #298（RED 观察没有失败，范围有限）；§6 保留预留名并写明建立时先跑对照 |
| 夹具从不把没施加的变异计为存活，并逐字节还原，由契约测试证明 | 契约测试 13 条（含重叠锚点、非 UTF-8 的施加与还原、14 种不合法 spec、包装进程下三种信号与不理会信号的命令、脱离进程组的孙进程、基线期间中断、输出管道提前关闭）；自变异 H1–H30 全部 KILLED |
| 同一条断言不同时出现在 skill 与 `docs/review` | 未交付（没有 skill）；夹具契约只在脚本文件头，`mvp-review.md` §2 只写约定并指向文件头 |
| content-placement、plan-facts 与夹具测试通过 | 上文验证命令 |

## Progress

- [x] 2026-10-09：夹具与契约测试；第一次自变异表 H10 存活，补测试后 10 / 10 KILLED。
- [x] 2026-10-09：技法 skill 的 RED 观察——先写的未测草稿按 writing-skills 删除；八个场景在上述条件下都没有失败，不建 skill；夹具从 skill 目录移到 `scripts/`。
- [x] 2026-10-09：`mvp-review.md` §2–§5；`content-placement.md` §4 / §6；补录记录与 §8 索引。
- [x] 2026-10-09：开 PR #300；第一轮评审（Singularity-AI-Bot，REQUEST_CHANGES：1 × P1、4 × P2、10 × P3），主控复现 P1 与三条行为 P2；全部修订（见 `docs/review/pr-300-mmp-review.md`）；自变异表扩到 21 条。
- [x] 2026-10-09：第二轮复评（APPROVE：1 × P2、7 × P3），主控复现 P2（EPIPE 让文件停在变异状态）；全部修订，契约测试扩到 13 条，自变异表扩到 30 条并在最终树上全部 KILLED。
- [x] 2026-10-09：第三轮复评（APPROVE：2 × P3，均可延后）：「不留孤儿进程」的表述收窄到中断路径；崩溃路径的进程组收尾与退出码、三处用例缺口转入 #302。
- [x] 2026-10-09：合并（结果与 PR 状态以 `gh pr view 300 -R SingularityKChen/harness-projects --json state,reviews` 回读为准）。

## Surprises & Discoveries

1. **嵌套 `node --test` 会改变孙进程的输出格式**：契约测试本身跑在 `node --test` 下，环境里带 `NODE_TEST_CONTEXT`；夹具若原样传给它启动的 `node --test`，孙进程改用父 runner 的序列化输出，失败用例名就解析不到。自变异 H2（保留该变量）被契约测试杀死。
2. **第一次自变异表里 H10 存活**：「只有 NOT_APPLIED 时退出码仍非 0」没有用例覆盖。补了「一个 KILLED 加一个 NOT_APPLIED」的用例。
3. **夹具当场抓到了 spec 里写错的 `killedBy`**：补用例后 H10 报 KILLED_OTHER——被新用例杀死，不是 spec 里写的那条。改正后为 KILLED。
4. **`content-placement` 契约测试把归属表里反引号包住的裸文件名当路径核对存在性**：处置列第一次写了 `` `responding.md` ``，改为仓库相对路径。
5. **用本会话的子 agent 做对照是被污染的**：五个场景的子 agent 全部通过，但五个都报告上下文里预载了用户的记忆索引。改用夹具目录里的 `claude -p`。
6. **第一轮评审指出对照并非「不带 skill」**：用户级技能库对 `claude -p` 可用；且对照是单模型、单一压力，与 writing-skills 对纪律类 skill 的要求有差距。文档里「无 skill 对照全部通过」的说法改成有范围的观察，skill 一项留在 #298。
7. **按 utf8 字符串还原会静默改写非 UTF-8 字节**（第一轮 P2）：报 KILLED、退出 0，而文件哈希变了。改为按字节。
8. **包装进程下中断还原被孙进程拖住**（第一轮 P2）：只杀直接子进程、等 stdio `close`，`sh -c` 下的孙进程握着管道，还原要等它自己退出。改为进程组 + 信号处理里同步还原。
9. **两个紧挨着的同种信号会被合并**：自变异 H20（去掉信号处理里的同步还原）起初存活——连发两次 SIGINT 只被处理一次，整组结束后 `finally` 照常还原。改用不理会信号的命令：第一次信号后命令还活着、夹具还在等，文件必须已经还原；由此也补上了第二次信号 SIGKILL 整组的升级路径。
10. **自变异表本身也会过期**：夹具重写后 H3（第一轮修订）与 H14（第二轮修订）的锚点不再存在，夹具如实报 NOT_APPLIED 而不是存活——正是它要防的那类错误，换到了它自己身上。
11. **把输出接到 `| head` 会让夹具在变异施加期间崩溃**（第二轮 P2）：macOS 上写管道是异步的，EPIPE 以未捕获异常的形式在下一个变异施加后触发，绕过 `finally` 与信号处理，文件停在变异状态而整条管道退出 0；第一轮的 head 上同样存在，第一轮评审没有抓到。
12. **自变异表也会把被测夹具变成挂死的进程**：去掉空锚点校验的 H29 让被测夹具在计数里死循环，而校验用例超时后没有结束它，整个自变异运行挂了二十分钟；改成超时即 SIGKILL。挂住的那次运行被我用两次 SIGINT 收掉：第一次信号同步还原了被变异的夹具并转发信号，死循环的孙进程收不到 JS 信号处理，第二次信号 SIGKILL 整组——正是本轮新加的升级路径，在真实场景里用上了。
13. **去掉中断后关闭子进程管道的 H24 起初存活**：进程组 SIGKILL 已经让管道关掉，这段代码只在孙进程脱离进程组（自己 `setsid` / `detached`）时承重；补了这个场景的用例后 H24 被杀死。

## Decision Log

| 日期 | 决策 | Rationale | 作者 |
|---|---|---|---|
| 2026-10-09 | 执行本计划 | 人类伙伴原话：「清理本地 worktree、过时的临时文件、本地和 remote branch。此外注意吸收评审时候有用的脚步、经验教训等等内容到仓库。」 | 人类伙伴 |
| 2026-10-09 | 建 skill 按 `superpowers:writing-skills` 的 TDD 流程；已先写好的未测草稿按其「Iron Law」删除重来 | 人类伙伴原话：「涉及到创建 skills，使用 /superpowers:writing-skills」 | 人类伙伴 |
| 2026-10-09 | 本计划不建技法 skill，skill 一项留在 #298 | RED 观察在所述条件下没有失败可修；但条件有限（Surprises 6），不足以宣称不需要 | Claude |
| 2026-10-09 | PR 用 `Refs #298`，不用 `Closes` | 第一轮 P1：#298 的 skill 一项与两条验收未交付，提交正文里的关闭关键字会在合并时关闭它 | Claude |
| 2026-10-09 | 夹具放 `scripts/`，自变异 spec 放 `tests/contract/fixtures/` | 夹具是机械桶（`content-placement.md` §2 第 1 问） | Claude |
| 2026-10-09 | 不补录 #290–#293 的评审时版本 | main 上已有合并时更完整的版本 | Claude |
| 2026-10-09 | 单 PR 记录不进 §8 索引，只登记两个批次记录 | `docs/review/README.md` §8 的既有判据 | Claude |
| 2026-10-09 | rebase merge #300 与 #301 | 人类伙伴原话：「评审并 rebase merge #300、#301」；以评审通过为前提 | 人类伙伴 |

## Idempotence and Recovery

- 夹具可重复运行：每次都从磁盘按字节读原文、跑完写回并比对；中断也会还原。若进程被 `SIGKILL` 强杀（无法拦截），用 `git diff` 查看被变异的文件并 `git checkout -- <file>` 还原——只在该文件没有未提交修改时这样做；有未提交修改时先把修复做成 WIP 提交再跑变异。
- 契约测试只在系统临时目录里建夹具，结束即删除。
- 文档与记录可直接 revert。

## Interfaces and Dependencies

- Node 内置 `node:child_process`、`node:fs`、`node:path`；进程组与信号依赖 POSIX（`process.kill(-pid)`），失败时退回只结束直接子进程。失败用例名的解析依赖 `node --test` 的 spec 报告器格式（`✖ 名字 (时长)`）或 TAP（`not ok N - 名字`）。
- RED 观察用本机的 Claude Code CLI（`claude -p`）；不进仓库、不进 CI。
- 开 PR 与回读用开发账号的 `gh`，评审与批准用评审账号。

## Outcomes & Retrospective

- 结果：Purpose 的三项落地；夹具契约测试 13 条全绿，自变异表 30 / 30 KILLED，`content-placement` 6 / 6；`pnpm verify` 与 disclosure、size、diff-check 的结果写在 PR 描述的验证证据里（以 PR 当前 head 为准）。
- 规模：代码 935 / 1000、文档 808 / 1500（`node scripts/rule-checks.mjs size origin/main` 回读，以 PR 当前 head 为准）。代码超过 800 的规划上限，增量来自两轮评审要求的判别力用例（契约测试 5 → 13 条）与自变异表（30 条，JSON 约 250 行）；没有拆分，因为夹具与固定它的测试必须一起回滚。
- 与计划的偏差：起初要建技法 skill 并把夹具放进 skill 目录；按 writing-skills 的 RED 观察改为不建 skill、夹具归 `scripts/`；第一轮评审后又把「不需要 skill」收窄为有范围的观察，#298 保持打开。
- 技术债务：不新增登记。夹具崩溃路径不结束命令进程组、退出码为 1，以及还原后基线中断等三处用例缺口，由 #302 承接（第三轮复评的两条 P3）。#298 的 skill 一项待人类伙伴决定是否按更强的对照（其他 agent、长会话多 PR 负载、叠加压力）继续；#289 上观察到一次的 Verify 失败只在批次记录里记录，再次出现时开 issue。

## Bottom Change Note

- 2026-10-09：创建；同一批次内按 writing-skills 的 RED 观察改为不建技法 skill、夹具移到 `scripts/`；第一轮评审后改用 `Refs #298`、修正对照描述、按字节还原与中断还原，并把自变异表扩到 21 条；第二轮复评后补 `exit` 钩子、进程组收尾、基线期间中断与 spec 校验用例，自变异表扩到 30 条。
