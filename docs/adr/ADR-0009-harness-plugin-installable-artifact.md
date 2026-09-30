# ADR-0009：`apps/harness-plugin` 是唯一有构建步骤的包，安装件 manifest 由构建生成，外置边界等于宿主基线模块表

> 状态：Accepted（2026-09-30 人类伙伴授权按修订流程整理并合并 PR #245；K验收与构建契约成立，见归档计划D34）
> 日期：2026-09-30
> 来源：`docs/exec-plan/completed/2026-09-29-harness-plugin-package.md`（`Decision Log` D5–D13、D20、D21、D26）；issue #227；`docs/architecture/harness-host-spike.md` §11.7（#227 一行）与 §11.9 第 4 条

## Decision

1. **构建步骤只有一处。** 仓库其余包仍是 Node 类型剥离直接运行、`tsconfig` 为 `noEmit`；唯一的例外是 `apps/harness-plugin`
   的安装件构建 `scripts/build.mjs`，用 esbuild（精确版本 `0.28.2`），且 esbuild 只作该应用的 `devDependencies`（D5、D21）。
2. **两份 manifest，职责分开。** 工作区里的**源 manifest** 继续服从 `tests/contract/package-boundaries.test.js`（`private`、`type`、
   `exports['.'] = './src/index.ts'`、四个 `workspace:*` 依赖），**不写** `peerDependencies` 与 `dsh` 块。**安装件 manifest** 由构建脚本按白名单生成到
   `dist/package/package.json`：宿主 peer、`dsh` 块、`exports`、`files` 只在这一份里；没有 `dependencies` / `devDependencies`，全文没有
   `workspace:`（D6）。
3. **外置边界等于宿主基线模块表。** 客户端半边（CJS，包在 `window.__ModuleLoader__.load({ id, factory })` 里）的 `external`
   **恰好等于**宿主浏览器模块系统预置的 9 个基线模块名加上安装件 `dsh.client.external` 声明的名字（#227 为空），不用通配符；宿主半边（ESM）
   外置 `@deepseek-ai/*` 与 Node 内置模块；其余一律打进产物，`@harness-projects/*` 不得作为模块说明符留在任何一份产物里。构建带闸门，违反即抛错、
   不写安装件 manifest（fail closed）（D7）。
4. **peer 用范围，不钉精确版本。** 目标宿主线是 `0.2.0-rc.2`：所有 `@deepseek-ai/dsh` / `dsh-*` peer 取同一个范围 `~0.2.0-rc.2`，
   `@deepseek-ai/cordis` 取 `~4.0.4`；至少声明一个 `dsh-*` peer；`dsh.client.inject` 的每一项都必须是 peer 的键。两个取值只在
   `build.mjs` 的两个常量里各写一次，集成测试另持一份字面量作独立预期（D20，取代最初的精确钉版本方案）。
5. **构建产物形状。** 宿主半边 `target: 'node22'`（不高于验收宿主的 Node 24 与仓库 `engines.node >=22.0.0`，D26）；客户端半边 `es2022`；
   两个半边都不出 source map、不压缩，`absWorkingDir` 固定为仓库根，使产物与 metafile 里只有相对仓库根的路径（D11）。
6. **占位组件在 `packages/ui`，apps 只注册。** `apps/harness-plugin/src` 不 import `react` / `react-dom`、没有 `.tsx`，由
   `tests/contract/package-boundaries.test.js` 的壳断言守住（D9）。
7. **宿主半边只打一行就绪行**（`[harness-projects] host ready`），作为宿主观测的正面证据，不承载业务（D10）；安装件保留 `private: true`，
   是否取消交给发布批次（D12）。

## Why

它保护 `AGENTS.md` §2 的「apps 只做壳」与依赖方向，同时让「插件包可以被真实宿主接受」这件事有一个可机械判定的形状。

- **仓库原本没有构建步骤，而宿主要的是构建产物。** 宿主半边必须是 JS（宿主运行在 Node 上，对 `node_modules` 下的 `.ts` 不做类型擦除），
  客户端半边必须是 `__ModuleLoader__` 包装的 CJS，两者都不能带 `workspace:*` 依赖。这三项要求让「在哪里、用什么构建」成为后续
  #228（controller transport）、#229（页面）、#230（发布与安装）都必须遵守的前提；推翻它们意味着重做这三个子 issue 的代码，符合本目录的判断标准。
- **源 manifest 不写宿主 peer，是因为仓库锁文件设置了 `autoInstallPeers: true`**：任何写在工作区 manifest 里的非 optional peer 都会把宿主包装进仓库与
  CI。把 peer 与 `dsh` 块放进生成的那一份，「安装件没有 workspace 依赖、没有宿主包进锁文件」在构造上成立，测试直接读生成的文件，而不是推断 `pnpm pack`
  的改写行为。
- **外置表用精确集合而不是通配，是为了让错误在构建期失败。** 浏览器里的 `require` 只认基线表、已物化模块与已注册的包 factory，其余抛
  `missed the module table`；外置一个非基线的宿主包，构建会通过、页面才炸。精确集合加构建闸门把这类错误提前到 CI，并且 `packages/domain` 里值导入
  `node:crypto` 会在浏览器平台解析阶段直接挡住误把它打进 client bundle。
