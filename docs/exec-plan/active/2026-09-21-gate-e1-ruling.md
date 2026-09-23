# Gate E1 · 裁决与 v1 冻结建议 ExecPlan

> 状态：Active
> 创建：2026-09-21
> 范围：读 E1-1 / E1-2 / E1-3 三份观测记录，对 issue #4 的六条行为逐条给出裁决与引用，输出一份只有 `freeze` 或 `revise` 两种取值的裁决；若为 `revise`，逐条给出它影响的表或约束。
> **#4 的关闭条件**：结论为 `freeze` 时才可以关闭 #4；结论为 `revise` 时 #4 **保持打开**，直到修改清单落地并重新裁决。#4 的验收条件就是那六条行为本身，而 `release-gates.md` §1 把"无法判定"等同于"不满足"——行为 6 判 `inconclusive` 时关闭它，等于用一个未满足的验收条件把父门禁标记成完成。是否关闭最终由人类伙伴确认（`docs/architecture/release-gates.md` §2 第 1 行；`AGENTS.md` §1.2 只写门禁本身，不含判定者）。
> 上游输入：issue #25（本批次）、issue #4（父门禁与六条行为）、`docs/architecture/gate-e1-sandbox.md`、`docs/architecture/gate-e1-content-identities.md`、`docs/architecture/gate-e1-membership-and-draft.md`、`docs/architecture/gate-e1-write-and-events.md`、`docs/architecture/release-gates.md` §2 第 1 条、`AGENTS.md` §1.2

## Purpose / Big Picture

完成后，Gate E1 有一个**可引用的结论**：本地数据模型 v1 可以冻结，或者必须按一张具体的修改清单改完再冻结。没有这份裁决，`packages/storage/sqlite` 的身份与成员表（#27）、执行与关系表（#28）以及真实 GitHub 纵向切片（#70–#72）都没有开工依据——这正是 `AGENTS.md` §1.2 把 E1 设为前置门禁的原因。

判断成功的最小证据：

1. `docs/architecture/gate-e1-ruling.md` 对 issue #4 的六条行为逐条给出裁决与**引用到具体实验编号**；
2. 裁决行只有 `freeze` 或 `revise` 两个取值之一，没有第三种表述、没有"基本成立"这类修饰；
3. 若为 `revise`，每条修改点写明确切的表名或约束名，且**不包含任何 provider 特例**；
4. 由观测推翻的假设逐条进入本计划的 `Surprises & Discoveries`，仍然有效的结论被提升为 `docs/adr/` 下的 ADR。

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 六条行为 | issue #4 的六条验收条件：①一个外部对象两个工作区一条外部身份两条成员关系；②change request 成员关系不产生第二个工作项；③draft 转换保持内部工作项身份并把旧身份降级为历史别名；④同一观察 N 次等同一次；⑤乱序观察不覆盖新观察；⑥结果不确定的外部创建先对账再重试 |
| 裁决 | 对每条行为的判定，以及由六条汇成的单一结论 `freeze` / `revise` |
| 修改清单 | `revise` 时逐条给出"改哪张表 / 哪个约束 / 为什么"，不接受"在 provider 里特殊处理" |
| 提升 | 把仍然有效的结论写进 `docs/adr/`，使其不再依赖 ExecPlan 才说得通 |

### 当前事实

- 三份观测记录由本栈 E1-1 / E1-2 / E1-3 交付，位于 `docs/architecture/gate-e1-*.md`。
- `docs/adr/` 目前**没有任何 ADR**（只有 `docs/adr/README.md` 的格式与索引）；上游工程包给出的 12 条初稿决策尚未逐条重述进仓库。
- `packages/domain`（PR #81）与 `packages/capabilities`（PR #84）已冻结的语义**不因本裁决重写**：裁决决定的是本地**数据模型 v1**（表与约束）能否冻结，不是已合入的领域类型。
- `docs/architecture/release-gates.md` §2 第 1 条要求"裁决记录，以及 `tests/contract/` 中身份与幂等用例"；本批次交付前者，后者属于 #27/#28 落地后的契约套件。

### 栈内位置

本批次原为四层栈的顶层，栈内 base 是 `test/e1-write-and-events`；下层三层（E1-1 / E1-2 / E1-3）已变基进 `main`，该分支在远端已不存在，因此本 PR 现在的 base 是 `main`。它**不改**下面三层的任何记录文件；若发现记录自相矛盾，正确做法是在裁决里指出并引用两处原文，而不是回去修改下层证据。

### 上游依据

- issue #25 的五条验收条件（本计划 `Validation and Acceptance` 逐条对应）。
- issue #25 Notes："Blocks the identity tables in #5; nothing in the data model freezes before this."
- `docs/adr/README.md`：ADR 的命名、格式与"不可回退"判据。
- `docs/architecture/release-gates.md` §1：R1 不得由 LLM 判定；`docs/architecture/release-gates.md` §2 第 1 行把 Gate E1 的判定者列为人类伙伴。本裁决是 E1 的**证据与草稿**；该行错误归因于 `AGENTS.md` §1.2 的源文件缺陷在裁决 §6.5 登记。

