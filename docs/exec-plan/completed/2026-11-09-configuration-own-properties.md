# 配置自有属性保真 ExecPlan

> 状态：本地工程实现与自查完成，待独立验收、最终发布检查与人类 PR 评审；创建：2026-11-09（Asia/Singapore）
> 正式路径：`docs/exec-plan/completed/2026-11-09-configuration-own-properties.md`
> Issue：#309；规范：`PLANS.md`、`AGENTS.md`

## Purpose / Big Picture

受信 schema 声明的配置字段无论是否与 JavaScript 原型属性同名，都能保存、读取并在重开后保持原值；缺失的可选字段保持缺失。最小成功证据是同一共享契约在 Fake 与真实 SQLite 上保留 `__proto__`、`constructor`、`toString`，同时拒绝未知、缺失必填与非法值。

## Context and Orientation

`packages/capabilities/src/connector-account.ts` 的 `parseBindingConfiguration` 是两个 Storage 适配器唯一配置解析器；适配器用真实挂载的 implementationKey 选择受信 schema，并在读写及重开时复验。`snapshotPolicy` 已用无原型对象保留 schema 的特殊字段，但配置复制仍向普通 `{}` 索引赋值，配置取值仍经原型查找。于是 JSON own `__proto__: true` 被接受后丢失，absent optional `constructor`、`toString` 被当成继承函数而拒绝。现有特殊名测试只证明 schema 保真。

本计划闭合 #309 全部现行工程 AC；不表示存在已部署的原型污染事故。配置 round trip 指 put→get→SQLite close/reopen 或 Fake export/import 后逐字段一致，不涉及历史数据库迁移。

## Design / Spec

裁定采用普通对象输出加 own-property 读取及安全 data-property 构造。schema 循环先 `Object.hasOwn(configuration, name)` 区分缺省；显式 own undefined 继续拒绝；通过原有类型/枚举/pattern/maxLength 检查后，用 `Object.fromEntries` 或 `Object.defineProperty` 创建 own data property，不能执行 `__proto__` setter。优先选局部最短清楚实现；不需要通用深克隆或第二解析器。

备选无原型输出也可避免 setter，但会改变返回对象的原型与既有 deepEqual 观察语义，故不选。只屏蔽三个名字或仅修 `__proto__` 会保留 optional inherited-name 错误，故不选。范围仅配置字段 own reads/copy；不把本项扩成账号、record/ref、Host wire 的全局解析改造。

关键不变量：只有 schema own 声明字段可保存；合法 false/空字符串不能因 truthiness 消失；必填缺省不能从原型补值；输出保留普通对象语义；校验失败零写入；调用方和读回副本变更不能修改存储；真实挂载仍决定 schema。

## Global Constraints

分支 `fix/configuration-own-properties`，工作树 `.worktrees/configuration-own-properties-20261109`，从 main 独立 PR，无其他候选或 #583/#584/#585 技术依赖。单一 owner 文件集：`packages/capabilities/src/connector-account.ts`、`tests/contract/suites/storage-connector-account.js`、`tests/contract/storage-connector-account.test.js`、`tests/integration/storage-connector-account.test.js`，以及正式路径的本 ExecPlan。`docs/README.md` 仅主控维护索引。测试装配守卫若需新增具名 case，同步准确更新表与数目；不删旧断言。

代码新增+删除（包括测试、fixture、配置）严格 <800，文档 <1300；预计生产 10–35、测试 100–195，总 110–230，实际以 diff 计算，较小闭环不填充。不得迁移旧数据、加兼容路径、改 API/Storage schema、修改用户数据库、改规划字段或依赖关系；不发模型请求、不自行合并。

## Plan of Work

### Batch 1 · 配置解析与双适配器保真

最小闭环：合法特殊名配置在共享读写与重开中保真，非法或缺省配置维持原约束。主文件为共享 parser 与共享 Storage 契约。

