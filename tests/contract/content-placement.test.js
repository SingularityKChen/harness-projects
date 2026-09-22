// 流程知识的归属：`AGENTS.md` §0 的每个入口都必须在一张分类表里找到自己的桶。
//
// 为什么需要它：同一个形状的故障在这个仓库出现过三次——issue #110（自动化被移除，
// 替代品只写在散文里）、issue #112（同一条断言写在两处）、issue #55（验收用字面量
// grep，换个措辞就绕过）。三次都是**归属不清**：知识住在哪里没有规则。
//
// 本文件是那条规则的可执行形式，同时补上 `AGENTS.md` §9 从写下那天起就要求、
// 而仓库里从未存在的「链接检查」——它覆盖 §0 路由表与本文档的归属表。`docs/` 其余
// 引用尚未覆盖，缺口记在 `docs/development/content-placement.md` §5。
//
// 解析对象只有两个：`AGENTS.md` §0 的路由表，与
// `docs/development/content-placement.md` 的**归属表**（缺口表不参与，它是观察
// 记录，不是路由分类）。

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

const AGENTS = 'AGENTS.md'
const PLACEMENT = 'docs/development/content-placement.md'

const BUCKETS = Object.freeze(['技法', '约定', '机械', '一次性'])

/**
 * 运行态路径：`.worktrees/` 与 `.superpowers/` 在干净 clone 里不存在，而
 * `AGENTS.md` §3 明确把「路径引用」列为运行态内容不进文档的例外。它们的**存在性**
 * 因此不参与判定——只有存在性：§0 与归属表对同一个任务的说法必须一致，
 * 这一条不因为路径是运行态而豁免。
 *
 * 两个断言的分工写在这里，是因为第一版把它们混成了一个 `continue`：token 被整体
 * 丢弃，于是 `隔离工作区` 那一行的跨表一致性断言变成空转，而文件头却声称它被看见
 * （评审 P2-2）。运行态标记由 `referencedPaths()` 带出，只由存在性断言消费。
 */
const RUNTIME_PREFIXES = Object.freeze(['.worktrees/', '.superpowers/'])

const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8')

/** 从 Markdown 里取出一张表：表头以 `header` 开头，返回去掉表头与分隔行的数据行。 */
function tableRows(source, header) {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.startsWith(header))
  assert.notEqual(start, -1, `找不到表头为 ${header} 的表格`)
  assert.match(lines[start + 1], /^\|[\s|:-]+\|$/, `${header} 的表头下一行必须是分隔行`)

  const rows = []
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim()))
  }
  return rows
}

/** 提取反引号里的仓库相对路径。含 `<` 或 `*` 的模式取到第一个通配符为止的目录部分。 */
function referencedPaths(text) {
  const found = []
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim()
    if (token.includes('://') || token.startsWith('/') || token.startsWith('~')) continue
    if (!token.includes('/') && !token.endsWith('.md')) continue

    // 运行态 token 照常返回（覆盖断言要用），只带一个标记给存在性断言跳过。
    const runtime = RUNTIME_PREFIXES.some((prefix) => token.startsWith(prefix))

    const cut = token.search(/[<*]/)
    if (cut === -1) {
      found.push({ token, target: token, runtime })
      continue
    }
    const prefix = token.slice(0, cut)
    const dir = prefix.endsWith('/') ? prefix : path.posix.dirname(prefix)
    if (dir !== '' && dir !== '.') found.push({ token, target: `${dir}/`, runtime })
  }
  return found
}

/** §0 的正文——引用完整性只覆盖路由表，不覆盖 `AGENTS.md` 的其余章节。 */
function routerSection(source) {
  const part = source.split('\n## ').find((section) => section.startsWith('0.'))
  assert.ok(part, 'AGENTS.md 必须有 §0')
  return part
}

const agentsSource = read(AGENTS)
const placementSource = read(PLACEMENT)

// 「任务」列是第 0 列；表头是 `| 任务 | 入口 |`。
const routerTasks = tableRows(routerSection(agentsSource), '| 任务 |').map((row) => row[0])
// 「§0 任务」列是第 0 列；桶列是第 2 列。
const placementRows = tableRows(placementSource, '| §0 任务 |')
const placementTasks = placementRows.map((row) => row[0])

/**
 * 通配占位符（`<slug>`、`*`）截断到目录部分；**没有通配符的路径整条参与比对**。
 *
 * 第一版把每条路径都归约成目录，于是 `docs/development/publication.md` 与
 * `docs/development/workflow.md` 都变成 `docs/development/`，文件级的替换因此
 * 完全看不见——评审的探针（把「日常开发和验证」的入口换成另一个同样存在的文件）
 * 在那一版下仍然全绿。归约只对真的含占位符的路径成立。
 */
