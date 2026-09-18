# 规则语义收敛与检查器加固 ExecPlan

> 状态：Active
> 创建：2026-09-18
> 范围：把 2026-09-18 MVP 交付评审留下的 9 个 issue（#38 #39 #40 #41 #45 #46 #47 #48 #55）收敛掉。分成 5 个各自可独立验收、合并、回滚的 PR。不写 `packages/` 下任何实现代码。
> 控制文档：本文件是这 5 个 PR 的唯一 ExecPlan。合并顺序见 `Interfaces and Dependencies`。

## Purpose / Big Picture

完成后，下面三句话各自从「读文档推断」变成「跑命令判定」：

1. **看板上哪个字段是规划、哪个是工程，由谁写** —— 现在同一个字段有三个互不相容的定义，其中两个在同一份文件里；
2. **一条违规的 workflow / issue / 发布面内容会不会被拦住** —— 现在四个检查器共有约 20 种可复现的绕过形态；
3. **一个没有上下文的人能不能把评审队列合完、能不能判断 agent 刚写的那条依赖边算不算有效**。

最小成功证据：

```bash
# 1) Status 的定义在仓库里唯一
grep -rn '开发做完没' docs/ | wc -l          # 期望：0（该表述已被替换）
test -f docs/product/board-semantics.md && echo OK

# 2) 四个检查器对评审列出的每一种绕过形态都有一条注入用例
pnpm verify                                   # 期望：tests 数显著上升，fail 0

# 3) 合并顺序与 agent 写入边界有长期载体
test -f docs/project-management/merge-queue.md && echo OK
grep -q 'agent 可以写' AGENTS.md && echo OK
```

## Context and Orientation

### 术语

| 词 | 在本文件里的意思 |
|---|---|
| **规划轴** | 回答「规划所有者是否**接受**这个工作项完成」——人拥有 |
| **工程轴** | 回答「代码/CI/PR 走到哪一步」——由工程事件驱动 |
| **假绿（false green）** | 输入违反规则，而检查器报告无 finding |
| **有牙（有牙的测试）** | 把实现改坏之后该测试会变红；变异测试证明之 |
| **能力闭环** | 一个 PR 结束后有确切命令从「未知/失败」变成「通过」，且撤销范围等于该 PR 的 diff |

### 开工时（2026-09-18）的仓库事实

- `main` = `8149095`；`pnpm verify` → `tests 43 / pass 43 / fail 0`。
- 四个检查器脚本：`workflow-check.mjs` 210 行、`policy-check.mjs` 288 行、`rule-checks.mjs` 179 行；对应测试 175 / 108 / 125 行。
- `docs/product/` 只有一个占位 README，其中「目标与非目标」写的是「尚未补齐」。
- `docs/project-management/README.md` 存在（#11 引入），但没有合并顺序表。
- 看板内置工作流实测：`Item added to project` / `Item reopened` / `Auto-add sub-issues to project` 开启；`Item closed` 与另外四条写 `Status` 的已关闭。
- 仓库 secret 只有 `DSH_GITHUB_WEBHOOK_SECRET`；**`PROJECTS_TOKEN` 不存在**。

### 为什么这 9 个 issue 是一件事

表面是两组无关工作，实际是一条单向因果链：检查器在机械执行 `AGENTS.md` 的规则文本，而看板组揭示的是**那段文本本身自相矛盾或无所指**。先加固一个规则含义未定的检查器，等于把歧义变成承重结构。

```text
#55（Status 是什么）── 根
  ├─→ #45 检查清单是四条还是五条
  ├─→ #47「规划状态」指什么，才能说 agent 能写什么
  └─→ #48 三条轴的职责分离
#38 #39 #40 #41 ── 与 #55 无关：W1–W6 / §8.7 / §8.6 / §8.3 的规则文本无歧义，纯代码正确性
```

## Design / Spec

### D1. `Status` 是规划轴，人拥有

**决定**（人类伙伴 2026-09-18 裁决）：`Status` 回答「规划所有者是否接受这个工作项完成」，属于**规划轴**，由人拥有。

**推导依据**，而不是偏好：

1. `Status` 是 Planning provider（GitHub Projects）的原生字段。不变量 3 要求规划与工程正交，因此规划轴必须在看板上有落脚点；如果 `Status` 是工程轴，看板上就没有任何字段承担规划，而 Planning 正是本产品要卖的能力域。
2. 人类伙伴已经关掉 `Item closed`。在「`Status` = 工程事实」的读法下那条工作流是**正确**的、不该关——这个动作本身证伪了读法 A。

