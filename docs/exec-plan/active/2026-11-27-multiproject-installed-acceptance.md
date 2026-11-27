# 多项目安装态验收包 ExecPlan

> 状态：Active
> 创建：2026-11-27
> 范围：#694 判据 5（安装态人类走查接受）的走查包与记录；docs-only，不改产品代码、不改任何已装 profile 的数据
> 上游输入：issue #694、issue #636（父项八条验收）、AGENTS.md、PLANS.md、docs/development/workflow.md、docs/development/publication.md、docs/review/README.md、docs/product/demo-install.md、docs/product/installed-core-acceptance.md、docs/exec-plan/completed/2026-11-25-multi-project-workspaces.md

## Purpose / Big Picture

完成后，仓库里有一份可由第三方独立执行的多项目安装态走查包：它把 #694 判据 5 要求的四项身份（源 SHA、packed SHA-256、安装件一致性、Host/runtime）绑定成可重放的证据链，给出人类在文档化受支持已安装 Host（固定 Web 版本 0.2.0-rc.2 + 专用 scratch profile）上创建两个项目、A→B→A 切换、重开恢复、键盘/焦点、窄宽与损坏偏好降级的九步操作与观察目标，并把人类的明确接受句与该产物 SHA、nonce 绑定，写进 docs/product/installed-core-acceptance.md 的 2026-11-27 节。

判断成功的最小证据：人类在 #694 上逐字回复一条包含 nonce 与 tarball SHA-256 的接受句；记录节从「待人类走查」改为「已接受」；停机回读该 scratch profile 恰有两行含 nonce 的 workspace、user_version=7、单行账本，且 workspace-selection.json 指向最后确认的那个项目。在此之前，记录节保持「未执行」，#694 判据 5 与父项 #636 保持 OPEN。

本计划不产生第二份工程资格结论：composed Host、packed 安装件与真实浏览器的多项目隔离/生命周期证据已由 #698 与归档计划冻结（见 docs/product/installed-core-acceptance.md 的「2026-11-26 多项目」节）；本文只承接它们明确留下的安装态人验缺口，不复制其测试、夹具或证据矩阵。

## Context and Orientation

### 术语

- **Project Workspace（项目）**：本地 workspace 行（id / name / status_policy），不是远端 GitHub Project、不是 Host profile、也不是某个视图。
- **受支持已安装 Host**：docs/product/demo-install.md 声明的固定 Harness 版本 0.2.0-rc.2 的 Web profile。该指南明确 Desktop 与真实模型调用不在其验收范围，因此本计划的合法安装态面只有这一个 profile 形态。
- **scratch profile**：用 mktemp -d 创建、由 DSH_HOME 指向的临时宿主 profile；插件数据根是 $DSH_HOME/profiles/web/harness-projects/。
- **nonce**：本次走查生成的一次性 8 位十六进制串，写进两个项目名并被人类接受句逐字引用，用来把记录绑定到唯一一次执行，防止历史记录、旧截图或另一次走查被复用。
- **安装件六件**：package.json、LICENSE、cordis.patch.yml、lib/index.js、lib/client.js、migrations/001_init.sql。清单由 apps/harness-plugin/scripts/build.mjs 的 files 字段（含单资产迁移表）决定，测试侧断言在 tests/integration/harness-plugin-artifact.test.js。

### 当前状态（事实，附重算命令）

1. 基线 main 为 f5b731a4（回读：git rev-parse origin/main）。#698 合入前的公开生产候选是 #697 head 4c666811787f24a00450389e8f0a9ff80222cb1b；两者在构建输入上无差异：git diff --exit-code 4c666811787f24a00450389e8f0a9ff80222cb1b f5b731a4 -- apps packages package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json LICENSE（2026-11-27 观察：无输出、exit 0）。
2. 2026-11-26 已验证并记录（观察时刻快照，Batch 1 重算）：packed tarball 369610 bytes、SHA-256 7895d024321816283f362403cbcad94bf0c70e06bb2e07dab34554b92bf39d99；package/lib/index.js 773521 bytes / f4af403101713d25fa7d1ffa3d4e5feba6f9a7f7d8a57e3dca2127744edd62f4；package/lib/client.js 820506 bytes / 49e36de61441e6a35c325cbbd99b388595ed7a9158279f88d3e3e33f5ab763ae。
3. 安装件 peer 为 @deepseek-ai/dsh* 的 ~0.2.0-rc.2 与 @deepseek-ai/cordis 的 ~4.0.4（apps/harness-plugin/scripts/build.mjs 的 HOST_DSH_PEER_RANGE；断言在 tests/integration/harness-plugin-artifact.test.js）。
4. 本机 Desktop 为 0.2.2-rc.5（在 peer 范围外）；其已装插件是 2026-11-12 的旧世代产物（lib/index.js 698875 bytes、lib/client.js 799066 bytes，workspace-selection.json、listWorkspaces、openWorkspace 三个多项目标记零命中），且其数据根 workspace.sqlite 为 user_version=5、schema_migrations 七行。当前安装件要求 CURRENT_SCHEMA_GENERATION=7 且单一基线账本恰好一行（packages/storage/sqlite/src/migrate.ts），会以 version_list 拒绝开库，而不是原地升级。因此 Desktop 现装 profile 不能作为本候选的安装态 Host，也不允许为走查改库。
5. 多项目能力已在安装件内：tests/integration/harness-plugin-artifact.test.js 的 packed 两项目/重开用例已覆盖装载与持久化行为；本条只作为背景，不作为人验替代。
6. 明暗主题在安装态没有产品内切换入口：宿主 0.2.0-rc.2 的主题跟随 nativeTheme.themeSource 与 prefers-color-scheme，插件面板没有切换控件；自动浏览器证据用夹具的 ?theme= 参数（tests/browser/multiproject-qualification.test.js 文件头自述）。因此人验不作主题主张。
7. 安装态插件没有 URL/route 深链入口（docs/exec-plan/completed/2026-11-25-multi-project-workspaces.md 的 Design 第 9 条）。因此人验不作深链主张。
8. 未连接规划的项目摘要页没有「项目」按钮：从项目页回 Projects Home 的现实路径是页头「连接设置」→ 页头「项目」（packages/ui/src/workspace-setup.ts 的 pane 分支）。步骤表按真实控件写，避免人类在客户端里找不到入口。

### 相关文件

