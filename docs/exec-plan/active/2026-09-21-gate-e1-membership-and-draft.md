# Gate E1 · 多项目成员关系与 Draft 转换 ExecPlan

> 状态：Active
> 创建：2026-09-21
> 范围：在 E1-1 建立的沙箱上，观测两个"对象没变而外部身份变了"的身份场景——同一个 issue 同时出现在两个 project、以及 draft 被转换成真实 issue——并记录平台实际返回的 id 变化。
> 上游输入：issue #23（本批次）、issue #4（父门禁，六条行为中的第 1、3 条）、issue #22（沙箱与记录模板的来源）、`docs/architecture/README.md`（外部身份注册表与工作区级投影）、`AGENTS.md` §1.1 第 6 条

## Purpose / Big Picture

完成后，下面这句话有真实平台观测支撑：

> 一个底层对象改变成员关系（进入第二个 project）或改变自身形态（draft → issue）时，**内容身份不变**；变化的只有成员关系身份，旧的外部身份被降级为历史别名而不是被删除重建。

判断成功的最小证据：

1. `docs/architecture/gate-e1-membership-and-draft.md` 的两条实验按 E1-1 固定的九字段模板填写完整；
2. 实验 1 给出同一个内容 id 对应**两个** `ProjectV2Item.id`，且两个工作区可以各自持有不同的规划字段值而互不覆盖；
3. 实验 2 给出 draft 转换前后的 `ProjectV2Item.id` 与内容 id 的**实际值**（相等或不等都记录），并据此判定"内部工作项 id 不变"是否成立；
4. 转换前的 draft 身份被记录为历史别名，转换后的身份为主。

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 多项目成员关系 | 同一个底层 issue 被加进两个 project，于是平台上有两条 `ProjectV2Item` |
| 工作区级投影 | 本地模型刻意**不**做跨工作区的工作项聚合；每个工作区各看各的投影（issue #23 Scope 明确保留这一选择） |
| Draft 转换 | 把 project 里的 draft issue 提升为真实 issue（GraphQL `convertProjectV2DraftIssueItemToIssue`） |
| 历史别名 | 外部身份注册表里被标记为"曾经是"的 id；它不再产生新的内容身份，但保留可追溯性 |

### 当前事实

- 沙箱定义与九字段记录模板由本栈底层交付：`docs/architecture/gate-e1-sandbox.md`；三类内容夹具的观测记录在 `docs/architecture/gate-e1-content-identities.md`。
- 本批次的夹具**另建**，不与 E1-1 的三个内容夹具重叠：一个共享 issue（加入两个 project）与一个待转换 draft（在 Project A 中创建）。
- 本仓库**没有**任何代码实现工作区级投影或外部身份注册表；本批次的产出是"本地应有行"的映射记录，不是实现。

### 栈内位置

本批次是四层栈的第二层，base 是 `test/e1-content-identities`。E1-1 交付沙箱与模板，本批次复用它们；E1-3 复用同一沙箱但使用它自己的可写夹具；E1-4 读全部记录并裁决。

### 上游依据

- issue #23 的六条验收条件（本计划 `Validation and Acceptance` 逐条对应）。
- issue #4 的第 1 条（同一外部对象在两个工作区 → 一条外部身份、两条成员关系、每个工作区一条投影）与第 3 条（draft 转换后内部工作项身份不变，旧外部身份降级为历史别名）。
- issue #23 Scope 的 out-of-scope：不做跨工作区全局工作项聚合；本批次验证的是"工作区级投影"这个选择本身。

## Design / Spec

### D1 两个工作区用两个 project 表达，不用两个账号

"两个工作区"在本门禁里落地为同一个账号下的两个 Project v2。理由是 issue #23 要求"通过一个 connector account 同步两者"——两个账号会把变量从"工作区边界"变成"账号边界"，从而测不到想测的东西。

### D2 规划字段的隔离必须被观测，不能被推断

