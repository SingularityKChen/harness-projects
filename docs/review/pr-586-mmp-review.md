# PR #586 MMP 交付评审

## 锁定事实

- 日期：2026-11-10（Asia/Singapore）。
- 首轮 immutable head：`f1d92d7b154c8c7c37deb41c0b18118db6836fe8`；评审 diff base：`c9bb17b833295f26c750bd8c4bf425df53e9701f`；base 分支 `main`。全部 6 个变更文件与两个提交已审读。
- 两个提交：`ebc51d7a0346ca0b170ea6dc286874d4662fa7dd`（ExecPlan）、`f1d92d7b154c8c7c37deb41c0b18118db6836fe8`（修复与契约）。PR ready；`closingIssuesReferences` 精确关联同仓 #309，标签满足 kind/area 规则。
- REST reviews/comments 均为空；GraphQL reviewThreads 为 0，`hasNextPage=false`。
- 远端回读显示 `mergeable=CONFLICTING`、`mergeStateStatus=DIRTY`。主控提供的当前 `origin/main` 为 `3edeedb3eb27379b19292303d183691891eae73c`；这是整合条件，不能用旧 base 的评审和 CI 冒充整合后证据。
- 评审账号 `Singularity-AI-Bot`；开发、作者回复与合并账号 `SingularityKChen`。
- 用户直接授权（由主控记录）：无 P0/P1 时由本评审会话负责修复、独立复评、归档、提交整理、issue 核验及 rebase 合并；有阻塞项先交已有实现会话。本子评审仅修改此记录，无 GitHub 写入、提交、push 或合并。

## 审查前风险矩阵与最终判定

矩阵在代码审查前建立；以下为完成全部层检查后的证据及结论。

| 等级 | 代码与反例 | 产品闭环与架构 | 测试与 issue 验收 | 状态 |
|---|---|---|---|---|
| P0 | 仅两处 parser 替换，无迁移、删除、凭据、依赖或 main 门禁修改 | 七条不变量无变化；配置仍由真实挂载的 implementationKey 和受信 schema 决定 | 发布面机械检查与 diff 空白检查通过；代码92/文档96行 | 未发现 |
| P1 | own reads 排除继承值；defineProperty 保留特殊名；缺省/非法字段拒绝先于 adapter 写入 | Fake/SQLite 共用唯一解析器，输入与读回副本隔离；不涉及规划状态或外部 Saved/ack 状态 | 双适配器真实 round trip 与重开20/20；额外反例3/3，两个机制独立回退均被捕获 | 未发现 |
| P2 | 检查失败写入、恢复、optional 缺失、false/空字符串、枚举与 unknown 字段，无可达局部回归 | 普通对象返回语义与公开签名保留；没有额外兼容层、克隆框架或适配器分叉 | #309 四项工程 AC 均有直接证据；#311、#384 与本次根因不同 | 未发现 |
| P3 | 两行替换与共享测试符合最小闭环，无有价值的额外抽象或机械拆分需求 | 本地结果、hosted CI、产品/发布裁决边界清楚 | 命名表/装配计数同步更新；ExecPlan 与索引具备，未新增重复 issue | 未发现 |

## 分层证据

### 代码、产品与架构

`packages/capabilities/src/connector-account.ts:156` 使用 `Object.hasOwn`，缺 required 立即拒绝，缺 optional 直接跳过；显式 undefined 仍通过原有闭集校验或类型校验拒绝。`:165` 使用 enumerable/writable/configurable 的 own data property；`__proto__` 不调用 Object.prototype setter，constructor/toString 与普通字段同形处理。输出保持 `Object.prototype`，没有新的持久化格式或接口。

核对 SQLite `storage.ts:119–135`：真实挂载查找与解析在 atomic 内完成，JSON 写入发生在解析成功之后，读口重新按实际 implementationKey 解析。核对 Fake `storage.ts:261–278`：同样先定位挂载/锚点，再解析，structuredClone 捕获副本；读口也解析独立副本。两个适配器重开都复验已有配置，未出现第二套解析规则。配置值仅允许 string/boolean，因此独立顶层复制足够，不需深克隆重构。

新增共享用例 `tests/contract/suites/storage-connector-account.js:98–167` 在两个适配器执行：分别及组合声明 `__proto__`、constructor、toString；false、空字符串、合法 enum；own keys、JSON 与普通对象原型；输入/返回值突变；undefined、null、array、object、symbol、非法 pattern/长度/enum、未知特殊名拒绝；失败旧值不变；SQLite close/reopen、Fake export/import 后重读，以及 optional 全缺省。原有用例继续覆盖同锚点跨工作区隔离、真实 schema 分派、损坏读口/重开拒绝、事务与 secret 句柄边界。

### 测试与对抗验证

全部命令在 `.worktrees/configuration-own-properties-20261109` 执行；未修改 production 或仓库测试文件。

