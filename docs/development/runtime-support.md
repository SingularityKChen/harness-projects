# Node 运行时支持契约

> 权威边界：本文是 source workspace 与 compiled Host 两种 Node 执行模式的唯一散文权威。机械事实仍由
> 根 `package.json` 的 `engines.node`、`.nvmrc`、`apps/harness-plugin/scripts/build.mjs` 的两个宿主常量与根
> `@types/node` 拥有；本文只解释它们，并逐值被 `tests/contract/runtime-support.test.js` 绑定，不复制第二份事实源。
> 历史计划、评审与审计里的 `>=22` 表述是当时的事实，不回改。

## 1. 两种模式

| 模式 | 谁在运行 | 版本事实 | 自动证据 |
|---|---|---|---|
| source | 开发与测试命令 `pnpm install`/`pnpm typecheck`/`pnpm test`；CI `Verify`、`Browser`、`Windows Native` lane | `engines.node` = `>=26.0.0`；`.nvmrc` = `26` | CI `Verify` 每 PR 的 `pnpm typecheck` + `pnpm test`；`tests/contract/runtime-support.test.js` |
| host | `apps/harness-plugin` 安装件的宿主半边 `lib/index.js`，在 Desktop 宿主进程内 | `HOST_NODE_TARGET` = `node22`；`HOST_NODE_VERSION` = `24.18.1`；`@types/node` = `~24.13.5` | `tests/contract/host-node-types.test.js`；`tests/integration/harness-plugin-artifact.test.js` 的「c. 宿主半边是 Node 可直接加载的 JS」 |

两种模式本就不是同一个运行时：source 模式直接用 Node 的原生类型剥离跑 `.ts` 源码，compiled Host 模式把安装件
打成 JS 后在验收宿主（Desktop 0.2.0-rc.2 的 Electron 44 内嵌 Node 24.18.1）里运行。旧的 `engines >=22` 把两件事
并成了一句，正是本契约要消除的假声明。

## 2. 为什么 source 行是 26

- `.nvmrc` 是 CI 唯一的 Node 来源：全部 `actions/setup-node` 步骤都写 `node-version-file: .nvmrc`，没有内联
  `node-version`。`Verify`、`Browser`、`Windows Native` 三条 lane 因此都在 26 上执行，26 是唯一有执行证据的行。
- 22.x / 24.x 的 source 模式没有消费者，也没有 CI 证据；保留它们就是声明未经证明的支持面。
- 契约单位是 major：本文与 `engines.node` 只承诺「26 行」，不声称逐 patch 验证。Node 27 也满足 `>=26.0.0`，
  契约测试按逐段 `>=` 判定，不把更高的 major 判红。

## 3. 为什么 Host 行不是 26

compiled Host 的目标由验收宿主决定，与 source 行无关：

- 宿主半边的构建目标是 `node22`（语法降级到 Node 22 能解析的程度），不是 `node26`；源码收紧不影响安装件产物。
- 类型面的天花板是 `HOST_NODE_VERSION = 24.18.1`：`@types/node` 的 major.minor 不得高于它，否则 `tsc` 会放行
  宿主上不存在的 API，再由运行时抛 `TypeError`。既有 `tests/contract/host-node-types.test.js` 继续拥有这条闸门。
- ADR-0009 的 node22 构建目标与 24.18.1 类型上限不变；本文只把「仓库 `engines.node` 已收窄」这一事实写清楚。

## 4. `engines` 的语义

`engines.node` 是**开发者约束**，不是安装件契约：

- 仓库没有 `.npmrc` 的 `engine-strict`，所以 pnpm 对不满足的 Node 只告警、不阻断安装；它也不会写进锁文件。
- 安装件的 manifest 由 `build.mjs` 生成，不写 `engines`；Host 准入读的是 `dsh-*` peer，不是 `engines`。
- 因此收窄 `engines` 的收益是「声明与实跑一致」，不是安装期强制；真正的强制来自 CI 与本文的契约测试。

## 5. 可擦除语法守卫

Node 的类型剥离只擦除类型，不执行语法。以下写法必须在运行前被拒绝：

- `enum` 与带运行时代码的 `namespace`（它们会生成运行时代码）；
- 构造器参数属性、`import =` / `export =` 等非擦除语法。