验收条件要求"两个工作区可以持有不同的规划字段值而不互相覆盖"。这条不能靠"project 是独立的所以肯定不覆盖"来推断：字段值挂在 `ProjectV2Item` 上而不是内容上，正是本批次要证实的命题。实验里对同一个 issue 的两条成员关系写入**不同的** Status 值，再把两个 project 各自读回。

### D3 转换前后的 id 变化必须逐项记录，包括"没变"

Draft 转换可能改变成员关系 id、内容 id，或两者都不变。三种结果都合法，但必须区分：如果成员关系 id 变了而内容 id 没变，模型只需更新成员关系身份；如果内容 id 也变了，就必须靠历史别名把它接回同一个工作项。**先记录，再判定**，不允许先写结论再找证据。

### D4 判定"内部工作项 id 不变"的操作定义

内部工作项 id 由本地模型生成，与外部 id 无关。因此验收条件"转换后内部工作项 id 逐字节相同"的可判定形式是：

> 转换前后两条观测映射到**同一条外部身份注册表记录**（内容身份），因此解析出的内部工作项 id 相同；判定证据是"转换后新内容 id 被登记为历史别名的后继，而不是新建一条内容身份"。

这条定义写进记录，使 E1-4 可以逐字引用它做裁决。

### D5 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 用两个账号模拟两个工作区 | 把"工作区边界"换成"账号边界"，测不到连接器账号内的工作区隔离 |
| 只读回一个 project 的字段值 | 无法区分"字段值挂在成员关系上"与"字段值挂在内容上"这两种模型 |
| 断言转换后 id 一定不变 | 结论先于观测；平台的真实行为必须决定结论 |
| 把 draft 转换做成对真实项目的操作 | 转换是不可逆的形态变更，只能发生在一次性沙箱里 |

## Global Constraints

- 本批次只改文档：`docs/exec-plan/active/2026-09-21-gate-e1-membership-and-draft.md`、`docs/architecture/gate-e1-membership-and-draft.md`、`docs/architecture/README.md`、`docs/README.md`。
- 不新增 `packages/` 或 `tests/` 下的代码；不改 E1-1 交付的 `gate-e1-sandbox.md` 与 `gate-e1-content-identities.md`（本批次只读它们）。
- 夹具只建在 E1-1 定义的沙箱里；不得在 `SingularityKChen/harness-projects` 或其 Projects 看板上创建夹具。
- 记录中不得出现凭据、token、本机绝对路径、本机用户名或 hostname。
- 文档改动 ≤ 1500 行（按 `node scripts/rule-checks.mjs size <base>` 度量，base 为 `test/e1-content-identities`）。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch 1 · 多项目成员关系与 Draft 转换（本批次，issue #23）

**最小闭环**：两条身份场景各有观测记录与判定，且判定覆盖 issue #23 的六条验收条件。
**涉及文件**：`docs/architecture/gate-e1-membership-and-draft.md`、`docs/architecture/README.md`、`docs/README.md`

- [ ] 建夹具：一个 issue 加入 Project A 与 Project B；一个 draft 建在 Project A
- [ ] 实验 1：同一个内容 id 对应两条 `ProjectV2Item.id`；两个 project 的字段值分别读回
- [ ] 实验 1 写入：对两条成员关系写入**不同**的 Status 值，再分别读回，断言互不覆盖
- [ ] 实验 2：记录转换前 draft 的 `ProjectV2Item.id` 与内容 id
- [ ] 实验 2：执行转换，记录转换后的 `ProjectV2Item.id` 与内容 id，逐项标出"变了/没变"
- [ ] 实验 2：按 D4 的操作定义给出"内部工作项 id 不变"的判定与历史别名登记方式
- [ ] 两条实验按九字段模板填写，含"复现"字段
- [ ] 更新 `docs/architecture/README.md` 与 `docs/README.md` 索引

**验证**：

