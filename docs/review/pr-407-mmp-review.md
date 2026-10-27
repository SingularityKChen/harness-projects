# PR #407 MMP 交付评审

## Purpose / Big Picture

判断“路径与远端选择 → 只读验证 → 三引用原子绑定 → 配置与激活诚实反馈”是否形成可独立验收、合并和回滚的闭环。初审建议 **APPROVE**：无确认的 P0/P1，确认一条 P2 与一条 P3；不授权合并。初审 P2 状态 Superseded by `Outcomes & Retrospective` 的“F1 修复独立复评”（2026-10-27，未提交修复）。

## Context and Orientation

2026-10-27 13:45 +08 观察；分支 `feature/repository-binding-ui`，检出 `.worktrees/repository-binding-ui`。head `8d9f8a374c4a5660a5b3714de062c16c85e70103`；base `main` @ `f6ea9713c04e2011bf2023d312c659d0be5c8b4d`。提交为 `36f766f`（计划）与 `8d9f8a3`（能力），PR 非 draft，`Closes #356`、`Refs #124`。锁定快照无 review/comments/threads，#356 评论为空。评审账号 `Singularity-AI-Bot`，开发账号 `SingularityKChen`；本分评审没有 GitHub 写入。当前远端 CI/CodeQL 与可选转发失败由协调评审方统一核对，不把本地测试当作远端事实。

依据：#356、PR 正文、`docs/exec-plan/completed/2026-10-26-repository-binding-ui.md`、`docs/product/vertical-path.md`、`docs/review/mvp-review.md`。使用 Superpowers 评审/调试/完成前验证、Qian Systems Router 的系统综合和 First Principles Development 的 audit：区分事实、约束、作者证据，优先验证“仓库行存在是否证明激活”。

## Design / Spec

矩阵在逐文件审查前预建；保留原始假设并填写最终证据，假设不等于 finding。

| 级别 | 原始检查假设 | 最终证据与结论 |
|---|---|---|
| P0 | 仓库输入能否穿越路径/信任边界或篡改规划源 | 父段/控制字符、realpath、输出根与 checkout 相交拒绝先于写；没有规划写新路径。未确认 P0。 |
| P1 | 绑定结果是否持久且 Host 重组一致；失败后是否伪 Saved | 一仓库/三引用/同实体身份；SQL 第二、三引用故障回滚，显式 activationError 保留 configured。30 项窄测通过，未确认 P1。 |
| P2 | 重复/并发绑定、无权限/取消的恢复和提示 | 双击、unknown 原键、确定失败新 attempt、生产卸载均有判别性证据。确认 F1：Local disabled 后仅因仓库行存在误显示 active。 |
| P3 | 空态、字段和文案的可理解性 | label/required、pending 禁用与 alert/status 有证据；11 种错误恢复探针通过。另确认 F2：#124 尚缺本轮验收回传。 |

不扩大到 source allowlist、immutable node id、解绑、多仓库或 Actions/Checks 独立权限探测；不把组合树的 Start Work 操作当成本 PR 精确树已完成的验收。

## Global Constraints

只读产品，不修复、不 commit/push、不提交 review。持久仓库写入仅本文件；受控变异只通过 `scripts/review-mutate.mjs` 执行并原字节还原，最终源码无工作树差异。测试与复现只写新建的临时 Git/SQLite 夹具，不接触用户仓库或真实 GitHub。

逐文件覆盖全部 18 个 diff 文件：Host 的 `client.ts`、`host-composition.ts`、`host-operations.ts`、`host-providers.ts`、`host-repository-binding.ts`；client/ui-model/ui 各自的 `repository-binding.ts` 与 `index.ts`，以及 `packages/ui/src/workspace-setup.ts`；三份 integration 与一份 contract 测试；`docs/README.md` 与完成计划。补读 Core 绑定、路由、仓库元数据与 Local Git 路径守卫，核对状态所有权和失败边界。

## Plan of Work

