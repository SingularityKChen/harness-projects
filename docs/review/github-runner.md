# GitHub 评审 runner

一个被标记为 **ready for review** 的 PR，如何在这台机器上变成一次只读的 DSH 评审会话——同时不向互联网暴露任何东西。

[`docs/review/README.md`](README.md) 第 7 步描述的是同一条能力的公网 webhook 形态：GitHub 向一个你注册的 URL 推送 HTTPS 请求。那条路线需要入站通道（隧道或反向代理）。本文描述的是这里实际采用的路线，它不需要入站通道。

## 1. 为什么是这个形态

两个方向不可互换：

| | 谁发起 | 需要入站通道吗 |
|---|---|---|
| 自托管 CI runner | runner 通过出站长轮询主动拉取 GitHub 并接收 job | 不需要 |
| Webhook | GitHub 向你注册的 URL 发 POST | 需要 |

DSH 只提供 webhook 那一半：一个等待被调用的 loopback 端点（它的 webhook runtime 没有轮询、没有队列、没有重放）。自托管 Actions runner 补上缺的另一半——它持有出站长连接，收到的 job 负责把事件 POST 给那个 loopback 端点。GitHub 从不需要主动连到这台机器。

## 2. 链路

```text
PR 被标记为 ready for review
  → GitHub 事件（runner 已持有的出站长轮询）
  → 自托管 runner 执行 .github/workflows/github-review.yml
  → 向 http://127.0.0.1:3081/github 发送带签名的 POST
  → DSH webhook 端点验签，安排规则调用
  → 规则匹配仓库 + action，返回一个会话请求
  → 在仓库工作区中创建只读评审会话
```

触发细节：

- `pull_request_target` 配 `types: [ready_for_review]`：workflow 定义始终取自默认分支，因此 PR 无法改变这台机器上运行什么。PR 的代码从不被 checkout，也从不被执行。
- 该 job 只接受**来自本仓库**的 PR（`head.repo.full_name == github.repository`）；外部贡献无法让这台机器启动会话。
- 签名按字节对 `github.event_path` 计算 HMAC-SHA256；端点对**完全相同的请求体**验签。签名由 node 的 `crypto` 计算：密钥只从环境变量读入，**不进 argv、不落盘**。原因见 §6——这台机器上还有别的进程能读到进程表。
- `202` 表示"签名与 JSON 已接受，规则调用已安排"。它**不**表示规则已匹配或会话已创建。仓库不匹配或 action 不同都会被接受，然后被忽略。

## 3. 本机组件

| 组件 | 位置 | 说明 |
|---|---|---|
| Runner | `~/<runner-name>/` | 注册到 `SingularityKChen/harness-projects`，标签 `self-hosted,macos,arm64,dsh`；作为 launchd 服务运行 |
| Webhook 密钥 | `~/.dsh/.credentials.yaml`（`refs.DSH_GITHUB_WEBHOOK_SECRET`）与同名仓库 secret | 两处必须同值：workflow 用仓库 secret 签名，端点用本地凭据验签 |
| Overlay | `~/.dsh/profiles/web/github-review.overlay.yml` 及其旁边的 `github-ready-review-rule.mjs` | 固定仓库、工作区路径与端口 3081；取值是字面量，不用 `!!js` |
| Workflow | `.github/workflows/github-review.yml` | 把事件转发给本地端点 |

规则本身是上游的 `github-ready-review-rule.mjs`，未被修改：仓库是配置而不是代码，所以上游更新时可以直接替换该文件。

## 4. 运维操作

```bash
# runner 在线吗？
gh api repos/SingularityKChen/harness-projects/actions/runners \
  --jq '.runners[] | "\(.name)\t\(.status)\tlabels=\([.labels[].name]|join(","))"'

# 本地端点在监听吗？畸形请求期望 400/415；
# 000 或 "connection refused" 表示 overlay 没有加载。
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3081/github

# 带 overlay 启动 DSH。`--patch` 是 LAUNCHER 标志：必须放在 app 参数之前，
# `dsh web --patch ...` 会被这个 CLI 版本以 "unknown option '--patch'" 拒绝。
# 规范写法是 --profile web：
dsh --profile web --patch ~/.dsh/profiles/web/github-review.overlay.yml

# runner 服务，如果它停了
cd ~/<runner-name> && ./svc.sh status   # 或：./svc.sh start | stop
```

**值得知道的失败模式**

- **每个模型请求都失败并报 `REQUEST_EXTENSION: DeepSeek request extension preparation failed`，而 host 能启动、UI 正常。** 这是本套配置的陷阱，且不是 webhook 那几行造成的。DeepSeek 的 package-inventory 请求扩展（`,dsh_plugin_packages`，由 `dsh-plugin-package-inventory-deepseek` 贡献）把每个生效的 loader entry 解析到它的归属包。一个写成**文件模块**的 patch 行（`./github-ready-review-rule.mjs`）没有包名，于是解析器从模块所在目录向上找，找到**profile 自己的 `package.json`**——而 `identityFromManifest` 在该 manifest 声明了 name 却没有 version 时抛错。这个抛错让 `prepare()` 被拒，LLM 适配器就把它报成**每一次**请求上的 `REQUEST_EXTENSION`。出厂 profile manifest 不带 `version`，因此文档里"规则文件放在 profile patch 旁边"的布局会让所有模型流量中断，直到补上：
  ```jsonc
  // ~/.dsh/profiles/web/package.json
  { "name": "dsh-profile-web", "version": "0.0.0", ... }
  ```
  在这台机器上用 headless profile 与一个平凡的文件模块行双向验证过：没有 `version` 时该次运行以 `REQUEST_EXTENSION` 结束，有 `version` 时同一次运行正常作答。
