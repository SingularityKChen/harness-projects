# PR #403 MMP 交付评审

## 锁定事实

- 日期：2026-10-26；执行上下文：`.worktrees/host-recomposition`。
- Head：`d74212ff4199d7c0475d1966f627f88486e14e0d`；Base：`feature/planning-field-mapping` / `675d371315de9ac186352b73154c54f023a43309`。
- 初始状态：Open、Ready、mergeable；已有 review 与 review thread 均为空（完整分页）。
- 账号：review 为 `Singularity-AI-Bot`；开发写入为 `SingularityKChen`。
- 评审方法：Superpowers 独立评审；Qian 系统闭环与反馈；First Principles 需求、状态拥有与反例。
- 事实和约束：Host 权威、Provider ack/reconcile、规划与工程轴正交；测试通过不替代产品验收。

## 预先风险矩阵

本矩阵在逐文件审查前建立；风险是假设，最终结论须以证据更新。

| 级别 | 代码与反例 | 产品闭环 | 架构边界 | 测试与 issue 验收 |
|---|---|---|---|---|
| P0 | 数据破坏、泄密、合入即破坏 main | 错报已保存或越权远端写入 | 第二权威源、规划状态被工程覆盖 | 硬约束未守住则阻断 |
| P1 | 并发、重试、冷恢复、失败路径错误 | 用户主路径无法完成或结果不可信 | 身份/租约/持久化/信任边界失效 | 反例可复现且在本 issue 验收范围则阻断 |
| P2 | 可恢复的边界行为、诊断不足 | 非关键交互与恢复体验缺口 | 局部合同不清但无不变量破坏 | 缺判别性负控、已有追踪核验 |
| P3 | 易读性、证据表述与维护性 | 文案或展示小问题 | 无行为影响的一致性 | 文档、索引、细微验证改进 |

## 分层审查与验收

审查范围是当前 head 相对 #401 base 的全部 12 个文件。系统结果是本地设置已提交后，同一 Host 与同一 watch 到达已提交配置，失败保留旧装配且同键可重试；以 Host 屏障、装配租约、scheduler lifetime 和共享 SQLite 为控制点。

| 层 | 当前证据 | 判定 |
|---|---|---|
| 代码 / P0、P1 | 配置 tail 串行；屏障早于提交，排空旧短租约；baseline 读后核对 epoch；旧 tick 醒来核对 lifetime；候选 timer 分配先于 publish；失败恢复旧 scheduler | 未复现 P0/P1 行为缺陷 |
| 产品 / P0、P1 | 空库同一 remote create/connect/bind，原 follower baseline→metadata→delta；local_only/value 与 activationError 分离，同键激活重试；卸载 drain 后关 SQLite | #354 的五条主验收有集成证据 |
| 架构 / P0、P1 | 稳定 Host 拥有配置账本和 Storage；Core/Controller/reconciler 按代替换；UI 不接管状态；host 固定 workspace 与 planning 实现键；remote 异常走 guarded | 无新增第二权威或层级越界 |
| TD-081 / P1、P2 | Development lazy 初值 degraded，真实 getRepository 才更新；相同 target/account 的实例缓存保留确认时间，换 target/handle 隔离；两慢挂载零启动探针 | 当前合同成立；不承诺 UI 自动刷新权限 |
| 测试 / P1、P2 | 九文件 134/134、边界 9/9；四个变异精确 KILLED，但移除配置 tail 的变异在现有重组测试全绿；独立并发反例可杀死它 | 一条 P2 永久回归缺口 |
| 工作项 / P2、P3 | 逐项对照 #354 scope/acceptance 和交接 comment；#131 页面接线、#278 额外连接诊断、#358 chooser 各自跟踪；TD-055 多工作区/disabled/schema 仍 Open | 未把后续范围声明为本次交付 |

### 发现 F403-1（P2）：并发设置的串行门缺少永久判别测试

建议 inline 锚定新增 `tests/integration/harness-plugin-host-recomposition.test.js:43`（最小相关范围 40–44）。该流程先 await createWorkspace，再 connectAccount，当前永久测试从未使两个设置 configure 同时在途。将 `host-composition.ts:166` 的 `tail.then(async () => {` 改为 `Promise.resolve().then(async () => {` 后，现有重组测试 10/10 仍通过（M403-5 SURVIVED）。因此取消唯一串行队列、让第二配置覆盖全局 barrier 并提前放行读的回退无法被该套件发现。

独立反例在临时文件执行：空库启动；在第一个 createWorkspace 已提交、fingerprint 的 listProviderBindings 阻塞；同时发 connectAccount；释放前推进两次 setImmediate 并断言 `/user` 请求数为 0。当前产品树通过；上述单点变异使第二设置提前发 `/user`，精确失败于 `second settings network request entered before first activation finished`；还原后通过。当前实现有正确 tail，故定为测试判别力 P2，非已存在的串行实现缺陷。

修复方向是在本 PR 的永久重组集成测试补入这个并发设置场景，使用现有 gate、SQLite prototype mock 和 remote seam，保证 cleanup 总会释放 gate。最终原五项变异整表重测，应由该新增测试杀死 M403-5；保留本节的首轮 SURVIVED 事实。未检索到单独跟踪此永久 Host 并发回归的 issue；本项属于 #354 明确设计的串行重组范围。

## 验证与变异

2026-10-26，在 `.worktrees/host-recomposition` 的锁定 head 执行：

- `node scripts/resolution-check.mjs`：exit 0。
- `node --test --test-timeout=120000 tests/integration/harness-plugin-host-recomposition.test.js tests/integration/harness-plugin-host-github-catalog.test.js tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-host-planning-refresh.test.js tests/integration/harness-plugin-host-runtime-adapter.test.js tests/contract/development-github-contract.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/workspace-setup-commands.test.js`：134/134，exit 0。
- `node --test tests/contract/package-boundaries.test.js`：9/9，exit 0。
- 独立并发反例：原树基线、指定变异 RED、还原后基线全部成立；由标准变异脚本确认。

