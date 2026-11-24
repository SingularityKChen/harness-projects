# 本地 Git provider 边界测试钉住（#174）ExecPlan

> 状态：Completed（2026-11-24 Batch 2 实现与本地验收完成；同日独立 agent 对抗验收无 P0/P1，P2-1 提交信息已 amend、P3 逐条处置，记录见 `docs/review/pr-674-mmp-review.md`；push 后由评审方回读 V7；`Refs #174` 保持 OPEN，关闭由 PR body 的 `Closes` 承担）
> 创建：2026-11-24
> 范围：issue #174 —— 为 Local Git provider 两个已修复但无断言的行为补两条判别性集成用例，并收紧 `tests/integration/README.md` 两处措辞；不改产品代码。
> 工作树/分支：`.worktrees/iteration12-local-git-boundary-tests`，分支 `test/local-git-boundary-tests-20261124`，base `main` @ `c24d1491`（写作时观察值；以 `git merge-base origin/main HEAD` 回读为准）。
> 上游输入：issue #174 正文与验收标准（两个必须交付的判别性证据）；本计划自包含，不依赖仓库外文档或运行态记录。

## Purpose / Big Picture

issue #174 的两个行为由 PR #160 实现，但因代码预算耗尽没有测试：`listBranches` 对 `limit < 1` 的夹取，以及 `deepestExisting` 只把 `ENOENT`/`ENOTDIR` 当作"不存在"。完成后，这两个行为各有一个具名集成用例拥有：

- 删除夹取 → 分页游标原地踏步，用例在"每页至少一条"或"严格前进"断言处失败，而不是让调用方或测试挂住；
- 吞掉全部 `stat` 错误 → 不可访问路径在预检阶段被报成可创建，用例在 `reason: 'unresolvable'` / `invalid_input` 断言处失败；
- `canonicalize` 重抛裸错误 → 用例因裸 `EACCES` 失败，而不是结构化拒绝。

最小成功证据：V1 `ℹ tests 96 / pass 96 / fail 0 / skipped 0 / todo 0`；V2 变异 spec 的 M1–M3 全部 KILLED；V3–V6 通过；V7 回读 PR 关闭 #174。全部验证命令只在 Validation and Acceptance 定义。

## Context and Orientation

- **端口义务**：`packages/capabilities/src/development-provider.ts:18-20` 要求列表方法从 `cursor: undefined` 逐页读到 `nextCursor === undefined`，无并发写入时恰好枚举每个对象一次；`ProviderListBranchesInput.limit` 只是 `number`（:84），没有 `≥ 1` 前置条件，也没有定义 `≤ 0` 语义。
- **现状实现**：`packages/providers/development-local-git/src/provider.ts:167-180` 的 `next = start + Math.max(1, input.limit)`（:178）是 `limit < 1` 仍能终止的唯一原因；去掉夹取后 `limit: 0` 返回空页且 `nextCursor === "0"`，按游标遍历永不结束。core 的 `PROBE_MAX_PAGES = 1000`（`packages/core/src/git-provisioning.ts:344-371`）只是外圈兜底，系统症状是分支探测停在 `unknown`。
- **路径分类**：`packages/providers/development-local-git/src/paths.ts:77-91` 的 `deepestExisting` 只吞 `ENOENT`/`ENOTDIR`（:85），其余 `stat` 失败上抛；`canonicalize`（:113-123）把异常折成 `undefined`，`resolveWorktreePath` 再转成 `reason: 'unresolvable'`（:150）；`preflightWorktree`（`provider.ts:242-248`）在 `resolveTarget`（:587-595）失败时答 `invalid_input` 且不触达 Git。
- **现有缺口**：`tests/integration/development-local-git.test.js:86-99` 只间接覆盖长分隔符；`:867-889`（base 行号）的 chmod 000 用例在"吞掉全部 stat 错误"的变异下仍绿——其拒绝由 `provider.ts:38-45` 的 REFUSALS 匹配 git stderr 产生，不证明 `deepestExisting` 分类。契约套件分页用例只走正 `pageSize`（`tests/contract/suites/development.js:272-302`）。`tests/integration/README.md:98,108` 因此写成了比断言更强的话。
- **文件与计数**：目标文件 `tests/integration/development-local-git.test.js` 当前 1087 行、38 个顶层 `test()`；`node:test` 把 Development 契约套件的子测试计入，基线为 94 tests（见 S1），新增两条后为 96。
- **范围**：只改测试与测试文档；产品行为、端口契约、依赖方向、Windows lane 均不变。

## Design / Spec

### 选择

采用最小方案 A：只加两个集成用例 + 收紧 `tests/integration/README.md` 两处；不改产品代码、不提升为跨 provider 契约、不新增 fs 注入缝。理由：issue 验收句点名 `development-local-git.test.js`；GitHub provider 对 `limit < 1` 答 `invalid_input`（`packages/providers/development-github/src/provider.ts:64-66`），契约套件无法同时钉两种语义；注入缝会把"真实 stat 失败被吞"的回归形态移出观察面。被否决的方案 B（扩展 Development 契约套件）与 C（在 `paths.ts` 加可注入 stat/fault seam）的边界见 Decision Log D1。行为已存在，因此本任务的 TDD 形态是"特征化绿 + 变异必红"，不伪造实现前 RED。

### 用例 1 · 分页下界

- 位置：`tests/integration/development-local-git.test.js:293` 之后（"分支身份：pack-refs…"与"写后回读…"之间）。用例名：`分支列表：limit 为 0 或负数时游标严格前进，遍历有界终止且恰好枚举每个分支一次`。
- 夹具：`fixtureFor(t)` + `fixture.run(['branch', 'feature/bound-a', 'main'])`（同 b、c）；`providerFor(fixture)`。
- 断言（全部为性质，不钉"每页恰 1 条"）：① 一次 `limit: 1000` 的大页得到 `nextCursor === undefined` 与分支名全集 `names`，且 `names.length > 1`；② 对 `limit ∈ [0, -1]` 做游标遍历，页数上界 `names.length + 2`（超界即断言失败，避免挂住）：每页 `ok === true`；`items.length >= 1`（失败消息点名"空页会让游标原地踏步"）；`items.length <= Math.max(1, limit)`；`nextCursor` 存在时必须 `Number(nextCursor) > 本页起点 offset`；③ 页内与跨页无重复，排序后的 `seen` 等于排序后的 `names`，`new Set(seen).size === seen.length`；④ 遍历在页数上界内自然结束于 `nextCursor === undefined`。
- 判别力：去掉 `Math.max(1, …)` 后 `limit: 0` 第一页为空，断言 ② 立即失败；即使删掉"非空"断言，严格前进与页数上界也会在有界页数内失败，而不是 120s 超时。