**因此要改三处现有表述**（它们都在 `docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md`）：

| 位置 | 现在 | 改成 |
|---|---|---|
| `:43` 术语表 | 「回答**开发做完没**」 | 「回答规划所有者是否**接受**该工作项完成」 |
| `:100` D2 表 | 「开发做完没 \| **由执行过程驱动**」 | 「是否被接受为完成 \| 由**人**写」 |
| `:158` D4 表 `Item closed` 行 | 「建议开启」+ 理由「关闭 issue 是人做出的规划动作」 | 「**不开启**」+ 理由改为可证伪的形式 |

D4 的原理由不成立，原因要写清楚：**issue 不是人关的，是 PR 合并关的**。§8.2 强制提交信息写 `Closes #N`，2026-09-18 合并 8 个 PR 时实测到 8 次自动写入（`#14 #15 #16 #17 #18 #20 #32 #34` 全部被写成 `Done`，无人参与、无 actor 痕迹）。

对「`Closes #N` 是人写的，所以 closure 也算人的规划动作」这个最强辩护，回答要进文档：人写 `Closes #N` 声明的是「这个 PR 完成了 issue N 描述的**工作**」——一个关于代码的工程陈述；规划 `Done` 是另一个断言「规划所有者**接受**」。两者大多数时候重合，这正是混为一谈很诱人、也正是本产品存在的理由。而且 `Closes #N` 由 PR 作者写，多人团队里常常不是规划所有者。

### D2. 九条内置工作流从定义推导，不再逐条裁决

D1 一旦成立，D4 那张表就不该是九次独立判断，而应当是一条规则的九次求值：

> **一条内置工作流可以开启，当且仅当它写的字段属于它的触发事件所在的那条轴。**

| 工作流 | 写什么 | 触发事件属于 | 裁决 |
|---|---|---|---|
| `Item added to project` → `Status = Todo` | 规划 | 人把条目上板 = 规划动作 | **开启** |
| `Item closed` → `Status = Done` | 规划 | issue 关闭，常由 `Closes #N` 自动触发 = 工程 | **关闭** |
| `Item reopened` → `Status` | 规划 | issue 重开，同样可由工程事件触发 | **关闭** |
| `Pull request linked to issue` | 规划 | 工程 | **关闭** |
| `Code review approved` | 规划 | 工程 | **关闭** |
| `Code changes requested` | 规划 | 工程 | **关闭** |
| `Pull request merged` | 规划 | 工程 | **关闭** |
| `Auto-close issue`（`Status = Done` 时关 issue） | 反向写 issue 状态 | 与 `Item closed` 构成回环 | **关闭** |
| `Auto-add sub-issues to project` | 不写 `Status` | —— | **开启** |

于是「必须保持关闭」的清单是 **六条**，不是评审里估的四条或五条。这个数字**由规则推导得出**，这正是 D2 要达到的效果：换一个内置工作流进来，不需要重新裁决，套规则即可。

### D3. `Size` 是人的信号，不是控制——如实写明

#48 给了两条路：让 `rule-checks size` 去读看板的 `Size` 字段做「实际 vs 申报」对比；或者如实承认它是人的信号。

**选后者**，理由：前者需要 `PROJECTS_TOKEN`（看板是 user-level project），会把一个当前**离线、必需**的检查变成**需要凭据、只能 advisory** 的检查——为了一个申报值的对比，降低一条已经生效的规则的门禁级别，不划算。§9.2 的判定准则也指向这个方向。

因此在 D3 的表述里去掉「PR 体量约束从评审时前移到规划时」这个闭环声明，改成：`Size` 是规划时的**人工信号**（帮助判断该不该先拆），`rule-checks size` 是评审时的**机械度量**，两者不连通，且这是有意的。

### D4. #45 只做可离线判定的一半

`projectV2.workflows` 是 user-level project 的数据，`GITHUB_TOKEN` 读不了，必须 `PROJECTS_TOKEN`——实测该 secret 不存在。因此把 #45 切成两半：

- **本轮交付**：纯函数 `boardWorkflowFindings(workflows, mustBeDisabled)` + 契约测试。输入是工作流清单与必须关闭的清单，输出是违规项。清单内容由 D2 推导得出（六条）。离线、进 `pnpm verify`、现在就能验收。
- **留给 #37**：调用它的 workflow（需要 PAT）。#37 本来就是引入 `PROJECTS_TOKEN` 的那个 PR。

