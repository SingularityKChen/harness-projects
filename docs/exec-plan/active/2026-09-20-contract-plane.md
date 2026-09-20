# 契约栈（A）ExecPlan

> 状态：Active
> 创建：2026-09-20
> 范围：把 `packages/domain` 与 `packages/capabilities` 从空骨架变成可被测试的能力契约，并提供满足契约的离线替身；不写任何编排逻辑。
> 上游输入：`AGENTS.md`、`PLANS.md`、`docs/exec-plan/active/2026-09-20-mvp0-parallel-stacks.md`（控制计划）、本机只读的上游设计输入（不随仓库分发）

## Purpose / Big Picture

完成后，一个没读过任何外部设计文档的人，只读 `packages/domain/src` 与 `packages/capabilities/src`，就能回答：这个系统里有哪些实体与身份、哪些能力域、一个 provider 失败时调用方能拿到什么、以及为什么 planning 事实与工程事实不会互相篡位。并且他能立刻跑起来：

```bash
node --test tests/contract          # 契约层：无网络、无凭据
pnpm run boundaries                 # 依赖方向仍然单向
```

最小成功证据：Planning 契约套件对离线 provider 全绿，而**从该 provider 删掉一个可选能力后，对应用例必须失败**——套件有牙，不是自我确认。

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 能力域 | Planning / Development / Delivery / Execution / Storage 五类可替换边界 |
| port | 能力域在 `packages/capabilities` 里的接口定义，不含实现 |
| 离线替身（fake） | 在 `packages/providers/fake` 内实现 port 的内存对象，带故障注入；MVP-0 的全部 provider 都来自它 |
| 契约套件 | 一个接受任意 port 实现、逐条断言契约行为的可复用测试函数；放在 `tests/contract` |
| capability key | 调用方用来分支的稳定字符串键；调用方不得按 provider 名字分支 |

### 当前事实

- `packages/domain/src/index.ts` 与 `packages/capabilities/src/index.ts` 只有一个 `packageId` 常量。
- 依赖方向由 `tests/contract/package-boundaries.test.js` 强制：`capabilities → domain`，`providers/* → capabilities, domain`；`capabilities` 不得 import 任何具体 provider。
- manifest 的依赖声明已在 Batch F1 落地：本栈新增的包必须自己在 manifest、`tsconfig.json` 的 `paths`、边界测试的 `EXPECTED` 三处登记。
- Node 版本 26，测试直接 import `.ts` 源码（原生类型剥离），没有构建步骤。

### 本栈关闭的上游缺口

上游设计把 `Storage` 列为必须存在的稳定能力，却没有给出方法签名；`relation_class` 的第三个取值只有名字没有语义；`ExecutionProvider` 没有 `reconcile` 而设计要求"没有 webhook 也必须最终正确"。这三处必须在本栈内**显式决策并写进代码注释与 Decision Log**，不允许留成实现者的自由发挥。

## Design / Spec

### D1. 领域层负责"什么算同一个东西"

`packages/domain` 是依赖图的叶子，因此它承担所有跨层共享的词汇：稳定标识、实体种类、外部身份角色、关系语义、状态归一化、结构化错误码。判据是**该概念是否需要在没有 storage、没有 provider 的情况下被判定**——是，则属于领域层。

关键不变量（每条都要有测试）：

1. 内部实体 id 是不透明且永久的：外部 id 变化不会改变它；
2. Draft→Issue 提升后，内部 WorkItem id 不变，旧身份变 `historical`，新身份变 `primary`，且同一实体任一时刻只有一个 active primary；
3. 同一外部对象出现在两个工作区时，外部身份只有一份，工作区各自持有投影；
4. 工程事实（CI 失败、Agent 完成、PR 合并）在任何状态策略下都不写 planning 状态；
5. 确定性发现的关系只能进入候选态，不能直接进入已确认态。

### D2. 能力层只定义"调用方能依赖什么"

`packages/capabilities` 定义五组 port、稳定 capability key、四态访问级别（available / read_only / unavailable / degraded）、结构化错误模型与观察（observation）形状。它**不含任何实现**，也不 import 任何具体 provider。

错误模型分两层且必须显式映射：

