# PR #440 交付与独立验收

2026-10-28，检出 `chore/plugin-bundle-evidence`，候选 `7357765a356495ca13c82a27fbac4c9ee0e8e6f2`，基线 `88d21ae6e0f0afb1f18afc776f54efac3ff4723a`。最终 PASS，三个独立发现均 ADDRESSED。

## 能力和取舍

复用每个显式 sourceRoot 的现有生产 build，记录真实 raw/gzip(level=9)/hash、metafile 输入/external 与 pnpm pack；不改生产 build、运行依赖或 UI。公开 Host primitives/theme/slots 0.2.0-rc.2 的 integrity、根 exports/type/token 已被作者和 reviewer 分别核验；与 selective Radix Dialog 比较后选择零新依赖。没有构建备选或宣称真实浏览器 a11y。

## 对抗发现及修复

| 原发现 | 最小修复与独立复评 |
|---|---|
| P1：构建时 dirty、pack 时恢复 clean，报告错误归属到 clean HEAD | import/build 前固定 HEAD/status，pack 后复核，漂移不写成功 JSON。原 marker 恢复探针准确拒绝；同树 HEAD 漂移也被拒绝。 |
| P1：build 入口 symlink 到另一检出，报告测错来源 | 实际 buildFile realpath 必须等于目标入口，import 前拒绝重定向。原探针准确拒绝。 |
| P2：输出 symlink 可在源验证失败时清理边界外报告 | 任何 rm 前规范化输出根/组件，拒绝受保护根、源码重叠与受控子项 symlink。四种合法/非法源与目录/祖先组合、六种受控子项 sentinel 均保留。 |

来源/输出须在执行期间保持静止；前后乐观比较不保证检测瞬时改动又恢复，不引入通用锁或快照系统。合法默认 dist、独立 tmpdir 与 macOS 系统路径 alias 均通过。

## 实际验证

命令在本分支工作树根执行：

- `pnpm test:file tests/integration/harness-plugin-bundle-report.test.js tests/integration/harness-plugin-artifact.test.js`：新增行为先 11 项中 5 项失败，修复后最终 36/36；独立复评再次 36/36。原 Loader 一次 load、白名单、apply/inject 与真实 React 静态渲染保持通过。
- 作者 `pnpm verify`：类型检查、2357 主测试、7 MVP 通过；boundaries 9、workflow 8、原 `pack:plugin`、disclosure/size/diff-check 通过。独立首轮完整 2352 + 7；修复后 reviewer 采用精确探针和聚焦回归，不冒称再次全量。
- `pnpm --filter @harness-projects/app-harness-plugin bundle:report` 与原 `pack:plugin` 通过；源逃逸、React 打入、错误 external、多输出、失败/空 pack、dirty/config/工具链不一致、来源漂移与清理重定向均有判别拒绝。
- 同一工具分别调用 clean base 与 clean head 的生产 build，作者与独立 reviewer 分别复算，source/tool HEAD 如 JSON 所记，dirty 均 false。

| 对象 | base/head bytes | Δ |
|---|---:|---:|
| client raw / gzip | 159165 / 37221 | 0 / 0 |
| Host raw / gzip | 431795 / 107895 | 0 / 0 |
| 实际 tarball | 159301 | 0 |

两半边各一个输出，client 51 / Host 94 个输入，零识别到的 bundled React，输入/external 图与 JS/tarball hash 相同。Node v26.12.1、pnpm 10.28.2、esbuild 0.28.2；生产 build hash 和 payload hash 见 `docs/development/plugin-bundle-evidence.md`。+20 KiB 仅 client gzip 增量选型目标，不是 R1 门禁。

## 归档与恢复

最终归档仅改文档/索引；候选产品/测试/配置路径与 Git blob SHA-256 为 `76f11818f7e1f9463d53fd032d3f5e0f462eee8933f7d3dfb040d806e3a6bf2d`，最终提交重新计算应相同，且可用最终工具再生成 clean base/head 报告。代码/测试/配置增删 342 行，文档以最终 size 为准。远端 head/base/checks/threads 由 PR 当前回读，本地证据不冒称 hosted CI。

回滚能力提交恢复旧构建工具，无运行态数据、Provider 或已安装 Host 写入。图无法识别任意重命名/预打包 React；VM/静态渲染不证明真实 Host 交互。父 UI issue 与 R1 不据此关闭。