先写判别测试：JSON.parse 构造 own `__proto__`；分别及组合声明三种特殊名；覆盖 boolean false、合法 string、enum；检查 own keys、值、JSON 序列化和普通输出原型。先运行 V1，旧实现必须因丢字段或 optional 误拒绝变红，不能以 import/fixture 失败充当 RED。再局部修 parser；在同一 adapter suite 检查缺 optional、required 缺省、unknown 特殊名、显式 undefined、嵌套/数组/symbol 拒绝、输入与返回副本隔离。用真实临时 SQLite close/reopen 与 Fake export/import 验证，不补第二适配器实现。

所有命令在检出上述分支的工作树根运行。V1：`pnpm test:file tests/contract/storage-connector-account.test.js tests/integration/storage-connector-account.test.js`，期望新断言先 RED 后全部通过。V2：`pnpm run typecheck`，期望退出 0。V3：`pnpm run boundaries`，期望退出 0。新失败或边界变更才扩大验证。本次共享持久化解析器更改补充 V5：`pnpm test`，覆盖契约、集成与 E2E；期望退出 0，任何失败按层与用例如实记录。

发布前 V4：`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`、`git diff --numstat origin/main...HEAD`，期望机械扫描无未处理项、diff 无空白错误；按新增+删除复核本计划更严预算，并人工检查凭据、本机身份、个人信息、内部系统、保密字样。Git 操作经 argv/library API；PR 描述含本计划 Batch 1、真实证据、风险/回滚、`Closes #309`。最终 push 后回读实际 PR head/base/checks/issue linkage/完整 threads，当前 head 验证通过才 ready；人类决定 merge。

未提交阶段对实际工作树运行本脚本导出的 `scanDiff` 与 `tally`（Git 通过 argv 读取 `diff -U0 origin/main` 与 `diff --numstat origin/main`），并执行 `git diff --check`；这不替代 commit/push 后的 V4 与远端回读。

回滚点为本 PR 完整提交；失败先保留 RED 证据，修 parser 或 fixture，不触碰其他候选。

## Validation and Acceptance

V1 必须证明三种声明特殊字段在两个适配器和重开后逐字段一致；缺 optional 不产生 own 属性，required/unknown/undefined/非法类型仍拒绝，失败旧值未变，副本 mutation 隔离。V2–V4 证明类型、边界与发布面；未提交阶段补充工作树差异扫描，最终 commit/push 后由主控重新执行发布门禁。对抗审读至少尝试将实现退回 indexed assignment 或去掉 hasOwn，新的判别断言应重新失败；这是局部机制证据，不声称完整产品/UAT或部署事件修复。

## Progress

- [x] (2026-11-09 19:49 +08) 两路独立设计输入与真实 parser/共享测试调查完成，收敛最小配置闭环。
- [x] (2026-11-09) Batch 1 本地实现：窄基线通过；新用例先在两个适配器 RED，再 GREEN；真实重开、输入/输出副本隔离、缺省/拒绝路径与两种机制回退均验证，V2/V3 通过。
- [x] (2026-11-09) V5 完整项目测试、工作树机械扫描、五类人工审读与 diff 空白检查通过。
- [x] (2026-11-09 20:01 +08) 独立验收无可行动 P0–P3；独立 V1 为20/20，V2通过，V3为9/9，两机制回退各被双适配器捕获并恢复。最终提交后的发布与远端事实按 V4 及 PR 回读命令判定。
- [x] (2026-11-09 20:01 +08) 工程闭环归档并更新索引；人类 PR 评审、合并与发布接受属于后续门，本计划不冒领。

## Surprises & Discoveries

schema 的 `__proto__` 已有保护，不能由此推断配置输出安全；真实故障位于 shared parser 的 `configuration[name]` 与 `copied[name]`。Fake/SQLite 已共享解析，不需扩展生产文件集；普通输出可避免无必要返回契约变化。

新用例在旧实现在 put 后首次 get 处失败，而非在 put 处拒绝：`__proto__` 的布尔值先被索引复制静默丢失，读口复验才将继承原型值作为配置读取。窄 RED 为原 18 条通过、新共享用例两个适配器失败；修复后共 20 条通过。只回退复制或只回退 own 判断，两次均为 18 通过/2 失败，恢复后 20 通过。证据来自本分支工作树执行 V1。

