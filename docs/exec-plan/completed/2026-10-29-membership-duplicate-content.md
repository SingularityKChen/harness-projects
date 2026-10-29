# Planning 成员重复内容契约 ExecPlan

> 状态：Completed；本地及独立复评通过，最终远端门禁按下述命令回读；创建：2026-10-29；规范：根 `PLANS.md`。
> 闭环：同仓 #337；分支 `fix/membership-duplicate-content`；PR base 为 `main`。

## Purpose / Big Picture

完整 Planning 读取的一批成员中，同一内容出现不同 item id 时，两个 Storage adapter 都按输入顺序由后项获胜。公开端口说明这一规则，共享测试证明其不会留下被替换成员的字段值，且能杀死原 SQLite M7 突变。成功无需改变当前正常产品行为。

## Context and Orientation

2026-10-29 独立取证基线为 `main@bb9a7a259ab81ca89f01d03aa837555607a74fdd`；执行工作树 `.worktrees/membership-duplicate-content`。开始前回读 `git rev-parse HEAD origin/main`、`git status --short --branch`，所有命令在检出 `fix/membership-duplicate-content` 的工作树根运行。

`MembershipRecord` 的内容键是 `(workspaceId, projectExternalId, contentKind, contentExternalId)`，成员键是 `(workspaceId, itemExternalId)`。`packages/capabilities/src/storage.ts/replacePlanningMemberships` 收敛完整 project 集合；`packages/providers/fake/src/storage.ts` 与 `packages/storage/sqlite/src/storage-sync.ts` 已在循环内移除同内容的旧成员及其字段值，再写当前项，所以现状均后项获胜。`tests/contract/suites/storage-identity-membership.js` 缺少同批重复内容反例；`tests/contract/storage-contract.test.js` 用 identitySync 组装配两 adapter 并维护独立用例计数。

#330 的已完成计划 `docs/exec-plan/completed/2026-10-13-planning-membership-reconcile.md` 记录 M7：去掉 SQLite replace 循环内去重，现有用例仍通过。本任务补这个契约洞；不是证明当前 Fake/SQLite 已发生正常输入分叉。非快照分页时 remove/re-add 可给出重复内容输入，调用方不能依赖 core 恰好提前去重。

## Design / Spec

选择当前已有的“同内容后项获胜”，以 incoming 数组顺序为准，不按 item id、时间戳或数据库行序挑选。最终每个内容键仅保留最后一条完整成员记录；被替换 item 的字段值删除；其它 workspace/project 及不相关内容不动。成员值比较包含时间字段，避免只钉最终 id。现有 scope guard 和 transaction/atomic 边界不变；非法 scope 输入仍整轮拒绝并保持既有状态。

独立系统设计建议保留后项获胜；故障设计提出重复输入整轮拒绝。最终独立复核拒绝后者：两个 adapter 已有一致语义，新增 preflight reject 会制造行为变更，并使原 M7 变为不经过的代码，无法满足 issue 指定的突变判别。也拒绝全局预去重、排序规范化、新唯一索引或历史约束矩阵：均超出这一个输入集合闭环，后者属于 #424。

