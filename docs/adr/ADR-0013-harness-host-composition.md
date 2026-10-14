# ADR-0013：Harness 插件 Host 作为 Core/Controller/SQLite 的受控组合根，并以 typed remote 暴露最小 unary 面

> 状态：Proposed
> 日期：2026-10-13
> 来源：`docs/exec-plan/active/2026-10-13-harness-host-composition.md`、issue #228、`docs/architecture/harness-host-spike.md` §11

## Decision

1. `apps/harness-plugin/src/host.ts` 是插件 Host 的组合入口。它在注册远程端点前创建 Host-owned SQLite、Core 和 Controller；构造失败时关闭已创建资源并不发布端点。
2. Host 与 Client 通过 Harness typed remote 的 strict unary descriptor 传递 `baseline` 和 `bootstrapWorkspace`。Host 注册 live service binding 与 `ctx.typert.register({ package, face: 'host', model, invocations })`；Client 用同一组 descriptors 调用 `ctx.remote.$mount({ package, descriptors })`，并只在注入的 `remote.harnessProjects` 子 Context 中读取 namespace。
3. descriptor 只承载 JSON-safe 参数、结构化 Controller 结果和 opaque credential reference；凭据原值只在 Host 的一次 provider operation 内由宿主 resolver 解析，不进入 SQLite、wire 或 Client bundle。
4. SQLite migrations 作为安装件文件发布，Host 按包内目录优先、源码树目录回退的规则解析；源码树回退只供本地开发和测试，安装件验收必须使用包内目录。
5. 本 ADR 只批准受控的 apps Host 依赖例外。Client、UI、UI model 与其它 apps 仍不能依赖 Core、Controller 或 Storage。Host 入口要求注入 `harnessProjectsProviders` 工厂与 `credentials` 服务；缺失时 fail closed。provider implementation-key 选择、真实 connector account 恢复和 watch/reconnect 分别由 #132、Gate E1 后续工作和 #276 承担。

## Why

Host 必须拥有权威状态，前端只能消费它；把 Core 或 SQLite 放进 Client 会产生第二个事实源，并把凭据和本地文件句柄带到浏览器。typed remote 已在宿主复探中证明 unary `/api`、严格 codec、连接生命周期和认证边界，复用它的取消、错误与卸载语义比自建 RPC 更小、更可逆。

当前仓库没有已验证可用的生成器，因此 descriptors 采用公开 `InvocationDescriptor` 形状手写 strict codec。手写不是放宽校验：Client mount 会拒绝缺少 strict codec 的输入，Host Gateway 会在调用 Core 前解析参数。

## Rejected

- **Client-side composition**：会让浏览器成为第二状态源，违反 Host 权威不变量。
- **自建 HTTP/SSE 或 `HostRemote.registerUnary` 作为产品 transport**：会重复 typed remote 的认证、错误、取消和卸载边界；recording adapter 只用于离线契约测试，不是宿主运行时证据。
- **在本 ADR 内接 watch、页面或 provider implementation selection**：它们分别属于 #276、#229、#132，合并会破坏独立验收与回滚边界。
- **把 raw credential 写入 Core、SQLite 或 descriptor**：违反 secret handle 边界。

## Consequences

- Host 安装件不携带 fake provider。测试通过注入 fake factory 验证 provider operation 的 credential resolver seam；真实 provider binding 选择仍由 #132 提供，缺失工厂时 Host fail closed，不能把 fixture 当作 GitHub 事实。
- 本地 adapter、打包安装件和 TypeScript 契约可以在 CI 验证。真实 Desktop 的安装、401/403 与缺 `harnessProjectsProviders` 时的 404 fail closed 已在 head `c494a62c` 的构建上观测，之后的修复改了两个 bundle、未复测；正向 `/api` POST 往返与宿主内建库经人类批准转入 #132 联合验收；Host unload、重连与卸载后保留调用的宿主内观测未执行，同样要等 #132 的 provider，不在批准转移范围内，作为残余风险。这些都不能由本地 green 推断。
- `dispose` 先撤回 remote contribution，再关闭 composition；重复 dispose 幂等。当前批次拒绝新请求并等待已开始的 handler 由 typed remote 生命周期处理，跨代 watch drain 留给 #276。
- `Status`、Project Status、`blocked-by` / `blocking` 与 ADR Accepted 状态不由 agent 写入；人类伙伴决定是否采纳本 ADR。
