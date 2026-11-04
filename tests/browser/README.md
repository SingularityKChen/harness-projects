# 生产组合浏览器测试

在检出本层的工作树根运行：

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test:browser
```

`playwright` 是精确锁定的开发依赖，Chromium 由该版本提供。安装属于准备步骤；测试命令不下载依赖、浏览器或业务数据。缺少浏览器必须失败，不回退到系统 Chrome、SSR 或 skip。Linux 环境若缺系统库，由环境准备阶段使用 `pnpm exec playwright install --with-deps chromium` 安装。

六个业务具名用例分别验证真实 UI 创建、非空 Issue/Draft/遮蔽项与焦点、Web canonical/history/deep link、断连与恢复、真实 Host 重建代际、撤权后迟到返回的 canary。每例使用全新临时 SQLite、loopback 服务和独立 BrowserContext；生产 Host/controller/remote/client/sync/store 与 React 页面始终是唯一事实链。Fake Provider 仅提供离线内容与权限/故障边界。

共享载体 `tests/fixtures/execution-drawer-browser.mjs` 默认保留执行抽屉种子；`seed: 'empty'` 不预造工作区，`seed: 'read'` 增加 Draft 来源记录。`/projects/**` 入口组合真实 `browserHistoryPort`、`createItemNavigation` 与 `WorkItemProjectPage`，只订阅一个生产 supervisor/store。插件入口继续通过真实 `apply`，插件局部导航没有浏览器 Back 语义。

控制面可暂停真实 Provider 返回或真实 baseline 的传输，暴露 held 数量与实际已接受 baseline 的只读 descriptor；撤权由 mounted Provider 方法拒绝和 capability permission 共同表达。测试先等 barrier 已进入，随后触发拒读或真实 Host 重建，最后释放。Core 的同 epoch refresh 单飞，因此撤权并发使用 transport hold，不把第二个刷新误当作独立 Provider 请求。

单例截止 60 秒，suite 截止 120 秒，动作/条件等待截止 7 秒；没有固定 sleep。失败时输出 `test-results/composed-browser/<case>/failure.png` 与 `trace.zip`，目录已经被仓库 `.gitignore` 忽略。after/abort hook 在 server acquire 前注册；资源 adopt 在 await 前后检查关闭状态，晚到资源立即关闭并停止后代创建，finally 按逆序尝试全部释放。额外生命周期用例以真实 server/browser/context/page 四阶段 barrier 验证取消，无 sleep；100ms timeout 负控须自行非零退出。清理释放 barrier、卸载页面、关闭 browser/context/Host/server/SQLite，仅清理本例临时目录。浏览器所有非同源请求均 abort 并使测试失败，Host fixture 也拒绝业务网络。

`test:browser` 沿用 `scripts/run-test-layer.mjs`：空文件集、零执行/全 skip 或解析失败均非零退出。普通 `pnpm test` / `pnpm verify` 不调度浏览器；CI 的独立 browser lane 运行本层。本层提供离线工程证据，不代表安装 Harness 人类走查、真实平台端到端验收或 R1 放行。

## 写入与恢复组（#451）

`workspace-execution.test.js` 的四个具名流程沿用上述 loopback carrier，使用 `execution` 种子。页面打开前执行上下文、run、PR 对象和创建账单均为零；种子不调用 Start Work，也不写 fallback。`composed-execution-platform.mjs` 只装配外部端口，不实现第二个应用/store：实际 Local Git 创建临时分支和磁盘工作树；确定失败时由实际 human Provider 签发人工运行；PR 使用实际 GitHub Development Provider 加合成 GraphQL transport。主执行是离线 Fake 端口，没有模型调用。

四个流程分别核对：真实 UI Start Work 与重复提交的唯一副作用及 Escape/focus；明确拒绝才人工备用而 unknown 零备用；PR 已创建但 ack 丢失时保持 unknown，关闭/重开 SQLite、Host 和新 peer 后恢复原请求且不重发 create；Delivery 的 failed/unknown/passed/stale、异提交/异仓库成功隔离及未开始的另一工作项不继承 CI。CI 按提交归属，同提交不同分支不是本组另立的隔离约定。远端 PR/CI 是显式合成状态，不是实际 GitHub 写入或录制证据。

`pnpm test:file tests/browser/workspace-execution.test.js` 只运行四流程；`pnpm test:browser` 覆盖全层。沿用每例 60 秒/动作 7 秒截止、同源网络限制、失败截图/trace 和 abort 清理。两项隔离 mutation 分别移除真实 Host Start Work dispatch、让 Core PR resume 重发 create，须由上下文缺失和第二次创建请求断言失败；mutation 不进入共享源码或提交。实际安装 Host、人类 UAT 和 R1 判定仍不由这些测试成立。

键盘判别覆盖由首个 Start Work 流程承担：真实 Tab 到 Issue opener 后 Enter 打开抽屉，Tab 到开始工作按钮后 Space 展开，Shift+Tab 后重新 Tab 验证原生 select 可达，键盘 typeahead `L` + Tab 选择仓库并核对实际 value，再键盘输入分支与 Tab/Enter 提交。未用程序化 focus 跳过导航；使开始工作按钮退出 Tab 且阻断键盘激活的生产变异必须被 `Tab order cannot reach 开始工作` 断言杀死。该证据不声称验证操作系统原生弹出菜单。