#45 保持 open，把范围收窄写进 issue。这不是「摊薄一个风险」——可判定的那一半与需要凭据的那一半是**两个不同的风险**（判定逻辑对不对 / 凭据与权限配得对不对）。

### D5. 检查器三个 PR 按文件切，不按 issue 切

#38（`workflow-check.mjs`）、#39（`policy-check.mjs`）、#40+#41（`rule-checks.mjs`）分成三个 PR。判据是 §5.1 第 3 条：批内不包含两个可以分别验收的风险。三个脚本是三份独立的判定逻辑，合并之后一次红测无法定位是哪个风险坏了。

#40 与 #41 同一个文件（`rule-checks.mjs` 的两个子命令），合并成一个 PR：它们共享 diff 解析与 `git` 调用这两处基础设施，分开会让第二个 PR 大半是解第一个的冲突。

### D6. 每个修复必须先有一条会红的注入用例

所有四个检查器 PR 统一采用同一条验收形式（§6.2 的 TDD 要求）：

1. 为每一种绕过形态写一条注入用例，**先确认它在修复前是红的**；
2. 修复；
3. 用变异测试证明该用例有牙——把修复改坏，该用例必须变红。

「修复前红 → 修复后绿 → 变异后再红」这三步的输出都要记进 `Progress`。只写「已修复」不算验收。

## Global Constraints

- 不改 `packages/` 与 `apps/` 下任何文件；本轮不碰产品代码。
- 每个 PR 独立满足 §8.3 第 2 条：代码 ≤ 1000 行、文档 ≤ 1500 行。
- 进入 `pnpm verify` 的检查必须离线、无凭据（§1.4、§9.3）。需要网络或 token 的判定只能做 advisory（§9.2）。
- 检查器的错误路径一律 fail-closed；内部错误与规则违规必须用不同 exit code 区分（内部错误取 3）。
- 不引入新的运行时依赖；`yaml` 是唯一已有的 devDependency。
- 每个 PR 的描述里给出本文件路径与批次名（§8.3 第 6 条），并 link 它交付的 issue（§8.3 第 7 条）。

## Plan of Work

### Batch A · 看板语义定义（PR-A，`docs/board-planning-semantics`）
**最小闭环**：`Status` 在仓库里只有一个定义，九条内置工作流的裁决可从它推导。
**涉及文件**：`docs/product/board-semantics.md`（新建）、`docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md`（改三处）、`docs/README.md`（索引行）、`scripts/board-workflow-check.mjs`（新建，D4 的纯函数）、`tests/contract/board-workflow.test.js`（新建）
**交付**：Closes #55、Closes #48；Refs #45（范围收窄）
- [ ] `docs/product/board-semantics.md`：规划轴/工程轴的定义、谁写、不变量 3 在看板上如何满足、D2 的推导规则与九行裁决表、对 `Closes #N` 辩护的回答
- [ ] 改 `delivery-planning-and-board.md` 的三处表述（术语表、D2 表、D4 表）
- [ ] D3：把 `Size` 改写成「人的信号」，去掉「前移到规划时」的闭环声明
- [ ] `boardWorkflowFindings()` 纯函数 + 契约测试（含「六条清单由规则推导」的断言）
- [ ] `docs/README.md` 加 `docs/product/` 主题文档索引行
**验证**：`grep -rn '开发做完没' docs/` 输出为空；`pnpm verify` 全绿；契约测试断言六条清单

### Batch B · 过程记录（PR-B，`docs/process-records`）
**最小闭环**：合并队列与 agent 写入边界各有长期载体，读完能给出确定答案。
**涉及文件**：`docs/project-management/merge-queue.md`（新建）、`AGENTS.md` §10（增补）、`docs/project-management/README.md`（索引行）
**交付**：Closes #46、Closes #47
- [ ] `merge-queue.md`：队列表（位置 / 依赖 / 已知解冲突点与解法）+ 2026-09-18 那轮的实测结果 + 结构性教训（「无冲突」声明必须对声明位置之前的**所有** PR 预演）
- [ ] `AGENTS.md` §10 增补：§10 那条 LLM 约束的**适用范围**是产品运行时控制路径；本仓库自身项目管理上 agent 可作为人的代理做哪些确定性写入；哪些必须人批准（至少 `Status` 取值与 `blocked-by` 边）；批准怎么留痕
- [ ] `docs/project-management/README.md` 加索引行
**验证**：读完 §10 增补能对「agent 刚写的这条 `blocked-by` 边算不算有效」给出确定答案；`pnpm verify` 全绿

