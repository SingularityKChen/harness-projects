# PR #409 MMP 交付评审

## Purpose / Big Picture

判断 #234 的详情交付谱系是否构成可独立验收、合并与回滚的闭环；以当前工作项的真实 Host 投影、refresh→query 顺序、缺口/候选/新鲜度语义和规划轴隔离为最小证据。结论为 **APPROVE**，只有一条交付记录位置的 P3，未确认 P0/P1/P2 源码缺陷。

## Context and Orientation

下文矩阵与原意见是初审快照；其回传P3现已由#124评论6435452681关闭，最终状态见Outcomes & Retrospective。

2026-10-27（Asia/Singapore）初审；分支 `feature/delivery-lineage-drawer`，检出 `.worktrees/delivery-lineage-drawer`。head `d5e33f274f923aeb513b60b3312e05ac972f65aa`；base `main` @ `f6ea9713c04e2011bf2023d312c659d0be5c8b4d`。这是该精确 head 的观察，不代替最终发布前回读。PR 当时为 ready、MERGEABLE、UNSTABLE；关联 `Closes #234`、`Refs #124`，两条提交，完整 threads/reviews/comments 均为空。

需求来自 #234 正文与 2026-10-22 评论：六位置条、缺口、unknown/stale 不绿；打开与手动 refresh 后重读；nextFlipAt 单 timer、恢复重派生；relationState 与 state 独立；真实 CHANGE_REQUEST_READ_ROUTE 拒绝后 available=true/stale 的 CR 保留。`docs/exec-plan/completed/2026-10-26-delivery-lineage-drawer.md` 是实现和 S3 记录。已读 Superpowers `requesting-code-review`、`qian-systems-router`、`first-principles-development`，采用“整体用户路径→事实拥有者→最小反例→综合门禁”的审查方式。

## Design / Spec

先建下列 P0–P3 检查假设，再逐文件审查。风险假设不等于缺陷；初始“待分层核实”状态由当前证据更新如下。

| 级别 | 初始检查假设 | 最终证据与结论 |
|---|---|---|
| P0 | 谱系关联是否跨工作项泄露或把工程事实写回规划 | Host 前后可见性和仓库守卫、client 三元 scope 校验；真实 Host A/B 分别刷新读回，B 无上下文则六 not_started 缺口；规划无写控件/命令，未确认缺陷 |
| P1 | 读回/刷新/选择切换后用户看到的是否为当前工作项谱系 | key+reader+generation 隔离；pending refresh 与恢复共用命令链；同 scope 乱序、ABA、reader 换源首帧、卸载均有定向断言并实跑通过，未确认缺陷 |
| P2 | 失败/并发刷新和部分观测是否错误呈现新鲜 | 真实 Core 路由拒绝保留 stale 候选 CR；失败仍 query、error/pending/断线遮绿；单边界两集合；首次离线打开由手动恢复，见非问题判定，未确认缺陷 |
| P3 | 链接/空态、证据可追溯性与可读性 | 六固定 slot 与具名缺口/未知/陈旧可读；F409-1：#234 要求步骤 11 记录在 #124，但该目标尚无本次 S3 回传 |

不把 CI 绿色当作闭环证明；不因旧提交 CI 的已知映射限制重复开缺陷；不把 Web S3 扩为 Desktop、真实 CI passed、部署或 R1。

## Global Constraints

本轮只读产品源码；唯一持久写入为本评审记录。未修改生产/测试代码，未 commit/push，未提交 GitHub review 或 issue 评论，未改看板状态。评审账号 `Singularity-AI-Bot`，后续交付尾项由协调者使用开发账号 `SingularityKChen` 处理。源码变异未施加：本轮只读边界下不把已有绿色测试表述为本轮变异杀死证明。

审查覆盖本 PR 全部 21 个 diff 文件，归组如下：

