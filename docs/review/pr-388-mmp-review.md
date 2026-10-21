# PR #388 MMP 评审与六条意见修复

- 日期：2026-10-22 SGT；范围：#355 的生产目录收录、凭据出口及六条 P2/P3，未扩大公共接口、schema 或 Provider 权限政策。
- 初审锁定远端 head `6b855c4193f0ab5d0a67f9c7b73d6e7d4d6fa083`、base `d7e7bca6`；review `5609048721` 为 APPROVE，P0/P1 均零、P2 两条、P3 四条，一次性 inline 已发布。
- 初审后根协调者建立 backup 并变基到 `main@0d8d6094c138b66fc50c3598d7e485528fc74168`；修复起点为 `c0a036d734dcb1ad9027637a68610307f214583c`（该时刻尚未提交）；后续已整合并在前三项合并的真实main上重锁，当前候选及新检查以末节和远端回读为准，旧 checks/批准不转移。
- 所有本轮命令在 `feature/host-github-delivery-catalog` 的 `.worktrees/host-github-delivery-catalog` 根目录运行。根会话转录人类新原话『继续走修复流程PR#388-#391』，整体修复授权见所属 ExecPlan D23（权限选择另见 D24）；不涉及 Status/blocked-by。
- 当前 owner 只改本 worktree；没有 commit/rebase/push、GitHub 作者回复、resolve 或合并。根协调者负责外部登记和最终整合，独立复评不得由 owner 自批。
- 方法：Superpowers 接收评审/TDD/系统调试，Qian 整体接口，First Principles 的事实所有权与最小判别反例；先建立 P0–P3 矩阵，再完整分层搜查。

## 初始矩阵与分层结论

| 级别 | 初审风险 | 结果与证据 |
|---|---|---|
| P0 | 令牌外泄、跨源请求、破坏 main | 未发现；C1 库文件与 wire 扫描、C6 origin/宿主头约束、边界及安装件；修复不改地址/鉴权/schema |
| P1 | 权限伪造、错仓库读取、组合/回滚不一致 | 未发现；未知权限未伪报 available，调用失败形成缺口；错引用闸门零 REST，回滚隔离而非删库 |
| P2 | credential 无截止；债务承接悬空 | transport 共同预算已修；TD076/#356、TD081/#354新验收已登记回读，TD079/#278独立验证验收已登记；人类确认保留degraded只读 |
| P3 | 回滚、trailer、索引、D1 rationale 失实 | 文档逐条更正；D1保持现策略；人类随后已直接确认，见D24与comment6333568345 |

| 层 | 当前核对结果 |
|---|---|
| 正常代码 | 已存 development.github/github-actions 由同一生产目录恢复，逐次 credential 解析，GraphQL/REST 共用唯一出口；真实 bindRepository→重启→端口读取由 C8 覆盖 |
| 失败与恢复 | 请求入口唯一30秒预算覆盖 credential、fetch、body，并以 race 约束不合作 Promise；晚 credential 不发 fetch，晚拒绝消费；C7 十类失败安全归类、故障解除同端口可恢复 |
| 产品闭环 | 已存挂载→Host组合→Core/Controller capability/端口成立；真实 GitHub 权限、Desktop安装、绑定后重组、UI PR/CI 不是本切片完成证据，分别归 #278/#354/#356/#233/#234 |
| 架构不变量 | Planning仍唯一规划权威，工程状态不改规划轴；provider之间不互调、UI无Provider入口；句柄为唯一持久凭据事实，值只在宿主请求头，不进库/wire；Host组合身份沿谱系保留 |
| 信任边界 | 固定api.github.com、redirect:error、宿主authorization/user-agent不可覆盖；坏schema写入被拒，配置键不一致读not_found/foreign_ref且零REST；C12缩目录只内存禁用，恢复后原身份复活 |
| 测试判别 | C9/C10先红后绿；C11/C12锁定既有安全行为；最终七项变异含killedBy全KILLED、字节恢复；完整verify1843+7通过，无省略红测试 |
| 工作项与证据 | 六条commentID逐一对照如下；Completed索引改结果性表述，计划旧事实就地Superseded；TD076/079/081保留准确Open残余；#354/#356验收已登记，#278独立验证已登记，未把已关闭#335当承接 |

## 六条 commentID → 修复与验收

