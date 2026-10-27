# 版本化插件安装件 ExecPlan

> 状态：Completed（能力验收完成，远端阶段按B3实时回读）；创建：2026-10-26；关联：#230；批次：B1–B3。
> 执行上下文：检出 `chore/plugin-demo-artifact` 的 `.worktrees/plugin-demo-artifact` 根；基线观察为2026-10-26 `f6ea971`；PR base为`main`。

## Purpose / Big Picture

demo用户拿到明确版本/摘要的预构建tgz，在没有源码checkout的干净Harness profile安装并打开Projects入口；remove撤回插件层且用户仓库不变。最小证据是当前tgz离开checkout后实际add→open→remove的完整记录，不以fake Host导入代替。

## Context and Orientation

issue #230允许tarball，无需registry发布。现有`pack:plugin`已构建host/client、manifest、patch、7 migrations并打包；版本仍0.0.0。既有artifact测试验证包形状，#131的真实Web S3证明设置流程而不覆盖本tgz安装/卸载。支持线及隔离依据在`docs/exec-plan/completed/2026-10-26-plugin-workspace-setup.md` Batch3：官方0.2.0-rc.2 Web与documentsDirectory overlay；DSH_HOME单独不隔离首次native workspace。规范为`PLANS.md`。

## Design / Spec

固定demo版本`0.1.0-demo.1`，沿用唯一`pnpm --filter @harness-projects/app-harness-plugin pack:plugin`入口；private预构建tarball，无安装build hook、registry、marketplace、自动更新或新发布workflow。指南给相对产物名/sha256、安装/卸载、支持Web版本及凭据reference名`HARNESS_PROJECTS_GITHUB_TOKEN`，不含值。当前单workspace setup入口即本阶段projects home，不造M5首页。

用真正tgz清单/字节验manifest/version/exports/patch/two bundles/migrations/LICENSE，不能只扫git diff或dist目录。无workspace依赖、运行时.ts/file:源码引用、source map、安装脚本、真实本机路径/凭据；解包只进scratch。保持node:sqlite原生内置外置，不加sqlite npm/native包。最小修正build内置判定为`node:module.isBuiltin`检查完整specifier，合法node:sqlite通过，bare sqlite与node:fs/伪子路径拒绝；不借此泛化构建器。

实际安装cwd在artifact-only scratch，复制tgz进去，Node解析不含源码/ts loader/dist symlink；空profile无旧插件/Project库。官方0.2.0-rc.2不绕兼容闸门；先dump配置核documents realpath，后开浏览器核native registry/default workspace落scratch。无凭据也能到空setup入口，不要求模型key或prompt；连接sandbox观察可作为附加，不混作其他PR完成。

卸载在停宿主后remove，再读profile依赖/层/配置，重启确认sidebar/main/remote不再active；用户repo refs/index/config/worktree及内容摘要相同。remove不承诺删Project数据库/cache或逐字恢复空dependencies键；残留如实写指南，不删除用户数据。拒绝源码安装与registry流水线，前者不证明独立安装，后者引不可逆发布生命周期。

## Global Constraints

代码+tests增删≤800、文档≤1300；脚本/测试约350，文档约300。文件全集：`apps/harness-plugin/package.json`、`apps/harness-plugin/scripts/build.mjs`、`tests/integration/harness-plugin-artifact.test.js`、`tests/integration/harness-plugin-demo-artifact.test.js`、`docs/product/demo-install.md`、本计划、`docs/README.md`。不新增pack入口/workflow/native依赖，不改peer放宽兼容，不改Status/native依赖边，不提交dist/tgz/raw日志。保持其他三个PR产品seam原样；独立main产物和组合candidate分别冻结/取证，不混用源码身份。

## Plan of Work

### B1 · 版本与真实tgz audit

最小闭环：一个命令产出versioned包，实际packed字节满足门禁。主文件：`apps/harness-plugin/package.json`、`apps/harness-plugin/scripts/build.mjs`、`tests/integration/harness-plugin-demo-artifact.test.js`。先RED非0.0.0版本/实际tgz完整性及builtin负控，再改最小版本/gate、加artifact audit；复用既有测试不复制整套fake Host。

    pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-demo-artifact.test.js
    pnpm --filter @harness-projects/app-harness-plugin pack:plugin
    shasum -a 256 apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.1.0-demo.1.tgz
    tar -tzf apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.1.0-demo.1.tgz

