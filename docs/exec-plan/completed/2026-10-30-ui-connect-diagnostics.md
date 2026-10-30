# 连接失败的结构化解释与安全恢复 ExecPlan

> 状态：Completed（MMP 评审 P2 修复已独立复评）
> 创建：2026-10-30
> 范围：#434 的凭据、明确权限及目标不可见连接错误闭环
> 规范：根 `AGENTS.md`、`PLANS.md`；关联 Closes #434

## Purpose / Big Picture

连接 GitHub Project 失败时，用户能区分已被平台拒绝的凭据、平台明确报告的权限不足、以及不存在或当前授权不可见的目标，并获得安全下一步。平台没有证明的原因保持未知。最小成功证据是受控 HTTP/GraphQL 响应经真实 Host、controller 设置命令、typed remote、client 和当前 setup renderer 后，出现不同的固定安全解释；错误不能显示成 active/Saved，也不能把隐藏目标的存在性泄漏给客户端。

## Context and Orientation

Host `githubViewer` 调用唯一 GitHub 出口 `/user`，当前把 401/403 合并；Core 设置命令在事务中持久化账号与绑定，controller 把成功映射为 local_only。绑定后 Host 装配及 Planning 同步才可确认项目。client `safeError` 故意清除原文；现有 ProjectError 只有 code/message/recovery/retryable/confirmedValue/attemptedValue，不能承载本次所需原因。严格 parser 会拒绝新字段；仓库绑定也复用 connectAccount，因此必须同时验证这一消费者。

调查基线是 2026-10-30 +08 的 `main @ b19b4eac4f12aa40c05d75b492f3335299874641`。现有 `PLANNING_QUERIES.PlanningProject` 查询已由 provider 导出，Host 可复用它做显式绑定前只读验证；它不是权限事实源，也不修改 capability 或 Planning 状态。运行态授权快照、撤权及恢复、唯一生产 browser carrier 分别由 #466/#467/#469/#472 处理。

## Design / Spec

### 最小合同与字段落点
不新增全局 ProjectErrorCode、ProviderErrorCode 或 Recovery。controller 的 connectAccount/bindPlanningSource 失败响应根增加可选 `connectionFailure: { cause }`，cause 闭集为 `credential_rejected | permission_missing | target_unavailable`。它是本次设置命令失败的细化，不放入通用 ProjectError、confirmedValue/attemptedValue、数据库或 setup read DTO。成功、activationError、unknown/pending/conflict 不允许携带该字段。允许的组合只有 failed + permission_denied/fix_permission + 前两类，或 failed + not_found/open_provider + target_unavailable；retryable 必须仍符合原码。普通访问拒绝不填 cause。

client 新建纯值私有 helper 严格解析该对象和 code/recovery/writeState 组合。`WorkspaceSetupSnapshot` 增加同形可选字段，仅当本次 connect 命令的安全失败经校验后保留。run 在同一版本读回 setup 后发布该失败；新读、新 intent、pending、成功、dispose 或版本失效都不沿用旧 cause。读回失败时回到 generic 安全读错误；不能拿上一目标的已知原因解释新 scope。原始错误 message 不成为判别输入，也不穿透 UI。仓库绑定的 account decoder 接受并严格校验根字段后继续现有保守通用错误；不扩张其产品范围。

ui-model 根据闭集 cause 生成固定文案及说明性恢复：credential_rejected → “GitHub 拒绝了当前凭据，请在宿主检查或更新凭据。”；permission_missing → “GitHub 明确报告所需权限不足，请在宿主补充授权。”；target_unavailable → “项目不存在或当前授权不可见，请在 GitHub 核对项目标识与访问范围。”。通用 permission_denied 只说当前访问被拒，不断言缺权限。Host 没有凭据更新 UI/API，故前两项是可读指导，不伪造按钮。原 retry/refresh/reapply 行为继续使用既有恢复语义，unknown 先读回。

### 权威分类与只读验证

