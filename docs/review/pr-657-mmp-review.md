# PR #657 MMP 交付评审

评审日期：2026-11-17。目标：Windows 标准用户首次启动时由同一 native helper 在创建调用内以目标安全描述符建立并接纳私有 plugin 数据边界，并安全重开既有对象；关联 #644。锁定 head `48de1e7f8bcf6ec91f25bab0f012de78bb65c8e1`，diff base 取 merge-base `8ce447594981`（PR `baseRefOid`；评审时 lane 分支 tip 已到 `f10fbace`，取证时运行时 base 为 `b9629891`）。执行上下文：检出本 PR 分支的 `.worktrees/windows-private-provision`。独立评审未修改产品/测试/ExecPlan/commit，未写 GitHub；本记录随 PR 合并。

结论：**首审 APPROVE WITH NOTES（P2×1、P3×5，无 P0/P1）**。归档 docs-only 提交后最终 head 的门禁以 `gh pr checks` 回读为准（产品/测试字节不变）。该结论只覆盖 Windows helper 的创建/接纳/重开闭环；Win11 x64 Desktop 安装与日常使用人验归 #647，R1 发布接受独立。

## 锁定事实与边界

- 远端回读 head/base 与上述值一致；`isDraft=false`、`mergeable=MERGEABLE`、`mergeStateStatus=UNSTABLE`（唯一红为非必需 `Create review session`）、`closingIssuesReferences=[]`（stacked PR 的已知状态，retarget 到 `main` 后解析 `Closes #644`）。
- 规模：9 files +702/−34（修正此前控制台口径的「11 files/+712/−119」）；`rule-checks size` 代码 317/1000、文档 419/1500。
- 精确 head `48de1e7f` 的 `pull_request` run `44021972016` 四个 job 全 success；Windows job `133833319830` 4m32s。平台为 PR 生成的合并提交父提交是 `b9629891`（运行时的 lane base tip），不是 PR `baseRefOid` 记录的 `8ce44759`。
- 原生计数：阶段 1 管理员 `set=native-git files=2 tests=18 skipped=0 todo=0`；阶段 2 临时标准用户 `admin=false`/`adminMember=false`，`set=private-data files=3 tests=78 skipped=0 todo=0`（48/48、1/1、29/29），`standard-user exit=0`。
- 三个 scratch ref 变异实验（评审中按日志与 commit diff 复核，ref 已删除）：M1 去掉创建调用的 `SECURITY_ATTRIBUTES` → 6 个原生用例 + packed 用例红；M2 把 `Ensure` 退化为只读 `Open` → 9 个用例红；M3 弱化创建后复核 → Windows job 超时红。
- 本机 POSIX：`pnpm verify` 第二次 exit 0（首轮 7 个 `HostAuthorityError` 为 macOS osascript ACL helper 超时，与本 PR diff 无关）；`harness-plugin-private-data.test.js` 59/59；`harness-plugin-artifact.test.js` 29/29；`boundaries` 9/9。

## 风险矩阵

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 结果 |
|---|---|---|---|---|
| P0 | 私有内容在权限建立前暴露、owner/ACL 被改写、凭据或路径泄漏 | 七条不变量、Host 权威、拒绝在发布端点之前 | 创建调用内 SD 与拒绝顺序 | 无；`SetSecurityInfo`/`Set-Acl`/`icacls` 在 `PROGRAM` 中出现 0 次，无先宽后 chmod 窗口 |
| P1 | 非受信主体可写、对象替换、既有数据被破坏、拒绝后残留 | 真实 Host 首启/重开/日志/worktree 容器 | 原生正/负例与 packed Host | 无；48 个原生用例覆盖 fresh/adopt/并发/sidecar/worktrees/拒绝矩阵，拒绝零写入 |
| P2 | — | — | F1 证据绑定与 PR 正文事实不符（见下） | 1 项，非阻塞（本归档提交订正） |
| P3 | F2 断言未覆盖 ACE 精确形状、F3 诊断精度 | F4 覆盖边界（adopt 首次 SDDL 前后相等、并发一方失败） | F5 环境性红检查 | 5 项，均非阻塞 |

## 分层证据与结论

1. **创建调用内建立私有边界**：`CreateDirectoryW`/`CreateFileW` 传入自相对 SDDL 的 `SECURITY_ATTRIBUTES`（`D:P` + owner/self/SY/BA），敏感字节写入前权限已就位；`PROGRAM` 中无 `SetSecurityInfo|SetNamedSecurityInfo|Set-Acl|icacls`。
2. **既有对象只接纳不改写**：`Ensure` 幂等 `CREATE_NEW` → 既有对象只做只读 `Open` 复核；permissive/foreign/linked/wrong-type 对象与缺失 launcher profile 拒绝且不创建后续对象、不发布端点；owner 不被夺取、祖先权限不被改写。
3. **边界对象一致性**：`workspace.sqlite`、`diagnostics.log`、`worktrees` 与 digest 目录使用同一 SD 策略创建；sidecar 可缺省；Git 后代继承由原生用例断言。
4. **生命周期**：真实 packed Host 首启建库（migrations 1–7）、dispose 后重开保留数据与日志；helper 处置/lease 语义沿用 #643，POSIX 路径未改。
5. **测试判别力**：M1/M2/M3 三个单变量变异分别使创建、接纳、拒绝矩阵变红；本机 darwin 上 18 个原生用例显式 skip，不是假绿。
6. **issue #644 验收**：五条验收标准均成立（fresh 免手工 ACL、既有数据重开不变、DB/log/worktree 同一边界、有界失败与端点不发布、真实 Windows/临时 profile/packed 证据）；「并发一方失败不破坏对方树」未单独构造，属已记录残余。