### 用例 2 · stat 错误分类

- 位置：`tests/integration/development-local-git.test.js:156` 之后（"路径安全：已存在的目标祖先是符号链接…"与"读取默认分支…"之间）。用例名：`路径安全：非 ENOENT/ENOTDIR 的 stat 失败判为不可规范化，预检结构化拒绝而不是当作可创建路径（零次 Git 调用）`。
- 平台守卫：用例首行若 `typeof process.getuid === 'function' && process.getuid() === 0`，`t.skip('root 下 chmod 0 不构成访问屏障')` 后 `return`；CI Verify 是 ubuntu-latest 非 root，本文件不在 Windows lane（`docs/development/ci.md:50`），因此不新增 win32 门。
- 夹具与步骤：`fixtureFor(t)`；`blocked = path.join(fixture.root, 'blocked')`，`mkdir` 后先做正控：`preflightWorktree({ repository: repositoryRef, worktreeKey: 'wt-ok', branch: 'main' })` 必须 `ok === true`；再 `chmod(blocked, 0o000)`，在 `try/finally` 内执行断言，`finally` 恢复 `0o755`。
- 断言：① `resolveWorktreePath(path.join(blocked, 'nested', 'wt'), { repositoryPath: fixture.repositoryPath, allowedRoot: fixture.root })` 为 `{ ok: false, reason: 'unresolvable' }`（不钉 message 文案）；② 用 `recordingRunner()` 构造 provider 调 `preflightWorktree({ repository: repositoryRef, worktreeKey: 'wt', path: path.join(blocked, 'nested', 'wt'), branch: 'main' })`：`ok === false`、`error.code === 'invalid_input'`、`error.retryable === false`；③ `recorder.calls` 为空（拒绝发生在任何 Git argv 之前）。
- 为什么是 `blocked/nested/wt`：`canonicalize` 对 `path.dirname(raw)` 调 `deepestExisting`；直接子项 `blocked/wt` 会让创建路径的 Git 兜底参与，失去对 paths 分类的判别力。

### 不变量与风险

- I1：产品代码、公共类型、能力键、依赖、配置、锁文件、生成物零改动；`packages/**` 不在本 PR diff 中。
- I2：既有 94 条用例不减弱、不删除；新增两条在未变异树上绿。
- I3：两条用例各自在对应变异下必红（M1 只杀用例 1，M2/M3 只杀用例 2，互不替代）；M2 下既有 `:867-889` 仍绿是"旧断言无判别力"的证据，不是冲突。 **Superseded by S8/S10 与本轮 MMP 复审（2026-11-24）**：M1 仅使命名分页用例失败；M2/M3 同时使命名 stat 用例与既有长分隔符用例失败。判别要求是失败名单包含对应 `killedBy`，不要求其他用例保持绿。
- I4：README 每条新表述都由同 PR 的断言支撑；不把"Git stderr 拒绝"写成"路径分类"。
- R1：用例 2 依赖 POSIX DAC 语义（非 root、标准临时文件系统）；若某环境对 `chmod 000` 子路径返回其他非 ENOENT/ENOTDIR 错误码，语义仍成立，若返回 `ENOTDIR` 则用例红并暴露假设错误。R2：当前 Verify 为 `ubuntu-latest` 非 root、本文件不在 Windows lane（`docs/development/ci.md`），故用例 2 在 CI 真实执行；若未来集成 lane 以 root/容器身份运行，用例 2 会显式 skip（理由可见），而 `scripts/run-test-layer.mjs` 只拒绝零执行/全 skip，需在该 lane 补本文件 `skipped===0` 门禁；本 PR 不加注入缝（P3-1）。R3："页大小 ≤ `max(1, limit)`"会随未来"默认页大小"改动变红，这是 Lead 决策要求的性质。
- 非目标：不决定端口级 `limit` 语义（是否声明 `limit ≥ 1`，或 `limit ≤ 0` 表示遍历结束）——这是产品契约裁决，另立 issue 的提议也不在本 PR 新建；不测 NaN/Infinity/非整数/中途改 limit；不测 ELOOP/NUL/EPERM；不扩展契约套件或 Windows lane；不做 core 1000 页路径测试；不新增兼容/迁移。

### 变异锚点与 spec

RED 只能用源码变异重建：两个行为已在 base 修复（见 S2）。变异只临时存在，由 `scripts/review-mutate.mjs` 按原文字节施加、还原并复跑基线，任何情况下不进入提交。

| ID | 锚点（文件:行） | 变异 | 期望被杀用例（`killedBy` 片段） |
|---|---|---|---|
| M1 | `packages/providers/development-local-git/src/provider.ts:178` | `const next = start + Math.max(1, input.limit)` → `const next = start + input.limit` | 用例 1，`分支列表：limit 为 0 或负数` |
| M2 | `packages/providers/development-local-git/src/paths.ts:85` | `if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error` → `if (code === '__never_matches__') throw error`（吞掉全部 code） | 用例 2，`路径安全：非 ENOENT/ENOTDIR` |
| M3 | `packages/providers/development-local-git/src/paths.ts:120-122` | `canonicalize` 的 `catch { return undefined }` → `catch (error) { throw error }` | 用例 2，`路径安全：非 ENOENT/ENOTDIR` |

spec 写入检出根 `.superpowers/iteration12/174/review-mutate.json`（`.superpowers/` 被 `.gitignore:18` 忽略，不入库、不进入 diff）：

