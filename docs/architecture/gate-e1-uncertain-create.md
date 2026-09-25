# Gate E1 · 不确定外部创建的观测记录

> 状态：Active
> 创建：2026-09-23
> 批次：L1（issue #119），SQLite v1 数据模型栈的第一层。**base 订正（2026-09-24）**：原写 `test/e1-ruling`，#108 已合并、栈底已是 `main`（见控制计划 D2 的栈序表）。
> 上游：`docs/architecture/gate-e1-sandbox.md`（沙箱定义、§6 的九字段记录模板与三条填写纪律）
> 相关：`docs/architecture/gate-e1-write-and-events.md`（E1-3 记录，本层的直接上游）、`docs/architecture/gate-e1-ruling.md`（裁决；本层的结论落在它的 §2.6 与 §4 的 R8 行）

本文件记录四条实验，回答 issue #119 的两个问题：**创建内容本身**重复执行会得到几条对象，以及响应丢失后能不能靠对账把刚创建的对象认回来。每条按 `docs/architecture/gate-e1-sandbox.md` §6 的九字段模板填写，顺序一致；§2 由 1–4 推出**两条轴**——结果轴取 `packages/domain` 的 `WriteState`，获知方式轴是本层给出的四个标注；§3 逐条点名未证明的部分。**Superseded by §2 的订正说明（2026-09-24）**：原文写「推出 `pending_external_write` 的状态取值集合」，那是把两条轴装进一个集合的旧模型。

**与 E1-3 的边界**：E1-3 实验 3 观测的是「把**既有内容**加入 project」（`addProjectV2ItemById`），幂等键是调用方本来就持有的 `contentId`，实测计数 1。本层观测的是「**创建内容本身**」（`createIssue` / `addProjectV2DraftIssue`）——这一步调用方在创建前不持有任何内容 id，正是 E1-3 实验 3 §8 自述没有实测的那一半。

## 1. 命令约定

记录里的命令统一用下列变量。沙箱级变量（`E1_OWNER`、`E1_REPO`、`E1_PROJECT_A`、`E1_PROJECT_A_ID`）的值在 `docs/architecture/gate-e1-sandbox.md` §2.1 定义一次；`E1_L1_RUN` 是**本批次夹具的标记**，本记录是它的唯一赋值处（沿用 E1-2 记录为自己夹具定义变量的做法，沙箱定义 §2.1 的「已知缺口」已登记这类偏离）。

```bash
E1_OWNER=<沙箱 owner，值见沙箱定义 §2.1>
E1_REPO=e1-sandbox
E1_PROJECT_A=11
E1_PROJECT_A_ID=PVT_kwHOAY1ahM4BkJ9r
E1_L1_RUN=20260923T0340Z
```

`gh` 不打印 token；下列命令均以已登录的 `gh` 会话执行，记录里不出现任何凭据。所有墙钟时间都是 UTC，取自运行命令的同一会话的 `date -u +%Y-%m-%dT%H:%M:%SZ`；平台返回的时间戳（`createdAt`）另行标注为「平台时间」。

**本批次新建的夹具**（全部带标记 `uncertain-create`，归属 #119；在沙箱定义 §2.3 里占一行）：

| 引用名 | 对象 | 编号 | node id | 平台 `createdAt` |
|---|---|---|---|---|
| `issue-dup-1` | issue | `#7` | `I_kwDOUjWAl88AAAABSrWbUA` | `2026-09-23T03:40:55Z` |
| `issue-dup-2` | issue | `#8` | `I_kwDOUjWAl88AAAABSrWb2Q` | `2026-09-23T03:40:57Z` |
| `issue-reconcile` | issue | `#9` | `I_kwDOUjWAl88AAAABSrWjOg` | `2026-09-23T03:41:15Z` |
| `issue-label-a` | issue（标签探针，意外成功） | `#10` | `I_kwDOUjWAl88AAAABSrWy6Q` | `2026-09-23T03:41:55Z` |
| `issue-label-b` | issue（标签探针，意外成功） | `#11` | `I_kwDOUjWAl88AAAABSrWzUQ` | `2026-09-23T03:41:56Z` |
| `issue-retry` | issue（拒绝后重试） | `#12` | `I_kwDOUjWAl88AAAABSrXogw` | `2026-09-23T03:44:03Z` |
| `draft-a` | DraftIssue 条目 | — | 条目 `PVTI_lAHOAY1ahM4BkJ9rzg8P9K4` / 内容 `DI_lAHOAY1ahM4BkJ9rzgLLTqU` | `2026-09-23T03:42:53Z` |
| `draft-b` | DraftIssue 条目 | — | 条目 `PVTI_lAHOAY1ahM4BkJ9rzg8P9ek` / 内容 `DI_lAHOAY1ahM4BkJ9rzgLLTsE` | `2026-09-23T03:43:39Z` |
| `label-auto-created` | label（仓库级对象，由平台自动创建） | `e1-label-that-does-not-exist` | — | `2026-09-23T03:41:55Z` |

既有夹具（issue-alpha、draft-beta、pr-gamma、issue-shared、draft-convert、issue-writable、issue-dupe）在本批次中只读，未被修改。`label-auto-created` 是实验 3(b) 的副作用——REST 接受未知标签并**自动创建**它；它是仓库级的持久对象，已按归属 #119 登记在 `docs/architecture/gate-e1-sandbox.md` §2.3，重建沙箱时**不创建**它（它的存在本身就是那条平台行为的证据）。沙箱漂移一条：`fixture shared`（sandbox issue #2）现在是 `CLOSED`，而沙箱定义 §2.3 仍按 `OPEN` 描述——本记录只登记差异，不改那份清单（它是"观测发生时对象长这样"的历史表述）。

本批次的写入共产生 6 条 issue 与 2 条 draft 条目，Project A 的条目数由 `7` 变为 `9`。沙箱定义 §4.1(b) 的重建判据（`totalCount: 7`）描述的是**重建出来的**沙箱，本批次的夹具不会出现在重建结果里，因此该判据不受影响；受影响的是"当前状态回读"，本记录给出新值。

---

### 实验 1 · 重复创建：同参数两次 `createIssue`

**1. 实验编号与目的**

判定 issue #119 的第 ① 步，也是行为 6 后半句「不盲目重试」的直接证据：对**同一个内容**连续两次发出参数逐字相同的创建，平台会不会去重。判据：按标记查询到的对象计数为 1 → 平台去重，盲重试安全；为 2 → 平台不去重，盲重试制造无法检测的重复。

**2. 夹具**

`issue-dup-1`（`#7`，`I_kwDOUjWAl88AAAABSrWbUA`）与 `issue-dup-2`（`#8`，`I_kwDOUjWAl88AAAABSrWb2Q`），标题与正文逐字相同。目标仓库 `$E1_OWNER/$E1_REPO`（私有，node id `R_kgDOUjWAlw`）。本实验不加入任何 project，不写任何字段值。

**3. 请求**