| 文件集合 | 逐文件结论 |
|---|---|
| `apps/harness-plugin/src/client.ts`、`host-composition.ts`、`host-operations.ts` | remote 外层解包；Host scope 先后守卫、读取后 Host now；两操作沿既有 lease；刷新不接 replay key |
| `packages/client/src/delivery-lineage-reader.ts`、`index.ts` | 只解码投影，不缓存；三 scope 键和投影 target 一致；坏时间/形状失败；refresh 结果不携带节点语义 |
| `packages/ui-model/src/derive.ts`、`types.ts` | 删除竞争 detail.lineage；独立 lineageEntryPoints 导出保留，未修改年龄算法或规划值 |
| `packages/ui/src/delivery-lineage-section.ts`、`index.ts` | open/manual 摄入；timer/resume 纯读；generation 和 reader 隔离；候选、available、state 分开显示 |
| `packages/ui/src/work-item-app.ts`、`work-item-detail.ts`、`work-item-project.ts`、`workspace-setup.ts` | 生产 deliveryReader 具名接线完整；只在安全 work_item target 挂载；每个已绑定仓库独立 scope；旧三参工厂兼容 |
| `tests/contract/harness-host-remote-adapter.test.js`、`ui-delivery-lineage-section.test.js`、`ui-model-presentation.test.js` | 保留 strict descriptor/唯一门语义；断言命令顺序、时间边界、遮绿和关系确认态 |
| `tests/e2e/delivery-lineage.test.js`、`tests/integration/harness-plugin-delivery-lineage.test.js`、`harness-plugin-setup-client.test.js` | 唯一写者名单只扩真实转发点；真实 Core→Host→section 路由拒绝、纯读无副作用、实际生产挂载 |
| `docs/README.md`、`docs/exec-plan/completed/2026-10-26-delivery-lineage-drawer.md` | 索引目标存在；13 章节完整，证据/限制分明；F409-1 为尚缺的指定外部回传位置 |

## Plan of Work

1. 锁定 head/base、需求、所有线程和运行结果；建立矩阵，读全部 diff 和关联模块。验收为每项风险有证据或明确边界。
2. 在本计划声明的检出根运行下列窄测试和守卫；真实 Host 反例只在进程内组装，不改源码。验收为命令 exit 0，不能以测试通过覆盖未验证的真实平台边界。
3. 汇总全部 findings 与非问题判定，写本记录并回传协调者。回滚仅撤销本记录；无产品或远端状态需要恢复。

## Validation and Acceptance

以下命令全部于 2026-10-27 在检出 `feature/delivery-lineage-drawer`、head `d5e33f274f923aeb513b60b3312e05ac972f65aa` 的工作树根实际执行。

```bash
node --test --test-timeout=120000 tests/contract/ui-delivery-lineage-section.test.js tests/integration/harness-plugin-delivery-lineage.test.js tests/contract/ui-delivery-lineage-strip.test.js tests/contract/ui-model-presentation.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-setup-client.test.js
node --test --test-timeout=120000 tests/e2e/delivery-lineage.test.js tests/integration/delivery-repository-routing.test.js
pnpm typecheck
pnpm run boundaries
node scripts/workflow-check.mjs
node scripts/resolution-check.mjs
git diff --check f6ea9713c04e2011bf2023d312c659d0be5c8b4d...HEAD
node scripts/rule-checks.mjs size f6ea9713c04e2011bf2023d312c659d0be5c8b4d
node scripts/rule-checks.mjs disclosure f6ea9713c04e2011bf2023d312c659d0be5c8b4d
git diff --name-only 01ee9961842d100c78bde8a011868a21a58bd680 HEAD -- apps packages
gh issue view 124 -R SingularityKChen/harness-projects --json comments --jq '.comments[] | [.createdAt, (.body | split("\n")[0])] | @tsv'
```

| 实跑项 | 结果与判别范围 |
|---|---|
| 组件/模型/生产接线六文件 | 64/64 通过；命令结果不得供给节点；缺口、候选、未知/陈旧、两个时间边界、pending/resume、同 scope 乱序、ABA 和换源均有正反断言 |
| Core/路由两文件 | 62/62 通过；Fake 与 SQLite、重复/乱序、部分读取、路由拒绝、纯读整库不变和唯一写者 |
| typecheck / boundaries | exit 0；边界 9/9，UI 不接 Provider，client 不依赖 React |
| workflow / resolution / diff | exit 0；workflow 检查 8 文件无 findings；无差异空白问题 |
| size / disclosure | exit 0；代码 484 行、文档 150 行（提交 diff 增删合计）；机械扫描不含 PR_BODY。本轮人工检查新增源码/文档未发现五类公开面泄漏 |
| 冻结 S3 source→当前 head 的 apps/packages | 无文件输出，产品字节变动集为空；这支持沿用记录中的 S3 产品身份，未独立重跑官方 Host 的真实平台 S3 |
| #124 评论回读 | 4 条：spike 两条、#372 详情读路径、#404 创建连接；没有 #409/#234 步骤 11 回传，确认 F409-1 |

两个额外进程内探针均通过：

- 真实 SQLite→Host→Remote→reader 的 A refresh/read、B refresh/read：顺序为 `[refresh, read, refresh, read]`；A 有 1 个执行上下文跳；B 无上下文则 0 hops、全部 `not_started`，未串用 A 的节点。
- 复用持久组件测试的 hook/timer harness，接入真实 Host：首次断线打开不发送请求，重连只 `read`，清楚显示“尚未刷新”，没有 passed、没有 timer；用户点按钮后变为 `[read, refresh, read]`，未刷新缺口消失，保留真实的其他缺口。该探针不声称真实 DOM/StrictMode 证据。