- 端点未运行（DSH 没有带 overlay 启动）：workflow 以一条指名端点的清晰消息失败。其它一切不受影响——runner 不是门禁，没有任何 PR 检查依赖它。
- runner 离线：事件由 GitHub 在 runner 断连期间排队，重连后投递。
- 签名不匹配（本地凭据与仓库 secret 不同步）：端点返回 `401`，workflow 失败。
- 会话在仓库工作区中创建；端点只接受绝对路径，工作区在首次使用时创建。

## 5. 安全姿态

- **无入站暴露。** 公共接口上没有任何监听；runner 主动出站，workflow 只与 loopback 通信。
- **workflow 不能被 PR 替换。** `pull_request_target` 让定义留在默认分支，job 从不 checkout 或运行 PR 代码——它只读事件 payload。
- **最小 GitHub 权限。** workflow 顶层声明 `permissions: {}`：该 job 不 checkout、不调用任何 GitHub API（它只向 loopback 端点 POST），所以不需要任何权限。在自托管 runner 上，GitHub 默认给出的偏宽 token 权限是白送的攻击面，没有任何收益与之相抵。
- **密钥的作用域。** `DSH_GITHUB_WEBHOOK_SECRET` 只用于认证本地端点。它不授予任何对 GitHub 的出站访问，它启动的评审会话运行在 `read-only` 权限预设下。密钥只经环境变量交给签名进程：不进 argv、不落盘；Actions 的 secret 掩码只覆盖日志文本，不覆盖进程表。
- **临时文件不落在共享的可预测路径。** 端点的响应体写到 `$RUNNER_TEMP`，这是本次 job 专属、权限收窄的目录；不写系统级共享临时目录——那里的路径可预测，同机任何本地进程都能抢先占用。
- **会话从不写入。** prompt 禁止修改文件、分支、PR 或 GitHub 状态，并把事件 payload 标记为不可信元数据，必须从实时数据刷新。
- **public 仓库上的自托管 runner** 是要正视的风险：任何到达这个 runner 的 workflow 改动都会在这台机器上执行。这就是为什么触发方式是 `pull_request_target`（默认分支定义）、为什么存在同仓库守卫、以及为什么仓库设置应保持 runner 的 fork PR 策略为 *Require approval for all outside collaborators*。

## 6. 自托管 runner 的威胁模型

§5 的前几条描述的是**网络**边界：无入站监听、workflow 不可被 PR 替换、事件只走 loopback。这一节描述的是另一条边界，它由"这台 runner 不是一次性环境"直接推出（`AGENTS.md` §10 同一约束的成文）。

**为什么托管 runner 上的直觉在这里不成立。** 托管 runner 为每个 job 开一台用完即弃的虚拟机：job 结束，整台机器连同进程表、临时目录和磁盘上的一切一起销毁。因此"job 期间留痕没关系"的写法在那里成立——留痕的生命周期不超过 job。自托管 runner 相反：job 与登录用户的其它进程共享同一台机器。job 结束后，进程表里的残留、临时目录里的文件、以及任何写盘的东西都继续存在，并且与你不希望它们看见这些内容的本地进程共存。**在托管 runner 上可以忽略的写法，在这里不是。**

**威胁主体是同机的其它本地进程，不是网络攻击者。** 公开仓库 + 自托管 runner 的网络面已经被收窄到接近零：没有入站监听（§1），定义取自默认分支且不执行 PR 代码（§2），loopback 端点不对外。剩下的现实攻击者是同一台机器上、能读到该用户进程表与临时目录的其它进程——包括你为别的目的启动的代码，以及任何以该用户身份运行的、来源不可控的进程。它不需要攻破任何网络边界；它只需要在这台机器上运行。

三条约束各自挡住什么：

1. **凭据绝不进 argv。** 同机进程可以读进程表——这类平台上的默认 `ps` 输出就包含命令行参数。把密钥作为命令行参数传给子进程，等于在子进程存活期间把它交给机器上每个能读进程表的进程。Actions 的 secret 掩码在这里帮不上忙：它只对日志文本做替换，不覆盖进程表。约束是凭据只经环境变量或文件描述符传递。环境变量同样不是密不透风（同用户的进程也能读到），但它不进入任何"会被例行打印出来"的路径——进程列表、崩溃报告里的命令行、shell history——把暴露面压到最小。
2. **临时文件只写 `$RUNNER_TEMP`。** `$RUNNER_TEMP` 是本次 job 专属、权限收窄的目录。系统级共享临时目录的路径对任何本地进程都可预测，因此它可以抢先创建同名文件（符号链接攻击），或在文件存在期间读取它。响应体里可能含有事件 payload 的内容；把它写在可预测的共享路径上，就是把 job 数据交给同机其它进程。
3. **不调用 GitHub API 的 job 声明 `permissions: {}`。** 该 job 不 checkout、不调用任何 GitHub API，因此不需要 `GITHUB_TOKEN` 的任何权限。GitHub 默认给出的是一组偏宽的权限；在一台长期存在、与其它进程共享的机器上，一个用不到的 token 只是多出来的一份可被滥用的凭据。空映射把"用不到"变成"拿不到"。

这三条不是风格偏好，而是同一条判断：**只要数据或凭据在这台机器上多存在一处、多暴露一个可预测的入口，就多一个同机进程能拿到它的机会。**