~~~json
{
  "command": ["node", "--test", "--test-timeout=120000", "tests/integration/development-local-git.test.js"],
  "mutants": [
    { "id": "M1", "file": "packages/providers/development-local-git/src/provider.ts", "anchor": "const next = start + Math.max(1, input.limit)", "replacement": "const next = start + input.limit", "killedBy": "分支列表：limit 为 0 或负数" },
    { "id": "M2", "file": "packages/providers/development-local-git/src/paths.ts", "anchor": "      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error\n", "replacement": "      if (code === '__never_matches__') throw error\n", "killedBy": "路径安全：非 ENOENT/ENOTDIR" },
    { "id": "M3", "file": "packages/providers/development-local-git/src/paths.ts", "anchor": "    return { path: real ?? joined, ancestor, complete: real !== undefined }\n  } catch {\n    return undefined\n  }", "replacement": "    return { path: real ?? joined, ancestor, complete: real !== undefined }\n  } catch (error) {\n    throw error\n  }", "killedBy": "路径安全：非 ENOENT/ENOTDIR" }
  ]
}
~~~

三个锚点在 `c24d1491` 上各自恰好出现一次（设计期核对）；`review-mutate` 会在施加前再校验，出现 `NOT_APPLIED` 时结论不可用。期望输出：每条 `M# [env=inherit] RED exit=1 failing=["…"]`，最后 `SUMMARY [{"id":"M1","status":"KILLED"},{"id":"M2","status":"KILLED"},{"id":"M3","status":"KILLED"}]`，exit 0；还原后基线复跑绿。

### 测试文档收紧

只改 `tests/integration/README.md` 两处，不新增按 issue 的行：

- `:98` 末句改为："分支列表按 `pageSize` 逐页读完恰好枚举每个分支一次（分页契约，core 的分支探测依赖它）；本地 Git 自身用例另钉 `limit` 为 0 / 负数按 1 计时的每页非空、游标严格前进与有界终止。"
- `:108` 改为："| 拒绝分类 | 占用路径、被别处检出的分支（前置判定必须自己点名原因）、不可访问（mode 000）目标都结构化拒绝，不伪造成功；非 `ENOENT` / `ENOTDIR` 的 `stat` 失败在预检阶段由路径层分类为 `unresolvable` 并答 `invalid_input`，不依赖 Git stderr 文案 |"

### PR 交付边界

本 PR 为 test-only、基于 `main` 的单 PR（无 stacked）：关闭语义由 PR body 的 `Closes #174` 承担，body 必须引用本 ExecPlan 与 Batch 1/2、V1/V2 的逐字真实输出、风险与回滚；不改 Project `Status` / `blocked-by` / `blocking`，不自行合并。Batch 1 是"ExecPlan 入库 + `docs/README.md` Active 索引行 + draft PR"；实现从 Batch 2 起。

## Global Constraints

- 全任务文件集合（只在此声明一次；本 PR 的 tracked diff 不得出现以下 6 个路径之外的路径；前四个为 Batch 1/2 声明，后两个为 2026-11-24 验收处置按 D11 新增）：
  - `tests/integration/development-local-git.test.js`
  - `tests/integration/README.md`
  - `docs/exec-plan/active/2026-11-24-local-git-provider-boundary-tests.md`（本计划，Batch 1 入库；Batch 2 验收通过后按 `PLANS.md` §2 同名移入 `docs/exec-plan/completed/`）
  - `docs/README.md`（Batch 1 在 Active 表加一行；归档时该行移到 Completed 表）
  - `docs/review/pr-674-mmp-review.md`（验收处置新增：独立对抗验收的处置与证据记录）
  - `docs/review/README.md`（验收处置新增：评审记录索引行，按该文件 §8 近几轮单 PR 记录的实际惯例登记）
- 禁止改动：`packages/**`、`apps/**`、`scripts/**`、`.github/**`、根 `package.json`、`pnpm-lock.yaml`；不新增测试夹具、导出、注入缝、依赖、配置或迁移；不修改既有 94 条用例的断言（只允许新增两条用例、README 两处措辞与验收处置的注释补充；注释补充不改断言、不改变行为）。
- 体量：技术新增+删除约 60–75 行（含验收处置的 4 行注释；上限 800，仓库硬上限 1000）；文档新增+删除约 210–420 行（本计划、两处 README、`docs/README.md`、验收记录与索引；上限 1300，硬上限 1500）。最终实测值见 Outcomes。超预算时先压缩解释性文字，不删断言或证据。
- 语言与提交：正文中文；代码标识符、路径、命令英文；提交 `<type>(<scope>): <中文摘要>`，正文说明为什么，末尾 `Refs #174`；分支 `test/local-git-boundary-tests-20261124`，不 push `main`、不自行合并。
- 证据：所有命令在 `.worktrees/iteration12-local-git-boundary-tests` 工作树根目录、检出 `test/local-git-boundary-tests-20261124` 上执行；易失值（head、计数、checks）写成回读命令 + 期望，不写成永久事实；不写本机绝对路径。
- TDD：先有能红的断言；RED 只能由 M1–M3 变异证明；变异不入提交，最终 `git diff --name-only` 无 `packages/**`。
- PR 元数据：title 镜像 issue 英文标题；labels `kind:test`、`area:providers`、`area:tests`；milestone 与 issue 相同；assignee `SingularityKChen`；不加入 Project 看板条目（按 Lead 本轮决策）。

## Plan of Work

### Batch 1 · ExecPlan 入库与索引（draft PR 前置）

**最小闭环**：仓库里有可审阅的 ExecPlan 与 Active 索引行，draft PR 已关联 #174；此阶段不做任何测试或产品改动。
**涉及文件**：本计划、`docs/README.md`。

