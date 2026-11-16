# PR #652 MMP 交付评审

2026-11-16：首审无 P0/P1，三项 P2 一次性提交；根因修复的独立复评确认 F1–F3 全部 addressed，当前技术树无新增或遗留 P0–P3。范围仅为 #649 的停拉 iterator 主动关闭、终止语义与有界 Host 退出；父 #338、Windows 原生资格、规划 Status 和 R1 接受独立。

## 锁定事实与范围

初始调查为 `43fddb811042c07ca94d50e663a3189b0bd0c027` / base `8ace55af83a21a45397c855ba03374623b5fc3ae`。重基后五个技术文件逐字相同，独立重跑46项与两条失败反例后，在 head `7e99dcb6abf4d0ede4a5b4f4293a4c052de7fc78` / base `28aff71baf0cb056d842f66559b47304ea9a87a0` 提交正式 review `5916702473`：APPROVE＋三条 inline。旧头没有包含后续修复。

最终复评执行于检出 `fix/parked-watch-disposal` 的 `.worktrees/parked-watch-disposal` 根目录，对象为该正式首审头加 Batch 2 差异，按以下 SHA-256 锁定。整表变异还原后五项全部相等；后续文档归档不改变技术结论，最终公开 head 的批准与 checks 须重新回读。

| 技术文件 | SHA-256 |
|---|---|
| `apps/harness-plugin/src/remote.ts` | `8bbfa7e44e2a12e4629747bf6364ea5d4db808d0e6ac8268d9cc98ec01322698` |
| `apps/harness-plugin/src/host-composition.ts` | `7b5fb45e754cb2c13230c7e41aeec74e4c83b2c9ff6acffc814288537320da9b` |
| `tests/contract/harness-host-remote-adapter.test.js` | `9c8cafe9caa620b28772900002dd57b4a856b32e4ce19fc7679f77371c31af1f` |
| `tests/integration/harness-plugin-host-watch.test.js` | `9c8c69742d94bb3441c12d4bd50111410bb14380ae123e4c4de3c5be1fe5d753` |
| `tests/integration/harness-plugin-artifact.test.js` | `6848f2e14a04ffe0fb53675be14039390c4c06cc76b689ddf178d5a603e3fb06` |

初审已核对双向 closing #649、所有 reviews/threads 与真实 checks；必需 Fast Gate 成功，可选 review-session 端点连接失败由 #364 跟踪。#422 的既有 bounded shutdown 和父 #338 actor/profile 条件保留；相关缺口均属于当前 #649，没有重复建 issue。

## 风险矩阵与产品判断

| 级别 | 审查面 | 最终结果 |
|---|---|---|
| P0 | main、数据/安全硬约束、第二权威源、发布面 | 无；未改 schema、Provider、actor/profile、凭据 |
| P1 | 严重状态机、恢复、真实用户闭环与 owner 边界 | 无；真实 composition/packed 的停拉、错误及有界退出成立 |
| P2 | 泛型终止/重入契约、测试判别力与 issue 验收 | 首审 F1–F3 全部 addressed，无新增 |
| P3 | 维护成本、设计过度、文档/范围/回滚 | 无；不需要新 helper、依赖、公共 ABI 或 controller/client 重构 |

两层 owner 各自关闭真实 source 和外层包装器，复用 pending/drained 与原绝对期限。Batch 2 在原 remote 内先发布唯一 disposal Promise，再同步撤准入；自然 done 单独记录，停止/错误/消费者提前结束仍唯一关闭。微任务延迟全部清理会改变同步撤准入，全面重写 iterator 会扩大状态责任，均不采用。真实首帧后尚未建立 poll watcher，不能把作用域未释放夸成已证实持续轮询泄漏。

## 全部首审意见与修复证据

| ID / 初审新增行锚点 | 首审可验证发现 | 本轮证据与判定 |
|---|---|---|
| F1 · `remote.ts:204` | source.return 同步重入 dispose 时，任务未发布，unregister/provide 各两次、内外 Promise 不同；sourceClose 一次不足以保护整次卸载。 | 唯一 disposal 在 owner、abort、source return、撤注册之前发布；持久回归及独立探针均为同一 Promise、source/撤注册各一次，owner.stop 重入与重复调用也通过。addressed。 |
| F2 · `remote.ts:224` | 自然 done 后 finally 仍等待 return；不合作 return 令正常 next 无界挂起。原 base 立即 done 且return0，初审头100ms仍TIMEOUT、return1。 | 自然耗尽立即 done、return0；running-next-error 仍return1，停止后的 late done 不绕过已发起关闭。持久故障控制及独立探针通过。addressed。 |
| F3 · `harness-host-remote-adapter.test.js:248` | late acquisition 用例只 throw，异常被 abort catch 消费；删除获取后停止围栏仍绿。 | 以合法帧和 reads 显式断言 `[reads, returns] === [0, 1]`；最终 M6 精确由该用例击杀。addressed。 |

