# PR #656 MMP 交付评审

评审日期：2026-11-17。目标：把 main 上已交付的 Windows 原生套件变成 GitHub-hosted `windows-2025` x64 lane，并聚合进唯一必需检查 `PR Fast Gate`；关联 #646。锁定代码 head `f10fbacecd37b284cd84279e4485637a3ac6c688`，base `ddb94c9440815626a3932dcaf050653f70eedb18`（`main`）。执行上下文：检出本 PR 分支的 `.worktrees/windows-native-lane`。独立评审未修改产品/测试/ExecPlan/commit，未写 GitHub；本记录随 PR 合并。

结论：**首审 APPROVE WITH NOTES（P2×1、P3×7，无 P0/P1）**。归档 docs-only 提交后最终 head 的门禁以 `gh pr checks` 回读为准（代码树不变）。该结论只覆盖 hosted 平台 lane 与聚合的工程闭环；`windows-2025` Server 镜像不是 Win11 x64 Desktop，#647 的人工安装验收与 R1 发布接受保持独立。

## 锁定事实与边界

- 远端回读 head/base 与上述值一致；`isDraft=false`、`mergeable=MERGEABLE`、`mergeStateStatus=UNSTABLE`（唯一红为非必需 `Create review session`）、`closingIssuesReferences=[#646]`、reviews/comments/threads 均为空。
- 规模：9 files +1190/−21；`rule-checks size main` 代码 730/1000、文档 481/1500，在 500–800 技术目标内。
- 精确 head `f10fbace` 的 PR run `44022934643`（checkout 平台测试合并提交 `3474c08`，「Merge f10fbace… into ddb94c94…」）：Verify、Browser、Windows Native、`PR Fast Gate` 全 success；Windows job `133836368995` 3m40s。
- Windows 日志事实：`ImageOS=win25-vs2026 ImageVersion=20261103.298.1 Architecture=AMD64`；node `v26.13.1`；git `2.56.0.windows.4`；阶段 1 runner `sid=…-500 admin=True adminMember=True`，`set=native-git files=2 tests=18 skipped=0 todo=0`；阶段 2 临时标准用户 `admin=false adminMember=false`，`set=private-data files=3 tests=69 skipped=1 todo=0`，`standard-user exit=0`，28 行标准用户诊断。
- 负控（scratch ref，已删除；commit diff 复核与声称一致）：A `44017206193` 单行 `assert.fail` → Windows Native/PR Fast Gate=红、Verify/Browser=绿；B `44017210116` `allowedSkips 1→0` → Windows Native/PR Fast Gate=红。
- 更早的精确 head 证据：run `44019343380`（PR @`b9629891`）四 job success；dispatch `44019346386`、`44019354863` success。
- 分支保护回读：唯一 required context = `PR Fast Gate`（strict=true）；本 PR 未改分支保护、workflow 数量或权限面。

## 风险矩阵

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 结果 |
|---|---|---|---|---|
| P0 | 平台 lane 假绿、聚合吞失败、泄漏凭据 | 唯一必需检查、无候选代码/secret 执行 | 真实 hosted 运行与负控 | 无；聚合只读结论，失败/取消/skip 均不放行 |
| P1 | runs-on 被改回 Linux、needs 漏项、`continue-on-error` 静音、清单/零执行不判红 | lane 与 PR Fast Gate 的真实失败传播 | 64 种 needs 组合契约、负控 A/B | 无；10 组单变量变异中 9 组判红，剩余两组为已披露的 review 级清单风险 |
| P2 | F1 `SETS` 下界与整文件移除只受 review 保护（同 PR 可静默缩小覆盖） | 作者已披露；靠 review 与 hosted 日志计数比对 | `minTests 39→1`、移除无 skip 文件均存活 | 1 项，非阻塞 |
| P3 | F5 新提交作者邮箱；F6 admin-only Git 证据；F7 skip 预算按 set 合计 | F1/F2 文档口径陈旧；F4 引用运行态路径 | F3 计划内测试条数；F8 部分出现/位置式断言 | 7 项，均非阻塞 |

## 分层证据与结论

1. **lane 设计**：`ci.yml` 新增 `windows-native` job（`runs-on: windows-2025`、15 分钟、默认 `pwsh`、两阶段身份、`finally` 清理），`fast-gate.needs` 变为 `[verify, browser, windows-native]`；唯一必需检查名未变；job 不覆写 permissions、无 secrets、不 checkout 固定 ref。
2. **唯一清单与反空心**：文件集、每文件用例下界、允许 skip 数只在 `scripts/windows-native-checks.mjs` 的 `SETS`；YAML 只按 set 名调用。缺失文件、零执行、todo、低于下界、skip 预算不符、摘要不可解析、进程失败均非零退出。
3. **真实平台取证**：两条 lane 在 hosted Windows 上分别以 runner 管理员与临时标准本地用户执行；记录镜像/toolchain/身份，标准用户证明非提权路径。普通用户 Win11 Desktop 仍归 #647。
4. **聚合与契约**：`tests/contract/ci-windows-workflow.test.js`（4 条）与 `ci-browser-workflow.test.js`（4 job / 3 lane / 64 种 needs 组合）钉住入口顺序、依赖与失败闭合；`node scripts/workflow-check.mjs` no findings（7 个文件）。
5. **回归**：`pnpm verify` 在清空并发后 exit 0（contract 1615、integration 2289/2306、e2e 226）；`pnpm run boundaries` 9/9；负控 A/B 证明失败传播与 skip 预算真实生效。
6. **issue #646 验收**：hosted x64 lane、仓库 Node/pnpm 来源、显式 pwsh、相关原生覆盖与真负控、聚合与唯一必需名、真实 hosted 结果与负控均成立；「Windows token/登录类型」只记录到 SID+组成员（部分满足，见 P3-6），Server 2025 x64 ≠ Win11 x64 的边界已写入文档。