- 交付物：docs/exec-plan/active/2026-11-27-multiproject-installed-acceptance.md（本文件）、docs/product/installed-core-acceptance.md（追加一节）、docs/product/demo-install.md（追加指针）、docs/README.md（Active 索引一行）。
- 只读依据：apps/harness-plugin/scripts/build.mjs、apps/harness-plugin/src/host.ts、packages/storage/sqlite/src/migrate.ts、packages/ui/src/projects-home.ts、packages/ui/src/workspace-setup.ts、packages/ui-model/src/workspace-setup.ts、tests/integration/harness-plugin-artifact.test.js、tests/browser/multiproject-qualification.test.js。
- 上游证据：docs/exec-plan/completed/2026-11-25-multi-project-workspaces.md、docs/product/installed-core-acceptance.md 的「2026-11-26」节、issue #694 判据 5 原文、issue #636 第 8 条验收组原文。

## Design / Spec

### 交付形态：docs-only（否决新增契约守卫）

两种候选形态：A 只交付文档验收包；B 在 A 之上新增约 60 行契约测试，断言验收记录必须含操作者/日期/身份且不含本机绝对路径与图片。结论采纳 A，理由按证据排序：

1. 仓库唯一同类的机械文档守卫是 tests/contract/plan-facts-consistency.test.js；它成立的前提写在文件头：三条规则「第三轮与第四轮各复发过一次」，且三条都可由文档内容机械判定（字面关闭关键字、体量基线写成值、悬空 docs 路径）。安装态验收记录的主要失效模式是「人类是否真的执行并接受」，任何结构断言只能判定字段是否出现，无法判定其真伪；伪造的记录同样能通过，属假保证。
2. issue #694 的 Notes 明确禁止新增固定变异/计数配额与「新的通用检查」，并声明工程证据由 #698 承接；新增测试会把 docs-only 交付变成代码面变更，需要自己的判别用例与负控，正是要避免的范围膨胀。
3. 现有可比记录 docs/product/installed-core-acceptance.md（311 行、多次人工接受）没有任何测试守卫其结构，仓库的既有手段是人工五类目检查加 rule-checks 机械扫描；本计划沿用这一手段（见 Batch 2 与 I7）。
4. 若该失效模式将来在同处真的复现一次，再按 plan-facts-consistency.test.js 的模板补发现规则 + 下限断言 + 负控；那时才有可复现的判别对象。

同时否决另外两种形态：新增身份校验脚本（身份链已由 git diff、pack、shasum、sqlite3 回读四类命令表达，脚本会成为第二条会漂移的事实来源，并增加代码面）；复用 2026-11-12 的旧安装件或把新包装进 Desktop 真实 profile（见 Context 第 4 条，会撞数据库硬拒绝并污染人类真实数据）。

### 记录结构与取值来源

记录节只写两类内容：协议与身份（可由命令重放），以及人类实际观察（只能由人类提供）。字段与取值来源如下，禁止把它们写成静态占位符：

| 字段 | 取值来源 / 回读命令 | 期望 |
|---|---|---|
| 操作者 | 人类本人；记录其回复所在 issue 评论 URL | 评论来自人类账号，正文含接受句 |
| 走查日期 | 执行当日 SGT：date '+%F %H:%M %Z' | 与本计划写入日不同的实际日期 |
| nonce | P1 的 openssl rand -hex 4 输出 | 8 位十六进制，同时出现在两个项目名里 |
| 候选源 | 在检出 test/mp-installed-acceptance 的工作树根运行 git rev-parse HEAD | f5b731a4 的完整 SHA |
| 生产输入等价 | Context 第 1 条的 git diff --exit-code 命令 | 无输出、exit 0 |
| tarball 身份 | wc -c 与 shasum -a 256（观察时刻快照，重算命令见 Batch 1） | 369610 与 7895d024 开头的完整 SHA-256 |
| 两个 lib 身份 | 从 tgz 解出 package/lib/index.js 与 package/lib/client.js 后 wc -c、shasum -a 256 | 773521/f4af4031…、820506/49e36de6… |
| 安装件一致性 | 六件逐字节比对（Batch 1 的命令） | 六行 match、零 MISMATCH |
| Host/runtime | npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh --version；node --version；宿主 stdout 的 [harness-projects] host ready 行 | 0.2.0-rc.2；Node 主版本 26；就绪行出现 |
| 前置状态 | 停机后 sqlite3 -readonly 回读（Batch 1 的命令） | user_version=7、ledger=1:1、workspaces=0 |
| 事后状态 | 停机后同一回读命令 + workspace-selection.json 读取 | workspaces=2 且两名称含 nonce；selection.workspaceId 等于最后确认项目 id |
| 步骤结果 | H1–H9 每步「通过/未通过/未执行」与偏差原文 | 不出现「大致正常」「基本可用」这类无判别力描述 |
| 人类接受句 | 逐字引用人类回复 | 必含 nonce 与 tarball SHA-256；若人类另加范围限定，一并逐字记录 |
| 未主张清单 | 本文件「本轮明确不主张」 | 与记录节正文一致，不省略 |

记录节的状态行只有两种合法取值：写入时为「截至本节写入，人类走查尚未执行；#694 判据 5 与 #636 保持 OPEN」；人类明确接受后改为「已执行并获人类明确接受（日期、评论 URL）」。不允许第三种表述，也不允许在未接受时写成「已基本完成」。

### nonce 与前后状态协议（P1–P7）

P1 生成 nonce：在协调者终端运行 openssl rand -hex 4，输出 8 位十六进制；把它同时写进两个项目名：验收A-<nonce>、验收B-<nonce>。nonce 与两个项目名在人类接受前只存在于运行态记录（临时目录或会话内），不接受前不写进 docs。

P2 安装：在与收到 tgz 相同的终端会话内导出四个变量（HP_DEMO_ARTIFACT、HP_DEMO_SCRATCH、DSH_HOME、DSH_TELEMETRY_DISABLED），按 docs/product/demo-install.md 的固定 Web 流程 add 安装件。整个流程不写 HOME、不改全局工具、不使用版本豁免参数。

P3 启动：按同一指南生成 documents overlay，dump-config 核对 workspace-controller.config.documentsDirectory 等于 scratch 的 documents 目录，再以 dsh web --patch … --no-open --port 0 启动。只在本机浏览器打开终端给出的会话地址；该地址含访问材料，不写进任何记录。

P4 前置回读（停机）：退出宿主进程后，对 $DSH_HOME/profiles/web/harness-projects/workspace.sqlite 以 sqlite3 -readonly 回读 user_version、账本与 workspace 行数。期望 user_version=7、ledger=1:1、workspaces=0。此时数据库已由首次加载建立，不是「库不存在」。

P5 人类走查：人类执行下面 H1–H9（可选 A1），逐步给出结果。协调者不代替人类点击、不代替人类确认视觉与焦点状态。