## Design / Spec

### D1 裁决是对证据的函数，不是对计划的复述

每一条裁决必须引用到**实验编号**（例如 `E1-1 实验 3`）。引用不到实验的裁决一律写成 `inconclusive`，而 `inconclusive` 在汇总结论里等同于需要 `revise`——因为它意味着模型还没有证据，不是"大概没问题"。

### D2 只有两个取值

`freeze` 或 `revise`。没有"有条件冻结"、没有"先冻结再观察"。理由：数据模型 v1 一旦冻结，`#27`/`#28` 的表结构、真实 GitHub provider 的键、以及所有已写入的行都建立在它上面；一个带条件的冻结在工程上等价于冻结，却让"条件不成立时怎么办"没有归属。

### D3 修改点必须落在表或约束上

`revise` 的每一条写"改哪张表 / 哪个约束 / 为什么"。写不出表名的修改点说明它其实是一条实现细节，应当留在 provider 里而不是改模型；反过来，任何需要 provider 特例才能成立的模型都是模型错（issue #4 Scope 明确）。

### D4 本批次不重新跑实验

issue #25 Scope 把"重跑已经通过的实验"排除在外。若某条行为缺证据，结论是 `revise`（补证据后再裁决），不是"这次补跑一下"——补跑属于下层批次的修订，混进裁决会让"证据"与"结论"由同一次动作产出，失去独立性。

### D5 提升为 ADR 的判据

只提升**被观测支持且推翻代价高**的结论。候选：

1. 外部身份注册表的键形状（D5 of E1-1：跨 API 的 id 是否一致）；
2. 成员关系身份与内容身份分离；
3. 事件不是正确性机制、对账是；
4. 结果不确定是产品可见状态（若 E1-3 实测支持）。

每条 ADR 按 `docs/adr/README.md` 的四段格式（Decision / Why / Rejected / Consequences），并在 `docs/adr/README.md` 的索引表里登记。

### D6 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 写"总体成立，细节待定" | 无法据此开工，也无法据此回滚；`AGENTS.md` §1.2 要的是一个能解除门禁的结论 |
| 把裁决写进 PR 描述 | PR 描述不是仓库内容；`#27`/`#28` 的作者读不到 |
| 由本批次直接修改下层记录 | 证据与结论同源，等于自证；矛盾应当在裁决里被指出 |
| 直接改 `packages/domain` 的已合入类型 | 裁决的对象是数据模型 v1；领域类型已冻结且不因本裁决重写 |

## Global Constraints

- 本批次只改文档。**批次改动的文件集合在本节声明一次**：`Plan of Work` 的「涉及文件」只列主文件；`Progress`、`Decision Log`、`Outcomes & Retrospective`、`Bottom Change Note` 提到它时写"见 `Global Constraints`"，不复述、也不另立一份。
  - `docs/exec-plan/active/2026-09-21-gate-e1-ruling.md`
  - `docs/architecture/gate-e1-ruling.md`
  - `docs/adr/README.md`
  - `docs/adr/ADR-0001-external-identity-key-shape.md`
  - `docs/adr/ADR-0002-membership-identity-separate-from-content.md`
  - `docs/adr/ADR-0003-events-are-not-the-correctness-mechanism.md`
  - `docs/adr/ADR-0004-unknown-external-create-is-product-visible.md`
  - `docs/README.md`
  - `docs/architecture/README.md`
  - 回读命令（从仓库根执行）：`cd .worktrees/w6-e1-4 && git diff --name-only main...HEAD`；期望输出就是上面这 9 个路径，不增不减。**注意 `git diff --name-only` 按路径排序，行序与上面的书写顺序不同**；判据是集合相等，不是逐行文本相等。（本节早先写的是 `test/e1-write-and-events...HEAD`，该分支在远端已不存在：在没有陈旧本地 ref 的克隆里该命令会直接失败，而在保留了陈旧 `test/e1-write-and-events` ref 的工作树里它会得到 13 个路径，多出下层三层变基进 `main` 时带进来的 4 个文件。订正见 `Bottom Change Note` 的 2026-09-23 条目。）
- `docs/README.md` 与 `docs/architecture/README.md` 的索引由**栈级联**统一更新，本批次不写它们（见 `Progress` 的 2026-09-21 条目与 `Bottom Change Note`）。**Superseded by 本计划 `Global Constraints` 的文件集合条目（2026-09-22）**：本 PR 的回填提交实测改动了这两个索引文件，本批次实际写了它们，实际集合以上一条为准。
- 不新增 `packages/` 或 `tests/` 下的代码；不改下层三批交付的记录文件。
- 裁决不得包含 provider 特例；不得出现"应该""大概""基本"这类无证据修饰。
- 记录中不得出现凭据、token、本机绝对路径、本机用户名或 hostname。
- 文档改动 ≤ 1500 行（按 `node scripts/rule-checks.mjs size <base>` 度量，base 为本 PR 声明的 base `main`）。
- 只允许 rebase merge；不自行合并 PR；`freeze` / `revise` 的最终采纳由人类伙伴确认。