新增 controller 专属 `createConnectionCommands`，注入既有 SetupCommands 和两个 Host 只读端口：`resolveAccount()` 返回现有 ConnectAccountRequest 所需身份/句柄，`verifyProject(request)` 返回验证结论。端口结果为 `{ ok: true, value } | { ok: false, code, cause? }`，cause 闭集，code 沿用现有 ProjectErrorCode；不接受 raw message。controller 的 connectAccount(envelope) 先 resolveAccount、bindPlanningSource(existing input) 先 verifyProject，成功才委托既有设置命令，失败由 controller 固定工厂生成 safe failed + connectionFailure。工厂检查 cause/code 兼容组合；不改通用 CommandResult 或 Core。Host configure 只调这两个 controller 方法。由此三类失败真正经过 controller；测试注入真实 Host 端口并断言失败时 Core 设置写口未被调用。纯 Core 的本地事务 API 仍在 Host 信任边界内，不声称它能直接验证远端凭据。

`githubViewer` 对 `/user` 401 填 credential_rejected；普通 403 保留 permission_denied 且无 cause。限流优先于权限：429、403 exhausted/retry-after、已知 secondary-rate 情况保持 rate_limited。缺凭据/凭据服务拒绝、网络或 timeout 都是未获平台证明的 unavailable，不猜 credential_rejected。

新增 Host `preflightPlanningConnection`：作为上述 verifyProject 端口，在 configure 串行段中由 controller 调用、Core 绑定事务前，以当前账号句柄、同一 githubRequest（预算、固定 origin、redirect:error、脱敏）执行现有 PlanningProject 查询。只接受账号属于当前允许的 GitHub 身份且句柄可用；不复制授权、secret 或读取 hidden 内容。成功须为合法 ProjectV2 目标且 id 与请求一致；成功只允许继续事务，不代表 confirmed。失败返回安全结构化证据，由 controller 生成 failed envelope，不写 binding，不改 authority/规划状态。账号先前已确认的合法本地记录保留，不做回滚删除。

分类顺序：限流证据 → HTTP401 credential_rejected → 非限流普通403 generic permission_denied → GraphQL errors 的结构化 INSUFFICIENT_SCOPES permission_missing → FORBIDDEN generic permission_denied → NOT_FOUND 或合法 data.node:null 为 target_unavailable → 其余 unavailable。FORBIDDEN 不证明缺少 scope；404 与隐藏目标不能被描述为“私有项目存在”。混合/部分 data+errors 不作为成功；若出现互相矛盾的错误类且无法证明唯一根因，省略 cause。GraphQL 响应原文、headers、requestId、login、token、secretHandle、被隐藏内容、堆栈不进入 envelope。不可用/畸形不改称 offline；现有真实 offline/unknown 语义保留。

preflight 后仍可能换权、断网或激活失败。此时既有 readback 保守报告 configured/degraded/activationError；不把旧 preflight cause 缓存成当前事实，不以再次探针猜原因。直接调用 typed remote 的 bindPlanningSource 同样经过验证，不能依赖按钮禁用。

### 取舍

选择设置专属 envelope，拒绝全局新 credential code：后者扩大全局闭集、所有 decoder 与 provider 映射，本次没有足够跨域需求。拒绝以 message/rawClass 猜测凭据、权限或目标原因；已知 secondary 限流仅沿用既有安全 classifier。接受新增一次显式只读请求的连接成本，以在落绑定前得到可信分类并阻断直接绕过；不新增后台探针、重试循环或第二 runtime access owner。

## Global Constraints

本轮修复增加 provider `src/index.ts` 对既有纯分类器的具名重导出、当前 Host/集成测试与 `docs/review/pr-478-mmp-review.md`；仍只有本连接闭环，无新基础设施。

唯一文件集合与 owner：本任务 owner 修改 `apps/harness-plugin/src/host-providers.ts` 的 viewer/同一 GitHub 出口邻接 helper、`apps/harness-plugin/src/host-composition.ts` 的 connectAccount/bindPlanningSource 单点接线；新增 `packages/controller/src/connection-commands.ts` 并在 `packages/controller/src/index.ts` 导出专属包装器，新增 `packages/client/src/connection-failure.ts` 私有严格合同 helper，修改 `packages/client/src/workspace-setup.ts`、`packages/client/src/repository-binding.ts`、`packages/ui-model/src/workspace-setup.ts`，仅在必要呈现接线时修改 `packages/ui/src/workspace-setup.ts`；新增 `tests/integration/harness-plugin-connect-diagnostics.test.js` 和 `tests/contract/ui-connect-diagnostics.test.js`，允许扩展 `tests/contract/ui-workspace-setup.test.js` 的相关期望；正式文档为本计划、`docs/product/ui-forms.md` 的连接恢复说明与协调者最终修改的 `docs/README.md` 索引行。默认不修改其他已有测试/fixture与通用错误域。

