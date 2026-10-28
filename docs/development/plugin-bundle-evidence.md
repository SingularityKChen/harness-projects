# Host 公开能力与插件构建证据

本轮 #428 选择零新增 UI 依赖，后续基础控件优先使用 Host 的公开 primitives 与主题 token。当前页面保持原有实现；本记录提供选型依据和可复算构建证据，不宣称已完成组件迁移或浏览器可访问性验收。

## 公开发行的能力边界

2026-10-28 从 npm registry 读取以下三个包的 **0.2.0-rc.2** metadata，下载对应 `dist.tarball`，重新计算 SHA-512 并与 `dist.integrity` 相等后检查包内文件。来源是发行包自身的 `package.json`、`lib/types/index.d.ts`、相关组件 `.d.ts` 和 `README.md`，不是安装目录中的私有源码。可用 `pnpm view <package>@0.2.0-rc.2 dist --json` 回读下载地址与 integrity，再对 tarball 解压检查。

| 包 | 固定 `dist.integrity` |
|---|---|
| `@deepseek-ai/dsh-client-ui-primitives` | `sha512-Zx/MRT8NH6rYEvPnk4FQaHrADM6Dh1PQCprieqdvKj6yFhD/CJUVjSN08suGF6FPQekfVTJtS0WxY1XbQ5Ed9Q==` |
| `@deepseek-ai/dsh-client-ui-theme` | `sha512-1pdHD6QfRGalG3BchmvvuVZportaMcSGQ1lwjFlddB2oyZrHk4lsYMYN8l1icQDgB7VrA4cA1VIlYlUfl7qbLw==` |
| `@deepseek-ai/dsh-client-ui-slots` | `sha512-zfILCyG3ijHT7S8+WDXFz4RMxBJtG9A3ngtDBnqcLbD5wzKz8H7E+HC657USa6RgG13C2RGSs73sfKcSs4WtWQ==` |

三个包的 `exports["."]` 均将 types 指向 `./lib/types/index.d.ts`、default 指向 `./lib/index.js`，另有 `./package.json`、`./src/*`。theme 还公开 `./client` 和 `./brand-font.css`。这描述 npm 的解析面；插件运行时仍受 `build.mjs` 的 `CLIENT_BASELINE` 精确键约束。primitives 和 slots 根模块已在 baseline，theme 及任意 deep import 不因此成为 Loader 可回答的模块。

| 需求 | primitives 根导出与发行声明 | 使用者仍需负责 |
|---|---|---|
| 按钮/文本输入 | `Button` 支持 `primary/ghost/outline/toolbar`，透传原生 button 属性与 ref；`Input` 透传原生 input 属性与 ref | 本地化文案、字段 label、禁用/提交状态与业务错误 |
| 勾选/菜单 | `Checkbox` 是 `checked/onChange/label` 受控原生控件；根导出 `Menu`、`MenuItemButton` | 业务选择状态与菜单数据、生命周期 |
| 详情对话框 | 根导出 `Modal`；声明包含 `open/onClose/title`，普通模式要求 `closeLabel`，另有 `description/footer/headless`；文档说明 Escape、Tab、焦点恢复及 `data-modal-autofocus` | 在实际 Host 中验证打开/关闭、嵌套菜单、焦点返回、背景隔离与读屏，避免 React `autoFocus` 抢先移动焦点 |
| 主题 | primitives 的主题面使用 `--dsw-*`；theme README 要求插件消费当前 token，不自行管理另一份主题状态 | 使用 Host 已应用的 CSS 变量，升级时核对 token 与视觉回归 |
| 挂载位置 | slots 根类型提供 `SlotCore` 及注册/渲染的组合契约；当前插件已有 main/sidebar 注入链 | 保持现有 `inject/apply`、挂载与卸载契约 |

已核对 theme README 的 `--dsw-focus-ring-color` 与 `--dsw-focus-ring-width`，后者标准宽度为 2px；颜色 fallback 使用 `--dsw-alias-state-business-primary`，offset 由组件拥有。该主题说明不等于本插件在实际 Host 中的对比度、键盘或读屏已通过。

## 同需求的备选比较

