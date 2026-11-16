# 暂停订阅流清理 ExecPlan

> 状态：Completed（本地工程验收）；创建：2026-11-16；Iteration 11：2026-11-16—22（Asia/Singapore）
> 范围：#649 的 owned watch iterator 与有界 Host 卸载；规范：根 `PLANS.md`。
> 上游：#338、#422、#649；不以本叶子接受父项、Windows 安装或 R1 发布。

## Purpose / Big Picture

用户关闭或重载插件时，即使客户端只收到首帧便停止读取，Host 仍主动释放自己拥有的订阅流。合作生成器的 finally 必须由 dispose 触发，不依赖消费者再次 next/return；不合作的底层仍只能消耗原有同一绝对退出期限。撤回 remote 与实际清理必须分别可观察。

## Context and Orientation

`apps/harness-plugin/src/remote.ts` 的 `installHostRemote` 用外层 async generator 包装 composition.watch，严格编码帧并以 beginCall/endCall 计数；初始基线的 dispose 仅 abort、撤注册和等待在途计数。parked 指 generator 停在一次 yield 后等待下一次消费者请求，AbortSignal 不会自行让该作用域进入 finally。

`apps/harness-plugin/src/host-composition.ts` 拥有真实 `streamWorkspace` iterator；初始基线的 stop 只中止 watches，返回的 wrapper 只有消费者 return 才转发内层 return。`packages/controller/src/watch.ts` 的 streamWorkspace 在首帧 baseline yield 后才创建 poll watch，当前不能把该暂停场景夸成持续CPU轮询泄漏。确切缺口是作用域、资源所有权和 active-call 结算。

现有 `tests/contract/harness-host-remote-adapter.test.js` 首帧后主动发第二次 next，覆盖在途读取而不是 parked。既有 lifetime 与 artifact 测试已有绝对deadline、迟到获取、拒绝诊断、重复dispose等证据，优先复用。

## Design / Spec

选择最小私有所有权机制，继续使用现有流协议、严格编码和有界drain。明确两层owner：composition拥有controller产生的真实iterator；remote拥有从composition取得的iterator，以及用于计数/编码的外层wrapper。每层只关闭自己直接拥有的对象；同一底层return通过幂等close入口调用并共享同一Promise，避免显式关闭与for-await的IteratorClose再次关闭底层。

composition在watch迭代器启动时登记真实frames与唯一close；consumer return/throw、读取错误、signal abort、stop/dispose都走该入口。stop同步撤读准入并abort，主动发起关闭所有已登记frames；dispose将这些关闭任务纳入已有pending/drain，清理成功或失败后移除登记与监听。关闭不得等待消费者再pull。未启动的iterator不占活动调用；关闭后的首次next不得重新开源。

remote首次next通过beginCall后登记一个活动记录，取得composition iterator后立刻检查stop状态；dispose先撤准入/abort/撤remote，再向实际owned iterator发起唯一return，同时关闭active外层wrapper，使合作parked流执行finally并准确endCall一次。不能只return外层：pending next可让其return排队，实际source关闭仍应被立即发起。正常完成、consumer return/throw、next拒绝和JSON编码错误共用同一结算路径；不得构建互相竞争的业务状态或第二权威源。

所有next在await返回后、编码或交付前检查closing/abort，停止后的合法或非法晚帧均不能继续交给消费者；停止后的首次启动也不得重新取得流或发布endpoint。发起关闭时同步异常、异步拒绝及晚拒绝必须被接收，沿用脱敏shutdown诊断；不得把原异常/路径送到wire。source不合作时return可能无法settle，允许保留deadlineExceeded而完成withdraw，不能声称强制finally成功。