## Plan of Work

### Batch 1 · 六条行为逐条裁决与 ADR 提升（本批次，issue #25）

**最小闭环**：六条行为各有裁决与引用；汇总结论只有一个取值；`revise` 时修改清单落到表或约束；仍然有效的结论成为 ADR。
**涉及文件**（只列本批次主文件；完整文件集合见 `Global Constraints`，本处不复述）：`docs/architecture/gate-e1-ruling.md`、`docs/adr/ADR-0001…ADR-0004`、`docs/adr/README.md`

- [x] 逐条读三份记录，为 #4 的六条行为各写一条裁决与实验引用
- [x] 引用不到实验的行为判为 `inconclusive`，并计入 `revise`
- [x] 汇总结论：`freeze` 或 `revise`（二者之一，无修饰）——取值 `revise`
- [x] `revise` 时逐条给出表名/约束名与理由（R1–R8）
- [x] 把被观测支持的结论提升为 `docs/adr/ADR-*.md`，并在 `docs/adr/README.md` 索引登记
- [x] 回填本计划 `Surprises & Discoveries` 与 `Outcomes & Retrospective`
- [ ] 在 #4 上记录裁决结论（由人类伙伴决定是否关闭；agent 不改看板字段）

**验证**（在本批次工作树内执行：从仓库根 `cd .worktrees/w6-e1-4`，分支 `test/e1-ruling`；下列命令的路径都相对该目录，换目录会得到不同结果）：

```bash
# 1) 六条行为各有裁决行
python3 - <<'PY'
from pathlib import Path
import re
text = Path('docs/architecture/gate-e1-ruling.md').read_text()
rows = re.findall(r'^\|\s*([1-6])\s*\|.*?\|\s*(pass|inconclusive)\s*\|$', text, re.M)
assert len(rows) == 6 and {n for n, _ in rows} == set('123456')
for n, _ in rows:
    row = next(line for line in text.splitlines() if re.match(rf'^\|\s*{n}\s*\|', line))
    assert re.search(r'E1-[123] 实验 [123]', row), row
print('六行裁决逐条含 E1 实验引用：通过')
PY
# 2) 结论只有一个取值
python3 - <<'PY'
from pathlib import Path
import re
text = Path('docs/architecture/gate-e1-ruling.md').read_text()
rows = re.findall(r'^\*\*汇总结论：`(freeze|revise)`。\*\*$', text, re.M)
assert rows == ['revise'], rows
print('汇总结论唯一取值：revise')
PY
# 3) 无证据修饰词
grep -nE '应该|大概|基本成立' docs/architecture/gate-e1-ruling.md     # 期望：无输出
# 4) ADR 已登记
grep -c 'ADR-' docs/adr/README.md                                    # 期望：≥ 1
# 5) 发布面与体量（base 用本 PR 声明的 base `main`）
node scripts/rule-checks.mjs disclosure main                          # 期望：exit 0
node scripts/rule-checks.mjs size main                                # 期望：文档 ≤ 1500，exit 0
git diff --check main...HEAD                                          # 期望：无输出
# 6) 证据一致性契约（本计划的文档也在它的发现范围内）
node --test tests/contract/e1-evidence-consistency.test.js             # 期望：3 pass / 0 fail
```

**回滚**：`git revert` 本批次提交；栈回到"有证据、无裁决"的上一版，Gate E1 保持未通过——这是正确的回滚状态，因为撤销裁决就等于门禁未过。PR 描述中的提交数必须按最终 head 实测回填，不使用历史估计；回读命令：`cd .worktrees/w6-e1-4 && gh pr view 108 -R SingularityKChen/harness-projects --json commits`（`-R` 已固定仓库，换目录执行结果相同；本计划不把提交数写成正文事实）。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 六条行为各有裁决与引用 | 专用 Python 检查逐行匹配 6 条裁决行，并断言每行含 `E1-[123] 实验 N` 引用；不把 §5 假设表计入 | 通过 |
| 2 | 结论为 `freeze` 或 `revise` | 专用 Python 检查只匹配 `**汇总结论：`freeze|revise`。**` 标题，并断言唯一结果为 `revise`；不把正文中的引用误计为结论 | 通过（取值 `revise`） |
| 3 | `revise` 时每条修改点落到表或约束 | §4 的 R1–R8：每条给出表名/键/约束与引用；R1 另给连带影响的外键清单 | 通过 |
| 4 | 被推翻的假设进入 Surprises 与 Decision Log | §5 逐条列出 14 条被推翻假设并附实验引用；本计划 `Surprises & Discoveries` 同步逐条列出 | 通过 |
| 5 | 裁决对无上游输入的读者可读 | 全文只引用仓库内路径与实验编号；不引用任何不随仓库分发的外部文档 | 通过 |
| 6 | ADR 已提升并登记 | `docs/adr/` 下存在 ADR-0001…ADR-0004；索引行数按 `cd .worktrees/w6-e1-4 && grep -cE '^\| \[ADR-000' docs/adr/README.md` 回读（期望 = 4）。用 `grep -c 'ADR-000'` 会把正文里提到 ADR 编号的行一并计入（2026-09-23 实测为 5），只作"已登记"的非空判据，不作行数判据 | 通过 |
| 7 | 不包含 provider 特例 | §4 修改清单 8 条全部落在表、键或约束上；无一条以 provider 为条件 | 通过 |