```bash
grep -c '^### 实验 ' docs/architecture/gate-e1-membership-and-draft.md   # 期望：2
grep -n '历史别名' docs/architecture/gate-e1-membership-and-draft.md     # 期望：≥ 1 行，且给出登记方式
node scripts/rule-checks.mjs disclosure origin/main                       # 期望：exit 0
node scripts/rule-checks.mjs size test/e1-content-identities              # 期望：文档 ≤ 1500，exit 0
git diff --check test/e1-content-identities...HEAD                        # 期望：无输出
```

**回滚**：`git revert` 本批次提交；栈回到"只有三类内容身份证据"的上一版。沙箱里的转换不可逆，但沙箱是一次性的。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 一条外部身份、两条成员关系、每个工作区一条投影 | 实验 1：同一内容 id 对应两条 `ProjectV2Item.id`，记录里给出"本地应有行"的计数 | 待验证 |
| 2 | 两个工作区可以持有不同的规划字段值 | 实验 1 的写入与读回：两个 project 的 Status 值不同且各自读回正确 | 待验证 |
| 3 | 转换后内部工作项 id 不变 | 实验 2 按 D4 的操作定义给出判定，并给出历史别名登记方式 | 待验证 |
| 4 | 旧 draft 身份登记为历史别名、新身份为主 | 实验 2 的"本地应有行"明确两条外部身份记录及其主/别名状态 | 待验证 |
| 5 | 成员关系 id 变化只更新成员关系身份 | 实验 2 逐项列出转换前后的 id 变化；若成员关系 id 变化，记录"工作项未被删除重建"的依据 | 待验证 |
| 6 | 九字段模板逐字复用 | 两条实验记录的字段名与 E1-1 模板一致 | 待验证 |
| 7 | 记录不含凭据与本机信息 | `disclosure` exit 0，且人工五类目核对无命中 | 待验证 |

## Progress

- [ ] (2026-09-21) 建立本批次夹具（共享 issue、待转换 draft）
- [ ] 实验 1 · 多项目成员关系与字段隔离
- [ ] 实验 2 · Draft 转换前后的身份变化
- [ ] 索引更新与发布面自查

## Surprises & Discoveries

（观测期间如实记录。）

## Decision Log

- **Decision**：用同一个账号下的两个 Project v2 表达两个工作区。
  **Rationale**：issue #23 要求两者经同一个 connector account 同步；换账号会把被测变量从工作区边界换成账号边界。
  **Date/Author**：2026-09-21 / agent

- **Decision**："内部工作项 id 不变"按 D4 的操作定义判定，而不是按外部 id 相等判定。
  **Rationale**：内部 id 由本地模型生成，与外部 id 没有数值关系；可判定的形式是"转换前后的观测解析到同一条内容身份"。不给出操作定义，这条验收条件只能靠解释通过。
  **Date/Author**：2026-09-21 / agent

## Idempotence and Recovery

- 实验 1 的读与写可重复；重复写入会覆盖同一个字段值，不产生新对象。
- 实验 2 的转换**不可逆**：重跑需要按沙箱定义重建沙箱并重建夹具。记录里写明这一点。
- 验证命令只读且可重复；回滚单位是单个提交。

## Interfaces and Dependencies

- **上游**：`docs/architecture/gate-e1-sandbox.md`（沙箱定义与九字段模板，E1-1 交付）、`docs/architecture/gate-e1-content-identities.md`（三类内容身份证据）。
- **外部工具**：`gh` 与 GitHub GraphQL API。
- **后续工作项**：E1-4（#25）读取本记录裁决 #4 的第 1、3 条行为。

## Outcomes & Retrospective

完成后填写：两条实验的实际判定、转换前后 id 变化的实际形态、以及"工作区级投影"这一选择是否需要修订。

## Bottom Change Note

- 2026-09-21：首次创建。原因：issue #23 要求复用 #22 的沙箱与模板，先写 ExecPlan 再开始观测。