### Batch C · workflow-check 假绿收敛（PR-C，`fix/workflow-check-false-greens`）
**最小闭环**：评审列出的每一种 W1–W6 绕过形态都有一条注入用例，且修复前先红。
**涉及文件**：`scripts/workflow-check.mjs`、`tests/contract/workflow-check.test.js`、`AGENTS.md` §9.5（规则文本同步）
**交付**：Closes #38
- [ ] W4：`runs-on` 摊平（字符串/数组/`{labels}`），含 `${{` 或标签不在托管白名单内按 self-hosted 处理（fail-closed）；字符串分支按标签切分而非 `includes`
- [ ] W3：遍历 `jobs.<id>.uses`；`uses:` 形态的 job 跳过 W1/W2（GitHub 禁止 `timeout-minutes`）
- [ ] W5/W6：同时跑在 `jobs.*.concurrency` 上；分支过滤用 glob 匹配；`cancel-in-progress` 的非表达式真值标量一律拦，保留 `${{ github.event_name == 'pull_request' }}`
- [ ] W2：比较前小写；匹配动作而非前缀
- [ ] 输入侧：目录缺失或匹配 0 个文件时抛错；测试根目录改用 `import.meta.url`；成功路径打印「已检查 N 个文件」
- [ ] 其它：`statSync` 跟随符号链接；`jobs` 非映射或缺失时给 finding；读取失败与解析失败分开措辞
- [ ] §9.5 的规则文本同步（W5 的「字面量 `true`」口径要改，因为引号标量也该拦）
**验证**：每一项「修复前红 → 修复后绿 → 变异后再红」；`node scripts/workflow-check.mjs` 对现有四个 workflow 仍无 finding

### Batch D · policy-check 加固（PR-D，`fix/policy-check-hardening`）
**最小闭环**：`gate:*` 取值被校验，入口守卫加固，三条无牙规则长出牙。
**涉及文件**：`scripts/policy-check.mjs`、`tests/contract/issue-policy.test.js`、`AGENTS.md` §8.7（如需）
**交付**：Closes #39
- [ ] `GATES = ['E1','R1']` 并校验取值（`gate:E9` / `gate:` 必须被拦）
- [ ] `requiredAreas` 加 `/^[a-z0-9-]+$/` 过滤，消除「两条断言互相矛盾」的死锁
- [ ] 入口守卫复用 `workflow-check.mjs` 的 `invokedDirectly()`；补一条 `spawnSync` CLI 用例
- [ ] 空 API 响应当内部错误（exit 3），与规则违规区分
- [ ] 补牙：80/81 边界、`area:bogus`、`requiredAreas` 含已知哨兵
- [ ] `linkedIssues`：剥离围栏代码块、接受同仓完整 URL 关闭语法、拒绝 `#0`
**验证**：每一项的变异测试；`policy-check issue <n>` / `pr <n>` 对真实数据仍通过