## Progress

- [x] (2026-09-21) 通读三份记录并建立证据索引：E1-1 三条、E1-2 两条、E1-3 三条，共 8 条实验，九字段全部齐全，无缺字段条目
- [x] (2026-09-21) 六条行为逐条裁决：行为 1–5 = `pass`；行为 6 = `inconclusive`（E1-3 实验 3 §8 自述"创建内容那一步响应丢失"分支没有实测）
- [x] (2026-09-21) 汇总结论 `revise`；修改清单 R1–R8 落到表名/键/约束
- [x] (2026-09-21) 记录矛盾与不足：§6 的 6.1–6.4 与 6.6 共五处，逐处引用两处原文，未修改任何下层记录文件
- [x] (2026-09-21) ADR-0001…ADR-0004 提升与 `docs/adr/README.md` 索引登记（状态 `Proposed`）
- [x] (2026-09-21) Surprises / Outcomes 回填；`Validation and Acceptance` 七项结果回填
- [x] (2026-09-21) 索引边界：按本批次 Global Constraints，`docs/README.md` 与 `docs/architecture/README.md` 本批次不改，由栈级联统一更新（见 `Bottom Change Note`）。**Superseded by `Global Constraints` 的文件集合条目（2026-09-22）**：回填提交实测改动了这两个索引文件，实际文件集合以 `Global Constraints` 为准，本处不复述
- [ ] 人类伙伴确认 `revise` 的采纳与 #4 的关闭（判定者见 `docs/architecture/release-gates.md` §2 第 1 行；agent 不改看板字段）。**本批次不关闭 #4**：`revise` 的采纳与 #4 的关闭是独立的人类决定，合并本 PR 只发布裁决本身。
- [x] (2026-09-21) 独立复核并修订：判定者正确引用 `release-gates.md` §2 第 1 行；源文件错误归因登记于裁决 §6.5；乱序策略**当时误记为"两条规则"**（见 2026-09-23 条目）；AC1/AC2 改为逐行 Python 核对；最终 head 的 checks 以 `cd .worktrees/w6-e1-4 && gh pr checks 108 -R SingularityKChen/harness-projects` 回读为准（期望：全部 pass；check 列表与条数不写进本计划，见 `PLANS.md` §4）。
- [x] (2026-09-23) 响应评审并订正（4 条 P1/P2，另 1 条经复核判定不成立）：①判定者的错误归因从裁决 §9、本计划三处与 `Decision Log` 一处清除，只引 `release-gates.md` §2 第 1 行；②裁决 §6.2 改为"§4.1(a) 快照已过期、§4.1(b) 重建判据未过期"；③乱序规则按源记录编号列统一为三条，并把该处文/表不一致登记为裁决 §6.6；④声明的 base 由远端已不存在的 `test/e1-write-and-events` 订正为 `main`，回读判据由"逐行一致"改为集合相等并注明输出按路径排序；⑤`docs/adr/README.md` 保留 12 条主题清单、只改"当前依据"的表述，理由进 `Decision Log`
- [x] (2026-09-23) 不成立的评审意见 1 条：评审建议把 `docs/architecture/gate-e1-ruling.md` 加进契约测试的记录集合，但该测试在 base `main@42b584f` 已改为按 `gate-e1-*.md` 通配发现（`gateDocs` 跑 id 不变量、`recordDocs` 才跑九字段模板），裁决书已在覆盖范围内——评审读的是旧版测试。本轮不改测试
- [x] (2026-09-23) 验证：`node --test tests/contract/` 403 pass / 0 fail；本计划 `Plan of Work` 的六条命令逐条通过；`node scripts/rule-checks.mjs size main` 与 `disclosure main` 期望 exit 0、`git diff --check main...HEAD` 期望无输出（易失值只写回读命令与期望，见 `PLANS.md` §4）

## Surprises & Discoveries

### 被观测推翻的假设（裁决 §5 的逐条对应）

- 复核发现：`release-gates.md` §2 第 1 行把“人类伙伴”错误归因于 `AGENTS.md` §1.2；本计划与裁决改引正确落点，并在裁决 §6.5 登记源文件缺陷。
- 复核发现（2026-09-21 记错、2026-09-23 订正）：E1-3 实验 2 §4.6 的乱序策略**正文写"两条规则"、编号列了三条**。2026-09-21 的复核只读了正文的"两条"，把裁决与计划都改成两条，并写下"计数已统一"——而 `Outcomes` 表里的 R4 仍写三条，两处互相否证。2026-09-23 按编号列的三条统一（裁决 §2.5、§4 的 R4 与本计划 `Outcomes` 均为三条），并把源记录的文/表不一致登记为裁决 §6.6。
- 复核发现：E1-1 实验 3 的 `§3` 在该记录中是字段编号，不是文档章节；本计划与裁决改写为“字段 3”，避免编号语义切换。

