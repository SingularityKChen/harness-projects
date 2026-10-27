# Demo 插件安装指南

交付件是预构建的私有 tarball `harness-projects-app-harness-plugin-0.1.0-demo.1.tgz`。接收者安装时无需本仓库 checkout、TypeScript loader 或源码构建。当前支持固定的 Harness `0.2.0-rc.2` Web profile；Desktop 和真实模型调用不在本指南的验收范围。

## 获取与核对

维护者在本仓库根运行唯一打包入口：

```sh
pnpm --filter @harness-projects/app-harness-plugin pack:plugin
shasum -a 256 apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.1.0-demo.1.tgz
```

将 tgz 与本次交付记录中的 SHA-256 一起交给接收者；接收者重新计算摘要，相同后再安装。版本相同不代表 gzip 字节相同，重新打包后需要重新确认摘要。维护者可运行真实 tarball 验收：

```sh
pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-demo-artifact.test.js
```

验收核对 manifest、两份 JS bundle、patch、七份 migrations 和 LICENSE 共 12 个文件，并拒绝源码依赖、本机路径和凭据；路径/凭据注入、删除 migration、导出指向 `.ts` 的变异都必须失败。

## 使用干净的 Web profile 安装

需要能运行官方固定版本 CLI 的 Node 和 pnpm。以下命令在只存放收到的 tgz 的目录运行；安装路径替换为该文件的绝对路径：

```sh
HP_DEMO_ARTIFACT="$(realpath ./harness-projects-app-harness-plugin-0.1.0-demo.1.tgz)"
HP_DEMO_SCRATCH="$(mktemp -d -t hp-demo-artifact)"
export DSH_HOME="$HP_DEMO_SCRATCH/dsh"
export DSH_TELEMETRY_DISABLED=1
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh --version
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --help
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile web add "$HP_DEMO_ARTIFACT"
```

版本输出应是 `0.2.0-rc.2`，安装应成功退出。不要使用版本豁免参数。首次安装如果报 pnpm launcher 的 `ENOEXEC`，请让隔离运行环境的 PATH 使用能执行该 launcher 的 shell 转接器；不要改全局工具或使用版本绕过。

`DSH_HOME` 隔离 profile 和插件存储，但首次打开的 native workspace 还需要显式指定 Documents 位置。以下受支持配置同时保留 lookup timeout：

```sh
python3 - "$HP_DEMO_SCRATCH" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
documents = root / 'documents'
documents.mkdir()
overlay = [{'id': 'workspace-controller', 'config': {
    'documentsDirectory': str(documents), 'documentsLookupTimeoutMs': 10000}}]
(root / 'documents.patch.yml').write_text(json.dumps(overlay))
PY
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh --profile web --patch "$HP_DEMO_SCRATCH/documents.patch.yml" --dump-config > "$HP_DEMO_SCRATCH/effective.yml"
```

打开页面前，核对 `effective.yml` 中 `workspace-controller.config.documentsDirectory` 的真实路径等于当前 scratch 的 `documents` 目录。配置不符应先修正 overlay；不要仅凭 `DSH_HOME` 推断隔离生效，也不要改 HOME。

```sh
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh web --patch "$HP_DEMO_SCRATCH/documents.patch.yml" --no-open --port 0
```

只在本机浏览器打开终端给出的会话地址；地址含访问材料，不要分享或写进公开日志。首次访问后核对 native workspace registry 及默认 workspace 都位于 scratch Documents。进入侧栏 **Harness Projects**，空 profile 应显示创建工作区的设置入口。这一步不需要模型 key，也不需要发送 prompt。

连接规划服务时，凭据参考名为 `HARNESS_PROJECTS_GITHUB_TOKEN`；通过宿主 credentials 服务配置，Project 数据库只保存句柄。不要把 token 放在工作区名称、配置文案或本指南中。连接、仓库绑定、完整 demo 走查分别遵循其产品指南与验收范围。

## 显式启用会话执行与人工备用

宿主出现 `host ready` 只代表插件已加载。工作区创建后，在 **连接设置** 点击 **启用 Harness 执行**。Host 在一次本地事务中安装 Harness 主执行与 human 备用两个挂载，成功后重新装配并显示 **Harness 执行绑定已启用**。这条提示表示绑定配置已启用；它不证明会话服务、模型凭据或人工备用密钥可用。重复点击或重启读回同一对 binding ID；已有自定义、残缺或停用的执行挂载会返回冲突，不覆盖用户配置。普通启动不会自动安装、补齐或复活挂载。

人工备用通过宿主 credentials 服务解析固定参考名 `HARNESS_PROJECTS_MANUAL_ISSUER_KEY`，需要至少 32 字节的高熵密钥。使用凭据管理器预先保存的一份稳定值，并在重启、重装及重新装配后提供同一值；不要每次启动重新生成。密钥只在当前 provider 操作内使用，Project 数据库不保存其值。缺值、短值、解析失败或解析超过 30 秒都会结构化拒绝人工执行；此时不能宣称已有可靠人工备用。

实际配置入口之一是启动宿主时继承的环境变量。以下命令替代前面的 Web 启动命令，从隐藏输入读取已经妥善保存的密钥，只向子进程环境传递；命令本身不生成或打印密钥。每次启动输入同一份值，保持同一 `DSH_HOME`：