期望RED确命中新约束，GREEN全exit0；清单只含约定12文件，manifest/tgz版本相同。变异注入路径/secret canary、删migration、export指向.ts必须audit失败且不输出命中原值；不承诺gzip字节重现。回滚版本/gate/test即可，用户profile不变。

### B2 · 干净profile实际安装和打开

最小闭环：artifact-only目录中官方支持runtime加载当前tgz，真实页面出现入口。主文件：`docs/product/demo-install.md`。在本分支根先生成artifact并运行以下命令；运行态路径只进scratch，不进正式证据：

    HP_DEMO_SCRATCH="$(mktemp -d -t hp-demo-artifact)"
    cp apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.1.0-demo.1.tgz "$HP_DEMO_SCRATCH/plugin.tgz"
    HP_DEMO_ARTIFACT="$(realpath "$HP_DEMO_SCRATCH/plugin.tgz")"
    cd "$HP_DEMO_SCRATCH"
    DSH_HOME="$HP_DEMO_SCRATCH/dsh" DSH_TELEMETRY_DISABLED=1 npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh --version
    DSH_HOME="$HP_DEMO_SCRATCH/dsh" DSH_TELEMETRY_DISABLED=1 npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --help
    DSH_HOME="$HP_DEMO_SCRATCH/dsh" DSH_TELEMETRY_DISABLED=1 npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile web add "$HP_DEMO_ARTIFACT"

预期version0.2.0-rc.2、add exit0、无allow-version/accept-risk。按上述completed计划Batch3的Python overlay命令制作documents.patch.yml，documentsDirectory指向当前scratch/documents，documentsLookupTimeoutMs=10000；再执行：

    DSH_HOME="$HP_DEMO_SCRATCH/dsh" DSH_TELEMETRY_DISABLED=1 npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh --profile web --patch "$HP_DEMO_SCRATCH/documents.patch.yml" --dump-config > "$HP_DEMO_SCRATCH/effective.yml"
    DSH_HOME="$HP_DEMO_SCRATCH/dsh" DSH_TELEMETRY_DISABLED=1 npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh web --patch "$HP_DEMO_SCRATCH/documents.patch.yml" --no-open --port 0

开页面前只核effective.yml中documentsDirectory的realpath，配置不符先修受支持overlay；浏览器会话URL只本机打开、不输出/提交。首次访问后核native registry/真实default workspace均在scratch。记录Host ready、installed12文件hash匹配tgz、sidebar→Projects空setup页面截图；source checkout不在解析链，不发prompt。回滚只remove该scratch插件，保留证据，不删除用户目录。

### B3 · 卸载、保留性与交付

先停B2宿主，仍在artifact-only目录运行：

    DSH_HOME="$HP_DEMO_SCRATCH/dsh" DSH_TELEMETRY_DISABLED=1 npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile web remove @harness-projects/app-harness-plugin

预期exit0；读profile package/bundles和effective配置不再含插件层，按B2命令重启，核sidebar/main/remote撤回。安装前后用户repo内容/refs/index/config/worktree清单摘要相同，Project规划值若访问也前后不变；不要为逐字复原空dependencies键改用户profile。证据记source head、tgz版本/SHA、安装文件hash、runtime/version/profile、cwd非checkout、动作/时间与remove读回。Web只证明Web。

回本分支根完成指南链接/五类公开面及：

    pnpm verify
    pnpm run boundaries
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望全exit0并人工核800/1300；整理提交push后，`gh pr view -R SingularityKChen/harness-projects "$HP_PR" --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`、`gh pr checks -R SingularityKChen/harness-projects "$HP_PR"`及所有review threads回读当前头才ready。HP_PR取本分支实际draft号。缺真实安装/open/remove任一证据仍未完成。回滚remove当前候选、add已知SHA旧tgz；不清repo/Project库。

## Validation and Acceptance