首次 `pnpm run test:file` 因 pnpm 自动 install 的 modules 布局/无 TTY 检查退出；没有执行测试，不算产品失败。后续直接 Node test runner 与 resolution-check 得到上述结果；未改依赖布局。

首轮变异由 `node scripts/review-mutate.mjs <临时spec.json>` 执行，command 为 `node --test --test-timeout=15000 tests/integration/harness-plugin-host-recomposition.test.js`；文件均为 `apps/harness-plugin/src/host-composition.ts`。所有锚点唯一、字节还原与还原后基线通过；整表 exit 1 的原因仅为 M403-5 存活，不能将整表宣称为全绿。

| ID | 单点变异 | killedBy（失败名子串） | 首轮结果 |
|---|---|---|---|
| M403-1 | `await Promise.allSettled([...old.leases])` → `await Promise.resolve()` | `old scheduled rounds drain before reassembly` | KILLED |
| M403-2 | `if (version === epoch && assembly === current) return result` → 无条件 `return result` | `same unary baseline Promise` | KILLED |
| M403-3 | 删除 `activeFingerprint = desired; retire(old)` 中的 `retire(old)` | `a tick admitted during the barrier` | KILLED |
| M403-4 | candidate.reconciler.start 的 catch 改为吞错 | `candidate timer allocation failure` | KILLED |
| M403-5 | `const task = tail.then(async () => {` → `const task = Promise.resolve().then(async () => {` | 初轮目标 `same remote creates/connects/binds` 未失败 | SURVIVED |

独立反例的 M403-5 复核：command 改为 `node --test --test-timeout=5000 <临时并发反例>`，killedBy=`independent concurrent settings`；结果 KILLED、脚本 exit 0。完整 spec、反例与日志交给协调者，原产品文件未残留变更。尚待 owner 将反例纳入永久测试并重测完整变异表。

## 结论与后续门

本 head：P0=0、P1=0、P2=1、P3=0；建议 APPROVE，同时补 F403-1 的永久回归。尚未提交远端 review，未改产品/永久测试、issue 或规划字段。本地元数据与 CI 不是产品完成证据；真实 Harness 页面交付仍由 #131 后续负责。owner 修复后的新树须重锁 head/base、跑窄测试并整表重测，再由协调者回读当前远端 checks/线程；人类拥有最终合并决定。

## 修复复评（2026-10-26，冻结工作树）

复评对象是 `d74212ff4199d7c0475d1966f627f88486e14e0d` 加新增永久并发测试及临时 active 计划/索引修订；不是一个新 remote head。计划暂移 active 是本修复批的有意状态，待本次复评完成再归档，不作为新缺陷。

新增 `tests/integration/harness-plugin-host-recomposition.test.js:61` 的 `concurrent settings wait for the first activation before the next command reaches the viewer`：使用真实 Host、SQLite 和 installHostRemote；只在首个已提交 createWorkspace 的 binding 读取处注入 gate，随后在同一 remote 发 connectAccount。断言观测 `/user` 请求先后、两个 local_only 结果与最终 baseline 工作区名，没有读取 tail/barrier 内部变量，也没有复制实现算法。指定变异能使这个用户可观察行为断言失败，故不是镜像或恒真测试。

新测试的 finally 先 release gate，再 Promise.allSettled 两个请求；已有 open fixture 的 t.after 随后排空 remote、关闭 SQLite 并移除临时目录。移除串行队列的 M403-5 使“首个激活完成前第二个设置操作不得访问 viewer”断言失败，但不会把阻塞的首个命令留给 teardown；整套变异及还原后基线均正常结束。

冻结证据：新增测试 Git blob=`11576cac32f36bec5bc94f88bb580cf94950d2c3`（旧 HEAD=`9cf3b726a508a8de42d906fa0a67a838746ea660`），SHA-256=`c7dd28c40f584e189fadc8aa138f2ed8c5e2c2ddef2d710051bc59b344fdb56d`。生产 `host-composition.ts` blob=`ff1a123f1abf21fcff6d9bd255fd01f7976d456c`、`host-providers.ts`=`dddf2f42aca9e30445e9ebb52b095201d480e2e2`、Development provider=`bb58bd4d17b94471ba1c4e8f66825925f8e58957`，均与锁定 HEAD 相同；复评前后四文件 SHA-256 完全一致。

重新执行上文九文件窄回归：135/135，exit 0（重组文件新增后为 11 项）；resolution-check exit 0。原五项变异在这份冻结工作树整表重测一次，仅把 M403-5 的 killedBy 改为新增永久测试全名，其余 anchor/replacement/command 保持：

| ID | 本次 killedBy（失败名子串） | 本次结果 |
|---|---|---|
| M403-1 | `old scheduled rounds drain before reassembly` | KILLED |
| M403-2 | `same unary baseline Promise` | KILLED |
| M403-3 | `a tick admitted during the barrier` | KILLED |
| M403-4 | `candidate timer allocation failure` | KILLED |
| M403-5 | `concurrent settings wait for the first activation before the next command reaches the viewer` | KILLED |

标准脚本 exit 0，字节还原与还原后基线均通过；`git diff --check` exit 0。首轮 M403-5 的 SURVIVED 事实仍保留在上文，现由永久回归弥补，F403-1 关闭。本次无新增 P0/P1/P2/P3，当前未关闭发现为 0，结论保持 APPROVE；协调者可归档计划，再按新提交锁定 head/base、回读 checks 和 threads。