```sh
python3 - "$HP_DEMO_SCRATCH/documents.patch.yml" <<'PYCODE'
import getpass, os, subprocess, sys
issuer = getpass.getpass('Manual issuer key from your credential manager: ')
if len(issuer.encode('utf-8')) < 32:
    raise SystemExit('Manual issuer key must contain at least 32 bytes')
environment = dict(os.environ, HARNESS_PROJECTS_MANUAL_ISSUER_KEY=issuer)
subprocess.run([
    'npx', '--yes', '--package', '@deepseek-ai/dsh@0.2.0-rc.2',
    'dsh', 'web', '--patch', sys.argv[1], '--no-open', '--port', '0',
], env=environment, check=True)
PYCODE
```

宿主 `dsh-credentials-local` 的 `0.2.0-rc.2` 与 `0.2.1-rc.2` 实现都支持此参考名的环境变量解析，但多来源优先级不同：前者环境变量优先，后者已保存的 provider-managed 值优先。若同名参考已存在于宿主凭据存储，按所用宿主版本核对实际生效来源，避免误以为换了环境值就已经换钥。这里不修改宿主凭据文件，不建立第二套 secret 存储。更新宿主后仍需重新验证兼容性；此次源码核查不扩大固定 Web 版本的安装验收范围。

绑定仓库并开始工作后，Host 先等待 Git 确认分支与真实工作树，再在该工作树 cwd 创建会话、投递 prompt，最后记录 run。会话服务缺席仍可加载 Host；明确的启动不可用会保留工作树并尝试人工备用，成功时 run 标记 `manual_fallback`。模型缺凭据若出现在已接纳会话的 `turn/end`，记录为 `failed`；prompt 接纳后的失联或回执不明记录为 `unknown`，不会再启动人工执行者。

## 演示启动失败开关

`HARNESS_PROJECTS_FORCE_SESSION_START_FAILURE` 默认关闭，仅精确字符串 `1` 开启；未设置、`0`、`true` 等值都不启用。它在 Host 组合时读取，改变后须停止并重启宿主。开关只影响后续新的 Start Work，在任何 session create/prompt 前返回固定不可用，不改变已存在的 run。

需要演示人工备用时，在上面的启动命令前执行：

```sh
export HARNESS_PROJECTS_FORCE_SESSION_START_FAILURE=1
```

保持稳定人工密钥可用，再显式开始一个尚无执行上下文的工作项，核对真实工作树保留、run 为 `running` 且有 `manual_fallback`，会话 create/prompt 计数均为零。关闭时执行 `unset HARNESS_PROJECTS_FORCE_SESSION_START_FAILURE` 并重启。重复开始既有上下文只读回已有事实；此开关不把结果未知的会话重新执行，也不伪造已有 run。

## 卸载与恢复

先退出 Web 宿主进程，使用同一个 `DSH_HOME` 和 Web profile：

```sh
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile web remove @harness-projects/app-harness-plugin
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh --profile web --patch "$HP_DEMO_SCRATCH/documents.patch.yml" --dump-config > "$HP_DEMO_SCRATCH/removed.yml"
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh web --patch "$HP_DEMO_SCRATCH/documents.patch.yml" --no-open --port 0
```

确认 profile 不再声明该插件依赖，生效配置没有插件层；重启后侧栏和主面板注册以及插件 remote 均已撤回。空 `dependencies` 键可能保留，不要求配置逐字还原。卸载撤回插件层，不承诺删除 Project 数据库或缓存，也不删除用户仓库、分支、索引或工作树。

升级同名同版本包时先 remove，再 add 经摘要确认的新 tgz；不要依赖旧缓存替换。回滚时也先停宿主、remove 当前包，再 add 已知摘要的旧 tgz。保留数据库及用户仓库，不以删数据作为安装修复步骤。旧插件若不认识执行实现，只会局部禁用该挂载；保留 context、run、分支和工作树，已经接纳的会话仍是已发生事实，不自动取消或删除。

## 验收记录边界

本版已于 2026-10-26 21:48 +08 使用官方 `0.2.0-rc.2` Web profile完成 artifact-only 目录的实际安装、Projects 创建入口打开、卸载及重启核对。测试产物 SHA-256 为 `450afc5c90c82504fe71dfd8bca82d5b4cdfa8f6d92c09e9ee9ff223e8fad6a3`；12 个安装文件与 tgz 逐字节相同。卸载后依赖、配置层、侧栏/主面板与插件 remote 撤回，21 个独立仓库夹具文件摘要不变，Project 数据库保留。未配置模型 key，未发 prompt；Web 实证不覆盖 Desktop 或完整 demo 走查。

源码候选、具体判定、独立评审与回读命令见 [安装件 ExecPlan](../exec-plan/completed/2026-10-26-plugin-demo-artifact.md)。重新打包后应重新核对摘要；版本号不能替代本次字节身份。原始访问日志和截图仅留隔离运行目录。

2026-10-27 的执行接线验证使用临时 SQLite、真实 Local Git 工作树、生产 Host/remote 与既有会话录制回放；覆盖安装幂等、主备用冲突、同密钥重启、缺服务和故障开关、模型错误及 unknown 零人工启动。此轮未启动真实模型或用户会话，也未重新执行实际 Web/ Desktop 安装演练；新 tarball 的摘要必须按本指南重新核对，不能沿用上面的历史摘要。