### Batch E · rule-checks 加固（PR-E，`fix/rule-checks-hardening`）
**最小闭环**：发布面扫描覆盖凭据与提交信息、体量分桶对 CJK 路径与生成物正确。
**涉及文件**：`scripts/rule-checks.mjs`、`tests/contract/rule-checks.test.js`、`AGENTS.md` §8.3/§8.6（如需）
**交付**：Closes #40、Closes #41
- [ ] disclosure：补凭据模式（`gh[pousr]_`、`github_pat_`、私钥 PEM 头、`AKIA`）与 RFC1918
- [ ] disclosure：扫范围内每个提交的新增行（`git log --format=%H` + `git diff -U0 <c>^!`），报告带提交 SHA
- [ ] disclosure：接入 `git log --format=%B base..HEAD`；PR 正文经 `env` 传入
- [ ] disclosure：按 hunk 解析，修 `+++` 内容行被丢弃与命中归属错误
- [ ] disclosure：去掉自我豁免 pathspec，改用一条「自扫命中数为 0」的测试守住
- [ ] disclosure：收窄误报（`.env.local`、`*.local.json`、`/home/node`、`/root/.cache`）
- [ ] disclosure：命中行打印改为 `file` + 模式名 + 掩码摘要，不再原样回显；补救文案补「删除本次 workflow run」
- [ ] size：`--numstat -z` 或解引号，修 CJK 路径分桶；`SIZE_EXCLUDES` 改 glob 判定覆盖生成物
- [ ] size：重命名语法与 `.MD` 大小写；base ref 解析失败取 exit 3
- [ ] 导出 `disclosure` / `size` 并允许注入 diff 来源，补 exit code 契约的三条用例
- [ ] 更正 §8.3 的「1、2、3」表述为实测数字
**验证**：每一项的变异测试；`rule-checks disclosure` / `size` 对本 PR 自身仍通过

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | `Status` 的定义在仓库里唯一 | `grep -rn '开发做完没' docs/` 输出为空；`docs/product/board-semantics.md` 存在且给出唯一答案 | 通过，有一处已知例外（2026-09-18）：`docs/product/board-semantics.md` 与 `delivery-planning-and-board.md` 已不含该表述，检查通过；但本文件（`2026-09-18-rule-semantics-and-checker-convergence.md`）自身的 D1 表与「最小成功证据」为展示改前改后而引用了这个字面量，因此对 `docs/` 全树跑该 grep 不会得到空输出——命中全部落在本文件、且都是「现在/改成」对照，不是当前生效的定义 |
| 2 | 九条内置工作流的裁决可从一条规则推导 | `board-semantics.md` 的推导规则 + 九行表；契约测试断言「必须关闭」清单为六条 | 通过，但数字有更正（2026-09-18）：逐行数 D2 表「关闭」得到 **7** 条而不是六条（`Auto-close issue` 是遗漏的第七条，见 Surprises & Discoveries）；`docs/product/board-semantics.md` §5 与 `tests/contract/board-workflow.test.js` 均按 7 条实现并断言 |
| 3 | 合并队列有长期载体 | `docs/project-management/merge-queue.md` 存在；一个无上下文的人只读它能合完队列 | 待执行 |
| 4 | agent 写入边界可判定 | 读 `AGENTS.md` §10 增补能对「agent 写的这条 `blocked-by` 边算不算有效」给出确定答案 | 待执行 |
| 5 | 四个检查器的每一种绕过形态都有注入用例 | 逐项「修复前红 → 修复后绿 → 变异后再红」的命令输出 | 待执行 |
| 6 | 现有四个 workflow 在加固后的检查器下仍合规 | `node scripts/workflow-check.mjs` → `no findings`，exit 0 | 待执行 |
| 7 | 五个 PR 各自满足 §8.3 体量上限 | `node scripts/rule-checks.mjs size` 逐 PR 输出 | 待执行 |
| 8 | `main` 在五个 PR 全部合并后仍然绿 | 合并后 `pnpm verify` + `workflow-check` + `rule-checks` 实跑 | 待执行 |

## Progress

- [x] (2026-09-18 14:03 CST) 路由与取证：读完 9 个 issue、量化四个脚本与测试体量、核实看板工作流实际状态与 `PROJECTS_TOKEN` 缺失
- [x] (2026-09-18 14:03 CST) 三个设计决定由人类伙伴裁决（D1 的读法、5 个 PR 的切分、#45 只做离线一半）
- [x] (2026-09-18 14:03 CST) 建立 5 个隔离工作区与分支
- [x] (2026-09-18) Batch A 看板语义定义：新建 `docs/product/board-semantics.md`；修正 `delivery-planning-and-board.md` 术语表 / D2 表 / D4 表三处与 D3 的闭环声明；新建 `scripts/board-workflow-check.mjs` + `tests/contract/board-workflow.test.js`（13 条用例，含变异测试验证有牙）；`docs/README.md` 加主题文档索引。`pnpm verify` 43 → 56（PR-A 提交，见下方 Surprises 关于「六条」应为「七条」的更正）
- [ ] Batch B 过程记录
- [ ] Batch C workflow-check 假绿收敛
- [ ] Batch D policy-check 加固
- [ ] Batch E rule-checks 加固
- [ ] 验收与重构（Opus），回填本文件

## Surprises & Discoveries