P6 事后回读（停机）：再次退出宿主进程，回读同一数据库与 workspace-selection.json。期望 workspaces=2、两行名称都含本次 nonce、创建序为先 A 后 B、selection.workspaceId 等于最后确认项目（H9 结束时为 A）的 id，confirmedAt 为合法 ISO-8601。若出现第三行、账本多行或 selection 指向不存在的 id，判 I6 不通过，记录失败而不修库。

P7 人类接受句：人类在 #694 给出明确回复，内容至少包含「我已完成多项目安装态走查 H1–H9」「nonce 为 …」「tarball SHA-256 为 …」以及对未主张范围的确认。协调者逐字引用并附评论 URL。

非零成本或不可逆动作一律不做：不删真实数据、不改 user_version、不模拟人类观察、不做真实 GitHub 写入、不配置真实模型凭据。

### 人类走查步骤 H1–H9

步骤按文档化 profile 上真实可达的控件写；每步的「未出现或不同时记录」列要求人类在异常时写下实际所见，而不是只写「不正常」。

| 步骤 | 操作（人类） | 目标观察 | 未出现或不同时记录 |
|---|---|---|---|
| H1 | 打开侧栏 Harness Projects，在空 profile 的创建表单输入项目名 验收A-<nonce>，提交。 | 进入「连接设置」页并显示「当前工作区：验收A-<nonce>」；页头有「项目」「返回工作区」；没有别的项目名混入。 | 表单结果、实际错误文案、是否留下半成品项目。 |
| H2 | 点页头「项目」进入 Projects Home。 | Home 标题「项目」；列表恰一行 验收A-<nonce>，该行按钮是「返回项目」；「创建工作区」可用。 | 实际行数、按钮文案、空态或错误提示。 |
| H3 | 点「创建工作区」，输入 验收B-<nonce>，提交。 | 进入「连接设置」并显示「当前工作区：验收B-<nonce>」。 | 是否复用旧草稿、实际错误、是否仍需连接规划才能创建。 |
| H4 | 点页头「项目」回到 Home。 | 两行都在且按创建序为 A 在前、B 在后；B 行按钮「返回项目」，A 行「打开」；无行处于永久 pending。 | 实际顺序、活动行标记、pending 或错误状态。 |
| H5 | 点 A 行「打开」切回 A。 | 项目页页头「工作区」；进「连接设置」读到「当前工作区：验收A-<nonce>」，页面与设置里不出现 验收B-<nonce>；再回 Home 时 A 行「返回项目」、B 行「打开」。 | 是否残留 B 的名称/上下文、切换耗时、失败提示。 |
| H6 | 只用键盘：在 Home 用 Tab/Shift+Tab 移动焦点到行按钮并按 Enter；在项目页用 Tab 到「连接设置」按 Enter，再用 Tab 到「项目」按 Enter 回 Home；最后用键盘 Enter 打开 B。 | 每一步都有可见焦点环，Enter 激活的是当前聚焦控件，回 Home 后焦点落在合理控件（不是页面外或不可见元素）；最终活动项目为 B（Home 中 B 行「返回项目」）。 | 焦点是否可见、是否丢失、是否跳到无关控件；记录实际按键序列与结果。 |
| H7 | 把浏览器窗口缩到内容宽约 640 CSS px（可用浏览器响应式模式设定 640）。 | Home 两行与项目页页头都不出现整页横向滚动；按钮仍可点击、行内文字不被截断到不可读。记录实际达到的宽度。 | 是否出现横向滚动、重叠、截断或不可点击；若浏览器不允许更窄，记录实际最窄宽度，不推算未测宽度。 |
| H8 | 在终端 Ctrl+C 停止宿主，用同一 DSH_HOME、同一 --patch 重新启动并打开页面。 | 自动回到最后确认项目 B（显示「当前工作区：验收B-<nonce>」），Home 两行仍在，不出现空 profile 创建表单。 | 实际落地页面、恢复成空态/另一项目/报错的情况。 |
| H9 | 停止宿主；把 $DSH_HOME/profiles/web/harness-projects/workspace-selection.json 覆盖为非法 JSON（单个左花括号即可）；重启。 | 落在 Home 并显示「上次打开的项目记录已损坏，请选择项目。」；两行仍在；没有静默打开任何项目。随后点 A 行「打开」，A 正常打开；再停止并重启，自动恢复 A（最后确认）。 | 实际提示文案、是否静默打开别的项目、恢复后 selection 是否可写回。 |
| A1（可选，不计入接受句） | 在 A 的「连接设置」里输入任意 Project node ID 并提交，观察来源/凭据不可用时的提示与可重试入口。 | 有明确任务结果与恢复入口；失败不产生部分绑定。 | 实际错误分类与入口；不得输入真实 token，不连接真实来源。 |

### 本轮明确不主张

以下各项即使自动证据丰富，也不得写成人验接受：

- **工作项行、读写隔离、执行归属**：scratch profile 不连接真实规划来源，项目里没有工作项，人验无法观察行隔离；这些由 2026-11-26 节的 composed/packed 证据覆盖，不得冒充人验。
- **明暗主题**：安装态无产品内主题切换入口（Context 第 6 条）；自动证据用夹具的 ?theme= 参数。
- **深链**：安装态插件无 URL/route 入口（Context 第 7 条）。
- **真实凭据下的 denied/offline/权限否定**：需要真实账号或撤权操作；沿用 #450/#451/#457 与 2026-11-26 节的生产组合证据。A1 若执行，只能记为「凭据/来源不可用的结构化拒绝」，不能写成权限否定。
- **Windows11 Desktop（#647）、R1（#459/#73）、看板 Status**：全部独立，不因本计划通过而推进。

### 关闭语义

- 人类明确接受 + 记录节回填 + I1–I7 全部通过 → 才允许勾 #694 判据 5；是否让 PR 的 closingIssuesReferences 包含 #694，由人类在该次回复里明确指示，回读命令见 Batch 4。
- 未执行、任一步未通过、或人类只给出模糊回复 → 判据 5 保持未勾、#694 与 #636 保持 OPEN，PR 用 Refs；记录节写明缺哪一步。
- 父项 #636 的完整接受另需其八条验收组全部证据，不因 #694 关闭自动获准；#694 关闭也不等于 R1、#647 或看板 Status 接受。
- 计划自身的归档（移入 docs/exec-plan/completed/）只在 Batch 3 与 Batch 4 完成后进行；若人验长期不可用，计划保持 Active 并在 Progress 标注阻塞原因，不静默归档。

### 文件级 diff 估算