V4 工具默认只扫描已提交 HEAD。草稿 HEAD 的成功不能证明尚未提交的实现安全，因此工作树追加同脚本导出函数的机械扫描与增删计数；最终提交后主控仍须重跑正式 V4。

## Decision Log

Decision：采用 own reads + 普通 own data-property 构造，独立 main PR。Rationale：同一根因完整修复且保持当前返回语义，既有工程 PR 不构成前提。Date/Author：2026-11-09 19:49 +08 / 独立收敛评审者。

Decision：不扩成全局原型/访问器加固，不做旧数据迁移。Rationale：本 issue 已具体限定配置保真，扩大 trust boundary 会增加未经复现的风险和验证面。Date/Author：2026-11-09 19:49 +08 / 独立收敛评审者。

Decision：在未提交交接时保持本计划 active，并区分本地工程自查、独立验收、远端发布门禁与人类 PR 评审。Rationale：子任务未获 commit/push 授权，不能将草稿 HEAD 或本地测试冒充最终 PR 状态；主控独立验收后再归档。Date/Author：2026-11-09 / 实施 owner。

## Idempotence and Recovery

测试使用隔离临时库，可重复；原测试 fixture 负责关闭和清理。修复只改未来解析行为，不变 schema，不静默删改历史配置。测试失败不修改业务库；回退完整 PR 恢复原行为。若真实读回触及另一 production 根因，先更新计划和预算，不用适配器分叉掩盖。

## Interfaces and Dependencies

使用仓库现有 Node >=22、pnpm 10.28.2 和两个适配器；`parseBindingConfiguration` 签名及 `BindingConfigurationRecord` 不变。不新增包、凭据或外部 API。策略仍由受信 composition root 提供，未知实现键拒绝规则保持。

## Outcomes & Retrospective

原草稿“尚未实现或运行新测试”已被本节 2026-11-09 本地工程结果取代。生产修改局限为缺省判断使用 `Object.hasOwn`，合法值通过 `Object.defineProperty` 构造普通对象的 own enumerable/writable/configurable data property；未修改适配器、Storage schema 或公开签名。共享契约增加一个用例，分别与组合覆盖三个特殊名，并覆盖全缺省 optional 重开、false、空字符串、枚举、非法值拒绝及副本隔离；装配表和数目同步维护，旧断言全部保留。

在 `fix/configuration-own-properties` 工作树、草稿提交 `ebc51d7a0346` 加本次未提交实现上，V1 baseline 为 18/18，RED 为 18/20，GREEN 为 20/20；两次机制回退均重新捕获缺陷，恢复后 GREEN。V2 退出 0，V3 为 9/9。V5 完整项目测试退出 0，契约/集成/E2E 三层无失败、无跳过。实际工作树机械扫描与五类人工审读均未发现未处理项，diff 空白检查通过；最终提交后的 V4 与远端回读是发布动作的即时门；易失状态以 `gh pr view 586 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup`、`gh pr checks 586 -R SingularityKChen/harness-projects` 和完整 review threads 回读为准，期望 base=main、关闭#309、当前 head 检查通过。本地结果不代表最终远端 HEAD、hosted CI、完整产品/UAT 或人类评审。无新增技术债，无历史数据迁移；独立验收与 GitHub 发布操作留给主控。

## Bottom Change Note

2026-11-09 19:49 +08：创建最终工程草稿，综合两路方案并按 concrete parser defect 收敛，明确普通输出、测试保留与独立 main 交付。

2026-11-09：完成局部 parser 修复及共享 TDD，记录两个机制回退的判别证据和已提交 HEAD 扫描限制，增加完整项目测试与未提交工作树交接门禁；未执行 commit/push 或 GitHub 写入。

2026-11-09 20:01 +08：独立验收确认无可行动发现，工程闭环移入 completed；保留最终远端即时门、人类 PR 评审和产品接受边界。