- **peer 必须有一个 `dsh-*` 项，因为宿主的兼容闸门只看这类 peer**，没有时直接放行，形同虚设。闸门不兼容时宿主**不会启动失败**：包被放进
  `skippedBundles`、往 stderr 打一行 `skipping profile bundle` 后宿主照常启动，所以「装上了但没加载」必须由正面证据（就绪行、入口出现）而不是「没有报错」判定；
  这是 #227 的观测协议要求就绪行的原因。范围而不是精确钉版本，是人类伙伴的选择（D20）：宿主自带的 semver 以 `includePrerelease` 判定，`~0.2.0-rc.2`
  接受 `0.2.0-rc.3`、`0.2.0`、`0.2.1-rc.1`，拒绝 `0.2.0-rc.1` 与 `0.3.0-rc.1`。
- **CI 只能证明形状，宿主是否接受由宿主观测证明。** `docs/architecture/harness-host-spike.md` §11.9 第 4 条记录：复探用的是手写 JS 探针，
  「由构建产出的宿主入口与 client bundle」从未被宿主观测过。本 ADR 因此保持 **Proposed**：产物契约由 `tests/integration/harness-plugin-artifact.test.js` 判定，
  宿主接受由 ExecPlan 的 K1、K3–K6 判定，二者都有之后才请人类伙伴采纳。**Superseded by 归档计划D34（2026-09-30）**：两类证据均已有记录，人类伙伴已明确授权修订后整合本PR，本ADR采纳为Accepted。

## Rejected

- **tsdown**（备选，D5）：与宿主自身构建同源，但 `__ModuleLoader__` 包装的共享预设没有随运行时发布，仓库外同样要自己写包装；`deps.*` 在 pnpm 软链下的语义没有验证；
  直接依赖 14 个包；`engines.node` 比仓库窄。替换成本只在 `build.mjs` 与一个 devDependency，人类伙伴 2026-09-30 确认仍用 esbuild（D21）。
- **用 `publishConfig` 改写源 manifest**：安装件的真实形状取决于 `pnpm pack` 的改写行为，测试读不到它；`workspace:*` 依赖会被改写成 `0.0.0` 留在安装件里。
- **把 peer 写进源 manifest（含 optional 写法）**：非 optional 会把宿主 rc 包装进仓库锁文件；optional 写法可行，但把宿主契约放进了工作区 manifest，还要再写一条契约测试去守。
- **精确钉 `0.2.0-rc.2`**：能在宿主换 rc 时让插件被跳过，挡住 rc 之间的格式漂移；代价是每个 rc 都要重发。人类伙伴选了范围（D20）；这一取舍的风险登记在下面的 Consequences。
- **客户端外置 `@deepseek-ai/*` 通配**：非基线的宿主包 `require` 能通过构建，只在浏览器里失败。
- **占位组件写在 `apps/harness-plugin`**：apps 会因此持有 React 组件，违背「apps 只做壳」，也让 `@harness-projects/*` 打进 client bundle 这条路径得不到实测。
- **随包发 source map**：构建目录在仓库外时，map 的相对 `sources` 会经过家目录；#227 用不上，留给发布批次。
- **把宿主观测自动化进 CI**：CI 不能运行宿主，issue 的验收也要求构建不依赖宿主检出。

## Consequences

- **范围 peer 放行 `0.2.x` 内的任何 rc 与补丁。** 宿主在 rc 之间改变插件 API 或描述符格式时，插件不会被兼容闸门跳过，而是在运行时失败；升到 `0.3.0-rc.*`
  时插件会被跳过（并在宿主 stderr 留一行）。宿主升级时，`HOST_DSH_PEER_RANGE` 与测试里的独立字面量必须一起改。#228 引入 typed remote 描述符时决定是否收紧范围。
- **基线模块表与目标宿主线绑定。** `build.mjs` 与集成测试各持一份字面量（测试的一份是独立预期），取表的函数名每个宿主版本都可能变，键不一定变；宿主升级时两处一起重取，
  升级流程由发布批次（#230）写明。
- **`apps/harness-plugin` 不得依赖 controller / core / storage。** 宿主半边今天只有一行就绪行；#228 让宿主入口依赖它们时，必须先写 ADR 并修改
  `tests/contract/package-boundaries.test.js`，本 ADR 不预先放行。宿主 API 用本地最小结构类型而不是宿主的类型包，二者之间没有编译期绑定，#228 决定是否引入并收紧。
- **`packages/domain` 的 `ids.ts` 值导入 `node:crypto`**，client bundle 因此无法导入 domain / ui-model / client 的运行时值；#229 引入业务页面之前要拆出浏览器安全入口
  或改用平台无关的随机源。
- **安装件的三项暂缓项**：不带 source map、`private: true`、占位面板文案未本地化，分别留给发布批次与页面批次。
- **pnpm 打包会额外放进仓库根的 `LICENSE`。** 安装件 tarball 因此是五个条目而不是四个，`license` 字段取仓库根 manifest 的值，与随包分发的许可证一致；这是接受 pnpm 的行为，而不是绕开它。
- **验收在真实宿主上进行，需要人类伙伴参与**（退出并重启自己的桌面应用、截图）。因此本 ADR 在宿主观测完成之前不应被改成 Accepted；观测判据一旦变化，
  安装件四个文件的 sha256 变化即整组重跑。
