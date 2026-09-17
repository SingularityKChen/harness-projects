# 协作与记忆建设 ExecPlan：参考致谢 + 项目管理 + 评审体系 + Engram

> 状态：Active  
> 创建：2026-09-17  
> 范围：仓库的对外说明、项目管理、评审流程与本地记忆配置；不改变产品代码与架构不变量  
> 触发：人类伙伴在许可证与发布面治理之后提出的四项后续工作

---

## Purpose / Big Picture

让这个仓库从"能构建、能约束边界"走到"能被协作"：外部读者知道它站在哪些公开工作的肩膀上；工作项有可追踪的载体与字段；PR 有固定的评审入口与归属规则；本机 agent 的记忆不再落到别的项目里。

完成后应达到的状态：

1. `README.md` 有一段"参考与致谢"，逐条说明**参考了哪个项目、参考了什么**，且每条都可点开验证。
2. 存在一个 GitHub Project（v2），字段与视图能表达本仓库的工作单元（ExecPlan / 批次 / 领域 / 阶段门禁），并有至少一批真实条目；维护方式写进仓库文档，任何人可照做。
3. PR 有与仓库约定一致的模板、明确的评审归属规则，以及可选的自动评审入口；评审意见落到行级评论而不是笼统总结。
4. 在本仓库工作区启动的 agent 会话，其 Engram 记忆落到项目 `harness-projects`，而不是 `ai-knowledge-bridge`；仓库内也有一份声明，使任何在本目录运行 Engram 的人得到同样的作用域。

---

## Context and Orientation