代码/测试增删严格小于 800，目标 560–760，文档严格小于 1300、目标 200–360。client helper 不进 public export；类型可从 workspace-setup 既有出口 re-export，禁止导出内部 parser；controller 只公开这一明确的设置包装器。不得修改公开错误码、Recovery、storage schema、capability/runtime access 算法或 production browser carrier。Host 文件与外部 owner 若同区争写先协调，不能编辑其他工作树。三个本轮任务的产品文件集互不重叠。

## Plan of Work

### Batch 3 · MMP P2 限流恢复

先在 `tests/integration/harness-plugin-connect-diagnostics.test.js` 加无响应头403、无type200、近似词和重试动作反例并观察红基线；随后 Host 的率限检查复用 provider 现有安全分类器，保留当前结构化 RATE_LIMITED 优先级。定向七文件、provider分类、typecheck与boundaries必须通过。原审查者独立复评后归档并由主会话整理提交、回读当前CI/threads/issue再rebase合并；回滚本批或整个能力提交，不动数据。

### Batch 1 · 可信失败合同和真实路径负控

先提交本计划，协调者在产品代码前创建 Closes #434 的 docs-only draft 并回读 head/base/draft/关联。主文件为 Host viewer/连接接线、controller 包装器、client 私有合同及新增测试。先写受控 fetch 的真实 `createHostComposition → installHostRemote → createWorkspaceSetupSource → WorkspaceSetupGate` 用例，逐次驱动401、INSUFFICIENT_SCOPES、NOT_FOUND/node:null，读取实际 error/connectionFailure 并 SSR 渲染。用真实 controller 包装器验证401、scope、target三类直接命令拒绝，spy断言Core设置写口零调用且SQLite绑定计数零，成功路径仍经过原事务和装配。旧版区分断言应失败。写 strict 反例：未知 cause、额外键、非法原型、cause/code/recovery/writeState 不匹配、success 带原因；全部拒绝或安全 fallback，不能创建伪成功。

在检出 `feature/ui-connect-diagnostics` 的工作树根执行：

    pnpm test:file tests/integration/harness-plugin-connect-diagnostics.test.js tests/contract/ui-connect-diagnostics.test.js

期望新增命名负控在修复前失败，接入后全部通过。实现 Host 只读端口、controller 包装器与合同穿透，禁止为测试替换生产 source 或硬编码 cause stub 冒充端到端。

### Batch 2 · 恢复、泄漏和完整连接回归

主文件为 setup source、ui-model 与 account 消费者接线。保留同 intent 的阶段幂等键；确定失败才为下一次显式尝试换阶段 attempt，unknown 不换。新 target/refresh 清除旧 cause，迟到失败不能覆盖新结果。实际读回确认前不展示 active/Saved。测试 raw canary 在整个 remote JSON、snapshot、SSR 中均不存在；包括 token、login、隐藏项目 title/id 与异常。合法请求目标 id 可以保留为用户草稿，但错误不得附带隐藏响应身份。

在同一分支根执行：

    pnpm test:file tests/integration/workspace-setup-commands.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/harness-plugin-connect-diagnostics.test.js tests/integration/harness-plugin-repository-binding.test.js tests/contract/ui-workspace-setup.test.js tests/contract/ui-connect-diagnostics.test.js
    pnpm typecheck
    pnpm run boundaries

期望全部 pass。身份、外部写入边界及并发有变化，完成后再运行 `pnpm verify`，并在稳定已提交权限候选上由协调者做组合验证；结果分别记录，不称 hosted CI 或线上授权测量。

现有 setup 表单 light/dark、320px、200% 缩放下核对安全错误、帮助关联、草稿保留；提交失败才聚焦现有摘要，后台刷新不抢焦点，说明性恢复不是伪按钮。不建立新 browser carrier；如果既有 forms fixture 不覆盖真实连接错误，以新增 contract 的实际组件行为加本地浏览器手工检查记录证据边界。