| commentID | 级别/根因 | 修复与判定 |
|---|---|---|
| 4344369826 | P3：回滚被写成整库失败 | 计划 Idempotence/D22 纠正为Host照常启动、未知实现挂载仅not_supported、库行保留，重新收录原身份复活。C12缩/复目录、Planning可用及三张身份表不变；PR描述精确替换稿交根会话 |
| 4344369829 | P3：D17 trailer事实过时 | D17④就地Superseded by D19，说明重整后的三提交不带trailer；当前`git log --format='%h %(trailers)' 0d8d6094..HEAD`三项为空，最终整合后仍由根回读，不补虚构署名 |
| 4344369831 | P3：索引/计划头为合并前状态 | 两处改为“经MMP评审与六条修订”的结果性表述，链接本记录；不宣称修复已远端批准或已合并 |
| 4344369836 | P2：先等凭据再建signal | `githubRequest`入口建唯一30s signal，整段工作与deadline竞速；credential后检查abort避免晚发fetch，fetch/body共用预算。C9只Development+永不settle credential仍完成，零fetch；C10覆盖晚成功/拒绝、不合作fetch/body |
| 4344369841 | P2：TD承接/TD076负例缺失 | TD079→#278独立Actions/Checks验证，TD076已补C11错key零REST、剩余owner/name同仓库由#356；TD081仅共同截止已修，探针关键路径剩余交#354。根已登记#354/#356并回读；#278验收和#355来源评论均已登记回读；人类政策comment `6333568345` 明确保留degraded只读 |
| 4344369849 | P3：D1拿未知默认拒绝支持降级 | 旧D1就地Superseded至D20，明确仅两读key的有意degraded降级；未知不等于available，无新写门，无账号/句柄仍unavailable。起草时的人类选择待答复状态 Superseded by D24（2026-10-22 13:34 SGT）：用户直接选择保留degraded只读尝试，#355 AC2与comment6333568345均已回读 |