| 验收 | 证据 |
|---|---|
| 一命令versioned built artifact | B1实际tgz版本/清单/摘要及audit负控 |
| clean profile无源码达到Projects入口 | B2官方runtime、artifact-only cwd、installed hash、真实页面 |
| remove撤回插件且仓库不变 | B3配置/重启UI/remote读回与repo前后摘要 |
| 无敏感信息/路径/源码依赖 | B1 tgz字节audit；B3disclosure及人工五类目 |
| credential参考名可用且无值 | 指南只写HARNESS_PROJECTS_GITHUB_TOKEN，DB只含句柄 |

## Progress

- [x] 2026-10-26 +08：两设计与既有build/S3记录审评，固定版本和最小路径。
- [x] 2026-10-26 +08：B1真实tgz RED→GREEN；版本、完整specifier负控、12文件及四类真实tgz变异通过。
- [x] 2026-10-26 21:48 +08：B2当前tgz从artifact-only cwd安装，真实Projects创建入口、12安装文件逐字节和native Documents隔离核对通过。
- [x] 2026-10-26 21:48 +08：B3 remove后依赖/生效层消失，重启后sidebar/main与插件remote撤回，21个仓库夹具文件摘要不变，Project数据库保留。
- [x] 2026-10-26 22:11 +08：独立扫描P2修复复评PASS，当前产物功能/安装/卸载和文档验收完成；远端阶段只按B3实时回读判定，不预写ready或合并。

## Surprises & Discoveries

2026-10-26 22:36 +08：远端CodeQL在`5f9801c`对测试ENOEXEC的静态`sh -c`回退给出环境值warning。改为解析可执行launcher并以独立argv交给shell脚本解释器，不再使用`-c`；独立特殊字符路径/7参数探针及38相关测试通过，15冻结产品文件摘要不变。实际远端告警是否消除以最终head扫描回读为准，不加豁免。

B1 真实 RED 同时观察到版本仍为 0.0.0、bare sqlite 被误接受，以及 scratch pack 缺 LICENSE。先修测试进程的本地 pnpm 无 shebang 执行问题，保留真正产品约束失败日志；最小修复后三项新增测试与原 artifact 套件共 27/27 通过。全量 `pnpm verify` 在本分支工作树通过 typecheck、2017 项与 MVP0 7 项；边界 9 项、workflow-check 8 文件通过。源码冻结及 tgz 摘要在 B2 执行前重新核对。

当前pack已存在，缺版本/当前tgz完整实证，不需发布框架；该缺口已由本轮 B1 补齐，见 Progress（2026-10-26）。内置判定剥node:前缀会错误接受bare sqlite。disclosure扫diff不扫ignored tgz；DSH_HOME也不覆盖native默认workspace。#131旧Web实证不可代替本包安装矩阵。均为2026-10-26调查事实，非本轮完成。

## Decision Log

2026-10-26 21:48 +08 / 协调者：B2/B3实跑由root接手，源码产品字节冻结后检查；P2修复限测试扫描，不改变已安装包。外部写入actor为本仓owner执行账号，目标为本仓PR406/issue230及Project10关联字段，幂等键`iteration8-plugin-demo-artifact-*`；draft、双向closing关联、assignee/milestone/labels及ExecPlan/Batch已回读，不改Status或依赖边。

2026-10-26 / 执行分工：协调者收回 B2/B3 的真实安装、打开和卸载；实现者先交 B1 与指南草稿。B2/B3 未执行，不归档或宣称整个安装闭环完成。 Superseded by Outcomes & Retrospective（2026-10-26）：真实安装、打开和卸载已由协调者完成。

2026-10-26 / B1：在 checkout 外独立 pack 暴露 LICENSE 原来依赖 pnpm 向父目录发现；build 现在显式复制并列入 files，确保 tarball 的许可文件自包含。只导出既有 builtin 判定函数供直接负控，不改变 API 层次。

2026-10-26 / 设计评审：版本0.1.0-demo.1、唯一pack入口、完整specifier isBuiltin小修与artifact-only安装；不拓展registry/native策略。用户授权设计审评至ready，无须重复批准；不授权Status/native依赖边/自行合并。root已观察基线verify与pack、固定npx runtime可用；这些只作可执行性证据，不能勾本轮B1–B3。