- **Observation**（2026-09-18 14:00 CST）：「必须保持关闭」的内置工作流是**六条**，不是评审里估的四条或五条。
  **Evidence**：看板实测九条内置工作流；按 D2 的推导规则求值——写 `Status` 且由工程事件触发的有 `Item closed`、`Item reopened`、`Pull request linked to issue`、`Code review approved`、`Code changes requested`、`Pull request merged`；`Auto-close issue` 与 `Item closed` 构成回环，同样关闭（第七条，但它写的是 issue 状态而不是 `Status`，单列）。
  **Decision impact**：#45 的清单不能照抄评审里的数字，必须从 D2 推导。这也说明 D2 那条推导规则是有价值的——它把一个需要逐条记忆的表变成一次求值。

- **Observation**（2026-09-18 14:01 CST）：`Item reopened` 当前仍是 `enabled: true`，而按 D1 它必须关闭。
  **Evidence**：`gh api graphql … projectV2.workflows` → `ENABLED  Item reopened`。
  **Decision impact**：这是一个**无法由本 ExecPlan 自动化**的人工步骤（GraphQL 只有 `deleteProjectV2Workflow`，没有停用 mutation）。已向人类伙伴提出。Batch A 的纯函数会在它被打开时报出违规，因此这个缺口在 #37 接线之后是机械可发现的。

- **Observation**（2026-09-18 14:02 CST）：`PROJECTS_TOKEN` 仍不存在，因此 #45 的运行时半边与 #37 卡在同一个前提上。
  **Evidence**：`gh secret list` → 只有 `DSH_GITHUB_WEBHOOK_SECRET`。
  **Decision impact**：见 D4——切成离线判定与运行时接线两半，后者留给 #37。

- **Observation**（Batch A 执行时，2026-09-18）：本文件第 240 行那条 Surprise 的总结句说「必须保持关闭」是**六条**，但把 D2 表（Design / Spec）「裁决」列里标「关闭」的行逐行数出来是 **7** 条：`Item closed`、`Item reopened`、`Pull request linked to issue`、`Code review approved`、`Code changes requested`、`Pull request merged`、`Auto-close issue`。
  **Evidence**：D2 表本身没有错——第 240 行那条 Surprise 的 `Evidence` 段紧接着已经承认 `Auto-close issue`「同样关闭（第七条……单列）」，只是总结句只统计了直接落在 D2 规则字面表述里的六个（写 `Status`、触发事件属于工程轴），没把这处已经承认的第七条计入总数。`docs/product/board-semantics.md` §5 按 7 条实现，`scripts/board-workflow-check.mjs` 的 `MUST_BE_DISABLED` 与 `tests/contract/board-workflow.test.js` 的断言均为 7；`Validation and Acceptance` 表第 2 行原定「契约测试断言……为六条」同样需要按此更正。2026-09-18 对真实看板的核对（`gh api graphql` 读 `projectV2.workflows`）显示这 7 条当前全部是 `enabled: false`，另外两条（`Item added to project`、`Auto-add sub-issues to project`）全部是 `enabled: true`，与 7 这个数字及 D2 的推导结果一致。
  **Decision impact**：D2 的推导规则本身不需要改——问题只在总结句漏计，不影响规则正确性。后续批次（尤其 Batch B 若引用「必须保持关闭的工作流数量」）应以 `docs/product/board-semantics.md` §5 与本条记录的 7 为准，不要沿用第 240 行的「六条」。本条记录不修改第 240 行原文，按 ExecPlan 的追加式更正惯例处理。

- **Observation**（Batch A 执行时，2026-09-18）：第 244 行记录的人工缺口（`Item reopened` 当时是 `enabled: true`）已经不再成立。
  **Evidence**：2026-09-18（Batch A 执行时）重新查询 `gh api graphql … projectV2.workflows`，`Item reopened` 现在是 `enabled: false`；当前实测的九条状态与 `docs/product/board-semantics.md` §5 的推导结果（7 条关闭、2 条开启）完全一致。
  **Decision impact**：人类伙伴已经在第 244 行记录之后、Batch A 开工之前手动处理了这个人工步骤，本计划不需要为此再提任何请求。这不改变 D1/D2 的设计结论，只是记录该项人工待办已经完成。

## Decision Log

- **Decision**：`Status` 定为规划轴、人拥有。
  **Rationale**：`Status` 是 Planning provider 的原生字段，不变量 3 要求规划轴在看板上有落脚点；且人类伙伴关掉 `Item closed` 这一动作在「`Status` = 工程事实」的读法下是错的，因此该动作本身证伪了读法 A。
  **Date/Author**：2026-09-18 14:03 CST / 人类伙伴裁决，agent 记录

