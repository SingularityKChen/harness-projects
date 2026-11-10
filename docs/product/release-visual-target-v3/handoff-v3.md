# release-workspace-v3 · 静态视觉与颜色交接

日期：2026-11-10，Asia/Singapore。状态：完整矩阵独立评审及D1/S1/S2三项定向复核均已通过，参考已冻结；尚无人类对v3的完整视觉接受。v2版式获原则认可，v3只修订颜色；这不是产品已实现、已安装Host、真实可访问性或#599最终验收。

## 直接审阅

- [List/Board明暗主参考](release-workspace-v3.png)
- [六面浅色](overview-light-v3.png) / [六面深色](overview-dark-v3.png)
- [1200/1024/390浅色](responsive-light-v3.png) / [深色](responsive-dark-v3.png)
- [v2→v3同内容、同1440视口比较](v2-v3-exact-viewport-comparison.png)：v2的绿倾向颜色未获接受；其版式保留。
- [当前源码合成基线与v3](source-baseline-v3-comparison.png)：同7项源限定编号、标题/长标题、规范及原生状态、迭代与目标日期；工程提示基线为“无”，v3工程文字是设计示例，没有声称完整工程快照相同。基线源为`982517c73951563797612472339970f015e7c62f`，不是实际安装件。
- [List浅色](list-light-1440-v3.png) / [深色](list-dark-1440-v3.png)
- [Board浅色](board-light-1440-v3.png) / [深色](board-dark-1440-v3.png)
- [Timeline浅色](timeline-light-1440-v3.png) / [深色](timeline-dark-1440-v3.png)
- [Delivery浅色](delivery-light-1440-v3.png) / [深色](delivery-dark-1440-v3.png)
- [唯一Detail浅色](detail-light-1440-v3.png) / [深色](detail-dark-1440-v3.png)
- [Settings浅色](settings-light-1440-v3.png) / [深色](settings-dark-1440-v3.png)
- [控件状态浅色](states-light-1440-v3.png) / [深色](states-dark-1440-v3.png)
- [页面/保存状态浅色](page-states-light-1440-v3.png) / [深色](page-states-dark-1440-v3.png)
- [显示选项打开浅色](display-options-light-1440-v3.png) / [深色](display-options-dark-1440-v3.png)
- [全局筛选零结果浅色](filtered-zero-light-1440-v3.png) / [深色](filtered-zero-dark-1440-v3.png)
- [真实空来源/未读取/权限拒绝分别呈现，浅色](empty-states-light-v3.png) / [深色](empty-states-dark-v3.png)
- [390宽List](list-light-390-v3.png) / [390宽唯一Detail](detail-light-390-v3.png)
- [390宽交付完整滚动内容浅色](delivery-light-390-v3.png) / [深色](delivery-dark-390-v3.png)
- [颜色细部浅色](color-detail-light-1440-v3.png) / [深色](color-detail-dark-1440-v3.png)

以上链接只指向选取的35张PNG。完整六面×明暗×四宽度矩阵为本机审阅证据；实际产品行为仍要分别验证。静态SVG及Python/JS资产生成工具不交付到产品或可运行原型，不把保留的产品实现隐藏在#603零预算内。

## 保留的版式、文字与事实

实际v2正常1440表头y196、短行58px。四张首轮List/Board的SVG元素几何、字体属性与任务文案与冻结v2逐元素一致；比较时只忽略fill/stroke和版本证据标记。后续六面沿同一源场景布局，不重新选择字体、字号、卡片高度、控件、数据顺序或导航结构。字族继承Host，页面标题22px/600、任务14px/500、来源12px；表头44px、自然长行78px；透明Board列和内容自然增长卡片保留。

当前List/Delivery只显示已存在目的地；Board/Timeline整幅图明确标为后续接线目标，不能为#604提前激活。5/8表示本示例List字段配置，不是Board状态列数量；不修改产品默认列。完整8字段为工作项、内容身份、规划状态、迭代、目标日期、工程提示、来源、新鲜度。显示选项参考保留排序、清除条件/恢复默认列、重置列宽与拖动/键盘调宽路径；实施沿既有native披露与当前owner，不新造popup状态。

List保持语义table、sticky、局部XY滚动和全部字段可达；390未新增移动卡片数据模型。Board只消费授权安全query结果与规范`planningStatusKey`，Unknown一列，卡内保留原生“待确认（未映射）”；工程footer不决定规划分组。数量仅覆盖已加载授权子集。有效筛选零结果是一条全局说明，才提供清除动作，不保留4个0列井；来源已确认为空、未读取和denied不相互冒充。撤权不得留下旧title/number/count/group/facet。