## 首审意见

### P2-1（已由作者披露）`SETS` 下界与整文件移除只受 review 保护

`tests/contract/windows-native-checks.test.js:50-65` 只验存在/正整数/不重复。变异实验：`minTests 39→1` 三处契约测试仍 exit 0；把无 win32 skip 的 packed Host 文件从 `private-data` 移除仍全绿（移除带 skip 文件会被预算↔标记数钉红）。判据本质是「PR 自定测试清单」，接受为 review 级风险；加固方案（冻结每 set 条目数）会引入镜像式断言，不在本 PR 扩面。

### P3-1 `docs/development/ci.md` 负控段仍写「两条 lane / 16 种 needs」

同文件前文已改为三条 lane / 64 种。已在本归档提交订正为「全部三条 lane / 64 种」。

### P3-2 「直接跑事件 head」措辞不精确

实际 checkout 为平台生成的测试合并提交（含候选 head 与当时 base）。已订正 `docs/development/ci.md` 与计划 I9 的表述。

### P3-3 计划内测试条数与实现不符

计划写 `ci-windows-workflow.test.js`（5 条），实际 4 条。已订正。

### P3-4 计划引用不可分发的运行态副本

计划 Bottom Change Note 引用 `.superpowers/...` 路径（`docs/README.md:3` 明确运行态内容不进 docs）。已改为规范落点表述。

### P3-5 新提交作者邮箱进入发布面（人工决定项）

本分支 6 个提交作者为 `skc@singularity-ai.com`，而 `main` 历史只用 GitHub noreply 与旧 gmail。该邮箱已随公开分支/PR ref 可见；合并会把新邮箱写入 `main` 永久历史。独立评审记录该事实，不在本次验收中改写历史（改写会使全部 head/证据失效，且不能回收已推送对象）；由人类决定是否在合并前用精确 force-with-lease 归一。后续新建的归档提交使用仓库当前配置的 noreply 身份。

### P3-6 `native-git` 仅在 runner 管理员身份取证

lane 阶段 1 为管理员；阶段 2 标准用户只跑 private-data。Git 套件是路径/身份/恢复类而非权限隔离类，D3 已记录该取舍，残余风险低。

### P3-7 skip 预算按 set 合计而非逐文件

在 `private-data` 文件间搬移那条 win32 skip 可保持预算不红；实际改动必然出现在 review diff，风险低。

### P3-8 契约测试部分为出现/位置式断言

`ci-windows-workflow.test.js:51/83-86` 的字符串与先后断言证明力有限；真实语义由 hosted 日志承担，主要回归（runs-on/needs/静音/反空心）已由变异实验证明可判红。

## 实际执行与结果

所有命令在 `.worktrees/windows-native-lane` 根执行。

| 命令 | 观察到的结果 |
|---|---|
| `node --test tests/contract/ci-windows-workflow.test.js tests/contract/ci-browser-workflow.test.js tests/contract/windows-native-checks.test.js` | 17/17 pass |
| `node scripts/workflow-check.mjs` | no findings（7 个文件），exit 0 |
| `pnpm verify`（清空并发后） | exit 0：contract 1615、integration 2306（2289 pass/17 skip）、e2e 226 |
| `pnpm run boundaries` | 9/9 pass |
| `node scripts/rule-checks.mjs size main` / `disclosure main` | 730/1000、481/1500；disclosure exit 0 |
| `git diff --check main...HEAD` | 无输出 |
| `gh pr checks 656` | 12 项 pass，仅 `Create review session` 环境性 FAILURE（#364 advisory） |
| `gh run view 44022934643`（Windows job `133836368995`） | 平台测试合并提交 `3474c08`；镜像/Node/Git 身份与 18/69 计数符合；标准用户 `exit=0` |
| `gh run view 44017206193` / `44017210116` | 负控 A/B 使 Windows Native 与 PR Fast Gate 红，Verify/Browser 保持绿 |
| 变异实验（/tmp 克隆，10 组） | 9/9 主要回归判红；P2-1 两项存活 |

## 残余风险 / 未验证项

- 本机 macOS 不能验证 Windows 行为；Windows 结论全部来自精确 head 的 hosted 日志回读。
- `windows-2025` 镜像身份只记录不硬断言（D7）；镜像漂移只能从日志发现。
- `Create review session` 红是仓库已知 advisory #364，非必需检查。
- #644 的 fresh-root 首次创建、非 NTFS/mapped-volume 反例、探针延迟归 #647/后续 lane；`storage-restart.test.js` 未纳入 lane。
- 作者邮箱 P3-5 如人类要求改写，须建立 backup ref 后精确 force-with-lease，并重新回读全部 head/checks。

## 归档说明

本次归档 docs-only 提交将本记录、计划移入 `docs/exec-plan/completed/`、`docs/README.md` 与 `docs/review/README.md` 索引订正，并修正 P3-1/P3-2/P3-3/P3-4 的文档口径；产品、测试、workflow 字节不变，因此代码 head `f10fbace` 的评审证据继续有效，最终 head 的 `PR Fast Gate` 以 `gh pr checks` 回读为准。
