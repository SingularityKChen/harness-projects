# 工作项正文 Markdown 支持边界

本页记录 #587 的工程范围；父 #539 继续负责完整平台支持研究、标题/状态增强、代码卡片与 installed Desktop 人类验收。这里的「支持」是当前安全详情投影与共享 React 渲染器的行为，不表示与 GitHub 页面完全相同。

## 来源与权限

ui-model 在当前详情的主来源与 Planning binding 相同、外部对象为 Issue/PR，且同一可见内容的 SourceNumber 提供非空原生 scope ID 后，仅复制 canonical namespace/repository。Markdown 呈现层仅在这些显式事实提供 `github.com/graphql/Repository` namespace 与合法 `owner/repo` 时启用引用。`sourceName`、正文里的 URL、当前检出、分支名或显示标签都不提供来源权威。

两种接受形式为正安全整数 `#N`、`owner/repo#N`。链接保留原 token，目的地为 `https://github.com/owner/repo/issues/N`；原生平台负责共享 Issue/PR 编号空间的路由。qualified 引用同样要求当前有效 GitHub 来源；来源缺失、binding 不符、撤权或详情被遮蔽时不会沿用旧链接。

## 支持矩阵

| 形式 | 当前状态 | 实际例与边界 |
| --- | --- | --- |
| `#328` | 本叶实现，来源依赖 | 来源为 `sample/alpha` 时打开 `/sample/alpha/issues/328`；切换到 `sample/beta` 后同步改变 |
| `sample/beta#328` | 本叶实现，来源依赖 | 打开明确跨仓库目的；没有当前有效 GitHub 来源则保留文字 |
| `repo#328`、`GH-328` | 明确不升级 | 保留文字，避免 fork/仓库来源推断 |
| `@sample` | 后续范围 | 保留文字，不查人员、不发通知 |
| SHA、SHA compare | 后续范围 | `deadbee`、`abcdef0...1234567` 保留文字；不从检出猜 repository |
| 绝对 HTTP(S) URL/显式链接 | 当前已有 | `https://example.invalid` 与 `[文字](https://example.invalid)` 是显式新窗口链接；已有文字和目的不重写 |
| email | 明确阻断导航 | `a@example.invalid` 可见为文字，`mailto:` 不形成可点击目的 |
| 相对 URL、anchor、其他 scheme | 明确阻断导航 | `[relative](./doc)`、`[anchor](#part)` 保留标签；不借 Host URL 补全 |
| task lists、tables、删除线 | 当前已有 | 任务框只读禁用；表格和长代码可聚焦、局部横向滚动 |
| footnotes | 尚不支持完整呈现 | parser 识别 `[^a]`，但当前元素白名单不呈现 footnote marker/definition；不宣称脚注可用 |
| inline/fenced code | 当前已有，惰性 | `` `#328` `` 与 fenced code 保持原文，不产生引用链接 |
| escape/entity | 本叶安全边界 | `\#328`、`&#35;328` 不升级；同 text leaf 后续真实 `#328` 仍可链接 |
| HTML/comments | 当前已有，惰性 | HTML 以文字呈现；真实注释隐藏；script/RCDATA/raw-text/CDATA 内引用不升级；raw closing marker 连同属性、换行与引号内 `>` 均惰性，真正尾部 prose 可链接 |
| 图片/媒体 | 当前已有，显式打开 | 显示 alt 与「打开图片来源」安全链接；不自动加载图片、iframe、script 或媒体 |
| 标题/状态 unfurl | 后续范围 | token 不替换为标题，不伪装已读取目标权限/状态，不联网 |
| commit permalink 卡片 | 父项后续范围 | 绝对 HTTP(S) permalink 仍是普通显式链接，无远程代码抓取或卡片 |

无 context 的 qualified token、安全范围内的普通 token、深度超限 fallback、既有链接标签、图片 alt、HTML node 和 raw literal text 都有各自的惰性边界。禁止嵌套 anchor；所有最终目的仍经过现有绝对 HTTP(S) gate。引用只提供导航，不生成业务关系、lineage、Planning 状态或 Provider 写入。

## 选型与证据

保留 `react-markdown@10.1.0`、`remark-gfm@4.0.1`。使用一个有界 mdast text-node transformer，明确依赖 parser 已在使用的 `micromark-util-decode-string@2.0.1` 对齐 escape/entity；不另建 Markdown 解码器。HTML 惰性区域由既有同次解析状态机传递；已识别的 raw closing marker 才扫描含引号的完整终点，不解释通用 HTML。qualified 候选扫描的 owner/repository 长度分别限39/100，避免长无斜杠普通正文触发无界回扫。

受限 `remark-github@12.0.0` 设置显式 repository、`mentionStrong:false`，并由 `buildUrl` 只接受 issue 后，仍会把 `GH-12`、`repo#12`、解码 escape/entity 和 `<textarea>` 内 text 链接化。其回调没有原始 token/position，不能仅靠配置达到本叶边界，因此未保留该依赖。

2026-11-09 在 `feature/markdown-source-references` 工作树，以基线版本的 `tests/fixtures/safe-markdown-browser.mjs`、相同 `production:true, composite:true` flags 比较非 minified bundle：基线 882,370 / gzip 182,450 bytes；受限库 891,617 / 184,816；所选实现（含独立评审修复）887,693 / 183,699。所选实现增加 5,323 / gzip 1,249 bytes。新增直接声明复用同一既有依赖版本，没有增加安装包或 React 副本；React/react-dom 均保持 18.3.1。

成本是同一合成浏览器构建的字节数，不是加载时延、硬件测量或 installed Host 验收。最终浏览器 fixture 增加来源输入，因此它的完整构建字节另记于 ExecPlan，不与旧 fixture 混算增量。

判别证据在 `tests/contract/ui-safe-markdown.test.js`、`tests/contract/ui-work-item-detail-view.test.js` 与 `tests/browser/safe-markdown.test.js`。它们经过真实详情投影/drawer，并覆盖同号双仓库 A→B→A、缺来源与错误 binding、遮蔽/阻断、escape/entity、code、既有链接、HTML literal、巨号/边界、多行 text/CRLF、200k纯文进程保护、合法最大/过长qualified token、8种raw标签的完整closing literal、320px、明暗主题、Tab/Enter、无自动网络与焦点不抢占。它们不替代父 #539 的 installed Desktop 人类门。

## 上游主源

- [GitHub：Autolinked references and URLs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls)：GitHub 会话引用与 URL 规则；其范围大于本叶实现。
- [react-markdown README](https://github.com/remarkjs/react-markdown)：remark/rehype 流程、组件与 URL/元素安全配置。
- [remark-gfm README](https://github.com/remarkjs/remark-gfm)：GFM task lists、tables、autolink literals 等语法；parser 能识别不代表本产品完整呈现。
- [remark-github README](https://github.com/remarkjs/remark-github)：受限候选的 repository、buildUrl 与额外 syntax。
- [micromark-util-decode-string](https://github.com/micromark/micromark/tree/main/packages/micromark-util-decode-string)：既有 parser 的 escape/entity 专用解码工具。
