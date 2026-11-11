# 只读 Planning Board 的实际源码与交互证据

2026-11-10，Asia/Singapore。候选源码`f23b7d398ce7d4aa4d323b357597777c5af997ab`，抓图时tracked树干净。本轮修复真实44px标题链接命中区、唯一筛选零结果说明，并补齐旧Provider响应确实返回生产reader后被拒绝的证据。独立代码、视觉、交互与图像身份复评均通过；这不代表安装或发布接受。

历史39源码图像与原manifest的身份保留不变。本目录after图已由f23重新拍摄替换，不能再归属39。before仍是精确父层558ac7bc的生产UI导出，与当前父层22db967的475个源码文件等价；不把旧before改称在新head抓图。

| 对照 | 浅色 | 深色 |
|---|---|---|
| 精确父层 List / 无Board（558ac7bc） | [before](parent-list-1440-light.png) | [before](parent-list-1440-dark.png) |
| 固定批准静态参考 | [reference](../release-visual-target-v3/board-light-1440-v3.png) | [reference](../release-visual-target-v3/board-dark-1440-v3.png) |
| 1440 新候选生产UI+合成读取输入 | [after](board-1440-light-100.png) | [after](board-1440-dark-100.png) |
| 1024 局部水平滚动 | [after](board-1024-light-100.png) | [after](board-1024-dark-100.png) |
| 390 同组语义纵排 | [after](board-390-light-100.png) | [after](board-390-dark-100.png) |

[390深色200%文字](board-390-dark-200.png)、[390自然长卡](long-card.png)均为本轮新图。短标题anchor实际44px，增加的卡高是该真实触达区域所需，没有固定整卡高度；长标题继续自然增高。列透明、16px间距、卡padding/gap12px及Host中性色角色保持。

本轮在1440/390×明暗四场景量得anchor高44px；链接下沿内2px确实命中anchor并由`hasTouch` tap打开唯一详情，来源、metadata与卡外测试点均不命中anchor。[390深色命中区场景](hit-target-390-dark.png)。键盘Tab/Enter/Escape与修饰键的既有受影响回归保持通过。这不是实际硬件触屏或全页WCAG声明。

| 真实 composed 场景 | 事实 |
|---|---|
| [原生Unknown](composed-native-unknown.png) | 真实Fake Provider原生option未映射，经SQLite/Host投影保留Native review与来源编号 |
| [partial](composed-partial.png) | 不可锚定redacted项产生缺口，可见已确认项仍为当前值 |
| [授权断网](composed-authorized-offline.png) | 保留已授权最后快照并明确陈旧 |
| [abort旧baseline / 拒读](composed-denied.png) | 旧watch被abort；仅证明取消路径，不冒称迟到frame已抵达 |
| [实际迟到响应，仍拒读](composed-actual-late-reply-rejected-false.png) | Provider旧成功值已取得、撤权后实际returned=1；迟到unary已解析，并由当前权限复核返回unavailable/failed |
| [实际迟到响应，仅声明恢复](composed-actual-late-reply-rejected-true.png) | 未做新确认的权限声明恢复不能复活旧值；returned=1后由既有epoch/round门返回stale_revision/failed |
| [唯一详情/选中](composed-board-selected-detail.png) | 安全route派生selection，唯一drawer与opener保持 |

两个实际迟到路径都保持SQLite/卡/native/来源号/count/group/facet/selection脱敏、外部write账单为空；不是仅观察held=0。真实UI、同一Host/Core/SQLite与既有bootstrapWorkspace接口组成唯一链，未新增替代App/store或生产调试API。

[真实空输入](empty.png)与[读取能力未确认](unknown-read-capability.png)是合成输入经真实App；不与卡片规范Unknown混淆。筛选无匹配只显示一处global说明，redacted-only中性空面保留。

本轮窄浏览器29/29、合同52/52、Board干净候选6/6、typecheck/边界通过。原39源码树的完整3964通过记录仍保留其历史身份；它含两项既有SSR warning，不是零warning，也未在f23重跑。

冻结批准manifest SHA-256仍为`d714cea12faa96bb6411c4e19c3712914af98bad199dd3787cdb419ecbf48c29`。静态工程示例没有注入：实际日期、来源身份和工程“无”保持真实输入。本叶不宣称完整原生空列schema、可写Kanban、完整#145、#599安装接受、UAT或R1放行。