- **Decision**：九条内置工作流不再逐条裁决，改为从一条规则求值（D2）。
  **Rationale**：#33 的 D4 做了六次独立判断，漏掉三条，其中一条（`Item reopened`）开着且写 `Status`。逐条判断的漏项率不会因为更仔细而降到零；一条可求值的规则会。
  **Date/Author**：2026-09-18 14:03 CST / agent

- **Decision**：`Size` 如实写成「人的信号」，不去读看板字段（D3）。
  **Rationale**：读看板需要 `PROJECTS_TOKEN`，会把一条当前离线、必需的检查降级成需要凭据的 advisory。为了一个申报值的对比降低一条已生效规则的门禁级别，不划算（§9.2）。
  **Date/Author**：2026-09-18 14:03 CST / agent

- **Decision**：五个 PR 按「一个可独立验收的风险」切分，检查器按**文件**切而不按 issue 切。
  **Rationale**：§5.1 第 3 条。三个脚本是三份独立判定逻辑，合并后一次红测无法定位哪个风险坏了。#40 与 #41 同文件且共享 diff 解析与 `git` 调用，分开会让第二个 PR 大半是解冲突。
  **Date/Author**：2026-09-18 14:03 CST / 人类伙伴确认，agent 提议

- **Decision**：一份 ExecPlan 控制五个 PR，由 PR-A 引入，B–E 声明「排在 A 之后」。
  **Rationale**：这五个 PR 是**一件事**（收敛同一次评审发现的规则歧义与假绿），§4.2 因此满足。代价是 B–E 的 ExecPlan 链接在 A 合并前悬空——这正是评审里批评 #33 的那个耦合，区别在于：#33 是三件**不相关**的任务共用一份计划且顺序靠巧合，这里顺序在开工前就声明并写进每个 PR 描述。
  **Date/Author**：2026-09-18 14:03 CST / agent

## Idempotence and Recovery

- 五个分支各自独立；任一 PR 可单独 `git revert`，不牵连其他四个。
- Batch A 改的三处现有表述在 `delivery-planning-and-board.md` 里，该文件在 `active/`；回滚即恢复原表述，不影响该计划的其他章节。
- 本轮**不产生任何外部状态**：不建 secret、不改看板字段、不改内置工作流开关、不改分支保护。唯一的外部动作是开/关 issue（由 `Closes #N` 驱动，可重开）。
- `Item reopened` 的关闭是人工步骤，不在本计划的可回滚范围内；若被误关，在界面重新打开即可。
- 中途放弃时：`git worktree remove .worktrees/<slug>` + 删分支；`main` 不受影响。

## Interfaces and Dependencies

**合并顺序**（B–E 的 ExecPlan 链接依赖 A）：

| 位置 | PR | 分支 | 交付 | 依赖 |
|---|---|---|---|---|
| 1 | PR-A | `docs/board-planning-semantics` | Closes #55 #48，Refs #45 | 无 |
| 2 | PR-B | `docs/process-records` | Closes #46 #47 | A（ExecPlan 链接） |
| 3 | PR-C | `fix/workflow-check-false-greens` | Closes #38 | A（ExecPlan 链接） |
| 4 | PR-D | `fix/policy-check-hardening` | Closes #39 | A（ExecPlan 链接） |
| 5 | PR-E | `fix/rule-checks-hardening` | Closes #40 #41 | A（ExecPlan 链接） |

C / D / E 三者之间**无依赖**，可任意顺序；但都改 `AGENTS.md`，预期在 §8.3/§8.7/§9.5 各自的小节内有「两边都保留」级别的 rebase 冲突。

**交还给人类伙伴的人工项**：

1. 在 Project → Workflows 界面关掉 `Item reopened`（按 D1/D2 必须关；无 API 可用）。
2. 建 `PROJECTS_TOKEN`（带 `project` scope）才能接线 #45 的运行时半边与 #37。

## Outcomes & Retrospective

本计划的五个批次尚未执行。执行完成后回填：实际交付、与设计的偏离、变异测试的完整输出、以及五个 PR 合并后 `main` 的门禁结果。

## Bottom Change Note

- 2026-09-18 14:03 CST：新建本文件。范围是 2026-09-18 MVP 交付评审留下的 9 个 issue，分五个 PR 收敛。三个设计决定（`Status` 的读法、PR 切分、#45 的切半）在开工前由人类伙伴裁决，记在 `Decision Log`。
