# PR #390 MMP 交付评审

- 日期：2026-10-22；PR 关闭 #350，Refs #230、#143。
- 初审锁定：`2d6547b8c5fb423d686843d9b5ac8e0a706c7f0c` / `main@d7e7bca6`；Singularity-AI-Bot review `5609026250` 为 APPROVE。该批准只对初审 head 有效。
- 修复基线：`test/scans-skip-build-output@b68833aeb72cc616646c035456236d3c6599caa8`，merge-base `main@0d8d6094c138b66fc50c3598d7e485528fc74168`。本文复核的是该基线加本 worktree 的修复差异；commit 后须由协调者锁定最终 head 并回读远端 checks/threads。
- 方法：Superpowers code-review reception、TDD、systematic debugging，结合 Qian 系统边界与 First Principles 状态事实审查；先回放九条意见，再用 Git oracle、窄回归和有归因变异复核。

## 初始矩阵

| 级别 | 风险 | 初审结论 |
|---|---|---|
| P0 | CI 或仓库硬约束破坏 | 无；初审 head 必需门禁通过 |
| P1 | 第二源码写点被漏掉、打包产物污染扫描 | 无；R1/R2 与 C4/I1 已覆盖原闭环 |
| P2 | Git 忽略规则导致 helper 少扫；symlink 使扫描面比 base 窄 | 两项已修：C4 采用 Git 可见源码 oracle；C4 明确禁止扫描范围内 tracked symlink |
| P3 | case-only rename 误报、扩展名变窄、tracker 表格/指向/索引失真、U+2028/U+2029 记录过期、I1 路径未绑定 pack 配置 | 初审七项已修；独立复评另发现 F390-R1（I1 阴性预期仍写死 dist），本轮已修并复核 |

## 评审意见映射

| Comment | 修复与证据 |
|---|---|
| `4344350199` | C4 改用 `git ls-files -z -co --exclude-standard`，覆盖 tracked + untracked 且 Git 未忽略的源码；C5 增未暂存改名；C5d 以 `git check-ignore` 验证 nested `.gitignore` 与 `core.ignorecase=true`，并确认 Git oracle 暴露 helper 的漏项。C4 真实树集合相等。 |
| `4344350202` | helper 仍不跟随 symlink；C4 用 index mode `120000` 检出 scopes 内 tracked symlink 并要求集合为空。C5b 证实 symlink 可被 oracle 看见。真实仓库扫描范围当前无 tracked symlink。 |
| `4344350207` | C4 将 root 与文件路径都用 `realpathSync.native` 规范后比较；C5c 在本机大小写不敏感卷实跑 `Foo.ts`→`foo.ts`，无误报。 |
| `4344350211` | helper 与独立 oracle 扩展集合均为 `/\.[cm]?[jt]sx?$/`；新增 `.mts/.cts/.cjs/.jsx` 夹具。后续 package-boundaries 迁移由 #396 承接并保留相同扩展名。 |
| `4344350213` | 删除 TD-086/087 前的空行，恢复同一 Open Items Markdown 表格。 |
| `4344350217` | D5、tracker 改为 PR #388 改同一文件；#355 是 issue。#396 已由协调者创建并回读为 OPEN，`kind:chore` / `area:tests`，承接两处后续迁移。 |
| `4344350228` | ExecPlan 状态改为 `Completed`，Outcomes 把旧 rebase 值标成历史快照；索引记最终能力和 PR #390 复评，不保留“门禁由协调者继续”的过程态。 |
| `4344350235` | 补录 U+2028/U+2029 的 Progress 与 Surprise F7；D15 就地标注被 D16 部分取代；Outcomes 将 C2c 修正为 14 条真实 Git 判据。 |
| `4344350241` | I1 从 `apps/harness-plugin/package.json` 的 `pack:plugin` 脚本解析 `--dir <output>/package`；断言 `<output>` 属于根 `.gitignore` 的忽略目录集合，并在临时目录构建到派生路径。未改 `build.mjs`。 |

## 修复与验证

