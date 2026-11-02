# PR #510 Storage 已提交读取围栏评审记录

## R1 历史范围与风险矩阵

Superseded by 本文「R2 当前技术验收」（2026-11-02 SGT）。以下保留 R1 历史，不作为当前放行证据。

2026-11-02 SGT，source `7c15587de5728df508169502027212af805c62be`、base `ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`，分支 `feature/storage-committed-fence`。仅 Storage port/两adapter、registry精确表面、两同步instrumentation和11项纯Storage测试；Core双owner消费者仍留#469。无迁移、权限状态、Provider调用或Planning策略。

| 等级 | 风险与检查 | 当前证据 |
|---|---|---|
| P0 | 第二状态权威、跨层/秘密发布 | 无schema/新事实；边界/发布面与人工五类检查 |
| P1 | COMMIT前推进、ROLLBACK误推进、漏自身/其它连接提交 | 独立11项及4项暂存提交诊断；完整3034+7 |
| P2 | active tx/root绕过、结算后callback被误拒、close回归 | 原动态寿命和关闭合同，独立相邻63项 |
| P3 | 来源移动或同步proxy失真、行数/计划漂移 | 来源7文件逐字核验后自然去no-op rethrow，proxy原断言保留，代码140 |

## 独立验收与精简

两份独立系统调查、第三份独立spec审订确认这是必要共用前置。独立验收者只读复核来源 `3c8b8da`，11个纯Storage case完整移动，剥除Core消费者import与一项Core测试；独立5文件63/63和Memory/SQLite×commit/rollback四项诊断通过。Memory无作用rethrow自然删除；同步返回直接断言string，另保留read-only事务token不变断言。精简后11/11独立复跑通过。未做泛型事务重构。

## R1 历史验证及限制

