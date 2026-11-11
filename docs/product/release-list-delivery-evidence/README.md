# 共享工作区、List 与 Delivery 源码呈现证据

2026-11-10，Asia/Singapore。本页只覆盖 #614 / PR #611 的能力闭环；完整 #604 还需详情、四任务设置和表单精修的累计验收，实际安装产品由 #599 判断。

## 身份与场景

准确基线为设计父提交 `d449f90b12a114cea78f2de97953a4266204b2b9`，生产候选为 `4c5eff2a908813baf629de7cdc8987fe3e67bb74`，两者捕获与打包时均为 clean。参考为获人类批准的 [release-workspace-v3](../release-visual-target-v3/README.md)，冻结 manifest SHA-256 `d714cea12faa96bb6411c4e19c3712914af98bad199dd3787cdb419ecbf48c29`。

这些画面使用真实生产组件、client EntityStore 与相同七条安全示例；Provider 端口被受控样例替代，工程值“无／缺口原因未知”属于该示例输入。参考中的 PR/CI 文案是设计示例，不据此补造工程事实。来源限定编号、原生状态、迭代与日期保持；默认5显示列、完整8字段访问不改。44px 顶栏是测试环境包络，不是新增产品壳；这不是安装 Host 或完整 Provider→Host 线上链路证据。

精确 before 通过构建钩子读取基线提交生产文件，使用与 after 同一 fixture、主题输入与视口；未改基线工作树。after 在最后生产修改提交后重启载体。公开 Host 默认角色只作为受控主题输入，实际 Host 可覆盖；未引入 theme JS、第二主题状态或新依赖。

## 同主题与同宽比较

1440 图为左 before／中候选／右固定参考；点击原图可放大。390 联系表分别显示 List、Delivery、已填查询以及真实路由选中与焦点。右侧旧详情仅证明唯一实例和回焦，局部 v3 排印由 #604 后层交付。

![List 浅色1440](list-light-1440-comparison.png)

![List 深色1440](list-dark-1440-comparison.png)

![Delivery 浅色1440](delivery-light-1440-comparison.png)

![Delivery 深色1440](delivery-dark-1440-comparison.png)

![浅色390](narrow-light-390-sheet.png)

![深色390](narrow-dark-390-sheet.png)

## 有界验证与观察

本轮独立复核完整主图与状态矩阵，并验证生产/fixture指纹及88份PNG（含联系表、对照与定向截图）。正常1440/1200下表宽1392/1152、表头y195.984/44px、短行58px；390 Delivery普通短行153.17px。长文、异常与文字放大自然增高，不把这些正常样例数值当全局硬高度。

真实交互覆盖查询、排序、全部字段、独立列宽重置、自动/手动列宽与取消恢复、scope切换、拒读和唯一详情焦点；Delivery保留仓库、本页刷新、真实1/1与20项多页、本地末行与分页可达。填值后字段目的常显；真390内容槽内200%末组与分页另有实际滚动截图。源码、功能和视觉分别取证，独立代码与视觉验收均通过。

最初86契约/61浏览器/9边界通过；视觉修复与旧scope契约订正后，相关23浏览器、13渲染契约、15通知契约、1真实scope场景及typecheck通过。独立复验另检查F1/F2与新scope契约，未把旧head结果当新head完整suite；最终当前head必需CI及双向issue/线程由PR门回读。托管旧筛选项文字断言对齐后，完整本地 `pnpm test` 实际通过1550契约、2185集成、226 E2E，共3961且零fail/skip；后层仍需在最终组合源上验收完整 #604。

未验证安装件、所有自定义主题/浏览器/AT或完整WCAG；200% fixture字号验证不等于所有浏览器整页缩放。源安全事实、Host确认与工程事实正交；未写Planning状态或Provider。重放入口是 `tests/fixtures/table-geometry-browser.mjs` 的 reference 场景和对应 header/query/resize/Delivery 浏览器测试；构建入口是 `apps/harness-plugin/scripts/bundle-report.mjs`。