| 层 | 形状 | 用途 |
|---|---|---|
| provider 层 | `ProviderResult<T>` = 成功值或 8 个错误码之一（not_supported / permission_denied / not_found / conflict / rate_limited / unavailable / invalid_input / ambiguous_result） | provider 把平台失败翻译成结构化结果，不用异常做控制流 |
| 调用方层 | 11 个 `ProjectErrorCode` + `retryable` + `recovery` + 已确认值与尝试值 | 调用方能显示"上次确认的值 vs 这次尝试的值"，并知道能提供哪种恢复动作 |

### D3. 离线替身集中在一个包里

`packages/providers/fake` 汇总五个域的离线实现（含 Storage 的内存实现）与故障注入计划。理由：契约套件与 MVP-0 链路需要的是"一组能一起工作的替身"，把它们拆成五个包会产生五个只有测试用的 manifest 与五份锁文件改动，却没有任何独立验收价值。

故障注入是替身的一等公民：离线、权限被拒、创建结果不确定、执行启动失败、重复事件、乱序观察都必须能被构造出来，因为 `tests/README.md` §3 要求这些场景显式覆盖。

### D4. 契约套件放在测试层

套件是**可复用函数**（接受任意 port 实现），放在 `tests/contract/suites/`。这样将来真实 GitHub provider 落地时，同一套件可以直接对它运行；把套件放进 `packages/capabilities` 会让一个产品包依赖测试运行器，那正是包边界矩阵要避免的方向。

每个套件必须至少有一条"删掉实现里的某项能力就会失败"的判别性用例。

### D5. 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 把契约套件写进 `packages/capabilities` | 产品包会依赖 `node:test`；契约套件是验证工具，不是产品 |
| 五个域各建一个 fake 包 | 五个仅供测试的包与五份 manifest 改动，没有独立验收价值 |
| 直接用真实 GitHub / git / Actions provider 跑套件 | 需要凭据与网络，违反 `AGENTS.md` §1.4 对可离线验收切片的要求 |
| 用 `unknown`/`any` 容纳尚未决定的部分 | 会把"未验证"伪装成"已定义"；未决处必须显式写成一个窄接口加注释 |

## Global Constraints

- 不引入任何运行时依赖；只用 Node 内建模块（`node:crypto` 等）。
- 单文件 ≤ 200 行，单函数 ≤ 40 行（纯枚举/映射表除外）。
- fixture 不得包含真实账号、仓库、token 或本机路径；公开仓库内的任何字符串都在发布面内。
- 每个包的 `src/index.ts` 必须保留 `Responsibility:` 与 `Allowed imports:` 两行注释。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch A1 · 领域模型（Closes #75）

**最小闭环**：标识、实体、外部身份角色、关系语义、状态归一化与错误码成为可被纯函数测试的领域模型。

**涉及文件**：`packages/domain/src/**`、`tests/contract/domain-identity.test.js`、`tests/contract/domain-status.test.js`

- [ ] `ids.ts`：branded id 类型与生成函数
- [ ] `enums.ts`：实体种类、内容种类、归一化状态、关系类别/类型/来源、执行上下文状态、访问级别、写入状态
- [ ] `identity.ts`：外部身份角色规则 + Draft→Issue 提升的纯函数
- [ ] `entities.ts`：实体接口与规划内容的三态判别联合（work_item / change_request / redacted）
- [ ] `relations.ts`：业务语义边与系统事实边的常量表、候选关系规则
- [ ] `status.ts`：状态归一化、状态策略三态语义、派生标记（Attention 等只能是派生值）
- [ ] `errors.ts`：`ProjectErrorCode`、`recovery`、构造函数与 provider 错误码映射

**验证**：

```bash
node --test tests/contract
node_modules/.bin/tsc --noEmit
```

期望：全部通过；把 Draft→Issue 提升改成"新建实体"后，身份不变性测试失败。

**回滚**：`git revert` 本批提交；`packages/capabilities` 尚未引用这些符号。

### Batch A2 · 能力契约与结构化错误模型（Closes #29）

**最小闭环**：五个域的 port、capability key、四态访问级别、结构化错误模型与观察形状被冻结，并被 `tests/contract/capabilities-*.test.js` 固定；本批次只定义，不含任何实现，也不 import 任何具体 provider。