## Idempotence and Recovery

build/audit可重跑；同名同版本替换先remove再add，不暗用旧缓存。安装/卸载只作用本次scratch profile，保留tgz/hash与repo快照；卸载不删Project数据。新增产品字节就重新冻结并跑S3。公共提交整理按backup ref/精确lease，禁止破坏性清理代替卸载。

## Interfaces and Dependencies

沿pnpm10.28.2锁定工具链、现有manifest peers、Node内置sqlite、dsh0.2.0-rc.2官方CLI与web profile；先核实际help。指南引用官方publish机制但命令以固定发行版实测为准。raw stdout/effective配置含访问材料/本机路径只留scratch；公开仅脱敏结果。需本机浏览器入口与受支持documents overlay，缺项保留阻塞事实。

## Outcomes & Retrospective

2026-10-27 +08 / 评审收尾：本功能的完整初审及适用P2修复已独立复核，新组合官方Web验收通过；#124评论`6435452681`补齐指定位置的实证回传。当前组合产品源/包摘要、恢复/卸载、规划副本证据及范围边界见 `docs/review/2026-10-27-pr406-pr409-mmp-review.md`。旧单PR S3只属于其标明的历史冻结源，最终远端门禁及授权rebase合并按逐PR review回读，不预写结果。

实证观察于2026-10-26 21:57 +08，源候选`a17de25a693b9f1ac7e6fba9df5d2a5394eff7b7`构建的0.1.0-demo.1 tgz SHA-256为`450afc5c90c82504fe71dfd8bca82d5b4cdfa8f6d92c09e9ee9ff223e8fad6a3`。官方npm 0.2.0-rc.2 Web从artifact-only cwd add成功；12安装文件逐字节相同，package realpath不在checkout，Host ready及实际Projects创建入口已截图。effective documentsDirectory与native registry/default workspace的realpath均落隔离根；无模型key、未发prompt。

停宿主remove成功，依赖及effective插件层消失；重启后sidebar/main无插件注册。cookie鉴权的原生RPC入口返回HTTP200结构化应答（空请求业务校验未成功，不声称业务调用成功），插件getWorkspaceSetup返回404；两者区分了有效鉴权与入口撤回。独立仓库夹具21个文件（含index/config/HEAD及内容）逐字节摘要相同，Project数据库保留。

独立对抗验收在`a17de25`发现源码引用regex漏合法import/误判注释；test-only修正`30996cf`改用既有TypeScript AST，真实tgz RED的8项失败转为38/38 GREEN，全回归2028+MVP0 7通过。独立复评原3项反例及wrapper require均按预期判别，并重新从当前源码外部cwd打包证明12文件逐字节等于本次S3冻结包；产品字节未变，无需重装。最终交付前以本计划B3远端回读命令核对当前head/checks/threads；此段不预写远端ready。

保留profile/存储隔离后续#338、Desktop与真实模型未覆盖边界；安装件不是完整demo走查#143或产品指南#236。没有新增实质延期债务。当前产物与组合candidate取证分别记录，不混用源码身份。

## Bottom Change Note

2026-10-26 22:36 +08：收口实际CodeQL反馈，记录最小argv回退重构和独立复评，已验收安装包产品字节不变。

2026-10-26 22:11 +08：功能与独立验收完结后归档；GitHub head/checks/threads/ready保留为实时事实源，由交付命令回读。

2026-10-26 21:57 +08：以实测结果替换B1交接时的未执行状态，记录源码扫描AST修复/独立复评及当前产品字节一致。

2026-10-26 21:48 +08：协调者完成当前tgz真实安装/打开/卸载/重启与保留性实证；原始访问日志和截图只留隔离运行目录，扫描P2另行修复复评。

2026-10-26 +08：综合两独立设计初稿，沿现有pack收敛版本/audit、clean profile真实open/remove与repo保留证据。

2026-10-26 +08：记录 B1 的真实 RED/GREEN、checkout 外 LICENSE 发现与最小修正、全回归和协调者接手 B2/B3；保持 Active，指南不预写真实运行结果。

2026-10-27 +08：追加MMP评审收口与新组合证据回传，保留各历史源码的实测身份，不混用为新单PR精确产物。