正式边界与复现命令见 [本叶ExecPlan](../../exec-plan/completed/2026-11-10-planning-board.md)；Host构建与实际增量见 [包体证据](../../development/plugin-bundle-evidence.md)。在检出本叶分支的工作树执行计划的命令，可复核当前源、真实组合测试与发布门。本包仅含选定静态图像和说明，未把捕获工具纳入产品。

本轮实际捕获manifest SHA-256为 `923b05c5961f7434045962086501a0c73cfb17d059765f29f088c87a3c79b391`；独立复核覆盖480个源/测试/app文件、40张本轮PNG与公开候选的逐图来源。正式包复用已批准参考，不重复复制参考PNG。以下固定所有本叶技术输入和选定PNG身份，后续纯文档提交不改变拍摄归属。

| 技术输入 | f23候选 SHA-256 |
|---|---|
| `packages/ui-model/src/index.ts` | `17b337aa523ba2c640bcdafd070be9008ce59f8459e20d38d16b56617b335c2a` |
| `packages/ui-model/src/planning-board.ts` | `6bba4dc285431d369b148a14cd240b1591b6d398db46d691515fa6529d62a2d8` |
| `packages/ui-model/src/work-item-list-view.ts` | `b0fd83a7747879db13198332124c96462f0b1d28ddc9eeefc7c6b8904e661359` |
| `packages/ui/src/item-link.ts` | `19ac767f5ef90d1d196265bb66959d8042376675f1162abbe1ba7515dbf1b294` |
| `packages/ui/src/table-controls.ts` | `197ad765504769e48046ffffad824d88dc7ef737aa7a9dffdef26fdb1580672d` |
| `packages/ui/src/work-item-app.ts` | `b7f5f4ef87b862cc70690808523889dcdfc2934cdfc88ca602a9c718235ccf5b` |
| `packages/ui/src/work-item-board.ts` | `9bf9bf56d5ae994910aa4fbf934cf36a5f484af885b18321d9f383f5b5db830b` |
| `packages/ui/src/work-item-list.ts` | `c2fb862439b7f7ecfe29a91c63e91de14f18969db8c601c30fb03d33f7825e75` |
| `packages/ui/src/work-item-project.ts` | `fae9764100d9d2c08cd90494171e76e26a9df27d2b5d9f7a6ee7c73e462674f8` |
| `tests/browser/planning-board.test.js` | `a093a019aebe50337038ee7b6169c4fc4b0032f93f61da4024ba4f83703f1cfd` |
| `tests/contract/ui-planning-board.test.js` | `e777952a1f1026d873c4c711c1a601309e4fc54a730e49c035b8414876fee89f` |
| `tests/contract/ui-workspace-status.test.js` | `ce7f4fc66f2a77fecf6eae04a2b3c0d1bf9b7d986f6c4153c7962c11d2da63dc` |
| `tests/fixtures/execution-drawer-browser.mjs` | `2faf05148f70c8754f8f7b79996748a18cfd435ad1ae14026fd78ee8ae5c8a4b` |
| `tests/fixtures/table-geometry-browser.mjs` | `731740ad0efab54c32e8d3eee3c5fdc28e20e057459b41be29ed42d217dc0f7f` |