## 公开静态文件指纹

| 文件 | 尺寸 | 字节 | SHA-256 |
|---|---|---:|---|
| `delivery-dark-1440-comparison.png` | 4320×940 | 391350 | `425a1fdb3e03e0d7bf73d47e73133137e420a1891e6ae7ea0dc5351e7fed3f41` |
| `delivery-light-1440-comparison.png` | 4320×940 | 389663 | `33c07f8e83c0d80fae3fc52945902a39c5e53e61335bec76094bc3782b72b99f` |
| `list-dark-1440-comparison.png` | 4320×940 | 444844 | `9203c8b62de060681a3b02df770c4fc37e4a86e8036bdfc7f5f1c6ea7f133c2c` |
| `list-light-1440-comparison.png` | 4320×940 | 443820 | `486d4cbb52f3e1750d7dd22d1e3c286436d92d7d9453209235d75ed1b90aecb2` |
| `narrow-dark-390-sheet.png` | 1560×940 | 313632 | `478b53396780dc441b1009023731bad0a088858c3396c3495216a711795a7951` |
| `narrow-light-390-sheet.png` | 1560×940 | 308607 | `5b209e4d99c7ec070f2fad6aa5d539d8d715401b2368ca4a8e413ca5e999ca6a` |


## MMP 精选对照补齐（2026-11-11）

首轮正常画面与绿色检查的完整性结论 Superseded by 本节组合反例与作者修复证据；既有图片仍归原捕获 head。以下拼图保留原始视口像素，宽图每列缩至600px，窄图保持390px；可打开原图检查。源码夹具仍为真实 Header、WorkItemApp 和 EntityStore，受控读取端口不代表安装 Host 或线上 Provider。

历史宽度图取自2026-11-10已有捕获：左为 `d449f90b12a114cea78f2de97953a4266204b2b9`，右为 clean 候选 `4c5eff2a908813baf629de7cdc8987fe3e67bb74`。四行依次 List1200、List1024、Delivery1200、Delivery1024；900px高、100%字号、同七条参考数据、冻结公开 Host 角色输入。来源与精选PNG hash见 [历史宽度索引](mmp-historical-width-manifest.json)，旧图不冒充本轮修复。

![历史浅色1200与1024](mmp-historical-widths-light-sheet.png)

![历史深色1200与1024](mmp-historical-widths-dark-sheet.png)

以下本轮对照左为 `7aa347b7051b3df38c8a72ac1580fc77b42de539`，右为源码 clean 的 `0992a703029949f9a8aba66231bd37df5ee7e7d2`，相同fixture输入。每图依次1200/1024参考七项、1200长文120可读项+1 redacted；Unknown保留来源原生“待确认”。长文及离线状态使用系统Canvas fallback，参考场景使用冻结公开Host角色；两主题分开，字体14px。

![本轮浅色宽度与长文](mmp-width-long-light-sheet.png)

![本轮深色宽度与长文](mmp-width-long-dark-sheet.png)

离线陈旧拼图上下为390×900与390×480，200%字号即根字体28px。四列为修复前提示、修复后提示、修复前最大滚动、修复后最大滚动；仅滚实际auto/scroll owner，保留所有安全事实，没有裁字来假装可达。修复后表格分别位于y618.80–884.80及198.19–464.19；尾部redacted行真实命中，最后可读链接命中并能打开唯一详情。

![浅色离线陈旧与200%](mmp-offline-stale-200-light-sheet.png)

![深色离线陈旧与200%](mmp-offline-stale-200-dark-sheet.png)

[本轮精选来源索引](mmp-capture-manifest.json) 包含捕获时间、准确head/base、源码/fixture SHA-256、主题/字号/数据身份和拼图hash；完整原始运行日志与个图hash由本地独立复核保留。新图与旧图分别标记，不因后续重放改变归属。本地验证只覆盖源码组合；200%字号不等于所有浏览器缩放/AT，实装、UAT和R1仍独立。