**涉及文件**：`packages/capabilities/src/**`、`tests/contract/capabilities-*.test.js`

- [x] `result.ts`、`capability-keys.ts`、`observation.ts`
- [x] `planning-provider.ts`：读能力全套 + 可选写能力，内容三态联合
- [x] `development-provider.ts`、`delivery-provider.ts`、`execution-provider.ts`、`storage.ts`：签名冻结（含 `Storage` 的方法分组）
- [x] `registry.ts`：绑定引用与已解析 provider 的组合视图
- [x] 契约测试：8 个错误码闭集与 retryable/recovery 语义、capability key 不含平台名、`intersectAccess` 语义、11 个调用方码映射完整、去重键规则

**验证**：

```bash
node --test tests/contract
node_modules/.bin/tsc --noEmit
node scripts/rule-checks.mjs size feat/domain-identity-model
```

期望：全部通过；代码变更不超过 1000 行上限。

**回滚**：`git revert` 本批提交；A1 与 F1 不受影响（回滚后该包回到只导出 `packageId` 的骨架状态）。

**批次划分订正（2026-09-20）**：原方案把 #29 与 #30 合成一个 PR。实测五个域的接口定义连同离线 provider 与 Planning 契约套件会超过 `AGENTS.md` §8 的 1000 行代码上限，因此拆成两个 PR：#29 只交付契约层（本批次）；#30 与 #31 合并为下一个 PR（见 Batch A3），由它一并交付离线替身与四域套件。被取代的控制计划决定见 `2026-09-20-mvp0-parallel-stacks.md` 的 Decision Log。

### Batch A3 · 离线替身与四个域的套件（Closes #30 #31）

**最小闭环**：Planning 契约套件连同通过它的离线 provider 一起存在；development / delivery / execution 三域也有套件与离线替身，Storage 的内存替身满足其契约；MVP-0 链路需要的全部构件都能在无凭据条件下构造。本批次合并了原方案的 #30 与 #31（见 Batch A2 的划分订正）。

**涉及文件**：`packages/providers/fake/{package.json,src/**}`、`tests/contract/suites/{planning,development,delivery,execution,storage}.js`、`tests/contract/{planning,development,delivery,execution,storage}-contract.test.js`、`package.json`（根，新增该包的 devDependency）、`pnpm-lock.yaml`、`tsconfig.json`、`tests/contract/package-boundaries.test.js`

- [ ] 离线 Planning provider：分页、内容三态、字段写、draft→issue 转换、故障开关
- [ ] Planning 契约套件：列出与分页、内容三态、缺能力、权限被拒、离线、重复观察得到同一稳定键
- [ ] development 替身：仓库身份、分支创建、工作树创建/移除、变更请求读写、原生谱系
- [ ] delivery 替身：按提交查流水线与检查、可选部署能力、写操作返回 not supported 且不改状态
- [ ] execution 替身：启动、查询、可选取消、失败映射到带阶段的错误
- [ ] Storage 内存替身：事务、身份与实体、执行上下文、关系、写尝试、修订号，并支持"换一个实例读同一份内容"以模拟重启
- [ ] 五个套件各至少一条判别性用例

**验证**：

```bash
node --test tests/contract
pnpm run boundaries
```

期望：全部通过；从离线 provider 移除一个可选能力后，对应的 "not supported" 用例失败；把 delivery 替身的写操作改成静默成功，`not supported` 用例失败。

**回滚**：`git revert` 本批提交；A2 的 Planning 套件仍自洽（A2 只含契约层，回滚 A3 不会碰它）。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 领域层零依赖且标识可区分 | `pnpm run boundaries`；把 `WorkItemId` 传给要求 `ChangeRequestId` 的函数时 `tsc` 报错 | 待验证 |
| 2 | Draft→Issue 保持内部 id | `node --test tests/contract` 的身份用例 | 待验证 |
| 3 | 工程事实不改写规划状态 | 状态策略三态各一条用例 | 待验证 |
| 4 | 五个域 port 签名冻结 | `packages/capabilities/src/**` 每个 port 有类型级测试或契约套件覆盖 | 待验证 |
| 5 | 错误模型覆盖 8 个 provider 码与 11 个调用方码，且映射有测试 | `node --test tests/contract/capabilities-errors.test.js` | 待验证 |
| 6 | 套件有牙 | 每个域一条"删掉能力即失败"的注入缺陷实验记录 | 待验证 |
| 7 | 离线 | 全部用例在断网、无凭据下通过 | 待验证 |