| 文件 | 变更类型 | 估算行 |
|---|---|---|
| docs/exec-plan/active/2026-11-27-multiproject-installed-acceptance.md | 新增 | +391 / -0 |
| docs/product/installed-core-acceptance.md | 追加一节（状态行、身份表、P1–P7、H1–H9、不主张、关闭语义） | +115 / -2 |
| docs/product/demo-install.md | 验收记录边界追加一行指针 | +3 / -1 |
| docs/README.md | Active 索引表追加一行 | +1 / -0 |
| 合计 | 文档 0 代码 | 约 +510 / -3，合计约 513 行；代码 0 行 |

硬上限：文档新增+删除 ≤1300 行、代码 ≤800 行。本估算约为文档上限的 40%，不含为凑数而写的重复台账。

## Global Constraints

- 唯一写入文件集合（一个事实只写一处）：docs/exec-plan/active/2026-11-27-multiproject-installed-acceptance.md、docs/product/installed-core-acceptance.md、docs/product/demo-install.md、docs/README.md。不新增其他文件；不修改 apps/、packages/、tests/、scripts/、.github/、package.json、锁文件。
- 规模：文档新增+删除 ≤1300 行；代码 0 行。不新增脚本、测试、契约守卫、依赖、workflow 或夹具。
- 数据边界：不把当前安装件装进人类 Desktop 真实 profile；不写、不迁移、不修复、不删除任何真实数据库；不修改 PRAGMA user_version；scope 之外的真实凭据、模型会话、GitHub 写入一律不做。
- 发布面：文档与提交不得含本机绝对路径、会话访问地址、token/凭据、账号个人信息、截图或图片；证据用仓库内相对路径与可重放命令（AGENTS.md §3、§7 与 docs/development/publication.md）。
- 接受真实性：人类接受只能来自人类本人的明确回复；没有回复就保持 OPEN；不得用工程测试、夹具截图、历史安装记录或协调者观察冒充人类接受。
- 关闭与状态：不加原生 blocked-by、不写看板 Status、不自行合并；#694/#636 的关闭语义见 Design 的关闭语义节；PR 引用语义以 closingIssuesReferences 回读为准。
- 不重复 #698：不重跑或复制其多项目自动化矩阵作为本计划证据；需要引用时只引用归档计划与 2026-11-26 节。
- 范围外一律不作主张：主题、深链、真实凭据 denied/offline、Windows11 Desktop（#647）、R1（#459/#73）、看板 Status。

## Plan of Work

### Batch 1 · 身份链重放与安装件证据

**最小闭环**：从基线 main 的同一生产输入重放打包，得到与 2026-11-26 记录一致的 tarball 与两个 lib 的字节/摘要；在干净 scratch profile 里装出六件逐字节一致的安装件，并拿到 host ready 与前置状态回读。

**涉及文件**：无仓库文件变更（产物落 apps/harness-plugin/dist/，被 .gitignore 忽略；scratch profile 落临时目录）。证据回填到 Batch 2 的文档节与 Progress。

**步骤**

1. 在检出 test/mp-installed-acceptance 的工作树 .worktrees/mp-installed-acceptance 根目录确认基线与生产输入等价（见下方验证命令第 1–2 行）。
2. 运行 pnpm install --frozen-lockfile（该工作树没有 node_modules）。
3. 运行 pack:plugin 重放打包，解出 tgz 计算 tarball 与两个 lib 的字节数和 SHA-256。
4. 用 mktemp -d 建 scratch 根，导出 HP_DEMO_ARTIFACT、HP_DEMO_SCRATCH、DSH_HOME、DSH_TELEMETRY_DISABLED，按 docs/product/demo-install.md 安装并启动；只记录 [harness-projects] host ready 行，不记录会话地址。
5. 比对安装目录六件与 tgz 解出树的 sha256。
6. 退出宿主进程，按 P4 回读前置状态。
7. 把观察到的身份值（含观察时刻）写进 Batch 2 的记录节；若重放结果与 2026-11-26 记录不一致，判 I2 不通过并写入 Surprises & Discoveries，禁止静默改用新值后继续。

**验证**（在检出 test/mp-installed-acceptance 的工作树根运行；命令在同一 shell 会话内按顺序执行）

    git rev-parse HEAD
    git diff --exit-code 4c666811787f24a00450389e8f0a9ff80222cb1b f5b731a4 -- apps packages package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json LICENSE

期望：第一行输出 f5b731a4b695cb6cf61070cfbd1746fc05f0639d；第二行无输出、exit 0。

    pnpm install --frozen-lockfile
    pnpm --filter @harness-projects/app-harness-plugin pack:plugin
    ART=apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.1.0-demo.1.tgz
    wc -c "$ART"; shasum -a 256 "$ART"
    TMP=$(mktemp -d); tar -xzf "$ART" -C "$TMP"
    wc -c "$TMP/package/lib/index.js" "$TMP/package/lib/client.js"
    shasum -a 256 "$TMP/package/lib/index.js" "$TMP/package/lib/client.js"

期望：369610 与 7895d024321816283f362403cbcad94bf0c70e06bb2e07dab34554b92bf39d99；773521 与 f4af403101713d25fa7d1ffa3d4e5feba6f9a7f7d8a57e3dca2127744edd62f4；820506 与 49e36de61441e6a35c325cbbd99b388595ed7a9158279f88d3e3e33f5ab763ae。

    export HP_DEMO_ARTIFACT="$(realpath "$ART")"
    export HP_DEMO_SCRATCH="$(mktemp -d -t hp-mp-accept)"
    export DSH_HOME="$HP_DEMO_SCRATCH/dsh"
    export DSH_TELEMETRY_DISABLED=1
    npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh --version
    npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile web add "$HP_DEMO_ARTIFACT"

期望：版本输出 0.2.0-rc.2；add 成功退出。

    INST="$DSH_HOME/profiles/web/node_modules/@harness-projects/app-harness-plugin"
    for f in package.json LICENSE cordis.patch.yml lib/index.js lib/client.js migrations/001_init.sql; do
      a=$(shasum -a 256 "$TMP/package/$f" | awk '{print $1}')
      b=$(shasum -a 256 "$INST/$f" | awk '{print $1}')
      [ "$a" = "$b" ] && echo "match $f" || echo "MISMATCH $f"
    done

期望：六行 match，零 MISMATCH。

    DB="$DSH_HOME/profiles/web/harness-projects/workspace.sqlite"
    sqlite3 -readonly "$DB" "select 'user_version=' || (select * from pragma_user_version); select 'ledger=' || count(*) || ':' || group_concat(version, ',') from schema_migrations; select 'workspaces=' || count(*) from workspace;"

期望（宿主进程已退出后）：user_version=7、ledger=1:1、workspaces=0。