| 批次 | 最小闭环与主文件 | 验证及期望 | 回滚 |
|---|---|---|---|
| R1 | 锁定当前头、正文、需求与完整线程，本文件先建矩阵 | `git rev-parse HEAD` 与锁定事实一致 | 不改产品 |
| R2 | 逐文件检查 UI→client→Host→SQLite→baseline，重点为两个新增 repository-binding 模块 | 下列窄测、类型、边界通过，反例有实际输出 | 受控变异按原字节还原，夹具不复用 |
| R3 | 本文件综合 findings、非问题与验收边界，交协调者统一发布 | `git diff --check`、13 章节齐全、源码无 diff | 仅撤回记录，不操作业务数据 |

## Validation and Acceptance

以下实跑均在锁定分支/head 的工作树根；未独立重跑完整 verify、官方 Web 安装或 Desktop。PR/计划的对应安装结果是作者证据，未冒充本评审实测。

| 命令或验收 | 实际结果 |
|---|---|
| `pnpm test:file tests/contract/ui-repository-binding.test.js tests/integration/harness-plugin-repository-binding.test.js tests/integration/harness-plugin-setup-client.test.js tests/integration/harness-plugin-host-recomposition.test.js` | 30/30，fail 0，退出 0；包含真实 Git/SQLite、生产 mount、重组与失败恢复。 |
| `pnpm typecheck` | 退出 0。 |
| `pnpm run boundaries` | 9/9，fail 0，退出 0。 |
| `git diff --check f6ea9713c04e2011bf2023d312c659d0be5c8b4d...HEAD` | 退出 0。 |
| `node scripts/rule-checks.mjs size f6ea9713c04e2011bf2023d312c659d0be5c8b4d` | code 463/1000、docs 175/1500，退出 0；不包括本次未提交评审文件。 |
| `node scripts/rule-checks.mjs disclosure f6ea9713c04e2011bf2023d312c659d0be5c8b4d` | 退出 0；本次未传 PR_BODY。差异、提交及正文另人工核对五类，无新增敏感值。 |
| #356：同一选择三份配置 | builder payload 逐字断言、Host 冲突前置拒绝通过；owner 检查变异被对应用例杀死。 |
| #356：双提交一次、只读仓库 | 并发真实 Host 一仓库/三引用，Git refs/index/config/worktree 不变；读 argv 白名单通过。 |
| #356：结构化错误及恢复 | 永久组件测试覆盖 unavailable；另以生产 source/Form 静态渲染遍历 11 种 ProjectErrorCode，逐项断言 alert、预期恢复文案、无 RAW-CANARY/Saved/已连接，11/11。临时探针未提交为永久测试。 |
| #356：Host 绑定后 Start Work 可选 | 作者当前 Web 绑定/read-back 和受限组合实点证据分开；#124 尚缺本轮记录，见 F2。 |

变异通过 `node scripts/review-mutate.mjs <spec.json>`，spec 用进程替代输入；command 为 `node --test --test-timeout=120000 tests/contract/ui-repository-binding.test.js tests/integration/harness-plugin-repository-binding.test.js`。一次整表实跑退出 0，基线及还原后基线均绿，最终产品源码无残留差异。

| ID | 唯一锚点 → 替换 | killedBy | 结果 |
|---|---|---|---|
| M1-actions-owner | `apps/harness-plugin/src/host-repository-binding.ts`：`actions.configuration?.repositoryOwner !== owner` → `false` | `inconsistent three-reference intents` | KILLED，仅对应冲突用例失败。 |
| M2-duplicate-submit | `packages/client/src/repository-binding.ts`：`if (pending) return pending` → `if (false) return pending` | `in-flight duplicate shares Promise` | KILLED，对应幂等用例失败。 |
| M3-unmount-account | `packages/ui/src/repository-binding.ts`：`useEffect(() => () => source.cancelAttempt(), [source])` → `useEffect(() => () => undefined, [source])` | `production form unmount stops late account continuation` | KILLED，该用例及已发 Host bind 晚结果用例失败。 |