外部登记由根完成：开发账号按基正文hash确认后写入[#356](https://github.com/SingularityKChen/harness-projects/issues/356)（2026-10-22T05:07:29Z）和[#354](https://github.com/SingularityKChen/harness-projects/issues/354)（05:07:35Z），新增验收原文已回读；本 owner读取缓存核对。#278独立Actions/Checks验证验收与#355来源说明comment6333489669已由根登记；人类确认comment `6333568345`已回读。本owner未外部写入。
不需要新承接issue：现有#278覆盖显式连接/绑定错误和独立权限证据，#356拥有一次仓库选择到全部引用payload，#354拥有重组关键路径；若后续scope必须拆分，由根按新证据决定，当前不以新issue掩盖未完成承接。

## 真实验证与变异

```text
node --test --test-name-pattern='C9|C10|C11' tests/integration/harness-plugin-host-github-catalog.test.js
# 旧实现RED: tests7/pass1/fail6；C9/C10在credential前无deadline，0!==1
node --test tests/integration/harness-plugin-host-github-catalog.test.js
# 修复GREEN: tests35/pass35/fail0
pnpm verify
# typecheck成功；tests1843/pass1843/fail0；MVP-0 tests7/pass7/fail0；exit0
```

C9/C10以真实AbortController的受控signal触发截止，不实际等待30秒；C1独立精确断言每请求一个新`AbortSignal.timeout(30_000)`且同signal交给fetch。C9验证真实SQLite/Host组合只Development时也结束，不是仅单独transport测试。
C10覆盖credential晚resolve、晚reject，fetch与body不响应signal的永不settle，超时后拒绝原请求并消费晚拒绝；C7入口已abort现在零fetch，既有映射与恢复不变。
C11经生产schema与真实绑定写者写入错配置，Host disabled=[]，调用交付端口返回false/not_found/foreign_ref，读本身零REST；组合只有DevelopmentRepository一次探针。C8两份独立夹具不证明owner/name指向同一现实GitHub仓库，此残余明确归#356。
C12将目录缩回Planning/LocalGit，Host正常启动、Planning可用、两新增挂载not_supported；三张身份表逐字保留，重新收录后恢复原身份。未采用删除挂载行的旧回滚说法。
完整verify包含安装件和package-boundaries；本轮没有重复跑另一份全量。提交后由根对精确新head重新回读CI、线程、规模/披露和issue关联，不能把工作树证据当远端绿灯。

最终变异：`node scripts/review-mutate.mjs <spec.json>`，command为上述35项Host文件；每项声明killedBy，最终整表exit0、前后基线全绿、原文字节恢复。

| ID | 删除/破坏的行为 | killedBy | 结果 |
|---|---|---|---|
| B1 | race移除deadline分支，只靠fetch signal | `C9 只挂研发` | KILLED |
| B2 | 移除credential完成后的abort检查 | `C10 凭据、fetch` | KILLED：credential-resolve导致晚fetch |
| B3 | fetch另建新的30s预算 | `C10 凭据、fetch` | KILLED：fetch/body signal不相同 |
| B4 | 30s改60s | `C1 已存研发` | KILLED：timeout参数不符 |
| B5 | 令牌放URL query | `C1 已存研发` | KILLED：URL/账本含canary |
| B6 | 有句柄直接报告available | `C1 已存研发` | KILLED：两读key伪造权限证据 |
| B7 | 无账号/句柄也degraded | `C2 权限只按账号事实` | KILLED：两个缺凭据子用例 |

首次变异运行因测试握手等待未加watchdog，在B4停住；SIGINT经runner恢复，结论作废。给测试握手加有界watchdog后最终整表重测一次，七项全KILLED；未把中断批次当成功。
本轮不重测历史60项变异，也不把历史1788+7或旧并集1859+7当新树结果。历史初审P0/P1排除证据保留，但本轮共同预算的回归由以上新证据判断。

## 当前结论与恢复

本地六条意见均有修复/准确边界，源测试已稳定；初审APPROVE与当前owner自验不能替代修复独立复评。独立reviewer及新提交门禁由根协调者处理。
#355 AC2的人类权威选择已收到（2026-10-22 13:34 SGT）：原话“保留 degraded，只读尝试（推荐）”。该选择已写入issue正文及comment `6333568345`，仅保留既有两读key降级尝试，不新增写权限或伪造available。
TD081仍Open只因组合关键路径，多挂载仍可能各耗一个有界预算；不合作的底层工作不能强制终止，但调用方等待有界且晚结果不会再发送请求。卸载中止传播整体由#338，不把本修复冒充全部生命周期hardening。
回滚本轮transport/测试不改持久数据；删目录条目仅隔离挂载，重新收录复活。代码回滚不撤销外部issue评论/验收和Project元数据，本轮未改变后者。

## 交接锁定与发布面

修复文件SHA256：`host-providers.ts`=`d2f711db18fbbaf8c48d239de56880fd10624989535f3bc5db549fef470b7f7b`；Host测试=`347f6b4196e10d03d7bbbb014cd73011900f3adc61442ef052ec7c503d2faebb`。独立复评应核对同一字节树；文档后续登记不改源/测试。
工作树对新base的规模按`git diff --numstat 0d8d6094c138b66fc50c3598d7e485528fc74168`逐文件求和并加未跟踪评审记录；观察时代码587行，文档见根整合后的机械回读，均低于800/1300任务限额。未把只扫描HEAD的size结果冒充含未提交修复。
`git diff --check` exit0；人工五类目复核本轮diff与外部草稿，未见凭据、本机路径/身份、账号个人信息、内部系统或保密字样。最终提交后的disclosure/size与PR_BODY扫描由根执行。
Git状态仅一份实现、一份Host测试、三份既有文档和本评审记录变更；其他worktree没有写入。所有临时spec/日志留在运行态目录，不写进docs作为事实源。
外部issue与PR文本的actor/目标/基正文hash已准备给根；#354/#356已由根匹配hash后登记回读，#278验证验收、#355来源说明及人类选择comment `6333568345`也已登记回读。技术修复与权限政策选择分别有独立证据；不以测试绿灯替代人类确认。

独立技术复评APPROVE（2026-10-22）：Host目录35/35，三个原生超时与迟到credential/fetch/body探针3/3，四项独立变异全KILLED、归因准确、原字节恢复；核对完整verify1843+7。当前权限行为未改；AC2后由人类直接确认，见comment `6333568345`，技术批准未代替该选择。

修复固定输入并集验证（2026-10-22 SGT）：独立临时检出 `test/repair-queue-pr388@7e5ab3d6a8093a3521a8d759c5b8a7a9507c2b52` 按#390→#389→#391→#388组合四个已独立复评的产品修复，`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` exit0，之后`CI=true pnpm verify`为1886/1886 + MVP-0 7/7、fail0。只发生索引/技术债表冲突并保留双方记录，产品blob清单SHA-256 `4e0a28e18b93b86710c70640095cf52ff7f4df92a9430574e1bb892cc1c43e90`。这不是某一PR单独head的CI，实际合并仍需当前head/base门禁与批准。

最终整合：在前三项已合并的真实`main@09dd18f0c50abd851b42d0eb3db062154b980866`变基，冲突仅为索引/债务表并保留全部记录。apps/packages/tests/scripts/workflows完整产品blob清单与1886+7通过的修复并集逐项一致，指纹`4e0a28e18b93b86710c70640095cf52ff7f4df92a9430574e1bb892cc1c43e90`；本PR两源/测试文件也与技术独立复评哈希一致。D24人类权限选择已直接收到并回读，最终head仍重新检查CI、threads与原生关闭关联#355。
