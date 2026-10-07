# ADR-0010：规划实体的稳定 ID 可作 canonical route locator，但不是秘密或授权凭据

> 状态：Accepted（人类伙伴 2026-10-07 16:12 CST 在 PR #269 的会话中批准决策门 H1，所选答复原文「Approve as written (Recommended)」；完整的问题原文与机械动作记录见来源 ExecPlan 的 Decision Log）
> 日期：2026-10-07
> 来源：`docs/exec-plan/completed/2026-10-05-work-item-detail.md`（Route identifier decision gate、决策门 H）；PR #269 review thread `PRRT_kwDOUekeas6pesrq`

## Decision

**范围**：只覆盖规划实体的 `EntityId`（生产路径 `packages/core/src/identity.ts` 的 `ensureEntity` 经 `defaultIdFactory` 调 `newEntityId()`）与 `WorkspaceId`（`packages/core/src/context.ts` 缺省 `newWorkspaceId()`，重启恢复时复用既有值）。二者作为 `/projects/:projectId/items/:itemId` 的 canonical locator：**可观察、非秘密、非 capability**。持有或猜中 locator 只能选中候选目标，不能使内容变得可见。

**Locator 内容规则**：locator 值不得编码、也不得可验证地派生自 Provider `externalId`、`bindingId`、标题或其它用户内容。`packages/core/src/relations.ts` 的 `chainEntityId()` 由 `(工作区, 种类, 槽位)` 哈希得到谱系 id，槽位常含 `bindingId|externalId`（`packages/core/src/chain-facts.ts`），给定输入即可验证；这类 id 未经新决策不得进入路由。

**最小披露属性**（每条绑定到会失败的检查）：

- **L1 遮蔽不可干扰**：redacted 条目的字段（标题、正文、规划状态、派生提示、reason、`bindingId`、外部身份，以及不改变其相对排序的 `entityId`）变化时，带 navigation 的列表页 HTML 与 `href` / `open` 调用不变。行序沿 entity 锚点排序（`packages/client/src/store.ts`），相对位置不视为泄露。由 R1 补。另一个可观察通道是遮蔽条目的来源新鲜度：任一条目 stale 都会让整页降级（#129 既有行为，`main` 上无 navigation 的列表同样如此）。它与行序不同：行序只重复占位行已公开的存在性（同 GitHub Projects 的 `REDACTED` 占位项），新鲜度却是遮蔽条目自身的派生状态；同类工具把这类聚合通道当作信息泄露修复（例如 GitLab CVE-2019-12429：机密 issue 的状态与计数经里程碑页泄露）。因此本 ADR 不接受它，按 #129 的人类裁决 D / E 由 #229 关闭（页级新鲜度只按可见行计算，redacted 条目不带独立 freshness）。
- **L2**：navigation 只以 `kind: 'item'` 行的 key 调用 `href` / `open`。由 R1 补。
- **L3**：locator 只出现在 `navigation.href` 产出的 href 值里，不进 `data-*`、DOM id、`aria-*`、`title`、文字、详情正文与详情 content 字段；`bindingId`、`ExternalIdentityId` 与凭据句柄在任何模式下都不出现（Provider `externalId` 只作为详情的来源身份文字出现，属 #130 既有设计）。由 R1 补。
- **L4 locator 不是权限**：跨 scope 返回 unresolved 且 store 0 次访问；redacted 与阻断态不返回字段。已有：`tests/contract/ui-work-item-detail-view.test.js` 的 `scope-before-store`、`blocked-cache-canary`、`redacted-erases-every-field`、`撕裂读复验`。
- **L5**：codec 自往返，非 canonical 段抛 `TypeError`。已有：`tests/contract/web-item-route.test.js` 的 `canonical-open-close-idempotent`、`invalid-segments-no-echo`。

## Why