## Progress

- [ ] Batch A1 · 领域模型（#75）
- [x] (2026-09-20) Batch A2 · 能力契约与结构化错误模型（#29）
- [ ] Batch A3 · 离线替身与四个域的套件（#30 #31）

## Surprises & Discoveries

（实现期间如实记录：与预期不符的事实 + 证据。）

## Decision Log

- **Decision**：`Storage` port 的签名、分组与命名由本批次冻结；这些**不是上游给定的**，上游只给了 `Storage` 这个名字。
  **Rationale**：core 与持久化栈都需要一个确定的接口才能并行；不冻结就只能靠实现者各自想象，集成时必然返工。分组固定为：事务 / 工作区与绑定 / 身份 / 规划 / 工程 / 执行 / 关系 / 同步 / 写尝试 / 投影修订号，写进 `packages/capabilities/src/storage.ts` 的文件头注释与类型分组。
  **Date/Author**：2026-09-20 / agent

- **Decision**：契约套件放测试层，离线替身集中在一个包。
  **Rationale**：见 D3、D4。两者共同的效果是：产品包不依赖测试运行器，而真实 provider 落地时能复用同一套件。
  **Date/Author**：2026-09-20 / agent

- **Decision**：`ExecutionProvider` 契约里没有 `reconcile`，MVP 由 core 轮询 `getRun` 兜底。
  **Rationale**：上游设计要求“没有 webhook 也必须最终正确”，而执行域在 MVP 阶段没有可用的事件源；显式不提供观察流，比给一个永远返回空的 `reconcile` 更诚实——后者会让调用方误以为执行域有推送。该决定写进 `packages/capabilities/src/execution-provider.ts` 的契约注释，不允许被当成遗漏。
  **Unresolved**：等执行平台出现可用事件源时，再单独决定是否补 `reconcile`（届时它是可选能力，仍不得改变本批次的签名）。
  **Date/Author**：2026-09-20 / agent

## Idempotence and Recovery

- 验证命令全部只读且可重复：`node --test tests/contract`、`node_modules/.bin/tsc --noEmit`、`pnpm run boundaries`。
- 新增包的三处登记（manifest、`tsconfig.json` 的 `paths`、边界矩阵）必须同时改；只改其中一处的表现是 `pnpm run boundaries` 或 `tsc` 报错。
- 分支已推送后改写需先建恢复锚点并用精确 lease 强推：
  ```bash
  git branch backup/<branch>-before-reorg <当前 head>
  git push --force-with-lease=refs/heads/<branch>:<远端旧 head> origin <新 head>:refs/heads/<branch>
  ```
- 回滚单位是批次：`git revert` 一个批次后，下面那层仍然自洽。

## Interfaces and Dependencies

**对外提供的稳定接口**

```text
PlanningProvider / DevelopmentProvider / DeliveryProvider / ExecutionProvider / Storage
ProviderResult<T> / ProviderError(8) / ProjectErrorCode(11) / recovery
CapabilityKey / AccessLevel(4) / EffectiveCapability
ProviderObservation / dedupe key 规则
```

**依赖的仓库设置**

- Node 26（`.nvmrc`），测试直接 import TS，无构建步骤。
- `pnpm` 10.28.2（由 `packageManager` 固定）；本机沙箱需 `npm_config_manage_package_manager_versions=false`。
- 分支保护：只允许 rebase merge。

## Outcomes & Retrospective

完成后填写：实际落地的接口清单、与设计的偏差、被推翻的假设、留给切片栈的未决项。

## Bottom Change Note

- 2026-09-20：首次创建。原因：控制计划把 MVP-0 切出四条栈，契约栈需要自己的设计取舍与批次验收记录。
- 2026-09-20：订正批次划分：#29 独立成一个 PR（Batch A2），#30 与 #31 合并为下一个 PR（Batch A3）。原因：原方案单个 PR 含五域接口、离线替身与 Planning 契约套件，代码变更超过 `AGENTS.md` §8 的 1000 行上限；拆分后每批仍可独立验收。