1. **"mutation 响应回显完整，可当作写入确认来源"被推翻**：同一条 mutation 的回显里 `Status` / `E1 Date` / `E1 Iteration` 三个节点只回了 `__typename`，值字段为空，而同一秒的另一次调用返回全量值（E1-3 实验 1 §4.2）。
2. **"`updatedAt` 是修订计数器，可用于定序或增量拉取"被推翻**：同值重写四次不推进；连续四次真实改变中两次落在同一秒（E1-3 实验 1 §4.3、§4.4）。
3. **"写请求报错即未生效"被推翻**：`updateProjectV2ItemPosition` 不给分页参数时 payload 整体为 null（`MISSING_PAGINATION_BOUNDARIES`），而顺序确实已经改变（E1-3 实验 1 §4.6）。
4. **"任何 project item 内容都能挂接"被推翻**：`addProjectV2ItemById` 拒绝 draft——`contentID must refer to an Issue or a Pull Request.`（E1-3 实验 3 §4.3）。
5. **"条目字段值只由用户写入决定"被推翻**：draft 条目实测 2 个 `fieldValues`，issue / change request 条目 3 个，差额来自调用方无法写入的 `ProjectV2ItemFieldRepositoryValue`（E1-1 实验 2 §6 第 1 条）。
6. **"同一对象在同一平台的 REST 面上只有一个数字 id"被推翻**：`pulls/5.id = 4588791734` 与 `issues/5.id = 5523780322` 互不相等，唯一跨面一致的是 node id（E1-1 实验 3 §6 第 1 条）。
7. **"两个 API 面对同一编号是否存在的答案一致"被推翻**：REST `issues/5` 返回对象，GraphQL `repository.issue(number: 5)` 返回 `null` 并报 `NOT_FOUND`（E1-1 实验 3 §6 第 2 条）。
8. **"平台不返回的字段是 `null`"被推翻**：draft 的 `repository` 与 `number` 在类型上不存在（`undefinedField`，exit 1），introspection 字段全集里也没有它们（E1-1 实验 2 §4）。
9. **"draft 转换会更换成员关系身份"被推翻**：成员关系 id 与 `createdAt` 都没变，只有 `updatedAt` 与 `type` 变；变的是内容 id（E1-2 实验 2 §6 第 1 条）。
10. **"转换后旧 id 仍有一段可解析的过渡窗口"被推翻**：旧 `DI_*` 在转换后立即 `NOT_FOUND`，没有过渡窗口（E1-2 实验 2 §6 第 2 条）。
11. **"项目条目事件可以订阅、事件可作为同步驱动"被推翻**：`projects_v2_item` 在仓库 webhook 上被 `422` 拒绝，org / user / project 三种作用域分别返回 `404`（E1-3 实验 2 §4.1、§4.3）。
12. **"写入或删除后紧随其后的计数可信"被推翻**：删除后 `items.totalCount` 一度仍返回 9 而同一 connection 的 `nodes` 已是 7（E1-3 实验 3 §6 第 3 条）；`item-add` 成功后紧随的查询少看到一条，约 3 秒后才补齐（沙箱定义 §4.2）。
13. **"两个工作区的字段值在任何时刻都互不覆盖"被一次未复现观测动摇**：首轮写入后读回出现 A = Done（写入值为 In Progress），此后 8 轮 15 次改变值的写入—读回全部互不覆盖（E1-2 实验 1 §6）。该形态未复现，按残余风险处理。
14. **"标题可作为创建操作的自然键"被推翻**：宽泛关键词 `fixture` 命中 5 条，且标题是可编辑属性（E1-3 实验 3 §4.4）。

### 记录之间的矛盾与不足（裁决 §6 的逐条对应，未修改任何下层记录）