```bash
E1_L1_RUN=20260923T0340Z
TITLE="fixture uncertain-create duplicate $E1_L1_RUN"
BODY="Gate E1 fixture. Uncertain-create duplicate probe (#119)."

gh issue create --repo "$E1_OWNER/$E1_REPO" --title "$TITLE" --body "$BODY"
gh issue create --repo "$E1_OWNER/$E1_REPO" --title "$TITLE" --body "$BODY"   # 逐字相同

# 计数：仓库侧列表（不经搜索索引）按标题精确过滤
gh issue list --repo "$E1_OWNER/$E1_REPO" --state all --limit 100 \
  --json number,title,author,createdAt,id \
  | jq --arg t "$TITLE" '{count: ([.[]|select(.title==$t)]|length), items: [.[]|select(.title==$t)]}'

# 对照：搜索索引路径
gh search issues --repo "$E1_OWNER/$E1_REPO" --author "$E1_OWNER" "\"$TITLE\" in:title" \
  --json number,title,author,createdAt,id
```

**4. 观测**

| 墙钟（UTC） | 动作 | 平台原文（截取到能证明结论的部分） |
|---|---|---|
| `03:40:54Z` | 第一次创建发出 | — |
| `03:40:55Z` | 第一次创建返回，exit 0 | `https://github.com/SingularityKChen/e1-sandbox/issues/7` |
| `03:40:56Z` | 第二次创建发出（参数逐字相同） | — |
| `03:40:57Z` | 第二次创建返回，exit 0 | `https://github.com/SingularityKChen/e1-sandbox/issues/8` |
| `03:40:57Z` | 仓库侧列表计数 | `{"count":2,"items":[{"createdAt":"2026-09-23T03:40:57Z","id":"I_kwDOUjWAl88AAAABSrWb2Q","number":8,"title":"fixture uncertain-create duplicate 20260923T0340Z"},{"createdAt":"2026-09-23T03:40:55Z","id":"I_kwDOUjWAl88AAAABSrWbUA","number":7,"title":"fixture uncertain-create duplicate 20260923T0340Z"}]}` |
| `03:40:58Z` | 搜索索引路径计数 | `[]` |
| `03:44:00Z` | 搜索索引路径计数（索引追上后） | `[{"createdAt":"2026-09-23T03:40:57Z","number":8},{"createdAt":"2026-09-23T03:40:55Z","number":7}]` |

**两次创建的实测对象计数是 2，不是 1。** 平台**不**对内容创建去重：参数完全相同、作者相同、时间相邻的两次调用各产生一个独立对象（`#7` / `#8`，两个不同的 node id）。`gh issue create` 的返回体只有 issue URL，没有其它字段；两次返回的 URL 不同，这就是"平台把它们当成两个对象"的原文证据。

**5. 本地应有行**

| 表（预期） | 键 | 计数 | 为什么是这些行 |
|---|---|---|---|
| `external_identity` | (platform, kind=`Issue`, id=`I_kwDOUjWAl88AAAABSrWbUA`) 与 (…, id=`I_kwDOUjWAl88AAAABSrWb2Q`) | **2** | 两次创建各返回一个不同的 node id；平台没有把它们视为同一个对象 |
| `pending_external_write` | (idempotency_key) | **2** | 每次创建各一条未决行。本实验证明幂等键**不能**取内容 id（创建前不存在），也**不能**取标题（两次标题逐字相同却是两条对象） |
| `project_item_membership` | — | 0 | 本实验不把内容加入任何 project |
| 规划字段值 | (workspace, item) | 0 | 本实验不写任何规划字段值（两条 issue 都没有加入 project，因此没有条目可挂字段值），只有 0 个用户可写规划字段值；「行数」按 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 的定义计，因此为 0 |

**6. 意外行为**

搜索索引路径在第二次创建后 1 秒内返回 **0 命中**（`03:40:58Z`），而同一时刻仓库侧列表已返回 2 条；直到 `03:44:00Z` 搜索路径才返回 2 条。量级由实验 2 量到（≤9 s）。

**7. 决策影响**

- **「绝不盲重试」有直接证据，且平台不提供保护**：重复创建内容不会去重，静默重试必然产生第二个对象。ADR-0004 第 3 条因此不是保守估计，而是实测后果。
- **R8 的幂等键在「创建内容」这一步不可用**：`idempotency_key = content_id` 的前提是调用方已经持有 `content_id`，而这一步的 `content_id` 由平台在创建之后分配。标题不能替代它（本实验的两次标题逐字相同，平台照样产生两条对象；E1-3 实验 3 §4.4 另有"标题可变且可能不唯一"）。这条直接影响 L3 建 `pending_external_write` 时的键形状，见 §5 与 §6。
- 对账查询若用搜索索引，会在索引追上之前把"已创建"读成"不存在"（实验 2 量到 ≈9 s，不是分钟级）；见实验 2。

**8. 判定**

**pass**（就"给出同参数两次创建的对象计数"这一目标）。依据：两次调用各有墙钟时间与返回原文（两个不同的 issue URL），计数查询给出 `count: 2` 与两条带 node id 的条目，且搜索路径在索引追上后独立给出同样的两条。

**9. 复现**

1. 按 `docs/architecture/gate-e1-sandbox.md` 重建沙箱并导出 §2.1 的变量（或复用现存的沙箱）。
2. 取一个新的 `$E1_L1_RUN`（**必须换**：重跑会让旧标记的计数不再是 2），执行 §3 的两条 `gh issue create`，参数逐字相同。
3. 执行 §3 的计数查询，期望 `count: 2`，且两条的 `id` 不同。
4. 立刻执行搜索索引查询，期望窗口内 `[]`；隔几分钟再查，期望同样两条。
5. 清理：本批次的夹具不删除（计数 2 本身就是证据）；整仓拆除按沙箱定义 §5。

---

### 实验 2 · 对账分支 A：响应丢失后按「标记 + 作者 + 时间窗」找回

**1. 实验编号与目的**

判定 issue #119 的第 ② 步与行为 6 前半句「先对账」：一次**响应被丢弃**的创建之后，能否按不依赖响应的输入（标题标记 + 作者 + 创建时间窗）唯一认出刚创建的对象，以及从创建到可被查到的时间差。响应丢失用"丢弃命令输出"模拟，**不制造网络故障**：命令确实执行，只是调用方拿不到响应体。

**2. 夹具**

`issue-reconcile`（`#9`，`I_kwDOUjWAl88AAAABSrWjOg`），标题 `fixture uncertain-create reconcile $E1_L1_RUN`。目标仓库 `$E1_OWNER/$E1_REPO`。本实验不加入任何 project。

**3. 请求**

