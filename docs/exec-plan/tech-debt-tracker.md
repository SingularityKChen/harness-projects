# 技术债务跟踪

本文件只记录实施 ExecPlan 时**明确接受延期**、且会影响可维护性、可靠性、正确性、可观测性、性能、迁移清理或开发体验的技术债。功能路线图、尚未裁决的设计候选和已有 issue 清单本身不自动算债务。当前发布前系统与架构收敛计划（Batch 0 起）已有经批次决策接受的延期项，见下表。

## Open Items

每项使用一行，字段为：债务 id、当地日期、状态、相关 ExecPlan 仓库相对路径、子系统、分支、记录者、简述、延期理由、不处理的影响、建议下一步。新增前先搜索同一事实的既有项与 issue；有 issue 时附编号，不复制 issue 正文。

| ID | 日期（本地） | 状态 | ExecPlan | 子系统 | 分支 | 记录者 | 简述 | 延期理由 | 遗留影响 | 下一步 |
|---|---|---|---|---|---|---|---|---|---|---|
| TD-001 | 2026-09-29 | Open | `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` | 测试（`tests/mvp0`） | `docs/system-architecture-renewal` | B0-T3 债务登记者 | `tests/mvp0/chain.test.js` 节点 3 的标题写「Draft→Issue 提升不换 id」，用例体只查询、二次引导与计数，不调用任何提升；文件头注释仍写"故意失败""当前必须失败"，与 7/7 全绿的现状不符。变异 M1（`promoteEntityIdentity` 成功分支返回另一个 `entityId`）使 `tests/e2e/chain-bootstrap.test.js`「身份：Draft→Issue 提升只换外部 id」变红，而 `node --test tests/mvp0` 仍为 `ℹ tests 7`、`ℹ fail 0` | #217 只改 `.md`，不改测试代码（`docs/product/vertical-path.md` §2.1 附行与 `tests/mvp0/README.md` 已原地标注，见 Batch 0 的 0.5） | MVP-0 全绿会被读成 Draft→Issue 提升受保护；实际保护只在 `tests/e2e/chain-bootstrap.test.js`（core 辅助函数直接调用，旁证层），生产同步路径反例见 P1 | #224 的测试规则 PR 把节点 3 改名为它真正断言的内容并去掉过时文件头；或由 Draft→Issue 生产入口的承接 issue（H2，尚未创建）改成经 `composeCore` 的真实晋升用例 |
| TD-002 | 2026-09-29 | Open | `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` | 测试（`tests/mvp0`、`tests/e2e`） | `docs/system-architecture-renewal` | B0-T3 债务登记者 | `tests/mvp0/chain.test.js` 的 `chainFor`（节点 5、6、7 共用）与 `tests/e2e/delivery-lineage.test.js` 的 `startChain`（四条用例共用）直接调用 `providers.development.createChangeRequest` 种下变更请求；`packages/core/src`、`packages/controller/src`、`packages/client/src` 没有任何创建变更请求的生产入口 | 第 9 步（创建变更请求）没有生产入口，测试只能绕过 core 直接驱动替身 | 节点 6、7 与交付谱系四条用例的"变更请求跳"证据绕过第 9 步，不能证明生产路径产出同样的谱系；`delivery-lineage`「负向：未创建执行上下文时」也直接调用一次，但那是反例种子，不计入本债 | #235 落地第 9 步生产命令时，把 `chainFor` 与 `startChain` 改走该命令，并在 §2.1 第 9 行与 R1 §2.1.1 同 PR 更新观察基线 |
| TD-003 | 2026-09-29 | Open | `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` | 文档（`docs/product`、`docs/architecture`） | `docs/system-architecture-renewal` | B0-T3 债务登记者 | `docs/product/vertical-path.md` §2.1 与 `docs/architecture/release-gates.md` §2.1.1 按"文件 + 用例标题前缀"引用用例、按 issue 编号引用承接，二者都没有机械守卫；回读只靠人工直接运行测试文件加 `--test-name-pattern`（Node 26 实测：用 `node --test <文件>` 时，pattern 一条用例都没匹配上也输出 `ℹ tests 1` / `ℹ pass 1`，文件本身被计成一条通过的测试；不加 `--test`、直接 `node --test-reporter=spec --test-name-pattern=… <文件>` 时无匹配为 `ℹ tests 0`，匹配一条为 `ℹ tests 1`；该判据不依赖 `--test-isolation`，因为 Node 22 没有这个选项，Node 22 上的行为依据官方文档、未实跑） | 守卫属于测试基础设施，不并进只改 `.md` 的 #217；#182 当前范围是 ExecPlan 引用的仓库路径，不含用例标题前缀与 issue 状态 | 用例改名、被删或 issue 关闭后，矩阵与映射静默过期，按 `node --test <文件>`（加 `--test`）回读永远显示非零计数，失效引用无人发现 | 在 #182 的守卫里扩范围（标题前缀至少匹配一条用例，且判据取直接运行测试文件（不加 `--test`）时的 `ℹ tests` ≥ 1，且输出里有非文件路径的 `✔ <前缀>` 行、伪造前缀读回 `ℹ tests 0`，被引用 issue 处于开放态或矩阵行已随之更新），或另开 issue；此前靠 Batch 0 `Global Constraints` 的"同 PR 更新矩阵行"纪律 |

## Resolved Items

已通过当前 head 的测试和产物回读确认解决的项移到此处，保留原 ID、原始字段、解决 PR/commit 和验证证据；不能仅因代码合入就标已解决。

## Superseded Items

被设计裁决或范围变化取代的项移到此处，保留原 ID、替代决策的 ADR/ExecPlan 与日期，不静默删除。

## 更新纪律

执行者在每批的 `Progress` 和 `Decision Log` 中记录新增、解决或取代的债务 ID，完成控制计划前核对本文件与实际开放 issue。`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` 是本轮控制计划；本文件不是第二份实施计划。