const normalizePath = (token) => {
  const cut = token.search(/[<*]/)
  if (cut === -1) return token
  const head = token.slice(0, cut)
  return head.endsWith('/') ? head : `${path.posix.dirname(head)}/`
}

test('§0 路由表的每个任务都在归属表里，且两个集合精确相等', () => {
  assert.ok(routerTasks.length > 0, '§0 路由表必须非空')

  const missing = routerTasks.filter((task) => !placementTasks.includes(task))
  const extra = placementTasks.filter((task) => !routerTasks.includes(task))

  assert.deepEqual(missing, [], `§0 有入口但没有归属：\n${missing.join('\n')}`)
  assert.deepEqual(extra, [], `归属表有行但 §0 没有这个任务（§0 改了名字？）：\n${extra.join('\n')}`)
})

test('§0 的入口路径必须被同一任务在归属表里的「涉及内容」覆盖', () => {
  // §0 的「入口」与归属表的「涉及内容」是两份手写清单。只断言"路径存在"看不见
  // 一方被换成另一个同样存在的路径——那正是本检查要防的那类静默漂移。
  const routerRows = tableRows(routerSection(agentsSource), '| 任务 |')
  const byTask = new Map(placementRows.map((row) => [row[0], row[1]]))
  const offenders = []

  for (const row of routerRows) {
    const [task, entryCell] = row
    const declared = byTask.get(task)
    if (declared === undefined) continue

    const owned = referencedPaths(declared).map(({ target }) => normalizePath(target))
    for (const { token, target } of referencedPaths(entryCell)) {
      const wanted = normalizePath(target)
      const covered = owned.some((have) => have.startsWith(wanted) || wanted.startsWith(have))
      if (!covered) offenders.push(`${task} —— §0 的 ${token} 未出现在归属表的「涉及内容」里`)
    }
  }

  assert.deepEqual(offenders, [], `两张表对同一任务的入口说法不一致：\n${offenders.join('\n')}`)
})

test('归属表里每个任务恰好一行，§0 路由表也是', () => {
  const duplicates = (tasks) => {
    const seen = new Set()
    return tasks.filter((task) => (seen.has(task) ? true : (seen.add(task), false)))
  }

  assert.deepEqual(duplicates(placementTasks), [], '归属表里同一个任务出现多行')
  // §0 自己重复一行时，覆盖断言用的是 Array.includes，既不会报 missing 也不会报 extra。
  assert.deepEqual(duplicates(routerTasks), [], '§0 路由表里同一个任务出现多行')
})

test('归属表每行四列，且桶名只取自四个固定取值', () => {
  const offenders = []
  for (const row of placementRows) {
    // 行被截断时 row[2] 是 undefined，直接 .split 会抛 TypeError 而不是报出可读的违规。
    if (row.length !== 4) {
      offenders.push(`${row[0] ?? '(无任务名)'} —— 列数 ${row.length}，期望 4`)
      continue
    }
    const buckets = row[2].split(/[、,，/]/).map((part) => part.trim()).filter(Boolean)
    // 空格子会 split 成 []，filter(Boolean) 之后仍然通过——那正是「每个入口都能查到
    // 自己的桶」这条最小闭环要拒绝的情形。
    if (buckets.length === 0) {
      offenders.push(`${row[0]} —— 桶列为空`)
      continue
    }
    for (const bucket of buckets) {
      if (!BUCKETS.includes(bucket)) offenders.push(`${row[0]} —— ${bucket}`)
    }
  }
  assert.deepEqual(offenders, [], `桶名必须来自 ${BUCKETS.join(' / ')}：\n${offenders.join('\n')}`)
})

test('§0 与归属表引用的仓库路径都真实存在', () => {
  const offenders = []
  for (const { token, target, runtime } of [
    ...referencedPaths(routerSection(agentsSource)),
    ...placementRows.flatMap((row) => referencedPaths(row.join(' '))),
  ]) {
    // 只有存在性豁免运行态路径：`.worktrees/` 在干净 clone 里本来就不存在。
    if (runtime) continue
    if (!existsSync(path.join(ROOT, target))) offenders.push(`${token} → ${target} 不存在`)
  }
  assert.deepEqual(offenders, [], `引用了不存在的路径：\n${offenders.join('\n')}`)
})

test('规则落在指令文件里，并指向唯一的详述', () => {
  const section = agentsSource.split('\n## ').find((part) => part.startsWith('3.'))
  assert.ok(section, 'AGENTS.md 必须有 §3')

  // 只匹配文件名看不见"提了一句文件名但把规则撤了"。断言同一条目里既有指向详述的
  // 链接，又有规则本身的落点（技法住 `.agents/skills/`）——两者在同一个列表项里。
  const landed = section
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .filter((line) => line.includes('content-placement.md') && line.includes('.agents/skills/'))

  assert.equal(landed.length, 1, '§3 必须恰好有一条把「技法住 .agents/skills/」与详述链接写在一起')
})