```bash
E1_L1_RUN=20260923T0340Z
TITLE="fixture uncertain-create reconcile $E1_L1_RUN"
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 创建，丢弃响应：调用方拿不到响应体，但命令确实执行
gh issue create --repo "$E1_OWNER/$E1_REPO" --title "$TITLE" \
  --body "Gate E1 fixture. Uncertain-create reconcile probe (#119)." > /dev/null 2>&1
echo "exit=$?"

# 对账：标记 + 作者 + 时间窗，两条路径各跑一次
gh search issues --repo "$E1_OWNER/$E1_REPO" --author "$E1_OWNER" --created ">=$START" \
  "\"$TITLE\" in:title" --json number,title,author,createdAt,id
gh issue list --repo "$E1_OWNER/$E1_REPO" --state all --limit 100 \
  --json number,title,author,createdAt,id | jq --arg t "$TITLE" '[.[]|select(.title==$t)]'

# 轮询包装（§4 的聚合输出来自这一段；命令间隔 2 s，实测一轮 3–4 s，打印墙钟、轮次与两条路径的命中数）
for attempt in 1 2 3; do printf '%s attempt=%s search_hits=%s list_hits=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$attempt" "$(gh search issues --repo "$E1_OWNER/$E1_REPO" --author "$E1_OWNER" --created ">=$START" "\"$TITLE\" in:title" --json id | jq 'length')" "$(gh issue list --repo "$E1_OWNER/$E1_REPO" --state all --limit 100 --json title | jq --arg t "$TITLE" '[.[]|select(.title==$t)]|length')"; sleep 2; done
```

**4. 观测**

时间窗起点 `START = 2026-09-23T03:41:14Z`。创建命令的 stdout/stderr 全部丢弃，返回码 `exit=0`（`03:41:16Z`）。

轮询（命令间隔 2 s，实测一轮 3–4 s：相邻两轮墙钟差为 `:16→:20→:24`，即 4 s；`search_hits` = 搜索索引路径，`list_hits` = 仓库侧列表路径）：

```text
2026-09-23T03:41:16Z attempt=1 search_hits=0 list_hits=1
2026-09-23T03:41:20Z attempt=2 search_hits=0 list_hits=1
2026-09-23T03:41:24Z attempt=3 search_hits=1 list_hits=1
```

两条路径的命中原文（同一条对象）：

```json
[{"author":{"login":"SingularityKChen"},"createdAt":"2026-09-23T03:41:15Z",
  "id":"I_kwDOUjWAl88AAAABSrWjOg","number":9,
  "title":"fixture uncertain-create reconcile 20260923T0340Z"}]
```

（上面是搜索索引路径的原文，字段按本记录需要截取；仓库侧列表路径返回同一条对象的 `number`、`id`、`createdAt` 与作者。）

| 量 | 实测值 |
|---|---|
| 唯一性（仓库侧列表） | **1 命中**（`#9`） |
| 唯一性（搜索索引） | **1 命中**（同一条） |
| 可见延迟（仓库侧列表） | **≈ 0 s**：命令 `03:41:16Z` 返回，同一秒的第一轮轮询就命中 |
| 可见延迟（搜索索引） | **≈ 9 s**：对象平台时间 `03:41:15Z` → 首次命中 `03:41:24Z`（命令返回后约 8 s） |
| 窗口内的一致性 | 第 1、2 轮两条路径给出**不同答案**（0 对 1） |

**响应丢失没有妨碍对账**：只要标记唯一，两条路径最终都能唯一认出这条对象。但**两条路径的可见延迟差一个量级**，且搜索索引在窗口内会给出"不存在"的错误答案。

**5. 本地应有行**

| 表（预期） | 键 | 计数 | 为什么是这些行 |
|---|---|---|---|
| `external_identity` | (platform, kind=`Issue`, id=`I_kwDOUjWAl88AAAABSrWjOg`) | **1** | 创建只发生一次；对账采纳的是同一个对象，不新增身份 |
| `pending_external_write` | (idempotency_key) | **1** | 发起时 1 条未决行；对账唯一命中后采纳并关闭，**不发起第二次写入** |
| `sync_observation` | (item=`I_kwDOUjWAl88AAAABSrWjOg`, observed_at) | 每次对账读取一行 | 每轮轮询都是一次观察，自带本地接收时刻 |
| 规划字段值 | (workspace, item) | 0 | 本实验不写任何规划字段值（issue 没有加入 project，因此没有条目可挂字段值），只有 0 个用户可写规划字段值；「行数」按 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 的定义计，因此为 0 |

**6. 意外行为**

1. **两条查询路径的可见延迟不同**：仓库侧列表在命令返回的同一秒命中，搜索索引要 9 秒。预期是两条路径等价。
2. **窗口内"对账返回空"不等于"对象不存在"**：第 1、2 轮的搜索路径返回 0，而对象当时已经存在。这是本批次最重要的否定结论——它直接否掉了"对账为空就重试"这条规则。

**7. 决策影响**

- **对账查询不得使用搜索索引路径**：它会在索引追上之前把已创建的对象读成不存在（本实验量到 ≈9 s）。可用的路径是仓库侧列表与 project 条目连接（实验 4）。
- **「对账为空」不能作为"写入未发生"的判据**：窗口内的空结果与真正的失败不可区分。因此**结果轴**上必须有一个"写入已发起、对账尚无结论"的取值——就是 `pending`，由本地写入记录判定（**2026-09-24 评审订正**：本节早先把它与"对账给不出唯一结论"合并为 `uncertain`，那是把结果轴与获知方式轴装进同一个集合的后果，见 §2 的订正说明）；"允许重试"必须另有证据（实验 3 给出）。
- 对账的唯一性依赖标记唯一；实验 1 给出反例（标记不唯一时计数 2，无法判定哪一条属于本写入）。

**8. 判定**

**pass**（就"给出对账的唯一性与可见延迟"这一目标）。依据：创建命令有返回码与墙钟时间，两轮 0 命中与第三轮 1 命中都有时间戳，两条路径的命中原文逐字段一致（同一 `id`、同一 `createdAt`），延迟按平台时间与本地时间两侧可算。

**9. 复现**

1. 按 `docs/architecture/gate-e1-sandbox.md` 重建沙箱并导出 §2.1 的变量；取一个新的 `$E1_L1_RUN`。
2. 执行 §3 的创建命令（输出丢弃），确认 `exit=0`。
3. 立刻按 §3 的两条对账查询轮询（命令间隔 2 s，实测一轮 3–4 s），记录每轮的时间戳与两条路径的命中数；期望先出现"搜索 0 / 列表 1"，随后搜索追平为 1。
4. 比对两条路径命中的 `id` 与 `createdAt`，期望逐字段相同且各只有一条。

---

### 实验 3 · 对账分支 B：平台显式拒绝后对账为空

**1. 实验编号与目的**

判定 issue #119 的第 ③ 步：一次**必然失败**的创建之后，同一条对账查询找不到任何对象——这是"找不到才允许重试"的前提。本实验的判别性设计是：把"平台显式拒绝"与"对账为空"两条**同时**观测到，因为实验 2 已经证明"对账为空"单独不成立。

**2. 夹具**

失败路径不产生对象。为取得"平台显式拒绝"的原文，先做了两次**没有失败**的对照探针，它们各产生一条对象：`issue-label-a`（`#10`，`I_kwDOUjWAl88AAAABSrWy6Q`）、`issue-label-b`（`#11`，`I_kwDOUjWAl88AAAABSrWzUQ`），并在仓库上新建了标签 `e1-label-that-does-not-exist`。重试路径产生 `issue-retry`（`#12`，`I_kwDOUjWAl88AAAABSrXogw`）。目标仓库 `$E1_OWNER/$E1_REPO`。