SQLite 官方 [事务说明](https://www.sqlite.org/lang_transaction.html) 说明事务与失败后恢复边界；本计划沿用现有事务保证，不把单条 SQL 失败误认为整个业务操作天然已回滚。端口规则来自当前实现与本次裁决，不能归因于 SQLite 的 UNIQUE 约束自动规定后项获胜。

## Global Constraints

本次评审收尾允许集追加：`docs/review/pr-441-mmp-review.md`、`docs/review/2026-10-29-pr441-pr443-mmp-review.md`、`docs/review/README.md` 索引、`docs/project-management/merge-queue.md` 本轮顺序表。其余文件边界保持下文定义。

唯一修改允许集：`packages/capabilities/src/storage.ts`、`tests/contract/suites/storage-identity-membership.js`、`tests/contract/storage-contract.test.js`、本计划、`docs/README.md` 索引行（整合 owner）。产品 adapter 文件只用于临时 M7 注入，最终零差异；若测试揭示真实缺陷先更新计划再扩大。目标 100–220 行代码/测试新增+删除，严格小于 800；文档严格小于 1300，不凑 issue 预测行数。

单批、一个 owner；保留 scope replace 事务、跨项目 guard、实体/身份稳定性、七条系统不变量。无依赖、schema、迁移、兼容层、数据修复或历史库升级。不开 #424 全矩阵、不改 Status、blocked-by、blocking 或原生依赖，原「不自行合并」Superseded by Decision Log 的点名授权（2026-10-29）。人类 Demo #143/#236 与 R1 另行验收。

## Plan of Work

### Batch 1 · 固定后项获胜并杀死 M7

最小闭环是端口语义、两个 adapter 的同一共享断言和原 M7 的具名失败。主文件为 Storage 端口注释与 membership 共享 suite，允许集见 Global Constraints。

先在 identitySync 添加一条共享用例：种下旧成员及字段值，并把第一条 incoming A 预先存成成员且带字段值，再输入同内容 A/B（不同 item id、不同时间字段）与正常其它内容。断言最后一项的完整记录获胜，循环中被 B 取代的已存 A 字段值清除；A/B 反序输入时重复这一检查。将另一个 project/workspace 的同内容成员及其字段值作为 scope 对照，验证不被清理。可重复输入只断言最终成员集合，不承诺被循环中暂时替换成员的字段值会自动恢复。沿用已有 wrong-scope 拒绝与原子保存用例，不复制 #424。更新 identitySync 独立注册计数，保留组装配守卫。

本轮是契约补强：新增测试在当前实现上预期 GREEN，不能伪造基线失败。RED 来自 issue 指定 M7。用下列命令在新用例命名含 `duplicate-content-last-wins` 后临时删除 SQLite replace 循环内 dedup，再恢复：

    pnpm test:file tests/contract/storage-contract.test.js
    python3 - <<'MUTATION'
    from pathlib import Path
    import subprocess
    p = Path('packages/storage/sqlite/src/storage-sync.ts')
    original = p.read_bytes()
    text = original.decode()
    method = text.index('  replacePlanningMemberships(')
    start = text.index('        const stale =', method)
    end = text.index('        this.db.prepare(`INSERT INTO project_item_membership', start)
    try:
        p.write_text(text[:start] + text[end:])
        result = subprocess.run(['pnpm', 'test:file', '--test-name-pattern=duplicate-content-last-wins', 'tests/contract/storage-contract.test.js'])
        assert result.returncode != 0, 'M7 survived'
    finally:
        p.write_bytes(original)
    MUTATION
    pnpm test:file tests/contract/storage-contract.test.js
    pnpm verify
    pnpm run boundaries
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

预期原实现与恢复后 GREEN，M7 非零退出且失败来自 SQLite 新具名用例的 duplicate-content 行为，Fake 同名测试仍通过；不得把全 skip、装配计数错、编译错或环境错误当作 mutant killed。保存精确输出，确认最终 SQLite 文件字节已恢复。verify、边界和发布面检查 exit 0。重构只压缩重复测试准备，不重写 adapter 算法。回滚点为本批契约提交，可独立撤回，无生产数据动作。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| Storage 端口明确规则 | 注释写出内容键、输入顺序后项获胜及被替换成员字段清除 |
| 两实现结果一致 | identitySync 同一用例在 Fake/SQLite 都注册且通过；独立计数更新 |
| 顺序决定结果 | A/B 与 B/A 分别保留 B 与 A，完整记录相等 |
| 原 M7 被杀死 | 去掉 SQLite in-loop dedup 后新具名测试 RED，恢复后 GREEN |
| 原子与 scope 边界保留 | wrong-scope 拒绝、字段值及其它 scope 对照不变；原有完整组通过 |
| 产品行为无冒称 | 两 adapter 最终零 diff；本地 verify 与 hosted checks 分开 |

## Progress

- [x] 2026-10-29 09:11 SGT：独立核对两 adapter，比较后项获胜与拒绝方案，形成契约补强计划。
- [x] Batch 1：端口注释、共享用例、计数、M7 RED 与恢复 GREEN、必要重构完成；提交 `Refs #337`，等待整合 owner 独立审阅。
- [x] 本批相对 `origin/main` 完成发布面机械扫描、人工五类目检查、规模检查及 `git diff --check`。
- [x] Fix round 1：按独立验收修正字段清理断言、重跑 Fake-only / SQLite-only / M7 突变并逐字节恢复；最终完整验证由整合 owner 重跑。
- [x] 2026-10-29 10:03 SGT：F1 独立复评 ADDRESSED、无新发现；整合 owner 在稳定修复提交 `40e9aec7000a7055e61217f06e4f1ca44b7f893d` 重跑固定 shell `pnpm verify`，typecheck、2444/2444 与 MVP0 7/7 通过。归档与索引完成；最终 push 后另读 head/base/checks/threads 才 ready。

## Surprises & Discoveries

2026-10-29：issue 描述的是“去掉去重后的 SQLite mutant”分叉；当前 SQLite 与 Fake 的 replace 循环都已去重，不需要生产修复。种下两个相同内容成员本身违反现有唯一约束，测试必须先种一条、把重复放在 incoming 中，不能构造不可能的存储基线。

2026-10-29：新增测试第一次运行时把独立内容只种在旧状态、没有放入完整 incoming；Fake 按 replace 语义正确删除了它。修正为随 incoming 一并保留后，两 adapter 均通过。M7 注入移除 SQLite 循环内按内容删除旧成员的三条语句，Fake 新例通过，SQLite 新例在 duplicate-content 唯一约束处单独失败；SQLite 文件恢复后按字节与原文件完全一致。

2026-10-29：通过 Python subprocess 执行 `pnpm test:file` 时，pnpm 尝试 workspace reinstall；开始时在无 TTY 环境无法清理 `node_modules`，设置 `CI=true` 后又因 `esbuild` build script 未获准而中止，并短暂写入 `pnpm-workspace.yaml` 的 `allowBuilds` 引导内容。后续环境核查确认 Python subprocess 解析到 pnpm 11.25.0，而交互 shell 的 pnpm 是 10.28.2；`node_modules/.modules.yaml` 属于 v11/store v11，与原先 shell 安装的 v10/store v10 混用，导致重装。该引导改动已移除。已用现有依赖运行等价 Node 命令及 resolution preflight；整合 owner 将使用固定的 shell pnpm 环境再验证 `pnpm verify`。

2026-10-29 独立验收发现初版字段断言没有覆盖 duplicate loop：`item-old` 不在 incoming，字段值由 replace 的 scope stale 清理先删除。评审提供的 Fake-only 与 SQLite-only field-cleanup 突变均存活。修正后的共享用例在 replace 前存入 incoming[0] 及其字段值，确保它不会被 scope stale cleanup 移除；随后由第二条重复内容替换。跨 project/workspace 对照现在也使用相同内容键，并各自保存字段值。

## Decision Log

- 2026-10-29：本次用户指令明确点名 #441–#443，授权无 P0/P1 后由评审会话负责非阻塞修复、独立复评、提交整理、issue 核对与 rebase merge；#441 唯一 P2 只收窄 scope 删除承诺，不改变同成员键覆盖或生产行为，证据见 `docs/review/pr-441-mmp-review.md`。未授权规划 Status/依赖写入。

2026-10-29 / 独立计划评审者：保留已有后项获胜，仅补端口与契约。Rationale：满足原始 M7 验收、减少行为 churn，不以另一种输入拒绝替代用户要求的判别。用户授权设计收敛与实施；不修改规划状态和原生依赖。文件面见 Global Constraints。

## Idempotence and Recovery

测试各自新建临时/内存库，可重复运行。M7 由 finally 精确恢复文件；恢复失败就暂停提交并从保存字节恢复，不能用 reset 覆盖其它改动。重复执行 replace 的最终成员集合确定，但字段值不会因原成员身份恢复而凭空重建；不新增这类兼容承诺。撤本批提交恢复原契约描述与覆盖，无 schema 或用户数据回滚。新发现若超出允许集或预算，先就地修订计划。

## Interfaces and Dependencies

保留 `replacePlanningMemberships(scope, incoming): Promise<void>` 与现有 Storage/transaction API。使用仓库现有 Fake、SQLite、Node、pnpm，无网络凭据。提交后整合 owner 执行 `gh pr view -R SingularityKChen/harness-projects fix/membership-duplicate-content --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`，期望 base=main、关联 #337、checks 对应最终 head；读完 review threads 且验证通过才 ready。

## Outcomes & Retrospective

完成一个批次及一次独立验收修正：Storage 端口注明 workspace+project scope 与同内容按 incoming 顺序后项获胜，identitySync 共享测试及独立装配计数从 6 更新为 7。两个适配器都覆盖完整 winner 记录、反转顺序、循环中被替换且预先持久化的第一条 incoming 字段值清除，以及内容键相同的另一 project/workspace 成员与字段值保留；原 scope 拒绝及原子写入控制继续运行。

Fix round 1 判别证据：当前实现 storage 契约文件 150/150 通过。原 M7 删除 SQLite in-loop 去重时 Fake 新用例通过、SQLite 具名用例在 duplicate-content UNIQUE constraint 失败（1 pass / 1 fail）；Fake-only 删除 in-loop 字段清理时 Fake 具名用例在“同内容后项取代已存的前项时，前项字段值必须在循环内清除”断言失败；SQLite-only 删除字段 DELETE 时 SQLite 具名用例在同一测试中因 `FOREIGN KEY constraint failed` 失败（各突变 1 pass / 1 fail）。三个突变涉及的源文件均在 finally 恢复并逐字节确认。每次 focused run 均执行两个适配器用例，没有 skip。完整 `pnpm verify` 在上一轮实现提交 `ec3566d6c5fdff674378666f6361e309ab0cc4ab` 上由整合 owner 通过：2444 main tests + 7 MVP0 tests；此起始 head 归因 Superseded by 本节整合 owner 最终验证记录（2026-10-29 10:03 SGT）：早前运行期间仅计划文档从 `07a1458` amend 到 `ec3566d`，不能倒签起始 head。该运行早于本次测试断言修正，最终完整验证由整合 owner 在新 head 上补跑。上一轮的 typecheck、resolution、boundaries、disclosure、size 与 diff-check 证据仍针对 adapter/端口行为未变化的同一实现；fix round 1 最终 head 的 disclosure exit 0、size exit 0（代码 44/1000 行、文档 122/1500 行）、`git diff --check origin/main...HEAD` exit 0。完整人工五类目检查由整合 owner复核。

整合 owner 最终验证记录（2026-10-29 10:03 SGT）：在检出 `fix/membership-duplicate-content`、稳定且 clean 的 `40e9aec7000a7055e61217f06e4f1ca44b7f893d` 工作树运行原命令 `pnpm verify`，exit 0；typecheck、2444/2444 契约/集成/E2E 与 MVP0 7/7，无失败、无 skip。修复后 focused 150/150 及三个 mutant 的精确 RED/恢复 GREEN，与独立 scoped 复评 PASS 共同闭合字段清理盲点；没有需要扩大到 adapter 重构的缺口。之后仅归档/索引/提交文案收敛，最终 PR #441 的 hosted checks 与双向关闭引用以 push 后回读为准。

#424、完整产品 Demo 与 R1 均未据此关闭。本地通过不能替代 hosted CI、产品接受或人类合并裁决。无新增技术债。

## Bottom Change Note

- 2026-10-29：首次创建；明确这是现有后项获胜规则的契约补强，加入原始 M7 的精确注入、恢复和非空判别要求。
- 2026-10-29：完成 Batch 1；端口注释和共享重复内容用例补齐，并记录 M7 单一 SQLite 失败、精确恢复及完整本地验证证据。
- 2026-10-29：独立验收发现首版字段清理断言仅覆盖 scope stale cleanup；预存第一条 incoming 及其字段值，补同内容跨 scope 字段对照，并以 Fake/SQLite cleanup mutations 杀死已识别变异。

- 2026-10-29 10:03 SGT：记录修复后的独立复评与稳定提交完整原命令验证，纠正较早 pnpm 运行的 head 归属，归档并保留最终远端门禁。

- 2026-10-29：交付评审后修正端口 scope 说明，补充本次明确授权及独立复评证据；计划继续保持 Completed。