第二个探针的可复现命令（从持久测试读取 helper，子进程 stdin 执行，不写临时测试文件）：

```bash
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const original = readFileSync('tests/contract/ui-delivery-lineage-section.test.js', 'utf8')
const helper = original.slice(0, original.indexOf("test('open/refresh"))
const probe = `
import { createExecutionFixture } from '../fixtures/execution-drawer-browser.mjs'
test('review: real Host offline-open stays explicit and manual refresh recovers', async (t) => {
  const host = await createExecutionFixture(); t.after(host.close)
  const env = environment(t), calls = []
  const scope = { workspaceId: host.workspaceId, workItemId: host.itemId, repositoryId: 'repo-alpha' }
  const reader = {
    refresh: async (s) => { calls.push('refresh'); await host.installed.service.refreshDeliveryFacts({ kind: 'user' }, s.workItemId, s.repositoryId) },
    read: async (s) => { calls.push('read'); return host.installed.service.getDeliveryProjection(s.workItemId, s.repositoryId) },
  }
  const h = harness({ scope, reader, connected: false })
  text(h); h.flush(); await settle(); assert.deepEqual(calls, [])
  h.props.connected = true; text(h); h.flush()
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
  assert.deepEqual(calls, ['read']); assert.match(text(h), /尚未刷新/)
  assert.doesNotMatch(text(h), /data-state="passed"/); assert.equal(env.jobs.size, 0)
  h.render().props.children.at(-1).props.onClick()
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
  assert.deepEqual(calls, ['read', 'refresh', 'read'])
  assert.doesNotMatch(text(h), /尚未刷新/); assert.match(text(h), /缺口/); h.close()
})`
const result = spawnSync(process.execPath, ['--input-type=module'], {
  cwd: process.cwd() + '/tests/contract', input: helper + probe, encoding: 'utf8',
})
process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.status
JS
```

### 全部已确认 findings

Superseded by Outcomes & Retrospective（2026-10-27）：#124评论6435452681已发布并回读，指定位置的回传缺口关闭。原初审证据如下。

**F409-1 · P3 · 把步骤 11 的既有 S3 证据回传到验收指定的 #124。** 最小新增行锚点：`docs/exec-plan/completed/2026-10-26-delivery-lineage-drawer.md:119`（也适合 PR 级意见，因缺口跨验收与回传位置）。#234 最后一项验收明确要求 Host 步骤 11 “recorded on #124”；当前计划有完整单 PR S3，且第 113 行诚实说明 `Refs #124` 不是已发表评论。2026-10-27 实际回读 #124 的 4 条评论没有本次步骤 11 记录。影响是从上层验收入口无法找到本次持久回传，不能把交叉引用当成该位置验收已经完成。建议由交付 owner 把现有脱敏 S3 摘要发布到 #124 并回读：给出日期、冻结产品源/产物身份、实际路径、规划前后相等，以及 Web/真实 CI 缺席/组合候选的边界；无需重做实测。此事项属于 #234 本身验收，未查到另一个同问题独立 issue；不重复创建 issue。协调者已将其纳入统一交付尾项。

### 重要非问题判定

- 首次 `connected=false` 打开后恢复只纯读，是已决策的“恢复不重放命令”，不是静默成功：真实 Host 探针显示 `not_refreshed` 与明确按钮，可操作恢复且不绿。初查将其当作 P2 候选，反例与需求裁决后撤销候选。
- `available=true` 不等于刷新路由可用。当前真实 Core 路由拒绝集成用例保留 Last PR、候选、stale 与不完整提示，未把逐跳可读性升级为 passed。删除 detail.lineage 避免竞争口径。
- 候选 CI 可以同时有 passed 节点状态；页面另写“候选关系”，没有自动 confirm。新鲜度与关系确认是正交轴。
- TD-042 的旧 CI 锚点不在本次闭环中重构，TD-043 的持久映射也没有升级为当前通过；当前页面给最后已知说明，PR/计划明确保留债务，`docs/exec-plan/tech-debt-tracker.md` 与 #281 继续承接，不重复报意见。
- 其他工作项交付视图 #281、PR 跨域身份 #367、执行状态持续刷新 #365、完整人工 demo #143 都有既有 owner，不因本 PR 未实现而扩大 #234 范围。

### 外部门禁证据边界