步骤：
1. 把本计划落入 `docs/exec-plan/active/2026-11-24-local-git-provider-boundary-tests.md`；在 `docs/README.md` §2 的 Active 表加一行，用途写「Local Git provider 分页下界与 stat 错误分类的判别性测试（#174；test-only）」。
2. 提交文档（`Refs #174`），push 分支，创建 draft PR；PR body 写入闭环、ExecPlan + Batch 引用、`Closes #174` 与 base `main`；真实验证证据在 Batch 2 完成后回填，不用预期代替证据。
3. 运行 V4、V5；用 V6 核对本批 diff 仅为计划与 `docs/README.md` 两个路径；运行 V7 回读 PR（Batch 1 阶段期望 `isDraft=true`）。
**验证**：V4（exit 0）、V5（无输出）、V6（本批两个路径）、V7（base/关联/draft 如期望）。
**回滚**：`git revert` 本批文档提交；draft PR 关闭或保留为新的 head 依据；无代码牵连。

### Batch 2 · 两个判别性测试与测试文档收紧

**最小闭环**：两个具名用例在未变异树上绿，并在 M1–M3 下分别被杀；`tests/integration/README.md` 两处与新断言一致；全文件 96/96。
**涉及文件**：`tests/integration/development-local-git.test.js`、`tests/integration/README.md`。

步骤：
1. 按 Design / Spec 新增用例 1、用例 2（位置、名字、夹具、断言、root 守卫、`finally` 恢复 chmod 均照写）。先跑 V1 记录未变异基线的绿（期望 96/96）；这是特征化，不把"绿"当作判别力。
2. 写 V2 的 spec 到 `.superpowers/iteration12/174/review-mutate.json`（内容见 Design / Spec），运行 V2：先确认脚本输出的基线绿，再确认 M1–M3 全部 `RED` 且 `failing` 名称含各自 `killedBy`，最后一行 `SUMMARY` 三个 `KILLED`，exit 0。若出现 `SURVIVED` / `KILLED_OTHER` / `NOT_APPLIED`，停止并修正断言或变异，不弱化断言、不改产品代码。
3. 移除变异：V2 脚本按原文字节还原并复跑基线；用 `git status --short` 确认工作树无 `packages/**` 改动；提交后再用 V6 复核最终文件集合；再跑 V1 确认 96/96。
4. 改 `tests/integration/README.md` 两处（精确文本见 Design / Spec）；不改既有 `:867-889` 用例及其注释。
5. 把 V1 计数、V2 的逐字输出、V3 行数写进 Progress / Surprises；提交测试与文档（`Refs #174`）；提交后运行 V1–V6 全套。
6. 按 `PLANS.md` §2 归档：把本计划同名移入 `docs/exec-plan/completed/`，`docs/README.md` 的索引行从 Active 移到 Completed（文件名不变，不新增文件）；整理提交（无 debug/fixup），push 后回读 V7；最终 head 的 V1–V6 与 checks 全通过后执行 `gh pr ready`，请求人类评审，不合并。
**验证**：V1（96/96）、V2（全部 KILLED）、V3、V4、V5、V6；V7 在最终 push 后复跑。
**回滚**：`git revert` Batch 2 提交（测试 + README + 归档）；产品树零改动，回滚后基线 94/94；变异由脚本自动还原，不得用 `git checkout` 丢弃未提交实现。

## Validation and Acceptance

以下命令都在检出 `test/local-git-boundary-tests-20261124` 的工作树 `.worktrees/iteration12-local-git-boundary-tests` 根目录执行；base 为 `origin/main`（写作时 `c24d1491`，以 `git merge-base origin/main HEAD` 回读）。命令只在此处定义，批次按 ID 引用。

| ID | 命令 | 期望输出 |
|---|---|---|
| V1 | `pnpm test:file tests/integration/development-local-git.test.js` | exit 0；`ℹ tests 96`、`ℹ pass 96`、`ℹ fail 0`、`ℹ skipped 0`、`ℹ todo 0`；基线 94（S1），新增 2 条 |
| V2 | `node scripts/review-mutate.mjs .superpowers/iteration12/174/review-mutate.json` | 基线先/后均绿；M1/M2/M3 各 `RED exit=1` 且 `failing` 含对应 `killedBy`；`SUMMARY` 三项全 `KILLED`；exit 0 |
| V3 | `node scripts/rule-checks.mjs size origin/main` | exit 0；`代码：N / 1000 行（增删之和）` 且 N ≤ 800（预计约 60–75）；`文档：M / 1500 行（增删之和）` 且 M ≤ 1300（预计约 210–420）；最终实测见 Outcomes |
| V4 | `node scripts/rule-checks.mjs disclosure origin/main` | exit 0，输出「机械扫描通过」；再按 `docs/development/publication.md` 人工五类目检查 |
| V5 | `git diff --check origin/main...HEAD` | 无输出，exit 0 |
| V6 | `git diff --name-only origin/main...HEAD` | 恰为 Global Constraints 声明的路径（Batch 1/2 四个，加验收处置的 `docs/review/pr-674-mmp-review.md` 与 `docs/review/README.md`；计划文件在归档前后分别为 `active/` 或 `completed/` 同名路径）；无 `packages/**`、`apps/**`、`scripts/**`、`.github/**`、锁文件 |
| V7 | `gh pr view --repo SingularityKChen/harness-projects --json number,isDraft,baseRefName,headRefOid,closingIssuesReferences,statusCheckRollup` | `baseRefName="main"`；`closingIssuesReferences` 含 `#174`；`headRefOid` 等于 `git rev-parse HEAD`；Batch 1 阶段 `isDraft=true`，ready 后 `isDraft=false` 且 checks 全部 success |

V2 的 spec `command` 直接用 `node --test`（即 `pnpm test:file` 的内层命令；该测试文件首行 import 了 `resolution-preflight.mjs`），因此与 V1 落入同一执行路径。

验收判定：V1 是唯一行为证据；V2 是"测试能失败"的唯一证据；V3–V6 是体量/发布面/文件集合证据；V7 是 PR 关联与当前 head 的回读。Batch 1 只运行 V4–V7 的文档与 PR 部分；Batch 2 运行 V1–V7 全套。测试通过不等于产品发布闭环（未发布产品，本 PR 不承诺产品行为变化）。

## Progress