- TDD RED：新 oracle/夹具先于 helper 扩展加入时，旧 helper 在扩展名、Git-visible 少扫、未暂存改名、symlink 和 case-only rename 上失败；先加 I1 脚本配置绑定后标准配置通过。
- GREEN：`node --test tests/contract/source-tree.test.js tests/integration/source-scan-build-output.test.js` 为 13/13。`C5d` 两条 `git check-ignore -q` 均 exit 1，说明 Git 不忽略 nested-rule 与 case-insensitive 文件；case-only 用例在当前卷执行而非 skip。
- 变异 spec：`<review-spec.json>`（command 为上述目标套件），M1 扩展名收窄、M2 C4 删除 untracked oracle、M3 删除物理路径规范化、M4 删除 symlink oracle、M5 将 I1 的 buildOutputDirectory 改为未忽略的 out，脱离实际 pack 配置，均 APPLIED / KILLED；killedBy 分别是扩展名测试、C5/C5d、C5c、C5b、I1。runner 的前后基线通过并按字节还原。
- F390-R1 TDD RED：把真实 `pack:plugin` 的 `--dir dist/package` 临时改为合法且已忽略的 `build/package`，旧阴性预期失败，actual 是 `harness-plugin/build/package/lib/index.js`，expected 仍是 dist。标准配置 I1 1/1；修复后同一 `build/package` 配置兼容探针 1/1。此项是合法配置正向探针，不计入缺陷变异表；测试清单已还原。
- 文档引用/归档检查 `node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` 为 9/9；workflow-check 无 findings；disclosure、diff-check 通过；size 当前读数 360/1000 代码、391/1500 已跟踪文档（未跟踪的本评审记录不计入，最终整合后重跑）。
- 历史完整验证：2026-10-22 初审记录在 checkout `2d6547b8c5fb423d686843d9b5ac8e0a706c7f0c`、base `d7e7bca6` 的 `pack:plugin` 后 `pnpm verify` 为 1771/1771 + MVP-0 7/7。记录未保存具体分钟时间或产品树哈希；此结果属于初审 head，不作为本次修复候选的 full-verify 证据。协调者会在修复并集的最终候选上统一 pack 与 verify。

## 结论与边界

修复没有生产代码、构建脚本、依赖或 schema 变化。helper 只对根 `.gitignore` 的裸目录规则做保守剪枝，不承诺完整 Gitignore 语义；Git 可见源码 C4 防止真实检出静默少扫。scope 内 tracked symlink 明确拒绝，不跟随链接，避免逃逸和循环路径。

本次修复复评没有 P0/P1；九条原意见和 F390-R1 均有对应改动与证据，候选 worktree 可 APPROVE。远端仍需协调者在最终 commit/head 上重锁 base、checks 与 review threads；旧 head review 不转移。真实 Desktop 安装和其他 MVP 产品验收不由本测试工具 PR 声称通过。

独立复评APPROVE（2026-10-22）：13/13目标，C4五组Git oracle反例确认nested-ignore/ignorecase/tracked symlink报红，case-only rename/ignored产物为绿。F390-R1临时合法build/package配置复验1/1，未改工作树。根协调者随后仅将I1剩余提示/注释泛化为实际输出目录，并移除helper“与Git一致”的全称措辞；产品行为未变，整合后验证以新树为准。

修复固定输入并集验证（2026-10-22 SGT）：独立临时检出 `test/repair-queue-pr388@7e5ab3d6a8093a3521a8d759c5b8a7a9507c2b52` 按#390→#389→#391→#388组合四个已独立复评的产品修复，`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` exit0，之后`CI=true pnpm verify`为1886/1886 + MVP-0 7/7、fail0。只发生索引/技术债表冲突并保留双方记录，产品blob清单SHA-256 `4e0a28e18b93b86710c70640095cf52ff7f4df92a9430574e1bb892cc1c43e90`。这不是某一PR单独head的CI，实际合并仍需当前head/base门禁与批准。

最终候选文档复核订正：M5实际变异为`buildOutputDirectory`固定成未忽略的`out`，由I1拒绝；索引不再声称TD-086的“禁止新手写遍历”已实现，该剩余项仍须后续迁移/守卫闭环。两项只修证据措辞，产品blob不变。