**回滚**：删除 scratch 根（rm -rf "$HP_DEMO_SCRATCH"）与解出目录（rm -rf "$TMP"）；apps/harness-plugin/dist/ 被忽略且可重建。无仓库变更需要回滚。

### Batch 2 · 验收包文档交付

**最小闭环**：在 docs/product/installed-core-acceptance.md 追加 2026-11-27 节（状态行、为什么是固定 Web profile、身份表与重算命令、P1–P7、H1–H9、不主张清单、关闭语义），在 docs/product/demo-install.md 的验收记录边界加一行指针，在 docs/README.md 的 Active 索引加一行；此时状态行必须是「尚未执行」，未执行的部分如实保留。

**涉及文件**：见 Global Constraints 的唯一文件集合；本批改写其中三项（本计划已在创建时写入）。

**步骤**

1. 追加记录节，锚点标题固定为「## 2026-11-27 多项目安装态验收包（#694 判据 5）」，正文按 Design 的记录结构写；身份值用 Batch 1 的观察时刻快照，并同时给出重算命令。
2. 写入 P1–P7 与 H1–H9 表，保留「未出现或不同时记录」列。
3. 写入「本轮明确不主张」清单与「关闭语义」，逐条对应 #694 判据 5 与 #636 第 8 条验收组。
4. demo-install.md 的验收记录边界末尾追加一行指针（链接到记录文件），不复制协议内容。
5. docs/README.md 的 Active 表追加一行：计划名 + 一句话用途（含「人验待执行；#694/#636 保持 OPEN」）。
6. 自查：不改动其他章节；同一事实只在一处写（文件集合只在 Global Constraints）。

**验证**（在检出 test/mp-installed-acceptance 的工作树根运行）

两个 rule-checks 子命令按提交判定；2026-11-27 实测：工作树里未提交的改动会被计成「代码 0 行 / 文档 0 行」，所以本批必须先提交（提交信息也进入发布面扫描），再对 HEAD 跑门。

    git add docs/README.md docs/product/installed-core-acceptance.md docs/product/demo-install.md docs/exec-plan/active/2026-11-27-multiproject-installed-acceptance.md
    git commit -m "docs(product): 交付多项目安装态验收包与记录节"
    node scripts/rule-checks.mjs size origin/main HEAD
    node scripts/rule-checks.mjs disclosure origin/main HEAD
    git diff --check origin/main...HEAD
    grep -nE 'Users/|/var/folders/|file:///|Authorization|Bearer ' docs/product/installed-core-acceptance.md docs/product/demo-install.md docs/README.md docs/exec-plan/active/2026-11-27-multiproject-installed-acceptance.md
    grep -c '![' docs/product/installed-core-acceptance.md
    for p in docs/product/installed-core-acceptance.md docs/product/demo-install.md docs/exec-plan/completed/2026-11-25-multi-project-workspaces.md docs/review/README.md; do test -f "$p" || echo "MISSING $p"; done

期望：size 首行打印判定对象，文档行数在 1300 内且代码行数为 0；disclosure 无命中、exit 0；diff --check 无输出；绝对路径/凭据 grep 无匹配（grep exit 1 是期望结果）；图片计数为 0；无 MISSING 行。
若 grep 出现命中，改成仓库内相对路径或删除该证据后再跑一次；不得用打码掩盖仍未脱敏的本机路径。

**回滚**：git revert 本批提交；三处文档改动相互独立，可只回滚记录节而保留索引行修正（保守做法是整批回滚）。

### Batch 3 · 人类走查执行与记录回填（人类门）

**最小闭环**：人类在 P2–P4 准备好的 scratch profile 上执行 H1–H9（可选 A1），给出逐字接受句；协调者执行 P6 事后回读并把实际观察、接受句、前后状态回填进 2026-11-27 节，状态行改为「已执行并获人类明确接受」。

**涉及文件**：docs/product/installed-core-acceptance.md（2026-11-27 节的状态行、实际记录子节）。其余文件不动。

**步骤**

1. 协调者确认 Batch 1 的 scratch profile 仍可用（同一 DSH_HOME），把 H1–H9 原文交给人类执行。
2. 人类逐步回复；任一步未通过时先记录实际所见，再判断是环境问题、产品缺陷还是理解偏差，不修改记录成「通过」。
3. 人类给出接受句，至少包含 H1–H9、nonce、tarball SHA-256；如有范围限定（例如未做 A1、未做主题），一并逐字记录。
4. 协调者停机执行 P6 回读，把输出值填进「事后状态」行，并引用人类评论 URL。
5. 状态行改为「已执行并获人类明确接受（日期、评论 URL）」；若人类只接受部分步骤，状态行相应写明覆盖范围，判据 5 保持未勾。
6. 更新 Progress 与 Surprises（人类发现与自动化证据不一致的地方必须记录）。

**验证**（人类回复后，在检出 test/mp-installed-acceptance 的工作树根运行；需宿主进程已退出）

    DB="$DSH_HOME/profiles/web/harness-projects/workspace.sqlite"
    sqlite3 -readonly "$DB" "select 'user_version=' || (select * from pragma_user_version); select 'ledger=' || count(*) || ':' || group_concat(version, ',') from schema_migrations; select 'workspaces=' || count(*) from workspace; select id || ' ' || name from workspace order by rowid;"
    node -e "const j=require(process.env.DSH_HOME+'/profiles/web/harness-projects/workspace-selection.json'); console.log('version='+j.version,'workspaceId='+j.workspaceId,'confirmedAt='+j.confirmedAt)"

期望：user_version=7；ledger=1:1；workspaces=2；两行名称按创建序为先 A 后 B 且都含本次 nonce；selection.version=1、workspaceId 等于 A 的 id、confirmedAt 为合法 ISO-8601。
另需回读人类回复：gh issue view 694 -R SingularityKChen/harness-projects --json comments 后确认接受句来自人类账号且含 nonce 与 SHA。

**回滚**：记录节与 Progress 可回滚到 Batch 2 的「未执行」状态；scratch profile 直接删除，不影响人类任何真实 profile 或仓库数据。

### Batch 4 · 关闭语义与发布门

**最小闭环**：按人类明确指令决定 PR 引用语义；跑发布面、体量与回读门；决定归档或保持 Active。

**涉及文件**：docs/product/installed-core-acceptance.md（若需订正）、docs/README.md（归档时把 Active 行移到 Completed 并改一句用途）；不新增文件。

**步骤**