**3. 请求**

```bash
E1_L1_RUN=20260923T0340Z

# (a) gh 客户端路径：未知标签
gh issue create --repo "$E1_OWNER/$E1_REPO" \
  --title "fixture uncertain-create failed $E1_L1_RUN" \
  --label "e1-label-that-does-not-exist" \
  --body "Gate E1 fixture. Uncertain-create failure probe (#119)."

# (b) 对照探针：同一个未知标签走 REST（预期失败，实测没有）；第一次调用不带 --include，只打印返回体
gh api --method POST "/repos/$E1_OWNER/$E1_REPO/issues" \
  -f title="fixture uncertain-create failed $E1_L1_RUN" \
  -f body="Gate E1 fixture. Uncertain-create failure probe (#119)." \
  -f 'labels[]=e1-label-that-does-not-exist'

# (b') 同参数再发一次，这次带 --include 取状态行（§4 的 `HTTP/2.0 201 Created` 出自这一次；
#       第二次调用又创建了 `#11`）
gh api --method POST "/repos/$E1_OWNER/$E1_REPO/issues" \
  -f title="fixture uncertain-create failed $E1_L1_RUN" \
  -f body="Gate E1 fixture. Uncertain-create failure probe (#119)." \
  -f 'labels[]=e1-label-that-does-not-exist' --include

# (c) 平台显式拒绝：不存在的 assignee
gh api --method POST "/repos/$E1_OWNER/$E1_REPO/issues" \
  -f title="fixture uncertain-create rejected $E1_L1_RUN" \
  -f body="Gate E1 fixture. Uncertain-create rejected probe (#119)." \
  -f 'assignees[]=e1-user-that-does-not-exist' --include

# (d) 显式拒绝之后的重试：去掉非法参数
gh api --method POST "/repos/$E1_OWNER/$E1_REPO/issues" \
  -f title="fixture uncertain-create rejected $E1_L1_RUN" \
  -f body="Gate E1 fixture. Uncertain-create retry-after-rejection (#119)."

# 标签的创建者：回读标签本身（(b) 的副作用对象，不是本批次夹具）
gh label list --repo "$E1_OWNER/$E1_REPO" --json name,createdAt \
  | jq '.[]|select(.name=="e1-label-that-does-not-exist")'

# 仓库侧全量编号集合（(a) / (c) 的"没有新对象"对照）
gh issue list --repo "$E1_OWNER/$E1_REPO" --state all --limit 100 --json number \
  | jq '[.[].number]|sort|reverse'
```

对账查询与实验 2 同形（标记 + 作者 + 时间窗），两条路径各跑一次；另用上面这条仓库侧全量编号集合作为对照。§4 里 (a) / (c) 的计数与编号集合、以及 (b) 的标签回读都出自这段命令。

**4. 观测**

**(a) gh 客户端路径的拒绝**：

时间（墙钟）：`03:41:37Z`（exit 1）。

```text
could not add label: 'e1-label-that-does-not-exist' not found
```

随后同形对账：

时间（墙钟）：下界 `03:41:37Z` / 上界 `03:41:55Z`；本条对账自身的墙钟未逐条记录。

搜索路径 `[]`、仓库侧列表 `count: 0`；仓库全量编号为 `[9,8,7,6,4,3,2,1]`（8 条，无新增）。

**(b) 对照探针：同一个标签走 REST，平台没有拒绝**：

时间（墙钟）：第一次调用 `03:41:55Z`（创建 `#10`）；第二次调用 `03:41:56Z`（带 `--include`，又创建 `#11`，`I_kwDOUjWAl88AAAABSrWzUQ`）。

第二次调用（带 `--include`）的状态行：

```text
HTTP/2.0 201 Created
```

第一次调用的返回体（截取到能证明结论的部分）：

`{"number":10,"node_id":"I_kwDOUjWAl88AAAABSrWy6Q","created_at":"2026-09-23T03:41:55Z","labels":[{"name":"e1-label-that-does-not-exist","color":"ededed"}]}`

标签回读（`gh label list`）：

时间（墙钟）：本次回读未单独记录；`createdAt = 2026-09-23T03:41:55Z` 是标签自身的创建时刻（平台时间），不是回读时刻。

回读确认标签 `e1-label-that-does-not-exist` 的 `createdAt = 2026-09-23T03:41:55Z`——**平台自动创建了这个标签**。

**(c) 平台显式拒绝（两次调用）**：

时间（墙钟）：`03:42:28Z` / `03:42:40Z`（两次调用，均 exit 1）；下面的状态行与错误体来自带 `--include` 的那一次。

```text
HTTP/2.0 422 Unprocessable Entity
{"message":"Validation Failed","errors":[{"value":["e1-user-that-does-not-exist"],
 "resource":"Issue","field":"assignees","code":"invalid"}],
 "documentation_url":"https://docs.github.com/rest/issues/issues#create-an-issue","status":"422"}
```

同一标记的对账：

时间（墙钟）：`03:42:33Z`。

搜索路径 `0`、仓库侧列表 `0`；仓库全量编号仍是 `[11,10,9,8,7,6,4,3,2,1]`——**没有产生任何对象**。

**(d) 显式拒绝之后的重试**：

时间（墙钟）：`03:44:03Z`。

平台返回体（重塑：从 §3 的 `gh api` 完整信封里只保留能证明结论的三个字段）：

```json
{"created_at":"2026-09-23T03:44:03Z","node_id":"I_kwDOUjWAl88AAAABSrXogw","number":12}
```

随后对账按标记计数 **1**：

时间（墙钟）：`03:44:04Z`（只有 `#12`）。

重试没有产生第二条。

**5. 本地应有行**

| 表（预期） | 键 | 计数 | 为什么是这些行 |
|---|---|---|---|
| `external_identity` | (platform, kind=`Issue`, id=`I_kwDOUjWAl88AAAABSrXogw`) | **1** | 只有重试那一次产生了对象；被拒绝的两次调用没有产生任何身份 |
| `external_identity` | (…, id=`I_kwDOUjWAl88AAAABSrWy6Q`) 与 (…, id=`I_kwDOUjWAl88AAAABSrWzUQ`) | 2 | 标签对照探针意外成功的两条对象，属本实验的观测产物 |
| `pending_external_write` | (idempotency_key) | **1** | 被拒绝的写入仍是未决行（拒绝**不**等于可丢弃：要等对账为空才允许重试）；重试成功后关闭，不存在第二行 |
| 规划字段值 | (workspace, item) | 0 | 本实验不写任何规划字段值（三条对象都没有加入 project，因此没有条目可挂字段值），只有 0 个用户可写规划字段值；「行数」按 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 的定义计，因此为 0 |

**6. 意外行为**