公开一手依据（2026-11-16核对）：[ECMAScript 2026 AsyncGenerator.prototype.return](https://tc39.es/ecma262/2026/multipage/control-abstraction-objects.html#sec-asyncgenerator-prototype-return)把return加入请求队列，仅在suspended-yield等可恢复状态推进；执行中的任意await不会被return强行打断。[ECMAScript 2026 AsyncIteratorClose](https://tc39.es/ecma262/2026/multipage/abstract-operations.html#sec-asynciteratorclose)调用并等待iterator.return，因此语言级关闭不能替代Host的有界deadline；本批据此把主动发起关闭与等待完成分开。

退出所有阶段继续共享原绝对deadline，不能每个iterator追加一个新超时。并发/重复dispose复用原Promise；不得额外next、后台drain拉流或调用consumer动作来获得清理。默认设计在现有两模块内实现；只有重复close逻辑确有必要时才提取极小私有helper，不形成通用流框架。实现者可用同等证据进一步简化结构，不能减弱parked、pending-next、late-frame和期限合同。

放弃仅abort+等待计数：yield暂停不会自动清理。放弃只关闭inner：外层parked可能不结算activeCalls。放弃仅登记outer.return：无法保证pending-next时及时发起owned source关闭，且独立composition.stop仍漏。放弃改变controller轮询或client监督策略：不属于资源owner缺口。

现有remote测试在dispose中途故意产NaN并期待编码错误，与“停止后拒绝晚帧”冲突：将strict坏帧负控放在运行中，dispose晚帧断言改为不交付；不删strict编码保障。保持Host唯一权威、trusted actor/profile隔离、planning/engineering正交、凭据句柄、ack/reconcile确认与存储不确定性；无公共ABI或wire帧格式变化。

## Global Constraints

单一实现owner独占 `apps/harness-plugin/src/remote.ts`、`apps/harness-plugin/src/host-composition.ts`、`tests/contract/harness-host-remote-adapter.test.js`、`tests/integration/harness-plugin-host-lifetime.test.js`、`tests/integration/harness-plugin-host-watch.test.js`、`tests/integration/harness-plugin-artifact.test.js`。仅确有复用必要时可新增私有 `apps/harness-plugin/src/host-owned-stream.ts`，必须同步本计划理由与实际预算。

文档只含本计划（完成后同名移入completed）及协调者维护的 `docs/README.md` 索引。不得改private-data/catalog、controller/client业务算法、domain、Storage schema、Host公共surface、生成bundle或锁文件；#648不写composition，消除共享owner冲突。

技术additions+deletions目标350–540、上限600，每PR技术≤800、文档≤1300，包含测试、fixtures、替换/删除。不得为压行省略错误清理或反证。无新包、实验兼容路径、数据迁移或自动修复；只使用临时数据，不安装插件、不启动模型、不写Planning Status/native blocking、不自行合并。

## Plan of Work

### Task 1 / Batch 1 · parked流主动清理与有界退出

**最小闭环**：首帧后零消费者动作也能由remote/Host退出触发合作finally；pending-next、不合作底层及晚帧仍受原边界控制。

**涉及主文件**：`apps/harness-plugin/src/remote.ts`、`apps/harness-plugin/src/host-composition.ts`。

先在既有remote契约加入synthetic inner generator：try中yield一帧，finally增加释放计数；只next一次，dispose后先断言finally/close=1且无deadline诊断，断言前绝不consumer next/return。旧代码必须RED为释放0；失败清理在finally兜底return，不把兜底当验收。再复用真实composition/watch，极薄观察实际iterator.return的完成，独立composition.dispose与remote.dispose均不得靠consumer恢复；停止后不再读baseline/poll或交付帧。

按Design实现owner关闭及一次结算，运行中strict NaN负控与停止后晚帧负控分开。复用已有pending-next、deadline、迟到获取和重复dispose夹具，只为缺失独有风险补正常完成、early return/throw、同步/异步close失败、未启动iterator及不合作source的判别证据，不展开组合矩阵。

执行V1，再执行V2的实际packed Host unload控制；独立验收者检查cleanup计数来自dispose而非后续测试next，确认不合作场景超时诊断但退出有界。必要重构后复验受影响命令，更新实际结果；协调者归档/索引和整理提交，保留初始plan-only及最终实现可审阅提交，不生成debug/fixup。

**验证及期望**：Concrete Steps集中定义V1–V4；合作parked原本RED、修后GREEN，不合作情形有界withdraw并明确deadline诊断，无晚帧/回调/endpoint。**回滚点**：撤销本批代码/测试恢复旧流生命周期；无数据或配置回滚，原缺口会重新存在。

## Concrete Steps

在检出 `fix/parked-watch-disposal` 的工作树 `.worktrees/parked-watch-disposal` 根目录运行，沿用冻结依赖；下列命令只在此定义。

- V1：`pnpm test:file tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-lifetime.test.js tests/integration/harness-plugin-host-watch.test.js`；期望parked/真实owner/late-frame/异常/期限控制全通过，无测试挂起或未处理晚拒绝。
- V2：`pnpm typecheck` 与 `pnpm test:file tests/integration/harness-plugin-artifact.test.js`；期望类型通过，实际新打包Host首帧parked卸载控制与现有装载/迟到资源控制通过。实际bundle不可用源码扫描替代。
- V3：`pnpm test:file tests/contract/content-placement.test.js`；期望文档位置及路径引用通过。
- V4：`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`；期望退出0，人工检查凭据、本机身份、账号个人信息、内部系统、保密字样与实际A+D。

最终push后交付owner在本检出用显式仓库参数回读PR当前head/base、所有checks、issue关联、review threads；仅该head Fast Gate通过才Ready，提交人类评审，不合并。

## Validation and Acceptance

V1必须同时证明withdraw、合作finally与外层调用结算，而非只证明remote不可再调用；synthetic反例准确标注为生产remote+合成资源，真实composition控制证明生产owned iterator被主动关闭且无后续读取。用户继续取流属于正常对照，不是清理前提。相同source的return/error/throw只结算一次；正常运行保持strict编码。stop后late frame不交付，不合作next/return不能无限卡卸载，重复dispose/迟到获取不重开资源。

V2在实际打包入口复验退出与无晚endpoint，V3–V4保护文档/公开面。未经真实Windows安装与普通用户验证，不声称Windows资格；不以软件测试代替父#338的原始actor/profile验收。完整本叶子可Closes #649，父项独立。

## Progress

- [x] (2026-11-16 14:50 +08) 完成独立源码审读与两方案比较，确定两层owner、一次结算与停止后晚帧规则。
- [x] (2026-11-16 14:50 +08) 在本分支初始基线执行V1：32通过、0失败；现有证据尚不覆盖parked。
- [x] (2026-11-16 14:59 +08) 完成Task 1 / Batch 1实现与本地V1–V3；synthetic parked先RED为释放计数0，修复后GREEN；真实composition及新打包Host的return完成均在消费者再次动作前断言。
- [x] (2026-11-16 15:20 +08) 独立修复复评通过，当前无未解决P0–P3；本地工程归档与索引完成，最终Ready继续受当前head回读规则控制。

## Surprises & Discoveries

2026-11-16 @ 初始基线 `8ace55af`：首帧parked时controller尚未创建poll watcher，真实问题不等于已证实活跃轮询泄漏；不能以“无poller”否定生成器scope未释放。remote测试主动第二次next掩盖parked，且其shutdown坏帧预期与新late-frame围栏冲突；运行中strict负控必须保留。

2026-11-16 @ 本批未提交实现：source获取函数能同步触发dispose；此时尚未赋值的frames不能缓存成“已关闭”。remote在拿到真实iterator后再复用close任务，已有同步获取中止控制证明不派发next且只return一次。

2026-11-16 15:12 +08 @ 独立审查head `21665ea3`：source.return同步abort会在sourceClose赋值前重入，新增精确反例先RED为return计数2。根因是执行可重入代码先于发布唯一任务，而不是abort或drain策略；原先“一次关闭”的本地结论由本段反例修正。

## Decision Log

2026-11-16 14:50 +08 / 独立spec评审、协调者确认：同时关注实际owned iterator关闭与active wrapper结算，归各自现有owner，使用幂等close入口与原drain。理由：outer-only在pending-next排队，inner-only不能保证parked外层endCall，单独composition.dispose也必须有所有权。

2026-11-16 14:50 +08 / 独立spec评审、协调者确认：停止后拒绝晚帧，strict NaN编码负控移至运行中。理由：dispose后的原错误帧不应再编码/交付；编码严格性仍须独立证明。只有不合作source允许有界超时，不能把合作资源泄漏当成功退出。

2026-11-16 14:59 +08 / 实现owner：在原模块内保存两个私有close闭包，移除remote的for-await隐式关闭，继续复用composition.pending与remote.drained，不提取通用helper。真实generator原型return的薄观察只包装原生调用并记录完成；synthetic资源另用finally释放计数。技术差异低于目标区间，不为行数目标添加框架或重复测试。停止后迟到next拒绝与迟到帧一样正常收束；运行中读取拒绝与strict坏帧仍各自保留负控。

2026-11-16 15:12 +08 / P1修复：先构造并发布带拒绝接收者的唯一sourceClose Promise，再在当前调用栈同步调用真实return，把同步结果或异常结算到该Promise。同步abort重入共享它，不延后pending-next的owned return；未取得source时仍不缓存空关闭。只增一个持久重入case，已有sync/async/late拒绝控制复用；额外一次性控制证明abort后原return再throw仍只关闭一次并诊断一次。composition实际拥有的streamWorkspace是原生generator，关闭路径没有会同步abort的用户finally回调，不据合成替身推导其新缺陷，本轮不改。

## Idempotence and Recovery

关闭入口与dispose均可重入并共享原任务/期限；每层移除登记、监听与计数一次，所有late rejection有接收者。return同步抛出也不能跳过其它流、撤注册、provide或关库。测试错误路径在finally释放自己可控gate和临时根，不能重拉source来“清理成功”。任一步失败保留最窄证据，修复本owner改动后复跑对应V1/V2；不重置其它分支、修库或删除未知数据。

## Interfaces and Dependencies

沿用AsyncIterable/AsyncIterator的next/return/throw语义、既有strict JSON、`drainUntil`绝对期限、Cordis/Typert与Host stop/dispose契约。无需网络、凭据或新原生机制。composition负责源资源，remote负责调用包装和入口；controller提供帧，client监督器仍按现有策略重连。包依赖方向和Host ABI不变。

## Outcomes & Retrospective

本批在 `fix/parked-watch-disposal` 的工作树完成合作parked资源主动关闭、实际source及时return与active wrapper一次结算；真实composition独立退出和实际打包Host均在消费者再次动作前证明资源完成。最终V1 46通过、typecheck退出0、实际打包Host29通过、文档位置5通过。运行中strict错误与停止后晚帧各自有判别证据，不合作source仍只占共享绝对期限。

独立审查发现同步return触发abort重入的P1；新增精确用例先RED为两次return，修复后唯一任务先发布、真实return仍在当前调用栈发起。原评审者复评确认一次return、重入后throw仅诊断一次、pending-next立即关闭和晚NaN围栏，当前无未解决P0–P3，无必要额外重构。

本地工程验收、归档和索引已完成；PR #652 的当前head/checks/Ready由Concrete Steps的最终回读规则控制，不能从归档推断发布接受。无有意延期技术债；无法强迫不合作provider从任意await进入finally属于已声明的有界合同。Windows及父#338/R1接受独立。

## Artifacts and Notes

本计划与持久回归共同保留RED/GREEN、真实Host与打包入口、失败恢复及独立复评的最小证据；临时输出不构成正式文档依赖。计划已归档，PR当前状态由交付回读确认。

## Bottom Change Note

Change Note (2026-11-16 14:50 +08)：综合两份独立方案后创建；修订outer-only关闭的pending-next及composition独立stop缺口，明确late-frame/strict负控、幂等owner和同一有界期限。

Change Note (2026-11-16 14:59 +08)：记录实际RED/GREEN、真实owned iterator与packed Host证据、获取中同步stop边界及更小的两模块实现；保留独立审查与远端交付门未完成。

Change Note (2026-11-16 15:12 +08)：记录独立审查P1的有效反例、唯一close Promise先发布的根因修复与当前V1/V2结果；保留复评与交付门未完成。

Change Note (2026-11-16 15:20 +08)：记录独立P1修复复评和最终本地工程验收，归档并更新索引；当前PR门禁仍以远端回读为准。