守卫是 `tsconfig.base.json` 的 `erasableSyntaxOnly: true`：`pnpm typecheck` 阶段报 TS1294。运行时的兜底是
Node 的 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`，但它只在已经跑到该模块时才触发，不能替代编译期拦截。
新代码用 `as const` 对象表达枚举语义（参见 `packages/domain/src/enums.ts`）。

负控夹具 `tests/fixtures/node-runtime/negative-erasable/probe.ts` 故意包含上述三种语法；契约测试用同目录的
`tsconfig.json` 单独立项编译它，并断言**只**出现 TS1294、至少 3 处。其他错误码会让这条测试失败，防止配置
问题造成假绿。该夹具不在根 `tsconfig.json` 的 include 内，也不参与 `pnpm typecheck`。

## 6. 类型面不等于运行时

`@types/node` 停在 `~24.13.5`，是 **Host 24.18.1 的天花板**，不是 source 行的版本：源码在 26 上跑，但类型面
故意保守在 24.13，任何只在 25/26 才有的 API 都不能被依赖。这既保护 compiled Host（宿主上可能缺失），也避免
source 行悄悄依赖只有最新类型包才描述的东西。Host 版本升级时，`build.mjs` 两个常量、`@types/node` 与
`tests/contract/host-node-types.test.js` 一起改。

## 7. CI 实际验证与未验证

已验证（每个 PR 都在当前 head 上执行）：

- Linux `Verify` lane 在 `.nvmrc` 的 Node 26 上分两步跑 `pnpm typecheck` 与 `pnpm test`；本地完整入口是同语义的 `pnpm verify`（`pnpm test` 依次执行契约、集成、E2E 层）；
- `browser` 与 `windows-native` lane 同样用 `.nvmrc` 的 Node；但 `windows-native` 不跑 `tests/contract/`；
- `tests/contract/runtime-support.test.js` 随既有 contract 层进入 `Verify`，不新增 workflow 或 lane。

未验证（本文不声称支持）：

- 22.x / 24.x 的 source 模式（没有 CI lane，也没有消费者）；
- Node 26 的逐 patch 行为（契约只固定 major）；
- Desktop 上 Node 24.18.1 的真机执行（属人工安装验收与 R1，不属本契约）；
- 两个契约外 workflow 的镜像/系统 Node：`issue-policy.yml` 在 ubuntu-latest 自带 Node 上跑只依赖内建模块的
  `scripts/policy-check.mjs`（advisory），`github-review.yml` 在 self-hosted macOS 系统 Node 上跑一行 `node -e` HMAC；
  两者都不加载工作区 TS，也不读 `.nvmrc`。
- 契约只固定 `actions/setup-node` 步骤的版本来源，不扫描「没有 setup-node 却执行 node」的新 workflow；这是有意保留的残余风险（评审 P3-③ 记录不修），不扩大测试。

## 8. 命令

在检出 `.nvmrc` 对应 Node 的工作树根目录运行：

```bash
pnpm install --frozen-lockfile && pnpm verify   # 期望：退出 0
node --test tests/contract/runtime-support.test.js  # 期望：ℹ tests 7 / ℹ fail 0
```

## 9. 升级流程

- **source 行升级**：同一 PR 改 `.nvmrc` 与根 `engines.node`、本文模式表；契约测试强制两者 major 相等。
- **Host 升级**：改 `build.mjs` 的 `HOST_NODE_TARGET`/`HOST_NODE_VERSION`、`@types/node` 与既有 Host 测试，并更新本文模式表。
- **新增第三种运行时**：这是契约变更，必须先有 CI lane 并同步 `ci.yml` 与 `docs/development/ci.md`，再看是否扩宽支持面。
- **新增 workspace 包**：把包名加进根 `devDependencies`（`workspace:*`），保证裸包名可解析；`exports` 目标必须是
  `./src/*.ts(x)`，否则契约测试失败。

## 10. 文档入口

开发环境总览见 [README](README.md)；CI 与门禁细节见 [ci.md](ci.md)；本契约的自动证据见
`tests/contract/runtime-support.test.js`、`tests/contract/host-node-types.test.js` 与
`tests/integration/harness-plugin-artifact.test.js`。
