# PR #564 MMP 交付评审

## Purpose / Big Picture
当前不可变 head 的独立交付结论：**APPROVE**。无 P0/P1/P2；一项 P3 测试判别力补强。评审覆盖整张风险矩阵，没有在首项问题后停止。

## Context and Orientation
2026-11-07 观察：head `a96522978f377fe29849652b32db67e61b47250c`；直接 base `04af317ec3bda5084ab1e44ea5e3559fd4622079`；#564 关闭 #562，父项 #556 仅引用。完整原生线程为 0，分页终止；缓存 `*-threads.json` 回证两端 SHA。执行上下文为检出 `feature/pull-request-issue-link` 的工作树 `.worktrees/pull-request-issue-link-20261107`。
不可变差异缓存为 `.superpowers/pr559-565-review-20261107/564-immutable.diff`；本记录只对上述 head 有效。#565 依赖 #564，原生 stack #566；#544 拥有持久原生观察恢复，#557 拥有 PR assignee。

## Design / Spec
采用 Superpowers 的证据优先验证、Qian Systems Router 的系统边界/信息反馈和 First Principles Development 的事实/约束分离，审阅 Provider→Core→Host→strict client→UI 的完整路径。关系观察不等于 implements 或 execution lineage；创建确认与选定关系确认分别结算；Planning Status 保持独立。
两条原生流各自分页，按 native PR/repository 身份联合；CrossReferencedEvent 的 willCloseTarget 不能代替 closing connection。

## Global Constraints
仅拥有本评审记录与运行态 repro/spec/log；不修改生产实现，不 commit/push，不执行 GitHub 写入、模型启动或合并。原工作树检查干净；结束时除本评审记录外无 tracked 改动。证据文件置于 `.superpowers/`，正文不写本机路径和内部系统。

## Plan of Work
1. 锁定当前 head/base、完整线程、checks、issue scope 与 immutable diff。
2. 完成五层 P0–P3 矩阵，检查正常、失败、并发、权限、恢复、正文和独立验收边界。
3. 运行最窄相关回归、浏览器链与带 `killedBy` 的变异；独立反例只修改 fixture/repro。
4. 汇总全部意见；交原 owner 修复，独立评审者不参与修复。
回滚仅移除本评审记录及对应运行态证据，不影响用户 PR 或数据库。

## Validation and Acceptance
| 层 | P0 | P1 | P2 | P3 | 证据与判定 |
|---|---|---|---|---|---|
| 代码 | 未发现 | 未发现 | 未发现 | 未发现 | 双流游标/页数/deadline、去重、negative cohort、late response 已审 |
| 产品闭环 | 未发现 | 未发现 | 未发现 | 未发现 | refs-only/closing 双标记、partial 不冒充空集合、真实面板 5/5 |
| 架构 | 未发现 | 未发现 | 未发现 | 未发现 | 单 Planning、Host 权威、Provider 边界、凭据 handle、事实谱系均核对；无越层依赖 |
| 测试 | 未发现 | 未发现 | 未发现 | REL-564-F1 | 真实命令与变异见下；绿色回归不能否定独立反例 |
| 工作项 | 未发现 | 未发现 | 未发现 | 未发现 | issue 标签/scope/closing 关联正确；#544/#557 无重复实现；人工接受保持独立 |

在上述工作树根运行：

```sh
pnpm test:file tests/contract/planning-issue-references.test.js tests/contract/planning-issue-closing-links.test.js tests/contract/issue-closing-links-reader.test.js tests/contract/ui-issue-closing-links.test.js tests/integration/issue-closing-links-scope.test.js tests/integration/harness-plugin-issue-closing-links.test.js
pnpm test:file tests/browser/native-link-detail.test.js
node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/564-mutations.json
```

实际窄回归 **82/82**、Browser **5/5**，均 exit 0；日志 `564-narrow.log`、`564-browser.log`。变异脚本 baseline 和还原后 baseline 均绿；逐原文字节还原，无遗留源码改动。

| 变异 | 目标性质 | 实际结果 |
|---|---|---|
| R1 | 拒绝外 Issue target | KILLED，`reference source validates target` |
| R2 | 两条原生流联合 | KILLED，`two native streams union relations` |
| R3 | 重复事件保守 hint | KILLED，`native streams own their cursors` |
| R4 | 顶层与 per-kind completeness 等价 | SURVIVED，测试补强项；脚本 exit 1 |