Timeline使用同7项的目标日或未排期，不给任务编造工期。任务区间/迭代窗口仅在下方单独标作日期语法示例，不参与上述任务排期；只有实际来源提供时才能成为产品条带。今天线有明确Asia/Singapore显示日历/时钟；date-only不作UTC偏移。

Delivery保留实际“仓库”（示例仓库id为example/project）选择、“刷新本页交付”、独立页码/总数/读取状态以及“上一页/下一页”。7个授权fixture条目按现有每页20项逻辑得到第1/1页、共7项，前后页均禁用，不捏造额外总数。各行沿实际summary的“变更请求/流水线/检查”三组信息；不画List搜索、显示列或排序。PR/CI为设计示例，工程与Planning正交。390交付图为1900px高的完整滚动内容参考，保留底部分页路径，不伪装固定分页条。Detail保留同7项列表背景与唯一当前对象、510px参考几何、展开/关闭/开始工作；inert、Escape与安全回焦仍归既有实现。Settings使用源码已有“规划连接/字段映射/执行/仓库”任务导航，160px+32px沟槽+最多720px单列内容；窄容器沿现有task chooser，不增加app侧栏、游离能力栏或新配置。

## 唯一颜色表与公开来源

固定公开包：`@deepseek-ai/dsh-client-ui-theme@0.2.0-rc.2`。SRI核对为`sha512-1pdHD6QfRGalG3BchmvvuVZportaMcSGQ1lwjFlddB2oyZrHk4lsYMYN8l1icQDgB7VrA4cA1VIlYlUfl7qbLw==`。以下是其默认CSS角色或明确的消费层推导，不是当前用户安装件的computed style。

| 静态职责 | Light | Dark | 来源 / 实施消费 |
|---|---|---|---|
| 画布/List连续基底 | `#FFFFFF` | `#151517` | `--dsw-alias-bg-base`；缺失回退`Canvas` |
| Card/Detail/Input | `#FFFFFF` | `#232324` | `--dsw-alias-bg-layer-1`；缺失回退`Canvas` |
| 真正更高浮面 | `#FFFFFF` | `#2C2C2E` | `--dsw-alias-bg-layer-2`；不涂整列 |
| Hover实面 | `#F1F3F5` | `#353638` | `--dsw-alias-interactive-bg-hover-solid` |
| Pressed overlay | `#2631481A` | `#FFFFFF24` | `--dsw-alias-interactive-bg-active`，在当时背景alpha合成 |
| 主文字/标题/当前导航 | `#0F1115` | `#F9FAFB` | `--dsw-alias-label-primary`；缺失`CanvasText` |
| 必要次信息/来源/日期 | `#61666B` | `#CFD3D6` | `--dsw-alias-label-secondary`；缺失回退正文，不用opacity削弱 |
| 非关键内容线 | `#0000001A` | `#FFFFFF1F` | `--dsw-alias-border-l2`；按真实背景合成 |
| 一般Card轮廓 | `#00000029` | `#FFFFFF33` | `--dsw-alias-border-l4`；不冒充必要控件边界 |
| 必要Input/Select边界 | `#7D7E81` | `#979798` | 消费层既有`--hp-control-border`沿主字54%与layer1混合；不是Host已有同名token |
| Selected面 | `#F5F6F7` | `#212123` | `--dsw-alias-bg-multi-select`；不混accent或success |
| Selected边标/轮廓 | `#61666B` | `#CFD3D6` | secondary；保留原2px形状，独立于focus |
| Primary填充/字 | `#0F1115` / `#FFFFFF` | `#F9FAFB` / `#0F1115` | primary-fill与primary-foreground成对 |
| Primary hover | `#43454A` | `#EBEEF2` | primary-hover与成对foreground |
| Focus/日期图形/链接下划线 | `#4176E6` | `#7AAAFF` | Host ring优先；fallback business-primary；链接装饰alias-link |
| Success/Warning/Error辅助标记 | `#22C55E` / `#F59E0B` / `#EC1313` | `#22C55E` / `#F59E0B` / `#F25A5A` | 实际语义冗余标记；必要文字仍为主/次文字 |

所有主要面、文字、线和选择边不再使用green/olive；绿色仅出现在已完成等真实成功标记。主按钮黑白，导航中性短线，小号链接用中性字与明确下划线；不拿蓝、绿或临界红色小字承担必要信息。