| PNG | 实际来源 | SHA-256 |
|---|---|---|
| `board-1024-dark-100.png` | `f23b7d398ce7` | `1f108ea5dc829d214e3c26aaf5a9885c680acdbfb67ba6de15ee1fdb5d699a70` |
| `board-1024-light-100.png` | `f23b7d398ce7` | `6734fbfa39eeee529e6a4ad8acaf461a978b78485f11b3d4a36b428a9b4264bf` |
| `board-1440-dark-100.png` | `f23b7d398ce7` | `8f801264fae95a34b4c41598e543861dc17dfb3053446f7ccc179986cfad557a` |
| `board-1440-light-100.png` | `f23b7d398ce7` | `cb69826e117e20e78a1b66d33115f21176cff6f9925e4d511d559792e4e1c88c` |
| `board-390-dark-100.png` | `f23b7d398ce7` | `17f6e03d6b6a917aa1e7681d2b96d86fc746b6a31ba06f9f4ab88c3d93abfb4b` |
| `board-390-dark-200.png` | `f23b7d398ce7` | `02ebcb3d8fdfb3e547deba2f8ccff83db7e68e0eec1309f3f992e30e3d39ca26` |
| `board-390-light-100.png` | `f23b7d398ce7` | `695e05a829edbae83d14d15f6f92e8c38d1551fe4e6982a7e7dcd12d14f69a51` |
| `composed-actual-late-reply-rejected-false.png` | `f23b7d398ce7` | `95ed85588b05466529811d21061a966c95fec29ab9c55cffbe47fa68fb10278c` |
| `composed-actual-late-reply-rejected-true.png` | `f23b7d398ce7` | `95ed85588b05466529811d21061a966c95fec29ab9c55cffbe47fa68fb10278c` |
| `composed-authorized-offline.png` | `f23b7d398ce7` | `16f46f8e58fbe99d74537238e0cbb6d0e01c1534e9e0de4b802a9be24f2442f7` |
| `composed-board-selected-detail.png` | `f23b7d398ce7` | `7c53e4980bebcb5268e237711616b1666110ee6db689e41d9f355bb100a3e7e1` |
| `composed-denied.png` | `f23b7d398ce7` | `35f1f654fdf72b73f9fb8ea7f5e878594c837b7a425751b9478c02635aa41579` |
| `composed-native-unknown.png` | `f23b7d398ce7` | `758ce35660826e426c621ce4834e16134dd2c25f8d0bab98a2066cefcb0c0a5b` |
| `composed-partial.png` | `f23b7d398ce7` | `63c3016edfd3eea2cb3bcf26f49e15b142f2f0da2fb8e7d288f1985b6b358e22` |
| `empty.png` | `f23b7d398ce7` | `49f08288860253546173ac08c3c92cbe10696d8c947314d1bc604b64649a85e5` |
| `hit-target-390-dark.png` | `f23b7d398ce7` | `5ad095a3152e94addb9837d59616ed14190ae62fee26ea7bee235aa87ac992f3` |
| `long-card.png` | `f23b7d398ce7` | `3e96fd9ac115f27d416ef387374f0176386f5b04c72950ba2bb0912dd3d60800` |
| `parent-list-1440-dark.png` | `558ac7bc5f62` | `4cda926b388922251c850bcf9372726ab500217f14ff0e8baa46024d1d4f80e4` |
| `parent-list-1440-light.png` | `558ac7bc5f62` | `70138abd3ff4521c6ed07e3c57753efe24e2b824c9f80d547a5a4a9d677f621e` |
| `unknown-read-capability.png` | `f23b7d398ce7` | `f3c9d99663caf86f441a85e983424b80a86820d216c623795abc0c78189add83` |


## 2026-11-11 MMP 修复对照

[零可读授权投影等价](mmp-authorized-zero-sheet.png)：同一confirmed read的空输入与全redacted输入，在真实组成List/Board的DOM及AX中使用同一零态。判断范围始终是当前已加载可读条目，不外推完整Provider/Project总量；stale、loading、denied及filtered-zero保持独立。

[共享查询清除与组内排序](mmp-query-controls-sheet.png)：List来源列经Board清除后保留；Board新选择仅为有意义的组内排序，继承List状态排序显示真实disabled已选标记且规范列序固定；回List原排序仍保留。

Before为本地候选树中精确物化46d86da5两份原版生产源的dirty观察，采集后恢复；不是把后来候选写成原始commit。after为clean ef102f30；用户独立复评0fd415e8与此候选production/apps无差异，只有两行测试拍照顺序调整，最终clean三项关键浏览器已重跑。完整3964为此前相同生产修复树的运行，含两项既有SSR warning；最终窄32浏览器/39合同/9边界/typecheck通过，最终远端精确提交仍须复评。

[精选图像与技术输入身份索引](mmp-review-evidence.json)记录原PNG hash、crop/scale、source身份和本轮技术文件hash。拼图仅为可查看的静态证据，不把fixture、CI或源码接受当作#599安装、人类UAT或R1放行。原首轮评审与作者逐项RED/GREEN见 `docs/review/pr-612-mmp-review.md`。
