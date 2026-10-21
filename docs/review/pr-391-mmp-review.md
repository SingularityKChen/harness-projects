# PR #391 MMP 评审修复记录

- 初审：2026-10-22 SGT，head `8515d8b907ea10438966b9d5f75a985bfe7eb4f0`，声明base `d7e7bca6`；review `5609026658`，APPROVE，P0/P1为0、P2为1、P3为6。
- 初审采用Superpowers独立子评审、Qian系统综合、First Principles不变量及反例；全部意见一次性提交。
- 修复检出：`test/worktree-resolution-guard` / `.worktrees/worktree-resolution-guard`，先备份原head，再变基至真实 `main@0d8d6094c138b66fc50c3598d7e485528fc74168`，修复基点 `310046ad79c44a94b7e00ddece47b4018e9284b2`。
- 人类本次直接要求“继续走修复流程PR#388-#391”，本会话接手修复、独立复评、归档、整理提交、核对issue和rebase合并；不写Project Status/blocked-by。#186仅Refs，不关闭。

## 初始风险矩阵及分层结论

| 级别 | 审查前风险 | 初审及修复结论 |
|---|---|---|
| P0 | main门禁被破坏、生产状态被覆盖 | 未发现；只改测试基础设施和文档，无产品或Provider写入 |
| P1 | 误拦正确检出、漏拦pnpm入口 | 未发现；未安装嵌套根的五入口前置失败，已安装根与CI无特判；直接Node和局部shadow是已披露的既有边界 |
| P2 | 拒绝哨兵的设计事实不实 | D9/TD-088已纠正，保留真实代价与#186决策归属 |
| P3 | 导出前提、CLI拒绝缺测试、表格和命令范围错误 | 六条已逐项处理，见下表；未用文档修改掩盖未实现保护 |

## 全部意见到修复

| comment ID | 修复与判定证据 |
|---|---|
| 4344350520 | 已更正D9/TD-088(a)：外层自行物化、不跨检出，exports路径能带修复指引；#186保留OPEN，未实现哨兵或擅改范围。 |
| 4344350525 | TD-088/089移到Open Items连续表格行，保留全部已有行。 |
| 4344350530 | 删除D12/D13之间断表空行；D13仍明确根级不覆盖包内shadow。 |
| 4344350535 | 按意见允许的最小方案保留CJS定位，新增运行时契约要求被检查工作区包提供无条件根导出；conditional-root-export变异被该前提用例杀死。 |
| 4344350538 | 新增solo未安装CLI用例，断言exit1、MODULE_NOT_FOUND和安装指引；CLI-only-unresolved回退变异由本用例精确杀死。 |
| 4344350541 | README及TD-088补齐直接layer runner绕过路径；CI已安装单检出继续使用，未冒充已补运行器接线。 |
| 4344350548 | MVP-0 README纠正非等价入口；TD-089收敛为两份架构/产品文档，延期依据改成保留故意无--test的前缀零匹配验收，不再捏造在途占用。 |

## 判别性验证

在上述修复检出根运行：

```sh
node --test tests/contract/resolution-check.test.js
node --test tests/contract/resolution-check.test.js tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js
node scripts/review-mutate.mjs <repair-spec.json>
pnpm verify
```

目标11/11、含文档契约20/20通过；修复检出完整`CI=true pnpm verify`为1819/1819 + MVP-0 7/7、fail0。spec固定command为目标11项，三个变异显式含killedBy，整表exit0、前后基线绿，原文字节恢复：

| 变异 | killedBy | 结果 |
|---|---|---|
| CLI过滤掉所有解析失败、只保留越界 | `CLI：只有解析失败而没有越界` | KILLED |
| Core根导出改为import-only条件 | `入口前提：根守卫检查的工作区包提供无条件根导出` | KILLED |
| 根路径前缀去掉分隔符 | `越界：落点在同名前缀的兄弟目录` | KILLED |

原实现无行为修改，新增测试专门证明两个已审缺口有判别力；未来把包改为import-only/bin时契约要求同步调整定位，未声称当前通用算法已支持此类包。
初审原始issue复现、哨兵与无哨兵、已装与未装检出、pnpm五入口、部分安装、软链/大小写和34变异证据仍保留在原始review；当前修复的命令输出和独立复评在发布前重新锁定。

## 产品、架构与issue边界

用户可观察结果是pnpm测试先检查根发起的裸包解析，缺依赖或越界时列出全部包和安装命令，已装检出静默通过。包内或测试子目录shadow、直接原生Node和layer-runner仍由#186/TD-088跟踪，不能以代码测试绿宣称完整#186闭环。
没有Provider调用、规划/运行/关系写入、凭据或数据库变化；七不变量与包边界保持。#186的CI无特判、不依赖pnpm内部和README机械步骤成立，直接Node原始验收仍未满足，因此不勾全、不关闭；#351已关闭，仅作历史Refs。
MVP-0 README的两入口现已准确区分；剩余两份架构/产品文档中的前缀回读需保留伪造前缀零用例的负对照，TD-089没有机械改为会改变计数语义的test:file。

## 独立复评与发布门

独立复评APPROVE：20/20目标与文档契约，临时副本三个变异全部KILLED、归因匹配、前后基线与字节恢复；GFM回读确认表格，另实测无--test伪造前缀tests0、加--test为tests1，TD-089边界成立。修复源脚本、测试、package.json哈希前后相同。原批准仅针对初审head，变基/修复后的最终head/base、全部threads、checks及Refs关联须重新锁定，评审用gh-review、作者回复/resolve/merge用gh。
ExecPlan保持completed并记录修复事实，恢复锚点为`backup/pr391-before-review-repairs-20261022`；撤销本PR提交即可回滚，不删除worktree/依赖或修改用户项目状态。

#186 的哨兵与未覆盖范围说明已用开发账号发布并回读 comment `6333308375`；该说明明确PR修复尚未合并，未改变issue验收、Status或依赖关系。

修复固定输入并集验证（2026-10-22 SGT）：独立临时检出 `test/repair-queue-pr388@7e5ab3d6a8093a3521a8d759c5b8a7a9507c2b52` 按#390→#389→#391→#388组合四个已独立复评的产品修复，`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` exit0，之后`CI=true pnpm verify`为1886/1886 + MVP-0 7/7、fail0。只发生索引/技术债表冲突并保留双方记录，产品blob清单SHA-256 `4e0a28e18b93b86710c70640095cf52ff7f4df92a9430574e1bb892cc1c43e90`。这不是某一PR单独head的CI，实际合并仍需当前head/base门禁与批准。

最终整合：在#390/#389合并后的真实`main@b3bccadebe9b960eb5fca1b525adfacff7b5e6dd`变基，冲突只在索引/技术债表并保留全部事实；根guard、其11项测试及根manifest与独立复评字节一致。新client纯类型子路径不改变无条件根导出前提，共享扫描helper继承后重跑相关测试；#186依旧Refs/OPEN。最终head门禁与批准重新回读。