锁定 head 的 PR Fast Gate、CI、Merge Gate、Rule checks 均成功。`GitHub review session` 失败日志是本地可选端点连接拒绝；不在必需分支保护内。Rule checks 的取消 run 有同 head 后继 success。两份当前 CodeQL（actions / javascript-typescript）error/warning 为空、results_count=0。以上为协调者抓取的本轮事实快照；最终发布仍须按当前 head 回读。没有用 CI 的成功替代本轮源码、反例或 S3 审核。

## Progress

- [x] 2026-10-27：先建 P0–P3 矩阵，读完整 issue/comment、PR、全部 diff、线程与运行证据。
- [x] 2026-10-27：完成六层审查与 126 项相关测试、9 项边界、类型/规则检查；实际执行两个进程内反例。
- [x] 2026-10-27：综合结论 APPROVE，F409-1 为唯一 P3；无源码修复或 GitHub 写入。
- [x] 2026-10-27 +08：F409-1已由协调者发布#124评论6435452681，开发账号与正文回读一致。

## Surprises & Discoveries

首次离线打开确实不会在重连后自动摄入，但真实 Host 保留“尚未刷新”并提供按钮，符合显式失败与不重放边界。该事实推翻了初查 P2 候选，不将它保护成既定缺陷。计划证据完整与指定 issue 回传完整是两个不同事实；前者通过，后者形成 F409-1。

## Decision Log

2026-10-27 / MMP 子评审：采用 Qian 的信息流/反馈边界与 First Principles 的事实拥有者审查，以用户当前目标、明确摄入意图与安全展示为判据；不把自动摄入缺席直接推成阻塞。协调者确认 F409-1 为 P3 交付尾项，统一由开发账号回传，不重跑既有实测，不复制历史债务意见。评审建议为 APPROVE；未授权合并。

## Idempotence and Recovery

所有本轮读操作与测试可重复；Host fixture 仅使用临时数据，关闭后清理，未触达真实规划写入。没有生产代码变异、提交或远端写入需要撤销。重评须重新锁定当前 head/base，不能沿用旧 head 结论；F409-1 完成后记录真实评论位置与回读结果。

## Interfaces and Dependencies

UI 只消费 DeliveryLineageReader 和 ui-model，client 通过 controller/core 类型叶子，不接 Provider；Host 拥有 scope、投影和 now，commands 是唯一摄入入口。计时只消费 nextFlipAt，规划状态不被工程视图写入。实跑依赖已安装的 Node/pnpm/workspace；真实 S3 只审计仓库记录和产品 source 相等，本轮未使用真实 Provider 凭据或重跑官方 Host。

## Outcomes & Retrospective

2026-10-27 +08 / 最终整合复评：已在真实main前三条合并结果上整合本能力，十一处共享文件按预演保留全部具名入口、scope门、可省略分支和refresh token。整个产品blob清单等于已通过2086+7及新官方Web的冻结组合，文档追加不改变产品字节。当前head/base、CodeQL、全部线程与issue关联将在最终push后回读；自指head不在文件中预写。

2026-10-27 +08 / 协调者补充：完整初审已由评审账号提交，review id `5662814310`。两P2经独立复评和新组合官方Web实测关闭，#124评论`6435452681`已回读，P3回传尾项完成（如本PR适用）。新组合源`f49334fb`、tgz SHA-256 `448a05de2a64c761146cdddf99f9bb5290e3c565a889ee23d46cb4fd5b332d95`；共享实证完整边界见 `docs/review/2026-10-27-pr406-pr409-mmp-review.md`，不冒充各单PR独立新产物S3。最终head/base/checks/threads与合并结果在整理发布后重新锁定。

完成全矩阵而未发现 P0/P1/P2 源码缺陷；APPROVE，附 F409-1 P3。64+62 个相关测试、9 个包边界测试和机械门禁全部通过。没有施加源码变异，也未重跑真实平台 S3；这两个边界不伪装为通过证据。单 PR 的冻结 S3 产品源与当前 apps/packages 无差异；组合候选证据保持独立。后续门为协调者一次性发布 review、补 #124 回传、回读远端当前 head/checks/threads；是否合并仍由人类伙伴决定。

## Bottom Change Note

2026-10-27：保留初始风险矩阵和先建后审事实，补全逐文件审查、真实 Host 反例、实际命令与 F409-1，按 PLANS.md 的 13 章节收口。

2026-10-27 +08：记录初审发布、独立修复复评、新组合Web与#124回传；最终远端状态仍以当前头回读为准。

2026-10-27 +08：更新最后一条的真实main整合与完整产品等价条件；保持原单PR和新组合S3的边界。

2026-10-27 +08：在原回传/等待处标注Superseded，保留初审快照并追加已发生的最终版本事实。