1. **成员关系落点：E1-2 与 E1-3 互相矛盾**。E1-2 实验 1 §5 末段写"`ExternalIdentityKind` ……**没有**给 `ProjectV2Item` 留位置……**不能**写成两行 `ExternalIdentity`"；E1-3 实验 1 §5 与实验 3 §5 的"本地应有行"表写 `external_identity (platform, kind=ProjectV2Item, id=PVTI_…)`，而同一张 E1-3 实验 3 §5 又出现以 `(workspace, content)` 为键的 `project_item_membership`。裁决按 E1-2 的立场定案（R1）。
2. **沙箱定义 §4.1(a) 的快照已过期，§4.1(b) 的重建判据未过期**：§4.1(a)（标题即"快照，不是重建判据"）把 `draft-convert` 写成 `DRAFT_ISSUE … DI_lAHOAY1ahM4BkJ9rzgLKQZ0`，而 E1-2 实验 2 §4 转换后该条目是 `ISSUE`、内容 id 为 `I_kwDOUjWAl88AAAABSUC8og`；E1-2 实验 2 §6 末段已指出该行过期。裁决 §6.2 订正了它的位置与性质：§4.1(b) 只写形状、不含 node id，并已覆盖转换前后两种状态，不需要修改。
3. **E1-3 实验 3 §4.2 的读回与 E1-2 实验 2 的转换结果不一致，且该次读回没有时间戳**：同一 `item id`（`PVTI_lAHOAY1ahM4BkJ9rzg75lAw`）在两处分别显示为 `DraftIssue` 与 `ISSUE`（编号 6，转换时间 `2026-09-21T07:18:02Z`）。无法从记录判定这是转换前的读回还是冲突的读回——属记录不足。
4. **成员关系键有三种写法并存**：E1-1 实验 1 §5 的 `(project, item)`、E1-2 实验 1 §5 的 `(workspaceId, itemExternalId)`、E1-3 实验 1 §5 的 `(workspace=A, item=…)`；只有 E1-2 的写法含工作区。裁决统一为 `(workspace_id, project_external_id, item_external_id)`（R1）。
5. **E1-3 实验 2 §4.6 的文/表不一致**：正文写"遵循**两条规则**"，紧随其后的编号列了三条。裁决 §6.6 按编号列的三条计（§2.5 与 §4 的 R4 均为三条），只登记、不就地改正下层记录。

### 其它发现

- **行为 6 的缺口是记录自述的，不是裁决推断的**：E1-3 实验 3 §8 原文写"'创建内容那一步响应丢失'这一分支没有实测"，§7 也写"这一条**本批次没有实测**"。这让 `inconclusive` 有了可引用的出处，而不需要裁决方替记录补理由。
- **五条判 pass 的行为里，只有行为 4 的 N 被实测为 2**：行为 4 的一般形式靠"重复读取时 id 稳定"（E1-3 实验 2 §4.6）补足，裁决在 §2.4 明写了这条证据边界，不把 N = 2 写成 N 次的一般实测。
- **沙箱级读后写延迟在两份记录里各出现一次**：沙箱定义 §4.2（条目连接）与 E1-3 实验 3 §6 第 3 条（`totalCount` 与 `nodes` 短暂不一致）。两次都指向同一类读路径陈旧，且都影响"读回即权威"的实现方式（R4）。

## Decision Log

- **Decision**：`inconclusive` 计入 `revise`。
  **Rationale**：没有证据的模型不能冻结。把"还不知道"折算成"大概可以"，正是 `release-gates.md` §1 判定为**不满足**的那一类。
  **Date/Author**：2026-09-21 / agent

- **Decision**：裁决不改下层记录，矛盾在裁决里引用原文指出。
  **Rationale**：证据与结论同源会失去独立性；本批次的价值恰恰在于"读了别人写的证据之后能不能得出结论"。
  **Date/Author**：2026-09-21 / agent

- **Decision**：行为 6 判 `inconclusive`，不判 `pass`。
  **Rationale**：E1-3 实验 3 §8 自述"创建内容那一步响应丢失"分支没有实测，而该分支是"never blindly retries"在记录里唯一的落点；前半句"先对账"有实测、后半句没有。按 D1，决定性的一半缺证据即 `inconclusive`，且计入 `revise`。
  **Date/Author**：2026-09-21 / agent

- **Decision**：汇总结论取 `revise`。
  **Rationale**：一条 `inconclusive` 已足以使模型不满足冻结条件（D1）；此外行为 1 的成员关系部分在冻结模型里没有落点，且 E1-2 与 E1-3 对同一件事给出矛盾落行（`Surprises` 的矛盾 1）。
  **Date/Author**：2026-09-21 / agent

- **Decision**：成员关系落在独立表 `project_item_membership`，不扩展 `ExternalIdentityKind`。
  **Rationale**：成员关系是工作区作用域的（E1-2 实验 1 §4 两条 Status 互不覆盖），而 `external_identity` 的键故意不含工作区；把成员关系塞进该表会迫使键带 `workspace_id`，从而把同一内容对象复制成两份内容身份。两条互斥立场中取 E1-2 实验 1 §5 的那一条，因为只有它有"工作区作用域"这一条实测依据。
  **Date/Author**：2026-09-21 / agent

- **Decision**：ADR-0001…ADR-0004 的状态写 `Proposed`，不写 `Accepted`。
  **Rationale**：`docs/architecture/release-gates.md` §1 规定 R1 不得由 LLM 判定，§2 第 1 行把 Gate E1 的判定者列为人类伙伴；agent 只能提供证据与草稿。`AGENTS.md` §1.2 只写门禁本身，不含判定者（该行对 §1.2 的归因是源文件缺陷，见裁决 §6.5）。
  **Date/Author**：2026-09-21 / agent