1. 回读 #694 与 #636 的当前状态与人类的接受评论；据此决定是否勾 #694 判据 5。
2. 决定 PR 引用语义：未获接受用 Refs；获接受且人类明确指示时，由人类确认后让 PR 的 closingIssuesReferences 包含 #694，并用回读命令确认，不手写关闭结论。
3. 跑发布面与体量检查；复核记录节无本机路径、无图片、无会话地址；复核 diff 只含 Global Constraints 声明的文件。
4. 交人类评审 PR；agent 不自行合并，不写看板 Status，不写原生依赖。
5. 全部完成后把本计划移入 docs/exec-plan/completed/ 并在 docs/README.md 更新索引，同时把 docs/product/installed-core-acceptance.md 的 2026-11-27 节指向本计划的相对链接改到 completed/ 路径；否则保持 Active 并在 Progress 写明阻塞原因。

**验证**（在检出 test/mp-installed-acceptance 的工作树根运行；gh 命令带 -R）

    gh issue view 694 -R SingularityKChen/harness-projects --json number,state,title
    gh pr view <PR 编号> -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,mergeStateStatus,closingIssuesReferences
    gh pr checks <PR 编号> -R SingularityKChen/harness-projects
    node scripts/rule-checks.mjs disclosure origin/main HEAD
    node scripts/rule-checks.mjs size origin/main HEAD

期望：#694 的状态与记录节一致（未接受时 OPEN）；PR base 为 main、draft 状态与阶段一致；closingIssuesReferences 与人类指令一致（未接受时不含 #694）；checks 只报告实际跑过的检查且全 pass；disclosure 无命中；size 在限内。

**回滚**：revert 文档提交；如果 PR 已加关闭引用但人类撤回接受，先改回 Refs 并回读确认，再关闭/重开计划状态；不改 issue 的既有评论，不删除人类回复。

## Validation and Acceptance

证据门按顺序判定，任一门不通过即本计划不完成：

| 门 | 性质 | 判定证据 | 不通过时 |
|---|---|---|---|
| I1 源与生产输入身份 | 可由命令复现 | Batch 1 第 1–2 行命令：HEAD 为 f5b731a4，diff --exit-code 无输出 | 停止后续批次，先查基线是否被移动 |
| I2 产物身份重放 | 可失败 | Batch 1 的 tarball 与两 lib 字节/摘要等于 2026-11-26 记录值 | 写入 Surprises，禁止静默改用新值；记录节不得引用旧值 |
| I3 安装件身份 | 可失败 | 六件 match、零 MISMATCH；dsh --version 为 0.2.0-rc.2；stdout 有 [harness-projects] host ready | 停止人验；先判断是安装流程还是产物问题 |
| I4 前置状态 | 可失败 | 停机回读 user_version=7、ledger=1:1、workspaces=0 | 说明 scratch 被污染或未真正隔离，重建再试 |
| I5 人类步骤证据 | 只能由人类提供 | H1–H9 每步明确结果 + 接受句含 nonce 与 SHA + 评论 URL | 判据 5 不勾，记录缺失步骤 |
| I6 事后状态 | 可失败 | 停机回读 workspaces=2 且两名称含 nonce、selection 指向最后确认项目 | 记录失败，不修库、不改记录成通过 |
| I7 发布面与体量 | 机械检查 | 提交后对 HEAD 运行 disclosure/size：无命中、在限内；diff --check 干净；无图片/绝对路径；gh 回读与记录一致 | 修文档后重跑，不带病 push |

判别力（负向验证）：把 scratch profile 换成已装 Desktop profile 会在 I4 撞 version_list 拒绝；把记录里的接受句换成协调者自述会在 I5 失败；把 tarball 换成另一次 pack 的结果会在 I2 失败；在记录节写入本机路径或截图会在 I7 失败。四类都能真实变红，才算这些门有判别力。

复用而非重复：不新增测试。工程侧证据继续引用 docs/product/installed-core-acceptance.md 的 2026-11-26 节与 docs/exec-plan/completed/2026-11-25-multi-project-workspaces.md；人工侧证据只来自 #694 的人类回复。

## Progress

- [x] (2026-11-27 15:53 SGT) 创建本 ExecPlan：完成身份/可行性核实、交付形态收敛与批次设计；写入 docs/exec-plan/active/ 与 docs/README.md 的 Active 索引。
- [x] (2026-11-27 16:03 SGT) Batch 1 · 身份链重放与安装件证据：在检出 `test/mp-installed-acceptance` 的工作树 `.worktrees/mp-installed-acceptance` 根目录完成。工作树 HEAD `f25d887b2c4a229bceb09e21d6e1d17eaf26a60d`（`origin/main` 仍为 `f5b731a4b695cb6cf61070cfbd1746fc05f0639d`）；相对 #697 final head `4c666811787f24a00450389e8f0a9ff80222cb1b` 的 `git diff --exit-code` 分别从 `f5b731a4` 与 HEAD 各跑一次，均无输出（I1 通过）。`pnpm install --frozen-lockfile` 后重放 `pack:plugin`：tarball 369610 bytes / `7895d024…`，`lib/index.js` 773521 / `f4af4031…`，`lib/client.js` 820506 / `49e36de6…`，与 2026-11-26 记录逐项一致（I2 通过）。scratch `DSH_HOME` 内 `dsh --version` 为 `0.2.0-rc.2`，六件 SHA-256 全 match 且 `diff -r` 零差异，宿主 stdout 出现 `[harness-projects] host ready`（I3 通过）；停机后 `/usr/bin/sqlite3 -readonly` 回读 `user_version=7`、`ledger=1:1`、`workspaces=0`（I4 通过）。观察值已回填 docs/product/installed-core-acceptance.md 的 2026-11-27 节。
- [x] (2026-11-27 16:03 SGT) Batch 2 · 验收包文档交付：docs/product/installed-core-acceptance.md 追加「2026-11-27 多项目安装态验收包（#694 判据 5）」节（+112 行：状态行「人类走查尚未执行」、为什么只用固定 Web profile、身份表与重放命令、前置回读命令、P1–P7、H1–H9、本轮明确不主张、关闭语义）；docs/product/demo-install.md 的「验收记录边界」末尾追加一行指针（+2 行，不复制协议）；docs/README.md 的 Active 索引行自查与计划文件一致，无需改动。本节不含人类接受结论。
- [ ] Batch 3 · 人类走查执行与记录回填（阻塞于人类可用时间）
- [ ] Batch 4 · 关闭语义与发布门（依赖 Batch 3 的人类答复）

## Surprises & Discoveries