- [x] 设计收敛与计划起草（2026-11-24，收敛评审 r-174）：比较两份独立设计，按 Lead 决策收敛为最小方案 A；在 `c24d1491` 上只读复核基线 94/94、源码行号、变异锚点唯一性与行为探针（S1–S4）。
- [x] Batch 1 · ExecPlan 入库与 Active 索引 + draft PR（2026-11-24；文档提交 `19ab0e88`，draft PR #674，`baseRefName=main`、`closingIssuesReferences` 含 #174、`isDraft=true` 回读均符合期望）。
- [x] Batch 2 · 两个判别性测试 + README 两处收紧 + 变异 RED/GREEN + 最终门禁（2026-11-24；V1 96/96、V2 M1–M3 全 KILLED、README 两处收紧、本地 V3–V6 通过；计划已归档，V7 的最终 head 回读见 D10）。
- [x] 验收处置 · verification-1 逐条处理（2026-11-24，a-174）：P2-1 仅 amend 实现提交 message（tree `fdf7353d…` 不变，amend 后 head `ae7e1fe3…`）；P3-1/P3-2/P3-3 以测试注释与计划记录处置，P3-4 书面化；新增 `docs/review/pr-674-mmp-review.md` 与索引行（D11）；处置提交后再跑 V1 96/96、V2 M1–M3 全 KILLED、V3–V6 与 `typecheck`/`boundaries`（见 Outcomes）。

## Surprises & Discoveries

本节 S1–S6 为**设计期只读证据**（2026-11-24，设计者在 `main@c24d1491` 的仓库外临时副本与本机非 root 环境调查；本轮收敛评审在同一 base 上只读复核 S1/S3/S4）；实现期新发现追加在本节并注明日期。

- **S1 基线计数**：在检出 `test/local-git-boundary-tests-20261124` 的工作树（HEAD=`origin/main`=`c24d1491`）运行 `pnpm test:file tests/integration/development-local-git.test.js`：`ℹ tests 94 / pass 94 / fail 0 / skipped 0 / todo 0`，约 8.1s。文件 1087 行、38 个顶层 `test()`；94 是 `node:test` 计入契约套件子测试后的总数，加两条新用例后预期 96。
- **S2 为什么不能自然 RED**：两个行为已在 base 修复；`provider.ts`/`paths.ts` 在 `7fe109a8` 作为新文件落地（`git log -S'Math.max(1'` 只命中它），#160 的中间 head 从未进 `main`。因此"对 pre-fix 实现红"只能用源码变异重建（M1–M3）。
- **S3 分页现状**：base 上 `limit: 0`/`-1` 返回 1 条（`feature/a` 一类）与 `nextCursor "1"`；去掉夹取后返回空页与 `nextCursor "0"`，按游标遍历不终止（设计期副本实测）。故用例 1 必须有"每页至少一条 + 严格前进 + 页数上界"，只比较最终集合会在死循环里挂住。
- **S4 路径现状**：base 上 `chmod 000` 的 `blocked/nested/wt` 经 `resolveWorktreePath` 得 `{ ok:false, reason:'unresolvable' }`；`preflightWorktree` 得 `ok:false, code:'invalid_input', retryable:false, recorder.calls=0`（本轮只读探针复核）。把 `deepestExisting` 改成吞掉全部 code 后，同一预检返回 `ok:true`（设计期副本实测）；既有 `:867-889` 用例在该变异下仍绿，因为它的拒绝来自 REFUSALS 匹配 git stderr。
- **S5 README 过度声称**：`:98` 只写正 `pageSize` 的分页；`:108` 的"不可访问目标结构化拒绝"由 `createWorktree` 的 Git stderr 路径提供，不能证明 paths 分类——这正是要收紧的两处。
- **S6 目标形状与平台**：必须用 `blocked/nested/wt`（`canonicalize` 对 dirname 调 `deepestExisting`）；`blocked/wt` 会让 Git 兜底参与，失去判别力。root 下 chmod 0 不构成屏障，故内联 `t.skip`；CI Verify 是 ubuntu-latest 非 root，本文件被 `docs/development/ci.md:50` 排除在 Windows lane 外，不新增 win32 门。
- **S7 实现期基线未漂移（2026-11-24）**：在检出 `test/local-git-boundary-tests-20261124` 的工作树 HEAD=`19ab0e88` 上跑 V1：新增用例前 `tests 94 / pass 94`（与 S1 一致），新增两条后 `tests 96 / pass 96 / fail 0 / cancelled 0 / skipped 0 / todo 0`，约 6.4s。
- **S8 实现期变异归因（2026-11-24）**：V2 的 `failing` 中，M1 只列新用例 1；M2、M3 除新用例 2 外还列既有「路径安全：长分隔符输入有界返回结构化拒绝…」用例——两者共用 `resolveWorktreePath`，该用例对 paths 层变异也有部分敏感性，但它不钉 `stat` 错误分类，故新用例仍是 M2/M3 的具名所有者；三个 `killedBy` 均命中，归因不受影响。
- **S9 实现期平台假设成立（2026-11-24）**：本机以非 root 运行，`chmod 000` 的 `blocked/nested/wt` 预检按 R1 预期被拒；新用例的正控预检成功、`recorder.calls` 为空，V1 的 `skipped 0` 说明 root 守卫未触发（CI Verify 为非 root 的环境假设不变）。
- **S10 验收期 M2/M3 归因机制（2026-11-24，a-174）**：独立验收（verification-1 §3）用探针确认 M2/M3 同时杀死既有长分隔符用例不是巧合——正常树 `stat` 抛 `ENAMETOOLONG`，`deepestExisting` 上抛、`canonicalize` 折成 `undefined` → `unresolvable`；M2 吞掉全部 code 后同一路径变成 `outside_root`（既有用例 `deepEqual` 失败），M3 让裸 `ENAMETOOLONG` 抛穿子进程（既有用例 `status===0` 失败）。两者共用 `resolveWorktreePath`，属真实共享敏感性，但既有用例不钉 `stat` 错误分类，故新用例仍是具名所有者。实现提交原 message 的「既有用例都观察不到」是过度声称（P2-1），已 amend 为「有部分敏感性但不钉分类」；该提交未 push，只改 message，tree `fdf7353d…` 不变。S8 的「部分敏感性」表述由此补上机制。
- **S11 验收处置的证据边界（2026-11-24，a-174）**：本 PR 是 test-only，仍只跑 V1/V2 + 体量/发布面/文件集合检查，并按验收要求补 `typecheck`/`boundaries`；未跑完整 `pnpm verify`/E2E/Windows lane、未做 V7（不得 push）。V2 的 spec 全文内联在「变异锚点与 spec」，运行态 `.superpowers/iteration12/174/review-mutate.json` 不入库，复现以本计划内联文本为准。P3-2/P3-3 的游标编码与 `limit<=0` 语义耦合留在测试注释与本记录，不新增断言或门禁脚本。

