# PR #440 MMP 交付评审

观察日期：2026-10-28（Asia/Singapore）。状态：当前 immutable head 的独立评审完成；建议 APPROVE，无新增 inline 缺陷。

## 锁定事实与控制

- base：`main@88d21ae6e0f0afb1f18afc776f54efac3ff4723a`；head：`afd11da00a0ae396f51859978e7e6a3e765c36e9`；分支：`chore/plugin-bundle-evidence`。
- 执行上下文：检出 `chore/plugin-bundle-evidence` 的 `.worktrees/plugin-bundle-evidence` 根目录。范围：构建证据：实际支持面、来源稳定性、输出边界与同配置比较。
- 事实：当前 ready、可合并；关联 issue #428；所有 review/thread 已读取，均为空且无后续页。CI 结果按当前 head 单独回读。
- 硬约束：保持规划/工程轴正交、Host 权威、Provider ack/reconcile、全局身份与工作区成员分离、既定依赖边。局部测试通过不能代替 MMP 产品闭环。
- 方法：Superpowers 独立子评审；qian-systems-router 的接口/反馈与综合判断；first-principles-development 的事实、约束、反例与最小判别验证。
- 已有实现 owner：会话「规划迭代优先级与并行交付」。P0/P1 交该 owner，评审方不并行修改产品代码；P2/P3 按本次人类授权由评审方负责收尾。
- 人类直接指令覆盖 PR #438–#440：无阻塞时修复、独立复评、归档、整理提交、核对 issue 后执行 rebase merge；有 P0/P1 时 REQUEST_CHANGES 且不合并。

## 预建风险矩阵

以下为逐文件审查之前建立的风险假设，不能当作已发现缺陷。

| 层 | P0：main/硬约束破坏 | P1：交付阻塞 | P2：可修复非阻塞 | P3：局部改进 |
|---|---|---|---|---|
| 代码/反例 | 数据丢失、越权写入、不可恢复事务 | 错 issuer/身份、迟到覆盖、失败伪成功、越界清理 | 边缘错误诊断、无害冗余 | 命名/局部可读性 |
| 产品闭环 | 工程状态篡改规划权威 | 用户入口到权威回读/投影断裂；证据误归当前版本 | 恢复提示/限制表述欠清楚 | 文案与呈现 |
| 架构/设计 | 第二权威源、secret 入业务库 | 违反依赖、身份/工作区隔离、持久化原子性 | 可避免的耦合/超范围设计 | 局部简化 |
| 测试 | 发布门禁绕过且无证据 | 主张未被判别测试覆盖、失败/并发路径失守 | 已有行为的覆盖薄点 | 重复断言/命名 |
| issue/验收 | 无授权改变规划关系/发布边界 | scope/acceptance 未闭环却关闭；已有跟踪与本次归属混淆 | 索引/验收清单遗漏 | 说明精简 |

## 分层证据与反例

### 系统结果与范围

本次验收对象是 #428 的 Host-export/构建增量评估，不是 #427 的完整 UI 改善。读取 #427、#429、#430 后确认：列表与详情的真实 Host 交互、布局和键盘验收仍由后续子项承担；本 PR 明确保留当前 UI 且不增加依赖，未据此声称父 issue 或 R1 完成。选择已有 Host 根 primitives/token 并对比 selective Radix Dialog 的职责、集成和维护成本，是本次范围内的可审阅决策；备选未构建/未测量已明确披露，没有填写假定体积。

### 分层核验

| 层 | 证据与判断 |
|---|---|
| 代码/失败路径 | 逐行审查 `bundle-report.mjs` 与生产 `build.mjs`：受控输出清理前规范化和逐组件拒绝 symlink；源必须是登记 worktree 根；入口 realpath 不得重定向；每个 input 的 realpath 不得逃逸；build/pack/比较失败不发布成功 JSON。原生产 build 未在 diff 内。 |
| 产品闭环 | `bundle:report` 提供可保存 raw/gzip/hash、输入/external 图和真实 pack，`compareReports` 拒绝 dirty、配置/工具链/schema/gzip 不一致；+20 KiB 是增量选型目标。保持单输出、Loader 和 React singleton 的判别证据。无新增 UI 在此测量 issue 范围内不构成缺口。 |
| 架构/信任 | 没有改变 Provider、规划轴、Host 状态拥有、客户端边界或运行依赖。显式 sourceRoot 的生产构建属于受信执行入口，输出安全检查不是执行任意未审源码的沙箱；运行期间源和输出须静止的边界已写清。 |
| 来源/测量 | 从 npm registry 独立读取 primitives/theme/slots `0.2.0-rc.2` tarball，重算 SHA-512 全部等于已记录 integrity；检查发行 JS 根 exports、`.d.ts` 与 README，确认 Button/Input/Checkbox/Menu/MenuItemButton/Modal、SlotCore、focus ring token 等记录。theme 不在 Loader baseline 的限制保持明确。 |
| 工作项/设计适度 | #428 三条验收都有对应证据；同仓 closing reference、独立回滚、completed ExecPlan 和 docs 索引齐全。代码/测试/配置增删 342 行；整体 diff 686 additions/2 deletions，无多余新依赖/新状态系统。搜索 open issue 标题及相关正文：#429/#430 是后续 UI 交付，#340 是 Local Git allowed-root 问题，未把它们误当本工具同根缺陷或提前闭环。 |

### 本次实际执行

