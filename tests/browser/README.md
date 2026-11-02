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

`test:browser` 沿用 `scripts/run-test-layer.mjs`：空文件集、零执行/全 skip 或解析失败均非零退出。普通 `pnpm test` / `pnpm verify` 暂不调度浏览器；持续 CI 接线归后继 PR。本层提供本地能力证据，不代表 #450 全部验收、安装 Harness 人类走查、#451 写入链路或 R1 放行。