- 2026-11-27：本机 Desktop 数据根 workspace.sqlite 是 user_version=5 但 schema_migrations 七行；当前安装件的准入同时要求单一基线账本（恰好一行、值为 1）与 CURRENT_SCHEMA_GENERATION=7（packages/storage/sqlite/src/migrate.ts），因此会以 version_list 拒绝。结论：任何「装进 Desktop 现装 profile 凑个人验」的方案都会在开库前失败，且修复只能靠显式迁移或空位重建，均超出本计划授权。
- 2026-11-27：本机已装 Desktop 插件是 2026-11-12 的产物（lib/index.js 698875 bytes、lib/client.js 799066 bytes），workspace-selection.json、listWorkspaces、openWorkspace 三个多项目标记零命中；它不是当前安装件，不能作为候选身份。
- 2026-11-27：本机 npx 缓存已含 @deepseek-ai/dsh 0.2.0-rc.2（两处缓存目录，版本一致），因此安装步骤在本机可复用缓存；首次解析仍可能需要 registry 访问（见 Interfaces and Dependencies）。
- 2026-11-27：宿主 Web 0.2.0-rc.2 没有产品内主题切换控件，主题跟随 nativeTheme.themeSource 与 prefers-color-scheme；插件的明暗可读性自动证据入口是夹具的 ?theme= 参数。因此人验不得声称「切换过主题」。
- 2026-11-27：未连接规划的项目摘要页没有「项目」按钮；回 Projects Home 的现实路径是页头「连接设置」→ 页头「项目」。若按直觉写「点项目返回」，人类会卡住，故 H 步骤按实际控件写。
- 2026-11-27：目标工作树 .worktrees/mp-installed-acceptance 没有 node_modules，Batch 1 必须先 pnpm install --frozen-lockfile；不能假设工作树可直接跑 pnpm 脚本。
- 2026-11-27：/usr/bin/sqlite3 为 3.54.0，支持 -readonly 与 pragma_user_version，前后状态回读不需要新增脚本或写库代码。
- 2026-11-27：docs/exec-plan/active/ 创建前只有 2026-09-29 计划与 README，Active 索引表只有一行；新增计划必须同时补索引行，否则文档地图与实际计划不一致。
- 2026-11-27：scripts/rule-checks.mjs 的 size 与 disclosure 按提交判定；工作树里未提交的改动会被计成「代码 0 行 / 文档 0 行」（实测）。因此机械门必须在批次提交之后对 HEAD 运行（或把本地提交作为第二个参数传入），不能拿脏工作树当通过证据。
- 2026-11-27：Batch 1 重放时工作树 HEAD 是 `f25d887b`（本计划自身的文档提交），不是 Context 第 1 条写的 `f5b731a4`；计划里 `git rev-parse HEAD` 的期望值写于该提交之前。因此 I1 以两次 `git diff --exit-code`（`4c666811` 到 `f5b731a4`、到 HEAD）均无输出来判定，生产输入等价成立，`f5b731a4` 仍是 `origin/main`。
- 2026-11-27：`pnpm install --frozen-lockfile` 打印 `Ignored build scripts: esbuild@0.28.2` 警告，但重放得到的 tarball 与两个 lib 的字节/摘要与 2026-11-26 完全一致；该 postinstall 不是本构建的输入，不需要 `pnpm approve-builds`。
- 2026-11-27：`dsh plugin --profile web add` 内部使用 dsh 自带的 pnpm 12.21.0 并打印 peer 依赖警告；该 profile 的 `node_modules` 只有插件本身（peer 由宿主提供），安装成功且六件逐字节一致。
- 2026-11-27：协调者会话环境继承了 `DSH_PROFILE=desktop`，但 `dsh web` 仍只初始化 `$DSH_HOME/profiles/web`（scratch 下仅有 web 一个 profile，插件数据根与库都在其下）；该继承变量没有把宿主重定向到 desktop profile，也没有触碰任何真实 profile。
- 2026-11-27：首次加载后 scratch profile 内 `workspace-selection.json` 与 `diagnostics.log` 都是 0 字节文件；H9 的「覆盖为非法 JSON」在 Batch 3 可直接作用于该文件，不需要先创建。
- 2026-11-27：同机正在运行的 DSH Desktop app 会在走查窗口内继续写它自己的真实 profile（该库 mtime 在会话期间前移）。本批所有 dsh 调用都显式 `DSH_HOME=$HP_DEMO_SCRATCH/dsh`，没有命令指向真实 profile；因此该写入不属于本批证据，也不能用来证明隔离或污染。

## Decision Log

- Decision：交付形态采纳 docs-only，不新增契约守卫或身份校验脚本。
  Rationale：同类守卫的成立前提是可机械判定的性质与已复发的失效（tests/contract/plan-facts-consistency.test.js 文件头自述）；验收记录的真伪无法由结构断言判定，且 #694 Notes 禁止新增固定配额/通用检查，工程证据由 #698 承接。守卫留待同处真的复发时再补。
  Date/Author：2026-11-27 15:52 SGT / review694-plan
- Decision：安装态 Host 选固定 Web 0.2.0-rc.2 + 专用 scratch DSH_HOME，不碰 Desktop 真实 profile。
  Rationale：docs/product/demo-install.md 是唯一声明的受支持安装态面；安装件 peer 为 ~0.2.0-rc.2；本机 Desktop 0.2.2-rc.5 在范围外，已装插件是 2026-11-12 旧产物，数据根库会被当前安装件 version_list 拒绝。装进真实 profile 需要迁移或重建，超出授权且污染人类数据。
  Date/Author：2026-11-27 15:52 SGT / review694-plan
- Decision：记录写进 docs/product/installed-core-acceptance.md 的 2026-11-27 节，不新建独立文档。
  Rationale：该文件已是「已安装候选身份 + 逐项人类接受」的唯一落点，2026-11-26 节已承接多项目工程证据；新建文档会制造第二个接受事实源，还要额外索引。追加一节符合既有先例（每批候选/日期一节）。
  Date/Author：2026-11-27 15:52 SGT / review694-plan
- Decision：不作明暗主题主张，不作深链主张，不把工作项行/隔离写成安装态人验。
  Rationale：安装态没有产品内主题入口、没有 URL/route 入口，scratch profile 无规划连接故无工作项行；写成接受会变成无法由人类实际观察支撑的过claim。自动证据保留在 2026-11-26 节。
  Date/Author：2026-11-27 15:52 SGT / review694-plan
- Decision：人类步骤采用 nonce 绑定与前后停机回读，而不是截图或录屏。
  Rationale：截图/录屏属于发布面风险（账号、侧栏、会话地址）且无法证明是本次执行；nonce 写进项目名 + 接受句逐字引用 + 停机回读数据库，能把一次执行绑定到唯一身份且全部可复现。发布规则禁止把含本机信息的图片写进仓库。
  Date/Author：2026-11-27 15:52 SGT / review694-plan