执行上下文为 `.worktrees/plugin-bundle-evidence`，独占 clean head 探针为 `.worktrees/pr440-mmp-clean-probe`，仅用于只读构建与 pack；frozen/offline 安装后仍为 clean。原评审树含未跟踪的本记录，未将它伪装成 clean source。所有新输出独占 `.superpowers/mmp-review-440/`。

- `pnpm test:file tests/integration/harness-plugin-bundle-report.test.js tests/integration/harness-plugin-artifact.test.js`：36/36 通过；涵盖原 Loader/manifest/apply/inject/真实 React 静态渲染及来源/清理拒绝路径。
- 在 clean 探针执行 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`：退出 0，真实安装件生成。
- 同一个 clean head 工具分别测已登记 clean base 与 clean head：`node <clean-probe>/apps/harness-plugin/scripts/bundle-report.mjs --source-root <base-or-head> --out <exclusive-report-dir>`；head 另传 base report。base source=`88d21ae6e0f0afb1f18afc776f54efac3ff4723a`，head source 与 reportToolHead=`afd11da00a0ae396f51859978e7e6a3e765c36e9`，两份 source.dirty=false；Node v26.12.1 / pnpm 10.28.2 / esbuild 0.28.2，build SHA-256=`65e3d9753e880fb2b5547a7c518626ee579801a2e224a529801cdcd6c4e30560`。
- client raw/gzip=159165/37221，Host raw/gzip=431795/107895，pack=159301 bytes；raw/gzip/pack Δ 全为 0。两份 bundles 结构（含 inputGraph/external/hash）逐项相等，pack hash 相等；各一个输出，React 路径识别结果为空。原始 JSON 位于独占探针目录的 `reports/base/report.json` 与 `reports/head/report.json`。
- `git diff --check 88d21ae6e0f0afb1f18afc776f54efac3ff4723a...HEAD`：退出 0；完成前再次核对 head 未漂移。

### 测试判别力

按 `scripts/review-mutate.mjs` 执行一次最终变异整表，7/7 KILLED，baseline 和 restore 后 baseline 均绿。为遵守评审只写记录的边界，变异目标是 `.superpowers/mmp-review-440/scripts/bundle-report.mjs` 的逐字副本，测试是原 integration 文件仅调整 import 路径的副本；未修改生产文件或原测试。命令：

```sh
node scripts/review-mutate.mjs .superpowers/mmp-review-440/mutations.json --root .superpowers/mmp-review-440
```

| 变异 | killedBy | 结果 |
|---|---|---|
| B1 接受 bundled React | `rejects even one bundled React` | KILLED |
| B2 接受 dirty delta | `refuses deltas across changed configuration` | KILLED |
| B3 接受配置不一致 | `refuses deltas across changed configuration` | KILLED |
| B4 跳过 source HEAD/status 复核 | `rejects HEAD drift` | KILLED |
| B5 接受 build 入口重定向 | `rejects a build entry redirected` | KILLED |
| B6 接受 output symlink | `rejects output symlinks` | KILLED |
| B7 接受多输出 | `rejects multiple outputs` | KILLED |

### 限制与候选意见

本次未重跑全量 verify，也未把本地结果当 hosted CI；当前 head 的 hosted checks 与 optional red 检查由协调评审回读。图识别不能发现任意改名/预打包 React，前后 HEAD/status 乐观检查不证明源或输出并发写入安全，VM/静态渲染不证明真实 Host/a11y；这些限制已写入交付文档，与本次评估 scope 一致。没有新增 P0/P1/P2/P3 可行动缺陷，因而无新增行 inline 候选；不将旧评审已修复项再次作为发现。

## 结论与下一道门

建议 review 事件：`APPROVE`。当前 head 无新增可行动缺陷；#428 的测量评估闭环成立。协调者仍须在最终提交/公开 review 前锁定当前远端 head/base/checks/threads，并按仓库流程处理本记录归属、issue 验收与人类逐 PR 合并授权；本子评审没有提交、推送或写入 GitHub。

## 协调者综合与发布回读

2026-10-28 +08，`gh-review` actor Singularity-AI-Bot 对本仓 PR #440 / head `afd11da00a0ae396f51859978e7e6a3e765c36e9` 提交 `APPROVE` review `5681135207`；初次所有 inline 均随这一份 review 一次提交。幂等标识为 `mmp-review-20261028:440:afd11da00a0a:initial`。P0/P1 均无新增；P2/P3 亦无新增可行动意见。

协调者重算三 PR 合并树 `14ccba46db29ccc81ebfac55f183533ebf31ca72`，与 `test/iteration9-independent-integration@b300535b418683e9910ac372b3ccc40f75467fb5` 的 apps/packages/tests/scripts/workflows 及配置 blob 一致（清单 SHA-256 `8a81e2f22c6cb4652eb37e37ca57074c7f8fbbae559be65f131cabe01cb19638`）。在该命名集成检出运行 `pnpm verify`：类型检查、2442/2442 主测试、7/7 MVP 通过，执行后检出仍 clean。这是本地并集证据，不能替代单 PR CI、官方安装件真人路径或 R1。

初评当前 head 的必需 PR Fast Gate、CI Verify、Merge Gate、规模与披露检查均成功。#439/#440 的可选 Create review session 日志分别为 run 40661235450 / 40661250684，已确认本地 loopback 服务连接拒绝；分支保护 API 当前 strict=true，仅要求 PR Fast Gate。最终 push 后仍执行当前 head/base/checks、issue 双向关联与 threads 回读。