F1/F2 定为 P2 的依据是合法合成 source 可复现，当前真实 composition/packed 未证明严重生产故障。正常终止的旧 return 总计3已由 F2 推翻：自然耗尽0，consumer return/throw共2；next-error仍1，未放宽故障负控。

## 独立验证与反例

| 命令/证据 | 实际结果 |
|---|---|
| `pnpm test:file tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-lifetime.test.js tests/integration/harness-plugin-host-watch.test.js` | 48 passed、0 failed；实施方另保留两个新增回归各自 RED→GREEN |
| `pnpm typecheck`；`pnpm test:file tests/integration/harness-plugin-artifact.test.js` | exit0；新 packed Host29 passed，消费者再动作前两个不同原生 generator.return 完成 |
| `node --test .superpowers/review-652/final-probes.test.mjs` | 8/8；owner.stop重入、首次40ms期限不被重复调用延长、同步撤准入、late done不绕过owned close、错误、无return/throw均通过 |
| `node scripts/review-mutate.mjs .superpowers/review-652/final-mutations.json` | 最终技术树整表一次10/10 KILLED，exit0；每项 killedBy、原字节还原、还原后基线绿 |
| `pnpm test:file tests/contract/content-placement.test.js`；`git diff --check` | 5/5；exit0；公开面、计划及最终PR门禁由协调者复核 |
| 协调者隔离组合，非子评审执行 | `test/mmp-650-652-final` / `.worktrees/mmp-650-652-final`，真实main `b7040174`加静态最终差异，五hash一致；冻结安装exit0，`pnpm verify`4092通过（1596契约/2270集成/226E2E），生产浏览器21通过，均exit0 |

运行态 probe/spec 只作本次执行材料；持久回归在既有契约套件，正式结论以上述行为与输出自包含记录。合作资源的 finally/return 和实际调用结算均有证据；任意不合作 await 仍只受有界撤权约束，不能宣称强制清理。

首审完整八项为7 KILLED、1 SURVIVED（M6），脚本退出1且还原基线绿；保留该历史，不以修复后结果覆盖。最终表保留原八机制并补两项根因控制：

| ID | 机制 | killedBy | 首审 → 最终 |
|---|---|---|---|
| M1 | stop即时关闭真实source | pending watch value | KILLED → KILLED |
| M2 | parked外层return/结算 | remote dispose releases a parked generator | KILLED → KILLED |
| M3 | sourceClose先发布、防同步abort重入 | source return synchronously aborting | KILLED → KILLED |
| M4 | 停止后晚帧围栏 | pending watch value | KILLED → KILLED |
| M5 | composition关闭真实generator | parked composition dispose | KILLED → KILLED |
| M6 | late acquisition后禁止next | a source acquired during synchronous stop | SURVIVED → KILLED |
| M7 | outer finally结算active call | remote dispose releases a parked generator | KILLED → KILLED |
| M8 | 运行帧strict JSON | running watch rejects invalid frame | KILLED → KILLED |
| M9 | 整次disposal先发布 | source return synchronously reentering dispose | 新增 → KILLED |
| M10 | 自然耗尽不等不合作return | naturally exhausted watch completes | 新增 → KILLED |

## 收尾与恢复

实施与复评分离；原 ExecPlan 已重开、记录方案比较和 RED/GREEN，工程复评后归档。关闭修复只涉及 remote 与既有契约，composition/security 模块未顺手扩张。变异自动逐字还原、探针释放 gate；回滚撤销代码即可，无数据迁移或用户数据删除。

最终源码已独立接受；提交整理、真实 main 接合、公开面、当前 head 批准/Fast Gate、三条作者回复/resolve 与双向 issue 回读仍由协调者按直接条件授权执行，不从本记录推断已合并。技术字节变化则回到复评门；不改变 Planning Status 或 native blocking。

2026-11-16 实际接合回读：本分支已重放到真实 `main@b70401740fe5d353c864f74e1a44b352d8bff138`；仅 review 索引冲突，保留 #650/#651/#652 全部条目。range-diff 的技术补丁相同；本批11个技术文件逐字等于已通过4092＋21验证的最终组合检出，五个独立复评hash仍一致。仅文档上下文变化不扩大代码验证；当前公开head的门禁及合并结果，以 `gh pr view 652 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,state,reviewDecision,statusCheckRollup,mergeCommit` 和全部 review threads 回读为准，不预写完成。