- **Decision**：本批次不改 `docs/README.md` 与 `docs/architecture/README.md`。
  **Rationale**：用户指令优先于仓库约定（`AGENTS.md` §5）：两份索引由栈级联统一更新。本计划 `Global Constraints` 的对应条目已改成同一表述，避免计划与执行各说各话。
  **Superseded by `Global Constraints` 的文件集合条目（2026-09-22）**：`cd .worktrees/w6-e1-4 && git diff --name-only main...HEAD` 实测包含这两个索引文件（由本 PR 的回填提交改动），本批次实际写了它们；文件集合以 `Global Constraints` 为准，本处不复述。（该命令原文写的是 `test/e1-write-and-events...HEAD`；该分支在远端已不存在，2026-09-23 订正为 `main`。）
  **Date/Author**：2026-09-21 / agent

- **Decision**：`docs/adr/README.md` 索引末尾的治理表述改为"本目录只登记已在仓库内有证据的决策；尚未重述登记的主题不作为本目录的依据"，并**保留**那 12 条上游初稿决策的主题清单。
  **Rationale**：原表述把 12 条上游决策写成"仍是这些主题的当前依据"，与 `AGENTS.md` §3 及 `docs/README.md` §3 的"上游输入不随仓库分发、对外可读的结论必须在仓库内独立成立"冲突，因此"当前依据"必须改。但那份清单是本仓库内唯一逐条列出剩余主题的地方，删掉它会让后续 ADR 批次失去索引，所以只改依据表述、不删清单，并标注哪几条已登记为 ADR。这属于治理语义变更，超出"索引登记"的字面范围，按评审意见在此登记理由。
  **Date/Author**：2026-09-23 / agent

## Idempotence and Recovery

- 本批次是纯文档工作，验证命令只读且可重复。
- 回滚单位是单个提交；回滚后 Gate E1 恢复为未通过，这是正确状态而不是故障。

## Interfaces and Dependencies

- **上游**：E1-1 / E1-2 / E1-3 的记录文件（路径见 `Purpose / Big Picture`）。
- **下游**：`#27` / `#28`（存储表）以本裁决为开工依据；`#70`–`#72`（真实 GitHub 纵向切片）以裁决后的键形状为准；`docs/architecture/release-gates.md` §2 第 1 条的判定证据由本裁决与后续契约套件共同构成。
- **人工项**：`freeze` / `revise` 的最终采纳、以及是否关闭 #4，由人类伙伴决定（`docs/architecture/release-gates.md` §2 第 1 行）。

## Outcomes & Retrospective

**汇总结论**：`revise`（无修饰、无条件）。本地数据模型 v1 不满足冻结条件。

**六条行为的判定分布**：5 条 `pass`（行为 1–5）、1 条 `inconclusive`（行为 6）。

**`revise` 的实际修改点数量**：8 条（R1–R8），全部落在表、键或约束上，无一条以 provider 为条件：

| 修改点 | 目标 |
|---|---|
| R1 | 新增 `project_item_membership` 表与两条唯一约束；`ExternalIdentityKind` 不扩展 |
| R2 | `planning_field_value` 的键与唯一约束（不得用可选值 id 定位） |
| R3 | `planning_field_value` 不设版本列、不依赖 compare-and-set；权威值由独立读回支撑 |
| R4 | `sync_observation` 的键与三条乱序规则；投影只在读回成功后提交 |
| R5 | `reconcile_cursor` 的语义为"上次全量对账时刻" |
| R6 | `webhook_subscription` 不得成为唯一更新来源 |
| R7 | `external_identity` 的 `role` 约束：`historical` 不得作为平台查询参数 |
| R8 | `pending_external_write` 的幂等键与补证据项（状态机取值集合待补证据后冻结） |

**被观测推翻的假设**：14 条（见 `Surprises & Discoveries`）。其中 3 条直接影响表结构（响应回显不可靠、`updatedAt` 不可定序、写入报错不等于未生效），2 条直接影响身份键（REST 数字 id 不唯一、两个 API 面对同一编号答案相反）。

**记录之间的矛盾**：5 处（成员关系落点、沙箱定义 §4.1(a) 快照过期、E1-3 实验 3 §4.2 的无时间戳读回、成员关系键的三种写法、E1-3 实验 2 §4.6 的文/表不一致）。全部只引用原文指出，未修改下层记录文件。

**"E1 之后还有哪些身份假设没有平台证据"的剩余清单**（交给后续批次，本裁决不补跑）：

1. "创建内容那一步响应丢失"时的平台行为（E1-3 实验 3 §8 自述未实测）——R8 的直接依赖。
2. `ProjectV2ItemType.REDACTED` 的触发条件与 `content` 形状（沙箱定义 §8）。
3. 成员关系被移除或归档时的身份行为（E1-2 §5 的"未覆盖"）。
4. change request 加入两个 project 时的成员关系形态（E1-1 实验 3 的"未证明"清单）。
5. 跨页查询时 id 与时间戳的行为（三份记录的全部查询都在单页内返回）。
6. N > 2 的重复投递（行为 4 的实测是 N = 2 加稳定自然键）。
7. 两个账号（两个 binding）场景下的身份注册表行为（E1-2 §5 的"未覆盖"）。