## Progress

- [x] 2026-10-27：逐文件审查前先建 P0–P3 矩阵，锁定事实与完整需求/线程。
- [x] 2026-10-27：18 文件分层检查、窄回归、类型、边界、规模和发布面检查完成。
- [x] 2026-10-27：F1 真实 Git/SQLite 反例多次复现，确认外部修复加重启可恢复。
- [x] 2026-10-27：三项变异与十一种错误渲染探针完成，源码已还原。
- [x] 2026-10-27：实时分页核对 #124，记录 F2；13 章节证据汇总交协调者。
- [x] 2026-10-27：F1 修复独立复评，重新运行 32 项窄回归、类型与 9 项边界及 12 组独立反例探针；F1 在下述锁定未提交差异上关闭，无新增 finding。

## Surprises & Discoveries

F1 根因：`packages/core/src/queries.ts:141` 遍历所有 RepositoryRecord；路由拒绝仍返回 repository，只把能力标 unavailable。`restoreProviders` 将单挂载构造拒绝收进 disabled 后继续组合，Host assemble 成功，故没有 activationError。新增 preflight 固定使用 `repository-binding-probe`，其输出摘要目录与实际 binding id 不同；client 只看 repositoryId 存在便发布 active。

以下为初审原提交的复现命令，仅适用于 `8d9f8a3` 的原始产品字节，不用于断言当前修复后工作树仍有缺陷。Superseded by `Outcomes & Retrospective` 的“F1 修复独立复评”（2026-10-27，未提交修复）。只在新临时夹具中写入，远端使用既有录制回放；完整带断言脚本原件已交协调者，未加入产品树。

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createHostComposition } from './apps/harness-plugin/src/host-composition.ts'
import { PROVIDER_CATALOG } from './apps/harness-plugin/src/host-providers.ts'
import { createRepositoryBindingSource } from './packages/client/src/repository-binding.ts'
import { WORKSPACE, ACCOUNT, account, seed, seedWorkspace, githubFetch, REPOSITORY_MOUNTS } from './tests/integration/fixtures/host-seed.js'
const root = await mkdtemp(path.join(tmpdir(), 'review407-'))
const repo = path.join(root, 'repo'), dataPath = path.join(root, 'data', 'workspace.sqlite')
await mkdir(repo); execFileSync('git', ['init', '-q', '-b', 'main', repo])
execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'])
await seed(dataPath, PROVIDER_CATALOG, async s => { await seedWorkspace(s); await s.putConnectorAccount(account()) })
const selected = REPOSITORY_MOUNTS['development.github'][1]
const owner = selected.repositoryOwner.toLowerCase(), name = selected.repositoryName.toLowerCase()
const repositoryId = `github.com/${owner}/${name}`, github = githubFetch()
const fetch = (url, init) => { const body = JSON.parse(init.body); body.variables.owner = selected.repositoryOwner; return github.fetch(url, { ...init, body: JSON.stringify(body) }) }
const options = { dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => 'fixture-secret', fetch }
const references = [{ domain: 'development', implementationKey: 'development.local-git', configuration: { repositoryPath: repo, repositoryExternalId: repositoryId } },
  ...['development.github', 'github-actions'].map(implementationKey => ({ domain: implementationKey === 'github-actions' ? 'delivery' : 'development', implementationKey, accountId: ACCOUNT, configuration: { repositoryExternalId: repositoryId, repositoryOwner: owner, repositoryName: name } }))]