发现：**[P3] Exercise contradictory aggregate and per-kind completeness**，锚点 `tests/contract/issue-closing-links-reader.test.js:43`。新增的 forged coverage 负例还没有覆盖顶层 state 与两个关系流完整度之间的等价约束。独立 R4 变异只移除 strict reader 中 `(v.state === 'complete') !== complete` 这一守卫，当前 Provider/reader/Core 相关测试批仍全绿（SURVIVED）；其余三项来源目标、引用流和 hint 变异均由指定用例杀死。当前生产守卫本身正确，这是一项非阻塞的判别测试缺口：请增加 complete + 一流 unavailable/stale，以及 partial + 双流 complete 的两种伪造 DTO，均断言拒绝，同时保留现有合法 partial 正例。这样该守卫回退时测试能明确失败，避免把未知关系错误包装成已完成。

metadata 缓存中 `PR Fast Gate=SUCCESS`；可选 `Create review session` 为 FAILURE，重复 Rule/Issue jobs 有 CANCELLED 且同 head 后继 SUCCESS。这里只记录观察，不代替父协调的当前远端门禁回读。直接 base 规模：代码/测试/配置 440 行、原 PR 文档 156 行，均低于叶 issue 的 800/1300 限制。

## Progress
- [x] 2026-11-07 锁定当前 immutable diff、完整空线程、scope 和风险矩阵。
- [x] 2026-11-07 完成逐文件/跨层/产品/权限/恢复/issue 审阅。
- [x] 2026-11-07 完成窄回归、真实 Browser 与最终整表变异，核对还原。
- [x] 2026-11-07 全部意见写入本记录及 `review-relations.json`，未发 GitHub review。
- [ ] 原 owner 可补非阻塞 reader 反例后复评。

## Surprises & Discoveries
删除完整度等价守卫仍通过相关测试批；因此明确限制测试判别力结论，而不把守卫正确性误记成已被现有用例锁定。

## Decision Log
- 2026-11-07：按每层直接 base 评审与计量，不把 #565 继承源码计作本层新增；#556 仍为父项，#544/#557 不扩入。
- 2026-11-07：P3 只要求现有 reader 测试加两种矛盾 DTO，不引入通用测试框架。

## Idempotence and Recovery
读操作和窄测试可重跑；变异夹具已按字节还原，`git status --short` 只有本评审文档未跟踪，`git diff --check` exit 0。任何新 head 使本结论需要重新锁定，不复用旧绿。外部 PR/Issue 未被本评审修改。

## Interfaces and Dependencies
依赖现有 Node/pnpm、只读 GitHub metadata 缓存、隔离 SQLite/HTTP fixtures 与 Chromium。未新增写端口、持久快照或事实所有权。

## Outcomes & Retrospective
完整矩阵结论为 **APPROVE**。一项非阻塞 P3，无已证实 P0/P1/P2。工程测试不是 live GitHub mutation、exact-artifact Desktop 验证或人类发布接受；这些均未在本评审执行。后续 GitHub review、owner 修复和新 head 复评由父协调串行安排。


### REL-564-F1 · P3 判别测试补强（2026-11-07）

修复上下文：检出 `feature/pull-request-issue-link`、起点 `a96522978f377fe29849652b32db67e61b47250c`，在工作树 `.worktrees/pull-request-issue-link-20261107` 根运行。人类授权范围由评审协调者交付：只补 strict reader 测试和本修复记录，不改正确的生产守卫、不提交/推送、不写 GitHub。
补入两个独立拒绝用例：顶层 complete 且 reference 流 unavailable/stale；顶层 partial 且两流均 complete/current。两者 DTO 其余字段均合法，顶层 partial 的 stale=true 避免由另一守卫代为拒绝。既有真实合法 partial 正例保持不变。
初审 `564-mutations.log` 的 R4= SURVIVED 是修复前事实；Superseded by 本段最终变异结果（2026-11-07）。最终树整表执行一次：

```sh
node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/564-mutations.json
pnpm test:file tests/contract/planning-issue-references.test.js tests/contract/planning-issue-closing-links.test.js tests/contract/issue-closing-links-reader.test.js tests/contract/ui-issue-closing-links.test.js tests/integration/issue-closing-links-scope.test.js tests/integration/harness-plugin-issue-closing-links.test.js
pnpm run typecheck
```

