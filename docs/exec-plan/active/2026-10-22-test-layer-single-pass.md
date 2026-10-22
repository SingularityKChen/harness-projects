# 契约套件去除真实层重复执行 ExecPlan

> 状态：Active；创建：2026-10-22；关联：#362。
> 维护规范：`PLANS.md`；执行检出：`test/test-layer-single-pass` 工作树根目录。

## Purpose / Big Picture

让 `pnpm test` 的层运行器契约只验证小型 fixture 与真实层非空，避免在契约层再次执行完整的四个 Merge Gate 层。
成功要求 fixture 拒绝语义保持、四个非空断言通过、同条件前后 `pnpm verify` 计时有记录，以及最终 PR head 四条真实 lane 成功。

## Context and Orientation

`tests/contract/run-test-layer.test.js` 末尾四例经 `run()` 启动 `scripts/run-test-layer.mjs`，脚本再启动 `node --test <layer>`。
四个层是 `tests/integration`、`tests/contract/package-boundaries.test.js`、`tests/mvp0`、`tests/e2e`；第二项是文件，其余是目录。
`countTestFiles` 已导出并导入本测试，支持这两种输入；既有 fixture 覆盖计数口径和 runner 失败行为。
`.github/workflows/merge-gate.yml` 的四条 lane 本来就在 PR 执行真实层，`tests/contract/merge-gate-workflow.test.js` 钉住接线。
依据是 issue #362、`docs/development/ci.md` 和 `docs/architecture/release-gates.md` §2.2；历史 issue 计时不能替代本轮测量。

## Design / Spec

末尾保留逐层命名的四例，每例只断言 `countTestFiles(path.join(REPO_ROOT, layer)) > 0`，失败消息点名该层。
这只证明存在 `*.test.js` 文件；不把文件数当成执行断言数，不再由这里宣称真实层全绿。
删除专用 `PROBE_INVARIANT`，同步开头、真实层常量上方及末尾注释。保留 `run()`、`runEnv()`、`spawnSync` 供 fixture 使用。
不选删除四例：issue 明确要求保留非空检查；不选环境开关或 mock：额外运行模式没有必要；不复制计数算法或新增镜像测试。
计数仍排除 `node_modules`，仅认 `*.test.js`；runner 的零断言、全 skip/todo 与摘要缺失 fail-closed 规则保持。

## Global Constraints

文件集合仅为 `tests/contract/run-test-layer.test.js`、本 ExecPlan、`docs/README.md` 索引；代码测试改动少于 100 行，整体受代码 800 / 文档 1300 行限制。
生产运行器、工作流、mutation harness 和所有 fixture case 原样保留；不新增依赖、公共接口、持久化或兼容路径。
文档中文、引用仓库相对路径；运行日志放忽略目录，不提交本机身份、绝对路径或原始大日志。
不改变 Planning 状态、看板 `Status`、关系与分支保护；PR ready 交付保持未合并。
最终发布前核对任务 diff，只能包含上述集合；安装环境改动不得进入发布。

## Plan of Work

### Batch 1 · 单次真实层执行证据闭环

**最小闭环**：套件移除真实层重跑，保留非空检查与拒绝 fixture，并由原 CI lanes 证明真实执行。
**涉及主文件**：`tests/contract/run-test-layer.test.js`；文档集合见 Global Constraints。
先锁定基线 head、Node/pnpm 版本、依赖与并发条件，确认基线完整 `pnpm verify` 成功，再做 Design / Spec 的替换。
先跑窄测试并人工核对末尾循环只有计数；成功后同机器、同运行时和依赖、无其它重测试并行完成后测。
计时须经 shell 运行 `pnpm`，保存命令、退出码、wall 秒数、head 与未提交差异；不以未受控单次时间差承诺固定百分比。
在本计划声明的检出根目录依次运行：

    node --version
    pnpm --version
    node --test tests/contract/run-test-layer.test.js tests/contract/merge-gate-workflow.test.js
    /usr/bin/time -p /bin/zsh -lc 'pnpm verify'
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    git diff origin/main -- scripts/run-test-layer.mjs .github/workflows/merge-gate.yml

预期前述验证退出 0，最后命令无输出；记录前后计时及比较限制。若负载不同，做一次受控成对复测即可。
整理提交并推送后，在同检出用 `gh pr view -R SingularityKChen/harness-projects --json number,headRefOid,baseRefOid,closingIssuesReferences` 回读当前 PR。
用 `gh pr checks -R SingularityKChen/harness-projects` 读取当前分支 PR；用 `gh run list -R SingularityKChen/harness-projects --workflow merge-gate.yml --branch test/test-layer-single-pass --json databaseId,headSha,status,conclusion` 定位最终 head 的运行。
对选定运行执行 `gh run view -R SingularityKChen/harness-projects <run-id> --log`，逐 lane 核对命令、非零执行摘要和成功结论；运行编号取上条回读结果。
**回滚点**：本批次提交；撤销此提交即可恢复旧套件，不涉及数据或 workflow 回滚。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| 契约不再启动真实四层 | 末尾四例仅 count；人工 diff 确认真实层没有传入 `run()` |
| 四层仍非空 | 四个独立命名断言通过，路径基于 `REPO_ROOT`，边界单文件也被计入 |
| fixture 语义保持 | 空层、缺路径、零用例、全 skip/todo、失败、缺参数、摘要解析与计数 fixture 全部通过 |
| 真实门禁未削弱 | runner/workflow 无 diff，既有 workflow 契约绿；最终 head 四个 lane 均 success，日志有真实命令与执行数 |
| 计时可比较 | PR 记录同条件 before/after 的 wall、退出码、命令与树；不沿用旧 issue 数值 |
| 发布可审查 | disclosure、size、workflow、diff 检查成功，issue 关联回读正确，当前 head checks 与 review threads 回读后 ready |