let host = await createHostComposition(options)
const first = await host.call('bindRepository', { actorRef: { kind: 'user' }, idempotencyKey: 'first', repositoryId, references })
assert.equal(first.writeState, 'local_only'); await host.dispose()
const localId = first.value.bindingIds[0], dir = path.join(path.dirname(dataPath), 'worktrees')
const linkedRoot = path.join(dir, createHash('sha256').update(localId).digest('hex').slice(0, 16))
await mkdir(dir); await symlink(repo, linkedRoot); host = await createHostComposition(options)
let last
const source = createRepositoryBindingSource({
  connectAccount: async () => ({ writeState: 'local_only', saving: false, authoritative: false, value: { accountId: ACCOUNT } }),
  bindRepository: async (actorRef, idempotencyKey, repositoryId, references) => last = await host.call('bindRepository', { actorRef, idempotencyKey, repositoryId, references }),
  baseline: () => host.call('baseline', {}),
}, { actorRef: { kind: 'user' } })
try {
  await source.bind({ localPath: repo, owner, name })
  const baseline = await host.call('baseline', {})
  assert.equal(source.getSnapshot().state, 'active'); assert.equal(last.activationError, undefined)
  assert.ok(host.disabled.some(d => d.bindingId === localId))
  assert.ok(baseline.repositories[0].capabilities.filter(c => c.key.includes('worktree') || c.key.includes('branch.create')).every(c => c.access === 'unavailable'))
  await unlink(linkedRoot); await source.bind({ localPath: repo, owner, name })
  assert.ok(host.disabled.some(d => d.bindingId === localId))
  console.log('active with disabled Local Git; repair + retry still disabled')
} finally { await host.dispose() }
host = await createHostComposition(options)
try { assert.equal(host.disabled.length, 0); console.log('repair + restart restores Local Git') } finally { await host.dispose() }
JS
```

初审原提交实跑：source active、bind local_only、activationError 缺省、Local Git disabled invalid_input，Start Work 的 branch.create/worktree.create/worktree.read 均 unavailable；外部修复后重试仍 active/disabled 1，重启后 disabled 0。需要成功绑定后的外部目录变化，未在全新绑定正常路径触发；没有越界写或数据丢失。当前修复状态见上述 Superseded 指向。

F2 的独立回读命令为 `gh api repos/SingularityKChen/harness-projects/issues/124/comments --paginate --jq '.[] | {id,created_at,body}'`。2026-10-27 的输出只有早期 spike、更正、#372 与 #404 S3；最新为 2026-10-26T10:58:47Z（comment id 6414353137），没有 #407 或本轮组合证据。#356 明确要求 recorded on #124，PR 的 Refs #124 不是这条验收的实际回传。

## Decision Log

2026-10-27 / #407 分评审：F1 定 P2。理由：影响恢复反馈，正常新绑定通过，安全守卫 fail closed，修复目录加重启可恢复，不构成严重正确性或数据安全缺陷。

2026-10-27 / #407 分评审：probe id、disabled 与无 activationError 合为 F1 一条。理由：同一条状态推断因果链；显式 activationError 已保留且有正常反例测试，不另报通用错误丢失。该模块没有 reference_only 状态分支。

2026-10-27 / 协调评审与 #407 分评审：F2 是 P3 PR 级交付尾项，沿 #356 既有验收跟进；由协调者统一评审后用开发账号回传英文证据，区分各单 PR 源和组合边界，不重复实测、不新增重复 issue。本分评审不代发。

2026-10-27 / 协调实现者与 #407 独立分评审：F1 采用 client 消费已有 baseline 能力投影的方案 A，不改变共享 configure 或新增同进程重组协议。理由：本项需要诚实说明已记录但未就绪，并给出已实证的修复目录加重启恢复路径；Host 全局 disabled 触发重组会扩大无关设置命令、候选替换和 activationError 的现有边界。修复仅在匹配仓库的四项必需 Dev 门全部满足时发布 active。

## Idempotence and Recovery

窄验证可重跑，夹具每次新建。source 双击共用 Promise，unknown 原键、确定失败新 attempt；卸载后 account 晚结果不续作，已发 Host bind 保留 unknown 原键恢复。变异工具原字节还原，最终源码无工作树 diff。

F1 临时恢复：修复外部输出目录后重启 Host；只重试表单因配置 fingerprint 未变不重装配 disabled 挂载。PR 可 revert 撤回表单/预检，成功配置和用户仓库保留，不自动解绑、删除工作树或改规划事实。

## Interfaces and Dependencies

UI 只消费 client source；client 只调用 typed port；Host 持 storage/catalog/credential resolver/path 权威；Core 是唯一事务写者。Remote codec 缺省 accountId 省略字段，真实 strict Gateway lossless JSON 回归通过。依赖边 9/9，无新增迁移、平台 API 直达 UI 或第二事实源。

重复追踪：#387 为解绑/改绑、#368 为 provider 禁用命令、#155 为广义设置/健康、#340 为 provider 默认根/符号链接诊断、#341 为 Ready context 越界 handle 恢复；都未明确追踪 F1，相关不等于已覆盖。TD-064/TD-080 的 immutable id、改名和点前缀名限制，TD-070 进程账本，TD-076 Core 配置不透明，以及 #278/TD-079 的 Actions/Checks 探测均为既有范围，未重复报新缺陷。F2 已由 #356 自身验收追踪。

## Outcomes & Retrospective

2026-10-27 +08 / 协调者补充：完整初审已由评审账号提交，review id `5662813233`。两P2经独立复评和新组合官方Web实测关闭，#124评论`6435452681`已回读，P3回传尾项完成（如本PR适用）。新组合源`f49334fb`、tgz SHA-256 `448a05de2a64c761146cdddf99f9bb5290e3c565a889ee23d46cb4fd5b332d95`；共享实证完整边界见 `docs/review/2026-10-27-pr406-pr409-mmp-review.md`，不冒充各单PR独立新产物S3。最终head/base/checks/threads与合并结果在整理发布后重新锁定。

### 全部已确认 findings

**F1 · [P2] 以实际挂载状态确认恢复，再发布 active。** 最小新增行：`packages/client/src/repository-binding.ts:73`。baseline 仓库存在性只证明持久登记；实际 Local 输出根失效被 disabled 时仍显示“仓库已连接”，而 Start Work 三能力 unavailable。建议核对该目标所需的实际挂载/能力再发布 active，否则保留 configured 与可操作恢复提示，并让恢复动作重新验证/装配已有 disabled 目标。证据及用户恢复边界见 Surprises & Discoveries。没有同问题的专门 issue；#155/#340/#341 仅相关。**Superseded by 本节“F1 修复独立复评”（2026-10-27）：在锁定的未提交修复差异上关闭；最终提交/push 后仍须重锁远端 head。**

**F2 · [P3] 将本轮宿主绑定及组合验收回传 #124。** PR 级意见，无源码锚点。#356 要求 Host 绑定后 Start Work 可选并 recorded on #124；当前正文只 Refs #124，实时分页没有本轮证据。建议按冻结 source/tarball/runtime 分别回传本 PR 绑定/read-back 和组合 Start Work 的实际边界，不把组合证明写成单 PR 或 R1。已由 #356 追踪，无须新 issue。

### 重要非问题判定

- 三配置同源且 Host 前置逐字段拒绝冲突；没有宣称解决 Core 通用配置不透明的全部 TD-076。
- 第二、三引用 SQL 故障整笔回滚；local_only 是本地配置事实；显式 activationError 保留 configured 和原键。
- 输出根规范化拒绝指回 checkout 的 symlink；该政策不是 source allowlist，也不按 git remote 猜关系。
- 生产 cleanup/source generation 确实阻断晚续作，插件卸载另 dispose；具名第四参数与旧三参数兼容。
- GitHub 仓库可读不等于 Actions/Checks available；未验证权限仍 degraded，#278 已承接。

建议 **APPROVE**，两条非阻塞意见交协调者一次性发布。仍须当前远端头、CI、线程和人类逐 PR 合并授权；没有 GitHub review、issue/board 写入、commit、push 或合并。没有把作者安装证据或全量绿色提升为 R1 验收。

### F1 修复独立复评

2026-10-27，仍在 `feature/repository-binding-ui`、基底提交 `8d9f8a374c4a5660a5b3714de062c16c85e70103`；修复尚未提交。独立复评锁定的差异仅含 `packages/client/src/repository-binding.ts`、`packages/ui-model/src/repository-binding.ts`、`tests/contract/ui-repository-binding.test.js`、`tests/integration/harness-plugin-repository-binding.test.js`。这四文件 `git diff -- <四路径>` 输出的 SHA-256 为 `4673a7a9cd8b7c212e78a6ff98972b344f3c7095b490cef5164e3392affe2cc0`，验证前后相同；不能把本复评当作尚未生成的最终 commit/remote head 接受。

实现核对：client 沿既有浏览器安全 `./keys.ts` 出口使用共享 CapabilityKey；只读取匹配 repositoryId 的四个 Dev 必需门。缺门、重复必需 key、未知 access 不会产生 active；读门允许 available/degraded/read_only，写门允许 available/degraded。未就绪保留 configured，activationBlocked 仅让 ui-model 显示检查本地路径、授权及输出目录、修复后重启的提示；显式 activationError 仍按既有 error/recovery 语义处理，不被该标记覆盖。Host configure、RPC、Core、存储和持久化身份均未改变。

实施方两个新测试的 RED 日志已逐项读取：原实现分别得到 active 而期望 configured；两个失败均对应该根因。该日志属于实施方证据；本复评不改产品源码重造 RED。独立实跑如下：

| 验证 | 结果 |
|---|---|
| 初审同一四文件 `pnpm test:file` 命令 | 32/32，fail 0，退出 0；新增真实 Git/SQLite 回归观察 disabled → configured、修复目录后同进程仍 configured、重启后 active，Git 状态始终相同。 |
| `pnpm typecheck` | 退出 0。 |
| `pnpm run boundaries` | 9/9，退出 0；共享 keys 出口未引入浏览器对 Host/Node 的依赖。 |
| `git diff --check` | 退出 0。 |
| 独立 Node source 探针 | 12/12：非目标就绪不能覆盖目标 blocked；非目标 blocked 不影响目标就绪；只有非目标、重复必需门、缺门、未知 access、null capability、非数组 capabilities、畸形非目标 record、无 repositories 均不误发 active；合法 read_only 读与 degraded 写通过。 |
| 独立同 source 状态转换 | blocked → active 后 activationBlocked 清除；两次 bind 沿用同一原键。 |
| 旧恢复/生命周期控制 | 32 项中 unknown 原键、确定失败新 attempt、生产卸载阻断晚 account、已发 Host bind 晚结果、显式 activationError 的 configured/授权提示全部通过。 |

复评结论：**F1 关闭，无新增 finding，建议继续 APPROVE**。A 已消除不实 active 并提供当前 Host 可执行的恢复说明，未扩大装配协议。这里不承诺自动或同进程恢复，也不把重启提示泛化为所有网络/权限错误的修复。F2 的外部回传由协调者处理；本次未重新读取或修改它的远端状态。未运行全量 verify 或重新安装宿主；当前独立证据限锁定未提交差异与以上测试。

## Bottom Change Note

2026-10-27：先建矩阵并锁定 #407/#356；全文件、窄验证、变异和错误矩阵后补入真实 Git/SQLite 的 F1 反例与 #124 回读 F2。按 `docs/review/README.md` §8 收敛为 13 章节，保留原始假设、实跑上下文和证据边界。

2026-10-27：追加 F1 方案 A 的独立修复复评及未提交 diff 身份，在原 finding/原复现处标注 Superseded，记录 32/32、边界 9/9、类型及独立 12 组反例；不改产品、不提交、不向外部写入。

2026-10-27 +08：记录初审发布、独立修复复评、新组合Web与#124回传；最终远端状态仍以当前头回读为准。