1. **同一个未知标签在两条客户端路径上有不同的失败面**：`gh issue create --label` 在**客户端**拒绝（请求没有到达平台，仓库全量编号可证），而同一标签经 REST 提交时平台接受并**自动创建标签**（`201`）。预期是"非法参数 → 平台拒绝"。
2. **平台不把"参数看起来非法"当成错误**：未知标签被静默创建。因此"参数非法"不能当作"写入未发生"的判据——必须看平台是否**显式**拒绝（4xx + 错误体）。
3. **`gh api --jq` 不支持 `--arg`**（实验 4 §6 第 1 条同源）：工具层的坑会让复现者以为查询失败。

**7. 决策影响**

- **可安全重试的条件被收窄为两条同时成立**：写入**确实没发生**（平台显式 4xx，或客户端在发出前拒绝），**并且**同形对账为空。实验 2 证明单靠"对账为空"会把"响应丢失但对象已创建"误判成可重试。
- **"客户端拒绝"与"平台拒绝"必须分开记录**：只有平台拒绝能证明请求到达过平台；两者的共同点是"没有对象产生"，因此都允许重试，但证据强度不同。
- 重试本身不会制造重复（实测重试后按标记计数 1），但这条只对"上一次确实被拒绝"成立。

**8. 判定**

**pass**（就"确认对账查不到任何对象"这一目标）。依据：平台显式拒绝有 HTTP 状态与错误体原文，拒绝后的两条对账路径都为 0，仓库全量编号集合可证没有新对象；重试后按标记计数为 1。两条对照探针的意外成功也按原文记录，未作删除。

**9. 复现**

1. 按 `docs/architecture/gate-e1-sandbox.md` 重建沙箱并导出 §2.1 的变量；取一个新的 `$E1_L1_RUN`。
2. 执行 §3 的 (c)，确认 `HTTP/2.0 422` 且错误体含 `"field":"assignees"`。
3. 立刻执行实验 2 §3 的两条对账查询，期望两条路径都为 0，且仓库全量编号集合里没有新编号。
4. 执行 §3 的 (d)，确认 `201`，再跑一次对账，期望按标记计数为 1。
5. 复现 (a)/(b) 的对照：`--label` 走 `gh issue create` 会被客户端拒绝；同一标签走 REST 会 `201` 并自动建标签（这一步会创建对象与标签，属预期副作用）。

---

### 实验 4 · draft 分支：没有仓库侧列表时的对账作用域

**1. 实验编号与目的**

判定 issue #119 的第 ④ 步：`addProjectV2DraftIssue`（`gh project item-create`）的响应丢失后，对账查询的**作用域**是什么，以及它的可见延迟。draft 不是 issue，仓库侧的两条路径看不到它，因此作用域只能落在 project 的条目连接上。

**2. 夹具**

`draft-a`（条目 `PVTI_lAHOAY1ahM4BkJ9rzg8P9K4` / 内容 `DI_lAHOAY1ahM4BkJ9rzgLLTqU`）与 `draft-b`（条目 `PVTI_lAHOAY1ahM4BkJ9rzg8P9ek` / 内容 `DI_lAHOAY1ahM4BkJ9rzgLLTsE`），都在 Project A（`$E1_PROJECT_A`，node id `PVT_kwHOAY1ahM4BkJ9r`）。`draft-a` 的计时因工具错误作废（§6 第 1 条），`draft-b` 是计时用的那一条。

**3. 请求**

```bash
E1_L1_RUN=20260923T0340Z
TITLE="fixture uncertain-create draft-b $E1_L1_RUN"

# 创建，丢弃响应
gh project item-create "$E1_PROJECT_A" --owner "$E1_OWNER" --title "$TITLE" \
  --body "Gate E1 fixture draft. Uncertain-create reconcile probe (#119)." \
  --format json > /dev/null 2>&1
echo "exit=$?"

# 对账：project 条目连接（draft 没有仓库侧列表）；按标题过滤并重塑成 §4 的命中形状
gh api graphql -f query='
query($p: ID!) { node(id: $p) { ... on ProjectV2 {
  items(first: 20) { totalCount nodes {
    id type createdAt creator { login }
    content { __typename ... on DraftIssue { id title } } } } } } }' -f p="$E1_PROJECT_A_ID" \
  | jq --arg t "$TITLE" '{totalCount: .data.node.items.totalCount,
      matches: [.data.node.items.nodes[]|select(.content.title==$t)]}'

# 对照：仓库侧两条路径
gh issue list --repo "$E1_OWNER/$E1_REPO" --state all --limit 100 --json title
gh search issues --repo "$E1_OWNER/$E1_REPO" --author "$E1_OWNER" "\"$TITLE\" in:title" --json number

# 轮询包装（§4 的聚合输出来自这一段；命令间隔 2 s，实测一轮 3–4 s，打印墙钟、轮次与条目连接 / 仓库侧列表的命中数）
# 跳出条件：条目连接命中数非 0 即 break，所以 §4 的输出块只有两行（§6 第 1 条记录了同一个条件
# 在 draft-a 上把失败命令的空输出当成"已命中"、第 1 轮就退出）
for attempt in 1 2 3; do
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  project_items_hits=$(gh api graphql -f query='query($p: ID!) { node(id: $p) { ... on ProjectV2 { items(first: 20) { nodes { content { ... on DraftIssue { title } } } } } } }' -f p="$E1_PROJECT_A_ID" | jq --arg t "$TITLE" '[.data.node.items.nodes[]|select(.content.title==$t)]|length')
  repo_issue_list_hits=$(gh issue list --repo "$E1_OWNER/$E1_REPO" --state all --limit 100 --json title | jq --arg t "$TITLE" '[.[]|select(.title==$t)]|length')
  printf '%s attempt=%s project_items_hits=%s repo_issue_list_hits=%s\n' "$NOW" "$attempt" "$project_items_hits" "$repo_issue_list_hits"
  [ "$project_items_hits" != "0" ] && break
  sleep 2
done

# 复核：两条 draft 条目的字段值（只读；§4 的字段值原文与 §5 的「规划字段值」口径依据）
gh api graphql -f query='query($a: ID!, $b: ID!) { a: node(id: $a) { ... on ProjectV2Item { id type fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2SingleSelectField { id name } } } ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } } } } } } b: node(id: $b) { ... on ProjectV2Item { id type fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2SingleSelectField { id name } } } ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } } } } } } }' -f a=PVTI_lAHOAY1ahM4BkJ9rzg8P9K4 -f b=PVTI_lAHOAY1ahM4BkJ9rzg8P9ek
```

**4. 观测**

创建前 Project A 的 `items.totalCount = 7`（`03:42:51Z`）。`draft-a` 的创建 `exit=0`（`03:42:53Z`），平台 `createdAt = 2026-09-23T03:42:53Z`；它的轮询在第 1 轮就因命令构造错误作废（§6 第 1 条），`03:43:16Z` 才被确认存在，因此它的延迟**没有测到**。

`draft-b` 的轮询（创建命令 `exit=0` 于 `03:43:40Z`）：

```text
2026-09-23T03:43:40Z attempt=1 project_items_hits=0 repo_issue_list_hits=0
2026-09-23T03:43:43Z attempt=2 project_items_hits=1 repo_issue_list_hits=0
```

命中原文（§3 的对账命令按标题过滤后的输出，折行按本记录惯例；`items.totalCount` 为 9）：