| 验证 | 当前结果 | 边界 |
|---|---|---|
| `pnpm test:file tests/contract/storage-connector-account.test.js tests/integration/storage-connector-account.test.js` | 20/20，0失败/跳过/取消 | 真实 Fake/SQLite 共享契约和集成 |
| `pnpm run typecheck` | 退出0 | 当前树类型检查 |
| `pnpm run boundaries` | 9/9，0失败/跳过 | 包依赖与壳边界 |
| `node --test .superpowers/pr586-review/probe-parser.test.mjs` | 3/3，0失败/跳过 | 补充本地反例，不提交仓库测试 |
| `node scripts/review-mutate.mjs .superpowers/pr586-review/mutations.json` | 2/2 KILLED，退出0 | 对原文副本变异，工具确认还原及基线 |
| `node scripts/rule-checks.mjs disclosure c9bb17b833295f26c750bd8c4bf425df53e9701f` | 退出0 | 已提交差异及提交信息；不代替人工检查 |
| `node scripts/rule-checks.mjs size c9bb17b833295f26c750bd8c4bf425df53e9701f` | 代码92/1000，文档96/1500 | 增删之和，未计本轮未提交审查记录 |
| `git diff --check c9bb17b833295f26c750bd8c4bf425df53e9701f...f1d92d7b154c8c7c37deb41c0b18118db6836fe8`（Python subprocess argv） | 退出0 | 锁定 diff 的空白检查 |

补充反例遍历全部 `Object.getOwnPropertyNames(Object.prototype)`：逐名合法 false 保留及描述符正确、普通及 null-prototype 输入均成功、optional 缺失不生成 own 字段、required 缺失拒绝、非法值和 unknown/symbol 继续拒绝。复制的 parser 与 production 原文字节相同，SHA-256 为 `800b5aa1d3a0d72b67bd879c591a22f07c915b656794f36452c593abf2044619`；变异只触及 `.superpowers/pr586-review/connector-account.ts`，结束后逐字节确认与 production 相等。

| 变异 | killedBy | 最终树整表重测 |
|---|---|---|
| M1：safe copy 退回 indexed assignment | `safe-own-copy` | KILLED：特殊名值/own 属性断言失败 |
| M2：own reads 退回 undefined/inherited lookup | `own-read` | KILLED：缺省继承名字的拒绝/缺失断言失败 |

### Issue、重复追踪与 hosted checks

现场读取 #309：四项 AC 分别由特殊名 round trip、缺省/required/unknown/invalid 拒绝、副本隔离，以及指定两个测试入口的20/20覆盖。issue 仍 OPEN 且 checkbox 尚未由 owner 勾选；这属于后续 issue 核验操作，不是缺失测试或安装人验。#309 没有新增的人类安装验收条件，本次也不代表完整产品 UAT 或 R1 发布接受。

搜索 configuration/prototype/own properties 并核对 #311 与 #384：#311 是普通 Fake Storage 端口 alias 的广泛快照闭环，明确记载 account/configuration 已复制；#384 是 core setup 的 by-value/null-prototype 比较且已关闭。两者不替代 #309，不需重复建问题。本次不将已有广泛快照或通用访问器加固问题扩为本 PR 缺陷。

当前 head 的 hosted `PR Fast Gate`、Verify 与 Browser 均 SUCCESS（CI run `42613648437`）；CodeQL 成功。Rule checks 取消 run `42613648348` 有同 head 成功后继 `42613650516`（Resolve PR base、PR size、Disclosure），Issue policy 取消 run `42613648591` 有成功后继 `42613650382`。`Create review session` 失败 run `42614242551` 的真实日志是本地评审端点 HTTP404，属于 `docs/review/mvp-review.md` 已定义的非必需可选检查；不归因于 parser 或假称已成功。

## 结论及后续

锁定 head/base 上未发现可行动 P0/P1/P2/P3，#309 工程闭环成立，最小实现与相应测试适当，没有建议额外重构。本轮没有实现改动、GitHub review/comment、issue/看板写入或新问题登记。

远端当前冲突必须先由主控整合解决；rebase/force-push 后本轮旧 head 结论不直接沿用，需重新锁 head/base、核对差异并跑相关测试及当前 hosted gate，更新本记录。issue checkbox、正式评审、最终发布面检查、commit 整理及人类授权范围仍由主控收尾。此处20/20与附加验证是本轮 fresh local 证据；PR 原述3723/3723为作者历史结果，本轮未重复完整套件，不将其冒充本轮观察。

2026-11-10 SGT 首轮正式回读：`Singularity-AI-Bot` 已在锁定 head `f1d92d7b154c8c7c37deb41c0b18118db6836fe8` 一次提交完整 review `5835129635`，事件为 APPROVED。最终 push 后须重新锁定并取得当前版本结论。

2026-11-10 SGT 整合门：全部四项非阻塞修复已独立复评通过，最终固定组合 f172cb02 的完整工程证据与逐实际 main 门见 `docs/review/2026-11-10-pr586-pr592-mmp-review.md`。本 PR 最终 push 后仍重读精确 head/base、托管检查、批准、全线程和双向 issue 关联；与受验前缀逐 blob 不符则回到验证。