四条必查车道名称是 `Merge Gate · Integration`、`Merge Gate · E2E`、`Merge Gate · MVP-0`、`Merge Gate · Boundaries`。
聚合 `Merge Gate` 和 `PR Fast Gate` 也需绿；只看聚合检查不能替代四条真实执行日志。

## Progress

- [x] (2026-10-22 SGT) 独立比较设计 A/B 与源码，收敛为复用计数的最小方案。
- [x] (2026-10-22 SGT) 读取本轮基线日志：完整 verify 退出 0，wall 38.15 秒；执行上下文与环境由执行者在批次记录确认。
- [x] (2026-10-22 SGT) 末尾四例改为逐层非空计数；临时追加不存在的层后对应断言失败，移除探针后四层断言恢复通过。
- [x] (2026-10-22 SGT) 定向套件 34/34 通过；`CI=true pnpm verify` 退出 0，wall 27.49 秒。
- [ ] Batch 1：剩余发布检查与最终 head CI / PR 回读。
- [ ] 最终 head 四车道、PR 关联和 review threads 回读；ready 后保持未合并。

## Surprises & Discoveries

基线观察（2026-10-22，基线 `d7e7bca6`）：通过 `/bin/zsh -lc 'pnpm verify'` 得到 exit 0、wall 38.15 秒。Node `v26.11.1`、pnpm `10.28.2`。
macOS 的 pnpm 入口可能是无 shebang 的 Homebrew shim；直接由 Python argv 启动会选错运行路径，因此必须通过 shell 并确认版本。
完整计数只是文件发现证据，不能证明实际断言执行；当前真实执行证据仍待最终 head CI 产生。
实现后观察（2026-10-22，代码差异基于 `df361809`）：同一 Node/pnpm、工作树内 `node_modules`、串行验证条件下，`CI=true pnpm verify` exit 0、wall 27.49 秒。单次测量较基线少 10.66 秒；未重复配对，不能将差值归因于本改动或承诺固定比例。

## Decision Log

- Decision：采用两份设计共有的直接计数方案，保留 fixture 子进程。Rationale：复用既有能力，变更边界与 issue 一致。Date/Author：2026-10-22 SGT / 独立设计审查。
- Decision：不增加反射测试、mock 框架或单独执行模式。Rationale：原有计数 fixture、workflow 契约与真实 lanes 已提供分层证据。Date/Author：2026-10-22 SGT / 独立设计审查。
- Decision：计时作为观察值，最终 head 四车道作为门禁证据。Rationale：避免噪声、旧 head 和历史性能数字替代当前事实。Date/Author：2026-10-22 SGT / 独立设计审查。

## Idempotence and Recovery

上述只读验证可重复；计时重跑必须保持环境并记录原因。窄测试失败时先修正本文件，不扩展 runner 或 workflow。
后测失败如实记录，不发布性能结论；CI 失败先定位最终 head 日志。恢复只撤销本任务文件差异，保留其它任务与安装环境改动。
最终 push 后 head 改变就重取 checks 与评审，不把旧绿继承到新 head；不自行合并。

## Interfaces and Dependencies

使用仓库 `.nvmrc` 与 `package.json` 声明的 Node/pnpm、既有 `countTestFiles(layer)` 和 Node 内置测试接口。
本地验证离线且无凭据；最终 PR/CI 回读需要该仓库 `gh` 访问权限。无需 Provider 凭据或真实产品外部写入。

## Outcomes & Retrospective

本次完成设计收敛、最小实现、负向 guard 检查和本地验证。完整层真实执行与 PR 当前 head 验收仍由四条 Merge Gate lanes 提供，尚待最终 head CI 回读，不能宣称发布验收完成。
没有为本任务有意延期的技术债；发现超出范围的问题时记入 `docs/exec-plan/tech-debt-tracker.md`，不把它并入本批次。
全部验收成立后将本计划移入 completed 并更新索引；最终交付说明实际计时差与测量限制。

## Bottom Change Note

2026-10-22 SGT：独立审查两份设计后建立最小 13 节计划，明确 shell 计时与最终四车道证据，消除全绿与非空混称；实现后只保留四层非空计数，并记录单次同环境后测与测量限制。