**回溯**：本批次没有新增代码，也没有重跑任何实验；全部产出是"读证据 + 定案 + 落表名"。最大的收获不是结论本身，而是发现**下层记录之间存在一处必须由裁决解决的矛盾**（成员关系落点）——若不裁决，`#27` 会同时按两种落行开工。其次是确认了"行为 6 的缺口是记录自述的"，因此 `inconclusive` 有可引用的出处，不需要裁决方替记录补理由。

**技术债务**：R8 的状态机取值集合在补证据前不能冻结；`docs/README.md` 与 `docs/architecture/README.md` 的索引条目待栈级联补齐。**Superseded by `Global Constraints` 的文件集合条目（2026-09-22）**：这两个索引文件已由本 PR 的回填提交写入索引条目，不再属于待补齐的技术债务。

## Bottom Change Note

- 2026-09-21：首次创建。原因：issue #25 要求证据齐备后给出唯一取值可裁决，并把仍然有效的结论提升为 ADR。
- 2026-09-21：完成 Batch 1。产出 `docs/architecture/gate-e1-ruling.md`（六条裁决、结论 `revise`、R1–R8、14 条被推翻假设、5 处记录矛盾）与 ADR-0001…ADR-0004，并在 `docs/adr/README.md` 登记。原因：`#27`/`#28` 与真实 GitHub 纵向切片需要一份可引用的开工依据。（"5 处"为 2026-09-23 订正：原写 4 处，第 5 处见裁决 §6.6。）
- 2026-09-21：`Global Constraints` 的"涉及文件"一条改为不含 `docs/README.md` 与 `docs/architecture/README.md`。原因：用户指令优先（`AGENTS.md` §5），两份索引由栈级联统一更新；本批次只在 `Progress` 与本节注明，不写索引文件。**Superseded by `Global Constraints` 的文件集合条目（2026-09-22）**：该改动已被本 PR 的回填提交推翻，两个索引文件实际被本批次改动。
- 2026-09-21：明确 #4 的关闭条件。原因：范围行原文写"裁决通过后关闭 #4"，而"通过"在 `revise` 结论下不成立；PR 描述里同时写着 `Closes #25` 与 `Closes #4`，一旦合并就会把验收条件尚未全部满足的父门禁自动关掉（`release-gates.md` §1：无法判定等同于不满足；行为 6 判 `inconclusive`）。改为：只有 `freeze` 才关闭 #4，`revise` 时保持打开，PR 侧改为 `Refs #4`。
- 2026-09-22：按 `PLANS.md` §4 的活文档一致性规则修正本计划，只改本文件。（1）**一个事实只写一处**：`Global Constraints` 改为声明实测的完整文件集合并附回读命令，`Plan of Work` 的「涉及文件」只列主文件。（2）**被推翻的结论就地标注**：五处"本批次不写两个索引文件"的结论在原处追加 `Superseded by` 标记、原文保留。（3）**证据带执行上下文**：为 `gh pr view` / `gh pr checks` 补上工作目录与 `-R`，为验证代码块补执行上下文。（4）**易失状态**维持"回读命令 + 期望"的写法：本次未把 check 列表、条数、提交数或 head SHA 写成正文事实。（5）订正 `Validation and Acceptance` 第 6 行的证据：原文写 `grep -c 'ADR-' docs/adr/README.md` = 9，与该命令的实测输出不符（该计数含 4 行格式说明），索引行数改用 `grep -c 'ADR-000'` 回读并写为期望着。原因：原计划声明"本批次不改 `docs/README.md` 与 `docs/architecture/README.md`"，而本 PR 自己的回填提交改了这两个文件，计划与执行互相否证。
- 2026-09-23：响应评审，订正五处。（1）**声明的 base 失效**：`test/e1-write-and-events` 在远端已删除（下层三层变基进 `main`），按它回读会失败或得到 13 个路径；`Global Constraints`、`Plan of Work` 验证块与 `Decision Log` 的 base 全部改为 `main`，判据由"逐行一致"改为集合相等（`git diff --name-only` 按路径排序）。（2）**判定者错误归因**：`AGENTS.md` §1.2 不含"人类伙伴"，本计划三处与该条 `Decision Log` 改引 `release-gates.md` §2 第 1 行。（3）**乱序规则计数**：2026-09-21 只读源记录正文的"两条规则"就改成两条并写下"计数已统一"，而 `Outcomes` 仍写三条；现按源记录编号列统一为三条，源记录的文/表不一致登记为裁决 §6.6。（4）**ADR 索引的治理表述**：保留 12 条主题清单、只改"当前依据"，理由进 `Decision Log`。（5）**验收证据**：`Validation and Acceptance` 第 6 行的行数回读改用 `grep -cE '^\| \[ADR-000'`（`grep -c 'ADR-000'` 会计入正文提及，2026-09-23 实测为 5）。原因：评审在 head `ae8644c` 上给出 3 条 P1 与 2 条 P2，其中 4 条成立、1 条（契约测试覆盖面）经复核不成立并在 `Progress` 记明。