## 首审意见

### P2-1 证据绑定与 PR 正文事实不符（本归档提交订正）

ExecPlan Outcomes / Change Note 把「最终 head」写成产品/测试面 `1a681c35`、文档面 `81ebfd99`，未引用实际最终 head `48de1e7f` 的 run `44021972016`；同时称「证据 run 绑定 base `8ce44759`，此后 lane tip 前进到 `b9629891`」，而实测最终 run 的平台合并父提交已是 `b9629891`，之后 lane tip 才到 `f10fbace`（仅 lane 计划文档）。已在本归档提交改为：最终 head `48de1e7f` / run `44021972016` / job `133833319830`；运行时 base `b9629891`；lane tip 前进到 `f10fbace` 且与本 PR 文件集无交集。

### P3-1 本机 `pnpm verify` 首轮环境性 flake

首轮 7 个 POSIX Host 用例因 macOS osascript ACL helper 超时红，第二轮全绿且目标 POSIX 文件两次均 59/59；与 PR diff 无因果关系，记录为环境/负载 flake。

### P3-2 ACL 断言未覆盖精确形状

`windows-private-data.test.js:45-62` 已断言 owner=self、protected、无 inherited ACE、allow⊆{self,SY,BA}、self ACE flags/rights；未断言 ACE 恰为 3 条或 SY/BA 的 flags/rights。当前 SDDL 固定且 `Open` 兜底，风险低；建议后续补 exact-shape 断言。

### P3-3 诊断精度

db 路径若为目录，`CREATE_NEW` 返回 5 → `create-access-5` 而非 type；仍为有界拒绝且不泄漏，仅诊断略粗。

### P3-4 覆盖边界

SDDL/字节不变断言覆盖「创建后重开」，未对 fixture 预置 canonical 对象的**首次** adopt 做 SDDL 前后相等断言；并发只覆盖双方成功、未构造一方失败（ExecPlan 已自述）。

### P3-5 环境性红检查

PR 正文「All PR checks pass」与 `Create review session` 红叉不符；该检查非必需（唯一必需为 `PR Fast Gate`），是仓库已知本地端点问题。

## 实际执行与结果

所有命令在 `.worktrees/windows-private-provision` 根执行。

| 命令 | 观察到的结果 |
|---|---|
| `git diff --stat 8ce44759...HEAD` | 9 files +702/−34；`git diff --check` 无输出 |
| `pnpm verify`（第二次，清空并发） | exit 0：contract 1615/1615；integration 2316 run / 2289 pass / 27 skip / 0 fail；e2e 226 |
| `pnpm run boundaries` | 9/9 pass |
| `pnpm test:file tests/integration/harness-plugin-private-data.test.js` | 59 pass / 0 fail |
| `pnpm test:file …windows-private-data.test.js` | 28 tests / 10 pass / 18 skip（显式 darwin skip，Windows 上 48/48） |
| `pnpm test:file …harness-plugin-artifact.test.js` | 29 pass / 0 skip |
| `rule-checks size/disclosure`、`workflow-check` | 317/1000、419/1500；disclosure 通过；workflow-check 无 finding |
| `gh run view 44021972016` | 四 job success；Windows job `133833319830` 4m32s；计数与身份见上 |
| 变异 run `44019852717` / `44019860138` / `44019867773` | M1/M2/M3 分别红；ref 已删除 |

## 残余风险 / 未验证项

- lane 是 Windows Server 2025 x64 ≠ Win11 x64 Desktop；#647 人验与 R1 仍必需。
- 受管设备/企业 profile 策略、提权 launcher、非 x64 变体未验证；ARM64 由平台 token 有界拒绝。
- 同 SID 进程 TOCTOU 不在威胁模型（与 #643/POSIX 一致）；worktree 后代 ACL 仅由继承保证，真实 Git 写路径归 #645/#338 owner。
- 本机 macOS 不证明 Windows 行为；Windows 结论全部来自精确 head 的 hosted 日志回读。

## 归档说明

本次归档 docs-only 提交将计划移入 `docs/exec-plan/completed/`、更新 `docs/README.md` 与 `docs/review/README.md` 索引，并订正 P2-1 的证据绑定；产品、测试与 lane 字节不变，因此代码 head `48de1e7f` 的评审证据继续有效，最终 head 的 `PR Fast Gate`/Windows Native 以 `gh pr checks` 回读为准。retarget 到 `main` 后需在新 base 上重跑原生证据（ExecPlan D9）并确认 `closingIssuesReferences` 含 #644。