- Decision：A1（凭据/来源不可用的结构化拒绝）列为可选观察，不计入接受句。
  Rationale：#694 判据 5 的「access」在人验里没有真实凭据就无法构成权限否定；把它作为可选补充观察既给了人类选择，也不让接受句覆盖未验证的权限语义。真实 denied/offline 继续由 #450/#451/#457 与 2026-11-26 节覆盖。
  Date/Author：2026-11-27 15:52 SGT / review694-plan
- Decision：关闭语义：未获人类明确接受时 #694/#636 保持 OPEN、PR 用 Refs；获接受且人类明确指示时才允许 closingIssuesReferences 含 #694。
  Rationale：AGENTS.md §4/§8 与本 issue 的验收条款都要求人类接受是独立门；工程测试、历史记录或协调者观察不能替代。用回读命令而不是手写关闭结论，避免发布面出现第二个关闭事实源。
  Date/Author：2026-11-27 15:52 SGT / review694-plan
- Decision：不修改 Desktop 现装插件，也不卸载/重装它来「顺便验证」。
  Rationale：卸载重装会改写人类真实 profile 的依赖与数据根打开路径，且旧库仍会被拒绝；这是不可逆外部状态变更，不属于本计划授权。
  Date/Author：2026-11-27 15:52 SGT / review694-plan
- Decision：待人类决定的两项以显式问题提交，不由 agent 预设。
  Rationale：Host 选择涉及人类真实安装态与时间成本；是否当场执行走查决定 #694 能否关闭，两者都会改变不可逆结果（关闭 issue、写看板/发布结论），必须由人类裁定。
  Date/Author：2026-11-27 15:52 SGT / review694-plan

## Idempotence and Recovery

- 可重复执行：git rev-parse、git diff --exit-code、pack:plugin、shasum、wc -c、六件比对、sqlite3 -readonly 回读、rule-checks、gh 回读。重复打包在相同生产输入与工具链下应得到相同字节；若不同，先查锁文件/Node/工具链，再按 I2 处理。
- scratch profile：每轮用新的 mktemp -d；失败或重来直接删整个 scratch 根（rm -rf "$HP_DEMO_SCRATCH"），不影响仓库与人类真实 profile。若要复用同一轮，必须保持同一 DSH_HOME 与同一 --patch 文件，否则前置状态不再成立。
- 损坏偏好走查（H9）本身就是恢复演练：覆盖成非法 JSON 后不得删除数据库；恢复路径是选择任一项目，让 Host 重写合法 selection。若人类误删 selection 文件，等价于「无偏好」，仍是安全 Home 状态，不是数据丢失。
- 数据库失败：任何 I4/I6 不通过都禁止修库、禁止改 PRAGMA、禁止把新库冒充旧库；保留现场并在记录节与 Surprises 写明失败。需要重来就换新 scratch 根。
- 文档回填：Batch 3 的记录内容可回退到 Batch 2 的「未执行」版本；Batch 4 若改了引用语义而人类撤回接受，先回读确认再改回 Refs。
- 计划归档：仅在 Batch 3/4 完成后把本文件移到 docs/exec-plan/completed/ 并更新 docs/README.md；长期阻塞时保持 Active 并在 Progress 写原因，不静默归档。

## Interfaces and Dependencies

- 运行时：Node 主版本 26（本机 26.13.1）、pnpm 10.28.2、esbuild 0.28.2（锁文件固定）；打包与安装步骤需要可执行 npx 的环境。
- 网络：首次 npx 解析 @deepseek-ai/dsh@0.2.0-rc.2 可能需要 registry 访问（本机观察时刻缓存已含该版本，但缓存不是承诺）；没有网络时 Batch 1 的安装与六件比对无法完成，须显式标注未执行。
- 本机工具：sqlite3（3.54.0，只读回读）、openssl（生成 nonce）、python3（生成 documents overlay，来自安装指南）、一个本机浏览器。
- 人类输入：人类的可用时间与逐字回复是 I5 的唯一来源；没有人类输入则判据 5 保持未勾。
- 仓库接口：docs/product/demo-install.md 的固定 Web 安装流程、docs/product/installed-core-acceptance.md 的记录格式、docs/README.md 的索引表、scripts/rule-checks.mjs 的 disclosure/size 子命令、tests/contract/plan-facts-consistency.test.js 体现的「不写字面关闭断言」约定（本计划因此只写 Refs 与 closingIssuesReferences 回读）。
- 上游 issue：#694（判据 5 原文）、#636（第 8 条验收组与人工接受边界）、#698（已合并的工程资格与 Refs #694 语义）、#647（Win11 硬件，独立）、#459/#73（R1，独立）。

## Outcomes & Retrospective

截至本计划创建（2026-11-27 SGT），Batch 1–4 均未执行：本文件只包含已核实的身份/可行性事实、交付形态决策、验证协议与批次设计，不包含任何人类接受结论。实际结果、与计划的偏差、未主张范围的最终边界在 Batch 3/4 回填本节；在此之前，任何读者都不得把本计划的存在或归档状态读成安装态验收已通过。

2026-11-27 16:03 SGT（Batch 1–2 完成后追加）：Batch 1 已完成身份链重放与安装件证据（tarball 369610 bytes / `7895d024…`，两个 lib 与 2026-11-26 记录一致，六件逐字节相同，宿主出现 `[harness-projects] host ready`，停机回读 `user_version=7`、`ledger=1:1`、`workspaces=0`）；Batch 2 已交付上述记录节与安装指南指针。Batch 3 人类走查与 Batch 4 关闭语义仍未执行，因此本节仍不含任何人类接受结论，也不改变 #694 判据 5 与 #636 的 OPEN 状态；实际接受值、偏差与未主张范围的最终边界在 Batch 3/4 回填。

## Bottom Change Note

- 2026-11-27 15:53 SGT：创建本 ExecPlan。依据：issue #694 判据 5 仍为唯一未勾项，#698 已合并并留下安装态人验缺口；本次完成基线 f5b731a4 的 tree 等价复核、Desktop 旧产物与库拒绝路径核实、受支持 Web profile 路线确认、docs-only 与契约守卫的取舍，以及 nonce/前后回读协议与 H1–H9 步骤设计；同时写入 docs/README.md 的 Active 索引行。
- 2026-11-27 16:03 SGT：回填 Batch 1 证据到 Progress 与 Surprises（身份值、六件匹配、host ready、前置状态）；Batch 2–4 仍未完成，本计划不含任何人类接受结论。
- 2026-11-27 16:03 SGT：交付 Batch 2 记录节与安装指南指针，勾选 Progress 并追加 Outcomes 中间记录（Batch 1–2 实际值、Batch 3/4 仍阻塞）；不含人类接受结论。
