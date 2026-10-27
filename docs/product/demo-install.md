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

## 卸载与恢复

先退出 Web 宿主进程，使用同一个 `DSH_HOME` 和 Web profile：

```sh
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile web remove @harness-projects/app-harness-plugin
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh --profile web --patch "$HP_DEMO_SCRATCH/documents.patch.yml" --dump-config > "$HP_DEMO_SCRATCH/removed.yml"
npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh web --patch "$HP_DEMO_SCRATCH/documents.patch.yml" --no-open --port 0
```

确认 profile 不再声明该插件依赖，生效配置没有插件层；重启后侧栏和主面板注册以及插件 remote 均已撤回。空 `dependencies` 键可能保留，不要求配置逐字还原。卸载撤回插件层，不承诺删除 Project 数据库或缓存，也不删除用户仓库、分支、索引或工作树。

升级同名同版本包时先 remove，再 add 经摘要确认的新 tgz；不要依赖旧缓存替换。回滚时也先停宿主、remove 当前包，再 add 已知摘要的旧 tgz。保留数据库及用户仓库，不以删数据作为安装修复步骤。

## 验收记录边界

本版已于 2026-10-26 21:48 +08 使用官方 `0.2.0-rc.2` Web profile完成 artifact-only 目录的实际安装、Projects 创建入口打开、卸载及重启核对。测试产物 SHA-256 为 `450afc5c90c82504fe71dfd8bca82d5b4cdfa8f6d92c09e9ee9ff223e8fad6a3`；12 个安装文件与 tgz 逐字节相同。卸载后依赖、配置层、侧栏/主面板与插件 remote 撤回，21 个独立仓库夹具文件摘要不变，Project 数据库保留。未配置模型 key，未发 prompt；Web 实证不覆盖 Desktop 或完整 demo 走查。

源码候选、具体判定、独立评审与回读命令见 [安装件 ExecPlan](../exec-plan/completed/2026-10-26-plugin-demo-artifact.md)。重新打包后应重新核对摘要；版本号不能替代本次字节身份。原始访问日志和截图仅留隔离运行目录。
