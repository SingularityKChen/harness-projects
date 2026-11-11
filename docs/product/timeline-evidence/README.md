# 只读 Timeline 工程视觉证据

本目录为 #607 独立验收后修复 V1/F1/U1 的生产组件截图；采集于 2026-11-11（修复基线 `431a03826267`），浏览器为仓库锁定的 Chromium，viewport 高度 900px。全部为合成测试数据，没有真实平台读取、安装 Host 或人类审美接受。可重跑命令在所属 ExecPlan 的 Batch 1。

## 截图身份与比较条件

- `reference-*`：合成安全 read → 生产 `WorkItemApp` / 唯一详情；七个条目及来源目标日与 [v3 light](../release-visual-target-v3/timeline-light-1440-v3.png)、[v3 dark](../release-visual-target-v3/timeline-dark-1440-v3.png) 相同。显式时钟为 `2026-11-10T15:59:30Z`，展示日为 2026-11-10 SGT；字体 14px、Host 角色值来自仓库 v3 palette。
- `composed-*`：原生 Fake Planning Provider → Core → 临时 SQLite → 实际 Host / typed remote / client / store → 生产 `apply`。28 个可读条目含独立目标日与迭代窗口、无值、无效、零天、0001/9999 与长标题；截图筛到 `Timeline both` 展示双 lane，测试另断言全部 20+ 行及无筛选的有界 DOM。复用同一时钟、字体与 v3 Host 角色值。
- 文件名包含宽度、主题与文字百分比。`content` 截图将局部滚动区滚至日期内容，证明窄区或 200% 文字仍可到达完整标题和来源日期；全量 24 组合、滚动位置与几何 JSON 留在忽略的运行态目录。

## 与静态 v3 的实际差异

沿用中性分隔、来源目标日菱形、自然长行、同一查询及详情。真实来源迭代采用独立虚线 lane，不是任务工期。宽轴增加一行周导航，今天日期与 `Asia/Singapore` 始终默认显示在同一行的“日期说明”summary 中，扩展图例放在原生披露。普通行只显示来源类别与标题，日期由轴上完整 date-only 文字表达；同一完整来源事实保留在 AT 文本中。复杂迭代、零天与无效窗口继续有可见说明，窗口外日期保留完整文字且只对窗口外的优先日期提供定位。容器低于 40rem 时直接展示每行完整来源文字，隐藏几何导航与定位。日期跨度不决定画布宽度。同 7 项 / 1440 / 14px / light、dark 的实际首行均为 y281.33，相对 v3 y240 增加 41.33px（小于一行 44px 导航）；正常短行 71.19px，相对 v3 约 68px 增加约 3px，来自实际字体与 44px 标题触达区，未锁行高或截断内容。7 项全部在首屏，真实长标题与复杂来源行自然增高。没有拖拽、自动排期或推导任务区间。

## 代表性截图

| 条件 | 生产组件 + 同 v3 合成安全 read | 实际 Host 组合链 |
|---|---|---|
| 1440 / light / 100% | [查看](reference-source-1440-light-100.png) | [查看双 lane](composed-source-1440-light-100.png) |
| 1440 / dark / 100% | [查看](reference-source-1440-dark-100.png) | [查看双 lane](composed-source-1440-dark-100.png) |
| 1024 / light / 100% | [查看](reference-source-1024-light-100.png) | — |
| 1024 / dark / 200% | — | [完整来源文字](composed-content-1024-dark-200.png) |
| 390 / light / 100% | — | [完整来源文字](composed-content-390-light-100.png) |
| 390 / dark / 200% | [完整来源文字](reference-content-390-dark-200.png) | — |

浏览器断言包括 header / marker 对齐、各图形属于本行、自然行高、无整页横溢、完整文本可达、窗口外行保留、原生键盘链接/唯一抽屉/回焦、SGT 午夜及撤权后迟到帧无泄露；另覆盖定位远日后 List/Timeline 往返保留窗口、单个定位来源被遮蔽后同次清掉旧 header，以及读门恢复后回到当前安全周。截图和源测试不替代 #599 安装态接受与 R1 裁决。