```json
{"totalCount":9,"matches":[{"id":"PVTI_lAHOAY1ahM4BkJ9rzg8P9ek","type":"DRAFT_ISSUE",
 "createdAt":"2026-09-23T03:43:39Z","creator":{"login":"SingularityKChen"},
 "content":{"__typename":"DraftIssue","id":"DI_lAHOAY1ahM4BkJ9rzgLLTsE",
 "title":"fixture uncertain-create draft-b 20260923T0340Z"}}]}
```

| 量 | 实测值 |
|---|---|
| 对账作用域 | **只有 project 条目连接**（`node(id: $E1_PROJECT_A_ID)` 的 `items`） |
| 仓库侧列表路径 | **0 命中**（draft 不是 issue） |
| 仓库侧搜索路径 | **0 命中** |
| 唯一性 | 按标题过滤 **1 命中** |
| 可见延迟 | **≈ 4 s**：条目平台时间 `03:43:39Z` → 首次命中 `03:43:43Z`（命令返回后约 3 s） |
| 条目 `createdAt` | 存在（`2026-09-23T03:43:39Z`）；`creator.login` 也存在 |

Project A 的条目数由 `7` 变为 `9`（两条 draft 各一条）。

**字段值复核（订正会话，只读，`2026-09-23T04:16:27Z`）**：按条目 id 回读两条 draft 的 `fieldValues`，两条**各自 2 个值**：`Title`（内容字段）与 `Status` = `Todo`（`optionId = f75ad846`，字段 id `PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY`，即沙箱定义 §2.4 的 Project A `Status`）。原文（§3 末段的两节点查询里 `b` 这一支，即 `draft-b`；`draft-a` 同形，只有标题不同）：

```json
{"id":"PVTI_lAHOAY1ahM4BkJ9rzg8P9ek","type":"DRAFT_ISSUE","fieldValues":{"nodes":[{"text":"fixture uncertain-create draft-b 20260923T0340Z","field":{"name":"Title"}},{"name":"Todo","optionId":"f75ad846","field":{"id":"PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY","name":"Status"}}]}}
```

命令见 §3 末段。这条复核是只读的，不改动本实验的可见延迟与作用域结论；它给出 §5「规划字段值」行的计数依据。

**5. 本地应有行**

| 表（预期） | 键 | 计数 | 为什么是这些行 |
|---|---|---|---|
| `external_identity` | (platform, kind=`DraftIssue`, id=`DI_lAHOAY1ahM4BkJ9rzgLLTsE`) | **1** | draft 的内容身份；与它的成员关系身份（`PVTI_*`）是两条不同的身份 |
| `project_item_membership` | (workspace=A, project=`PVT_kwHOAY1ahM4BkJ9r`, item=`PVTI_lAHOAY1ahM4BkJ9rzg8P9ek`) | **1** | draft 在 project 里**创建**成员关系，不是挂接既有内容（与 `addProjectV2ItemById` 的语义不同） |
| `pending_external_write` | (idempotency_key) | **1** | 发起时一条未决行；对账唯一命中后采纳并关闭 |
| 规划字段值 | (workspace, item) | 1 | 本表按 `draft-b` 计数（与上面三行同作用域）：该条目由平台在**创建时**就带 1 个用户可写规划字段值（`Status` = `Todo`，见 §4 的字段值复核），调用方没有写任何字段值；`Title` 是内容字段、不计入。只有 `Status` 可写；「行数」按 [gate-e1-sandbox.md](gate-e1-sandbox.md) §6 的定义计，因此为 1 |

**6. 意外行为**

1. **本层的工具错误（不是平台行为）**：第一轮计时用的对账命令写成 `gh api graphql --jq --arg t "$TITLE" '…'`，而 `gh api --jq` 只接受一个参数，命令以 `accepts 1 arg(s), received 4` 失败；轮询的跳出条件又把错误值当成"已命中"，于是第 1 轮就退出。`draft-a` 的可见延迟因此**没有测到**，本记录改用 `draft-b` 重新计时，并把这次失败如实留在这里。
2. **draft 在仓库侧完全不可见**：仓库侧列表与搜索索引都是 0 命中。对账作用域被平台限制为 project 条目连接，不是实现选择。
3. **project 条目连接的可见延迟 ≈4 s**，与实验 2 的仓库侧列表（≈0 s）不同。

**7. 决策影响**

- **draft 的对账只能走 project 条目连接**，且必须按标题（标记）过滤；条目连接上可用的判别输入是 `id`、`type`、`createdAt`、`creator.login` 与 `content.title`。
- **draft 的 `pending_external_write` 没有仓库侧自然键**：创建前没有内容 id，仓库侧没有可查询的列表。它的对账完全依赖 project 条目连接 + 标题标记，因此"标记唯一"这条前提对 draft 比对 issue 更关键。
- 条目连接的读后写延迟（≈4 s）必须在实现里体现为"窗口内为空不结论"，与实验 2 的结论一致。

**8. 判定**

**pass**（就"给出 draft 的对账作用域与可见延迟"这一目标）。依据：`draft-b` 的创建有返回码与墙钟时间，两轮轮询给出 0 → 1 的转变与时间戳，命中原文含条目 id、内容 id、`type`、`createdAt`、`creator`；仓库侧两条路径独立给出 0 命中。`draft-a` 的计时失败已如实记录，不计入结论。

**9. 复现**

1. 按 `docs/architecture/gate-e1-sandbox.md` 重建沙箱并导出 §2.1 的变量；取一个新的 `$E1_L1_RUN`。
2. 读 Project A 的 `items.totalCount` 作为基线。
3. 执行 §3 的创建命令（输出丢弃），确认 `exit=0`；立刻跑 §3 的条目连接查询（命令间隔 2 s，实测一轮 3–4 s），记录每轮的时间戳与按标题过滤的命中数，期望先 0 后 1。
4. 同时跑 §3 的两条仓库侧查询，期望两条都是 0 命中。
5. 复现 §6 第 1 条：把对账命令写成 `gh api graphql --jq --arg …`，确认它报 `accepts 1 arg(s), received 4`。

---

## 2. `pending_external_write` 的状态：一条结果轴 + 一条获知方式轴

R8 规定"补证据前不得冻结该表的状态机取值集合"。本层给出的不是**一个**集合，而是**两条正交的轴**；把它们装进同一个集合是本节早先版本的核心错误（订正说明见 2.3 末）。

### 2.1 结果轴（唯一权威）

状态列的**类型**是 `packages/domain/src/enums.ts` 的 `WriteState`：`pending` / `saved` / `unknown` / `conflict` / `failed`。枚举的单一权威在 `packages/domain`（`AGENTS.md` §2）；R8 的落地层建写入事实表时沿用它，不各自另立一套（**订正 2026-09-24**：原文点名了那张表的表名，而本层不得断言上层的事实；表名归 L3 的建表决定）。