工作树根运行 `pnpm verify`：3034/3034加MVP0 7/7、typecheck通过；`pnpm boundaries`、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure ea37903`、`node scripts/rule-checks.mjs size ea37903`和`git diff --check ea37903...HEAD`按最终交付门回读。实际代码140行，文档小于1300。

隔离archive副本通过 `review-mutate.mjs`：atomic漏计、自身提交漏计、Memory只读误计、Memory/SQLite事务动态寿命、同步返回六项均由具名用例KILLED，基线/逐字还原后GREEN。首轮自身提交变异killedBy名称误配产生KILLED_OTHER，修正名称后6/6有效，不将归因错误当产品新缺陷。

这只证明Storageprimitive，稳定foreign Syncing的权限处置仍由Planning消费者修复。Issue #509与PR #510双向关联、分类/里程碑/负责人及Project机械字段已回读；Status默认Todo未写，原生依赖未写。最终远端当前head CI、review threads及独立评审结论通过后才Ready；本地证据不代表UAT/R1或merge授权。

## R1 正式评审与作者修复

旧远端head`be6e727`/source`7c15587`的独立结论REQUEST_CHANGES：P1同步direct COMMIT与fence计数间微任务、P2内层另一root遮住外层active token、P2正式成功dirtytransaction漏计变异存活、P3负控定义仅在运行态。原review与四线程保留，不以作者自己的结论放行新source。

两个adapter同步fn执行后不再无条件await，PromiseLike才等待；SQLite真实COMMIT与自身计数同段执行，异步transaction仍完整结算后发布。父token链检查所有尚active的同root动态scope，SQLite root mutate复用同一检查；未新增队列或全局业务状态。原11case全部保留，新增dirtycommit/read-only、ancestor范围与真实public delayed read五项，明确RED13/16→GREEN16/16；相邻39/39、完整3039/3039+MVP0 7/7及typecheck通过。类型初次optionalparent遗漏undefined修正后才有当前完整GREEN。

旧六项id/anchor/replacement/killedBy完整定义原归属source7c；新source正式重放定义为`tests/fixtures/storage-committed-fence-mutations.json`，含六等价当前anchor及新增五项（同步COMMIT、两adapterancestor、两adapter成功dirtytransaction）。在隔离同source快照安装依赖后按fixture中的command，使用`node scripts/review-mutate.mjs tests/fixtures/storage-committed-fence-mutations.json --root .`重放；11/11具名KILLED、基线和逐字还原GREEN。该fixture公开保存全部重放定义，避免只靠被忽略日志；不要求在owner工作树临时关闭安全代码。

R2技术复评结论见下一节；精确最终head CI及正式review、逐线程作者回复/resolve仍须回读，不把旧远端全绿或旧六项日志冒充新实现接受。

## R2 当前技术验收

2026-11-02 SGT，协调者独立复评 source `d44b10aa0df5037df1901299f926325283e94a10`，其产品/测试与整理后的 `235ec37fd84fe5110e168be03bf307bd227c5b71`、已发布 `8a66659` 逐字一致；base为固定 main `ea37903`。原C1/P1、C2/P2、C3/P2及P3均ADDRESSED，新增 finding为空，技术建议APPROVE。正式16项、相邻39项、完整3039+7通过；独立23正式+13诊断/typecheck、协调者原公开延迟读与两adapter祖先3/3通过；正式fixture十一具名负控全部KILLED、407文件还原parity已核。当前代码295 A+D，文档按归档后机械命令重算，小于1300。

计划归档至 `docs/exec-plan/completed/2026-11-02-storage-committed-read-fence.md`。四条原线程由作者据证回复；最终文档head的CI、全部线程、issue509双向关联和正式当前head批准回读后，才由作者resolve/Ready。未改规划Status、原生依赖、AC勾选或UAT/R1，不merge。

## 2026-11-02 接手复核 · R12 已批准交付

锁定 head `5bd94d017cc6d261043dcdd2770d59b15fcca00b` / 直接 base `09eb366c0c7541f7cac40b3e71123e5dfe49579e`。实际检出与当前远端一致，两个提交为能力与文档；4个线程均resolved、分页结束，当前head存在独立APPROVED，PR仅Closes #509。接手复核建议 **APPROVE，无新增P0/P1/P2/P3**；可以进入文档整理与新head重新CI门，后续rebase或push必须重新锁定。

先读原P0–P3矩阵/R2技术结论，再核对R12交接与当前diff。对 `d44b10aa0df5037df1901299f926325283e94a10` 执行 `git diff --name-status <source> HEAD`，全部漂移均在docs，产品/测试/配置/workflow无漂移；逐个当前变更代码和fixture的blob也相同。源级复查同步direct提交与计数同段、真实transaction提交/回滚、active ancestor链、root/tx拒绝、关闭合同及opaque token仅同连接比较，无新增队列、schema、Provider调用或权限authority。设计是#465/#468的独立Storage前置，不抢先接受消费者；七架构不变量和规划状态拥有者未变。

本次在 `.worktrees/storage-committed-fence` 实际运行：

- `node --test --test-timeout=120000 tests/integration/storage-committed-read-fence.test.js`：16/16，fail/cancel/skip均0，包括公共延迟旧读、脏事务、两root祖先和settled callback。
- `node scripts/rule-checks.mjs disclosure 09eb366c0c7541f7cac40b3e71123e5dfe49579e`：exit0；人工复核当前新增面，未发现新增敏感披露。
- `node scripts/rule-checks.mjs size 09eb366c0c7541f7cac40b3e71123e5dfe49579e`：exit0，代码295、文档175 A+D；不含本addendum。
- `git diff --check 09eb366c0c7541f7cac40b3e71123e5dfe49579e...HEAD`：exit0；当前变更Markdown相对链接missing=[]。
- 当前 `gh pr view`、完整threads与#509回读成功；#509仍OPEN，六项AC未被本评审机械勾选。PR Fast Gate、Verify与Merge Gate各lane为SUCCESS。可选review run41439322385日志实际回读为endpoint 000000连接失败，属于既有#364/评审手册的非必需转发问题，不列产品缺陷。

既有R2完整套件和11项具名隔离变异作为其等价源码证据保留，本轮没有重复全量或变异、没有冒充亲跑。新增问题为零，无需新增重复issue；#465/#468消费者、人类UAT、R1仍独立。本次仅追加此记录，未改实现/计划/index/Git或远端。