实际结果：变异 exit 0、R1–R4 **4/4 KILLED**，每项均有指定 `killedBy` 归因，baseline/还原后 baseline 通过；R4 的失败名精确包含两个新增拒绝用例，没有靠其他异常杀死。六文件窄回归 **84/84**（零失败/跳过），typecheck exit 0。运行态日志为主评审目录 `.superpowers/pr559-565-review-20261107/564-p3-{mutations,narrow,typecheck}.log`。
`git diff --exit-code HEAD -- packages` exit 0，生产文件与修复前一致。当前仅测试文件和修复文档有变更，未动索引；不以此宣称 live 平台、Desktop 或人类接受。补测实现完成，Superseded by 2026-11-07 原 relation reviewer 独立 scoped 复评通过（84项实现回归、独立reader5/5、4/4归因变异）；原初审结论和真实 SURVIVED 证据保留。

### CI 随机内部身份误报修复（2026-11-07，Refs #558）

整合基线 head `32872b17e415a00286f82348dbc8fc06039a927e` 的托管 Verify run `42344975573` 暴露 `source-number-restart` 断言误报：合法 opaque EntityId 偶含 449，整段 JSON 的裸数字正则将它误认作原生号泄漏；实际 content 已 redacted。此为 #561 基线的测试判定缺陷，在 #564 做最小整合门修复，Refs #558，不扩大原生关系能力或修改生产实现。
在 `.worktrees/pull-request-issue-link-20261107`、检出 `feature/pull-request-issue-link` 的工作树根，先仅用既有 `ids` 依赖注入含 449/450 的固定 UUID，旧断言稳定 **3 pass /1 fail**。同根因覆盖单 hidden、撤权 store 与不可用视图三处；最终按 redacted content/row 允许形状、内部路由身份不变和已授权可读搜索数为0判定，剩余文本门只识别已知完整仓库/来源标识、metadata 字段或 native number 字段，不再扫描裸数字。

```sh
pnpm test:file tests/integration/source-number-restart.test.js
node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/564-number-id-leak-controls.json
pnpm run typecheck
```

修复后 **4/4**，typecheck exit 0。负控对实际断言入口注入 sourceNumber、repositoryName、native number、redacted row numberLabel、searchHint 与完整来源标签；六项均由该生产链用例 **6/6 归因 KILLED**，baseline/还原后 baseline 通过。负控只改测试内观察快照，夹具逐字节还原，没有改生产代码。保留原 redaction/撤权门，未靠 rerun 或屏蔽测试规避失败。
运行态证据为主评审目录 `.superpowers/pr559-565-review-20261107/564-number-id-{ci-red,ci-green,leak-controls,typecheck}.log`。仅改此集成测试及本修复记录，不改索引、不 commit/push/GitHub 写入；交原 relation reviewer 独立复评后由协调者绑定新 head/托管门，本地结果不是安装或人类接受。

## Bottom Change Note
- 2026-11-07：先建立全矩阵，随后追加独立审计、实际测试/变异、全部发现及产品接受边界；保留原 owner 修改权。

- 2026-11-07：完成 REL-564-F1 两类矛盾 coverage 负例与4/4归因变异补强；记录84项窄回归、typecheck及生产守卫未变，交原评审者独立复评。

2026-11-07 SGT 最终重锁：原实现 production patch-id 与原 base 上审查补丁相同，reader 与独立已接受修复的内容哈希相同；归档/索引和 #544/#556/#460 边界经独立 scoped 复核，无新增发现。当前 head 的 CI/threads/双向 issue 关联仍由合并前回读判定。

- 2026-11-07：修复整合 Verify 暴露的裸数字误判，固定含原生号数字的内部UUID并保留6项真泄漏负控；Refs #558，工程能力范围不变。

2026-11-07 SGT CI 修复独立复评：APPROVE，无新增发现。原评审者独立重跑 source-number-restart 4/4、六项真实泄漏负控 6/6 归因 KILLED，baseline/还原均绿；固定内部 UUID 含449/450仍保留路由身份，精确脱敏 content/row、不可用 view 和可读搜索0均保持。生产补丁和原 P3 reader 未变。此通过结论取代本段先前等待复评状态。

2026-11-07 SGT 当前只读平台核验：完整读取 #545 的 CROSS_REFERENCED_EVENT（pageInfo.hasNextPage=false），#555 对 #545 的 willCloseTarget=false，#555 closingIssuesReferences 不含 #545。该当前原生事实支持仅引用场景，不冒充实际安装 UI 或人类接受。