| 取值 | 含义 | 谁判定 |
|---|---|---|
| `pending` | 写入已发起、尚无结论 | **本地写入记录**（发起前那一行是否存在）。它**不需要平台观测**——"我们发出去了但还没结论"是本地系统自己知道的事实 |
| `saved` | 外部对象确实存在且已挂到本实体 | 响应确认或对账采纳（见 2.2） |
| `unknown` | 结果无法判定 | 对账**窗口结束后**仍未给出唯一结论（见 2.2；窗口值见 §3 第 1 条，保持开口） |
| `failed` | 写入确实没发生，允许重试 | 平台显式拒绝或客户端发出前拒绝，且同形对账为空（见 2.2） |
| `conflict` | 目标被别的实体占用 | **本层没有观测**；可达性属于 L3 写路径的判断，本层不为它背书 |

### 2.2 获知方式轴（本层的发现）

下面四个标注回答的是"这个结果**是怎么得知的**"，不是"结果是什么"。它们各自映射到结果轴，并各自指到支持它的观测。

| 标注 | 映射到 | 支持它的观测 | 观测里的事实 |
|---|---|---|---|
| `confirmed` | `saved` | 实验 3(d)（重试的 `201` 返回体带 `node_id`）、实验 3(b)（标签探针的 `201` 返回体带 `node_id`）；实验 1 **是推导**（两次创建各返回一个**不同**的 issue URL，说明响应带对象标识；但该实验两次都拿到了响应，本身不是「响应丢失后靠它确认」的观测） | 响应里带回平台分配的对象标识，不需要对账 |
| `reconciled` | `saved` | 实验 2（**仓库侧列表路径**恰好 1 命中）、实验 4（条目连接恰好 1 命中） | 唯一性成立时对账能认出该对象；实验 1 给出唯一性不成立的反例 |
| `rejected` | `failed` | 实验 3(c)（`422` + 两条路径 0 命中 + 仓库编号集合无新增）、实验 3(a)（客户端拒绝 + 仓库编号集合无新增） | "拒绝"与"对账为空"两条同时成立；两类拒绝各被观测到一次。实验 3(d) **不在本行**：它支持的是「重试不重复」，不是「被拒绝」 |
| `unresolved` | `unknown` | 实验 1（计数 2，无法判定哪一条属于本写入） | **对账窗口结束后仍不唯一**。实验 4 第 1 轮（允许路径上两条路径都是 0）**不在本行**：它 3 s 后就被第 2 轮唯一命中，是 `pending` 的过渡观测，不是「窗口结束仍不唯一」 |

**`pending` 与 `unresolved` 的边界（2026-09-24 评审订正）**：`unresolved` 的定义是「**对账窗口结束后**仍给不出唯一结论」，窗口值本身在本层保持开口（§3 第 1 条：只有两个上界样本，n = 1）。窗口内的空结论是 `pending` 的过渡观测，**不得**归到 `unresolved`——否则实验 4 第 1 轮那种 3 s 自愈的写入会被 ADR-0004 的可见性判据呈现为「需要人工确认」，而那正是本层要避免的情形。

**对账证据只认允许的路径。** §1 与实验 2 §4 规定对账不得走搜索索引路径（索引可见延迟 ≈9 s，窗口内会返回 0 而对象已经存在）。因此实验 2 那个"窗口内搜索路径 0 命中"**不是** `unresolved` 的支持观测——它证明的是"搜索路径不可用"，不是"允许路径给不出结论"。允许路径上的空窗口只有实验 4 第 1 轮这一次观测，**n = 1**，本层不为它声称更强的支持。

**产品可见性的条件**：`unknown` 作为**产品可见**的"结果不确定"（ADR-0004 第 3 条要求人工确认）以「**对账窗口结束后仍未给出唯一结论**」为条件（判据的单一权威是裁决 §4 的 R8 行；窗口值见 §3 第 1 条，保持开口）；`pending` 只是过渡段，**不得单独触发人工确认**——否则实验 2 里 ≈9 s 自愈的那种写入会在对账完成前就被呈现为"需要人工确认"。

### 2.3 不写入的候选取值（推不出观测支持，逐条点名）

| 候选 | 为什么不写 |
|---|---|
| `reconcile_empty`（"对账查不到"本身作为一个状态） | 实验 2 证明它对内不可判别：对象已存在而对账返回 0。它既可能通向 `failed`（实验 3），也可能通向 `unknown`（实验 2），不能作为取值 |
| `duplicate_suspected` | 实验 1 能观测到计数 2，但"结果不确定"时调用方没有响应，平台也不返回把对象绑定到某次写入的字段；它只能作为 `unresolved` 的一种**证据**，不是独立取值 |
| `retrying` / `retry_scheduled` | 四条实验都没有观测到带退避或调度的重试行为；实验 3(d) 的重试是人工显式发起的 |
| `timed_out` | 没有观测到任何平台侧超时；本层的响应丢失是主动丢弃输出，不是超时 |
| `abandoned` | 没有观测到"放弃"这个动作的平台或本地形态 |

**订正说明（2026-09-24 评审响应）**：本节早先版本把结果轴与获知方式轴装进**同一个**集合，于是"写入已发起、对账尚未给出结论"只能作为一个取值候选去竞争观测支持；它拿不出平台观测（本地事实本来就不需要平台观测），就被判为"与 `uncertain` 不可判别"而合并。修法是**拆轴**而不是合并取值：`pending` 是结果轴上的合法取值，由本地写入记录判定；本层的观测只对**获知方式**负责，而获知方式只在有结论时才存在——"尚未有结论"不该由获知方式轴表达。同时 `failed` / `uncertain` 改名为 `rejected` / `unresolved`，让两个轴上的名字不再互相碰撞。

**集合与迁移的分工**：本节给出两条轴与每个获知方式标注的观测支持。结果轴上的**迁移条件**只有一部分被观测（`pending → saved` 有实验 2、3；`pending → failed` 有实验 3；**`pending → unknown` 在本层没有观测支持**——实验 4 第 1 轮是窗口内 0 命中，按 §2.2 判 `pending`，2026-09-24 评审订正：原文把它写成 `unknown` 的支持，与 §2.2 自相矛盾），完整迁移图与"窗口取多少秒"属于 L3（#28）的建表决定，本层不给。

## 3. 未证明的部分

逐条点名，不用"基本可以认为"这类修饰：