备选仅比较单个 [`@radix-ui/react-dialog` 的官方 Dialog 文档](https://www.radix-ui.com/primitives/docs/components/dialog)。官方说明其支持 modal/non-modal、受控或非受控状态、modal 内焦点限制、Escape 关闭，以及 `Title/Description` 的读屏通知；这支持它作为需评估的可访问对话框基础。

| 维度 | Host `Modal` + public primitives/token | selective Radix Dialog |
|---|---|---|
| 详情交互 | 发行声明已覆盖按钮/输入/受控 modal 的基础需求 | Dialog 负责对话框行为，按钮、输入和业务表单仍需组合 |
| Host 集成 | 根模块已是 Loader baseline，无需新增外置键 | 需实际构建其依赖图，检查 React singleton、Loader ABI 和 Host 中的交互 |
| 主题/样式 | 使用既有 `--dsw-*` 主题契约 | 插件需承担样式、token 映射、层级和 Host 主题适配 |
| 维护成本 | Host peer 更新时回读根 exports、组件类型和 token；实际采用后补交互回归 | 额外维护组件及传递依赖版本、许可证/更新和焦点/键盘回归，同时继续追随 Host |
| 本轮体积证据 | 当前生产产物 base/head 实测如下 | **未构建、未测量**，不填写估计 gzip 数字 |

本次选择保留现有 UI 且不加依赖：没有已证明必须由新库补足的需求。后续若 Host 公共能力不能满足明确交互，再用真实候选实现和相同构建报告评估；官方功能说明不能证明该备选与 Host ABI 兼容，也不能替代本地浏览器验收。

## 报告工具与复现

唯一生产构建仍是 `apps/harness-plugin/scripts/build.mjs`，本 PR 不修改其 API、源码或参数。`bundle-report.mjs` 动态 import 显式 `--source-root` 检出中的该模块，再执行其 `build({ outDir })`，随后对返回的安装目录执行真实 `pnpm pack`。source root 必须是同仓已登记且规范化的 worktree 根；每个输入都核对 realpath，禁止借工作区 symlink 测到别的检出。旧实现只核对输入路径、最后读取 source 身份，并不足以证明这一归属：**Superseded by「报告归属与输出边界」的修正（2026-10-28）**。

### 报告归属与输出边界

独立复审重现了三项缺口：dirty 源在 pack 中恢复 clean 后被错标为 clean HEAD；build 入口 symlink 测到了另一检出；输出目录 symlink 让失败调用删除了边界外旧报告。修正后，import/build 前固定 HEAD 和完整 porcelain status，pack 完成后必须逐字一致；报告保留起始身份，漂移就拒绝成功 JSON。稳定 dirty 的单次诊断仍可生成，但不能参与 Δ。

`build.mjs` 的 realpath 必须等于指定检出的标准入口路径，拒绝文件或其父组件重定向；不只验证返回的同名 input。任何 rm 之前先规范化输出允许根并逐组件检查输出目录及受控子项，拒绝目录/祖先/报告等 symlink。先规范化 worktree、home 与系统 tmpdir，保留 macOS 的系统路径 alias；禁止输出到文件系统根、home 根、tmp 根、检出或其祖先、跟踪源码和受保护目录。检出内只允许 `apps/harness-plugin/dist/` 或 `.superpowers/`，检出外允许显式独立目录，正常临时目录和两个 outDir 重现测试仍通过。

无效输出会在清理前拒绝并保留 sentinel；合法输出上的失败仍移除旧成功报告。前后身份复核采用乐观检查，不新增源快照或锁；运行期间调用者须保持源码和输出路径静止，不能将它解释为对瞬时修改后恢复或外部并发写入的锁定证明。

在检出 `chore/plugin-bundle-evidence` 的工作树根，执行：

```sh
pnpm --filter @harness-projects/app-harness-plugin bundle:report
pnpm --filter @harness-projects/app-harness-plugin pack:plugin
pnpm test:file tests/integration/harness-plugin-bundle-report.test.js tests/integration/harness-plugin-artifact.test.js
```

首条缺省生成 `apps/harness-plugin/dist/bundle-evidence/report.json`，另存完整两份 metafile 和实际 tarball。报告/metadata 位于安装目录 `package/` 外；原 `pack:plugin` 不变。当前 pnpm 无 shebang shim 在 Node argv 子进程返回 ENOEXEC 时，工具解析该 shim 的 realpath 后执行相邻公开 Node 入口 `bin/pnpm.mjs`；仍不使用 shell。JSON 区分 JS raw、gzip（level=9）与 tarball bytes/SHA-256，并记录观察时刻、source HEAD/dirty、报告工具 HEAD、Node/pnpm/esbuild、build 脚本 SHA-256、导出配置和 input/external 图。

准备独立 base 检出及各自 frozen 依赖后，在包含两个检出的仓库根运行（本轮 base 固定为 `88d21ae6e0f0afb1f18afc776f54efac3ff4723a`）：

```sh
node .worktrees/plugin-bundle-evidence/apps/harness-plugin/scripts/bundle-report.mjs --source-root .worktrees/plugin-bundle-base --out .superpowers/plugin-bundle-evidence/base
node .worktrees/plugin-bundle-evidence/apps/harness-plugin/scripts/bundle-report.mjs --source-root .worktrees/plugin-bundle-evidence --out .superpowers/plugin-bundle-evidence/head --base-report .superpowers/plugin-bundle-evidence/base/report.json
```

同一当前工具读取两个检出的各自 build，因此不要求 base 已有新 CLI。先对照两个报告的 source HEAD/dirty 与预期检出；dirty=true 的单独测量只属于工作树观察态，工具拒绝任一 dirty 报告参与 Δ。工具仅在 schema、gzip level、工具链及完整 build 源码/导出配置相同才给出 Δ；脚本不同即拒绝比较，不推断语义等价。不兼容或 build/pack 失败时退出非零，清除旧的成功 JSON。

## 本轮观察与证据边界

2026-10-28，本轮 base 为干净检出 `88d21ae6e0f0afb1f18afc776f54efac3ff4723a`，head 为分支 `chore/plugin-bundle-evidence` 的本地能力提交。以相同当前工具调用两边的原生产 build，报告须同时满足 source.dirty=false；确切 source/reportTool HEAD 与观察时刻以各自 JSON 为准，按上节命令复算。两边生产输入、external 图及两份 JS hash 相同。预提交 dirty=true 的观察曾得到相同字节，但仅 clean head 的复算可作提交证据。

工具链是 Node `v26.12.1`、pnpm `10.28.2`、esbuild `0.28.2`，生产 build SHA-256 为 `65e3d9753e880fb2b5547a7c518626ee579801a2e224a529801cdcd6c4e30560`。Host ESM/node22、client CJS/es2022，minify=false、sourcemap=false，client production define，均来自现有 build；完整 hash 避免复制参数的报告脚本自行漂移。

| 对象 | base bytes | head bytes | Δ bytes |
|---|---:|---:|---:|
| client raw | 159165 | 159165 | 0 |
| client gzip level=9 | 37221 | 37221 | 0 |
| Host raw | 431795 | 431795 | 0 |
| Host gzip level=9 | 107895 | 107895 | 0 |
| 实际 pack tarball | 159301 | 159301 | 0 |

client SHA-256 为 `d7c438bc64bb3f68c848276104e10e0e82bd8ccfe405c39ace2eabd87cb77cd6`，Host 为 `891cdab7c1f29f0ee214e608bc9f88690d02026e9ba579e9fcaa54889a556a7b`；本轮 tarball 为 `dffe4d53357450989fbb73775ea731791e919d6da8242257a0d544d82617dd29`。tar 元数据不保证跨环境重现，应始终读取本轮实际文件。

两半边各一个 JS 输出；client 51 个 input、Host 94 个 input，图中均无识别到的 bundled React/react-dom；client 仅外置根 `react`，Host 外置 Node 内置模块。`+20 KiB client gzip` 指增量 `20 * 1024` bytes，是选型目标，不是整个包上限或新增 R1/CI 门禁。本轮 Δ=0 来自真实构建/pack，不从“没加 dependency”推断。

测试对单个 `react/cjs`、pnpm nested `react-dom`、错误 React external、双输出、输入/符号链接逃逸、未登记 sourceRoot、dirty 比较、失败/空 pack 和配置/工具链不一致均有拒绝断言；真实产物读盘重算 bytes/gzip/hash，并核对两个 outDir、直接 build 的 JS 一致。已有 artifact 测试继续验证 manifest 白名单、一次 `__ModuleLoader__.load`、package id、factory require、`apply/inject`，并使用同一个真实 React 实例渲染；复用同一 VM helper 的负控还拒绝重复 load 与 `react/private` 的 factory require。

图检查只证明输入路径可识别的 React 包没有打入，不能识别任意第三方重命名/预打包的 React 源码；VM/静态渲染不证明真实 Host 的完整交互或 a11y。本轮没有将候选 UI 安装到用户 Host，也没有把本地验证表述为 hosted CI。