未来产品继承唯一Host主题和字体，不写`:root`颜色、不新增theme toggle/store/router、brand检测或另一套明暗选择器。现有`--hp-*`只是消费别名。缺角色时使用`Canvas/CanvasText`或原生成对`ButtonFace/ButtonText`；缺`color-mix`使用`CanvasText`边界，不加palette/polyfill。Focus保留Host pointer-modality可能为transparent的合同，不能为了截图强制ring。Theme CSS由Host继承，禁止import theme JS/bootstrap/ThemeRuntime/overrideTokens；当前Loader baseline没有theme包。

Host公共Button primary可优先评估，但以实际组件运行的配对文字与样式为准；发行角色不等于已安装组件证据。选择组件与库需维护/ABI/主题收益及同build raw/gzip/packed/input/external/React-singleton证据，不以“原生能点”拒绝必要组件，也不全量引入框架。

## 对比度、状态和验证边界

候选色对计算：Light次字/selected 5.360，Dark次字/selected 10.671；必要输入边界White 4.059、Dark card 5.381。Light蓝/White为4.235，不承担12–14px必要蓝字；Light success/White 2.279只作冗余标记；Light error/White 4.498不能向上舍入成普通文字4.5通过。小号错误/状态标签保持中性色。弱内容线/面差不是唯一控件或状态线索。

这些是固定默认色的线性sRGB计算，不是当前Host、自定义主题、alpha/hover/disabled所有配对、200%文字、AT或整页WCAG通过。实际组件还要验证对比、遮挡、Tab/Enter/Space、Escape、焦点返回、dialog隔离与窄屏滚动。视觉面36px不证明44px触达；未来真实实现的44px区域不能互相覆盖。

状态矩阵区分default/hover/pressed/selected/focus/selected+focus/disabled/loading/error；错误格明确写输入无效、刷新失败、开始工作失败或读取失败，并给安全恢复说明，红色只作冗余标记。主动作加载沿实际开始工作提交按钮写“正在提交”，普通刷新才写“正在刷新”。页面状态分别覆盖partial、stale/offline、denied、unknown、pending save、result unknown、save error与Host确认；unknown与不确定结果均为中性，不冒充红色错误。Pending/unknown不显示Saved，不制造freshness或重发未知操作；只有Host ack/reconcile后才显示确认。动效至多120ms并服从reduced-motion，无漂浮或装饰动画。

## 工程接口与门禁

维持WorkItemListPage挂载/query/列宽owner；table|board受控renderer消费同次安全query结果，ProjectPage只拥有mode与唯一detail opener。没有Provider直接调用、第二store/router/theme、数据迁移或写入。上层界面不能篡改Planning事实。

#603需要人类针对具名v3、层次/密度/字体/控件/总体外观给明确接受或修改意见；v2版式认可不自动扩大成v3颜色/全视觉通过。#604/#605在批准后仍须相对实际源码/PR base重估技术gross<800、docs<1300；原预测不自动有效。完整scope触线则保留父项并细化独立闭环，不删安全/审美证据保数字。最终确切source/artifact/Host、真实数据与安装美观仍由#599验收。

## 研究的一手出处

- [W3C CSS Color 4](https://www.w3.org/TR/css-color-4/)：L/C/h职责；OKLab L不等于WCAG相对亮度。
- [Radix gray选择](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette) 与 [scale角色](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)：中性/带色灰与面/边/文字角色，未引入Radix包。
- [Primer颜色原则](https://primer.style/guides/color/overview/) 与 [VS Code theme roles](https://code.visualstudio.com/api/references/theme-color)：职责随主题继承，不复制品牌hex。
- [Claude Code终端配置](https://code.claude.com/docs/en/terminal-config)：多个theme路径；不把网站米白当Claude Code唯一皮肤。
- [Linear当前设计解释](https://linear.app/now/behind-the-latest-design-refresh)、[IBM 2x Grid](https://www.ibm.com/design/language/2x-grid/)、[Carbon任务型排印](https://carbondesignsystem.com/elements/typography/overview/)：保留v2对齐、层次和内容先行，不复制侧栏、字体或营销画面。

研究原则转成本产品的选择属于本次设计判断；没有参考方为本产品背书。公开theme默认角色与源代码证据不替代用户实际Host观察。

最终独立评审三处定向修正仅涉及Delivery与状态资产，以及引用它们的overview/responsive contact；List/Board四张主参考的几何、颜色、任务内容均保持不变。

冻结记录：2026-11-10，release-workspace-v3。35张选定PNG及本交接、角色表以同一manifest中的SHA-256锁定；独立设计/语义复核通过不等于人类美观接受。后续人类决定应针对本manifest摘要单独记录，不回写已冻结图像与元数据。