1. **对账窗口的边界值没有系统测量**：实验 2 的搜索路径 **≤9 s**（上一轮 0 命中于 +5 s，分辨率 4 s）、实验 4 的条目连接 **≤4 s**（上一轮 0 命中于 +1 s，分辨率 3 s）各是一次观测（n = 1），没有重复测量，也没有 P95 / 最大值。因此"窗口取多少秒"没有证据，只有两个上界样本。
2. **`pending → unknown` 的转换时刻没有锚点**（2026-09-24 评审订正：原文写「`unknown` 的起始时刻只能取『命令发出』」，那是单轴模型的残留——命令发出后、窗口结束前是 `pending`，不是 `unknown`）：实验 2 里对象的平台时间（`03:41:15Z`）早于命令返回（`03:41:16Z`），但本层没有测「响应丢失时命令何时真正完成」，也没有测窗口该取多长，因此**无法把 `pending → unknown` 的转换时刻锚到任何观测**。
3. **draft 创建的失败分支没有观测**：实验 3 的失败形态只覆盖 `createIssue`（REST）。`addProjectV2DraftIssue` 被平台拒绝时的形态、以及此时对账作用域是否仍为 project 条目连接，**没有观测**。
4. **`createIssue` 的 gh 客户端路径与 REST 路径的差异只观测了一个参数**：未知标签在两条路径上行为不同（实验 3）；其它参数是否也有同样的差异，没有观测。
5. **非唯一标记下能否用其它输入把对象分开**：实验 1 只观测到"计数 2"，没有尝试用 `createdAt` 的秒级时间戳或作者+更窄的时间窗去区分这两条对象。因此 `unresolved` 里"无法判定"的依据是"平台不返回把对象绑定到某次写入的字段"，**不是**"试过所有输入都失败"。
6. **`pending_external_write` 在"创建内容"这一步的键形状**：本层只证明 `content_id` 在创建前不存在（实验 1、实验 4）且标题不可靠（实验 1；E1-3 实验 3 §4.4）。**"那应该取什么"没有观测支持**——本层不给结论，L3 建表时不得把它写成已证明的事实。
7. **`deleteProjectV2Item` / 归档之后的对账形态**：未观测。沙箱定义 §8 登记的 `REDACTED` 条目类型空白依然存在。
8. **`fixture shared` 已 `CLOSED` 的漂移**：只登记差异，没有观测"成员关系被移除或归档后对象身份如何表现"。
9. **`draft-a` 的可见延迟**：因本层的工具错误没有测到（实验 4 §6 第 1 条），只有 `draft-b` 的一次样本。
10. **搜索索引延迟与仓库规模、查询形状的关系**：n = 1，未测。
11. **`confirmed` 之后未决行的关闭时机**：本层没有实现，也没有观测平台侧的确认信号；"什么时候可以把 `pending_external_write` 的行关掉"属于实现决定。
12. **`pending` 与 `uncertain` 的判别性缺口（2026-09-23 记录，已被第 18 条取代）**：~~本层没有观测到任何能把「写入已发起但还没对账」与「对账给了空结论」分开的事实——两者都由同一条「窗口内为空」支持……因此 §2 把两者合并为一个取值。~~ **Superseded by 第 18 条（2026-09-24）**：该结论建立在把两条轴装进一个集合的旧模型上；拆轴之后 `pending` 是本地事实，不需要平台观测。原文保留以记录取舍过程。
13. **"平台不对内容创建去重"只来自一对 `createIssue`（n = 1）**：实验 1 的计数 2 是两次参数逐字相同的 `createIssue`；`addProjectV2DraftIssue` 的重复创建**没有测**（实验 4 的两条 draft 标题不同，不是同参数重发）。§4 第 1 行的结论因此限定在实测范围内，不能推广到 draft 分支。
14. **"显式拒绝后可安全重试"只有一次 `422` 加一次重试**：实验 3(c) 是一次调用、3(d) 是一次重试，各 n = 1；没有重复测量，也没有观测"重试再次失败"的形态。§4 第 4 行的结论因此限定在实测范围内。
15. **「结果未知且对象不存在」这一分支没有观测**（2026-09-24 评审补登）：本层的"对象不存在"只在两种情形下取得——平台显式拒绝（实验 3(c)）与客户端发出前拒绝（实验 3(a)）。生产里真正需要"绝不盲重试"的分支是**响应丢失、对账跑完仍查不到、而对象最终确实不存在**；本层没有构造这一分支，因此 `failed` 与 `unknown` 在**这条**路径上的边界只有推导，没有实测。
16. **GraphQL `createIssue` 的错误协议没有观测**（2026-09-24 评审补登）：实验 3 的失败形态全部走 REST（`gh api --method POST /repos/.../issues`），`rejected` 的判据因此绑在 REST 的 4xx + 错误体上。GraphQL 的错误是 **HTTP 200 + `errors[]`**，本层既没有构造也没有观测这一形态，不能把 `rejected` 的判据推广到 GraphQL 面。
17. **`Status = Todo` 的创建归因没有验证**（2026-09-24 评审补登）：实验 4 回读到的 `Status = Todo` 是一次只读观测；本层没有证明它是"创建动作直接赋值"，也没有排除 project 的自动化 workflow 造成同一结果——回读实测 `Item added to project` 在该 project 上处于**启用**状态，它是一个合理替代成因。把这条写成"平台在创建时就带上 `Status`"超出了观测范围。
18. **`pending` 是本地事实，不需要平台观测（2026-09-24 评审订正）**：第 12 条的修法是拆轴（§2 的订正说明），不是补一条观测。**仍然缺的**是结果轴上的**迁移判据与时机**（谁在什么时候把行从 `pending` 推进），它属于 L3 的写路径，本层不给。

## 4. 四条实验的合并结论

| # | 问题 | 实测结论 | 观测 |
|---|---|---|---|
| 1 | 同参数两次创建内容会得到几条对象 | **2 条**（`createIssue` 的一对，n = 1）。平台不对内容创建去重，盲重试必然产生第二个对象；draft 的重复创建未测（§3 第 13 条） | 实验 1 |
| 2 | 响应丢失后能否靠对账认出刚创建的对象 | **能，前提是标记唯一**：两条路径都唯一命中；搜索索引路径延迟 ≈9 s，仓库侧列表 ≈0 s | 实验 2 |
| 3 | 对账查不到是否就等于"没创建" | **不等于**：窗口内搜索路径返回 0 而对象已存在 | 实验 2 |
| 4 | 平台显式拒绝之后能否安全重试 | **能**（一次 `422` 与一次重试的实测范围内）：`422` 之后两条路径对账为 0，重试后按标记计数 1 | 实验 3 |
| 5 | "参数看起来非法"能否当作失败判据 | **不能**：未知标签被平台静默创建（`201`），而同一标签在 gh 客户端路径上被拒 | 实验 3 |
| 6 | draft 的对账作用域是什么 | **只有 project 条目连接**：仓库侧列表与搜索都是 0 命中；延迟 ≈4 s | 实验 4 |
| 7 | 行为 6 的两半是否都有观测 | **是**：「先对账」（实验 2、实验 3）与「不盲目重试」（实验 1）各有直接观测 | 实验 1–4 |
| 8 | `pending_external_write` 的状态 | **两条轴**：结果轴取 `packages/domain` 的 `WriteState`（类型权威，`pending` 由本地写入记录判定）；获知方式轴四个标注（`confirmed` / `reconciled` / `rejected` / `unresolved`）各有观测支持并各自映射到结果轴；5 个候选取值因推不出支持而不写入 | §2 |

**对 R8 的直接后果**：状态列的**类型**与获知方式标注的来源都有了出处（§2 的两条轴），`pending_external_write` 的状态不再处于"补证据前不得冻结"的状态；但**键形状**仍有未证明的部分（§3 第 6 条），结果轴上的**迁移判据与时机**属于 L3 写路径，L3 建表时按这两节处理。裁决的 §2.6 与 §4 的 R8 行按本记录订正。