- 仓库 `SingularityKChen/harness-projects`：public，Apache-2.0，`main` 受保护（必须 PR + 1 批准 + `PR Fast Gate` + 线性历史 + 禁强推/删除；只允许 rebase 合并）。
- 工作约定在 `AGENTS.md`（文档落点、ExecPlan、批次、分支与 PR 规则、验证门禁），计划格式在 `PLANS.md`。这两份文档是本次四项工作的"相关文档"。
- 上游平台是公开项目 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)：它的 `.github/`（PR 模板、review-ownership、workflows）与 `docs/user/guide/github-review.md` 定义了它自己的评审体系；本计划的做法是**移植其可移植部分**，而不是照搬依赖其内部服务的部分。
- 上游工作流来源：[superpowers](https://github.com/obra/superpowers)（Jesse Vincent，MIT）与 OpenAI Codex 的 PLANS.md / ExecPlan 约定——本次要把这两个来源显式写进 README。
- Engram：本机记忆服务（`engram v1.20.0`，MCP 以 `mcp__engram__*` 暴露）。它按 MCP 进程的 cwd 推断项目名；当前 host-plane 行把 cwd 固定到了另一个仓库，因此本仓库的会话会把记忆写错项目。

---

## Design / Spec

### D1 README 的"参考与致谢"只写可验证的来源

每条来源必须满足：能给出公开 URL、能说清"参考了什么"、不暗示隶属或背书。因此只列三条实质来源 + 一条工具链说明：

| 来源 | 参考了什么 |
|---|---|
| DeepSeek Harness（公开仓库） | 宿主平台与架构方向：Host 权威状态、React-free 客户端模型、Slot 组合、能力定义与提供方分离 |
| superpowers（MIT） | 工作流骨架：先设计后计划、隔离工作区、批次执行与任务后评审；本项目用中性命名改写，并把 spec 与 plan 收敛为同一份 `docs/exec-plan/` 文档 |
| OpenAI Codex 的 PLANS.md / ExecPlan 约定 | ExecPlan 的章节结构（Purpose / Big Picture、Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective） |

工具链（Node 内置测试运行器、pnpm workspace、TypeScript、GitHub Actions）另起一行，不混进"参考"表——它们是依赖，不是启发来源。

### D2 GitHub Projects 承载"工作单元"，字段与批次语义对齐

项目（v2）不是另一个待办清单，而是把 `AGENTS.md` 的工作单元显式化：

- **Status**（内置）：Todo / In Progress / In Review / Done —— 与 PR 生命周期对齐，`In Review` 表示 PR 已提交待评审。
- **Type**（单选）：feature / fix / docs / chore / refactor / test —— 与提交类型一致。
- **Area**（单选）：domain / capabilities / core / controller / client / ui-model / ui / providers / storage / apps / tests / docs / repo —— 与包所有权一致。
- **ExecPlan**（文本）：该条目所属计划路径，例如 `docs/exec-plan/active/2026-09-17-xxx.md`；无计划则留空。
- **Batch**（文本）：批次名，与 ExecPlan 的 `Plan of Work` 一致。
- **Gate**（单选）：E1 / R1 / — —— 阶段门禁，只有真正阻塞发布的条目才填。

**维护规则**（写进仓库文档，不靠记忆）：条目与 PR 一一对应或一对多但同属一个闭环；PR 描述必须给出 ExecPlan 路径与批次；合并后 Status → Done；不为了减少条目数量而聚合。

### D3 评审体系移植"可移植部分"

DeepSeek Harness 的评审体系里，只有一部分是通用的：

- **必须移植**：PR 模板（把"闭环 / 关联 / 验证证据 / 风险与回滚"固定下来，与本仓库 `AGENTS.md` §8.4 一致）、评审归属（路径 → 评审人/领域负责人的显式声明）、评审意见的严重度分级与行级评论要求。
- **可以简化**：其 review-ownership 面向大型多包仓库，本仓库当前只有单一维护者，因此归属表按"领域"而非"人"声明，保留扩展位。
- **不适用**：任何依赖其内部服务、内部凭据或内部 agent preset 的自动化；以及需要长期在线 webhook 端点的部分（本机没有公网入口）——这部分只作为**可选增强**写入文档，不默认启用。

自动评审只在满足"不需要常驻公网端点 + 不写入仓库状态之外的东西"时才落到 CI；否则只提供本地一条命令。

### D4 Engram 作用域用"两层"修复

Engram 的项目由 MCP 进程 cwd 决定，所以要在两处声明：

1. **仓库级**：`<repo>/.engram/config.json` 声明 `project_name`（engram 二进制内的提示信息证实了该文件与字段名：`Fix .engram/config.json so project_name is a non-empty project name.`）。这解决"在本目录运行 engram / 其他 agent"的情形。
2. **会话级**：为本仓库新建一个 DSH agent preset，挂载同名 `serverName: engram` 的 MCP 行，`--project harness-projects` 且 cwd 指向本仓库。工具注册表以"作用域内的注册覆盖全局"解析，因此该 preset 的会话写入正确项目，其它会话不受影响。

不改 host-plane 的 engram 行：那会改变其他仓库的行为。

---

## Global Constraints

- 四项工作各自独立成 PR，互不依赖；每个 PR 必须能单独回滚。
- 不在仓库内写入任何凭据、token 与内部地址（延续发布面治理结论）。
- 不修改 `main` 的保护配置；不自行合并任何 PR。
- 项目管理与评审的规则必须落在仓库文档里；GitHub 侧配置只是这些规则的实例。
- 本机配置（`~/.dsh/.agent-presets/`）不属于仓库内容，变更需在 PR 描述里说明并记录到本计划。

---

## Plan of Work

### Batch 1 · README 参考与致谢

**最小闭环**：README 出现可验证的参考清单，且不引入任何品牌暗示。

**涉及文件**：`README.md`。

- [ ] 步骤 1：按 D1 写入"参考与致谢"与"工具链"两段；解释各来源被参考的具体内容。
- [ ] 步骤 2：核对三个链接均可匿名访问（HTTP 200）与许可证表述（superpowers 为 MIT）。

**验证**：`curl -s -o /dev/null -w '%{http_code}'` 对三个 URL 均返回 200；`grep` 确认表格里每行都写了"参考了什么"。  
**回滚**：revert 该 PR。

### Batch 2 · GitHub Projects

**最小闭环**：存在一个与本仓库工作单元对齐的项目，并且"怎么维护"写在仓库里。

**涉及文件**：`docs/project-management/README.md`（新增）、`AGENTS.md`（§0 与 §8 加索引）、GitHub 侧项目与条目。

- [ ] 步骤 1：创建项目并关联本仓库。
- [ ] 步骤 2：创建 D2 的字段（Type / Area / ExecPlan / Batch / Gate）。
- [ ] 步骤 3：为下一步真实工作建立条目（Gate E1 验证、数据模型与存储骨架、首个纵向切片、ADR 重述等），并写入字段值。
- [ ] 步骤 4：把字段、状态语义、维护规则与常用命令写进 `docs/project-management/README.md`。
- [ ] 步骤 5：视图（Board / Table / Roadmap）在文档里给出人工配置步骤——GitHub API 未公开视图创建能力，这一点如实写明。

**验证**：`gh project field-list` 回读字段；`gh project item-list` 回读条目与字段值；文档中的命令逐条可复制执行。  
**回滚**：删除项目不会影响仓库（文档 revert 即可）；条目为草稿/issue，可在项目内移除。

### Batch 3 · PR 评审体系

**最小闭环**：一个新 PR 打开后，作者能看到固定模板、评审人归属规则与一条可执行的评审入口。

**涉及文件**：`.github/pull_request_template.md`、`.github/CODEOWNERS` 或评审归属文件、`.github/workflows/`（若采用自动评审）、`docs/review/README.md`。

- [ ] 步骤 1：按 D3 落 PR 模板（闭环 / 关联 / 验证证据 / 风险与回滚），字段与 `AGENTS.md` §8.3 一致。
- [ ] 步骤 2：落评审归属规则（路径 → 领域所有者），并说明它与 `AGENTS.md` §2.2 依赖方向的对应关系。
- [ ] 步骤 3：确定自动评审形态：优先"本地一条命令 + CI 只做只读检查"；若采用 CI 自动评审，必须写明所需的 secrets 与权限边界。
- [ ] 步骤 4：把评审者该看什么、按什么严重度分级、意见落在哪里（行级评论）写进 `docs/review/README.md`。

**验证**：模板与归属文件被 GitHub 识别（模板在新建 PR 时出现；归属规则被 `gh api repos/.../codeowners/errors` 判定为无错——若使用 CODEOWNERS）。  
**回滚**：删除文件即可，不改变分支保护。

### Batch 4 · Engram 项目作用域

**最小闭环**：在本仓库目录下调用 Engram 写入的记忆，落到 `harness-projects` 项目。

**涉及文件**：`.engram/config.json`（新增，仓库内）、`docs/README.md` 或 `AGENTS.md`（一行说明）、`~/.dsh/.agent-presets/harness-projects/`（本机，不入库）。

- [ ] 步骤 1：写入 `.engram/config.json`（`project_name`），并确认它不被 `.gitignore` 误伤。
- [ ] 步骤 2：按 `editing-cordis-compositions` 技能创建本仓库的 agent preset（同名 `serverName: engram`、`--project harness-projects`、cwd 指向本仓库）。
- [ ] 步骤 3：验证：用 engram CLI 在仓库目录写入一条探针记忆，确认其 project 为 `harness-projects`，然后清理。
- [ ] 步骤 4：在仓库文档中说明该文件的作用与"没有该文件时的降级行为"。

**验证**：`engram search --project harness-projects` 能命中探针；`.engram/config.json` 内容为合法 JSON 且字段名为 `project_name`。  
**回滚**：删除仓库内文件与 preset 目录。

### Batch 5 · 验证与归档

- [ ] 步骤 1：逐条核对 Validation and Acceptance，把证据写入 `Outcomes & Retrospective`。
- [ ] 步骤 2：`pnpm verify` 全绿（本批不涉及代码，但门禁不得回归）。
- [ ] 步骤 3：把本计划移入 `docs/exec-plan/completed/`，更新 `docs/README.md` 索引。

**验证**：见下表。  
**回滚**：不适用。

---

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | README 有可验证的参考清单 | 三个来源链接匿名返回 200；每条写明"参考了什么" |
| 2 | 参考清单不暗示隶属 | 文本中不含"官方/合作伙伴/授权"等表述；商标免责声明仍然存在 |
| 3 | GitHub Project 存在且字段齐全 | `gh project field-list` 含 Type / Area / ExecPlan / Batch / Gate |
| 4 | 项目有条目且字段有值 | `gh project item-list --format json` 至少含 Gate E1 与数据模型两类条目，且字段非空 |
| 5 | 维护方式可复制 | `docs/project-management/README.md` 中的命令逐条执行成功 |
| 6 | PR 模板生效 | `.github/pull_request_template.md` 存在且含四个必需小节；新建 PR 时自动填充 |
| 7 | 评审归属可验证 | 若使用 CODEOWNERS：`gh api repos/.../codeowners/errors` 无错误 |
| 8 | 评审入口可执行 | `docs/review/README.md` 给出的命令（本地评审 / 行级评论）可复制执行 |
| 9 | Engram 作用域正确 | 仓库目录探针记忆的 project = `harness-projects`；preset 文件存在且语法有效 |
| 10 | 工程门禁未回归 | `pnpm verify` 通过 |
| 11 | 每项工作可独立回滚 | 四个 PR 的文件集合互不重叠（除 `docs/README.md` 索引外） |

---

## Progress

- [ ] Batch 1：README 参考与致谢。
- [ ] Batch 2：GitHub Projects。
- [ ] Batch 3：PR 评审体系。
- [ ] Batch 4：Engram 项目作用域。
- [ ] Batch 5：验证与归档。

---

## Surprises & Discoveries

- Observation：Engram 的仓库级配置字段名可从二进制字符串中确认（`Fix .engram/config.json so project_name is a non-empty project name.`），因此无需猜测 schema。
  Evidence：`strings /opt/homebrew/bin/engram | grep '.engram/config'`。
- Observation：本会话的 shell 沙箱不允许写 `~/.engram`，因此 `engram` CLI 报 `migration: attempt to write a readonly database (8)`；这是沙箱限制而非 Engram 故障，MCP 侧（宿主进程）不受影响。
  Evidence：`touch ~/.engram/.sandbox-probe` → `Operation not permitted`；同一命令经 MCP 工具保存记忆成功。

---

## Decision Log

- Decision：README 的参考清单只列"可验证来源 + 参考了什么"，不列互操作平台与依赖工具。
  Rationale：把"受启发"与"依赖/集成"混在一张表里会让读者误以为存在隶属或赞助关系，而这正是发布面治理要避免的暗示。
  Date/Author：2026-09-17 / agent

- Decision：GitHub Projects 的字段与 `AGENTS.md` 的工作单元一一对应，而不是另造一套流程。
  Rationale：两套流程必然漂移；字段直接复用 ExecPlan / 批次 / 类型 / 领域这四个已有概念，文档与看板互为镜像。
  Date/Author：2026-09-17 / agent

- Decision：评审体系只移植"不依赖常驻公网端点"的部分，自动评审优先本地命令 + CI 只读检查。
  Rationale：本机没有公网入口，webhook 方案需要 tunnel 与长期在线端点，属于可选增强；把它设为默认会让仓库依赖一个随时可能失效的链路。
  Date/Author：2026-09-17 / agent（待 Batch 3 调研结论确认后细化）

- Decision：Engram 采用"仓库级 config + 会话级 preset"两层，而不改 host-plane 行。
  Rationale：host-plane 行只允许一个 cwd，改它会把其他仓库的记忆一起挪走；作用域内覆盖是工具本身支持的机制。
  Date/Author：2026-09-17 / agent

---

## Idempotence and Recovery

- GitHub 侧操作（项目、字段、条目）可重复执行：字段按名称查重，条目前先按标题查重。
- `docs/`、`.github/`、`.engram/` 的改动全部可 revert。
- 本机 preset 的创建是幂等的（覆盖同名文件）；若工具注册表冲突，删除该 preset 即回到 host-plane 行为。
- 若 Engram 探针写错项目：`engram delete <obs_id>`（默认软删除）。

---

## Interfaces and Dependencies

- 工具：`gh`（scope 含 `project`，可创建用户项目与字段）、`curl`、`engram v1.20.0`、DSH agent preset 机制（`~/.dsh/.agent-presets/<id>/`）。
- 平台契约：`main` 保护要求的检查名仍是 `PR Fast Gate`；本计划不得改变它。
- 上游参考：`deepseek-ai/deepseek-harness` 的 `.github/` 与 `docs/user/guide/github-review.md`；`obra/superpowers`；OpenAI Codex 的 PLANS.md / ExecPlan 约定。

---

## Outcomes & Retrospective

（完成后回填。）

---

## Bottom Change Note

- 2026-09-17：首次创建。原因：四项后续工作横跨对外说明、项目管理、评审与本地记忆，各自都有"做错了要回滚"的代价，需要一份可复核的计划与验收标准。
