# 已批准PR的接管与逐层集成

观察日期：2026-11-02 SGT，起始main `09eb366c0c7541f7cac40b3e71123e5dfe49579e`。本记录只承载批次控制和证据入口，各能力的矩阵、根因、测试及验收仍在各自PR评审与ExecPlan。

## 直接授权及所有权

本会话人类原话：“请你接手所有 PR 的 review和 rebase merge。相关 PR 均已经 approval。请你按照审批流程继续”。执行范围为现场全部七个开放PR：#510/#466/#469/#472/#503/#504/#400。前六项已有当前源正式批准；#400现场尚无批准且必需检查红，必须先独立审查和补足真实门禁，不能由前述概括推导其已通过。原实现会话已交接Ready，六项工作树无用户未提交改动；本会话为唯一集成owner。

## 顺序与冻结输入

| PR / issue | 接管head | 依赖与门 |
|---|---|---|
| #510 / #509 | `5bd94d017cc6d261043dcdd2770d59b15fcca00b` | 当前main上的Storage committed fence，先合入 |
| #466 / #465 | `8bd4457ae2d83a45234d9486b2b35a200d6301a5` | #510；1178行代码仅限已批准具体产品源 |
| #469 / #468 | `f0e9c7db564a2e6b44a154a98326d24778ee057e` | #466；交付读取健康与共享返回围栏 |
| #472 / #457 | `dc3c19346261972f68ed48639cfa74e4f5796fdb` | #469；1162行代码仅限已批准具体产品源 |
| #503 / #498 | `152e9dee8f8ec56897813ab857990cded63f21d5` | 其原fork cut是旧#472 `b48dc2398c5d482a5ef028814e9e211a3c4ef040`，不得把已重写父层的旧提交整串重放 |
| #504 / #450 | `0e0e7b3193a34f82ba00d3ad93b08bded086ed65` | #503命令、运行时和非空suite；随后接CI规则 |
| #400 / Bot豁免issue关联 | `d35f9127de0e874f16144a6b5e375147f890ea71` | 独立action升级；以最终main核对调用点、契约和hosted结果 |

每次前层合入后后层都要在真实新base取证，不以预演或旧批准代替。六项原技术结论、线程修复和具体预算依据已随各自 `docs/review/pr-<n>-mmp-review.md` 及completed ExecPlan归档。本轮不重新发明审批，不把size例外泛化到其它新增代码。

## 接管先验风险矩阵

| 等级 | 本轮风险 | 决定性证据 |
|---|---|---|
| P0 | 合错分支/版本、覆盖并发改动、CI执行不可信权限 | 实际refs、规范路径、backup ref、精确lease、固定head合并和信任边界 |
| P1 | 旧批准/旧绿替新head、重放复活旧权限或账本语义、冲突误删测试 | 正确fork cut、range-diff及blob、独立复评、实际hosted lanes、线程/issue回读 |
| P2 | 规模例外误扩大、载体/规则分层漂移、可选红误判 | 精确源及预算、人类原话、具名反例和逐失败日志 |
| P3 | 归档/导航丢失或重复、旧快照被当当前 | 双方索引保留、相对链接、带版本的观察和可重算命令 |

## 可重复的收尾与回读

发布前执行 `node scripts/rule-checks.mjs disclosure <实际base>`（含PR_BODY）、`size` 和 `git diff --check <实际base>...HEAD`，另查五类人工公开面。变更真实行为或解决语义冲突才扩大相关测试，不无故复制全部历史负控。每次最终push后读取当前head/base、全部checks、审批对应commit、完整review threads与双向issue关联；批准使用gh-review，开发/作者回复/resolve/合并使用gh。

六项恢复引用格式为 `refs/backup/pr<n>-before-approved-integration-20261102`。只合并明确请求的当前开放PR，使用rebase；合入后实际tree与已审候选和新base关系再核对。凭据、Planning Status、native blocked-by/blocking以及真实业务Provider写入不在本轮范围。

运行态结果使用以下命令重算，不在本记录预写未来成功或合并SHA：`gh pr list -R SingularityKChen/harness-projects --state open --json number,headRefOid,baseRefName,isDraft,reviewDecision`；`gh pr view <n> -R SingularityKChen/harness-projects --json state,headRefOid,mergeCommit,reviews,closingIssuesReferences`；`gh issue view <n> -R SingularityKChen/harness-projects --json state,closedByPullRequestsReferences`。

#143人类Demo、#236独立安装、#449安装产品、#459完整风险/可达边界审计、#73/R1和相关产品观察继续分别验收；工程合入不替代这些人类结论。