#130 的 In scope 含 deep-link 路由 `/projects/:projectId/items/:itemId`；来源 ExecPlan 据此推导出稳定、可刷新、可复制与 Back/Forward。`EntityId` 在 Draft→Issue 等外部身份变化时保持不变（`docs/architecture/gate-e1-ruling.md` §2.3），是既有谱系锚点；`packages/domain/src/ids.ts` 的品牌只保证类型隔离与「调用方不得解析结构」，`asBrandedId()` 可接纳任意既有字符串，所以任何安全结论都不依赖 locator 的格式、熵或不可枚举性。

**部署事实与强度**：当前只有单用户本机部署——宿主实例只监听回环地址上的端口并以认证 cookie 准入（`docs/architecture/harness-host-spike.md` §11.2、§11.3 的 O3.5），宿主导航是面板选择、客户端 bundle 面未观测到 URL 路由（同文件 §6.1、§8）；独立 web 壳 #135 已退回 V1（#226 正文），URL 暴露面当前只在 `apps/web` 与 `tests/fixtures/work-item-detail-browser.mjs`；页面没有外链，浏览器默认 referrer 策略对跨源请求只发送 origin。已授权页面本就显示 `primary.externalId`，wire 本就向 client 下发 `entityId` 与 `bindingId`（`packages/controller/src/wire.ts` 的 `toWireEntity`），因此地址栏、history、复制链接、日志与 referrer 的观察者得不到页面原本看不到的语义信息。这些是部署条件而不是控制：出现第二个主体、远程访问、外链或宿主 URL 路由面中的任何一项，都要重新评估本 ADR。

**显式接受的存在性差分**：持有 locator 者可以区分详情的「内容不可见」（redacted）与「未确认」（unresolved）。单用户下接受——列表的 redacted 占位行已能推出同一信息；引入第二个主体时按统一响应（对无权对象与不存在对象返回同一结果）重新评估。

**token 的真实属性**：Host 持久化随机别名或 `HMAC(安装密钥, entityId)` 提供的是可撤销别名、跨会话不可关联与隐藏 id 结构，不提供存在性隐藏（那靠统一响应）；普通 hash、base64、Hashids、Sqids 只是编码，没有安全增益。当前没有需要前三种属性的产品要求；将来若有，密钥化 HMAC 不需映射表、成本最低，但仍须新的 ADR。先例方面，GitHub、GitLab、Linear、Jira 等工作项工具的 URL 都含稳定资源标识，访问控制靠逐对象授权；OWASP IDOR 防护把随机 id 视为纵深防御而非主控，RFC 9562 §8 要求不把 UUID 当安全 capability。

## Rejected

- **前端会话内映射 token**：刷新与复制即失效，破坏深链；形成第二事实源，违反 `AGENTS.md` §1.1 不变量 7。
- **Host 持久化随机别名 / HMAC 别名**：属性见 Why；改动横跨 storage → controller wire → client → ui-model → ui，PR #269 已在代码硬门 999/1000 附近，不能在本能力内闭环。
- **Provider externalId、Issue number 或人类可读 key**：多 Provider 不统一，Draft→Issue 会换外部身份，破坏稳定深链与谱系；还违反上面的 locator 内容规则。
- **普通 hash / base64 / Hashids / Sqids 包装**：编码不是加密，仍可关联，却增加 codec 与迁移面。
- **把 locator 当作 capability URL**：持有 URL 不授予访问；本系统没有 magic-link、邀请或重置 token 语义。

## Consequences

- locator 不是授权凭据；引入第二个主体（共享工作区、按查看者 redaction、远程访问）的那个 issue 自行承接对象级授权与统一响应。
- 任何凭据、`bindingId`、Provider token 或可授予权限的值都不得复用 URL 位置；将来出现外链时必须带 `rel="noreferrer noopener"`。
- `chainEntityId()` 派生的谱系 id 进入路由需要新决策。
- #229 实施挂载时确认宿主是否存在 URL 路由面，且 `document.title` 不写条目标题（提示，不改变 #229 验收）。
- 人类伙伴批准 H1 后，`docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 第 115 行的 `href` 限制与第 121 行的「详情」入口在原处标注指向本 ADR；其余最小披露约束不变。未到 MMP，不建立双路由、redirect 或兼容层。