## Decision Log

| 编号 | 决策 | Rationale | 日期 / 来源 |
|---|---|---|---|
| D1 | 采用最小方案 A：只加两个集成用例 + README 两处收紧；不提升契约、不加注入缝、不改产品代码 | issue 验收句点名该文件；GitHub provider 对 `limit<1` 答 `invalid_input`，契约无法同时钉两种语义；注入缝会把真实 stat 失败的回归形态移出观察面 | 2026-11-24，Lead 决策 |
| D2 | 用例 1 钉性质集合：每页非空、页大小 ≤ `max(1, limit)`、`nextCursor` 严格前进、有界终止、恰好枚举一次；不钉"每页恰 1 条" | 保留默认页大小等合法演进空间，同时让去掉夹取必红。系统设计曾建议不钉页大小上限，属判断差异、无实测反例；按 Lead 决策执行并在本行留痕 | 2026-11-24，Lead 决策 + 收敛评审 |
| D3 | 用例 2 用真实 `chmod 000` + `preflightWorktree` + `blocked/nested/wt`；断言 paths 层 `reason='unresolvable'`、provider 层 `invalid_input`/`retryable=false`、零 Git 调用；不钉文案；root skip；不加 win32 门 | 预检是"任何 Git 命令之前"的观察点；`createWorktree` 在吞错变异下仍会被 Git stderr 兜成 `invalid_input`（无判别力）。正控预检成功排除"预检本身失败"的假红 | 2026-11-24，Lead 决策 + 两设计一致 |
| D4 | 不改既有 `:867-889` 用例（含注释）；README 只收紧 `:98`/`:108`；系统设计建议的 `:883` 注释改动不纳入 | Lead 范围为"2 用例 + README 两处"；旧用例仍钉写面的结构化拒绝，其证据保留；README 修正足以消除过度声称，避免超出 test-only 最小闭环 | 2026-11-24，收敛评审 |
| D5 | RED 用 `scripts/review-mutate.mjs` 的 M1–M3；spec 放 `.superpowers/iteration12/174/review-mutate.json`（运行态、不入库），记录逐字输出；出现 `SURVIVED`/`KILLED_OTHER`/`NOT_APPLIED` 时停下修正，不弱化断言 | 仓库既有变异夹具可证明"变异已施加 + 失败名归因"；运行态 spec 与输出按 `AGENTS.md` §3 不进入文档树 | 2026-11-24，收敛评审 |
| D6 | Batch 1 与 Batch 2 不合并 | Batch 1 是纯文档 + draft PR 前置（回滚只涉及文档），Batch 2 是行为证据 + 变异门（回滚涉及测试）；合并会失去"先 draft PR 后实现"的门与独立回滚点 | 2026-11-24，收敛评审 |
| D7 | 非目标：端口级 `limit` 语义（是否声明 `limit ≥ 1` / `limit ≤ 0` 为遍历结束）不本 issue 决定，不新建 issue | 这是产品契约裁决，会同时影响 fake/GitHub 等 adapter；`docs/review/README.md` §6 也要求规则类变更单独评审 | 2026-11-24，Lead 决策 + 收敛评审 |
| D8 | PR 关闭 #174（`Closes`），body 引用本 ExecPlan 与 Batch 1/2、真实 V1/V2 输出、风险与回滚；不写 Project `Status`/blocked-by，不自行合并；ready 仅在最终 head 回读通过后 | AGENTS §8/§6 与 Lead 交付流程；规划状态由人类决定 | 2026-11-24，Lead 决策 |
| D9 | Batch 2 验收通过后按 `PLANS.md` §2 归档到 `completed/` 并移动索引行；文件名不变 | 计划生命周期；文件集合不新增路径 | 2026-11-24，收敛评审 |
| D10 | Batch 2 以一个提交收敛「测试 + README 两处收紧 + 计划归档 + 索引移动」，本地门禁跑到 V6；V7 的最终 head 回读与 `gh pr ready` 由评审方在 push 后执行 | 本轮委派边界禁止 push 与 PR 写操作；Plan step 5/6 的「整理提交」允许同批内容收敛为一个可审阅提交；V7 的语义是回读远端 head，push 前没有可读对象 | 2026-11-24，Batch 2 执行 |
| D11 | 验收处置新增 `docs/review/pr-674-mmp-review.md` 与 `docs/review/README.md` 索引行，文件集合由 4 扩为 6；计划不因归档移动索引行 | 独立对抗验收的结论（P0–P3、处置与残余风险）需要长期可查，符合 `docs/review/README.md` §8 近几轮单 PR MMP 记录的实际惯例（#659–#673 均登记）；任务要求把验收处置写成评审记录并同步计划文件集 | 2026-11-24，Lead 委派 + a-174 |
| D12 | P2-1 只 amend 实现提交 `8bef8e4` 的提交信息，不改内容、不 rebase 已推送的 Batch 1 文档提交 | 该提交未 push（远端只有 `19ab0e88`），message 是可修正的发布面；原 message 与 V2 证据矛盾（S10），而定稿证据（tree）无需改动；不触碰已推送历史，避免无必要的 force-with-lease | 2026-11-24，verification-1 P2-1 + a-174 |
| D13 | P3-1 以用例注释提醒「非 Windows lane / Verify 非 root、未来 root lane 需补 `skipped===0` 门禁」；P3-2/P3-3 不修改断言，只在用例注释说明数值游标依赖与 `limit<=0` 语义待裁决；P3-4 不修，按 D3/D5 预授权在评审记录写明证据边界 | P3-1 加门禁会扩到 `scripts/**`，超出 test-only 范围；P3-2/P3-3 的替代做法（删严格前进、改写非空断言）会弱化对新回归形态的判别力，属于任务禁止的「弱化断言」；P3-4 的可达历史中不存在 pre-fix 实现（S2），注入缝按 D3 拒绝 | 2026-11-24，verification-1 P3 + a-174 |