最终执行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`，期望零失败；人工检查凭据、身份路径、账号个人信息、内部系统、保密字样。协调者整理 commit、final push 后回读 PR 当前 head/base/checks/issue/threads，通过后 ready，不合并。

两批回滚点都是完整 PR；不撤销合法用户数据或删除账号/secret 状态。

## Validation and Acceptance

| 输入/场景 | 必须观察到的证据 |
|---|---|
| /user401 | failed + permission_denied + credential_rejected；固定换凭据说明；零 bind |
| /user200、Project INSUFFICIENT_SCOPES | failed + permission_denied + permission_missing；补权说明；零 bind |
| Project NOT_FOUND/node:null | failed + not_found + target_unavailable；明确“不存在或不可见”；零 bind |
| 普通403/FORBIDDEN、错误混合不确定 | 无捏造 missing cause；保守拒绝/未知解释 |
| 403限流/429、网络、timeout、畸形200 | 原 rate_limited/unavailable 与恢复保留；没有误报凭据/权限/成功 |
| preflight成功、后续换权/激活失败 | 仍由实际 readback 决定 configured/degraded；旧 cause 不污染 |
| 直接 remote / source / UI | 同样拒绝；非法 DTO fail closed；幂等、draft、late result、泄漏负控全绿 |
| 完整交付 | 最终 <800/<1300、verify/定向/公开面、当前 PR 回读、真实未验项明确 |

## Progress

- [x] 2026-10-30 +08：唯一P2修复和独立复评通过；归档后进入当前head CI、issue与条件合并回读。

- [x] (2026-10-30 +08) 两份独立设计及第三位审稿完成，设置专属合同、分类证据与消费者落点已收敛。
- [x] (2026-10-30 +08) Batch 1：真实 Host → controller → typed remote → client → SSR 红基线 10 个命名失败，接入只读验证后通过；strict 合同与真实 Host 端口拒绝证明 Core 设置写口零调用。
- [x] (2026-10-30 +08) Batch 2 本地实现：当前原因清除、保守恢复、零泄漏与激活失败回归；七文件定向 111/111，typecheck 与 boundaries 9/9 通过。
- [x] (2026-10-30 +08) 最终 `pnpm verify`：typecheck exit 0；contract/integration/E2E 2591/2591；MVP0 7/7。
- [x] (2026-10-30 +08) 独立浏览器、代码验收、正式文档和交付回读均已完成；远端最终状态按本计划命令重新核对，未宣称安装Host/UAT/R1通过。

## Surprises & Discoveries

只改 Host message 无效，client 会故意抹平。把原因加在 ProjectError 上会令现有多个严格 decoder 失败；根级 setup envelope 的改动也必须兼顾复用 account 命令的仓库绑定。首次装配的 capability 门可能抹掉目标失败细因，因此不从后续笼统 source.reason 猜分类，改在用户显式绑定前的只读验证点记录本次证据。

已知结构化 `RATE_LIMITED`、403 exhausted/retry-after 和 429 优先于权限归因；普通403与FORBIDDEN仅为访问拒绝。新增 viewer 200 + 结构化限流反例先红后绿，避免错误地先接受身份字段。完整验证首轮在控制器负控变异期间启动，14 个连接用例受到污染，另有 ui-model 禁止平台名的真实结构失败；该轮不作为通过证据，恢复后重新完整执行。

## Decision Log

2026-10-30 +08 / 用户在评审会话明确指定 PR #476–#478、#480；并要求无P0/P1或只有P2/P3时「你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → `merge_method=rebase` 合并」。本会话接管非阻塞修复和条件合并，取代本计划此前未经该授权时的禁止自行合并。仅覆盖这四个PR；不批准规划Status、依赖或发布门。

2026-10-30 +08 / 主会话：根因是新preflight复制了率限规则但漏掉现有classifier已支持的secondary正文证据。选择复用现有纯classifier并仅读闭集code；不把原文、requestId或rawClass上wire；保留现有明确RATE_LIMITED优先。比另建跨包工具或再复制正文正则更小，避免规则漂移。

2026-10-30 +08 / 实现兼容裁决：现有 ui-model 合同禁止平台名。固定品牌标签由现有 setup UI 传入 `workspaceSetupView`，默认来源平台；原因闭集和安全句式仍由 ui-model 决定，不按 Provider 名分支。未改变运行态授权 owner。

2026-10-30 +08 / 独立 spec/plan 审稿：采用设置专属 connectionFailure，不采用设计 B 的全局 credential 错误码；增加最小controller包装器使失败真经过controller并在Core写前拒绝，限定 INSUFFICIENT_SCOPES 才称权限缺失，普通 FORBIDDEN/403 保守拒绝。理由是 HTTP/GraphQL 证据强弱不同，不能把明确分类需求变成全域枚举扩张。owner 与预算只见 Global Constraints；不批准规划字段或依赖关系修改。

## Idempotence and Recovery

只读验证可重复，不能写外部平台。绑定事务自然键仍负责重复提交，preflight 不替代幂等。若证据缺失/畸形直接安全失败；不能为继续流程略过验证或保留未确认 cause。失败证据记录在本工作树运行态目录；修改当前分支重试，不删除用户数据、不接管他人工作树。稳定权限候选如改变同一 Host 接口，先重新核对接口再组合验证。

## Interfaces and Dependencies

使用 `feature/ui-connect-diagnostics`、`.worktrees/ui-connect-diagnostics`，独立基于 main。现有唯一 GitHub 出口拥有30秒预算、固定 origin、redirect:error、凭据解析；新 helper 必须复用。真实远端 secret 和额外 scope 不为受控验收所必需；实际平台未验证就明确标未验证。PR 回读：`gh pr list -R SingularityKChen/harness-projects --head feature/ui-connect-diagnostics --json number,headRefOid,baseRefName,isDraft,statusCheckRollup,closingIssuesReferences`，然后对唯一结果回读 threads。

## Outcomes & Retrospective

2026-10-30 +08 / MMP复评：无头403和无type200在真实Host→UI恢复rate_limited/retry、零绑定且无原文泄漏；近似词不冒充限流。新增pending清旧原因断言让原存活变异KILLED。主会话175定向、2597主测试+7MVP、typecheck通过；原审查者独立88项、boundary9/9、类型、Host反例通过。最终变异4/4 KILLED。生产改动只重导出现有纯函数并在Host复用，不扩展全局错误枚举、storage或runtime权限所有权。

实现观察为2026-10-30 +08、`ed2094d`；定向111/111、全量2591+7、边界9/9及typecheck通过。独立审查五项实质变异（controller校验绕过、严格原因绕过、原文泄漏、普通403误归因、dispose残留原因）全部被命名用例拒绝；注释no-op正控正常存活，所有字节恢复且无遗留P0–P3。实现不改global error枚举、storage或runtime access owner。最终head/base/checks以PR #478回读为准。

协调者以真实Host remote受控结果驱动生产source和表单，在浅色凭据失败及320px深色/30px文字的三种原因中实测：解释分别为换凭据、补授权、核对不存在或不可见目标；均只一个alert，提交后焦点到安全摘要，PVT_fixture草稿保留，document宽320px无横溢。文字放大不称浏览器缩放；这些受控证据不等于线上GitHub授权或installed Host接受。原始错误、账号和秘密未进入界面。

为保持ui-model平台无关，固定提供方名称由UI传入展示参数，模型只选择闭集原因的安全句式。没有新增接受延期债务；线上授权、#449人类UAT及R1不在本次结论中。

## Bottom Change Note

2026-10-30 +08：第三位审稿收敛设置根级原因合同、GraphQL 强证据分类、只读 preflight、严格消费者及迟到/读回恢复边界，拒绝全局错误枚举扩张。

2026-10-30 +08：协调者归档独立负控与实际浏览器三原因验证，补连接恢复说明；最终远端门禁留命令回读。

2026-10-30 +08：校正已完成事项遗漏的Progress勾选；源码、测试与fixture均未变化。

2026-10-30 +08：首轮唯一P2已复现，计划重新激活以承载有判别力修复和独立复评。

2026-10-30 +08：P2修复RED→GREEN与独立复评完成，计划重新归档；本地完整测试2597+7通过，最终远端CI与merge结果按回读命令确认。