## Idempotence and Recovery

- V1、V3–V6 幂等；V2 先跑基线、再逐个施加/还原并复跑基线，退出 0 才表示 M1–M3 全部准确 KILLED；不得用 `git checkout` 或手写回填绕过脚本。
- 每个测试用 `fixtureFor(t)` 的独立临时仓库；`chmod 000` 的恢复在 `finally`，断言失败也不会留下不可访问目录。
- 某条用例在**未变异**树上变红时：停止，不修改产品代码；对照 S1–S4 判断是断言/夹具问题还是基线漂移，记录后按需修正测试。
- 批次失败：`git status --short` + `git diff` 定位；已提交批次 `git revert <commit>`；Batch 1/2 可独立回滚。变异若未还原，V2 脚本会在结束/中断时恢复原字节并复跑基线。
- 分支已 push 需改写时，先建 backup ref，再按 `git-expert-operations` 做精确 `force-with-lease`；本任务预计不需要。
- 不删除工作树、不重置其它分支、不写数据库或外部系统；回滚纯 Git 提交。

## Interfaces and Dependencies

- 运行时：Node.js（本机观察 v26.13.1）、pnpm scripts（`test:file`）、git CLI、`node:test`、`node:assert/strict`；不触网、不需要凭据。
- 既有工具：`scripts/review-mutate.mjs`（变异夹具，原文字节还原、`killedBy` 归因、基线前后校验）；`.superpowers/` 被 `.gitignore:18` 忽略。
- 公共接口不变：`DevelopmentProvider.listBranches`、`ProviderListBranchesInput { repository, cursor, limit: number }`、`ProviderPage { items, nextCursor }`、`preflightWorktree`、`ProviderError.code/retryable` 全部保持原语义；`packages/**` 零 diff。
- CI：不改 workflow、检查名或分支保护；`PR Fast Gate` 仍为唯一必需检查；`tests/integration/development-local-git.test.js` 不被 `scripts/windows-native-checks.mjs` 的 SETS 包含（`docs/development/ci.md:50`），Windows lane 不变。
- PR 依赖：同仓 issue #174 保持 OPEN，合并后由 `Closes #174` 关闭；PR base `main`，无 stacked 依赖。

## Outcomes & Retrospective

Batch 2 于 2026-11-24 完成（在检出 `test/local-git-boundary-tests-20261124` 的工作树根目录执行，从 HEAD=`19ab0e88` 起步）：

- V1：`pnpm test:file tests/integration/development-local-git.test.js` exit 0，`tests 96 / pass 96 / fail 0 / cancelled 0 / skipped 0 / todo 0`；未变异基线与提交后复跑一致。
- V2：`node scripts/review-mutate.mjs .superpowers/iteration12/174/review-mutate.json` exit 0，逐字输出见下（提交前后各跑一次，结论相同）：
  - `M1 [env=inherit] RED exit=1 failing=["分支列表：limit 为 0 或负数时游标严格前进，遍历有界终止且恰好枚举每个分支一次"]`
  - `M2 [env=inherit] RED exit=1 failing=["路径安全：长分隔符输入有界返回结构化拒绝，不阻塞调用进程","路径安全：非 ENOENT/ENOTDIR 的 stat 失败判为不可规范化，预检结构化拒绝而不是当作可创建路径（零次 Git 调用）"]`
  - `M3 [env=inherit] RED exit=1 failing=` 同 M2（同一份失败名单）
  - `SUMMARY [{"id":"M1","status":"KILLED"},{"id":"M2","status":"KILLED"},{"id":"M3","status":"KILLED"}]`；脚本按原文字节还原并复跑基线绿，`git diff --name-only -- packages/` 为空。
- V3：`node scripts/rule-checks.mjs size origin/main` exit 0，`代码：60 / 1000 行（增删之和）`、`文档：235 / 1500 行（增删之和）`，均在自设上限 800 / 1300 内。
- V4：`node scripts/rule-checks.mjs disclosure origin/main` exit 0，「机械扫描通过」；按 `docs/development/publication.md` 人工五类目逐条检查 diff 与提交信息，无命中。
- V5：`git diff --check origin/main...HEAD` 无输出，exit 0。
- V6：`git diff --name-only origin/main...HEAD` 恰为 `docs/README.md`、`docs/exec-plan/completed/2026-11-24-local-git-provider-boundary-tests.md`、`tests/integration/README.md`、`tests/integration/development-local-git.test.js`，无 `packages/**`、`apps/**`、`scripts/**`、`.github/**` 或锁文件。
- V7：Batch 1 只读回读 draft PR #674：`isDraft=true`、`baseRefName=main`、`closingIssuesReferences` 含 `#174`、head=`19ab0e88`。最终 head / checks / ready 需 push 后回读，见 D10。

### 验收处置轮（2026-11-24，a-174）

独立验收报告 verification-1（只读、未入库）结论：无 P0/P1、1 条 P2、4 条 P3。逐条处置：

- P2-1（提交信息过度声称）：只 amend 实现提交 message。amend 前 head `8bef8e4`、tree `fdf7353d…`，amend 后 head `ae7e1fe3…`、tree 相同；`git diff` 两提交无树差异。新 message 改为「既有长分隔符用例对 paths 层变异有部分敏感性，但它不钉 stat 错误分类」，机制归因见 S10。
- P3-1（root lane 静默空心）：不新增门禁脚本（会扩到 `scripts/**`），用例首部补平台边界注释（提交 `267b6b7`）；残余风险见下与 R2。
- P3-2（数值 offset 游标耦合）/ P3-3（`limit<=0` 语义锁）：不修断言（替代做法会弱化判别力），补用例注释说明依赖与改写要求（同一提交 `267b6b7`），理由见 D13。
- P3-4（issue 字面「注入文件系统失败 / 对 pre-fix 实现示红」）：不修，按 D3/D5 预授权在评审记录写明证据边界（S2；M1/M2 等价重建 RED；EACCES 用真实 `chmod 000` 而非注入缝）。
- 观察项 O-1..O-5：O-1（PR 面）、O-2（归档顺序）保持 D10 声明；O-3（既有用例 chmod 恢复不在 `finally`）按 D4 不改；O-4 体量以本轮实测为准；O-5 无问题。

评审记录：`docs/review/pr-674-mmp-review.md`；索引行：`docs/review/README.md`（D11）。

处置后最终 head（提交后以 `git rev-parse HEAD` 回读；下列命令在该 head 上复跑）：

- V1：exit 0，`tests 96 / pass 96 / fail 0 / cancelled 0 / skipped 0 / todo 0`。
- V2：exit 0，M1/M2/M3 全 `KILLED`（`failing` 名单与 Batch 2 一致，M2/M3 仍同时含既有长分隔符用例）；还原后基线绿、`git diff --name-only -- packages/` 为空。
- V3：`node scripts/rule-checks.mjs size origin/main` exit 0，`代码：64 / 1000 行`、`文档：351 / 1500 行`。
- V4：exit 0，「机械扫描通过」；人工五类目无命中。
- V5：`git diff --check origin/main...HEAD` 无输出，exit 0。
- V6：6 个路径——`docs/README.md`、`docs/exec-plan/completed/2026-11-24-local-git-provider-boundary-tests.md`、`docs/review/README.md`、`docs/review/pr-674-mmp-review.md`、`tests/integration/README.md`、`tests/integration/development-local-git.test.js`；无 `packages/**`、`apps/**`、`scripts/**`、`.github/**`、锁文件。
- 补充：`pnpm run typecheck` exit 0；`pnpm run boundaries` 10/10、fail 0（test-only 改动，按验收要求补跑）。
- V7 仍未执行（不得 push，D10）；最终远端 head / checks / ready 由 Lead 在 push 后回读。

证据边界：本轮证据只覆盖 V1/V2 + 体量/发布面/文件集合 + typecheck/boundaries；未跑完整 `pnpm verify`/E2E/Windows lane，工程证据不代替人类评审或 R1/UAT（S11）。行号口径：Context / Design / I3 / S4 的测试文件行号以 base `c24d1491` 为准；验收处置在用例内新增 4 行注释（不改断言）后终态文件为 1151 行，原 `:867-889` 段下移到 `:931-953`，`provider.ts` / `paths.ts` 行号不受影响。

与计划的偏差：① V7 的最终 head 与 `gh pr ready` 未在本轮执行（委派边界禁止 push 与 PR 写操作，见 D10）；② M2/M3 的失败名单同时包含既有长分隔符用例（S8），不改变 KILLED 归因；③ 验收处置新增评审记录与索引行，文件集合由 4 变为 6（D11）；④ 测试文件新增注释（P3-1/P3-2/P3-3，D13），不改断言；⑤ 其余无偏差——产品代码零改动、既有 94 条断言未修改。

遗留 / 风险：R1–R3 按计划保留（POSIX DAC 语义、root lane 会显式 skip 且 `run-test-layer` 无单条 skip 预算、页大小上界性质会随默认页大小演进变红）；P3-2 的数值 offset 游标耦合与 P3-3 的 `limit<=0` 语义锁已用用例注释记录，D7 裁决或游标编码变更时须同步改写；V7（远端 head / checks / ready）与 PR body 回填仍由 push 后执行；端口级 `limit` 语义按 D7 不在本 PR 决定。

### 本轮 PR 评审与授权收尾（2026-11-24）

首审锁定 `c46fe590e76ebdb3db1cc8ab41744a49defa4e6d` / `main@c24d1491`，96/96、零 skip，独立 M1–M6 全部 KILLED。Bot 一次 APPROVE review 提出一项 P3：I3 旧归因与实测矛盾；已在原处保留并标明 superseded，不改生产代码或测试断言。此前 V7 的“尚未 push / draft”属于实现期历史观察，本轮已回读 ready、正确关闭关联与必需 CI；最终新 head 在发布后再次回读。

用户直接要求本会话负责 #674–#677 的修复、独立复审、归档、提交整理、issue 核对、rebase 合并和清理；该授权覆盖本 PR，不授权 Planning Status 或关系修改。保留本计划 Completed；只在独立复审与最终 head 门禁通过后合入。

## Bottom Change Note

- 2026-11-24：创建。收敛两份独立设计（工程/风险视角、系统/证据视角），按 Lead 决策采用最小方案 A；记录设计期只读证据、用例设计、M1–M3 变异锚点、两批工作、V1–V7 验证与回滚路径。
- 2026-11-24（Batch 2）：按计划新增两个判别性集成用例并收紧 `tests/integration/README.md` 两处；V1 96/96、V2 M1–M3 全 KILLED、本地 V3–V6 通过；回填 Progress / Surprises（S7–S9）/ Decision Log（D10）与 Outcomes，按 `PLANS.md` §2 归档到 `completed/` 并移动 `docs/README.md` 索引行。
- 2026-11-24（验收处置，a-174）：处理独立对抗验收 verification-1；P2-1 仅 amend 实现提交信息（tree 不变），P3-1/P3-2/P3-3 以测试注释与 D13 记录处置，P3-4 书面化；新增 `docs/review/pr-674-mmp-review.md` 与索引行（D11）；处置后复跑 V1/V2 与 V3–V6、typecheck/boundaries，证据见 Outcomes。

- 2026-11-24：本轮 MMP 首审批准后按证据纠正 I3 原处归因，补充直接授权与实现期远端观察的历史边界；产品与测试字节保持不变。
